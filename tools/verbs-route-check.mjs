#!/usr/bin/env node
/* tools/verbs-route-check.mjs — DOES EVERY OTHER FIGHT GO THROUGH CBZ.verbs?

   verbs-strike-check.mjs proves a punch lands where the fist is. This proves
   the games that used to fake it now throw real ones, in plain node on real
   rigs (tools/lib/verbs-vm.mjs + the game file itself):

     · PRISON YARD (entities/ai.js): two inmates in a fight box each other —
       animated strikes from both, never more than 4 a man in any 2 s, and
       hp only moves when a blow LANDS (the old exchangeBlows took stat
       damage every 0.7 s with no swing at all);
     · PRISON HUNT (entities/ai.js): a man jumping you throws a real strike,
       CBZ.hurtPlayer is paid only when it lands (reacted, so capture.js
       does not play a second reaction), and a swing you step out of costs
       nothing; a knockout (down()) is a fall in his own rig;
     · ARENA CAGE (city/arena_fights.js): standing still takes nothing off
       the opponent (it used to lose 10-15 hp every 0.85 s whether or not you
       swung), his blows reach cityHurtPlayer with a real position (it used
       to get his NAME as fromX), and a landed fist of yours scores through
       meleeHit;
     · ARENA RING: the house pair box as two CBZ.verbs fighters and a
       knockdown ends the bout in the loser's own fall.

     node tools/verbs-route-check.mjs            exit 0 = pass
*/
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const DT = 1 / 60;
let checks = 0, fails = 0;
const failures = [], rows = [];
function check(ok, msg) { checks++; if (!ok) { fails++; failures.push(msg); } }
const f2 = (x) => (x == null || !isFinite(x) ? "-" : x.toFixed(2));
function lcg(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

// the swing counter a rig carries (verbs_strike bumps it per strike)
function swingsOf(a) { return (a.char && a.char._mSwingN) || 0; }
function playerFrame(W) {
  const PC = W.CBZ.playerChar;
  PC.group.position.copy(W.CBZ.player.pos);
  W.CBZ.animChar(PC, 0, DT);
}

// ================================================================ PRISON
function prisonWorld(seed) {
  const W = loadVerbsVM({ mode: "escape" });
  const { CBZ, THREE } = W;
  CBZ.econ = { rng: lcg(seed), hasItem: () => false };
  CBZ.npcs = []; CBZ.guards = [];
  CBZ.game.elapsed = 0; CBZ.scene = new THREE.Group(); CBZ.npcPickTarget = () => {};
  CBZ.addHeat = () => {};
  vm.runInContext(read("src/entities/ai.js"), W.ctx, { filename: "src/entities/ai.js" });
  const inmate = (x, z, yaw, name) => {
    const a = W.actor({ x, z, yaw, name });
    Object.assign(a, { kind: "inmate", data: { name }, gang: -1, baseSpeed: 2, target: new THREE.Vector3(), hitCD: 0, ratings: { fighting: 55, toughness: 50 }, slice: 0 });
    CBZ.npcs.push(a);
    return a;
  };
  // npc.js's part of the loop: a man with a ko timer is off the brain, and it counts down
  const think = (list, errs) => {
    for (const n of list) {
      if (n.dead) continue;
      if (n.ko > 0) { n.ko -= DT; continue; }
      try { CBZ.aiThink(n, DT); } catch (e) { if (errs.length < 3) errs.push(String(e && e.stack || e)); }
    }
  };
  return { W, CBZ, THREE, inmate, think };
}

{ // ---- the yard fight: two fighters, not two hp counters ----
  const P = prisonWorld(11);
  const { W, CBZ, inmate, think } = P;
  const A = inmate(0, 0, 0, "A"), B = inmate(0, 1.4, Math.PI, "B");
  const errs = [];
  think([A, B], errs);                       // first think builds the yard
  A.aiState = "fight"; A.foe = B; B.aiState = "fight"; B.foe = A;
  const hp0 = A.hp + B.hp;
  const times = { A: [], B: [] };
  let last = { A: swingsOf(A), B: swingsOf(B) }, maxWin = 0, hpSteps = 0, hpLast = hp0, landedFrames = 0;
  let t = 0;
  for (let i = 0; i < 600; i++) {
    think([A, B], errs);
    W.frame(DT);
    t += DT;
    for (const [k, a] of [["A", A], ["B", B]]) {
      const n = swingsOf(a);
      for (let j = last[k]; j < n; j++) times[k].push(t);
      last[k] = n;
      let w = 0; for (let q = times[k].length - 1; q >= 0 && t - times[k][q] < 2.0; q--) w++;
      maxWin = Math.max(maxWin, w);
    }
    const hpNow = A.hp + B.hp;
    if (hpNow < hpLast - 1e-6) hpSteps++;
    hpLast = hpNow;
    if (A.char.punchLandP > 0 || B.char.punchLandP > 0) landedFrames++;
  }
  const thrown = times.A.length + times.B.length;
  rows.push(`prison yard 10 s: A threw ${times.A.length}, B threw ${times.B.length}, max ${maxWin} per man per 2 s, ${hpSteps} hp drops, hp ${f2(hp0)} -> ${f2(A.hp + B.hp)}`);
  check(errs.length === 0 && W.errors.length === 0, "prison yard: no errors (" + (errs[0] || W.errors[0] || "") + ")");
  check(times.A.length >= 3 && times.B.length >= 3, "prison yard: both men throw animated strikes (" + times.A.length + " / " + times.B.length + ")");
  check(maxWin <= 4, "prison yard: never more than 4 blows a man in 2 s (max " + maxWin + ")");
  check(hpSteps >= 2, "prison yard: landed blows cost hp (" + hpSteps + " drops)");
  check(hpSteps <= thrown, "prison yard: hp only moves on a thrown blow (" + hpSteps + " drops for " + thrown + " swings)");
}

{ // ---- no swing, no damage: two men in a fight out of reach of each other ----
  const P = prisonWorld(5);
  const { W, inmate, think } = P;
  const A = inmate(0, 0, 0, "A"), B = inmate(0, 3.4, Math.PI, "B");
  const errs = [];
  think([A, B], errs);
  A.aiState = "fight"; A.foe = B; B.aiState = "fight"; B.foe = A;
  const hp0 = A.hp + B.hp;
  for (let i = 0; i < 240; i++) { think([A, B], errs); W.frame(DT); }
  check(A.hp + B.hp === hp0, "prison yard: men 3.4 m apart deal nothing (hp " + f2(hp0) + " -> " + f2(A.hp + B.hp) + ")");
}

{ // ---- the knockout: down() is a fall in his own rig ----
  const P = prisonWorld(3);
  const { W, CBZ, inmate, think } = P;
  const A = inmate(0, 0, 0, "A"), B = inmate(0, 1.3, Math.PI, "B");
  const errs = [];
  think([A, B], errs);
  A.aiState = "fight"; A.foe = B; B.aiState = "wander";
  B.hp = 0.5; B.ratings.toughness = 200;                       // the next blow that lands drops him (and never kills)
  let fell = false, koSeen = 0;
  for (let i = 0; i < 480 && !fell; i++) {
    think([A], errs); W.frame(DT);
    if (B.char.fall && B.char.fall.on) { fell = true; koSeen = B.ko; }
  }
  rows.push(`prison KO: fell in rig=${fell}, ko ${f2(koSeen)} s`);
  check(fell && koSeen > 3, "prison yard: the knockout is his own fall with a ko timer (fell " + fell + ", ko " + f2(koSeen) + ")");
  check(B.group.rotation.z === 0, "prison yard: no whole-body roll onto the side");
}

{ // ---- the hunt: a man jumping you throws a real blow ----
  const P = prisonWorld(21);
  const { W, CBZ, inmate, think } = P;
  const calls = [];
  CBZ.hurtPlayer = (dmg, fx, fz, o) => { calls.push({ dmg, fx, fz, o }); return false; };
  CBZ.player.pos.set(0, 0, 0); CBZ.player.dead = false; CBZ.player.hp = 100;
  CBZ.playerChar.group.rotation.y = 0;
  const N = inmate(0, 1.45, Math.PI, "hunter");
  const errs = [];
  think([N], errs);
  N.aiState = "wander"; N.huntPlayer = 30; N.hitCD = 0;
  let swung = 0;
  for (let i = 0; i < 360; i++) {
    think([N], errs); playerFrame(W); W.frame(DT);
  }
  swung = swingsOf(N);
  const landed = calls.length;
  rows.push(`prison hunt 6 s: ${swung} swings, ${landed} landed through hurtPlayer`);
  check(errs.length === 0 && W.errors.length === 0, "prison hunt: no errors (" + (errs[0] || W.errors[0] || "") + ")");
  check(swung >= 2, "prison hunt: he throws real strikes on his rig (" + swung + ")");
  check(landed >= 1 && landed <= swung, "prison hunt: hurtPlayer is paid by landed blows only (" + landed + " of " + swung + ")");
  check(calls.every((c) => c.o && c.o.melee && c.o.reacted && isFinite(c.fx) && isFinite(c.fz)), "prison hunt: every blow is melee, reacted, from his position");
  // step out of it: the swing in flight goes through air
  let whiffOk = null;
  for (let i = 0; i < 240 && whiffOk == null; i++) {
    think([N], errs); playerFrame(W); W.frame(DT);
    const S = CBZ.verbs.strikeOf(N);
    if (S && S.p < 0.1) {
      const before = calls.length;
      CBZ.player.pos.set(0, 0, -3.5);
      for (let k = 0; k < 40; k++) { playerFrame(W); W.frame(DT); }
      whiffOk = calls.length === before;
    }
  }
  check(whiffOk === true, "prison hunt: a swing you step out of costs nothing");
}

// ================================================================ ARENA
function arenaWorld() {
  const W = loadVerbsVM({ mode: "city" });
  const { CBZ, THREE } = W;
  CBZ.addLandmass = () => {};
  CBZ.cmat = CBZ.cmat || ((c) => new THREE.MeshLambertMaterial({ color: c }));
  CBZ.city = { note() {}, addCash() {}, playerActor: { isPlayer: true, get pos() { return CBZ.player.pos; } } };
  CBZ.cityWorldCommit = () => {};
  vm.runInContext(read("src/city/arena_fights.js"), W.ctx, { filename: "src/city/arena_fights.js" });
  W.updaters.sort((a, b) => a.order - b.order);
  return W;
}

{ // ---- the cage: nothing on a timer ----
  const W = arenaWorld();
  const { CBZ, THREE } = W;
  const AP = CBZ.arenaFightProbe;
  check(!!AP, "arena: probe seam present");
  if (AP) {
    AP.root(new THREE.Group());
    const hurts = [];
    CBZ.cityHurtPlayer = (dmg, fx, fz, reason, head, att) => { hurts.push({ dmg, fx, fz, reason, att }); };
    CBZ.player.dead = false; CBZ.player.hp = 100;
    const f = AP.startCage(false);
    check(!!f && !!f.oppA, "arena cage: the bout starts with an opponent actor");
    const hp0 = f.oppHp;
    f.myHp = 1e9;                                   // you can take it: the bout outlasts the 10 s
    check(CBZ.cityMeleeTargets && CBZ.cityMeleeTargets.indexOf(f.oppA) >= 0, "arena cage: the opponent is a target your city swings can find");
    // you stand there with your hands down for 10 s
    for (let i = 0; i < 600 && AP.tickCage(DT); i++) { playerFrame(W); W.frame(DT); }
    const idleLoss = hp0 - f.oppHp;
    rows.push(`arena cage 10 s idle: opponent hp ${f2(hp0)} -> ${f2(f.oppHp)}, his landed blows ${hurts.length}, fromX ${hurts[0] ? typeof hurts[0].fx : "-"}`);
    check(idleLoss === 0, "arena cage: standing still deals the opponent nothing (" + f2(idleLoss) + " hp)");
    check(hurts.length >= 1, "arena cage: his blows land on you through the verbs (" + hurts.length + ")");
    check(hurts.every((h) => typeof h.fx === "number" && isFinite(h.fx) && isFinite(h.fz) && h.att === f.oppA), "arena cage: cityHurtPlayer gets his position and the attacker, not his name");
    // now you swing: a real strike through the same seam city/combat.js uses
    if (!f.over && CBZ.cityMeleeTargets) {
      const V = CBZ.verbs, pa = CBZ.city.playerActor;
      const op = f.oppA.pos;
      CBZ.player.pos.set(op.x, op.y, op.z - 1.15);
      CBZ.playerChar.group.rotation.y = 0;
      f.oppA.char.group.rotation.y = Math.PI;
      // he is not swinging back this beat (his fist landing first would cut yours)
      f.ocd = 99; V.cancelStrike(f.oppA);
      // his 10 s of free swings can have put YOU down (a flash knockdown on
      // the jaw, a leg kick): a man on the floor throws nothing, so get up
      // first (the flake this check had: seed 7 swung from the floor)
      const pcF = CBZ.playerChar;
      for (let i = 0; i < 50 || (i < 900 && pcF.fall && pcF.fall.on); i++) { f.ocd = 99; AP.tickCage(DT); CBZ.player.pos.set(op.x, op.y, op.z - 1.15); playerFrame(W); W.frame(DT); }
      f.ocd = 99;
      const hpB = f.oppHp;
      let how = "no contact";
      const oc = f.oppA.char;
      const pre = `his fall ${!!(oc.fall && oc.fall.on)}, block ${f2(oc.blockK)}, dodge ${f2(oc.dodgeT)}, gap ${f2(Math.hypot(op.x - CBZ.player.pos.x, op.z - CBZ.player.pos.z))}`;
      const pc = CBZ.playerChar;
      const mine = `you: fall ${!!(pc.fall && pc.fall.on)}, punchT ${f2(pc.punchT)}, strike ${!!V.strikeOf(pa)}`;
      const SS = V.strike(pa, null, { kind: "cross", candidates: (out) => { for (const a of CBZ.cityMeleeTargets) out.push(a); return out; },
        onLand: (res) => { how = res.blocked ? "blocked" : "landed " + res.zone; res.target.meleeHit(res, 12 * res.dmgMul, "light"); },
        onWhiff: (res) => { how = res.slipped ? "slipped" : "whiffed"; } });
      for (let i = 0; i < 40; i++) { f.ocd = 99; AP.tickCage(DT); CBZ.player.pos.set(op.x, op.y, op.z - 1.15); playerFrame(W); W.frame(DT); }
      check(f.oppHp < hpB, "arena cage: your landed fist scores (" + f2(hpB) + " -> " + f2(f.oppHp) + ", " + how + "; " + pre + "; " + mine + ", started " + !!SS + ")");
    }
    AP.endCage();
    check(!CBZ.cityMeleeTargets.length, "arena cage: the target list empties when the bout ends");
  }
  check(W.errors.length === 0, "arena cage: no updater errors (" + (W.errors[0] || "") + ")");
}

{ // ---- the ring: two fighters, a real knockdown ----
  const W = arenaWorld();
  const { CBZ, THREE } = W;
  const AP = CBZ.arenaFightProbe;
  if (AP) {
    const root = new THREE.Group();
    AP.root(root);
    const kit = { skin: 0xc68e62, torso: 0x884422, collar: 0x884422, arms: 0x884422, legs: 0x223344, shoes: 0x111111, hair: 0x221100 };
    const r = CBZ.makeCharacter(kit), b = CBZ.makeCharacter(kit);
    AP.rigs(r, b);
    const bout = AP.newBout();
    const R = bout.red, B = bout.blue;
    const deck = R.pos.y; W.world({ floor: () => deck });          // the canvas is the floor they stand on
    const hp0 = R.hp + B.hp;
    let t = 0, fell = false, errs = 0;
    for (let i = 0; i < 60 * 60 && bout.state !== "ko" && bout.state !== "reset"; i++) {
      try { AP.tickRing(DT); } catch (e) { errs++; if (errs === 1) W.errors.push(String(e.stack)); }
      W.frame(DT); t += DT;
    }
    for (let i = 0; i < 30; i++) { AP.tickRing(DT); W.frame(DT); if ((R.char.fall && R.char.fall.on) || (B.char.fall && B.char.fall.on)) fell = true; }
    const thrown = swingsOf(R) + swingsOf(B);
    rows.push(`arena ring: ${thrown} swings, hp ${f2(hp0)} -> ${f2(R.hp + B.hp)}, state ${bout.state} after ${f2(t)} s, KO fall=${fell}`);
    check(thrown >= 8, "arena ring: the pair box with real strikes (" + thrown + ")");
    check(R.hp + B.hp < hp0, "arena ring: landed blows score");
    check(bout.state === "ko" || bout.state === "reset", "arena ring: a bout ends in a knockdown inside a minute (" + bout.state + ")");
    check(fell, "arena ring: the loser goes down in his own rig");
  }
  check(W.errors.length === 0, "arena ring: no errors (" + (W.errors[0] || "") + ")");
}

// ================================================================ REPORT
console.log("\nverbs-route-check — every other fight through CBZ.verbs\n");
for (const r of rows) console.log("  " + r);
console.log(`\n${checks - fails}/${checks} checks passed`);
if (fails) { console.log("FAILURES:\n  " + failures.join("\n  ")); process.exit(1); }
