/* ============================================================
   city/wealth.js — THE EMPIRE & ENDGAME LAYER for the super-rich.

   Money has to MATTER once you're loaded, or the climb is pointless.
   This file is the "what do I do with all this cash" content:

     1) BUSINESSES — buyable fronts that print PASSIVE income every tick and
        LAUNDER dirty street cash clean (GTA nightclub / arcade / car-wash
        money-front model). Each has tiers/upgrades so income SCALES, and a
        "supply" pool that fills passively and you periodically COLLECT.
     2) LUXURY / STATUS — mansions, yachts, supercars, jewellery, bottle
        service: elastic money-sinks that buy RESPECT, NOTORIETY and a flashy
        lifestyle. The richer you are, the more they cost (so a whale keeps
        bleeding) and the more flex they grant.
     3) WEALTH TIERS & PERKS — your NET WORTH (computed in economy.js) places
        you in a tier; each tier unlocks real perks: VIP venue access, fatter
        passive multipliers, cheaper bribes/laundering, a discount on luxury.
     4) HIGH-STAKES OPPORTUNITIES — heists / investments only the rich can
        front the capital for, with big risk and bigger reward.

   It reuses economy.js's netWorth / TIERS / tierProgress / SINKS / launder /
   scoreReward (does NOT redefine them) and persists everything durably via
   CBZ.cityWorldEnsure().assets.businesses + a wealth ledger.

   UI: an "EMPIRE" overlay. Opened with Shift+B (B is taken solo, the chord is
   free and no other module uses chords) or via CBZ.cityOpenWealth(); also
   reachable by talking to the casino/club vendor (interact.js calls in).

   Exposes: CBZ.cityWealth, CBZ.cityOpenWealth, CBZ.cityBizIncome (the per-tick
   faucet other modules can read), CBZ.cityFlexLevel, CBZ.cityWealthReset.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const econ = (CBZ && CBZ.cityEcon) || null;   // may not be ready at parse; re-read lazily

  // ---- tiny utils -----------------------------------------------------------
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function money(n) { n = Math.round(n || 0); const neg = n < 0; n = Math.abs(n); return (neg ? "-$" : "$") + n.toLocaleString(); }
  function rng() { return (CBZ.cityEcon && CBZ.cityEcon.rng) ? CBZ.cityEcon.rng() : Math.random(); }
  function now() { return CBZ.now || 0; }
  function E() { return CBZ.cityEcon || econ || {}; }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); }
  function sfx(n) { if (CBZ.sfx) try { CBZ.sfx(n); } catch (e) {} }

  // pull `amt` from cash first, then bank (the zillow charge() convention, so
  // a baller can close a big purchase out of banked money). Returns success.
  function charge(amt) {
    amt = Math.round(amt);
    if (((g.cash || 0) + (g.cityBank || 0)) < amt) return false;
    let owe = amt; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
    if (owe > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - owe);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return true;
  }
  function canAfford(amt) { return ((g.cash || 0) + (g.cityBank || 0)) >= amt; }

  function netWorth() { const e = E(); return e.netWorth ? e.netWorth() : ((g.cash || 0) + (g.cityBank || 0)); }
  function wealthTier() { const e = E(); return e.wealthTier ? e.wealthTier() : { id: "broke", name: "Broke", min: 0, color: "#8a93a3" }; }
  function tierIndex() { const e = E(); if (!e.TIERS) return 0; return e.TIERS.indexOf(wealthTier()); }

  // ============================================================
  //  PERSISTENT STATE  (lazy-init on g.*, mirrored to cityWorld)
  // ============================================================
  // g.cityEmpireBiz : { [id]: { tier, supply, lastTick } }  owned businesses
  // g.cityLuxury    : { [id]: count|true }                  owned luxury assets
  // g.cityWealthLog : { laundered, passiveEarned, flexSpent, opsDone }
  function state() {
    if (!g.cityEmpireBiz) g.cityEmpireBiz = {};
    if (!g.cityLuxury) g.cityLuxury = {};
    if (!g.cityWealthLog) g.cityWealthLog = { laundered: 0, passiveEarned: 0, flexSpent: 0, opsDone: 0 };
    if (g.cityFlexBonus == null) g.cityFlexBonus = 0;   // cached respect-flavour from owned luxury
    return g;
  }
  function persist() {
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w || !w.assets) return;
    const out = [];
    for (const id in g.cityEmpireBiz) {
      const b = g.cityEmpireBiz[id], def = BIZ_BY_ID[id]; if (!def) continue;
      out.push({ id, name: def.name, tier: b.tier | 0, value: bizValue(id) });
    }
    w.assets.businesses = out;
    // luxury lives in our own ledger field so it survives runs too
    w.luxury = JSON.parse(JSON.stringify(g.cityLuxury || {}));
    if (w.economy) w.economy.laundering = (g.cityWealthLog && g.cityWealthLog.laundered) || 0;
  }
  // restore from the durable ledger on first ensure of a run
  function hydrate() {
    state();
    if (g._wealthHydrated) return;
    g._wealthHydrated = true;
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w) return;
    if (w.assets && w.assets.businesses) {
      for (const rec of w.assets.businesses) {
        if (!BIZ_BY_ID[rec.id]) continue;
        if (!g.cityEmpireBiz[rec.id]) g.cityEmpireBiz[rec.id] = { tier: rec.tier | 0, supply: 0, lastTick: now() };
      }
    }
    if (w.luxury) { for (const k in w.luxury) g.cityLuxury[k] = w.luxury[k]; }
    recomputeFlex();
  }

  // ============================================================
  //  1) BUSINESSES — passive faucet + dirty-money laundromat
  // ------------------------------------------------------------
  //  Each business:
  //   • costs `cost` to acquire (front of an existing illegal/clean op).
  //   • has TIERS (0..maxTier); each tier upgrade multiplies output & cap and
  //     costs cost * upgradeMul^tier (the exponential-cost / linear-output
  //     seesaw that keeps reinvestment meaningful).
  //   • `rate` = $/sec of PRODUCT accruing into a `supply` pool (caps at `cap`).
  //     You COLLECT the pool (passive income, GTA "sell stock" loop) — capped so
  //     the rich still have to engage, not pure idle.
  //   • `launder` businesses additionally convert DIRTY street cash → clean bank
  //     cash at a better rate the more laundromats you own (feeds SINKS.launderCut
  //     in economy.js via CBZ.cityWealth.laundromats()).
  //   • some need a wealth TIER to even buy (endgame gating).
  // ============================================================
  const BUSINESSES = [
    { id: "carwash",   name: "Sudz Car Wash",        emoji: "🧼", kind: "front",   cost: 45000,   rate: 22,  cap: 4500,   maxTier: 3, upgradeMul: 1.9, launder: true,  minTier: 1, blurb: "A legit front. Quietly washes dirty cash and prints a trickle." },
    { id: "taxi",      name: "Downtown Cab Co.",     emoji: "🚕", kind: "front",   cost: 70000,   rate: 30,  cap: 6500,   maxTier: 3, upgradeMul: 1.9, launder: true,  minTier: 1, blurb: "A medallion fleet — cash business, easy to cook the books." },
    { id: "weed",      name: "Green Room Dispensary",emoji: "🌿", kind: "supply",  cost: 95000,   rate: 44,  cap: 9000,   maxTier: 4, upgradeMul: 1.85, launder: false, minTier: 2, blurb: "Half-legal grow-op. Steady product, steady money." },
    { id: "pawn",      name: "Iron City Pawn",       emoji: "💍", kind: "front",   cost: 120000,  rate: 50,  cap: 11000,  maxTier: 3, upgradeMul: 1.95, launder: true,  minTier: 2, blurb: "Fences hot goods and launders through 'sales'. Cops rarely look." },
    { id: "club",      name: "Vault Nightclub",      emoji: "🍾", kind: "club",    cost: 240000,  rate: 95,  cap: 24000,  maxTier: 5, upgradeMul: 1.8,  launder: true,  minTier: 3, blurb: "The GTA classic. Popularity drives huge passive income & bottle cash." },
    { id: "lab",       name: "Cook Lab (Bunker)",    emoji: "⚗️", kind: "supply",  cost: 320000,  rate: 130, cap: 30000,  maxTier: 5, upgradeMul: 1.85, launder: false, minTier: 3, blurb: "Off-grid bunker. High output product — high heat if it's hit." },
    { id: "arcade",    name: "Pixel Palace Arcade",  emoji: "🕹️", kind: "front",   cost: 410000,  rate: 150, cap: 34000,  maxTier: 4, upgradeMul: 1.85, launder: true,  minTier: 3, blurb: "The most hands-off earner. A perfect base for the whole empire." },
    { id: "dealer",    name: "Apex Auto Dealership", emoji: "🏎️", kind: "lux",     cost: 650000,  rate: 230, cap: 52000,  maxTier: 4, upgradeMul: 1.9,  launder: true,  minTier: 4, blurb: "Sell supercars to suckers. Margins are obscene." },
    { id: "casino",    name: "Royale Casino Floor",  emoji: "🎰", kind: "casino",  cost: 1200000, rate: 420, cap: 110000, maxTier: 5, upgradeMul: 1.85, launder: true,  minTier: 4, blurb: "The house always wins. The single best passive machine in the city." },
    { id: "tower",     name: "Vinewood Tower (REIT)",emoji: "🏙️", kind: "invest",  cost: 3500000, rate: 980, cap: 280000, maxTier: 3, upgradeMul: 2.1,  launder: false, minTier: 5, blurb: "You own a skyline now. Rent rolls in while you sleep. Kingpin only." },
  ];
  const BIZ_BY_ID = {}; for (const b of BUSINESSES) BIZ_BY_ID[b.id] = b;

  function owns(id) { return !!(state().cityEmpireBiz[id]); }
  function rec(id) { return state().cityEmpireBiz[id] || null; }
  // tier multiplier: tier 0 = 1×, each tier ≈ +60% (so 5 tiers ≈ 10×)
  function tierMul(tier) { return 1 + 0.6 * (tier | 0); }
  function bizRate(id) { const b = BIZ_BY_ID[id], r = rec(id); if (!b || !r) return 0; return b.rate * tierMul(r.tier) * empireSynergy() * tierPerk("passiveMul"); }
  function bizCap(id) { const b = BIZ_BY_ID[id], r = rec(id); if (!b || !r) return 0; return Math.round(b.cap * tierMul(r.tier)); }
  function upgradeCost(id) { const b = BIZ_BY_ID[id], r = rec(id); if (!b || !r) return 0; return Math.round(b.cost * 0.6 * Math.pow(b.upgradeMul, r.tier)); }
  function bizValue(id) {
    const b = BIZ_BY_ID[id], r = rec(id); if (!b || !r) return 0;
    let v = b.cost; for (let t = 0; t < (r.tier | 0); t++) v += Math.round(b.cost * 0.6 * Math.pow(b.upgradeMul, t));
    return Math.round(v * 0.8);   // resale-ish equity (held value)
  }
  // SYNERGY: like GTA's nightclub feeding off your other businesses — the more
  // you own, the better everything runs (a small empire-wide multiplier). The
  // more TURF your crew controls, the smoother your fronts operate too (cops
  // paid off, suppliers protected) — a light bonus that rewards the takeover.
  function turfSynergy() {
    if (!CBZ.cityZoneControl) return 0;
    const e = E(); const me = e.playerGangId ? e.playerGangId() : (g.playerGang && g.playerGang.founded ? (g.playerGang.id || "player") : g.playerGangId);
    if (!me) return 0;
    const ctrl = CBZ.cityZoneControl();
    const owned = (ctrl.byGang && ctrl.byGang[me]) || 0;
    const total = ctrl.total || 1;
    return 0.25 * (owned / total);   // up to +25% when you own the whole city
  }
  function empireSynergy() { let n = 0; for (const id in state().cityEmpireBiz) n++; return 1 + 0.06 * Math.max(0, n - 1) + turfSynergy(); }
  function laundromats() { let n = 0; for (const id in state().cityEmpireBiz) { if (BIZ_BY_ID[id] && BIZ_BY_ID[id].launder) n++; } return n; }
  // total business equity (economy.js holdingsWorth() reads this)
  function bizValueTotal() { let s = 0; for (const id in state().cityEmpireBiz) s += bizValue(id); return s; }
  // live $/sec faucet across the empire (HUD/other modules can read it)
  function incomePerSec() { let s = 0; for (const id in state().cityEmpireBiz) s += bizRate(id); return Math.round(s); }

  function buyBiz(id) {
    const b = BIZ_BY_ID[id]; if (!b) return;
    if (owns(id)) { note("You already own " + b.name + ".", 1.6); return; }
    const ti = tierIndex();
    if (ti < (b.minTier || 0)) { note("⛔ " + b.name + " needs " + tierName(b.minTier) + " status to acquire.", 2.4); sfx("hit"); return; }
    if (!canAfford(b.cost)) { note("⛔ Need " + money(b.cost) + " (cash + bank) to acquire " + b.name + ".", 2.4); sfx("hit"); return; }
    charge(b.cost);
    state().cityEmpireBiz[id] = { tier: 0, supply: 0, lastTick: now() };
    const rep = clamp(Math.round(b.cost / 9000), 3, 60);
    if (CBZ.city) CBZ.city.addRespect(rep);
    big(b.emoji + " ACQUIRED " + b.name);
    note("Now earning " + money(bizRate(id)) + "/sec. Collect from the Empire menu.", 3);
    sfx("coin");
    persist(); recomputeFlex(); if (open_) render();
  }
  function upgradeBiz(id) {
    const b = BIZ_BY_ID[id], r = rec(id); if (!b || !r) return;
    if (r.tier >= b.maxTier) { note(b.name + " is already maxed out.", 1.8); return; }
    const cost = upgradeCost(id);
    if (!canAfford(cost)) { note("⛔ Upgrade costs " + money(cost) + ".", 2); sfx("hit"); return; }
    charge(cost);
    r.tier++;
    big("⬆️ " + b.name + " upgraded — Tier " + r.tier);
    note("Output now " + money(bizRate(id)) + "/sec, cap " + money(bizCap(id)) + ".", 2.6);
    sfx("coin");
    if (CBZ.city) CBZ.city.addRespect(2);
    persist(); if (open_) render();
  }
  // COLLECT the accrued product/cash pool from one business (the active step).
  function collectBiz(id) {
    const b = BIZ_BY_ID[id], r = rec(id); if (!b || !r) return 0;
    const take = Math.floor(r.supply);
    if (take < 1) { note(b.name + " has nothing to collect yet.", 1.4); return 0; }
    r.supply -= take;
    if (CBZ.city) CBZ.city.addCash(take);
    state().cityWealthLog.passiveEarned += take;
    big(b.emoji + " Collected " + money(take) + " from " + b.name);
    sfx("coin");
    if (CBZ.city) CBZ.city.addRespect(1);
    persist(); if (open_) render();
    return take;
  }
  function collectAll() {
    let total = 0, n = 0;
    for (const id in state().cityEmpireBiz) {
      const r = rec(id), take = Math.floor(r.supply);
      if (take >= 1) { r.supply -= take; total += take; n++; }
    }
    if (total < 1) { note("Nothing to collect across the empire yet.", 1.6); return; }
    if (CBZ.city) { CBZ.city.addCash(total); CBZ.city.addRespect(Math.min(8, n)); }
    state().cityWealthLog.passiveEarned += total;
    big("💰 Collected " + money(total) + " across " + n + " business" + (n === 1 ? "" : "es"));
    sfx("coin");
    persist(); if (open_) render();
  }

  // ============================================================
  //  2) LUXURY / STATUS — elastic vanity sinks → respect + flex
  // ------------------------------------------------------------
  //  Prices SCALE with your net worth (the elastic-sink trick: a whale pays
  //  more to flex, so money never becomes worthless). Owning luxury raises a
  //  cached "flex" level → bonus respect, notoriety, and a per-tier discount
  //  on future luxury (status compounds). Some are one-of (mansion), some you
  //  can stack (jewellery, supercars in the collection).
  // ============================================================
  const LUXURY = [
    { id: "watch",   name: "Diamond-Iced Watch",  emoji: "⌚", base: 35000,   flex: 6,   stack: true,  blurb: "Iced out. People notice." },
    { id: "chain",   name: "Solid-Gold Chains",   emoji: "📿", base: 60000,   flex: 9,   stack: true,  blurb: "Drip that screams new money." },
    { id: "super",   name: "Supercar (collection)",emoji: "🏎️", base: 180000, flex: 14,  stack: true,  blurb: "Add a hypercar to the collection. Pure status." },
    { id: "vip",     name: "Lifetime VIP Membership",emoji: "🎟️", base: 250000,flex: 18,  stack: false, blurb: "Velvet rope opens everywhere. The city knows your name." },
    { id: "mansion", name: "Vinewood Hills Mansion",emoji: "🏰", base: 1500000,flex: 40,  stack: false, minTier: 4, blurb: "20-car garage, infinity pool, helipad. The ultimate flex address." },
    { id: "yacht",   name: "Superyacht 'Leviathan'",emoji: "🛥️", base: 4000000,flex: 70,  stack: false, minTier: 5, blurb: "Floating palace. Throw the party the whole city talks about." },
    { id: "jet",     name: "Private Jet",          emoji: "✈️", base: 7500000, flex: 110, stack: false, minTier: 5, blurb: "Skip the traffic, skip the cops, skip the line. Kingpin air travel." },
  ];
  const LUX_BY_ID = {}; for (const l of LUXURY) LUX_BY_ID[l.id] = l;

  function luxCount(id) { const v = state().cityLuxury[id]; return v === true ? 1 : (v | 0); }
  function ownsLux(id) { return luxCount(id) > 0; }
  // elastic price: base × (1 + netWorth pressure) × stack escalation, minus
  // your status discount. Flexing gets pricier as you stack & as you get rich.
  function luxPrice(id) {
    const l = LUX_BY_ID[id]; if (!l) return 0;
    const nw = netWorth();
    const pressure = 1 + clamp(nw / 6000000, 0, 2.2);          // up to ~3.2× for a mega-whale
    const stackMul = l.stack ? Math.pow(1.6, luxCount(id)) : 1; // each extra costs more
    const disc = 1 - tierPerk("luxDiscount");                  // tier perk shaves a bit
    return Math.max(1000, Math.round(l.base * pressure * stackMul * disc));
  }
  function buyLux(id) {
    const l = LUX_BY_ID[id]; if (!l) return;
    if (!l.stack && ownsLux(id)) { note("You already own the " + l.name + ".", 1.6); return; }
    if (l.minTier != null && tierIndex() < l.minTier) { note("⛔ " + l.name + " is " + tierName(l.minTier) + "-only.", 2.4); sfx("hit"); return; }
    const price = luxPrice(id);
    if (!canAfford(price)) { note("⛔ Need " + money(price) + " to buy " + l.name + ".", 2.4); sfx("hit"); return; }
    charge(price);
    state().cityLuxury[id] = l.stack ? luxCount(id) + 1 : true;
    state().cityWealthLog.flexSpent += price;
    // flexing buys real status: respect + a notoriety bump (the city talks)
    const rep = Math.round(l.flex * (1 + 0.5 * (l.stack ? luxCount(id) : 1)));
    if (CBZ.city) CBZ.city.addRespect(rep);
    bumpNotoriety(Math.round(l.flex * 0.4));
    big(l.emoji + " " + (l.stack ? "Added to your collection: " : "Bought ") + l.name + "  (+" + rep + " respect)");
    note("Flex level up. The whole city sees the lifestyle now.", 2.6);
    sfx("coin"); if (CBZ.shake) CBZ.shake(0.15);
    recomputeFlex(); persist(); if (open_) render();
  }
  // throw a party / bottle service — a pure vanity drain that spikes respect &
  // draws a crowd vibe (elastic via SINKS.bottleService in economy.js).
  function partySpend() {
    const e = E(); const cost = e.SINKS && e.SINKS.bottleService ? e.SINKS.bottleService() : Math.max(250, Math.round(netWorth() * 0.01));
    if (!canAfford(cost)) { note("⛔ Bottle service runs " + money(cost) + " tonight.", 2); sfx("hit"); return; }
    charge(cost);
    state().cityWealthLog.flexSpent += cost;
    const rep = clamp(Math.round(cost / 400), 2, 40);
    if (CBZ.city) CBZ.city.addRespect(rep);
    bumpNotoriety(3);
    big("🍾 You bought out the bar — +" + rep + " respect");
    note("Everyone wants to be in your section tonight.", 2.4);
    sfx("coin");
    if (open_) render();
  }

  // cached "flex level": total flex points from owned luxury → small passive
  // respect/notoriety presence + drives the luxDiscount-ish vibe. Recomputed on
  // any luxury change (cheap; not per-frame).
  function recomputeFlex() {
    let f = 0;
    for (const id in state().cityLuxury) { const l = LUX_BY_ID[id]; if (l) f += l.flex * luxCount(id); }
    g.cityFlexBonus = f;
    return f;
  }
  function flexLevel() { return g.cityFlexBonus || recomputeFlex(); }
  function bumpNotoriety(n) {
    // route through whatever notoriety field the game uses; fall back to respect
    if (g.cityCarBiz && typeof g.cityCarBiz.notoriety === "number") g.cityCarBiz.notoriety += n;
    g.cityNotoriety = (g.cityNotoriety || 0) + n;
  }

  // ============================================================
  //  3) WEALTH-TIER PERKS — concrete benefits per tier
  // ------------------------------------------------------------
  //  As your tier (from economy.js TIERS, by net worth) rises you unlock real,
  //  queryable perks. Other modules can ask CBZ.cityWealth.perk(name).
  //   passiveMul  — multiplies all business output (rich get richer)
  //   luxDiscount — fraction off luxury prices (status compounds)
  //   bribeDisc   — fraction off cop bribes (money talks)
  //   vip         — boolean: VIP access (casino high-roller, club back room)
  //   bodyguardDisc — cheaper crew/bodyguards
  // ============================================================
  //               broke  hustler comfort  rich   baller  kingpin
  const PERKS = {
    passiveMul:   [1.00,  1.05,   1.12,    1.22,  1.38,   1.60],
    // turfMul: how much harder your tax collectors squeeze the blocks you hold
    // (economy.js turfIncome reads this) — a feared kingpin skims more.
    turfMul:      [1.00,  1.08,   1.18,    1.32,  1.55,   1.85],
    luxDiscount:  [0.00,  0.00,   0.04,    0.08,  0.14,   0.22],
    bribeDisc:    [0.00,  0.05,   0.10,    0.18,  0.28,   0.40],
    bodyguardDisc:[0.00,  0.05,   0.10,    0.18,  0.28,   0.40],
    vip:          [false, false,  false,   true,  true,   true],
  };
  const PERK_LABELS = {
    passiveMul: "Business income", turfMul: "Turf tax take", luxDiscount: "Luxury discount", bribeDisc: "Cheaper bribes",
    bodyguardDisc: "Cheaper crew", vip: "VIP access",
  };
  function tierPerk(name) {
    const arr = PERKS[name]; if (!arr) return 0;
    const i = clamp(tierIndex(), 0, arr.length - 1);
    return arr[i];
  }
  function tierName(i) { const e = E(); if (e.TIERS && e.TIERS[i]) return e.TIERS[i].name; return ["Broke", "Hustler", "Comfortable", "Rich", "Baller", "Kingpin"][i] || "?"; }
  function hasVIP() { return !!tierPerk("vip") || ownsLux("vip"); }

  // ============================================================
  //  4) HIGH-STAKES OPPORTUNITIES — front capital, big risk/reward
  // ------------------------------------------------------------
  //  Only the loaded can play: you put up serious capital up front; on success
  //  you get a multiple back (scaled by economy.js scoreReward so heat & rep
  //  juice the payout); on failure you eat the stake and take heat. A cooldown
  //  stops spamming. These are the "endgame jobs" the super-rich chase.
  // ============================================================
  const OPS = [
    { id: "stocks",  name: "Insider Stock Play",   emoji: "📈", stake: 50000,   odds: 0.62, lo: 0.4, hi: 2.6, heat: 0, minTier: 2, cd: 45, blurb: "A tip from the trading floor. Front the position, ride the spike." },
    { id: "fight",   name: "Fix the Big Fight",    emoji: "🥊", stake: 120000,  odds: 0.55, lo: 0.0, hi: 3.4, heat: 1, minTier: 3, cd: 60, blurb: "Bribe the fighters, bet the house. If it leaks, you're exposed." },
    { id: "heist",   name: "Casino Vault Heist",   emoji: "💎", stake: 400000,  odds: 0.5,  lo: 0.0, hi: 4.2, heat: 3, minTier: 4, cd: 120, blurb: "Front the crew & gear. Hit the vault. Cops come HARD if it goes loud." },
    { id: "cartel",  name: "Cartel Shipment",      emoji: "🚢", stake: 900000,  odds: 0.48, lo: 0.0, hi: 4.8, heat: 4, minTier: 5, cd: 150, blurb: "Finance a freighter of product. The biggest score — or the DEA's." },
  ];
  const OP_BY_ID = {}; for (const o of OPS) OP_BY_ID[o.id] = o;
  function opCooldown(id) {
    if (!g.cityOpCD) g.cityOpCD = {};
    const t = g.cityOpCD[id] || 0;
    return Math.max(0, (t - now()) / 1000);   // seconds remaining (CBZ.now is ms)
  }
  function runOp(id) {
    const o = OP_BY_ID[id]; if (!o) return;
    if (tierIndex() < o.minTier) { note("⛔ " + o.name + " is " + tierName(o.minTier) + "+ only.", 2.4); sfx("hit"); return; }
    if (opCooldown(id) > 0) { note(o.name + " on cooldown — " + Math.ceil(opCooldown(id)) + "s.", 1.8); return; }
    if (!canAfford(o.stake)) { note("⛔ This needs " + money(o.stake) + " up front. Come back richer.", 2.6); sfx("hit"); return; }
    charge(o.stake);
    if (!g.cityOpCD) g.cityOpCD = {};
    g.cityOpCD[id] = now() + o.cd * 1000;   // o.cd is SECONDS, CBZ.now is ms
    const e = E();
    // odds nudged up a touch by respect (rep = better connections)
    const win = rng() < clamp(o.odds + Math.min(0.12, (g.respect || 0) / 5000), 0.2, 0.9);
    if (win) {
      const mult = o.lo > 0 ? (o.lo + rng() * (o.hi - o.lo)) : (1 + rng() * (o.hi - 1));
      let payout = Math.round(o.stake * mult);
      if (e.scoreReward) payout = e.scoreReward(payout, { tier: true });   // heat/rep juice
      if (CBZ.city) { CBZ.city.addCash(payout); CBZ.city.addRespect(clamp(Math.round(payout / 8000), 4, 80)); }
      state().cityWealthLog.opsDone++;
      bumpNotoriety(Math.round(o.heat * 3));
      big(o.emoji + " " + o.name + " PAID OFF — " + money(payout) + " (×" + mult.toFixed(1) + ")");
      note("Net +" + money(payout - o.stake) + " on the play.", 2.8);
      sfx("win"); if (CBZ.shake) CBZ.shake(0.25);
    } else {
      big(o.emoji + " " + o.name + " WENT BAD — lost " + money(o.stake));
      note("Eat the loss and the heat. The street remembers.", 2.8);
      sfx("hit"); if (CBZ.shake) CBZ.shake(0.3);
      if (o.heat > 0 && CBZ.cityForceStars) CBZ.cityForceStars(Math.min(5, (g.wanted | 0) + o.heat));
      else if (o.heat > 0) g.wanted = Math.min(5, (g.wanted | 0) + o.heat);
      bumpNotoriety(o.heat * 2);
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (open_) render();
  }

  // ---- laundering hook: a one-shot "clean it all" from the menu --------------
  function launderAll() {
    const e = E();
    const dirty = g.cash || 0;
    if (dirty < 100) { note("Not enough dirty cash on hand to bother laundering.", 1.8); return; }
    if (e.launder) {
      const r = e.launder(dirty);
      state().cityWealthLog.laundered += (r.banked || 0);
      big("🧺 Laundered " + money(dirty) + " → " + money(r.banked) + " clean (−" + money(r.lost) + " cut)");
      note(laundromats() ? "Your " + laundromats() + " fronts shaved the cut down." : "Buy laundering businesses to shrink the cut.", 2.6);
      sfx("coin");
    }
    if (open_) render();
  }

  // ============================================================
  //  PASSIVE INCOME TICK  (the faucet) — order 41 is free
  // ------------------------------------------------------------
  //  Product/cash accrues into each business's supply pool, capped. A nightclub-
  //  style "auto-deposit" trickles a slice straight to cash so even an idle whale
  //  feels money moving, but the bulk must be COLLECTED (keeps you engaged).
  // ============================================================
  let warnedFull = 0;
  CBZ.onUpdate(41, function (dt) {
    if (g.mode !== "city") return;
    hydrate();
    const biz = state().cityEmpireBiz;
    let anyFull = false, autoTotal = 0;
    for (const id in biz) {
      const r = biz[id]; const rate = bizRate(id), cap = bizCap(id);
      if (rate <= 0) continue;
      // a small slice auto-deposits to cash (passive "safe" earnings); the rest
      // pools as collectable supply (the active money loop).
      const gained = rate * dt;
      const auto = gained * 0.18;
      const pool = gained - auto;
      autoTotal += auto;
      r.supply = Math.min(cap, (r.supply || 0) + pool);
      if (r.supply >= cap - 0.5) anyFull = true;
    }
    if (autoTotal >= 1 && CBZ.city) {
      // accumulate fractional auto-income so small empires still pay out
      g._wealthAutoAcc = (g._wealthAutoAcc || 0) + autoTotal;
      if (g._wealthAutoAcc >= 1) {
        const give = Math.floor(g._wealthAutoAcc);
        g._wealthAutoAcc -= give;
        CBZ.city.addCash(give);
        state().cityWealthLog.passiveEarned += give;
      }
    }
    // a gentle nudge when a business is overflowing (you're leaving money on table)
    if (anyFull) {
      warnedFull -= dt;
      if (warnedFull <= 0) { warnedFull = 28; note("💼 A business is at capacity — collect from the Empire menu (Shift+B).", 2.2); }
    }
  });

  // ============================================================
  //  THE "EMPIRE" OVERLAY  (full menu UI)
  // ============================================================
  let panel = null, open_ = false, tab = "biz", flash_ = "";
  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityEmpire";
    panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:49;display:none;" +
      "width:min(680px,94vw);max-height:88vh;overflow-y:auto;background:linear-gradient(160deg,rgba(16,14,22,.985),rgba(20,16,12,.985));" +
      "border:2px solid #5a4a2a;border-radius:18px;padding:18px 20px;color:#f3ecd8;font-family:Fredoka,system-ui,sans-serif;" +
      "box-shadow:0 22px 70px rgba(0,0,0,.6),inset 0 0 60px rgba(120,90,30,.07);pointer-events:auto";
    document.body.appendChild(panel);
    return panel;
  }
  function row(left, right, sub, accent) {
    return "<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:7px 9px;margin:5px 0;" +
      "background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-left:3px solid " + (accent || "#5a4a2a") + ";border-radius:9px'>" +
      "<div style='flex:1'><div>" + left + "</div>" + (sub ? "<div style='font-size:11px;color:#a99b78;margin-top:2px'>" + sub + "</div>" : "") + "</div>" +
      "<div style='text-align:right;white-space:nowrap'>" + right + "</div></div>";
  }
  function btn(key, label, color) {
    return "<span style='display:inline-block;margin-left:6px;padding:2px 8px;border-radius:7px;background:" + (color || "#3a3320") + ";" +
      "border:1px solid rgba(255,255,255,.15);font-size:12px'><b style='color:#ffd166'>" + key + "</b> " + label + "</span>";
  }
  // visible row hotkey: rows 1–9 use their number; the 10th uses 0; beyond → ·
  function keyLabel(i) { return i <= 9 ? String(i) : i === 10 ? "0" : "·"; }

  function renderBiz() {
    let h = "";
    const inc = incomePerSec();
    h += "<div style='font-size:12px;color:#c9b98a;margin-bottom:6px'>Passive empire — <b style='color:#7ed957'>" + money(inc) + "/sec</b> · " +
      laundromats() + " laundering front" + (laundromats() === 1 ? "" : "s") + " · synergy ×" + empireSynergy().toFixed(2) + "</div>";
    // turf street-tax faucet (economy.js) — shown so the player connects taking
    // territory to passive income, the heart of the takeover loop.
    const e0 = E();
    if (e0.turfIncomeInfo) {
      const ti = e0.turfIncomeInfo();
      if (ti.zones > 0) h += "<div style='font-size:12px;color:#c9b98a;margin-bottom:8px'>🏴 Turf tax — <b style='color:#ff9e6b'>" + money(ti.perSec) + "/sec</b> from <b>" + ti.zones + "</b> block" + (ti.zones === 1 ? "" : "s") + " held · ×" + tierPerk("turfMul").toFixed(2) + " status</div>";
      else h += "<div style='font-size:12px;color:#8a7d5a;margin-bottom:8px'>🏴 Take turf with your crew to collect street tax (passive $/sec).</div>";
    }
    h += "<div style='text-align:right;margin-bottom:4px'>" + btn("C", "COLLECT ALL", "#1f4a2a") + " " + btn("L", "Launder cash", "#3a2a4a") + " " + btn("P", "Bottle service", "#4a2a3a") + "</div>";
    let i = 1;
    for (const b of BUSINESSES) {
      const have = owns(b.id), r = rec(b.id);
      let right, sub = b.blurb;
      if (have) {
        const pct = Math.round((r.supply / Math.max(1, bizCap(b.id))) * 100);
        right = "<div style='color:#7ed957'>" + money(Math.floor(r.supply)) + "</div>" +
          "<div style='font-size:11px;color:#a99b78'>" + money(bizRate(b.id)) + "/s · T" + r.tier + "/" + b.maxTier + "</div>";
        sub = "Pool " + pct + "% of " + money(bizCap(b.id)) + (r.tier < b.maxTier ? " · upgrade " + money(upgradeCost(b.id)) : " · MAXED") +
          (b.launder ? " · 🧺 front" : "");
        const acts = (Math.floor(r.supply) >= 1 ? btn(keyLabel(i), "collect", "#1f4a2a") : "") +
          (r.tier < b.maxTier ? btn("U", "upgrade", "#2a3a4a") : "");
        right += "<div style='margin-top:3px'>" + acts + "</div>";
      } else {
        const locked = tierIndex() < (b.minTier || 0);
        right = "<div style='color:" + (locked ? "#a06b6b" : "#ffd166") + "'>" + money(b.cost) + "</div>" +
          "<div style='font-size:11px;color:#a99b78'>" + (locked ? "🔒 " + tierName(b.minTier) : money(b.rate) + "/s base") + "</div>";
        if (!locked) right += "<div style='margin-top:3px'>" + btn(keyLabel(i), "buy", "#4a3a1a") + "</div>";
      }
      h += row(b.emoji + " <b>" + b.name + "</b>", right, sub, have ? "#7ed957" : "#5a4a2a");
      i++;
    }
    return h;
  }
  function renderLux() {
    let h = "<div style='font-size:12px;color:#c9b98a;margin-bottom:8px'>Flex level <b style='color:#ffd166'>" + Math.round(flexLevel()) +
      "</b> — luxury buys respect & notoriety. Prices scale with your net worth.</div>";
    let i = 1;
    for (const l of LUXURY) {
      const cnt = luxCount(l.id), locked = l.minTier != null && tierIndex() < l.minTier;
      const price = luxPrice(l.id);
      let right;
      if (!l.stack && cnt > 0) right = "<div style='color:#7ed957'>OWNED ✓</div><div style='font-size:11px;color:#a99b78'>+" + l.flex + " flex</div>";
      else {
        right = "<div style='color:" + (locked ? "#a06b6b" : "#ffd166") + "'>" + money(price) + "</div>" +
          "<div style='font-size:11px;color:#a99b78'>" + (locked ? "🔒 " + tierName(l.minTier) : "+" + l.flex + " flex" + (cnt ? " · own " + cnt : "")) + "</div>";
        if (!locked) right += "<div style='margin-top:3px'>" + btn(keyLabel(i), "buy", "#4a3a1a") + "</div>";
      }
      h += row(l.emoji + " <b>" + l.name + "</b>", right, l.blurb, cnt ? "#ffd166" : "#5a4a2a");
      i++;
    }
    return h;
  }
  function renderPerks() {
    const e = E();
    const t = wealthTier(), idx = tierIndex();
    const nw = netWorth();
    const prog = e.tierProgress ? e.tierProgress() : 0;
    const next = (e.TIERS && e.TIERS[idx + 1]) || null;
    let h = "<div style='font-size:15px;margin-bottom:4px'>Net worth <b style='color:#ffd166'>" + money(nw) + "</b> — status <b style='color:" + (t.color || "#fff") + "'>" + t.name + "</b></div>";
    h += "<div style='height:9px;background:#241f16;border-radius:6px;overflow:hidden;margin:6px 0 4px'><div style='height:100%;width:" + Math.round(prog * 100) + "%;background:linear-gradient(90deg,#ffd166,#ff9e6b)'></div></div>";
    h += "<div style='font-size:11px;color:#a99b78;margin-bottom:12px'>" + (next ? Math.round(prog * 100) + "% to " + next.name + " (" + money(next.min) + ")" : "Top tier reached — you run this city.") + "</div>";
    h += "<div style='font-size:12px;color:#c9b98a;margin-bottom:6px'>YOUR PERKS AT THIS TIER</div>";
    h += row("💰 " + PERK_LABELS.passiveMul, "<b style='color:#7ed957'>×" + tierPerk("passiveMul").toFixed(2) + "</b>", "Multiplies all business output", "#7ed957");
    h += row("🏴 " + PERK_LABELS.turfMul, "<b style='color:#7ed957'>×" + tierPerk("turfMul").toFixed(2) + "</b>", "Bigger cut of the turf you hold", "#ff9e6b");
    h += row("🛍️ " + PERK_LABELS.luxDiscount, "<b style='color:#7ed957'>−" + Math.round(tierPerk("luxDiscount") * 100) + "%</b>", "Off every luxury purchase", "#ffd166");
    h += row("👮 " + PERK_LABELS.bribeDisc, "<b style='color:#7ed957'>−" + Math.round(tierPerk("bribeDisc") * 100) + "%</b>", "Cheaper to pay off the cops", "#7fd0ff");
    h += row("🛡️ " + PERK_LABELS.bodyguardDisc, "<b style='color:#7ed957'>−" + Math.round(tierPerk("bodyguardDisc") * 100) + "%</b>", "Cheaper crew & bodyguards", "#9fd07e");
    h += row("🎟️ " + PERK_LABELS.vip, hasVIP() ? "<b style='color:#7ed957'>UNLOCKED ✓</b>" : "<b style='color:#a06b6b'>locked</b>", "Casino high-roller & club back rooms", hasVIP() ? "#7ed957" : "#5a4a2a");
    return h;
  }
  function renderOps() {
    let h = "<div style='font-size:12px;color:#c9b98a;margin-bottom:8px'>High-stakes plays — front the capital, big risk, bigger reward. Rich only.</div>";
    let i = 1;
    for (const o of OPS) {
      const locked = tierIndex() < o.minTier, cd = opCooldown(o.id);
      let right = "<div style='color:" + (locked ? "#a06b6b" : "#ff9e6b") + "'>stake " + money(o.stake) + "</div>";
      right += "<div style='font-size:11px;color:#a99b78'>" + Math.round(o.odds * 100) + "% · up to ×" + o.hi + (o.heat ? " · 🔥" + o.heat : "") + "</div>";
      if (locked) right += "<div style='font-size:11px;color:#a06b6b'>🔒 " + tierName(o.minTier) + "</div>";
      else if (cd > 0) right += "<div style='font-size:11px;color:#a99b78'>cooldown " + Math.ceil(cd) + "s</div>";
      else right += "<div style='margin-top:3px'>" + btn(keyLabel(i), "RUN", "#5a2a1a") + "</div>";
      h += row(o.emoji + " <b>" + o.name + "</b>", right, o.blurb, locked ? "#5a4a2a" : "#ff9e6b");
      i++;
    }
    return h;
  }

  function render() {
    state();
    const tabs = [["biz", "💼 Empire"], ["lux", "💎 Luxury"], ["ops", "🎲 High Stakes"], ["perks", "👑 Status"]];
    let head = "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>" +
      "<div style='font-size:22px;font-weight:700;letter-spacing:.5px'>👑 EMPIRE</div>" +
      "<div style='font-size:12px;color:#c9b98a'>Cash " + money(g.cash || 0) + " · Bank " + money(g.cityBank || 0) + " · " + wealthTier().name + "</div></div>";
    let bar = "<div style='display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap'>";
    tabs.forEach((t) => {
      const on = tab === t[0];
      bar += "<div style='padding:5px 11px;border-radius:9px;font-size:13px;cursor:default;" +
        "background:" + (on ? "linear-gradient(90deg,#5a4a2a,#3a3320)" : "rgba(255,255,255,.04)") + ";" +
        "border:1px solid " + (on ? "#ffd166" : "rgba(255,255,255,.08)") + ";color:" + (on ? "#ffd166" : "#c9b98a") + "'>" +
        t[1] + "</div>";
    });
    bar += "</div>";
    let body = tab === "biz" ? renderBiz() : tab === "lux" ? renderLux() : tab === "ops" ? renderOps() : renderPerks();
    let foot = "<div style='font-size:11px;color:#8a7d5a;margin-top:12px;border-top:1px solid rgba(255,255,255,.06);padding-top:8px'>" +
      "<b>,</b>/<b>.</b> switch tab · number keys <b>1–9,0</b> act on the list · <b>Esc</b> close" + (flash_ ? " &nbsp;·&nbsp; <span style='color:#ffd166'>" + flash_ + "</span>" : "") + "</div>";
    el().innerHTML = head + bar + body + foot;
  }

  function open() {
    if (CBZ.cityMenuOpen && !open_) return;   // another overlay owns the screen
    hydrate();
    open_ = true; CBZ.cityMenuOpen = true; flash_ = "";
    el().style.display = "block";
    render();
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function close() {
    open_ = false; if (panel) panel.style.display = "none";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  CBZ.cityOpenWealth = open;

  const TAB_ORDER = ["biz", "lux", "ops", "perks"];
  function switchTab(dir) {
    let i = TAB_ORDER.indexOf(tab); i = (i + dir + TAB_ORDER.length) % TAB_ORDER.length;
    tab = TAB_ORDER[i]; render();
  }
  // act on a number key within the current tab's list (n is 1-based; 0 → 10th)
  function actNum(n) {
    if (n === 0) n = 10;
    if (tab === "biz") {
      const b = BUSINESSES[n - 1]; if (!b) return;
      if (owns(b.id)) { if (Math.floor(rec(b.id).supply) >= 1) collectBiz(b.id); else note(b.name + " has nothing to collect yet.", 1.4); }
      else buyBiz(b.id);
    } else if (tab === "lux") {
      const l = LUXURY[n - 1]; if (l) buyLux(l.id);
    } else if (tab === "ops") {
      const o = OPS[n - 1]; if (o) runOp(o.id);
    }
  }

  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    const k = (e.key || "").toLowerCase();
    if (open_) {
      if (k === "escape") { e.preventDefault(); close(); return; }
      // tabs: , / . cycle (both keys are unused elsewhere in the game)
      if (k === "," ) { e.preventDefault(); switchTab(-1); return; }
      if (k === "." ) { e.preventDefault(); switchTab(1); return; }
      // biz action keys
      if (tab === "biz") {
        if (k === "c") { e.preventDefault(); collectAll(); return; }
        if (k === "l") { e.preventDefault(); launderAll(); return; }
        if (k === "p") { e.preventDefault(); partySpend(); return; }
        if (k === "u") { e.preventDefault(); for (const b of BUSINESSES) { const r = rec(b.id); if (r && r.tier < b.maxTier) { upgradeBiz(b.id); break; } } return; }
      }
      // number keys act on the visible list row (0 = the 10th row)
      if (k >= "0" && k <= "9") { e.preventDefault(); actNum(parseInt(k, 10)); return; }
      return;
    }
    // OPEN: Shift+B (B solo is taken; this chord is unused elsewhere)
    if (k === "b" && e.shiftKey && !e.repeat && !CBZ.cityMenuOpen && !(CBZ.player && CBZ.player.driving)) {
      e.preventDefault(); open();
    }
  });

  // ---- reset (new game / mode switch) --------------------------------------
  CBZ.cityWealthReset = function () {
    g.cityEmpireBiz = {}; g.cityLuxury = {}; g.cityWealthLog = { laundered: 0, passiveEarned: 0, flexSpent: 0, opsDone: 0 };
    g.cityFlexBonus = 0; g.cityOpCD = {}; g._wealthHydrated = false; g._wealthAutoAcc = 0;
    if (panel) panel.style.display = "none"; open_ = false;
  };

  // ============================================================
  //  PUBLIC SURFACE  (other modules + headless harness)
  // ============================================================
  CBZ.cityBizIncome = incomePerSec;          // $/sec faucet
  CBZ.cityFlexLevel = flexLevel;             // flex points from luxury
  CBZ.cityWealth = {
    open, close, isOpen: () => open_,
    BUSINESSES, LUXURY, OPS, PERKS,
    buyBiz, upgradeBiz, collectBiz, collectAll, bizRate, bizCap, bizValue,
    buyLux, luxPrice, ownsLux, partySpend, launderAll,
    runOp, opCooldown,
    tierPerk, hasVIP, flexLevel, incomePerSec,
    // economy.js holdingsWorth() & SINKS.launderCut() read these via CBZ.cityEmpire:
    bizValueTotal, laundromats,
    owns, ownsBiz: owns, state: () => ({ biz: g.cityEmpireBiz, luxury: g.cityLuxury, log: g.cityWealthLog }),
  };

  // ---- wire our totals into economy.js WITHOUT touching empire.js -----------
  // economy.js's holdingsWorth() and SINKS.launderCut() query CBZ.cityEmpire.
  // empire.js (the car yard) loads first and owns that object but doesn't define
  // bizValue/laundromats; we ADD them here (only if missing) so the property
  // empire's equity & laundering count actually feed net worth and launder cuts.
  if (CBZ.cityEmpire) {
    if (!CBZ.cityEmpire.bizValue) CBZ.cityEmpire.bizValue = bizValueTotal;
    if (!CBZ.cityEmpire.laundromats) CBZ.cityEmpire.laundromats = laundromats;
  }
})();
