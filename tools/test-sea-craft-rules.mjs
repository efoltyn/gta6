#!/usr/bin/env node
/* tools/test-sea-craft-rules.mjs — THE SHARK-VS-BOAT TRUTH TABLE.

   Runs src/world/sea_craft.js for real (in a tiny DOM-less shim: the file only
   needs window.CBZ, a handful of THREE constructors and CBZ.onUpdate) and asks
   its OWN exported rules what each shark can do to each hull. Nothing here
   re-derives the rules — CBZ.sharkCanEngulfHull / sharkCanBiteHull /
   sharkRamHull are the code under test, and the ram outcome is read back off
   the record those functions write.

   THE ONE ASSUMPTION, STATED. marine_predation.js measures gape off the
   animal's authored mouth, which needs a browser and a built model; here it is
   the same file's own no-mouth fallback shape, gape = K * bodyLen. K is
   printed for 0.19 (the fallback marine_predation itself uses), 0.22 (the
   assertions) and 0.25, so the sensitivity of the table to that one number is
   visible instead of hidden.

   Run:  node tools/test-sea-craft-rules.mjs
*/
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- the fleet, as water_hulls.js / yachts.js register it -----------------
const HULLS = {
  kayak: { key: "kayak", loa: 4.2, beam: 0.75, draft: 0.18, massT: 0.09, rideAbove: 0.1, deckY: 0.12 },
  jetski: { key: "jetski", loa: 3.3, beam: 1.2, draft: 0.25, massT: 0.35, rideAbove: 0.06, deckY: 0.36 },
  skiff: { key: "skiff", loa: 5.5, beam: 1.9, draft: 0.28, massT: 0.55, rideAbove: 0.08, deckY: 0.35 },
  dinghy: { key: "dinghy", loa: 4.5, beam: 2.0, draft: 0.40, massT: 0.70, rideAbove: 0.04, deckY: 0.12 },
  boat: { key: "boat", loa: 6.2, beam: 2.1, draft: 0.50, massT: 1.60, rideAbove: 0.36, deckY: 0.80 },
  console: { key: "console", loa: 7.5, beam: 2.6, draft: 0.55, massT: 2.20, rideAbove: 0.30, deckY: 0.72 },
  sloop: { key: "sloop", loa: 13.5, beam: 4.0, draft: 2.45, massT: 12, rideAbove: 0.05, deckY: 1.1 },
  cruiser: { key: "cruiser", loa: 14, beam: 4.2, draft: 1.10, massT: 16, rideAbove: 0.05, deckY: 1.2 },
  yacht: { key: "yacht", loa: 34, beam: 7.6, draft: 2.20, massT: 260, rideAbove: 0.05, deckY: 2.3 },
};
const ORDER = ["kayak", "jetski", "skiff", "dinghy", "boat", "console", "sloop", "cruiser", "yacht"];

// ---- the sharks -----------------------------------------------------------
const SHARKS = [
  { id: "bull shark", len: 2.4, speed: 6 },
  { id: "great white", len: 6.0, speed: 8 },
  { id: "megalodon", len: 18.0, speed: 10 },
];

