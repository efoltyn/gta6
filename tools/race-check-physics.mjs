#!/usr/bin/env node
/* tools/race-check-physics.mjs — plain-node checks for src/race/race_physics.js
   and src/race/race_ai.js. No browser. Prints the measured numbers and exits
   non-zero when a sanity bound fails.
     node tools/race-check-physics.mjs            (all)
     node tools/race-check-physics.mjs --quick    (skip the 10-car race) */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const core = require("../src/race/race_core.js");
const P = require("../src/race/race_physics.js");
const AI = require("../src/race/race_ai.js");

const D = core.DIMS, L = D.L, DT = 1 / 60;
const kmh = (v) => (v * 3.6).toFixed(0);
let fails = 0;
function check(ok, msg) { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) fails++; }
const finite = (c) => [c.pos.x, c.pos.z, c.pos.y, c.yaw, c.pitch, c.roll, c.vel.x, c.vel.z, c.yawRate, c.rpm, c.s, c.u].every(Number.isFinite);

// ---- 1. one AI car alone, 5 laps ------------------------------------------
{
  console.log("\n[solo] 1 AI car (skill 1), 5 flying laps after the standing start, dt 1/60");
  const g0 = core.GRID.slot(0);
  const car = P.createCar({ id: 0, number: 1, s: g0.s, u: g0.u });
  const d = AI.create(car, { skill: 1, aggression: 0.5, seed: 1 });
  d.rand = () => 0.5;                         // no mistakes: this measures the clean pace
  let t = 0, vmax = 0, vmin = 1e9, uMin = 1e9, uMax = -1e9, nan = false, latMax = 0;
  while (car.lapTimes.length < 6 && t < 200) {
    const inp = d.drive(car, [car], DT); P.step(car, inp, DT); t += DT;
    if (!finite(car)) { nan = true; break; }
    if (car.lapTimes.length >= 1) { vmax = Math.max(vmax, car.speed); vmin = Math.min(vmin, car.speed); latMax = Math.max(latMax, car.g.lat); }
    uMin = Math.min(uMin, car.u); uMax = Math.max(uMax, car.u);
  }
  const laps = car.lapTimes.slice(1);       // lap 1 is the standing start
  console.log(`  standing lap ${car.lapTimes[0].toFixed(2)} s, flying laps ${laps.map((x) => x.toFixed(2)).join(" ")} s`);
  console.log(`  best ${Math.min(...laps).toFixed(2)} s = ${kmh(L / Math.min(...laps))} km/h avg on ${L.toFixed(1)} m; top ${kmh(vmax)} km/h, min corner ${kmh(vmin)} km/h, peak tyre lat ${latMax.toFixed(2)} g (bank-loaded), u ${uMin.toFixed(1)}..${uMax.toFixed(1)}`);
  check(!nan, "no NaN");
  check(laps.every((x) => x > 13.5 && x < 15.5), "flying laps 13.5-15.5 s");
  check(vmax * 3.6 > 205 && vmax * 3.6 < 240, "top speed 205-240 km/h");
  check(vmin * 3.6 > 165 && vmin * 3.6 < 192, "min corner speed ~170-190 km/h");
  check(Object.values(car.damage).every((x) => x === 0), "clean: no damage");
}

// ---- 2. braking -----------------------------------------------------------
{
  console.log("\n[brake] 60 → 0 m/s, straight line, flat pad, pedal floored (threshold assist)");
  P.flat = true;
  const c = P.createCar({ s: 400, u: 0 });
  c.vel.x = 60 * Math.sin(c.yaw); c.vel.z = 60 * Math.cos(c.yaw); c.gear = 5; c.speed = 60;
  const x0 = c.pos.x, z0 = c.pos.z; let t = 0, peak = 0;
  while (c.speed > 0.2 && t < 20) { P.step(c, { brake: 1 }, DT); t += DT; peak = Math.max(peak, -c.g.long); }
  const dist = Math.hypot(c.pos.x - x0, c.pos.z - z0);
  console.log(`  ${dist.toFixed(1)} m in ${t.toFixed(2)} s (mean ${(60 / t / 9.81).toFixed(2)} g, peak tyre ${peak.toFixed(2)} g), disc heat F ${c.wheels[0].brakeHeat.toFixed(2)} R ${c.wheels[2].brakeHeat.toFixed(2)}`);
  check(dist > 95 && dist < 135, "stop distance 95-135 m (1.4-1.9 g)");
  P.flat = false;
}

