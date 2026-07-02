/* ============================================================
   sim/econstate.js — Stage E, step E2: the per-jurisdiction EconState.

   MASTER-PLAN VI.2: "Per city (state/country aggregate up — same shape as
   Part V's jurisdictions): {activity, employment, priceIndex, taxRate,
   treasury, ..., goods: {...}}. Hourly tick (order 29.5, before the 30.x
   money ticks) ... Daily settlement: activity ← lerp(activity,
   wagesPaid/expected · employment · safety, 0.15); treasury += taxRate·
   (wages+revenue) − police − reconstruction. Starting values are today's
   equilibrium — day one changes nothing observable."

   THIS WAVE: one jurisdiction ("libertyville", the whole city) — the
   registry is keyed by id so Part V's polity system can shard this by
   city/country later without touching this file's shape (grep g.cityEconState
   then). `goods` is INTENTIONALLY not duplicated here: sim/market.js already
   owns the six non-drug category price levels (p, mean-reverting, seeded
   noise, demand signals) and city/economy.js's district engine owns drugs
   (g.cityDrugDist). This module READS both to compute priceIndex and never
   writes a price itself — market.js stays the sole price authority.

   EQUATIONS AS SHIPPED (constants inline, no magic numbers elsewhere):
     priceIndex = Σ w_G·p_G                              (hourly)
       weights: food .30 goods .25 fuel .15 materials .10 luxury .10
                guns .05 drugs .05  (sums to 1.00 — see e2harness)
       p_food..p_guns read CBZ.market.price(cat); p_drugs is the CITY-WIDE
       average of every g.cityDrugDist[district][drug] level (the district
       drug engine's own s/d-driven number — same "1.0 = fair" baseline as
       market.js's categories, just averaged up instead of per-good).

     DAILY (every 24 accumulated hours):
       wagesProxy  = 1.0 + (confidence − 70) / 100        // confidence ∈ [0,100]
       safety      = clamp(0.6, 1.1, 1 − 0.05·min(1, heat/600) + 0.02)
       employment  = clamp(0.05, 0.98, 0.92 · alive/total) // see below
       activity    ← lerp(activity, wagesProxy·employment·safety, 0.15)
       treasury    += taxRate·(activity·1000) − 200        // toy fiscal flow

   SOURCES CONSUMED (VI.1's "write-only, free depth" list):
     - w.economy.confidence (city/worldstate.js:69, written by war/disaster/
       recovery ticks, never read before this) drives wagesProxy. Its resting
       value is 100 (fresh() default), so wagesProxy rests at 1.3 absent any
       bad event — a deliberate toy calibration this wave (M-stage rebalances
       once confidence's own resting point is redesigned around 70).
     - g.heat (city/wanted.js, thresholds in config.js:244 starHeat =
       [0,300,650,1100,3200,12000], i.e. 1-5 stars) drives safety. 600 is a
       sensible normalizer: just past 2-star heat (650) already reads as
       "as unsafe as it gets" for this equation's purposes.
     - CBZ.cityPopulation() (city/peds.js:171, {alive,total,dead}) drives
       employment via alive/total. THE BEAUTIFUL CONSEQUENCE: this finite,
       non-regenerating headcount only ever goes down as the player kills
       people — so employment (and via activity, prices) visibly erode the
       more of the city you murder. Rack up enough bodies and you tank the
       job market you're shopping in.

   MARKET FEEDBACK: market.js's hourly mean-reversion used to pull every
   category price back toward a flat 1.0. It now reverts toward THIS state's
   `activity` instead (a booming city has structurally higher prices) — see
   the 3-line change in market.js's hourTick, guarded so day one (activity
   starts at 1.0) is byte-identical to before this file existed.

   SHOP PRICING: city/economy.js's buyPrice/sellPrice dropped the food-only
   gate from E1 — every non-drug tag now multiplies through CBZ.market.
   itemPrice()'s category map (guns, materials, fuel, luxury, goods all track
   their live category price at the register now, same as food already did).

   PERSISTENCE: same two-rider pattern as market.js —
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() pick up
       serialize()/apply() beside blob.mkt (blob.econ).
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own guard
       flag _econWrap) so g.cityWorld.econ rides the localStorage ledger.
   Fresh-run reset: city/peds.js's spawnCityPeds() resets market.js right
   beside cityEcon.initMarket(); this file's CBZ.econState.reset() call sits
   right next to that.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const DEFAULT_ID = "libertyville";

  // ---- tuning (VI.2 constants, all in one place) -------------------------
  const HOUR = 150 / 24;        // seconds per in-game hour — matches market.js exactly
  const EMPLOYMENT_BASE = 0.92; // day-one equilibrium employment rate
  const SETTLE_LERP = 0.15;     // daily activity lerp factor toward the composed target
  const START_TAX_RATE = 0.10;
  const START_TREASURY = 25000;
  const TREASURY_TAX_UNIT = 1000; // toy fiscal flow: taxRate · (activity · this) this wave
  const TREASURY_UPKEEP = 200;    // flat daily upkeep spend, same toy flow
  const SAFETY_HEAT_NORM = 600;   // g.heat normalizer for the safety term (~just past 2-star)
  const HIST_CAP = 48;            // E3: sparkline ring length (48 hourly samples, matches market.js)
  const PI_TREND_EPS = 0.015;     // ±1.5% vs the last day-boundary snapshot = "flat" (market.js's TREND_EPS)

  // priceIndex weights — VI.2's category set, sums to 1.00 (see e2harness).
  const PI_WEIGHTS = {
    food: 0.30, goods: 0.25, fuel: 0.15,
    materials: 0.10, luxury: 0.10, guns: 0.05, drugs: 0.05,
  };

  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

  // ---- state lives on g.cityEconState (mirrors g.cityMarket) --------------
  function freshJur() {
    return {
      activity: 1.0,
      employment: EMPLOYMENT_BASE,
      priceIndex: 1.0,
      piYest: 1.0,       // E3: priceIndex snapshotted at the last day boundary (trend() reference)
      taxRate: START_TAX_RATE,
      treasury: START_TREASURY,
    };
  }
  function freshHist() { return { priceIndex: [], activity: [] }; }
  function reset() {
    g.cityEconState = { reg: { [DEFAULT_ID]: freshJur() }, hist: { [DEFAULT_ID]: freshHist() }, hrAcc: 0, dayHrAcc: 0 };
  }
  function ensureInit() {
    if (!g.cityEconState) { reset(); return; }
    if (!g.cityEconState.hist) g.cityEconState.hist = {};
  }
  // E3: push one hourly sample into id's {priceIndex, activity} rings, capped
  // at HIST_CAP. Lazily creates the id's ring set (covers ids registered after
  // reset(), e.g. via apply()).
  function pushHist(m, id, field, v) {
    if (!m.hist[id]) m.hist[id] = freshHist();
    const arr = m.hist[id][field] || (m.hist[id][field] = []);
    arr.push(v);
    if (arr.length > HIST_CAP) arr.shift();
  }

  // ---- reads ---------------------------------------------------------------
  function get(id) {
    ensureInit();
    return g.cityEconState.reg[id || DEFAULT_ID] || null;
  }
  // activity(id) -> live activity number, 1.0 fallback (used by market.js's
  // feedback hook so it stays safe if this file somehow isn't loaded).
  function activity(id) {
    const st = get(id);
    return st ? st.activity : 1.0;
  }
  function summary(id) {
    const st = get(id);
    if (!st) return null;
    return {
      id: id || DEFAULT_ID,
      activity: Math.round(st.activity * 100) / 100,
      employment: Math.round(st.employment * 100) / 100,
      priceIndex: Math.round(st.priceIndex * 1000) / 1000,
      taxRate: st.taxRate,
      treasury: Math.round(st.treasury),
    };
  }
  // ---- E3 LEGIBILITY: priceIndex trend + sparkline history for the adboard
  // ticker and the phone Markets app. Pure data (no DOM/canvas) — node-harness
  // testable. trend() mirrors market.js's trend(cat): vs the value snapshotted
  // at the last day boundary (piYest), ±1.5% reads "flat".
  function trend(id) {
    const st = get(id);
    if (!st) return "flat";
    const y = st.piYest != null ? st.piYest : 1.0;
    if (y <= 0) return "flat";
    const delta = (st.priceIndex - y) / y;
    if (delta > PI_TREND_EPS) return "up";
    if (delta < -PI_TREND_EPS) return "down";
    return "flat";
  }
  // history(field, id) -> up to the last 48 hourly samples (oldest first) of
  // "priceIndex" or "activity", a COPY so callers can't mutate the live ring.
  function history(field, id) {
    ensureInit();
    const h = g.cityEconState.hist[id || DEFAULT_ID];
    const arr = h && h[field];
    return arr ? arr.slice() : [];
  }
  // tickerLine(id) -> "CPI 1.06 ▲" — the adboard ticker's third line.
  function tickerLine(id) {
    const st = get(id);
    if (!st) return "";
    const arrow = trend(id) === "up" ? "▲" : trend(id) === "down" ? "▼" : "–";
    return "CPI " + st.priceIndex.toFixed(2) + " " + arrow;
  }

  // ---- priceIndex: Σ w_G·p_G (city-wide this wave; market.js is the one
  // authority for the six non-drug categories, the district drug engine for
  // drugs) -------------------------------------------------------------------
  function avgDrugLevel() {
    const dist = g.cityDrugDist;
    if (!dist) return 1.0;
    let sum = 0, n = 0;
    for (const dk in dist) {
      const lvl = dist[dk];
      for (const d in lvl) { sum += lvl[d]; n++; }
    }
    return n > 0 ? sum / n : 1.0;
  }
  function catPrice(cat) {
    return (CBZ.market && CBZ.market.price) ? CBZ.market.price(cat) : 1.0;
  }
  function computePriceIndex() {
    return PI_WEIGHTS.food * catPrice("food")
      + PI_WEIGHTS.goods * catPrice("goods")
      + PI_WEIGHTS.fuel * catPrice("fuel")
      + PI_WEIGHTS.materials * catPrice("materials")
      + PI_WEIGHTS.luxury * catPrice("luxury")
      + PI_WEIGHTS.guns * catPrice("guns")
      + PI_WEIGHTS.drugs * avgDrugLevel();
  }

  // ---- daily settlement: activity, employment, treasury --------------------
  function dailySettlement(st) {
    // wagesProxy: consumes w.economy.confidence — VI.1's write-only field,
    // written by war/disaster/recovery events and never read before this.
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    const confidence = (w && w.economy && w.economy.confidence != null) ? w.economy.confidence : 100;
    const wagesProxy = 1.0 + (confidence - 70) / 100;

    // safety: g.heat (config.js:244 starHeat thresholds) as a soft risk term.
    const heat = g.heat || 0;
    const safety = clampNum(0.6, 1.1, 1 - 0.05 * Math.min(1, heat / SAFETY_HEAT_NORM) + 0.02);

    // employment: the finite, non-regenerating city headcount (peds.js) —
    // unemployment rises as the player kills the city. A massacre is a
    // jobs report: fewer living residents behind the counter and on the
    // payroll shows up here as a falling employment rate, which then drags
    // activity (and via the market feedback hook, every shop price) down.
    const pop = CBZ.cityPopulation ? CBZ.cityPopulation() : null;
    const aliveFrac = (pop && pop.total > 0) ? pop.alive / pop.total : 1.0;
    st.employment = clampNum(0.05, 0.98, EMPLOYMENT_BASE * aliveFrac);

    const target = wagesProxy * st.employment * safety;
    st.activity = st.activity + (target - st.activity) * SETTLE_LERP;

    // toy fiscal flow this wave — legible, not real: no wages/revenue ledger
    // yet (that's E4's NPC circulation + E5's corporations). M-stage replaces
    // this with the real treasury equation from VI.2/VI.8.
    st.treasury += st.taxRate * (st.activity * TREASURY_TAX_UNIT) - TREASURY_UPKEEP;
  }

  // ---- the hourly tick: priceIndex every hour, settlement every 24 --------
  function hourTick(m) {
    const idx = computePriceIndex();
    for (const id in m.reg) {
      const st = m.reg[id];
      st.priceIndex = idx;
      // E3: one hourly sample into this jurisdiction's sparkline rings.
      pushHist(m, id, "priceIndex", idx);
      pushHist(m, id, "activity", st.activity);
    }
    m.dayHrAcc = (m.dayHrAcc || 0) + 1;
    if (m.dayHrAcc >= 24) {
      m.dayHrAcc -= 24;
      // snapshot BEFORE settlement so trend()'s "yesterday" reference is the
      // priceIndex that stood at the boundary, same shape as market.js's yest.
      for (const id in m.reg) m.reg[id].piYest = m.reg[id].priceIndex;
      for (const id in m.reg) dailySettlement(m.reg[id]);
    }
  }
  // VI.2: "order 29.5, before the 30.x money ticks" — piggybacks right after
  // market.js's own 29.5 tick with a separate accumulator matching its HOUR,
  // so priceIndex always reads THIS hour's freshly-settled category prices.
  CBZ.onUpdate(29.55, function (dt) {
    if (g.mode !== "city") return;
    ensureInit();
    const m = g.cityEconState;
    m.hrAcc = (m.hrAcc || 0) + dt;
    while (m.hrAcc >= HOUR) { m.hrAcc -= HOUR; hourTick(m); }
  });

  // ---- persistence ----------------------------------------------------------
  // NOTE: `hist` (the E3 sparkline rings) is deliberately NOT serialized — see
  // market.js's identical note; ephemeral, cheaply rebuilt, keeps blobs lean.
  // piYest DOES persist (it's a real state field, like market.js's `yest`),
  // so trend() doesn't glitch back to "flat" on every load.
  function serialize() {
    ensureInit();
    const m = g.cityEconState, reg = {};
    for (const id in m.reg) {
      const st = m.reg[id];
      reg[id] = {
        activity: st.activity, employment: st.employment,
        priceIndex: st.priceIndex, piYest: st.piYest, taxRate: st.taxRate, treasury: st.treasury,
      };
    }
    return { v: 1, reg: reg, hrAcc: m.hrAcc || 0, dayHrAcc: m.dayHrAcc || 0 };
  }
  function apply(obj) {
    if (!obj || obj.v !== 1) return;
    reset();
    const m = g.cityEconState;
    if (obj.reg) for (const id in obj.reg) {
      const src = obj.reg[id];
      if (!src) continue;
      if (!m.reg[id]) m.reg[id] = freshJur();
      const st = m.reg[id];
      if (isFinite(src.activity)) st.activity = clampNum(0.1, 3.0, +src.activity);
      if (isFinite(src.employment)) st.employment = clampNum(0, 1, +src.employment);
      if (isFinite(src.piYest)) st.piYest = clampNum(0.1, 3.0, +src.piYest);
      if (isFinite(src.priceIndex)) st.priceIndex = clampNum(0.1, 3.0, +src.priceIndex);
      if (isFinite(src.taxRate)) st.taxRate = clampNum(0, 1, +src.taxRate);
      if (isFinite(src.treasury) && src.treasury != null) st.treasury = +src.treasury;
    }
    m.hrAcc = obj.hrAcc || 0;
    m.dayHrAcc = obj.dayHrAcc || 0;
  }

  CBZ.econState = {
    DEFAULT_ID: DEFAULT_ID,
    PI_WEIGHTS: PI_WEIGHTS,
    get: get,
    activity: activity,
    summary: summary,
    serialize: serialize,
    apply: apply,
    reset: reset,
    // E3 legibility
    trend: trend,
    history: history,
    tickerLine: tickerLine,
  };

  // ============================================================
  //  SINGLE-PLAYER PERSIST — market.js's g.cityWorld pattern, verbatim: stamp
  //  the live registry onto g.cityWorld right before the existing commit/
  //  collect save hooks run, hydrate back out whenever that ledger object's
  //  REFERENCE changes. Own idempotence flag (_econWrap).
  // ------------------------------------------------------------
  function stampEcon() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.econ = serialize();
  }
  function ensureEconSaveWraps() {
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._econWrap) {
      const w = function () { stampEcon(); return commit.apply(this, arguments); };
      w._econWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._econWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampEcon(); return col.apply(this, arguments); };
      wc._econWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.econ) apply(led.econ);
  }
  if (CBZ.onUpdate) {
    // next free slot after market.js's 45.95 — same install-tick family.
    CBZ.onUpdate(45.96, function () {
      if (!g) return;
      ensureEconSaveWraps();
      hydrateFromLedger();
    });
  }
})();
