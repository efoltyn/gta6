#!/usr/bin/env node
/* tools/verbs-strike-check.mjs — DOES A PUNCH LAND WHERE THE FIST IS?

   Plain node, real rigs (three r128 + entities/character.js + the melee pose
   layer + systems/verbs_strike.js, through tools/lib/verbs-vm.mjs when CORE's
   loader is present, a local one otherwise). Two adults square up and throw
   every blow in the vocabulary, and the check reads the answer off the
   skeleton:

     · every strike's phases run to completion and the fist goes back to
       the guard it came from;
     · each head punch lands on the head/jaw at the impact frame (the striking
       surface within 5 cm of the zone's surface) when in range, and whiffs
       when he is out of range;
     · a jab lands sooner than a cross, a cross turns the hips further than a
       jab, a hook's fist path is flatter than an uppercut's, body shots drop
       the fist to rib height;
     · the reaction follows the zone: a straight drives the head back, a hook
       turns it away from the fist, an uppercut lifts the chin, a body shot
       folds him forward, the liver drops him to a knee, a leg kick buckles;
     · a knockdown ends with the hips on the floor and the get-up ends standing;
     · a raised guard takes a head shot on the forearms (reduced damage), a
       slipped blow deals none;
     · the fighter never throws more than 4 blows in 2 s, goes back to its
       guard between combinations, and is deterministic under a seed;
     · hitstop freezes both rigs' melee clocks.

     node tools/verbs-strike-check.mjs            exit 0 = pass
*/
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const has = (f) => existsSync(new URL(f, ROOT));

// ---------------------------------------------------------------- the world
async function load() {
  if (has("tools/lib/verbs-vm.mjs")) {
    const { loadVerbsVM } = await import(new URL("tools/lib/verbs-vm.mjs", ROOT));
    const W = loadVerbsVM({ mode: "city" });
    if (!W.loaded.strike || !W.loaded.meleePoses) throw new Error("verbs-vm did not load the strike files: " + W.errors.join(" / "));
    return W;
  }
  // fallback: the thinnest loader that builds real rigs
  const g2d = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => ({ addColorStop() {}, data: new Uint8ClampedArray(4), width: 1 }), set: (t, k, v) => { t[k] = v; return true; } });
  const ctx = vm.createContext({ console, Math, performance, Float32Array, Float64Array, Uint8ClampedArray });
  ctx.window = ctx; ctx.self = ctx;
  ctx.document = { createElement: () => ({ width: 64, height: 64, style: {}, getContext: () => g2d() }), getElementById: () => null, addEventListener() {}, body: {} };
  ctx.addEventListener = () => {};
  vm.runInContext(read("src/vendor/three.r128.min.js"), ctx);
  const T = ctx.THREE;
  const updaters = [];
  ctx.CBZ = { CONFIG: {}, HUMAN_SCALE: 0.7, onUpdate: (order, fn) => updaters.push({ order, fn }), onAlways() {}, game: { mode: "city", state: "playing" }, now: 0,
    cmat: (c) => new T.MeshLambertMaterial({ color: c == null ? 0x888888 : c }), mat: (c) => new T.MeshLambertMaterial({ color: c == null ? 0x888888 : c }),
    boxGeom: (w, h, d) => new T.BoxGeometry(w, h, d), sfx() {}, shake() {}, doHitstop() {} };
  ctx.CBZ.player = { pos: new T.Vector3(0, 0, -30), dead: false };
  for (const f of ["src/systems/fphands.js", "src/entities/footwear.js", "src/entities/character.js", "src/entities/poses.js", "src/entities/meleeposes.js", "src/systems/verbs_strike.js"]) vm.runInContext(read(f), ctx, { filename: f });
  updaters.sort((a, b) => a.order - b.order);
  const CBZ = ctx.CBZ, actors = [], speeds = new Map(), errors = [];
  return {
    CBZ, THREE: T, errors, loaded: { strike: true, meleePoses: true },
    actor(o = {}) { const ch = CBZ.makeCharacter({}); const a = { char: ch, group: ch.group, pos: ch.group.position, hp: 100, maxHp: 100, dead: false }; if (o.x != null) ch.group.position.set(o.x, 0, o.z || 0); if (o.yaw != null) ch.group.rotation.y = o.yaw; actors.push(a); return a; },
    clearActors() { actors.length = 0; },
    frame(dt) { CBZ.now += dt * 1000; for (const a of actors) if (!a.dead) CBZ.animChar(a.char, speeds.get(a) || 0, dt); for (const u of updaters) { try { u.fn(dt); } catch (e) { errors.push(String(e && e.stack || e)); } } },
    setSpeed(a, v) { speeds.set(a, v); },
  };
}

const W = await load();
const { CBZ, THREE } = W;
const V = CBZ.verbs, MP = CBZ.meleePoses;
CBZ.doHitstop = () => {}; CBZ.shake = () => {};
const DT = 1 / 60;
let checks = 0, fails = 0;
const failures = [];
function check(ok, msg) { checks++; if (!ok) { fails++; failures.push(msg); } }
const f2 = (x) => (x == null || !isFinite(x) ? "  -  " : (x >= 0 ? " " : "") + x.toFixed(2));
const v3 = () => new THREE.Vector3();

