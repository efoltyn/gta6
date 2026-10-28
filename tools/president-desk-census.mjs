#!/usr/bin/env node
/* tools/president-desk-census.mjs — NOTHING ON THE PRESIDENT'S DESK FLOATS,
   SINKS OR RUNS INTO ITS NEIGHBOUR. Plain node, the real three r128.

   OWNER (2026-10-28), on the old President page: "Look at the desk itself,
   things are overlapping."

   Builds the Oval Office desk exactly as the game does (city/
   president_office.js buildDeskSet + the folder slots, city/
   president_book.js's briefing book) into a bare desk frame, takes every
   part's box in the desk frame (president_office.js writes them down while
   it builds: DESK PARTS), groups them by the thing they belong to, and
   checks, for the Resolute desk the room builds (city/interior_programs.js
   stateResoluteDesk: top 1.93 x 1.20 at 0.76 m, the leather inlay
   x +-0.60, z -0.21..0.41, 6 mm proud):

     on the desk     every thing lies inside the worktop's edge
     resting         every thing's lowest point is ON a surface: the wood
                     (y 0), the leather (y 0.006), or the blotter / a folder
                     it is declared to lie on; not floating, not sunk
     no overlap      no two things share space (boxes in the desk frame, a
                     2 mm tolerance); the only exceptions are a thing lying
                     ON another (an open folder or the open book on the
                     blotter, folders on the fanned pile)
     one at a time   the open folder and the open book are never both down

   Prints the census table (thing, box, resting on) and the pairs that clash.
   USAGE  node tools/president-desk-census.mjs [-v]      exit 1 on any clash */
import fs from "fs";
import vm from "vm";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const VERBOSE = process.argv.includes("-v");

const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Set, Map, WeakMap, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Uint8ClampedArray, Float64Array, ArrayBuffer, Symbol, Error, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Proxy, Reflect, Promise, setTimeout, clearTimeout };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.addEventListener = function () {}; ctx.removeEventListener = function () {}; ctx.performance = { now: () => Date.now() }; ctx.requestAnimationFrame = function () {};
function ctx2d(c) {
  const base = { canvas: c, getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }, createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }, measureText(t) { return { width: String(t).length * 8 }; }, createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; } };
  return new Proxy(base, { get(t, k) { if (k in t) return t[k]; return function () {}; }, set(t, k, v) { t[k] = v; return true; } });
}
ctx.document = { createElement() { return { width: 300, height: 150, style: {}, getContext() { return this._c || (this._c = ctx2d(this)); }, addEventListener() {} }; }, getElementById() { return null; }, querySelector() { return null; }, body: { appendChild() {}, classList: { contains() { return false; } } }, addEventListener() {} };
vm.createContext(ctx);
function load(rel) { vm.runInContext(fs.readFileSync(ROOT + "/" + rel, "utf8"), ctx, { filename: rel }); }
load("src/vendor/three.r128.min.js");
const THREE = ctx.THREE;
const CBZ = ctx.CBZ = { CONFIG: {}, game: { mode: "city", state: "playing" }, onUpdate() {}, onNewDay() {}, onAlways() {},
  boxGeom(w, h, d) { return new THREE.BoxGeometry(w, h, d); }, hash01(x, z, s) { const v = Math.sin(x * 12.9898 + z * 78.233 + (s || 0) * 0.123) * 43758.5453; return v - Math.floor(v); },
  cmat(c) { return new THREE.MeshLambertMaterial({ color: c }); }, renderer: { capabilities: { getMaxAnisotropy() { return 4; } } } };
CBZ.mat = CBZ.cmat;
load("src/city/president_office.js");
load("src/city/president_book.js");
const PO = CBZ.presidentOffice;

// ---- the Resolute (interior_programs.js stateResoluteDesk), in the desk frame
const TOP = { x0: -0.965, x1: 0.965, z0: -0.6, z1: 0.6 };
const LEATHER = { x0: -0.6, x1: 0.6, z0: -0.21, z1: 0.41, y: 0.006 };
const TOL = 0.002;

