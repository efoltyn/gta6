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
  // both shoulders (x = swing, z = out) and both elbows, damped at 12
  function crowdArms(ch, dt, lx, lz, rx, rz, el, er) {
    const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra, J = ch.low || {};
    if (la) { la.rotation.x = damp(la.rotation.x, lx, 12, dt); la.rotation.z = damp(la.rotation.z, lz, 12, dt); }
    if (ra) { ra.rotation.x = damp(ra.rotation.x, rx, 12, dt); ra.rotation.z = damp(ra.rotation.z, rz, 12, dt); }
    elbow(J.la, el, dt, 12); elbow(J.ra, er, dt, 12);
  }

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
    // both hands reaching down and forward, elbows well bent — somebody
    // WORKING with their hands at knee height on the thing in front of them.
    // The paramedic's beat over a body (city/medics.js) and the shape any
    // future kneeling repair/treat verb wants; it is a row here rather than
    // arm math inside medics.js precisely so the next one is also a row.
    tend(ch, dt) {
      const J = ch.low || {}, r = 14;
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      if (la) { la.rotation.x = damp(la.rotation.x, -0.62, r, dt); la.rotation.z = damp(la.rotation.z, 0.26, r, dt); }
      if (ra) { ra.rotation.x = damp(ra.rotation.x, -0.62, r, dt); ra.rotation.z = damp(ra.rotation.z, -0.26, r, dt); }
      elbow(J.la, -1.35, dt, r); elbow(J.ra, -1.35, dt, r);
    },
    // ---- THE CROWD'S ARMS (rallies, protests, marches, a stadium). These
    // lived inside city/president_public.js; they are rows here because the
    // instanced crowd (entities/crowdgpu.js) BAKES them from this registry, so
    // a person far away and the same person as a full rig hold the same pose.
    // ch._pubT is the pose clock, ch._pubPh a per-body offset, ch._pubHype a
    // timed burst, ch._pubProp the held prop (a sign board rides the pump).
    // a board on a stick, both hands up the stick, held over the head
    pubPlacard(ch, dt) {
      ch._pubT = (ch._pubT || 0) + dt;
      const hype = (ch._pubHype || 0) > 0;
      if (hype) ch._pubHype -= dt;
      const pump = hype ? Math.sin(ch._pubT * 9) * 0.2 : Math.sin(ch._pubT * 1.4 + (ch._pubPh || 0)) * 0.04;
      crowdArms(ch, dt, -2.72 + pump, -0.2, -2.72 + pump, 0.2, -0.3, -0.3);
      const pr = ch._pubProp;
      if (pr) { pr.position.y = 1.8 + (hype ? Math.max(0, -pump) * 0.5 : 0); pr.rotation.z = pump * 0.25; }
    },
    // a little flag on a stick in the right hand, waved
    pubFlag(ch, dt) {
      ch._pubT = (ch._pubT || 0) + dt;
      const hype = (ch._pubHype || 0) > 0;
      if (hype) ch._pubHype -= dt;
      const w = Math.sin(ch._pubT * (hype ? 8 : 2.2) + (ch._pubPh || 0));
      crowdArms(ch, dt, -0.1, ch.armOutZ || 0.08, -2.45 + w * (hype ? 0.3 : 0.08), 0.12, -0.2, -0.25);
      const pr = ch._pubProp;
      if (pr) pr.rotation.z = w * (hype ? 0.35 : 0.1);
    },
    // both arms up in a V, pumping
    pubCheer(ch, dt) {
      ch._pubT = (ch._pubT || 0) + dt;
      const p = Math.sin(ch._pubT * 8 + (ch._pubPh || 0)) * 0.25;
      crowdArms(ch, dt, -2.55 + p, 0.45, -2.55 - p, -0.45, -0.25, -0.25);
    },
    // the chant: one fist punched up on the beat, the other arm at the side
    pubFist(ch, dt) {
      ch._pubT = (ch._pubT || 0) + dt;
      const beat = Math.max(0, Math.sin(ch._pubT * 5 + (ch._pubPh || 0)));
      crowdArms(ch, dt, -0.15, ch.armOutZ || 0.08, -2.25 - beat * 0.6, -0.12, -0.35, -1.1 + beat * 0.9);
    },
    // ---- THE STREET'S ARMS (city/streetlife.js). People on a pavement talk
    // with their hands, hold a phone to the ear, smoke outside the office.
    // Rows here for the same reason as the crowd's: crowdgpu.js BAKES them, so
    // a person across the street and the same person promoted to a full rig
    // make the same gesture. ch._pubT is the pose clock, ch._pubPh the offset.
    // talking: the right hand comes up and turns over at chest height on the
    // beat of a sentence, the left forearm lifts a little with it
    talk(ch, dt) {
      ch._pubT = (ch._pubT || 0) + dt;
      // one loop is 5.6 s (crowdgpu bakes exactly one): a sentence, a beat
      const t = ch._pubT + (ch._pubPh || 0), w = (Math.PI * 2) / 5.6;
      const s = Math.sin(t * w * 2), b = Math.max(0, Math.sin(t * w));
      crowdArms(ch, dt, -0.12 - b * 0.18, 0.1, -0.55 - b * 0.35 - s * 0.12, -0.18 - s * 0.06, -0.35 - b * 0.4, -1.25 - s * 0.25);
    },
    // walking and talking: ONLY the right arm, held up mid-sentence; the left
    // keeps the gait's swing (a gait overlay: animChar has written the left)
    talkWalk(ch, dt) {
      const ra = ch.parts && ch.parts.ra, J = ch.low || {};
      if (ra) { ra.rotation.x = damp(ra.rotation.x, -0.62, 12, dt); ra.rotation.z = damp(ra.rotation.z, -0.16, 12, dt); }
      elbow(J.ra, -1.2, dt, 12);
    },
    // a phone held to the right ear, the left arm easy
    phone(ch, dt) {
      crowdArms(ch, dt, -0.05, 0.08, -0.55, -0.42, -0.15, -2.35);
    },
    // walking on the phone: the right hand stays at the ear, the left swings
    phoneWalk(ch, dt) {
      const ra = ch.parts && ch.parts.ra, J = ch.low || {};
      if (ra) { ra.rotation.x = damp(ra.rotation.x, -0.55, 12, dt); ra.rotation.z = damp(ra.rotation.z, -0.42, 12, dt); }
      elbow(J.ra, -2.35, dt, 12);
    },
    // a cigarette: the hand comes up to the mouth for a draw every few
    // seconds, rests at the waist between
    smoke(ch, dt) {
      ch._pubT = (ch._pubT || 0) + dt;
      const t = ((ch._pubT + (ch._pubPh || 0)) % 5.2) / 5.2;
      const up = t < 0.12 ? t / 0.12 : t < 0.32 ? 1 : t < 0.44 ? 1 - (t - 0.32) / 0.12 : 0;
      crowdArms(ch, dt, -0.05, 0.08, -0.35 - up * 0.45, -0.2 - up * 0.2, -0.2, -0.85 - up * 1.45);
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
  //   "sit"           -> ch.sitting (animChar's native seated pose). An INSTANT
  //                      flag flip: right for a body placed seated at spawn,
  //                      wrong for a body anyone can watch. A person sitting
  //                      DOWN (or lying down, kneeling, getting up) in front
  //                      of the camera goes through CBZ.moves.sit / lie /
  //                      kneel / stand (entities/moves_posture.js), which walk,
  //                      turn and lower the body instead of popping the pose.
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