function pair(dist, o = {}) {
  W.clearActors();
  const A = W.actor({ x: 0, z: 0, yaw: 0, name: "A" });
  const B = W.actor({ x: 0, z: dist, yaw: Math.PI, name: "B" });
  V.guard(A, true); V.guard(B, true);
  if (o.bGuard === false) V.guard(B, false);
  for (let i = 0; i < 40; i++) W.frame(DT);
  return { A, B };
}
function run(n, fn) { for (let i = 0; i < n; i++) { W.frame(DT); if (fn) fn(i); } }
function wrist(ch, arm, out) { return (arm === "l" ? ch.sockets.leftHand : ch.sockets.rightHand).getWorldPosition(out); }
function footMinY(ch) {
  const P = ch.profile, out = v3();
  ch.group.updateMatrixWorld(true);
  ch.low.rl.localToWorld(out.set(0, -P.legLo, 0)); const a = out.y;
  ch.low.ll.localToWorld(out.set(0, -P.legLo, 0)); return Math.min(a, out.y);
}

/* the lowest point of what you SEE of him: every VISIBLE mesh's own vertices
   (with its live morph targets), in world space. Box3.setFromObject is not
   that in r128: it unions each geometry's bounding box turned into the world
   (a lying torso's rotated box pokes a corner 30 cm lower than any vertex),
   the hair's box includes every morph target's extent, and hidden meshes
   count (the closed mouth cavity inside the head). That is what read as the
   face-down knockout "sinking 0.23 m": vertex by vertex he lay on the floor. */
const _lv = new THREE.Vector3(), _lm = new THREE.Vector3();
function lowestSkin(ch) {
  ch.group.updateMatrixWorld(true);
  let lo = 9;
  (function walk(o) {
    if (!o.visible) return;
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      const p = o.geometry.attributes.position, g = o.geometry;
      const mp = g.morphAttributes && g.morphAttributes.position, inf = o.morphTargetInfluences;
      const useM = mp && inf && inf.some((w) => w);
      for (let i = 0; i < p.count; i++) {
        _lv.fromBufferAttribute(p, i);
        if (useM) for (let m = 0; m < mp.length; m++) if (inf[m]) {
          _lm.fromBufferAttribute(mp[m], i);
          if (g.morphTargetsRelative) _lv.addScaledVector(_lm, inf[m]);
          else _lv.addScaledVector(_lm.sub(_lv), inf[m]);
        }
        _lv.applyMatrix4(o.matrixWorld);
        if (_lv.y < lo) lo = _lv.y;
      }
    }
    for (const c of o.children) walk(c);
  })(ch.body);
  return lo;
}

