/* ============================================================
   systems/prisondoorwatch.js — A DOOR OPENED OFF THE CLOCK IS NOTICED.

   OWNER, 2026-09-28: "the cop should be able to open one on his own, and
   especially when it's supposed to be closed, someone should react: 'hey,
   what the fuck, why'd you open it?' That shows the AI being smart."

   The doors themselves are systems/interactions.js's shared registry
   (CBZ.prisonDoorList: every cell front, the yard gate, the wing and admin
   card doors, the armory). The timetable is systems/prisonschedule.js. This
   file only answers ONE question, and then lets people act on it:

       the player opened a door that the prison's day says is shut. Who
       noticed, and what do they do about it?

   WHAT COUNTS (rule()): a cell front while the wing is locked (secure, lights
   out, a lockdown); the yard gate at lights out / lockdown / a locked wing
   with no count running; the armory at night or left standing open with
   nobody at it (and ALWAYS for an inmate); any card or picked door an INMATE
   opens. A cop badging a staff door on his round is his job: nothing.

   WHO NOTICES — the one brain's senses, never a global flag:
     sight    CBZ.brain.perception.seesPoint on the leaf (or on the man at it)
     hearing  the leaf's clank goes out as perception.noise("door") and a
              screw whose memory.heard() says "door, just now, there" comes
     control  the board in central control shows every leaf; after a few
              seconds the nearest free screw is radioed. A thrown breaker
              blinds the board (cameras and panels are on the same power).

   WHAT THEY DO:
     a screw   challenges ("Hey! Why's that open? It's count."), walks to the
               door, asks the officer for a reason if he is standing there,
               and shuts it himself if nobody does. An INMATE at a door he had
               no business opening is an offense (prisonlaw "restricted") and
               the screw comes for him.
     inmates   the man behind the cell front steps out; bold men who see an
               open gate after dark make a run for it and a clique mate or two
               goes with them; the curious drift over to look.
     the Warden  repeated breaches by the officer reach him (CBZ.warden
               .officer): a PA summons and his standing drops, then his keys
               are pulled until the morning unlock. A man who runs through a
               door the officer left open is on the officer.

   Every line is a few words, over the speaker's head (CBZ.prisonSay).
   Probe: CBZ.prisonDoorWatch.audit().
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ;
  if (!CBZ) return;

  const W = CBZ.prisonDoorWatch = CBZ.prisonDoorWatch || {};

  function G() { return CBZ.game || {}; }
  function now() { return +G().elapsed || 0; }
  function brainNow() { const b = CBZ.brain; return b && b.now ? b.now() : now(); }
  function live() { const g = G(); return g.mode === "escape" && g.state === "playing"; }
  function rng() { return CBZ.econ && CBZ.econ.rng ? CBZ.econ.rng() : Math.random(); }
  function pick(a) { return a[(rng() * a.length) | 0]; }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function alive(a) { return !!(a && a.group && !a.dead && !(a.ko > 0) && !a.escaped); }
  function PP() { return CBZ.player && CBZ.player.pos; }
  function sched() { return CBZ.prisonSchedule || null; }
  function lockdown() { return !!(CBZ.lockdownActive && safe(CBZ.lockdownActive, false)); }
  function say(a, line, secs) {
    if (!a || !line || !CBZ.prisonSay) return false;
    return !!safe(function () { return CBZ.prisonSay(a, line, { force: true, secs: secs || 2.4 }); }, false);
  }

  /* ---- THE STAFF KEY. The officer's keys open every card door in the
     compound, until the Warden has them pulled. Every door file asks this
     one function (feature-detected, so load order never matters). ---- */
  CBZ.prisonStaffKey = function () {
    const g = G();
    return !!(g.mode === "escape" && g.role === "cop" && !g.copKeysPulled);
  };

  /* ==========================================================
     1. WHAT IS OUT OF SCHEDULE
     ========================================================== */
  function kindOf(s) {
    const id = String(s.id || "");
    if (id.indexOf("prison-cell-") === 0) return "cell";
    if (id === "prison-yard-door") return "gate";
    if (id === "prison-armory" || id === "prison-armory-cage") return "armory";
    return "staff";
  }
  function at(s) { return safe(function () { return s.at(); }, null); }
  function isOpen(s) { return !!safe(function () { return s.isOpen(); }, false); }
  function gone(s) { return !!safe(function () { return s.permanent && s.permanent(); }, true); }
  function cellOf(s) {
    const cb = CBZ.cellblock;
    const i = +String(s.id).slice(12);
    return cb && cb.cells && isFinite(i) ? cb.cells[i] || null : null;
  }
  function d2p(p) {
    const P = PP();
    if (!P || !p) return Infinity;
    const dx = P.x - p.x, dz = P.z - p.z;
    return dx * dx + dz * dz;
  }
  // reason string, or null when the door may stand open right now
  function rule(s, role, openFor) {
    const S = sched();
    const lock = lockdown();
    const night = !!(S && S.lightsOut && S.lightsOut());
    const sealed = lock || !!(S && S.cellsLocked && S.cellsLocked());
    const k = kindOf(s);
    if (k === "cell") {
      if (!sealed) return null;
      return lock ? "lockdown" : night ? "night" : "count";
    }
    if (k === "gate") {
      // an inmate badging the checkpoint off the count is a man with a card
      if (role !== "cop" && !(S && S.counting && S.counting())) return "staff";
      if (lock) return "lockdown";
      if (night) return "night";
      if (sealed && !(S && S.counting && S.counting())) return "count";
      return null;
    }
    if (k === "armory") {
      if (role !== "cop") return "armory";
      if (lock || night) return "armory";
      // standing open with nobody at it: a room full of guns left to the block
      if (openFor > 4 && d2p(at(s)) > 9 * 9) return "armoryLeft";
      return null;
    }
    // a staff door: the officer's round. An inmate has no business at one
    // that needs a card or a pick (`keyed`, declared by the door's own file);
    // a plain corridor door is just a door.
    return role === "cop" || !s.keyed ? null : "staff";
  }
  W.rule = rule;

  /* ==========================================================
     2. THE LINES — few, short, said by a man, over his head
     ========================================================== */
  const L = {
    challenge: {
      count: ["Hey! Why's that open? It's count.", "Whoa, whoa. We're counting. Shut that."],
      night: ["Hey. Lights out. Why's that open?", "What are you doing? They're locked in."],
      lockdown: ["We're on lockdown! Shut it!", "Lockdown! Who opened that?"],
      armory: ["You sign that out? Close it up.", "Hey! Staff only!"],
      armoryLeft: ["Who left that open?"],
      staff: ["Hey! Where'd you get that card?", "Get away from that door!"],
    },
    // an inmate out of his own cell after lock-up
    cellInmate: ["Hey! Back in your cell!", "Who let you out?"],
    again: ["Again? The Warden's gonna hear about this.", "Twice now. Come on, man."],
    found: ["Who left this open?", "Why's this open?"],
    radio: {
      cell: "Control says a cell's open. I got it.",
      gate: "Tower says the yard gate's open. On it.",
      armory: "Control, I show a door open. Checking.",
      staff: "Control's got a door open. On it.",
    },
    ask: ["You got a reason?", "What's going on?"],
    ok: ["Alright. Keep it shut.", "Thank you."],
    shut: ["Stays shut till morning.", "Nope. Shut."],
    out: ["Door's open.", "Huh. Door's open."],
    run: ["Gate's open. Go, go.", "Gate's open. Let's go."],
    // the Warden, on the PA, as the officer's record grows
    wardenSee: ["Officer, my office. Now."],
    wardenKeys: ["Control, pull that officer's keys."],
    wardenRun: ["We have a runner. That was your door, officer."],
  };
  W.LINES = L;

  /* ==========================================================
     3. BREACHES
     ========================================================== */
  const CONTROL_S = { cell: 7, gate: 5, armory: 4, staff: 9 };
  const breaches = [];        // live ones
  let seq = 0;
  const log = { opened: 0, breaches: 0, seen: 0, heard: 0, radioed: 0, challenged: 0, asked: 0,
    complied: 0, shutByStaff: 0, offenses: 0, steppedOut: 0, drifted: 0, runners: 0, onHim: 0, keysPulled: 0,
    summons: 0 };
  W.log = log;

  function findBreach(s) {
    for (let i = 0; i < breaches.length; i++) if (breaches[i].s === s && !breaches[i].done) return breaches[i];
    return null;
  }
  function open(s, reason) {
    const p = at(s);
    const b = {
      id: ++seq, s: s, kind: kindOf(s), reason: reason, role: G().role === "cop" ? "cop" : "inmate",
      t: now(), x: p ? p.x : 0, z: p ? p.z : 0, y: p ? p.y : 1.4,
      noticed: false, how: null, gd: null, retryAt: 0, done: false, runners: 0, drifters: 0,
      steppedOut: false, weight: 0,
    };
    breaches.push(b);
    log.breaches++;
    // the leaf's own clank, through the one hearing model: the men near it
    // turn their heads (memory.heard) even with a wall in the way at half range
    const B = CBZ.brain;
    if (B && B.perception && B.perception.noise) safe(function () { return B.perception.noise(b.x, b.z, 11, "door", null); }, 0);
    return b;
  }

  /* ---- the player's hand on a door. systems/interactions.js's doorAct calls
     this for every deliberate open / close, and the poll below catches the
     rest (a Cell Key pressed against the bars, a card reader on approach). */
  W.acted = function (s, opened) {
    if (!s) return;
    s._byPlayerAt = now();
    if (opened) { s._pOpen = { t: now(), role: G().role }; log.opened++; }
    else closedNow(s, true);
  };
  function closedNow(s, byPlayer) {
    s._pOpen = null;
    const b = findBreach(s);
    if (!b) return;
    b.closedBy = byPlayer ? "player" : "other";
    // closed before anybody noticed: it never happened
    if (!b.noticed) { b.done = true; }
  }

  /* ==========================================================
     4. WHO NOTICES
     ========================================================== */
  function freeGuard(gd) {
    return !!(gd && alive(gd) && gd.kind !== "warden" && !gd.asleep && !gd.tied && !(gd.bribed > 0) &&
      !gd._escort && !gd._wardenCall && !gd._wardenEscort && !gd._shakedown && !(gd.hunt > 0) &&
      !gd._yardCase && !gd._doorCase && gd.intimidMode !== "scared" && !(gd.pause > 0));
  }
  function seesAt(obs, x, y, z) {
    const B = CBZ.brain;
    if (!B || !B.perception || !obs._brain) {
      return Math.hypot(obs.group.position.x - x, obs.group.position.z - z) < 12;
    }
    return !!safe(function () { return B.perception.seesPoint(obs, x, y, z, null); }, false);
  }
  function heardIt(gd, b) {
    const B = CBZ.brain;
    if (!B || !B.memory || !B.memory.heard) return false;
    const h = safe(function () { return B.memory.heard(gd); }, null);
    return !!(h && h.kind === "door" && brainNow() - h.t < 3 && Math.hypot(h.x - b.x, h.z - b.z) < 2.5);
  }
  function controlUp() {
    if (CBZ.breaker && CBZ.breaker.sabotaged) return false;          // the board is dark
    return true;
  }
  function watchers(b) {
    const gs = CBZ.guards || [];
    const P = PP();
    const playerAt = P && d2p(b) < 6 * 6;
    let best = null, bd = Infinity, how = null, sawPlayer = false;
    for (let i = 0; i < gs.length; i++) {
      const gd = gs[i];
      if (!freeGuard(gd)) continue;
      const gp = gd.group.position;
      const d = Math.hypot(gp.x - b.x, gp.z - b.z);
      if (d > 30 || d >= bd) continue;
      let h = null, sp = false;
      if (playerAt && seesAt(gd, P.x, (P.y || 0) + 1.2, P.z)) { h = "seen"; sp = true; }
      else if (seesAt(gd, b.x, b.y, b.z)) h = "seen";
      else if (heardIt(gd, b)) h = "heard";
      if (!h) continue;
      best = gd; bd = d; how = h; sawPlayer = sp;
    }
    return best ? { gd: best, how: how, sawPlayer: sawPlayer } : null;
  }
  function nearestFree(x, z, R) {
    const gs = CBZ.guards || [];
    let best = null, bd = R;
    for (let i = 0; i < gs.length; i++) {
      const gd = gs[i];
      if (!freeGuard(gd)) continue;
      const d = Math.hypot(gd.group.position.x - x, gd.group.position.z - z);
      if (d < bd) { bd = d; best = gd; }
    }
    return best;
  }

  function assign(b, gd, how, sawPlayer) {
    b.noticed = true; b.how = how; b.gd = gd;
    if (how === "radio") log.radioed++; else if (how === "heard") log.heard++; else log.seen++;
    gd._doorCase = { b: b, phase: "spot", pt: 0, t: 0, sawPlayer: !!sawPlayer, said: false };
    gd.investigate = null;
    if (how === "radio") {
      say(gd, L.radio[b.kind] || L.radio.staff, 2.6);
      gd._doorCase.said = true;
      gd._doorCase.phase = "go";
    }
  }

  /* ==========================================================
     5. THE SCREW'S BODY — guards.js calls this every frame for a man with
        a door case (after the yard law, before his round). true = owned.
     ========================================================== */
  function endCase(gd) {
    const C = gd._doorCase;
    gd._doorCase = null;
    gd._returning = true;
    if (C && C.b && C.b.gd === gd) C.b.gd = null;
  }
  W.endCase = endCase;
  function bodyInDoor(s, p) {
    const col = safe(function () { return s.col && s.col(); }, null);
    const test = function (q) {
      if (col && isFinite(col.minX)) return q.x > col.minX - 0.45 && q.x < col.maxX + 0.45 && q.z > col.minZ - 0.45 && q.z < col.maxZ + 0.45;
      return Math.hypot(q.x - p.x, q.z - p.z) < 0.9;
    };
    const P = PP();
    if (P && test(P)) return true;
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n || n.dead || n.escaped || n._crowd || !n.group) continue;
      if (test(n.group.position)) return true;
    }
    return false;
  }
  function staffShut(s) {
    const c = kindOf(s) === "cell" ? cellOf(s) : null;
    if (c) c._keyed = false;
    safe(function () { return s.set(false); }, false);
    const ok = !isOpen(s);
    if (ok) {
      s._pOpen = null;
      // the officer is standing at the reader: the file's approach-open must
      // not throw it straight back open (the same latch his own close sets)
      s._latch = true;
    }
    return ok;
  }
  function faceIdle(gd, x, z, dt) {
    if (CBZ.guardFaceTo) CBZ.guardFaceTo(gd, x, z, 0.002, dt);
    if (CBZ.guardLookAt) CBZ.guardLookAt(gd, x, z);
    if (CBZ.guardIdle) CBZ.guardIdle(gd, dt);
  }
  W.guardStep = function (gd, dt) {
    const C = gd._doorCase;
    if (!C) return false;
    const b = C.b, s = b.s;
    if (!live() || !alive(gd) || gd.hunt > 0 || gd._yardCase || b.done && C.phase !== "after" || gone(s)) {
      endCase(gd); return false;
    }
    C.t += dt; C.pt += dt;
    const p = at(s) || { x: b.x, y: b.y, z: b.z };
    const P = PP();
    const cop = b.role === "cop";
    const opened = isOpen(s);
    switch (C.phase) {
      case "spot": {
        // the beat of a man turning to it: face it, then say it
        const tx = C.sawPlayer && P ? P.x : p.x, tz = C.sawPlayer && P ? P.z : p.z;
        faceIdle(gd, tx, tz, dt);
        if (!C.said && C.pt > 0.35) {
          C.said = true;
          log.challenged++;
          const again = cop && (G().copDoorMarks || 0) >= 1;
          if (!C.sawPlayer) say(gd, pick(L.found), 2.2);
          else if (!cop) say(gd, pick(b.kind === "cell" ? L.cellInmate : L.challenge.staff), 2.4);
          else say(gd, again && rng() < 0.6 ? pick(L.again) : pick(L.challenge[b.reason] || L.found), 2.6);
          // an inmate caught at a door with a card: that is the offense, and
          // the man who saw it comes for him (prisonlaw.js hunts)
          if (!cop && C.sawPlayer && CBZ.prisonOffense) {
            log.offenses++;
            safe(function () { return CBZ.prisonOffense("restricted", { by: "player", seenBy: gd, severity: 2, at: P ? { x: P.x, z: P.z } : null }); }, null);
            b.weight = 1;
            // his hunt outranks the door: another man (or control) shuts it
            b.gd = null; b.noticed = false; b.retryAt = now() + 6;
            gd._doorCase = null;
            return false;
          }
        }
        if (C.pt > 1.0) { C.phase = "go"; C.pt = 0; }
        return true;
      }
      case "go": {
        if (!opened) {
          // shut before he got there: by the officer (that is compliance) or anyone
          if (cop && b.closedBy === "player" && P && d2p(p) < 8 * 8) { say(gd, pick(L.ok), 2); log.complied++; b.weight = 0.5; }
          finish(b); C.phase = "after"; C.pt = 0; return true;
        }
        // stand-off on his own side of the leaf
        const gp = gd.group.position;
        const vx = gp.x - p.x, vz = gp.z - p.z, vl = Math.hypot(vx, vz) || 1;
        const sx = p.x + vx / vl * 1.1, sz = p.z + vz / vl * 1.1;
        const d = Math.hypot(sx - gp.x, sz - gp.z);
        if (d > 0.45 && vl > 1.35) {
          if (CBZ.guardWalkTo) CBZ.guardWalkTo(gd, sx, sz, (gd.speed || 2.2) * 1.3, dt, 0.3);
          if (C.pt > 35) { b.gd = null; b.noticed = false; b.retryAt = now() + 8; endCase(gd); return false; }
          return true;
        }
        C.phase = cop && P && d2p(p) < 6 * 6 ? "ask" : "shut";
        C.pt = 0; C.said = false;
        return true;
      }
      case "ask": {
        // the officer is right there: he asks, and gives him a beat to shut it
        if (P) faceIdle(gd, P.x, P.z, dt);
        if (!C.said) { C.said = true; log.asked++; say(gd, pick(L.ask), 2.2); }
        if (!opened) { say(gd, pick(L.ok), 2); log.complied++; b.weight = 0.5; finish(b); C.phase = "after"; C.pt = 0; return true; }
        if (C.pt > 3.4) { C.phase = "shut"; C.pt = 0; C.said = false; }
        return true;
      }
      case "shut": {
        faceIdle(gd, p.x, p.z, dt);
        if (!opened) { finish(b); C.phase = "after"; C.pt = 0; return true; }
        if (C.pt < 0.5) return true;
        // never a leaf on a body: he waits for the doorway to clear
        if (bodyInDoor(s, p) && C.pt < 8) return true;
        if (staffShut(s)) {
          log.shutByStaff++;
          say(gd, pick(L.shut), 2.2);
          b.weight = cop ? 1 : 0;
        }
        finish(b); C.phase = "after"; C.pt = 0;
        return true;
      }
      case "after": {
        // a look at the man who did it, then back to his round
        if (P && d2p(p) < 10 * 10) faceIdle(gd, P.x, P.z, dt); else if (CBZ.guardIdle) CBZ.guardIdle(gd, dt);
        if (C.pt > 1.2) { endCase(gd); return false; }
        return true;
      }
    }
    endCase(gd);
    return false;
  };

  /* ==========================================================
     6. THE RECORD — the officer's breaches reach the Warden
     ========================================================== */
  function warden(dv, lines) {
    const Wd = CBZ.warden;
    if (Wd && Wd.officer) return !!safe(function () { return Wd.officer(dv, lines); }, false);
    return false;
  }
  function finish(b) {
    if (b.done) return;
    b.done = true;
    if (b.role !== "cop" || !(b.weight > 0)) return;
    const g = G();
    const before = g.copDoorMarks || 0;
    g.copDoorMarks = before + b.weight;
    if (before < 2 && g.copDoorMarks >= 2) { log.summons++; warden(-2, L.wardenSee); }
    else if (before < 3 && g.copDoorMarks >= 3) pullKeys(L.wardenKeys, -3);
    else warden(-1, null);
  }
  function pullKeys(lines, dv) {
    const g = G();
    if (!g.copKeysPulled) log.keysPulled++;
    g.copKeysPulled = true;
    warden(dv, lines);
  }
  function onHim(b) {
    if (b.onHim) return;
    b.onHim = true;
    log.onHim++;
    if (b.role !== "cop") return;
    const g = G();
    g.copDoorMarks = Math.max(3, (g.copDoorMarks || 0) + 2);
    pullKeys(L.wardenRun, -4);
  }

  /* ==========================================================
     7. THE BLOCK SEES IT TOO — the men it was shut on
     ========================================================== */
  function guts(n) {
    const bh = (CBZ.behaviorOf && safe(function () { return CBZ.behaviorOf(n); }, null)) || null;
    let v = bh && bh.guts != null ? bh.guts : 0.5;
    if (n.isLeader || n.crewRole === "shotcaller") v += 0.2;
    return v;
  }
  function freeInmate(n) {
    return !!(alive(n) && n.kind === "inmate" && !n._crowd && !n.cuffed && !n._lawBy && !(n.huntPlayer > 0) &&
      !n.intimidMode && n.aiState !== "fight" && n.aiState !== "escape" && n.target && n.target.set);
  }
  function standUp(n) {
    if ((n._propSeat || n._propBed || n._propLie) && CBZ.rest && CBZ.rest.up) safe(function () { return CBZ.rest.up(n); }, null);
    if (CBZ.prisonBrain && CBZ.prisonBrain.stoodUp) CBZ.prisonBrain.stoodUp(n, 40);
  }
  function inmatesSee(b) {
    const npcs = CBZ.npcs || [];
    const S = sched();
    const night = !!(S && S.lightsOut && S.lightsOut()) || lockdown();
    // the man it was shut on: he hears his own bars go
    if (b.kind === "cell" && !b.steppedOut) {
      b.steppedOut = true;
      const c = cellOf(b.s);
      const n = c && c.owner;
      if (n && n !== "player" && freeInmate(n) && rng() < (n._propBed || n._propLie ? 0.55 : 0.8)) {
        standUp(n);
        // a step through the opening into the aisle, away from the cell centre
        const vx = b.x - c.x, vz = b.z - c.z, vl = Math.hypot(vx, vz) || 1;
        n.target.set(b.x + vx / vl * 1.8, 0, b.z + vz / vl * 1.8);
        n.aiState = "wander"; n.aiTimer = 6; n.pause = 0;
        n._doorSeen = b.id;
        say(n, pick(L.out), 2);
        log.steppedOut++;
      }
    }
    let spoke = false;
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (!n || n._doorSeen === b.id || !freeInmate(n)) continue;
      const q = n.group.position;
      const d = Math.hypot(q.x - b.x, q.z - b.z);
      if (d > 16) continue;
      if (CBZ.cellblock && CBZ.cellblock.held && CBZ.cellblock.held(n)) continue;   // behind his own bars
      if (!seesAt(n, b.x, b.y, b.z)) continue;
      n._doorSeen = b.id;
      const bold = guts(n);
      if (b.kind === "gate" && night && bold > 0.55 && b.runners < 3) {
        // a real move: he goes, and his set goes with him
        standUp(n);
        n.aiState = "escape"; n.aiTimer = 0; n._escX = null;
        b.runners++; log.runners++;
        if (!spoke) { spoke = true; say(n, pick(L.run), 1.8); }
        const cq = n.gang;
        for (let k = 0; k < npcs.length && b.runners < 3; k++) {
          const m = npcs[k];
          if (m === n || !m || m.gang !== cq || cq == null || cq < 0 || m._doorSeen === b.id || !freeInmate(m)) continue;
          if (Math.hypot(m.group.position.x - q.x, m.group.position.z - q.z) > 10 || rng() < 0.4) continue;
          m._doorSeen = b.id;
          standUp(m);
          m.aiState = "escape"; m.aiTimer = 0; m._escX = null;
          b.runners++; log.runners++;
        }
        continue;
      }
      if (bold > 0.45 && b.drifters < 4 && d > 3) {
        // the curious wander over for a look
        const vx = q.x - b.x, vz = q.z - b.z, vl = Math.hypot(vx, vz) || 1;
        n.target.set(b.x + vx / vl * 2.6, 0, b.z + vz / vl * 2.6);
        n.aiTimer = 5; n.pause = 0;
        b.drifters++; log.drifted++;
      }
    }
  }

  /* ==========================================================
     8. THE TICK — after every door's own tick and the latch upkeep (41.46)
     ========================================================== */
  let scanT = 0, inmateT = 0, escT = 0, lastBlock = null;
  const pollRun = CBZ.jailBoost && CBZ.jailBoost.newRunWatcher ? CBZ.jailBoost.newRunWatcher(0.5) : null;
  function reset() {
    breaches.length = 0;
    const g = G();
    g.copDoorMarks = 0; g.copKeysPulled = false;
    const specs = CBZ.prisonDoorList ? CBZ.prisonDoorList() : [];
    for (let i = 0; i < specs.length; i++) { specs[i]._pOpen = null; specs[i]._wasOpen = undefined; specs[i]._byPlayerAt = -1e9; }
    for (const gd of CBZ.guards || []) gd._doorCase = null;
    for (const n of CBZ.npcs || []) n._doorSeen = 0;
    for (const n of CBZ.npcs || []) n._escNoted = false;
  }
  W.reset = reset;

  function staffAt(p, R) {
    const gs = CBZ.guards || [];
    for (let i = 0; i < gs.length; i++) {
      const gd = gs[i];
      if (!alive(gd)) continue;
      if (Math.hypot(gd.group.position.x - p.x, gd.group.position.z - p.z) < R) return true;
    }
    return false;
  }
  function tick(dt) {
    if (pollRun && pollRun()) reset();
    if (!live()) return;
    const specs = CBZ.prisonDoorList ? CBZ.prisonDoorList() : null;
    if (!specs || !specs.length) return;
    const t = now();
    const role = G().role === "cop" ? "cop" : "inmate";

    // the morning unlock hands the officer his keys back and wipes the slate
    const S = sched();
    const blk = S && S.id ? S.id() : null;
    if (blk !== lastBlock) {
      if (blk === "wake" && lastBlock != null) { G().copKeysPulled = false; G().copDoorMarks = 0; }
      lastBlock = blk;
    }

    // ---- transitions: who opened what
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const o = isOpen(s);
      if (s._wasOpen === undefined) { s._wasOpen = o; continue; }
      if (o === s._wasOpen) continue;
      s._wasOpen = o;
      if (o) {
        if (s._pOpen) continue;                           // doorAct already stamped it
        const p = at(s);
        if (!p || gone(s)) continue;
        const reach = Math.max(2.6, (s.autoR || 2.5) + 0.8);
        const mine = (t - (s._byPlayerAt || -1e9) < 0.6) ||
          (kindOf(s) !== "cell" || S && S.cellsLocked && S.cellsLocked()) && d2p(p) < reach * reach && !staffAt(p, 3.0);
        if (mine) { s._pOpen = { t: t, role: role }; log.opened++; }
      } else closedNow(s, t - (s._byPlayerAt || -1e9) < 0.6);
    }

    scanT -= dt; inmateT -= dt; escT -= dt;
    if (scanT <= 0) {
      scanT = 0.25;
      // ---- a door the player opened becomes a breach the moment the day says shut
      for (let i = 0; i < specs.length; i++) {
        const s = specs[i];
        if (!s._pOpen || findBreach(s) || gone(s)) continue;
        if (!isOpen(s)) { s._pOpen = null; continue; }
        const why = rule(s, s._pOpen.role === "cop" ? "cop" : "inmate", t - s._pOpen.t);
        if (why) open(s, why);
      }
      // ---- and each live breach looks for somebody to notice it
      for (let i = breaches.length - 1; i >= 0; i--) {
        const b = breaches[i];
        if (b.done) { if (t - b.t > 300) breaches.splice(i, 1); continue; }
        if (gone(b.s)) { b.done = true; continue; }
        // his case was taken off him (a hunt, a fight, a KO outranks a door)
        if (b.gd && (!b.gd._doorCase || b.gd._doorCase.b !== b || b.gd.hunt > 0 || !alive(b.gd))) {
          if (b.gd._doorCase && b.gd._doorCase.b === b) b.gd._doorCase = null;
          b.gd = null; b.noticed = false; b.retryAt = t + 4;
        }
        if (!isOpen(b.s)) { if (!b.gd) finish(b); continue; }
        if (b.gd || t < b.retryAt) continue;
        const w = watchers(b);
        if (w) { assign(b, w.gd, w.how, w.sawPlayer); continue; }
        // nobody's eyes on it: the board in central control, a few seconds on
        const marks = G().copDoorMarks || 0;
        const delay = (CONTROL_S[b.kind] || 8) * (b.role === "cop" && marks >= 2 ? 0.5 : 1);
        if (controlUp() && t - b.t > delay) {
          const gd = nearestFree(b.x, b.z, 90);
          if (gd) assign(b, gd, "radio", false);
        }
      }
    }
    if (inmateT <= 0) {
      inmateT = 0.5;
      for (let i = 0; i < breaches.length; i++) {
        const b = breaches[i];
        if (!b.done && isOpen(b.s)) inmatesSee(b);
      }
    }
    // ---- a man through a door the officer opened is on the officer
    if (escT <= 0) {
      escT = 1;
      const npcs = CBZ.npcs || [];
      for (let i = 0; i < npcs.length; i++) {
        const n = npcs[i];
        if (!n || !n.escaped || n._escNoted) continue;
        n._escNoted = true;
        for (let k = breaches.length - 1; k >= 0; k--) {
          const b = breaches[k];
          if (t - b.t > 240) continue;
          if (n._doorSeen === b.id || (b.kind === "gate" && (b.runners > 0 || isOpen(b.s)))) { onHim(b); break; }
        }
      }
    }
  }
  W.tick = tick;
  if (CBZ.onUpdate) CBZ.onUpdate(41.5, tick);

  W.breaches = function () { return breaches; };
  W.audit = function () {
    const g = G();
    return {
      live: breaches.filter(function (b) { return !b.done; }).map(function (b) {
        return { id: b.s.id, kind: b.kind, reason: b.reason, role: b.role, noticed: b.noticed, how: b.how,
          gd: b.gd ? (b.gd.name || b.gd.id || "guard") : null, phase: b.gd && b.gd._doorCase ? b.gd._doorCase.phase : null,
          gdAt: b.gd ? [+b.gd.group.position.x.toFixed(1), +b.gd.group.position.z.toFixed(1), +Math.hypot(b.gd.group.position.x - b.x, b.gd.group.position.z - b.z).toFixed(1), b.gd.state, +(b.gd._navWait || 0).toFixed(1)] : null,
          at: [+b.x.toFixed(1), +b.z.toFixed(1)],
          open: isOpen(b.s), runners: b.runners, drifters: b.drifters };
      }),
      total: breaches.length, marks: g.copDoorMarks || 0, keysPulled: !!g.copKeysPulled,
      standing: g.wardenStanding || 0, log: Object.assign({}, log),
    };
  };
})();
