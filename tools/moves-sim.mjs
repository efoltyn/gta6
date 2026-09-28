#!/usr/bin/env node
/* tools/moves-sim.mjs — plain-node sims for CBZ.moves (src/entities/moves.js).
   No browser, no THREE. Each scenario asserts the things the owner sees as
   "glitchy": overshoot at a goal, yaw snaps, two people vibrating when they
   meet, a detail zig-zagging behind a walking principal, bodies overlapping.
   Run: node tools/moves-sim.mjs            (exit 1 on any failure)
   Other files may add scenarios by exporting nothing — just append below. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { window: { CBZ: {} }, Math, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(path.join(root, "src/entities/moves.js"), "utf8"), ctx);
// optional extra modules (posture etc.) may be loaded by later scenarios
export const CBZ = ctx.window.CBZ;
const M = CBZ.moves;

let fails = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) fails++;
}
const DT = 1 / 60;
const wrap = M.wrap;

// ---------------------------------------------------------------------------
// 1. ARRIVAL: walk 6 m to a goal and stop — no overshoot, no hunting, yaw rate bounded
{
  const a = { pos: { x: 0, z: 0 }, yaw: Math.PI };           // facing AWAY from the goal
  const m = M.motor(a);
  let maxYawRate = 0, overshoot = 0, arrivedAt = -1, moveAfter = 0, maxSpeed = 0;
  for (let i = 0; i < 60 * 12; i++) {
    const y0 = a.yaw;
    M.step(m, a.pos, a.yaw, 0, 6, { speed: 1.4 }, DT);
    a.yaw = m.yaw;
    maxYawRate = Math.max(maxYawRate, Math.abs(wrap(a.yaw - y0)) / DT);
    overshoot = Math.max(overshoot, a.pos.z - 6);
    maxSpeed = Math.max(maxSpeed, m.speed);
    if (m.arrived && arrivedAt < 0) arrivedAt = i;
    if (arrivedAt >= 0 && i > arrivedAt) moveAfter += Math.hypot(m.vx, m.vz) * DT;
  }
  const endD = Math.hypot(a.pos.x, a.pos.z - 6);
  check("arrive: reaches goal", arrivedAt > 0 && endD <= 0.31, `end ${endD.toFixed(3)} m, arrived at ${(arrivedAt * DT).toFixed(2)} s`);
  check("arrive: no overshoot", overshoot < 0.01, `overshoot ${overshoot.toFixed(3)} m`);
  check("arrive: no hunting after arrival", moveAfter < 0.02, `${moveAfter.toFixed(3)} m after latch`);
  check("arrive: yaw rate bounded (<= 6 rad/s)", maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
  check("arrive: speed never over order", maxSpeed <= 1.401, `max ${maxSpeed.toFixed(3)}`);
}

// 1b. goal jitter of 2 cm around an arrived body never restarts a walk
{
  const a = { pos: { x: 0, z: 0 }, yaw: 0 };
  const m = M.motor(a);
  for (let i = 0; i < 400; i++) { M.step(m, a.pos, a.yaw, 0, 3, {}, DT); a.yaw = m.yaw; }
  let moved = 0, px = a.pos.x, pz = a.pos.z;
  for (let i = 0; i < 600; i++) {
    const j = Math.sin(i * 1.7) * 0.02;
    M.step(m, a.pos, a.yaw, j, 3 + j, {}, DT); a.yaw = m.yaw;
    moved += Math.hypot(a.pos.x - px, a.pos.z - pz); px = a.pos.x; pz = a.pos.z;
  }
  check("arrive: jittering goal holds still", moved < 0.01, `${moved.toFixed(4)} m`);
}

// 1c. turn in place: goal directly behind → pivots before stepping off
{
  const a = { pos: { x: 0, z: 0 }, yaw: 0 };
  const m = M.motor(a);
  let travelWhileTurned = 0;
  for (let i = 0; i < 180; i++) {
    const x0 = a.pos.x, z0 = a.pos.z;
    M.step(m, a.pos, a.yaw, 0, -5, { speed: 1.4 }, DT); a.yaw = m.yaw;
    const e = Math.abs(wrap(a.yaw - Math.PI));
    if (e > Math.PI / 2) travelWhileTurned += Math.hypot(a.pos.x - x0, a.pos.z - z0);
  }
  check("turn-in-place: < 5 cm travel while facing away", travelWhileTurned < 0.05, `${travelWhileTurned.toFixed(3)} m`);
}

// ---------------------------------------------------------------------------
// 2. CORRIDOR: two peds meet head-on in a 2 m corridor — pass, no vibration, no overlap
{
  const A = { pos: { x: 0.05, z: -8 }, yaw: 0 }, B = { pos: { x: -0.05, z: 8 }, yaw: Math.PI };
  const mA = M.motor(A), mB = M.motor(B);
  const both = [A, B];
  let minD = Infinity, reversals = 0, lastLatA = 0, lastSgn = 0, maxYawRate = 0;
  for (let i = 0; i < 60 * 16; i++) {
    const ya = A.yaw, yb = B.yaw;
    M.step(mA, A.pos, A.yaw, 0, 8, { speed: 1.4, nbrs: both }, DT); A.yaw = mA.yaw;
    M.step(mB, B.pos, B.yaw, 0, -8, { speed: 1.4, nbrs: both }, DT); B.yaw = mB.yaw;
    // corridor walls at |x| = 1.0 - radius
    for (const p of [A.pos, B.pos]) p.x = Math.max(-0.68, Math.min(0.68, p.x));
    minD = Math.min(minD, Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z));
    maxYawRate = Math.max(maxYawRate, Math.abs(wrap(A.yaw - ya)) / DT, Math.abs(wrap(B.yaw - yb)) / DT);
    const dLat = A.pos.x - lastLatA; lastLatA = A.pos.x;
    const s = Math.abs(dLat) < 1e-4 ? 0 : Math.sign(dLat);
    if (s && lastSgn && s !== lastSgn) reversals++;
    if (s) lastSgn = s;
  }
  const aDone = Math.hypot(A.pos.x, A.pos.z - 8) < 0.5, bDone = Math.hypot(B.pos.x, B.pos.z + 8) < 0.5;
  check("corridor: both reach the far end", aDone && bDone, `A ${A.pos.z.toFixed(2)} B ${B.pos.z.toFixed(2)}`);
  check("corridor: never overlap (centres > 0.55 m)", minD > 0.55, `min ${minD.toFixed(3)} m`);
  check("corridor: no lateral vibration (<= 3 reversals)", reversals <= 3, `${reversals} reversals`);
  check("corridor: yaw rate bounded", maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
}

// 2b. follow: a fast walker behind a slow one in a 1.2 m lane follows without bumping
{
  const S = { pos: { x: 0, z: 2 }, yaw: 0 }, F = { pos: { x: 0, z: 0 }, yaw: 0 };
  const mS = M.motor(S), mF = M.motor(F), both = [S, F];
  let minD = Infinity;
  for (let i = 0; i < 60 * 8; i++) {
    M.step(mS, S.pos, S.yaw, 0, 40, { speed: 0.8, nbrs: both }, DT); S.yaw = mS.yaw;
    M.step(mF, F.pos, F.yaw, 0, 40, { speed: 1.6, nbrs: both }, DT); F.yaw = mF.yaw;
    for (const p of [S.pos, F.pos]) p.x = Math.max(-0.3, Math.min(0.3, p.x));
    minD = Math.min(minD, Math.hypot(S.pos.x - F.pos.x, S.pos.z - F.pos.z));
  }
  check("lane: fast walker follows, no contact", minD > 0.6, `min gap ${minD.toFixed(3)} m`);
}

// ---------------------------------------------------------------------------
// 3. STUCK: a wall across the path → recovery fires, body gets round
{
  const a = { pos: { x: 0, z: 0 }, yaw: 0 };
  const m = M.motor(a);
  // wall: z in [2, 2.4], x in [-1.5, 1.5]
  for (let i = 0; i < 60 * 12; i++) {
    M.step(m, a.pos, a.yaw, 0, 6, { speed: 1.4 }, DT); a.yaw = m.yaw;
    const p = a.pos, r = 0.32;
    if (p.x > -1.5 - r && p.x < 1.5 + r && p.z > 2 - r && p.z < 2.4 + r) {
      // push out along the shallowest axis
      const pen = [p.z - (2 - r), (2.4 + r) - p.z, p.x - (-1.5 - r), (1.5 + r) - p.x];
      const k = pen.indexOf(Math.min(...pen));
      if (k === 0) p.z = 2 - r; else if (k === 1) p.z = 2.4 + r; else if (k === 2) p.x = -1.5 - r; else p.x = 1.5 + r;
    }
  }
  check("stuck: gets round a wall across the path", a.pos.z > 2.4, `z ${a.pos.z.toFixed(2)}, stuckN ${m.stuckN}`);
}

// ---------------------------------------------------------------------------
// 4. FORMATION: a 5-man detail follows a principal who walks, turns 90°, stops
{
  const P = { x: 0, z: 0, yaw: 0 };
  const Fm = M.formation();
  const local = [[-1.2, 1.2], [3, 0], [0.45, -3], [0.45, 3], [-3, 0]];
  const agents = local.map(([f, s]) => ({ pos: { x: s, z: f }, yaw: 0 }));
  const motors = agents.map((q) => M.motor(q));
  const out = {};
  let maxYawRate = 0, zig = 0, maxErrWalking = 0, reshuffles = 0, lastAsg = null, minPair = Infinity;
  const lastHead = agents.map(() => null);
  for (let i = 0; i < 60 * 24; i++) {
    const t = i * DT;
    // principal: walk +z 6 s, turn to +x over 1 s, walk 6 s, stop
    let vx = 0, vz = 0;
    if (t < 6) vz = 1.4;
    else if (t < 7) { const a = (t - 6) * Math.PI / 2; vx = Math.sin(a) * 1.4; vz = Math.cos(a) * 1.4; }
    else if (t < 13) vx = 1.4;
    P.x += vx * DT; P.z += vz * DT;
    if (vx || vz) P.yaw = Math.atan2(vx, vz);
    Fm.update(P.x, P.z, P.yaw, DT);
    const slots = local.map(([f, s]) => { const o = {}; Fm.slot(f, s, o); return o; });
    const asg = Fm.assign(agents, slots);
    if (lastAsg && asg.join() !== lastAsg) reshuffles++;
    lastAsg = asg.join();
    for (let k = 0; k < agents.length; k++) {
      const q = agents[k], m = motors[k], sl = slots[asg[k]];
      const y0 = q.yaw;
      const face = Fm.moving ? null : Fm.scan(k, sl.face, DT);
      M.step(m, q.pos, q.yaw, sl.x, sl.z, { speed: 2.6, vffX: sl.vx, vffZ: sl.vz, stop: 0.25, face, nbrs: agents }, DT);
      q.yaw = m.yaw;
      maxYawRate = Math.max(maxYawRate, Math.abs(wrap(q.yaw - y0)) / DT);
      // zig-zag: heading of the velocity flipping sides while the principal walks straight
      if (t > 2 && t < 5.5 && m.speed > 0.3) {
        const h = Math.atan2(m.vx, m.vz);
        if (lastHead[k] != null && Math.abs(wrap(h - lastHead[k])) > 0.06) zig++;
        lastHead[k] = h;
        maxErrWalking = Math.max(maxErrWalking, Math.hypot(q.pos.x - sl.x, q.pos.z - sl.z));
      }
    }
    for (let a = 0; a < agents.length; a++) for (let b = a + 1; b < agents.length; b++)
      minPair = Math.min(minPair, Math.hypot(agents[a].pos.x - agents[b].pos.x, agents[a].pos.z - agents[b].pos.z));
  }
  const settled = agents.every((q, k) => motors[k].speed < 0.05);
  check("formation: yaw rate bounded", maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
  check("formation: holds slot while walking straight (< 0.6 m)", maxErrWalking < 0.6, `max err ${maxErrWalking.toFixed(3)} m`);
  check("formation: no zig-zag (heading jumps)", zig < 5, `${zig} jumps`);
  check("formation: no reshuffling (<= 2 changes)", reshuffles <= 2, `${reshuffles}`);
  check("formation: agents never overlap", minPair > 0.6, `min ${minPair.toFixed(2)} m`);
  check("formation: everyone at rest after the stop", settled);
}

export function report() { return fails; }
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exit(fails ? 1 : 0);
}
