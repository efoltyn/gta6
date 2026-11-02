/* tools/three/entry.js — what src/vendor/three.r187.js IS.

   The game is ~1000 classic <script> files that read a global `THREE` at
   parse time. three r187 ships ES modules only, so tools/three/build.mjs
   bundles this file with esbuild into ONE classic IIFE that sets
   window.THREE (and module.exports under node, for the vm checks in tools/).

   window.THREE = everything from 'three/webgpu' (WebGPURenderer, the node
   materials, StorageBufferAttribute, the drawing pipelines ...) overlaid with
   everything from 'three' (WebGLRenderer, ShaderChunk, ShaderLib,
   UniformsLib/Utils, the classic materials). The two share three.core.js, so
   every class exists once. The single name both define differently is
   PMREMGenerator: THREE.PMREMGenerator is the WebGL one (what the game uses
   today), THREE.WebGPU.PMREMGenerator the node one.

   THREE.TSL     every TSL function ('three/tsl'), e.g. THREE.TSL.uniform
   THREE.WebGPU  the 'three/webgpu' namespace as published
   THREE.Addons  the jsm addons below, also flattened onto THREE under the
                 names the game already uses (THREE.GLTFLoader, ...)

   THE TWO GLOBAL DECISIONS THAT KEEP r128's LOOK (docs/plan/three-r187.md):

   1. COLOUR MANAGEMENT OFF. r128 had none: a hex you typed went to the
      shader as-is and was treated as linear; textures marked sRGB were
      decoded, the output encoded to sRGB. ColorManagement.enabled = false is
      exactly that, so every authored colour in the game stays bit-identical.
      (texture.colorSpace / renderer.outputColorSpace are honoured either
      way: they are the renamed encoding / outputEncoding.)

   2. THE r128 LIGHT MODEL (THREE.LEGACY_LIGHTS). r155 made physically
      correct lighting the only mode. The game's few hundred lights are tuned
      on the legacy model, so the WebGL renderer keeps it: light colours are
      scaled by PI (what r128's `irradiance *= PI` did, and what r155's
      useLegacyLights did), point/spot lights fall off with r128's
      pow(saturate(1 - d/distance), decay) and default to decay 1. Build
      patches in tools/three/build.mjs carry the JS half; the shader half is
      the chunk swap below. The WebGPU renderer does NOT have this yet (see
      the plan doc): its node lights are physical. */
import * as WEBGL from 'three';
import * as WEBGPU from 'three/webgpu';
import * as TSL from 'three/tsl';

import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import * as MeshletGeometryUtils from 'three/addons/utils/MeshletGeometryUtils.js';
import * as MeshletPipeline from 'three/addons/pipelines/MeshletDrawingPipeline.js';

const THREE = Object.assign( {}, WEBGPU, WEBGL );

THREE.WebGPU = WEBGPU;
THREE.TSL = TSL;

// r128's examples/js attached BufferGeometryUtils as a class with static
// methods; the names it had then still answer.
const BGU = Object.assign( {}, BufferGeometryUtils );
BGU.mergeBufferGeometries = BufferGeometryUtils.mergeGeometries;
BGU.mergeBufferAttributes = BufferGeometryUtils.mergeAttributes;
THREE.BufferGeometryUtils = BGU;
THREE.SkeletonUtils = Object.assign( {}, SkeletonUtils );
THREE.GLTFLoader = GLTFLoader;
THREE.DRACOLoader = DRACOLoader;
THREE.RGBELoader = RGBELoader;
THREE.HDRLoader = HDRLoader;
THREE.ThreeMFLoader = ThreeMFLoader;
THREE.MeshletGeometryUtils = Object.assign( {}, MeshletGeometryUtils );
THREE.MeshletDrawingPipeline = MeshletPipeline.MeshletDrawingPipeline;
THREE.MeshletBatch = MeshletPipeline.MeshletBatch;
THREE.Addons = {
	BufferGeometryUtils: BGU, SkeletonUtils: THREE.SkeletonUtils,
	GLTFLoader, DRACOLoader, RGBELoader, HDRLoader, ThreeMFLoader,
	MeshletGeometryUtils: THREE.MeshletGeometryUtils, MeshletDrawingPipeline: MeshletPipeline,
};

