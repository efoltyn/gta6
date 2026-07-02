/* ============================================================
   sim/forex.js — Stage M, step M2: THE FOREX MARKET.

   ============================================================
   SCOPE ADAPTATION (orchestrator decision, recorded here per the repo's own
   "adapt, don't silently narrow" convention — see city/polwar.js's header
   for the precedent this follows):

   BUILD-PLAN M2 as originally drafted read "Countries CRE/WMK registered;
   sim/forex.js rates...". That line dates from a MASTER-PLAN draft where
   Costa del Este/Westmark (CRE/WMK) were the ONLY other polities in the
   game. X3 shipped FIVE real top-level countries instead (city/countries.js:
   veridia/kesh/solara/mbeya + the republic), and M1 (sim/currency.js) already
   registered five currencies for exactly that roster (LBD/VDM/KSD/SOL/MBS) —
   see that file's own header for the identical reasoning. Costa del Este and
   Westmark remain, today, republic STATES (city/polity.js's buildRecords()),
   not countries; promoting them into CBZ.polity country records and minting
   CRE/WMK would (a) contradict X3's own registry, (b) double up on the
   republic's own LBD (Costa/Westmark territory already transacts in LBD),
   and (c) isn't what M1 built currencies FOR. So: M2 here is "sim/forex.js
   over the five currencies M1 already registered, plus the player-facing
   exchange" — CRE/WMK are NOT created. If a future wave ever does split
   Costa/Westmark into real countries (polity.js's own header already flags
   this as a possible M-stage move via re-parenting `parent` ids), that wave
   registers CRE/WMK in currency.js and this file's FOREIGN_CCYS/CCY_META
   tables grow by two rows — nothing here has to change shape.

   ============================================================
   THE RATE CONVENTION — every quote is "how many LBD is 1 unit of this
   currency worth" (a real-world-style FX quote, LBD the domestic numeraire,
   LBD's own "rate" is always exactly 1.0 — no float drift possible for the
   number the player's own currency reads as). This direction was picked
   (over "how many foreign units per LBD") because it makes BOTH the wealth
   scaling AND the anarchism floor read exactly as worded in the design
   brief without any inversion math at the call sites:
     - "poorer -> weaker unit" = a low-wealth country's rate is a SMALL LBD
       value (mbeya's MBS: ~$0.006 → invert for flavor and it prices out at
       ~178 MBS per dollar, "hundreds per dollar" exactly as asked).
     - "anarchism floors at 0.05x the wealth-implied rate" is a literal
       `rate = wealthImplied * 0.05` — no reciprocal needed.
   CBZ.forex.rate(from, to) still answers the more useful cross-rate
   question ("how many `to` do I get for 1 `from`") for conversion math.

   ============================================================
   THE MODEL — one seeded LCG stream, own tick, DAILY cadence (CBZ.onNewDay,
   polity.js's day-wrap subscriber) — NOT the hourly econstate/market/stocks
   cadence. Chosen and documented here because (a) the design brief's own
   ±8%/day clamp then falls out for free as "this tick's move", no day-open-
   rate bookkeeping needed to convert an hourly clamp into a daily one, and
   (b) a ~30-sample rolling history reads as roughly a month of daily closes
   on a phone sparkline — far more legible for a currency than 30 HOURS would
   be. (M3/M4/M5/M6 are all free to add a finer hourly nudge later without
   reshaping this file — the daily step is the anchor tick, not a hard
   architectural wall.)

   Per foreign currency, per day:
     base0(wealth)   = 10^(5*wealth - 3.5)   — the wealth-implied par rate
                       (documented worked examples in the header above;
                       spans ~178 MBS/$ at mbeya's .25 wealth down to a firm
                       $5.62/VDM at veridia's .85 — see WEALTH SCALING below).
     pppTerm         = repPriceIndex / countryPriceIndex (clamped .2-5): a
                       country inflating faster than the republic (its
                       EconState priceIndex — the per-country capital
                       jurisdictions X3/countries.js seeds — rising relative
                       to libertyville's) sees its currency's LBD value fall.
     carryTerm       = 1 + 1.5*(countryPolicyRate - repPolicyRate): reads
                       CBZ.centralbank && CBZ.centralbank.rate(id) with a
                       NEUTRAL_POLICY_RATE (5%) fallback on BOTH sides — M3
                       isn't built yet, so this is exactly 1.0 (no effect,
                       no distortion) until centralbank.js ships real policy
                       rates; zero forex-side edits needed that day.
     confidenceTerm  = CONF_FLOOR + (1-CONF_FLOOR)*confidence, confidence
                       (0..1, 1=calm) docked for: active war (CBZ.polwar.
                       warsOf), active civil-war fracture (CBZ.civilwar.
                       fractureOf), continuous unrest (CBZ.civilwar.unrest),
                       emergencyRule govType, approval<30 (CBZ.polity
                       record), and an active refugee outflow wave
                       (CBZ.migration.wavesOf() — "heavy emigration" reads
                       as a live war/famine-driven wave, not routine
                       day-to-day emigration under an open-border policy).
     target          = base0 * pppTerm * carryTerm * confidenceTerm (or, for
                       a country IN anarchism right now, `base0 * 0.05` flat
                       — anarchism dominates every other term while it holds).
     rate            ← rate*(1 + REVERT*(target/rate - 1) + momentum), then
                       CLAMPED to ±8% of yesterday's close (MAX_DAILY_MOVE) —
                       "readable, not chaotic".
     momentum        ← momentum*0.6 + seededNoise (trend-followers riding
                       the last few days' direction; same shape as sim/
                       stocks.js's momentum term, different cadence).

   VOLATILITY EVENTS — detected as STATE-TRANSITION EDGES (this-day's flag
   vs. yesterday's stored flag), not by hooking polwar.js/civilwar.js/
   regimes.js internals (zero edits to any of those three files):
     - war declared (wasn't at war yesterday, is today)   → shock -10%..-25%
     - war ends                                            → shock +3%..+8%
       (partial recovery — mean-reversion carries the rest over subsequent
       days as confidence/PPP normalize, never a full instant bounce-back)
     - civil-war fracture begins / ends                    → same two shocks
     - ANARCHISM ONSET → an instant SNAP to `base0*0.05` (not a graduated
       shock — "order itself has broken down", no smooth landing) held
       there (small damped noise only) until govType leaves "anarchism"
     - anarchism ENDS → a relief-bounce shock (+5%..+10%), then ordinary
       mean-reversion pulls the rest of the way back over subsequent days.
   A "shock" (CBZ.forex.shock(id, frac), also the internal primitive above)
   multiplies the rate DIRECTLY and BYPASSES the ±8%/day clamp — a real
   devaluation event isn't a smooth process, only day-to-day fundamentals
   drift is capped. This is also the public hook M5 (bond-market panics) /
   M6 (counterfeiting collapse, Soros-style speculative runs) wire into with
   zero further forex.js edits.

   ============================================================
   CONVERSION — CBZ.forex.convert(from, to, amount, venue): debits `from`
   via CBZ.currency.walletTake (refuses if short — never overdraws), credits
   `to` via CBZ.currency.walletAdd, and NEVER MINTS VALUE: the traded
   amount's LBD-equivalent value is computed once (`amount * rate(from)`),
   a real spread fee is skimmed off THAT LBD value (not re-derived on the
   `to` side, which would double-count), and the remainder is what gets
   converted at the live cross-rate. valueLBD == netLBD (credited) +
   feeLBD (booked) — always, exactly, checked by the harness.
     SPREAD: 3% at airport counters, 1.5% at the exchange desk (tighter —
     it's the "professional" venue).
   FEE BOOKING — "the spread is a real fee that goes SOMEWHERE" (repo's
   honest-money rule): the design brief says book it to "the republic's
   exchange corporation if one exists from E-wave, else the country
   treasury". Checked sim/stocks.js's E6/E7 roster (sim/corporations.js's
   COMPANIES table) for an exchange-operator company — there isn't one:
   Goldspire Trust (GLD) is a property REIT, unrelated to currency dealing,
   and MASTER-PLAN VI.6's own plan to retag it `shopKind:"exchange"` was
   never implemented (city/citytemplates.js still tags it plain "bank";
   grep confirms no `shopKind==="exchange"` read anywhere in src/). So: the
   fee is booked to CBZ.polity.get("republic").treasury (already
   LBD-denominated per M1's own documented convention) — both venues this
   wave physically sit on republic soil (the airport, the mainland bank
   lot), so the republic IS the real-world operator collecting the spread.

   ============================================================
   PLAYER VENUES — two stations, one shared panel (SPREAD is the only thing
   that differs between them):
     - AIRPORT FX COUNTER: a small kiosk prop dropped just past the four
       check-in desks in city/island_airport.js's terminal (tx=-40, tz=24,
       tw=150, td=26 — copied verbatim from that file's buildTerminal(),
       same "copy the coordinates, note the source" precedent city/polity.js
       already used for GOLDSPIRE_RECT/CAPEHARBOR_RECT/etc. — island_airport.js
       itself is NOT edited).
     - EXCHANGE DESK: MASTER-PLAN VI.6 wanted this inside "the existing
       GOLDSPIRE TRUST bank prefab retagged shopKind:exchange" — since that
       retag never shipped (see FEE BOOKING above), there is no distinct
       "exchange" building to anchor to yet. Adaptation: the desk piggybacks
       on the ONE real, physically-built bank branch that exists today —
       city/bank.js's Meridian Trust lobby (queried read-only via the public
       CBZ.cityBankLot() getter that file already exports for exactly this
       kind of external anchor; bank.js itself is NOT edited) — a small desk
       prop dropped just outside its footprint. When a later wave finally
       ships a real per-country exchange building, this desk is a ~10-line
       relocation, not a redesign.
   Both stations follow the established interact-prompt idiom (city/bank.js's
   ATM/teller/loan-desk stations: a `stations` array of {x,z,reach}, a
   per-frame nearest-in-reach picker, a floating "[E] ..." prompt, keydown
   captures [E]/Escape) — SIMPLIFIED from that file's version: no facing-dot
   requirement (these are single free-standing props, not room corners you
   could be facing away from at arm's reach) and no per-frame visibility
   distance-gating on the geometry itself (a kiosk + a desk is a handful of
   boxes — cheap enough to just always be there, unlike the bank's full
   3-fixture lobby). The panel itself is a plain document.body-appended div
   (bank.js's loan-panel pattern) listing the 4 foreign currencies with
   buy/sell buttons at the venue's live spread and the player's own wallet
   balance per currency (CBZ.currency.walletGet).

   PHONE — city/phone.js's MARKETS app already has the clean "read-only rows
   + tiny inline sparkline" seam (E3's rows()/summary() split, E6/E7's
   stock-detail sparkline). Added a sibling "💱 CURRENCY EXCHANGE" card,
   read-only (no buy/sell in the phone — trading is a real-venue verb, per
   the design brief), reusing the exact row/sparkline/card idiom.

   ============================================================
   SIM COUPLINGS — CHEAP WHERE CLEAN, DEFERRED WHERE NOT (recorded, not
   silently dropped):
     - migration.js's wage-gap term (computePropensity's `wageGap =
       activityOf(to) - activityOf(from)`) is NOT wired through forex this
       wave: `activity` is a dimensionless EconState index (~1.0 =
       equilibrium), not a wage figure denominated in any currency — there
       is no real "wage in LBD/VDM/KSD/..." number anywhere in the codebase
       yet for forex to multiply against. Multiplying a unitless index by an
       FX rate has no dimensional meaning; inventing a real per-country wage
       figure just to wire this is out of scope for a forex-rates wave.
       Deferred to whichever future wave gives EconState a real local-
       currency wage/price level (M4's inflation work is the natural home).
     - polwar.js's reparations disbursement (tickDrips(): `payerRec.treasury
       -= amt; payeeRec.treasury += amt;`) treats both treasuries as the
       same unit today — technically wrong once two different countries'
       treasuries are truly different currencies, but NOT touched this
       wave: converting it is a real edit to polwar.js's war-economy core
       (not a forex.js change), and the task's own instruction is explicit
       that the goal is "no invasive rewrite this wave" — p8harness already
       asserts exact reparations-flow behavior against the CURRENT
       same-unit-transfer code, and risking that 70-assertion suite for a
       2-line conversion outside this file's declared scope is the wrong
       trade. Documented here as the exact spot (polwar.js's tickDrips, the
       `S.reparations` drip loop) a future wave wires
       `CBZ.forex.rate(payerCcy, payeeCcy)` into.

   ============================================================
   PERSISTENCE — WORLD state (shared economy, not per-player), so it rides
   BOTH riders every other sim/P-wave module does:
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() carry
       serialize()/apply() as blob.fx (edited there, right beside blob.mig/
       blob.cwar).
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own guard
       flag _fxWrap, the exact one-shot-install pattern every P/E-wave file
       already uses) so g.cityWorld.fx rides the localStorage ledger.
   Fresh-run reset: city/peds.js's spawnCityPeds() resets CBZ.forex right
   beside CBZ.stocks.reset() (both are "fresh city -> re-seed" sim/* resets).

   LOAD ORDER: index.html loads this immediately after sim/currency.js (the
   BUILD-PLAN's own instruction — "?v=cur1", same version bucket as
   currency.js) — BEFORE city/countries.js/polity.js/polwar.js/civilwar.js/
   migration.js even exist yet. That's fine: this file only DEFINES
   functions and registers one CBZ.onNewDay callback at parse time; every
   cross-module read inside that callback (CBZ.polwar.warsOf, CBZ.civilwar.
   fractureOf, CBZ.migration.wavesOf, CBZ.polity.get, CBZ.econState.get) is
   guarded (`typeof X === "function"`) and only actually CALLED once real
   gameplay ticks fire, long after every script on the page has loaded —
   the same "guarded optional read, resolved at call time not parse time"
   convention city/countries.js's own econstate-seeding tick already uses.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  if (!g) return;

  function num(n, d) { n = +n; return isFinite(n) ? n : (d || 0); }
  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }
  function clamp01(v) { return clampNum(0, 1, v); }

  // ============================================================
  //  THE ROSTER — the 4 foreign currencies M1 registered (LBD is the
  //  numeraire and needs no rate record of its own).
  // ============================================================
  const CCY_META = {
    VDM: { countryId: "veridia" },
    KSD: { countryId: "kesh" },
    SOL: { countryId: "solara" },
    MBS: { countryId: "mbeya" },
  };
  const FOREIGN_CCYS = ["VDM", "KSD", "SOL", "MBS"];
  // wealthOf() fallback — used only if CBZ.polity hasn't registered the
  // country yet (very early boot / a trimmed harness); mirrors city/
  // countries.js's own wealthLevel numbers verbatim so the initial-rate
  // spread is identical either way.
  const FALLBACK_WEALTH = { veridia: 0.85, kesh: 0.35, solara: 0.6, mbeya: 0.25 };

  // ============================================================
  //  TUNING (all constants in one place, per repo convention)
  // ============================================================
  const RATE_FLOOR = 0.00005;          // never let a rate hit exactly 0 (division safety)
  const INITIAL_WEALTH_COEF = 5, INITIAL_WEALTH_OFFSET = -3.5;  // rate0(wealth) = 10^(coef*wealth+offset) — see header worked examples
  const PPP_CLAMP_LO = 0.2, PPP_CLAMP_HI = 5;
  const CARRY_COEF = 1.5;
  const NEUTRAL_POLICY_RATE = 0.05;    // M3 fallback on both sides -> carryTerm stays exactly 1.0 this wave
  const CONF_FLOOR = 0.25;             // worst-case (non-anarchic) confidence still leaves 25% of baseline value
  const CONF_WAR = 0.30, CONF_FRACTURE = 0.35, CONF_UNREST_COEF = 0.25;
  const CONF_EMERGENCY = 0.15, CONF_APPROVAL_T = 30, CONF_APPROVAL_COEF = 0.20, CONF_WAVE = 0.15;
  const REVERT = 0.12;                 // /day mean-reversion toward target
  const MOM_DECAY = 0.6;
  const NOISE_AMPL = 0.01;             // seeded daily noise amplitude
  const MAX_DAILY_MOVE = 0.08;         // "readable, not chaotic" — ±8%/day clamp on the CONTINUOUS term only
  const WAR_SHOCK_MIN = 0.10, WAR_SHOCK_RANGE = 0.15;      // -10%..-25%
  const RECOVERY_MIN = 0.03, RECOVERY_RANGE = 0.05;        // +3%..+8% (partial — never a full instant bounce)
  const ANARCHY_FLOOR_MULT = 0.05;
  const ANARCHY_RECOVERY_MIN = 0.05, ANARCHY_RECOVERY_RANGE = 0.05;  // +5%..+10% relief bounce on exit
  const HIST_CAP = 30;                 // ~a month of daily closes
  const MOM_TREND_EPS = 0.0015;        // stocks.js's own trend-arrow threshold, reused
  const SPREAD = { airport: 0.03, desk: 0.015 };

  // own seeded LCG (never Math.random — repo convention for world state), a
  // distinct seed from every other sim/* stream so none of them correlate.
  const INITIAL_SEED = 482163897 & 0x7fffffff;
  let _seed = INITIAL_SEED;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // ============================================================
  //  CROSS-MODULE READS — every one guarded, resolved at CALL time (see
  //  header's LOAD ORDER note).
  // ============================================================
  function wealthOf(countryId) {
    const rec = (CBZ.polity && CBZ.polity.get) ? CBZ.polity.get(countryId) : null;
    if (rec && isFinite(rec.wealthLevel)) return clamp01(rec.wealthLevel);
    return FALLBACK_WEALTH[countryId] != null ? FALLBACK_WEALTH[countryId] : 0.5;
  }
  // capIdFor(countryId) -> the EconState jurisdiction id for that country's
  // capital settlement (mirrors city/relations.js's own private
  // capitalEconIdFor() — not exported there, so reimplemented here; small,
  // self-contained, same read pattern).
  function capIdFor(countryId) {
    if (countryId === "republic") return (CBZ.econState && CBZ.econState.DEFAULT_ID) || "libertyville";
    const cd = (CBZ.COUNTRIES || []).find(function (c) { return c.id === countryId; });
    if (!cd) return null;
    const cap = (cd.settlements || []).find(function (s) { return s.capital; });
    return cap ? cap.id : null;
  }
  function econPI(id) {
    if (!id || !CBZ.econState || typeof CBZ.econState.get !== "function") return 1.0;
    const st = CBZ.econState.get(id);
    return (st && isFinite(st.priceIndex)) ? st.priceIndex : 1.0;
  }
  // M3 seam: CBZ.centralbank.rate(id) doesn't exist yet — neutral fallback
  // on both sides means carryTerm is exactly 1.0 until it does.
  function policyRateOf(id) {
    if (CBZ.centralbank && typeof CBZ.centralbank.rate === "function") {
      const r = CBZ.centralbank.rate(id);
      if (isFinite(r)) return r;
    }
    return NEUTRAL_POLICY_RATE;
  }

  // ============================================================
  //  INITIAL RATE — wealth-implied par value (LBD terms). See header for
  //  the worked examples (mbeya ~$0.0056 -> ~178 MBS/$; veridia ~$5.62/VDM).
  // ============================================================
  function rate0(wealth) {
    wealth = clamp01(isFinite(wealth) ? wealth : 0.5);
    return Math.pow(10, INITIAL_WEALTH_COEF * wealth + INITIAL_WEALTH_OFFSET);
  }

  // ============================================================
  //  STATE — g.forexState.rates[ccy] = {rate, momentum, history[], prevWar,
  //  prevFracture, prevAnarchic}
  // ============================================================
  function freshRow(ccyId) {
    const wealth = wealthOf(CCY_META[ccyId].countryId);
    const r0 = rate0(wealth);
    // M6 (sim/hyperinflation.js): `delisted` — dollarization's "currency
    // delists from forex (rate frozen/removed from active set — keep
    // history)". A frozen row is simply skipped by dayTick/list() below;
    // quote()/history() still resolve it on purpose (keep history readable).
    return { rate: r0, momentum: 0, history: [r0], prevWar: false, prevFracture: false, prevAnarchic: false, delisted: false };
  }
  function reset() {
    _seed = INITIAL_SEED;
    const rates = {};
    for (let i = 0; i < FOREIGN_CCYS.length; i++) rates[FOREIGN_CCYS[i]] = freshRow(FOREIGN_CCYS[i]);
    g.forexState = { rates: rates };
  }
  function ensureInit() {
    if (!g.forexState || !g.forexState.rates || typeof g.forexState.rates !== "object") { reset(); return; }
    // idempotent partial-heal (mirrors sim/stocks.js's lazy-listing precedent):
    // a currency somehow missing (future roster growth, a stale save) gets
    // seeded fresh rather than throwing.
    for (let i = 0; i < FOREIGN_CCYS.length; i++) {
      const id = FOREIGN_CCYS[i];
      if (!g.forexState.rates[id]) g.forexState.rates[id] = freshRow(id);
    }
  }
  function pushHist(st, v) {
    st.history.push(v);
    if (st.history.length > HIST_CAP) st.history.shift();
  }
  // applyShockOn: the internal primitive — direct multiply, BYPASSES the
  // daily clamp (a real devaluation/relief event isn't a smooth process; see
  // header). Feeds a decaying echo into momentum so the trend continues for
  // a few days after the jolt, same "shock nudges momentum" idea sim/
  // stocks.js's own shock() uses, just applied to rate directly here too
  // (a currency event needs to be felt NOW, not two ticks from now).
  function applyShockOn(st, frac) {
    st.rate = Math.max(RATE_FLOOR, st.rate * (1 + frac));
    st.momentum += frac * 0.3;
  }

  // ============================================================
  //  THE DAILY STEP — one currency.
  // ============================================================
  function stepCurrency(ccyId, repPI, repPolicyRate) {
    const meta = CCY_META[ccyId];
    const st = g.forexState.rates[ccyId];
    const countryId = meta.countryId;
    const wealth = wealthOf(countryId);
    const rec = (CBZ.polity && CBZ.polity.get) ? CBZ.polity.get(countryId) : null;
    const govType = rec ? rec.govType : "democracy";
    const approval = (rec && isFinite(rec.approval)) ? rec.approval : 55;
    const capId = capIdFor(countryId);
    const countryPI = econPI(capId);

    const warActive = !!(CBZ.polwar && typeof CBZ.polwar.warsOf === "function" && CBZ.polwar.warsOf(countryId).length);
    const fractureActive = !!(CBZ.civilwar && typeof CBZ.civilwar.fractureOf === "function" && CBZ.civilwar.fractureOf(countryId));
    const unrest = (CBZ.civilwar && typeof CBZ.civilwar.unrest === "function") ? clamp01(CBZ.civilwar.unrest(countryId)) : 0;
    const waveActive = !!(CBZ.migration && typeof CBZ.migration.wavesOf === "function" && CBZ.migration.wavesOf()[countryId]);
    const anarchic = govType === "anarchism";

    const base0 = rate0(wealth);

    // ---- EDGE-TRIGGERED VOLATILITY EVENTS (transitions since yesterday) ----
    if (anarchic && !st.prevAnarchic) {
      st.rate = Math.max(RATE_FLOOR, base0 * ANARCHY_FLOOR_MULT);  // instant collapse — no smooth landing
      st.momentum = -0.05;
    }
    if (!anarchic && st.prevAnarchic) applyShockOn(st, ANARCHY_RECOVERY_MIN + rng() * ANARCHY_RECOVERY_RANGE);
    if (warActive && !st.prevWar) applyShockOn(st, -(WAR_SHOCK_MIN + rng() * WAR_SHOCK_RANGE));
    if (!warActive && st.prevWar) applyShockOn(st, RECOVERY_MIN + rng() * RECOVERY_RANGE);
    if (fractureActive && !st.prevFracture) applyShockOn(st, -(WAR_SHOCK_MIN + rng() * WAR_SHOCK_RANGE));
    if (!fractureActive && st.prevFracture) applyShockOn(st, RECOVERY_MIN + rng() * RECOVERY_RANGE);
    st.prevWar = warActive; st.prevFracture = fractureActive; st.prevAnarchic = anarchic;

    // ---- CONTINUOUS TARGET: PPP x carry x confidence ----
    const pppRatio = clampNum(PPP_CLAMP_LO, PPP_CLAMP_HI, (countryPI > 0 && repPI > 0) ? repPI / countryPI : 1);
    const countryPolicyRate = policyRateOf(countryId);
    const carryTerm = 1 + CARRY_COEF * (countryPolicyRate - repPolicyRate);

    let conf = 1.0;
    if (warActive) conf -= CONF_WAR;
    if (fractureActive) conf -= CONF_FRACTURE;
    conf -= CONF_UNREST_COEF * unrest;
    if (govType === "emergencyRule") conf -= CONF_EMERGENCY;
    if (approval < CONF_APPROVAL_T) conf -= CONF_APPROVAL_COEF * clamp01((CONF_APPROVAL_T - approval) / CONF_APPROVAL_T);
    if (waveActive) conf -= CONF_WAVE;
    conf = clamp01(conf);
    const confMult = CONF_FLOOR + (1 - CONF_FLOOR) * conf;

    const target = anarchic
      ? Math.max(RATE_FLOOR, base0 * ANARCHY_FLOOR_MULT)
      : Math.max(RATE_FLOOR, base0 * pppRatio * carryTerm * confMult);

    // ---- mean-reversion + momentum + noise, clamped ±8%/day ----
    st.momentum = st.momentum * MOM_DECAY + (rng() - 0.5) * NOISE_AMPL * (anarchic ? 0.4 : 1);
    const prev = st.rate;
    let raw = prev * (1 + REVERT * (target / prev - 1) + st.momentum);
    raw = Math.max(RATE_FLOOR, raw);
    const lo = prev * (1 - MAX_DAILY_MOVE), hi = prev * (1 + MAX_DAILY_MOVE);
    raw = Math.max(lo, Math.min(hi, raw));
    st.rate = raw;

    pushHist(st, st.rate);
  }

  function dayTick() {
    ensureInit();
    const repPI = econPI((CBZ.econState && CBZ.econState.DEFAULT_ID) || "libertyville");
    const repPolicyRate = policyRateOf("republic");
    for (let i = 0; i < FOREIGN_CCYS.length; i++) {
      const id = FOREIGN_CCYS[i];
      if (g.forexState.rates[id] && g.forexState.rates[id].delisted) continue;   // M6: frozen, see delist()
      try { stepCurrency(id, repPI, repPolicyRate); }
      catch (e) { try { console.error("[forex] dayTick failed for " + id, e); } catch (e2) {} }
    }
  }
  // CBZ.onNewDay is city/polity.js's own function — polity.js loads LATER
  // than this file (see header's LOAD ORDER note), so it does NOT exist yet
  // at this parse-time call. Deferred: the persistence install tick below
  // (which DOES run after every script has loaded, since it only fires once
  // real gameplay ticks start) registers this subscriber once, the same
  // "resolved at call time, not parse time" idiom the rest of this file uses.
  let _dayTickRegistered = false;
  function ensureDayTickRegistered() {
    if (_dayTickRegistered) return;
    if (CBZ.onNewDay) { CBZ.onNewDay(dayTick); _dayTickRegistered = true; }
  }

  // ============================================================
  //  READS
  // ============================================================
  function rateLBD(id) {
    if (!id || id === "LBD") return 1.0;
    ensureInit();
    const st = g.forexState.rates[id];
    return st ? st.rate : 1.0;
  }
  // rate(from, to) -> how many `to` you get for 1 `from` (spread-free quote
  // math — rate(a,b)*rate(b,a) === 1 exactly, by construction).
  function rate(from, to) {
    from = from || "LBD"; to = to || "LBD";
    if (from === to) return 1.0;
    const a = rateLBD(from), b = rateLBD(to);
    return b > 0 ? a / b : 0;
  }
  function trendOf(momentum) {
    return momentum > MOM_TREND_EPS ? "up" : (momentum < -MOM_TREND_EPS ? "down" : "flat");
  }
  function quote(ccyId) {
    ensureInit();
    if (ccyId === "LBD") return { id: "LBD", rate: 1, momentum: 0, trend: "flat", history: [1, 1] };
    const st = g.forexState.rates[ccyId];
    if (!st) return null;
    return { id: ccyId, rate: st.rate, momentum: st.momentum, trend: trendOf(st.momentum), history: st.history.slice() };
  }
  function list() {
    ensureInit();
    const out = [];
    for (let i = 0; i < FOREIGN_CCYS.length; i++) {
      const id = FOREIGN_CCYS[i];
      if (g.forexState.rates[id] && g.forexState.rates[id].delisted) continue;   // M6: removed from the active set, see delist()
      const q = quote(id); if (q) out.push(q);
    }
    return out;
  }
  function history(ccyId) {
    const q = quote(ccyId);
    return q ? q.history : [];
  }

  // ============================================================
  //  CONVERSION — see header for the fee-booking rationale (republic
  //  treasury; no exchange-operator company exists to own it instead).
  // ============================================================
  function bookFee(feeLBD) {
    if (!(feeLBD > 0)) return;
    const rep = (CBZ.polity && CBZ.polity.get) ? CBZ.polity.get("republic") : null;
    if (rep) rep.treasury = (rep.treasury || 0) + feeLBD;
  }
  function convert(from, to, amount, venue) {
    ensureInit();
    from = from || "LBD"; to = to || "LBD";
    amount = +amount;
    if (!(amount > 0)) return { ok: false, reason: "amount" };
    if (!CBZ.currency || typeof CBZ.currency.walletGet !== "function") return { ok: false, reason: "no-currency" };
    if (from === to) return { ok: false, reason: "same-currency" };
    const have = CBZ.currency.walletGet(from);
    if (have < amount) return { ok: false, reason: "insufficient", have: have };

    const spread = SPREAD[venue] != null ? SPREAD[venue] : SPREAD.airport;
    const rFrom = rateLBD(from), rTo = rateLBD(to);
    const valueLBD = amount * rFrom;
    const feeLBD = valueLBD * spread;
    const netLBD = valueLBD - feeLBD;
    const got = rTo > 0 ? netLBD / rTo : 0;

    if (!CBZ.currency.walletTake(from, amount)) return { ok: false, reason: "insufficient" };
    CBZ.currency.walletAdd(to, got);
    bookFee(feeLBD);

    return { ok: true, got: got, fee: feeLBD, feeCurrency: "LBD", rate: rTo > 0 ? rFrom / rTo : 0, venue: venue || "airport", spread: spread };
  }
  // public shock hook — the internal primitive above, exposed for external
  // callers (M5 bond-panic contagion, M6 Soros-run/counterfeit-collapse
  // events) with zero further forex.js edits.
  function shock(ccyId, frac) {
    ensureInit();
    const st = g.forexState.rates[ccyId];
    if (!st || !isFinite(frac)) return false;
    applyShockOn(st, frac);
    pushHist(st, st.rate);
    return true;
  }
  // ============================================================
  //  M6 (sim/hyperinflation.js) PUBLIC HOOKS
  // ============================================================
  // delist(ccyId, flag=true) — dollarization: the currency stops moving
  // (dayTick/list() above both skip it) but quote()/history() keep resolving
  // it so a save/UI can still show "this used to be VDM" after the fact.
  // Idempotent, reversible (flag=false re-lists it) though M6 never actually
  // calls it that way — documented as the seam a future re-issue wave would
  // use (see sim/hyperinflation.js's own dollarization header for why
  // reversal is out of scope this wave).
  function delist(ccyId, flag) {
    ensureInit();
    const st = g.forexState.rates[ccyId];
    if (!st) return false;
    st.delisted = flag !== false;
    return true;
  }
  function isDelisted(ccyId) {
    ensureInit();
    const st = g.forexState.rates[ccyId];
    return !!(st && st.delisted);
  }
  // rescale(ccyId, factor) — redenomination's "forex rate ×= 10^k (real rate
  // unchanged)": a straight multiply of the live rate AND every history
  // sample (so a phone sparkline doesn't show a fake cliff the instant the
  // zeros come off) — never routed through applyShockOn (that's a REAL
  // devaluation/relief event; this is pure unit relabeling, no economic
  // content, so momentum is deliberately left untouched).
  function rescale(ccyId, factor) {
    ensureInit();
    const st = g.forexState.rates[ccyId];
    if (!st || !(factor > 0) || !isFinite(factor)) return false;
    st.rate = Math.max(RATE_FLOOR, st.rate * factor);
    for (let i = 0; i < st.history.length; i++) st.history[i] = Math.max(RATE_FLOOR, st.history[i] * factor);
    return true;
  }

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serialize() {
    ensureInit();
    const out = { v: 1, rates: {} };
    for (let i = 0; i < FOREIGN_CCYS.length; i++) {
      const id = FOREIGN_CCYS[i], st = g.forexState.rates[id];
      out.rates[id] = {
        rate: st.rate, momentum: st.momentum, history: st.history.slice(),
        prevWar: !!st.prevWar, prevFracture: !!st.prevFracture, prevAnarchic: !!st.prevAnarchic,
        delisted: !!st.delisted,
      };
    }
    return out;
  }
  function apply(obj) {
    if (!obj || obj.v !== 1) return;
    reset();
    if (obj.rates) for (let i = 0; i < FOREIGN_CCYS.length; i++) {
      const id = FOREIGN_CCYS[i], src = obj.rates[id];
      if (!src || !isFinite(src.rate)) continue;
      const st = g.forexState.rates[id];
      st.rate = Math.max(RATE_FLOOR, +src.rate);
      st.momentum = isFinite(src.momentum) ? +src.momentum : 0;
      st.history = Array.isArray(src.history) ? src.history.slice(-HIST_CAP) : [st.rate];
      st.prevWar = !!src.prevWar; st.prevFracture = !!src.prevFracture; st.prevAnarchic = !!src.prevAnarchic;
      st.delisted = !!src.delisted;
    }
  }

  CBZ.forex = {
    FOREIGN_CCYS: FOREIGN_CCYS.slice(),
    SPREAD: SPREAD,
    rate: rate,
    quote: quote,
    list: list,
    history: history,
    convert: convert,
    shock: shock,
    delist: delist,
    isDelisted: isDelisted,
    rescale: rescale,
    serialize: serialize,
    apply: apply,
    reset: reset,
    // harness/test-only hooks — not part of the public contract (mirrors
    // regimes.js's own _forceGov / polwar.js's own _forceDesperate precedent).
    _dayTick: dayTick, _state: function () { ensureInit(); return g.forexState; }, _rate0: rate0,
  };

  // ============================================================
  //  SINGLE-PLAYER PERSIST — sim/stocks.js's g.cityWorld pattern, verbatim:
  //  stamp before the existing commit/collect save hooks run, hydrate back
  //  out whenever that ledger object's REFERENCE changes. Own guard flag
  //  (_fxWrap), the P5 chain-growth one-shot install fix every P/E-wave file
  //  already uses.
  // ------------------------------------------------------------
  function stampFx() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.fx = serialize();
  }
  let _ensureFxSaveWraps_done = false;
  function ensureFxSaveWraps() {
    if (_ensureFxSaveWraps_done) return;
    _ensureFxSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._fxWrap) {
      const w = function () { stampFx(); return commit.apply(this, arguments); };
      w._fxWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._fxWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampFx(); return col.apply(this, arguments); };
      wc._fxWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedFxLedger = null;
  function hydrateFxFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedFxLedger) return;
    _hydratedFxLedger = led;
    if (led.fx) apply(led.fx);
  }
  if (CBZ.onUpdate) {
    // next free slot after city/civilwar.js's own 46.21 install tick — same
    // install-tick family, and by the time this frame's tick runs, civilwar's
    // own rehydrate has already settled for the same ledger swap.
    CBZ.onUpdate(46.22, function () {
      if (!g) return;
      ensureDayTickRegistered();
      ensureFxSaveWraps();
      hydrateFxFromLedger();
    });
  }

  // ============================================================
  //  PLAYER VENUES — airport FX counter + exchange desk. Headless-safe: the
  //  ENGINE above is fully live without THREE; everything past this guard is
  //  fixtures + interact-prompt UI only (mirrors city/bank.js's own
  //  engine/fixtures split).
  // ============================================================
  if (!window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;

  const REACH = 3.2;
  const V = {
    arena: null, group: null, built: false, deskBuilt: false, stations: [],
    cur: null, prompt: null, lastTxt: "", panel: null, panelOpen: false, venue: "airport", msg: "",
  };

  let VM = null;
  function vmats() {
    if (VM) return VM;
    VM = {
      kiosk: CBZ.cmat(0x2c4a3a),
      kioskFace: CBZ.cmat(0x16241c),
      screen: CBZ.cmat(0x5bffb0, { emissive: 0x2a8a5e, ei: 0.6 }),
      desk: CBZ.cmat(0x3a2c20),
      deskTop: CBZ.cmat(0xcaa64a),
    };
    return VM;
  }
  function vtag(text, color, sx, sy) {
    if (!CBZ.makeLabelSprite) return null;
    const s = CBZ.makeLabelSprite(text, { color: color || "#bcffe0" });
    s.scale.set(sx || 1.8, sy || 0.44, 1);
    return s;
  }
  function vbox(w, h, d, mat) {
    const m = new THREE.Mesh(CBZ.boxGeom(w, h, d), mat);
    m.castShadow = false; m.receiveShadow = false;
    return m;
  }

  // AIRPORT terminal footprint — copied verbatim from city/island_airport.js's
  // own buildTerminal() constants (tx=-40, tz=24, tw=150, td=26, so the
  // building spans x∈[-115,35] z∈[11,37]; see that file's header for the
  // FOOTPRINT numbers) — same "copy the coordinates, note the source"
  // precedent city/polity.js's GOLDSPIRE_RECT/etc. already used;
  // island_airport.js itself is NOT edited. The 4 check-in desks run at
  // dx = tx-tw/2+20+k*30 = -95,-65,-35,-5 (z=34) — this kiosk continues that
  // exact line as a "5th desk" (k=4 -> dx=25), still inside the terminal's
  // own interior margin (ix1 = tx+tw/2-4 = 31).
  const AIRPORT_KIOSK = { x: 25, z: 34 };

  function buildAirportKiosk(root) {
    const m = vmats(), p = AIRPORT_KIOSK;
    const body = vbox(3.2, 1.15, 0.9, m.kiosk);
    body.position.set(p.x, 0.58, p.z);
    root.add(body);
    const face = vbox(2.6, 0.5, 0.06, m.kioskFace);
    face.position.set(p.x, 1.25, p.z - 0.42);
    root.add(face);
    const scr = vbox(0.4, 0.26, 0.04, m.screen);
    scr.position.set(p.x, 1.28, p.z - 0.46);
    root.add(scr);
    if (CBZ.colliders) CBZ.colliders.push({ minX: p.x - 1.7, maxX: p.x + 1.7, minZ: p.z - 0.55, maxZ: p.z + 0.55, y0: 0, y1: 1.3 });
    const lab = vtag("CURRENCY EXCHANGE", "#9fffce", 2.8, 0.44);
    if (lab) { lab.position.set(p.x, 2.0, p.z); root.add(lab); }
    return { x: p.x, z: p.z };
  }
  // exchange desk: piggybacks on the mainland bank lot's public position
  // getter (city/bank.js's CBZ.cityBankLot(), read-only, bank.js not edited)
  // — see header for why there's no distinct "exchange" building to anchor
  // to yet. Sits just outside the branch's east wall.
  function buildExchangeDesk(root, lot) {
    const m = vmats();
    const w = (lot.building && lot.building.w) || 10;
    const x = lot.cx + w / 2 + 3, z = lot.cz;
    const desk = vbox(1.6, 0.78, 0.9, m.desk);
    desk.position.set(x, 0.39, z);
    root.add(desk);
    const top = vbox(1.68, 0.06, 0.98, m.deskTop);
    top.position.set(x, 0.79, z);
    root.add(top);
    const scr = vbox(0.4, 0.3, 0.05, m.screen);
    scr.position.set(x, 0.98, z);
    root.add(scr);
    if (CBZ.colliders) CBZ.colliders.push({ minX: x - 0.9, maxX: x + 0.9, minZ: z - 0.55, maxZ: z + 0.55, y0: 0, y1: 0.85 });
    const lab = vtag("EXCHANGE DESK", "#bcd0ff", 2.3, 0.42);
    if (lab) { lab.position.set(x, 1.55, z); root.add(lab); }
    return { x: x, z: z };
  }

  // self-healing ensure() (gunstore/bank.js precedent): airport kiosk is
  // static-coordinate and builds as soon as an arena exists; the desk polls
  // each frame until city/bank.js's own lazy lobby build has landed (bank.js
  // builds ITS lot lazily too — see that file's own ensure()).
  function ensure() {
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena) return false;
    if (V.arena !== arena) {
      V.arena = arena; V.built = false; V.deskBuilt = false; V.group = null; V.stations = []; V.cur = null;
    }
    const root = arena.root || CBZ.scene;
    if (!V.group) { V.group = new THREE.Group(); root.add(V.group); }
    if (!V.built) {
      const kp = buildAirportKiosk(V.group);
      V.stations.push({ kind: "airport", venue: "airport", x: kp.x, z: kp.z, reach: REACH, label: "Airport FX Counter" });
      V.built = true;
    }
    if (!V.deskBuilt) {
      const bankLot = CBZ.cityBankLot ? CBZ.cityBankLot() : null;
      if (bankLot) {
        const dp = buildExchangeDesk(V.group, bankLot);
        V.stations.push({ kind: "desk", venue: "desk", x: dp.x, z: dp.z, reach: REACH, label: "Exchange Desk" });
        V.deskBuilt = true;
      }
    }
    return true;
  }

  // ---- nearest-in-reach picker (SIMPLIFIED from bank.js's facing-dot
  // version — see header: these are single free-standing props, not room
  // corners, so plain distance is enough).
  function pickStation() {
    const P = CBZ.player;
    if (!P) return null;
    const px = P.pos.x, pz = P.pos.z;
    let best = null, bestD = Infinity;
    for (let i = 0; i < V.stations.length; i++) {
      const st = V.stations[i];
      const dd = Math.hypot(st.x - px, st.z - pz);
      if (dd > st.reach) continue;
      if (dd < bestD) { bestD = dd; best = st; }
    }
    return best;
  }

  function fmtRate(r) { return r >= 1 ? r.toFixed(2) : r.toFixed(4); }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  function promptText(st) {
    const spread = SPREAD[st.venue] != null ? SPREAD[st.venue] : SPREAD.airport;
    return "<b style='color:#5bffb0'>[E]</b> " + st.label + " <span style='color:#7f8794'>· " + Math.round(spread * 100) + "% spread</span>";
  }
  function promptEl() {
    if (V.prompt) return V.prompt;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "fxPrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:46;display:none;" +
      "background:rgba(13,16,21,.9);border:1px solid #3a4150;border-radius:12px;padding:7px 14px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:15px;pointer-events:auto;cursor:pointer;text-align:center;max-width:78vw";
    d.addEventListener("click", function () { if (V.cur) openPanel(V.cur.venue); });
    document.body.appendChild(d);
    V.prompt = d;
    return d;
  }
  function showPrompt(txt) {
    const el = promptEl(); if (!el) return;
    if (txt !== V.lastTxt) { el.innerHTML = txt; V.lastTxt = txt; }
    if (el.style.display !== "block") el.style.display = "block";
  }
  function hidePrompt() {
    if (V.prompt && V.prompt.style.display !== "none") V.prompt.style.display = "none";
    V.cur = null;
  }

  // ---- the trade panel --------------------------------------------------
  function panelEl() {
    if (V.panel) return V.panel;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "fxPanel";
    d.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;" +
      "background:rgba(13,16,21,.96);border:1px solid #2c4a3a;border-radius:16px;padding:16px 18px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;width:min(420px,88vw);box-shadow:0 18px 60px rgba(0,0,0,.6)";
    document.body.appendChild(d);
    V.panel = d;
    return d;
  }
  function renderPanel() {
    const el = V.panel; if (!el) return;
    const spread = SPREAD[V.venue] != null ? SPREAD[V.venue] : SPREAD.airport;
    let html = "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:6px'>" +
      "<div style='font-weight:800;font-size:16px'>💱 " + (V.venue === "desk" ? "Exchange Desk" : "Airport FX Counter") + "</div>" +
      "<div style='font-size:11px;color:#7f8794'>" + Math.round(spread * 100) + "% spread</div></div>";
    html += "<div style='font-size:12px;color:#9fb0c8;margin-bottom:10px'>Wallet — " + fmt$(CBZ.currency ? CBZ.currency.walletGet("LBD") : 0) + " LBD</div>";
    const rows = list();
    rows.forEach(function (r) {
      const bal = CBZ.currency ? CBZ.currency.walletGet(r.id) : 0;
      const sellN = Math.max(0, Math.min(100, Math.floor(bal)));
      html += "<div style='background:rgba(255,255,255,.04);border-radius:10px;padding:9px 11px;margin-bottom:7px'>" +
        "<div style='display:flex;justify-content:space-between;align-items:baseline'>" +
        "<span style='font-weight:700;font-size:14px'>" + r.id + "</span>" +
        "<span style='color:#9fb0c8;font-size:12px'>1 " + r.id + " = $" + fmtRate(r.rate) + "</span></div>" +
        "<div style='font-size:11px;color:#7f8794;margin:2px 0 7px'>You hold " + bal.toFixed(2) + " " + r.id + "</div>" +
        "<div style='display:flex;gap:6px'>" +
        "<button data-fx='buy' data-ccy='" + r.id + "' style='flex:1;cursor:pointer;background:#1e7a44;border:1px solid #2a9c58;color:#eafff0;border-radius:8px;padding:6px;font-family:inherit'>Buy $100</button>" +
        "<button data-fx='sell' data-ccy='" + r.id + "' style='flex:1;cursor:pointer;background:#7a2c2c;border:1px solid #9c3a3a;color:#ffeaea;border-radius:8px;padding:6px;font-family:inherit' " +
        (sellN <= 0 ? "disabled" : "") + ">Sell " + sellN + "</button>" +
        "</div></div>";
    });
    if (V.msg) html += "<div style='font-size:11px;color:#ffd166;margin:2px 0 8px'>" + V.msg + "</div>";
    html += "<button data-fxclose='1' style='width:100%;cursor:pointer;background:#2b3340;border:1px solid #3a4150;color:#e8eef7;border-radius:10px;padding:8px;font-family:inherit'>Close [E]/[Esc]</button>";
    el.innerHTML = html;
    el.querySelectorAll("[data-fx]").forEach(function (b) {
      b.onclick = function () {
        const ccy = b.getAttribute("data-ccy"), action = b.getAttribute("data-fx");
        V.msg = "";
        let res = null;
        if (action === "buy") res = convert("LBD", ccy, 100, V.venue);
        else {
          const bal = CBZ.currency ? CBZ.currency.walletGet(ccy) : 0;
          const amt = Math.min(100, bal);
          if (amt > 0.005) res = convert(ccy, "LBD", amt, V.venue);
          else res = { ok: false, reason: "insufficient" };
        }
        if (res && !res.ok) V.msg = res.reason === "insufficient" ? "Not enough funds." : "Trade failed.";
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
        renderPanel();
      };
    });
    const cl = el.querySelector("[data-fxclose]");
    if (cl) cl.onclick = closePanel;
  }
  function openPanel(venue) {
    const el = panelEl(); if (!el) return;
    V.panelOpen = true; V.venue = venue || "airport"; V.msg = "";
    CBZ.cityMenuOpen = true;
    renderPanel();
    el.style.display = "block";
    if (typeof document !== "undefined" && document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function closePanel() {
    V.panelOpen = false;
    if (V.panel) V.panel.style.display = "none";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }

  // ---- per-frame: drive the prompt (no distance-gating on the geometry
  // itself — a kiosk + a desk is cheap enough to just always be there).
  CBZ.onUpdate(38.45, function () {
    if (!g || g.mode !== "city") { hidePrompt(); if (V.panelOpen) closePanel(); return; }
    if (!ensure()) return;
    if (V.panelOpen) { hidePrompt(); return; }
    if (g.state !== "playing" || CBZ.cityMenuOpen || (CBZ.player && (CBZ.player.driving || CBZ.player.dead))) { hidePrompt(); return; }
    const st = pickStation();
    if (!st) { hidePrompt(); return; }
    V.cur = st;
    showPrompt(promptText(st));
  });

  // [E] opens/acts; Escape/E closes (bank.js's exact capture-phase pattern
  // so this wins the key over interact.js's bubble listener).
  addEventListener("keydown", function (e) {
    const k = (e.key || "").toLowerCase();
    if (V.panelOpen) { if (k === "escape" || k === "e") { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); e.stopPropagation(); closePanel(); } return; }
    if (!V.cur || !g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.player && (CBZ.player.driving || CBZ.player.dead))) return;
    if (k !== "e") return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.stopPropagation();
    openPanel(V.cur.venue);
  }, true);
})();
