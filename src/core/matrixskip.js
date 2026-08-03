/* ============================================================
   core/matrixskip.js — SKIP WORLD-MATRIX MATH FOR HIDDEN SUBTREES.

   r128's Object3D.updateMatrixWorld walks EVERY node of the graph every
   frame — this scene is ~150k objects of which roughly half are invisible
   at any moment (batch-hidden wall originals, parked FX pools, culled
   far-chunk contents, interior decor behind visibility toggles). r128
   renders none of them (projectObject prunes invisible subtrees) but still
   pays full matrix recomposition for all of them. Measured 2026-08-03
   (M1 Pro, seed 90210): updateMatrixWorld ≈ 1.1s of every 8s of play
   inside a 76ms-average render slice. The classic community patch (skip
   the subtree when !visible) was measured at ~50% matrix-cost reduction
   on desktop and 30→55fps on mobile in the three.js forum thread
   "UpdateMatrixWorld Performance"; upstream declined it because it
   changes semantics for code that reads matrixWorld of hidden objects.

   Why it is safe HERE:
   - Hidden-but-load-bearing meshes in this game (batch-hidden LOS walls,
     collider refs) are STATIC: their matrixWorld was computed while
     visible at build time and never changes, so skipping recomputation
     returns the same numbers.
   - getWorldPosition()/updateWorldMatrix() are NOT patched — direct
     callers always get fresh values regardless of visibility.
   - The one real hazard — parent moves while a child is hidden, child is
     shown later without the parent moving again — is handled explicitly:
     a skipped forced update marks the node, and the mark upgrades the
     next visible update to a forced one. No stale-forever case remains.
   - Anything that must keep updating while hidden can opt out with
     `obj._cbzMatrixAlways = true`.

   Flag: CBZ.CONFIG.MATRIX_SKIP_HIDDEN (default on;
   ?cfg_MATRIX_SKIP_HIDDEN=0 restores stock r128 behaviour at boot).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.CONFIG.MATRIX_SKIP_HIDDEN == null) CBZ.CONFIG.MATRIX_SKIP_HIDDEN = true;
  if (!CBZ.CONFIG.MATRIX_SKIP_HIDDEN) return;

  const proto = THREE.Object3D.prototype;
  const orig = proto.updateMatrixWorld;
  proto.updateMatrixWorld = function (force) {
    if (this.visible === false && this._cbzMatrixAlways !== true) {
      // Parent's world matrix changed while we're hidden: remember, so the
      // first visible update recomposes even though our local flags are clean.
      if (force) this._cbzStaleWorld = true;
      return;
    }
    if (this._cbzStaleWorld === true) { this._cbzStaleWorld = false; force = true; }
    orig.call(this, force);
  };
})();
