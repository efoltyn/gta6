#!/usr/bin/env node
/* tools/gait-check.mjs — DO THE FEET STAY WHERE THEY LAND?

   The real rig (entities/character.js) + the real gait (entities/gait.js) +
   the soldier layer (entities/soldier.js), in plain node (tools/lib/verbs-vm.mjs).
   For every gait (walk .. sprint, crouch, aiming, strafing, backpedalling,
   uphill, a woman, a child, the soldier carries and moves), a body is moved
   along a line at that speed for a few seconds and animChar runs every frame.
   The DRAWN feet are read off the rig's own matrices:

     SLIP   for every stance, the pivot of the foot's roll (the heel while the
            toes are up, the sole under the ankle while flat, the ball while the
            heel is up) is followed frame to frame; the horizontal distance it
            travels while it is the contact is summed. A foot that rolls but
            does not slide scores 0. Limit: 1 cm per stance.
     LIMITS every frame, both legs inside CBZ.gait.LEG_LIMITS and both arms'
            STORED rotations inside character.js's ARM_LIMITS (the joint is not
            allowed to lean on the draw-time clamp).
   Also reported: cadence, step length, duty, the hips' vertical range.

     node tools/gait-check.mjs            exit 0 = ok
     node tools/gait-check.mjs --verbose  per-stance numbers */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const verbose = process.argv.includes("--verbose");
const vmx = loadVerbsVM({ mode: "survival" });
const { CBZ, THREE: T } = vmx;
if (!CBZ.gait) { console.log("FAIL: entities/gait.js did not load"); process.exit(1); }
let fails = 0;
const DT = 1 / 60;
const _v = new T.Vector3();

function footPoints(ch, i) {
  const leg = i ? ch.parts.rl : ch.parts.ll, foot = leg.userData.foot, g = CBZ.gait.geo(ch);
  foot.updateWorldMatrix(true, false);
  const pt = (z) => _v.set(0, -g.ha, z).applyMatrix4(foot.matrixWorld).clone();
  return { heel: pt(-g.hb), flat: pt(0), ball: pt(g.bf) };
}

/* one run: a body moving at `speed` along local direction (dx, dz) */
function run(tag, o) {
  vmx.clearActors();
  const a = vmx.actor(Object.assign({ x: 0, z: 0, yaw: 0 }, o.body || {}));
  const ch = a.char;
  if (o.set) Object.assign(ch, typeof o.set === "function" ? o.set(ch) : o.set);
  const yaw = o.yaw || 0;
  ch.group.rotation.y = yaw;
  const lx = o.dir ? o.dir[0] : 0, lz = o.dir ? o.dir[1] : 1, ln = Math.hypot(lx, lz);
  const wx = (lx * Math.cos(yaw) + lz * Math.sin(yaw)) / ln, wz = (-lx * Math.sin(yaw) + lz * Math.cos(yaw)) / ln;
  const grad = o.grad || 0;
  vmx.world({ floor: (x, z) => grad * (x * wx + z * wz) });
  const secs = o.secs || 5, warm = o.warm || 1.5;
  let x = 0, z = 0;
  const stance = [null, null];          // per foot: { key, prev, slip, n }
  const slips = [];
  let limitBad = null, steps = 0, stanceFrames = 0, frames = 0;
  let hipMin = Infinity, hipMax = -Infinity;
  let lastSw = [false, false];
  for (let f = 0; f < secs / DT; f++) {
    const t = f * DT;
    const v = typeof o.speed === "function" ? o.speed(t) : o.speed;
    if (!o.tread) { x += wx * v * DT; z += wz * v * DT; }
    ch.group.position.set(x, grad * (x * wx + z * wz), z);
    if (o.tick) o.tick(ch, t, a);
    vmx.setSpeed(a, v);
    vmx.frame(DT);
    if (t < warm) continue;
    frames++;
    const G = ch._gv;
    if (!G || !(ch._gFootW > 0.999)) { for (let i = 0; i < 2; i++) stance[i] = null; continue; }
    ch.group.updateMatrixWorld(true);
    // hips
    const hp = new T.Vector3(); ch.parts.ll.getWorldPosition(hp);
    hipMin = Math.min(hipMin, hp.y - ch.group.position.y); hipMax = Math.max(hipMax, hp.y - ch.group.position.y);
    for (let i = 0; i < 2; i++) {
      const F = G.feet[i];
      if (F.sw) {
        if (stance[i]) { slips.push(stance[i].slip); if (verbose) console.log(`   ${tag} foot ${i} stance ${stance[i].n} frames slip ${(stance[i].slip * 100).toFixed(2)} cm`); }
        stance[i] = null;
        if (!lastSw[i]) steps++;
        lastSw[i] = true;
        continue;
      }
      lastSw[i] = false;
      stanceFrames++;
      const P = footPoints(ch, i);
      const key = F.psi < -1e-4 ? "heel" : F.psi > 1e-4 ? "ball" : "flat";
      const p = P[key];
      // a baked clip's root stands still and the ground runs under it: the
      // plant lives in that moving ground (gait.js's treadmill offset)
      if (o.tread) { p.x += G.ox; p.z += G.oz; }
      const S = stance[i] || (stance[i] = { key, prev: p, slip: 0, n: 0 });
      if (S.key === key) S.slip += Math.hypot(p.x - S.prev.x, p.z - S.prev.z);
      S.key = key; S.prev = p; S.n++;
    }
    // limits
    if (!limitBad) {
      const L = CBZ.gait.legInRange(ch, 2e-3);
      if (L !== true) limitBad = L.join(",") + " @" + t.toFixed(2);
      for (const arm of ["l", "r"]) {
        const A = CBZ.human.armInRange(ch, arm, 2e-3);
        if (A !== true && !limitBad) limitBad = "arm " + arm + " " + A.join(",") + " @" + t.toFixed(2);
      }
    }
  }
  const M = ch._gv.M;
  const worst = slips.length ? Math.max(...slips) : 0;
  const mean = slips.length ? slips.reduce((s, v) => s + v, 0) / slips.length : 0;
  const spm = steps / ((frames * DT) || 1) * 60;
  const ok = worst < 0.01 && !limitBad && (o.minStances == null || slips.length >= o.minStances);
  if (!ok) fails++;
  const v0 = typeof o.speed === "function" ? "var" : o.speed.toFixed(1);
  console.log(`${ok ? "ok  " : "FAIL"} ${tag.padEnd(22)} v ${v0.padStart(4)} m/s  cadence ${spm.toFixed(0).padStart(3)}/min  step ${(M.step || 0).toFixed(2)} m  duty ${M.duty.toFixed(2)}  ` +
    `slip worst ${(worst * 100).toFixed(2)} cm mean ${(mean * 100).toFixed(2)} cm (${slips.length} stances)  hips ${((hipMax - hipMin) * 100).toFixed(1)} cm` +
    (limitBad ? "  LIMIT " + limitBad : "") + (o.minStances != null && slips.length < o.minStances ? "  (too few stances)" : ""));
  return { worst, limitBad, ch };
}

