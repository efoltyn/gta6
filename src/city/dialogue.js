/* ============================================================
   city/dialogue.js — THE TWO-CHOICE LAW. Every conversation is a line
   and exactly two answers.

   OWNER (2026-07-28, voice, verbatim intent): "Dialogue right now doesn't
   show interaction options. Dialogue alone is useless and means nothing.
   It should be dialogue with TWO CHOICES — two ways to answer whatever
   their line is, and each brings you different things. There's actually a
   third and a fourth choice which are UNSAID — fourth wall, never shown:
   the third choice is to PUNCH them, the fourth is to WALK AWAY and
   ignore. But only two choices ever show. They might be offering you a
   mission — walking up to another character is THE only way to get a
   mission. Eventually that character might text you or call you — but you
   don't get a mission from a character you never met. The two-choice
   thing already exists PERFECTLY with hijacking or boarding a plane."

   REVISED 2026-10-09 (owner, on an iPad: "way too many interaction
   options... no slop interaction options"): Talk shows only on a man who has
   something to give you, which in this city is WORK. A ped of an outfit you
   ride with pitches the exact contracts.js row the orders board would show;
   accept is CBZ.mission.take(row.id). The chat, gripe, brush-off, cop nod,
   intro, toll and handout intents are deleted: every one of them was a line
   with no consequence, and a person's real verbs (Heal, Score, Buy, Recruit)
   sit on his body in city/roles.js's table, not behind a conversation.

   The card is the person's LINE over his head plus ONE verb (Take). Walking
   away is the decline, and it is remembered (intent.leave). The unshown
   answers still work: punch him mid-line and combat owns the body.

   MET CONTACTS CALL BACK. Taking work files the person into g.cityContacts
   (add-only data, no ped refs); later, rarely (>=1 game day per contact, <=2
   pings a day, >=4 real minutes apart), they text with the next job, which is
   itself accept/decline on the phone's CONTACTS card.

   Flags (defaulted HERE): DIALOGUE_TWO_CHOICE (the whole opener),
   DIALOGUE_GIVER_ROUTE (the job pitch), DIALOGUE_CONTACTS (the phone loop).
   Probe: CBZ.dialogueAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.DIALOGUE_TWO_CHOICE == null) CFG.DIALOGUE_TWO_CHOICE = true;
  if (CFG.DIALOGUE_GIVER_ROUTE == null) CFG.DIALOGUE_GIVER_ROUTE = true;
  if (CFG.DIALOGUE_CONTACTS == null) CFG.DIALOGUE_CONTACTS = true;
  const I = CBZ.interactions;
  if (!I || !I.register) return;

  function on() { return CFG.DIALOGUE_TWO_CHOICE !== false; }

  // ---- shims (every cross-module read feature-detected) --------------------
  function nowSec() { return (typeof CBZ.now === "number" ? CBZ.now : Date.now()) / 1000; }
  function day() { return CBZ.paceDay ? CBZ.paceDay() : 0; }
  function money(n) { n = Math.round(n || 0); return n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n; }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function cap(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function sayP(p, text, color, secs) { if (CBZ.citySay && p) CBZ.citySay(p, text, color || "#dfe7ff", secs == null ? 2.4 : secs); }
  function note(t, s, from) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s || 2, from ? { from: from, app: "messages" } : undefined); }
  function relShift(p, kind, amt) { if (CBZ.cityRelShift) try { CBZ.cityRelShift(p, kind, amt); } catch (e) {} }
  function meet(p) { if (CBZ.cityMeet) try { CBZ.cityMeet(p); } catch (e) {} }
  function spend(n) { return !!(CBZ.city && CBZ.city.spend && CBZ.city.spend(n)); }
  function addRespect(n) { if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(n); }
  function playerActor() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player; }
  function nm(p) { return (p && p.name) || "them"; }
  // the peds.js roleHash idiom — stable per PERSON (their spawn cell), never
  // per frame. Salted with the day for the caster so tomorrow is a new deal.
  function pedHash(p, salt) {
    if (p._roleSeedX == null) { p._roleSeedX = p.pos ? p.pos.x : 0; p._roleSeedZ = p.pos ? p.pos.z : 0; }
    return CBZ.hash01 ? CBZ.hash01(p._roleSeedX, p._roleSeedZ, salt) : 0.5;
  }
  function mem(p) { return p._dlgMem || (p._dlgMem = { declines: 0, warm: 0, helped: 0, punched: 0, friend: false, lastDay: -99 }); }

  // ---- ratchet counters -----------------------------------------------------
  let opened = 0, twoShown = 0, routed = 0, pinged = 0;

  /* ==========================================================================
     THE BEAT POSES — the artistry half. Registered into the ONE pose registry
     (entities/poses.js CBZ.charPoses) so animChar runs them under its own
     precedence: hands-up / aiming / cuffed / a walk all OUTRANK a pose, which
     is exactly the yield rule this file needs — the instant combat or scare
     claims the body, the gesture is simply not drawn, no cleanup required.
     Contract honoured: arms only (upper-arm rotation.x/z + elbow), damped,
     zero allocation. The nod/wave/shrug are HELD ~1s beats, not loops.
     ========================================================================== */
  function d(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }
  function elbow(J, x, dt, rate) { if (J) J.rotation.x = d(J.rotation.x, Math.min(0, x), rate || 14, dt); }
  (function registerPoses() {
    const PS = CBZ.charPoses;
    if (!PS) return;
    // explaining — right forearm raised, palm turning with a small living sway
    if (!PS.dlgTalk) PS.dlgTalk = function (ch, dt) {
      const J = ch.low || {}, r = 12, t = nowSec();
      const sway = Math.sin(t * 1.7) * 0.07 + Math.sin(t * 3.1) * 0.03;
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      if (ra) { ra.rotation.x = d(ra.rotation.x, -0.62 + sway, r, dt); ra.rotation.z = d(ra.rotation.z, -0.10, r, dt); }
      if (la) { la.rotation.x = d(la.rotation.x, -0.14, r, dt); la.rotation.z = d(la.rotation.z, 0.06, r, dt); }
      elbow(J.ra, -1.05 + sway * 0.5, dt, r); elbow(J.la, -0.25, dt, r);
    };
    // the seal — a hand offered forward at waist height (the accept handshake)
    if (!PS.dlgSeal) PS.dlgSeal = function (ch, dt) {
      const J = ch.low || {}, r = 15;
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      if (ra) { ra.rotation.x = d(ra.rotation.x, -0.92, r, dt); ra.rotation.z = d(ra.rotation.z, -0.05, r, dt); }
      if (la) { la.rotation.x = d(la.rotation.x, -0.10, r, dt); la.rotation.z = d(la.rotation.z, 0.05, r, dt); }
      elbow(J.ra, -0.30, dt, r); elbow(J.la, -0.20, dt, r);
    };
    // the brush-off — raised arm flicking sideways (get outta here)
    if (!PS.dlgWave) PS.dlgWave = function (ch, dt) {
      const J = ch.low || {}, r = 16, t = nowSec();
      const flick = Math.sin(t * 9.0) * 0.22;
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      if (ra) { ra.rotation.x = d(ra.rotation.x, -1.15, r, dt); ra.rotation.z = d(ra.rotation.z, -0.30 + flick, r, dt); }
      if (la) { la.rotation.x = d(la.rotation.x, -0.08, r, dt); la.rotation.z = d(la.rotation.z, 0.04, r, dt); }
      elbow(J.ra, -0.55, dt, r); elbow(J.la, -0.18, dt, r);
    };
    // the shrug — both arms flare, elbows deep ("…okay then"), played at the
    // player's back when they walk away mid-line
    if (!PS.dlgShrug) PS.dlgShrug = function (ch, dt) {
      const J = ch.low || {}, r = 13;
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      if (ra) { ra.rotation.x = d(ra.rotation.x, -0.35, r, dt); ra.rotation.z = d(ra.rotation.z, -0.55, r, dt); }
      if (la) { la.rotation.x = d(la.rotation.x, -0.35, r, dt); la.rotation.z = d(la.rotation.z, 0.55, r, dt); }
      elbow(J.ra, -1.35, dt, r); elbow(J.la, -1.35, dt, r);
    };
  })();

  // A body is only POSED when this file may own it. A seated/attached body
  // (npclife syncAttached, propuse arcs) keeps its transform untouched — the
  // card still shows, the LINE still plays, only the gesture stands down.
  function bodyFree(p) {
    return !(p._npcAttached || p._seatHold || (p.char && p.char.sitting) || p.inCar || p.staffPost);
  }
  function setPose(p, name) {
    if (!p || !p.char || !bodyFree(p)) return;
    if (dlg && dlg.prevPose === undefined) dlg.prevPose = p.char.pose || null;
    p.char.pose = name;
  }
  function unPose(p, prev) {
    if (!p || !p.char) return;
    if (/^dlg/.test(p.char.pose || "")) p.char.pose = prev !== undefined ? prev : null;
  }
  // detached micro-beats (the shrug behind a walker, the wave after a card
  // already closed) — tiny list, restores the prior pose when done
  const tails = [];
  function tailBeat(p, pose, dur) {
    if (!p || !p.char || p.dead || !bodyFree(p)) return;
    tails.push({ p: p, t: 0, dur: dur || 0.8, prev: /^dlg/.test(p.char.pose || "") ? null : (p.char.pose || null) });
    p.char.pose = pose;
  }

  /* ==========================================================================
     CONTACTS — met people who can call back. Plain add-only data on the game
     state (no ped refs serialized; a live ped is re-bound by identity/name at
     read time), so any save layer that carries `g` carries them for free.
     ========================================================================== */
  function contacts() { return g.cityContacts || (g.cityContacts = []); }
  // live ped refs live OUTSIDE the records (a record is pure JSON-safe data,
  // so the day worldstate.js whitelists g.cityContacts nothing explodes)
  const liveContact = Object.create(null);
  function contactId(p) {
    if (p._identityId != null) return "id:" + p._identityId;
    if (p._roleSeedX == null) pedHash(p, 1);
    return "px:" + Math.round(p._roleSeedX * 4) + ":" + Math.round(p._roleSeedZ * 4);
  }
  function contactAdd(p, why, org) {
    const id = contactId(p), list = contacts();
    let rec = null;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) { rec = list[i]; break; }
    if (!rec) {
      rec = { id: id, name: nm(p), why: why, org: org || null, day: day(), x: p.pos ? Math.round(p.pos.x) : 0, z: p.pos ? Math.round(p.pos.z) : 0, lastPingDay: -99, pings: 0, declines: 0, friend: false, pending: null };
      list.push(rec);
    }
    if (why === "friend") rec.friend = true;
    if (org) rec.org = org;
    liveContact[id] = p;
    return rec;
  }
  function contactPed(rec) {
    const p = liveContact[rec.id];
    if (p && !p.dead && p.pos) return p;
    return null;
  }

  /* ==========================================================================
     THE GIVER BINDING — missions come from people. A ped can PITCH a
     contracts.js row when (a) the player rides with an outfit, (b) this ped
     visibly belongs to it (a crewmate of your set; a soldier of the
     garrison), and (c) the board has a takeable row (r.ok — rank + live
     world target, the same gate the desk enforces). The Bureau and the Cause
     deliberately have NO faces here: an intelligence service pitches at its
     desk and a cell at its drop, per contracts.js's own design. Cached 3s per
     ped — rowsFor() runs live world binders and canShow polls at ~12 Hz.
     ========================================================================== */
  function giverRow(p) {
    if (CFG.DIALOGUE_GIVER_ROUTE === false) return null;
    const c = p._dlgGiver;
    if (c && nowSec() - c.t < 3) return c.v;
    const v = computeGiverRow(p);
    p._dlgGiver = { t: nowSec(), v: v };
    return v;
  }
  function computeGiverRow(p) {
    const F = CBZ.factions;
    if (!F || !F.isMember || !CBZ.cityOrders || !CBZ.cityOrders.rows) return null;
    if (CBZ.mission && CBZ.mission.busy && CBZ.mission.busy()) return null;
    let org = null;
    const gid = F.orgIn ? F.orgIn("gang") : null;
    if (gid && p.gang === gid && F.isMember("gang")) org = "gang";
    else if ((p.milRank != null || /soldier|military|garrison/i.test(String(p.job || ""))) && F.isMember("army")) org = "army";
    if (!org) return null;
    let rows = [];
    try { rows = CBZ.cityOrders.rows(org) || []; } catch (e) { rows = []; }
    const ok = [];
    for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i].ok) ok.push(rows[i]);
    if (!ok.length) return null;
    // deterministic per ped+day; leans toward the most senior job they can hand you
    ok.sort(function (a, b) { return b.tier - a.tier; });
    const idx = Math.min(ok.length - 1, (pedHash(p, 0xD1A + day() * 17) * Math.min(2, ok.length)) | 0);
    return { org: org, row: ok[idx] };
  }

  /* ==========================================================================
     THE CASTER. Talk exists only where the person has something real to say
     (owner 2026-10-09: "no slop interaction options"). That is one thing in
     this city: WORK. A ped of an outfit you ride with pitches the contract the
     orders board would show. Everybody else's verbs are on their body (a
     medic's Heal, a dealer's Score, a keeper's Buy), not behind a chat: the
     small talk, gripes, brush-offs, cop nods, intros and street tolls that
     used to fill this caster were lines with no consequence and are gone.
     ========================================================================== */
  function castIntent(p) {
    if (!p || p.kind === "cop") return null;
    const gv = giverRow(p);
    return gv ? intentJob(p, mem(p), gv) : null;
  }

  /* -------------------------------- the intent ----------------------------- */
  // { id, line, a, leave }: a is the one verb on the card, leave is what
  // walking away means to them (a decline remembered).

  function intentJob(p, m, gv) {
    const r = gv.row;
    const pay = r.pay > 0 ? money(r.pay) : "nothing but a name";
    const line = m.declines > 0
      ? pick(["Still open. Pays " + pay + ".", "Offer's still there. " + pay + "."])
      : gv.org === "gang"
        ? pick(["Set's got work. Pays " + pay + ".", "Need somebody solid. " + pay + "."])
        : pick(["Got something for you. " + pay + ".", "We're short a man. Pays " + pay + "."]);
    return {
      id: "job", line: line,
      a: {
        label: "Take",
        closer: pick(["Knew you would.", "Good. Don't be late.", "That's what I like."]),
        deferred: true,                    // the handshake: take at the beat's end
        run: function () {
          if (CBZ.cityOrders && CBZ.cityOrders.refresh) try { CBZ.cityOrders.refresh(); } catch (e) {}
          const started = (CBZ.mission && CBZ.mission.take) ? CBZ.mission.take(r.id) : null;
          if (!started || started.inert) { sayP(p, "Hold up. It fell through.", "#cfd6e6"); return false; }
          routed++;
          contactAdd(p, "work", gv.org);
          return true;
        },
      },
      leave: function () { m.declines++; m.lastDay = day(); relShift(p, "snubbed", 0.4); },
    };
  }

  /* ==========================================================================
     THE LIVE DIALOGUE — one at a time, phased like a door arc:
       open  → line up, two answers shown, ped faces you and gestures
       beat  → the chosen answer's body language plays (seal / wave), a
               deferred outcome (the job handshake) lands at its END and a
               falsy result REVERTS (nothing granted — aircraft_doors' rule)
     The unshown exits: violence (hp drop / rage / scare claim → instant,
     silent close, combat owns them), walk-away (out of card + range → shrug
     at your back), ignore (stand mute past holdT → they break it off).
     ========================================================================== */
  let dlg = null;

  function openDialogue(p) {
    if (!on() || !p || p.dead) return false;
    if (dlg) endDialogue("replaced", true);
    const it = castIntent(p);
    if (!it) return false;
    dlg = {
      p: p, intent: it.id, line: it.line, a: it.a, b: it.b || null, leave: it.leave || null,
      t: 0, lostT: 0, holdT: 12 + Math.random() * 5,
      phase: "open", beat: null,
      openHp: p.hp != null ? p.hp : null,
      prevPose: undefined, aPool: null,
    };
    opened++; twoShown++;
    meet(p);
    sayP(p, it.line, "#dfe7ff", Math.min(6, 2.2 + it.line.length * 0.03));
    p._faceT = 0.6;
    setPose(p, "dlgTalk");
    if (I.refresh) I.refresh();
    return true;
  }

  function endDialogue(why, silent) {
    if (!dlg) return;
    const p = dlg.p, prev = dlg.prevPose;
    const m = mem(p);
    const d0 = dlg;
    dlg = null;
    unPose(p, prev);
    p._dlgCD = nowSec() + (why === "answered" ? 20 : 32) + Math.random() * 16;
    // walking off (or standing there mute) IS the decline: what it means to
    // them lands here, never as a "no" button
    if ((why === "walkaway" || why === "ignored") && d0 && d0.leave) { try { d0.leave(); } catch (e) {} }
    if (!silent) {
      if (why === "walkaway") { tailBeat(p, "dlgShrug", 0.8 + Math.random() * 0.3); }
      else if (why === "ignored") {
        sayP(p, pick(["Forget it, then.", "Right. Good talk.", "Hello? Wow."]), "#cfd6e6");
        tailBeat(p, "dlgShrug", 0.9);
        p._dlgCD = nowSec() + 60;
      } else if (why === "violence") {
        m.punched++;
      }
    }
    if (I.refresh) I.refresh();
  }

  // the chosen answer — wired through interactions.fire() via the wrapper opts
  function choose(which) {
    if (!dlg || dlg.phase !== "open") return;
    const c = which === "a" ? dlg.a : dlg.b;
    if (!c) return;
    dlg.phase = "beat";
    dlg.beat = {
      kind: which === "a" ? "dlgSeal" : "dlgWave",
      t: 0, dur: 0.7 + Math.random() * 0.4,
      after: null,
    };
    setPose(dlg.p, dlg.beat.kind);
    if (c.closer) sayP(dlg.p, c.closer, which === "a" ? "#cdeccd" : "#ffd1c4");
    if (c.mem) { try { c.mem(); } catch (e) {} }
    if (c.deferred && c.run) {
      // the handshake: the outcome lands when the beat completes; an interrupt
      // (death, walk-off, combat) before then means NOTHING was granted.
      dlg.beat.after = c.run;
    } else {
      runChoice(c);
    }
    if (I.refresh) I.refresh();
  }
  function runChoice(c) {
    if (c.poolId && dlg && dlg.aPool && dlg.aPool.id === c.poolId) {
      // fire the EXISTING option verbatim — its own economy, its own words
      try { dlg.aPool.onSelect(dlg.p, I.ctx ? I.ctx() : null); } catch (e) {}
      return;
    }
    if (c.poolId && c.fallback && c.fallback.run) { try { c.fallback.run(); } catch (e) {} return; }
    if (c.run) { try { c.run(); } catch (e) {} }
  }

  /* ---- the card rows: the verb-card provider ------------------------------
     interactions.js hands every resolved candidate through registered
     providers (the generalised dualRideRows seam). While a dialogue is open
     on this ped we rebuild the card as LINE + TWO ANSWERS. Choice A reuses a
     pool option's own label/onSelect when the intent names one. */
  function choiceLabel(c, t, ctx) {
    if (c.poolId && dlg && dlg.aPool) {
      let l = dlg.aPool.label;
      if (typeof l === "function") { try { l = l(t, ctx); } catch (e) { l = null; } }
      if (l) return String(l).replace(/[?.!]+$/, "");
    }
    if (c.poolId && c.fallback) return c.fallback.label;
    return c.label || "Chat";
  }
  function provideRows(pk, rows, ctx) {
    if (!on() || !dlg) return null;
    if (pk.gunpoint || pk.t !== dlg.p) return null;
    if (dlg.phase !== "open" && dlg.phase !== "beat") return null;
    // once an answer is chosen the card FREEZES for the beat — a pool option
    // consumed by the choice must not re-label the row it just fired from
    if (dlg.phase === "beat" && dlg.lastRows) return dlg.lastRows;
    const pass = rows && rows._pass;
    // bind the pool option the intent asked for (label + onSelect reused verbatim)
    dlg.aPool = null;
    if (dlg.a.poolId && pass) {
      for (let i = 0; i < pass.length; i++) if (pass[i].id === dlg.a.poolId) { dlg.aPool = pass[i]; break; }
    }
    if (!dlg.wrapA) {
      dlg.wrapA = { id: "dlg-a:" + (dlg.a.poolId || dlg.intent), onSelect: function () { choose("a"); } };
      dlg.wrapB = { id: "dlg-b:" + dlg.intent, onSelect: function () { choose("b"); } };
    }
    const la = choiceLabel(dlg.a, pk.t, ctx);
    const out = [
      { key: "e", hold: false, label: la, bad: !!(dlg.a.bad || (dlg.aPool && dlg.aPool.bad)), opt: dlg.wrapA, decision: "yes", proposal: la, standing: null },
    ];
    // a second verb only when there is a second real thing to do
    if (dlg.b && dlg.b.label) out.push({ key: "i", hold: false, label: dlg.b.label, bad: !!dlg.b.bad, opt: dlg.wrapB, decision: "yes", proposal: dlg.b.label, standing: null });
    out.dualRide = true;          // verb-card render + the E-router yield
    // The spoken line lives over the speaker's head (citySay at openDialogue);
    // the card carries only the two answers.
    dlg.lastRows = out;
    return out;
  }
  if (I.registerVerbCard) I.registerVerbCard(provideRows);

  /* ---- the tick: scene upkeep + the two unshown answers ------------------- */
  CBZ.onUpdate && CBZ.onUpdate(39.7, function (dt) {
    // detached micro-beats first (they outlive the dialogue)
    for (let i = tails.length - 1; i >= 0; i--) {
      const tb = tails[i];
      tb.t += dt;
      const gone = !tb.p || tb.p.dead || tb.p.rage || tb.p.surrender;
      if (tb.t >= tb.dur || gone) {
        if (tb.p && tb.p.char && /^dlg/.test(tb.p.char.pose || "")) tb.p.char.pose = tb.prev;
        tails.splice(i, 1);
      }
    }
    if (!dlg) return;
    const p = dlg.p;
    dlg.t += dt;

    // ---- hard yields: another brain took the body / the world moved on ----
    if (g.mode !== "city" || !CBZ.player || CBZ.player.dead || CBZ.player.driving) { endDialogue("interrupt", true); return; }
    if (!p || p.dead || p.controlled || p._npcAttached) { endDialogue("interrupt", true); return; }
    if (CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission()) { endDialogue("interrupt", true); return; }
    // THE THIRD CHOICE (unsaid): violence. A punch, a shot, a drawn-gun scare —
    // the moment combat/sizeup/scare claims them the card dies with no beat.
    const hurt = dlg.openHp != null && p.hp != null && p.hp < dlg.openHp - 0.5;
    if (hurt || p.rage || p.surrender || p._covered ||
        p.state === "flee" || p.state === "fight" || p.state === "confront" || p.state === "surrender") {
      endDialogue("violence", false);
      return;
    }

    // ---- the scene: hold the face + the gesture while the line is up ----
    if (dlg.phase === "open" || dlg.phase === "beat") p._faceT = Math.max(p._faceT || 0, 0.5);

    if (dlg.phase === "beat") {
      dlg.beat.t += dt;
      if (dlg.beat.t >= dlg.beat.dur) {
        const after = dlg.beat.after;
        endDialogue("answered", true);
        if (after) { try { after(); } catch (e) {} }
      }
      return;
    }

    // ---- THE FOURTH CHOICE (unsaid): walk away / ignore ----
    const d2 = Math.hypot(CBZ.player.pos.x - p.pos.x, CBZ.player.pos.z - p.pos.z);
    const cur = I.current && I.current();
    const onCard = cur && cur.target === p;
    if (d2 > (I.REACH || 5.2) + 1.6) { endDialogue("walkaway", false); return; }
    if (!onCard) { dlg.lostT += dt; if (dlg.lostT > 0.8) { endDialogue("walkaway", false); return; } }
    else dlg.lostT = 0;
    if (dlg.t > dlg.holdT) { endDialogue("ignored", false); return; }
  });

  // the ONE death/arrest/mode-exit sweeper — never a local one
  if (CBZ.mission && CBZ.mission.onInterrupt) CBZ.mission.onInterrupt(function () { if (dlg) endDialogue("interrupt", true); });

  /* ==========================================================================
     THE OPENER — Talk shows only on a man who carries work (castIntent).
     Declared principals and their guards are EXCLUDED here: power.js owns
     that walk-up.
     ========================================================================== */
  function inMyGang(p) { return !!(CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p)); }
  function canOpen(p, ctx) {
    if (!on() || !p || p.dead || p.vendor) return false;
    if (dlg) return dlg.p === p;              // keeps the candidate resolvable while open
    if ((p._dlgCD || 0) > nowSec()) return false;
    if (p.child) return false;
    if (ctx && (ctx.gunDrawn || ctx.driving)) return false;
    if (p.rage || p.surrender || p.controlled || p.inCar || p._npcAttached) return false;
    if (p.state === "flee" || p.state === "fight" || p.state === "confront" ||
        p.state === "stalk" || p.state === "charge" || p._bumHunt) return false;
    if (p.companion || p.recruited) return false;
    if (inMyGang(p)) return false;            // your soldiers keep their orders verbs
    if (CBZ.powerOrgOf && CBZ.powerOrgOf(p)) return false;   // principals: power.js owns the walk-up
    if (CBZ.powerGuardOf && CBZ.powerGuardOf(p)) return false;
    return !!giverRow(p);                     // Talk only when he carries WORK
  }
  // NOT A VERB: `speak` (city/interactions.js approach) — he pitches the work
  // the moment you look at him or tap him; Take is the verb, walking off the no
  I.register("ped:civ", {
    id: "dlg-talk", speak: true, speakCD: 30, prio: 80, forceYes: true,
    canShow: canOpen,
    label: "Talk",
    onSelect: function (p) { openDialogue(p); },
  });

  /* ==========================================================================
     MET CONTACTS CALL BACK — the phone loop. Rare and personal by
     construction: per contact ≥1 full game day since the meeting and since
     their last ping, at most 2 pings per day citywide, ≥4 real minutes
     between any two, and a per-day coin off the world hash so the same save
     rings the same way. The message is diegetic prose (phone.js's own filter
     eats control-copy); the ANSWER lives on the phone's CONTACTS card — two
     buttons, because everything in this game is two choices.
     ========================================================================== */
  let lastPingReal = 0, pingsToday = 0, pingDay = -1;
  function phonePush(from, text) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "messages", from: from, text: text, priority: 1 }); return; } catch (e) {} }
    note(text, 3, from);
  }
  function composePending(rec) {
    // WORK contact: the next takeable row from THEIR outfit (re-gated live)
    if (rec.org && CBZ.cityOrders && CBZ.cityOrders.rows && !(CBZ.mission && CBZ.mission.busy && CBZ.mission.busy())) {
      let rows = [];
      try { rows = CBZ.cityOrders.rows(rec.org) || []; } catch (e) { rows = []; }
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i] && rows[i].ok) return { kind: "job", id: rows[i].id, title: rows[i].title, pay: rows[i].pay };
      }
    }
    return null;
  }
  CBZ.onUpdate && CBZ.onUpdate(50.7, function () {
    if (!on() || CFG.DIALOGUE_CONTACTS === false) return;
    if (g.mode !== "city") return;
    const dNow = day();
    if (dNow !== pingDay) { pingDay = dNow; pingsToday = 0; }
    if (pingsToday >= 2) return;
    if (nowSec() - lastPingReal < 240) return;
    const list = contacts();
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (rec.pending) continue;
      if (dNow - rec.day < 1 || dNow - rec.lastPingDay < 1) continue;
      if (!CBZ.hash01 || CBZ.hash01(rec.x, rec.z, 0xCA11 + dNow) > 0.5) continue;
      const pend = composePending(rec);
      if (!pend) continue;
      rec.pending = pend;
      rec.lastPingDay = dNow; rec.pings++;
      lastPingReal = nowSec(); pingsToday++; pinged++;
      const call = CBZ.hash01(rec.x, rec.z, 0xCA12 + dNow) < 0.3;
      const text = (call ? "Tried to call you. " : "") + "Got another one. Pays " + money(pend.pay) + ". You in?";
      phonePush(rec.name.toUpperCase(), text);
      return;                                 // one ping per pass, ever
    }
  });
  // the phone CONTACTS card answers here — two buttons, real outcomes
  function phoneAnswer(id, yes) {
    const list = contacts();
    let rec = null;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) { rec = list[i]; break; }
    if (!rec || !rec.pending) return false;
    const pend = rec.pending;
    rec.pending = null;
    if (!yes) {
      rec.declines++;
      const p = contactPed(rec);
      if (p) relShift(p, "snubbed", 0.3);
      return true;
    }
    if (pend.kind === "job") {
      if (CBZ.mission && CBZ.mission.busy && CBZ.mission.busy()) { note("Finish what you got first.", 2.2, rec.name.toUpperCase()); return false; }
      if (CBZ.cityOrders && CBZ.cityOrders.refresh) try { CBZ.cityOrders.refresh(); } catch (e) {}
      const started = (CBZ.mission && CBZ.mission.take) ? CBZ.mission.take(pend.id) : null;
      if (!started || started.inert) { note("It fell through. I'll call you.", 2.2, rec.name.toUpperCase()); return false; }
      routed++;
      return true;
    }
    return false;
  }

  /* ---- exports + ratchet --------------------------------------------------- */
  CBZ.cityDialogue = {
    open: openDialogue,
    active: function () { return dlg ? dlg.p : null; },
    // a held gesture for anybody (the point, the bow, the shrug): restores the
    // prior pose when done; refuses a body something else is holding
    beat: function (p, pose, dur) { tailBeat(p, pose, dur); },
    intentOf: function (p) { const it = p ? castIntent(p) : null; return it ? it.id : null; },   // probe surface
    contacts: contacts,
    phoneAnswer: phoneAnswer,
  };
  CBZ.cityDialogueOpen = openDialogue;

  // legacyTalkPaths is a LIVE census, not a guess: these are the registered
  // one-line talk verbs this grammar supersedes (they remain the flag-off
  // degrade path). It may only ever go DOWN — a path leaves the list by being
  // deleted or folded into a two-choice intent, never by editing this array.
  const LEGACY_TALK = ["ped-talk", "ped-talk-gang", "cop-directions", "vendor-talk", "street-offer", "dlg-talk-cop"];
  CBZ.dialogueAudit = function () {
    let legacy = 0;
    if (I.hasOption) { for (let i = 0; i < LEGACY_TALK.length; i++) if (I.hasOption(LEGACY_TALK[i])) legacy++; }
    else legacy = LEGACY_TALK.length;
    return {
      talkers: opened, twoChoice: twoShown, offersRouted: routed,
      contacts: contacts().length,
      phonePings: pinged, legacyTalkPaths: legacy,
      open: !!dlg, intent: dlg ? dlg.intent : null,
    };
  };
})();
