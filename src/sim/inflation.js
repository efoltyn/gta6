/* ============================================================
   sim/inflation.js — Stage M, step M4: INFLATION.

   BUILD-PLAN M4 (verbatim): "Inflation: π equation → priceIndex
   compounding → every price; CPI ticker; approval term
   −12·max(0, π−5%)." MASTER-PLAN's money section: inflation is a REAL
   computed rate per country that COMPOUNDS the price level every price
   already reads (or should); high inflation is politically lethal;
   central banks fight it (M3 left the `_inflationTerm` hook at zero —
   THIS FILE wires it).

   NEW FILE (not folded into sim/econstate.js) — the smaller-diff call:
   econstate.js's `priceIndex` is a per-HOUR, per-jurisdiction snapshot
   (Σw_G·p_G) with no memory of its own; the π equation needs its OWN
   per-COUNTRY daily state (pi, adaptive expectations, a compounding price
   LEVEL, a treasury-drain memory) that persists across days and is read
   by THREE separate files (econstate, market, centralbank) — that's a
   real module's worth of surface, not a 2-line hourTick edit. econstate.js
   gets a ~4-line guarded read instead (see EDIT below); market.js and
   centralbank.js each get ONE guarded read too. Total diff footprint is
   smaller as a new file than folding a second state machine into
   econstate.js's existing one.

   ============================================================
   STATE — g.inflationState.countries[countryId] = {pi, level, prevTreasury,
   hist[]}. Keyed by COUNTRY id (mirrors sim/centralbank.js's banks[] and
   sim/forex.js's underlying wealth/war/approval reads — every π input this
   file composes is a country-level quantity), NOT by econstate.js's
   jurisdiction id (a capital SETTLEMENT id, e.g. "veridiacity") — the two
   id spaces are bridged by `jurisdictionCountryOf()` below (a lazily-built
   reverse of centralbank.js's/forex.js's own private capIdFor(), same
   "small enough to duplicate, not exported" precedent both of those files'
   headers already use). Every public read here (`rate`, `priceLevel`)
   accepts EITHER id space transparently: pass a country id ("veridia") or
   a jurisdiction id ("veridiacity"/"libertyville") and it resolves the
   same country's row — callers never have to know which space they're in.

   ============================================================
   THE π EQUATION (daily, CBZ.onNewDay — same cadence family as sim/
   forex.js's dayTick / sim/centralbank.js's tickAll, registered to run
   AFTER both of them on any given day-wrap — see the install tick's own
   comment for why that ordering is deliberate):

     realPolicyRate  = policyRate(country) − pi                    (Fisher approx.)
     monetaryTerm    = MON_COEF · max(0, NEUTRAL_REAL_RATE − realPolicyRate)
       a real policy rate below the 2% neutral real rate (loose money) is
       inflationary; NEUTRAL_REAL_RATE is chosen to exactly equal BASE_DRIFT
       (both 2%) so that at the SEED state (policyRate=4% per centralbank.js,
       pi=2%) realPolicyRate is EXACTLY 2% and this term is EXACTLY zero —
       day one changes nothing, by construction, not by clamping.
     demandTerm      = DEMAND_COEF · max(0, activity − 1.0)
       an overheating economy (sim/econstate.js's own capital-jurisdiction
       activity, same field sim/centralbank.js's own econTerm already reads)
       adds inflationary demand pressure; a SLACK economy (activity<1, e.g.
       every non-republic capital's own wealth-scaled seed per city/
       countries.js) contributes nothing (one-sided max(0,...) — slack is
       disinflationary in reality too, but that's forex.js's PPP term's job,
       not this equation's; keeping this one-sided avoids double-counting).
     warDeficitTerm  = (at war ? WAR_BASE_COEF : 0)
                     + (past polwar.js's own desperate-measures threshold ?
                        DESPERATE_COEF : 0)
                     + DEFICIT_COEF · clamp(0,1, treasuryDrainSinceYesterday / norm)
       war financing and a shrinking treasury (this file's OWN day-over-day
       memory of rec.treasury — no new field on polity.js's record) are the
       "print/spend to cover it" channel; polwar.js's own militaryOf(id).
       desperateDays (already public, already the loser's own escalation
       signal) adds an extra kicker once a country is in that ladder.
     printingTerm    = PRINT_COEF · clamp(0,1, printedRecent(id,10d) / norm)
       M5 ADDENDUM (sim/bonds.js, added when that file landed): the explicit
       money-printing channel the MASTER-PLAN's money section calls out as
       the repo's one deliberate honest-money exception. warDeficitTerm just
       above already senses a shrinking treasury as a proxy for "print/spend
       to cover it" — this term is the REAL thing: sim/bonds.js issues bond
       auctions against a deficit, and only whatever the auction fails to
       sell and the central bank actually prints (gated by that bank's own
       independence — sim/centralbank.js) lands here, via the guarded read
       CBZ.bonds.printedTotal(id, 10 days). A fully-subscribed auction (real
       buyers, real cash) contributes NOTHING to this term — only literal
       money creation does. Zero whenever sim/bonds.js isn't loaded (this
       file's own m4harness.js never loads it — every M4 assertion, including
       the day-one-unchanged ones, stays exactly as it was) or hasn't printed
       anything for this country. See sim/bonds.js's own header for the full
       auction→printing chain.
     importTerm      = IMPORT_COEF · max(0, −dayOverDayPctChange(forex rate))
                        · importShare(wealth)
       a currency that just fell in LBD terms (sim/forex.js's own quote()
       history, day-over-day) makes imports costlier in local-currency
       terms — importShare is wealth-scaled (IMPORT_BASE − IMPORT_WEALTH_
       COEF·wealth, poorer -> more import-dependent, clamped to a sane
       band). The republic's own LBD never floats against itself (forex.js's
       own documented invariant) so this term is naturally, permanently 0
       for "republic" — no special-case branch needed beyond the ccy==="LBD"
       guard every other M-stage file already uses.
     credibilityFactor = clamp(0,1, 1 − CRED_COEF·independence)
       reads sim/centralbank.js's own PUBLIC snapshot(id).independence
       (regime-driven: democracy .8 down to anarchism 0) — a credible,
       independent bank anchors EXPECTATIONS, damping how much of the raw
       pressure sum actually reaches the target (real monetary economics:
       the same nominal shock produces less realized inflation under a
       trusted institution). Applied to the PRESSURE SUM only, never to
       BASE_DRIFT (structural background inflation isn't a policy failure).
     piTarget = clamp(PI_FLOOR, PI_CEIL, BASE_DRIFT + credibilityFactor ·
                (monetaryTerm + demandTerm + warDeficitTerm + importTerm +
                 printingTerm))
     pi      ← pi + (piTarget − pi) · INERTIA          (adaptive expectations,
                ~0.1/day — inflation doesn't jump to its target, it drifts
                toward it, same "expectations are sticky" idea every real
                inflation-targeting regime fights)

   STABILITY AT EXTREME VALUES (M6 forward-compat, this wave's own
   obligation per the task brief): every additive term above is already
   one-sided/clamped BEFORE summing (max(0,...) or clamp(0,1,...)), the sum
   itself is clamped to [PI_FLOOR, PI_CEIL] before it ever touches `pi`, and
   `pi` is clamped to the same band AGAIN after the inertia step with an
   `isFinite` guard that freezes pi at its last good value rather than ever
   writing NaN/Infinity into world state. PI_CEIL=20 (2000%/yr) gives M6's
   hyperinflation stage real headroom past the task's own smoke-test value
   (π=10, 1000%) with margin to spare.

   ============================================================
   COMPOUNDING — "priceIndex(country) ×= (1 + π/365) per game-day": a
   GAME day is CBZ.onNewDay's own wrap unit (core/daynight.js's 150s
   cycle), so this compounds in the SAME daily tick that just computed pi
   (using pi as of THIS day, not yesterday's) — one state field, `level`,
   per country, starting at 1.0. At the seed pi (2%), the daily factor is
   1+0.02/365 ≈ 1.0000548 — "near-day-one-unchanged" by construction, same
   spirit as every other sim/* file's own day-one contract. `level` is
   clamped to [LEVEL_FLOOR, LEVEL_CEIL] (a generous, not economically
   meaningful, numeric safety band) with the same isFinite freeze-on-bad-
   step guard `pi` gets.

   READ PATHS ("→ every price"):
     - sim/econstate.js's hourTick multiplies the jurisdiction's priceIndex
       by `CBZ.inflation.priceLevel(id)` (a ~4-line guarded edit there,
       documented in THAT file). SCOPE NOTE (recorded per the repo's
       "adapt, don't silently narrow" convention): only "libertyville" (the
       republic's capital) has a real category-price engine behind it
       (sim/market.js is city-wide, republic-only, per E1/E2's own scoping);
       every OTHER country's jurisdiction previously inherited that SAME
       shared city-wide index verbatim (a pre-M4 placeholder, not a
       deliberate design) — this wave gives every other jurisdiction a flat
       1.0 category base instead, so their priceIndex is now driven PURELY
       by their own country's real, diverging π — which is the entire point
       of this file existing. The republic's own priceIndex is
       (category CPI) × (its own compounding level) — both real, neither
       double-counted.
     - sim/market.js's itemPrice() multiplies the already-clamped [0.6,1.8]
       relative CATEGORY price by `CBZ.inflation.priceLevel()` (defaults to
       the republic) — the relative/short-term flood-vs-scarcity dynamics
       stay in their own tight band (E1's own clamp, untouched) while the
       OVERALL price level compounds on top, multiplicatively, exactly as
       the task brief specifies ("relative category dynamics stay intact").
     - systems/hunger.js's mealCost()/hourTick() read the same compounded
       food price (its own ~2-line edit, documented there) so the famine
       lever tracks REAL inflation, not just relative category noise.
     - sim/npcecon.js's cohort wages get a real catch-up mechanism replacing
       the old flat [0.85,1.15] clamp (its own edit, documented there) — the
       REAL-WAGE SQUEEZE this file's header promises.
     - city/approval.js's target equation gains the −COEF·max(0,π−5%) term
       (its own edit, documented there).
     - sim/centralbank.js's `_inflationTerm(id)` seam (left at a hardcoded
       0 by M3, exactly for this file to overwrite) is assigned below —
       `k·(π−BASE_DRIFT)`, zero at the seed π (BASE_DRIFT itself), so M3's
       own harness (which never loads this file) is untouched, and a LIVE
       stack (this file loaded) sees banks hike into real inflation.
     - sim/forex.js needs ZERO edits: its own pppTerm already reads
       `repPriceIndex/countryPriceIndex` off sim/econstate.js — once THAT
       file's priceIndex actually diverges per country (this file's whole
       reason for existing), forex's carry-vs-PPP math picks it up for
       free, exactly as forex.js's own header predicted ("M4's inflation
       work is the natural home").

   ============================================================
   THE FOREX↔INFLATION LOOP, BOUNDED: a weaker currency raises the import
   term -> raises pi -> raises priceIndex -> (via forex's own pppRatio)
   weakens the currency further -> feeds back. This is INTENDED (a real
   depreciation/inflation spiral), but every stage already carries its own
   damping: forex's ±8%/day move clamp + REVERT=0.12/day mean-reversion,
   this file's own INERTIA=0.1/day (pi doesn't jump to target) and PI_CEIL
   hard clamp, and econstate.js's `level` clamp. m4harness's own 200-day
   hostile-settings run asserts pi/rate/priceIndex all stay finite and
   within their documented clamps throughout — see that test for the actual
   numbers observed.

   ============================================================
   CENTRAL BANK HOOK — see sim/centralbank.js's own header for the M4 SEAM
   it already documents. Assigned once, at this file's own parse time
   (centralbank.js loads BEFORE this file per index.html's own ordering —
   see LOAD ORDER below — so `CBZ.centralbank` already exists): captured
   banks under an active decree never even reach computeTarget's
   inflationTerm read (decree() pins policyRate directly, bypassing the
   reaction function entirely — sim/centralbank.js's own documented
   behavior, unchanged) — "captured banks ignore it" falls out of that
   existing bypass for free, no new branch needed here.

   ============================================================
   PERSISTENCE — OWN rider (blob.inf), NOT folded into blob.cb: centralbank
   state (rates/governors/decrees) and inflation state (pi/level/treasury
   memory) are different lifecycles (a decree can lapse independently of
   where π sits; a redenomination — M6 — resets `level` without touching a
   single central-bank field) — keeping them in separate riders means a
   future M6 redenomination event can zero out blob.inf alone.
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() carry
       serialize()/apply() as blob.inf, right beside blob.stk (no ordering
       dependency — apply() only restores raw pi/level/prevTreasury numbers,
       no cross-module reads at apply time).
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own guard
       flag _inflWrap, the P5 one-shot-install fix every P/E/M-wave module
       already uses) so g.cityWorld.inf rides the localStorage ledger.
   Fresh-run reset: no existing file's reset() calls this one — mirrors
   sim/forex.js's/sim/centralbank.js's own "lazily self-heals via
   ensureInit()" precedent exactly (nothing in the codebase has a single
   fresh-city reset call site for every sim/* module already).

   LOAD ORDER: index.html loads this immediately after sim/centralbank.js
   (same v=cur1 bucket, BUILD-PLAN's own instruction) — BEFORE sim/market.js/
   sim/econstate.js/sim/npcecon.js and every city/*.js P-wave file. Fine:
   every cross-module read here (CBZ.centralbank.rate/snapshot, CBZ.econState.
   get, CBZ.forex.quote, CBZ.polwar.warsOf/militaryOf, CBZ.polity.get/list,
   CBZ.COUNTRIES) is guarded and resolved at CALL time inside the daily tick
   (registered lazily off this file's own install tick, same deferred-
   registration idiom sim/forex.js's/sim/centralbank.js's own
   ensureDayTickRegistered() already uses) — long after every script on the
   page has loaded. CBZ.centralbank itself IS already loaded at this file's
   own PARSE time (it's immediately before us), so the `_inflationTerm`
   assignment below runs unguarded-but-checked at parse time — the one
   exception to "everything resolved at call time" in this file, and safe
   precisely because of the load-order guarantee just described.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  if (!g) return;

  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }
  function clamp01(v) { return clampNum(0, 1, v); }
  function finite(v, fallback) { return isFinite(v) ? v : fallback; }

  // ============================================================
  //  TUNING (all constants in one place, per repo convention)
  // ============================================================
  const BASE_DRIFT = 0.02;             // 2%/yr structural background inflation (also the credibility anchor)
  const NEUTRAL_REAL_RATE = 0.02;      // equals BASE_DRIFT so seed (rate 4%, pi 2%) zeroes the monetary term exactly
  const NEUTRAL_POLICY_RATE = 0.04;    // fallback if centralbank.js somehow isn't loaded — matches ITS OWN neutral
  const MON_COEF = 1.5;
  const DEMAND_COEF = 0.15;
  const WAR_BASE_COEF = 0.03, DESPERATE_COEF = 0.05, DEFICIT_COEF = 0.05;
  const IMPORT_BASE = 0.30, IMPORT_WEALTH_COEF = 0.20;  // importShare = clamp(.05,.5, .30 - .20*wealth)
  const IMPORT_SHARE_LO = 0.05, IMPORT_SHARE_HI = 0.5;
  const IMPORT_COEF = 2.0;
  const CRED_COEF = 0.6;
  // M5 (sim/bonds.js): the printing/monetization term — see the header
  // addendum below and printingPassThroughTerm(). Zero whenever sim/bonds.js
  // isn't loaded or hasn't printed anything for this country (guarded read,
  // resolved at CALL time — bonds.js parses AFTER this file, see that file's
  // own LOAD ORDER note) — m4harness.js never loads sim/bonds.js, so this
  // term is always exactly 0 there and every M4 assertion stays green.
  const PRINT_COEF = 3.0;
  const PRINT_WINDOW_DAYS = 10;         // matches sim/bonds.js's own PRINT_WINDOW_DAYS
  const PRINT_NORM_FLOOR = 5000;
  // M6 (sim/hyperinflation.js): the counterfeiting externality — a guarded
  // read of a file that loads AFTER this one (resolved at CALL time inside
  // dailyTick, same "zero whenever the sibling isn't loaded" contract
  // printingPassThroughTerm() above already documents for sim/bonds.js).
  const COUNTERFEIT_COEF = 0.4;
  const INERTIA = 0.1;                 // /day — adaptive expectations
  const PI_FLOOR = -0.5, PI_CEIL = 20; // -50% deflation .. +2000%/yr (M6 hyperinflation headroom)
  const LEVEL_FLOOR = 1e-6, LEVEL_CEIL = 1e9;   // numeric safety only, not economically meaningful
  const DEFAULT_INDEPENDENCE = 0.5;    // fallback, mirrors centralbank.js's own default
  const REPUBLIC_WEALTH = 0.7;         // the republic has no wealthLevel field (polity.js's hardcoded record) — a documented flat fallback for the import term's wealth scaling (moot anyway: ccy==="LBD" zeroes the whole term for "republic")
  const FALLBACK_WEALTH = { veridia: 0.85, kesh: 0.35, solara: 0.6, mbeya: 0.25 };  // mirrors forex.js's own table (documented duplicate, same precedent)
  const HIST_CAP = 30;                 // ~a month of daily samples, matches forex.js's own sparkline length
  const INFLATION_HIKE_COEF = 0.5;     // sim/centralbank.js's _inflationTerm: k·(π−BASE_DRIFT)

  const DEFAULT_JUR = "libertyville";
  const FALLBACK_COUNTRIES = ["republic", "veridia", "kesh", "solara", "mbeya"];   // pre-polity-boot defensive floor only

  // ============================================================
  //  CROSS-MODULE READS — every one guarded, resolved at CALL time except
  //  the one documented exception in the header (the _inflationTerm assign).
  // ============================================================
  function countryIds() {
    if (CBZ.polity && typeof CBZ.polity.list === "function") {
      const recs = CBZ.polity.list("country");
      if (recs && recs.length) return recs.map(function (r) { return r.id; });
    }
    return FALLBACK_COUNTRIES.slice();
  }
  function countryRec(id) { return (CBZ.polity && CBZ.polity.get) ? CBZ.polity.get(id) : null; }
  // capIdFor(countryId) -> that country's capital EconState jurisdiction id.
  // Same small, self-contained, NOT-exported-elsewhere-either helper sim/
  // forex.js's and sim/centralbank.js's own headers document duplicating.
  function capIdFor(id) {
    if (id === "republic") return (CBZ.econState && CBZ.econState.DEFAULT_ID) || DEFAULT_JUR;
    const cd = (CBZ.COUNTRIES || []).find(function (c) { return c.id === id; });
    if (!cd) return null;
    const cap = (cd.settlements || []).find(function (s) { return s.capital; });
    return cap ? cap.id : null;
  }
  // jurisdictionCountryMap() -> {capitalSettlementId: countryId}, the reverse
  // of capIdFor() above, lazily built off CBZ.COUNTRIES (rebuilt if the
  // roster's length changes — X6b partition can mint a new country id at
  // runtime; cheap enough to just recompute rather than hook that event).
  let _revMap = null, _revMapLen = -1;
  function jurisdictionCountryMap() {
    const countries = CBZ.COUNTRIES || [];
    if (_revMap && _revMapLen === countries.length) return _revMap;
    const m = {};
    m[DEFAULT_JUR] = "republic";
    for (let i = 0; i < countries.length; i++) {
      const cd = countries[i];
      const cap = (cd.settlements || []).find(function (s) { return s.capital; });
      if (cap) m[cap.id] = cd.id;
    }
    _revMap = m; _revMapLen = countries.length;
    return m;
  }
  // countryIdFor(id) -> accepts EITHER a country id ("veridia") or a
  // jurisdiction/capital id ("veridiacity"/"libertyville") and always
  // returns the country id — see header for why callers never need to
  // know which space they're passing.
  function countryIdFor(id) {
    if (!id) return "republic";
    const map = jurisdictionCountryMap();
    return map[id] || id;
  }
  function wealthOf(countryId, rec) {
    if (rec && isFinite(rec.wealthLevel)) return clamp01(rec.wealthLevel);
    if (countryId === "republic") return REPUBLIC_WEALTH;
    return FALLBACK_WEALTH[countryId] != null ? FALLBACK_WEALTH[countryId] : 0.5;
  }
  function econStateOf(capId) {
    if (!capId || !CBZ.econState || typeof CBZ.econState.get !== "function") return null;
    return CBZ.econState.get(capId);
  }
  function policyRateOf(countryId) {
    if (CBZ.centralbank && typeof CBZ.centralbank.rate === "function") {
      const r = CBZ.centralbank.rate(countryId);
      if (isFinite(r)) return r;
    }
    return NEUTRAL_POLICY_RATE;
  }
  function independenceOf(countryId) {
    if (CBZ.centralbank && typeof CBZ.centralbank.snapshot === "function") {
      const s = CBZ.centralbank.snapshot(countryId);
      if (s && isFinite(s.independence)) return clamp01(s.independence);
    }
    return DEFAULT_INDEPENDENCE;
  }

  // ============================================================
  //  STATE — g.inflationState.countries[countryId]
  // ============================================================
  // M6 (sim/hyperinflation.js) ADDENDUM: two new per-country fields, read/
  // written ONLY through the public setters below (setAlias/setControlsFactor)
  // — everything else in this file treats them as opaque state, same as
  // prevTreasury/hist already are.
  //   alias: null | countryId — dollarization's "π := the republic's π
  //     thereafter" (MASTER-PLAN money section): stepCountry() skips its own
  //     equation entirely for an aliased country and copies the SOURCE
  //     country's freshly-stepped pi instead (see dailyTick's two-pass split
  //     below — the source is always stepped in PASS 1 so an aliased
  //     country's copy in PASS 2 is never a day stale).
  //   controlsFactor: 1 (default, no effect) .. 0 — a desperate-leader price-
  //     control decree (any govType, "regardless of ideology" per the task
  //     brief) multiplies the DISPLAYED/consumed pi by this factor at every
  //     public read (rate/rateForJurisdiction/summary/tickerLine) while
  //     `level`'s own compounding step keeps using the REAL, un-suppressed
  //     st.pi — "the classic lie": the official number lies, the real price
  //     level keeps compounding at the true pace underneath it. Because
  //     every OTHER M-wave file that wants inflation (sim/bonds.js's coupon
  //     pricing, city/approval.js's anti-incumbent term, sim/npcecon.js's
  //     wage catch-up which reads priceLevel not rate()) calls THIS public
  //     rate()/rateForJurisdiction(), the suppression ripples through those
  //     exact channels for free — no separate plumbing needed per consumer.
  //     sim/centralbank.js's own `_inflationTerm` hook is the one documented
  //     exception: it reads `countryState(id).pi` directly (this file's own
  //     internal closure, assigned once at parse time — see the CENTRAL BANK
  //     HOOK section below), so the bank's OWN reaction function keeps
  //     seeing the real number even under a controls regime, same as a real
  //     central bank's internal models would.
  function freshCountry() {
    return { pi: BASE_DRIFT, level: 1.0, prevTreasury: null, hist: [], alias: null, controlsFactor: 1 };
  }
  function reset() {
    const ids = countryIds();
    const countries = {};
    for (let i = 0; i < ids.length; i++) countries[ids[i]] = freshCountry();
    g.inflationState = { countries: countries };
  }
  function ensureInit() {
    if (!g.inflationState || !g.inflationState.countries || typeof g.inflationState.countries !== "object") { reset(); return; }
    // idempotent partial-heal (mirrors sim/forex.js's/sim/centralbank.js's
    // own ensureInit precedent): a country missing (roster growth — X6b
    // partition, a stale save) gets seeded fresh.
    const ids = countryIds();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (!g.inflationState.countries[id]) g.inflationState.countries[id] = freshCountry();
    }
  }
  function countryState(countryId) {
    ensureInit();
    if (!g.inflationState.countries[countryId]) g.inflationState.countries[countryId] = freshCountry();
    return g.inflationState.countries[countryId];
  }
  function pushHist(st, v) {
    st.hist.push(v);
    if (st.hist.length > HIST_CAP) st.hist.shift();
  }

  // ============================================================
  //  THE π EQUATION — one country, one day. See header for the full
  //  derivation of every term below.
  // ============================================================
  function warDeficitTerm(countryId, rec, st) {
    let term = 0;
    const atWar = !!(CBZ.polwar && typeof CBZ.polwar.warsOf === "function" && CBZ.polwar.warsOf(countryId).length);
    if (atWar) term += WAR_BASE_COEF;
    const mil = (CBZ.polwar && typeof CBZ.polwar.militaryOf === "function") ? CBZ.polwar.militaryOf(countryId) : null;
    if (mil && (mil.desperateDays || 0) > 0) term += DESPERATE_COEF;
    const treas = (rec && isFinite(rec.treasury)) ? rec.treasury : 0;
    const prevTreas = (st.prevTreasury != null) ? st.prevTreasury : treas;
    const drain = Math.max(0, prevTreas - treas);
    const norm = Math.max(1000, Math.abs(prevTreas) || 25000);
    term += DEFICIT_COEF * clamp01(drain / norm);
    st.prevTreasury = treas;
    return term;
  }
  // M5 (sim/bonds.js): the MONETIZATION term — real, explicit printed-money
  // pressure, distinct from warDeficitTerm's own treasury-drain MEMORY above
  // (a bond auction that fully sells contributes NOTHING here — the deficit
  // was financed by real buyers, not the printing press; only the portion
  // sim/bonds.js's own independence-gated printing actually created feeds
  // this). printed(id, window) is CBZ.bonds's own printedTotal() — the exact
  // dollar figure sim/bonds.js records the instant it prints, normalized
  // against the country's OWN current treasury scale (mirrors warDeficitTerm's
  // own `norm` idiom just above) so a small country's printing binge reads as
  // proportionally severe, not diluted against a big country's absolute scale.
  function printingPassThroughTerm(countryId, rec) {
    if (!CBZ.bonds || typeof CBZ.bonds.printedTotal !== "function") return 0;
    let printed = 0;
    try { printed = +CBZ.bonds.printedTotal(countryId, PRINT_WINDOW_DAYS); } catch (e) {}
    if (!(printed > 0)) return 0;
    const treas = (rec && isFinite(rec.treasury)) ? Math.max(1, rec.treasury) : 1;
    const norm = Math.max(PRINT_NORM_FLOOR, treas);
    return PRINT_COEF * clamp01(printed / norm);
  }
  // M6 (sim/hyperinflation.js): counterfeit cash in circulation debases
  // confidence — see that file's own header for the counterfeitPressure()
  // contract (a 0..1 read, decaying while no fresh counterfeit cash enters).
  function counterfeitPassThroughTerm(countryId) {
    if (!CBZ.hyperinflation || typeof CBZ.hyperinflation.counterfeitPressure !== "function") return 0;
    let p = 0;
    try { p = +CBZ.hyperinflation.counterfeitPressure(countryId); } catch (e) {}
    if (!(p > 0)) return 0;
    return COUNTERFEIT_COEF * clamp01(p);
  }
  function importPassThroughTerm(rec, wealth) {
    const ccy = rec && rec.currencyId;
    if (!ccy || ccy === "LBD" || !CBZ.forex || typeof CBZ.forex.quote !== "function") return 0;
    const q = CBZ.forex.quote(ccy);
    if (!q || !Array.isArray(q.history) || q.history.length < 2) return 0;
    const cur = q.history[q.history.length - 1];
    const prev = q.history[q.history.length - 2];
    if (!(prev > 0)) return 0;
    const pctChange = (cur - prev) / prev;
    const depreciation = Math.max(0, -pctChange);
    const importShare = clampNum(IMPORT_SHARE_LO, IMPORT_SHARE_HI, IMPORT_BASE - IMPORT_WEALTH_COEF * wealth);
    return IMPORT_COEF * depreciation * importShare;
  }
  function stepCountry(countryId) {
    const st = countryState(countryId);
    const rec = countryRec(countryId);
    const wealth = wealthOf(countryId, rec);
    const capId = capIdFor(countryId);

    const bankRate = policyRateOf(countryId);
    const realRate = bankRate - st.pi;
    const monetaryTerm = MON_COEF * Math.max(0, NEUTRAL_REAL_RATE - realRate);

    const es = econStateOf(capId);
    const activity = (es && isFinite(es.activity)) ? es.activity : 1.0;
    const demandTerm = DEMAND_COEF * Math.max(0, activity - 1.0);

    const warTerm = warDeficitTerm(countryId, rec, st);
    const importTerm = importPassThroughTerm(rec, wealth);
    const printingTerm = printingPassThroughTerm(countryId, rec);
    const counterfeitTerm = counterfeitPassThroughTerm(countryId);

    const independence = independenceOf(countryId);
    const credibilityFactor = clamp01(1 - CRED_COEF * independence);
    const pressureSum = monetaryTerm + demandTerm + warTerm + importTerm + printingTerm + counterfeitTerm;

    let piTarget = BASE_DRIFT + credibilityFactor * pressureSum;
    piTarget = clampNum(PI_FLOOR, PI_CEIL, finite(piTarget, BASE_DRIFT));

    let pi = st.pi + (piTarget - st.pi) * INERTIA;
    pi = clampNum(PI_FLOOR, PI_CEIL, finite(pi, st.pi));
    st.pi = pi;
    pushHist(st, pi);

    // ---- compounding: THIS day's pi, once per game-day ----
    const factor = 1 + pi / 365;
    let level = st.level * factor;
    if (!isFinite(level) || level <= 0) level = st.level;   // defensive: never let a bad step corrupt the level
    st.level = clampNum(LEVEL_FLOOR, LEVEL_CEIL, level);
  }
  // M6 (sim/hyperinflation.js): dollarization's "π := the republic's π
  // thereafter" — an aliased country skips the full π equation and instead
  // copies its alias SOURCE's just-stepped pi verbatim, then compounds its
  // OWN `level` with that same pi (so priceLevel(id) keeps moving in lock-
  // step with the source from the aliasing day forward, exactly as if this
  // country now transacts in the source's money — which, post-dollarization,
  // it does). Copies an already-finite value, so this can never introduce
  // NaN/Infinity even at the source's own clamp extremes.
  function stepAlias(countryId) {
    const st = countryState(countryId);
    const src = g.inflationState.countries[st.alias];
    if (!src) return;   // alias source vanished (shouldn't happen) — leave st untouched this tick
    st.pi = src.pi;
    pushHist(st, st.pi);
    const factor = 1 + st.pi / 365;
    let level = st.level * factor;
    if (!isFinite(level) || level <= 0) level = st.level;
    st.level = clampNum(LEVEL_FLOOR, LEVEL_CEIL, level);
  }
  function dailyTick() {
    ensureInit();
    const ids = countryIds();
    // PASS 1: every NON-aliased country steps its own real π equation first
    // (this is also where an alias SOURCE, e.g. "republic", gets its fresh
    // value for today — order-independent by construction).
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (countryState(id).alias) continue;
      try { stepCountry(id); }
      catch (e) { try { console.error("[inflation] stepCountry failed for " + id, e); } catch (e2) {} }
    }
    // PASS 2: aliased countries copy their (now-fresh) source, same day.
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (!countryState(id).alias) continue;
      try { stepAlias(id); }
      catch (e) { try { console.error("[inflation] stepAlias failed for " + id, e); } catch (e2) {} }
    }
  }
  // CBZ.onNewDay is city/polity.js's own function — polity.js loads LATER
  // than this file, so it does NOT exist yet at parse time. Deferred
  // registration, same idiom sim/forex.js's/sim/centralbank.js's own
  // ensureDayTickRegistered() uses. Registered from THIS file's own install
  // tick (46.24, right after sim/centralbank.js's 46.23) — since onUpdate
  // ticks run in ascending order and CBZ.onNewDay just appends subscribers
  // in registration order (city/polity.js's own newDaySubs.push), this
  // guarantees inflation's dailyTick runs AFTER forex's dayTick and
  // centralbank's tickAll on any given day-wrap — so it reads this SAME
  // day's freshest policy-rate/currency moves, not yesterday's.
  let _dayTickRegistered = false;
  function ensureDayTickRegistered() {
    if (_dayTickRegistered) return;
    if (CBZ.onNewDay) { CBZ.onNewDay(dailyTick); _dayTickRegistered = true; }
  }

  // ============================================================
  //  READS — accept either a country id or a jurisdiction id (see header).
  // ============================================================
  // M6: the "measured" pi a price-controls decree can suppress — see
  // freshCountry()'s own header comment for the full rationale. Every public
  // read below goes through this so a controls suppression ripples into
  // every consumer that calls THIS file's own public API (bonds' coupon
  // pricing, approval.js's anti-incumbent term, the phone ticker) with zero
  // per-consumer edits — the exact same "one seam, many readers" idiom this
  // file's own printingPassThroughTerm/counterfeitPassThroughTerm already use
  // on the WRITE side.
  function displayPi(st) { return st.pi * (st.controlsFactor != null ? st.controlsFactor : 1); }
  function rate(id) {
    const cid = countryIdFor(id);
    return displayPi(countryState(cid));
  }
  // priceLevel(id?) -> the compounding multiplier. No-arg call defaults to
  // the republic (sim/market.js's own city-wide, republic-only caller).
  function priceLevel(id) {
    const cid = id ? countryIdFor(id) : "republic";
    return countryState(cid).level;
  }
  function rateForJurisdiction(id) { return rate(id); }   // explicit alias — city/approval.js's own call site reads clearer with this name
  function history(id) {
    const cid = countryIdFor(id);
    return countryState(cid).hist.slice();
  }
  function trendOf(id) {
    const h = history(id);
    if (h.length < 2) return "flat";
    const delta = h[h.length - 1] - h[0];
    if (delta > 0.002) return "up";
    if (delta < -0.002) return "down";
    return "flat";
  }
  function tickerLine(id) {
    const cid = countryIdFor(id);
    const rec = countryRec(cid);
    const pi = displayPi(countryState(cid));
    const arrow = trendOf(cid) === "up" ? "▲" : trendOf(cid) === "down" ? "▼" : "–";
    const name = rec ? rec.name : cid;
    return (name || cid).toUpperCase() + " CPI " + (pi >= 0 ? "+" : "") + (pi * 100).toFixed(1) + "%/yr " + arrow;
  }
  function summary(id) {
    const cid = countryIdFor(id);
    const rec = countryRec(cid);
    const st = countryState(cid);
    return { id: cid, name: rec ? rec.name : cid, pi: Math.round(displayPi(st) * 10000) / 10000, level: Math.round(st.level * 1000) / 1000, trend: trendOf(cid) };
  }
  // ============================================================
  //  M6 (sim/hyperinflation.js) PUBLIC HOOKS — stages/endings live entirely
  //  in that file; this file only exposes the three primitives it needs
  //  (alias, controls, redenomination) so its own state stays the single
  //  source of truth for pi/level, exactly like printedTotal()/debtOf() are
  //  sim/bonds.js's own equivalent M6 data seams (see that file's header).
  // ============================================================
  // setAlias(id, sourceId|null) — dollarization. Guards against a country
  // aliasing itself (a no-op that would otherwise read its own stale value
  // forever) and against chaining through an already-aliased source (this
  // file only ever aliases to "republic", which is never itself aliased —
  // a one-level chain is all M6 needs, so a deeper walk is unnecessary
  // complexity, not a silent limitation: dollarize() in sim/hyperinflation.js
  // never targets anything but the republic).
  function setAlias(id, sourceId) {
    const cid = countryIdFor(id);
    const st = countryState(cid);
    st.alias = (sourceId && sourceId !== cid) ? sourceId : null;
    return st.alias;
  }
  function aliasOf(id) { return countryState(countryIdFor(id)).alias || null; }
  // rawRate(id) — the TRUE, un-suppressed pi (bypasses controlsFactor).
  // sim/hyperinflation.js's own "genuine tightening" credibility-bump check
  // (independent bank + POSITIVE REAL POLICY RATE) needs the real number —
  // reading the controls-suppressed rate() there would let a regime buy a
  // credibility bump merely by LYING harder, which defeats the entire point
  // of the mechanic. Internal/policy-correctness use only; player-facing
  // reads should keep using rate()/summary()/tickerLine().
  function rawRate(id) { return countryState(countryIdFor(id)).pi; }
  // setControlsFactor(id, factor) — the price-controls "classic lie" lever;
  // 1 = no suppression (default), 0 = pi reads as flat 0% regardless of the
  // real underlying rate. clamp01'd — a factor above 1 would INFLATE the
  // measured number, which no caller ever wants.
  function setControlsFactor(id, factor) {
    const st = countryState(countryIdFor(id));
    st.controlsFactor = clamp01(finite(factor, 1));
    return st.controlsFactor;
  }
  function controlsFactorOf(id) {
    const st = countryState(countryIdFor(id));
    return st.controlsFactor != null ? st.controlsFactor : 1;
  }
  // redenominate(id, k) -> knocks 10^k zeros off `level` ONLY (the task
  // brief's own division: sim/bonds.js's rescaleCountry() handles bond
  // face/holders, sim/hyperinflation.js's own redenominate() orchestrates
  // treasury/wallet/corp/billionaire balances — this file owns just the
  // price-LEVEL side of the operation, the one piece only IT can touch).
  // Returns the divisor actually applied (1 if k<=0, a no-op).
  function redenominate(id, k) {
    k = Math.max(0, Math.round(finite(k, 0)));
    if (!k) return 1;
    const st = countryState(countryIdFor(id));
    const div = Math.pow(10, k);
    st.level = clampNum(LEVEL_FLOOR, LEVEL_CEIL, finite(st.level / div, st.level));
    return div;
  }
  // applyCredibilityBump(id, frac) — redenomination's "genuine tightening"
  // credibility bonus (sim/hyperinflation.js only calls this when independent
  // + positive-real-rate conditions hold): pi is cut by `frac` immediately,
  // one time. Absent this call, pi is left exactly as-is and simply
  // re-targets upward again on the next daily tick if the underlying
  // pressure terms haven't actually changed — "the Argentina lesson" falls
  // out of NOT calling this, for free.
  function applyCredibilityBump(id, frac) {
    frac = clamp01(finite(frac, 0));
    const st = countryState(countryIdFor(id));
    st.pi = clampNum(PI_FLOOR, PI_CEIL, finite(st.pi * (1 - frac), st.pi));
    return st.pi;
  }
  function list() {
    ensureInit();
    const ids = countryIds(), out = [];
    for (let i = 0; i < ids.length; i++) out.push(summary(ids[i]));
    return out;
  }

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serialize() {
    ensureInit();
    const countries = {};
    const C = g.inflationState.countries;
    for (const id in C) {
      const st = C[id];
      countries[id] = {
        pi: st.pi, level: st.level, prevTreasury: st.prevTreasury,
        alias: st.alias || null, controlsFactor: st.controlsFactor != null ? st.controlsFactor : 1,
      };
    }
    return { v: 1, countries: countries };
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1) return;
    const C = g.inflationState.countries;
    if (obj.countries) for (const id in obj.countries) {
      const src = obj.countries[id];
      if (!src) continue;
      if (!C[id]) C[id] = freshCountry();
      const st = C[id];
      if (isFinite(src.pi)) st.pi = clampNum(PI_FLOOR, PI_CEIL, +src.pi);
      if (isFinite(src.level)) st.level = clampNum(LEVEL_FLOOR, LEVEL_CEIL, +src.level);
      st.prevTreasury = (src.prevTreasury != null && isFinite(src.prevTreasury)) ? +src.prevTreasury : null;
      st.alias = src.alias || null;
      st.controlsFactor = isFinite(src.controlsFactor) ? clamp01(+src.controlsFactor) : 1;
    }
  }

  CBZ.inflation = {
    rate: rate,
    priceLevel: priceLevel,
    rateForJurisdiction: rateForJurisdiction,
    history: history,
    tickerLine: tickerLine,
    summary: summary,
    list: list,
    reset: reset,
    serialize: serialize,
    apply: apply,
    // M6 (sim/hyperinflation.js) public hooks — see their own header comments.
    setAlias: setAlias,
    aliasOf: aliasOf,
    rawRate: rawRate,
    setControlsFactor: setControlsFactor,
    controlsFactorOf: controlsFactorOf,
    redenominate: redenominate,
    applyCredibilityBump: applyCredibilityBump,
    // constants a caller may want to display/reason about (read-only use)
    BASE_DRIFT: BASE_DRIFT,
    // harness/test-only hooks — not part of the public contract (mirrors
    // sim/forex.js's/sim/centralbank.js's own _state()/_dayTick precedent).
    _state: function () { ensureInit(); return g.inflationState; },
    _dayTick: dailyTick,
    _countryIdFor: countryIdFor,
    _setPi: function (id, v) { const st = countryState(countryIdFor(id)); st.pi = clampNum(PI_FLOOR, PI_CEIL, +v); return st.pi; },
    _setLevel: function (id, v) { const st = countryState(countryIdFor(id)); st.level = clampNum(LEVEL_FLOOR, LEVEL_CEIL, +v); return st.level; },
  };

  // ============================================================
  //  THE CENTRAL-BANK HOOK — sim/centralbank.js's own M4 seam. Assigned
  //  once, here, at parse time (centralbank.js is ALREADY loaded — see
  //  header's LOAD ORDER note for why this is safe unguarded-at-parse-time).
  // ============================================================
  if (CBZ.centralbank) {
    CBZ.centralbank._inflationTerm = function (id) {
      ensureInit();
      const pi = countryState(id).pi;   // computeTarget(id,...) already passes a COUNTRY id here
      return INFLATION_HIKE_COEF * (pi - BASE_DRIFT);
    };
  }

  // ============================================================
  //  SINGLE-PLAYER PERSIST — sim/centralbank.js's g.cityWorld pattern,
  //  verbatim: stamp before the existing commit/collect save hooks run,
  //  hydrate back out whenever that ledger object's REFERENCE changes.
  //  Own guard flag (_inflWrap), the P5 one-shot-install fix every P/E/M-
  //  wave module already uses.
  // ------------------------------------------------------------
  function stampInf() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.inf = serialize();
  }
  let _ensureInflSaveWraps_done = false;
  function ensureInflSaveWraps() {
    if (_ensureInflSaveWraps_done) return;
    _ensureInflSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._inflWrap) {
      const w = function () { stampInf(); return commit.apply(this, arguments); };
      w._inflWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._inflWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampInf(); return col.apply(this, arguments); };
      wc._inflWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.inf) apply(led.inf);
  }
  if (CBZ.onUpdate) {
    // next free slot after sim/centralbank.js's own 46.23 install tick —
    // same install-tick family every other P/E/M-wave save-wrap uses.
    CBZ.onUpdate(46.24, function () {
      if (!g) return;
      ensureDayTickRegistered();
      ensureInflSaveWraps();
      hydrateFromLedger();
    });
  }
})();
