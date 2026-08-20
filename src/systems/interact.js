/* ============================================================
   systems/interact.js — Red Dead-style contextual prompt. Walk up to
   anyone and the options fade in beside them. Four social verbs on the
   home-row cluster (the numbers belong to the inventory hotbar):

       [J] Insult   [K] Befriend   [;] Steal
       (fight is left-click / the touch trigger, never a menu row)
       (Romance was the fourth and is DELETED — see economy.js)

   Merchants, the dealer and bent cops swap a row for Trade, guards for
   Bribe / Payoff, a cop player for Question / Warn / Cuff / Search,
   and an approaching NPC replaces the lot with its own offer. THE WARDEN
   trades in names, never cigarettes: Snitch / Insult / Steal
   (economy.js's snitch()). Befriend routes through systems/quests.js
   (favors, rep, and the "they let you walk out" win).

   ON TOUCH the whole card is REPLACED rather than restyled — on iPad,
   every choice is a vertical rail of buttons docked beside Reload, ONE
   WORD per button with price/status as a small chip inside it (the
   survival dock's Throw/Grab/Punch grammar). Phones retain the compact
   four-button/pill layout, and results use dialogue instead of a panel. See the
   PRISON_INTERACT_TOUCH block below and css/interact_touch.css.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const el = CBZ.el;
  const RANGE = 3.6;

  // ---------------------------------------------------------------------------
  //  PRISON_INTERACT_TOUCH — the iPad answer to this card.
  //
  //  OWNER correction: on iPad every interaction action is a VERTICAL rail
  //  starting beside Reload, with explanation text to the LEFT of each button.
  //  And the standing complaint behind it: "many things on iPad where a pop will
  //  say press g or shift DUH i can't do that... like turning tips off is a key
  //  I can't press."
  //
  //  This card was a keyboard artefact end to end: four [J][K][L][;] chips, a
  //  fifth verb silently DROPPED by cap4 because there were only four keys to
  //  reach it with, and an "[H] Tips: ON" footer whose only affordance was a key
  //  no tablet has. On touch it becomes:
  //    • iPad: every contextual verb in one vertical rail beside Reload, one
  //      52px+ button per verb — a single WORD plus a status/price chip;
  //    • phone: four compact primary buttons plus overflow pills, so nothing the
  //      context offers is unreachable on the narrower surface;
  //    • the actor's name / read / ONE teaching line above the row in the
  //      gang-city dialogue treatment (white Fredoka 700, black stroke, no box)
  //      instead of a panel of prose beside the NPC;
  //    • every verb RESULT spoken as a bottom-centre subtitle in that same
  //      grammar rather than a HUD hint panel (desktop gets this too — it is the
  //      one part of the ask that is not touch-specific);
  //    • a tappable TIPS pill replacing the "[H]" footer.
  //  Desktop keeps the same panel and rows; J/K/L/; leave I exclusively owned
  //  by the Prison stash, even while a contextual card is visible.
  //
  //  Flags (one-line reverts, declared here rather than in config.js so a
  //  parallel wave never races this file against that one):
  //    PRISON_INTERACT_TOUCH    — the whole touch layer (false = legacy card)
  //    PRISON_INTERACT_SUBTITLE — result lines as subtitles (false = flashHint)
  // ---------------------------------------------------------------------------
  if (CBZ.CONFIG && CBZ.CONFIG.PRISON_INTERACT_TOUCH == null) CBZ.CONFIG.PRISON_INTERACT_TOUCH = true;
  if (CBZ.CONFIG && CBZ.CONFIG.PRISON_INTERACT_SUBTITLE == null) CBZ.CONFIG.PRISON_INTERACT_SUBTITLE = true;
  // systems/touch.js's CBZ.touchMode latch is the ONE touch-mode signal in this
  // codebase (it stamps body.touch at the same moment). Never a second detector.
  function touchUI() {
    return !!(CBZ.touchMode && (!CBZ.CONFIG || CBZ.CONFIG.PRISON_INTERACT_TOUCH !== false));
  }
  function subtitleOn() { return !CBZ.CONFIG || CBZ.CONFIG.PRISON_INTERACT_SUBTITLE !== false; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;";
    });
  }

  function approachAction(a, action) {
    if ((a.kind === "guard" || a.kind === "warden") && CBZ.resolveGuardApproach) return CBZ.resolveGuardApproach(a, action);
    return CBZ.resolveNpcApproach ? CBZ.resolveNpcApproach(a, action) : { ok: false, msg: "" };
  }
  function warnActor(a) {
    a.aiState = "flee";
    a.fleeT = 1.8;
    return { ok: true, msg: `${a.data.name.replace(/^the |^a |^an /, "")} backs off.` };
  }

  const VERB = {
    insult:   { label: "Insult",          fn: (a) => CBZ.econ.insult(a) },
    fight:    { label: "Fight",           fn: (a) => (CBZ.punch ? CBZ.punch(a) : CBZ.econ.beat(a)) },
    befriend: { label: "Befriend",        fn: (a) => (CBZ.quests ? CBZ.quests.onTalk(a) : CBZ.econ.talk(a)) },
    trade:    { label: "Trade",           fn: (a) => {
      const res = CBZ.econ.trade(a);
      if (res && res.ok && a.approach && a.approach.kind === "deal") {
        if (CBZ.resolveNpcApproach) CBZ.resolveNpcApproach(a, "completeDeal");
        else if (CBZ.clearNpcApproach) CBZ.clearNpcApproach(a);
      }
      return res;
    } },
    bribe:    { label: "Bribe",           fn: (a) => CBZ.econ.bribe(a) },
    snitch:   { label: "Snitch",          fn: (a) => (CBZ.econ.snitch ? CBZ.econ.snitch(a) : { ok: false, msg: "" }) },
    steal:    { label: "Steal",           fn: (a) => CBZ.econ.steal(a) },
    payoff:   { label: "Payoff",          fn: (a) => CBZ.econ.payoff(a) },
    join:     { label: "Join",            fn: (a) => CBZ.joinGang(a) },
    listen:   { label: "Listen",          fn: (a) => a.approach ? approachAction(a, "listen") : CBZ.econ.talk(a) },
    accept:   { label: "Accept",          fn: (a) => approachAction(a, "accept") },
    respect:  { label: "Respect",         fn: (a) => approachAction(a, "respect") },
    pay:      { label: "Pay",             fn: (a) => approachAction(a, "pay") },
    haggle:   { label: "Haggle",          fn: (a) => approachAction(a, "haggle") },
    threaten: { label: "Threaten",        fn: (a) => approachAction(a, "threaten") },
    refuse:   { label: "Refuse",          fn: (a) => approachAction(a, "refuse") },
    confrontReport: { label: "Confront",  fn: (a) => CBZ.resolveKnownSnitch ? CBZ.resolveKnownSnitch(a, "confront") : { ok: false, msg: "" } },
    paySilence: { label: "Silence",       fn: (a) => CBZ.resolveKnownSnitch ? CBZ.resolveKnownSnitch(a, "paySilence") : { ok: false, msg: "" } },
    threatenSnitch: { label: "Threaten",  fn: (a) => CBZ.resolveKnownSnitch ? CBZ.resolveKnownSnitch(a, "threatenSnitch") : { ok: false, msg: "" } },
    question: { label: "Question",        fn: (a) => CBZ.econ.talk(a) },
    warn:     { label: "Warn",            fn: (a) => a.approach ? approachAction(a, "warn") : warnActor(a) },
    detain:   { label: "Cuff",            fn: (a) => {
      if (a.approach) return approachAction(a, "detain");
      const justified = CBZ.game.role === "cop" && (a.copMarked > 0 || a.huntPlayer > 0 || a.aiState === "fight");
      a.ko = Math.max(a.ko || 0, 5.5); a.hp = Math.max(a.hp || 0, 45); a.aiState = "flee"; a.foe = null;
      if (a.copMarked > 0) a.copMarked = 0;
      CBZ.sfx("punch"); CBZ.shake && CBZ.shake(0.45);
      CBZ.game.kos = (CBZ.game.kos || 0) + 1;
      if (CBZ.game.role === "cop" && CBZ.addComplaint) CBZ.addComplaint(justified ? -2 : 5);
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(a, "detain");
      return { ok: true, msg: justified ? `${a.data.name.replace(/^the |^a |^an /, "")} detained on a clean read.` : `${a.data.name.replace(/^the |^a |^an /, "")} detained. Witnesses may complain.` };
    } },
    search:   { label: "Search",          fn: (a) => {
      const justified = a.copMarked > 0 || a.huntPlayer > 0 || a.aiState === "fight";
      const found = (justified ? 2 : 1) + Math.floor(CBZ.econ.rng() * (justified ? 6 : 4));
      if (a.copMarked > 0) a.copMarked = 0;
      CBZ.econ.addCigs(found);
      if (CBZ.addComplaint) {
        if (justified) CBZ.addComplaint(-3);
        else if (CBZ.econ.rng() < 0.25) CBZ.addComplaint(6);
      }
      CBZ.sfx("coin");
      return { ok: true, msg: justified ? `Good tip. Found ${found} cigs with clean cause.` : `Found ${found} cigs in the shakedown.` };
    } },
    // ---- held at gunpoint (systems/intimidate.js owns the state) ----------
    // Both dispatch back into intimidate rather than reimplementing the
    // shakedown here: it re-validates range and mode, routes the transfer
    // through city/take.js, and keeps him terrified afterwards.
    rob:      { label: "Rob",             fn: (a) => {
      if (CBZ.prisonRobTarget) CBZ.prisonRobTarget(a);
      return { ok: true, msg: "" };
    } },
    // Tie a held-up man's wrists (intimidate.js validates range/state and
    // spends the Bedsheet Rope). Silent either way: the sub-chip already
    // says "needs rope" when the bag cannot pay, and a tied man slumping is
    // the receipt when it can.
    restrain: { label: "Tie",             fn: (a) => {
      if (CBZ.prisonRestrainTarget) CBZ.prisonRestrainTarget(a);
      return { ok: true, msg: "" };
    } },
    release:  { label: "Release",         fn: (a) => {
      // Lowering the gun is the other half of holding it up. Ending the hold
      // here (rather than making the player walk away) means the panel can
      // always be closed by a decision instead of by distance.
      if (CBZ.intimidateRelease) CBZ.intimidateRelease(a);
      return { ok: true, msg: "" };
    } },
  };

  // one-line teaching text per verb; shown until the player has used it
  const DESC = {
    insult:   "Talk trash · drops rep, may start a brawl",
    fight:    "Throw hands · chain hits for a K.O. combo",
    befriend: "Do favors, build rep · friends walk you free",
    trade:    "Buy contraband with cigarettes",
    bribe:    "Spend cigs to make authority look away",
    snitch:   "Trade a rival's name for the heat on you",
    steal:    "Lift a key, a chain, or cigs · risky if seen",
    payoff:   "Corrupt cop cleans up heat for a price",
    join:     "Join their gang for backup & protection",
    listen:   "Hear what they want",
    accept:   "Take the offer",
    respect:  "Back off and avoid gang trouble",
    pay:      "Spend cigs to settle it",
    haggle:   "Try to lower the price",
    threaten: "Scare them off, risk backlash",
    refuse:   "Push them off",
    confrontReport: "Press the witness for details",
    paySilence: "Spend cigs to cool the report",
    threatenSnitch: "Scare the reporter, risk gang backlash",
    question: "Press for a line or tip",
    warn:     "Make them scatter",
    detain:   "Drop them without an arrest meter",
    search:   "Confiscate pocket loot",
    rob:      "Empty his pockets at gunpoint",
    restrain: "Spend a bedsheet rope to tie him. He stays down",
    release:  "Lower the gun and let him go",
  };
  // TIPS ARE OFF UNTIL ASKED FOR (JAIL_SHOW_DONT_TELL, declared entities/ai.js).
  //
  // OWNER: "the HUD is cluttered with 4th-wall breakers." Measured on the
  // deployed build: walking up to a guard raised a card carrying FOUR verbs,
  // each with an explainer line under it ("Slip 10 to look away · Spend cigs to
  // make authority look away" — the second half restates the first), plus an
  // "[H] Tips: ON" footer. 433 characters of HUD text at that moment against
  // 141 idle. The GRAMMAR LAW this repo already enforces on the booking panel
  // is the same one: a button is a bare VERB.
  //
  // Nothing is deleted. `helpOn` simply defaults OFF instead of ON, so the
  // teaching layer is exactly where the footer always said it was — behind H —
  // and a player who wants it back gets it in one keypress, persisted. Flag off
  // restores the old default.
  //
  // ---- 2026-08-04: TIPS ARE GONE, NOT DEFAULTED OFF (PRISON_TIPS) ----------
  // OWNER, playing on a phone: "tips on off button and tips in general need to
  // be removed from the game — see how it takes up HUD."
  //
  // Defaulting `helpOn` to false (above) left the SWITCH on screen forever: a
  // whole extra row in the docked iPad rail ("Teaching tips · Explain
  // unfamiliar actions beside their buttons · TIPS OFF"), a "Tips OFF" pill in
  // the phone overflow, and an "[H] Tips: OFF" footer on the desktop card. That
  // is a permanent control that says OFF, which is more fourth wall than the
  // teaching line it was hiding — it is visible in the owner's own screenshot,
  // parked over the world at the left edge.
  //
  // PRISON_TIPS is the whole layer's master switch and it defaults FALSE:
  // `tipsAllowed()` false means helpOn can never be true, no toggle is drawn on
  // any of the three surfaces, [H] does nothing and the localStorage choice is
  // ignored. Set CBZ.CONFIG.PRISON_TIPS = true and every one of them comes back
  // exactly as it shipped, including the saved preference. `learned` keeps
  // being recorded either way, so turning tips on does not re-teach verbs the
  // player has already used.
  if (CBZ.CONFIG && CBZ.CONFIG.PRISON_TIPS == null) CBZ.CONFIG.PRISON_TIPS = false;
  function tipsAllowed() { return !!(CBZ.CONFIG && CBZ.CONFIG.PRISON_TIPS); }
  let learned = {}, helpOn = !(CBZ.CONFIG && CBZ.CONFIG.JAIL_SHOW_DONT_TELL !== false);
  try { learned = JSON.parse(localStorage.getItem("cbz_learned") || "{}"); } catch (e) {}
  try {
    const saved = localStorage.getItem("cbz_help");
    if (saved != null) helpOn = saved !== "0";        // an explicit choice always wins
  } catch (e) {}
  if (!tipsAllowed()) helpOn = false;
  function persist() {
    try { localStorage.setItem("cbz_learned", JSON.stringify(learned)); localStorage.setItem("cbz_help", helpOn ? "1" : "0"); } catch (e) {}
  }
  function tipsShowing() { return helpOn && !Object.keys(DESC).every((k) => learned[k]); }
  function reportTone(a) {
    if (!a || !(a.reportedPlayerT > 0) || a.reportedPlayerCred == null) return "";
    if (a.reportedPlayerCred < 0.45) return "shaky ";
    if (a.reportedPlayerCred > 0.78) return "solid ";
    return "";
  }
  /* THE READ LINE IS A THING YOU NOTICE, NOT A RECORD YOU QUERY.
     This is the strip under the actor's name on the interaction card, and it
     was printing the snitch ledger as a database row: "KNOWN SNITCH - solid
     reported to Officer #3 · cred 62% · 14s · 3 heard · visual". Same five
     facts, said the way you would say them about a man across a yard. Nothing
     is hidden — credibility, spread and freshness each still change the words. */
  function reportDetail(a) {
    const base = `${reportTone(a)}${a.reportedPlayerKind || "reported"} to ${a.reportedPlayerGuard || "a guard"}`;
    const parts = [];
    if (a.reportedPlayerCred != null) parts.push(a.reportedPlayerCred > 0.78 ? "believed" : (a.reportedPlayerCred < 0.45 ? "doubted" : "half-believed"));
    if (a.reportedPlayerT > 0) parts.push("still fresh");
    if (a.reportedPlayerSpread > 1) parts.push("word got round");
    if (a.reportedPlayerLastKnown && a.reportedPlayerLastKnown.type) parts.push(a.reportedPlayerLastKnown.type === "visual" ? "saw you himself" : "only heard it");
    return `talks to the screws. ${base}${parts.length ? " · " + parts.join(" · ") : ""}`;
  }
  function cleanName(a) {
    return a && a.data && a.data.name ? a.data.name.replace(/^the |^a |^an /, "") : "someone";
  }
  function shortText(s, max) {
    s = String(s || "");
    max = max || 28;
    return s.length > max ? s.slice(0, Math.max(0, max - 1)) + "…" : s;
  }
  function gangShort(a) {
    if (!a || a.gang == null || a.gang < 0) return "";
    const names = CBZ.GANG_NAMES || ["Reds", "Blues"];
    return (names[a.gang] || "Crew").replace(/^the /, "");
  }
  function readKindLabel(kind) {
    if (kind === "wealth") return "heard cigs";
    if (kind === "heat") return "heard heat";
    if (kind === "badge") return "heard badge";
    if (kind === "snitch") return "heard snitch";
    if (kind === "debt") return "heard debt";
    if (kind === "fear") return "heard violence";
    return kind ? "heard " + kind : "";
  }
  function actorRead(a) {
    if (!a) return "";
    if (a.kind === "warden") {
      // he cannot be bought or bent — the read is whether he is BUYING NAMES
      const w = CBZ.econ && CBZ.econ.snitchOffer ? CBZ.econ.snitchOffer(a) : "";
      const bits = [w === "" ? "buying names" : (w === "later" ? "heard enough today" : "runs the place")];
      if (a.flashlightOn) bits.push("flashlight up");
      return bits.join(" | ");
    }
    if (a.kind === "guard") {
      const guardBits = [a.corrupt ? "bent cop" : "clean guard"];
      if (a.bribed > 0) guardBits.push("bought");
      else if (a.corrupt) guardBits.push("wants payoff");
      if (a.flashlightOn) guardBits.push("flashlight up");
      return guardBits.slice(0, 3).join(" | ");
    }

    const bits = [];
    const trust = a.playerTrust || 0;
    const fear = a.playerFear || 0;
    const grudge = a.playerGrudge || 0;
    if (trust >= 8) bits.push("loyal");
    else if (trust >= 4) bits.push("trusts you");
    else if (trust <= -4) bits.push("cold");
    if (grudge >= 9) bits.push("wants payback");
    else if (grudge >= 5) bits.push("holds grudge");
    if (fear >= 9) bits.push("afraid");
    else if (fear >= 5) bits.push("wary");

    const read = a.blockRead && (a.blockRead.t || 0) > 0 ? a.blockRead : null;
    if (read && read.score > 12) {
      const src = read.source ? ` from ${shortText(read.source, 11)}` : "";
      bits.push(`${readKindLabel(read.kind)}${src}`);
    }

    if (a.gang >= 0) {
      const crew = gangShort(a);
      const standing = CBZ.gangStanding ? CBZ.gangStanding(a.gang) : 0;
      const debt = CBZ.gangDebt ? CBZ.gangDebt(a.gang) : 0;
      if (debt >= 10) bits.push(`${crew} want paying`);
      else if (standing >= 35) bits.push(`${crew} cover`);
      else if (standing <= -22) bits.push(`${crew} hostile`);
      else if (CBZ.player && CBZ.player.gang === a.gang) bits.push(`${crew} crew`);
    }

    if (!bits.length) {
      if (a.role === "dealer" || (a.data && a.data.offer)) bits.push("watching pockets");
      else if ((a.personality && a.personality.snitch) > 0.72) bits.push("talks to guards");
      else if ((a.personality && a.personality.nerve) > 0.72) bits.push("bold");
      else bits.push("neutral read");
    }
    return bits.slice(0, 3).join(" | ");
  }
  /* THE ALL-CAPS LABELS WERE A QUEST LOG WEARING A PERSON'S FACE.
     "TASK: Rough up Officer #3" · "FRIEND - Befriend to walk free" ·
     "LOVER - Romance to walk free" · "TIP TARGET - search or detain with
     cleaner cause": four category headers and two of them naming the BUTTON
     the player should press next. The state behind each is unchanged and each
     still shows — as the thing about that person that a man standing in front
     of them would actually notice. */
  function panelNote(a) {
    const priority = a.quest
      ? "waiting on you: " + a.quest.text
      : (a.approach && a.approach.msg ? a.approach.msg
        : ((a.reportedPlayerT || 0) > 0 ? reportDetail(a)
        : (CBZ.game.role === "cop" && a.copMarked > 0 ? "somebody put his name in"
        : (a.rep >= (CBZ.quests ? CBZ.quests.FRIEND : 100) ? "owes you, and knows it"
        : ""))));
    const read = actorRead(a);
    const motive = a.approach && a.approach.motive ? `motive: ${shortText(a.approach.motive, 24)}` : "";
    if (!priority) return read;
    if (motive) return `${shortText(priority, 62)} | ${motive}`;
    return priority.length < 58 && read ? `${priority} | ${read}` : priority;
  }

  function verbsFor(a) {
    // Authored prison beats can temporarily replace the warden's generic
    // bribe/loot menu without teaching this legacy interaction system about
    // campaign state. The provider returns verb ids and owns their dispatch.
    if (CBZ.cityCampaignPrisonVerbs) {
      const authored = CBZ.cityCampaignPrisonVerbs(a);
      if (authored && authored.length) return authored;
    }
    /* HELD AT GUNPOINT. A man with his hands over his head is not available
       for "insult / befriend", and the thing you CAN do to him used
       to arrive as a separate pill that popped into frame to announce he was
       frozen. He is visibly frozen; the popup and the pill both said so twice.
       So this is one more context in the list below rather than a new surface:
       the same panel, the same four keys, different verbs — which is exactly
       what happens when a man walks up with an offer. Outranks every approach
       kind because a drawn gun outranks a conversation. */
    if (a.intimidMode === "scared") return ["rob", "restrain", "release"];
    if (a.approach && a.approach.t > 0) {
      if (a.approach.kind === "gangInvite") return ["listen", "accept", "refuse"];
      if (a.approach.kind === "gangJob") return ["listen", "accept", "refuse"];
      if (a.approach.kind === "gangParley") return a.approach.cost > 0 ? ["listen", "pay", "respect", "threaten", "refuse"] : ["listen", "accept", "respect", "threaten", "refuse"];
      if (a.approach.kind === "crewBackup") return ["listen", "accept", "threaten", "refuse"];
      if (a.approach.kind === "crewDues") return ["listen", "pay", "haggle", "threaten", "refuse"];
      if (a.approach.kind === "stickUp") return ["listen", "pay", "haggle", "threaten", "refuse"];
      if (a.approach.kind === "coverStory") return ["listen", "accept", "threaten", "refuse"];
      if (a.approach.kind === "heatWarning") return ["listen", "accept", "threaten", "refuse"];
      if (a.approach.kind === "alibiDeal") return ["listen", "pay", "haggle", "threaten", "refuse"];
      if (a.approach.kind === "witnessFix") return ["listen", "pay", "haggle", "threaten", "refuse"];
      if (a.approach.kind === "recantOffer") return ["listen", "pay", "haggle", "threaten", "refuse"];
      if (a.approach.kind === "favor") return ["listen", "accept", "refuse"];
      if (a.approach.kind === "buyItem") return ["listen", "accept", "haggle", "refuse"];
      if (a.approach.kind === "copBribe") return ["listen", "accept", "warn", "detain", "refuse"];
      if (a.approach.kind === "copTip" || a.approach.kind === "copPlea") return ["listen", "accept", "refuse"];
      if (a.approach.kind === "copTaunt") return ["listen", "warn", "detain", "refuse"];
      if (a.approach.kind === "turfWarning") return ["listen", "respect", "threaten", "refuse"];
      if (a.approach.cost > 0) return ["listen", "pay", "haggle", "threaten", "refuse"];
      if (a.approach.kind === "deal" && a.data && a.data.offer) return ["listen", "trade", "refuse"];
      return ["listen", "refuse"];
    }
    // A SNITCH YOU HAVE NOT MADE IS JUST ANOTHER INMATE (JAIL_SNITCH_KNOWLEDGE,
    // entities/ai.js). These three verbs used to appear on ANY reporter, which
    // both handed the player the answer for free and made the bent guard's
    // paid name-drop worth nothing. You get them once you actually know — by
    // seeing the report happen, buying the name, or being told by your own
    // crew. Flag off (or no ai.js) → every reporter, exactly as it shipped.
    const knowsRat = CBZ.playerKnowsSnitch ? CBZ.playerKnowsSnitch(a) : (a.reportedPlayerT || 0) > 0;
    if (CBZ.game.role !== "cop" && knowsRat) {
      return ["confrontReport", "paySilence", "threatenSnitch"];   // fight = left-click
    }
    if (CBZ.game.role === "cop" && !(a.kind === "guard" || a.kind === "warden")) {
      return ["question", "warn", "detain", "search"];
    }
    /* THE WARDEN IS NOT A BENT SCREW WITH A BIGGER PRICE (owner, 2026-08-19:
       "he should not accept cigs and have options like [a guard's]... acted
       like an inmate"). He ran the corrupt-guard menu — bribe/payoff/trade —
       priced in cigarettes. His menu is now his office: SNITCH (a name for
       the heat on you — economy.js's snitch(), the one thing an inmate can
       actually sell the top of a prison), INSULT, and STEAL (the Gun-Room
       Key hunt, unchanged). Campaign beats still outrank this above. */
    if (a.kind === "warden") return ["snitch", "insult", "steal"];
    if (a.kind === "guard") {
      const gverbs = a.corrupt ? ["bribe", "payoff", "trade", "insult", "steal"] : ["bribe", "insult", "befriend", "steal"];
      if (!a.data || !a.data.offer) return gverbs.filter((v) => v !== "trade");
      return gverbs;
    }
    // FLIRT IS GONE (see economy.js). A relationship that was a rising
    // counter with dialogue rungs is not a relationship.
    const base = ["insult", "befriend"];              // fight = left-click
    if (a.data && a.data.offer) base.push("trade");                       // merchants/bent cops
    base.push("steal");                                                   // pickpocket ANYONE — lift cigs, a chain, even a key
    if (a.gang >= 0 && CBZ.player.gang == null && (a.rep || 0) >= 40) base.push("join"); // recruit you
    return base;
  }
  function subFor(a, v) {
    if (CBZ.cityCampaignPrisonSub) {
      const authored = CBZ.cityCampaignPrisonSub(a, v);
      if (authored != null) return authored;
    }
    // THE BUTTON IS ONE WORD (owner, 2026-08-19: "buttons should be one
    // word") — so the chip is where everything else lives: the PRICE on a
    // priced verb, the offer on a trade, a status word ("armed", "counting")
    // otherwise. This used to blank every priced verb because the price was
    // written into a sentence label; the sentence is aria-only now.
    /* NO METERS ON A PERSON. `"" + Math.round(a.love)` and `"♥ " + a.rep` were
       the two floating numbers in this menu — a relationship printed as a
       percentage beside somebody's face. The state is unchanged and so are the
       thresholds; what the chip shows is now the WORD for where you stand, out
       of economy.js's one social accessor so the chip and the dialogue can
       never disagree about the same person. */
    if (v === "befriend") {
      if ((a.playerGrudge || 0) >= 6) return "repair";
      const S = CBZ.econ && CBZ.econ.socialRead ? CBZ.econ.socialRead(a) : null;
      if (S) {
        if (S.busy) return "counting";           // he is not talking to you right now
        if (S.standing === "stranger") return "";
        return S.standing;                       // known / solid / friend / sour / enemy
      }
      if ((a.playerTrust || 0) >= 6) return "trust+";
      return "";
    }
    if (v === "insult") {
      if ((a.playerGrudge || 0) >= 6) return "bad blood";
      if ((a.playerFear || 0) >= 6) return "fear";
      return "";
    }
    if (v === "fight") {
      if (a.gang >= 0 && CBZ.player && CBZ.player.gang !== a.gang && (CBZ.gangStanding ? CBZ.gangStanding(a.gang) : 0) < -12) return "crew";
      if ((a.playerFear || 0) >= 7) return "scared";
      return CBZ.econ.hasItem("Shiv") ? "armed" : "";
    }
    if (v === "trade") return a.data.offer ? (CBZ.econ.offerLine ? CBZ.econ.offerLine(a) : `${a.data.offer.item}·${a.data.offer.price}`) : "";
    // A PRICE THE MENU COMPUTES SEPARATELY FROM THE TILL IS A PRICE THAT
    // LIES. economy.js's bribeCost is loyalty- and schedule-aware now (a man
    // you have already paid is cheaper; a man standing a count is dearer), so
    // the chip and the label both ask IT rather than re-deriving 25/5/10.
    if (v === "bribe") return (CBZ.econ.bribeCost ? CBZ.econ.bribeCost(a) : (a.corrupt ? 5 : 10)) + "";
    // snitch trades a name for heat — the chip is the warden's mood, straight
    // off economy.js's own gate so the chip and the refusal can never disagree
    if (v === "snitch") {
      const w = CBZ.econ.snitchOffer ? CBZ.econ.snitchOffer(a) : "";
      if (w === "count") return "counting";
      if (w === "later") return "later";
      if (w === "clean") return "no heat";
      return "-heat";
    }
    if (v === "payoff") return (CBZ.econ.payoffCost ? CBZ.econ.payoffCost(a) : Math.max(6, Math.ceil((CBZ.game.detection || 0) / 8) + Math.ceil((CBZ.game.complaints || 0) / 12) + (CBZ.game.gangJob ? 4 : 0) + (a.kind === "warden" ? 14 : 5))) + "";
    if (v === "pay") return a.approach && a.approach.cost ? a.approach.cost + "" : "";
    if (v === "paySilence") return CBZ.knownSnitchCost ? CBZ.knownSnitchCost(a) + "" : "";
    if (v === "haggle") return a.approach && a.approach.haggled ? "done" : ((a.playerTrust || 0) >= 6 ? "trust helps" : "");
    if (v === "threaten" || v === "threatenSnitch") return CBZ.playerArmed && CBZ.playerArmed() ? "armed" : "";
    if (v === "restrain") return CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Bedsheet Rope") ? "" : "needs rope";
    if (v === "confrontReport") return a.reportedPlayerCred == null ? "" : (a.reportedPlayerCred > 0.78 ? "believed" : (a.reportedPlayerCred < 0.45 ? "doubted" : "heard"));
    if (v === "question") {
      if ((a.playerTrust || 0) >= 5) return "talks";
      if ((a.playerFear || 0) >= 6) return "shaky";
      if ((a.playerGrudge || 0) >= 6) return "hostile";
      return "";
    }
    if (v === "warn") return (a.playerFear || 0) >= 5 ? "will move" : "";
    if (v === "detain") return a.copMarked > 0 || a.huntPlayer > 0 || a.aiState === "fight" ? "clean" : "risk";
    if (v === "search") return a.copMarked > 0 || a.huntPlayer > 0 || a.aiState === "fight" ? "cause" : "complaint";
    if (v === "steal") {
      if ((a.playerGrudge || 0) >= 5) return "watching";
      // THE HOUR IS PART OF THE READ. economy.js prices a lift off
      // CBZ.prisonSchedule (a count is arithmetic done with the eyes; the
      // tier after lights-out is dark), so the chip says which it is — a word
      // about the world, not the odds printed as a percentage.
      const S = CBZ.prisonSchedule;
      if (S && S.enabled()) {
        if ((a.kind === "guard" || a.kind === "warden") && (S.is("count") || S.is("secure") || S.is("wake"))) return "counting";
        if (S.is("night")) return "dark";
      }
      if (a.blockRead && a.blockRead.kind === "wealth" && (a.blockRead.t || 0) > 0) return "hot";
      return "";
    }
    if (v === "accept" && a.approach && a.approach.kind === "favor") return "+" + (a.approach.gift || 3) + "";
    if (v === "accept" && a.approach && a.approach.kind === "buyItem") return "+" + (a.approach.price || 0) + "";
    if (v === "accept" && a.approach && a.approach.kind === "copBribe") return "+" + (a.approach.price || 0) + "";
    if (v === "accept" && a.approach && a.approach.kind === "copTip") return "intel";
    if (v === "accept" && a.approach && a.approach.kind === "copPlea") return "case";
    // "RESPECT +respect" would say it twice — respect carries no chip.
    if (v === "accept" && a.approach && a.approach.kind === "gangJob") return "+" + ((a.approach.job && a.approach.job.reward) || 5) + "";
    if (v === "accept" && a.approach && a.approach.kind === "gangParley") return a.approach.parleyMode || "terms";
    if (v === "accept" && a.approach && a.approach.kind === "crewBackup") return "backup";
    if (v === "accept" && a.approach && a.approach.kind === "coverStory") return "cover";
    if (v === "accept" && a.approach && a.approach.kind === "heatWarning") return "duck";
    if (v === "accept" && a.approach && a.approach.kind === "alibiDeal") return "alibi";
    if (v === "accept" && a.approach && a.approach.kind === "gangInvite") return gangShort(a);
    if (v === "join") return gangShort(a);
    return "";
  }

  // The SPOKEN form of each option, written as a LINE ("Buy a Shiv — 8🚬").
  // Since 2026-08-19 no button prints this sentence — the button is ONE WORD
  // and this line survives as its aria-label, so a screen reader still hears
  // the whole action. Contextual + deterministic (no flicker).
  function acceptLine(a) {
    const ap = a.approach || {};
    switch (ap.kind) {
      case "favor":      return `Do the favor (+${ap.gift || 3})`;
      case "buyItem":    return `Buy it. ${ap.price || 0}`;
      case "copBribe":   return `Pocket the ${ap.price || 0}`;
      case "copTip":     return "Take the tip";
      case "copPlea":    return "Hear the plea out";
      case "gangJob":    return `Take the job (+${(ap.job && ap.job.reward) || 5})`;
      case "gangParley": return "Agree to their terms";
      case "crewBackup": return "Call in the backup";
      case "coverStory": return "Take the cover story";
      case "heatWarning":return "Duck the heat";
      case "alibiDeal":  return "Take the alibi";
      case "gangInvite": return `Join the ${(CBZ.GANG_NAMES && CBZ.GANG_NAMES[a.gang]) || "crew"}`;
      default:           return "Take the offer";
    }
  }
  function labelFor(a, v) {
    if (CBZ.cityCampaignPrisonLabel) {
      const authored = CBZ.cityCampaignPrisonLabel(a, v);
      if (authored != null) return authored;
    }
    const nm = shortText(cleanName(a), 14);
    switch (v) {
      case "insult":   return `Talk trash to ${nm}`;
      case "befriend": return (a.playerGrudge || 0) >= 6 ? `Square things with ${nm}` : ((a.rep || 0) >= 45 ? `Catch up with ${nm}` : `Chat up ${nm}`);
      case "fight":    return `Throw hands with ${nm}`;
      case "trade":    { const o = a.data && a.data.offer; return o ? `Buy ${shortText(o.item, 16)}. ${o.price}` : "Browse their goods"; }
      case "bribe":    { const c = CBZ.econ.bribeCost ? CBZ.econ.bribeCost(a) : (a.corrupt ? 5 : 10); return `Slip ${c} to look away`; }
      case "snitch":   return "Give the warden a name";
      case "payoff":   { const c = CBZ.econ.payoffCost ? CBZ.econ.payoffCost(a) : 6; return `Pay ${c} to clear your heat`; }
      case "steal":    return (a.kind === "guard" || a.kind === "warden") ? `Lift ${nm}'s keys` : `Pick ${nm}'s pocket`;
      case "join":     return `Run with the ${gangShort(a) || "crew"}`;
      case "listen":   return "Hear them out";
      case "accept":   return acceptLine(a);
      case "respect":  return "Show respect, back off";
      case "pay":      { const c = a.approach && a.approach.cost; return c ? `Pay the ${c}` : "Settle up"; }
      case "haggle":   return "Haggle them down";
      case "threaten": return (CBZ.playerArmed && CBZ.playerArmed()) ? `Pull on ${nm}` : `Threaten ${nm}`;
      case "refuse":   return "Wave them off";
      case "warn":     return `Tell ${nm} to move along`;
      case "detain":   return `Cuff ${nm}`;
      case "search":   return `Shake ${nm} down`;
      case "question": return `Question ${nm}`;
      case "confrontReport": return `Press ${nm} on the snitch`;
      case "paySilence":     { const c = CBZ.knownSnitchCost ? CBZ.knownSnitchCost(a) : 0; return `Pay ${c} to keep ${nm} quiet`; }
      case "threatenSnitch": return `Lean on ${nm} to drop it`;
      default: return (VERB[v] && VERB[v].label) || v;
    }
  }

  // ===========================================================================
  //  THE SPOKEN LINE — the gang-city dialogue look (PRISON_INTERACT_SUBTITLE)
  //
  //  hud.css's .world-subtitle is this game's ONE observed-world dialogue
  //  grammar: bottom-centre, Fredoka 700 white, 1.6px black stroke + layered
  //  shadow, NO box, safe-area-aware floor. citySay and campaign_ui already
  //  speak in it; the prison card answered every verb with a HUD hint panel
  //  instead. css/interact_touch.css reproduces that treatment under
  //  .pi-subtitle, so this file owns its own element and never reaches into a
  //  city module for one.
  // ===========================================================================
  let sayEl = null, sayLine = null, saySpeaker = null, sayT = 0, sayRank = 0;
  function ensureSay() {
    if (sayEl) return sayEl;
    sayEl = document.createElement("div");
    sayEl.id = "pinteractSay";
    sayEl.className = "pi-subtitle";
    sayEl.setAttribute("role", "status");
    sayEl.setAttribute("aria-live", "polite");
    // speaker stays in the accessible text and out of the picture, exactly the
    // split .world-subtitle-speaker makes — the observed world shows the LINE.
    sayEl.innerHTML = '<div class="pi-subtitle-speaker"></div><div class="pi-subtitle-line"></div>';
    document.body.appendChild(sayEl);
    saySpeaker = sayEl.querySelector(".pi-subtitle-speaker");
    sayLine = sayEl.querySelector(".pi-subtitle-line");
    return sayEl;
  }
  /* =========================================================================
     ONE CONVENTION FOR EVERY SPOKEN LINE IN THE PRISON

     THE BUG THIS REPLACES, exactly. The line below used to be:

         sayLine.textContent = String(msg).replace(/^[“"]|[”"]$/g, "");

     and systems/quests.js built every negotiation line as
     `${actor.data.name}: "${text}"`. The `^[“"]` alternative can NEVER match a
     string that begins with a name, so the alternation only ever fired on the
     `[”"]$` side and stripped the CLOSING quote off all four of them:

         Marcus: "Rough up Officer #3 for me.

     Name, colon, an opening quote and no close — on a surface whose speaker
     element is already carrying that same name (aria-only, because you can SEE
     who is in front of you). Two other truncators could eat a closing quote
     the same way (shortText, panelNote), and entities/guards.js had a second
     instance of the whole shape inside a HUD hint.

     THE CONVENTION, and it is enforced HERE so no caller can get it wrong:
       1. the LINE is words a person said, and nothing else;
       2. the SPEAKER's name lives in the speaker slot, never in the sentence —
          a `Name:` prefix is stripped when it names this speaker;
       3. QUOTES ARE DROPPED, both of them, always. The surface is the quote.
          Stripping is symmetric, so an unbalanced quote (the old bug's own
          output, or anything a truncator chewed) can never survive either.
     Interior quotation — a man quoting somebody else — is untouched, because
     only the first and last characters are ever considered.
     ========================================================================= */
  const QUOTE_OPEN = "“‘\"'";
  const QUOTE_CLOSE = "”’\"'";
  function speechText(who, msg) {
    let s = String(msg == null ? "" : msg).trim();
    if (!s) return "";
    // 2. drop a `Speaker:` / `the Speaker:` prefix naming the person talking
    const colon = s.indexOf(":");
    if (colon > 0 && colon <= 34) {
      const head = s.slice(0, colon).trim().toLowerCase().replace(/^(the|a|an)\s+/, "");
      const me = String(who || "").trim().toLowerCase().replace(/^(the|a|an)\s+/, "");
      if (me && head === me) s = s.slice(colon + 1).trim();
    }
    /* 3. QUOTE STRIP, AND THE ASYMMETRY IS THE WHOLE LESSON OF THE BUG.
       A leading quote is always the wrapper opening (the surface is the
       quote), so it goes — with its partner if it has one, which also cleans
       up the shipped bug's own unterminated output. A TRAILING quote with no
       opener is not a wrapper at all: it is somebody closing a quotation
       inside the sentence, and eating it is exactly the mistake the old
       `/^[“"]|[”"]$/g` made on `Officer #3 mutters, "Fine. 8 cigs."`. So a
       lone closer is left alone. Verified both ways by the phase probe. */
    for (let pass = 0; pass < 2 && s.length > 1; pass++) {
      if (QUOTE_OPEN.indexOf(s.charAt(0)) < 0) break;      // no opener -> nothing to unwrap
      const last = s.charAt(s.length - 1);
      s = s.slice(1);
      if (QUOTE_CLOSE.indexOf(last) >= 0) s = s.slice(0, -1);
      s = s.trim();
    }
    return s;
  }
  CBZ.prisonSpeechText = speechText;   // published so nothing re-derives it

  // EVERY verb result goes through here. Flag off → the legacy CBZ.flashHint
  // panel, byte-identical to what shipped.
  function sayResult(who, msg, secs, rank) {
    if (!msg) return;
    const line = speechText(who, msg);
    if (!line) return;                 // a result with nothing to SAY says nothing
    if (!subtitleOn()) { if (CBZ.flashHint) CBZ.flashHint(line, secs || 2.8); return; }
    ensureSay();
    sayRank = rank != null ? rank : SAY_ANSWER;
    saySpeaker.textContent = who || "";
    sayLine.textContent = line;
    sayEl.classList.add("show");
    sayT = secs || 2.8;
    // Enrol in hud.css's ONE subtitle ladder for the life of the line, exactly
    // the way campaign_ui.js stamps campaign-dialogue-active. Without it this
    // band and #citySpeech's resolve to the same 120px touch floor and a ped
    // bark lands character-on-character over the answer to the player's verb.
    document.body.classList.add("interact-subtitle-active");
  }
  function saySilence() {
    sayT = 0; sayRank = 0;
    if (sayEl) sayEl.classList.remove("show");
    document.body.classList.remove("interact-subtitle-active");
  }
  function tickSay(dt) {
    if (sayT <= 0) return;
    sayT -= dt;
    if (sayT <= 0) saySilence();
  }

  /* ===========================================================================
     CBZ.prisonSay(actor, line, opts) — THE ONE MOUTH IN THE PRISON.

     OWNER (2026-08-04): "Don't clear up the logic behind the HUD space wasters.
     Improve that logic, connect it all, and make it real logic, but remove it
     from the HUD."

     THE STATE THIS ANSWERS, and it is worse than a cluttered HUD. The
     JAIL_SHOW_DONT_TELL wave deleted 47 narration popups out of entities/ai.js
     — correctly; they were captions over a world that was already acting — and
     documented `CBZ.citySay` as "the sanctioned replacement: a thing a person
     SAYS goes over that person's head". Counted afterwards: 47 narrations
     dropped, ONE say() call, and that one call could not work either.
     city/social.js's say() reads `ped.pos.x` for its range gate and prison
     actors keep their position on `.group.position` and their name on
     `.data.name` — so every prison citySay threw a TypeError into the caller's
     own try/catch and returned silently. The prison has been MUTE since that
     wave: the whole gang/debt/cover/snitch simulation ran with no output at all
     except the corner HUD chips the owner is now asking to remove. Take the
     chips away first and the systems become invisible rather than diegetic.

     So the replacement is real this time, and it is not a new UI: this file
     ALREADY owns a working speech surface (`sayResult` -> .pi-subtitle, the
     shared world-subtitle grammar, enrolled in hud.css's subtitle ladder) which
     is what answers every interaction verb today. It is published here with the
     three rules ambient speech needs and verb answers never did:

       RANGE   — a line is a thing you overhear, not a broadcast. 16 u normally,
                 24 u for somebody mid-approach (they are walking at you and
                 started talking on the way, exactly like citySay's own
                 engaged-speaker slack).
       RANK    — a louder line cannot be stomped by a quieter one while it is
                 still on screen. The answer to a verb the player just pressed
                 (SAY_ANSWER) outranks a person acting on you (SAY_ACT), which
                 outranks block chatter (SAY_AMBIENT).
       SILENCE — the dead, the knocked-out and the cuffed do not talk.

     One-line adoption, degrade-safe: a caller that has no actor, or whose actor
     is out of range, gets `false` and behaves exactly as it does today. Named
     in scrolls/claude/, counted by CBZ.aiNarrationAudit().
     =========================================================================== */
  const SAY_AMBIENT = 0, SAY_ACT = 1, SAY_ANSWER = 2;
  const SAY_NEAR = 16, SAY_ENGAGED = 24;
  let saidLines = 0, sayRefused = 0;
  function actorSpot(a) {
    if (!a) return null;
    if (a.group && a.group.position) return a.group.position;
    return a.pos || null;
  }
  function prisonSay(actor, line, opts) {
    opts = opts || {};
    const rank = opts.rank != null ? +opts.rank : SAY_ACT;
    if (!line || !actor || CBZ.game.state !== "playing") { sayRefused++; return false; }
    if (actor.dead || actor.escaped || (actor.ko || 0) > 0) { sayRefused++; return false; }
    const p = actorSpot(actor);
    const P = CBZ.player;
    if (!p || !P || !P.pos) { sayRefused++; return false; }
    const lim = (actor.approach && (actor.approach.t || 0) > 0) ? SAY_ENGAGED : SAY_NEAR;
    if (Math.hypot(P.pos.x - p.x, P.pos.z - p.z) > lim) { sayRefused++; return false; }
    // a live line only yields to an equal or louder one
    if (sayT > 0 && rank < sayRank) { sayRefused++; return false; }
    sayResult(cleanName(actor), line, opts.secs || 2.2, rank);
    saidLines++;
    return true;
  }
  CBZ.prisonSay = prisonSay;
  CBZ.PRISON_SAY = { ambient: SAY_AMBIENT, act: SAY_ACT, answer: SAY_ANSWER };
  // said = lines that reached the screen; refused = calls the rules turned down
  // (out of range, downed, out-ranked). Both are diagnostics, not ratchets — the
  // ratchet that matters is CBZ.aiNarrationAudit().mute.
  CBZ.prisonSayAudit = function () {
    return { said: saidLines, refused: sayRefused, near: SAY_NEAR, engaged: SAY_ENGAGED };
  };

  // ===========================================================================
  //  THE TOUCH ROW (PRISON_INTERACT_TOUCH)
  //
  //  Anchoring is DERIVED from mobile.css's cluster, never guessed — see the
  //  arithmetic block at the top of css/interact_touch.css. All this file does
  //  is build and fill the DOM; where it lands is one CSS decision.
  // ===========================================================================
  let piRoot = null, piWho = null, piName = null, piNote = null, piTip = null;
  let piVerbs = null, piOpts = null, piSig = "", piShown = false, piQuiet = null;

  function buildTouchUI() {
    if (piRoot) return piRoot;
    piRoot = document.createElement("div");
    piRoot.id = "pinteract";
    // The containers stay separate for the compact phone fallback; tablet CSS
    // stacks both into one uninterrupted vertical rail.
    piRoot.innerHTML =
      '<div id="pinteractWho">' +
        '<span class="piw-name"></span>' +
        '<span class="piw-note"></span>' +
        '<span class="piw-tip"></span>' +
      "</div>" +
      '<div class="pi-row"><div id="pverbs"></div><div id="poptions"></div></div>';
    document.body.appendChild(piRoot);
    piWho = piRoot.querySelector("#pinteractWho");
    piName = piRoot.querySelector(".piw-name");
    piNote = piRoot.querySelector(".piw-note");
    piTip = piRoot.querySelector(".piw-tip");
    piVerbs = piRoot.querySelector("#pverbs");
    piOpts = piRoot.querySelector("#poptions");
    // Delegated so it survives every re-render. CLICK (not touchstart): a verb
    // here can be Fight / Steal / Cuff, and a press you can still slide off is
    // the right contract for those — the same call .iopt and .tpill already make.
    piRoot.addEventListener("click", function (e) {
      const b = e.target && e.target.closest ? e.target.closest("[data-pi]") : null;
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const act = b.getAttribute("data-pi");
      if (act === "tips") { tipsToggle(); return; }
      const i = parseInt(act, 10);
      if (i >= 0) doAction(i);
    });
    return piRoot;
  }

  // The capsule carries a WORD — touch.js's doctrine is that interaction
  // surfaces spell the verb out and never render a key. VERB[]
  // already owns that word; an AUTHORED campaign verb has none, so its full
  // sentence is cut at the first dash ("Take the deal — work as the warden's
  // spy" → "Take the deal") and the sentence itself lives on as the aria-label.
  function shortLabel(a, v) {
    if (v === "campaign-spy") return "Accept";
    if (v === "campaign-escape") return "Refuse";
    if (VERB[v] && VERB[v].label) return VERB[v].label;
    const raw = String(labelFor(a, v) || v);
    return shortText(raw.split(/\s+[—–-]\s+/)[0], 18);
  }
  // The status chip (price / meter / "armed") rides along; the FULL authored
  // line ("Pay 8 to keep Marcus quiet") stays on the button as its aria-label,
  // so nothing is lost — it is read out rather than printed as a wall.
  function optButton(cls, idx, a, v, subMax) {
    const sub = subFor(a, v);
    return '<button type="button" class="' + cls + '" data-pi="' + idx + '" aria-label="' +
      esc(labelFor(a, v)) + '"><span class="pi-lab">' + esc(shortLabel(a, v)) + "</span>" +
      (sub ? '<span class="pi-sub">' + esc(shortText(sub, subMax || 12)) + "</span>" : "") + "</button>";
  }
  /* Tablet row: ONE WORD ON THE BUTTON (owner, 2026-08-19: "buttons should
     be one word... don't have a steal keycard button, have a steal button").

     The last pass moved the whole authored sentence onto the button when it
     fit — "SLIP 25 TO LOOK AWAY", "LIFT WARDEN'S KEYS" — which reads as four
     lines of prose stacked on the thumb. The survival dock (systems/
     survival_interact.js: Throw / Grab / Punch / Shove) is the reference:
     the button is the VERB, full stop. The price or status rides inside it
     as the small chip ("BRIBE 25"), and the full sentence lives on as the
     aria-label so nothing is lost, only unprinted. */
  function optChoice(idx, a, v) {
    const sub = subFor(a, v);
    return '<div class="pi-choice">' +
      '<button type="button" class="pi-action" data-pi="' + idx + '" aria-label="' +
      esc(labelFor(a, v)) + '">' + esc(shortLabel(a, v).toUpperCase()) +
      (sub ? '<span class="pi-act-sub">' + esc(shortText(sub, 12)) + "</span>" : "") +
      "</button></div>";
  }

  function renderTouch(a, core, rest, rawNote) {
    buildTouchUI();
    const name = cleanName(a).toUpperCase();
    const note = shortText(rawNote, 74);
    const docked = !!(CBZ.touchInteractionDocked && CBZ.touchInteractionDocked());
    // ONE teaching line, never a wall: the first verb on offer this player has
    // never used. Tips off — or everything learned — leaves the row silent.
    let tip = "";
    if (helpOn && !docked) {
      const order = core.concat(rest);
      for (let i = 0; i < order.length; i++) {
        const v = order[i];
        if (learned[v]) continue;
        const d = (CBZ.cityCampaignPrisonDesc && CBZ.cityCampaignPrisonDesc(a, v)) || DESC[v] || "";
        if (d) { tip = shortLabel(a, v) + " — " + d; break; }
      }
    }
    let btns = "", pills = "";
    if (docked) {
      const order = core.concat(rest);
      for (let i = 0; i < order.length; i++) btns += optChoice(i, a, order[i]);
      // PRISON_TIPS off (the default): no toggle row at all. The rail is verbs.
      if (tipsAllowed()) {
        pills = '<div class="pi-choice pi-tips-choice">' +
          '<span class="pi-copy"><span class="pi-choice-label">Teaching tips</span></span>' +
          '<button type="button" class="pi-action pi-tips-action' + (helpOn ? " on" : "") +
          '" data-pi="tips" aria-label="Teaching tips ' + (helpOn ? "on" : "off") + '">' +
          (helpOn ? "TIPS ON" : "TIPS OFF") + "</button></div>";
      }
    } else {
      // ONE capsule for every verb — .svbtn, the survival dock's own class
      // (owner: "the nat disaster buttons are PERFECT — switch the style").
      // core and rest still render into their own containers because the
      // KEYBOARD cares which four are bound to I J K L; css/interact_touch.css
      // makes those containers display:contents so the thumb sees one stack.
      for (let i = 0; i < core.length; i++) btns += optButton("svbtn", i, a, core[i], 12);
      for (let i = 0; i < rest.length; i++) pills += optButton("svbtn", core.length + i, a, rest[i], 12);
      // the "[H] Tips: ON/OFF" footer, as a thing a thumb can actually reach
      if (tipsAllowed()) {
        pills += '<button type="button" class="svbtn po-tips' + (helpOn ? " on" : "") +
          '" data-pi="tips" aria-label="Teaching tips ' + (helpOn ? "on" : "off") +
          '"><span class="pi-lab">Tips</span><span class="pi-sub">' + (helpOn ? "ON" : "OFF") + "</span></button>";
      }
    }

    // renderPanel runs EVERY frame while somebody is in range; only touch the
    // DOM when what it would say actually changed.
    const sig = [name, note, tip, btns, pills].join("\u0001");
    if (sig === piSig) return;
    piSig = sig;
    piName.textContent = name;
    piNote.textContent = note;
    piNote.style.display = note ? "" : "none";
    piTip.textContent = tip;
    piTip.style.display = tip ? "" : "none";
    piVerbs.innerHTML = btns;
    piOpts.innerHTML = pills;
    // THE SPOKEN LINE HAS TO CLEAR THE DOCK. On a phone the verb stack now
    // sits at the thumb (bottom 34, like survival's) and this mode's dialogue
    // band is centred at 120 — on a 393pt screen those two share pixels. How
    // tall the stack is depends on how many verbs this actor offers, which is
    // only knowable after layout, so publish it and let css/interact_touch.css
    // lift the band by it. The iPad rail is a right-edge column that never
    // crosses the centre band, so it publishes nothing to clear.
    // the WHOLE block, name plate included — lifting the band over the buttons
    // alone drops it straight onto "BLOODY MARCUS · wary".
    setDockHeight(docked ? 0 : piRoot.getBoundingClientRect().height);
  }

  function setDockHeight(px) {
    document.documentElement.style.setProperty("--pi-dock-h", Math.round(px) + "px");
  }

  function showTouchUI(on) {
    if (on && !piRoot) return;        // nothing built yet — never latch a lie
    if (on === piShown) return;
    piShown = on;
    if (piRoot) piRoot.classList.toggle("show", on);
    if (!on) setDockHeight(0);        // nothing docked, nothing to lift over
  }
  // On touch the legacy card is replaced, not decorated: it stops rendering
  // rows entirely (so no [J]/[K]/[L]/[;] chip and no "[H]" footer can survive
  // the switch) and css/interact_touch.css collapses it. `.show` is still
  // added/removed exactly as before, because CBZ.interactionMenuOpen() — which
  // touch/controller consumers read to know whether context is live — is keyed
  // off that class and must keep meaning the same thing.
  //
  // SCOPED TO ESCAPE MODE ON PURPOSE. #interact is a SHARED element: city/
  // interactions.js raises the very same card in the open city, and there is no
  // `body.mode-escape` class to key CSS off (state.js stamps only mode-city /
  // mode-survival). A latch left on after leaving the prison would blank the
  // city's card on every iPad, so the class is driven from mode every frame
  // rather than from touchMode once.
  function syncQuiet() {
    const q = touchUI() && !!CBZ.game && CBZ.game.mode === "escape";
    if (q === piQuiet) return;
    piQuiet = q;
    el.interact.classList.toggle("pi-quiet", q);
    if (q) el.interactOpts.innerHTML = "";
  }
  // PRISON_TIPS off → [H] and every tips control are inert (there is nothing to
  // toggle and nothing drawing the state). Still exported, so a build that turns
  // the flag on gets the key back with no other edit.
  function tipsToggle() { if (!tipsAllowed()) return; helpOn = !helpOn; persist(); piSig = ""; }

  let current = null, cooldown = 0;

  function candidates() {
    const list = [];
    for (const n of CBZ.npcs) list.push(n);
    for (const g of CBZ.guards) if (g.data) list.push(g);
    return list;
  }
  function nearest() {
    let best = null, bd = RANGE * RANGE;
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    for (const a of candidates()) {
      if (a.ko > 0 || a.dead || a.escaped) continue;
      const dx = px - a.group.position.x, dz = pz - a.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = a; }
    }
    /* WHO THE PANEL IS ABOUT, WHEN A GUN IS OUT.
       This picks the CLOSEST body; systems/intimidate.js picks whoever is
       under the crosshair. Those are different selectors and they disagree
       often enough to matter: hold a man at gunpoint three metres away while
       another stands at your elbow, and the panel locks onto the elbow — so
       the verbs for the man with his hands up are unreachable, and the ones
       on screen belong to somebody who is not part of what is happening.
       The man you are pointing a gun at wins, but ONLY if he is already
       inside RANGE. That is deliberate: the panel's short reach is the
       design, not a limitation to route around. His hands go up from across
       the yard and you can read that at any distance; the things you can DO
       to a person still wait until you have walked over to him. */
    if (CBZ.intimidate && CBZ.intimidate.target) {
      const held = CBZ.intimidate.target();
      if (held && held !== best && held.group && !held.dead && !held.escaped && !(held.ko > 0) &&
          held.intimidMode === "scared") {
        const hx = px - held.group.position.x, hz = pz - held.group.position.z;
        if (hx * hx + hz * hz < RANGE * RANGE) best = held;
      }
    }
    return best;
  }

  function renderPanel(a) {
    const note = panelNote(a);
    el.interactName.textContent = cleanName(a).toUpperCase();
    el.interactNote.textContent = note;

    if (touchUI()) {
      // TOUCH: on iPad every verb becomes a vertical explained row beside
      // Reload; phones stack every verb in one .svbtn column at the thumb,
      // in the survival dock's grammar (css/interact_touch.css). NOTHING
      // this context offers is thrown away. cap4 exists because there are only four keys —
      // a thumb has no fifth key, so on touch its overflow would be UNREACHABLE
      // rather than merely unlisted, which is a different (and worse) thing.
      // _verbs keeps the four core verbs at indices 0-3, so J/K/L/; and every
      // existing doAction caller still mean exactly what they meant.
      const all = verbsFor(a);
      const core = cap4(all);
      const rest = all.filter((v) => core.indexOf(v) < 0);
      a._verbs = core.concat(rest);
      renderTouch(a, core, rest, note);
      return;
    }

    const verbs = cap4(verbsFor(a));
    a._verbs = verbs;
    const showTips = helpOn;
    const dockedTouch = !!(CBZ.touchInteractionDocked && CBZ.touchInteractionDocked());
    let html = verbs.map((v, i) => {
      const label = labelFor(a, v);
      const sub = subFor(a, v);
      const desc = (CBZ.cityCampaignPrisonDesc && CBZ.cityCampaignPrisonDesc(a, v)) || DESC[v] || "";
      if (dockedTouch) {
        // ONE WORD ON THE BUTTON — the same law as the live rail above (this
        // is the PRISON_INTERACT_TOUCH=false fallback). The status/price chip
        // rides inside it; the authored sentence is the aria-label.
        return `<div class="iopt tverb tyes" data-i="${i}">` +
          `<button type="button" class="itouch-act" aria-label="${esc(label)}">${esc(shortLabel(a, v).toUpperCase())}` +
          (sub ? `<span class="pi-act-sub">${esc(shortText(sub, 12))}</span>` : "") + `</button></div>`;
      }
      // Desktop rows obey the same grammar: the word is the option, the chip
      // is the price/status. The sentence ("Slip 25 to look away") is gone
      // from every printed surface, not just the touch ones.
      const row = `<div class="iopt" data-i="${i}"><span class="ikey">${(OPT_KEYS[i] || "").toUpperCase()}</span>` +
        `<span class="ilab">${esc(shortLabel(a, v))}</span>` +
        `<span class="isub">${esc(sub)}</span></div>`;
      // teach this button until it's been used at least once
      const tip = (showTips && !learned[v] && desc) ? `<div class="idesc">${desc}</div>` : "";
      return row + tip;
    }).join("");
    if (!dockedTouch && tipsAllowed()) html += `<div class="ihelp">[H] Tips: ${helpOn ? "ON" : "OFF"}</div>`;
    el.interactOpts.innerHTML = html;
  }

  // Interaction options live on a home-row cluster (numbers are reserved for
  // the hotbar, and I is the invariant Prison stash key). Exactly four slots:
  // J K L ;. Touch buttons retain their direct doAction indices.
  const OPT_KEYS = ["j", "k", "l", ";"];
  // contexts can offer more verbs than four slots — when they overflow, keep
  // the FOUR most important and never silently strand a game-critical verb
  // (refuse=decline, steal=lift keys/loot, trade=commerce, befriend/join/
  // romance=win+progression). Selection is by priority; menu order preserved.
  const VERB_PRIORITY = {
    refuse: 100, accept: 92, trade: 88, steal: 86, befriend: 84, confrontReport: 84,
    join: 82, paySilence: 80, snitch: 80, bribe: 78, threatenSnitch: 78, payoff: 76,
    pay: 74, detain: 72, listen: 70, search: 70, warn: 66, threaten: 64, respect: 60,
    question: 60, haggle: 50, insult: 40,
    // gunpoint pair — only ever offered together, so the cap never sees them
    rob: 96, restrain: 95, release: 94,
  };
  function cap4(v) {
    if (v.length <= 4) return v;
    const score = (x) => (VERB_PRIORITY[x] != null ? VERB_PRIORITY[x] : 55);
    const keep = v.slice().sort((a, b) => score(b) - score(a)).slice(0, 4);
    return v.filter((x) => keep.indexOf(x) >= 0);   // back to original menu order
  }
  // Exposed so touch/controller surfaces can tell when context is live.
  CBZ.interactionMenuOpen = function () { return !!(el.interact.classList.contains("show") && CBZ.game.state === "playing"); };

  function update(dt) {
    syncQuiet();
    if (CBZ.game.mode !== "escape") {
      if (current) { current = null; el.interact.classList.remove("show"); }
      showTouchUI(false);
      return;
    }
    if (cooldown > 0) cooldown -= dt;
    const a = nearest();
    if (a !== current) {
      current = a;
      if (a) { renderPanel(a); el.interact.classList.add("show"); }
      else el.interact.classList.remove("show");
    } else if (a) renderPanel(a);
    // ONE visibility decision per frame (showTouchUI is a no-op when it does
    // not change). CBZ.invOpen is systems/inventory.js's own open latch, read
    // only — the stash grid owns the whole screen while it is up.
    showTouchUI(!!(a && touchUI() && !CBZ.invOpen && CBZ.game.state === "playing"));
    if (piRoot) piRoot.classList.toggle("cool", cooldown > 0);
  }

  function doAction(idx) {
    if (!current || cooldown > 0 || CBZ.game.state !== "playing") return;
    const verbs = current._verbs || cap4(verbsFor(current));
    if (!(idx >= 0) || idx >= verbs.length) return;
    cooldown = 0.35;
    const v = verbs[idx];
    const who = cleanName(current);
    if (!learned[v]) { learned[v] = true; persist(); piSig = ""; } // seen it → stop teaching it
    const res = CBZ.cityCampaignPrisonAct && CBZ.cityCampaignPrisonAct(v, current);
    if (res && res.handled) {
      if (res.msg) sayResult(who, res.msg, 2.8);
      return;
    }
    if (!VERB[v]) return;
    const fallback = VERB[v].fn(current);
    if (fallback && fallback.msg) sayResult(who, fallback.msg, 2.8);
  }

  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "h") { tipsToggle(); return; }
    // only consume the option keys while a panel is actually up
    if (!CBZ.interactionMenuOpen()) return;
    const i = OPT_KEYS.indexOf(k);
    if (i >= 0) { e.preventDefault(); doAction(i); }
  });

  // tap/click the menu rows (mobile + mouse). delegated so it survives re-render.
  el.interactOpts.addEventListener("click", (e) => {
    const row = e.target.closest && e.target.closest(".iopt");
    if (row && row.dataset.i != null) doAction(+row.dataset.i);
  });
  CBZ.doInteract = doAction;       // touch buttons call this
  CBZ.toggleHelp = tipsToggle;

  CBZ.onUpdate(45, update);
  CBZ.onAlways(96, function (dt) {
    tickSay(dt);
    // onUpdate stops dead at the pause/title screen, so the quiet latch is
    // re-evaluated here too — a mode change that happens while paused (title →
    // city) must still hand #interact back to whoever owns it next.
    syncQuiet();
    if (CBZ.game.state !== "playing") {
      if (current) { current = null; el.interact.classList.remove("show"); }
      showTouchUI(false);
      // a line still playing when the world stops is left over from a run that
      // is no longer on screen — the subtitle goes with it.
      saySilence();
    } else if (CBZ.game.mode !== "escape") showTouchUI(false);
  });
})();
