/* ============================================================
   entities/meleeposes.js — CBZ.meleePoses: every strike, guard, slip,
   hit reaction, fall and get-up the character rig can do.

   These used to be ~650 lines inside character.js animChar: hand-typed
   Euler angles per punch that happened to put a fist near a same-size
   chin, a knockdown that was a torso pitched back while the actor's GROUP
   was shoved into the floor, a stagger that was a wobble with no feet.
   This file replaces them with a body that fights from the ground up:

     · A STANCE with the lead foot forward, knees soft, weight on the balls
       of the feet, both fists up (lead at eye line, rear at the jaw), chin
       tucked, torso bladed. Feet are solved by two-bone IK onto the floor,
       so when the hips drop (level change, uppercut dip, a buckle) the knees
       bend and the shoes stay planted instead of sinking into the street.
     · EVERY PUNCH IS A WRIST PATH, solved by two-bone IK with an elbow
       pole — the same idea as the first-person arms (systems/fphands.js),
       which is why the two can land on the same frame: both run the same
       prog → drive envelope off ch.punchT/punchDur (BEAT below; the fist
       is fully out at prog 0.43 in both views). The body does the work:
       the rear heel turns, the hips lead, the shoulder protracts, the fist
       rolls over, the elbow extends through the target and the guard hand
       stays at the jaw. A straight goes out and comes back ON THE SAME
       LINE; a hook travels a flat arc with the elbow up at 90 degrees and
       pivots on the lead foot; an uppercut dips the knees and rises
       through the legs on a short vertical path; body shots change level
       (knees bend, the torso drops the fist to rib height).
     · The aim is a WORLD POINT (ch.punchAim, written by systems/
       verbs_strike.js from the target's live rig), so a jab reaches a tall
       man's chin and a short man's chin; with no aim it throws at a
       same-size opponent's chin.
     · Kicks (front, round, low, knee) are foot/knee paths on the same leg
       IK, with the plant foot pivoting under the hips.
     · Hit reactions by WHERE it landed (ch.hitReact): a straight drives the
       head back, a hook turns it sideways, an uppercut lifts the chin; a
       body shot folds the torso over the fist; a liver shot is a delayed
       fold into a knee drop; a leg kick buckles; a stagger takes a real
       step (ch.footStep — verbs_strike moves the root on the same curve).
     · A FALL (ch.fall) is keyframed in the rig, not a group topple: the
       knees buckle, the hips land first, the torso and head follow, and a
       KO'd man's arms do not break the fall; the get-up rolls to a knee,
       plants a hand and stands. Legacy ch.koT/koPose (games/boxing.js,
       city/arena_fights.js) drive the same fall.
     · HITSTOP: ch.freezeT pauses every clock here for its duration (wall
       time), which is what makes two bodies stop together on contact.

   Two hooks, called from character.js animChar (the only coupling):
     CBZ.meleePoses.strike(ch, dt, moving, J, yGait)  — stance, strikes,
         kicks, guard, slips, footwork, and the upper-body half of hit
         reactions. Runs where the old punch block ran.
     CBZ.meleePoses.react(ch, dt, moving, J)  — falls/get-ups, the head
         snap, the taser lock. Runs where the old KO block ran (last).

   Rig conventions (entities/character.js): the model faces +Z; physical
   LEFT is +X (arm la, leg rl), physical RIGHT is -X (arm ra, leg ll);
   negative rotation.x swings a limb forward; elbows fold negative, knees
   positive; body.rotation.y > 0 brings the RIGHT shoulder forward;
   body.rotation.z > 0 leans right; neck.rotation.x > 0 is chin down.
   Everything here is written absolute or damped, per-frame cost is ~zero
   for a rig that is not fighting, and nothing allocates after load.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const MP = CBZ.meleePoses = CBZ.meleePoses || {};

  const damp = (c, t, r, dt) => c + (t - c) * (1 - Math.exp(-r * dt));
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  /* ---- THE BEAT — shared with the first-person fist (systems/fpsmode.js
     animFists runs the identical drive curve off the same punchT/punchDur).
     The fist is fully out at prog 0.43 in both views. */
  const BEAT = MP.BEAT = { driveStart: 0.16, driveLen: 0.54, impact: 0.43, recover: 0.62 };
  function driveOf(p) { return Math.sin(clamp01((p - BEAT.driveStart) / BEAT.driveLen) * Math.PI); }
  MP.drive = driveOf;
  // kicks: chamber first, so the foot arrives a touch later in the timer
  const KICK_START = 0.22, KICK_LEN = 0.50;
  function kickDriveOf(p) { return Math.sin(clamp01((p - KICK_START) / KICK_LEN) * Math.PI); }
  MP.kickImpactP = KICK_START + KICK_LEN / 2;
  MP.impactP = BEAT.impact;

  /* ---- THE BLOW VOCABULARY ------------------------------------------------
     dur   seconds, jab fastest; the heavy variant is 15% slower
     hand  which fist by default (lead = the side the lead foot is on)
     path  how the wrist travels
     level "head" | "body" — where it goes on a man
     hip   hip/shoulder rotation through the drive (rad) — a jab barely turns,
           a cross turns the hips a full ~40 degrees
     wind  counter-rotation loaded before it (rad)
     fwd   hips travel forward over the lead leg (weight transfer, local u.)
     lean  torso pitch into it; dip = level change (local units of hip drop)
     pro   shoulder protraction (the shoulder drives through)
     roll  forearm roll at full extension (the fist turns over)
     heel  the rear heel turns (rear-hand power punches)
     pivot the lead foot pivots (hooks) */
  const KIND = MP.KINDS = {
    jab:          { dur: 0.30, hand: "lead", path: "straight", level: "head", hip: 0.16, wind: 0.05, fwd: 0.06, lean: 0.06, pro: 0.10, roll: 1.30 },
    cross:        { dur: 0.38, hand: "rear", path: "straight", level: "head", hip: 0.74, wind: 0.14, fwd: 0.12, lean: 0.10, pro: 0.12, roll: 1.30, heel: 1 },
    hook:         { dur: 0.42, hand: "lead", path: "hook", level: "head", hip: 0.86, wind: 0.26, fwd: 0.03, lean: 0.03, pro: 0.04, roll: 0.25, pivot: 1, ext: -0.85 },
    upper:        { dur: 0.42, hand: "rear", path: "upper", level: "head", hip: 0.44, wind: 0.14, fwd: 0.05, lean: 0.0, pro: 0.05, roll: -0.35, dip: 0.16, heel: 1, ext: -1.0 },
    body:         { dur: 0.44, hand: "lead", path: "hook", level: "body", hip: 0.78, wind: 0.22, fwd: 0.04, lean: 0.24, pro: 0.04, roll: 0.25, dip: 0.20, pivot: 1, ext: -0.75 },
    bodyStraight: { dur: 0.40, hand: "rear", path: "straight", level: "body", hip: 0.62, wind: 0.10, fwd: 0.09, lean: 0.24, pro: 0.10, roll: 1.30, dip: 0.20, heel: 1 },
    overhand:     { dur: 0.48, hand: "rear", path: "over", level: "head", hip: 0.86, wind: 0.20, fwd: 0.12, lean: 0.24, pro: 0.12, roll: 1.00, heel: 1 },
    elbow:        { dur: 0.36, hand: "lead", path: "elbow", level: "head", hip: 0.92, wind: 0.34, fwd: 0.06, lean: 0.04, pro: 0.02, roll: 0, ext: -2.2 },
    headbutt:     { dur: 0.46, hand: "both", path: "clinch", level: "head", hip: 0, wind: 0, fwd: 0.10, lean: 0, pro: 0.04, roll: 0 },
    stab:         { dur: 0.30, hand: "rear", path: "stab", level: "body", hip: 0.26, wind: 0.08, fwd: 0.10, lean: 0.14, pro: 0.12, roll: 0.5, dip: 0.06 },
    shove:        { dur: 0.40, hand: "both", path: "shove", level: "body", hip: 0, wind: 0, fwd: 0.14, lean: 0.20, pro: 0.14, roll: 0 },
    // GROUND AND POUND, thrown from the mount (ch.mount, see THE MOUNT below):
    // a short punch cocked by the ear and driven DOWN through his face with
    // the hips posting behind it; the elbow, raised and dropped with the
    // whole torso falling on its point; the hammerfist, overhead and down,
    // pinky side first. level "ground" = his head where it lies.
    gnp:          { dur: 0.34, hand: "lead", path: "ground", level: "ground", hip: 0.42, wind: 0.24, fwd: 0, lean: 0.30, pro: 0.10, roll: 1.10 },
    gnpElbow:     { dur: 0.46, hand: "rear", path: "groundElbow", level: "ground", hip: 0.50, wind: 0.30, fwd: 0, lean: 0.50, pro: 0.04, roll: 0, ext: -2.3 },
    hammer:       { dur: 0.42, hand: "rear", path: "hammer", level: "ground", hip: 0.30, wind: 0.12, fwd: 0, lean: 0.34, pro: 0.06, roll: -1.20 },
  };
  // legacy spellings other files write into punchKind
  function kindKey(k) {
    if (k && KIND[k]) return k;
    if (k === "upper" || k === "uppercut") return "upper";
    if (k === "roundKick" || k === "kick") return "cross";
    return "cross";                                   // "", "straight", unknown → a straight
  }
  MP.kindKey = kindKey;
  const KICK = MP.KICKS = {
    front: { dur: 0.55, leg: "rear", level: "body" },
    round: { dur: 0.65, leg: "rear", level: "body" },
    low:   { dur: 0.55, leg: "rear", level: "legs" },
    knee:  { dur: 0.50, leg: "rear", level: "body" },
  };
  function kickKey(k) { return k === "round" || k === "roundKick" ? "round" : k === "low" ? "low" : k === "knee" ? "knee" : "front"; }
  MP.kickKey = kickKey;
  MP.durOf = function (kind, heavy) {
    const kk = KICK[kind] ? KICK[kind] : (kind === "kick" || kind === "roundKick") ? KICK[kickKey(kind)] : KIND[kindKey(kind)];
    return kk.dur * (heavy ? 1.15 : 1);
  };
  MP.isKick = function (kind) { return kind === "kick" || kind === "roundKick" || kind === "knee" || kind === "front" || kind === "round" || kind === "low" || kind === "lowKick"; };
  // "l" | "r" (the rig's arm/leg letters). Orthodox by default: lead = left.
  MP.leadSide = function (ch) { return ch && ch.southpaw ? "r" : "l"; };
  MP.armFor = function (ch, kind) {
    const k = KIND[kindKey(kind)], lead = MP.leadSide(ch);
    return k.hand === "rear" ? (lead === "l" ? "r" : "l") : lead;
  };
  MP.legFor = function (ch, kind) {
    const lead = MP.leadSide(ch), k = KICK[kickKey(kind)];
    return k.leg === "rear" ? (lead === "l" ? "r" : "l") : lead;
  };
  MP.levelOf = function (kind) { return MP.isKick(kind) ? KICK[kickKey(kind === "lowKick" ? "low" : kind)].level : KIND[kindKey(kind)].level; };

  /* ---- RIG DIMENSIONS (read once per rig off the live skeleton) ---------- */
  function dims(ch) {
    let D = ch._mD;
    if (D) return D;
    const P = ch.profile || {};
    const la = ch.parts.la, ll = ch.parts.ll;
    const armUp = P.armUp || 0.46, armLo = P.armLo || 0.46, legUp = P.legUp || 0.48, legLo = P.legLo || 0.47;
    const l1 = Math.max(0.12, armUp - 0.02), fy = -(armLo + 0.01), fz = 0.035, l2 = Math.hypot(fy, fz);
    const hipY = ch.hipY > 0 ? ch.hipY : (legUp + legLo);
    const hs = P.headSize || 0.6;
    const headY = (ch.neck ? ch.neck.position.y : hipY + 0.93) + (ch.head ? ch.head.position.y : 0.3);
    D = ch._mD = {
      hs, headY, chinY: headY - 0.40 * hs, faceZ: 0.5 * hs,
      shY: la ? la.position.y : headY - 0.34, shX: la ? Math.abs(la.position.x) : 0.62,
      hipY, hipX: ll ? Math.abs(ll.position.x) : 0.23,
      l1, fy, fz, l2, tilt: Math.atan2(fz, -fy), maxR: (l1 + l2) * 0.985, minR: Math.abs(l1 - l2) + 0.06,
      g1: Math.max(0.12, legUp - 0.02), g2: legLo, footY: hipY - Math.max(0.12, legUp - 0.02) - legLo,
      torsoW: P.torsoW || 0.92, torsoD: P.torsoD || 0.5, legW: P.legW || 0.34, armW: P.armW || 0.3,
      scale: (ch.group && ch.group.userData && ch.group.userData.humanScale) || (ch.model ? ch.model.scale.y : 1) || 1,
      keys: null,
    };
    return D;
  }
  MP.dims = dims;

  /* ---- TWO-BONE IK WITH A POLE ---------------------------------------------
     Orients a limb so its end effector lies along the target direction and
     its middle joint (elbow/knee) swings toward the pole. `u` is the end
     effector in the limb's own frame for the chosen joint angle, `j` the
     joint point in that frame; `t` and `p` are in the PARENT frame. */
  const _a1 = new THREE.Vector3(), _a2 = new THREE.Vector3(), _a3 = new THREE.Vector3();
  const _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _b3 = new THREE.Vector3();
  const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4(), _q = new THREE.Quaternion();
  function orient(part, uy, uz, jy, tx, ty, tz, px, py, pz, k) {
    _a1.set(0, uy, uz).normalize();
    _a2.set(0, jy, 0).addScaledVector(_a1, -jy * _a1.y);
    if (_a2.lengthSq() < 1e-10) _a2.set(0, -_a1.z, _a1.y);
    _a2.normalize(); _a3.crossVectors(_a1, _a2);
    _b1.set(tx, ty, tz).normalize();
    _b2.set(px, py, pz); _b2.addScaledVector(_b1, -_b2.dot(_b1));
    if (_b2.lengthSq() < 1e-8) { _b2.set(0, 0, 1).addScaledVector(_b1, -_b1.z); if (_b2.lengthSq() < 1e-8) _b2.set(1, 0, 0).addScaledVector(_b1, -_b1.x); }
    _b2.normalize(); _b3.crossVectors(_b1, _b2);
    _mA.makeBasis(_a1, _a2, _a3).transpose();
    _mB.makeBasis(_b1, _b2, _b3).multiply(_mA);
    _q.setFromRotationMatrix(_mB);
    if (k >= 0.999) part.quaternion.copy(_q); else part.quaternion.slerp(_q, k);
  }
  // T, P in BODY space. pz = shoulder protraction. Returns nothing.
  function solveArm(ch, side, T, P, roll, pz, k, eMax) {
    const part = side === "L" ? ch.parts.la : ch.parts.ra;
    const low = part && part.userData.low;
    if (!low || k <= 0.001) return;
    const D = dims(ch);
    part.position.z = lerp(part.position.z, pz, k);
    let dx = T.x - part.position.x, dy = T.y - part.position.y, dz = T.z - part.position.z;
    let d = Math.hypot(dx, dy, dz);
    if (d > D.maxR) {               // out of reach: the shoulder leads a little further
      const ex = Math.min(0.10, d - D.maxR) * k;
      part.position.z += ex; dz -= ex; d = Math.hypot(dx, dy, dz);
    }
    const dc = clamp(d, D.minR, D.maxR);
    const cosE = clamp((dc * dc - D.l1 * D.l1 - D.l2 * D.l2) / (2 * D.l1 * D.l2), -1, 1);
    // eMax: a hook and an uppercut keep their bend — they never straighten
    // out to chase a man who is too far away; they come up short
    const e = Math.min(eMax == null ? 0.02 : eMax, D.tilt - Math.acos(cosE));
    const uy = -D.l1 + D.fy * Math.cos(e) - D.fz * Math.sin(e);
    const uz = D.fy * Math.sin(e) + D.fz * Math.cos(e);
    orient(part, uy, uz, -D.l1, dx, dy, dz, P.x, P.y, P.z, k);
    low.rotation.x = lerp(low.rotation.x, e, k);
    low.rotation.y = lerp(low.rotation.y, roll, k);
    low.rotation.z = lerp(low.rotation.z, 0, k);
  }
  // T, P in MODEL space (the legs' parent). Knee bends positive.
  function solveLeg(ch, side, T, P, k) {
    const part = side === "L" ? ch.parts.rl : ch.parts.ll;
    const low = part && part.userData.low;
    if (!low || k <= 0.001) return;
    const D = dims(ch);
    const dx = T.x - part.position.x, dy = T.y - part.position.y, dz = T.z - part.position.z;
    const d = clamp(Math.hypot(dx, dy, dz), 0.16, (D.g1 + D.g2) * 0.999);
    const cosK = clamp((d * d - D.g1 * D.g1 - D.g2 * D.g2) / (2 * D.g1 * D.g2), -1, 1);
    const kn = Math.acos(cosK);
    orient(part, -D.g1 - D.g2 * Math.cos(kn), -D.g2 * Math.sin(kn), -D.g1, dx, dy, dz, P.x, P.y, P.z, k);
    low.rotation.x = lerp(low.rotation.x, kn, k);
    low.rotation.y = lerp(low.rotation.y, 0, k);
    low.rotation.z = lerp(low.rotation.z, 0, k);
    part.scale.y = lerp(part.scale.y, 1, k);
  }
  MP.solveArm = solveArm;
  MP.solveLeg = solveLeg;

  /* ---- MODEL CHANNELS (hip drop / hip shift / pivot yaw) ------------------
     The model node is the rig's own local frame under the actor's group, and
     in the standing path nothing but the chair sit writes it. Delta-tracked,
     so a drop never compounds and is refunded exactly when it goes to zero.
     dl/mZ/mX are in rig (model-local) units. */
  function setModel(ch, dl, mZ, mX, mYaw) {
    const m = ch.model;
    if (!m) return;
    const s = dims(ch).scale;
    const y = -dl * s, z = mZ * s, x = mX * s;
    m.position.y += y - (ch._mMy || 0); ch._mMy = y;
    m.position.z += z - (ch._mMz || 0); ch._mMz = z;
    m.position.x += x - (ch._mMx || 0); ch._mMx = x;
    m.rotation.y += mYaw - (ch._mMr || 0); ch._mMr = mYaw;
  }
  function modelIdle(ch) { return !ch._mMy && !ch._mMz && !ch._mMx && !ch._mMr; }

  // ---- per-frame scratch (the whole pose target lives here) ----
  const S = { dl: 0, mZ: 0, mX: 0, mYaw: 0, bx: 0, by: 0, bz: 0, nx: 0, ny: 0, pzL: 0, pzR: 0, rollL: 0, rollR: 0, armK: 1, legK: 1, kickSide: null };
  const WL = new THREE.Vector3(), WR = new THREE.Vector3(), PL = new THREE.Vector3(), PR = new THREE.Vector3();
  const FL = new THREE.Vector3(), FR = new THREE.Vector3(), QL = new THREE.Vector3(), QR = new THREE.Vector3();
  const _A = new THREE.Vector3(), _C = new THREE.Vector3(), _G = new THREE.Vector3(), _t = new THREE.Vector3(), _t2 = new THREE.Vector3();

  function isOn(o) { return !!(o && o.on); }
  function fallActive(ch) { return isOn(ch.fall); }
  MP.fallActive = fallActive;

  /* ---- AIM: a world point → this body's frame. With no aim, a same-size
     opponent's chin (or ribs) at conversational fighting distance. */
  function aimLocal(ch, level, side, world, out) {
    if (world) {
      out.copy(world);
      ch.body.worldToLocal(out);
      return out;
    }
    const D = dims(ch);
    const sx = side === "L" ? 1 : -1;
    // default aim in the unrotated model frame, then into body space
    if (level === "ground") out.set(sx * 0.04, D.footY + 0.24, 0.62);
    else out.set(sx * 0.10, level === "body" ? D.hipY + 0.40 : D.chinY - 0.03, level === "body" ? 1.42 : 1.52);
    ch.model.localToWorld(out);
    ch.body.worldToLocal(out);
    return out;
  }

  /* ============================================================
     HOOK 1 — MP.strike: stance, strikes, kicks, guard, slips, footwork.
     ============================================================ */
  MP.strike = function (ch, dt, moving, J, yGait) {
    // HITSTOP: freezeT runs on wall time and stops every melee clock below
    const wall = CBZ.wallDt != null ? Math.min(0.1, CBZ.wallDt) : dt;
    let mdt = dt;
    if (ch.freezeT > 0) { ch.freezeT = Math.max(0, ch.freezeT - wall); mdt = 0; }
    ch._mdt = mdt;
    // back out last frame's additive head-snap offsets (added by MP.react)
    if (ch._rNx || ch._rNy || ch._rNz) {
      if (ch.neck) { ch.neck.rotation.x -= ch._rNx; ch.neck.rotation.y -= ch._rNy; ch.neck.rotation.z -= ch._rNz; }
      ch._rNx = ch._rNy = ch._rNz = 0;
    }
    ch.body.rotation.y = damp(ch.body.rotation.y, yGait, 10, dt);

    // ---- clocks ----
    const punching = ch.punchT > 0, kicking = ch.kickT > 0;
    if (punching) ch.punchT -= mdt;
    if (kicking) ch.kickT -= mdt;
    if (ch.blockT > 0) { ch.blockT -= mdt; ch.blockK = Math.min(1, (ch.blockK || 0) + mdt * 12); }
    else if (ch.blockK) { ch.blockK = damp(ch.blockK, 0, 10, dt); if (ch.blockK < 0.01) ch.blockK = 0; }
    if (ch.blockHitT > 0) ch.blockHitT -= mdt;
    const dodging = ch.dodgeT > 0;
    if (dodging) ch.dodgeT -= mdt;
    const fs = ch.footStep;
    if (fs && fs.on) { fs.t += mdt; if (fs.t >= fs.dur) fs.on = false; }
    const hr = ch.hitReact;
    if (hr && hr.on) { hr.t += mdt; if (hr.t >= hr.dur) hr.on = false; }
    if (ch.staggerT > 0) ch.staggerT -= mdt;

    const hard = ch.surrender || ch.handsUp || ch.cuffed || ch.verbHold || fallActive(ch);
    const stanceOK = ch.fightStance && !ch.aimingPose && !ch.carryPose && !ch.bladeCarry;
    // THE MOUNT blends in and out on its own clock: on top of a downed man
    // the stance below kneels astride him (ch.mount is written by
    // systems/verbs_strike.js V.groundStrike, cleared when he gets up or you
    // leave him)
    ch._mountK = damp(ch._mountK || 0, ch.mount && !hard ? 1 : 0, ch.mount ? 9 : 6, dt);
    if (ch._mountK < 0.004 && !ch.mount) ch._mountK = 0;
    const mounted = ch._mountK > 0;
    const act = punching || kicking || ch.blockT > 0 || ch.blockK > 0 || dodging || (fs && fs.on) ||
      (hr && hr.on) || ch.staggerT > 0 || mounted;
    /* A MAN WHO IS NOT FIGHTING DOES NOT SQUARE UP TO BE HIT. A reaction or
       a step on a body with no guard up (a bystander shot in the street, a
       guard shoved by an inmate) used to pull the whole boxing stance in
       under it for the length of the beat: lead foot out, rear foot back,
       torso bladed 17 degrees, fists at the chin, then all of it easing back
       out. On a walking man that read as his feet swapping under him while
       his shoulders swung round, the "stuck foot, spinning" the owner saw.
       A passive body reacts from the pose it was already in: every channel
       below starts at its current value and the reaction adds deltas. */
    // (latched at rest, so a guard that drops still fades out of its stance)
    const fighting = ch.fightStance || punching || kicking || ch.blockT > 0 || ch.blockK > 0 || dodging || mounted;
    if (fighting) ch._mPas = false;
    else if (!(ch._mK > 0.01)) ch._mPas = true;
    const passive = !!ch._mPas;
    const want = !hard && (act || stanceOK) ? 1 : 0;
    if (want && hr && hr.on && hr.t < 0.05) ch._mK = Math.max(ch._mK || 0, 0.85);   // a hit does not fade in
    ch._mK = damp(ch._mK || 0, want, want ? 16 : 7, dt);
    ch._mMv = damp(ch._mMv || 0, moving ? 1 : 0, 9, dt);
    // THE HANDS CLOSE. A guard and a punch are fists (a shove is two open
    // palms); when the fight is over they open back to the relaxed hang. An
    // armed hand belongs to the weapon code, so a carried gun or blade is
    // never touched here.
    if (typeof ch.setHandPose === "function") {
      const armed = ch.aimingPose || ch.carryPose || ch.bladeCarry;
      const hand = hard || passive || ch._mK < 0.25 ? null : (punching && ch.punchKind === "shove") ? "open" : "fist";
      if (hand !== (ch._mHand || null)) {
        if (hand) { ch.setHandPose("l", hand); if (!armed) ch.setHandPose("r", hand); }
        else if (!fallActive(ch)) { ch.setHandPose("l", "relaxed"); if (!armed) ch.setHandPose("r", "relaxed"); }
        ch._mHand = hand;
      }
    }
    if (ch._mK < 0.003) {
      ch._mK = 0;
      if (!modelIdle(ch) && !fallActive(ch)) setModel(ch, 0, 0, 0, 0);
      return;
    }
    const K = ch._mK, mv = ch._mMv;
    const D = dims(ch);
    const lead = ch.southpaw ? "R" : "L", lx = lead === "L" ? 1 : -1;
    const rear = lead === "L" ? "R" : "L";

    // ================= STANCE (the base everything overlays) ==============
    const gas = clamp01(ch.winded || 0);
    const leadF = lead === "L" ? FL : FR, rearF = lead === "L" ? FR : FL;
    if (passive) {
      // the NEUTRAL base: the rig as animChar left it, feet under the hips,
      // arms hanging; reactions below add to this and nothing else moves
      const b0 = ch.body.rotation, n0 = ch.neck ? ch.neck.rotation : null;
      S.dl = 0; S.mZ = 0; S.mX = 0; S.mYaw = 0;
      S.bx = b0.x - ch.lean * mv; S.by = b0.y; S.bz = b0.z - ch.sway * mv;
      S.nx = (n0 ? n0.x : 0) + S.bx * 0.5; S.ny = (n0 ? n0.y : 0) + S.by * 0.8;
      S.pzL = ch.parts.la ? ch.parts.la.position.z : 0; S.pzR = ch.parts.ra ? ch.parts.ra.position.z : 0;
      S.rollL = 0; S.rollR = 0;
      S.armK = 0; S.legK = 1 - mv; S.kickSide = null;
      const hang = D.shY - (D.l1 + D.l2) * 0.93;
      WL.set(D.shX + 0.04, hang, 0.05); WR.set(-(D.shX + 0.04), hang, 0.05);
      PL.set(0.25, -0.3, -1); PR.set(-0.25, -0.3, -1);
      FL.set(D.hipX, D.footY, 0.02); FR.set(-D.hipX, D.footY, 0.02);
      QL.set(0.05, 0, 1); QR.set(-0.05, 0, 1);
    } else {
    ch.fightPh = (ch.fightPh || 0) + mdt * (1 - gas * 0.45);
    const w1 = Math.sin(ch.fightPh * 2.6), w2 = Math.sin(ch.fightPh * 5.2 + 1.3);
    S.dl = 0.07 + 0.014 * w2 * (1 - gas * 0.7) - gas * 0.03;   // bouncing on the balls of the feet; a gassed man stands up
    S.mZ = 0; S.mX = 0.02 * w1 * lx; S.mYaw = 0;
    S.bx = 0.10 + gas * (0.10 + Math.sin(ch.breath * 4.6) * 0.055);
    S.by = -0.30 * lx + 0.05 * w1;
    S.bz = 0.03 * w1;
    S.nx = 0.14 - gas * 0.08; S.ny = 0;
    S.pzL = 0.04; S.pzR = 0.04; S.rollL = 0; S.rollR = 0;
    S.armK = 1; S.legK = 1 - mv; S.kickSide = null;
    // guard: lead fist at the eye line a forearm out, rear fist at the jaw;
    // a gassed guard sags toward the ribs
    const gy = gas * 0.34;
    const leadW = lead === "L" ? WL : WR, rearW = lead === "L" ? WR : WL;
    leadW.set(lx * 0.17, D.chinY + 0.06 - gy, D.faceZ + 0.16 - gas * 0.06);
    rearW.set(-lx * 0.22, D.chinY - 0.02 - gy, D.faceZ + 0.02);
    PL.set(0.55, -1, -0.25); PR.set(-0.55, -1, -0.25);          // elbows down, tucked to the ribs
    // feet (group frame, rig units): lead foot forward, rear back and out, rear heel up
    leadF.set(lx * (D.hipX + 0.03), D.footY, 0.30);
    rearF.set(-lx * (D.hipX + 0.10), D.footY + 0.025, -0.30);
    QL.set(0.25, 0.1, 1); QR.set(-0.25, 0.1, 1);                 // knees track over the toes
    }
    if (mounted) mountPose(ch, D, ch._mountK);

    // ================= PUNCH ===============================================
    let aimSide = null;
    if (punching) {
      const key = kindKey(ch.punchKind), k = KIND[key];
      const dur = ch.punchDur || k.dur;
      const p = clamp01(1 - Math.max(0, ch.punchT) / dur);
      let d = driveOf(p);
      // a blow that landed stops ON the man, it does not go through him
      if (ch.punchLandP >= 0 && p > ch.punchLandP) d = Math.min(d, ch._mLandD != null ? ch._mLandD : d);
      const w = sstep(0, 0.14, p) * (1 - sstep(0.14, 0.34, p));
      const lvl = sstep(0, 0.30, p) * (1 - sstep(0.66, 1, p));
      const both = k.hand === "both";
      const side = ch.punchArm === "l" ? "L" : "R";
      const sx = side === "L" ? 1 : -1, byDir = -sx;
      aimSide = side;
      // ---- from the ground up ----
      S.by += byDir * (k.hip * d - k.wind * w);
      if (both) S.by = lerp(S.by, 0, Math.max(w, d));             // two hands square the shoulders
      S.mZ += k.fwd * d;                                          // weight rolls onto the lead leg
      if (k.level === "ground") {
        // from the mount the hips drive forward and down into him: a punch
        // posts the weight over his face, the elbow DIVES the whole torso on him
        const dive = k.path === "groundElbow";
        S.mZ += (dive ? 0.40 : 0.12) * d;
        S.dl += (dive ? 0.0 : 0.04) * d;
      }
      if (k.path === "upper") {
        const dip = sstep(0, 0.20, p) * (1 - sstep(0.20, 0.46, p));
        S.dl += (k.dip || 0) * dip - 0.05 * d;                    // sink, then drive up through the legs
        S.bx += 0.14 * dip - 0.06 * d;
        S.bz += -sx * 0.10 * dip;                                 // the punching shoulder drops to load
      } else if (k.dip) {
        S.dl += k.dip * lvl;                                      // level change: the fist goes to rib height
        S.bx += k.lean * lvl;
        S.bz += -sx * 0.16 * lvl * (k.path === "hook" ? 1 : 0.4);
      } else {
        S.bx += k.lean * d;
      }
      if (k.path === "clinch") {                                  // headbutt: cock back, then through him
        S.bx += -0.36 * sstep(0, 0.25, p) * (1 - d) + 0.50 * d;
        S.nx += -0.45 * sstep(0, 0.25, p) * (1 - d) + 0.70 * d;
      }
      if (k.path === "shove") S.bx += -0.14 * w;                  // rock back before the push
      // rear heel turns / lead foot pivots: heel up, knee turns in
      if (k.heel) {
        rearF.y += 0.05 * d;
        (rear === "L" ? QL : QR).x = lerp((rear === "L" ? QL : QR).x, (rear === "L" ? -0.7 : 0.7), d);
      }
      if (k.pivot) {
        leadF.y += 0.03 * d;
        (lead === "L" ? QL : QR).x = lerp((lead === "L" ? QL : QR).x, (lead === "L" ? -0.8 : 0.8), d);
      }
      // ---- the wrist path ----
      const W = side === "L" ? WL : WR, Pp = side === "L" ? PL : PR;
      const O = side === "L" ? WR : WL;                           // the other (guard) hand
      _G.copy(W);                                                  // this hand's guard point
      // the aim is resolved AFTER the body is posed (see below); stash the
      // parameters for the arm pass
      S._p = p; S._d = d; S._w = w; S._k = k; S._side = side; S._sx = sx; S._both = both;
      if (!both) {
        // the guard hand stays home at the jaw (a touch tighter on power shots)
        O.z -= 0.05 * d * (k.hip > 0.5 ? 1 : 0.4);
        O.y += 0.02 * d;
      }
      if (side === "L") { S.pzL = 0.04 + k.pro * d; S.rollL = sx * (k.roll || 0) * d; }
      else { S.pzR = 0.04 + k.pro * d; S.rollR = sx * (k.roll || 0) * d; }
      if (both) { S.pzL = S.pzR = 0.04 + k.pro * d; }
      void Pp;
    } else {
      S._k = null;
    }

    // ================= KICK ================================================
    let kickK = null, kp = 0, ke = 0, kch = 0, kSide = "R";
    if (kicking) {
      const key = kickKey(ch.kickKind);
      kickK = key;
      const dur = ch.kickDur || KICK[key].dur;
      kp = clamp01(1 - Math.max(0, ch.kickT) / dur);
      ke = kickDriveOf(kp);
      if (ch.kickLandP >= 0 && kp > ch.kickLandP) ke = Math.min(ke, ch._mKLandE != null ? ch._mKLandE : ke);
      kch = sstep(0, 0.26, kp) * (1 - sstep(0.74, 1, kp));
      kSide = ch.kickLeg === "l" ? "L" : "R";
      S.kickSide = kSide;
      S.legK = 1;                                                 // a kick owns the legs even mid-step
      const sx = kSide === "L" ? 1 : -1;
      if (key === "front") {
        S.bx += -0.26 * ke + 0.06 * kch;                          // lean back as the foot drives out
        S.mZ += 0.16 * ke;                                        // the hips thrust through the teep
        S.dl += 0.02;
      } else if (key === "round" || key === "low") {
        const turn = sstep(0.06, 0.42, kp) * (1 - sstep(0.72, 1, kp));
        S.mYaw = -sx * (key === "round" ? 1.05 : 0.70) * turn;    // the plant foot pivots, the hip turns over
        S.bz += sx * (key === "round" ? 0.30 : 0.18) * ke;        // counter-lean off the kicking side
        S.bx += (key === "low" ? -0.18 : -0.10) * ke;
        S.mZ += 0.06 * ke;
      } else {                                                    // knee: curl over it, rise onto the plant toe
        S.bx += 0.24 * ke;
        S.dl += -0.05 * ke;
        S.mZ += 0.10 * ke;
      }
    }

    // ================= GUARD (high block) ==================================
    const bk = ch.blockK || 0;
    if (bk > 0) {
      let jit = 0;
      if (ch.blockHitT > 0) jit = Math.sin(ch.blockHitT * 55) * Math.max(0, ch.blockHitT) * 0.9;
      // forearms up in front of the face, elbows in front of the ribs
      _t.set(0.15, D.headY + 0.04, D.faceZ + 0.16 - 0.10 * Math.abs(jit));
      WL.lerp(_t, bk); _t.x = -0.15; WR.lerp(_t, bk);
      PL.lerp(_t2.set(0.25, -1, 0.45), bk); PR.lerp(_t2.set(-0.25, -1, 0.45), bk);
      S.bx += (0.14 - 0.08 * jit) * bk;
      S.dl += 0.05 * bk;
      S.nx += 0.18 * bk;                                          // chin down behind the gloves
    }

    // ================= SLIP / DUCK / PULL ==================================
    if (dodging) {
      const dd = ch.dodgeDur || 0.35;
      const env = Math.sin(clamp01(1 - Math.max(0, ch.dodgeT) / dd) * Math.PI);
      const dir = ch.dodgeDir || 1;                               // +1 = to his right
      const kind = ch.dodgeKind || "slip";
      if (kind === "duck") {
        S.dl += 0.30 * env; S.bx += 0.30 * env; S.nx -= 0.14 * env;
      } else if (kind === "pull") {
        S.bx -= 0.30 * env; S.mZ -= 0.10 * env; S.nx -= 0.06 * env;
      } else {
        // head off the centre line: bend at the knees and waist to the side,
        // the shoulders roll with it, weight onto that foot
        S.bz += dir * 0.38 * env; S.by += dir * 0.18 * env;
        S.dl += 0.09 * env; S.mX += -dir * 0.09 * env;
      }
    }

    // ================= HIT REACTIONS (the body half) =======================
    if (hr && hr.on) reactBody(ch, hr, D, lead, passive);
    else if (ch.staggerT > 0) legacyStagger(ch, D);

    // ================= FOOTWORK (a real step) ==============================
    if (fs && fs.on && S.legK > 0) {
      const p = clamp01(fs.t / fs.dur);
      const sr = stepRootOf(p);
      const s1 = sstep(0, 0.55, p), s2 = sstep(0.40, 1, p);
      const first = fs.lead === "L" ? FL : FR, second = fs.lead === "L" ? FR : FL;
      first.x += fs.x * (s1 - sr); first.z += fs.z * (s1 - sr); first.y += 0.08 * Math.sin(Math.PI * s1);
      second.x += fs.x * (s2 - sr); second.z += fs.z * (s2 - sr); second.y += 0.06 * Math.sin(Math.PI * s2);
    }

    // ================= APPLY ==============================================
    const legK = K * S.legK;
    // model: hips drop / shift / pivot — only while the legs are ours
    setModel(ch, S.dl * legK, S.mZ * legK, S.mX * legK, S.mYaw * legK);
    const b = ch.body;
    b.rotation.x = lerp(b.rotation.x, ch.lean * mv + S.bx, K);
    b.rotation.y = lerp(b.rotation.y, S.by, K);
    b.rotation.z = lerp(b.rotation.z, ch.sway * mv + S.bz, K);
    if (CBZ.lockCharacterHips) CBZ.lockCharacterHips(ch);
    // eyes stay on the man: the neck counter-turns the torso
    if (ch.neck) {
      ch.neck.rotation.x = lerp(ch.neck.rotation.x, S.nx - S.bx * 0.5, K);
      ch.neck.rotation.y = lerp(ch.neck.rotation.y, -S.by * 0.8 + S.ny, K);
    }
    ch._mNeckK = K;

    // arms: needs this frame's body matrix (the aim is a world point)
    b.updateWorldMatrix(true, false);
    if (S._k) punchArms(ch, D);
    if (kickK === "knee") {                                       // the collar tie: both hands on his neck, hauling down
      aimLocal(ch, "head", "L", ch.kickAim || null, _A);
      WL.set(0.22, _A.y - 0.22 - 0.22 * ke, Math.max(D.faceZ + 0.30, _A.z - 0.30) - 0.08 * ke);
      WR.set(-0.22, WL.y, WL.z);
      PL.set(0.5, -1, 0); PR.set(-0.5, -1, 0);
    }
    const armK = K * S.armK;
    if (armK > 0.002) {
      const ext = S._k && S._k.ext != null && !S._both ? S._k.ext : null;
      solveArm(ch, "L", WL, PL, S.rollL, S.pzL, armK, S._side === "L" ? ext : null);
      solveArm(ch, "R", WR, PR, S.rollR, S.pzR, armK, S._side === "R" ? ext : null);
    }

    // legs: feet planted by IK (group frame → model frame)
    if (legK > 0.002) {
      if (kickK) kickLegs(ch, D, kickK, kSide, kp, ke, kch);
      toModel(ch, FL); toModel(ch, FR);
      _poleYaw = ch._mMr || 0;                                    // knees turn with the pivoting hips
      rotPole(QL); rotPole(QR);
      solveLeg(ch, "L", FL, QL, S.kickSide === "L" ? K : legK);
      solveLeg(ch, "R", FR, QR, S.kickSide === "R" ? K : legK);
    }
  };

  // group-frame (rig units, root at the feet) → model frame, given this
  // frame's model drop/shift/yaw (read back from what setModel applied)
  function toModel(ch, v) {
    const s = dims(ch).scale;
    v.x -= (ch._mMx || 0) / s; v.y -= (ch._mMy || 0) / s; v.z -= (ch._mMz || 0) / s;
    const r = -(ch._mMr || 0);
    if (r) { const c = Math.cos(r), sn = Math.sin(r), x = v.x, z = v.z; v.x = x * c + z * sn; v.z = -x * sn + z * c; }
    return v;
  }
  let _poleYaw = 0;
  function rotPole(v) {
    const r = -_poleYaw;
    if (r) { const c = Math.cos(r), sn = Math.sin(r), x = v.x, z = v.z; v.x = x * c + z * sn; v.z = -x * sn + z * c; }
  }

  // ---- the punching arm(s), once the body is posed ----
  function punchArms(ch, D) {
    const k = S._k, p = S._p, d = S._d, w = S._w, side = S._side, sx = S._sx;
    const aim = aimLocal(ch, k.level, side, ch.punchAim || null, _A);
    const W = side === "L" ? WL : WR, P = side === "L" ? PL : PR;
    const chamber = sstep(0, 0.2, p);
    switch (k.path) {
      case "straight": {
        // chamber a touch back and down, then out along one line and back on it
        _C.copy(W); _C.z -= k.wind * 0.35 * w; _C.y -= 0.02 * w;
        W.copy(_C).lerp(aim, d);
        P.set(sx * 0.35, -1, -0.35);                              // elbow behind the fist, never flared
        break;
      }
      case "hook": {
        // raise the elbow to the fist's height, then the body slings the bent
        // arm round on a FLAT arc: the height is lerped straight, the bulge is
        // purely sideways
        _C.copy(W); _C.x += sx * 0.16 * chamber; _C.z -= 0.06 * chamber;
        W.copy(_C).lerp(aim, d);
        const bulge = Math.sin(Math.PI * d);
        W.x += sx * 0.30 * bulge; W.z -= 0.10 * bulge;
        P.set(sx * 1.0, 0.55 * chamber + 0.35 * d, -0.35);      // elbow up, out, at ~90 degrees
        break;
      }
      case "upper": {
        // the fist drops to the chest on the dip and rises up the centre line:
        // vertical leads, horizontal follows — a short, rising path
        _C.copy(W); _C.y -= 0.30 * chamber; _C.x -= sx * 0.06 * chamber; _C.z -= 0.04 * chamber;
        const dv = Math.pow(d, 0.65), dh = Math.pow(d, 1.5);
        W.set(lerp(_C.x, aim.x, dh), lerp(_C.y, aim.y, dv), lerp(_C.z, aim.z, dh));
        P.set(sx * 0.25, -1, 0.05);                               // elbow under the fist
        break;
      }
      case "over": {
        _C.copy(W); _C.y += 0.04 * chamber; _C.z -= 0.08 * chamber;
        W.copy(_C).lerp(aim, d);
        const arc = Math.sin(Math.PI * d);
        W.y += 0.24 * arc; W.x += sx * 0.08 * arc;               // loops over the top of his guard
        P.set(sx * 0.8, 0.7, -0.3);
        break;
      }
      case "elbow": {
        // the fist never leaves the shoulder line: it folds against the face and
        // the turning body swings the POINT of the elbow through
        _t.set(-sx * 0.12, D.chinY + 0.04, D.faceZ + 0.20);
        W.lerp(_t, Math.max(d, chamber * 0.6));
        P.set(sx * 1.0, 0.25, 0.55);
        break;
      }
      case "stab": {
        // chambered low at the ribs, then a straight piston in along the body
        _C.set(sx * 0.36, D.hipY + 0.34, 0.16);
        W.lerp(_C, chamber * (1 - d));
        _t.copy(W);
        W.copy(_t).lerp(aim, Math.pow(d, 1.2));
        P.set(sx * 0.4, -1, -0.4);
        // the free hand goes out to hook him onto it
        const O = side === "L" ? WR : WL;
        _t2.set(-sx * 0.18, aim.y + 0.25, Math.min(aim.z - 0.15, D.faceZ + 0.70));
        O.lerp(_t2, Math.max(d, 0.5 * chamber));
        break;
      }
      case "shove": {
        // both palms chamber at the sternum, then snap out on the same beat
        _t.set(0, D.shY - 0.30, 0.30);
        WL.lerp(_t2.set(0.22, _t.y, _t.z), chamber * (1 - d)); WR.lerp(_t2.set(-0.22, _t.y, _t.z), chamber * (1 - d));
        _t.copy(aim); _t.y = Math.min(_t.y, D.shY - 0.10);
        WL.lerp(_t2.set(_t.x + 0.24, _t.y, _t.z), d); WR.lerp(_t2.set(_t.x - 0.24, _t.y, _t.z), d);
        PL.set(0.6, -1, -0.2); PR.set(-0.6, -1, -0.2);
        break;
      }
      case "ground": {
        // cocked by the ear, elbow up and back, then down the short line
        // through his face: the guard hand stays posted on his chest
        _t.set(sx * 0.24, D.shY + 0.06, 0.12);
        _C.copy(W).lerp(_t, chamber * (1 - d));
        W.copy(_C).lerp(aim, d);
        P.set(sx * 0.75, 0.55 - 0.45 * d, -0.55 - 0.35 * d);
        postHand(side, aim, d);
        break;
      }
      case "groundElbow": {
        // the arm folds, the elbow goes up past the ear, then the torso falls
        // on its point: the fist ends by the far collarbone, the elbow in him
        _t.set(sx * 0.16, D.shY + 0.18, 0.06);
        W.lerp(_t, chamber * (1 - d));
        // the wrist stays high over the target, the elbow hangs under it
        // and is what arrives
        _t2.set(aim.x - sx * 0.04, aim.y + 0.30, aim.z - 0.04);
        W.lerp(_t2, d);
        P.set(sx * 0.4 * (1 - d), 1 - 1.5 * d, 0.2 + 1.1 * d);
        postHand(side, aim, d);
        break;
      }
      case "hammer": {
        // overhead, then down like a mallet, pinky side first
        _t.set(sx * 0.16, D.headY + 0.22, -0.04);
        _C.copy(W).lerp(_t, chamber * (1 - d));
        W.copy(_C).lerp(aim, d);
        W.y += 0.10 * Math.sin(Math.PI * d);
        P.set(sx * 0.85, 0.35 - 0.5 * d, -0.45);
        postHand(side, aim, d);
        break;
      }
      case "clinch": {
        // headbutt: both fists take his collar and PULL while the head drives
        const grab = sstep(0, 0.28, p);
        _t.set(0.20, aim.y - 0.34, aim.z - 0.24);
        WL.lerp(_t, grab); _t.x = -0.20; WR.lerp(_t, grab);
        WL.z -= 0.14 * d; WR.z -= 0.14 * d;
        PL.set(0.8, -1, 0); PR.set(-0.8, -1, 0);
        break;
      }
    }
  }

  /* ---- THE MOUNT: kneeling astride a man on his back ---------------------
     Knees on the floor either side of his ribs, shins lying back along the
     floor, hips posted over his belly, torso over him, chin down on him,
     hands up and in front of the chest. Blended over the stance by `m`, so
     getting on and off him is a body moving, not a cut. The hip height comes
     from the thigh length: a kneeling man's hips sit a thigh above his
     knees, and the knees here are out wide. Root placement (where the actor
     is on him, which way he faces) is verbs_strike.js's job. */
  function mountPose(ch, D, m) {
    const kx = D.hipX + 0.26, kz = 0.12;
    const thighY = Math.sqrt(Math.max(0.03, D.g1 * D.g1 - (kx - D.hipX) * (kx - D.hipX) - kz * kz));
    const hipH = D.footY + 0.07 + thighY + 0.04;             // knee pad + thigh, posted a touch up
    const breath = 0.012 * Math.sin((ch.breath || 0) * 3.1);
    S.dl = lerp(S.dl, D.hipY - hipH + breath, m);
    S.mZ = lerp(S.mZ, 0, m); S.mX = lerp(S.mX, 0, m); S.mYaw = lerp(S.mYaw, 0, m);
    S.bx = lerp(S.bx, 0.40, m); S.by = lerp(S.by, 0, m); S.bz = lerp(S.bz, 0, m);
    S.nx = lerp(S.nx, 0.55, m); S.ny = lerp(S.ny, 0, m);
    S.legK = lerp(S.legK, 1, m);
    // hands: up, in front of the chest, ready to post or punch
    _t.set(0.20, D.shY - 0.18, 0.30); WL.lerp(_t, m);
    _t.x = -0.20; WR.lerp(_t, m);
    PL.lerp(_t2.set(0.6, -1, -0.2), m); PR.lerp(_t2.set(-0.6, -1, -0.2), m);
    // feet: behind the knees, shins on the floor, toes pointed back
    _t.set(kx + 0.04, D.footY + 0.06, kz - D.g2 * 0.96); FL.lerp(_t, m);
    _t.x = -(kx + 0.04); FR.lerp(_t, m);
    QL.lerp(_t2.set(0.55, -0.1, 1), m); QR.lerp(_t2.set(-0.55, -0.1, 1), m);
  }
  // the other hand on a ground strike: posted on his chest, pinning him
  function postHand(side, aim, d) {
    const O = side === "L" ? WR : WL, OP = side === "L" ? PR : PL, ox = side === "L" ? -1 : 1;
    _t2.set(aim.x + ox * 0.16, aim.y - 0.05, aim.z - 0.30);
    O.lerp(_t2, 0.55 + 0.35 * d);
    OP.set(ox * 0.7, -0.6, -0.3);
  }

  // ---- kicks: foot/knee paths on the leg IK (writes FL/FR/QL/QR) ----
  function kickLegs(ch, D, key, side, p, e, ch01) {
    const F = side === "L" ? FL : FR, Q = side === "L" ? QL : QR;
    const plant = side === "L" ? FR : FL, PQ = side === "L" ? QR : QL;
    const sx = side === "L" ? 1 : -1;
    // the plant foot comes under the hips
    plant.x = lerp(plant.x, -sx * D.hipX * 0.8, ch01); plant.z = lerp(plant.z, 0.04, ch01);
    const aimW = ch.kickAim || null;
    if (key === "front") {
      _C.set(sx * D.hipX * 0.7, D.footY + 0.55, 0.20);           // knee up, foot under it
      if (aimW) { _A.copy(aimW); ch.group.worldToLocal(_A); _A.divideScalar(D.scale); }
      else _A.set(sx * 0.10, D.hipY + 0.10, 1.05);
      F.lerp(_C, ch01); F.lerp(_A, e);
      Q.set(sx * 0.15, 0.7, 1);
    } else if (key === "knee") {
      // the foot comes up behind as the knee drives up and forward
      _C.set(sx * D.hipX * 0.6, D.footY + 0.20, -0.12);
      F.lerp(_C, ch01);
      _A.set(sx * D.hipX * 0.5, D.footY + 0.78, 0.10);
      F.lerp(_A, e);
      Q.set(0, 0.35, 1);
    } else {
      // round / low: chamber out to the side, then the shin sweeps across
      const high = key === "round";
      _C.set(sx * 0.62, D.footY + (high ? 0.62 : 0.34), -0.10);
      if (aimW) { _A.copy(aimW); ch.group.worldToLocal(_A); _A.divideScalar(D.scale); }
      else _A.set(-sx * 0.05, high ? D.hipY + 0.28 : D.hipY - 0.30, 1.0);
      F.lerp(_C, ch01);
      const sweep = e;
      F.set(lerp(F.x, _A.x, sweep), lerp(F.y, _A.y, Math.min(1, sweep * 1.4)), lerp(F.z, _A.z, sweep));
      F.x += sx * 0.25 * Math.sin(Math.PI * sweep);              // the arc
      Q.set(-sx * 0.2, 1, 0.35);                                  // the knee turns over
      PQ.x *= 1 - ch01;
    }
  }

  // ---- the body half of a hit reaction (inside the stance frame) ----
  function reactBody(ch, hr, D, lead, passive) {
    const t = hr.t, amt = hr.amt == null ? 1 : hr.amt;
    const lx = hr.lx || 0, lz = hr.lz == null ? -1 : hr.lz;      // push direction in HIS frame
    if (hr.kind === "snap") {
      const h2 = impulse(t - 0.03, 0.05, 5.5);
      S.bx += lz * 0.22 * amt * h2;                               // straight: the torso follows the head back
      S.bz += -lx * 0.14 * amt * h2;
      if (hr.blow === "hook") S.by += lx * 0.30 * amt * h2;      // the shoulders twist off a hook
      if (hr.blow === "upper") S.dl -= 0.04 * amt * h2;          // up onto the toes
      S.dl += 0.05 * amt * h2;
      // the guard jolts with the head
      WL.x += lx * 0.05 * h2; WR.x += lx * 0.05 * h2; WL.z += lz * 0.06 * h2; WR.z += lz * 0.06 * h2;
    } else if (hr.kind === "fold") {
      const f = sstep(0, 0.07, t) * (1 - sstep(0.30, hr.dur, t));
      S.bx += 0.58 * amt * f;                                     // folds over the fist
      S.dl += 0.13 * amt * f;
      S.mZ += -0.09 * amt * f;                                    // hips go back
      S.nx += 0.30 * amt * f;
      _t.set(0.16, D.hipY + 0.42, 0.34); WL.lerp(_t, 0.75 * f);   // the arms come in to cover the belly
      _t.x = -0.16; WR.lerp(_t, 0.75 * f);
      if (passive) S.armK = Math.max(S.armK, f);
    } else if (hr.kind === "arm") {
      /* SHOT THROUGH THE ARM: that arm goes dead and hangs straight, the
         other hand comes across and clamps the shoulder, the torso curls
         over it and turns the hurt side away. `side` "L" = his left (+X). */
      const f = sstep(0, 0.06, t) * (1 - sstep(hr.dur * 0.55, hr.dur, t));
      const sg = hr.side === "L" ? 1 : -1;
      const hurtW = sg > 0 ? WL : WR, holdW = sg > 0 ? WR : WL;
      const hurtP = sg > 0 ? PL : PR, holdP = sg > 0 ? PR : PL;
      _t.set(sg * (D.shX + 0.06), D.shY - (D.l1 + D.l2) * 0.97, 0.02); hurtW.lerp(_t, f);
      _t2.set(sg * 0.25, -0.2, -1); hurtP.lerp(_t2, f);
      _t.set(sg * D.shX * 0.45, D.shY - 0.26, D.torsoD * 0.5 + 0.10); holdW.lerp(_t, f);
      _t2.set(-sg * 0.6, -1, 0.1); holdP.lerp(_t2, f);
      S.bx += 0.14 * amt * f;                                      // hunched over it
      S.bz += -sg * 0.10 * amt * f;                                // dips onto the hurt side
      S.by += sg * 0.10 * amt * f;                                 // the hurt shoulder turns away
      S.nx += 0.18 * f;                                            // looks down at it
      S.armK = Math.max(S.armK, f);
    } else if (hr.kind === "buckle") {
      const f = sstep(0, 0.06, t) * (1 - sstep(0.25, hr.dur, t));
      const sgn = hr.side === "L" ? 1 : -1;                        // the leg that was kicked
      S.dl += 0.16 * amt * f;
      S.bz += -sgn * 0.16 * amt * f;                              // he dips onto the hurt side
      const F = hr.side === "L" ? FL : FR;
      F.z += 0.06 * f; F.y += 0.03 * f;
      S.bx += 0.10 * f;
    } else if (hr.kind === "stagger" || hr.kind === "liver") {
      const s = sstep(0, 0.06, t) * (1 - sstep(0.22, Math.max(0.3, hr.dur), t));
      if (hr.kind === "liver") {
        S.bx += 0.24 * s; S.dl += 0.05 * s;                       // the first beat: it has not hit him yet
      } else {
        S.bx += lz * 0.30 * amt * s;
        S.bz += -lx * 0.16 * amt * s;
        // arms go out for balance
        _t.set(0.42, D.shY - 0.30, 0.25); WL.lerp(_t, 0.55 * s * amt);
        _t.x = -0.42; WR.lerp(_t, 0.55 * s * amt);
        if (passive) S.armK = Math.max(S.armK, Math.min(1, 0.7 * s * amt));
      }
    }
  }
  function legacyStagger(ch, D) {
    const sd = ch.staggerDur || 0.55;
    const sk = clamp01(ch.staggerT / sd);                          // 1 at impact → 0
    const wob = Math.sin((1 - sk) * 18) * sk;
    S.bx += -(0.40 * sk * sk + 0.08 * wob);
    S.by += wob * 0.18; S.bz += wob * 0.12;
    S.dl += 0.06 * sk;
    _t.set(0.40, D.shY - 0.32, 0.22); WL.lerp(_t, 0.6 * sk);
    _t.x = -0.40; WR.lerp(_t, 0.6 * sk);
  }
  // a hit's time response: ~instant rise, springy decay (peaks ~1 at `rise`)
  function impulse(t, rise, decay) {
    if (t <= 0) return 0;
    if (t < rise) return t / rise;
    const u = t - rise;
    return Math.exp(-u * decay) * Math.cos(u * 9) * 1;
  }
  MP.impulse = impulse;

  /* ---- FOOTWORK: ch.footStep = { on, t, dur, x, z, lead } — (x, z) is the
     ROOT displacement in rig units (group frame); `lead` ("L"|"R") is the
     foot that moves first. The root travels on stepRoot(p); verbs_strike.js
     moves the actor by the same curve, so the feet land where the body goes. */
  function stepRootOf(p) { return sstep(0.08, 0.85, p); }
  MP.stepRoot = function (ch) {
    const fs = ch && ch.footStep;
    if (!fs) return 1;
    return stepRootOf(clamp01(fs.t / fs.dur));
  };
  MP.startStep = function (ch, x, z, dur, lead) {
    let fs = ch.footStep;
    if (!fs) fs = ch.footStep = { on: false, t: 0, dur: 0.4, x: 0, z: 0, lead: "L" };
    fs.on = true; fs.t = 0; fs.dur = dur || 0.4; fs.x = x; fs.z = z; fs.lead = lead || "L";
    return fs;
  };

  /* ============================================================
     FALLS AND GET-UPS — keyframed, in the rig.
     A key is a whole-body pose:
       h      hip height above the floor (rig units) → the model drop
       mZ     hips fore/aft
       bx by bz  torso; nx ny nz  neck
       L R    legs: { f: ankle fore/aft from the hip, lift: ankle height, z: splay }
              (solved to thigh/knee angles per rig by a planar two-bone IK)
       aL aR  arms: [shoulder x, shoulder z (+ = out), elbow]
     Keys are authored for the LEFT side; `side` -1 mirrors them.
     ============================================================ */
  const KEYS = {
    // ---- falling backward ----
    buckle:  { h: 0.66, mZ: -0.02, bx: 0.18, by: 0, bz: 0.04, nx: 0.42, ny: 0.10, nz: 0.05,
               L: { f: 0.16, lift: 0, z: 0.05 }, R: { f: 0.02, lift: 0, z: -0.02 }, aL: [-0.10, 0.18, -0.40], aR: [-0.05, 0.14, -0.35] },
    seat:    { h: 0.20, mZ: -0.10, bx: -0.34, by: 0, bz: 0.08, nx: 0.30, ny: 0.12, nz: 0.05,
               L: { f: 0.62, lift: 0.04, z: 0.10 }, R: { f: 0.50, lift: 0.02, z: 0.02 }, aL: [0.10, 0.36, -0.30], aR: [0.18, 0.30, -0.28] },
    seatBrace: { h: 0.20, mZ: -0.10, bx: -0.42, by: 0, bz: 0.06, nx: 0.18, ny: 0.05, nz: 0.02,
               L: { f: 0.60, lift: 0.04, z: 0.10 }, R: { f: 0.50, lift: 0.02, z: 0.02 }, aL: [0.95, 0.30, -0.10], aR: [0.90, 0.26, -0.12] },
    // on his back the head is deeper than the chest, so the chin comes forward
    // to rest the skull on the floor; the arms lie out on the ground (+x = toward it)
    lieBack: { h: 0.27, mZ: -0.16, bx: -1.50, by: 0, bz: 0.06, nx: 0.38, ny: 0.40, nz: 0.10,
               L: { f: 0.84, lift: 0.14, z: 0.14 }, R: { f: 0.72, lift: 0.10, z: 0.06 }, aL: [0.22, 0.95, -0.30], aR: [0.26, 0.60, -0.55] },
    // ---- falling forward (face down) ----
    buckleF: { h: 0.62, mZ: 0.04, bx: 0.40, by: 0, bz: 0.04, nx: 0.45, ny: 0.05, nz: 0.02,
               L: { f: 0.10, lift: 0, z: 0.04 }, R: { f: -0.02, lift: 0, z: -0.02 }, aL: [-0.05, 0.14, -0.30], aR: [-0.02, 0.12, -0.28] },
    knees:   { h: 0.55, mZ: 0.02, bx: 0.60, by: 0, bz: 0.05, nx: 0.35, ny: 0.10, nz: 0.02,
               L: { f: -0.42, lift: 0.07, z: 0.04 }, R: { f: -0.40, lift: 0.07, z: -0.02 }, aL: [-0.20, 0.20, -0.30], aR: [-0.15, 0.18, -0.30] },
    // face down the thighs lie on the floor (ankles a touch under hip height)
    // and the arms lie along the ground by the ribs (-x = toward it)
    lieFace: { h: 0.27, mZ: 0.10, bx: 1.50, by: 0, bz: 0.04, nx: -0.40, ny: 1.42, nz: 0.06,   // cheek on the floor
               L: { f: -0.93, lift: 0.12, z: 0.12 }, R: { f: -0.93, lift: 0.13, z: -0.02 }, aL: [-0.10, 0.45, -0.15], aR: [-0.12, 0.30, -0.20] },
    lieFaceBrace: { h: 0.27, mZ: 0.10, bx: 1.45, by: 0, bz: 0.04, nx: -0.55, ny: 0.40, nz: 0.05,
               L: { f: -0.93, lift: 0.12, z: 0.12 }, R: { f: -0.93, lift: 0.13, z: -0.02 }, aL: [-0.10, 0.35, -0.25], aR: [-0.10, 0.35, -0.25] },
    // ---- getting up ----
    sitUp:   { h: 0.21, mZ: -0.08, bx: 0.24, by: 0.10, bz: -0.06, nx: 0.20, ny: 0.10, nz: 0,
               L: { f: 0.40, lift: 0.0, z: 0.08 }, R: { f: 0.72, lift: 0.03, z: 0.04 }, aL: [-0.55, 0.10, -0.95], aR: [0.70, 0.40, -0.12] },
    // knees drawn up under him, one hand planted behind, turning onto that side
    tuck:    { h: 0.24, mZ: -0.02, bx: 0.36, by: 0.26, bz: -0.10, nx: 0.25, ny: 0.20, nz: 0,
               L: { f: 0.30, lift: 0, z: 0.10 }, R: { f: 0.12, lift: 0, z: 0.04 }, aL: [-0.40, 0.15, -1.00], aR: [0.55, 0.45, -0.10] },
    pushUp:  { h: 0.52, mZ: 0.06, bx: 0.95, by: 0, bz: 0, nx: -0.10, ny: 0, nz: 0,
               L: { f: -0.44, lift: 0.07, z: 0.04 }, R: { f: -0.44, lift: 0.07, z: -0.02 }, aL: [-0.95, 0.12, -0.10], aR: [-0.95, 0.12, -0.10] },
    kneel:   { h: 0.58, mZ: 0.02, bx: 0.30, by: -0.12, bz: 0, nx: 0.08, ny: 0.10, nz: 0,
               L: { f: 0.40, lift: 0, z: 0.06 }, R: { f: -0.40, lift: 0.07, z: -0.02 }, aL: [-0.65, 0.05, -1.05], aR: [-0.08, 0.14, -0.35] },
    rise:    { h: 0.80, mZ: 0.02, bx: 0.26, by: -0.10, bz: 0, nx: 0.10, ny: 0.05, nz: 0,
               L: { f: 0.26, lift: 0, z: 0.04 }, R: { f: -0.22, lift: 0.03, z: -0.02 }, aL: [-0.55, 0.05, -1.60], aR: [-0.45, -0.05, -1.80] },
    // ---- the liver: folds onto the hurt side, drops to that knee ----
    liverFold: { h: 0.80, mZ: -0.04, bx: 0.52, by: 0.18, bz: -0.30, nx: 0.30, ny: -0.10, nz: -0.10,
               L: { f: -0.10, lift: 0, z: -0.02 }, R: { f: 0.14, lift: 0, z: 0.02 }, aL: [-0.10, 0.30, -0.60], aR: [-0.70, -0.20, -1.60] },
    liverKneel: { h: 0.58, mZ: 0.02, bx: 0.48, by: 0.20, bz: -0.20, nx: 0.35, ny: -0.10, nz: -0.08,
               L: { f: -0.40, lift: 0.07, z: -0.02 }, R: { f: 0.40, lift: 0, z: 0.06 }, aL: [-0.55, 0.05, -0.90], aR: [-0.55, -0.25, -1.65] },
    // ---- shot through the RIGHT leg (mirrored for the left): that knee
    //      gives, he drops onto it, the good foot planted in front, the
    //      right hand clamped on the thigh and the left braced on the knee ----
    legGive:  { h: 0.74, mZ: -0.02, bx: 0.20, by: 0, bz: 0.10, nx: 0.30, ny: 0, nz: 0.04,
               L: { f: 0.12, lift: 0, z: 0.05 }, R: { f: -0.18, lift: 0.06, z: -0.02 }, aL: [-0.25, 0.25, -0.40], aR: [-0.30, 0.10, -0.70] },
    shotKneel: { h: 0.56, mZ: 0.02, bx: 0.26, by: 0, bz: 0.08, nx: 0.32, ny: 0, nz: 0.04,
               L: { f: 0.46, lift: 0, z: 0.07 }, R: { f: -0.44, lift: 0.08, z: -0.02 }, aL: [-0.55, 0.08, -0.55], aR: [-0.30, 0.06, -0.85] },
  };
  // the sequences: [key, t_end] — the first segment blends from whatever the
  // body was doing, the last hands back to it (weight → 0)
  const SEQ = {
    back:     [["buckle", 0.20], ["seat", 0.42], ["lieBack", 0.72]],
    backC:    [["buckle", 0.18], ["seatBrace", 0.42], ["lieBack", 0.74]],     // conscious: hands go back and catch
    face:     [["buckleF", 0.20], ["knees", 0.40], ["lieFace", 0.66]],
    faceC:    [["buckleF", 0.18], ["knees", 0.38], ["lieFaceBrace", 0.62]],
    liver:    [["liverFold", 0.55], ["liverKneel", 0.85]],
    upBack:   [["sitUp", 0.40], ["tuck", 0.75], ["kneel", 1.15], ["rise", 1.45], [null, 1.75]],
    upFace:   [["pushUp", 0.45], ["kneel", 0.95], ["rise", 1.30], [null, 1.60]],
    upKneel:  [["rise", 0.40], [null, 0.72]],
    kneel:    [["legGive", 0.14], ["shotKneel", 0.36]],
  };
  /* one row per way of going down: its fall (KO'd / conscious), the key it
     lies (or kneels) in, how it gets up, and a beat before anything moves */
  const FALLS = {
    back:  { fall: "back", fallC: "backC", lie: "lieBack", lieC: "lieBack", up: "upBack", getup: "roll", delay: 0 },
    face:  { fall: "face", fallC: "faceC", lie: "lieFace", lieC: "lieFaceBrace", up: "upFace", getup: "push", delay: 0 },
    liver: { fall: "liver", fallC: "liver", lie: "liverKneel", lieC: "liverKneel", up: "upKneel", getup: "knee", delay: 0.22 },
    kneel: { fall: "kneel", fallC: "kneel", lie: "shotKneel", lieC: "shotKneel", up: "upKneel", getup: "knee", delay: 0 },
  };
  function fallRow(variant) { return FALLS[variant] || FALLS.back; }
  const CH = 20;   // resolved channel count
  // resolved key: [dl, mZ, bx, by, bz, nx, ny, nz, LLx, LLz, LLk, RLx, RLz, RLk, LAx, LAz, LAe, RAx, RAz, RAe]
  function legAngles(D, h, spec, out, o) {
    const v = Math.max(0.05, h - D.footY - spec.lift), f = spec.f;
    const d = clamp(Math.hypot(v, f), 0.16, (D.g1 + D.g2) * 0.999);
    const kn = Math.acos(clamp((d * d - D.g1 * D.g1 - D.g2 * D.g2) / (2 * D.g1 * D.g2), -1, 1));
    const a = Math.acos(clamp((D.g1 * D.g1 + d * d - D.g2 * D.g2) / (2 * D.g1 * d), -1, 1));
    const phi = Math.atan2(f, v);
    out[o] = -(phi + a); out[o + 1] = spec.z; out[o + 2] = kn;
  }
  function resolveKey(D, key) {
    const r = new Float32Array(CH);
    r[0] = D.hipY - key.h; r[1] = key.mZ; r[2] = key.bx; r[3] = key.by; r[4] = key.bz;
    r[5] = key.nx; r[6] = key.ny; r[7] = key.nz;
    legAngles(D, key.h, key.L, r, 8);
    legAngles(D, key.h, key.R, r, 11);
    r[14] = key.aL[0]; r[15] = key.aL[1]; r[16] = key.aL[2];
    r[17] = key.aR[0]; r[18] = key.aR[1]; r[19] = key.aR[2];
    return r;
  }
  function keysOf(ch) {
    const D = dims(ch);
    if (!D.keys) {
      D.keys = {};
      for (const n in KEYS) D.keys[n] = resolveKey(D, KEYS[n]);
    }
    return D.keys;
  }
  MP.keyPose = function (ch, name) { return keysOf(ch)[name] || null; };

  const CUR = new Float32Array(CH), OUT = new Float32Array(CH), MIR = new Float32Array(CH);
  function readCur(ch, out) {
    const s = dims(ch).scale;
    out[0] = -(ch._mMy || 0) / s; out[1] = (ch._mMz || 0) / s;
    const b = ch.body.rotation;
    out[2] = b.x; out[3] = b.y; out[4] = b.z;
    const n = ch.neck ? ch.neck.rotation : null;
    out[5] = n ? n.x : 0; out[6] = n ? n.y : 0; out[7] = n ? n.z : 0;
    const P = ch.parts, L = ch.low || {};
    out[8] = P.rl.rotation.x; out[9] = P.rl.rotation.z; out[10] = L.rl ? L.rl.rotation.x : 0;
    out[11] = P.ll.rotation.x; out[12] = P.ll.rotation.z; out[13] = L.ll ? L.ll.rotation.x : 0;
    out[14] = P.la.rotation.x; out[15] = P.la.rotation.z; out[16] = L.la ? L.la.rotation.x : 0;
    out[17] = P.ra.rotation.x; out[18] = -P.ra.rotation.z; out[19] = L.ra ? L.ra.rotation.x : 0;
  }
  // keys store the RIGHT-side arm/leg abduction as "+ = out"; the rig's right
  // limbs abduct with negative z (and the left leg is parts.rl, the right ll)
  function mirrorInto(src, side, out) {
    if (side >= 0) { for (let i = 0; i < CH; i++) out[i] = src[i]; return out; }
    out[0] = src[0]; out[1] = src[1]; out[2] = src[2]; out[3] = -src[3]; out[4] = -src[4];
    out[5] = src[5]; out[6] = -src[6]; out[7] = -src[7];
    out[8] = src[11]; out[9] = src[12]; out[10] = src[13];
    out[11] = src[8]; out[12] = src[9]; out[13] = src[10];
    out[14] = src[17]; out[15] = src[18]; out[16] = src[19];
    out[17] = src[14]; out[18] = src[15]; out[19] = src[16];
    return out;
  }
  const KA = new Float32Array(CH), KB = new Float32Array(CH);
  function writePose(ch, v, w) {
    // model
    setModel(ch, lerp(-(ch._mMy || 0) / dims(ch).scale, v[0], w), lerp((ch._mMz || 0) / dims(ch).scale, v[1], w), (ch._mMx || 0) / dims(ch).scale * (1 - w), (ch._mMr || 0) * (1 - w));
    const b = ch.body.rotation;
    b.x = lerp(b.x, v[2], w); b.y = lerp(b.y, v[3], w); b.z = lerp(b.z, v[4], w);
    if (ch.neck) { const n = ch.neck.rotation; n.x = lerp(n.x, v[5], w); n.y = lerp(n.y, v[6], w); n.z = lerp(n.z, v[7], w); }
    const P = ch.parts, L = ch.low || {};
    limb(P.rl, L.rl, v[8], v[9], v[10], w, false);
    limb(P.ll, L.ll, v[11], -v[12], v[13], w, false);
    limb(P.la, L.la, v[14], v[15], v[16], w, true);
    limb(P.ra, L.ra, v[17], -v[18], v[19], w, true);
    if (w > 0.5) { P.la.position.z = lerp(P.la.position.z, 0, w); P.ra.position.z = lerp(P.ra.position.z, 0, w); }
  }
  function limb(part, low, x, z, j, w, arm) {
    if (!part) return;
    const r = part.rotation;
    r.set(lerp(r.x, x, w), r.y * (1 - w), lerp(r.z, z, w));
    part.scale.y = lerp(part.scale.y, 1, w);
    if (low) {
      const lr = low.rotation;
      lr.set(lerp(lr.x, arm ? Math.min(0, j) : Math.max(0, j), w), lr.y * (1 - w), lr.z * (1 - w));
    }
  }

  /* ch.fall = { on, t, dur, dirF (+1 backward / -1 forward), side (+1/-1),
                 phase "fall"|"down"|"getup", getup "roll"|"push"|"knee",
                 ko, variant "back"|"face"|"liver", hold, gt (getup clock) } */
  MP.startFall = function (ch, o) {
    o = o || {};
    let f = ch.fall;
    if (!f || typeof f !== "object") f = ch.fall = {};
    const variant = FALLS[o.variant] ? o.variant : ((o.dirF != null ? o.dirF : 1) < 0 ? "face" : "back");
    f.on = true; f.t = 0; f.gt = 0; f.variant = variant;
    f.dirF = variant === "face" ? -1 : 1;
    f.side = o.side < 0 ? -1 : 1;
    f.ko = o.ko !== false;
    f.dur = o.dur != null ? o.dur : 2.0;
    f.hold = !!o.hold;
    f.phase = "fall";
    f.getup = fallRow(variant).getup;
    // the fall owns the whole body: every strike and reaction on it ends
    ch.punchT = 0; ch.kickT = 0; ch.blockT = 0; ch.dodgeT = 0;
    if (ch.hitReact) ch.hitReact.on = false;
    if (ch.footStep) ch.footStep.on = false;
    return f;
  };
  MP.getUp = function (ch) {
    const f = ch.fall;
    if (!f || !f.on) return false;
    if (f.phase === "getup") return true;
    f.hold = false;
    f.phase = "getup"; f.gt = 0;
    return true;
  };
  MP.fallTimes = function (variant) {
    const F = fallRow(variant), fall = SEQ[F.fall], up = SEQ[F.up];
    return { fall: fall[fall.length - 1][1], getup: up[up.length - 1][1], delay: F.delay };
  };
  function seqSample(ch, seq, t, side, cur, out) {
    const keys = keysOf(ch);
    let t0 = 0;
    for (let i = 0; i < seq.length; i++) {
      const t1 = seq[i][1];
      if (t <= t1 || i === seq.length - 1) {
        const u = sstep(t0, t1, t);
        const a = i === 0 ? cur : mirrorInto(keys[seq[i - 1][0]], side, KA);
        const bName = seq[i][0];
        const bk = bName ? mirrorInto(keys[bName], side, KB) : cur;
        for (let c = 0; c < CH; c++) out[c] = lerp(a[c], bk[c], u);
        return seq[i][0] ? 1 : 1 - u;
      }
      t0 = t1;
    }
    return 1;
  }

  /* ---- TAKING IT ON THE FLOOR (ch.gHit = { on, t, lx, amt }) -------------
     A man punched where he lies has nowhere for his head to go: it turns off
     the blow, hits the floor and comes back, and the whole body jolts. A
     conscious man's arms come up over his face and stay there a while (he
     covers, the way every fighter does under ground and pound); a man out
     cold just takes it. Written over the lying key each frame, never stored. */
  function groundHit(ch, f, mdt) {
    const g = ch.gHit;
    if (!g) return;
    if (g.on) { g.t += mdt; if (g.t > 1.6) g.on = false; }
    const t = g.on ? g.t : 9;
    const h = impulse(t, 0.035, 9) * (g.amt || 1);
    const back = f.variant !== "face";
    if (ch.neck && h) {
      ch.neck.rotation.y += g.lx * 0.70 * h;                   // turned by it
      ch.neck.rotation.x += (back ? -0.22 : 0.18) * Math.abs(h); // into the floor and back up
    }
    ch.body.rotation.x += (back ? 0.05 : -0.05) * Math.abs(h);
    // covering up: decays over a second and a half after the last one
    const cover = f.ko ? 0 : clamp01(1.6 - t) * Math.min(1, t * 12);
    if (cover > 0) {
      const P = ch.parts, L = ch.low || {};
      if (P.la) { P.la.rotation.x = lerp(P.la.rotation.x, -2.3, cover); P.la.rotation.z = lerp(P.la.rotation.z, 0.25, cover); }
      if (P.ra) { P.ra.rotation.x = lerp(P.ra.rotation.x, -2.3, cover); P.ra.rotation.z = lerp(P.ra.rotation.z, -0.25, cover); }
      if (L.la) L.la.rotation.x = lerp(L.la.rotation.x, -2.1, cover);
      if (L.ra) L.ra.rotation.x = lerp(L.ra.rotation.x, -2.1, cover);
    }
  }
  MP.groundHit = function (ch, lx, amt) {
    let g = ch.gHit;
    if (!g) g = ch.gHit = { on: false, t: 0, lx: 0, amt: 1 };
    g.on = true; g.t = 0; g.lx = lx < 0 ? -1 : 1; g.amt = amt == null ? 1 : amt;
  };

  /* ============================================================
     HOOK 2 — MP.react: falls, the head snap, the taser. Runs LAST.
     ============================================================ */
  MP.react = function (ch, dt, moving, J) {
    const mdt = ch._mdt != null ? ch._mdt : dt;
    ch._mdt = null;
    // LEGACY KO (boxing / arena): koT/koPose drive the same real fall
    if ((ch.koT > 0 || ch.koPose) && !(ch.fall && ch.fall.on && ch.fall.legacy)) {
      MP.startFall(ch, { dirF: 1, side: (ch.phase || 0) % 2 < 1 ? 1 : -1, ko: true, hold: true });
      ch.fall.legacy = true;
    }
    if (ch.koT > 0) ch.koT -= mdt;
    const f = ch.fall;
    if (f && f.on) {
      if (f.legacy && !ch.koPose && !(ch.koT > 0) && f.phase !== "getup") MP.getUp(ch);
      const variant = f.variant;
      const side = f.side;
      readCur(ch, CUR);
      let w = 1;
      const FR = fallRow(variant);
      if (f.phase === "fall") {
        f.t += mdt;
        const seq = SEQ[f.ko ? FR.fall : FR.fallC];
        // the liver: a beat where nothing happens yet, then the fold
        const tt = Math.max(0, f.t - FR.delay);
        w = seqSample(ch, seq, tt, side, CUR, OUT);
        if (tt >= seq[seq.length - 1][1]) { f.phase = "down"; f.t = 0; }
      } else if (f.phase === "down") {
        f.t += mdt;
        const key = keysOf(ch)[f.ko ? FR.lie : FR.lieC];
        mirrorInto(key, side, OUT);
        OUT[2] += (variant === "face" ? -1 : 1) * 0.025 * Math.sin(ch.breath * 2.4);   // he is still breathing
        if (!f.hold && f.t >= f.dur) { f.phase = "getup"; f.gt = 0; }
      } else {
        f.gt += mdt;
        const seq = SEQ[FR.up];
        // the first get-up segment starts from the lying key, not the live base
        const lie = keysOf(ch)[f.ko ? FR.lie : FR.lieC];
        mirrorInto(lie, side, MIR);
        w = seqSample(ch, seq, f.gt, side, MIR, OUT);
        // the final segment returns to the live standing base: blend by w
        if (f.gt >= seq[seq.length - 1][1]) { f.on = false; f.phase = ""; w = 0; }   // "" = standing (CORE's down() reads phase)
        if (seq[seq.length - 1][0] === null && f.gt > seq[seq.length - 2][1]) {
          // OUT currently = lerp(rise, MIR); rebuild as lerp(rise, CUR) so the
          // hand-back lands on the real standing pose
          const keys = keysOf(ch);
          mirrorInto(keys[seq[seq.length - 2][0]], side, KA);
          for (let c = 0; c < CH; c++) OUT[c] = KA[c];
          w = 1 - sstep(seq[seq.length - 2][1], seq[seq.length - 1][1], f.gt);
        }
      }
      if (f.on || w > 0) writePose(ch, OUT, f.on ? w : 0);
      if (!f.on) { setModel(ch, 0, 0, 0, 0); }
      if (f.on && f.phase === "down") groundHit(ch, f, mdt);
    }

    // ---- HEAD SNAP: additive, backed out next frame by MP.strike ----
    const hr = ch.hitReact;
    if (hr && hr.on && ch.neck && !(f && f.on)) {
      const amt = hr.amt == null ? 1 : hr.amt, t = hr.t;
      const lx = hr.lx || 0, lz = hr.lz == null ? -1 : hr.lz;
      let ox = 0, oy = 0, oz = 0;
      if (hr.kind === "snap") {
        const h = impulse(t, 0.045, 6.5) * amt;
        if (hr.blow === "hook") { oy = lx * 0.80 * h; oz = -lx * 0.26 * h; ox = -0.10 * h; }
        else if (hr.blow === "upper") { ox = -0.90 * h; oz = -lx * 0.10 * h; }
        else { ox = lz * 0.60 * h; oy = lx * 0.30 * h; }       // a straight drives the head back along the line
      } else if (hr.kind === "fold") {
        ox = 0.25 * sstep(0, 0.08, t) * (1 - sstep(0.3, hr.dur, t)) * amt;
      } else if (hr.kind === "stagger") {
        const s = sstep(0, 0.05, t) * (1 - sstep(0.2, hr.dur, t));
        ox = lz * 0.35 * s * amt; oy = lx * 0.2 * s * amt;
      }
      if (ox || oy || oz) {
        ch.neck.rotation.x += ox; ch.neck.rotation.y += oy; ch.neck.rotation.z += oz;
        ch._rNx = ox; ch._rNy = oy; ch._rNz = oz;
      }
    }

    // ---- TASER CONTACT: a short involuntary whole-body lock over whatever
    // pose owns the actor. systems/taserfx.js raises only this timer. ----
    if (ch.taserT > 0) {
      const td = Math.max(0.18, ch.taserDur || 0.72);
      ch.taserT = Math.max(0, ch.taserT - dt);
      const strength = Math.min(1, ch.taserT / Math.min(0.16, td));
      const buzz = Math.sin((td - ch.taserT) * 92) * strength;
      ch.body.rotation.x -= 0.14 * strength;
      ch.body.rotation.z += buzz * 0.055;
      if (ch.parts.la) { ch.parts.la.rotation.x -= 0.38 * strength; ch.parts.la.rotation.z += 0.42 * strength + buzz * 0.05; }
      if (ch.parts.ra) { ch.parts.ra.rotation.x -= 0.42 * strength; ch.parts.ra.rotation.z -= 0.44 * strength + buzz * 0.05; }
      if (J.la) J.la.rotation.x -= 0.50 * strength;
      if (J.ra) J.ra.rotation.x -= 0.54 * strength;
      if (ch.parts.ll) ch.parts.ll.rotation.x -= 0.18 * strength + buzz * 0.025;
      if (ch.parts.rl) ch.parts.rl.rotation.x += 0.16 * strength - buzz * 0.025;
      if (ch.neck) { ch.neck.rotation.x -= 0.16 * strength; ch.neck.rotation.z -= buzz * 0.065; }
    }
  };

  /* ============================================================
     WHERE A BODY CAN BE HIT, AND WHAT HITS IT — world-space geometry read
     off the live rig (call after it is posed; matrices are refreshed here).
       head {c, r}, jaw {c, r}, liver {c, r},
       chest: two capsules (left/right half of the torso) cA..cB / dA..dB, r
       legs: thigh capsules lA..lB (his left), rA..rB (his right), r
       forearms: fL (elbow) → wL (wrist), fR → wR, r   (what a guard blocks with)
     ============================================================ */
  MP.newZones = function () {
    const V = () => new THREE.Vector3();
    return {
      head: { c: V(), r: 0 }, jaw: { c: V(), r: 0 }, liver: { c: V(), r: 0 }, belly: { c: V(), r: 0 },
      cA: V(), cB: V(), dA: V(), dB: V(), chestR: 0,
      lA: V(), lB: V(), rA: V(), rB: V(), legR: 0,
      fL: V(), wL: V(), fR: V(), wR: V(), armR: 0, scale: 1,
    };
  };
  MP.zones = function (ch, Z) {
    const D = dims(ch);
    ch.group.updateMatrixWorld(true);
    const s = ch.body.matrixWorld.getMaxScaleOnAxis() || D.scale;
    Z.scale = s;
    const hs = D.hs;
    if (ch.head) {
      ch.head.getWorldPosition(Z.head.c);
      Z.jaw.c.set(0, -0.32 * hs, 0.30 * hs); ch.head.localToWorld(Z.jaw.c);
    } else {
      Z.head.c.set(0, D.headY, 0); ch.body.localToWorld(Z.head.c);
      Z.jaw.c.set(0, D.chinY, 0.2); ch.body.localToWorld(Z.jaw.c);
    }
    Z.head.r = 0.47 * hs * s; Z.jaw.r = 0.20 * hs * s;
    const x = Math.max(0, D.torsoW * 0.5 - D.torsoD * 0.5);
    Z.cA.set(x, D.hipY + 0.10, 0); ch.body.localToWorld(Z.cA);
    Z.cB.set(x, D.shY - 0.12, 0); ch.body.localToWorld(Z.cB);
    Z.dA.set(-x, D.hipY + 0.10, 0); ch.body.localToWorld(Z.dA);
    Z.dB.set(-x, D.shY - 0.12, 0); ch.body.localToWorld(Z.dB);
    Z.chestR = D.torsoD * 0.5 * s;
    // the liver sits under his right lower ribs (his right = -X)
    Z.liver.c.set(-D.torsoW * 0.30, D.hipY + 0.26, D.torsoD * 0.22); ch.body.localToWorld(Z.liver.c);
    Z.liver.r = 0.17 * s;
    // the solar plexus / belly: where a straight to the body goes
    Z.belly.c.set(0, D.hipY + 0.36, D.torsoD * 0.30); ch.body.localToWorld(Z.belly.c);
    Z.belly.r = 0.16 * s;
    ch.parts.rl.getWorldPosition(Z.lA); ch.low.rl.getWorldPosition(Z.lB);
    ch.parts.ll.getWorldPosition(Z.rA); ch.low.ll.getWorldPosition(Z.rB);
    Z.legR = D.legW * 0.5 * s;
    ch.low.la.getWorldPosition(Z.fL); ch.sockets.leftHand.getWorldPosition(Z.wL);
    ch.low.ra.getWorldPosition(Z.fR); ch.sockets.rightHand.getWorldPosition(Z.wR);
    Z.armR = D.armW * 0.55 * s;
    return Z;
  };
  // the striking surface of a blow, world space (refreshes its own chain:
  // call after the rig is posed this frame)
  function at(obj, out) { obj.updateWorldMatrix(true, false); return out.applyMatrix4(obj.matrixWorld); }
  MP.strikePoint = function (ch, kind, arm, out) {
    const D = dims(ch);
    const L = arm === "l";
    if (MP.isKick(kind)) {
      const leg = L ? ch.parts.rl : ch.parts.ll, low = leg && leg.userData.low;
      const kk = kickKey(kind === "lowKick" ? "low" : kind);
      if (kk === "knee") out.set(0, 0, D.legW * 0.4);
      else if (kk === "front") out.set(0, -D.g2 + 0.02, 0.10);
      else out.set(0, -D.g2 * 0.72, 0.06);                      // the shin
      return at(low, out);
    }
    const k = kindKey(kind);
    if (k === "headbutt") { out.set(0, 0.08 * D.hs, 0.5 * D.hs); return at(ch.head, out); }
    if (k === "elbow" || k === "gnpElbow") {
      out.set(0, 0.02, -0.08);
      return at(L ? ch.low.la : ch.low.ra, out);
    }
    out.set(0, k === "stab" ? -0.16 : -0.02, 0.02);
    return at(L ? ch.sockets.leftHand : ch.sockets.rightHand, out);
  };
})();
