#!/usr/bin/env node
/* tools/moves-sim-prison.mjs — plain-node sims for the PRISON's use of
   CBZ.moves (src/entities/moves.js): entities/npc.js's inmate mover glue,
   entities/guards.js's walkTo/stand/patrolCorner, run against a tiny AABB
   wall world. No browser, no THREE. The glue functions below replicate the
   game code line for line (keep them in step with npc.js / guards.js).
   Run: node tools/moves-sim-prison.mjs      (exit 1 on any failure) */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { window: { CBZ: {} }, Math, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(path.join(root, "src/entities/moves.js"), "utf8"), ctx);
const CBZ = ctx.window.CBZ;
const M = CBZ.moves;
const wrap = M.wrap;
const DT = 1 / 60;

let fails = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) fails++;
}

// ---- a tiny wall world: AABBs, body radius 0.3 (systems/actorcollide.js) ----
const R = 0.3;
function collide(p, walls) {
  let hit = false;
  for (const w of walls) {
    if (p.x > w.x0 - R && p.x < w.x1 + R && p.z > w.z0 - R && p.z < w.z1 + R) {
      const pen = [p.z - (w.z0 - R), (w.z1 + R) - p.z, p.x - (w.x0 - R), (w.x1 + R) - p.x];
      const k = pen.indexOf(Math.min(...pen));
      if (k === 0) p.z = w.z0 - R; else if (k === 1) p.z = w.z1 + R;
      else if (k === 2) p.x = w.x0 - R; else p.x = w.x1 + R;
      hit = true;
    }
  }
  return hit;
}

/* ---- entities/npc.js glue, replicated -------------------------------------
   n: { pos, yaw, target:{x,z}, pause, _faceYaw, _faceTTL, route?:{pts,i,gx,gz} }
   `route` stands in for systems/navgrid.js's follower: it advances the
   waypoint at 0.55 m (prisonnav's `arrive`) and writes it to target. */
const MV_OPTS = { speed: 1.4, stop: 0.3, leg: false, face: null, strafe: false, nbrs: null, nbrN: 0, lod: 0, accel: 0 };
function navFollow(n) {
  const S = n.route;
  if (!S || !S.pts) return;
  while (S.i < S.pts.length && Math.hypot(S.pts[S.i].x - n.pos.x, S.pts[S.i].z - n.pos.z) <= 0.55) S.i++;
  if (S.i >= S.pts.length) { n.target.x = S.gx; n.target.z = S.gz; S.pts = null; return; }
  n.target.x = S.pts[S.i].x; n.target.z = S.pts[S.i].z;
}
function onLeg(n) {
  const S = n.route;
  if (S && S.pts && S.gx != null) return Math.hypot(n.target.x - S.gx, n.target.z - S.gz) > 0.3;
  return false;
}
function npcStep(n, speed, nbrs, dt) {
  navFollow(n);
  const m = M.motor(n);
  let faceY = null;
  if (n._faceTTL > 0) { n._faceTTL -= dt; faceY = n._faceYaw; }
  const O = MV_OPTS;
  const paused = n.pause > 0;
  if (paused) n.pause -= dt;
  O.lod = 0;
  O.face = faceY; O.strafe = faceY != null;
  O.nbrs = null; O.nbrN = 0;
  if (paused) {
    O.speed = 0; O.stop = 0.3; O.leg = false; O.accel = 0;
    M.step(m, n.pos, n.yaw, n.pos.x, n.pos.z, O, dt);
  } else {
    O.speed = speed > 0 ? speed : 0;
    O.stop = 0.3;
    O.leg = onLeg(n);
    O.accel = O.speed > 3 ? 5.2 : 0;
    if (nbrs && O.speed > 0) { O.nbrs = nbrs; O.nbrN = nbrs.length; }
    M.step(m, n.pos, n.yaw, n.target.x, n.target.z, O, dt);
  }
  n.yaw = m.yaw;
  n.anim = Math.min(m.gs, m.speed + 0.4);
  return m;
}

