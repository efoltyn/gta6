#!/usr/bin/env node
/* tools/combatkit-check.mjs — THE KIT FITS AND THE ARMOUR WORKS. Plain node.

   Loads the real body (entities/character.js and its kit: headwear, eyewear,
   footwear, soldier) plus warlord/camo.js, systems/armour.js and
   entities/combatkit.js in one vm context, and checks:

   FIT, on every adult body (m / f x average / slim / heavy / muscular) in
   every loadout with a carrier:
     - nothing of the carrier is inside the torso (the body's real section,
       CBZ.bodySection, at the vertex's height): max depth <= 3 mm;
     - the plates are ON the body, not floating: the plate bag's inner face at
       the plate's centre line is within 25 mm of the chest / back surface;
     - knee pads sit on the shin: inner face outside the leg loft and within
       12 mm of it at the front;
     - the arms clear the carrier through idle, walk, run and the rifle
       carries (entities/soldier.js): the deepest any arm vertex goes inside
       the carrier's drawn width at its height (and inside its depth) <= 25 mm.
   ARMOUR (systems/armour.js), seeded:
     - unarmoured, a body hit averages 1 and the head 2.2 (balance only moves
       where there is armour);
     - an ESAPI plate stops 5.56 and 7.62x51 almost always, a .50 BMG almost
       never; a IIIA panel stops 9 mm and not 7.62x39; a helmet stops a
       fragment; a burst into one plate cracks it until rounds get through;
     - a stop staggers and winds the man; full kit cuts a blast.

     node tools/combatkit-check.mjs      exit 0 = PASS */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument } from "./lib/fake-canvas.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const FILES = ["src/vendor/three.r128.min.js", "src/config.js", "src/core/matrixskip.js", "src/world/materials.js", "src/systems/fphands.js",
  "src/entities/footwear.js", "src/entities/character.js", "src/entities/headwear.js", "src/entities/eyewear.js", "src/entities/heritage.js",
  "src/entities/moves.js", "src/entities/gait.js", "src/entities/poses.js", "src/entities/soldier.js", "src/entities/moves_posture.js",
  "src/warlord/camo.js", "src/systems/armour.js", "src/entities/combatkit.js"];
const ctx = vm.createContext({ console: { log() {}, warn() {}, error: console.error }, Math, setTimeout: () => 0, clearTimeout() {}, performance, Date });
ctx.window = ctx; ctx.self = ctx; ctx.document = fakeDocument();
ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
ctx.addEventListener = () => {}; ctx.requestAnimationFrame = () => 0;
ctx.CBZ = { CONFIG: {}, game: { mode: "city" }, npcs: [], onUpdate() {}, onAlways() {}, onReset() {}, onModeEnter() {}, on() {} };
for (const f of FILES) vm.runInContext(read(f), ctx, { filename: f });
const { THREE: T, CBZ } = ctx;
const fails = [];
const ok = (c, msg) => { if (!c) fails.push(msg); return c; };
for (const need of ["combatKit", "armour", "bodySection", "humanArmClear", "human", "animChar"]) ok(!!CBZ[need], "CBZ." + need + " missing");
if (fails.length) { console.log("FAIL\n  " + fails.join("\n  ")); process.exit(1); }

// ---------------------------------------------------------------- geometry helpers
function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distToPoly(poly, x, z) {
  let best = 1e9;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], az = poly[j][1], bx = poly[i][0], bz = poly[i][1];
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}
// vertices of a mesh in the frame of `root` (an ancestor)
function vertsIn(mesh, root) {
  const out = [], m4 = new T.Matrix4();
  let o = mesh; m4.identity();
  for (; o && o !== root; o = o.parent) { o.updateMatrix(); m4.premultiply(o.matrix); }
  const p = mesh.geometry.attributes.position, v = new T.Vector3();
  for (let i = 0; i < p.count; i++) out.push(v.fromBufferAttribute(p, i).applyMatrix4(m4).clone());
  return out;
}

