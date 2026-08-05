/* ============================================================
   systems/interact.js — Red Dead-style contextual prompt. Walk up to
   anyone and the options fade in beside them. Four social verbs on the
   home-row cluster (the numbers belong to the inventory hotbar):

       [I] Romance   [J] Insult   [K] Befriend   [L] Steal
       (fight is left-click / the touch trigger, never a menu row)

   Merchants, the dealer and bent cops swap a row for Trade, guards for
   Bribe / Pay off, a cop player for Question / Warn / Cuff / Search,
   and an approaching NPC replaces the lot with its own offer. Befriend
   routes through systems/quests.js (favors, rep, and the "they let you
   walk out" win); Romance is its own way out.

   ON TOUCH the whole card is REPLACED rather than restyled — on iPad,
   every choice is a vertical row docked beside Reload with its full
   explanation left and its action button right. Phones retain the compact
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
  //  This card was a keyboard artefact end to end: four [I][J][K][L] chips, a
  //  fifth verb silently DROPPED by cap4 because there were only four keys to
  //  reach it with, and an "[H] Tips: ON" footer whose only affordance was a key
  //  no tablet has. On touch it becomes:
  //    • iPad: every contextual verb in one vertical choice rail beside Reload,
  //      full explanatory text left and a 52px+ action button right;
  //    • phone: four compact primary buttons plus overflow pills, so nothing the
  //      context offers is unreachable on the narrower surface;
  //    • the actor's name / read / ONE teaching line above the row in the
  //      gang-city dialogue treatment (white Fredoka 700, black stroke, no box)
  //      instead of a panel of prose beside the NPC;
  //    • every verb RESULT spoken as a bottom-centre subtitle in that same
  //      grammar rather than a HUD hint panel (desktop gets this too — it is the
  //      one part of the ask that is not touch-specific);
  //    • a tappable TIPS pill replacing the "[H]" footer.
  //  Desktop keyboard play is untouched: same panel, same rows, same I/J/K/L.
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
    romance:  { label: "Romance",         fn: (a) => CBZ.econ.romance(a) },
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
    steal:    { label: "Steal",           fn: (a) => CBZ.econ.steal(a) },
    payoff:   { label: "Pay off",         fn: (a) => CBZ.econ.payoff(a) },
    join:     { label: "Join gang",       fn: (a) => CBZ.joinGang(a) },
    listen:   { label: "Listen",          fn: (a) => a.approach ? approachAction(a, "listen") : CBZ.econ.talk(a) },
    accept:   { label: "Accept",          fn: (a) => approachAction(a, "accept") },
    respect:  { label: "Respect",         fn: (a) => approachAction(a, "respect") },
    pay:      { label: "Pay",             fn: (a) => approachAction(a, "pay") },
    haggle:   { label: "Haggle",          fn: (a) => approachAction(a, "haggle") },
    threaten: { label: "Threaten",        fn: (a) => approachAction(a, "threaten") },
    refuse:   { label: "Refuse",          fn: (a) => approachAction(a, "refuse") },
    confrontReport: { label: "Confront",  fn: (a) => CBZ.resolveKnownSnitch ? CBZ.resolveKnownSnitch(a, "confront") : { ok: false, msg: "" } },
    paySilence: { label: "Pay silence",   fn: (a) => CBZ.resolveKnownSnitch ? CBZ.resolveKnownSnitch(a, "paySilence") : { ok: false, msg: "" } },
    threatenSnitch: { label: "Threaten",  fn: (a) => CBZ.resolveKnownSnitch ? CBZ.resolveKnownSnitch(a, "threatenSnitch") : { ok: false, msg: "" } },
    question: { label: "Question",        fn: (a) => CBZ.econ.talk(a) },
    warn:     { label: "Warn",            fn: (a) => a.approach ? approachAction(a, "warn") : warnActor(a) },
    detain:   { label: "Tackle",          fn: (a) => {
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
  };

  // one-line teaching text per verb; shown until the player has used it
  const DESC = {
    romance:  "Flirt — max it and they'll break you out",
    insult:   "Talk trash — drops rep, may start a brawl",
    fight:    "Throw hands — chain hits for a K.O. combo",
    befriend: "Do favors, build rep — friends walk you free",
    trade:    "Buy contraband with cigarettes",
    bribe:    "Spend cigs to make authority look away",
    steal:    "Lift a key, a chain, or cigs — risky if seen",
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
  function reportDetail(a) {
    const base = `${reportTone(a)}${a.reportedPlayerKind || "reported"} to ${a.reportedPlayerGuard || "a guard"}`;
    const parts = [];
    if (a.reportedPlayerCred != null) parts.push(`cred ${Math.round(a.reportedPlayerCred * 100)}%`);
    if (a.reportedPlayerT > 0) parts.push(`${Math.ceil(a.reportedPlayerT)}s`);
    if (a.reportedPlayerSpread > 0) parts.push(`${a.reportedPlayerSpread} heard`);
    if (a.reportedPlayerLastKnown && a.reportedPlayerLastKnown.type) parts.push(a.reportedPlayerLastKnown.type);
    return `KNOWN SNITCH - ${base}${parts.length ? " · " + parts.join(" · ") : ""}`;
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
    if (a.kind === "guard" || a.kind === "warden") {
      const guardBits = [];
      if (a.kind === "warden") guardBits.push("warden leverage");
      else guardBits.push(a.corrupt ? "bent cop" : "clean guard");
      if (a.bribed > 0) guardBits.push(`paid ${Math.ceil(a.bribed)}s`);
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
      if (debt >= 10) bits.push(`${crew} debt ${Math.ceil(debt)}`);
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
  function panelNote(a) {
    const priority = a.quest
      ? "TASK: " + a.quest.text
      : (a.approach && a.approach.msg ? a.approach.msg
        : ((a.reportedPlayerT || 0) > 0 ? reportDetail(a)
        : (CBZ.game.role === "cop" && a.copMarked > 0 ? "TIP TARGET - search or detain with cleaner cause"
        : (a.rep >= (CBZ.quests ? CBZ.quests.FRIEND : 100) ? "FRIEND - Befriend to walk free"
        : (a.love >= 100 ? "LOVER - Romance to walk free" : "")))));
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
    if (a.kind === "guard" || a.kind === "warden") {
      const gverbs = (a.corrupt || a.kind === "warden") ? ["bribe", "payoff", "trade", "insult", "steal"] : ["bribe", "insult", "befriend", "steal"];
      if (!a.data || !a.data.offer) return gverbs.filter((v) => v !== "trade");
      return gverbs;
    }
    const base = ["romance", "insult", "befriend"];   // fight = left-click
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
    // price / target info now lives in the label line itself — keep the sub
    // for pure STATUS only (meters, "armed", "clean/risk"), never a price echo.
    if (v === "accept" || v === "join" || v === "trade" || v === "bribe" ||
        v === "payoff" || v === "pay" || v === "paySilence" || v === "respect") return "";
    if (v === "romance") return "" + Math.round(a.love || 0);
    if (v === "befriend") {
      if ((a.playerTrust || 0) >= 6) return "trust+";
      if ((a.playerGrudge || 0) >= 6) return "repair";
      return "♥ " + (a.rep || 0);
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
    if (v === "bribe") return a.kind === "warden" ? "25" : (a.corrupt ? "5" : "10");
    if (v === "payoff") return (CBZ.econ.payoffCost ? CBZ.econ.payoffCost(a) : Math.max(6, Math.ceil((CBZ.game.detection || 0) / 8) + Math.ceil((CBZ.game.complaints || 0) / 12) + (CBZ.game.gangJob ? 4 : 0) + (a.kind === "warden" ? 14 : 5))) + "";
    if (v === "pay") return a.approach && a.approach.cost ? a.approach.cost + "" : "";
    if (v === "paySilence") return CBZ.knownSnitchCost ? CBZ.knownSnitchCost(a) + "" : "";
    if (v === "haggle") return a.approach && a.approach.haggled ? "done" : ((a.playerTrust || 0) >= 6 ? "trust helps" : "");
    if (v === "threaten" || v === "threatenSnitch") return CBZ.playerArmed && CBZ.playerArmed() ? "armed" : "";
    if (v === "confrontReport") return a.reportedPlayerCred != null ? `cred ${Math.round(a.reportedPlayerCred * 100)}%` : "";
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
      if (a.blockRead && a.blockRead.kind === "wealth" && (a.blockRead.t || 0) > 0) return "hot";
      return "";
    }
    if (v === "accept" && a.approach && a.approach.kind === "favor") return "+" + (a.approach.gift || 3) + "";
    if (v === "accept" && a.approach && a.approach.kind === "buyItem") return "+" + (a.approach.price || 0) + "";
    if (v === "accept" && a.approach && a.approach.kind === "copBribe") return "+" + (a.approach.price || 0) + "";
    if (v === "accept" && a.approach && a.approach.kind === "copTip") return "intel";
    if (v === "accept" && a.approach && a.approach.kind === "copPlea") return "case";
    if (v === "respect" && a.approach && a.approach.kind === "turfWarning") return "+respect";
    if (v === "respect" && a.approach && a.approach.kind === "gangParley") return "+respect";
    if (v === "accept" && a.approach && a.approach.kind === "gangJob") return "+" + ((a.approach.job && a.approach.job.reward) || 5) + "";
    if (v === "accept" && a.approach && a.approach.kind === "gangParley") return a.approach.parleyMode || "terms";
    if (v === "accept" && a.approach && a.approach.kind === "crewBackup") return "backup";
    if (v === "accept" && a.approach && a.approach.kind === "coverStory") return "cover";
    if (v === "accept" && a.approach && a.approach.kind === "heatWarning") return "duck";
    if (v === "accept" && a.approach && a.approach.kind === "alibiDeal") return "alibi";
    if (v === "accept" && a.approach && a.approach.kind === "gangInvite") return CBZ.GANG_NAMES ? CBZ.GANG_NAMES[a.gang] : "";
    if (v === "join") return CBZ.GANG_NAMES ? CBZ.GANG_NAMES[a.gang] : "";
    return "";
  }

  // The option label IS the action, written as a LINE ("Buy a Shiv — 8🚬"),
  // not a bare category word ("Trade"). Contextual + deterministic (no flicker).
  function acceptLine(a) {
    const ap = a.approach || {};
    switch (ap.kind) {
      case "favor":      return `Do the favor (+${ap.gift || 3})`;
      case "buyItem":    return `Buy it — ${ap.price || 0}`;
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
      case "romance":  return (a.love || 0) >= 60 ? `Get closer to ${nm}` : `Flirt with ${nm}`;
      case "insult":   return `Talk trash to ${nm}`;
      case "befriend": return (a.playerGrudge || 0) >= 6 ? `Square things with ${nm}` : ((a.rep || 0) >= 45 ? `Catch up with ${nm}` : `Chat up ${nm}`);
      case "fight":    return `Throw hands with ${nm}`;
      case "trade":    { const o = a.data && a.data.offer; return o ? `Buy ${shortText(o.item, 16)} — ${o.price}` : "Browse their goods"; }
      case "bribe":    { const c = a.kind === "warden" ? 25 : (a.corrupt ? 5 : 10); return `Slip ${c} to look away`; }
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
  // EVERY verb result goes through here. Flag off → the legacy CBZ.flashHint
  // panel, byte-identical to what shipped.
  function sayResult(who, msg, secs, rank) {
    if (!msg) return;
    if (!subtitleOn()) { if (CBZ.flashHint) CBZ.flashHint(msg, secs || 2.8); return; }
    ensureSay();
    sayRank = rank != null ? rank : SAY_ANSWER;
    saySpeaker.textContent = who || "";
    sayLine.textContent = String(msg).replace(/^[“"]|[”"]$/g, "");
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
     in docs/claude/, counted by CBZ.aiNarrationAudit().
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

  // The square button and the pill carry a WORD — touch.js's doctrine is that
  // interaction surfaces spell the verb out and never render a key. VERB[]
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
  // Tablet row: the left side says what the option actually does; the right
  // side is the thumb target. The index is still the canonical doAction index.
  // SAY IT ONCE (interactions.js's zip-tie law): a copy cell that would only
  // repeat the button's own word — label === verb, no meter, no teaching line —
  // is dropped entirely, and the button is the row.
  function optChoice(idx, a, v) {
    const label = labelFor(a, v);
    const sub = subFor(a, v);
    const desc = (CBZ.cityCampaignPrisonDesc && CBZ.cityCampaignPrisonDesc(a, v)) || DESC[v] || "";
    const detail = [sub, (helpOn && !learned[v]) ? desc : ""].filter(Boolean).join(" · ");
    const word = shortLabel(a, v).toUpperCase();
    const dup = !detail && String(label).trim().toUpperCase() === word;
    return '<div class="pi-choice">' +
      (dup ? "" :
        '<span class="pi-copy"><span class="pi-choice-label">' + esc(label) + "</span>" +
        (detail ? '<span class="pi-choice-detail">' + esc(detail) + "</span>" : "") + "</span>") +
      '<button type="button" class="pi-action" data-pi="' + idx + '" aria-label="' +
      esc(label) + '">' + esc(word) + "</button></div>";
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
          '<span class="pi-copy"><span class="pi-choice-label">Teaching tips</span>' +
          '<span class="pi-choice-detail">Explain unfamiliar actions beside their buttons</span></span>' +
          '<button type="button" class="pi-action pi-tips-action' + (helpOn ? " on" : "") +
          '" data-pi="tips" aria-label="Teaching tips ' + (helpOn ? "on" : "off") + '">' +
          (helpOn ? "TIPS ON" : "TIPS OFF") + "</button></div>";
      }
    } else {
      for (let i = 0; i < core.length; i++) btns += optButton("pv-btn", i, a, core[i], 12);
      for (let i = 0; i < rest.length; i++) pills += optButton("po-pill", core.length + i, a, rest[i], 18);
      // the "[H] Tips: ON/OFF" footer, as a thing a thumb can actually reach
      if (tipsAllowed()) {
        pills += '<button type="button" class="po-pill po-tips' + (helpOn ? " on" : "") +
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
  }

  function showTouchUI(on) {
    if (on && !piRoot) return;        // nothing built yet — never latch a lie
    if (on === piShown) return;
    piShown = on;
    if (piRoot) piRoot.classList.toggle("show", on);
  }
  // On touch the legacy card is replaced, not decorated: it stops rendering
  // rows entirely (so no [I]/[J]/[K]/[L] chip and no "[H]" footer can survive
  // the switch) and css/interact_touch.css collapses it. `.show` is still
  // added/removed exactly as before, because CBZ.interactionMenuOpen() — which
  // inventory.js and dashboard.js read to know who owns I/J/K/L — is keyed off
  // that class and must keep meaning the same thing.
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
    return best;
  }

  function renderPanel(a) {
    const note = panelNote(a);
    el.interactName.textContent = cleanName(a).toUpperCase();
    el.interactNote.textContent = note;

    if (touchUI()) {
      // TOUCH: on iPad every verb becomes a vertical explained row beside
      // Reload; phones use four compact primaries plus overflow pills. NOTHING
      // this context offers is thrown away. cap4 exists because there are only four keys —
      // a thumb has no fifth key, so on touch its overflow would be UNREACHABLE
      // rather than merely unlisted, which is a different (and worse) thing.
      // _verbs keeps the four core verbs at indices 0-3, so I/J/K/L and every
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
        const action = v === "campaign-spy" ? "ACCEPT"
          : v === "campaign-escape" ? "REFUSE"
          : String((VERB[v] && VERB[v].label) || v).toUpperCase();
        const detail = (showTips && !learned[v] && desc) ? `<span class="idesc">${desc}</span>` : "";
        // SAY IT ONCE, here too: this is the PRISON_INTERACT_TOUCH=false
        // fallback, and it must obey the same law as the live rail above.
        const dup = !sub && !detail && String(label).trim().toUpperCase() === action;
        return `<div class="iopt tverb tyes" data-i="${i}">` +
          (dup ? "" :
            `<span class="itouch-copy"><span class="ilab">${label}</span>` +
            `<span class="isub">${sub}</span>${detail}</span>`) +
          `<button type="button" class="itouch-act">${action}</button></div>`;
      }
      const row = `<div class="iopt" data-i="${i}"><span class="ikey">${(OPT_KEYS[i] || "").toUpperCase()}</span>` +
        `<span class="ilab">${label}</span>` +
        `<span class="isub">${sub}</span></div>`;
      // teach this button until it's been used at least once
      const tip = (showTips && !learned[v] && desc) ? `<div class="idesc">${desc}</div>` : "";
      return row + tip;
    }).join("");
    if (!dockedTouch && tipsAllowed()) html += `<div class="ihelp">[H] Tips: ${helpOn ? "ON" : "OFF"}</div>`;
    el.interactOpts.innerHTML = html;
  }

  // interaction options live on a home-row cluster now (numbers are reserved
  // for the inventory hotbar in every mode). EXACTLY four slots → I J K L.
  // Nothing else in the game may bind I/J/K/L; these are the interaction keys.
  const OPT_KEYS = ["i", "j", "k", "l"];
  // contexts can offer more verbs than four slots — when they overflow, keep
  // the FOUR most important and never silently strand a game-critical verb
  // (refuse=decline, steal=lift keys/loot, trade=commerce, befriend/join/
  // romance=win+progression). Selection is by priority; menu order preserved.
  const VERB_PRIORITY = {
    refuse: 100, accept: 92, trade: 88, steal: 86, befriend: 84, confrontReport: 84,
    join: 82, romance: 80, paySilence: 80, bribe: 78, threatenSnitch: 78, payoff: 76,
    pay: 74, detain: 72, listen: 70, search: 70, warn: 66, threaten: 64, respect: 60,
    question: 60, haggle: 50, insult: 40,
  };
  function cap4(v) {
    if (v.length <= 4) return v;
    const score = (x) => (VERB_PRIORITY[x] != null ? VERB_PRIORITY[x] : 55);
    const keep = v.slice().sort((a, b) => score(b) - score(a)).slice(0, 4);
    return v.filter((x) => keep.indexOf(x) >= 0);   // back to original menu order
  }
  // exposed so other systems can tell when a contextual panel owns I/J/K/L.
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
