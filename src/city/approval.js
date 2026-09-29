/* ============================================================
   city/approval.js — Stage P, step P3: THE APPROVAL EQUATION (the Shift+P
   politics panel described below was removed 2026-09-27; see the tail).

   MASTER-PLAN V.3 (verbatim): "Per jurisdiction, five normalized inputs:
   econ (property index + confidence + employment), crime (heat, Σ gang
   warIntensity, 7-day murder counter), services/taxes, events (decaying
   shocks: disasters −15, assassination −10, war declared −12/won +15),
   propaganda (0-20, bought from treasury). target = 50 + 28·econ + 26·
   crime + 18·services + events + propaganda; approval += (target −
   approval)·dt/τ, τ = 90s." THIS FILE ships the P3 task brief's adapted
   coefficients (22/22/16, see EQUATION below) — tuned down from V.3's
   28/26/18 to match what this wave ACTUALLY wires (only one fully-live
   econ+hunger jurisdiction — libertyville — exists yet, see NARROWING).

   ============================================================
   THE EQUATION, as shipped, one input at a time — every number here reads
   a field some earlier wave already writes and previously nobody read
   (VI.1's "write-only, free depth" list):

     econ = 0.5·clamp(-1,1,(activity−1)·4)
          + 0.3·clamp(-1,1,(confidence−70)/30)
          − 0.2·(1−employment)
       activity/employment: sim/econstate.js's summary(id) (daily-settled,
       driven by wagesProxy/safety/the living headcount — see that file).
       confidence: city/worldstate.js's w.economy.confidence (VI.1: written
       by war/disaster/recovery events, rests at 100 — never read before
       E2). (confidence−70)/30 reads 1.0 at the 100 resting value — i.e.
       this wave's day-one econ term leans POSITIVE by design (nothing bad
       has happened yet), same "day one changes nothing OBSERVABLE, but the
       equation is live" spirit as econstate.js's own header.

     crime = −(0.4·min(1, heat/650)
             + 0.3·min(1, ΣwarIntensity/4)
             + 0.3·min(1, murders7d/15))
       heat: g.heat (city/wanted.js; 650 ≈ just past 2-star, config.js:244).
       ΣwarIntensity: live sum over CBZ.cityGangs[*].warIntensity (gangs.js,
       0..3 per gang; 4 is "two gangs both maxed" headroom).
       murders7d: OWN rolling 7-day counter, this file's own cityKillPed
       wrap (see MURDER RING below) — nobody else counts city murders.

     services = 0.5·(0.10 − taxRate)/0.10 − 0.4·miseryIndex()
       taxRate: the LIVE jurisdiction's own polity.js record.taxRate (the
       political tax knob V.2's "player sets taxes" lever will turn later —
       comment: this wave nobody moves it off its 0.10 seed, so the term
       reads exactly 0 until P4/regimes.js exist to move it — that's the
       whole point of wiring the real field now instead of a placeholder).
       miseryIndex(): systems/hunger.js's X2 civil-war fuse (0..1 blend of
       cohort hunger + wallet health) — UNCONSUMED there ("exported now,
       unconsumed until X6b" says that file's header); THIS is its first
       real consumer. A starving city is a city sliding out of office.

     events = shock(id) [own decaying accumulator, see SHOCKS below]
            − scandal·0.1   (w.politics.scandal, VI.1's write-only field —
              city/activities.js's corrupt-permit-deal path and worldstate.
              js's own assassination path both already write it; NOTHING
              read it before this line)
       Disasters: systems/disasters.js gates its entire strike/tick surface
       on `CBZ.game.mode !== "survival" → return` — i.e. disasters ONLY
       run in survival mode this wave, never in the city. There is no
       city-mode disaster-strike hook to wire an events shock off of yet
       (a future wave that ports disasters into city mode gets a one-line
       CBZ.approvalShock(id, -15) call here — comment only, no call site).

     propaganda = w.politics.support · 0.1
       w.politics.support: VI.1's OTHER write-only field — city/activities.
       js's campaign-event activity (line ~192) already does cityEvent
       ("politics", {support: …}); this is the first read. "The existing
       campaign activity finally matters" (task brief, verbatim) — a
       player who runs the mayor's campaign now moves the actual approval
       equation, not just a silent ledger number.

     target   = clamp(2, 98, 50 + 22·econ + 22·crime + 16·services
                              + events + propaganda)
     approval += (target − approval) · sliceDt / 90        (τ = 90s)

   NARROWING (this wave, like officials.js's own mayor-only physical
   presence): the FULL five-input equation only runs for a "city" record
   that has a REAL sim/econstate.js jurisdiction behind it (polity.js's
   `.econ` pointer — this wave that is exactly ONE city, libertyville; the
   4 mini-cities have "no simulation hooks at all" per VI.1's own audit).
   Generalized off that pointer (not hardcoded to the id string) so the
   day a Part-III generator or M2 gives goldspire/capeharbor/neonreef/
   foundry a real EconState, they start converging for free — no edit here.
   States/country (liberty/costa/westmark/republic) get a SLOWER, dumber
   blend instead: once per worldDay, lerp toward the unweighted average of
   their child cities'/states' approval (see STATE/COUNTRY BLEND below) —
   comment: population/wealth-weighted blending and the states' OWN direct
   inputs (a governor's competence, district-level data) are M-stage depth,
   not this wave's.

   MURDER RING: a 7-slot ring PER JURISDICTION (not global — forward-
   compatible with the day mini-cities get real violence tracking too),
   indexed by worldDay % 7. This file's own cityKillPed wrap (loaded LAST
   in the P-wave, same "capture off the live ped BEFORE orig() runs, act
   after" discipline every other wrap in this file family uses — see
   officials.js/inheritance.js/billionaires.js/killfeed.js) increments the
   CURRENT day's bucket on a CONFIRMED kill (wasDead false → true) while
   g.mode === "city", classified EXACTLY like city/killfeed.js's own
   byPlayer/attacker heuristic (no reason to invent a second one):
     byPlayer  = imp.byPlayer !== false && !imp.attacker
     npcMurder = imp.attacker && typeof imp.attacker === "object"
   i.e. a deliberate player kill OR an NPC-on-NPC kill (gang war, cop
   shootouts) counts; an unattributed environmental death (fall, vehicle
   without a driver, etc.) does not — "murder", not "death toll".
   murders7d(id) = sum of all 7 buckets (today's partial bucket included —
   a genuinely ROLLING week, not a fixed calendar one). CBZ.onNewDay clears
   the bucket about to be reused (day % 7) BEFORE the new day's kills land
   in it, which is the "decay by /7 replacement" the task brief asks for:
   a bucket ages out exactly 7 days after the day it was written, no
   half-life math needed.

   SHOCKS: CBZ.approvalShock(id, amount) is a NEW, GENERIC public API — a
   per-jurisdiction accumulator, clamped to ±50 so no single caller can
   blow the equation out to the rails. Per the task brief: "officials'
   assassination migrates to call this... DON'T refactor officials.js;
   just expose the API." officials.js's OWN vacuum handling (rec.approval
   -= 15, a direct one-shot mutation on the LIVE approval number, not this
   accumulator) is untouched — it still fires exactly as P2 shipped it.
   Because THIS file's convergence tick runs every second afterward, that
   direct −15 nudge gets pulled back toward whatever the target equation
   says over the next τ≈90s the same as any other one-off perturbation —
   a deliberate, documented consequence of "don't refactor officials.js",
   not a bug: a real successor migration (P4/P5/P8, when election fraud/
   war declarations/coups exist) starts calling CBZ.approvalShock() instead
   for a shock that persists and decays on ITS OWN schedule rather than
   being smoothed away in under two minutes. Shocks decay CONTINUOUSLY
   (every 1Hz slice, not just daily) toward 0 at SHOCK_DECAY_RATE, chosen
   so an untouched shock roughly halves every 2 in-game days (300s).

   HISTORY: a 48-sample ring per jurisdiction, one sample every 30 in-game
   minutes (HOUR/2 — 48 samples × 30min = one full day of sparkline,
   matching econstate.js's own "48 hourly samples" cadence choice, just
   half-hourly since approval moves slower than prices). Deliberately NOT
   persisted (ephemeral, cheap to rebuild) — same call econstate.js/
   market.js make for their own history rings.

   THE POLITICS PANEL — KEY AUDIT (grep `k === "` across src for every
   single-letter keydown binding turned up SOMETHING bound to all but a
   handful of letters in this codebase; two are worth walking through
   because the task brief specifically asks for them):
     - [P] is HARD taken: city/phone.js's own global toggle ("if (k ===
       'p' && !e.repeat && !CBZ.cityMenuOpen && !driving) open()") — the
       single most frequently pressed menu key in the whole game. Rejected
       outright, no contest.
     - [O] LOOKS free at a glance but is not: city/charpanel.js's HUD-hide
       toggle ("[O] HIDE-HUD — H was already owned...; O is verified-
       unbound" — that comment is now STALE) and city/playergang.js's own
       gang-menu-open both bind bare 'o' as a GLOBAL, ordinary-play toggle
       (gated only on cityMenuOpen/state, never on a submenu already being
       open — unlike familypanel.js's rejected-then-accepted L, whose
       collisions were all narrowly gated to another panel's OWN open
       state). The two of THEM already double-fire on every 'o' press
       today (a pre-existing collision, not this file's to fix) — stacking
       a THIRD action (open politics) onto that same keystroke would mean
       one press hides the HUD, opens the gang menu, AND opens this panel
       simultaneously. That is worse than "conflict", it is unusable.
     DECISION: mirror city/wealth.js's OWN precedent for this exact
     situation ("B solo is taken; OPEN: Shift+B, this chord is unused
     elsewhere") — [P] is taken the same hard way B was, so this panel
     opens on Shift+P. Verified unbound (grep for `shiftKey` + `"p"`
     anywhere in src turns up nothing). Reported here rather than silently
     deviating from the task brief's literal "else O" fallback, because O
     turned out to be the SAME kind of hard, ordinary-play collision the
     brief's own P audit was screening for — not the narrowly-gated kind
     familypanel accepted for L.

   PANEL CONTENT (per jurisdiction card, all "city" + "state" + "country" +
   "federal" records — legibility over pretending only libertyville
   exists): name, officeholder (city/officials.js's identityOf(sid), the
   SAME public accessor that file already exposes — no duplicate name
   lookup invented here), an approval bar + canvas sparkline (phone.js's
   MARKETS app's exact pattern: DOM string first, a small <canvas id=...>
   painted post-render by drawSparkline(), reused verbatim in shape), the
   5 labeled input mini-bars (only for a jurisdiction with live inputs —
   others plainly say "not simulated yet", same honesty econstate.js's own
   VI.1 audit models), term countdown (office.termDay − worldDay), and the
   misery index (global this wave — systems/hunger.js only tracks the
   mainland's 5 districts, so it is shown once, on libertyville's card,
   labeled "city-wide"). Refreshes every 2s while open, closes on
   Shift+P/Escape/✕ — captives.js/familypanel.js's exact toggle shape.

   FEED LINES: threshold crossings, edge-triggered (fires once on ENTERING
   the below-35 or above-65 band, rearms only once approval returns to the
   35-65 neutral band) — "throttled" per the task brief, without a timer.

   PERSISTENCE: approval itself already rides polity.js's OWN serialize()
   (its header says so verbatim, verified — `approval` is one of the
   fields polity.js's serialize()/apply() carries). THIS file's own blob
   carries only what polity.js's shape CAN'T: the murder rings + shock
   accumulators (both keyed by jurisdiction id). History is NOT persisted
   (ephemeral, per econstate.js's own precedent). SINGLE-PLAYER only this
   wave (systems/hunger.js's own header claims a netpersist.js multiplayer
   rider that was never actually added there either — same gap, not
   re-litigated here; a future wave can add blob.apr beside blob.pol).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const HOUR = CBZ.PACE_DAY_SECONDS / 24;          // one PACE hour in real s (core/daynight.js): gameplay pace, not the sun
  const TAU = 90;                 // V.3's convergence time constant (seconds)
  const HIST_SAMPLE = HOUR / 2;   // one sample every 30 in-game minutes
  const HIST_CAP = 48;            // 48 half-hourly samples = one full in-game day of sparkline
  const MURDER_RING_LEN = 7;
  const TAX_BASELINE = 0.10;
  const HEAT_NORM = 650;          // g.heat normalizer (config.js:244 starHeat — just past 2-star)
  const WAR_NORM = 4;
  const MURDER_NORM = 15;
  const SHOCK_CAP = 50;           // clamp on the raw accumulator so no single shock rails the equation
  const SHOCK_DECAY_RATE = Math.LN2 / (2 * 150); // halves every 2 in-game days (a day = 150s)
  const STATE_BLEND_LERP = 0.25;  // daily lerp factor: state approval -> avg(child cities)
  const COUNTRY_BLEND_LERP = 0.20; // daily lerp factor: country approval -> avg(child states)
  const FEED_LOW = 35, FEED_HIGH = 65;
  // M4: INFLATION TERM — BUILD-PLAN's own "−12·max(0, π−5%)" read literally
  // (π as a fraction, −12 as the coefficient) is far too weak to read as
  // "politically lethal": at π=15% that's only −1.2, less than a rounding
  // error next to the ±22-point econ/crime terms below. CALIBRATION (this
  // file's own report documents the choice too): those two terms scale a
  // raw input ∈[-1,1] by 22, so a SINGLE input maxes out around ±22 — the
  // scale this equation's other terms live at. Reading the plan's intent
  // ("10% excess inflation costs ~double-digit approval") against that
  // scale: INFLATION_COEF=120 puts 10 points of excess π (π=15%) at exactly
  // −12 (120·0.10), squarely in the same double-digit range crime/econ
  // themselves produce — the plan's own coefficient, reinterpreted at the
  // SAME per-point scale its sibling terms already use, not literally
  // multiplied by the raw fractional π. No cap on the term itself (like
  // events/propaganda below, only the FINAL target clamps to [2,98]) — a
  // president facing real hyperinflation (M6) should be able to bleed
  // approval faster than any other single input, which is the point.
  const INFLATION_COEF = 120, INFLATION_THRESHOLD = 0.05;

  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

  // ============================================================
  //  STATE — g.approvalWorld: {shock, murderRing, hist, tickAcc, sampleAcc, feedFlags}
  // ============================================================
  function freshState() {
    return { shock: {}, murderRing: {}, hist: {}, tickAcc: 0, sampleAcc: 0, feedFlags: {} };
  }
  function reset() { g.approvalWorld = freshState(); lastInputs = {}; }
  function ensureInit() {
    if (!g.approvalWorld) { reset(); return; }
    if (!g.approvalWorld.shock) g.approvalWorld.shock = {};
    if (!g.approvalWorld.murderRing) g.approvalWorld.murderRing = {};
    if (!g.approvalWorld.hist) g.approvalWorld.hist = {};
    if (!g.approvalWorld.feedFlags) g.approvalWorld.feedFlags = {};
  }
  // cached per-jurisdiction last-computed inputs (panel legibility read) —
  // runtime-only, rebuilt every slice tick, never persisted.
  let lastInputs = {};

  function ring(id) {
    ensureInit();
    const M = g.approvalWorld;
    if (!M.murderRing[id]) M.murderRing[id] = new Array(MURDER_RING_LEN).fill(0);
    return M.murderRing[id];
  }
  function murders7d(id) {
    const r = ring(id);
    let sum = 0;
    for (let i = 0; i < r.length; i++) sum += r[i];
    return sum;
  }

  // ============================================================
  //  SHOCKS — CBZ.approvalShock(id, amount): the new, generic public API
  // ============================================================
  CBZ.approvalShock = function (id, amount) {
    if (!id || !isFinite(amount)) return;
    ensureInit();
    const M = g.approvalWorld;
    M.shock[id] = clampNum(-SHOCK_CAP, SHOCK_CAP, (M.shock[id] || 0) + amount);
  };
  function decayShocks(sliceDt) {
    ensureInit();
    const M = g.approvalWorld;
    for (const id in M.shock) {
      const v = M.shock[id];
      if (!v) continue;
      const nv = v - v * SHOCK_DECAY_RATE * sliceDt;
      M.shock[id] = Math.abs(nv) < 0.001 ? 0 : nv;
    }
  }

  // ============================================================
  //  JURISDICTION HELPERS
  // ============================================================
  function allJurisdictions() {
    if (!CBZ.polity) return [];
    return [].concat(
      CBZ.polity.list("city"), CBZ.polity.list("state"),
      CBZ.polity.list("country"), CBZ.polity.list("federal"));
  }
  // a "city" record counts as fully instrumented iff sim/econstate.js
  // actually tracks a jurisdiction behind its `.econ` pointer (polity.js's
  // header names this field) — this wave that is exactly libertyville.
  function econOf(rec) {
    if (!CBZ.econState || !rec) return null;
    return CBZ.econState.get(rec.econ || rec.id);
  }
  function holderNameOf(rec) {
    const sid = rec && rec.office && rec.office.holder;
    if (sid && CBZ.officials && CBZ.officials.identityOf) {
      const idn = CBZ.officials.identityOf(sid);
      if (idn && idn.name) return idn.name;
    }
    return (rec && rec.name) || "Someone";
  }

  // ============================================================
  //  THE FIVE INPUTS
  // ============================================================
  function econInput(rec, es) {
    if (!es) return 0; // no EconState behind this jurisdiction yet — neutral
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    const confidence = (w && w.economy && w.economy.confidence != null) ? w.economy.confidence : 100;
    const a = clampNum(-1, 1, (es.activity - 1) * 4);
    const b = clampNum(-1, 1, (confidence - 70) / 30);
    return 0.5 * a + 0.3 * b - 0.2 * (1 - es.employment);
  }
  function crimeInput(rec) {
    const heat = g.heat || 0;
    let warSum = 0;
    const gangs = CBZ.cityGangs || [];
    for (let i = 0; i < gangs.length; i++) warSum += gangs[i].warIntensity || 0;
    const m7 = murders7d(rec.id);
    return -(0.4 * Math.min(1, heat / HEAT_NORM) + 0.3 * Math.min(1, warSum / WAR_NORM) + 0.3 * Math.min(1, m7 / MURDER_NORM));
  }
  function servicesInput(rec) {
    const taxRate = rec.taxRate != null ? rec.taxRate : TAX_BASELINE;
    const misery = (CBZ.hunger && CBZ.hunger.miseryIndex) ? CBZ.hunger.miseryIndex() : 0;
    return 0.5 * (TAX_BASELINE - taxRate) / TAX_BASELINE - 0.4 * misery;
  }
  function eventsInput(rec) {
    ensureInit();
    const shock = g.approvalWorld.shock[rec.id] || 0;
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    const scandal = (w && w.politics && w.politics.scandal) || 0;
    return shock - scandal * 0.1;
  }
  function propagandaInput() {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    const support = (w && w.politics && w.politics.support) || 0;
    return support * 0.1;
  }
  // M4: inflation input — sim/inflation.js's own π for this jurisdiction's
  // country (accepts either a country id or a capital/jurisdiction id — see
  // that file's header; `rec.econ || rec.id` is the SAME jurisdiction key
  // econOf() above already reads). Guarded — 0 (no political cost) if
  // sim/inflation.js isn't loaded, matching every other guarded read in
  // this file. Already at final scale (like events/propaganda below) —
  // targetFrom adds it directly, no further coefficient at the call site.
  function inflationInput(rec) {
    if (!CBZ.inflation || typeof CBZ.inflation.rateForJurisdiction !== "function") return 0;
    const pi = CBZ.inflation.rateForJurisdiction(rec.econ || rec.id);
    if (!isFinite(pi)) return 0;
    return -INFLATION_COEF * Math.max(0, pi - INFLATION_THRESHOLD);
  }
  // pure function, exported for the harness: given the 6 raw inputs, the
  // exact target formula (no game-state reads) — lets the harness verify
  // the arithmetic at a fixed vector without mocking every subsystem.
  // `inflation` defaults to 0 so pre-M4 5-arg call sites/harnesses still work.
  function targetFrom(econ, crime, services, events, propaganda, inflation) {
    inflation = inflation || 0;
    return clampNum(2, 98, 50 + 22 * econ + 22 * crime + 16 * services + events + propaganda + inflation);
  }
  function computeInputs(rec) {
    const es = econOf(rec);
    const econ = econInput(rec, es);
    const crime = crimeInput(rec);
    const services = servicesInput(rec);
    const events = eventsInput(rec);
    const propaganda = propagandaInput();
    const inflation = inflationInput(rec);
    return {
      hasEcon: !!es, econ: econ, crime: crime, services: services, events: events, propaganda: propaganda, inflation: inflation,
      target: targetFrom(econ, crime, services, events, propaganda, inflation),
    };
  }

  // ============================================================
  //  FEED LINES — edge-triggered threshold crossings
  // ============================================================
  function checkThresholdFeed(rec) {
    ensureInit();
    const M = g.approvalWorld;
    const flags = M.feedFlags[rec.id] || (M.feedFlags[rec.id] = { low: false, high: false });
    if (rec.approval < FEED_LOW) {
      if (!flags.low) {
        flags.low = true; flags.high = false;
        if (CBZ.cityFeed) CBZ.cityFeed("" + holderNameOf(rec) + " approval collapsing", "#ff6a5e");
      }
    } else if (rec.approval > FEED_HIGH) {
      if (!flags.high) {
        flags.high = true; flags.low = false;
        if (CBZ.cityFeed) CBZ.cityFeed("" + holderNameOf(rec) + " riding high", "#8fe08a");
      }
    } else {
      flags.low = false; flags.high = false; // back in the neutral band — rearm both edges
    }
  }

  // ============================================================
  //  THE 1Hz SLICE TICK (order 33.0, per the plan)
  // ============================================================
  function sliceTick(sliceDt) {
    decayShocks(sliceDt);
    const cities = CBZ.polity ? CBZ.polity.list("city") : [];
    for (let i = 0; i < cities.length; i++) {
      const rec = cities[i];
      const es = econOf(rec);
      if (!es) continue; // mini-city with no EconState yet — approval stays put, see NARROWING
      const inp = computeInputs(rec);
      rec.approval = clampNum(0, 100, rec.approval + (inp.target - rec.approval) * sliceDt / TAU);
      lastInputs[rec.id] = inp;
      checkThresholdFeed(rec);
    }
  }
  CBZ.onUpdate(33.0, function (dt) {
    if (g.mode !== "city") return;
    ensureInit();
    const M = g.approvalWorld;
    M.tickAcc = (M.tickAcc || 0) + dt;
    while (M.tickAcc >= 1) { M.tickAcc -= 1; sliceTick(1); }
    M.sampleAcc = (M.sampleAcc || 0) + dt;
    while (M.sampleAcc >= HIST_SAMPLE) { M.sampleAcc -= HIST_SAMPLE; sampleHistory(); }
  });

  // ---- HISTORY: 48-sample ring, one sample per 30 in-game minutes --------
  function sampleHistory() {
    ensureInit();
    const M = g.approvalWorld;
    const recs = allJurisdictions();
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      if (!M.hist[rec.id]) M.hist[rec.id] = [];
      const arr = M.hist[rec.id];
      arr.push(Math.round(rec.approval * 10) / 10);
      if (arr.length > HIST_CAP) arr.shift();
    }
  }
  function history(id) {
    ensureInit();
    const arr = g.approvalWorld.hist[id];
    return arr ? arr.slice() : [];
  }

  // ============================================================
  //  MURDER RING — own cityKillPed wrap (see header for classification)
  // ============================================================
  function recordMurder(ped) {
    if (g.mode !== "city" || !ped || !ped.pos) return;
    const rec = CBZ.polity && CBZ.polity.of ? CBZ.polity.of(ped.pos.x, ped.pos.z) : null;
    if (!rec) return;
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    ring(rec.id)[day % MURDER_RING_LEN]++;
  }
  if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._aprWrap) {
    const orig = CBZ.cityKillPed;
    const wrapped = function (ped, imp, cause) {
      const wasDead = !ped || ped.dead;
      const ret = orig.apply(this, arguments);
      if (ped && !wasDead && ped.dead) {
        const info = imp || {};
        // same byPlayer/attacker heuristic city/killfeed.js already uses —
        // one classification scheme for "who did this", not two.
        const byPlayer = info.byPlayer !== false && !info.attacker;
        const npcMurder = info.attacker && typeof info.attacker === "object";
        if (byPlayer || npcMurder) { try { recordMurder(ped); } catch (e) {} }
      }
      return ret;
    };
    wrapped._aprWrap = true;
    CBZ.cityKillPed = wrapped;
  }

  // ============================================================
  //  NEW-DAY HOOK: murder-ring bucket clear + state/country blend
  // ============================================================
  if (CBZ.onNewDay) {
    CBZ.onNewDay(function (day) {
      ensureInit();
      const M = g.approvalWorld;
      // clear the bucket about to be reused BEFORE today's kills land in it
      // — this IS the "decay by /7 replacement" the task brief asks for.
      for (const id in M.murderRing) M.murderRing[id][day % MURDER_RING_LEN] = 0;

      if (!CBZ.polity) return;
      // STATE/COUNTRY BLEND: slower, dumber than the city equation above —
      // an unweighted daily lerp toward the average of direct children.
      // Comment (per task brief): population/wealth-weighted blending and
      // any state/country-LEVEL inputs of their own are M-stage depth —
      // this wave, a governor's approval is purely a shadow of their cities.
      const cities = CBZ.polity.list("city");
      const states = CBZ.polity.list("state");
      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        const kids = cities.filter(function (c) { return c.parent === s.id; });
        if (!kids.length) continue;
        let sum = 0; for (let j = 0; j < kids.length; j++) sum += kids[j].approval;
        const avg = sum / kids.length;
        s.approval = clampNum(0, 100, s.approval + (avg - s.approval) * STATE_BLEND_LERP);
      }
      const countries = CBZ.polity.list("country");
      for (let i = 0; i < countries.length; i++) {
        const c = countries[i];
        const kidStates = states.filter(function (s) { return s.parent === c.id; });
        if (!kidStates.length) continue;
        let sum = 0; for (let j = 0; j < kidStates.length; j++) sum += kidStates[j].approval;
        const avg = sum / kidStates.length;
        c.approval = clampNum(0, 100, c.approval + (avg - c.approval) * COUNTRY_BLEND_LERP);
      }
    });
  }

  // ============================================================
  //  PUBLIC DATA API
  // ============================================================
  CBZ.approvalState = {
    inputs: function (id) { return lastInputs[id] || null; },
    history: history,
    murders7d: murders7d,
    holderName: holderNameOf,
    // exported pure helper — no game-state reads, harness-friendly.
    targetFrom: targetFrom,
    serialize: function () {
      ensureInit();
      const M = g.approvalWorld;
      return { v: 1, shock: Object.assign({}, M.shock), murderRing: JSON.parse(JSON.stringify(M.murderRing)) };
    },
    apply: function (obj) {
      reset();
      if (!obj || obj.v !== 1) return;
      const M = g.approvalWorld;
      if (obj.shock) for (const id in obj.shock) if (isFinite(obj.shock[id])) M.shock[id] = clampNum(-SHOCK_CAP, SHOCK_CAP, +obj.shock[id]);
      if (obj.murderRing) for (const id in obj.murderRing) {
        const src = obj.murderRing[id];
        if (Array.isArray(src)) {
          const arr = new Array(MURDER_RING_LEN).fill(0);
          for (let i = 0; i < MURDER_RING_LEN && i < src.length; i++) arr[i] = isFinite(src[i]) ? +src[i] : 0;
          M.murderRing[id] = arr;
        }
      }
    },
    reset: reset,
    // harness-only hooks — not part of the public contract.
    _sliceTick: sliceTick,
    _computeInputs: computeInputs,
    _sampleHistory: sampleHistory,
    _decayShocks: decayShocks,
  };
  CBZ.approvalReset = reset;

  // ============================================================
  //  SINGLE-PLAYER PERSIST — the same g.cityWorld pattern every P/E/X-wave
  //  file uses: stamp before the existing commit/collect hooks run, hydrate
  //  back out whenever that ledger object's REFERENCE changes. Own guard
  //  flag (_aprWrap2 — the cityKillPed wrap above already claims _aprWrap).
  // ------------------------------------------------------------
  function stampApproval() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.apr = CBZ.approvalState.serialize();
  }
  let _ensureApprovalSaveWraps_done = false;
  function ensureApprovalSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureApprovalSaveWraps_done) return;
    _ensureApprovalSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._aprWrap2) {
      const w = function () { stampApproval(); return commit.apply(this, arguments); };
      w._aprWrap2 = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._aprWrap2) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampApproval(); return col.apply(this, arguments); };
      wc._aprWrap2 = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.apr) CBZ.approvalState.apply(led.apr);
  }
  if (CBZ.onUpdate) {
    // next free slot after city/officials.js's own 46.08 mint tick — same
    // install-tick family as every other P/E/X-wave save-wrap.
    CBZ.onUpdate(46.09, function () {
      if (!g) return;
      ensureApprovalSaveWraps();
      hydrateFromLedger();
    });
  }

  // THE POLITICS PANEL (a Shift+P overlay of every jurisdiction's approval,
  // inputs and treasury) is gone. Numbers in a menu are exactly what the
  // President rework took out of the game: approval is read in the world
  // now, on the TV poll in the President's Office, in the size of the crowd
  // under the balcony and in the signs outside the gate.

})();