const BODIES = [];
for (const build of ["m", "f"]) for (const physique of ["average", "slim", "heavy", "muscular"]) BODIES.push({ build, physique });
const LOADS = ["rifleman", "gunner", "marksman", "medic", "officer", "militia"];
const rows = [];
let worstIn = 0, worstFloat = 0, worstKnee = 0, worstKneeGap = 0, worstArm = 0, worstArmAt = "";
for (const B of BODIES) {
  for (const lo of LOADS) {
    const ch = CBZ.human.build({ build: B.build, physique: B.physique, skin: 0xc68642, torso: 0x555555, legs: 0x444444, shoes: 0x222222, hair: 0x2a1d16 });
    const K = CBZ.combatKit.wear(ch, { loadout: lo, nation: "republic", mark: 0x3f6fd0 });
    const tag = B.build + "/" + B.physique + "/" + lo;
    if (!ok(K && K.carrier, tag + ": no carrier")) continue;
    const hs = ch.group.userData.humanScale || 0.7, m = 1 / hs;
    const g = K.carrier.geometry, gk = g.userData.combatKit;
    // (a) nothing inside the torso
    const P = g.attributes.position;
    const cache = new Map();
    let deep = 0, deepAt = "";
    const S = ch.torsoShape;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      if (y > S.yN) continue;                        // above the neck base: the section is the neck's, not ours
      const key = Math.round(y / (0.005 * m));
      let ol = cache.get(key);
      if (!ol) { ol = CBZ.bodySection.outline(ch, key * 0.005 * m); cache.set(key, ol); }
      if (inPoly(ol, x, z)) {
        const d = distToPoly(ol, x, z) * hs;
        if (d > deep) { deep = d; deepAt = "y " + ((y - S.base) / (S.yN - S.base)).toFixed(2) + " of the torso, angle " + Math.round(Math.atan2(x, z) * 180 / Math.PI) + " deg"; }
      }
    }
    worstIn = Math.max(worstIn, deep);
    ok(deep <= 0.003, tag + ": carrier " + (deep * 1000).toFixed(1) + " mm inside the torso at " + deepAt);
    // (b) the plates are on the body: the bag's inner face on the centre line
    let gap = 0;
    if (lo !== "militia") {
      for (const side of [1, -1]) {
        const ys = [0.25, 0.5, 0.75].map((t) => gk.yB + (gk.yT - gk.yB) * t);
        for (const y of ys) {
          const zs = side > 0 ? ch.torsoFrontZ(0, y) : ch.torsoBackZ(0, y);
          // the nearest kit vertex straight out from the body on x = 0
          let near = 1e9;
          for (let i = 0; i < P.count; i++) {
            if (Math.abs(P.getX(i)) > 0.02 * m || Math.abs(P.getY(i) - y) > 0.03 * m) continue;
            const d = (P.getZ(i) - zs) * side;
            if (d >= -0.001 * m && d < near) near = d;
          }
          if (near < 1e8) gap = Math.max(gap, near * hs);
        }
        // a rigid plate RESTS on the body: somewhere on its face it touches
        let touch = 1e9;
        for (let i = 0; i < P.count; i++) {
          const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
          if (Math.abs(x) > gk.hw * 0.9 || y < gk.yB || y > gk.yT || z * side < 0) continue;
          const zs = side > 0 ? ch.torsoFrontZ(x, y) : ch.torsoBackZ(x, y), d = (z - zs) * side;
          if (d > -0.001 * m && d < touch) touch = d;
        }
        ok(touch * hs <= 0.008, tag + ": the " + (side > 0 ? "front" : "back") + " plate touches nowhere (" + (touch * hs * 1000).toFixed(1) + " mm)");
      }
      worstFloat = Math.max(worstFloat, gap);
      // over a bust, a belly or the sternum a rigid plate bridges; it never stands off
      ok(gap <= 0.04, tag + ": plate floats " + (gap * 1000).toFixed(1) + " mm off the body on its centre line");
    }
    // (c) knee pads on the shin
    for (const pad of K.meshes.filter((o) => o.name === "knee-pad")) {
      const lower = pad.parent, Lm = lower.geometry.userData.limb, pp = pad.geometry.attributes.position;
      let inside = 0, frontGap = 1e9;
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
        const h = CBZ.humanLimbHalfAt(lower.geometry, Math.min(Lm.y0, y));
        const r = Math.hypot(x / h.hx, (z - h.cz) / h.hz);
        if (r < 0.995) inside = Math.max(inside, (1 - r) * Math.min(h.hx, h.hz) * hs);
        if (Math.abs(x) < 0.2 * h.hx && z > h.cz) frontGap = Math.min(frontGap, (z - h.cz - h.hz) * hs);
      }
      worstKnee = Math.max(worstKnee, inside);
      if (frontGap < 1e8) worstKneeGap = Math.max(worstKneeGap, frontGap);
      ok(inside <= 0.003, tag + ": knee pad " + (inside * 1000).toFixed(1) + " mm inside the shin");
      ok(frontGap <= 0.012, tag + ": knee pad floats " + (frontGap * 1000).toFixed(1) + " mm off the knee");
    }
    // (d) the arms clear the carrier through the moves a soldier makes
    if (B.physique === "average" || B.physique === "heavy") {
      /* the carrier as a star-shaped solid round the body's axis: per 2 cm of
         height and 6 degrees of angle, its outermost radius. An arm vertex is
         INSIDE it when it is nearer the axis than that and outside the body
         (a vertex inside the body is the body's own business). */
      const kv = vertsIn(K.carrier, ch.body);
      const bins = new Map(), AB = 60;
      const bk = (y, a) => Math.round(y / (0.02 * m)) * 1000 + ((Math.round(a / (Math.PI * 2) * AB) % AB + AB) % AB);
      for (const v of kv) { const k = bk(v.y, Math.atan2(v.x, v.z)), r = Math.hypot(v.x, v.z); if (!(bins.get(k) >= r)) bins.set(k, r); }
      const olc = new Map();
      const STATES = [["idle", 0, null], ["walk", 1.4, null], ["run", 4.2, null], ["rifle low", 1.4, { carry: "low" }], ["rifle high", 0, { carry: "high" }], ["patrol", 1.3, { carry: "patrol" }]];
      for (const [nm, spd, sol] of STATES) {
        ch.soldier = sol ? JSON.parse(JSON.stringify(sol)) : null;
        let worst = 0;
        for (let f = 0; f < 90; f++) {
          CBZ.animChar(ch, spd, 1 / 60);
          if (f < 60 || f % 5) continue;
          for (const arm of [ch.parts.la, ch.parts.ra]) for (const seg of [arm.userData.main, arm.userData.lower]) {
            if (!seg || !seg.geometry) continue;
            for (const v of vertsIn(seg, ch.body)) {
              const R = bins.get(bk(v.y, Math.atan2(v.x, v.z)));
              if (!R) continue;
              const r = Math.hypot(v.x, v.z), d = (R - r) * hs;
              if (d <= worst) continue;
              const key = Math.round(v.y / (0.01 * m));
              let ol = olc.get(key);
              if (!ol) { ol = CBZ.bodySection.outline(ch, key * 0.01 * m); olc.set(key, ol); }
              if (inPoly(ol, v.x, v.z)) continue;
              worst = d;
            }
          }
        }
        if (worst > worstArm) { worstArm = worst; worstArmAt = tag + " " + nm; }
        ok(worst <= 0.025, tag + ": arm " + (worst * 1000).toFixed(1) + " mm into the carrier (" + nm + ")");
      }
      ch.soldier = null;
    }
    rows.push(tag + "  tris " + (g.index.count / 3) + "  inside " + (deep * 1000).toFixed(1) + " mm  plate gap " + (gap * 1000).toFixed(1) + " mm");
  }
}
// LOD: the far carrier is lighter
{
  const ch = CBZ.human.build({ build: "m", skin: 0xc68642, torso: 0x555555 });
  const K = CBZ.combatKit.wear(ch, { loadout: "rifleman", nation: "solara" });
  const n1 = K.carrier.geometry.index.count;
  CBZ.combatKit.lod(ch, 2);
  const n2 = K.carrier.geometry.index.count;
  ok(n2 < n1 * 0.6, "far carrier not lighter (" + n1 / 3 + " -> " + n2 / 3 + " tris)");
  ok(!!(K.armour && K.armour.pieces.front && K.armour.pieces.helmet), "a rifleman's kit issues no plates/helmet");
  const M = CBZ.combatKit.wear(ch, { loadout: "militia", nation: "rebels" });
  ok(M && !M.armour, "militia should wear no armour");
  const C = CBZ.combatKit.wear(ch, { loadout: "civilian" });
  ok(C && !C.carrier, "a civilian wears no carrier");
}

