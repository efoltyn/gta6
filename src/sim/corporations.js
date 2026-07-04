/* ============================================================
   sim/corporations.js — Stage E, step E7: THE FULL 8-COMPANY ROSTER.

   MASTER-PLAN VI.6: "a curated roster of 8 launch corporations... each owns
   real outlets in real buildings across the mainland + mini-cities and books
   revenue from actual simulated sales." E5 landed Bunbros alone (hardcoded);
   E6 added the exchange for that one stock. THIS wave generalizes the whole
   file into a DATA-DRIVEN loop over a COMPANIES table (below) and lands the
   other 7: Ironclad Arms (guns), Granite & Sons Construction (materials),
   Meridian Fuel, Zenith Media, Royale Casino Corp, Goldspire Trust REIT,
   Apex Dealership Holdings. `g.corps.list` stays keyed by id exactly like
   E5 left it — every reader that already used CBZ.corps.get/list/summary/
   robOutlet keeps working unchanged; only the INTERNALS became a loop.

   THE ROSTER — each row is either OUTLET-BASED (claims real shop lots the
   same seeded-LCG-idempotent way E5's Bunbros did, revenue = a live cohort
   spend category × that company's share of the city's lots of that kind)
   or SPECIAL (no retail lots exist for the sector, so revenue comes from a
   different real signal — see each `special` branch in hourlyEarnOne()):
     bunbros/BUN   food     — claims "food" lots (unchanged from E5/E6).
     ironclad/IRN  guns     — claims "guns" lots; ALSO earns half of every
                              PLAYER purchase at a gun-store counter (city/
                              shops.js's generic buy() — see that file's
                              guarded 2-line hook).
     meridian/MER  fuel     — claims "gas" lots (city/buildings.js +
                              city/expansion.js both spawn gas-kind lots).
                              FALLBACK: an arena with zero gas lots (e.g. a
                              mini-city that never rolled one) still gives
                              Meridian a flat cityShare of citywide fuel
                              spend — the fuel monopoly doesn't vanish just
                              because this particular map has no pumps.
     apex/APX      luxury   — claims "carlot" lots; ALSO earns half of every
                              PLAYER car purchase at a dealership (city/
                              shops.js's buyCar(), guarded 1-line hook).
     royale/RYL    casino   — claims "casino" lots (Neon Reef's casino
                              prefabs); revenue is NOT cohort spend — it's a
                              slice of sim/npcecon.js's entPool (the "ent"
                              propensity money that's been banking up with
                              nothing to consume it), drained proportional
                              to Royale's citywide share of casino lots. This
                              is the stub for E9's real casino house-take —
                              this wave just gives the entPool a real sink.
     granite/GRN   materials— NO retail lots (construction firms don't have
                              a shopfront kind). Revenue = citywide materials
                              BUY VOLUME (sim/market.js's new drainBuyVolume,
                              fed by cohort/player/corp materials purchases)
                              × the live materials price level, PLUS a
                              reconstruction stream: every player-built piece
                              destroyed (systems/structdamage.js's hit())
                              queues a paid "rebuild job" that Granite works
                              off a few at a time each hour — literally "earn
                              more when the city gets destroyed" per VI.6.
     zenith/ZEN    media    — NO retail lots. Revenue = a steady activity-
                              scaled base (the ad-market's citywide presence)
                              PLUS the player's own adboard rent (city/
                              adboard.js's rentBoard() + weekly renewal both
                              credit half the rent straight to Zenith via
                              creditRevenue() below — a real rental fee the
                              player already pays, now booked as revenue).
     goldspire/GLD reit     — NO retail lots. NAV-driven: revenue = the
                              city's property-market INDEX (city/economy.js's
                              propIndex(), the same propMkt this file's price
                              formation is itself modeled on) delta this hour
                              × a fixed book value (Goldspire "owns" a slice
                              of the whole city's real estate), plus a small
                              steady rent-roll yield on that book value — a
                              REIT in stock form, literally wrapping the
                              existing property index.
     kaido/KAI,                E10 — CAR MANUFACTURERS: NO retail lots (Apex's
     volante/VLT   auto        carlot outlets ARE the dealership network).
                   manufacturing Revenue = a steady fleet-sales base scaled by
                              citywide activity x brandHeat, PLUS half of every
                              player dealership purchase of one of their
                              models (economy.js CARS' new .maker field routes
                              it — see city/shops.js's buyCar()). Racing teams/
                              drivers/results/sponsorship live in the new sim/
                              motorsport.js — see that file's header.

   ACTIVE FLAG: `co.active` replaces the old bare `co.outlets.length` gate —
   true once an outlet-based company claims real lots (or falls back to a
   cityShare), true FOREVER for the 3 no-outlet specials (they don't wait on
   an arena), and true immediately for a player IPO (see createIPO() below).
   sim/stocks.js's lazy listing gate reads THIS flag now, not outlets.length.

   PLAYER IPO (VI.6: "Player businesses can IPO: a maxed wealth.js BIZ
   converts into a listed company seeded from its live bizRate()"): sim/
   stocks.js's CBZ.stocks.ipo(bizId) is the entry point (gates eligibility
   against city/wealth.js's BIZ table); it calls THIS file's createIPO(spec)
   to mint a 9th+ row that lives in g.corps.extra[] (persisted alongside the
   fixed 8 — see serialize()/apply() v2 below) instead of the static
   COMPANIES table, since it's created at runtime, not by this file's author.

   REVENUE (hourly, order 29.65 — right after sim/npcecon.js's 29.6 so this
   hour's freshly-stamped lastSpend/entPool are what every branch reads) and
   COSTS (wages/rent/inputs, scaled by outlet count, same shape as E5):
   see hourlyEarnOne() below — one function, branching on `spec.special`.

   NATIONAL INDEX + DIVIDENDS: both live in sim/stocks.js (E7), reading this
   file's co.sharesOutstanding/earningsHistory/cash — nothing to do here.

   PERSISTENCE (v2 — generalized from E5/E6's single-Bunbros v1 blob):
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() pick up
       serialize()/apply() beside blob.npce (blob.corp) — UNCHANGED call
       sites, only the blob's internal shape grew.
     - SINGLE-PLAYER: same CBZ.cityWorldCommit/cityWorldCollect wrap
       (_corpWrap) as E5/E6.
     - BACK-COMPAT: apply() still reads a v1 blob (an E5/E6-era save) and
       hydrates it straight into Bunbros only — the other 7 simply start
       fresh, exactly as if this were a brand-new run for them.
   Fresh-run reset: unchanged call site (city/peds.js's spawnCityPeds()).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const HOUR = 150 / 24;          // seconds per in-game hour — matches every sim/* module
  const WORKERS_PER_OUTLET = 3;
  const SHARES_OUTSTANDING = 1000000;
  const HIST_CAP = 48;             // revenueTTM/costsTTM ring length
  const DAILY_CAP = 28;            // earningsHistory: 28 daily samples ("a quarter of city-days")
  const BUNBROS_ID = "bunbros";    // back-compat default id for pre-E7 no-arg callers (phone.js/props.js)

  // ---- THE ROSTER (data-driven — this table IS the "8 launch corporations")
  // claimKind: the shop lot `kind` this company claims outlets from (city/
  // buildings.js's SHOP_KINDS + city/expansion.js's mini-city lots); absent
  // for the 3 no-outlet specials. spendCat: the sim/npcecon.js lastSpend /
  // sim/market.js category this company's revenue (and input-purchase
  // recordBuy) is keyed to — deliberately the SAME string as the market
  // category everywhere it applies, so no translation table is needed.
  const COMPANIES = [
    { id: "bunbros",   sym: "BUN", name: "Bunbros",                     sector: "food",
      claimKind: "food",   claimFrac: 0.60, spendCat: "food",   wage: 8,  rent: 40,  inputFrac: 0.35, startCash: 50000 },
    { id: "ironclad",  sym: "IRN", name: "Ironclad Arms",                sector: "guns",
      claimKind: "guns",   claimFrac: 0.55, spendCat: "guns",   wage: 12, rent: 50,  inputFrac: 0.30, startCash: 80000 },
    { id: "meridian",  sym: "MER", name: "Meridian Fuel",                sector: "fuel",
      claimKind: "gas",    claimFrac: 0.65, spendCat: "fuel",   wage: 9,  rent: 35,  inputFrac: 0.45, startCash: 70000, fallbackShare: 0.4 },
    { id: "apex",      sym: "APX", name: "Apex Dealership Holdings",     sector: "luxury",
      claimKind: "carlot", claimFrac: 0.50, spendCat: "luxury", wage: 15, rent: 90,  inputFrac: 0.55, startCash: 150000 },
    { id: "royale",    sym: "RYL", name: "Royale Casino Corp",           sector: "casino",
      claimKind: "casino", claimFrac: 0.50, special: "casino",  wage: 14, rent: 120, startCash: 300000 },
    { id: "granite",   sym: "GRN", name: "Granite & Sons Construction",  sector: "materials",
      special: "materials", startCash: 120000 },
    { id: "zenith",    sym: "ZEN", name: "Zenith Media",                 sector: "media",
      special: "media",     startCash: 60000 },
    { id: "goldspire", sym: "GLD", name: "Goldspire Trust REIT",         sector: "reit",
      special: "reit",      startCash: 500000 },
    // E10 — CAR MANUFACTURERS (MASTER-PLAN VI.6 "motorsport is corporate"):
    // no retail lots of their own (Apex's carlot outlets ARE the dealership
    // network — see city/shops.js's buyCar() split hook + economy.js CARS'
    // .maker field this wave adds). Revenue = a steady fleet-sales base
    // scaled by citywide activity (traffic full of your cars is product
    // placement) x brandHeat (win-on-Sunday-sell-on-Monday — sim/motorsport.js
    // decays this back to 1.0 daily), PLUS the maker's half of every player
    // dealership purchase of one of its models. Scope-bounded to 2 launch
    // manufacturers — more can join later (comment, not code, per E10 spec).
    { id: "kaido",     sym: "KAI", name: "Kaido Motors",                 sector: "auto manufacturing",
      special: "manufacturer", startCash: 220000, fleetBase: 45 },
    { id: "volante",   sym: "VLT", name: "Volante Auto Group",           sector: "auto manufacturing",
      special: "manufacturer", startCash: 260000, fleetBase: 70 },
  ];

  // ---- special-sector tuning (all in one place, VI.6-style) ---------------
  const DRAIN_FRAC = 0.15;           // royale: fraction of pooled entPool drained/hr, weighted by citywide share
  // E9 — NPC WHALES: royale's SECOND revenue stream (the entPool drain above
  // is stream 1 — ambient "ent" propensity money). 30% of hours a rich ledger
  // NPC (20% a billionaire founder, else any ledger page with cash>800) sits
  // down for a session; the house's ~3% edge is baked into WHALE_EDGE_SHIFT.
  const WHALE_CHANCE = 0.30;
  const WHALE_FOUNDER_FRAC = 0.20;
  const WHALE_STAKE_FRAC = 0.15, WHALE_STAKE_CAP = 400, WHALE_MIN_CASH = 800;
  const WHALE_EDGE_SHIFT = 0.485;    // see whaleSession() below for the sign note
  const GRN_UNIT_VALUE = 25;         // granite: $ booked per market.js materials "unit" of citywide buy volume
  const GRN_OVERHEAD = 60;           // granite: flat $/hr overhead
  const REBUILD_RATE = 6;            // granite: max queued rebuild "jobs" paid off per hour
  const REBUILD_PAY_PER_UNIT = 45;   // granite: $ per rebuild job paid
  const MEDIA_BASE = 90;             // zenith: steady $/hr base, scaled by activity (citywide ad-market presence)
  const MEDIA_OVERHEAD = 50;
  const GLD_BOOK_VALUE = 4000000;    // goldspire: NAV proxy — the slice of the city's property book it "owns"
  const GLD_RENT_YIELD_HOURLY = 0.00003; // goldspire: steady rent-roll yield per hour (~0.26%/in-game day)
  const GLD_OVERHEAD = 120;
  const INPUT_DOLLARS_PER_UNIT = 20; // $ of inputs -> a market.js recordBuy "quantity" (bulk-buy divisor)
  const MFR_OVERHEAD_FRAC = 0.6;     // manufacturer: flat $/hr overhead as a fraction of fleetBase
  const BRANDHEAT_DAILY_DECAY = 0.4; // manufacturer: how far brandHeat relaxes back to 1.0 each city-day

  // own seeded LCG (never Math.random — repo convention for world state).
  const INITIAL_SEED = 314159265 & 0x7fffffff;
  let _seed = INITIAL_SEED;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // ---- state lives on g.corps ----------------------------------------------
  function freshCompany(spec) {
    const noOutlets = !spec.claimKind;
    return {
      id: spec.id, name: spec.name, sector: spec.sector, tickerSym: spec.sym,
      outlets: [], shareByDistrict: {}, cityShare: spec.fallbackShare || 0,
      active: noOutlets,        // outlet-based cos flip true once build() claims real lots (or a fallback share)
      cash: spec.startCash,
      revenueTTM: [], costsTTM: [], revAcc: 0, costAcc: 0,
      earningsHistory: [],
      sharesOutstanding: SHARES_OUTSTANDING,
      lastPrice: null,
      founderSid: null,        // E8: billionaire-shareholder persistence wires an owner NPC here
      cashDayStart: spec.startCash, cashTrend: "flat",
      bankrupt: false,
      rebuildQueue: 0,          // granite only — queued destruction-rebuild jobs
      lastPropIndex: null,      // goldspire only — last hour's propIndex() reading (NAV delta basis)
      brandHeat: 1.0,           // manufacturers only — E10 win-on-Sunday-sell-on-Monday multiplier
      _builtForArena: null,
    };
  }
  function reset() {
    _seed = INITIAL_SEED;
    g.corps = { list: {}, hrAcc: 0, dayHrAcc: 0, extra: [] };
    for (const spec of COMPANIES) g.corps.list[spec.id] = freshCompany(spec);
  }
  function ensureInit() { if (!g.corps || !g.corps.list) reset(); if (!g.corps.extra) g.corps.extra = []; }
  function allSpecs() { return COMPANIES.concat(g.corps.extra || []); }
  function specFor(id) { for (const s of allSpecs()) if (s.id === id) return s; return null; }

  // ---- OUTLETS: claim a seeded-LCG share of the city's lots of `claimKind` -
  function districtOf(lot) {
    const cx = (lot && lot.cx) || 0, cz = (lot && lot.cz) || 0;
    return (CBZ.cityEcon && CBZ.cityEcon.districtAt) ? CBZ.cityEcon.districtAt(cx, cz) : "downtown";
  }
  function claimLots(spec, arena) {
    const co = g.corps.list[spec.id];
    if (!co || co.bankrupt) return false;
    if (!spec.claimKind) { co.active = true; co._builtForArena = arena; return true; }   // no-outlet sector — always "built"
    const all = (arena.shopLots || arena.lots || []).filter(function (l) {
      return l && l.building && l.building.shop && l.building.shop.kind === spec.claimKind;
    });
    if (!all.length) {
      // no lots of this kind exist in THIS arena — fall back to a flat
      // citywide demand share instead of real outlets (documented per-row
      // above; only meridian sets a nonzero fallbackShare this wave).
      co.outlets = []; co.shareByDistrict = {};
      co.cityShare = spec.fallbackShare || 0;
      co.active = co.cityShare > 0;
      co._builtForArena = arena;
      return co.active;
    }
    const districtTotal = {};
    for (const l of all) { const dk = districtOf(l); districtTotal[dk] = (districtTotal[dk] || 0) + 1; }
    // seeded LCG Fisher-Yates — SAME arena always yields the SAME claimed set.
    const pool = all.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const nClaim = Math.max(1, Math.round(pool.length * spec.claimFrac));
    const districtOutlets = {};
    co.outlets = [];
    for (let i = 0; i < nClaim; i++) {
      const lot = pool[i], dk = districtOf(lot);
      lot._corpOutlet = spec.id;   // robbery lookup (city/shops.js) + future citystaff/citation tagging
      co.outlets.push({ lot: lot, district: dk });
      districtOutlets[dk] = (districtOutlets[dk] || 0) + 1;
    }
    co.shareByDistrict = {};
    for (const dk in districtTotal) co.shareByDistrict[dk] = (districtOutlets[dk] || 0) / districtTotal[dk];
    co.cityShare = nClaim / all.length;   // citywide fraction — royale's entPool share, everyone's fallback basis
    co.active = true;
    co._builtForArena = arena;
    return true;
  }
  let buildCool = 0;
  CBZ.onUpdate(41.75, function (dt) {
    // slotted between city/companies.js's 41.7 (decorative holdco build/move)
    // and city/citystaff.js's 41.8 (visible queues/staff) — unchanged slot.
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena) return;
    ensureInit();
    buildCool -= dt;
    if (buildCool > 0) return;
    buildCool = 1.0;
    for (const spec of allSpecs()) {
      const co = g.corps.list[spec.id];
      if (!co || co.bankrupt || co._builtForArena === arena) continue;
      try { claimLots(spec, arena); } catch (e) {}
    }
  });

  // ---- bankruptcy: outlets revert to independents ------------------------
  function bankrupt(co) {
    if (co.bankrupt) return;
    co.bankrupt = true;
    for (const o of co.outlets) { if (o.lot) delete o.lot._corpOutlet; }
    co.outlets = []; co.shareByDistrict = {}; co.active = false;
    if (CBZ.cityFeed) CBZ.cityFeed("💥 " + co.name + " has gone BANKRUPT — outlets revert to independents", "#ff9a6b");
  }

  // ---- E9 NPC WHALES: royale's stream 2 (stream 1 is the entPool drain in
  // the "casino" branch below). A rich ledger NPC's session settles straight
  // into co.cash/revAcc here — the entPool `revenue` var in hourlyEarnOne is
  // untouched, so the two streams stay additive and separately auditable.
  function whaleSession(co) {
    if (rng() >= WHALE_CHANCE) return;
    let sid = null;
    if (rng() < WHALE_FOUNDER_FRAC && CBZ.billionaires && typeof CBZ.billionaires.founders === "function") {
      const founders = CBZ.billionaires.founders();
      if (founders.length) sid = founders[(rng() * founders.length) | 0].sid;
    }
    if (!sid && CBZ.cityLedgerSample) {
      const rich = CBZ.cityLedgerSample(12, function (e) { return (e.cash || 0) > WHALE_MIN_CASH; });
      if (rich.length) sid = rich[(rng() * rich.length) | 0].sid;
    }
    if (!sid) return;
    const rec = (CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid)) || (CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid));
    if (!rec) return;
    const stake = Math.min((rec.cash || 0) * WHALE_STAKE_FRAC, WHALE_STAKE_CAP);
    if (!(stake >= 25)) return;
    // NOTE ON SIGN: the E9 spec's raw formula stake*(lcg()-0.485)*2 averages
    // POSITIVE (E[lcg()]=0.5 -> mean +0.03*stake), which would make the NPC
    // profit on average — backwards for a "house edge". Flipping the operand
    // order (shift-minus-lcg instead of lcg-minus-shift) keeps the same
    // 0.485 constant from the spec but makes the mean -0.03*stake, i.e. the
    // NPC is expected to LOSE ~3% of stake — the house's actual edge.
    let outcome = stake * (WHALE_EDGE_SHIFT - rng()) * 2;
    outcome = Math.max(-stake, Math.min(stake, outcome));
    rec.cash = Math.max(0, (rec.cash || 0) + outcome);
    // house's side: NPC loses (outcome<0) -> RYL gains; NPC wins -> RYL pays.
    co.cash -= outcome;
    co.revAcc = (co.revAcc || 0) - outcome;
  }

  // ---- REVENUE + COSTS: one hourly pass, branching on spec.special --------
  function hourlyEarnOne(spec) {
    const co = g.corps.list[spec.id];
    if (!co || co.bankrupt || !co.active) return;

    const est = (CBZ.econState && CBZ.econState.get) ? CBZ.econState.get() : null;
    const priceAdj = (est && est.priceIndex != null) ? est.priceIndex : 1.0;
    const activity = (CBZ.econState && typeof CBZ.econState.activity === "function") ? CBZ.econState.activity() : 1.0;
    const spend = (CBZ.npcEcon && CBZ.npcEcon.lastSpend) || {};

    let revenue = 0, costs = 0;

    if (spec.special === "materials") {
      // GRANITE & SONS: no retail lots — revenue is citywide materials BUY
      // VOLUME (cohort/player/corp purchases, drained from market.js's
      // per-category counter) x the live materials price level, plus a
      // reconstruction stream worked off the rebuildQueue (see notifyDestruction).
      const vol = (CBZ.market && typeof CBZ.market.drainBuyVolume === "function") ? CBZ.market.drainBuyVolume("materials") : 0;
      const priceLvl = (CBZ.market && typeof CBZ.market.price === "function") ? CBZ.market.price("materials") : 1;
      revenue = vol * GRN_UNIT_VALUE * priceLvl;
      const payN = Math.min(co.rebuildQueue || 0, REBUILD_RATE);
      co.rebuildQueue = Math.max(0, (co.rebuildQueue || 0) - payN);
      revenue += payN * REBUILD_PAY_PER_UNIT;
      costs = GRN_OVERHEAD;
    } else if (spec.special === "media") {
      // ZENITH MEDIA: a steady activity-scaled base (the ad-market's citywide
      // presence) — city/adboard.js's rentBoard()/weekly-renewal ALSO credit
      // half the player's real rent straight into revAcc/cash via
      // creditRevenue() below, so this branch is only the floor on top of that.
      revenue = MEDIA_BASE * activity;
      costs = MEDIA_OVERHEAD;
    } else if (spec.special === "reit") {
      // GOLDSPIRE TRUST REIT: NAV-driven — city/economy.js's propIndex() (the
      // same propMkt this file's own price formation echoes) delta this hour
      // x a fixed book value, plus a small steady rent-roll yield on that book.
      const idx = (CBZ.cityEcon && typeof CBZ.cityEcon.propIndex === "function") ? CBZ.cityEcon.propIndex() : 1;
      if (co.lastPropIndex == null) co.lastPropIndex = idx;
      const delta = idx - co.lastPropIndex;
      co.lastPropIndex = idx;
      revenue = GLD_BOOK_VALUE * delta + GLD_BOOK_VALUE * GLD_RENT_YIELD_HOURLY;
      costs = GLD_OVERHEAD;
    } else if (spec.special === "casino") {
      // ROYALE CASINO CORP: a slice of npcecon.js's entPool (ent-propensity
      // money that's had nothing to consume it), drained proportional to
      // Royale's citywide share of casino lots — the E9 stub: real house-take
      // wires in later, but the entPool gets a real sink starting now.
      const pool = (CBZ.npcEcon && typeof CBZ.npcEcon.entPool === "function") ? CBZ.npcEcon.entPool() : 0;
      const share = co.cityShare || 0;
      const drain = pool * DRAIN_FRAC * share;
      if (drain > 0 && CBZ.npcEcon && typeof CBZ.npcEcon.drainEntPool === "function") CBZ.npcEcon.drainEntPool(drain);
      revenue = drain;
      const n = co.outlets.length || 1;
      costs = n * WORKERS_PER_OUTLET * spec.wage * priceAdj + n * spec.rent;
      // STREAM 2 (E9): NPC WHALES — named rich ledger NPCs' real gambling
      // sessions, booked straight into co.cash/revAcc, independent of `revenue`.
      try { whaleSession(co); } catch (e) {}
    } else if (spec.special === "manufacturer") {
      // CAR MANUFACTURER (E10): no retail lots of its own — a steady fleet-
      // sales base (traffic full of your cars is product placement) scaled by
      // citywide activity and by brandHeat (a race win 1.3x's this for ~24h,
      // decaying back to 1.0 daily below). The OTHER half of every player
      // dealership purchase of one of this maker's models books straight in
      // via creditRevenue() — see city/shops.js's buyCar() split hook.
      revenue = (spec.fleetBase || 40) * activity * (co.brandHeat || 1);
      costs = (spec.fleetBase || 40) * MFR_OVERHEAD_FRAC;
    } else if (spec.special === "ipo") {
      // PLAYER IPO: this wave's minimal-but-real model — the seeded dailyEPS
      // basis IS the daily earnings, spread flat across the 24 hourly ticks
      // (no cohort link yet; a future wave could tie it to the biz's own kind).
      revenue = (spec.dailySeed || 0) / 24;
      costs = 0;
    } else {
      // OUTLET-BASED, cohort-spend sector (bunbros/ironclad/meridian/apex):
      // outletRevenue = cohortSpend(district, spendCat) x outletShare(district),
      // summed over every DISTINCT district this company has a presence in —
      // exactly E5's Bunbros formula, generalized. cityShare fallback (no real
      // outlets this arena) reads citywide total spend instead of per-district.
      if (co.outlets.length) {
        const seenD = {};
        for (const o of co.outlets) {
          if (seenD[o.district]) continue;
          seenD[o.district] = 1;
          const catSpend = (spend[o.district] && spend[o.district][spec.spendCat]) || 0;
          revenue += catSpend * (co.shareByDistrict[o.district] || 0);
        }
      } else if (co.cityShare > 0) {
        let total = 0; for (const dk in spend) total += (spend[dk][spec.spendCat] || 0);
        revenue = total * co.cityShare;
      }
      const n = co.outlets.length || 1;
      const wages = n * WORKERS_PER_OUTLET * spec.wage * priceAdj;
      const rent = n * spec.rent;
      const inputs = (spec.inputFrac || 0) * revenue;
      costs = wages + rent + inputs;
      // the supply chain: inputs are a real spendCat-category purchase, the
      // SAME faucet npcecon.js's own cohort spend already feeds.
      if (inputs > 0 && CBZ.market && CBZ.market.recordBuy) CBZ.market.recordBuy(spec.spendCat, inputs / INPUT_DOLLARS_PER_UNIT);
    }

    const earnings = revenue - costs;
    co.cash += earnings;
    co.revAcc = (co.revAcc || 0) + revenue;
    co.costAcc = (co.costAcc || 0) + costs;
    co.revenueTTM.push(revenue); if (co.revenueTTM.length > HIST_CAP) co.revenueTTM.shift();
    co.costsTTM.push(costs); if (co.costsTTM.length > HIST_CAP) co.costsTTM.shift();
    if (co.cash <= 0 && !co.bankrupt) bankrupt(co);
  }
  // one shared day counter (not per-company) so every company's earningsHistory
  // rolls on the SAME game-day boundary — sim/stocks.js's dividend day-hook
  // (and the anchor's trailing-7-day EPS) depend on that alignment.
  function hourlyEarnAll() {
    ensureInit();
    for (const spec of allSpecs()) { try { hourlyEarnOne(spec); } catch (e) {} }
    g.corps.dayHrAcc = (g.corps.dayHrAcc || 0) + 1;
    if (g.corps.dayHrAcc >= 24) {
      g.corps.dayHrAcc -= 24;
      for (const spec of allSpecs()) {
        const co = g.corps.list[spec.id]; if (!co) continue;
        const net = Math.round((co.revAcc || 0) - (co.costAcc || 0));
        co.earningsHistory.push(net);
        if (co.earningsHistory.length > DAILY_CAP) co.earningsHistory.shift();
        co.revAcc = 0; co.costAcc = 0;
        co.cashTrend = co.cash >= co.cashDayStart ? "up" : "down";
        co.cashDayStart = co.cash;
        // E10: brandHeat relaxes back toward 1.0 a bit each city-day (a
        // championship win's showroom buzz fades — it doesn't last forever).
        if (spec.special === "manufacturer") co.brandHeat = 1 + ((co.brandHeat || 1) - 1) * BRANDHEAT_DAILY_DECAY;
      }
    }
  }
  // VI.6's hourly earnings pass — order 29.65, right after sim/npcecon.js's
  // 29.6 so this hour's freshly-stamped lastSpend/entPool snapshots are fresh.
  CBZ.onUpdate(29.65, function (dt) {
    if (g.mode !== "city") return;
    ensureInit();
    const C = g.corps;
    C.hrAcc = (C.hrAcc || 0) + dt;
    while (C.hrAcc >= HOUR) { C.hrAcc -= HOUR; hourlyEarnAll(); }
  });

  // ---- reads ---------------------------------------------------------------
  // robOutlet(lot, amount) -> true if `lot` is a live company outlet: debits
  // that company's cash by `amount` (city/shops.js's robTill() calls this the
  // instant a till robbery lands — works for ANY claimed outlet kind now).
  function robOutlet(lot, amount) {
    if (!(lot && lot._corpOutlet) || !(amount > 0)) return false;
    ensureInit();
    const co = g.corps.list[lot._corpOutlet];
    if (!co) return false;
    co.cash -= amount;
    if (CBZ.stocks && typeof CBZ.stocks.shock === "function") CBZ.stocks.shock(co.tickerSym, -amount / 500000);
    if (co.cash <= 0 && !co.bankrupt) bankrupt(co);
    return true;
  }
  // creditRevenue(id, amount) -> books a real dollar amount straight into a
  // company's cash + today's revAcc (so it rolls into earningsHistory the
  // same as any other revenue). The generic hook for a real dollar changing
  // hands OUTSIDE the hourly cohort-spend pass: a player gun/car purchase
  // (city/shops.js), a player adboard rental (city/adboard.js).
  function creditRevenue(id, amount) {
    if (!(amount > 0)) return false;
    ensureInit();
    const co = g.corps.list[id];
    if (!co || co.bankrupt) return false;
    co.cash += amount;
    co.revAcc = (co.revAcc || 0) + amount;
    return true;
  }
  // debitCash(id, amount) -> the house PAYS OUT (E9: a player casino win).
  // Floors at 0 rather than going negative/bankrupting the corp outright — a
  // giant jackpot shakes the vault, it doesn't end Royale Casino Corp.
  function debitCash(id, amount) {
    if (!(amount > 0)) return false;
    ensureInit();
    const co = g.corps.list[id];
    if (!co || co.bankrupt) return false;
    const drained = co.cash > 0 && co.cash - amount <= 0;
    co.cash = Math.max(0, co.cash - amount);
    co.revAcc = (co.revAcc || 0) - amount;
    if (drained && CBZ.cityFeed) CBZ.cityFeed("🎰 " + co.name + " — the house is shaken, a giant win drains the vault", "#ff9a6b");
    return true;
  }
  // notifyDestruction(n) -> a player-built piece was just destroyed (systems/
  // structdamage.js's hit(), guarded 2-line hook): queues `n` rebuild jobs
  // Granite & Sons works off a few at a time each hour (see hourlyEarnOne).
  function notifyDestruction(n) {
    ensureInit();
    const co = g.corps.list.granite; if (!co) return;
    co.rebuildQueue = (co.rebuildQueue || 0) + (n || 1);
  }
  // summary(id) -> a phone/ticker row's data (id defaults to Bunbros for
  // pre-E7 no-arg callers). null once the company isn't active yet/bankrupted.
  function summary(id) {
    ensureInit();
    const co = g.corps.list[id || BUNBROS_ID];
    if (!co || !co.active) return null;
    const h = co.earningsHistory;
    const daily = h.length ? h[h.length - 1] : Math.round((co.revAcc || 0) - (co.costAcc || 0));
    return {
      id: co.id, name: co.name, sector: co.sector, tickerSym: co.tickerSym,
      outlets: co.outlets.length, cash: Math.round(co.cash),
      dailyEarnings: daily, cashTrend: co.cashTrend || "flat", bankrupt: !!co.bankrupt,
    };
  }
  // summaryAll() -> every active company's summary() row — the full-roster
  // phone MARKETS list (E7).
  function summaryAll() {
    ensureInit();
    const out = [];
    for (const spec of allSpecs()) { const s = summary(spec.id); if (s) out.push(s); }
    return out;
  }
  function companyTickerLine(id) {
    const s = summary(id);
    if (!s) return "";
    const arrow = s.cashTrend === "up" ? "▲" : (s.cashTrend === "down" ? "▼" : "–");
    let line = s.tickerSym + " earnings " + (s.dailyEarnings >= 0 ? "$" : "-$") + Math.abs(Math.round(s.dailyEarnings)).toLocaleString() + " " + arrow;
    if (CBZ.stocks && typeof CBZ.stocks.tickerLine === "function") {
      const pl = CBZ.stocks.tickerLine(s.tickerSym);
      if (pl) line += " · " + pl;
    }
    return line;
  }
  // tickerLine(id?) -> "SYM earnings $X ▲ · $12.40 ▲". With no id, ROTATES
  // across every active company every ~20s (E7: the adboard ticker now shows
  // the full roster over time, not just Bunbros) — same rotation cadence
  // city/props.js's tickerAd() already used for the single-company slot.
  function tickerLine(id) {
    if (id) return companyTickerLine(id);
    const all = summaryAll();
    if (!all.length) return "";
    const i = Math.floor((CBZ.now || 0) / 20000) % all.length;
    return companyTickerLine(all[i].id);
  }

  // ---- PLAYER IPO: mint a runtime company from a maxed wealth.js BIZ -------
  // Called by sim/stocks.js's CBZ.stocks.ipo(bizId) (that file owns the
  // eligibility gate against city/wealth.js's BIZ table + the exchange
  // listing); THIS function only mints the corp record. spec: {id, sym, name,
  // sector, dailySeed, playerShareFrac} — dailySeed is the bizRate()-derived
  // starting daily-earnings basis (stocks.js computes it).
  function createIPO(spec) {
    ensureInit();
    if (!spec || !spec.id || g.corps.list[spec.id]) return null;   // no double-IPO
    const full = Object.assign({ special: "ipo", startCash: Math.max(10000, Math.round((spec.dailySeed || 0) * 30)) }, spec);
    g.corps.extra.push(full);
    const co = freshCompany(full);
    co.active = true;
    // seed one earningsHistory sample so sim/stocks.js's anchor is computable
    // on the very first price-formation tick (no "wait a day" dead air).
    co.earningsHistory = [Math.round(spec.dailySeed || 0)];
    g.corps.list[spec.id] = co;
    return co;
  }

  // ---- persistence ------------------------------------------------------
  // v2: generalized over every company (fixed 8 + any g.corps.extra IPOs).
  // Outlets/shareByDistrict/cityShare are deliberately NOT serialized — same
  // "idempotent rebuild" note as E5: the next 41.75 tick re-derives them.
  function serializeCompany(co) {
    return {
      cash: co.cash, revenueTTM: co.revenueTTM.slice(), costsTTM: co.costsTTM.slice(),
      earningsHistory: co.earningsHistory.slice(), revAcc: co.revAcc || 0, costAcc: co.costAcc || 0,
      cashDayStart: co.cashDayStart, cashTrend: co.cashTrend || "flat", bankrupt: !!co.bankrupt,
      rebuildQueue: co.rebuildQueue || 0, lastPropIndex: co.lastPropIndex,
      brandHeat: co.brandHeat != null ? co.brandHeat : 1.0,
    };
  }
  function applyCompany(co, src) {
    if (!co || !src) return;
    if (isFinite(src.cash)) co.cash = +src.cash;
    if (Array.isArray(src.revenueTTM)) co.revenueTTM = src.revenueTTM.slice(-HIST_CAP);
    if (Array.isArray(src.costsTTM)) co.costsTTM = src.costsTTM.slice(-HIST_CAP);
    if (Array.isArray(src.earningsHistory)) co.earningsHistory = src.earningsHistory.slice(-DAILY_CAP);
    if (isFinite(src.revAcc)) co.revAcc = +src.revAcc;
    if (isFinite(src.costAcc)) co.costAcc = +src.costAcc;
    if (isFinite(src.cashDayStart)) co.cashDayStart = +src.cashDayStart;
    if (src.cashTrend) co.cashTrend = src.cashTrend;
    co.bankrupt = !!src.bankrupt;
    if (isFinite(src.rebuildQueue)) co.rebuildQueue = +src.rebuildQueue;
    if (isFinite(src.lastPropIndex)) co.lastPropIndex = +src.lastPropIndex;
    if (isFinite(src.brandHeat)) co.brandHeat = +src.brandHeat;
  }
  function serialize() {
    ensureInit();
    const out = { v: 2, hrAcc: g.corps.hrAcc || 0, dayHrAcc: g.corps.dayHrAcc || 0, co: {}, extra: (g.corps.extra || []).slice() };
    for (const id in g.corps.list) out.co[id] = serializeCompany(g.corps.list[id]);
    return out;
  }
  function apply(obj) {
    if (!obj || (obj.v !== 1 && obj.v !== 2)) return;
    reset();
    if (obj.v === 1) {
      // legacy E5/E6-era single-Bunbros blob: hydrate Bunbros only, the other
      // 7 (and any IPOs — there were none pre-E7) start fresh, as intended.
      applyCompany(g.corps.list[BUNBROS_ID], obj);
      g.corps.hrAcc = obj.hrAcc || 0;
      return;
    }
    if (Array.isArray(obj.extra)) {
      for (const spec of obj.extra) {
        if (!spec || !spec.id || g.corps.list[spec.id]) continue;
        g.corps.extra.push(spec);
        const co = freshCompany(spec); co.active = true;
        g.corps.list[spec.id] = co;
      }
    }
    if (obj.co) for (const id in obj.co) if (g.corps.list[id]) applyCompany(g.corps.list[id], obj.co[id]);
    g.corps.hrAcc = obj.hrAcc || 0;
    g.corps.dayHrAcc = obj.dayHrAcc || 0;
  }

  CBZ.corps = {
    BUNBROS_ID: BUNBROS_ID,
    COMPANIES: COMPANIES.slice(),
    get: function (id) { ensureInit(); return g.corps.list[id || BUNBROS_ID] || null; },
    list: function () { ensureInit(); const out = []; for (const id in g.corps.list) out.push(g.corps.list[id]); return out; },
    summary: summary,
    summaryAll: summaryAll,
    tickerLine: tickerLine,
    isOutlet: function (lot) { return !!(lot && lot._corpOutlet); },
    companyOfLot: function (lot) { ensureInit(); const id = lot && lot._corpOutlet; return id ? g.corps.list[id] : null; },
    robOutlet: robOutlet,
    creditRevenue: creditRevenue,
    debitCash: debitCash,
    notifyDestruction: notifyDestruction,
    createIPO: createIPO,
    serialize: serialize,
    apply: apply,
    reset: reset,
  };

  // ============================================================
  //  SINGLE-PLAYER PERSIST — sim/npcecon.js's g.cityWorld pattern, verbatim:
  //  stamp the live company state onto g.cityWorld right before the existing
  //  commit/collect save hooks run, hydrate back out whenever that ledger
  //  object's REFERENCE changes. Own idempotence flag (_corpWrap).
  // ------------------------------------------------------------
  function stampCorp() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.corp = serialize();
  }
  let _ensureCorpSaveWraps_done = false;
  function ensureCorpSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureCorpSaveWraps_done) return;
    _ensureCorpSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._corpWrap) {
      const w = function () { stampCorp(); return commit.apply(this, arguments); };
      w._corpWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._corpWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampCorp(); return col.apply(this, arguments); };
      wc._corpWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.corp) apply(led.corp);
  }
  if (CBZ.onUpdate) {
    // next free slot after sim/npcecon.js's 45.97 — same install-tick family.
    CBZ.onUpdate(45.98, function () {
      if (!g) return;
      ensureCorpSaveWraps();
      hydrateFromLedger();
    });
  }
})();