// ================================================================ STRIKES
const HEAD = ["jab", "cross", "hook", "upper", "overhand", "elbow", "headbutt"];
const BODY = ["body", "bodyStraight", "stab", "knee", "kick", "roundKick", "lowKick"];
const rows = [];
const info = {};
for (const kind of HEAD.concat(BODY)) {
  const reach = V.reachOf(kind);
  const { A, B } = pair(reach - 0.08);
  const ch = A.char, bch = B.char;
  const kick = /kick|knee/i.test(kind);
  const rec = { kind, landed: false, zone: null, tContact: null, pContact: null, surf: null, hipTurn: 0, flat: null, lowY: null, guardBack: null, done: false, feet: 9, dmgMul: null };
  const guardArm = kick ? null : MP.armFor(ch, kind);
  const g0 = guardArm ? wrist(ch, guardArm, v3()) : null;
  const by0 = ch.body.rotation.y;
  let t = 0, yMin = 9, yMax = -9, hMin = 9e9, hMax = -9e9, pathN = 0;
  const w = v3();
  const Z = MP.newZones();
  const S = V.strike(A, B, { kind, lunge: false, rng: () => 0.99,
    onLand(res) {
      rec.landed = true; rec.zone = res.zone; rec.tContact = t; rec.pContact = res.strike.p; rec.dmgMul = res.dmgMul;
      MP.zones(bch, Z);
      const zc = res.zone === "jaw" ? Z.jaw : res.zone === "head" ? Z.head : res.zone === "liver" ? Z.liver : res.zone === "body" ? Z.belly : null;
      if (zc) rec.surf = res.point.distanceTo(zc.c) - zc.r;
      if (res.zone === "body" && rec.surf != null && rec.surf > 0.05) {
        // a body shot may meet the side of the chest before the belly sphere
        rec.surf = Math.min(rec.surf, 0.05);
      }
      rec.lowY = res.point.y;
      res.reaction = "none";      // judge the swing here; reactions are checked below
    } });
  check(!!S, kind + ": strike started");
  const dur = S ? S.dur : 0.4;
  run(Math.ceil((dur + 0.6) / DT), () => {
    t += DT;
    rec.hipTurn = Math.max(rec.hipTurn, Math.abs(ch.body.rotation.y - by0));
    rec.feet = Math.min(rec.feet, footMinY(ch));
    if (!kick) {
      const p = 1 - Math.max(0, ch.punchT) / dur;
      if (ch.punchT > 0 && p > 0.18 && p < 0.52) { wrist(ch, guardArm, w); yMin = Math.min(yMin, w.y); yMax = Math.max(yMax, w.y); const h = Math.hypot(w.x, w.z); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); pathN++; }
    }
  });
  rec.done = !(ch.punchT > 0) && !(ch.kickT > 0) && !V.strikeOf(A);
  if (g0) { const g1 = wrist(ch, guardArm, v3()); rec.guardBack = g1.distanceTo(g0); }
  if (pathN) rec.flat = (yMax - yMin) / Math.max(0.01, Math.hypot(yMax - yMin, hMax - hMin));
  info[kind] = rec;
  // out of range: the same blow at reach + 0.45 without a step must miss
  {
    const { A: A2, B: B2 } = pair(reach + 0.45);
    let landed = false, whiffed = false;
    V.strike(A2, B2, { kind, lunge: false, onLand() { landed = true; }, onWhiff() { whiffed = true; } });
    run(Math.ceil((dur + 0.3) / DT));
    rec.outWhiff = !landed && whiffed;
  }
  rows.push(rec);
  check(rec.done, kind + ": phases ran to completion");
  check(rec.landed, kind + ": landed in range (" + (reach - 0.08).toFixed(2) + " m)");
  check(rec.outWhiff, kind + ": whiffs out of range");
  check(rec.feet > -0.06, kind + ": feet stay on the floor (min " + rec.feet.toFixed(3) + ")");
  if (guardArm) check(rec.guardBack != null && rec.guardBack < 0.07, kind + ": the fist returns to the guard (" + (rec.guardBack || 0).toFixed(3) + " m)");
  if (HEAD.includes(kind) && kind !== "headbutt" && kind !== "elbow") {
    check(rec.zone === "jaw" || rec.zone === "head", kind + ": lands on the head/jaw (got " + rec.zone + ")");
    check(rec.surf != null && rec.surf <= 0.05, kind + ": striking surface within 5 cm of the zone at impact (" + f2(rec.surf) + ")");
  }
}
check(info.jab.tContact < info.cross.tContact, "a jab lands before a cross (" + f2(info.jab.tContact) + " vs " + f2(info.cross.tContact) + ")");
check(info.cross.hipTurn > info.jab.hipTurn + 0.25, "a cross turns the hips more than a jab (" + f2(info.cross.hipTurn) + " vs " + f2(info.jab.hipTurn) + ")");
check(info.hook.flat != null && info.upper.flat != null && info.hook.flat < info.upper.flat, "a hook's path is flatter than an uppercut's (" + f2(info.hook.flat) + " vs " + f2(info.upper.flat) + ")");
{
  // rib height on the target: between his hip joint and his shoulders
  const { B } = pair(1.2);
  const hip = B.char.parts.rl.getWorldPosition(v3()).y, sh = B.char.parts.la.getWorldPosition(v3()).y;
  for (const k of ["body", "bodyStraight"]) {
    const y = info[k].lowY;
    check(y != null && y > hip && y < sh - 0.1, k + ": the fist goes to rib height (" + f2(y) + " between " + f2(hip) + " and " + f2(sh - 0.1) + ")");
    check(info[k].zone === "body" || info[k].zone === "liver", k + ": lands on the body (" + info[k].zone + ")");
  }
  check(info.body.zone === "liver", "the lead hook to the body finds the liver (" + info.body.zone + ")");
  check(info.lowKick.zone === "legs", "the low kick lands on the thigh (" + info.lowKick.zone + ")");
}

