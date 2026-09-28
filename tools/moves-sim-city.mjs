#!/usr/bin/env node
/* tools/moves-sim-city.mjs — plain-node sims for the CITY's use of CBZ.moves.

   city/peds.js move() drives every city pedestrian through CBZ.moves.step
   with a fixed recipe; this file runs that recipe on bare {x,z} bodies (no
   browser, no THREE, no world) so the things the owner calls glitchy can be
   counted:
     1. PLAZA: 40 peds cross in two opposing streams (neighbour set = the
        nearest 8 inside 3.5 m, exactly gatherNbrs' rule) — overlaps, lateral
        reversals (the side-to-side dance), yaw rate.
     2. ROUTE: a 5-point routed walk round a corner — interior points are
        `leg:true` and advance inside 1.2 m (peds.js's path rule), the last is
        braked into — no stop-start at a waypoint.
     3. FACE, THEN WALK OFF BEHIND: a held facing (faceTo) turns a standing ped
        to the player, then an errand directly behind him — he turns in place
        and steps off, never walks backwards (moonwalk).
     4. MOVE ORDER + FEED-FORWARD: ped.moveOrder tracking a point that walks,
        turns 90 deg and walks on — steady error, no zig-zag.
     5. COST: 650 bodies at the tier mix peds.js passes (lod 0 near+drawn with
        neighbours, lod 1 drawn/important, lod 2 unseen) — microseconds/frame.
   Run: node tools/moves-sim-city.mjs   (exit 1 on any failure) */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { window: { CBZ: {} }, Math, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
// MOVES=<file> runs the same scenarios against a candidate core (for the lead)
vm.runInContext(readFileSync(process.env.MOVES || path.join(root, "src/entities/moves.js"), "utf8"), ctx);
const M = ctx.window.CBZ.moves;
const wrap = M.wrap;
const DT = 1 / 60;
const SEED = +process.env.SEED || 0;    // SEED=n reshuffles the plaza walkers' speeds

let fails = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) fails++;
}

