/* ============================================================
   battle/core/lod.js — WHO GETS WHAT: the tier rules and the budgets.
   Page-independent. The seam a scale agent fills in (ARCHITECTURE.md,
   "Scale"); every number a tier decision uses lives HERE and nowhere else.

   TODAY (wave A) only the render LOD is live: animEvery() is the exact
   1 / 2 / 4 frame skip by distance that frame() always used (70 m, 150 m),
   moved here so the scale work changes one table. Every unit is still a
   FULL unit with a full brain. tierOf() and the budgets below are the
   contract the MID/FAR sims will be held to.

   PROMOTION RULES (a unit becomes FULL when any is true; it drops a tier
   only after the condition has been false for DEMOTE_S seconds, and with
   HYSTERESIS on distances so nothing flickers at a boundary):
     within FULL_R of the lens, or of the player's unit
     the lens subject, the player's unit, the player's target
     in melee with, or the target of, a FULL unit
     hit by a round or blast in the last HIT_S seconds near the lens
     a vehicle's crew while the vehicle is FULL
   MID: within MID_R of the lens. FAR: everyone else.

   EQUIVALENCE (the FAR sim's contract, held by a node check the scale agent
   writes): the same matchup run all-FULL and all-FAR gives the same winner
   in >= 90% of seeds, loser casualties within 15 points, time to decision
   within 25%, and the same morale break order.

   PUBLIC  CBZ.battleLod = { RULES, BUDGET, animEvery(d2), tierOf(d2, why) }
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const RULES = {
    ANIM_NEAR: 70, ANIM_MID: 150,     // render LOD: full rate / every 2nd / every 4th frame
    FULL_R: 90, MID_R: 400, HYSTERESIS: 1.15, DEMOTE_S: 3, HIT_S: 4,
    FULL_CAP: { desktop: 900, tablet: 400, phone: 220 },   // full rigs alive at once
  };
  /* AI tick budget per tier: how often a unit thinks (s) and the frame
     milliseconds the tier may spend; the scheduler time-slices inside it.
     WORKER: the FAR tier's squad sim is pure numbers over the store's typed
     arrays, so it is the half that moves to a Web Worker (transfer the
     columns, step, transfer back) when the main thread is the bottleneck. */
  const BUDGET = {
    think: { full: 0.25, mid: 0.8, far: 2.0 },
    frameMs: { full: 6, mid: 2.5, far: 1.5 },
    worker: { far: true, mid: false, full: false },
  };
  const ANEAR2 = RULES.ANIM_NEAR * RULES.ANIM_NEAR, AMID2 = RULES.ANIM_MID * RULES.ANIM_MID;
  function animEvery(d2) { return d2 < ANEAR2 ? 1 : d2 < AMID2 ? 2 : 4; }
  // why: { subject, player, engagedFull, hitRecent, crewOfFull } (any truthy -> FULL)
  function tierOf(d2, why) {
    if (why && (why.subject || why.player || why.engagedFull || why.hitRecent || why.crewOfFull)) return 0;
    if (d2 < RULES.FULL_R * RULES.FULL_R) return 0;
    if (d2 < RULES.MID_R * RULES.MID_R) return 1;
    return 2;
  }
  CBZ.battleLod = { RULES: RULES, BUDGET: BUDGET, animEvery: animEvery, tierOf: tierOf };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleLod;
})();
