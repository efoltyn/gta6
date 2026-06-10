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
    const lot = shopByKind(A, null);
    if (!lot || !lot.building || !lot.building.door) return false;
    const d = lot.building.door;
    routeTo(ped, A, { x: d.x, z: d.z, enter: true });
    ped._goalKind = "work";
    // mark a payday at the door so EARN actually feeds the money need (below)
    ped._payAt = { x: d.x, z: d.z };
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

  // ============================================================
  //  UTILITY PICK — score every goal by need × opportunity × fit, take the
  //  best (small jitter breaks ties so the crowd doesn't move in lockstep).
  // ============================================================
  function assign(ped, A) {
    const B = A0();
    const N = decayNeeds(ped);
    const r = rng();

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

    // small per-goal jitter so equal scores diverge across the crowd
    sFeud *= 1; sScore *= (0.85 + r * 0.3); sDeal *= (0.85 + rng() * 0.3);
    sClimb *= (0.85 + rng() * 0.3); sEarn *= (0.85 + rng() * 0.3); sChill *= (0.85 + rng() * 0.3);
    sDefend *= (0.9 + rng() * 0.2); sProve *= (0.85 + rng() * 0.3);

    // rank the goals, try the best first; fall through if its opportunity isn't
    // actually there right now (e.g. no dealer to score from) to the next best.
    const order = [
      ["feud", sFeud], ["defend", sDefend], ["score", sScore], ["deal", sDeal],
      ["climb", sClimb], ["prove", sProve], ["earn", sEarn], ["chill", sChill],
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
      else if (kind === "earn") ok = goEarn(ped, A, N);
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
        ped._payAt = null; ped._goalKind = null;
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
      // (cheap: just a distance check + need top-up when they've arrived)
      if (ped._goalKind) resolve(ped, decayNeeds(ped));

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
    _rampCD = 12 + rng() * 18;   // a short grace before the first shooter pops
    for (const p of (CBZ.cityPeds || [])) {
      p.rampage = false; p._rampArmed = 0; p._rampHeatT = 0; p._rampT = 0; p._rampPanicT = 0;
    }
  };
  // expose a manual trigger (debug / scripted events can force a spree on a ped)
  CBZ.cityStartRampage = function (ped) {
    if (!ped || ped.dead || ped.rampage) return false;
    ped.rampage = true;
    if (_rampagers.indexOf(ped) < 0) _rampagers.push(ped);
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 90, "active-shooter");
    if ((ped.npcWanted | 0) < 3) ped.npcWanted = 3;
    if (CBZ.city && CBZ.city.note) CBZ.city.note("⚠️ Active shooter reported nearby!", 3);
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
