/* ============================================================
   city/settlements.js — SETTLEMENT COMPOSITION + VARIETY (owner: "Like
   Minecraft you find villages in different biomes — but NOT hardcoded
   biomes each with the same building. Everything must have a purpose
   and be interactable. No bullshit fake shit.").

   WHY THIS EXISTS
   towngen.js grows a believable street/lot skeleton from a recipe, but
   WHICH buildings land on it was, until now, a pure weighted dice roll
   over the caller's prefab list — so a "town" could come up all houses
   and one diner, and two different country settlements built from the
   same baseTemplate looked identical. Real settlements are COMPOSED: a
   place of a given size in a given economy has a KNOWN portfolio — a
   general store and somewhere to eat first, then (as it grows) a bar, a
   bank, a clinic, a gunsmith, and — on a strip or a boomtown — a casino.

   This file is the composition brain. It does NOT build geometry (that
   stays towngen.js's job) — it hands towngen an ANCHOR PLAN: a
   deterministic map of {central lot -> a purposeful shop prefab}, drawn
   from a SEPARATE per-site rng stream (CBZ.lcgFromHash — folds
   WORLD_SEED, so it varies by seed and by position, and NEVER touches
   the shared town rng that determinism depends on). towngen forces those
   lots to build the planned shop; every one is furnished (a vendor
   counter + a real trade) by towngen's V2 furnish pass, so no anchor is
   a hollow box. Casinos are then upgraded to real gaming floors by
   casino.js's order-90 dress pass.

   FLAVOR: the settlement's look/name pool is chosen from its biome/
   district (desert/farmland/snow/forest/village/port/finance/neon/
   factory/generic). The caller's authored palette/prefabs are PREFERRED
   (Dry Gulch still reads Old-West); flavor only fills gaps and supplies
   the anchors' names + sign tints, so variety is additive, never a
   clobber.

   DETERMINISM CONTRACT (the top risk — see towngen.js fill loop):
   compose + planAnchors draw ONLY from siteRng (lcgFromHash), never
   cfg.rng. The fill loop still draws exactly 2 cfg.rng() values per built
   lot. With CONFIG.SETTLEMENTS_V2 = false this whole file is inert and
   the world is byte-identical to baseline.

   Revert: CBZ.CONFIG.SETTLEMENTS_V2 = false.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.SETTLEMENTS_V2 == null) CBZ.CONFIG.SETTLEMENTS_V2 = true;

  // -------------------------------------------------------------------------
  //  lcgFromHash — a seeded rng() folding WORLD_SEED + position + a salt
  //  string. This is the ONE canonical helper (minicities.js/countries.js
  //  each rolled their own ad-hoc lcg; this replaces that pattern and, used
  //  per-site, fixes countries.js's seed-invariant rngFor bug).
  // -------------------------------------------------------------------------
  function strHash(s) {
    s = String(s == null ? "" : s);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  CBZ.lcgFromHash = function (x, z, salt) {
    let s;
    if (CBZ.hashN) s = CBZ.hashN(Math.round(x), Math.round(z), strHash(salt)) >>> 0;
    else s = (((x | 0) * 73856093) ^ ((z | 0) * 19349663) ^ strHash(salt) ^ ((CBZ.WORLD_SEED | 0))) >>> 0;
    if (s === 0) s = 0x9e3779b9;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  };

  // =========================================================================
  //  FLAVORS — palette + name pools per settlement archetype. Palettes are
  //  FALLBACKS (caller palette wins); the sign tint + name pools drive the
  //  visible per-flavor variety of the anchor shops. Real small-town
  //  composition ("prebuilt legos of information") — names sourced from real
  //  frontier/farming/port/logging/mountain/finance/strip/industrial towns.
  // =========================================================================
  const FLAVORS = {
    desert: {
      palette: { wood: 0xa07c4c, accent: 0x6e5436, sign: "#f4e7c2" }, tint: 0xf0c04a,
      towns: ["Dry Gulch", "Rattlesnake Flats", "Coyote Wells", "Red Mesa", "Cactus Bend", "Vulture Gulch", "Sundown", "Deadhorse Crossing"],
      biz: {
        food: ["Last Chance Saloon", "Prairie Rose Diner", "Silver Spur Cantina", "Dusty Trail Grub"],
        store: ["Lucky Strike General Store", "Tumbleweed Trading Post", "Coyote Wells Mercantile", "Frontier Dry Goods"],
        bar: ["Silver Spur Saloon", "Dead Man's Hand", "Rattlesnake Jake's", "The Watering Hole"],
        gas: ["Mesa Fuel & Water", "Roadrunner Gas", "Basin Filling Station"],
        clinic: ["Dry Gulch Apothecary", "Doc Halloran's", "Frontier Clinic"],
        gunsmith: ["Rattlesnake Jake's Gunsmith", "Iron Sights", "Frontier Arms"],
        pawn: ["Assay Office & Pawn", "Prospector's Pawn", "Last Dollar Loans"],
        clothing: ["Frontier Outfitters", "Prairie Rose Outfitters", "Dry Goods & Denim"],
        bank: ["Territorial Bank", "Prospector's Trust", "Frontier Savings"],
        casino: ["Desert Diamond", "Golden Nugget", "Lucky Horseshoe", "Sundown Palace"],
      },
    },
    farmland: {
      palette: { wood: 0xb5443a, accent: 0xd8cdb0, sign: "#eaf3d8" }, tint: 0x2e7d32,
      towns: ["Millbrook", "Harvest Grove", "Clover Valley", "Wheaton Falls", "Pleasant Prairie", "Grange Hollow", "Sunflower Junction"],
      biz: {
        food: ["Sunflower Diner", "Harvest Table", "Clover Valley Cafe", "The Farmhouse Kitchen"],
        store: ["Harvest Grove General Store", "Barnwood Hardware", "Furrow & Fence Supply", "Feed & Seed"],
        bar: ["The Grange Tavern", "Silo Tap Room", "Millbrook Alehouse"],
        gas: ["Clover Valley Fuel", "Grange Co-op Gas", "Prairie Pump"],
        clinic: ["Harvest Grove Clinic", "Dr. Wheaton's Office", "Valley Health"],
        gunsmith: ["Fields & Forest Sporting", "Barnwood Firearms", "Grange Gun & Tackle"],
        pawn: ["Millbrook Pawn", "Second Harvest Loans", "Barn Door Trades"],
        clothing: ["Clover Valley Outfitters", "Harvest Threads", "Overalls & More"],
        bank: ["Pleasant Prairie Bank", "Farmers' Trust", "Grange Savings & Loan"],
        casino: ["Lucky Silo", "Golden Harvest Casino", "Cornerstone Cards"],
      },
    },
    snow: {
      palette: { wood: 0x7a6552, accent: 0x9fb0bd, sign: "#eaf2ff" }, tint: 0xbfe0ff,
      towns: ["Frostpeak", "Alpine Hollow", "Powderhorn", "Silvertip", "Winterhaven", "Glacier Notch", "Cragmont"],
      biz: {
        food: ["Winterhaven Diner", "The Warm Hearth", "Timberfrost Grill", "Base Camp Cafe"],
        store: ["Frostpeak General Store", "Snowdrift Mercantile", "Cragmont Trading Post", "Alpine Supply"],
        bar: ["Alpine Hollow Saloon", "The Frozen Tap", "Silvertip Lodge Bar"],
        gas: ["Glacier Notch Fuel", "Mountain Pass Gas", "Summit Filling"],
        clinic: ["Frostpeak Clinic", "Alpine Health Post", "Dr. Snow's"],
        gunsmith: ["Silvertip Outfitters & Arms", "Glacier Notch Sporting", "Timberline Firearms"],
        pawn: ["Silvertip Assay & Pawn", "Powderhorn Pawn", "Cold Cash Loans"],
        clothing: ["Glacier Notch Outfitters", "Alpine Wear", "Timberfrost Threads"],
        bank: ["Icefall Ridge Bank", "Summit Trust", "Silvertip Savings"],
        casino: ["Silver Summit Casino", "Powder Palace", "Glacier Gold"],
      },
    },
    forest: {
      palette: { wood: 0x6b4a2e, accent: 0x5f6b3e, sign: "#e6f0d8" }, tint: 0x8fbf5a,
      towns: ["Timberline", "Cedar Hollow", "Pinecrest", "Redwood Bend", "Knotpine", "Fir Junction", "Bristlecone Falls"],
      biz: {
        food: ["Loggers' Rest Tavern", "The Timberline Grill", "Cedar Hollow Cafe", "Sawmill Diner"],
        store: ["Cedar Hollow Company Store", "Fir Junction Hardware", "Timberline Feed & Tool", "Knotpine Lumberyard"],
        bar: ["Loggers' Rest", "The Broken Axe", "Redwood Bend Tavern"],
        gas: ["Fir Junction Fuel", "Old Growth Gas", "Millpond Filling"],
        clinic: ["Timberline Clinic", "Ranger Station Aid", "Dr. Cedar's"],
        gunsmith: ["Fir Junction Sporting Goods", "Bristlecone Arms", "Timber Rifle Co."],
        pawn: ["Sawdust Pawn", "Redwood Loans", "Second Growth Trades"],
        clothing: ["Cedar Hollow Outfitters", "Flannel & Boots", "Timberline Wear"],
        bank: ["Bristlecone Falls Bank", "Timber Trust", "Lumber Savings"],
        casino: ["Timberjack Casino", "Redwood Riches", "Knotpine Cards"],
      },
    },
    village: {
      palette: { wood: 0x6b5d4a, accent: 0x8a5a3a, sign: "#f4e7c2" }, tint: 0xd9b46a,
      towns: ["Kesh", "Mbeya", "Old Ford", "Riverbend", "Stonewell", "Thornby", "Gala"],
      biz: {
        food: ["Village Market", "The Common Pot", "Roadside Kitchen", "Grandmother's Table"],
        store: ["Village Provisions", "The Dry Goods Stall", "Crossroads Store", "Sundry Shop"],
        bar: ["The Village Inn", "The Old Well Tavern", "Crossroads Alehouse"],
        gas: ["Roadside Fuel", "Village Pump", "Crossroads Petrol"],
        clinic: ["Village Clinic", "The Aid Post", "Healer's House"],
        gunsmith: ["Village Smithy", "Crossroads Arms", "The Gun Rack"],
        pawn: ["Village Pawn", "The Trade House", "Coin & Barter"],
        clothing: ["Village Tailor", "Cloth & Thread", "The Weaver's"],
        bank: ["Village Savings", "Crossroads Bank", "The Money House"],
        casino: ["The Card House", "Village Fortune", "Riverbend Rolls"],
      },
    },
    port: {
      palette: { wood: 0x6f8a9a, accent: 0x3f5a6a, sign: "#e0f0ff" }, tint: 0x4fb0e0,
      towns: ["Herring Cove", "Gullport", "Saltmarsh", "Anchor Bay", "Tidewater", "Driftwood Harbor", "Foghorn Point"],
      biz: {
        food: ["Old Salt's Diner", "The Rusty Anchor", "Dockside Chowder", "Salty Anchor Tavern"],
        store: ["Tidewater General Store", "Cod's End Chandlery", "Anchor Bay Bait & Tackle", "Nettle Sound Net & Rope"],
        bar: ["The Rusty Anchor", "Foghorn Tavern", "Dockside Pub"],
        gas: ["Harbor Fuel Dock", "Gullport Marine Gas", "Pier Filling"],
        clinic: ["Anchor Bay Clinic", "Harbor Aid Station", "Dr. Gull's"],
        gunsmith: ["Driftwood Sporting", "Harbor Arms", "Tidewater Tackle & Gun"],
        pawn: ["Gullport Pawn", "Ship's Pawn", "Salt & Silver Loans"],
        clothing: ["Foghorn Outfitters", "Oilskin & Wool", "Harbor Threads"],
        bank: ["Tidewater Bank", "Harbor Trust", "Anchor Savings"],
        casino: ["Anchor Bay Casino", "The Gilded Gull", "Harbor Lights"],
      },
    },
    finance: {
      palette: { wood: 0x8a909c, accent: 0x555b66, sign: "#e8ecf5" }, tint: 0xd4af37,
      towns: ["Sterling Heights", "Exchange Square", "Vandermeer Plaza", "Meridian Center", "Union Trust Square", "Highgate", "Ironbridge"],
      biz: {
        food: ["Exchange Square Deli", "Marbleton Chophouse", "The Boardroom Grill", "Meridian Bistro"],
        store: ["Continental Sundries", "Meridian Supply", "Exchange Newsstand", "Union Provisions"],
        bar: ["The Bull & Bear", "Sterling Lounge", "Highgate Whiskey Room"],
        gas: ["Continental Fuel", "Meridian Garage", "Exchange Filling"],
        clinic: ["Meridian Medical", "Sterling Health Center", "Highgate Clinic"],
        gunsmith: ["Ironbridge Security Arms", "Continental Defense", "Sterling Firearms"],
        pawn: ["Highgate Pawn & Loan", "Sterling Collateral", "Exchange Pawn"],
        clothing: ["Sterling & Co. Tailors", "Vandermeer Menswear", "Continental Outfitters"],
        bank: ["Continental Trust", "Union Trust", "Meridian Reserve", "Sterling & Co."],
        casino: ["The Highgate Club", "Sterling Casino Royale", "Meridian Gold Room", "Continental Casino"],
      },
    },
    neon: {
      palette: { wood: 0x2a2438, accent: 0x4a3a6a, sign: "#ff8ad6" }, tint: 0xff3ea5,
      towns: ["Fortune Row", "Diamond Mile", "Neon Boulevard", "Jackpot Junction", "Lucky Row", "Mirage Mile", "Glimmer Strip"],
      biz: {
        food: ["All-Night Diner", "The Buffet", "Jackpot Grill", "Neon Noodle"],
        store: ["Jackpot Gift Shop", "Golden Mile Souvenirs", "24-Hour Sundries", "Strip Convenience"],
        bar: ["The Velvet Lounge", "Neon Cocktail Bar", "Diamond Mile Cigar Lounge"],
        gas: ["Strip Fuel", "Fortune Row Gas", "Neon Filling"],
        clinic: ["Strip Urgent Care", "Mirage Medical", "24-Hour Clinic"],
        gunsmith: ["Silver Dollar Arms", "Fortune Row Firearms", "Strip Security"],
        pawn: ["Neon Boulevard Pawn Shop", "Lucky Row Liquor & Loans", "Silver Dollar Pawn"],
        clothing: ["Glitz & Sequins", "Strip Style", "Fortune Threads"],
        bank: ["Jackpot Trust", "Fortune Row Bank", "Diamond Savings"],
        casino: ["Golden Ace", "Ruby Fortune", "Emerald Mirage", "Starlight Jackpot", "High Roller's Paradise", "Crown & Chip", "Silver Dollar Casino"],
      },
    },
    factory: {
      palette: { wood: 0x8a5a44, accent: 0x555049, sign: "#f0dcc4" }, tint: 0xd98a2b,
      towns: ["Ironforge", "Millhaven", "Furnace Row", "Steelton", "Coalridge", "Rustwater", "Foundryville"],
      biz: {
        food: ["Foundryville Diner", "The Shift Canteen", "Boilerworks Grill", "Furnace Row Cafe"],
        store: ["Steelton Company Store", "Smokestack Flats Hardware", "Ironforge Supply", "Mill Provisions"],
        bar: ["Boilerworks Tavern", "The Union Local", "Furnace Row Alehouse"],
        gas: ["Foundry Fuel", "Rail Yard Gas", "Steelton Filling"],
        clinic: ["Millhaven Clinic", "Company Aid Station", "Foundry Health"],
        gunsmith: ["Ironforge Arms", "Steelton Sporting", "Furnace Firearms"],
        pawn: ["Rustwater Pawn", "Payday Loans", "Steel & Silver Pawn"],
        clothing: ["Coalridge Workwear", "Foundry Outfitters", "Millhaven Threads"],
        bank: ["Steelton Bank", "Ironforge Trust", "Millhaven Savings"],
        casino: ["Foundry Casino", "The Rolling Mill", "Furnace Fortune"],
      },
    },
    generic: {
      palette: { wood: 0x9c7b4e, accent: 0x7a5a36, sign: "#f4e7c2" }, tint: 0xd9b46a,
      towns: ["Fairview", "Riverton", "Elmwood", "Bridgeport", "Ashford", "Northgate", "Kingsley"],
      biz: {
        food: ["Main Street Diner", "The Corner Cafe", "Town Grill", "Riverton Kitchen"],
        store: ["Fairview General Store", "Main Street Hardware", "Town Supply", "Elmwood Provisions"],
        bar: ["The Corner Tavern", "Bridgeport Pub", "Main Street Alehouse"],
        gas: ["Fairview Fuel", "Riverton Gas", "Town Filling"],
        clinic: ["Fairview Clinic", "Riverton Health", "Dr. Ashford's"],
        gunsmith: ["Main Street Sporting", "Bridgeport Arms", "Town Firearms"],
        pawn: ["Fairview Pawn", "Main Street Loans", "Second Chance Pawn"],
        clothing: ["Elmwood Outfitters", "Main Street Apparel", "Town Threads"],
        bank: ["Fairview Bank", "Riverton Trust", "Bridgeport Savings"],
        casino: ["Riverton Casino", "Golden Fairview", "Bridgeport Bets"],
      },
    },
  };
  CBZ.SETTLEMENT_FLAVORS = FLAVORS;

  // biome/district string (from the caller cfg) -> flavor key
  const ALIAS = {
    desert: "desert", drygulch: "desert",
    farmland: "farmland", farm: "farmland", harvestmarket: "farmland", farmcounty: "farmland",
    snow: "snow", alpine: "snow", pinecrest: "snow", ski: "snow",
    forest: "forest", logging: "forest", timber: "forest", woods: "forest",
    village: "village", rural: "village", hamlet: "village",
    port: "port", harbor: "port", harbour: "port", capeharbor: "port", fishing: "port",
    finance: "finance", downtown: "finance", goldspire: "finance", financial: "finance",
    neon: "neon", casino: "neon", strip: "neon", neonreef: "neon", vegas: "neon",
    factory: "factory", industrial: "factory", foundry: "factory", mill: "factory",
  };
  CBZ.SETTLEMENT_FLAVOR_ALIAS = ALIAS;

  function flavorOf(cfg) {
    const keys = [cfg.flavor, cfg.biome, cfg.district, cfg.name];
    for (const k of keys) {
      if (!k) continue;
      const s = String(k).toLowerCase().replace(/[^a-z]/g, "");
      if (ALIAS[s]) return ALIAS[s];
      for (const key in ALIAS) if (s.indexOf(key) >= 0) return ALIAS[key];
    }
    return "generic";
  }
  CBZ.settlementFlavorOf = flavorOf;

  // =========================================================================
  //  ARCHETYPES — every anchor is a REAL, FURNISHABLE trade (shopKind maps to
  //  a shops.js trade + a cityFurnishInterior dresser + a vendor). storeys are
  //  a base; towngen clamps them by ring + TOWN_MAX. No pure box fillers.
  // =========================================================================
  const ARCH = {
    food:     { shopKind: "food",     storeys: 1, colorKey: "wood" },
    store:    { shopKind: "hardware", storeys: 1, colorKey: "wood" },
    bar:      { shopKind: "bar",      storeys: 1, colorKey: "accent" },
    gas:      { shopKind: "gas",      storeys: 1, colorKey: "wood" },
    clinic:   { shopKind: "hospital", storeys: 1, colorKey: "accent" },
    gunsmith: { shopKind: "guns",     storeys: 1, colorKey: "accent" },
    pawn:     { shopKind: "pawn",     storeys: 1, colorKey: "wood" },
    clothing: { shopKind: "clothing", storeys: 1, colorKey: "wood" },
    bank:     { shopKind: "bank",     storeys: 2, colorKey: "accent" },
    casino:   { shopKind: "casino",   storeys: 2, colorKey: "accent" },
  };

  // =========================================================================
  //  TIER — hamlet / village / town / city, from block count + skyline. Drives
  //  which optional anchors a settlement is big enough to support.
  // =========================================================================
  CBZ.settlementTier = function (cfg) {
    const cols = Math.max(1, (cfg.cols || 3) | 0), rows = Math.max(1, (cfg.rows || 3) | 0);
    const blocks = cols * rows;
    const sky = (cfg.skyline && (cfg.skyline.maxStoreys || 0)) || 0;
    if (sky >= 6 || blocks >= 12) return "city";
    if (blocks >= 7) return "town";
    if (blocks >= 4) return "village";
    return "hamlet";
  };

  // optional anchors a settlement of (flavor,tier) rolls for, with per-item
  // probability. Bigger/wealthier flavors support more services.
  function optionalsFor(flavor, tier) {
    const T = { hamlet: 0, village: 1, town: 2, city: 3 }[tier] || 0;
    const o = [];
    o.push({ key: "bar", prob: 0.35 + T * 0.18 });
    o.push({ key: "gas", prob: 0.30 + T * 0.12 });
    if (T >= 1) o.push({ key: "clothing", prob: 0.25 + T * 0.15 });
    if (T >= 1) o.push({ key: "gunsmith", prob: 0.28 + T * 0.12 });
    if (T >= 1) o.push({ key: "pawn", prob: 0.25 + T * 0.14 });
    if (T >= 2) o.push({ key: "clinic", prob: 0.40 + (T - 2) * 0.25 });
    o.push({ key: "bank", prob: (flavor === "finance" ? 0.95 : 0.20) + T * 0.18 });
    return o;
  }

  // casino probability. Neon strips ALWAYS have one; a desert town is the
  // guaranteed Desert Diamond flagship; finance/city districts often do;
  // ordinary towns occasionally; villages/hamlets never (too small).
  function casinoProbFor(flavor, tier) {
    if (flavor === "neon") return 1.0;
    if (flavor === "desert" && (tier === "town" || tier === "city" || tier === "village")) return 1.0;
    if (flavor === "finance") return 0.45;
    if (tier === "city") return 0.4;
    if (tier === "town") return 0.22;
    return 0;
  }

  // =========================================================================
  //  COMPOSE — the public entry towngen calls. Pure: draws ONLY from siteRng.
  // =========================================================================
  CBZ.settlementsCompose = function (cfg, siteRng) {
    const flavor = flavorOf(cfg);
    const tier = CBZ.settlementTier(cfg);
    const fl = FLAVORS[flavor] || FLAVORS.generic;
    const pal = fl.palette || {};

    // a per-arch flavored name, deterministic off siteRng (stable within a build)
    const used = {};
    function nameFor(archKey) {
      const pool = (fl.biz && fl.biz[archKey]) || (FLAVORS.generic.biz[archKey]) || ["Shop"];
      // rotate through the pool so a town doesn't repeat one name for two shops
      let i = (siteRng() * pool.length) | 0;
      const seen = used[archKey] || (used[archKey] = new Set());
      for (let k = 0; k < pool.length && seen.has(i); k++) i = (i + 1) % pool.length;
      seen.add(i);
      return pool[i % pool.length];
    }

    function archPrefab(archKey) {
      if (archKey === "home") {
        return {
          name: "House", storeys: 1,
          color: pal.wood != null ? pal.wood : (cfg.palette && cfg.palette.wood) || 0x9c7b4e,
          opts: { stairs: true }, lotKind: "home", _arch: "home",
        };
      }
      const a = ARCH[archKey] || ARCH.store;
      return {
        name: nameFor(archKey),
        shopKind: a.shopKind,
        storeys: a.storeys,
        color: pal[a.colorKey] != null ? pal[a.colorKey] : (cfg.palette && cfg.palette.wood) || 0x9c7b4e,
        opts: { retail: true },
        lotKind: "shop",
        _arch: archKey,
      };
    }

    // fallback prefab recipe (only used if the caller passed none) — a full
    // varied mix so even a bare template grows a believable town.
    function fallbackPrefabs() {
      const homeCol = pal.wood != null ? pal.wood : 0x9c7b4e;
      const commercial = [
        archPrefabW("food", 3), archPrefabW("store", 3), archPrefabW("bar", 2),
        archPrefabW("clothing", 1), archPrefabW("pawn", 1),
      ];
      const civic = [archPrefabW("bank", 2), archPrefabW("clinic", 1), archPrefabW("store", 2)];
      const residential = [
        { name: "House", storeys: 1, color: homeCol, opts: { stairs: true }, lotKind: "home", w: 3 },
        { name: "Cottage", storeys: 1, color: homeCol, opts: { stairs: true }, lotKind: "home", w: 2 },
      ];
      return { civic: civic, commercial: commercial, residential: residential, default: residential };
      function archPrefabW(k, w) { const p = archPrefab(k); p.w = w; return p; }
    }

    const required = ["food", "store"];
    const optionals = optionalsFor(flavor, tier);
    const casinoProb = casinoProbFor(flavor, tier);
    let hasCasino = false;

    // planAnchors(lots, cx, cz) -> Map<lot, prefab>. Called by towngen AFTER
    // the lots array exists. Deterministic (siteRng only, no cfg.rng). Central
    // non-residential lots are claimed first; casino takes an early (central,
    // roomy) slot; required anchors are guaranteed.
    function planAnchors(lots, cx, cz) {
      const plan = new Map();
      if (!lots || !lots.length) return plan;
      // prefer commercial/civic lots, then fall back to any; central-first.
      const rank = function (lt) { return (lt.zone === "residential" ? 1e6 : 0) + Math.hypot(lt.cx - cx, lt.cz - cz); };
      const cands = lots.slice().sort(function (a, b) { return rank(a) - rank(b) || a.cx - b.cx || a.cz - b.cz; });
      let idx = 0;
      function take(archKey) {
        if (idx >= cands.length) return false;
        plan.set(cands[idx++], archPrefab(archKey));
        return true;
      }
      // 1) guaranteed essentials
      for (const k of required) take(k);
      // 2) casino (a big central building) — before the small optionals
      if (casinoProb >= 1 || siteRng() < casinoProb) { hasCasino = take("casino"); }
      // 3) rolled optional services
      for (const o of optionals) if (siteRng() < o.prob) take(o.key);
      // 4) HOMES — a settlement is where people LIVE. Guarantee a couple of
      //    furnished homes (each registers a sleepable bed) taken from the
      //    OUTER lots (residential edges), so every settlement has beds even
      //    when its whole commercial core was claimed by anchors above.
      let hidx = cands.length - 1;
      const homeCount = Math.max(1, Math.min(4, Math.round(cands.length * 0.3)));
      for (let h = 0; h < homeCount; h++) {
        while (hidx > idx && plan.has(cands[hidx])) hidx--;
        if (hidx <= idx) break;
        plan.set(cands[hidx--], archPrefab("home"));
      }
      return plan;
    }

    return {
      flavor: flavor, tier: tier,
      palette: pal, tint: fl.tint,
      nameFor: nameFor,
      prefabs: fallbackPrefabs(),
      planAnchors: planAnchors,
      hasCasino: function () { return hasCasino; },
    };
  };

  // =========================================================================
  //  cityWorldGeo WRAPPER — the KEYSTONE. Town builders (biome/minicity/country
  //  landmass builders) run DURING cityWorldGeo, but the arena they must push
  //  their lots/shops/roads onto (so vendors/Zillow/minimap/traffic see them)
  //  is the LIVE under-construction city object cityWorldGeo receives — which
  //  isn't assigned to CBZ.city.arena until buildCity RETURNS. Stash it here as
  //  CBZ._settlementArena (buildTown's A-resolution reads it) BEFORE builders
  //  run, and reset the settlement registry. Gated on SETTLEMENTS_V2: with the
  //  flag off, _settlementArena stays null and town lots don't reach the arena
  //  — i.e. the exact pre-V2 baseline (arena.lots/roads == mainland only).
  // =========================================================================
  if (CBZ.cityWorldGeo && !CBZ.cityWorldGeo._settlementsWrapped) {
    const _orig = CBZ.cityWorldGeo;
    const wrapped = function (city) {
      CBZ.settlements = [];
      CBZ._settlementArena = (CBZ.CONFIG.SETTLEMENTS_V2 !== false) ? city : null;
      return _orig.apply(this, arguments);
    };
    wrapped._settlementsWrapped = true;
    CBZ.cityWorldGeo = wrapped;
  }
})();
