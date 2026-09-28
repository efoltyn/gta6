/* ============================================================
   systems/brain_prison.js — THE PRISON AS A CONFIGURATION OF CBZ.brain.

   The prison's people used to think with four private copies of the same
   ideas: the guards' cone (entities/guards.js), the inmates' witness cone
   (systems/detection.js), a military port of the guards' cone
   (games/military.js), and a jail cone with no walls (games/jail.js). They
   all read the ONE brain now (systems/brain.js). What this file owns is the
   PRISON'S configuration of it, and the decisions the prison adds on top:

     REGISTRATION  every inmate (archetype "inmate", faction "inmates", his
                   clique as the clique) and every screw ("guard"/"warden",
                   faction "guards") is a brain. Re-synced when a man changes
                   clique.
     EXECUTOR      CBZ.brain.act.use("prison", ...): the prison's own movers
                   (guards.js walkTo/faceTo, the inmates' target+speed) and
                   its own physical acts (cuffs on the rig, a taser drop, a
                   baton blow, a shove) stand behind act.* until CBZ.moves /
                   CBZ.verbs take them over.
     YARD LAW      a screw who SEES two inmates fighting runs the authority
                   ladder on the one who started it: "Break it up!" -> "On
                   the ground!" -> he walks in -> cuffs (act.verb "restrain").
                   Nonlethal ROE; a man who swings or runs gets the taser or
                   the baton (act.verb). A cuffed man kneels, cuffed, while
                   the screw stands over him, then he is let up and sent to
                   his house with the fight taken out of him.
     THE ORDER     how an inmate answers an order is CBZ.brain.threat.respond
                   (comply / flee / fight) held for a dwell, never re-rolled
                   per frame.
     WITNESSES     CBZ.brain.social.crime turns anyone who saw or heard it
                   into a witness; the prison vets who would really talk
                   (crew, standing, trust, fear) and a witness who is being
                   stared down by the perp's clique is SCARED OFF. A report
                   lands through CBZ.brain.social.onReport("prison") and that
                   is the ONE place a witness report becomes heat.
     MORALE/ROUT   each clique is a morale group. Men going down, and above
                   all the shotcaller going down, drains it; a clique whose
                   morale breaks ROUTS — they scatter to their houses instead
                   of fighting to the last man.
     RETALIATION   CBZ.brain.social.retaliate decides who of the victim's
                   clique answers and HOW HARD: a shove gets a glare or a
                   shove back, a shanking gets a fight or steel.

   Pure decisions + a thin adapter. No meshes, no animation here.
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ;
  if (!CBZ) return;

  const GAME = "prison";
  const PB = CBZ.prisonBrain = CBZ.prisonBrain || {};

  function BR() { return CBZ.brain || null; }
  function G() { return CBZ.game || {}; }
  function inPrison() { const g = CBZ.game; return !!(g && g.mode === "escape"); }
  function now() { const b = BR(); return b && b.now ? b.now() : (+G().elapsed || 0); }
  function rng() { return CBZ.econ && CBZ.econ.rng ? CBZ.econ.rng() : Math.random(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function alive(a) { return !!(a && !a.dead && !(a.ko > 0) && !a.escaped); }
  function P(a) { return a.group ? a.group.position : a.pos; }
  function dist(a, b) { const p = P(a), q = P(b); return Math.hypot(p.x - q.x, p.z - q.z); }
  function isStaff(a) { return !!(a && (a.kind === "guard" || a.kind === "warden")); }
  function isPlayer(a) { return !!(a && (a === CBZ.player || (CBZ.playerChar && a.group && a.group === CBZ.playerChar.group))); }
  function cliqueId(gang) { return gang >= 0 ? "prison:clique:" + gang : null; }
  PB.cliqueId = cliqueId;

  /* ==========================================================
     1. REGISTRATION
     ========================================================== */
  function behavior(n) {
    return (CBZ.behaviorOf && CBZ.behaviorOf(n)) || { init: 0.14, retaliate: 0.8, fleeHurt: 0.4, picksWeak: 0.3, guts: 0.5 };
  }
  // the yard's temperament (CBZ.BEHAVIORS) read as the brain's personality
  function inmatePersonality(n) {
    const b = behavior(n), p = n.personality || {};
    const shot = n.isLeader || n.crewRole === "shotcaller";
    return {
      courage: clamp(0.2 + b.guts * 0.6 + (p.nerve != null ? (p.nerve - 0.5) * 0.3 : 0), 0, 1),
      aggression: clamp(b.init * 2.4 + (b.picksWeak > 0.8 ? 0.2 : 0) + b.retaliate * 0.15, 0, 1),
      discipline: clamp(0.25 + (1 - b.init) * 0.3 + (shot ? 0.25 : 0), 0, 1),
      curiosity: 0.5,
      loyalty: clamp(p.loyalty != null ? p.loyalty : 0.5, 0, 1),
    };
  }
  function guardPersonality(g) {
    return {
      courage: g.kind === "warden" ? 0.6 : 0.78,
      aggression: 0.3,
      discipline: g.corrupt ? 0.45 : 0.85,
      curiosity: 0.6,
      loyalty: g.corrupt ? 0.3 : 0.8,
    };
  }
  const _regOpts = { faction: "", clique: null, personality: null, game: GAME, leader: false };
  function register(a, arch, faction, clique, pers) {
    const b = BR();
    if (!b || !b.register) return;
    _regOpts.faction = faction; _regOpts.clique = clique; _regOpts.personality = pers;
    _regOpts.leader = !!(clique && a.isLeader);
    try { b.register(a, arch, _regOpts); } catch (e) { return; }
    a._brainClique = clique;
    const rec = a._brain;
    if (rec) rec.game = GAME;
  }
  let syncT = 0;
  function syncCast(dt, force) {
    syncT -= dt;
    if (syncT > 0 && !force) return;
    syncT = 1.0;
    const b0 = BR();
    if (!b0 || !wire()) return;
    const npcs = CBZ.npcs || [];
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (!n || !n.group || n._crowd) continue;
      if (n.gang === undefined) continue;                 // ai.js has not dealt him in yet
      const cq = cliqueId(n.gang);
      if (n._brain && n._brainClique === cq && n._brainReg) {
        // the shotcaller passed (ai.js kill(): leadership goes to an heir)
        if (cq && n.isLeader && !n._brain.leader && b0.social.setLeader) b0.social.setLeader(cq, n);
        continue;
      }
      register(n, "inmate", "inmates", cq, inmatePersonality(n));
      n._brainReg = true;
    }
    const gs = CBZ.guards || [];
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i];
      if (!g || !g.group || g._brainReg) continue;
      register(g, g.kind === "warden" ? "warden" : "guard", "guards", null, guardPersonality(g));
      g._brainReg = true;
    }
  }
  PB.sync = function () { syncCast(0, true); };

  /* ==========================================================
     2. THE EXECUTOR — the prison's own movers and acts behind act.*
     ========================================================== */
  let frameDt = 1 / 60;
  function speedOf(a, s) {
    const base = a.baseSpeed || a.speed || 2.2;
    if (typeof s === "number") return s;
    if (s === "run") return base * 1.7;
    if (s === "jog") return base * 1.3;
    return base;
  }
  const exec = {
    /* THE PRISON'S OWN MOVERS WIN. A screw walks the prison navigator
       (guards.js walkTo -> CBZ.navGrid, doors and all) and an inmate walks
       npc.js's mover through prisonnav; a generic steering seam knows
       neither. The VERBS seam is still asked first for the physical acts
       (verb() below), so its animations are used when it has them. */
    prefer: true,
    moveTo(a, x, z, opts) {
      opts = opts || {};
      if (!a || !a.group) return false;
      if (a._brainNoMove) return true;          // another system owns his feet (capture.js's arrest)
      const sp = speedOf(a, opts.speed);
      if (isStaff(a) && CBZ.guardWalkTo) {
        const arrive = opts.arrive != null ? opts.arrive : 0.6;
        const d = Math.hypot(x - a.group.position.x, z - a.group.position.z);
        if (d <= arrive) return true;
        CBZ.guardWalkTo(a, x, z, sp, frameDt);
        return true;
      }
      if (a.target && a.target.set) {
        // an inmate's own mover (npc.js) walks to `target` at the pace his
        // brain returns this think
        a.target.set(x, 0, z);
        a.pause = 0;
        return true;
      }
      return false;
    },
    stop(a) {
      if (!a || !a.group) return;
      if (isStaff(a)) return;                   // guards.js / guardLawStep animate him standing
      if (a.target && a.target.set) a.target.set(a.group.position.x, 0, a.group.position.z);
    },
    face(a, x, z) {
      if (!a || !a.group || a._brainNoMove) return;
      if (isStaff(a) && CBZ.guardFaceTo) { CBZ.guardFaceTo(a, x, z, 0.002, frameDt); return; }
      const want = Math.atan2(x - a.group.position.x, z - a.group.position.z);
      const lerp = CBZ.lerpAngle || function (p, q, t) { return p + (q - p) * t; };
      a.group.rotation.y = lerp(a.group.rotation.y, want, 1 - Math.pow(0.002, frameDt));
    },
    posture(a, p) {
      const ch = a && a.char;
      if (!ch) return;
      if (p === "handsUp") { ch.handsUp = true; ch.surrender = false; }
      else if (p === "kneel" || p === "prone" || p === "cower") { ch.surrender = true; ch.handsUp = false; }
      else if (p === "stand") { ch.handsUp = false; ch.surrender = false; }
    },
    say(a, line, opts) {
      if (!a || !line || !CBZ.prisonSay) return false;
      try { return CBZ.prisonSay(a, line, { secs: (opts && opts.secs) || 1.8, force: true }); } catch (e) { return false; }
    },
    verb(name, a, b, opts) {
      if (!a || !b) return false;
      // CBZ.verbs (the VERBS lead's one library) animates it when it can; the
      // prison's own state for the act is set either way
      const V = CBZ.verbs;
      const f = V && (typeof V[name] === "function" ? V[name] : typeof V[VALIAS[name]] === "function" ? V[VALIAS[name]] : null);
      if (f) {
        let r = false;
        try { r = f.call(V, a, b, opts); } catch (e) { r = false; }
        if (r) {
          if ((name === "restrain" || name === "cuff") && !isPlayer(b)) cuffInmate(b, a, true);
          return r;
        }
      }
      if (name === "restrain" || name === "cuff") return cuffInmate(b, a);
      if (name === "tase" || name === "taser") return taseInmate(b, a);
      if (name === "baton" || name === "strike" || name === "punch") return batonInmate(b, a, name);
      if (name === "tackle" || name === "grab") return tackleInmate(b, a);
      if (name === "shove") return shoveActor(b, a);
      if (name === "escort" || name === "release") return false;
      return false;
    },
  };
  PB.exec = exec;
  const VALIAS = { cuff: "restrain", restrain: "cuff", tase: "taser", taser: "tase", tackle: "takedown" };

  // ---- the physical acts the prison already knows how to do ----------------
  const CUFF_SECS = 16;
  function cuffInmate(n, gd, quiet) {
    if (!n || n.dead || isPlayer(n) || isStaff(n)) return false;
    n._cuffHeld = true;
    n.cuffed = true;
    n._cuffT = CUFF_SECS;
    n._cuffBy = gd || null;
    n.aiState = "wander"; n.foe = null; n.huntPlayer = 0; n._blow = null;
    if (n.char) { n.char.cuffed = true; n.char.handsUp = false; n.char.surrender = true; n.char.fightStance = false; n.char.punchT = 0; }
    if (n.target && n.target.set) n.target.set(n.group.position.x, 0, n.group.position.z);
    if (!quiet && CBZ.sfx) { try { CBZ.sfx("step"); } catch (e) {} }
    if (CBZ.prisonLawCount) CBZ.prisonLawCount("cuffs");
    return true;
  }
  function uncuffInmate(n) {
    n.cuffed = false; n._cuffT = 0; n._cuffBy = null; n._cuffHeld = false;
    if (n.char) { n.char.cuffed = false; n.char.surrender = false; n.char.handsUp = false; }
    // the fight is out of him: no swinging for a good while, home first
    n._lawHeldT = 90;
    n._brokenUpT = Math.max(n._brokenUpT || 0, 30);
    sendHome(n, 1.0);
  }
  PB.uncuff = uncuffInmate;
  function taseInmate(n, gd) {
    if (!n || n.dead || isPlayer(n)) return false;
    n.ko = Math.max(n.ko || 0, 2.4);
    n.aiState = "wander"; n.foe = null; n._blow = null;
    if (CBZ.taserFx && CBZ.taserFx.actorTaseActor) { try { CBZ.taserFx.actorTaseActor(gd, n); } catch (e) {} }
    if (CBZ.worldSfx && n.group) { try { CBZ.worldSfx("tase", n.group.position.x, n.group.position.z, {}); } catch (e) {} }
    if (CBZ.prisonLawCount) CBZ.prisonLawCount("tases");
    return true;
  }
  function batonInmate(n, gd, kind) {
    if (!n || n.dead || isPlayer(n)) return false;
    n.hp = (n.hp != null ? n.hp : 100) - (9 + rng() * 5);
    if (gd && gd.char) { gd.char.punchKind = "hook"; gd.char.punchDur = 0.3; gd.char.punchT = 0.3; }
    if (CBZ.knockback && gd && gd.group) CBZ.knockback(n, gd.group.position.x, gd.group.position.z, 0.7);
    if (CBZ.worldSfx && n.group) { try { CBZ.worldSfx("punch", n.group.position.x, n.group.position.z, {}); } catch (e) {} }
    if (n.hp <= 0) { n.hp = 1; n.ko = Math.max(n.ko || 0, 3); }
    return true;
  }
  function tackleInmate(n, gd) {
    if (!n || n.dead || isPlayer(n)) return false;
    n.ko = Math.max(n.ko || 0, 1.6);
    n.aiState = "wander"; n.foe = null;
    if (CBZ.knockback && gd && gd.group) CBZ.knockback(n, gd.group.position.x, gd.group.position.z, 1.0);
    return true;
  }
  // a hand in the chest: moves him, costs nothing
  function shoveActor(target, by) {
    if (!target || !by || !by.group) return false;
    if (by.char) { by.char.punchKind = "shove"; by.char.punchDur = 0.30; by.char.punchT = 0.30; }
    if (isPlayer(target)) {
      const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
      const kx = px - by.group.position.x, kz = pz - by.group.position.z, kd = Math.hypot(kx, kz) || 1;
      CBZ.player.pos.x += (kx / kd) * 0.6; CBZ.player.pos.z += (kz / kd) * 0.6;
      if (CBZ.playerHitReact) CBZ.playerHitReact(0.14);
      return true;
    }
    if (CBZ.knockback) CBZ.knockback(target, by.group.position.x, by.group.position.z, 0.5);
    return true;
  }
  PB.shove = shoveActor;

  // where a man goes when he is done: his rack's side if he has one, else the
  // far side of his own patch
  function sendHome(n, pace) {
    if (!n || !n.target || !n.target.set) return;
    let x = null, z = null;
    const R = CBZ.prisonRest;
    const bed = R && R.place ? R.place(n) : null;
    if (bed && CBZ.rest && CBZ.rest.approach) { const p = CBZ.rest.approach(bed); x = p.x; z = p.z; }
    else if (n.region) { const r = n.region; x = (r[0] + r[1]) * 0.5; z = (r[2] + r[3]) * 0.5; }
    if (x == null) return;
    n.target.set(x, 0, z);
    n._homeX = x; n._homeZ = z; n._homePace = pace || 1;
  }

  /* ==========================================================
     3. YARD LAW — a screw who sees a fight runs the ladder on its starter
     ========================================================== */
  const LAW_OPTS = { roe: "nonlethal", warnRange: 11, orderRange: 5.0, cuffRange: 1.35, patience: 2.6 };
  const LAW_LOSE_R = 26;
  function freeScrew(gd) {
    return !!(gd && gd.group && !gd.dead && !(gd.ko > 0) && !gd.asleep && !(gd.bribed > 0) && !gd.tied &&
      !gd._escort && gd.intimidMode !== "scared" && !gd.approach && !(gd.hunt > 0) && !gd._yardCase && !(gd.pause > 0));
  }
  // begin a case: officer -> inmate. The authority record lives on gd._brain.case.
  function beginCase(gd, n, reason) {
    const b = BR();
    if (!b || !b.authority || !freeScrew(gd) || !alive(n) || n.cuffed || n._lawBy) return false;
    try { b.authority.begin(gd, n, reason || "fight", LAW_OPTS); } catch (e) { return false; }
    gd._yardCase = n; gd._yardHold = false; gd._yardT = 0; gd._yardD0 = dist(gd, n);
    n._lawBy = gd; n._lawAns = null; n._lawAnsT = 0;
    gd.investigate = null; gd._returning = false;
    return true;
  }
  PB.beginCase = beginCase;
  function endCase(gd) {
    const n = gd._yardCase;
    const b = BR();
    if (b && b.authority) { try { b.authority.cancel(gd); } catch (e) {} }
    gd._yardCase = null; gd._yardHold = false;
    if (n && n._lawBy === gd) {
      n._lawBy = null; n._lawAns = null;
      if (!n.cuffed && n.char) { n.char.handsUp = false; n.char.surrender = false; }
    }
    // back to the nearest point of his round
    gd._returning = true;
  }
  PB.endCase = endCase;

  function suspectState(n, gd) {
    const vx = n._vx || 0, vz = n._vz || 0;
    const ch = n.char || {};
    return {
      speed: Math.hypot(vx, vz),
      handsUp: !!ch.handsUp,
      kneeling: !!ch.surrender,
      prone: !!(n.ko > 0),
      armed: !!(n._shankOut || n.hasGun),
      aiming: false,
      // still swinging once he has had a beat to hear it (the first shout
      // lands mid-fight; it is what he does AFTER it that counts)
      attacking: (gd._yardT || 0) > 1.2 && n.aiState === "fight" && !!n.foe && alive(n.foe) && dist(n, n.foe) < 2.4,
      // got clear away: well past where the case started (a screw sent from
      // across the yard is not "losing" a man he has not reached yet)
      fled: dist(n, gd) > Math.max(LAW_LOSE_R, (gd._yardD0 || 0) + 10),
    };
  }
  /* guards.js think() calls this every frame for a screw with a yard case,
     after his own perception ran. true = the case owns him this frame. The
     ladder itself (CBZ.brain.authority.step) walks him (act.moveTo), turns
     him (act.face), speaks (act.say) and cuffs/tases (act.verb) through the
     executor above: this only frames it for the prison. */
  PB.guardLawStep = function (gd, dt) {
    const n = gd._yardCase;
    if (!n) return false;
    frameDt = dt || frameDt;
    // the PLAYER outranks any yard case: a hunt drops it
    if (gd.hunt > 0 || gd.dead || gd.ko > 0 || !inPrison()) { endCase(gd); return false; }
    if (n.dead || n.escaped) { endCase(gd); return false; }
    gd._yardT += dt;
    gd._yardTick = now();
    const nx = n.group.position.x, nz = n.group.position.z;
    if (CBZ.guardLookAt) CBZ.guardLookAt(gd, nx, nz);
    // standing over a cuffed man until he is let up
    if (gd._yardHold) {
      if (!n.cuffed) { endCase(gd); return false; }
      if (dist(gd, n) > 1.9) exec.moveTo(gd, nx, nz, { speed: "walk", arrive: 1.5 });
      else { exec.face(gd, nx, nz); if (CBZ.guardIdle) CBZ.guardIdle(gd, dt); }
      return true;
    }
    const b = BR();
    if (!b || !b.authority) { endCase(gd); return false; }
    const cmd0 = gd._cmd || 0;
    let r = null;
    try { r = b.authority.step(gd, dt, suspectState(n, gd)); } catch (e) { r = null; }
    // a screw the ladder did not walk this frame is standing: his rig idles
    if ((gd._cmd || 0) === cmd0 && CBZ.guardIdle) CBZ.guardIdle(gd, dt);
    const phase = r && r.phase;
    if (!phase || phase === "done") {
      if (n.cuffed) { gd._yardHold = true; return true; }
      endCase(gd); return false;
    }
    if (phase !== gd._yardPhase) {
      gd._yardPhase = phase;
      if (phase === "order" && CBZ.prisonLawCount) CBZ.prisonLawCount("orders");
    }
    if (phase === "cuff" && n.cuffed) gd._yardHold = true;
    return true;
  };

  /* who of the screws takes a fight he can see. Polled at 2 Hz; the fight is
     "seen" through the one sight test. The starter is the man who threw first
     (ai.js stamps _fightStarter), else whoever is winning. */
  let lawPollT = 0;
  function yardLawPoll(dt) {
    lawPollT -= dt;
    if (lawPollT > 0) return;
    lawPollT = 0.5;
    const b = BR();
    if (!b || !b.perception || !b.authority) return;
    const npcs = CBZ.npcs || [];
    const gs = CBZ.guards || [];
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (!n || n.aiState !== "fight" || !alive(n) || !n.foe || n._lawBy || n.cuffed) continue;
      const f = n.foe;
      if (isStaff(f)) continue;                          // a man swinging at a screw is the screw's problem
      const starter = n._fightStarter && n._fightStarter.group && alive(n._fightStarter) ? n._fightStarter : n;
      if (starter._lawBy) continue;
      const p = n.group.position;
      let best = null, bd = Infinity;
      for (let k = 0; k < gs.length; k++) {
        const gd = gs[k];
        if (!freeScrew(gd)) continue;
        const d = Math.hypot(gd.group.position.x - p.x, gd.group.position.z - p.z);
        if (d > 30 || d >= bd) continue;
        let sees = false;
        try { sees = b.perception.seesPoint(gd, p.x, p.y || 0, p.z, null); } catch (e) { sees = false; }
        if (sees) { bd = d; best = gd; }
      }
      if (best) beginCase(best, starter, "fight");
    }
  }

  /* ==========================================================
     4. THE ORDER, from the inmate's side — called at the top of aiThink.
        Returns a move speed while the law owns him, else null.
     ========================================================== */
  const ANSWER_DWELL = 1.8;   // s a decision holds before it may change
  PB.inmateThink = function (n, dt) {
    if (!inPrison()) return null;
    // CUFFED: kneeling, hands behind him, until the screw lets him up
    if (n.cuffed) {
      // cuffs put on by another hand (the VERBS seam) start the same hold
      if (!n._cuffHeld) { n._cuffHeld = true; n._cuffT = CUFF_SECS; n._cuffBy = n._cuffBy || n._lawBy || null; }
      n._cuffT = (n._cuffT || 0) - dt;
      if (n.char) { n.char.cuffed = true; n.char.surrender = true; }
      n.foe = null; n.huntPlayer = 0;
      if (n.target && n.target.set) n.target.set(n.group.position.x, 0, n.group.position.z);
      if (n._cuffT <= 0 || !n._cuffBy || n._cuffBy.dead || n._cuffBy.ko > 0) {
        const gd = n._cuffBy;
        uncuffInmate(n);
        if (gd && gd._yardCase === n) endCase(gd);
      }
      return 0;
    }
    if ((n._lawHeldT || 0) > 0) n._lawHeldT -= dt;
    // ROUT: running for his house, not fighting
    if ((n._routT || 0) > 0) {
      n._routT -= dt;
      n.foe = null;
      if (n.aiState === "fight") n.aiState = "wander";
      if (n._homeX != null && n.target) n.target.set(n._homeX, 0, n._homeZ);
      if (n._routT <= 0 || (n._homeX != null && Math.hypot(n._homeX - n.group.position.x, n._homeZ - n.group.position.z) < 1.2)) {
        n._routT = 0; n.aiState = "wander"; n.aiTimer = 1 + rng() * 2;
        return null;
      }
      return (n.baseSpeed || 2) * 1.6;
    }
    const gd = n._lawBy;
    if (!gd) return null;
    // a screw whose case stopped running (called away, knocked down, stood
    // up by something else) is not standing over him any more: he gets up
    if (gd._yardCase === n && now() - (gd._yardTick != null ? gd._yardTick : now()) > 2) endCase(gd);
    if (gd._yardCase !== n || gd.dead || gd.ko > 0) { n._lawBy = null; n._lawAns = null; if (n.char) { n.char.handsUp = false; n.char.surrender = false; } return null; }
    const b = BR();
    const d = dist(n, gd);
    const phase = gd._yardPhase || "observe";
    if (phase === "observe") return null;                 // he has not said anything yet
    // THE ANSWER, held for a dwell: no flip-flopping between down and up
    n._lawAnsT = (n._lawAnsT || 0) - dt;
    if (!n._lawAns || (n._lawAnsT <= 0 && n._lawAns !== "comply")) {
      let ans = "comply";
      if (b && b.threat && b.threat.respond) {
        try {
          ans = b.threat.respond(n, {
            source: gd, x: gd.group.position.x, z: gd.group.position.z,
            armed: true, aimingAtMe: false, distance: d, kind: "authority", authority: true,
          }) || "comply";
        } catch (e) { ans = "comply"; }
      }
      if (ans === "surrender" || ans === "freeze" || ans === "cover" || ans === "ignore") ans = "comply";
      // a man mid-swing with a real grudge keeps swinging; a hurt man goes down
      if (ans === "fight" && n.hp != null && n.hp < (n.maxHp || 100) * 0.3) ans = "comply";
      n._lawAns = ans; n._lawAnsT = ANSWER_DWELL;
    }
    const ans = n._lawAns;
    if (ans === "comply") {
      // he stops: the fight is over for both of them
      const f = n.foe;
      n.foe = null;
      if (n.aiState === "fight" || n.aiState === "flee") n.aiState = "wander";
      if (f && f.foe === n) { f.foe = null; f.aiState = "wander"; f.aiTimer = 1.5 + rng(); f._brokenUpT = Math.max(f._brokenUpT || 0, 20); }
      exec.stop(n);
      exec.face(n, gd.group.position.x, gd.group.position.z);
      exec.posture(n, phase === "warn" ? "handsUp" : "kneel");
      return 0;
    }
    if (ans === "flee") {
      if (n.char) { n.char.handsUp = false; n.char.surrender = false; }
      n.foe = null;
      n.aiState = "flee"; n.fleeT = Math.max(n.fleeT || 0, 2.5);
      const p = n.group.position, gp = gd.group.position;
      const ax = p.x - gp.x, az = p.z - gp.z, al = Math.hypot(ax, az) || 1;
      if (n.target) n.target.set(p.x + ax / al * 8, 0, p.z + az / al * 8);
      return (n.baseSpeed || 2) * 1.7;
    }
    // fight: he keeps at it (the ladder escalates on its own)
    if (n.char) { n.char.handsUp = false; n.char.surrender = false; }
    return null;
  };

  /* ==========================================================
     5. WITNESSES — social.crime + the prison's vetting + onReport
     ========================================================== */
  // would THIS man really talk? The old detection.js snitch odds, now a veto
  // over the brain's pick instead of a second witness system.
  function willTalk(n, perp, meta) {
    const g = G();
    const pl = CBZ.player;
    if (isPlayer(perp)) {
      const sameGang = pl && pl.gang != null && n.gang === pl.gang;
      const rivalGang = pl && pl.gang != null && n.gang >= 0 && n.gang !== pl.gang;
      const prot = n.gang >= 0 && CBZ.gangProtection && CBZ.gangProtection(n.gang) > 0;
      const standing = CBZ.gangStanding ? CBZ.gangStanding(n.gang) : 0;
      if ((sameGang || prot) && standing > -20) return false;
      const p = n.personality || {};
      let chance = meta && meta.copCrime ? 0.55 : 0.45;
      chance += ((p.snitch != null ? p.snitch : 0.5) - 0.5) * 0.44;
      chance += ((g.detection || 0) / 100) * 0.14;
      chance += rivalGang ? 0.18 : 0;
      chance += (n.playerGrudge || 0) * 0.025;
      chance -= (n.playerTrust || 0) * 0.02;
      chance -= (n.playerFear || 0) * 0.018;
      chance -= Math.max(0, standing) * 0.002;
      if ((g.racketProtectionT || 0) > 0) chance += rivalGang ? 0.04 : -0.08;
      if ((g.lowProfileT || 0) > 0) chance -= 0.08;
      return rng() < clamp(chance, 0.02, 0.95);
    }
    // an inmate on an inmate: nobody rats on his own clique, and a man from
    // the perp's rival set is glad to
    if (perp && perp.gang >= 0 && n.gang === perp.gang) return false;
    const p = n.personality || {};
    let chance = 0.18 + ((p.snitch != null ? p.snitch : 0.5) - 0.5) * 0.4;
    if (perp && perp.gang >= 0 && n.gang >= 0 && n.gang !== perp.gang) chance += 0.2;
    return rng() < clamp(chance, 0.02, 0.9);
  }
  // SCARED OFF: the perp's people are standing on him and he knows it
  function scaredOff(n, perp) {
    if (!perp || !n.group) return false;
    const b = BR();
    const pers = (n._brain && n._brain.personality) || {};
    const courage = pers.courage != null ? pers.courage : 0.5;
    let stare = 0;
    if (isPlayer(perp)) {
      if (CBZ.player && Math.hypot(CBZ.player.pos.x - n.group.position.x, CBZ.player.pos.z - n.group.position.z) < 5) stare += 1;
    } else if (perp.group) {
      if (alive(perp) && dist(perp, n) < 6) stare += 1;
      const cq = cliqueId(perp.gang);
      if (cq && b && b.social && b.social.cliqueMates) {
        let mates = null;
        try { mates = b.social.cliqueMates(perp, 30); } catch (e) { mates = null; }
        if (mates) for (let i = 0; i < mates.length; i++) if (alive(mates[i]) && dist(mates[i], n) < 6) stare += 1;
      }
    }
    return stare > 0 && rng() < clamp(stare * 0.45 - courage * 0.5 + 0.2, 0, 0.95);
  }
  PB.scaredOff = scaredOff;

  // how the prison plays each witness answer on a man's body
  function playWitness(n, w, perp) {
    const r = w.response;
    if (r === "flee") {
      if (n.aiState === "wander" || n.aiState === "socialize") {
        n.aiState = "flee"; n.fleeT = 2.2 + rng() * 2;
        n.pause = Math.max(n.pause || 0, rng() * 0.5);     // not the whole yard on one frame
      }
    } else if (r === "cower") {
      // he freezes where he stands and watches it, he does not run
      if (n.aiState === "wander") n.pause = Math.max(n.pause || 0, 1 + rng() * 1.5);
      if (CBZ.npcStare) CBZ.npcStare(n, 2 + rng(), perp && perp.group ? perp.group.position : null);
    } else if (r === "cheer" || r === "film" || r === "intervene" || r === "ignore") {
      if (CBZ.npcStare && perp && perp.group) CBZ.npcStare(n, 2.2 + rng() * 1.5, perp.group.position);
      else if (CBZ.npcStare && isPlayer(perp)) CBZ.npcStare(n, 2.2);
    }
  }

  /* The one crime call for the prison. detection.js (the player's crimes) and
     entities/ai.js (a yard fight, a shanking) both land here.
       kind      "assault" | "fight" | "theft" | "gunshot" | "stabbing" | ...
       perp      the player or an inmate
       severity  0..1
       info      { amount, meta, victim, reportSnitch: fn(n, amount, meta) -> bool }
     Returns how many men are now going to talk. */
  const _crimeOpts = { game: GAME, victim: null, sightRange: 18 };
  PB.crime = function (kind, x, z, perp, severity, info) {
    const b = BR();
    if (!b || !b.social || !b.social.crime || !inPrison()) return 0;
    info = info || {};
    syncCast(0, false);
    _crimeOpts.victim = info.victim || null;
    _crimeOpts.sightRange = info.sightRange || 18;
    let seen = 0;
    try { seen = b.social.crime(kind, x, z, perp, severity, _crimeOpts) | 0; } catch (e) { seen = 0; }
    if (!seen) return 0;
    const t = now();
    const pl = isPlayer(perp);
    const maxT = info.maxTalkers != null ? info.maxTalkers : Infinity;
    let talkers = 0;
    const npcs = CBZ.npcs || [];
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      const w = n && n._brain && n._brain.witness;
      if (!w || w.kind !== kind || w.t !== t || w._prisonT === t) continue;
      w._prisonT = t;
      w.prisonPerp = perp;                         // a man who only HEARD it still heard WHO was there
      w.amount = info.amount || 10; w.meta = info.meta || null; w.guard = null;
      const talks = w.reportAt != null;
      if (n === perp || n.cuffed || n.role === "merchant" || n.role === "dealer") { b.social.silence(n, "code"); continue; }
      if (talks) {
        // the brain picked him to talk; the yard's own code gets a veto
        if (!willTalk(n, perp, info.meta) || talkers >= maxT) b.social.silence(n, "code");
        else if (pl) {
          // the player's crime: he WALKS to a screw (ai.js's snitch run,
          // which a crew can intercept); the report is held until he gets there
          w.reportAt = Infinity;
          const ok = info.reportSnitch ? !!info.reportSnitch(n, w.amount, Object.assign({ heardOnly: !w.saw }, w.meta || {})) : false;
          if (!ok) b.social.silence(n, "code");
          else {
            talkers++;
            // he chose to squeeze you for it instead (ai.js's snitchThreat):
            // that deal is ai.js's; a snitch run it ends in lands via reportNow
            if (n.aiState !== "snitch") b.social.silence(n, "deal");
          }
        } else talkers++;
      }
      playWitness(n, w, perp);
    }
    // the screws who saw it: they do not phone themselves. An inmate fight in
    // front of one is a yard case now; the player's crime in front of one is
    // detection.js's witnessGuard, which already acted.
    const gs = CBZ.guards || [];
    let taken = false;
    for (let i = 0; i < gs.length; i++) {
      const gd = gs[i];
      const w = gd && gd._brain && gd._brain.witness;
      if (!w || w.t !== t || w.kind !== kind) continue;
      b.social.silence(gd, "staff");
      if (!pl && !taken && w.saw && perp && perp.group && freeScrew(gd)) taken = beginCase(gd, perp, kind);
    }
    return talkers;
  };

  /* A witness holding a report can be stopped: a crew stepping in, a threat,
     a bribe. ai.js calls this wherever a snitch run is broken off. */
  PB.dropReport = function (n, how) {
    const b = BR();
    if (b && b.social && b.social.silence) b.social.silence(n, how || "stopped");
  };
  /* He got to a screw: the held report lands now (the brain fires onReport on
     its next pump). */
  PB.fileReport = function (n, guard) {
    const w = n && n._brain && n._brain.witness;
    if (!w || w.reported || w.cancelled || w.reportAt == null) return false;
    if (w.reportAt !== Infinity) return false;      // only a report held for THIS walk
    w.guard = guard || null;
    w.reportAt = now();
    return true;
  };
  /* A snitch run the brain was not holding (a tail that turned into a
     report, a huddle, an extortion that went bad): it lands through the same
     door, onReport, so there is ONE place a report becomes heat. */
  PB.reportNow = function (n, guard, amount, meta) {
    const lk = (meta && meta.lastKnown) || (CBZ.player ? CBZ.player.pos : { x: 0, z: 0 });
    onReport({ kind: (meta && meta.type) || "crime", x: lk.x, z: lk.z, perp: CBZ.player, severity: clamp((amount || 12) / 40, 0, 1),
      witness: n, t: now(), amount: amount, meta: meta || null, guard: guard || null });
  };

  /* THE REPORT LANDS — the ONE place a witness report becomes heat. */
  function onReport(rep) {
    if (!inPrison() || !rep) return;
    const n = rep.witness;
    if (!n || isStaff(n)) return;
    // a synthesized report (reportNow) carries its own facts; a brain one
    // carries them on the witness record PB.crime filled in
    const w = rep.amount != null ? null : (n._brain && n._brain.witness);
    const perp = (w && w.prisonPerp) || rep.perp;
    // last chance to be scared off on the way (the perp's people on him)
    if (scaredOff(n, perp)) {
      if (CBZ.npcAvert) CBZ.npcAvert(n, 2.5);
      if (PB.onScared) { try { PB.onScared(n, perp); } catch (e) {} }
      return;
    }
    if (isPlayer(perp)) {
      const amount = rep.amount != null ? rep.amount : (w && w.amount) || Math.round(8 + (rep.severity || 0.5) * 16);
      const meta = Object.assign({}, rep.meta || (w && w.meta) || {});
      if (!meta.lastKnown) meta.lastKnown = { x: rep.x, z: rep.z, type: rep.kind, heardOnly: !(w && w.saw) };
      const gd = rep.guard || (w && w.guard) || null;
      // entities/ai.js's playerReported: the line he says to the screw, the
      // case file, the gossip — the prison's own consequences of a report
      const hook = PB.onPlayerReported || CBZ.prisonPlayerReported;
      if (hook) { try { hook(n, amount, meta, gd); return; } catch (e) {} }
      if (CBZ.recordWitnessReport) CBZ.recordWitnessReport(amount, meta, n, gd);
      else if (CBZ.addHeat) CBZ.addHeat(amount * 0.78);
      return;
    }
    // an inmate reported an inmate: the nearest free screw takes the case
    if (!alive(perp) || perp._lawBy || perp.cuffed || !perp.group) return;
    let best = null, bd = Infinity;
    const gs = CBZ.guards || [];
    for (let i = 0; i < gs.length; i++) {
      const gd = gs[i];
      if (!freeScrew(gd)) continue;
      const d = dist(gd, perp);
      if (d < bd && d < 60) { bd = d; best = gd; }
    }
    if (!best) return;
    if (perp.aiState === "fight") beginCase(best, perp, rep.kind || "fight");
    else best.investigate = { x: rep.x, z: rep.z, t: 6, scan: 0, type: "report", looking: false, player: false };
    if (CBZ.npcAvert) CBZ.npcAvert(n, 2);
  }
  PB._onReport = onReport;

  /* ==========================================================
     5b. NOISE — a sound at a place, for EVERY brain in earshot. The screws'
         dispatch (who walks over, who only turns his head) stays guards.js's
         guardHear, which calls this first; the inmates' answer to a gunshot or
         a scream is the brain's threat response, held for a dwell.
     ========================================================== */
  const KIND = { gunfire: "gunshot", gunshot: "gunshot", taser: "scream", melee: "fight", fight: "fight", steal: "footstep", explosion: "explosion", scream: "scream", glass: "glass", alarm: "alarm" };
  PB.noise = function (x, z, radius, type, source) {
    const b = BR();
    if (!b || !b.perception || !b.perception.noise || !inPrison()) return;
    const kind = KIND[type] || "fight";
    syncCast(0, false);
    try { b.perception.noise(x, z, radius, kind, source || null); } catch (e) { return; }
    if (kind !== "gunshot" && kind !== "explosion" && kind !== "scream") return;
    // the loud ones scatter the yard — each man by his own nerve, not all on one frame
    const t = now();
    const npcs = CBZ.npcs || [];
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (!alive(n) || n.cuffed || n._lawBy || n.aiState !== "wander" && n.aiState !== "socialize") continue;
      const h = b.memory && b.memory.heard ? b.memory.heard(n) : null;
      if (!h || Math.abs((h.t || 0) - t) > 0.05) continue;
      if ((n._threatT || 0) > t) continue;                       // decided recently: hold it
      let r = "ignore";
      try {
        r = b.threat.respond(n, { source: source || null, x, z, armed: kind === "gunshot", aimingAtMe: false, distance: Math.hypot(n.group.position.x - x, n.group.position.z - z), kind }) || "ignore";
      } catch (e) { r = "ignore"; }
      n._threatT = t + 2.5;
      if (r === "flee" || r === "cover") { n.aiState = "flee"; n.fleeT = 2.5 + rng() * 2.5; n.pause = Math.max(n.pause || 0, rng() * 0.45); }
      else if (r === "freeze" || r === "cower" || r === "surrender") { n.pause = Math.max(n.pause || 0, 0.8 + rng() * 1.2); if (CBZ.npcStare) CBZ.npcStare(n, 1.8); }
      else if (CBZ.npcStare && rng() < 0.5) CBZ.npcStare(n, 1.2 + rng());
    }
  };

  /* A GUN IN THE YARD, per man (entities/ai.js asks while he wanders within
     8 m of an armed player). The brain reads it off his own nerve, crew and
     wounds; what he decided holds ~2 s, so a crowd does not flicker and a
     man on a bench does not stand-sit-stand. Not everyone on one frame. */
  PB.armedNear = function (n, d) {
    const b = BR();
    const t = now();
    if (!b || !b.threat || (n._threatT || 0) > t) return;
    n._threatT = t + 1.6 + rng() * 1.2;
    const P = CBZ.player && CBZ.player.pos;
    if (!P) return;
    syncCast(0, false);
    const aiming = !!(n.intimidMode || (CBZ.fps && CBZ.fps.active && d < 6));
    let r = "ignore";
    try { r = b.threat.respond(n, { source: CBZ.player, x: P.x, z: P.z, armed: true, aimingAtMe: aiming, distance: d, kind: "armed" }) || "ignore"; } catch (e) { r = "ignore"; }
    if (r === "flee" || r === "cover") {
      if (n._propSeat && CBZ.rest && CBZ.rest.up) { CBZ.rest.up(n); PB.stoodUp(n, 25); }
      n.aiState = "flee"; n.fleeT = 2.4 + rng() * 2;
      const ax = n.group.position.x - P.x, az = n.group.position.z - P.z, al = Math.hypot(ax, az) || 1;
      n.target.set(n.group.position.x + ax / al * 14, 0, n.group.position.z + az / al * 14);
      n._fleeX = null;
    } else if (r === "freeze" || r === "surrender" || r === "comply") {
      n.pause = Math.max(n.pause || 0, 1.0 + rng());
      if (CBZ.npcStare) CBZ.npcStare(n, 2);
    } else if (CBZ.npcStare && rng() < 0.4) CBZ.npcStare(n, 1.4 + rng());
  };

  /* ==========================================================
     6. MORALE + ROUT — one morale group per clique
     ========================================================== */
  PB.memberDown = function (victim, by, killed) {
    const b = BR();
    if (!b || !b.morale || !victim) return;
    const gid = cliqueId(victim.gang);
    if (!gid) return;
    try {
      if (killed && b.morale.death) b.morale.death(gid, victim);
      else if (b.morale.hit) b.morale.hit(gid, 0.1);
      // the shotcaller dropped: a death is the core's leaderDown + shock; a
      // shotcaller out cold on the floor is a hit of its own
      if (victim.isLeader && !killed && b.morale.hit) b.morale.hit(gid, 0.25);
      // the men next to him feel it (the core does this for a death only)
      if (!killed && b.morale.rattle && b.social && b.social.cliqueMates) {
        const mates = b.social.cliqueMates(victim, 8);
        for (let i = 0; i < mates.length; i++) b.morale.rattle(mates[i], 0.22);
      }
    } catch (e) {}
    checkRout(victim);
  };
  // every one of his clique who is IN it (fighting, or near the incident) and
  // whose own morale has broken runs for his house
  function checkRout(victim) {
    const b = BR();
    if (!b || !b.morale || !b.morale.broken) return 0;
    const npcs = CBZ.npcs || [];
    let routed = 0;
    for (let i = 0; i < npcs.length; i++) {
      const m = npcs[i];
      if (m === victim || !alive(m) || m.gang !== victim.gang || m.cuffed || (m._routT || 0) > 0) continue;
      const engaged = m.aiState === "fight" || (m.huntPlayer || 0) > 0 || dist(m, victim) < 16;
      if (!engaged) continue;
      let broken = false;
      try { broken = !!b.morale.broken(m); } catch (e) { broken = false; }
      if (!broken) continue;
      rout(m);
      routed++;
    }
    return routed;
  }
  PB.checkRout = checkRout;
  function rout(m) {
    m._routT = 9 + rng() * 6;
    m.foe = null; m.huntPlayer = 0; m._blow = null;
    m.aiState = "flee"; m.fleeT = m._routT;
    if (m.char) { m.char.fightStance = false; m.char.punchT = 0; }
    sendHome(m, 1.6);
  }
  PB.rout = rout;
  PB.routing = function (n) { return (n && n._routT || 0) > 0; };
  // a man whose clique has broken does not start anything
  PB.broken = function (n) {
    const b = BR();
    if (!b || !b.morale || !b.morale.broken || !n || n.gang < 0) return false;
    try { return !!b.morale.broken(n); } catch (e) { return false; }
  };

  /* ==========================================================
     7. RETALIATION — proportional, decided by the brain
     ========================================================== */
  /* Returns [{actor, level}] of his clique who answer, level in
     "glare" | "shove" | "fight" | "weapon" (a copy: the core's buffer is
     reused on its next call). */
  const _ret = [];
  PB.retaliate = function (victim, aggressor, harm) {
    _ret.length = 0;
    const b = BR();
    if (!b || !b.social || !b.social.retaliate || !victim || !aggressor) return _ret;
    let list = null;
    try { list = b.social.retaliate(victim, aggressor, clamp(harm, 0, 1)); } catch (e) { list = null; }
    if (!list || !list.length) return _ret;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it) continue;
      const actor = it.actor, level = it.level || "glare";
      if (!actor || actor === aggressor || actor === victim) continue;
      _ret.push({ actor, level });
    }
    return _ret;
  };

  /* ==========================================================
     8. SEATED/LYING MEN — the decision half of "sitting on the bed is
        glitchy". A man who stood up because something happened does not sit
        straight back down; he gives it a while (prisonrest.js asks).
     ========================================================== */
  // what his routine says he is doing now (prisonschedule.js hands the block
  // table to CBZ.brain.needs as the inmate routine)
  PB.activity = function (n) {
    const b = BR(), S = CBZ.prisonSchedule;
    if (!b || !b.needs || !n) return null;
    const cur = b.needs.current(n, S && S.hour ? S.hour() : undefined);
    return cur ? cur.activity : null;
  };
  PB.mayRest = function (a) {
    return !((a._restCD || 0) > now());
  };
  PB.stoodUp = function (a, secs) {
    a._restCD = now() + (secs || 20);
  };

  /* ==========================================================
     9. WIRING — once the brain exists
     ========================================================== */
  /* THE PRISON'S VOICE ON THE LADDER. The core's lines are a street cop's
     ("Police! Hold it!"); a screw in a yard says it his way. */
  const SCREW_LINES = {
    warn: ["Break it up!", "Hey! Knock it off!", "Break it up! Now!"],
    order: ["On the ground! Now!", "Get down! Down!", "Hands where I can see them!"],
    orderArmed: ["Drop it! Drop the shank!", "Drop it! Now!"],
    approach: ["Stay down.", "Don't move."],
    cuff: ["Hands behind your back.", "Don't move."],
    frisk: ["Hands on the wall.", "Arms out."],
    warned: ["Move along.", "Don't let me see it again.", "Walk away."],
    escalate: ["Last warning!", "Stop resisting!"],
    force: ["Taser! Taser!", "Get down!"],
    lethal: ["Drop it or I shoot!"],
    done: ["Up. Back to your house.", "Walk it off."],
  };
  let wired = false;
  function wire() {
    const b = BR();
    if (wired || !b) return !!wired;
    wired = true;
    try { if (b.act && b.act.use) b.act.use(GAME, exec); } catch (e) {}
    try { if (b.social && b.social.onReport) b.social.onReport(GAME, onReport); } catch (e) {}
    /* NO INSTANT SPOT. The core's closeSpot (2.6 m) filled a screw's meter in
       one frame; a man that close still takes a real beat to read now, it is
       only arm's reach that is instant. */
    try {
      if (b.define) {
        b.define("guard", { closeSpot: 1.3, lines: SCREW_LINES });
        b.define("warden", { closeSpot: 1.3, lines: SCREW_LINES });
      }
    } catch (e) {}
    /* A YARD IS NOT A FAMILY. Same faction reads as friendly (1.0) in the
       core, and a friendly witness never reports — so no inmate would ever
       tell on another. Men in the same yard are barely civil; the clique is
       the family (a man never reports his own set: willTalk above). */
    try { if (b.social && b.social.setAttitude) b.social.setAttitude("inmates", "inmates", 0.2); } catch (e) {}
    // the two cliques are each other's enemy: a set that is winning holds
    try {
      if (b.morale && b.morale.config) {
        b.morale.config(cliqueId(0), { foe: cliqueId(1) });
        b.morale.config(cliqueId(1), { foe: cliqueId(0) });
      }
    } catch (e) {}
    return true;
  }
  PB.wire = wire;

  // one tick for the prison's brains: after the guards (20) and inmates (22)
  let moraleAcc = 0, routAcc = 0;
  function tick(dt) {
    if (!inPrison() || !(dt > 0)) return;
    if (!wire()) return;
    frameDt = dt;
    const b = BR();
    // clock() also pumps the witness reports that have come due
    if (b.clock) { try { b.clock(+G().elapsed || 0); } catch (e) {} }
    syncCast(dt, false);
    // HARNESS TRAP: nothing in the core ticks morale unless a game calls
    // update(dt) or morale.tick(dt); the prison ticks its own groups at 4 Hz
    moraleAcc += dt;
    if (moraleAcc >= 0.25 && b.morale && b.morale.tick) { try { b.morale.tick(moraleAcc); } catch (e) {} moraleAcc = 0; }
    if (G().state !== "playing") return;
    yardLawPoll(dt);
    // a man IN a clique fight whose nerve has gone breaks off and runs home
    routAcc += dt;
    if (routAcc >= 1) {
      routAcc = 0;
      const npcs = CBZ.npcs || [];
      for (let i = 0; i < npcs.length; i++) {
        const n = npcs[i];
        if (!n || n.gang < 0 || n.aiState !== "fight" || !alive(n) || (n._routT || 0) > 0 || n._lawBy) continue;
        if (PB.broken(n)) rout(n);
      }
    }
  }
  PB.tick = tick;
  if (CBZ.onUpdate) CBZ.onUpdate(22.5, tick);

  // a new run: every case, cuff and rout is gone
  PB.reset = function () {
    for (const gd of CBZ.guards || []) { gd._yardCase = null; gd._yardHold = false; gd._yardPhase = null; }
    for (const n of CBZ.npcs || []) {
      if (n.cuffed) { n.cuffed = false; if (n.char) { n.char.cuffed = false; n.char.surrender = false; } }
      n._cuffT = 0; n._lawBy = null; n._lawAns = null; n._routT = 0; n._lawHeldT = 0; n._restCD = 0;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PB;
})();
