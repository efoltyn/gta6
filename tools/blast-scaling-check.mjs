#!/usr/bin/env node
/* tools/blast-scaling-check.mjs — THE CHARGE LAW, asserted in plain node.

   What an explosive does to a building is derived from ONE number, the charge
   W (kg TNT-equivalent), by systems/breach.js's law (Hopkinson-Cranz scaled
   distance for glass / gut / frame, the FM 5-250 breaching radius for the
   wall). This check loads the real files in a VM — no browser, no THREE —
   and asserts the outcome of every ordnance row:

     * RPG: a ragged 0.4-0.8 m hole through a facade; never guts, never
       severs, never collapses anything (ledger integration below).
     * grenade: never breaches a 0.3 m concrete wall, contact or thrown.
     * tank HE: a 1.4-2.0 m breach through a facade; no gut.
     * Hellfire / 227 mm / Mk-82 / Mk-84: gut a storey; Mk-84 severs a
       lot-sized frame and brings a 4-storey block down.
     * craters: apparent radius 0.8 W^(1/3); nothing under W ~6.6 kg digs.
     * C4 doctrine falls out of the law: 2 lb mousehole, 5 lb one man.
     * a prop-sized band-less collider is never a wall (props-are-not-walls).
     * every chemical row in systems/impactbus.js carries a charge.

   Run: node tools/blast-scaling-check.mjs      Exit 0 = PASS.            */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(ROOT, p), "utf8");
const fails = [];
let checks = 0;
function ok(cond, msg) { checks++; if (!cond) fails.push(msg); }
const f2 = (v) => (+v).toFixed(2);

// ---- a minimal world: CBZ on a fake window, an update bus that never ticks --
const CBZ = { CONFIG: { CITY_DEMOLITION: true, COLLAPSE_V2: true }, onUpdate() {}, game: { mode: "city" } };
const ctx = vm.createContext({ window: { CBZ }, CBZ, console, Math, performance: { now: () => 0 },
  Map, Set, Float32Array, Object, Array, JSON, Number, isFinite, Date });
vm.runInContext(src("src/systems/breach.js"), ctx, { filename: "breach.js" });
const L = CBZ.blastLaw;
ok(!!L, "systems/breach.js did not publish CBZ.blastLaw");

// ---- 1. walls -------------------------------------------------------------
const FACADE = { thick: 0.4 };                       // buildings.js WT
const rpg = L.hole(0.7, { thick: 0.4, shaped: true, jetPen: 1.5, standoff: 0 });
ok(rpg.breach && 2 * rpg.r >= 0.4 && 2 * rpg.r <= 0.8, `RPG hole through a 0.4 m facade should be 0.4-0.8 m, got ${f2(2 * rpg.r)}`);
const rpgThick = L.hole(0.7, { thick: 0.6, shaped: true, jetPen: 1.5 });
ok(rpgThick.breach && 2 * rpgThick.r <= 0.8, `RPG jet still perforates 0.6 m with a small hole, got ${f2(2 * rpgThick.r)}`);
const rpgPier = L.hole(0.7, { thick: 2.0, shaped: true, jetPen: 1.5 });
ok(!rpgPier.breach, "an RPG must not perforate a 2 m pier (jet 1.5 m)");
const rpgStand = L.hole(0.7, { thick: 0.4, shaped: true, jetPen: 1.5, standoff: 3 });
ok(!rpgStand.jet, "a shaped charge that went off 3 m short is not a jet");

for (const t of [0.2, 0.3]) {
  const gc = L.hole(0.2, { thick: t, hint: "concrete", standoff: 0 });
  ok(!gc.breach || t < 0.3, `grenade in CONTACT must not breach ${t} m concrete`);
}
ok(!L.hole(0.2, { thick: 0.3, hint: "concrete" }).breach, "grenade must never breach a 0.3 m concrete wall");
ok(!L.hole(0.2, { thick: 0.3 }).breach, "grenade must never breach a 0.3 m masonry wall");
ok(!L.hole(0.2, { thick: 0.2, standoff: 0.5 }).breach, "a thrown grenade 0.5 m off must not breach even 0.2 m");

const tank = L.hole(4.0, { thick: 0.4 });
ok(tank.breach && 2 * tank.r >= 1.4 && 2 * tank.r <= 2.0, `tank HE through a facade should open 1.4-2.0 m, got ${f2(2 * tank.r)}`);
ok(tank.walkable, "a tank breach is walkable");
ok(!rpg.walkable, "an RPG hole is not a doorway");

// C4 doctrine (FM 90-10-1) falls out of the law
ok(!CBZ.breachSpec(2).walkable, "2 lb C4 must be a mousehole (not walkable)");
ok(CBZ.breachSpec(5).walkable, "5 lb C4 must be the one-man hole");
ok(CBZ.breachSpec(10).holeR > CBZ.breachSpec(5).holeR, "10 lb opens wider than 5 lb");