console.log("gait-check: real rig, planted feet, joint ranges\n");
const SPEEDS = [0.5, 1.0, 1.4, 2.0, 3.0, 4.5, 6.4];
for (const v of SPEEDS) run("walk/run", { speed: v, minStances: 4 });
run("crouch walk", { speed: 1.0, set: { crouch: true }, minStances: 4 });
run("crouch run", { speed: 2.6, set: { crouch: true }, minStances: 4 });
run("aim walk", { speed: 1.2, set: (ch) => ({ aimingPose: true }), minStances: 4 });
run("strafe left", { speed: 1.4, dir: [1, 0], minStances: 4 });
run("strafe right", { speed: 1.4, dir: [-1, 0], minStances: 4 });
run("strafe diag", { speed: 2.0, dir: [1, 1], minStances: 4 });
run("backpedal", { speed: 1.2, dir: [0, -1], minStances: 4 });
run("uphill walk", { speed: 1.2, grad: 0.25, minStances: 4 });
run("downhill walk", { speed: 1.2, grad: -0.25, minStances: 4 });
run("woman walk", { speed: 1.4, body: { build: "f" }, minStances: 4 });
run("woman run", { speed: 4.0, body: { build: "f" }, minStances: 4 });
run("child walk", { speed: 1.1, body: { build: "m", age: 7 }, minStances: 4 });
// THE BAKED CROWD CLIPS (entities/crowdgpu.js bakes on a root that never moves)
run("baked walk 1.3", { speed: 1.3, tread: true, minStances: 4 });
run("baked run 3.6", { speed: 3.6, tread: true, minStances: 4 });
run("start-stop", { speed: (t) => (t % 4 < 2 ? 1.6 : 0), secs: 9 });
run("speed ramp", { speed: (t) => Math.min(6.4, 0.3 + t * 0.9), secs: 8 });
// the soldier layer (entities/soldier.js), when it is loaded
if (CBZ.soldier) {
  for (const carry of ["low", "high", "patrol"]) run("rifle " + carry, { speed: 1.4, set: { soldier: { carry } }, minStances: 4 });
  run("rifle run", { speed: 4.2, set: { soldier: { carry: "low" } }, minStances: 4 });
  run("crouch-run rifle", { speed: 2.6, set: { crouch: true, soldier: { carry: "low" } }, minStances: 4 });
  run("reload walking", { speed: 1.2, set: { soldier: { carry: "low" } }, tick: (ch, t) => { if (Math.abs(t - 2) < 1e-6 || (t > 2 && t < 2 + 1.1 / 60)) CBZ.soldier.reload(ch); }, minStances: 4 });
  run("baked rifleWalk", { speed: 1.4, tread: true, set: { soldier: { carry: "low" } }, minStances: 4 });
  run("baked crouchRun", { speed: 2.6, tread: true, set: { soldier: { carry: "low", stance: "rush" } }, minStances: 4 });
  run("limp (leg hit)", { speed: 1.0, tick: (ch, t) => { if (t < 1.1 / 60) CBZ.soldier.wound(ch, "legL", 0.8); }, minStances: 4 });
}
/* ---- EVERY VERB AND STANCE, JOINT RANGES ONLY ------------------------------
   (not steady locomotion: the slip number means nothing in a dive) */
