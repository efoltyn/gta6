#!/usr/bin/env node
/* tools/moves-sim-formation.mjs — plain-node sims for FORMATION movement on
   CBZ.moves: the President's detail / an officeholder's escort (the REAL
   city/protection.js code, vm-loaded with a stub world), a warlord section
   marching and wheeling (battle.js stepSquad, replicated), and a gun-game bot
   strafing while it keeps its chest on a target.

   The owner's complaint was "the President's security moves glitchily, not
   natural": surge-and-stop at the slots, heading snaps, walk/idle flicker.
   Each scenario asserts the numbers that complaint is made of.
   Run: node tools/moves-sim-formation.mjs     (exit 1 on any failure) */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// a stub world: enough CBZ for protection.js to load and publish CBZ.protection
const UPD = [];
const CBZ = { game: {}, now: 0, onUpdate(p, fn) { UPD.push([p, fn]); }, onNewDay() {} };
const ctx = { window: { CBZ }, Math, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(path.join(root, "src/entities/moves.js"), "utf8"), ctx);
// the detail's DECISIONS (roles, slot table, looks, panic) are CBZ.brain's
// detail brain; protection.js hands every escort to it (index.html order:
// brain.js early, brain_protection.js before protection.js)
vm.runInContext(readFileSync(path.join(root, "src/systems/brain.js"), "utf8"), ctx);
vm.runInContext(readFileSync(path.join(root, "src/city/brain_protection.js"), "utf8"), ctx);
vm.runInContext(readFileSync(path.join(root, "src/city/protection.js"), "utf8"), ctx);
const M = CBZ.moves, PR = CBZ.protection;
if (!M || !PR || !PR.driveEscort) { console.log("FAIL  could not load moves.js + protection.js"); process.exit(1); }

let fails = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) fails++;
}
const DT = 1 / 60;
const wrap = M.wrap;

function body(x, z, yaw) {
  return { pos: { x, y: 0, z }, group: { rotation: { y: yaw || 0 } }, target: { x, z, set(a, b, c) { this.x = a; this.z = c; } }, dead: false };
}
/* peds.js's side of the seam, as the CITY builder implements it: a ped with a
   moveOrder is stepped through CBZ.moves toward it with its options. */
const _o = {};
function execOrder(q, nbrs, dt) {
  const o = q.moveOrder; if (!o) return null;
  const m = M.motor(q);
  Object.assign(_o, o); _o.nbrs = nbrs; _o.nbrN = nbrs.length;
  M.step(m, q.pos, q.group.rotation.y, o.x, o.z, _o, dt);
  q.group.rotation.y = m.yaw;
  return m;
}