/* ---- entities/guards.js glue, replicated ---------------------------------- */
const GMV = { speed: 1.4, stop: 0.3, leg: false, face: null, strafe: false, nbrs: null, nbrN: 0, lod: 0, accel: 0, turnRate: 0 };
function walkTo(g, tx, tz, sp, dt, stop, leg) {
  const m = M.motor(g), O = GMV;
  O.speed = sp; O.stop = stop || 0.3; O.leg = !!leg;
  O.face = null; O.strafe = false; O.turnRate = 0; O.accel = sp > 3 ? 5.2 : 0; O.lod = 0;
  M.step(m, g.pos, g.yaw, tx, tz, O, dt);
  g.yaw = m.yaw;
  return Math.hypot(tx - g.pos.x, tz - g.pos.z);
}
function stand(g, dt) {
  const m = M.motor(g), O = GMV;
  O.speed = 0; O.stop = 0.3; O.leg = false; O.face = null; O.strafe = false;
  O.accel = 0; O.turnRate = 0; O.nbrs = null; O.nbrN = 0; O.lod = 1;
  M.step(m, g.pos, g.yaw, g.pos.x, g.pos.z, O, dt);
  g.yaw = m.yaw;
}
function patrolCorner(g, wps) {
  if (wps.length < 2) return false;
  const a = wps[g.wi], b = wps[(g.wi + 1) % wps.length], p = g.pos;
  const ix = a.x - p.x, iz = a.z - p.z, ox = b.x - a.x, oz = b.z - a.z;
  const il = Math.hypot(ix, iz), ol = Math.hypot(ox, oz);
  if (il < 1e-3 || ol < 1e-3) return false;
  return (ix * ox + iz * oz) / (il * ol) > -0.17;
}

// ===========================================================================
// 1. AN INMATE WALKS A 3-WAYPOINT ROUTE THROUGH A 1.1 m DOOR
//    wall along z = 5 (0.2 thick), door gap |x| < 0.55. From (-3, 0) to
//    (3, 9) by (0, 4.2) -> (0, 5.8) -> goal.
{
  const walls = [{ x0: -8, x1: -0.55, z0: 4.9, z1: 5.1 }, { x0: 0.55, x1: 8, z0: 4.9, z1: 5.1 }];
  const goal = { x: 3, z: 9 };
  const n = { pos: { x: -3, z: 0 }, yaw: 0, target: { x: goal.x, z: goal.z }, pause: 0,
    route: { pts: [{ x: 0, z: 4.2 }, { x: 0, z: 5.8 }, { x: 3, z: 9 }], i: 0, gx: goal.x, gz: goal.z } };
  let maxYaw = 0, arrivedAt = -1, overshoot = 0, jambHits = 0, stopStarts = 0, minLegSpeed = Infinity;
  let cruising = false, moveAfter = 0;
  const speed = 1.4;
  for (let i = 0; i < 60 * 14; i++) {
    const y0 = n.yaw;
    const m = npcStep(n, speed, null, DT);
    if (collide(n.pos, walls)) jambHits++;
    maxYaw = Math.max(maxYaw, Math.abs(wrap(n.yaw - y0)) / DT);
    const dGoal = Math.hypot(n.pos.x - goal.x, n.pos.z - goal.z);
    // stop-start: once cruising, speed dropping under 0.35 m/s anywhere but the final brake
    if (m.speed > speed * 0.8) cruising = true;
    if (cruising && arrivedAt < 0 && dGoal > 1.2) {
      minLegSpeed = Math.min(minLegSpeed, m.speed);
      if (m.speed < 0.35) stopStarts++;
    }
    // overshoot: past the goal along the last leg's direction (0.6, 0.8)
    const along = (n.pos.x - goal.x) * 0.684 + (n.pos.z - goal.z) * 0.729;
    overshoot = Math.max(overshoot, along);
    if (m.arrived && arrivedAt < 0) arrivedAt = i;
    if (arrivedAt >= 0 && i > arrivedAt) moveAfter += m.speed * DT;
  }
  const endD = Math.hypot(n.pos.x - goal.x, n.pos.z - goal.z);
  check("door route: arrives at the goal", arrivedAt > 0 && endD <= 0.31, `end ${endD.toFixed(3)} m at ${(arrivedAt * DT).toFixed(2)} s`);
  check("door route: no stop-start at the waypoints", stopStarts === 0 && minLegSpeed > 0.6, `min leg speed ${minLegSpeed.toFixed(2)} m/s, ${stopStarts} stalled frames`);
  check("door route: yaw rate <= 6 rad/s", maxYaw <= 6, `max ${maxYaw.toFixed(2)} rad/s`);
  check("door route: no overshoot at the end", overshoot < 0.01, `overshoot ${overshoot.toFixed(3)} m`);
  check("door route: no hunting after arrival", moveAfter < 0.02, `${moveAfter.toFixed(3)} m`);
  check("door route: clean through the door (<= 3 jamb frames)", jambHits <= 3, `${jambHits} frames touching a jamb`);
}

