/* tools/lazy-canvas-check.js — plain node: core/texfree.js's lazy canvas
   textures paint on the first image read (the upload), give the canvas back
   after it (onUpdate), repaint on a later read, and freeCanvasAfterUpload
   shrinks a painted canvas once uploaded.   node tools/lazy-canvas-check.js */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
let made = 0;
function Canvas() { made++; this.width = 300; this.height = 150; this.painted = 0; }
Canvas.prototype.getContext = function () { const c = this; return { fillRect: function () { c.painted++; } }; };
const ctx = { console, Math, Float32Array, Uint16Array, Uint32Array, Int8Array, Uint8Array, Int16Array, Int32Array, Uint8ClampedArray, Float64Array, ArrayBuffer, Map, Set, WeakMap, WeakSet, WeakRef, Symbol, Object, Array, JSON, Number, String, Error, Reflect, Proxy,
  performance: { now: () => 0 }, setInterval: () => 0, document: { createElement: () => new Canvas() } };
ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(R("src/vendor/three.r128.min.js"), ctx);
ctx.CBZ = { CONFIG: {} };
vm.runInContext(R("src/core/texfree.js"), ctx);
const { CBZ } = ctx;
let paints = 0;
const t = CBZ.lazyCanvasTexture(64, 32, function (g, c) { paints++; g.fillRect(0, 0, 64, 32); });
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
if (made !== 0 || paints !== 0) fail("painted before any read");
if (t.version !== 1) fail("not flagged for upload: version " + t.version);
const a = t.image;
if (paints !== 1 || a.width !== 64 || a.height !== 32 || a.painted !== 1) fail("first read did not paint the right canvas");
if (t.image !== a || paints !== 1) fail("second read repainted");
t.onUpdate(t);                                     // three, after the upload
const b = t.image;
if (b === a || paints !== 2) fail("read after upload did not repaint");
const e = CBZ.lazyCanvasTexture(8, 8, function () { paints++; }, { eager: true });
if (paints !== 3) fail("eager did not paint at once");
e._cbzRelease(); void e.image; if (paints !== 4) fail("release + read did not repaint");
const k = CBZ.lazyCanvasTexture(8, 8, function () {}, { keep: true });
if (k.onUpdate) fail("keep texture frees itself");
const cl = t.clone(); if (!cl.image || cl.image.width !== 64) fail("clone lost the picture");
const cv = new Canvas(); cv.width = 1024; cv.height = 1024;
const ft = CBZ.freeCanvasAfterUpload(new ctx.THREE.CanvasTexture(cv));
ft.onUpdate(ft);
if (cv.width !== 1 || !ft._cbzFreed) fail("freeCanvasAfterUpload kept the canvas");
console.log("OK lazy canvas textures: paint on first read, released after upload, repaint on demand; free-after-upload shrinks");
