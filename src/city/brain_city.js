/* ============================================================
   city/brain_city.js — the city street as a CONFIGURATION of CBZ.brain.

   The street used to decide everything in private: peds.js rolled its own
   witness table (snitchPropensity + a 30 m disc that tagged everyone, eyes
   or no eyes), its own flee/film/cower dice off an aggression band, and a
   crowd panic that bolted every body in range ON THE SAME FRAME; gangs.js ran
   its own "lost as many as are standing" rout rule and its own -100..100
   standing counter; aigoals.js kept a private expiring grudge slot. CBZ.brain
   is the one decision layer every game shares; this file is the city's seam
   onto it and the ONLY place the street speaks brain:

     • adopt(ped)      registers a street body — pedestrian, ganger, crew (the
                       player's people) or soldier — with a personality read off
                       castTraits, a faction (civilians / gang:<id> / org:<id> /
                       player) and a clique that is also its morale group; a
                       set's boss is its clique leader. Idempotent and
                       allocation-free when nothing changed; a recycled crowd
                       rig (new name) or a recruited civilian re-registers.
     • executor        act.use("city", …): the brain moves a city body through
                       peds.js's EXISTING fields (finalGoal/path/target/state)
                       and its existing melee (rage → the combat_iq beat in
                       move()). Movement internals are the MOVES lead's; the
                       melee animation is the VERBS lead's.
     • crime(...)      a crime on the street → social.crime: witnesses are the
                       bodies that could SEE it (cone, range, walls) or HEAR it,
                       each picks flee/film/report/intervene/cower by
                       personality, and the city's omerta (gang turf, a set
                       never ratting its own block) thins the callers.
     • think(ped, …)   the per-ped consumer: a heard bang or a witness record
                       becomes a flee / film / cower / report / intervene after
                       a REACTION DELAY (distance + personality + a stable per-
                       body offset: nobody reacts on the same frame), and a
                       chosen reaction DWELLS — only a more urgent one may cut
                       it short (a gawker the gun walks towards runs; a runner
                       never turns back into a gawker).
     • threat(ped, …)  fight/flee/freeze/cover/surrender through threat.respond,
                       with the street's panic field fed in as morale rattle:
                       ONE RUNNER SETS OTHERS RUNNING, a ripple, not a flip.
     • retaliate(...)  a hit on a ganger/soldier → social.retaliate; the answer
                       is PROPORTIONAL (glare / shove / fists / the gun) and the
                       man told "fists" draws only if it stops being a fist fight.
     • memberDown / broken   morale.death on the set; morale.broken is the rout.
     • standing        brain.rep per gang faction IS the player's standing with
                       that set; gang.standing is only its persisted mirror.
     • grudge          aigoals' NPC-vs-NPC feud slot → memory.grudge.

   Degrade-safe: with CBZ.brain absent every entry point returns false/-1 and
   the caller's thin remainder runs. Loads under plain node
   (tools/brain-sim-city.mjs builds fake peds against the real brain).
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis.window;
  const CBZ = W && W.CBZ;
  if (!CBZ) { if (typeof module !== "undefined") module.exports = null; return; }
  const GAME = "city";
  const g = CBZ.game || (CBZ.game = {});

  function BR() { return CBZ.brain || null; }
  function PA() { return CBZ.city && CBZ.city.playerActor; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function now() { const b = BR(); return b ? b.now() : (CBZ.now || 0) / 1000; }
  function posOf(a) { return a && (a.pos || (a.group && a.group.position)) || null; }
  function isPlayerActor(a) { return !!(a && (a.isPlayer || a === PA() || a === CBZ.player)); }
  function playerArmed() { return !!(CBZ.cityHasGun && CBZ.cityHasGun()); }
  function armedOf(a) { return isPlayerActor(a) ? playerArmed() : !!(a && a.armed); }
  function lerpAngle(a, b, t) {
    if (CBZ.lerpAngle) return CBZ.lerpAngle(a, b, t);
    let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
  }
  // STABLE per-body jitter: the same person is always the quick one or the slow
  // one. Keyed on the NAME (a recycled crowd rig gets a new name, so a new
  // temperament) — a fresh die per decision is what makes crowds read fake.
  function hash01(a, salt) {
    const s = (a && a.name) || "";
    let h = 2166136261 ^ (salt | 0);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  // ============================================================
  //  THE STREET'S ARCHETYPE. The brain's generic civilian, tuned to a city
  //  where half the pavement has a phone out: more gawkers, fewer ducking for
  //  cover (there is no trained instinct to find a wall — people RUN).
  // ============================================================
  let _defined = false;
  function defineOnce() {
    const b = BR();
    if (_defined || !b || !b.define) return;
    _defined = true;
    b.define("pedestrian", Object.assign({}, b.archetype("civilian"), {
      viewDist: 30,
      witness: { flee: 0.32, film: 0.2, report: 0.2, intervene: 0.05, cower: 0.12, ignore: 0.14, cheer: 0 },
      threat: { cover: -0.25, flee: 0.05 },
    }));
  }

  // ============================================================
  //  WHO A STREET BODY IS, TO THE BRAIN
  // ============================================================
  function isCrew(p) { return !!(p.companion || p.recruited || p.faction === "player" || p._compoundCrew); }
  function archOf(p) {
    if (isCrew(p)) return "crew";
    if (p.gang) return "ganger";
    if (p.milRank || p.kind === "military" || p.organization) return "soldier";
    return "pedestrian";
  }
  function sideOf(p) {
    if (isCrew(p)) return "player";
    if (p.gang) return "gang:" + p.gang;
    if (p.organization) return "org:" + p.organization;
    return "civilians";
  }
  function groupOf(p) {                        // clique == morale group (a body of people)
    if (p._compoundCrew) return "compound:" + p._compoundCrew;
    if (isCrew(p)) return "crew:player";
    if (p.gang) return "gang:" + p.gang;
    if (p.organization) return "org:" + p.organization;
    if (p.cliqueId) return "clq:" + p.cliqueId;
    return null;
  }
  function isLeader(p) {
    if (p.isBoss || p.rank === "boss") return true;
    if (p.gang && CBZ.cityGangById) { const G = CBZ.cityGangById(p.gang); if (G && G.boss === p) return true; }
    return false;
  }
  function personalityOf(p) {
    const T = CBZ.castTraits;
    const out = T && T.personality ? T.personality(p)
      : { courage: clamp01(0.2 + (p.aggr || 0.35) * 0.7), aggression: p.aggr || 0.35, discipline: 0.5, curiosity: 0.4, loyalty: 0.5 };
    // RANK IS NERVE: the brass are the last to break
    if (isLeader(p)) out.discipline = Math.max(out.discipline, 0.9);
    else if (p.rank === "lt" || p.rank === "enforcer") out.discipline = Math.max(out.discipline, 0.75);
    if (p.gang && CBZ.cityMemberLoyalty) out.loyalty = clamp01(CBZ.cityMemberLoyalty(p));
    crewNerve(p, out);
    return out;
  }
  // YOUR CREW'S NERVE IS WHAT YOU INVESTED (city/loyalty.js): a man you armed,
  // paid and stood up for holds when the set around him wavers; a warm body on
  // a default pistol is the first to fall back. Re-read every faction sync.
  function crewNerve(p, pr) {
    if (!isCrew(p) || !CBZ.cityLoyaltyOf) return;
    const l = clamp01(CBZ.cityLoyaltyOf(p));
    pr.loyalty = Math.max(pr.loyalty, l);
    if (p._cbCourage0 == null) p._cbCourage0 = pr.courage;
    pr.courage = clamp01(p._cbCourage0 + (l - 0.4) * 0.35);
  }

  function adopt(p) {
    const b = BR();
    if (!b || !p || p.dead || p.isPlayer || p.kind === "cop" || p._parked) return null;
    if (p._detailBrain || p._protUnit) return p._brain || null;   // the protection detail brain owns these bodies (brain_protection.js)
    const s = p._cbSig;
    if (s && p._brain && p._brain.registered && s.name === p.name && s.gang === p.gang && s.crew === isCrew(p) &&
        s.cc === p._compoundCrew && s.clq === p.cliqueId && s.org === p.organization) return p._brain;
    defineOnce(); ensureExec();
    if (p._brain && p._brain.registered) { try { b.unregister(p); } catch (e) {} }
    if (s && s.name !== p.name) { p._cbCourage0 = null; p._feud = null; if (b.memory && b.memory.forget) { try { b.memory.forget(p); } catch (e) {} } }   // a new person in a recycled rig
    let rec = null;
    try {
      rec = b.register(p, archOf(p), { game: GAME, faction: sideOf(p), clique: groupOf(p), group: groupOf(p), leader: isLeader(p), personality: personalityOf(p) });
    } catch (e) { return null; }
    p._cbSig = { name: p.name, gang: p.gang, crew: isCrew(p), cc: p._compoundCrew, clq: p.cliqueId, org: p.organization };
    return rec;
  }
  function release(p) {
    const b = BR();
    if (b && p && p._brain && p._brain.registered) { try { b.unregister(p); } catch (e) {} }
    if (p) p._cbSig = null;
  }

  // ============================================================
  //  THE EXECUTOR — the brain's hands on a city body. It DECIDES nothing and
  //  EXECUTES nothing itself: a move is a ped.moveOrder (the CBZ.moves seam in
  //  peds.js move(): velocity, braking arrival, bounded turn, avoidance) and a
  //  facing is peds.js's held face request (turned at the motor's bounded rate).
  // ============================================================
  // a held facing through peds.js (cityPedFaceYaw -> move()'s motor turn);
  // the node sims have no peds.js, so there a partial lerp stands in
  function faceYaw(a, yaw, hold) {
    if (CBZ.cityPedFaceYaw) { CBZ.cityPedFaceYaw(a, yaw, hold || 0.6); return; }
    if (a.group) a.group.rotation.y = lerpAngle(a.group.rotation.y, yaw, 0.45);
  }
  function faceAt(a, x, z, hold) {
    const ap = posOf(a); if (!ap) return;
    const dx = x - ap.x, dz = z - ap.z;
    if (dx * dx + dz * dz < 0.01) return;
    faceYaw(a, Math.atan2(dx, dz), hold);
  }
  // the brain's move order: re-stamped every call; peds.js drops an order its
  // owner stopped re-issuing after 0.5 s, so a forgotten body never walks on
  function order(a, x, z, speed, stop) {
    let o = a.moveOrder;
    if (!o || !o._cb) o = a.moveOrder = { _cb: true, x: 0, z: 0, speed: 0, stop: 0.4, face: null, strafe: false, vffX: 0, vffZ: 0, leg: false, t: 0 };
    o.x = x; o.z = z; o.speed = speed; o.stop = stop; o.t = CBZ.now || 0;
    return o;
  }
  function dropOrder(a) { if (a && a.moveOrder && a.moveOrder._cb) a.moveOrder = null; }
  const EXEC = {
    moveTo: function (a, x, z, opts) {
      if (!a || a.dead) return false;
      let sp = opts && (opts.speedMps != null ? opts.speedMps : opts.speed);
      const base = a.baseSpeed || 1.5;
      if (typeof sp !== "number") sp = sp === "sprint" ? base * 2.4 : sp === "run" ? base * 2.2 : sp === "jog" ? base * 1.6 : base;
      order(a, x, z, sp, opts && opts.arrive != null ? Math.max(0.2, opts.arrive) : 0.4);
      if (opts && opts.flee) a.state = "flee";
      else if (a.state === "idle" || a.state === "sit") a.state = "walk";
      a.pause = 0;
      return true;
    },
    stop: function (a) {
      if (!a) return false;
      dropOrder(a);
      a.speed = 0; a.path = null; a.finalGoal = null;
      if (a.target && a.target.set && a.pos) a.target.set(a.pos.x, 0, a.pos.z);
      if (a.state !== "surrender" && a.state !== "sit") a.state = "idle";
      return true;
    },
    // NO 180-degree SNAPS: a held face request the motor turns at its bounded rate
    face: function (a, x, z) {
      if (!a || !a.pos) return false;
      faceAt(a, x, z, 0.6);
      return true;
    },
    posture: function (a, p) {
      if (!a) return false;
      if (p === "cower" || p === "crouch" || p === "kneel" || p === "prone") {
        a.poseCower = Math.max(a.poseCower || 0, 1.4);
        EXEC.stop(a);
      } else if (p === "handsUp") {
        if (!(CBZ.cityMarkGunpoint && CBZ.cityMarkGunpoint(a, 1.6))) { a.poseCower = Math.max(a.poseCower || 0, 1.2); EXEC.stop(a); }
      } else if (p === "aim") {
        a.poseAimBack = !!a.armed;
      } else if (p === "stand") {
        a.poseCower = 0; if (!a._covered) a.poseHandsUp = false; a.poseAimBack = false;
      }
      return true;
    },
    say: function (a, line, opts) {
      if (!(CBZ.citySay && a && a.group)) return false;
      CBZ.citySay(a, line, (opts && opts.color) || null, (opts && opts.secs) || 2.2);
      return true;
    },
    // The city's own verb is its melee: a ped with a rage runs the combat_iq
    // beat inside move()/npcAttack. "shove" has no NPC-side animation in this
    // game yet (VERBS lead) — the fallback squares up and says it.
    verb: function (name, a, b, opts) {
      if (!a || a.dead || !b || b.dead) return false;
      const bp = posOf(b);
      if (name === "punch" || name === "attack" || name === "fight") {
        a.rage = b; a.state = "fight"; if (a.target && a.target.set && bp) a.target.set(bp.x, 0, bp.z);
        return true;
      }
      if (name === "shove") {
        a.state = "confront"; if (a.target && a.target.set && bp) a.target.set(bp.x, 0, bp.z);
        a._cbShoveT = 2.5;
        say(a, pickLine(a, SHOVE_LINES), 1.6);
        return true;
      }
      return false;
    },
  };
  let _execFor = null;
  function ensureExec() {
    const b = BR();
    if (!b || _execFor === b || !b.act || !b.act.use) return;
    try { b.act.use(GAME, EXEC); _execFor = b; } catch (e) {}
    try { if (b.threat && b.threat.setCapability) b.threat.setCapability(capabilityOf, GAME); } catch (e) {}
  }
  function say(a, line, secs, color) {
    const b = BR();
    if (b && b.act && b.act.say) { try { if (b.act.say(a, line, { secs: secs || 2.2, color: color || null })) return; } catch (e) {} }
    else EXEC.say(a, line, { secs: secs, color: color });
  }

  const SHOVE_LINES = ["Back up.", "Get off him.", "Step off!"];
  const GLARE_LINES = ["You got a problem?", "Watch yourself.", "Keep walking.", "What?"];
  const STOP_LINES = ["Hey! HEY! Stop that!", "Leave him alone!", "Knock it off!", "I'm calling the cops!"];
  function pickLine(a, L) { return L[(hash01(a, 0x51A7 + ((now() * 3) | 0)) * L.length) | 0]; }

  // ============================================================
  //  REACTION TIMING — no same-frame crowds.
  //  Delay = how far the news has to travel + how long THIS person takes to
  //  process it + a stable per-body offset. A blast beside you is a reflex
  //  (~0.1 s); a shot heard across a plaza is a turn-and-look first.
  // ============================================================
  function reactDelay(p, dist, loud) {
    const pr = (p._brain && p._brain.personality) || {};
    let d = (loud ? 0.08 : 0.18) + Math.min(0.9, dist / 55) + hash01(p, 0x7EAC) * 0.5;
    d += (1 - (pr.discipline == null ? 0.5 : pr.discipline)) * 0.12;
    if (p.state === "chat" || p.state === "sit" || (p.char && p.char.sitting)) d += 0.3;   // mid-something
    return d;
  }

  // Priority for the dwell rule: a held reaction may only be cut short by a
  // MORE urgent one.
  const PRI = { ignore: 0, cheer: 0, hold: 0, stare: 0, film: 1, report: 1, intervene: 2, fight: 2, "fight-confront": 2,
    comply: 3, cover: 3, freeze: 3, cower: 3, flee: 4, surrender: 5 };
  function holding(p, t) { return !!(p._cbResp && t < (p._cbUntil || 0)); }
  function hold(p, resp, secs) { p._cbResp = resp; p._cbUntil = now() + secs; p._reactHold = secs; }

  // ============================================================
  //  PERFORM a response on a city body. th = { x, z, src, armed }.
  //  Returns true when the body is busy with it.
  // ============================================================
  const B0 = () => (CBZ.CITY && CBZ.CITY.aggro) || {};
  function perform(p, resp, th) {
    const t = now();
    const cur = p._cbResp;
    if (holding(p, t) && resp !== cur && (PRI[resp] || 0) <= (PRI[cur] || 0)) return true;   // DWELL
    const src = th.src && !th.src.dead ? th.src : null;
    switch (resp) {
      case "flee": {
        if (cur === "flee" && holding(p, t)) return true;            // committed to the route
        p.rage = null;
        if (CBZ.cityFleeFrom) CBZ.cityFleeFrom(p, th.x, th.z); else p.state = "flee";
        p.fear = Math.max(p.fear || 0, 6);
        // CONTAGION: a runner is itself news — the panic field it raises is
        // what the NEXT body's morale reads (threat()).
        if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(p.pos.x, p.pos.z, 0.55);
        hold(p, "flee", 1.9 + hash01(p, 0xF1EE) * 1.4);
        return true;
      }
      case "freeze": case "cower": {
        EXEC.posture(p, "cower");
        p.pause = Math.max(p.pause || 0, 1.2);
        hold(p, "cower", 1.2 + hash01(p, 0xC0E4) * 1.2);
        p._cbAfter = "flee"; p._cbAfterX = th.x; p._cbAfterZ = th.z;   // after the cringe, they run
        return true;
      }
      case "cover": {
        // a civilian has no drill for cover: head down and away from it
        EXEC.posture(p, "cower");
        hold(p, "cover", 0.9 + hash01(p, 0xC0FE) * 0.6);
        p._cbAfter = "flee"; p._cbAfterX = th.x; p._cbAfterZ = th.z;
        return true;
      }
      case "surrender": case "comply": {
        if (CBZ.cityMarkGunpoint && CBZ.cityMarkGunpoint(p, 1.8)) { hold(p, resp, 1.8); return true; }
        return perform(p, "freeze", th);
      }
      case "hold": {
        EXEC.posture(p, "aim"); hold(p, "hold", 1.2);
        return true;
      }
      case "fight": {
        if (!src) return false;
        const sp = posOf(src);
        // SQUARING UP IS NOT SWINGING: an unarmed, merely bold body closes and
        // threatens first (confront) and only commits once that dwell lapses
        // with the threat still there. The truly violent go straight in.
        if (!p.armed && (p.aggr || 0) < (B0().crook || 0.72) && !(t - (p._cbConfrontT || -1e9) < 6)) {
          p.state = "confront"; if (p.target && p.target.set && sp) p.target.set(sp.x, 0, sp.z);
          p._cbConfrontT = t;
          hold(p, "fight-confront", 1.4 + hash01(p, 0xCF) * 1.2);
          return true;
        }
        p.rage = src; p.state = "fight";
        if (p.target && p.target.set && sp) p.target.set(sp.x, 0, sp.z);
        hold(p, "fight", 2.5);
        return true;
      }
      case "intervene": {
        if (!src) return false;
        const sp = posOf(src);
        EXEC.face(p, sp.x, sp.z);
        const pr = (p._brain && p._brain.personality) || {};
        // a TOUGH one steps in (fists for fists); an ordinary brave one shouts
        if ((pr.courage || 0) > 0.72 && (p.armed || !th.armed)) {
          if (!th.armed) holster(p);
          p.rage = src; p.state = "fight";
          hold(p, "intervene", 3);
        } else {
          p.state = "confront"; if (p.target && p.target.set) p.target.set(sp.x, 0, sp.z);
          hold(p, "intervene", 2.2);
        }
        say(p, pickLine(p, STOP_LINES), 1.8);
        return true;
      }
      case "film": {
        EXEC.stop(p); p.state = "film";
        EXEC.face(p, th.x, th.z);
        hold(p, "film", 2.8 + hash01(p, 0xF11A) * 2.6);
        return true;
      }
      case "report": {
        beginReport(p);
        hold(p, "report", 1.0);
        return true;
      }
      case "cheer": {
        EXEC.face(p, th.x, th.z);
        hold(p, "cheer", 1.5);
        return true;
      }
    }
    return false;
  }

  // ============================================================
  //  WITNESS REPORTING. The brain decides WHETHER and WHEN (witness.reportAt,
  //  pumped by brain.clock); the city body shows HOW: a phone at the ear with
  //  the shoulder turned, or a run to a cop on the block. The two stay in step
  //  by holding reportAt to the end of the visible call; the brain's onReport
  //  is the landing, and the CITY LAW router turns it into stars / dispatch.
  // ============================================================
  function nearestCop(x, z, maxd) {
    let best = null, bd = maxd * maxd;
    const cops = CBZ.cityCops || [];
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i]; if (!c || c.dead || !c.pos) continue;
      const dd = (c.pos.x - x) * (c.pos.x - x) + (c.pos.z - z) * (c.pos.z - z);
      if (dd < bd) { bd = dd; best = c; }
    }
    return best;
  }
  function witnessOf(p) { return p && p._brain && p._brain.witness || null; }
  function callLive(w) { return !!(w && w.reportAt != null && !w.reported && !w.cancelled); }
  function beginReport(p) {
    const w = witnessOf(p);
    if (p.reportState || !callLive(w)) return false;
    const rel = p.relPlayer;
    const vendetta = !!(rel && rel.grudge > 40 && isPlayerActor(w.perp));
    const cop = nearestCop(p.pos.x, p.pos.z, 90);
    const dCop = cop ? Math.hypot(cop.pos.x - p.pos.x, cop.pos.z - p.pos.z) : 1e9;
    const t = now();
    // THE STREET REMEMBERS: a grudge witness with a cop on the block marches
    // over and points you out in person; others take the cop if he's close.
    if (cop && (vendetta ? dCop < 40 : (dCop < 45 && hash01(p, 0xC09) < 0.7))) {
      p.reportState = "run"; p.reportTarget = cop; p.reportT = 16;
      p._vendetta = vendetta;
      w.reportAt = t + 16;                                   // lands on arrival (tickReport)
      if (vendetta) say(p, "Officer! OFFICER!", 2.2, "#ffd27b");
    } else {
      p.reportState = "phone"; p.reportTarget = null;
      const dial = 2.6 + hash01(p, 0xD1A1) * 2.2;
      p.reportT = dial;
      w.reportAt = Math.max(w.reportAt, t + dial);            // nobody finishes a call before they've dialled
      EXEC.stop(p);
    }
    return true;
  }
  // the brain says the call went through (or the body reached the cop)
  function landVisual(p, report) {
    if (!p) return;
    if (isPlayerActor(report && report.perp)) {
      if (p._vendetta) {
        p.posePoint = 1.4;
        const P = CBZ.player;
        if (P && !P.dead) faceAt(p, P.pos.x, P.pos.z, 1.5);
        say(p, "Right there. That's the one.", 2.4, "#ffd27b");
        if (CBZ.city && CBZ.city.note) CBZ.city.note("" + p.name + " pointed you out to the law!", 1.8);
      } else if (CBZ.city && CBZ.city.note) CBZ.city.note("" + p.name + " reported you!", 1.5);
    }
    p._vendetta = false;
    p.witnessSev = 0; p.witnessType = null;
    p.callT = 8;
    endVisual(p);
  }
  function endVisual(p) {
    if (CBZ.cityEndReportVisual) CBZ.cityEndReportVisual(p);
    else { p.reportState = null; p.reportTarget = null; p.reportT = 0; }
  }
  // a report is STOPPED: scared off the phone, knocked out, killed, bribed.
  function cancelWitness(p, why) {
    const b = BR();
    if (b && b.social && b.social.silence) { try { b.social.silence(p, why || "stopped"); } catch (e) {} }
    if (p && p.reportState) endVisual(p);
  }
  // per-think step of a visible report; true while the body is busy with it
  function tickReport(p) {
    if (!p.reportState) return false;
    const w = witnessOf(p);
    if (!callLive(w)) { endVisual(p); return false; }
    const t = now();
    if (p.reportState === "phone") {
      p.state = "film"; p.speed = 0;
      // SNITCH BODY LANGUAGE: nobody phones the police while staring the man
      // down — half turned away, talking low (peds.js's tell block adds the
      // over-the-shoulder glance). Which shoulder is the body's own.
      const P = CBZ.player;
      if (P && p.group) {
        const face = Math.atan2(P.pos.x - p.pos.x, P.pos.z - p.pos.z);
        if (p._snitchTurn == null) p._snitchTurn = (hash01(p, 0x5117) < 0.5 ? -1 : 1) * (0.80 + hash01(p, 0x5118) * 0.34);
        faceYaw(p, face + p._snitchTurn, 0.5);
      }
      return true;
    }
    if (p.reportState === "run") {
      let c = p.reportTarget;
      if (!c || c.dead) {
        c = nearestCop(p.pos.x, p.pos.z, 70); p.reportTarget = c;
        if (!c) { p.reportState = "phone"; w.reportAt = Math.max(t, w.reportAt - 13); return true; }   // no cop left: dial instead
      }
      p.state = "walk";
      if (p.target && p.target.set) p.target.set(c.pos.x, 0, c.pos.z);
      p.speed = (p.baseSpeed || 1.5) * 2.0;
      if (Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z) < 3.2) {       // told him in person: it lands now
        const b = BR();
        if (b && b.social && b.social.fileNow) b.social.fileNow(p); else w.reportAt = Math.min(w.reportAt, t);
      }
      return true;
    }
    return false;
  }

  // ============================================================
  //  THE CITY'S OMERTA — what the brain can't know about this street: on gang
  //  turf nobody calls 911, a set never rats its own block, a clean rich block
  //  calls fast, a hardwired snitch rats anywhere. Applied as the chance a
  //  scheduled call SURVIVES (the brain decided to call; the street talks
  //  them out of it), so the brain's table still does the choosing.
  // ============================================================
  function keepCall(p, crime) {
    const hood = CBZ.cityGangOf ? CBZ.cityGangOf(crime.x, crime.z) : null;
    const sn = p.snitch == null ? 0.3 : p.snitch;
    if (sn > 0.85) return 1;                              // a dedicated snitch rats anywhere
    const rel = p.relPlayer;
    if (rel && rel.grudge > 40 && isPlayerActor(crime.perp)) return 1;   // revenge beats the code
    let k = 0.75 + (sn - 0.3) * 0.6 + (0.55 - (p.aggr == null ? 0.35 : p.aggr)) * 0.3;
    if (hood) { k *= 0.4; if (p.gang && p.gang === hood.id) k = 0; }
    if (p.gang) k *= 0.35;
    if (!hood && (p.wealth || 0) > 0.65) k = Math.min(1, k * 1.3);
    return clamp01(k);
  }

  // ============================================================
  //  CRIME → WITNESSES. Severity arrives in the city's heat units (35 petty ..
  //  250 murder); the brain wants 0..1 on the law router's scale (heat/160),
  //  and the raw heat rides along in opts. `perp` defaults to the player — an
  //  NPC crime MUST pass its NPC (the old tagger blamed the player for every
  //  rampage and NPC robbery in earshot).
  // ============================================================
  const _crimeOpts = { heat: 0, type: null, game: GAME, loud: 0 };
  const _crimeInfo = { x: 0, z: 0, perp: null };
  function loudOf(kind) {
    const k = String(kind || "");
    return /shoot|shot|gun|active|murder|spree/i.test(k) ? 48 : /explo|bomb|blast/i.test(k) ? 120 : 0;
  }
  function crime(kind, x, z, perp, heat) {
    const b = BR();
    if (!b || !b.social || !b.social.crime) return -1;
    perp = perp || PA() || null;
    const peds = CBZ.cityPeds || [];
    // adopt every body that could plausibly be a witness first: the brain only
    // iterates REGISTERED actors, and a far body that hasn't thought since it
    // spawned is still a pair of eyes.
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.vendor) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z;
      if (dx * dx + dz * dz < 75 * 75) adopt(p);
    }
    const am = heat || 40;
    _crimeOpts.heat = am; _crimeOpts.type = kind || "crime"; _crimeOpts.loud = loudOf(kind);
    let n = 0;
    try { n = b.social.crime(kind || "crime", x, z, perp, clamp01(am / 160), _crimeOpts) | 0; } catch (e) { return -1; }
    const t = now();
    _crimeInfo.x = x; _crimeInfo.z = z; _crimeInfo.perp = perp;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      const w = p && p._brain && p._brain.witness;
      if (!w || w.t !== t || w.x !== x || w.z !== z) continue;
      if (callLive(w) && hash01(p, 0x0E17A + ((t * 7) | 0)) >= keepCall(p, _crimeInfo)) {
        try { b.social.silence(p, "omerta"); } catch (e) {}
      }
      // mirror onto the fields the rest of the city reads (candidacy "they
      // watched you do it", speech's ear, vips/scene gates)
      if (w.perp) p.mem = w.perp;
      if (am >= (p.witnessSev || 0)) p.witnessType = kind;
      p.witnessSev = Math.max(p.witnessSev || 0, am);
      p.alarmed = Math.max(p.alarmed || 0, 5);
      p.fear = Math.min(10, (p.fear || 0) + 1.5);
    }
    return n;
  }

  // A WITNESS OF ONE: a single body decides to report the perp on its own (a
  // grudge-holder's revenge). HARNESS TRAP: the contract has no "accuse" — this
  // rides social.crime's victim rule (the victim is always a witness and calls
  // with >= 0.8 odds) with a zero-width sight disc at the accuser's feet, so
  // nobody else is drawn in. Core request: social.accuse(witness, perp, kind, sev).
  const _accOpts = { victim: null, sightRange: 0.01, loud: 0, heat: 0, type: null, game: GAME };
  function accuse(p, perp, kind, heat) {
    const b = BR();
    if (!b || !b.social || !p || !perp || !adopt(p)) return false;
    if (b.social.accuse) { try { return !!b.social.accuse(p, perp, kind, clamp01((heat || 60) / 160)); } catch (e) { return false; } }
    _accOpts.victim = p; _accOpts.heat = heat || 60; _accOpts.type = kind || "assault";
    try { b.social.crime(kind || "assault", p.pos.x, p.pos.z, perp, clamp01((heat || 60) / 160), _accOpts); } catch (e) { return false; }
    _accOpts.victim = null;
    return !!(witnessOf(p) && witnessOf(p).perp === perp);
  }

  // ============================================================
  //  LOUD EVENTS → HEARING. A gunshot/blast/body-drop is a NOISE the brain
  //  delivers to everyone in earshot (cops included: the law router reads the
  //  same heard record). The street's reaction comes later, in think(), after
  //  each body's own delay. A blast seat is the one reflex: nobody walks into
  //  a fresh fireball, and nobody needs half a second to know it.
  // ============================================================
  function hearBang(x, z, radius, kind, src) {
    const b = BR();
    if (!b || !b.perception || !b.perception.noise) return -1;
    const peds = CBZ.cityPeds || [];
    const r2 = radius * radius * 2.25;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.vendor) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z;
      if (dx * dx + dz * dz < r2) adopt(p);
    }
    try { return b.perception.noise(x, z, radius, kind, src || null); } catch (e) { return -1; }
  }

  // ============================================================
  //  THREAT → RESPONSE through the brain, with the panic field as morale.
  // ============================================================
  const _th = { source: null, x: 0, z: 0, armed: false, aimingAtMe: false, distance: 0, kind: "", authority: false,
    weapon: null, reloading: false, yaw: null };
  /* THE PLAYER AS A SHOOTER (CBZ.brain.threat is weapon-aware: against a gun
     only a gun fights; a blade only inside 3.5 m while the gun reloads or
     points away). What the player holds, whether he is reloading, where the
     gun points. */
  let _aimV = null;
  function playerAimYaw() {
    try {
      if (CBZ.playerAimDir && typeof THREE !== "undefined") {
        _aimV = _aimV || new THREE.Vector3();
        CBZ.playerAimDir(_aimV);
        if (_aimV.x || _aimV.z) return Math.atan2(_aimV.x, _aimV.z);
      }
    } catch (e) {}
    const P = CBZ.player;
    return P && P.yaw != null ? P.yaw : null;
  }
  function playerWeapon() {
    if (playerArmed()) return "gun";
    return g.cityMeleeWeapon ? "melee" : "none";
  }
  // for CBZ.brain.threat.capability: the city answers for the player; a ped's
  // own fields (armed / weapon / a holstered gun) the core reads itself
  function capabilityOf(a) {
    if (!a || g.mode !== "city") return null;
    return isPlayerActor(a) ? playerWeapon() : null;
  }
  function fillShooter(th, src) {
    th.weapon = null; th.reloading = false; th.yaw = null;
    if (src && isPlayerActor(src)) {
      th.weapon = playerWeapon();
      th.reloading = !!(CBZ.fps && CBZ.fps.reloading > 0);
      th.yaw = playerAimYaw();
    }
    return th;
  }
  function respond(p, src, x, z, armed, aiming, kind) {
    const b = BR();
    if (!b || !b.threat || !b.threat.respond) return null;
    _th.source = src || null; _th.x = x; _th.z = z; _th.armed = !!armed; _th.aimingAtMe = !!aiming;
    _th.distance = Math.hypot(p.pos.x - x, p.pos.z - z); _th.kind = kind || (armed ? "armed" : "unarmed");
    fillShooter(_th, src);
    // a threat flagged armed with no source to read is a gun (a shot, a muzzle)
    if (!_th.weapon && armed && !src) _th.weapon = "gun";
    // ONE RUNNER SETS OTHERS RUNNING: the local panic field (every bolt raises
    // it, it forgets in ~7 s) is suppression on this body's nerve.
    // Raised TOWARD a level set by the field, never stacked per call: think()
    // asks at ~15 Hz and the answer must not depend on how often it asked.
    if (b.morale && b.morale.rattle && CBZ.cityPanicAt && p._brain) {
      const want = Math.min(0.6, CBZ.cityPanicAt(p.pos.x, p.pos.z) * 0.25);
      if (want > p._brain.rattle + 0.01) { try { b.morale.rattle(p, want - p._brain.rattle); } catch (e) {} }
    }
    try { return b.threat.respond(p, _th); } catch (e) { return null; }
  }
  const _pth = { x: 0, z: 0, src: null, armed: false };
  function setTh(o, x, z, src, armed) { o.x = x; o.z = z; o.src = src || null; o.armed = !!armed; return o; }
  // think()'s threatened branch: src/x/z = the threat. Returns true when the
  // brain handled the tick.
  function threat(p, src, x, z, armed, aiming, kind) {
    if (!adopt(p)) return false;
    const t = now();
    // a fresh threat (new source, or a stale one) waits out a reaction delay
    if (p._cbThreatSrc !== src || !(t - (p._cbThreatT || -1e9) < 6)) {
      p._cbThreatSrc = src; p._cbThreatT = t;
      p._cbThreatAt = t + reactDelay(p, Math.hypot(p.pos.x - x, p.pos.z - z), false);
    }
    p._cbThreatT = t;
    if (t < p._cbThreatAt) return holding(p, t);
    if (holding(p, t)) {
      if (p._cbResp === "film") {
        // THE GUN WALKS TOWARDS THE GAWKER: filming holds out to 7 m; once
        // broken it is a flee, never back to filming (hysteresis).
        if (Math.hypot(p.pos.x - x, p.pos.z - z) < 7) return perform(p, "flee", setTh(_pth, x, z, src, armed));
        p.speed = 0; EXEC.face(p, x, z);
        return true;
      }
      if (p._cbResp !== "fight-confront") return true;
    }
    const r = respond(p, src, x, z, armed, aiming, kind);
    if (!r || r === "ignore") return false;
    // the gawker is a civilian answer the threat scorer doesn't have: a curious
    // body far enough from a gun stops to film it instead of bolting
    if (r === "flee" && !aiming && p._brain && p._brain.personality.curiosity > 0.55 &&
        Math.hypot(p.pos.x - x, p.pos.z - z) > 15 && (p.fear || 0) < 7 && p.kind !== "security") {
      return perform(p, "film", setTh(_pth, x, z, src, armed));
    }
    return perform(p, r, setTh(_pth, x, z, src, armed));
  }

  // ============================================================
  //  A MAN WALKED PAST IN CUFFS (systems/cuffedplayer.js). He is not a threat
  //  (systems/brain.js reads cuffs as "none"), so nobody runs and nobody
  //  screams. The street does what a street does: about half the people near
  //  him stop, turn and look; one who is right on top of him steps back out
  //  of his way first. Now and then somebody says something — one short line,
  //  over their head, never more than one every ~8 s on the whole street.
  //  A body raging at him lets it go: there is no fight in a cuffed man.
  // ============================================================
  const CUF = { lineT: -1e9, onT: -1, seenT: -1 };
  const _cufO = { dist: 0, rival: false, aggression: 0, guardNear: true, sinceLine: 0, sinceCheap: 0, sinceSteal: 0, roll: 1, canSteal: false };
  function playerCuffed() { return !!(CBZ.cuffedPlayer && CBZ.cuffedPlayer.on()); }
  function cuffedStare(p, t) {
    const C = CBZ.cuffedPlayer, P = CBZ.player;
    if (!P || !P.pos || !p.pos) return false;
    if (p.kind === "cop" || p.guard || p.companion || p.recruited || p.inCar || p.vendor || p.state === "flee" || p.state === "sit" || p.reportState) return false;
    const dx = P.pos.x - p.pos.x, dz = P.pos.z - p.pos.z, d = Math.hypot(dx, dz);
    if (d > 10 || d < 0.05) return false;
    if (t < (p._cbStareNext || 0)) return false;
    p._cbStareNext = t + 20 + hash01(p, 0x57A1) * 12;
    if (hash01(p, 0x57A2 + ((t / 20) | 0)) > 0.55) return false;            // not everyone looks
    if (d < 2.4) {
      // out of his way first: a step back, facing him
      p._cbStareBackT = t + 0.8;
      p._cbStareBX = p.pos.x - (dx / d) * 1.5; p._cbStareBZ = p.pos.z - (dz / d) * 1.5;
      order(p, p._cbStareBX, p._cbStareBZ, (p.baseSpeed || 1.5) * 0.8, 0.25);
    } else EXEC.stop(p);
    EXEC.face(p, P.pos.x, P.pos.z);
    hold(p, "stare", 2.2 + hash01(p, 0x57A3) * 2.4);
    _cufO.dist = d; _cufO.rival = false; _cufO.aggression = 0; _cufO.guardNear = true;
    _cufO.sinceLine = t - CUF.lineT; _cufO.roll = hash01(p, 0x57A4 + ((t * 3) | 0));
    _cufO.fade = C.novelty(t - CUF.onT);
    if (C.pickTreatment(_cufO) === "jeer") {
      CUF.lineT = t;
      say(p, C.pick(C.LINES.street, hash01(p, 0x57A5 + ((t * 7) | 0))), 1.8);
    }
    return true;
  }

  // ============================================================
  //  PER-THINK CONSUMER (peds.js think() calls this near the top).
  //  Returns true when the brain owns this tick.
  // ============================================================
  const _wth = { x: 0, z: 0, src: null, armed: false };
  function think(p, dt, ctx) {
    const b = BR();
    if (!b || p.dead) return false;
    if (!adopt(p)) return false;
    const t = now();
    const cuffs = playerCuffed();
    if (cuffs) {
      // how long the street has had to get used to him (a new run, or cuffs
      // off for a while, and he is news again)
      if (CUF.onT < 0 || t < CUF.onT || t - CUF.seenT > 5) CUF.onT = t;
      if (t < CUF.lineT) CUF.lineT = -1e9;
      CUF.seenT = t;
    }
    if (cuffs && p.rage && isPlayerActor(p.rage) && p.kind !== "cop") { p.rage = null; if (p.state === "fight" || p.state === "confront") p.state = "walk"; }
    // a fight or a levelled gun OUTRANKS every held street reaction: a gawker
    // who gets punched swings back, a runner covered at gunpoint freezes
    if ((p.rage && !p.rage.dead) || p.surrender || (p.surrenderT || 0) > 0) {
      if (p._cbResp && p._cbResp !== "fight" && p._cbResp !== "intervene" && p._cbResp !== "fight-confront") { p._cbResp = null; p._cbAfter = null; }
      if (p.reportState) cancelWitness(p, "interrupted");
      return false;
    }
    // 1) an in-progress visible report. The player can STOP it: close in with
    //    a gun out and a timid caller drops the phone and runs.
    if (p.reportState) {
      if (p.reportState === "phone" && ctx && ctx.playerArmed && ctx.dpl < 6 && hash01(p, 0x5CA2 + ((t * 2) | 0)) < 0.5) {
        cancelWitness(p, "scared");
        p.fear = 10; p.alarmed = Math.max(p.alarmed || 0, 5);
        p._cbResp = null;
        const P = CBZ.player;
        return perform(p, "flee", setTh(_wth, P.pos.x, P.pos.z, PA(), true));
      }
      if (tickReport(p)) return true;
    }
    // 2) a bang this body HEARD: react once its own delay has run
    const h = b.memory.heard(p);
    const w0 = witnessOf(p);
    // the same event seen AND heard is one event: the witness record (who did
    // it, and this person's own flee/film/report/cower choice) is the richer
    // answer, so the bang only startles someone who didn't witness it
    const sameEvent = !!(h && w0 && w0.t != null && Math.abs(w0.t - h.t) < 1.5 && Math.abs(w0.x - h.x) + Math.abs(w0.z - h.z) < 12);
    if (h && sameEvent) p._cbHeardT = h.t;
    if (h && h.t !== p._cbHeardT && (h.kind === "gunshot" || h.kind === "explosion" || h.kind === "scream")) {
      p._cbHeardT = h.t;
      p._cbBangAt = h.t + (h.kind === "explosion" && h.d < 10 ? 0.05 + hash01(p, 0xB1A5) * 0.15 : reactDelay(p, h.d || 0, true));
      p._cbBang = h;
    }
    if (p._cbBang && t >= p._cbBangAt) {
      const hb = p._cbBang; p._cbBang = null;
      // the flinch belongs to the moment THIS body registers it
      p.poseCower = Math.max(p.poseCower || 0, 0.5 + 0.8 * clamp01(1 - (hb.d || 0) / 30));
      if (hb.kind === "explosion" && (hb.d || 0) < 12) {
        p.rage = null; p._cbResp = null; p.fear = 10;                 // BLAST SEAT
        return perform(p, "flee", setTh(_wth, hb.x, hb.z, hb.source, true));
      }
      if (!p.rage && p.state !== "fight" && !p.companion && !p.guard) {
        const r = respond(p, hb.source, hb.x, hb.z, hb.kind !== "scream", false, hb.kind);
        if (r && r !== "ignore") return perform(p, r, setTh(_wth, hb.x, hb.z, hb.source, hb.kind !== "scream"));
      }
    }
    // 3) a witness record → its response, after the reaction delay
    const w = witnessOf(p);
    if (w && w.t != null && t - w.t < 25 && !w.cancelled) {
      if (p._cbW !== w || p._cbWT !== w.t) {
        p._cbW = w; p._cbWT = w.t; p._cbWDone = false;
        p._cbWAt = w.t + reactDelay(p, Math.hypot(p.pos.x - w.x, p.pos.z - w.z), false);
        if (w.perp) p.mem = w.perp;
      }
      const perp = w.perp && w.perp.pos ? w.perp : null;
      const px = perp ? perp.pos.x : w.x, pz = perp ? perp.pos.z : w.z;
      if (!p._cbWDone && t >= p._cbWAt) {
        p._cbWDone = true;
        const armed = perp ? armedOf(perp) : false;
        const resp = w.response;
        // nobody dials 911 point-blank: a close caller puts distance in first
        if (resp === "report" && Math.hypot(p.pos.x - px, p.pos.z - pz) < 9) {
          perform(p, "flee", setTh(_wth, px, pz, perp, armed));
          p._cbAfter = "report";
          return true;
        }
        if (resp && resp !== "ignore" && perform(p, resp, setTh(_wth, px, pz, perp, armed))) return true;
      }
      // a runner / gawker who is ALSO going to call it in pulls the phone out
      // once they're clear, a beat before the brain lands the call
      if (p._cbWDone && callLive(w) && !p.reportState && t >= w.reportAt - 3.4 && p._cbResp !== "cower") {
        if (Math.hypot(p.pos.x - px, p.pos.z - pz) > 12 && !(p._cbResp === "flee" && holding(p, t))) { beginReport(p); return true; }
        w.reportAt = Math.max(w.reportAt, t + 1.5);           // still running for it — the call waits
      }
    }
    // 4) a held reaction plays out; then its follow-up (cower → flee, flee → call)
    if (holding(p, t)) {
      if (p._cbResp === "film") {
        const ww = witnessOf(p), perp = ww && ww.perp && ww.perp.pos && !ww.perp.dead ? ww.perp : null;
        if (perp) {
          if (Math.hypot(perp.pos.x - p.pos.x, perp.pos.z - p.pos.z) < 7) return perform(p, "flee", setTh(_wth, perp.pos.x, perp.pos.z, perp, true));
          p.speed = 0; p.state = "film"; EXEC.face(p, perp.pos.x, perp.pos.z);
        }
        return true;
      }
      if (p._cbResp === "cower" || p._cbResp === "cover") { p.speed = 0; return true; }
      if (p._cbResp === "stare") {
        const P = CBZ.player;
        if (!cuffs || !P || !P.pos) { p._cbResp = null; return false; }
        if (t < (p._cbStareBackT || 0)) order(p, p._cbStareBX, p._cbStareBZ, (p.baseSpeed || 1.5) * 0.8, 0.25);
        else { dropOrder(p); p.speed = 0; }
        EXEC.face(p, P.pos.x, P.pos.z);
        return true;
      }
      if (p._cbResp === "flee") { if (p.state !== "flee") p.state = "flee"; return true; }
      return false;                                          // fight / confront / intervene: think's rage path carries it
    }
    if (p._cbResp) {
      const after = p._cbAfter, prev = p._cbResp;
      p._cbAfter = null; p._cbResp = null;
      if (after === "flee" && (prev === "cower" || prev === "cover")) return perform(p, "flee", setTh(_wth, p._cbAfterX, p._cbAfterZ, null, true));
      if (after === "report" && callLive(witnessOf(p)) && !p.reportState) { beginReport(p); hold(p, "report", 1); return true; }
    }
    // 5) nothing else on: a cuffed man going by is worth a look
    if (cuffs && cuffedStare(p, t)) return true;
    return false;
  }

  // ============================================================
  //  RETALIATION — proportional. A hit on one of a body of people (a set, a
  //  unit, a friend clique) asks the brain who joins and HOW HARD.
  // ============================================================
  function holster(p) {
    if (!p || !p.armed || p._holster) return;
    p._holster = { weapon: p.weapon, ammo: p.ammo };
    p.armed = false; p.weapon = null;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
  }
  function unholster(p) {
    const h = p && p._holster; if (!h) return;
    p._holster = null;
    if (p.dead) return;
    p.armed = true; p.weapon = h.weapon; p.ammo = h.ammo;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
  }
  function harmOf(victim, aggressor) {
    let h = armedOf(aggressor) ? 0.55 : 0.28;
    if (victim.hp != null && victim.maxHp) h += (1 - victim.hp / victim.maxHp) * 0.3;
    if (victim.dead) h = 1;
    if (victim.gang && CBZ.cityAtWar) {
      const pg = g.playerGang;
      const ag = aggressor && (aggressor.gang || (isPlayerActor(aggressor) && pg && pg.founded ? pg.id : null));
      if (ag && CBZ.cityAtWar(victim.gang, ag)) h += 0.25;
    }
    return clamp01(h);
  }
  function retaliate(victim, aggressor, harm) {
    const b = BR();
    if (!b || !b.social || !b.social.retaliate || !victim || !aggressor || aggressor.dead) return null;
    if (!adopt(victim)) return null;
    // the whole set on the block should be registered before we ask who's near
    const peds = CBZ.cityPeds || [], side = groupOf(victim);
    for (let i = 0; i < peds.length; i++) {
      const o = peds[i];
      if (!o || o === victim || o.dead || !o.pos) continue;
      const dx = o.pos.x - victim.pos.x, dz = o.pos.z - victim.pos.z;
      if (dx * dx + dz * dz < 20 * 20 && groupOf(o) === side) adopt(o);
    }
    if (harm == null) harm = harmOf(victim, aggressor);
    let list = null;
    // the gun's state rides along: against a gunman the core lets only a gun
    // answer, a blade only in its window; everyone else AVOIDS
    const ro = fillShooter(_retOpts, aggressor);
    try { list = b.social.retaliate(victim, aggressor, harm, ro.weapon ? ro : null); } catch (e) { return null; }
    if (!list) return null;
    const ap = posOf(aggressor);
    let barked = false;
    for (let i = 0; i < list.length; i++) {
      const it = list[i], m = it && it.actor, lvl = it && it.level;
      if (!m || m === victim || m.dead || m.controlled || m.companion || m.surrender || m.restraint || m.vendor || (m.ko || 0) > 0) continue;
      if (m.rage && !m.rage.dead && m.rage !== aggressor) continue;    // already in somebody else's fight
      m.alarmed = Math.max(m.alarmed || 0, 4);
      if (lvl === "avoid") {
        // he would have come; at a gun he does not. Out of its line, and the
        // grudge (booked by the core) keeps for another day.
        if (ap) perform(m, "flee", setTh(_pth, ap.x, ap.z, aggressor, true));
        continue;
      }
      if (lvl === "glare") {
        if (!m.rage && ap) {
          EXEC.face(m, ap.x, ap.z); m.pause = Math.max(m.pause || 0, 1.5); m.state = "idle"; m.speed = 0;
          if (!barked) { barked = true; say(m, pickLine(m, GLARE_LINES), 1.6); }
        }
      } else if (lvl === "shove") {
        if (!m.rage) {
          const d = ap ? Math.hypot(ap.x - m.pos.x, ap.z - m.pos.z) : 99;
          let done = false;
          if (d < 2.2 && b.act && b.act.verb) { try { done = !!b.act.verb("shove", m, aggressor, {}); } catch (e) { done = false; } }
          if (!done) EXEC.verb("shove", m, aggressor, {});
        }
      } else if (lvl === "fight") {
        holster(m);                                       // a slap never gets a gun: fists
        m.rage = aggressor; m.state = "fight";
        if (m.target && m.target.set && ap) m.target.set(ap.x, 0, ap.z);
      } else {                                             // "weapon"
        unholster(m);
        m.rage = aggressor; m.state = "fight";
        if (m.target && m.target.set && ap) m.target.set(ap.x, 0, ap.z);
      }
    }
    return list;
  }
  /* THE RAGE GATE (peds.js's rage branch calls this every think). A body set
     on someone — by a retaliation, a mob, a gang call, a shove, a stick-up —
     who has NO GUN of his own does not walk at a GUN: CBZ.brain.threat
     decides. A blade may come inside its window; everyone else runs, gets
     down or puts his hands up, and keeps the grudge. A man with a gun (a
     holstered one too) is left to combat_iq, which fights from cover.
     true = the brain took this think (the rage is dropped). */
  const _gth = { source: null, x: 0, z: 0, armed: true, aimingAtMe: false, distance: 0, kind: "armed", authority: false,
    weapon: "gun", reloading: false, yaw: null };
  function gunGate(p) {
    const r = p && p.rage;
    if (!r || r.dead || p.dead) return false;
    const b = BR();
    if (!b || !b.threat || !b.threat.capability || !adopt(p)) return false;
    if (b.threat.capability(r) !== "gun") return false;
    if (b.threat.capability(p) === "gun") return false;
    const rp = posOf(r);
    if (!rp) return false;
    _gth.source = r; _gth.x = rp.x; _gth.z = rp.z;
    _gth.distance = Math.hypot(p.pos.x - rp.x, p.pos.z - rp.z);
    fillShooter(_gth, r);
    _gth.weapon = "gun";
    _gth.aimingAtMe = !!p._covered;
    let resp = null;
    try { resp = b.threat.respond(p, _gth); } catch (e) { resp = null; }
    if (!resp || resp === "fight") return false;
    p.rage = null;
    if (p.state === "fight" || p.state === "confront") p.state = "idle";
    try { b.memory.grudge(p, r, 0.25); } catch (e) {}
    perform(p, resp === "ignore" ? "flee" : resp, setTh(_pth, rp.x, rp.z, r, true));
    return true;
  }
  const _retOpts = { weapon: null, reloading: false, yaw: null };

  // the man told "fists" draws the moment it stops being a fist fight
  // A gun PUT AWAY on an order (`_holster.stay`: the President's "Stand down",
  // city/orders.js) stays away while there is nobody to fight; it comes out
  // on the same triggers as a fist fight's (an armed foe, a bad wound).
  function tickHolster(p) {
    const r = p.rage;
    if (!r || r.dead || p.dead) { if (!(p._holster && p._holster.stay) || p.dead) unholster(p); return; }
    if (armedOf(r) || (p.hp != null && p.maxHp && p.hp < p.maxHp * 0.5)) unholster(p);
  }

  // ============================================================
  //  NPC-vs-NPC GRUDGES (aigoals' feud) — memory.grudge, decaying in the brain.
  //  The brain keys grudges by id; the city keeps the one ref it needs to hunt.
  // ============================================================
  function grudge(victim, offender, amt) {
    const b = BR();
    if (!b || !victim || !offender || victim === offender || victim.dead || offender.dead) return 0;
    if (!adopt(victim)) return 0;
    const v = b.memory.grudge(victim, offender, amt == null ? 0.6 : amt);
    // the NPC feud target (aigoals goFeud). The player's own reckoning is
    // social.js's ambush (relPlayer) — a feud never hunts the player.
    if (!isPlayerActor(offender) && (!victim._feud || victim._feud === offender || v >= b.memory.grudge(victim, victim._feud))) victim._feud = offender;
    return v;
  }
  // the NPC this body is out for, while the grudge is still hot (> 0.25)
  function feud(p) {
    const b = BR();
    const f = p && p._feud;
    if (!b || !f) return null;
    if (f.dead || b.memory.grudge(p, f) < 0.25) { p._feud = null; return null; }
    return f;
  }

  // ============================================================
  //  MORALE — a set, a unit, your crew: ONE body of nerve.
  // ============================================================
  function memberDown(p) {
    const b = BR();
    if (!b || !b.morale || !p) return;
    const grp = groupOf(p);
    if (!grp) return;
    try { b.morale.death(grp, p); } catch (e) {}
  }
  function broken(p) {
    const b = BR();
    if (!b || !b.morale || !b.morale.broken || !p || p.dead) return false;
    if (!adopt(p) || !groupOf(p)) return false;
    try { return !!b.morale.broken(p); } catch (e) { return false; }
  }
  function moraleOf(p) {
    const b = BR();
    if (!b || !b.morale || !p || !adopt(p)) return 1;
    try { return b.morale.of(p); } catch (e) { return 1; }
  }

  // ============================================================
  //  FACTIONS / ATTITUDES / REPUTATION
  //  turf.js owns the gang relation graph (drift, gang-up-on-the-leader); the
  //  brain's attitude table is fed from it so witnesses, threat and retaliation
  //  read ONE answer. brain.rep per gang faction is the player's standing.
  // ============================================================
  function repKey(gid) { return "gang:" + gid; }
  function repStanding(gid) {
    const b = BR(); if (!b || !b.rep) return null;
    const r = b.rep.get(repKey(gid));
    return Math.max(-100, Math.min(100, Math.round((r.respect - r.hostility) * 100)));
  }
  // a standing delta (-100..100 scale) → rep: goodwill first pays down
  // hostility, then builds respect; harm first spends respect, then builds
  // hostility (and a little fear — hurting a set makes it wary of you).
  function repAddStanding(gid, amt) {
    const b = BR(); if (!b || !b.rep || !amt) return repStanding(gid);
    const r = b.rep.get(repKey(gid));
    const d = amt / 100;
    let dr, dh;
    if (d > 0) { dh = -Math.min(r.hostility, d); dr = d + dh; }
    else { dr = -Math.min(r.respect, -d); dh = -d + dr; }
    b.rep.add(repKey(gid), { respect: dr, hostility: dh, fear: d < 0 ? -d * 0.2 : 0 });
    return repStanding(gid);
  }
  function syncFactions() {
    const b = BR(); if (!b || !b.social || !b.social.setAttitude) return;
    const gangs = CBZ.cityGangs || [];
    const pg = g.playerGang;
    for (let i = 0; i < gangs.length; i++) {
      const A = gangs[i]; if (!A || A.absorbed) continue;
      const fa = "gang:" + A.id;
      // rep is the truth; gang.standing is its persisted mirror. A value that
      // changed under us (a loaded save) is folded back into rep once.
      if (A._repStanding == null || A.standing !== A._repStanding) {
        const want = A.standing || 0, have = repStanding(A.id);
        if (want !== have) repAddStanding(A.id, want - have);
      }
      A.standing = A._repStanding = repStanding(A.id);
      if (A.boss && !A.boss.dead && b.social.setLeader) b.social.setLeader(fa, A.boss);
      for (let j = i + 1; j < gangs.length; j++) {
        const B2 = gangs[j]; if (!B2 || B2.absorbed) continue;
        const v = CBZ.cityAtWar && CBZ.cityAtWar(A.id, B2.id) ? -1 : CBZ.cityAreAllied && CBZ.cityAreAllied(A.id, B2.id) ? 0.6 : -0.25;
        b.social.setAttitude(fa, "gang:" + B2.id, v);
      }
      // the set toward the player: riding with them / standing / provoke / war
      let vp;
      if (A.playerFriendly || A.isPlayer || (pg && pg.founded && pg.id === A.id)) vp = 0.8;
      else {
        vp = Math.max(-1, Math.min(1, (A.standing || 0) / 100 - (A.provoke || 0) * 0.6 - Math.min(5, A.hostility || 0) * 0.08));
        if (pg && pg.founded && CBZ.cityAtWar && CBZ.cityAtWar(A.id, pg.id)) vp = -1;
      }
      b.social.setAttitude(fa, "player", vp);
      b.social.setAttitude(fa, "civilians", -0.1, true);
      b.social.setAttitude("civilians", fa, -0.3, true);
      b.social.setAttitude(fa, "police", -0.6);
    }
  }

  // ============================================================
  //  PER-FRAME: brain clock (pumps landed reports), morale, holster escalation,
  //  shove timers, faction sync, releasing parked/culled rigs.
  // ============================================================
  let _subFor = null, _facT = 0;
  function subscribe() {
    const b = BR();
    if (!b || _subFor === b || !b.social || !b.social.onReport) return;
    _subFor = b;
    // VISUAL landing only. The consequence (stars / dispatch / npcWanted) is
    // the CITY LAW router's: it subscribes to the same channel.
    b.social.onReport(GAME, function (rep) {
      const p = rep && rep.witness;
      if (!p || p.kind === "cop") return;
      if (p.reportState) landVisual(p, rep);
      else { p.witnessSev = 0; p.witnessType = null; p.callT = 8; }
    });
  }
  function update(dt) {
    const b = BR(); if (!b) return;
    if (g.mode !== GAME) return;
    ensureExec(); subscribe(); defineOnce();
    b.clock(typeof g.elapsed === "number" ? g.elapsed : (CBZ.now || 0) / 1000);
    if (b.morale && b.morale.tick) b.morale.tick(dt);
    _facT -= dt;
    const sync = _facT <= 0;
    if (sync) { _facT = 2; syncFactions(); }
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p) continue;
      if (sync && p._brain && p._cbSig && p._cbSig.crew) crewNerve(p, p._brain.personality);
      if (p._holster) tickHolster(p);
      if (p._cbShoveT > 0) { p._cbShoveT -= dt; if (p._cbShoveT <= 0 && p.state === "confront" && !p.rage) p.state = "walk"; }
      if (p._cbSig && (p._parked || p.culled)) release(p);
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(33.9, update);   // just before peds (34): the clock is fresh for every think
  function reset() {
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) if (peds[i]) release(peds[i]);
    _facT = 0;
  }

  CBZ.cityBrain = {
    adopt: adopt, release: release, reset: reset, update: update,
    exec: EXEC, crime: crime, hearBang: hearBang, think: think, threat: threat, perform: perform, respond: respond,
    retaliate: retaliate, harmOf: harmOf, holster: holster, unholster: unholster, gunGate: gunGate,
    grudge: grudge, feud: feud,
    memberDown: memberDown, broken: broken, moraleOf: moraleOf,
    standing: repStanding, addStanding: repAddStanding, syncFactions: syncFactions,
    cancelWitness: cancelWitness, beginReport: beginReport, keepCall: keepCall, accuse: accuse,
    _t: { reactDelay: reactDelay, hash01: hash01, groupOf: groupOf, sideOf: sideOf, archOf: archOf },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.cityBrain;
})();
