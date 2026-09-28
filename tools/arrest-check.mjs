#!/usr/bin/env node
/* tools/arrest-check.mjs — IS GETTING ARRESTED A REAL CONTEST?

   Owner, 2026-09-28: "when I get handcuffed it's almost like a cutscene.
   It's not realistic. I'm getting handcuffed too easily."

   The REAL rigs, the REAL verbs (systems/verbs.js + verbposes + STRIKE),
   systems/arrest.js and CBZ.brain's authority ladder, frame by frame at
   60 fps in plain node (tools/lib/verbs-vm.mjs). A scripted player (keys,
   presses and feet) against real officers:

     1. COMPLIANT   a man who puts his hands up for the order is cuffed in
                    ~3 s, and his controls are his until the hands land
                    (never held, stunned or locked during the approach).
                    A man who only STANDS there (hands down) is not cuffed on
                    his feet: he is tased and cuffed on the floor (owner:
                    "I need to get knocked down or knocked out or tased")
     2. WALK OFF    a man who walks away while the officer reaches is not
                    cuffed (the reach misses)
     3. THE LUNGE   a standing man is taken down; a man sprinting away from
                    arm's reach is MISSED and the officer ends up on the floor
     4. THE RUNNER  a fresh sprinter escapes a lone patrol cop (ladder, taser,
                    lunge, the cop's own breath) more often than not
     5. TASED       a tased man is cuffed, however he struggles
     6. THE ODDS    the struggle is a contest: breaking free gets rarer with
                    every pair of hands (lone cop > two > a SWAT stack), pinned
                    or in cuffs is harder than on your feet

     node tools/arrest-check.mjs [--n 40] [--verbose]      exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const argv = process.argv.slice(2);
const N = Number((argv[argv.indexOf("--n") + 1] && argv.indexOf("--n") >= 0) ? argv[argv.indexOf("--n") + 1] : 40);
const VERBOSE = argv.includes("--verbose");
const DT = 1 / 60;
const t0 = Date.now();
const ROOT = new URL("../", import.meta.url);

const v = loadVerbsVM({ mode: "city" });
const { CBZ, THREE } = v;
vm.runInContext(readFileSync(new URL("src/systems/brain.js", ROOT), "utf8"), v.ctx, { filename: "src/systems/brain.js" });
const V = CBZ.verbs, A = CBZ.arrest, B = CBZ.brain;
if (!A || !B) { console.log("FAIL: arrest.js / brain.js did not load"); process.exit(1); }
CBZ.CITY = { staminaMax: 100 };
const P = CBZ.player, PC = CBZ.playerChar;
const g = CBZ.game;
g.elapsed = 0;

let fails = 0;
const rows = [];
function check(ok, name, detail) {
  rows.push({ ok, name, detail });
  if (!ok) fails++;
}
// deterministic randomness for everything that rolls (the lunge, the taser, the contest seeds)
let seed = 12345;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
Math.random = rnd;               // the verbs roll with Math.random; the host Math is shared

// ---- the scripted player -------------------------------------------------
const keys = CBZ.keys;
function clearKeys() { for (const k of Object.keys(keys)) keys[k] = false; }
const pl = { vx: 0, vz: 0, run: false, strategy: "none", lastCycle: -1, stamina: 100 };
function resetPlayer(x, z, yaw) {
  P.pos.set(x, 0, z); P.dead = false; P.hp = 100; P.stun = 0; P.speed = 0; P._wind = 1; P.stamina = 100; P._grappleT = 0;
  P._cityArrested = false; P.ko = 0;
  PC.group.position.copy(P.pos); PC.group.rotation.set(0, yaw || 0, 0);
  PC.cuffed = false; PC.handsUp = false;
  if (PC.fall) { PC.fall.on = false; PC.fall.phase = ""; }
  clearKeys();
  pl.vx = 0; pl.vz = 0; pl.run = false; pl.strategy = "none"; pl.lastCycle = -1;
  V._pv.x = V._pv.z = 0; V._pv.lx = null;
}
// his feet (what physics.js would do): held = the verb places him, stunned = nothing
function stepPlayer(dt) {
  const held = V.playerHeld();
  if (P.stun > 0) P.stun = Math.max(0, P.stun - dt);
  let sp = 0;
  if (!held && !(P.stun > 0) && (pl.vx || pl.vz)) {
    let mul = 1;
    if (pl.run) {
      // the city's sprint: stamina drains 22/s while sprinting, regens 14/s off it
      if (P.stamina > 0) { mul = 3.2; P.stamina = Math.max(0, P.stamina - 22 * dt); }
      else P.stamina = Math.min(100, P.stamina + 14 * dt);
    } else P.stamina = Math.min(100, P.stamina + 14 * dt);
    if (PC.cuffed) mul *= 0.7;
    const l = Math.hypot(pl.vx, pl.vz) || 1;
    const s = 2.0 * mul;
    P.pos.x += pl.vx / l * s * dt; P.pos.z += pl.vz / l * s * dt;
    PC.group.rotation.y = Math.atan2(pl.vx, pl.vz);
    sp = s;
  } else if (!held) P.stamina = Math.min(100, P.stamina + 14 * dt);
  P.speed = sp;
  if (!held) PC.group.position.copy(P.pos);
}
// the struggle: hold the key that points away from the hands, wrench in his ease
function struggleInput() {
  clearKeys();
  if (pl.strategy === "none") return;
  let S = null;
  for (const s of V.sessions) if (s.T && s.T.isPlayer && s.phase !== "approach" && !s.tFree) { S = s; break; }
  if (!S) return;
  const ax = S.T.pos.x - S.A.pos.x, az = S.T.pos.z - S.A.pos.z;
  // camera yaw so that W points straight away from him (fwd = -sin(yaw), -cos(yaw))
  CBZ.cam.yaw = Math.atan2(-ax, -az);
  keys.w = pl.strategy === "timed" || pl.strategy === "mash" || pl.strategy === "hold";
  if (pl.strategy === "timed" && S.cst && A.contest.inEase(S.cst) && S.cst.beat > 0.55 && S.cst.cycle !== pl.lastCycle) {
    pl.lastCycle = S.cst.cycle;
    if (rnd() < 0.85) V.press();
  }
  if (pl.strategy === "mash" && rnd() < 5 * DT) V.press();
}

// ---- officers --------------------------------------------------------------
const cops = [];
CBZ.cityCops = cops;
function cop(x, z, o) {
  const a = v.actor(Object.assign({ x, z, yaw: 0, name: "cop" }, o || {}));
  a.kind = "cop"; a.baseSpeed = 4.6;
  if (o && o.swat) a.swat = true;
  cops.push(a);
  return a;
}
function clearCops() { cops.length = 0; }
function reset() {
  const live = A.active(); if (live) live.cancel();
  A.unsubdue();
  v.clearActors(); v.world({}); clearCops();
  for (let i = V.sessions.length - 1; i >= 0; i--) V.sessions[i].cancel();
  if (PC.cuffed) V.setCuffs(V.playerActor(), false);
  v.actors.push({ char: PC, pos: P.pos, dead: false, name: "player" });
}
function frame() {
  g.elapsed += DT;
  B.clock(g.elapsed);
  struggleInput();
  stepPlayer(DT);
  v.frame(DT);
}
function settle(n) { for (let i = 0; i < (n || 6); i++) frame(); }

// the brain's hands for these officers: run / jog / walk at the city's pace,
// and the law's verbs (the taser, the lunge, the take) through arrest.js
const SPEED = { walk: 4.6 * 0.42, jog: 4.6 * 0.75, run: 4.6 * 1.05 };
function moveCop(c, dt) {
  const gl = c._goal;
  if (!gl || V.sessionOf(c) || c.ko > 0 || c._arresting) { v.setSpeed(c, 0); return; }
  const dx = gl.x - c.pos.x, dz = gl.z - c.pos.z, d = Math.hypot(dx, dz);
  if (d <= gl.arrive) { v.setSpeed(c, 0); return; }
  const s = Math.min(d - gl.arrive, gl.v * dt);
  c.pos.x += dx / d * s; c.pos.z += dz / d * s;
  c.char.group.rotation.y = Math.atan2(dx, dz);
  v.setSpeed(c, s / dt);
}
const EXEC = {
  prefer: true,
  moveTo(a, x, z, o) { a._goal = { x, z, v: SPEED[(o && o.speed) || "walk"] || 1.9, arrive: (o && o.arrive) || 0.8 }; return true; },
  stop(a) { a._goal = null; return true; },
  face(a, x, z) { if (!V.sessionOf(a)) a.char.group.rotation.y = Math.atan2(x - a.pos.x, z - a.pos.z); return true; },
  posture() { return true; },
  say() { return true; },
  verb(name, a, b, o) {
    if (name === "tase" || name === "taser") return A.tase(a);
    if (name === "tackle") {
      const S = V.tackle(a, V.playerActor(), {
        far: true,
        onEnd(S) {
          const k = S.result && S.result.outcome;
          if (k === "open" || k === "wall") { A.subdue(2.2, "pinned"); if (!V.cuffDown) V.getUp(V.playerActor()); A.take(a, { pinned: true }); }
        },
      });
      return S || false;
    }
    if (name === "restrain" || name === "cuff") return A.active() || A.take(a, { behind: !!(o && o.grab) }) || false;
    return false;
  },
};
B.act.use("chk", EXEC);
function enlist(c) {
  B.register(c, c.swat ? "swat" : "cop", { faction: "police", game: "chk" });
  const r = B.of ? B.of(c) : c._brain; if (r) r.game = "chk";
}
const SS = { speed: 0, handsUp: false, kneeling: false, prone: false, subdued: false, cuffed: false, behind: false, backup: 0, armed: false, aiming: false, attacking: false, fled: false, seen: true, dist: 0 };
function suspect(c) {
  SS.speed = P.speed; SS.subdued = A.subdued(); SS.cuffed = !!PC.cuffed; SS.prone = SS.subdued || !!A.downState(V.playerActor());
  SS.handsUp = !!PC.handsUp;
  SS.behind = A.behind(c); SS.backup = A.backup(c, 3.2);
  SS.dist = Math.hypot(P.pos.x - c.pos.x, P.pos.z - c.pos.z);
  return SS;
}

// =============================================================== 1. COMPLIANT
{
  const times = [], grabTs = [], leaks = [];
  for (let i = 0; i < 12; i++) {
    reset(); resetPlayer(0, 3.0, 0);
    const c = cop(0, 0, { yaw: 0 }); enlist(c);
    settle();
    PC.handsUp = true;               // he gives up: hands up for the order
    B.authority.begin(c, P, "wanted", { roe: "nonlethal", warnRange: 14, orderRange: 6, cuffRange: 1.5, patience: 6, skipWarn: true });
    let t = 0, grabT = -1, cuffT = -1, leak = null;
    for (let f = 0; f < 60 * 12; f++) {
      const r = B.authority.caseOf(c) ? B.authority.step(c, DT, suspect(c)) : null;
      moveCop(c, DT);
      frame(); t += DT;
      const held = V.playerHeld();
      if (held && grabT < 0) grabT = t;
      // before the hands land: nothing may own his body
      if (grabT < 0 && (P.stun > 0 || P._cityArrested)) leak = leak || `locked at ${t.toFixed(2)}s (stun ${P.stun}, arrested ${!!P._cityArrested})`;
      if (PC.cuffed && cuffT < 0) { cuffT = t; break; }
    }
    times.push(cuffT); grabTs.push(grabT); if (leak) leaks.push(leak);
  }
  const ok = times.every((t) => t > 0);
  const handsToCuffs = times.map((t, i) => t - grabTs[i]);
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  check(ok, "compliant: cuffed every time", `cuffed ${times.filter((t) => t > 0).length}/12`);
  check(ok && Math.abs(avg(handsToCuffs) - 2.7) < 0.8, "compliant: hands-on to cuffs ~2.5-3 s (one wrist, then the other)", `avg ${avg(handsToCuffs).toFixed(2)} s, order to cuffs ${avg(times).toFixed(2)} s`);
  check(!leaks.length, "compliant: controls are his until the hands land", leaks[0] || "never held / stunned / locked before the grab");
  // (then the escort: cuffed men are walked)
}
// ======================================================= 1b. HANDS DOWN, ON HIS FEET
// he stops for the order but never gives up: never cuffed standing; the
// officer takes him down (the taser) and cuffs him on the floor
{
  let standingCuffs = 0, cuffedN = 0, tasedN = 0, groundCuffs = 0;
  for (let i = 0; i < 10; i++) {
    reset(); resetPlayer(0, 3.0, 0);
    const c = cop(0, 0, { yaw: 0 }); enlist(c);
    settle();
    B.authority.begin(c, P, "wanted", { roe: "nonlethal", warnRange: 14, orderRange: 6, cuffRange: 1.5, patience: 3, skipWarn: true });
    let handsOnDown = null, tased = false;
    for (let f = 0; f < 60 * 20; f++) {
      const r = B.authority.caseOf(c) ? B.authority.step(c, DT, suspect(c)) : null;
      if (r && r.verb === "tase") tased = true;
      moveCop(c, DT);
      frame();
      const held = V.playerHeld();
      if (held && handsOnDown == null) handsOnDown = !!A.downState(V.playerActor());
      if (PC.cuffed) break;
    }
    if (PC.cuffed) {
      cuffedN++;
      if (handsOnDown === false && !tased) standingCuffs++;
      if (handsOnDown) groundCuffs++;
    }
    if (tased) tasedN++;
  }
  check(standingCuffs === 0, "hands down: a man on his feet who never gave up is never cuffed standing", `cuffed ${cuffedN}/10, tased ${tasedN}/10, standing-untased cuffs ${standingCuffs}`);
  check(tasedN >= 8, "hands down: the officer takes him down first (the taser)", `tased ${tasedN}/10`);
  if (V.cuffDown) check(groundCuffs === cuffedN && cuffedN > 0, "hands down: tased, he is cuffed ON the floor (knee on his back)", `${groundCuffs}/${cuffedN} cuffed down`);
}

// =============================================================== 2. WALK OFF
{
  let cuffed = 0, missed = 0;
  for (let i = 0; i < 12; i++) {
    reset(); resetPlayer(0, 3.2, 0);
    const c = cop(0, 0, { yaw: 0 });
    settle();
    let res = null;
    const h = A.take(c, { onMissed() { res = "missed"; }, onCuffed() { res = "cuffed"; } });
    // he turns and walks off at a walk the moment the officer starts over
    pl.vx = 0; pl.vz = 1;
    for (let f = 0; f < 60 * 6 && !res; f++) frame();
    pl.vx = pl.vz = 0;
    if (res === "cuffed" || PC.cuffed) cuffed++; else missed++;
    if (h && !h.done) h.cancel();
  }
  check(cuffed === 0, "walk off: a man walking away during the reach is not cuffed", `missed ${missed}/12, cuffed ${cuffed}`);
}

// =============================================================== 3. THE LUNGE
{
  let caught = 0, standN = 0;
  for (let i = 0; i < 20; i++) {
    reset(); resetPlayer(0, 2.2, 0);
    const c = cop(0, 0, { yaw: 0 });
    settle();
    const S = V.tackle(c, V.playerActor(), { far: true });
    standN++;
    for (let f = 0; f < 120 && S && !S.done; f++) frame();
    if (S && S.result && (S.result.outcome === "open" || S.result.outcome === "wall")) caught++;
  }
  let missed = 0, copDown = 0, runN = 0;
  for (let i = 0; i < 20; i++) {
    reset(); resetPlayer(0, 1.0, 0);
    const c = cop(0, 0, { yaw: 0 });
    settle();
    // sprinting away, at full speed already, and ~2.4 m clear when he dives
    pl.vx = 0; pl.vz = 1; pl.run = true;
    for (let f = 0; f < 13; f++) frame();
    const S = V.tackle(c, V.playerActor(), { far: true });
    if (!S) continue;
    runN++;
    let downSeen = false;
    for (let f = 0; f < 150; f++) {
      frame();
      if (c.ko > 0 || (c.char.fall && c.char.fall.on)) downSeen = true;
      if (S.done && f > 40) break;
    }
    if (S.result && S.result.outcome === "missed") missed++;
    if (downSeen) copDown++;
    pl.vx = pl.vz = 0; pl.run = false;
  }
  check(caught >= standN * 0.6, "lunge: a man standing in arm's reach is taken down", `${caught}/${standN}`);
  check(runN > 0 && missed >= runN * 0.8, "lunge: a sprinter from arm's reach is MISSED", `${missed}/${runN}`);
  check(runN > 0 && copDown >= missed, "lunge: a missed lunge leaves the officer on the floor", `${copDown}/${missed} down`);
}

// =============================================================== 4. THE RUNNER
// open ground, a straight line, no corner to break his sight: the honest
// worst case for the runner. Caught = cuffed inside 30 s.
function chase(n, stamina, dist) {
  let escaped = 0, caught = 0, tased = 0, lunged = 0;
  const how = {};
  for (let i = 0; i < n; i++) {
    reset(); resetPlayer(0, dist + rnd() * 1.5, 0);
    P.stamina = stamina;
    const c = cop(0, 0, { yaw: 0 }); enlist(c);
    settle();
    P.stamina = stamina;
    pl.vx = 0; pl.vz = 1; pl.run = true;
    B.authority.begin(c, P, "wanted", { roe: "nonlethal", warnRange: 14, orderRange: 6, cuffRange: 1.5, patience: 6, skipWarn: true, tackles: Infinity });
    let out = "escaped";
    for (let f = 0; f < 60 * 30; f++) {
      if (B.authority.caseOf(c)) {
        const r = B.authority.step(c, DT, suspect(c));
        if (r && r.verb === "tase") tased++;
        if (r && r.verb === "tackle") lunged++;
      }
      moveCop(c, DT);
      frame();
      if (PC.cuffed) { out = "caught"; break; }
      if (!B.authority.caseOf(c) && !A.active() && !(P.stun > 0)) { out = "escaped"; break; }
    }
    how[out] = (how[out] || 0) + 1;
    if (out === "caught") caught++; else escaped++;
    pl.vx = pl.vz = 0; pl.run = false;
    const live = A.active(); if (live) live.cancel();
  }
  return { escaped, caught, tased, lunged };
}
{
  const fresh = chase(N, 100, 3.0);
  const gassed = chase(Math.max(10, N >> 1), 0, 3.0);
  check(fresh.escaped > N / 2, "runner: a fresh sprinter escapes a lone patrol cop more often than not", `escaped ${fresh.escaped}/${N} (tases ${fresh.tased}, lunges ${fresh.lunged})`);
  check(gassed.caught > 0 && gassed.caught / (gassed.caught + gassed.escaped) > fresh.caught / N, "runner: a man already out of breath is run down (the taser and the lunge are real)", `caught ${gassed.caught}/${gassed.caught + gassed.escaped} gassed vs ${fresh.caught}/${N} fresh (tases ${gassed.tased}, lunges ${gassed.lunged})`);
}

// =============================================================== 5. TASED
{
  let cuffed = 0;
  for (let i = 0; i < 16; i++) {
    reset(); resetPlayer(0, 3.0, 0);
    const c = cop(0, 0, { yaw: 0 });
    settle();
    const r = A.tase(c, { chance: 1 });
    pl.strategy = "timed";
    for (let f = 0; f < 30; f++) frame();
    if (!V.cuffDown) V.getUp(V.playerActor());
    const h = A.take(c, { subdued: true });
    for (let f = 0; f < 60 * 8 && h && !PC.cuffed && !h.done; f++) frame();
    if (r.hit && PC.cuffed) cuffed++;
    pl.strategy = "none";
    if (h && !h.done) h.cancel();
  }
  check(cuffed >= 15, "tased: a tased man is cuffed, struggle or not", `${cuffed}/16`);
}

// =============================================================== 6. THE ODDS
function trial(sc) {
  reset(); resetPlayer(0, 1.4, 0);
  const c = cop(0, 0, { yaw: 0, swat: !!sc.swat });
  for (let k = 0; k < (sc.backup || 0); k++) cop(k % 2 ? 1.3 : -1.3, 1.6 + 0.3 * k, { yaw: 0, swat: !!sc.swat });
  if (sc.cuffed) V.setCuffs(V.playerActor(), true);
  P.stamina = sc.stamina != null ? sc.stamina : 100;
  settle();
  // the hands only come for a man who gave up (then thinks better of it) or
  // one pinned under a tackle
  if (!sc.cuffed) PC.handsUp = true;
  if (sc.pinned) A.subdue(2.2, "pinned");
  let res = null;
  const h = A.take(c, {
    pinned: !!sc.pinned,
    to: sc.cuffed ? { x: 0, z: -40 } : null,
    onCuffed() { if (!sc.cuffed) res = "cuffed"; },
    onEscaped() { res = "escaped"; },
    onBroke() { res = "escaped"; },
    onMissed() { res = "missed"; },
  });
  pl.strategy = sc.strategy || "timed";
  const limit = sc.cuffed ? 10 : 8;
  for (let f = 0; f < 60 * limit && !res; f++) frame();
  pl.strategy = "none";
  if (h && !h.done) h.cancel();
  return res || (sc.cuffed ? "held" : "timeout");
}
function rate(sc, n) {
  let esc = 0; const tally = {};
  for (let i = 0; i < n; i++) { const r = trial(sc); tally[r] = (tally[r] || 0) + 1; if (r === "escaped") esc++; }
  return { p: esc / n, tally };
}
{
  const n = Math.max(10, Math.round(N * 0.75));
  const R = {
    lone: rate({}, n),
    loneMash: rate({ strategy: "mash" }, n),
    two: rate({ backup: 1 }, n),
    swat: rate({ swat: true, backup: 2 }, n),
    pinned: rate({ pinned: true }, n),
    gassed: rate({ stamina: 15 }, n),
    escortLone: rate({ cuffed: true }, n),
    escortTwo: rate({ cuffed: true, backup: 1 }, n),
    passive: rate({ strategy: "none" }, Math.min(n, 10)),
  };
  const pct = (r) => (r.p * 100).toFixed(0) + "%";
  if (VERBOSE) for (const k in R) console.log("  " + k.padEnd(12), pct(R[k]), JSON.stringify(R[k].tally));
  check(R.lone.p >= 0.55, "odds: a fresh man fighting a lone patrol cop's cuffs gets free more often than not", `timed ${pct(R.lone)}, mashing ${pct(R.loneMash)}`);
  check(R.two.p < R.lone.p && R.two.p <= 0.5, "odds: a second officer's hands make it much harder", `two ${pct(R.two)} vs one ${pct(R.lone)}`);
  check(R.swat.p <= 0.1, "odds: a SWAT stack does not lose you", `swat x3 ${pct(R.swat)}`);
  check(R.pinned.p < R.lone.p, "odds: pinned under a tackle is harder than on your feet", `pinned ${pct(R.pinned)}`);
  check(R.gassed.p < R.lone.p, "odds: a man with no wind left fights like one", `gassed ${pct(R.gassed)}`);
  check(R.escortLone.p > 0 && R.escortLone.p < R.lone.p, "odds: in cuffs you can still tear away from a lone escort, rarely", `escort ${pct(R.escortLone)}`);
  check(R.escortTwo.p <= R.escortLone.p, "odds: ...and less with two on you", `escort x2 ${pct(R.escortTwo)}`);
  check(R.passive.p === 0 && (R.passive.tally.cuffed || 0) === Math.min(n, 10), "odds: a man who does nothing is simply cuffed", JSON.stringify(R.passive.tally));
}

const errs = v.errors.splice(0);
check(!errs.length, "no errors thrown by the loaded files", errs[0] ? errs[0].split("\n")[0] : "0");

for (const r of rows) console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name}  ${r.detail || ""}`);
console.log(`ARREST: ${fails ? "FAIL" : "PASS"}  ${rows.length - fails}/${rows.length}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fails ? 1 : 0);
