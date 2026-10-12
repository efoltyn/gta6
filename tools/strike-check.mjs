#!/usr/bin/env node
/* tools/strike-check.mjs — ONE TABLE, ONE RESOLVER: every munition class at
   every target class, in plain node (no browser, no THREE).

   Loads the real files in one vm context: weapons/munitiontable.js (the
   table), systems/breach.js (the charge law), units/kit/vehicle.js (the
   armour resolver), every src/units/vehicles/*.js (their REAL armour and
   weapon rows) and systems/strike.js (the resolver). The built world and the
   ground are the only stand-ins: a building record shaped exactly like
   city/buildings.js makeBuilding's (walls whose mesh is one hop from the
   record), parked hardware shaped like island_military.js placeModel's, and
   a recorder where the carve / shaft / gut / collapse verbs would draw.

   It asserts that damage HAPPENED, for:
     ground      sand / snow / concrete: a crater and clods sized by W; a
                 burst in the open touches no building and piles no rubble
     buildings   a wall is carved by the charge; a roof is holed; a bomb guts
                 storeys; a Mk 84 brings an HQ down; a bunker buster bursts
                 INSIDE, storeys down
     vehicles    direct hits by dart, jet, top attack and bomb through each
                 hull's own armour table; near misses by blast (blastOn)
     people      every warhead kills a man inside its lethal ring
     boats, parked aircraft, drones   the hardware strike wrecks them
     aircraft in flight   a proximity burst beside the airframe penetrates
     the swept test       a 23 m step does not tunnel a wall; a bomb passing
                 a building's footprint above its roof does not burst there
     the rows    every unit weapon row names a munition and arms from it; no
                 unit file still carries a copied pen/beh/he for one

   Run: node tools/strike-check.mjs        Exit 0 = PASS. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let checks = 0;
const fails = [];
function ok(c, msg) { checks++; if (!c) fails.push(msg); }
const f1 = (v) => (+v).toFixed(1);

/* ---- the world ------------------------------------------------------------ */
const colliders = [];
const calls = { carve: [], shaft: [], gut: [], play: [], chips: 0 };
const CBZ = {
  CONFIG: {}, onUpdate() {}, game: { mode: "npcwar" }, colliders, platforms: [],
  floorAt: () => 0,
  micro: {
    queryColliders(x, z, r, out) {
      out = out || []; out.length = 0;
      for (const c of colliders) if (c.maxX >= x - r && c.minX <= x + r && c.maxZ >= z - r && c.minZ <= z + r) out.push(c);
      return out;
    },
    segmentHitsCollider(ax, az, bx, bz, pad, hit) {
      const x0 = Math.min(ax, bx) - pad, x1 = Math.max(ax, bx) + pad, z0 = Math.min(az, bz) - pad, z1 = Math.max(az, bz) + pad;
      for (const c of colliders) { if (c.maxX < x0 || c.minX > x1 || c.maxZ < z0 || c.minZ > z1) continue; if (hit(c)) return true; }
      return false;
    },
    removeCollider(c) { const i = colliders.indexOf(c); if (i >= 0) colliders.splice(i, 1); return i >= 0 ? 1 : 0; },
  },
  cityFracture: { blastAt(pt, o) { calls.carve.push({ pt, o }); return {}; } },
  cityCarveShaft(b, x, z, hw, hd, o) { calls.shaft.push({ b, x, z, hw, o }); return 1; },
  collapse: {
    gut(desc, floors, at) { calls.gut.push({ desc, floors, at }); return floors.map((f) => ({ x: desc.ox, y: f.f * 3.2 + 1.6, z: desc.oz, nx: 1, nz: 0, f: f.f })); },
    play(desc, o) { calls.play.push({ desc, o }); if (o && o.onSwap) o.onSwap(); return {}; },
  },
  cityCrashSmoke() {},
  debris: { wreckage() { calls.chips++; } },
};
const sb = { console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, Symbol, Error, Promise, isFinite, setInterval, clearInterval, performance: { now: () => 0 } };
sb.window = sb; sb.CBZ = CBZ;
vm.createContext(sb);
for (const f of ["src/weapons/munitiontable.js", "src/systems/breach.js", "src/units/kit/vehicle.js",
  "src/units/unitkit.js", "src/units/manifest.js", "src/systems/strike.js"]) {
  vm.runInContext(src(f), sb, { filename: f });
}
const MT = CBZ.munitionTable, L = CBZ.blastLaw, S = CBZ.strike, D = CBZ.vehicleDrive;
ok(!!MT && !!L && !!S && !!D, "the table, the law, the resolver and the armour resolver all load in node");
const VDIR = path.join(ROOT, "src/units/vehicles");
for (const f of fs.readdirSync(VDIR).filter((f) => f.endsWith(".js"))) {
  try { vm.runInContext(src("src/units/vehicles/" + f), sb, { filename: f }); }
  catch (e) { ok(false, "unit file " + f + " threw at load: " + e.message); }
}
const unit = (id) => CBZ.unitKit.get(id);

