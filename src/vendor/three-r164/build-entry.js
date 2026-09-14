/* ============================================================
   src/vendor/three-r164/build-entry.js — O3 build source (BUILD-PLAN.md).

   This file is the esbuild ENTRY POINT used to produce
   three.iife.min.js, the classic-script global build the game actually
   loads (index.html). It is not itself loaded by the game — see
   VENDORED.txt for the exact command that turns this into the shipped
   bundle.

   WHY THIS EXISTS: three.js dropped its own prebuilt UMD/global
   (non-module) build years before r164 (examples/js addons ended r147;
   the core non-module build ended not long after). Modern three ships
   ESM only. The legacy game is ~150 classic <script> tags that read/write
   `window.THREE` synchronously and cannot `await import()`. Rather than
   freeze on the last version with an official global build, this entry
   re-exports the real npm `three` package (plus the two addons the game
   actually uses — see grep evidence below) as a plain object, which
   esbuild then bundles into a classic IIFE that assigns `window.THREE`
   itself (see the bottom of this file) — a self-built global build of a
   genuinely modern three, vendored like any other dependency.

   ADDONS INCLUDED, AND WHY ONLY THESE TWO:
   grepping src/ for `THREE.<Identifier>` (81 distinct identifiers found)
   turned up exactly two that live in three/examples/jsm rather than
   three's core: GLTFLoader and DRACOLoader (src/city/playercars.js:991-997,
   guarded with `if (!THREE.GLTFLoader) return`, used to load the Ferrari
   GLTF model assets/cars/ferrari.glb). Everything else the codebase
   touches (BoxGeometry, MeshLambertMaterial, HemisphereLight, ...) is
   core THREE and needs no addon.
   BufferGeometryUtils is DELIBERATELY NOT re-bundled here: the game
   already vendors its own copy at src/vendor/BufferGeometryUtils.js
   (loaded by its own <script> tag, independent of the three version —
   it only touches the stable BufferGeometry/BufferAttribute surface) and
   that file still works unmodified against r164. See that file's own
   tail comment for the one fix O3 made there (a pre-existing detached-
   `this` bug, unrelated to the version bump).
============================================================ */
import * as THREE_NS from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

// `import * as X` namespace objects are spec-frozen (no new own
// properties) once bundled faithfully, so build a fresh plain object
// instead of mutating THREE_NS directly — the flat shape legacy code
// expects (`THREE.BoxGeometry`, `THREE.GLTFLoader`, ... all siblings on
// one global object).
const THREE = Object.assign({}, THREE_NS, { GLTFLoader, DRACOLoader });

// Classic-script contract: assign the global ourselves rather than rely
// on esbuild's --global-name wrapping (which would land the bundle's
// export *object* — {default: THREE} shape — on window, not THREE flat).
// This line is the ENTIRE reason this is an entry point instead of a
// library: it's what makes the output a drop-in replacement for the old
// CDN <script src="three.min.js"> tag.
if (typeof window !== "undefined") window.THREE = THREE;