// ===========================================================================
// 2. A GUARD PATROL LOOP WITH TURNAROUNDS
//    (0,0) -> (0,10) corner -> (6,10) end of beat -> (0,10) corner -> (0,0) end
{
  const wps = [{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 6, z: 10 }, { x: 0, z: 10 }];
  const g = { pos: { x: 0, z: -2 }, yaw: 0, wi: 0 };
  const sp = 1.6;
  let maxYaw = 0, laps = 0, lastWi = 0, travelTurned = 0, minCorner = Infinity, overshoot = 0;
  const endMin = [Infinity, Infinity];   // min speed near each end of beat
  for (let i = 0; i < 60 * 60; i++) {
    const y0 = g.yaw, x0 = g.pos.x, z0 = g.pos.z;
    const wp = wps[g.wi];
    const corner = patrolCorner(g, wps);
    const d = walkTo(g, wp.x, wp.z, sp, DT, 0.3, corner);
    const m = M.motor(g);
    maxYaw = Math.max(maxYaw, Math.abs(wrap(g.yaw - y0)) / DT);
    // turn in place: ground covered while facing > 90 deg off the way he moves
    const mv = Math.hypot(g.pos.x - x0, g.pos.z - z0);
    if (mv > 1e-5) {
      const e = Math.abs(wrap(Math.atan2(g.pos.x - x0, g.pos.z - z0) - g.yaw));
      if (e > Math.PI / 2) travelTurned += mv;
    }
    // corners (index 1 and 3 both sit at (0,10)) walked through; ends braked into
    const atCorner = Math.hypot(g.pos.x, g.pos.z - 10) < 0.6;
    if (atCorner && i > 60) minCorner = Math.min(minCorner, m.speed);
    if (Math.hypot(g.pos.x - 6, g.pos.z - 10) < 0.6) endMin[0] = Math.min(endMin[0], m.speed);
    if (Math.hypot(g.pos.x, g.pos.z) < 0.6 && i > 600) endMin[1] = Math.min(endMin[1], m.speed);
    overshoot = Math.max(overshoot, g.pos.x - 6, i > 600 ? -g.pos.z : 0);
    if (d < 0.5) g.wi = (g.wi + 1) % wps.length;
    if (g.wi === 0 && lastWi !== 0) laps++;
    lastWi = g.wi;
  }
  check("patrol: completes laps", laps >= 2, `${laps} laps in 60 s`);
  check("patrol: yaw rate <= 6 rad/s (no snaps)", maxYaw <= 6, `max ${maxYaw.toFixed(2)} rad/s`);
  check("patrol: turns round IN PLACE (< 5 cm moonwalk)", travelTurned < 0.05, `${travelTurned.toFixed(3)} m while facing away`);
  check("patrol: brakes into each end of beat", endMin[0] < 0.2 && endMin[1] < 0.2, `min ${endMin[0].toFixed(2)} / ${endMin[1].toFixed(2)} m/s`);
  check("patrol: walks through the corner (no stop)", minCorner > 0.5, `min ${minCorner.toFixed(2)} m/s`);
  check("patrol: no overshoot at an end of beat", overshoot < 0.05, `${overshoot.toFixed(3)} m`);
}

