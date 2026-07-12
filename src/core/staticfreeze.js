/* ============================================================
   core/staticfreeze.js — stop recomputing matrices for the static city.

   WHY: in r128, scene.updateMatrixWorld() runs every render and, for EVERY
   object with matrixAutoUpdate=true (the default), recomposes its local
   matrix from position/quaternion/scale and re-multiplies its world matrix
   — every frame, whether or not anything moved. The city subtree holds
   ~100k Object3Ds (measured), nearly all of them permanently static walls/
   deco/hidden batch originals: profiled at tens of ms per frame of pure
   matrix math on the worst machines, paid at EVERY quality tier.

   WHAT: one pass at city-build time (called from city/mode.js right after
   CBZ.batchStaticUnder) flips matrixAutoUpdate=false on everything under
   the city root that is provably static, after one final updateMatrix().
   r128 semantics keep every "later" case correct with no bookkeeping:
     • anything ADDED after the freeze (peds, cars, debris, elevator
       leaves, campaign markers, scaffolds, remnant walls) has its own
       matrixAutoUpdate=true default and animates normally — a frozen
       parent's matrixWorld is valid and static, which is all a child
       multiply needs.
     • a frozen child under a MOVING ancestor still follows it: the
       ancestor's update sets force=true down its subtree, and force
       bypasses the flag (updateMatrix is what's skipped — the local
       matrix genuinely didn't change).

   WHAT STAYS LIVE (skipped: the object itself keeps matrixAutoUpdate):
     • subtrees tagged userData.dynamic (actors/cinematic sets — same tag
       core/batch.js skips)
     • objects tagged userData.mover (door hinge pivots — tagged at their
       creation site in buildings.js)
     • groups referenced by a collider (knockable street props tip over by
       writing the GROUP transform; hydrants/mailboxes ride along — cheap)
     • lights (the pooled streetlights get re-positioned), sprites
       (campfire flame/smoke scale-animate), cameras
   The scene object itself is frozen too (it never moves): without that,
   the scene's own per-frame updateMatrix() sets matrixWorldNeedsUpdate and
   force-multiplies the ENTIRE graph every frame regardless of child flags.

   Flag: CBZ.CONFIG.MATRIX_FREEZE (default ON). Flip false before a city
   build for a one-line revert (already-frozen worlds stay frozen until
   the next reset — freezing is a build-time act, not a per-frame one).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.CONFIG && CBZ.CONFIG.MATRIX_FREEZE == null) CBZ.CONFIG.MATRIX_FREEZE = true;

  CBZ.freezeStaticUnder = function (root) {
    if (!root || !(CBZ.CONFIG && CBZ.CONFIG.MATRIX_FREEZE)) return null;
    // groups a collider points at = things gameplay may shove around later
    const liveGroups = new Set();
    for (const c of (CBZ.colliders || [])) {
      if (c && c.ref && c.ref.isGroup) liveGroups.add(c.ref);
    }
    let frozen = 0, skipped = 0;
    (function walk(o) {
      const ud = o.userData;
      if (ud && ud.dynamic) { skipped++; return; }          // actor/cinematic subtree — leave whole branch live
      const self =
        (ud && ud.mover) ||                                  // tagged mover (door pivots)
        liveGroups.has(o) ||                                 // knockable prop groups
        o.isLight || o.isSprite || o.isCamera;               // few, some animate — not worth reasoning about
      if (!self) {
        o.updateMatrix();                                    // bake the final local matrix once
        o.matrixAutoUpdate = false;
        frozen++;
      } else skipped++;
      const kids = o.children;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    })(root);
    // the scene itself: identity forever. Freezing it stops the per-frame
    // scene.updateMatrix() that would otherwise force-cascade the whole graph.
    if (CBZ.scene && CBZ.scene.matrixAutoUpdate) {
      CBZ.scene.updateMatrix();
      CBZ.scene.matrixAutoUpdate = false;
    }
    CBZ.freezeStats = { frozen, skipped };
    return CBZ.freezeStats;
  };
})();
