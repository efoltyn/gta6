#!/usr/bin/env node
/* tools/brain-sim-war.mjs — the SURVIVORS / GUN GAME / ARMIES router's plain-node
   scenarios for CBZ.brain (src/systems/brain.js). No browser, no THREE.

     node tools/brain-sim-war.mjs          # all
     node tools/brain-sim-war.mjs 2        # one

   1  morale parity: the OLD warlord/battle.js and games/battle.html morale code
      (copied verbatim from before the routing) against the thin wrappers that
      now call brain.morale, on a scripted 40 v 40 fight — same morale every
      tick, same man breaks on the same tick, same side routs on the same tick,
      same rout/rally events. Also checks the wrappers are really in the files.
   2  gun game: a bot hears a shot behind a wall, goes to where it heard it,
      spots the shooter through the brain's awareness meter (not instantly),
      remembers where he was when he ducks back out of sight.
   3  disaster crowd: a death nearby makes the timid flee and the steady carry
      on; a mass-casualty minute breaks the timid (not the brave), the break is
      latched (no flicker) and the crowd rallies once it is quiet; the whole
      thing is deterministic (two runs, identical).
   4  soldiers: perception-gated targeting — a man does not acquire an enemy
      behind his back unless he is inside the touch radius. */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
globalThis.window = { CBZ: {} };
const B = require(path.join(ROOT, "src/systems/brain.js"));
const MO = B.morale;

