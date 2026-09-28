#!/usr/bin/env node
/* tools/verbs-shot-check.mjs — WHAT DOES A ROUND DO TO A MAN IT DID NOT KILL?

   Plain node, real rigs (tools/lib/verbs-vm.mjs: three r128 + character.js +
   meleeposes.js + verbs_strike.js + grapple.js). The owner saw a shot man
   "pivot, like one foot is stuck to the ground and he spins round it". This
   shoots a standing, NOT fighting man with CBZ.verbs.shot from the front,
   the back and both sides and reads the answer off the skeleton:

     · the root travels ALONG the round (translation . bullet dir > 0);
     · no yaw spin: the whole body (group + model) turns < 15 degrees, and
       neither foot swings ACROSS the line of the round (a pivot round one
       planted foot is the other foot sweeping an arc across it): each foot
       only travels along the round;
     · a head shot moves the neck; a torso shot folds him and he steps;
     · a leg shot drops THAT knee to the floor (lower and more bent than the
       other) and he gets back up;
     · an arm shot drops THAT hand below the other (the other comes across);
     · rounds stack: 2 pistol torso rounds leave him up, 3 inside a second
       put him down; a second round never weakens the reaction;
     · a close shotgun blast (9 pellets, one resolution) puts him down, the
       same blast from 20 m does not;
     · a man shot at a run stumbles on forward along it;
     · fists: a blocked punch pushes the blocker back along the blow, a
       landed jab moves the target's weight along it, a knockdown falls
       along the blow (back when pushed back, face when hit from behind)
       and his ko clock runs out as the get-up ends.

     node tools/verbs-shot-check.mjs            exit 0 = pass
*/
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const W = loadVerbsVM({ mode: "city" });
if (!W.loaded.strike || !W.loaded.meleePoses) { console.log("verbs-vm did not load the strike files: " + W.errors.join(" / ")); process.exit(1); }
const { CBZ, THREE } = W;
const V = CBZ.verbs, MP = CBZ.meleePoses;
CBZ.doHitstop = () => {}; CBZ.shake = () => {};
const DT = 1 / 60;
let checks = 0, fails = 0;
const failures = [];
function check(ok, msg) { checks++; if (!ok) { fails++; failures.push(msg); } }
const f2 = (x) => (x == null || !isFinite(x) ? "  -  " : (x >= 0 ? " " : "") + x.toFixed(2));
const v3 = () => new THREE.Vector3();
const DEG = 180 / Math.PI;
if (!V.shot) { console.log("CBZ.verbs.shot is missing"); process.exit(1); }

function run(n, fn) { for (let i = 0; i < n; i++) { W.frame(DT); if (fn) fn(i); } }
function man(yaw) {
  W.clearActors();
  const a = W.actor({ x: 0, z: 0, yaw: yaw || 0, name: "target" });
  run(30);
  return a;
}
function feet(ch, L, R) {
  const P = ch.profile;
  ch.group.updateMatrixWorld(true);
  ch.low.rl.localToWorld(L.set(0, -P.legLo, 0));      // his left
  ch.low.ll.localToWorld(R.set(0, -P.legLo, 0));      // his right
}
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
const Z = MP.newZones();
function zones(a) { MP.zones(a.char, Z); return Z; }
function mid(A, B, t) { return v3().copy(A).lerp(B, t == null ? 0.5 : t); }
function knee(ch, side) { return (side === "L" ? ch.low.rl : ch.low.ll).getWorldPosition(v3()); }
function hand(ch, side) { return (side === "L" ? ch.sockets.leftHand : ch.sockets.rightHand).getWorldPosition(v3()); }