function sweep(tag, o) {
  vmx.clearActors();
  const a = vmx.actor({ x: 0, z: 0, yaw: 0 });
  const ch = a.char;
  if (o.set) Object.assign(ch, typeof o.set === "function" ? o.set(ch) : o.set);
  let bad = null, x = 0, z = 0, yaw = 0;
  vmx.world({});
  for (let f = 0; f < (o.secs || 3) / DT; f++) {
    const t = f * DT;
    const v = typeof o.speed === "function" ? o.speed(t) : (o.speed || 0);
    if (o.turn) { yaw += o.turn * DT; ch.group.rotation.y = yaw; }
    z += Math.cos(yaw) * v * DT; x += Math.sin(yaw) * v * DT;
    ch.group.position.set(x, 0, z);
    if (o.tick) o.tick(ch, t, f);
    vmx.setSpeed(a, v);
    vmx.frame(DT);
    if (bad) continue;
    const L = CBZ.gait.legInRange(ch, 2e-3);
    if (L !== true && ch._gFootW > 0.5) bad = L.join(",") + " @" + t.toFixed(2);
    for (const arm of ["l", "r"]) {
      const A = CBZ.human.armInRange(ch, arm, 2e-3);
      if (A !== true && !bad) bad = "arm " + arm + " " + A.join(",") + " @" + t.toFixed(2);
    }
  }
  if (bad) fails++;
  console.log(`${bad ? "FAIL" : "ok  "} ${tag.padEnd(26)} joints ${bad ? "OUT: " + bad : "in range"}`);
}
console.log("");
sweep("turn on the spot", { turn: 3.5, secs: 3 });
sweep("turn while walking", { speed: 1.4, turn: 1.2, secs: 3 });
if (CBZ.soldier) {
  const S = CBZ.soldier;
  const once = (fn, at) => (ch, t, f) => { if (f === Math.round((at || 0.5) / DT)) fn(ch); };
  sweep("grenade throw", { set: { soldier: { carry: "low" } }, tick: once((ch) => S.throwGrenade(ch)) });
  sweep("grenade throw walking", { speed: 1.2, set: { soldier: { carry: "low" } }, tick: once((ch) => S.throwGrenade(ch)) });
  sweep("cover low, peek", { set: { soldier: { carry: "low", cover: { low: true, side: 1, peek: 0 } } }, tick: (ch, t) => { ch.soldier.cover.peek = t > 1.2 ? 1 : 0; } });
  sweep("cover low, blind fire", { set: { soldier: { carry: "low", cover: { low: true, side: 1, blind: true } } } });
  sweep("corner, peek right", { set: { soldier: { carry: "high", cover: { low: false, side: 1, peek: 1 } } } });
  sweep("corner, peek left", { set: { soldier: { carry: "high", cover: { low: false, side: -1, peek: 1 } } } });
  sweep("corner, blind fire", { set: { soldier: { carry: "high", cover: { low: false, side: -1, blind: true } } } });
  sweep("flinch, keep going", { speed: 3.5, set: { soldier: { carry: "low" } }, tick: once((ch) => S.hit(ch, { sev: 0.2, dirX: 0, dirZ: -1 })) });
  sweep("stumble running", { speed: 4.0, set: { soldier: { carry: "low" } }, tick: once((ch) => S.hit(ch, { sev: 0.6, dirX: 1, dirZ: 0 })) });
  sweep("bound + dive to prone", { speed: (t) => (t < 1.2 ? 4.5 : t < 2 ? 2 : 0), secs: 4, set: { soldier: { carry: "high", stance: "rush" } }, tick: once((ch) => S.dive(ch), 1.2) });
  sweep("prone crawl", { speed: 0.5, secs: 4, set: { soldier: { carry: "low", stance: "prone" } } });
  sweep("both legs hit: crawl", { speed: 0.4, secs: 3, tick: once((ch) => S.wound(ch, "legs", 0.9), 0.1) });
  sweep("gut wound walking", { speed: 0.9, tick: once((ch) => S.wound(ch, "gut", 0.8), 0.1) });
  sweep("arm wound, rifle", { speed: 1.2, set: { soldier: { carry: "low" } }, tick: once((ch) => S.wound(ch, "armL", 0.9), 0.1) });
  // the root rides the standard arc over a 0.9 m wall that starts 1.2 m ahead
  let v0 = null;
  sweep("vault low wall", { speed: 3.0, set: { soldier: { carry: "low" } }, tick: (ch, t, f) => {
    if (f === Math.round(0.4 / DT)) { v0 = t; S.vault(ch, { ledgeX: ch.group.position.x, ledgeZ: ch.group.position.z + 0.75, top: 0.9, dirX: 0, dirZ: 1 }); }
    if (v0 != null && t - v0 < 0.6) ch.group.position.y = S.vaultArc((t - v0) / 0.6, 0.9);
  } });
}
console.log(fails ? `\n${fails} FAILED` : "\nall ok");
process.exit(fails ? 1 : 0);
