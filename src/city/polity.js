/* ============================================================
   city/polity.js — Stage P, step P1: THE JURISDICTION REGISTRY
   (country → state → city) + the WORLD-DAY counter.

   MASTER-PLAN Part V.1: "Hierarchy country → state → city mapped onto
   real geography: State of Liberty (mainland Libertyville + annex +
   airport), Costa del Este (Goldspire, Cape Harbor, desert, farmland,
   speedway), Westmark (Neon Reef, Foundry, forest, snow). The military
   island (Fort Brandt) is federal territory... jurisdiction records
   {id, kind, name, parent, rect, govType, treasury, taxRate, approval,
   mood, office:{holder,deputy,termDay,electionDay}, warWith, warRemain,
   warIntensity}... Cities self-register (CBZ.polity.registerCity)."

   THIS WAVE ships ONE country + THREE states + FIVE cities (the mainland
   + the 4 mini-cities) + Fort Brandt as its own "federal" jurisdiction —
   matching V.1's hierarchy exactly. The comment there about M2 splitting
   the archipelago into three separate COUNTRIES later is why every record
   already carries a `parent` id instead of anything more rigid: re-parenting
   "costa"/"westmark" under their own new country ids later is a one-line
   edit per record, not a schema change. Likewise `mood`/`office.electionDay`/
   `warWith`/`warRemain`/`warIntensity` from the MASTER-PLAN shape are NOT
   included yet — P2 (elections)/P3/P4 add them to these SAME objects
   in place (grep `office.termDay` when that lands).

   GEOMETRY SOURCES (read once, copied here — none of these are exposed on
   CBZ by their owning modules, so this file keeps its own copies and notes
   where to look if they ever drift):
     - mainland footprint: computed from CBZ.CITY (config.js) with the exact
       same half/ROAD math as city/world.js's buildCity() (minX/maxX/minZ/
       maxZ) — kept DYNAMIC (not copied numbers) so a CITY.blocks/block/road
       tuning change can't silently desync the mainland's political rect.
     - mini-city rects: city/minicities.js's PLACEMENTS array (~lines 45-54),
       copied verbatim (cx/cz/hx/hz) — that array is module-private, so this
       is a snapshot; keep in sync if PLACEMENTS ever moves the cities.
     - Fort Brandt: city/island_military.js's CEN_X/CEN_Z/HX/HZ footprint
       constants, copied verbatim.
     - state rects are NOT hand-picked: each is the axis-aligned UNION of its
       member cities' rects (unionRect below), so "which state is nearest"
       (registerCity's fallback) reads off real geography, not guesswork.
     - country ("republic") has no rect of its own — it's the hierarchy
       root, never a point-containment target (see `of()` below).

   of(x,z): resolves a WORLD POINT to its city/federal-territory record.
   Only `kind:"city"` and `kind:"federal"` records are point targets (states
   and the country are pure hierarchy nodes — a point never "is" a state,
   it's IN a city that's IN a state). Rect containment is a handful of
   compares over ≤6 records, but city political queries (rent/tax/heat UI,
   the coming election/voter-bloc code) can run every frame from many
   call-sites, so results are cached per 16m chunk (a cheap Map keyed by
   floor(x/16)+"_"+floor(z/16)) — good enough because jurisdiction borders
   don't move mid-run and a chunk is small relative to every rect here
   (only a chunk straddling a border could read one cell's-width wrong,
   which is an acceptable trade for a synchronous per-call Map lookup
   instead of a rect scan). The cache is cleared whenever the roster
   changes (registerCity, reset).

   WORLDDAY: daynight.js runs a continuous 0..1 CBZ.dayPhase() with NO
   day counter (that file's own header says so). This adds one: a plain
   onAlways tick (order 3 — one slot after daynight.js's own order-2 tick,
   so it reads THIS frame's already-advanced phase) watches for the phase
   wrapping (new < old − 0.5, i.e. a big backward jump = a lap of the
   150s cycle) and increments a day counter + fires every CBZ.onNewDay(fn)
   subscriber (each isolated in its own try/catch — one bad subscriber,
   e.g. a broken election check, must never wedge everyone else's tick).
   CBZ.worldDay() is exposed getter/setter-style like CBZ.dayPhase (no
   arg reads it, a finite arg sets it — apply() below uses the setter path
   so a loaded save's day sticks even before the first onAlways tick runs).

   ECONSTATE TIE: sim/econstate.js's one jurisdiction this wave is the
   string id "libertyville" (its DEFAULT_ID). The libertyville CITY record
   here gets a `.econ = "libertyville"` pointer field — just a same-name
   cross-reference for now (both happen to be "libertyville"); the day
   real per-state/per-city EconStates exist, this pointer is how a polity
   record finds ITS econ bucket without the two modules needing to share
   an id scheme beyond this one field. No deeper merge yet (by design).

   PERSISTENCE (two riders, same shape as familytree.js/econstate.js):
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() carry
       serialize()/apply() as blob.pol (edited there, right beside blob.econ).
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own guard
       flag _polWrap, familytree.js's exact pattern) so g.cityWorld.polity
       rides the localStorage ledger and rehydrates on any g.cityWorld
       reference change.
   serialize() only carries each record's MUTABLE fields (govType, treasury,
   taxRate, approval, office.{holder,deputy,termDay}) + the worldDay counter
   — rect/kind/name/parent are fixed geography, rebuilt fresh by reset()
   every run, never carried in the save. apply() restores onto records that
   ALREADY EXIST by id; a save entry for an id nobody registered yet (e.g. a
   future generated city that hasn't self-registered before load) is
   silently skipped — a known P1 limitation, fine until the city generator
   (Part III/M2) actually ships cities that outlive a single run.

   worldDay does NOT survive reset(): a fresh run is day 0, always — the
   whole jurisdiction roster (treasury/approval/etc.) is rebuilt to its
   seed values too, exactly like every other city/*.js …Reset(). Only
   apply() (loading a save) can set worldDay/treasury/etc. to something
   other than day-one defaults.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ============================================================
  //  GEOMETRY — fixed rects (see header for sources)
  // ============================================================

  // mainland: mirrors city/world.js's buildCity() exactly (half = N*step/2,
  // step = block+road; the built ground/sea actually spans half + road/2
  // past centre on every side, which is the rect we use as the political
  // footprint too — computed live off CBZ.CITY so a tuning change can't
  // desync this from the real map).
  function mainlandRect() {
    const C = CBZ.CITY || {};
    const cx = (C.center && C.center.x) || 0, cz = (C.center && C.center.z) || -700;
    const N = C.blocks || 6, BLK = C.block || 34, ROAD = C.road || 16;
    const half = (N * (BLK + ROAD)) / 2;
    return { cx: cx, cz: cz, hx: half + ROAD / 2, hz: half + ROAD / 2 };
  }

  // mirrors city/minicities.js's PLACEMENTS array (~lines 45-54) verbatim.
  const GOLDSPIRE_RECT = { cx: 760, cz: 430, hx: 118, hz: 120 };
  const CAPEHARBOR_RECT = { cx: 430, cz: 175, hx: 120, hz: 120 };
  const NEONREEF_RECT = { cx: -1080, cz: -260, hx: 130, hz: 128 };
  const FOUNDRY_RECT = { cx: -1080, cz: 225, hx: 135, hz: 130 };
  // mirrors city/island_military.js's CEN_X/CEN_Z/HX/HZ (Fort Brandt footprint).
  const FORTBRANDT_RECT = { cx: -620, cz: -700, hx: 240, hz: 250 };

  // axis-aligned bounding union of a list of {cx,cz,hx,hz} rects — used to
  // derive each STATE's rect from its member cities (no hand-picked numbers).
  function unionRect(list) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      minX = Math.min(minX, r.cx - r.hx); maxX = Math.max(maxX, r.cx + r.hx);
      minZ = Math.min(minZ, r.cz - r.hz); maxZ = Math.max(maxZ, r.cz + r.hz);
    }
    return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, hx: (maxX - minX) / 2, hz: (maxZ - minZ) / 2 };
  }

  function rectContains(rect, x, z) {
    return rect && x >= rect.cx - rect.hx && x <= rect.cx + rect.hx &&
      z >= rect.cz - rect.hz && z <= rect.cz + rect.hz;
  }

  // ============================================================
  //  RECORD SEEDING — {govType, treasury, taxRate, approval, office}
  //  (the P2-P4 fields land on these SAME objects later — see header)
  // ============================================================
  function seedMutable(kind) {
    // city: 25000 (matches sim/econstate.js's START_TREASURY exactly — same
    // toy fiscal seed, one jurisdiction, two modules). state: 50000 (also
    // the federal territory's tier — V.1 doesn't specify one, and a base's
    // budget reads more like a state's than a five-block city's). country: 100000.
    const treasury = kind === "country" ? 100000 : (kind === "state" || kind === "federal") ? 50000 : 25000;
    return {
      govType: "democracy", treasury: treasury, taxRate: 0.10, approval: 55,
      office: { holder: null, deputy: null, termDay: null },
    };
  }

  let records = Object.create(null); // id -> record
  function addRecord(rec) { records[rec.id] = rec; return rec; }

  function buildRecords() {
    records = Object.create(null);

    addRecord(Object.assign(
      // M1 (sim/currency.js): the republic's currencyId, LBD (Liberty
      // Dollar) — MASTER-PLAN VI.8 names this one verbatim. Every
      // republic state/city below (Liberty, Costa del Este, Westmark,
      // Fort Brandt) inherits it implicitly via CBZ.polity.countryOf()
      // (sim/currency.js's jurisdictionCurrency() helper) rather than
      // stamping the field on each of them — one source, no drift.
      { id: "republic", kind: "country", name: "Republic of Liberty", parent: null, rect: null, currencyId: "LBD" },
      seedMutable("country")));

    addRecord(Object.assign(
      { id: "liberty", kind: "state", name: "Liberty", parent: "republic", rect: mainlandRect() },
      seedMutable("state")));
    addRecord(Object.assign(
      { id: "costa", kind: "state", name: "Costa del Este", parent: "republic", rect: unionRect([GOLDSPIRE_RECT, CAPEHARBOR_RECT]) },
      seedMutable("state")));
    addRecord(Object.assign(
      { id: "westmark", kind: "state", name: "Westmark", parent: "republic", rect: unionRect([NEONREEF_RECT, FOUNDRY_RECT]) },
      seedMutable("state")));

    // libertyville: the mainland IS the state of Liberty's one city this wave
    // (V.1: "State of Liberty (mainland Libertyville... + annex + airport)").
    // `.econ` is a pointer to sim/econstate.js's jurisdiction id — see header.
    addRecord(Object.assign(
      { id: "libertyville", kind: "city", name: "Libertyville", parent: "liberty", rect: mainlandRect(), econ: "libertyville" },
      seedMutable("city")));
    addRecord(Object.assign(
      { id: "goldspire", kind: "city", name: "Goldspire", parent: "costa", rect: Object.assign({}, GOLDSPIRE_RECT) },
      seedMutable("city")));
    addRecord(Object.assign(
      { id: "capeharbor", kind: "city", name: "Cape Harbor", parent: "costa", rect: Object.assign({}, CAPEHARBOR_RECT) },
      seedMutable("city")));
    addRecord(Object.assign(
      { id: "neonreef", kind: "city", name: "Neon Reef", parent: "westmark", rect: Object.assign({}, NEONREEF_RECT) },
      seedMutable("city")));
    addRecord(Object.assign(
      { id: "foundry", kind: "city", name: "Foundry", parent: "westmark", rect: Object.assign({}, FOUNDRY_RECT) },
      seedMutable("city")));

    // Fort Brandt: FEDERAL territory, direct child of the country — no state
    // in between (V.1: "the military island is federal territory, which is
    // what makes coups a national mechanic").
    addRecord(Object.assign(
      { id: "fortbrandt", kind: "federal", name: "Fort Brandt", parent: "republic", rect: Object.assign({}, FORTBRANDT_RECT) },
      seedMutable("federal")));

    // ============================================================
    // X3: COUNTRY REGISTRY V2 — 5+ countries, V.1a's "unequal size/wealth"
    // roster. city/countries.js publishes CBZ.COUNTRIES (a pure DATA table:
    // {id, name, wealthLevel, govType, settlements:[{id,name,capital,tier,
    // cx,cz,hx,hz}], states:[{id,name,settlementIds}]}) — read HERE, at
    // buildRecords()-call time (every polityReset(), i.e. every fresh run),
    // NOT at module-parse time, so <script> load order between this file and
    // countries.js never matters (countries.js loads later in index.html's
    // X-wave block, long before the first real reset() fires — see that
    // file's header for why relying on its addLandmass builder to self-
    // register via registerCity() would NOT survive this same buildRecords()
    // rebuild the mini-cities' hardcoded-copy precedent above already works
    // around).
    // registerCountry/registerState (new, below) + registerCity (existing,
    // extended below with wealthLevel/govType/tier) do the actual record
    // construction; govType propagates DOWN from country -> state -> city
    // unless a level specifies its own (kesh's whole tree is "monarchy" this
    // way — city/elections.js's govType guard then skips EVERY kesh office,
    // not just the crown, with one shared check).
    // ============================================================
    const extraCountries = CBZ.COUNTRIES || [];
    for (let ci = 0; ci < extraCountries.length; ci++) {
      const cd = extraCountries[ci];
      if (!cd || !cd.id) continue;
      registerCountry({ id: cd.id, name: cd.name, wealthLevel: cd.wealthLevel, govType: cd.govType, currencyId: cd.currencyId });
      const settleList = cd.settlements || [];
      const stateList = cd.states || [];
      for (let si = 0; si < stateList.length; si++) {
        const sd = stateList[si];
        const members = settleList.filter(function (s) { return sd.settlementIds.indexOf(s.id) >= 0; });
        const rect = members.length ? unionRect(members.map(function (s) { return { cx: s.cx, cz: s.cz, hx: s.hx, hz: s.hz }; })) : null;
        registerState({ id: sd.id, name: sd.name, parent: cd.id, rect: rect, wealthLevel: cd.wealthLevel });
      }
      for (let sk = 0; sk < settleList.length; sk++) {
        const s = settleList[sk];
        const parentState = stateList.find(function (sd) { return sd.settlementIds.indexOf(s.id) >= 0; });
        registerCity({
          id: s.id, name: s.name, parent: parentState ? parentState.id : null,
          rect: { cx: s.cx, cz: s.cz, hx: s.hx, hz: s.hz },
          wealthLevel: cd.wealthLevel, govType: cd.govType, tier: s.tier,
        });
      }
    }

    invalidateCache();
  }

  // ============================================================
  //  QUERIES
  // ============================================================
  function get(id) { return (id && records[id]) || null; }
  function list(kind) {
    const out = [];
    for (const id in records) if (records[id].kind === kind) out.push(records[id]);
    return out;
  }
  function stateOf(id) {
    let r = get(id);
    while (r && r.kind !== "state") r = r.parent ? get(r.parent) : null;
    return r;
  }
  function countryOf(id) {
    let r = get(id);
    while (r && r.kind !== "country") r = r.parent ? get(r.parent) : null;
    return r;
  }

  // ---- of(x,z): city/federal point resolution, 16m-chunk cached ----------
  const CHUNK = 16;
  let ofCache = new Map();
  let locatableCache = null; // lazily built list of {kind:city|federal} records
  function invalidateCache() { ofCache.clear(); locatableCache = null; }
  function locatable() {
    if (locatableCache) return locatableCache;
    const out = [];
    for (const id in records) {
      const r = records[id];
      if (r.kind === "city" || r.kind === "federal") out.push(r);
    }
    locatableCache = out;
    return out;
  }
  function chunkKey(x, z) { return Math.floor(x / CHUNK) + "_" + Math.floor(z / CHUNK); }
  function of(x, z) {
    const key = chunkKey(x, z);
    if (ofCache.has(key)) return ofCache.get(key);
    const cands = locatable();
    let hit = null;
    for (let i = 0; i < cands.length; i++) {
      if (rectContains(cands[i].rect, x, z)) { hit = cands[i]; break; }
    }
    ofCache.set(key, hit);
    return hit;
  }

  // ---- registerCity: the self-registration API (minicities.js today, the
  // Part-III generator tomorrow) ------------------------------------------
  // nearest-state assignment when parent is omitted: distance from the new
  // rect's centre to each state's rect centre (each state's rect is already
  // the union of its cities — see buildRecords — so this is a real "nearest
  // political capital region" pick, not a coin flip). Falls back to the
  // country id directly if somehow no state exists yet.
  function nearestStateId(rect) {
    const states = list("state");
    if (!states.length) return "republic";
    let bestId = states[0].id, bestD = Infinity;
    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const d = Math.hypot(rect.cx - s.rect.cx, rect.cz - s.rect.cz);
      if (d < bestD) { bestD = d; bestId = s.id; }
    }
    return bestId;
  }
  function registerCity(opts) {
    if (!opts || !opts.id || !opts.rect) return null;
    if (records[opts.id]) return records[opts.id]; // idempotent re-register
    const rect = { cx: opts.rect.cx, cz: opts.rect.cz, hx: opts.rect.hx, hz: opts.rect.hz };
    const parent = opts.parent || nearestStateId(rect);
    const parentRec = records[parent];
    // X3: wealthLevel/govType/tier are OPTIONAL — a caller that omits them
    // (any pre-X3 self-registration) gets the exact old behaviour (flat
    // 25000 treasury, "democracy", tier "town"). wealthLevel scales the
    // seeded treasury by "wealthLevel × base" (V.1a); govType defaults to
    // the parent state/country's own (so a monarchy's cities are monarchy
    // too, without every settlement having to say so) else "democracy".
    const base = seedMutable("city");
    const rec = Object.assign(
      { id: opts.id, kind: "city", name: opts.name || opts.id, parent: parent, rect: rect, tier: opts.tier || "town" },
      base);
    if (opts.wealthLevel != null) {
      rec.wealthLevel = Math.max(0, Math.min(1, +opts.wealthLevel));
      rec.treasury = Math.round(rec.wealthLevel * base.treasury);
    }
    rec.govType = opts.govType || (parentRec && parentRec.govType) || base.govType;
    records[opts.id] = rec;
    invalidateCache();
    return rec;
  }

  // ---- registerState/registerCountry: X3's "records for new countries/
  // states need direct registry additions" (registerCity alone only ever
  // self-registered cities). Same idempotent-by-id shape as registerCity;
  // treasuries scaled "wealthLevel × base" per V.1a, govType inherited from
  // the parent unless given explicitly (registerCountry has no parent to
  // inherit from — it's seeded straight off the data table's own govType,
  // "democracy" default). -----------------------------------------------
  function registerState(opts) {
    if (!opts || !opts.id) return null;
    if (records[opts.id]) return records[opts.id];
    const parent = opts.parent || "republic";
    const parentRec = records[parent];
    const base = seedMutable("state");
    const rec = Object.assign(
      { id: opts.id, kind: "state", name: opts.name || opts.id, parent: parent, rect: opts.rect || null },
      base);
    if (opts.wealthLevel != null) {
      rec.wealthLevel = Math.max(0, Math.min(1, +opts.wealthLevel));
      rec.treasury = Math.round(rec.wealthLevel * base.treasury);
    }
    rec.govType = opts.govType || (parentRec && parentRec.govType) || base.govType;
    records[opts.id] = rec;
    invalidateCache();
    return rec;
  }
  function registerCountry(opts) {
    if (!opts || !opts.id) return null;
    if (records[opts.id]) return records[opts.id];
    const base = seedMutable("country");
    const rec = Object.assign(
      { id: opts.id, kind: "country", name: opts.name || opts.id, parent: null, rect: null },
      base);
    if (opts.wealthLevel != null) {
      rec.wealthLevel = Math.max(0, Math.min(1, +opts.wealthLevel));
      rec.treasury = Math.round(rec.wealthLevel * base.treasury);
    }
    if (opts.govType) rec.govType = opts.govType;
    // M1 (sim/currency.js): a country's own currency id, straight from
    // city/countries.js's cd.currencyId (the X3 placeholder, now filled) —
    // same optional-field flow wealthLevel/govType already use above. Data
    // only: nothing reads rec.currencyId this wave except sim/currency.js's
    // own countryOf()-walking helper.
    if (opts.currencyId) rec.currencyId = opts.currencyId;
    records[opts.id] = rec;
    invalidateCache();
    return rec;
  }

  // ============================================================
  //  WORLDDAY — a monotonic counter on top of daynight.js's 0..1 phase
  // ============================================================
  let day = 0;
  let lastPhase = null; // null = "haven't sampled a phase yet" (no wrap on frame 1)
  const newDaySubs = [];

  // getter/setter, exactly like CBZ.dayPhase — apply() uses the setter arm
  // so a loaded save's day is live even before the next onAlways tick.
  CBZ.worldDay = function (v) { if (v != null && isFinite(v)) day = v | 0; return day; };
  CBZ.onNewDay = function (fn) { if (typeof fn === "function") newDaySubs.push(fn); };
  function fireNewDay() {
    for (let i = 0; i < newDaySubs.length; i++) {
      try { newDaySubs[i](day); }
      catch (e) { try { console.error("[polity] onNewDay subscriber threw", e); } catch (e2) {} }
    }
  }
  // exported so the harness can drive the wrap check without a real onAlways
  // loop (and so any future caller can force-check without waiting a frame).
  function checkDayWrap(phase) {
    if (lastPhase != null && phase < lastPhase - 0.5) { day++; fireNewDay(); }
    lastPhase = phase;
  }
  if (CBZ.onAlways) {
    // order 3 — one slot after daynight.js's own order-2 tick, so `p` below
    // is THIS frame's already-advanced (and already wrapped-mod-1) phase.
    CBZ.onAlways(3, function () {
      if (!CBZ.dayPhase) return;
      checkDayWrap(CBZ.dayPhase());
    });
  }

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serialize() {
    const rec = {};
    for (const id in records) {
      const r = records[id];
      rec[id] = {
        govType: r.govType, treasury: r.treasury, taxRate: r.taxRate, approval: r.approval,
        office: { holder: r.office.holder, deputy: r.office.deputy, termDay: r.office.termDay },
        // M6 (sim/hyperinflation.js): a dollarization event flips rec.currencyId
        // to "LBD" at runtime (sim/bonds.js/sim/centralbank.js/sim/inflation.js
        // all read THIS field directly, unlike CBZ.currency's own static
        // countryId->currency table) — without persisting it here, a reload
        // would silently un-dollarize a country (buildRecords() reseeds it from
        // city/countries.js's original static value). Only written when
        // present, so an old save with no currencyId ever set is unaffected.
        currencyId: r.currencyId || null,
      };
    }
    return { v: 1, day: day, rec: rec };
  }
  function apply(obj) {
    if (!obj || obj.v !== 1) return;
    if (obj.day != null && isFinite(obj.day)) CBZ.worldDay(obj.day);
    if (obj.rec) {
      for (const id in obj.rec) {
        const r = records[id];
        if (!r) continue; // record must already be registered (boot order) — see header
        const m = obj.rec[id];
        if (!m) continue;
        if (m.govType) r.govType = m.govType;
        if (isFinite(m.treasury)) r.treasury = +m.treasury;
        if (isFinite(m.taxRate)) r.taxRate = +m.taxRate;
        if (isFinite(m.approval)) r.approval = +m.approval;
        if (m.office) {
          r.office.holder = m.office.holder != null ? m.office.holder : null;
          r.office.deputy = m.office.deputy != null ? m.office.deputy : null;
          r.office.termDay = m.office.termDay != null ? m.office.termDay : null;
        }
        if (m.currencyId) r.currencyId = m.currencyId;   // M6: dollarization survives reload
      }
    }
  }
  // fresh run: rebuild every record to its seed values AND zero worldDay —
  // see header ("worldDay does NOT survive reset").
  function reset() {
    buildRecords();
    day = 0;
    lastPhase = null;
  }

  buildRecords(); // boot-time build so CBZ.polity.of/get/etc. work immediately

  CBZ.polity = {
    of: of, stateOf: stateOf, countryOf: countryOf, get: get, list: list,
    registerCity: registerCity, registerState: registerState, registerCountry: registerCountry,
    serialize: serialize, apply: apply, reset: reset,
    _checkDayWrap: checkDayWrap, // harness/test hook only — not part of the public contract
  };
  // top-level guard-call convention (cityGangsReset/citySocialReset/
  // cityFamilyTreeReset in mode.js's fresh-run sequence) — wired there too.
  CBZ.polityReset = reset;

  // ============================================================
  //  SINGLE-PLAYER PERSIST — familytree.js's exact pattern: stamp the live
  //  registry onto g.cityWorld right before the existing commit/collect save
  //  hooks run, hydrate back out whenever that ledger object's REFERENCE
  //  changes. Own idempotence flag (_polWrap).
  // ------------------------------------------------------------
  function stampPolity() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.polity = serialize();
  }
  let _ensurePolitySaveWraps_done = false;
  function ensurePolitySaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensurePolitySaveWraps_done) return;
    _ensurePolitySaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._polWrap) {
      const w = function () { stampPolity(); return commit.apply(this, arguments); };
      w._polWrap = true; CBZ.cityWorldCommit = w;
      if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._polWrap) {
        const col = CBZ.cityWorldCollect;
        const wc = function () { stampPolity(); return col.apply(this, arguments); };
        wc._polWrap = true; CBZ.cityWorldCollect = wc;
      }
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.polity) apply(led.polity);
  }
  if (CBZ.onUpdate) {
    // next free slot after sim/motorsport.js's 46.01 install-tick — same
    // install-tick family as familytree.js's 45.92.
    CBZ.onUpdate(46.03, function () {
      if (!g) return;
      ensurePolitySaveWraps();
      hydrateFromLedger();
    });
  }
})();
