/* ============================================================
   city/read.js — WHO YOU ARE TO THEM, IN WORDS.

   OWNER (2026-08-11): "roles and levels matter for what they say to me —
   like if I'm a hitman they offer me jobs"; "you don't get popups in real
   life"; "the dialogue area IS the whole game."

   THE FAULT THIS ANSWERS. The city keeps a five-axis relationship record on
   every person you have touched (social.js `relPlayer`), a cover-aware 1..100
   level and a {title, kind} role read (level.js), and a ±12 level-gap test
   (interactions_rich.js:97). Every one of those is READ AS A RAW NUMBER at the
   call site, and the lines that come out are flat literal arrays picked with
   `rng()`:

       pick(["Yo, you buying or selling?", ...], rng())

   So a Lv.3 bum and a Lv.74 shot-caller greet a Kingpin with the same sentence
   off the same die. The simulation is enormous and the mouth is a coin flip.

   THE PRISON ALREADY SOLVED THIS and the city never got the port. systems/
   economy.js:263 `socialRead()` turns the same axes into WORDS — standing is
   stranger/known/solid/friend/sour/enemy, mood is scared/angry/open — and
   economy.js:145 states the law it exists to serve:

       "Every one of these is surfaced as a LINE or a PRICE, never as a meter."

   This file is that converter for the street, plus the two things the street
   needs that the cell block does not: a LEVEL GAP (the prison is a flat yard;
   the city runs 1..100) and a PLAYER ROLE (nobody in the prison asks what you
   do for a living).

   WHAT IT AUTHORS: no stat, no axis, no ladder. Every number read here is
   written by somebody else. This file only turns those numbers into a word,
   and the word into a line.

   THE SAME MAN SAYS THE SAME THING. Line choice is hashed off the person's own
   spawn cell (the peds.js roleHash idiom, copied by combat_iq.js:131,
   dialogue.js:102 and tells.js for the same reason) folded with the gap and
   the standing — so the pick is stable across a reload and across a save, and
   it CHANGES when the relationship changes rather than when the die rolls.
   Math.random never appears here.

   THE BODY IS NOT THIS FILE'S JOB. Contact moves the scalars through
   cityRelShift and stops. city/tells.js already maps fear -> guarded hands,
   grudge -> folded arms and a stare, bond -> a wave, on its own tick. Forcing
   a pose from here would be a second tells system; nudging the number that
   already drives one is the whole seam.

   Flag: CBZ.CONFIG.CITY_READ_V1 (default ON). Audit: CBZ.cityReadAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (C.CITY_READ_V1 == null) C.CITY_READ_V1 = true;
  function on() { return C.CITY_READ_V1 !== false; }

  // ---- counters (ratchet: `flat` is the number of legacy flat-array picks
  //      still reaching a mouth this session; it may only ever go DOWN) ------
  let _lines = 0, _contacts = 0, _mute = 0, _offers = 0;

  // ============================================================
  //  1. THE GAP — who out-reads whom, in bands, not numbers.
  //
  //  interactions_rich.js:97 already draws this line at ±12 and uses it in
  //  exactly one verb (intimidate). Twelve is a real threshold — it is the
  //  point where "clearly outranks" starts — so it stays as band 1, and a
  //  second threshold at 28 marks the gulf where a person stops negotiating
  //  and starts deferring (or stops deferring and starts taking).
  //
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
  //  2. THE WORDS — socialRead for the street.
  //     Mirrors systems/economy.js:263 field for field where the axes match,
  //     so a future merge of the two is a rename and not a redesign.
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
  //  3. WHAT *YOU* ARE. Nobody in the prison asks what you do; on the street
  //     it is the difference between being offered work and being warned off.
  //     Derived from what already exists — no new field.
  // ============================================================
  function playerRole() {
    const out = { key: "civilian", title: "", level: myLvl() };
    try { out.title = CBZ.cityPlayerTitle ? CBZ.cityPlayerTitle() : ""; } catch (e) {}
    if (g && g.role === "cop") { out.key = "cop"; return out; }
    // your own set beats borrowed colours beats a paid career.
    const F = CBZ.factions;
    let memb = null;
    if (F && F.membership) { try { memb = F.membership("gang"); } catch (e) {} }
    if (memb && memb.owner) { out.key = "boss"; return out; }
    if (memb || (CBZ.cityInCrew && CBZ.cityInCrew())) { out.key = "crew"; return out; }
    // NOTORIETY is the contract-killer ladder (careers.js RANKS). Earner and
    // up is a person the street has heard of as somebody who takes work.
    if (CBZ.cityNotoriety) {
      try { const n = CBZ.cityNotoriety(); if (n && n.idx >= 2) { out.key = "hitman"; return out; } } catch (e) {}
    }
    if (CBZ.citySecurityRank) {
      try { if ((CBZ.citySecurityRank().shifts | 0) > 0) { out.key = "security"; return out; } } catch (e) {}
    }
    return out;
  }
  CBZ.cityPlayerRole = playerRole;

  // ============================================================
  //  4. THE PICK — stable per person, moves with the relationship.
  //
  //  hash01 off the spawn cell answers "who is this person" the same way every
  //  other file in the repo answers it. Folding the gap and the standing index
  //  into the salt means the SAME man greets you differently once he fears you
  //  — the line changes because the world changed, never because a die rolled.
  // ============================================================
  const STAND_IX = { stranger: 0, known: 1, solid: 2, friend: 3, sour: 4, enemy: 5 };
  function pedHash(p, salt) {
    if (CBZ.hash01 && p && p.pos) return CBZ.hash01(p.pos.x | 0, p.pos.z | 0, salt);
    // degrade: a stable-ish fallback that is still not Math.random
    const n = ((p && p._sid) || 1) * 2654435761 + salt;
    return ((n >>> 8) & 0xffff) / 65536;
  }
  function pick(p, rd, topic, pool) {
    if (!pool || !pool.length) return null;
    const salt = 0x51ED + topic.length * 131 + (rd.gap + 2) * 17 + (STAND_IX[rd.standing] || 0) * 7;
    const i = (pedHash(p, salt) * pool.length) | 0;
    return pool[i < 0 ? 0 : i >= pool.length ? pool.length - 1 : i];
  }

  // ============================================================
  //  5. THE TABLE. THEIR ROLE × YOUR ROLE.
  //
  //  OWNER (2026-08-11): "they don't just talk to me based on my role, also
  //  based on theirs — it's a simple table I think if you consider it."
  //
  //  He is right, and it is the reason the first cut of this file was still
  //  half-wrong: it had a gap ladder and a separate what-YOU-are list, which
  //  cannot express the interesting half of the space. A dealer talking to a
  //  hitman and a dealer talking to a cop are different sentences, and neither
  //  is reachable from "their gap band" or "your role" alone.
  //
  //  So it is a real matrix, resolved most-specific-first:
  //
  //      TABLE[topic][theirRole][yourRole]   the cell
  //      TABLE[topic][theirRole]["*"]        they talk, you are nobody special
  //      TABLE[topic]["*"][yourRole]         anybody talks to a man like you
  //      GAP[topic][band]                    neither role is interesting
  //
  //  The GAP row is the floor, never skipped — the level read still colours
  //  everything, it just stops being the ONLY axis.
  // ============================================================

  // Their role, coarsened from level.js's {title, kind} into the dozen kinds
  // the street actually differentiates. Never a new field — a read of a read.
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

  // --- CONTACT: you walked into them. -------------------------------------
  const CONTACT = {
    cop:      { "*": ["Keep it moving.", "Watch yourself."],
                cop: ["Careful, partner.", "Eyes up."],
                boss: ["…I know who you are. Keep walking.", "Not today. Just go."],
                hitman: ["I've got my eye on you.", "One of these days."] },
    security: { "*": ["Careful.", "Watch the space."],
                boss: ["Sorry — sorry, sir.", "Didn't see you."] },
    // LEVEL INSIDE THE CELL: the same set, two different men. You tower over
    // the corner kid (+2) and he folds; the lieutenant who outreads you (−2)
    // does not care what you think you are.
    gang:     { "*": { "2": ["…my fault. My fault.", "Didn't see you, sorry."],
                       "0": ["Wrong block to be clumsy on.", "Watch it."],
                       "-2": ["You just put hands on the wrong man.", "Do you know whose block this is?"] },
                crew: ["Easy — we're the same colours.", "Careful, family."],
                boss: ["My fault, boss.", "Sorry — didn't see you."],
                cop: { "1": ["…nothing. Wasn't nothing.", "Keep walking, officer."],
                       "-1": ["You're a long way from backup, officer.", "Badge don't mean much here."] },
                hitman: ["…my bad. My bad.", "Didn't mean nothing by it."] },
    dealer:   { "*": ["Hey — careful, I'm holding.", "Watch it, man."],
                cop: ["Whoa — I'm just standing here.", "I ain't doing nothing."],
                hitman: ["Easy! Easy. We're good.", "No trouble here."] },
    vendor:   { "*": ["Mind the stall!", "Careful — that's my stock."],
                boss: ["Sorry! Sorry, take your time."] },
    bum:      { "*": ["Hey — hey, easy…", "Sorry, sorry…", "I'm moving, I'm moving."],
                cop: ["I'm going, officer, I'm going.", "Don't— I'm leaving."] },
    kid:      { "*": ["Hey!", "Ow!", "Watch it!"],
                cop: ["I didn't do anything!", "It wasn't me!"] },
    tourist:  { "*": ["Oh — excuse me!", "Sorry! Sorry."] },
    addict:   { "*": ["Whoa— hey.", "…easy, easy."] },
    worker:   { "*": ["Hey, I'm working here.", "Watch it, please."],
                boss: ["Sorry — didn't see you there."] },
    "*":      { cop:    ["Sorry, officer.", "Excuse me, officer."],
                boss:   ["Sorry — didn't see you.", "My fault. My fault."],
                hitman: ["…sorry. Sorry.", "Excuse me."] },
  };
  const CONTACT_GAP = {
    "2":  ["Sorry — sorry, my fault.", "My bad, my bad.", "Didn't see you — sorry."],
    "1":  ["Easy — sorry.", "Sorry, my fault.", "Watch— sorry."],
    "0":  ["Hey — watch it.", "You blind?", "Watch where you're going."],
    "-1": ["Watch yourself.", "Move.", "Mind where you're walking."],
    "-2": ["Touch me again. See what happens.", "You want to lose that hand?", "Wrong person to bump into."],
  };
  // STANDING beats the table: a friend is a friend before he is a dealer.
  const CONTACT_STANDING = {
    friend: ["Ha — easy, you.", "Watch it, you clown.", "You trying to knock me over?"],
    solid:  ["Easy now.", "Careful, man."],
    enemy:  ["Do that again.", "You're pushing it.", "Keep walking. Keep walking."],
  };
  const CONTACT_HARD_GAP = {
    "2":  ["Alright! Alright — I'm going!", "Please— I'm going."],
    "1":  ["Hey! Hands off!", "What is your problem?"],
    "0":  ["The hell was that?!", "You want to go?"],
    "-1": ["Try that again.", "You just made a mistake."],
    "-2": ["That's the last time you touch anybody.", "You're done."],
  };

  // --- TRADE: what they pitch, and whether they dare. ---------------------
  const TRADE = {
    dealer: { "*":      ["You buying? I'm holding.", "Got product if you're interested."],
              hitman:   ["You do work, right? I'll pay double for a problem.", "I need somebody gone. Name a price."],
              boss:     ["Your cut's ready whenever you want it, boss.", "I move on your say-so."],
              crew:     ["Tell your people I'm good for the tax.", "Same colours — I'll do you a price."],
              cop:      ["…just talking. Nothing going on here.", "I got nothing on me."] },
    gang:   { "*":      ["You lost? This is our block.", "State your business."],
              hitman:   ["We could use somebody like you. Interested in work?", "There's a name we need gone. You listening?"],
              boss:     ["Whatever you need, boss.", "We're yours. Say the word."],
              crew:     ["Family. What do you need?", "You good? We got you."],
              cop:      ["We're just standing here.", "Move along, officer."] },
    vendor: { "*":      ["Best prices in the city, my friend.", "Take a look — you won't beat it."],
              boss:     ["On the house for you. Please.", "Anything you want — it's yours."],
              cop:      ["All above board here, officer.", "Papers are in order."] },
    bum:    { "*":      ["Spare a few bucks?", "Anything helps. Anything."],
              boss:     ["Big man — spare something for me?", "You look like you can spare it."] },
    worker: { "*":      ["You need something?", "I'm on shift, but go ahead."],
              hitman:   ["I— I don't want any trouble.", "Please, I just work here."] },
    "*":    { hitman:   ["Word is you handle problems. I've got one.", "They say you do work. I'm paying."],
              boss:     ["I'll pay tribute — just say the word.", "Your block, your rules."],
              crew:     ["You ride with them, right? I got something for your crew."],
              cop:      ["I didn't do anything, officer.", "We're good here, right?"] },
  };
  const TRADE_GAP = {
    "2":  ["You need anything, I can get it.", "Name it and I'll find it."],
    "1":  ["I got something you might want.", "You buying? I'm holding."],
    "0":  ["You buying or selling?", "Let's talk business.", "I got a little something."],
    "-1": ["You got money on you?", "Make it quick."],
    "-2": ["You can't afford what I move.", "Not for you.", "Run along."],
  };

  // --- GREET ---------------------------------------------------------------
  const GREET = {
    cop:    { "*": ["Afternoon.", "Move along now."], cop: ["Partner."], boss: ["…we know each other, don't we."] },
    gang:   { crew: ["Family.", "There he is."], boss: ["Boss."], cop: ["…officer."] },
    dealer: { hitman: ["The man himself.", "You working today?"], boss: ["Boss."] },
    bum:    { "*": ["Spare anything?", "God bless."] },
    "*":    { boss: ["Boss.", "Sir."], cop: ["Officer."] },
  };
  const GREET_STANDING = {
    friend:  ["There they are!", "My friend!", "Good to see you."],
    solid:   ["Respect.", "'Sup.", "Good to see you out here."],
    known:   ["Hey.", "You again.", "Alright."],
    sour:    ["…you.", "Great. You."],
    enemy:   ["You've got nerve showing up.", "I see you."],
    stranger:["Hey.", "Alright."],
  };

  const TABLES = { contact: CONTACT, trade: TRADE, greet: GREET };
  const GAPS = { contact: CONTACT_GAP, trade: TRADE_GAP, greet: null };

  // ---- FOUR AXES, NOT TWO -------------------------------------------------
  //  OWNER (2026-08-11): "their role and level and my role and level make the
  //  table." Role is the row and the column; LEVEL enters inside the cell, as
  //  the gap band, because that is where it actually changes the sentence — a
  //  Lv.60 lieutenant and a Lv.8 corner kid are both `gang`, and they do not
  //  say the same thing to a Kingpin.
  //
  //  A cell is therefore EITHER a flat array (this pair says the same thing at
  //  every weight class — most cells, and keeping them flat is what stops the
  //  table becoming unreadable) OR a gap-keyed object. Gap lookup walks
  //  outward to the nearest defined band, so a cell can define only its
  //  extremes and still answer every gap.
  const GAP_ORDER = { "2": ["2","1","0","-1","-2"], "1": ["1","2","0","-1","-2"],
                      "0": ["0","1","-1","2","-2"], "-1": ["-1","-2","0","1","2"],
                      "-2": ["-2","-1","0","1","2"] };
  function atGap(v, gk) {
    if (!v) return null;
    if (Array.isArray(v)) return v;                 // same at every weight class
    const order = GAP_ORDER[gk] || GAP_ORDER["0"];
    for (let i = 0; i < order.length; i++) { const p = v[order[i]]; if (p && p.length) return p; }
    return v["*"] || null;
  }
  // resolve most-specific-first through the matrix, then fall to the gap floor
  function cell(topic, them, mine, gk) {
    const T = TABLES[topic]; if (!T) return null;
    const row = T[them];
    if (row) {
      const hit = atGap(row[mine], gk) || atGap(row["*"], gk);
      if (hit) return hit;
    }
    const any = T["*"];
    if (any) { const hit = atGap(any[mine], gk) || atGap(any["*"], gk); if (hit) return hit; }
    return null;
  }

  // ============================================================
  //  6. THE ONE CALL. cityLine(ped, topic, opts) -> string | null
  //     Degrade-safe: a topic it does not know returns null and the caller
  //     keeps whatever it was doing.
  // ============================================================
  function line(p, topic, opts) {
    if (!on() || !p || p.dead) return null;
    opts = opts || {};
    const rd = opts.read || socialRead(p);
    const gk = String(rd.gap);
    const them = theirRole(p, rd);
    const mine = playerRole().key;
    let pool = null;

    // A HARD SHOVE OUTRANKS THE TABLE. Being knocked about is not a
    // conversation — the register is set by the violence, sized by the gap.
    if (topic === "contact" && opts.severity != null && opts.severity >= 0.55) {
      pool = CONTACT_HARD_GAP[gk];
    }
    // STANDING OUTRANKS ROLE. A friend is a friend before he is a dealer, and
    // an enemy is an enemy before he is a shopkeeper.
    if (!pool && topic === "contact" && CONTACT_STANDING[rd.standing]) pool = CONTACT_STANDING[rd.standing];
    if (!pool && topic === "greet" && (rd.standing === "friend" || rd.standing === "enemy" || rd.standing === "sour")) {
      pool = GREET_STANDING[rd.standing];
    }
    // THE MATRIX: their role × your role, then their level × yours inside it.
    if (!pool) {
      pool = cell(topic, them, mine, gk);
      if (pool && mine !== "civilian") _offers++;
    }
    // THE FLOOR: the level gap still colours anything the table did not answer.
    if (!pool) pool = (GAPS[topic] && GAPS[topic][gk]) || (topic === "greet" ? GREET_STANDING[rd.standing] : null);

    if (!pool || !pool.length) { _mute++; return null; }
    const s = pick(p, rd, topic, pool);
    if (s) _lines++;
    return s;
  }
  CBZ.cityLine = line;

  // ============================================================
  //  7. CONTACT HAS A VOICE NOW.
  //
  //  systems/humancontact.js has classified every body-to-body contact since
  //  it shipped — bump / shoved / repeated-shove / run-over, with a severity,
  //  remembered on `_lastContact` and counted on `_bumpCount` — and it has
  //  never made a sound. This is the one call it was missing.
  //
  //  It moves the RELATIONSHIP (which city/tells.js turns into a body on its
  //  own tick) and it opens a MOUTH. It deliberately does not touch a pose:
  //  see the header.
  // ============================================================
  const CONTACT_REL = { bump: null, shoved: "snubbed", "repeated-shove": "threatened", "run-over": "beaten" };
  function contactReact(p, kind, severity) {
    if (!on() || !p || p.dead || !CBZ.citySay) return false;
    if (g && g.mode !== "city") return false;
    const now = CBZ.now || 0;
    // one line per person per few seconds — a crowd you shoulder through is
    // not a conversation, and the subtitle is a single slot.
    if ((p._contactSayT || 0) > now) return false;
    p._contactSayT = now + 4.5;

    const sev = severity == null ? 0.25 : severity;
    const relKind = CONTACT_REL[kind];
    if (relKind && CBZ.cityRelShift) { try { CBZ.cityRelShift(p, relKind, sev < 0.5 ? 0.6 : 1); } catch (e) {} }

    const rd = socialRead(p);
    const txt = line(p, "contact", { read: rd, severity: sev });
    if (!txt) return false;
    // colour carries the register: deference warm, threat hot, neutral cool.
    const col = rd.standing === "enemy" || rd.gap <= -1 ? "#ff9b8b"
              : rd.standing === "friend" ? "#7ed957"
              : rd.gap >= 1 ? "#dfe7ff" : "#cfd6e6";
    // citySay reports delivery (social.js:431). Out of earshot it returns false
    // and this counts NOTHING — a contact you were too far away to hear is not
    // a line, and an audit that counted it would be lying. The relationship
    // shift above still lands: he remembers being shoved whether or not you
    // were close enough to hear him complain about it.
    let spoke = false;
    try { spoke = CBZ.citySay(p, txt, col, 2.0) !== false; } catch (e) { return false; }
    if (!spoke) { p._contactSayT = 0; return false; }
    // they stop and look at you — the existing pause/face fields, no new brain.
    p.pause = Math.max(p.pause || 0, 0.9);
    if (p.group && CBZ.player && CBZ.player.pos) {
      p.group.rotation.y = Math.atan2(CBZ.player.pos.x - p.pos.x, CBZ.player.pos.z - p.pos.z);
    }
    _contacts++;
    return true;
  }
  CBZ.cityContactReact = contactReact;

  // ============================================================
  //  8. RATCHET. `lines` and `contacts` may only go UP; `mute` is the count of
  //     asks this file could not answer and may only go DOWN. Session
  //     counters, so "never speak" cannot satisfy them.
  // ============================================================
  CBZ.cityReadAudit = function () {
    return { on: on(), lines: _lines, contacts: _contacts, offers: _offers, mute: _mute,
             near: NEAR, far: FAR };
  };
  CBZ.cityReadReset = function () { _lines = _contacts = _mute = _offers = 0; };
})();
