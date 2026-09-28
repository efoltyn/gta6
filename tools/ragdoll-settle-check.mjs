#!/usr/bin/env node
/* tools/ragdoll-settle-check.mjs — DO THROWN BODIES COME TO REST LYING, OR SITTING UP?

   The REAL rig (entities/character.js), grapple.js's corpse pass and the
   REAL verlet body (city/ragdoll.js) in plain node (tools/lib/verbs-vm.mjs,
   seeded Math.random). N seeded throws on open flat ground, the way the
   city throws a body (city/peds.js cityKillPed): a car hit ("run over",
   m 8..22) or a blast (m 20..34), horizontal, struck at the chest or lower,
   from every compass direction, at every facing, a third of them carrying
   the run he died in, at 30, 60 and 120 fps (a 120 Hz display is the
   owner's). Each body runs until the ragdoll freezes it (or 9 s), then:

     neck   world height of the drawn neck joint above the floor
     chest  the solver's shoulder midpoint above the floor
     SIT    neck > 0.45 m (a body lying on its back, face or side: 0.2-0.35)

   Plus one crowd blast over the solve budget (10 men, ceiling 7) per 20
   runs: every body must get a real one, none frozen in the air.

   Then EXISTING CORPSES (CBZ.ragdollBlast): a body asleep in its bodyfall
   collapse and one frozen in a ragdoll slot, each caught by a blast 2 m
   off: it must leave the ground, land, freeze lying again, and stay dead;
   a corpse outside the radius is left alone.

     node tools/ragdoll-settle-check.mjs              200 runs
     node tools/ragdoll-settle-check.mjs 500          more
     CBZ_SEED=7 node tools/ragdoll-settle-check.mjs   another seed
     RAGDOLL_SRC=/path/old-ragdoll.js node tools/...  measure another ragdoll.js (before/after)
   exit 0 = no sitting rests, no body left solving, crowd all real, corpse throws pass */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const N = +(process.argv[2] || 200);
const v = loadVerbsVM({ mode: "city" });
const { CBZ, THREE } = v;
CBZ.CONFIG.RAGDOLL_ANY_MODE = true;
const SRC = process.env.RAGDOLL_SRC || new URL("../src/city/ragdoll.js", import.meta.url);
vm.runInContext(readFileSync(SRC, "utf8"), v.ctx, { filename: "src/city/ragdoll.js" });
v.updaters.sort((x, y) => x.order - y.order);
if (!CBZ.cityRagdoll) { console.log("FAIL: city/ragdoll.js did not load"); process.exit(1); }
const world3 = new THREE.Scene();
const rnd = v.ctx.Math.random;              // the sandbox's seeded stream
const _t = new THREE.Vector3();
function yOf(o) { o.getWorldPosition(_t); return _t.y; }
const PHYS = ["slim", "average", "heavy", "muscular"];

function spawn(n, spread) {
  v.clearActors();
  v.world({});
  const as = [];
  for (let i = 0; i < n; i++) {
    v.setPhysique(PHYS[(rnd() * 4) | 0]);
    const a = v.actor({ build: rnd() < 0.5 ? "m" : "f", x: spread ? (i % 4) * 2.5 - 4 : 0, z: spread ? Math.floor(i / 4) * 2.5 - 3 : 0, yaw: rnd() * Math.PI * 2, name: "thrown" });
    world3.add(a.group);
    as.push(a);
  }
  CBZ.cityPeds = as.slice();                  // grapple's corpse pass runs on them, as in the city
  for (let i = 0; i < 8; i++) v.frame(1 / 60);
  return as;
}
function run(dt, maxT) {
  let t = 0;
  for (; t < maxT; t += dt) { v.frame(dt); if (t > 0.1 && CBZ.ragdollAudit().solving === 0) break; }
  return t;
}
function measure(a) {
  a.group.updateMatrixWorld(true);
  const P = CBZ.ragdollPoints ? CBZ.ragdollPoints(a) : null;
  return { neck: yOf(a.char.neck), chest: P ? (P[4] + P[7]) / 2 : NaN, pelvis: P ? (P[10] + P[13]) / 2 : NaN };
}
function done(as) { for (const a of as) { CBZ.ragdollDrop(a); world3.remove(a.group); } CBZ.cityPeds = []; }

let sit = 0, worst = 0, unfrozen = 0, chestMax = 0, pelMax = 0;
const hist = [0, 0, 0, 0, 0, 0];
const sits = [];
const RATES = [30, 60, 120];
for (let r = 0; r < N; r++) {
  const as = spawn(1, false), a = as[0];
  const car = rnd() < 0.5, fps = RATES[(rnd() * 3) | 0];
  const ang = rnd() * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
  const mag = car ? 8 + rnd() * 14 : 20 + rnd() * 14;
  const py = rnd() < 0.5 ? 1.25 : 0.5 + rnd() * 0.75;     // peds.js strikes at pos.y + 1.25 when it has no point
  if (rnd() < 0.35) { const y = a.group.rotation.y, s = 2 + rnd() * 5; a.vel = { x: Math.sin(y) * s, y: 0, z: Math.cos(y) * s }; }
  a.dead = true;
  if (!CBZ.cityRagdoll(a, { x: -dx * 0.25, y: py, z: -dz * 0.25 }, { x: dx, y: 0, z: dz }, mag)) { console.log("FAIL: cityRagdoll refused"); process.exit(1); }
  const t = run(1 / fps, 9);
  if (CBZ.ragdollAudit().solving) unfrozen++;
  const m = measure(a);
  hist[Math.min(5, Math.floor(m.neck / 0.1))]++;
  if (m.chest > chestMax) chestMax = m.chest;
  if (m.pelvis > pelMax) pelMax = m.pelvis;
  if (m.neck > 0.45) { sit++; sits.push(`${car ? "car" : "blast"} m${mag.toFixed(0)} @${fps}fps: neck ${m.neck.toFixed(2)} m, chest ${m.chest.toFixed(2)} m, froze at ${t.toFixed(2)} s`); }
  worst = Math.max(worst, m.neck);
  done(as);
}
console.log(`ragdoll settle: ${N} car/blast throws in open ground, ${sit} came to rest SITTING (neck > 0.45 m) = ${(sit / N * 100).toFixed(1)}%, worst neck ${worst.toFixed(2)} m, highest chest / pelvis point ${chestMax ? chestMax.toFixed(2) + " / " + pelMax.toFixed(2) + " m" : "n/a"}, ${unfrozen} never froze`);
console.log(`  neck height (0.1 m bins): ${hist.map((n, i) => (i < 5 ? `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}` : ">=0.5") + ": " + n).join("   ")}`);
for (const s of sits.slice(0, 6)) console.log("   sat: " + s);

