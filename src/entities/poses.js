/* ============================================================
   entities/poses.js — SHARED STATIC-POSE REGISTRY for character rigs.

   character.js's animChar owns the LIVE animation (gait, aim, surrender/
   hands-up, punch, KO). This file adds the small library of HELD,
   non-locomotor poses a planted actor strikes at a post — a dealer's
   hands over the felt, a guard's folded arms, a croupier's hands resting
   on the table. ONE registry so BOTH the city ped brain (peds.js sets
   ped.char.pose) AND game packages (core/packages.js ctx.npc) drive the
   same poses — no per-game arm-animation code, no duplicate rigs.

   HOW IT LAYERS (the coexistence contract, verified against animChar):
     - animChar's ARM chain calls CBZ.charPoses[ch.pose](ch, dt) as a
       branch that sits AFTER aiming/cuffed/surrender/carry and BEFORE the
       default idle counter-swing. So every "owns the rig" state OUTRANKS
       a pose (HANDS-UP wins), and a WALK falls straight through to the
       gait (walk/panic override the pose) — exactly the spec precedence.
       Because the pose OWNS the arms in that frame (not a post-pass), it
       reaches its target cleanly instead of equilibrating half-way with
       the idle damp (the character.js "half-raised 40°" tug-of-war note).
     - Poses write ROTATION ONLY (upper-arm rotation.x/z + the elbow
       joint), never position.z — animChar's post-arm reset owns position.z
       and rotation.y, so a rotation-only pose composes with it conflict-free.
     - Poses damp toward their target each frame (frame-rate-independent,
       same math as animChar) so entering/leaving eases in/out and the idle
       damps reclaim the arms the instant ch.pose clears.
   "sit" is NOT here: animChar already owns a full seated pose via
   ch.sitting (office-jobs), so setCharPose maps "sit" -> ch.sitting and
   the registry never sees it.
   Determinism: pure pose math, no rng, zero allocation on the hot path.
   Revert: CBZ.CONFIG.CHAR_POSES = false (setCharPose/charPoses no-op; the
   animChar branch also self-guards on CBZ.charPoses[ch.pose] existing).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CHAR_POSES == null) CBZ.CONFIG.CHAR_POSES = true;

  // frame-rate-independent approach (identical to character.js's damp)
  function damp(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }
  // elbow joints only bend one way (<=0), like animChar's setElbow
  function elbow(J, x, dt, rate) { if (J) J.rotation.x = damp(J.rotation.x, Math.min(0, x), rate || 14, dt); }

  // Each pose writes arm targets on a rig `ch`, using the SAME surface
  // animChar uses: ch.parts.{la,ra} (upper-arm pivots) + ch.low.{la,ra}
  // (elbow joints). Rates sit at/above animChar's arm rate (~14) so the pose
  // dominates the frame it owns.
  const POSES = {
    // hands held forward over the felt, forearms level — dealing / croupier.
    deal(ch, dt) {
      const J = ch.low || {}, r = 15;
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      if (la) { la.rotation.x = damp(la.rotation.x, -0.95, r, dt); la.rotation.z = damp(la.rotation.z, 0.14, r, dt); }
      if (ra) { ra.rotation.x = damp(ra.rotation.x, -0.95, r, dt); ra.rotation.z = damp(ra.rotation.z, -0.14, r, dt); }
      elbow(J.la, -0.95, dt, r); elbow(J.ra, -0.95, dt, r);
    },
    // both forearms extended forward, resting on the table edge — cashier/pitboss.
    table(ch, dt) {
      const J = ch.low || {}, r = 14;
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      if (la) { la.rotation.x = damp(la.rotation.x, -1.12, r, dt); la.rotation.z = damp(la.rotation.z, 0.10, r, dt); }
      if (ra) { ra.rotation.x = damp(ra.rotation.x, -1.12, r, dt); ra.rotation.z = damp(ra.rotation.z, -0.10, r, dt); }
      elbow(J.la, -0.55, dt, r); elbow(J.ra, -0.55, dt, r);
    },
    // arms crossed high over the chest — guard / bouncer / pitboss at ease.
    foldarms(ch, dt) {
      const J = ch.low || {}, r = 14;
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      if (la) { la.rotation.x = damp(la.rotation.x, -1.15, r, dt); la.rotation.z = damp(la.rotation.z, -0.52, r, dt); }
      if (ra) { ra.rotation.x = damp(ra.rotation.x, -1.22, r, dt); ra.rotation.z = damp(ra.rotation.z, 0.56, r, dt); }
      elbow(J.la, -1.40, dt, r); elbow(J.ra, -1.50, dt, r);
    },
    // explicit neutral (defensive no-op; setCharPose maps "stand" -> null so the
    // idle gait owns the arms instead of freezing them here).
    stand(ch, dt) {},
  };
  // contract-vocabulary aliases so packages/ped brains can name poses naturally
  POSES.handsOnTable = POSES.table;
  POSES.croupier = POSES.deal;
  POSES.dealer = POSES.deal;

  CBZ.charPoses = POSES;

  // THE ONE ENTRY POINT both peds.js and packages.js use to set a rig's held
  // pose. Translates the verb vocabulary onto the rig flags animChar reads:
  //   "sit"           -> ch.sitting (animChar's native seated pose)
  //   "stand"/null    -> clears the pose (idle gait owns the arms)
  //   anything else   -> ch.pose = verb (looked up in CBZ.charPoses by animChar)
  CBZ.setCharPose = function (ch, verb) {
    if (!ch) return;
    if (!CBZ.CONFIG.CHAR_POSES) { ch.sitting = (verb === "sit"); ch.pose = null; return; }
    verb = verb || "stand";
    if (verb === "sit") { ch.sitting = true; ch.pose = null; return; }
    ch.sitting = false;
    ch.pose = (verb === "stand") ? null : verb;
  };
})();