// ================================================================ DIRECTIONS
const rows = [];
const DIRS = [["front", 0, -1], ["back", 0, 1], ["his left", -1, 0], ["his right", 1, 0]];
for (const yaw of [0, 0.7]) {
  for (const [name, lx, lz] of DIRS) {
    const a = man(yaw);
    const ch = a.char;
    // bullet travel in world: rotate his-frame direction by his yaw
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const dx = lx * c + lz * s, dz = -lx * s + lz * c;
    const zz = zones(a);
    const pt = zz.belly.c.clone();
    const p0 = a.pos.clone(), gy0 = ch.group.rotation.y, my0 = ch.model ? ch.model.rotation.y : 0;
    const FL = v3(), FR = v3();
    feet(ch, FL, FR);
    const L0 = FL.clone(), R0 = FR.clone();
    let yawMax = 0, footMax = 0, bxMax = 0, twist = 0, nan = false;
    const bx0 = ch.body.rotation.x, by0 = ch.body.rotation.y;
    const ok = V.shot(a, { point: pt, dir: { x: dx, z: dz }, cal: 1.2 });
    run(90, () => {
      const gy = ch.group.rotation.y + (ch.model ? ch.model.rotation.y : 0);
      yawMax = Math.max(yawMax, Math.abs(angDiff(gy, gy0 + my0)));
      feet(ch, FL, FR);
      // how far each foot has gone ACROSS the round's line
      const aL = Math.abs(-(FL.x - L0.x) * dz + (FL.z - L0.z) * dx), aR = Math.abs(-(FR.x - R0.x) * dz + (FR.z - R0.z) * dx);
      footMax = Math.max(footMax, aL, aR);
      bxMax = Math.max(bxMax, ch.body.rotation.x - bx0);
      twist = Math.max(twist, Math.abs(ch.body.rotation.y - by0));   // the torso pivots at the feet
      if (!isFinite(a.pos.x) || !isFinite(ch.body.rotation.x)) nan = true;
    });
    const mx = a.pos.x - p0.x, mz = a.pos.z - p0.z;
    const along = mx * dx + mz * dz, across = Math.abs(-mx * dz + mz * dx);
    const row = { name: name + (yaw ? " (yaw 0.7)" : ""), ok, along, across, yaw: yawMax * DEG, foot: footMax, fold: bxMax, twist: twist * DEG, nan };
    rows.push(row);
    check(ok, row.name + ": CBZ.verbs.shot took the round");
    check(along > 0.1, row.name + ": the root travels along the round (" + f2(along) + " m)");
    check(across < along * 0.5 + 0.03, row.name + ": and not sideways off it (" + f2(across) + " m across)");
    check(yawMax * DEG < 15, row.name + ": the whole body does not turn (" + (yawMax * DEG).toFixed(1) + " deg)");
    check(footMax < 0.08, row.name + ": no pivot round a foot (a foot strays " + f2(footMax) + " m across the line)");
    check(twist * DEG < 15, row.name + ": the shoulders do not swing round (torso twist " + (twist * DEG).toFixed(1) + " deg)");
    check(!nan, row.name + ": finite");
  }
}
// the torso folds over a round from the front
check(rows[0].fold > 0.15, "a torso round folds him over it (body x +" + f2(rows[0].fold) + ")");

// ================================================================ HEAD
let headRow = {};
{
  const a = man(0), ch = a.char, n = ch.neck;
  const nx0 = n.rotation.x;
  const zz = zones(a);
  V.shot(a, { point: zz.head.c.clone(), dir: { x: 0, z: -1 }, cal: 0.8 });
  let pn = 0;
  run(40, () => { const d = n.rotation.x - nx0; if (Math.abs(d) > Math.abs(pn)) pn = d; });
  headRow = { nx: pn, kind: ch.hitReact && ch.hitReact.kind };
  check(headRow.kind === "snap", "a head round snaps the head (" + headRow.kind + ")");
  check(pn < -0.2, "the head goes back along a round from the front (neck x " + f2(pn) + ")");
}

// ================================================================ LEGS
const legRows = [];
for (const side of ["L", "R"]) {
  const a = man(0), ch = a.char;
  const zz = zones(a);
  const pt = side === "L" ? mid(zz.lA, zz.lB) : mid(zz.rA, zz.rB);
  const zone = V.shotZone(a, pt);
  V.shot(a, { point: pt, dir: { x: 0, z: -1 }, cal: 0.8 });
  run(36);
  ch.group.updateMatrixWorld(true);
  const other = side === "L" ? "R" : "L";
  const kHit = knee(ch, side).y, kOther = knee(ch, other).y;
  const bendHit = (side === "L" ? ch.low.rl : ch.low.ll).rotation.x, bendOther = (side === "L" ? ch.low.ll : ch.low.rl).rotation.x;
  const fall = ch.fall && ch.fall.on ? ch.fall.variant : null;
  let upT = 0;
  for (let i = 0; i < 60 * 5 && ch.fall && ch.fall.on; i++) { W.frame(DT); upT += DT; }
  const r = { side, zone, fall, kHit, kOther, bendHit, bendOther, upT, stood: !(ch.fall && ch.fall.on) };
  legRows.push(r);
  check(zone === "leg" + side, "a thigh round finds his " + side + " leg (" + zone + ")");
  check(fall === "kneel", side + " leg: he drops to a knee (" + fall + ")");
  check(kHit < kOther - 0.1 && kHit < 0.2, side + " leg: THAT knee is on the floor (" + f2(kHit) + " vs " + f2(kOther) + ")");
  check(bendHit > bendOther + 0.1, side + " leg: THAT knee is the bent one (" + f2(bendHit) + " vs " + f2(bendOther) + ")");
  check(r.stood && upT > 0.6 && upT < 3.5, side + " leg: he rises after about a second (" + upT.toFixed(2) + " s)");
}