// 2b. a sprinting guard told to stand brakes over a real distance, no spin
{
  const g = { pos: { x: 0, z: 0 }, yaw: 0 };
  for (let i = 0; i < 120; i++) walkTo(g, 0, 100, 1.6 * 1.7, DT);
  const z0 = g.pos.z, y0 = g.yaw, v0 = M.motor(g).speed;
  let t = 0;
  while (M.motor(g).speed > 0.01 && t < 3) { stand(g, DT); t += DT; }
  const slide = g.pos.z - z0;
  check("stand: a sprinting screw stops in a step or two", slide > 0.2 && slide < 1.2 && t < 1.0, `from ${v0.toFixed(2)} m/s: ${slide.toFixed(2)} m in ${t.toFixed(2)} s`);
  check("stand: no turn while braking", Math.abs(wrap(g.yaw - y0)) < 1e-6);
}

// ===========================================================================
// 3. TWO INMATES MEET IN A 2 m TIER WALKWAY (rail at x = +1, cell fronts at x = -1)
{
  const walls = [{ x0: -3, x1: -1, z0: -20, z1: 20 }, { x0: 1, x1: 3, z0: -20, z1: 20 }];
  const A = { pos: { x: 0.04, z: -9 }, yaw: 0, target: { x: 0, z: 9 }, pause: 0 };
  const B = { pos: { x: -0.04, z: 9 }, yaw: Math.PI, target: { x: 0, z: -9 }, pause: 0 };
  // CBZ.jailNbrs hands both bodies (itself included; the core skips its own pos)
  const nbrs = [A, B];
  let minD = Infinity, reversals = 0, lastLat = 0, lastSgn = 0, maxYaw = 0, wallFrames = 0;
  for (let i = 0; i < 60 * 18; i++) {
    const ya = A.yaw, yb = B.yaw;
    npcStep(A, 1.5, nbrs, DT);
    npcStep(B, 1.3, nbrs, DT);
    if (collide(A.pos, walls)) wallFrames++;
    if (collide(B.pos, walls)) wallFrames++;
    minD = Math.min(minD, Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z));
    maxYaw = Math.max(maxYaw, Math.abs(wrap(A.yaw - ya)) / DT, Math.abs(wrap(B.yaw - yb)) / DT);
    const dl = A.pos.x - lastLat; lastLat = A.pos.x;
    const s = Math.abs(dl) < 1e-4 ? 0 : Math.sign(dl);
    if (s && lastSgn && s !== lastSgn) reversals++;
    if (s) lastSgn = s;
  }
  const done = Math.hypot(A.pos.x, A.pos.z - 9) < 0.5 && Math.hypot(B.pos.x, B.pos.z + 9) < 0.5;
  check("walkway: both get past each other and arrive", done, `A z ${A.pos.z.toFixed(2)}, B z ${B.pos.z.toFixed(2)}`);
  check("walkway: never overlap (centres > 0.55 m)", minD > 0.55, `min ${minD.toFixed(3)} m`);
  check("walkway: no vibration (<= 3 lateral reversals)", reversals <= 3, `${reversals}`);
  check("walkway: yaw rate <= 6 rad/s", maxYaw <= 6, `max ${maxYaw.toFixed(2)} rad/s`);
}

// 3b. one man stood at the rail (arrived), another walks the walkway past him
{
  const walls = [{ x0: -3, x1: -1, z0: -20, z1: 20 }, { x0: 1, x1: 3, z0: -20, z1: 20 }];
  const S = { pos: { x: 0.1, z: 0 }, yaw: Math.PI / 2, target: { x: 0.1, z: 0 }, pause: 0 };
  const W = { pos: { x: 0, z: -8 }, yaw: 0, target: { x: 0, z: 8 }, pause: 0 };
  const nbrs = [S, W];
  let minD = Infinity, standerMoved = 0;
  for (let i = 0; i < 60 * 14; i++) {
    const sx = S.pos.x, sz = S.pos.z;
    npcStep(S, 1.4, nbrs, DT);
    npcStep(W, 1.4, nbrs, DT);
    collide(S.pos, walls); collide(W.pos, walls);
    standerMoved += Math.hypot(S.pos.x - sx, S.pos.z - sz);
    minD = Math.min(minD, Math.hypot(S.pos.x - W.pos.x, S.pos.z - W.pos.z));
  }
  check("walkway: walker passes a standing man without contact [core: moves.js avoid() follow must need along > 0.3]", minD > 0.55 && W.pos.z > 7.5, `min ${minD.toFixed(3)} m, walker z ${W.pos.z.toFixed(2)}`);
  check("walkway: the standing man is not jostled", standerMoved < 0.02, `${standerMoved.toFixed(3)} m`);
}

