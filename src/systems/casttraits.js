/* ============================================================
   systems/casttraits.js - shared lightweight human traits.

   The prison and city can share a reaction vocabulary without sharing a
   heavyweight brain. Personality controls likelihood and scale of reaction;
   inventory remains a separate possession roll owned by each game mode.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const JOBS = [
    "delivery driver", "retail worker", "mechanic", "office worker",
    "construction worker", "bartender", "nurse", "warehouse worker",
    "student", "between jobs",
  ];

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function behaviorForAggression(a) {
    if (a >= 0.9) return "predator";
    if (a >= 0.76) return "hothead";
    if (a >= 0.58) return "opportunist";
    if (a >= 0.42) return "defensive";
    return "pacifist";
  }

  function reactivityFor(behavior, aggr) {
    const b = CBZ.BEHAVIORS && CBZ.BEHAVIORS[behavior];
    if (!b) return clamp(aggr, 0, 1);
    return clamp((b.retaliate || 0) * 0.55 + (b.guts || 0) * 0.3 + (b.init || 0) * 0.15, 0, 1);
  }

  function rollCity(r, opts) {
    opts = opts || {};
    const aggr = opts.aggr == null ? 0.24 : opts.aggr;
    let archetype = opts.archetype;
    if (!archetype) {
      const x = r();
      archetype = x < 0.065 ? "tweaker"
        : x < 0.13 ? "hustler"
        : x < 0.17 ? "dealer"
        : x < 0.205 ? "volatile"
        : "resident";
    }

    let job = opts.job;
    if (!job) {
      if (archetype === "dealer") job = "street dealer";
      else if (archetype === "hustler") job = "hustler";
      else if (archetype === "tweaker") job = "between jobs";
      else if (archetype === "gangster") job = "gang enforcer";
      else if (archetype === "security") job = "private security";
      else job = JOBS[(r() * JOBS.length) | 0];
    }

    const adjusted = clamp(aggr + (archetype === "volatile" ? 0.14 : archetype === "tweaker" ? 0.08 : 0), 0, 1);
    const behavior = opts.behavior || behaviorForAggression(adjusted);
    const drugUser = opts.drugUser != null ? opts.drugUser
      : archetype === "tweaker" || archetype === "dealer" || r() < 0.055;
    return {
      archetype, job, behavior, drugUser,
      reactivity: opts.reactivity != null ? opts.reactivity : reactivityFor(behavior, adjusted),
      erratic: archetype === "tweaker" ? 0.78 : archetype === "volatile" ? 0.34 : 0,
    };
  }

  // THE BRAIN'S FIVE AXES, read off the vocabulary every game already rolls.
  // CBZ.brain.register wants { courage, aggression, discipline, curiosity,
  // loyalty } in 0..1; a body anywhere (city ped, inmate, crew) carries some of
  // aggr / behavior / archetype / kind / snitch / gstat, and this is the ONE
  // translation. Stable: a pure function of the body's traits plus a hash of
  // its name, so a person is the same person every time it is asked.
  function nameHash(a, salt) {
    const s = (a && a.name) || "";
    let h = 2166136261 ^ salt;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10007) / 10007;
  }
  function personality(a) {
    a = a || {};
    const aggr = clamp(a.aggr == null ? 0.35 : +a.aggr || 0, 0, 1);
    const B = CBZ.BEHAVIORS && CBZ.BEHAVIORS[a.behavior];
    const guts = B ? B.guts : aggr;
    const arch = a.archetype || "";
    const kind = a.kind || "";
    const trained = kind === "security" || kind === "military" || kind === "guard" || kind === "cop" || !!a.milRank;
    let courage = 0.12 + guts * 0.55 + aggr * 0.25 + (a.armed ? 0.08 : 0) + (trained ? 0.12 : 0);
    if (a.child) courage -= 0.35;
    if (B) courage -= (B.fleeHurt || 0) * 0.08;
    const aggression = B ? (B.init || 0) * 0.9 + (B.retaliate || 0) * 0.3 + aggr * 0.35 : aggr;
    let discipline = trained ? 0.78 : 0.45 + (nameHash(a, 0xD15C) - 0.5) * 0.3;
    discipline -= (a.erratic || 0) * 0.45;
    if (arch === "volatile") discipline -= 0.15;
    // curiosity is the gawker axis: who stops and films instead of running
    let curiosity = 0.28 + nameHash(a, 0xC0710) * 0.35 + (arch === "hustler" ? 0.15 : 0) + (a.wealth != null ? (0.5 - a.wealth) * 0.1 : 0);
    if (a.child) curiosity += 0.15;
    const loy = a.gstat && a.gstat.loyalty != null ? a.gstat.loyalty : (a.loyalty != null ? a.loyalty : (a.gang ? 0.55 : 0.4));
    return {
      courage: clamp(courage, 0, 1), aggression: clamp(aggression, 0, 1),
      discipline: clamp(discipline, 0, 1), curiosity: clamp(curiosity, 0, 1), loyalty: clamp(loy, 0, 1),
    };
  }

  CBZ.castTraits = { behaviorForAggression, reactivityFor, rollCity, personality };
})();
