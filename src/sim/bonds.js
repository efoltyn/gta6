/* ============================================================
   sim/bonds.js — Stage M, step M5: BONDS.

   BUILD-PLAN M5 (verbatim): "Bonds: deficit → auctions (billionaires/
   companies/player) → unsold remainder printed." MASTER-PLAN's money
   section (verbatim, the paragraph this file ships): "Deficits are financed
   by bonds first — auctioned to billionaires, companies, and the player at
   policyRate + riskPremium(debt/GDP, confidence) — and whatever the auction
   fails to sell gets printed (baseMoney += unfinanced). Printing is never a
   button; it's what happens when nobody buys your debt." And: "War
   financing, end to end: war → deficit spike → bond auctions → unsold →
   printing → inflation → approval collapse → emergency powers or
   revolution."

   THE CHAIN THIS FILE CLOSES: sim/centralbank.js (M3) priced the policy
   rate; sim/inflation.js (M4) priced π off (among other things) a treasury-
   drain MEMORY. THIS file is where a sustained drain actually becomes real
   debt: a country whose treasury falls below a floor (or is draining fast
   over a rolling window) issues a bond SERIES, auctioned to the three real
   buyers who exist in this codebase — sim/billionaires.js's persistent
   founder NPCs (real cash, debited), sim/corporations.js's cash-rich
   companies (real cash, debited via the existing debitCash()), and the
   player (via the exchange UI, city/phone.js's MARKETS app) — and whatever
   nobody buys either PRINTS (subject to a central-bank-independence gate)
   or simply never gets financed (the treasury stays short — "auction
   FAILS partially" per the task brief). Printed money feeds BACK into
   sim/inflation.js's π equation as a new, explicit term (see that file's
   own ~15-line addition, documented in ITS header) — closing the doom-loop
   circuit M6 will stage: deficit → unsold auction → printing → inflation →
   higher yields demanded (this file's own distress premium) → bigger
   deficits.

   ============================================================
   STATE — g.bondsState = {countries:{id:{seedTreasury, treasuryHist[],
   distress, distressScar, printedLog[], activeSeriesId}}, series:{id:{...}},
   nextSeriesId}. `seedTreasury` is captured the FIRST time this file ever
   looks at a country (whatever its polity.js treasury reads at that
   instant) — the reference point every deficit-floor/face-sizing/distress
   calc below scales against, the same "capture a day-one reference, scale
   off it forever" idiom sim/corporations.js's own `startCash`/`cashDayStart`
   fields and city/polwar.js's own `mil.seedSoldiers` floor already use.

   ============================================================
   ISSUANCE (onNewDay, one country at a time, AFTER servicing any existing
   series — see DAILY TICK ORDER below): a country issues a new series only
   if it has NO currently-active series (single-active-series-per-country,
   the exact same scope bound city/polwar.js's own header documents for its
   own "single war per polity" — same reasoning: every "assert an exact
   number" harness check stays a one-line fact instead of a moving target)
   AND either its treasury has fallen below DEFICIT_FLOOR_FRAC×seedTreasury,
   or its treasury has been draining, on average, faster than
   FAST_DRAIN_FRAC_PER_DAY×seedTreasury/day over the trailing ROLL_WINDOW_
   DAYS days (mirrors sim/inflation.js's own day-over-day treasury-drain
   memory, just windowed instead of single-day). Face is sized to comfortably
   cover the shortfall for the tenor (GAP_MULT × the gap to the floor),
   floored/capped as a fraction of seedTreasury so a single series never
   trivializes OR swallows the whole fiscal picture. Tenor is fixed at
   TENOR_DAYS (30 game-days) per the task brief.

   COUPON PRICING (couponFor(), read by both fresh issuance and a ROLL):
     coupon = clamp(FLOOR,CEIL,
       policyRate(country)                                    (M3)
       + CRED_SPREAD_COEF × (1 − independence)                 (M3's own
         independence stat — an untrustworthy institution costs the
         country a real risk premium on its own debt, same "credibility"
         idea sim/inflation.js's own credibilityFactor already prices in
         on the OTHER side of this exact institution)
       + PI_COEF × π(country)                                  (M4 — investors
         want compensating for expected currency debasement)
       + DISTRESS_COEF × distress(country))                    (this file's
         own debt/seedTreasury-driven state — the literal "riskPremium
         (debt/GDP, confidence)" the MASTER-PLAN quote above names; GDP has
         no real proxy in this codebase so seedTreasury — this country's
         OWN fiscal scale — stands in, exactly the documented-duplicate
         precedent every sim/* module's own wealth-scaling table already
         sets for the same missing-GDP problem)

   ============================================================
   AUCTION (runNpcAuction(), the instant a series is minted): billionaires
   (sim/billionaires.js's founders() — real persistent NPCs) and cash-rich
   corporations (sim/corporations.js's list()) each bid a fraction of their
   REAL cash, scaled by an "appetite" term — clamp01((coupon − EARNINGS_
   YIELD_BASE) × APPETITE_SENS) — comparing this bond's coupon against a
   baseline "safe-ish" yield (bonds are lower-risk than equity, so the bar
   is set below sim/stocks.js's own sector P/E-implied earnings yields, not
   at them): a coupon that undercuts the market rate finds NO buyers (as it
   should — nobody buys underpriced debt), a distressed/high-coupon series
   finds eager ones. Billionaires ALSO carry a small per-sid pseudo-random
   risk-tolerance multiplier (E8's founder record has no risk-archetype
   field of its own yet — a documented ADAPTATION: a deterministic hash of
   the sid, mirroring city/polwar.js's own mkRng(id) per-country-seeded-
   stream precedent, stands in for "risk archetype if E8 has one"). Every
   winning bid is REAL money leaving REAL hands: a billionaire's bid debits
   their actual ledger cash (live ped or offline page — same read/write
   sim/corporations.js's own whaleSession() uses); a corporation's bid goes
   through the existing, exported CBZ.corps.debitCash(). Each winning bid
   ALSO credits the country's treasury immediately, face-for-cash — issuing
   a bond is how the government actually RAISES the money it's short on;
   the auction is the financing event, not a paper exercise.

   WHAT'S UNSOLD, ONE DAY LATER (checkPendingPrints(), a `printCheckDay =
   issuedDay+1` field on the series): giving the player exactly one real
   in-game day to see the series on the exchange (city/phone.js's BONDS
   card) and buy in at par before the central bank acts — CBZ.bonds.buy()
   below shrinks the same unsold pool the print-check reads. Whatever is
   STILL unsold at the check: the central bank tries to print it, gated by
   INDEPENDENCE (M3's own bank.independence, read live): an INDEPENDENT bank
   (≥INDEP_GATE_T) refuses to print more than PRINT_CAP_INDEP_FRAC×the
   series' own face (the literal "won't absorb more than ~20% of a series"
   from the task brief) — the rest is simply never financed at all: no
   holder record is created for it, the treasury never sees that cash, "the
   auction FAILS partially" exactly as specified. A CAPTURED bank
   (<INDEP_GATE_T, i.e. exactly the fascism/dictatorship/emergencyRule rows
   sim/centralbank.js's own INDEPENDENCE_BY_GOV table already floors low)
   prints the entire remainder. Every dollar actually printed here is
   recorded (recordPrinted()) and is what sim/inflation.js's own new
   printing term reads (CBZ.bonds.printedTotal(id, window)) — the visible,
   COSTLY consequence the repo's honest-money rule carves out as its one
   deliberate exception.

   ============================================================
   DEBT SERVICE (serviceSeries(), daily, BEFORE this country's own issuance
   check — see DAILY TICK ORDER): coupon accrues daily on the PRIVATELY-held
   face only (face minus whatever the central bank itself holds — a
   government paying interest to its own central bank is a wash, "the
   central bank's coupons retire quietly" per the task brief, realized here
   simply by never billing the treasury for that slice) and is paid,
   pro-rata by holding share, from the treasury to each private holder's
   REAL cash (billionaire ledger cash, corp cash via the existing
   creditRevenue(), player wallet via CBZ.city.addCash — each with its own
   feed line, "coupons arrive in wallet"). If the treasury can't cover it,
   the SAME independence-gated printing this file's auction path uses tries
   to cover the shortfall (captured banks print readily here too — "captured
   banks print more readily" from the task brief, and independent ones
   mostly don't, on purpose: this is meant to be the MORE common road to
   default than a failed initial auction). If a real shortfall remains after
   that: DEFAULT (see below) — immediately, not waiting for maturity, per
   the task brief's "if treasury can't even coupon and the bank won't print
   → default event".

   MATURITY (handleMaturity()): if the treasury can cover the outstanding
   privately-held face in full, it's repaid in full and the series closes.
   If not, the series ROLLS — a fresh series mints for the same holders (an
   IOU rolled forward, not paid), a fresh TENOR_DAYS out, at a coupon
   recomputed AFTER the roll bumps this country's distress (a permanent-ish
   "scar" that decays slowly, `distressScar`, exactly mirroring city/
   polwar.js's own permanent-independence-floor-on-decree precedent in sim/
   centralbank.js) — "roll raises the distress premium", per the task brief.

   DEFAULT (defaultSeries()): every PRIVATE holder's outstanding claim takes
   a haircut — RECOVERY_FRAC (40%) is paid out immediately as the ONLY
   payment that claim will ever see (a real, honest, partial loss: a
   billionaire's or corporation's recovered cash is real and smaller than
   what they were owed — this is how "haircut hits net worth/cash" is
   realized without inventing a second, fictitious debit on money that's
   already left their hands at purchase time), the series closes as
   defaulted, this country's distressScar spikes hard, a forex confidence
   shock hits its currency (skipped for the republic's own LBD, which never
   floats against itself — same guard every M-wave file already uses), and
   an approval shock lands via the existing CBZ.approvalShock seam.

   ============================================================
   DAILY TICK ORDER (per country, one CBZ.onNewDay pass): service any
   existing active series FIRST (coupon/maturity/default/roll), THEN run
   the pending-print check for anything still awaiting its one-day-later
   resolution, THEN — only if the country still has no active series —
   check the deficit signal and possibly issue a fresh one. Servicing before
   issuing means a freshly-rolled/defaulted series never gets double-counted
   against the "single active series" gate on the same tick it closes.

   ============================================================
   M6 DATA SEAMS (read-only, no behavior — the task brief's own instruction):
   CBZ.bonds.debtOf(id) (sum of outstanding face across every ACTIVE series,
   private + central-bank-held — real total government debt, monetized or
   not), CBZ.bonds.distressOf(id) (the live distress state driving coupon
   pricing), CBZ.bonds.printedTotal(id, windowDays) (this file's own printed-
   money ledger, ALSO what sim/inflation.js's new term reads). M6 wires its
   hyperinflation-stage thresholds off these three reads; nothing here
   anticipates M6's own state machine.

   ============================================================
   PLAYER SURFACE: city/phone.js's MARKETS app (the same "read-only rows +
   trade buttons" idiom E6/M2/M3/M4 already established there) gains a
   sibling "🏛 SOVEREIGN BONDS" card — one row per ACTIVE series (country,
   coupon, days to maturity, $ still available this series) with BUY $1k/
   $10k buttons wired to CBZ.bonds.buy(), plus a "your holdings" summary.
   Coupon/maturity/default payouts already surface as ordinary cityFeed
   lines (the same "you'll see it in the feed" idiom every other sim/* payout
   uses) — no separate notification system needed. A phone Markets-app
   "sovereign-debt yield card" (the task brief's phrasing) IS this card;
   no separate card was warranted. No Phone app model change beyond the one
   sibling card.

   ============================================================
   PERSISTENCE — OWN rider (blob.bond), NOT folded into blob.inf or blob.cb:
   the task brief left this as a documented choice ("pick smaller diff,
   document") — bonds' own shape (a live series registry with holder maps)
   shares nothing structurally with either sibling rider, and a fold would
   mean inflation.js's or centralbank.js's apply() growing a foreign-shaped
   sub-object; a clean top-level blob.bond, applied with no ordering
   dependency on anything else (mirrors sim/inflation.js's own "just
   restores raw numbers" note), is the smaller, cleaner diff.
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() carry
       serialize()/apply() as blob.bond, right beside blob.inf.
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own guard
       flag _bondWrap, the P5 one-shot-install fix every P/E/M-wave module
       already uses) so g.cityWorld.bond rides the localStorage ledger.
   HOLDER-CLASS PERSISTENCE, PER THE TASK BRIEF'S OWN QUESTION ("document
   where each holder class persists"): the player's own bond holdings live
   ENTIRELY inside a series' own `holders.player` field, which rides in
   THIS file's blob.bond — no other rider carries them. A billionaire's or
   corporation's holding is likewise stored in `holders[sid]`/`holders[corpId]`
   inside blob.bond (NOT inside sim/billionaires.js's own blob.bil / sim/
   corporations.js's own blob.corp) — those files' own serialize()s were
   deliberately left untouched (smaller diff; a bond holding is a CLAIM
   against a specific series, which only this file's registry can resolve
   meaningfully). What DOES ride in billionaires.js/corporations.js's own
   riders, unchanged, is the CASH those purchases already debited (or
   coupons/haircuts already credited) — ordinary ledger/co.cash numbers,
   already covered by their own existing persistence.
   Fresh-run reset: no existing file's reset() calls this one — mirrors
   every other sim/* module's own "lazily self-heals via ensureInit()"
   precedent (nothing in the codebase has a single fresh-city reset call
   site for every sim/* module already).

   LOAD ORDER: index.html loads this immediately after sim/inflation.js
   (same v=cur1 bucket, BUILD-PLAN's own instruction) — BEFORE sim/market.js/
   sim/corporations.js/sim/stocks.js/sim/billionaires.js and every P-wave
   file. Fine: every cross-module read here (CBZ.polity.get/list,
   CBZ.centralbank.rate/snapshot, CBZ.inflation.rate, CBZ.billionaires.
   founders, CBZ.corps.list/debitCash/creditRevenue, CBZ.forex.shock,
   CBZ.approvalShock, CBZ.cityLedgerLive/cityLedgerEntry, CBZ.city.spend/
   addCash) is guarded and resolved at CALL time inside the daily tick or
   the player-facing buy(), long after every script on the page has loaded
   — the identical discipline every M-wave file's own header already
   documents for the same load-order shape. sim/inflation.js's own NEW
   printing term reads CBZ.bonds.printedTotal() the same guarded way, even
   though (by load order) this file parses AFTER inflation.js — never at
   inflation.js's own parse time, only from inside ITS daily tick, which
   runs long after every module has loaded.
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
  function num(n, d) { n = +n; return isFinite(n) ? n : (d || 0); }

  // own seeded LCG (never Math.random — repo convention for world state), a
  // distinct seed from every other sim/* stream.
  const INITIAL_SEED = 190420675 & 0x7fffffff;
  let _seed = INITIAL_SEED;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function hashStr(s) {
    let h = 2166136261; s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  // deterministic per-sid "risk tolerance" in [0.7,1.3] — see header's
  // documented ADAPTATION (E8's founder record has no risk-archetype field).
  function riskFactorOf(sid) { return 0.7 + (hashStr(sid) % 1000) / 1000 * 0.6; }

  const FALLBACK_COUNTRIES = ["republic", "veridia", "kesh", "solara", "mbeya"];

  // ============================================================
  //  TUNING (all constants in one place, per repo convention)
  // ============================================================
  const DEFICIT_FLOOR_FRAC = 0.35;        // treasury below this fraction of seedTreasury -> deficit
  const ROLL_WINDOW_DAYS = 5;             // rolling drain-rate window
  const FAST_DRAIN_FRAC_PER_DAY = 0.02;   // sustained drain averaging >2%/day of seedTreasury also -> deficit
  const FAST_DRAIN_CEILING_FRAC = 2.0;    // the fast-drain signal only fires below this multiple of seedTreasury —
                                           // a country sitting on a multiple of its normal fiscal scale isn't in
                                           // distress just because it made one big real payment (e.g. this file's
                                           // OWN full bond repayment at maturity) that reads as a sharp one-day drop
                                           // in the rolling window; a SUSTAINED problem near/below normal scale is
                                           // what this signal exists to catch, not a healthy treasury's own payout.
  const GAP_MULT = 3;                     // face sized to comfortably outrun the immediate gap for the tenor
  const MIN_FACE_FRAC = 0.15, MAX_FACE_FRAC = 0.6;  // face bounds, as a fraction of seedTreasury
  const MIN_FACE = 2000;
  const TENOR_DAYS = 30;

  const COUPON_FLOOR = 0.02, COUPON_CEIL = 2.5;   // 2% .. 250%/yr (M6 hyperinflation headroom)
  const CRED_SPREAD_COEF = 0.10;
  const PI_COEF = 0.5;
  const DISTRESS_COEF = 0.12;

  const EARNINGS_YIELD_BASE = 0.03;       // baseline "safe-ish" comparison yield for appetite
  const APPETITE_SENS = 10;
  const BID_CASH_FRAC = 0.25, MIN_CASH_TO_BID = 500;
  const CORP_CASH_FLOOR = 5000, CORP_BID_FRAC = 0.20;

  const INDEP_GATE_T = 0.5;               // >= this independence -> gated printing; below -> captured, prints freely
  const PRINT_CAP_INDEP_FRAC = 0.20;      // independent bank: refuses more than this fraction of a SERIES's face
  const PRINT_WINDOW_DAYS = 10;           // sim/inflation.js's own printing-term lookback
  const PRINTED_LOG_MAX_AGE_DAYS = 60;    // prune older entries lazily

  const RECOVERY_FRAC = 0.4;              // default: 40% recovery / 60% haircut
  const DEFAULT_FX_SHOCK = 0.15;
  const DEFAULT_APPROVAL = -12;

  const SCAR_DECAY = 0.03;                // /day, distressScar relaxes slowly
  const ROLL_SCAR = 0.4, DEFAULT_SCAR = 1.0;
  const DIST_DEBT_COEF = 1.0, DIST_INERTIA = 0.15, DIST_CAP = 3;

  const DEFAULT_INDEPENDENCE = 0.5;       // fallback, mirrors sim/centralbank.js's own default

  // ============================================================
  //  CROSS-MODULE READS — every one guarded, resolved at CALL time (see
  //  header's LOAD ORDER note).
  // ============================================================
  function countryIds() {
    if (CBZ.polity && typeof CBZ.polity.list === "function") {
      const recs = CBZ.polity.list("country");
      if (recs && recs.length) return recs.map(function (r) { return r.id; });
    }
    return FALLBACK_COUNTRIES.slice();
  }
  function countryRec(id) { return (CBZ.polity && CBZ.polity.get) ? CBZ.polity.get(id) : null; }
  function policyRateOf(id) {
    if (CBZ.centralbank && typeof CBZ.centralbank.rate === "function") {
      const r = CBZ.centralbank.rate(id);
      if (isFinite(r)) return r;
    }
    return 0.04;
  }
  function independenceOf(id) {
    if (CBZ.centralbank && typeof CBZ.centralbank.snapshot === "function") {
      const s = CBZ.centralbank.snapshot(id);
      if (s && isFinite(s.independence)) return clamp01(s.independence);
    }
    return DEFAULT_INDEPENDENCE;
  }
  function piOf(id) {
    if (CBZ.inflation && typeof CBZ.inflation.rate === "function") {
      const p = CBZ.inflation.rate(id);
      if (isFinite(p)) return p;
    }
    return 0.02;
  }
  function ledgerRec(sid) {
    if (!sid) return null;
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live) return live;
    return (CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid)) || null;
  }
  function cashOfSid(sid) { const r = ledgerRec(sid); return r ? (r.cash || 0) : 0; }
  function debitSidCash(sid, amt) { const r = ledgerRec(sid); if (r) r.cash = Math.max(0, (r.cash || 0) - amt); }
  function creditSidCash(sid, amt) { const r = ledgerRec(sid); if (r) r.cash = Math.max(0, (r.cash || 0) + amt); }
  function isCorpId(key) { return !!(CBZ.corps && typeof CBZ.corps.get === "function" && CBZ.corps.get(key)); }

  // ============================================================
  //  STATE — g.bondsState.{countries,series,nextSeriesId}
  // ============================================================
  function freshCountryState(id) {
    const rec = countryRec(id);
    const seed = (rec && isFinite(rec.treasury) && rec.treasury > 0) ? rec.treasury : 25000;
    return { seedTreasury: seed, treasuryHist: [seed], distress: 0, distressScar: 0, printedLog: [], activeSeriesId: null };
  }
  function reset() {
    _seed = INITIAL_SEED;
    g.bondsState = { countries: {}, series: {}, nextSeriesId: 1 };
    _payoutLog = [];
    _appetiteDamp = Object.create(null);
  }
  function ensureInit() {
    if (!g.bondsState || !g.bondsState.countries || !g.bondsState.series) reset();
  }
  function ensureCountry(id) {
    ensureInit();
    if (!g.bondsState.countries[id]) g.bondsState.countries[id] = freshCountryState(id);
    return g.bondsState.countries[id];
  }
  function seriesRec(id) { ensureInit(); return g.bondsState.series[id] || null; }
  function activeSeriesOf(id) {
    const st = ensureCountry(id);
    if (!st.activeSeriesId) return null;
    const s = seriesRec(st.activeSeriesId);
    return (s && s.status === "active") ? s : null;
  }

  // ============================================================
  //  DISTRESS + DEFICIT SIGNAL
  // ============================================================
  function sumHolders(holders) { let s = 0; for (const k in holders) s += holders[k] || 0; return s; }
  function debtOf(id) {
    ensureInit();
    let total = 0;
    const S = g.bondsState.series;
    for (const sid in S) { const s = S[sid]; if (s.countryId === id && s.status === "active") total += sumHolders(s.holders); }
    return total;
  }
  function updateDistress(id, rec, st) {
    st.distressScar = Math.max(0, (st.distressScar || 0) * (1 - SCAR_DECAY));
    const norm = Math.max(1000, st.seedTreasury || 25000);
    const debt = debtOf(id);
    const target = clampNum(0, DIST_CAP, DIST_DEBT_COEF * (debt / norm)) + st.distressScar;
    let d = st.distress + (target - st.distress) * DIST_INERTIA;
    st.distress = clampNum(0, DIST_CAP, finite(d, st.distress));
  }
  function pushTreasuryHist(st, treasury) {
    st.treasuryHist.push(treasury);
    if (st.treasuryHist.length > ROLL_WINDOW_DAYS + 1) st.treasuryHist.shift();
  }
  function deficitSignal(id, rec, st) {
    const treasury = (rec && isFinite(rec.treasury)) ? rec.treasury : 0;
    const floor = st.seedTreasury * DEFICIT_FLOOR_FRAC;
    const h = st.treasuryHist;
    let avgDrain = 0;
    if (h.length >= 2) avgDrain = (h[0] - h[h.length - 1]) / (h.length - 1);
    const fastDrain = avgDrain > st.seedTreasury * FAST_DRAIN_FRAC_PER_DAY && treasury < st.seedTreasury * FAST_DRAIN_CEILING_FRAC;
    return { isDeficit: treasury < floor || fastDrain, floor: floor, treasury: treasury, avgDrain: avgDrain };
  }

  // ============================================================
  //  COUPON PRICING — see header.
  // ============================================================
  function couponFor(id, st) {
    const base = policyRateOf(id);
    const independence = independenceOf(id);
    const credSpread = CRED_SPREAD_COEF * (1 - independence);
    const piExp = PI_COEF * piOf(id);
    const distressPrem = DISTRESS_COEF * (st.distress || 0);
    return clampNum(COUPON_FLOOR, COUPON_CEIL, finite(base + credSpread + piExp + distressPrem, COUPON_FLOOR));
  }

  // ============================================================
  //  PRINTING — shared by the auction remainder AND a coupon shortfall.
  //  capBasis: what "~20%" is measured against (a series' own face for the
  //  auction path; the shortfall itself for a coupon-shortfall call).
  // ============================================================
  function recordPrinted(id, st, day, amt) {
    st.printedLog.push({ day: day, amt: amt });
    const cutoff = day - PRINTED_LOG_MAX_AGE_DAYS;
    while (st.printedLog.length && st.printedLog[0].day < cutoff) st.printedLog.shift();
  }
  function doPrint(id, rec, st, requested, capBasis, day) {
    if (!(requested > 0)) return 0;
    const independence = independenceOf(id);
    const maxPrintable = independence >= INDEP_GATE_T ? capBasis * PRINT_CAP_INDEP_FRAC : requested;
    const printed = Math.max(0, Math.min(requested, maxPrintable));
    if (printed > 0) {
      rec.treasury = (rec.treasury || 0) + printed;
      recordPrinted(id, st, day, printed);
    }
    return printed;
  }

  // ============================================================
  //  AUCTION — billionaires + cash-rich corporations. See header.
  // ============================================================
  // M6 (sim/hyperinflation.js): the GALLOPING+/HYPER doom-loop closure — "bond
  // appetite -> ~0, auctions mostly unsold". Note the coupon itself already
  // saturates HIGH under runaway pi (COUPON_CEIL=250%, via PI_COEF above),
  // which makes the raw appetiteFor() formula below WANT to buy MORE, not
  // less — a real economics wrinkle (a rational nominal buyer chases the
  // yield) that the task brief's own read of real hyperinflation history says
  // doesn't happen: capital scarcity/distrust overwhelms the nominal coupon.
  // Rather than reshape this file's own, already-harnessed (M5, 98
  // assertions) coupon/appetite math to fight that, sim/hyperinflation.js's
  // stage machine applies an EXTERNAL multiplicative damp per country here —
  // the exact same "small guarded external lever" idiom sim/npcecon.js's own
  // adjustEmployedFrac/adjustEmployedFracForDistrict hooks already are for
  // city/polwar.js/city/civilwar.js. Ephemeral (NOT persisted): ANY reload
  // simply defaults every country back to damp=1 for a single day until
  // hyperinflation.js's own daily tick (which re-derives it fresh from the
  // country's — itself persisted — stage every single day, idempotently)
  // reasserts it; a harmless one-day grace period, same "self-heals next
  // tick" precedent every sim/* module's own ensureInit() already documents.
  let _appetiteDamp = Object.create(null);
  function dampOf(id) { const v = _appetiteDamp[id]; return (v != null && isFinite(v)) ? v : 1; }
  function setAppetiteDamp(id, mult) {
    if (!id) return 1;
    _appetiteDamp[id] = clamp01(finite(mult, 1));
    return _appetiteDamp[id];
  }
  function appetiteFor(coupon, riskFactor, countryId) {
    return clamp01((coupon - EARNINGS_YIELD_BASE) * APPETITE_SENS) * (riskFactor != null ? riskFactor : 1) * dampOf(countryId);
  }
  function runNpcAuction(series) {
    let remaining = series.face;
    const founders = (CBZ.billionaires && typeof CBZ.billionaires.founders === "function") ? CBZ.billionaires.founders() : [];
    for (let i = 0; i < founders.length && remaining > 0.5; i++) {
      const sid = founders[i].sid;
      const cash = cashOfSid(sid);
      if (cash < MIN_CASH_TO_BID) continue;
      const appetite = appetiteFor(series.coupon, riskFactorOf(sid), series.countryId);
      if (appetite <= 0) continue;
      const bid = Math.min(remaining, cash * BID_CASH_FRAC * appetite);
      if (bid < 1) continue;
      debitSidCash(sid, bid);
      series.holders[sid] = (series.holders[sid] || 0) + bid;
      remaining -= bid;
    }
    const corps = (CBZ.corps && typeof CBZ.corps.list === "function") ? CBZ.corps.list() : [];
    for (let i = 0; i < corps.length && remaining > 0.5; i++) {
      const co = corps[i];
      if (!co || co.bankrupt || !(co.cash > CORP_CASH_FLOOR)) continue;
      const appetite = appetiteFor(series.coupon, 1, series.countryId);
      if (appetite <= 0) continue;
      const bid = Math.min(remaining, co.cash * CORP_BID_FRAC * appetite);
      if (bid < 1) continue;
      if (!CBZ.corps.debitCash || !CBZ.corps.debitCash(co.id, bid)) continue;
      series.holders[co.id] = (series.holders[co.id] || 0) + bid;
      remaining -= bid;
    }
    return Math.max(0, remaining);
  }

  // ============================================================
  //  ISSUANCE
  // ============================================================
  function issueSeries(id, rec, st, day, signal) {
    const gap = Math.max(0, signal.floor - signal.treasury);
    const face = clampNum(
      Math.max(MIN_FACE, st.seedTreasury * MIN_FACE_FRAC),
      Math.max(MIN_FACE, st.seedTreasury * MAX_FACE_FRAC),
      Math.max(gap * GAP_MULT, st.seedTreasury * MIN_FACE_FRAC));
    const coupon = couponFor(id, st);
    const sid = "bnd" + (g.bondsState.nextSeriesId++);
    const series = {
      id: sid, countryId: id, face: face, coupon: coupon,
      issuedDay: day, maturityDay: day + TENOR_DAYS, printCheckDay: day + 1, printDone: false,
      holders: {}, status: "active", rollCount: 0,
    };
    g.bondsState.series[sid] = series;
    st.activeSeriesId = sid;
    const sold = face - runNpcAuction(series);
    // treasury credit = whatever was actually sold to real buyers this instant
    // (printing/shortfall resolution happens a day later — see checkPendingPrints)
    rec.treasury = (rec.treasury || 0) + sold;
    const rn = rec ? rec.name : id;
    if (CBZ.cityFlavor) CBZ.cityFlavor("🏛 " + rn + " issues a $" + Math.round(face).toLocaleString() + " bond series at " + (coupon * 100).toFixed(1) + "% — " + (sold >= face - 0.5 ? "fully subscribed" : "$" + Math.round(face - sold).toLocaleString() + " still on the table"), "#ffd76a");
    return series;
  }

  // ============================================================
  //  PENDING PRINT CHECK — one game-day after issuance, see header.
  // ============================================================
  function checkPendingPrints(day) {
    ensureInit();
    const S = g.bondsState.series;
    for (const sidKey in S) {
      const series = S[sidKey];
      if (series.status !== "active" || series.printDone || day < series.printCheckDay) continue;
      series.printDone = true;
      const unsold = Math.max(0, series.face - sumHolders(series.holders));
      if (unsold <= 0.5) continue;
      const rec = countryRec(series.countryId);
      const st = ensureCountry(series.countryId);
      if (!rec) continue;
      const printed = doPrint(series.countryId, rec, st, unsold, series.face, day);
      if (printed > 0) {
        series.holders.centralBank = (series.holders.centralBank || 0) + printed;
        if (CBZ.cityFlavor) CBZ.cityFlavor("🖨️ " + rec.name + "'s central bank prints $" + Math.round(printed).toLocaleString() + " to cover unsold debt.", "#ff9e6b");
      }
      const stillShort = unsold - printed;
      if (stillShort > 0.5 && CBZ.cityFlavor) {
        CBZ.cityFlavor("⚠️ " + rec.name + "'s auction fails to place $" + Math.round(stillShort).toLocaleString() + " — the treasury stays short.", "#ff6a5e");
      }
      // the print-check window has now closed for good (printDone latched
      // above): whatever stayed unfinanced never happened at all — it must
      // not linger as a phantom "still available" balance for the player's
      // buy() (or the exchange UI's own read) to snap up later. Locking
      // `face` down to the ACTUAL funded total (already exactly what every
      // debt/coupon/maturity calc elsewhere reads via sumHolders(), never
      // via `face` — see privateShare()) makes unsoldOf() correctly settle
      // at 0 from this point forward with no other call site needing to
      // know about the one-day window at all.
      series.face = sumHolders(series.holders);
    }
  }

  // ============================================================
  //  DEBT SERVICE — coupon (daily) + maturity (repay/roll) + default.
  // ============================================================
  // _payoutLog: a harness-only diagnostic ring (last 200 payouts), NOT part
  // of the public contract — mirrors every other sim/* module's own
  // `_state()`/`_dayTick` precedent for test-only introspection. Exists
  // because a holder's OBSERVED cash delta around a default can be
  // contaminated by an immediately-following event this same daily tick can
  // also trigger (e.g. a persisting deficit re-issuing a fresh series the
  // instant the old one clears — real, correct behavior, just noisy to
  // assert against from the outside) — reading the EXACT amount this file
  // itself credited, tagged by reason, is the deterministic ground truth.
  let _payoutLog = [];
  function logPayout(key, amt, reason, day) {
    _payoutLog.push({ key: key, amt: amt, reason: reason, day: day });
    if (_payoutLog.length > 200) _payoutLog.shift();
  }
  function holderPayout(key, amt, reason, day) {
    if (!(amt > 0)) return;
    if (key === "centralBank") return;                 // retires quietly — see header
    logPayout(key, amt, reason, day);
    if (key === "player") { if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(amt); else g.cash = (g.cash || 0) + amt; return; }
    if (isCorpId(key)) { if (CBZ.corps.creditRevenue) CBZ.corps.creditRevenue(key, amt); return; }
    creditSidCash(key, amt);                            // billionaire sid
  }
  function privateShare(holders) {
    // {key: amt} for every holder except centralBank — the slice that
    // actually needs real cash movement.
    const out = {}; let total = 0;
    for (const k in holders) { if (k === "centralBank") continue; const v = holders[k] || 0; if (v > 0) { out[k] = v; total += v; } }
    return { shares: out, total: total };
  }
  function defaultSeries(series, rec, st, day) {
    const priv = privateShare(series.holders);
    for (const key in priv.shares) {
      const recovery = priv.shares[key] * RECOVERY_FRAC;
      holderPayout(key, recovery, "default", day);
      series.holders[key] = 0;
    }
    series.status = "defaulted";
    if (st.activeSeriesId === series.id) st.activeSeriesId = null;
    st.distressScar = (st.distressScar || 0) + DEFAULT_SCAR;
    const ccy = rec && rec.currencyId;
    if (ccy && ccy !== "LBD" && CBZ.forex && typeof CBZ.forex.shock === "function") { try { CBZ.forex.shock(ccy, -DEFAULT_FX_SHOCK); } catch (e) {} }
    if (CBZ.approvalShock) { try { CBZ.approvalShock(series.countryId, DEFAULT_APPROVAL); } catch (e) {} }
    const rn = rec ? rec.name : series.countryId;
    if (CBZ.city && CBZ.city.big) CBZ.city.big("💥 " + rn.toUpperCase() + " DEFAULTS ON ITS DEBT");
    if (CBZ.cityFlavor) CBZ.cityFlavor("💥 " + rn + " defaults — bondholders take a " + Math.round((1 - RECOVERY_FRAC) * 100) + "% haircut.", "#ff3b3b");
  }
  function rollSeries(oldSeries, rec, st, day) {
    st.distressScar = (st.distressScar || 0) + ROLL_SCAR;
    updateDistress(oldSeries.countryId, rec, st);
    const coupon = couponFor(oldSeries.countryId, st);
    const sid = "bnd" + (g.bondsState.nextSeriesId++);
    const newSeries = {
      id: sid, countryId: oldSeries.countryId, face: sumHolders(oldSeries.holders), coupon: coupon,
      issuedDay: day, maturityDay: day + TENOR_DAYS, printCheckDay: day, printDone: true,
      holders: Object.assign({}, oldSeries.holders), status: "active", rollCount: (oldSeries.rollCount || 0) + 1,
    };
    g.bondsState.series[sid] = newSeries;
    oldSeries.status = "rolled";
    oldSeries.holders = {};
    st.activeSeriesId = sid;
    const rn = rec ? rec.name : oldSeries.countryId;
    if (CBZ.cityFlavor) CBZ.cityFlavor("🔄 " + rn + " can't repay at maturity — rolls $" + Math.round(newSeries.face).toLocaleString() + " into a fresh series at " + (coupon * 100).toFixed(1) + "%.", "#ff9e6b");
  }
  function handleMaturity(series, rec, st, day) {
    const priv = privateShare(series.holders);
    if (priv.total <= 0.5) { series.status = "matured"; if (st.activeSeriesId === series.id) st.activeSeriesId = null; return; }
    const avail = Math.max(0, rec.treasury || 0);
    if (avail >= priv.total) {
      rec.treasury = avail - priv.total;
      for (const key in priv.shares) { holderPayout(key, priv.shares[key], "maturity", day); series.holders[key] = 0; }
      series.status = "matured";
      if (st.activeSeriesId === series.id) st.activeSeriesId = null;
      const rn = rec ? rec.name : series.countryId;
      if (CBZ.cityFlavor) CBZ.cityFlavor("✅ " + rn + " repays $" + Math.round(priv.total).toLocaleString() + " at maturity in full.", "#7ed957");
    } else {
      rollSeries(series, rec, st, day);
    }
  }
  function serviceSeries(seriesId, rec, st, day) {
    const series = seriesRec(seriesId);
    if (!series || series.status !== "active") return;
    const priv = privateShare(series.holders);
    const couponDue = priv.total * series.coupon / 365;
    if (couponDue > 0.01) {
      let avail = Math.max(0, rec.treasury || 0);
      let paid = Math.min(avail, couponDue);
      rec.treasury = avail - paid;
      let shortfall = couponDue - paid;
      if (shortfall > 0.01) {
        const printed = doPrint(series.countryId, rec, st, shortfall, shortfall, day);
        if (printed > 0) {
          const avail2 = Math.max(0, rec.treasury || 0);
          const paid2 = Math.min(avail2, shortfall);
          rec.treasury = avail2 - paid2;
          paid += paid2;
          shortfall -= paid2;
        }
      }
      if (paid > 0.01 && priv.total > 0) {
        for (const key in priv.shares) holderPayout(key, priv.shares[key] * (paid / priv.total), "coupon", day);
      }
      if (shortfall > 0.01) { defaultSeries(series, rec, st, day); return; }
    }
    if (day >= series.maturityDay && series.status === "active") handleMaturity(series, rec, st, day);
  }

  // ============================================================
  //  DAILY TICK — see header's "DAILY TICK ORDER".
  // ============================================================
  function tickCountry(id, day) {
    const rec = countryRec(id);
    if (!rec) return;
    const st = ensureCountry(id);
    pushTreasuryHist(st, isFinite(rec.treasury) ? rec.treasury : 0);
    if (st.activeSeriesId) serviceSeries(st.activeSeriesId, rec, st, day);
    updateDistress(id, rec, st);
    if (!activeSeriesOf(id)) {
      const signal = deficitSignal(id, rec, st);
      if (signal.isDeficit) issueSeries(id, rec, st, day, signal);
    }
  }
  function dailyTick(day) {
    ensureInit();
    checkPendingPrints(day);
    const ids = countryIds();
    for (let i = 0; i < ids.length; i++) {
      try { tickCountry(ids[i], day); } catch (e) { try { console.error("[bonds] tickCountry failed for " + ids[i], e); } catch (e2) {} }
    }
  }
  let _dayTickRegistered = false;
  function ensureDayTickRegistered() {
    if (_dayTickRegistered) return;
    if (CBZ.onNewDay) { CBZ.onNewDay(dailyTick); _dayTickRegistered = true; }
  }

  // ============================================================
  //  PLAYER SURFACE — the exchange UI (city/phone.js's BONDS card).
  // ============================================================
  function unsoldOf(series) { return Math.max(0, series.face - sumHolders(series.holders)); }
  function list() {
    ensureInit();
    const out = [];
    const S = g.bondsState.series;
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    for (const sid in S) {
      const s = S[sid];
      if (s.status !== "active") continue;
      const rec = countryRec(s.countryId);
      out.push({
        id: s.id, countryId: s.countryId, countryName: rec ? rec.name : s.countryId,
        face: s.face, coupon: s.coupon, maturityDay: s.maturityDay,
        daysToMaturity: Math.max(0, s.maturityDay - day), available: unsoldOf(s),
        playerHolding: s.holders.player || 0,
      });
    }
    return out;
  }
  function buy(seriesId, amount) {
    amount = Math.max(0, Math.round(+amount || 0));
    const series = seriesRec(seriesId);
    if (!series || series.status !== "active") return { ok: false, reason: "no-such-series" };
    const available = unsoldOf(series);
    const take = Math.min(amount, available);
    if (!(take >= 1)) return { ok: false, reason: "unavailable" };
    const spend = (CBZ.city && CBZ.city.spend) ? CBZ.city.spend(take) : (function () {
      if ((g.cash || 0) < take) return false; g.cash -= take; return true;
    })();
    if (!spend) return { ok: false, reason: "cash", need: take };
    series.holders.player = (series.holders.player || 0) + take;
    const rec = countryRec(series.countryId);
    if (rec) rec.treasury = (rec.treasury || 0) + take;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityFeed) CBZ.cityFeed("🏛 You buy $" + take.toLocaleString() + " of " + (rec ? rec.name : series.countryId) + " bonds at " + (series.coupon * 100).toFixed(1) + "%.", "#7ed957");
    return { ok: true, amount: take, coupon: series.coupon, maturityDay: series.maturityDay };
  }
  function myHoldings() {
    ensureInit();
    const out = [];
    const S = g.bondsState.series;
    for (const sid in S) {
      const s = S[sid];
      const amt = s.holders.player || 0;
      if (amt > 0) out.push({ seriesId: s.id, countryId: s.countryId, amount: amt, coupon: s.coupon, maturityDay: s.maturityDay, status: s.status });
    }
    return out;
  }

  // ============================================================
  //  M6 DATA SEAMS — see header.
  // ============================================================
  // M6 (sim/hyperinflation.js): rescaleCountry(id, factor) — multiplies every
  // ACTIVE series' face + every holder's claim (player/billionaire/corp/
  // centralBank alike) by `factor`, for ANY country. ONE primitive, TWO
  // callers: redenomination passes factor=1/10^k (knock zeros off — a bond
  // claim stated in old-currency units shrinks exactly like every other
  // balance, conserving real value), dollarization passes factor=the market
  // conversion rate (a local-currency claim becomes its LBD-equivalent claim,
  // same conservation contract). Matured/defaulted/rolled series are already
  // closed (their holders are already zeroed by handleMaturity/defaultSeries/
  // rollSeries) so touching only "active" series is exhaustive, not a
  // narrowing. Returns the count of series touched (0 is a legitimate,
  // non-error result — a country with no outstanding debt).
  function rescaleCountry(countryId, factor) {
    ensureInit();
    factor = +factor;
    if (!(factor > 0) || !isFinite(factor)) return 0;
    const S = g.bondsState.series;
    let touched = 0;
    for (const sid in S) {
      const s = S[sid];
      if (!s || s.countryId !== countryId || s.status !== "active") continue;
      s.face = s.face * factor;
      for (const k in s.holders) s.holders[k] = (s.holders[k] || 0) * factor;
      touched++;
    }
    return touched;
  }
  function distressOf(id) { return ensureCountry(id).distress || 0; }
  function printedTotal(id, windowDays) {
    ensureInit();
    const st = g.bondsState.countries[id];
    if (!st) return 0;
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    const w = windowDays != null ? windowDays : PRINT_WINDOW_DAYS;
    const cutoff = day - w;
    let sum = 0;
    for (let i = 0; i < st.printedLog.length; i++) if (st.printedLog[i].day >= cutoff) sum += st.printedLog[i].amt;
    return sum;
  }

  CBZ.bonds = {
    list: list,
    buy: buy,
    myHoldings: myHoldings,
    debtOf: debtOf,
    distressOf: distressOf,
    printedTotal: printedTotal,
    // M6 (sim/hyperinflation.js) public hooks — see their own header comments.
    setAppetiteDamp: setAppetiteDamp,
    appetiteDampOf: dampOf,
    rescaleCountry: rescaleCountry,
    reset: reset,
    // harness/test-only hooks — not part of the public contract (mirrors
    // sim/centralbank.js's/sim/inflation.js's own _state()/_dayTick precedent).
    _state: function () { ensureInit(); return g.bondsState; },
    _dayTick: dailyTick,
    _seriesOf: function (countryId) { return activeSeriesOf(countryId); },
    _couponFor: function (countryId) { return couponFor(countryId, ensureCountry(countryId)); },
    _forceIssue: function (countryId, day) {
      const rec = countryRec(countryId); const st = ensureCountry(countryId);
      const signal = deficitSignal(countryId, rec, st);
      return issueSeries(countryId, rec, st, day != null ? day : (CBZ.worldDay ? CBZ.worldDay() : 0), signal);
    },
    _setDistress: function (countryId, v) { const st = ensureCountry(countryId); st.distress = clampNum(0, DIST_CAP, +v); return st.distress; },
    _payoutLog: function () { return _payoutLog.slice(); },
  };

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serialize() {
    ensureInit();
    const countries = {};
    for (const id in g.bondsState.countries) {
      const st = g.bondsState.countries[id];
      countries[id] = {
        seedTreasury: st.seedTreasury, treasuryHist: st.treasuryHist.slice(),
        distress: st.distress, distressScar: st.distressScar,
        printedLog: st.printedLog.slice(-200), activeSeriesId: st.activeSeriesId,
      };
    }
    const series = {};
    for (const sid in g.bondsState.series) {
      const s = g.bondsState.series[sid];
      series[sid] = {
        id: s.id, countryId: s.countryId, face: s.face, coupon: s.coupon,
        issuedDay: s.issuedDay, maturityDay: s.maturityDay, printCheckDay: s.printCheckDay, printDone: !!s.printDone,
        holders: Object.assign({}, s.holders), status: s.status, rollCount: s.rollCount || 0,
      };
    }
    return { v: 1, nextSeriesId: g.bondsState.nextSeriesId, countries: countries, series: series };
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1) return;
    g.bondsState.nextSeriesId = obj.nextSeriesId || 1;
    if (obj.countries) for (const id in obj.countries) {
      const src = obj.countries[id]; if (!src) continue;
      g.bondsState.countries[id] = {
        seedTreasury: isFinite(src.seedTreasury) ? +src.seedTreasury : 25000,
        treasuryHist: Array.isArray(src.treasuryHist) ? src.treasuryHist.slice(-ROLL_WINDOW_DAYS - 1) : [],
        distress: isFinite(src.distress) ? clampNum(0, DIST_CAP, +src.distress) : 0,
        distressScar: isFinite(src.distressScar) ? +src.distressScar : 0,
        printedLog: Array.isArray(src.printedLog) ? src.printedLog.slice(-200).filter(function (p) { return p && isFinite(p.day) && isFinite(p.amt); }) : [],
        activeSeriesId: src.activeSeriesId || null,
      };
    }
    if (obj.series) for (const sid in obj.series) {
      const src = obj.series[sid]; if (!src) continue;
      g.bondsState.series[sid] = {
        id: src.id || sid, countryId: src.countryId, face: +src.face || 0, coupon: isFinite(src.coupon) ? +src.coupon : COUPON_FLOOR,
        issuedDay: src.issuedDay || 0, maturityDay: src.maturityDay || 0,
        printCheckDay: src.printCheckDay != null ? src.printCheckDay : 0, printDone: !!src.printDone,
        holders: (src.holders && typeof src.holders === "object") ? Object.assign({}, src.holders) : {},
        status: src.status || "active", rollCount: src.rollCount || 0,
      };
    }
  }

  // ============================================================
  //  SINGLE-PLAYER PERSIST — sim/inflation.js's g.cityWorld pattern, verbatim.
  // ------------------------------------------------------------
  function stampBond() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.bond = serialize();
  }
  let _ensureBondSaveWraps_done = false;
  function ensureBondSaveWraps() {
    if (_ensureBondSaveWraps_done) return;
    _ensureBondSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._bondWrap) {
      const w = function () { stampBond(); return commit.apply(this, arguments); };
      w._bondWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._bondWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampBond(); return col.apply(this, arguments); };
      wc._bondWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.bond) apply(led.bond);
  }
  if (CBZ.onUpdate) {
    // next free slot after sim/inflation.js's 46.24 install tick — same
    // install-tick family every other P/E/M-wave save-wrap uses.
    CBZ.onUpdate(46.25, function () {
      if (!g) return;
      ensureDayTickRegistered();
      ensureBondSaveWraps();
      hydrateFromLedger();
    });
  }

  CBZ.bonds.serialize = serialize;
  CBZ.bonds.apply = apply;
})();
