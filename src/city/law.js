/* ============================================================
   city/law.js — THE CITY'S LAW, AS A CONFIGURATION OF CBZ.brain.

   Owner (2026-09-27): "the AI logic is all separate throughout these
   games... you get handcuff logic from jail... less glitchy." The city's
   police used to decide everything in their own dialect: a private LOS
   raycast, a 12 m omniscience radius, a hand-rolled FREEZE/patience timer
   and a 2.5 s "stand still and you're cuffed" counter that lived in the
   middle of a 4000-line file. The prison already had the better version of
   that ladder (orders before cuffs), and CBZ.brain.authority is that ladder
   for everybody. This file is the city's side of the seam:

     • PERCEPTION  cops see through CBZ.brain.perception (a sight cone,
                   occlusion, light, an awareness meter) and HEAR through
                   perception.noise. CBZ.cityGunshot(x,z,shooter) is the door
                   city gunfire goes through to become noise (it hands the bang
                   to the street's hearBang, the city's one noise call site).
     • AUTHORITY   a cop with eyes on a suspect runs brain.authority: warn ->
                   order -> (comply) approach -> cuff via act.verb("restrain")
                   -> the existing arrest arc; running escalates (force: the
                   tackle), a weapon out and aimed escalates to lethal when the
                   ROE allows it. ROE comes from the wanted level.
     • ONE VOICE   one PRIMARY officer runs the ladder per suspect; the rest
                   COVER (hold 7-10 m, guns lowered) and adopt his escalation
                   after their own reaction delay. No squad-wide same-frame flip.
     • HYSTERESIS  lethal is entered only after the officer's own reaction
                   time and held LETHAL_HOLD seconds after the threat ends;
                   police.js's footwork has start/stop bands; targets are sticky.
     • WITNESSES   brain.social reports ("city") land here, go through a short
                   dispatch delay, then raise wanted with the witness's
                   LAST-KNOWN position (memory.lastSeen), never the player's
                   true position. NPC perpetrators become city offenders.
     • EXECUTOR    act.use("city-law", ...) registers police.js's existing
                   movement (stepTo / hold / face) and arrest functions
                   (cityBust, cityNpcArrest, the predator tackle) as the
                   fallback executor. Cops carry brain.game = "city-law" so the
                   city STREET router's "city" executor (peds) never drives a
                   cop body, and neither can clobber the other's registration.

   Pure logic: no THREE, no DOM. Loads under plain node (tools/brain-sim-city-law.mjs).
   police.js / wanted.js bind their engine functions in via bindPolice / bindWanted.
============================================================ */
(function () {
  "use strict";
  const W = (typeof window !== "undefined") ? window : (typeof globalThis !== "undefined" ? globalThis.window : null);
  const CBZ = W && W.CBZ;
  if (!CBZ) { if (typeof module !== "undefined") module.exports = null; return; }
  const g = CBZ.game || (CBZ.game = {});
  const GAME = "city-law";
  function B() { return CBZ.brain || null; }

  const L = CBZ.cityLaw = CBZ.cityLaw || {};
  L.GAME = GAME;

  // ---- tuning ---------------------------------------------------------------
  const COMPLY_STILL = 1.5;      // s standing still, weapon away = hands shown (no surrender input exists)
  const WARN_R = 14;            // m: "Police! Stop right there!" carries this far
  const ORDER_R = 6;             // m: orders are given from here, not from your shoulder
  const CUFF_R = 1.5;            // m: hands-on range
  const LETHAL_HOLD = 3.0;       // s: a lethal officer keeps his gun up this long after the threat ends
  const TACKLE_R = 2.6;          // m: arm's reach (police.js's old tackle reach)
  const TACKLE_CD = 6;           // s: one takedown attempt at a time, force-wide
  const HEAR_FRESH = 6;          // s: a heard gunshot older than this is history
  const DISPATCH_MIN = 0.6, DISPATCH_MAX = 1.6;   // s: a landed call still goes through dispatch before units hear it
  const PRIMARY_LOST = 3.0;      // s: primary unseen this long hands the case to an officer who sees

  // ---- module clock (advanced once per frame by frame(); deterministic) ------
  let T = 0, F = 0;
  L.time = function () { return T; };
  // did the brain already move or stop this body this frame? (authority.step
  // walks the primary officer itself; police.js must not walk him twice)
  // (the brain stamps every body act.moveTo / act.stop moved: movedThisFrame)
  L.acted = function (c) { const b = B(); return !!c && !!(b && b.act && b.act.movedThisFrame && b.act.movedThisFrame(c)); };

  // ---- per-officer stable traits: reaction delay (no squad-wide same-frame flips)
  let _seq = 0;
  function hash01(n, salt) {
    let x = (n * 374761393 + salt * 668265263) | 0;
    x = (x ^ (x >>> 13)) * 1274126177 | 0;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }
  function lawOf(c) {
    let K = c._law;
    if (!K) {
      const id = ++_seq;
      K = c._law = {
        id: id,
        react: (c.swat ? 0.12 : 0.22) + hash01(id, 7) * 0.45,   // s before HIS body follows a new call
        suspect: null, roe: null, phase: null, phaseT: 0, pendT: 0, adoptT: 0,
        cuffAsked: false, heardT: -1e9, acqT: -1e9, stakeAt: 0, stakesSaid: false, calmT: 0,
      };
    }
    return K;
  }
  L.lawOf = lawOf;
  L.react = function (c) { return lawOf(c).react; };
  // a stable 0..1 per officer (stagger timers off it, never off a shared rng)
  L.jitter = function (c, salt) { return hash01(lawOf(c).id, salt | 0); };

  // ---- engine hooks (bound by police.js / wanted.js) ------------------------
  const H = {
    step: null,        // (c, dx, dz, speed)            -> moves one frame (police.js stepTo)
    hold: null,        // (c)                           -> speed 0 + settle + idle anim
    face: null,        // (c, x, z)                     -> smooth turn toward (x,z)
    say: null,         // (c, line, secs)               -> in-world speech over the officer
    drawGun: null,
    tackle: null,      // (c)                           -> predator-seize takedown of the player
    openCarry: null,   // ()                            -> player's gun is out
    report: null,      // (heat, {type,x,z})            -> wanted.js report()
    npcOffense: null,  // (ped, heat, type)
  };
  L.bindPolice = function (o) { for (const k in o) if (k in H) H[k] = o[k]; installExecutor(true); };
  L.bindWanted = function (o) { for (const k in o) if (k in H) H[k] = o[k]; };

  function isPlayerActor(a) {
    return !!(a && (a.isPlayer || a === CBZ.player || (CBZ.city && a === CBZ.city.playerActor)));
  }
  L.isPlayer = isPlayerActor;

  // ============================================================
  //  EXECUTOR — act.use("city-law", ...). Thin adapter over police.js's own
  //  movement + arrest functions. The brain calls CBZ.moves / CBZ.verbs first
  //  when they exist; this is what runs when they don't (or decline).
  // ============================================================
  function speedOf(actor, s) {
    const base = actor.baseSpeed || 4.6;
    if (typeof s === "number") return s;
    if (s === "walk") return base * 0.42;
    if (s === "jog") return base * 0.75;
    if (s === "run") return base * 1.05;
    return base * 0.6;
  }
  const EXEC = {
    moveTo: function (actor, x, z, opts) {
      if (!actor || !actor.pos || !H.step) return false;
      const dx = x - actor.pos.x, dz = z - actor.pos.z;
      const arrive = opts && opts.arrive != null ? opts.arrive : 0;
      if (arrive > 0 && dx * dx + dz * dz <= arrive * arrive) { if (H.hold) H.hold(actor); return true; }
      H.step(actor, dx, dz, speedOf(actor, opts && opts.speed));
      return true;
    },
    stop: function (actor) { if (!actor || !H.hold) return false; H.hold(actor); return true; },
    face: function (actor, x, z) { if (actor && H.face) H.face(actor, x, z); return true; },
    posture: function (actor, p) {
      if (!actor) return false;
      if (p === "aim") { if (H.drawGun) H.drawGun(actor); actor._gunLowered = false; return true; }
      if (p === "stand") return true;
      return false;                         // officers don't kneel/cower in this executor
    },
    say: function (actor, line, opts) {
      if (!H.say || !line) return false;
      return !!H.say(actor, line, (opts && opts.secs) || 2.2);
    },
    verb: function (name, a, b, opts) { return lawVerb(name, a, b, opts); },
  };
  // restrain/cuff/arrest -> the EXISTING arrest flows; tackle -> the predator
  // seize (player) or a knockdown (NPC). Anything else is not ours.
  function lawVerb(name, a, b, opts) {
    if (!a || !b) return false;
    if (name === "restrain" || name === "cuff" || name === "arrest") {
      if (isPlayerActor(b)) {
        if (g.busted) return true;
        if (typeof CBZ.cityBust !== "function") return false;
        CBZ.cityBust({ cop: a, peaceful: !(opts && opts.violent) });
        return true;
      }
      if (typeof CBZ.cityNpcArrest === "function") {
        CBZ.cityNpcArrest(b);
        a.npcTarget = null; a.curTarget = null;
        return true;
      }
      return false;
    }
    if (name === "tackle") {
      if (L.tackleCD > 0 || a._seizing) return false;
      if (isPlayerActor(b)) {
        if (!H.tackle || !H.tackle(a)) return false;
      } else {
        if (b.dead) return false;
        b.ko = Math.max(b.ko || 0, 2.2);     // down on the pavement = prone = compliant
        if (CBZ.body && CBZ.body.hit) { try { CBZ.body.hit(b, { fromX: a.pos.x, fromZ: a.pos.z, force: 3.5, knockdown: 1.4 }); } catch (e) {} }
      }
      L.tackleCD = TACKLE_CD;
      return true;
    }
    return false;                             // no taser in this city; the brain takes the next rung
  }
  L.verb = lawVerb;
  L.tackleCD = 0;
  L.executor = EXEC;

  let _execFor = null;
  function installExecutor(force) {
    const b = B();
    if (!b || !b.act || typeof b.act.use !== "function") return false;
    if (_execFor === b && !force) return true;
    try { b.act.use(GAME, EXEC); _execFor = b; } catch (e) { return false; }
    return true;
  }
  L.installExecutor = installExecutor;

  // ============================================================
  //  ENLIST / DISCHARGE — every body in CBZ.cityCops is a brain actor.
  // ============================================================
  // every body this file put into the brain. Other files take officers OFF
  // the street without telling police.js (regimes.js turns a force into
  // civilians, power.js recalls its guard); the sweep in frame() discharges
  // anything that is no longer in CBZ.cityCops so the brain never keeps a
  // ghost "cop" hearing gunshots.
  const ENLISTED = [];
  let _sweepT = 0;
  function sweepEnlisted(dt) {
    _sweepT -= dt; if (_sweepT > 0) return;
    _sweepT = 2;
    const cops = CBZ.cityCops;
    for (let i = ENLISTED.length - 1; i >= 0; i--) {
      const c = ENLISTED[i];
      if (!c || c.dead || !cops || cops.indexOf(c) < 0) L.discharge(c);
    }
  }
  L.enlisted = function () { return ENLISTED.length; };
  L.enlist = function (c) {
    if (!c || c._lawReg) return;
    const b = B(); if (!b || typeof b.register !== "function") return;
    const K = lawOf(c);
    try {
      b.register(c, c.swat ? "swat" : "cop", {
        faction: "police", game: GAME,
        // a trained officer: steady, not a hothead; SWAT steadier still
        personality: {
          courage: c.swat ? 0.85 : 0.6 + hash01(K.id, 3) * 0.25,
          aggression: 0.35 + hash01(K.id, 4) * 0.2,
          discipline: c.swat ? 0.9 : 0.7 + hash01(K.id, 5) * 0.2,
          curiosity: 0.6, loyalty: 0.8,
        },
      });
      const r = b.of ? b.of(c) : c._brain;
      if (r) r.game = GAME;
      c._lawReg = true;
      ENLISTED.push(c);
    } catch (e) { /* the brain refused: the cop still runs, just un-registered */ }
  };
  L.discharge = function (c) {
    if (!c) return;
    const b = B();
    if (c._lawReg && b) {
      try { if (b.authority && b.authority.cancel) b.authority.cancel(c); } catch (e) {}
      try { if (b.unregister) b.unregister(c); } catch (e) {}
    }
    c._lawReg = false;
    const ei = ENLISTED.indexOf(c); if (ei >= 0) ENLISTED.splice(ei, 1);
    dropPrimary(c);
    if (c._law) { c._law.suspect = null; c._law.phase = null; }
  };

  // ============================================================
  //  PERCEPTION — one implementation (the brain's). Fallbacks only for a
  //  build where the brain did not load at all.
  // ============================================================
  // two option records, never mutated into each other: a tracking look (no
  // cone, no light — a man you are chasing is not lost by turning your head)
  // and a noticing look (the archetype's cone + light apply: no keys set).
  const _engOpts = { range: 40, fovHalf: Math.PI, eyeY: 1.5, targetY: 1.2, light: ONE };
  const _coneOpts = { range: 40, eyeY: 1.5, targetY: 1.2 };
  const _ptOpts = { range: 30, eyeY: 1.5, targetY: 1.0 };
  function ONE() { return 1; }
  function fallbackLos(c, x, y, z) {
    if (!CBZ.clearLineOfFire) return true;
    try { return CBZ.clearLineOfFire(c.pos.x, (c.pos.y || 0) + 1.5, c.pos.z, x, y, z); } catch (e) { return true; }
  }
  L.sight = function (c, target, range, engaged) {
    if (!c || !c.pos || !target || !target.pos) return false;
    const dx = target.pos.x - c.pos.x, dz = target.pos.z - c.pos.z;
    if (dx * dx + dz * dz > range * range) return false;
    const b = B();
    if (b && b.perception && b.perception.sees) {
      const o = engaged ? _engOpts : _coneOpts;
      o.range = range;
      o.targetY = isPlayerActor(target) ? 1.4 : 1.2;
      let r = false;
      try { r = !!b.perception.sees(c, target, o); } catch (e) { r = false; }
      if (r && b.memory && b.memory.see) { try { b.memory.see(c, target); } catch (e) {} }
      return r;
    }
    return fallbackLos(c, target.pos.x, 1.2, target.pos.z);
  };
  L.seesPoint = function (c, x, z, range) {
    if (!c || !c.pos) return false;
    const dx = x - c.pos.x, dz = z - c.pos.z;
    if (dx * dx + dz * dz > range * range) return false;
    const b = B();
    if (b && b.perception && b.perception.seesPoint) {
      _ptOpts.range = range;
      try { return !!b.perception.seesPoint(c, x, 1.0, z, _ptOpts); } catch (e) { return false; }
    }
    return fallbackLos(c, x, 1.0, z);
  };
  // ACQUISITION: an officer who is not already on you has to NOTICE you — the
  // awareness meter fills faster close, centre-of-cone, lit and moving. Called
  // on the retarget beat, so dt is the time since his last look.
  const _acqOpts = { range: 48 };
  L.acquire = function (c, target, range) {
    if (!c || !target || !target.pos) return false;
    const K = lawOf(c);
    const dt = K.acqT < -1e8 ? 0.2 : Math.max(0, Math.min(1.0, T - K.acqT)); K.acqT = T;   // a first look is a glance, not a free second
    // right on top of him: footsteps and breathing, no cone needed
    if (L.sight(c, target, 5, true)) return true;
    const b = B();
    if (b && b.perception && b.perception.awareness) {
      _acqOpts.range = range || 48;
      let a = 0;
      try { a = +b.perception.awareness(c, target, dt, _acqOpts) || 0; } catch (e) { a = 0; }
      if (a >= 1) { if (b.memory && b.memory.see) { try { b.memory.see(c, target); } catch (e) {} } return true; }
      return false;
    }
    return L.sight(c, target, range || 48, false);
  };
  // lastSeen for an officer (brain memory), or null
  L.lastSeen = function (c, target) {
    const b = B();
    if (!b || !b.memory || !b.memory.lastSeen) return null;
    try { return b.memory.lastSeen(c, target) || null; } catch (e) { return null; }
  };

  // ============================================================
  //  HEARING — CBZ.cityGunshot is the door city GUNFIRE goes through to become
  //  noise (the player's shots via wanted.js "shots-fired", every police round,
  //  Air-1's carbine). It hands the bang to the street's hearBang (brain_city:
  //  adopts the bodies in earshot, then brain.perception.noise), so the city
  //  has one noise call site; cityPanic (peds.js) takes the same road for the
  //  street's own scares. Throttled per shooter so an SMG burst is one event.
  // ============================================================
  const HEAR_KIND = { gunshot: 1, explosion: 1, scream: 1, fight: 1, alarm: 1, glass: 1 };
  CBZ.cityGunshot = L.gunshot = function (x, z, shooter, loudness, kind) {
    const b = B();
    if (!b || !b.perception || !b.perception.noise || !isFinite(x) || !isFinite(z)) return false;
    if (shooter) {
      if (shooter._lawShotT != null && T - shooter._lawShotT < 0.35) return false;
      shooter._lawShotT = T;
    }
    const loud = loudness || 48, k = kind || "gunshot";
    try {
      const CB = CBZ.cityBrain;
      if (CB && typeof CB.hearBang === "function") CB.hearBang(x, z, loud, k, shooter || null);
      else b.perception.noise(x, z, loud, k, shooter || null);
    } catch (e) { return false; }
    return true;
  };
  // a fresh, unhandled loud noise this officer heard (after his reaction delay)
  L.heard = function (c) {
    const b = B();
    if (!b || !b.memory || !b.memory.heard) return null;
    let h = null;
    try { h = b.memory.heard(c); } catch (e) { h = null; }
    if (!h || !HEAR_KIND[h.kind]) return null;
    const now = b.now ? b.now() : T;
    if (now - h.t > HEAR_FRESH) return null;
    const K = lawOf(c);
    if (K.heardT === h.t) return null;                 // already acted on this one
    if (now - h.t < K.react) return null;              // he hasn't turned his head yet
    K.heardT = h.t;
    return h;
  };

  // ============================================================
  //  THE SUSPECT'S STATE — what the officer can read off the body.
  //  There is no surrender key in the city, so COMPLIANCE = standing still with
  //  the weapon put away for COMPLY_STILL seconds (hands shown). interact.js's
  //  "Surrender" row is the instant voluntary version (g._citySurrender).
  // ============================================================
  const PS = { speed: 0, handsUp: false, kneeling: false, prone: false, armed: false, aiming: false, attacking: false, stillT: 0, aimAny: false, aimAt: null, aimT: 0 };
  L.player = PS;
  function samplePlayer(dt) {
    const P = CBZ.player;
    if (!P) return;
    const driving = !!P.driving;
    const sp = driving ? Math.max(8, Math.abs((P._vehicle && P._vehicle.v) || 8)) : (+P.speed || 0);
    PS.speed = sp;
    PS.armed = !!(H.openCarry && H.openCarry());
    PS.stillT = (!driving && !P.dead && sp < 0.6) ? PS.stillT + dt : 0;
    PS.handsUp = !!g._citySurrender || (!PS.armed && PS.stillT >= COMPLY_STILL);
    PS.kneeling = false;
    PS.prone = false;
    const nowMs = CBZ.now || 0;
    PS.attacking = (P._fighting || 0) > 0 || (nowMs - (g._copsFiredUponT || -1e9)) < 2500;
    PS.aimAny = PS.armed && !!(CBZ.isAimingWeapon && CBZ.isAimingWeapon());
    if (PS.aimAny) {
      PS.aimT -= dt;
      if (PS.aimT <= 0 && typeof CBZ.aimedActor === "function") {
        PS.aimT = 0.15;
        let a = null; try { a = CBZ.aimedActor(120); } catch (e) { a = null; }
        PS.aimAt = a && a.actor ? a.actor : null;
      }
    } else { PS.aimAt = null; PS.aimT = 0; }
  }
  const _SS = { speed: 0, handsUp: false, kneeling: false, prone: false, armed: false, aiming: false, attacking: false, fled: false, dist: 0, seen: true };
  // is the player pointing the gun at THIS officer? (raycast target, or the body
  // squared up on him inside ~20 degrees)
  function aimingAt(c) {
    if (!PS.aimAny) return false;
    if (PS.aimAt === c) return true;
    const P = CBZ.player, pc = CBZ.playerChar;
    if (!P || !pc || !pc.group) return false;
    const dx = c.pos.x - P.pos.x, dz = c.pos.z - P.pos.z;
    const want = Math.atan2(dx, dz);
    let d = want - pc.group.rotation.y;
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) < 0.35;
  }
  L.playerState = function (c, fled) {
    _SS.speed = PS.speed; _SS.handsUp = PS.handsUp; _SS.kneeling = PS.kneeling; _SS.prone = PS.prone;
    _SS.armed = PS.armed; _SS.aiming = aimingAt(c); _SS.attacking = PS.attacking; _SS.fled = !!fled;
    return _SS;
  };
  L.pedState = function (p, c, fled) {
    _SS.speed = +p.speed || 0;
    _SS.handsUp = !!(p.surrender || p.poseHandsUp || (p.char && p.char.handsUp));
    _SS.kneeling = false;
    _SS.prone = (p.ko || 0) > 0;
    _SS.armed = !!p.armed;
    _SS.aiming = !!(p.armed && p.rage === c);
    _SS.attacking = !!(p.rage && (p.rage === c || p.rage.kind === "cop" || p.state === "fight"));
    _SS.fled = !!fled;
    return _SS;
  };

  // ============================================================
  //  ROE — the wanted level sets the rules of engagement.
  //   "shoot"     no ladder: lethal now (deep heat, fired upon, a gunfight)
  //   "lethal"    the ladder runs, and may go lethal if he's armed + threatening
  //   "nonlethal" the ladder runs to cuffs / takedown, never a bullet
  // ============================================================
  L.roe = function (c, tgt, isPlayer, stars, firedUpon, arrestFirst) {
    if (isPlayer) {
      if (!arrestFirst) return stars >= 2 ? "shoot" : "lethal";   // no Chief holding the stand-down order
      if (stars >= 4 || firedUpon) return "shoot";
      if (stars >= 3 || c.swat) return "lethal";
      return "nonlethal";
    }
    // an NPC offender
    const fighting = !!(tgt.rage && tgt.state === "fight");
    if ((tgt.npcWanted | 0) >= 3 || (tgt.armed && fighting)) return "shoot";
    if (tgt.armed || (tgt.aggr || 0) >= 0.85 || (tgt.npcWanted | 0) >= 2) return "lethal";
    return "nonlethal";
  };

  // ============================================================
  //  ONE VOICE PER SUSPECT — the primary officer runs the ladder.
  // ============================================================
  const PRIM = new Map();          // suspect -> { cop, seenT }
  function dropPrimary(c) {
    PRIM.forEach(function (rec, s) { if (rec.cop === c) PRIM.delete(s); });
  }
  function primaryFor(suspect, c, sees) {
    let rec = PRIM.get(suspect);
    if (rec) {
      const pc = rec.cop;
      const gone = !pc || pc.dead || pc.culled || pc.giveUp || (pc._law && pc._law.suspect !== suspect);
      if (gone || (sees && pc !== c && T - rec.seenT > PRIMARY_LOST)) { PRIM.delete(suspect); rec = null; }
    }
    if (!rec) { rec = { cop: c, seenT: T }; PRIM.set(suspect, rec); }
    if (rec.cop === c && sees) rec.seenT = T;
    return rec.cop;
  }
  L.primary = function (suspect) { const r = PRIM.get(suspect); return r ? r.cop : null; };

  // WHAT HE SAYS. brain.authority speaks its own ladder lines (warn / order /
  // approach / cuff / escalate / force / lethal) through act.say, which lands
  // on police.js's copSay. The city adds ONE thing the prison never needed:
  // THE STAKES, said out loud a beat after the first order, because what
  // getting caught costs is decided by the stars (wanted.js: 1-2 stars is a
  // fine and a release at the precinct, 3+ is County).
  function stakesLine(c) {
    if (c.swat) return null;
    return (g.wanted | 0) >= 3 ? "You're going to County for this." : "Make it easy on yourself. It's just a fine.";
  }
  // degraded speech (no brain.authority loaded at all)
  function fallbackLine(c, ph) {
    switch (ph) {
      case "warn": return "Police! Stop right there!";
      case "order": return "Hands where I can see them!";
      case "escalate": return "STOP! Stop running!";
      case "lethal": return "Drop the weapon! DROP IT!";
    }
    return null;
  }
  // true when the line was actually spoken (the brain holds a 0.9 s gap
  // between one mouth's lines so two never overlap)
  function sayNow(c, line) {
    if (!line) return true;
    const b = B();
    if (b && b.act && b.act.say) { try { return !!b.act.say(c, line, { secs: 2.4 }); } catch (e) { return false; } }
    return EXEC.say(c, line, { secs: 2.4 });
  }
  let _hintT = -1e9;
  function onPhase(c, suspect, ph, isPlayer, hasAuth) {
    const K = lawOf(c);
    if (!hasAuth) sayNow(c, fallbackLine(c, ph));
    if (isPlayer && ph === "order") {
      if (!K.stakesSaid) K.stakeAt = T + 1.4;
      if (T - _hintT > 30 && CBZ.city && CBZ.city.note) {
        _hintT = T;
        CBZ.city.note("Stand still with your gun away to be cuffed. Run and he takes you down. Point it at him and he shoots.", 3.2);
      }
    }
  }

  // ============================================================
  //  DECIDE — one officer, one suspect, one frame. Returns a reused record:
  //   mode:   "cover" | "hold" | "approach" | "cuffing" | "chase" | "lethal" | "none"
  //   lethal: may fire; primary: this officer runs the ladder.
  //  brain.authority.step() moves/faces the PRIMARY itself (through act ->
  //  the city-law executor); police.js only walks him when the brain didn't
  //  (L.acted), and always walks the cover officers.
  // ============================================================
  const DEC = { mode: "none", phase: null, lethal: false, lowered: true, primary: false };
  L.decide = function (c, suspect, dt, st, opts) {
    DEC.mode = "none"; DEC.phase = null; DEC.lethal = false; DEC.lowered = true; DEC.primary = false;
    if (!c || !suspect) return DEC;
    opts = opts || {};
    const roe = opts.roe || "nonlethal";
    const isPlayer = isPlayerActor(suspect);
    const K = lawOf(c);
    if (roe === "shoot") {                    // no ladder at this heat
      L.release(c);
      DEC.mode = "lethal"; DEC.phase = "lethal"; DEC.lethal = true; DEC.lowered = false;
      return DEC;
    }
    const b = B();
    const auth = b && b.authority && b.authority.step ? b.authority : null;
    // new suspect or a changed ROE = a new case (the ladder restarts from the top
    // only when the RULES changed, not every time he blinks)
    if (K.suspect !== suspect || K.roe !== roe) {
      if (auth && K.suspect) { try { auth.cancel(c); } catch (e) {} }
      K.suspect = suspect; K.roe = roe; K.phase = null; K.phaseT = 0; K.pendT = 0; K.adoptT = 0;
      K.cuffAsked = false; K.stakeAt = 0; K.stakesSaid = false;
      if (auth) {
        try {
          auth.begin(c, suspect, opts.reason || (isPlayer ? "wanted" : "offender"), {
            roe: roe, warnRange: WARN_R, orderRange: ORDER_R, cuffRange: CUFF_R,
            patience: c.swat ? 1.5 : (roe === "lethal" ? 4 : 6),
            // the same man challenged again inside a minute gets less patience;
            // the takedown is arm's reach, as often as the force-wide cooldown allows
            rechallenge: true, tackleRange: TACKLE_R, tackles: Infinity,
          });
        } catch (e) {}
      }
    }
    // ---- the cover officers: hold the ring, adopt the primary's escalation late
    const prim = primaryFor(suspect, c, !!opts.sees);
    if (prim !== c) {
      const pp = prim._law && prim._law.phase;
      if (pp === "lethal" || pp === "force" || pp === "escalate") {
        K.adoptT += dt;
        if (K.adoptT >= K.react) {
          DEC.phase = pp;
          DEC.lethal = pp === "lethal" && roe !== "nonlethal";
          DEC.mode = DEC.lethal ? "lethal" : "chase";
          DEC.lowered = !DEC.lethal;
          return DEC;
        }
      } else K.adoptT = 0;
      DEC.mode = "cover"; DEC.phase = pp || "observe";
      c._challenged = !!pp && pp !== "observe" && pp !== "done";
      return DEC;
    }
    DEC.primary = true;
    // ---- the primary runs the ladder
    st.dist = opts.dist; st.seen = opts.sees !== false;
    let ph;
    if (auth) {
      let res = null;
      try { res = auth.step(c, dt, st); } catch (e) { res = null; }
      ph = (res && res.phase) || K.phase || "observe";
    } else {
      // no brain loaded: the bare minimum so an officer is never inert
      const still = st.handsUp || st.prone || (st.speed || 0) < 0.6;
      ph = still && !st.armed ? ((opts.dist || 0) <= CUFF_R ? "cuff" : "approach") : ((st.speed || 0) > 2.2 ? "escalate" : "order");
    }
    // ---- hysteresis on the one decision that matters most: the brain may
    // drop lethal the moment the muzzle dips; the man keeps his gun up for
    // LETHAL_HOLD, and he only goes lethal after his own reaction time.
    const was = K.phase;
    if (ph === "lethal" && was !== "lethal") {
      K.pendT += dt;
      if (K.pendT < K.react) ph = was || "order";          // his reaction time, not the brain's frame
    } else if (ph !== "lethal") K.pendT = 0;
    // ...and once his gun is up it stays up LETHAL_HOLD after the threat ends
    if (was === "lethal" && ph !== "lethal") { K.calmT += dt; if (K.calmT < LETHAL_HOLD) ph = "lethal"; }
    else K.calmT = 0;
    if (ph !== was) { K.phase = ph; K.phaseT = 0; if (ph === "lethal") K.pendT = 0; onPhase(c, suspect, ph, isPlayer, !!auth); }
    else K.phaseT += dt;
    // the stakes, a beat after the first order (retried until his mouth is free)
    if (K.stakeAt && T >= K.stakeAt && !K.stakesSaid) {
      if (!(ph === "order" || ph === "approach" || ph === "warn" || ph === "cuff") || T - K.stakeAt > 3) { K.stakesSaid = true; K.stakeAt = 0; }
      else if (sayNow(c, stakesLine(c))) { K.stakesSaid = true; K.stakeAt = 0; }
    }
    DEC.phase = ph;
    c._challenged = ph !== "observe" && ph !== "done";
    switch (ph) {
      case "observe": case "warn": case "order": DEC.mode = "hold"; break;
      case "approach": DEC.mode = "approach"; break;
      case "cuff":
        DEC.mode = "cuffing";
        // the brain calls act.verb("restrain") itself on entering cuff; if it
        // hasn't landed a beat later (verb declined, no brain), he does it himself.
        if (!K.cuffAsked && K.phaseT > 0.25) {
          K.cuffAsked = true;
          const done = isPlayer ? !!g.busted : !((suspect.npcWanted | 0) >= 1);
          if (!done) lawVerb("restrain", c, suspect, {});
        }
        break;
      case "done": DEC.mode = "none"; L.release(c); break;
      case "escalate": DEC.mode = "chase"; break;
      case "force":
        // the takedown is the brain's force rung: this city's executor answers
        // verb("tase") false, so the brain goes straight to verb("tackle")
        // (lawVerb) on any non-complier inside TACKLE_R
        DEC.mode = "chase";
        break;
      case "lethal":
        if (roe === "nonlethal") { DEC.mode = "chase"; break; }   // never a bullet under nonlethal ROE
        DEC.mode = "lethal"; DEC.lethal = true; DEC.lowered = false; break;
      default: DEC.mode = "hold";
    }
    return DEC;
  };
  // the case is over for this officer (back on the beat / target changed)
  L.release = function (c) {
    if (!c || !c._law) return;
    const K = c._law;
    if (K.suspect) {
      const b = B();
      if (b && b.authority && b.authority.cancel) { try { b.authority.cancel(c); } catch (e) {} }
      const r = PRIM.get(K.suspect);
      if (r && r.cop === c) PRIM.delete(K.suspect);
    }
    K.suspect = null; K.roe = null; K.phase = null; K.phaseT = 0; K.pendT = 0; K.adoptT = 0; K.cuffAsked = false; K.stakeAt = 0; K.stakesSaid = false; K.calmT = 0;
    c._challenged = false;
  };

  // ============================================================
  //  WITNESS REPORTS -> WANTED (the subscriber). brain.social decides who saw
  //  what and how long the call takes; this turns a landed call into heat /
  //  a city offender after dispatch processes it, at the LAST-KNOWN position.
  // ============================================================
  const QUEUE = [];                // pending dispatches (bounded)
  const QMAX = 24;
  function reportHeat(r) {
    const o = r.opts || {};
    const h = r.heat != null ? +r.heat : (o.heat != null ? +o.heat : null);
    if (h != null && isFinite(h)) return h;
    const s = Math.max(0, Math.min(1, +r.severity || 0));
    return Math.round(8 + 152 * s);
  }
  function reportType(r) {
    const o = r.opts || {};
    return r.type || o.type || r.kind || "assault";
  }
  function witnessIsCop(w) { return !!(w && (w.kind === "cop" || (w._brain && w._brain.game === GAME))); }
  L.onWitnessReport = function (r) {
    if (!r || !r.perp) return false;
    if (g.mode && g.mode !== "city") return false;
    if (witnessIsCop(r.witness)) return false;       // an officer who saw it radioed it in on the spot
    if (QUEUE.length >= QMAX) QUEUE.shift();
    // where does dispatch think he is? the witness's own last sighting of him
    // (brain memory) beats the spot the crime happened; never his true position
    let lx = r.x, lz = r.z;
    const seen = r.witness ? L.lastSeen(r.witness, r.perp) : null;
    if (seen && isFinite(seen.x) && isFinite(seen.z)) { lx = seen.x; lz = seen.z; }
    const delay = DISPATCH_MIN + hash01(QUEUE.length + ((T * 10) | 0), 11) * (DISPATCH_MAX - DISPATCH_MIN);
    QUEUE.push({ at: T + delay, perp: r.perp, heat: reportHeat(r), type: reportType(r), x: lx, z: lz });
    return true;
  };
  CBZ.cityWitnessReport = L.onWitnessReport;
  function tickDispatch() {
    for (let i = 0; i < QUEUE.length; i++) {
      const q = QUEUE[i];
      if (q.at > T) continue;
      QUEUE.splice(i, 1); i--;
      if (isPlayerActor(q.perp)) {
        if (H.report) { try { H.report(q.heat, { type: q.type, x: q.x, z: q.z }); } catch (e) {} }
      } else if (q.perp && !q.perp.dead) {
        q.perp._lawReportT = T; q.perp._lawReportX = q.x; q.perp._lawReportZ = q.z;
        if (H.npcOffense) { try { H.npcOffense(q.perp, q.heat, q.type); } catch (e) {} }
      }
    }
  }
  L.pending = function () { return QUEUE.length; };
  L.reportedRecently = function (p, within) { return p && p._lawReportT != null && T - p._lawReportT < (within || 30); };

  let _subFor = null, _unsub = [];
  function hookReports() {
    const b = B();
    if (!b || !b.social || typeof b.social.onReport !== "function") return false;
    if (_subFor === b) return true;
    for (const u of _unsub) { try { if (typeof u === "function") u(); } catch (e) {} }
    _unsub = [];
    try { _unsub.push(b.social.onReport("city", L.onWitnessReport)); } catch (e) {}
    try { _unsub.push(b.social.onReport(GAME, L.onWitnessReport)); } catch (e) {}
    _subFor = b;
    return true;
  }
  L.hookReports = hookReports;

  // ---- a cop who SAW the crime (instant radio) — brain perception, not a flat radius
  L.copWitness = function (x, z) {
    const cops = CBZ.cityCops || [];
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (!c || c.dead || c._airPilot || c._swatPassenger) continue;
      if (L.seesPoint(c, x, z, 30)) return c;
    }
    return null;
  };

  // ============================================================
  //  FRAME — once per frame (own update slot in the browser; tests call it).
  // ============================================================
  L.frame = function (dt) {
    if (!(dt > 0) || dt > 0.5) dt = dt > 0.5 ? 0.05 : 0;
    T += dt; F++;
    if (L.tackleCD > 0) L.tackleCD = Math.max(0, L.tackleCD - dt);
    installExecutor(false);
    hookReports();
    samplePlayer(dt);
    tickDispatch();
    sweepEnlisted(dt);
    if (g._citySurrender && (!CBZ.player || CBZ.player.dead || !g.busted && (g.wanted | 0) === 0)) g._citySurrender = false;
  };
  L.reset = function () {
    QUEUE.length = 0; PRIM.clear(); L.tackleCD = 0; PS.stillT = 0; g._citySurrender = false;
  };
  if (typeof CBZ.onUpdate === "function") {
    CBZ.onUpdate(32.7, function (dt) { if (g.mode === "city") L.frame(dt); });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = L;
})();
