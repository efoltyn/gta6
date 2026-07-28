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

   So this file is the airliner BOARD/HIJACK card grammar, generalised to
   PEOPLE. Walk up, press Talk, and the card becomes a SCENE: the person
   turns to face you (peds.js's own _faceT stop-and-look — no new brain),
   speaks a LINE through the ONE speech-bubble pool (CBZ.citySay), holds a
   talk gesture through the ONE pose registry (CBZ.charPoses), and offers
   exactly TWO answers. Never a third button. The unshown answers WORK:
   punch them mid-card and the dialogue dies instantly with combat/sizeup
   owning the body; walk out of reach (or just stand there saying nothing)
   and they shrug it off behind you and the card dismisses with no residue.

   WHAT AN ANSWER IS — never a stat fiction. Every outcome runs an
   EXISTING primitive, most of them literally the existing option records:
     · the airliner trick, reapplied: the card's choice A is, wherever
       possible, an option ALREADY IN THE GATED POOL (rows._pass) — the
       medic's priced patch-up (roleverbs "rv-role"), the dealer's Score
       ("rv-score"), street_talk's tribute/tax/handout offer
       ("street-offer") — fired verbatim through its own onSelect, exactly
       how dualRideRows reuses airliner_board / milveh-take. This file
       re-skins the HANDSHAKE; it does not re-author a single trade.
     · MISSIONS COME FROM PEOPLE: a ped who shares an outfit the player
       rides with (a crewmate of your set, a soldier of your garrison)
       PITCHES the exact contracts.js row the orders board would show —
       accept is CBZ.mission.take(row.id), the very contract it already
       was. The generator still picks the verb, the world still supplies
       the specifics; only the handshake moved from a desk to a face.
     · money moves through CBZ.city.spend/addCash, feelings through
       CBZ.cityRelShift, respect through CBZ.city.addRespect, fear through
       CBZ.cityScare/citySizeUp, friendship through the family builder's
       CBZ.kinshipBefriend (null-guarded; ped.friendOfPlayer fallback).

   MET CONTACTS CALL BACK. Accepting work (or becoming a friend) files the
   person into g.cityContacts — add-only data, no ped refs — and later,
   rarely (hard caps: ≥1 game day per contact, ≤2 pings a day, ≥4 real
   minutes between any two), they text or call through the phone with a
   follow-up offer that is itself accept/decline (phone.js CONTACTS card).
   Strangers never ring: no meeting, no number.

   DETERMINISM: WHO offers WHAT is a position-hash of the ped + the day
   (the peds.js roleHash idiom) — same person, same day, same intent on
   every client. Math.random touches only runtime feel: which line in a
   pool, beat durations, ping jitter.

   Flags (all defaulted HERE, one-line reverts):
     DIALOGUE_TWO_CHOICE  — the whole system (off → the opener never
                            registers a passing verb; street_talk's YES
                            card and every legacy talk path stand as-is).
     DIALOGUE_GIVER_ROUTE — the job-offer intent (off → desks/boards only).
     DIALOGUE_CONTACTS    — the phone follow-up loop.

   Ratchet: CBZ.dialogueAudit() → { talkers, twoChoice, offersRouted,
   contacts, legacyTalkPaths, phonePings, friends }. legacyTalkPaths is a
   LIVE probe (interactions.hasOption) of the one-line talk verbs still
   registered — it may only ever go DOWN as those files fold into this
   grammar. NOT YET PINNED — whoever runs the gate first writes the number.
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
  function day() { return CBZ.dayCount ? CBZ.dayCount() : 0; }
  function money(n) { n = Math.round(n || 0); return n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n; }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
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
  let opened = 0, twoShown = 0, routed = 0, pinged = 0, befriended = 0;

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
     THE CASTER — a deterministic intent per person per day, read off what the
     world already knows about them. Priority is worldliness: a job in hand
     beats a trade, a trade beats small talk. Every branch that needs a world
     target REFUSES when the world cannot supply one (the contracts.js law).
     ========================================================================== */
  function jobKey(p) { return (CBZ.cityPedJob ? CBZ.cityPedJob(p) : "") || ""; }
  function tradeRow(p) {
    const T = CBZ.cityRoleVerbs;
    const j = jobKey(p);
    if (!T || !j || !T[j]) return null;
    try { return T[j].can(p, I.ctx ? I.ctx() : null) ? T[j] : null; } catch (e) { return null; }
  }
  function streetKind(p) {
    if (!CBZ.streetTalkOffer) return null;
    let o = null;
    try { o = CBZ.streetTalkOffer(p); } catch (e) { o = null; }
    if (!o) return null;
    return (o.kind === "tribute" || o.kind === "tax" || o.kind === "handout" || o.kind === "charity") ? o : null;
  }
  function introTarget() {
    // a REAL person/place the sim already runs — never spawned for the line
    const gangs = CBZ.cityGangs || [];
    for (let i = 0; i < gangs.length; i++) {
      const gg = gangs[i];
      if (gg && !gg.absorbed && gg.boss && !gg.boss.dead && !gg.isPlayer)
        return { name: gg.bossName || gg.boss.name || "the boss", live: gg.boss, what: "runs the " + (gg.name || "set") };
    }
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const q = peds[i];
      if (q && !q.dead && q.vipLvl) return { name: q.name || "somebody", live: q, what: "is real money" };
    }
    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (l && l.building && l.building.shop && l.building.name)
        return { name: l.building.name, live: null, at: { x: l.cx, z: l.cz }, what: "moves everything" };
    }
    return null;
  }

  function castIntent(p) {
    const m = mem(p);
    if (p.kind === "cop") return intentCop(p, m);
    const gv = giverRow(p);
    if (gv) return intentJob(p, m, gv);
    const tr = tradeRow(p);
    if (tr) return intentTrade(p, m, tr);
    if (p.archetype === "dealer") return intentScore(p, m);
    const so = streetKind(p);
    if (so) return intentStreet(p, m, so);
    if (p.vagrant) return intentFavor(p, m);
    const h = pedHash(p, 0xD1A0 + day() * 13);
    if ((p.aggr || 0) >= 0.78) return intentBrushoff(p, m);
    if (h < 0.18 && !(CBZ.mission && CBZ.mission.busy && CBZ.mission.busy())) {
      const t = introTarget();
      if (t) return intentIntro(p, m, t);
    }
    if (h < 0.55 && jobKey(p)) return intentGripe(p, m);
    return intentSocial(p, m);
  }

  /* -------------------------------- the intents ---------------------------- */
  // Each returns { id, line, a, b }. A choice: { label, closer?, bad?, mem?,
  // poolId? (fire the existing option from rows._pass verbatim), run? (my own
  // outcome), deferred? (run at the END of the seal beat — the handshake; a
  // falsy result reverts, aircraft_doors' onFail rule), beat? }.

  function intentJob(p, m, gv) {
    const r = gv.row;
    const pay = r.pay > 0 ? money(r.pay) : "no pay, all name";
    const line = m.declines > 0
      ? "“Still open: " + r.title + ". " + pay + ". Door won't stay open forever.”"
      : gv.org === "gang"
        ? pick(["“Set's got work. " + r.title + " — " + pay + ". You in or out?”",
                "“Been waiting on somebody solid. " + r.title + ". " + pay + " when it's done.”"])
        : pick(["“Ops flagged you. " + r.title + " — " + pay + ". Taking it?”",
                "“Garrison needs a body for " + r.title.toLowerCase() + ". " + pay + ". You want it?”"]);
    return {
      id: "job", line: line,
      a: {
        label: pick(["I'm in", "Deal me in", "Say less"]),
        closer: "“Knew you would.”",
        deferred: true,                    // the handshake: take at the beat's end
        run: function () {
          if (CBZ.cityOrders && CBZ.cityOrders.refresh) try { CBZ.cityOrders.refresh(); } catch (e) {}
          const started = (CBZ.mission && CBZ.mission.take) ? CBZ.mission.take(r.id) : null;
          if (!started || started.inert) { sayP(p, "“Hold up — it fell through. Another time.”", "#cfd6e6"); return false; }
          routed++;
          contactAdd(p, "work", gv.org);
          return true;
        },
      },
      b: {
        label: pick(["Not my thing", "Pass", "Find someone else"]),
        closer: "“Your loss.”",
        mem: function () { m.declines++; m.lastDay = day(); relShift(p, "snubbed", 0.4); },
      },
    };
  }

  function intentTrade(p, m, row) {
    const j = jobKey(p);
    const LINES = {
      doctor: "“You look rough. Sit down, let me look at that.”",
      nurse: "“That needs cleaning before it needs anything else.”",
      paramedic: "“Hey — you bleeding? Sit down a second.”",
      bartender: "“Long day? I pour for long days.”",
      "line cook": "“Kitchen's hot and the plate's honest.”",
      "personal trainer": "“You move like you sit all day. I can fix that.”",
      barber: "“That lineup's a week past due, friend.”",
      farmer: "“Fresh off the field this morning. Interested?”",
      fisherman: "“Caught this morning. You won't find fresher.”",
      courier: "“Got runs stacked up and one pair of legs. You want one?”",
      chauffeur: "“Car's warm. Beats walking.”",
    };
    const line = LINES[j] || "“You need something? This is what I do all day.”";
    return {
      id: "trade", line: line,
      a: { poolId: "rv-role", closer: "“Smart.”", fallback: { label: "Alright", run: function () { meet(p); relShift(p, "greeted", 0.4); } } },
      b: {
        label: pick(["Just passing through", "Maybe later"]),
        closer: "“Suit yourself.”",
        mem: function () { relShift(p, "greeted", 0.15); },
      },
    };
  }

  function intentScore(p, m) {
    return {
      id: "score",
      line: pick(["“You looking? I got you.”", "“Walk with me. You need something, I'm holding.”"]),
      a: { poolId: "rv-score", bad: true, fallback: { label: "Show me", run: function () { sayP(p, "“Not here. Come back.”", "#cfd6e6"); } } },
      b: {
        label: pick(["I'm good", "Not tonight"]),
        closer: "“Then keep it moving.”",
        mem: function () { relShift(p, "snubbed", 0.2); },
      },
    };
  }

  function intentStreet(p, m, o) {
    const LINE = {
      tribute: "“Whoa — easy. Take it. We're square, right?”",
      tax: "“Toll's a toll. Everybody pays on this block.”",
      handout: "“You look like the floor's been winning. Here.”",
      charity: "“Spare something? Anything helps out here.”",
    };
    const b = (o.kind === "tax")
      ? {
          label: "I'm not paying", bad: true,
          closer: "“Remember that.”",
          mem: function () {
            relShift(p, "snubbed", 1);
            // refusing the toll can go physical — if THEY dare (sizeup, not a coin flip)
            const pa = playerActor();
            if (CBZ.citySizeUp && pa && CBZ.citySizeUp(p, pa) && Math.random() < 0.35) {
              p.rage = pa; p.state = "fight"; p.fear = 0;
              sayP(p, "“Wrong answer.”", "#ff8a7a");
            }
          },
        }
      : (o.kind === "tribute")
        ? { label: "Keep your money", closer: "“…thanks? Okay.”", mem: function () { relShift(p, "greeted", 0.3); } }
        : (o.kind === "handout")
          ? { label: "Keep it — I'm good", closer: "“Respect.”", mem: function () { relShift(p, "greeted", 0.5); } }
          : { label: "Not today", closer: "“…yeah. Every day's not today.”", mem: function () { const mm = mem(p); mm.declines++; relShift(p, "snubbed", 0.15); } };
    return {
      id: "street", line: LINE[o.kind] || "“Got a second?”",
      a: { poolId: "street-offer", fallback: { label: "Alright", run: function () { meet(p); relShift(p, "greeted", 0.3); } } },
      b: b,
    };
  }

  function intentFavor(p, m) {
    const ASK = 8 + ((pedHash(p, 0xFA) * 10) | 0);
    const line = m.helped > 0
      ? "“You again — you're one of the good ones. Anything spare?”"
      : pick(["“Brother, anything helps. Even a few bucks.”", "“Haven't eaten since yesterday. Anything spare?”"]);
    return {
      id: "favor", line: line,
      a: {
        label: "Here you go — " + money(ASK),
        closer: "“God bless. For real.”",
        run: function () {
          if (!spend(ASK)) { sayP(p, "“…you're broke too, huh. City's eating everybody.”", "#cfd6e6"); return; }
          if (p.cash != null) p.cash = (p.cash | 0) + ASK;
          m.helped++; relShift(p, "gift", 1); addRespect(1);
          if (CBZ.sfx) CBZ.sfx("coin");
          maybeBefriend(p, m);
        },
      },
      b: {
        label: pick(["Not today", "Can't help you"]),
        closer: "“…yeah. Heard that one.”",
        mem: function () { m.declines++; relShift(p, "snubbed", 0.15); },
      },
    };
  }

  function intentIntro(p, m, t) {
    return {
      id: "intro",
      line: "“You move like you're looking for somebody. I know a guy — " + t.what + ".”",
      a: {
        label: "Who?",
        closer: "“Ask for " + t.name + ". You didn't hear it from me.”",
        run: function () {
          meet(p); relShift(p, "greeted", 0.6);
          if (CBZ.mission && CBZ.mission.start) {
            CBZ.mission.start({
              id: "dlg:intro", title: "Meet " + t.name, giver: nm(p),
              goal: "reach", radius: 7,
              at: t.live ? function () { return (t.live && !t.live.dead) ? t.live : (t.at || null); } : t.at,
              reward: { respect: 2 },
              brief: "“" + t.name + " " + t.what + ". Worth knowing.”",
              doneText: "You found " + t.name + ".",
              onComplete: function () { if (t.live) { meet(t.live); relShift(t.live, "greeted", 0.5); } },
            });
          } else if (CBZ.fullMap && CBZ.fullMap.setWaypoint) {
            const at = t.live && t.live.pos ? t.live.pos : t.at;
            if (at) try { CBZ.fullMap.setWaypoint(at.x, at.z, ("MEET " + t.name).toUpperCase()); } catch (e) {}
          }
        },
      },
      b: { label: "Not looking", closer: "“Everybody's looking for somebody.”", mem: function () { relShift(p, "snubbed", 0.2); } },
    };
  }

  function intentGripe(p, m) {
    const l = p._jobLot;
    const where = (l && l.building && l.building.name) ? l.building.name : null;
    const line = where
      ? pick(["“Twelve hours at " + where + " and my feet are done talking to me.”",
              "“" + where + " again tomorrow. Same shift, same pay, same everything.”"])
      : "“Work's work, but this week's been a war.”";
    return {
      id: "gripe", line: line,
      a: {
        label: pick(["That's rough", "You've earned a break"]),
        closer: "“…thanks for hearing it. Most don't.”",
        run: function () { meet(p); relShift(p, "greeted", 0.9); m.warm++; maybeBefriend(p, m); },
      },
      b: {
        label: pick(["We've all got problems", "Tell your boss, not me"]),
        closer: "“Forget I said anything.”",
        mem: function () { relShift(p, "snubbed", 0.5); },
      },
    };
  }

  function intentSocial(p, m) {
    const att = CBZ.cityAttending ? CBZ.cityAttending(p) : null;   // {what, venue} or null
    const line = m.friend
      ? pick(["“There you are. Still causing trouble?”", "“My guy. What's the word?”"])
      : (att && att.what)
        ? "“You out for " + att.what + " too? Whole block is.”"
        : pick(["“Don't know you. That's rare on this block.”",
                "“Crazy city lately, huh. You holding up?”",
                "“You've got the look of somebody with a story.”"]);
    return {
      id: "social", line: line,
      a: {
        label: m.friend ? "Good to see you" : pick(["What's the word?", "Good to meet you"]),
        closer: null,   // maybeBefriend / warmCloser speaks
        run: function () {
          meet(p); relShift(p, "greeted", 0.6); m.warm++;
          if (!maybeBefriend(p, m)) sayP(p, pick(["“Stay dangerous.”", "“You're alright.”", "“See you around, yeah?”"]), "#cdeccd");
        },
      },
      b: {
        label: pick(["We're done here", "Walk on"]),
        closer: "“Whatever, man.”",
        mem: function () { relShift(p, "snubbed", 0.3); },
      },
    };
  }

  function intentBrushoff(p, m) {
    return {
      id: "brushoff", line: pick(["“The hell you want?”", "“Keep stepping. This ain't a meet-and-greet.”"]),
      a: { label: pick(["Easy — wrong guy", "My mistake"]), closer: "“Then move.”", mem: function () { relShift(p, "greeted", 0.1); } },
      b: {
        label: "Make it my problem", bad: true,
        closer: null,
        mem: function () {
          const pa = playerActor();
          relShift(p, "threatened", 0.8);
          // do they DARE? The read is sizeup's, not a die.
          if (CBZ.citySizeUp && pa && !CBZ.citySizeUp(p, pa)) {
            if (CBZ.cityScare) CBZ.cityScare(p, pa, { bias: 0.1 });
            addRespect(1);
            sayP(p, "“…forget it. Forget it!”", "#cfd6e6");
          } else if (pa) {
            p.rage = pa; p.state = "fight"; p.fear = 0;
            sayP(p, "“BIG mistake.”", "#ff8a7a");
          }
        },
      },
    };
  }

  function intentCop(c, m) {
    const line = pick(["“Keep it moving. Nothing to see on this corner.”",
                       "“Evening. You live around here?”",
                       "“Quiet night. Let's keep it that way.”"]);
    return {
      id: "cop", line: line,
      a: {
        label: pick(["You got it, officer", "Just heading home"]),
        closer: "“Good answer.”",
        run: function () { meet(c); relShift(c, "greeted", 0.5); },
      },
      b: {
        label: pick(["Don't you have real crimes?", "Quiet for who?"]),
        closer: "“Keep walking, smart guy.”",
        mem: function () { relShift(c, "snubbed", 0.8); addRespect(1); c._faceT = 2.0; },
      },
    };
  }

  // FRIENDSHIP STARTS FACE TO FACE — two warm exchanges (or two handouts) and
  // this person is a FRIEND: the family builder's hook when present, an honest
  // flag + a contact entry when not. Never twice.
  function maybeBefriend(p, m) {
    if (m.friend || (m.warm < 2 && m.helped < 2)) return false;
    m.friend = true; befriended++;
    if (CBZ.kinshipBefriend) { try { CBZ.kinshipBefriend(p); } catch (e) { p.friendOfPlayer = true; } }
    else p.friendOfPlayer = true;
    relShift(p, "gift", 1);
    contactAdd(p, "friend");
    sayP(p, "“You're alright. I mean it. You need me, you know where I am.”", "#cdeccd", 3);
    note(nm(p) + " counts you a friend now.", 2.4, nm(p).toUpperCase());
    return true;
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
    dlg = {
      p: p, intent: it.id, line: it.line, a: it.a, b: it.b,
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
    dlg = null;
    unPose(p, prev);
    p._dlgCD = nowSec() + (why === "answered" ? 20 : 32) + Math.random() * 16;
    if (!silent) {
      if (why === "walkaway") { tailBeat(p, "dlgShrug", 0.8 + Math.random() * 0.3); }
      else if (why === "ignored") {
        sayP(p, pick(["“…forget it, then.”", "“Right. Good talk.”", "“Hello? …unbelievable.”"]), "#cfd6e6");
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
    return c.label || "Alright";
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
    const la = choiceLabel(dlg.a, pk.t, ctx), lb = dlg.b.label || "Not now";
    const out = [
      { key: "e", hold: false, label: la, bad: !!(dlg.a.bad || (dlg.aPool && dlg.aPool.bad)), opt: dlg.wrapA, decision: "yes", proposal: la, standing: null },
      { key: "i", hold: false, label: lb, bad: !!dlg.b.bad, opt: dlg.wrapB, decision: "yes", proposal: lb, standing: null },
    ];
    out.dualRide = true;          // verb-card render + the E-router yield
    out.note = dlg.line;          // the spoken line IS the card's text
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
     THE OPENERS — one registration per layer, superseding the legacy one-line
     talk verbs by slot exclusivity (street-offer prio 72; power's detail
     intercept at 74 keeps outranking everything power owns because declared
     principals and their guards are EXCLUDED here, not out-prioritised).
     ========================================================================== */
  function inMyGang(p) { return !!(CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p)); }
  function crewmate(p) { const m = CBZ.cityMembership && CBZ.cityMembership(); return !!(m && p.gang && p.gang === m.gangId); }
  function canOpen(p, ctx) {
    if (!on() || !p || p.dead || p.vendor) return false;
    if (dlg) return dlg.p === p;              // keeps the candidate resolvable while open
    if ((p._dlgCD || 0) > nowSec()) return false;
    if (p.child) return false;
    if (ctx && (ctx.gunDrawn || ctx.driving)) return false;
    if (p.rage || p.surrender || p.controlled || p.inCar || p._npcAttached) return false;
    if (p.state === "flee" || p.state === "fight" || p.state === "confront" ||
        p.state === "stalk" || p.state === "charge" || p._bumHunt) return false;
    if (p.companion || p.recruited || p === g.cityPartner) return false;
    if (inMyGang(p)) return false;            // your soldiers keep their orders verbs
    if (crewmate(p) && !giverRow(p)) return false;  // crewmates talk when they carry WORK
    if (CBZ.powerOrgOf && CBZ.powerOrgOf(p)) return false;   // principals: power.js owns the walk-up
    if (CBZ.powerGuardOf && CBZ.powerGuardOf(p)) return false;
    return true;
  }
  I.register("ped:civ", {
    id: "dlg-talk", slot: "e", prio: 80,
    canShow: canOpen,
    label: "Talk",
    onSelect: function (p) { openDialogue(p); },
  });
  I.register("ped:cop", {
    id: "dlg-talk-cop", slot: "e", prio: 80,
    canShow: function (c, ctx) {
      if (!on() || !c || c.dead) return false;
      if (dlg) return dlg.p === c;
      if ((ctx && ctx.wanted | 0) >= 1 || c._challenged) return false;   // the arrest fabric owns hot cops
      if ((c._dlgCD || 0) > nowSec()) return false;
      if (ctx && (ctx.gunDrawn || ctx.driving)) return false;
      if (c.rage || c.controlled || c.curTarget) return false;
      return true;
    },
    label: "Talk",
    onSelect: function (c) { openDialogue(c); },
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
    // FRIEND contact: meet at a real place the city built (never spawned)
    if (rec.friend) {
      const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
      let best = null, bd = 1e12;
      for (let i = 0; i < lots.length; i++) {
        const l = lots[i];
        if (!l || l.demolished || !l.building) continue;
        if (l.kind !== "bar" && l.kind !== "food" && l.kind !== "park") continue;
        const dx = l.cx - rec.x, dz = l.cz - rec.z, dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = l; }
      }
      if (best) return { kind: "meet", x: best.cx, z: best.cz, place: (best.building && best.building.name) || ("the " + best.kind) };
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
      const text = pend.kind === "job"
        ? (call ? "Tried to call you. " : "") + "Got another one if you want it — " + pend.title.toLowerCase() + ", pays " + money(pend.pay) + ". Check your contacts."
        : (call ? "Rang you twice. " : "") + "Been a minute. Meet me at " + pend.place + "? First round's mine.";
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
      if (CBZ.mission && CBZ.mission.busy && CBZ.mission.busy()) { note("Finish what you're carrying first.", 2.2, rec.name.toUpperCase()); return false; }
      if (CBZ.cityOrders && CBZ.cityOrders.refresh) try { CBZ.cityOrders.refresh(); } catch (e) {}
      const started = (CBZ.mission && CBZ.mission.take) ? CBZ.mission.take(pend.id) : null;
      if (!started || started.inert) { note("It fell through — " + rec.name + " will call again.", 2.2, rec.name.toUpperCase()); return false; }
      routed++;
      return true;
    }
    if (pend.kind === "meet" && CBZ.mission && CBZ.mission.start) {
      CBZ.mission.start({
        id: "dlg:meet:" + rec.id, title: "Meet " + rec.name, giver: rec.name,
        goal: "reach", at: [pend.x, pend.z], radius: 8,
        reward: { respect: 2 },
        brief: "“Meet me at " + pend.place + ".”",
        doneText: rec.name + " buys the round. Friends are worth keeping.",
        onComplete: function () { const p = contactPed(rec); if (p) relShift(p, "gift", 0.8); },
      });
      return true;
    }
    return false;
  }

  /* ---- exports + ratchet --------------------------------------------------- */
  CBZ.cityDialogue = {
    open: openDialogue,
    active: function () { return dlg ? dlg.p : null; },
    intentOf: function (p) { return p ? castIntent(p).id : null; },   // probe surface
    contacts: contacts,
    phoneAnswer: phoneAnswer,
  };
  CBZ.cityDialogueOpen = openDialogue;

  // legacyTalkPaths is a LIVE census, not a guess: these are the registered
  // one-line talk verbs this grammar supersedes (they remain the flag-off
  // degrade path). It may only ever go DOWN — a path leaves the list by being
  // deleted or folded into a two-choice intent, never by editing this array.
  const LEGACY_TALK = ["ped-talk", "ped-talk-gang", "cop-directions", "vendor-talk", "street-offer"];
  CBZ.dialogueAudit = function () {
    let legacy = 0;
    if (I.hasOption) { for (let i = 0; i < LEGACY_TALK.length; i++) if (I.hasOption(LEGACY_TALK[i])) legacy++; }
    else legacy = LEGACY_TALK.length;
    return {
      talkers: opened, twoChoice: twoShown, offersRouted: routed,
      contacts: contacts().length, friends: befriended,
      phonePings: pinged, legacyTalkPaths: legacy,
      open: !!dlg, intent: dlg ? dlg.intent : null,
    };
  };
})();
