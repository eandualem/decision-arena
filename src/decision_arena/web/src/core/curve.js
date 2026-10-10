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

// Decision Arena: the ground collapsing behind the race. Everything behind the edge (world z greater than
// x) breaks into 1.6 m pieces that fall away, each a little later than the last (y: 1 = on; z: seconds of
// extra fall once the edge has stopped, so pieces already going keep going). The camera's world matrix turns
// view-space positions back into world space.
export const collapseUniform = { value: new THREE.Vector4(1e9, 0, 0, 0) };
export const camWorldUniform = { value: new THREE.Matrix4() };

let installed = false;

export function applyCurve(shader) {
  shader.uniforms.uCurve = curveUniform;
  shader.uniforms.uCollapse = collapseUniform;
  shader.uniforms.uCamWorld = camWorldUniform;
  if (!shader.vertexShader.startsWith('#define USE_CURVE')) {
    shader.vertexShader = '#define USE_CURVE\nuniform vec3 uCurve;\nuniform vec4 uCollapse;\nuniform mat4 uCamWorld;\n' + shader.vertexShader;
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
	if ( uCollapse.y > 0.5 ) {
		vec4 cwWorld = uCamWorld * mvPosition;
		vec2 cwTile = floor( cwWorld.xz / 1.6 );
		float cwHash = fract( sin( dot( cwTile, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
		float cwBehind = ( cwTile.y + 0.5 ) * 1.6 - uCollapse.x - cwHash * 2.5;
		if ( cwBehind > 0.0 ) {
			float cwT = cwBehind / 22.0 + uCollapse.z;
			cwWorld.y -= 15.0 * cwT * cwT + cwHash * cwT * 2.0;
			cwWorld.x += ( cwHash - 0.5 ) * 2.5 * cwT;
			mvPosition = viewMatrix * cwWorld;
		}
	}
	{
		float cwDepth = max( 0.0, -mvPosition.z - uCurve.z );
		float cwD2 = cwDepth * cwDepth;
		mvPosition.x += uCurve.x * cwD2;
		mvPosition.y -= uCurve.y * cwD2;
	}
#endif
	${target}`);
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