// ================================================================ REACTIONS
function reactProbe(kind, zone) {
  const { A, B } = pair(1.0);
  const n = B.char.neck, b = B.char.body;
  const nx0 = n.rotation.x, ny0 = n.rotation.y, bx0 = b.rotation.x;
  V.react(B, { zone, kind, dir: { x: 0, z: 1 }, power: 0.8, arm: kind === "hook" ? MP.armFor(A.char, "hook") : undefined });
  let pnx = 0, pny = 0, pbx = 0, hipMin = 9;
  run(50, () => {
    const dnx = n.rotation.x - nx0, dny = n.rotation.y - ny0;
    if (Math.abs(dnx) > Math.abs(pnx)) pnx = dnx;
    if (Math.abs(dny) > Math.abs(pny)) pny = dny;
    pbx = Math.max(pbx, b.rotation.x - bx0);
    hipMin = Math.min(hipMin, B.char.parts.rl.getWorldPosition(v3()).y);
  });
  return { nx: pnx, ny: pny, bx: pbx, hipMin, fall: B.char.fall, hr: B.char.hitReact, B };
}
const reacts = [];
{
  const s = reactProbe("cross", "jaw");
  reacts.push(["straight→jaw", s]);
  check(s.nx < -0.2 && Math.abs(s.nx) > Math.abs(s.ny), "a straight drives the head back (neck x " + f2(s.nx) + ", y " + f2(s.ny) + ")");
  const h = reactProbe("hook", "jaw");
  reacts.push(["hook→jaw", h]);
  check(Math.abs(h.ny) > 0.25 && Math.abs(h.ny) > Math.abs(h.nx), "a hook turns the head sideways (neck y " + f2(h.ny) + ", x " + f2(h.nx) + ")");
  // the lead (left) hook comes from his right: the head goes to his left (+y)
  check(h.ny > 0, "a left hook turns his head to his left, away from the fist (" + f2(h.ny) + ")");
  const u = reactProbe("upper", "jaw");
  reacts.push(["upper→jaw", u]);
  check(u.nx < -0.35 && Math.abs(u.nx) > Math.abs(u.ny), "an uppercut lifts the chin (neck x " + f2(u.nx) + ")");
  check(u.nx < s.nx, "an uppercut lifts the chin more than a straight (" + f2(u.nx) + " vs " + f2(s.nx) + ")");
  const bo = reactProbe("bodyStraight", "body");
  reacts.push(["straight→body", bo]);
  check(bo.bx > 0.3, "a body shot folds the torso forward (body x +" + f2(bo.bx) + ")");
  const lg = reactProbe("lowKick", "legs");
  reacts.push(["kick→legs", lg]);
  check(lg.hr && lg.hr.kind === "buckle" && lg.hipMin < 0.6, "a leg kick buckles him (" + (lg.hr && lg.hr.kind) + ", hip " + f2(lg.hipMin) + ")");
  // the liver: a beat, then down to a knee, then up
  const { B } = pair(1.0);
  V.react(B, { zone: "liver", kind: "body", dir: { x: 0, z: 1 }, power: 0.8 });
  const f = B.char.fall;
  check(!!(f && f.on && f.variant === "liver"), "a liver shot starts the delayed fold");
  const hip0 = B.char.parts.rl.getWorldPosition(v3()).y;
  run(10);
  const hipEarly = B.char.parts.rl.getWorldPosition(v3()).y;
  run(50);
  const hipKnee = B.char.parts.rl.getWorldPosition(v3()).y;
  check(hip0 - hipEarly < 0.08, "the liver waits a beat before it drops him (" + f2(hip0 - hipEarly) + " m in 0.17 s)");
  check(hipKnee < 0.47, "the liver drops him to a knee (hips " + f2(hipKnee) + " m)");
  reacts.push(["liver", { nx: 0, ny: 0, bx: 0, hipMin: hipKnee }]);
  let standT = 0;
  for (let i = 0; i < 400 && B.char.fall && B.char.fall.on; i++) { W.frame(DT); standT += DT; }
  check(!(B.char.fall && B.char.fall.on), "he gets up off the knee (" + standT.toFixed(2) + " s)");
}

// ================================================================ KNOCKDOWN / GET-UP
const downs = [];
for (const variant of ["back", "face"]) for (const ko of [true, false]) {
  const { B } = pair(1.0);
  B.ko = 0;
  const ch = B.char;
  ch.group.updateMatrixWorld(true);
  const hipStand = ch.parts.rl.getWorldPosition(v3()).y;     // his own stance height (soft knees)
  V.knockdown(B, { dir: { x: 0, z: variant === "back" ? 1 : -1 }, ko, dur: 0.6 });
  let downSeen = false, hipDown = 9, minBody = 9, feetMin = 9;
  for (let i = 0; i < 60 * 8 && ch.fall.on; i++) {
    W.frame(DT);
    if ((B.ko || 0) > 0) B.ko = Math.max(0, B.ko - DT);     // the game's own ko clock (the brain's)
    if (ch.fall.phase === "down") {
      downSeen = true;
      ch.group.updateMatrixWorld(true);
      hipDown = Math.min(hipDown, ch.parts.rl.getWorldPosition(v3()).y);
      minBody = Math.min(minBody, lowestSkin(ch));
    }
  }
  const stood = !ch.fall.on;
  run(20);
  ch.group.updateMatrixWorld(true);
  const hipUp = ch.parts.rl.getWorldPosition(v3()).y;
  feetMin = footMinY(ch);
  const row = { variant: variant + (ko ? " KO" : " trip"), downSeen, hipDown, minBody, stood, hipUp, feetMin, drop: ch.model.position.y };
  downs.push(row);
  check(downSeen && hipDown < 0.25, row.variant + ": ends with the hips on the floor (hip " + f2(hipDown) + " m)");
  check(minBody > -0.09 && minBody < 0.08, row.variant + ": the body rests ON the floor (lowest " + f2(minBody) + ")");
  check(stood && Math.abs(hipUp - hipStand) < 0.03 && Math.abs(ch.body.rotation.x) < 0.3, row.variant + ": the get-up ends standing (hip " + f2(hipUp) + " vs " + f2(hipStand) + ")");
  check(feetMin > -0.05 && feetMin < 0.06, row.variant + ": back on his feet (feet " + f2(feetMin) + ")");
}

