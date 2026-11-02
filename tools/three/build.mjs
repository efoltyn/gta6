#!/usr/bin/env node
/* tools/three/build.mjs — builds src/vendor/three.r187.js, the game's three.js.

     node tools/three/build.mjs            # build (fetches three@0.187.0 if needed)
     node tools/three/build.mjs --check    # build to a temp file, diff against the committed one

   ONE classic IIFE that sets window.THREE to the full r187 API (WebGL + WebGPU
   + TSL + the addons the game uses); tools/three/entry.js says what is in it
   and why. The game never imports anything: it reads the global.

   WHERE THE SOURCE COMES FROM. three@0.187.0's published build/ files
   (three.core.js / three.module.js / three.webgpu.js / three.tsl.js share
   three.core.js, so the bundle holds each class once) and examples/jsm.
   node_modules/three is used when it IS 0.187.0; otherwise the npm tarball
   is fetched once into ~/.cache/cbz-three/ (nothing to install).

   THE PATCHES. A handful of source edits the game depends on, each one an
   exact-text replace that must match the expected number of times or the
   build stops (so a version bump cannot silently drop one). They are the
   r187 ports of what src/vendor/three.r128.min.js carried, plus the JS half
   of the r128 light model. Each says why. */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.187.0";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "src/vendor/three.r187.js");
const ENTRY = path.join(ROOT, "tools/three/entry.js");

function threePackage() {
  const local = path.join(ROOT, "node_modules/three");
  try { if (JSON.parse(readFileSync(path.join(local, "package.json"), "utf8")).version === VERSION) return local; } catch (_) {}
  const cache = path.join(os.homedir(), ".cache/cbz-three", VERSION);
  const pkg = path.join(cache, "package");
  if (existsSync(path.join(pkg, "package.json"))) return pkg;
  mkdirSync(cache, { recursive: true });
  console.log(`fetching three@${VERSION} into ${cache}`);
  const tgz = execFileSync("npm", ["pack", `three@${VERSION}`, "--silent"], { cwd: cache, encoding: "utf8" }).trim().split("\n").pop();
  execFileSync("tar", ["xzf", tgz], { cwd: cache });
  return pkg;
}