/* ---- the classes ------------------------------------------------------------ */
const CLASSES = {
  "KE dart (120 mm M829A3)": "m829a3", "KE 25 mm APDS": "m791", "HEAT tank round (M830A1)": "m830a1",
  "HE-frag tank round (125 mm)": "3of26", "25 mm HEI": "m792", "30 mm HEDP": "m789", "155 mm M795": "m795",
  "120 mm mortar": "m933", "hand grenade": "m67", "40 mm HEDP": "m433", "RPG PG-7V": "pg7v", "AT4": "at4",
  "TOW-2B": "tow2b", "Javelin": "javelin", "Hellfire K": "agm114k", "Hellfire R": "agm114r", "Hydra M151": "m151",
  "GMLRS": "m31a1", "PAC-3 MSE": "pac3mse", "AIM-120C": "aim120c", "Stinger": "fim92", "Mk 82": "mk82",
  "GBU-12": "gbu12", "GBU-31(V)1 JDAM": "gbu31v1", "BLU-109": "gbu31v3", "SDB": "gbu39", "GBU-28": "gbu28",
  "GBU-57 MOP": "gbu57", "MOAB": "gbu43", "Tomahawk": "tomahawk", "Harpoon": "rgm84", "5 in naval HE": "mk45_he",
  "76 mm naval HE": "oto76_he", "57 mm naval HE": "mk295", "Switchblade 300": "switchblade300",
  "Switchblade 600": "switchblade600", "FPV PG-7VL": "fpv_pg7vl", "FPV OG-7V": "fpv_og7v", "FPV TM-62": "fpv_tm62",
  "drone-dropped VOG-17": "drop_vog17", "Lancet-3": "lancet3", "Shahed-136": "shahed136",
};
for (const k of Object.keys(CLASSES)) ok(!!MT.get(CLASSES[k]), "the table has no row for " + k + " (" + CLASSES[k] + ")");
const HE = Object.values(CLASSES).filter((id) => MT.fx(id).W > 0);

