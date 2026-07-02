/* ============================================================
   city/migration.js — Stage P, step P9: MIGRATION — policy per country,
   individual migration evaluation, brain drain/refugee flows, and the
   border-escape gig.

   MASTER-PLAN V.6 (verbatim, the paragraph this file ships): "Emigration &
   immigration are law — and people vote with their feet. Each country has a
   migration policy (open / quota / skilled-only / closed / emigration-
   banned): a president needs the political process (approval-gated, takes
   days, opposition can block); a dictator decrees it instantly, no vote.
   Underneath, migration is individual: every registry person periodically
   evaluates a move — real-wage differential..., war, inflation stage,
   regime type, unemployment, and family ties... Consequences compound:
   brain drain (the skilled and wealthy leave failing states first...),
   refugee waves from war zones spiking destination rents, shrinking tax and
   conscription bases in the origin, and anti-immigrant politics feeding the
   nationalism axis in elections. Under emigration-banned..., people flee
   illegally: border-escape attempts..., coyote-run smuggling gigs for the
   player..." V.1a: "migration (V.6) mixes populations over time — port
   cities polyglot, remote villages homogeneous." X4's own header: "the
   mechanism migration (V.6) will tune over time" (city/demographics.js's
   CONFIGS[id].mix — THE seam this file tunes).

   BUILD-PLAN P9 (verbatim): "Migration: policy per country (president
   legislates, dictator decrees), individual migration evaluation, brain
   drain/refugee flows, border-escape gigs."

   THE TEMPLATE BEING GENERALIZED (city/polwar.js, P8, read not forked):
   its per-country military record (g.polwarWorld.mil, seeded once per id,
   deterministic off a hash-seeded rng) is the shape this file's per-country
   migration record copies; its DEFAULT_MISERY fallback ("republic's real
   miseryIndex() vs a flat baseline everywhere else") is generalized here
   into a real per-country misery PROXY (war/approval/econ-activity, see
   miseryOf() below) since a flat number for every non-republic country
   would zero out every cross-country misery GAP the propensity math needs;
   its own conscription hook (sim/npcecon.js's adjustEmployedFrac, "add a
   guarded ~6-line hook" precedent) is reused verbatim for the republic side
   of any flow.

   SCOPE — 5 countries this wave (republic + city/countries.js's veridia/
   kesh/solara/mbeya), 20 ordered (from,to) pairs, daily. Only "republic" has
   a live ped registry (city/peds.js's finite _popTotal/_popDead headcount);
   the 4 others are STATISTICAL — this file seeds its OWN mutable population
   ESTIMATE per non-republic country (POP_TIER × settlement count, city/
   countries.js's own settlement/tier data — see seedPop()) and moves that
   number, exactly like econstate.js's toy treasury flow is "legible, not
   real" for these countries this wave.

   ============================================================
   POLICY — {emigration: open|taxed|closed, immigration: open|selective|
   closed} per country, seeded from DEFAULT_POLICY[govType] (see table
   below) and held on THIS file's own state (not on the polity record —
   polity.js's serialize() whitelist doesn't carry arbitrary fields, the
   same reason regimes.js/relations.js/militia.js/polwar.js all keep their
   OWN g.cityWorld rider instead of stuffing new keys onto CBZ.polity's
   records — see each of those files' own header for the identical note).

   ROUTING (CBZ.migration.setPolicy(id, kind, value)) — V.6's own
   dichotomy, generalized off regimes.js's own govType table (that file's
   header: "monarchy never enters this state machine... P6b's own bloodline
   succession wave owns it entirely" — a king already rules by decree, no
   different from a dictator for THIS purpose): govType==="democracy" ->
   LEGISLATE (a pending proposal, LEGISLATE_DAYS days, applies then, costs/
   earns approval per popularity — see legislateTick()); every OTHER
   govType (dictatorship/fascism/communism/monarchy/anarchism/
   emergencyRule) -> DECREE (applies same-tick, zero approval cost — an
   autocrat doesn't need to sell it). anarchism is a special case at the
   GATE, not the route: V.4's own "no state apparatus" framing (polwar.js's
   GOV_MUL.anarchism=0, "can't declare [war]" — the identical logic) means
   an anarchist country's stored policy is never actually ENFORCED — every
   gate read for an anarchist id returns 1 regardless of the stored value
   (see gateEmigration/gateImmigration) — "anarchism: uncontrolled, no
   policy enforced" per the task brief, implemented as an enforcement
   bypass rather than a third route so the stored value still round-trips
   through persistence/UI like every other country's.

   AI PRESSURE (onNewDay, routed through the SAME setPolicy() — so even an
   AI-driven democratic policy shift pays the legislative delay/cost, the
   realistic "the president wants this too, but the house still has to
   vote" reading): war (an active belligerent, CBZ.polwar.activeWarFor) ->
   immigration tightens toward "closed" (V.6: "close immigration to enemy
   nationals" — this wave has no per-nationality tagging on the aggregate
   flow, see AXES/NARROWING below, so the whole border tightens instead);
   hunger crisis (miseryOf(id) > AI_HUNGER_CRISIS_T) -> a dictator/monarch/
   any decree-govType CLOSES emigration (traps its own people — the doom-
   loop trap V.6 names explicitly), a democracy OPENS emigration (lets its
   people go rather than face an exodus it can't legally stop). Both are
   one-shot-per-day checks (only fires a setPolicy call when the CURRENT
   value differs from the desired one, so it never re-legislates an already-
   pending or already-applied change).

   ============================================================
   INDIVIDUAL EVALUATION (STATISTICAL + SAMPLED) — computePropensity(from,to)
   is a PURE function (harness-testable in isolation, same "expose the pure
   function" precedent polwar.js's _combatPower/relations.js's warPressure
   set): BASE + W_MISERY·max(0,miseryGap) + W_WAGE·max(0,activityGap) +
   W_WAR·(origin at war) + W_REL·affinity(-1..1) + W_KIN·kinship(0..1),
   clamped 0..1. "Distance/route availability": countries.js's own header
   says these 5 countries have NO causeways between them, air/boat only —
   this wave treats every pair as equally reachable (routeAvailability≡1,
   commented, not a per-pair number) since there is no route-blocking
   geometry yet to read a real number off; a future wave with actual flight/
   ferry schedules is the real consumer of a non-constant term here.

   KINSHIP: cosine similarity between two countries' demographics.js
   skinWeights distributions (normalized over the SAME 8-hex peds.js SKIN
   pool every CONFIGS entry already shares — see that file's header), a
   cheap, defensible proxy for "shared population mix" the task asks for;
   reads CONFIGS directly (data, not the mix-gated rollFor() path) since
   kinship is about the STANDING distribution, not a spawn roll.

   POLICY GATES multiply the raw propensity: gateEmigration(from) — open×1,
   taxed×0.6 (exit fees dampen, don't crush), closed×0.1 ("smuggling only",
   per the task's own worked multiplier); gateImmigration(to,...) — open×1,
   closed×0.05, SELECTIVE admits ONLY the skilled fraction of the flow (not
   a flat multiplier — see skilledFractionOf() below, the literal "selective
   → skilled only" the task names).

   ============================================================
   BRAIN DRAIN — skilledFractionOf(id): SKILLED_BASE (0.15) normally,
   SKILLED_BRAIN_DRAIN (0.45) when miseryOf(id) > BRAIN_DRAIN_MISERY_T or
   approval < BRAIN_DRAIN_APPROVAL_T (the task's own two triggers). Applied
   twice: (a) as the admit-fraction under a SELECTIVE destination (above),
   (b) as the weighting in applyEconEffects()'s origin/destination hit —
   originImpactPerHead(skilled) = BASE_EMP_HIT × (skilled ? BRAIN_DRAIN_MUL
   : 1) and destImpactPerHead(skilled) mirror it (BRAIN_DRAIN_MUL=1.5, the
   task's own worked number), both exposed on TUNING/_ so the harness can
   assert the exact ×1.5 fact as a pure arithmetic check, independent of any
   population noise. A headline fires once per country per crossing of
   BRAIN_DRAIN_HEADLINE_T net skilled emigrants (a running counter, not
   re-fired every day the drain continues — approval.js's own edge-trigger
   convention).

   REFUGEE WAVES — any country with an active war (CBZ.polwar.activeWarFor)
   OR famine (miseryOf(id) > REFUGEE_FAMINE_T) opens/refreshes a wave record
   routed to the FRIENDLIEST country whose immigration gate isn't the
   closed multiplier (max CBZ.relations.get(id,candidate) among those). Each
   day the wave holds: a burst of flow moves IGNORING the normal propensity
   gate (WAVE_FLOW_FRAC of the origin's remaining population/day, unskilled-
   flavored) and CBZ.relations.event(dest,origin,"insult",WAVE_RELATIONS_HIT)
   strains the destination (the task's own explicit ask: "big refugee
   inflows STRAIN relations"), plus a small CBZ.approvalShock(dest,-1) (a
   cheap "services feel the strain" read — no new hunger.js/cohort field
   exists to hang a real per-district pressure number on this wave, see
   NARROWING below). The wave record persists in blob.mig while its driver
   (war/famine) holds; it closes the moment neither is true.

   ============================================================
   REPUBLIC REALISM (the persistent-population principle) — every OTHER
   country here is a pure number; the republic is real, live peds, and the
   two existing finite-headcount seams (city/peds.js) are reused VERBATIM,
   never a third mechanism invented:
     - DEPARTURE (republic as origin): CBZ.cityPopulationDie(n) — the exact
       seam city/polwar.js's own war casualties already use. This is NOT a
       kill (no kill-feed line, no loot drop — cityPopulationDie is a pure
       headcount decrement + HUD-dirty flag, verified against its own
       source) — an emigrant leaves, they are not murdered; reusing the
       "no longer among the counted living" bucket is the documented,
       book-preserving fallback the task brief names.
     - ARRIVAL (republic as destination): CBZ.cityPopulationBirth(1) — the
       EXACT seam births.js already uses to promote a body out of the
       "unseen slack" bucket into a real, counted person (requires
       dead>0 — if the finite roster has no headroom this tick, the arrival
       silently waits for one rather than inflating the total, the same
       guard births.js's own header documents). Only THEN is a real ped
       minted (CBZ.cityMakePed) at the docks/airport anchor (Halloran Field,
       city/island_airport.js's own rect centre — resolved live off
       CBZ.city.arena.regions by name, falling back to that file's own
       documented (-40,-120) if the region isn't registered/no THREE), with
       the ORIGIN country's demographics: CBZ.demographics.rollFor() is
       resolved off the ORIGIN capital's OWN coordinates (not the arrival
       point) — the exact same function, just fed a different (x,z) so it
       looks up the origin's CONFIGS entry instead of the mainland's — and
       the result threaded through makePed's opts (name/gender/outfit, plus
       this wave's new opts.skin passthrough, see peds.js's ≤2-line edit).
       CBZ.cityPedStash mints the real ledger identity (nameKnown:true, the
       exact convention regimes.js's cop-conversion and crown.js's royal
       minting both already use for "a live body needs a real registry
       row"). Capped at MAX_REAL_MIGRANTS_PER_DAY (2) each direction —
       performance, per the task's own instruction; the bulk of the flow
       stays the statistical pop[] ledger even when republic is a side.

   ============================================================
   BORDER-ESCAPE GIG — CBZ.migration.escapeGig (offer/accept/complete/fail/
   active), a SELF-CONTAINED state machine, NOT wired into city/gigs.js's
   CBZ.cityGig physical pickup/carry/dropoff machine. ADAPTATION RECORDED:
   gigs.js's loop is a physically-embodied state machine (the player must
   walk to a pickup point, drive/carry cargo with a live decay meter, and
   drop off at a real in-world waypoint) built for THIS city's own streets;
   a border-escape run is supposed to leave the republic's own airspace/
   waters entirely (countries.js's own header: "reachable by air/boat...
   ferry/flight scheduling is later work") — there is no boat/plane travel
   mode, no foreign-soil arrival point the player's avatar can stand at, and
   no existing "leave the city, come back" travel seam this file could
   anchor a real pickup/dropoff pair to without inventing one wholesale
   (out of scope for a headless-testable P9 wave). So: this ships the full
   ELIGIBILITY/PAYOUT/CONSEQUENCE state machine + a cityFeed offer line
   (the exact "offer visible, no UI to walk to yet" precedent city/
   militia.js's own header uses for its hireable-pool flavor tags) — a
   future wave that adds real inter-country travel can wire escapeGig's
   accept()/complete() calls behind a physical pickup/dropoff pair at
   Halloran Field with zero changes to this file's own logic. UI seam
   skipped, documented, not silently dropped.
   Eligibility: any NON-republic country whose emigration policy is
   "closed" or "taxed" AND miseryOf(id) > GIG_MISERY_T, no other gig active.
   Payout: BASE_GIG_PAYOUT × n × harshness (closed 1.5×, taxed 1.0×) + a
   small seeded bonus. complete() moves REAL flow (population(origin) -= n,
   republic arrivals minted via the exact seam above, capped), relations
   event(origin,"republic","insult",GIG_RELATIONS_HIT) — "illegal under the
   origin regime" per the task, hence a RELATIONS/heat cost, not a reward —
   and a small g.heat bump (GIG_HEAT) reflecting the smuggling run's risk.

   ============================================================
   NARROWING / ADAPTATIONS (recorded, not silent):
     - Per-nationality immigration targeting ("close immigration to enemy
       nationals" specifically) has no home yet — no ped carries a
       nationality tag today (relations.js's own header already flagged
       this exact gap for its player-crime-against-citizens feed). This
       wave's war reaction closes the WHOLE border instead — a documented
       simplification, not a silent one.
     - Family-tie chain migration (`family_edges`, MASTER-PLAN's own M-stage
       depth) is out of scope this wave — propensity is country-level
       statistical, not per-person familial.
     - trappedMisery(id): an accumulator that rises (TRAP_RATE/day × the
       excess over TRAPPED_MISERY_T) while emigration is CLOSED and misery
       is high, decays otherwise — exported now, per the task's own "X6b
       will consume this" framing (the identical "write-only, free depth"
       precedent systems/hunger.js's miseryIndex/city/relations.js's
       warPressure both already set for their own future consumers).

   PERSISTENCE: blob.mig (policy, legislation, per-country pop estimates,
   trapped-misery accumulators, brain-drain running counters + headline
   flags, active waves, demographics mix overrides, gig state) +
   serialize()/apply(), the same two-rider (MULTIPLAYER blob.mig / SINGLE-
   PLAYER g.cityWorld.mig) pattern with the P5 chain-growth one-shot install
   guard every P-wave file uses — own flag _migWrap.
   LOAD ORDER: after city/polwar.js (needs CBZ.polwar.activeWarFor for the
   war-driven immigration/refugee-wave reads) — index.html's new LAST slot
   in the P-wave block; onUpdate install tick at 46.19 (the free slot
   between polwar.js's own 46.18 and countries.js's 46.2).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }
  function clamp01(v) { return clampNum(0, 1, v); }

  // own seeded LCG (never Math.random — repo convention for world state).
  let _seed = 771931004 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // ============================================================
  //  TUNING
  // ============================================================
  const LEGISLATE_DAYS = 3;
  const LEGISLATE_POPULAR_SHOCK = 2, LEGISLATE_UNPOPULAR_SHOCK = -6;
  const LOW_MISERY_T = 0.3;          // closing borders under this misery reads as unpopular overreach
  const XENO_T = 0.6;                // opening borders under this much xenophobic pressure reads as unpopular

  const AI_HUNGER_CRISIS_T = 0.55;   // AI policy pressure: "people want out"
  const REFUGEE_FAMINE_T = 0.75;     // refugee wave trigger (task's own exact number)

  const GATE_EMIG = { open: 1, taxed: 0.6, closed: 0.1 };
  const GATE_IMMIG_OPEN = 1, GATE_IMMIG_CLOSED = 0.05;

  const SKILLED_BASE = 0.15, SKILLED_BRAIN_DRAIN = 0.45;
  const BRAIN_DRAIN_MISERY_T = 0.6, BRAIN_DRAIN_APPROVAL_T = 30;
  const BASE_EMP_HIT = 0.010, DEST_BASE_BOOST = 0.008, BRAIN_DRAIN_MUL = 1.5;
  const BRAIN_DRAIN_HEADLINE_T = 25;  // net skilled emigrants before a "doctors are leaving" headline fires

  const W_MISERY = 0.5, W_WAGE = 0.25, W_WAR = 0.3, W_REL = 0.2, W_KIN = 0.15, BASE_PROPENSITY = 0.03;
  const FLOW_RATE = 0.0015;           // fraction of origin population/day at propensity=1, fully open
  const MAX_PAIR_FRAC = 0.02;         // per-pair daily flow cap (2% of origin pop)

  const WAVE_FLOW_FRAC = 0.01;        // refugee burst: fraction of origin pop/day, ignores normal propensity
  const WAVE_RELATIONS_HIT = 5;       // "-5 per big wave" (task's own number)

  const TRAP_RATE = 0.08, TRAPPED_MISERY_T = 0.5, TRAP_DECAY = 0.05;

  const POP_TIER = { capital: 50000, town: 20000, village: 6000 };
  const MIN_POP = 2000;
  const MIX_SHIFT_SENSITIVITY = 0.6, MIX_SHIFT_DAILY_CAP = 0.01;   // the X4 seam's per-day gradual cap

  const MAX_REAL_MIGRANTS_PER_DAY = 2;   // republic-side real peds, either direction, performance cap

  const GIG_MISERY_T = 0.55, BASE_GIG_PAYOUT = 450, GIG_HARSHNESS = { closed: 1.5, taxed: 1.0 };
  const GIG_N_MIN = 2, GIG_N_MAX = 4, GIG_RELATIONS_HIT = 2, GIG_HEAT = 40;

  const MISERY_BASE = 0.10, MISERY_APPROVAL_W = 0.30, MISERY_WAR = 0.35, MISERY_ECON_W = 0.40;

  // ============================================================
  //  POLICY DEFAULTS BY GOVTYPE — the task's own worked table.
  // ============================================================
  const DEFAULT_POLICY = {
    democracy:    { emigration: "open",      immigration: "selective" },
    communism:    { emigration: "closed",    immigration: "selective" },   // "the wall!"
    fascism:      { emigration: "open",      immigration: "closed" },
    dictatorship: { emigration: "taxed",     immigration: "closed" },      // exit fees
    monarchy:     { emigration: "selective", immigration: "selective" },
    anarchism:    { emigration: "open",      immigration: "open" },        // uncontrolled — never actually enforced, see gates
    emergencyRule:{ emigration: "taxed",     immigration: "closed" },
  };
  const DECREE_GOVS = { dictatorship: 1, fascism: 1, communism: 1, monarchy: 1, anarchism: 1, emergencyRule: 1 };
  function defaultPolicyFor(gov) { return DEFAULT_POLICY[gov] || DEFAULT_POLICY.democracy; }

  // ============================================================
  //  STATE — g.migrationWorld
  // ============================================================
  function freshState() {
    return {
      policy: Object.create(null),      // id -> {emigration, immigration}
      legislation: Object.create(null), // id -> {kind, value, daysLeft} | undefined
      pop: Object.create(null),         // id -> statistical population estimate (non-republic)
      trapped: Object.create(null),     // id -> trappedMisery accumulator
      brainDrainNet: Object.create(null), // id -> running net skilled emigrant counter (headline gate)
      brainDrainHeadlined: Object.create(null),
      waves: Object.create(null),       // originId -> {dest, driver, startDay}
      mixOverride: Object.create(null), // id -> last-applied CONFIGS[id].mix (persistence mirror)
      gig: null,                        // {phase:"offered"|"active", origin, n, payout, harsh, startDay}
      seeded: false,
    };
  }
  function reset() { g.migrationWorld = freshState(); }
  function state() { if (!g.migrationWorld) reset(); return g.migrationWorld; }

  // ============================================================
  //  HELPERS — country/geo lookups (mirrors polwar.js's own shape)
  // ============================================================
  function countryList() { return CBZ.polity ? CBZ.polity.list("country") : []; }
  function rec(id) { return CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null; }
  function nameOf(id) { const r = rec(id); return (r && r.name) || id; }
  function countryDataOf(id) { return (CBZ.COUNTRIES || []).find(function (c) { return c.id === id; }) || null; }
  function capitalEconIdFor(id) {
    if (id === "republic") return (CBZ.econState && CBZ.econState.DEFAULT_ID) || "libertyville";
    const cd = countryDataOf(id);
    if (!cd) return null;
    const cap = (cd.settlements || []).find(function (s) { return s.capital; });
    return cap ? cap.id : null;
  }
  function capitalCoordsFor(id) {
    if (id === "republic") {
      const lib = rec("libertyville");
      return lib && lib.rect ? { x: lib.rect.cx, z: lib.rect.cz } : { x: 0, z: -700 };
    }
    const cd = countryDataOf(id);
    const cap = cd && (cd.settlements || []).find(function (s) { return s.capital; });
    return cap ? { x: cap.cx, z: cap.cz } : { x: 0, z: 0 };
  }
  function activityOf(id) {
    const capId = capitalEconIdFor(id);
    if (!capId || !CBZ.econState) return 1.0;
    const st = CBZ.econState.get(capId);
    return st ? st.activity : 1.0;
  }

  // ============================================================
  //  MISERY — republic's REAL miseryIndex(); every other country a proxy
  //  built off war/approval/econ-activity (see header — a flat baseline
  //  everywhere-but-republic, P8's own convention, would zero out every
  //  cross-country misery GAP the propensity math needs).
  // ============================================================
  function miseryOf(id) {
    if (id === "republic" && CBZ.hunger && CBZ.hunger.miseryIndex) {
      try { return clamp01(CBZ.hunger.miseryIndex()); } catch (e) {}
    }
    const r = rec(id);
    const approval = r && isFinite(r.approval) ? r.approval : 55;
    const atWar = !!(CBZ.polwar && CBZ.polwar.activeWarFor && CBZ.polwar.activeWarFor(id));
    const approvalTerm = clamp01((60 - approval) / 60) * MISERY_APPROVAL_W;
    const warTerm = atWar ? MISERY_WAR : 0;
    const econTerm = clamp01(1 - activityOf(id)) * MISERY_ECON_W;
    return clamp01(MISERY_BASE + approvalTerm + warTerm + econTerm);
  }

  // ============================================================
  //  KINSHIP — cosine similarity over demographics.js's skinWeights (see
  //  header). Reads CONFIGS directly (standing distribution, not a roll).
  // ============================================================
  function skinVector(cfgId) {
    const cfg = CBZ.demographics && CBZ.demographics.CONFIGS ? CBZ.demographics.CONFIGS[cfgId] : null;
    const m = Object.create(null);
    if (!cfg || !cfg.skinWeights) return m;
    let total = 0;
    for (let i = 0; i < cfg.skinWeights.length; i++) total += cfg.skinWeights[i][1];
    if (total <= 0) return m;
    for (let i = 0; i < cfg.skinWeights.length; i++) m[cfg.skinWeights[i][0]] = cfg.skinWeights[i][1] / total;
    return m;
  }
  function kinshipOf(a, b) {
    const va = skinVector(a), vb = skinVector(b);
    const keys = {}; for (const k in va) keys[k] = 1; for (const k in vb) keys[k] = 1;
    let dot = 0, na = 0, nb = 0;
    for (const k in keys) {
      const x = va[k] || 0, y = vb[k] || 0;
      dot += x * y; na += x * x; nb += y * y;
    }
    if (na <= 0 || nb <= 0) return 0;
    return clamp01(dot / Math.sqrt(na * nb));
  }

  // ============================================================
  //  POLICY — seed/read/route
  // ============================================================
  function ensurePolicy(id) {
    const S = state();
    if (S.policy[id]) return S.policy[id];
    const r = rec(id);
    const def = defaultPolicyFor(r && r.govType);
    S.policy[id] = { emigration: def.emigration, immigration: def.immigration };
    return S.policy[id];
  }
  function policyOf(id) { return ensurePolicy(id); }

  function feedPolicy(id, kind, value, decreed) {
    const lbl = kind === "emigration" ? "emigration" : "immigration";
    const verb = decreed ? "decrees" : "legislates";
    if (CBZ.cityFeed) CBZ.cityFeed("🛂 " + nameOf(id) + " " + verb + " " + lbl + " policy: " + value + ".", "#8fc1ff");
  }
  function isUnpopular(id, kind, value) {
    const misery = miseryOf(id);
    if (value === "closed" && misery < LOW_MISERY_T) return true;
    const r = rec(id);
    const xeno = clamp01((60 - (r && isFinite(r.approval) ? r.approval : 55)) / 60);
    if (value === "open" && xeno > XENO_T) return true;
    return false;
  }
  // routes a policy change through the correct process for the country's
  // OWN govType (see header) — CBZ.migration.setPolicy public entrypoint.
  function setPolicy(id, kind, value) {
    if (kind !== "emigration" && kind !== "immigration") return false;
    const allowed = kind === "emigration" ? GATE_EMIG : { open: 1, selective: 1, closed: 1 };
    if (!(value in allowed)) return false;
    const r = rec(id);
    if (!r) return false;
    ensurePolicy(id);
    const gov = r.govType;
    if (gov === "democracy") {
      const S = state();
      // an IDENTICAL bill already in flight -> don't reset its countdown (a
      // caller re-asserting the same pressure every day — aiPolicyPressure's
      // own daily re-check chief among them — must never restart the clock;
      // LEGISLATE_DAYS is a promise the bill reaches a vote in THAT many
      // days, not "N days after the last time anyone asked").
      const p = S.legislation[id];
      if (p && p.kind === kind && p.value === value) return true;
      S.legislation[id] = { kind: kind, value: value, daysLeft: LEGISLATE_DAYS, unpopular: isUnpopular(id, kind, value) };
      if (CBZ.cityFeed) CBZ.cityFeed("📜 " + nameOf(id) + "'s legislature takes up a " + kind + " policy bill (" + value + ") — " + LEGISLATE_DAYS + " days to a vote.", "#ffd76a");
      return true;
    }
    // decree — every other govType, instant, no approval cost.
    ensurePolicy(id)[kind] = value;
    feedPolicy(id, kind, value, true);
    return true;
  }
  function legislateTick(id, day) {
    const S = state();
    const pend = S.legislation[id];
    if (!pend) return;
    pend.daysLeft--;
    if (pend.daysLeft > 0) return;
    ensurePolicy(id)[pend.kind] = pend.value;
    feedPolicy(id, pend.kind, pend.value, false);
    if (CBZ.approvalShock) CBZ.approvalShock(id, pend.unpopular ? LEGISLATE_UNPOPULAR_SHOCK : LEGISLATE_POPULAR_SHOCK);
    delete S.legislation[id];
  }

  // ============================================================
  //  AI POLICY PRESSURE — war -> immigration tightens; hunger crisis ->
  //  decree-govs close emigration (trap), democracy opens it.
  // ============================================================
  // (setPolicy() itself is idempotent against an already-in-flight IDENTICAL
  // bill — see its own comment — so this daily re-check is safe to call
  // every tick pressure persists without ever restarting a pending
  // democracy's LEGISLATE_DAYS countdown.)
  function aiPolicyPressure(id) {
    const r = rec(id);
    if (!r) return;
    const pol = ensurePolicy(id);
    const atWar = !!(CBZ.polwar && CBZ.polwar.activeWarFor && CBZ.polwar.activeWarFor(id));
    if (atWar && pol.immigration !== "closed") setPolicy(id, "immigration", "closed");
    const misery = miseryOf(id);
    if (misery > AI_HUNGER_CRISIS_T) {
      if (DECREE_GOVS[r.govType] && pol.emigration !== "closed") setPolicy(id, "emigration", "closed");
      else if (r.govType === "democracy" && pol.emigration !== "open") setPolicy(id, "emigration", "open");
    }
  }

  // ============================================================
  //  TRAPPED MISERY — X6b's future uprising-pressure fuse (exported now).
  // ============================================================
  function tickTrapped(id) {
    const S = state();
    const pol = ensurePolicy(id);
    const misery = miseryOf(id);
    const cur = S.trapped[id] || 0;
    if (pol.emigration === "closed" && misery > TRAPPED_MISERY_T) {
      S.trapped[id] = clamp01(cur + (misery - TRAPPED_MISERY_T) * TRAP_RATE);
    } else {
      S.trapped[id] = Math.max(0, cur - TRAP_DECAY);
    }
  }
  function trappedMisery(id) { return state().trapped[id] || 0; }

  // ============================================================
  //  POPULATION — statistical ledger for non-republic countries.
  // ============================================================
  function seedPop(id) {
    if (id === "republic") return null;
    const cd = countryDataOf(id);
    let total = 0;
    if (cd) for (const s of (cd.settlements || [])) total += POP_TIER[s.tier] || 15000;
    return Math.max(MIN_POP, total || 40000);
  }
  function popOf(id) {
    if (id === "republic") {
      const p = CBZ.cityPopulation ? CBZ.cityPopulation() : null;
      return p ? p.alive : 1000;
    }
    const S = state();
    if (S.pop[id] == null) S.pop[id] = seedPop(id);
    return S.pop[id];
  }
  function adjustPop(id, delta) {
    if (id === "republic") return; // republic moves via cityPopulationDie/Birth only, see header
    const S = state();
    if (S.pop[id] == null) S.pop[id] = seedPop(id);
    S.pop[id] = Math.max(MIN_POP, S.pop[id] + delta);
  }

  // ============================================================
  //  SKILLED FRACTION — brain drain trigger (misery OR low approval).
  // ============================================================
  function skilledFractionOf(id) {
    const misery = miseryOf(id);
    const r = rec(id);
    const approval = r && isFinite(r.approval) ? r.approval : 55;
    return (misery > BRAIN_DRAIN_MISERY_T || approval < BRAIN_DRAIN_APPROVAL_T) ? SKILLED_BRAIN_DRAIN : SKILLED_BASE;
  }

  // ============================================================
  //  POLICY GATES
  // ============================================================
  function gateEmigration(id) {
    const r = rec(id);
    if (r && r.govType === "anarchism") return 1;   // uncontrolled — never enforced
    const pol = ensurePolicy(id);
    return GATE_EMIG[pol.emigration] != null ? GATE_EMIG[pol.emigration] : 1;
  }
  // effective immigration admit-multiplier for a flow FROM `fromId` INTO `id`.
  // selective admits ONLY the skilled fraction of the flow (not a flat mul).
  function gateImmigration(id, fromId) {
    const r = rec(id);
    if (r && r.govType === "anarchism") return 1;
    const pol = ensurePolicy(id);
    if (pol.immigration === "open") return GATE_IMMIG_OPEN;
    if (pol.immigration === "closed") return GATE_IMMIG_CLOSED;
    return skilledFractionOf(fromId);   // "selective"
  }

  // ============================================================
  //  PROPENSITY — pure function, exposed for the harness.
  // ============================================================
  function computePropensity(from, to) {
    if (!from || !to || from === to) return 0;
    const miseryGap = miseryOf(from) - miseryOf(to);
    const wageGap = activityOf(to) - activityOf(from);
    const atWar = !!(CBZ.polwar && CBZ.polwar.activeWarFor && CBZ.polwar.activeWarFor(from));
    const aff = (CBZ.relations && CBZ.relations.get ? CBZ.relations.get(from, to) : 0) / 100;
    const kin = kinshipOf(from, to);
    const raw = BASE_PROPENSITY
      + W_MISERY * Math.max(0, miseryGap)
      + W_WAGE * Math.max(0, wageGap)
      + W_WAR * (atWar ? 1 : 0)
      + W_REL * aff
      + W_KIN * kin;
    return clamp01(raw);
  }

  // ============================================================
  //  ECON EFFECTS — brain drain doom loop (origin ×1.5 vs unskilled).
  // ============================================================
  function originImpactPerHead(skilled) { return BASE_EMP_HIT * (skilled ? BRAIN_DRAIN_MUL : 1); }
  function destImpactPerHead(skilled) { return DEST_BASE_BOOST * (skilled ? BRAIN_DRAIN_MUL : 1); }
  function nudgeEcon(countryId, delta) {
    const capId = capitalEconIdFor(countryId);
    if (capId && CBZ.econState && CBZ.econState.get) {
      const st = CBZ.econState.get(capId);
      if (st) { st.activity = clampNum(0.1, 3.0, st.activity + delta); st.employment = clampNum(0.05, 0.98, st.employment + delta); }
    }
    if (countryId === "republic" && CBZ.npcEcon && CBZ.npcEcon.adjustEmployedFrac) {
      try { CBZ.npcEcon.adjustEmployedFrac(delta); } catch (e) {}
    }
  }
  function applyEconEffects(from, to, flow, skilledFrac) {
    if (flow <= 0) return;
    const skilled = flow * skilledFrac, unskilled = flow - skilled;
    const fromPop = Math.max(1, popOf(from)), toPop = Math.max(1, popOf(to));
    const originHitFrac = (unskilled * originImpactPerHead(false) + skilled * originImpactPerHead(true)) / fromPop;
    const destBoostFrac = (unskilled * destImpactPerHead(false) + skilled * destImpactPerHead(true)) / toPop;
    nudgeEcon(from, -originHitFrac);
    nudgeEcon(to, destBoostFrac);
  }

  // ============================================================
  //  DEMOGRAPHICS MIX SHIFT — the X4 seam: sustained immigration nudges the
  //  destination's CONFIGS[id].mix toward more polyglot, gradually (capped).
  // ============================================================
  function nudgeMix(destId, flow) {
    if (!CBZ.demographics || !CBZ.demographics.CONFIGS) return;
    const cfg = CBZ.demographics.CONFIGS[destId];
    if (!cfg) return;
    const toPop = Math.max(1, popOf(destId));
    const delta = clampNum(0, MIX_SHIFT_DAILY_CAP, (flow / toPop) * MIX_SHIFT_SENSITIVITY);
    cfg.mix = clamp01(cfg.mix + delta);
    state().mixOverride[destId] = cfg.mix;
  }

  // ============================================================
  //  REPUBLIC REAL-PED SEAMS — arrival (birth seam) / departure (casualty
  //  seam), both capped at MAX_REAL_MIGRANTS_PER_DAY. See header.
  // ============================================================
  function arrivalAnchor() {
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.regions) {
      for (let i = 0; i < A.regions.length; i++) {
        if (A.regions[i].name === "Halloran Field") {
          const r = A.regions[i];
          return { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 };
        }
      }
    }
    return { x: -40, z: -120 };   // island_airport.js's own documented rect centre
  }
  function mintRealArrival(originId) {
    if (!CBZ.cityPopulation || !CBZ.cityPopulationBirth) return false;
    if (CBZ.cityPopulation().dead <= 0) return false;   // no headroom yet — wait, never inflate the total
    if (CBZ.cityPopulationBirth(1) <= 0) return false;
    if (!CBZ.cityMakePed) return true;   // headcount already booked even if the visual mint can't happen (headless)
    const anchor = arrivalAnchor();
    const originCoords = capitalCoordsFor(originId);
    const gender = rng() < 0.5 ? "f" : "m";
    const demo = (CBZ.demographics && CBZ.demographics.rollFor) ? CBZ.demographics.rollFor(originCoords.x, originCoords.z, rng, gender) : null;
    let ped = null;
    try {
      ped = CBZ.cityMakePed(anchor.x, anchor.z, rng, {
        gender: gender, name: demo && demo.name, skin: demo && demo.skin, outfit: demo && demo.shirt,
        job: "immigrant", archetype: "civilian", wealth: 0.3,
      });
    } catch (e) { ped = null; }
    if (ped) {
      const A = CBZ.city && CBZ.city.arena;
      if (A && A.root && ped.group) A.root.add(ped.group);
      if (CBZ.cityPeds) CBZ.cityPeds.push(ped);
      ped.nameKnown = true;
      ped._migrantFrom = originId;
      if (CBZ.cityPedStash) try { CBZ.cityPedStash(ped); } catch (e) {}
    }
    return true;
  }
  function bookRealDeparture(n) {
    if (CBZ.cityPopulationDie) CBZ.cityPopulationDie(n);
  }

  // ============================================================
  //  BRAIN DRAIN HEADLINE — edge-triggered, once per crossing.
  // ============================================================
  function trackBrainDrain(from, skilledFlow) {
    const S = state();
    S.brainDrainNet[from] = (S.brainDrainNet[from] || 0) + skilledFlow;
    if (!S.brainDrainHeadlined[from] && S.brainDrainNet[from] >= BRAIN_DRAIN_HEADLINE_T) {
      S.brainDrainHeadlined[from] = true;
      if (CBZ.cityFeed) CBZ.cityFeed("🧳 Doctors and engineers are leaving " + nameOf(from) + " — a brain drain the economy will feel.", "#ff9e6b");
    }
  }

  // ============================================================
  //  ONE PAIR'S DAILY FLOW — statistical population/econ/demographics move,
  //  + the capped real-ped seams whenever republic is a side.
  // ============================================================
  function tickPair(from, to) {
    const propensity = computePropensity(from, to);
    const skilledFrac = skilledFractionOf(from);
    const gEm = gateEmigration(from), gIm = gateImmigration(to, from);
    const gated = propensity * gEm * gIm;
    if (gated <= 0) return;
    const fromPop = popOf(from);
    let flow = gated * FLOW_RATE * fromPop;
    flow = Math.min(flow, fromPop * MAX_PAIR_FRAC);
    if (flow <= 0) return;

    applyEconEffects(from, to, flow, skilledFrac);
    nudgeMix(to, flow);
    trackBrainDrain(from, flow * skilledFrac);

    if (from === "republic") {
      const n = Math.min(MAX_REAL_MIGRANTS_PER_DAY, Math.max(0, Math.round(flow / Math.max(1, fromPop) * 5000)));
      if (n > 0) bookRealDeparture(n);
      adjustPop(to, flow);   // destination statistical ledger still grows
    } else if (to === "republic") {
      let n = Math.min(MAX_REAL_MIGRANTS_PER_DAY, Math.max(1, Math.round(flow / 50)));
      for (let i = 0; i < n; i++) { if (!mintRealArrival(from)) break; }
      adjustPop(from, -flow);
    } else {
      adjustPop(from, -flow);
      adjustPop(to, flow);
    }
  }

  // ============================================================
  //  REFUGEE WAVES — war/famine driven, routed to the friendliest open
  //  neighbor, persisting while the driver holds.
  // ============================================================
  function friendliestOpen(originId) {
    const cands = countryList().filter(function (c) { return c.id !== originId; });
    let best = null, bestRel = -Infinity;
    for (let i = 0; i < cands.length; i++) {
      const cid = cands[i].id;
      if (ensurePolicy(cid).immigration === "closed" && !(rec(cid).govType === "anarchism")) continue;
      const rel = CBZ.relations && CBZ.relations.get ? CBZ.relations.get(originId, cid) : 0;
      if (rel > bestRel) { bestRel = rel; best = cid; }
    }
    return best;
  }
  function waveDriverFor(id) {
    const atWar = !!(CBZ.polwar && CBZ.polwar.activeWarFor && CBZ.polwar.activeWarFor(id));
    if (atWar) return "war";
    if (miseryOf(id) > REFUGEE_FAMINE_T) return "famine";
    return null;
  }
  function tickWaves(day) {
    const S = state();
    const countries = countryList();
    for (let i = 0; i < countries.length; i++) {
      const id = countries[i].id;
      const driver = waveDriverFor(id);
      const existing = S.waves[id];
      if (!driver) { if (existing) delete S.waves[id]; continue; }
      if (!existing) {
        const dest = friendliestOpen(id);
        if (!dest) continue;
        S.waves[id] = { dest: dest, driver: driver, startDay: day };
        if (CBZ.cityFeed) CBZ.cityFeed("🚤 Refugees flee " + nameOf(id) + " (" + driver + ") toward " + nameOf(dest) + ".", "#ffb27a");
      } else {
        existing.driver = driver;   // stays current on whichever driver holds
      }
      const w = S.waves[id];
      const originPop = popOf(id);
      const burst = originPop * WAVE_FLOW_FRAC;
      if (burst <= 0) continue;
      if (id === "republic") {
        bookRealDeparture(Math.min(MAX_REAL_MIGRANTS_PER_DAY, 1));
        adjustPop(w.dest, burst);
      } else if (w.dest === "republic") {
        mintRealArrival(id);
        adjustPop(id, -burst);
      } else {
        adjustPop(id, -burst);
        adjustPop(w.dest, burst);
      }
      nudgeMix(w.dest, burst);
      if (CBZ.relations && CBZ.relations.event) CBZ.relations.event(w.dest, id, "insult", WAVE_RELATIONS_HIT);
      if (CBZ.approvalShock) CBZ.approvalShock(w.dest, -1);
    }
  }

  // ============================================================
  //  BORDER-ESCAPE GIG — see header. Self-contained state machine.
  // ============================================================
  function gigEligibleOrigin() {
    const countries = countryList().filter(function (c) { return c.id !== "republic"; });
    let best = null, bestMisery = -1;
    for (let i = 0; i < countries.length; i++) {
      const id = countries[i].id;
      const pol = ensurePolicy(id);
      if (pol.emigration !== "closed" && pol.emigration !== "taxed") continue;
      const m = miseryOf(id);
      if (m > GIG_MISERY_T && m > bestMisery) { bestMisery = m; best = id; }
    }
    return best;
  }
  function refreshGigOffer(day) {
    const S = state();
    if (S.gig && S.gig.phase === "active") return;   // don't clobber an in-progress run
    const origin = gigEligibleOrigin();
    if (!origin) { if (S.gig && S.gig.phase === "offered") S.gig = null; return; }
    if (S.gig && S.gig.phase === "offered" && S.gig.origin === origin) return;   // already offered, same origin
    const pol = ensurePolicy(origin);
    const harsh = GIG_HARSHNESS[pol.emigration] || 1;
    const n = GIG_N_MIN + Math.floor(rng() * (GIG_N_MAX - GIG_N_MIN + 1));
    const payout = Math.round(BASE_GIG_PAYOUT * n * harsh * (0.9 + rng() * 0.3));
    S.gig = { phase: "offered", origin: origin, n: n, payout: payout, harsh: harsh, startDay: day };
    if (CBZ.cityFeed) CBZ.cityFeed("🛥️ Word on the docks: " + n + " people are desperate to leave " + nameOf(origin) + " — a border-escape run pays $" + payout + ".", "#8fe0ff");
  }
  function gigOffer() { const gg = state().gig; return (gg && gg.phase === "offered") ? Object.assign({}, gg) : null; }
  function gigAccept() {
    const S = state();
    if (!S.gig || S.gig.phase !== "offered") return false;
    S.gig.phase = "active";
    return true;
  }
  function gigComplete() {
    const S = state();
    const gg = S.gig;
    if (!gg || gg.phase !== "active") return null;
    for (let i = 0; i < gg.n; i++) mintRealArrival(gg.origin);
    adjustPop(gg.origin, -gg.n);
    if (CBZ.relations && CBZ.relations.event) CBZ.relations.event(gg.origin, "republic", "insult", GIG_RELATIONS_HIT);
    g.heat = (g.heat || 0) + GIG_HEAT;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(gg.payout); else g.cash = (g.cash || 0) + gg.payout;
    if (CBZ.cityFeed) CBZ.cityFeed("🛥️ Border-escape run complete — " + gg.n + " souls out of " + nameOf(gg.origin) + ", $" + gg.payout + " paid.", "#8fe08a");
    S.gig = null;
    return { origin: gg.origin, n: gg.n, payout: gg.payout };
  }
  function gigFail(why) {
    const S = state();
    if (!S.gig) return false;
    S.gig = null;
    if (CBZ.cityFeed) CBZ.cityFeed("🛥️ Border-escape run fell through" + (why ? " (" + why + ")" : "") + ".", "#ff9e6b");
    return true;
  }
  function gigActive() { const gg = state().gig; return (gg && gg.phase === "active") ? Object.assign({}, gg) : null; }

  // ============================================================
  //  SEEDING — policy + population, once per life (mirrors polwar.js's own
  //  ensureAllSeeded()).
  // ============================================================
  function ensureAllSeeded() {
    const countries = countryList();
    for (let i = 0; i < countries.length; i++) { ensurePolicy(countries[i].id); popOf(countries[i].id); }
  }

  // ============================================================
  //  DAILY TICK
  // ============================================================
  function dailyTick(day) {
    ensureAllSeeded();
    const countries = countryList();
    for (let i = 0; i < countries.length; i++) legislateTick(countries[i].id, day);
    for (let i = 0; i < countries.length; i++) aiPolicyPressure(countries[i].id);
    for (let i = 0; i < countries.length; i++) tickTrapped(countries[i].id);
    for (let i = 0; i < countries.length; i++) {
      for (let j = 0; j < countries.length; j++) {
        if (i === j) continue;
        try { tickPair(countries[i].id, countries[j].id); } catch (e) { try { console.error("[migration] tickPair failed", countries[i].id, countries[j].id, e); } catch (e2) {} }
      }
    }
    tickWaves(day);
    refreshGigOffer(day);
  }
  if (CBZ.onNewDay) CBZ.onNewDay(dailyTick);

  // ============================================================
  //  PUBLIC API
  // ============================================================
  CBZ.migration = {
    setPolicy: setPolicy,
    policyOf: function (id) { return Object.assign({}, ensurePolicy(id)); },
    defaultPolicyFor: defaultPolicyFor,
    propensity: computePropensity,
    miseryOf: miseryOf,
    activityOf: activityOf,
    kinshipOf: kinshipOf,
    skilledFractionOf: skilledFractionOf,
    gateEmigration: gateEmigration,
    gateImmigration: gateImmigration,
    trappedMisery: trappedMisery,
    popOf: popOf,
    wavesOf: function () { return Object.assign({}, state().waves); },
    escapeGig: {
      offer: gigOffer,
      accept: gigAccept,
      complete: gigComplete,
      fail: gigFail,
      active: gigActive,
    },
    reset: reset,
    TUNING: {
      LEGISLATE_DAYS: LEGISLATE_DAYS, GATE_EMIG: Object.assign({}, GATE_EMIG),
      GATE_IMMIG_OPEN: GATE_IMMIG_OPEN, GATE_IMMIG_CLOSED: GATE_IMMIG_CLOSED,
      SKILLED_BASE: SKILLED_BASE, SKILLED_BRAIN_DRAIN: SKILLED_BRAIN_DRAIN, BRAIN_DRAIN_MUL: BRAIN_DRAIN_MUL,
      REFUGEE_FAMINE_T: REFUGEE_FAMINE_T, AI_HUNGER_CRISIS_T: AI_HUNGER_CRISIS_T,
      MIX_SHIFT_DAILY_CAP: MIX_SHIFT_DAILY_CAP, GIG_MISERY_T: GIG_MISERY_T,
      GIG_RELATIONS_HIT: GIG_RELATIONS_HIT, GIG_HEAT: GIG_HEAT,
    },
    // harness/test-only hooks — not part of the public contract.
    _state: state, _originImpactPerHead: originImpactPerHead, _destImpactPerHead: destImpactPerHead,
    _tick: dailyTick, _ensureAllSeeded: ensureAllSeeded, _friendliestOpen: friendliestOpen,
    _adjustPop: adjustPop, _arrivalAnchor: arrivalAnchor,
  };
  CBZ.migrationReset = reset;

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serialize() {
    ensureAllSeeded();
    const S = state();
    return {
      v: 1,
      policy: JSON.parse(JSON.stringify(S.policy)),
      legislation: JSON.parse(JSON.stringify(S.legislation)),
      pop: Object.assign({}, S.pop),
      trapped: Object.assign({}, S.trapped),
      brainDrainNet: Object.assign({}, S.brainDrainNet),
      brainDrainHeadlined: Object.assign({}, S.brainDrainHeadlined),
      waves: JSON.parse(JSON.stringify(S.waves)),
      mixOverride: Object.assign({}, S.mixOverride),
      gig: S.gig ? Object.assign({}, S.gig) : null,
    };
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1) return;
    const S = state();
    if (obj.policy) for (const id in obj.policy) {
      const p = obj.policy[id]; if (!p) continue;
      S.policy[id] = { emigration: p.emigration || "open", immigration: p.immigration || "open" };
    }
    if (obj.legislation) for (const id in obj.legislation) {
      const l = obj.legislation[id]; if (!l) continue;
      S.legislation[id] = { kind: l.kind, value: l.value, daysLeft: isFinite(l.daysLeft) ? +l.daysLeft : LEGISLATE_DAYS, unpopular: !!l.unpopular };
    }
    if (obj.pop) for (const id in obj.pop) if (isFinite(obj.pop[id])) S.pop[id] = Math.max(MIN_POP, +obj.pop[id]);
    if (obj.trapped) for (const id in obj.trapped) if (isFinite(obj.trapped[id])) S.trapped[id] = clamp01(+obj.trapped[id]);
    if (obj.brainDrainNet) for (const id in obj.brainDrainNet) if (isFinite(obj.brainDrainNet[id])) S.brainDrainNet[id] = +obj.brainDrainNet[id];
    if (obj.brainDrainHeadlined) for (const id in obj.brainDrainHeadlined) S.brainDrainHeadlined[id] = !!obj.brainDrainHeadlined[id];
    if (obj.waves) for (const id in obj.waves) {
      const w = obj.waves[id]; if (!w || !w.dest) continue;
      S.waves[id] = { dest: w.dest, driver: w.driver || "war", startDay: w.startDay || 0 };
    }
    if (obj.mixOverride) {
      for (const id in obj.mixOverride) {
        if (!isFinite(obj.mixOverride[id])) continue;
        S.mixOverride[id] = clamp01(+obj.mixOverride[id]);
        if (CBZ.demographics && CBZ.demographics.CONFIGS && CBZ.demographics.CONFIGS[id]) {
          CBZ.demographics.CONFIGS[id].mix = S.mixOverride[id];
        }
      }
    }
    if (obj.gig && obj.gig.origin) S.gig = Object.assign({}, obj.gig);
  }
  CBZ.migration.serialize = serialize;
  CBZ.migration.apply = apply;

  // ============================================================
  //  SINGLE-PLAYER PERSIST — polwar.js's own g.cityWorld pattern, verbatim.
  //  One-shot install guard (_migWrap), the P5 chain-growth fix's convention.
  // ------------------------------------------------------------
  function stampMigration() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.mig = serialize();
  }
  let _ensureMigrationSaveWraps_done = false;
  function ensureMigrationSaveWraps() {
    if (_ensureMigrationSaveWraps_done) return;
    _ensureMigrationSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._migWrap) {
      const w = function () { stampMigration(); return commit.apply(this, arguments); };
      w._migWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._migWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampMigration(); return col.apply(this, arguments); };
      wc._migWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.mig) apply(led.mig);
  }
  if (CBZ.onUpdate) {
    // 46.19 — the free slot between polwar.js's own 46.18 and countries.js's 46.2.
    CBZ.onUpdate(46.19, function () {
      if (!g) return;
      ensureMigrationSaveWraps();
      hydrateFromLedger();
    });
  }
})();