/* [file (relative to the package), find, replace, expected count, why] */
const PATCHES = [
  // ---- the lean Object3D (r128 vendor patch 26b79386, ported) -------------
  // Phones: the city builds ~10^5 Object3Ds. modelViewMatrix, normalMatrix,
  // up, animations and uuid are made on first use instead of per object, and
  // the rotation<->quaternion link is two shared callbacks instead of two
  // closures per object. Behaviour is identical: every getter materialises
  // the same value the constructor used to make.
  ["build/three.core.js",
    "\t\tthis.uuid = generateUUID();\n\n\t\t/**\n\t\t * The name of the 3D object.",
    "\t\t/**\n\t\t * The name of the 3D object.", 1, "Object3D: lazy uuid"],
  ["build/three.core.js",
    "\t\tthis.up = Object3D.DEFAULT_UP.clone();\n",
    "", 1, "Object3D: lazy up"],
  ["build/three.core.js",
    "\t\tfunction onRotationChange() {\n\n\t\t\tquaternion.setFromEuler( rotation, false );\n\n\t\t}\n\n\t\tfunction onQuaternionChange() {\n\n\t\t\trotation.setFromQuaternion( quaternion, undefined, false );\n\n\t\t}\n\n\t\trotation._onChange( onRotationChange );\n\t\tquaternion._onChange( onQuaternionChange );",
    "\t\trotation._q = quaternion; rotation._onChangeCallback = _cbzEulerCb;\n\t\tquaternion._e = rotation; quaternion._onChangeCallback = _cbzQuatCb;", 1, "Object3D: shared rotation callbacks"],
  ["build/three.core.js",
    /\t\t\t\tvalue: scale\n\t\t\t\},\n[\s\S]*?\t\t\t\tvalue: new Matrix3\(\)\n\t\t\t\}\n/,
    "\t\t\t\tvalue: scale\n\t\t\t}\n", 1, "Object3D: lazy modelViewMatrix/normalMatrix"],
  ["build/three.core.js",
    "\t\tthis.animations = [];\n\n\t\t/**\n\t\t * Custom depth material",
    "\t\t/**\n\t\t * Custom depth material", 1, "Object3D: lazy animations"],
  ["build/three.core.js",
    "Object3D.DEFAULT_UP = /*@__PURE__*/ new Vector3( 0, 1, 0 );",
    `Object3D.DEFAULT_UP = /*@__PURE__*/ new Vector3( 0, 1, 0 );
/* CBZ: the lean Object3D's lazy members (tools/three/build.mjs) */
function _cbzEulerCb() { this._q.setFromEuler( this, false ); }
function _cbzQuatCb() { this._e.setFromQuaternion( this, undefined, false ); }
( function ( P ) {
	function L( k, make, writable ) {
		Object.defineProperty( P, k, { configurable: true,
			get: function () { const v = make(); Object.defineProperty( this, k, writable ? { value: v, writable: true, enumerable: true, configurable: true } : { value: v } ); return v; },
			set: function ( v ) { Object.defineProperty( this, k, { value: v, writable: true, enumerable: true, configurable: true } ); } } );
	}
	L( 'modelViewMatrix', function () { return new Matrix4(); }, false );
	L( 'normalMatrix', function () { return new Matrix3(); }, false );
	L( 'up', function () { return Object3D.DEFAULT_UP.clone(); }, true );
	L( 'animations', function () { return []; }, true );
	L( 'uuid', generateUUID, true );
} )( Object3D.prototype );`, 1, "Object3D: lazy member accessors"],
  ["build/three.core.js",
    "\t\tObject.defineProperty( this, 'id', { value: _id$1 ++ } );\n\n\t\t/**\n\t\t * The UUID of the geometry.\n\t\t *\n\t\t * @type {string}\n\t\t * @readonly\n\t\t */\n\t\tthis.uuid = generateUUID();\n",
    "\t\tObject.defineProperty( this, 'id', { value: _id$1 ++ } );\n", 1, "BufferGeometry: lazy uuid (the getter is in tools/three/entry.js)"],

  // ---- raycasts skip attributes whose CPU copy was released ---------------
  // core/batch.js keeps merged render geometry GPU-only once uploaded (the
  // arrays are dropped); a ray that lands on one must not read them.
  ["build/three.core.js",
    "\t\tif ( uv ) {\n\n\t\t\tintersection.uv = Triangle.getInterpolatedAttribute(",
    "\t\tif ( uv && uv.array ) {\n\n\t\t\tintersection.uv = Triangle.getInterpolatedAttribute(", 1, "raycast: released uv"],
  ["build/three.core.js",
    "\t\tif ( uv1 ) {\n\n\t\t\tintersection.uv1 = Triangle.getInterpolatedAttribute(",
    "\t\tif ( uv1 && uv1.array ) {\n\n\t\t\tintersection.uv1 = Triangle.getInterpolatedAttribute(", 1, "raycast: released uv1"],
  ["build/three.core.js",
    "\t\tif ( normal ) {\n\n\t\t\tintersection.normal = Triangle.getInterpolatedAttribute(",
    "\t\tif ( normal && normal.array ) {\n\n\t\t\tintersection.normal = Triangle.getInterpolatedAttribute(", 1, "raycast: released normal"],

  // ---- InstancedMesh is not frustum culled by default (r128) --------------
  // r187 culls a pool by a sphere over its instances computed ONCE and never
  // again, so a pool whose instances move (crowds, traffic, debris) culls on
  // stale bounds. r128 built every pool with frustumCulled = false and
  // core/instcull.js culls the ones it can bound exactly.
  ["build/three.core.js",
    "\t\tthis.isInstancedMesh = true;\n",
    "\t\tthis.isInstancedMesh = true;\n\t\tthis.frustumCulled = false; // CBZ: r128 default (core/instcull.js owns pool culling)\n", 1, "InstancedMesh: frustumCulled false"],

  // ---- Box3.setFromObject / expandByObject measure GEOMETRY (r128) --------
  // r187 boxes an InstancedMesh by the union of every instance and a
  // SkinnedMesh by every vertex through its current pose (computed on the
  // CPU, once, then cached). The game calls setFromObject ~115 places on rigs,
  // pools and kits that were tuned on r128's answer: the geometry's box placed
  // by matrixWorld. (precise = true still walks the vertices, as in r187.)
  ["build/three.core.js",
    "\t\t\t\tif ( object.boundingBox !== undefined ) {",
    "\t\t\t\tif ( false && object.boundingBox !== undefined ) { // CBZ: r128 semantics (tools/three/build.mjs)", 1, "Box3.expandByObject: geometry box"],

  // ---- one draw per transparent double-sided material (r128) --------------
  // r154+ draws a transparent DoubleSide material twice (back faces, then
  // front) unless forceSinglePass. Measured on the survival island: the same
  // ~1000 visible objects cost 1143 draws on r128 and 2222 on r187. Every
  // such material in the game was tuned single-pass; one that wants the
  // sorted two-pass look can set forceSinglePass = false itself.
  ["build/three.core.js",
    "\t\tthis.forceSinglePass = false;",
    "\t\tthis.forceSinglePass = true; // CBZ: r128's single pass (tools/three/build.mjs)", 1, "Material.forceSinglePass default true"],

  // ---- transmission is r128's alpha law, not a second render of the world --
  // r128's MeshPhysicalMaterial.transmission faded the pane's alpha (1 -
  // transmission + the luminance it reflects). r187 refracts: ANY visible
  // transmissive material makes the renderer draw every opaque object a
  // second time into a transmission target. The game's car glass and lamp
  // lenses are transmissive, so on r187 a street with one car in it drew
  // ~1000 objects twice (survival island: 1143 draws on r128, 2220 on r187).
  // The lists treat transmission as the transparency it was; the shader half
  // (THREE r128 alpha law) is the transmission_fragment swap in entry.js.
  ["build/three.module.js",
    "\t\tif ( material.transmission > 0.0 ) {",
    "\t\tif ( false && material.transmission > 0.0 ) { // CBZ: r128 transmission (no transmission pass)", 2, "render lists: no transmissive pass"],
  ["build/three.module.js",
    "\t\t\tuniforms.transmissionSamplerMap.value = transmissionRenderTarget.texture;\n\t\t\tuniforms.transmissionSamplerSize.value.set( transmissionRenderTarget.width, transmissionRenderTarget.height );",
    "\t\t\tif ( transmissionRenderTarget ) { // CBZ: there is no transmission pass (r128 transmission)\n\t\t\tuniforms.transmissionSamplerMap.value = transmissionRenderTarget.texture;\n\t\t\tuniforms.transmissionSamplerSize.value.set( transmissionRenderTarget.width, transmissionRenderTarget.height );\n\t\t\t}", 1, "materials: transmission target optional"],

  // ---- scene.environment lights PBR materials only, at their own intensity (r128)
  // r187 also lights MeshLambert/MeshPhong with scene.environment, and gives
  // every material without its own envMap scene.environmentIntensity instead
  // of its envMapIntensity. The game is Lambert-heavy and sets
  // envMapIntensity per material (core/gfx.js tiers it): measured on
  // tools/three/look-probe.html, a Lambert sphere under sky IBL + sun read
  // (177,163,145) on r128 and (211,200,186) on r187 (whites blow out).
  ["build/three.module.js",
    "( material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial ) ? scene.environment : null",
    "( material.isMeshStandardMaterial ) ? scene.environment : null /* CBZ: r128 */", 3, "environment: PBR only"],
  ["build/three.module.js",
    "\t\t\tif ( ( material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial ) && material.envMap === null && scene.environment !== null ) {\n\n\t\t\t\tm_uniforms.envMapIntensity.value = scene.environmentIntensity;",
    "\t\t\tif ( false && material.envMap === null && scene.environment !== null ) { // CBZ: r128 keeps the material's envMapIntensity\n\n\t\t\t\tm_uniforms.envMapIntensity.value = scene.environmentIntensity;", 1, "environment: material envMapIntensity"],

  // ---- raycasts against pools and skinned bodies (r128) -------------------
  // Same stale-bounds story as culling: r187 early-outs a ray on a sphere it
  // computed once over every instance / every posed vertex. r128 tested each
  // instance of a pool, and a skinned body by its geometry's bounds.
  ["build/three.core.js",
    "\t\t// test with bounding sphere first\n\n\t\tif ( this.boundingSphere === null ) this.computeBoundingSphere();\n\n\t\t_sphere$4.copy( this.boundingSphere );\n\t\t_sphere$4.applyMatrix4( matrixWorld );\n\n\t\tif ( raycaster.ray.intersectsSphere( _sphere$4 ) === false ) return;\n",
    "\t\t// CBZ: no instance-union early-out (r128; the union is computed once and goes stale)\n", 1, "InstancedMesh.raycast: r128"],
  ["build/three.core.js",
    "\t\tif ( this.boundingSphere === null ) this.computeBoundingSphere();\n\n\t\t_sphere$5.copy( this.boundingSphere );",
    "\t\tconst _cbzG = this.geometry; // CBZ: the geometry's bounds (r128), not a posed sphere computed once\n\t\tif ( _cbzG.boundingSphere === null ) _cbzG.computeBoundingSphere();\n\n\t\t_sphere$5.copy( _cbzG.boundingSphere );", 1, "SkinnedMesh.raycast: geometry sphere"],
  ["build/three.core.js",
    "\t\tif ( this.boundingBox !== null ) {\n\n\t\t\tif ( _ray$2.intersectsBox( this.boundingBox ) === false ) return;",
    "\t\tif ( this.geometry.boundingBox !== null ) {\n\n\t\t\tif ( _ray$2.intersectsBox( this.geometry.boundingBox ) === false ) return;", 1, "SkinnedMesh.raycast: geometry box"],

  // ---- the r128 light model, JS half (THREE.LEGACY_LIGHTS) ----------------
  ["build/three.core.js",
    "\tconstructor( color, intensity, distance = 0, angle = Math.PI / 3, penumbra = 0, decay = 2 ) {",
    "\tconstructor( color, intensity, distance = 0, angle = Math.PI / 3, penumbra = 0, decay = 1 ) { // CBZ: r128 default decay", 1, "SpotLight: decay 1"],
  ["build/three.core.js",
    "\tconstructor( color, intensity, distance = 0, decay = 2 ) {",
    "\tconstructor( color, intensity, distance = 0, decay = 1 ) { // CBZ: r128 default decay", 1, "PointLight: decay 1"],
  ["build/three.module.js",
    "\t\t\tconst intensity = light.intensity;\n\t\t\tconst distance = light.distance;",
    "\t\t\t// CBZ: the r128 (legacy) light model scales punctual/ambient/hemi light by PI\n\t\t\tconst intensity = light.intensity * ( ( light.isRectAreaLight || light.isLightProbe ) ? 1 : Math.PI );\n\t\t\tconst distance = light.distance;", 1, "WebGLLights: legacy PI scale"],
  ["build/three.module.js",
    "\t\t\t\tuniforms.color.copy( light.color ).multiplyScalar( light.intensity );",
    "\t\t\t\tuniforms.color.copy( light.color ).multiplyScalar( intensity );", 3, "WebGLLights: sun/directional/point use the scaled intensity"],

  // ---- the renderer's WebGLAttributes, for core/batch.js ------------------
  // batch.js reads merged geometry back from its GL buffer (WebGL2) to evict
  // and restore it; it needs the renderer's own attribute->buffer map.
  ["build/three.module.js",
    "\t\t\tattributes = new WebGLAttributes( _gl );\n",
    "\t\t\tattributes = new WebGLAttributes( _gl );\n\t\t\t( globalThis.__cbzGLAttr || ( globalThis.__cbzGLAttr = new WeakMap() ) ).set( _gl, attributes ); // CBZ\n", 1, "renderer: expose WebGLAttributes"],

  // ---- packed / far-cut geometry is never drawn ---------------------------
  // core/batch.js + core/citystream.js mark a geometry whose arrays are
  // packed away (_cbzNoDraw); city/playercars.js gives car cabins a far cut
  // (_cbzFar, decided by self.__cbzFar). Both must stop the draw here, in
  // projectObject, so no path can reach a frame with them.
  ["build/three.module.js",
    "\t\t\t\t} else if ( object.isMesh || object.isLine || object.isPoints ) {\n\n\t\t\t\t\tconst frustum = camera.isArrayCamera ? _frustumArray : _frustum;\n\n\t\t\t\t\tif ( ! object.frustumCulled || object.intersectsFrustum( frustum ) ) {",
    "\t\t\t\t} else if ( object.isMesh || object.isLine || object.isPoints ) {\n\n\t\t\t\t\tconst frustum = camera.isArrayCamera ? _frustumArray : _frustum;\n\t\t\t\t\tconst _cbzG = object.geometry;\n\n\t\t\t\t\tif ( ( ! object.frustumCulled || object.intersectsFrustum( frustum ) ) && ! ( _cbzG && ( _cbzG._cbzNoDraw || ( _cbzG._cbzFar && globalThis.__cbzFar && globalThis.__cbzFar( object, camera ) ) ) ) ) {",
    1, "projectObject: _cbzNoDraw / _cbzFar"],

  // ---- DRACOLoader's default decoder URLs, made at module load ------------
  // `new URL(.., import.meta.url)` at top level throws in the node vm checks
  // (no URL there) and means nothing in a classic script; the game always
  // calls setDecoderPath (city/playercars.js -> src/vendor/draco/gltf/).
  ["examples/jsm/loaders/DRACOLoader.js",
    "new URL( ",
    "_cbzURL( ", 5, "DRACOLoader: lazy default URLs"],
  ["examples/jsm/loaders/DRACOLoader.js",
    "const _taskCache = new WeakMap();",
    "const _taskCache = new WeakMap();\nfunction _cbzURL( a, b ) { return { toString() { try { return new URL( a, b ).toString(); } catch ( e ) { return a; } } }; }", 1, "DRACOLoader: URL helper"],
];