// ================================================================ BLOCK / SLIP
let blockRow = {}, slipRow = {};
{
  const { A, B } = pair(1.2);
  V.block(B, 1.0);
  run(8);
  let res = null, dmg = 1;
  V.strike(A, B, { kind: "cross", lunge: false, onLand(r) { res = { blocked: r.blocked, mul: r.dmgMul }; dmg = r.dmgMul; }, onBlocked(r) { res = { blocked: r.blocked, mul: r.dmgMul }; dmg = r.dmgMul; } });
  let recoil = null;
  run(30, () => { if (res && recoil == null) recoil = 1 - A.char.punchT / A.char.punchDur; });
  blockRow = { blocked: res && res.blocked, mul: dmg, recoil, hitT: B.char.blockHitT };
  check(!!(res && res.blocked), "a raised guard blocks a head shot from the front");
  check(dmg <= 0.25, "a blocked blow deals reduced damage (x" + f2(dmg) + ")");
  check(recoil != null && recoil >= 0.6, "the attacker's arm bounces back off the guard (prog jumps to " + f2(recoil) + ")");
  // a body shot goes under the high guard
  const P2 = pair(1.2);
  V.block(P2.B, 1.0); run(8);
  let bres = null;
  V.strike(P2.A, P2.B, { kind: "body", lunge: false, onLand(r) { bres = { blocked: r.blocked, zone: r.zone }; r.reaction = "none"; }, onBlocked(r) { bres = { blocked: true, zone: r.zone }; } });
  run(40);
  check(!!(bres && !bres.blocked), "a body shot goes under the high guard (" + JSON.stringify(bres) + ")");
}
{
  const { A, B } = pair(1.2);
  let landed = false, slipped = false;
  V.strike(A, B, { kind: "jab", lunge: false, onLand() { landed = true; }, onWhiff(r) { slipped = r.slipped; } });
  // he reads the shoulder and slips as it launches, after the aim has committed
  run(2);
  V.slip(B, 1);
  run(40);
  slipRow = { landed, slipped };
  check(!landed && slipped, "a slipped jab misses and reports the slip (landed " + landed + ", slipped " + slipped + ")");
}

// ================================================================ HITSTOP
let stopRow = {};
{
  const { A, B } = pair(1.2);
  let at = -1;
  V.strike(A, B, { kind: "cross", lunge: false, onLand(r) { at = 1; r.reaction = "snap"; } });
  for (let i = 0; i < 40 && at < 0; i++) W.frame(DT);
  const pT0 = A.char.punchT, hr0 = B.char.hitReact ? B.char.hitReact.t : null;
  const fa = A.char.freezeT, fb = B.char.freezeT;
  W.frame(DT);
  const pT1 = A.char.punchT, hr1 = B.char.hitReact ? B.char.hitReact.t : null;
  stopRow = { fa, fb, attFrozen: pT1 === pT0, tgtFrozen: hr0 != null && hr1 === hr0 };
  check(fa > 0 && fb > 0, "hitstop freezes both rigs (" + f2(fa) + "/" + f2(fb) + " s)");
  check(pT1 === pT0, "the attacker's punch clock stops during the freeze");
  check(hr0 != null && hr1 === hr0, "the target's reaction clock stops during the freeze");
  let n = 0; while ((A.char.freezeT > 0 || B.char.freezeT > 0) && n++ < 30) W.frame(DT);
  const pT2 = A.char.punchT;
  W.frame(DT);
  check(A.char.punchT < pT2, "the clocks run again after the freeze");
}

// ================================================================ THE FIGHTER
function bout(seed) {
  const { A, B } = pair(1.6);
  // a rig's gait/breath phase is Math.random (character.js): pin it so the
  // bout is a function of the seed alone (a man dropped by a liver shot now
  // gets up and fights on, and the rest of the bout must replay too)
  for (const a of [A, B]) { a.char.phase = 0; a.char.breath = 0; }
  const FA = V.fighter(A, { seed, skill: 0.7, aggression: 0.7 }), FB = V.fighter(B, { seed: seed + 1, skill: 0.4, aggression: 0.6 });
  const log = [];
  let maxWin = 0, guardBetween = 0, combosEnded = 0, blocks = 0, slips = 0, steps = 0;
  const times = [];
  let t = 0, lastBusy = false;
  let idleRun = 0;
  const onLand = (r) => { r.reaction = r.zone === "body" ? "fold" : "snap"; };
  for (let i = 0; i < 60 * 20; i++) {
    t += DT;
    const a1 = FA.tick(DT, B, { perform: true, onLand });
    if (a1 && a1.type === "strike") { log.push(t.toFixed(3) + ":" + a1.kind); times.push(t); }
    if (a1 && a1.type === "step") steps++;
    const b1 = FB.tick(DT, A, { perform: true, onLand });
    if (b1 && b1.type === "strike") log.push(t.toFixed(3) + ":B" + b1.kind);
    for (const x of [a1, b1]) { if (x && x.type === "block") blocks++; if (x && x.type === "slip") slips++; }
    // count blows inside any 2 s window
    let n = 0; for (let k = times.length - 1; k >= 0 && t - times[k] < 2.0; k--) n++;
    maxWin = Math.max(maxWin, n);
    const busy = !!V.strikeOf(A);
    if (!busy) idleRun += DT; else { if (idleRun > 0.35 && lastBusy === false) guardBetween++; idleRun = 0; }
    if (FA.state === "rest" && lastBusy) combosEnded++;
    lastBusy = busy;
    // keep them in range the way a brain would (the fighter only asks for steps)
    W.frame(DT);
  }
  return { log, maxWin, guardBetween, thrown: FA.thrown, blocks, slips, steps, stance: A.char.fightStance };
}
const b1 = bout(1234), b2 = bout(1234);
check(b1.thrown >= 6, "the fighter throws (" + b1.thrown + " blows in 20 s)");
check(b1.maxWin <= 4, "never more than 4 blows inside 2 s (max " + b1.maxWin + ")");
check(b1.guardBetween >= 2, "the guard comes back between combinations (" + b1.guardBetween + " rests)");
check(b1.stance === true, "the fighter holds its stance");
check(b1.log.join(",") === b2.log.join(","), "the fighter is deterministic under a seed");

