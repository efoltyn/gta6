#!/usr/bin/env node
/* tools/airframe-sketch.mjs — look at an airframe WITHOUT a browser.

   Builds a type in plain node (vendored three r128) and software-rasterises
   it (z-buffer, Lambert on face normals, colour by material key) into one
   PNG with four views: side, top, front, and a three-quarter. Seconds, a few
   MB of memory, no GPU, no Chrome.

   USAGE  node tools/airframe-sketch.mjs <type> [out.png] [--variant v]
          [--gear up] [--door 1] [--flap 1] [--cut]   (--cut drops the
          starboard half so you see into the cabin)
   types: narrowbody widebody turboprop bizjet single heli */
import fs from "fs";
import vm from "vm";
import zlib from "zlib";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const args = process.argv.slice(2);
const type = args[0] || "narrowbody";
const out = args[1] && !args[1].startsWith("--") ? args[1] : "/tmp/airframe-" + type + ".png";
const opt = function (k, d) { const i = args.indexOf("--" + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "1") : d; };
const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Set, Map, WeakMap, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Float64Array, ArrayBuffer, Symbol, Error, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Proxy, Reflect, Promise, setTimeout, clearTimeout };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.document = { createElement() { return { getContext() { return null; }, style: {} }; } };
vm.createContext(ctx);
const load = function (r) { vm.runInContext(fs.readFileSync(ROOT + "/" + r, "utf8"), ctx, { filename: r }); };
load("src/vendor/three.r128.min.js");
const THREE = ctx.THREE;
ctx.CBZ = { CONFIG: {}, game: {}, cmat(c) { return new THREE.MeshLambertMaterial({ color: c }); }, onUpdate() {} };
load("src/city/airframe_kit.js");
load("src/city/airframes.js");
const AF = ctx.CBZ.airframes;
const g = AF.build(type, { variant: opt("variant", "civil"), livery: 0x1f4f9a });
if (opt("gear") === "up") AF.poseGear(g, 0);
if (opt("door")) for (const id of Object.keys(AF.rig(g).doors)) AF.poseDoor(g, id, +opt("door"));
if (opt("flap")) for (let i = 0; i < 60; i++) AF.animate(g, { flap: +opt("flap"), ail: 1, elev: 1, rud: 1, power: 0 }, 0.1);
// show the near tier (holes), hide far; interior on
const rig = AF.rig(g);
for (const m of rig.far) m.visible = false;
for (const m of rig.near) m.visible = true;
for (const m of rig.int) m.visible = true;
if (rig.strobe) rig.strobe.visible = true;
g.updateMatrixWorld(true);
const COL = { paint: [236, 238, 241], belly: [190, 196, 204], accent: [31, 79, 154], accent2: [15, 36, 70], metal: [168, 175, 184], bare: [220, 222, 226],
  dark: [40, 42, 46], inlet: [14, 15, 18], tire: [30, 30, 32], glass: [40, 70, 95], liner: [220, 222, 224], floor: [70, 78, 90], fabric: [50, 66, 100],
  leather: [205, 187, 156], cover: [236, 238, 239], shell: [140, 148, 158], panel: [45, 48, 54], wood: [95, 64, 42], screen: [30, 70, 110], clight: [255, 240, 210],
  blade: [45, 50, 56], navR: [255, 40, 30], navG: [30, 255, 70], navW: [250, 250, 255], strobe: [255, 255, 255], beacon: [255, 30, 20], land: [255, 246, 224], blur: null };
