#!/usr/bin/env node
/* tools/body-contact-check.mjs — BODIES ARE SOLID AND HAVE WEIGHT
   (systems/humancontact.js, CBZ.bodyImpact + CBZ.humanContact), in plain node.

   Owner: "when I run into another player, there's no bumping into and
   knocking over... I really want real physics in this game."

     1. the momentum model: walk into a chest = brush, into a back = shove,
        jog = shove, sprint into a braced chest = stumble with a real but
        small chance of going down, sprint into a side or a back = down;
        momentum is conserved (mA*dvA == mB*dvB);
     2. mass asymmetry: a light man sprinting into a heavy one is the one who
        is likely on the floor; the reverse floors the light man;
     3. cars: a creep pushes, ~10 km/h knocks you down;
     4. verb power (shove / tackle) is bounded and grows with the run-up;
     5. the solver: no pass-through at ANY closing speed (1..40 m/s at 12 Hz),
        the player never ends a pass inside a man, the heavier planted man
        moves less, and a crowd pressing on one spot settles without buzzing.

     node tools/body-contact-check.mjs     exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL: " + m); } else console.log("ok   " + m); };
const src = (p) => readFileSync(new URL("../src/" + p, import.meta.url), "utf8");

function world() {
  const ctx = { console, Math };
  ctx.window = ctx;
  const upd = [];
  const CBZ = ctx.CBZ = {
    game: { mode: "test", state: "playing" },
    player: { pos: { x: 0, y: 0, z: 0 }, radius: 0.55, speed: 0, dead: false },
    onUpdate: (o, fn) => upd.push([o, fn]),
    cityPeds: [], cityCops: [],
  };
  vm.createContext(ctx);
  vm.runInContext(src("systems/spatialgrid.js"), ctx);
  vm.runInContext(src("systems/humancontact.js"), ctx);
  let s = 12345;
  CBZ.bodyImpact.rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return { CBZ, BI: CBZ.bodyImpact, HC: CBZ.humanContact };
}

const { BI } = world();
const T = BI.TIERS;
function hit(o) {
  // A runs along +x into B; B faces fB (yaw), A faces +x
  const q = {
    mA: o.mA || 78, mB: o.mB || 78,
    vAx: o.vA || 0, vAz: 0, vBx: o.vB || 0, vBz: 0,
    nx: 1, nz: 0,
    fAx: 1, fAz: 0, fBx: o.fBx, fBz: o.fBz,
    stabA: 0.85, stabB: o.stabB || 1,
    rollA: o.roll == null ? 0.5 : o.roll, rollB: o.roll == null ? 0.5 : o.roll,
  };
  return BI.solve(q, {});
}
// B facing A (chest): fB = -x. B's back to A: fB = +x. B side-on: fB = +z.
const CHEST = { fBx: -1, fBz: 0 }, BACK = { fBx: 1, fBz: 0 }, SIDE = { fBx: 0, fBz: 1 };

// ---- 1. the model --------------------------------------------------------
{
  const w = hit({ vA: 2.0, ...CHEST });
  ok(T[w.tierB] === "brush", `walk into a chest = ${T[w.tierB]} (e ${w.eB.toFixed(2)})`);
  ok(w.tierA <= BI.BRUSH, `the walker himself: ${T[w.tierA]}`);
  const wb = hit({ vA: 2.0, ...BACK });
  ok(T[wb.tierB] === "shove", `walk into a back = ${T[wb.tierB]} (e ${wb.eB.toFixed(2)})`);
  const j = hit({ vA: 3.5, ...CHEST });
  ok(T[j.tierB] === "shove", `jog into a chest = ${T[j.tierB]} (e ${j.eB.toFixed(2)})`);
  const s = hit({ vA: 6.4, ...CHEST });
  ok(s.tierB >= BI.STUMBLE && s.pB > 0.02 && s.pB < 0.45, `sprint into a braced chest: stumble, down ${(s.pB * 100).toFixed(0)}% of the time`);
  ok(s.tierA >= BI.SHOVE && s.pA < 0.05, `the sprinter staggers, rarely falls (${T[s.tierA]}, ${(s.pA * 100).toFixed(0)}%)`);
  const sb = hit({ vA: 6.4, ...BACK });
  ok(T[sb.tierB] === "down", `sprint into a back = ${T[sb.tierB]} (e ${sb.eB.toFixed(2)})`);
  const ss = hit({ vA: 6.4, ...SIDE });
  ok(T[ss.tierB] === "down", `sprint into a side = ${T[ss.tierB]} (e ${ss.eB.toFixed(2)})`);
  const lean = hit({ vA: 0.2, ...CHEST });
  ok(lean.tierA === 0 && lean.tierB === 0, "leaning is not an impact");
  const away = hit({ vA: 2, vB: 3, ...BACK });
  ok(away.tierB === 0, "a man running away faster than you is never hit");
  const headOn = hit({ vA: 1.4, vB: -1.4, ...CHEST });
  ok(headOn.tierB <= BI.BRUSH && headOn.tierA <= BI.BRUSH, `two walkers meeting head-on: ${T[headOn.tierA]} / ${T[headOn.tierB]}`);
  for (const v of [1, 3, 6.4, 12]) {
    const r = hit({ vA: v, mA: 61, mB: 104, ...CHEST });
    ok(Math.abs(61 * r.dvA - 104 * r.dvB) < 1e-9, `momentum conserved at ${v} m/s (${(61 * r.dvA).toFixed(1)} kg m/s each way)`);
  }
  let prev = -1, mono = true;
  for (let v = 0.5; v < 12; v += 0.25) { const e = hit({ vA: v, ...SIDE }).eB; if (e < prev) mono = false; prev = e; }
  ok(mono, "harder with speed, never softer");
  let downsFrail = 0, downsFit = 0;
  for (let i = 0; i < 200; i++) {
    if (hit({ vA: 6.4, ...CHEST, stabB: 1.4, roll: i / 200 }).tierB === BI.DOWN) downsFrail++;
    if (hit({ vA: 6.4, ...CHEST, roll: i / 200 }).tierB === BI.DOWN) downsFit++;
  }
  ok(downsFrail > downsFit * 2, `a frail man goes down far more often (${downsFrail} vs ${downsFit} of 200)`);
}

// ---- 2. mass ---------------------------------------------------------------
{
  const lightIntoHeavy = hit({ vA: 6.4, mA: 60, mB: 120, ...CHEST });
  const heavyIntoLight = hit({ vA: 6.4, mA: 120, mB: 60, ...CHEST });
  ok(lightIntoHeavy.pA > lightIntoHeavy.pB, `a 60 kg man sprinting into a 120 kg one: he is likelier down (${(lightIntoHeavy.pA * 100).toFixed(0)}% vs ${(lightIntoHeavy.pB * 100).toFixed(0)}%)`);
  ok(heavyIntoLight.tierB === BI.DOWN, `120 kg sprinting into 60 kg: ${T[heavyIntoLight.tierB]}`);
  ok(heavyIntoLight.pA < 0.05, `...and the heavy man keeps his feet (${(heavyIntoLight.pA * 100).toFixed(0)}%)`);
  ok(lightIntoHeavy.dvA > lightIntoHeavy.dvB * 1.9, "the lighter body takes twice the velocity change");
}

// ---- 3. cars ---------------------------------------------------------------
{
  const man = { pos: { x: 0, y: 0, z: 0 }, _bcMass: 78, group: null };
  const creep = BI.car(man, { mass: 1400 }, 0.8, 1, 0);
  const walkPace = BI.car(man, { mass: 1400 }, 1.5, 1, 0);
  const tenKmh = BI.car(man, { mass: 1400 }, 2.8, 1, 0);
  ok(creep.tier <= BI.SHOVE && creep.tier >= BI.BRUSH, `a car creeping at 0.8 m/s pushes (${T[creep.tier]})`);
  ok(walkPace.tier >= BI.SHOVE && walkPace.tier < BI.DOWN || walkPace.tier === BI.STUMBLE, `walking pace staggers (${T[walkPace.tier]})`);
  ok(tenKmh.tier === BI.DOWN, `10 km/h takes the legs (${T[tenKmh.tier]}, e ${tenKmh.e.toFixed(2)})`);
}

// ---- 4. verb power ---------------------------------------------------------
{
  const { CBZ, BI: B } = world();
  const a = { pos: { x: 0, y: 0, z: 0 }, group: { rotation: { y: Math.PI / 2 } }, _bcMass: 78, _bcVx: 0, _bcVz: 0 };
  const t = { pos: { x: 0.8, y: 0, z: 0 }, group: { rotation: { y: -Math.PI / 2 } }, _bcMass: 78 };
  const still = B.verbPower(a, t, "shove");
  a._bcVx = 5;
  const run = B.verbPower(a, t, "shove");
  t.group.rotation.y = Math.PI / 2;           // his back to you
  a._bcVx = 0;
  const back = B.verbPower(a, t, "shove");
  const tackle = B.verbPower(a, t, "tackle");
  ok(still > 0.2 && still < 0.6, `a standing two-palm shove to the chest: power ${still.toFixed(2)} (a stagger, not a launch)`);
  ok(run > 0.75, `a running shove launches him (${run.toFixed(2)} >= 0.75)`);
  ok(back > still, `from behind it carries further (${back.toFixed(2)})`);
  ok(tackle >= 0.9 && tackle <= 1, `a tackle: ${tackle.toFixed(2)}`);
  void CBZ;
}

// ---- 5. the solver ---------------------------------------------------------
function body(x, z, m, yaw) { return { pos: { x, y: 0, z }, r: 0.36, _bcMass: m || 78, group: { rotation: { y: yaw || 0 } } }; }
{
  // no pass-through at any closing speed: two men run at each other along x
  let worst = 0;
  for (const v of [1, 3, 6.4, 9, 12]) {
    const { HC, CBZ } = world();
    const A = body(-3, 0, 78, Math.PI / 2), B = body(3, 0.05, 78, -Math.PI / 2);
    const dt = 1 / 12;
    let flipped = false;
    for (let f = 0; f < 60; f++) {
      if (!A._stop) A.pos.x += v * dt;
      if (!B._stop) B.pos.x -= v * dt;
      HC.resolve([A, B], dt, { mode: "test", downed: false });
      HC.stepKicks(dt);
      if (B.pos.x - A.pos.x < 0 && Math.abs(B.pos.z - A.pos.z) < 0.5) flipped = true;
      worst = Math.max(worst, 0.72 - Math.hypot(B.pos.x - A.pos.x, B.pos.z - A.pos.z));
    }
    ok(!flipped, `closing at ${v * 2} m/s (${v} each, 12 Hz, ${(v * dt).toFixed(2)} m a step): nobody passes through (stats ${JSON.stringify(HC.stats())})`);
    void CBZ;
  }
  ok(worst < 0.4, `deepest end-of-pass overlap across all speeds: ${worst.toFixed(3)} m`);
}
{
  // the player never ends a pass inside a man
  const { HC, CBZ } = world();
  const P = { _p: true, isPlayer: true, pos: CBZ.player.pos, r: 0.55 };
  const men = [];
  for (let i = 0; i < 8; i++) men.push(body(1 + (i % 4) * 0.8, -1.2 + Math.floor(i / 4) * 0.8, 70 + i * 6, 0));
  let deep = 0;
  for (let f = 0; f < 240; f++) {
    const dt = 1 / 60;
    CBZ.player.pos.x += 2.0 * dt;          // walk straight into the group
    HC.resolve([P, ...men], dt, { mode: "test", downed: false });
    HC.stepKicks(dt);
    for (const m of men) deep = Math.max(deep, 0.55 + 0.36 - Math.hypot(m.pos.x - P.pos.x, m.pos.z - P.pos.z));
  }
  ok(deep < 0.005, `walking into a group: never inside a man (max residual ${deep.toFixed(4)} m)`);
}
{
  // mass: a heavy planted man moves less than a light one under the same lean
  const { HC } = world();
  const pushL = body(-0.6, 0, 78, Math.PI / 2), light = body(0, 0, 55, 0);
  const pushH = body(-0.6, 10, 78, Math.PI / 2), heavy = body(0, 10, 130, 0);
  for (let f = 0; f < 120; f++) {
    const dt = 1 / 60;
    pushL.pos.x += 0.8 * dt; pushH.pos.x += 0.8 * dt;
    HC.resolve([pushL, light, pushH, heavy], dt, { mode: "test", downed: false });
    HC.stepKicks(dt);
  }
  ok(light.pos.x > heavy.pos.x - 0 + 0.05, `leaning on a 55 kg man moves him ${light.pos.x.toFixed(2)} m, a 130 kg one ${(heavy.pos.x).toFixed(2)} m`);
}
{
  // a crowd pressing on one spot (a doorway, a queue) settles, it does not buzz
  const { HC } = world();
  const crowd = [];
  for (let i = 0; i < 30; i++) crowd.push(body(Math.cos(i * 2.4) * (2 + i * 0.12), Math.sin(i * 2.4) * (2 + i * 0.12), 60 + (i * 7) % 50, 0));
  const dt = 1 / 60, prev = crowd.map((c) => ({ x: c.pos.x, z: c.pos.z }));
  let jitter = 0, n = 0, deepest = 0;
  for (let f = 0; f < 60 * 20; f++) {
    for (const c of crowd) {
      const d = Math.hypot(c.pos.x, c.pos.z);
      if (d > 0.1) { const s = Math.min(d, 1.3 * dt); c.pos.x -= c.pos.x / d * s; c.pos.z -= c.pos.z / d * s; c.group.rotation.y = Math.atan2(-c.pos.x, -c.pos.z); }
    }
    HC.resolve(crowd, dt, { mode: "test", downed: false });
    HC.stepKicks(dt);
    if (f >= 60 * 17) {
      for (let i = 0; i < crowd.length; i++) {
        jitter += Math.hypot(crowd[i].pos.x - prev[i].x, crowd[i].pos.z - prev[i].z); n++;
      }
      for (let i = 0; i < crowd.length; i++) for (let k = i + 1; k < crowd.length; k++) {
        deepest = Math.max(deepest, 0.72 - Math.hypot(crowd[i].pos.x - crowd[k].pos.x, crowd[i].pos.z - crowd[k].pos.z));
      }
    }
    for (let i = 0; i < crowd.length; i++) { prev[i].x = crowd[i].pos.x; prev[i].z = crowd[i].pos.z; }
  }
  const mean = jitter / n;
  ok(mean < 0.004, `30 people pressing on one spot, last 3 s: mean motion ${(mean * 1000).toFixed(2)} mm/frame (settled, no buzz)`);
  ok(deepest < 0.3, `...and they stay bodies (deepest overlap ${deepest.toFixed(3)} m of 0.72)`);
}
{
  // a sprint into a standing man's back through the solver puts him down
  const { HC } = world();
  const runner = body(-4, 0, 78, Math.PI / 2), victim = body(0, 0, 78, Math.PI / 2);
  for (let f = 0; f < 30; f++) { runner.pos.x += 6.4 / 30; HC.resolve([runner, victim], 1 / 30, { mode: "test", downed: false }); HC.stepKicks(1 / 30); }
  const st = HC.stats();
  ok(st.impacts === 1 && st.downs >= 1, `the solver floors a man sprinted into from behind, once (impacts ${st.impacts}, downs ${st.downs})`);
}

{
  // the downed: a walk steps over a corpse (not blocked), a sprint trips on it
  const { HC, CBZ } = world();
  const pokes = [];
  CBZ.bodyFall = { active: () => true, poke: (a, dx, dz, f) => { pokes.push(f); return true; } };
  const corpse = body(0, 0, 78, 0); corpse.dead = true;
  CBZ.bots = [corpse];
  const walker = body(-2, 0, 78, Math.PI / 2);
  for (let f = 0; f < 120; f++) { walker.pos.x += 1.4 / 60; HC.resolve([walker, corpse], 1 / 60, { mode: "test" }); HC.stepKicks(1 / 60); }
  ok(walker.pos.x > 0.6, `a walker steps over a body (x ${walker.pos.x.toFixed(2)}, not stopped at it)`);
  ok(pokes.length >= 1 && pokes[0] < 2, `...and nudges it with his foot (${pokes.length} nudges, force ${pokes[0]})`);
  const before = HC.stats().stepOvers;
  pokes.length = 0;
  const runner = body(-3, 0.1, 78, Math.PI / 2);
  for (let f = 0; f < 60; f++) { runner.pos.x += 6.4 / 60; HC.resolve([runner, corpse], 1 / 60, { mode: "test" }); HC.stepKicks(1 / 60); }
  ok(HC.stats().stepOvers > before && pokes.some((f) => f > 3), `a sprinter's foot kicks the body harder (force ${Math.max(...pokes).toFixed(1)})`);
}

console.log(fails ?`\n${fails} FAILED` : "\nall ok");
process.exit(fails ? 1 : 0);