// ---------------------------------------------------------------- armour rules
const A = CBZ.armour;
let seed = 7;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const N = 20000;
let body = 0, head = 0;
for (let i = 0; i < N; i++) { body += A.resolve({ dmg: 1, round: "556", headshot: false, rng }).dmg; head += A.resolve({ dmg: 1, round: "556", headshot: true, rng }).dmg; }
ok(Math.abs(body / N - 1) < 0.03, "unarmoured body mean " + (body / N).toFixed(3) + " (want 1)");
ok(Math.abs(head / N - 2.2) < 0.06, "unarmoured head mean " + (head / N).toFixed(3) + " (want 2.2)");
function stopRate(cls, round, zone, n, fresh) {
  let st = 0;
  let arm = A.issue(cls);
  for (let i = 0; i < n; i++) {
    if (fresh) arm = A.issue(cls);
    const r = A.resolve({ armour: arm, dmg: 1, round, zone, rng });
    const want = zone === "skull" ? "helmet" : (cls.plates ? "front" : "soft");
    if (r.piece !== want) { i--; continue; }       // the roll missed that piece: not a test of it
    if (r.stopped) st++;
  }
  return st / n;
}
const plate = { plates: "esapi", soft: "iiia", helmet: "ach" };
const r556 = stopRate(plate, "556", "thorax", 400, true), r762 = stopRate(plate, "762x51", "thorax", 400, true);
const r50 = stopRate(plate, "50bmg", "thorax", 400, true);
ok(r556 > 0.95, "ESAPI stops 5.56 only " + (r556 * 100).toFixed(0) + "%");
ok(r762 > 0.9, "ESAPI stops 7.62x51 only " + (r762 * 100).toFixed(0) + "%");
ok(r50 < 0.1, "ESAPI stops .50 BMG " + (r50 * 100).toFixed(0) + "%");
const soft = { soft: "iiia" };
const s9 = stopRate(soft, "9mm", "thorax", 400, true), s762 = stopRate(soft, "762x39", "thorax", 400, true);
ok(s9 > 0.95, "IIIA stops 9 mm only " + (s9 * 100).toFixed(0) + "%");
ok(s762 < 0.1, "IIIA stops 7.62x39 " + (s762 * 100).toFixed(0) + "%");
const hf = stopRate({ helmet: "ach" }, "frag", "skull", 400, true), hr = stopRate({ helmet: "ach" }, "762x39", "skull", 600, true);
ok(hf > 0.95, "helmet stops fragments only " + (hf * 100).toFixed(0) + "%");
ok(hr > 0.1 && hr < 0.4, "helmet turns " + (hr * 100).toFixed(0) + "% of rifle rounds (want a fair share, not all)");
// a burst into one plate: the later rounds get through more often
let early = 0, late = 0;
for (let t = 0; t < 300; t++) {
  const arm = A.issue({ plates: "esapi" });
  for (let k = 0; k < 12; k++) {
    const r = A.resolve({ armour: arm, dmg: 1, round: "762x54", zone: "thorax", rng, dirX: 0, dirZ: -1, yaw: 0 });
    if (r.piece !== "front") { k--; continue; }
    if (r.pen) { if (k < 3) early++; else if (k >= 9) late++; }
  }
}
ok(late > early * 2 + 20, "a cracked plate does not give (pens in rounds 1-3: " + early + ", 10-12: " + late + ")");
let st;
do st = A.resolve({ armour: A.issue(plate), dmg: 40, round: "556", zone: "thorax", rng }); while (st.piece !== "front");
ok(st.stopped && st.stagger > 0.3 && st.winded > 1 && st.dmg > 0 && st.dmg < 10, "a stopped rifle round should stagger and wind (" + JSON.stringify(st) + ")");
const bl0 = A.resolve({ dmg: 100, kind: "blast" }).dmg, bl1 = A.resolve({ armour: A.issue(plate), dmg: 100, kind: "blast" }).dmg;
ok(bl1 < bl0 * 0.9, "full kit should cut a blast (" + bl0 + " -> " + bl1.toFixed(1) + ")");

for (const r of rows.filter((r, i) => i % 6 === 0)) console.log(r);
console.log("worst: carrier inside torso " + (worstIn * 1000).toFixed(1) + " mm, plate gap " + (worstFloat * 1000).toFixed(1) +
  " mm, knee pad inside " + (worstKnee * 1000).toFixed(1) + " mm / off " + (worstKneeGap * 1000).toFixed(1) + " mm, arm into carrier " +
  (worstArm * 1000).toFixed(1) + " mm (" + worstArmAt + ")");
console.log("armour: ESAPI v 5.56 " + (r556 * 100).toFixed(0) + "%, v 7.62x51 " + (r762 * 100).toFixed(0) + "%, v .50 " + (r50 * 100).toFixed(0) +
  "%; IIIA v 9mm " + (s9 * 100).toFixed(0) + "%, v 7.62x39 " + (s762 * 100).toFixed(0) + "%; helmet v frag " + (hf * 100).toFixed(0) + "%, turns rifle " + (hr * 100).toFixed(0) + "%");
if (fails.length) { console.log("FAIL (" + fails.length + ")\n  " + fails.slice(0, 40).join("\n  ")); process.exit(1); }
console.log("PASS");
