/* ============================================================
   sim/corporations.js — Stage E, step E5: THE FIRST REAL CORPORATION.

   MASTER-PLAN VI.6 (verbatim, the piece this file lands): "a curated roster
   of 8 launch corporations (new src/sim/corporations.js) each owns real
   outlets in real buildings across the mainland + mini-cities and books
   revenue from actual simulated sales: each hour, outletRevenue =
   cohortSpend(district, good) × outletShareOfCityDemand, minus wages (paid
   into NPC/cohort wallets), rent, inputs, and debt service... Bunbros fast
   food (the owner's example — outlets in every city, sells food)."
   Phasing (VI.6): "(1) Bunbros alone with real revenue + read-only ticker
   → (2) exchange building + trading for one stock → ..." THIS FILE is (1).
   E6 adds the exchange/buy-sell/price formation; E7 adds the other 7
   companies (Royale Casino Corp, Ironclad Arms, Granite & Sons, Meridian
   Fuel, Zenith Media, Goldspire Trust REIT, Apex Dealership Holdings) —
   `g.corps.list` is already keyed by id so they're additive rows later,
   not a reshape.

   NOT city/companies.js: that file's decorative holdco roster (NPC firms
   trading real estate for city-feed flavor, Math.random-driven, never
   serialized) stays untouched — VI.6 says it "becomes background
   landlords" later (a future wave teaches it to sit ABOVE a corporation's
   outlets as their landlord, rent flowing corp → holdco). Two separate
   systems on purpose: companies.js is decoration, this file is the real
   economy's producer/consumer.

   OUTLETS: at city build, Bunbros claims CLAIM_FRAC (~60%) of the city's
   food-kind shop lots (arena.shopLots, kind==="food") as its own outlets;
   the rest stay independent mom-and-pop diners with no revenue tie-in here
   (no downside for them either — they're simply outside this system, same
   as every other shop kind). The claim is a SEEDED LCG shuffle (this file's
   own stream — never Math.random, per repo convention for world state) of
   the food-lot pool, so build() is IDEMPOTENT: the same arena always yields
   the same outlet set. That means outlets are cheap to RE-DERIVE instead of
   serialized — see the persistence note below.

   REVENUE: sim/npcecon.js's hourly cohort pass now stamps CBZ.npcEcon.
   lastSpend = { district: {food, goods} } every hour (this wave's 4-line
   edit to that file — the exact dollars 20 cohorts just spent on food this
   hour, per district). Bunbros's own hourly tick (29.65, right after
   npcecon's 29.6 so it reads THIS hour's fresh snapshot) reads it:
     outletRevenue(district) = lastSpend[district].food × outletShare(district)
   outletShare(district) = Bunbros outlets in that district ÷ total food lots
   in that district, computed ONCE at build() (not re-derived hourly — a
   burned-down outlet is a future wave's problem, see VI.6's "an outlet
   destroyed" event). Total revenue sums outletShare × food-spend over every
   DISTINCT district Bunbros has a presence in (a district with N outlets
   isn't counted N times — outletShare already captures N via the numerator).

   COSTS (hourly, scale with the outlet count):
     wages  = outlets × 3 workers × $8/hr × priceIndex   (entry-level fast
              food wage, inflated by sim/econstate.js's live CPI so a hot
              economy costs Bunbros more to staff, same as everyone else)
     rent   = outlets × $40/hr                            (flat toy landlord fee)
     inputs = 0.35 × revenue, ROUTED as real food demand: CBZ.market.
              recordBuy("food", inputs/20) — the supply chain closes here:
              Bunbros buying groceries nudges the SAME citywide food price
              sim/market.js already prices for the player and the cohorts,
              exactly like npcecon.js's own $/DOLLARS_PER_UNIT demand-signal
              conversion (a different toy divisor, documented, since this is
              a wholesale/bulk buy, not a retail cohort purchase).
     earnings = revenue − (wages + rent + inputs); accrues straight into
     co.cash every hour, plus a rolling revenueTTM/costsTTM trail (48 hourly
     samples, same ring length as market.js's sparkline history — E6's stock
     pricing will want a trailing window) and a 28-DAY earningsHistory roll
     (one net-earnings sample per in-game day, capped at 28 — a "quarter" of
     city-days) for the ticker/phone touchpoints below.

   BANKRUPTCY: cash <= 0 reverts every outlet to an independent (drops the
   _bunCo tag, empties co.outlets) and fires a city-feed line. MOSTLY
   THEORETICAL at this wave's tuning — $50k starting cash against a modest
   handful of outlets earning positive margins in practice; the guard exists
   so a determined robbery spree (see ROBBERY below) has a real floor to hit,
   not because the model is expected to bust on its own. No auto-reopen this
   wave (a future wave could re-float the company after a cooldown).

   ROBBERY: city/shops.js's robTill() is the store-robbery stick-up (cityCrime
   type "store robbery"). A single guarded line there calls CBZ.corps.
   robOutlet(openLot, take) — if openLot is tagged as a Bunbros outlet
   (lot._bunCo), the SAME dollars the player just took off the till also
   come off the company's books. Rob the burger chain, hurt the balance
   sheet; E6 wires that into the stock price.

   PLAYER TOUCHPOINTS (read-only this wave — E6 adds buy/sell):
     - city/props.js's adboard MARKET TICKER creative occasionally swaps its
       CPI line for "BUN earnings $X ▲/▼" (this file's tickerLine()).
     - city/phone.js's MARKETS app gains a BUN row (name, daily earnings,
       cash-trend arrow) via this file's summary().

   PERSISTENCE: same two-rider pattern as market.js/econstate.js/npcecon.js —
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() pick up
       serialize()/apply() beside blob.npce (blob.corp).
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own guard
       flag _corpWrap) so g.cityWorld.corp rides the localStorage ledger.
   Fresh-run reset: city/peds.js's spawnCityPeds() resets market/econState/
   npcEcon right after buildCity(); this file's CBZ.corps.reset() call sits
   right beside them (outlets themselves are picked up again by the next
   41.75 build tick against the fresh arena — see OUTLETS above, only the
   FINANCIAL state — cash, TTM trails, earnings history — round-trips
   through serialize()/apply(); the outlet-lot set is deterministically
   re-derived, never serialized).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const BUNBROS_ID = "bunbros";

  // ---- tuning (VI.6 constants, all in one place) -------------------------
  const HOUR = 150 / 24;          // seconds per in-game hour — matches market.js/econstate.js/npcecon.js
  const CLAIM_FRAC = 0.6;         // ~60% of the city's food lots become Bunbros outlets
  const WORKERS_PER_OUTLET = 3;
  const OUTLET_WAGE = 8;          // $/hr per worker, entry-level fast-food baseline (priceIndex-adjusted)
  const RENT_PER_OUTLET = 40;     // $/hr flat toy landlord fee per outlet
  const INPUT_FRAC = 0.35;        // share of revenue spent on food inputs (the supply-chain link)
  const INPUT_DOLLARS_PER_UNIT = 20; // $ of inputs -> a market.js recordBuy "quantity" (bulk-buy divisor)
  const STARTING_CASH = 50000;
  const SHARES_OUTSTANDING = 1000000;
  const HIST_CAP = 48;             // revenueTTM/costsTTM ring length (matches market.js's sparkline rings)
  const DAILY_CAP = 28;            // earningsHistory: 28 daily net-earnings samples ("a quarter of city-days")

  // own seeded LCG (never Math.random — repo convention for world state), a
  // distinct seed from market.js/economy.js's own streams so the three don't
  // accidentally correlate. Reset alongside reset() so build() is IDEMPOTENT:
  // the same arena always claims the same outlet set without ever needing to
  // serialize which lots were picked (see the file header's PERSISTENCE note).
  const INITIAL_SEED = 314159265 & 0x7fffffff;
  let _seed = INITIAL_SEED;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // ---- state lives on g.corps (mirrors g.cityMarket / g.npcEcon) ----------
  function freshCompany() {
    return {
      id: BUNBROS_ID, name: "Bunbros", sector: "food", tickerSym: "BUN",
      outlets: [],            // [{lot, district}]
      shareByDistrict: {},    // district -> outlets-here / total-food-lots-here, computed once at build()
      cash: STARTING_CASH,
      revenueTTM: [], costsTTM: [],   // trailing hourly samples, capped at HIST_CAP (E6 stock-pricing input)
      revAcc: 0, costAcc: 0,          // today's running hourly totals, rolled into earningsHistory at the day boundary
      earningsHistory: [],            // up to DAILY_CAP daily net-earnings samples
      sharesOutstanding: SHARES_OUTSTANDING,
      lastPrice: null,        // E6: exchange/trading wires a real share price here
      founderSid: null,       // E8: billionaire-shareholder persistence wires an owner NPC here
      cashDayStart: STARTING_CASH, cashTrend: "flat",  // day-over-day cash direction (phone/ticker arrow)
      bankrupt: false,
      dayHrAcc: 0,
      _builtForArena: null,   // the arena object outlets were last claimed against (rebuild gate)
    };
  }
  function reset() {
    _seed = INITIAL_SEED;
    g.corps = { list: {}, hrAcc: 0 };
    g.corps.list[BUNBROS_ID] = freshCompany();
  }
  function ensureInit() { if (!g.corps || !g.corps.list) reset(); }

  // ---- OUTLETS: claim ~60% of the city's food lots at build -------------
  function districtOf(lot) {
    const cx = (lot && lot.cx) || 0, cz = (lot && lot.cz) || 0;
    return (CBZ.cityEcon && CBZ.cityEcon.districtAt) ? CBZ.cityEcon.districtAt(cx, cz) : "downtown";
  }
  function buildBunbros(arena) {
    ensureInit();
    const co = g.corps.list[BUNBROS_ID];
    if (co.bankrupt) return false;    // stays bankrupt this wave — no auto-reopen (see file header)
    const all = (arena.shopLots || arena.lots || []).filter(function (l) {
      return l && l.building && l.building.shop && l.building.shop.kind === "food";
    });
    if (!all.length) return false;    // no food lots this arena yet — build tick retries with a cooldown

    const districtTotal = {};
    for (const l of all) { const dk = districtOf(l); districtTotal[dk] = (districtTotal[dk] || 0) + 1; }

    // seeded LCG Fisher-Yates — SAME arena always yields the SAME claimed set.
    const pool = all.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const nClaim = Math.max(1, Math.round(pool.length * CLAIM_FRAC));
    const districtOutlets = {};
    co.outlets = [];
    for (let i = 0; i < nClaim; i++) {
      const lot = pool[i], dk = districtOf(lot);
      lot._bunCo = BUNBROS_ID;   // robbery lookup (city/shops.js) + future citystaff/citation tagging
      co.outlets.push({ lot: lot, district: dk });
      districtOutlets[dk] = (districtOutlets[dk] || 0) + 1;
    }
    // pool[nClaim..] stay independent mom-and-pop diners — no company, no
    // revenue tie-in, no downside either; simply outside this system.
    co.shareByDistrict = {};
    for (const dk in districtTotal) co.shareByDistrict[dk] = (districtOutlets[dk] || 0) / districtTotal[dk];
    co._builtForArena = arena;
    return true;
  }
  let buildCool = 0;
  CBZ.onUpdate(41.75, function (dt) {
    // slotted between city/companies.js's 41.7 (decorative holdco build/move)
    // and city/citystaff.js's 41.8 (visible queues/staff) — same lazy-build,
    // self-healing family: wait for the arena, retry with a small backoff.
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena) return;
    ensureInit();
    const co = g.corps.list[BUNBROS_ID];
    if (co._builtForArena === arena) return;
    buildCool -= dt;
    if (buildCool > 0) return;
    buildCool = 1.0;
    try { buildBunbros(arena); } catch (e) {}
  });

  // ---- bankruptcy: outlets revert to independents ------------------------
  function bankrupt(co) {
    if (co.bankrupt) return;
    co.bankrupt = true;
    for (const o of co.outlets) { if (o.lot) delete o.lot._bunCo; }
    co.outlets = [];
    co.shareByDistrict = {};
    if (CBZ.cityFeed) CBZ.cityFeed("💥 " + co.name + " has gone BANKRUPT — outlets revert to independents", "#ff9a6b");
  }

  // ---- REVENUE + COSTS: the hourly earnings pass -------------------------
  function hourlyEarn() {
    ensureInit();
    const co = g.corps.list[BUNBROS_ID];
    if (!co.outlets.length || co.bankrupt) return;

    const est = (CBZ.econState && CBZ.econState.get) ? CBZ.econState.get() : null;
    const priceAdj = (est && est.priceIndex != null) ? est.priceIndex : 1.0;
    const spend = (CBZ.npcEcon && CBZ.npcEcon.lastSpend) || {};

    // revenue: outletShare(district) x this hour's cohort food spend there,
    // summed over every DISTINCT district Bunbros has a presence in (a
    // district with N outlets isn't double-counted — the share already
    // reflects N via its numerator).
    let revenue = 0;
    const seenD = {};
    for (const o of co.outlets) {
      if (seenD[o.district]) continue;
      seenD[o.district] = 1;
      const foodSpend = (spend[o.district] && spend[o.district].food) || 0;
      revenue += foodSpend * (co.shareByDistrict[o.district] || 0);
    }

    const n = co.outlets.length;
    const wages = n * WORKERS_PER_OUTLET * OUTLET_WAGE * priceAdj;
    const rent = n * RENT_PER_OUTLET;
    const inputs = INPUT_FRAC * revenue;
    const costs = wages + rent + inputs;
    const earnings = revenue - costs;

    co.cash += earnings;
    co.revAcc = (co.revAcc || 0) + revenue;
    co.costAcc = (co.costAcc || 0) + costs;

    co.revenueTTM.push(revenue); if (co.revenueTTM.length > HIST_CAP) co.revenueTTM.shift();
    co.costsTTM.push(costs); if (co.costsTTM.length > HIST_CAP) co.costsTTM.shift();

    // the supply chain: inputs are a real food-category purchase, same faucet
    // npcecon.js's own cohort spend already feeds (a different divisor: this
    // is a wholesale/bulk buy, not a retail cohort purchase).
    if (inputs > 0 && CBZ.market && CBZ.market.recordBuy) CBZ.market.recordBuy("food", inputs / INPUT_DOLLARS_PER_UNIT);

    co.dayHrAcc = (co.dayHrAcc || 0) + 1;
    if (co.dayHrAcc >= 24) {
      co.dayHrAcc -= 24;
      const net = Math.round(co.revAcc - co.costAcc);
      co.earningsHistory.push(net);
      if (co.earningsHistory.length > DAILY_CAP) co.earningsHistory.shift();
      co.revAcc = 0; co.costAcc = 0;
      co.cashTrend = co.cash >= co.cashDayStart ? "up" : "down";
      co.cashDayStart = co.cash;
    }

    if (co.cash <= 0 && !co.bankrupt) bankrupt(co);
  }
  // VI.6's hourly earnings pass — order 29.65, right after sim/npcecon.js's
  // 29.6 so this hour's freshly-stamped lastSpend snapshot is what revenue reads.
  CBZ.onUpdate(29.65, function (dt) {
    if (g.mode !== "city") return;
    ensureInit();
    const C = g.corps;
    C.hrAcc = (C.hrAcc || 0) + dt;
    while (C.hrAcc >= HOUR) { C.hrAcc -= HOUR; hourlyEarn(); }
  });

  // ---- reads ---------------------------------------------------------------
  // robOutlet(lot, amount) -> true if `lot` is a live Bunbros outlet: debits
  // the company's cash by `amount` (city/shops.js's robTill() calls this the
  // instant a till robbery lands — the same dollars leave the company's books).
  function robOutlet(lot, amount) {
    if (!(lot && lot._bunCo) || !(amount > 0)) return false;
    ensureInit();
    const co = g.corps.list[lot._bunCo];
    if (!co) return false;
    co.cash -= amount;
    if (co.cash <= 0 && !co.bankrupt) bankrupt(co);
    return true;
  }
  // summary() -> the phone MARKETS app's BUN row data (null once outlets == 0,
  // i.e. not built yet or bankrupted out — callers render "no data" instead).
  function summary() {
    ensureInit();
    const co = g.corps.list[BUNBROS_ID];
    if (!co.outlets.length) return null;
    const h = co.earningsHistory;
    const daily = h.length ? h[h.length - 1] : Math.round(co.revAcc - co.costAcc);
    return {
      id: co.id, name: co.name, tickerSym: co.tickerSym,
      outlets: co.outlets.length, cash: Math.round(co.cash),
      dailyEarnings: daily, cashTrend: co.cashTrend || "flat", bankrupt: !!co.bankrupt,
    };
  }
  // tickerLine() -> "BUN earnings $1,240 ▲" — the adboard ticker's occasional
  // corp line (city/props.js's tickerAd() folds this in place of the CPI
  // line on a rotation). "" once outlets == 0 (props.js falls back to CPI).
  function tickerLine() {
    const s = summary();
    if (!s) return "";
    const arrow = s.cashTrend === "up" ? "▲" : (s.cashTrend === "down" ? "▼" : "–");
    return s.tickerSym + " earnings " + (s.dailyEarnings >= 0 ? "$" : "-$") + Math.abs(Math.round(s.dailyEarnings)).toLocaleString() + " " + arrow;
  }

  // ---- persistence ------------------------------------------------------
  // NOTE: outlets/shareByDistrict are deliberately NOT serialized — see the
  // file header's PERSISTENCE note: build() is idempotent (seeded LCG reset
  // alongside reset()), so the next 41.75 tick re-derives the identical
  // outlet set from the (already-built, unchanged) arena. Only the FINANCIAL
  // state round-trips.
  function serialize() {
    ensureInit();
    const co = g.corps.list[BUNBROS_ID];
    return {
      v: 1,
      cash: co.cash,
      revenueTTM: co.revenueTTM.slice(), costsTTM: co.costsTTM.slice(),
      earningsHistory: co.earningsHistory.slice(),
      revAcc: co.revAcc || 0, costAcc: co.costAcc || 0,
      hrAcc: g.corps.hrAcc || 0, dayHrAcc: co.dayHrAcc || 0,
      cashDayStart: co.cashDayStart, cashTrend: co.cashTrend || "flat",
      bankrupt: !!co.bankrupt,
    };
  }
  function apply(obj) {
    if (!obj || obj.v !== 1) return;
    reset();
    const co = g.corps.list[BUNBROS_ID];
    if (isFinite(obj.cash)) co.cash = +obj.cash;
    if (Array.isArray(obj.revenueTTM)) co.revenueTTM = obj.revenueTTM.slice(-HIST_CAP);
    if (Array.isArray(obj.costsTTM)) co.costsTTM = obj.costsTTM.slice(-HIST_CAP);
    if (Array.isArray(obj.earningsHistory)) co.earningsHistory = obj.earningsHistory.slice(-DAILY_CAP);
    if (isFinite(obj.revAcc)) co.revAcc = +obj.revAcc;
    if (isFinite(obj.costAcc)) co.costAcc = +obj.costAcc;
    g.corps.hrAcc = obj.hrAcc || 0;
    co.dayHrAcc = obj.dayHrAcc || 0;
    if (isFinite(obj.cashDayStart)) co.cashDayStart = +obj.cashDayStart;
    if (obj.cashTrend) co.cashTrend = obj.cashTrend;
    co.bankrupt = !!obj.bankrupt;
  }

  CBZ.corps = {
    BUNBROS_ID: BUNBROS_ID,
    get: function (id) { ensureInit(); return g.corps.list[id || BUNBROS_ID] || null; },
    list: function () { ensureInit(); const out = []; for (const id in g.corps.list) out.push(g.corps.list[id]); return out; },
    summary: summary,
    tickerLine: tickerLine,
    isOutlet: function (lot) { return !!(lot && lot._bunCo); },
    companyOfLot: function (lot) { ensureInit(); const id = lot && lot._bunCo; return id ? g.corps.list[id] : null; },
    robOutlet: robOutlet,
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
  function ensureCorpSaveWraps() {
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
