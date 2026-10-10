// CHARACTERS module entry: players, hoverboards, the chaser and portraits (API: CONTRACTS.md 6.3).
import * as THREE from 'three';
import { CHARACTERS, BOARDS } from './defs.js';
import { ROSTER } from './roster/index.js';
import { getModel } from './model.js';
import { PlayerRig } from './player.js';
import { initEnvironment } from './materials.js';
import { BoardRig } from './boards.js';
import { ChaserRig } from './chaser.js';

/** World-space bounds of the visible meshes only (hidden props such as the jetpack or pogo stick are skipped). */
function visibleBox(root, box, tmp) {
  box.makeEmpty();
  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry) return;
    let bb;
    if (o.isSkinnedMesh) { o.computeBoundingBox(); bb = o.boundingBox; }
    else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb = o.geometry.boundingBox; }
    if (!bb || bb.isEmpty()) return;
    tmp.copy(bb).applyMatrix4(o.matrixWorld);
    box.union(tmp);
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.7, 0.5));
  return box;
}

export class Characters {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = CHARACTERS;
    this.boards = BOARDS;
    initEnvironment(ctx.renderer);
  }
  start() {}
  _def(id) { return ROSTER[id] || ROSTER.zed; }
  createPlayer(characterId, outfitId) {
    const def = this._def(characterId);
    return new PlayerRig(def, getModel(def, outfitId), { castShadow: this.ctx.quality !== 'low' });
  }
  createBoard(boardId) {
    return new BoardRig(boardId, { castShadow: this.ctx.quality !== 'low' });
  }
  createChaser() { return new ChaserRig({ castShadow: this.ctx.quality !== 'low' }); }

  /**
   * Portrait of a character (full body, idle pose, 3/4 view) or a hoverboard, as a transparent PNG data URL.
   * Rendered through the main renderer into an sRGB render target (so shared env maps / programs stay valid),
   * supersampled 2x and downscaled on a 2D canvas. Synchronous; ~10-30 ms each (first call compiles programs).
   */
  renderPortrait(kind, id, outfitId, size = 256) {
    const r = this.ctx.renderer;
    if (!r || typeof document === 'undefined') return '';
    let rig = null;
    try {
      const kit = this._portraitKit();
      const S = Math.max(64, Math.min(1024, Math.round(size) * 2));
      if (kit.rt.width !== S) { kit.rt.setSize(S, S); kit.buf = new Uint8Array(S * S * 4); kit.big.width = kit.big.height = S; kit.img = kit.bigCtx.createImageData(S, S); }
      let obj;
      if (kind === 'board') {
        rig = this.createBoard(id);
        rig.update(0, { speed: 0, active: false });
        if (rig.glow) rig.glow.visible = false; // additive glow does not survive a transparent background
        obj = rig.object;
        obj.rotation.set(-0.95, 0.62, 0.34); // deck tilted toward the camera, diagonal across the frame
      } else {
        rig = this.createPlayer(id, outfitId);
        const s = { mode: 'menu', speed: 0, grounded: true, vy: 0, rolling: false, lean: 0 };
        for (let i = 0; i < 24; i++) rig.update(1 / 60, s);
        obj = rig.object;
        obj.rotation.y = 0.38; // three-quarter view
      }
      kit.scene.add(obj);
      obj.updateMatrixWorld(true);
      const box = visibleBox(obj, kit.box, kit.tmpBox);
      const c = box.getCenter(kit.v1), sz = box.getSize(kit.v2);
      const cam = kit.cam;
      const fit = Math.max(sz.y, sz.x * 1.02, 0.4) * (kind === 'board' ? 1.18 : 1.1);
      const dist = (fit / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) + sz.z * 0.5;
      cam.position.set(c.x, c.y + sz.y * 0.04, c.z - dist);
      cam.lookAt(c.x, c.y, c.z);
      cam.updateMatrixWorld(true);

      const prevRT = r.getRenderTarget();
      r.getClearColor(kit.prevClear);
      const prevAlpha = r.getClearAlpha();
      r.setRenderTarget(kit.rt);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(kit.scene, cam);
      r.readRenderTargetPixels(kit.rt, 0, 0, S, S, kit.buf);
      r.setRenderTarget(prevRT);
      r.setClearColor(kit.prevClear, prevAlpha);
      kit.scene.remove(obj);

      // flip rows, un-premultiply partially transparent pixels (blending happened in linear space)
      const src = kit.buf, dst = kit.img.data, row = S * 4, L = kit.toLin;
      for (let y = 0; y < S; y++) {
        const so = (S - 1 - y) * row, d0 = y * row;
        for (let x = 0; x < row; x += 4) {
          const a = src[so + x + 3];
          if (a === 255 || a === 0) {
            dst[d0 + x] = src[so + x]; dst[d0 + x + 1] = src[so + x + 1]; dst[d0 + x + 2] = src[so + x + 2]; dst[d0 + x + 3] = a;
          } else {
            const k = 255 / a;
            for (let ch = 0; ch < 3; ch++) {
              const lin = Math.min(1, L[src[so + x + ch]] * k);
              dst[d0 + x + ch] = lin <= 0.0031308 ? lin * 12.92 * 255 : (1.055 * Math.pow(lin, 1 / 2.4) - 0.055) * 255;
            }
            dst[d0 + x + 3] = a;
          }
        }
      }
      kit.bigCtx.putImageData(kit.img, 0, 0);
      const out = kit.out;
      out.width = out.height = Math.round(size);
      const octx = out.getContext('2d');
      octx.clearRect(0, 0, out.width, out.height);
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(kit.big, 0, 0, S, S, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    } catch (e) {
      if (!this._portraitWarned) { this._portraitWarned = true; console.warn('[characters] portrait failed', e); }
      return '';
    } finally {
      if (rig) { rig.object.removeFromParent(); rig.dispose(); }
    }
  }

  _portraitKit() {
    if (this._kit) return this._kit;
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x9a8672, 1.25);
    const key = new THREE.DirectionalLight(0xfff0d8, 2.0);
    key.position.set(-2.4, 4.2, -4.5);          // front-left, above (camera looks along +Z from -Z)
    const rim = new THREE.DirectionalLight(0xc8ecff, 1.5);
    rim.position.set(3.2, 2.6, 3.8);            // behind-right edge light
    const fill = new THREE.DirectionalLight(0xffe2c4, 0.45);
    fill.position.set(3, 0.8, -3);
    scene.add(hemi, key, key.target, rim, rim.target, fill, fill.target);
    const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 60);
    const rt = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: true });
    rt.texture.colorSpace = THREE.SRGBColorSpace;  // hardware linear -> sRGB encode on write
    const big = document.createElement('canvas');
    big.width = big.height = 512;
    const bigCtx = big.getContext('2d', { willReadFrequently: false });
    const toLin = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const s = i / 255; toLin[i] = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
    this._kit = {
      scene, cam, rt, big, bigCtx, img: bigCtx.createImageData(512, 512), buf: new Uint8Array(512 * 512 * 4),
      out: document.createElement('canvas'), toLin,
      box: new THREE.Box3(), tmpBox: new THREE.Box3(), v1: new THREE.Vector3(), v2: new THREE.Vector3(), prevClear: new THREE.Color(),
    };
    return this._kit;
  }
}
