/* ============================================================
   city/countries.js — Stage X, step X3: COUNTRY REGISTRY V2.

   MASTER-PLAN V.1a (verbatim): "The launch world is not one republic: it
   is 5+ countries of deliberately unequal size, wealth, and character...
   Different shapes: state and city counts are per-country data, never a
   fixed template. Different wealth: each country has a wealthLevel that
   seeds everything... Different architecture: settlement tiers per
   region — metropolis, town, village... Relations: (X6, later)."

   BUILD-PLAN X3 (verbatim): "Country registry v2: 5+ countries as data
   records {wealthLevel, demographics config, settlement mix, currencyId
   placeholder} with varied state/city counts; polity tree + worldmap
   landmasses for the new territories (new islands/landmasses across the
   archipelago)."

   M1 (sim/currency.js) FILLS the currencyId placeholder below: veridia ->
   VDM, kesh -> KSD, solara -> SOL, mbeya -> MBS (the republic's LBD is
   hardcoded on city/polity.js's own "republic" record — see that file).
   city/polity.js's registerCountry() plumbs cd.currencyId straight onto the
   country record it builds (same flow wealthLevel/govType already use), and
   sim/currency.js's registry is the single source of truth for what those
   ids mean (name/symbol) — see that file's header for the naming
   rationale. Pure data, no behaviour change: nothing reads a country
   record's currencyId this wave.

   THIS WAVE ships 4 NEW countries (+ the existing "republic" = 5+ total):
     veridia — Republic of Veridia, wealthLevel .85, 2 states (each ONE
       settlement): a big 4x4 capital (skyline maxStoreys 14) + a smaller
       harbor town.
     kesh    — Kingdom of Kesh, wealthLevel .35, govType "monarchy" (the
       succession MACHINERY — heirOf, legitimacy — is P6b/later; this wave
       just seeds the field, per the task brief). 1 state: a low-rise 3x3
       capital + 2 villages (2x2, the "village look" until X5's hut/shack
       prefab kit lands — SEE NOTE below).
     solara  — Solara, wealthLevel .6, a single-settlement, single-state
       ISLAND CITY-STATE (4x4, mid-rise).
     mbeya   — Mbeya Federation, wealthLevel .25 (the poorest), 2 states:
       a low-rise capital + 3 villages (largest village COUNT). Uses the
       DEFAULT population pools this wave — X4 gives it (and everyone) a
       real demographics config; no edit needed here when that lands.

   NOTE (villages, X5 — LANDED): every "village"-tier settlement below now
   clones CBZ.CITY_TEMPLATES.village (city/villagekit.js's hut/mud-brick/
   thatch/corrugated-shack kit — huts, a well, a market stall, one food
   shopfront), not harvestmarket's low-rise glass shells. Capitals
   (keshtown/mbeyacity) deliberately stay on "harvestmarket" — the task's
   "a poor capital = few towers over shacks" reads as low-rise, not a
   hut village; see each capital's own baseTemplate comment.

   DATA vs GEOMETRY SPLIT (deliberate — see file body): CBZ.COUNTRIES (the
   pure data table: id/name/wealthLevel/govType/settlements/states) is
   published UNCONDITIONALLY, before any THREE check — city/polity.js reads
   it at buildRecords()-call time (every polityReset()) regardless of
   whether THREE/rendering is even available (a headless harness has no
   THREE — citytemplates.js already sets this precedent: pure data, zero
   THREE guard). Only the GEOMETRY builder below (addLandmass) is gated on
   THREE, same as every other city/*.js landmass module.

   SITES: 4 new landmasses far out in open ocean, verified clear of EVERY
   pre-existing registered region/placement rect (mainland, annex, speedway,
   airport, Fort Brandt, desert/forest/snow/farmland biomes, and all 4
   minicities.js PLACEMENTS) — see the header comment on the PLACEMENTS-like
   array below for the actual numbers and the clearance math. NO causeways
   to the mainland: these are separate countries, reachable by air/boat
   (comment: ferry/flight scheduling is later work — Halloran Field already
   physically exists as the airport).

   ECONSTATE: each country's CAPITAL gets a sim/econstate.js jurisdiction
   this wave (governors/villages do not — same "one city this wave" scoping
   econstate.js's own P1-era header already used for libertyville), seeded
   with activity scaled off wealthLevel (task's own worked example: wealth
   .25 -> activity .70 start). npcecon.js cohorts stay mainland-only this
   wave (comment, per the task brief: X4 extends demographics + cohorts to
   the new countries).

   OFFICIALS/ELECTIONS: no code here — city/officials.js was generalized to
   mint a holder (title by kind/govType/tier — Mayor/Chief/Governor/
   President or King/Queen for a monarchy) for EVERY city/state/country
   record, and city/elections.js was generalized the same way (+ a govType
   guard: a monarchy office never calls an election). Both pick up every
   settlement/state/country below with ZERO edits once registerCity/
   registerState/registerCountry seed them (see city/polity.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // ============================================================
  //  WEALTH SCALING — one shared formula so "wealthLevel scales density/
  //  storeys/skyline" is a real function, not per-country hand-tuning.
  //  wealthFactor(w) ranges [0.55 (w=0), 1.20 (w=1)] — a poor country's
  //  authored "base" numbers land noticeably shorter/sparser than a rich
  //  one's SAME base, without every settlement needing its own formula.
  // ============================================================
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function wealthFactor(w) { return 0.55 + 0.65 * clamp01(w); }
  function scaleSkyline(base, wealth) {
    const f = wealthFactor(wealth);
    base = base || {};
    return {
      minStoreys: Math.max(1, Math.round((base.minStoreys != null ? base.minStoreys : 1) * f)),
      maxStoreys: Math.max(2, Math.round((base.maxStoreys != null ? base.maxStoreys : 3) * f)),
      towerFrac: Math.max(0.02, Math.min(0.7, (base.towerFrac != null ? base.towerFrac : 0.1) * (0.5 + 0.7 * clamp01(wealth)))),
      megaChance: wealth >= 0.55 ? !!base.megaChance : false,
      townMax: base.townMax || 4,
    };
  }
  function scaleDensity(base, wealth) {
    return Math.round(Math.max(0.25, Math.min(0.95, base * (0.6 + 0.55 * clamp01(wealth)))) * 100) / 100;
  }
  function scaleColor(hex, factor) {
    if (typeof hex !== "number") return hex;
    const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 255) * factor)));
    const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 255) * factor)));
    const b = Math.max(0, Math.min(255, Math.round((hex & 255) * factor)));
    return (r << 16) | (g << 8) | b;
  }
  function scalePalette(pal, wealth) {
    // poorer countries read duller/dirtier (a cheap, defensible stand-in for
    // real per-region art direction — X5's village kit is the real answer).
    const f = 0.62 + 0.45 * clamp01(wealth);
    const out = {};
    for (const k in pal || {}) out[k] = scaleColor(pal[k], f);
    return out;
  }
  // clone an existing citytemplates.js recipe, wealth-scaling density/
  // skyline/palette, then applying the settlement's OWN explicit overrides
  // (cols/rows/block sizes, name, subtitle, district) on top — explicit
  // numbers always win over the formula (the task's own worked examples:
  // veridia's capital maxStoreys 14, kesh's capital 4 / villages 2, kesh's
  // villages density .5 — the bases below are chosen so the FORMULA lands
  // on/very near those exact numbers; see each settlement's skylineBase).
  function countrySettlementTemplate(s, wealth) {
    const base = CBZ.cityTemplate && CBZ.cityTemplate(s.baseTemplate);
    if (!base) return null;
    const density = scaleDensity(s.densityBase != null ? s.densityBase : (base.density || 0.6), wealth);
    const skyline = scaleSkyline(s.skylineBase, wealth);
    const palette = scalePalette(base.palette, wealth);
    return Object.assign({}, base, {
      cols: s.cols, rows: s.rows, blockW: s.blockW, blockD: s.blockD, roadW: s.roadW,
      density: density, skyline: skyline, palette: palette,
      name: s.name, subtitle: s.subtitle, district: s.id,
    });
  }

  // ============================================================
  //  COUNTRY DATA — read by city/polity.js (registerCountry/registerState/
  //  registerCity) at buildRecords()-call time, and by THIS file's own
  //  landmass builder below for geometry. Published UNCONDITIONALLY (no
  //  THREE guard) — see file header.
  //
  //  SITES (verified clear of every pre-existing region — see the overlap
  //  ledger this header keeps): existing world envelope tops out around
  //  X∈[-1215,1580] / Z∈[-1780,280] (mainland/annex/speedway/airport/
  //  military/desert/forest/snow/farmland/goldspire/capeharbor/neonreef/
  //  foundry — every one of those rects copied verbatim in city/polity.js).
  //  Every settlement rect below sits AT LEAST ~200 units past that
  //  envelope's nearest edge in X (kesh/veridia/solara: east, minX >=1800;
  //  mbeya: west, maxX <=-1874) — since region overlap requires BOTH axes
  //  to intersect, clearing the X envelope alone is sufficient regardless
  //  of Z; the X3 harness re-derives and asserts this pairwise at runtime
  //  (grep "x3harness" / see the reported output).
  // ============================================================
  const COUNTRIES = [
    {
      id: "veridia", name: "Republic of Veridia", wealthLevel: 0.85,
      // M1: currencyId placeholder filled (sim/currency.js's registry) —
      // Veridian Mark (VDM), a rich harbor-finance note.
      currencyId: "VDM",
      settlements: [
        {
          // NOTE: the settlement id is DISTINCT from the country id ("veridia")
          // — polity.js's registerCountry/registerState/registerCity are all
          // idempotent-by-id, so a capital sharing its country's id would
          // silently resolve to the COUNTRY record instead of creating a
          // city record (caught by the X3 harness — see its report).
          id: "veridiacity", name: "Veridia City", subtitle: "Capital", capital: true, tier: "capital",
          cx: 2000, cz: -400, hx: 145, hz: 140,
          cols: 4, rows: 4, blockW: 50, blockD: 44, roadW: 14,
          baseTemplate: "goldspire", densityBase: 0.78,
          // base 13 * wealthFactor(.85)=1.1025 -> round(14.3)=14 (task's own "maxS 14")
          skylineBase: { minStoreys: 5, maxStoreys: 13, towerFrac: 0.5, megaChance: true, townMax: 4 },
        },
        {
          id: "lowport", name: "Veridia Lowport", subtitle: "Harbor Town", capital: false, tier: "town",
          cx: 2000, cz: -680, hx: 95, hz: 75,
          cols: 3, rows: 2, blockW: 42, blockD: 38, roadW: 12,
          baseTemplate: "pinecrest", densityBase: 0.6,
          skylineBase: { minStoreys: 2, maxStoreys: 4, towerFrac: 0.15, megaChance: false, townMax: 4 },
        },
      ],
      states: [
        { id: "veridia_prime", name: "Veridia Prime", settlementIds: ["veridiacity"] },
        { id: "veridia_south", name: "Veridia Southlands", settlementIds: ["lowport"] },
      ],
    },
    {
      id: "kesh", name: "Kingdom of Kesh", wealthLevel: 0.35, govType: "monarchy",
      // M1: currencyId placeholder filled — Kesh Dinar (KSD), the royal-
      // treasury coinage a monarchy's culture reads as.
      currencyId: "KSD",
      settlements: [
        {
          // (distinct from the country id "kesh" — see veridiacity's note above)
          id: "keshtown", name: "Keshtown", subtitle: "Royal Capital", capital: true, tier: "capital",
          cx: 1900, cz: -1600, hx: 100, hz: 95,
          cols: 3, rows: 3, blockW: 42, blockD: 38, roadW: 13,
          baseTemplate: "harvestmarket", densityBase: 0.6,   // X5: capitals stay low-rise harvestmarket, not hut-village (task: "keep capitals as-is")
          // base 5 * wealthFactor(.35)=.7775 -> round(3.9)=4 (task's own "low-rise maxS 4")
          skylineBase: { minStoreys: 1, maxStoreys: 5, towerFrac: 0.08, megaChance: false, townMax: 4 },
        },
        {
          id: "kesh_north", name: "Nur Hollow", subtitle: "Village", capital: false, tier: "village",
          cx: 1900, cz: -1380, hx: 70, hz: 62,
          cols: 2, rows: 2, blockW: 36, blockD: 32, roadW: 11,
          baseTemplate: "village", densityBase: 0.63,  // X5: the real hut/mud-brick village kit (villagekit.js)
          // density .63*(.6+.55*.35)=.63*.7925=.499 ≈ task's own "density 0.5"
          // base 3 * wealthFactor(.35)=.7775 -> round(2.3)=2 (task's own "maxS 2")
          skylineBase: { minStoreys: 1, maxStoreys: 3, towerFrac: 0.02, megaChance: false, townMax: 2 },
        },
        {
          id: "kesh_east", name: "Adar's Well", subtitle: "Village", capital: false, tier: "village",
          cx: 2160, cz: -1600, hx: 70, hz: 62,
          cols: 2, rows: 2, blockW: 36, blockD: 32, roadW: 11,
          baseTemplate: "village", densityBase: 0.63,  // X5: the real hut/mud-brick village kit (villagekit.js)
          skylineBase: { minStoreys: 1, maxStoreys: 3, towerFrac: 0.02, megaChance: false, townMax: 2 },
        },
      ],
      states: [
        { id: "kesh_heartland", name: "Kesh Heartland", settlementIds: ["keshtown", "kesh_north", "kesh_east"] },
      ],
    },
    {
      id: "solara", name: "Solara", wealthLevel: 0.6,
      // M1: currencyId placeholder filled — Solara Sol (SOL), the sunny
      // island city-state's note (Sol doubles as sun/currency).
      currencyId: "SOL",
      settlements: [
        {
          // (distinct from the country id "solara" — see veridiacity's note above)
          id: "solaracity", name: "Solara", subtitle: "City-State", capital: true, tier: "capital",
          cx: 2200, cz: 600, hx: 130, hz: 125,
          cols: 4, rows: 4, blockW: 44, blockD: 40, roadW: 13,
          baseTemplate: "capeharbor", densityBase: 0.68,
          skylineBase: { minStoreys: 4, maxStoreys: 9, towerFrac: 0.3, megaChance: true, townMax: 4 },
        },
      ],
      states: [
        { id: "solara_isle", name: "Solara Isle", settlementIds: ["solaracity"] },
      ],
    },
    {
      id: "mbeya", name: "Mbeya Federation", wealthLevel: 0.25,
      // M1: currencyId placeholder filled — Mbeya Shilling (MBS), the
      // real-world East-African-federation coinage this culture reads as.
      currencyId: "MBS",
      // X4 gives Mbeya (and everyone) a real demographics config (skin-tone
      // distribution, name pools, dress palette) — this wave it draws from
      // the SAME default population pools every other settlement does.
      settlements: [
        {
          // (distinct from the country id "mbeya" — see veridiacity's note above)
          id: "mbeyacity", name: "Mbeya City", subtitle: "Federal Capital", capital: true, tier: "capital",
          cx: -2200, cz: -1200, hx: 95, hz: 88,
          cols: 3, rows: 3, blockW: 40, blockD: 36, roadW: 12,
          baseTemplate: "harvestmarket", densityBase: 0.55,  // X5: capitals stay low-rise harvestmarket, not hut-village (task: "keep capitals as-is")
          skylineBase: { minStoreys: 1, maxStoreys: 4, towerFrac: 0.06, megaChance: false, townMax: 3 },
        },
        {
          id: "mbeya_west", name: "Kolo Village", subtitle: "Village", capital: false, tier: "village",
          cx: -2460, cz: -1200, hx: 66, hz: 58,
          cols: 2, rows: 2, blockW: 34, blockD: 30, roadW: 11,
          baseTemplate: "village", densityBase: 0.58,  // X5: the real hut/mud-brick village kit (villagekit.js)
          skylineBase: { minStoreys: 1, maxStoreys: 3, towerFrac: 0.02, megaChance: false, townMax: 2 },
        },
        {
          id: "mbeya_south", name: "Tende Village", subtitle: "Village", capital: false, tier: "village",
          cx: -2200, cz: -1420, hx: 66, hz: 58,
          cols: 2, rows: 2, blockW: 34, blockD: 30, roadW: 11,
          baseTemplate: "village", densityBase: 0.58,  // X5: the real hut/mud-brick village kit (villagekit.js)
          skylineBase: { minStoreys: 1, maxStoreys: 3, towerFrac: 0.02, megaChance: false, townMax: 2 },
        },
        {
          id: "mbeya_east", name: "Ruvu Village", subtitle: "Village", capital: false, tier: "village",
          cx: -1940, cz: -1200, hx: 66, hz: 58,
          cols: 2, rows: 2, blockW: 34, blockD: 30, roadW: 11,
          baseTemplate: "village", densityBase: 0.58,  // X5: the real hut/mud-brick village kit (villagekit.js)
          skylineBase: { minStoreys: 1, maxStoreys: 3, towerFrac: 0.02, megaChance: false, townMax: 2 },
        },
      ],
      states: [
        { id: "mbeya_central", name: "Mbeya Central", settlementIds: ["mbeyacity"] },
        { id: "mbeya_outlands", name: "Mbeya Outlands", settlementIds: ["mbeya_west", "mbeya_south", "mbeya_east"] },
      ],
    },
  ];
  CBZ.COUNTRIES = COUNTRIES;   // city/polity.js reads this — see that file's buildRecords()

  // ============================================================
  //  ECONSTATE SEEDING — each country CAPITAL gets a sim/econstate.js
  //  jurisdiction (governors/villages don't, this wave — same "one city"
  //  scoping econstate.js's own header already used before X3). Runs once
  //  per life (mirrors officials.js's own g.officials.inited one-shot
  //  pattern exactly — see that file's mint tick at 46.08), AFTER
  //  econState.reset() has run (city/peds.js's spawnCityPeds), so it must
  //  be gated on g.cityEconState actually existing yet, not just on mode.
  //  NO THREE dependency — registered here, ABOVE the THREE guard below, so
  //  it still runs in a headless/no-render context exactly like polity's
  //  own reads of CBZ.COUNTRIES (a landmass never gets BUILT without THREE,
  //  but the political/economic records behind it still must exist).
  // ============================================================
  CBZ.onUpdate(46.2, function () {
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    if (gm.countriesEconSeeded) return;
    if (!CBZ.econState || !gm.cityEconState || !gm.cityEconState.reg) return;   // econState.reset() hasn't run yet this life
    try {
      const reg = gm.cityEconState.reg;
      for (const cd of COUNTRIES) {
        const cap = (cd.settlements || []).find(function (s) { return s.capital; });
        if (!cap || reg[cap.id]) continue;   // idempotent — a restored save may already carry this id
        const wealth = clamp01(cd.wealthLevel);
        // task's own worked example: wealth .25 -> activity .70 start.
        const activity = Math.round((0.55 + 0.6 * wealth) * 1000) / 1000;
        reg[cap.id] = {
          activity: activity, employment: 0.85, priceIndex: 1.0, piYest: 1.0,
          taxRate: 0.10, treasury: Math.round(wealth * 25000),
        };
      }
    } catch (e) {}
    gm.countriesEconSeeded = true;
  });

  // ============================================================
  //  GEOMETRY — needs THREE; everything above (the data table + econstate
  //  seeding) does not.
  // ============================================================
  if (!window.THREE) return;
  const THREE = window.THREE;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  // same tiny deterministic LCG shape as minicities.js ("no Math.random in
  // layout — owner rule #5"), one independent stream per settlement seeded
  // off its own coordinates.
  function lcg(seed) {
    let s = seed >>> 0 || 1;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }
  function rngFor(cx, cz) {
    return lcg((Math.abs(cx | 0) * 73856093) ^ (Math.abs(cz | 0) * 19349663) ^ 0x9e17a5);
  }

  function addPad(root, cx, cz, w, d, color, y) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(cx, y == null ? 0.02 : y, cz);
    const m = new THREE.Mesh(g, cmat(color));
    m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
    root.add(m);
    return m;
  }

  function unionOfSettlements(settlements) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < settlements.length; i++) {
      const s = settlements[i];
      minX = Math.min(minX, s.cx - s.hx); maxX = Math.max(maxX, s.cx + s.hx);
      minZ = Math.min(minZ, s.cz - s.hz); maxZ = Math.max(maxZ, s.cz + s.hz);
    }
    return { minX, maxX, minZ, maxZ };
  }

  // build ONE settlement: (a) ground pad, (b)+(c) grow the town via the
  // reusable generator (T1's arena wiring makes every shop/home/road
  // register itself into Zillow/shops/jobs automatically), (e) register its
  // walkable region, (f) a work-anchor at the 1-2 most-central shops IF this
  // is the capital (task: "registerWorkAnchor per capital"). NO causeway —
  // separate countries, reached by air/boat (comment: ferries/flights are
  // later work; Halloran Field already physically exists).
  function buildSettlement(city, cd, s) {
    const root = city.root; if (!root) return;
    const tpl = countrySettlementTemplate(s, cd.wealthLevel);
    if (!tpl || typeof CBZ.buildTown !== "function") return;
    const cx = s.cx, cz = s.cz, hx = s.hx, hz = s.hz;
    const rect = { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
    const rng = rngFor(cx, cz);

    addPad(root, cx, cz, hx * 2 + 16, hz * 2 + 16, (tpl.palette && tpl.palette.ground != null) ? tpl.palette.ground : 0x6f7480, 0.018);
    if (CBZ.placement && CBZ.placement.seedFromColliders) { try { CBZ.placement.seedFromColliders(); } catch (e) {} }

    const town = CBZ.buildTown(root, Object.assign({}, tpl, { cx: cx, cz: cz, rng: rng, region: rect }));
    if (!town) return;

    CBZ.registerCityRegion(city, {
      name: s.name, subtitle: s.subtitle || (s.capital ? "Capital" : "Settlement"), biome: s.id, kind: "rect",
      minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ, pad: 8,
    });

    if (s.capital && CBZ.registerWorkAnchor && town.lots && town.lots.length) {
      const shops = town.lots
        .filter(function (l) { return l.building && l.building.shop && l.building.vendorSpot; })
        .sort(function (a, b) { return Math.hypot(a.cx - cx, a.cz - cz) - Math.hypot(b.cx - cx, b.cz - cz); })
        .slice(0, 2);
      for (const sh of shops) {
        try {
          CBZ.registerWorkAnchor({
            biome: s.id, kind: "shop", role: "shopkeeper", x: sh.cx, z: sh.cz, cap: 1,
            spots: [{ x: sh.building.vendorSpot.x, z: sh.building.vendorSpot.z }],
            home: { x: sh.cx, z: sh.cz },
          });
        } catch (e) {}
      }
    }
  }

  function buildCountry(city, cd) {
    const settlements = cd.settlements || [];
    for (let i = 0; i < settlements.length; i++) {
      try { buildSettlement(city, cd, settlements[i]); }
      catch (e) { try { console.error("[countries]", cd.id, settlements[i].id, e); } catch (e2) {} }
    }
    // whole-country landmass region (registered LAST, after every settlement's
    // own precise region, so cityAnyRegion's linear scan still returns the
    // SPECIFIC settlement biome for a point that's inside one — this region
    // only ever matches the open countryside BETWEEN settlements).
    const u = unionOfSettlements(settlements);
    if (isFinite(u.minX)) {
      CBZ.registerCityRegion(city, {
        name: cd.name, subtitle: "Country", biome: cd.id, kind: "rect",
        minX: u.minX - 20, maxX: u.maxX + 20, minZ: u.minZ - 20, maxZ: u.maxZ + 20, pad: 8,
      });
    }
  }

  // register ALL 4 countries as ONE landmass builder, order 35 (after
  // minicities.js's own 34) — each country independently try/caught so one
  // bad nation can never sink the rest of the world (worldmap contract).
  CBZ.addLandmass(function (city) {
    for (const cd of COUNTRIES) {
      try { buildCountry(city, cd); } catch (e) { try { console.error("[countries]", cd.id, e); } catch (e2) {} }
    }
  }, 35);
})();
