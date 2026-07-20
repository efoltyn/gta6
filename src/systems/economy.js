/* ============================================================
   systems/economy.js — cigarettes (the currency), an inventory of
   contraband items, and the four social actions every actor shares:
   TALK · TRADE · BRIBE · STEAL.

   Other modules call CBZ.econ.<action>(actor) from the interaction
   menu. Each returns a short result string for the toast/feedback.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  // contraband you can buy / sell / LOOT. value = cigarettes.
  // `tag` groups stock (goods/drugs are shop pools; valuables/tools are
  // loot-only). `rarity` drives loot odds + the pickup flourish.
  const ITEMS = {
    // --- goods (shop stock + common loot) ---
    Lighter:           { value: 4,  tag: "goods",     rarity: "common" },
    Soap:              { value: 3,  tag: "goods",     rarity: "common" },
    "Razor Blade":     { value: 6,  tag: "goods",     rarity: "common" },
    "Phone Charger":   { value: 4,  tag: "goods",     rarity: "common" },
    Shiv:              { value: 12, tag: "goods",     rarity: "uncommon" },
    "Brass Knuckles":  { value: 16, tag: "goods",     rarity: "uncommon" },
    "Energy Bar":      { value: 5,  tag: "goods",     rarity: "common" },
    "Energy Drink":    { value: 6,  tag: "goods",     rarity: "common" },
    "Burner Phone":    { value: 18, tag: "goods",     rarity: "uncommon" },
    "Burner SIM":      { value: 10, tag: "goods",     rarity: "common" },
    "Tattoo Gun":      { value: 14, tag: "goods",     rarity: "uncommon" },
    "Cigarette Carton":{ value: 22, tag: "goods",     rarity: "uncommon" },
    Ramen:             { value: 30, tag: "goods",     rarity: "rare" }, // top-shelf prison currency
    // --- drugs (dealer stock + loot) ---
    Pills:             { value: 14, tag: "drugs",     rarity: "uncommon" },
    Powder:            { value: 22, tag: "drugs",     rarity: "rare" },
    "Pruno Hooch":     { value: 9,  tag: "drugs",     rarity: "common" },
    Painkillers:       { value: 12, tag: "drugs",     rarity: "uncommon" },
    // --- tools (escape / utility loot) ---
    Lockpick:          { value: 15, tag: "tools",     rarity: "uncommon" },
    "Handcuff Key":    { value: 20, tag: "tools",     rarity: "uncommon" },
    "Bedsheet Rope":   { value: 8,  tag: "tools",     rarity: "common" },
    "Hacksaw Blade":   { value: 26, tag: "tools",     rarity: "rare" },
    "Contraband Map":  { value: 18, tag: "tools",     rarity: "uncommon" },
    // --- valuables (loot you fence for cigs) ---
    "Stolen Wallet":   { value: 12, tag: "valuables", rarity: "uncommon" },
    "Cash Roll":       { value: 35, tag: "valuables", rarity: "rare" },
    "Gold Tooth":      { value: 28, tag: "valuables", rarity: "rare" },
    "Gold Chain":      { value: 55, tag: "valuables", rarity: "epic" },
    "Luxury Watch":    { value: 70, tag: "valuables", rarity: "epic" },
    // --- keys / weapon ---
    "Gun-Room Key":    { value: 40, tag: "key",       rarity: "rare" },
    Gun:               { value: 50, tag: "key",       rarity: "epic" },
    // --- B7: catalog parity with city/economy.js's harvest-node resources +
    // tools (systems/resources.js / systems/craft.js are CITY-only — no
    // gather nodes in the yard/disaster arena — so these entries exist just
    // to keep the two item stores in sync; no shop/loot table references them
    // here, kept minimal per the task). ---
    Wood:              { value: 2,  tag: "resource",  rarity: "common" },
    Stone:             { value: 3,  tag: "resource",  rarity: "common" },
    Scrap:             { value: 4,  tag: "resource",  rarity: "common" },
    Hatchet:           { value: 40, tag: "tools",     rarity: "uncommon" },
    Pickaxe:           { value: 45, tag: "tools",     rarity: "uncommon" },
  };
  const SELLABLE = Object.keys(ITEMS).filter((k) => ITEMS[k].tag === "goods");
  const DRUGS = Object.keys(ITEMS).filter((k) => ITEMS[k].tag === "drugs");
  const VALUABLES = Object.keys(ITEMS).filter((k) => ITEMS[k].tag === "valuables");

  // pick a fresh offer from a given stock pool ("goods" | "drugs" | "fenced")
  function pickOffer(pool) {
    let list = SELLABLE;
    if (pool === "drugs") list = DRUGS;
    const item = list[Math.floor(rng() * list.length)];
    const base = ITEMS[item].value;
    const markup = pool === "fenced" ? -2 : Math.floor(rng() * 4); // thieves fence cheap
    const price = Math.max(2, base + markup);
    return { item, price, basePrice: price };
  }

  // seeded PRNG, but reseeded from Math.random each run so the prison
  // doesn't play out identically every load (no more same dead bodies).
  let _seed = (Math.floor(Math.random() * 2e9) | 1) & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function reseed() { _seed = (Math.floor(Math.random() * 2e9) | 1) & 0x7fffffff; }

  function addCigs(n) { g.cigs = Math.max(0, g.cigs + n); CBZ.el.cigText.textContent = g.cigs; }
  function addItem(name, n) {
    n = n || 1;
    g.inventory[name] = (g.inventory[name] || 0) + n;
    CBZ.refreshInventory && CBZ.refreshInventory();
  }
  function hasItem(name) { return (g.inventory[name] || 0) > 0; }
  function takeItem(name) { if (hasItem(name)) { g.inventory[name]--; CBZ.refreshInventory && CBZ.refreshInventory(); return true; } return false; }
  function nm(a) {
    const name = a && a.data && a.data.name ? a.data.name : "someone";
    return name.replace(/^the |^a |^an /, "");
  }
  function clamp100(v) { return Math.max(0, Math.min(100, v)); }
  function buzz(kind, amount, source) {
    if (!kind || !CBZ.blockRumor) return;
    const r = CBZ.blockRumor();
    r[kind] = clamp100((r[kind] || 0) + (amount || 0));
    if (source) r.last = source;
  }
  function nearbyRead(kind, strength, source, range) {
    if (!kind || strength <= 0 || !CBZ.rememberBlockRead || !CBZ.npcs || !CBZ.player) return;
    range = range || 12;
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    for (const n of CBZ.npcs) {
      if (!n || !n.group || n.dead || (n.ko || 0) > 0 || n.escaped || n.role === "merchant") continue;
      const d = Math.hypot(n.group.position.x - px, n.group.position.z - pz);
      if (d <= range) {
        const readStrength = strength * (1 - d / (range * 1.7));
        CBZ.rememberBlockRead(n, kind, readStrength, source);
        reactToRead(n, kind, readStrength);
      }
    }
  }
  function hurryApproach(actor, seconds) {
    if (!actor || actor.approach || actor.dead || (actor.ko || 0) > 0 || actor.escaped) return;
    if (actor.aiState === "fight" || actor.aiState === "snitch" || actor.huntPlayer > 0) return;
    actor.approachCD = Math.min(actor.approachCD || seconds, seconds);
  }
  function reactToRead(actor, kind, strength) {
    const p = actor.personality || {};
    const sameCrew = playerSameGang(actor);
    const protectedHere = gangProtected(actor);
    const standing = gangStanding(actor);
    const rivalCrew = CBZ.player && CBZ.player.gang != null && actor.gang >= 0 && actor.gang !== CBZ.player.gang;
    const greedy = (p.greed || 0.5) > 0.48;
    const bold = (p.nerve || 0.5) > 0.36;
    const loyal = (p.loyalty || 0.5) > 0.38;

    if (kind === "wealth" && strength > 8 && (g.cigs || 0) >= 6 && (g.lowProfileT || 0) <= 0) {
      const predator = actor.role === "thief" || actor.role === "dealer" || rivalCrew || (actor.gang >= 0 && !sameCrew && !protectedHere && standing < 8);
      if ((predator || greedy) && bold) {
        actor.playerGrudge = Math.min(14, (actor.playerGrudge || 0) + Math.min(0.45, strength * 0.018));
        hurryApproach(actor, 0.8 + rng() * 2.8);
      } else if ((sameCrew || protectedHere || standing > 24) && loyal) {
        actor.playerTrust = Math.min(14, (actor.playerTrust || 0) + Math.min(0.35, strength * 0.014));
        hurryApproach(actor, 2.2 + rng() * 3.2);
      }
    } else if (kind === "badge" && strength > 9) {
      if (actor.gang >= 0) {
        actor.playerGrudge = Math.min(14, (actor.playerGrudge || 0) + Math.min(0.35, strength * 0.012));
        if (!sameCrew || standing < 18 || greedy) hurryApproach(actor, 1.4 + rng() * 3.2);
      } else if (actor.role === "dealer" || actor.role === "thief" || (p.snitch || 0.5) > 0.62) {
        hurryApproach(actor, 2.0 + rng() * 3.5);
      }
    } else if ((kind === "snitch" || kind === "heat") && strength > 9) {
      if (sameCrew || protectedHere || standing > 24 || (actor.playerTrust || 0) > 4) {
        actor.playerTrust = Math.min(14, (actor.playerTrust || 0) + Math.min(0.30, strength * 0.012));
        hurryApproach(actor, 1.2 + rng() * 3.0);
      } else if (rivalCrew || (p.snitch || 0.5) > 0.58 || (actor.playerGrudge || 0) > 5) {
        actor.playerGrudge = Math.min(14, (actor.playerGrudge || 0) + Math.min(0.40, strength * 0.015));
        hurryApproach(actor, 1.6 + rng() * 3.0);
      }
    } else if (kind === "debt" && strength > 8 && actor.gang >= 0) {
      if (!sameCrew && !protectedHere && (standing < 12 || greedy)) {
        actor.playerGrudge = Math.min(14, (actor.playerGrudge || 0) + Math.min(0.38, strength * 0.014));
        hurryApproach(actor, 1.1 + rng() * 2.7);
      } else if ((sameCrew || protectedHere) && loyal) {
        hurryApproach(actor, 2.4 + rng() * 3.0);
      }
    }
  }
  function noteRead(kind, amount, source, range) {
    buzz(kind, amount, source);
    if (amount > 0) nearbyRead(kind, amount * 2.2, source, range);
  }
  function nudgeGang(actor, standing, debt) {
    if (!actor || actor.gang == null || actor.gang < 0) return;
    if (standing && CBZ.addGangStanding) CBZ.addGangStanding(actor.gang, standing);
    if (debt && CBZ.addGangDebt) CBZ.addGangDebt(actor.gang, debt);
  }
  function gangStanding(actor) {
    return actor && actor.gang >= 0 && CBZ.gangStanding ? CBZ.gangStanding(actor.gang) : 0;
  }
  function gangDebt(actor) {
    return actor && actor.gang >= 0 && CBZ.gangDebt ? CBZ.gangDebt(actor.gang) : 0;
  }
  function gangProtected(actor) {
    return actor && actor.gang >= 0 && CBZ.gangProtection && CBZ.gangProtection(actor.gang) > 0;
  }
  function playerSameGang(actor) {
    return actor && actor.gang >= 0 && CBZ.player && CBZ.player.gang === actor.gang;
  }
  function priceTag(reasons) {
    if (!reasons || !reasons.length) return "";
    return reasons.slice(0, 2).join(", ");
  }
  function offerPrice(actor) {
    const offer = actor && actor.data && actor.data.offer;
    if (!offer) return { price: 0, base: 0, reasons: [] };
    const base = Math.max(1, offer.basePrice || offer.price || (ITEMS[offer.item] && ITEMS[offer.item].value) || 2);
    let mod = 0;
    const reasons = [];
    const heat = g.role === "cop" ? (g.complaints || 0) : (g.detection || 0);
    const risky = actor.role === "dealer" || (offer.item && ITEMS[offer.item] && ITEMS[offer.item].tag === "drugs") || offer.item === "Shiv" || offer.item === "Burner Phone";
    if (heat > 24 && risky) {
      const n = Math.min(6, Math.ceil(heat / 24));
      mod += n; reasons.push("heat tax");
    }
    if ((g.witnessReportT || 0) > 0 || (g.lastKnown && g.lastKnown.t > 0)) {
      mod += 1; reasons.push("search risk");
    }
    if ((g.lowProfileT || 0) <= 0 && (g.cigs || 0) >= 18 && actor.role !== "merchant") {
      mod += Math.min(4, Math.ceil((g.cigs || 0) / 18)); reasons.push("cash loud");
    }

    if (actor.gang >= 0) {
      const standing = gangStanding(actor);
      const debt = gangDebt(actor);
      if (playerSameGang(actor) || gangProtected(actor) || standing > 24) {
        const cut = Math.min(6, 1 + Math.floor(Math.max(standing, 0) / 18));
        mod -= cut; reasons.push(playerSameGang(actor) ? "crew price" : "respect cut");
      } else if (standing < -12) {
        mod += Math.min(6, 1 + Math.floor(Math.abs(standing) / 16)); reasons.push("bad blood");
      }
      if (debt > 4) {
        mod += Math.min(6, Math.ceil(debt / 5)); reasons.push("debt tax");
      }
    }

    const trust = actor.playerTrust || 0;
    const grudge = actor.playerGrudge || 0;
    const fear = actor.playerFear || 0;
    if (trust > 3) { mod -= Math.min(4, Math.floor(trust / 3)); reasons.push("trust"); }
    if (grudge > 3) { mod += Math.min(5, Math.floor(grudge / 3)); reasons.push("grudge"); }
    if (fear > 5 && !risky) { mod -= Math.min(3, Math.floor(fear / 4)); reasons.push("scared"); }

    if (actor.corrupt || actor.kind === "warden") {
      const ledger = g.racketStanding || 0;
      if ((g.racketDebt || 0) > 0) { mod += Math.min(7, Math.ceil((g.racketDebt || 0) / 6)); reasons.push("racket tab"); }
      if (ledger > 8) { mod -= Math.min(4, Math.floor(ledger / 12)); reasons.push("bent trust"); }
      if (ledger < -8) { mod += Math.min(6, Math.ceil(Math.abs(ledger) / 10)); reasons.push("bent heat"); }
    }

    const price = Math.max(1, base + mod);
    return { price, base, reasons };
  }
  function offerLine(actor) {
    const offer = actor && actor.data && actor.data.offer;
    if (!offer) return "";
    const p = offerPrice(actor);
    const tag = priceTag(p.reasons);
    return `${offer.item}·${p.price}${tag ? " " + tag : ""}`;
  }
  function payoffCost(actor) {
    const heat = g.detection || 0;
    const complaints = g.complaints || 0;
    const jobCut = g.gangJob ? 4 : 0;
    let cost = Math.ceil(heat / 8) + Math.ceil(complaints / 12) + jobCut + (actor && actor.kind === "warden" ? 14 : 5);
    if (actor && (actor.corrupt || actor.kind === "warden")) {
      const ledger = g.racketStanding || 0;
      cost += Math.ceil((g.racketDebt || 0) / 8);
      if (ledger > 8) cost -= Math.min(5, Math.floor(ledger / 10));
      if (ledger < -8) cost += Math.min(7, Math.ceil(Math.abs(ledger) / 9));
      if ((g.racketProtectionT || 0) > 0) cost -= 1;
    }
    return Math.max(5, cost);
  }

  // ---------- TALK: free flavour / hints ----------
  function talk(actor) {
    const lines = actor.data.talk || ["…"];
    const line = lines[Math.floor(rng() * lines.length)];
    return { ok: true, msg: line, sfx: null };
  }

  // ---------- TRADE: buy the actor's current offer for cigarettes ----------
  function trade(actor) {
    const offer = actor.data.offer; // { item, price }
    if (!offer) return { ok: false, msg: "Nothing to trade." };
    const priced = offerPrice(actor);
    const price = priced.price;
    if (g.cigs < price) return { ok: false, msg: `Need ${price} for ${offer.item}${priceTag(priced.reasons) ? " (" + priceTag(priced.reasons) + ")" : ""}.` };
    addCigs(-price);
    addItem(offer.item, 1);
    g.trades++;
    const seller = nm(actor);
    noteRead("wealth", Math.min(11, 2 + price * 0.18), seller, 12);
    if (actor.gang >= 0) nudgeGang(actor, 1, -1);
    if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "trade", Math.max(2, Math.ceil(price / 7)), { source: "trade" });
    if (actor.corrupt || actor.kind === "guard" || actor.kind === "warden") {
      g.racketDebt = Math.max(0, Math.min(60, (g.racketDebt || 0) + Math.ceil(price * 0.10)));
      if (actor.corrupt && CBZ.addRacketStanding) CBZ.addRacketStanding(1);
      noteRead("badge", Math.min(10, 2 + price * 0.16), seller, 13);
    }
    // refresh their offer to something else next time, from their own stock
    actor.data.offer = pickOffer(actor.data.pool);
    CBZ.sfx("coin");
    const why = priceTag(priced.reasons);
    return { ok: true, msg: `Bought ${offer.item} for ${price} ${why ? " (" + why + ")" : ""}` };
  }

  // ---------- BRIBE: pay cigarettes to make a guard look away ----------
  function bribe(actor) {
    if (actor.kind === "guard" || actor.kind === "warden") {
      const cost = actor.kind === "warden" ? 25 : (actor.corrupt ? 5 : 10); // bent cops come cheap
      if (g.cigs < cost) return { ok: false, msg: `Bribe costs ${cost} .` };
      addCigs(-cost);
      actor.bribed = actor.kind === "warden" ? 22 : 14; // seconds of blindness
      actor.alert = 0;
      const who = nm(actor);
      if (actor.corrupt) {
        if (CBZ.addHeat) CBZ.addHeat(-10);
        g.racketDebt = Math.max(0, Math.min(65, (g.racketDebt || 0) + Math.max(1, Math.ceil(cost * 0.45))));
        g.racketProtectionT = Math.max(g.racketProtectionT || 0, 8 + cost);
        if (CBZ.addRacketStanding) CBZ.addRacketStanding(2);
        noteRead("badge", 8 + cost * 0.55, who, 15);
        if (CBZ.addCasePressure) CBZ.addCasePressure(4 + cost * 0.55, { type: "bribe", heardOnly: true }, actor, { corruptHold: true });
      } else {
        noteRead("heat", actor.kind === "warden" ? 5 : 3, who, 11);
      }
      CBZ.sfx("coin");
      // a generous warden bribe coughs up the gun-room key
      if (actor.kind === "warden" && !hasItem("Gun-Room Key") && rng() < 0.5) {
        addItem("Gun-Room Key", 1);
        return { ok: true, msg: "Warden looks away… and palms you a Gun-Room Key!" };
      }
      return { ok: true, msg: actor.corrupt ? `${actor.data.name} looks away. Wanted ${Math.round(g.detection || 0)}%.` : `${actor.data.name} looks the other way.` };
    }
    // inmates: a small gift earns goodwill + sometimes a free item/tip
    const cost = 3;
    if (g.cigs < cost) return { ok: false, msg: `Gift costs ${cost} .` };
    addCigs(-cost);
    actor.playerTrust = (actor.playerTrust || 0) + 1.2;
    nudgeGang(actor, 4, -2);
    if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "gift", 4, { source: "gift" });
    noteRead(actor.gang >= 0 ? "debt" : "wealth", actor.gang >= 0 ? -3 : -2, nm(actor), 10);
    if (rng() < 0.5) { const it = SELLABLE[Math.floor(rng() * 4)]; addItem(it, 1); return { ok: true, msg: `Grateful, they slip you a ${it}.` }; }
    return { ok: true, msg: actor.gang >= 0 ? `${actor.data.tip || "Thanks, friend."} Gang respect +4.` : (actor.data.tip || "Thanks, friend.") };
  }

  // ---------- PAYOFF: corrupt authority can clean up heat ----------
  function payoff(actor) {
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    if (!guardish) return { ok: false, msg: "They can't fix your wanted level." };
    if (!actor.corrupt && actor.kind !== "warden") {
      if (CBZ.addHeat) CBZ.addHeat(6);
      actor.alert = Math.max(actor.alert || 0, 1.2);
      return { ok: false, msg: `${actor.data.name} won't take a payoff.` };
    }

    const heat = g.detection || 0;
    const complaints = g.complaints || 0;
    const cost = payoffCost(actor);
    if (g.cigs < cost) return { ok: false, msg: `Payoff costs ${cost} .` };

    addCigs(-cost);
    actor.bribed = Math.max(actor.bribed || 0, actor.kind === "warden" ? 28 : 20);
    actor.alert = 0;
    actor.hunt = 0;
    if (CBZ.addHeat) CBZ.addHeat(-(26 + heat * 0.45));
    if (CBZ.addComplaint) CBZ.addComplaint(-(18 + complaints * 0.35));
    if (CBZ.reduceCasePressure) CBZ.reduceCasePressure(14 + cost * 0.9, actor.data && actor.data.name ? actor.data.name.replace(/^the |^a |^an /, "") : "");
    if (actor.corrupt) {
      g.racketProtectionT = Math.max(g.racketProtectionT || 0, 12 + cost);
      g.racketDebt = Math.max(0, (g.racketDebt || 0) - Math.ceil(cost * 0.65));
      if (CBZ.addRacketStanding) CBZ.addRacketStanding(3);
      noteRead("badge", 10 + cost * 0.35, nm(actor), 15);
      if (CBZ.addCasePressure) CBZ.addCasePressure(5 + cost * 0.28, { type: "payoff", heardOnly: true }, actor, { corruptHold: true });
    } else {
      noteRead("heat", -8, nm(actor), 10);
    }
    g.witnessReportT = Math.max(0, (g.witnessReportT || 0) - 10);
    if ((g.detection || 0) < 32) g.lastKnown = null;
    for (const gd of CBZ.guards || []) {
      if (gd.corrupt || (g.detection || 0) < 28) {
        gd.hunt = 0;
        gd.alert = Math.min(gd.alert || 0, 0.2);
        gd.investigate = null;
      }
    }
    CBZ.sfx("coin");
    return { ok: true, msg: g.role === "cop" ? `${actor.data.name} buries the complaint. Reports ${Math.round(g.complaints || 0)}%.` : `${actor.data.name} buries the paperwork. Wanted ${Math.round(g.detection || 0)}%.` };
  }

  // ---------- STEAL: risky pickpocket ----------
  function steal(actor) {
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    const chance = guardish ? 0.4 : 0.7;             // guards are harder marks
    if (rng() < chance) {
      const loot = 3 + Math.floor(rng() * (guardish ? 12 : 6));
      addCigs(loot);
      g.stealsDone = (g.stealsDone || 0) + 1;   // feeds "pull off N heists" quests
      if (actor.gang >= 0) {
        nudgeGang(actor, -8, Math.max(1, Math.floor(loot / 4)));
        if (CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "steal", 6 + Math.min(5, Math.ceil(loot / 3)), { source: "theft" });
        actor.playerGrudge = (actor.playerGrudge || 0) + 1.5;
      }
      if (guardish && actor.corrupt) {
        g.racketDebt = Math.max(0, Math.min(70, (g.racketDebt || 0) + Math.max(2, Math.ceil(loot * 0.35))));
        if (CBZ.addRacketStanding) CBZ.addRacketStanding(-5);
      }
      noteRead(guardish ? "badge" : "wealth", guardish ? 8 + loot * 0.35 : 4 + loot * 0.7, nm(actor), guardish ? 15 : 12);
      CBZ.sfx("coin");
      // pickpocket the BEST thing they're carrying (a guard's KEY, a gold
      // chain) — so it's worth doing even when you're already flush with cigs.
      let lifted = "";
      const load = rollLoadout(actor);
      if (load.items.length) {
        let bi = 0, bv = -1;
        for (let i = 0; i < load.items.length; i++) {
          const it = load.items[i];
          const val = ((ITEMS[it] && ITEMS[it].value) || 1) + (/key/i.test(it) ? 1000 : 0); // keys are the prize
          if (val > bv) { bv = val; bi = i; }
        }
        lifted = load.items.splice(bi, 1)[0]; addItem(lifted, 1);
      }
      return { ok: true, msg: lifted ? `Lifted a ${lifted}${loot ? ` + ${loot}` : ""} clean.` : `Lifted ${loot} unseen.` };
    }
    // caught in the act
    if (guardish) {
      CBZ.reportCrime(55, { type: "steal", actorRole: g.role });
      if (actor.corrupt && CBZ.addRacketStanding) CBZ.addRacketStanding(-8);
      noteRead("heat", 14, nm(actor), 16);
      actor.bribed = 0;
      CBZ.sfx("alarm");
      return { ok: false, msg: "Caught red-handed! They're onto you!" };
    }
    CBZ.reportCrime(16, { type: "steal", actorRole: g.role });
    actor.playerGrudge = (actor.playerGrudge || 0) + 2;
    if (actor.gang >= 0) nudgeGang(actor, -5, 1);
    if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "steal", 5, { source: "failed theft" });
    noteRead("snitch", 10, nm(actor), 14);
    return { ok: false, msg: "They shove you off — eyes turn your way." };
  }

  // ---------- ROMANCE: a relationship that can spring you out ----------
  function romance(actor) {
    actor.love = (actor.love || 0) + 11 + rng() * 8;
    actor.playerTrust = (actor.playerTrust || 0) + 0.7;
    if (actor.gang >= 0) nudgeGang(actor, 1, -1);
    if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "romance", 2, { source: "rapport", silent: true });
    if (actor.love >= 100) {
      CBZ.winGame("romance", actor);
      return { ok: true, msg: `${nm(actor)} can't stand to see you caged — busts you out!` };
    }
    if (rng() < 0.22) { actor.love = Math.max(0, actor.love - 7); return { ok: false, msg: `${nm(actor)} brushes you off.` }; }
    CBZ.sfx("coin");
    return { ok: true, msg: `${nm(actor)} blushes (${Math.round(actor.love)}/100)` };
  }

  // ---------- INSULT: lower rep, maybe start a fight / a hunt ----------
  function insult(actor) {
    actor.rep = Math.max(-50, (actor.rep || 0) - 15);
    actor.love = Math.max(0, (actor.love || 0) - 12);
    actor.playerGrudge = (actor.playerGrudge || 0) + 1.2;
    if (actor.gang >= 0) nudgeGang(actor, -4, 1);
    if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "insult", 4, { source: "insult" });
    noteRead("fear", 3, nm(actor), 11);
    if (rng() < 0.5) {
      if (actor.kind === "guard" || actor.kind === "warden") { actor.hunt = 3; CBZ.addHeat(25); }
      else if (CBZ.provokeGang) CBZ.provokeGang(actor, 10);
      return { ok: false, msg: `${nm(actor)} squares up — you've made an enemy!` };
    }
    return { ok: true, msg: `${nm(actor)} scowls at you. (rep ${actor.rep})` };
  }

  // ---------- BEAT UP / FIGHT: knock an actor out (drives most quests) ----------
  // KO'd actors lie down, stop their AI, and (if a guard) go blind for a while.
  g.koLog = g.koLog || {};                     // { actorName: timestampish } recently downed
  function beat(actor) {
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    // throwing hands has consequences either way: guards hunt, gangs retaliate
    if (guardish) actor.hunt = 3;
    else if (CBZ.provokeGang) CBZ.provokeGang(actor, 12);
    const armed = hasItem("Shiv");
    let chance = guardish ? 0.45 : 0.8;
    if (armed) chance += 0.2;                   // a shiv makes you scary
    if (actor.bribed > 0) chance += 0.15;       // already off-guard
    if (rng() < Math.min(chance, 0.95)) {
      actor.ko = guardish ? 16 : 10;            // seconds down
      actor.hp = Math.max(actor.hp || 0, guardish ? 55 : 45);
      actor.alert = 0;
      g.koLog[actor.data.name] = true;          // any "beat up X" quest can now complete
      g.kos = (g.kos || 0) + 1;
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(actor, "beat");
      CBZ.sfx("door");
      CBZ.reportCrime(guardish ? 26 : 16, { type: "melee", actorRole: g.role });       // a brawl only heats up if witnessed
      noteRead(guardish ? "badge" : "fear", guardish ? 18 : 14, nm(actor), guardish ? 18 : 15);
      if (actor.gang >= 0) nudgeGang(actor, -10, 2);
      if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "ko", 9, { source: "beatdown" });
      if (guardish && actor.corrupt) g.racketDebt = Math.max(0, Math.min(80, (g.racketDebt || 0) + 4));
      if (guardish && rng() < 0.5 && !hasItem("Gun-Room Key") && actor.kind === "warden") addItem("Gun-Room Key", 1);
      // a downed mark often drops loot
      if (rng() < 0.6) addCigs(2 + Math.floor(rng() * 6));
      if (CBZ.knockback) CBZ.knockback(actor, CBZ.player.pos.x, CBZ.player.pos.z, 0.9);
      return { ok: true, msg: `You laid out ${actor.data.name}!`, beat: actor.data.name };
    }
    // whiffed it
    CBZ.reportCrime(guardish ? 40 : 14, { type: "melee", actorRole: g.role });
    noteRead(guardish ? "heat" : "fear", guardish ? 14 : 8, nm(actor), 14);
    if (actor.gang >= 0) nudgeGang(actor, -4, 1);
    if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "attack", 4, { source: "swing" });
    actor.alert = guardish ? 2.5 : 0;
    return { ok: false, msg: `${actor.data.name} fights back — bad idea!` };
  }

  // ---------- ambient: thief inmates lift cigs off you when close ----------
  // called by entities/npc.js for role:"thief" actors.
  function thiefTick(actor, dt, distToPlayer) {
    if (actor.bribed > 0) return null;          // bribed thieves leave you be
    if (actor.gang >= 0) {
      const sameCrew = CBZ.player && CBZ.player.gang === actor.gang;
      const protectedHere = CBZ.gangProtection && CBZ.gangProtection(actor.gang) > 0;
      const standing = CBZ.gangStanding ? CBZ.gangStanding(actor.gang) : 0;
      if ((sameCrew || protectedHere) && standing > -15) return null;
    }
    if ((actor.playerTrust || 0) > 5 && (actor.playerGrudge || 0) < 4) return null;
    actor._cd = (actor._cd || 0) - dt;
    if (distToPlayer > 3.2 || actor._cd > 0) return null;
    const grudgeRush = Math.max(0, actor.playerGrudge || 0) * 0.18;
    const covered = (g.lowProfileT || 0) > 0;
    actor._cd = Math.max(2.2, (g.cigs >= 16 ? 3.5 : 6) + (covered ? 4.5 : 0) - grudgeRush) + rng() * 5; // money makes you a louder target
    if (g.cigs <= 0) return null;
    if (covered && rng() < 0.62) return null;
    const taken = Math.min(g.cigs, Math.max(1, (covered ? 1 : 2) + Math.floor(rng() * (covered ? 2 : 4))));
    addCigs(-taken);
    actor._loot = (actor._loot || 0) + taken;   // they'll "sell it all for cigs" later (flavour)
    actor.playerGrudge = (actor.playerGrudge || 0) + 0.7;
    noteRead("wealth", Math.min(8, 2 + taken * 1.4), nm(actor), 10);
    CBZ.sfx("jump");
    return `A thief swiped ${taken} from your pocket!`;
  }

  // ---------- LOADOUTS: what each actor is realistically carrying ----------
  // Generated once per actor and remembered, so a dealer always has product,
  // a fighter has a shank, the warden is loaded — and you loot exactly that.
  function rollLoadout(actor) {
    if (actor.loadout) return actor.loadout;
    const items = [];
    const role = actor.role;
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    const fight = (actor.ratings && actor.ratings.fighting) || 40;
    let cigs = 1 + Math.floor(rng() * 5);
    const add = (n) => items.push(n);
    const maybe = (n, p) => { if (rng() < p) add(n); };

    if (guardish) {
      cigs += 4 + Math.floor(rng() * 9);
      maybe("Handcuff Key", 0.6); maybe("Cash Roll", 0.35); maybe("Burner Phone", 0.3); maybe("Painkillers", 0.3);
      if (actor.corrupt) { maybe("Cash Roll", 0.6); maybe("Burner SIM", 0.4); maybe("Gold Tooth", 0.2); }
      // Guns are a CITY thing now — the jail is mostly shivs and fists. The
      // warden still rarely carries one, but firearms moved out to the streets.
      if (actor.kind === "warden") { cigs += 22; maybe("Gun-Room Key", 0.7); maybe("Luxury Watch", 0.5); maybe("Gold Chain", 0.35); maybe("Gun", 0.05); }
    } else if (role === "dealer") {
      cigs += 6 + Math.floor(rng() * 12);
      add(rng() < 0.5 ? "Powder" : "Pills"); maybe("Pruno Hooch", 0.5); maybe("Painkillers", 0.4);
      maybe("Burner Phone", 0.6); maybe("Cash Roll", 0.5); maybe("Gold Tooth", 0.22);
    } else if (role === "thief") {
      cigs += 3 + Math.floor(rng() * 8);
      maybe("Stolen Wallet", 0.7); maybe("Lockpick", 0.5); maybe("Burner SIM", 0.3);
      maybe("Luxury Watch", 0.12); maybe("Gold Chain", 0.12); maybe("Cash Roll", 0.2);
    } else if (role === "merchant") {
      cigs += 4 + Math.floor(rng() * 10);
      maybe("Ramen", 0.5); maybe("Cigarette Carton", 0.5); maybe("Energy Bar", 0.5); maybe("Lighter", 0.5); maybe("Cash Roll", 0.3);
    } else { // generic inmate — flavoured by how hard they are
      if (fight > 72) { maybe("Shiv", 0.6); maybe("Brass Knuckles", 0.4); }
      else if (fight > 50) maybe("Shiv", 0.3);
      maybe("Pruno Hooch", 0.3); maybe("Cigarette Carton", 0.2); maybe("Tattoo Gun", 0.15);
      maybe("Bedsheet Rope", 0.2); maybe("Lighter", 0.3); maybe("Soap", 0.2); maybe("Contraband Map", 0.1);
    }
    if (actor.gang >= 0) { cigs += 2 + Math.floor(rng() * 6); maybe("Shiv", 0.4); maybe("Cash Roll", 0.25); maybe("Burner SIM", 0.2); }
    // a rare jackpot on anyone
    if (rng() < 0.06) add(VALUABLES[Math.floor(rng() * VALUABLES.length)]);

    actor.loadout = { cigs, items };
    return actor.loadout;
  }

  // Loot a downed/KO'd actor: grant everything they carry, once, with a
  // flourish. pickpocket=partial-and-repeatable; otherwise it's a full frisk.
  function lootActor(actor, opts) {
    opts = opts || {};
    if (!actor || actor.looted) return null;
    const load = rollLoadout(actor);
    let cigs = 0; const got = [];
    if (opts.pickpocket) {
      cigs = Math.min(load.cigs, 1 + Math.floor(rng() * 4));
      load.cigs -= cigs; if (cigs) addCigs(cigs);
      if (load.items.length && rng() < 0.5) { const it = load.items.splice(Math.floor(rng() * load.items.length), 1)[0]; addItem(it, 1); got.push(it); }
    } else {
      actor.looted = true;
      cigs = load.cigs; if (cigs) addCigs(cigs);
      for (const it of load.items) { addItem(it, 1); got.push(it); }
      load.items.length = 0; load.cigs = 0;
    }
    if (!opts.silent && (cigs > 0 || got.length)) {
      const parts = [];
      if (cigs > 0) parts.push(cigs + "");
      parts.push(...got);
      if (parts.length) {
        CBZ.flashHint && CBZ.flashHint("Looted: " + parts.join(", "), 2.2);
        CBZ.sfx && CBZ.sfx("loot");
        const rare = got.find((n) => ITEMS[n] && (ITEMS[n].rarity === "rare" || ITEMS[n].rarity === "epic"));
        if (rare) { CBZ.flashToast && CBZ.flashToast(rare.toUpperCase() + "!"); CBZ.sfx && CBZ.sfx("key"); }
      }
    }
    return { cigs, items: got };
  }

  CBZ.econ = { talk, trade, bribe, payoff, steal, beat, romance, insult, thiefTick, addCigs, addItem, hasItem, takeItem, pickOffer, offerPrice, offerLine, payoffCost, rollLoadout, lootActor, ITEMS, SELLABLE, DRUGS, VALUABLES, rng, reseed };
})();