// ---- a crowd blast over the solve budget ----
let crowdN = 0, crowdNone = 0, crowdSit = 0;
CBZ.CONFIG.RAGDOLL_ACTIVE = 7;
for (let r = 0; r < Math.max(1, Math.round(N / 20)); r++) {
  const as = spawn(10, true);
  for (let i = 0; i < as.length; i++) {
    const a = as[i];
    for (let k = 0; k < 6; k++) v.frame(1 / 60);          // they die over a tenth of a second each, as a burst reads
    let dx = a.pos.x + 0.01, dz = a.pos.z - 0.5; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    a.dead = true;
    CBZ.cityRagdoll(a, { x: a.pos.x - dx * 0.25, y: 1.25, z: a.pos.z - dz * 0.25 }, { x: dx, y: 0, z: dz }, 20 + rnd() * 14);
  }
  run(1 / 60, 9);
  for (const a of as) {
    crowdN++;
    if (a._ragSlot == null) { crowdNone++; continue; }
    if (measure(a).neck > 0.45) crowdSit++;
  }
  done(as);
}
CBZ.CONFIG.RAGDOLL_ACTIVE = 0;
console.log(`crowd blast over the budget (10 men, ceiling 7): ${crowdN} bodies, ${crowdNone} refused a ragdoll, ${crowdSit} frozen sitting or in the air`);

/* ---- EXISTING CORPSES IN A BLAST ---- */
let fails = 0;
function check(name, ok, detail) { if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`); }
function airborne(a, maxT) {
  let air = false, t = 0;
  for (; t < maxT; t += 1 / 60) {
    v.frame(1 / 60);
    a.group.updateMatrixWorld(true);
    if (yOf(a.char.parts.ll) > 0.9) air = true;
    if (t > 0.1 && CBZ.ragdollAudit().solving === 0) break;
  }
  return { air, t };
}
if (!CBZ.ragdollBlast) check("CBZ.ragdollBlast exists", false, "missing");
else {
  {
    const a = spawn(1, false)[0];
    a.group.rotation.y = 0;
    a.dead = true;
    CBZ.body.knockdown(a, { dir: { x: 0, z: -1 }, force: 7, t: 9999 });
    for (let i = 0; i < 240; i++) v.frame(1 / 60);
    const was = CBZ.bodyFall.asleep(a);
    const n = CBZ.ragdollBlast(2, 0, 7, 1);
    const f = airborne(a, 9), m = measure(a);
    check("bodyfall corpse thrown", was && n === 1 && f.air && !CBZ.bodyFall.active(a) && a.dead && m.neck < 0.45 && CBZ.ragdollAudit().frozen === 1,
      `asleep before ${was}, thrown ${n}, left the ground ${f.air}, bodyfall ${CBZ.bodyFall.active(a)}, dead ${a.dead}, rests neck ${m.neck.toFixed(2)} m, frozen after ${f.t.toFixed(2)} s`);
    done([a]);
  }
  {
    const a = spawn(1, false)[0];
    a.dead = true;
    CBZ.cityRagdoll(a, { x: 0, y: 0.8, z: 0 }, { x: 1, y: 0, z: 0 }, 16);
    run(1 / 60, 9);
    const x0 = a.group.position.x, frozen = CBZ.ragdollAudit().frozen === 1;
    const n = CBZ.ragdollBlast(x0 - 2, 0, 7, 1);
    const f = airborne(a, 9), m = measure(a);
    const moved = a.group.position.x - x0;
    check("frozen ragdoll corpse thrown", frozen && n === 1 && f.air && moved > 0.5 && a.dead && m.neck < 0.45 && CBZ.ragdollAudit().frozen === 1,
      `frozen before ${frozen}, thrown ${n}, left the ground ${f.air}, carried ${moved.toFixed(2)} m away from the blast, dead ${a.dead}, rests neck ${m.neck.toFixed(2)} m`);
    const n2 = CBZ.ragdollBlast(a.group.position.x + 30, 0, 7, 1);
    check("corpse outside the radius is left alone", n2 === 0, `thrown ${n2}`);
    done([a]);
  }
}
if (v.errors.length) { console.log("errors:\n  " + v.errors.slice(0, 5).join("\n  ")); fails++; }
const pass = sit === 0 && !unfrozen && !crowdNone && !crowdSit && !fails;
console.log(pass ? "ragdoll-settle: PASS" : "ragdoll-settle: FAIL");
process.exit(pass ? 0 : 1);
