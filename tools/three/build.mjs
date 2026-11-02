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
