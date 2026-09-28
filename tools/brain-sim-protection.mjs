// === PROTECTION ROUTER SCENARIOS ===
// Plain node, no browser. The President's detail brain (src/city/brain_protection.js)
// DECIDES; CBZ.moves (src/entities/moves.js) EXECUTES. The stand-in for the
// city mover is peds.js's side of the moveOrder seam: a body with a
// ped.moveOrder is stepped through CBZ.moves.step toward it with its options
// (speed, stop, face, strafe, feed-forward); without one the motor brakes.
// Loads src/systems/brain.js first when it exists, so the same scenarios run
// through CBZ.brain.act once the core has landed.
//
//   node tools/brain-sim-protection.mjs
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis.window || { CBZ: {} };
const CBZ = window.CBZ;
const brainPath = path.join(ROOT, "src/systems/brain.js");
let withBrain = false;
// PROT_NO_BRAIN=1 runs the same scenarios on the fallback executor alone
if (fs.existsSync(brainPath) && !process.env.PROT_NO_BRAIN) {
  try { require(brainPath); withBrain = !!CBZ.brain; } catch (e) { console.log("brain.js failed to load:", e.message); }
}
require(path.join(ROOT, "src/entities/moves.js"));
const M = CBZ.moves;
const DB0 = require(path.join(ROOT, "src/city/brain_protection.js"));
// the game calls CBZ.brain.clock(t) once per frame; so does the sim
let simT = 0;
function clk(dt) { simT += dt || 0; if (CBZ.brain && CBZ.brain.clock) CBZ.brain.clock(simT); }
const DB = Object.assign({}, DB0, {
  step(D, pr, members, dt, env) { clk(dt); return DB0.step(D, pr, members, dt, env); },
  sniper(q, post, dt, t) { clk(dt); return DB0.sniper(q, post, dt, t); },
});

