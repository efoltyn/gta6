/* ============================================================
   systems/brain.js — CBZ.brain: THE ONE NPC DECISION LAYER, FOR EVERY GAME.

   WHY IT EXISTS. Owner, 2026-09-27: "the AI logic is all separate throughout
   these games... it could come together and benefit from each game: you get
   handcuff logic from jail, all the logic from the different games comes
   together... less glitchy." Before this file the repo had five sight tests
   (guards.js guardSeesPoint, gungame's segBlocked cone, aitactics updateLOS,
   police's lostT, city/los.js), three hearing models, two copies of army
   morale (warlord/battle.js and its games/battle.html port) and two arrest
   ladders (prison capture.js, city police.js). This file is the best of each,
   once, and every game's NPCs become CONFIGURATIONS of it (archetypes).

   WHAT IT IS NOT. Pure decision logic. It never builds a mesh, never writes a
   position, never animates. Bodies move through CBZ.brain.act, which calls the
   CBZ.moves / CBZ.verbs seams when they exist and otherwise a per-game
   executor the game registered (act.use). Runs in the browser (window.CBZ)
   and under plain node (tools/brain-sim.mjs): no THREE, no DOM required.

   STATE. Everything per actor lives on actor._brain (CBZ.brain.of(actor)).
   Hot paths allocate nothing: reused records, reused buffers, a spatial hash
   (8 m cells) rebuilt at most once per clock tick, sensing staggered by id.

   THE API (binding contract; additions marked +)
     brain.of(actor, archetypeId?)        brain.define(id, spec)   brain.archetype(id)
     brain.register(actor, archId, opts)  brain.unregister(actor)
       opts: { faction, clique, group, leader, personality, game, protect, safe, behavior,
               + nerve (absolute break point), + nerveJ }  — a FULL personality + nerve
               consume no brain RNG (deterministic games stay deterministic)
     archetype spec + selfAttitude: same-faction attitude for this kind (inmate 0.2)
     brain.clock(t)  brain.now()          + brain.update(dt)  + brain.reset()  + brain.seed(n)
     + brain.list()  + brain.near(x, z, r, out?)  + brain.rng()
     brain.tick(actor, dt, ctx) -> INTENT { kind, x, z, speed, posture, target, say, response, phase }

     perception.sees(obs, target, opts)  .seesPoint(obs, x, y, z, opts)
     perception.awareness(obs, target, dt, opts) -> 0..1 (>=1 SPOTTED)
     perception.noise(x, z, loudness_m, kind, source) -> listeners reached
     perception.blind(actor)  .addBlind(fn)  .setOcclusion(fn, + game?)  .setLight(fn)
       awareness opts.reason 0 = seen but no reason to care: the meter still drains
     + perception.occluded(ox,oy,oz, tx,ty,tz)  + perception.NOISE (default radii by kind)
     + perception.spotted(obs, target) -> awareness >= 1

     memory.see(a, t)  .lastSeen(a, t)  .heard(a)  .grudge(a, other, delta?)
     memory.forget(a)  memory.tick(a, dt)   + memory.recent(a, t, sec)  + memory.hear(a, ...)
     + memory.aware(obs, t) -> meter record  + memory.setAware(obs, t, v, hold?)
     brain.rep.get(faction)  .add(faction, {fear,respect,hostility})  .reset()

     needs.define(archOrGame, blocks)  needs.current(actor, hour?)
     needs.drive(actor, id, delta)  needs.top(actor)   + needs.level(actor, id)  + needs.hour()

     social.faction(a)  .setAttitude(fa, fb, v)  .attitude(a, b)  .clique(a)
     social.cliqueMates(a, radius)  social.crime(kind, x, z, perp, severity, opts)
     social.onReport(game, fn) -> unsubscribe   social.retaliate(victim, aggressor, harm)
     + social.silence(witness, how) (alias cancelReport)  + social.pending()
     + social.fileNow(witness)  + social.holdReport(witness)  + social.accuse(w, perp, kind, sev, opts)
     + social.setReportBias(fn(witness, crime) -> mult, game?)
       reports carry report.heat / report.type (= opts.heat / opts.type) untouched
     + social.setLeader(clique, actor)  + social.leader(clique)
       crime opts: { game, victim, loud, sightRange, instant, noReport, y, ...any }
       (the whole opts object rides every report as report.opts)

     threat.assess(actor, threat)  threat.respond(actor, threat)
       responses: fight | flee | freeze | cover | surrender | comply | ignore | + hold
       threat: { source, x, z, armed, aimingAtMe, distance, kind, + authority, + sheltered,
                 + weapon ("gun"|"melee"|"none"|"hazard"), + reloading, + facingAway | + yaw,
                 + cornered, + hide (a door to get behind exists), + coverNear, + inCover, + rushRange }
       WEAPON-AWARE: against a gun only a gun fights (cover first, then from
       range); a blade rushes only inside RUSH_R while the gunman reloads or
       looks away; the rest flee / hide / cover / go prone / surrender, freeze
       when cornered. fight<->flight is held DWELL s for the same threat.
     + threat.how(a) -> "flee"|"hide"|"cover"|"prone"|"stalk"|"engage"|"rush"|...
     + threat.capability(a) -> "gun"|"melee"|"none"   + threat.setCapability(fn, game?)
     + threat.canRush(a, th)  + threat.facingAway(a, th)  + threat.weaponOf(th)
     social.retaliate(victim, aggressor, harm, + opts{weapon,reloading,facingAway,yaw})
       vs a gunman: gun -> "weapon"|"glare", blade in its window -> as rolled,
       everyone else -> "avoid" (social.AVOID); the grudge is kept
     tick intents + hide | prone | stalk | avoid ; ctx.hide(actor, tx, tz) -> {x,z}
     morale.group(id)  .hit(id, amt)  .death(id, actor)  .rattle(actor, amt)
     morale.of(actor)  .broken(actor)  .tick(dt)
       + morale.config(id, k)  + morale.nerve(actor)  + morale.clear(id)  + tick(dt, groupId)
       tick is idempotent per clock stamp; rattle drains in memory.tick for the
       brains a game memory-ticks, in morale.tick only for the rest
       + EXACT PORTS for thin callers: morale.fromLosses(o) (warlord moraleFrom),
         morale.brokenSide(side, fled) (warlord), morale.stepRout(m, sideMorale,
         nerve) (warlord), morale.nerveOf(cq) (warlord), morale.armyStep(A, F,
         dt, opts) (battle.html updateMorale per army), morale.deathShock(A, w),
         morale.manMorale(army, supp, hf), morale.nerveFor(tier, i) (battle.html),
         morale.K (battle.html constants), morale.W (warlord constants)

     authority.begin(officer, suspect, reason, opts) -> case
       opts: { roe, orderRange, cuffRange, patience, + warnRange, + skipWarn,
               + minor (a complied minor matter = frisk + warning, no cuffs) }
     authority.step(officer, dt, suspectState) -> { phase, say, act, verb, x, z }
     authority.cancel(officer)   + authority.caseOf(officer)  + authority.LINES  + .ARREST
       case.outcome: cuffed | warned | released | complied | lost | dead | cancelled
       + opts.hold (challenge in place)  + opts.comply "disarm" + opts.outcome "release"
       + opts.rechallenge (true | window s: patience / n for the same man again)
       + opts.tackleRange (m, default 3.2)  + opts.tackles (attempts per case, default 2)
       + opts.silent (the game speaks the lines)  + opts.complyHold (s, default 0.6)

     act.moveTo(a, x, z, opts)  act.stop(a)  act.face(a, x, z)  act.posture(a, p)
     act.say(a, line, opts)  act.verb(name, a, b, opts)  act.use(game, executor)
       + executor.prefer: true makes the game's executor win over the seams
       + actor._brain.movedAt / movedFrame  + act.movedThisFrame(a)
============================================================ */
(function (root) {
  "use strict";
  const W = (typeof window !== "undefined" && window) || root.window || (root.window = {});
  const CBZ = W.CBZ = W.CBZ || {};
  if (CBZ.brain && CBZ.brain.__core) {
    if (typeof module !== "undefined" && module.exports) module.exports = CBZ.brain;
    return;
  }

  const PI = Math.PI;
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* ---------------------------------------------------------------- rng
     Seeded (mulberry32) so tools/brain-sim.mjs and replays are reproducible.
     A game that wants its own stream calls brain.seed(n). */
  let seedS = 0x9e3779b9 >>> 0;
  function rng() {
    seedS = (seedS + 0x6D2B79F5) >>> 0;
    let t = seedS;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function range(r) { return r ? r[0] + (r[1] - r[0]) * rng() : 0.5; }

  /* ---------------------------------------------------------------- clock
     clock(t) once per frame (game seconds). Without it the brain reads
     CBZ.game.elapsed, and without THAT, whatever update(dt) accumulated.
     A clock() LAPSES: if nobody has called it for 0.5 s of wall time (the
     prison drove it, then the page moved to a game that doesn't), the brain
     goes back to CBZ.game.elapsed instead of freezing on the old stamp —
     a frozen stamp would stall every idempotent morale.tick for good. */
  let T = 0, clockSet = false, frame = 0, clockWall = 0;
  const wallNow = typeof performance !== "undefined" && performance.now ? function () { return performance.now(); } : function () { return Date.now(); };
  function now() {
    const g = CBZ.game;
    const ge = g && typeof g.elapsed === "number";
    if (clockSet && (!ge || wallNow() - clockWall < 500)) return T;
    if (ge) return g.elapsed;
    return T;
  }

  /* ---------------------------------------------------------------- actor duck-type */
  function ax(a) { return a.pos ? a.pos.x : a.group ? a.group.position.x : a.position ? a.position.x : (a.x || 0); }
  function ay(a) { return a.pos ? (a.pos.y || 0) : a.group ? a.group.position.y : a.position ? a.position.y : (a.y || 0); }
  function az(a) { return a.pos ? a.pos.z : a.group ? a.group.position.z : a.position ? a.position.z : (a.z || 0); }
  function yawOf(a) { return a.yaw != null ? a.yaw : a.group ? a.group.rotation.y : 0; }
  function hpFrac(a) { return a.hp == null ? 1 : clamp01(a.hp / (a.maxHp || 100)); }
  function isDead(a) { return !!(a && (a.dead || (a.hp != null && a.hp <= 0 && a.maxHp))); }
  // ids for things that have no brain (the player, a prop): a WeakMap, not a field
  const idMap = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  let nextId = 1;
  function idOf(o) {
    if (o == null) return 0;
    if (typeof o !== "object") return o;
    if (o._brain) return o._brain.id;
    if (!idMap) return 0;
    let id = idMap.get(o);
    if (!id) { id = nextId++; idMap.set(o, id); }
    return id;
  }

  /* ================================================================ ARCHETYPES
     Numbers are lifted from the games that already had them:
       guard     viewDist 12-15, half 0.55-0.64   (entities/guards.js makeGuard)
       gg_bot    70 m, ~200 deg cone (cos > -0.2), 5 m touch  (modes/gungame.js perceive)
       cop       48 m LOS range (aitactics updateLOS), challenge at 10 m, patience 6 s
       swat      patience 1.5 s (police.js copPatience)
       civilian  30 m crime-tag radius (city/peds.js cityTagWitnesses)
     cq = the combat_iq ROLE row whose `nerve` column is this person's break
     point (civ 0.62 .. swat 0.16), exactly as warlord/battle.js reads it. */
  const ARCH = Object.create(null);
  const P5 = function (c, a, d, cu, l) { return { courage: c, aggression: a, discipline: d, curiosity: cu, loyalty: l }; };
  const BASE = {
    viewDist: 25, fovHalf: 1.1, hearMul: 1, touch: 1.2, closeSpot: 2.6,
    faction: "civilians", cq: "civ", moraleK: 1, senseEvery: 0.2, memSec: 8,
    personality: P5([0.3, 0.7], [0.2, 0.5], [0.2, 0.5], [0.3, 0.7], [0.3, 0.7]),
    witness: { flee: 0.3, film: 0.15, report: 0.2, intervene: 0.05, cower: 0.15, ignore: 0.2, cheer: 0 },
    threat: {},
    authority: null,
    needs: null,
    lines: null,
  };
  function define(id, spec) {
    const prev = ARCH[id];
    const out = {};
    const src = prev || BASE;
    for (const k in BASE) out[k] = src[k];
    for (const k in src) out[k] = src[k];
    if (spec) for (const k in spec) {
      const v = spec[k];
      // tables merge (a router can nudge one weight without restating the rest)
      if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) && k !== "lines") {
        const m = {};
        for (const j in out[k]) m[j] = out[k][j];
        for (const j in v) m[j] = v[j];
        out[k] = m;
      } else out[k] = v;
    }
    out.id = id;
    ARCH[id] = out;
    return out;
  }
  function archetype(id) { return ARCH[id] || ARCH.civilian; }

  define("civilian", {});
  define("inmate", {
    viewDist: 18, fovHalf: 1.2, faction: "inmates", cq: "thug", selfAttitude: 0.2,
    personality: P5([0.2, 0.9], [0.3, 0.9], [0.1, 0.4], [0.3, 0.7], [0.4, 0.9]),
    // the yard's code: most look away, some enjoy it, a few snitch
    witness: { flee: 0.2, film: 0, report: 0.07, intervene: 0.12, cower: 0.16, ignore: 0.3, cheer: 0.15 },
    threat: { fight: 0.1 },
    needs: { hunger: 0.006, rest: 0.004, social: 0.005, money: 0.004, safety: 0.002 },
  });
  define("guard", { weapon: "gun",
    viewDist: 14, fovHalf: 0.6, hearMul: 1.1, faction: "guards", cq: "pro",
    personality: P5([0.5, 0.9], [0.3, 0.6], [0.6, 0.9], [0.4, 0.8], [0.5, 0.9]),
    witness: { flee: 0, film: 0, report: 0.4, intervene: 0.6, cower: 0, ignore: 0, cheer: 0 },
    threat: { cover: 0.1, fight: 0.1 },
    authority: "nonlethal",
    authorityOpts: { warnRange: 9, orderRange: 4.2, cuffRange: 1.4, patience: 2.2 },
  });
  define("warden", {
    viewDist: 16, fovHalf: 0.7, faction: "guards", cq: "pro",
    personality: P5([0.6, 0.9], [0.2, 0.5], [0.8, 1], [0.5, 0.8], [0.6, 0.9]),
    witness: { report: 0.5, intervene: 0.5, flee: 0, cower: 0, ignore: 0, film: 0, cheer: 0 },
    authority: "nonlethal",
    authorityOpts: { warnRange: 9, orderRange: 4.2, cuffRange: 1.4, patience: 2.2 },
  });
  define("cop", { weapon: "gun",
    viewDist: 48, fovHalf: 1.1, faction: "police", cq: "pro",
    personality: P5([0.5, 0.9], [0.3, 0.6], [0.6, 0.9], [0.5, 0.8], [0.5, 0.9]),
    witness: { flee: 0, film: 0, report: 0.3, intervene: 0.7, cower: 0, ignore: 0, cheer: 0 },
    threat: { cover: 0.15 },
    authority: "nonlethal",
    authorityOpts: { warnRange: 10, orderRange: 6, cuffRange: 1.6, patience: 6.0 },
  });
  define("swat", { weapon: "gun",
    viewDist: 55, fovHalf: 1.0, faction: "police", cq: "swat",
    personality: P5([0.7, 1], [0.4, 0.7], [0.85, 1], [0.4, 0.7], [0.7, 1]),
    witness: { report: 0.2, intervene: 0.8, flee: 0, film: 0, cower: 0, ignore: 0, cheer: 0 },
    threat: { cover: 0.25, fight: 0.15 },
    authority: "lethal",
    authorityOpts: { warnRange: 12, orderRange: 7, cuffRange: 1.6, patience: 1.5 },
  });
  define("ganger", {
    viewDist: 35, fovHalf: 1.2, faction: "gang", cq: "thug",
    personality: P5([0.4, 0.9], [0.5, 1], [0.2, 0.5], [0.3, 0.6], [0.5, 1]),
    witness: { flee: 0.1, film: 0.05, report: 0, intervene: 0.2, cower: 0.05, ignore: 0.4, cheer: 0.2 },
    threat: { fight: 0.2 },
  });
  define("crew", {
    viewDist: 35, fovHalf: 1.2, faction: "crew", cq: "thug",
    personality: P5([0.5, 0.9], [0.4, 0.8], [0.3, 0.7], [0.3, 0.6], [0.7, 1]),
    witness: { flee: 0.05, film: 0, report: 0, intervene: 0.35, cower: 0.05, ignore: 0.4, cheer: 0.15 },
    threat: { fight: 0.15 },
  });
  // THE PRESIDENT'S DETAIL. protection.js builds the formation; the brain only
  // answers who sees, who hears, and what each role does on the first shot.
  define("agent_lead", { weapon: "gun",
    viewDist: 60, fovHalf: 1.2, hearMul: 1.2, faction: "detail", cq: "elite",
    personality: P5([0.8, 1], [0.3, 0.6], [0.9, 1], [0.5, 0.8], [0.9, 1]),
    witness: { intervene: 0.6, report: 0.4, flee: 0, film: 0, cower: 0, ignore: 0, cheer: 0 },
    threat: { cover: 0.6, fight: -0.2, flee: -0.5 },
    authority: "protect",
    authorityOpts: { warnRange: 14, orderRange: 8, cuffRange: 1.6, patience: 1.8 },
  });
  define("agent_cp", { weapon: "gun",
    viewDist: 45, fovHalf: 1.3, hearMul: 1.2, faction: "detail", cq: "elite",
    personality: P5([0.75, 1], [0.3, 0.6], [0.85, 1], [0.4, 0.7], [0.9, 1]),
    witness: { intervene: 0.7, report: 0.3, flee: 0, film: 0, cower: 0, ignore: 0, cheer: 0 },
    threat: { cover: 0.8, fight: -0.3, flee: -0.6 },
    authority: "protect",
    authorityOpts: { warnRange: 12, orderRange: 6, cuffRange: 1.6, patience: 1.8 },
  });
  define("agent_sweep", { weapon: "gun",
    viewDist: 50, fovHalf: 1.0, hearMul: 1.2, faction: "detail", cq: "elite",
    personality: P5([0.7, 1], [0.3, 0.6], [0.8, 1], [0.7, 1], [0.8, 1]),
    witness: { intervene: 0.7, report: 0.3, flee: 0, film: 0, cower: 0, ignore: 0, cheer: 0 },
    threat: { fight: 0.2, cover: 0.2 },
    authority: "protect",
  });
  define("countersniper", { weapon: "gun",
    viewDist: 250, fovHalf: 0.35, hearMul: 1.4, faction: "detail", cq: "elite", touch: 0,
    personality: P5([0.8, 1], [0.3, 0.5], [0.95, 1], [0.3, 0.5], [0.9, 1]),
    witness: { report: 1, intervene: 0, flee: 0, film: 0, cower: 0, ignore: 0, cheer: 0 },
    hold: true,                           // THE POST IS THE JOB: never leaves the roof
    authority: "protect",
  });
  define("protectee", {
    viewDist: 25, fovHalf: 1.2, faction: "detail", cq: "civ",
    personality: P5([0.2, 0.5], [0.05, 0.2], [0.4, 0.7], [0.2, 0.5], [0.5, 0.8]),
    witness: { flee: 0.8, cower: 0.2, report: 0, film: 0, intervene: 0, ignore: 0, cheer: 0 },
    evacuate: true,                       // flight is an EVACUATION: to the car, the safe room
    threat: { flee: 0.5, fight: -1 },
  });
  define("hitman_target", {
    viewDist: 30, fovHalf: 1.3, hearMul: 1.2, faction: "civilians", cq: "civ",
    personality: P5([0.3, 0.6], [0.2, 0.5], [0.3, 0.6], [0.6, 0.9], [0.3, 0.6]),
    witness: { flee: 0.6, report: 0.3, cower: 0.1, film: 0, intervene: 0, ignore: 0, cheer: 0 },
    threat: { flee: 0.25 },
  });
  define("survivor", {
    viewDist: 40, fovHalf: 1.4, faction: "survivors", cq: "civ",
    personality: P5([0.2, 0.8], [0.1, 0.5], [0.2, 0.6], [0.3, 0.7], [0.3, 0.8]),
    witness: { flee: 0.5, cower: 0.2, film: 0.1, ignore: 0.2, report: 0, intervene: 0, cheer: 0 },
    threat: { flee: 0.2 },
    needs: { rest: 0.003, safety: 0.004, hunger: 0.004 },
  });
  define("gg_bot", { weapon: "gun",
    viewDist: 70, fovHalf: 1.77, touch: 5, faction: "ffa", cq: "pro", memSec: 8,
    personality: P5([0.5, 1], [0.6, 1], [0.3, 0.7], [0.5, 0.9], [0, 0.2]),
    witness: { ignore: 1, flee: 0, film: 0, report: 0, intervene: 0, cower: 0, cheer: 0 },
    threat: { fight: 0.4 },
  });
  define("soldier", { weapon: "gun",
    viewDist: 120, fovHalf: 1.2, hearMul: 1.2, faction: "army", cq: "pro",
    personality: P5([0.4, 0.9], [0.4, 0.8], [0.5, 0.9], [0.3, 0.6], [0.5, 0.9]),
    witness: { intervene: 0.5, ignore: 0.5, flee: 0, film: 0, report: 0, cower: 0, cheer: 0 },
    threat: { cover: 0.2, fight: 0.15 },
  });

  /* ================================================================ RECORDS */
  const registered = [];        // the brains hearing / witnessing iterates
  function personalityFromBehavior(name, out) {
    // systems/casttraits.js + config.js BEHAVIORS vocabulary -> the five axes
    const B = CBZ.BEHAVIORS && CBZ.BEHAVIORS[name];
    if (!B) return null;
    out.courage = clamp01(B.guts);
    out.aggression = clamp01(B.init * 1.6 + B.retaliate * 0.35);
    out.discipline = clamp01(1 - (B.picksWeak || 0) * 0.4 - B.init);
    return out;
  }
  const AXES = ["courage", "aggression", "discipline", "curiosity", "loyalty"];
  function fullPersonality(P) {
    if (!P) return false;
    for (let i = 0; i < AXES.length; i++) if (typeof P[AXES[i]] !== "number") return false;
    return true;
  }
  // opts (register's) lets a DETERMINISTIC game (seeded sims, lockstep war)
  // hand the whole person in: a full personality + a nerve consume no brain
  // RNG at all, so its stream is untouched by who else registered first.
  function makeRecord(actor, archId, opts) {
    const A = archetype(archId || "civilian");
    const pr = A.personality;
    const given = opts && fullPersonality(opts.personality) ? opts.personality : null;
    const noRng = !!given && opts.nerve != null;
    const p = given ? {
      courage: clamp01(given.courage), aggression: clamp01(given.aggression), discipline: clamp01(given.discipline),
      curiosity: clamp01(given.curiosity), loyalty: clamp01(given.loyalty),
    } : {
      courage: range(pr.courage), aggression: range(pr.aggression), discipline: range(pr.discipline),
      curiosity: range(pr.curiosity), loyalty: range(pr.loyalty),
    };
    if (actor.behavior) personalityFromBehavior(actor.behavior, p);
    const id = idMap && idMap.get(actor) ? idMap.get(actor) : nextId++;
    const b = {
      id: id, actor: actor, arch: A, archId: A.id, game: null,
      faction: A.faction, clique: null, group: null, leader: false,
      personality: p, blind: false,
      viewMul: 1,
      registered: false, _ri: -1,
      senseT: ((id * 0.6180339887) % 1) * (A.senseEvery || 0.2), senseAcc: 0,
      // memory: bounded parallel arrays (no Map iterators in the hot path)
      seenT: [], seenR: [],
      heardR: { x: 0, z: 0, t: -1e9, kind: null, source: null, d: 0, valid: false },
      gIds: [], gVals: [],
      needs: null,
      witness: null,
      retaliation: null,
      rattle: 0, rattleAt: null, routed: false, rallyT: 0, nerveJ: (((id * 37) % 11) - 5) * 0.012, nerveAbs: null,
      movedAt: -1e9, movedFrame: -1,
      case: null,
      protect: null, safe: null,
      lastSay: "", lastSayT: -1e9,
      threatR: { source: null, x: 0, z: 0, armed: false, aimingAtMe: false, distance: 0, kind: null },
      assessR: { level: 0, kind: null },
      response: "ignore", responseT: -1e9,
      // threat.respond's held decision (settle) + how it is carried out
      tResp: null, tRespT: -1e9, tSrc: null, tX: 0, tZ: 0, threatHow: null,
      engSrc: null, engT: -1e9, engLast: -1e9, weapon: null,
      intent: { kind: "none", x: 0, z: 0, speed: 0, posture: "stand", target: null, say: null, response: null, phase: null },
    };
    if (A.needs) {
      b.needs = { levels: {}, rates: A.needs, t: now() };
      for (const k in A.needs) b.needs.levels[k] = noRng ? 0.75 : 0.55 + rng() * 0.4;
    }
    return b;
  }
  function of(actor, archId, opts) {
    if (!actor) return null;
    let b = actor._brain;
    if (!b) { b = actor._brain = makeRecord(actor, archId, opts); }
    else if (archId && b.archId !== archId && ARCH[archId]) { b.arch = ARCH[archId]; b.archId = archId; }
    return b;
  }
  function register(actor, archId, opts) {
    opts = opts || {};
    const b = of(actor, archId, opts);
    if (opts.faction) b.faction = opts.faction;
    // an absolute break point (0..1) replaces archetype nerve + courage push +
    // jitter; nerveJ alone replaces only the id-ordered jitter
    if (opts.nerve != null) b.nerveAbs = clamp01(opts.nerve);
    if (opts.nerveJ != null) b.nerveJ = opts.nerveJ;
    if (opts.clique != null) b.clique = opts.clique;
    if (opts.group != null) b.group = opts.group;
    if (opts.game) b.game = opts.game;
    if (opts.protect) b.protect = opts.protect;
    if (opts.safe) b.safe = opts.safe;
    if (opts.behavior) personalityFromBehavior(opts.behavior, b.personality);
    if (opts.personality) for (const k in opts.personality) b.personality[k] = clamp01(opts.personality[k]);
    if (opts.leader && b.clique != null) setLeader(b.clique, actor);
    if (!b.registered) { b.registered = true; b._ri = registered.length; registered.push(b); }
    const gid = groupIdOf(b);
    if (b._gid != null && b._gid !== gid) moraleLeave(b);
    if (gid != null) moraleJoin(gid, b);
    hashDirty = true;
    return b;
  }
  function unregister(actor) {
    const b = actor && actor._brain;
    if (!b || !b.registered) return;
    const i = b._ri, last = registered.pop();
    if (last !== b) { registered[i] = last; last._ri = i; }
    b.registered = false; b._ri = -1;
    moraleLeave(b);
    const k = pending.indexOf(b); if (k >= 0) { pending[k] = pending[pending.length - 1]; pending.pop(); }
    hashDirty = true;
  }

  /* ================================================================ SPATIAL HASH
     8 m cells, rebuilt lazily at most once per clock tick (or after a
     register). Buckets and keys are kept between rebuilds: no allocation once
     the crowd has visited its cells. */
  const CELL = 8;
  const buckets = new Map();
  const bucketList = [];
  let hashFrame = -1, hashDirty = true, hashT = -1;
  function ckey(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }
  function rebuild() {
    const t = now();
    if (!hashDirty && hashFrame === frame && hashT === t) return;
    hashT = t;
    for (let i = 0; i < bucketList.length; i++) bucketList[i].length = 0;
    for (let i = 0; i < registered.length; i++) {
      const b = registered[i], a = b.actor;
      const k = ckey(Math.floor(ax(a) / CELL), Math.floor(az(a) / CELL));
      let arr = buckets.get(k);
      if (!arr) { arr = []; buckets.set(k, arr); bucketList.push(arr); }
      arr.push(b);
    }
    hashFrame = frame; hashDirty = false;
  }
  const _near = [];
  // every registered brain within r of (x,z), into out (a reused buffer)
  function near(x, z, r, out) {
    out = out || _near;
    out.length = 0;
    rebuild();
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    const r2 = r * r;
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const arr = buckets.get(ckey(ix, iz));
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i], a = b.actor;
        const dx = ax(a) - x, dz = az(a) - z;
        if (dx * dx + dz * dz <= r2) out.push(b);
      }
    }
    return out;
  }

  /* ================================================================ PERCEPTION
     The reference sight test is the prison's guardSeesPoint (entities/
     guards.js): blind states -> range -> cone -> the dark -> occlusion from
     the eye (1.5 m) to the target's chest (y + 1.0). Added: a touch radius
     (gungame's "d < 5 is aware whatever the cone"), per-call range/cone
     overrides, and a pluggable occlusion + light. */
  const blindFns = [];
  function blind(a) {
    if (!a) return true;
    if (a.dead || a.ko > 0 || a.asleep || a.tied || a.cuffed || a.bribed > 0 || a.intimidMode === "scared") return true;
    if (a._brain && a._brain.blind === true) return true;
    for (let i = 0; i < blindFns.length; i++) if (blindFns[i](a)) return true;
    return false;
  }
  // DEFAULT OCCLUSION: one THREE.Raycaster against CBZ.losBlockers through
  // CBZ.losRaycast (core/losgrid.js's accelerated path) when both exist; with
  // no THREE (node) or no blockers the world is open.
  let occlusionFn = null, ray = null, rO = null, rD = null;
  function defaultOcclusion(ox, oy, oz, tx, ty, tz) {
    const TH = W.THREE;
    const blk = CBZ.losBlockers;
    if (!TH || !TH.Raycaster || !blk || !blk.length) return false;
    if (!ray) { ray = new TH.Raycaster(); rO = new TH.Vector3(); rD = new TH.Vector3(); }
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.5) return false;
    rO.set(ox, oy, oz); rD.set(dx / d, dy / d, dz / d);
    ray.set(rO, rD); ray.near = 0; ray.far = Math.max(0.1, d - 0.4);
    const hits = CBZ.losRaycast ? CBZ.losRaycast(ray, blk) : ray.intersectObjects(blk, false);
    return !!(hits && hits.length > 0);
  }
  // per-GAME occlusion (setOcclusion(fn, game)): the observer's own game wins,
  // then the global one, then the THREE default
  const OCC = Object.create(null);
  function occluded(ox, oy, oz, tx, ty, tz, game) {
    const g = game != null && OCC[game];
    if (g) return g(ox, oy, oz, tx, ty, tz);
    return (occlusionFn || defaultOcclusion)(ox, oy, oz, tx, ty, tz);
  }
  // LIGHT: fn(observer, x, z) -> range multiplier (1 = daylight). Default is
  // the prison's CBZ.sightScale (systems/prisonnight.js) when published.
  let lightFn = null;
  function lightAt(obs, x, z, opts) {
    const f = (opts && opts.light) || lightFn || CBZ.sightScale;
    if (!f) return 1;
    const v = f(obs, x, z);
    return v == null ? 1 : v;
  }
  function seesPoint(obs, x, y, z, opts) {
    if (blind(obs)) return false;
    const b = obs._brain, A = b ? b.arch : BASE;
    const ox = ax(obs), oz = az(obs), oy = ay(obs);
    const dx = x - ox, dz = z - oz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    let vd = opts && opts.range != null ? opts.range : A.viewDist * (b ? b.viewMul : 1);
    if (opts && opts.shrink) vd *= opts.shrink;
    if (dist > vd) return false;
    if (dist > 0.05) {
      const touch = opts && opts.touch != null ? opts.touch : A.touch;
      if (dist > touch) {
        const half = opts && opts.fovHalf != null ? opts.fovHalf : A.fovHalf;
        if (half < PI) {
          const yw = yawOf(obs);
          const dot = (Math.sin(yw) * dx + Math.cos(yw) * dz) / dist;
          if (dot < Math.cos(half)) return false;
        }
      }
      // THE DARK can only shrink the cone (after range and angle)
      if (dist > vd * lightAt(obs, x, z, opts)) return false;
    }
    if (opts && opts.occlude === false) return true;
    const eye = opts && opts.eyeY != null ? opts.eyeY : 1.5;
    const tgt = opts && opts.targetY != null ? opts.targetY : 1.0;
    return !occluded(ox, oy + eye, oz, x, y + tgt, z, b ? b.game : null);
  }
  function sees(obs, target, opts) {
    if (!target || target === obs) return false;
    if (target.pos || target.group || target.position) return seesPoint(obs, ax(target), ay(target), az(target), opts);
    return seesPoint(obs, target.x, target.y || 0, target.z, opts);
  }

  /* THE AWARENESS METER — the prison guard's `sus` meter (guards.js perceive),
     generalised: rate = (0.3 + 2.4 * prox^2) * reason * movement * light *
     centre-of-cone, instant inside closeSpot (2.6 m), holds 1.4 s after sight
     breaks, then drains 0.22/s. >= 1 is SPOTTED. Stored on the memory record
     for that target, so every system that asks gets the same number. */
  const SUS_HOLD = 1.4, SUS_DRAIN = 0.22;
  function awareness(obs, target, dt, opts) {
    const b = of(obs);
    const m = seenRec(b, target, true);
    const tx = target.pos || target.group || target.position ? ax(target) : target.x;
    const tz = target.pos || target.group || target.position ? az(target) : target.z;
    const vis = sees(obs, target, opts);
    m.visible = vis;
    const reason = opts && opts.reason != null ? opts.reason : 1;
    // SEEN, but no reason to care (guards.js: a screw watching a man who has
    // done nothing): the sighting is remembered, the meter still lets go
    if (vis) { m.x = tx; m.z = tz; m.t = now(); m.valid = true; }
    if (vis && reason > 0) {
      const d = Math.hypot(tx - ax(obs), tz - az(obs));
      const vd = Math.max(1, opts && opts.range != null ? opts.range : b.arch.viewDist * b.viewMul);
      const prox = clamp01(1 - d / vd);
      // movement: the guard's moveMul off the TARGET's own speed / crouch
      let move = 1;
      if (opts && opts.moveMul != null) move = opts.moveMul;
      else {
        const sp = opts && opts.speed != null ? opts.speed : (target.speed != null ? Math.abs(target.speed) : 1);
        move = target.crouch ? 0.6 : sp > 3.4 ? 1.55 : sp < 0.4 ? 0.8 : 1;
      }
      const L = clamp01(lightAt(obs, tx, tz, opts));
      const lightMul = 0.55 + 0.6 * L;
      // centre of the cone reads faster than its edge
      const yw = yawOf(obs);
      const dot = d > 0.05 ? (Math.sin(yw) * (tx - ax(obs)) + Math.cos(yw) * (tz - az(obs))) / d : 1;
      const centre = 0.75 + 0.25 * clamp01(dot);
      let rate = (0.3 + 2.4 * prox * prox) * reason * move * lightMul * centre * (opts && opts.mul != null ? opts.mul : 1);
      if (d < b.arch.closeSpot) rate = 50;
      m.aware = Math.min(1, m.aware + rate * dt);
      m.hold = SUS_HOLD;
    } else {
      m.hold -= dt;
      if (m.hold <= 0 && m.aware > 0) m.aware = Math.max(0, m.aware - SUS_DRAIN * dt);
    }
    return m.aware;
  }

  /* HEARING — gungame's noise(): everyone inside the radius hears it, and the
     nearest/newest sound wins the slot. Walls halve the radius. */
  const NOISE = { gunshot: 48, explosion: 120, scream: 22, fight: 12, footstep: 5, glass: 16, alarm: 60, shout: 18, crash: 30 };
  function noise(x, z, loud, kind, source) {
    if (loud == null) loud = NOISE[kind] || 15;
    const maxR = loud * 1.5;
    const list = near(x, z, maxR, _noiseBuf);
    const t = now();
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i], a = b.actor;
      if (a === source || a.dead || a.ko > 0) continue;
      if (a.asleep && loud < 40) continue;            // only a real bang wakes a sleeper
      const r = loud * (b.arch.hearMul || 1);
      const dx = ax(a) - x, dz = az(a) - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > r) continue;
      if (d > r * 0.5 && occluded(x, 1.2, z, ax(a), ay(a) + 1.5, az(a), b.game)) continue;   // through a wall: half range
      hear(a, x, z, kind, source, d, t);
      n++;
    }
    return n;
  }
  const _noiseBuf = [];
  function hear(a, x, z, kind, source, d, t) {
    const b = of(a);
    const h = b.heardR;
    if (t == null) t = now();
    if (d == null) d = Math.hypot(ax(a) - x, az(a) - z);
    // a closer sound, or a fresher one (the old one is > 1 s stale), wins
    if (h.valid && t - h.t < 1 && d > h.d) return;
    h.x = x; h.z = z; h.t = t; h.kind = kind; h.source = source || null; h.d = d; h.valid = true;
  }

  const perception = {
    sees: sees, seesPoint: seesPoint, awareness: awareness, noise: noise, blind: blind,
    occluded: occluded, NOISE: NOISE,
    spotted: function (obs, target) { const b = obs && obs._brain; const r = b ? seenRec(b, target, false) : null; return !!(r && r.aware >= 1); },
    addBlind: function (fn) { if (typeof fn === "function" && blindFns.indexOf(fn) < 0) blindFns.push(fn); return function () { const i = blindFns.indexOf(fn); if (i >= 0) blindFns.splice(i, 1); }; },
    setOcclusion: function (fn, game) {
      const f = typeof fn === "function" ? fn : null;
      if (game != null) { if (f) OCC[game] = f; else delete OCC[game]; }
      else occlusionFn = f;
    },
    setLight: function (fn) { lightFn = typeof fn === "function" ? fn : null; },
  };

  /* ================================================================ MEMORY
     lastSeen: police/aitactics' lkx/lkz + lostT, per target. Grudges decay
     with a ~120 s half-life. Bounded: 8 seen targets, 16 grudges per actor. */
  const SEEN_MAX = 8, GRUDGE_MAX = 16, GRUDGE_HALF = 120;
  function seenRec(b, target, create) {
    const arr = b.seenT;
    for (let i = 0; i < arr.length; i++) if (arr[i] === target) return b.seenR[i];
    if (!create) return null;
    let r;
    if (arr.length < SEEN_MAX) {
      r = { x: 0, z: 0, t: -1e9, aware: 0, hold: 0, visible: false, valid: false };
      arr.push(target); b.seenR.push(r);
    } else {
      // evict the stalest
      let k = 0;
      for (let i = 1; i < arr.length; i++) if (b.seenR[i].t < b.seenR[k].t) k = i;
      arr[k] = target; r = b.seenR[k];
      r.t = -1e9; r.aware = 0; r.hold = 0; r.visible = false; r.valid = false;
    }
    return r;
  }
  function memSee(a, target, x, z) {
    const b = of(a);
    const r = seenRec(b, target, true);
    r.x = x != null ? x : ax(target); r.z = z != null ? z : az(target);
    r.t = now(); r.valid = true;
    return r;
  }
  function lastSeen(a, target) {
    const b = a && a._brain; if (!b) return null;
    const r = seenRec(b, target, false);
    return r && r.valid ? r : null;
  }
  function recent(a, target, sec) {
    const r = lastSeen(a, target);
    return !!(r && now() - r.t <= (sec == null ? a._brain.arch.memSec : sec));
  }
  function heard(a) {
    const b = a && a._brain; if (!b) return null;
    const h = b.heardR;
    return h.valid && now() - h.t <= b.arch.memSec ? h : null;
  }
  function grudge(a, other, delta) {
    const b = of(a);
    const id = idOf(other);
    const ids = b.gIds, vals = b.gVals;
    let i = ids.indexOf(id);
    if (i < 0) {
      if (!delta) return 0;
      if (ids.length >= GRUDGE_MAX) {
        let k = 0; for (let j = 1; j < vals.length; j++) if (Math.abs(vals[j]) < Math.abs(vals[k])) k = j;
        ids[k] = id; vals[k] = 0; i = k;
      } else { ids.push(id); vals.push(0); i = ids.length - 1; }
    }
    if (delta) vals[i] = clamp(vals[i] + delta, -1, 1);
    return vals[i];
  }
  function forget(a) {
    const b = a && a._brain; if (!b) return;
    b.seenT.length = 0; b.seenR.length = 0;
    b.heardR.valid = false;
    b.gIds.length = 0; b.gVals.length = 0;
    b.witness = null; b.retaliation = null;
  }
  function memTick(a, dt) {
    const b = a && a._brain; if (!b || !(dt > 0)) return;
    b._memT = frame; b._memAt = now();      // morale.tick leaves this man's rattle to us
    const k = Math.pow(0.5, dt / GRUDGE_HALF);
    const v = b.gVals;
    for (let i = 0; i < v.length; i++) v[i] *= k;
    if (b.needs) needsDecay(b, dt);
    if (b.rattle > 0) b.rattle = Math.max(0, b.rattle - MK.SUPP_DECAY * dt);
    if (b.rallyT > 0) b.rallyT -= dt;
  }
  const memory = {
    see: function (a, target, x, z) { return memSee(a, target, x, z); },
    lastSeen: lastSeen, recent: recent, heard: heard, grudge: grudge, forget: forget, tick: memTick,
    hear: function (a, x, z, kind, source) { hear(a, x, z, kind, source); return of(a).heardR; },
    // the awareness meter's record for (obs, target): { aware, hold, visible, x, z, t }
    // or null. setAware writes it (another system turned his head / stood him
    // down); hold is optional and keeps its value when omitted.
    aware: function (obs, target) { const b = obs && obs._brain; return b ? seenRec(b, target, false) : null; },
    setAware: function (obs, target, v, hold) {
      const r = seenRec(of(obs), target, true);
      r.aware = clamp01(+v || 0);
      if (hold != null) r.hold = +hold || 0;
      return r;
    },
  };

  /* ---------------------------------------------------------------- REPUTATION
     The player's standing, GLOBAL per faction, for the whole run. */
  const REP = Object.create(null);
  const rep = {
    get: function (f) { let r = REP[f]; if (!r) r = REP[f] = { fear: 0, respect: 0, hostility: 0 }; return r; },
    add: function (f, d) {
      const r = rep.get(f);
      if (d) { if (d.fear) r.fear = clamp01(r.fear + d.fear); if (d.respect) r.respect = clamp01(r.respect + d.respect); if (d.hostility) r.hostility = clamp01(r.hostility + d.hostility); }
      return r;
    },
    reset: function () { for (const k in REP) delete REP[k]; },
  };

  /* ================================================================ NEEDS / SCHEDULE
     Drives are aigoals.js's model: 0..1 where HIGH = satisfied, draining at a
     per-archetype rate; drive(+) tops one up, drive(-) spends it. top() is the
     most urgent (lowest) drive under 0.5, or null when nobody's hungry.
     Schedules are {id, from, to?, activity, where?} hour blocks; the LAST
     block wraps through midnight, `to` defaults to the next block's `from`
     (systems/dayplan.js's own convention). The hour comes from an existing
     CBZ.dayPlan's clock, else CBZ.dayPhase, else a plain number. */
  const SCHED = Object.create(null);
  function needsDefine(key, blocks) {
    const arr = (blocks || []).slice().sort(function (a, b) { return a.from - b.from; });
    SCHED[key] = arr;
    return arr;
  }
  function hourNow() {
    const D = CBZ.dayPlan;
    if (D && D.plans && D.plans.length && typeof D.plans[0].hour === "function") return D.plans[0].hour();
    if (typeof CBZ.dayPhase === "function") return (CBZ.dayPhase() * 24 + 6) % 24;
    return 12;
  }
  const NONE_ACT = { activity: null, where: null, id: null };
  function needsCurrent(actor, hour) {
    const b = of(actor);
    const s = SCHED[b.archId] || (b.game && SCHED[b.game]) || SCHED["*"];
    if (!s || !s.length) return NONE_ACT;
    const h = ((hour != null ? hour : hourNow()) % 24 + 24) % 24;
    let pick = s[s.length - 1];                      // before the first block = the last one, wrapped
    for (let i = 0; i < s.length; i++) {
      const blk = s[i];
      const to = blk.to != null ? blk.to : (i + 1 < s.length ? s[i + 1].from : s[0].from + 24);
      if (blk.from <= to ? (h >= blk.from && h < to) : (h >= blk.from || h < to)) { pick = blk; break; }
      if (h >= blk.from) pick = blk;
    }
    return pick;
  }
  function needsDecay(b, dt) {
    const N = b.needs, L = N.levels, R = N.rates;
    for (const k in R) L[k] = clamp01((L[k] == null ? 0.8 : L[k]) - R[k] * dt);
  }
  function needsDrive(actor, id, delta) {
    const b = of(actor);
    if (!b.needs) b.needs = { levels: {}, rates: {}, t: now() };
    const L = b.needs.levels;
    L[id] = clamp01((L[id] == null ? 0.8 : L[id]) + (delta || 0));
    return L[id];
  }
  function needsTop(actor) {
    const b = actor && actor._brain;
    if (!b || !b.needs) return null;
    const L = b.needs.levels;
    let best = null, bv = 0.5;
    for (const k in L) if (L[k] < bv) { bv = L[k]; best = k; }
    return best;
  }
  const needs = {
    define: needsDefine, current: needsCurrent, drive: needsDrive, top: needsTop, hour: hourNow,
    level: function (a, id) { const b = a && a._brain; return b && b.needs && b.needs.levels[id] != null ? b.needs.levels[id] : null; },
  };

  /* ================================================================ SOCIAL */
  const ATT = Object.create(null);
  function attKey(a, b) { return a + "|" + b; }
  function factionOf(x) { return x == null ? null : typeof x === "string" ? x : (x._brain ? x._brain.faction : (x.isPlayer || x === CBZ.player ? "player" : x.faction || null)); }
  function setAttitude(fa, fb, v, oneWay) {
    ATT[attKey(fa, fb)] = clamp(v, -1, 1);
    if (!oneWay) ATT[attKey(fb, fa)] = clamp(v, -1, 1);
  }
  function attitude(a, b) {
    const fa = factionOf(a), fb = factionOf(b);
    if (fa == null || fb == null) return 0;
    const v = ATT[attKey(fa, fb)];
    if (v != null) return v;
    if (fa !== fb) return 0;
    // same side: 1, unless the ARCHETYPE says its own kind is no family
    // (inmate selfAttitude 0.2: one inmate will report another)
    const A = a && typeof a === "object" && a._brain ? a._brain.arch : null;
    return A && A.selfAttitude != null ? A.selfAttitude : 1;
  }
  setAttitude("police", "gang", -0.6);
  setAttitude("civilians", "police", 0.3);
  setAttitude("civilians", "gang", -0.2);
  setAttitude("inmates", "guards", -0.4);
  setAttitude("ffa", "ffa", -1);
  setAttitude("detail", "civilians", 0.2);
  setAttitude("police", "detail", 0.6);

  const LEADERS = Object.create(null);
  function setLeader(clique, actor) {
    const prev = LEADERS[clique];
    if (prev && prev._brain) prev._brain.leader = false;
    LEADERS[clique] = actor;
    if (actor) of(actor).leader = true;
  }
  const _mates = [];
  function cliqueMates(actor, radius) {
    _mates.length = 0;
    const b = actor && actor._brain;
    if (!b || b.clique == null) return _mates;
    const list = near(ax(actor), az(actor), radius == null ? 20 : radius, _nearQ);
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === b || o.clique !== b.clique || isDead(o.actor)) continue;
      _mates.push(o.actor);
    }
    return _mates;
  }
  const _nearQ = [];

  /* WITNESSES. A superset of city/peds.js cityTagWitnesses + the prison's
     detection.js witness reports: everyone who could SEE the spot (cone,
     range, walls) or HEAR it (loud kinds) becomes a witness, picks a response
     from personality x archetype, and the reporters phone it in after a beat
     (3-12 s) — during which the player can still stop it (kill, intimidate,
     bribe: social.silence). */
  const LOUD = { shooting: 48, gunshot: 48, explosion: 120, murder: 0, stabbing: 8, assault: 12, fight: 12, brawl: 12, theft: 0, mugging: 6, vandalism: 10, carjacking: 10 };
  const RESP = ["flee", "film", "report", "intervene", "cower", "ignore", "cheer"];
  const _wW = [0, 0, 0, 0, 0, 0, 0];
  const pending = [];              // witness brains with a report coming
  const reportSubs = [];           // { game, fn }
  const _wit = [];
  function isAuthority(b) { return !!b.arch.authority; }
  function pickWitness(b, sev, d, perp) {
    const W0 = b.arch.witness, p = b.personality;
    const friendly = perp ? attitude(b.actor, perp) : 0;
    const fear = perp && factionOf(perp) === "player" ? rep.get(b.faction).fear : 0;
    const close = clamp01(1 - d / 25);
    let sum = 0;
    for (let i = 0; i < RESP.length; i++) {
      const k = RESP[i];
      let w = W0[k] || 0;
      if (k === "flee") w *= (0.6 + (1 - p.courage) * 0.8) * (0.6 + sev * 0.8 + close * 0.5);
      else if (k === "cower") w *= (0.5 + (1 - p.courage) + fear) * (0.5 + sev);
      else if (k === "film") w *= (0.4 + p.curiosity + p.courage * 0.4) * (1.2 - close * 0.6);
      else if (k === "report") w *= (0.5 + p.discipline * 0.5 + p.loyalty * 0.3) * (1 - fear * 0.6) * (friendly > 0.5 ? 0.1 : 1);
      else if (k === "intervene") w *= (0.3 + p.courage * 0.7 + p.aggression * 0.4) * (friendly > 0.5 ? 0.2 : 1);
      else if (k === "ignore") w *= (1.3 - sev) * (1 + Math.max(0, friendly));
      else if (k === "cheer") w *= (0.3 + p.aggression) * (friendly > 0 ? 1.5 : 0.5);
      _wW[i] = Math.max(0, w); sum += _wW[i];
    }
    if (sum <= 0) return "ignore";
    let r = rng() * sum;
    for (let i = 0; i < RESP.length; i++) { r -= _wW[i]; if (r <= 0) return RESP[i]; }
    return "ignore";
  }
  function crime(kind, x, z, perp, severity, opts) {
    opts = opts || {};
    const sev = clamp01(severity == null ? 0.5 : severity);
    // an unknown kind makes the noise its violence makes (shouts, screams)
    const loud = opts.loud != null ? opts.loud : (LOUD[kind] != null ? LOUD[kind] : Math.round(sev * 14));
    const sight = opts.sightRange != null ? opts.sightRange : 30;
    const R = Math.max(sight, loud * 1.5);
    const list = near(x, z, R, _wit);
    const t = now();
    const perpIsPlayer = perp && factionOf(perp) === "player";
    // the crime's own fields ride every report it produces (one copy per crime,
    // because callers reuse their opts object)
    let snap = null;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i], a = b.actor;
      if (a === perp || blind(a)) continue;
      const d = Math.hypot(ax(a) - x, az(a) - z);
      let saw = d <= sight && seesPoint(a, x, opts.y || 0, z, { range: Math.min(sight, b.arch.viewDist * 1.5) });
      if (!saw && a === opts.victim) saw = true;
      let heardIt = false;
      if (!saw && loud > 0) {
        const r = loud * (b.arch.hearMul || 1);
        heardIt = d <= r && (d <= r * 0.5 || !occluded(x, 1.2, z, ax(a), ay(a) + 1.5, az(a), b.game));
      }
      if (!saw && !heardIt) continue;
      if (!snap) { snap = {}; for (const k in opts) snap[k] = opts[k]; }
      // a witness who only HEARD it knows where, not who
      const w = witnessRec(b);
      if (w.reportAt != null && !w.reported && w.severity > sev) continue;   // keeps the WORST thing they saw
      w.kind = kind; w.x = x; w.z = z; w.perp = saw ? perp : null; w.severity = sev; w.t = t;
      w.saw = saw; w.cancelled = false; w.reported = false; w.game = opts.game || null; w.opts = snap;
      w.response = a === opts.victim ? (b.personality.courage > 0.6 ? "intervene" : "flee") : pickWitness(b, sev, d, perp);
      if (perp && saw) memSee(a, perp);
      hear(a, x, z, kind, perp, d, t);
      // who phones it in, and when
      let pr = w.response === "report" ? 1 : w.response === "film" ? 0.5 : w.response === "flee" ? 0.35
        : w.response === "intervene" ? (isAuthority(b) ? 1 : 0.25) : w.response === "cower" ? 0.1 : 0;
      if (a === opts.victim) pr = Math.max(pr, 0.8);
      if (perpIsPlayer) pr *= 1 - rep.get(b.faction).fear * 0.6;
      if (opts.noReport || attitude(a, perp) > 0.5) pr = 0;
      // the game's own say on who talks (a snitch trait, the yard's code, a
      // neighbourhood): a multiplier, per game or global
      if (pr > 0) {
        const bf = (b.game != null && BIAS[b.game]) || BIAS["*"];
        if (bf) {
          _cInfo.kind = kind; _cInfo.x = x; _cInfo.z = z; _cInfo.perp = perp; _cInfo.severity = sev; _cInfo.opts = snap; _cInfo.saw = saw;
          const m = +bf(a, _cInfo);
          if (m >= 0) pr *= m;
        }
      }
      if (pr > 0 && rng() < Math.min(1, pr)) {
        const delay = isAuthority(b) ? 0.6 + rng() * 1.2                   // a radio
          : w.response === "flee" ? 6 + rng() * 6                           // once they're clear
            : 3 + rng() * 6;                                                // dialling / walking to a cop
        w.reportAt = t + (opts.instant ? 0 : delay);
        if (pending.indexOf(b) < 0) pending.push(b);
        // a reporter with an officer in sight walks up to him (city peds'
        // beginReport); otherwise it is a phone call from where he stands
        w.toAuth = isAuthority(b) ? null : nearestAuthority(ax(a), az(a), 40, b);
      } else { w.reportAt = null; w.toAuth = null; }
      // a witnessed killing frightens the whole street a little more of you
      if (perpIsPlayer && sev >= 0.7) rep.get(b.faction).fear = clamp01(rep.get(b.faction).fear + 0.01);
      n++;
    }
    return n;
  }
  function witnessRec(b) {
    return b.witness || (b.witness = { kind: null, x: 0, z: 0, perp: null, severity: 0, t: 0, response: null, reportAt: null,
      saw: false, cancelled: false, reported: false, game: null, opts: null, toAuth: null });
  }
  const BIAS = Object.create(null);
  const _cInfo = { kind: null, x: 0, z: 0, perp: null, severity: 0, opts: null, saw: false };
  function setReportBias(fn, game) {
    const k = game != null ? game : "*";
    if (typeof fn === "function") BIAS[k] = fn; else delete BIAS[k];
  }
  // one report, to every subscriber of its game. heat / type ride on top
  // of report.opts untouched (wanted.js and detection.js read them).
  function dispatch(b, w, t) {
    w.reported = true;
    const o = w.opts;
    const rep0 = { kind: w.kind, x: w.x, z: w.z, perp: w.perp, severity: w.severity, witness: b.actor, t: t, response: w.response,
      game: w.game || b.game, opts: o, heat: o ? o.heat : undefined, type: o ? o.type : undefined };
    const gm = w.game || b.game;
    for (let s = 0; s < reportSubs.length; s++) {
      const sub = reportSubs[s];
      if (sub.game && sub.game !== "*" && gm && sub.game !== gm) continue;
      try { sub.fn(rep0); } catch (e) { if (typeof console !== "undefined") console.error("[brain] onReport", e); }
    }
    return rep0;
  }
  function dropPending(b) { const k = pending.indexOf(b); if (k >= 0) { pending[k] = pending[pending.length - 1]; pending.pop(); } }
  // FILE IT NOW: the witness reached the officer (prison: walked to a screw).
  function fileNow(witness) {
    const b = witness && witness._brain, w = b && b.witness;
    if (!w || w.reported || w.cancelled || w.reportAt == null || reportBlocked(witness)) return false;
    dropPending(b);
    dispatch(b, w, now());
    return true;
  }
  // HOLD IT: the report waits (reportAt = Infinity) until fileNow or silence
  function holdReport(witness) {
    const b = witness && witness._brain, w = b && b.witness;
    if (!w || w.reported || w.cancelled || w.reportAt == null) return false;
    w.reportAt = Infinity;
    return true;
  }
  // A LONE ACCUSER: a grudge-holder going to the law about a man, no crime
  // event needed. opts: { delay (s, default 0 = files now), x, z, game, ...any }
  function accuse(witness, perp, kind, severity, opts) {
    if (!witness || reportBlocked(witness)) return false;
    opts = opts || {};
    const b = of(witness), w = witnessRec(b);
    const snap = {}; for (const k in opts) snap[k] = opts[k];
    w.kind = kind || "accusation"; w.perp = perp || null; w.severity = clamp01(severity == null ? 0.5 : severity);
    w.x = opts.x != null ? opts.x : (perp ? ax(perp) : ax(witness)); w.z = opts.z != null ? opts.z : (perp ? az(perp) : az(witness));
    w.t = now(); w.saw = true; w.cancelled = false; w.reported = false; w.response = "report";
    w.game = opts.game || null; w.opts = snap; w.toAuth = null;
    w.reportAt = w.t + (opts.delay || 0);
    if (!(opts.delay > 0)) { dispatch(b, w, w.t); return true; }
    if (pending.indexOf(b) < 0) pending.push(b);
    return true;
  }
  const _authBuf = [];
  function nearestAuthority(x, z, r, self) {
    const list = near(x, z, r, _authBuf);
    let best = null, bd = 1e18;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === self || !o.arch.authority || blind(o.actor)) continue;
      const d = (ax(o.actor) - x) * (ax(o.actor) - x) + (az(o.actor) - z) * (az(o.actor) - z);
      if (d < bd) { bd = d; best = o.actor; }
    }
    return best;
  }
  function reportBlocked(a) {
    return a.dead || a.ko > 0 || a.tied || a.cuffed || a.bribed > 0 || a.intimidMode === "scared" || (a.hp != null && a.maxHp && a.hp <= 0);
  }
  let lastPumpT = -1;
  function pumpReports() {
    if (!pending.length) return;
    const t = now();
    lastPumpT = t;
    for (let i = pending.length - 1; i >= 0; i--) {
      const b = pending[i], w = b.witness;
      if (!w || w.reportAt == null || w.reported) { pending[i] = pending[pending.length - 1]; pending.pop(); continue; }
      if (reportBlocked(b.actor) || w.cancelled) {
        w.reportAt = null; w.cancelled = true;
        pending[i] = pending[pending.length - 1]; pending.pop();
        continue;
      }
      if (t < w.reportAt) continue;
      pending[i] = pending[pending.length - 1]; pending.pop();
      dispatch(b, w, t);
    }
  }
  function onReport(game, fn) {
    if (typeof game === "function") { fn = game; game = "*"; }
    const sub = { game: game || "*", fn: fn };
    reportSubs.push(sub);
    return function () { const i = reportSubs.indexOf(sub); if (i >= 0) reportSubs.splice(i, 1); };
  }
  function silence(witness, how) {
    const b = witness && witness._brain;
    if (!b || !b.witness || b.witness.reported) return false;
    const had = b.witness.reportAt != null;
    b.witness.reportAt = null; b.witness.cancelled = true; b.witness.silencedBy = how || "silenced";
    return had;
  }

  /* RETALIATION — proportional. The prison's clique rule, stated once: harm
     sets the CEILING (a slap never gets a shank), grudge + aggression +
     loyalty climb toward it, courage decides whether a man joins at all. */
  const LEVELS = ["glare", "shove", "fight", "weapon"];
  /* AGAINST A GUNMAN the ladder is capped by what each man HOLDS (threat.
     capability): a man with a gun answers with it ("weapon") or watches
     ("glare"); a blade answers only inside its window (close, and the gun is
     being reloaded or pointed elsewhere); everyone else AVOIDS — out of his
     line, watching from cover. The grudge is booked either way: it keeps. */
  const AVOID = "avoid";
  const _ret = [];
  const _retPool = [];
  const _rth = { source: null, x: 0, z: 0, distance: null, reloading: false, facingAway: null, yaw: null, rushRange: 0, armed: true, kind: "armed" };
  function retaliate(victim, aggressor, harm, opts) {
    for (let i = 0; i < _ret.length; i++) _retPool.push(_ret[i]);
    _ret.length = 0;
    harm = clamp01(harm == null ? 0.3 : harm);
    grudge(victim, aggressor, 0.2 + harm * 0.6);
    const vb = victim && victim._brain;
    if (!vb || vb.clique == null) return _ret;
    const ceil = harm < 0.3 ? 1 : harm < 0.6 ? 2 : 3;     // index into LEVELS
    const aw = (opts && opts.weapon) || capability(aggressor);
    if (aw === "gun") {
      _rth.source = aggressor; _rth.x = ax(aggressor); _rth.z = az(aggressor); _rth.distance = null;
      _rth.reloading = !!(opts && opts.reloading);
      _rth.facingAway = opts && opts.facingAway != null ? !!opts.facingAway : null;
      _rth.yaw = opts && opts.yaw != null ? opts.yaw : null;
      _rth.rushRange = (opts && opts.rushRange) || 0;
    }
    const mates = cliqueMates(victim, 18);
    for (let i = 0; i < mates.length; i++) {
      const m = mates[i], b = m._brain;
      if (m === aggressor || blind(m)) continue;
      const p = b.personality;
      const g = Math.max(0, grudge(m, aggressor, 0.1 + harm * 0.4));
      if (p.courage + p.loyalty * 0.5 < 0.35 + harm * 0.3 && harm >= 0.6) continue;   // too scared to join a knife fight
      const score = harm * 0.8 + g * 0.35 + p.aggression * 0.3 + p.loyalty * 0.2 - (1 - p.courage) * 0.15;
      let lvl = score < 0.35 ? 0 : score < 0.6 ? 1 : score < 0.85 ? 2 : 3;
      if (lvl > ceil) lvl = ceil;
      let level = LEVELS[lvl];
      if (aw === "gun") {
        const my = capability(m);
        if (my === "gun") level = lvl >= 2 ? "weapon" : "glare";
        else if (!(my === "melee" && lvl >= 2 && canRush(m, _rth))) level = AVOID;
      }
      const r = b.retaliation || (b.retaliation = { target: null, level: null, t: 0, victim: null });
      r.target = aggressor; r.level = level; r.t = now(); r.victim = victim;
      const e = _retPool.pop() || { actor: null, level: null };
      e.actor = m; e.level = level;
      _ret.push(e);
    }
    _rth.source = null;
    return _ret;
  }

  const social = {
    faction: function (a) { return factionOf(a); },
    setAttitude: setAttitude, attitude: attitude,
    clique: function (a) { return a && a._brain ? a._brain.clique : null; },
    cliqueMates: cliqueMates, crime: crime, onReport: onReport, retaliate: retaliate,
    silence: silence, cancelReport: silence, fileNow: fileNow, holdReport: holdReport, accuse: accuse,
    setReportBias: setReportBias, setLeader: setLeader, leader: function (c) { return LEADERS[c] || null; },
    pending: function () { return pending.length; },
    LEVELS: LEVELS, LOUD: LOUD, AVOID: AVOID,
  };

  /* ================================================================ MORALE
     EXACT PORTS FIRST (so warlord/battle.js and games/battle.html become thin
     callers with byte-identical numbers), then the generic group morale every
     other game gets (inmate cliques, gangs, survivors) built from the same
     parts. */
  // ---- warlord/battle.js (the original)
  const WK = { NERVE_FALLBACK: { civ: 0.62, thug: 0.42, guard: 0.30, soldier: 0.20 }, RALLY: 0.14 };
  function fromLosses(o) {
    let mo = 1 - o.lost * 1.6 + o.theirLost * 0.55;
    if (o.leader) mo += o.leaderDown ? -0.30 : (o.leaderNear ? 0.16 : 0);
    mo -= o.malus || 0;
    mo -= clamp(o.routingFrac, 0, 1) * 0.25;   // men watch men run
    return clamp(mo, 0, 1);
  }
  function nerveOf(cq) {
    const R = CBZ.combatIQ && CBZ.combatIQ.ROLE && CBZ.combatIQ.ROLE[cq];
    return (R && R.nerve != null) ? R.nerve : (WK.NERVE_FALLBACK[cq] || 0.4);
  }
  function brokenSide(side, fled) {
    if (side.men0.length <= 2) return false;
    const fighting = side.alive - side.routing;
    const gone = side.deadN + side.routing + fled;
    return fighting <= Math.max(1, Math.floor(side.men0.length * 0.1)) &&
      gone >= side.men0.length * 0.3;
  }
  // stepRout's break/rally with its 0.14 hysteresis band. Returns m.routed.
  function stepRout(m, sideMorale, nerve) {
    if (!m.routed) { if (sideMorale < nerve) { m.routed = true; return true; } }
    else if (sideMorale > nerve + WK.RALLY) m.routed = false;
    return m.routed;
  }
  // ---- games/battle.html (the port with rattle and wounds)
  const MK = {
    NERVE_FALLBACK: { civ: 0.62, thug: 0.42, pro: 0.30, elite: 0.20, swat: 0.16 },
    TIER_W: { civ: 0.7, thug: 0.85, pro: 1.0, elite: 1.25, swat: 1.4 },
    SUPP_CAP: 1.2, SUPP_HIT: 0.4, SUPP_SNAP: 0.26, SUPP_MATE: 0.22, SUPP_DECAY: 0.28,
    SUPP_K: 0.16, WOUND_K: 0.28, SHOCK_K: 1.8, SHOCK_TAU: 7, RALLY_BAND: 0.16,
    FLEE_GAPS: 2.2, BREAK_GRACE: 5,
  };
  function nerveFor(tier, i) {
    const R = CBZ.combatIQ && CBZ.combatIQ.ROLE && CBZ.combatIQ.ROLE[tier];
    const base = (R && R.nerve != null) ? R.nerve : (MK.NERVE_FALLBACK[tier] != null ? MK.NERVE_FALLBACK[tier] : 0.3);
    return base + (((i * 37) % 11) - 5) * 0.012;
  }
  function manMorale(army, supp, hf) { return army - (supp || 0) * MK.SUPP_K - (1 - hf) * MK.WOUND_K; }
  function deathShock(A, w) { if (A.p0 > 0) A.shock += MK.SHOCK_K * (w || 1) / A.p0; }
  // one army's block of battle.html updateMorale(): shock decay, the formula,
  // the latched break and the rally. A/F carry { p0, pNow, alive, routing,
  // shock, morale, broken }. Returns "rout" | "rally" | null.
  function armyStep(A, F, dt, opts) {
    A.shock *= Math.exp(-dt / MK.SHOCK_TAU);
    const lost = A.p0 > 0 ? Math.max(0, 1 - A.pNow / A.p0) : 0;
    const theirLost = F && F.p0 > 0 ? Math.max(0, 1 - F.pNow / F.p0) : 0;
    let mo = 1 - lost * 1.5 + theirLost * 0.5 - (A.alive ? A.routing / A.alive : 0) * 0.35 - A.shock;
    if (opts && opts.fearless) mo = 1;
    A.morale = Math.max(0, Math.min(1, mo));
    if (!A.broken && A.alive >= 2 && A.routing >= A.alive * 0.5) { A.broken = true; return "rout"; }
    if (A.broken && A.alive - A.routing > 0 && A.routing < A.alive * 0.25) { A.broken = false; return "rally"; }
    return null;
  }

  // ---- THE GENERIC GROUP (brain-registered actors)
  // battle.html's formula plus warlord's leader term, with one guard for small
  // groups: a single death's shock is capped (shockCap) so a clique of six is
  // not an army of six hundred. Every constant is overridable per group.
  const GROUPS = Object.create(null);
  const groupList = [];
  const GDEF = { lostK: 1.5, theirK: 0.5, routK: 0.35, leaderDownK: 0.25, leaderNearK: 0, shockK: MK.SHOCK_K, shockCap: 0.15, shockTau: MK.SHOCK_TAU };
  function groupIdOf(b) { return b.group != null ? b.group : b.clique != null ? b.clique : null; }
  function group(id) {
    let G = GROUPS[id];
    if (!G) {
      G = GROUPS[id] = { id: id, morale: 1, shock: 0, alive: 0, routing: 0, men0: 0, p0: 0, pNow: 0, dead: 0,
        leaderDown: false, malus: 0, broken: false, foe: null, members: [], ghosts: [], tickT: null, k: {} };
      for (const k in GDEF) G.k[k] = GDEF[k];
      groupList.push(G);
    }
    return G;
  }
  function moraleJoin(id, b) {
    const G = group(id);
    b._gid = id;
    if (G.members.indexOf(b) >= 0) return;
    G.members.push(b);
    // A RECYCLED BODY: the same actor object left this group dead (his share
    // stayed in p0 as a loss) and is back as a new man. He refills his old
    // slot; the starting size does not grow.
    const gi = G.ghosts.indexOf(b.actor);
    if (gi >= 0) { G.ghosts[gi] = G.ghosts[G.ghosts.length - 1]; G.ghosts.pop(); return; }
    G.men0++; G.p0 += b.arch.moraleK || 1;
  }
  // leaving a group ALIVE (despawned, re-grouped) takes his share of p0 with
  // him, so a crowd streaming out of range is not read as casualties; a dead
  // man's share stays, because the loss is real (remembered as a ghost, so a
  // recycled body does not count twice).
  function moraleLeave(b) {
    const id = b._gid;
    b._gid = null;
    const G = id != null ? GROUPS[id] : null;
    if (!G) return;
    const i = G.members.indexOf(b);
    if (i < 0) return;
    G.members[i] = G.members[G.members.length - 1]; G.members.pop();
    if (!isDead(b.actor)) { G.men0 = Math.max(0, G.men0 - 1); G.p0 = Math.max(0, G.p0 - (b.arch.moraleK || 1)); }
    else if (G.ghosts.indexOf(b.actor) < 0) G.ghosts.push(b.actor);
  }
  // EMPTY A GROUP (a new match, a new crowd). Its config (morale.config) is
  // kept; members are released, every count and the ghosts go.
  function moraleClear(id) {
    const G = GROUPS[id];
    if (!G) return null;
    for (let i = 0; i < G.members.length; i++) if (G.members[i]._gid === id) G.members[i]._gid = null;
    G.members.length = 0; G.ghosts.length = 0;
    G.men0 = 0; G.p0 = 0; G.pNow = 0; G.dead = 0; G.alive = 0; G.routing = 0;
    G.shock = 0; G.morale = 1; G.broken = false; G.leaderDown = false; G.tickT = null;
    return G;
  }
  function recompute(G) {
    let alive = 0, routing = 0, pNow = 0;
    for (let i = 0; i < G.members.length; i++) {
      const b = G.members[i], a = b.actor;
      if (isDead(a) || a.fled) continue;
      alive++;
      if (b.routed) routing++;
      pNow += (b.arch.moraleK || 1) * (0.45 + 0.55 * hpFrac(a));
    }
    G.alive = alive; G.routing = routing; G.pNow = pNow;
    const F = G.foe != null ? GROUPS[G.foe] : null;
    const K = G.k;
    const lost = G.p0 > 0 ? Math.max(0, 1 - pNow / G.p0) : 0;
    const theirLost = F && F.p0 > 0 ? Math.max(0, 1 - F.pNow / F.p0) : 0;
    let mo = 1 - lost * K.lostK + theirLost * K.theirK - (alive ? routing / alive : 0) * K.routK - G.shock - G.malus;
    if (G.leaderDown) mo -= K.leaderDownK;
    G.morale = clamp01(mo);
    return G;
  }
  /* IDEMPOTENT PER CLOCK STAMP. The prison ticks morale at 4 Hz, the city and
     the survivors call it too; a second call on the same stamp (brain.now())
     is a no-op for every group it already ticked, so nothing drains twice.
     tick(dt, groupId) ticks ONE group. With no driven clock (no clock(), no
     CBZ.game.elapsed) there is no stamp to key on and every call counts. */
  function clockDriven() { return clockSet || !!(CBZ.game && typeof CBZ.game.elapsed === "number"); }
  function memTickedRecently(b) {
    if (b._memAt == null) return false;
    return clockDriven() ? now() - b._memAt <= 1 : b._memT === frame;
  }
  function tickGroup(G, dt, s, driven) {
    if (driven && G.tickT === s) return false;
    G.tickT = s;
    G.shock *= Math.exp(-(dt || 0) / G.k.shockTau);
    recompute(G);
    if (!G.broken && G.alive >= 2 && G.routing >= G.alive * 0.5) G.broken = true;
    else if (G.broken && G.alive - G.routing > 0 && G.routing < G.alive * 0.25) G.broken = false;
    return true;
  }
  // the rattle drains here only for brains nobody memory.tick()s (memTick
  // owns it for the rest), once per stamp
  function drainRattle(b, dt, s, driven) {
    if (b.rattle <= 0 || memTickedRecently(b)) return;
    if (driven && b.rattleAt === s) return;
    b.rattleAt = s;
    b.rattle = Math.max(0, b.rattle - MK.SUPP_DECAY * (dt || 0));
  }
  function moraleTick(dt, groupId) {
    const s = now(), driven = clockDriven();
    if (groupId != null) {
      const G = GROUPS[groupId];
      if (!G || !tickGroup(G, dt, s, driven)) return G || null;
      for (let i = 0; i < G.members.length; i++) drainRattle(G.members[i], dt, s, driven);
      return G;
    }
    for (let i = 0; i < groupList.length; i++) tickGroup(groupList[i], dt, s, driven);
    for (let i = 0; i < registered.length; i++) drainRattle(registered[i], dt, s, driven);
    return null;
  }
  function moraleHit(id, amt) { const G = group(id); G.shock = Math.max(0, G.shock + (amt || 0)); recompute(G); return G; }
  function moraleDeath(id, actor) {
    const G = group(id);
    const b = actor && actor._brain;
    const w = b ? (b.arch.moraleK || 1) : 1;
    if (G.p0 > 0) G.shock += Math.min(G.k.shockCap, G.k.shockK * w / G.p0);
    G.dead++;
    if (b && (b.leader || (b.clique != null && LEADERS[b.clique] === actor))) G.leaderDown = true;
    // the man next to him feels it most (battle.html moraleOnDeath)
    if (actor) {
      const list = near(ax(actor), az(actor), 7, _nearQ);
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o.actor === actor || isDead(o.actor) || groupIdOf(o) !== id) continue;
        o.rattle = Math.min(MK.SUPP_CAP, o.rattle + MK.SUPP_MATE);
      }
    }
    recompute(G);
    return G;
  }
  function rattle(actor, amt) { const b = of(actor); b.rattle = Math.min(MK.SUPP_CAP, Math.max(0, b.rattle + (amt == null ? MK.SUPP_HIT : amt))); return b.rattle; }
  // a person's nerve: combat_iq's column for his cq, pushed by his courage
  function nerve(actor) {
    const b = of(actor);
    if (b.nerveAbs != null) return b.nerveAbs;             // register({ nerve }) — the game's own number
    const base = b.arch.nerve != null ? b.arch.nerve : nerveOf(b.arch.cq);
    return clamp(base + (0.5 - b.personality.courage) * 0.5 + b.nerveJ, 0.05, 0.95);
  }
  function moraleOf(actor) {
    const b = of(actor);
    const id = groupIdOf(b);
    const G = id != null ? GROUPS[id] : null;
    return manMorale(G ? G.morale : 1, b.rattle, hpFrac(actor));
  }
  // latched with battle.html's hysteresis: break under nerve, rally over
  // nerve + RALLY_BAND once the rattle has worn off
  function broken(actor) {
    const b = of(actor);
    if (b.arch.fearless) return false;
    const eff = moraleOf(actor), nv = nerve(actor);
    if (!b.routed) {
      if (b.rallyT <= 0 && eff < nv) b.routed = true;
    } else if (eff > nv + MK.RALLY_BAND && b.rattle < 0.3) { b.routed = false; b.rallyT = 6; }
    return b.routed;
  }
  const morale = {
    group: group, hit: moraleHit, death: moraleDeath, rattle: rattle, of: moraleOf, broken: broken, tick: moraleTick,
    nerve: nerve, clear: moraleClear,
    config: function (id, k) { const G = group(id); for (const j in k) { if (j === "foe") G.foe = k[j]; else if (j === "malus") G.malus = k[j]; else G.k[j] = k[j]; } return G; },
    fromLosses: fromLosses, brokenSide: brokenSide, stepRout: stepRout, nerveOf: nerveOf,
    armyStep: armyStep, deathShock: deathShock, manMorale: manMorale, nerveFor: nerveFor,
    K: MK, W: WK,
  };

  /* ================================================================ THREAT */
  function assess(actor, th) {
    const b = of(actor), out = b.assessR;
    if (!th) { out.level = 0; out.kind = null; return out; }
    const d = th.distance != null ? th.distance : Math.hypot(th.x - ax(actor), th.z - az(actor));
    const kind = th.kind || (th.armed ? "armed" : "unarmed");
    const reach = th.armed ? 35 : kind === "explosion" ? 60 : kind === "gunshot" ? 48 : 7;
    let lv = clamp01(1 - d / reach);
    if (kind === "gunshot") lv = Math.max(lv, 0.45);
    if (kind === "explosion" || kind === "hazard") lv = Math.max(lv, 0.6);
    if (th.armed) lv += 0.25;
    if (th.aimingAtMe) lv += 0.35;
    lv += (1 - hpFrac(actor)) * 0.2;
    out.level = clamp01(lv); out.kind = kind;
    return out;
  }
  const _allies = [];
  function alliesNear(actor, r) {
    const b = actor._brain;
    const list = near(ax(actor), az(actor), r, _allies);
    let n = 0;
    for (let i = 0; i < list.length; i++) { const o = list[i]; if (o !== b && o.faction === b.faction && !blind(o.actor)) n++; }
    return n;
  }
  /* ---------------------------------------------------------------- CAPABILITY
     OWNER, 2026-09-27: "I get a keycard, go into the jail room, get guns, and
     EVERYBODY charges me while I'm shooting. Not everybody should be charging
     at me. That's stupid logic... unless they had a gun. Or short range, if
     they have a knife, maybe they'll come at me if they're already close."

     What a man is HOLDING decides whether fighting a gunman is even on his
     menu — not his grudge, not his clique, not his temperament:
       "gun"    engages from range, and gets into cover first
       "melee"  (knife, shank, bat) rushes a gunman ONLY when already inside
                RUSH_R and the gunman is reloading or looking away (>90 deg);
                otherwise he is as unarmed as the rest
       "none"   never closes on a gun: flees (away, out of his sight), takes
                cover, hides, goes flat, puts his hands up; freezes when he is
                cornered. His grudge is kept for later.
     capability(actor) reads the fields every game already has (hasGun,
     armed + weapon, a holstered gun, _shankOut, loadout items); a game adds
     what the core cannot see (the PLAYER's weapon) with setCapability(fn). */
  const RUSH_R = 3.5;          // m: a blade inside this is a real bet against a gun
  const DWELL = 3;             // s: a yield (flee/freeze/surrender) or a fight is held this long
  const COVER_FIRST = 1.2;     // s: an armed man gets into cover before he fires
  const MELEE_RE = /knife|shank|shiv|blade|bat\b|machete|club|baton|pipe|crowbar|axe|hammer|brass|melee|sword|bottle/i;
  const capFns = [];
  function setCapability(fn, game) {
    for (let i = 0; i < capFns.length; i++) if (capFns[i].game === (game || "*")) { capFns[i].fn = fn; return; }
    if (fn) capFns.push({ fn: fn, game: game || "*" });
  }
  function weaponWord(w) {
    if (!w) return null;
    if (typeof w === "object") return w.melee ? (w.id === "fists" || w.key === "fists" ? "none" : "melee") : "gun";
    const s = String(w);
    if (/^fists?$/i.test(s)) return "none";
    return MELEE_RE.test(s) ? "melee" : "gun";
  }
  const MELEE_ITEMS = ["Shiv", "Shank", "Knife", "Brass Knuckles", "Baton", "Bat", "Machete"];
  function capability(a) {
    if (!a || typeof a !== "object") return "none";
    const b = a._brain;
    for (let i = 0; i < capFns.length; i++) {
      const c = capFns[i];
      // a game's reader answers for its own brains and for bodies with no
      // brain at all (the player); it returns null for anything not its own
      if (c.game !== "*" && b && b.game !== c.game) continue;
      let r = null;
      try { r = c.fn(a); } catch (e) { r = null; }
      if (r) return r;
    }
    if (b && b.weapon) return b.weapon;
    if (a.hasGun) return "gun";
    if (a._holster && a._holster.weapon) return weaponWord(a._holster.weapon) || "gun";   // a holstered gun is still a gun
    if (a.armed) return weaponWord(a.weapon) || "gun";
    const ww = weaponWord(a.weapon);
    if (ww) return ww;
    if (a._shankOut || a.shank || a.knife) return "melee";
    const it = a.loadout && a.loadout.items;
    if (it) for (let i = 0; i < MELEE_ITEMS.length; i++) if (it.indexOf(MELEE_ITEMS[i]) >= 0) return "melee";
    // a body that exposes no weapon fields at all takes its kind's default
    // (a screw, a cop, an agent, a soldier carries); one that does is empty
    if (b && b.arch.weapon && !("armed" in a) && !("hasGun" in a) && !("weapon" in a)) return b.arch.weapon;
    return "none";
  }
  // what the THREAT carries: th.weapon when the game says, a gunshot is a gun,
  // else the source's own capability, else the legacy th.armed (= a gun)
  function threatWeapon(th) {
    if (th.weapon) return th.weapon;
    if (th.kind === "gunshot") return "gun";
    if (th.kind === "explosion" || th.kind === "hazard") return "hazard";
    if (th.source && typeof th.source === "object") {
      const c = capability(th.source);
      if (c !== "none") return c;
    }
    return th.armed ? "gun" : "none";
  }
  // is the shooter looking AWAY from this man (more than 90 degrees off)?
  function facingAway(actor, th) {
    if (th.facingAway != null) return !!th.facingAway;
    let yaw = th.yaw;
    const s = th.source;
    if (yaw == null && s && typeof s === "object" && (s.yaw != null || s.group)) yaw = yawOf(s);
    if (yaw == null) return false;
    const sx = th.x != null ? th.x : ax(s), sz = th.z != null ? th.z : az(s);
    const dx = ax(actor) - sx, dz = az(actor) - sz;
    return Math.sin(yaw) * dx + Math.cos(yaw) * dz < 0;
  }
  function distTo(actor, th) {
    if (th.distance != null) return th.distance;
    const sx = th.x != null ? th.x : (th.source ? ax(th.source) : ax(actor));
    const sz = th.z != null ? th.z : (th.source ? az(th.source) : az(actor));
    return Math.hypot(sx - ax(actor), sz - az(actor));
  }
  // THE KNIFE'S WINDOW. Close, and the gun is not on him right now.
  function canRush(actor, th) {
    if (capability(actor) !== "melee") return false;
    const b = of(actor), p = b.personality;
    if (hpFrac(actor) < 0.3) return false;
    if (distTo(actor, th) > (th.rushRange || RUSH_R)) return false;
    if (!(th.reloading || facingAway(actor, th))) return false;
    return p.aggression * 0.55 + p.courage * 0.45 >= 0.42;
  }

  // the scorer lives at module scope: respond() runs per frame under fire,
  // and a closure per call is an allocation per call
  let rBest = "ignore", rScore = -1e9, rBias = null, rHowBest = null;
  function score(k, v, how) { v += (rBias && rBias[k]) || 0; if (v > rScore) { rScore = v; rBest = k; rHowBest = how || k; } }
  function isYield(r) { return r === "flee" || r === "freeze" || r === "surrender"; }
  /* HELD. A man who decided to run keeps running for DWELL seconds, and a man
     who committed to a rush does not turn tail mid-stride: the same threat
     cannot flip him between fight and flight inside the dwell. (A morale
     break still routs him — that is a latch with its own hysteresis.) */
  function settle(b, th, best, how) {
    const t = now();
    const src = th.source || null;
    const same = b.tSrc === src && (src || (Math.abs((th.x || 0) - b.tX) + Math.abs((th.z || 0) - b.tZ) < 8));
    const prev = b.tResp;
    if (prev && same && t - b.tRespT < DWELL && ((prev === "fight" && isYield(best)) || (isYield(prev) && best === "fight"))) {
      b.response = prev; b.responseT = t;
      return prev;
    }
    if (best !== prev || !same) { b.tResp = best; b.tRespT = t; }
    b.tSrc = src; b.tX = th.x || 0; b.tZ = th.z || 0;
    b.threatHow = how || best;
    b.response = best; b.responseT = t;
    return best;
  }

  /* ONE MAN AGAINST A GUN (tw === "gun", not an order from authority). */
  function vsGun(actor, b, th, lvl) {
    const p = b.personality, bias = b.arch.threat || {};
    const my = capability(actor), d = distTo(actor, th), hf = hpFrac(actor), t = now();
    if (my === "gun") {
      // he has one too: into cover first, then he fires from it. Only the
      // nearly dead run (a morale break is handled by the caller).
      if (hf < 0.2 && p.courage < 0.7 && !b.protect) return settle(b, th, "flee", "flee");
      const src = th.source || null;
      if (b.engSrc !== src || t - (b.engLast || -1e9) > 6) { b.engSrc = src; b.engT = t; }
      b.engLast = t;
      // a bodyguard's job is the body: he covers, he does not go hunting
      if (b.protect || (bias.cover || 0) >= 0.5) return settle(b, th, "cover", "cover");
      if (th.inCover || th.sheltered || t - b.engT >= COVER_FIRST * (1.3 - p.discipline * 0.6)) return settle(b, th, "fight", "engage");
      return settle(b, th, "cover", "cover");
    }
    if (my === "melee" && canRush(actor, th)) return settle(b, th, "fight", "rush");
    // A BLADE WAITING FOR ITS GAP: a hard man already close holds low and
    // watches for the reload or the turned back — he does not walk in on it
    if (my === "melee" && d <= RUSH_R + 2.5 && hf > 0.4 && p.aggression * 0.55 + p.courage * 0.45 >= 0.55 && !th.aimingAtMe) {
      return settle(b, th, "cover", "stalk");
    }
    // EVERYONE ELSE YIELDS — which way is personality and what is around him
    if (th.cornered) return settle(b, th, th.aimingAtMe ? "surrender" : "freeze", th.aimingAtMe ? "surrender" : "freeze");
    rBest = "flee"; rScore = -1e9; rBias = bias; rHowBest = "flee";
    const muzzle = th.aimingAtMe && d < 9;
    score("flee", 0.55 + (1 - p.courage) * 0.35 + lvl * 0.2 - (muzzle ? 0.45 : 0), "flee");
    // a door he can get behind (a cell, a room): breaks the line for good
    if (th.hide) score("flee", 0.62 + p.discipline * 0.35 + (d > 6 ? 0.1 : -0.25) - (muzzle ? 0.4 : 0), "hide");
    score("cover", (th.coverNear ? 0.45 : 0.1) + p.discipline * 0.4 + (d < 10 ? 0.05 : 0), "cover");
    // flat on the floor in the open, close to it, when there is nowhere to go
    score("cover", d < 14 && lvl > 0.5 ? 0.3 + p.discipline * 0.15 + (1 - p.courage) * 0.25 - (th.hide ? 0.3 : 0) - (th.coverNear ? 0.2 : 0) : -1, "prone");
    score("surrender", th.aimingAtMe && d < 12 ? 0.5 + (1 - p.aggression) * 0.45 + (1 - p.courage) * 0.2 : -1, "surrender");
    score("freeze", lvl > 0.75 ? (1 - p.courage) * 0.5 - 0.15 : -1, "freeze");
    const best = rBest, how = rHowBest; rBias = null;
    return settle(b, th, best, how);
  }

  function respond(actor, th) {
    const b = of(actor);
    if (isDead(actor)) return "ignore";
    if (actor.cuffed || actor.tied) return "comply";
    if (actor.ko > 0 || actor.asleep) return "ignore";
    if (!th) return "ignore";
    const lvl = assess(actor, th).level;
    if (lvl < 0.12) { b.threatHow = "ignore"; return (b.response = "ignore"); }
    const p = b.personality, bias = b.arch.threat || {};
    const my = capability(actor);
    const armed = my === "gun" || (my === "melee" && !th.armed);
    const hf = hpFrac(actor);
    const brk = b.registered && groupIdOf(b) != null ? broken(actor) : false;
    if (brk) { b.threatHow = "flee"; b.tResp = "flee"; b.tRespT = now(); b.tSrc = th.source || null; return (b.response = "flee"); }
    // THE POST IS THE JOB: a countersniper holds his roof whatever happens
    if (b.arch.hold) { b.threatHow = "hold"; return (b.response = "hold"); }
    const tw = threatWeapon(th);
    // being threatened spends the safety drive
    if (b.needs && b.needs.levels.safety != null) b.needs.levels.safety = clamp01(b.needs.levels.safety - lvl * 0.2);
    if (tw === "gun" && !th.authority) return vsGun(actor, b, th, lvl);
    const allies = Math.min(4, alliesNear(actor, 12));
    rBest = "ignore"; rScore = -1e9; rBias = bias; rHowBest = null;
    score("fight", p.aggression * 0.6 + p.courage * 0.4 + (armed ? 0.45 : 0) + allies * 0.06 - lvl * (1 - p.courage) * 0.6 - (1 - hf) * 0.5 - (th.armed && !armed ? 0.5 : 0));
    score("flee", (1 - p.courage) * 0.7 + lvl * 0.5 + (1 - hf) * 0.4 - p.discipline * 0.35 - (armed ? 0.2 : 0));
    score("freeze", lvl > 0.6 ? (1 - p.courage) * 0.45 + (1 - p.discipline) * 0.1 - 0.1 : -1);
    // a survivor already IN a shelter when the hazard hits stays in it (th.sheltered)
    score("cover", p.discipline * 0.55 + (th.armed || th.kind === "gunshot" ? 0.35 : -0.3) + lvl * 0.2 + (th.sheltered ? 1.2 : 0));
    score("surrender", th.aimingAtMe && !armed && (th.distance == null || th.distance < 12) ? (1 - p.aggression) * 0.8 + (1 - p.courage) * 0.3 : -1);
    score("comply", th.authority ? p.discipline * 0.5 + (1 - p.aggression) * 0.5 : -1);
    const best = rBest, how = rHowBest; rBias = null;
    return settle(b, th, best, how);
  }
  // HOW he does what respond() said: flee -> "flee" | "hide"; cover ->
  // "cover" | "prone" | "stalk" (a blade holding low) ; fight -> "engage"
  // (from range) | "rush" (a blade in its window) | "fight"
  function how(actor) { const b = actor && actor._brain; return (b && b.threatHow) || null; }
  const threat = {
    assess: assess, respond: respond, how: how,
    capability: capability, setCapability: setCapability, weaponOf: threatWeapon,
    canRush: canRush, facingAway: facingAway,
    RUSH_R: RUSH_R, DWELL: DWELL,
  };

  /* ================================================================ ACT
     The ONLY way the brain touches a body. Each call tries the NINTH WAVE
     seam (CBZ.moves / CBZ.verbs, built in parallel by other leads), then the
     game's own executor (act.use), then does nothing and returns false. */
  const EXEC = Object.create(null);
  function execOf(a) {
    const b = a && a._brain;
    return (b && b.game && EXEC[b.game]) || (a && a.game && EXEC[a.game]) || EXEC["*"] || null;
  }
  const SPEEDS = { walk: 1.4, jog: 3.2, run: 5.5, sprint: 7 };
  function speedNum(s) { return typeof s === "number" ? s : SPEEDS[s] || SPEEDS.walk; }
  // THE SPLIT WITH CBZ.moves (entities/moves.js + moves_posture.js, merged):
  // the brain DECIDES, moves EXECUTES. CBZ.moves is a per-frame INTEGRATOR
  // each game's mover calls itself — step(m, pos, yaw, tx, tz, o, dt),
  // face(m, yaw, want, dt), formation() — plus a posture SEQUENCER
  // (sit/lie/kneel/crouch/stand need a spot). It has no command API, so the
  // normal path is the game's executor (act.use): it writes the goal its
  // CBZ.moves-driven mover reads (city: ped.moveOrder; prison: target;
  // gungame: b.goal; protection: ped.moveOrder via CBZ.protection.order).
  // The root object is still asked for COMMAND-style names that cannot
  // collide with the integrator (moveTo | go | steerTo ; stop | halt ;
  // turnTo | faceTo ; setPosture). NOT `posture`: CBZ.moves.posture(actor)
  // is moves_posture.js's GETTER (returns "stand"/"sit"...), and asking it
  // would swallow every posture request. NOT `face`/`stop`: integrator names.
  // A `CBZ.moves.brain` adapter object, if ever published, is preferred and
  // may also use plain `face`.
  let _mThis = null;
  function movesFn(names, adapterExtra) {
    const M = CBZ.moves;
    if (!M) return null;
    const AD = M.brain && typeof M.brain === "object" ? M.brain : null;
    if (AD) {
      for (let i = 0; i < names.length; i++) if (typeof AD[names[i]] === "function") { _mThis = AD; return AD[names[i]]; }
      if (adapterExtra && typeof AD[adapterExtra] === "function") { _mThis = AD; return AD[adapterExtra]; }
    }
    for (let i = 0; i < names.length; i++) if (typeof M[names[i]] === "function") { _mThis = M; return M[names[i]]; }
    return null;
  }
  const N_MOVE = ["moveTo", "go", "steerTo"], N_STOP = ["stop", "halt"], N_FACE = ["turnTo", "faceTo"], N_POST = ["setPosture"];
  function via(names, execName, a, x, y, z) {
    const e = execOf(a);
    if (e && e.prefer && typeof e[execName] === "function") return e[execName](a, x, y, z);
    const f = movesFn(names, names === N_FACE ? "face" : null);
    if (f) { try { const r = f.call(_mThis, a, x, y, z); if (r !== false) return r == null ? true : r; } catch (err) { /* fall through to the executor */ } }
    if (e && typeof e[execName] === "function") return e[execName](a, x, y, z);
    return false;
  }
  function moveTo(a, x, z, opts) {
    const o = opts || _moveOpts;
    o.speedMps = speedNum(o.speed);
    const ok = !!via(N_MOVE, "moveTo", a, x, z, o);
    if (ok) markMoved(a);
    return ok;
  }
  const _moveOpts = { speed: "walk", arrive: 1, face: true, speedMps: 1.4 };
  // actor._brain.movedAt / movedFrame: when the brain last moved or stopped
  // this body, so a game's own loop can skip moving him twice (act.movedThisFrame)
  function markMoved(a) { const b = a && a._brain; if (b) { b.movedAt = now(); b.movedFrame = frame; } }
  function stop(a) { const ok = !!via(N_STOP, "stop", a); if (ok) markMoved(a); return ok; }
  function face(a, x, z) { return !!via(N_FACE, "face", a, x, z); }
  function posture(a, p) { const b = a && a._brain; if (b) b.posture = p; return !!via(N_POST, "posture", a, p); }
  // SPEECH: in-world only (systems/speech.js puts it over the speaker's head).
  // Never a HUD popup. The same line from the same mouth is held 3 s.
  function say(a, line, opts) {
    if (!a || !line || isDead(a)) return false;
    const b = of(a), t = now();
    if (line === b.lastSay && t - b.lastSayT < 3) return false;
    if (t - b.lastSayT < 0.9 && !(opts && opts.force)) return false;
    b.lastSay = line; b.lastSayT = t;
    const e = execOf(a);
    if (e && typeof e.say === "function") return e.say(a, line, opts) !== false;
    if (CBZ.speech && typeof CBZ.speech.say === "function") { try { return !!CBZ.speech.say(a, line, opts || null); } catch (err) { return false; } }
    if (typeof CBZ.citySay === "function") { try { return !!CBZ.citySay(a, line, "#ffffff", (opts && opts.secs) || 2.2); } catch (err) { return false; } }
    return false;
  }
  // HARNESS TRAP: CBZ.verbs' exact API was unknown when this was written
  // (VERBS lead builds it in parallel). Tried: verbs[name](a, b, opts), its
  // aliases, then a dispatcher verbs.run|do|perform|start(name, a, b, opts).
  const ALIAS = { cuff: "restrain", restrain: "cuff", tase: "taser", taser: "tase", tackle: "takedown", takedown: "tackle" };
  function verb(name, a, b, opts) {
    const e = execOf(a);
    if (e && e.prefer && typeof e.verb === "function") return e.verb(name, a, b, opts) || false;
    const V = CBZ.verbs;
    if (V) {
      let f = typeof V[name] === "function" ? V[name] : (ALIAS[name] && typeof V[ALIAS[name]] === "function" ? V[ALIAS[name]] : null);
      try {
        if (f) { const r = f.call(V, a, b, opts); if (r !== false && r != null) return r; }
        else {
          const d = V.run || V.do || V.perform || V.start;
          if (typeof d === "function") { const r = d.call(V, name, a, b, opts); if (r !== false && r != null) return r; }
        }
      } catch (err) { /* fall through */ }
    }
    if (e && typeof e.verb === "function") return e.verb(name, a, b, opts) || false;
    return false;
  }
  const act = {
    moveTo: moveTo, stop: stop, face: face, posture: posture, say: say, verb: verb,
    use: function (game, ex) { EXEC[game || "*"] = ex || null; return function () { if (EXEC[game || "*"] === ex) delete EXEC[game || "*"]; }; },
    SPEEDS: SPEEDS,
    movedThisFrame: function (a) { const b = a && a._brain; return !!b && b.movedFrame === frame && b.movedAt === now(); },
  };

  /* ================================================================ AUTHORITY
     The prison's orders-before-cuffs (systems/capture.js ARREST) for everyone,
     with the city's gun-stop challenge (police.js challengeCall) as the warn:
       observe -> warn ("Stop right there!") -> order ("On the ground! Now!")
       -> approach (only while complying) -> cuff (act.verb "restrain") -> done
       non-compliance -> escalate -> force (taser at <= 5.5 m, then tackle)
       -> lethal (roe lethal/protect, suspect armed AND aiming/attacking).
     Timing is capture.js's: comply = still (< 0.6 m/s) or hands up / kneeling
     / prone for 0.6 s; resist = running away (> 2.2 m/s, opening) for 0.55 s,
     or a swing; the order window is the officer's patience (prison 2.2 s,
     beat cop 6 s, SWAT 1.5 s); an order past 15 m is void. */
  const LINES = {
    warn: ["Stop right there!", "Hey! Stop!", "Police! Hold it!"],
    order: ["On the ground! Now!", "Hands where I can see them!", "Down! Get down!", "Hands up!"],
    orderArmed: ["Drop it! Drop the weapon!", "Gun! Drop it!"],
    approach: ["Easy now, hold still.", "Don't move."],
    cuff: ["Hands behind your back.", "Don't move."],
    escalate: ["Last warning!", "Stop resisting!"],
    force: ["Taser! Taser!", "Get down!"],
    lethal: ["Drop it or I shoot!"],
    done: ["You're done.", "Move along."],
    released: ["Keep it holstered.", "Put it away and keep it away.", "Alright. Move along."],
    frisk: ["Hands on the wall.", "Arms out."],
    warned: ["Move along.", "Don't let me see it again.", "Walk away."],
  };
  /* THE RULE (systems/arrest.js): cuffs go on a man who is compliant,
     subdued (tased / down / pinned) or outnumbered and taken from behind.
     A runner has to be CAUGHT: the tackle is a committed lunge from arm's
     reach (TACKLE_R) that can miss. A man squared up and swinging is tased
     (or beaten) first, never tackled or grabbed. A taser can miss and has to
     be reloaded (TASE_RELOAD). An officer can run flat out for RUN_FOR s,
     then he is blown and jogs until he has his breath back. The cuff rung
     waits on the REAL verb (a session or an arrest take: done + outcome):
     cuffs that were fought off are an escalation, not a "cuffed". */
  const ARREST = { COMPLY_SPD: 0.6, COMPLY_HOLD: 0.6, FLEE_SPD: 2.2, FLEE_HOLD: 0.55, TASE_R: 5.5, TACKLE_R: 2.6, GRAB_R: 1.5, AFTER_TASE: 3.0, LOSE_R: 15, CUFF_T: 1.5, CUFF_MAX: 14, FRISK_T: 1.1, ESC_T: 0.4, TASE_RELOAD: 2.6, RUN_FOR: 9 };
  function line(b, key) {
    const L = (b.arch.lines && b.arch.lines[key]) || LINES[key];
    return L && L.length ? L[(b.id + (b.case ? b.case.n : 0)) % L.length] : null;
  }
  function begin(officer, suspect, reason, opts) {
    const b = of(officer);
    const A = b.arch, ao = A.authorityOpts || {};
    opts = opts || {};
    const c = b.case || (b.case = {});
    c.suspect = suspect; c.reason = reason || null;
    c.roe = opts.roe || A.authority || "nonlethal";
    c.warnRange = opts.warnRange != null ? opts.warnRange : (ao.warnRange || 10);
    c.orderRange = opts.orderRange != null ? opts.orderRange : (ao.orderRange || 4.2);
    c.cuffRange = opts.cuffRange != null ? opts.cuffRange : (ao.cuffRange || 1.4);
    c.patience = opts.patience != null ? opts.patience : (ao.patience || 2.2);
    c.skipWarn = !!opts.skipWarn;
    c.minor = !!opts.minor;
    // hold: challenge IN PLACE (a protection detail never leaves the principal
    // to walk a man down): no approach, no chase, force only inside reach
    c.hold = !!opts.hold;
    c.silent = !!opts.silent;                 // + the game voices this case itself (out.say still reported)
    c.complyHold = opts.complyHold != null ? opts.complyHold : ARREST.COMPLY_HOLD;   // + s of compliance that counts
    // THE GUN-STOP (police.js challengeCall, absorbed): comply "disarm" means
    // compliance is the weapon going away (holstered / dropped), and outcome
    // "release" ends a complied case with him let go instead of cuffed
    c.complyMode = opts.comply || "submit";
    c.onComply = opts.outcome || (c.complyMode === "disarm" ? "release" : "cuff");
    // RE-CHALLENGES come shorter: the same man challenged again inside the
    // window (60 s) gets patience / n (floor 0.8 s), police.js's _chalN rule
    if (opts.rechallenge) {
      const ch = b.chal || (b.chal = { suspect: null, n: 0, t: -1e9 });
      const win = typeof opts.rechallenge === "number" ? opts.rechallenge : 60;
      ch.n = ch.suspect === suspect && now() - ch.t < win ? ch.n + 1 : 1;
      ch.suspect = suspect; ch.t = now();
      c.patience = Math.max(0.8, c.patience / ch.n);
      c.challengeN = ch.n;
    } else c.challengeN = 1;
    c.phase = "observe"; c.t = 0; c.phaseT = 0; c.comply = 0; c.flee = 0; c.lastD = -1;
    c.tased = false; c.noTaser = false; c.tackleN = 0; c.tackleCD = 0; c.taseCD = 0; c.grabbed = false;
    c.runT = 0; c.blown = false; c.ranAt = -1;
    c.runFor = opts.runFor != null ? opts.runFor : (ao.runFor || (officer && officer.swat ? 13 : ARREST.RUN_FOR));   // + s of flat-out running he has in him
    c.tackleR = opts.tackleRange != null ? opts.tackleRange : ARREST.TACKLE_R;   // + reach of the takedown
    c.tackles = opts.tackles != null ? opts.tackles : 2;                        // + attempts per case
    c.forceN = 0; c.cuffed = false; c.verbResult = null; c.outcome = null;
    c.n = (c.n || 0) + 1; c.saidPhase = null; c.active = true;
    c.out = c.out || { phase: null, say: null, act: null, verb: null, x: 0, z: 0 };
    return c;
  }
  function setPhase(c, p) { c.phase = p; c.phaseT = 0; c.comply = 0; c.flee = 0; c.saidPhase = null; }
  const _ss = { speed: 0, handsUp: false, kneeling: false, prone: false, armed: false, aiming: false, attacking: false, fled: false, seen: true };
  function step(officer, dt, s) {
    const b = of(officer), c = b.case;
    if (!c || !c.active) return null;
    const out = c.out;
    out.say = null; out.act = null; out.verb = null;
    s = s || _ss;
    const sus = c.suspect;
    if (!sus || isDead(sus) || blind(officer)) { c.active = false; c.outcome = sus && isDead(sus) ? "dead" : "cancelled"; setPhase(c, "done"); out.phase = "done"; return out; }
    c.t += dt; c.phaseT += dt;
    const sx = ax(sus), sz = az(sus);
    const d = s.dist != null ? s.dist : Math.hypot(sx - ax(officer), sz - az(officer));
    const opening = c.lastD >= 0 && d > c.lastD - 0.002;
    c.lastD = d;
    out.x = sx; out.z = sz;
    const still = (s.speed || 0) < ARREST.COMPLY_SPD || s.handsUp || s.kneeling || s.prone;
    const running = (s.speed || 0) > ARREST.FLEE_SPD && opening;
    const threatening = s.armed && (s.aiming || s.attacking);
    // on the floor after a taser, a takedown or a beating: a man who can be cuffed
    const down = !!(s.subdued || s.prone);
    // his breath: a blown officer jogs until he has it back
    if (c.ranAt !== now()) c.runT = Math.max(0, c.runT - dt * 0.3);
    if (c.runT >= c.runFor) c.blown = true; else if (c.runT < c.runFor * 0.3) c.blown = false;
    // what compliance IS for this case: a gun-stop only wants the gun away
    const complying = c.complyMode === "disarm" ? !s.armed && !s.aiming && !s.attacking : still && !s.armed;
    const hold = c.hold;
    const lethalOk = c.roe === "lethal" || c.roe === "protect";
    const seen = s.seen !== false;
    let ph = c.phase;

    // lethal force is ONLY for an armed man pointing it, and ROE must allow it
    if (lethalOk && threatening && seen && ph !== "lethal" && ph !== "done") { setPhase(c, "lethal"); ph = "lethal"; }
    if (ph !== "done" && ph !== "lethal" && s.fled) { c.active = false; c.outcome = "lost"; setPhase(c, "done"); out.phase = "done"; return out; }

    if (ph === "observe") {
      out.act = "watch";
      if (seen && d <= c.warnRange) { setPhase(c, c.skipWarn || d <= c.orderRange ? "order" : "warn"); ph = c.phase; }
      else if (seen && !hold) { out.act = "approach"; moveTo(officer, sx, sz, _mJog); }
    }
    if (ph === "warn") {
      out.act = "approach";
      if (c.saidPhase !== "warn") { out.say = line(b, "warn"); c.saidPhase = "warn"; }
      face(officer, sx, sz);
      if (d > c.orderRange && !hold) moveTo(officer, sx, sz, _mJog);
      if (s.attacking) { setPhase(c, "escalate"); ph = c.phase; }
      else if (d <= c.orderRange || c.phaseT > 1.5 || hold) { setPhase(c, "order"); ph = c.phase; }
      else if (d > ARREST.LOSE_R && c.phaseT > 1) { setPhase(c, "escalate"); ph = c.phase; }
    }
    if (ph === "order") {
      out.act = "hold";
      if (c.saidPhase !== "order") { out.say = line(b, s.armed ? "orderArmed" : "order"); c.saidPhase = "order"; }
      face(officer, sx, sz);
      if (d > c.orderRange + 0.5 && !hold) moveTo(officer, sx, sz, _mWalk); else stop(officer);
      if (s.attacking) { setPhase(c, "escalate"); ph = c.phase; }
      else {
        c.comply = complying ? c.comply + dt : Math.max(0, c.comply - dt * 0.5);
        c.flee = running ? c.flee + dt : Math.max(0, c.flee - dt * 0.5);
        const lateOk = c.complyMode === "disarm" ? complying : (s.speed || 0) < 1.4 && !s.armed;
        if ((c.comply > 0 && c.comply >= c.complyHold) || (c.phaseT >= c.patience && lateOk)) {
          if (c.onComply === "release") {
            out.say = line(b, "released"); c.outcome = "released"; c.active = false; setPhase(c, "done"); ph = "done";
          } else if (hold && d > c.cuffRange) {
            c.outcome = "complied"; c.active = false; setPhase(c, "done"); ph = "done";
          } else { setPhase(c, "approach"); ph = c.phase; }
        }
        else if (c.flee >= ARREST.FLEE_HOLD || d > ARREST.LOSE_R) {
          if (hold && d > ARREST.LOSE_R) { c.outcome = "lost"; c.active = false; setPhase(c, "done"); ph = "done"; }
          else { setPhase(c, "escalate"); ph = c.phase; }
        }
        else if (c.phaseT >= c.patience) { setPhase(c, "escalate"); ph = c.phase; }
      }
    }
    if (ph === "approach") {
      out.act = "approach";
      if (c.saidPhase !== "approach") { out.say = line(b, "approach"); c.saidPhase = "approach"; }
      if (s.attacking || running || s.armed) { setPhase(c, "escalate"); ph = c.phase; }
      else if (d <= c.cuffRange) { setPhase(c, "cuff"); ph = c.phase; }
      else if (hold) { c.outcome = "complied"; c.active = false; setPhase(c, "done"); ph = "done"; }
      else moveTo(officer, sx, sz, _mWalkArrive);
    }
    if (ph === "cuff") {
      out.act = "cuff";
      if (!c.grabbed) { stop(officer); face(officer, sx, sz); }
      // capture.js's rule: a minor matter that complied is a PAT-DOWN and a
      // warning, not cuffs (begin opts.minor). A real one is cuffs, calm,
      // because he complied — the force verbs are only ever for resisting.
      if (c.saidPhase !== "cuff") {
        out.say = line(b, c.minor ? "frisk" : "cuff"); c.saidPhase = "cuff";
        const vn = c.minor ? "frisk" : "restrain";
        c.verbResult = verb(vn, officer, sus, _vOpts(c));
        out.verb = vn;
      }
      const vr = c.verbResult;
      if (!c.minor && vr && typeof vr === "object" && "done" in vr) {
        // THE REAL VERB DECIDES: hands on, the struggle, both wrists. His
        // walking off before the hands landed, or tearing out of them, is an
        // escalation; only a closed pair of cuffs is "cuffed".
        const k = vr.result && vr.result.outcome;
        if (k === "cuffed" || k === "arrived") { c.cuffed = true; c.outcome = "cuffed"; c.active = false; setPhase(c, "done"); ph = "done"; }
        else if (vr.done || c.phaseT > ARREST.CUFF_MAX) {
          if (!vr.done && vr.cancel) { try { vr.cancel(); } catch (err) {} }
          c.grabbed = false;
          setPhase(c, "escalate"); ph = c.phase;
        }
      } else if (running || s.attacking) { setPhase(c, "escalate"); ph = c.phase; }
      else if (c.phaseT >= (c.minor ? ARREST.FRISK_T : ARREST.CUFF_T)) {
        if (c.minor) { c.outcome = "warned"; out.say = line(b, "warned"); }
        else { c.cuffed = true; c.outcome = "cuffed"; }
        c.active = false; setPhase(c, "done"); ph = "done";
      }
    }
    if (ph === "escalate") {
      out.act = "chase";
      if (c.saidPhase !== "escalate") { out.say = line(b, "escalate"); c.saidPhase = "escalate"; }
      if (hold) { out.act = "hold"; face(officer, sx, sz); } else runMove(officer, c, sx, sz, dt);
      if (c.phaseT >= ARREST.ESC_T) { setPhase(c, "force"); ph = c.phase; }
    }
    if (ph === "force") {
      // THE FORCE RUNG (systems/arrest.js is the rule). The taser from range
      // at a man running or fighting; hands on from behind when he is
      // outnumbered; the TACKLE, a committed lunge from arm's reach, at a
      // runner or a man walking off. Never a tackle or a grab on a man squared
      // up and swinging: he is tased (or beaten) first. On the floor after
      // any of it = the cuffs.
      out.act = "force";
      if (c.tackleCD > 0) c.tackleCD -= dt;
      if (c.taseCD > 0) c.taseCD -= dt;
      const fighting = !!s.attacking;
      const resisting = fighting || !(still && !s.armed);
      if (!down && !c.noTaser && c.taseCD <= 0 && d <= ARREST.TASE_R && resisting) {
        if (c.saidPhase !== "force") { out.say = line(b, "force"); c.saidPhase = "force"; }
        const r = verb("tase", officer, sus, _vOpts(c));
        if (!r) c.noTaser = true;                                // no taser here: the tackle is next
        else {
          c.verbResult = r; out.verb = "tase"; c.forceN++; c.afterT = 0;
          if (r.hit === false) c.taseCD = ARREST.TASE_RELOAD;    // the probes missed: reload
          else { c.tased = true; c.taseCD = ARREST.TASE_RELOAD * 1.6; }
        }
      }
      if (!out.verb && !fighting && !down && !s.armed && d <= ARREST.GRAB_R && (s.cuffed || (s.behind && (s.backup | 0) >= 1))) {
        // outnumbered, his back to you, in reach: hands on (the cuff rung runs
        // it). A man already in cuffs just gets a hand on his arm.
        c.grabbed = true; c.forceN++;
        setPhase(c, "cuff"); ph = c.phase;
      } else if (!out.verb && !fighting && !down && d <= c.tackleR && resisting && c.tackleN < c.tackles && c.tackleCD <= 0 &&
        (c.tased || c.noTaser || c.taseCD > 0 || running)) {
        c.verbResult = verb("tackle", officer, sus, _vOpts(c)); out.verb = "tackle";
        c.tackleN++; c.tackleCD = 1.5; c.forceN++; c.afterT = 0;
      } else if (!out.verb && !hold) {
        // a man swinging is not walked into: he is held off at taser range
        if (fighting && d < 2.2) { stop(officer); face(officer, sx, sz); }
        else if (d > (c.tased || c.noTaser || c.taseCD > 0 ? c.tackleR * 0.8 : ARREST.TASE_R)) runMove(officer, c, sx, sz, dt);
        else if (!fighting) runMove(officer, c, sx, sz, dt);
      }
      if (ph === "force" && d > (hold ? ARREST.LOSE_R : ARREST.LOSE_R * 1.6)) { c.active = false; c.outcome = "lost"; setPhase(c, "done"); ph = "done"; }
      if (ph === "force" && (c.forceN > 0 || down)) {
        c.afterT = (c.afterT || 0) + dt;
        if (!running && !fighting && (down || still) && c.afterT > 0.5) { setPhase(c, "approach"); ph = c.phase; c.saidPhase = "approach"; }
        else if (c.afterT > ARREST.AFTER_TASE && running) { c.forceN = Math.max(c.forceN, 1); }
      }
    }
    if (ph === "lethal") {
      out.act = "shoot";
      if (c.saidPhase !== "lethal") { out.say = line(b, "lethal"); c.saidPhase = "lethal"; }
      face(officer, sx, sz);
      posture(officer, "aim");
      if (!threatening && c.phaseT > 0.5) { setPhase(c, "order"); ph = c.phase; out.act = "hold"; }
    }
    if (out.say && !c.silent) say(officer, out.say, _sayForce);
    out.phase = c.phase;
    return out;
  }
  const _mJog = { speed: "jog", arrive: 1.5, face: true }, _mWalk = { speed: "walk", arrive: 1, face: true };
  const _mRun = { speed: "run", arrive: 1, face: true }, _mWalkArrive = { speed: "walk", arrive: 1.0, face: true };
  const _sayForce = { force: true };
  const _vo = { reason: null, roe: null, phase: null, grab: false, subdued: false };
  function _vOpts(c) { _vo.reason = c.reason; _vo.roe = c.roe; _vo.phase = c.phase; _vo.grab = !!c.grabbed; _vo.tased = !!c.tased; return _vo; }
  // flat out while he has the breath for it, a jog once he is blown
  function runMove(officer, c, x, z, dt) {
    moveTo(officer, x, z, c.blown ? _mJog : _mRun);
    if (!c.blown) { c.runT += dt; c.ranAt = now(); }
  }
  const authority = {
    begin: begin, step: step, LINES: LINES, ARREST: ARREST,
    cancel: function (officer) { const b = officer && officer._brain; if (b && b.case) { b.case.active = false; b.case.outcome = "cancelled"; b.case.phase = "done"; } },
    caseOf: function (officer) { const b = officer && officer._brain; return b && b.case && b.case.active ? b.case : null; },
  };

  /* ================================================================ TICK
     Optional convenience for games that keep their own movement: sense ->
     memory decay -> authority / morale / threat / witness / retaliation /
     investigate / routine, returned as ONE reused INTENT object.
       ctx: { target, targets[], threat, suspect (suspectState), hour, safe }
     intent.kind: none | arrest | rout | fight | flee | evacuate | cover |
       hold | freeze | surrender | comply | film | report | cower | intervene |
       cheer | retaliate | investigate | routine | idle */
  function setIntent(I, kind, x, z, speed, post, target, sayLine) {
    I.kind = kind; I.x = x; I.z = z; I.speed = speed; I.posture = post; I.target = target || null; I.say = sayLine || null;
    return I;
  }
  function awayFrom(a, x, z, dist, I) {
    let dx = ax(a) - x, dz = az(a) - z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    I.x = ax(a) + dx * dist; I.z = az(a) + dz * dist;
  }
  function heardThreat(b, out) {
    const h = b.heardR;
    if (!h.valid || now() - h.t > 3) return null;
    if (h.kind !== "gunshot" && h.kind !== "explosion" && h.kind !== "scream" && h.kind !== "fight") return null;
    out.source = h.source; out.x = h.x; out.z = h.z; out.kind = h.kind;
    out.armed = h.kind === "gunshot" || h.kind === "explosion";
    out.aimingAtMe = false; out.distance = h.d; out.authority = false;
    return out;
  }
  function tick(actor, dt, ctx) {
    const b = of(actor);
    const I = b.intent;
    I.response = null; I.phase = null; I.say = null;
    if (isDead(actor)) return setIntent(I, "none", ax(actor), az(actor), 0, "lie", null);
    // --- sense (staggered)
    b.senseT -= dt; b.senseAcc += dt;
    if (ctx && b.senseT <= 0) {
      const sdt = b.senseAcc;
      b.senseT += b.arch.senseEvery || 0.2; if (b.senseT < 0) b.senseT = 0; b.senseAcc = 0;
      if (ctx.target) awareness(actor, ctx.target, sdt, ctx.sense);
      if (ctx.targets) for (let i = 0; i < ctx.targets.length; i++) awareness(actor, ctx.targets[i], sdt, ctx.sense);
    }
    memTick(actor, dt);
    if (pending.length && lastPumpT !== now()) pumpReports();
    if (blind(actor)) return setIntent(I, "none", ax(actor), az(actor), 0, actor.cuffed ? "kneel" : "stand", null);
    const px = ax(actor), pz = az(actor);
    // --- authority case
    if (b.case && b.case.active) {
      const r = step(actor, dt, ctx && ctx.suspect);
      if (r) {
        setIntent(I, "arrest", r.x, r.z, r.act === "chase" ? SPEEDS.run : r.act === "approach" ? SPEEDS.walk : 0,
          r.act === "shoot" ? "aim" : "stand", b.case.suspect, r.say);
        I.phase = r.phase;
        return I;
      }
    }
    // --- threat (given, or heard)
    const th = (ctx && ctx.threat) || heardThreat(b, b.threatR);
    if (th) {
      const resp = respond(actor, th);
      I.response = resp;
      const tx = th.x != null ? th.x : (th.source ? ax(th.source) : px), tz = th.z != null ? th.z : (th.source ? az(th.source) : pz);
      if (resp === "flee") {
        const brk = b.routed;
        if (b.arch.evacuate) {
          const safe = (ctx && ctx.safe) || b.safe;
          setIntent(I, "evacuate", px, pz, SPEEDS.run, "stand", th.source || null);
          if (safe) { I.x = safe.x; I.z = safe.z; } else awayFrom(actor, tx, tz, 30, I);
          return I;
        }
        setIntent(I, brk ? "rout" : "flee", px, pz, SPEEDS.run, "stand", th.source || null);
        awayFrom(actor, tx, tz, 25, I);
        // HIDE: a door he can get behind (ctx.hide(actor, tx, tz) -> {x,z})
        if (b.threatHow === "hide" && ctx && typeof ctx.hide === "function") {
          const hv = ctx.hide(actor, tx, tz);
          if (hv) { I.kind = "hide"; I.x = hv.x; I.z = hv.z; }
        }
        return I;
      }
      if (resp === "cover" && b.threatHow === "prone") return setIntent(I, "prone", px, pz, 0, "prone", th.source || null);
      if (resp === "cover" && b.threatHow === "stalk") return setIntent(I, "stalk", px, pz, 0, "crouch", th.source || null);
      if (resp === "cover") {
        // close protection covers the PRINCIPAL: body between him and the threat
        const P = b.protect;
        if (P && !isDead(P)) {
          const qx = ax(P), qz = az(P);
          let dx = tx - qx, dz = tz - qz; const L = Math.hypot(dx, dz) || 1;
          setIntent(I, "cover", qx + dx / L * 1.2, qz + dz / L * 1.2, SPEEDS.run, "stand", P);
        } else setIntent(I, "cover", px, pz, SPEEDS.jog, "crouch", th.source || null);
        if (ctx && typeof ctx.cover === "function") { const cv = ctx.cover(actor, tx, tz); if (cv) { I.x = cv.x; I.z = cv.z; } }
        return I;
      }
      if (resp === "hold") return setIntent(I, "hold", px, pz, 0, "aim", th.source || null);
      if (resp === "fight") {
        // a gun fights from where it is (in cover, in range); a blade in its
        // window goes flat out; the rest walk into it the old way
        const hw = b.threatHow;
        if (hw === "engage") {
          const d = Math.hypot(tx - px, tz - pz);
          if (d <= 30) return setIntent(I, "fight", px, pz, 0, "aim", th.source || null);
          setIntent(I, "fight", px, pz, SPEEDS.jog, "aim", th.source || null);
          const k = (d - 25) / d; I.x = px + (tx - px) * k; I.z = pz + (tz - pz) * k;
          return I;
        }
        return setIntent(I, "fight", tx, tz, hw === "rush" ? SPEEDS.sprint : SPEEDS.jog, hw === "rush" ? "stand" : "aim", th.source || null);
      }
      if (resp === "freeze") return setIntent(I, "freeze", px, pz, 0, "cower", th.source || null);
      if (resp === "surrender") return setIntent(I, "surrender", px, pz, 0, "handsUp", th.source || null);
      if (resp === "comply") return setIntent(I, "comply", px, pz, 0, "kneel", th.source || null);
    }
    // --- a broken clique runs even without a fresh threat
    if (b.registered && groupIdOf(b) != null && broken(actor)) {
      setIntent(I, "rout", px, pz, SPEEDS.run, "stand", null);
      const h = b.heardR;
      if (h.valid) awayFrom(actor, h.x, h.z, 25, I); else { I.x = px; I.z = pz; }
      return I;
    }
    // --- witness
    const w = b.witness;
    if (w && now() - w.t < 10 && !w.cancelled) {
      I.response = w.response;
      if (w.response === "flee") { setIntent(I, "flee", px, pz, SPEEDS.run, "stand", w.perp); awayFrom(actor, w.x, w.z, 25, I); return I; }
      if (w.response === "film") return setIntent(I, "film", px, pz, 0, "stand", w.perp);
      if (w.response === "cower") return setIntent(I, "cower", px, pz, 0, "cower", w.perp);
      if (w.response === "report" && !w.reported) {
        const au = w.toAuth;
        if (au && !isDead(au) && w.reportAt != null) return setIntent(I, "report", ax(au), az(au), SPEEDS.jog, "stand", au);
        return setIntent(I, "report", px, pz, 0, "stand", w.perp);
      }
      if (w.response === "intervene") return setIntent(I, "intervene", w.x, w.z, SPEEDS.jog, "stand", w.perp);
      if (w.response === "cheer") return setIntent(I, "cheer", px, pz, 0, "stand", w.perp);
    }
    // --- retaliation (proportional, from social.retaliate)
    const rt = b.retaliation;
    if (rt && now() - rt.t < 8 && rt.target && !isDead(rt.target)) {
      const tx = ax(rt.target), tz = az(rt.target);
      I.response = rt.level;
      if (rt.level === AVOID) {
        // he wanted to, and the gun said no: out of its line, watching
        setIntent(I, "avoid", px, pz, SPEEDS.jog, "crouch", rt.target);
        if (Math.hypot(tx - px, tz - pz) < 14) awayFrom(actor, tx, tz, 12, I);
        else { I.speed = 0; I.x = px; I.z = pz; }
        return I;
      }
      return setIntent(I, "retaliate", tx, tz, rt.level === "glare" ? 0 : SPEEDS.jog, "stand", rt.target);
    }
    // --- something heard: the curious go and look. NOT at gunfire or a blast
    // unless he carries a gun himself: an unarmed man walks away from shots.
    const h = b.heardR;
    const loud = h.kind === "gunshot" || h.kind === "explosion";
    if (h.valid && now() - h.t < b.arch.memSec && b.personality.curiosity > 0.45 && (!loud || capability(actor) === "gun")) {
      return setIntent(I, "investigate", h.x, h.z, SPEEDS.walk, "stand", h.source);
    }
    // --- the routine
    const cur = needsCurrent(actor, ctx && ctx.hour);
    if (cur && cur.activity) {
      setIntent(I, "routine", px, pz, SPEEDS.walk, "stand", null);
      if (cur.where) { I.x = cur.where.x; I.z = cur.where.z; }
      I.response = cur.activity;
      return I;
    }
    return setIntent(I, "idle", px, pz, 0, "stand", null);
  }

  /* ================================================================ LIFECYCLE */
  function clock(t) {
    if (typeof t === "number") { T = t; clockSet = true; clockWall = wallNow(); }
    frame++;
    pumpReports();
    return T;
  }
  function update(dt) {
    if (!clockSet) T += dt || 0;
    frame++;
    pumpReports();
    moraleTick(dt || 0);
  }
  function reset(keepRep) {
    for (let i = 0; i < registered.length; i++) { registered[i].registered = false; registered[i]._ri = -1; }
    registered.length = 0; pending.length = 0;
    for (const k in GROUPS) delete GROUPS[k];
    groupList.length = 0;
    for (const k in LEADERS) delete LEADERS[k];
    for (let i = 0; i < bucketList.length; i++) bucketList[i].length = 0;
    hashDirty = true;
    if (!keepRep) rep.reset();
  }

  const brain = {
    __core: true,
    of: of, define: define, archetype: archetype, register: register, unregister: unregister,
    clock: clock, now: now, update: update, reset: reset, tick: tick,
    seed: function (n) { seedS = (n >>> 0) || 1; }, rng: rng,
    list: function () { return registered; }, near: near,
    personalityFromBehavior: personalityFromBehavior,
    perception: perception, memory: memory, rep: rep, needs: needs, social: social,
    threat: threat, morale: morale, authority: authority, act: act,
    ARCH: ARCH,
  };
  CBZ.brain = brain;
  if (typeof module !== "undefined" && module.exports) module.exports = brain;
})(typeof globalThis !== "undefined" ? globalThis : this);