// accumulation: grenades that hold keep what they delivered
{
  let banked = 0, n = 0;
  for (n = 1; n <= 40; n++) {
    const h = L.hole(0.2, { thick: 0.3, standoff: 0.5, banked: banked });
    if (h.breach) break;
    banked += h.Weff;
  }
  ok(n > 3 && n <= 40, `enough thrown grenades eventually open 0.3 m masonry (took ${n})`);
}

// ---- 2. glass / gut / frame / crater ---------------------------------------
const W = { grenade: 0.2, rpg: 0.7, tank: 4, hellfire: 9, mk82: 89, rocket227: 90, mk84: 430, buster: 2400 };
let prevG = 0;
for (const k of Object.keys(W)) {
  const g = L.glassR(W[k]);
  ok(g > prevG, `window blow-out radius must grow with the charge (${k} ${f2(g)} m)`);
  prevG = g;
}
ok(Math.abs(L.glassR(0.7) - 12 * Math.cbrt(0.7)) < 1e-9, "glass radius is Z_GLASS . W^(1/3)");
for (const k of ["grenade", "rpg", "tank"]) ok(!L.guts(W[k]), `${k} must not gut a storey (gutR ${f2(L.gutR(W[k]))} m)`);
for (const k of ["hellfire", "rocket227", "mk82", "mk84", "buster"]) ok(L.guts(W[k]), `${k} must gut the struck storey (gutR ${f2(L.gutR(W[k]))} m)`);
ok(L.sever(0.7, 6) === 0, "an RPG severs nothing, even across a 6 m house");
ok(L.sever(4, 6) === 0, "a tank round severs nothing");
ok(L.sever(430, 28) >= 0.5, `a Mk-84 severs most of a 28 m lot frame (got ${f2(L.sever(430, 28))})`);
ok(Math.abs(L.craterR(430) - 0.8 * Math.cbrt(430)) < 1e-9 && L.craterR(430) > 5.5 && L.craterR(430) < 6.5,
  `Mk-84 apparent crater radius ~6 m (got ${f2(L.craterR(430))})`);
ok(L.craterR(4) < 1.5 && L.craterR(9) >= 1.5, "tank rounds scuff, a Hellfire digs (the 1.5 m crater line)");
ok(L.ejectaR(0.2) < 1.2 && L.ejectaR(430) > 12, "ejecta ring scales from a scuff to a blackened disc");

// ---- 3. props are not walls -------------------------------------------------
const lamp = { minX: -0.17, maxX: 0.17, minZ: -0.17, maxZ: 0.17 };
const heavyWall = { minX: 0, maxX: 2.5, minZ: 0, maxZ: 1.4 };
const barrel = { minX: 0, maxX: 0.84, minZ: 0, maxZ: 0.84 };
ok(L.isProp(lamp, false), "a band-less 0.34 m lamp footprint is street furniture");
ok(L.isProp(barrel, false), "a band-less 0.84 m barrel is street furniture");
ok(!L.isProp(heavyWall, false), "the 1.4 x 2.5 m band-less heavy wall is a wall (span, not aspect ratio)");
ok(!L.isProp(lamp, true), "a collider that DECLARES its band is a wall whatever its span");

// ---- 4. every chemical ordnance row carries a charge ------------------------
{
  const noop = () => {};
  Object.assign(CBZ, { cityExplosion: null, shake: noop, sfx: noop, qScale: (a, b) => b, floorAt: () => 0 });
  try {
    vm.runInContext(src("src/systems/impactbus.js"), ctx, { filename: "impactbus.js" });
    const I = CBZ.impact;
    const want = ["grenade", "rpg", "tank", "tankHeat", "hellfire", "missile", "rocket227", "mk82", "airstrike", "mk84", "bomb", "jdam", "moab", "c4", "carcook"];
    for (const id of want) {
      const row = I.row(id);
      ok(!!row, `ordnance row "${id}" missing`);
      if (row) ok(row.charge > 0, `row "${id}" carries no charge`);
    }
    ok(I.row("rpg").shaped === true && I.row("rpg").jetPen > 0, "the rpg row is a shaped charge with a jet");
    ok(Math.abs(I.row("mk84").charge - 430) < 1e-6, "mk84 = 430 kg");
    ok(!(I.row("nuke").charge > 0), "the nuke is a field, not a charge");
  } catch (e) { fails.push("impactbus.js did not load in the VM: " + e.message); }
}

