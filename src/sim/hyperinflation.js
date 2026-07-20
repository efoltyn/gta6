/* ============================================================
   sim/hyperinflation.js — Stage M, step M6: HYPERINFLATION (final money step).

   BUILD-PLAN M6 (verbatim): "Hyperinflation stages + doom loop + redenomination/
   dollarization endings; Soros runs + counterfeiting." MASTER-PLAN's money
   section (verbatim, the piece this file lands): "The hyperinflation doom
   loop, staged (stable <5%/yr -> elevated -> crisis >50%/yr -> hyper
   >50%/month): deficit -> print -> π up -> confidence down -> FX depreciation
   -> import prices up -> wider real deficit -> more printing. Stage effects
   escalate from weekly repricing, to cash-in-advance shops and dollarization
   onset..., to barter and black-market money-changer NPCs. Endings:
   austerity..., redenomination..., or full dollarization... Sustained
   hyperinflation is a standalone hard trigger in the regime-transition graph
   — a failing currency is one of the strongest president-killers in the
   game." Plus: "counterfeiting as the one player-controlled inflation lever"
   and "Soros runs — player sell orders feed the herding term, so you can
   genuinely break a weak currency."

   NEW FILE (BUILD-PLAN's own instruction: "index.html — after bonds.js").
   M1-M5 built the doom loop piece by piece (currency -> forex -> central
   bank -> π equation -> bond auctions/printing); this file is the FIRST one
   that reads across ALL FIVE of them at once to name what stage a country
   is actually IN, and the only one that ever ENDS the story for a currency.
   Every mechanic below rides an EXISTING seam — this file adds a small
   number of new, narrowly-scoped public hooks to its five siblings (each
   documented in THAT file's own header) rather than reimplementing anything.

   ============================================================
   STAGES — g.hyperState.countries[countryId] = {stage, upDays, downDays,
   hyperDays, controlsActive, dollarized, dollarizedDay, redenomCount,
   lastEndingDay, endings[]}. Four stages, HYSTERESIS BANDS (an ENTER
   threshold above the EXIT threshold for every non-terminal stage, plus a
   minimum SUSTAIN of consecutive qualifying days before the ladder actually
   climbs) so a π oscillating right at a boundary can't flap the stage back
   and forth every tick — the exact "no flapping" contract the task brief
   demands, verified by m6harness.js's own boundary-oscillation test:
     CREEPING   π < 25%/yr (normal; the M4 seed drift, 2%/yr, lives here)
     WARNING    enter: π>25%/yr OR sim/bonds.js's own distressOf(id)>1.2,
                sustained 5 days. exit: π<15%/yr AND distress<=1.2, sustained
                3 days (back to CREEPING).
     GALLOPING  enter: π>100%/yr, sustained 5 days. exit: π<70%/yr, sustained
                3 days (back to WARNING).
     HYPER      enter: π>500%/yr, sustained 1 day (the terminal stage climbs
                fast once crossed — no reason to make the player wait once
                it's unambiguous). exit: π<350%/yr, sustained 3 days (back to
                GALLOPING).
   Every threshold reads sim/inflation.js's OWN public rate(id) (already
   PI_CEIL=2000%/yr per that file's own M6-forward-compat note) — this file
   adds zero new π computation, only a state machine ON TOP of the existing
   number.

   ============================================================
   STAGE SYMPTOMS (applied once per day, sim/hyperinflation.js's own
   CBZ.onNewDay tick — registered to run AFTER sim/bonds.js's (next free
   install slot, so this reads the SAME day's already-serviced/issued/printed
   figures, one day fresher than waiting for tomorrow)):
     WARNING (edge only): headline, a small forex.shock() confidence knock
       (skipped for the republic — LBD never floats against itself, the same
       guard every M-wave file already uses), a small CBZ.approvalShock()
       misery nudge.
     GALLOPING (edge + daily): bigger edge shock/approval hit; DAILY: sim/
       bonds.js's own NEW setAppetiteDamp(id, 0.35) — the doom-loop closure
       (see DOOM LOOP below) — and, for ANY govType (not just authoritarian
       ones — "regardless of ideology", per the task brief), price controls
       ACTIVATE (see PRICE CONTROLS below). Cohort savings erosion and food-
       riot-via-hunger are DELIBERATELY not re-implemented here — see DOOM
       LOOP's own "verified, not re-plumbed" note.
     HYPER (edge + daily): terminal-stage banner; DAILY: sim/bonds.js's
       setAppetiteDamp(id, 0.10) (auctions go mostly unsold — the doom loop's
       tightest turn), capital flight (a small daily forex.shock(), billion-
       aires/corporations "dumping the currency" — skipped for LBD), a bank
       run (sim/centralbank.js's NEW shrinkDeposits(id, 0.03)/day — a REAL
       credit-cap bite, not just flavor text, plus a periodic feed line), and
       a small daily CBZ.approvalShock() drag ("mass misery... the X6b fuse
       hot" — this IS the unrest channel: city/civilwar.js's own uprising gate
       already reads `rec.approval < APPROVAL_T` directly, so a HYPER-driven
       approval collapse feeds that EXISTING gate with zero new civilwar.js
       code — civilwar.js exposes no direct "nudge unrest" setter at all
       (only a computed unrest(id) READ), so per the task brief's own
       instruction ("at most a direct unrest nudge... IF ONE EXISTS") none is
       added here; approval is the real, existing lever this file uses
       instead).

   ============================================================
   PRICE CONTROLS — "a hyperinflating country may impose them regardless of
   ideology, briefly suppressing measured π while shortages raise hunger —
   the classic lie" (task brief, verbatim). TWO existing levers, no new
   plumbing:
     1. sim/inflation.js's NEW setControlsFactor(id, 0.6) — multiplies the
        DISPLAYED pi at every one of that file's own public reads (rate/
        rateForJurisdiction/summary/tickerLine) by 0.6 while active (see that
        file's own header for the full rationale). Because sim/bonds.js's
        coupon pricing, city/approval.js's anti-incumbent term, and the phone
        CPI ticker all call THOSE exact functions, the suppression ripples
        through every one of them for free — the bond market underprices the
        country's real risk, the president's approval hit is muted, the
        ticker lies — all from ONE multiplier. sim/centralbank.js's own
        `_inflationTerm` hook is the one documented exception (reads
        inflation.js's raw internal pi directly, not through rate()) so the
        bank's own rate decisions stay grounded in the truth even under a
        controls regime, same as a real institution's internal models would.
     2. REPUBLIC ONLY (sim/npcecon.js/systems/hunger.js's cohort model is
        mainland-only, per M4/X2's own documented scoping — no per-country
        cohort registry exists elsewhere to hook): sim/npcecon.js's EXISTING
        adjustEmployedFrac() hook (already public, already city/polwar.js's
        own conscription lever) takes a one-time -5-point hit on controls
        ACTIVATION and a symmetric +5-point release on DEACTIVATION —
        "shortages disrupt commerce" stands in for a real stock/shortage
        model this codebase doesn't have (sim/market.js's own setControls()
        header already documents that gap: "Controlled prices ALSO cutting
        shop STOCK has no home yet"). Lower employedFrac -> lower cohort
        income -> lower food spend -> systems/hunger.js's OWN existing ratio
        math reads hungerAvg DOWN — the exact "shortages raise hunger" chain,
        using zero new misery plumbing.
   Both toggle together, driven by ONE idempotent per-day check ("does the
   CURRENT stage want controls on?") rather than edge-only firing — this is
   what makes "removal snaps π back" and controls surviving a reload both
   fall out for free: on reload, sim/inflation.js's own controlsFactor rides
   its own blob.inf rider unchanged, and this file's OWN next daily tick
   re-derives the SAME answer from the (also persisted) stage, so nothing
   double-fires or drifts.

   ============================================================
   DOOM LOOP — deficit -> unsold auction -> printing -> π higher -> higher
   yields demanded -> bigger deficits: M4/M5 ALREADY wired this in full (sim/
   inflation.js's printingPassThroughTerm reads sim/bonds.js's printedTotal;
   sim/bonds.js's couponFor reads sim/inflation.js's rate) — this file adds
   NOTHING to that closed loop except the ONE new lever the task brief calls
   out by name: bond appetite collapsing under GALLOPING+ (see sim/bonds.js's
   own header for why the EXISTING appetiteFor() formula alone doesn't
   produce this — a saturating-high coupon actually looks MORE attractive
   nominally, the opposite of real hyperinflation-era capital flight/distrust
   — setAppetiteDamp() is the external correction). The CAPTURED-vs-
   INDEPENDENT-bank divergence the task brief asks to assert is likewise
   ALREADY the exact shape of sim/bonds.js's own doPrint() (an independent
   bank refuses more than ~20% of a series' face; a captured one prints the
   rest) composed with sim/centralbank.js's own independence table
   (democracy 0.8 vs dictatorship 0.2) — m6harness.js's own "two divergent
   60-day runs" test exercises this EXISTING divergence directly, adding no
   new code, per the task brief's own "verify... no new plumbing" framing.
   Real-wage squeeze / cohort savings erosion / food riots are likewise
   ALREADY-BUILT M4/X2 chains (sim/npcecon.js's wageIndex lag chasing
   priceLevel; systems/hunger.js's own ratio math) — this file's own harness
   asserts they keep amplifying at HYPER-stage π, not that they're rebuilt.

   ============================================================
   ENDINGS — triggered from this file's own daily tick (any country
   sustained in HYPER for ENDING_HYPER_SUSTAIN_DAYS days, past a per-country
   cooldown, a seeded daily roll so it doesn't fire the INSTANT the window
   closes) OR called directly (redenominate()/dollarize() are both public,
   same "automatic AND harness-callable" precedent city/civilwar.js's own
   fracture()/_forceUprising() split already sets). Republic (LBD is the
   numeraire — nothing to dollarize INTO) always redenominates; every other
   country picks by govType: dictatorship/fascism/communism/monarchy
   redenominate ("keeps the printing press" — the task brief's own framing);
   democracy/emergencyRule/insurgency/anything else dollarizes.

   REDENOMINATION DESIGN CHOICE (the task brief's own explicit fork —
   "mutate the rate + wallet balances in place... OR register a successor
   currency... pick ONE, justify"): MUTATE IN PLACE. A successor-currency
   registration would mean sim/currency.js's CURRENCIES table (today a fixed,
   hand-authored 5-row registry with zero "register a NEW currency for an
   EXISTING country" precedent anywhere) growing a synthetic "VDM2"-style row
   every time a country redenominates — multiple times over a long run, per
   the task brief's own "Argentina lesson" (a redenomination without genuine
   tightening re-accelerates and can redenominate AGAIN) — which would leave
   every OTHER file that keys off a country's currency (sim/bonds.js's coupon
   pricing, sim/centralbank.js's currency-defense term, sim/forex.js's own
   FOREIGN_CCYS/CCY_META tables) needing to resolve "the country's CURRENT
   currency" through an extra indirection layer for a case that changes
   nothing about WHO holds the money, only how many zeros it's written with.
   Mutating in place — priceLevel /= 10^k (sim/inflation.js's own new
   redenominate()), every holder's balance /= 10^k (this file's own
   orchestration below, touching sim/currency.js's wallet/bankWallet live
   maps, sim/bonds.js's new rescaleCountry() for outstanding bond claims, and
   — LBD only — sim/corporations.js's co.cash/sim/billionaires.js's ledger
   cash), forex rate ×= 10^k (sim/forex.js's new rescale()) — is a same-day,
   same-currency-id operation: every consumer's existing "resolve this
   country's currency" call site keeps working, unedited, forever. CONSERVED
   EXACTLY: every holder's real (post-conversion) value equals their
   pre-conversion value to the cent, except the country's OWN treasury,
   which additionally pays a small REDENOM_COST administrative fee (a real,
   documented, honest expenditure — the "IMF-less bootstrap" case: if the
   treasury can't cover it, the zeros come off anyway, unpaid, no debit) —
   m6harness.js asserts conservation for every OTHER holder class to the
   cent and treasury's own conservation net of the fee.

   CREDIBILITY: paired with GENUINE TIGHTENING (independent bank — snapshot's
   own independence >= 0.5 — AND a POSITIVE REAL policy rate, both read live)
   -> sim/inflation.js's new applyCredibilityBump() cuts pi immediately, once.
   Absent that (the common case — a captured bank keeps printing right
   through the redenomination), NOTHING touches pi at all: the same pressure
   terms that produced the runaway π before still produce it after, so pi
   re-targets right back up over the following days with zero extra code —
   "the Argentina lesson" falls out of NOT calling a function, not from a
   special-cased re-acceleration branch.

   DOLLARIZATION: the country adopts the LBD outright. rec.currencyId flips
   to "LBD" (city/polity.js's own record field — ALREADY the field sim/
   bonds.js/sim/centralbank.js/sim/inflation.js all read directly for their
   own "skip FX-float-dependent behavior for LBD" guards, so flipping it is
   simultaneously "delist from forex" for every one of those three files, for
   free — this file's own explicit sim/forex.js.delist() call additionally
   freezes the RATE ROW itself, since a player can still hold the old
   currency in their wallet/at a kiosk and that specific instrument needs to
   stop moving even though nothing reads rec.currencyId to check). Every
   balance in the old currency converts to LBD AT THE LIVE MARKET RATE on
   conversion day (sim/forex.js's own quote(), no spread — a sovereign
   conversion, not a discretionary FX-desk trade), conserved exactly. The
   central bank goes DORMANT (sim/centralbank.js's new setDormant() — reuses
   the anarchism-suspension code path verbatim: `suspended=true`, rate
   frozen, creditCap()->0, but INDEPENDENT of govType, a permanent monetary
   event not a regime change). sim/inflation.js's new setAlias(id,"republic")
   makes rate(id)/priceLevel(id) track the republic's own numbers from that
   day forward ("π := the republic's π thereafter", verbatim). Approval: a
   small immediate recovery bump (relief that the bleeding stops) plus a
   slow ONGOING per-day drag applied by THIS file's own daily tick for as
   long as `dollarized` holds ("nationalists at home resent it" — a
   relations-flavored, approval-channel-only implementation; no new
   relations.js plumbing). REVERSIBILITY: explicitly OUT OF SCOPE this wave —
   a later wave's "redenomination-style re-issue" (mint a brand-new local
   currency, reverse setAlias/setDormant/delist) is a real, documented,
   un-built future seam, not a silent gap.

   ============================================================
   SOROS RUNS — a MULTI-DAY state machine (g.hyperState.soros[countryId]),
   triggered when a country is (a) non-republic, (b) GALLOPING+, (c) its
   central bank's OWN last policy move was a HIKE (sim/centralbank.js's
   snapshot().lastMove>0 — "visibly defends", the exact M3 defensive-hike
   stance the task brief names) and NOT dormant, (d) sim/bonds.js's own
   distressOf(id) reads high ("weak fundamentals" — the same distress state
   already driving that file's own coupon premium), gated by a seeded daily
   chance + a cooldown. The speculator is a real billionaire founder (sim/
   billionaires.js's founders(), reusing THIS file's own per-sid pick — sim/
   bonds.js's own riskFactorOf() is a private, non-exported hash, so a fresh
   deterministic pick is used here instead, same "small enough to duplicate"
   precedent every M-wave file's own header already sets) who stakes real
   cash upfront (debited immediately — a genuine short position, not a paper
   bet). Over ATTACK_DAYS: sustained sell pressure (sim/forex.js's own public
   shock() hook, one small hit per day — the exact "M6 Soros-style
   speculative run" seam that file's own header names by name) while the
   country tries to defend (spends a real slice of treasury AND needs its
   policy rate above a real threshold EVERY day; a day meeting both counts
   FOR the defense, a day missing either counts AGAINST). At the window's
   close:
     HOLDS (net non-negative across the window) -> the speculator's staked
       cash is simply gone (never returned) — a real, booked loss, a headline.
     BREAKS -> a real 20-40% gap-down shock (sim/forex.js's own shock(),
       bypassing the ±8%/day continuous-drift clamp exactly as that file's
       header says a real devaluation event should), the speculator's stake
       is returned PLUS a profit funded by a REAL debit from the country's
       OWN treasury (an honest transfer — never minted; capped at whatever
       the treasury actually has), sim/centralbank.js's new
       scarIndependence() permanently knocks the credibility floor down a
       notch (same one-way-ratchet contract decree()'s own floor already
       uses), and a real CBZ.approvalShock() lands on the president.
   PLAYER RIDING (no new UI — the task brief's own explicit call, matching
   its "no new UI required" framing for this exact mechanic): city/civilwar.js
   and sim/forex.js's own player-facing venues (the airport kiosk + exchange
   desk, M2) already let the player hold and convert ANY foreign currency at
   the live rate. A player who sells (converts to LBD) a shaky currency
   BEFORE a break and buys it back AFTER profits mechanically through the
   EXISTING sim/forex.js convert() math alone — m6harness.js's own test
   proves the round-trip nets more units of the currency post-crash than
   pre-crash (net of the desk's own spread), with zero code added for it.

   ============================================================
   COUNTERFEITING — "the one player-controlled inflation lever" (verbatim).
   SEAM CHOSEN (the task brief's own instruction: "ride the existing gig/
   crime machinery... document the design chosen"): city/wealth.js's own
   "HIGH-STAKES OPPORTUNITIES" OPS array (stake -> odds -> a heat/wanted-star
   bump on the SAME g.wanted/CBZ.cityForceStars channel every other op
   already uses) is the closest existing template for "a player-triggered,
   heat-bearing underworld action with a real payout" — but its UI/render()/
   cooldown-string plumbing lives entirely inside that file's own closure
   (OP_BY_ID, runOp(), the empire panel's own row renderer), and wiring a new
   row into it risks that file's own existing tests for a feature this wave
   doesn't need a full panel for. SMALLEST VIABLE SEAM instead: a
   PROGRAMMATIC underworld offer, this file's own counterfeit(countryId) —
   mints fresh bills at a COUNTERFEIT_DISCOUNT (65 cents of usable value per
   printed dollar — "at a discount", per the task brief) straight into the
   player's multi-currency wallet (sim/currency.js's walletAdd() — already
   the same "dirty until laundered" pool city/wealth.js's own launderAll()
   treats every wallet-LBD dollar as being in, so an LBD counterfeit batch is
   ALREADY launderable through that file's EXISTING seam with zero edits
   here; a foreign-currency batch has no laundering seam in this codebase at
   all — spending it is flagged as-is, undocumented risk, same as any other
   foreign cash) with a REAL heat bump (g.wanted/CBZ.cityForceStars, the same
   channel city/wealth.js's own runOp() failure branch already uses) and a
   seeded bust chance (confiscation + extra heat on a bad roll). No new phone
   UI this wave — documented, same "no new UI required" call the Soros-run
   section above already makes; a future wave wiring a literal underworld-gig
   button is a thin UI layer over this exact function, not a redesign.
   CONFIDENCE EXTERNALITY: counterfeitPressure(countryId) (a decaying 0..1
   pool, bumped by every successful run) feeds TWO existing channels — sim/
   inflation.js's own new counterfeitTerm (a small extra π pressure term,
   the exact "printingPassThroughTerm" idiom that file's own header already
   documents for sim/bonds.js, reused verbatim for a second, later-loading
   sibling) and a small direct sim/forex.js shock() while the pool is
   materially active ("lowering confidence" directly, not only through the π
   channel). Kept SMALL per the task brief's own instruction — a working
   seam, not a heist questline: one function, one cooldown, one pool.

   ============================================================
   PERSISTENCE — OWN rider (blob.hyp), NOT folded into blob.inf/blob.bond/
   blob.cb/blob.fx (this file's own stage/ending/soros/counterfeit state
   shares no structural shape with any of those four; the task brief's own
   "extend vs new rider, pick the smaller diff, document" question answers
   the same way M5's own header answered it for blob.bond). Critically, THIS
   file's own blob.hyp only needs to remember its OWN bookkeeping (stage
   ladder position, ending history, the ongoing dollarization approval drag,
   soros/counterfeit run state) — the ACTUAL functional effects of an ending
   already ride their OWNING file's own persistence: rec.currencyId="LBD" via
   city/polity.js's own blob.pol (this file's own 2-line edit there), the
   forex delist flag via sim/forex.js's blob.fx, the central bank's dormant
   flag via sim/centralbank.js's blob.cb, the π alias via sim/inflation.js's
   blob.inf. So "a dollarized country must LOAD dollarized" is satisfied by
   FOUR sibling files' own existing persistence contracts plus this file's
   own bookkeeping restore — no cross-file ordering dependency at apply()
   time (every one of those four applies independently, same "no ordering
   dependency" family every M-wave rider already documents).
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() carry
       serialize()/apply() as blob.hyp, right beside blob.bond.
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own guard
       flag _hypWrap, the P5 one-shot-install fix every P/E/M-wave module
       already uses) so g.cityWorld.hyp rides the localStorage ledger.
   Fresh-run reset: no existing file's reset() calls this one — mirrors
   every sibling sim/* module's own "lazily self-heals via ensureInit()"
   precedent.

   LOAD ORDER: index.html loads this immediately after sim/bonds.js (same
   v=cur1 bucket, BUILD-PLAN's own instruction) — BEFORE sim/market.js/sim/
   econstate.js/sim/npcecon.js/sim/corporations.js/sim/stocks.js/sim/
   billionaires.js and every P/X-wave file (city/polity.js included). Fine:
   every cross-module read here (CBZ.polity.get/list, CBZ.inflation.*,
   CBZ.bonds.*, CBZ.forex.*, CBZ.centralbank.*, CBZ.billionaires.founders,
   CBZ.corps.list, CBZ.npcEcon.adjustEmployedFrac, CBZ.cityLedgerLive/Entry,
   CBZ.currency.*, CBZ.approvalShock, CBZ.cityFeed/city.big/cityForceStars)
   is guarded and resolved at CALL time inside the daily tick or a directly-
   invoked public function, long after every script on the page has loaded —
   the identical discipline every sibling M-wave file's own header documents
   for the same load-order shape.
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
  function clampInt(lo, hi, v) { return Math.max(lo, Math.min(hi, Math.round(v))); }

  // own seeded LCG (never Math.random — repo convention for world state), a
  // distinct seed from every other sim/* stream.
  const INITIAL_SEED = 926104733 & 0x7fffffff;
  let _seed = INITIAL_SEED;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  const FALLBACK_COUNTRIES = ["republic", "veridia", "kesh", "solara", "mbeya"];

  // ============================================================
  //  TUNING (all constants in one place, per repo convention)
  // ============================================================
  const STAGE_ORDER = ["CREEPING", "WARNING", "GALLOPING", "HYPER"];
  const PI_WARN_ENTER = 0.25, PI_WARN_EXIT = 0.15;
  const PI_GALLOP_ENTER = 1.0, PI_GALLOP_EXIT = 0.70;
  const PI_HYPER_ENTER = 5.0, PI_HYPER_EXIT = 3.5;
  const DISTRESS_WARN_T = 1.2;               // sim/bonds.js's own distressOf() alt-trigger for WARNING
  const SUSTAIN_WARN_DAYS = 5, SUSTAIN_GALLOP_DAYS = 5, SUSTAIN_HYPER_DAYS = 1;
  const EXIT_SUSTAIN_DAYS = 3;               // every downgrade needs this many consecutive qualifying days — the anti-flap band

  const WARN_FX_SHOCK = -0.03, WARN_APPROVAL = -2;
  const GALLOP_FX_SHOCK = -0.06, GALLOP_APPROVAL = -5, GALLOP_DAMP = 0.35;
  const HYPER_FX_SHOCK = -0.10, HYPER_APPROVAL = -10, HYPER_DAMP = 0.10;
  const CAPITAL_FLIGHT_FRAC = 0.01;          // /day forex pressure while HYPER (non-LBD)
  const BANK_RUN_FRAC = 0.03;                // /day depositsBase haircut while HYPER
  const BANK_RUN_FEED_EVERY = 5;             // days between "bank run" flavor lines
  const HYPER_DAILY_APPROVAL_DRAG = 0.3;     // /day while HYPER — the X6b-feeding misery channel (see header)

  const CONTROLS_FACTOR = 0.6;               // measured pi suppressed ~40%
  const CONTROLS_EMPLOYED_HIT = 0.05;        // republic-only "shortages" proxy via adjustEmployedFrac

  const ENDING_HYPER_SUSTAIN_DAYS = 5;       // days in HYPER before a leader can act
  const ENDING_COOLDOWN_DAYS = 15;           // between endings for the SAME country
  const ENDING_TRIGGER_P = 0.25;             // /day chance once eligible (seeded, not instant)
  const REDENOM_COST = 5000;                 // small fixed administrative cost (paid if affordable)
  const REDENOM_CRED_BUMP = 0.5;             // halves pi on a GENUINE-tightening redenomination
  const REDENOM_TIGHTEN_INDEP_T = 0.5;       // matches sim/bonds.js's own INDEP_GATE_T precedent
  const DOLLAR_APPROVAL_BUMP = 6;
  const DOLLAR_DRAG_PER_DAY = 0.05;          // "nationalists resent it" — slow ongoing drain while dollarized

  const AUTHORITARIAN_GOVS = { dictatorship: true, fascism: true, communism: true, monarchy: true };

  const SOROS_DISTRESS_T = 1.0;
  const SOROS_DAILY_CHANCE = 0.20;
  const SOROS_COOLDOWN_DAYS = 20;
  const SOROS_ATTACK_DAYS = 3;
  const SOROS_DAILY_SHOCK = -0.05;
  const SOROS_DEFENSE_SPEND_FRAC = 0.08;
  const SOROS_DEFENSE_RATE_T = 0.15;
  const SOROS_BREAK_GAP_MIN = 0.20, SOROS_BREAK_GAP_RANGE = 0.20;   // 20%..40%
  const SOROS_STAKE_FRAC = 0.15;
  const SOROS_MIN_SPEC_CASH = 5000;
  const SOROS_PROFIT_MULT = 1.8;
  const SOROS_INDEP_SCAR = 0.15;
  const SOROS_APPROVAL_BREAK = -8;

  const COUNTERFEIT_BATCH_MIN = 1500, COUNTERFEIT_BATCH_RANGE = 2500;
  const COUNTERFEIT_DISCOUNT = 0.65;
  const COUNTERFEIT_HEAT = 2;
  const COUNTERFEIT_BUST_P = 0.25;
  const COUNTERFEIT_BUST_HEAT = 2;
  const COUNTERFEIT_COOLDOWN_DAYS = 1;
  const COUNTERFEIT_POOL_BUMP = 0.35;
  const COUNTERFEIT_POOL_CAP = 3;
  const COUNTERFEIT_DECAY_PER_DAY = 0.85;
  const COUNTERFEIT_NORM = 1.0;
  const COUNTERFEIT_FX_SHOCK = 0.005;        // /day direct confidence nudge while pool is materially active

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
  // ccyOf(id, rec?) -> that country's CURRENT currency id. Reads rec.
  // currencyId DIRECTLY (city/polity.js's own record field) — the same field
  // sim/bonds.js/sim/centralbank.js/sim/inflation.js all already consult for
  // their own "is this LBD?" guards, and the one dollarize() flips — NOT
  // CBZ.currency.countryCurrency() (that file's own static countryId->
  // currency table, never consulted by any of those three files, documented
  // dead code outside sim/currency.js itself).
  function ccyOf(id, rec) {
    rec = rec || countryRec(id);
    if (rec && rec.currencyId) return rec.currencyId;
    return id === "republic" ? "LBD" : null;
  }
  // piOf(id) — the TRUE, un-suppressed pi (sim/inflation.js's own rawRate()),
  // used for EVERY piece of this file's own game logic (the stage machine,
  // GENUINE-tightening checks, ending triggers, the Soros/counterfeit
  // pressure math). This is deliberate: price controls (see PRICE CONTROLS
  // in the header) only lie to the OTHER consumers of sim/inflation.js's
  // public rate() (bonds' coupon pricing, approval.js's anti-incumbent term,
  // the phone ticker) — the simulation's OWN sense of what stage a country
  // is actually in must never be fooled by its own leader's propaganda, or a
  // controls-active country could never climb (or fall) the ladder at all
  // while lying about its numbers, which would be backwards (the whole point
  // of "the classic lie" is that the REAL crisis keeps getting worse
  // underneath the fake headline number).
  function piOf(id) {
    if (CBZ.inflation && typeof CBZ.inflation.rawRate === "function") return CBZ.inflation.rawRate(id);
    return (CBZ.inflation && typeof CBZ.inflation.rate === "function") ? CBZ.inflation.rate(id) : 0.02;
  }
  function rawPiOf(id) { return piOf(id); }   // same read — kept as a distinct name at genuineTighteningOk()'s own call site for clarity
  function distressOf(id) { return (CBZ.bonds && typeof CBZ.bonds.distressOf === "function") ? CBZ.bonds.distressOf(id) : 0; }
  function bankSnapshot(id) { return (CBZ.centralbank && typeof CBZ.centralbank.snapshot === "function") ? CBZ.centralbank.snapshot(id) : null; }
  function ledgerRec(sid) {
    if (!sid) return null;
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live) return live;
    return (CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid)) || null;
  }
  function cashOfSid(sid) { const r = ledgerRec(sid); return r ? (r.cash || 0) : 0; }
  function debitSidCash(sid, amt) {
    const r = ledgerRec(sid);
    if (!r || (r.cash || 0) < amt) return false;
    r.cash -= amt;
    return true;
  }
  function creditSidCash(sid, amt) { const r = ledgerRec(sid); if (r) r.cash = (r.cash || 0) + amt; }
  function bumpHeat(n) {
    if (CBZ.cityForceStars) { try { CBZ.cityForceStars(Math.min(5, (g.wanted | 0) + n)); return; } catch (e) {} }
    g.wanted = Math.min(5, (g.wanted | 0) + n);
  }

  // ============================================================
  //  STATE — g.hyperState.{countries, soros, sorosCooldown, counterfeit}
  // ============================================================
  function freshCountryHyperState() {
    return {
      stage: "CREEPING", upDays: 0, downDays: 0, hyperDays: 0,
      controlsActive: false, dollarized: false, dollarizedDay: null,
      redenomCount: 0, lastEndingDay: null, endings: [], _bankRunFeedT: 0,
    };
  }
  function reset() {
    _seed = INITIAL_SEED;
    const ids = countryIds();
    const countries = {};
    for (let i = 0; i < ids.length; i++) countries[ids[i]] = freshCountryHyperState();
    g.hyperState = { countries: countries, soros: {}, sorosCooldown: {}, counterfeit: {} };
  }
  function ensureInit() {
    if (!g.hyperState || !g.hyperState.countries) { reset(); return; }
    const ids = countryIds();
    for (let i = 0; i < ids.length; i++) if (!g.hyperState.countries[ids[i]]) g.hyperState.countries[ids[i]] = freshCountryHyperState();
    if (!g.hyperState.soros) g.hyperState.soros = {};
    if (!g.hyperState.sorosCooldown) g.hyperState.sorosCooldown = {};
    if (!g.hyperState.counterfeit) g.hyperState.counterfeit = {};
  }
  function state() { ensureInit(); return g.hyperState; }
  function countryState(id) {
    ensureInit();
    if (!g.hyperState.countries[id]) g.hyperState.countries[id] = freshCountryHyperState();
    return g.hyperState.countries[id];
  }

  // ============================================================
  //  STAGE MACHINE — see header for the hysteresis bands.
  // ============================================================
  function stageIndex(s) { const i = STAGE_ORDER.indexOf(s); return i < 0 ? 0 : i; }
  function dampForStage(stage) { return stage === "HYPER" ? HYPER_DAMP : (stage === "GALLOPING" ? GALLOP_DAMP : 1); }
  function computeStage(cs, pi, distress) {
    const cur = stageIndex(cs.stage);
    let upCond = false, downCond = false, sustainUp = 1;
    if (cur === 0) { upCond = pi > PI_WARN_ENTER || distress > DISTRESS_WARN_T; sustainUp = SUSTAIN_WARN_DAYS; }
    else if (cur === 1) { upCond = pi > PI_GALLOP_ENTER; sustainUp = SUSTAIN_GALLOP_DAYS; downCond = pi < PI_WARN_EXIT && distress <= DISTRESS_WARN_T; }
    else if (cur === 2) { upCond = pi > PI_HYPER_ENTER; sustainUp = SUSTAIN_HYPER_DAYS; downCond = pi < PI_GALLOP_EXIT; }
    else { downCond = pi < PI_HYPER_EXIT; }

    if (upCond) { cs.upDays = (cs.upDays || 0) + 1; cs.downDays = 0; }
    else if (downCond) { cs.downDays = (cs.downDays || 0) + 1; cs.upDays = 0; }
    else { cs.upDays = 0; cs.downDays = 0; }

    if (upCond && cur < 3 && cs.upDays >= sustainUp) { cs.stage = STAGE_ORDER[cur + 1]; cs.upDays = 0; cs.downDays = 0; }
    else if (downCond && cur > 0 && cs.downDays >= EXIT_SUSTAIN_DAYS) { cs.stage = STAGE_ORDER[cur - 1]; cs.upDays = 0; cs.downDays = 0; }

    cs.hyperDays = (cs.stage === "HYPER") ? (cs.hyperDays || 0) + 1 : 0;
  }
  function onStageTransition(rec, cs, prevStage, newStage) {
    const ccy = ccyOf(rec.id, rec);
    const name = rec.name || rec.id;
    const up = stageIndex(newStage) > stageIndex(prevStage);
    if (!up) { if (CBZ.cityFeed) CBZ.cityFeed("" + name + "'s inflation eases back to " + newStage + ".", "#8fe08a"); return; }
    if (newStage === "WARNING") {
      if (CBZ.cityFeed) CBZ.cityFeed("" + name + "'s inflation crosses into WARNING territory.", "#ffd76a");
      if (ccy && ccy !== "LBD" && CBZ.forex && CBZ.forex.shock) CBZ.forex.shock(ccy, WARN_FX_SHOCK);
      if (CBZ.approvalShock) CBZ.approvalShock(rec.id, WARN_APPROVAL);
    } else if (newStage === "GALLOPING") {
      if (CBZ.cityFeed) CBZ.cityFeed("" + name + " enters GALLOPING inflation — shelves reprice weekly.", "#ff9e6b");
      if (ccy && ccy !== "LBD" && CBZ.forex && CBZ.forex.shock) CBZ.forex.shock(ccy, GALLOP_FX_SHOCK);
      if (CBZ.approvalShock) CBZ.approvalShock(rec.id, GALLOP_APPROVAL);
    } else if (newStage === "HYPER") {
      if (CBZ.city && CBZ.city.big) CBZ.city.big("" + name.toUpperCase() + " HYPERINFLATION");
      if (CBZ.cityFeed) CBZ.cityFeed("" + name + " — prices reprice DAILY, barter spreads through the markets.", "#ff3b3b");
      if (ccy && ccy !== "LBD" && CBZ.forex && CBZ.forex.shock) CBZ.forex.shock(ccy, HYPER_FX_SHOCK);
      if (CBZ.approvalShock) CBZ.approvalShock(rec.id, HYPER_APPROVAL);
    }
  }
  function applyStageSymptoms(id, rec, cs) {
    const ccy = ccyOf(id, rec);
    if (CBZ.bonds && CBZ.bonds.setAppetiteDamp) CBZ.bonds.setAppetiteDamp(id, dampForStage(cs.stage));

    const wantControls = cs.stage === "GALLOPING" || cs.stage === "HYPER";
    if (wantControls !== cs.controlsActive) {
      if (CBZ.inflation && CBZ.inflation.setControlsFactor) CBZ.inflation.setControlsFactor(id, wantControls ? CONTROLS_FACTOR : 1);
      if (id === "republic" && CBZ.npcEcon && CBZ.npcEcon.adjustEmployedFrac) {
        CBZ.npcEcon.adjustEmployedFrac(wantControls ? -CONTROLS_EMPLOYED_HIT : CONTROLS_EMPLOYED_HIT);
      }
      cs.controlsActive = wantControls;
      const name = rec.name || id;
      if (CBZ.cityFeed) {
        CBZ.cityFeed(wantControls
          ? ("" + name + " imposes emergency price controls — the official numbers stop telling the truth.")
          : ("" + name + " lifts price controls — real prices reassert themselves."),
          wantControls ? "#ffb27a" : "#8fe08a");
      }
    }

    if (cs.stage === "HYPER") {
      if (ccy && ccy !== "LBD" && CBZ.forex && CBZ.forex.shock) CBZ.forex.shock(ccy, -CAPITAL_FLIGHT_FRAC);
      if (CBZ.centralbank && CBZ.centralbank.shrinkDeposits) CBZ.centralbank.shrinkDeposits(id, BANK_RUN_FRAC);
      if (CBZ.approvalShock) CBZ.approvalShock(id, -HYPER_DAILY_APPROVAL_DRAG);
      cs._bankRunFeedT = (cs._bankRunFeedT || 0) + 1;
      if (cs._bankRunFeedT >= BANK_RUN_FEED_EVERY) {
        cs._bankRunFeedT = 0;
        if (CBZ.cityFeed) CBZ.cityFeed("Depositors queue outside " + (rec.name || id) + "'s banks — a run is on.", "#ff6a5e");
      }
    }
  }
  function tickDollarizedDrag(id) {
    if (CBZ.approvalShock) CBZ.approvalShock(id, -DOLLAR_DRAG_PER_DAY);
  }

  // ============================================================
  //  ENDINGS — see header for the full redenomination/dollarization design.
  // ============================================================
  function divideWallet(ccy, div) {
    if (!ccy || !CBZ.currency) return;
    const w = CBZ.currency.wallet ? CBZ.currency.wallet() : null;
    if (w && isFinite(w[ccy])) w[ccy] = w[ccy] / div;
    const bw = CBZ.currency.bankWallet ? CBZ.currency.bankWallet() : null;
    if (bw && isFinite(bw[ccy])) bw[ccy] = bw[ccy] / div;
  }
  function convertWalletToLBD(ccy, rate) {
    if (!CBZ.currency) return;
    const w = CBZ.currency.wallet ? CBZ.currency.wallet() : null;
    if (w && w[ccy] > 0) { const amt = w[ccy]; w[ccy] = 0; w.LBD = (w.LBD || 0) + amt * rate; }
    const bw = CBZ.currency.bankWallet ? CBZ.currency.bankWallet() : null;
    if (bw && bw[ccy] > 0) { const amt = bw[ccy]; bw[ccy] = 0; bw.LBD = (bw.LBD || 0) + amt * rate; }
  }
  function divideRepublicHolders(div) {
    if (CBZ.corps && CBZ.corps.list) {
      const corps = CBZ.corps.list();
      for (let i = 0; i < corps.length; i++) { const co = corps[i]; if (co && isFinite(co.cash)) co.cash = co.cash / div; }
    }
    if (CBZ.billionaires && CBZ.billionaires.founders) {
      const founders = CBZ.billionaires.founders();
      for (let i = 0; i < founders.length; i++) {
        const e = ledgerRec(founders[i].sid);
        if (e && isFinite(e.cash)) e.cash = e.cash / div;
      }
    }
  }
  function computeK(level) {
    const k = Math.floor(Math.log10(Math.max(10, level)));
    return clampInt(1, 12, k);
  }
  function genuineTighteningOk(id) {
    const bank = bankSnapshot(id);
    if (!bank) return false;
    const truePi = rawPiOf(id);
    const realRate = (bank.policyRate || 0) - truePi;
    return bank.independence >= REDENOM_TIGHTEN_INDEP_T && realRate > 0;
  }
  function redenominate(id, opts) {
    opts = opts || {};
    const rec = countryRec(id);
    if (!rec) return { ok: false, reason: "no-country" };
    const cs = countryState(id);
    const level = (CBZ.inflation && CBZ.inflation.priceLevel) ? CBZ.inflation.priceLevel(id) : 1;
    const k = opts.k != null ? clampInt(1, 12, opts.k) : computeK(level);
    const ccy = ccyOf(id, rec);
    const div = Math.pow(10, k);

    let paidCost = false;
    if ((rec.treasury || 0) >= REDENOM_COST) { rec.treasury -= REDENOM_COST; paidCost = true; }
    rec.treasury = (rec.treasury || 0) / div;

    divideWallet(ccy, div);
    if (CBZ.bonds && CBZ.bonds.rescaleCountry) CBZ.bonds.rescaleCountry(id, 1 / div);
    if (ccy === "LBD") divideRepublicHolders(div);
    if (CBZ.inflation && CBZ.inflation.redenominate) CBZ.inflation.redenominate(id, k);

    const genuine = genuineTighteningOk(id);
    if (genuine && CBZ.inflation && CBZ.inflation.applyCredibilityBump) CBZ.inflation.applyCredibilityBump(id, REDENOM_CRED_BUMP);

    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    cs.redenomCount = (cs.redenomCount || 0) + 1;
    cs.lastEndingDay = day;
    cs.endings.push({ type: "redenomination", day: day, k: k, genuine: genuine, paidCost: paidCost });

    const name = rec.name || id;
    if (CBZ.city && CBZ.city.big) CBZ.city.big("" + name.toUpperCase() + " REDENOMINATES — 10^" + k + " ZEROS CUT");
    if (CBZ.cityFeed) {
      CBZ.cityFeed("" + name + " knocks " + k + " zero" + (k > 1 ? "s" : "") + " off its currency" +
        (genuine ? " alongside real fiscal tightening — credibility partially restored." : " — nothing else changes underneath it."),
        "#ffd76a");
    }
    return { ok: true, k: k, div: div, genuine: genuine, paidCost: paidCost };
  }
  function dollarize(id, opts) {
    opts = opts || {};
    if (id === "republic") return { ok: false, reason: "republic-is-the-numeraire" };
    const rec = countryRec(id);
    if (!rec) return { ok: false, reason: "no-country" };
    const cs = countryState(id);
    if (cs.dollarized) return { ok: false, reason: "already-dollarized" };
    const ccy = ccyOf(id, rec);
    if (!ccy || ccy === "LBD") return { ok: false, reason: "no-currency" };
    const q = CBZ.forex && CBZ.forex.quote ? CBZ.forex.quote(ccy) : null;
    const rate = q ? q.rate : null;
    if (!(rate > 0)) return { ok: false, reason: "no-rate" };

    rec.treasury = (rec.treasury || 0) * rate;
    convertWalletToLBD(ccy, rate);
    if (CBZ.bonds && CBZ.bonds.rescaleCountry) CBZ.bonds.rescaleCountry(id, rate);

    rec.currencyId = "LBD";
    if (CBZ.forex && CBZ.forex.delist) CBZ.forex.delist(ccy, true);
    if (CBZ.centralbank && CBZ.centralbank.setDormant) CBZ.centralbank.setDormant(id, true);
    if (CBZ.inflation && CBZ.inflation.setAlias) CBZ.inflation.setAlias(id, "republic");
    if (CBZ.inflation && CBZ.inflation.setControlsFactor) CBZ.inflation.setControlsFactor(id, 1);

    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    cs.dollarized = true;
    cs.dollarizedDay = day;
    cs.controlsActive = false;
    cs.endings.push({ type: "dollarization", day: day, rate: rate });
    if (CBZ.approvalShock) CBZ.approvalShock(id, DOLLAR_APPROVAL_BUMP);

    const name = rec.name || id;
    if (CBZ.city && CBZ.city.big) CBZ.city.big("" + name.toUpperCase() + " ADOPTS THE LIBERTY DOLLAR");
    if (CBZ.cityFeed) CBZ.cityFeed("" + name + " abandons " + ccy + " and dollarizes — the central bank goes dormant, monetary sovereignty is gone.", "#ffd76a");
    return { ok: true, rate: rate };
  }
  function maybeTriggerEnding(id, rec, cs, day) {
    if (cs.dollarized) return;
    if (cs.stage !== "HYPER" || cs.hyperDays < ENDING_HYPER_SUSTAIN_DAYS) return;
    if (cs.lastEndingDay != null && (day - cs.lastEndingDay) < ENDING_COOLDOWN_DAYS) return;
    if (rng() >= ENDING_TRIGGER_P) return;
    if (id === "republic") { redenominate(id); return; }
    if (AUTHORITARIAN_GOVS[rec.govType]) redenominate(id); else dollarize(id);
  }

  // ============================================================
  //  SOROS RUNS — see header.
  // ============================================================
  function pickSpeculator() {
    const founders = (CBZ.billionaires && CBZ.billionaires.founders) ? CBZ.billionaires.founders() : [];
    const cands = [];
    for (let i = 0; i < founders.length; i++) {
      const sid = founders[i].sid;
      const cash = cashOfSid(sid);
      if (cash >= SOROS_MIN_SPEC_CASH) cands.push({ sid: sid, cash: cash });
    }
    if (!cands.length) return null;
    return cands[Math.floor(rng() * cands.length) % cands.length];
  }
  function openSorosRun(id, ccy, opts) {
    opts = opts || {};
    const S = state();
    const spec = opts.sid ? { sid: opts.sid, cash: cashOfSid(opts.sid) } : pickSpeculator();
    if (!spec) return null;
    const stake = opts.stake != null ? Math.max(1, Math.round(opts.stake)) : Math.max(1, Math.round(spec.cash * SOROS_STAKE_FRAC));
    if (!debitSidCash(spec.sid, stake)) return null;
    S.soros[id] = {
      active: true, ccy: ccy, sid: spec.sid, stake: stake,
      startDay: CBZ.worldDay ? CBZ.worldDay() : 0, daysElapsed: 0,
      attackDays: opts.attackDays != null ? opts.attackDays : SOROS_ATTACK_DAYS, defenseScore: 0,
    };
    return S.soros[id];
  }
  function stepSorosRun(id, rec, run) {
    run.daysElapsed++;
    if (CBZ.forex && CBZ.forex.shock) CBZ.forex.shock(run.ccy, SOROS_DAILY_SHOCK);
    const bank = bankSnapshot(id);
    const defendSpend = Math.round((rec.treasury || 0) * SOROS_DEFENSE_SPEND_FRAC);
    const canSpend = defendSpend > 0 && (rec.treasury || 0) >= defendSpend;
    const rateHigh = !!(bank && bank.policyRate >= SOROS_DEFENSE_RATE_T);
    if (canSpend) rec.treasury -= defendSpend;
    run.defenseScore += (canSpend && rateHigh) ? 1 : -1;
    if (run.daysElapsed >= run.attackDays) resolveSorosRun(id, rec, run);
  }
  function resolveSorosRun(id, rec, run) {
    const S = state();
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    const name = rec.name || id;
    if (run.defenseScore >= 0) {
      if (CBZ.cityFeed) CBZ.cityFeed("" + name + "'s defense holds — the speculator eats the loss.", "#8fe08a");
    } else {
      const gapFrac = -(SOROS_BREAK_GAP_MIN + rng() * SOROS_BREAK_GAP_RANGE);
      if (CBZ.forex && CBZ.forex.shock) CBZ.forex.shock(run.ccy, gapFrac);
      const profit = Math.round(run.stake * SOROS_PROFIT_MULT);
      const paid = Math.min(profit, Math.max(0, rec.treasury || 0));
      rec.treasury = Math.max(0, (rec.treasury || 0) - paid);
      creditSidCash(run.sid, run.stake + paid);
      if (CBZ.centralbank && CBZ.centralbank.scarIndependence) CBZ.centralbank.scarIndependence(id, SOROS_INDEP_SCAR);
      if (CBZ.approvalShock) CBZ.approvalShock(id, SOROS_APPROVAL_BREAK);
      if (CBZ.city && CBZ.city.big) CBZ.city.big("" + name.toUpperCase() + "'S CURRENCY DEFENSE BREAKS");
      if (CBZ.cityFeed) CBZ.cityFeed("The peg breaks — " + name + "'s currency craters, and the speculator walks away richer.", "#ff6a5e");
    }
    S.sorosCooldown[id] = day + SOROS_COOLDOWN_DAYS;
    delete S.soros[id];
  }
  function tickSoros(id, day) {
    if (id === "republic") return;
    const rec = countryRec(id);
    if (!rec) return;
    const S = state();
    const existing = S.soros[id];
    if (existing && existing.active) { stepSorosRun(id, rec, existing); return; }
    if (S.sorosCooldown[id] && day < S.sorosCooldown[id]) return;
    const cs = countryState(id);
    if (cs.dollarized) return;
    const ccy = ccyOf(id, rec);
    if (!ccy || ccy === "LBD") return;
    if (cs.stage !== "GALLOPING" && cs.stage !== "HYPER") return;
    const bank = bankSnapshot(id);
    if (!bank || bank.dormant || !(bank.lastMove > 0)) return;   // "visibly defends"
    if (distressOf(id) < SOROS_DISTRESS_T) return;
    if (rng() >= SOROS_DAILY_CHANCE) return;
    const run = openSorosRun(id, ccy);
    if (run && CBZ.cityFeed) CBZ.cityFeed("A speculator opens a short against " + (rec.name || id) + "'s currency as it defends a losing peg.", "#ffb27a");
  }

  // ============================================================
  //  COUNTERFEITING — see header.
  // ============================================================
  function counterfeitStateOf(id) {
    const S = state();
    if (!S.counterfeit[id]) S.counterfeit[id] = { pool: 0, cooldownUntil: 0 };
    return S.counterfeit[id];
  }
  function counterfeitOffer(id) {
    id = id || "republic";
    const c = counterfeitStateOf(id);
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    return { available: day >= (c.cooldownUntil || 0), cooldownDays: Math.max(0, (c.cooldownUntil || 0) - day) };
  }
  function counterfeit(id) {
    id = id || "republic";
    const rec = countryRec(id);
    const c = counterfeitStateOf(id);
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    if (day < (c.cooldownUntil || 0)) return { ok: false, reason: "cooldown" };
    const ccy = ccyOf(id, rec);
    const face = Math.round(COUNTERFEIT_BATCH_MIN + rng() * COUNTERFEIT_BATCH_RANGE);
    const credited = Math.round(face * COUNTERFEIT_DISCOUNT);
    if (CBZ.currency && CBZ.currency.walletAdd) CBZ.currency.walletAdd(ccy, credited);
    else g.cash = (g.cash || 0) + credited;
    bumpHeat(COUNTERFEIT_HEAT);
    c.pool = Math.min(COUNTERFEIT_POOL_CAP, (c.pool || 0) + COUNTERFEIT_POOL_BUMP);
    c.cooldownUntil = day + COUNTERFEIT_COOLDOWN_DAYS;

    let busted = false;
    if (rng() < COUNTERFEIT_BUST_P) {
      busted = true;
      if (CBZ.currency && CBZ.currency.walletTake) {
        const have = CBZ.currency.walletGet ? CBZ.currency.walletGet(ccy) : credited;
        CBZ.currency.walletTake(ccy, Math.min(credited, have));
      } else g.cash = Math.max(0, (g.cash || 0) - credited);
      bumpHeat(COUNTERFEIT_BUST_HEAT);
      if (CBZ.cityFeed) CBZ.cityFeed("The plates get made — counterfeit bills seized, heat's up.", "#ff6a5e");
    } else if (CBZ.cityFeed) {
      CBZ.cityFeed("Fresh " + ccy + " off an underworld press lands in your pocket, discounted and dirty.", "#ffd166");
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return { ok: true, face: face, credited: credited, busted: busted, ccy: ccy };
  }
  function counterfeitPressure(id) {
    const S = state();
    const c = S.counterfeit[id];
    if (!c) return 0;
    return clamp01((c.pool || 0) / COUNTERFEIT_NORM);
  }
  function tickCounterfeitDecay() {
    const S = state();
    for (const id in S.counterfeit) {
      const c = S.counterfeit[id];
      c.pool = (c.pool || 0) * COUNTERFEIT_DECAY_PER_DAY;
      if (c.pool < 0.001) c.pool = 0;
      if (c.pool > 0.05) {
        const rec = countryRec(id);
        const ccy = ccyOf(id, rec);
        if (ccy && ccy !== "LBD" && CBZ.forex && CBZ.forex.shock) CBZ.forex.shock(ccy, -COUNTERFEIT_FX_SHOCK);
      }
    }
  }

  // ============================================================
  //  DAILY TICK
  // ============================================================
  function tickCountryStage(id, day) {
    const rec = countryRec(id);
    if (!rec) return;
    if (!rec.id) rec.id = id;   // some callers construct plain records without an id field — cheap, harmless backfill
    const cs = countryState(id);
    if (cs.dollarized) { tickDollarizedDrag(id); return; }
    const pi = piOf(id);
    const distress = distressOf(id);
    const prevStage = cs.stage;
    computeStage(cs, pi, distress);
    if (cs.stage !== prevStage) onStageTransition(rec, cs, prevStage, cs.stage);
    applyStageSymptoms(id, rec, cs);
    maybeTriggerEnding(id, rec, cs, day);
  }
  function dailyTick(day) {
    ensureInit();
    const ids = countryIds();
    for (let i = 0; i < ids.length; i++) {
      try { tickCountryStage(ids[i], day); }
      catch (e) { try { console.error("[hyperinflation] tickCountryStage failed for " + ids[i], e); } catch (e2) {} }
    }
    for (let i = 0; i < ids.length; i++) {
      try { tickSoros(ids[i], day); }
      catch (e) { try { console.error("[hyperinflation] tickSoros failed for " + ids[i], e); } catch (e2) {} }
    }
    try { tickCounterfeitDecay(); } catch (e) { try { console.error("[hyperinflation] tickCounterfeitDecay failed", e); } catch (e2) {} }
  }
  // CBZ.onNewDay is city/polity.js's own function — polity.js loads LATER
  // than this file (see header's LOAD ORDER note), so it does NOT exist yet
  // at parse time. Deferred registration (same idiom every sibling M-wave
  // file's own ensureDayTickRegistered() already uses), installed from the
  // NEXT free onUpdate slot after sim/bonds.js's own 46.25 — since onNewDay
  // subscribers fire in REGISTRATION order and registration itself happens
  // from each file's own onUpdate install tick (ascending order), this
  // guarantees dailyTick() above runs AFTER forex/centralbank/inflation/
  // bonds have all settled the SAME day's numbers.
  let _dayTickRegistered = false;
  function ensureDayTickRegistered() {
    if (_dayTickRegistered) return;
    if (CBZ.onNewDay) { CBZ.onNewDay(dailyTick); _dayTickRegistered = true; }
  }

  // ============================================================
  //  READS
  // ============================================================
  function stageOf(id) { return countryState(id).stage; }
  function isDollarized(id) { return !!countryState(id).dollarized; }
  function endingsOf(id) { return countryState(id).endings.slice(); }
  function sorosOf(id) { const S = state(); return S.soros[id] ? Object.assign({}, S.soros[id]) : null; }
  function summary() {
    ensureInit();
    const ids = countryIds();
    return ids.map(function (id) {
      const cs = countryState(id);
      return {
        id: id, stage: cs.stage, dollarized: !!cs.dollarized, controlsActive: !!cs.controlsActive,
        redenomCount: cs.redenomCount || 0, pi: piOf(id),
      };
    });
  }

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serialize() {
    ensureInit();
    const countries = {};
    for (const id in g.hyperState.countries) {
      const cs = g.hyperState.countries[id];
      countries[id] = {
        stage: cs.stage, upDays: cs.upDays || 0, downDays: cs.downDays || 0, hyperDays: cs.hyperDays || 0,
        controlsActive: !!cs.controlsActive, dollarized: !!cs.dollarized, dollarizedDay: cs.dollarizedDay,
        redenomCount: cs.redenomCount || 0, lastEndingDay: cs.lastEndingDay,
        endings: (cs.endings || []).slice(-30), bankRunFeedT: cs._bankRunFeedT || 0,
      };
    }
    const soros = {};
    for (const id in g.hyperState.soros) soros[id] = Object.assign({}, g.hyperState.soros[id]);
    const counterfeit = {};
    for (const id in g.hyperState.counterfeit) counterfeit[id] = Object.assign({}, g.hyperState.counterfeit[id]);
    return { v: 1, countries: countries, soros: soros, sorosCooldown: Object.assign({}, g.hyperState.sorosCooldown), counterfeit: counterfeit };
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1) return;
    if (obj.countries) for (const id in obj.countries) {
      const src = obj.countries[id]; if (!src) continue;
      if (!g.hyperState.countries[id]) g.hyperState.countries[id] = freshCountryHyperState();
      const cs = g.hyperState.countries[id];
      cs.stage = STAGE_ORDER.indexOf(src.stage) >= 0 ? src.stage : "CREEPING";
      cs.upDays = isFinite(src.upDays) ? +src.upDays : 0;
      cs.downDays = isFinite(src.downDays) ? +src.downDays : 0;
      cs.hyperDays = isFinite(src.hyperDays) ? +src.hyperDays : 0;
      cs.controlsActive = !!src.controlsActive;
      cs.dollarized = !!src.dollarized;
      cs.dollarizedDay = src.dollarizedDay != null ? src.dollarizedDay : null;
      cs.redenomCount = isFinite(src.redenomCount) ? +src.redenomCount : 0;
      cs.lastEndingDay = src.lastEndingDay != null ? src.lastEndingDay : null;
      cs.endings = Array.isArray(src.endings) ? src.endings.slice(-30) : [];
      cs._bankRunFeedT = isFinite(src.bankRunFeedT) ? +src.bankRunFeedT : 0;
    }
    if (obj.soros) for (const id in obj.soros) g.hyperState.soros[id] = Object.assign({}, obj.soros[id]);
    if (obj.sorosCooldown) for (const id in obj.sorosCooldown) g.hyperState.sorosCooldown[id] = +obj.sorosCooldown[id] || 0;
    if (obj.counterfeit) for (const id in obj.counterfeit) g.hyperState.counterfeit[id] = Object.assign({ pool: 0, cooldownUntil: 0 }, obj.counterfeit[id]);
  }

  CBZ.hyperinflation = {
    stageOf: stageOf,
    isDollarized: isDollarized,
    endingsOf: endingsOf,
    sorosOf: sorosOf,
    summary: summary,
    redenominate: redenominate,
    dollarize: dollarize,
    counterfeit: counterfeit,
    counterfeitOffer: counterfeitOffer,
    counterfeitPressure: counterfeitPressure,
    reset: reset,
    serialize: serialize,
    apply: apply,
    // constants a caller (or a harness) may want to display/reason about
    // (read-only use) — mirrors sim/inflation.js's own BASE_DRIFT export.
    REDENOM_COST: REDENOM_COST,
    CONTROLS_FACTOR: CONTROLS_FACTOR,
    // harness/test-only hooks — not part of the public contract (mirrors
    // every sibling M-wave file's own _state()/_dayTick/_force* precedent).
    _state: state,
    _dayTick: dailyTick,
    _computeK: computeK,
    _forceStage: function (id, stageName, hyperDays) {
      const cs = countryState(id);
      cs.stage = STAGE_ORDER.indexOf(stageName) >= 0 ? stageName : "CREEPING";
      cs.upDays = 0; cs.downDays = 0;
      cs.hyperDays = stageName === "HYPER" ? (hyperDays != null ? hyperDays : 0) : 0;
      return cs.stage;
    },
    _forceSoros: function (id, opts) {
      const rec = countryRec(id); if (!rec) return null;
      const ccy = ccyOf(id, rec);
      return openSorosRun(id, ccy, opts || {});
    },
  };

  // ============================================================
  //  SINGLE-PLAYER PERSIST — sim/bonds.js's g.cityWorld pattern, verbatim.
  // ------------------------------------------------------------
  function stampHyp() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.hyp = serialize();
  }
  let _ensureHypSaveWraps_done = false;
  function ensureHypSaveWraps() {
    if (_ensureHypSaveWraps_done) return;
    _ensureHypSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._hypWrap) {
      const w = function () { stampHyp(); return commit.apply(this, arguments); };
      w._hypWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._hypWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampHyp(); return col.apply(this, arguments); };
      wc._hypWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.hyp) apply(led.hyp);
  }
  if (CBZ.onUpdate) {
    // next free slot after sim/bonds.js's own 46.25 install tick — same
    // install-tick family every other P/E/M-wave save-wrap uses.
    CBZ.onUpdate(46.26, function () {
      if (!g) return;
      ensureDayTickRegistered();
      ensureHypSaveWraps();
      hydrateFromLedger();
    });
  }
})();
