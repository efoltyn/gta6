/* ============================================================
   city/aigoals.js — purpose for the crowd (ADDITIVE goal layer)

   The ped brain (city/peds.js) already WANDERS and REACTS, but on its
   own a calm ped just hops between random waypoints. This layer hands
   the crowd a reason to be where they're going — without touching the
   brain. It only SETS the same goal fields move()/think() already
   honour (finalGoal / target / path / state / rage), then steps back
   and lets peds.js carry them there.

   Runs at onUpdate order 33 — one tick BEFORE peds @34 — so a freshly
   assigned goal is acted on the very same frame. City-mode only, and
   time-sliced: each frame it only looks at a thin slice (~1/30) of the
   crowd, so even a packed city stays cheap.

   Four pursuits, chosen by archetype / aggr / wealth:
     EARN     ordinary folk commute to a shop/workplace and "work"
     DRUGS    dealers & users gravitate to each other / the Trap House
     HUNT     the truly violent occasionally pick a weak or rival mark
     JOYRIDE  a few bold souls sprint across town (brief speed nudge)

   It NEVER overrides a ped that's already fighting, fleeing or
   surrendering, and skips companions / hostages / drivers / vendors /
   the dead. Spice, not chaos: HUNT in particular is kept rare.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;
  const A0 = () => (CBZ.CITY && CBZ.CITY.aggro) || {};

  // a tiny independent PRNG so we never disturb peds.js' deterministic stream
  let _s = 13371;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  // rolling cursor through CBZ.cityPeds so each frame handles a fresh slice
  let cursor = 0;

  // ---- goal helpers: only SET fields, let the ped brain do the walking ----

  // pick a shop/workplace lot to head to (door-based, like pickRoutineGoal)
  function shopByKind(A, kind) {
    if (!A.shopLots || !A.shopLots.length) return null;
    if (kind) { const m = A.shopLots.filter((l) => l.kind === kind); if (m.length) return m[(rng() * m.length) | 0]; return null; }
    return A.shopLots[(rng() * A.shopLots.length) | 0];
  }

  // route a ped to a {x,z} goal, crossing at the nearest intersection if far
  // (mirrors peds.js pickRoutineGoal so movement looks identical to the brain's)
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
    ped.pause = 0;
  }

  // nearest living non-companion ped matching a test (cheap, bounded scan)
  function nearestPed(self, maxd, test) {
    let best = null, bd = maxd * maxd;
    const peds = CBZ.cityPeds;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p === self || p.dead || p.companion || p.controlled || p._parked) continue;
      if (!test(p)) continue;
      const dx = p.pos.x - self.pos.x, dz = p.pos.z - self.pos.z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = p; }
    }
    return best;
  }

  // ---- the four pursuits ----

  // EARN: ordinary peds commute to a shop and clock in (idle a beat at the door)
  function goEarn(ped, A) {
    const lot = shopByKind(A, null);
    if (!lot || !lot.building || !lot.building.door) return false;
    const d = lot.building.door;
    routeTo(ped, A, { x: d.x, z: d.z, enter: true });
    // a longer "shift" idle once they arrive — believable, no mechanics
    ped.pause = 0;
    return true;
  }

  // DRUGS: dealers post up / users seek a dealer, both fall back to the Trap House
  function goDrugs(ped, A, isDealer) {
    if (isDealer) {
      // a dealer looks for a user to meet; otherwise sets up shop at the trap
      const user = nearestPed(ped, 40, (p) => p.drugUser && !p.vendor && p.kind === "civilian");
      if (user) { routeTo(ped, A, { x: user.pos.x, z: user.pos.z }); return true; }
    } else {
      // a user looks for a dealer to score from
      const dealer = nearestPed(ped, 50, (p) => (p.archetype === "dealer") && !p.vendor);
      if (dealer) { routeTo(ped, A, { x: dealer.pos.x, z: dealer.pos.z }); return true; }
    }
    const trap = shopByKind(A, "drugs");
    if (trap && trap.building && trap.building.door) {
      routeTo(ped, A, { x: trap.building.door.x, z: trap.building.door.z, enter: true });
      return true;
    }
    return false;
  }

  // HUNT: a violent ped marks a weak civilian or a rival gangster for the brain
  // to attack. KEPT RARE so it reads as menace, not a citywide bloodbath.
  function goHunt(ped) {
    const B = A0();
    // prefer a rival-gang member if this ped is a gangster; else a weak civilian
    let mark = null;
    if (ped.gang) {
      mark = nearestPed(ped, 22, (p) => p.gang && p.gang !== ped.gang && p.kind !== "cop");
    }
    if (!mark) {
      mark = nearestPed(ped, 16, (p) =>
        !p.vendor && p.kind === "civilian" && p.aggr < (ped.aggr - 0.2) &&
        !p.surrender && p.state !== "flee");
    }
    if (!mark) return false;
    ped.rage = mark;          // the brain takes it from here (state -> fight)
    ped.state = "fight";
    ped.target.set(mark.pos.x, 0, mark.pos.z);
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 16, "assault");
    return true;
  }

  // JOYRIDE: a bold ped strides fast to a far corner of town. We can't grant a
  // car here (that's vehicles.js), so we just give a brief baseSpeed nudge and a
  // distant destination — purposeful, hurried foot traffic that fills the grid.
  function goJoyride(ped, A) {
    const p = A.randomSidewalkPoint();
    // bias toward somewhere genuinely far so they actually traverse the map
    if (Math.hypot(p.x - ped.pos.x, p.z - ped.pos.z) < A.step * 2) {
      const it = A.nearestIntersection(A.maxX, A.maxZ);
      p.x = it.x; p.z = it.z;
    }
    routeTo(ped, A, { x: p.x, z: p.z });
    // brief speed boost, restored by tick() when the timer lapses
    if (!ped._joyT) { ped._baseSpeed0 = ped.baseSpeed; ped.baseSpeed = ped.baseSpeed * 1.7; }
    ped._joyT = 7 + rng() * 6;
    return true;
  }

  // ---- assign ONE goal to a ped (returns true if it set one) ----
  function assign(ped, A) {
    const B = A0();
    const isDealer = ped.archetype === "dealer";
    const r = rng();

    // violent peds: rare hunt (spice). gated hard so it stays uncommon.
    if (ped.aggr >= (B.violent || 0.88) && r < 0.06) {
      if (goHunt(ped)) { ped._goalCD = 8 + rng() * 8; return; }
    }

    // dealers / drug users gravitate to the trade
    if ((isDealer || ped.drugUser) && r < 0.5) {
      if (goDrugs(ped, A, isDealer)) { ped._goalCD = 10 + rng() * 12; return; }
    }

    // a few bold (but not openly violent) peds head off on a brisk cross-town trek
    if (ped.aggr >= (B.bold || 0.5) && ped.aggr < (B.violent || 0.88) && r < 0.14) {
      if (goJoyride(ped, A)) { ped._goalCD = 12 + rng() * 10; return; }
    }

    // everyone else: go EARN — commute to a shop and put in a shift
    if (r < 0.55) {
      if (goEarn(ped, A)) { ped._goalCD = 14 + rng() * 14; return; }
    }

    // nothing assigned this pass: short retry so we don't spin every frame
    ped._goalCD = 3 + rng() * 4;
  }

  // a ped the brain is mid-action on — never stomp it
  function busy(ped) {
    if (ped.rage) return true;                       // already engaged
    const s = ped.state;
    if (s === "fight" || s === "flee" || s === "confront" ||
        s === "surrender" || s === "loot" || s === "chat") return true;
    if (ped.surrender || ped.alarmed > 0 || ped.fear > 2) return true;
    if (ped.guard) return true;                       // posted guards own their post
    if ((ped.npcWanted | 0) >= 1) return true;        // being hunted by cops
    return false;
  }

  // ---- per-frame: process a thin slice of the crowd ----
  CBZ.onUpdate(33, function (dt) {
    if (g.mode !== "city") return;
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.shopLots) return;
    const peds = CBZ.cityPeds;
    const n = peds.length;
    if (!n) return;

    // ~1/30 of the crowd per frame (min 1), rolling through the array
    const slice = Math.max(1, Math.ceil(n / 30));
    if (cursor >= n) cursor = 0;

    for (let k = 0; k < slice; k++) {
      if (cursor >= n) cursor = 0;
      const ped = peds[cursor++];
      if (!ped) continue;

      // tick down the joyride speed boost regardless (so it's always restored)
      if (ped._joyT > 0) {
        ped._joyT -= dt;
        if (ped._joyT <= 0 && ped._baseSpeed0 != null) { ped.baseSpeed = ped._baseSpeed0; ped._baseSpeed0 = null; ped._joyT = 0; }
      }

      // cooldown between goal assignments
      if (ped._goalCD == null) ped._goalCD = rng() * 6;   // stagger first pass
      if (ped._goalCD > 0) { ped._goalCD -= dt; continue; }

      // never touch anyone the brain is busy driving, or who isn't ours to drive
      if (ped.dead || ped.vendor || ped.companion || ped.controlled ||
          ped.inCar || ped.ko > 0 || ped._parked) { ped._goalCD = 4; continue; }
      if (busy(ped)) { ped._goalCD = 2 + rng() * 3; continue; }

      assign(ped, A);
    }
  });
})();