// ---- 5. the ledger: what actually comes down --------------------------------
{
  try {
    vm.runInContext(src("src/city/structural.js"), ctx, { filename: "structural.js" });
    const S = CBZ.structure;
    const mk = (id, cx, w, d, storeys) => ({
      cx: cx, cz: 0, kind: "shop",
      building: { ox: cx, oz: 0, w: w, d: d, storeys: storeys, FH: 3.2, h: storeys * 3.2, group: {}, colliders: [{}] },
    });
    const shop = mk("shop", 0, 10, 10, 1), house = mk("house", 200, 8, 8, 2), block = mk("block", 400, 28, 28, 4), tower = mk("tower", 600, 30, 30, 20);
    CBZ.city = { arena: { lots: [shop, house, block, tower], root: {} } };
    const fell = (lot) => { const st = S.state(lot); return st.stage >= S.STAGE.COLLAPSING || st.doomedIn >= 0; };
    // a rocket into each: never a collapse, never a gut
    for (const lot of [shop, house, block]) {
      S.charge(lot.building.ox - lot.building.w / 2, 1.4, 0, 0.7, { kind: "rpg", dirx: 1, dirz: 0 });
      ok(!fell(lot), `ONE RPG must never collapse a building (${lot.building.storeys}-storey, ${lot.building.w} m)`);
      ok(S.state(lot).sever === 0, "an RPG severs no frame");
    }
    // a tank round into the house: wounds, does not fell
    S.charge(house.building.ox - 4, 1.4, 0, 4, { kind: "tank", dirx: 1, dirz: 0 });
    ok(!fell(house), "one tank round must not fell a two-storey house");
    // a Mk-84 into the 4-storey block's first floor: gutted, burning, coming down
    const rec = S.charge(block.building.ox, 4.5, 0, 430, { kind: "mk84", fire: 0.3, dirx: 1, dirz: 0 });
    const st = S.state(block);
    ok(!!rec && rec.gutted && Object.keys(rec.gutted).length >= 3, "a Mk-84 guts the struck storey and the ones beside it");
    ok(st.fires > 0, "the gutted floors burn");
    ok(fell(block), `a Mk-84 brings a 28 m 4-storey block down (stage ${st.stage}, frac ${st.frac})`);
    // the 20-storey tower 200 m away is untouched by the blast
    ok(S.state(tower).dmg === 0, "the bomb's blast wave does not reach a tower 200 m away");
    // a Hellfire into the shop: gutted and burning, still standing
    const shop2 = mk("shop2", 800, 10, 10, 1);
    CBZ.city.arena.lots.push(shop2);
    S.charge(shop2.building.ox - 5, 1.4, 0, 9, { kind: "hellfire", dirx: 1, dirz: 0 });
    const s2 = S.state(shop2);
    ok(s2.fires > 0 && !fell(shop2), `a Hellfire guts a shop and sets it burning without an instant collapse (stage ${s2.stage})`);
    // persistence round-trip
    const blob = S.serialize();
    ok(blob.r.length >= 2, "damage serialises as data keyed by lot");
  } catch (e) { fails.push("structural.js ledger check threw: " + e.stack); }
}

// ---- 6. static: one law, no per-caller constants, no glowing prefab ----------
{
  const bld = src("src/city/buildings.js"), frx = src("src/city/fracture.js"), crash = src("src/city/crashfx.js");
  const carve = bld.slice(bld.indexOf("function carveHole(x, y, z, r, opts)"), bld.indexOf("CBZ.cityCarveWall = carveHole;"));
  ok(/L\.hole\(charge\.W,/.test(carve), "carveHole prices a charged wall with the law");
  ok(!/roomFurnMat|spillMat|MeshBasicMaterial/.test(carve), "no self-lit prefab room / furniture / warm spill behind a blast hole");
  ok(!/3\.4 \+ \(power/.test(frx), "fracture.js keeps no per-class hole-radius floor");
  ok(/CBZ\.blastBuildings\(x, cy, z, opts\)/.test(crash), "the one explosion hands buildings to blastBuildings");
  ok(!/_structWrapped\s*=\s*true/.test(bld), "buildings.js no longer wraps the blast (the explosion calls it once)");
  ok(!/function onBlast/.test(src("src/city/demolition.js")), "demolition.js keeps no second damage accumulator");
}

// ---- report --------------------------------------------------------------------
const table = [["row", "W kg", "RPG-face hole m", "glass m", "gut m", "gut?", "frame m", "crater m"]];
for (const k of Object.keys(W)) {
  const h = L.hole(W[k], { thick: 0.4, shaped: k === "rpg" || k === "hellfire", jetPen: k === "rpg" ? 1.5 : 2 });
  table.push([k, W[k], h.breach ? f2(2 * h.r) : "held", f2(L.glassR(W[k])), f2(L.gutR(W[k])), L.guts(W[k]) ? "yes" : "no", f2(L.frameR(W[k])), f2(L.craterR(W[k]))]);
}
for (const r of table) console.log(r.map((c, i) => String(c).padEnd(i ? 12 : 10)).join(""));
if (fails.length) {
  console.log(`\nblast-scaling: FAIL (${fails.length}/${checks})`);
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`\nblast-scaling: PASS (${checks} checks)`);
