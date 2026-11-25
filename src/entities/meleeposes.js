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
     animFists runs MP.drive off the same punchT/punchDur). The fist is fully
     out at prog 0.43 in both views.
     THE LIMB IS NOT A SINE. A half sine leaves the guard at its top speed and
     is slowest where it lands: a punch that floats into the man. A real one
     is the other way round: it starts from rest, is still accelerating at
     full reach, snaps back as fast as it went out, and then settles into the
     guard slowly. And the body goes first: hips and shoulders are half way
     round when the arm is a fifth of the way out (bodyOf), and they hold a
     moment after the fist has gone before they come back. */
  // bounce: where a blocked arm's clock is put (it comes off the guard, it does not hang on it)
  const BEAT = MP.BEAT = { driveStart: 0.16, driveLen: 0.54, impact: 0.43, recover: 0.62, bounce: 0.50 };
  const OUT_LEN = BEAT.impact - BEAT.driveStart, BACK_LEN = 0.39;
  function limbOf(u, r) {            // u: 0..1 going out, r: 0..1 coming back
    if (u < 1) return u <= 0 ? 0 : u * u * (1.5 - 0.5 * u);
    if (r >= 1) return 0;
    const q = 1 - r;
    return q * q * (0.25 + 0.75 * q);
  }
  function driveOf(p) { return limbOf((p - BEAT.driveStart) / OUT_LEN, (p - BEAT.impact) / BACK_LEN); }
  MP.drive = driveOf;
  // the hips and shoulders: under way before the arm, home after it
  function bodyOf(p) { return sstep(0.08, BEAT.impact, p) * (1 - sstep(0.50, 0.94, p)); }
  MP.bodyDrive = bodyOf;
  // kicks: chamber first, so the foot arrives a touch later in the timer
  const KICK_START = 0.22, KICK_LEN = 0.50, KICK_OUT = 0.25, KICK_BACK = 0.30;
  function kickDriveOf(p) { return limbOf((p - KICK_START) / KICK_OUT, (p - KICK_START - KICK_OUT) / KICK_BACK); }
  MP.kickDrive = kickDriveOf;
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
    hook:         { dur: 0.42, hand: "lead", path: "hook", level: "head", hip: 0.86, wind: 0.26, fwd: 0.03, lean: 0.03, pro: 0.04, roll: 0.25, pivot: 1, ext: -1.30 },
    upper:        { dur: 0.42, hand: "rear", path: "upper", level: "head", hip: 0.44, wind: 0.14, fwd: 0.05, lean: 0.0, pro: 0.05, roll: -0.35, dip: 0.16, heel: 1, ext: -1.0 },
    body:         { dur: 0.44, hand: "lead", path: "hook", level: "body", hip: 0.78, wind: 0.22, fwd: 0.04, lean: 0.24, pro: 0.04, roll: 0.25, dip: 0.20, pivot: 1, ext: -1.15 },
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
    // WEAPONS IN THE HAND (systems/melee.js picks them off what is held).
    // bat: both hands on the handle, loaded behind the rear ear, the hips and
    // shoulders sling it flat through his head (path "swing"); slash: a blade
    // drawn across on a short fast hook; butt: the rifle's stock driven
    // straight out off the rear hip with the whole body behind it.
    bat:          { dur: 0.58, hand: "rear", path: "swing", level: "head", hip: 1.05, wind: 0.50, fwd: 0.10, lean: 0.08, pro: 0.06, roll: 0.20, heel: 1, pivot: 1, ext: -0.30 },
    slash:        { dur: 0.32, hand: "rear", path: "hook", level: "head", hip: 0.55, wind: 0.22, fwd: 0.06, lean: 0.04, pro: 0.06, roll: 0.60, ext: -0.35 },
    butt:         { dur: 0.44, hand: "rear", path: "straight", level: "head", hip: 0.62, wind: 0.18, fwd: 0.16, lean: 0.14, pro: 0.14, roll: 0, heel: 1 },
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
    // at a man on the floor (systems/verbs_strike.js V.groundKick; level
    // "floor" = his trunk where it lies)
    stomp:  { dur: 0.72, leg: "rear", level: "floor" },
    soccer: { dur: 0.62, leg: "rear", level: "floor" },
  };
  function kickKey(k) { return k === "round" || k === "roundKick" ? "round" : k === "low" ? "low" : k === "knee" ? "knee" : k === "stomp" ? "stomp" : k === "soccer" ? "soccer" : "front"; }
  MP.kickKey = kickKey;
  MP.durOf = function (kind, heavy) {
    const kk = KICK[kind] ? KICK[kind] : (kind === "kick" || kind === "roundKick") ? KICK[kickKey(kind)] : KIND[kindKey(kind)];
    return kk.dur * (heavy ? 1.15 : 1);
  };
  MP.isKick = function (kind) { return kind === "kick" || kind === "roundKick" || kind === "knee" || kind === "front" || kind === "round" || kind === "low" || kind === "lowKick" || kind === "stomp" || kind === "soccer"; };
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
    // the DRAWN head (character.js HEAD_DRAW scales the neck pivot)
    const hk = P.headK || 1, hs = (P.headSize || 0.6) * hk;
    const headY = (ch.neck ? ch.neck.position.y : hipY + 0.93) + (ch.head ? ch.head.position.y * hk : 0.3);
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
    // last frame this layer solved the legs, or read the gait's feet (see _mFt)
    const hadFeet = !!(ch._mOwn || ch._mFtS);
    ch._mOwn = ch._mFtS = false;
    // back out last frame's additive head-snap offsets (added by MP.react)
    if (ch._rNx || ch._rNy || ch._rNz) {
      if (ch.neck) { ch.neck.rotation.x -= ch._rNx; ch.neck.rotation.y -= ch._rNy; ch.neck.rotation.z -= ch._rNz; }
      ch._rNx = ch._rNy = ch._rNz = 0;
    }
    // ...and last frame's PASSIVE neck counter-turn (see APPLY): the neck's
    // yaw is a channel nothing else re-anchors, so this layer must read the
    // clean neck, never its own previous write
    if (ch._mPnx || ch._mPny) {
      if (ch.neck) { ch.neck.rotation.x -= ch._mPnx; ch.neck.rotation.y -= ch._mPny; }
      ch._mPnx = ch._mPny = 0;
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

    /* HANDS BEHIND THE BACK IS NOT A BODY THAT CANNOT MOVE. `cuffed` used to
       switch this whole layer off, so the kick and the headbutt a cuffed man
       is allowed (combat.js picks them) set their clocks, drew nothing and,
       with no foot or forehead ever reaching anybody, never landed: the
       button did nothing you could see. A cuffed man who is striking gets
       the layer for his legs, hips, torso and head; his ARMS stay where the
       cuffs hold them (armK below). Standing in cuffs is still no stance. */
    const cuffStrike = !!ch.cuffed && (punching || kicking) && !ch.verbHold;
    const hard = ch.surrender || ch.handsUp || (ch.cuffed && !cuffStrike) || ch.verbHold || fallActive(ch);
    /* THE HANDS STAY UP BETWEEN BLOWS. A body nobody had told to guard (the
       player: his fightStance is only the held block) squared up for the
       0.3 s of each punch and dropped out of it again before the next: fists
       to the chin and down to the thighs, feet apart and together, once per
       tap. A man who has just thrown, or just been hit in a fight he is in,
       keeps his guard for the same 2.5 s the first-person fists keep theirs
       (fpsmode guardHold). Walking off drops it in under a second. */
    if (((punching && ch.punchKind !== "shove") || kicking) && !ch.cuffed) ch._mHold = 2.5;   // (a shove is not a fight)
    else if (ch._mHold > 0) {
      if (hr && hr.on && !hr.shot && hr.t < 0.1) ch._mHold = 2.5;
      ch._mHold -= dt * (moving && (ch._mMv || 0) > 0.9 ? 4 : 1);
    }
    const held = ch._mHold > 0 && !ch.cuffed;
    const stanceOK = (ch.fightStance || held) && !ch.aimingPose && !ch.carryPose && !ch.bladeCarry;
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
    const fighting = ch.fightStance || held || punching || kicking || ch.blockT > 0 || ch.blockK > 0 || dodging || mounted;
    if (fighting) ch._mPas = false;
    else if (!(ch._mK > 0.01)) ch._mPas = true;
    const passive = !!ch._mPas;
    const want = !hard && (act || stanceOK) ? 1 : 0;
    /* THE STANCE'S FEET ARE PLANTED FEET. This layer used to hold both feet
       at fixed spots in the body's own frame, so every turn to keep facing
       the other man swung them round on the floor like a compass, and
       squaring up or standing down slid them 20 cm apart and together. The
       spots are now where entities/gait.js plants and re-steps the feet
       (ch._gSt: the lead side's sign; 0 = stand normally): turning or
       drifting in the stance is taken in steps, a foot at a time. The leg
       solve below only runs when the gait cannot have the legs (a kick, a
       footwork step, the mount, a rig with no gait). */
    ch._gSt = want && !passive && !mounted && !ch.cuffed && (ch.fightStance || held) ? (ch.southpaw ? -1 : 1) : 0;
    ch._gHeel0 = ch._gHeel1 = ch._gTurn0 = ch._gTurn1 = 0;
    if (want && hr && hr.on && hr.t < 0.05) ch._mK = Math.max(ch._mK || 0, 0.85);   // a hit does not fade in
    ch._mK = damp(ch._mK || 0, want, want ? 16 : 7, dt);
    ch._mMv = damp(ch._mMv || 0, moving ? 1 : 0, 9, dt);
    // THE HANDS CLOSE. A guard and a punch are fists (a shove is two open
    // palms); when the fight is over they open back to the relaxed hang. An
    // armed hand belongs to the weapon code, so a carried gun or blade is
    // never touched here.
    if (typeof ch.setHandPose === "function") {
      const armed = ch.aimingPose || ch.carryPose || ch.bladeCarry;
      const hand = hard || ch.cuffed || passive || ch._mK < 0.25 ? null : (punching && ch.punchKind === "shove") ? "open" : "fist";
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
    // (the same spots gait.js plants: STANCE there)
    leadF.set(lx * (D.hipX + 0.03), D.footY, 0.30);
    rearF.set(-lx * (D.hipX + 0.10), D.footY + 0.025, -0.30);
    if (lx > 0) ch._gHeel0 = 0.10; else ch._gHeel1 = 0.10;      // the rear heel is light
    QL.set(0.25, 0.1, 1); QR.set(-0.25, 0.1, 1);                 // knees track over the toes
    }
    /* THE FEET START WHERE THEY STAND. When this layer takes the legs (a
       kick, a footwork step) it used to put both feet on its own spots at
       once: a man kicking from a square stand had his plant foot slide 20 cm
       forward under him during the chamber. While the gait has the legs its
       planted feet are sampled here every frame (group frame, rig units),
       and those are the spots this layer works from when it takes over; the
       gait takes them back where this layer leaves them (gait.js plantInit
       reads _mFt while _mOwn) and steps them home. */
    const GV = ch._gv;
    const FT = ch._mFt || (ch._mFt = new Float32Array(4));       // [Lx, Lz, Rx, Rz], made once per rig
    // (GV.adopt: the gait has already let go to this layer, its plants are void)
    if (CBZ.gait && ch._gOn && GV && GV.init && GV.w > 0.5 && !GV.adopt && ch.group) {
      const g = ch.group, yaw = g.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw), inv = 1 / D.scale;
      for (let i = 0; i < 2; i++) {
        const F = GV.feet[i];
        const dx = (F.sw ? F.tx : F.x) - g.position.x - (GV.ox || 0), dz = (F.sw ? F.tz : F.z) - g.position.z - (GV.oz || 0);
        const o = i ? 0 : 2;                                      // gait foot 1 is the leg on +X ("L" here)
        FT[o] = (dx * c - dz * sn) * inv; FT[o + 1] = (dx * sn + dz * c) * inv;
      }
      ch._mFtV = ch._mFtS = true;
    } else if (!hadFeet) ch._mFtV = false;
    /* ...AND THEY STAY THERE WHEN THE ROOT TURNS. The spots are kept in the
       body's frame, so a root turning while this layer has the legs (the
       turn to face a man now takes the wind-up, systems/verbs_strike.js)
       swung both feet round with it like the legs of a compass. The turn is
       taken back out of them: they stay where they are on the floor and
       the body turns over them; the gait steps them round afterward. */
    {
      const gyaw = ch.group ? ch.group.rotation.y : 0;
      if (ch._mFtV && !ch._mFtS && hadFeet && ch._mYawP != null) {
        let da = (gyaw - ch._mYawP) % (Math.PI * 2);
        if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
        if (da && Math.abs(da) < 1.2) {
          const c = Math.cos(da), sn = Math.sin(da);
          for (let o = 0; o < 4; o += 2) {
            const lx = FT[o], lz = FT[o + 1];
            FT[o] = lx * c - lz * sn; FT[o + 1] = lx * sn + lz * c;
          }
        }
      }
      ch._mYawP = gyaw;
    }
    /* THE STANDING FOOT OF A KICK IS A SPOT ON THE FLOOR, not a spot under
       the body. The feet above are kept in the body's frame, so anything
       that moved or turned the root while the leg was out (the last of a
       walk the kick was thrown from, a shove, the turn to face him) dragged
       the one foot that was on the ground along with it. While a kick has
       the legs and no footwork step is moving the root on purpose, the
       plant foot is held where it stands in the world and the hips ride
       over it; a root that has gone further than the leg can stand on
       drags it (that is a slide, and it is one). */
    const PLn = ch._mPl || (ch._mPl = { on: false, x: 0, z: 0, n: -1, at: 0 });
    if (ch.kickT > 0 && ch._mFtV && ch.group && !(fs && fs.on)) {
      const g = ch.group, yaw = g.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw);
      const o = ch.kickLeg === "l" ? 2 : 0;                       // kicking with the +X leg: the -X foot stands
      // (a spot kept from another kick, or from before this rig sat out some
      // frames on the floor, is not this kick's foot)
      const nowMs = CBZ.now || 0, swingN = ch._mSwingN || 0;
      if (PLn.n !== swingN || Math.abs(nowMs - PLn.at) > 250) PLn.on = false;
      PLn.n = swingN; PLn.at = nowMs;
      if (!PLn.on) {
        PLn.on = true;
        PLn.x = g.position.x + (FT[o] * c + FT[o + 1] * sn) * D.scale;
        PLn.z = g.position.z + (-FT[o] * sn + FT[o + 1] * c) * D.scale;
      } else {
        const dx = PLn.x - g.position.x, dz = PLn.z - g.position.z;
        let px = (dx * c - dz * sn) / D.scale, pz = (dx * sn + dz * c) / D.scale;
        const far = Math.hypot(px, pz), lim = 0.62 * (D.g1 + D.g2);
        if (far > lim) {
          px *= lim / far; pz *= lim / far;
          PLn.x = g.position.x + (px * c + pz * sn) * D.scale;
          PLn.z = g.position.z + (-px * sn + pz * c) * D.scale;
        }
        FT[o] = px; FT[o + 1] = pz;
      }
    } else PLn.on = false;
    /* ...AND NEVER IN ANOTHER MAN. The spots this layer holds (a kick's
       standing foot, where a lunge or a stagger step comes down) are tested
       against the drawn parts of whoever is near (CBZ.bodyParts) and moved
       to the nearest free floor: the kicker stood in the arm of the man he
       was stomping. */
    const BPm = CBZ.bodyParts;
    if (BPm && ch._mFtV && !ch._mFtS && ch.group && BPm.near(ch)) {
      const g = ch.group, yaw = g.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw);
      for (let o = 0; o < 4; o += 2) {
        const wx = g.position.x + (FT[o] * c + FT[o + 1] * sn) * D.scale, wz = g.position.z + (-FT[o] * sn + FT[o + 1] * c) * D.scale;
        if (!BPm.footSpot(ch, wx, g.position.y, wz, yaw, _bfs)) continue;
        const dx = _bfs.x - g.position.x, dz = _bfs.z - g.position.z;
        FT[o] = (dx * c - dz * sn) / D.scale; FT[o + 1] = (dx * sn + dz * c) / D.scale;
        if (PLn.on && o === (ch.kickLeg === "l" ? 2 : 0)) { PLn.x = _bfs.x; PLn.z = _bfs.z; }
        BPm.count("feet");
      }
    }
    if (ch._mFtV) { FL.x = FT[0]; FL.z = FT[1]; FR.x = FT[2]; FR.z = FT[3]; }
    else { FT[0] = FL.x; FT[1] = FL.z; FT[2] = FR.x; FT[3] = FR.z; }   // nobody had them: this layer's own spots
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
      // db: the body's share (feet, hips, shoulders), ahead of the arm
      const db = bodyOf(p);
      const w = sstep(0, 0.14, p) * (1 - sstep(0.14, 0.34, p));
      const lvl = sstep(0, 0.30, p) * (1 - sstep(0.66, 1, p));
      const both = k.hand === "both";
      const side = ch.punchArm === "l" ? "L" : "R";
      const sx = side === "L" ? 1 : -1, byDir = -sx;
      aimSide = side;
      // ---- from the ground up ----
      S.by += byDir * (k.hip * db - k.wind * w);
      if (both) S.by = lerp(S.by, 0, Math.max(w, db));            // two hands square the shoulders
      S.mZ += k.fwd * db;                                         // weight rolls onto the lead leg
      if (k.level === "ground") {
        // from the mount the hips drive forward and down into him: a punch
        // posts the weight over his face, the elbow DIVES the whole torso on him
        const dive = k.path === "groundElbow";
        S.mZ += (dive ? 0.40 : 0.12) * db;
        S.dl += (dive ? 0.0 : 0.04) * db;
      }
      if (k.path === "upper") {
        const dip = sstep(0, 0.20, p) * (1 - sstep(0.20, 0.46, p));
        S.dl += (k.dip || 0) * dip - 0.05 * db;                   // sink, then drive up through the legs
        S.bx += 0.14 * dip - 0.06 * db;
        S.bz += -sx * 0.10 * dip;                                 // the punching shoulder drops to load
      } else if (k.dip) {
        S.dl += k.dip * lvl;                                      // level change: the fist goes to rib height
        S.bx += k.lean * lvl;
        S.bz += -sx * 0.16 * lvl * (k.path === "hook" ? 1 : 0.4);
      } else {
        S.bx += k.lean * db;
      }
      if (k.path === "clinch") {                                  // headbutt: cock back, then through him
        S.bx += -0.36 * sstep(0, 0.25, p) * (1 - d) + 0.50 * d;
        S.nx += -0.45 * sstep(0, 0.25, p) * (1 - d) + 0.70 * d;
      }
      if (k.path === "shove") S.bx += -0.14 * w;                  // rock back before the push
      // rear heel turns / lead foot pivots: heel up, knee turns in. A planted
      // foot does it on its own ball (entities/gait.js reads _gHeel/_gTurn:
      // 0 = the leg on -X, 1 = the leg on +X); the pole and the lift are for
      // a frame this layer solves the legs itself.
      if (k.heel) {
        rearF.y += 0.05 * db;
        (rear === "L" ? QL : QR).x = lerp((rear === "L" ? QL : QR).x, (rear === "L" ? -0.7 : 0.7), db);
        if (rear === "L") { ch._gHeel1 += 0.42 * db; ch._gTurn1 -= 0.55 * db; }
        else { ch._gHeel0 += 0.42 * db; ch._gTurn0 += 0.55 * db; }
      }
      if (k.pivot) {
        leadF.y += 0.03 * db;
        (lead === "L" ? QL : QR).x = lerp((lead === "L" ? QL : QR).x, (lead === "L" ? -0.8 : 0.8), db);
        if (lead === "L") { ch._gHeel1 += 0.30 * db; ch._gTurn1 -= 0.60 * db; }
        else { ch._gHeel0 += 0.30 * db; ch._gTurn0 += 0.60 * db; }
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
        O.z -= 0.05 * db * (k.hip > 0.5 ? 1 : 0.4);
        O.y += 0.02 * db;
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
      /* THE WEIGHT GOES ONTO THE STANDING LEG, THE STANDING FOOT STAYS PUT.
         The plant foot used to be dragged back under the hips while it bore
         the whole body (18 cm along the floor on the chamber, and out again
         on the way down). The hips travel over the foot instead: `over` is
         how far the plant foot is in front of them. */
      const plantF = kSide === "L" ? FR : FL;
      const plantZ = plantF.z;
      const over = plantZ * kch;
      /* ...AND SIDEWAYS OVER IT TOO. The hips stayed on the centre line, a
         hand's width inside the one foot that was on the floor: a man on one
         leg with his weight where there was no leg. They go across until
         the standing hip is over its foot (a round kick, whose trunk leans
         away over that foot as well, goes a little less far). */
      S.mX += plantF.x * (key === "round" || key === "low" ? 0.55 : 0.75) * kch;
      /* HE STANDS UP ON THE LEG HE STANDS ON. The stance's own crouch (7% of
         the hip height) plus a "soft knee" stayed on through the kick; with
         the hips brought over the foot there is nothing left for that drop
         to be but knee, and the standing knee was bent 50 degrees: a kick
         thrown from a half squat. A standing leg is all but straight (about
         15 to 20 degrees); a low kick sits into it a little more. */
      const standDl = key === "low" || key === "soccer" ? 0.05 : 0.025;
      S.dl = lerp(S.dl, standDl, kch);
      // the kicking-side hand and the other one (body frame)
      const kW = kSide === "L" ? WL : WR, oW = kSide === "L" ? WR : WL;
      const kP = kSide === "L" ? PL : PR;
      if (key === "front") {
        S.bx += -0.26 * ke + 0.06 * kch;                          // lean back as the foot drives out
        // over the plant foot, then the hips thrust through the teep (from a
        // square stand there is no foot in front to come over: the thrust is all of it)
        S.mZ += 0.75 * over + (0.08 + 0.5 * Math.max(0, 0.22 - 0.75 * plantZ)) * ke;
        // the hands stay home; the kicking side's drops a little to balance the leg
        kW.y -= 0.14 * ke; kW.x += sx * 0.08 * ke; kW.z -= 0.04 * ke;
      } else if (key === "round" || key === "low") {
        const high = key === "round";
        const turn = sstep(0.06, 0.42, kp) * (1 - sstep(0.72, 1, kp));
        const yaw = -sx * (high ? 1.05 : 0.70) * turn;            // the plant foot pivots, the hip turns over
        S.mYaw = yaw;
        // the shoulders stay behind the hips and the eyes stay on him: the
        // whole body used to turn as one block, face and all, 60 degrees off the man
        S.by += -0.40 * yaw; S.ny += -0.70 * yaw;
        S.bz += sx * (high ? 0.30 : 0.18) * ke;                   // counter-lean off the kicking side
        S.bx += (high ? -0.10 : -0.18) * ke;
        S.mZ += 0.75 * over + (0.06 + 0.5 * Math.max(0, 0.22 - 0.75 * plantZ)) * ke;
        // the arm on the kicking side swings down and back against the leg;
        // the other glove stays on the jaw
        _t.set(sx * 0.46, D.shY - 0.46, -0.16);
        kW.lerp(_t, (high ? 0.85 : 0.55) * ke);
        kP.lerp(_t2.set(sx * 0.5, -0.3, -1), ke);
        oW.x += sx * 0.05 * ke; oW.y += 0.03 * ke;
      } else if (key === "stomp") {
        /* THE STOMP: the knee comes up over him, he looks down at where it
           is going, and the heel is driven straight down with the body's
           weight dropping behind it (the standing knee gives as it lands).
           The arms come out and down: a man on one leg over a body. */
        S.bx += 0.14 * kch + 0.10 * ke;
        S.nx += 0.32 * kch;
        S.mZ += 0.75 * over + 0.04 * kch;
        S.dl += 0.05 * ke;
        kW.y -= 0.18 * kch; kW.x += sx * 0.16 * kch; kW.z += 0.04 * kch;
        oW.y -= 0.12 * kch; oW.x -= sx * 0.14 * kch;
      } else if (key === "soccer") {
        /* THE SOCCER KICK: the leg goes back from the hip with the knee
           folding (the trunk a little over him, the kicking side's
           shoulder forward), then swings through low and straightens into
           his side; the trunk rocks back off it and the shoulders turn
           against the leg, the opposite arm coming across. */
        const bsw = kch * (1 - ke);
        S.bx += 0.12 * bsw - 0.14 * ke;
        S.nx += 0.26 * kch;
        S.by += sx * (0.26 * ke - 0.16 * bsw);
        S.bz += sx * 0.08 * ke;
        S.mZ += 0.75 * over + 0.06 * ke;
        _t.set(sx * 0.44, D.shY - 0.44, -0.18);
        kW.lerp(_t, 0.7 * ke);
        kP.lerp(_t2.set(sx * 0.5, -0.3, -1), ke);
        oW.x += sx * 0.10 * ke; oW.z += 0.10 * ke; oW.y -= 0.06 * ke;
      } else {                                                    // knee: curl over it, rise onto the plant toe
        S.bx += 0.24 * ke;
        S.dl += -0.02 * ke;                                       // (the standing leg is nearly straight already: see standDl)
        S.mZ += 0.5 * over + 0.10 * ke;
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
      // (a step given as a line on the floor, fs.world, is read in the body's
      // frame as it is THIS frame: the root may be turning while it steps)
      let stx = fs.x, stz = fs.z;
      if (fs.world && ch.group) {
        const gy = ch.group.rotation.y, c = Math.cos(gy), sn = Math.sin(gy);
        stx = fs.wx * c - fs.wz * sn; stz = fs.wx * sn + fs.wz * c;
      }
      first.x += stx * (s1 - sr); first.z += stz * (s1 - sr); first.y += 0.08 * Math.sin(Math.PI * s1);
      second.x += stx * (s2 - sr); second.z += stz * (s2 - sr); second.y += 0.06 * Math.sin(Math.PI * s2);
    }
    if (kicking) {
      // the standing leg of a kick is nearly straight (standDl), but never so
      // straight that it cannot reach its foot (the hips still arriving off
      // the step in, a root that has drifted): the hips stay as low as the
      // leg needs, and the sole stays on the floor
      const pf = kSide === "L" ? FR : FL;
      const phx = (kSide === "L" ? -1 : 1) * D.hipX + S.mX - pf.x, phz = S.mZ - pf.z;
      const pr = (D.g1 + D.g2) * 0.985;
      S.dl = Math.max(S.dl, D.hipY - pf.y - Math.sqrt(Math.max(0.01, pr * pr - phx * phx - phz * phz)));
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
    /* THE HEAD THAT TURNED BACKWARD. A passive body's base is the neck as
       it found it (S.ny = n0.y + 0.8 * b0.y), and the counter-turn below
       takes 0.8 of the torso's FINAL yaw off it. Whenever a reaction turned
       the torso (an arm shot: "the hurt shoulder turns away"; a hook; the
       legacy wobble) the target was n0.y - 0.8 * delta, and next frame n0.y
       was that target: the neck integrated the delta every frame with
       nothing to stop it. A man shot through the arm screwed his head round
       143 degrees in 1.1 s (tools/neck-limit-check.mjs). Passive writes are
       now an offset on the clean neck, stored and backed out at the top of
       MP.strike like the head snap, so the counter-turn is a turn, not a
       winding. */
    if (ch.neck) {
      const n = ch.neck.rotation, nx0 = n.x, ny0 = n.y;
      n.x = lerp(n.x, S.nx - S.bx * 0.5, K);
      n.y = lerp(n.y, -S.by * 0.8 + S.ny, K);
      if (passive) { ch._mPnx = n.x - nx0; ch._mPny = n.y - ny0; }
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
    const armK = ch.cuffed ? 0 : K * S.armK;     // wrists locked behind him: the strike never moves them
    if (armK > 0.002) {
      const ext = S._k && S._k.ext != null && !S._both ? S._k.ext : null;
      solveArm(ch, "L", WL, PL, S.rollL, S.pzL, armK, S._side === "L" ? ext : null);
      solveArm(ch, "R", WR, PR, S.rollR, S.pzR, armK, S._side === "R" ? ext : null);
    }

    // legs: feet planted by IK (group frame → model frame). Not while the
    // gait has them outright: it plants the same spots in the world.
    const gaitLegs = !kickK && !(fs && fs.on) && !mounted && !!CBZ.gait && !!ch._gOn && !!GV && GV.w >= 0.999;
    if (legK > 0.002 && !gaitLegs) {
      ch._mOwn = true;
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
  const _bfs = { x: 0, z: 0 };
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
      case "swing": {
        // two hands on the handle: cocked by the rear ear, then the hips and
        // shoulders sling it FLAT through the line; the lead hand rides the
        // handle under the rear one the whole way
        _t.set(sx * 0.36, D.shY + 0.12, -0.16);
        _C.copy(W).lerp(_t, chamber * (1 - d));
        W.copy(_C).lerp(aim, d);
        const sweep = Math.sin(Math.PI * d);
        W.x += sx * 0.34 * sweep; W.z -= 0.12 * sweep;
        P.set(sx * 0.9, 0.30 * chamber + 0.20 * d, -0.40);
        const O = side === "L" ? WR : WL;
        O.copy(W); O.y -= 0.07; O.x -= sx * 0.04; O.z -= 0.04;
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
    // (the plant foot stays where it stands: the hips came over it, MP.strike)
    const aimW = ch.kickAim || null;
    if (key === "front") {
      _C.set(sx * D.hipX * 0.7, D.footY + 0.55, S.mZ + 0.12);    // knee up, foot under it (the hips have come forward)
      if (aimW) { _A.copy(aimW); ch.group.worldToLocal(_A); _A.divideScalar(D.scale); }
      else _A.set(sx * 0.10, D.hipY + 0.10, 1.05);
      F.lerp(_C, ch01); F.lerp(_A, e);
      Q.set(sx * 0.15, 0.7, 1);
    } else if (key === "stomp") {
      // the leg's end (this solve's foot point is 2 cm above the sole) goes
      // to the spot, heel first; the chamber is over it, knee to the chest
      if (aimW) { _A.copy(aimW); ch.group.worldToLocal(_A); _A.divideScalar(D.scale); }
      else _A.set(sx * D.hipX * 0.6, D.footY + 0.22, 0.62);
      _A.y += 0.02; _A.z -= 0.03;
      _C.set(lerp(sx * D.hipX * 0.8, _A.x, 0.6), D.footY + 0.85, lerp(S.mZ + 0.30, _A.z, 0.6));
      F.lerp(_C, ch01); F.lerp(_A, e);
      Q.set(sx * 0.2, 0.6, 1);
    } else if (key === "soccer") {
      // back behind the hip with the knee folded, then through, low, to a
      // foot's length short of the spot (the instep is what lands)
      if (aimW) { _A.copy(aimW); ch.group.worldToLocal(_A); _A.divideScalar(D.scale); }
      else _A.set(sx * D.hipX * 0.5, D.footY + 0.16, 0.95);
      // (the instep is 14 cm ahead of and above the leg's end with the shin
      // raked forward as it is at contact: MP.strikePoint)
      const al = Math.hypot(_A.x, _A.z) || 1;
      _A.x -= _A.x / al * 0.14; _A.z -= _A.z / al * 0.14;
      _A.y = Math.max(_A.y - 0.14, D.footY + 0.04);
      _C.set(sx * D.hipX * 0.9, D.footY + 0.50, S.mZ - 0.50);
      F.lerp(_C, ch01); F.lerp(_A, e);
      // the foot comes through low, under the hip, clear of the floor
      F.y = Math.max(F.y - 0.06 * Math.sin(Math.PI * e), Math.min(_A.y, D.footY + 0.07));
      Q.set(sx * 0.1, 0.3, 1);
    } else if (key === "knee") {
      // the foot comes up behind as the knee drives up and forward
      // (measured from the HIPS, which have come forward over the standing
      // foot: left at fixed spots the foot stayed 15 cm behind them and the
      // shin was flung up at his own backside)
      _C.set(sx * D.hipX * 0.6, D.footY + 0.20, S.mZ - 0.20);
      F.lerp(_C, ch01);
      _A.set(sx * D.hipX * 0.5, D.footY + 0.78, S.mZ + 0.02);
      F.lerp(_A, e);
      Q.set(0, 0.35, 1);
    } else {
      // round / low: chamber out to the side, then the shin sweeps across
      const high = key === "round";
      _C.set(sx * 0.62, D.footY + (high ? 0.62 : 0.46), -0.10);
      if (aimW) { _A.copy(aimW); ch.group.worldToLocal(_A); _A.divideScalar(D.scale); }
      else _A.set(-sx * 0.05, high ? D.hipY + 0.28 : D.hipY - 0.30, 1.0);
      // the SHIN lands, so the foot goes on past the point (sent to the
      // point itself, the knee had to fold to a right angle to get it there)
      _A.z += high ? 0.12 : 0.10; _A.x -= sx * (high ? 0.10 : 0.06);
      F.lerp(_C, ch01);
      const sweep = e;
      F.set(lerp(F.x, _A.x, sweep), lerp(F.y, _A.y, Math.min(1, sweep * 1.4)), lerp(F.z, _A.z, sweep));
      F.x += sx * 0.25 * Math.sin(Math.PI * sweep);              // the arc
      // a low kick CHOPS: the shin comes over the top and down into the
      // thigh (it used to rise into it from shin height)
      if (!high) F.y += 0.16 * Math.sin(Math.PI * sweep);
      Q.set(-sx * 0.2, 1, 0.35);                                  // the knee turns over
      // THE STANDING FOOT PIVOTS with the hips, on its ball: toes out the way
      // the hip turned, heel off the floor while it turns
      const a = (ch._mMr || 0) * 1.15;
      PQ.set(Math.sin(a), 0.1, Math.cos(a));
      plant.y += 0.035 * Math.min(1, Math.abs(a));
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
      S.by += (hr.tw || 0) * f;                                   // a round's line across the trunk turns the shoulders
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
      S.by += sg * 0.10 * amt * f + (hr.tw || 0) * f;              // the hurt shoulder turns away
      S.nx += 0.18 * f;                                            // looks down at it
      S.armK = Math.max(S.armK, f);
    } else if (hr.kind === "buckle") {
      const f = sstep(0, 0.06, t) * (1 - sstep(0.25, hr.dur, t));
      const sgn = hr.side === "L" ? 1 : -1;                        // the leg that was kicked
      S.dl += 0.16 * amt * f;
      S.bz += -sgn * 0.16 * amt * f;                              // he dips onto the hurt side
      const F = hr.side === "L" ? FL : FR;
      F.z += 0.06 * f; F.y += 0.03 * f;
      // (planted by the gait: that knee gives forward over a lifted heel)
      if (hr.side === "L") ch._gHeel1 += 0.35 * f * amt; else ch._gHeel0 += 0.35 * f * amt;
      S.bx += 0.10 * f;
    } else if (hr.kind === "stagger" || hr.kind === "liver") {
      const s = sstep(0, 0.06, t) * (1 - sstep(0.22, Math.max(0.3, hr.dur), t));
      if (hr.kind === "liver") {
        S.bx += 0.24 * s; S.dl += 0.05 * s;                       // the first beat: it has not hit him yet
      } else {
        S.bx += lz * 0.30 * amt * s;
        S.bz += -lx * 0.16 * amt * s;
        S.by += (hr.tw || 0) * s;
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
    fs.world = false; fs.wx = 0; fs.wz = 0;
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
    lieFace: { h: 0.27, mZ: 0.10, bx: 1.50, by: 0, bz: 0.04, nx: -0.40, ny: 1.36, nz: 0.06,   // cheek on the floor (inside the neck's ~80 degree turn, CBZ.human.neckLimits)
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
    // ---- THE LEGS GO AT ONCE (a head shot, the spine): no buckle, no step.
    //      Both knees fold together and the hips drop almost straight down
    //      under him, the torso still upright and the head already gone
    //      forward; the arms are just hanging. From here he topples. ----
    crumple: { h: 0.36, mZ: -0.02, bx: 0.22, by: 0, bz: 0.06, nx: 0.62, ny: 0.08, nz: 0.10,
               L: { f: 0.10, lift: 0.05, z: 0.08 }, R: { f: -0.06, lift: 0.07, z: 0.02 }, aL: [0.05, 0.10, -0.15], aR: [0.08, 0.06, -0.20] },
    // ---- FOLDED OVER IT (a heavy round through the chest or the gut): the
    //      trunk doubles over the hole while the knees give, before he sits ----
    foldGut: { h: 0.60, mZ: -0.08, bx: 0.62, by: 0.04, bz: 0.05, nx: 0.40, ny: 0.05, nz: 0.04,
               L: { f: 0.20, lift: 0, z: 0.06 }, R: { f: 0.06, lift: 0, z: -0.02 }, aL: [-0.70, -0.05, -1.35], aR: [-0.55, -0.10, -1.50] },
    // ---- SAT DEAD AGAINST THE WALL HE WAS SHOT IN FRONT OF: hips on the
    //      floor, back on the wall, chin on the chest, legs out, one knee up a
    //      little, the hands in the lap and on the floor beside him ----
    seatWall: { h: 0.20, mZ: -0.12, bx: -0.30, by: 0.04, bz: 0.12, nx: 0.62, ny: 0.22, nz: 0.18,
               L: { f: 0.78, lift: 0.04, z: 0.14 }, R: { f: 0.58, lift: 0.10, z: 0.04 }, aL: [0.20, 0.32, -0.25], aR: [-0.25, 0.12, -0.70] },
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
    // the styled deaths (STYLES below picks one for a variant)
    dropBack: [["crumple", 0.15], ["seat", 0.32], ["lieBack", 0.60]],
    dropFace: [["crumple", 0.15], ["knees", 0.28], ["lieFace", 0.54]],
    foldBack: [["foldGut", 0.26], ["seat", 0.52], ["lieBack", 0.86]],
    wallBack: [["buckle", 0.20], ["seat", 0.46], ["seatWall", 0.66]],
  };
  /* HOW he died picks how he goes down (systems/bodyfall.js chooses): `drop`
     the legs go at once (head), `fold` doubled over a heavy round in the
     trunk, `wall` sat down against the wall behind him. A style has a
     sequence per variant (a variant it does not list falls the plain way)
     and may lie in its own last key. */
  const STYLES = {
    drop: { back: "dropBack", face: "dropFace" },
    fold: { back: "foldBack" },
    wall: { back: "wallBack", lie: "seatWall" },
  };
  function seqName(f, FR) {
    const st = f.style && STYLES[f.style];
    const n = st && st[f.variant === "face" ? "face" : "back"];
    if (n && (f.variant === "back" || f.variant === "face")) return n;
    return f.ko ? FR.fall : FR.fallC;
  }
  function lieName(f, FR) {
    const st = f.style && STYLES[f.style];
    if (st && st.lie && st[f.variant === "face" ? "face" : "back"]) return st.lie;
    return f.ko ? FR.lie : FR.lieC;
  }
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
  /* THE KEYS ARE AUTHORED ON A 0.93 u LEG (thigh + shin): a foot "0.93
     behind" or a kneel "0.55 up" is a leg length, so it scales with this
     body's leg (character.js's real-proportions pass made the adult's 1.12).
     A lying key's hip height (<= 0.35, the body's own thickness) does not. */
  const KEY_LEG = 0.93;
  function legKey(spec, k) { return k === 1 ? spec : { f: spec.f * k, lift: spec.lift, z: spec.z }; }
  function resolveKey(D, key) {
    const r = new Float32Array(CH);
    const k = (D.g1 + D.g2) / KEY_LEG;
    const h = key.h > 0.35 ? D.footY + (key.h - D.footY) * k : key.h;
    r[0] = D.hipY - h; r[1] = key.mZ; r[2] = key.bx; r[3] = key.by; r[4] = key.bz;
    r[5] = key.nx; r[6] = key.ny; r[7] = key.nz;
    legAngles(D, h, legKey(key.L, k), r, 8);
    legAngles(D, h, legKey(key.R, k), r, 11);
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
    // THE CLOCK RUNS ON THE ENERGY: a head shot drops a man in under half a
    // second, a man bleeding out sags down slowly (bodyfall.js picks it)
    f.rate = o.rate > 0 ? clamp(o.rate, 0.5, 2.2) : 1;
    f.style = STYLES[o.style] ? o.style : "";
    f.seed = Number.isFinite(o.seed) ? o.seed : Math.random() * 6.28;
    f.snap = false;                 // the first frame records where the fall starts from
    const L = ch._limp;
    if (L) { L.init = false; L.sleep = false; }
    // the fall owns the whole body: every strike and reaction on it ends
    ch.punchT = 0; ch.kickT = 0; ch.blockT = 0; ch.dodgeT = 0;
    if (ch.hitReact) ch.hitReact.on = false;
    if (ch.footStep) ch.footStep.on = false;
    ch._mPnx = ch._mPny = 0;   // the fall writes the neck outright: nothing of the stance's to back out
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
  // style / rate optional: the fall's length in SECONDS for that death
  MP.fallTimes = function (variant, style, rate) {
    const F = fallRow(variant), up = SEQ[F.up];
    const st = style && STYLES[style];
    const sn = st && st[variant === "face" ? "face" : "back"];
    const fall = (sn && (variant === "back" || variant === "face")) ? SEQ[sn] : SEQ[F.fall];
    return { fall: fall[fall.length - 1][1] / (rate > 0 ? rate : 1), getup: up[up.length - 1][1], delay: F.delay };
  };
  /* grav: a body with no muscle in it (out cold, dead) does not ease onto
     the floor, it lands: the last segment accelerates the whole way (u^2)
     and stops on the floor key. The stop is the impact the limp springs
     below feel; a conscious man's fall still eases in (he catches himself). */
  function seqSample(ch, seq, t, side, cur, out, grav) {
    const keys = keysOf(ch);
    let t0 = 0;
    for (let i = 0; i < seq.length; i++) {
      const t1 = seq[i][1];
      if (t <= t1 || i === seq.length - 1) {
        let u = sstep(t0, t1, t);
        if (grav && i === seq.length - 1 && i > 0) { const q = clamp01((t - t0) / (t1 - t0)); u = q * q; }
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
    if (g.trunk) {
      // a boot into the body: the trunk rocks off it and curls round it, the
      // head only follows
      if (ch.neck && h) { ch.neck.rotation.y += g.lx * 0.18 * h; ch.neck.rotation.x += 0.16 * Math.abs(h); }
      ch.body.rotation.z += g.lx * 0.12 * h;
      ch.body.rotation.x += (back ? 0.10 : -0.06) * Math.abs(h);
    } else {
    if (ch.neck && h) {
      ch.neck.rotation.y += g.lx * 0.70 * h;                   // turned by it
      ch.neck.rotation.x += (back ? -0.22 : 0.18) * Math.abs(h); // into the floor and back up
    }
    ch.body.rotation.x += (back ? 0.05 : -0.05) * Math.abs(h);
    }
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
  MP.groundHit = function (ch, lx, amt, trunk) {
    let g = ch.gHit;
    if (!g) g = ch.gHit = { on: false, t: 0, lx: 0, amt: 1, trunk: false };
    g.on = true; g.t = 0; g.lx = lx < 0 ? -1 : 1; g.amt = amt == null ? 1 : amt; g.trunk = !!trunk;
  };

  /* ============================================================
     LIMP WEIGHT — a body with no muscle in it (out cold, dead).
     The keyed fall says where the hips and the trunk go; nothing in it moved
     the arms, the head or a leg except to the next key, so every body landed
     with its limbs exactly where a key put every other body's, and arrived
     there as stiff as a mannequin. Once the muscles go, a limb is loose mass
     on a joint: it trails the trunk while the trunk is moving, flops when the
     trunk stops on the floor, swings past where it will lie, and settles.
       · one damped spring per loose degree of freedom (both shoulders, both
         elbows, the neck three ways, the trunk's twist, both hips' splay);
       · driven by what the trunk is doing, read off the pose the fall just
         wrote: its pitch acceleration (a limb lags a turning trunk), the
         hips' vertical acceleration (the floor stopping the body is the
         biggest of them: the keyed fall now lands under gravity) and the
         root's acceleration in his frame;
       · each spring rests where gravity and the floor leave that limb, a
         seeded sprawl per body (an arm thrown out, a head turned, one knee
         fallen up and over), and has joint limits: an arm stops on the floor
         it lies on and bounces a little off it;
       · a round into the body is a kick to the springs of the part it hit
         (MP.limpKick: bodyfall's poke, and the killing round itself).
     Written ABSOLUTELY on top of the pose the fall wrote this frame (the
     fall writes every channel outright, and its first segment blends from a
     snapshot, not the live pose), so nothing winds up: the additive spring
     writes that exploded in grapple.js have nothing to feed on here.
     Cost per falling body: 12 springs, a few dozen flops each, for about two
     seconds; then asleep (rest offsets only, no integration), and a body
     bodyfall.js has put to sleep is not posed at all.
     ============================================================ */
  const LN = 12;
  // 0 left shoulder flex (x, + = back) 1 left arm out 2 right flex 3 right out
  // 4 left elbow 5 right elbow 6 neck x (+ = chin down) 7 neck y 8 neck z
  // 9 trunk twist 10 left leg out 11 right leg out
  const LK = new Float32Array([46, 46, 46, 46, 38, 38, 64, 56, 56, 50, 80, 80]);
  const LZETA = [0.22, 0.25, 0.22, 0.25, 0.30, 0.30, 0.30, 0.34, 0.34, 0.40, 0.50, 0.50];
  const LC = new Float32Array(LN);
  for (let i = 0; i < LN; i++) LC[i] = 2 * LZETA[i] * Math.sqrt(LK[i]);
  const LMIN = new Float32Array([-1.7, -0.30, -1.7, -0.30, -1.1, -1.1, -0.55, -0.60, -0.40, -0.40, -0.18, -0.18]);
  const LMAX = new Float32Array([0.95, 1.25, 0.95, 1.25, 0.35, 0.35, 0.55, 0.60, 0.40, 0.40, 0.45, 0.45]);
  const LD = new Float32Array(LN);           // this frame's drive (scratch)
  const G_ARM = 1.5, G_HEAD = 1.1;
  function limpRec(ch) {
    return ch._limp || (ch._limp = { x: new Float32Array(LN), v: new Float32Array(LN), r: new Float32Array(LN),
      bendL: 0, bendR: 0, init: false, sleep: false, kick: false, quiet: 0,
      pP: 0, wP: 0, pR: 0, wR: 0, hy: 0, vy: 0, gx: 0, gz: 0, vx: 0, vz: 0 });
  }
  // where each limb comes to rest: seeded per body, smaller for a man only out cold
  function limpRest(L, f) {
    const s = f.seed || 0, m = f.dead ? 1 : 0.55, face = f.variant === "face";
    const j = (k) => Math.sin(s * k + k);
    const r = L.r;
    r[0] = (face ? 1 : -1) * 0.12 * Math.abs(j(1.7)) * m;   // off the floor, never into it
    r[2] = (face ? 1 : -1) * 0.12 * Math.abs(j(2.9)) * m;
    r[1] = 0.30 * j(2.3) * m;  r[3] = 0.30 * j(3.1) * m;
    r[4] = -0.25 * Math.abs(j(4.4)) * m;  r[5] = -0.25 * Math.abs(j(5.2)) * m;
    r[6] = 0.10 * j(0.9) * m;
    r[7] = face ? 0 : 0.45 * j(1.3) * m;                    // face down the cheek is already on the floor
    r[8] = 0.15 * j(2.7) * m;
    r[9] = 0.10 * j(6.1) * m;
    r[10] = 0.04 + 0.10 * j(3.7) * m;  r[11] = 0.04 + 0.10 * j(4.1) * m;
    // on his back one knee may have fallen up: thigh off the floor by a, the
    // knee bent 2a, so the foot stays flat on the floor (thigh ~ shin)
    const b = !face && f.style !== "wall" ? 0.32 * Math.max(0, j(5.3)) * m : 0;
    if (j(7.7) >= 0) { L.bendL = b; L.bendR = 0; } else { L.bendL = 0; L.bendR = b; }
  }
  function limp(ch, f, mdt) {
    if (!f.ko) return;
    const L = limpRec(ch), g = ch.group;
    if (!g) return;
    let fade = 1;
    if (f.phase === "getup") {
      // a man coming round takes his limbs back over a third of a second
      fade = 1 - clamp01((f.gt || 0) / 0.3);
      if (fade <= 0) { L.init = false; return; }
    }
    const dt = Math.min(0.05, Math.max(0, mdt || 0));
    const x = L.x, v = L.v;
    if (!L.init) {
      L.init = true; L.sleep = false; L.quiet = 0;
      if (!L.kick) { x.fill(0); v.fill(0); }
      L.kick = false;
      limpRest(L, f);
      L.pP = ch.body.rotation.x; L.wP = 0; L.pR = ch.body.rotation.z; L.wR = 0;
      L.hy = g.position.y + (ch._mMy || 0); L.vy = 0;
      L.gx = g.position.x; L.gz = g.position.z; L.vx = 0; L.vz = 0;
    }
    // how far through the fall (the rest offsets come in with it) and how
    // much of him is on the floor
    const FR = fallRow(f.variant), sq = SEQ[seqName(f, FR)];
    const wr = f.phase === "fall" ? clamp01(f.t / sq[sq.length - 1][1]) : 1;
    const wd = f.phase === "fall" ? clamp01((wr - 0.7) / 0.3) : 1;
    if (!L.sleep && dt > 0) {
      const idt = 1 / dt;
      const pitch = ch.body.rotation.x, roll = ch.body.rotation.z;
      const hy = g.position.y + (ch._mMy || 0);
      const jump = Math.abs(hy - L.hy) + Math.abs(g.position.x - L.gx) + Math.abs(g.position.z - L.gz) > 0.4;
      const wp = (pitch - L.pP) * idt, wrl = (roll - L.pR) * idt;
      const vy = (hy - L.hy) * idt, vx = (g.position.x - L.gx) * idt, vz = (g.position.z - L.gz) * idt;
      let ap = (wp - L.wP) * idt, ar = (wrl - L.wR) * idt, ay = (vy - L.vy) * idt;
      let ax = (vx - L.vx) * idt, az = (vz - L.vz) * idt;
      L.pP = pitch; L.wP = wp; L.pR = roll; L.wR = wrl; L.hy = hy; L.vy = vy;
      L.gx = g.position.x; L.gz = g.position.z; L.vx = vx; L.vz = vz;
      if (jump) { ap = ar = ay = ax = az = 0; L.wP = L.wR = L.vy = L.vx = L.vz = 0; }   // moved on purpose, not fallen
      ap = clamp(ap, -260, 260); ar = clamp(ar, -200, 200); ay = clamp(ay, -70, 70);
      ax = clamp(ax, -70, 70); az = clamp(az, -70, 70);
      const ya = g.rotation.y || 0, sy = Math.sin(ya), cy = Math.cos(ya);
      const afw = ax * sy + az * cy, alt = ax * cy - az * sy;  // his front / his left (+x)
      const sP = Math.sin(pitch), cP = Math.cos(pitch);
      // the acceleration along the trunk's front: a limb hanging below its
      // joint lags it (+), the head above its joint the other way
      const lin = afw * cP - ay * sP;
      const dArm = -ap + G_ARM * lin;
      const float = -0.5 * ay * cP;                           // the hips dropping away: the arms float up and out
      LD[0] = dArm; LD[2] = dArm;
      LD[1] = G_ARM * (-0.8 * alt + float); LD[3] = G_ARM * (0.8 * alt + float);
      LD[4] = -0.4 * dArm; LD[5] = -0.4 * dArm;
      LD[6] = -1.2 * ap - G_HEAD * lin;
      LD[7] = 0;
      LD[8] = 0.7 * G_HEAD * alt - ar;
      LD[9] = 0;
      const splay = ay > 0 && wd > 0.5 ? 0.06 * ay : 0;       // the floor stops him: the legs bounce apart
      LD[10] = splay; LD[11] = splay;
      const face = f.variant === "face", wall = f.style === "wall";
      const n = dt > 0.022 ? 2 : 1, h = dt / n;
      for (let s = 0; s < n; s++) {
        for (let i = 0; i < LN; i++) {
          const a = LD[i] - LK[i] * (x[i] - L.r[i] * wr) - LC[i] * v[i];
          v[i] += a * h; x[i] += v[i] * h;
          let lo = LMIN[i], hi = LMAX[i];
          // an arm lying on the floor stops on it (back: + is toward the
          // floor, face down: -)
          if ((i === 0 || i === 2) && !wall) { if (face) lo = lerp(lo, -0.10, wd); else hi = lerp(hi, 0.10, wd); }
          // the head on the floor: it bounces off it, it does not nod into it
          // (back: extension is toward the floor; face down: flexion)
          else if (i === 6 && !wall) { if (face) hi = lerp(hi, 0.10, wd); else lo = lerp(lo, -0.08, wd); }
          if (x[i] < lo) { x[i] = lo; if (v[i] < 0) v[i] *= -0.25; }
          else if (x[i] > hi) { x[i] = hi; if (v[i] > 0) v[i] *= -0.25; }
        }
      }
      // asleep once he is down and nothing is moving
      if (f.phase === "down") {
        let e = Math.abs(ap) * 0.01;
        for (let i = 0; i < LN; i++) e += Math.abs(x[i] - L.r[i]) + 0.2 * Math.abs(v[i]);
        if (e < 0.03) { L.quiet += dt; if (L.quiet > 0.25) L.sleep = true; } else L.quiet = 0;
      }
    }
    // ---- write it over the fall's pose ----
    const P = ch.parts, LO = ch.low || {}, k = fade;
    if (P.la) { P.la.rotation.x += x[0] * k; P.la.rotation.z += x[1] * k; }
    if (P.ra) { P.ra.rotation.x += x[2] * k; P.ra.rotation.z -= x[3] * k; }
    if (LO.la) LO.la.rotation.x = Math.min(0, LO.la.rotation.x + x[4] * k);
    if (LO.ra) LO.ra.rotation.x = Math.min(0, LO.ra.rotation.x + x[5] * k);
    if (ch.neck) { const nr = ch.neck.rotation; nr.x += x[6] * k; nr.y += x[7] * k; nr.z += x[8] * k; }
    ch.body.rotation.y += x[9] * k;
    if (P.rl) P.rl.rotation.z += x[10] * k;        // parts.rl is his LEFT leg
    if (P.ll) P.ll.rotation.z -= x[11] * k;
    const bL = L.bendL * wr * k, bR = L.bendR * wr * k;
    if (bL > 0 && P.rl) { P.rl.rotation.x -= bL; if (LO.rl) LO.rl.rotation.x += 2 * bL; }
    if (bR > 0 && P.ll) { P.ll.rotation.x -= bR; if (LO.ll) LO.ll.rotation.x += 2 * bR; }
    if (ch.neck && CBZ.human && CBZ.human.clampNeck) CBZ.human.clampNeck(ch.neck);
  }
  /* a round (or a boot) into a limp body: velocity into the springs of the
     part it struck. part "la"|"ra" (arms), "rl"|"ll" (his left | right leg,
     the rig's names), "head", "core"; s +1 = the round going toward his left;
     amt ~0.3 (a pistol into a corpse) .. 1.5 (a close shotgun); fwd = the
     round along his front (+ = it pushes him forward); tw = trunk twist
     velocity (the round's line across his shoulders). */
  MP.limpKick = function (ch, part, s, amt, fwd, tw) {
    if (!ch || !ch.parts) return false;
    const L = limpRec(ch), v = L.v;
    const a = clamp(amt || 0, 0, 2.5);
    s = s < 0 ? -1 : 1; fwd = fwd || 0;
    L.sleep = false; L.quiet = 0;
    if (!L.init) L.kick = true;
    if (part === "la" || part === "ra") {
      const i = part === "la" ? 0 : 2;
      v[i] += -fwd * 6 * a;
      v[i + 1] += (part === "la" ? s : -s) * 9 * a;           // along the round: out on the side it goes to
      v[i === 0 ? 4 : 5] -= 5 * a;
      v[7] += s * 1.5 * a;
    } else if (part === "rl" || part === "ll") {
      v[part === "rl" ? 10 : 11] += (part === "rl" ? s : -s) * 5 * a;
      v[part === "rl" ? 11 : 10] += 1.2 * a;
    } else if (part === "head") {
      v[6] += fwd * 7 * a;                                     // driven back (extension) or forward
      v[7] += s * 7 * a; v[8] += s * 3 * a;
      v[1] += 2 * a; v[3] += 2 * a;
    } else {
      // the trunk is driven along the round; the head and the arms lag it
      v[6] += -fwd * 3 * a; v[7] += s * 3 * a;
      v[0] += fwd * 4 * a; v[2] += fwd * 4 * a;
      v[1] += 3.5 * a; v[3] += 3.5 * a;
    }
    if (tw) v[9] += clamp(tw, -6, 6);
    return true;
  };
  // true while the limp springs are still moving (bodyfall.js does not let a body sleep under them)
  MP.limpBusy = function (ch) { const L = ch && ch._limp; return !!(L && L.init && !L.sleep); };

  /* ---- DRAGGING HIMSELF (bodyfall.js moves the root; ch._drag = { on, t }):
     face down the arms take turns reaching out along the floor (abduction,
     which stays IN the floor plane) and pulling him up to the hand, the
     head up to see; on his back the knees come up, the heels dig in and the
     legs drive him along head first. Lerped toward targets over the lying
     key the fall writes outright, so it is bounded. */
  function dragPose(ch, f, mdt) {
    const d = ch._drag;
    if (!d || !d.on || f.ko) return;
    const P = ch.parts, LO = ch.low || {};
    const cyc = 1.5, ph = (d.t % cyc) / cyc, n = Math.floor(d.t / cyc);
    const reach = ph < 0.45 ? sstep(0, 0.45, ph) : 1 - sstep(0.45, 1, ph);
    if (f.variant === "face") {
      const lead = n % 2 ? P.la : P.ra, other = n % 2 ? P.ra : P.la;
      const lo = n % 2 ? LO.la : LO.ra;
      const out = n % 2 ? 1 : -1;                              // la out = +z, ra out = -z
      if (lead) lead.rotation.z = lerp(lead.rotation.z, out * 2.5, 0.85 * reach);
      if (lo) lo.rotation.x = lerp(lo.rotation.x, -1.2, 1 - reach);   // bent while it pulls
      if (other) other.rotation.z = lerp(other.rotation.z, -out * 0.9, 0.6);
      if (ch.neck) ch.neck.rotation.x -= 0.30;                   // the head up off the floor
      const knee = n % 2 ? LO.ll : LO.rl;                          // the opposite knee comes up and pushes
      if (knee) knee.rotation.x += 0.7 * reach;
    } else {
      const push = 1 - reach;                                    // reach = knees up, then the legs drive
      if (P.rl) P.rl.rotation.x -= 0.75 * reach;
      if (P.ll) P.ll.rotation.x -= 0.75 * reach;
      if (LO.rl) LO.rl.rotation.x += 1.5 * reach;
      if (LO.ll) LO.ll.rotation.x += 1.5 * reach;
      if (LO.la) LO.la.rotation.x = Math.min(0, lerp(LO.la.rotation.x, -1.3, 0.6 * push));   // elbows dig in
      if (LO.ra) LO.ra.rotation.x = Math.min(0, lerp(LO.ra.rotation.x, -1.3, 0.6 * push));
      if (ch.neck) ch.neck.rotation.x += 0.25;                   // the head lifted to see where he goes
    }
  }

  /* ============================================================
     THE HURT BODY — a man who was hit and lives moves like it, all the time,
     not for one beat. ch._hurt is written every tick by systems/vitals.js
     from his open wounds: { on, gut, chest, armL, armR, weak, flinch } (0..1).
       · a hole in the gut or the chest: he hunches over it and one hand is
         pressed on it (the hand on the other side when an arm is hit too);
       · a hole in an arm: that arm hangs, the hand is useless;
       · blood loss: the head droops, the arms go slack, the trunk sags;
       · flinch: rounds going past him, or a fresh one in him: the shoulders
         come up, the head goes down, the hands come in.
     (A leg wound is character.js's limp, ch.legHurt, which wounds.js and
     vitals already drive.) The trunk is written outright by the gait every
     frame, so it takes a plain offset; the arms and the neck are damped by
     the gait from where they were, so they are LERPED toward a target here
     (a fixed point between the gait's pose and the hurt one: bounded). A
     gun hold (systems/actorweapons.js, after this) keeps the arms it needs. */
  function hurtPose(ch, mdt, moving) {
    const H = ch._hurt;
    if (!H || !H.on || ch.sitting || ch.lying || ch.mount || ch.cuffed) return;
    const P = ch.parts, LO = ch.low || {};
    const busy = ch.punchT > 0 || ch.kickT > 0 || ch.blockT > 0 || !!(ch.hitReact && ch.hitReact.on);
    const gut = H.gut || 0, chest = H.chest || 0, weak = H.weak || 0, fl = H.flinch || 0;
    ch.body.rotation.x += 0.22 * gut + 0.10 * chest + 0.12 * weak + 0.14 * fl;
    if (ch.neck) ch.neck.rotation.x = lerp(ch.neck.rotation.x, 0.4, Math.min(0.8, 0.35 * weak + 0.25 * gut + 0.6 * fl));
    if (busy) return;
    const aL = H.armL || 0, aR = H.armR || 0;
    // a dead arm hangs
    if (aL > 0 && P.la) { P.la.rotation.x = lerp(P.la.rotation.x, 0.06, 0.75 * aL); P.la.rotation.z = lerp(P.la.rotation.z, 0.04, 0.75 * aL); if (LO.la) LO.la.rotation.x = lerp(LO.la.rotation.x, -0.1, 0.75 * aL); }
    if (aR > 0 && P.ra) { P.ra.rotation.x = lerp(P.ra.rotation.x, 0.06, 0.75 * aR); P.ra.rotation.z = lerp(P.ra.rotation.z, -0.04, 0.75 * aR); if (LO.ra) LO.ra.rotation.x = lerp(LO.ra.rotation.x, -0.1, 0.75 * aR); }
    // the hand pressed on the hole in the trunk
    const trunk = Math.max(gut, chest);
    const useL = aL < 0.3, useR = aR < 0.3 && !useL;
    if (trunk > 0.05 && (useL || useR)) {
      const arm = useL ? P.la : P.ra, lo = useL ? LO.la : LO.ra, inS = useL ? -1 : 1;
      const hi = chest > gut;
      const k = Math.min(0.85, 0.3 + 0.6 * trunk) * (moving ? 0.8 : 1);
      if (arm) { arm.rotation.x = lerp(arm.rotation.x, hi ? -1.0 : -0.72, k); arm.rotation.z = lerp(arm.rotation.z, inS * (hi ? 0.38 : 0.30), k); }
      if (lo) lo.rotation.x = lerp(lo.rotation.x, hi ? -1.85 : -1.55, k);
    }
    // slack with the blood going
    if (weak > 0.05) {
      const k = 0.35 * weak;
      if (P.la && aL <= 0 && !(trunk > 0.05 && useL)) { P.la.rotation.x = lerp(P.la.rotation.x, 0.05, k); if (LO.la) LO.la.rotation.x = lerp(LO.la.rotation.x, -0.12, k); }
      if (P.ra && aR <= 0 && !(trunk > 0.05 && useR)) { P.ra.rotation.x = lerp(P.ra.rotation.x, 0.05, k); if (LO.ra) LO.ra.rotation.x = lerp(LO.ra.rotation.x, -0.12, k); }
    }
    // the flinch: hands in, shoulders up
    if (fl > 0.05) {
      const k = 0.7 * fl;
      if (P.la && aL <= 0) { P.la.rotation.x = lerp(P.la.rotation.x, -0.55, k); P.la.rotation.z = lerp(P.la.rotation.z, -0.12, k); if (LO.la) LO.la.rotation.x = lerp(LO.la.rotation.x, -1.7, k); }
      if (P.ra && aR <= 0) { P.ra.rotation.x = lerp(P.ra.rotation.x, -0.55, k); P.ra.rotation.z = lerp(P.ra.rotation.z, 0.12, k); if (LO.ra) LO.ra.rotation.x = lerp(LO.ra.rotation.x, -1.7, k); }
    }
  }

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
        /* THE FIRST SEGMENT BLENDS FROM WHERE HE WAS, recorded once on the
           fall's first frame. It used to re-read the live pose every frame,
           so anything written over the fall (the limp below, a jolt) was fed
           back into its own source and wound up. */
        if (!f.snap || !f.cur0) {
          if (!f.cur0) f.cur0 = new Float32Array(CH);
          for (let c = 0; c < CH; c++) f.cur0[c] = CUR[c];
          f.snap = true;
        }
        f.t += mdt * (f.rate || 1);
        const seq = SEQ[seqName(f, FR)];
        // the liver: a beat where nothing happens yet, then the fold
        const tt = Math.max(0, f.t - FR.delay);
        w = seqSample(ch, seq, tt, side, f.cur0, OUT, f.ko);
        if (tt >= seq[seq.length - 1][1]) { f.phase = "down"; f.t = 0; }
      } else if (f.phase === "down") {
        f.t += mdt;
        const key = keysOf(ch)[lieName(f, FR)];
        mirrorInto(key, side, OUT);
        OUT[2] += (variant === "face" ? -1 : 1) * 0.025 * Math.sin(ch.breath * 2.4);   // he is still breathing
        if (!f.hold && f.t >= f.dur) { f.phase = "getup"; f.gt = 0; }
      } else {
        f.gt += mdt;
        const seq = SEQ[FR.up];
        // the first get-up segment starts from the lying key, not the live base
        const lie = keysOf(ch)[lieName(f, FR)];
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
          // he is on his feet: the gait plants them where they are drawn and
          // solves the legs over them while this pose lets go (gait.js plantInit)
          ch._gFeetNow = true;
        }
      }
      if (f.on || w > 0) writePose(ch, OUT, f.on ? w : 0);
      if (!f.on) { setModel(ch, 0, 0, 0, 0); }
      // the pose above is written outright every frame, so whatever goes on
      // top of it is too, and nothing winds up
      if (f.on) limp(ch, f, mdt);
      if (f.on && f.phase === "down") { groundHit(ch, f, mdt); dragPose(ch, f, mdt); }
    } else if (ch._limp && ch._limp.init) ch._limp.init = false;

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

    if (!(f && f.on)) hurtPose(ch, mdt, moving);

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
      if (kk === "stomp") out.set(0, -D.g2 - 0.02, 0.03);         // the heel side of the sole
      else if (kk === "soccer") out.set(0, -D.g2 + 0.03, 0.20);   // the instep
      else if (kk === "knee") out.set(0, 0, D.legW * 0.4);
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
