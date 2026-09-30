/* tools/tint-check.js — plain node: world/materials.js's one recolour path.
   CBZ.paintMesh gives a mesh the SHARED twin of its material in a colour
   (same twin for every mesh asking that colour off an equal material), never
   writes into a _shared material, keys maps/emissive so a textured or glossy
   source keeps its look, and CBZ.ownMaterial is the copy-on-write for writers
   that must mutate in place.   node tools/tint-check.js */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
function Canvas() { this.width = 1; this.height = 1; }
Canvas.prototype.getContext = function () { return new Proxy({}, { get: () => function () { return { addColorStop() {} }; } }); };
const ctx = { console, Math, Float32Array, Uint16Array, Uint32Array, Int8Array, Uint8Array, Int16Array, Int32Array, Uint8ClampedArray, Float64Array, ArrayBuffer, Map, Set, WeakMap, WeakSet, WeakRef, Symbol, Object, Array, JSON, Number, String, Error, Reflect, Proxy,
  performance: { now: () => 0 }, setInterval: () => 0, setTimeout: () => 0, document: { createElement: () => new Canvas() } };
ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(R("src/vendor/three.r128.min.js"), ctx);
ctx.CBZ = { CONFIG: {}, scene: new ctx.THREE.Scene(), onAlways() {}, on() {}, onFrame() {} };
vm.runInContext(R("src/world/materials.js"), ctx);
const { CBZ, THREE } = ctx;
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const shared = CBZ.cmat(0x808080);
const a = new THREE.Mesh(new THREE.BoxGeometry(), shared), b = new THREE.Mesh(new THREE.BoxGeometry(), shared);
CBZ.paintMesh(a, 0xff0000); CBZ.paintMesh(b, 0xff0000);
if (shared.color.getHex() !== 0x808080) fail("painted INTO the shared cmat");
if (a.material !== b.material) fail("two equal paints did not share one tint");
if (!a.material._shared || a.material.color.getHex() !== 0xff0000) fail("tint not shared / wrong colour");
const before = CBZ.tintStats().tints;
CBZ.paintMesh(a, 0x00ff00); CBZ.paintMesh(a, 0xff0000);
if (a.material !== b.material) fail("repaint back did not land on the same tint");
if (CBZ.tintStats().tints !== before + 1) fail("tint cache grew more than one entry: " + CBZ.tintStats().tints);
const priv = CBZ.mat(0x333333);            // a private material (e.g. a head)
const c = new THREE.Mesh(new THREE.BoxGeometry(), priv);
CBZ.paintMesh(c, 0xff0000);
if (c.material !== a.material) fail("an equal private source did not share the tint");
if (priv.color.getHex() !== 0x333333) fail("private source mutated");
const glossy = CBZ.mat(0x111111, { emissive: 0x3a3f4c, ei: 0.4 });
const d = new THREE.Mesh(new THREE.BoxGeometry(), glossy);
CBZ.paintMesh(d, 0xff0000);
if (d.material === a.material || d.material.emissive.getHex() !== 0x3a3f4c || d.material.emissiveIntensity !== 0.4) fail("emissive not part of the key");
const tex = new THREE.Texture();
const mapped = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex });
const e = new THREE.Mesh(new THREE.BoxGeometry(), mapped);
CBZ.paintMesh(e, 0xff0000);
if (e.material === a.material || e.material.map !== tex) fail("map not part of the key");
const inky = CBZ.mat(0x222222); inky.userData = { cbzInk: "x" };
const f = new THREE.Mesh(new THREE.BoxGeometry(), inky);
CBZ.paintMesh(f, 0xff0000);
if (f.material !== inky || inky.color.getHex() !== 0xff0000) fail("private keyless material not painted in place");
const own = CBZ.ownMaterial(a);
if (own === b.material || own._shared || a.material !== own) fail("ownMaterial did not copy a shared material");
own.emissive.setHex(0xffffff);
if (b.material.emissive.getHex() !== 0) fail("ownMaterial write bled onto the shared tint");
if (CBZ.ownMaterial(a) !== own) fail("ownMaterial copied an already-private material");
console.log("OK tints: equal paints share one material, shared sources untouched, emissive/map keyed, keyless privates painted in place, ownMaterial copy-on-write");
