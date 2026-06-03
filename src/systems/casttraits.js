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

  CBZ.castTraits = { behaviorForAggression, reactivityFor, rollCity };
})();
