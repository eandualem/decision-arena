// Character models (built once per character + outfit, cached) and body instances (bones + meshes per rig).
import * as THREE from 'three';
import { Builder } from './geo.js';
import { BODY, restPositions, createBones, J, NJ, R, JOINTS } from './skeleton.js';
import { facePatchGeometry } from './body.js';
import { FacePainter } from './face.js';
import { bodyMaterial, shinyMaterial, glowMaterial, glassMaterial, printMaterial, faceMaterial } from './materials.js';

const MODELS = new Map();
const IDENTITY = new THREE.Matrix4();

export function resolveOutfit(def, outfitId) { return def.outfits[outfitId] ? outfitId : def.defaultOutfit; }

/** Build (or fetch) the static model for a roster definition + outfit. */
export function getModel(def, outfitId) {
  const oid = resolveOutfit(def, outfitId);
  const key = def.id + ':' + oid;
  let m = MODELS.get(key);
  if (m) return m;
  const o = def.outfits[oid];
  const dims = Object.assign({}, BODY, def.body || {}, o.body || {});
  const rp = restPositions(dims);
  const B = new Builder();
  const info = def.build(B, rp, dims, o, oid) || {};
  const boneMap = {};
  JOINTS.forEach((j, i) => { boneMap[j.name] = i; });
  (info.extras || []).forEach((e, i) => { boneMap[e.name] = JOINTS.length + i; });
  const main = B.build(boneMap);
  const subs = {};
  let tris = main.tris;
  for (const [name, sb] of Object.entries(B.subs || {})) { subs[name] = sb.build(boneMap); tris += subs[name].tris; }
  const atlas = def.atlas ? def.atlas(o, oid) : null;
  const faceStyle = def.face ? def.face(o, oid) : null;
  let faceGeo = null;
  if (faceStyle && info.faceGeo) faceGeo = info.faceGeo;
  else if (faceStyle && info.headC) faceGeo = facePatchGeometry(info.headC, info.hr, info.hs, rp[J.head], info.faceLift || 1.004);
  if (faceGeo) tris += (faceGeo.index ? faceGeo.index.count : faceGeo.attributes.position.count) / 3;
  m = {
    def, id: def.id, outfit: oid, o, dims, rp, info, main, subs, tris,
    atlas, printMat: atlas ? printMaterial(atlas) : null,
    faceStyle, faceGeo, faceBone: info.faceBone || 'head',
    extras: info.extras || [],
    shinyKind: info.shinyKind || def.shinyKind || 'gloss',
    height: info.height || 1.7,
  };
  MODELS.set(key, m);
  return m;
}

/**
 * One instance of a character body: groups, bones, skinned meshes, face.
 *   object (feet origin) > carve (lane bank / lean) > mover (root offset, pitch/yaw/roll around pivot) > inner (-pivot, squash) > bones + meshes
 */
export class CharacterBody {
  constructor(model, opts = {}) {
    this.model = model;
    this.object = new THREE.Group();
    this.object.name = (opts.name || 'char') + ':' + model.id;
    this.carve = new THREE.Group();
    this.mover = new THREE.Group();
    this.mover.rotation.order = 'YXZ';
    this.inner = new THREE.Group();
    this.object.add(this.carve);
    this.carve.add(this.mover);
    this.mover.add(this.inner);
    const sk = createBones(model.rp, model.extras);
    this.bones = sk.bones;
    this.byName = sk.byName;
    this.rest = sk.rest;
    this.skeleton = sk.skeleton;
    this.inner.add(sk.root);
    this.meshes = [];
    this.groups = {};
    this.glowMats = [];
    this.castShadows = opts.castShadow !== false;
    this._addSlots(model.main.slots, this.meshes);
    for (const [name, b] of Object.entries(model.subs)) {
      this.groups[name] = [];
      this._addSlots(b.slots, this.groups[name]);
    }
    if (model.faceGeo && model.faceStyle) {
      this.face = new FacePainter(model.faceStyle);
      this.faceMat = faceMaterial(this.face.texture, model.faceStyle.kind === 'screen');
      this.faceMesh = new THREE.Mesh(model.faceGeo, this.faceMat);
      this.faceMesh.name = 'face';
      this.byName[model.faceBone].add(this.faceMesh);
    }
    this.lift = 0;       // extra vertical offset (board, pogo, spring kicks)
    this.flipX = 0;      // additive pitch (flips)
    this.spinY = 0;      // additive yaw (spins)
  }

  _material(slot) {
    switch (slot) {
      case 'print': return this.model.printMat || bodyMaterial();
      case 'shiny': return shinyMaterial(this.model.shinyKind);
      case 'chrome': return shinyMaterial('chrome');
      case 'gloss': return shinyMaterial('gloss');
      case 'glow': return glowMaterial();
      case 'glass': return glassMaterial();
      default: return bodyMaterial();
    }
  }

  _addSlots(slots, list) {
    for (const [slot, geo] of Object.entries(slots)) {
      const mesh = new THREE.SkinnedMesh(geo, this._material(slot));
      mesh.bind(this.skeleton, IDENTITY);
      mesh.frustumCulled = false;
      mesh.castShadow = this.castShadows && slot !== 'glass' && slot !== 'glow';
      mesh.receiveShadow = false;
      mesh.name = slot;
      if (slot === 'glass') mesh.renderOrder = 2;
      this.inner.add(mesh);
      list.push(mesh);
      if (list !== this.meshes) this.meshes.push(mesh);
    }
  }

  setGroupVisible(name, v) {
    const g = this.groups[name];
    if (g) for (const m of g) m.visible = v;
  }

  /** Model-space point -> local position relative to a bone's rest position. */
  local(boneName, p) {
    const i = this.bones.indexOf(this.byName[boneName]);
    return new THREE.Vector3(p[0], p[1], p[2]).sub(this.rest[i]);
  }

  /** Attach an Object3D to a bone at a model-space rest position. */
  attach(boneName, obj, modelPos) {
    if (modelPos) obj.position.copy(this.local(boneName, modelPos));
    this.byName[boneName].add(obj);
    return obj;
  }

  applyPose(P) {
    const b = this.bones;
    for (let j = 0; j < NJ; j++) { const k = j * 3; b[j].rotation.set(P[k], P[k + 1], P[k + 2]); }
    const piv = P[R.pivot], pz = P[R.pivotZ];
    this.mover.position.set(P[R.ox], piv + P[R.oy] + this.lift, P[R.oz] + pz);
    this.mover.rotation.set(P[R.pitch] + this.flipX, P[R.yaw] + this.spinY, P[R.roll]);
    this.inner.position.set(0, -piv, -pz);
    const sq = P[R.squash];
    const sxz = 1 / Math.sqrt(Math.max(0.2, sq));
    this.inner.scale.set(sxz, sq, sxz);
  }

  dispose() {
    this.object.removeFromParent();
    if (this.face) { this.face.dispose(); this.faceMat.dispose(); }
    for (const m of this.glowMats) m.dispose();
    this.skeleton.dispose();
    // geometries and shared materials are cached per model and intentionally kept
  }
}
