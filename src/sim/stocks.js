/* ============================================================
   sim/stocks.js — Stage E, step E6: THE EXCHANGE.

   MASTER-PLAN VI.6 (verbatim, the piece this file lands): "One exchange per
   country... Hourly price formation reuses the proven propMkt skeleton
   (economy.js's momentum/mean-reversion):
     anchor  = P/E_sector × EPS(trailing real earnings)
     price  ← clamp(price × (1 + revert·(anchor/price − 1) + macroTerm + momentum + eventTerm))
     momentum ← momentum·0.62 + noise·vol + herdFlow
   ...Player tools: phone STOCKS app + exchange-floor terminal, buy/sell/short..."
   Phasing (VI.6): "(1) Bunbros alone with real revenue + read-only ticker
   (E5, landed) → (2) exchange building + trading for one stock (THIS FILE)
   → (3) full roster + index + dividends..." E7 adds the other 7 companies —
   LISTINGS below is keyed by ticker so they're additive rows later, not a
   reshape (same idempotent-registry trick sim/corporations.js used for
   g.corps.list).

   ANCHOR — fundamentals, not sentiment, unit choice spelled out because the
   naive read of the plan's equation is wrong for this game's clock:
   sim/corporations.js's `earningsHistory` is ONE SAMPLE PER IN-GAME DAY (a
   28-day "quarter" ring), not a real fiscal year, so "×365" (an annualized
   EPS multiple) would be nonsense here — it'd inflate a single good day into
   a fictitious trailing-year number. Instead:
     dailyEPS = mean(last 7 earningsHistory samples) / sharesOutstanding
                — a trailing "week" of daily net earnings, same trailing-
                window idea as corporations.js's own revenueTTM/costsTTM
                rings, just on the daily ring instead of the hourly one.
                FALLBACK: if earningsHistory is still empty (freshly listed,
                first day not yet closed), fall back to co.revAcc-co.costAcc
                — TODAY's running total-so-far — the EXACT SAME fallback
                sim/corporations.js's own summary() already uses for its
                "dailyEarnings" read, so this file stays consistent with
                the one place in the codebase that already solved this.
     anchor = clamp(0.5, 500, PE_SECTOR[sector] × dailyEPS × ANCHOR_MULT)
                ANCHOR_MULT=30 stands in for "365" — a GAME-MONTH multiple
                (trailing daily earnings × a sector P/E × ~30 game-days),
                not a real annualized P/E. Calibrated so Bunbros's toy-scale
                earnings (thousands/day off a $50k-cash startup) land in a
                legible few-dollars-to-low-hundreds share price instead of
                either flatlining at the floor or blowing through the cap.

   PRICE FORMATION (hourly, order 29.7 — right after corporations.js's 29.65
   earnings pass, so this hour's freshly-accrued earnings are what the
   anchor reads):
     macroTerm = 0.02 × (EconState.activity − 1)      — a booming city lifts
                 every listed stock, same macro coupling sim/market.js's own
                 category prices already get.
     herdFlow  = clamp(±0.01, playerNetFlow(last hour) / 50000) — the
                 player's own buy/sell dollars THIS HOUR chase/fight the
                 price, "retail cohorts chase trailing momentum" per VI.6,
                 except this wave the only retail cohort IS the player (NPC
                 whale/institutional flow is an E7+ concern).
     momentum ← momentum×0.62 + noise×vol×2 + herdFlow
     price    ← clamp(0.1, 10000, price × (1 + 0.05×(anchor/price − 1) + macroTerm + momentum))
                revert=0.05 (stronger than propMkt's 0.018 — an exchange
                price should track real fundamentals tighter than the toy
                property-index random walk it's modeled on).
   eventTerm from VI.6's equation is realized as an EXTERNAL API instead of
   an inline term: CBZ.stocks.shock(sym, frac) adds `frac` straight into
   momentum the instant it's called (war/nationalization/assassination are
   E7/E8 concerns; THIS wave wires exactly one caller — sim/corporations.js's
   robOutlet(), 2-line edit — so robbing a Bunbros till already dents BUN).

   LISTING — lazy, keyed off the real corporation actually having outlets
   (i.e. sim/corporations.js's 41.75 build tick has run and Bunbros owns real
   revenue-generating lots): before that, earningsHistory/revAcc/costAcc are
   all zero and an anchor computed from them is meaningless noise, so this
   file simply doesn't create the listing yet — same "wait for the arena,
   retry" lazy-build shape as corporations.js's own buildBunbros() gate.
   Once listed, price INITIALIZES at that instant's anchor (fair value) —
   day one of trading is never an arbitrary number.

   TRADING — CBZ.stocks.buy(sym, shares) / sell(sym, shares): cost/proceeds
   = shares × live price, a 0.5% fee taken off the top either direction
   (FEE_RATE), charged/credited through the CANONICAL money API (CBZ.city.
   spend/addCash — city/mode.js:88-90 — the same faucet/sink every other
   city system already routes through, so HUD/save/net-worth all stay
   correct for free). NO SHORTING this wave — sell() is capped at the
   player's owned share count (a future wave adds margin/short mechanics
   per VI.6's "buy/sell/short"). Every buy/sell ALSO feeds herdFlow (above)
   — pump-and-dump is real: well-timed buys chase the price up (VI.6's
   "exploitable herding... pump with well-timed buys, trigger retail
   momentum-chasing" — the SEC-heat/manipulation consequence is E7+).

   PORTFOLIO — g.cityPortfolio = { BUN: qty } is the literal shape the plan
   asked for; g.cityPortfolioBasis = { BUN: avgCostPerShare } rides ALONGSIDE
   it (not folded into the same number) so the P&L display the plan also
   asks for in the same breath has a cost basis to diff against — a plain
   qty map alone can't support "position + P&L" at once, so this is the
   minimal addition that keeps the asked-for shape intact while making the
   asked-for feature possible. Both are plain g.* fields (not g.stocks.*) so
   they persist and reset exactly like corporations.js's `co.cash` — simple
   numbers, no nested company object required.

   PERSISTENCE: same two-rider pattern as sim/corporations.js —
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() pick up
       serialize()/apply() beside blob.corp (blob.stk).
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own guard
       flag _stkWrap) so g.cityWorld.stk rides the localStorage ledger —
       g.cityPortfolio/g.cityPortfolioBasis ride INSIDE this same blob.stk
       rider (not worldstate.js's fixed field whitelist — see this file's
       serialize()), exactly the "_xWrap it with the stocks state" the plan
       flagged as the fallback if the whitelist didn't cover it (it doesn't).
   Fresh-run reset: CBZ.stocks.reset() sits beside corporations.js's own
   reset() call in the same install-tick family below.

   PLAYER TOUCHPOINTS:
     - city/phone.js's MARKETS app: the existing read-only BUN row (E5)
       becomes tappable → a detail view (price, sparkline, anchor hint,
       BUY 10/100, SELL 10/100/ALL, position + P&L).
     - city/props.js's adboard MARKET TICKER: sim/corporations.js's
       tickerLine() (already occasionally shown there) folds in the live
       price via this file's tickerLine(sym) — "BUN earnings $X ▲ · $12.40 ▲".
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ---- the listing registry: ticker -> which corporation/sector backs it.
  // E7 adds the other 7 rows here; nothing else in this file changes shape.
  const LISTINGS = {
    BUN: { corpId: "bunbros", sector: "food" },
  };
  // P/E multiples by EconState good-category sector (VI.6: "fast-food 18x,
  // casino 14x, guns 10x…" — only food is a real listing this wave).
  const PE_SECTOR = { food: 18, casino: 14, guns: 10, materials: 12, fuel: 11, luxury: 20, reit: 16, default: 15 };

  // ---- tuning (E6 constants, all in one place) ---------------------------
  const HOUR = 150 / 24;          // seconds per in-game hour — matches corporations.js exactly
  const ANCHOR_EPS_WINDOW = 7;    // trailing daily-earnings samples averaged into dailyEPS
  const ANCHOR_MULT = 30;         // "game-month multiple" stand-in for a real annualized P/E — see header
  const ANCHOR_FLOOR = 0.5, ANCHOR_CAP = 500;
  const REVERT = 0.05;            // /hr mean-reversion toward anchor (stronger than propMkt's 0.018)
  const DEFAULT_VOL = 0.015;      // per-stock noise amplitude (the plan's {vol: 0.015})
  const MOM_DECAY = 0.62;         // momentum carry-over per tick (same constant as economy.js's propMkt)
  const MACRO_COEF = 0.02;        // macroTerm = 0.02 x (activity - 1)
  const HERD_DIV = 50000;         // $ of net player flow this hour that maps to a 1.0 herd term
  const HERD_CAP = 0.01;          // herdFlow clamp, ± this
  const PRICE_FLOOR = 0.1, PRICE_CAP = 10000;
  const HIST_CAP = 48;            // sparkline ring length — matches market.js/corporations.js exactly
  const FEE_RATE = 0.005;         // 0.5% either direction (buy and sell both pay it)
  const MOM_TREND_EPS = 0.0015;   // momentum threshold for the ▲/▼/– arrow (propMkt's own threshold)

  // own seeded LCG (never Math.random — repo convention for world state), a
  // distinct seed from every other sim/* stream so none of them correlate.
  const INITIAL_SEED = 271828182 & 0x7fffffff;
  let _seed = INITIAL_SEED;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }
  function round2(v) { return Math.round(v * 100) / 100; }

  // ---- state lives on g.stocks (mirrors g.corps) + two flat player fields
  // (g.cityPortfolio / g.cityPortfolioBasis — see header's PORTFOLIO note) ---
  function reset() {
    _seed = INITIAL_SEED;
    g.stocks = { list: {}, hrAcc: 0 };
    g.cityPortfolio = {};
    g.cityPortfolioBasis = {};
  }
  function ensureInit() {
    if (!g.stocks || !g.stocks.list) { g.stocks = { list: {}, hrAcc: (g.stocks && g.stocks.hrAcc) || 0 }; }
    if (!g.cityPortfolio) g.cityPortfolio = {};
    if (!g.cityPortfolioBasis) g.cityPortfolioBasis = {};
  }

  // ---- ANCHOR: fair value off real trailing earnings ----------------------
  function dailyEPS(co) {
    const h = co.earningsHistory || [];
    let basis;
    if (h.length > 0) {
      const win = h.slice(-ANCHOR_EPS_WINDOW);
      let sum = 0; for (const v of win) sum += v;
      basis = sum / win.length;
    } else {
      // freshly listed, first day hasn't closed yet — same fallback
      // corporations.js's own summary() uses for "dailyEarnings".
      basis = (co.revAcc || 0) - (co.costAcc || 0);
    }
    return basis / (co.sharesOutstanding || 1);
  }
  function computeAnchor(co, sector) {
    const pe = PE_SECTOR[sector] || PE_SECTOR.default;
    const eps = dailyEPS(co);
    return clampNum(ANCHOR_FLOOR, ANCHOR_CAP, pe * eps * ANCHOR_MULT);
  }

  // ---- the hourly price-formation pass, one listing at a time -------------
  function stepListing(sym) {
    const meta = LISTINGS[sym];
    const co = (CBZ.corps && CBZ.corps.get) ? CBZ.corps.get(meta.corpId) : null;
    if (!co || !co.outlets || !co.outlets.length) return;   // lazy: wait for corps to have real outlets/earnings

    const anchor = computeAnchor(co, meta.sector);
    let st = g.stocks.list[sym];
    if (!st) {
      // first appearance on the exchange: list AT fair value (day one of
      // trading is never an arbitrary number) — no formation tick yet.
      st = g.stocks.list[sym] = {
        sym: sym, price: anchor, anchor: anchor, momentum: 0, vol: DEFAULT_VOL,
        history: [anchor], flowAcc: 0,
      };
      return;
    }

    const activity = (CBZ.econState && typeof CBZ.econState.activity === "function") ? CBZ.econState.activity() : 1.0;
    const macroTerm = MACRO_COEF * (activity - 1);
    const herdFlow = clampNum(-HERD_CAP, HERD_CAP, (st.flowAcc || 0) / HERD_DIV);
    st.momentum = st.momentum * MOM_DECAY + (rng() - 0.5) * st.vol * 2 + herdFlow;
    st.flowAcc = 0;   // this hour's player flow has been folded in — start counting the next hour fresh

    const raw = st.price * (1 + REVERT * (anchor / st.price - 1) + macroTerm + st.momentum);
    st.price = clampNum(PRICE_FLOOR, PRICE_CAP, raw);
    st.anchor = anchor;
    st.history.push(st.price);
    if (st.history.length > HIST_CAP) st.history.shift();
  }
  function tickAll() {
    ensureInit();
    for (const sym in LISTINGS) stepListing(sym);
  }
  // VI.6: hourly, right after corporations.js's 29.65 earnings pass so this
  // hour's freshly-accrued earnings are what the anchor reads.
  CBZ.onUpdate(29.7, function (dt) {
    if (g.mode !== "city") return;
    ensureInit();
    const S = g.stocks;
    S.hrAcc = (S.hrAcc || 0) + dt;
    while (S.hrAcc >= HOUR) { S.hrAcc -= HOUR; tickAll(); }
  });

  // ---- EVENT SHOCKS: momentum += frac, called externally (E7/E8 wire more
  // callers — war, nationalization, assassination; THIS wave wires exactly
  // one: corporations.js's robOutlet()). --------------------------------------
  function shock(sym, frac) {
    ensureInit();
    const st = g.stocks.list[sym];
    if (!st || !isFinite(frac)) return false;
    st.momentum += frac;
    return true;
  }

  // ---- reads ---------------------------------------------------------------
  function get(sym) { ensureInit(); return g.stocks.list[sym] || null; }
  function list() { ensureInit(); const out = []; for (const s in g.stocks.list) out.push(g.stocks.list[s]); return out; }
  // quote(sym) -> the UI's data layer: price, anchor, a valuation hint, trend
  // arrow (off momentum, same threshold propMkt's own trend uses), sparkline.
  function quote(sym) {
    const st = get(sym);
    if (!st) return null;
    const valuation = st.price > st.anchor * 1.05 ? "over" : (st.price < st.anchor * 0.95 ? "under" : "fair");
    const trend = st.momentum > MOM_TREND_EPS ? "up" : (st.momentum < -MOM_TREND_EPS ? "down" : "flat");
    return {
      sym: sym, price: st.price, anchor: st.anchor, momentum: st.momentum,
      valuation: valuation, trend: trend, history: st.history.slice(),
    };
  }
  function arrowFor(t) { return t === "up" ? "▲" : t === "down" ? "▼" : "–"; }
  // tickerLine(sym) -> "$12.40 ▲" — folded into corporations.js's own
  // tickerLine() (2-line edit) for the adboard MARKET TICKER.
  function tickerLine(sym) {
    const q = quote(sym);
    if (!q) return "";
    return "$" + q.price.toFixed(2) + " " + arrowFor(q.trend);
  }

  // ---- TRADING: buy/sell through the canonical money API -------------------
  // No shorting this wave — sell() caps at owned shares (E-later: margin/short).
  function buy(sym, shares) {
    shares = Math.floor(shares);
    if (!(shares > 0)) return { ok: false, reason: "shares" };
    ensureInit();
    const st = g.stocks.list[sym];
    if (!st) return { ok: false, reason: "not-listed" };
    const cost = round2(shares * st.price);
    const fee = round2(cost * FEE_RATE);
    const total = round2(cost + fee);
    const spend = (CBZ.city && CBZ.city.spend) ? CBZ.city.spend(total) : (function () {
      if ((g.cash || 0) < total) return false; g.cash -= total; return true;
    })();
    if (!spend) return { ok: false, reason: "cash", need: total };

    const P = g.cityPortfolio, B = g.cityPortfolioBasis;
    const prevQty = P[sym] || 0, prevBasis = B[sym] || 0;
    const newQty = prevQty + shares;
    B[sym] = (prevBasis * prevQty + cost) / newQty;   // weighted-average cost basis (fee excluded — friction, not share cost)
    P[sym] = newQty;
    st.flowAcc = (st.flowAcc || 0) + cost;             // this hour's herdFlow input

    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return { ok: true, shares: shares, price: st.price, cost: cost, fee: fee, total: total };
  }
  function sell(sym, shares) {
    shares = Math.floor(shares);
    if (!(shares > 0)) return { ok: false, reason: "shares" };
    ensureInit();
    const st = g.stocks.list[sym];
    if (!st) return { ok: false, reason: "not-listed" };
    const P = g.cityPortfolio;
    const have = P[sym] || 0;
    if (shares > have) return { ok: false, reason: "shares-owned", have: have };   // no shorting

    const gross = round2(shares * st.price);
    const fee = round2(gross * FEE_RATE);
    const proceeds = round2(gross - fee);
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(proceeds); else g.cash = (g.cash || 0) + proceeds;

    const remain = have - shares;
    if (remain <= 0) { delete P[sym]; delete g.cityPortfolioBasis[sym]; }
    else P[sym] = remain;
    st.flowAcc = (st.flowAcc || 0) - gross;

    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return { ok: true, shares: shares, price: st.price, gross: gross, fee: fee, proceeds: proceeds };
  }
  function sellAll(sym) {
    ensureInit();
    const have = g.cityPortfolio[sym] || 0;
    if (have <= 0) return { ok: false, reason: "shares-owned", have: 0 };
    return sell(sym, have);
  }
  // position(sym) -> the phone detail view's data layer: qty, avg cost,
  // live value, and P&L (unrealized — realized P&L is an E-later ledger).
  function position(sym) {
    ensureInit();
    const qty = g.cityPortfolio[sym] || 0;
    const avgCost = g.cityPortfolioBasis[sym] || 0;
    const st = g.stocks.list[sym];
    const price = st ? st.price : 0;
    const value = qty * price;
    const costBasis = qty * avgCost;
    const pnl = value - costBasis;
    const pnlPct = costBasis > 0 ? pnl / costBasis : 0;
    return { sym: sym, qty: qty, avgCost: avgCost, price: price, value: value, pnl: pnl, pnlPct: pnlPct };
  }

  // ---- persistence ----------------------------------------------------------
  // NOTE: unlike market.js/corporations.js, `history` (the sparkline ring) IS
  // serialized here — it's needed to draw a sensible detail-view sparkline
  // right after a fresh load, before an hour of live ticks has re-filled it,
  // and it's small (≤48 numbers per listing, one listing this wave).
  function serialize() {
    ensureInit();
    const out = { v: 1, list: {}, portfolio: {}, basis: {}, hrAcc: g.stocks.hrAcc || 0 };
    for (const sym in g.stocks.list) {
      const st = g.stocks.list[sym];
      out.list[sym] = { price: st.price, anchor: st.anchor, momentum: st.momentum, history: st.history.slice() };
    }
    for (const sym in g.cityPortfolio) out.portfolio[sym] = g.cityPortfolio[sym];
    for (const sym in g.cityPortfolioBasis) out.basis[sym] = g.cityPortfolioBasis[sym];
    return out;
  }
  function apply(obj) {
    if (!obj || obj.v !== 1) return;
    reset();
    if (obj.list) for (const sym in obj.list) {
      if (!LISTINGS[sym]) continue;   // unknown ticker (future save, older client) — skip, not crash
      const src = obj.list[sym];
      if (!src || !isFinite(src.price)) continue;
      g.stocks.list[sym] = {
        sym: sym,
        price: clampNum(PRICE_FLOOR, PRICE_CAP, +src.price),
        anchor: isFinite(src.anchor) ? clampNum(ANCHOR_FLOOR, ANCHOR_CAP, +src.anchor) : +src.price,
        momentum: isFinite(src.momentum) ? +src.momentum : 0,
        vol: DEFAULT_VOL,
        history: Array.isArray(src.history) ? src.history.slice(-HIST_CAP) : [+src.price],
        flowAcc: 0,
      };
    }
    if (obj.portfolio) for (const sym in obj.portfolio) if (isFinite(obj.portfolio[sym])) g.cityPortfolio[sym] = +obj.portfolio[sym];
    if (obj.basis) for (const sym in obj.basis) if (isFinite(obj.basis[sym])) g.cityPortfolioBasis[sym] = +obj.basis[sym];
    g.stocks.hrAcc = obj.hrAcc || 0;
  }

  CBZ.stocks = {
    LISTINGS: LISTINGS,
    PE_SECTOR: PE_SECTOR,
    get: get,
    list: list,
    quote: quote,
    tickerLine: tickerLine,
    shock: shock,
    buy: buy,
    sell: sell,
    sellAll: sellAll,
    position: position,
    serialize: serialize,
    apply: apply,
    reset: reset,
  };

  // ============================================================
  //  SINGLE-PLAYER PERSIST — sim/corporations.js's g.cityWorld pattern,
  //  verbatim: stamp the live state onto g.cityWorld right before the
  //  existing commit/collect save hooks run, hydrate back out whenever that
  //  ledger object's REFERENCE changes. Own idempotence flag (_stkWrap).
  // ------------------------------------------------------------
  function stampStocks() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.stk = serialize();
  }
  function ensureStockSaveWraps() {
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._stkWrap) {
      const w = function () { stampStocks(); return commit.apply(this, arguments); };
      w._stkWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._stkWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampStocks(); return col.apply(this, arguments); };
      wc._stkWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.stk) apply(led.stk);
  }
  if (CBZ.onUpdate) {
    // next free slot after sim/corporations.js's 45.98 — same install-tick family.
    CBZ.onUpdate(45.99, function () {
      if (!g) return;
      ensureStockSaveWraps();
      hydrateFromLedger();
    });
  }
})();