// BufferGeometry's uuid is made on first use (its constructor no longer
// makes one; tools/three/build.mjs, "BufferGeometry: lazy uuid")
Object.defineProperty( WEBGL.BufferGeometry.prototype, 'uuid', { configurable: true,
	get: function () { const v = WEBGL.MathUtils.generateUUID(); Object.defineProperty( this, 'uuid', { value: v, writable: true, enumerable: true, configurable: true } ); return v; },
	set: function ( v ) { Object.defineProperty( this, 'uuid', { value: v, writable: true, enumerable: true, configurable: true } ); } } );

// ---- 1. colour management: r128 semantics ---------------------------------
WEBGL.ColorManagement.enabled = false;

// ---- 2. the r128 light model, shader half ---------------------------------
const LEGACY_ATTEN = 'float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {\n' +
	'\tif ( cutoffDistance > 0.0 && decayExponent > 0.0 ) {\n' +
	'\t\treturn pow( saturate( - lightDistance / cutoffDistance + 1.0 ), decayExponent );\n' +
	'\t}\n' +
	'\treturn 1.0;\n' +
	'}';
{
	const S = WEBGL.ShaderChunk;
	const re = /float getDistanceAttenuation\( const in float lightDistance, const in float cutoffDistance, const in float decayExponent \) \{[\s\S]*?return distanceFalloff;\n\}/;
	if ( ! re.test( S.lights_pars_begin ) ) throw new Error( 'three.r187: lights_pars_begin moved; the legacy light patch needs updating (tools/three/entry.js)' );
	S.lights_pars_begin = S.lights_pars_begin.replace( re, LEGACY_ATTEN );
}
THREE.LEGACY_LIGHTS = true;

// ---- 2b. r128 transmission: an alpha law -----------------------------------
// (the JS half, no transmission render pass, is in tools/three/build.mjs)
WEBGL.ShaderChunk.transmission_fragment = [
	'#ifdef USE_TRANSMISSION',
	'\tmaterial.transmission = transmission;',
	'\tmaterial.transmissionAlpha = 1.0;',
	'\t#ifdef USE_TRANSMISSIONMAP',
	'\t\tmaterial.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;',
	'\t#endif',
	'\t// r128: the pane fades by its transmission and comes back where it reflects',
	'\tdiffuseColor.a *= mix( saturate( 1. - material.transmission + dot( reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 1.0, metalnessFactor );',
	'#endif',
].join( '\n' );

// ---- 3. r128's `vUv` in built-in materials --------------------------------
// r128 gave every built-in material with a map ONE uv varying, vUv, already
// through the map's uvTransform; ~90 onBeforeCompile hooks in the game read
// it. r151 split it per map (vMapUv, vNormalMapUv, ...) and only declares
// vUv under USE_UV, which nothing defines. So where r128 had vUv, vUv is an
// alias of the varying r128 would have used (the first map in r128's
// uvTransform order). A hook that wants the bare uv can still define USE_UV.
{
	const S = WEBGL.ShaderChunk;
	const alias = ( stage ) => '\n#if ! defined( USE_UV ) && ! defined( USE_ANISOTROPY )\n' + [
		[ 'USE_MAP', 'vMapUv' ], [ 'USE_SPECULARMAP', 'vSpecularMapUv' ], [ 'USE_NORMALMAP', 'vNormalMapUv' ], [ 'USE_BUMPMAP', 'vBumpMapUv' ],
		[ 'USE_ROUGHNESSMAP', 'vRoughnessMapUv' ], [ 'USE_METALNESSMAP', 'vMetalnessMapUv' ], [ 'USE_ALPHAMAP', 'vAlphaMapUv' ], [ 'USE_EMISSIVEMAP', 'vEmissiveMapUv' ],
	].map( ( [ d, v ], i ) => ( i ? '\t#elif' : '\t#if' ) + ' defined( ' + d + ' )\n\t\t#define vUv ' + v ).join( '\n' ) + '\n\t#endif\n#endif\n';
	S.uv_pars_vertex += alias( 'vertex' );
	S.uv_pars_fragment += alias( 'fragment' );
}