// ---- 3. skidpad -------------------------------------------------------------
{
  console.log("\n[skidpad] steady max lateral g on a flat pad");
  P.flat = true;
  const res = {};
  for (const V of [30, 60]) {
    let best = 0;
    for (let st = 0.02; st < 0.7; st += 0.01) {
      const c = P.createCar({ s: 400, u: 0 });
      c.vel.x = V * Math.sin(c.yaw); c.vel.z = V * Math.cos(c.yaw); c.gear = V > 40 ? 5 : 3;
      let acc = 0, n = 0;
      for (let i = 0; i < 240; i++) {
        P.step(c, { steer: st, throttle: Math.max(0, Math.min(1, (V - c.speed) * 0.5 + 0.3)) }, DT);
        if (i > 180) { acc += c.g.lat; n++; }
      }
      if (Math.abs(c.speed - V) < 2 && Math.abs(Math.atan2(c.latSpeed, c.speed)) < 0.2) best = Math.max(best, acc / n);
    }
    res[V] = best;
  }
  console.log(`  30 m/s: ${res[30].toFixed(2)} g   60 m/s: ${res[60].toFixed(2)} g`);
  check(res[30] > 1.2 && res[30] < 1.6, "1.2-1.6 g at 30 m/s");
  check(res[60] > res[30] + 0.1, "downforce raises it at 60 m/s");
  P.flat = false;
}

// ---- 4. wall crash ----------------------------------------------------------
{
  console.log("\n[crash] 50 m/s into the outer wall at 20 deg (back straight)");
  const s = 400, f = core.frame(s);
  const c = P.createCar({ s, u: 2 });
  c.yaw = f.yaw - 20 * Math.PI / 180;                 // nose 20 deg to the right = toward the wall
  c.vel.x = 50 * Math.sin(c.yaw); c.vel.z = 50 * Math.cos(c.yaw); c.gear = 5;
  let uMax = -1e9, hitSeen = null;
  for (let i = 0; i < 180; i++) {
    P.step(c, { steer: 0, throttle: 0, brake: 0 }, DT);
    uMax = Math.max(uMax, c.u);
    if (c.fx.impact && !hitSeen) hitSeen = Object.assign({}, c.fx.impact);
  }
  const dm = c.damage;
  console.log(`  max u ${uMax.toFixed(2)} (wall face ${D.WALL_U}), speed now ${kmh(Math.hypot(c.vel.x, c.vel.z))} km/h, impact ${hitSeen ? hitSeen.part + " " + hitSeen.mag.toFixed(1) + " m/s" : "none"}, damage F${dm.front.toFixed(2)} R${dm.rear.toFixed(2)} L${dm.left.toFixed(2)} Rt${dm.right.toFixed(2)} eng ${dm.engine.toFixed(2)} aero ${dm.aero.toFixed(2)}`);
  check(uMax < D.WALL_U, "the body stays inside the wall (centre u < WALL_U)");
  check(!!hitSeen && dm.front + dm.right > 0.1, "damaged, fx.impact fired");
  check(Math.hypot(c.vel.x, c.vel.z) < 45, "slowed");
}

// ---- 5. contact: a tap in the rear quarter spins, door-to-door does not ------
{
  console.log("\n[tap] 50 m/s on a flat pad, a second car's nose moving sideways into the first");
  P.flat = true;
  const run = (dsB, lat) => {
    const f = core.frame(400);
    const A = P.createCar({ id: 0, s: 400, u: 0 }), B = P.createCar({ id: 1, s: 400 + dsB, u: -2.2 });
    for (const c of [A, B]) { c.vel.x = 50 * f.tx; c.vel.z = 50 * f.tz; c.gear = 5; c.speed = 50; }
    B.vel.x += f.nx * lat; B.vel.z += f.nz * lat;
    const y0 = A.yaw; let maxd = 0;
    for (let i = 0; i < 180; i++) {
      P.stepAll([A, B], [{ throttle: 0.3 }, { throttle: 0.3 }], DT);
      const d = Math.atan2(Math.sin(A.yaw - y0), Math.cos(A.yaw - y0));
      maxd = Math.max(maxd, Math.abs(d));
    }
    return maxd * 180 / Math.PI;
  };
  const quarter = run(-3.3, 4), door = run(0, 4);
  console.log(`  4 m/s into the rear quarter: the hit car yaws ${quarter.toFixed(0)} deg; 4 m/s door to door: ${door.toFixed(0)} deg`);
  check(quarter > 60, "a rear-quarter tap turns the car around");
  check(door < 15, "door-to-door contact does not");
  P.flat = false;
}