const desk = new THREE.Group();
const parts = PO._deskSetInto(desk, 3, false);
// the book: built into the same desk frame through the office's own hook
CBZ.presBook.setSource({ pages() { return ["a", "b"]; }, paint() { return []; }, press() {}, version() { return 0; } });
CBZ.presBook._build();
const bg = CBZ.presBook._groups();
desk.updateMatrixWorld(true);
for (const k of ["closed", "open"]) {
  const grp = bg[k]; if (!grp) continue;
  grp.visible = true;
  const b = new THREE.Box3().setFromObject(grp);
  parts.push({ obj: k === "closed" ? "briefing book" : "open book", min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
}
// the open folder, as the census's own second build (it is never down with the open book)
const withOpen = PO._deskSetInto(new THREE.Group(), 3, true).filter((p) => p.obj === "open folder");
parts.push(...withOpen);

// ---- group by thing
const things = new Map();
for (const p of parts) {
  const t = things.get(p.obj) || { obj: p.obj, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], n: 0 };
  for (let i = 0; i < 3; i++) { t.min[i] = Math.min(t.min[i], p.min[i]); t.max[i] = Math.max(t.max[i], p.max[i]); }
  t.n++;
  things.set(p.obj, t);
}
// what a thing may lie on (and so share space with)
const LIES_ON = { "open folder": ["blotter"], "open book": ["blotter"] };
const NEVER_TOGETHER = [["open folder", "open book"]];
const onLeather = (t) => t.min[0] >= LEATHER.x0 - TOL && t.max[0] <= LEATHER.x1 + TOL && t.min[2] >= LEATHER.z0 - TOL && t.max[2] <= LEATHER.z1 + TOL;
const overLeather = (t) => t.max[0] > LEATHER.x0 && t.min[0] < LEATHER.x1 && t.max[2] > LEATHER.z0 && t.min[2] < LEATHER.z1;

const fails = [];
const rows = [];
for (const t of things.values()) {
  let rest = "?";
  const y0 = t.min[1];
  const sup = LIES_ON[t.obj];
  if (sup) {
    // the support's top under it: the highest of the support's own parts that share its footprint
    let top = -1e9;
    for (const p of parts) if (p.obj === sup[0] && p.max[0] > t.min[0] && p.min[0] < t.max[0] && p.max[2] > t.min[2] && p.min[2] < t.max[2]) top = Math.max(top, p.max[1]);
    rest = Math.abs(y0 - top) <= TOL ? sup[0] : (y0 < top ? "SINKS " : "FLOATS ") + (y0 - top).toFixed(4) + " m (" + sup[0] + ")";
  } else if (t.obj === "folder pile") rest = Math.abs(y0 - 0) <= TOL ? "wood" : Math.abs(y0 - LEATHER.y) <= TOL ? "leather" : "FLOATS " + y0.toFixed(4);
  else if (onLeather(t)) rest = Math.abs(y0 - LEATHER.y) <= TOL ? "leather" : (y0 < LEATHER.y - TOL ? "SINKS " : "FLOATS ") + (y0 - LEATHER.y).toFixed(4) + " m (leather)";
  else if (overLeather(t)) rest = "STRADDLES the leather edge (bottom " + y0.toFixed(4) + ")";
  else rest = Math.abs(y0) <= TOL ? "wood" : (y0 < -TOL ? "SINKS " : "FLOATS ") + y0.toFixed(4) + " m (wood)";
  const inside = t.min[0] >= TOP.x0 - TOL && t.max[0] <= TOP.x1 + TOL && t.min[2] >= TOP.z0 - TOL && t.max[2] <= TOP.z1 + TOL;
  if (/FLOATS|SINKS|STRADDLES/.test(rest)) fails.push(t.obj + ": " + rest);
  if (!inside) fails.push(t.obj + ": off the edge of the desk (" + t.min[0].toFixed(3) + ".." + t.max[0].toFixed(3) + ", z " + t.min[2].toFixed(3) + ".." + t.max[2].toFixed(3) + ")");
  rows.push({ thing: t.obj, parts: t.n, x: t.min[0].toFixed(3) + ".." + t.max[0].toFixed(3), y: t.min[1].toFixed(3) + ".." + t.max[1].toFixed(3), z: t.min[2].toFixed(3) + ".." + t.max[2].toFixed(3), rests: rest });
}
const list = [...things.values()];
let pairs = 0;
for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
  const a = list[i], b = list[j];
  pairs++;
  if ((LIES_ON[a.obj] || []).includes(b.obj) || (LIES_ON[b.obj] || []).includes(a.obj)) continue;
  if (NEVER_TOGETHER.some((p) => (p[0] === a.obj && p[1] === b.obj) || (p[1] === a.obj && p[0] === b.obj))) continue;
  let clash = true;
  for (let k = 0; k < 3; k++) if (a.max[k] <= b.min[k] + TOL || b.max[k] <= a.min[k] + TOL) clash = false;
  if (clash) {
    const gx = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]), gz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
    fails.push(a.obj + " runs into " + b.obj + " (" + (gx * 100).toFixed(1) + " x " + (gz * 100).toFixed(1) + " cm)");
  }
}
console.log("THE PRESIDENT'S DESK — " + list.length + " things, " + parts.length + " parts, " + pairs + " pairs");
for (const r of rows) console.log("  " + r.thing.padEnd(22) + " x " + r.x.padEnd(14) + " z " + r.z.padEnd(14) + " y " + r.y.padEnd(13) + " " + r.rests);
for (const f of fails) console.log("  FAIL " + f);
if (VERBOSE) for (const p of parts) console.log("    part " + p.obj.padEnd(20) + " " + p.min.map((v) => v.toFixed(4)).join(",") + "  ..  " + p.max.map((v) => v.toFixed(4)).join(","));
console.log((fails.length ? "FAIL" : "PASS") + " president-desk-census: " + fails.length + " problems");
process.exit(fails.length ? 1 : 0);