// collect world triangles
const T = [];
const cut = !!opt("cut");
g.traverse(function (o) {
  if (!o.isMesh) return;
  let p = o; while (p) { if (p.visible === false) return; p = p.parent; }
  const c = COL[o.userData.mk]; if (c === null) return;
  const col = c || [255, 0, 255];
  const geo = o.geometry, pos = geo.attributes.position, idx = geo.index ? geo.index.array : null;
  const n = idx ? idx.length : pos.count;
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < n; i += 3) {
    for (let k = 0; k < 3; k++) { const j = idx ? idx[i + k] : i + k; v[k].fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld); }
    if (cut && (v[0].x < -0.05 && v[1].x < -0.05 && v[2].x < -0.05)) continue;
    T.push([v[0].x, v[0].y, v[0].z, v[1].x, v[1].y, v[1].z, v[2].x, v[2].y, v[2].z, col]);
  }
});
const W = 1400, Hh = 1000;
const img = new Uint8Array(W * Hh * 3).fill(0);
for (let i = 0; i < W * Hh; i++) { img[i * 3] = 205; img[i * 3 + 1] = 214; img[i * 3 + 2] = 222; }
const zb = new Float32Array(W * Hh).fill(-Infinity);
const bb = new THREE.Box3().setFromObject(g);
const size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
// four viewports: [x0,y0,w,h, view matrix fn]
function view(yaw, pitch) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ")).invert();
  return m;
}
let VIEWS = [
  { r: [0, 0, 700, 500], m: view(HPf(-1), 0), name: "side (port)" },
  { r: [700, 0, 700, 500], m: view(0, -Math.PI / 2 + 0.0001), name: "top" },
  { r: [0, 500, 700, 500], m: view(0, 0), name: "front" },
  { r: [700, 500, 700, 500], m: view(0.75, -0.35), name: "3/4" },
];
function HPf(s) { return s * Math.PI / 2; }
// --view side|top|front|q with --zoom z --at x,y,z : one big viewport
if (opt("view")) {
  const v = VIEWS.find(function (q) { return q.name.indexOf(opt("view")) === 0; }) || VIEWS[0];
  VIEWS = [{ r: [0, 0, W, Hh], m: v.m, name: v.name, zoom: +opt("zoom", "1"), at: opt("at") ? opt("at").split(",").map(Number) : null }];
}
const L = new THREE.Vector3(0.4, 0.8, 0.45).normalize();
const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), nn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
for (const V of VIEWS) {
  const [x0, y0, vw, vh] = V.r;
  // fit
  const rad = Math.max(size.x, size.y, size.z) * 0.55;
  const s = Math.min(vw, vh) / (2 * rad) * 0.95 * (V.zoom || 1);
  const cc = (V.at ? new THREE.Vector3(V.at[0], V.at[1], V.at[2]) : ctr.clone()).applyMatrix4(V.m);
  for (const t of T) {
    va.set(t[0], t[1], t[2]).applyMatrix4(V.m); vb.set(t[3], t[4], t[5]).applyMatrix4(V.m); vc.set(t[6], t[7], t[8]).applyMatrix4(V.m);
    e1.subVectors(vb, va); e2.subVectors(vc, va); nn.crossVectors(e1, e2);
    const wn = new THREE.Vector3().crossVectors(new THREE.Vector3(t[3] - t[0], t[4] - t[1], t[5] - t[2]), new THREE.Vector3(t[6] - t[0], t[7] - t[1], t[8] - t[2])).normalize();
    // two-sided lighting, back faces darker so inverted normals show
    const front = nn.z > 0;
    let lum = Math.abs(wn.dot(L)) * 0.65 + 0.35;
    if (!front) lum *= 0.55;
    const P = [va, vb, vc].map(function (p) { return [x0 + vw / 2 + (p.x - cc.x) * s, y0 + vh / 2 - (p.y - cc.y) * s, p.z]; });
    const minx = Math.max(x0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), maxx = Math.min(x0 + vw - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const miny = Math.max(y0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), maxy = Math.min(y0 + vh - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    const d = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]);
    if (Math.abs(d) < 1e-9) continue;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const a = ((P[1][1] - P[2][1]) * (x - P[2][0]) + (P[2][0] - P[1][0]) * (y - P[2][1])) / d;
      const b = ((P[2][1] - P[0][1]) * (x - P[2][0]) + (P[0][0] - P[2][0]) * (y - P[2][1])) / d;
      const c = 1 - a - b;
      if (a < -0.001 || b < -0.001 || c < -0.001) continue;
      const z = a * P[0][2] + b * P[1][2] + c * P[2][2];
      const k = y * W + x;
      if (z <= zb[k]) continue;
      zb[k] = z;
      img[k * 3] = Math.min(255, t[9][0] * lum); img[k * 3 + 1] = Math.min(255, t[9][1] * lum); img[k * 3 + 2] = Math.min(255, t[9][2] * lum);
    }
  }
}
// PNG encode
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
const raw = Buffer.alloc((W * 3 + 1) * Hh);
for (let y = 0; y < Hh; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(Hh, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log(out + "  (" + T.length + " triangles)");
