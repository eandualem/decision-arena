// Curved-world effect (the world bends down toward the horizon, and optionally sideways).
// Installed once at boot, BEFORE any material compiles. It patches three.js globally:
//   * ShaderChunk.project_vertex bends mvPosition (view space) by uCurve * depth^2
//   * Material.prototype.onBeforeCompile injects the shared uCurve uniform into every material
// => Every built-in material (Basic/Lambert/Phong/Standard/Physical/Toon/Points/Line...) bends automatically.
//
// Rules for everyone:
//   * Do NOT assign material.onBeforeCompile yourself. If you really must, call applyCurve(shader) inside it.
//   * To opt a material OUT (sky dome, screen-space overlays, camera-attached effects): noCurve(material)
//     before its first render.
//   * Custom ShaderMaterials that #include <project_vertex> are bent automatically. Hand-written vertex
//     shaders can call the GLSL helper in CURVE_GLSL (declare `uniform vec3 uCurve;` + add uniforms.uCurve = curveUniform).
//   * Shadow-map (depth) passes are NOT bent; receivers look up shadows with unbent positions, so shadows stay consistent.
//   * Frustum culling uses unbent bounds: set mesh.frustumCulled = false on long/far world meshes to avoid popping.
import * as THREE from 'three';
import { CURVE } from '../config.js';

// x = sideways bend (+ bends right), y = downward bend, z = distance from camera where bending starts
export const curveUniform = { value: new THREE.Vector3(CURVE.x, CURVE.y, CURVE.start) };

let installed = false;

export function applyCurve(shader) {
  shader.uniforms.uCurve = curveUniform;
  if (!shader.vertexShader.startsWith('#define USE_CURVE')) {
    shader.vertexShader = '#define USE_CURVE\nuniform vec3 uCurve;\n' + shader.vertexShader;
  }
}

export function installCurvedWorld() {
  if (installed) return;
  installed = true;
  const target = 'gl_Position = projectionMatrix * mvPosition;';
  const chunk = THREE.ShaderChunk.project_vertex;
  if (!chunk.includes(target)) {
    console.warn('[curve] project_vertex chunk changed; curved world disabled');
    return;
  }
  THREE.ShaderChunk.project_vertex = chunk.replace(target, /* glsl */`
#if defined( USE_CURVE ) && !defined( DEPTH_PACKING ) && !defined( DISTANCE ) && !defined( NO_CURVE )
	vec4 cwUnbent = mvPosition;   // Decision Arena: clipping planes test the unbent position (see below)
	{
		float cwDepth = max( 0.0, -mvPosition.z - uCurve.z );
		float cwD2 = cwDepth * cwDepth;
		mvPosition.x += uCurve.x * cwD2;
		mvPosition.y -= uCurve.y * cwD2;
	}
#endif
	${target}`);
  // Decision Arena: clipping planes are placed in the unbent world, so test them against unbent positions;
  // otherwise a cut drifts from where it was put as the bend grows with distance.
  const clip = '\tvClipPosition = - mvPosition.xyz;';
  if (THREE.ShaderChunk.clipping_planes_vertex.includes(clip)) {
    THREE.ShaderChunk.clipping_planes_vertex = THREE.ShaderChunk.clipping_planes_vertex.replace(clip, /* glsl */`
#if defined( USE_CURVE ) && !defined( DEPTH_PACKING ) && !defined( DISTANCE ) && !defined( NO_CURVE )
	vClipPosition = - cwUnbent.xyz;
#else
	vClipPosition = - mvPosition.xyz;
#endif`);
  } else console.warn('[curve] clipping_planes_vertex chunk changed; clipping uses bent positions');
  THREE.Material.prototype.onBeforeCompile = function (shader) { applyCurve(shader); };
}

/** Opt a material out of the curved-world bend. Call before first render. Returns the material. */
export function noCurve(material) {
  material.defines = Object.assign({}, material.defines, { NO_CURVE: '' });
  material.needsUpdate = true;
  return material;
}

/** GLSL helper for hand-written vertex shaders (requires `uniform vec3 uCurve;`). Usage: mv = curveBend(mv); */
export const CURVE_GLSL = /* glsl */`
vec4 curveBend( vec4 mv ) {
	float d = max( 0.0, -mv.z - uCurve.z );
	mv.x += uCurve.x * d * d;
	mv.y -= uCurve.y * d * d;
	return mv;
}`;

/** CPU version of the bend (for placing screen-space UI over world objects, if ever needed). */
export function bendViewPosition(v) {
  const c = curveUniform.value;
  const d = Math.max(0, -v.z - c.z);
  v.x += c.x * d * d;
  v.y -= c.y * d * d;
  return v;
}