// ============================================================
//  the shim: just enough window for one IIFE
// ============================================================
function V3() { return { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, copy(o) { return this.set(o.x, o.y, o.z); }, applyMatrix4() { return this; } }; }
function loadSeaCraft(gapeK) {
  const CBZ = {};
  const updaters = [];
  CBZ.onUpdate = (order, fn) => updaters.push({ order, fn });
  CBZ.hash01 = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
  CBZ.game = { mode: "sharksim" };
  CBZ.marineHulls = {
    get: (k) => (HULLS[k] ? { key: k, spec: HULLS[k] } : null),
    spec: (k) => HULLS[k] || null,
    specFor: (c) => c._hullSpec || null,
    feel: () => ({ marine: true }),
    build: () => null,
    register: () => null,
  };
  // the three numbers marine_predation.js publishes, with its own formulas
  CBZ.marineBodyLen = (a) => a.len;
  CBZ.marineGape = (a) => a.len * gapeK;
  CBZ.marineTonnes = (a) => 0.014 * Math.pow(a.len, 2.8);
  CBZ.marineBiteableHull = (a, rec) => {
    const s = rec._hullSpec;
    if (!s) return false;
    if (CBZ.marineGape(a) < s.beam) return false;                    // jaws do not span it
    if ((s.massT || 0) > CBZ.marineTonnes(a) * 1.4) return false;    // cannot move it
    return true;
  };

  const THREE = {
    Vector3: function () { return V3(); },
    Euler: function () { return { set() { return this; } }; },
    Quaternion: function () { return {}; },
    Box3: function () { return { min: V3(), max: V3(), setFromObject() { return this; } }; },
    MeshLambertMaterial: function () { return {}; },
    BoxGeometry: function () { return {}; },
    Mesh: function () { return { position: V3(), rotation: { set() {} } }; },
    Group: function () { return {}; },
    DoubleSide: 2,
  };
  const win = { CBZ, THREE };
  const ctx = vm.createContext({ window: win, Math, Number, Date, console, Array, Object, isFinite });
  const src = fs.readFileSync(path.join(ROOT, "src/world/sea_craft.js"), "utf8");
  vm.runInContext(src, ctx, { filename: "sea_craft.js" });
  return CBZ;
}

// a record shaped the way sea_craft's own spawn() shapes one
function makeRec(key) {
  const s = HULLS[key];
  return {
    kind: "craft", key, _seaCraft: true, _hullSpec: s,
    pos: { x: 0, y: 0, z: 0 },
    group: { position: { x: 0, y: 0, z: 0, set() {} }, quaternion: { setFromEuler() {} }, updateMatrixWorld() {}, add() {}, worldToLocal(v) { return v; } },
    heading: 0, v: 0, vx: 0, vz: 0, crew: [], dead: false, _ramCd: 0, _heel: 0, _heelV: 0,
    hp: 120 + s.massT * 40, maxHp: 120 + s.massT * 40,
  };
}
function makeShark(row) {
  return { id: row.id, len: row.len, pos: { x: -3, y: 0, z: 0 }, heading: 0, speed: row.speed, species: { id: row.id } };
}

// ---- the verb one shark has against one hull ------------------------------
function verb(CBZ, shark, key) {
  const rec = makeRec(key);
  if (CBZ.sharkCanEngulfHull(shark, rec)) return "EAT";
  if (CBZ.sharkCanBiteHull(shark, rec)) return "BITE";
  // the ram is the fallback verb — run it for real and read the outcome
  const r = makeRec(key);
  let hits = 0, flipped = false;
  for (let i = 0; i < 4 && !flipped; i++) {
    r._ramCd = 0;
    CBZ.sharkRamHull(shark, r, { from: "ram", speed: shark.speed });
    hits++;
    flipped = !!r._capsized;
  }
  return flipped ? (hits === 1 ? "TIP" : "TIP x" + hits) : "ROCK";
}

function table(CBZ, gapeK) {
  const w = 11;
  const pad = (s, n) => String(s).padEnd(n);
  const lines = [];
  lines.push("  gape = " + gapeK.toFixed(2) + " x body length");
  lines.push("  " + pad("hull", 10) + pad("loa", 7) + pad("beam", 7) + pad("t", 7) +
    SHARKS.map((s) => pad(s.id, w)).join(""));
  for (const key of ORDER) {
    const h = HULLS[key];
    lines.push("  " + pad(key, 10) + pad(h.loa, 7) + pad(h.beam, 7) + pad(h.massT, 7) +
      SHARKS.map((s) => pad(verb(CBZ, makeShark(s), key), w)).join(""));
  }
  return lines.join("\n");
}

// ============================================================
let fails = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + " -> " + got + (ok ? "" : "   (expected " + want + ")"));
}

console.log("SHARK vs BOAT — the rules in src/world/sea_craft.js, run\n");
for (const k of [0.19, 0.22, 0.25]) {
  const CBZ = loadSeaCraft(k);
  console.log(table(CBZ, k));
  console.log("");
}
console.log("  EAT = the whole hull goes in the mouth   BITE = a chunk comes off");
console.log("  TIP = one ram puts her over (xN = it took N)   ROCK = she does not go over on a pass\n");

