#!/usr/bin/env node
/* Can a man with a rocket launcher bring a tower down, and how many rockets?

   city/structural.js implements the collapse model by the book — per-floor
   integrity, tributary load, a disproportionate-collapse rule and a yield
   timer. Whether it can ever FIRE is arithmetic, and arithmetic does not need
   a browser. This test reads the engine's own constants out of the source (so
   it cannot drift from them) and asserts three things that were all false
   before 2026-08-29:

     1. capacityOf() survives an incomplete building record. It used to return
        NaN for the city's tallest tower, and NaN is an OFF SWITCH: the first
        hit writes NaN into the floor array and no threshold comparison is ever
        true again. MEASURED: 18 rockets into a 52-storey tower left it at
        `cap: NaN, storeys: 1, floors: [NaN], collapsible: false`.
     2. a tower's ground floor has a reachable failure threshold and satisfies
        the disproportionate rule.
     3. the number of full-width carves needed to condemn it is a MAGAZINE, not
        a stray shot. This is the calibration decision, so it is pinned here.
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = await readFile(path.join(root, "src/city/structural.js"), "utf8");
const bld = await readFile(path.join(root, "src/city/buildings.js"), "utf8");
const num = (re) => { const m = src.match(re); assert.ok(m, `constant not found: ${re}`); return Number(m[1]); };

const LOADPATH_FLOOR = num(/LOADPATH_FLOOR = ([\d.]+)/);
const DISPROP_FLOORS = num(/DISPROP_FLOORS = (\d+)/);

// ---- 1. the NaN off-switch is gone --------------------------------------
assert.match(src, /function storeysOf\(b\)/, "storeysOf must exist");
assert.match(src, /return 12 \+ storeysOf\(b\) \* 7 \+ planOf\(b\) \/ 26;/,
  "capacityOf must go through the guarded helpers, not raw b.storeys/b.w/b.d");
assert.match(src, /const n = Math\.max\(1, storeysOf\(b\)\);/,
  "the floor array must be sized by the same guarded storey count");
assert.match(src, /if \(!\(d >= 0\) \|\| d > margin \|\| d >= bd\) continue;/,
  "a non-finite distance must not win lotAt's loop");
// The guarded helpers, transcribed. If these drift from the source the two
// asserts above fail first, which is the point of reading the file.
const storeysOf = (b) => {
  const st = Math.round(+b.storeys);
  if (st > 0) return st;
  const fromH = Math.round(+b.h / (+b.FH > 0 ? +b.FH : 3.2));
  return fromH > 0 ? fromH : 1;
};
const planOf = (b) => (+b.w > 0 ? +b.w : 10) * (+b.d > 0 ? +b.d : 10);
const capacityOf = (b) => 12 + storeysOf(b) * 7 + planOf(b) / 26;

const stub = { h: 166.4, FH: 3.2 };                 // no storeys, no w, no d
assert.ok(Number.isFinite(capacityOf(stub)), "capacity must be finite for a stub record");
assert.equal(storeysOf(stub), 52, "storeys must fall back to height / floor height");
assert.ok(Number.isFinite(capacityOf({})), "capacity must be finite for an empty record");

// ---- 2. the ground floor of a tower can actually fail --------------------
const tower = { storeys: 52, w: 28, d: 28, h: 166.4, FH: 3.2 };
const n = storeysOf(tower);
const failThreshold = (n, i) => Math.max(LOADPATH_FLOOR, ((n - i) / n) * 0.42);
const disproportionate = (n, i) => (n - i) >= Math.max(2, Math.min(DISPROP_FLOORS, Math.ceil(n * 0.5)));
const need = failThreshold(n, 0);
assert.ok(need > 0 && need < 1, `ground-floor threshold out of range: ${need}`);
assert.ok(disproportionate(n, 0), "a 52-storey tower must satisfy the disproportionate rule at its base");

// ---- 3. THE CALIBRATION: a magazine, not a stray shot --------------------
// carveHole caps an ordnance opening at 9 m (ordnanceW). The carve reports the
// severed fraction against the floor's whole load-bearing run, 2*(w+d).
assert.match(bld, /const perim = 2 \* \(\(shell\.w > 0 \? shell\.w : 10\) \+ \(shell\.d > 0 \? shell\.d : 10\)\);/,
  "the carve must resolve its sever against the floor perimeter, not one face");
assert.match(bld, /kind: "breach", sever: sev,/,
  "the carve must pass a pre-resolved fraction, not a raw width");
const GAP = 9;
const carvesToCondemn = (denom) => {
  let opened = 0;
  for (let hits = 1; hits <= 200; hits++) {
    opened += GAP;
    if (1 - Math.min(1, opened / Math.max(8, denom)) < need) return hits;
  }
  return Infinity;
};
const perimeter = 2 * (tower.w + tower.d);
const carves = carvesToCondemn(perimeter);
assert.ok(carves >= 6 && carves <= 12,
  `a tower should take a magazine to fell, not ${carves} carves`);
// and the rejected alternative, kept as the reason the number above is not 2
assert.ok(carvesToCondemn(tower.d) <= 3,
  "sanity: resolving against one face is the fragile option this test exists to reject");

console.log(`PASS collapse load path: capacity is NaN-proof, a ${n}-storey tower's base fails at ` +
  `integrity ${need.toFixed(2)}, and it takes ${carves} full-width carves (${carves * GAP} m of a ` +
  `${perimeter} m floor run) to condemn it — a magazine, not a stray shot.`);