let fails = 0, passes = 0;
function check(ok, msg) { if (ok) { passes++; console.log("  PASS " + msg); } else { fails++; console.log("  FAIL " + msg); } }
const scenarios = [];
function scenario(n, name, fn) { scenarios.push({ n, name, fn }); }
function lcgOf(seed) { let s = seed; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
let T = 0;
function fresh(seed) { B.reset(); B.seed(seed || 1); B.perception.setOcclusion(null); T = 0; B.clock(0); }
function advance(dt) { T += dt; B.clock(T); }

// =========================================================================
scenario(1, "morale parity: old warlord + NPC War code vs the brain.morale wrappers (scripted 40 v 40)", function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // ---- OLD warlord/battle.js (verbatim, MORALE_OFF false)
  const OLD = {
    moraleFrom(o) {
      let mo = 1 - o.lost * 1.6 + o.theirLost * 0.55;
      if (o.leader) mo += o.leaderDown ? -0.30 : (o.leaderNear ? 0.16 : 0);
      mo -= o.malus || 0;
      mo -= clamp(o.routingFrac, 0, 1) * 0.25;
      return clamp(mo, 0, 1);
    },
    stepRout(m) {
      const nerve = m.nerve;
      if (!m.routed) { if (m.side.morale < nerve) { m.routed = true; m.side.brokeN = (m.side.brokeN || 0) + 1; } }
      else if (m.side.morale > nerve + 0.14) m.routed = false;
      return m.routed;
    },
    brokenSide(side, fled) {
      if (side.men0.length <= 2) return false;
      const fighting = side.alive - side.routing;
      const gone = side.deadN + side.routing + fled;
      return fighting <= Math.max(1, Math.floor(side.men0.length * 0.1)) && gone >= side.men0.length * 0.3;
    },
  };
  // ---- NEW (exactly what src/warlord/battle.js now does)
  const NEW = {
    moraleFrom(o) { return MO.fromLosses(o); },
    stepRout(m) {
      const was = m.routed;
      if (MO.stepRout(m, m.side.morale, m.nerve) && !was) m.side.brokeN = (m.side.brokeN || 0) + 1;
      return m.routed;
    },
    brokenSide(side, fled) { return MO.brokenSide(side, fled); },
  };
  const CQ = ["civ", "thug", "guard", "soldier"];
  function runWarlord(impl) {
    const rnd = lcgOf(90210);
    const sides = {};
    const log = [];
    for (const k of ["mine", "them"]) sides[k] = { key: k, men0: [], alive: 0, routing: 0, deadN: 0, brokeN: 0, morale: 1, power0: 0, powerNow: 0, routEmit: false };
    const men = [];
    for (let i = 0; i < 80; i++) {
      const k = i < 40 ? "mine" : "them";
      const m = { i, team: k, side: sides[k], w: 1 + (i % 4) * 0.5, nerve: MO.nerveOf(CQ[i % 4]), dead: false, routed: false, fled: false, breakT: -1 };
      sides[k].men0.push(m); sides[k].power0 += m.w; men.push(m);
    }
    for (let t = 0; t < 400; t++) {
      // the fight: 'them' shoot better, so 'mine' bleeds faster
      for (const m of men) {
        if (m.dead || m.fled) continue;
        const p = m.team === "mine" ? 0.018 : 0.009;
        if (rnd() < p) { m.dead = true; m.side.deadN++; }
      }
      for (const k in sides) {
        const s = sides[k]; s.alive = 0; s.routing = 0; s.powerNow = 0;
        for (const m of s.men0) { if (m.dead || m.fled) continue; s.alive++; if (m.routed) s.routing++; s.powerNow += m.w; }
      }
      for (const k in sides) {
        const s = sides[k], f = sides[k === "mine" ? "them" : "mine"];
        s.morale = impl.moraleFrom({
          lost: 1 - s.powerNow / s.power0, theirLost: 1 - f.powerNow / f.power0,
          leader: k === "mine", leaderDown: t > 300, leaderNear: t % 3 !== 0, malus: t < 30 ? 0.1 : 0,
          routingFrac: s.routing / Math.max(1, s.alive),
        });
        log.push(s.morale);
        if (!s.routEmit && impl.brokenSide(s, 0)) { s.routEmit = true; log.push("rout:" + k + "@" + t); }
      }
      for (const m of men) {
        if (m.dead || m.fled) continue;
        const was = m.routed;
        impl.stepRout(m);
        if (m.routed && !was) log.push("break:" + m.i + "@" + t);
        if (!m.routed && was) log.push("rally:" + m.i + "@" + t);
      }
    }
    log.push("brokeN:" + sides.mine.brokeN + "/" + sides.them.brokeN);
    return log;
  }
  const a = runWarlord(OLD), b = runWarlord(NEW);
  let mism = 0; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) mism++;
  const evs = a.filter((x) => typeof x === "string");
  check(mism === 0 && a.length === b.length, "warlord: " + a.length + " morale values + events, " + mism + " mismatches (" +
    evs.filter((e) => e.startsWith("break")).length + " breaks, " + evs.filter((e) => e.startsWith("rally")).length + " rallies, " +
    (evs.find((e) => e.startsWith("rout")) || "no rout") + ", " + evs[evs.length - 1] + ")");
  check(evs.some((e) => e.startsWith("rout:mine")), "the bleeding side actually routs in the script (the check has teeth)");

  // ---- OLD games/battle.html army block + manMorale (verbatim)
  const K = { SUPP_K: 0.16, WOUND_K: 0.28, SHOCK_K: 1.8, SHOCK_TAU: 7 };
  function oldArmy(A, F, dt, fearless, emit, t) {
    A.shock *= Math.exp(-dt / K.SHOCK_TAU);
    const lost = A.p0 > 0 ? Math.max(0, 1 - A.pNow / A.p0) : 0;
    const theirLost = F.p0 > 0 ? Math.max(0, 1 - F.pNow / F.p0) : 0;
    let mo = 1 - lost * 1.5 + theirLost * 0.5 - (A.alive ? A.routing / A.alive : 0) * 0.35 - A.shock;
    if (fearless) mo = 1;
    A.morale = Math.max(0, Math.min(1, mo));
    if (!A.broken && A.alive >= 2 && A.routing >= A.alive * 0.5) { A.broken = true; emit("rout", t); }
    else if (A.broken && A.alive - A.routing > 0 && A.routing < A.alive * 0.25) { A.broken = false; emit("rally", t); }
  }
  function newArmy(A, F, dt, fearless, emit, t) {
    const ev = MO.armyStep(A, F, dt, { fearless: !!fearless });
    if (ev) emit(ev, t);
  }
  const oldMan = (army, supp, hf) => army - (supp || 0) * K.SUPP_K - (1 - hf) * K.WOUND_K;
  function runNpcWar(armyFn, manFn, deathFn) {
    const rnd = lcgOf(4242);
    const log = [];
    const ARMY = {};
    for (const t of ["red", "blue"]) ARMY[t] = { p0: 0, pNow: 0, morale: 1, shock: 0, alive: 0, routing: 0, broken: false };
    const TW = { civ: 0.7, thug: 0.85, pro: 1.0, elite: 1.25, swat: 1.4 };
    const tiers = Object.keys(TW);
    const men = [];
    for (let i = 0; i < 80; i++) {
      const tier = tiers[i % 5];
      const m = { i, team: i < 40 ? "red" : "blue", tier, w: TW[tier], nerve: MO.nerveFor(tier, i), hp: 100, maxHp: 100, supp: 0, dead: false, routed: false, rallyT: 0 };
      ARMY[m.team].p0 += m.w; men.push(m);
    }
    const dt = 0.6;
    for (let t = 0; t < 150; t++) {
      for (const m of men) {
        if (m.dead) continue;
        m.supp = Math.max(0, m.supp - dt * 0.28);
        if (rnd() < (m.team === "red" ? 0.05 : 0.02)) { m.hp -= 45; m.supp = Math.min(1.2, m.supp + 0.4); }
        if (m.hp <= 0) { m.dead = true; deathFn(ARMY[m.team], m.w); }
      }
      for (const k of ["red", "blue"]) { const A = ARMY[k]; A.alive = 0; A.routing = 0; A.pNow = 0; }
      for (const m of men) {
        if (m.dead) continue;
        const A = ARMY[m.team]; A.alive++; if (m.routed) A.routing++;
        A.pNow += m.w * (0.45 + 0.55 * Math.max(0, Math.min(1, m.hp / m.maxHp)));
      }
      for (const k of ["red", "blue"]) {
        armyFn(ARMY[k], ARMY[k === "red" ? "blue" : "red"], t ? dt : 0, false, (e, tt) => log.push(e + ":" + k + "@" + tt), t);
        log.push(ARMY[k].morale, ARMY[k].shock);
      }
      for (const m of men) {           // routCheck's break/rally (unchanged page code, manMorale swapped)
        if (m.dead) continue;
        if (m.rallyT > 0) m.rallyT -= dt;
        const eff = manFn(ARMY[m.team].morale, m.supp, Math.max(0, Math.min(1, m.hp / m.maxHp)));
        if (!m.routed) { if (!(m.rallyT > 0) && eff < m.nerve) { m.routed = true; log.push("break:" + m.i + "@" + t); } }
        else if (eff > m.nerve + 0.16 && m.supp < 0.3) { m.routed = false; m.rallyT = 6; log.push("rally:" + m.i + "@" + t); }
      }
    }
    return log;
  }
  const oldDeath = (A, w) => { if (A.p0 > 0) A.shock += K.SHOCK_K * (w || 1) / A.p0; };
  const c = runNpcWar(oldArmy, oldMan, oldDeath), d = runNpcWar(newArmy, MO.manMorale, MO.deathShock);
  let m2 = 0; for (let i = 0; i < Math.max(c.length, d.length); i++) if (c[i] !== d[i]) m2++;
  const ev2 = c.filter((x) => typeof x === "string");
  check(m2 === 0 && c.length === d.length, "NPC War: " + c.length + " values + events, " + m2 + " mismatches (" +
    ev2.filter((e) => e.startsWith("break")).length + " breaks, " + (ev2.find((e) => e.startsWith("rout")) || "no rout") + ")");
  check(ev2.some((e) => e.startsWith("rout:red")), "red actually routs in the script");

  // the wrappers are really what the game files run (anti-drift)
  const wl = fs.readFileSync(path.join(ROOT, "src/warlord/battle.js"), "utf8");
  const bh = fs.readFileSync(path.join(ROOT, "games/battle.html"), "utf8");
  check(/function moraleFrom\(o\) \{ return MO\(\)\.fromLosses\(o\); \}/.test(wl) && /MO\(\)\.stepRout\(m, m\.side\.morale, nerveOf\(m\)\)/.test(wl) &&
    /MO\(\)\.brokenSide\(side, fled\)/.test(wl) && /MO\(\)\.stepRout\(u, s\.morale, u\.nerve\)/.test(wl) && !/mo -= clamp\(o\.routingFrac/.test(wl),
    "warlord/battle.js runs brain.morale (fromLosses / stepRout x2 / brokenSide), its own formula is gone");
  check(/MO\.armyStep\(A, F, dt,/.test(bh) && /MO\.manMorale\(/.test(bh) && /MO\.deathShock\(A,/.test(bh) && !/lost \* 1\.5 \+ theirLost \* 0\.5/.test(bh) &&
    /emitWar\(ev, \{ team: t \}\)/.test(bh), "games/battle.html runs brain.morale (armyStep / manMorale / deathShock), its own formula is gone, rout/rally still emitted");
  check(/W\.emit\("battle:morale"/.test(wl) && /W\.emit\("battle:rout"/.test(wl), "warlord still emits battle:morale and battle:rout");
  check(/systems\/brain\.js/.test(bh) && /systems\/brain\.js/.test(fs.readFileSync(path.join(ROOT, "games/warlord.html"), "utf8")),
    "games/battle.html and games/warlord.html load systems/brain.js");
});

// =========================================================================
// the gun game's perceive() gate, as src/modes/gungame.js now runs it
const GG_FOV = 1.77, GG_RANGE = 70;
const _spot = { range: GG_RANGE, fovHalf: GG_FOV, eyeY: 1.5, targetY: 1.25 };
function ggPerceive(b, enemies) {
  const t = B.now();
  const dt = b.percT < 0 ? 0 : Math.min(0.6, Math.max(0, t - b.percT));
  b.percT = t;
  let best = null, bestD = 1e9;
  for (const e of enemies) {
    const d = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
    if (d > GG_RANGE) continue;
    const known = e === b.hurtBy || e === b.foe;
    _spot.fovHalf = known ? Math.PI : GG_FOV;
    const aw = B.perception.awareness(b, e, dt, _spot);
    const rec = B.memory.lastSeen(b, e);
    if (!rec || !rec.visible) continue;
    const primed = d < 5 || known;
    if (aw < 1 && !primed) continue;
    if (d < bestD) { bestD = d; best = e; }
  }
  if (best) { b.foe = best; b.foeSeen = true; B.memory.see(b, best); } else b.foeSeen = false;
  return best;
}
scenario(2, "gun game: shot behind a wall -> heard -> investigate -> spotted by awareness -> lastSeen", function () {
  fresh(2);
  // a wall: the box x in [-4, 4], z in [9, 10] (the map's collider list)
  const wall = { minX: -4, maxX: 4, minZ: 9, maxZ: 10 };
  function segHitsBox(ax, az, bx, bz, c) {
    let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
    for (const [a, d, lo, hi] of [[ax, dx, c.minX, c.maxX], [az, dz, c.minZ, c.maxZ]]) {
      if (Math.abs(d) < 1e-9) { if (a < lo || a > hi) return false; continue; }
      let ta = (lo - a) / d, tb = (hi - a) / d; if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false;
    }
    return true;
  }
  B.perception.setOcclusion((ox, oy, oz, tx, ty, tz) => segHitsBox(ox, oz, tx, tz, wall));
  const bot = { pos: { x: 0, y: 0, z: 0 }, yaw: Math.PI, hp: 100, maxHp: 100, speed: 0, percT: -1, foe: null, foeSeen: false, hurtBy: null };
  const shooter = { pos: { x: 0, y: 0, z: 16 }, yaw: Math.PI, hp: 100, maxHp: 100, speed: 0 };
  B.register(bot, "gg_bot", { game: "sim", faction: "ffa" });
  B.register(shooter, "gg_bot", { game: "sim", faction: "ffa" });
  let goal = null;
  B.act.use("sim", { moveTo(a, x, z) { goal = { x, z }; return true; }, stop() { goal = null; return true; } });
  check(!ggPerceive(bot, [shooter]), "facing away, wall between: nothing seen");
  B.perception.noise(shooter.pos.x, shooter.pos.z, 42, "gunshot", shooter);
  const h = B.memory.heard(bot);
  check(!!h && h.kind === "gunshot" && h.source === shooter && h.z === 16, "the shot is heard through the wall (16 m < 42/2)");
  // decide(): nobody in sight -> go where it was heard
  B.act.moveTo(bot, h.x, h.z, { speed: 4.2, kind: "run" });
  check(goal && goal.z === 16, "the bot investigates the heard spot via act.moveTo");
  // walk round the wall's end (x=5) toward the sound, facing the way it goes
  let spotT = -1, firstVisT = -1;
  const path2 = [{ x: 5.5, z: 6 }, { x: 5.5, z: 12 }];
  let wi = 0;
  for (let i = 0; i < 200 && spotT < 0; i++) {
    const w = path2[Math.min(wi, path2.length - 1)];
    const dx = w.x - bot.pos.x, dz = w.z - bot.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.3) wi++; else { const s = Math.min(d, 4.2 * 0.05); bot.pos.x += dx / d * s; bot.pos.z += dz / d * s; bot.yaw = Math.atan2(dx, dz); }
    advance(0.05);
    if (i % 3 === 0) {
      const f = ggPerceive(bot, [shooter]);
      const rec = B.memory.lastSeen(bot, shooter);
      if (rec && rec.visible && firstVisT < 0) firstVisT = T;
      if (f) spotT = T;
    }
  }
  check(firstVisT > 0 && spotT > firstVisT, "spotted through the awareness meter, not on first sight (line at " + firstVisT.toFixed(2) + " s, spotted at " + spotT.toFixed(2) + " s)");
  const ls = B.memory.lastSeen(bot, shooter);
  check(ls && Math.abs(ls.z - 16) < 1e-6, "memory.lastSeen holds where he stood");
  // he ducks behind the wall and moves: the bot keeps the last place it saw him
  bot.pos.x = 0; bot.pos.z = 4; bot.yaw = 0; shooter.pos.x = -1; shooter.pos.z = 14;
  advance(0.2);
  ggPerceive(bot, [shooter]);
  const ls2 = B.memory.lastSeen(bot, shooter);
  check(!bot.foeSeen && ls2 && ls2.z === 16 && ls2.x === 0 && !ls2.visible, "out of sight: foeSeen false, lastSeen still (0, 16), where the fight was");
  // crouched + still vs running: the meter fills slower on the crouched man
  fresh(3);
  const o1 = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, hp: 100 }, o2 = { pos: { x: 100, y: 0, z: 0 }, yaw: 0, hp: 100 };
  B.register(o1, "gg_bot", { game: "sim" }); B.register(o2, "gg_bot", { game: "sim" });
  const crouch = { pos: { x: 0, y: 0, z: 35 }, crouch: true, speed: 0 };
  const runner = { pos: { x: 100, y: 0, z: 35 }, speed: 5 };
  const a1 = B.perception.awareness(o1, crouch, 0.3, _spot), a2 = B.perception.awareness(o2, runner, 0.3, _spot);
  check(a2 > a1 * 2, "a runner at 35 m is noticed >2x faster than a crouched, still man (" + a2.toFixed(3) + " vs " + a1.toFixed(3) + ")");
  B.perception.setOcclusion(null);
});

// =========================================================================
// the disaster crowd, as src/entities/survivorbot.js now wires it
function hmix(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function runCrowd(seedOffset) {
  fresh(77 + seedOffset * 1000);               // a different brain rng on purpose: must not matter
  for (let i = 0; i < seedOffset * 37; i++) B.rng();
  const CROWD = "surv-crowd";
  const G = MO.group(CROWD);
  G.members.length = 0; G.men0 = 0; G.p0 = 0; G.shock = 0; G.morale = 1; G.broken = false;
  MO.config(CROWD, { lostK: 0.2, routK: 0.15, shockK: 3, shockCap: 0.12 });   // survivorbot.js CROWD_K
  B.define("survivor", { nerve: 0.5 });                                         // survivorbot.js
  const crowd = [];
  for (let i = 0; i < 99; i++) {                 // the drop's lobby
    const s = { pos: { x: (i % 11) * 5, y: 0, z: Math.floor(i / 11) * 5 }, yaw: (i * 0.7) % 6.28, hp: 100, dead: false, state: "move", _hid: i * 7919 + 13 };
    const sk = Math.pow(hmix(s._hid, 1), 1.15), h = s._hid;
    const rec = B.register(s, "survivor", { game: "survival", group: CROWD, personality: {
      courage: 0.12 + sk * 0.6 + hmix(h, 29) * 0.2, aggression: 0.1 + hmix(h, 31) * 0.35,
      discipline: 0.15 + sk * 0.7, curiosity: hmix(h, 37), loyalty: 0.3 + hmix(h, 41) * 0.5 } });
    rec.nerveJ = (hmix(h, 43) - 0.5) * 0.12;
    s._survBrain = true;
    crowd.push(s);
  }
  const WIT = { range: 24, touch: 6, occlude: false };
  const TH = { kind: "hazard", x: 0, z: 0, distance: 0, armed: false, aimingAtMe: false, source: null };
  const _w = [];
  const log = [];
  function death(d, t) {
    d.dead = true; d.hp = 0;
    MO.death(CROWD, d);
    const list = B.near(d.pos.x, d.pos.z, 24, _w);
    for (const r of list) {
      const o = r.actor;
      if (o === d || o.dead) continue;
      if (!B.perception.seesPoint(o, d.pos.x, 0, d.pos.z, WIT)) continue;
      const dd = Math.hypot(o.pos.x - d.pos.x, o.pos.z - d.pos.z);
      MO.rattle(o, 0.25 + 0.45 * Math.max(0, 1 - dd / 24));
      TH.x = d.pos.x; TH.z = d.pos.z; TH.distance = dd; TH.sheltered = o.state === "hide";
      const resp = B.threat.respond(o, TH);
      log.push("w" + crowd.indexOf(o) + ":" + resp + "@" + t);
    }
  }
  let acc = 0;
  const brokenAt = [], flicker = [];
  const prev = crowd.map(() => false);
  for (let f = 0; f < 60 * 40; f++) {          // 40 s at 60 Hz
    const dt = 1 / 60, t = f * dt;
    advance(dt);
    acc += dt; if (acc >= 0.25) { MO.tick(acc); acc = 0; }
    for (const s of crowd) if (!s.dead) B.memory.tick(s, dt);
    if (f === 60) death(crowd[9], t);                                     // one death
    if (f >= 320 && f < 1040 && f % 40 === 0) death(crowd[30 + ((f - 320) / 40) * 2], t);   // a mass-casualty 12 s: 18 dead through the middle
    if (f % 6 === 0) crowd.forEach((s, i) => {
      if (s.dead) return;
      const br = MO.broken(s);
      if (br && !prev[i]) { brokenAt.push(i + "@" + t.toFixed(2)); if (flicker[i] != null && t - flicker[i] < 3) flicker.push("flip" + i); }
      if (!br && prev[i]) flicker[i] = t;
      prev[i] = br;
    });
  }
  return { crowd, log, brokenAt, flicker, G };
}
scenario(3, "disaster crowd: a death scares the timid, a massacre breaks them, the brave hold, the crowd rallies; deterministic", function () {
  const r = runCrowd(0);
  const first = r.log.filter((x) => x.endsWith("@1"));
  const flee1 = first.filter((x) => /:flee@/.test(x)).length;
  check(first.length > 0 && flee1 > 0 && flee1 < first.length, "one death: " + first.length + " witnesses, " + flee1 + " flee, the rest " + first.filter((x) => !/:flee@/.test(x)).map((x) => x.split(":")[1].split("@")[0]).join("/"));
  const courage = (i) => r.crowd[i]._brain.personality.courage;
  const brokeIdx = [...new Set(r.brokenAt.map((x) => +x.split("@")[0]))];
  const alive = r.crowd.map((s, i) => i).filter((i) => !r.crowd[i].dead);
  const bravest = alive.slice().sort((a, b) => courage(b) - courage(a)).slice(0, 10);
  check(brokeIdx.length >= 5 && brokeIdx.length < alive.length * 0.6, "the massacre breaks " + brokeIdx.length + " of " + alive.length + " survivors, not the whole crowd (" + r.brokenAt.slice(0, 5).join(", ") + ", ...)");
  const cb = brokeIdx.reduce((s, i) => s + courage(i), 0) / brokeIdx.length, ca = alive.reduce((s, i) => s + courage(i), 0) / alive.length;
  check(bravest.every((i) => brokeIdx.indexOf(i) < 0) && cb < ca, "the ten bravest never break; those who do are the timid (mean courage " + cb.toFixed(2) + " vs crowd " + ca.toFixed(2) + ")");
  check(r.flicker.filter((x) => typeof x === "string").length === 0, "no one flickers (re-breaks within 3 s of a rally)");
  const stillBroken = alive.filter((i) => r.crowd[i]._brain.routed).length;
  check(stillBroken <= brokeIdx.length * 0.2, "~20 s of quiet: the crowd rallies (" + stillBroken + " still broken of " + brokeIdx.length + ")");
  const r2 = runCrowd(1);
  check(JSON.stringify(r.log) === JSON.stringify(r2.log) && JSON.stringify(r.brokenAt) === JSON.stringify(r2.brokenAt),
    "deterministic: a second run with a different brain rng state is identical (" + r.log.length + " witness responses)");
});

// =========================================================================
scenario(4, "soldiers: perception-gated targeting (no radar behind the back)", function () {
  fresh(4);
  const SPOT = { range: 175, fovHalf: 1.75, touch: 10, occlude: false };
  const m = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, hp: 100 };            // facing +z
  const front = { pos: { x: 20, y: 0, z: 90 } }, behind = { pos: { x: 3, y: 0, z: -60 } }, close = { pos: { x: 0, y: 0, z: -8 } };
  check(B.perception.sees(m, front, SPOT), "an enemy in front at 92 m is a candidate");
  check(!B.perception.sees(m, behind, SPOT), "an enemy 60 m behind his back is not");
  check(B.perception.sees(m, close, SPOT), "an enemy 8 m behind (inside the touch radius) is");
  check(m._brain === undefined, "no brain record is made for a soldier (thousands of men, zero allocation)");
});

// ---- run ------------------------------------------------------------------
const only = process.argv.slice(2).map(Number).filter((n) => n > 0);
for (const s of scenarios) {
  if (only.length && !only.includes(s.n)) continue;
  console.log("\n[" + s.n + "] " + s.name);
  try { s.fn(); } catch (e) { fails++; console.log("  FAIL threw: " + (e && e.stack || e)); }
}
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