// ---- 6. the thumb: digital buttons through assistSteer --------------------------
{
  console.log("\n[thumb] player car, digital left/right buttons (-1/0/+1) through physics.assistSteer, stab 0.5, brake/throttle bang-bang");
  const thumb = (k) => {
    const g0 = core.GRID.slot(0), fr = {};
    const car = P.createCar({ s: g0.s, u: g0.u, isPlayer: true, assist: { stab: 0.5 } });
    let t = 0, hits = 0;
    while (car.lapTimes.length < 4 && t < 120) {
      core.frame(car.s, fr);
      const look = car.s + Math.max(car.speed, 5) * 0.6, tu = AI.lineU(look), f2 = core.frame(look);
      const px = f2.x + f2.nx * tu - car.pos.x, pz = f2.z + f2.nz * tu - car.pos.z;
      const ang = Math.atan2(px * Math.cos(car.yaw) - pz * Math.sin(car.yaw), px * Math.sin(car.yaw) + pz * Math.cos(car.yaw));
      const pred = ang - (car.yawRate - car.speed * fr.k) * 0.35;        // a thumb anticipates a little
      const raw = pred > 0.03 ? 1 : pred < -0.03 ? -1 : 0;
      const vt = AI.lineV(car.s + car.speed * 0.5) * k;
      P.step(car, { steer: P.assistSteer(car, raw, DT), throttle: car.speed < vt ? 1 : 0, brake: car.speed > vt + 2 ? 1 : 0 }, DT);
      t += DT; if (car.fx.impact) hits++;
    }
    const dm = Math.max(car.damage.front, car.damage.rear, car.damage.left, car.damage.right);
    return { laps: car.lapTimes.slice(1), hits, dm };
  };
  const ok = thumb(0.93), hot = thumb(1.10);
  console.log(`  at 93% of the AI's speeds: laps ${ok.laps.map((x) => x.toFixed(2)).join(" ")} s, ${ok.hits} impacts, worst corner damage ${ok.dm.toFixed(2)}`);
  console.log(`  overdriven (110%): laps ${hot.laps.map((x) => x.toFixed(2)).join(" ")} s, ${hot.hits} impacts, worst corner damage ${hot.dm.toFixed(2)} (not a rail)`);
  check(ok.laps.length === 3 && ok.laps.every((x) => x < 16.5), "a digital-button thumb laps cleanly (< 16.5 s)");
  check(ok.dm < 0.25, "without wrecking the car");
  check(hot.dm > ok.dm + 0.2, "overdriving it costs (walls, damage)");
}

// ---- 7. 10-car races --------------------------------------------------------
/* Three seeded races. The grid is the field presets SHUFFLED (a mixed-skill
   grid, as the game will run it with the player mid-pack); a grid sorted
   fastest-first is a procession and exercises nothing. */
