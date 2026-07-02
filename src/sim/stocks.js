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
  // E7: DATA-DRIVEN off sim/corporations.js's COMPANIES roster (syncListings-
  // FromCorps() below) instead of a hardcoded single BUN row — a fallback
  // static entry keeps this file safe if corporations.js somehow isn't
  // loaded. Player IPOs (CBZ.stocks.ipo()) add further rows at runtime.
  const BASE_LISTINGS = { BUN: { corpId: "bunbros", sector: "food" } };
  // NOTE: LISTINGS is mutated IN PLACE (never reassigned) — CBZ.stocks.LISTINGS
  // below captures this exact object reference once at export time, so a
  // fresh-run reset() must clear/refill it rather than pointing the const at
  // a new object (which would silently orphan that exported reference).
  const LISTINGS = Object.assign({}, BASE_LISTINGS);
  function syncListingsFromCorps() {
    if (!CBZ.corps || typeof CBZ.corps.list !== "function") return;
    for (const co of CBZ.corps.list()) {
      if (!LISTINGS[co.tickerSym]) LISTINGS[co.tickerSym] = { corpId: co.id, sector: co.sector };
    }
  }
  function resetListings() {
    for (const k in LISTINGS) delete LISTINGS[k];
    Object.assign(LISTINGS, BASE_LISTINGS);
    syncListingsFromCorps();
  }
  // P/E multiples by EconState good-category sector (VI.6: "fast-food 18x,
  // casino 14x, guns 10x…") — one row per E7 roster sector, plus a fallback.
  const PE_SECTOR = { food: 18, casino: 14, guns: 10, materials: 12, fuel: 11, luxury: 20, reit: 16, media: 13, default: 15 };

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
    g.stocks = { list: {}, hrAcc: 0, dayHrAcc: 0, index: null };
    g.cityPortfolio = {};
    g.cityPortfolioBasis = {};
    // E7: a fresh run drops any prior run's player-IPO tickers — start back
    // at the fixed 8-company roster, re-synced below.
    resetListings();
  }
  function ensureInit() {
    if (!g.stocks || !g.stocks.list) { g.stocks = { list: {}, hrAcc: (g.stocks && g.stocks.hrAcc) || 0, dayHrAcc: 0, index: null }; }
    if (!g.cityPortfolio) g.cityPortfolio = {};
    if (!g.cityPortfolioBasis) g.cityPortfolioBasis = {};
    syncListingsFromCorps();
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
    // lazy: wait for the corp to be ACTIVE (E7: outlet-based cos flip this
    // once they claim real lots; the 3 no-outlet specials + any player IPO
    // are active immediately — see sim/corporations.js's `co.active`).
    if (!co || !co.active) return;

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
    updateIndex();
  }
  // VI.6: hourly, right after corporations.js's 29.65 earnings pass so this
  // hour's freshly-accrued earnings are what the anchor reads.
  CBZ.onUpdate(29.7, function (dt) {
    if (g.mode !== "city") return;
    ensureInit();
    const S = g.stocks;
    S.hrAcc = (S.hrAcc || 0) + dt;
    while (S.hrAcc >= HOUR) {
      S.hrAcc -= HOUR;
      tickAll();
      // E7: dividends — one game-day boundary, shared with corporations.js's
      // own day counter (both roll off the same HOUR cadence starting from
      // the same reset(), so they land in lockstep in practice).
      S.dayHrAcc = (S.dayHrAcc || 0) + 1;
      if (S.dayHrAcc >= 24) { S.dayHrAcc -= 24; try { payDividends(); } catch (e) {} }
    }
  });

  // ---- NATIONAL INDEX (LBX): a Dow-style divisor index over every listed
  // company's price x sharesOutstanding. The divisor is set the FIRST time
  // there's any positive raw sum so the index starts at exactly 100; every
  // time a NEW company lists later (its price/anchor first appears), the
  // divisor is bumped so the index VALUE stays continuous across the
  // addition instead of jumping (the textbook Dow-divisor trick). -----------
  function computeRawSum() {
    let sum = 0;
    for (const sym in g.stocks.list) {
      const st = g.stocks.list[sym], meta = LISTINGS[sym];
      const co = (meta && CBZ.corps && CBZ.corps.get) ? CBZ.corps.get(meta.corpId) : null;
      const shares = co ? co.sharesOutstanding : 0;
      if (shares > 0) sum += st.price * shares;
    }
    return sum;
  }
  function updateIndex() {
    const S = g.stocks;
    if (!S.index) S.index = { divisor: null, value: 100, nSyms: 0, trend: "flat" };
    const raw = computeRawSum();
    const nSyms = Object.keys(g.stocks.list).length;
    if (S.index.divisor == null) {
      if (raw > 0) { S.index.divisor = raw / 100; S.index.value = 100; S.index.nSyms = nSyms; }
      return;
    }
    if (nSyms > S.index.nSyms && S.index.value > 0) {
      S.index.divisor = raw / S.index.value;   // absorb the new listing with zero index jump
      S.index.nSyms = nSyms;
    }
    const newValue = S.index.divisor > 0 ? raw / S.index.divisor : 100;
    S.index.trend = newValue > S.index.value * 1.0008 ? "up" : (newValue < S.index.value * 0.9992 ? "down" : "flat");
    S.index.value = newValue;
  }
  // indexQuote()/indexTickerLine() -> the phone MARKETS header + billboard
  // ticker's "LBX 100.4 ▲" line. null/"" until the divisor has ever been seeded.
  function indexQuote() {
    ensureInit();
    const I = g.stocks.index;
    if (!I || I.divisor == null) return null;
    return { value: I.value, trend: I.trend };
  }
  function indexTickerLine() {
    const Q = indexQuote();
    if (!Q) return "";
    const arrow = Q.trend === "up" ? "▲" : (Q.trend === "down" ? "▼" : "–");
    return "LBX " + Q.value.toFixed(1) + " " + arrow;
  }

  // ---- DIVIDENDS: 20% of trailing-7-day average earnings, once per
  // game-day, gated on real solvency (positive trailing earnings AND cash
  // more than double a trailing daily cost estimate) — a company bleeding
  // cash or barely profitable pays nothing, it isn't a Ponzi. -------------
  const DIVIDEND_FRAC = 0.20;
  function dailyCostEstimate(co) {
    const arr = co.costsTTM || []; const win = arr.slice(-24);
    let s = 0; for (const v of win) s += v;
    return s;
  }
  function payDividends() {
    for (const sym in LISTINGS) {
      const meta = LISTINGS[sym];
      const co = (CBZ.corps && CBZ.corps.get) ? CBZ.corps.get(meta.corpId) : null;
      if (!co || co.bankrupt || !co.earningsHistory || !co.earningsHistory.length) continue;
      const win = co.earningsHistory.slice(-ANCHOR_EPS_WINDOW);
      let sum = 0; for (const v of win) sum += v;
      const avgDaily = sum / win.length;
      if (!(avgDaily > 0)) continue;                              // positive trailing-7 earnings required
      if (!(co.cash > 2 * dailyCostEstimate(co))) continue;       // cash > 2x costs required
      const divTotal = avgDaily * DIVIDEND_FRAC;
      if (!(divTotal > 0)) continue;
      co.cash -= divTotal;
      const qty = g.cityPortfolio[sym] || 0;
      if (qty > 0) {
        const payout = round2(divTotal * (qty / (co.sharesOutstanding || 1)));
        if (payout >= 0.01) {
          if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(payout); else g.cash = (g.cash || 0) + payout;
          if (CBZ.cityFeed) CBZ.cityFeed("💵 " + sym + " paid a dividend — +$" + payout.toFixed(2), "#7ed957");
          if (CBZ.cityHudDirty) CBZ.cityHudDirty();
        }
      }
    }
  }

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

  // ---- PLAYER IPO: a maxed city/wealth.js BIZ converts into a listed company
  // (VI.6). This file owns the eligibility gate (against CBZ.cityWealth's
  // BIZ table) + the exchange listing; sim/corporations.js's createIPO()
  // only mints the underlying company record. The player is GRANTED
  // IPO_PLAYER_FRAC (40%) of the float — not bought, so no cash changes
  // hands here — and the biz's wealth.js passive income is gated off
  // (rec.ipo = true; see wealth.js's bizRate() guard) so the SAME dollars
  // don't double-pay through both systems from here on. ---------------------
  const IPO_PLAYER_FRAC = 0.40;
  const IPO_DAY_SECONDS = 150;   // core/daynight.js's CYCLE — one real-clock game-day, wealth.js's bizRate() is $/real-sec
  // wealth.js BIZ `kind` -> a stock sector (documented mapping; front/gig
  // fronts read as consumer "goods", supply chains as "materials", the two
  // vanity/high-roller kinds as "luxury", casino/invest map directly).
  const SECTOR_BY_BIZKIND = { front: "goods", supply: "materials", club: "luxury", casino: "casino", lux: "luxury", invest: "reit" };
  function ipoSymFor(bizId, name) {
    const base = String(bizId || name || "IPO").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "IPO";
    if (!LISTINGS[base]) return base;
    for (let n = 1; n <= 9; n++) { const s = base.slice(0, 2) + n; if (!LISTINGS[s]) return s; }
    return base + Math.floor(rng() * 90 + 10);   // pathological collision fallback
  }
  function ipo(bizId) {
    ensureInit();
    const W = CBZ.cityWealth;
    if (!W || !Array.isArray(W.BUSINESSES)) return { ok: false, reason: "no-wealth" };
    const b = W.BUSINESSES.find(function (x) { return x.id === bizId; });
    if (!b) return { ok: false, reason: "unknown-biz" };
    if (!W.owns || !W.owns(bizId)) return { ok: false, reason: "not-owned" };
    const st = W.state ? W.state() : null;
    const rec = st && st.biz ? st.biz[bizId] : null;
    if (!rec) return { ok: false, reason: "no-record" };
    if ((rec.tier | 0) < (b.maxTier || 0)) return { ok: false, reason: "not-maxed" };
    if (rec.ipo) return { ok: false, reason: "already-ipo" };
    if (!CBZ.corps || typeof CBZ.corps.createIPO !== "function") return { ok: false, reason: "no-corps" };
    const dailySeed = Math.max(1, Math.round((typeof W.bizRate === "function" ? W.bizRate(bizId) : 0) * IPO_DAY_SECONDS));
    const sector = SECTOR_BY_BIZKIND[b.kind] || "goods";
    const sym = ipoSymFor(bizId, b.name);
    const co = CBZ.corps.createIPO({ id: "ipo_" + bizId, sym: sym, name: b.name, sector: sector, dailySeed: dailySeed, playerShareFrac: IPO_PLAYER_FRAC });
    if (!co) return { ok: false, reason: "create-failed" };
    LISTINGS[sym] = { corpId: co.id, sector: sector };
    const anchor = computeAnchor(co, sector);
    g.stocks.list[sym] = { sym: sym, price: anchor, anchor: anchor, momentum: 0, vol: DEFAULT_VOL, history: [anchor], flowAcc: 0 };
    const shares = Math.round((co.sharesOutstanding || 0) * IPO_PLAYER_FRAC);
    g.cityPortfolio[sym] = (g.cityPortfolio[sym] || 0) + shares;
    g.cityPortfolioBasis[sym] = anchor;   // granted, not bought — a fair paper cost basis at the IPO price
    rec.ipo = true;                        // wealth.js's bizRate() guard: this biz's passive income now flows THROUGH the company instead
    if (CBZ.city && CBZ.city.big) CBZ.city.big("📈 " + b.name + " went PUBLIC as " + sym + " — you keep " + Math.round(IPO_PLAYER_FRAC * 100) + "% of the float");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return { ok: true, sym: sym, shares: shares, price: anchor };
  }

  // ---- persistence ----------------------------------------------------------
  // NOTE: unlike market.js/corporations.js, `history` (the sparkline ring) IS
  // serialized here — it's needed to draw a sensible detail-view sparkline
  // right after a fresh load, before an hour of live ticks has re-filled it,
  // and it's small (≤48 numbers per listing, one listing this wave).
  function serialize() {
    ensureInit();
    // note: sim/corporations.js's serialize() is what actually recreates any
    // player-IPO ticker's backing company (its `extra[]` spec); by the time
    // THIS file's apply() runs, netpersist.js has already applied CBZ.corps
    // (market -> npce -> corp -> stk order), so syncListingsFromCorps() in
    // reset()/ensureInit() below already re-registered that ticker's sym ->
    // {corpId,sector} row before obj.list is walked.
    const out = { v: 1, list: {}, portfolio: {}, basis: {}, hrAcc: g.stocks.hrAcc || 0, dayHrAcc: g.stocks.dayHrAcc || 0, index: g.stocks.index };
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
    g.stocks.dayHrAcc = obj.dayHrAcc || 0;
    if (obj.index && isFinite(obj.index.divisor)) g.stocks.index = { divisor: +obj.index.divisor, value: +obj.index.value || 100, nSyms: obj.index.nSyms || 0, trend: obj.index.trend || "flat" };
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
    ipo: ipo,
    indexQuote: indexQuote,
    indexTickerLine: indexTickerLine,
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
  let _ensureStockSaveWraps_done = false;
  function ensureStockSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureStockSaveWraps_done) return;
    _ensureStockSaveWraps_done = true;
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
