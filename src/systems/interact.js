/* ============================================================
   systems/interact.js — Red Dead-style contextual prompt. Walk up to
   anyone and the options fade in beside them. Four social verbs,
   keys 1–4:

       [1] Romance   [2] Insult   [3] Fight   [4] Befriend / Suck-up

   Merchants, the dealer and bent cops also expose a contextual
   [5] Trade. Befriend routes through systems/quests.js (favors, rep,
   and the "they let you walk out" win); Romance is its own way out.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const el = CBZ.el;
  const RANGE = 3.6;

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
  let learned = {}, helpOn = true;
  try { learned = JSON.parse(localStorage.getItem("cbz_learned") || "{}"); } catch (e) {}
  try { helpOn = localStorage.getItem("cbz_help") !== "0"; } catch (e) {}
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
    if (CBZ.game.role !== "cop" && (a.reportedPlayerT || 0) > 0) {
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
    el.interactName.textContent = cleanName(a).toUpperCase();
    el.interactNote.textContent = panelNote(a);

    const verbs = cap4(verbsFor(a));
    a._verbs = verbs;
    const showTips = helpOn;
    let html = verbs.map((v, i) => {
      const row = `<div class="iopt" data-i="${i}"><span class="ikey">${(OPT_KEYS[i] || "").toUpperCase()}</span>` +
        `<span class="ilab">${labelFor(a, v)}</span>` +
        `<span class="isub">${subFor(a, v)}</span></div>`;
      // teach this button until it's been used at least once
      const desc = (CBZ.cityCampaignPrisonDesc && CBZ.cityCampaignPrisonDesc(a, v)) || DESC[v] || "";
      const tip = (showTips && !learned[v] && desc) ? `<div class="idesc">${desc}</div>` : "";
      return row + tip;
    }).join("");
    html += `<div class="ihelp">[H] Tips: ${helpOn ? "ON" : "OFF"}</div>`;
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
    if (CBZ.game.mode !== "escape") { if (current) { current = null; el.interact.classList.remove("show"); } return; }
    if (cooldown > 0) cooldown -= dt;
    const a = nearest();
    if (a !== current) {
      current = a;
      if (a) { renderPanel(a); el.interact.classList.add("show"); }
      else el.interact.classList.remove("show");
    } else if (a) renderPanel(a);
  }

  function doAction(idx) {
    if (!current || cooldown > 0 || CBZ.game.state !== "playing") return;
    const verbs = current._verbs || cap4(verbsFor(current));
    if (idx >= verbs.length) return;
    cooldown = 0.35;
    const v = verbs[idx];
    if (!learned[v]) { learned[v] = true; persist(); } // seen it → stop teaching it
    const res = CBZ.cityCampaignPrisonAct && CBZ.cityCampaignPrisonAct(v, current);
    if (res && res.handled) {
      if (res.msg) CBZ.flashHint(res.msg, 2.8);
      return;
    }
    if (!VERB[v]) return;
    const fallback = VERB[v].fn(current);
    if (fallback && fallback.msg) CBZ.flashHint(fallback.msg, 2.8);
  }

  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "h") { helpOn = !helpOn; persist(); return; }
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
  CBZ.toggleHelp = function () { helpOn = !helpOn; persist(); };

  CBZ.onUpdate(45, update);
  CBZ.onAlways(96, function () {
    if (CBZ.game.state !== "playing" && current) { current = null; el.interact.classList.remove("show"); }
  });
})();
