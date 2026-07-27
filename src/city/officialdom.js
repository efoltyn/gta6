/* ============================================================
   city/officialdom.js — DEALING WITH OFFICIALS.

   THE GAP THIS CLOSES. city/officials.js has, for a long time, walked a real
   named officeholder out of a real City Hall at 09:00, given him a real
   protection detail from protection.js, kept him on the plaza 17:00-19:00 and
   walked him home. city/polity.js holds his jurisdiction's real treasury, tax
   rate and approval. city/elections.js will take his seat off him on a real
   election day, and contracts.js will sell a contract on his life bound to
   that exact sid.

   And if you walked up to him, the only verb in the game was SHOOT.

   That is the whole of this file: the NON-LETHAL half of meeting the person
   who governs the ground you are standing on. Four verbs, and every one of
   them moves a number some other system already reads:

     PETITION  — free, and it pays in INFORMATION, not in a stat nudge. You
                 get his real office, his real approval, his real term, the
                 name of the deputy who takes the seat if he dies, and the
                 live poll if a race is running. It goes to the PHONE, because
                 HUD doctrine says rich info lives there and the killfeed is
                 the only popup. Asking a politician a question and getting a
                 number moved would be a stat fiction; asking and learning
                 exactly where he stands is the real thing.
     GREASE    — a real bribe. It buys ONE favour, and both favours are real:
                 a star comes off through wanted.js's own cityReduceWanted, or
                 money moves OUT OF THE JURISDICTION'S TREASURY into your
                 pocket — the same rec.treasury polwar.js funds wars from and
                 regimes.js watches. The cost is real too: corruption rises on
                 the world-state politics record activities.js already writes,
                 and his approval takes a real shock. He will not do it twice
                 in a day, he will not do it at four stars, and he will not do
                 it for someone who has already put a gun in his face.
     ENDORSE   — while you are genuinely on the ballot, the sitting holder can
                 put his name behind you: real momentum in elections.js's real
                 scoreCandidate(). Never against himself, and never for a man
                 with sirens on him.
     LEAN ON   — the malicious twin this repo requires. Gun out, in front of a
                 funded protection detail. It works — once — and it costs a
                 real crime report, a real approval collapse and a detail that
                 now knows your face.

   WHY IT LIVES IN ITS OWN FILE: officials.js owns MINTING and SUCCESSION;
   elections.js owns the ballot; statecraft.js owns the powers you get after
   you win. None of them owns "the player walks up to a politician", and
   bolting a verb table onto any of the three would have buried it. This file
   holds no state of its own beyond per-ped cooldown stamps and reads every
   sibling through a guard, so it is a clean delete.

   Revert: CBZ.CONFIG.GOV_OFFICIALDOM = false.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game || CBZ.g || window.g;
  if (!g) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.GOV_OFFICIALDOM == null) CBZ.CONFIG.GOV_OFFICIALDOM = true;

  /* ---------------- tunables ---------------------------------------------- */
  const GREASE_COOL_MS = 300000;      // ~5 real minutes between favours, per holder
  const GREASE_BASE = 4000;           // a city seat's asking price
  const TIER_MUL = { city: 1, state: 2.4, federal: 2.4, country: 5 };
  const GRANT_MUL = 1.9;              // a bought contract pays back more than the envelope
  const CORRUPTION_PER_GREASE = 6;    // onto g.cityPolitics.corruption (worldstate's own field)
  const GREASE_APPROVAL = -2;
  const LEAN_APPROVAL = -6;
  const ENDORSE_MOMENTUM = 6;         // a SITTING holder outweighs a senator's nod
  const ENDORSE_RESPECT = 90;

  const PLAYER_SID = (CBZ.officials && CBZ.officials.PLAYER_SID) || "player";

  /* ---------------- helpers (every sibling read is guarded) --------------- */
  function nowMs() { return CBZ.now || 0; }
  function fmt$(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function stars() { return g.wanted | 0; }
  function politicsRec() {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    return (w && w.politics) || g.cityPolitics || null;
  }
  function officeRecords() {
    if (!CBZ.polity || !CBZ.polity.list) return [];
    let out = [];
    const kinds = ["city", "state", "federal", "country"];
    for (let i = 0; i < kinds.length; i++) {
      let l = null;
      try { l = CBZ.polity.list(kinds[i]); } catch (e) { l = null; }
      if (l && l.length) out = out.concat(l);
    }
    return out;
  }
  // The office this ped holds, if any. Cached on the ped with a short TTL —
  // an election can move a seat under us mid-session, so this must not be a
  // permanent stamp. Deputies count: the deputy is who inherits the seat, and
  // greasing the man who is one bullet from the chair is a real move.
  function seatOf(p) {
    if (!p || p.dead || !p._sid) return null;
    if (p._seatT && nowMs() < p._seatT) return p._seat || null;
    p._seatT = nowMs() + 4000;
    p._seat = null;
    const recs = officeRecords();
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (!r || !r.office) continue;
      if (r.office.holder === p._sid) { p._seat = { rec: r, deputy: false }; return p._seat; }
      if (r.office.deputy === p._sid) { p._seat = { rec: r, deputy: true }; }
    }
    return p._seat;
  }
  // Title, derived from the LIVE record. officials.js OWNS this derivation and
  // now exports it (contracts.js and games/government.js each carry their own
  // copy — that is the duplication, and it is not going to be four). We call
  // the owner's function and only fall back to a local mirror if this file
  // somehow loads without it; the deputy prefix is the one thing genuinely
  // ours, because officials.js has no notion of a deputy's title.
  function titleOf(rec, deputy) {
    let t;
    if (CBZ.officials && CBZ.officials.titleFor) {
      try { t = CBZ.officials.titleFor(rec); } catch (e) { t = null; }
    }
    if (!t) {
      t = "Official";
      if (!rec) return t;
      if (rec.kind === "country") t = rec.govType === "monarchy" ? "Monarch" : "President";
      else if (rec.kind === "state" || rec.kind === "federal") t = "Governor";
      else if (rec.kind === "city") t = rec.tier === "village" ? "Chief" : "Mayor";
    }
    return deputy ? "Deputy " + t : t;
  }
  function nameOf(sid) {
    if (!sid) return "Someone";
    if (sid === PLAYER_SID) {
      if (CBZ.cityPlayerName) { try { const n = CBZ.cityPlayerName(); if (n) return n; } catch (e) {} }
      return (CBZ.player && CBZ.player.name) || g.playerName || "You";
    }
    if (CBZ.officials && CBZ.officials.identityOf) {
      const idn = CBZ.officials.identityOf(sid);
      if (idn && idn.name) return idn.name;
    }
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    return (e && e.name) || "Someone";
  }
  function priceFor(seat) {
    const mul = (seat && seat.rec && TIER_MUL[seat.rec.kind]) || 1;
    const dep = seat && seat.deputy ? 0.5 : 1;      // the understudy comes cheaper
    return Math.round(GREASE_BASE * mul * dep * (1 + 0.35 * stars()));
  }
  function say(p, line, col, secs) {
    if (CBZ.citySay) { try { CBZ.citySay(p, line, col || "#cfe6ff", secs || 2.4); return; } catch (e) {} }
    if (CBZ.city && CBZ.city.note) CBZ.city.note(line, secs || 2);
  }
  function toPhone(from, text) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "news", from: from, text: text, priority: 0 }); return; } catch (e) {} }
    if (CBZ.city && CBZ.city.note) CBZ.city.note(text, 3, { from: from, app: "news" });
  }

  /* ---------------- 1. PETITION — information, not a stat nudge ----------- */
  // Everything below is the simulation's OWN live data read back at the player.
  // No number moves; that is the point. You learn exactly where this man
  // stands, which is what walking up to a politician actually buys you.
  function petition(p) {
    const seat = seatOf(p); if (!seat) return;
    const rec = seat.rec;
    const title = titleOf(rec, seat.deputy);
    const appr = Math.round(rec.approval || 0);
    const bits = [];
    bits.push(title + " of " + rec.name + " — approval " + appr + "%.");
    if (rec.taxRate != null) bits.push("Tax rate " + Math.round(rec.taxRate * 100) + "%.");
    if (rec.treasury != null) bits.push("Treasury " + fmt$(rec.treasury) + ".");
    if (rec.office && rec.office.termDay != null && CBZ.worldDay) {
      const left = rec.office.termDay - CBZ.worldDay();
      bits.push(left > 0 ? "Term runs another " + left + " day(s)." : "Term is up.");
    }
    if (rec.office && rec.office.deputy) bits.push("Deputy of record: " + nameOf(rec.office.deputy) + ".");
    // a live race is public information — this is the same poll elections.js
    // already prints to the feed, not a second copy of the maths.
    if (CBZ.elections && CBZ.elections.status) {
      let st = null; try { st = CBZ.elections.status(rec.id); } catch (e) { st = null; }
      if (st && st.candidates && st.candidates.length) {
        bits.push("On the ballot in " + (st.daysLeft != null ? st.daysLeft + " day(s)" : "this cycle") + ": " +
          st.candidates.map(function (c) { return c.name; }).join(" vs ") + ".");
        if (st.lastPoll) bits.push("Last poll " + st.lastPoll.aPct + "–" + st.lastPoll.bPct + ".");
      }
    }
    say(p, appr >= 55 ? "“Always glad to hear from a constituent.”"
      : appr >= 35 ? "“Make it quick.”"
        : "“If you're here to shout, join the queue.”", "#cfe6ff", 2.4);
    toPhone("City Desk", bits.join(" "));
  }

  /* ---------------- 2. GREASE — a real bribe for a real favour ------------ */
  function canGrease(p) {
    const seat = seatOf(p); if (!seat) return false;
    if (p._greaseBurned) return false;                 // you pulled a gun on him once
    if (stars() >= 4) return false;                    // nobody takes an envelope from a manhunt
    if (nowMs() < (p._greaseT || 0)) return false;
    if (seat.rec && seat.rec.office && seat.rec.office.holder === PLAYER_SID) return false; // that's your own seat
    return true;
  }
  // TWO favours, and the game picks the one that is actually worth something
  // right now: heat off if you are hot, money out of the public purse if you
  // are clean. Both are real; neither is invented for this file.
  function greaseFavour(seat, price) {
    const rec = seat.rec;
    if (stars() >= 1 && CBZ.cityReduceWanted) {
      CBZ.cityReduceWanted(1);
      return "a call to the precinct — one charge goes away";
    }
    const want = Math.round(price * GRANT_MUL);
    const have = Math.max(0, rec.treasury || 0);
    const paid = Math.min(want, have);
    if (paid <= 0) return null;                        // an empty treasury cannot pay you: the number is REAL
    rec.treasury = have - paid;
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(paid);
    return "a no-bid contract worth " + fmt$(paid) + " out of " + rec.name + "'s treasury";
  }
  function grease(p) {
    const seat = seatOf(p); if (!seat) return;
    const price = priceFor(seat);
    if (!(CBZ.city && CBZ.city.canAfford && CBZ.city.canAfford(price))) {
      say(p, "“That is not a serious number.”", "#ff9aa2", 2);
      return;
    }
    // A favour that cannot be delivered must not be sold, and a favour worth
    // less than the envelope must not be sold either. The treasury is a REAL
    // number that polwar.js drains and civilwar.js splits, so a broke city
    // genuinely cannot buy you off — and the honest answer is to say so, not
    // to take $4,000 and hand back the $10 that was left in the account.
    const heatRoad = stars() >= 1 && !!CBZ.cityReduceWanted;
    const purse = Math.max(0, seat.rec.treasury || 0);
    if (!heatRoad && purse <= 0) {
      say(p, "“There is nothing in the account and nothing on your record. What exactly do you want?”", "#ff9aa2", 2.8);
      return;
    }
    if (!heatRoad && purse < price) {
      say(p, "“Look at the books. " + seat.rec.name + " could not pay you what you are offering me.”", "#ff9aa2", 2.8);
      return;
    }
    if (!CBZ.city.spend(price)) return;
    const got = greaseFavour(seat, price);
    if (!got) { if (CBZ.city.addCash) CBZ.city.addCash(price); return; }   // never keep money for nothing
    p._greaseT = nowMs() + GREASE_COOL_MS;
    const pol = politicsRec();
    if (pol) pol.corruption = (pol.corruption || 0) + CORRUPTION_PER_GREASE;
    if (CBZ.approvalShock) { try { CBZ.approvalShock(seat.rec.id, GREASE_APPROVAL); } catch (e) {} }
    say(p, "“We never had this conversation.”", "#e8c84a", 2.6);
    toPhone("City Desk", "Quiet money moved through " + seat.rec.name + " — " + got + ".");
  }

  /* ---------------- 3. ENDORSE — a sitting holder's name ------------------ */
  function runLive() {
    try { return !!(CBZ.cityRun && CBZ.cityRun.live && CBZ.cityRun.live()); } catch (e) { return false; }
  }
  function canEndorse(p) {
    if (!runLive()) return false;
    const seat = seatOf(p); if (!seat) return false;
    if (p._endorsedYou) return false;
    // never against himself: if the player filed for THIS seat, the sitting
    // holder is the opponent and the ask is absurd.
    let st = null; try { st = CBZ.cityRun.state ? CBZ.cityRun.state() : null; } catch (e) { st = null; }
    if (st && st.officeId && st.officeId === seat.rec.id && !seat.deputy) return false;
    return true;
  }
  function endorse(p) {
    const seat = seatOf(p); if (!seat) return;
    if (stars() > 0) { say(p, "“Not with sirens on you.”", "#ff9aa2", 2.4); return; }
    if ((g.respect | 0) < ENDORSE_RESPECT) {
      say(p, "“I don't lend my name to people I have to look up.”", "#ff9aa2", 2.6);
      return;
    }
    p._endorsedYou = true;
    const R = CBZ.cityRun;
    if (R && R.hook && p._sid) { try { R.hook(p._sid, { kind: "endorsement", note: titleOf(seat.rec, seat.deputy) + " " + nameOf(p._sid) + " backs you publicly" }); } catch (e) {} }
    if (R && R.momentumGain) { try { R.momentumGain(ENDORSE_MOMENTUM, "a sitting officeholder's endorsement"); } catch (e) {} }
    say(p, "“I'll stand next to you once. Don't embarrass me.”", "#8fe08a", 2.8);
    toPhone("City Desk", titleOf(seat.rec, seat.deputy) + " " + nameOf(p._sid) + " has endorsed your candidacy.");
  }

  /* ---------------- 4. LEAN ON — the malicious twin ----------------------- */
  function canLean(p) {
    const seat = seatOf(p); if (!seat) return false;
    if (p._greaseBurned) return false;
    if (seat.rec && seat.rec.office && seat.rec.office.holder === PLAYER_SID) return false;
    return true;
  }
  function lean(p) {
    const seat = seatOf(p); if (!seat) return;
    const price = priceFor(seat);
    const got = greaseFavour(seat, price);             // it works. That is what makes it worth banning.
    p._greaseBurned = true;
    p._greaseT = nowMs() + GREASE_COOL_MS * 4;
    const pol = politicsRec();
    if (pol) { pol.corruption = (pol.corruption || 0) + CORRUPTION_PER_GREASE * 2; pol.scandal = (pol.scandal || 0) + 8; }
    if (CBZ.approvalShock) { try { CBZ.approvalShock(seat.rec.id, LEAN_APPROVAL); } catch (e) {} }
    // "extortion" — wanted.js's CRIME table has no "coercing a public
    // official"; crimeInfo() answers {stars:0} for an unknown id and report()
    // bails, so the "real crime report" in this file's header was a no-op.
    if (CBZ.cityCrime) CBZ.cityCrime(70, { x: p.pos.x, z: p.pos.z, type: "extortion" });
    say(p, got ? "“Take it. Take it and get out.”" : "“There is nothing left to give you!”", "#ff9aa2", 2.8);
    toPhone("City Desk", "A public official was threatened in the open. " + seat.rec.name + "'s office is not commenting.");
  }

  /* ---------------- registration (deferred; the registry parses later) ---- */
  let done = false;
  CBZ.onUpdate(38.72, function () {
    if (done || !CBZ.CONFIG.GOV_OFFICIALDOM) return;
    if (!CBZ.interactions || !CBZ.interactions.register) return;
    done = true;
    const I = CBZ.interactions;

    I.register("ped:civ", {
      id: "official-petition", slot: "j", prio: 48,
      canShow: function (p) { return !!seatOf(p); },
      label: function (p) { const s = seatOf(p); return s ? "Petition the " + titleOf(s.rec, s.deputy) : "Petition"; },
      onSelect: function (p) { petition(p); },
    });

    I.register("ped:civ", {
      id: "official-grease", slot: "k", prio: 48,
      canShow: canGrease,
      label: function (p) { const s = seatOf(p); return "Grease the wheels — " + fmt$(priceFor(s)); },
      onSelect: function (p) { grease(p); },
    });

    I.register("ped:civ", {
      id: "official-endorse", slot: "k", prio: 52,   // outranks the envelope while you're running
      canShow: canEndorse,
      label: "Ask for their endorsement",
      onSelect: function (p) { endorse(p); },
    });

    I.register("ped:civ", {
      // SLOT k, not l, and the reason matters: interact.js's gunpoint card is
      // i=Rob / j=Hostage / k=Demand ransom / l=Execute, and slot exclusivity
      // means the highest-priority passing option OWNS its key. Taking `l`
      // would delete EXECUTE from the one ped in the game somebody is paying
      // a contract to have killed. Ransom is the row worth displacing.
      id: "official-lean", slot: "k", prio: 48, bad: true, needsGunDrawn: true,
      canShow: canLean,
      label: function (p) { const s = seatOf(p); return s ? "Lean on the " + titleOf(s.rec, s.deputy) : "Lean on them"; },
      onSelect: function (p) { lean(p); },
    });
  });

  /* ---------------- probe surface + the ratchet ---------------------------
     CLAUDE.md's ratchet convention. A hardcoded `return 0` is worthless as a
     ratchet — it can never rise, so it can never warn anyone. This one is
     STRUCTURAL: each verb declares the foreign seams it moves, and audit()
     counts the verbs that declare none. Add a verb whose entire effect is a
     variable in this file and you must either list a real seam that does not
     exist (a lie a reader catches) or leave `moves` empty — and the number
     goes UP, which is the alarm. Pinned at 0.
     ------------------------------------------------------------------ */
  const VERBS = [
    { key: "petition", moves: ["CBZ.polity.get().approval/taxRate/treasury/office", "CBZ.elections.status()", "CBZ.phoneNotify"] },
    { key: "grease",   moves: ["CBZ.city.spend/addCash", "polity rec.treasury", "CBZ.cityReduceWanted", "g.cityPolitics.corruption", "CBZ.approvalShock"] },
    { key: "endorse",  moves: ["CBZ.cityRun.hook", "CBZ.cityRun.momentumGain -> elections.js scoreCandidate().momentum"] },
    { key: "lean",     moves: ["polity rec.treasury", "CBZ.cityReduceWanted", "CBZ.cityCrime -> g.heat/g.wanted", "g.cityPolitics.corruption/scandal", "CBZ.approvalShock"] },
  ];
  CBZ.officialdom = {
    seatOf: seatOf,
    titleOf: titleOf,
    price: function (p) { const s = seatOf(p); return s ? priceFor(s) : 0; },
    petition: petition, grease: grease, endorse: endorse, lean: lean,
    verbs: function () { return VERBS.slice(); },
    audit: function () {
      let hollow = 0;
      for (let i = 0; i < VERBS.length; i++) if (!VERBS[i].moves || !VERBS[i].moves.length) hollow++;
      return hollow;
    },
  };
  CBZ.officialdomAudit = CBZ.officialdom.audit;
})();