// ================================================================ THE PRISON FISTS (systems/combat.js, routed)
let prisonRow = null;
if (W.ctx && CBZ.playerChar) {
  const vmMod = await import("node:vm");
  CBZ.econ = { hasItem: () => false, rng: () => 0.9, lootActor() {} };
  CBZ.reportCrime = () => {}; CBZ.game.koLog = {}; CBZ.game.kos = 0; CBZ.game.elapsed = 0;
  CBZ.lerpAngle = CBZ.lerpAngle || ((a, b, t) => a + (b - a) * t);
  CBZ.sfx = () => {}; CBZ.doSlowmo = () => {};
  // the body the fists land on: CBZ.vitals decides the knockout
  try { if (!CBZ.vitals || !CBZ.vitals.blunt) vmMod.runInContext(read("src/systems/vitals.js"), W.ctx, { filename: "src/systems/vitals.js" }); }
  catch (e) { check(false, "systems/vitals.js loads: " + e.message); }
  try { vmMod.runInContext(read("src/systems/combat.js"), W.ctx, { filename: "src/systems/combat.js" }); }
  catch (e) { check(false, "systems/combat.js loads: " + e.message); }
  if (CBZ.punch) {
    // pick up the updater combat.js registered (stamina / bleed tick)
    const PC = CBZ.playerChar;
    W.clearActors();
    const B = W.actor({ x: 0, z: 1.85, yaw: Math.PI, name: "inmate" });
    B.kind = "inmate"; B.data = { name: "Inmate" }; B.gang = -1;
    CBZ.npcs = [B]; CBZ.guards = [];
    CBZ.player.pos.set(0, 0, 0); PC.group.position.set(0, 0, 0); PC.group.rotation.y = 0;
    CBZ.player.dead = false; CBZ.player.hitLock = 0; CBZ.player.stun = 0;
    const tick = (n) => { for (let i = 0; i < n; i++) { CBZ.player.hitLock = 0; PC.group.position.copy(CBZ.player.pos); CBZ.animChar(PC, 0, DT); W.frame(DT); } };
    tick(20);
    const hp0 = B.hp, z0 = CBZ.player.pos.z;
    const r1 = CBZ.punch(B);
    tick(40);
    const stepIn = CBZ.player.pos.z - z0;
    const dmg1 = hp0 - B.hp;
    const reacted = !!(B.char.hitReact && (B.char.hitReact.on || B.char.hitReact.t > 0));
    // out of range: he backs off to 4 m before the next one
    B.group.position.set(0, 0, CBZ.player.pos.z + 4.0);
    tick(70);
    const hp1 = B.hp;
    CBZ.punch(B);
    tick(40);
    const whiffed = B.hp === hp1;
    // the one that drops him: a clean KO, and he goes down in his own rig
    B.group.position.set(0, 0, CBZ.player.pos.z + 1.2);
    tick(90);
    // a man already rocked (vitals' daze at the edge): the next one puts him out
    if (CBZ.vitals && CBZ.vitals.of) CBZ.vitals.of(B).daze = 0.98;
    CBZ.punch(B);
    let fell = false;
    for (let i = 0; i < 60; i++) { tick(1); if (B.char.fall && B.char.fall.on) fell = true; }
    prisonRow = { ok: r1 && r1.ok, stepIn, dmg1, reacted, whiffed, ko: B.ko, fell };
    check(!!(r1 && r1.ok), "prison: CBZ.punch throws");
    check(stepIn > 0.2, "prison: he steps in to reach a man at 1.85 m (" + f2(stepIn) + " m)");
    check(dmg1 > 3 && dmg1 < 20, "prison: the punch lands through the fist (" + f2(dmg1) + " hp)");
    check(reacted, "prison: the man hit reacts on his rig");
    check(whiffed, "prison: a man 4 m away is a whiff");
    check(B.ko > 0 && fell, "prison: the KO puts him down in his own fall (ko " + f2(B.ko) + ", fell " + fell + ")");
  }
}