/* ---- 1. the rows ----------------------------------------------------------- */
for (const id of MT.list()) {
  const r = MT.get(id), f = MT.fx(id);
  ok(r.name && r.cls && r.mass > 0, id + ": a row says what it is (name, class, mass)");
  ok(f.pen > 0 || f.W > 0, id + ": it penetrates or it bursts");
  if (r.fill > 0) ok(f.W > 0 && f.R > 0 && f.power > 0, id + ": a fill makes a charge, a radius and a power");
}
ok(Math.abs(MT.W("mk84") - 429 * 1.07) < 1e-6, "Mk 84: 429 kg tritonal x 1.07");
ok(Math.abs(MT.W("m795") - 10.8) < 1e-6, "155 mm M795: 10.8 kg TNT");
ok(MT.fx("javelin").top && MT.fx("tow2b").top, "Javelin and TOW-2B attack the roof");
ok(MT.fx("gbu57").conc > MT.fx("gbu28").conc && MT.fx("gbu28").conc > MT.fx("gbu31v3").conc, "the bunker busters rank by the concrete they go through");
// every unit weapon row: a munition, armed from the table, nothing copied
const DEFS = CBZ.unitKit.ids("vehicle").map(unit);
for (const def of DEFS) {
  for (const w of def.weapons || []) {
    if (w.kind === "mg") continue;
    ok(!!(w.mun || w.heMun), "a " + w.kind + " row names its munition: " + w.id);
    if (!w.mun && !w.heMun) continue;
    ok(!("pen" in w) || w._armed, w.id + " carries no copied pen before arming");
    MT.arm(w);
    ok(w.pen > 0 && w.beh > 0, w.id + " arms from " + (w.mun || w.heMun) + " (pen " + w.pen + ", beh " + w.beh + ")");
    if (w.he) ok(w.he.W > 0 && w.he.blast > 0 && w.he.mun, w.id + "'s blast is its munition's (" + w.he.mun + ")");
  }
}
for (const f of fs.readdirSync(VDIR).filter((f) => f.endsWith(".js"))) {
  ok(!/\bhe:\s*\{\s*pen:/.test(src("src/units/vehicles/" + f)), f + " still types a warhead's numbers (he: { pen: ...)");
}

/* ---- 2. the ground ---------------------------------------------------------- */
for (const surf of ["sand", "snow", "concrete"]) {
  const e25 = MT.ejecta(MT.W("m792"), surf), e84 = MT.ejecta(MT.W("mk84"), surf), e155 = MT.ejecta(MT.W("m795"), surf);
  ok(e25.lump <= 0.05, `${surf}: a 25 mm HEI throws grains, not boulders (lump ${e25.lump.toFixed(3)} m)`);
  ok(e155.digs && e155.craterR > 1.2 && e155.lump < e155.craterR * 0.2, `${surf}: a 155 mm shell digs a ${f1(e155.craterR)} m crater, lumps ${e155.lump.toFixed(2)} m`);
  ok(e84.craterR > 5.5 && e84.lumpN > e25.lumpN && e84.lump > e25.lump * 5, `${surf}: a Mk 84's crater (${f1(e84.craterR)} m) and clods scale with the charge`);
  if (surf === "sand") ok(e84.lump < MT.ejecta(MT.W("mk84"), "concrete").lump, "loose sand breaks into smaller lumps than slab");
}
{
  const evs = [];
  const obs = S.on((ev) => evs.push(ev));
  for (const id of HE) {
    evs.length = 0; calls.carve.length = 0; calls.play.length = 0;
    const r = S(id, { x: 500, y: 0.3, z: 500 }, { by: null });
    ok(evs.length === 1 && evs[0].W > 0 && evs[0].craterR > 0, id + ": the ground is told the charge of a burst on it");
    ok(!r.struck && calls.carve.length === 0 && calls.play.length === 0, id + ": a burst in the open touches no building and piles no rubble");
  }
  S.off(obs);
}

/* ---- 3. buildings ----------------------------------------------------------- */
function building(ox, oz, w, d, storeys) {
  const b = { ox, oz, w, d, storeys, FH: 3.2, h: storeys * 3.2, gy: 0, floorSlabs: [], roofSlab: {}, group: { visible: true }, colliders: [], platforms: [] };
  for (let i = 1; i < storeys; i++) b.floorSlabs.push({});
  // the roof and the floors are platforms, as buildings.js makes them
  for (let i = 1; i <= storeys; i++) { const p = { minX: ox - w / 2, maxX: ox + w / 2, minZ: oz - d / 2, maxZ: oz + d / 2, top: i * 3.2 }; CBZ.platforms.push(p); b.platforms.push(p); }
  const grp = { userData: { bld: b } };
  const wall = (minX, maxX, minZ, maxZ) => { const c = { minX, maxX, minZ, maxZ, y0: 0, y1: b.h, ref: { parent: grp } }; colliders.push(c); b.colliders.push(c); };
  wall(ox - w / 2, ox + w / 2, oz - d / 2, oz - d / 2 + 0.4);
  wall(ox - w / 2, ox + w / 2, oz + d / 2 - 0.4, oz + d / 2);
  wall(ox - w / 2, ox - w / 2 + 0.4, oz - d / 2, oz + d / 2);
  wall(ox + w / 2 - 0.4, ox + w / 2, oz - d / 2, oz + d / 2);
  return b;
}
function reset() { calls.carve.length = 0; calls.shaft.length = 0; calls.gut.length = 0; calls.play.length = 0; }
{
  const hq = building(0, 0, 36, 22, 3);
  reset();
  S("agm114k", { x: 0, y: 4.8, z: -11.4 }, { contact: true, struck: { kind: "collider", c: hq.colliders[0] }, dirx: 0, dirz: 1 });
  ok(calls.carve.length === 1 && calls.carve[0].o.charge === MT.W("agm114k") && calls.carve[0].o.shaped, "a Hellfire on the HQ wall: the wall is carved by its charge and its jet");
  reset();
  S("m830a1", { x: 0, y: 1.6, z: -11.4 }, { contact: true, struck: { kind: "collider" } });
  ok(calls.carve.length === 1, "a 120 mm MPAT on the ops wall: the wall is carved");
  reset();
  S("m792", { x: 0, y: 1.2, z: -11.4 }, { contact: true, struck: { kind: "collider" } });
  ok(calls.carve.length === 1 && calls.play.length === 0, "a 25 mm HEI on a wall: the law is asked (it scars), nothing comes down");
  const barracks = building(100, 0, 40, 12, 2);
  reset();
  S("gbu12", { x: 100, y: 6.4, z: 0 }, {});
  ok(calls.shaft.length >= 1 && calls.shaft[0].o.roof, "a GBU-12 on the barracks roof holes the roof");
  ok(calls.gut.length === 1 && calls.gut[0].floors.length >= 1, "a GBU-12 guts the storey it bursts in (" + (calls.gut[0] ? calls.gut[0].floors.length : 0) + " storeys)");
  ok(calls.play.length === 1 && barracks.group.visible === false, "a 500 lb bomb brings a 2-storey barracks down (its shell falls, the building and its colliders are pulled)");
  const hq2 = building(200, 0, 36, 22, 3);
  reset();
  S("gbu31v1", { x: 200, y: 9.6, z: 0 }, {});
  ok(calls.play.length === 1 && calls.play[0].desc.storeys === 3 && hq2._down, "a Mk 84 JDAM on the HQ brings it down");
  ok(!colliders.some((c) => hq2.colliders.indexOf(c) >= 0), "the fallen HQ's walls no longer stop anything");
  const hq3 = building(300, 0, 36, 22, 3);
  reset();
  S("pg7v", { x: 300, y: 4.8, z: -11.4 }, { contact: true });
  ok(calls.carve.length === 1 && calls.play.length === 0 && !hq3._down, "an RPG holes the wall and the building stands");
  // a bunker buster bursts INSIDE, storeys down
  const tower = building(400, 0, 20, 20, 6);
  reset();
  const rb = S("gbu31v3", { x: 400, y: 19.2, z: 0 }, {});
  ok(rb.inside && rb.inside.floor < 5, "a BLU-109 on a 6-storey roof bursts inside, on storey " + (rb.inside ? rb.inside.floor : "-"));
  ok(calls.shaft.length >= 1 && calls.shaft[0].o.levels.length >= 1, "it holed the slabs it went down through");
  const bunker = building(500, 0, 16, 16, 2);
  reset();
  const rm = S("gbu57", { x: 500, y: 6.4, z: 0 }, {});
  ok(rm.inside && rm.inside.floor === 0 && bunker._down, "a GBU-57 goes to the bottom of a bunker and brings it down");
  ok(!L.hole(MT.W("mk84"), { thick: 3, hint: "rc" }).breach && MT.fx("gbu57").conc > 3, "a surface Mk 84 does not breach 3 m of reinforced concrete; a MOP goes through it");
}

/* ---- 4. vehicles: direct hits through each hull's own armour ---------------- */
function hit(uid, mun, zone, opts) {
  const def = unit(uid), f = MT.fx(mun), S0 = def.stats;
  const vs = { hp: S0.hp, maxHp: S0.hp, mobility: false, firepower: false, burning: false, wreck: false };
  const th = opts && opts.blast != null
    ? Object.assign({ he: true, cls: "blast" }, MT.blastOn(f.W, opts.blast) || { pen: 0, beh: 0 })
    : { pen: f.pen, beh: f.beh, he: f.W > 0, cls: f.shaped ? "heat" : f.W > 0 ? "he" : "apfsds", top: zone === "top" };
  const res = D.resolve(vs, S0, zone, th, th.beh, () => 0.5);
  return { res, vs };
}
const VT = [
  ["m829a3", "m1_abrams", "front", false], ["m829a3", "m1_abrams", "side", true], ["m829a3", "bradley_ifv", "front", true],
  ["m791", "hmmwv", "side", true], ["m791", "bradley_ifv", "front", false], ["m791", "technical", "side", true],
  ["pg7v", "bradley_ifv", "side", true], ["pg7v", "m1_abrams", "front", false], ["at4", "stryker_apc", "side", true],
  ["tow2b", "m1_abrams", "top", true], ["javelin", "m1_abrams", "top", true], ["switchblade600", "m1_abrams", "top", true],
  ["agm114k", "m1_abrams", "top", true], ["fpv_pg7vl", "bradley_ifv", "top", true], ["drop_rkg3", "hmmwv", "top", true],
  ["lancet3", "m270_mlrs", "top", true], ["m789", "m35_truck", "side", true], ["m789", "m1_abrams", "side", false],
  ["gbu39", "bradley_ifv", "top", true], ["gbu31v3", "m1_abrams", "top", true], ["mk82", "maxxpro_mrap", "top", true],
  ["pac3mse", "ah64_apache", "side", true], ["fim92", "mq9_reaper", "side", true], ["m792", "m35_truck", "side", true],
];
for (const [mun, uid, zone, want] of VT) {
  const { res } = hit(uid, mun, zone);
  ok(!!res.pen === want, `${mun} direct on the ${uid} ${zone} (${(unit(uid).stats.armour || {})[zone]} mm): ${want ? "penetrates" : "stopped"} (pen ${MT.fx(mun).pen})`);
  if (want) ok(res.dmg > 0, `${mun} into the ${uid} does damage behind the plate`);
}
// near misses: the blast's loading on the plate
const BT = [
  ["mk84", "m1_abrams", "side", 8, true], ["mk84", "m1_abrams", "side", 30, false], ["m795", "hmmwv", "side", 3, true],
  ["m795", "m1_abrams", "side", 3, false], ["m792", "bradley_ifv", "side", 1, false], ["mk82", "bradley_ifv", "side", 6, true],
  ["m31a1", "fmtv", "side", 8, true], ["shahed136", "m35_truck", "side", 10, true], ["fpv_tm62", "bradley_ifv", "top", 0.5, true],
  ["aim120c", "f35", "side", 4, true], ["aim120c", "ah64_apache", "side", 4, true], ["m795", "mq9_reaper", "side", 6, true],
];
for (const [mun, uid, zone, d, want] of BT) {
  const { res } = hit(uid, mun, zone, { blast: d });
  ok(!!res.pen === want, `${mun} bursting ${d} m from the ${uid} (${zone} ${(unit(uid).stats.armour || {})[zone]} mm): ${want ? "gets through" : "does not"}`);
}

/* ---- 5. people --------------------------------------------------------------- */
// physics.js blastBodies: damage 420 x power x (0.55 / Z)^2 (src/battle/physics.js BLAST_DMG)
const BLAST_DMG = +(/const BLAST_DMG = (\d+)/.exec(src("src/battle/physics.js")) || [0, 0])[1];
ok(BLAST_DMG > 0, "physics.js's blast damage constant is readable");
for (const id of HE) {
  const f = MT.fx(id), killR = f.R * 0.55, dmg = BLAST_DMG * f.power;
  ok(dmg >= 160, `${id}: a soldier at ${f1(killR)} m takes ${Math.round(dmg)} (> the hardest man's 160 hp)`);
}

/* ---- 6. hardware: parked aircraft, a boat, a drone on the ground ------------ */
function parked(kind, x, z, w, l, h) {
  const g = { userData: { milKind: kind }, traverse() {}, position: { y: 0 }, rotation: { x: 0, z: 0 } };
  const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - l / 2, maxZ: z + l / 2, y0: 0, y1: h, ref: g };
  colliders.push(c);
  return { g, c };
}
const HW = [
  ["gbu39", "plane", 1000, 3], ["m31a1", "heli", 1100, 5], ["mk82", "plane", 1200, 15], ["m795", "truck", 1300, 4],
  ["rgm84", "boat", 1400, 0], ["mk45_he", "boat", 1500, 1], ["fpv_og7v", "drone", 1600, 0.5], ["switchblade300", "plane", 1700, 0.3],
];
for (const [mun, kind, x, d] of HW) {
  const p = parked(kind, x, 0, 10, 14, 4);
  S.hardware({ x: x, y: 1, z: -7 - d }, MT.W(mun), S.numbers(mun), {});
  S.hardware({ x: x, y: 1, z: -7 - d }, MT.W(mun), S.numbers(mun), {});
  ok(p.g.userData.wrecked || (p.g.userData.strikeHp != null && p.g.userData.strikeHp < S.SKIN[kind].hp),
    `${mun} ${d} m from a parked ${kind}: it is ${p.g.userData.wrecked ? "wrecked" : "damaged"}`);
  if (["gbu39", "m31a1", "mk82", "rgm84"].indexOf(mun) >= 0) ok(p.g.userData.wrecked, `${mun} wrecks the parked ${kind}`);
}
{
  const p = parked("plane", 2000, 0, 10, 14, 4);
  S.hardware({ x: 2000, y: 1, z: -7 - 60 }, MT.W("m792"), S.numbers("m792"), {});
  ok(!p.g.userData.wrecked && p.g.userData.strikeHp == null, "a 25 mm burst 60 m away does not touch a parked jet");
}