// ---- 3b. screen render targets (r128's render-to-target) ------------------
// THREE.screenTarget(rt): render into rt exactly as onto the screen (the
// renderer's tone mapping and output colour space; a build patch honours
// rt.cbzScreen) and keep the encoded bytes raw (RGBA8, no colour space), as
// r128 did. Every program the target's scene needs is the screen's own, so a
// CCTV feed or a scope picture compiles nothing extra.
// THREE.screenTargetMap(material): a built-in material that SHOWS such a
// target (as its .map) decodes it in the shader, as r128 did for an
// sRGB-tagged map. A custom shader that samples one gets the raw bytes, also
// as r128 gave them.
THREE.screenTarget = function ( rt ) {
	rt.cbzScreen = true;
	rt.texture.colorSpace = WEBGL.NoColorSpace;
	rt.texture.internalFormat = 'RGBA8';
	return rt;
};
THREE.screenTargetMap = function ( material ) {
	const prev = material.onBeforeCompile;
	material.onBeforeCompile = function ( sh, r ) {
		if ( prev ) prev.call( this, sh, r );
		sh.fragmentShader = sh.fragmentShader.replace( '#include <map_fragment>',
			'#ifdef USE_MAP\n\tdiffuseColor *= sRGBTransferEOTF( texture2D( map, vMapUv ) );\n#endif' );
	};
	const key = material.customProgramCacheKey.bind( material );
	material.customProgramCacheKey = function () { return key() + '|cbzScreenMap'; };
	material.needsUpdate = true;
	return material;
};

// ---- 4. THE renderer switch: THREE.createRenderer(params) -----------------
// Every page makes its main renderer here. Default: WebGLRenderer (the game
// as it has always run). Opt-in: `?gpu=webgpu` (or localStorage
// "cbz.gpu" = "webgpu") makes a WebGPURenderer; with no navigator.gpu it is
// the same renderer on its WebGL2 backend (forceWebGL), so the node path can
// be exercised anywhere. `?gpu=webgl` forces the classic one. The choice is
// THREE.gpuMode(); renderer.cbzBackend says what was built ('webgl',
// 'webgpu', 'webgpu-gl'). A WebGPURenderer must finish init() before its
// first frame: renderer.cbzReady is that promise (render() before it is
// skipped by three with a warning, never a throw).
THREE.gpuMode = function () {
	let m = '';
	try { m = new URLSearchParams( globalThis.location && location.search ).get( 'gpu' ) || ''; } catch ( e ) {}
	if ( ! m ) try { m = globalThis.localStorage && localStorage.getItem( 'cbz.gpu' ) || ''; } catch ( e ) {}
	m = String( m ).toLowerCase();
	return m === 'webgpu' ? 'webgpu' : 'webgl';
};
THREE.createRenderer = function ( params ) {
	params = params || {};
	if ( THREE.gpuMode() === 'webgpu' ) {
		const hasGPU = !! ( globalThis.navigator && navigator.gpu );
		const r = new WEBGPU.WebGPURenderer( Object.assign( {}, params, { forceWebGL: ! hasGPU || params.forceWebGL === true } ) );
		r.cbzBackend = hasGPU && params.forceWebGL !== true ? 'webgpu' : 'webgpu-gl';
		// a WebGPURenderer THROWS on render() before init() has resolved; the
		// game's loops start at once, so frames before then are skipped
		let ready = false;
		const render0 = r.render;
		r.render = function () { return ready ? render0.apply( this, arguments ) : undefined; };
		r.cbzReady = r.init().then( () => {
			ready = true;
			// init() may fall back to WebGL2 by itself (no adapter): say what really runs
			if ( r.backend && ! r.backend.isWebGPUBackend ) r.cbzBackend = 'webgpu-gl';
			return r;
		} );
		return r;
	}
	const r = new WEBGL.WebGLRenderer( params );
	r.cbzBackend = 'webgl';
	r.cbzReady = Promise.resolve( r );
	return r;
};

// r128 needed a vendor patch to resolve a program's uniform list lazily
// (core/fxwarm.js queues compiles without waiting on the GPU); r187 does
// that natively (getUniformList + KHR_parallel_shader_compile).
THREE.CBZ_LAZY_PROGRAMS = 1;
THREE.CBZ_BUILD = 'r187';

// the classic global (module.exports for node is set by the build's footer)
globalThis.THREE = THREE;
