/* ============================================================
   city/read.js — WHO YOU ARE TO THEM.

   OWNER (2026-08-11): "roles and levels matter for what they say to me —
   like if I'm a hitman they offer me jobs"; (2026-10-22) "random dumb
   dialogue sucks... real words based on reality in game."

   This file turns the numbers the street keeps about you into words a
   person can act on:
     CBZ.cityReadGap(ped)      -> -2..2  who out-reads whom (the level gap)
     CBZ.citySocialRead(ped)   -> { standing, mood, gap, level, title, kind, seen }
     CBZ.cityPlayerRole()      -> { key: civilian|cop|president|boss|crew|hitman|security, title, level }
     CBZ.cityTheirRole(ped)    -> the dozen kinds the street differentiates

   THE MOUTH IS CBZ.voice (systems/voice.js). Every situational line in the
   city (being bumped, shoved, robbed, the windup before a fight, a witness)
   is picked there, by the one picker, off what the person sees. What stays
   here is the small authored book of TRANSACTIONS (a dealer's pitch, a man
   asking for work, a clerk handing over what you bought, your crew answering
   an order), and those pick through the same picker.

     CBZ.cityLine(ped, topic, opts) -> string | null
     CBZ.citySayTopic(ped, topic, opts) -> bool
     CBZ.cityContactReact(ped, kind, severity) -> bool   (humancontact.js)

   The ambient small talk that lived here (GREET, TRADE, "You got a light?",
   "My landlord's a crook") is gone: a person who has nothing to say to you
   says nothing.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  let _lines = 0, _contacts = 0, _mute = 0;

  // ============================================================
  //  1. THE GAP — who out-reads whom, in bands, not numbers.
  //      +2  you tower over them        -2  they tower over you
  //      +1  you clearly out-read them  -1  they clearly out-read you
  //       0  same weight class
  // ============================================================
  const NEAR = 12, FAR = 28;
  function lvlOf(a) {
    if (!a) return 10;
    // cover-aware: a disguised operative reads as what they are presenting.
    if (CBZ.cityLevel) { try { return CBZ.cityLevel(a, CBZ.city && CBZ.city.playerActor) | 0; } catch (e) {} }
    return 10;
  }
  function myLvl() {
    if (CBZ.cityPlayerLevel) { try { return CBZ.cityPlayerLevel() | 0; } catch (e) {} }
    return 10;
  }
  function readGap(them) {
    const d = myLvl() - lvlOf(them);
    if (d >= FAR) return 2;
    if (d >= NEAR) return 1;
    if (d <= -FAR) return -2;
    if (d <= -NEAR) return -1;
    return 0;
  }
  CBZ.cityReadGap = readGap;

  // ============================================================
  //  2. THE WORDS FOR THE NUMBERS — standing and mood.
  // ============================================================
  function relOf(p) { return (CBZ.cityRel && CBZ.cityRel(p)) || null; }
  function standingOf(p, r) {
    const bond = CBZ.cityBond ? CBZ.cityBond(p) : 0;
    const grudge = r ? r.grudge : 0, respect = r ? r.respect : 0, loyalty = r ? r.loyalty : 0;
    if (grudge >= 55) return "enemy";
    if (grudge >= 22 || bond < -0.25) return "sour";
    if (bond > 1.0 || loyalty >= 70) return "friend";
    if (bond > 0.45 || respect >= 55 || loyalty >= 40) return "solid";
    if (r && r.seen) return "known";
    return "stranger";
  }
  function moodOf(p, r) {
    if (!r) return "";
    if (r.fear >= 55) return "scared";
    if (r.grudge >= 40) return "angry";
    if (r.affection >= 45) return "warm";
    if (r.respect >= 50) return "open";
    return "";
  }
  function socialRead(p) {
    if (!p) return { standing: "stranger", mood: "", gap: 0, level: 10, title: "", kind: null, seen: false };
    const r = relOf(p);
    const role = CBZ.cityRole ? CBZ.cityRole(p) : { title: "", kind: null };
    return {
      standing: standingOf(p, r),
      mood: moodOf(p, r),
      gap: readGap(p),
      level: lvlOf(p),
      title: role.title || "",
      kind: role.kind || null,
      seen: !!(r && r.seen),
    };
  }
  CBZ.citySocialRead = socialRead;

  // ============================================================
  //  3. WHAT *YOU* ARE. Derived from what already exists — no new field.
  // ============================================================
  function playerRole() {
    const out = { key: "civilian", title: "", level: myLvl() };
    try { out.title = CBZ.cityPlayerTitle ? CBZ.cityPlayerTitle() : ""; } catch (e) {}
    if (g && g.role === "cop") { out.key = "cop"; return out; }
    try {
      const P = CBZ.presidency, st = P && P.status ? P.status() : null;
      if (st && st.seat) { out.key = "president"; return out; }
    } catch (e) {}
    const F = CBZ.factions;
    let memb = null;
    if (F && F.membership) { try { memb = F.membership("gang"); } catch (e) {} }
    if (memb && memb.owner) { out.key = "boss"; return out; }
    if (memb || (CBZ.cityInCrew && CBZ.cityInCrew())) { out.key = "crew"; return out; }
    if (CBZ.cityNotoriety) {
      try { const n = CBZ.cityNotoriety(); if (n && n.idx >= 2) { out.key = "hitman"; return out; } } catch (e) {}
    }
    if (CBZ.citySecurityRank) {
      try { if ((CBZ.citySecurityRank().shifts | 0) > 0) { out.key = "security"; return out; } } catch (e) {}
    }
    return out;
  }
  CBZ.cityPlayerRole = playerRole;

  function theirRole(p, rd) {
    if (!p) return "civilian";
    if (p.kind === "cop") return "cop";
    if (p.kind === "security") return "security";
    if (p.vendor || p.archetype === "merchant") return "vendor";
    if (p.dealer || p.archetype === "dealer") return "dealer";
    if (p.gang) return "gang";
    const t = rd && rd.title;
    if (t === "Bum") return "bum";
    if (t === "Kid" || t === "Student") return "kid";
    if (t === "Tourist") return "tourist";
    if (t === "Addict") return "addict";
    if (rd && rd.kind === "job") return "worker";
    return "civilian";
  }
  CBZ.cityTheirRole = function (p) { return theirRole(p, socialRead(p)); };

  // ============================================================
  //  4. THE BOOK OF TRANSACTIONS. A thing a person says because of a deal
  //  the player is in the middle of. Inside a topic, the first situation
  //  that has lines wins:  me.<your role>  them.<their role>  base
  //  {title} {sir} {Sir} {place} {dir} {item} are filled by the caller.
  // ============================================================
  const BOOK = {
    askWork: { base: ["You hiring?", "Put me on. I need the work.", "I can drive. I can keep quiet."] },
    pitch: {
      me: { cop: ["Nothing. I'm just standing here."] },
      them: { dealer: ["You looking?", "You need something?"] },
      base: ["You looking?", "You need something?"],
    },
    tapped: { base: ["Nah, I got nothing.", "Not today.", "I'm tapped out."] },
    // somebody who works for the President, as he comes past
    // (president_staff.js THE HOUSE KNOWS HIM)
    serve: {
      them: { security: ["{Sir}.", "{title}."] },
      base: ["{title}.", "{Sir}.", "Good evening, {sir}."],
    },
    handOver: { them: { vendor: ["Here you go.", "Anything else?", "Careful, it's hot."] }, base: ["Here you go."] },
    copOk: { base: ["Fine. Move along.", "Alright. Go home.", "Don't let me see you again."] },
    copNo: { base: ["Save it.", "Nice try.", "Hands where I can see them."] },
    // your crew member answering an order
    crewRob: { base: ["On it.", "Say less.", "Easy money."] },
    crewScare: { base: ["On it.", "I got him."] },
    crewSic: { base: ["With pleasure.", "Say less."] },
    crewTail: { base: ["I'm on him.", "He won't see me."] },
    crewFollow: { base: ["Right behind you.", "Let's go."] },
    crewWait: { base: ["I'll be here.", "Holding it down."] },
    crewNo: { base: ["Not him. He's family.", "I'm not doing that.", "Nah. Not that one."] },
    crewDemand: { base: ["Wallet. Now.", "Empty your pockets.", "Don't make me ask twice.", "Hand it over."] },
    crewThreat: { base: ["Beat it.", "Walk. Now.", "Get lost."] },
    crewBack: { base: ["Done.", "Got it. Here.", "That's yours."] },
    crewReport: { base: ["He went {dir}. Toward {place}.", "Lost him by {place}.", "He's by {place}."] },
  };
  function bookPool(p, T) {
    const mine = playerRole().key;
    if (T.me && T.me[mine]) return T.me[mine];
    const them = theirRole(p, socialRead(p));
    if (T.them && T.them[them]) return T.them[them];
    return T.base || null;
  }
  function fill(s, vars) {
    if (!s || s.indexOf("{") < 0) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : ""; })
      .replace(/\s{2,}/g, " ").trim();
  }

  // ============================================================
  //  5. THE ONE CALL. Situational topics are CBZ.voice's; the book answers
  //  the transactions; anything else is silence.
  // ============================================================
  function line(p, topic, opts) {
    if (!p || p.dead) return null;
    opts = opts || {};
    const V = CBZ.voice;
    if (topic === "contact") topic = opts.severity != null && opts.severity >= 0.45 ? "shoved" : "bumped";
    if (V && V.knows(topic)) {
      const s = V.line(p, topic, opts);
      if (s) _lines++; else _mute++;
      return s;
    }
    const T = BOOK[topic];
    if (!T) { _mute++; return null; }
    const pool = bookPool(p, T);
    if (!pool || !pool.length) { _mute++; return null; }
    // an answer to a deal is never silenced for being said a minute ago
    const s = (V && V.pick(p, topic, pool)) || pool[0];
    if (s) _lines++;
    return fill(s, opts.vars);
  }
  CBZ.cityLine = line;
  // the line AND the mouth. Returns true only when the words reached the screen.
  CBZ.citySayTopic = function (p, topic, opts) {
    opts = opts || {};
    const s = line(p, topic, opts);
    if (!s || !CBZ.citySay) return false;
    const o = { secs: opts.secs || undefined };
    if (opts.force) o.force = true;
    return CBZ.citySay(p, s, opts.color || null, o) !== false;
  };
  CBZ.cityLineBook = BOOK;          // the check tool reads it

  // ============================================================
  //  6. CONTACT. systems/humancontact.js classifies every body-to-body
  //  contact (bump / shoved / repeated-shove / run-over). The relationship
  //  remembers it; CBZ.voice answers it with a body and, sometimes, words.
  // ============================================================
  const CONTACT_REL = { bump: null, shoved: "snubbed", "repeated-shove": "threatened", "run-over": "beaten" };
  const CONTACT_EV = { bump: "bumped", shoved: "shoved", "repeated-shove": "repeated", "run-over": "runOver" };
  function contactReact(p, kind, severity) {
    if (!p || p.dead) return false;
    if (g && g.mode !== "city") return false;
    const sev = severity == null ? 0.25 : severity;
    const relKind = CONTACT_REL[kind];
    if (relKind && CBZ.cityRelShift) { try { CBZ.cityRelShift(p, relKind, sev < 0.5 ? 0.6 : 1); } catch (e) {} }
    const V = CBZ.voice;
    if (!V) return false;
    const r = V.react(p, CONTACT_EV[kind] || "bumped", { by: (CBZ.city && CBZ.city.playerActor) || CBZ.player, severity: sev });
    if (r.line) _contacts++;
    return !!r.line;
  }
  CBZ.cityContactReact = contactReact;

  CBZ.cityReadAudit = function () {
    return { lines: _lines, contacts: _contacts, mute: _mute, near: NEAR, far: FAR };
  };
  CBZ.cityReadReset = function () { _lines = _contacts = _mute = 0; };
})();