// ================================================================ ARMS
const armRows = [];
for (const side of ["L", "R"]) {
  const a = man(0), ch = a.char;
  const zz = zones(a);
  const sh = (side === "L" ? ch.parts.la : ch.parts.ra).getWorldPosition(v3());
  const el = side === "L" ? zz.fL : zz.fR;
  const pt = mid(sh, el, 0.6);
  const zone = V.shotZone(a, pt);
  V.shot(a, { point: pt, dir: { x: 0, z: -1 }, cal: 0.8 });
  let gap = -9;
  const other = side === "L" ? "R" : "L";
  run(40, () => { ch.group.updateMatrixWorld(true); gap = Math.max(gap, hand(ch, other).y - hand(ch, side).y); });
  const r = { side, zone, kind: ch.hitReact && ch.hitReact.kind, gap };
  armRows.push(r);
  check(zone === "arm" + side, "an upper-arm round finds his " + side + " arm (" + zone + ")");
  check(r.kind === "arm", side + " arm: the arm reaction plays (" + r.kind + ")");
  check(gap > 0.2, side + " arm: THAT hand hangs below the other, which comes across (" + f2(gap) + " m)");
}

// ================================================================ STACKING
let stackRow = {};
{
  const shots = (n) => {
    const a = man(0), ch = a.char;
    let down = false, amtDrop = false, lastAmt = 0;
    for (let k = 0; k < n; k++) {
      const pt = zones(a).belly.c.clone();
      V.shot(a, { point: pt, dir: { x: 0, z: -1 }, cal: 0.8 });
      run(1);
      const hr = ch.hitReact;
      if (hr && hr.on && k > 0 && hr.amt < lastAmt - 1e-6) amtDrop = true;
      if (hr) lastAmt = hr.amt;
      for (let i = 0; i < 17; i++) { W.frame(DT); if (ch.fall && ch.fall.on && ch.fall.variant !== "kneel") down = true; }
    }
    run(40, () => { if (ch.fall && ch.fall.on && ch.fall.variant !== "kneel") down = true; });
    return { down, amtDrop, amt: lastAmt };
  };
  const two = shots(2), three = shots(3);
  stackRow = { two, three };
  check(!two.down, "two pistol rounds in the torso leave him standing");
  check(three.down, "three pistol rounds inside a second put him down");
  check(!two.amtDrop && !three.amtDrop, "a second round never weakens the reaction");
}

// ================================================================ SHOTGUN
let sgRow = {};
{
  const blast = (dist) => {
    const a = man(0), ch = a.char;
    const pt = zones(a).belly.c.clone();
    for (let i = 0; i < 9; i++) V.shot(a, { point: pt, dir: { x: 0, z: -1 }, cal: 1.5, wkey: "shotgun", dist, share: 1 / 9 });
    let down = false;
    run(40, () => { if (ch.fall && ch.fall.on) down = true; });
    return down;
  };
  sgRow = { close: blast(2), far: blast(20) };
  check(sgRow.close, "a shotgun blast at 2 m puts him down");
  check(!sgRow.far, "the same blast from 20 m does not");
}

// ================================================================ RUNNING
let runRow = {};
{
  const a = man(0), ch = a.char;
  W.setSpeed(a, 5.5);
  run(30);
  const p0 = a.pos.clone();
  const pt = zones(a).belly.c.clone();
  V.shot(a, { point: pt, dir: { x: 1, z: 0 }, cal: 0.9 });
  run(3);
  const kind = ch.hitReact && ch.hitReact.kind;
  run(40);
  W.setSpeed(a, 0);
  runRow = { kind, fwd: a.pos.z - p0.z, side: a.pos.x - p0.x };
  check(kind === "stagger", "shot at a run: he stumbles (" + kind + ")");
  check(runRow.fwd > 0.1 && runRow.side > 0, "shot at a run: on forward along the run and with the round (fwd " + f2(runRow.fwd) + ", side " + f2(runRow.side) + ")");
}