/* ---- 7. the swept test --------------------------------------------------------- */
{
  colliders.length = 0;
  const b = building(0, 0, 20, 20, 3);
  // a 120 mm round makes ~23 m a step: from outside, through the wall, to inside
  const h1 = S.sweep(-30, 1.5, -10.0, -5, 1.5, -10.0, {});
  ok(!!h1 && !h1.ground && h1.x < -9.5 && h1.x > -10.6, "a 25 m step does not tunnel the wall: it stops on its face (x " + (h1 ? f1(h1.x) : "-") + ")");
  // a bomb falling past the building's footprint ABOVE its 9.6 m roof
  const h2 = S.sweep(-5, 40, 0, -4, 30, 0, {});
  ok(!h2, "a bomb falling over the footprint 20 m above the roof does not burst in the air");
  const h3 = S.sweep(-5, 12, 0, -4, 7, 0, {});
  ok(!!h3 && !h3.ground && Math.abs(h3.y - 9.6) < 0.2, "the same bomb strikes the roof at its height (y " + (h3 ? f1(h3.y) : "-") + ")");
  // a band-less collider (a building that registers one box) is as tall as its record
  colliders.push({ minX: 50, maxX: 70, minZ: -10, maxZ: 10, ref: { w: 20, d: 20, h: 12 } });
  ok(!S.sweep(55, 30, 0, 56, 20, 0, {}), "a band-less building is as tall as its record (12 m), not infinitely tall");
  ok(!!S.sweep(55, 13, 0, 56, 8, 0, {}), "...and stops a bomb at its roof");
  const hg = S.sweep(100, 5, 0, 130, -5, 0, { groundAt: () => 0 });
  ok(!!hg && hg.ground && Math.abs(hg.x - 115) < 0.2, "the ground is found on the segment, not at its end (x " + (hg ? f1(hg.x) : "-") + ")");
  void b;
}

console.log("strike-check: " + Object.keys(CLASSES).length + " munition classes, " + MT.list().length + " table rows");
if (fails.length) { console.log("STRIKE-CHECK: FAIL (" + fails.length + "/" + checks + ")"); for (const f of fails) console.log("  - " + f); process.exit(1); }
console.log("STRIKE-CHECK: PASS (" + checks + " checks)");