// peds.js move()'s option recipe (the same fields, the same defaults)
function opts(o, a) {
  o.speed = a.speed; o.stop = a.stop != null ? a.stop : 0.45; o.leg = !!a.leg;
  o.accel = a.speed > 3 ? 5.5 : 3.6; o.face = a.face != null ? a.face : null; o.strafe = !!a.strafe;
  o.vffX = a.vffX || 0; o.vffZ = a.vffZ || 0; o.lod = a.lod || 0; o.nbrs = a.nbrs || null; o.nbrN = a.nbrN || 0;
  return o;
}
// gatherNbrs: nearest 8 live bodies within 3.5 m, nearest first
const NBR_CAP = 8, NBR_R2 = 3.5 * 3.5;
const _nb = new Array(NBR_CAP).fill(null), _nd = new Float64Array(NBR_CAP);
function gather(self, all) {
  let n = 0;
  for (const o of all) {
    if (o === self) continue;
    const dx = o.pos.x - self.pos.x, dz = o.pos.z - self.pos.z, d2 = dx * dx + dz * dz;
    if (d2 > NBR_R2 || d2 < 0.0004) continue;
    let at;
    if (n < NBR_CAP) { at = n; n++; } else { if (d2 >= _nd[NBR_CAP - 1]) continue; at = NBR_CAP - 1; }
    while (at > 0 && _nd[at - 1] > d2) { _nd[at] = _nd[at - 1]; _nb[at] = _nb[at - 1]; at--; }
    _nd[at] = d2; _nb[at] = o;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 1. PLAZA: two opposing streams of 20 cross a 30 m plaza
{
  const peds = [];
  for (let i = 0; i < 40; i++) {
    const north = i % 2 === 0;
    const lane = ((i >> 1) % 5) * 1.6 - 3.2 + (north ? 0.25 : -0.25);
    const row = Math.floor(i / 10);
    const z0 = north ? -15 - row * 2.2 : 15 + row * 2.2;
    peds.push({
      pos: { x: lane, z: z0 }, yaw: north ? 0 : Math.PI,
      gx: lane + (((i * 7) % 5) - 2) * 0.3, gz: north ? 18 + row * 2.2 : -18 - row * 2.2, spd: 1.3 + ((i * 13 + SEED) % 7) * 0.08,
      lastSgn: 0, rev: 0, jit: 0, lastRevF: -1e9,
    });
  }
  for (const p of peds) M.motor(p);
  const o = {};
  let minD = Infinity, overlapFrames = 0, overAtGoal = 0, maxYawRate = 0; let diagN = 0;
  for (let f = 0; f < 60 * 50; f++) {
    for (const p of peds) {
      const n = gather(p, peds);
      const y0 = p.yaw;
      M.step(p._mv, p.pos, p.yaw, p.gx, p.gz, opts(o, { speed: p.spd, nbrs: _nb, nbrN: n }), DT);
      p.yaw = p._mv.yaw;
      maxYawRate = Math.max(maxYawRate, Math.abs(wrap(p.yaw - y0)) / DT);
      // lateral reversal: sign of x-velocity flipping while actually side-stepping
      const vx = p._mv.vx;
      const s = Math.abs(vx) < 0.08 ? 0 : Math.sign(vx);
      if (s && p.lastSgn && s !== p.lastSgn) {
        p.rev++;
        if (f - p.lastRevF < 24) p.jit++;             // flipped back inside 0.4 s: a vibration, not a sidestep
        p.lastRevF = f;
      }
      if (s) p.lastSgn = s;
    }
    let over = false;
    for (let a = 0; a < peds.length; a++) for (let b = a + 1; b < peds.length; b++) {
      const d = Math.hypot(peds[a].pos.x - peds[b].pos.x, peds[a].pos.z - peds[b].pos.z);
      if (d < minD) minD = d;
      if (d < 0.5) {
        if (peds[a]._mv.arrived || peds[b]._mv.arrived) overAtGoal++;
        else {
          over = true;                                // two WALKING bodies inside each other
          if (process.env.DIAG && diagN++ < 12) {
            const A = peds[a], B = peds[b], f2 = (v) => v.toFixed(2);
            console.log(`DIAG  t ${f2(f * DT)} ${a}${a % 2 ? "S" : "N"}/${b}${b % 2 ? "S" : "N"} d ${f2(d)}  A (${f2(A.pos.x)},${f2(A.pos.z)}) v (${f2(A._mv.vx)},${f2(A._mv.vz)})  B (${f2(B.pos.x)},${f2(B.pos.z)}) v (${f2(B._mv.vx)},${f2(B._mv.vz)})`);
          }
        }
      }
    }
    if (over) overlapFrames++;
  }
  const arrived = peds.filter((p) => p._mv.arrived || Math.hypot(p.pos.x - p.gx, p.pos.z - p.gz) < 0.8).length;
  const revTotal = peds.reduce((s, p) => s + p.rev, 0), jitTotal = peds.reduce((s, p) => s + p.jit, 0);
  check("plaza: everybody crosses", arrived === 40, `${arrived}/40 at their goal`);
  check("plaza: walking bodies never overlap (centres < 0.5 m)", overlapFrames === 0,
    `${overlapFrames} frames; min centre gap ${minD.toFixed(3)} m overall`);
  console.log(`INFO  plaza: ${overAtGoal} pair-frames < 0.5 m brushing past a body already standing on its goal`);
  console.log(`INFO  plaza: ${(revTotal / 40).toFixed(2)} lateral reversals per ped (a sidestep and its return count 1 each; ~15 oncoming passes per ped)`);
  check("plaza: no side-to-side vibration (<= 40 flip-backs inside 0.4 s, all 40)", jitTotal <= 40, `${jitTotal} vibration flips (dense 40-body cross-flow; pre-wave core 33-47 WITH overlaps)`);
  check("plaza: yaw rate bounded (<= 6 rad/s)", maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
}

// ---------------------------------------------------------------------------
// 2. ROUTE: a 5-point path round a corner, walked through (legs) and braked at the end
{
  const path0 = [{ x: 0, z: 6 }, { x: 0, z: 12 }, { x: 4, z: 15 }, { x: 10, z: 15 }, { x: 16, z: 15 }];
  const a = { pos: { x: 0, z: 0 }, yaw: 0, path: path0.slice() };
  const m = M.motor(a);
  const o = {};
  const cruise = 1.6;
  const atWp = [];
  let overshoot = 0, arrivedT = -1, maxYawRate = 0;
  for (let f = 0; f < 60 * 25; f++) {
    // peds.js: advance interior points inside 1.2 m while moving; the last inside 0.6
    if (a.path.length) {
      const p0 = a.path[0], pass = a.path.length > 1 ? 1.2 : 0.6;
      if (Math.hypot(p0.x - a.pos.x, p0.z - a.pos.z) <= pass) {
        if (a.path.length > 1) atWp.push(m.speed);
        a.path.shift();
      }
    }
    const tgt = a.path.length ? a.path[0] : path0[path0.length - 1];
    const y0 = a.yaw;
    M.step(m, a.pos, a.yaw, tgt.x, tgt.z, opts(o, { speed: cruise, leg: a.path.length > 1 }), DT);
    a.yaw = m.yaw;
    maxYawRate = Math.max(maxYawRate, Math.abs(wrap(a.yaw - y0)) / DT);
    overshoot = Math.max(overshoot, a.pos.x - 16);
    if (m.arrived && arrivedT < 0) arrivedT = f * DT;
  }
  const minWp = Math.min(...atWp);
  check("route: passes every interior waypoint at speed (> 70% cruise)", atWp.length === 4 && minWp > 0.7 * cruise,
    `speeds ${atWp.map((v) => v.toFixed(2)).join(", ")} (cruise ${cruise})`);
  check("route: brakes into the final point, no overshoot", arrivedT > 0 && overshoot < 0.05,
    `arrived ${arrivedT.toFixed(2)} s, overshoot ${overshoot.toFixed(3)} m`);
  check("route: yaw rate bounded", maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
}

// ---------------------------------------------------------------------------
// 3. FACE THE PLAYER, THEN WALK OFF BEHIND HIMSELF
{
  const a = { pos: { x: 0, z: 0 }, yaw: 0 };          // facing +z
  const m = M.motor(a);
  const o = {};
  const player = { x: 0.4, z: -3 };                  // behind him
  let drift = 0, maxYawRate = 0, backwards = 0, crab = 0;
  // 1.2 s of "turn and look at you" (spd 0, held facing, peds.js standing branch)
  for (let f = 0; f < 72; f++) {
    const y0 = a.yaw, x0 = a.pos.x, z0 = a.pos.z;
    const face = Math.atan2(player.x - a.pos.x, player.z - a.pos.z);
    M.step(m, a.pos, a.yaw, a.pos.x, a.pos.z, opts(o, { speed: 0, face }), DT);
    a.yaw = m.yaw;
    drift += Math.hypot(a.pos.x - x0, a.pos.z - z0);
    maxYawRate = Math.max(maxYawRate, Math.abs(wrap(a.yaw - y0)) / DT);
  }
  const faced = Math.abs(wrap(a.yaw - Math.atan2(player.x, player.z)));
  // now an errand 8 m behind him (+z, where he faced before)
  for (let f = 0; f < 60 * 8; f++) {
    const y0 = a.yaw, x0 = a.pos.x, z0 = a.pos.z;
    M.step(m, a.pos, a.yaw, 0, 8, opts(o, { speed: 1.5 }), DT);
    a.yaw = m.yaw;
    const vx = (a.pos.x - x0) / DT, vz = (a.pos.z - z0) / DT;
    const fwd = vx * Math.sin(a.yaw) + vz * Math.cos(a.yaw);
    const lat = Math.abs(vx * Math.cos(a.yaw) - vz * Math.sin(a.yaw));
    if (fwd < -0.05) backwards++;
    if (Math.hypot(vx, vz) > 0.3 && lat > 0.6 * Math.hypot(vx, vz)) crab++;
    maxYawRate = Math.max(maxYawRate, Math.abs(wrap(a.yaw - y0)) / DT);
  }
  check("face: turns to the player on the spot", faced < 0.05 && drift < 0.01, `err ${faced.toFixed(3)} rad, drift ${drift.toFixed(3)} m`);
  check("face->walk: never walks backwards (no moonwalk)", backwards === 0, `${backwards} frames`);
  check("face->walk: no crabbing (lateral > 60% of speed for <= 0.1 s)", crab <= 6, `${crab} frames`);
  check("face->walk: reaches the errand", m.arrived, `end z ${a.pos.z.toFixed(2)}`);
  check("face->walk: yaw rate bounded", maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
}

// ---------------------------------------------------------------------------
// 4. MOVE ORDER with feed-forward, tracking a point that walks, turns, walks on
{
  const P = { x: 0, z: 0 };
  const a = { pos: { x: 1.5, z: -2 }, yaw: 0 };
  const m = M.motor(a);
  const o = {};
  let maxErr = 0, sumErr = 0, nErr = 0, zig = 0, lastH = null, maxYawRate = 0;
  for (let f = 0; f < 60 * 16; f++) {
    const t = f * DT;
    let vx = 0, vz = 0;
    if (t < 6) vz = 1.4;
    else if (t < 7) { const k = (t - 6) * Math.PI / 2; vx = Math.sin(k) * 1.4; vz = Math.cos(k) * 1.4; }
    else if (t < 14) vx = 1.4;
    P.x += vx * DT; P.z += vz * DT;
    // the order: a shoulder slot 1 m right of him, fed forward with his velocity
    const h = Math.atan2(vx || 1e-9, vz);
    const ox = P.x + Math.cos(h) * 1.0, oz = P.z - Math.sin(h) * 1.0;
    const order = { x: ox, z: oz, speed: 2.4, stop: 0.2, vffX: vx, vffZ: vz };
    const y0 = a.yaw;
    M.step(m, a.pos, a.yaw, order.x, order.z, opts(o, order), DT);
    a.yaw = m.yaw;
    maxYawRate = Math.max(maxYawRate, Math.abs(wrap(a.yaw - y0)) / DT);
    const straight = (t > 2.5 && t < 5.8) || (t > 9 && t < 13.8);
    if (straight) {
      const e = Math.hypot(a.pos.x - ox, a.pos.z - oz);
      maxErr = Math.max(maxErr, e); sumErr += e; nErr++;
      if (m.speed > 0.3) {
        const hv = Math.atan2(m.vx, m.vz);
        if (lastH != null && Math.abs(wrap(hv - lastH)) > 0.05) zig++;
        lastH = hv;
      }
    } else lastH = null;
  }
  check("order+ff: steady tracking error < 0.5 m", maxErr < 0.5, `max ${maxErr.toFixed(3)} m, mean ${(sumErr / nErr).toFixed(3)} m`);
  check("order+ff: no zig-zag (heading jumps)", zig < 5, `${zig} jumps`);
  check("order+ff: yaw rate bounded", maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
}

// ---------------------------------------------------------------------------
// 5. COST: 650 bodies at peds.js's tier mix
{
  const N = 650, NEAR = 110, DRAWN = 220;           // lod 0 / lod 1 / rest lod 2
  const bodies = [];
  for (let i = 0; i < N; i++) {
    const r = i < NEAR ? 25 : i < NEAR + DRAWN ? 70 : 200;
    const ang = i * 2.399963;
    const b = { pos: { x: Math.cos(ang) * r * Math.sqrt((i % 97) / 97 + 0.05), z: Math.sin(ang) * r * Math.sqrt((i % 89) / 89 + 0.05) }, yaw: ang, lod: i < NEAR ? 0 : i < NEAR + DRAWN ? 1 : 2 };
    // far goals: every body is WALKING for the whole measurement (the expensive case)
    b.gx = b.pos.x + Math.cos(ang * 3) * 1000; b.gz = b.pos.z + Math.sin(ang * 3) * 1000;
    M.motor(b);
    bodies.push(b);
  }
  // the near crowd packed into a 25 m disc so each has real neighbours (worst case)
  const near = bodies.slice(0, NEAR);
  const o = {};
  const frame = (count) => {
    for (const b of bodies) {
      let n = 0;
      if (b.lod === 0) n = gather(b, near);
      M.step(b._mv, b.pos, b.yaw, b.gx, b.gz, opts(o, { speed: 1.5, lod: b.lod, nbrs: n ? _nb : null, nbrN: n }), DT);
      b.yaw = b._mv.yaw;
      if (count) nbSum += n;
    }
  };
  let nbSum = 0;
  for (let i = 0; i < 120; i++) frame(false);        // warm the JIT
  const F = 600;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < F; i++) frame(true);
  const us = Number(process.hrtime.bigint() - t0) / 1000 / F;
  // the step alone (the neighbour gather above is a brute-force stand-in for the grid)
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < F; i++) for (const b of bodies) {
    M.step(b._mv, b.pos, b.yaw, b.gx, b.gz, opts(o, { speed: 1.5, lod: b.lod, nbrs: b.lod === 0 ? near : null, nbrN: b.lod === 0 ? 8 : 0 }), DT);
    b.yaw = b._mv.yaw;
  }
  const usStep = Number(process.hrtime.bigint() - t1) / 1000 / F;
  // as the game schedules it: the unseen lod-2 mass integrates every 2nd frame
  // at Best quality (moveStride 2..8 by tier), with the banked dt sub-stepped
  const t2 = process.hrtime.bigint();
  for (let i = 0; i < F; i++) for (let k = 0; k < bodies.length; k++) {
    const b = bodies[k];
    if (b.lod === 2 && ((i + k) & 1)) continue;
    M.step(b._mv, b.pos, b.yaw, b.gx, b.gz, opts(o, { speed: 1.5, lod: b.lod, nbrs: b.lod === 0 ? near : null, nbrN: b.lod === 0 ? 8 : 0 }), b.lod === 2 ? DT * 2 : DT);
    b.yaw = b._mv.yaw;
  }
  const usSched = Number(process.hrtime.bigint() - t2) / 1000 / F;
  console.log(`INFO  cost: ${usSched.toFixed(0)} us/frame with the lod-2 mass on the game's every-2nd-frame stride`);
  console.log(`INFO  cost: 650 bodies (${NEAR} lod0 / ${DRAWN} lod1 / ${N - NEAR - DRAWN} lod2), mean ${(nbSum / F / NEAR).toFixed(1)} nbrs per lod0 body`);
  console.log(`INFO  cost: ${us.toFixed(0)} us/frame incl. brute-force gather, ${usStep.toFixed(0)} us/frame step only`);
  check("cost: 650 steps under 1.5 ms/frame", usStep < 1500, `${usStep.toFixed(0)} us`);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
