/* ============================================================
   sim/npcecon.js — Stage E, step E4: NPC CIRCULATION.

   MASTER-PLAN VI.4 (verbatim, the circulation chain + the cohort trick):
     "Individuals (≤600 ledger NPCs): wallets/jobs exist; add rent-due and
     employer links, and a daily spend split (rent → landlord — the player,
     if they own the building; food → debits food.s and credits the shop's
     business). The circulation chain: rob a till → vendor's ledger cash
     drops → misses rent → your landlord income drops → 3 misses → tenant
     vacates → VACANCY_BASE finally real → district values dip. You can rob
     a district into a depression.
     Cohorts (the cheap trick): everyone else is statistics — 5 districts ×
     4 income classes = 20 rows {pop, employedFrac, wallet, propensities},
     one trivial pass per game hour. Freshly spawned peds draw cash from
     their cohort's mean (closing the robbery money-printer), and robbery
     debits the cohort wallet."

   THIS FILE is the cohort half of that chain (the individual-ledger half —
   schedule.js's per-identity wallets + city/economy.js's H4 rent tick —
   already exists and is untouched). 20 rows, one hourly pass, three
   consumers wired everywhere else in the codebase this wave:
     1. city/peds.js's makePed cash roll: an ordinary "resident" draws their
        spawn cash from their district cohort's mean instead of pure RNG —
        this is what CLOSES the money-printer: strip-mine a district and its
        future spawns carry less, not just its current pedestrians.
     2. city/peds.js's cityRobPed/cityLootCorpse: the cash the player actually
        takes off a body debits that ped's district+class cohort wallet.
     3. city/zillow.js's tenant-vacancy roll (VACANCY_BASE, previously an
        unreachable 0) now reads a district's cohort wallet stress.
   sim/econstate.js's daily wagesProxy also takes a small term from the
   CITY-WIDE cohort wallet health (see econstate.js's 2-line guarded edit).

   THE 20 ROWS: 5 districts (city/economy.js's DISTRICTS keys) × 4 income
   classes (the SAME wealth-tier cutpoints economy.js's rollCash already
   uses: <0.15 poor, <0.6 mid, <0.88 comf, else rich — one classifier,
   shared vocabulary). Each row: {d (district key), c (class key), pop
   (headcount share, seeded off CBZ.cityPopulation().alive), wallet
   (aggregate $, seeded pop × the class's mean), employedFrac, propensities
   {food:.4, goods:.17, rent:.25, ent:.1, save:.02, fuel:.04, luxury:.03,
   guns:.01} — E7 widened goods/save down to fund fuel/luxury/guns (the
   full 8-company roster's cohort demand signal); sums to 1.02 now, see
   the PROPENSITIES constant below for the documented rationale}.

   SEEDING: population splits unevenly across districts (the projects carry
   the most bodies, the island the fewest — DIST_SHARE below) and each
   district's class MIX skews toward its own economy.js tier (a richer
   district's residents skew rich, a poorer one skews poor) via a simple
   per-district reweight of the city-wide CLASS_BASE shares, renormalized to
   1.0 per district. `pop` is a fixed headcount share once seeded (killing
   the city already drains CBZ.cityPopulation() and feeds priceIndex/
   activity through econstate.js — this file doesn't double that); only
   `wallet` moves hour to hour.

   HOURLY PASS (order 29.6, right after econstate's 29.55 so this hour's
   freshly-settled activity/priceIndex are what income reads):
     income = pop·employedFrac·CLASS_WAGE[c]·activity·priceAdj
     wallet += income
     food/goods spend = income·propensity, drives CBZ.market.recordBuy
       (dollar amount ÷ DOLLARS_PER_UNIT ≈ a demand "quantity" — the SAME
       category-price faucet the player's own buying already feeds, so the
       20 cohorts now drive the market too, not just the player) — spent OUT
       of the wallet.
     ent spend = income·propensity, banked into `entPool` (a simple running
       total E9's casino module can read later for whale/house-side action;
       nothing consumes it yet).
     rent + save propensities are INTENTIONALLY left banked in the wallet
       this wave: rent has no cohort-level sink yet (city/economy.js's H4
       rent tick already drains the per-NPC LEDGER side of this, not the
       statistics side — wiring cohort rent into a real landlord ledger is
       future work); save is real household savings.

   VACANCY (city/zillow.js): VACANCY_BASE has been 0 since it was written —
   dead code waiting for a real signal. vacancyRate(dk) reads how far a
   district's cohort wallets have fallen from their seeded baseline and
   turns that into a real chance an owned unit sits empty next cycle.

   ROBBERY (city/peds.js): cityRobPed/cityLootCorpse debit(district, class,
   amount) the instant cash changes hands — the same $ that left the ped's
   pocket leaves their cohort's aggregate wallet, so the NEXT hourly pass
   spends less, nudging food/goods demand down, which (via market.js's
   activity-reversion target, sim/econstate.js's priceIndex, and this file's
   own vacancyRate) is the whole "rob a district into a depression" chain.

   PERSISTENCE: same two-rider pattern as econstate.js/market.js —
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() pick up
       serialize()/apply() beside blob.mkt/blob.econ (blob.npce).
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own guard
       flag _npceWrap) so g.cityWorld.npce rides the localStorage ledger.
   Fresh-run reset: city/peds.js's spawnCityPeds() resets market.js +
   econState right after cityPopulationReset() — this file's reset() sits
   right beside them (reads the FRESH population share).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const HOUR = 150 / 24;   // seconds per in-game hour — matches market.js/econstate.js exactly

  // ---- the 5 districts (city/economy.js's DISTRICTS keys, duplicated here
  // as a fixed list per VI.4's "5 districts" — this file has no hard
  // dependency on economy.js loading first; districtAt() calls are guarded
  // at every call site instead). --------------------------------------------
  const DISTRICT_KEYS = ["downtown", "projects", "waterfront", "uptown", "island"];
  // seeded population share per district — the projects carry the most
  // bodies, the island (exclusive, low-density) the fewest.
  const DIST_SHARE = { downtown: 0.24, projects: 0.28, waterfront: 0.20, uptown: 0.16, island: 0.12 };
  // fallback tier (mirrors economy.js's DISTRICTS[dk].tier) used to skew a
  // district's class mix when cityEcon's own table isn't reachable yet.
  const TIER_FALLBACK = { downtown: 1.00, projects: 0.78, waterfront: 0.92, uptown: 1.15, island: 1.30 };

  // ---- the 4 income classes — SAME cutpoints as economy.js's rollCash() so
  // "who is this ped" always maps to the same class whether the caller asks
  // this file or reads the comment in rollCash's own header. -----------------
  const CLASSES = ["poor", "mid", "comf", "rich"];
  const CLASS_MEAN = { poor: 40, mid: 120, comf: 400, rich: 1500 };     // seeded wallet-per-head
  const CLASS_WAGE = { poor: 6, mid: 14, comf: 32, rich: 90 };          // $/hr per employed head
  const EMPLOYED_FRAC = { poor: 0.75, mid: 0.90, comf: 0.90, rich: 0.60 }; // rich: more live off capital, not wages
  const CLASS_BASE = { poor: 0.30, mid: 0.45, comf: 0.18, rich: 0.07 };   // city-wide class mix, sums to 1.00
  // E7: widened for the full 8-company roster (sim/corporations.js) — guns/
  // fuel/luxury now flow from cohort spend so Ironclad/Meridian/Apex have a
  // real demand signal, not just player purchases. Funded by trimming goods
  // (.20->.17) and save (.05->.02); rent/ent/food untouched. The 8 shares
  // now sum to 1.02 (was an exact 1.00) — a small, documented drift: cohorts
  // spend very slightly more than they earn this wave, drawing down wallet
  // reserves a hair faster than before (materials demand stays player/
  // building-driven — no cohort propensity added for it, per plan).
  const PROPENSITIES = { food: 0.4, goods: 0.17, rent: 0.25, ent: 0.1, save: 0.02, fuel: 0.04, luxury: 0.03, guns: 0.01 };

  const DOLLARS_PER_UNIT = 30;   // $ spend -> a market.js recordBuy "quantity" (a toy conversion, documented)

  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

  function tierOf(dk) {
    const D = CBZ.cityEcon && CBZ.cityEcon.DISTRICTS;
    return (D && D[dk] && D[dk].tier) || TIER_FALLBACK[dk] || 1.0;
  }
  // classFor(wealth) -> "poor"|"mid"|"comf"|"rich", the SAME 0.15/0.6/0.88
  // cutpoints as city/economy.js's rollCash() (see that function's header).
  function classFor(wealth) {
    const w = wealth == null ? 0.3 : wealth;
    if (w < 0.15) return "poor";
    if (w < 0.6) return "mid";
    if (w < 0.88) return "comf";
    return "rich";
  }

  // per-district class mix: reweight the city-wide CLASS_BASE shares by this
  // district's tier (richer district -> skews rich, poorer -> skews poor),
  // then renormalize to 1.0 so every district's four class shares still sum
  // to exactly one.
  function classShareForDistrict(dk) {
    const tier = tierOf(dk);
    const w = {}; let sum = 0;
    for (const c of CLASSES) {
      const skew = c === "rich" ? tier : (c === "poor" ? (1 / tier) : 1);
      w[c] = CLASS_BASE[c] * skew;
      sum += w[c];
    }
    for (const c of CLASSES) w[c] = sum > 0 ? w[c] / sum : CLASS_BASE[c];
    return w;
  }

  // ---- state lives on g.npcEcon (mirrors g.cityMarket / g.cityEconState) --
  function seedRows() {
    const pop = CBZ.cityPopulation ? CBZ.cityPopulation() : null;
    const totalAlive = (pop && pop.alive > 0) ? pop.alive : 1000;   // fallback: a believable city
    const rows = [];
    for (const dk of DISTRICT_KEYS) {
      const shares = classShareForDistrict(dk);
      for (const c of CLASSES) {
        const p = Math.max(1, Math.round(totalAlive * DIST_SHARE[dk] * shares[c]));
        rows.push({
          d: dk, c: c, pop: p,
          wallet: p * CLASS_MEAN[c],
          employedFrac: EMPLOYED_FRAC[c],
          propensities: Object.assign({}, PROPENSITIES),
        });
      }
    }
    return rows;
  }
  function reset() {
    const rows = seedRows();
    const initByDist = {};
    for (const dk of DISTRICT_KEYS) initByDist[dk] = 0;
    let initTotal = 0;
    for (const row of rows) { initTotal += row.wallet; initByDist[row.d] += row.wallet; }
    g.npcEcon = { rows: rows, entPool: 0, initTotal: initTotal, initByDist: initByDist, hrAcc: 0 };
  }
  function ensureInit() { if (!g.npcEcon || !g.npcEcon.rows) reset(); }
  function rowFor(dk, cls) {
    ensureInit();
    const rows = g.npcEcon.rows;
    for (let i = 0; i < rows.length; i++) if (rows[i].d === dk && rows[i].c === cls) return rows[i];
    return null;
  }

  // ---- reads ----------------------------------------------------------------
  // drawCash(district, wealth, r) -> spawn cash for an ORDINARY resident,
  // drawn from their district+class cohort's mean wallet (± jitter, clamped)
  // instead of pure RNG — the money-printer close. Returns null (caller falls
  // back to its own roll) if the district/class/row can't be resolved.
  function drawCash(dk, wealth, r) {
    const row = rowFor(dk, classFor(wealth));
    if (!row || row.pop <= 0) return null;
    const mean = row.wallet / row.pop;
    const rr = (typeof r === "function") ? r() : Math.random();
    const jitter = 0.6 + rr * 0.8;                    // ±40% around the cohort mean
    const cash = Math.min(mean * 6, mean * jitter);   // soft ceiling: a drained cohort can't spawn a fluke whale
    return Math.max(2, Math.round(cash));
  }
  // debit(district, class, amount) -> a ped from this cohort just got robbed
  // or looted for `amount`: the SAME dollars leave the cohort's aggregate
  // wallet. Floors at 0 (never goes negative), silently no-ops on an unknown
  // district/class (guarded — callers never need to pre-validate).
  function debit(dk, cls, amount) {
    if (!(amount > 0)) return;
    const row = rowFor(dk, cls);
    if (!row) return;
    row.wallet = Math.max(0, row.wallet - amount);
  }
  // vacancyRate(district) -> 0..0.35, how likely an owned unit in this
  // district sits empty next zillow income cycle. Reads how far this
  // district's cohort wallets have fallen from their seeded baseline —
  // strip-mine a district and its buildings start going vacant for real.
  function vacancyRate(dk) {
    ensureInit();
    const M = g.npcEcon;
    const init = M.initByDist[dk];
    if (!(init > 0)) return 0;
    let cur = 0;
    for (const row of M.rows) if (row.d === dk) cur += row.wallet;
    const health = clampNum(0.2, 1.5, cur / init);
    return clampNum(0, 0.35, (1 - health) * 0.4);
  }
  // walletHealth() -> CITY-WIDE aggregate wallet / seeded initial total,
  // clamped 0.5..1.5. Consumed by sim/econstate.js's daily wagesProxy (a
  // drained city pays worse; a flush one pays better) — see that file's
  // 2-line guarded edit, day-one neutral (health starts at exactly 1.0).
  function walletHealth() {
    ensureInit();
    const M = g.npcEcon;
    if (!(M.initTotal > 0)) return 1.0;
    let cur = 0;
    for (const row of M.rows) cur += row.wallet;
    return clampNum(0.5, 1.5, cur / M.initTotal);
  }
  function entPool() { ensureInit(); return g.npcEcon.entPool || 0; }
  // drainEntPool(amount) -> E7: sim/corporations.js's Royale Casino Corp is
  // the first real consumer of this pool (a slice drained each hour,
  // proportional to its citywide casino-outlet share). Floors at 0, silently
  // no-ops on a bad amount — the pool simply keeps banking otherwise (E9's
  // eventual real house-take/whale-action module can drain it further).
  function drainEntPool(amount) {
    ensureInit();
    if (!(amount > 0)) return 0;
    const before = g.npcEcon.entPool || 0;
    const took = Math.min(before, amount);
    g.npcEcon.entPool = before - took;
    return took;
  }
  // summary() -> a COPY of the 20 rows (diagnostics / a future phone app;
  // callers can't mutate the live state through it).
  function summary() {
    ensureInit();
    return g.npcEcon.rows.map(function (r) {
      return { d: r.d, c: r.c, pop: r.pop, wallet: Math.round(r.wallet), employedFrac: r.employedFrac };
    });
  }

  // ---- the hourly pass: income in, food/goods/ent spend out ----------------
  function hourTick() {
    ensureInit();
    const M = g.npcEcon;
    const activity = (CBZ.econState && typeof CBZ.econState.activity === "function") ? CBZ.econState.activity() : 1.0;
    const est = (CBZ.econState && CBZ.econState.get) ? CBZ.econState.get() : null;
    const priceAdj = clampNum(0.85, 1.15, (est && est.priceIndex != null) ? est.priceIndex : 1.0);
    // E5/E7 seam: this hour's per-district spend across every widened
    // category, for sim/corporations.js's outletRevenue (Bunbros/Ironclad/
    // Meridian/Apex all read this instead of duplicating this income/
    // propensity math). Ephemeral like market.js's hist rings — rebuilt
    // every pass, never serialized.
    const spend = {};
    for (const dk of DISTRICT_KEYS) spend[dk] = { food: 0, goods: 0, fuel: 0, luxury: 0, guns: 0 };
    for (const row of M.rows) {
      const income = row.pop * row.employedFrac * CLASS_WAGE[row.c] * activity * priceAdj;
      row.wallet += income;
      const p = row.propensities;
      const foodSpend = income * p.food, goodsSpend = income * p.goods, entSpend = income * p.ent;
      const fuelSpend = income * (p.fuel || 0), luxurySpend = income * (p.luxury || 0), gunsSpend = income * (p.guns || 0);
      // rent (p.rent) + save (p.save) intentionally stay banked in the
      // wallet this wave — see the file header's PERSISTENCE/rent note.
      row.wallet = Math.max(0, row.wallet - (foodSpend + goodsSpend + entSpend + fuelSpend + luxurySpend + gunsSpend));
      M.entPool = (M.entPool || 0) + entSpend;
      spend[row.d].food += foodSpend;
      spend[row.d].goods += goodsSpend;
      spend[row.d].fuel += fuelSpend;
      spend[row.d].luxury += luxurySpend;
      spend[row.d].guns += gunsSpend;
      if (CBZ.market && CBZ.market.recordBuy) {
        if (foodSpend > 0) CBZ.market.recordBuy("food", foodSpend / DOLLARS_PER_UNIT);
        if (goodsSpend > 0) CBZ.market.recordBuy("goods", goodsSpend / DOLLARS_PER_UNIT);
        if (fuelSpend > 0) CBZ.market.recordBuy("fuel", fuelSpend / DOLLARS_PER_UNIT);
        if (luxurySpend > 0) CBZ.market.recordBuy("luxury", luxurySpend / DOLLARS_PER_UNIT);
        if (gunsSpend > 0) CBZ.market.recordBuy("guns", gunsSpend / DOLLARS_PER_UNIT);
      }
    }
    CBZ.npcEcon.lastSpend = spend;
  }
  // VI.4: "one trivial pass per game hour" — order 29.6, right after
  // econstate.js's 29.55 so this hour's freshly-settled activity/priceIndex
  // are what income reads (same "settle before anything reads it" contract
  // market.js/econstate.js already established at 29.5/29.55).
  CBZ.onUpdate(29.6, function (dt) {
    if (g.mode !== "city") return;
    ensureInit();
    const M = g.npcEcon;
    M.hrAcc = (M.hrAcc || 0) + dt;
    while (M.hrAcc >= HOUR) { M.hrAcc -= HOUR; hourTick(); }
  });

  // ---- persistence ------------------------------------------------------
  function serialize() {
    ensureInit();
    const M = g.npcEcon;
    return {
      v: 1,
      rows: M.rows.map(function (r) { return { d: r.d, c: r.c, pop: r.pop, wallet: r.wallet, employedFrac: r.employedFrac }; }),
      entPool: M.entPool || 0,
      initTotal: M.initTotal || 0,
      initByDist: Object.assign({}, M.initByDist),
      hrAcc: M.hrAcc || 0,
    };
  }
  function apply(obj) {
    if (!obj || obj.v !== 1) return;
    reset();
    const M = g.npcEcon;
    if (Array.isArray(obj.rows)) for (const src of obj.rows) {
      if (!src) continue;
      const row = rowFor(src.d, src.c);
      if (!row) continue;
      if (isFinite(src.pop)) row.pop = Math.max(0, Math.round(+src.pop));
      if (isFinite(src.wallet)) row.wallet = Math.max(0, +src.wallet);
      if (isFinite(src.employedFrac)) row.employedFrac = clampNum(0, 1, +src.employedFrac);
    }
    if (isFinite(obj.entPool)) M.entPool = Math.max(0, +obj.entPool);
    if (isFinite(obj.initTotal) && obj.initTotal > 0) M.initTotal = +obj.initTotal;
    if (obj.initByDist) for (const dk of DISTRICT_KEYS) if (isFinite(obj.initByDist[dk])) M.initByDist[dk] = +obj.initByDist[dk];
    M.hrAcc = obj.hrAcc || 0;
  }

  CBZ.npcEcon = {
    DISTRICT_KEYS: DISTRICT_KEYS.slice(),
    CLASSES: CLASSES.slice(),
    classFor: classFor,
    drawCash: drawCash,
    debit: debit,
    vacancyRate: vacancyRate,
    walletHealth: walletHealth,
    entPool: entPool,
    drainEntPool: drainEntPool,
    summary: summary,
    serialize: serialize,
    apply: apply,
    reset: reset,
  };

  // ============================================================
  //  SINGLE-PLAYER PERSIST — market.js/econstate.js's g.cityWorld pattern,
  //  verbatim: stamp the live rows onto g.cityWorld right before the existing
  //  commit/collect save hooks run, hydrate back out whenever that ledger
  //  object's REFERENCE changes. Own idempotence flag (_npceWrap).
  // ------------------------------------------------------------
  function stampNpce() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.npce = serialize();
  }
  function ensureNpceSaveWraps() {
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._npceWrap) {
      const w = function () { stampNpce(); return commit.apply(this, arguments); };
      w._npceWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._npceWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampNpce(); return col.apply(this, arguments); };
      wc._npceWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.npce) apply(led.npce);
  }
  if (CBZ.onUpdate) {
    // next free slot after econstate.js's 45.96 — same install-tick family.
    CBZ.onUpdate(45.97, function () {
      if (!g) return;
      ensureNpceSaveWraps();
      hydrateFromLedger();
    });
  }
})();
