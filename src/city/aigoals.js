/* ============================================================
   city/aigoals.js — PURPOSE for the crowd (a real utility-AI need layer)

   The ped brain (city/peds.js) WANDERS and REACTS, but on its own a calm
   ped just hops between random waypoints. This layer gives every NPC a
   believable REASON to be where it's going — an inner life of DRIVES that
   decay over time and get satisfied by acting. It NEVER touches the brain;
   it only SETS the same fields move()/think() already honour (finalGoal /
   path / target / state / rage / pause), then steps back and lets peds.js
   carry the ped there.

   Researched + stolen from real sims:
     • UTILITY AI (F.E.A.R./The Sims line): score EVERY candidate goal by
       "how badly do I need this × is the opportunity here", pick the best.
       Not scripted constants — behaviour EMERGES from need + context.
     • THE SIMS' decaying MOTIVES: each ped carries needs that drain with
       time and are topped up by the matching activity. A starved need
       dominates the score, so a broke ped goes earning, a jonesing addict
       hunts a dealer, an ambitious soldier puts in work for the gang.
     • GTA street economy: dealers POST UP and serve buyers; addicts seek a
       fix and PAY; workers commute; gangsters patrol/expand turf; grudges
       between peds boil over into a real NPC-vs-NPC feud.

   The streets become an economy of behaviour: money actually changes hands
   NPC↔NPC (a user pays a dealer, the dealer kicks up to his gang), feeds
   the gang-promotion currency, and acts on the relationship grudges other
   systems record. Cheap: a tiny slice of the crowd is scored each frame,
   no per-frame allocations, all scans bounded.

   SOMEWHERE TO BE (the legibility layer on top of the needs): a street
   where everyone wanders at random reads as a screensaver; a street where
   the suit hurries to the office tower at day-start, a lunch line forms at
   the diner door, two friends stop for a word and a smoker holds the wall
   outside the bar reads as a CITY — and hands the player patterns to
   exploit (pickpockets work queues; muggers work the lonely commuter).
   Implemented as ordinary goals in the same utility race: COMMUTE (a job
   string → the nearest matching workplace, picked once and cached; clock
   in at day-start, walk home at dusk), ERRANDS (short spaced queues at
   counter-service doors + window-shopping, both bounded citywide), PAIR
   CHATS (two acquainted peds — the social web's partner/clique/crew —
   passing close stop for a 4-8s face-to-face, capped at ~4 pairs), and
   rare STREET MOMENTS (a busker's ring, a paced-out phone call, a smoke by
   the bar door). Day/night gates read CBZ.nightAmount (the canonical sun);
   within-day scheduling reads CBZ.cityHour (peds.js' own loop — the two
   are desynced, so they are never mixed for the same decision).

   Runs at onUpdate order 33 — one tick BEFORE peds @34 — so a freshly
   chosen goal is acted on the same frame. City-mode only. It defers to the
   brain whenever a ped is fighting, fleeing, surrendering, being hunted,
   guarding, or is a companion/hostage/driver/vendor/dead.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;
  const A0 = () => (CBZ.CITY && CBZ.CITY.aggro) || {};
  const now = () => CBZ.now || 0;

  // ---- self-defaulted flags (never edit config.js from a wrapped module) ----
  // The LIVING ECONOMY: wages move at the till, rent drains at the door, hunger
  // is a real motive, and a tenant who can't pay gets evicted to the street. All
  // ADDITIVE + feature-detected (wallet.js/housing.js own the ledger; we only
  // CALL the contract) so a partial load or a missing bank can never throw.
  const C = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (C.CITY_LIVING_ECON == null) C.CITY_LIVING_ECON = true;   // master switch for wages/rent/eat
  if (C.CITY_EVICTIONS == null) C.CITY_EVICTIONS = true;       // broke + behind-on-rent → vagrant flip
  if (C.CITY_NPC_HEISTS == null) C.CITY_NPC_HEISTS = true;     // NPCs rob banks + cash-trucks (the director)

  // a tiny independent PRNG so we never disturb peds.js' deterministic stream
  let _s = 13371;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  // rolling cursor through CBZ.cityPeds so each frame handles a fresh slice
  let cursor = 0;

  // ============================================================
  //  NEEDS — the decaying motives that drive every ped (lazy-attached)
  // ------------------------------------------------------------
  //  Each is 0..1, where HIGH = satisfied, LOW = urgent. They drain over
  //  (sim) time and are topped up when the ped does the matching activity.
  //  Drain rates come from PERSONALITY, never hardcoded outcomes:
  //    money    — everyone needs cash; the poor & greedy crave it hardest
  //    high     — only drug users; addicts drain fast and chase a fix
  //    social   — the human pull to be around others (light)
  //    safety   — eroded by fear; a scared ped's only goal is to be safe
  //    ambition — gang members' drive to climb; fed by putting in work
  // ============================================================
  function needs(ped) {
    let N = ped._needs;
    if (!N) {
      const greed = 0.4 + ped.aggr * 0.5 + (1 - (ped.wealth || 0.4)) * 0.4; // poor/aggressive want money
      const poor = 1 - (ped.wealth || 0.4);                          // the poor & active burn through a meal faster
      N = ped._needs = {
        money: 0.45 + rng() * 0.4,
        high: ped.drugUser ? (0.3 + rng() * 0.4) : 1,
        social: 0.5 + rng() * 0.4,
        ambition: ped.gang ? (0.4 + rng() * 0.3) : 0.6,
        // FOOD — the oldest motive. Everyone gets hungry; a meal tops it up. A
        // person who CAN'T afford to eat (broke) stays low and turns desperate.
        food: 0.5 + rng() * 0.4,
        // RENT — a SLOW dread that builds over many minutes (drains ~10× slower
        // than money). Looming rent makes earning feel urgent; paying it at the
        // door (LE3) is what tops it back up. Vagrants carry no rent (they're full).
        rent: ped.vagrant ? 1 : (0.6 + rng() * 0.3),
        // per-ped drain rates (units per second of sim time), personality-shaped
        kMoney: (0.006 + 0.010 * greed) * (0.7 + rng() * 0.6),
        kHigh: ped.drugUser ? (0.010 + 0.018 * (ped.erratic || 0.2)) : 0,
        kSocial: 0.004 + rng() * 0.004,
        kAmb: ped.gang ? (0.005 + 0.008 * ped.aggr) : 0,
        kFood: (0.008 + 0.006 * poor) * (0.75 + rng() * 0.5),         // ~0.008..0.014/s
        kRent: ped.vagrant ? 0 : (0.0006 + rng() * 0.0004),          // ~0.0008/s — bites over minutes
        t: now(),
      };
    }
    return N;
  }
  // decay needs by the elapsed sim-time since we last looked at this ped
  function decayNeeds(ped) {
    const N = needs(ped);
    const dt = Math.min(20, Math.max(0, (now() - N.t) / 1000)); // ms->s; cap so a long LOD gap doesn't nuke it
    N.t = now();
    if (dt <= 0) return N;
    N.money = clamp01(N.money - N.kMoney * dt);
    if (ped.drugUser) N.high = clamp01(N.high - N.kHigh * dt);
    N.social = clamp01(N.social - N.kSocial * dt);
    if (ped.gang) N.ambition = clamp01(N.ambition - N.kAmb * dt);
    // hunger always builds; rent always looms (both slow burns vs. money)
    N.food = clamp01(N.food - (N.kFood || 0) * dt);
    N.rent = clamp01(N.rent - (N.kRent || 0) * dt);
    return N;
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function satisfy(N, key, amt) { N[key] = clamp01((N[key] || 0) + amt); }

  // ============================================================
  //  goal helpers — only SET fields, let the ped brain do the walking
  // ============================================================

  // pick a shop/workplace lot to head to (optionally by kind)
  function shopByKind(A, kind) {
    if (!A.shopLots || !A.shopLots.length) return null;
    if (kind) { const m = A.shopLots.filter((l) => l.kind === kind); if (m.length) return m[(rng() * m.length) | 0]; return null; }
    return A.shopLots[(rng() * A.shopLots.length) | 0];
  }

  // route a ped to a {x,z} goal, crossing at the nearest intersection if far.
  // Mirrors peds.js pickRoutineGoal so the movement reads identical to the
  // brain's, and stamps a short pause so the routine picker won't instantly
  // override the goal we just set.
  function routeTo(ped, A, goal) {
    ped.finalGoal = goal;
    ped.path = null;
    const dGoal = Math.hypot(goal.x - ped.pos.x, goal.z - ped.pos.z);
    if (dGoal > A.step * 0.9) {
      const it = A.nearestIntersection(goal.x, goal.z);
      ped.path = [{ x: it.x + (rng() - 0.5) * 3, z: it.z + (rng() - 0.5) * 3 }, goal];
    } else {
      ped.path = [goal];
    }
    ped.target.set(ped.path[0].x, 0, ped.path[0].z);
    ped.state = "walk";
    ped.pause = 0.4;
  }

  // nearest living, drivable ped matching a test (cheap, bounded squared-dist scan)
  function nearestPed(self, maxd, test) {
    let best = null, bd = maxd * maxd;
    const peds = CBZ.cityPeds;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p === self || p.dead || p.companion || p.controlled || p._parked) continue;
      const dx = p.pos.x - self.pos.x, dz = p.pos.z - self.pos.z, dd = dx * dx + dz * dz;
      if (dd >= bd) continue;
      if (!test(p)) continue;
      bd = dd; best = p;
    }
    return best;
  }

  // is THIS ped a dealer the crowd can score from?
  function isDealerPed(p) { return (p.archetype === "dealer" || (p.gang && p.aggr >= (A0().crook || 0.72))) && !p.vendor; }

  // ============================================================
  //  SOMEWHERE TO BE — shared plumbing for commutes, queues, window-shopping,
  //  pair-chats and street moments (the goals themselves live further down).
  // ------------------------------------------------------------

  // day/night signals. CBZ.nightAmount is the canonical sun (0 day..1 deep
  // night) — use it for day/night GATES. CBZ.cityHour is peds.js' own loose
  // 24h loop (desynced from the sun) — use it only for WITHIN-day schedules.
  function nightAmt() { return CBZ.nightAmount == null ? 0 : CBZ.nightAmount; }
  function hourNow() { return CBZ.cityHour ? CBZ.cityHour() : 12; }
  // a MONOTONIC city-DAY index — increments once per in-city day (peds.js runs a
  // 360s day on the same CBZ.now wall-clock _dayClock advances on). Used purely
  // as a once-per-day STAMP for rent (so a tenant pays on their FIRST home
  // arrival each day, never every dusk loop). Never mixed with the nightAmount
  // sun for the same decision — it's a counter, not a phase.
  const CITY_DAY_LEN = 360;   // matches peds.js DAY_LEN (seconds per in-city day)
  function dayIndex() { return Math.floor((CBZ.now || 0) / (CITY_DAY_LEN * 1000)); }

  // nearest shop lot of the given kinds WITH a usable door (bounded scan)
  function lotNear(A, x, z, kinds, maxd) {
    const ls = A.shopLots; if (!ls) return null;
    let best = null, bd = maxd * maxd;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (kinds.indexOf(l.kind) < 0) continue;
      const d = l.building && l.building.door; if (!d) continue;
      const dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z);
      if (dd < bd) { bd = dd; best = l; }
    }
    return best;
  }
  // unit vector out of a lot's door, away from the building — the direction a
  // queue extends, and the "street side" a smoker/window-shopper stands on.
  function doorOut(lot) {
    const d = lot.building.door;
    const vx = d.x - lot.cx, vz = d.z - lot.cz, m = Math.hypot(vx, vz);
    if (m < 0.4) return { x: 1, z: 0 };
    return { x: vx / m, z: vz / m };
  }
  function face(ped, x, z) {
    if (ped.group) ped.group.rotation.y = Math.atan2(x - ped.pos.x, z - ped.pos.z);
  }

  // ---- speech: social.js owns the attributed subtitle surface. There is no
  //      world-space fallback; if that UI is unavailable, actors simply speak
  //      without manufacturing a label over their heads.
  function bark(ped, text, color, secs) {
    if (CBZ.citySay) { CBZ.citySay(ped, text, color, secs); return; }
  }

  // ---- THE JOB TABLE: every job string the casters deal, mapped onto the city
  //      that actually exists. One record per job — `lots` is where it clocks in
  //      (buildings.js lot kinds), `hours` is the shift window the timetable
  //      runs (schedule.js reads it: a bartender works nights, a cook the
  //      breakfast-through-dinner stretch), `pay` is the $-per-sim-hour an
  //      offline identity accrues at work, and `class` is the trade family —
  //      counters and worker verbs gate on the CLASS string, never the ped ref,
  //      so any actor carrying the class (NPC or not) gets the same verbs.
  //      Jobs with no plausible storefront ("soldier on leave") map to none
  //      and stay drifters by design. ----
  const CITY_JOBS = {
    // service — the counters and curbs that keep the city fed and moving
    "retail worker":       { class: "service", lots: ["clothing", "electronics", "pawn"], hours: [9, 19], pay: 12 },
    // office === desk work: world.js flips a stable subset of downtown towers to
    // lot.kind "office" (furnished with desk anchors). These jobs route to one of
    // THOSE towers first (then the bank/cityhall halls as fallbacks) and, on
    // arrival, CLAIM A DESK and SIT for the shift — "working a job = on the street",
    // same schedule/goal/nav, a destination that ends in a chair. (C5)
    "office worker":       { class: "service", office: true, lots: ["office", "bank", "cityhall", "realtor", "security"], hours: [9, 17], pay: 16 },
    "accountant":          { class: "service", office: true, lots: ["office", "bank", "cityhall"], hours: [9, 17], pay: 20 },
    "bartender":           { class: "service", lots: ["bar", "casino"], hours: [17, 2], pay: 14 },
    "line cook":           { class: "service", lots: ["food"], hours: [7, 21], pay: 11 },
    "barber":              { class: "service", lots: ["barber"], hours: [9, 19], pay: 12 },
    "street vendor":       { class: "service", lots: ["food", "gas"], hours: [7, 20], pay: 10 },
    "cab driver":          { class: "service", lots: ["transit", "gas"], hours: [6, 22], pay: 13 },
    "delivery driver":     { class: "service", lots: ["food", "gas", "transit"], hours: [8, 18], pay: 12 },
    "courier":             { class: "service", lots: ["electronics", "hardware", "food"], hours: [8, 18], pay: 11 },
    "student":             { class: "service", lots: ["electronics", "barber", "clothing"], hours: [10, 16], pay: 5 },
    // trade — hands-on work at the yards and bays
    "mechanic":            { class: "trade", lots: ["chop", "carlot", "gas"], hours: [8, 18], pay: 15 },
    "construction worker": { class: "trade", lots: ["hardware"], hours: [6, 15], pay: 14 },
    "warehouse worker":    { class: "trade", lots: ["hardware", "chop"], hours: [6, 16], pay: 12 },
    "dock worker":         { class: "trade", lots: ["hardware", "chop"], hours: [5, 15], pay: 13 },
    "personal trainer":    { class: "trade", lots: ["gym"], hours: [7, 20], pay: 13 },
    // law — posted eyes (the city's own muscle, not the player's problem until it is)
    "security guard":      { class: "law", lots: ["security", "bank", "casino", "jewelry"], hours: [8, 22], pay: 13 },
    "private security":    { class: "law", lots: ["security", "bank", "casino"], hours: [8, 22], pay: 14 },
    "sheriff's deputy":    { class: "law", lots: ["cityhall", "security"], hours: [8, 18], pay: 16 },
    // medic — the hospital crowd
    "nurse":               { class: "medic", lots: ["hospital"], hours: [7, 19], pay: 16 },
    "doctor":              { class: "medic", lots: ["hospital"], hours: [9, 19], pay: 24 },
    "paramedic":           { class: "medic", lots: ["hospital"], hours: [6, 18], pay: 15 },
    // BIOME WORK (the open archipelago): these jobs have no storefront — they
    // route to a WORK-ANCHOR (worldmap.js / officejobs.js claim) instead of a
    // shopLot. `anchor` is the anchor KIND to claim; `patrol:true` means the
    // worker walks the spot ring continuously (a beat) rather than holding one
    // spot. WHY-first: the farmer grows the city's food, the rancher tends the
    // herd, the ranger keeps the trails, the soldier guards the base, the ski
    // instructor works the slope, ground crew turns the planes, the shopkeeper
    // minds the stand. Each answers who-does-what out where there are no shops.
    "farmer":              { class: "trade", anchor: "field",     hours: [6, 18], pay: 11 },
    "farmhand":            { class: "trade", anchor: "field",     hours: [6, 18], pay: 9 },
    "rancher":             { class: "trade", anchor: "ranch",     hours: [6, 18], pay: 12 },
    "ranger":              { class: "law",   anchor: "trailhead", hours: [7, 19], pay: 14, patrol: true },
    "park ranger":         { class: "law",   anchor: "trailhead", hours: [7, 19], pay: 14, patrol: true },
    "soldier":             { class: "law",   anchor: "armory",    hours: [6, 22], pay: 15, patrol: true },
    "ski instructor":      { class: "service", anchor: "slope",   hours: [8, 17], pay: 13 },
    "skier":               { class: "service", anchor: "slope",   hours: [9, 16], pay: 8 },
    "ground crew":         { class: "trade", anchor: "terminal",  hours: [6, 22], pay: 13 },
    "shopkeeper":          { class: "service", anchor: "shop",    hours: [8, 20], pay: 12 },
  };
  CBZ.cityJobs = CITY_JOBS;       // shops.js gates worker verbs on .class; schedule.js reads .hours/.pay
  // the legacy job→lot vocabulary, derived from the one table (no second list to drift)
  const JOB_KINDS = {};
  // anchor jobs (biome work) have no shopLot `lots` — give them an empty list so
  // they still register as a JOB (schedule.js' castKey + the morning-commute
  // gate test `JOB_KINDS[ped.job]` truthily, and timetables read .hours/.pay
  // straight off CITY_JOBS). The anchor routing happens in jobLot/goEarn below.
  for (const jn in CITY_JOBS) JOB_KINDS[jn] = CITY_JOBS[jn].lots || [];
  CBZ.cityJobKinds = JOB_KINDS;   // schedule.js derives timetables from the same vocabulary
  // the NEAREST plausible workplace, picked ONCE and cached. Re-validated
  // against the live arena so a recycled body / new run can't keep a stale lot.
  function jobLot(ped, A) {
    if (ped.gang || ped.vendor || ped.vagrant) return null;   // posted / on turf / no job
    if (CITY_JOBS[ped.job] && CITY_JOBS[ped.job].anchor) return null;  // anchor job → no shopLot
    const kinds = JOB_KINDS[ped.job];
    if (!kinds || !kinds.length) return null;
    if (ped._jobLot && A.shopLots && A.shopLots.indexOf(ped._jobLot) >= 0 &&
        ped._jobLot.building && ped._jobLot.building.door) return ped._jobLot;
    ped._jobLot = lotNear(A, ped.pos.x, ped.pos.z, kinds, 1e5);
    return ped._jobLot;
  }
  // is this ped a DESK worker (a job flagged office:true in the table)? A desk
  // worker who isn't a gangster/vendor/vagrant gets ped._officeJob=true so the
  // office spine (officejobs.js) recognises it (staffing safety-net + the barge-
  // the-floor WHY) and so goEarn routes it to a CLAIMED desk to sit the shift.
  function isOfficeJob(ped) {
    if (ped.gang || ped.vendor || ped.vagrant) return false;
    const J = CITY_JOBS[ped.job];
    return !!(J && J.office);
  }
  // is this an ANCHOR job (biome work — routes to a work-anchor, not a shopLot)?
  function isAnchorJob(ped) {
    if (ped.gang || ped.vendor || ped.vagrant) return false;
    const J = CITY_JOBS[ped.job];
    return !!(J && J.anchor);
  }
  // is this a GIG job — a courier/delivery/cab driver whose work is to DRIVE a
  // pickup→dropoff run (giglife.js owns the anchors, car + driver loop)? These
  // still clock in at a door via goEarn as the fallback, but when the gig system
  // is loaded + a car slot is free, goGigRun makes them actually drive a route.
  const GIG_JOBS = { "courier": 1, "delivery driver": 1, "cab driver": 1 };
  function isGigJob(ped) {
    if (ped.gang || ped.vendor || ped.vagrant) return false;
    return !!GIG_JOBS[ped.job];
  }
  function tagOfficeJob(ped) {
    const off = isOfficeJob(ped);
    // keep the flag honest across recasts (an identity rewrite can change .job):
    // set it for desk workers, clear a stale one if they're no longer office.
    if (off) ped._officeJob = true;
    else if (ped._officeJob) ped._officeJob = false;
    return off;
  }
  // a ped's DAILY RENT BUDGET — what their wealth tier can comfortably carry.
  // Mirrors LE3's rent fallback (8 + wealth*40) so the affordability bias and the
  // actual outflow agree: a poor soul affords a micro-unit, a tycoon a tower.
  function rentBudget(ped) { return 8 + (ped.wealth || 0.4) * 44; }
  // the home lot's cheapest rent, read READ-ONLY off housing.js's bond (we never
  // write home.owned/listed — only the additive _tenants tag). Falls back to the
  // same wealth-scaled estimate the outflow uses when housing.js hasn't priced it.
  function lotRent(l) {
    const h = l && l.building && l.building.home;
    if (h && h.rent != null) return h.rent;
    // a cheap MICRO tier exists so everyone can afford SOMETHING — estimate one
    // off the building's own value if buildings.js exposed units; else a floor.
    return null;
  }
  // the HOME a ped lives at, picked ONCE and CACHED (the persistent home bond).
  // "Leaving work → heads home" + schedule.js's home/sleep acts all route to the
  // SAME door every day. Selection is AFFORDABILITY-BIASED (poor → cheapest
  // micro-units; wealthy → a nicer tower) and nudged toward a believable commute
  // from their workplace. A ped near no affordable lot still gets the nearest one
  // (goHome must never return false). housing.js owns ped._digs when it's loaded;
  // we only READ it and, as a fallback, populate it the same way.
  function digsLot(ped, A) {
    const hl = A.homeLots; if (!hl || !hl.length) return null;
    // H3: an assigned UNIT (housing.js leases one) is the single source of truth —
    // route to ITS lot so work-exit and schedule's home/sleep share one door.
    if (ped._unit && ped._unit.lot && hl.indexOf(ped._unit.lot) >= 0) {
      ped._digs = ped._unit.lot; return ped._digs;
    }
    // the persistent bond: a cached, still-live home lot wins (stable address).
    if (ped._digs && hl.indexOf(ped._digs) >= 0) return ped._digs;
    ped._digs = null;
    // first assignment: a bounded scan scoring affordability fit + commute. The
    // job lot (if any) is the commute origin; without one we fall to position.
    const ox = (ped._jobLot && ped._jobLot.cx != null) ? ped._jobLot.cx : ped.pos.x;
    const oz = (ped._jobLot && ped._jobLot.cz != null) ? ped._jobLot.cz : ped.pos.z;
    const budget = rentBudget(ped);
    let best = null, bestScore = -Infinity;      // affordability-biased pick
    let near = null, nd = Infinity;              // guaranteed nearest fallback
    for (let i = 0; i < hl.length; i++) {
      const l = hl[i];
      const dx = l.cx - ox, dz = l.cz - oz, dd = dx * dx + dz * dz;
      if (dd < nd) { nd = dd; near = l; }
      const rent = lotRent(l);
      // commute score: closer = better (normalised against a generous radius)
      const commute = 1 / (1 + dd / (260 * 260));
      let afford;
      if (rent == null) afford = 0.5;            // unpriced → neutral (rely on commute)
      else if (rent <= budget) afford = 1 - (rent / Math.max(1, budget)) * 0.35;  // within means, prefer the cheaper end
      else afford = Math.max(0, 0.5 - (rent - budget) / Math.max(1, budget));      // over budget → penalised hard
      const s = afford * 1.6 + commute + rng() * 0.15;   // afford dominates, commute biases, tiny jitter spreads the crowd
      if (s > bestScore) { bestScore = s; best = l; }
    }
    best = best || near;
    ped._digs = best;
    // reciprocal occupancy tag so a landlord/company knows the unit is taken
    // (LE1 seeding + an optional HUD read it). ADDITIVE — never touches home.owned.
    if (best && best.building && best.building.home) {
      const hm = best.building.home;
      hm._tenants = (hm._tenants | 0) + 1;
    }
    return best;
  }

  // ---- bounded shared state for the street furniture of life ----
  const QUEUE_MAX = 3, QUEUE_LEN = 4;     // at most 3 short lines citywide, 2-4 deep
  let _queues = [];                       // {lot, peds:[], t}
  const PAIR_MAX = 4;                     // at most 4 simultaneous chat pairs
  let _pairs = [];                        // {t} — only counts toward the cap
  const MOMENT_MAX = 5;                   // live street moments citywide
  let _moments = [];                      // {t} — only counts toward the cap

  function queueDrop(ped) {
    for (let i = 0; i < _queues.length; i++) {
      const q = _queues[i], k = q.peds.indexOf(ped);
      if (k >= 0) { q.peds.splice(k, 1); if (!q.peds.length) _queues.splice(i, 1); return; }
    }
  }
  // prune the registries every frame (tiny: ≤ 3 queues × 4 peds + two TTL lists).
  // Death/recast degrade here: a body that died, fled or was recycled stops
  // matching (_goalKind no longer "queue") and silently leaves the line.
  function tickRegistries(dt) {
    for (let i = _pairs.length - 1; i >= 0; i--) { _pairs[i].t -= dt; if (_pairs[i].t <= 0) _pairs.splice(i, 1); }
    for (let i = _moments.length - 1; i >= 0; i--) { _moments[i].t -= dt; if (_moments[i].t <= 0) _moments.splice(i, 1); }
    for (let i = _queues.length - 1; i >= 0; i--) {
      const q = _queues[i]; q.t -= dt;
      for (let k = q.peds.length - 1; k >= 0; k--) {
        const p = q.peds[k];
        if (!p || p.dead || p._goalKind !== "queue") q.peds.splice(k, 1);
      }
      if (!q.peds.length || q.t <= 0) _queues.splice(i, 1);
    }
  }

  // is this ped free to be pulled INTO a chat / held a beat? (the mirror of
  // busy(), applied to the OTHER ped — the one not being sliced right now)
  function freeMate(p) {
    if (!p || p.dead || p.vendor || p.companion || p.controlled || p._parked) return false;
    if (p.inCar || p.ko > 0 || p.guard || p.kind === "cop") return false;
    if (p.rage || p.approach || p.surrender || (p.npcWanted | 0) >= 1 || p.alarmed > 0 || p.fear > 2) return false;
    const s = p.state;
    if (s === "fight" || s === "flee" || s === "confront" || s === "surrender" || s === "chat" || s === "loot") return false;
    if (p._goalKind === "queue") return false;          // don't yank someone out of line
    if ((p._chatCD || 0) > now()) return false;
    return true;
  }
  // an ACQUAINTED ped passing close: the social web (partner / clique — direct
  // ref checks, no scan) first, then a same-crew member via one bounded scan.
  // (CBZ.cityRel is the ped→PLAYER axis, so it can't say who knows whom; the
  // ped.partner/ped.friends web social.js weaves is the ped↔ped truth.)
  function chatMateFor(ped) {
    if ((ped._chatCD || 0) > now() || _pairs.length >= PAIR_MAX) return null;
    const tryC = (c) => {
      if (!c || c === ped || !freeMate(c)) return null;
      const d = Math.hypot(c.pos.x - ped.pos.x, c.pos.z - ped.pos.z);
      return (d > 0.6 && d < 9) ? c : null;
    };
    let m = tryC(ped.partner);
    if (m) return m;
    if (ped.friends) for (let i = 0; i < ped.friends.length; i++) { m = tryC(ped.friends[i]); if (m) return m; }
    if (ped.gang && rng() < 0.3) return nearestPed(ped, 7, (p) => p.gang === ped.gang && freeMate(p));
    return null;
  }
  // people talk like people — no meta, no commands, just street small-talk
  const CHAT_OPEN = ["“Been a minute! How you living?”", "“You look tired — you good?”", "“Rent went up AGAIN, I swear.”", "“You hear what happened on 3rd?”", "“We still on for Friday?”", "“This city, man…”"];
  const CHAT_BACK = ["“Same as always.”", "“Hanging in there.”", "“Tell me about it.”", "“Crazy out here lately.”", "“For real.”", "“Don't even start.”"];
  const PHONE_LINES = ["“…yeah. Yeah, I'm on my way.”", "“Tell him I said no. NO.”", "“…uh huh. Uh huh.”", "“I can't talk long.”"];
  function pickLine(arr) { return arr[(rng() * arr.length) | 0]; }

  // both stop, square up face-to-face and talk for 4-8s through the brain's own
  // chat state (peds.js move() ticks chatT and releases them) — then each
  // resumes the walk it was on. Pair cap + a long per-ped cooldown keep it rare.
  function startChat(a, b) {
    const t = 4 + rng() * 4;
    a.state = "chat"; a.chatT = t; a.speed = 0;
    b.state = "chat"; b.chatT = t * (0.85 + rng() * 0.25); b.speed = 0;
    face(a, b.pos.x, b.pos.z); face(b, a.pos.x, a.pos.z);
    bark(a, pickLine(CHAT_OPEN), "#cfe6ff", 2.4);
    bark(b, pickLine(CHAT_BACK), "#cfe6ff", 2.4);
    satisfy(needs(a), "social", 0.3 + rng() * 0.15);
    satisfy(needs(b), "social", 0.3 + rng() * 0.15);
    a._chatCD = b._chatCD = now() + (40 + rng() * 50) * 1000;
    _pairs.push({ t });
    a._goalKind = null; a._meetWith = null;
    a._goalCD = t + 1 + rng() * 3;
    b._goalCD = Math.max(b._goalCD || 0, t + 1);
  }

  // ============================================================
  //  the goals — each returns true if it managed to set one
  // ============================================================

  // tear down a gig run cleanly from any phase (giglife gone, car lost, no drop,
  // recycle, dusk) — return the car, release the pickup, clear all gig state.
  function endGig(ped) {
    if (ped._gigCar && CBZ.cityGigReturnCar) CBZ.cityGigReturnCar(ped._gigCar, false);
    else if (ped.inCar && ped.inCar._gig && CBZ.cityGigReturnCar) CBZ.cityGigReturnCar(ped.inCar, false);
    if (CBZ.cityGigReleasePickup) CBZ.cityGigReleasePickup(ped);
    ped._gigCar = null; ped._gigDrop = null; ped._gigAt = null; ped._gigPhase = null;
    if (ped._goalKind === "gig") ped._goalKind = null;
  }

  // GIG RUN: a courier/delivery/cab driver actually DRIVES a pickup→dropoff
  // route — the visible gig economy (giglife.js owns the anchors, the car + the
  // steering loop; this goal is the BRAIN that strings the legs together). The
  // shape mirrors the anchored goEarn/fieldwork flow: claim a work-anchor
  // (here a gig PICKUP), route to it, then resolve() drives the rest:
  //   leg 1  walk → the pickup curb (no car yet)
  //   leg 2  AT pickup: spawn/enter a car (cityGigSpawnCar = the carjack pattern
  //          but benign, road:null so the ambient AI leaves it to giglife) and
  //          set car._gigTarget = the dropoff; giglife's loop drives there.
  //   leg 3  AT dropoff: PAY the driver (money need), drop the fare/package,
  //          return the car, release the pickup → cycle to a NEW pickup.
  // Feature-detected end-to-end: if giglife isn't loaded or the car cap is hit,
  // we bail (return false) and goEarn falls through to the door clock-in.
  function goGigRun(ped, A, N) {
    if (!CBZ.cityGigClaimPickup || !CBZ.cityGigSpawnCar) return false;   // giglife not loaded
    if (ped.inCar || ped.controlled) return false;                      // already driving / busy
    // respect the concurrency cap up front (and don't claim a pickup we can't use)
    if (!ped._gigCar && CBZ.cityGigCount && CBZ.cityGigCap &&
        CBZ.cityGigCount() >= CBZ.cityGigCap()) return false;
    const pick = CBZ.cityGigClaimPickup(ped);
    if (!pick) return false;
    // walk to the pickup curb; resolve('gig') takes it from there
    routeTo(ped, A, { x: pick.spots[0].x, z: pick.spots[0].z });
    ped._goalKind = "gig";
    ped._gigPhase = "toPickup";
    ped._gigAt = { x: pick.spots[0].x, z: pick.spots[0].z };
    ped._payIsJob = true;       // a gig is a job → clocked in until dusk's goHome
    return true;
  }

  // EARN: ordinary peds commute to a shop/workplace and clock in. A greedier
  // or harder ped instead HUSTLES the rich — shadows a wealthy mark to lift
  // their wallet (a real NPC mugging via the offense pipeline).
  function goEarn(ped, A, N) {
    // greedy/bold peds will rob the rich when one is nearby (utility: high
    // money-need + a fat opportunity walking past). DESPERATION (broke + hungry,
    // set in assign) lowers the aggr gate AND widens the reach — so an ordinary
    // commuter who can't afford to eat visibly turns into a stick-up kid.
    const desp = !!ped._desperate;
    const robGate = desp ? (A0().bold || 0.5) : (A0().crook || 0.72);
    const robReach = desp ? 38 : 26;
    if (ped.aggr >= robGate) {
      const mark = nearestPed(ped, robReach, (p) => !p.vendor && p.kind === "civilian" && (p.wealth || 0) > (desp ? 0.4 : 0.55) && (p.cash | 0) > (desp ? 20 : 40) && p.aggr < ped.aggr && !p.surrender && p.state !== "flee");
      if (mark) {
        ped.rage = mark; ped.state = "fight";
        ped.target.set(mark.pos.x, 0, mark.pos.z);
        if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 12, "mugging");
        // the victim now has a reason to hate the robber — a feud may follow
        CBZ.cityNpcGrudge(mark, ped);
        ped._goalKind = "rob";
        return true;
      }
    }
    // GIG WORK (courier / delivery / cab): the job IS to drive a pickup→dropoff
    // run, so it's the most legible thing this worker can do — try it FIRST. If
    // the gig system is loaded and a car slot is free, goGigRun claims a pickup,
    // pulls an ambient car and drives a fare/package to a drop (paying at the
    // dropoff, then cycling). When it can't (cap hit, no anchors, headless/MP
    // guest), we fall straight through to the ordinary clock-in-at-the-door
    // commute below — so these jobs never stall.
    if (isGigJob(ped) && goGigRun(ped, A, N)) return true;

    // a JOB-HOLDER earns at THEIR workplace — the same door every time (nearest
    // matching lot kind, cached once) — so the walk reads as a commute the
    // player can learn, not a fresh random errand each pass.
    const mine = jobLot(ped, A);

    // DESK WORK (C5): an office-class worker doesn't vanish into a black-box door —
    // they CLAIM a desk and walk to it to SIT the shift. "Working a job = on the
    // street": the SAME schedule/goal/nav, just a destination that ends in a chair.
    // peds.js handles the sit-on-arrival when finalGoal.sitDesk===true; officejobs.js
    // owns who-holds-which-seat. Graceful fallback to the door if no desk is free.
    if (tagOfficeJob(ped) && CBZ.cityClaimDesk) {
      // bias the claim toward THIS firm's floors: officejobs' cityClaimDesk prefers
      // a free desk whose lot === ped._work. Only point _work at a live office lot
      // (never null it — peds.js owns _work and re-validates it for its own nav).
      if (mine && mine.building && mine.building.office) ped._work = mine;
      const anchor = CBZ.cityClaimDesk(ped);
      if (anchor) {
        // the walk-to-and-sit goal the brain carries: sitDesk tells peds.js to ENTER
        // sit on arrival (snap to anchor, face anchor.face); anchor rides along so the
        // seat survives the path rewrite. Routed like any other goal (reads identical).
        routeTo(ped, A, { x: anchor.x, z: anchor.z, sitDesk: true, anchor: anchor });
        ped._goalKind = "work";
        // payday fires at the chair (resolve() below): claiming a desk and sitting IS
        // clocking in, so this is ALWAYS on-the-clock (_payIsJob true even if the lot
        // didn't resolve) — that guarantees dusk's sHome dominates and goHome RELEASES
        // the seat, so a held desk can never be stranded into the evening.
        ped._payAt = { x: anchor.x, z: anchor.z };
        ped._payIsJob = true;
        return true;
      }
      // no free desk this pass → fall through to the door (still reads as a commute);
      // the next assign() pass retries the claim, and officejobs' safety-net helps.
    }

    // BIOME WORK: an anchor-job worker (farmer/rancher/ranger/soldier/ski
    // instructor/ground crew/shopkeeper) doesn't have a shop door — they CLAIM a
    // work-anchor (a field, the barn, the gate, the trailhead, the slope, the
    // apron) and walk to its first task spot to WORK the shift. The SAME
    // schedule/goal/nav as a commuter, just routed to open-ground work. The
    // 'fieldwork' resolver below cycles them through the anchor's spots (patrol
    // roles walk the ring continuously), drips pay, and clocks them in so dusk's
    // goHome releases the anchor. Graceful fallback to a stroll if none is free.
    if (isAnchorJob(ped) && CBZ.cityClaimWorkAnchor) {
      const heldBefore = ped._workAnchor;
      const anchor = CBZ.cityClaimWorkAnchor(ped);
      if (anchor) {
        // keep cycling from the CURRENT spot if we already held this anchor (a
        // slow walker shouldn't get yanked back to spot 0 every re-plan); start
        // fresh at spot 0 only on a brand-new claim.
        if (anchor !== heldBefore) ped._anchorSpot = 0;
        const si = (ped._anchorSpot | 0) % anchor.spots.length;
        const spot = anchor.spots[si] || { x: anchor.x, z: anchor.z };
        routeTo(ped, A, { x: spot.x, z: spot.z });
        ped._goalKind = "fieldwork";
        // payday + clock-in fire at the first spot (resolve() below): claiming an
        // anchor and reaching it IS clocking in, so dusk's sHome dominates and
        // goHome RELEASES the anchor (no slot can be stranded into the evening).
        ped._payAt = { x: spot.x, z: spot.z };
        ped._payIsJob = true;
        return true;
      }
      // no anchor free / none registered → fall through to the wander fallback.
    }

    const lot = mine || shopByKind(A, null);
    if (!lot || !lot.building || !lot.building.door) return false;
    const d = lot.building.door;
    routeTo(ped, A, { x: d.x, z: d.z, enter: true });
    ped._goalKind = "work";
    // mark a payday at the door so EARN actually feeds the money need (below)
    ped._payAt = { x: d.x, z: d.z };
    ped._payIsJob = !!mine;      // arriving at YOUR OWN job = on the clock until dusk
    return true;
  }

  // DEAL: a dealer POSTS UP and serves buyers. If a user with a craving is
  // nearby, the dealer meets them and a sale closes (money flows user→dealer,
  // the dealer kicks a cut up to his gang's treasury = promotion currency).
  // Otherwise the dealer holds a corner near the trap so buyers can find him.
  function goDeal(ped, A, N) {
    const buyer = nearestPed(ped, 38, (p) => p.drugUser && !p.vendor && p.kind !== "cop" && p._needs && p._needs.high < 0.5 && !p.rage && p.state !== "flee");
    if (buyer) {
      routeTo(ped, A, { x: buyer.pos.x, z: buyer.pos.z });
      ped._goalKind = "deal"; ped._dealTo = buyer;
      return true;
    }
    // no buyer in range — post up on a corner near the trap (a dealer's spot)
    const trap = shopByKind(A, "drugs");
    const spot = trap && trap.building && trap.building.door
      ? { x: trap.building.door.x + (rng() - 0.5) * 8, z: trap.building.door.z + (rng() - 0.5) * 8 }
      : A.randomSidewalkPoint();
    routeTo(ped, A, spot);
    ped._goalKind = "post";
    return true;
  }

  // SCORE: an addict with a craving hunts a dealer and pays for a fix. If no
  // dealer is in range, they drift to the trap house to wait for product.
  function goScore(ped, A, N) {
    const dealer = nearestPed(ped, 55, (p) => isDealerPed(p) && !p.rage && p.state !== "flee");
    if (dealer) {
      routeTo(ped, A, { x: dealer.pos.x, z: dealer.pos.z });
      ped._goalKind = "score"; ped._scoreFrom = dealer;
      return true;
    }
    const trap = shopByKind(A, "drugs");
    if (trap && trap.building && trap.building.door) {
      routeTo(ped, A, { x: trap.building.door.x, z: trap.building.door.z, enter: true });
      ped._goalKind = "score"; ped._scoreFrom = null;
      return true;
    }
    return false;
  }

  // CLIMB: an ambitious gang member puts in WORK — patrols/holds his gang's
  // turf, and takes out a rival if one's around (real promotion currency via
  // the hierarchy's scored hook). This is how a soldier earns his stripes.
  function goClimb(ped, A, N) {
    // a rival gangster nearby is a chance to put a body in for the crew
    const rival = nearestPed(ped, 24, (p) => p.gang && p.gang !== ped.gang && p.kind !== "cop" && !p.surrender);
    if (rival) {
      ped.rage = rival; ped.state = "fight";
      ped.target.set(rival.pos.x, 0, rival.pos.z);
      if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 14, "assault");
      ped._goalKind = "warwork";
      return true;
    }
    // else patrol the gang's turf — head toward its centre / a held block
    const gang = ped.gang && CBZ.cityGangById ? CBZ.cityGangById(ped.gang) : null;
    if (gang && gang.center) {
      const c = gang.center;
      routeTo(ped, A, { x: c.x + (rng() - 0.5) * 26, z: c.z + (rng() - 0.5) * 26 });
      ped._goalKind = "patrol";
      // patrolling on home turf slowly proves reliability (seniority/loyalty)
      return true;
    }
    return false;
  }

  // FEUD: act on a GRUDGE the relationship system recorded between two peds.
  // A ped who hates someone (their wallet got lifted, their friend got hurt,
  // a rival shoved them) and is bold enough will go settle it — a real,
  // emergent NPC-vs-NPC feud, not the player ambush (social.js owns that).
  function goFeud(ped) {
    const foe = ped._grudgeOn;
    if (!foe || foe.dead || foe.companion || Math.hypot(foe.pos.x - ped.pos.x, foe.pos.z - ped.pos.z) > 30) { ped._grudgeOn = null; return false; }
    ped.rage = foe; ped.state = "fight";
    ped.target.set(foe.pos.x, 0, foe.pos.z);
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 12, "assault");
    ped._goalKind = "feud";
    return true;
  }

  // DEFEND-TURF: a gang member whose block is being pressed (the player has
  // provoked his crew) converges on the THREAT — the player if they're standing
  // in/near the gang's turf, else holds the line at the turf centre. Scales with
  // how provoked the gang is. All gang globals guarded; defers to the brain.
  function goDefendTurf(ped, A, N) {
    if (!ped.gang) return false;
    const gang = CBZ.cityGangById ? CBZ.cityGangById(ped.gang) : null;
    if (!gang) return false;
    const center = gang.center || (CBZ.cityGangHQ && CBZ.cityGangHQ(ped.gang)) || null;
    const P = CBZ.player, PA = CBZ.city && CBZ.city.playerActor;
    // is the player a live threat sitting on our turf? (guarded turf lookup)
    if (P && !P.dead && PA && center) {
      const onTurf = CBZ.cityGangOf ? (CBZ.cityGangOf(P.pos.x, P.pos.z) === gang) : false;
      const dC = Math.hypot(P.pos.x - center.x, P.pos.z - center.z);
      if ((onTurf || dC < 28) && Math.hypot(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z) < 30) {
        ped.rage = PA; ped.state = "fight";
        ped.target.set(P.pos.x, 0, P.pos.z);
        if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.1);
        ped._goalKind = "defend";
        return true;
      }
    }
    // no live intruder — muster on the block (hold the line) until it cools
    if (center) {
      routeTo(ped, A, { x: center.x + (rng() - 0.5) * 16, z: center.z + (rng() - 0.5) * 16 });
      ped._goalKind = "patrol";
      return true;
    }
    return false;
  }

  // PROVE / JOIN: an unaffiliated, ambitious soul who's heard of the player's crew
  // walks UP to pitch joining (only fires when the player actually HAS a gang and
  // some respect/standing). Sets an approach the player can read; the brain
  // carries the walk. Purely a SET — never fights, never stomps.
  function goProve(ped, A, N) {
    if (ped.gang || ped.recruited) return false;
    const pg = g.playerGang;
    if (!pg || !pg.founded) return false;
    const P = CBZ.player, PA = CBZ.city && CBZ.city.playerActor;
    if (!P || P.dead || !PA) return false;
    if ((g.wanted | 0) >= 1) return false;                 // won't pitch a hot player
    const d = Math.hypot(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z);
    if (d > 30 || d < 2.5) return false;                   // only worth it from a believable range
    // walk over and pitch — reuse the brain's approach intent so peds.js carries
    // it (and interact.js can read wantsWork). We only SET, never fight.
    ped.approach = "work"; ped._approachT = 4.5; ped.reactCD = 20;
    ped.finalGoal = { x: P.pos.x, z: P.pos.z };
    ped.target.set(P.pos.x, 0, P.pos.z);
    ped.state = "walk"; ped.path = null; ped.pause = 0.3;
    ped._goalKind = "prove";
    return true;
  }

  // CHILL: satisfy the social need — drift toward a knot of other peds, or
  // take a brisk cross-town stroll (fills the grid with purposeful traffic).
  function goChill(ped, A, N) {
    if (N.social < 0.35) {
      const mate = nearestPed(ped, 22, (p) => p.kind === "civilian" && !p.vendor && (p.state === "walk" || p.state === "idle"));
      if (mate) {
        routeTo(ped, A, { x: mate.pos.x + (rng() - 0.5) * 3, z: mate.pos.z + (rng() - 0.5) * 3 });
        ped._goalKind = "social";
        return true;
      }
    }
    // a bold soul strides somewhere far (brief speed nudge, restored on lapse)
    const p = A.randomSidewalkPoint();
    if (ped.aggr >= (A0().bold || 0.5) && Math.hypot(p.x - ped.pos.x, p.z - ped.pos.z) < A.step * 2) {
      const it = A.nearestIntersection(A.maxX, A.maxZ); p.x = it.x; p.z = it.z;
      if (!ped._joyT) { ped._baseSpeed0 = ped.baseSpeed; ped.baseSpeed = ped.baseSpeed * 1.6; }
      ped._joyT = 6 + rng() * 6;
    }
    routeTo(ped, A, { x: p.x, z: p.z });
    ped._goalKind = "wander";
    return true;
  }

  // CLOCK OUT: dusk — a worker still on the clock walks home. The tide of
  // bodies OUT of the commercial blocks at sundown is the show (and the lone
  // commuter on a dark side street is exactly who a mugger works).
  function goHome(ped, A) {
    ped._clockedIn = false;
    // shift's over — give the desk back so the next worker can take it (C5/C4).
    // Stands the seated worker up: officejobs clears char.sitting, peds.js leaves
    // the "sit" state on the goal change; the body then walks home like anyone.
    if (ped._deskAnchor && CBZ.cityReleaseDesk) CBZ.cityReleaseDesk(ped);
    // a gig driver clocking out for the night ends any half-started run (returns
    // the car, frees the pickup) so nothing strands into the evening.
    if (ped._gigCar || ped._gigPickup || ped._gigPhase) endGig(ped);
    // a biome worker gives the work-anchor slot back too (so the next farmer/
    // soldier/ranger can take it). Mirrors the desk release. If the anchor has a
    // home, walk toward THAT (the farmhouse, the barracks); else fall to digsLot.
    let anchorHome = null;
    if (ped._workAnchor && ped._workAnchor.home) anchorHome = ped._workAnchor.home;
    if (ped._workAnchor && CBZ.cityReleaseWorkAnchor) CBZ.cityReleaseWorkAnchor(ped);
    const h = anchorHome ? null : digsLot(ped, A);
    let goal;
    if (anchorHome) {
      routeTo(ped, A, { x: anchorHome.x, z: anchorHome.z });
      ped._homeAt = { x: anchorHome.x, z: anchorHome.z };
      ped._goalKind = "home";
      return true;
    }
    if (h) {
      const door = h.building && h.building.door;
      goal = door ? { x: door.x, z: door.z, enter: true }
        : { x: h.cx + (rng() - 0.5) * (h.w || 6), z: h.cz + (rng() - 0.5) * (h.d || 6) };
    } else {
      const p = A.randomSidewalkPoint(); goal = { x: p.x, z: p.z };
    }
    routeTo(ped, A, goal);
    ped._homeAt = { x: goal.x, z: goal.z };
    ped._goalKind = "home";
    return true;
  }

  // ERRAND: queue at a counter-service door (2-4 spaced bodies, brief) or stop
  // at a shop window and look in. Both are magnets the existing wander steers
  // into — and soft patterns the player can read (a queue is a pickpocket's
  // payday; a window-shopper has their back to the street).
  const QUEUE_KINDS = ["food", "barber", "bank"];
  const ERRAND_KINDS = ["food", "barber", "bank", "clothing", "electronics", "jewelry", "pawn", "guns"];
  function goErrand(ped, A, N) {
    const lot = lotNear(A, ped.pos.x, ped.pos.z, ERRAND_KINDS, 34);
    if (!lot) return false;
    const door = lot.building.door, dir = doorOut(lot);
    const px = -dir.z, pz = dir.x;                       // sideways along the frontage
    // an errand at a FOOD counter is also a bite — let the served/looked payoff
    // top up hunger (a snack), so the diner queue isn't purely a money sink.
    ped._errandFood = (lot.kind === "food" || lot.kind === "gas");
    if (QUEUE_KINDS.indexOf(lot.kind) >= 0) {
      // join (or open) the short line at the door — spaced slots, brief, bounded
      let q = null;
      for (let i = 0; i < _queues.length; i++) if (_queues[i].lot === lot) { q = _queues[i]; break; }
      if (!q && _queues.length < QUEUE_MAX && rng() < 0.6) { q = { lot, peds: [], t: 26 + rng() * 12 }; _queues.push(q); }
      if (q && q.peds.length < QUEUE_LEN) {
        const idx = q.peds.length;
        q.peds.push(ped);
        ped._qSlot = {
          x: door.x + dir.x * (1.5 + 1.15 * idx) + px * (rng() - 0.5) * 0.5,
          z: door.z + dir.z * (1.5 + 1.15 * idx) + pz * (rng() - 0.5) * 0.5,
        };
        ped._qFace = { x: door.x, z: door.z };
        // the deeper in line, the longer the wait — reads as the counter serving
        ped._qUntil = now() + 3500 + idx * 2200 + rng() * 2500;
        routeTo(ped, A, { x: ped._qSlot.x, z: ped._qSlot.z });
        ped._goalKind = "queue";
        return true;
      }
    }
    // no line here — drift to the window and look in for a few seconds
    const side = rng() < 0.5 ? 1 : -1;
    ped._winAt = {
      x: door.x + dir.x * 1.4 + px * side * (1.8 + rng() * 1.6),
      z: door.z + dir.z * 1.4 + pz * side * (1.8 + rng() * 1.6),
    };
    ped._winFace = { x: door.x, z: door.z };
    ped._winUntil = now() + 2600 + rng() * 2600;
    routeTo(ped, A, { x: ped._winAt.x, z: ped._winAt.z });
    ped._goalKind = "window";
    return true;
  }

  // EAT: hunger is the oldest motive. A hungry ped walks to the NEAREST place
  // that sells food (diner / gas counter — same goErrand nav, food kinds only)
  // and, on arrival, BUYS a meal (resolve('eat') spends a few $ + tops up food).
  // The catch: a BROKE ped (cash<8) can still walk there but CAN'T pay → food
  // stays low → desperation builds (assign() turns that into a mugging). This is
  // the felt engine behind "a person who can't afford to eat robs someone".
  const FOOD_KINDS = ["food", "gas"];
  function goEat(ped, A, N) {
    const lot = lotNear(A, ped.pos.x, ped.pos.z, FOOD_KINDS, 70);
    if (!lot || !lot.building || !lot.building.door) return false;
    const d = lot.building.door, dir = doorOut(lot);
    // stand just outside the counter door (a grab-and-go), facing in
    ped._eatAt = { x: d.x + dir.x * 1.2, z: d.z + dir.z * 1.2 };
    ped._eatFace = { x: d.x, z: d.z };
    ped._eatUntil = now() + 2600 + rng() * 2200;
    routeTo(ped, A, { x: ped._eatAt.x, z: ped._eatAt.z });
    ped._goalKind = "eat";
    return true;
  }

  // PAIR CHAT: two acquainted peds passing close stop and talk (capped). If the
  // mate's a few steps off, walk to them first ("meet"), then square up.
  function goChat(ped, A, mate) {
    if (!mate || !freeMate(mate)) return false;
    const d = Math.hypot(mate.pos.x - ped.pos.x, mate.pos.z - ped.pos.z);
    if (d <= 3) { startChat(ped, mate); return true; }
    ped._meetWith = mate; ped._meetT = now() + 9000;
    mate.pause = Math.max(mate.pause || 0, 1.5);   // a soft "hold up" — never a hard stop
    routeTo(ped, A, { x: mate.pos.x, z: mate.pos.z });
    ped._goalKind = "meet";
    return true;
  }

  // STREET MOMENT — rare, bounded city texture: drift over to a live busker's
  // ring, pace out a phone call, or smoke outside the bar door. Each is just a
  // goal the wander adopts (never a hard script), so any higher drive — a
  // grudge, a provoked crew, a craving — still overrides it.
  function goMoment(ped, A, N) {
    if (_moments.length >= MOMENT_MAX || (ped._momCD || 0) > now()) return false;
    const r = rng(), night = nightAmt();
    // 1) a busker performing nearby pulls a listener into the ring (peds.js owns
    //    the act itself; this walks an audience over from beyond its 8m pull)
    if (r < 0.35) {
      const perf = nearestPed(ped, 32, (p) => p._role === "busker" && p._stage &&
        Math.hypot(p.pos.x - p._stage.x, p.pos.z - p._stage.z) < 8 && !p.rage && p.state !== "flee");
      if (perf) {
        const a = rng() * 6.283;
        ped._watch = perf;
        ped._watchUntil = now() + 3000 + rng() * 3500;
        routeTo(ped, A, { x: perf.pos.x + Math.cos(a) * (2.5 + rng() * 2), z: perf.pos.z + Math.sin(a) * (2.5 + rng() * 2) });
        ped._goalKind = "watch";
        _moments.push({ t: 14 }); ped._momCD = now() + (45 + rng() * 45) * 1000;
        return true;
      }
    }
    // 2) a smoke against the wall outside the bar door (an evening thing, mostly)
    if (r < 0.6 && (night > 0.3 || rng() < 0.3)) {
      const bar = lotNear(A, ped.pos.x, ped.pos.z, ["bar", "casino"], 30);
      if (bar) {
        const door = bar.building.door, dir = doorOut(bar);
        const side = rng() < 0.5 ? 1 : -1, px = -dir.z, pz = dir.x;
        ped._smokeAt = { x: door.x + dir.x * 1.2 + px * side * 2.2, z: door.z + dir.z * 1.2 + pz * side * 2.2 };
        ped._smokeFace = { x: door.x + dir.x * 8, z: door.z + dir.z * 8 };   // eyes on the street, back to the wall
        ped._smokeUntil = now() + 7000 + rng() * 5000;
        routeTo(ped, A, { x: ped._smokeAt.x, z: ped._smokeAt.z });
        ped._goalKind = "smoke";
        _moments.push({ t: 18 }); ped._momCD = now() + (60 + rng() * 60) * 1000;
        return true;
      }
    }
    // 3) a phone call paced out on the sidewalk (a few short legs, talking)
    const ang = rng() * 6.283;
    ped._paceA = { x: ped.pos.x + Math.cos(ang) * 3, z: ped.pos.z + Math.sin(ang) * 3 };
    ped._paceB = { x: ped.pos.x - Math.cos(ang) * 1.5, z: ped.pos.z - Math.sin(ang) * 1.5 };
    ped._paceN = 2 + ((rng() * 3) | 0);
    routeTo(ped, A, { x: ped._paceA.x, z: ped._paceA.z });
    ped._goalKind = "phone";
    if (rng() < 0.5) bark(ped, pickLine(PHONE_LINES) + "📱", "#dfe7ff", 2.4);
    _moments.push({ t: 12 }); ped._momCD = now() + (50 + rng() * 50) * 1000;
    return true;
  }

  // THE TIMETABLE (schedule.js proposes, this dispatches): every act lands on
  // machinery that already exists — commute (goEarn's cached job door), lunch
  // (goErrand's queues), home, the dealer's corner (goDeal), turf (goClimb) —
  // plus one tiny "hang" (stand a beat at a spot: the bar door after the
  // whistle, the camp fire, the trap's stash drop).
  function hangAt(ped, A, x, z, secs, enter, fx, fz) {
    routeTo(ped, A, enter ? { x, z, enter: true } : { x, z });
    ped._hangAt = { x, z };
    ped._hangFace = fx != null ? { x: fx, z: fz } : null;
    ped._hangUntil = now() + secs * 1000;
    ped._goalKind = "hang";
    return true;
  }
  function goSched(ped, A, N, prop) {
    const act = prop.act;
    let ok = false;
    if (act === "commute" || act === "work") ok = goEarn(ped, A, N);
    else if (act === "lunch") ok = goErrand(ped, A, N);
    else if (act === "home") ok = goHome(ped, A);
    else if (act === "bar" || act === "club") {
      // after the whistle / after dark: hold a spot outside the door — the
      // rope (club.js) and the bar's smokers draft from exactly this crowd
      const lot = lotNear(A, ped.pos.x, ped.pos.z, ["bar", "casino"], 140);
      if (lot) {
        const d = lot.building.door, o = doorOut(lot);
        ok = hangAt(ped, A, d.x + o.x * 1.6 + (rng() - 0.5) * 3, d.z + o.z * 1.6 + (rng() - 0.5) * 3, 9 + rng() * 9, false, d.x, d.z);
      }
    } else if (act === "corner") {
      ok = goDeal(ped, A, N);
      if (ok && rng() < 0.2) bark(ped, "“On it till sunrise.”", "#cfe6ff", 2.2);
    } else if (act === "layup") {
      const trap = shopByKind(A, "drugs");
      if (trap && trap.building && trap.building.door) {
        const d = trap.building.door;
        ok = hangAt(ped, A, d.x + (rng() - 0.5) * 7, d.z + (rng() - 0.5) * 7, 8 + rng() * 8, false);
      }
    } else if (act === "stash") {
      // the take walks to the trap — rob him on the corner BEFORE this run
      const trap = shopByKind(A, "drugs");
      if (trap && trap.building && trap.building.door) {
        const d = trap.building.door;
        ped._stashRun = true;
        ok = hangAt(ped, A, d.x, d.z, 2.5 + rng() * 2, true);
      }
    } else if (act === "post") ok = goClimb(ped, A, N);
    else if (act === "hq") {
      const hq = ped.gang && CBZ.cityGangHQ ? CBZ.cityGangHQ(ped.gang) : null;
      const gg = !hq && ped.gang && CBZ.cityGangById ? CBZ.cityGangById(ped.gang) : null;
      const c = hq || (gg && gg.center);
      if (c) {
        routeTo(ped, A, { x: c.x + (rng() - 0.5) * 10, z: c.z + (rng() - 0.5) * 10 });
        ped._goalKind = "patrol";
        ok = true;
      }
    } else if (act === "camp") {
      // back to the fire that's THEIRS (props.js publishes the camp anchors)
      const camps = CBZ.cityCamps;
      if (camps && camps.length) {
        let best = null, bd = 1e9;
        for (let i = 0; i < camps.length; i++) {
          const dx = camps[i].x - ped.pos.x, dz = camps[i].z - ped.pos.z, dd = dx * dx + dz * dz;
          if (dd < bd) { bd = dd; best = camps[i]; }
        }
        if (best) {
          const a = rng() * 6.283, rr = rng() * (best.r || 3);
          ok = hangAt(ped, A, best.x + Math.cos(a) * rr, best.z + Math.sin(a) * rr, 14 + rng() * 10, false, best.x, best.z);
        }
      }
    }
    if (ok) {
      ped._schedAct = act;   // anchored — schedule.js damps its pull until the next phase
      // the morning commute HURRIES (the stroll speed-nudge plumbing, always restored)
      if (prop.mood === "hurry" && !ped._joyT) { ped._baseSpeed0 = ped.baseSpeed; ped.baseSpeed *= 1.3; ped._joyT = 7 + rng() * 4; }
    }
    return ok;
  }

  // ============================================================
  //  UTILITY PICK — score every goal by need × opportunity × fit, take the
  //  best (small jitter breaks ties so the crowd doesn't move in lockstep).
  // ============================================================
  function assign(ped, A) {
    const B = A0();
    const N = decayNeeds(ped);
    const r = rng();
    const night = nightAmt(), hour = hourNow();
    // a worker who slept through their dusk exit resets quietly before dawn
    if (ped._clockedIn && hour < 6) ped._clockedIn = false;
    // DESK LEAK-GUARD (C5): if a desk-holder is being re-planned while NOT seated
    // (the chair guard in the slice blocks re-plans WHILE they sit, so reaching here
    // means dusk/clock-out or the brain pulled them off the seat), free the desk now.
    // If this very pass re-picks "work", goEarn re-claims the SAME seat (occupant===ped
    // fast-path) before any other ped runs — so a leak is impossible and re-grab is free.
    if (ped._deskAnchor && !(ped.char && ped.char.sitting === true) && CBZ.cityReleaseDesk) {
      CBZ.cityReleaseDesk(ped);
    }

    // ---- score each goal: urgency (1-need) shaped by opportunity & personality ----
    // FEUD: a live grudge target overrides almost everything (it's personal)
    let sFeud = 0;
    if (ped._grudgeOn && !ped._grudgeOn.dead) sFeud = 0.95;

    // SCORE (get high): only users; the lower the high-need, the harder the pull
    let sScore = 0;
    if (ped.drugUser) sScore = (1 - N.high) * 1.1;

    // DEAL: dealers want to move product; stronger when a buyer is craving nearby
    let sDeal = 0;
    if (isDealerPed(ped)) sDeal = 0.4 + (1 - N.money) * 0.7;

    // CLIMB: gang members with ambition + aggression put in work
    let sClimb = 0;
    if (ped.gang && ped.aggr >= (B.bold || 0.5)) sClimb = (1 - N.ambition) * (0.6 + ped.aggr * 0.5);

    // DEFEND-TURF: a gang member whose crew the PLAYER has provoked drops what
    // they're doing to hold the block. Scales with the gang's provoke level vs
    // the player; only meaningful when actually riled. (guarded gang globals)
    let sDefend = 0;
    if (ped.gang && CBZ.cityGangProvoked) {
      const prov = CBZ.cityGangProvoked(ped.gang) || 0;
      if (prov > 0.25) sDefend = Math.min(1.4, prov * 1.3) * (0.5 + ped.aggr * 0.6);
    }

    // PROVE/JOIN: an unaffiliated, ambitious, willing soul seeks out the PLAYER's
    // crew (only when the player founded a gang and has earned a reputation). The
    // hungrier (low money) + bolder, the stronger the pull. One pitch, long CD.
    let sProve = 0;
    if (!ped.gang && !ped.recruited && g.playerGang && g.playerGang.founded &&
        (g.respect || 0) >= 4 && (g.wanted | 0) < 1 && ped.aggr >= (B.bold || 0.5)) {
      sProve = (0.5 + (1 - N.money) * 0.5) * (0.5 + ped.aggr * 0.4);
    }

    // EARN: the universal money drive (poor/greedy score it highest)
    let sEarn = (1 - N.money) * 0.95;
    // the MORNING COMMUTE: a job-holder not yet on the clock feels the pull hard
    // at day-start — the suit hurries to the office tower, the dockers to the
    // yard. (nightAmount gates day vs night; cityHour places it within the day.)
    if (!ped._clockedIn && night < 0.45 && hour >= 6 && hour < 10 && JOB_KINDS[ped.job] &&
        !ped.gang && !ped.vendor && !ped.vagrant) sEarn = Math.max(sEarn, 0.85) * 1.35;

    // EAT: hunger pulls toward food the lower it gets — a strong, near-survival
    // drive once it dips under ~0.45 (it outranks errands/chats; only threats and
    // a real money panic beat a starving belly).
    let sEat = 0;
    if (N.food < 0.45 && !ped.vagrant) sEat = (1 - N.food) * 1.15;

    // DESPERATION: broke AND hungry = the floor has dropped out. Earning turns
    // urgent (multiply sEarn) and ordinary peds get bold enough to MUG (goEarn
    // reads ped._desperate to widen the rich-mark reach + lower the aggr gate).
    // This is the felt switch that turns a normal commuter into a stick-up kid.
    ped._desperate = (N.food < 0.3 && N.money < 0.3 && !ped.vagrant && !ped.vendor);
    if (ped._desperate) sEarn = Math.max(sEarn, 0.9) * 1.5;

    // CHILL: the social fallback, plus a baseline so nobody freezes
    let sChill = 0.15 + (1 - N.social) * 0.45;

    // ---- ARCHETYPE / ROLE WEIGHTING: nudge the scores so each ped pursues the
    //      life its role implies. A commuter chases the wage; a jogger/tourist/
    //      busker would rather be OUT among the city (chill/wander); a panhandler
    //      lingers (chill) and barely earns; a watcher hangs back and observes. This
    //      only TILTS the utility race — the urgent needs (a craving, a grudge, a
    //      provoked crew) still win, so behaviour stays emergent, not scripted. ----
    const role = CBZ.cityPedRole ? CBZ.cityPedRole(ped) : (ped._role || ped.archetype);
    if (role === "commuter" || role === "vendor") sEarn *= 1.25;
    else if (role === "jogger" || role === "tourist" || role === "busker") { sChill *= 1.7; sEarn *= 0.65; }
    else if (role === "panhandler") { sChill *= 1.5; sEarn *= 0.4; }
    else if (role === "watcher") { sChill *= 1.3; }
    else if (role === "dealer") sDeal *= 1.3;
    else if (role === "junkie") sScore *= 1.25;

    // ---- SOMEWHERE TO BE: the dusk exit, errands, pair-chats, street moments ----
    // CLOCK OUT at dusk: a worker still on the clock heads home (high — it's the
    // whole evening tide — but a live grudge / provoked crew still outranks it).
    let sHome = 0;
    if (ped._clockedIn && (night >= 0.5 || hour >= 19)) sHome = 1.05;

    // PAIR CHAT: an acquainted soul passing close (partner/clique/crew). The
    // mate check is direct refs (no scan), capped citywide, long per-ped CD.
    let sChat = 0, chatMate = null;
    if (!ped.vagrant || night < 0.5) {           // vagrants belong to the camps after dark
      chatMate = chatMateFor(ped);
      if (chatMate) sChat = 0.7 + (1 - N.social) * 0.25;
    }

    // ERRAND: the lunch line at the diner door / a look in a shop window. A
    // daytime habit of people with money in their pocket; noon swells the queues.
    let sErrand = 0;
    if (night < 0.6 && !ped.vagrant && role !== "jogger" && role !== "panhandler" && role !== "busker") {
      sErrand = 0.18 + N.money * 0.22;
      if (hour >= 11 && hour < 14) sErrand *= 1.6;      // the vendor's queue forms at noon
    }

    // STREET MOMENT: rare bounded texture (busker ring / smoke / phone pace)
    let sMoment = 0;
    if (!ped.vagrant && role !== "busker" && role !== "jogger" &&
        _moments.length < MOMENT_MAX && (ped._momCD || 0) <= now()) sMoment = 0.16 + rng() * 0.18;

    // THE TIMETABLE (schedule.js, guarded): where this life is DUE right now —
    // the commute, the corner shift, the camp fire. It races like any other
    // drive, scored UNDER feud/defend, so threats always pre-empt the calendar.
    let sSched = 0, schedProp = null;
    if (CBZ.citySchedProposal) {
      schedProp = CBZ.citySchedProposal(ped);
      if (schedProp) sSched = schedProp.score;
    }

    // small per-goal jitter so equal scores diverge across the crowd
    sFeud *= 1; sScore *= (0.85 + r * 0.3); sDeal *= (0.85 + rng() * 0.3);
    sClimb *= (0.85 + rng() * 0.3); sEarn *= (0.85 + rng() * 0.3); sChill *= (0.85 + rng() * 0.3);
    sDefend *= (0.9 + rng() * 0.2); sProve *= (0.85 + rng() * 0.3);
    sHome *= (0.9 + rng() * 0.2); sChat *= (0.9 + rng() * 0.2);
    sErrand *= (0.85 + rng() * 0.3); sMoment *= (0.85 + rng() * 0.3);
    sSched *= (0.9 + rng() * 0.2); sEat *= (0.9 + rng() * 0.2);

    // rank the goals, try the best first; fall through if its opportunity isn't
    // actually there right now (e.g. no dealer to score from) to the next best.
    const order = [
      ["feud", sFeud], ["defend", sDefend], ["score", sScore], ["deal", sDeal],
      ["climb", sClimb], ["prove", sProve], ["home", sHome], ["eat", sEat],
      ["chat", sChat], ["sched", sSched], ["earn", sEarn], ["errand", sErrand],
      ["moment", sMoment], ["chill", sChill],
    ].sort((a, b) => b[1] - a[1]);

    for (let i = 0; i < order.length; i++) {
      const kind = order[i][0], score = order[i][1];
      if (score <= 0.04) continue;
      let ok = false;
      if (kind === "feud") ok = goFeud(ped);
      else if (kind === "defend") ok = goDefendTurf(ped, A, N);
      else if (kind === "score") ok = goScore(ped, A, N);
      else if (kind === "deal") ok = goDeal(ped, A, N);
      else if (kind === "climb") ok = goClimb(ped, A, N);
      else if (kind === "prove") ok = goProve(ped, A, N);
      else if (kind === "home") ok = goHome(ped, A);
      else if (kind === "eat") ok = goEat(ped, A, N);
      else if (kind === "chat") ok = goChat(ped, A, chatMate);
      else if (kind === "sched") ok = schedProp ? goSched(ped, A, N, schedProp) : false;
      else if (kind === "earn") ok = goEarn(ped, A, N);
      else if (kind === "errand") ok = goErrand(ped, A, N);
      else if (kind === "moment") ok = goMoment(ped, A, N);
      else if (kind === "chill") ok = goChill(ped, A, N);
      if (ok) {
        // cooldown scales with how urgent the chosen goal was (urgent = recheck sooner)
        ped._goalCD = ((kind === "feud" || kind === "defend") ? 5 : 9 + (1 - score) * 12) + rng() * 5;
        return;
      }
    }
    // nothing landed this pass: short retry so we don't spin every frame
    ped._goalCD = 3 + rng() * 4;
  }

  // REAL WAGES (LE2): the money NEED still drives behaviour (a poor ped goes
  // earning), but the wage that satisfies it is now ACTUAL CASH drawn through the
  // ledger — wallet.js's cityWagePay drains the TILL that pays them (the shop's
  // account), so a business with no money can't pay, and the cash a worker earns
  // is real spendable money (rent, meals, a mark to mug). Tuned TINY per tick:
  // pay is $/sim-hour off CITY_JOBS; `factor` keeps a whole shift ≈ one day's
  // rent (a one-shot door/desk payday pays ~a day; a fieldwork/gig drip pays a
  // sliver, many times). Lot may be null (door fallback / anchor) → wallet.js
  // falls back to a generic 'city' account. Fully feature-detected.
  function payWage(ped, lot, factor) {
    if (!CBZ.CONFIG.CITY_LIVING_ECON || !CBZ.cityWagePay) return;
    const J = CITY_JOBS[ped.job];
    const pay = (J && J.pay != null) ? J.pay : 10;
    const wage = Math.max(1, Math.round(pay * factor * (0.8 + rng() * 0.5)));
    CBZ.cityWagePay(ped, lot || null, wage);   // wallet.js credits ped.cash, drains the till
  }

  // ============================================================
  //  ARRIVAL EFFECTS — when a ped reaches/acts on its goal, the need is
  //  satisfied and (for trades) real value moves. Checked cheaply per slice;
  //  no walking is driven here, only the payoff of a goal the brain carried.
  // ============================================================
  function resolve(ped, N) {
    const kind = ped._goalKind;
    if (!kind) return;

    // WORK payday: arrived at the workplace door / desk → earn a wage, fill money
    // need. The wage is REAL CASH now (LE2): cityWagePay drains the employer's
    // till (the desk's lot for office work, the cached job lot for a door job;
    // null lot → wallet's generic 'city' account). A one-shot day's pay — keep
    // the satisfy(money) too (the NEED drives the commute; cash is the byproduct).
    if (kind === "work" && ped._payAt) {
      if (Math.hypot(ped.pos.x - ped._payAt.x, ped.pos.z - ped._payAt.z) < 4.5) {
        satisfy(N, "money", 0.4 + rng() * 0.3);
        satisfy(N, "social", 0.12);
        const tillLot = (ped._deskAnchor && ped._deskAnchor.lot) || ped._jobLot || null;
        if (ped._payIsJob) payWage(ped, tillLot, 1.2);     // one shift's pay at clock-in
        // arrived at YOUR OWN workplace → on the clock until dusk sends you home
        if (ped._payIsJob) { ped._clockedIn = true; ped.pause = Math.max(ped.pause, 1.5 + rng() * 2); }
        ped._payIsJob = false;
        ped._payAt = null; ped._goalKind = null;
      }
      return;
    }

    // FIELDWORK (biome anchor jobs): the worker reaches a task spot, pauses and
    // strikes a WORKING pose (char.working), then advances to the NEXT spot in
    // the anchor's ring (wrapping). A patrol role (ranger/soldier) walks the ring
    // CONTINUOUSLY — a beat with no long holds; a tending role (farmer/rancher/
    // ski instructor/ground crew/shopkeeper) lingers a few seconds at each spot.
    // Pay drips at every spot through the existing satisfy(...,'money',...), and
    // the first arrival clocks them in so dusk's goHome releases the anchor.
    if (kind === "fieldwork") {
      const A = CBZ.city && CBZ.city.arena;   // resolve() has no A param — bind the live arena for routeTo
      const a = ped._workAnchor;
      if (!a || !a.spots || !a.spots.length) { ped._goalKind = null; return; }
      if (!A) { ped._goalKind = null; return; }
      const i = ped._anchorSpot | 0;
      const spot = a.spots[i % a.spots.length];
      const J = CITY_JOBS[ped.job];
      const patrol = !!(J && J.patrol) || !!a.patrol;
      if (Math.hypot(ped.pos.x - spot.x, ped.pos.z - spot.z) < 3.2) {
        // arrived at this spot — clock in on the very first arrival of the shift
        if (ped._payIsJob) { ped._clockedIn = true; ped._payIsJob = false; }
        satisfy(N, "money", 0.16 + rng() * 0.18);          // the wage drips at work
        payWage(ped, (a && a.lot) || null, 0.15);          // a sliver of REAL pay per spot — a whole ring ≈ a day (anchors may have no lot → wallet 'city' fallback)
        satisfy(N, "social", 0.05);
        ped.char && (ped.char.working = true);             // the working pose flag
        // advance to the next task spot (wrap) and route there. We keep the goal
        // as 'fieldwork' (never null it) so the worker walks the whole ring for
        // the shift instead of re-entering the utility race after one spot. The
        // CD is held long enough that the hold + walk play out first.
        const ni = (i + 1) % a.spots.length;
        ped._anchorSpot = ni;
        const next = a.spots[ni];
        routeTo(ped, A, { x: next.x, z: next.z });         // sets ped.pause = 0.4
        ped._goalKind = "fieldwork";                       // routeTo doesn't change it, but be explicit
        ped._payAt = { x: next.x, z: next.z };
        if (patrol) {
          // a beat — a brief square-up then keep flowing down the ring
          ped.pause = Math.max(ped.pause, 0.4 + rng() * 0.6);
          ped._goalCD = Math.max(ped._goalCD || 0, 1.5);
        } else {
          // tending — hold the spot a few seconds in the working pose before the
          // next leg (the longer pause overrides routeTo's 0.4 above)
          face(ped, a.x, a.z);
          ped.pause = Math.max(ped.pause, 2.5 + rng() * 2.5);
          ped._goalCD = Math.max(ped._goalCD || 0, 3.0);
        }
      } else {
        // walking toward the current spot — don't let a re-plan yank them off
        ped._goalCD = Math.max(ped._goalCD || 0, 1.5);
      }
      return;
    }

    // GIG (courier/delivery/cab DRIVE): the multi-leg run. giglife.js owns the
    // car + the steering; this resolver advances the PHASES at each arrival.
    //   toPickup → AT the curb: clock in, spawn/enter the car, pick a dropoff,
    //              hand giglife the first car._gigTarget. (driving phase)
    //   driving  → giglife steers the car to the drop; we just watch the car's
    //              position (the ped rides inside it) and switch to atDrop when
    //              the CAR reaches the dropoff. (no walking driven here)
    //   atDrop   → PAY (money need), drop the fare/package, return the car,
    //              release the old pickup → loop straight into a new run.
    // Any broken precondition (giglife gone, car lost, no drop) ends the run
    // cleanly back to the utility race.
    if (kind === "gig") {
      const phase = ped._gigPhase;
      // -- leg 1→2: reached the pickup curb on foot → grab a car + a destination
      if (phase === "toPickup") {
        const at = ped._gigAt;
        if (!at) { endGig(ped); return; }
        if (Math.hypot(ped.pos.x - at.x, ped.pos.z - at.z) < 4.5) {
          // clock in on arrival (so dusk's goHome releases the pickup + car)
          if (ped._payIsJob) { ped._clockedIn = true; ped._payIsJob = false; }
          const drop = CBZ.cityGigNearestDrop ? CBZ.cityGigNearestDrop(ped.pos.x, ped.pos.z, 30) : null;
          const car = drop && CBZ.cityGigSpawnCar ? CBZ.cityGigSpawnCar(ped, drop, null) : null;
          if (!car || !drop) { endGig(ped); ped.pause = Math.max(ped.pause, 1.0); return; }
          ped._gigCar = car; ped._gigDrop = { x: drop.x, z: drop.z };
          car._gigTarget = { x: drop.x, z: drop.z };
          ped._gigPhase = "driving";
          ped._goalKind = "gig";
          ped._goalCD = Math.max(ped._goalCD || 0, 3);   // hold the goal while we drive
          if (rng() < 0.3) bark(ped, ped.job === "cab driver" ? "“Where to? Hop in.”" : "“Got a drop to make.”", "#cfe6ff", 2.2);
        } else {
          ped._goalCD = Math.max(ped._goalCD || 0, 2);    // still walking to the curb
        }
        return;
      }
      // -- leg 2: driving (giglife steers car._gigTarget). Watch the CAR arrive.
      if (phase === "driving") {
        const car = ped._gigCar, drop = ped._gigDrop;
        if (!car || car.dead || car.npcDriver !== ped || !drop) { endGig(ped); return; }
        if (Math.hypot(car.pos.x - drop.x, car.pos.z - drop.z) < 5.5) {
          ped._gigPhase = "atDrop";
          ped._goalCD = 0.3;          // resolve the dropoff next pass
        } else {
          ped._goalCD = Math.max(ped._goalCD || 0, 1.5);  // keep the goal; giglife drives
        }
        return;
      }
      // -- leg 3: at the dropoff → PAY, drop cargo, return the car, cycle
      if (phase === "atDrop") {
        const car = ped._gigCar;
        satisfy(N, "money", 0.35 + rng() * 0.3);          // the fare / delivery fee
        satisfy(N, "social", 0.08);
        // the fare is REAL money: route it through the ledger (null lot → the
        // customer pays via wallet's 'city' account) for the same clamp/flow as
        // every other wage. If the ledger isn't loaded, credit cash directly so
        // a gig is never unpaid.
        if (CBZ.CONFIG.CITY_LIVING_ECON && CBZ.cityWagePay) {
          const fare = 8 + ((rng() * 14) | 0);
          CBZ.cityWagePay(ped, null, fare);
        } else if (ped.cash != null) {
          ped.cash = (ped.cash | 0) + (8 + ((rng() * 14) | 0));   // real cash earned (no-ledger fallback)
        }
        if (rng() < 0.4) bark(ped, ped.job === "cab driver" ? "“Here you go. Cash or card?”" : "“Delivery! Sign here.”", "#cfe6ff", 2.2);
        if (car && CBZ.cityGigReturnCar) CBZ.cityGigReturnCar(car, true);
        if (CBZ.cityGigReleasePickup) CBZ.cityGigReleasePickup(ped);
        ped._gigCar = null; ped._gigDrop = null; ped._gigAt = null; ped._gigPhase = null;
        ped._goalKind = null;
        // short beat, then the utility race re-picks "earn" → goGigRun starts a
        // fresh run (still clocked in until dusk)
        ped.pause = Math.max(ped.pause, 0.8 + rng());
        ped._goalCD = 1.5 + rng() * 2;
        return;
      }
      // unknown phase — recover
      endGig(ped);
      return;
    }

    // HOME (dusk clock-out): through the door — off the street, day done. This
    // is also where RENT comes due (LE3): the FIRST time a tenant reaches their
    // own door each city-day, the day's rent drains out of their wallet through
    // wallet.js (cityRentPay credits the landlord's account). A broke tenant pays
    // PARTIAL — they fall behind, and that arrears (rent need pinned low) is what
    // the eviction sweep reads. The cash drain itself re-raises the money need on
    // the next decay, so no extra satisfy is needed — paying rent makes you poor.
    if (kind === "home") {
      if (!ped._homeAt) { ped._goalKind = null; return; }
      if (Math.hypot(ped.pos.x - ped._homeAt.x, ped.pos.z - ped._homeAt.z) < 5) {
        satisfy(N, "social", 0.1);
        // RENT DAY-GATE: at most once per city-day (the first home arrival). The
        // rent NEED is settled by getting home and paying — that part runs even
        // with NO ledger loaded (so the crowd doesn't all drift to the eviction
        // floor just because wallet.js isn't up). The CASH transfer is the ledger's
        // job: only cityRentPay actually drains the wallet + credits the landlord.
        if (CBZ.CONFIG.CITY_LIVING_ECON && !ped.vagrant && ped._rentDay !== dayIndex()) {
          const today = dayIndex();
          const A = CBZ.city && CBZ.city.arena;
          let homeLot = (ped._unit && ped._unit.lot) || ped._digs || null;
          if ((!homeLot || (A && A.homeLots && A.homeLots.indexOf(homeLot) < 0)) && A) homeLot = digsLot(ped, A);
          const hm = homeLot && homeLot.building && homeLot.building.home;
          const rent = hm && hm.rent != null ? hm.rent : (8 + (ped.wealth || 0.4) * 40);
          // what the tenant can actually cover (a broke one pays partial = behind).
          const have = ped.cash != null ? (ped.cash | 0) : rent;
          const due = Math.min(rent, have);
          if (due > 0 && CBZ.cityRentPay && homeLot && hm) CBZ.cityRentPay(ped, homeLot, due);   // real wallet drain → landlord acct
          ped._rentDay = today;     // stamp regardless (never retry the same day, even on a $0 pay)
          // settle the rent NEED toward what they covered: a full pay calms it; a
          // broke tenant's partial leaves it LOW — that arrears is what eviction reads.
          satisfy(N, "rent", rent > 0 ? Math.min(1, due / rent) : 1);
        }
        ped._homeAt = null; ped._goalKind = null;
      }
      return;
    }

    // EAT: arrived at the food counter. If the ped can PAY (cash≥8), they buy a
    // meal — food need filled, a few $ spent (which re-raises the money need on
    // the next decay). If BROKE, they linger then drift off STILL HUNGRY — food
    // stays low and desperation keeps climbing. That failure state is the point:
    // the hungry-and-broke are exactly who turn to mugging (goEarn desperation).
    if (kind === "eat") {
      const e = ped._eatAt;
      if (!e) { ped._goalKind = null; return; }
      if (Math.hypot(ped.pos.x - e.x, ped.pos.z - e.z) < 2) {
        ped.path = null; ped.target.set(e.x, 0, e.z);
        ped.pause = Math.max(ped.pause, 1.6); ped.speed = 0;
        if (ped._eatFace) face(ped, ped._eatFace.x, ped._eatFace.z);
        ped._goalCD = Math.max(ped._goalCD || 0, 2);
        if (now() > ped._eatUntil) {
          if ((ped.cash | 0) >= 8) {
            ped.cash -= 4 + ((rng() * 6) | 0);                 // the price of a meal
            satisfy(N, "food", 0.6 + rng() * 0.3);             // belly full
            satisfy(N, "social", 0.06);
          } else {
            satisfy(N, "food", 0.06);                          // can't pay — a scrap at best, still hungry
          }
          ped._eatAt = ped._eatFace = null; ped._goalKind = null;
          ped._goalCD = 2 + rng() * 3; ped.pause = 0.4;
        }
      } else if (now() > (ped._eatUntil || 0) + 6000) { ped._eatAt = ped._eatFace = null; ped._goalKind = null; }
      return;
    }

    // QUEUE: hold your spaced slot in the line, face the counter, get served
    if (kind === "queue") {
      const q = ped._qSlot;
      if (!q) { ped._goalKind = null; return; }
      const t = now();
      if (Math.hypot(ped.pos.x - q.x, ped.pos.z - q.z) < 1.7) {
        ped.path = null; ped.target.set(q.x, 0, q.z);
        ped.pause = Math.max(ped.pause, 1.8); ped.speed = 0;
        if (ped._qFace) face(ped, ped._qFace.x, ped._qFace.z);
        ped._goalCD = Math.max(ped._goalCD || 0, 2);   // nobody re-plans mid-line
        if (t > ped._qUntil) {                          // served — step off content
          satisfy(N, "social", 0.15 + rng() * 0.1);
          if ((ped.cash | 0) > 14) ped.cash -= 3 + ((rng() * 7) | 0);   // a small purchase
          if (ped._errandFood) satisfy(N, "food", 0.4 + rng() * 0.25);  // a bite at the diner counter
          queueDrop(ped);
          ped._qSlot = ped._qFace = null; ped._goalKind = null;
          ped._goalCD = 2 + rng() * 3; ped.pause = 0.4;
        }
      } else if (t > ped._qUntil + 6000) {              // never made it — drift off
        queueDrop(ped); ped._qSlot = ped._qFace = null; ped._goalKind = null;
      }
      return;
    }

    // WINDOW: stand at the glass facing in for a few seconds, then move on
    if (kind === "window") {
      const w = ped._winAt;
      if (!w) { ped._goalKind = null; return; }
      if (Math.hypot(ped.pos.x - w.x, ped.pos.z - w.z) < 2) {
        ped.path = null; ped.target.set(w.x, 0, w.z);
        ped.pause = Math.max(ped.pause, 1.8); ped.speed = 0;
        if (ped._winFace) face(ped, ped._winFace.x, ped._winFace.z);
        ped._goalCD = Math.max(ped._goalCD || 0, 2);
        if (now() > ped._winUntil) {
          satisfy(N, "social", 0.1);
          if (ped._errandFood && (ped.cash | 0) >= 6) { ped.cash -= 2 + ((rng() * 4) | 0); satisfy(N, "food", 0.3 + rng() * 0.2); }  // grabbed something at the stand
          ped._winAt = ped._winFace = null; ped._goalKind = null;
          ped._goalCD = 2 + rng() * 4; ped.pause = 0.4;
        }
      } else if (now() > ped._winUntil + 6000) { ped._winAt = ped._winFace = null; ped._goalKind = null; }
      return;
    }

    // MEET: closing in on an acquainted mate → square up and talk when close
    if (kind === "meet") {
      const m = ped._meetWith;
      if (!m || !freeMate(m) || now() > (ped._meetT || 0)) { ped._meetWith = null; ped._goalKind = null; return; }
      if (Math.hypot(ped.pos.x - m.pos.x, ped.pos.z - m.pos.z) < 2.6) { startChat(ped, m); return; }
      m.pause = Math.max(m.pause || 0, 1.5);            // keep the mate from drifting off
      ped.target.set(m.pos.x, 0, m.pos.z); ped.path = null;
      ped._goalCD = Math.max(ped._goalCD || 0, 2);
      return;
    }

    // WATCH: pause in the busker's ring for a few seconds, then move on
    if (kind === "watch") {
      const perf = ped._watch;
      if (!perf || perf.dead || !perf._stage || now() > (ped._watchUntil || 0) + 8000) { ped._watch = null; ped._goalKind = null; return; }
      if (Math.hypot(ped.pos.x - perf.pos.x, ped.pos.z - perf.pos.z) < 5.5) {
        ped.path = null; ped.target.set(ped.pos.x, 0, ped.pos.z);
        ped.pause = Math.max(ped.pause, 1.8); ped.speed = 0;
        face(ped, perf.pos.x, perf.pos.z);
        ped._goalCD = Math.max(ped._goalCD || 0, 2);
        if (now() > ped._watchUntil) {
          satisfy(N, "social", 0.2);
          ped._watch = null; ped._goalKind = null; ped._goalCD = 2 + rng() * 3; ped.pause = 0.4;
        }
      }
      return;
    }

    // SMOKE: hold the wall by the bar door, eyes on the street
    if (kind === "smoke") {
      const sAt = ped._smokeAt;
      if (!sAt) { ped._goalKind = null; return; }
      if (Math.hypot(ped.pos.x - sAt.x, ped.pos.z - sAt.z) < 2) {
        ped.path = null; ped.target.set(sAt.x, 0, sAt.z);
        ped.pause = Math.max(ped.pause, 1.8); ped.speed = 0;
        if (ped._smokeFace) face(ped, ped._smokeFace.x, ped._smokeFace.z);
        ped._goalCD = Math.max(ped._goalCD || 0, 2);
        if (now() > ped._smokeUntil) {
          satisfy(N, "social", 0.12);
          ped._smokeAt = ped._smokeFace = null; ped._goalKind = null;
          ped._goalCD = 2 + rng() * 3; ped.pause = 0.4;
        }
      } else if (now() > (ped._smokeUntil || 0) + 8000) { ped._smokeAt = ped._smokeFace = null; ped._goalKind = null; }
      return;
    }

    // HANG (schedule): hold the spot the timetable sent you — the bar door
    // after work, the camp fire, the trap drop. A dealer's STASH RUN banks
    // the carry here: wallet drops to walking money, the kick-up feeds the
    // crew treasury (promotion currency) — so catching him fat is a window.
    if (kind === "hang") {
      const hAt = ped._hangAt;
      if (!hAt) { ped._goalKind = null; return; }
      if (Math.hypot(ped.pos.x - hAt.x, ped.pos.z - hAt.z) < 2.4) {
        ped.path = null; ped.target.set(hAt.x, 0, hAt.z);
        ped.pause = Math.max(ped.pause, 1.8); ped.speed = 0;
        if (ped._hangFace) face(ped, ped._hangFace.x, ped._hangFace.z);
        ped._goalCD = Math.max(ped._goalCD || 0, 2);
        if (ped._stashRun) {
          const carry = ped.cash | 0;
          if (carry > 60) {
            const banked = carry - 40;
            ped.cash = 40;
            const gang = ped.gang && CBZ.cityGangById ? CBZ.cityGangById(ped.gang) : null;
            if (gang) gang.treasury = (gang.treasury || 0) + Math.round(banked * 0.6);
            if (ped.gstat) ped.gstat.contrib = (ped.gstat.contrib || 0) + banked;
          }
          ped._stashRun = false;
        }
        if (now() > ped._hangUntil) {
          satisfy(N, "social", 0.15);
          ped._hangAt = ped._hangFace = null; ped._goalKind = null;
          ped._goalCD = 2 + rng() * 3; ped.pause = 0.4;
        }
      } else if (now() > (ped._hangUntil || 0) + 9000) {
        ped._hangAt = ped._hangFace = null; ped._stashRun = false; ped._goalKind = null;
      }
      return;
    }

    // PHONE: pace a short line back and forth, talking, then hang up
    if (kind === "phone") {
      const to = ped._paceA;
      if (!to) { ped._goalKind = null; return; }
      ped._goalCD = Math.max(ped._goalCD || 0, 2);
      if (Math.hypot(ped.pos.x - to.x, ped.pos.z - to.z) < 1.2) {
        if ((ped._paceN | 0) > 0) {
          ped._paceN--;
          const swap = ped._paceB; ped._paceB = ped._paceA; ped._paceA = swap;
          ped.target.set(ped._paceA.x, 0, ped._paceA.z); ped.path = null;
          ped.pause = Math.max(ped.pause, 0.5 + rng() * 0.8);
          if (rng() < 0.25) bark(ped, pickLine(PHONE_LINES) + "📱", "#dfe7ff", 2.2);
        } else {
          satisfy(N, "social", 0.15);
          ped._paceA = ped._paceB = null; ped._goalKind = null; ped._goalCD = 2 + rng() * 3;
        }
      }
      return;
    }

    // DEAL: dealer reached the buyer → close a street sale (NPC↔NPC economy)
    if (kind === "deal" && ped._dealTo) {
      const b = ped._dealTo;
      if (b.dead || !b._needs) { ped._dealTo = null; ped._goalKind = null; return; }
      if (Math.hypot(ped.pos.x - b.pos.x, ped.pos.z - b.pos.z) < 3.2) {
        npcDrugSale(ped, b, N);
        ped._dealTo = null; ped._goalKind = null;
        ped.pause = Math.max(ped.pause, 1.0 + rng()); // linger a beat after the hand-off
      }
      return;
    }

    // SCORE: addict reached a dealer → buy a fix (handled from the dealer side
    // above, but cover the case the buyer arrives first)
    if (kind === "score" && ped._scoreFrom) {
      const d = ped._scoreFrom;
      if (d.dead) { ped._scoreFrom = null; ped._goalKind = null; return; }
      if (Math.hypot(ped.pos.x - d.pos.x, ped.pos.z - d.pos.z) < 3.2) {
        npcDrugSale(d, ped, needs(d));
        ped._scoreFrom = null; ped._goalKind = null;
        ped.pause = Math.max(ped.pause, 0.8 + rng());
      }
      return;
    }

    // PATROL: time on home turf slowly feeds ambition + proves reliability
    if (kind === "patrol") {
      const gang = ped.gang && CBZ.cityGangById ? CBZ.cityGangById(ped.gang) : null;
      if (gang && gang.center && Math.hypot(ped.pos.x - gang.center.x, ped.pos.z - gang.center.z) < 30) {
        satisfy(N, "ambition", 0.06);
        if (ped.gstat) ped.gstat.served = (ped.gstat.served || 0) + 2;
      }
      ped._goalKind = null;
      return;
    }

    // SOCIAL / WANDER: just being out among people tops up the social need
    if (kind === "social" || kind === "wander") {
      satisfy(N, "social", 0.18 + rng() * 0.12);
      ped._goalKind = null;
      return;
    }
  }

  // close a drug sale between two NPCs. The buyer pays from their wallet, the
  // dealer banks it (and kicks a cut to his gang treasury — the promotion
  // currency the hierarchy reads). Both needs get satisfied; the buyer is
  // marked as having a fresh fix so they stop hunting for a while.
  function npcDrugSale(dealer, buyer, dealerN) {
    const econ = CBZ.cityEcon;
    // price tracks the LIVE street market at the buyer's spot (district demand)
    let price = 30;
    if (econ && econ.streetPrice) {
      const drug = ["Weed", "Coke", "Meth", "Pills"][(rng() * 4) | 0];
      price = econ.streetPrice(drug, null);
    }
    const wallet = buyer.cash | 0;
    const pay = Math.max(8, Math.min(wallet > 0 ? wallet : 40, Math.round(price * (0.4 + rng() * 0.4))));
    // move the cash NPC→NPC (buyer broke = a fronted bag, smaller satisfaction)
    if (wallet > 0) { buyer.cash = Math.max(0, wallet - pay); dealer.cash = (dealer.cash || 0) + pay; }
    // satisfy the buyer's craving; a meth/coke hit makes them briefly erratic
    const bN = buyer._needs || needs(buyer);
    satisfy(bN, "high", 0.6 + rng() * 0.3);
    buyer.tweakT = 0; buyer.erratic = Math.max(buyer.erratic || 0, 0.18);
    // satisfy the dealer's money need + bank promotion currency for his gang
    if (dealerN) satisfy(dealerN, "money", 0.18 + rng() * 0.18);
    if (dealer.gang && dealer.gstat) dealer.gstat.contrib = (dealer.gstat.contrib || 0) + pay;
    const gang = dealer.gang && CBZ.cityGangById ? CBZ.cityGangById(dealer.gang) : null;
    if (gang) gang.treasury = (gang.treasury || 0) + Math.round(pay * 0.4);
    // face each other for the hand-off so it reads as a deal, not a bump
    if (dealer.group) dealer.group.rotation.y = Math.atan2(buyer.pos.x - dealer.pos.x, buyer.pos.z - dealer.pos.z);
    if (buyer.group) buyer.group.rotation.y = Math.atan2(dealer.pos.x - buyer.pos.x, dealer.pos.z - buyer.pos.z);
  }

  // ============================================================
  //  PUBLIC: stamp an NPC-vs-NPC grudge so a feud can ignite. Other systems
  //  (combat, social) can call this when one ped wrongs another; the wronged
  //  ped, if bold, will hunt the offender down later (acted on in goFeud).
  // ============================================================
  CBZ.cityNpcGrudge = function (victim, offender) {
    if (!victim || !offender || victim === offender || victim.dead || offender.dead) return;
    if (victim.companion || victim.controlled) return;
    // only bold-enough peds carry a grudge into action (the meek just fear it)
    if ((victim.aggr || 0.3) < (A0().bold || 0.5)) return;
    victim._grudgeOn = offender;
    victim._grudgeT = now() + (60 + rng() * 60) * 1000; // ms: a 60-120s window to act, then it cools
  };

  // DYNAMIC RELATIONSHIPS: when a ped is KILLED, those close to them inherit a
  // fresh grudge against the killer — chained feuds (you down a man, his partner
  // / crew comes for you). Cheap, expiring, bounded: only the partner + a couple
  // of same-gang/nearby bold peds, and never the player's own crew on the player.
  // Skips if the killer isn't an NPC actor we can hunt (e.g. a faceless car).
  CBZ.cityNpcFriendDeath = function (victim, killer) {
    if (!victim || !killer || !killer.pos || killer.dead) return;
    if (killer === victim) return;
    // partner / family first (the strongest tie)
    const kin = [];
    if (victim.partner && !victim.partner.dead) kin.push(victim.partner);
    if (victim.family) for (let i = 0; i < victim.family.length && kin.length < 3; i++) {
      const f = victim.family[i]; if (f && !f.dead && kin.indexOf(f) < 0) kin.push(f);
    }
    for (let i = 0; i < kin.length; i++) CBZ.cityNpcGrudge(kin[i], killer);
    // a couple of nearby SAME-GANG crew also take it personally (bounded n-cap)
    if (victim.gang) {
      const peds = CBZ.cityPeds, R2 = 22 * 22;
      let n = 0;
      for (let i = 0; i < peds.length && n < 2; i++) {
        const p = peds[i];
        if (p === victim || p === killer || p.dead || p.gang !== victim.gang) continue;
        if (p.companion || p.controlled || kin.indexOf(p) >= 0) continue;
        const dx = p.pos.x - victim.pos.x, dz = p.pos.z - victim.pos.z;
        if (dx * dx + dz * dz >= R2) continue;
        CBZ.cityNpcGrudge(p, killer); n++;
      }
    }
  };

  // a ped the brain is mid-action on, or that isn't ours to drive — never stomp
  function busy(ped) {
    if (ped.rage) return true;                       // already engaged
    if (ped.approach) return true;                   // walking up to the player (brain owns it)
    const s = ped.state;
    if (s === "fight" || s === "flee" || s === "confront" ||
        s === "surrender" || s === "loot" || s === "chat") return true;
    if (ped.surrender || ped.alarmed > 0 || ped.fear > 2) return true;
    if (ped.guard) return true;                       // posted guards own their post
    if ((ped.npcWanted | 0) >= 1) return true;        // being hunted by cops
    return false;
  }

  // ============================================================
  //  per-frame: process a thin slice of the crowd (~1/30), rolling cursor
  // ============================================================
  CBZ.onUpdate(33, function (dt) {
    if (g.mode !== "city") return;
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.shopLots) return;
    const peds = CBZ.cityPeds;
    const n = peds.length;
    if (!n) return;

    // somewhere-to-be upkeep: prune queues/pairs/moments + fallback bubbles
    // (bounded: a handful of entries each — never scales with crowd size)
    tickRegistries(dt);

    const slice = Math.max(1, Math.ceil(n / 30));
    if (cursor >= n) cursor = 0;

    for (let k = 0; k < slice; k++) {
      if (cursor >= n) cursor = 0;
      const ped = peds[cursor++];
      if (!ped) continue;

      // tick down the cross-town speed boost regardless (so it's always restored)
      if (ped._joyT > 0) {
        ped._joyT -= dt;
        if (ped._joyT <= 0 && ped._baseSpeed0 != null) { ped.baseSpeed = ped._baseSpeed0; ped._baseSpeed0 = null; ped._joyT = 0; }
      }
      // expire a stale grudge so feuds cool off if never acted on
      if (ped._grudgeOn && ped._grudgeT && now() > ped._grudgeT) { ped._grudgeOn = null; }

      // RESPAWN HYGIENE: crowd.js recycles a PARKED rig into a fresh person. The
      // frame it returns to play (parked→active), wipe every per-ped DRIVE/state
      // this layer attached so a new life never inherits the old one's needs,
      // grudge, goal or stance. (peds.js' _home/_work self-heal against the live
      // arena, so those don't need clearing here.) One-shot, gated by _wasParked.
      if (ped._parked) { ped._wasParked = true; ped._goalCD = 4; continue; }
      if (ped._wasParked) {
        ped._wasParked = false;
        ped._needs = null; ped._grudgeOn = null; ped._grudgeT = 0;
        ped._goalKind = null; ped._goalCD = rng() * 3;
        ped._dealTo = null; ped._scoreFrom = null; ped._payAt = null;
        ped._joyT = 0; if (ped._baseSpeed0 != null) { ped.baseSpeed = ped._baseSpeed0; ped._baseSpeed0 = null; }
        // somewhere-to-be state: a recycled body sheds its old commute/errand
        // life (job + home re-derive from the NEW spawn spot, lines/holds drop)
        queueDrop(ped);
        // give back any office desk the OLD identity held (frees the seat for the
        // next worker; officejobs clears char.sitting). The flag re-derives from the
        // NEW identity's job on its next goEarn via tagOfficeJob.
        if (ped._deskAnchor && CBZ.cityReleaseDesk) CBZ.cityReleaseDesk(ped);
        ped._officeJob = false;
        // give back any biome work-anchor the OLD identity held (frees the slot)
        if (ped._workAnchor && CBZ.cityReleaseWorkAnchor) CBZ.cityReleaseWorkAnchor(ped);
        ped._workAnchor = null; ped._anchorSpot = 0;
        // give back any GIG run the OLD identity held (return the car, free the
        // pickup) so a recycled body never strands a gig car or a pickup slot
        if ((ped._gigCar || ped._gigPickup || ped._gigPhase)) endGig(ped);
        ped._gigCar = null; ped._gigDrop = null; ped._gigAt = null; ped._gigPhase = null; ped._gigPickup = null;
        if (ped.char) ped.char.working = false;
        ped._jobLot = null; ped._digs = null; ped._unit = null; ped._clockedIn = false; ped._payIsJob = false;
        // living-economy state: a fresh identity re-derives its home/rent/hunger
        // (food + rent reset for free with ped._needs=null above). Drop the eat
        // errand, the once-per-day rent stamp, the desperation/food-errand flags.
        ped._rentDay = -1; ped._desperate = false; ped._errandFood = false;
        ped._eatAt = null; ped._eatFace = null; ped._eatUntil = 0;
        // an NPC robber recycled mid-heist gives the job slot back (director frees it below)
        if (ped._npcJob) releaseNpcJob(ped);
        ped._qSlot = null; ped._qFace = null; ped._qUntil = 0;
        ped._winAt = null; ped._winFace = null; ped._winUntil = 0;
        ped._meetWith = null; ped._meetT = 0; ped._chatCD = 0;
        ped._watch = null; ped._watchUntil = 0; ped._homeAt = null;
        ped._smokeAt = null; ped._smokeFace = null; ped._smokeUntil = 0;
        ped._paceA = null; ped._paceB = null; ped._paceN = 0; ped._momCD = 0;
        // schedule state: hangs/stash drop with the old life; the identity sid
        // is schedule.js' call (a deal that JUST landed must survive this tick)
        ped._hangAt = null; ped._hangFace = null; ped._hangUntil = 0; ped._stashRun = false;
        if (CBZ.cityScheduleRecycled) CBZ.cityScheduleRecycled(ped);
        else { ped._sid = null; ped._sched = null; ped._schedAct = null; }
        // brain-side transients a fresh body shouldn't inherit (crowd.park leaves
        // these set); clearing here is safe — aigoals runs one tick before peds.
        ped.approach = null; ped.reactCD = 0; ped.witnessSev = 0; ped.witnessType = null;
        // peds.js ROLE + RAMPAGE per-ped state: a recycled body must shed its old
        // life (re-derive a fresh role) and never inherit a stale spree. _role is
        // nulled so pedRole() re-rolls; the role micro anchors + rampage flags clear.
        ped._role = null; ped._probeT = 0; ped._stage = null; ped._snapAt = null; ped._beg = null;
        ped.rampage = false; ped._rampArmed = 0; ped._rampHeatT = 0; ped._rampT = 0; ped._rampPanicT = 0;
        { const ri = _rampagers.indexOf(ped); if (ri >= 0) _rampagers.splice(ri, 1); }   // drop a recycled body from the director's live list
      }

      // GIG DRIVING CARVE-OUT: a courier/cab mid-run IS controlled + inCar (we
      // hid the body and giglife.js steers the car), so the generic skip below
      // would freeze the run. While the driver is still riding the gig car
      // (driving leg OR the atDrop hand-off that RETURNS the car), keep ticking
      // resolve() so the multi-leg run advances (detects the car reaching the
      // drop, then pays + frees the car). Once atDrop returns the car the ped is
      // no longer inCar, so the normal path resumes next pass. Dead driver / lost
      // car ends the run cleanly.
      if (ped._goalKind === "gig" && ped.inCar && ped.inCar._gig &&
          (ped._gigPhase === "driving" || ped._gigPhase === "atDrop")) {
        if (ped.dead) { endGig(ped); ped._goalCD = 4; continue; }
        resolve(ped, decayNeeds(ped));
        ped._goalCD = Math.max(ped._goalCD || 0, 0.3);
        continue;
      }

      // never touch anyone the brain is busy driving, or who isn't ours to drive
      if (ped.dead || ped.vendor || ped.companion || ped.controlled ||
          ped.inCar || ped.ko > 0) {
        // a gig driver whose car/phase got torn out from under them (player
        // grabbed the car, car exploded) must release the run, not leak it
        if (ped._goalKind === "gig" && !ped.inCar) endGig(ped);
        ped._goalCD = 4; continue;
      }
      if (busy(ped)) { ped._goalCD = 2 + rng() * 3; continue; }

      // EVICTION SWEEP (low cadence): a tenant who's fallen badly behind on rent
      // and is flat broke loses the unit — they flip to the vagrant life right
      // where they stand (no respawn, an additive identity change). Gated to ~once
      // per 30s per ped so it's a slow attrition, and hard-capped citywide so the
      // street doesn't become all hobos. Housing pressure with a real failure
      // state — and it feeds the night-hobo population.
      if (CBZ.CONFIG.CITY_EVICTIONS && (ped._evictT || 0) <= now()) {
        ped._evictT = now() + 28000 + rng() * 8000;
        tryEvict(ped);
      }

      // resolve the PAYOFF of whatever goal this ped is currently pursuing
      // (cheap: just a distance check + need top-up when they've arrived). Runs
      // BEFORE the seated-worker hold below so a just-sat worker still collects the
      // desk payday + clocks in (so dusk's goHome fires and releases the seat).
      if (ped._goalKind) resolve(ped, decayNeeds(ped));

      // A SEATED office worker stays planted for the shift: don't let the utility
      // race walk them out of the chair mid-day (routeTo would break peds.js' sit
      // state). Hold until dusk, when this guard lifts so the normal clock-out
      // (goHome) fires and RELEASES the desk. Threats already drop them out of
      // "sit" via the brain (fight/flee), which busy() catches above. (C5)
      if (ped._deskAnchor && ped.char && ped.char.sitting === true &&
          nightAmt() < 0.5 && hourNow() < 19) { ped._goalCD = 3 + rng() * 3; continue; }

      // ON A ROBBERY: a tagged robber is driven entirely by the crime director
      // (tickNpcJob @36) — the utility race must NOT re-plan them off the job.
      // (If they get engaged the director drops the tag and the brain takes over.)
      if (ped._npcJob) { ped._goalCD = 1 + rng() * 2; continue; }

      // cooldown between fresh goal decisions
      if (ped._goalCD == null) ped._goalCD = rng() * 6;   // stagger first pass
      if (ped._goalCD > 0) { ped._goalCD -= dt; continue; }

      assign(ped, A);
    }
  });

  // ============================================================
  //  LONE-WOLF RAMPAGE DIRECTOR — a dramatic "active shooter" event. On a
  //  random cooldown, a ped SNAPS (ped.rampage = true) and goes on a killing
  //  spree (the spree brain lives in peds.js rampageThink). Now the city feels
  //  DANGEROUS: more shooters, more often, biased hard toward ARMED peds so a
  //  rampage is a real shooting — but still BOUNDED so it stays an EVENT, not a
  //  constant bloodbath:
  //    • up to RAMP_MAX_ACTIVE active rampagers at once (2-3);
  //    • a fresh one is gated by a shared cooldown that shortens with how few
  //      are currently active, so they erupt in waves, not all at once;
  //    • the pick is BIASED toward ARMED / high-aggr peds (armed → a real
  //      mass-shooting) but ANY ped can still snap.
  //  The spree draws a heavy police response (the rampager self-wanteds hard), so
  //  the streets erupt — the player can stop it (respect) or flee. City-gated; all
  //  cross-cluster calls guarded; module state reset on a new run.
  // ------------------------------------------------------------
  const RAMP_MAX_ACTIVE = 5;     // hard cap on concurrent active shooters (was 3/1) — the city should regularly have several gunmen lighting people up
  let _rampagers = [];           // the live rampaging peds (bounded to RAMP_MAX_ACTIVE)
  let _rampCD = 0;               // seconds until the next rampager is eligible
  const RAMP_GAP_MIN = 22, RAMP_GAP_SPAN = 30;   // short calm between waves (~22-52s) — shootings are frequent now

  // fresh run: clear the director + any lingering rampage flags. Called from
  // spawnCityPeds (peds.js) so a new city never inherits an old spree.
  CBZ.cityRampageReset = function () {
    _rampagers = [];
    _rampTipT = -1e9;            // a new run starts with a quiet phone
    _rampCD = 12 + rng() * 18;   // a short grace before the first shooter pops
    // a fresh run also clears the somewhere-to-be street furniture: queues/
    // pairs/moments hold refs/budgets from the OLD city.
    _queues = []; _pairs = []; _moments = [];
    // fresh city → release the ledger's live bindings (the BOOK itself survives:
    // remembered identities re-deal onto the new population at their spots)
    if (CBZ.cityScheduleNewRun) CBZ.cityScheduleNewRun();
    for (const p of (CBZ.cityPeds || [])) {
      p.rampage = false; p._rampArmed = 0; p._rampHeatT = 0; p._rampT = 0; p._rampPanicT = 0;
    }
  };
  // a contact TEXTS you about a spree — never a broadcast. The shooting itself
  // is the alert: gunfire carries (gunVoice attenuates with distance), the
  // crowd screams and scatters, sirens follow. Words only reach you when
  //   (a) the spree is too FAR to hear (otherwise the text is narration), and
  //   (b) somebody is actually IN your phone (crew or your partner) — a nobody
  //       with no network gets no tips; they hear it when they're near it.
  // One quiet feed line, rate-limited hard so back-to-back waves stay silent.
  let _rampTipT = -1e9;          // ms stamp of the last contact text
  function rampagePhoneTip(ped) {
    const P = CBZ.player; if (!P || P.dead || !ped.pos) return;
    if (Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) < 110) return;  // you can hear this one yourself
    const t = (CBZ.now != null ? CBZ.now : 0);
    if (t - _rampTipT < 90000) return;       // your people aren't a police scanner
    let who = null;
    for (const p of (CBZ.cityPeds || [])) { if (p && !p.dead && (p.recruited || p.companion) && p.name) { who = p.name; break; } }
    if (!who && g.cityPartner && !g.cityPartner.dead) who = g.cityPartner.name;
    if (!who) return;
    _rampTipT = t;
    const E = CBZ.cityEcon;
    const where = (E && E.districtAt && E.districtName) ? E.districtName(E.districtAt(ped.pos.x, ped.pos.z)) : "the city";
    if (CBZ.cityFlavor) CBZ.cityFlavor("📱 " + who + ": somebody's spraying up " + where + " — stay clear.", "#9fb0c6");
  }

  // expose a manual trigger (debug / scripted events can force a spree on a ped)
  CBZ.cityStartRampage = function (ped) {
    if (!ped || ped.dead || ped.rampage) return false;
    ped.rampage = true;
    if (_rampagers.indexOf(ped) < 0) _rampagers.push(ped);
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 90, "active-shooter");
    if ((ped.npcWanted | 0) < 3) ped.npcWanted = 3;
    // NO on-screen alert (cut: "⚠️ Active shooter reported nearby!" — it spammed
    // the centre flash up to 5×/wave and told you nothing the street doesn't).
    rampagePhoneTip(ped);
    if (CBZ.cityPanic) CBZ.cityPanic(ped.pos.x, ped.pos.z, 1.6, ped);
    return true;
  };

  // is THIS ped eligible to snap? (alive, ours to drive, not already special)
  function rampageEligible(p) {
    if (!p || p.dead || p.rampage) return false;
    if (p.vendor || p.companion || p.controlled || p.recruited || p._parked) return false;
    if (p.inCar || p.ko > 0 || p.kind === "cop") return false;
    if (p.guard) return false;                       // posted guards stay on post
    return true;
  }

  CBZ.onUpdate(35, function (dt) {
    if (g.mode !== "city") return;
    const peds = CBZ.cityPeds;
    if (!peds || !peds.length) return;

    // prune any rampager that's done (killed / culled / flag cleared). When ALL
    // are down the gap resets long; while some are still live the next slot opens
    // sooner — so a wave of shooters can erupt, then the streets cool.
    let cleared = false;
    for (let i = _rampagers.length - 1; i >= 0; i--) {
      const r = _rampagers[i];
      if (!r || r.dead || !r.rampage || r.culled) {
        if (r) r.rampage = false;
        _rampagers.splice(i, 1);
        cleared = true;
      }
    }
    if (cleared && !_rampagers.length) {
      // last one down → a full cooldown before the city erupts again
      _rampCD = RAMP_GAP_MIN + rng() * RAMP_GAP_SPAN;
    }

    // already at the active cap? hold — never exceed RAMP_MAX_ACTIVE at once.
    if (_rampagers.length >= RAMP_MAX_ACTIVE) return;

    if (_rampCD > 0) { _rampCD -= dt; return; }
    // re-roll cadence while waiting; a thin active list lets the next one come
    // faster (waves), a fuller one slows the trickle (so it's not nonstop).
    _rampCD = 4 + rng() * 6 + _rampagers.length * 6;

    // pick a candidate, BIASED HARD toward ARMED peds (a rampage should be a real
    // SHOOTING now that armed peds are common) but still open to anyone. Scan a
    // bounded sample (n-capped) and score; the best eligible one snaps.
    const B = A0();
    const n = peds.length;
    let best = null, bestScore = -1, scanned = 0;
    const start = (rng() * n) | 0;
    for (let i = 0; i < n && scanned < 50; i++) {
      const p = peds[(start + i) % n];
      if (!rampageEligible(p)) continue;
      scanned++;
      // weight: ARMED dominates (a strapped shooter = a real mass-shooting),
      // plus aggression + a small floor so a meek soul can still snap.
      let s = 0.1 + (p.aggr || 0.2) * 0.8 + (p.armed ? 1.2 : 0) + (p.drugUser ? 0.2 : 0);
      s *= 0.6 + rng() * 0.8;                         // jitter so it isn't always the same profile
      if (s > bestScore) { bestScore = s; best = p; }
    }
    // higher base chance once eligible (sprees erupt more readily), and an ARMED
    // pick almost always goes — an unarmed one is rarer, so most are real shootings.
    if (best && rng() < (best.armed ? 0.85 : 0.4)) {
      CBZ.cityStartRampage(best);
    }
  });

  // ============================================================
  //  EVICTION → VAGRANCY — housing pressure with a real failure state.
  // ------------------------------------------------------------
  //  A tenant whose rent need has been pinned at the floor for a sustained
  //  stretch AND who is flat broke can't make rent — so they lose the unit and
  //  fall to the street, flipping to the SAME panhandler life spawnVagrants
  //  builds (begging via the existing role/_beg microBehaviour — no new behaviour
  //  code). The body is NOT respawned or moved: it's an additive identity change
  //  in place. Hard-capped citywide so the street never becomes all hobos, and
  //  guarded so it NEVER touches a gang member / vendor / family / region-life /
  //  cop / already-vagrant. This is what makes the rent dread mean something —
  //  and it feeds the night-hobo population other systems lean on.
  // ------------------------------------------------------------
  const EVICT_MAX = 6;          // at most this many fresh evictions live citywide
  let _evicted = 0;             // running count (reset on a new run)
  // only an ORDINARY resident can be evicted (everything special is protected)
  function evictEligible(p) {
    if (!p || p.dead || p.vagrant || p.vendor || p.companion || p.controlled || p.recruited || p._parked) return false;
    if (p.gang || p._regionLife || p.kind === "cop" || p.guard) return false;
    if (p.family && p.family.length) return false;       // a family member has people; they don't get put out
    if (p.inCar || p.ko > 0 || p.rage || p.hostage) return false;
    if (p.archetype === "vagrant" || p.job === "panhandling") return false;
    return true;
  }
  function tryEvict(ped) {
    if (_evicted >= EVICT_MAX) return;
    if (!evictEligible(ped)) { ped._rentLowSince = 0; return; }
    const N = ped._needs;
    if (!N) return;
    const broke = (ped.cash != null ? (ped.cash | 0) : 99) < 5;
    const behind = (N.rent || 0) < 0.06;                  // rent need at the floor = badly behind
    if (!broke || !behind) { ped._rentLowSince = 0; return; }
    // require the arrears to have PERSISTED (not a one-frame dip) before we put
    // someone out — a sustained window of broke-and-behind.
    if (!ped._rentLowSince) { ped._rentLowSince = now(); return; }
    if (now() - ped._rentLowSince < 25000) return;        // ~25s pinned at the floor
    // --- evict: additive flip to the panhandler life, in place (no respawn) ---
    ped.vagrant = true;                                   // cops/quests read it (move-along)
    ped._role = "panhandler";                             // begs via the existing role/bark loop
    ped.archetype = "vagrant"; ped.job = "panhandling";
    ped.wealth = 0.02 + rng() * 0.04;
    ped._beg = { x: ped.pos.x, z: ped.pos.z };            // post up where they were put out
    // the shuffle — a permanent slow-down (NOT the joyT temp boost, so don't touch
    // _baseSpeed0); end any live boost first so it can't restore the old speed.
    if (ped._joyT > 0 && ped._baseSpeed0 != null) { ped.baseSpeed = ped._baseSpeed0; ped._baseSpeed0 = null; ped._joyT = 0; }
    if (ped.baseSpeed) ped.baseSpeed = Math.max(0.45, ped.baseSpeed * 0.6);
    ped.armed = false; ped.weapon = null;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    // shed the housed life so nothing routes them back to a unit they've lost
    ped._digs = null; ped._unit = null; ped._jobLot = null; ped._clockedIn = false;
    if (ped._deskAnchor && CBZ.cityReleaseDesk) CBZ.cityReleaseDesk(ped);
    if (ped._workAnchor && CBZ.cityReleaseWorkAnchor) CBZ.cityReleaseWorkAnchor(ped);
    ped._workAnchor = null; ped._goalKind = null; ped._goalCD = 1 + rng() * 2;
    if (N) { N.rent = 1; N.kRent = 0; }                   // a vagrant carries no rent
    // drift toward the nearest camp (their new address: bedroll, fire, cart) if
    // props.js seeded any — else they just hold the spot they were put out on.
    const camps = CBZ.cityCamps, A = CBZ.city && CBZ.city.arena;
    if (camps && camps.length && A) {
      let best = null, bd = 200 * 200;
      for (let c = 0; c < camps.length; c++) {
        const dx = camps[c].x - ped.pos.x, dz = camps[c].z - ped.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = camps[c]; }
      }
      if (best) { ped._beg = { x: best.x, z: best.z }; routeTo(ped, A, { x: best.x, z: best.z }); }
    }
    _evicted++;
    if (CBZ.cityFeed && CBZ.player && Math.hypot(ped.pos.x - CBZ.player.pos.x, ped.pos.z - CBZ.player.pos.z) < 60) {
      CBZ.cityFlavor && CBZ.cityFlavor("🏚️ Evicted — another soul put out on the street.", "#9a8d7a");
    }
  }

  // ============================================================
  //  EMERGENT CRIME DIRECTOR — the city robs itself.
  // ------------------------------------------------------------
  //  Round a corner and a robbery is already IN PROGRESS: a crew of armed,
  //  violent NPCs holding up a BANK (alarms, panic, cops rolling), or a
  //  thunderous roadside stick-up on an armored CASH TRUCK (the guard crew bails
  //  and a real firefight erupts). The player can JOIN it, STOP it, or swoop the
  //  spill in the aftermath. It reuses the EXISTING heat pipeline (each robber
  //  self-wanteds via cityNpcOffense so the NPC police hunt THEM — exactly like a
  //  rampager — plus cityTagWitnesses + cityPanic for the theatre), and NEVER
  //  touches the player's own heists.js flow (a distinct ped._npcJob tag + its
  //  own phase, never cityHeistState). Bounded to ONE big NPC robbery citywide so
  //  it stays an EVENT, theatre-gated near the player, fully feature-detected.
  // ------------------------------------------------------------
  // hard concurrency cap = ONE big NPC robbery citywide: a single _npcJobKind is
  // ever set at a time (the director tick early-returns while one runs), so bank
  // and cash-truck jobs are mutually exclusive AND capped at one by construction.
  const ROB_CREW = 3;            // up to this many robbers per job
  let _npcJobCrew = [];          // the live robbers (bank OR truck — shared cap)
  let _npcJobKind = null;        // "bank" | "truck" while one is running
  let _npcJobTarget = null;      // the bank lot {door} or the live truck car
  let _jobCD = 0;                // seconds until the next job is eligible
  let _jobCracked = false;       // a truck job already attempted its rare crack

  // a robber gives the job up (engaged, dead, recycled): drop the tag + let the
  // brain take over. Hoisted so the recycle block can call it.
  function releaseNpcJob(ped) {
    if (!ped) return;
    ped._npcJob = null; ped._npcJobPhase = null; ped._npcJobAt = null;
    const i = _npcJobCrew.indexOf(ped);
    if (i >= 0) _npcJobCrew.splice(i, 1);
  }
  function endNpcJob() {
    for (let i = _npcJobCrew.length - 1; i >= 0; i--) releaseNpcJob(_npcJobCrew[i]);
    // clear the one-shot "robbed" mark off the target so the SAME bank/truck can
    // be hit again on a later cooldown (it's per-job theatre, not a permanent state)
    if (_npcJobTarget) _npcJobTarget._npcRobbed = false;
    _npcJobCrew = []; _npcJobKind = null; _npcJobTarget = null; _jobCracked = false;
    _jobCD = 30 + rng() * 40;     // a long calm before the next big job
  }
  // is THIS ped fit to be pulled into a robbery crew? armed + genuinely violent +
  // NON-gang (gangs run their own ops) + ours to drive + not already special.
  function robberEligible(p) {
    if (!p || p.dead || p.gang || p.vendor || p.vagrant || p.companion || p.controlled || p.recruited || p._parked) return false;
    if (p.inCar || p.ko > 0 || p.kind === "cop" || p.guard || p.rampage) return false;
    if (p._regionLife || (p.family && p.family.length)) return false;
    if (p.rage || p.surrender || (p.npcWanted | 0) >= 1) return false;
    if (!p.armed) return false;                          // a robbery is an ARMED crew
    if ((p.aggr || 0) < (A0().crook || 0.72)) return false;   // violent band only
    return true;
  }
  // the stick-up beat fires the heat/witness/panic pipeline at a spot, credits
  // the crew, and registers the crime as a CITY EVENT. Crucially this DOES NOT
  // star the PLAYER — an NPC's robbery is the NPCs' problem: each robber self-
  // wanteds via cityNpcOffense (npcWanted), so the NPC police hunt THEM exactly
  // like a rampager. We tag witnesses + panic the bystanders directly, and fire
  // the silent/noWanted cityEvent (the same shape wanted.js' crime() uses for the
  // feed) so a robbery shows up in the world WITHOUT bleeding into player heat.
  function robberyBeat(x, z, sev, label) {
    if (CBZ.cityNpcOffense) {
      for (let i = 0; i < _npcJobCrew.length; i++) {
        const r = _npcJobCrew[i];
        if (r && !r.dead) { CBZ.cityNpcOffense(r, 70, "armed-robbery"); if ((r.npcWanted | 0) < 2) r.npcWanted = 2; }
      }
    }
    if (CBZ.cityTagWitnesses) CBZ.cityTagWitnesses(x, z, sev, "robbery");
    if (CBZ.cityPanic) CBZ.cityPanic(x, z, 2.0, _npcJobCrew[0] || null);
    // the city EVENT/feed at the robbery location WITHOUT touching player wanted
    // (silent + noWanted — never report() into g.heat for an NPC's crime).
    if (CBZ.cityEvent) {
      try { CBZ.cityEvent("crime", { crime: label || "Robbery", severity: sev, x: x, z: z, panic: Math.min(5, sev / 30) }, { silent: true, noWanted: true }); } catch (e) {}
    }
    if (CBZ.cityFeed && CBZ.player && Math.hypot(x - CBZ.player.pos.x, z - CBZ.player.pos.z) < 90) {
      CBZ.cityFeed("🚨 " + (label || "Robbery") + " in progress!", "#ff9a5a");
    }
  }

  // theatre gate: a job is only worth staging when the player is actually in the
  // city to STUMBLE INTO it (not a sim running off in an empty quarter). Returns
  // the live player actor or null; the start fns place the job at a believable
  // distance from it.
  function playerNear() {
    const P = CBZ.player; if (!P || P.dead || !P.pos) return null;
    return P;
  }

  // start a BANK job: pick a bank lot + a crew nearby, route them to the door.
  function startBankJob(peds, A) {
    if (!A.shopLots) return false;
    const P = playerNear();
    // candidate banks, preferring one a believable distance from the player
    let bank = null, bestD = -1;
    for (let i = 0; i < A.shopLots.length; i++) {
      const l = A.shopLots[i];
      if (l.kind !== "bank" || !l.building || !l.building.door) continue;
      const d = P ? Math.hypot(l.building.door.x - P.pos.x, l.building.door.z - P.pos.z) : 0;
      if (P && (d < 40 || d > 220)) continue;            // near enough to find, not in your lap
      if (d > bestD) { bestD = d; bank = l; }             // farthest in-window reads as "across town"
    }
    if (!bank) return false;
    const door = bank.building.door;
    // gather a crew of armed violent peds near the bank
    const crew = [];
    const n = peds.length, start = (rng() * n) | 0;
    for (let i = 0; i < n && crew.length < ROB_CREW; i++) {
      const p = peds[(start + i) % n];
      if (!robberEligible(p)) continue;
      if (Math.hypot(p.pos.x - door.x, p.pos.z - door.z) > 70) continue;   // within a block of the bank
      crew.push(p);
    }
    if (crew.length < 2) return false;                   // a robbery needs at least a pair
    _npcJobKind = "bank"; _npcJobTarget = bank; _npcJobCrew = crew; _jobCracked = false;
    for (let i = 0; i < crew.length; i++) {
      const p = crew[i];
      p._npcJob = "bank"; p._npcJobPhase = "toTarget";
      p._npcJobAt = { x: door.x + (rng() - 0.5) * 4, z: door.z + (rng() - 0.5) * 4 };
      routeTo(p, A, { x: p._npcJobAt.x, z: p._npcJobAt.z });
      p._goalKind = null; p._goalCD = Math.max(p._goalCD || 0, 3);
    }
    return true;
  }

  // start a CASH-TRUCK job: a live armored truck + a crew near its route. The
  // hull is explosive-only, so this is a STICK-UP firefight — the robbers open
  // fire on the truck, its guard crew bails and engages, and it becomes a loud
  // roadside battle (rare crack → cash spill the player can swoop). armored.js
  // is fully feature-detected; absent → this branch just never fires.
  function startTruckJob(peds, A) {
    const AR = CBZ.cityArmored;
    if (!AR || !AR.active || !AR.active()) return false;
    const truck = AR.truck && AR.truck();
    if (!truck || truck.dead || truck.armoredCracked || !truck.pos) return false;
    const tx = truck.pos.x, tz = truck.pos.z;
    const P = playerNear();
    if (P && Math.hypot(tx - P.pos.x, tz - P.pos.z) > 220) return false;   // stage it where you might see it
    const crew = [];
    const n = peds.length, start = (rng() * n) | 0;
    for (let i = 0; i < n && crew.length < ROB_CREW; i++) {
      const p = peds[(start + i) % n];
      if (!robberEligible(p)) continue;
      if (Math.hypot(p.pos.x - tx, p.pos.z - tz) > 60) continue;   // near the truck's road
      crew.push(p);
    }
    if (crew.length < 2) return false;
    _npcJobKind = "truck"; _npcJobTarget = truck; _npcJobCrew = crew; _jobCracked = false;
    for (let i = 0; i < crew.length; i++) {
      const p = crew[i];
      p._npcJob = "truck"; p._npcJobPhase = "toTarget";
      p._npcJobAt = { x: tx, z: tz };                    // intercept the truck's position
      routeTo(p, A, { x: tx + (rng() - 0.5) * 6, z: tz + (rng() - 0.5) * 6 });
      p._goalKind = null; p._goalCD = Math.max(p._goalCD || 0, 2);
    }
    return true;
  }

  // advance every live robber one beat (called from the director tick). Handles
  // engagement bail-out (a robber who's now fighting/fleeing/hunted drops the
  // job and lets think()/rage take over), the arrival stick-up, and the getaway.
  function tickNpcJob(dt, A) {
    // prune crew who bailed/died; if all gone, the job's over
    for (let i = _npcJobCrew.length - 1; i >= 0; i--) {
      const r = _npcJobCrew[i];
      if (!r || r.dead || r._parked || r.controlled || r.companion) { releaseNpcJob(r); continue; }
      // ENGAGED → drop the job, fight for your life (the brain owns it now)
      if (r.surrender || r.ko > 0 || (r.fear || 0) > 4 || r.state === "flee" || r.state === "surrender") {
        releaseNpcJob(r); continue;
      }
    }
    if (!_npcJobCrew.length) { if (_npcJobKind) endNpcJob(); return; }

    if (_npcJobKind === "bank") {
      // is the whole crew at the door yet? hold them in the stick-up, then on a
      // beat fire the pipeline + flee.
      const bank = _npcJobTarget;
      const door = bank && bank.building && bank.building.door;
      if (!door) { endNpcJob(); return; }
      // iterate BACKWARD — releaseNpcJob() splices the crew mid-loop (a fled
      // robber leaves the job), so a forward index would skip the next member.
      for (let i = _npcJobCrew.length - 1; i >= 0; i--) {
        const r = _npcJobCrew[i];
        const at = r._npcJobAt || { x: door.x, z: door.z };
        if (r._npcJobPhase === "toTarget") {
          if (Math.hypot(r.pos.x - at.x, r.pos.z - at.z) < 4) {
            r._npcJobPhase = "stickup";
            r._npcJobT = now() + 2200 + rng() * 1800;     // a stick-up beat at the door
            r.path = null; r.target.set(door.x, 0, door.z); face(r, door.x, door.z);
            r.pause = Math.max(r.pause, 1.4);
            if (rng() < 0.4) bark(r, "“EVERYBODY DOWN! Hands where I can see ‘em!”", "#ff8a5a", 2.4);
          } else { r._goalCD = Math.max(r._goalCD || 0, 1.5); }
        } else if (r._npcJobPhase === "stickup") {
          r.path = null; r.pause = Math.max(r.pause, 1.0);
          if (now() > (r._npcJobT || 0)) {
            // the score lands: fire the heat/witness/panic pipeline ONCE (first
            // crew member to finish triggers it), credit each robber, then flee.
            if (!bank._npcRobbed) {
              bank._npcRobbed = true;
              robberyBeat(door.x, door.z, 90, "Bank robbery");
            }
            // a real cut of cash for pulling it off (the spendable byproduct)
            if (r.cash != null) r.cash = (r.cash | 0) + (120 + ((rng() * 240) | 0));
            r._npcJobPhase = "flee";
            // a getaway heading: bolt away from the bank
            const ang = Math.atan2(r.pos.z - door.z, r.pos.x - door.x) + (rng() - 0.5);
            const fx = r.pos.x + Math.cos(ang) * 40, fz = r.pos.z + Math.sin(ang) * 40;
            routeTo(r, A, { x: fx, z: fz });
            r.state = "flee"; r.fear = Math.max(r.fear || 0, 3);
            if (rng() < 0.5) bark(r, "“GO GO GO!”", "#ff8a5a", 1.8);
            releaseNpcJob(r);                             // off the job — now just a fleeing wanted man
          }
        }
      }
      if (!_npcJobCrew.length) endNpcJob();
      return;
    }

    if (_npcJobKind === "truck") {
      const AR = CBZ.cityArmored;
      const truck = _npcJobTarget;
      if (!truck || truck.dead || !truck.pos || (AR && AR.active && !AR.active())) { endNpcJob(); return; }
      const tx = truck.pos.x, tz = truck.pos.z;
      let firedOnce = false;
      // backward — releaseNpcJob() splices mid-loop when a robber's beat ends
      for (let i = _npcJobCrew.length - 1; i >= 0; i--) {
        const r = _npcJobCrew[i];
        if (r._npcJobPhase === "toTarget") {
          // chase the (rolling) truck; once close, open fire on it
          r._npcJobAt = { x: tx, z: tz };
          if (Math.hypot(r.pos.x - tx, r.pos.z - tz) < 9) {
            r._npcJobPhase = "stickup";
            r._npcJobT = now() + 3000 + rng() * 3000;
            // RAGE at the truck: peds.js drives the shooting; the truck's wrap
            // sees damage → its guard crew bails and engages → a real firefight.
            r.rage = truck; r.state = "fight"; r.target.set(tx, 0, tz);
            if (rng() < 0.4) bark(r, "“Stop the truck! Out of the cab — NOW!”", "#ff8a5a", 2.4);
          } else {
            r.target.set(tx, 0, tz); r.path = null; r._goalCD = Math.max(r._goalCD || 0, 1.0);
          }
        } else if (r._npcJobPhase === "stickup") {
          // keep the gun on the truck; fire the pipeline once
          if (!truck._npcRobbed) { truck._npcRobbed = true; firedOnce = true; }
          if (truck.pos) { r.rage = truck; r.state = "fight"; r.target.set(truck.pos.x, 0, truck.pos.z); }
          if (r.cash != null && rng() < 0.02) r.cash = (r.cash | 0) + 20;   // grabbing loose notes
          if (now() > (r._npcJobT || 0)) {
            // beat's done — they either keep fighting the bailed guards (the brain
            // owns that via rage) or peel off; either way drop the director tag.
            releaseNpcJob(r);
          }
        }
      }
      if (firedOnce) robberyBeat(tx, tz, 80, "Cash-truck robbery");
      // RARE crack: if armored.js exposes it, a small chance the assault blows the
      // doors and SPILLS the cash (the fat score the player can swoop). One try.
      if (!_jobCracked && AR && AR.crack && !truck.armoredCracked && rng() < 0.012) {
        _jobCracked = true;
        try { AR.crack(); } catch (e) {}
        if (CBZ.cityFeed && CBZ.player && Math.hypot(tx - CBZ.player.pos.x, tz - CBZ.player.pos.z) < 120) {
          CBZ.cityFeed("💥 The truck's cracked — cash everywhere!", "#ffd451");
        }
      }
      if (!_npcJobCrew.length) endNpcJob();
      return;
    }

    // unknown kind — recover
    endNpcJob();
  }

  CBZ.onUpdate(36, function (dt) {
    if (g.mode !== "city") return;
    if (!CBZ.CONFIG.CITY_NPC_HEISTS) return;
    const A = CBZ.city && CBZ.city.arena;
    const peds = CBZ.cityPeds;
    if (!A || !A.shopLots || !peds || !peds.length) return;

    // a job in progress: advance it, and don't start another (cap = 1).
    if (_npcJobKind) { tickNpcJob(dt, A); return; }

    if (_jobCD > 0) { _jobCD -= dt; return; }
    _jobCD = 6 + rng() * 8;        // re-roll cadence between attempts

    // only stage a robbery when the player is actually in the city to stumble
    // into it (theatre) — otherwise hold (saves the event for when it'll be seen).
    if (!playerNear()) return;

    // MUTUALLY EXCLUSIVE: prefer a live cash-truck (rarer + louder) when one's
    // rolling, else a bank job. Either way the cap of ONE is enforced by _npcJobKind.
    if (rng() < 0.45 && startTruckJob(peds, A)) return;
    startBankJob(peds, A);
  });

  // fresh-run reset: clear the director + eviction state so a new city never
  // inherits an old robbery crew or eviction count. Wrap cityRampageReset (the
  // canonical new-run hook peds.js fires) without clobbering its existing body.
  (function () {
    const prevReset = CBZ.cityRampageReset;
    CBZ.cityRampageReset = function () {
      if (prevReset) try { prevReset(); } catch (e) {}
      // release any live robbery crew (drop tags) and reset the cadence
      for (let i = _npcJobCrew.length - 1; i >= 0; i--) {
        const r = _npcJobCrew[i];
        if (r) { r._npcJob = null; r._npcJobPhase = null; r._npcJobAt = null; }
      }
      _npcJobCrew = []; _npcJobKind = null; _npcJobTarget = null; _jobCracked = false;
      _jobCD = 25 + rng() * 30;
      _evicted = 0;
    };
  })();
})();
