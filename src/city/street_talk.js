/* ============================================================
   city/street_talk.js — offer engine for the YES / NO grammar.

   city/interactions.js already resolves every approach into:
       [E] YES     accept the current proposal
       [I] NO      refuse / walk it off

   This file only owns WHAT the proposal is for a stranger: one offer derived
   from live variables (your level, their level, max cash they can spare,
   job, wealth). No extra keys, no second panel.

   WORDS: only the stranger speaks, over his own head (CBZ.citySay). The old
   HUD narration ("They peel off $40. Eyes on the ground.", the player's
   look-roast one-liners, the orphaned NO branch) is deleted, not relocated.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.interactions) return;
  const g = CBZ.game;
  const I = CBZ.interactions;

  function on() { return true; }
  function bw(s) { return (CBZ.bw ? CBZ.bw(s) : String(s || "")).replace(/\{\{[^}]+\}\}/g, "****"); }
  function say(p, text, color, secs) { if (CBZ.citySay) CBZ.citySay(p, bw(text), color || "#dfe7ff", secs == null ? 2.2 : secs); }
  function sfx(n) { if (CBZ.sfx) CBZ.sfx(n); }
  function meet(p) { if (CBZ.cityMeet) CBZ.cityMeet(p); }
  function relShift(p, kind, amt) { if (CBZ.cityRelShift) try { return CBZ.cityRelShift(p, kind, amt); } catch (e) {} return 0; }
  function money(n) { n = Math.round(n || 0); return n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n; }
  function myCash() { return (g && (g.cash | 0)) || 0; }
  function spend(n) {
    if (CBZ.city && CBZ.city.spend) return CBZ.city.spend(n);
    if (g && g.cash >= n) { g.cash -= n; return true; }
    return false;
  }
  function addCash(n) {
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(n);
    else if (g) g.cash = (g.cash | 0) + (n | 0);
  }
  function lvl(a) { return CBZ.cityLevel ? CBZ.cityLevel(a) : 10; }
  function myLvl() { return CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : (CBZ.player ? lvl(CBZ.player) : 10); }
  function nowSec() {
    try { return (performance.now ? performance.now() : Date.now()) / 1000; }
    catch (e) { return Date.now() / 1000; }
  }

  // ---- offer engine -------------------------------------------------------
  function maxOfferCash(p) {
    const w = Math.max(0, Math.min(1, p.wealth || 0.2));
    const base = 5 + Math.floor(w * w * 420);
    if (p.vipLvl) return Math.max(base, 200 + (p.vipLvl | 0) * 8);
    if (p.cash != null && p.cash > 0) return Math.min(base * 2, p.cash | 0);
    return base;
  }
  function levelGap(p) { return myLvl() - lvl(p); }

  function buildOffer(p) {
    const gap = levelGap(p);
    const max = maxOfferCash(p);
    const broke = myCash() < 40;
    const richMe = myCash() >= 5000 || myLvl() >= 40;
    const pedBroke = (p.wealth || 0) < 0.28;
    let kind, amount = 0, label;

    if (gap >= 12 && max >= 15) {
      kind = "tribute";
      amount = Math.max(5, Math.floor(max * (0.35 + Math.min(0.45, gap * 0.02))));
      label = "Take " + money(amount);
    } else if (gap <= -12) {
      kind = "tax";
      amount = Math.max(10, Math.min(myCash() || 10, 20 + Math.floor((-gap) * 3)));
      label = "Pay " + money(amount);
    } else if (pedBroke && !broke && myCash() >= 25) {
      kind = "charity";
      amount = Math.min(40, Math.max(10, Math.floor(myCash() * 0.05)));
      label = "Slip " + money(amount);
    } else if (broke && max >= 20) {
      kind = "handout";
      amount = Math.max(8, Math.floor(max * 0.4));
      label = "Take " + money(amount);
    } else if (p.job && /dealer|trap|runner/i.test(p.job)) {
      kind = "deal";
      amount = Math.min(80, Math.max(20, Math.floor(max * 0.5)));
      label = "Deal " + money(amount);
    } else if (richMe && (p.wealth || 0) > 0.55) {
      kind = "flex";
      amount = 0;
      label = "Flex";
    } else {
      kind = "chat";
      amount = 0;
      label = "Talk";
    }

    return { kind, amount, max, gap, label };
  }

  function offerOf(p) {
    if (!p) return null;
    const t = nowSec();
    if (!p._streetOffer || (p._streetOffer.ttl || 0) < t) {
      p._streetOffer = buildOffer(p);
      p._streetOffer.ttl = t + 8;
    }
    return p._streetOffer;
  }

  function isStrangerish(p) {
    if (!p || p.dead || p.vendor) return false;
    if (p.surrender || p.rage || p.state === "fight" || p.state === "flee") return false;
    if (p.companion || p.recruited) return false;
    if (p.kind === "cop" || p.kind === "security") return false;
    if (p._streetDone && p._streetDone > nowSec()) return false;
    return true;
  }
  function canShow(p) { return on() && isStrangerish(p); }

  // ---- resolutions --------------------------------------------------------
  function doYes(p) {
    if (!p) return;
    meet(p);
    const o = offerOf(p) || buildOffer(p);

    if (o.kind === "tribute" || o.kind === "handout") {
      const got = Math.min(o.amount, maxOfferCash(p));
      addCash(got);
      if (p.cash != null) p.cash = Math.max(0, (p.cash | 0) - got);
      p.wealth = Math.max(0, (p.wealth || 0.2) - 0.05);
      relShift(p, "intimidated", o.kind === "tribute" ? 1 : 0.4);
      say(p, o.kind === "tribute" ? "Take it. Just go." : "Here. Get back on your feet.", "#cdeccd", 2.2);
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(o.kind === "tribute" ? 2 : 1);
      sfx("coin");
    } else if (o.kind === "tax") {
      if (spend(o.amount)) {
        if (p.cash != null) p.cash = (p.cash | 0) + o.amount;
        relShift(p, "gift", 0.3);
        say(p, "Smart.", "#ffd1c4", 2.2);
        sfx("coin");
      } else {
        relShift(p, "snubbed", 0.6);
        say(p, "Broke? Next time, then.", "#ff8a7a", 2);
      }
    } else if (o.kind === "charity") {
      if (spend(o.amount)) {
        if (p.cash != null) p.cash = (p.cash | 0) + o.amount;
        relShift(p, "gift", 1);
        say(p, "God bless. For real.", "#cdeccd", 2.2);
        if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(1);
        sfx("coin");
      }
    } else if (o.kind === "deal") {
      if (myCash() >= 15 && Math.random() < 0.55) {
        if (spend(15)) { addCash(15 + Math.floor(o.amount * 0.5)); sfx("coin"); }
      } else {
        addCash(Math.floor(o.amount * 0.35)); sfx("coin");
      }
      relShift(p, "greeted", 0.5);
      say(p, "We never met.", "#bfe0ff", 2);
      if (CBZ.cityAddStars && Math.random() < 0.08) try { CBZ.cityAddStars(1, "street deal"); } catch (e) {}
    } else if (o.kind === "flex") {
      relShift(p, "greeted", 0.7);
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(1);
      say(p, "Nice watch. Where'd you get it?", "#ffe9a8", 2.4);
    } else {
      relShift(p, "greeted", 0.5);
      say(p, ["Crazy city, huh.", "Stay dangerous.", "You look familiar."][(Math.random() * 3) | 0], "#dfe7ff", 2);
    }
    p._streetOffer = null;
    p._streetDone = nowSec() + 2.5;
  }

  // ---- register ONE proposal option (the grammar owns YES/NO keys) --------
  // High prio so this beats mug/talk fluff for plain strangers. forceYes so
  // a broke Lv.1 can still collect tribute when they somehow out-read someone,
  // and so economic offers aren't blocked by "they ignore you" standing gates.
  I.register("ped:civ", {
    id: "street-offer", slot: "e", prio: 72, forceYes: true, campaignSafe: true,
    canShow: (p) => canShow(p),
    label: (p) => {
      const o = offerOf(p);
      return o ? o.label : "Talk";
    },
    onSelect: (p) => doYes(p),
  });

  // THE CARD HEADER FOR A PERSON: his name, and in muted type what he is.
  // (The card has no note line since 2026-09-27; what he wants he SAYS, over
  // his head. This is the only "ped" describer: city/interact.js's older one
  // was shadowed by this file loading later and is gone.)
  function pedRole(p) {
    if (p.recruited || p.companion || p === g.cityPartner || p.gang === "player") return "Your crew";
    if (p.kind === "security" || p.archetype === "security") return "Security";
    if (p.gang) {
      const r = (CBZ.cityGangs || []).find(function (x) { return x.id === p.gang; });
      return r && r.name ? String(r.name).replace(/^the /i, "") : "";
    }
    return "";
  }
  I.describe("ped", function (p) {
    if (!p) return { label: "", note: "" };
    return { label: p.name || "Someone", role: pedRole(p), note: "" };
  });
  CBZ.cityPedRole = pedRole;

  CBZ.streetTalkOffer = offerOf;
  CBZ.streetTalkEnabled = on;
})();