// ---------------------------------------------------------------------------
// 1. THE DETAIL: five agents with a principal who walks, turns 90 degrees,
//    speeds up to a run, stops, then turns on the spot.
{
  const P = body(0, 0, 0);
  const det = { id: "sim", formation: "escort", memberPedRefs: [] };
  for (let i = 0; i < 5; i++) {
    const sl = PR.formationSlot(i, 5, "open");
    det.memberPedRefs.push(body(sl.s * -1, sl.f, 0));   // (x = -s: the right side is -x at yaw 0) start near their slots
  }
  const agents = det.memberPedRefs, everyone = agents.concat([P]);
  const STOP = 18, TURN0 = 21;
  let maxYawRate = 0, zig = 0, maxErrWalk = 0, churn = 0, lastAsg = null, minPair = Infinity, maxStep = 0;
  let restAt = -1, restOK = false;
  const lastHead = agents.map(() => null);
  const faceErr = agents.map(() => 0);
  for (let i = 0; i < 60 * 34; i++) {
    const t = i * DT;
    CBZ.now = t * 1000;
    let vx = 0, vz = 0;
    if (t < 6) vz = 1.4;
    else if (t < 7) { const a = (t - 6) * Math.PI / 2; vx = Math.sin(a) * 1.4; vz = Math.cos(a) * 1.4; }
    else if (t < 11) vx = 1.4;
    else if (t < STOP) { const s = Math.min(5, 1.4 + (t - 11) * 2.4); vx = s; }
    else if (t < STOP + 0.8) vx = 5 * (1 - (t - STOP) / 0.8);      // a runner stops in ~0.8 s
    P.pos.x += vx * DT; P.pos.z += vz * DT;
    if (vx || vz) P.group.rotation.y = Math.atan2(vx, vz);
    // turn on the spot: 180 degrees over 2 s
    if (t >= TURN0 && t < TURN0 + 2) P.group.rotation.y = Math.PI / 2 + (t - TURN0) / 2 * Math.PI;
    PR.driveEscort(det, P, DT);
    const asg = det._F._asg ? det._F._asg.join() : "";
    if (lastAsg != null && asg !== lastAsg) churn++;
    lastAsg = asg;
    for (let k = 0; k < agents.length; k++) {
      const q = agents[k], y0 = q.group.rotation.y, x0 = q.pos.x, z0 = q.pos.z;
      const m = execOrder(q, everyone, DT);
      maxYawRate = Math.max(maxYawRate, Math.abs(wrap(q.group.rotation.y - y0)) / DT);
      maxStep = Math.max(maxStep, Math.hypot(q.pos.x - x0, q.pos.z - z0));
      if (t > 2 && t < 5.5) {
        if (m.speed > 0.3) {
          const h = Math.atan2(m.vx, m.vz);
          if (lastHead[k] != null && Math.abs(wrap(h - lastHead[k])) > 0.06) zig++;
          lastHead[k] = h;
        }
        maxErrWalk = Math.max(maxErrWalk, Math.hypot(q.pos.x - q.moveOrder.x, q.pos.z - q.moveOrder.z));
      }
      // (the CP is exempt: the detail brain's shift leader stands at his
      // shoulder watching the crowd AHEAD of the man, not out behind him)
      if (t > TURN0 + 9 && !(q._det && q._det.kind === "cp")) {
        const o = q.moveOrder;
        // outward: the agent's facing vs his slot's bearing from the principal
        const bearing = Math.atan2(o.x - P.pos.x, o.z - P.pos.z);
        faceErr[k] = Math.max(faceErr[k], Math.abs(wrap(q.group.rotation.y - bearing)));
      }
    }
    for (let a = 0; a < agents.length; a++) for (let b = a + 1; b < agents.length; b++)
      minPair = Math.min(minPair, Math.hypot(agents[a].pos.x - agents[b].pos.x, agents[a].pos.z - agents[b].pos.z));
    if (t > STOP && restAt < 0 && agents.every((q) => q._mv.speed < 0.05)) restAt = t;
    if (Math.abs(t - (STOP + 2.8)) < DT / 2) restOK = agents.every((q) => q._mv.gs < 0.1);
  }
  check("detail: slot error walking straight < 0.6 m", maxErrWalk < 0.6, `max ${maxErrWalk.toFixed(3)} m`);
  check("detail: heading jumps < 5 (no zig-zag)", zig < 5, `${zig}`);
  check("detail: no reassignment churn (<= 2 changes)", churn <= 2, `${churn}`);
  check("detail: agents never overlap (> 0.6 m)", minPair > 0.6, `min ${minPair.toFixed(2)} m`);
  const STOPPED = STOP + 0.8;                                      // his feet are still
  check("detail: all at rest within 2 s of the stop", restAt > 0 && restAt - STOPPED <= 2 && restOK, `rest ${(restAt - STOPPED).toFixed(2)} s after`);
  check("detail: yaw rate <= 6 rad/s", maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
  check("detail: nobody faster than 1.3x his run (0.108 m/frame)", maxStep <= 5 * 1.3 * DT, `max ${maxStep.toFixed(3)} m/frame`);
  const worstFace = Math.max(...faceErr);
  check("detail: at rest every agent faces out (+-0.8 rad of slot bearing)", worstFace <= 0.8, `worst ${worstFace.toFixed(2)} rad`);
}

// ---------------------------------------------------------------------------
// 2. MODE BLEND: open -> door -> open while he walks. No body jumps.
{
  const P = body(0, 0, 0);
  const det = { id: "sim2", formation: "escort", memberPedRefs: [] };
  for (let i = 0; i < 5; i++) { const sl = PR.formationSlot(i, 5, "open"); det.memberPedRefs.push(body(-sl.s, sl.f, 0)); }
  const agents = det.memberPedRefs, everyone = agents.concat([P]);
  let maxStep = 0, maxSlotStep = 0, maxYawRate = 0, minPair = Infinity;
  const lastSlot = agents.map(() => null);
  for (let i = 0; i < 60 * 14; i++) {
    const t = i * DT;
    CBZ.now = t * 1000;
    P.pos.z += 1.4 * DT;
    const mode = t >= 4 && t < 8 ? "door" : "open";
    PR.driveEscort(det, P, DT, mode);
    for (let k = 0; k < agents.length; k++) {
      const q = agents[k], x0 = q.pos.x, z0 = q.pos.z, y0 = q.group.rotation.y;
      execOrder(q, everyone, DT);
      maxStep = Math.max(maxStep, Math.hypot(q.pos.x - x0, q.pos.z - z0));
      maxYawRate = Math.max(maxYawRate, Math.abs(wrap(q.group.rotation.y - y0)) / DT);
      const o = q.moveOrder;
      if (lastSlot[k] && t > 1) maxSlotStep = Math.max(maxSlotStep, Math.hypot(o.x - lastSlot[k][0], o.z - lastSlot[k][1]) - 1.4 * DT);
      lastSlot[k] = [o.x, o.z];
    }
    for (let a = 0; a < agents.length; a++) for (let b = a + 1; b < agents.length; b++)
      { const dd = Math.hypot(agents[a].pos.x - agents[b].pos.x, agents[a].pos.z - agents[b].pos.z);
        if (process.env.SIM_DEBUG && dd < 0.7 && dd < minPair) console.log(`  blend close t=${t.toFixed(2)} ${a}/${b} ${dd.toFixed(2)} asg ${det._F._asg}`);
        minPair = Math.min(minPair, dd); }
  }
  check("mode blend: no agent moves > 0.1 m in a frame", maxStep <= 0.1, `max ${maxStep.toFixed(3)} m/frame`);
  check("mode blend: slots glide (< 0.1 m/frame beyond his pace)", maxSlotStep < 0.1, `max ${maxSlotStep.toFixed(3)} m/frame`);
  check("mode blend: yaw rate <= 6 rad/s", maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
  check("mode blend: agents never overlap (> 0.6 m)", minPair > 0.6, `min ${minPair.toFixed(2)} m`);
}

// ---------------------------------------------------------------------------
// 2b. THE PRESIDENT, through protection.js's own per-frame tick: the player
//     is President, his standing detail of five comes on shift behind him,
//     falls in, walks with him, jogs, stops and settles looking out.
{
  const peds = [];
  CBZ.game.mode = "city";
  CBZ.city = { arena: { root: { add() {} } } };
  CBZ.player = { pos: { x: 0, y: 0, z: 0 }, dead: false };
  CBZ.playerChar = { group: { rotation: { y: 0 } } };
  CBZ.presidency = { current() { return { kind: "player", seatId: "s1", sid: "player" }; } };
  CBZ.cityPeds = peds;
  CBZ.cityMakePed = (x, z) => { const q = body(x, z, 0); q.baseSpeed = 1.6; return q; };
  const ticks = UPD.filter((u) => u[0] === 35.75 || u[0] === 35.795).map((u) => u[1]);
  const P = CBZ.player;
  let maxYawRate = 0, zig = 0, maxErrWalk = 0, minPair = Infinity, restAt = -1, n = 0;
  const lastHead = new Map(), faceErr = new Map();
  const WALK0 = 8, JOG0 = 16, STOP = 22;
  for (let i = 0; i < 60 * 34; i++) {
    const t = i * DT;
    CBZ.now = t * 1000;
    let v = 0;
    if (t >= WALK0 && t < JOG0) v = 1.4;
    else if (t >= JOG0 && t < STOP) v = 3.5;
    else if (t >= STOP && t < STOP + 0.5) v = 3.5 * (1 - (t - STOP) / 0.5);
    P.pos.z += v * DT;
    for (const f of ticks) f(DT);
    const agents = peds.filter((q) => q._protUnit);
    n = agents.length;
    const everyone = agents.concat([{ pos: P.pos, _mv: null }]);
    for (const q of agents) {
      const y0 = q.group.rotation.y;
      const m = execOrder(q, everyone, DT);
      if (!m) continue;
      maxYawRate = Math.max(maxYawRate, Math.abs(wrap(q.group.rotation.y - y0)) / DT);
      if (t > WALK0 + 3 && t < JOG0) {
        if (m.speed > 0.3) {
          const h = Math.atan2(m.vx, m.vz), lh = lastHead.get(q);
          if (lh != null && Math.abs(wrap(h - lh)) > 0.06) zig++;
          lastHead.set(q, h);
        }
        maxErrWalk = Math.max(maxErrWalk, Math.hypot(q.pos.x - q.moveOrder.x, q.pos.z - q.moveOrder.z));
      }
      if (t > STOP + 6 && !(q._det && q._det.kind === "cp")) {   // the CP watches ahead (see above)
        const o = q.moveOrder, bearing = Math.atan2(o.x - P.pos.x, o.z - P.pos.z);
        faceErr.set(q, Math.max(faceErr.get(q) || 0, Math.abs(wrap(q.group.rotation.y - bearing))));
      }
    }
    if (t > WALK0) for (let a = 0; a < everyone.length; a++) for (let b = a + 1; b < everyone.length; b++)
      minPair = Math.min(minPair, Math.hypot(everyone[a].pos.x - everyone[b].pos.x, everyone[a].pos.z - everyone[b].pos.z));
    if (t > STOP + 0.5 && restAt < 0 && agents.length && agents.every((q) => q._mv && q._mv.speed < 0.05)) restAt = t;
  }
  check("president: his detail of five comes on shift", n === 5, `${n} agents`);
  check("president: slot error walking with him < 0.6 m", maxErrWalk < 0.6, `max ${maxErrWalk.toFixed(3)} m`);
  check("president: heading jumps < 5 (no zig-zag)", zig < 5, `${zig}`);
  check("president: nobody overlaps (agents and him, > 0.6 m)", minPair > 0.6, `min ${minPair.toFixed(2)} m`);
  check("president: all at rest within 2 s of his stop", restAt > 0 && restAt - (STOP + 0.5) <= 2, `rest ${(restAt - STOP - 0.5).toFixed(2)} s after`);
  check("president: yaw rate <= 6 rad/s", maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
  const worst = Math.max(0, ...faceErr.values());
  check("president: at rest they look out (+-0.8 rad of slot bearing)", worst <= 0.8, `worst ${worst.toFixed(2)} rad`);
}

// ---------------------------------------------------------------------------
// 3. ARMY: a 30-man column marches and turns 90 degrees; a 10-man line (one
//    battle.js section) wheels 90 degrees. Both at battle.js's 6.2 m/s charge
//    pace. Replicates warlord/battle.js stepSquad: slotOf, wheelRate, the
//    march along the heading, trailPush/trailAt for a column, per-man step.
{
  const FILE_W = 2.4, RANK_D = 2.9;
  const CRUMB = 0.5, CRUMB_MAX = 96;
  for (const [form, N] of [["column", 30], ["line", 10]]) {
    const slotOf = (k) => {
      const c = (N - 1) / 2;
      if (form === "line") return { u: (k & 1) ? -0.7 : 0, v: (k - c) * FILE_W };
      return { u: -((k >> 1) * RANK_D), v: ((k & 1) ? 1 : -1) * FILE_W * 0.55 };
    };
    let hw = 1;
    for (let k = 0; k < N; k++) hw = Math.max(hw, Math.abs(slotOf(k).v));
    if (form === "column") hw = 0;
    const R = form === "column" ? 1 + FILE_W * 0.55 : 2 * hw;
    const wr = form === "column" ? 0.8 : Math.max(0.1, Math.min(1.6, 7.0 / R));
    const u = { x: 0, z: 0, yaw: 0, trail: [] };
    const trailPush = () => {
      const T = u.trail, L = T[T.length - 1];
      if (L && Math.hypot(u.x - L.x, u.z - L.z) < CRUMB) return;
      const p = T.length >= CRUMB_MAX ? T.shift() : {};
      p.x = u.x; p.z = u.z; T.push(p);
    };
    const _tr = {};
    const trailAt = (back) => {
      const T = u.trail;
      let hx = u.x, hz = u.z, tx = Math.sin(u.yaw), tz = Math.cos(u.yaw);
      for (let i = T.length - 1; i >= 0; i--) {
        const p = T[i], dx = hx - p.x, dz = hz - p.z, L = Math.hypot(dx, dz);
        if (L < 1e-4) continue;
        if (back <= L) { const k = back / L; _tr.x = hx - dx * k; _tr.z = hz - dz * k; _tr.tx = dx / L; _tr.tz = dz / L; return _tr; }
        back -= L; hx = p.x; hz = p.z; tx = dx / L; tz = dz / L;
      }
      _tr.x = hx - tx * back; _tr.z = hz - tz * back; _tr.tx = tx; _tr.tz = tz; return _tr;
    };
    const _sq = { speed: 0, stop: 0.3, accel: 6.5, decel: 6, lod: 0, face: null, strafe: false, vffX: 0, vffZ: 0 };
    const men = [];
    for (let k = 0; k < N; k++) { const s = slotOf(k); men.push({ pos: { x: -s.v, z: s.u }, yaw: 0, rally: false }); }
    let maxYawRate = 0, zig = 0, minPair = Infinity, maxSpeed = 0, maxErr = 0;
    const lastTurn = men.map(() => 0), lastHead = men.map(() => null);
    for (let i = 0; i < 60 * 30; i++) {
      const t = i * DT;
      // the goal: straight ahead (+z) 8 s, then off to +x (a 90 degree turn)
      const gx = t < 8 ? u.x : u.x + 200, gz = t < 8 ? u.z + 200 : u.z;
      let spd = t < 26 ? 6.2 : 0;
      const ox = u.x, oz = u.z, oyaw = u.yaw;
      if (spd > 0 || (u.v || 0) > 0) {
        const y0 = u.yaw;
        if (spd > 0) {
          const dx = gx - u.x, dz = gz - u.z, d = Math.hypot(dx, dz);
          const want = Math.atan2(dx / d, dz / d);
          if (form === "column") {
            u.yaw = M.turnToward(u.yaw, want, wr * DT);
            if (Math.abs(wrap(want - u.yaw)) > 1.6) spd *= 0.3;
          } else {
            u.yaw = M.turnToward(u.yaw, want, Math.max(0.05, Math.min(wr, (7.0 - (u.v || 0)) / R)) * DT);
            const off = Math.abs(wrap(want - u.yaw));
            const wheelV = Math.abs(wrap(u.yaw - y0)) / DT * R;
            spd = Math.min(spd * Math.max(0.15, Math.min(1, Math.cos(off))), Math.max(spd * 0.15, 7.0 - wheelV));
          }
        }
        const cur = u.v || 0;
        u.v = spd > cur ? Math.min(spd, cur + 4 * DT) : Math.max(spd, cur - 6 * DT); spd = u.v;
        const dyw = wrap(u.yaw - y0);
        if (dyw !== 0 && hw > 0) {                        // wheel on the inner flank
          const pv = dyw > 0 ? -hw : hw;
          u.x += (-Math.cos(y0) + Math.cos(u.yaw)) * pv; u.z += (Math.sin(y0) - Math.sin(u.yaw)) * pv;
        }
        u.x += Math.sin(u.yaw) * spd * DT; u.z += Math.cos(u.yaw) * spd * DT;
      }
      if (form === "column") trailPush();
      let svx = (u.x - ox) / DT, svz = (u.z - oz) / DT;
      const om = Math.max(-wr, Math.min(wr, wrap(u.yaw - oyaw) / DT));
      const sv = Math.hypot(svx, svz), svMax = (spd + Math.abs(om) * hw) * 1.1;
      if (sv > svMax) { const k = sv > 1e-6 ? svMax / sv : 0; svx *= k; svz *= k; }
      const cs = Math.cos(u.yaw), sn = Math.sin(u.yaw);
      for (let k = 0; k < N; k++) {
        const m = men[k], s = slotOf(k);
        let rx = sn * s.u - cs * s.v, rz = cs * s.u + sn * s.v, fy = u.yaw;
        let wx = u.x + rx, wz = u.z + rz, fvx = svx + om * rz, fvz = svz - om * rx;
        if (form === "column") {
          const q = trailAt(-s.u), vv = Math.hypot(svx, svz);
          wx = q.x - q.tz * s.v; wz = q.z + q.tx * s.v;
          fvx = q.tx * vv; fvz = q.tz * vv; fy = Math.atan2(q.tx, q.tz);
        }
        const e = Math.hypot(wx - m.pos.x, wz - m.pos.z);
        if (t > 1) { if (process.env.SIM_DEBUG && e > maxErr && e > 1.5) console.log(`  ${form} err t=${t.toFixed(2)} k=${k} ${e.toFixed(2)} rally=${m.rally}`); maxErr = Math.max(maxErr, e); }
        if (e > 3) m.rally = true; else if (e < 1.2) m.rally = false;
        _sq.lod = k % 3;                                  // exercise every LOD
        _sq.speed = m.rally ? Math.max(spd, 4.2) : 3.0;
        _sq.vffX = fvx; _sq.vffZ = fvz;
        _sq.face = m.rally ? null : fy; _sq.strafe = !m.rally;
        const mv = M.motor(m), y0 = m.yaw;
        M.step(mv, m.pos, m.yaw, wx, wz, _sq, DT);
        m.yaw = mv.yaw;
        maxYawRate = Math.max(maxYawRate, Math.abs(wrap(m.yaw - y0)) / DT);
        maxSpeed = Math.max(maxSpeed, mv.speed);
        // ZIG-ZAG = the travel heading swinging one way then straight back
        // (a reversal of turn direction at a visible rate), not a steady curve
        if (mv.speed > 0.5 && t > 1) {
          const h = Math.atan2(mv.vx, mv.vz);
          if (lastHead[k] != null) {
            const dh = wrap(h - lastHead[k]);
            if (Math.abs(dh) > 0.03) {
              if (lastTurn[k] && Math.sign(dh) !== Math.sign(lastTurn[k])) zig++;
              lastTurn[k] = dh;
            }
          }
          lastHead[k] = h;
        } else { lastHead[k] = null; lastTurn[k] = 0; }
      }
      for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
        const dd = Math.hypot(men[a].pos.x - men[b].pos.x, men[a].pos.z - men[b].pos.z);
        if (process.env.SIM_DEBUG && dd < 0.6 && dd < minPair) console.log(`  ${form} overlap t=${t.toFixed(2)} ${a}/${b} ${dd.toFixed(2)}`);
        minPair = Math.min(minPair, dd);
      }
      if (process.env.SIM_DEBUG && i % 60 === 0) { let we = 0, wk = -1; for (let k = 0; k < N; k++) { const q = men[k]; const e = q._e || 0; } }
    }
    check(`army ${form} x${N}: never overlap (> 0.6 m)`, minPair > 0.6, `min ${minPair.toFixed(2)} m`);
    check(`army ${form} x${N}: no zig-zag (turn reversals < ${N})`, zig < N, `${zig}`);
    check(`army ${form} x${N}: nobody faster than a sprint (<= 8 m/s)`, maxSpeed <= 8.0, `max ${maxSpeed.toFixed(2)} m/s`);
    check(`army ${form} x${N}: holds his place through the turn (err < 1.5 m)`, maxErr < 1.5, `max ${maxErr.toFixed(2)} m`);
    check(`army ${form} x${N}: yaw rate <= 6 rad/s`, maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
  }
}

// ---------------------------------------------------------------------------
// 4. GUN GAME: a bot strafes left-right 6 m while keeping its chest on a target
{
  const B = { pos: { x: 0, z: 0 }, yaw: Math.PI };           // starts facing away
  const T = { x: 0, z: 12 };
  const m = M.motor(B);
  const o = { speed: 2.6, stop: 0.3, accel: 6.5, decel: 5.5, face: 0, strafe: true };
  let maxYawRate = 0, worstFace = 0, legs = 0, side = 1;
  for (let i = 0; i < 60 * 10; i++) {
    const t = i * DT;
    if (m.arrived) side = -side;
    const gx = side * 3, gz = 0;
    o.face = Math.atan2(T.x - B.pos.x, T.z - B.pos.z);
    const y0 = B.yaw;
    M.step(m, B.pos, B.yaw, gx, gz, o, DT);
    B.yaw = m.yaw;
    maxYawRate = Math.max(maxYawRate, Math.abs(wrap(B.yaw - y0)) / DT);
    if (t > 1) worstFace = Math.max(worstFace, Math.abs(wrap(B.yaw - o.face)));
    if (t > 1) legs += Math.abs(m.vx) * DT;
  }
  check("gungame strafe: chest stays on the target (< 0.15 rad after 1 s)", worstFace < 0.15, `worst ${worstFace.toFixed(3)} rad`);
  check("gungame strafe: legs actually strafe (> 10 m lateral)", legs > 10, `${legs.toFixed(1)} m`);
  check("gungame strafe: yaw rate <= 6 rad/s", maxYawRate <= 6.0, `max ${maxYawRate.toFixed(2)} rad/s`);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