// ================================================================ THE CITY COMBO (city/combat.js, routed)
let cityRow = null;
if (W.ctx && CBZ.playerChar) {
  const vmMod = await import("node:vm");
  const listeners = {};
  const doc = W.ctx.document, oldAdd = doc.addEventListener;
  doc.addEventListener = (t, f) => { listeners[t] = f; };
  doc.pointerLockElement = {};
  const was = CBZ.game.mode;
  CBZ.game.mode = "city";
  CBZ.cityPeds = []; CBZ.cityCops = []; CBZ.cityWildlife = [];
  let koCall = null, kills = 0;
  CBZ.cityHurtCop = () => {}; CBZ.cityKillPed = (p) => { p.dead = true; kills++; };
  CBZ.cityKOPed = (p, x, z, o) => { p.ko = 8; koCall = o || {}; };
  CBZ.cityHurtPlayer = CBZ.cityHurtPlayer || (() => {});
  CBZ.city = CBZ.city || { playerActor: null, note() {}, addRespect() {} };
  CBZ.cam = { yaw: Math.PI, pitch: 0 };                      // looking down +Z
  CBZ.equippedWeapon = () => null; CBZ.cityEcon = { ITEMS: {} }; CBZ.game.cityMeleeWeapon = null;
  try { vmMod.runInContext(read("src/city/combat.js"), W.ctx, { filename: "src/city/combat.js" }); }
  catch (e) { check(false, "city/combat.js loads: " + e.message); }
  doc.addEventListener = oldAdd;
  if (W.updaters) W.updaters.sort((a, b) => a.order - b.order);
  if (listeners.mousedown) {
    const PC = CBZ.playerChar;
    W.clearActors();
    CBZ.npcs = []; CBZ.guards = [];
    CBZ.player.pos.set(0, 0, 0); PC.group.position.set(0, 0, 0); PC.group.rotation.y = 0;
    CBZ.player.stamina = 100; CBZ.player.hp = 100; CBZ.player.dead = false;
    const B = W.actor({ x: 0, z: 1.7, yaw: Math.PI });
    B.kind = "civ"; B.hp = 100; B.maxHp = 100;
    CBZ.cityPeds.push(B);
    const tick = (n) => { for (let i = 0; i < n; i++) { PC.group.position.copy(CBZ.player.pos); CBZ.animChar(PC, 0, DT); W.frame(DT); } };
    tick(10);
    const hps = [B.hp];
    for (let k = 0; k < 3; k++) { listeners.mousedown({ button: 0, preventDefault() {} }); tick(26); hps.push(B.hp); }
    const fell = !!(B.char.fall && B.char.fall.on);
    cityRow = { hps, fell, ko: B.ko || 0, backed: B.pos.z - 1.7 };
    check(hps[1] < hps[0] && hps[2] < hps[1], "city: the jab and the cross land through the fist (" + hps.map((h) => h.toFixed(0)).join(" > ") + ")");
    check(hps[3] < hps[2], "city: the finisher hook follows him in and lands");
    check(fell && B.ko > 0, "city: the finisher puts him down in his own rig (ko " + f2(B.ko) + ")");
    check(cityRow.backed > 0.1, "city: a hard shot drives him back a real step (" + f2(cityRow.backed) + " m)");
  } else check(false, "city/combat.js registered its mouse input");
  CBZ.game.mode = was;
}

// ================================================================ GROUND AND POUND
// a man knocked flat on his back is mounted (knees either side of him, hips
// low over his belly, facing his head) and pounded: every blow of the
// sequence lands on its beat with the fist/elbow at his face, his head turns
// off it, and the mount ends a beat after the last blow.
let gnpRow = null;
if (V.groundStrike) {
  const { A, B } = pair(1.0);
  V.guard(A, false);
  const ach = A.char, bch = B.char;
  V.knockdown(B, { dir: { x: 0, z: 1 }, ko: true, dur: 60 });
  B.ko = 60;
  run(90);
  const kinds = [], zones = [];
  let lands = 0, worstReach = 0, hipMin = 9, feetMin = 9, neckTurn = 0, maxOff = 0, mountK = 0;
  const hv = v3(), sp = v3(), bh = v3();
  for (let n = 0; n < 6; n++) {
    const S = V.groundStrike(A, B, { onLand: (res) => { lands++; zones.push(res.zone); } });
    if (!S) { kinds.push("NONE"); run(10); continue; }
    kinds.push(S.kind);
    const kind = S.kind, arm = S.arm;
    let best = 9;
    const n0 = bch.neck.rotation.y;
    for (let i = 0; i < 60 && S.on; i++) {
      W.frame(DT);
      ach.group.updateMatrixWorld(true); bch.group.updateMatrixWorld(true);
      bch.head.getWorldPosition(hv);
      MP.strikePoint(ach, kind, arm, sp);
      best = Math.min(best, sp.distanceTo(hv));
      neckTurn = Math.max(neckTurn, Math.abs(bch.neck.rotation.y - n0));
      hipMin = Math.min(hipMin, ach.parts.rl.getWorldPosition(v3()).y);
      feetMin = Math.min(feetMin, footMinY(ach));
      bch.body.getWorldPosition(bh);
      maxOff = Math.max(maxOff, Math.hypot(A.group.position.x - bh.x, A.group.position.z - bh.z));
      mountK = Math.max(mountK, ach._mountK || 0);
    }
    const headR = 0.47 * 0.6 * (bch.body.matrixWorld.getMaxScaleOnAxis() || 0.7);
    worstReach = Math.max(worstReach, best - headR);
    run(4);
  }
  run(150);
  gnpRow = { kinds, lands, worstReach, hipMin, feetMin, neckTurn, maxOff, mountK, ended: !ach.mount && (ach._mountK || 0) < 0.05 };
  check(kinds.indexOf("NONE") < 0 && lands === 6, "ground and pound: all 6 blows thrown and landed (" + kinds.join(",") + ", lands " + lands + ")");
  check(kinds.indexOf("gnp") >= 0 && kinds.indexOf("gnpElbow") >= 0 && kinds.indexOf("hammer") >= 0, "ground and pound: punches, the elbow and the hammerfist all come out");
  check(zones.every((z) => z === "head"), "ground and pound: every blow lands on his head");
  check(mountK > 0.9, "the mount blends fully in (" + f2(mountK) + ")");
  check(hipMin < 0.55, "mounted: the hips are low over him (hip " + f2(hipMin) + " m)");
  check(feetMin > -0.08, "mounted: no foot through the floor (" + f2(feetMin) + ")");
  check(worstReach < 0.16, "every blow reaches his face (worst miss " + f2(worstReach) + " m past the skull)");
  check(neckTurn > 0.15, "his head turns off the blows (" + f2(neckTurn) + " rad)");
  check(gnpRow.ended, "the mount ends a beat after the last blow");
}