function race(seed, verbose) {
  const N = 10, LAPS = 8;
  let r = seed >>> 0;
  const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
  const presets = AI.field(N, seed);
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [presets[i], presets[j]] = [presets[j], presets[i]]; }
  const cars = [], drivers = [];
  for (let i = 0; i < N; i++) {
    const g = core.GRID.slot(i);
    const c = P.createCar({ id: i, number: i + 1, s: g.s, u: g.u });
    cars.push(c); drivers.push(AI.create(c, presets[i]));
  }
  P.stats.contacts = 0; P.stats.hardContacts = 0;
  const inputs = new Array(N);
  let t = 0, nan = false, outside = 0, overtakes = 0, frames = 0, stepMs = 0, aiMs = 0, spins = 0;
  const grass = new Float64Array(N), finishT = new Array(N).fill(null), hardPerLap = new Array(LAPS + 2).fill(0);
  const wasRecover = new Array(N).fill(false);
  let order = cars.map((c) => c.id), lastHard = 0;
  while (t < 260 && finishT.some((x) => x == null)) {
    const a0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      inputs[i] = drivers[i].drive(cars[i], cars, DT);
    }
    const a1 = process.hrtime.bigint();
    P.stepAll(cars, inputs, DT);
    const a2 = process.hrtime.bigint();
    aiMs += Number(a1 - a0) / 1e6; stepMs += Number(a2 - a1) / 1e6; frames++;
    t += DT;
    for (let i = 0; i < N; i++) {
      const c = cars[i];
      if (!finite(c)) nan = true;
      if (c.u > D.WALL_U + 0.5) outside++;
      if (c.u < D.APRON_IN && finishT[i] == null) grass[i] += DT;
      if (finishT[i] == null && c.lap >= LAPS) { finishT[i] = t; drivers[i].cruise = 0.7; }   // cool-down lap
      const rec = drivers[i].state === "recover";
      if (rec && !wasRecover[i] && finishT[i] == null) spins++;
      wasRecover[i] = rec;
    }
    if (P.stats.hardContacts > lastHard) {
      const lead = Math.max(...cars.map((c) => c.lap));
      hardPerLap[Math.min(lead, LAPS + 1)] += P.stats.hardContacts - lastHard; lastHard = P.stats.hardContacts;
    }
    if (frames % 6 === 0) {
      const now = cars.slice().sort((a, b) => b.lapS - a.lapS).map((c) => c.id);
      for (let p = 0; p < N; p++) { const was = order.indexOf(now[p]); if (was > p) overtakes += was - p; }
      order = now;
    }
  }
  if (verbose) {
    const fin = cars.map((c, i) => ({ c, i, t: finishT[i] })).sort((a, b) => (a.t ?? 1e9) - (b.t ?? 1e9));
    console.log("  pos car  grid skill pace   best    finish   dmg   grass");
    fin.forEach((q, p) => {
      const c = q.c, dm = c.damage;
      console.log(`  ${String(p + 1).padStart(2)}  #${String(c.number).padEnd(3)} P${String(q.i + 1).padEnd(3)} ${drivers[q.i].skill.toFixed(2)}  ${drivers[q.i].pace.toFixed(3)}  ${c.bestLap ? c.bestLap.toFixed(2) : "-"}  ${q.t ? q.t.toFixed(2) : "DNF"}  ${Math.max(dm.front, dm.rear, dm.left, dm.right).toFixed(2)}  ${grass[q.i].toFixed(1)}s`);
    });
  }
  const win = Math.min(...finishT.filter((x) => x != null));
  console.log(`  seed ${seed}: winner ${win.toFixed(1)} s, last ${Math.max(...finishT.map((x) => x ?? 999)).toFixed(1)} s; position gains ${overtakes}; spins ${spins}; contact impulses ${P.stats.contacts}, hard (>3 m/s) ${P.stats.hardContacts} by leader lap [${hardPerLap.join(",")}]; max grass ${Math.max(...grass).toFixed(1)} s`);
  return { nan, outside, finishT, grass, overtakes, contacts: P.stats.contacts, hardPerLap, spins, stepMs: stepMs / frames, aiMs: aiMs / frames, presets, N };
}

if (!process.argv.includes("--quick")) {
  console.log(`\n[race] 10 AI cars from core.GRID (shuffled skills), 8 laps, dt 1/60, three seeds`);
  const runs = [race(777, true), race(2, false), race(3, false)];
  const perf = runs[0];
  console.log(`  perf: physics stepAll ${perf.stepMs.toFixed(3)} ms per 1/60 frame for 10 cars (2 substeps of dynamics + contact), AI ${perf.aiMs.toFixed(3)} ms for 10 drivers`);
  check(runs.every((q) => !q.nan), "no NaN");
  check(runs.every((q) => q.finishT.every((x) => x != null)), "all 10 finish, every race");
  check(runs.every((q) => q.outside === 0), "no car ever past the wall (u > WALL_U + 0.5)");
  check(runs.every((q) => Math.max(...q.grass) < 6), "no car on the infield grass for long (< 6 s)");
  check(runs.every((q) => q.overtakes >= 5), "positions change (>= 5 gains per race)");
  check(runs.reduce((a, q) => a + q.contacts, 0) > 0, "contacts happen");
  check(runs.every((q) => q.hardPerLap.filter((x) => x >= 4).length <= 2), "not a pile-up every lap");
  check(runs.every((q) => q.spins <= 6), "at most a handful of spins a race");
  // the field's pace spread measured the honest way: fastest and slowest preset, each alone, clean
  const presets = AI.field(10, 777);
  const solo = (pr) => {
    const g0 = core.GRID.slot(0), c = P.createCar({ s: g0.s, u: g0.u }), d = AI.create(c, pr);
    d.rand = () => 0.5; let t = 0;
    while (c.lapTimes.length < 2 && t < 60) { P.step(c, d.drive(c, [c], DT), DT); t += DT; }
    return c.lapTimes[1];
  };
  const fast = solo(presets[0]), slow = solo(presets[9]);
  console.log(`  preset pace alone: fastest ${fast.toFixed(2)} s (skill ${presets[0].skill.toFixed(2)}), slowest ${slow.toFixed(2)} s (skill ${presets[9].skill.toFixed(2)}): ${(slow - fast).toFixed(2)} s a lap`);
  check(slow - fast > 0.9 && slow - fast < 1.7, "field presets span ~1.0-1.5 s a lap");
}

console.log(fails ? `\n${fails} FAIL` : "\nall ok");
process.exit(fails ? 1 : 0);
