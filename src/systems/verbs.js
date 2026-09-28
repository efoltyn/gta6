/* ============================================================
   systems/verbs.js — CBZ.verbs: ONE LIBRARY OF WHAT TWO PEOPLE DO TO
   EACH OTHER WITH THEIR HANDS.

   Owner: "All the interactions between players connect across games. In
   Natural Disaster the grab and throw commands change based on the world,
   and they're cool, but they don't look good when it happens. You get
   handcuff logic from jail... all the logic comes together."

   Before this file every game had its own: survival's grab was a position
   lerp 1.5 m in front of the camera with a hang pose, the city's clinch and
   escort were a position attach 0.9 m ahead with no hands on anybody, the
   hostage WALKED 1.2 m behind you, the zip ties were a hand-rolled IK with
   typed bone lengths, and none of them knew what was behind the person they
   were throwing. Here there is one of each:

     body(a)        the actor adapter: every actor shape in the game (player,
                    survival bot, city ped/cop, prison inmate/guard, soldier)
                    answers the same questions.
     contacts(ch)   where on a body a hand goes: collar, nape, throat, upper
                    arm, wrist crease, pocket, thigh... read off the rig's LIVE
                    joint matrices and its own profile, so a woman's collar and
                    a child's wrist are their own.
     sessions       every two-person verb is a CHOREOGRAPHY through the same
                    phases — approach, align, contact, drive, outcome, hold,
                    release — with hands actually ON the contact points (the
                    late pass solves them there with CBZ.charArmTo and checks
                    the residual), a drive where the grabber braces and the
                    target's body reacts, and an outcome the WORLD picks.
     context()      what is in front of a body: a wall, a waist-high rail with
                    a drop behind it, a ledge, water, a bed, a table, or open
                    ground. A shove near a ledge is a fall; a throw at a rail
                    goes over it; a throw at a wall is a slam.
     cuffs          any game can cuff anyone: the ties sit ON the wrists
                    (CBZ.charArmLandmarks) with the hands behind the back and
                    the wrists touching, solved every frame after the gait.

   Late pass: CBZ.onUpdate(91) — after animChar (the actors' own updaters),
   reactions.js (89) and grapple.js (90). It moves roots, writes the hold
   poses (entities/verbposes.js), solves the grabber's hands onto the
   partner's contact points, the partner's hands onto the grabber's wrists or
   forearm where the verb calls for it, then CBZ.lockCharacterHips.

   Loads in any order, feature-detects everything, allocates nothing per
   frame once a session is running. STRIKE (systems/verbs_strike.js) hangs its
   own functions on the same namespace; nothing here overwrites a key it does
   not own.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const V = CBZ.verbs = CBZ.verbs || {};

  const PI = Math.PI, TAU = PI * 2;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
  const lerp = (a, b, t) => a + (b - a) * t;
  function angDiff(a, b) { let d = (b - a) % TAU; if (d > PI) d -= TAU; else if (d < -PI) d += TAU; return d; }
  function lerpAngle(a, b, t) { return a + angDiff(a, b) * t; }
  function wrap(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  const G = () => (CBZ.TUNE && CBZ.TUNE.gravity) || 22;
  const mode = () => (CBZ.game && CBZ.game.mode) || "";
  const VP = () => CBZ.verbPoses || null;

  /* ============================================================
     THE ACTOR ADAPTER
     ============================================================ */
  function isPlayerA(a) { return !!a && (a.isPlayer === true || a === CBZ.player); }
  let _pa = null;
  function playerActor() {
    const m = mode();
    if (m === "city" && CBZ.city && CBZ.city.playerActor) return CBZ.city.playerActor;
    if (m === "survival" && CBZ.surv && CBZ.surv.playerActor) return CBZ.surv.playerActor;
    if (!_pa) {
      _pa = {
        isPlayer: true,
        get pos() { return CBZ.player ? CBZ.player.pos : null; },
        get group() { return CBZ.playerChar ? CBZ.playerChar.group : null; },
        get dead() { return !!(CBZ.player && CBZ.player.dead); },
        get hp() { return CBZ.player ? CBZ.player.hp : 100; },
        set hp(v) { if (CBZ.player) CBZ.player.hp = v; },
      };
    }
    return _pa;
  }
  // every entry point takes whatever shape of "the player" a caller holds
  function norm(a) { return isPlayerA(a) ? playerActor() : a; }
  function rigOf(a) {
    if (!a) return null;
    if (isPlayerA(a)) return CBZ.playerChar || a.char || null;
    if (a.char && a.char.parts) return a.char;
    if (a.ch && a.ch.parts) return a.ch;
    if (a.parts && a.group) return a;                 // a bare rig
    return null;
  }
  function posOf(a) {
    if (isPlayerA(a)) return (CBZ.player && CBZ.player.pos) || a.pos || null;
    if (a.parts && a.group && !a.pos) return a.group.position;
    return a.pos || (a.group && a.group.position) || (a.char && a.char.group && a.char.group.position) || null;
  }
  function scaleOf(ch) {
    const g = ch && ch.group;
    const hs = g && g.userData && g.userData.humanScale;
    if (hs > 0) return hs;
    return (ch && ch.model && ch.model.scale && ch.model.scale.x) || 1;
  }
  function measure(B) {
    const ch = B.ch;
    if (!ch || B._dimCh === ch) return;
    B._dimCh = ch;
    const P = ch.profile || {}, s = scaleOf(ch);
    B.scale = s;
    B.depth = Math.max(P.torsoD || 0.5, P.pelvisD || 0.48, P.waistD || 0) * 0.5 * s;
    B.width = Math.max(P.torsoW || 0.92, P.pelvisW || 0.84) * 0.5 * s;
    B.radius = Math.max(B.depth, B.width);
    B.height = (ch.metric && ch.metric.height) || 2.6 * (P.statureMul || 1) * s;
    const hipY = ch.hipY || 0.95;
    B.hipY = hipY * s;
    B.shoulderY = (hipY - 0.005 + (P.torsoH || 0.95) - 0.055) * s;
    B.arm = (CBZ.charArmTo && CBZ.charArmTo.span) ? CBZ.charArmTo.span(ch, "r")
      : ((P.armUp || 0.46) + (P.armLo || 0.46)) * 0.985 * s;
    if (!(B.arm > 0.2)) B.arm = ((P.armUp || 0.46) + (P.armLo || 0.46)) * 0.985 * s;
  }
  function makeBody(a) {
    const B = {
      a: a, ch: null, pos: null, isPlayer: false,
      radius: 0.32, depth: 0.18, width: 0.32, height: 1.82, arm: 0.63, scale: 0.7,
      hipY: 0.665, shoulderY: 1.29, _dimCh: null, _yawLock: null,
    };
    B.yaw = function () {
      if (B._yawLock != null) return B._yawLock;
      const ch = B.ch;
      return ch && ch.group ? ch.group.rotation.y : (a.yaw || 0);
    };
    B.face = function (yaw, k) {
      const ch = B.ch;
      if (!ch || !ch.group) return;
      ch.group.rotation.y = k >= 1 ? yaw : lerpAngle(ch.group.rotation.y, yaw, k);
    };
    B.dead = function () { return B.isPlayer ? !!(CBZ.player && CBZ.player.dead) : !!a.dead; };
    B.down = function () {
      const o = B.isPlayer ? CBZ.player : a;
      const p = o && o._phys;
      if (p && (p.down > 0 || p.air)) return true;
      if (!B.isPlayer && a.ko > 0) return true;
      if (a._verbDown) return true;
      const ch = B.ch;
      // STRIKE's rig fall (entities/meleeposes.js) is on until he is back up
      if (ch && (ch.koPose || (ch.fall && ch.fall.on))) return true;
      return false;
    };
    B.hpRatio = function () {
      const o = B.isPlayer ? CBZ.player : a;
      const hp = o && o.hp, mx = (o && (o.maxHp || o.hpMax)) || 100;
      return hp == null ? 1 : clamp01(hp / mx);
    };
    return B;
  }
  function body(a) {
    if (!a) return null;
    let B = a._vb;
    if (!B || B.a !== a) {
      B = makeBody(a);
      try { a._vb = B; } catch (e) { /* frozen adapter: still works, just uncached */ }
    }
    B.isPlayer = isPlayerA(a);
    B.ch = rigOf(a);
    B.pos = posOf(a);
    measure(B);
    return B;
  }
  // write an actor's root. The player's rig follows CBZ.player.pos, so both move.
  function setPos(B, x, y, z) {
    const p = B.pos;
    if (!p) return;
    p.x = x; if (y != null) p.y = y; p.z = z;
    if (B.isPlayer && B.ch && B.ch.group && B.ch.group.position !== p) {
      B.ch.group.position.x = x; if (y != null) B.ch.group.position.y = y; B.ch.group.position.z = z;
    }
  }
  function groundY(x, z, fromY) {
    if (CBZ.groundAt) { const g = CBZ.groundAt(x, z, fromY); if (isFinite(g)) return g; }
    if (CBZ.floorAt) { const g = CBZ.floorAt(x, z, fromY); if (isFinite(g)) return g; }
    return fromY != null ? fromY : 0;
  }

  /* ============================================================
     CONTACT POINTS — world space, off the live joint matrices
     ============================================================ */
  const F_BODY = 0, F_NECK = 1, F_LA = 2, F_RA = 3, F_LOWLA = 4, F_LOWRA = 5, F_LEGL = 6, F_LEGR = 7;
  const CP = [
    // the contract's set
    "collarL", "collarR", "nape", "throat", "chest", "back", "upperArmL", "upperArmR",
    "wristL", "wristR", "waistL", "waistR", "hipL", "hipR", "headCenter", "jaw", "liver",
    "ribsL", "ribsR", "belt",
    // what the verbs below also put hands on
    "chestL", "chestR", "backCollar", "shoulderTopL", "shoulderTopR", "lowBackL", "lowBackR",
    "neckSideL", "neckSideR", "napeL", "napeR", "forearmL", "forearmR", "elbowL", "elbowR", "cuffGripL", "cuffGripR",
    "pocketL", "pocketR", "thighL", "thighR", "thighBackL", "thighBackR",
  ];
  const CPI = Object.create(null);
  for (let i = 0; i < CP.length; i++) CPI[CP[i]] = i;
  V.CONTACTS = CP;

  // Local coordinates (model units) of every point in its joint frame, built
  // once per rig from ITS profile. [frame, x, y, z] per point.
  function localTable(ch) {
    if (ch._vcl && ch._vclP === ch.profile) return ch._vcl;
    const P = ch.profile || {};
    const hipY = ch.hipY || 0.95;
    const base = hipY - 0.005, torsoH = P.torsoH || 0.95;
    const neckY = base + torsoH - 0.015, shY = neckY - 0.04;
    const hd = (P.torsoD || 0.5) / 2, hw = (P.torsoW || 0.92) / 2;
    const waistH = (P.waistShare || 0) * torsoH, chestBot = base + waistH;
    const wd = waistH > 0 ? (P.waistD || P.torsoD || 0.5) / 2 : hd;
    const ww = waistH > 0 ? (P.waistW || P.torsoW || 0.92) / 2 : hw;
    const pd = (P.pelvisD || 0.48) / 2, pw = (P.pelvisW || 0.84) / 2;
    const hs = P.headSize || 0.6, armW = P.armW || 0.3, armUp = P.armUp || 0.46, armLo = P.armLo || 0.46;
    const legW = P.legW || 0.34, legUp = P.legUp || 0.48, armX = P.armX || 0.62;
    const collarTop = neckY - 0.04 + (P.collarH || 0.18) / 2;
    const yoke = Math.max(P.collarD || 0.52, (P.torsoD || 0.5) + 0.02) / 2;
    const lm = CBZ.charArmLandmarks ? CBZ.charArmLandmarks(ch) : null;
    const wristY = lm ? lm.wrist : (P.handH || 0.2) - armLo + 0.04;
    const waistY = waistH > 0 ? base + waistH * 0.5 : base + 0.18;
    const back = Math.max(wd, pd);
    const T = new Float32Array(CP.length * 4);
    function put(name, f, x, y, z) { const i = CPI[name] * 4; T[i] = f; T[i + 1] = x; T[i + 2] = y; T[i + 3] = z; }
    put("collarL", F_BODY, 0.15, neckY - 0.11, hd + 0.035);
    put("collarR", F_BODY, -0.15, neckY - 0.11, hd + 0.035);
    put("nape", F_NECK, 0, hs * 0.22, -hs * 0.5 - 0.01);
    put("throat", F_NECK, 0, 0.02, hs * 0.34);
    put("chest", F_BODY, 0, shY - 0.30, hd + 0.01);
    put("back", F_BODY, 0, shY - 0.24, -hd - 0.01);
    put("upperArmL", F_LA, armW / 2 + 0.01, -armUp * 0.5, 0);
    put("upperArmR", F_RA, -(armW / 2 + 0.01), -armUp * 0.5, 0);
    put("wristL", F_LOWLA, 0, wristY, 0);
    put("wristR", F_LOWRA, 0, wristY, 0);
    put("waistL", F_BODY, ww + 0.01, waistY, 0);
    put("waistR", F_BODY, -(ww + 0.01), waistY, 0);
    put("hipL", F_BODY, pw * 0.6, hipY - 0.02, pd + 0.01);
    put("hipR", F_BODY, -pw * 0.6, hipY - 0.02, pd + 0.01);
    put("headCenter", F_NECK, 0, hs * 0.5, 0);
    put("jaw", F_NECK, 0, hs * 0.1, hs * 0.5 + 0.005);
    put("liver", F_BODY, -(hw + 0.01), chestBot + 0.10, hd * 0.35);
    put("ribsL", F_BODY, hw + 0.01, shY - 0.38, 0.03);
    put("ribsR", F_BODY, -(hw + 0.01), shY - 0.38, 0.03);
    put("belt", F_BODY, 0, base + 0.06, back + 0.01);
    put("chestL", F_BODY, 0.20, shY - 0.26, hd + 0.015);
    put("chestR", F_BODY, -0.20, shY - 0.26, hd + 0.015);
    put("backCollar", F_BODY, 0, neckY - 0.02, -yoke - 0.015);
    put("shoulderTopL", F_BODY, armX * 0.62, collarTop + 0.005, 0);
    put("shoulderTopR", F_BODY, -armX * 0.62, collarTop + 0.005, 0);
    put("lowBackL", F_BODY, 0.15, base + 0.14, -back - 0.01);
    put("lowBackR", F_BODY, -0.15, base + 0.14, -back - 0.01);
    put("neckSideL", F_NECK, hs * 0.5 + 0.01, hs * 0.06, hs * 0.08);
    put("neckSideR", F_NECK, -(hs * 0.5 + 0.01), hs * 0.06, hs * 0.08);
    put("napeL", F_NECK, hs * 0.28, hs * 0.38, -hs * 0.5 - 0.01);          // back of the head, one side
    put("napeR", F_NECK, -hs * 0.28, hs * 0.38, -hs * 0.5 - 0.01);
    put("forearmL", F_LOWLA, 0, -armLo * 0.72, 0);
    put("forearmR", F_LOWRA, 0, -armLo * 0.72, 0);
    put("elbowL", F_LOWLA, 0, -armLo * 0.22, 0);
    put("elbowR", F_LOWRA, 0, -armLo * 0.22, 0);
    put("cuffGripL", F_LOWLA, 0, wristY + 0.12, 0);
    put("cuffGripR", F_LOWRA, 0, wristY + 0.12, 0);
    put("pocketL", F_BODY, pw + 0.01, hipY - 0.06, 0.03);
    put("pocketR", F_BODY, -(pw + 0.01), hipY - 0.06, 0.03);
    // anatomical left leg is parts.rl (+X), right is parts.ll (-X)
    put("thighL", F_LEGL, legW / 2 + 0.01, -legUp * 0.45, 0);
    put("thighR", F_LEGR, -(legW / 2 + 0.01), -legUp * 0.45, 0);
    put("thighBackL", F_LEGL, 0, -legUp * 0.55, -legW / 2 - 0.01);
    put("thighBackR", F_LEGR, 0, -legUp * 0.55, -legW / 2 - 0.01);
    /* THE SHAPED BODY (entities/character.js TORSO block): the collar, the
       shoulder tops and the chest/back are a real surface now, not the old
       box faces + the slab. Re-seat the points that sit ON the torso so a hand
       lands on cloth, not a few centimetres in front of it (or inside it). */
    const TS = ch.torsoShape;
    if (TS && typeof ch.torsoFrontZ === "function") {
      const fz = (x, y) => ch.torsoFrontZ(x, y), bz = (x, y) => ch.torsoBackZ(x, y);
      const topAt = (x) => {                      // the shoulder's top surface over |x|
        let y = TS.shoulderY;
        for (let k = 0; k < 40; k++) { const yy = TS.shoulderY + (TS.yN - TS.shoulderY) * k / 40; if (TS.at(yy).a >= Math.abs(x)) y = yy; }
        return y;
      };
      const cy = TS.yN - TS.tf - 0.05 * TS.vs;
      put("collarL", F_BODY, 0.15, cy, fz(0.15, cy) + 0.03);
      put("collarR", F_BODY, -0.15, cy, fz(-0.15, cy) + 0.03);
      put("chest", F_BODY, 0, shY - 0.30, fz(0, shY - 0.30) + 0.01);
      put("back", F_BODY, 0, shY - 0.24, bz(0, shY - 0.24) - 0.01);
      put("chestL", F_BODY, 0.20, shY - 0.26, fz(0.20, shY - 0.26) + 0.015);
      put("chestR", F_BODY, -0.20, shY - 0.26, fz(-0.20, shY - 0.26) + 0.015);
      put("backCollar", F_BODY, 0, TS.yN - 0.02, bz(0, TS.yN - 0.02) - 0.015);
      // (a body carried over the shoulder still rests on the old column top: the
      // grip and the two torsos stay where the carry solve was tuned)
      put("shoulderTopL", F_BODY, armX * 0.62, Math.max(topAt(armX * 0.62) + 0.01, neckY + 0.02), 0);
      put("shoulderTopR", F_BODY, -armX * 0.62, Math.max(topAt(armX * 0.62) + 0.01, neckY + 0.02), 0);
    }
    ch._vcl = T; ch._vclP = ch.profile;
    return T;
  }
  function frameOf(ch, f) {
    switch (f) {
      case F_BODY: return ch.body;
      case F_NECK: return ch.neck || ch.body;
      case F_LA: return ch.parts && ch.parts.la;
      case F_RA: return ch.parts && ch.parts.ra;
      case F_LOWLA: return ch.low && ch.low.la;
      case F_LOWRA: return ch.low && ch.low.ra;
      case F_LEGL: return ch.parts && ch.parts.rl;
      case F_LEGR: return ch.parts && ch.parts.ll;
    }
    return ch.body;
  }
  // one point, world space. `fresh` = the caller already updated the matrices.
  function contactPoint(ch, name, out, fresh) {
    const i = CPI[name];
    if (i == null || !ch || !ch.body) return null;
    const T = localTable(ch), j = i * 4;
    const fr = frameOf(ch, T[j]);
    if (!fr) return null;
    if (!fresh) ch.group.updateMatrixWorld(true);
    return out.set(T[j + 1], T[j + 2], T[j + 3]).applyMatrix4(fr.matrixWorld);
  }
  // every point, into a reused object of Vector3s
  function contacts(ch, out) {
    if (!ch || !ch.body) return null;
    out = out || ch._vc;
    if (!out) {
      out = ch._vc = {};
      for (let i = 0; i < CP.length; i++) out[CP[i]] = new THREE.Vector3();
    }
    ch.group.updateMatrixWorld(true);
    const T = localTable(ch);
    for (let i = 0; i < CP.length; i++) {
      const j = i * 4, fr = frameOf(ch, T[j]);
      const v = out[CP[i]] || (out[CP[i]] = new THREE.Vector3());
      if (fr) v.set(T[j + 1], T[j + 2], T[j + 3]).applyMatrix4(fr.matrixWorld);
    }
    return out;
  }

  /* THE HAND THAT TOUCHES. Bodies wear the first-person hand now (character.js
     HANDS block): it hangs from the wrist crease and a HOLD pose slides it so
     its grip centre sits near the socket. What must land on a collar is the
     closed hand's grip centre (or the palm of an open hand), not the socket
     charArmTo places, so the solve walks the socket until THAT point lands. */
  const HOLD = { pistol: 1, grip: 1, support: 1, cupover: 1, wheel: 1 };
  function handMesh(ch, arm) {
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const m = part && part.userData && part.userData.cap;
    return m && m.userData && m.userData.fit ? m : null;
  }
  function handPoint(ch, arm, out) {
    const m = handMesh(ch, arm), H = CBZ.fpHands;
    if (!m || !H) {
      const s = ch.sockets && (arm === "l" ? ch.sockets.leftHand : ch.sockets.rightHand);
      if (!s) return null;
      s.updateWorldMatrix(true, false);
      return s.getWorldPosition(out);
    }
    const pose = m.userData.handPose;
    if (HOLD[pose] && H.gripCentre) { H.gripCentre(pose, out); if (m.userData.side < 0) out.x = -out.x; }
    else { const L = (H.PALM && H.PALM.len) || 0.096; out.set(0, 0, -L * (pose === "fist" ? 0.75 : 0.62)); }
    m.updateWorldMatrix(true, false);
    return out.applyMatrix4(m.matrixWorld);
  }
  function setHand(ch, arm, pose) {
    if (!ch || !pose) return;
    if (typeof ch.setHandPose === "function") ch.setHandPose(arm, pose);
    else if (CBZ.charSetHandPose) CBZ.charSetHandPose(ch, arm, pose);
  }
  function handPoseOf(ch, arm) { const m = handMesh(ch, arm); return m ? m.userData.handPose : null; }
  /* PUT THIS HAND THERE. CBZ.charArmTo first, measured from the POSE's own
     shoulder (so protraction never accumulates against whatever an earlier
     layer latched as rest) and aimed so the HAND POINT lands, not the socket.
     Its closed form has two limits a two-person verb runs into: no roll on the
     upper arm (the elbow always hangs in the vertical plane through the
     shoulder, so an arm cannot go AROUND a neck) and a shoulder roll capped
     short of 90 degrees (so a hand cannot cross the body's midline at chest
     height: a hostage's hand to his own throat). When a verb names an elbow
     POLE, or charArmTo leaves the hand off target, solveArm below does it
     exactly. Returns the hand point's residual in metres. */
  const _hp = new THREE.Vector3(), _hs = new THREE.Vector3(), _ht = new THREE.Vector3();
  function handTo(ch, arm, point, k, pole) {
    if (!ch.parts) return null;
    const part = arm === "l" ? ch.parts.la : ch.parts.ra;
    if (!part) return null;
    if (!pole && CBZ.charArmTo) {
      const sock = ch.sockets && (arm === "l" ? ch.sockets.leftHand : ch.sockets.rightHand);
      const ud = part.userData, old = ud._armRestZ;
      ud._armRestZ = part.position.z;
      _ht.copy(point);
      let r = null;
      const iters = k >= 0.999 ? 3 : 1;
      for (let i = 0; i < iters; i++) {
        if (sock && handPoint(ch, arm, _hp)) {
          sock.updateWorldMatrix(true, false);
          sock.getWorldPosition(_hs);
          _ht.copy(point).sub(_hp).add(_hs);          // where the socket must go
        }
        r = CBZ.charArmTo(ch, _ht, arm, k);
        if (r == null) break;
      }
      ud._armRestZ = old;
      if (r != null && handPoint(ch, arm, _hp)) {
        const res = _hp.distanceTo(point);
        if (res < 0.012 || k < 0.999) return res;
      }
    }
    solveArm(ch, arm, point, k, pole);
    return handPoint(ch, arm, _hp) ? _hp.distanceTo(point) : null;
  }
  /* The exact two-bone solve, in quaternions (no Euler limits): the elbow
     angle from the triangle shoulder / elbow / HAND POINT (which is rigid in
     the elbow frame, whatever the hand pose), then the one shoulder rotation
     that points the chain at the target, then a twist about the shoulder->hand
     line that puts the elbow toward the pole (default: down, out, a little
     back, the way a relaxed elbow hangs). */
  const _sT = new THREE.Vector3(), _sF = new THREE.Vector3(), _sU = new THREE.Vector3(), _sE = new THREE.Vector3();
  const _sP = new THREE.Vector3(), _sW = new THREE.Vector3(), _sC = new THREE.Vector3();
  const _sQ = new THREE.Quaternion(), _sQ2 = new THREE.Quaternion(), _sQb = new THREE.Quaternion();
  function solveArm(ch, arm, point, k, pole) {
    const part = arm === "l" ? ch.parts.la : ch.parts.ra;
    const low = part && part.userData && part.userData.low;
    if (!low || !ch.body || !handPoint(ch, arm, _hp)) return;
    const side = arm === "l" ? 1 : -1;
    const kk = k == null ? 1 : Math.max(0, Math.min(1, k));
    // the hand point, rigid in the ELBOW frame
    low.updateWorldMatrix(true, false);
    _sF.copy(_hp); low.worldToLocal(_sF);
    // the target, in the shoulder's parent (body) frame, from the shoulder
    ch.body.updateWorldMatrix(true, false);
    _sT.copy(point); ch.body.worldToLocal(_sT);
    _sW.copy(_sT).sub(part.position);
    let d = _sW.length();
    if (d < 1e-4) return;
    const L1 = -low.position.y;
    const fy = _sF.y, fz = _sF.z, R = Math.hypot(fy, fz);
    const Fn2 = _sF.lengthSq();
    // out of reach: lead with the shoulder (protraction, capped as charArmTo does)
    const dMax = Math.sqrt(L1 * L1 + Fn2 + 2 * L1 * R) * 0.998;
    if (d > dMax && _sW.z > 0) {
      const push = Math.min(0.24, d - dMax);
      part.position.z += push * kk;
      _sW.copy(_sT).sub(part.position); d = _sW.length();
    }
    const dMin = Math.sqrt(Math.max(1e-6, L1 * L1 + Fn2 - 2 * L1 * R)) * 1.02;
    const dd = Math.max(dMin, Math.min(dMax, d));
    // |e0 + Rx(t) f|^2 = dd^2  ->  fy cos t - fz sin t = c
    const c = (L1 * L1 + Fn2 - dd * dd) / (2 * L1);
    const phi = Math.atan2(fz, fy);
    const ac = Math.acos(Math.max(-1, Math.min(1, c / (R || 1e-6))));
    let t1 = ac - phi, t2 = -ac - phi;
    t1 = wrap(t1); t2 = wrap(t2);
    // the elbow folds FORWARD only (x <= 0): take the solution that does
    let th = (t1 <= 0.02 && (t2 > 0.02 || t1 > t2)) ? t1 : t2;
    if (th > 0.02) th = 0.02;
    // the chain, shoulder to hand, in the upper arm's frame
    const ct = Math.cos(th), st = Math.sin(th);
    _sU.set(_sF.x, -L1 + fy * ct - fz * st, fy * st + fz * ct).normalize();
    _sW.normalize();
    _sQ.setFromUnitVectors(_sU, _sW);
    // twist about the target line so the elbow faces the pole
    _sE.set(0, -L1, 0).applyQuaternion(_sQ);
    if (pole) { _sP.copy(pole); ch.body.worldToLocal(_sP); _sP.sub(part.position); }
    else _sP.set(side * 0.45, -1, -0.35);
    _sE.addScaledVector(_sW, -_sE.dot(_sW));
    _sP.addScaledVector(_sW, -_sP.dot(_sW));
    if (_sE.lengthSq() > 1e-8 && _sP.lengthSq() > 1e-8) {
      _sE.normalize(); _sP.normalize();
      let ang = Math.acos(Math.max(-1, Math.min(1, _sE.dot(_sP))));
      if (_sC.crossVectors(_sE, _sP).dot(_sW) < 0) ang = -ang;
      _sQ2.setFromAxisAngle(_sW, ang);
      _sQ.premultiply(_sQ2);
    }
    if (kk >= 0.999) part.quaternion.copy(_sQ);
    else { _sQb.copy(part.quaternion); _sQb.slerp(_sQ, kk); part.quaternion.copy(_sQb); }
    low.rotation.x += (th - low.rotation.x) * kk;
    low.rotation.y += (0 - low.rotation.y) * kk;
    low.rotation.z += (0 - low.rotation.z) * kk;
    part.updateMatrixWorld(true);
  }

  /* ============================================================
     WORLD CONTEXT — what is in front of this body
     ============================================================ */
  const _cols = [];
  const _ctx = { kind: "open", point: { x: 0, y: 0, z: 0 }, dist: 0, drop: 0, surfaceY: 0, obj: null, top: 0 };
  function isWater(x, y, z) {
    if (CBZ.waterSubmergence) {
      const d = CBZ.waterSubmergence(x, y + 0.05, z);
      if (d > 0.45) return true;
    }
    if (mode() === "city" && CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)) return true;
    return false;
  }
  // ray (px,pz)+(dx,dz)t vs a collider footprint padded by `pad`; entry t or -1
  function rayHit(c, px, pz, dx, dz, pad) {
    let ox = px, oz = pz, vx = dx, vz = dz, minX, maxX, minZ, maxZ;
    if (c.yaw && c.hw != null) {
      const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
      const rx = px - c.cx, rz = pz - c.cz;
      ox = rx * co - rz * si; oz = rx * si + rz * co;
      vx = dx * co - dz * si; vz = dx * si + dz * co;
      minX = -c.hw - pad; maxX = c.hw + pad; minZ = -c.hd - pad; maxZ = c.hd + pad;
    } else {
      if (c.minX == null) return -1;
      minX = c.minX - pad; maxX = c.maxX + pad; minZ = c.minZ - pad; maxZ = c.maxZ + pad;
    }
    let t0 = -1e9, t1 = 1e9;
    if (Math.abs(vx) < 1e-9) { if (ox < minX || ox > maxX) return -1; }
    else { let a = (minX - ox) / vx, b = (maxX - ox) / vx; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
    if (Math.abs(vz) < 1e-9) { if (oz < minZ || oz > maxZ) return -1; }
    else { let a = (minZ - oz) / vz, b = (maxZ - oz) / vz; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
    if (t1 < t0 || t1 < 0) return -1;
    return t0 < 0 ? 0 : t0;
  }
  function setCtx(o, kind, px, pz, dx, dz, t, feetY) {
    o.kind = kind; o.dist = t;
    o.point.x = px + dx * t; o.point.z = pz + dz * t; o.point.y = feetY;
  }
  /* context(pos, dir, reach, out) -> { kind, point, dist, drop, surfaceY, obj }
     kind: "wall" | "rail" | "ledge" | "water" | "bed" | "table" | "open" —
     the NEAREST of them along dir within reach wins. */
  function context(pos, dir, reach, out) {
    const o = out || _ctx;
    const px = pos.x, pz = pos.z, feetY = pos.y || 0;
    let dx = dir.x, dz = dir.z;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    reach = reach > 0 ? reach : 1.5;
    o.kind = "open"; o.dist = reach; o.drop = 0; o.surfaceY = feetY; o.obj = null; o.top = 0;
    o.point.x = px + dx * reach; o.point.z = pz + dz * reach; o.point.y = feetY;
    let best = reach + 1e-3;
    const cityOn = mode() === "city";
    // 1) SOLIDS along the line: a wall, or something waist-high
    if (CBZ.queryCollidersNear) {
      const list = CBZ.queryCollidersNear(px + dx * reach * 0.5, pz + dz * reach * 0.5, reach * 0.5 + 1.2, _cols);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c || c._city && !cityOn) continue;
        if (c.noVerb || c.walkable) continue;
        const t = rayHit(c, px, pz, dx, dz, 0.28);
        if (t < 0 || t >= best) continue;
        const y0 = c.y0 != null ? c.y0 : -1e9, y1 = c.y1 != null ? c.y1 : 1e9;
        if (y0 > feetY + 1.5) continue;                    // overhead: an awning, a sill above
        const top = y1 - feetY;
        if (top < 0.42) continue;                          // a kerb, a step: walked over, not hit
        let kind;
        if (top > 1.3) kind = "wall";
        else {
          // waist-high: what is BEYOND it decides rail / table / low wall
          const bx = px + dx * (t + 0.9), bz = pz + dz * (t + 0.9);
          const gB = groundY(bx, bz, feetY + 0.3);
          const drop = feetY - gB;
          if (drop > 0.5 || isWater(bx, gB, bz)) { kind = "rail"; o.drop = Math.max(0, drop); }
          else if (top <= 1.0) { kind = "table"; o.surfaceY = y1; }
          else kind = "wall";
        }
        best = t;
        setCtx(o, kind, px, pz, dx, dz, t, feetY);
        o.obj = c; o.top = y1;
        if (kind !== "table") o.surfaceY = feetY;
      }
    }
    // 2) THE GROUND along the line: a drop is a ledge, water is water
    const step = 0.2;
    let prevG = feetY;
    for (let s = step; s < best + 1e-4 && s <= reach + 1e-4; s += step) {
      const x = px + dx * s, z = pz + dz * s;
      const g = groundY(x, z, feetY + 0.3);
      if (isWater(x, Math.min(g, feetY), z)) {
        best = s; setCtx(o, "water", px, pz, dx, dz, s, feetY);
        o.drop = Math.max(0, feetY - g); o.obj = null;
        o.surfaceY = CBZ.waterSubmergence ? g + CBZ.waterSubmergence(x, g, z) : g;
        break;
      }
      if (feetY - g > 1.0) {
        best = s - step * 0.5; setCtx(o, "ledge", px, pz, dx, dz, best, feetY);
        o.drop = feetY - g; o.surfaceY = g; o.obj = null;
        break;
      }
      prevG = g;
    }
    // 3) A BED within reach, roughly on the line
    if (CBZ.propNearestBed) {
      const mx = px + dx * reach * 0.5, mz = pz + dz * reach * 0.5;
      const b = CBZ.propNearestBed(mx, mz, reach * 0.5 + 1.2, feetY);
      if (b) {
        const rx = b.x - px, rz = b.z - pz;
        const along = rx * dx + rz * dz, side = Math.abs(rx * dz - rz * dx);
        const t = Math.max(0, along - 0.45);
        if (along > 0 && t < best && side < 1.1) {
          best = t; setCtx(o, "bed", px, pz, dx, dz, t, feetY);
          o.point.x = b.x; o.point.z = b.z; o.surfaceY = b.top != null ? b.top : feetY + 0.55;
          o.obj = b; o.drop = 0;
        }
      }
    }
    // 4) A TABLE-HEIGHT deck (a platform top 0.45..1.0 over the feet, small)
    const plats = CBZ.platforms;
    if (plats && plats.length && plats.length < 4000) {
      for (let i = 0; i < plats.length; i++) {
        const p = plats[i];
        if (!p || p.ramp || p.minX == null) continue;
        const top = p.top - feetY;
        if (top < 0.45 || top > 1.0) continue;
        if (p.maxX - p.minX > 4 || p.maxZ - p.minZ > 4) continue;
        const t = rayHit(p, px, pz, dx, dz, 0.2);
        if (t < 0 || t >= best) continue;
        best = t; setCtx(o, "table", px, pz, dx, dz, t, feetY);
        o.surfaceY = p.top; o.obj = p; o.drop = 0;
      }
    }
    void prevG;
    return o;
  }

  /* ============================================================
     OWNERSHIP + HANDOFFS
     ============================================================ */
  function grappleSteps(a) {
    // grapple.js integrates CBZ.bots / cityPeds / cityCops outside the prison
    if (!CBZ.body || !a || mode() === "escape") return false;
    return (CBZ.bots && CBZ.bots.indexOf(a) >= 0) ||
      (CBZ.cityPeds && CBZ.cityPeds.indexOf(a) >= 0) ||
      (CBZ.cityCops && CBZ.cityCops.indexOf(a) >= 0);
  }
  // the prison cast: entities/npc.js + guards.js skip a body V.held() names
  function prisonCast(a) {
    return mode() === "escape" && ((CBZ.npcs && CBZ.npcs.indexOf(a) >= 0) || (CBZ.guards && CBZ.guards.indexOf(a) >= 0));
  }
  /* OWN a body: its own game stops moving and animating it while a verb has it,
     and the verb animates it instead. Bodies grapple.js steps are owned through
     its _phys.heldBy (every mover already skips CBZ.body.busy); the prison cast
     through V.held(), which entities/npc.js and entities/guards.js ask. The
     player is never owned (his controller is his). */
  function own(a, tok) {
    if (!a || isPlayerA(a)) return false;
    if (grappleSteps(a) && CBZ.body.phys) {
      const p = CBZ.body.phys(a);
      p.heldBy = tok; p.down = 0; p.air = false; p.kx = p.kz = 0; p.vx = p.vy = p.vz = 0;
      return true;
    }
    return prisonCast(a);
  }
  /* a STRIKE fall (entities/meleeposes.js) ends the instant a verb picks the
     body up: the carry / drag pose owns every joint from here, and the fall's
     model offsets are refunded the way its own getup refunds them */
  function endFall(ch) {
    const f = ch && ch.fall;
    if (!f || !f.on) return;
    f.on = false; f.phase = ""; f.hold = false;
    const m = ch.model;
    if (m) {
      m.position.y -= ch._mMy || 0; m.position.z -= ch._mMz || 0; m.position.x -= ch._mMx || 0;
      m.rotation.y -= ch._mMr || 0;
    }
    ch._mMy = ch._mMz = ch._mMx = ch._mMr = 0;
  }
  function disown(a, tok) {
    const p = a && a._phys;
    if (p && p.heldBy === tok) p.heldBy = null;
  }
  // put the group upright again, keeping its yaw
  function uprightGroup(B) {
    const g = B.ch && B.ch.group;
    if (!g) return;
    const yaw = B._yawLock != null ? B._yawLock : g.rotation.y;
    g.rotation.order = "XYZ";
    g.rotation.set(0, yaw, 0);
    B._yawLock = null;
  }
  const _eul = new THREE.Euler(0, 0, 0, "YXZ");
  // orient a root: pitch about the body's OWN right axis after the yaw
  function orient(B, yaw, pitch, roll) {
    const g = B.ch && B.ch.group;
    if (!g) return;
    if (!pitch && !roll) {
      if (g.rotation.order !== "XYZ") g.rotation.order = "XYZ";
      g.rotation.set(0, yaw, 0);
      B._yawLock = null;
      return;
    }
    _eul.set(pitch, yaw, roll || 0, "YXZ");
    g.quaternion.setFromEuler(_eul);
    B._yawLock = yaw;
  }

  /* KNOCKDOWN HANDOFF: STRIKE's fall if it has shipped, else grapple's
     physics knockdown for the bodies grapple integrates, else our own lie +
     get-up for everybody else (prison, studio pages). */
  // lying: he is ALREADY on his back (a landing, a tackle, a body set down),
  // so the fall starts at "down" instead of standing him up to fall again
  function knock(a, dir, dur, lying) {
    if (!a) return;
    const B = body(a);
    if (typeof V.knockdown === "function" && V.knockdown !== ownKnock && B.ch) {
      try {
        if (lying) uprightGroup(B);
        V.knockdown(a, { dir: dir, dur: dur, variant: lying ? "back" : undefined });
        const f = B.ch.fall, MP = CBZ.meleePoses;
        if (lying && f && f.on && MP && MP.fallTimes) { f.t = MP.fallTimes(f.variant || "back").fall; f.phase = "down"; }
        return;
      } catch (e) { /* fall through */ }
    }
    if (grappleSteps(a) && CBZ.body.knockdown) {
      CBZ.body.knockdown(a, { dir: dir, t: dur, force: 2 });
      return;
    }
    ownKnock(a, dir, dur, B);
  }
  function ownKnock(a, dir, dur, B) {
    B = B || body(a);
    const f = flightOf(a) || newFlight(a, B);
    f.mode = "down"; f.t = 0; f.dur = dur || 1.4;
    f.yaw = dir ? Math.atan2(dir.x, dir.z) + PI : B.yaw();
    f.surface = f.surface || null;
  }

  /* ============================================================
     BALLISTIC BODIES the verbs threw (and our own down/get-up)
     ============================================================ */
  const flights = [];
  const FLIGHT_TOK = { verb: "flight" };      // grapple.js leaves a body held by a verb to the verb
  function flightOf(a) { for (let i = 0; i < flights.length; i++) if (flights[i].a === a) return flights[i]; return null; }
  function newFlight(a, B) {
    const f = {
      a: a, B: B, mode: "air", t: 0, dur: 0, vx: 0, vy: 0, vz: 0, spin: 0, roll: 0,
      pitch: 0, rollA: 0, yaw: B.yaw(), surface: null, kind: "open", seed: Math.random(),
      slammed: false, landed: false, onLand: null,
    };
    flights.push(f);
    own(a, FLIGHT_TOK);
    a._verbDown = true;
    return f;
  }
  function endFlight(f, i) {
    flights.splice(i, 1);
    disown(f.a, FLIGHT_TOK);
    f.a._verbDown = false;
  }
  const _fp = new THREE.Vector3();
  function stepFlights(dt) {
    const vp = VP();
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i], a = f.a, B = body(a);
      if (!B.pos || !B.ch) { endFlight(f, i); continue; }
      f.t += dt;
      if (f.mode === "air") {
        f.vy -= G() * dt;
        const n = Math.max(1, Math.ceil(Math.hypot(f.vx, f.vy, f.vz) * dt / 0.25));
        const sdt = dt / n;
        let landed = false;
        for (let s = 0; s < n && !landed; s++) {
          const x0 = B.pos.x, z0 = B.pos.z;
          _fp.set(x0 + f.vx * sdt, B.pos.y + f.vy * sdt, z0 + f.vz * sdt);
          if (CBZ.collide) {
            const bx = _fp.x, bz = _fp.z;
            CBZ.collide(_fp, B.radius * 0.9, _fp.y + (f.clearY || 0.25), _fp.y + 1.6);
            const cdx = _fp.x - bx, cdz = _fp.z - bz, cd = Math.hypot(cdx, cdz);
            if (cd > 0.004) {
              const nx = cdx / cd, nz = cdz / cd;
              const into = -(f.vx * nx + f.vz * nz);
              if (into > 1) {
                if (CBZ.trauma && CBZ.trauma.slam) CBZ.trauma.slam(a, into, { wall: true, dir: { x: nx, z: nz } });
                if (into > 4 && CBZ.goreImpact) CBZ.goreImpact(_fp.x - nx * B.radius, _fp.y + 1.1, _fp.z - nz * B.radius, { dir: { x: -nx, y: 0, z: -nz }, amount: Math.min(1.2, 0.25 + into * 0.08), wall: true });
                if (CBZ.sfx && into > 3) CBZ.sfx("hit");
                f.vx += nx * into * 1.25; f.vz += nz * into * 1.25;
                f.slammed = true;
              }
            }
          }
          // a bed / table surface catches a body over it
          let floor;
          if (f.surface && Math.hypot(_fp.x - f.surface.x, _fp.z - f.surface.z) < f.surface.r) floor = f.surface.y;
          else floor = groundY(_fp.x, _fp.z, Math.max(_fp.y, B.pos.y) + 0.05);
          if (_fp.y <= floor && f.vy <= 0) { _fp.y = floor; landed = true; }
          setPos(B, _fp.x, _fp.y, _fp.z);
        }
        f.pitch += f.spin * dt;
        f.rollA += f.roll * dt;
        orient(B, f.yaw, f.pitch, f.rollA);
        if (vp) { _pp.k = 1; _pp.t = f.t; _pp.seed = f.seed; _pp.phase = "hold"; _pp.moving = false; vp.set(B.ch, "t.flight", _pp, 14); vp.write(B.ch, dt); }
        if (landed) {
          const impact = -f.vy, speed = Math.hypot(f.vx, f.vz);
          f.landed = true;
          const water = isWater(B.pos.x, B.pos.y, B.pos.z);
          if (!water && CBZ.trauma && CBZ.trauma.slam) CBZ.trauma.slam(a, Math.max(impact, speed * 0.6) * (f.surface && f.kind === "bed" ? 0.3 : 1), { dir: { x: 0, y: 1, z: 0 } });
          if (CBZ.sfx && impact > 6) CBZ.sfx(water ? "splash" : "hit");
          if (water && CBZ.splash) { try { CBZ.splash(B.pos.x, B.pos.y, B.pos.z, 1); } catch (e) {} }
          const dirv = speed > 0.3 ? _dirOut(f.vx / speed, f.vz / speed) : _dirOut(Math.sin(f.yaw + PI), Math.cos(f.yaw + PI));
          const onLand = f.onLand;
          f.onLand = null;
          if (f.surface) {
            // a bed or a table: he lies on IT, we keep him there
            f.mode = "down"; f.t = 0; f.dur = f.kind === "bed" ? 2.4 : 1.6;
            f.vx = f.vy = f.vz = 0;
          } else if (water) {
            // IN THE WATER: no knockdown on a sea bed. He comes up and the
            // mode's own swimmer takes him (survivorbot / city swim, the
            // shared poseSwimmer) the moment nothing owns the body.
            endFlight(f, i);
            uprightGroup(B);
            if (vp) vp.kill(B.ch);
          } else {
            endFlight(f, i);
            orient(B, f.yaw, -PI / 2 * 0.98, 0);
            if (vp) vp.clear(B.ch);
            knock(a, dirv, 1.4 + Math.min(1.2, impact * 0.05), true);
          }
          if (onLand) { try { onLand(f); } catch (e) {} }
        }
        continue;
      }
      // DOWN: on his back where he landed, then up again
      const up = f.t > f.dur;
      const k = up ? smooth((f.t - f.dur) / 0.7) : 1;
      const lie = -PI / 2 * 0.98;
      if (!up) f.pitch = lerp(f.pitch, lie, 1 - Math.exp(-12 * dt));
      else f.pitch = lie * (1 - k);
      let sy = B.pos.y;
      if (f.surface) sy = f.surface.y + B.depth * Math.min(1, Math.abs(f.pitch) / (PI / 2));
      else sy = groundY(B.pos.x, B.pos.z, B.pos.y + 0.3) + B.depth * Math.min(1, Math.abs(f.pitch) / (PI / 2)) * 0.2;
      if (up && f.surface) {
        // off the bed: stand beside it
        sy = lerp(sy, groundY(B.pos.x, B.pos.z, f.surface.y - 0.2), k);
      }
      setPos(B, B.pos.x, sy, B.pos.z);
      orient(B, f.yaw, f.pitch, 0);
      if (vp) {
        _pp.k = 1; _pp.t = f.t; _pp.seed = f.seed; _pp.phase = "hold"; _pp.moving = false;
        if (!up || k < 0.6) { vp.set(B.ch, "t.down", _pp, 8); }
        vp.write(B.ch, dt);
      }
      if (up && k >= 1) {
        endFlight(f, i);
        uprightGroup(B);
        if (!f.surface) { /* on his feet where he lay */ }
        if (vp) vp.clear(B.ch);
      }
    }
  }
  const _dv = { x: 0, z: 0 };
  function _dirOut(x, z) { _dv.x = x; _dv.z = z; return _dv; }

  /* LAUNCH a body with a world outcome. Bodies grapple integrates go through
     CBZ.body.hit/fling (its landing is groundAt-aware now); a rail, a bed or a
     table need a controlled arc, and every body grapple does not integrate
     (prison, studio) flies here. */
  function launch(a, kind, ctx, dir, power, S) {
    const B = body(a);
    if (!B.pos) return;
    let dx = dir.x, dz = dir.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    power = power == null ? 1 : power;
    const gy = G();
    let vh = 3.4 * power, vy = 1.8, surface = null;
    const dist = ctx ? Math.max(0.1, ctx.dist) : 1;
    switch (kind) {
      case "wall": vh = 5.2 * power + 1.5; vy = 0.9; break;
      case "rail": {
        // clear the top: hips go over, the tumble tips him
        const h = Math.max(0.3, (ctx.top || (B.pos.y + 1.1)) - B.pos.y) + 0.12;
        vh = Math.max(3.2, 3.8 * power);
        const tr = Math.max(0.12, (dist + 0.15) / vh);
        vy = (h + 0.5 * gy * tr * tr) / tr;
        break;
      }
      case "ledge": vh = 3.2 * power + 1.0; vy = 1.6; break;
      case "water": vh = 3.6 * power + 0.8; vy = 2.4; break;
      case "bed": case "table": {
        const T = 0.5;
        const tx = ctx.point.x - B.pos.x, tz = ctx.point.z - B.pos.z;
        const d = Math.hypot(tx, tz);
        vh = d / T;
        if (d > 0.01) { dx = tx / d; dz = tz / d; }
        vy = ((ctx.surfaceY - B.pos.y) + 0.5 * gy * T * T) / T;
        surface = { x: ctx.point.x, z: ctx.point.z, y: ctx.surfaceY, r: 1.2 };
        break;
      }
      default: vh = 3.2 * power + 0.6; vy = 1.5 + 1.2 * power;
    }
    if (S && S.verb === "throw") { vh *= 1.45; vy += kind === "bed" || kind === "table" || kind === "rail" ? 0 : 1.2; }
    if (B.isPlayer) {
      // THE PLAYER'S FLIGHT IS HIS OWN CONTROLLER'S (systems/physics.js flies
      // CBZ.player._phys.air and lands it on groundAt, then puts him on his
      // back): a verb only hands it the launch. A rail or a bed is just the air.
      const P = CBZ.player;
      const ph = P._phys || (CBZ.body && CBZ.body.phys ? CBZ.body.phys(a) : (P._phys = { kx: 0, kz: 0, fl: 0, air: false, vx: 0, vy: 0, vz: 0, spin: 0, down: 0 }));
      ph.air = true; ph.vx = dx * vh; ph.vz = dz * vh; ph.vy = Math.min(vy, 6);
      ph.spin = -2.4 * (0.8 + 0.4 * power);
      return;
    }
    const own = !surface && kind !== "rail" && grappleSteps(a);
    if (own && CBZ.body.hit) {
      const p = CBZ.body.phys(a);
      if (p.heldBy === S) p.heldBy = null;
      CBZ.body.hit(a, { dir: { x: dx, z: dz }, force: vh, fling: vy });
      return;
    }
    const f = flightOf(a) || newFlight(a, B);
    f.mode = "air"; f.t = 0; f.kind = kind; f.surface = surface; f.clearY = kind === "rail" ? 0.8 : 0.25;
    f.vx = dx * vh; f.vz = dz * vh; f.vy = vy;
    f.yaw = B.yaw();
    // tumble ABOUT HIS OWN right axis, backward when shoved from the front
    const facing = Math.sin(f.yaw) * dx + Math.cos(f.yaw) * dz;
    f.spin = (facing > 0 ? 1 : -1) * (kind === "rail" ? 5.5 : kind === "bed" || kind === "table" ? 2.6 : 3.2) * (0.8 + 0.4 * power);
    if (kind === "bed" || kind === "table") f.spin = -Math.abs(f.spin);
    f.roll = (f.seed - 0.5) * 1.6;
    f.pitch = 0; f.rollA = 0;
  }

  /* ============================================================
     SESSIONS
     ============================================================ */
  const PH = ["approach", "align", "contact", "drive", "outcome", "hold", "release"];
  // verbs done standing in one spot (an NPC grabber is held there, see enterPhase)
  const STILL = { cuff: 1, uncuff: 1, frisk: 1, mug: 1, shove: 1, throw: 1, grab: 1, carry: 1 };
  const sessions = [];
  const _pp = { k: 0, t: 0, phase: "", moving: false, sag: 0, crouch: 0, seed: 0, ground: false, verb: "", strain: 0, writhe: 0 };
  const _W = new THREE.Vector3(), _C = new THREE.Vector3(), _R = new THREE.Vector3();

  // hands-on weight for the ordinary shape of a verb
  function kIn(S) {
    switch (S.phase) {
      case "contact": return smooth(S.k);
      case "drive": case "outcome": case "hold": return 1;
      case "release": return 1 - smooth(S.k / 0.6);
    }
    return 0;
  }
  function kGrip(S) {
    switch (S.phase) {
      case "drive": return smooth(S.k / 0.45);
      case "outcome": case "hold": return 1;
      case "release": return 1 - smooth(S.k / 0.5);
    }
    return 0;
  }
  function fwdX(yaw) { return Math.sin(yaw); }
  function fwdZ(yaw) { return Math.cos(yaw); }

  /* THE VERBS. Each is a small table the engine below drives:
       face     how the target ends up facing: "face" (face to face) or "same"
                (his back to the grabber)
       work(S)  working distance, root to root, from BOTH bodies' real depth
                and the grabber's real reach — never a typed constant
       dur(S,p) seconds per phase (approach is by distance, hold until released)
       hold     persistent verb (carry, drag, escort, shield, choke, grab)
       poseA/poseT(S)  which verbposes body each side wears this beat
       hands(S) who puts which hand on which contact point, and how hard
       place(S,o) where the target's root goes, in the grabber's frame
       outcome(S)  what happens when the world gets its say */
  const DEF = {};

  DEF.grab = {
    face: "face", hold: true, speed: 2.6, close: 1.0,
    work: (S) => S.A.depth + S.T.depth + 0.34 * S.A.arm,
    dur(S, ph) { return ph === "align" ? 0.16 : ph === "contact" ? 0.2 : ph === "drive" ? 0.42 : ph === "release" ? 0.3 : 0; },
    poseA: (S) => (S.phase === "drive" || S.phase === "hold" || S.phase === "outcome") ? "a.grip" : "a.reach",
    poseT: () => "t.collared",
    hands(S) {
      S.handsA[0] = "collarR"; S.handsA[1] = "collarL"; S.kA[0] = S.kA[1] = kIn(S);
      // a collared man goes for the wrists that have him
      S.handsT[0] = "wristR"; S.handsT[1] = "wristL"; S.kT[0] = S.kT[1] = kGrip(S);
    },
    place(S, o) {
      o.lz = S.work - (S.phase === "drive" ? 0.05 * Math.sin(PI * S.k) : 0);
      o.lx = 0; o.relYaw = PI;
    },
  };

  DEF.mug = { onExplicit: 2,
    face: "face", hold: false, speed: 2.6, close: 1.0,
    work: (S) => S.A.depth + S.T.depth + 0.34 * S.A.arm,
    dur(S, ph) { return ph === "align" ? 0.14 : ph === "contact" ? 0.2 : ph === "drive" ? 0.9 : ph === "outcome" ? 0.05 : ph === "release" ? 0.3 : 0; },
    poseA: (S) => (S.phase === "contact" || S.phase === "align" || S.phase === "approach") ? "a.reach" : "a.mug",
    poseT: () => "t.mugged",
    hands(S) {
      S.handsA[0] = "collarR"; S.kA[0] = kIn(S);
      // the other hand goes into his front pocket and comes back out
      S.handsA[1] = "hipL"; S.gA[1] = "card";
      S.kA[1] = S.phase === "drive" ? smooth((S.k - 0.15) / 0.3) * (1 - smooth((S.k - 0.8) / 0.2)) : 0;
      S.onA[1] = S.phase === "drive" && S.k > 0.45 && S.k < 0.8;
      S.handsT[0] = null; S.handsT[1] = "wristL"; S.kT[1] = kGrip(S);
    },
    place(S, o) { o.lz = S.work - (S.phase === "drive" ? 0.04 * smooth(S.k / 0.3) : 0); o.lx = 0; o.relYaw = PI; },
    outcome(S) { S.result = S.result || {}; S.result.outcome = "took"; },
  };

  DEF.shove = { onExplicit: 3, from: ["grab"],
    face: "face", hold: false, speed: 2.8, close: 1.0,
    work: (S) => S.A.depth + S.T.depth + 0.42 * S.A.arm,
    dur(S, ph) { return ph === "align" ? 0.1 : ph === "contact" ? 0.12 : ph === "drive" ? 0.42 : ph === "release" ? 0.45 : 0; },
    poseA: (S) => S.phase === "release" ? "a.follow" : (S.phase === "contact" || S.phase === "drive") ? "a.shove" : "a.reach",
    poseT: () => "t.shoved",
    hands(S) {
      S.handsA[0] = "chestR"; S.handsA[1] = "chestL"; S.gA[0] = S.gA[1] = "open";
      const k = S.phase === "drive" ? 1 - smooth((S.k - 0.64) / 0.14) : S.phase === "contact" ? smooth(S.k) : 0;
      S.kA[0] = S.kA[1] = k;
      S.onA[0] = S.onA[1] = S.phase === "drive" && S.k < 0.63 || (S.phase === "contact" && S.k >= 1);
    },
    place(S, o) {
      const push = S.phase === "drive" ? 0.12 * smooth((S.k - 0.3) / 0.35) : 0;
      o.lz = S.work + push; o.lx = 0; o.relYaw = PI;
    },
    enter(S, ph) {
      if (ph === "drive") S.ctx = copyCtx(S, context(S.T.pos, S.dir, 1.6));
    },
    outcome(S) { worldOutcome(S, 1.6); },
  };

  DEF.throw = { onExplicit: 15, from: ["grab", "carry"],
    face: "face", hold: false, speed: 2.6, close: 1.0,
    work: (S) => S.A.depth + S.T.depth + 0.34 * S.A.arm,
    dur(S, ph) {
      if (S.from === "carry") return ph === "drive" ? 0.4 : ph === "release" ? 0.45 : 0;
      if (S.from === "grab") return ph === "drive" ? 0.55 : ph === "release" ? 0.45 : 0;
      return ph === "align" ? 0.14 : ph === "contact" ? 0.18 : ph === "drive" ? 0.58 : ph === "release" ? 0.45 : 0;
    },
    poseA: (S) => S.phase === "release" ? "a.follow" : S.phase === "drive" ? (S.from === "carry" ? "a.carry" : "a.heave") : "a.reach",
    poseT: (S) => S.from === "carry" && S.phase === "drive" ? "t.draped" : S.phase === "drive" ? "t.heaved" : "t.collared",
    hands(S) {
      if (S.from === "carry") {
        S.handsA[0] = "thighBackR"; S.handsA[1] = "thighBackL"; S.gA[0] = S.gA[1] = "cupover";
        S.kA[0] = S.kA[1] = S.phase === "drive" ? 1 - smooth((S.k - 0.55) / 0.3) : 0;
        S.onA[0] = S.onA[1] = S.phase === "drive" && S.k < 0.5;
        return;
      }
      S.handsA[0] = "collarR"; S.handsA[1] = "collarL";
      const k = S.phase === "drive" ? 1 - smooth((S.k - 0.66) / 0.14) : kIn(S);
      S.kA[0] = S.kA[1] = S.phase === "release" ? 0 : k;
      S.onA[0] = S.onA[1] = (S.phase === "drive" && S.k < 0.64) || (S.phase === "contact" && S.k >= 1);
      S.handsT[0] = "wristR"; S.handsT[1] = "wristL";
      S.kT[0] = S.kT[1] = S.phase === "drive" ? (S.from === "grab" ? 1 : smooth(S.k / 0.3)) * (1 - smooth((S.k - 0.7) / 0.2)) : 0;
      S.onT[0] = S.onT[1] = S.phase === "drive" && S.k > (S.from === "grab" ? 0 : 0.3) && S.k < 0.7;
    },
    place(S, o) {
      o.relYaw = PI;
      if (S.from === "carry") { placeCarry(S, o, 1 - 0.55 * smooth(S.k)); o.liftUp = 0.25 * smooth(S.k); return; }
      // he swings WITH the grabber's shoulders (the same twist a.heave puts in
      // the torso), then is driven out along the line as the arms extend
      const k = S.phase === "drive" ? S.k : 0;
      const wind = smooth(k / 0.45), whip = smooth((k - 0.45) / 0.4);
      const tw = 0.8 * (0.42 * wind - 0.9 * whip);
      const r = S.work + 0.06 * whip;
      o.lx = r * Math.sin(tw);
      o.lz = r * Math.cos(tw);
      o.dy = 0.08 * Math.sin(PI * k) + 0.06 * whip;
      o.relYaw = PI + tw;
    },
    enter(S, ph) { if (ph === "drive") S.ctx = copyCtx(S, context(S.T.pos, S.dir, 3.2)); },
    outcome(S) { worldOutcome(S, 3.2); },
  };

  DEF.tackle = { onExplicit: 3, feetRel: true,
    face: "face", hold: false, speed: 6.5, close: 3.2,
    work: (S) => S.T.depth + Math.sin(1.0) * (S.A.shoulderY - S.A.hipY) + Math.cos(1.0) * S.A.depth + 0.03,
    dur(S, ph) {
      if (ph === "align") return 0.06;
      if (ph === "contact") return 0.12;
      if (ph === "drive") return 0.45;
      if (ph === "outcome") return S.result && S.result.outcome === "open" ? 0.9 : 0.2;
      if (ph === "release") return 0.5;
      return 0;
    },
    poseA: () => "a.tackle",
    poseT: () => "t.tackled",
    hands(S) {
      const ground = S.phase === "outcome" && S.result && S.result.outcome === "open";
      if (ground || (S.phase === "release" && S.result && S.result.outcome === "open")) {
        S.handsA[0] = "collarR"; S.handsA[1] = "collarL";
      } else { S.handsA[0] = "thighBackR"; S.handsA[1] = "thighBackL"; }   // a double-leg: arms round his thighs
      S.gA[0] = S.gA[1] = "open";
      const k = S.phase === "contact" ? smooth(S.k) : S.phase === "drive" ? 1
        : S.phase === "outcome" ? (S.result && S.result.outcome === "open" ? 1 : 0)
          : S.phase === "release" ? 1 - smooth(S.k / 0.4) : 0;
      S.kA[0] = S.kA[1] = k;
      S.onA[0] = S.onA[1] = (S.phase === "drive" && S.k > 0.01) || (S.phase === "outcome" && S.result && S.result.outcome === "open" && S.pt > 0.25);
    },
    place(S, o) {
      o.relYaw = PI; o.lx = 0; o.lz = S.work;
      if (S.phase === "drive") { o.pitch = (S.result && S.result.outcome === "wall" ? -0.12 : -0.55) * smooth(S.k); o.pitchA = (S.result && S.result.outcome === "wall" ? 0.05 : 0.25) * smooth(S.k); }
      else if ((S.phase === "outcome" || S.phase === "release") && S.result && S.result.outcome === "open") {
        placeTackleGround(S, o);
      }
    },
    enter(S, ph) {
      if (ph === "drive") {
        S.ctx = copyCtx(S, context(S.T.pos, S.dir, 1.4));
        S.result = S.result || {};
        S.result.outcome = S.ctx.kind === "bed" || S.ctx.kind === "table" ? "open" : S.ctx.kind;
        // the player is not launched off a ledge by a verb (his controller owns
        // his flight): a tackle on him is the ground or the wall
        if (S.T.isPlayer && S.result.outcome !== "wall") S.result.outcome = "open";
        // the drive goes as far as the world lets it
        S.travel = S.ctx.kind === "wall" ? Math.max(0, S.ctx.dist - 0.05) : S.ctx.kind === "open" || S.ctx.kind === "bed" || S.ctx.kind === "table" ? 0.9 : Math.min(0.9, S.ctx.dist);
        S.travelDone = 0;
      }
      if (ph === "outcome") {
        const kind = S.result.outcome;
        if (kind === "open") {
          // he goes down HERE; everything after is placed off this spot
          S._gx = S.T.pos.x; S._gz = S.T.pos.z;
          if (S.opts.onOutcome) { try { S.opts.onOutcome(S, kind); } catch (e) {} }
          S._cbDone = true;
          return;
        }
        if (kind === "wall") {
          // driven into it: the body stops on the wall and folds there
          const sp = 4.5;
          if (CBZ.trauma && CBZ.trauma.slam) CBZ.trauma.slam(S.t, sp, { wall: true, dir: { x: -S.dir.x, z: -S.dir.z } });
          if (CBZ.goreImpact) CBZ.goreImpact(S.ctx.point.x, S.T.pos.y + 1.1, S.ctx.point.z, { dir: { x: S.dir.x, y: 0, z: S.dir.z }, amount: 0.5, wall: true });
          if (CBZ.sfx) CBZ.sfx("hit");
          if (CBZ.shake && (S.A.isPlayer || S.T.isPlayer)) CBZ.shake(0.35);
          S.tFree = true;
          endTargetHold(S);
          knock(S.t, S.dir, 1.6);
        } else {
          // off a ledge, over a rail, into the water: he goes, you stop
          S.tFree = true;
          endTargetHold(S);
          launch(S.t, kind, S.ctx, S.dir, 1, S);
        }
      }
    },
  };

  DEF.cuff = {
    face: "same", hold: false, speed: 2.4, close: 1.0,
    work: (S) => S.A.depth + S.T.depth + 0.27 * S.A.arm,
    dur(S, ph) { return ph === "align" ? 0.45 : ph === "contact" ? 0.32 : ph === "drive" ? 0.6 : ph === "outcome" ? 0.12 : ph === "release" ? 0.35 : 0; },
    poseA: (S) => S.phase === "approach" || S.phase === "align" ? "a.reach" : "a.cuff",
    poseT: () => "t.cuffed",
    selfT(S) {       // his arms come behind his back as he is turned
      const k = S.phase === "align" ? 0.7 * smooth(S.k) : S.phase === "approach" ? 0 : 1;
      return k;
    },
    hands(S) {
      S.handsA[0] = "cuffGripL"; S.handsA[1] = "wristR"; S.gA[0] = "support";
      S.kA[0] = S.kA[1] = kIn(S);
    },
    place(S, o) { o.lz = S.work; o.lx = 0; o.relYaw = 0; },
    outcome(S) {
      setCuffs(S.t, S.verb === "cuff");
      S.result = S.result || {}; S.result.outcome = S.verb === "cuff" ? "cuffed" : "uncuffed";
      if (CBZ.sfx) CBZ.sfx("reload");
    },
  };
  DEF.uncuff = Object.assign({}, DEF.cuff);

  const FRISK_L = ["shoulderTopL", "ribsL", "waistL", "pocketL", "thighL"];
  const FRISK_R = ["shoulderTopR", "ribsR", "waistR", "pocketR", "thighR"];
  DEF.frisk = { onExplicit: 3,
    face: "same", hold: false, speed: 2.4, close: 1.0,
    work: (S) => S.A.depth + S.T.depth + 0.24 * S.A.arm,
    dur(S, ph) { return ph === "align" ? 0.4 : ph === "contact" ? 0.18 : ph === "drive" ? 2.0 : ph === "release" ? 0.35 : 0; },
    poseA: (S) => S.phase === "approach" || S.phase === "align" ? "a.reach" : "a.frisk",
    poseT: () => "t.frisked",
    hands(S) {
      let seg = 0, sub = 1;
      if (S.phase === "drive") { const f = S.k * 5; seg = Math.min(4, f | 0); sub = f - seg; }
      else if (S.phase === "release") seg = 4;
      S.handsA[0] = FRISK_L[seg]; S.handsA[1] = FRISK_R[seg]; S.gA[0] = S.gA[1] = "open";
      if (S.phase === "drive") {
        // travel to the next pair, then press: pat, pat
        const k = sub < 0.3 && seg > 0 ? 0.55 + 0.45 * smooth(sub / 0.3) : 1;
        S.kA[0] = S.kA[1] = k;
        S.onA[0] = S.onA[1] = sub >= 0.3 || seg === 0;
        S.press = sub >= 0.3 ? Math.abs(Math.sin((sub - 0.3) / 0.7 * PI * 2)) * 0.025 : 0;
      } else { S.kA[0] = S.kA[1] = kIn(S); S.press = 0; }
      S.crouch = S.phase === "drive" ? clamp01((S.k * 5 - 0.3) / 4) : S.phase === "release" ? 1 - smooth(S.k) : 0;
    },
    place(S, o) { o.lz = S.work; o.lx = 0; o.relYaw = 0; },
    outcome(S) { S.result = S.result || {}; S.result.outcome = "frisked"; },
  };

  DEF.drag = {
    face: "none", hold: true, speed: 2.4, close: 1.2, allowDown: true, needDown: true,
    work: (S) => 0,
    dur(S, ph) { return ph === "align" ? 0.45 : ph === "contact" ? 0.25 : ph === "drive" ? 0.35 : ph === "release" ? 0.55 : 0; },
    poseA: () => "a.drag",
    poseT: () => "t.dragged",
    hands(S) { S.handsA[0] = null; S.handsA[1] = "backCollar"; S.kA[1] = kIn(S); },
    place(S, o) { placeDrag(S, o); },
  };

  DEF.escort = {
    face: "same", hold: true, speed: 2.4, close: 1.0,
    work: (S) => S.A.depth + S.T.depth + 0.30 * S.A.arm,
    dur(S, ph) { return ph === "align" ? 0.35 : ph === "contact" ? 0.25 : ph === "drive" ? 0.15 : ph === "release" ? 0.3 : 0; },
    poseA: (S) => S.phase === "approach" ? "a.reach" : "a.escort",
    poseT: () => "t.cuffed",
    selfT(S) { return S.phase === "approach" ? 0 : S.phase === "align" ? smooth(S.k) : S.phase === "release" ? 1 - smooth(S.k) : 1; },
    hands(S) {
      S.handsA[0] = "upperArmL"; S.handsA[1] = "wristR"; S.gA[0] = "support";
      S.kA[0] = S.kA[1] = kIn(S);
    },
    place(S, o) { o.lz = S.work; o.lx = 0; o.relYaw = 0; },
  };

  DEF.choke = { onExplicit: 15,
    face: "same", hold: true, speed: 2.2, close: 1.0,
    work: (S) => S.A.depth + S.T.depth + 0.05,
    dur(S, ph) { return ph === "align" ? 0.3 : ph === "contact" ? 0.35 : ph === "drive" ? 0.55 : ph === "release" ? (S.how === "ko" ? 0.9 : 0.35) : 0; },
    poseA: () => "a.choke",
    poseT: () => "t.choked",
    hands(S) {
      // FOREARM CHOKE from behind: the right forearm across the front of his
      // throat (the elbow out at his right jaw, see pole), the left hand
      // pinning his left arm. (The rig's shoulders are 0.87 m apart against
      // an arm of 0.56 m, so the true rear-naked grip, a hand at the FAR side
      // of the neck, is out of any arm's reach.)
      S.handsA[0] = "shoulderTopL"; S.handsA[1] = "throat"; S.gA[0] = "grip"; S.gA[1] = "open"; S.gT[0] = S.gT[1] = "open";
      S.kA[0] = S.kA[1] = S.phase === "release" && S.how === "ko" ? 1 - smooth((S.k - 0.5) / 0.5) : kIn(S);
      S.onA[0] = S.onA[1] = S.phase === "drive" || S.phase === "hold" || (S.phase === "contact" && S.k >= 1);
      // he claws at the arm across his throat: the wrist at his windpipe,
      // the elbow under his right jaw
      S.handsT[0] = "forearmR"; S.handsT[1] = "elbowR";
      const claw = S.phase === "hold" ? 1 - smooth((S.sag - 0.75) / 0.25) : kGrip(S);
      S.kT[0] = S.kT[1] = claw;
      S.onT[0] = S.onT[1] = (S.phase === "drive" && S.k > 0.5) || (S.phase === "hold" && S.sag < 0.7);
    },
    place(S, o) {
      // he sits to the choker's RIGHT so the choking shoulder is behind his
      // neck and the free hand can reach behind his head: half a shoulder
      // width, from the choker's own body
      o.lz = S.work + 0.12 * S.sag; o.lx = -0.5 * S.A.width; o.relYaw = 0;
      if (S.phase === "release" && S.how === "ko") o.dy = -0.35 * smooth(S.k);
    },
    // the choking elbow sits out in front of his right jaw
    pole(S, h, out) {
      if (h !== 1) return false;
      contactPoint(S.T.ch, "neckSideR", out, true);
      const y = S.A.yaw();
      out.x += fwdX(y) * 0.2 - Math.cos(y) * 0.15; out.z += fwdZ(y) * 0.2 + Math.sin(y) * 0.15; out.y -= 0.05;
      return true;
    },
    holdEnd(S) {
      const ko = S.opts.ko > 0 ? S.opts.ko : 5.5;
      S.sag = clamp01(S.pt / ko);
      if (S.pt >= ko) {
        S.how = "ko";
        S.result = S.result || {}; S.result.outcome = "ko";
        if (S.opts.onOutcome) { try { S.opts.onOutcome(S, "ko"); } catch (e) {} }
        return true;
      }
      return false;
    },
  };

  DEF.shield = {
    face: "same", hold: true, speed: 2.2, close: 1.0, pull: true, pullReach: 8,
    work: (S) => S.A.depth + S.T.depth + 0.04,
    dur(S, ph) { return ph === "align" ? 0.35 : ph === "contact" ? 0.25 : ph === "drive" ? 0.25 : ph === "release" ? 0.35 : 0; },
    poseA: () => "a.shield",
    poseT: () => "t.shield",
    hands(S) {
      // the left forearm across his throat from behind, the gun hand free;
      // he holds on to the arm at his neck by its elbow
      S.handsA[0] = "throat"; S.handsA[1] = null; S.kA[0] = kIn(S);
      S.handsT[0] = "elbowL"; S.handsT[1] = null; S.kT[0] = kGrip(S);
    },
    // he stands a little to the gunman's LEFT, the arm around him is that side
    place(S, o) { o.lz = S.work; o.lx = 0.42 * S.A.width; o.relYaw = 0; },
    // the forearm lies across his collar: the elbow out at his left, forward
    pole(S, h, out) {
      if (h !== 0) return false;
      contactPoint(S.T.ch, "neckSideL", out, true);
      const y = S.A.yaw();
      out.x += Math.cos(y) * 0.25 + fwdX(y) * 0.12; out.z += -Math.sin(y) * 0.25 + fwdZ(y) * 0.12; out.y -= 0.08;
      return true;
    },
  };

  DEF.carry = { onExplicit: 3, from: ["grab"],
    face: "face", hold: true, speed: 2.4, close: 1.0, allowDown: true,
    work: (S) => S.A.depth + S.T.depth + 0.12,
    dur(S, ph) {
      if (ph === "align") return S.wasDown ? 0.6 : 0.2;
      if (ph === "contact") return 0.28;
      if (ph === "drive") return 0.95;
      if (ph === "release") return S.how === "drop" ? 0.2 : 0.8;
      return 0;
    },
    poseA(S) {
      if (S.phase === "hold") return "a.carry";
      if (S.phase === "release" && S.how === "drop") return "a.carry";
      if (S.phase === "contact" || S.phase === "drive" || S.phase === "release") return "a.lift";
      return "a.reach";
    },
    poseT(S) {
      if (S.phase === "hold") return "t.draped";
      if (S.phase === "drive") return S.k > 0.55 ? "t.draped" : "t.lifted";
      if (S.phase === "release") return S.k < 0.45 ? "t.draped" : "t.lifted";
      return "t.lifted";
    },
    liftK(S) {      // 0 = he stands in front, 1 = he is over the shoulder
      if (S.phase === "drive") return S.k;
      if (S.phase === "hold") return 1;
      if (S.phase === "release") return S.how === "drop" ? 1 : 1 - S.k;
      return 0;
    },
    hands(S) {
      S.handsA[0] = "thighBackR"; S.handsA[1] = "thighBackL"; S.gA[0] = S.gA[1] = "cupover";
      const k = S.phase === "release" ? (S.how === "drop" ? 0 : 1 - smooth((S.k - 0.75) / 0.25)) : kIn(S);
      S.kA[0] = S.kA[1] = k;
      S.onA[0] = S.onA[1] = S.phase === "hold" || (S.phase === "drive" && S.k > 0.02) || (S.phase === "contact" && S.k >= 1);
    },
    place(S, o) {
      o.relYaw = PI;
      placeCarry(S, o, DEF.carry.liftK(S));
    },
  };

  // PLACEMENT HELPERS ------------------------------------------------------
  // carry: blend "standing in front" -> "belly on the right shoulder"
  /* THE FIREMAN LIFT, as one path: the carrier squats with his shoulder in
     the man's belly (contact), and from there the belly STAYS on that
     shoulder while the carrier stands (drive): the man folds over it, his
     pelvis rolls from the front of the shoulder to the back of it, and his
     torso ends hanging down the carrier's back. lk 0..1 walks that path (a
     set-down walks it backwards). */
  function placeCarry(S, o, lk) {
    const C = (VP() && VP().CARRY) || { pitch: 1.6, back: 0.24 };
    o.lz = S.work; o.lx = 0; o.pitch = S.phase === "contact" ? 0.08 * smooth(S.k) : 0;
    // set down, he finds his feet a half step off the carrier's chest
    if (S.phase === "release") o.lz += 0.06 * (1 - smooth(lk / 0.35));
    o.anchor = lk > 0 ? "belt" : null;
    o.anchorK = smooth(lk / 0.22);
    o.anchorPitch = lerp(0.35, C.pitch, smooth((lk - 0.08) / 0.85));
    o.anchorBack = lerp(-0.08, C.back, smooth((lk - 0.1) / 0.6));
    // the heave: his hips ride up over the top of the shoulder mid-roll
    o.liftUp = 0.12 * Math.sin(PI * clamp01((lk - 0.1) / 0.8));
  }
  // tackle: both on the deck, him on his back, you on top of him
  function placeTackleGround(S, o) {
    o.lz = S.work; o.lx = 0;
    o.pitch = -PI / 2 * 0.98;
    o.ground = true;
    o.pitchA = 1.2;
  }
  // drag: his collar in your right hand behind you, heels on the ground
  function placeDrag(S, o) {
    o.drag = true;
    o.relYaw = PI;
    // the root is solved from the collar point and the heels (placeTarget)
  }

  function copyCtx(S, c) {
    const o = S._ctxBuf || (S._ctxBuf = { kind: "open", point: { x: 0, y: 0, z: 0 }, dist: 0, drop: 0, surfaceY: 0, obj: null, top: 0 });
    o.kind = c.kind; o.point.x = c.point.x; o.point.y = c.point.y; o.point.z = c.point.z;
    o.dist = c.dist; o.drop = c.drop; o.surfaceY = c.surfaceY; o.obj = c.obj; o.top = c.top;
    return o;
  }
  // THE WORLD PICKS: a shove or a throw goes where the world sends it
  function worldOutcome(S, reach) {
    // asked NOW, from where the drive left him (a shove moved him a step)
    const ctx = copyCtx(S, context(S.T.pos, S.dir, reach));
    S.result = S.result || {};
    S.result.outcome = ctx.kind;
    S.result.ctx = ctx;
    S.tFree = true;
    endTargetHold(S);
    const power = S.power;
    if (ctx.kind === "wall" && ctx.dist < 0.35) {
      // already against it: the shove IS the slam
      const sp = 3.5 + 3.5 * power;
      if (CBZ.trauma && CBZ.trauma.slam) CBZ.trauma.slam(S.t, sp, { wall: true, dir: { x: -S.dir.x, z: -S.dir.z } });
      if (sp > 5.5 && CBZ.goreImpact) CBZ.goreImpact(ctx.point.x, S.T.pos.y + 1.15, ctx.point.z, { dir: { x: S.dir.x, y: 0, z: S.dir.z }, amount: 0.4 + 0.3 * power, wall: true });
      if (CBZ.sfx) CBZ.sfx("hit");
      if (power > 0.6 || S.verb === "throw") knock(S.t, _dirOut(-S.dir.x, -S.dir.z), 1.3);
      else if (CBZ.body && CBZ.body.hit && grappleSteps(S.t)) CBZ.body.hit(S.t, { dir: { x: -S.dir.x, z: -S.dir.z }, force: 1.5 });
    } else if (ctx.kind === "open" && S.verb === "shove" && power < 0.75) {
      // a stumble, not a fall: grapple's slide takes it, or a short hop here
      if (CBZ.body && CBZ.body.hit && grappleSteps(S.t)) CBZ.body.hit(S.t, { dir: S.dir, force: 4 + 6 * power });
      else launch(S.t, "open", ctx, S.dir, power * 0.6, S);
    } else {
      launch(S.t, ctx.kind, ctx, S.dir, power, S);
    }
    if (CBZ.sfx) CBZ.sfx(S.verb === "throw" ? "ko" : "punch");
    if (CBZ.shake && (S.A.isPlayer || S.T.isPlayer)) CBZ.shake(S.verb === "throw" ? 0.3 : 0.14);
    if (S.opts.onOutcome && !S._cbDone) { S._cbDone = true; try { S.opts.onOutcome(S, ctx.kind); } catch (e) {} }
  }

  // the target stops being held (outcome launched him, or the hold ended)
  function restoreHands(ch, saved) {
    if (!ch || !saved) return;
    if (saved[0] !== undefined) setHand(ch, "l", saved[0] || "relaxed");
    if (saved[1] !== undefined) setHand(ch, "r", saved[1] || "relaxed");
  }
  function endTargetHold(S) {
    restoreHands(S.T.ch, S.hpT);
    if (S.ownT) { disown(S.t, S); S.ownT = false; }
    S.T._yawLock = null;
    S.t._verbS = null;
    if (S.T.ch) { S.T.ch.verbHold = null; const vp = VP(); if (vp) vp.clear(S.T.ch); }
  }

  /* ============================================================
     THE STRUGGLE: a held man can fight his way out.
     Owner: getting caught was "way too easy". Whoever has his hands on you
     re-sets his grip in a rhythm you can SEE (his brace tightens, then eases);
     a press in the ease tears at it, a press into the brace barely does, and
     the grip he lost comes back if you stop. Nothing on screen names it: the
     meter is his body. How hard he holds is who he is: his mass against yours
     (CBZ.meleeScale) and his trade (a guard or a cop holds harder than a man
     off the yard). Breaking free: he staggers a step, you are loose. Cuffs,
     once they are on, do not come off this way.
       player  Space / W, or a click / tap while held (predator.js's escape keys)
       NPC     opts.struggle 0..1: how well he picks his moment (a verb opts in)
     ============================================================ */
  const STRUGGLE_VERBS = { grab: 1, tackle: 1, choke: 1, shield: 1, escort: 1, cuff: 1, carry: 1, drag: 1, mug: 1 };
  const BEAT = 1.55;                       // grip re-sets a second, roughly
  let pressAt = -1, pressSeen = -1, clockS = 0;
  function markPress() { pressAt = clockS; }
  function playerHeld() {
    for (let i = 0; i < sessions.length; i++) {
      const S = sessions[i];
      if (!S.done && S.T.isPlayer && S.phase !== "approach" && !S.tFree) return true;
    }
    return false;
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("keydown", function (e) {
      if (!e || e.repeat) return;
      const k = e.key ? String(e.key).toLowerCase() : "";
      if ((k === " " || k === "w" || k === "spacebar") && playerHeld()) markPress();
    }, true);
    // a click or tap only counts while somebody actually has you
    window.addEventListener("mousedown", function (e) { if (e && e.button === 0 && playerHeld()) markPress(); }, true);
    window.addEventListener("touchstart", function () { if (playerHeld()) markPress(); }, { passive: true, capture: true });
  }
  function gripOf(S) {
    if (S.opts.grip > 0) return S.opts.grip;
    let k = CBZ.meleeScale ? CBZ.meleeScale(S.a, S.t) : 1;
    if (!(k > 0)) k = 1;
    const a = S.a;
    const trade = a.kind === "guard" || a.kind === "warden" || a.kind === "cop" || a.swat ? 1.4
      : S.A.isPlayer ? 1.2 : 1.0;
    return Math.max(0.45, Math.min(3.2, k * trade * (a.gripSkill || 1)));
  }
  function canStruggle(S) {
    if (!STRUGGLE_VERBS[S.verb] || S.tFree || S.opts.noStruggle) return false;
    if (S.T.ch && S.T.ch.cuffed) return false;                 // the cuffs hold, not the man
    if (S.verb === "cuff" && S.phase !== "contact" && S.phase !== "drive") return false;   // before they close
    if (S.phase !== "contact" && S.phase !== "drive" && S.phase !== "hold" && S.phase !== "outcome") return false;
    if (S.sag > 0.7) return false;                             // a choke that far in has him
    return S.T.isPlayer || S.opts.struggle > 0;
  }
  function struggle(S, dt) {
    S.writhe = Math.max(0, (S.writhe || 0) - dt * 3.2);
    const b = (S.beat || 0) + dt * BEAT;
    if (b >= 1) S.cycle = (S.cycle || 0) + 1;
    S.beat = b % 1;
    // his brace: tight on the first half of the beat, easing on the second
    const brace = S.beat < 0.5 ? Math.sin(S.beat * 2 * PI) : 0;
    S.strain = Math.max(brace * 0.6, S.strain > 0 ? S.strain - dt * 2.5 : 0);
    if (!canStruggle(S)) return;
    if (S.grip == null) { S.grip = gripOf(S); S.grip0 = S.grip; }
    let pressed = false;
    if (S.T.isPlayer) {
      if (pressAt > pressSeen && pressAt >= S.age0) pressed = true;
      pressSeen = pressAt;
    } else if (S.opts.struggle > 0) {
      // an NPC picks his moments as well as he fights
      S._npcT = (S._npcT || 0) - dt;
      if (S._npcT <= 0) {
        S._npcT = 0.22 + Math.random() * 0.5;
        const good = S.beat >= 0.5 && S.beat < 0.95;
        pressed = good ? Math.random() < 0.3 + 0.7 * S.opts.struggle : Math.random() < 0.15;
      }
    }
    // what he let go of comes back while you are not fighting it
    S.grip = Math.min(S.grip0, S.grip + dt * 0.18);
    if (!pressed) return;
    // one good wrench per ease: mashing inside it is only the first press
    const good = S.beat >= 0.5 && S.beat < 0.95 && S.goodCycle !== (S.cycle || 0);
    if (good) S.goodCycle = S.cycle || 0;
    S.grip -= good ? 0.26 : 0.05;
    // A MAN FIGHTING IT HOLDS THE VERB UP: the second cuff will not close,
    // the mount will not settle, while he is wrenching at the hands on him
    if (good && S.phase !== "hold" && isFinite(S.dur)) S.pt = Math.max(0, S.pt - 0.32);
    S.writhe = 1;
    S.strain = 1;                                             // he clamps down on it
    if (S.T.isPlayer && CBZ.shake) CBZ.shake(good ? 0.16 : 0.07);
    if (S.grip <= 0) escape(S);
  }
  // BROKE FREE: he staggers back a step, you are loose
  function escape(S) {
    const A = S.A, T = S.T;
    S.result = S.result || {}; S.result.outcome = "escaped";
    S.leaveDown = false; S.how = null;
    if (S.opts.onOutcome && !S._escCb) { S._escCb = true; try { S.opts.onOutcome(S, "escaped"); } catch (e) {} }
    const dx = A.pos.x - T.pos.x, dz = A.pos.z - T.pos.z, d = Math.hypot(dx, dz) || 1;
    finish(S, false);
    if (typeof V.step === "function") { try { V.step(S.a, dx / d, dz / d, 0.45, 0.4); } catch (e) {} }
    else setPos(A, A.pos.x + dx / d * 0.3, A.pos.y, A.pos.z + dz / d * 0.3);
    if (CBZ.sfx) CBZ.sfx("punch");
    if (CBZ.shake && T.isPlayer) CBZ.shake(0.3);
  }

  /* ---- START ------------------------------------------------------------ */
  function start(verb, a, t, opts) {
    const def = DEF[verb];
    if (!def) return null;
    a = norm(a); t = norm(t);
    if (!a || !t || a === t) return null;
    opts = opts || {};
    const A = body(a), T = body(t);
    if (!A.pos || !T.pos || !A.ch || !T.ch) return null;
    if (A.dead() || T.dead()) return null;
    // an existing hold between the same two people is handed over (throw
    // from a grab, carry from a grab, shove out of a clinch)
    let from = null;
    const prev = sessionOf(a);
    if (prev) {
      const same = prev.a === a && prev.t === t && !prev.done;
      if (same && def.from && def.from.indexOf(prev.verb) >= 0 && (prev.phase === "hold" || prev.phase === "drive")) {
        // the hands are already on him: the new verb starts at its drive
        from = prev.verb;
        prev._handover = true;
        finish(prev, true);
      } else if (same || opts.force) {
        // a different grip (cuffing a man you hold by the collar): let go of
        // that one and do this one properly, turn and all
        cancel(prev);
      } else return null;
    }
    const tprev = sessionOf(t);
    if (tprev && !tprev.done) { if (!opts.force) return null; cancel(tprev); }
    const tf = flightOf(t);
    if (tf && tf.mode === "air") return null;
    if (t._apeHeld || t._apeFlying) return null;          // in an ape's fist / thrown by one
    const down = T.down() || (tf && tf.mode === "down");
    if (def.needDown && !down) return null;
    if (down && !def.allowDown && !from) return null;
    if (A.down()) return null;
    if (tf) { const i = flights.indexOf(tf); if (i >= 0) endFlight(tf, i); }

    const S = {
      verb, def, a, t, A, T, opts, from,
      phase: "approach", pt: 0, age: 0, dur: Infinity, k: 0, done: false, result: null, ctx: null,
      work: 0, dir: { x: 0, z: 1 }, power: opts.power != null ? clamp01(opts.power) : 1,
      ownT: false, tFree: false, how: null, sag: 0, crouch: 0, press: 0, wasDown: !!down,
      handsA: [null, null], handsT: [null, null], kA: [0, 0], kT: [0, 0],
      gA: ["grip", "grip"], gT: ["support", "support"],
      poleA: [new THREE.Vector3(), new THREE.Vector3()],
      // the hand shapes each of them had before (given back when they let go)
      hpA: [handPoseOf(A.ch, "l"), handPoseOf(A.ch, "r")], hpT: [handPoseOf(T.ch, "l"), handPoseOf(T.ch, "r")],
      onA: [false, false], onT: [false, false], resA: [-1, -1], resT: [-1, -1],
      pA: [new THREE.Vector3(), new THREE.Vector3()], pT: [new THREE.Vector3(), new THREE.Vector3()],
      x0: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, set: false },
      pl: { lx: 0, lz: 0, dy: 0, relYaw: 0, pitch: 0, pitchA: 0, anchor: null, anchorK: 0, anchorPitch: 0, liftUp: 0, ground: false, drag: false },
      t0: CBZ.now || 0, tSpeed: 0, _tx: 0, _tz: 0, _off: new THREE.Vector3(), _offOk: false,
      travel: 0, travelDone: 0, seed: Math.random(), _cbDone: false, _handover: false,
      cancel: null,
    };
    S.cancel = function () { cancel(S); };
    S.work = def.work(S);
    // direction: the caller's, or the grabber's line to the target
    const lx = T.pos.x - A.pos.x, lz = T.pos.z - A.pos.z, ll = Math.hypot(lx, lz);
    if (opts.dir) { const d = Math.hypot(opts.dir.x, opts.dir.z) || 1; S.dir.x = opts.dir.x / d; S.dir.z = opts.dir.z / d; }
    else if (ll > 1e-3) { S.dir.x = lx / ll; S.dir.z = lz / ll; }
    else { S.dir.x = fwdX(A.yaw()); S.dir.z = fwdZ(A.yaw()); }
    // reach: the verb only closes the last step itself; the caller walks
    // (opts.far: a menu verb picked a few steps away; the grabber walks it)
    const reachMax = def.pull ? (def.pullReach || 8) : S.work + (def.close || 1.0) + (def.needDown ? 1.8 : 0) + (opts.far ? 2.6 : 0);
    if (!from && ll > reachMax) return null;
    if (from) {
      // straight into the drive from the hold that was already there
      S.phase = "drive";
      enterPhase(S, "drive");
      S.x0.set = true;
      S.ownT = own(t, S);
    } else {
      enterPhase(S, "approach");
    }
    a._verbS = S; t._verbS = S;
    S.age0 = clockS;                 // presses from before the grab are not a struggle
    sessions.push(S);
    return S;
  }

  function enterPhase(S, ph) {
    S.phase = ph; S.pt = 0;
    S.dur = ph === "approach" || ph === "hold" ? Infinity : S.def.dur(S, ph);
    if (ph === "align" || (ph === "drive" && S.from)) {
      // from here on the verb has him: capture where he was so align can blend
      const T = S.T;
      S.x0.x = T.pos.x; S.x0.y = T.pos.y; S.x0.z = T.pos.z; S.x0.yaw = T.yaw();
      const g = T.ch.group;
      S.x0.pitch = 0;
      if (g && S.wasDown) {
        // a body on the ground: read how far over it is from the rig itself
        g.updateMatrixWorld(true);
        const e = g.matrixWorld.elements;
        S.x0.pitch = -Math.acos(Math.max(-1, Math.min(1, e[5])));
      }
      S.x0.set = true;
      if (!S.ownT) S.ownT = own(S.t, S);
      if (S.wasDown && S.T.ch) endFall(S.T.ch);
      if (S.T.ch) S.T.ch.verbHold = { verb: S.verb, role: "t", k: 0, phase: ph };
      if (S.A.ch) S.A.ch.verbHold = { verb: S.verb, role: "a", k: 0, phase: ph };
    }
    if (S.def.enter) S.def.enter(S, ph);
    if (ph === "contact" && S.opts.onContact) { try { S.opts.onContact(S); } catch (e) {} }
    // AN NPC GRABBER STANDS HIS GROUND while his hands work: his own brain may
    // want to walk on (a cop picking his next target mid-cuff), and a body
    // placed off him would be dragged along. The player's feet stay his own.
    if (ph === "contact" && !S.A.isPlayer && STILL[S.verb]) {
      S.aLock = S.aLock || { x: 0, y: 0, z: 0, yaw: 0 };
      S.aLock.x = S.A.pos.x; S.aLock.y = S.A.pos.y; S.aLock.z = S.A.pos.z; S.aLock.yaw = S.A.yaw();
    }
    if (ph === "hold" || ph === "release") S.aLock = S.verb === "grab" || S.verb === "carry" ? null : S.aLock;
    if (ph === "outcome" && S.def.outcome && S.verb !== "tackle") {
      S.def.outcome(S);
      if (S.opts.onOutcome && !S._cbDone) { S._cbDone = true; try { S.opts.onOutcome(S, S.result && S.result.outcome); } catch (e) {} }
    }
    if (S.A.ch && S.A.ch.verbHold) S.A.ch.verbHold.phase = ph;
    if (S.T.ch && S.T.ch.verbHold) S.T.ch.verbHold.phase = ph;
  }
  function nextPhase(S) {
    let i = PH.indexOf(S.phase) + 1;
    while (i < PH.length) {
      const ph = PH[i];
      if (ph === "hold") { if (S.def.hold && !S.tFree && !S.how) break; i++; continue; }
      if (ph === "outcome" && !S.def.outcome && S.verb !== "tackle") { i++; continue; }
      break;
    }
    if (i >= PH.length) { finish(S, false); return; }
    enterPhase(S, PH[i]);
    // zero-length beats pass straight through (their hooks still ran)
    if (S.dur <= 0 && S.phase !== "hold" && !S.done) nextPhase(S);
  }

  function cancel(S) {
    if (!S || S.done) return;
    finish(S, true);
  }
  // end the session. `quiet` = hand over / cancel (no onEnd side effects on the body)
  function finish(S, quiet) {
    if (S.done) return;
    S.done = true;
    const i = sessions.indexOf(S);
    if (i >= 0) sessions.splice(i, 1);
    if (S.a._verbS === S) S.a._verbS = null;
    if (S.t._verbS === S) S.t._verbS = null;
    S.A._yawLock = null;
    const vp = VP();
    if (!S._handover) {
      restoreHands(S.A.ch, S.hpA);
      if (!S.tFree) restoreHands(S.T.ch, S.hpT);
    }
    if (S.A.ch) { S.A.ch.verbHold = null; if (vp && !S._handover) vp.clear(S.A.ch); }
    if (!S.tFree) {
      if (S.T.ch) { S.T.ch.verbHold = null; if (vp && !S._handover) vp.clear(S.T.ch); }
      if (!S._handover) {
        disown(S.t, S);
        // a body we were holding off the ground goes back to standing — or,
        // if it was down / knocked out, lies back down through the handoff
        const g = S.T.ch && S.T.ch.group;
        if (g && (S.T._yawLock != null || Math.abs(g.rotation.x) > 0.01 || Math.abs(g.rotation.z) > 0.01)) {
          if (S.wasDown || S.how === "ko" || S.verb === "drag" || S.leaveDown) {
            knock(S.t, _dirOut(-S.dir.x, -S.dir.z), S.how === "ko" ? 6 : 1.5, true);
          } else uprightGroup(S.T);
        } else if (S.how === "ko" || (S.wasDown && S.verb === "carry")) {
          knock(S.t, _dirOut(-S.dir.x, -S.dir.z), S.how === "ko" ? 6 : 1.5);
        }
      } else {
        // the next session inherits ownership
        disown(S.t, S);
      }
    }
    if (S.A.ch && S.A.ch.group && S.A._yawLock == null && Math.abs(S.A.ch.group.rotation.x) > 0.01) uprightGroup(S.A);
    if (!quiet && S.opts.onEnd) { try { S.opts.onEnd(S); } catch (e) {} }
    else if (quiet && S.opts.onEnd && !S._handover) { try { S.opts.onEnd(S); } catch (e) {} }
  }

  /* ---- THE PER-FRAME STEP OF ONE SESSION -------------------------------- */
  function stepSession(S, dt) {
    const A = body(S.a), T = body(S.t), def = S.def;
    if (!A.pos || !T.pos || !A.ch || !T.ch) { finish(S, true); return; }
    // a body that died or went down mid-verb (shot, blast) ends it
    if (A.dead() || (!S.tFree && T.dead() && S.verb !== "drag" && S.verb !== "carry")) { finish(S, true); return; }
    S.pt += dt; S.age += dt;
    // opts.holdFor / opts.then: hold him that long, then "throw" | "set" | "drop"
    if (S.phase === "hold" && S.opts.holdFor > 0 && S.pt >= S.opts.holdFor && !S.how) {
      release(S, S.opts.then || "set");
      if (S.done) return;
    }

    // ---- timeline
    for (let guard = 0; guard < 8 && !S.done; guard++) {
      if (S.phase === "approach") {
        if (!approach(S, dt)) break;
        nextPhase(S); continue;
      }
      if (S.phase === "hold") {
        if (!S.how && !(def.holdEnd && def.holdEnd(S))) break;
        nextPhase(S); continue;
      }
      if (S.pt < S.dur) break;
      nextPhase(S);
    }
    if (S.done) return;
    S.k = S.dur > 0 && isFinite(S.dur) ? clamp01(S.pt / S.dur) : 1;
    if (S.phase === "approach") return;
    struggle(S, dt);
    if (S.done) return;

    const vp = VP();
    if (S.aLock && S.phase !== "approach" && S.phase !== "align") {
      setPos(A, S.aLock.x, S.aLock.y, S.aLock.z);
      if (A._yawLock == null) A.face(S.aLock.yaw, 1);
    }
    const yawA = A.yaw();

    // ---- the grabber squares up to him until the hands are on
    if (S.phase === "align" && def.face !== "none") {
      const ty = Math.atan2(T.pos.x - A.pos.x, T.pos.z - A.pos.z);
      A.face(ty, 1 - Math.exp(-14 * dt));
    }
    // ---- the tackle's drive carries both of them
    if (S.verb === "tackle" && S.phase === "drive" && !S.opts.noMove) {
      const want = S.travel * smooth(S.k);
      const d = want - S.travelDone;
      S.travelDone = want;
      setPos(A, A.pos.x + S.dir.x * d, A.pos.y, A.pos.z + S.dir.z * d);
    }

    // ---- poses. The grabber's body first: HIS chest (where his lean put it)
    // is what the target is held off, so a man bending in to the wrists does
    // not drive his chest through the other man's back. Then the target is
    // placed, posed, and his own arms solved, before any hand goes on him.
    poseSide(S, A, def.poseA(S), dt);
    if (!S.tFree) {
      if (S.ownT && CBZ.animChar && !T.isPlayer) CBZ.animChar(T.ch, S.tSpeed, dt);
      placeTarget(S, A, T, dt, yawA);
      poseSide(S, T, def.poseT(S), dt);
      // his own arms: behind the back for the cuff / escort
      const selfK = def.selfT ? def.selfT(S) : 0;
      if (T.ch.cuffed) { if (vp) vp.cuffArms(T.ch, 1); T.ch._vcufF = cuffFrame; }
      else if (selfK > 0 && vp) {
        if (S.verb === "escort") vp.wristTo(T.ch, -1, cuffWorld(T.ch, -1), selfK);
        else vp.cuffArms(T.ch, selfK);
      }
      // how far HIS lean carries his torso toward the grabber (next frame's placement)
      S._tLean = Math.max(0, -torsoLean(T, fwdX(yawA), fwdZ(yawA)));
    }

    // ---- hands on
    S.handsT[0] = S.handsT[1] = null;
    S.onA[0] = S.onA[1] = false; S.onT[0] = S.onT[1] = false;
    S.kA[0] = S.kA[1] = S.kT[0] = S.kT[1] = 0;
    S.gA[0] = S.gA[1] = "grip"; S.gT[0] = S.gT[1] = "support";
    def.hands(S);
    // the fingers close on what they hold, and open again when they let go
    // (set every frame: an armed body's weapon sync rewrites the right hand)
    for (let h = 0; h < 2; h++) {
      const arm = h === 0 ? "l" : "r";
      if (S.handsA[h] && S.kA[h] > 0.35 && !S.tFree) setHand(A.ch, arm, S.gA[h]);
      else if (S.hpA[h] !== undefined) setHand(A.ch, arm, S.hpA[h] || "relaxed");
      if (!S.tFree) {
        if (S.handsT[h] && S.kT[h] > 0.35) setHand(T.ch, arm, S.gT[h]);
        else if (S.hpT[h] !== undefined) setHand(T.ch, arm, S.hpT[h] || "relaxed");
      }
    }
    // default "in contact" = fully weighted and past the contact beat
    // (a verb that times its own touches says so with onExplicit)
    for (let h = 0; h < 2; h++) {
      if (!(def.onExplicit & (1 << h)) && S.handsA[h] && S.kA[h] >= 0.999 && (S.phase !== "contact" || S.k >= 1)) S.onA[h] = true;
      if (!(def.onExplicit & (4 << h)) && S.handsT[h] && S.kT[h] >= 0.999) S.onT[h] = true;
    }
    if (S.tFree) { S.onA[0] = S.onA[1] = S.onT[0] = S.onT[1] = false; }
    A.ch.group.updateMatrixWorld(true);
    T.ch.group.updateMatrixWorld(true);
    for (let h = 0; h < 2; h++) {
      const name = S.handsA[h];
      S.resA[h] = -1;
      if (!name || S.tFree || !(S.kA[h] > 0.001)) continue;
      contactPoint(T.ch, name, S.pA[h], true);
      if (S.press) {
        // a pat presses IN toward his centre line
        _C.set(T.pos.x, S.pA[h].y, T.pos.z).sub(S.pA[h]);
        const l = _C.length(); if (l > 1e-4) S.pA[h].addScaledVector(_C, S.press / l);
      }
      const pole = def.pole && def.pole(S, h, S.poleA[h]) ? S.poleA[h] : null;
      S.resA[h] = handTo(A.ch, h === 0 ? "l" : "r", S.pA[h], S.kA[h], pole);
    }
    if (S.handsT[0] || S.handsT[1]) {
      A.ch.group.updateMatrixWorld(true);
      for (let h = 0; h < 2; h++) {
        const name = S.handsT[h];
        S.resT[h] = -1;
        if (!name || S.tFree || !(S.kT[h] > 0.001)) continue;
        contactPoint(A.ch, name, S.pT[h], true);
        S.resT[h] = handTo(T.ch, h === 0 ? "l" : "r", S.pT[h], S.kT[h]);
      }
    }
    if (CBZ.lockCharacterHips) { CBZ.lockCharacterHips(A.ch); if (!S.tFree) CBZ.lockCharacterHips(T.ch); }
    if (A.ch.verbHold) { A.ch.verbHold.k = Math.max(S.kA[0], S.kA[1]); }
    if (T.ch.verbHold) { T.ch.verbHold.k = Math.max(S.kA[0], S.kA[1]); }
  }

  // how far the middle of this body's torso sits along (fx,fz) from its feet
  const _tl0 = new THREE.Vector3(), _tl1 = new THREE.Vector3();
  function torsoLean(B, fx, fz) {
    if (!contactPoint(B.ch, "chest", _tl0, false)) return 0;
    contactPoint(B.ch, "back", _tl1, true);
    const mx = (_tl0.x + _tl1.x) * 0.5 - B.pos.x, mz = (_tl0.z + _tl1.z) * 0.5 - B.pos.z;
    return mx * fx + mz * fz;
  }

  // an arm-barred (uncuffed) escort's right wrist goes where a cuff would put it
  const _cw = new THREE.Vector3();
  function cuffWorld(ch, side) { return VP().cuffTarget(ch, side, _cw); }

  function poseSide(S, B, name, dt) {
    const vp = VP();
    if (!vp || !name) return;
    _pp.k = S.k; _pp.t = S.age; _pp.phase = S.phase; _pp.seed = S.seed; _pp.verb = S.verb;
    _pp.sag = S.sag; _pp.crouch = S.crouch;
    // the fight inside the hold: his brace strains, the held man writhes
    _pp.strain = B === S.A ? S.strain : 0;
    _pp.writhe = B === S.T ? S.writhe : 0;
    _pp.moving = B === S.A ? S.aSpeed > 0.4 : S.tSpeed > 0.4;
    _pp.ground = S.verb === "tackle" && (S.phase === "outcome" || S.phase === "release") && S.result && S.result.outcome === "open" && (B === S.T || S.phase === "outcome" || S.k < 0.5);
    if (S.verb === "carry" && B === S.A && (S.phase === "drive" || S.phase === "contact" || S.phase === "release")) {
      _pp.k = S.phase === "contact" ? 0.3 * smooth(S.k) : S.phase === "drive" ? S.k : 1 - S.k;
    }
    if (S.verb === "carry" && B === S.T && S.phase === "release") _pp.k = 1 - S.k;
    vp.set(B.ch, name, _pp, S.verb === "tackle" || S.verb === "shove" || S.verb === "throw" ? 16 : 11);
    vp.write(B.ch, dt);
  }

  /* ---- ROOTS -------------------------------------------------------------
     approach: the grabber closes the last step to where the verb is done
     from (or, for a shield, the hostage is walked back into him). A downed
     man is dragged from his HEAD end: the grabber goes round to beyond his
     head and turns his back on the body. Walks through CBZ.moves (the one
     locomotion layer) when it is loaded; a plain capped step otherwise.
     Returns true when he is there. */
  function stepTo(S, B, mover, gx, gz, face, speed, dt) {
    const M = CBZ.moves;
    if (M && M.motor && M.step) {
      const m = M.motor(mover);
      M.step(m, B.pos, B.yaw(), gx, gz, { speed: speed, stop: 0.03, face: face, lod: 1, accel: 12, decel: 12 }, dt);
      setPos(B, B.pos.x, groundY(B.pos.x, B.pos.z, B.pos.y + 0.45), B.pos.z);
      if (m.yaw != null) B.face(m.yaw, 1);
      return m.gs || 0;
    }
    const dx = gx - B.pos.x, dz = gz - B.pos.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) return 0;
    const st = Math.min(d, speed * dt);
    _R.set(B.pos.x + dx / d * st, B.pos.y, B.pos.z + dz / d * st);
    if (CBZ.collide) CBZ.collide(_R, B.isPlayer ? 0.38 : B.radius * 0.9, B.pos.y + 0.2, B.pos.y + 1.7);
    setPos(B, _R.x, groundY(_R.x, _R.z, B.pos.y + 0.45), _R.z);
    B.face(face != null ? face : Math.atan2(dx, dz), 1 - Math.exp(-12 * dt));
    return st / Math.max(dt, 1e-4);
  }
  function approach(S, dt) {
    if (S.opts.noMove) return true;
    const A = S.A, T = S.T, def = S.def;
    let gx, gz, face = null;
    if (def.needDown) {
      // beyond his head, facing away from his feet
      contactPoint(T.ch, "backCollar", _W, false);
      let vx = _W.x - T.pos.x, vz = _W.z - T.pos.z;
      const vl = Math.hypot(vx, vz) || 1; vx /= vl; vz /= vl;
      gx = _W.x + vx * (A.depth + 0.28); gz = _W.z + vz * (A.depth + 0.28);
      face = Math.atan2(vx, vz);
    } else {
      const dx = T.pos.x - A.pos.x, dz = T.pos.z - A.pos.z, d = Math.hypot(dx, dz) || 1;
      if (def.pull) {
        // the hostage is walked back into you
        if (d <= S.work + 0.03) return true;
        if (S.age > 4) return true;
        const w = S.work;
        S.tSpeed = stepTo(S, T, S.t, A.pos.x + dx / d * w, A.pos.z + dz / d * w, null, def.speed || 2.2, dt);
        A.face(Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
        return false;
      }
      gx = T.pos.x - dx / d * S.work; gz = T.pos.z - dz / d * S.work;
      face = Math.atan2(dx, dz);
    }
    const rem = Math.hypot(gx - A.pos.x, gz - A.pos.z);
    const turned = face == null || Math.abs(angDiff(A.yaw(), face)) < 0.3;
    if (rem <= 0.04 && turned) { S.aSpeed = 0; return true; }
    if (S.age > (S.opts.far ? 2.6 : 1.6)) {
      // could not get there (blocked, or he backed off faster than we walk)
      if (rem > 0.35) { S.result = { outcome: "missed" }; finish(S, false); return false; }
      return true;
    }
    S.aSpeed = stepTo(S, A, S.a, gx, gz, face, def.speed || 2.5, dt);
    return false;
  }

  function placeTarget(S, A, T, dt, yawA) {
    if (S.opts.noMove) {
      // the caller owns both roots (a cutscene, a netted body): poses and hands only
      const mv = Math.hypot(T.pos.x - (S._tx || T.pos.x), T.pos.z - (S._tz || T.pos.z)) / Math.max(dt, 1e-4);
      S._tx = T.pos.x; S._tz = T.pos.z;
      S.tSpeed += (Math.min(8, mv) - S.tSpeed) * (1 - Math.exp(-10 * dt));
      return;
    }
    const o = S.pl;
    o.lx = 0; o.lz = S.work; o.dy = 0; o.relYaw = 0; o.pitch = 0; o.pitchA = 0;
    o.anchor = null; o.anchorK = 0; o.anchorPitch = 0; o.anchorBack = null; o.liftUp = 0; o.ground = false; o.drag = false;
    S.def.place(S, o);
    const fx = fwdX(yawA), fz = fwdZ(yawA);
    // a man fighting the grip wrenches away from it
    if (S.writhe > 0 && !o.ground && !o.drag && !o.anchor) o.lz += 0.05 * S.writhe;
    // held off the grabber's CHEST, not his feet (see stepSession), and off
    // his own lean toward the grabber
    if (!S.def.feetRel && !o.ground && !o.drag) {
      const lean = torsoLean(A, fx, fz) + (S._tLean || 0);
      const r = Math.hypot(o.lx, o.lz) || 1;
      o.lx += lean * o.lx / r; o.lz += lean * o.lz / r;
    }
    // local +X of the grabber in world: (cos, -sin)
    const rx = Math.cos(yawA), rz = -Math.sin(yawA);
    let x = A.pos.x + rx * o.lx + fx * o.lz;
    let z = A.pos.z + rz * o.lx + fz * o.lz;
    let y = groundY(x, z, A.pos.y + 0.45) + o.dy;
    let yaw = yawA + o.relYaw, pitch = o.pitch;

    // the grabber's own pitch (the tackle drive / mount)
    if (o.pitchA) orient(A, yawA, o.pitchA, 0);
    else if (A._yawLock != null) orient(A, yawA, 0, 0);

    if (o.ground) {
      // THE MOUNT: him flat on his back where he went down; you kneeling
      // astride his hips, knees on the deck, leaning over his chest. The hip
      // height is YOUR thigh plus YOUR shin, the spot is HIS hip line.
      if (S._gx != null) { x = S._gx; z = S._gz; }
      const gy = groundY(x, z, A.pos.y + 0.45);
      y = gy;
      pitch = o.pitch;
      S.leaveDown = true;
      const P = A.ch.profile || {};
      const MT = (VP() && VP().MOUNT) || { pitch: 0.45, along: 0.35, spread: 0.3 };
      const th = MT.pitch;
      const kneel = (((P.legUp || 0.48) - 0.02) * Math.cos(MT.spread) + (P.legW || 0.34) * 0.45) * A.scale;
      const up = T.hipY + MT.along * (T.shoulderY - T.hipY);            // a HIGH mount: astride his belly
      const hx = x + S.dir.x * up, hz = z + S.dir.z * up;
      const mx = hx - S.dir.x * A.hipY * Math.sin(th), mz = hz - S.dir.z * A.hipY * Math.sin(th);
      const my = gy + kneel - A.hipY * Math.cos(th);
      if (S.phase === "outcome") {
        if (S._m0x == null) { S._m0x = A.pos.x; S._m0y = A.pos.y; S._m0z = A.pos.z; }
        const kk = smooth(S.pt / 0.3);
        setPos(A, lerp(S._m0x, mx, kk), lerp(S._m0y, my, kk), lerp(S._m0z, mz, kk));
        orient(A, yawA, th * kk, 0);
      } else {
        // getting up off him: back onto your feet where your hips were
        const kk = smooth(S.k);
        setPos(A, lerp(mx, hx - S.dir.x * 0.15, kk), lerp(my, groundY(hx, hz, gy + 0.45), kk), lerp(mz, hz - S.dir.z * 0.15, kk));
        orient(A, yawA, th * (1 - kk), 0);
      }
    }

    if (o.drag) {
      // the collar point sits behind your right shoulder; his heels on the deck
      // (off the grabber's ROOT, not his shoulder: his lean must not drag the man into him)
      _W.set(A.pos.x - fx * (A.depth + 0.2) - Math.cos(yawA) * 0.12, A.pos.y + A.hipY * 1.3, A.pos.z - fz * (A.depth + 0.2) + Math.sin(yawA) * 0.12);
      const gy = groundY(_W.x - fx * 1.0, _W.z - fz * 1.0, A.pos.y + 0.45);
      const T0 = localTable(T.ch), j = CPI.backCollar * 4;
      const L = Math.max(0.5, T0[j + 2] * T.scale);                 // feet -> collar, standing
      const h = Math.min(L * 0.98, Math.max(0.1, _W.y - gy));
      const lean = Math.acos(h / L);                                  // back from vertical
      const k = S.phase === "release" ? 1 - smooth(S.k) : S.phase === "align" ? smooth(S.k) : 1;
      // his collar stays under the hand while he goes up (align) or down
      // (release): the heels slide, so his head never sweeps the grabber's legs
      const p = lerp(PI / 2 * 0.98, lean, k);
      const horiz = L * Math.sin(p);
      x = _W.x - fx * horiz; z = _W.z - fz * horiz; y = gy;
      pitch = -p;
    }

    if (o.anchor && o.anchorK > 0) {
      // closed loop: put HIS contact point on the grabber's shoulder
      contactPoint(A.ch, "shoulderTopR", _W, false);
      const CY = (VP() && VP().CARRY) || { back: 0.24, up: 0.03 };
      const back = o.anchorBack != null ? o.anchorBack : CY.back;
      _W.y += CY.up + o.liftUp;
      _W.x -= fx * back; _W.z -= fz * back;
      const ap = o.anchorPitch;
      // orient first, then measure the offset root -> anchor on the posed rig
      orient(T, yaw, ap, 0);
      T.ch.group.position.set(0, 0, 0);
      T.ch.group.updateMatrixWorld(true);
      contactPoint(T.ch, o.anchor, _C, true);
      const ax = _W.x - _C.x, ay = _W.y - _C.y, az = _W.z - _C.z;
      const k = smooth(o.anchorK);
      x = lerp(x, ax, k); y = lerp(y, ay, k); z = lerp(z, az, k);
      pitch = lerp(pitch, ap, k);
    }

    // ALIGN: blend from where he was to where the verb holds him
    if (S.phase === "align" && S.x0.set) {
      const k = smooth(S.k);
      const yb = lerpAngle(S.x0.yaw, yaw, k);
      x = lerp(S.x0.x, x, k); z = lerp(S.x0.z, z, k); y = lerp(S.x0.y, y, k);
      if (!o.anchor && !o.drag) {
        // a body turning in front of you is WIDER than it is deep: whatever
        // he presents along the line past his depth, he is held that much
        // further out, so his shoulder never sweeps your chest
        const phi = angDiff(yawA, yb);
        const extra = Math.max(0, T.width * Math.abs(Math.sin(phi)) + T.depth * Math.abs(Math.cos(phi)) - T.depth);
        const lx = x - A.pos.x, lz = z - A.pos.z, ll = Math.hypot(lx, lz) || 1;
        x += lx / ll * extra * 1.15; z += lz / ll * extra * 1.15;
      }
      yaw = yb;
      pitch = lerp(S.x0.pitch, pitch, k);
    }
    // bodies do not go through walls: he is stopped, and the pair moves as one
    if (CBZ.collide && !o.anchor && !o.ground) {
      _R.set(x, y, z);
      CBZ.collide(_R, T.radius * 0.85, y + 0.25, y + 1.7);
      const ddx = _R.x - x, ddz = _R.z - z;
      if (Math.abs(ddx) + Math.abs(ddz) > 1e-4) {
        x = _R.x; z = _R.z;
        if (S.phase !== "align") setPos(A, A.pos.x + ddx, A.pos.y, A.pos.z + ddz);
      }
    }
    // how fast he is being walked (his legs walk at it)
    const mv = Math.hypot(x - T.pos.x, z - T.pos.z) / Math.max(dt, 1e-4);
    S.tSpeed = S.tSpeed + (Math.min(8, mv) - S.tSpeed) * (1 - Math.exp(-10 * dt));
    const amv = Math.hypot(A.pos.x - (S._ax != null ? S._ax : A.pos.x), A.pos.z - (S._az != null ? S._az : A.pos.z)) / Math.max(dt, 1e-4);
    S.aSpeed = (S.aSpeed || 0) + (Math.min(8, amv) - (S.aSpeed || 0)) * (1 - Math.exp(-10 * dt));
    S._ax = A.pos.x; S._az = A.pos.z;
    setPos(T, x, y, z);
    orient(T, yaw, pitch, 0);
  }

  /* ============================================================
     CUFFS: the ties, ON the wrists, on anybody
     ============================================================ */
  const cuffed = [];         // { a, ch, ringL, ringR, link, k }
  let cuffMat = null, ringGeo = null, linkGeo = null;
  let cuffFrame = 0;
  function cuffAssets() {
    if (cuffMat) return;
    cuffMat = CBZ.cmat ? CBZ.cmat(0xd7dbe0) : new THREE.MeshLambertMaterial({ color: 0xd7dbe0 });
    ringGeo = new THREE.TorusGeometry(1, 0.14, 4, 12); ringGeo._shared = true;
    linkGeo = new THREE.BoxGeometry(0.035, 0.035, 1); linkGeo._shared = true;
  }
  function ringMesh(ch) {
    const P = ch.profile || {};
    const r = ((P.armW || 0.3) * 0.9) * 0.60;           // hugs the forearm box
    const m = new THREE.Mesh(ringGeo, cuffMat);
    m.name = "cuff-ring"; m.castShadow = false;
    m.rotation.x = PI / 2;                              // around the forearm (low's +y)
    m.scale.set(r, r, r * 1.3);
    return m;
  }
  // opts.whileKo: the ties come off by themselves when his count (a.ko) runs out
  function setCuffs(a, on, opts) {
    a = norm(a);
    const ch = rigOf(a);
    if (!ch || !ch.low || !ch.low.la || !ch.low.ra) return false;
    let e = null, ei = -1;
    for (let i = 0; i < cuffed.length; i++) if (cuffed[i].ch === ch) { e = cuffed[i]; ei = i; break; }
    if (!on) {
      ch.cuffed = false;
      if (VP() && VP().unretract) VP().unretract(ch);
      if (e) {
        if (e.ringL.parent) e.ringL.parent.remove(e.ringL);
        if (e.ringR.parent) e.ringR.parent.remove(e.ringR);
        if (e.link.parent) e.link.parent.remove(e.link);
        cuffed.splice(ei, 1);
      }
      return true;
    }
    ch.cuffed = true;
    if (e) { if (opts && opts.whileKo) e.whileKo = true; return true; }
    cuffAssets();
    const wy = VP() ? VP().wristLocalY(ch) : -0.22;
    const ringL = ringMesh(ch), ringR = ringMesh(ch);
    ringL.position.set(0, wy, 0); ringR.position.set(0, wy, 0);
    ch.low.la.add(ringL); ch.low.ra.add(ringR);
    const link = new THREE.Mesh(linkGeo, cuffMat);
    link.name = "cuff-link"; link.castShadow = false;
    ch.low.la.add(link);
    cuffed.push({ a: a, ch: ch, ringL: ringL, ringR: ringR, link: link, k: 0, whileKo: !!(opts && opts.whileKo) });
    return true;
  }
  function isCuffed(a) { const ch = rigOf(norm(a)); return !!(ch && ch.cuffed); }
  const _l0 = new THREE.Vector3(), _l1 = new THREE.Vector3(), _q = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1);
  function poseCuffs(dt) {
    const vp = VP();
    if (!vp) return;
    for (let i = cuffed.length - 1; i >= 0; i--) {
      const e = cuffed[i], ch = e.ch;
      if (!ch.cuffed || (e.whileKo && !(e.a.ko > 0))) { setCuffs(e.a, false); continue; }
      e.k = Math.min(1, e.k + dt * 4);
      if (ch._vcufF !== cuffFrame && ch.group && ch.group.visible !== false) vp.cuffArms(ch, smooth(e.k));
      // the bridge between the two rings, re-seated every frame
      const wy = vp.wristLocalY(ch);
      if (vp.wristWorld(ch, -1, _l1)) {
        ch.low.la.worldToLocal(_l1);
        _l0.set(0, wy, 0);
        _l1.sub(_l0);
        const len = _l1.length();
        e.link.position.set(_l1.x * 0.5, wy + _l1.y * 0.5, _l1.z * 0.5);
        if (len > 1e-4) { _q.setFromUnitVectors(_z, _l1.multiplyScalar(1 / len)); e.link.quaternion.copy(_q); }
        e.link.scale.set(1, 1, Math.max(0.02, len));
      }
    }
    // the player can be cuffed by any mode's script with just the flag
    const pc = CBZ.playerChar;
    if (pc && pc.cuffed && pc._vcufF !== cuffFrame) {
      let reg = false;
      for (let i = 0; i < cuffed.length; i++) if (cuffed[i].ch === pc) { reg = true; break; }
      if (!reg) vp.cuffArms(pc, 1);
    }
  }

  /* ============================================================
     THE LATE PASS (order 91)
     ============================================================ */
  let lastMode = null;
  function update(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    clockS += dt;
    // a mode change drops every hold and every body in flight: the next world
    // has different people in it
    const m = mode();
    if (m !== lastMode) {
      if (lastMode !== null) {
        for (let i = sessions.length - 1; i >= 0; i--) cancel(sessions[i]);
        for (let i = flights.length - 1; i >= 0; i--) endFlight(flights[i], i);
      }
      lastMode = m;
    }
    const vp = VP();
    if (vp) vp.tick();
    cuffFrame++;
    stepFlights(dt);
    for (let i = sessions.length - 1; i >= 0; i--) {
      const S = sessions[i];
      if (!S || S.done) continue;
      try { stepSession(S, dt); } catch (e) { finish(S, true); if (CBZ.CONFIG && CBZ.CONFIG.DEBUG) console.error("[verbs]", e); }
    }
    if (vp) vp.fade(dt);
    poseCuffs(dt);
  }
  if (CBZ.onUpdate) CBZ.onUpdate(91, update);

  /* ============================================================
     QUERIES + RELEASE
     ============================================================ */
  function sessionOf(a) {
    a = norm(a);
    const S = a && a._verbS;
    return S && !S.done ? S : null;
  }
  function holding(a) {
    const S = sessionOf(a);
    return S && S.a === norm(a) && !S.tFree && S.phase !== "approach" ? S.t : null;
  }
  // one question for "who has him": a verb's grabber, or an ape's fist
  // (systems/ape_combat.js keeps its own swing; the answer is shared)
  function heldBy(t) {
    t = norm(t);
    const S = sessionOf(t);
    if (S && S.t === t && !S.tFree && S.phase !== "approach") return S.a;
    return (t && t._apeHeld) || null;
  }
  function busy(a) {
    a = norm(a);
    if (!a) return false;
    if (sessionOf(a)) return true;
    if (flightOf(a)) return true;
    if (a._apeHeld || a._apeFlying) return true;
    const B = body(a);
    return B.down();
  }
  /* release(aOrS, how): "set" (put him down / let go gently, the default),
     "drop" (let go now), "throw" (heave him where you face). */
  function release(x, how) {
    let S = x && x.def && x.verb ? x : sessionOf(x);
    if (!S || S.done) return false;
    how = how || "set";
    if (how === "throw") {
      const A = S.A;
      const dir = { x: fwdX(A.yaw()), z: fwdZ(A.yaw()) };
      return !!start("throw", S.a, S.t, { dir: dir, power: 1, onOutcome: S.opts.onOutcome, onEnd: S.opts.onEnd });
    }
    if (S.phase === "release") { if (how === "drop") S.how = "drop"; return true; }
    if (S.phase === "hold" || S.phase === "drive" || S.phase === "outcome") {
      S.how = how;
      if (how === "drop" && S.verb === "carry") {
        // he slides off the shoulder and hits the deck
        const A = S.A;
        S.tFree = true;
        endTargetHold(S);
        const dir = { x: -Math.cos(A.yaw()), z: Math.sin(A.yaw()) };  // off the right side
        launch(S.t, "open", null, dir, 0.3, S);
        enterPhase(S, "release");
        return true;
      }
      enterPhase(S, "release");
      return true;
    }
    cancel(S);
    return true;
  }

  // who the player (or anyone) would reach with this verb right now
  const _cand = [];
  function reach(verb, A, T) {
    const def = DEF[verb] || DEF.grab;
    const a = A ? body(A) : null, t = T ? body(T) : null;
    const dA = a ? a.depth : 0.18, dT = t ? t.depth : 0.18, arm = a ? a.arm : 0.63;
    const fake = { A: { depth: dA, arm: arm, shoulderY: a ? a.shoulderY : 1.29, hipY: a ? a.hipY : 0.665 }, T: { depth: dT } };
    if (def.pull) return def.pullReach || 8;
    return def.work(fake) + (def.close || 1) + (def.needDown ? 1.8 : 0);
  }
  function pick(a, verb, opts) {
    a = norm(a);
    const A = body(a);
    if (!A || !A.pos) return null;
    opts = opts || {};
    const r = opts.reach || reach(verb || "grab", a);
    const cone = opts.cone != null ? opts.cone : V.CONE;
    let dx0, dz0;
    if (opts.dir) { dx0 = opts.dir.x; dz0 = opts.dir.z; }
    else if (A.isPlayer && CBZ.cam && typeof CBZ.cam.yaw === "number") { dx0 = -Math.sin(CBZ.cam.yaw); dz0 = -Math.cos(CBZ.cam.yaw); }
    else { dx0 = fwdX(A.yaw()); dz0 = fwdZ(A.yaw()); }
    let list = opts.candidates;
    if (typeof list === "function") { _cand.length = 0; list(_cand); list = _cand; }
    if (!list) {
      if (CBZ.worldActors) list = CBZ.worldActors(_cand);
      else list = CBZ.bots || [];
    }
    let best = null, bd = r;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || t === a || isPlayerA(t) || t.dead) continue;
      if (sessionOf(t) || flightOf(t)) continue;
      const T = body(t);
      if (!T.pos || !T.ch) continue;
      const dn = T.down();
      if (opts.down === true && !dn) continue;
      if (opts.down !== true && !opts.anyDown && dn) continue;
      const dx = T.pos.x - A.pos.x, dz = T.pos.z - A.pos.z, d = Math.hypot(dx, dz);
      if (d > bd || d < 0.05) continue;
      if (Math.abs(T.pos.y - A.pos.y) > 1.2) continue;
      if ((dx / d) * dx0 + (dz / d) * dz0 < cone) continue;
      // no verbs through a wall
      _wbY = A.pos.y || 0; _wbX = A.pos.x; _wbZ = A.pos.z; _wbDX = dx / d; _wbDZ = dz / d; _wbL = d;
      if (CBZ.segmentHitsCollider && CBZ.segmentHitsCollider(A.pos.x, A.pos.z, T.pos.x, T.pos.z, 0, wallBetween)) continue;
      bd = d; best = t;
    }
    return best;
  }
  let _wbY = 0;
  let _wbX = 0, _wbZ = 0, _wbDX = 0, _wbDZ = 0, _wbL = 0;
  function wallBetween(c) {
    if (c._city && mode() !== "city") return false;
    if (!(c.y1 == null || c.y1 > _wbY + 1.3)) return false;   // a waist-high rail you reach over
    const t = rayHit(c, _wbX, _wbZ, _wbDX, _wbDZ, 0);
    return t >= 0 && t < _wbL;
  }

  /* ============================================================
     THE NAMESPACE (only CORE's keys; STRIKE adds its own)
     ============================================================ */
  V.body = body;
  V.isPlayer = isPlayerA;
  V.playerActor = playerActor;
  V.contacts = contacts;
  V.contactPoint = contactPoint;
  V.context = context;
  V.start = start;
  V.release = release;
  V.sessionOf = sessionOf;
  V.holding = holding;
  V.heldBy = heldBy;
  // a body its own game must leave alone right now: held by a verb, or in a
  // verb's flight / on-the-floor beat (entities/npc.js, guards.js ask this)
  V.held = function (a) { a = norm(a); return !!(a && (heldBy(a) || flightOf(a))); };
  /* WALK A HOLD. The grabber of a session walks to (x,z) through CBZ.moves
     (the one locomotion layer) and the held body goes with him, hands on. For
     a scripted march (a screw walking a prisoner to his cell, a cop to the car).
     Returns the distance still to go. */
  V.walk = function (x, S, gx, gz, speed, dt, face) {
    S = S && S.def ? S : sessionOf(x);
    if (!S || S.done || !(dt > 0)) return 0;
    const A = body(S.a);
    if (!A.pos) return 0;
    const d = Math.hypot(gx - A.pos.x, gz - A.pos.z);
    if (d < 0.05) return 0;
    stepTo(S, A, S.a, gx, gz, face == null ? Math.atan2(gx - A.pos.x, gz - A.pos.z) : face, speed || 1.4, dt);
    return Math.hypot(gx - A.pos.x, gz - A.pos.z);
  };
  V.endFall = endFall;
  // the struggle input (tools/verbs-check.mjs presses it by hand); gripOf(S) for a read
  V.press = markPress;
  V.grip = function (S) { return S && S.grip != null ? S.grip : null; };
  V.busy = busy;
  V.setCuffs = setCuffs;
  V.cuffed = isCuffed;
  V.reach = reach;
  V.pick = pick;
  V.CONE = 0.3;
  V.launch = function (a, kind, dir, power) { const B = body(norm(a)); const c = context(B.pos, dir, 3); launch(norm(a), kind || c.kind, c, dir, power); };
  V.update = update;               // the late pass (tools/verbs-check.mjs drives it by hand)
  V.sessions = sessions;
  V.flights = flights;
  V.handTo = handTo;
  V.handPoint = handPoint;
  V.DEFS = DEF;
  ["grab", "carry", "throw", "shove", "tackle", "cuff", "uncuff", "frisk", "drag", "escort", "choke", "shield", "mug"]
    .forEach(function (verb) { V[verb] = function (a, t, opts) { return start(verb, a, t, opts); }; });
})();
