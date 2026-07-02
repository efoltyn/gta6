/* ============================================================
   city/polwar.js — Stage P, step P8: STATE/COUNTRY WARS — generalizing the
   gang-war machinery (city/gangs.js) to whole polities, with COUNTED
   matériel, causeway fronts, and honest procurement-driven stock booms.

   MASTER-PLAN V.5/V.6 (verbatim, the paragraphs this file ships):
   "Generalize the working gang-war machine (declare/upkeep/decay; treasury-
   funded raids; bodies-on-the-lot capture) to polities in polwar.js, with
   days for seconds and jurisdiction treasuries for gang treasuries...
   Fronts at the causeway chokepoints... War economy: prices up, rationing,
   conscription — 15% of worker NPCs leave the streets via the finite-
   headcount system." / "Matériel is counted, never abstract... each
   country's arsenal is inventory rows — planes, missiles... War consumes:
   every front battle expends ammo and missiles... losses are gone until
   produced." / "Procurement closes the war→stocks loop with fundamentals,
   not sentiment. At war, the treasury places real orders... book government
   contracts as actual revenue → defense stocks inflate in wartime through
   earnings." / "Conscription is demographic math... selective draft pulls
   a percentage of the working-age registry from their jobs: employment
   down... The guns-vs-butter tradeoff is real arithmetic." / "The
   desperate-measures ladder... nationalization of listed companies...
   atrocity-tier acts such as child conscription, which the simulation
   treats strictly as war crimes, not strategies."

   X6b's OWN header (city/relations.js, verbatim): "Builds on P8's war
   machinery" — a partially-failed coup "fractures the country into two
   warring polity records (loyalist vs junta), each with treasuries, armies
   drawn from the real soldier registry, and fronts." THE ONE CONTRACT THIS
   FILE MUST HONOR: a war's two `sides` are just polity ids — anything
   CBZ.polity.get() resolves (two countries today; a country vs a rebel
   fragment tomorrow). Nothing below branches on "kind === country" except
   the DAILY AI OUTBREAK SCAN (this wave's own escalation driver, scoped to
   country-vs-country per V.5) — declareWar() itself, the public API, is
   kind-agnostic and is exercised against a synthetic non-country-table
   polity id in p8harness (the X6b contract test).

   THE TEMPLATE BEING GENERALIZED (city/gangs.js, read not forked):
   launchWar()'s cadence/treasury-gating -> tickUpkeepAll/doProcurement's
   treasury gating; warWith/warRemain/warIntensity -> war.sides/fatigue/
   intensity (V.1's own polity record already reserves these EXACT field
   names, deliberately, per polity.js's header); press()'s escalation score
   -> scanOutbreaks()'s pressure×govType×readiness score; turf capture ->
   front.position reaching 0/1.

   ADAPTATIONS FROM THE WAVE PROMPT (recorded here, not silently):
     - FRONTS, REAL vs FALLBACK: worldmap.js's causeway/bridge regions all
       connect biomes WITHIN the republic's own mainland territory (desert
       <-> speedway, forest <-> Fort Brandt, snow <-> speedway, farmland <->
       desert — see each biome_*.js's own header) or are simply absent: X3's
       countries.js is explicit that the 4 new countries (veridia/kesh/
       solara/mbeya) have "NO causeways to the mainland... reachable by air/
       boat" (that file's own SITES comment). Net result: among the 5
       country-kind records that exist THIS wave, no registered causeway/
       bridge region ever sits between any two of them, so every front this
       wave resolves through the documented FALLBACK — the straight
       midpoint between the two sides' capital anchors (findCausewayBetween()
       below still does the real search first, for free, against
       CBZ.city.arena.regions by name match + on-segment projection — it is
       the machinery X6b's civil war needs, since a country literally
       splitting its OWN mainland territory in two very much DOES have a
       real causeway between the fragments; it simply has nothing to find
       yet). anchorForPolity() resolves ANY polity id (rect-bearing state/
       city/federal records directly; a country via its COUNTRIES-table
       capital settlement, "republic" via its libertyville city record, and
       a generic fallback — the centroid of member cities via the parent
       chain — for a FUTURE country-kind id with no COUNTRIES-table entry
       at all, e.g. an X6b rebel fragment).
     - SINGLE WAR PER POLITY (this wave's own scope bound, matching gangs.js's
       own single warWith field precedent exactly): declareWar() refuses if
       either side is already an active belligerent elsewhere. A country
       fighting two wars at once, or a war with >1 front, are real future
       depth (X6b's own multi-front civil-war geography will need the
       latter) — the `fronts` array is already a list for exactly that
       reason, this wave just only ever populates it with one entry.
     - CONSTANT INTENSITY: `war.intensity` is fixed at declaration (from the
       aggressor's govType multiplier) and held for the war's duration —
       matériel consumption and procurement both scale off it, but nothing
       makes it drift day to day this wave. A future wave could let front
       momentum/desperate measures modulate it further; not built here so
       every "assert an exact decrement" harness check stays a one-line
       arithmetic fact instead of a moving target.
     - CASUALTY RECONCILIATION WITH THE POPULATION BOOKS: city/peds.js's
       finite, non-regenerating headcount (`_popTotal`/`_popDead`, read via
       CBZ.cityPopulation(), written via CBZ.cityPopulationDie()) is the
       ONLY real per-body population registry that exists this wave, and it
       is mainland-only (X3/X4's own scoping note — cohorts/registry for the
       4 new countries don't exist yet). So: whenever "republic" is a
       belligerent, its own daily soldier casualties call
       CBZ.cityPopulationDie(n) — the exact same seam every other death in
       the game already uses, so a war's dead show up in the SAME finite
       headcount the HUD counts down from and sim/econstate.js's own
       employment term already reads. For veridia/kesh/solara/mbeya (no
       registry to hook), casualties are tracked as a cohort-level running
       counter on that country's own military record (`mil.warDead`) — the
       task's own documented fallback for exactly this gap.
     - CONSCRIPTION, GENERALIZED PER COUNTRY: every country's CAPITAL gets a
       sim/econstate.js jurisdiction (countries.js's own 46.2 seeding tick —
       {activity,employment,priceIndex,taxRate,treasury} per capital id),
       so `est.employment` is the one lever EVERY country actually has —
       conscription always dents it there. sim/npcecon.js's 20 cohort rows
       are mainland-only (that file's own header), so the DEEPER cohort-
       level hit (employedFrac, the exact field the task names) only
       applies when the conscripting country is "republic" — a new, tiny,
       guarded export this file adds to npcecon.js (`adjustEmployedFrac`,
       ~6 lines, the same "add a guarded hook" convention regimes.js's
       header documents repeatedly for market.js/police.js/stocks.js) makes
       that possible without forking the cohort rows in here. Both levers
       release back over CONSCRIPT_RELEASE_DAYS days on peace (a daily
       drip, the same shape reparations use below), never instantly.
     - WAR-CRIME PERSISTENCE: CBZ.polity's own serialize() only whitelists
       {govType,treasury,taxRate,approval,office} (its own header says so
       explicitly) — a bare `rec.warCrime` flag stamped on the LIVE record
       would evaporate on reload. The canonical flag lives on THIS file's
       own `mil` record (persisted in blob.war below); apply() re-stamps
       `rec.warCrime = true` on the live polity record as a convenience
       mirror once mil state is restored, so any reader of the polity
       record sees it too, but the source of truth is this file's blob.
     - NO NUKES: scope is conventional matériel (soldiers/planes/missiles)
       per the task brief — the strategic tier (V.6's own nuclear program
       paragraph) is explicitly later work (M/X waves).
     - jurisdictionCard/POLITICS-tab UI wiring (V.5's "player-visible... per
       jurisdictionCard seam if clean") is NOT done this wave — this file
       ships the full simulation + a public read API (warsOf/frontsOf/
       militaryOf) a future presentation pass can read arm's-length, the
       same "data module owns the query, panel owns the render" precedent
       relations.js's own header names; adding it blind, unable to visually
       verify a DOM change, risked exactly the kind of un-verifiable UI
       edit the owner's standing rule warns against.

   REGIME ESCALATION (V.4's govType table, this file's own multiplier):
   dictatorship ×1.5, fascism ×1.4, communism ×1.0, emergencyRule ×1.0
   (a democracy already mid-crisis, between the two), monarchy ×0.9,
   democracy ×0.6, anarchism ×0 ("can't declare" — no state apparatus left
   to command an army; regimes.js's own collapse machinery already owns
   anarchist chaos internally). escalation = warPressure(a,b) × the more
   aggressive side's multiplier × that side's readiness; past
   ESCALATION_T, a seeded daily roll (not a same-day guarantee) fires the
   war — see scanOutbreaks().

   PERSISTENCE: blob.war rides beside blob.mil (military records, active +
   archived wars with their fronts, reparations drips) — serialize()/apply()
   + the same one-shot save-wrap guard every P-wave file uses.
   LOAD ORDER: after militia.js (last in the P-wave block) — reads
   CBZ.polity/CBZ.relations/CBZ.regimes(govType only, no import)/
   CBZ.hunger.miseryIndex/CBZ.econState/CBZ.npcEcon/CBZ.corps/CBZ.COUNTRIES,
   every one of those already live above it in index.html.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }
  function clamp01(v) { return clampNum(0, 1, v); }

  // own seeded LCG (never Math.random — repo convention for world state) for
  // the daily outbreak roll. Per-country military seeding uses its OWN
  // hash-seeded stream (mkRng below) so seed order across countries never
  // matters — a deterministic function of the id string alone.
  let _seed = 402917531 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function hashStr(s) {
    let h = 2166136261;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function mkRng(id) {
    let seed = (hashStr(id) || 1) & 0x7fffffff;
    return function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  }

  // ============================================================
  //  TUNING — every constant in one place (exported as TUNING for the
  //  harness so assertions compute expected values off the SAME numbers,
  //  never a duplicated magic-number copy).
  // ============================================================
  const GOV_MUL = { dictatorship: 1.5, fascism: 1.4, communism: 1.0, emergencyRule: 1.0, monarchy: 0.9, democracy: 0.6, anarchism: 0 };
  const BASE_SOLDIERS = 260, BASE_PLANES = 7, BASE_MISSILES = 35;
  const READINESS_DECAY = 0.05;
  const UPKEEP_SOLDIER = 0.5, UPKEEP_PLANE = 15, UPKEEP_MISSILE = 3;
  const ESCALATION_T = 0.6, WAR_ROLL_CHANCE = 0.35;
  const ALLY_T = 40, ALLY_INSULT_MAG = 10;
  const FRONT_MAX_SHIFT = 0.08;
  const SOLDIER_RATE = 6, MISSILE_RATE = 2, PLANE_RATE = 1;   // matériel lost/day per side, × war.intensity
  const FATIGUE_T = 100, FATIGUE_BASE = 3, DEM_FATIGUE_MUL = 1.6, MON_FATIGUE_MUL = 1.1, DEFAULT_MISERY = 0.3;
  const CONSCRIPT_FLOOR_FRAC = 0.45, CONSCRIPT_BATCH_FRAC = 0.12, CONSCRIPT_COOLDOWN_DAYS = 3;
  const CONSCRIPT_ECON_HIT = 0.06, CONSCRIPT_COHORT_HIT = 0.04, CONSCRIPT_RELEASE_DAYS = 6;
  const CONSCRIPT_APPROVAL = { democracy: -8, dictatorship: -3, fascism: -3, monarchy: -5, communism: -5, emergencyRule: -6 };
  const LOSING_RATIO = 0.65, DESPERATE_DAYS_T = 2, NATIONALIZE_FRAC = 0.5, CHILD_SOLDIER_FRAC = 0.15;
  const CHILD_SOLDIER_RELATIONS_MAG = 20, CHILD_SOLDIER_APPROVAL = -10;
  const PROC_BASE = 2500, COST_PER_PLANE = 3000, COST_PER_MISSILE = 600, GRANITE_DAILY = 60;
  const REPARATIONS_FRAC = 0.15, REPARATIONS_DAYS = 10;
  const WINNER_APPROVAL = 10, LOSER_APPROVAL = -15;

  // ============================================================
  //  STATE — g.polwarWorld: {mil, wars, reparations, nextWarId, nextFrontId}
  // ============================================================
  function freshState() { return { mil: Object.create(null), wars: Object.create(null), reparations: [], nextWarId: 1, nextFrontId: 1 }; }
  function reset() { g.polwarWorld = freshState(); }
  function state() { if (!g.polwarWorld) reset(); return g.polwarWorld; }

  // ============================================================
  //  MILITARY RECORD — seeded off wealthLevel, deterministic per id.
  // ============================================================
  function wealthOf(id) {
    const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null;
    if (rec && rec.wealthLevel != null) return clamp01(rec.wealthLevel);
    return id === "republic" ? 1.0 : 0.5;
  }
  function seedMilitary(id) {
    const wealth = wealthOf(id), r = mkRng(id);
    const scale = 0.4 + 1.6 * wealth;
    const soldiers = Math.max(40, Math.round(BASE_SOLDIERS * scale * (0.9 + 0.2 * r())));
    const planes = Math.max(1, Math.round(BASE_PLANES * scale * (0.9 + 0.2 * r())));
    const missiles = Math.max(4, Math.round(BASE_MISSILES * scale * (0.9 + 0.2 * r())));
    const readiness = clampNum(0.15, 1, 0.35 + 0.35 * wealth + (r() - 0.5) * 0.1);
    const budgetShare = clampNum(0.05, 0.3, 0.10 + 0.08 * wealth);
    return {
      soldiers: soldiers, planes: planes, missiles: missiles, readiness: readiness, budgetShare: budgetShare,
      seedSoldiers: soldiers, warDead: 0, warCrime: false, warCrimeDay: null,
      pendingKaido: 0, pendingVolante: 0, lastConscriptDay: -999, desperateDays: 0,
      conscriptedEcon: 0, conscriptedCohort: 0, releaseDaysLeft: 0, releasePerDayEcon: 0, releasePerDayCohort: 0,
    };
  }
  function ensureMilitary(id) {
    const S = state();
    if (!S.mil[id]) S.mil[id] = seedMilitary(id);
    return S.mil[id];
  }
  function ensureAllSeeded() {
    const countries = CBZ.polity ? CBZ.polity.list("country") : [];
    for (let i = 0; i < countries.length; i++) ensureMilitary(countries[i].id);
  }
  function combatPower(mil) {
    if (!mil) return 0;
    const raw = mil.soldiers + mil.planes * 15 + mil.missiles * 8;
    return raw * (0.6 + 0.4 * mil.readiness);
  }

  // ============================================================
  //  GEOGRAPHY — capital anchors + the causeway/midpoint front pick.
  // ============================================================
  function capitalOf(countryId) {
    if (countryId === "republic") {
      const lib = CBZ.polity && CBZ.polity.get ? CBZ.polity.get("libertyville") : null;
      return lib && lib.rect ? { id: "libertyville", cx: lib.rect.cx, cz: lib.rect.cz } : null;
    }
    const cd = (CBZ.COUNTRIES || []).find(function (c) { return c.id === countryId; });
    if (!cd) return null;
    const cap = (cd.settlements || []).find(function (s) { return s.capital; });
    return cap ? { id: cap.id, cx: cap.cx, cz: cap.cz } : null;
  }
  function anchorForPolity(id) {
    const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null;
    if (!rec) return { x: 0, z: 0 };
    if (rec.rect) return { x: rec.rect.cx, z: rec.rect.cz };
    if (rec.kind === "country") {
      const cap = capitalOf(id);
      if (cap) return { x: cap.cx, z: cap.cz };
      // generic fallback for a country-kind id with NO COUNTRIES-table entry
      // (an X6b rebel fragment) — centroid of member cities via the parent chain.
      const cities = (CBZ.polity.list ? CBZ.polity.list("city") : []).filter(function (c) {
        const co = CBZ.polity.countryOf ? CBZ.polity.countryOf(c.id) : null;
        return co && co.id === id;
      });
      if (cities.length) {
        let sx = 0, sz = 0;
        for (let i = 0; i < cities.length; i++) { sx += cities[i].rect.cx; sz += cities[i].rect.cz; }
        return { x: sx / cities.length, z: sz / cities.length };
      }
    }
    return { x: 0, z: 0 };
  }
  // real causeway/bridge search: any registered region (city/worldmap.js's
  // CBZ.registerCityRegion) whose name mentions causeway/bridge AND whose
  // centre projects onto the segment between the two anchors (t in [.02,.98])
  // within a plausible corridor width — see file header for why this finds
  // nothing among today's 5 countries, but is real machinery for X6b.
  function findCausewayBetween(a, b) {
    const A = CBZ.city && CBZ.city.arena;
    const regs = A && A.regions;
    if (!regs || !regs.length) return null;
    const abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz || 1;
    let best = null, bestD = Infinity;
    for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      if (!r.name || !/causeway|bridge/i.test(r.name)) continue;
      const rcx = (r.minX + r.maxX) / 2, rcz = (r.minZ + r.maxZ) / 2;
      const t = ((rcx - a.x) * abx + (rcz - a.z) * abz) / len2;
      if (t < 0.02 || t > 0.98) continue;
      const px = a.x + abx * t, pz = a.z + abz * t;
      const d = Math.hypot(rcx - px, rcz - pz);
      if (d > 500) continue;
      if (d < bestD) { bestD = d; best = { x: rcx, z: rcz }; }
    }
    return best;
  }
  function placeFront(anchorA, anchorB) {
    const cw = findCausewayBetween(anchorA, anchorB);
    if (cw) return { x: cw.x, z: cw.z, real: true };
    return { x: (anchorA.x + anchorB.x) / 2, z: (anchorA.z + anchorB.z) / 2, real: false };
  }

  // ============================================================
  //  RELATIONS HELPERS
  // ============================================================
  function nameOf(id) {
    const r = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null;
    return (r && r.name) || id;
  }
  function rippleAllies(aId, bId) {
    if (!CBZ.relations || !CBZ.relations.get || !CBZ.relations.event || !CBZ.polity) return;
    const countries = CBZ.polity.list("country");
    for (let i = 0; i < countries.length; i++) {
      const c = countries[i].id;
      if (c === aId || c === bId) continue;
      if (CBZ.relations.get(c, aId) > ALLY_T) CBZ.relations.event(c, bId, "insult", ALLY_INSULT_MAG);
      if (CBZ.relations.get(c, bId) > ALLY_T) CBZ.relations.event(c, aId, "insult", ALLY_INSULT_MAG);
    }
  }
  // un-hold + set an exact armistice value — relations.js's own warHeld only
  // ever clears via a POSITIVE nudge past its own -60 floor (event()'s own
  // logic); this two-step reaches EXACTLY -40 (armistice, not friendship)
  // afterward without leaving the pair permanently frozen under the hold.
  function armistice(a, b) {
    if (!CBZ.relations || !CBZ.relations.event || !CBZ.relations.set) return;
    CBZ.relations.event(a, b, "trade", 60);
    CBZ.relations.set(a, b, -40);
  }

  // ============================================================
  //  WAR RECORDS
  // ============================================================
  function activeWarFor(id) {
    const S = state();
    for (const wid in S.wars) {
      const w = S.wars[wid];
      if (!w.ended && w.sides.indexOf(id) >= 0) return w;
    }
    return null;
  }
  function warOf(warId) { return state().wars[warId] || null; }

  function declareWar(aId, bId, opts) {
    opts = opts || {};
    if (!aId || !bId || aId === bId) return null;
    const recA = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(aId) : null;
    const recB = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(bId) : null;
    if (!recA || !recB) return null;
    if (activeWarFor(aId) || activeWarFor(bId)) return null;   // single-war-per-polity this wave — see header
    const S = state();
    ensureMilitary(aId); ensureMilitary(bId);
    const milA = S.mil[aId], milB = S.mil[bId];
    const mulA = GOV_MUL[recA.govType] != null ? GOV_MUL[recA.govType] : 1;
    const mulB = GOV_MUL[recB.govType] != null ? GOV_MUL[recB.govType] : 1;
    const aggressor = (mulA * milA.readiness >= mulB * milB.readiness) ? aId : bId;
    const intensity = isFinite(opts.intensity) ? clampNum(0.4, 3, opts.intensity)
      : clampNum(0.5, 3, 1 + (Math.max(mulA, mulB) - 1) * 0.6);
    const anchorA = anchorForPolity(aId), anchorB = anchorForPolity(bId);
    const fg = placeFront(anchorA, anchorB);
    const front = { id: "front" + (S.nextFrontId++), x: fg.x, z: fg.z, real: fg.real, position: 0.5, collapsedSide: null };
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    const war = {
      id: "war" + (S.nextWarId++), sides: [aId, bId], aggressor: aggressor,
      startedDay: day, intensity: intensity, fronts: [front],
      fatigue: {}, ended: false, endedDay: null, loser: null, winner: null, endReason: null, log: [],
    };
    war.fatigue[aId] = 0; war.fatigue[bId] = 0;
    S.wars[war.id] = war;

    if (CBZ.relations) {
      if (CBZ.relations.event) CBZ.relations.event(aId, bId, "war", 30);
      if (CBZ.relations.set) CBZ.relations.set(aId, bId, -90);   // task: "Relations floor at -90"
      rippleAllies(aId, bId);
    }
    const label = nameOf(aId) + " declares war on " + nameOf(bId);
    if (CBZ.city && CBZ.city.big) CBZ.city.big("⚔ WAR: " + nameOf(aId).toUpperCase() + " VS " + nameOf(bId).toUpperCase());
    if (CBZ.cityFeed) CBZ.cityFeed("⚔ " + label + (front.real ? " — front opens at the causeway." : " — front opens at the border."), "#ff6a5e");
    war.log.push({ day: day, kind: "declared", text: label });
    return war;
  }

  // ============================================================
  //  UPKEEP — every seeded country, every day, regardless of war.
  // ============================================================
  function tickUpkeepAll() {
    const countries = CBZ.polity ? CBZ.polity.list("country") : [];
    for (let i = 0; i < countries.length; i++) {
      const rec = countries[i];
      const mil = ensureMilitary(rec.id);
      const upkeep = mil.soldiers * UPKEEP_SOLDIER + mil.planes * UPKEEP_PLANE + mil.missiles * UPKEEP_MISSILE;
      const treasury = rec.treasury || 0;
      const paid = Math.min(treasury, upkeep);
      rec.treasury = treasury - paid;
      if (paid < upkeep - 1e-6) mil.readiness = Math.max(0.1, mil.readiness - READINESS_DECAY);
    }
  }

  // ============================================================
  //  CASUALTIES — counted matériel, deterministic per war.intensity.
  // ============================================================
  function applyCasualties(id, mil, sLoss, mLoss, pLoss) {
    mil.soldiers = Math.max(0, mil.soldiers - sLoss);
    mil.missiles = Math.max(0, mil.missiles - mLoss);
    mil.planes = Math.max(0, mil.planes - pLoss);
    mil.warDead = (mil.warDead || 0) + sLoss;
    if (id === "republic" && CBZ.cityPopulationDie) CBZ.cityPopulationDie(sLoss);
  }

  // ============================================================
  //  FRONT RESOLUTION — position 0..1 pushes toward the weaker side.
  // ============================================================
  function tickFront(front, war, milA, milB) {
    if (front.collapsedSide) return;
    const cpA = combatPower(milA), cpB = combatPower(milB);
    const denom = cpA + cpB || 1;
    const delta = FRONT_MAX_SHIFT * (cpA - cpB) / denom;
    front.position = clampNum(0, 1, front.position + delta);
    if (front.position <= 0) front.collapsedSide = war.sides[0];
    else if (front.position >= 1) front.collapsedSide = war.sides[1];
  }

  // ============================================================
  //  FATIGUE — grows daily, faster for democracies + the miserable side.
  // ============================================================
  function tickFatigue(war, id) {
    const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null;
    if (!rec) return;
    const gov = rec.govType;
    const misery = (id === "republic" && CBZ.hunger && CBZ.hunger.miseryIndex) ? CBZ.hunger.miseryIndex() : DEFAULT_MISERY;
    const mul = gov === "democracy" ? DEM_FATIGUE_MUL : (gov === "monarchy" ? MON_FATIGUE_MUL : 1);
    const gain = FATIGUE_BASE * mul * (1 + misery * 0.5) * war.intensity;
    war.fatigue[id] = (war.fatigue[id] || 0) + gain;
  }

  // ============================================================
  //  CONSCRIPTION — floor-triggered, per-country generalized lever.
  // ============================================================
  function conscriptApprovalHit(gov) { return CONSCRIPT_APPROVAL[gov] != null ? CONSCRIPT_APPROVAL[gov] : -5; }
  function checkConscription(id, day) {
    const S = state(), mil = S.mil[id];
    if (!mil) return;
    if ((day - (mil.lastConscriptDay != null ? mil.lastConscriptDay : -999)) < CONSCRIPT_COOLDOWN_DAYS) return;
    const floor = mil.seedSoldiers * CONSCRIPT_FLOOR_FRAC;
    if (mil.soldiers >= floor) return;
    const batch = Math.max(1, Math.round(mil.seedSoldiers * CONSCRIPT_BATCH_FRAC));
    mil.soldiers += batch;
    mil.lastConscriptDay = day;
    const capId = capitalOf(id);
    if (capId && CBZ.econState && CBZ.econState.get) {
      const est = CBZ.econState.get(capId.id);
      if (est) {
        const before = est.employment;
        est.employment = clampNum(0.05, 0.98, est.employment - CONSCRIPT_ECON_HIT);
        mil.conscriptedEcon += (before - est.employment);
      }
    }
    if (id === "republic" && CBZ.npcEcon && CBZ.npcEcon.adjustEmployedFrac) {
      const applied = CBZ.npcEcon.adjustEmployedFrac(-CONSCRIPT_COHORT_HIT);
      mil.conscriptedCohort += Math.abs(applied);
    }
    const rec = CBZ.polity.get(id);
    const hit = conscriptApprovalHit(rec && rec.govType);
    if (CBZ.approvalShock) CBZ.approvalShock(id, hit);
    if (CBZ.cityFeed) CBZ.cityFeed("📯 " + nameOf(id) + " conscripts " + batch + " more into the ranks — the streets thin.", "#ffb27a");
  }
  function startConscriptRelease(id) {
    const S = state(), mil = S.mil[id];
    if (!mil) return;
    if ((mil.conscriptedEcon || 0) <= 0 && (mil.conscriptedCohort || 0) <= 0) return;
    mil.releaseDaysLeft = CONSCRIPT_RELEASE_DAYS;
    mil.releasePerDayEcon = (mil.conscriptedEcon || 0) / CONSCRIPT_RELEASE_DAYS;
    mil.releasePerDayCohort = (mil.conscriptedCohort || 0) / CONSCRIPT_RELEASE_DAYS;
  }

  // ============================================================
  //  DESPERATE MEASURES — losing authoritarians only.
  // ============================================================
  function fireDesperateMeasure(id, rec, mil, day, forceKind) {
    const kind = forceKind || ((rec.treasury || 0) <= 0 ? "nationalize" : "childsoldiers");
    if (kind === "nationalize") {
      const corps = (CBZ.corps && CBZ.corps.list) ? CBZ.corps.list().filter(function (c) { return c.active && !c.bankrupt; }) : [];
      corps.sort(function (a, b) { return b.cash - a.cash; });
      const target = corps[0];
      if (target && CBZ.corps.debitCash) {
        const amt = Math.round(target.cash * NATIONALIZE_FRAC);
        if (amt > 0) {
          CBZ.corps.debitCash(target.id, amt);
          rec.treasury = (rec.treasury || 0) + amt;
          if (CBZ.cityFeed) CBZ.cityFeed("💰 " + rec.name + " nationalizes " + target.name + "'s cash reserves — a desperate treasury grab.", "#ff6a5e");
        }
      }
    } else {
      const boost = Math.max(1, Math.round((mil.seedSoldiers || mil.soldiers) * CHILD_SOLDIER_FRAC));
      mil.soldiers += boost;
      mil.warCrime = true; mil.warCrimeDay = day;
      rec.warCrime = true;   // live-record mirror — see header (canonical flag is mil.warCrime, persisted below)
      const leaderSid = rec.office && rec.office.holder;
      if (leaderSid && CBZ.cityLedgerEntry) { const e = CBZ.cityLedgerEntry(leaderSid); if (e) e.warCrime = true; }
      const countries = CBZ.polity ? CBZ.polity.list("country") : [];
      for (let i = 0; i < countries.length; i++) {
        if (countries[i].id === id || !CBZ.relations || !CBZ.relations.event) continue;
        CBZ.relations.event(id, countries[i].id, "insult", CHILD_SOLDIER_RELATIONS_MAG);
      }
      if (CBZ.approvalShock) CBZ.approvalShock(id, CHILD_SOLDIER_APPROVAL);
      if (CBZ.city && CBZ.city.big) CBZ.city.big("🚸 WAR CRIME: " + rec.name.toUpperCase() + " CONSCRIPTS CHILDREN");
      if (CBZ.cityFeed) CBZ.cityFeed("🚸 " + rec.name + " turns to child conscription — a war crime the world will not forget.", "#ff3b3b");
    }
  }
  function checkDesperate(id, war, day) {
    const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null;
    if (!rec || !(rec.govType === "dictatorship" || rec.govType === "fascism")) return;
    const S = state(), mil = S.mil[id];
    const oppId = war.sides[0] === id ? war.sides[1] : war.sides[0];
    const oppMil = S.mil[oppId];
    if (!mil || !oppMil) return;
    const losing = combatPower(mil) < combatPower(oppMil) * LOSING_RATIO;
    if (!losing) { mil.desperateDays = 0; return; }
    mil.desperateDays = (mil.desperateDays || 0) + 1;
    if (mil.desperateDays < DESPERATE_DAYS_T) return;
    mil.desperateDays = 0;
    fireDesperateMeasure(id, rec, mil, day);
  }

  // ============================================================
  //  PROCUREMENT — real treasury dollars into KAI/VLT (+ Granite fortifying).
  // ============================================================
  function doProcurement(id, war) {
    const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null;
    if (!rec) return;
    const mil = ensureMilitary(id);
    const budget = Math.min(Math.max(0, rec.treasury || 0), mil.budgetShare * PROC_BASE * war.intensity);
    if (budget > 0 && CBZ.corps && CBZ.corps.creditRevenue) {
      rec.treasury -= budget;
      const half = budget / 2;
      CBZ.corps.creditRevenue("kaido", half);
      CBZ.corps.creditRevenue("volante", half);
      mil.pendingKaido = (mil.pendingKaido || 0) + half;
      mil.pendingVolante = (mil.pendingVolante || 0) + half;
      while (mil.pendingKaido >= COST_PER_PLANE) { mil.pendingKaido -= COST_PER_PLANE; mil.planes++; }
      while (mil.pendingVolante >= COST_PER_MISSILE) { mil.pendingVolante -= COST_PER_MISSILE; mil.missiles++; }
    }
    const graniteSpend = Math.min(Math.max(0, rec.treasury || 0), GRANITE_DAILY * war.intensity);
    if (graniteSpend > 0 && CBZ.corps && CBZ.corps.creditRevenue) {
      rec.treasury -= graniteSpend;
      CBZ.corps.creditRevenue("granite", graniteSpend);
    }
  }

  // ============================================================
  //  WAR ENDINGS — front collapse or fatigue; reparations + armistice.
  // ============================================================
  function endWar(warId, loserId, reason) {
    const S = state(), w = S.wars[warId];
    if (!w || w.ended) return;
    const winnerId = w.sides[0] === loserId ? w.sides[1] : w.sides[0];
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    w.ended = true; w.endedDay = day; w.loser = loserId; w.winner = winnerId; w.endReason = reason;

    const loserRec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(loserId) : null;
    const winnerRec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(winnerId) : null;
    if (loserRec && winnerRec) {
      const total = Math.round((loserRec.treasury || 0) * REPARATIONS_FRAC);
      if (total > 0) {
        S.reparations.push({ payer: loserId, payee: winnerId, remaining: total, perDay: Math.max(1, Math.round(total / REPARATIONS_DAYS)) });
      }
    }
    armistice(loserId, winnerId);
    if (CBZ.approvalShock) { CBZ.approvalShock(winnerId, WINNER_APPROVAL); CBZ.approvalShock(loserId, LOSER_APPROVAL); }
    startConscriptRelease(loserId); startConscriptRelease(winnerId);

    const wName = winnerRec ? winnerRec.name : winnerId, lName = loserRec ? loserRec.name : loserId;
    if (CBZ.city && CBZ.city.big) CBZ.city.big("🕊 WAR ENDS: " + wName.toUpperCase() + " DEFEATS " + lName.toUpperCase());
    if (CBZ.cityFeed) CBZ.cityFeed("🕊 " + reason + " — " + lName + " surrenders to " + wName + ".", "#8fe08a");
    w.log.push({ day: day, kind: "ended", text: reason, loser: loserId, winner: winnerId });
    // regimes.js's own daily tick reacts on its own from here (a losing
    // democracy's approval hit can spiral into emergencyRule) — free, per plan.
  }

  // ============================================================
  //  DAILY DRIPS — reparations + conscript release, both stream over days.
  // ============================================================
  function tickDrips() {
    const S = state();
    for (let i = S.reparations.length - 1; i >= 0; i--) {
      const d = S.reparations[i];
      const payerRec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(d.payer) : null;
      const payeeRec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(d.payee) : null;
      if (!payerRec || !payeeRec) { S.reparations.splice(i, 1); continue; }
      const amt = Math.min(d.remaining, d.perDay, Math.max(0, payerRec.treasury || 0));
      payerRec.treasury = (payerRec.treasury || 0) - amt;
      payeeRec.treasury = (payeeRec.treasury || 0) + amt;
      d.remaining -= amt;
      if (d.remaining <= 0.01) S.reparations.splice(i, 1);
    }
    for (const id in S.mil) {
      const m = S.mil[id];
      if (!(m.releaseDaysLeft > 0)) continue;
      const capId = capitalOf(id);
      if (capId && CBZ.econState && CBZ.econState.get) {
        const est = CBZ.econState.get(capId.id);
        if (est) est.employment = clampNum(0.05, 0.98, est.employment + m.releasePerDayEcon);
      }
      if (id === "republic" && CBZ.npcEcon && CBZ.npcEcon.adjustEmployedFrac && m.releasePerDayCohort > 0) {
        CBZ.npcEcon.adjustEmployedFrac(m.releasePerDayCohort);
      }
      m.conscriptedEcon = Math.max(0, (m.conscriptedEcon || 0) - m.releasePerDayEcon);
      m.conscriptedCohort = Math.max(0, (m.conscriptedCohort || 0) - m.releasePerDayCohort);
      m.releaseDaysLeft--;
    }
  }

  // ============================================================
  //  PER-WAR DAILY TICK
  // ============================================================
  function tickWar(war, day) {
    if (war.ended) return;
    const aId = war.sides[0], bId = war.sides[1];
    const milA = ensureMilitary(aId), milB = ensureMilitary(bId);

    const sLoss = Math.round(SOLDIER_RATE * war.intensity);
    const mLoss = Math.round(MISSILE_RATE * war.intensity);
    const pLoss = Math.round(PLANE_RATE * war.intensity);
    applyCasualties(aId, milA, sLoss, mLoss, pLoss);
    applyCasualties(bId, milB, sLoss, mLoss, pLoss);

    for (let i = 0; i < war.fronts.length; i++) {
      const f = war.fronts[i];
      if (!f.collapsedSide) tickFront(f, war, milA, milB);
      if (f.collapsedSide) { endWar(war.id, f.collapsedSide, "front collapse"); return; }
    }

    tickFatigue(war, aId); tickFatigue(war, bId);
    if (war.fatigue[aId] >= FATIGUE_T) { endWar(war.id, aId, "war exhaustion"); return; }
    if (war.fatigue[bId] >= FATIGUE_T) { endWar(war.id, bId, "war exhaustion"); return; }

    checkConscription(aId, day); checkConscription(bId, day);
    checkDesperate(aId, war, day); checkDesperate(bId, war, day);
    doProcurement(aId, war); doProcurement(bId, war);
  }

  // ============================================================
  //  OUTBREAK SCAN — country-vs-country only, this wave's own AI driver.
  // ============================================================
  function scanOutbreaks() {
    const countries = CBZ.polity ? CBZ.polity.list("country") : [];
    for (let i = 0; i < countries.length; i++) {
      for (let j = i + 1; j < countries.length; j++) {
        const a = countries[i], b = countries[j];
        if (activeWarFor(a.id) || activeWarFor(b.id)) continue;
        if (a.govType === "anarchism" || b.govType === "anarchism") continue;   // "can't declare" — see header
        const pressure = CBZ.relations && CBZ.relations.warPressure ? CBZ.relations.warPressure(a.id, b.id) : 0;
        if (!(pressure > 0)) continue;
        const milA = ensureMilitary(a.id), milB = ensureMilitary(b.id);
        const mulA = GOV_MUL[a.govType] != null ? GOV_MUL[a.govType] : 1;
        const mulB = GOV_MUL[b.govType] != null ? GOV_MUL[b.govType] : 1;
        const escalation = pressure * Math.max(mulA, mulB) * ((milA.readiness + milB.readiness) / 2);
        if (escalation <= ESCALATION_T) continue;
        if (rng() < WAR_ROLL_CHANCE) declareWar(a.id, b.id, {});
      }
    }
  }

  // ============================================================
  //  DAILY TICK — CBZ.onNewDay, after every other P-wave module's own daily
  //  tick (this file loads last in the P-wave block — see header).
  // ============================================================
  function dailyTick(day) {
    ensureAllSeeded();
    tickUpkeepAll();
    const S = state();
    for (const wid in S.wars) {
      const w = S.wars[wid];
      if (w.ended) continue;
      try { tickWar(w, day); } catch (e) { try { console.error("[polwar] tickWar failed", wid, e); } catch (e2) {} }
    }
    tickDrips();
    scanOutbreaks();
  }
  if (CBZ.onNewDay) CBZ.onNewDay(dailyTick);

  // ============================================================
  //  PUBLIC API — X6b's contract: works for ANY two polity ids.
  // ============================================================
  function warsOf(id, opts) {
    opts = opts || {};
    const S = state(), out = [];
    for (const wid in S.wars) {
      const w = S.wars[wid];
      if (w.sides.indexOf(id) < 0) continue;
      if (!opts.all && w.ended) continue;
      out.push(w);
    }
    return out;
  }
  function frontsOf(warId) {
    const w = warOf(warId);
    return w ? w.fronts.slice() : [];
  }
  function militaryOf(id) { return ensureMilitary(id); }
  function allWars(opts) {
    opts = opts || {};
    const S = state(), out = [];
    for (const wid in S.wars) { const w = S.wars[wid]; if (opts.all || !w.ended) out.push(w); }
    return out;
  }

  CBZ.polwar = {
    declareWar: declareWar,
    endWar: endWar,
    warsOf: warsOf,
    frontsOf: frontsOf,
    militaryOf: militaryOf,
    activeWarFor: activeWarFor,
    allWars: allWars,
    reset: reset,
    TUNING: {
      GOV_MUL: Object.assign({}, GOV_MUL), SOLDIER_RATE: SOLDIER_RATE, MISSILE_RATE: MISSILE_RATE, PLANE_RATE: PLANE_RATE,
      UPKEEP_SOLDIER: UPKEEP_SOLDIER, UPKEEP_PLANE: UPKEEP_PLANE, UPKEEP_MISSILE: UPKEEP_MISSILE,
      FATIGUE_T: FATIGUE_T, FATIGUE_BASE: FATIGUE_BASE, DEM_FATIGUE_MUL: DEM_FATIGUE_MUL, MON_FATIGUE_MUL: MON_FATIGUE_MUL,
      CONSCRIPT_FLOOR_FRAC: CONSCRIPT_FLOOR_FRAC, CONSCRIPT_BATCH_FRAC: CONSCRIPT_BATCH_FRAC, CONSCRIPT_APPROVAL: Object.assign({}, CONSCRIPT_APPROVAL),
      LOSING_RATIO: LOSING_RATIO, DESPERATE_DAYS_T: DESPERATE_DAYS_T, NATIONALIZE_FRAC: NATIONALIZE_FRAC, CHILD_SOLDIER_FRAC: CHILD_SOLDIER_FRAC,
      COST_PER_PLANE: COST_PER_PLANE, COST_PER_MISSILE: COST_PER_MISSILE, PROC_BASE: PROC_BASE,
      REPARATIONS_FRAC: REPARATIONS_FRAC, REPARATIONS_DAYS: REPARATIONS_DAYS, CONSCRIPT_RELEASE_DAYS: CONSCRIPT_RELEASE_DAYS,
      FRONT_MAX_SHIFT: FRONT_MAX_SHIFT, ESCALATION_T: ESCALATION_T,
    },
    // harness/test-only hooks — not part of the public contract (mirrors
    // regimes.js's own _forceGov / militia.js's own _forceCrackdown precedent).
    _state: state, _combatPower: combatPower, _anchorForPolity: anchorForPolity,
    _findCausewayBetween: findCausewayBetween, _capitalOf: capitalOf,
    _forceDesperate: function (id, kind) {
      const rec = CBZ.polity.get(id), mil = ensureMilitary(id);
      const w = activeWarFor(id);
      if (rec && mil && w) fireDesperateMeasure(id, rec, mil, CBZ.worldDay ? CBZ.worldDay() : 0, kind);
    },
    _tick: dailyTick,
  };
  CBZ.polwarReset = reset;

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serializeMil(m) {
    return {
      soldiers: m.soldiers, planes: m.planes, missiles: m.missiles, readiness: m.readiness, budgetShare: m.budgetShare,
      seedSoldiers: m.seedSoldiers, warDead: m.warDead || 0, warCrime: !!m.warCrime, warCrimeDay: m.warCrimeDay,
      pendingKaido: m.pendingKaido || 0, pendingVolante: m.pendingVolante || 0,
      lastConscriptDay: m.lastConscriptDay != null ? m.lastConscriptDay : -999, desperateDays: m.desperateDays || 0,
      conscriptedEcon: m.conscriptedEcon || 0, conscriptedCohort: m.conscriptedCohort || 0,
      releaseDaysLeft: m.releaseDaysLeft || 0, releasePerDayEcon: m.releasePerDayEcon || 0, releasePerDayCohort: m.releasePerDayCohort || 0,
    };
  }
  function serializeWar(w) {
    return {
      id: w.id, sides: w.sides.slice(), aggressor: w.aggressor, startedDay: w.startedDay, intensity: w.intensity,
      fronts: w.fronts.map(function (f) { return { id: f.id, x: f.x, z: f.z, real: !!f.real, position: f.position, collapsedSide: f.collapsedSide }; }),
      fatigue: Object.assign({}, w.fatigue), ended: !!w.ended, endedDay: w.endedDay, loser: w.loser, winner: w.winner, endReason: w.endReason,
      log: w.log.slice(-20),
    };
  }
  function serialize() {
    const S = state();
    const mil = {}; for (const id in S.mil) mil[id] = serializeMil(S.mil[id]);
    const wars = {}; for (const wid in S.wars) wars[wid] = serializeWar(S.wars[wid]);
    return {
      v: 1, nextWarId: S.nextWarId, nextFrontId: S.nextFrontId, mil: mil, wars: wars,
      reparations: S.reparations.map(function (d) { return { payer: d.payer, payee: d.payee, remaining: d.remaining, perDay: d.perDay }; }),
    };
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1) return;
    const S = state();
    S.nextWarId = obj.nextWarId || 1; S.nextFrontId = obj.nextFrontId || 1;
    if (obj.mil) for (const id in obj.mil) {
      const src = obj.mil[id]; if (!src) continue;
      S.mil[id] = {
        soldiers: Math.max(0, +src.soldiers || 0), planes: Math.max(0, +src.planes || 0), missiles: Math.max(0, +src.missiles || 0),
        readiness: clampNum(0, 1, isFinite(src.readiness) ? +src.readiness : 0.5),
        budgetShare: clampNum(0.05, 0.3, isFinite(src.budgetShare) ? +src.budgetShare : 0.12),
        seedSoldiers: isFinite(src.seedSoldiers) ? +src.seedSoldiers : Math.max(0, +src.soldiers || 0),
        warDead: +src.warDead || 0, warCrime: !!src.warCrime, warCrimeDay: src.warCrimeDay != null ? src.warCrimeDay : null,
        pendingKaido: +src.pendingKaido || 0, pendingVolante: +src.pendingVolante || 0,
        lastConscriptDay: src.lastConscriptDay != null ? src.lastConscriptDay : -999, desperateDays: +src.desperateDays || 0,
        conscriptedEcon: +src.conscriptedEcon || 0, conscriptedCohort: +src.conscriptedCohort || 0,
        releaseDaysLeft: +src.releaseDaysLeft || 0, releasePerDayEcon: +src.releasePerDayEcon || 0, releasePerDayCohort: +src.releasePerDayCohort || 0,
      };
      if (S.mil[id].warCrime) { const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null; if (rec) rec.warCrime = true; }
    }
    if (obj.wars) for (const wid in obj.wars) {
      const src = obj.wars[wid]; if (!src || !Array.isArray(src.sides) || src.sides.length !== 2) continue;
      S.wars[wid] = {
        id: src.id || wid, sides: src.sides.slice(), aggressor: src.aggressor || src.sides[0], startedDay: src.startedDay || 0,
        intensity: isFinite(src.intensity) ? +src.intensity : 1,
        fronts: Array.isArray(src.fronts) ? src.fronts.map(function (f) {
          return { id: f.id, x: +f.x || 0, z: +f.z || 0, real: !!f.real, position: clampNum(0, 1, isFinite(f.position) ? +f.position : 0.5), collapsedSide: f.collapsedSide || null };
        }) : [],
        fatigue: Object.assign({}, src.fatigue), ended: !!src.ended, endedDay: src.endedDay != null ? src.endedDay : null,
        loser: src.loser || null, winner: src.winner || null, endReason: src.endReason || null,
        log: Array.isArray(src.log) ? src.log.slice(-20) : [],
      };
    }
    if (Array.isArray(obj.reparations)) for (const d of obj.reparations) {
      if (!d || !d.payer || !d.payee) continue;
      S.reparations.push({ payer: d.payer, payee: d.payee, remaining: +d.remaining || 0, perDay: +d.perDay || 1 });
    }
  }
  CBZ.polwar.serialize = serialize;
  CBZ.polwar.apply = apply;

  // ============================================================
  //  SINGLE-PLAYER PERSIST — militia.js's own g.cityWorld pattern, verbatim:
  //  stamp before the existing commit/collect save hooks run, hydrate back
  //  out whenever that ledger object's REFERENCE changes. One-shot install
  //  guard (module-local boolean, checked BEFORE ever wrapping — the P5
  //  chain-growth fix's own convention).
  // ------------------------------------------------------------
  function stampPolwar() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.war = serialize();
  }
  let _ensurePolwarSaveWraps_done = false;
  function ensurePolwarSaveWraps() {
    if (_ensurePolwarSaveWraps_done) return;
    _ensurePolwarSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._polwarWrap) {
      const w = function () { stampPolwar(); return commit.apply(this, arguments); };
      w._polwarWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._polwarWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampPolwar(); return col.apply(this, arguments); };
      wc._polwarWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.war) apply(led.war);
  }
  if (CBZ.onUpdate) {
    // 46.18 — next free slot after militia.js's own 46.17 install-tick.
    CBZ.onUpdate(46.18, function () {
      if (!g) return;
      ensurePolwarSaveWraps();
      hydrateFromLedger();
    });
  }
})();