// ===========================================================================
// 4. FACE ORDERS AND PAUSES (ai.js / cellblock.js / guards.js questioning)
{
  // a man walking at 2.2 m/s is paused and ordered to face behind him
  const n = { pos: { x: 0, z: 0 }, yaw: 0, target: { x: 0, z: 50 }, pause: 0 };
  for (let i = 0; i < 90; i++) npcStep(n, 2.2, null, DT);
  const z0 = n.pos.z;
  n.pause = 1.5; n._faceYaw = Math.PI; n._faceTTL = 1.5;
  let maxYaw = 0, back = 0;
  for (let i = 0; i < 90; i++) {
    const y0 = n.yaw, zb = n.pos.z;
    npcStep(n, 2.2, null, DT);
    maxYaw = Math.max(maxYaw, Math.abs(wrap(n.yaw - y0)) / DT);
    if (n.pos.z < zb - 1e-6) back += zb - n.pos.z;
  }
  const slide = n.pos.z - z0;
  check("pause: brakes to a stop (no dead stop, no long slide)", slide > 0.05 && slide < 1.2, `${slide.toFixed(2)} m`);
  check("pause: face order turns him round at a bounded rate", Math.abs(wrap(n.yaw - Math.PI)) < 0.05 && maxYaw <= 6, `yaw err ${Math.abs(wrap(n.yaw - Math.PI)).toFixed(3)}, max ${maxYaw.toFixed(2)} rad/s`);
  check("pause: never slides backwards", back < 1e-3, `${back.toFixed(4)} m`);
}
{
  // ringing the player: walk a circle while holding a face on him (strafe)
  const P = { x: 0, z: 0 };
  const n = { pos: { x: 4.6, z: 0 }, yaw: 0, target: { x: 0, z: 0 }, pause: 0 };
  let maxYaw = 0, faceErr = 0;
  for (let i = 0; i < 60 * 6; i++) {
    const a = i * DT * 0.3;
    n.target.x = Math.cos(a + 0.35) * 4.6; n.target.z = Math.sin(a + 0.35) * 4.6;
    n._faceYaw = Math.atan2(P.x - n.pos.x, P.z - n.pos.z); n._faceTTL = 0.3;
    const y0 = n.yaw;
    npcStep(n, 1.2, null, DT);
    maxYaw = Math.max(maxYaw, Math.abs(wrap(n.yaw - y0)) / DT);
    if (i > 120) faceErr = Math.max(faceErr, Math.abs(wrap(n.yaw - Math.atan2(P.x - n.pos.x, P.z - n.pos.z))));
  }
  check("ring: holds his face on the mark while circling", faceErr < 0.15 && maxYaw <= 6, `face err ${faceErr.toFixed(3)} rad, max ${maxYaw.toFixed(2)} rad/s`);
}

// ===========================================================================
// 5. THE CROWD'S CHEAP PATH (entities/crowd.js fixedStep at 20 Hz, lod 1/2)
{
  const FIX = 1 / 20;
  const m = M.motor(null);
  const p = { x: 0, z: 0 };
  let heading = Math.PI, maxYaw = 0, over = 0;
  for (let i = 0; i < 20 * 8; i++) {
    const O = { speed: 1.6, stop: 0.45, leg: false, face: null, strafe: false, vffX: 0, vffZ: 0, lod: 1 };
    const h0 = heading;
    M.step(m, p, heading, 0, 5, O, FIX);
    heading = m.yaw;
    maxYaw = Math.max(maxYaw, Math.abs(wrap(heading - h0)) / FIX);
    over = Math.max(over, p.z - 5);
  }
  check("crowd: turns round before walking to a post (bounded yaw)", maxYaw <= 6, `max ${maxYaw.toFixed(2)} rad/s`);
  check("crowd: brakes into the post", m.arrived && over < 0.01 && Math.abs(p.z - 5) < 0.46, `end ${p.z.toFixed(2)}, over ${over.toFixed(3)}`);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