let fails = 0;
function check(name, ok, info) {
  console.log((ok ? "PASS " : "FAIL ") + name + (info ? "  (" + info + ")" : ""));
  if (!ok) fails++;
}
function wrap(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

let nextId = 1;
function body(x, z, yaw, extra) {
  const b = {
    id: nextId++, pos: { x, y: 0, z }, group: { rotation: { y: yaw || 0 }, position: null },
    state: "idle", speed: 0, baseSpeed: 1.8, controlled: true,
    target: { x, y: 0, z, set(X, Y, Z) { this.x = X; this.y = Y; this.z = Z; } },
  };
  b.group.position = b.pos;
  return Object.assign(b, extra || {});
}
// the stand-in for peds.js move(): the moveOrder seam through CBZ.moves
const _o = {}, _brake = { speed: 0, stop: 0.3 };
function mover(b, dt) {
  if (b.dead) return;
  const m = M.motor(b), o = b.moveOrder;
  if (o) { Object.assign(_o, o); M.step(m, b.pos, b.group.rotation.y, o.x, o.z, _o, dt); }
  else M.step(m, b.pos, b.group.rotation.y, b.pos.x + m.vx, b.pos.z + m.vz, _brake, dt);
  b.group.rotation.y = m.yaw;
  b.speed = m.gs;
}
// holding his spot: the brain says so AND the motor is actually still
function holding(a) { return !!(a._det && a._det.hold) && a._mv && a._mv.speed < 0.05; }

// ------------------------------------------------------------------
// 1. A formation follows a turning protectee: no slot swaps on a curve,
//    no crossing on a U-turn, bounded yaw rate, no walk/idle flapping.
// ------------------------------------------------------------------
{
  const pr = body(0, 0, 0, { isNPC: true });
  const agents = [];
  for (let i = 0; i < 5; i++) agents.push(body((i - 2) * 1.5, -2, 0, i === 0 ? { _protRole: "shift-leader" } : null));
  const D = DB.create("sim-turn");
  const dt = 1 / 60;
  let t = 0, heading = 0, swaps = 0, maxStandYawRate = 0, flaps = 0, crossings = 0, minD = 99, maxD = 0;
  const lastKind = new Map(), lastState = new Map(), lastYaw = new Map();
  const env = { posture: "normal", crowd: 0, peds: [] };
  function run(seconds, speed, turnRate, phaseName) {
    const end = t + seconds;
    for (; t < end; t += dt) {
      heading += turnRate * dt;
      pr.pos.x += Math.sin(heading) * speed * dt; pr.pos.z += Math.cos(heading) * speed * dt;
      pr.group.rotation.y = heading;
      DB.step(D, pr, agents, dt, env);
      for (const a of agents) mover(a, dt);
      for (const a of agents) {
        const k = a._det && a._det.kind;
        if (phaseName === "curve" && t > 3 && lastKind.has(a) && lastKind.get(a) !== k) swaps++;
        lastKind.set(a, k);
        const y = a.group.rotation.y;
        if (lastYaw.has(a) && holding(a)) maxStandYawRate = Math.max(maxStandYawRate, Math.abs(wrap(y - lastYaw.get(a))) / dt);
        lastYaw.set(a, y);
        const hs = !!(a._det && a._det.hold);
        if (phaseName === "curve" && t > 3 && lastState.has(a) && lastState.get(a) !== hs) flaps++;
        lastState.set(a, hs);
        const d = Math.hypot(a.pos.x - pr.pos.x, a.pos.z - pr.pos.z);
        if (t > 3) { minD = Math.min(minD, d); maxD = Math.max(maxD, d); }
        if (phaseName === "uturn" && d < 0.45) crossings++;
      }
    }
  }
  run(4, 2.0, 0, "settle");
  run(10, 2.0, (Math.PI / 2) / 10, "curve");       // a 90-degree bend over 10 s, at a walk
  check("formation: no slot swaps on a curve", swaps === 0, "swaps=" + swaps);
  check("formation: no walk/idle flapping while he walks", flaps === 0, "flaps=" + flaps);
  run(1.2, 0.3, Math.PI / 1.2, "uturn");            // turns on the spot
  run(8, 2.0, 0, "uturn");                           // and walks back the way he came
  check("formation: nobody walks through him on a U-turn", crossings === 0, "frames<0.45m=" + crossings);
  const kinds = agents.map((a) => a._det && a._det.kind);
  const point = agents.find((a) => a._det && a._det.kind === "point");
  const fwd = point ? (point.pos.x - pr.pos.x) * Math.sin(heading) + (point.pos.z - pr.pos.z) * Math.cos(heading) : -1;
  check("formation: after the U-turn someone is on point, ahead of him", fwd > 1.5, "kinds=" + kinds.join(",") + " ahead=" + fwd.toFixed(2));
  run(5, 0, 0, "stop");
  check("formation: turn rate while standing is bounded", maxStandYawRate <= DB.TUNE.TURN_HOT + 0.5, "max=" + maxStandYawRate.toFixed(2) + " rad/s");
  const idle = agents.filter(holding).length;
  check("formation: they arrive and HOLD when he stops", idle === agents.length, idle + "/" + agents.length + " holding");
  check("formation: the knot stays a knot (0.8-7 m)", minD > 0.6 && maxD < 7, "min=" + minD.toFixed(2) + " max=" + maxD.toFixed(2));
  // scanning: while he stands, each agent changes where he looks on a human cadence
  const looks = new Map(); let changes = 0; const lastLook = new Map();
  for (let i = 0; i < 600; i++) {
    DB.step(D, pr, agents, dt, env);
    for (const a of agents) {
      mover(a, dt);
      const l = a._det.lookYaw;
      if (lastLook.has(a) && lastLook.get(a) !== l) changes++;
      lastLook.set(a, l); looks.set(a, true);
    }
  }
  check("scanning: new look targets every 1.5-4 s, not every frame", changes >= 5 && changes <= 5 * 10 / 1.5 + 2, "changes in 10 s x5 agents=" + changes);
}

// ------------------------------------------------------------------
// 2. A gunshot: shout, the CP covers him, a body shield between him and
//    the threat, a staggered reaction, an engager, then evacuate.
// ------------------------------------------------------------------
{
  const pr = body(0, 0, 0);
  const agents = [];
  for (let i = 0; i < 5; i++) agents.push(body(Math.sin(i) * 2.5, Math.cos(i) * 2.5, 0, i === 0 ? { _protRole: "shift-leader" } : null));
  const shooter = body(0, 15, Math.PI, { armed: true, state: "fight" });
  const D = DB.create("sim-shot");
  const dt = 1 / 60;
  const env = { posture: "normal", crowd: 0, peds: [shooter] };
  for (let i = 0; i < 420; i++) { DB.step(D, pr, agents, dt, env); for (const a of agents) mover(a, dt); }
  check("gunshot: before it, the detail is standing still", agents.every(holding), agents.map((a) => holding(a)).join(","));
  const pre = new Map(agents.map((a) => [a, a.moveOrder ? { x: a.moveOrder.x, z: a.moveOrder.z } : { x: a.pos.x, z: a.pos.z }]));
  const engaged = [];
  const shouts = [];
  const firstIssue = new Map();
  env.posture = "evac"; env.threat = shooter; env.hostile = true; env.threatAt = { x: 0, z: 15 };
  env.engage = (q, t) => { engaged.push(q); q.rage = t; q.state = "fight"; };
  env.busy = (q) => q.state === "fight" && !!q.rage;
  env.disengage = (q) => { q.rage = null; q.state = "idle"; };
  env.onShout = (q, line) => shouts.push({ q, line, t: D.t });
  const t0 = D.t;
  for (let i = 0; i < 150; i++) {
    DB.step(D, pr, agents, dt, env);
    for (const a of agents) {
      if (a.state !== "fight") mover(a, dt);
      // his first own move: the order he walks by leaves where it stood
      const o = a.moveOrder, p0 = pre.get(a);
      if (!firstIssue.has(a) && o && Math.hypot(o.x - p0.x, o.z - p0.z) > 0.3) firstIssue.set(a, D.t - t0);
    }
  }
  check("gunshot: somebody shouts it", shouts.length === 1 && /Gun/.test(shouts[0].line), shouts.map((s) => s.line).join(" | "));
  const cp = D.cp;
  check("gunshot: the CP speaks and the principal is pushed down", !!(cp && cp._detSaid) && (pr.poseCower > 0 || pr._detCovered), "cp said: " + (cp && cp._detSaid));
  const times = [...firstIssue.values()].map((v) => v.toFixed(2));
  check("gunshot: reactions are staggered (not one frame)", new Set(times).size >= 3, "first moves at " + times.join(","));
  check("gunshot: one or two agents engage the shooter", engaged.length >= 1 && engaged.length <= 2 && !engaged.includes(cp), "engaged=" + engaged.length);
  const tb = { x: 0, z: 1 };
  let between = 0;
  for (const a of agents) {
    if (engaged.includes(a) || a === cp) continue;
    const ox = a.pos.x - pr.pos.x, oz = a.pos.z - pr.pos.z, d = Math.hypot(ox, oz);
    if (d < 2.0 && (ox * tb.x + oz * tb.z) / (d || 1) > 0.5) between++;
  }
  check("gunshot: a body shield between him and the threat", between >= 2, "agents between=" + between);
  const cpo = cp ? { x: cp.pos.x - pr.pos.x, z: cp.pos.z - pr.pos.z } : { x: 0, z: 1 };
  check("gunshot: the CP is on him, never on the gun side", cpo.z <= 0.1 && Math.hypot(cpo.x, cpo.z) < 1.3, "cp offset " + cpo.x.toFixed(2) + "," + cpo.z.toFixed(2));
  // evacuate: he is moved toward the car (south), the shield moves with him
  let maxSpread = 0;
  for (let i = 0; i < 240; i++) {
    pr.pos.z -= 3.0 * dt;
    DB.step(D, pr, agents, dt, env);
    for (const a of agents) {
      if (a.state !== "fight") mover(a, dt);
      if (!engaged.includes(a) && i > 60) maxSpread = Math.max(maxSpread, Math.hypot(a.pos.x - pr.pos.x, a.pos.z - pr.pos.z));
    }
  }
  check("evacuate: the phase is evac and the shield keeps up", D.phase === "evac" && maxSpread < 3.2, "phase=" + D.phase + " spread=" + maxSpread.toFixed(2));
  // the threat dies: hold, then re-form
  shooter.dead = true; env.threat = null; env.hostile = false; env.posture = "normal";
  for (let i = 0; i < 60; i++) { DB.step(D, pr, agents, dt, env); for (const a of agents) if (a.state !== "fight") mover(a, dt); }
  check("after: hold (tight, guns up)", D.phase === "hold", "phase=" + D.phase);
  for (let i = 0; i < 60 * 7; i++) { DB.step(D, pr, agents, dt, env); for (const a of agents) mover(a, dt); }
  check("after: re-formed", D.phase === "normal" && D.engagers.length === 0 && Math.abs(D.R - DB.TUNE.R_OPEN) < 0.2, "phase=" + D.phase + " R=" + D.R.toFixed(2));
}

// ------------------------------------------------------------------
// 2b. ALERT (a drawn weapon, nobody firing): two step in between, the rest
//     keep their own sectors (a diversion is the classic setup).
// ------------------------------------------------------------------
{
  const pr = body(0, 0, 0);
  const agents = [];
  for (let i = 0; i < 5; i++) agents.push(body(Math.sin(i) * 2.5, Math.cos(i) * 2.5, 0, i === 0 ? { _protRole: "shift-leader" } : null));
  const man = body(9, 6, 0, { armed: true, state: "confront" });
  const D = DB.create("sim-alert");
  const dt = 1 / 60;
  const env = { posture: "normal", crowd: 0, peds: [man] };
  for (let i = 0; i < 420; i++) { DB.step(D, pr, agents, dt, env); for (const a of agents) mover(a, dt); }
  env.posture = "alert"; env.threat = man; env.hostile = false;
  for (let i = 0; i < 240; i++) { DB.step(D, pr, agents, dt, env); for (const a of agents) mover(a, dt); }
  const tb = Math.atan2(9, 6);
  let facing = 0, between = 0;
  for (const a of agents) {
    if (!D.screen.includes(a) && a._det.lookAt === man) facing++;
    const ox = a.pos.x - pr.pos.x, oz = a.pos.z - pr.pos.z, d = Math.hypot(ox, oz);
    if (d < 2 && (ox * Math.sin(tb) + oz * Math.cos(tb)) / (d || 1) > 0.6) between++;
  }
  check("alert: two step in between him and the weapon", D.phase === "alert" && D.screen.length === 2 && between >= 2, "phase=" + D.phase + " between=" + between);
  check("alert: the others keep their own sectors (nobody else locks onto him)", facing === 0, "others locked on=" + facing);
}

// ------------------------------------------------------------------
// 3. A counter-sniper stays static and scans slowly.
// ------------------------------------------------------------------
{
  const q = body(10, 10, 0.3);
  const post = { face: 0.3 };
  const dt = 1 / 60;
  let maxRate = 0, lastY = q.group.rotation.y, changes = 0, lastLook = null;
  for (let i = 0; i < 60 * 60; i++) {
    DB.sniper(q, post, dt, null);
    mover(q, dt);
    const y = q.group.rotation.y;
    maxRate = Math.max(maxRate, Math.abs(wrap(y - lastY)) / dt); lastY = y;
    if (lastLook !== null && post.lookYaw !== lastLook) changes++;
    lastLook = post.lookYaw;
  }
  const moved = Math.hypot(q.pos.x - 10, q.pos.z - 10);
  check("counter-sniper: never moves", moved < 1e-6 && q.state !== "walk", "moved=" + moved.toFixed(4));
  check("counter-sniper: long dwell (3-6.5 s per look)", changes >= 60 / 6.5 - 1 && changes <= 60 / 3 + 1, "looks in 60 s=" + changes);
  check("counter-sniper: slow deliberate turn", maxRate <= DB.TUNE.TURN_SNIPER + 0.3, "max=" + maxRate.toFixed(2) + " rad/s");
  const thr = body(60, 40, 0);
  for (let i = 0; i < 120; i++) DB.sniper(q, post, dt, thr);
  const want = Math.atan2(50, 30);
  check("counter-sniper: turns onto a target he is handed", Math.abs(wrap(q.group.rotation.y - want)) < 0.1, "err=" + Math.abs(wrap(q.group.rotation.y - want)).toFixed(3));
}

console.log((withBrain ? "[with CBZ.brain] " : "[brain.js not loaded: fallback executor] ") + (fails ? fails + " FAILED" : "all passed"));
if (fails) process.exitCode = 1;
