/* ============================================================
   sim/market.js — Stage E, step E1: the CITY-WIDE PRICE SHIM.

   MASTER-PLAN VI.2/VI.6: "the economy shim must precede political price
   levers" and "starting values are today's equilibrium — day one changes
   nothing observable; only gameplay deltas move prices." This module is
   that shim: CBZ.market.price(category) defaults to 1.0 so every buyPrice/
   sellPrice call site that multiplies by it is a no-op until real ticks
   accrue. It's a CITY-WIDE placeholder this wave — VI.2's real EconState
   is per-jurisdiction; P1's polity registry is expected to shard this by
   city/country once it lands (grep this file then).

   TEMPLATE: the proven district drug market in city/economy.js (~557-697:
   initMarket/distLevels, recordSale/recordBuy flood-vs-scarcity, the
   onUpdate(30,...) mean-reversion drift). This is the SAME shape — mean-
   revert + seeded noise + demand signals — just gentler, city-wide (one
   level per category, not per-district), and explicitly NOT touching
   drugs: that engine is untouched and stays the sole authority on drug
   pricing (streetPrice/wholesalePrice/recordSale/recordBuy over there).

   CATEGORIES (VI.2's EconState.goods shape, minus drugs): food, goods,
   guns, materials, fuel, luxury. Each starts at p=1.0 (parity multiplier
   over ITEMS[name].value, exactly like economy.js's flat "×1.0" retail
   today) and drifts within [0.6, 1.8] this wave — gentle; hyperinflation
   is an M-stage (central bank) concern, not this one.

   THIS WAVE ONLY WIRES FOOD: buyPrice/sellPrice in city/economy.js multiply
   the food tag by CBZ.market.price("food"); every other category still
   prices flat at 1.0 in practice today even though its level object exists
   and drifts — E2 extends the multiplier to the rest of the catalog. The
   one live DEMAND-SIGNAL call site this wave is buildmode's Wood spend
   (systems/buildmode.js tryPlace()) → recordBuy("materials", ...): placing
   consumes real Wood, so it nudges materials scarcity up, same as the drug
   engine's wholesale-drain semantics.

   PERSISTENCE: two riders, matching familytree.js's precedent exactly —
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() pick up
       serialize()/apply() beside blob.fam/blob.propMkt (blob.mkt).
     - SINGLE-PLAYER: this file wraps CBZ.cityWorldCommit/cityWorldCollect
       (own guard flag _mktWrap) so g.cityWorld.market rides the same
       localStorage ledger, exactly like the family tree / bank loan ledger.
   Fresh-run reset: city/peds.js's spawnCityPeds() already resets the drug
   market (CBZ.cityEcon.initMarket()) on a new city; this file adds its own
   guarded CBZ.market.reset() call right beside it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ---- categories + the tag → category map -----------------------------
  const CATS = ["food", "goods", "guns", "materials", "fuel", "luxury"];

  // ITEMS[name].tag -> market category. Anything not listed here (tool,
  // throwable, clothing, jewelry, the literal "goods" tag — nothing is
  // tagged "goods" in economy.js yet) falls back to "goods", per spec.
  // "drug" is INTENTIONALLY omitted: city/economy.js's district engine
  // (streetPrice/wholesalePrice) owns drug pricing end to end — itemPrice()
  // below special-cases it back out to the flat catalog value untouched.
  const TAG2CAT = {
    food: "food",
    weapon: "guns", ammo: "guns",
    resource: "materials",
    wearable: "luxury", valuable: "luxury",
    tool: "goods",
  };
  function categoryOfTag(tag) { return TAG2CAT[tag] || "goods"; }

  // ---- tuning (VI.2: "one game hour ≈ 6.25s" — core/daynight.js's day
  // cycle is CYCLE=150s / 24h = 6.25s/hr, matched here exactly) -----------
  const HOUR = 150 / 24;     // seconds per in-game hour
  const REVERT = 0.05;       // /hr mean-reversion toward 1.0 (gentle)
  const NOISE = 0.02;        // /hr seeded-LCG noise amplitude (±)
  const CLAMP_LO = 0.6, CLAMP_HI = 1.8;   // gentle this wave; M-stage widens it
  const SIGNAL_BUMP = 0.008; // per-unit recordSale/recordBuy nudge
  const SIGNAL_CAP = 0.06;   // per-call cap on that nudge (a single big order
                             // can't blow through the clamp in one tick)
  const TREND_EPS = 0.015;   // ±1.5% vs yesterday's snapshot = "flat"
  const BIGMOVE = 0.10;      // >10% from 1.0 fires the city-feed line
  const BIGMOVE_RESET = 0.05; // must settle back under this to re-arm
  const FEED_COOLDOWN_MS = 20000; // throttle: one feed line per 20s, any category
  const HIST_CAP = 48;       // E3: ring-buffer length backing the adboard ticker
                             // + phone Markets app sparklines — one hourly sample
                             // each, so 48 = two in-game days of trail. EPHEMERAL
                             // UI data, deliberately excluded from serialize().

  // own seeded LCG (never Math.random — repo convention for world state),
  // a distinct seed from economy.js's drug-market rng so the two streams
  // don't accidentally correlate.
  let _seed = 918273645 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // P6: communism's price-control override — a per-category upper-clamp that
  // replaces CLAMP_HI when set (city/regimes.js's CBZ.market.setControls()
  // below). Undefined/absent = the original flat CLAMP_HI for every category.
  let controlMaxP = Object.create(null);
  function clamp(p, cat) {
    const hi = (cat && controlMaxP[cat] != null) ? controlMaxP[cat] : CLAMP_HI;
    return Math.max(CLAMP_LO, Math.min(hi, p));
  }

  // ---- state lives on g.cityMarket (mirrors g.cityDrugDist) so it saves/
  // resets with the rest of the run's world state ------------------------
  function reset() {
    const lvl = {}, yest = {}, hist = {}, buyVol = {};
    for (const c of CATS) { lvl[c] = { p: 1.0 }; yest[c] = 1.0; hist[c] = []; buyVol[c] = 0; }
    g.cityMarket = { lvl: lvl, yest: yest, hist: hist, buyVol: buyVol, hrAcc: 0, dayHrAcc: 0, bigFired: {} };
    controlMaxP = Object.create(null);   // P6: a fresh run starts with no price-control override
  }
  // P6: CBZ.market.setControls({maxP}) — communism's price-control override.
  // Applies to food + goods (the two categories P6's task brief names; other
  // categories are untouched this wave). setControls(null) lifts it. Also
  // clamps the LIVE price down immediately if it's currently above the new
  // ceiling — a price control that only bites on the NEXT hourly tick would
  // read as a no-op for a harness (or a player) checking right after it's
  // announced. Controlled prices ALSO cutting shop STOCK ("shortages") has
  // no home yet — there is no stock-quantity concept anywhere in this
  // codebase (shops sell off an infinite catalog); that lands with whatever
  // future wave adds real inventory, not this shim.
  const CONTROLLED_CATS = ["food", "goods"];
  function setControls(opts) {
    ensureInit();
    if (opts && isFinite(opts.maxP)) {
      for (const c of CONTROLLED_CATS) {
        controlMaxP[c] = +opts.maxP;
        const lv = g.cityMarket.lvl[c];
        if (lv && lv.p > controlMaxP[c]) lv.p = controlMaxP[c];
      }
    } else {
      for (const c of CONTROLLED_CATS) delete controlMaxP[c];
    }
  }
  function ensureInit() {
    if (!g.cityMarket) { reset(); return; }
    // backfill for a market object that predates the history rings (e.g. a
    // blob applied via apply() before this wave — apply() calls reset() first
    // so this is mostly belt-and-suspenders for hand-built test state).
    if (!g.cityMarket.hist) {
      g.cityMarket.hist = {};
      for (const c of CATS) g.cityMarket.hist[c] = [];
    }
    // E7: backfill the buy-volume counter the same way for pre-E7 state.
    if (!g.cityMarket.buyVol) {
      g.cityMarket.buyVol = {};
      for (const c of CATS) g.cityMarket.buyVol[c] = 0;
    }
  }

  // ---- reads -------------------------------------------------------------
  // price(category) -> current multiplier, 1.0 fallback for unknown/absent.
  function price(cat) {
    ensureInit();
    const lv = g.cityMarket.lvl[cat];
    return lv ? lv.p : 1.0;
  }
  // M4: the compounding inflation price level (sim/inflation.js), read once
  // per call — defaults to 1.0 if that file isn't loaded (day-one/pre-M4
  // behavior, byte-identical). This is a SEPARATE multiplier from the
  // per-category `price(cat)` above: `price(cat)` stays the tight [0.6,1.8]
  // relative flood-vs-scarcity band (untouched by this wave), while THIS
  // factor is the overall, unbounded-upward price LEVEL — multiplicative on
  // top, so relative category dynamics stay intact exactly as the task
  // brief specifies. No-arg call defaults to the republic (this file is the
  // republic's own city-wide shim).
  function inflationLevel() {
    return (CBZ.inflation && typeof CBZ.inflation.priceLevel === "function") ? CBZ.inflation.priceLevel() : 1.0;
  }
  // itemPrice(name) -> ITEMS[name].value scaled by its category's live price
  // AND the live inflation level, EXCEPT drugs, which the district engine
  // owns (returned at flat catalog value × inflation — callers who want the
  // real drug price use streetPrice/wholesalePrice; district drug pricing
  // itself is untouched, only the catalog-value fallback here inflates).
  function itemPrice(name) {
    const ITEMS = CBZ.cityEcon && CBZ.cityEcon.ITEMS;
    const it = ITEMS && ITEMS[name];
    if (!it) return 0;
    const infl = inflationLevel();
    if (it.tag === "drug") return Math.round(it.value * infl);
    return Math.round(it.value * price(categoryOfTag(it.tag)) * infl);
  }
  // trend(category) -> "up" | "down" | "flat", vs the price snapshotted at
  // the last day boundary (±1.5% threshold — small daily wobble reads flat).
  function trend(cat) {
    ensureInit();
    const m = g.cityMarket, lv = m.lvl[cat];
    if (!lv) return "flat";
    const y = m.yest[cat] != null ? m.yest[cat] : 1.0;
    if (y <= 0) return "flat";
    const delta = (lv.p - y) / y;
    if (delta > TREND_EPS) return "up";
    if (delta < -TREND_EPS) return "down";
    return "flat";
  }

  // ---- E3 LEGIBILITY: history rings + formatters for the adboard ticker and
  // the phone Markets app. Pure data — no DOM/canvas here, so both are
  // node-harness-testable (see scratchpad e3harness.js). ---------------------
  const CAT_LABEL = { food: "FOOD", goods: "GOODS", guns: "GUNS", materials: "MATS", fuel: "FUEL", luxury: "LUX" };
  function arrowFor(t) { return t === "up" ? "▲" : t === "down" ? "▼" : "–"; }   // ▲ / ▼ / –
  // history(cat) -> up to the last 48 hourly samples (oldest first), a COPY
  // so callers can never mutate the live ring.
  function history(cat) {
    ensureInit();
    const h = g.cityMarket.hist[cat];
    return h ? h.slice() : [];
  }
  // tickerLine(cat) -> "FOOD ×1.24 ▲" — what the adboard ticker creative and
  // the phone Markets app both render (the phone re-colors it; the board
  // paints it straight into a canvas). Unknown category -> "".
  function tickerLine(cat) {
    ensureInit();
    const lv = g.cityMarket.lvl[cat];
    if (!lv) return "";
    const lbl = CAT_LABEL[cat] || String(cat).toUpperCase();
    return lbl + " ×" + lv.p.toFixed(2) + " " + arrowFor(trend(cat));
  }
  // rows() -> the phone Markets app's data layer: one row per category, all
  // the fields its render needs (label, live price, trend, sparkline history).
  function rows() {
    ensureInit();
    return CATS.map(function (c) {
      return { cat: c, label: CAT_LABEL[c] || c.toUpperCase(), price: g.cityMarket.lvl[c].p, trend: trend(c), hist: history(c) };
    });
  }

  // ---- demand signals (drug-engine semantics, kept identical) -----------
  // recordSale: the player SELLING into this category floods it — price
  // drops (same direction as economy.js's recordSale flooding a district).
  function recordSale(cat, qty) {
    ensureInit();
    const lv = g.cityMarket.lvl[cat]; if (!lv) return;
    qty = qty || 1;
    lv.p = clamp(lv.p - Math.min(SIGNAL_CAP, SIGNAL_BUMP * qty), cat);
  }
  // recordBuy: the player BUYING drains supply and signals demand — price
  // ticks up (same direction as economy.js's recordBuy draining a district).
  function recordBuy(cat, qty) {
    ensureInit();
    const lv = g.cityMarket.lvl[cat]; if (!lv) return;
    qty = qty || 1;
    lv.p = clamp(lv.p + Math.min(SIGNAL_CAP, SIGNAL_BUMP * qty), cat);
    // E7: a raw cumulative buy-volume counter per category (NOT the clamped
    // price nudge above) — sim/corporations.js's Granite & Sons reads this
    // as its citywide materials-demand proxy (drainBuyVolume() below).
    g.cityMarket.buyVol[cat] = (g.cityMarket.buyVol[cat] || 0) + qty;
  }
  // drainBuyVolume(cat) -> this category's accumulated recordBuy volume since
  // the last drain, reset to 0. A one-shot "read and clear" counter (like
  // recordSale/recordBuy's own semantics elsewhere) — only Granite & Sons
  // calls this today, but any future consumer gets its own fair slice as
  // long as it drains on its own cadence.
  function drainBuyVolume(cat) {
    ensureInit();
    const v = g.cityMarket.buyVol[cat] || 0;
    g.cityMarket.buyVol[cat] = 0;
    return v;
  }

  // ---- the city feed line on big moves (throttled) -----------------------
  const FEED_LABEL = {
    food: "Food", goods: "Goods", guns: "Gun",
    materials: "Materials", fuel: "Fuel", luxury: "Luxury",
  };
  let _lastFeedAt = -1e9;
  function checkBigMoves(m) {
    const now = CBZ.now || 0;
    for (const c of CATS) {
      const dev = m.lvl[c].p - 1.0;
      if (Math.abs(dev) > BIGMOVE) {
        if (!m.bigFired[c] && now - _lastFeedAt > FEED_COOLDOWN_MS) {
          m.bigFired[c] = dev > 0 ? "up" : "down";
          _lastFeedAt = now;
          const label = FEED_LABEL[c] || c;
          const msg = label + " prices " + (dev > 0 ? "climbing" : "dropping");
          if (CBZ.cityFeed) CBZ.cityFeed(msg, dev > 0 ? "#ff9e6b" : "#7ed957");
        }
      } else if (Math.abs(dev) < BIGMOVE_RESET) {
        m.bigFired[c] = null;   // settled back near baseline — can re-arm
      }
    }
  }

  // ---- the hourly-ish tick: mean-revert + noise, day-boundary snapshot ---
  function hourTick(m) {
    // E2: revert toward the city's live `activity` (sim/econstate.js) instead
    // of a flat 1.0 — a booming city has structurally higher prices. Guarded
    // so day one (activity starts at 1.0) and a missing econstate.js are both
    // byte-identical to the old flat-1.0 behavior.
    const target = (CBZ.econState && typeof CBZ.econState.activity === "function") ? CBZ.econState.activity() : 1.0;
    for (const c of CATS) {
      const lv = m.lvl[c];
      lv.p += (target - lv.p) * REVERT;          // mean-revert toward activity
      lv.p += (rng() - 0.5) * 2 * NOISE;         // seeded noise, ±NOISE/hr
      lv.p = clamp(lv.p, c);
      // E3: one hourly sample into this category's sparkline ring.
      const h = m.hist[c] || (m.hist[c] = []);
      h.push(lv.p);
      if (h.length > HIST_CAP) h.shift();
    }
    m.dayHrAcc = (m.dayHrAcc || 0) + 1;
    if (m.dayHrAcc >= 24) {                      // a game-day wrapped — snapshot
      m.dayHrAcc -= 24;
      for (const c of CATS) m.yest[c] = m.lvl[c].p;
    }
    checkBigMoves(m);
  }
  // VI.2: "Hourly tick (order 29.5, before the 30.x money ticks...)" — slotted
  // right before economy.js's ECON band (CBZ.PRIO.ECON = 30, the drug-market
  // tick's own home) so the shim settles before anything reads a price this frame.
  CBZ.onUpdate(29.5, function (dt) {
    if (g.mode !== "city") return;
    ensureInit();
    const m = g.cityMarket;
    m.hrAcc = (m.hrAcc || 0) + dt;
    while (m.hrAcc >= HOUR) { m.hrAcc -= HOUR; hourTick(m); }
  });

  // ---- persistence --------------------------------------------------------
  // NOTE: `hist` (the E3 sparkline rings) is deliberately NOT serialized — it's
  // ephemeral UI trail data, cheaply rebuilt by an hour of live ticks, and
  // keeping it out of the blob keeps world saves lean.
  function serialize() {
    ensureInit();
    const m = g.cityMarket, p = {}, y = {};
    for (const c of CATS) { p[c] = m.lvl[c].p; y[c] = m.yest[c]; }
    return { v: 1, p: p, y: y, dayHrAcc: m.dayHrAcc || 0 };
  }
  function apply(obj) {
    if (!obj || obj.v !== 1) return;
    reset();
    const m = g.cityMarket;
    if (obj.p) for (const c of CATS) if (obj.p[c] != null && isFinite(obj.p[c])) m.lvl[c].p = clamp(+obj.p[c], c);
    if (obj.y) for (const c of CATS) if (obj.y[c] != null && isFinite(obj.y[c])) m.yest[c] = clamp(+obj.y[c], c);
    m.dayHrAcc = obj.dayHrAcc || 0;
  }

  CBZ.market = {
    CATS: CATS.slice(),
    categoryOfTag: categoryOfTag,
    price: price,
    itemPrice: itemPrice,
    trend: trend,
    recordSale: recordSale,
    recordBuy: recordBuy,
    drainBuyVolume: drainBuyVolume,
    setControls: setControls,
    serialize: serialize,
    apply: apply,
    reset: reset,
    // E3 legibility
    history: history,
    tickerLine: tickerLine,
    rows: rows,
  };

  // ============================================================
  //  SINGLE-PLAYER PERSIST — familytree.js's g.cityWorld pattern, verbatim:
  //  stamp the live levels onto g.cityWorld right before the existing
  //  commit/collect save hooks run, and hydrate back out whenever that
  //  ledger object's REFERENCE changes (fresh load / respawn / MP adopt).
  //  Own idempotence flag (_mktWrap) so this only wraps each fn once.
  // ------------------------------------------------------------
  function stampMarket() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.market = serialize();
  }
  let _ensureMarketSaveWraps_done = false;
  function ensureMarketSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureMarketSaveWraps_done) return;
    _ensureMarketSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._mktWrap) {
      const w = function () { stampMarket(); return commit.apply(this, arguments); };
      w._mktWrap = true; CBZ.cityWorldCommit = w;
      if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._mktWrap) {
        const col = CBZ.cityWorldCollect;
        const wc = function () { stampMarket(); return col.apply(this, arguments); };
        wc._mktWrap = true; CBZ.cityWorldCollect = wc;
      }
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.market) apply(led.market);
  }
  if (CBZ.onUpdate) {
    // next free slot after familytree.js (45.92) / baseclaim.js+marriage.js
    // (45.93) / basesave.js (45.94) — same install-tick family.
    CBZ.onUpdate(45.95, function () {
      if (!g) return;
      ensureMarketSaveWraps();
      hydrateFromLedger();
    });
  }
})();
