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

  function buyPrice(name) {
    const it = ITEMS[name]; if (!it) return 0;
    // Drugs you buy at the trap house track the wholesale market: when product
    // is OVERSUPPLIED (a district dumped, or a glut event) it's cheap to stock
    // up — buy low. Everything else is flat retail.
    if (it.tag === "drug") return wholesalePrice(name);
    return Math.round(it.value * 1.0);
  }
  function sellPrice(name, kind) {
    const it = ITEMS[name]; if (!it) return 0;
    let mul = 0.45;
    if (kind === "pawn") mul = it.tag === "valuable" ? 0.65 : 0.5;
    if (kind === "jewelry" && it.tag === "wearable") mul = 0.6;
    if (kind === "electronics" && it.tag === "valuable") mul = 0.62;
    // a fenced item is worth more when you've built a rep with the fences
    // (a real money sink to chase): higher Fence Rep = a smaller haircut.
    const fence = fenceBonus();
    if (it.tag === "valuable" || it.tag === "wearable") mul = Math.min(0.92, mul + fence);
    return Math.max(1, Math.round(it.value * mul));
  }
  // Pawn/fence loyalty: each fence sale nudges a hidden rep up; it bumps your
  // resale multiplier (capped). This rewards the buy-low/sell-high loop without
  // ever paying more than the item's clean value.
  function fenceBonus() { return Math.min(0.18, (g.cityFenceRep || 0) * 0.012); }
  function bumpFenceRep(n) { g.cityFenceRep = Math.min(40, (g.cityFenceRep || 0) + (n || 1)); }

  // ============================================================
  //  THE LIVING STREET DRUG MARKET  (supply & demand, per district)
  // ------------------------------------------------------------
  //  Real economics, GTA:Chinatown-Wars style. Each of the city's DISTRICTS
  //  has its own price level per drug that mean-reverts to a baseline "demand"
  //  that varies by neighbourhood (the projects love cheap highs; downtown
  //  pays top dollar for coke). Selling FLOODS that district's price down;
  //  buying (you draining stock, or NPC demand) lifts it. Scarcity + a hot
  //  "tip" event spike prices for a short window — sell into the spike. Heat
  //  scares buyers everywhere. Prices recover toward baseline over time.
  // ============================================================
  const DRUGS = ["Weed", "Coke", "Meth", "Pills"];

  // Districts are derived from world position (see districtAt). Each has a
  // demand profile: a per-drug baseline multiplier. >1 = pays a premium here,
  // <1 = saturated / low demand. Tuned so a smart dealer arbitrages between
  // them (buy coke cheap uptown, sell it downtown).
  const DISTRICTS = {
    downtown:  { name: "Downtown",   tier: 1.00, demand: { Weed: 0.9, Coke: 1.45, Meth: 0.8,  Pills: 1.25 } },
    projects:  { name: "The Projects", tier: 0.78, demand: { Weed: 1.3, Coke: 0.85, Meth: 1.5, Pills: 1.05 } },
    waterfront:{ name: "Waterfront", tier: 0.92, demand: { Weed: 1.1, Coke: 1.2,  Meth: 1.15, Pills: 0.9 } },
    uptown:    { name: "Uptown",     tier: 1.15, demand: { Weed: 0.8, Coke: 1.6,  Meth: 0.7,  Pills: 1.4 } },
    island:    { name: "The Island", tier: 1.30, demand: { Weed: 1.0, Coke: 1.7,  Meth: 0.9,  Pills: 1.55 } },
  };
  const DISTRICT_KEYS = Object.keys(DISTRICTS);

  // figure out which district a world (x,z) sits in. Mainland is split into
  // quadrants around the city centre; the connected annex is "island".
  function districtAt(x, z) {
    const A = CBZ.city && CBZ.city.annex;
    if (A && Math.hypot(x - A.cx, z - A.cz) <= A.radius + 6) return "island";
    const c = CBZ.city && CBZ.city.center;
    if (!c) return "downtown";
    const dx = x - c.x, dz = z - c.z;
    // NE = uptown (rich), SW = projects (poor), NW = downtown, SE = waterfront
    if (dx >= 0 && dz < 0) return "uptown";
    if (dx < 0 && dz >= 0) return "projects";
    if (dx >= 0 && dz >= 0) return "waterfront";
    return "downtown";
  }
  function districtAtPos(p) { p = p || (CBZ.player && CBZ.player.pos) || { x: 0, z: 0 }; return districtAt(p.x, p.z); }
  function districtName(key) { const d = DISTRICTS[key || playerDistrict()]; return d ? d.name : "the city"; }
  function playerDistrict() { return districtAtPos(CBZ.player && CBZ.player.pos); }

  // ---- TERRITORY → MARGINS (Chinatown-Wars inter-gang arbitrage) ------------
  // Each district maps to a representative world point so we can ask the turf
  // system who CONTROLS the ground there. Dealing on turf you (or an ally) own
  // is safer and FATTER; dealing on a rival's block is hostile, low-margin
  // ground. The classic play: source product cheap on one crew's turf, haul it
  // to a rival district that pays a premium. We cache the (x,z) anchor once.
  function districtAnchor(dk) {
    const c = (CBZ.city && CBZ.city.center) || { x: 0, z: 0 };
    const A = CBZ.city && CBZ.city.annex;
    const R = 70;   // step out from centre into the quadrant
    switch (dk) {
      case "uptown":     return { x: c.x + R, z: c.z - R };
      case "projects":   return { x: c.x - R, z: c.z + R };
      case "waterfront": return { x: c.x + R, z: c.z + R };
      case "island":     return A ? { x: A.cx, z: A.cz } : { x: c.x, z: c.z };
      default:           return { x: c.x - R, z: c.z - R };   // downtown
    }
  }
  // Who owns the player's current crew? (turf uses the string id "player".)
  function playerGangId() {
    const pg = g.playerGang;
    if (pg && pg.founded) return pg.id || "player";
    return g.playerGangId || null;
  }
  // Turf relationship of a district to the player: "home" (you own it),
  // "allied", "rival" (an enemy crew holds it), or "neutral".
  function turfStanding(dk) {
    if (!CBZ.cityZoneOwner) return "neutral";
    const a = districtAnchor(dk);
    const owner = CBZ.cityZoneOwner(a.x, a.z);
    if (!owner) return "neutral";
    const me = playerGangId();
    if (me && owner === me) return "home";
    if (me && CBZ.cityAreAllied && CBZ.cityAreAllied(me, owner)) return "allied";
    if (me && CBZ.cityAtWar && CBZ.cityAtWar(me, owner)) return "rival";
    // any non-player owner with no explicit relation: mildly hostile ground
    return owner === "player" ? "home" : "rival";
  }
  // Sell-side margin multiplier for a district given who controls it. Home turf
  // pays you the best (your protection, your prices, no tax to a rival); a rival
  // block skims you. This is the real reward for TAKING territory.
  function turfSellMult(dk) {
    switch (turfStanding(dk)) {
      case "home":   return 1.22;   // your block, your cut
      case "allied": return 1.08;   // friendly ground
      case "rival":  return 0.82;   // they tax outsiders / squeeze you
      default:       return 1.0;
    }
  }
  // Buy-side: sourcing wholesale on turf you control is cheaper (your supplier,
  // your terms); a rival's connect gouges you. Inverse-ish of the sell side, so
  // owning supply districts cheap + selling on demand districts is the loop.
  function turfBuyMult(dk) {
    switch (turfStanding(dk)) {
      case "home":   return 0.86;   // friends-and-family wholesale
      case "allied": return 0.94;
      case "rival":  return 1.18;   // rival connect taxes you hard
      default:       return 1.0;
    }
  }
  // bust-risk multiplier other modules (careers.js) can fold in: rival ground is
  // dangerous, your own block is covered.
  function turfRiskMult(dk) {
    switch (turfStanding(dk || playerDistrict())) {
      case "home":   return 0.5;
      case "allied": return 0.8;
      case "rival":  return 1.9;
      default:       return 1.0;
    }
  }

  // Per-district, per-drug live price-level state (mean-reverts to baseline).
  function initMarket() {
    g.cityDrugMkt = { Weed: 1, Coke: 1, Meth: 1, Pills: 1 };   // legacy global (kept for compat)
    g.cityDrugNoise = 1;
    const lvl = {};
    for (const dk of DISTRICT_KEYS) { lvl[dk] = {}; for (const d of DRUGS) lvl[dk][d] = 1; }
    g.cityDrugDist = lvl;
    // a rolling "hot tip": one district pays a big premium for one drug for a
    // limited window (Chinatown-Wars dealer tip-offs). null until first event.
    g.cityDrugTip = null;
    g.cityMktClock = 0;
  }
  function distLevels(dk) {
    if (!g.cityDrugDist) initMarket();
    if (!g.cityDrugDist[dk]) { g.cityDrugDist[dk] = {}; for (const d of DRUGS) g.cityDrugDist[dk][d] = 1; }
    return g.cityDrugDist[dk];
  }

  // The wholesale (buy) price you pay the trap house — also district-aware and
  // supply-driven, so a glutted district is cheap to source from. Baseline is
  // 0.8× value; oversupply (level<1) drops it, scarcity (level>1) raises it.
  function wholesalePrice(drug, dk) {
    const it = ITEMS[drug]; if (!it || it.tag !== "drug") return it ? Math.round(it.value * 0.8) : 0;
    dk = dk || playerDistrict();
    const lv = distLevels(dk)[drug] != null ? distLevels(dk)[drug] : 1;
    // wholesale tracks the level but is dampened (the supplier keeps a margin):
    // a GLUTTED block (lv<1) dumps cheap, a DRY block (lv>1) charges scarcity.
    const supply = 0.6 + 0.4 * lv;
    // Territory: your own supply connect is cheap, a rival's gouges you. This is
    // half the arbitrage — buy where you control, sell where they pay.
    const turf = turfBuyMult(dk);
    return Math.max(1, Math.round(it.value * 0.8 * supply * turf));
  }

  // What a street buyer pays you for one unit, here & now. Combines:
  //   value × retail markup × district demand × live level × heat × tip × noise
  function streetPrice(drug, dk) {
    const it = ITEMS[drug]; if (!it || it.tag !== "drug") return 0;
    dk = dk || playerDistrict();
    const D = DISTRICTS[dk] || DISTRICTS.downtown;
    const lv = distLevels(dk)[drug] != null ? distLevels(dk)[drug] : 1;
    const demand = (D.demand[drug] || 1) * D.tier;             // neighbourhood appetite + wealth
    // HEAT as a RISK PREMIUM: a hot block has fewer dealers willing to work it,
    // so product on the street gets SCARCER and pricier — up to a point. Past a
    // few stars the buyers themselves get spooked and it caves. Net: a gentle
    // bump (risk premium) then a fall (panic), so working hot is a real gamble.
    const w = g.wanted | 0;
    const risk = w <= 3 ? (1 + 0.06 * w) : (1.18 - 0.10 * (w - 3));
    const noise = 0.86 + rng() * 0.42;                         // per-deal haggling
    const retail = 2.15;                                       // street markup over wholesale
    const turf = turfSellMult(dk);                             // your block pays best
    let tip = 1;
    const t = g.cityDrugTip;
    if (t && t.dk === dk && t.drug === drug && (CBZ.now == null || CBZ.now < t.until)) tip = t.mult;
    const p = it.value * retail * demand * lv * Math.max(0.45, risk) * turf * tip * noise;
    return Math.max(1, Math.round(p));
  }

  // Selling DUMPS product into the local district: price level drops (more so
  // for bigger dumps — diminishing the deeper you flood). Recovers over time.
  function recordSale(drug, n, dk) {
    if (!g.cityDrugDist) initMarket();
    dk = dk || playerDistrict();
    n = n || 1;
    const lvl = distLevels(dk);
    const cur = lvl[drug] != null ? lvl[drug] : 1;
    const flood = (E.drugFlood || 0.14) * n * (0.5 + 0.5 * cur);   // bites harder near baseline
    lvl[drug] = Math.max(0.32, cur - flood);
    // a small ripple to neighbouring districts (regional glut)
    for (const k of DISTRICT_KEYS) if (k !== dk) { const v = distLevels(k); v[drug] = Math.max(0.4, (v[drug] != null ? v[drug] : 1) - flood * 0.18); }
    // dumping a big load with heat on you risks a bust tip-off (handled by
    // careers.js); record demand satisfaction so prices sag here.
    g.cityDrugMkt[drug] = Math.max(0.35, (g.cityDrugMkt[drug] != null ? g.cityDrugMkt[drug] : 1) - (E.drugFlood || 0.14) * n);
  }
  // Buying wholesale DRAINS supply here → local scarcity lifts the level a bit
  // (so panic-buying a district's whole stock pushes prices up).
  function recordBuy(drug, n, dk) {
    if (!g.cityDrugDist) initMarket();
    dk = dk || playerDistrict();
    n = n || 1;
    const lvl = distLevels(dk);
    const cur = lvl[drug] != null ? lvl[drug] : 1;
    lvl[drug] = Math.min(2.4, cur + (E.drugFlood || 0.14) * 0.5 * n);
  }

  // The best place to OFF-LOAD a drug right now (for HUD hints / tips).
  function bestMarket(drug) {
    let best = null, bp = -1;
    for (const dk of DISTRICT_KEYS) { const p = streetPriceNoNoise(drug, dk); if (p > bp) { bp = p; best = dk; } }
    return { dk: best, name: districtName(best), price: bp };
  }
  function streetPriceNoNoise(drug, dk) {
    const it = ITEMS[drug]; if (!it || it.tag !== "drug") return 0;
    const D = DISTRICTS[dk] || DISTRICTS.downtown;
    const lv = distLevels(dk)[drug] != null ? distLevels(dk)[drug] : 1;
    const demand = (D.demand[drug] || 1) * D.tier;
    const turf = turfSellMult(dk);
    let tip = 1; const t = g.cityDrugTip;
    if (t && t.dk === dk && t.drug === drug && (CBZ.now == null || CBZ.now < t.until)) tip = t.mult;
    return Math.round(it.value * 2.15 * demand * lv * turf * tip);
  }
  // current tip-off, if active (careers/HUD can surface it as "word on the street")
  function activeTip() {
    const t = g.cityDrugTip;
    if (t && (CBZ.now == null || CBZ.now < t.until)) return t;
    return null;
  }

  // ---- market drift: recovery + boom/bust events + rolling hot tips --------
  CBZ.onUpdate(30, function (dt) {
    if (g.mode !== "city") return;
    if (!g.cityDrugDist) return;
    const drift = (E.drugDrift || 0.05) * dt;
    // every district recovers toward its demand-shaped fair level (≈1)
    for (const dk of DISTRICT_KEYS) {
      const lvl = g.cityDrugDist[dk];
      for (const d of DRUGS) lvl[d] += (1 - lvl[d]) * drift;
    }
    // keep the legacy global level alive too (other code may read it)
    for (const k in g.cityDrugMkt) g.cityDrugMkt[k] += (1 - g.cityDrugMkt[k]) * drift;

    // expire / roll a hot tip-off. A new one fires every ~35–70s: one district
    // suddenly pays a premium for one drug for ~20–40s. Sell into the spike.
    g.cityMktClock = (g.cityMktClock || 0) + dt;
    const tip = g.cityDrugTip;
    const expired = !tip || (CBZ.now != null && CBZ.now >= tip.until);
    if (expired && g.cityMktClock > (tip ? 12 : 8)) {
      if (rng() < dt * 0.06) {            // sparse: a real "word on the street" moment
        const dk = DISTRICT_KEYS[(rng() * DISTRICT_KEYS.length) | 0];
        const drug = DRUGS[(rng() * DRUGS.length) | 0];
        const mult = 1.6 + rng() * 1.1;   // 1.6×–2.7× premium
        const dur = (20 + rng() * 22) * 1000;   // CBZ.now is in ms
        g.cityDrugTip = { dk, drug, mult, until: (CBZ.now || 0) + dur, started: CBZ.now || 0 };
        g.cityMktClock = 0;
        // also create the scarcity that justifies the premium
        const lvl = distLevels(dk); lvl[drug] = Math.min(2.6, lvl[drug] + 0.6);
        if (CBZ.city && CBZ.city.note) {
          CBZ.city.note("Word on the street: " + DISTRICTS[dk].name + " is paying big for " + drug + ".", 2.6);
        }
      }
    }
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

  // ============================================================
  //  WEALTH TIERS, FAUCETS & SINKS — make money MEANINGFUL
  // ------------------------------------------------------------
  //  A player's total NET WORTH (cash + bank + property + cars + worn ice)
  //  places them in a tier: broke → hustler → comfortable → rich → KINGPIN.
  //  Tiers gate flavour, drive the cost of luxury sinks (which scale with how
  //  rich you are, the elastic-sink trick that keeps high earners spending),
  //  and let other modules react ("the kingpin walks in"). NET WORTH is the
  //  scoreboard, not raw cash.
  // ============================================================
  const TIERS = [
    { id: "broke",       name: "Broke",        min: 0,        color: "#8a93a3" },
    { id: "hustler",     name: "Hustler",      min: 2500,     color: "#9fd07e" },
    { id: "comfortable", name: "Comfortable",  min: 25000,    color: "#7fd0ff" },
    { id: "rich",        name: "Rich",         min: 150000,   color: "#ffd166" },
    { id: "baller",      name: "Baller",       min: 600000,   color: "#ff9e6b" },
    { id: "kingpin",     name: "KINGPIN",      min: 2500000,  color: "#ff5d7e" },
  ];
  // total value of items the player is carrying (jewellery, valuables, drugs)
  function invWorth() {
    const inv = g.cityInv || {}; let s = 0;
    for (const k in inv) { const it = ITEMS[k]; if (it && it.value) s += it.value * inv[k] * (it.tag === "drug" ? 1.5 : 1); }
    return s | 0;
  }
  // property + business equity, asked from zillow/empire if present
  function holdingsWorth() {
    let s = 0;
    if (CBZ.cityZillow && CBZ.cityZillow.portfolioValue) s += CBZ.cityZillow.portfolioValue() | 0;
    else if (g.cityProps) { for (const p of g.cityProps) s += (p.equity || p.value || 0); }
    if (CBZ.cityEmpire && CBZ.cityEmpire.bizValue) s += CBZ.cityEmpire.bizValue() | 0;
    if (g.cityGarage) { for (const c of g.cityGarage) { const car = carByName(c.name || c); if (car) s += (car.value * 0.85) | 0; } }
    return s | 0;
  }
  function netWorth() {
    return ((g.cash || 0) + (g.cityBank || 0) + invWorth() + holdingsWorth()) | 0;
  }
  function wealthTier(nw) {
    nw = nw == null ? netWorth() : nw;
    let t = TIERS[0];
    for (const x of TIERS) if (nw >= x.min) t = x;
    return t;
  }
  // 0..1 progress toward the NEXT tier (for a HUD bar)
  function tierProgress(nw) {
    nw = nw == null ? netWorth() : nw;
    let cur = TIERS[0], next = null;
    for (let i = 0; i < TIERS.length; i++) { if (nw >= TIERS[i].min) { cur = TIERS[i]; next = TIERS[i + 1] || null; } }
    if (!next) return 1;
    return Math.max(0, Math.min(1, (nw - cur.min) / (next.min - cur.min)));
  }

  // ============================================================
  //  TURF INCOME — protection / taxes off the blocks you CONTROL
  // ------------------------------------------------------------
  //  Every zone your crew holds pays a daily street tax: shops kick up
  //  protection, dealers pay rent on the corner, residents pay "insurance".
  //  Per-zone take scales with the DISTRICT'S WEALTH (uptown/island blocks are
  //  worth far more than the projects), your CREW SIZE (more soldiers = more
  //  collectors working the doors), your GANG RANK (a boss skims the whole
  //  operation; a soldier just gets a cut), and HEAT (a hot block earns less —
  //  people lie low, cops sniff around). This is the backbone faucet that makes
  //  TAKING TERRITORY the point of the game. Other modules read turfIncome().
  // ------------------------------------------------------------
  //  Map a zone's centre to the richest-matching district tier so its tax tracks
  //  neighbourhood wealth even though zones are finer-grained than districts.
  function zoneWealthMul(cx, cz) {
    const D = DISTRICTS[districtAt(cx, cz)] || DISTRICTS.downtown;
    return D.tier;                          // 0.78 (projects) .. 1.30 (island)
  }
  // crew multiplier: 1 soldier ~ base; it scales sub-linearly so a huge crew
  // doesn't print infinite money (diminishing collectors).
  function crewMul() {
    let n = 0;
    if (CBZ.cityPlayerGangMembers) { const m = CBZ.cityPlayerGangMembers(); n = (m && m.length) || 0; }
    else n = (g.cityCrew | 0);
    return 1 + 0.5 * Math.sqrt(Math.max(0, n));   // 0 crew→1×, 4→2×, 16→3×
  }
  // rank multiplier: a member of an NPC crew skims less than a boss of their own.
  function rankMul() {
    const pg = g.playerGang;
    if (pg && pg.founded) return 1.0;             // you ARE the boss → full take
    const mem = g.cityMembership;
    if (mem) {
      const r = mem.rank;
      if (r === "boss" || r === "underboss") return 0.85;
      if (r === "lt" || r === "lieutenant" || r === "capo") return 0.45;
      return 0.22;                                // soldier's cut of the street tax
    }
    return 0;                                      // no crew → no turf income
  }
  // $/sec the player earns right now from every zone their crew controls.
  function turfIncome() {
    if (!CBZ.cityZoneControl || !CBZ.cityZones) return 0;
    const me = playerGangId();
    if (!me) return 0;
    const ctrl = CBZ.cityZoneControl();
    const owned = (ctrl.byGang && ctrl.byGang[me]) || 0;
    if (owned <= 0) return 0;
    const rank = rankMul(); if (rank <= 0) return 0;
    const base = (E.turfTaxPerZone || 4.5);       // $/sec per held zone, baseline
    const crew = crewMul();
    const heatPenalty = Math.max(0.4, 1 - 0.06 * (g.wanted | 0));
    // weight each held zone by its neighbourhood wealth
    let wealthSum = 0, n = 0;
    for (const z of CBZ.cityZones()) {
      if (z.owner === me) { wealthSum += zoneWealthMul(z.cx, z.cz); n++; }
    }
    const wealthAvg = n > 0 ? wealthSum / n : 1;
    // wealth-TIER perk: a tighter, more feared operation skims more off the
    // blocks (a kingpin's tax collectors don't get shorted). Feature-detected
    // from wealth.js so economy.js stays standalone.
    const perk = (CBZ.cityWealth && CBZ.cityWealth.tierPerk) ? (CBZ.cityWealth.tierPerk("turfMul") || 1) : 1;
    return base * owned * wealthAvg * crew * rank * heatPenalty * perk;
  }
  // a HUD-friendly breakdown of where the turf money comes from
  function turfIncomeInfo() {
    const me = playerGangId();
    const ctrl = (me && CBZ.cityZoneControl) ? CBZ.cityZoneControl() : { byGang: {}, total: 0 };
    const owned = (ctrl.byGang && ctrl.byGang[me]) || 0;
    return { zones: owned, total: ctrl.total || 0, perSec: Math.round(turfIncome()), crewMul: crewMul(), rankMul: rankMul() };
  }

  // ---- HIGH-VALUE FAUCETS (let a hustler actually get filthy rich) ---------
  // A risk-scaled cash drop for big scores (heist, robbery, kill bounty). The
  // payout scales with how RISKY it was (heat) and your respect (rep = access
  // to bigger jobs), so a kingpin's scores dwarf a rookie's. This is the faucet
  // that funds the climb — other modules call it for their reward amounts.
  function scoreReward(base, opts) {
    opts = opts || {};
    const heatMul = 1 + 0.10 * (g.wanted | 0);                 // riskier = richer
    const repMul = 1 + Math.min(1.4, (g.respect || 0) / 400);  // rep unlocks bigger paydays
    const luck = 0.85 + rng() * 0.4;
    let v = base * heatMul * repMul * luck;
    if (opts.tier) v *= (1 + 0.25 * (wealthTier().min > 0 ? TIERS.indexOf(wealthTier()) : 0));
    return Math.max(1, Math.round(v));
  }

  // ---- SERIOUS MONEY SINKS (so wealth stays meaningful) --------------------
  // Luxury / vanity sinks PRICE UP with your net worth (an elastic sink — the
  // richer you are, the more it costs to flex), which keeps draining whales so
  // money never becomes infinite & worthless. Other modules query these.
  const SINKS = {
    // a night out / bottle service / flexing — pure vanity drain
    bottleService(nw) { nw = nw == null ? netWorth() : nw; return Math.max(250, Math.round(250 + nw * 0.01)); },
    // daily property TAX as a fraction of holdings (recurring drain on the rich)
    propertyTaxRate: 0.00008,  // light background upkeep; Zillow owns property cashflow
    // bribing the cops scales with how much you're worth (they smell money) —
    // but your wealth-TIER perk (bribeDisc, from wealth.js) shaves it down: a
    // kingpin has cops on payroll, so money literally talks.
    bribeCost(stars, nw) {
      nw = nw == null ? netWorth() : nw;
      const base = (E.bribeBase || 150) * Math.max(1, stars || 1);
      let cost = base * (1 + Math.min(3, nw / 400000));
      const disc = (CBZ.cityWealth && CBZ.cityWealth.tierPerk) ? (CBZ.cityWealth.tierPerk("bribeDisc") || 0) : 0;
      cost *= (1 - Math.min(0.6, disc));
      return Math.max(1, Math.round(cost));
    },
    // hospital / repair / re-arm after a death — a sink that bites the careless
    medicalBill(nw) { nw = nw == null ? netWorth() : nw; return Math.max(200, Math.round(200 + nw * 0.004)); },
    // launder dirty cash: you lose a cut but it becomes safe (bank). The cut
    // SHRINKS as you build laundering infrastructure (businesses) — a real sink
    // that also rewards investing in the empire.
    launderCut() {
      let cut = 0.25;
      if (CBZ.cityEmpire && CBZ.cityEmpire.laundromats) cut -= 0.03 * (CBZ.cityEmpire.laundromats() | 0);
      return Math.max(0.06, cut);
    },
  };
  // Recurring tax/upkeep drain on the wealthy — called by the wage/income tick
  // (careers.js). Returns the $ to deduct this tick; keeps the rich spending.
  function upkeepDue() {
    const h = holdingsWorth();
    if (h <= 0) return 0;
    return Math.round(h * SINKS.propertyTaxRate);
  }
  // Convert dirty street cash to safe banked cash, minus a laundering haircut.
  // Returns { banked, lost } and applies it. A core sink for drug profits.
  function launder(amount) {
    amount = Math.max(0, amount | 0);
    if (amount <= 0) return { banked: 0, lost: 0 };
    const cut = SINKS.launderCut();
    const lost = Math.round(amount * cut);
    const banked = amount - lost;
    if (CBZ.city && CBZ.city.spend) CBZ.city.spend(amount); else g.cash = Math.max(0, (g.cash || 0) - amount);
    g.cityBank = (g.cityBank || 0) + banked;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return { banked, lost };
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
  // A single macro index that drifts slowly around 1.0. Zillow multiplies every
  // listing's base estimate by this index so values can move over a run without
  // twitching every frame.
  const MKT = {
    floor: 0.90, ceil: 1.14,     // housing should drift, not arcade-pulse
    sample: 18,                  // seconds between market samples
    revert: 0.018,               // pull back toward fair value per sample
    vol: 0.004,                  // small sample impulse
    momentumDecay: 0.62,
  };
  function initPropMarket() {
    g.cityPropMkt = { index: 1, momentum: 0, trend: "steady", sampleT: 0, shockT: 240 + rng() * 180, history: [1] };
  }
  function propMarket() { if (!g.cityPropMkt) initPropMarket(); return g.cityPropMkt; }
  // current macro multiplier applied to every property's base value
  function propIndex() { return propMarket().index; }
  function stepPropMarket(dt) {
    const m = propMarket();
    m.sampleT = (m.sampleT || 0) + dt;
    if (m.sampleT < MKT.sample) return;
    const elapsed = Math.min(90, m.sampleT);
    m.sampleT = 0;
    const scale = Math.max(0.25, Math.min(2, elapsed / 60));
    // mean reversion toward 1.0
    let v = (1 - m.index) * MKT.revert * scale;
    m.momentum = m.momentum * MKT.momentumDecay + (rng() - 0.5) * MKT.vol * scale;
    v += m.momentum;
    // rare, mild neighborhood headline. No boom/bust slot-machine swings.
    m.shockT -= elapsed;
    if (m.shockT <= 0) {
      m.shockT = 240 + rng() * 240;
      const shock = (rng() - 0.5) * 0.018;
      m.momentum += shock;
    }
    m.index = Math.max(MKT.floor, Math.min(MKT.ceil, m.index + v));
    m.trend = m.momentum > 0.0015 ? "rising" : m.momentum < -0.0015 ? "falling" : "steady";
    if (CBZ.now != null) {
      const h = m.history;
      if (!h._t || CBZ.now - h._t > 30000) { h._t = CBZ.now; h.push(m.index); if (h.length > 40) h.shift(); }
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

  // ---- recurring upkeep/tax drain on the wealthy (a real money SINK) -------
  // Once you own property/business, you owe upkeep + tax every payTick. This
  // keeps the rich from sitting on a static pile — money must keep MOVING.
  CBZ.onUpdate(30.4, function (dt) {
    if (g.mode !== "city") return;
    g._upkeepClock = (g._upkeepClock || 0) + dt;
    const tick = (E.payTick || 6);
    if (g._upkeepClock < tick) return;
    g._upkeepClock -= tick;
    const due = upkeepDue();
    if (due > 0) {
      const bank = g.cityBank || 0;
      if (bank >= due) { g.cityBank = bank - due; }
      else { g.cityBank = 0; if (CBZ.city && CBZ.city.spend) CBZ.city.spend(due - bank); }
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    }
  });

  // ---- TURF INCOME PAYOUT (the protection/tax faucet) ----------------------
  // Pay out the held-turf street tax every payTick. Accumulates fractional cash
  // so even a one-zone crew eventually gets paid, and surfaces a one-line note
  // on the first collection so the player learns the loop. CHEAP: one timer,
  // gated to city mode + actually holding turf.
  let _turfShown = false;
  CBZ.onUpdate(30.6, function (dt) {
    if (g.mode !== "city") return;
    const rate = turfIncome();
    if (rate <= 0) { g._turfAcc = 0; return; }
    g._turfClock = (g._turfClock || 0) + dt;
    const tick = (E.payTick || 6);
    if (g._turfClock < tick) return;
    g._turfClock -= tick;
    g._turfAcc = (g._turfAcc || 0) + rate * tick;
    const pay = Math.floor(g._turfAcc);
    if (pay >= 1) {
      g._turfAcc -= pay;
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(pay);
      g.cityTurfEarned = (g.cityTurfEarned || 0) + pay;
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      if (!_turfShown && CBZ.city && CBZ.city.note) {
        _turfShown = true;
        const info = turfIncomeInfo();
        CBZ.city.note("💰 Street tax from your " + info.zones + " block" + (info.zones === 1 ? "" : "s") + ": +$" + pay + " (" + info.perSec + "/s). Take more turf, earn more.", 3);
      }
    }
  });

  CBZ.cityEcon = {
    ITEMS, SHOP_STOCK, CARS, rng,
    add, has, count, take, drip, buyPrice, sellPrice, wholesalePrice,
    stockFor(kind) { return SHOP_STOCK[kind] || []; },
    streetPrice, recordSale, recordBuy, initMarket,
    rollCash, rollWallet, pickCar, carByName,
    // --- living street market (supply & demand, per district) ---
    DISTRICTS, districtAt, districtAtPos, districtName, playerDistrict,
    bestMarket, activeTip, fenceBonus, bumpFenceRep,
    // --- territory → margins + risk + the turf-tax faucet ---
    turfStanding, turfSellMult, turfBuyMult, turfRiskMult, playerGangId,
    turfIncome, turfIncomeInfo,
    // --- wealth tiers, faucets & sinks ---
    TIERS, netWorth, invWorth, holdingsWorth, wealthTier, tierProgress,
    scoreReward, SINKS, upkeepDue, launder,
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
