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
      N = ped._needs = {
        money: 0.45 + rng() * 0.4,
        high: ped.drugUser ? (0.3 + rng() * 0.4) : 1,
        social: 0.5 + rng() * 0.4,
        ambition: ped.gang ? (0.4 + rng() * 0.3) : 0.6,
        // per-ped drain rates (units per second of sim time), personality-shaped
        kMoney: (0.006 + 0.010 * greed) * (0.7 + rng() * 0.6),
        kHigh: ped.drugUser ? (0.010 + 0.018 * (ped.erratic || 0.2)) : 0,
        kSocial: 0.004 + rng() * 0.004,
        kAmb: ped.gang ? (0.005 + 0.008 * ped.aggr) : 0,
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

  // ---- speech: prefer social.js' pooled bubbles when exported (CBZ.citySay);
  //      else a tiny bounded fallback so chats still read. The fallback never
  //      disposes makeLabelSprite's shared cached materials and never fades.
  const _bubbles = [];
  function bark(ped, text, color, secs) {
    if (CBZ.citySay) { CBZ.citySay(ped, text, color, secs); return; }
    if (!ped || ped.dead || !ped.group || !CBZ.makeLabelSprite) return;
    if (_bubbles.length >= 5) return;                       // hard budget
    const P = CBZ.player;
    if (P && Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) > 30) return;   // only near the camera
    const s = CBZ.makeLabelSprite(text, { color: color || "#dfe7ff" });
    if (!s) return;
    s.position.y = 3.7; s.scale.set(Math.min(7, 2.6 + text.length * 0.16), 0.8, 1);
    s.userData.transient = true;
    ped.group.add(s);
    _bubbles.push({ s, ped, t: secs || 2.2 });
  }
  function tickBubbles(dt) {
    for (let i = _bubbles.length - 1; i >= 0; i--) {
      const b = _bubbles[i]; b.t -= dt;
      if (b.t <= 0 || !b.ped || b.ped.dead || !b.s.parent) {
        if (b.s.parent) b.s.parent.remove(b.s);             // material is shared/cached — never disposed
        _bubbles.splice(i, 1);
      }
    }
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
  };
  CBZ.cityJobs = CITY_JOBS;       // shops.js gates worker verbs on .class; schedule.js reads .hours/.pay
  // the legacy job→lot vocabulary, derived from the one table (no second list to drift)
  const JOB_KINDS = {};
  for (const jn in CITY_JOBS) JOB_KINDS[jn] = CITY_JOBS[jn].lots;
  CBZ.cityJobKinds = JOB_KINDS;   // schedule.js derives timetables from the same vocabulary
  // the NEAREST plausible workplace, picked ONCE and cached. Re-validated
  // against the live arena so a recycled body / new run can't keep a stale lot.
  function jobLot(ped, A) {
    if (ped.gang || ped.vendor || ped.vagrant) return null;   // posted / on turf / no job
    const kinds = JOB_KINDS[ped.job];
    if (!kinds) return null;
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
  function tagOfficeJob(ped) {
    const off = isOfficeJob(ped);
    // keep the flag honest across recasts (an identity rewrite can change .job):
    // set it for desk workers, clear a stale one if they're no longer office.
    if (off) ped._officeJob = true;
    else if (ped._officeJob) ped._officeJob = false;
    return off;
  }
  // the NEAREST home lot, cached once — "leaving work" reads as heading home
  function digsLot(ped, A) {
    if (ped._digs && A.homeLots && A.homeLots.indexOf(ped._digs) >= 0) return ped._digs;
    ped._digs = null;
    const hl = A.homeLots; if (!hl || !hl.length) return null;
    let best = null, bd = Infinity;
    for (let i = 0; i < hl.length; i++) {
      const l = hl[i];
      const dd = (l.cx - ped.pos.x) * (l.cx - ped.pos.x) + (l.cz - ped.pos.z) * (l.cz - ped.pos.z);
      if (dd < bd) { bd = dd; best = l; }
    }
    ped._digs = best;
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
    tickBubbles(dt);
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

  // EARN: ordinary peds commute to a shop/workplace and clock in. A greedier
  // or harder ped instead HUSTLES the rich — shadows a wealthy mark to lift
  // their wallet (a real NPC mugging via the offense pipeline).
  function goEarn(ped, A, N) {
    // greedy/bold peds will rob the rich when one is nearby (utility: high
    // money-need + a fat opportunity walking past).
    if (ped.aggr >= (A0().crook || 0.72)) {
      const mark = nearestPed(ped, 26, (p) => !p.vendor && p.kind === "civilian" && (p.wealth || 0) > 0.55 && (p.cash | 0) > 40 && p.aggr < ped.aggr && !p.surrender && p.state !== "flee");
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
    const h = digsLot(ped, A);
    let goal;
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
    sSched *= (0.9 + rng() * 0.2);

    // rank the goals, try the best first; fall through if its opportunity isn't
    // actually there right now (e.g. no dealer to score from) to the next best.
    const order = [
      ["feud", sFeud], ["defend", sDefend], ["score", sScore], ["deal", sDeal],
      ["climb", sClimb], ["prove", sProve], ["home", sHome], ["chat", sChat],
      ["sched", sSched], ["earn", sEarn], ["errand", sErrand], ["moment", sMoment],
      ["chill", sChill],
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

  // ============================================================
  //  ARRIVAL EFFECTS — when a ped reaches/acts on its goal, the need is
  //  satisfied and (for trades) real value moves. Checked cheaply per slice;
  //  no walking is driven here, only the payoff of a goal the brain carried.
  // ============================================================
  function resolve(ped, N) {
    const kind = ped._goalKind;
    if (!kind) return;

    // WORK payday: arrived at the workplace door → earn a wage, fill money need
    if (kind === "work" && ped._payAt) {
      if (Math.hypot(ped.pos.x - ped._payAt.x, ped.pos.z - ped._payAt.z) < 4.5) {
        satisfy(N, "money", 0.4 + rng() * 0.3);
        satisfy(N, "social", 0.12);
        // arrived at YOUR OWN workplace → on the clock until dusk sends you home
        if (ped._payIsJob) { ped._clockedIn = true; ped.pause = Math.max(ped.pause, 1.5 + rng() * 2); }
        ped._payIsJob = false;
        ped._payAt = null; ped._goalKind = null;
      }
      return;
    }

    // HOME (dusk clock-out): through the door — off the street, day done
    if (kind === "home") {
      if (!ped._homeAt) { ped._goalKind = null; return; }
      if (Math.hypot(ped.pos.x - ped._homeAt.x, ped.pos.z - ped._homeAt.z) < 5) {
        satisfy(N, "social", 0.1);
        ped._homeAt = null; ped._goalKind = null;
      }
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
        ped._jobLot = null; ped._digs = null; ped._clockedIn = false; ped._payIsJob = false;
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

      // never touch anyone the brain is busy driving, or who isn't ours to drive
      if (ped.dead || ped.vendor || ped.companion || ped.controlled ||
          ped.inCar || ped.ko > 0) { ped._goalCD = 4; continue; }
      if (busy(ped)) { ped._goalCD = 2 + rng() * 3; continue; }

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
    // pairs/moments hold refs/budgets from the OLD city, bubbles hold sprites.
    _queues = []; _pairs = []; _moments = [];
    for (let i = _bubbles.length - 1; i >= 0; i--) { const b = _bubbles[i]; if (b.s && b.s.parent) b.s.parent.remove(b.s); }
    _bubbles.length = 0;
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
    if (CBZ.cityFeed) CBZ.cityFeed("📱 " + who + ": somebody's spraying up " + where + " — stay clear.", "#9fb0c6");
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
})();