const CBZ = loadSeaCraft(0.22);
const bull = makeShark(SHARKS[0]), white = makeShark(SHARKS[1]), meg = makeShark(SHARKS[2]);

console.log("ASSERTIONS (gape = 0.22 x body length)\n");
console.log(" a 2.4 m bull shark eats nothing and bites nothing. The one hull it can put");
console.log(" over is a sea kayak — which is exactly the verb this mode opens with.");
check("bull  vs kayak", verb(CBZ, bull, "kayak"), "TIP");
check("bull  vs jetski", verb(CBZ, bull, "jetski"), "ROCK");
check("bull  vs skiff", verb(CBZ, bull, "skiff"), "ROCK");
check("bull  vs cruiser", verb(CBZ, bull, "cruiser"), "ROCK");

console.log("\n a 6 m great white takes a piece out of the two hulls its jaws span, rolls the");
console.log(" open boats it cannot bite, and merely shoulders a speedboat (13.4 kN.m of");
console.log(" righting against 12.4 of moment: two or three passes, not one)");
check("white vs kayak", verb(CBZ, white, "kayak"), "BITE");
check("white vs jetski", verb(CBZ, white, "jetski"), "BITE");
check("white vs skiff", verb(CBZ, white, "skiff"), "TIP");
check("white vs dinghy", verb(CBZ, white, "dinghy"), "TIP");
check("white vs boat", verb(CBZ, white, "boat"), "ROCK");
check("white vs cruiser", verb(CBZ, white, "cruiser"), "ROCK");

console.log("\n an 18 m megalodon swallows every small boat whole up to a 7.5 m centre");
console.log(" console, rolls a 14 m cruiser it cannot get its jaws round, and a 34 m");
console.log(" yacht is scenery to it. No gate says any of that; the dimensions do.");
check("meg   vs kayak", verb(CBZ, meg, "kayak"), "EAT");
check("meg   vs jetski", verb(CBZ, meg, "jetski"), "EAT");
check("meg   vs skiff", verb(CBZ, meg, "skiff"), "EAT");
check("meg   vs dinghy", verb(CBZ, meg, "dinghy"), "EAT");
check("meg   vs boat", verb(CBZ, meg, "boat"), "EAT");
check("meg   vs console", verb(CBZ, meg, "console"), "EAT");
check("meg   vs sloop", verb(CBZ, meg, "sloop"), "TIP");
check("meg   vs cruiser", verb(CBZ, meg, "cruiser"), "TIP");
check("meg   vs yacht", verb(CBZ, meg, "yacht"), "ROCK");
console.log("\n (a cruiser's 4.2 m beam sits just outside a megalodon's jaws at K = 0.22 and");
console.log("  just inside them at K = 0.25 — the third table above shows it flipping to");
console.log("  BITE. The live game measures the authored mouth, so which one it is is a");
console.log("  fact about the model, not about this rule.)\n");

console.log("\nTHE TIP, AS A MOMENT (kN.m against the hull's own righting moment)\n");
for (const s of SHARKS) {
  const t = 0.014 * Math.pow(s.len, 2.8);
  for (const key of ["kayak", "jetski", "skiff", "boat", "cruiser", "yacht"]) {
    const h = HULLS[key];
    const st = CBZ.hullStabSpec(h);
    const m = t * s.speed * (h.beam / 2);
    const right = h.massT * 9.81 * st.gm * Math.sin(st.phiV);
    if (key === "kayak") console.log("  " + s.id + " (" + t.toFixed(2) + " t at " + s.speed + " m/s)");
    console.log("    " + String(key).padEnd(9) + " moment " + m.toFixed(2).padStart(8) +
      "   righting " + right.toFixed(2).padStart(8) + "   " + (m > right ? "OVER SHE GOES" : "she rights"));
  }
}

console.log("\n" + (fails ? fails + " FAILED" : "all assertions passed"));
process.exit(fails ? 1 : 0);