// ================================================================ REPORT
console.log("\nverbs-strike-check — contact-resolved strikes on real rigs\n");
console.log("kind          land  zone   t(s)  p     surf   hips  flat  lowY  guard  out");
for (const r of rows) {
  console.log(`${r.kind.padEnd(13)} ${r.landed ? "yes " : "NO  "} ${(r.zone || "-").padEnd(6)} ${f2(r.tContact)} ${f2(r.pContact)} ${f2(r.surf)} ${f2(r.hipTurn)} ${f2(r.flat)} ${f2(r.lowY)} ${f2(r.guardBack)}  ${r.outWhiff ? "whiff" : "HIT!"}`);
}
console.log("\nreaction        neck.x  neck.y  body.x  hipMin");
for (const [n, s] of reacts) console.log(`${n.padEnd(15)} ${f2(s.nx)}   ${f2(s.ny)}   ${f2(s.bx)}   ${f2(s.hipMin)}`);
console.log("\nfall          down  hipDown  lowest  stood  hipUp");
for (const d of downs) console.log(`${d.variant.padEnd(13)} ${d.downSeen ? "yes " : "no  "} ${f2(d.hipDown)}    ${f2(d.minBody)}   ${d.stood ? "yes" : "NO "}   ${f2(d.hipUp)}`);
console.log(`\nblock: blocked=${blockRow.blocked} dmg x${f2(blockRow.mul)} attacker recoil to p=${f2(blockRow.recoil)}   slip: landed=${slipRow.landed} slipped=${slipRow.slipped}`);
console.log(`hitstop: freeze ${f2(stopRow.fa)}/${f2(stopRow.fb)} s, attacker clock held=${stopRow.attFrozen}, target clock held=${stopRow.tgtFrozen}`);
if (cityRow) console.log(`city LMB combo: hp ${cityRow.hps.map((h) => h.toFixed(0)).join(" > ")}, driven back ${f2(cityRow.backed)} m, finisher fall=${cityRow.fell}`);
if (prisonRow) console.log(`prison CBZ.punch: step-in ${f2(prisonRow.stepIn)} m, ${f2(prisonRow.dmg1)} hp, reacted=${prisonRow.reacted}, out-of-range whiff=${prisonRow.whiffed}, KO fall=${prisonRow.fell}`);
if (gnpRow) console.log(`ground and pound: ${gnpRow.kinds.join(" ")}, lands ${gnpRow.lands}, worst miss ${f2(gnpRow.worstReach)} m, hips ${f2(gnpRow.hipMin)} m, feet ${f2(gnpRow.feetMin)}, head turn ${f2(gnpRow.neckTurn)}, off-centre ${f2(gnpRow.maxOff)} m, ended=${gnpRow.ended}`);
console.log(`fighter (20 s, seed 1234): ${b1.thrown} blows, max ${b1.maxWin} per 2 s, ${b1.guardBetween} guard returns, ${b1.blocks} blocks, ${b1.slips} slips, ${b1.steps} steps, deterministic=${b1.log.join(",") === b2.log.join(",")}`);
if (W.errors && W.errors.length) { console.log("\nloader/updater errors:\n  " + W.errors.slice(0, 6).join("\n  ")); fails++; }
console.log(`\n${checks - fails}/${checks} checks passed`);
if (fails) { console.log("FAILURES:\n  " + failures.join("\n  ")); process.exit(1); }
