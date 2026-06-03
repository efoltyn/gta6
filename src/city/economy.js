/* ============================================================
   city/economy.js — money, items, the city inventory, the buy/sell
   layer, and the REALISTIC market: most people carry little cash, drug
   prices float by supply/demand + heat, stolen goods fence at a haircut,
   and cars have real values you cash out at the chop shop.

   Money is g.cash ($). The city inventory is g.cityInv ({ item: count }).
   ITEMS are tagged so each shop pulls the right stock:
     food / weapon / ammo / drug / wearable / valuable / tool.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;
  const E = (CBZ.CITY && CBZ.CITY.econ) || {};

  // value = base $ price. heal = hunger restored. dmg/rof/ammo = gun stats.
  const ITEMS = {
    // --- food ---
    Burger:        { value: 9,   tag: "food", heal: 42 },
    Hotdog:        { value: 6,   tag: "food", heal: 28 },
    "Pizza Slice": { value: 7,   tag: "food", heal: 34 },
    Soda:          { value: 3,   tag: "food", heal: 12 },
    "Energy Drink":{ value: 5,   tag: "food", heal: 18, boost: true },
    Fries:         { value: 4,   tag: "food", heal: 20 },
    // --- weapons ---
    Pistol:        { value: 350,  tag: "weapon", gun: "pistol",  dmg: 34, rof: 0.32, ammo: 17 },
    Revolver:      { value: 700,  tag: "weapon", gun: "revolver",dmg: 64, rof: 0.5,  ammo: 6 },
    "Desert Eagle":{ value: 1500, tag: "weapon", gun: "deagle",  dmg: 75, rof: 0.4,  ammo: 7 },
    SMG:           { value: 1200, tag: "weapon", gun: "smg",     dmg: 22, rof: 0.09, ammo: 30 },
    Uzi:           { value: 1600, tag: "weapon", gun: "uzi",     dmg: 16, rof: 0.05, ammo: 25 },
    Shotgun:       { value: 900,  tag: "weapon", gun: "shotgun", dmg: 80, rof: 0.85, ammo: 8 },
    Rifle:         { value: 2600, tag: "weapon", gun: "rifle",   dmg: 48, rof: 0.13, ammo: 30 },
    "AK-47":       { value: 3200, tag: "weapon", gun: "ak47",    dmg: 34, rof: 0.097,ammo: 30 },
    LMG:           { value: 6500, tag: "weapon", gun: "lmg",     dmg: 27, rof: 0.075,ammo: 100 },
    Sniper:        { value: 5200, tag: "weapon", gun: "sniper",  dmg: 130,rof: 1.25, ammo: 5 },
    Bat:           { value: 80,   tag: "weapon", melee: true, dmg: 26 },
    Knife:         { value: 120,  tag: "weapon", melee: true, dmg: 40 },
    // --- ammo ---
    "Ammo Box":    { value: 60,   tag: "ammo", rounds: 60 },
    // --- drugs (float per the street market below) ---
    Weed:          { value: 30,   tag: "drug" },
    Coke:          { value: 120,  tag: "drug" },
    Meth:          { value: 90,   tag: "drug" },
    Pills:         { value: 45,   tag: "drug" },
    // --- wearables (drip → respect; stealable) ---
    "Gold Chain":  { value: 600,  tag: "wearable", drip: 6 },
    "Diamond Ring":{ value: 1500, tag: "wearable", drip: 10 },
    Rolex:         { value: 2200, tag: "wearable", drip: 14 },
    "Designer Jacket": { value: 450, tag: "wearable", drip: 5 },
    Sneakers:      { value: 220,  tag: "wearable", drip: 3 },
    Sunglasses:    { value: 140,  tag: "wearable", drip: 2 },
    "Diamond Grill": { value: 1800, tag: "wearable", drip: 12 },
    Earrings:      { value: 320,  tag: "wearable", drip: 3 },
    // --- valuables (loot → fence at pawn) ---
    Wallet:        { value: 40,   tag: "valuable" },
    Phone:         { value: 110,  tag: "valuable" },
    Laptop:        { value: 380,  tag: "valuable" },
    "Cash Stack":  { value: 500,  tag: "valuable" },
    "Gold Bar":    { value: 3000, tag: "valuable" },
    // --- tools ---
    Lockpick:      { value: 90,   tag: "tool" },
    Crowbar:       { value: 70,   tag: "tool" },
    "Burner Phone":{ value: 60,   tag: "tool" },
    Medkit:        { value: 150,  tag: "tool", medkit: 40 },
    "Body Armor":  { value: 400,  tag: "tool", armor: 60 },
  };

  const SHOP_STOCK = {
    guns:        ["Pistol", "Revolver", "Desert Eagle", "SMG", "Uzi", "Shotgun", "Rifle", "AK-47", "LMG", "Sniper", "Ammo Box", "Body Armor", "Knife", "Bat"],
    jewelry:     ["Gold Chain", "Diamond Ring", "Rolex", "Diamond Grill", "Earrings"],
    pawn:        ["Lockpick", "Crowbar", "Burner Phone", "Knife"],
    clothing:    ["Designer Jacket", "Sneakers", "Sunglasses"],
    food:        ["Burger", "Hotdog", "Pizza Slice", "Soda", "Fries", "Energy Drink"],
    gas:         ["Soda", "Energy Drink", "Hotdog", "Ammo Box", "Burner Phone"],
    drugs:       ["Weed", "Pills"],
    hardware:    ["Crowbar", "Lockpick", "Bat", "Medkit"],
    electronics: ["Phone", "Laptop", "Burner Phone"],
    gym:         ["Energy Drink", "Medkit"],
    barber:      ["Sunglasses", "Earrings"],
    security:    ["Body Armor", "Ammo Box", "Pistol"],
    bank:        [],
    hospital:    ["Medkit", "Body Armor"],
    realtor:     [],
    chop:        [],
    casino:      [],
    raceway:     ["Energy Drink", "Medkit"],
    arena:       ["Energy Drink", "Medkit", "Body Armor"],
    paintball:   ["Energy Drink", "Medkit"],
    transit:     ["Soda", "Hotdog", "Burner Phone"],
    cityhall:    [],
    airfield:    ["Body Armor", "Medkit"],
    racepark:    [],
  };

  // ---- car models with real values (chop-shop payouts + spawning) ----------
  // rarity 0 = everywhere, 1 = exotic. `s` = body length scale (visual variety).
  // The NAME tells you the tier (a Prius is clearly a shitbox, a Ferrari clearly
  // isn't) — the actual $ value stays HIDDEN until you chop it at the shop.
  const CARS = [
    { name: "Toyota Prius",   value: 1200,  rarity: 0.0,  color: 0x6b6f78, s: 1.0 },
    { name: "Honda Civic",    value: 2800,  rarity: 0.0,  color: 0x4caf6e, s: 0.92 },
    { name: "Yellow Cab",     value: 3000,  rarity: 0.05, color: 0xf2c43d, s: 1.0 },
    { name: "Chevy Malibu",   value: 3800,  rarity: 0.0,  color: 0x3c6fd6, s: 1.05 },
    { name: "Dodge Caravan",  value: 4600,  rarity: 0.1,  color: 0xe8e8ee, s: 1.12 },
    { name: "Ford F-150",     value: 5400,  rarity: 0.15, color: 0xe24b4b, s: 1.15 },
    { name: "Nissan 370Z",    value: 9500,  rarity: 0.4,  color: 0x2a2d33, s: 0.98 },
    { name: "Jeep Cherokee",  value: 12000, rarity: 0.45, color: 0x44505e, s: 1.18 },
    { name: "Dodge Charger",  value: 17000, rarity: 0.6,  color: 0xe88a3c, s: 1.08 },
    { name: "Chevy Corvette", value: 26000, rarity: 0.78, color: 0xd03b3b, s: 0.96 },
    { name: "Mercedes S-Class", value: 44000, rarity: 0.88, color: 0x1c2230, s: 1.1 },
    { name: "Tesla Model 3",  value: 31000, rarity: 0.72, color: 0x67717b, s: 1.0, detailStyle: "tesla-3" },
    { name: "Tesla Model Y",  value: 39000, rarity: 0.78, color: 0x1470e3, s: 1.04, detailStyle: "tesla-y" },
    { name: "Tesla Model S",  value: 54000, rarity: 0.86, color: 0xd1262f, s: 1.06, detailStyle: "tesla-s" },
    { name: "Tesla Model X",  value: 61000, rarity: 0.9,  color: 0x185bd6, s: 1.12, detailStyle: "tesla-x" },
    { name: "Cybertruck",     value: 68000, rarity: 0.91, color: 0xa8afb2, s: 1.18, detailStyle: "cybertruck" },
    { name: "Porsche 911 Turbo", value: 69000, rarity: 0.93, color: 0xf3cf39, s: 0.94, detailStyle: "porsche" },
    { name: "Lamborghini Aventador", value: 71000, rarity: 0.95, color: 0xf28c28, s: 0.98, detailStyle: "aventador" },
    { name: "Ferrari 488",    value: 72000, rarity: 0.96, color: 0xffd451, s: 0.94, detailStyle: "ferrari" },
    { name: "Ferrari Enzo",   value: 86000, rarity: 0.975, color: 0xe02025, s: 0.96, detailStyle: "enzo" },
    { name: "Bugatti Veyron", value: 99000, rarity: 0.99, color: 0x202225, s: 0.97, detailStyle: "veyron" },
  ];

  let _seed = 1357913 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  function add(name, n) { n = n || 1; g.cityInv = g.cityInv || {}; g.cityInv[name] = (g.cityInv[name] || 0) + n; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
  function has(name) { return ((g.cityInv && g.cityInv[name]) || 0) > 0; }
  function count(name) { return (g.cityInv && g.cityInv[name]) || 0; }
  function take(name, n) { n = n || 1; if (count(name) < n) return false; g.cityInv[name] -= n; if (g.cityInv[name] <= 0) delete g.cityInv[name]; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); return true; }

  function drip() { let s = 0; const inv = g.cityInv || {}; for (const k in inv) { const it = ITEMS[k]; if (it && it.drip) s += it.drip; } return s; }

  function buyPrice(name) { const it = ITEMS[name]; return it ? Math.round(it.value * 1.0) : 0; }
  function sellPrice(name, kind) {
    const it = ITEMS[name]; if (!it) return 0;
    let mul = 0.45;
    if (kind === "pawn") mul = it.tag === "valuable" ? 0.65 : 0.5;
    if (kind === "jewelry" && it.tag === "wearable") mul = 0.6;
    if (kind === "electronics" && it.tag === "valuable") mul = 0.62;
    return Math.max(1, Math.round(it.value * mul));
  }

  // ---- the floating street drug market -------------------------------------
  // Per-drug price multiplier that mean-reverts to 1; selling floods the local
  // market (price drops), heat scares buyers, and there's day-to-day noise.
  function initMarket() {
    g.cityDrugMkt = { Weed: 1, Coke: 1, Meth: 1, Pills: 1 };
    g.cityDrugNoise = 1;
  }
  // what a street buyer will pay you for one unit right now
  function streetPrice(drug) {
    const it = ITEMS[drug]; if (!it || it.tag !== "drug") return 0;
    if (!g.cityDrugMkt) initMarket();
    const mkt = g.cityDrugMkt[drug] != null ? g.cityDrugMkt[drug] : 1;
    const heat = 1 - 0.05 * (g.wanted | 0);                    // hot streets = wary buyers
    const noise = 0.85 + rng() * 0.5;                          // per-deal haggling
    const retail = 2.1;                                        // street markup over wholesale
    return Math.max(1, Math.round(it.value * retail * mkt * Math.max(0.4, heat) * noise));
  }
  // dumping product in one area pushes the price down (recovers over time)
  function recordSale(drug, n) {
    if (!g.cityDrugMkt) initMarket();
    const flood = (E.drugFlood || 0.14) * (n || 1);
    g.cityDrugMkt[drug] = Math.max(0.35, (g.cityDrugMkt[drug] != null ? g.cityDrugMkt[drug] : 1) - flood);
  }
  // wholesale price the trap house charges you to buy product
  function wholesalePrice(drug) { const it = ITEMS[drug]; return it ? Math.max(1, Math.round(it.value * 0.8)) : 0; }

  CBZ.onUpdate(30, function (dt) {
    if (g.mode !== "city") return;
    if (!g.cityDrugMkt) return;
    const drift = (E.drugDrift || 0.05) * dt;
    for (const k in g.cityDrugMkt) g.cityDrugMkt[k] += (1 - g.cityDrugMkt[k]) * drift;
  });

  // ---- realistic cash on a person, by wealth tier (0 poor .. 1 rich) -------
  function rollCash(wealth) {
    wealth = wealth == null ? rng() : wealth;
    // most people carry < $60; the wealthy carry a few hundred; a rare WHALE
    // is walking around with an insane wad — you just can't tell until you rob them.
    if (wealth > 0.985) return 1500 + ((rng() * 8500) | 0);    // whale ($1.5k–$10k)
    if (wealth < 0.15) return (rng() * 12) | 0;                 // broke
    if (wealth < 0.6) return 8 + ((rng() * 55) | 0);            // average
    if (wealth < 0.88) return 40 + ((rng() * 180) | 0);         // comfortable
    return 120 + ((rng() * 520) | 0);                          // wealthy
  }
  // a wallet/phone you might lift in addition to loose cash
  function rollWallet(wealth) {
    const cash = rollCash(wealth);
    let item = null;
    const r = rng();
    if (wealth > 0.8 && r < 0.5) item = ["Phone", "Cash Stack", "Rolex", "Laptop"][(rng() * 4) | 0];
    else if (r < 0.3) item = ["Wallet", "Phone", "Sunglasses"][(rng() * 3) | 0];
    return { cash, item };
  }

  // ---- car helpers ----------------------------------------------------------
  function pickCar(rare) {
    // rarity-weighted: bias toward common unless `rare` asks for the good stuff
    const r = rare ? Math.pow(rng(), 0.4) : Math.pow(rng(), 2.2);  // skew
    // map r∈[0,1] onto the rarity-sorted list
    let best = CARS[0], bd = 9;
    for (const c of CARS) { const d = Math.abs(c.rarity - r); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function carByName(name) { return CARS.find((c) => c.name === name) || CARS[0]; }

  // ---- the city PROPERTY market index --------------------------------------
  // A single macro index that drifts like a real housing market: a slow
  // mean-reverting random walk around 1.0, with the occasional boom / bust
  // shock. Zillow multiplies every listing's base Zestimate by this index so
  // prices visibly rise and fall over a run. A separate momentum term makes
  // moves trend (a rising market keeps rising for a while) so it feels alive,
  // not like pure noise. Owned property is worth more in a boom — buy low.
  const MKT = {
    floor: 0.72, ceil: 1.42,     // hard bounds so prices stay sane
    revert: 0.012,               // pull back toward fair value (1.0) per tick
    vol: 0.018,                  // base random-walk volatility per tick
    momentumDecay: 0.92,         // how much trend carries to the next tick
  };
  function initPropMarket() {
    g.cityPropMkt = { index: 1, momentum: 0, trend: "steady", shockT: 24 + rng() * 40, history: [1] };
  }
  function propMarket() { if (!g.cityPropMkt) initPropMarket(); return g.cityPropMkt; }
  // current macro multiplier applied to every property's base value
  function propIndex() { return propMarket().index; }
  function stepPropMarket(dt) {
    const m = propMarket();
    // mean reversion toward 1.0
    let v = (1 - m.index) * MKT.revert;
    // momentum (trends persist), refreshed by a small random impulse
    m.momentum = m.momentum * MKT.momentumDecay + (rng() - 0.5) * MKT.vol;
    v += m.momentum;
    // occasional boom / bust shock
    m.shockT -= dt;
    if (m.shockT <= 0) {
      m.shockT = 30 + rng() * 70;
      const shock = (rng() - 0.45) * 0.16;   // slight upward bias (inflation)
      m.momentum += shock;
    }
    m.index = Math.max(MKT.floor, Math.min(MKT.ceil, m.index + v));
    m.trend = m.momentum > 0.004 ? "rising" : m.momentum < -0.004 ? "falling" : "steady";
    if (CBZ.now != null) {
      const h = m.history;
      if (!h._t || CBZ.now - h._t > 6) { h._t = CBZ.now; h.push(m.index); if (h.length > 40) h.shift(); }
    }
  }
  // mortgage / finance terms (used by zillow.js for financed buys)
  const FINANCE = {
    minDownFrac: 0.20,    // smallest down payment on a financed purchase
    rate: 0.06,           // periodic interest charged on the outstanding balance
    minPaymentFrac: 0.04, // minimum principal+interest payment per finance tick
    maxLTV: 0.80,         // most you can borrow vs. value (1 - minDown)
  };

  CBZ.onUpdate(30.2, function (dt) {
    if (g.mode !== "city") return;
    stepPropMarket(dt);
  });

  CBZ.cityEcon = {
    ITEMS, SHOP_STOCK, CARS, rng,
    add, has, count, take, drip, buyPrice, sellPrice, wholesalePrice,
    stockFor(kind) { return SHOP_STOCK[kind] || []; },
    streetPrice, recordSale, initMarket,
    rollCash, rollWallet, pickCar, carByName,
    // property market: a drifting macro index Zillow multiplies prices by
    propIndex, propMarket, initPropMarket, FINANCE,
    propTrend() { return propMarket().trend; },
    propHistory() { return propMarket().history.slice(); },
    randomLoot(rich) {
      const pool = rich
        ? ["Phone", "Wallet", "Cash Stack", "Gold Chain", "Rolex", "Laptop", "Diamond Ring"]
        : ["Wallet", "Phone", "Sunglasses", "Sneakers"];
      return pool[(rng() * pool.length) | 0];
    },
  };
})();