function applyPatches(file, text) {
  for (const [f, find, repl, want, why] of PATCHES) {
    if (f !== file) continue;
    if (want === 0) continue;
    if (find instanceof RegExp) {
      const g = new RegExp(find.source, "g");
      const n = (text.match(g) || []).length;
      if (n !== want) throw new Error(`patch "${why}" expected ${want} match(es) in ${f}, found ${n}`);
      text = text.replace(g, () => repl);
      continue;
    }
    const n = text.split(find).length - 1;
    if (n !== want) throw new Error(`patch "${why}" expected ${want} match(es) in ${f}, found ${n}`);
    text = text.split(find).join(repl);
  }
  return text;
}

async function main() {
  const check = process.argv.includes("--check");
  const pkg = threePackage();
  const esbuild = await import("esbuild");   // node resolves it up the tree (the repo devDependency)
  const patched = new Set(PATCHES.map((p) => p[0]));
  const plugin = {
    name: "cbz-three",
    setup(b) {
      // every 'three', 'three/webgpu', 'three/tsl', 'three/addons/*' resolves into the r187 package
      b.onResolve({ filter: /^three(\/.*)?$/ }, (a) => {
        const sub = a.path.slice(5);
        if (sub === "") return { path: path.join(pkg, "build/three.module.js") };
        if (sub === "/webgpu") return { path: path.join(pkg, "build/three.webgpu.js") };
        if (sub === "/tsl") return { path: path.join(pkg, "build/three.tsl.js") };
        if (sub.startsWith("/addons/")) return { path: path.join(pkg, "examples/jsm", sub.slice(8)) };
        if (sub.startsWith("/examples/jsm/")) return { path: path.join(pkg, sub.slice(1)) };
        throw new Error("unmapped three import " + a.path);
      });
      b.onLoad({ filter: /\.js$/ }, (a) => {
        const rel = path.relative(pkg, a.path).split(path.sep).join("/");
        if (!patched.has(rel)) return undefined;
        return { contents: applyPatches(rel, readFileSync(a.path, "utf8")), loader: "js" };
      });
    },
  };
  const out = check ? path.join(os.tmpdir(), "three.r187.check.js") : OUT;
  const res = await esbuild.build({
    entryPoints: [ENTRY], bundle: true, format: "iife", minify: true, target: "es2020",
    legalComments: "none", outfile: out, plugins: [plugin], logLevel: "warning",
    banner: { js: `var __cbzScriptUrl=(typeof document!=="undefined"&&document.currentScript&&document.currentScript.src)||"http://localhost/";\n/* three.js r187 (three@${VERSION}, MIT, Copyright 2010-2026 Three.js Authors) as ONE classic script: window.THREE = 'three' + 'three/webgpu' (+ THREE.TSL, the game's addons). Built by tools/three/build.mjs from tools/three/entry.js; patched (see PATCHES there). Do not edit by hand. */` },
    footer: { js: `if(typeof module==="object"&&module&&module.exports)module.exports=globalThis.THREE;` },
    metafile: true,
    // DRACOLoader's default decoder URLs read import.meta.url; the game always
    // sets its own decoder path (src/vendor/draco/), so the script's URL will do
    define: { "import.meta.url": "__cbzScriptUrl" },
  });
  const size = statSync(out).size;
  console.log(`${path.relative(ROOT, out)}  ${(size / 1024).toFixed(0)} KB`);
  if (check) {
    const same = existsSync(OUT) && readFileSync(OUT, "utf8") === readFileSync(out, "utf8");
    console.log(same ? "check: committed bundle is up to date" : "check: committed bundle DIFFERS from a fresh build");
    process.exit(same ? 0 : 1);
  }
  // the DRACO decoder the r187 DRACOLoader was released with
  for (const f of ["draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"]) {
    copyFileSync(path.join(pkg, "examples/jsm/libs/draco/gltf", f), path.join(ROOT, "src/vendor/draco/gltf", f));
  }
  const inputs = Object.entries(res.metafile.outputs)[0][1].inputs;
  const top = Object.entries(inputs).sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput).slice(0, 8);
  for (const [f, v] of top) console.log(`  ${(v.bytesInOutput / 1024).toFixed(0).padStart(5)} KB  ${f.replace(pkg + "/", "").replace(/^.*\/package\//, "")}`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
