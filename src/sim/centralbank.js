/* ============================================================
   sim/centralbank.js — Stage M, step M3: THE CENTRAL BANK.

   MASTER-PLAN VI.8 (verbatim, the parts this file ships): "The central bank
   is a real institution... a governor NPC — persistent, schedulable,
   assassinable like every officeholder, with market consequences on death —
   and an `independence` stat (0-1) that the regime erodes: democracies
   nominate and wait; dictators fire-and-replace at will, independence → 0.
   Levers with real transmission: the policy rate feeds directly into
   bank.js's existing RATES table (every mortgage/personal/auto APR moves);
   reserve requirements cap city-wide bank credit (bankCredit ≤ baseMoney/rr)
   through the existing loan-approval path."

   ============================================================
   ONE BANK PER COUNTRY — g.centralBankState.banks[countryId] = {countryId,
   governorSid, vacantSince, policyRate, reserveReq, independence,
   depositsBase, suspended, decree, lastMove, _independenceFloor}. Seeded off
   CBZ.polity.list("country") (republic + X3's veridia/kesh/solara/mbeya —
   whatever the roster is; a future 6th country registers for free, same
   "generalize off the live registry" precedent officials.js's own header
   documents). Fallback roster (headless/pre-polity boot) mirrors sim/
   forex.js's own FALLBACK_WEALTH precedent — never actually exercised in
   real gameplay (polity.js always registers first), only a defensive floor.

   ============================================================
   THE GOVERNOR — minted exactly like officials.js's mintHolder(): a
   synthetic, NEVER-SPAWNED "parked" ped stashed via CBZ.cityPedStash
   (_parked:true, nameKnown:true — the same billionaires.js/officials.js
   founder-minting shape), so the governor is a REAL ledger person from day
   one: nameable, robbable-by-reputation, and killable through the ordinary
   cityKillPed path like any other officeholder. Region-correct name: reads
   city/demographics.js's own CONFIGS[countryId] name pools directly (no x/z
   position needed — a parked identity has none) with CBZ.cityMintName as
   the fallback for the republic (whose CONFIGS entry deliberately keeps
   empty pools and always defers to the global list — see that file's own
   header). "Appointed by the leader" is flavor in the mint feed line
   (CBZ.officials.identityOf(rec.office.holder) when available) — the
   appointment itself needs no stored reference; a later succession just
   re-reads whoever the CURRENT office.holder is, same as officials.js's own
   physical-presence section never hard-codes a sid.

   ASSASSINATION → SUCCESSION: own cityKillPed wrap (own guard flag
   _cbKillWrap, installed exactly once — the officials.js/regimes.js
   discipline: capture the sid BEFORE orig() runs, act after ped.dead flips).
   On a governor's death: vacancy stamped (bank.governorSid=null,
   vacantSince=worldDay), a forex confidence knock (CBZ.forex.shock on the
   country's OWN currency — skipped for the republic, whose LBD has no
   float to shock), and a headline. GOVERNOR_VACANCY_DAYS (2, matching
   officials.js's own CARETAKER_DAYS) later, the onNewDay tick auto-appoints
   a fresh governor — "successor within days", per the design brief, not
   instant.

   ============================================================
   THE REACTION FUNCTION (onNewDay, one country at a time) — moves
   policyRate in ±0.25%..±1% daily steps toward a TARGET composed from what
   exists NOW (inflation fully arrives in M4 — this file leaves the seam,
   see below):
     - ECONOMY: EconState (sim/econstate.js) activity/employment off the
       country's capital jurisdiction — hot (activity/employment above the
       ~1.0/0.92 equilibrium) hikes; slack cuts. The republic's own capital
       is econstate.js's DEFAULT_ID ("libertyville"); every other country's
       capital is resolved the same way sim/forex.js's own (private,
       reimplemented here — small, self-contained, same "not exported, so
       small enough to duplicate" precedent that file's own header uses for
       relations.js's capitalEconIdFor) capIdFor() does.
     - CURRENCY DEFENSE: reads sim/forex.js's own PUBLIC quote()/history()
       (never its harness-only _rate0/_state hooks) — a currency that has
       fallen fast over the last few days (vs. its own trailing history)
       earns a defensive hike, scaled to the size of the decline. The
       republic's own LBD never floats against itself (forex always answers
       rate("LBD")=1), so this term is naturally 0 for the republic's own
       bank — exactly right, the anchor currency has no exchange-rate risk
       against itself.
     - WAR: an active war (CBZ.polwar.warsOf) pressures the target DOWN
       (print/cut, financing the war) scaled by (1 − independence) — an
       independent bank resists the pressure; a captured one obeys it.
     - LOW APPROVAL: a leader under 30% approval (CBZ.polity's own record)
       pressures for cuts (stimulus), same (1 − independence) scaling.
     - M4 SEAM: `target += CBZ.centralbank._inflationTerm(id)`, a hook this
       file installs defaulting to 0 (inflation isn't a modeled quantity
       yet) — M4 overwrites this ONE function reference with the real π
       term and nothing else in this file has to change, the exact mirror
       of sim/forex.js's own carryTerm seam that THIS file is the other
       half of.
   Independence itself is recomputed every tick straight off the country's
   CURRENT govType (INDEPENDENCE_BY_GOV below) — democracy .8, monarchy .6,
   communism .3, fascism/dictatorship .2, emergencyRule .45 (an interpolated
   transitional stage — not itself named in the design brief's table, placed
   between democracy and outright authoritarian since it IS that transition
   — see city/regimes.js's own democracy→emergencyRule→dictatorship graph),
   anarchism 0 (moot — see SUSPENSION below). A DECREE (below) permanently
   floors independence at DECREE_INDEPENDENCE_FLOOR even after the regime
   later moderates — a captured institution doesn't just snap back to full
   public trust the day the strongman is gone.

   ============================================================
   REGIME INTERFERENCE:
     - DECREE (CBZ.centralbank.decree(countryId, rate, opts)) — a
       fascist/dictatorship leader can force a rate, bypassing the reaction
       function entirely while active (the daily tick just pins
       policyRate = decree.rate and returns). Deviation from what the
       reaction function would have targeted on FUNDAMENTALS ALONE (economy
       + currency defense, no political-pressure terms — computeTarget's own
       fundamentalsOnly flag) sizes a forex confidence-penalty shock
       (visibly captured banks spook currency markets) plus a headline. The
       decree lapses on its own the day the regime is no longer
       fascism/dictatorship (checked at the top of every tick) — but the
       independence floor it stamped is permanent (see above).
     - ANARCHISM: the bank SUSPENDS — rate frozen (the daily tick returns
       before any movement), reserveCap → 0 new loans (creditCap() returns 0
       outright when bank.suspended). Restored the moment govType leaves
       anarchism (checked every tick, no lag — "order is restored" and
       normal reaction resumes that same day).

   ============================================================
   RESERVE-REQUIREMENT CREDIT CAP — MASTER-PLAN's own formula, verbatim:
   "bankCredit ≤ baseMoney/rr". This wave's SCOPE NOTE (recorded here per
   the repo's own "adapt, don't silently narrow" convention — see sim/
   forex.js's own header for the precedent this follows): the brief says
   "player+NPC credit", but there is no NPC loan ledger anywhere in this
   codebase yet (city/bank.js is the ONE real credit-issuance ledger that
   exists — a single walk-in branch serving the republic). So "baseMoney"
   is this file's OWN `depositsBase` per bank (a systemic aggregate-deposit
   proxy, NOT the player's personal g.cityBank balance — a single wallet
   isn't the nation's money supply; deliberately decoupled from bank.js so
   the cap doesn't oscillate with the player's own deposit/withdraw clicks),
   seeded generously (see DEPOSITS_BASE_SEED) and drifting slowly with the
   real economy (grows when the capital's EconState activity runs hot,
   drags down under an active war) — and "bankCredit" is bank.js's own
   g.cityLoans live balance sum, read directly here (a plain global on `g`,
   not a bank.js internal call — no cross-file call needed, keeping this a
   one-directional dependency: bank.js calls INTO centralbank.js, never the
   reverse). `creditCap(countryId)` only actually BINDS for "republic" this
   wave (the only jurisdiction with a real credit ledger); every other
   country's cap is bookkeeping-only, exactly like city/regimes.js's own
   "mostly bookkeeping this wave" framing for non-republic countries. A
   future wave that adds NPC credit anywhere sums it into the same
   outstanding-credit read with zero shape change here.
   bank.js's own offer() wrapper (creditHeadroom()) is the refusal path —
   see that file's header for the hook.

   ============================================================
   THE FOREX SEAM — sim/forex.js's own carryTerm already reads
   `CBZ.centralbank && CBZ.centralbank.rate(id)` with a neutral fallback (see
   that file's header) — CBZ.centralbank.rate(countryId) below is that exact
   contract, ZERO forex.js edits needed for it to pick this up the moment
   this file exists (verified end-to-end by m3harness.js: a policy-rate
   differential between two countries actually moves forex's daily carry
   term once both banks exist).

   ============================================================
   PLAYER SURFACE — city/phone.js's MARKETS app already has the "read-only
   rows" card idiom (E3's rows()/summary() split, M2's own "💱 CURRENCY
   EXCHANGE" sibling card). Added a further sibling "🏦 CENTRAL BANKS" card
   (CBZ.centralbank.list()), one row per country: policy rate, independence
   badge, governor name, and a 🔒 SUSPENDED / ⚡ DECREED flag when applicable
   — reusing the exact row idiom, no new UI chrome. Chosen over bolting a
   "central bank rate" line onto city/bank.js's own branch UI because that
   branch is ONE physical building serving only the republic; the phone
   already aggregates every country in one glanceable list (exactly the
   forex card's own justification for living there instead of at the
   airport kiosk alone).

   ============================================================
   PERSISTENCE — WORLD state (shared economy), both riders every other
   sim/P-wave module uses:
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() carry
       serialize()/apply() as blob.cb, right beside blob.fx.
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own guard
       flag _cbWrap, the one-shot-install pattern every P/E/M-wave module
       already uses) so g.cityWorld.cb rides the localStorage ledger.
   Fresh-run reset: no existing file's reset() calls this one (nothing in
   the codebase currently resets a fresh city run's sim/* modules from a
   single call site other than each module's own onUpdate-install lazily
   re-initializing itself when g.centralBankState is missing) — mirrors sim/
   forex.js's own ensureInit() self-healing shape exactly.

   LOAD ORDER: index.html loads this immediately after sim/forex.js (same
   v=cur1 bucket, BUILD-PLAN's own instruction), BEFORE city/polity.js/
   officials.js/regimes.js/polwar.js even exist yet — fine, every
   cross-module read here (CBZ.polity.get/list, CBZ.econState.get,
   CBZ.polwar.warsOf, CBZ.forex.quote/shock, CBZ.officials.identityOf,
   CBZ.demographics.CONFIGS, CBZ.onNewDay) is guarded and resolved at CALL
   time, never at parse time — the identical discipline sim/forex.js's own
   header documents for the exact same load-order constraint.
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
  function pick(a, x) { return a && a.length ? a[(x * a.length) | 0] : null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  // own seeded LCG (never Math.random — repo convention for world state), a
  // distinct seed from every other sim/* stream.
  const INITIAL_SEED = 738102459 & 0x7fffffff;
  let _seed = INITIAL_SEED;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // fallback roster (pre-polity-boot defensive floor only — see header).
  const FALLBACK_COUNTRIES = ["republic", "veridia", "kesh", "solara", "mbeya"];

  // ============================================================
  //  TUNING (all constants in one place, per repo convention)
  // ============================================================
  const NEUTRAL_POLICY_RATE = 0.04;    // must match city/bank.js's own fallback exactly — day-one-unchanged
  const RATE_FLOOR = 0.0, RATE_CEIL = 0.40;
  const DEFAULT_RESERVE_REQ = 0.10;
  const MIN_RESERVE_REQ = 0.02, MAX_RESERVE_REQ = 0.90;
  const DEPOSITS_BASE_SEED = 3000000;   // generous vs. bank.js's own worst-case outstanding credit (MAX_LOANS×PERSONAL_HARD_CAP=3,000,000) — see that file's header
  const DEPOSIT_GROWTH_COEF = 0.01;    // /day, scaled by (activity-1.0) — a hot economy grows the deposit base
  const DEPOSIT_WAR_DRAG = 0.01;       // /day extra contraction while a war is active

  const INDEPENDENCE_BY_GOV = {
    democracy: 0.8, monarchy: 0.6, communism: 0.3,
    fascism: 0.2, dictatorship: 0.2, emergencyRule: 0.45, anarchism: 0,
  };
  const DEFAULT_INDEPENDENCE = 0.5;
  const DECREE_INDEPENDENCE_FLOOR = 0.3;   // permanent scar once a bank has ever been decreed on

  const EMPLOYMENT_BASE = 0.92;        // mirrors sim/econstate.js's own EMPLOYMENT_BASE
  const ECON_ACTIVITY_COEF = 0.05, ECON_EMPLOYMENT_COEF = 0.05;
  const CURRENCY_LOOKBACK = 5;         // days
  const CURRENCY_DEFENSE_THRESH = 0.05, CURRENCY_DEFENSE_COEF = 0.6;
  const WAR_CUT_COEF = 0.02;
  const APPROVAL_T = 30, APPROVAL_CUT_COEF = 0.015;

  const MOVE_FRAC = 0.35;              // fraction of the gap closed per day
  const STEP_MIN = 0.0025, STEP_MAX = 0.01;   // ±0.25%..±1%/day
  const MOVE_DEADBAND = 0.0005;

  const GOVERNOR_VACANCY_DAYS = 2;     // matches officials.js's own CARETAKER_DAYS
  const GOV_DEATH_SHOCK_MIN = 0.04, GOV_DEATH_SHOCK_RANGE = 0.06;
  const DECREE_SHOCK_MIN = 0.03, DECREE_SHOCK_SCALE = 0.6, DECREE_SHOCK_MAX = 0.20;

  function isAuthoritarianGov(gov) { return gov === "fascism" || gov === "dictatorship"; }

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
  // capIdFor(countryId) -> the EconState jurisdiction id for that country's
  // capital settlement. sim/forex.js has the identical private helper (not
  // exported there either) — reimplemented here, small and self-contained,
  // same "not exported, so small enough to duplicate" precedent that file's
  // own header documents for relations.js's capitalEconIdFor.
  function capIdFor(id) {
    if (id === "republic") return (CBZ.econState && CBZ.econState.DEFAULT_ID) || "libertyville";
    const cd = (CBZ.COUNTRIES || []).find(function (c) { return c.id === id; });
    if (!cd) return null;
    const cap = (cd.settlements || []).find(function (s) { return s.capital; });
    return cap ? cap.id : null;
  }
  function econStateOf(capId) {
    if (!capId || !CBZ.econState || typeof CBZ.econState.get !== "function") return null;
    return CBZ.econState.get(capId);
  }

  // ============================================================
  //  STATE — g.centralBankState.banks[id]
  // ============================================================
  function freshBank(id) {
    const rec = countryRec(id);
    const govType = rec ? rec.govType : "democracy";
    return {
      countryId: id,
      governorSid: null, vacantSince: null,
      policyRate: NEUTRAL_POLICY_RATE,
      reserveReq: DEFAULT_RESERVE_REQ,
      independence: INDEPENDENCE_BY_GOV[govType] != null ? INDEPENDENCE_BY_GOV[govType] : DEFAULT_INDEPENDENCE,
      depositsBase: DEPOSITS_BASE_SEED,
      suspended: govType === "anarchism",
      decree: null,
      lastMove: 0,
      _independenceFloor: null,
    };
  }
  function reset() {
    const ids = countryIds();
    const banks = {};
    for (let i = 0; i < ids.length; i++) banks[ids[i]] = freshBank(ids[i]);
    g.centralBankState = { inited: false, banks: banks };
  }
  function ensureInit() {
    if (!g.centralBankState || !g.centralBankState.banks || typeof g.centralBankState.banks !== "object") { reset(); return; }
    // idempotent partial-heal (mirrors sim/forex.js's own ensureInit precedent):
    // a country somehow missing (roster growth, a stale save) gets seeded fresh.
    const ids = countryIds();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (!g.centralBankState.banks[id]) g.centralBankState.banks[id] = freshBank(id);
    }
  }
  function getBank(id) { ensureInit(); return g.centralBankState.banks[id || "republic"] || null; }

  // ============================================================
  //  GOVERNOR MINTING — officials.js's mintIdentity() shape, verbatim.
  // ============================================================
  function regionName(countryId, gender) {
    const cfg = CBZ.demographics && CBZ.demographics.CONFIGS ? CBZ.demographics.CONFIGS[countryId] : null;
    if (cfg) {
      const pool = gender === "f" ? cfg.firstF : cfg.firstM;
      if (pool && pool.length && cfg.surnames && cfg.surnames.length) {
        return pick(pool, rng()) + " " + pick(cfg.surnames, rng());
      }
    }
    if (CBZ.cityMintName) return CBZ.cityMintName(rng, gender);
    return gender === "f" ? "Adaeze Winthrop" : "Foster Winthrop";   // no-name fallback (should never hit)
  }
  function leaderNameOf(id) {
    const rec = countryRec(id);
    const sid = rec && rec.office ? rec.office.holder : null;
    if (sid && CBZ.officials && typeof CBZ.officials.identityOf === "function") {
      const idn = CBZ.officials.identityOf(sid);
      if (idn && idn.name) return idn.name;
    }
    return null;
  }
  function mintGovernor(bank) {
    if (!CBZ.cityPedStash) return null;
    const gender = rng() < 0.5 ? "f" : "m";
    const name = regionName(bank.countryId, gender);
    const obj = {
      _parked: true, nameKnown: true, kind: "civilian",
      name: name, gender: gender, archetype: "official", job: "central bank governor",
      wealth: 0.8, aggr: 0.08, cash: 3000 + Math.round(rng() * 8000),
    };
    CBZ.cityPedStash(obj);
    if (!obj._sid) return null;
    bank.governorSid = obj._sid;
    bank.vacantSince = null;
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(obj._sid);
    if (e) e.job = "central bank governor";
    const rec = countryRec(bank.countryId);
    const leader = leaderNameOf(bank.countryId);
    const countryName = rec ? rec.name : bank.countryId;
    if (CBZ.cityFeed) {
      CBZ.cityFeed("🏦 " + (leader ? leader + " appoints " : "") + name + " governor of " + countryName + "'s central bank.", "#ffd76a");
    }
    return obj._sid;
  }
  function mintAllGovernors() {
    ensureInit();
    const B = g.centralBankState.banks;
    for (const id in B) { if (!B[id].governorSid) mintGovernor(B[id]); }
    g.centralBankState.inited = true;
  }

  // ============================================================
  //  ASSASSINATION → SUCCESSION (own cityKillPed wrap, own guard flag).
  // ============================================================
  function bankByGovernorSid(sid) {
    ensureInit();
    const B = g.centralBankState.banks;
    for (const id in B) if (B[id].governorSid === sid) return B[id];
    return null;
  }
  function handleGovernorDeath(ped, sid) {
    const bank = bankByGovernorSid(sid);
    if (!bank) return;
    const rec = countryRec(bank.countryId);
    const name = (ped && ped.name) || (CBZ.officials && CBZ.officials.identityOf ? CBZ.officials.identityOf(sid).name : "The governor");
    bank.governorSid = null;
    bank.vacantSince = CBZ.worldDay ? CBZ.worldDay() : 0;
    // forex confidence knock — skipped for the republic (LBD never floats
    // against itself; see header).
    const ccy = rec && rec.currencyId;
    if (ccy && ccy !== "LBD" && CBZ.forex && typeof CBZ.forex.shock === "function") {
      try { CBZ.forex.shock(ccy, -(GOV_DEATH_SHOCK_MIN + rng() * GOV_DEATH_SHOCK_RANGE)); } catch (e) {}
    }
    const countryName = rec ? rec.name : bank.countryId;
    if (CBZ.city && CBZ.city.big) CBZ.city.big("💀 CENTRAL BANK GOVERNOR " + name + " ASSASSINATED");
    if (CBZ.cityFeed) CBZ.cityFeed("🏦 " + countryName + "'s central bank governor " + name + " assassinated — markets rattled.", "#ff6a5e");
  }
  if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._cbKillWrap) {
    const origKill = CBZ.cityKillPed;
    const wrappedKill = function (ped, imp, cause) {
      const sid = ped && ped._sid;
      const wasDead = !ped || ped.dead;
      const ret = origKill.apply(this, arguments);
      if (sid && !wasDead && ped && ped.dead) { try { handleGovernorDeath(ped, sid); } catch (e) {} }
      return ret;
    };
    wrappedKill._cbKillWrap = true;
    CBZ.cityKillPed = wrappedKill;
  }

  // ============================================================
  //  THE REACTION FUNCTION
  // ============================================================
  // computeTarget: `fundamentalsOnly` (used only by decree()'s own deviation
  // check) strips the war/approval POLITICAL-PRESSURE terms, leaving just
  // economy+currency+the M4 inflation seam — "what the bank would target on
  // fundamentals alone", the yardstick a decree is measured against.
  function computeTarget(id, rec, govType, independence, capId, fundamentalsOnly) {
    const st = econStateOf(capId);
    const activity = st && isFinite(st.activity) ? st.activity : 1.0;
    const employment = st && isFinite(st.employment) ? st.employment : EMPLOYMENT_BASE;
    const actGap = clampNum(-0.5, 0.5, activity - 1.0);
    const empGap = clampNum(-0.3, 0.3, employment - EMPLOYMENT_BASE);
    const econTerm = ECON_ACTIVITY_COEF * actGap + ECON_EMPLOYMENT_COEF * (empGap * 3);

    let currencyTerm = 0;
    const ccy = rec && rec.currencyId;
    if (ccy && ccy !== "LBD" && CBZ.forex && typeof CBZ.forex.quote === "function") {
      const q = CBZ.forex.quote(ccy);
      if (q && q.history && q.history.length > CURRENCY_LOOKBACK) {
        const past = q.history[q.history.length - 1 - CURRENCY_LOOKBACK];
        if (past > 0) {
          const pctChange = (q.rate - past) / past;
          if (pctChange < -CURRENCY_DEFENSE_THRESH) currencyTerm = CURRENCY_DEFENSE_COEF * (-pctChange - CURRENCY_DEFENSE_THRESH);
        }
      }
    }

    let warTerm = 0, approvalTerm = 0;
    if (!fundamentalsOnly) {
      const atWar = !!(CBZ.polwar && typeof CBZ.polwar.warsOf === "function" && CBZ.polwar.warsOf(id).length);
      if (atWar) warTerm = -WAR_CUT_COEF * (1 - independence);
      if (rec && isFinite(rec.approval) && rec.approval < APPROVAL_T) {
        approvalTerm = -APPROVAL_CUT_COEF * (1 - independence) * clamp01((APPROVAL_T - rec.approval) / APPROVAL_T);
      }
    }

    // M4 SEAM — see header. Defaults to 0 (installed on the exported object
    // below); a future wave overwrites CBZ.centralbank._inflationTerm with
    // the real π term and nothing else here changes.
    let inflationTerm = 0;
    if (CBZ.centralbank && typeof CBZ.centralbank._inflationTerm === "function") {
      try { const v = +CBZ.centralbank._inflationTerm(id); if (isFinite(v)) inflationTerm = v; } catch (e) {}
    }

    const target = NEUTRAL_POLICY_RATE + econTerm + currencyTerm + warTerm + approvalTerm + inflationTerm;
    return clampNum(RATE_FLOOR, RATE_CEIL, target);
  }
  // one bounded ±0.25%..±1% step toward target, never overshooting (closes
  // the remaining gap outright once it's smaller than STEP_MIN).
  function stepToward(rate, target) {
    const gap = target - rate;
    if (Math.abs(gap) < MOVE_DEADBAND) return 0;
    let mag = Math.abs(gap) * MOVE_FRAC;
    mag = Math.max(STEP_MIN, mag);
    mag = Math.min(STEP_MAX, mag);
    mag = Math.min(mag, Math.abs(gap));
    return Math.sign(gap) * mag;
  }
  // deposit-base drift — see header's CREDIT CAP section. Own small daily
  // move, independent of the rate-reaction step above.
  function driftDeposits(bank, capId) {
    const st = econStateOf(capId);
    const activity = st && isFinite(st.activity) ? st.activity : 1.0;
    let growth = (activity - 1.0) * DEPOSIT_GROWTH_COEF;
    if (CBZ.polwar && typeof CBZ.polwar.warsOf === "function" && CBZ.polwar.warsOf(bank.countryId).length) growth -= DEPOSIT_WAR_DRAG;
    bank.depositsBase = Math.max(0, bank.depositsBase * (1 + growth));
  }
  function tickBank(bank) {
    const id = bank.countryId;
    const rec = countryRec(id);
    const govType = rec ? rec.govType : "democracy";

    bank.independence = INDEPENDENCE_BY_GOV[govType] != null ? INDEPENDENCE_BY_GOV[govType] : DEFAULT_INDEPENDENCE;
    if (bank._independenceFloor != null) bank.independence = Math.min(bank.independence, bank._independenceFloor);

    const isAnarchic = govType === "anarchism";
    bank.suspended = isAnarchic;
    if (isAnarchic) { bank.lastMove = 0; return; }   // rate frozen while suspended — see header

    if (bank.decree && bank.decree.active) {
      if (!isAuthoritarianGov(govType)) {
        bank.decree.active = false;   // regime moderated — decree lapses (independence floor stays permanent)
      } else {
        bank.policyRate = bank.decree.rate;   // pinned — bypasses the reaction fn entirely
        bank.lastMove = 0;
        return;
      }
    }

    const capId = capIdFor(id);
    const target = computeTarget(id, rec, govType, bank.independence, capId, false);
    const step = stepToward(bank.policyRate, target);
    bank.policyRate = clampNum(RATE_FLOOR, RATE_CEIL, bank.policyRate + step);
    bank.lastMove = step;
    driftDeposits(bank, capId);
  }
  function tickAll(day) {
    ensureInit();
    const B = g.centralBankState.banks;
    for (const id in B) {
      const bank = B[id];
      try { tickBank(bank); } catch (e) { try { console.error("[centralbank] tickBank failed for " + id, e); } catch (e2) {} }
      // successor check (officials.js's own caretaker-days shape)
      if (bank.vacantSince != null && !bank.governorSid && (day - bank.vacantSince) >= GOVERNOR_VACANCY_DAYS) {
        try { mintGovernor(bank); } catch (e) {}
      }
    }
  }
  // CBZ.onNewDay is city/polity.js's own function — polity.js loads LATER
  // than this file (see header's LOAD ORDER note). Deferred registration,
  // same idiom sim/forex.js's own ensureDayTickRegistered() uses.
  let _dayTickRegistered = false;
  function ensureDayTickRegistered() {
    if (_dayTickRegistered) return;
    if (CBZ.onNewDay) { CBZ.onNewDay(tickAll); _dayTickRegistered = true; }
  }

  // ============================================================
  //  REGIME INTERFERENCE — decree()
  // ============================================================
  function decree(countryId, rate, opts) {
    opts = opts || {};
    const bank = getBank(countryId);
    if (!bank) return { ok: false, reason: "no such bank" };
    const rec = countryRec(countryId);
    const govType = rec ? rec.govType : null;
    if (!opts.force && !isAuthoritarianGov(govType)) return { ok: false, reason: "regime isn't authoritarian enough to decree a rate" };

    const clamped = clampNum(RATE_FLOOR, RATE_CEIL, num(rate, bank.policyRate));
    const capId = capIdFor(countryId);
    // fundamentals-only yardstick (no political-pressure terms, independence
    // treated as full=1 so the war/approval terms are moot either way — see
    // computeTarget's fundamentalsOnly branch) — how far is this decree from
    // what the bank would target on the real economy alone?
    const fundamentalsTarget = computeTarget(countryId, rec, govType, 1, capId, true);
    const deviation = Math.abs(clamped - fundamentalsTarget);

    bank.policyRate = clamped;
    bank.decree = { active: true, rate: clamped, day: CBZ.worldDay ? CBZ.worldDay() : 0 };
    bank.lastMove = 0;
    bank._independenceFloor = DECREE_INDEPENDENCE_FLOOR;   // permanent scar — see header

    const ccy = rec && rec.currencyId;
    if (ccy && ccy !== "LBD" && CBZ.forex && typeof CBZ.forex.shock === "function") {
      const shockFrac = -Math.min(DECREE_SHOCK_MAX, DECREE_SHOCK_MIN + deviation * DECREE_SHOCK_SCALE);
      try { CBZ.forex.shock(ccy, shockFrac); } catch (e) {}
    }
    const countryName = rec ? rec.name : countryId;
    if (CBZ.city && CBZ.city.big) CBZ.city.big("🏦 " + countryName.toUpperCase() + " RATE DECREED — " + (clamped * 100).toFixed(1) + "%");
    if (CBZ.cityFeed) CBZ.cityFeed("🏦 " + countryName + "'s central bank rate is DECREED at " + (clamped * 100).toFixed(1) + "% — independence gutted.", "#ff9e6b");
    return { ok: true, rate: clamped };
  }

  // ============================================================
  //  RESERVE-REQUIREMENT CREDIT CAP — see header.
  // ============================================================
  function outstandingCreditFor(countryId) {
    // bank.js is the ONE real credit-issuance ledger today (republic only —
    // see header's scope note). A future wave that adds NPC credit anywhere
    // sums it into this same read.
    if (countryId !== "republic") return 0;
    const L = g.cityLoans || [];
    let s = 0;
    for (let i = 0; i < L.length; i++) { const r = L[i]; if (r && isFinite(r.balance) && r.balance > 1) s += r.balance; }
    return s;
  }
  function creditCap(countryId) {
    const bank = getBank(countryId);
    if (!bank) return Infinity;
    if (bank.suspended) return 0;   // anarchism — zero new credit, see header
    const rr = clampNum(MIN_RESERVE_REQ, MAX_RESERVE_REQ, num(bank.reserveReq, DEFAULT_RESERVE_REQ));
    return Math.max(0, num(bank.depositsBase, 0)) / rr;
  }
  function creditHeadroom(countryId, outstanding) {
    const cap = creditCap(countryId);
    if (!isFinite(cap)) return Infinity;
    const used = outstanding != null ? Math.max(0, num(outstanding, 0)) : outstandingCreditFor(countryId);
    return Math.max(0, cap - used);
  }
  function setReserveReq(countryId, rr) {
    const bank = getBank(countryId);
    if (!bank) return false;
    bank.reserveReq = clampNum(MIN_RESERVE_REQ, MAX_RESERVE_REQ, num(rr, DEFAULT_RESERVE_REQ));
    return true;
  }

  // ============================================================
  //  READS
  // ============================================================
  function rate(countryId) { const b = getBank(countryId); return b ? b.policyRate : NEUTRAL_POLICY_RATE; }
  function governorName(bank) {
    if (!bank || !bank.governorSid) return null;
    if (CBZ.officials && typeof CBZ.officials.identityOf === "function") {
      const idn = CBZ.officials.identityOf(bank.governorSid);
      if (idn && idn.name) return idn.name;
    }
    return null;
  }
  function snapshot(countryId) {
    const bank = getBank(countryId);
    if (!bank) return null;
    const rec = countryRec(countryId);
    return {
      id: countryId, name: rec ? rec.name : countryId,
      policyRate: bank.policyRate, reserveReq: bank.reserveReq, independence: bank.independence,
      governorSid: bank.governorSid, governorName: governorName(bank),
      suspended: !!bank.suspended, decreed: !!(bank.decree && bank.decree.active),
      lastMove: bank.lastMove,
    };
  }
  function list() {
    ensureInit();
    const ids = countryIds(), out = [];
    for (let i = 0; i < ids.length; i++) { const s = snapshot(ids[i]); if (s) out.push(s); }
    return out;
  }

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serialize() {
    ensureInit();
    const banks = {};
    const B = g.centralBankState.banks;
    for (const id in B) {
      const b = B[id];
      banks[id] = {
        governorSid: b.governorSid || null, vacantSince: b.vacantSince,
        policyRate: b.policyRate, reserveReq: b.reserveReq, independence: b.independence,
        depositsBase: b.depositsBase, suspended: !!b.suspended,
        decree: b.decree ? { active: !!b.decree.active, rate: b.decree.rate, day: b.decree.day } : null,
        lastMove: b.lastMove, independenceFloor: b._independenceFloor != null ? b._independenceFloor : null,
      };
    }
    return { v: 1, inited: !!g.centralBankState.inited, banks: banks };
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1) return;
    g.centralBankState.inited = !!obj.inited;
    const B = g.centralBankState.banks;
    if (obj.banks) for (const id in obj.banks) {
      const src = obj.banks[id];
      if (!src) continue;
      if (!B[id]) B[id] = freshBank(id);
      const b = B[id];
      b.governorSid = src.governorSid || null;
      b.vacantSince = src.vacantSince != null ? src.vacantSince : null;
      if (isFinite(src.policyRate)) b.policyRate = clampNum(RATE_FLOOR, RATE_CEIL, +src.policyRate);
      if (isFinite(src.reserveReq)) b.reserveReq = clampNum(MIN_RESERVE_REQ, MAX_RESERVE_REQ, +src.reserveReq);
      if (isFinite(src.independence)) b.independence = clamp01(+src.independence);
      if (isFinite(src.depositsBase)) b.depositsBase = Math.max(0, +src.depositsBase);
      b.suspended = !!src.suspended;
      b.decree = src.decree ? { active: !!src.decree.active, rate: isFinite(src.decree.rate) ? +src.decree.rate : b.policyRate, day: src.decree.day || 0 } : null;
      b.lastMove = isFinite(src.lastMove) ? +src.lastMove : 0;
      b._independenceFloor = (src.independenceFloor != null && isFinite(src.independenceFloor)) ? +src.independenceFloor : null;
    }
  }

  CBZ.centralbank = {
    rate: rate,
    list: list,
    snapshot: snapshot,
    decree: decree,
    setReserveReq: setReserveReq,
    creditCap: creditCap,
    creditHeadroom: creditHeadroom,
    reset: reset,
    serialize: serialize,
    apply: apply,
    // M4 SEAM — see header. Overwrite this with the real inflation term;
    // computeTarget() already reads it every tick.
    _inflationTerm: function () { return 0; },
    // harness/test-only hooks — not part of the public contract (mirrors
    // sim/forex.js's own _state()/_rate0 precedent).
    _state: function () { ensureInit(); return g.centralBankState; },
    _getBank: getBank,
    _mintGovernor: mintGovernor,
    _setDepositsBase: function (countryId, amount) { const b = getBank(countryId); if (b) b.depositsBase = Math.max(0, num(amount, 0)); return !!b; },
    _tickAll: tickAll,
  };

  // ============================================================
  //  SINGLE-PLAYER PERSIST — sim/forex.js's g.cityWorld pattern, verbatim.
  // ------------------------------------------------------------
  function stampCb() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.cb = serialize();
  }
  let _ensureCbSaveWraps_done = false;
  function ensureCbSaveWraps() {
    if (_ensureCbSaveWraps_done) return;
    _ensureCbSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._cbWrap) {
      const w = function () { stampCb(); return commit.apply(this, arguments); };
      w._cbWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._cbWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampCb(); return col.apply(this, arguments); };
      wc._cbWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedCbLedger = null;
  function hydrateCbFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedCbLedger) return;
    _hydratedCbLedger = led;
    if (led.cb) apply(led.cb);
  }

  // ============================================================
  //  INSTALL TICK — mint governors (one-shot) + day-tick registration +
  //  save wraps + ledger hydrate. Runs right after sim/forex.js's own 46.22
  //  install tick (next free slot; officials.js's own founding mint at 46.08
  //  has already run this same frame, so a country's office.holder is
  //  already live for the mint-feed's leader-name flavor line).
  // ------------------------------------------------------------
  CBZ.onUpdate(46.23, function () {
    if (!g) return;
    ensureDayTickRegistered();
    ensureCbSaveWraps();
    hydrateCbFromLedger();
    if (g.mode !== "city") return;
    ensureInit();
    if (g.centralBankState.inited) return;
    try { mintAllGovernors(); } catch (e) {}
  });
})();