// ================================================================ FISTS
let fistRow = {};
{
  const pair = (bGuard) => {
    W.clearActors();
    const A = W.actor({ x: 0, z: 0, yaw: 0, name: "A" });
    const B = W.actor({ x: 0, z: 1.2, yaw: Math.PI, name: "B" });
    V.guard(A, true); if (bGuard) V.guard(B, true);
    run(40);
    return { A, B };
  };
  {
    const { A, B } = pair(true);
    V.block(B, 1.0); run(8);
    const z0 = B.pos.z;
    let blocked = false;
    V.strike(A, B, { kind: "cross", lunge: false, onBlocked(r) { blocked = r.blocked; }, onLand(r) { blocked = r.blocked; } });
    run(50);
    fistRow.blocked = blocked; fistRow.blockBack = B.pos.z - z0;
    check(blocked, "fists: the raised guard takes the cross");
    check(fistRow.blockBack > 0.03, "fists: a blocked blow pushes the blocker back along it (" + f2(fistRow.blockBack) + " m)");
  }
  {
    const { A, B } = pair(true);
    const z0 = B.pos.z;
    let landed = false;
    V.strike(A, B, { kind: "jab", lunge: false, rng: () => 0.99, onLand(r) { landed = r.landed; } });
    run(50);
    fistRow.jabLanded = landed; fistRow.jabBack = B.pos.z - z0;
    check(landed, "fists: the jab lands");
    check(fistRow.jabBack > 0.02, "fists: a landed jab carries his weight back along it (" + f2(fistRow.jabBack) + " m)");
  }
}

// ================================================================ KNOCKDOWN ALONG THE BLOW, KO CLOCK = GET-UP
const kdRows = [];
for (const [name, dz, want] of [["pushed back", 1, "back"], ["hit from behind", -1, "face"]]) {
  W.clearActors();
  const B = W.actor({ x: 0, z: 0, yaw: Math.PI, name: "B" });      // faces -z; +z is behind him
  run(20);
  const z0 = B.pos.z, gy0 = B.char.group.rotation.y;
  V.knockdown(B, { dir: { x: 0, z: dz }, ko: true, power: 0.8, dur: 0.5 });
  const variant = B.char.fall && B.char.fall.variant;
  let t = 0, koAtStand = null, yawMax = 0;
  for (let i = 0; i < 60 * 8; i++) {
    W.frame(DT); t += DT;
    yawMax = Math.max(yawMax, Math.abs(angDiff(B.char.group.rotation.y, gy0)));
    if (!(B.char.fall && B.char.fall.on)) { koAtStand = B.ko || 0; break; }
  }
  const r = { name, variant, moved: (B.pos.z - z0) * dz, koAtStand, t, yaw: yawMax * DEG };
  kdRows.push(r);
  check(variant === want, "knockdown " + name + ": falls on his " + want + " (" + variant + ")");
  check(r.moved > 0.1, "knockdown " + name + ": goes down along the blow (" + f2(r.moved) + " m)");
  check(r.yaw < 1, "knockdown " + name + ": no turn of the body while he falls (" + r.yaw.toFixed(1) + " deg)");
  check(koAtStand != null && koAtStand < 0.1, "knockdown " + name + ": his ko clock runs out with the get-up (ko " + f2(koAtStand) + " at " + t.toFixed(2) + " s)");
}

// ================================================================ REPORT
console.log("\nverbs-shot-check — a round into a living man, on the real rig\n");
console.log("from                 along  across  yaw(deg)  twist(deg)  foot-across  fold");
for (const r of rows) console.log(`${r.name.padEnd(20)} ${f2(r.along)}  ${f2(r.across)}   ${r.yaw.toFixed(1).padStart(5)}     ${r.twist.toFixed(1).padStart(5)}      ${f2(r.foot)}      ${f2(r.fold)}`);
console.log(`\nhead: ${headRow.kind}, neck x ${f2(headRow.nx)}`);
for (const r of legRows) console.log(`leg ${r.side}: zone ${r.zone}, ${r.fall}, knee ${f2(r.kHit)} vs ${f2(r.kOther)}, bend ${f2(r.bendHit)} vs ${f2(r.bendOther)}, up after ${r.upT.toFixed(2)} s`);
for (const r of armRows) console.log(`arm ${r.side}: zone ${r.zone}, ${r.kind}, hand ${f2(r.gap)} m below the other`);
console.log(`stack: 2 rounds down=${stackRow.two.down}, 3 rounds down=${stackRow.three.down}   shotgun: 2 m down=${sgRow.close}, 20 m down=${sgRow.far}`);
console.log(`running: ${runRow.kind}, forward ${f2(runRow.fwd)} m, with the round ${f2(runRow.side)} m`);
for (const r of kdRows) console.log(`knockdown ${r.name}: ${r.variant}, ${f2(r.moved)} m along the blow, up at ${r.t.toFixed(2)} s with ko ${f2(r.koAtStand)}`);
console.log(`fists: blocked=${fistRow.blocked} blocker back ${f2(fistRow.blockBack)} m, jab landed=${fistRow.jabLanded} target back ${f2(fistRow.jabBack)} m`);
if (W.errors && W.errors.length) { console.log("\nloader/updater errors:\n  " + W.errors.slice(0, 6).join("\n  ")); fails++; }
console.log(`\n${checks - fails}/${checks} checks passed`);
if (fails) { console.log("FAILURES:\n  " + failures.join("\n  ")); process.exit(1); }
