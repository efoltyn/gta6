/* ============================================================
   entities/character.js — blocky avatar + a layered PROCEDURAL
   animation rig, now with TWO-SEGMENT LIMBS (real elbows + knees).

     root (g)            ← world transform (position / facing / KO)
      ├─ ll, rl          ← leg pivots at the HIPS
      │    └─ low        ← KNEE pivot (shin + shoe cap live here)
      └─ body            ← everything above the hips; bob / sway / lean
          ├─ torso, collar
          ├─ la, ra      ← arm pivots at the SHOULDERS
          │    └─ low    ← ELBOW pivot (forearm + hand cap + hand socket)
          └─ neck → head ← head pivot for look / bob

   Joint conventions (facing +z):
     negative rotation.x on a hip/shoulder swings the limb FORWARD.
     KNEE only folds BACKWARD  → knee rotation.x >= 0.
     ELBOW only folds FORWARD  → elbow rotation.x <= 0.

   Compatibility contract kept for every other system:
     rig.parts.{ll,rl,la,ra}    = the TOP pivots (hip/shoulder), as before
     part.userData.main         = the UPPER segment mesh
     part.userData.cap          = the hand/shoe cap mesh
     part.userData.low          = the NEW joint pivot group
     part.userData.lower        = the NEW lower segment mesh
     rig.low.{ll,rl,la,ra}      = the joint pivots (same objects as .low)
     rig.sockets.*              = same objects as before (now parented at the
                                  real wrist inside the elbow group)
     rig.skinSlots.arms/legs    = STILL length-2 upper meshes (wounds.js
                                  indexes [0]/[1] and checks length===2)
     rig.skinSlots.armsLower/legsLower = the new lower meshes
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const mat = CBZ.mat, cmat = CBZ.cmat, boxGeom = CBZ.boxGeom;

  /* Two-segment limb. Pivot group at the hip/shoulder; upper box hangs to the
     joint; a `low` pivot group sits AT the joint with the lower box + cap
     inside it. The lower box's top is tucked 0.06 UP into the (wider) upper
     box so bending the joint never opens a gap — the overlap sweeps through
     the elbow/knee like a rounded joint filler.
       w,d      upper segment cross-section
       upperH   shoulder/hip → joint
       lowerH   joint → wrist/ankle
       capColor/capH: hand or shoe cap, strictly enclosing the lower end. */
  function limb(w, upperH, lowerH, d, color, capColor, capH, lowerColor) {
    const grp = new THREE.Group();
    const upper = new THREE.Mesh(boxGeom(w, upperH, d), cmat(color));
    upper.position.y = -upperH / 2;
    upper.castShadow = upper.receiveShadow = true;
    grp.add(upper);
    grp.userData.main = upper;

    const low = new THREE.Group();
    low.position.y = -(upperH - 0.02);          // joint pivot, tucked 2cm up
    grp.add(low);
    grp.userData.low = low;

    const lw = w * 0.9, ld = d * 0.9;           // lower tapers, nests in upper
    const overlap = 0.06;
    const lower = new THREE.Mesh(boxGeom(lw, lowerH + overlap, ld), cmat(lowerColor != null ? lowerColor : color));
    lower.position.y = (overlap - lowerH) / 2;  // top at +overlap, bottom at -lowerH
    lower.castShadow = lower.receiveShadow = true;
    low.add(lower);
    grp.userData.lower = lower;

    if (capColor != null) {
      // cap strictly encloses the lower end (see z-fight note in git history:
      // no co-planar faces with the trouser/sleeve box).
      const ch = capH || 0.22;
      const cap = new THREE.Mesh(boxGeom(lw * 1.06, ch + 0.03, ld * 1.38), cmat(capColor));
      cap.position.y = -lowerH - 0.03 + (ch + 0.03) / 2;
      cap.position.z = ld * 0.1;
      cap.castShadow = true;
      low.add(cap);
      grp.userData.cap = cap;
    }
    return grp;
  }

  // Whole-limb lengths preserved: arm 0.92 (+0.2 hand), leg 0.95 (+0.2 shoe).
  const ARM_UP = 0.46, ARM_LO = 0.46;
  const LEG_UP = 0.48, LEG_LO = 0.47;

  function makeCharacter(c) {
    const g = new THREE.Group();

    // ---- legs (children of root: feet stay planted) ----
    const ll = limb(0.34, LEG_UP, LEG_LO, 0.34, c.legs, c.shoes, 0.2);
    const rl = limb(0.34, LEG_UP, LEG_LO, 0.34, c.legs, c.shoes, 0.2);
    ll.position.set(-0.23, 0.95, 0); rl.position.set(0.23, 0.95, 0);
    g.add(ll, rl);

    // ---- body (everything above the hips) ----
    const body = new THREE.Group();
    body.position.y = 0; // bob/sway/lean applied here
    g.add(body);

    const torso = new THREE.Mesh(boxGeom(0.92, 0.95, 0.5), cmat(c.torso));
    torso.position.y = 1.42; torso.castShadow = torso.receiveShadow = true;
    const collar = new THREE.Mesh(boxGeom(0.94, 0.18, 0.52), cmat(c.collar || c.torso));
    collar.position.y = 1.84;
    body.add(torso, collar);

    // short-sleeve opt-in: the forearm reads as bare skin (peds.js tees)
    const la = limb(0.3, ARM_UP, ARM_LO, 0.3, c.arms, c.skin, 0.2, c.shortSleeve ? c.skin : null);
    const ra = limb(0.3, ARM_UP, ARM_LO, 0.3, c.arms, c.skin, 0.2, c.shortSleeve ? c.skin : null);
    la.position.set(-0.62, 1.84, 0); ra.position.set(0.62, 1.84, 0);
    body.add(la, ra);
    const leftHand = new THREE.Group();
    const rightHand = new THREE.Group();
    // wrist, in the ELBOW group's frame (upper 0.46 already spent above it)
    leftHand.position.set(0, -ARM_LO - 0.01, 0.035);
    rightHand.position.set(0, -ARM_LO - 0.01, 0.035);
    leftHand.userData.isSocket = rightHand.userData.isSocket = true;
    la.userData.low.add(leftHand); ra.userData.low.add(rightHand);
    const thirdPersonWeapon = new THREE.Group();
    thirdPersonWeapon.position.set(0.02, -0.03, 0.06);
    thirdPersonWeapon.userData.isSocket = true;
    rightHand.add(thirdPersonWeapon);

    // neck pivot so the head can turn/tilt independently
    const neck = new THREE.Group();
    neck.position.y = 1.88;
    // head keeps a FRESH (unshared) material — systems/reactions.js flashes
    // its emissive per-actor on hits, so it must not be a shared cache entry.
    const head = new THREE.Mesh(boxGeom(0.6, 0.6, 0.6), mat(c.skin));
    head.position.y = 0.3; head.castShadow = true;
    const eyeMat = cmat(0x101010);
    const le = new THREE.Mesh(boxGeom(0.13, 0.16, 0.08), eyeMat);
    const re = new THREE.Mesh(boxGeom(0.13, 0.16, 0.08), eyeMat);
    le.position.set(-0.14, 0.34, 0.315); re.position.set(0.14, 0.34, 0.315);
    const brow = new THREE.Mesh(boxGeom(0.46, 0.06, 0.06), cmat(0x1c150e));
    brow.position.set(0, 0.46, 0.315);
    const mouth = new THREE.Mesh(boxGeom(0.22, 0.06, 0.06), cmat(0x4a2528));
    mouth.position.set(0, 0.16, 0.315);
    neck.add(head, le, re, brow, mouth);
    body.add(neck);

    // ---- accessories (all on the body so they move with it) ----
    if (c.stripes) for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(boxGeom(0.94, 0.12, 0.52), cmat(c.stripes));
      s.position.y = 1.18 + i * 0.28; body.add(s);
      (body.userData.stripes || (body.userData.stripes = [])).push(s);
    }
    const beltParts = [], badgeParts = [], capParts = [], hairParts = [];
    if (c.belt) {
      const belt = new THREE.Mesh(boxGeom(0.96, 0.16, 0.54), cmat(c.belt));
      belt.position.y = 1.02; body.add(belt); beltParts.push(belt);
      const buckle = new THREE.Mesh(boxGeom(0.18, 0.16, 0.06), cmat(0xffd451));
      buckle.position.set(0, 1.02, 0.29); body.add(buckle); beltParts.push(buckle);
    }
    if (c.badge) {
      const badge = new THREE.Mesh(boxGeom(0.16, 0.16, 0.05), cmat(0xffd451));
      badge.position.set(-0.28, 1.55, 0.27); body.add(badge); badgeParts.push(badge);
    }
    if (c.cap) {
      const cap = new THREE.Mesh(boxGeom(0.66, 0.22, 0.66), cmat(c.cap));
      cap.position.y = 0.67; neck.add(cap); capParts.push(cap);
      const brim = new THREE.Mesh(boxGeom(0.66, 0.1, 0.3), cmat(c.cap));
      brim.position.set(0, 0.58, 0.42); neck.add(brim); capParts.push(brim);
    } else {
      const hair = new THREE.Mesh(boxGeom(0.64, 0.18, 0.64), cmat(c.hair || 0x4a3526));
      hair.position.y = 0.62; neck.add(hair); hairParts.push(hair);
    }

    // painted-clothing atlas metadata: which vertical band of the garment row
    // each segment shows (0=hem/wrist, 1=shoulder/waist). city/clothes.js
    // reads these to UV-map split limbs; absent tags = whole row (legacy).
    const tagCloth = (mesh, dims, band) => { mesh.userData.clothDims = dims; mesh.userData.clothBand = band; };
    tagCloth(la.userData.main, [0.3, ARM_UP, 0.3], [1 - ARM_UP / 0.92, 1]);
    tagCloth(ra.userData.main, [0.3, ARM_UP, 0.3], [1 - ARM_UP / 0.92, 1]);
    tagCloth(la.userData.lower, [0.27, ARM_LO + 0.06, 0.27], [0, (ARM_LO + 0.06) / 0.92]);
    tagCloth(ra.userData.lower, [0.27, ARM_LO + 0.06, 0.27], [0, (ARM_LO + 0.06) / 0.92]);
    tagCloth(ll.userData.main, [0.34, LEG_UP, 0.34], [1 - LEG_UP / 0.95, 1]);
    tagCloth(rl.userData.main, [0.34, LEG_UP, 0.34], [1 - LEG_UP / 0.95, 1]);
    tagCloth(ll.userData.lower, [0.31, LEG_LO + 0.06, 0.31], [0, (LEG_LO + 0.06) / 0.95]);
    tagCloth(rl.userData.lower, [0.31, LEG_LO + 0.06, 0.31], [0, (LEG_LO + 0.06) / 0.95]);

    const rig = {
      group: g, body, neck, head,
      parts: { ll, rl, la, ra },
      low: { ll: ll.userData.low, rl: rl.userData.low, la: la.userData.low, ra: ra.userData.low },
      sockets: { leftHand, rightHand, weapon: rightHand, thirdPersonWeapon },
      skinSlots: {
        torso: [torso],
        collar: [collar],
        legs: [ll.userData.main, rl.userData.main],
        legsLower: [ll.userData.lower, rl.userData.lower],
        shoes: [ll.userData.cap, rl.userData.cap].filter(Boolean),
        arms: [la.userData.main, ra.userData.main],
        armsLower: [la.userData.lower, ra.userData.lower],
        hands: [la.userData.cap, ra.userData.cap].filter(Boolean),
        head: [head],
        stripes: body.userData.stripes || [],
        belt: beltParts,
        badge: badgeParts,
        cap: capParts,
        hair: hairParts,
      },
      face: { eyeL: le, eyeR: re, brow, mouth }, // animated by systems/facial.js
      detail: [le, re, brow, mouth].concat(hairParts, capParts, body.userData.stripes || [], badgeParts),
      phase: Math.random() * 6.28,  // desync gaits between actors
      bob: 0, breath: Math.random() * 6.28,
      lean: 0, sway: 0, headYaw: 0,
    };
    if (c.clothes && CBZ.applyClothes) CBZ.applyClothes(rig, c.clothes);
    return rig;
  }

  // shortest-arc angle lerp
  function lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  // frame-rate-independent approach: x → target by `rate` (per second)
  function damp(cur, target, rate, dt) {
    return cur + (target - cur) * (1 - Math.exp(-rate * dt));
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* ---- the layered animation update ----
     speed: current planar speed (units/s). dt: seconds.

     Gait model (verified frame-by-frame with tools/studio.mjs filmstrips):
       θ = ch.phase, LEFT hip = +A·sinθ  (positive x = limb swings BACK)
       left leg swings FORWARD while cosθ<0 → left knee flexes then, peaking
       mid-swing (θ≈π); right leg mirrors (cosθ>0, peak θ≈0).
       Double support ≈ θ=π/2, 3π/2 (feet apart) → CoM lowest there.
       Arms counter-swing the legs; elbows carry a base bend that deepens
       with speed (jogger's ~90° pump at sprint) and on the forward swing. */
  function animChar(ch, speed, dt) {
    const moving = speed > 0.2;
    const walkRef = (CBZ.TUNE && CBZ.TUNE.walkSpeed) || 6.4;
    const norm = Math.min(speed / walkRef, 1);          // 0..1 stand→brisk
    const run2 = clamp01((speed - walkRef) / (walkRef * 0.7)); // sprint layer
    ch.breath += dt;
    const J = ch.low || {};
    const setKnee = (j, x, rate) => { if (j) { j.rotation.x = damp(j.rotation.x, Math.max(0, x), rate, dt); j.rotation.y = damp(j.rotation.y, 0, 12, dt); j.rotation.z = damp(j.rotation.z, 0, 12, dt); } };
    const setElbow = (j, x, rate) => { if (j) { j.rotation.x = damp(j.rotation.x, Math.min(0, x), rate, dt); j.rotation.y = damp(j.rotation.y, 0, 12, dt); j.rotation.z = damp(j.rotation.z, 0, 12, dt); } };

    // ---- SEATED (office-jobs): full-rig pose that OWNS the body ----
    if (ch.sitting) {
      const sr = 12;
      ch.body.position.y = damp(ch.body.position.y, -0.6, sr, dt);     // hips drop into the chair
      ch.body.rotation.x = damp(ch.body.rotation.x, 0.14, sr, dt);     // slight working lean
      ch.body.rotation.z = damp(ch.body.rotation.z, 0, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      // thighs fold forward, shins hang to the floor (real knees now)
      if (ch.parts.ll) { ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -1.3, sr, dt); ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.06, sr, dt); ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, sr, dt); ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt); }
      if (ch.parts.rl) { ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -1.3, sr, dt); ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.06, sr, dt); ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, sr, dt); ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt); }
      setKnee(J.ll, 1.42, sr); setKnee(J.rl, 1.38, sr);
      // forearms rest toward the desktop
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.34, sr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.12, sr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt); ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.06, sr, dt); }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.34, sr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.12, sr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt); ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.06, sr, dt); }
      setElbow(J.la, -0.72, sr); setElbow(J.ra, -0.72, sr);
      if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.04, sr, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt); }
      return;   // seated pose owns the whole rig
    }

    // gait advances with DISTANCE TRAVELLED, not a wall clock — one stride per
    // STRIDE_LEN metres so feet plant instead of sliding (see git history).
    const STRIDE_LEN = 1.15;
    ch.phase += dt * 0.9 + (speed * dt) / STRIDE_LEN;
    const sinP = Math.sin(ch.phase), cosP = Math.cos(ch.phase);
    const hipAmp = 0.30 + 0.26 * norm + 0.16 * run2;
    const swing = sinP * hipAmp;

    // ---- LEG WOUND / LIMP STATE ----
    let lh = ch.legHurt;
    if (lh) {
      lh.t -= dt;
      if (lh.sev < 0.5) lh.sev = Math.max(0, lh.sev - dt * (0.5 / 20));
      if (lh.sev <= 0.001 || lh.t <= 0) { ch.legHurt = null; lh = null; }
    }
    // STALE-FLAG GUARD: a pooled rig promoted with legGone still set for a
    // frame walks folded face-down; the hidden leg mesh is ground truth.
    if (ch.legGone) {
      const gonePart = ch.legGone < 0 ? ch.parts.ll : ch.parts.rl;
      if (gonePart && gonePart.visible !== false) { ch.legGone = 0; }
    }
    const legGone = ch.legGone;                     // -1 left / +1 right / 0|undef
    const hurtSide = lh ? lh.side : 0;
    const sev = lh ? Math.min(1, lh.sev) : 0;
    ch.limpSpeedMul = legGone ? 0.0 : (1 - sev * 0.5);

    // ---- legs: opposed hip swing + biomechanical knee flexion ----
    const legRate = 16, armRate = 14;
    const lSwing = moving ? swing * (hurtSide < 0 ? 1 - sev * 0.62 : 1) : 0;
    const rSwing = moving ? -swing * (hurtSide > 0 ? 1 - sev * 0.62 : 1) : 0;
    const lBend = hurtSide < 0 ? sev * 0.22 : 0;
    const rBend = hurtSide > 0 ? sev * 0.22 : 0;
    ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, lSwing - lBend, legRate, dt);
    ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, rSwing - rBend, legRate, dt);
    // CROSS-LEG GUARD: pose layers own z/y; recycled corpse splay must not
    // ride into a fresh walker (animChar only runs on live upright actors).
    ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0, 12, dt);
    ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, 0, 12, dt);
    ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, 12, dt);
    ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, 12, dt);
    // the old scale.y foot-lift fake dies — real knees carry the clearance
    ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, 16, dt);
    ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, 16, dt);

    // knees: flex through the swing phase (left swings forward while cosθ<0,
    // peaking mid-swing), carry a small stance flexion so legs never look
    // hyper-extended, plus a load-response dip right after heel strike.
    const kneeAmp = 0.62 + 0.55 * norm + 0.55 * run2;   // sprint kicks heels up
    const stanceK = moving ? 0.10 + 0.10 * norm : 0.04;
    const kneeL = moving ? stanceK + kneeAmp * Math.pow(Math.max(0, -cosP), 1.3) * (hurtSide < 0 ? 1 - sev * 0.7 : 1) : 0.04;
    const kneeR = moving ? stanceK + kneeAmp * Math.pow(Math.max(0, cosP), 1.3) * (hurtSide > 0 ? 1 - sev * 0.7 : 1) : 0.04;
    setKnee(J.ll, kneeL + lBend * 1.4, legRate);
    setKnee(J.rl, kneeR + rBend * 1.4, legRate);

    // ---- arms ----
    if (ch.aimingPose) {
      // present-weapon: gun arm out along the crosshair, support arm on the
      // handguard. animChar is the single owner of the arms while aiming.
      const longGun = !!ch.aimLong;
      const recoil = ch.aimRecoil || 0;
      const recoilSide = ch.aimRecoilSide || 0;
      const pitch = (CBZ.cam && typeof CBZ.cam.pitch === "number") ? CBZ.cam.pitch : 0;
      const ar = 16;
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -1.571 - pitch * 0.8 - recoil * 0.16, ar, dt);
      ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, -0.18 + recoilSide * 0.22, ar, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.34, ar, dt);
      ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.14, ar, dt);
      ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, (longGun ? -1.55 : -1.45) - pitch * 0.8, ar - 1, dt);
      ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, longGun ? 0.34 : 0.22, ar - 1, dt);
      ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, longGun ? 0.42 : 0.30, ar - 1, dt);
      ch.parts.la.position.z = damp(ch.parts.la.position.z, longGun ? 0.24 : 0.14, ar - 1, dt);
      // gun arm nearly locked; the support elbow closes onto the handguard.
      // recoil folds the elbow a touch — the arm absorbs the kick.
      setElbow(J.ra, -0.10 - recoil * 0.25, ar);
      setElbow(J.la, longGun ? -0.72 : -0.48, ar - 1);
    } else if (ch.cuffed) {
      ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, 0.5, 10, dt);
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, 0.5, 10, dt);
      ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.5, 10, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, 0.5, 10, dt);
      setElbow(J.la, -0.55, 10); setElbow(J.ra, -0.55, 10);
    } else if (ch.surrender || ch.handsUp) {
      // the hands-up layer below OWNS the arms — if the idle counter-swing
      // also wrote them, the two damps fight and the arms equilibrate at a
      // half-raised ~40° (filmstrip-diagnosed) instead of reaching the pose.
    } else {
      // counter-swing with an elbow that deepens with pace: relaxed ~14° at
      // idle, a soft 35-45° at a walk, a real ~90° runner's pump at sprint.
      // The elbow also folds a little extra as the arm swings FORWARD (a
      // straight back-swing + bent fore-swing is what reads "human").
      const armAmp = hipAmp * (0.95 + 0.25 * run2);
      const laTarget = moving ? -swing * armAmp / hipAmp * (0.55 + 0.45 * hipAmp) : 0;
      const raTarget = moving ? swing * armAmp / hipAmp * (0.55 + 0.45 * hipAmp) : 0;
      ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, laTarget, armRate, dt);
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, raTarget, armRate, dt);
      ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.08, 6, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.08, 6, dt);
      const elbBase = moving ? 0.30 + 0.42 * norm + 0.62 * run2 : 0.22 + Math.sin(ch.breath * 2.2) * 0.02;
      const foldL = moving ? Math.max(0, -laTarget) * 0.8 : 0;   // forward swing folds
      const foldR = moving ? Math.max(0, -raTarget) * 0.8 : 0;
      setElbow(J.la, -(elbBase + foldL), armRate - 2);
      setElbow(J.ra, -(elbBase + foldR), armRate - 2);
    }
    if (!ch.aimingPose) {
      ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, 10, dt);
      ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, 10, dt);
      ch.parts.la.position.z = damp(ch.parts.la.position.z, 0, 12, dt);
      ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0, 12, dt);
    }

    // ---- body: bob (2× stride), side sway, forward lean, counter-rotation --
    // CoM is lowest at double support (feet furthest apart, |sinθ| max).
    const bobTarget = moving ? -Math.abs(sinP) * (0.03 + 0.05 * norm + 0.03 * run2) : 0;
    const idleBreath = moving ? 0 : Math.sin(ch.breath * 2.2) * 0.012;
    ch.bob = damp(ch.bob, bobTarget, 12, dt);
    ch.body.position.y = ch.bob + idleBreath;

    // weight shifts over the stance foot; a touch of idle sway keeps a
    // standing rig alive instead of statue-frozen. Turning while moving BANKS
    // the body into the turn like a runner rounding a corner — yaw rate is
    // derived from the root's facing so no caller has to pass anything.
    let turnBank = 0;
    if (ch.group) {
      const yaw = ch.group.rotation.y;
      if (ch._prevYaw !== undefined && dt > 0.0001) {
        let dy = yaw - ch._prevYaw;
        if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
        const yawRate = Math.max(-6, Math.min(6, dy / dt));
        turnBank = moving ? -yawRate * 0.045 * (0.4 + 0.6 * norm) : 0;
      }
      ch._prevYaw = yaw;
    }
    const swayTarget = (moving ? sinP * (0.015 + 0.03 * norm) : Math.sin(ch.breath * 0.9) * 0.012) + turnBank;
    ch.sway = damp(ch.sway, swayTarget, 10, dt);
    ch.body.rotation.z = ch.sway;

    const leanTarget = norm * 0.12 + run2 * 0.10;   // lean into the run
    ch.lean = damp(ch.lean, leanTarget, 8, dt);
    ch.body.rotation.x = ch.lean;

    // shoulders counter-rotate the stride (right shoulder leads the left
    // foot): subtle at a walk, pronounced at a sprint. The punch layer OWNS
    // body.rotation.y while active, so only write it here when not punching.
    const yGait = moving ? sinP * (0.05 + 0.05 * norm + 0.05 * run2) : 0;

    // ---- LIMP: the body dips toward the hurt leg as it bears weight ----
    if (sev > 0.02 && moving && !legGone) {
      const plant = hurtSide < 0 ? Math.max(0, -sinP) : Math.max(0, sinP);
      ch.body.position.y -= plant * sev * 0.09;
      ch.body.rotation.z += hurtSide * plant * sev * 0.16;
    }

    // ---- LEG SEVERED: sink into a low crawl/collapse ----
    if (legGone) {
      const crawl = moving ? sinP : 0;
      ch.body.position.y = damp(ch.body.position.y, -0.85, 8, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, 0.95, 8, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, legGone * 0.45, 8, dt);
      const goodLeg = legGone < 0 ? ch.parts.rl : ch.parts.ll;
      const stumpLeg = legGone < 0 ? ch.parts.ll : ch.parts.rl;
      const goodKnee = legGone < 0 ? J.rl : J.ll;
      if (goodLeg) { goodLeg.rotation.x = damp(goodLeg.rotation.x, -0.5 + crawl * 0.5, 10, dt); goodLeg.scale.y = damp(goodLeg.scale.y, 1, 10, dt); }
      setKnee(goodKnee, 0.85 - crawl * 0.3, 10);
      if (stumpLeg) stumpLeg.rotation.x = damp(stumpLeg.rotation.x, -0.2, 10, dt);
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -1.5 + crawl * 0.6, 10, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.2, 10, dt); }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -1.5 - crawl * 0.6, 10, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.2, 10, dt); }
      setElbow(J.la, -0.7 - crawl * 0.25, 10); setElbow(J.ra, -0.7 + crawl * 0.25, 10);
      if (ch.neck) ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.5, 9, dt);
      return;   // a one-legged crawl owns the whole rig
    }

    // ---- punch: guard -> chamber -> drive (elbow whips open) -> recover.
    // The elbow is what makes it read: fists start UP by the chin (deep
    // bend), the strike extends the elbow through the target, the guard
    // hand STAYS at the jaw. Weight transfers through hips + a body dip.
    if (ch.punchT > 0) {
      ch.punchT -= dt;
      const dur = ch.punchDur || 0.28;
      const prog = 1 - Math.max(0, ch.punchT) / dur;    // 0..1 over the punch
      const wind = Math.max(0, 1 - prog / 0.24);        // anticipation
      const drive = Math.sin(Math.min(1, Math.max(0, (prog - 0.16) / 0.54)) * Math.PI);
      const recover = Math.max(0, (prog - 0.62) / 0.38);
      const left = ch.punchArm === "l";
      const arm = left ? ch.parts.la : ch.parts.ra;
      const guard = left ? ch.parts.ra : ch.parts.la;
      const armJ = left ? J.la : J.ra;
      const guardJ = left ? J.ra : J.la;
      const sgn = left ? 1 : -1;
      // guard hand: tucked at the jaw the whole time
      guard.rotation.x = -1.05 - 0.15 * drive;
      guard.rotation.z = -sgn * 0.42;
      guard.position.z = 0.10;
      if (guardJ) guardJ.rotation.x = -1.85;
      if (ch.punchKind === "upper") {                   // rising uppercut
        // fist drops to the waist on the wind, then the hips+shoulder launch
        // it UP THE CENTERLINE to the chin — upper arm stops forward-low
        // (~-0.9) with the elbow folded so the forearm is vertical at impact.
        // (Filmstrip-verified: driving the shoulder past horizontal put the
        // fist above the head — a superman punch, not an uppercut.)
        arm.rotation.x = 0.55 + 0.30 * wind - 1.48 * drive;
        arm.rotation.y = sgn * 0.18 * drive;
        arm.rotation.z = sgn * (0.18 + 0.10 * drive);
        arm.position.z = 0.04 + 0.16 * drive;
        if (armJ) armJ.rotation.x = -(1.20 + 0.45 * wind + 0.38 * drive);
        ch.body.rotation.x = ch.lean + 0.24 * wind - 0.26 * drive;
        ch.body.rotation.y = sgn * (0.30 * wind + 0.70 * drive - 0.18 * recover);
        ch.body.position.y += -0.12 * wind - 0.02 * drive;
      } else if (ch.punchKind === "hook") {             // wide hook
        // RAISE first (upper arm to horizontal, elbow locked ~90°), THEN the
        // body slings the folded arm around on a flat horizontal arc — the
        // yaw sweep only starts once the arm is up, so the fist tracks jaw
        // height instead of climbing (filmstrip-verified).
        const raise = Math.min(1, prog / 0.26);
        arm.rotation.x = -1.28 * raise;
        arm.rotation.y = sgn * (0.95 - 1.55 * drive) * raise;
        arm.rotation.z = sgn * (0.20 + 0.30 * drive);
        arm.position.z = 0.05 + 0.16 * drive;
        if (armJ) armJ.rotation.x = -(1.50 + 0.15 * drive);
        ch.body.rotation.x = ch.lean - 0.06 * drive;
        ch.body.rotation.y = sgn * (0.50 * wind + 1.00 * drive - 0.24 * recover);
        ch.body.position.y += -0.05 * drive;
      } else {                                          // straight jab/cross
        // fist chambers at the chin (deep elbow), shoulder drives forward as
        // the elbow SNAPS open — full extension at peak drive, fist stopping
        // at the chin height of a same-size opponent (-1.42, not overhead).
        arm.rotation.x = -0.95 + 0.15 * wind - 0.47 * drive + 0.22 * recover;
        arm.rotation.y = sgn * -0.16 * drive;
        arm.rotation.z = sgn * (0.16 + 0.10 * drive);
        arm.position.z = -0.04 * wind + 0.26 * drive;
        if (armJ) armJ.rotation.x = -(2.05 - 1.95 * Math.pow(drive, 1.4) + 0.15 * wind);
        ch.body.rotation.x = ch.lean - 0.12 * drive + 0.08 * wind;
        ch.body.rotation.y = sgn * (0.26 * wind + 0.62 * drive - 0.18 * recover);
        ch.body.position.y += -0.03 * drive;
      }
      // fighting stance while planted: staggered feet, knees soft, weight
      // rolls rear→front through the drive. Gait owns the legs when moving.
      if (!moving) {
        const lead = left ? ch.parts.rl : ch.parts.ll;     // opposite foot leads
        const rear = left ? ch.parts.ll : ch.parts.rl;
        const leadJ = left ? J.rl : J.ll;
        const rearJ = left ? J.ll : J.rl;
        if (lead) lead.rotation.x = damp(lead.rotation.x, -0.30 + 0.10 * drive, 14, dt);
        if (rear) rear.rotation.x = damp(rear.rotation.x, 0.26 + 0.10 * drive, 14, dt);
        setKnee(leadJ, 0.28 + 0.10 * drive, 14);
        setKnee(rearJ, 0.42 + 0.22 * drive, 14);           // rear knee drives in
        ch.body.position.y -= 0.06;                        // sits into the stance
      }
    } else {
      ch.body.rotation.y = damp(ch.body.rotation.y, yGait, 10, dt);
    }

    // Hands-up surrender/intimidation: shoulders raise, elbows fold so the
    // palms actually face the gunman at head height (not flagpole arms).
    if (ch.surrender || ch.handsUp) {
      // upper arms drive well past vertical and splay outward; a SMALL elbow
      // bend tips the palms forward beside the head. (Filmstrip caught the
      // first attempt: a -0.9 elbow folded the forearms flat across the face.)
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -2.60, 18, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0.16, 14, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.32, 14, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.20, 14, dt);
      }
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -2.60, 18, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, -0.16, 14, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, 0.32, 14, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.20, 14, dt);
      }
      setElbow(J.la, -0.20, 16); setElbow(J.ra, -0.20, 16);
      ch.body.rotation.x = damp(ch.body.rotation.x, -0.07, 10, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, 12, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, 0, 12, dt);
    }

    // ---- head: subtle counter-bob + breathing tilt, keeps eyes level ----
    if (ch.neck) {
      ch.neck.rotation.x = damp(ch.neck.rotation.x, -ch.lean * 0.7 + (moving ? Math.sin(ch.phase * 2) * 0.02 : 0), 9, dt);
      ch.neck.rotation.z = damp(ch.neck.rotation.z, -ch.sway * 0.6, 9, dt);
    }
  }

  // ---- dramatic death sprawl (seeded variety; caller owns group topple).
  //      Real elbows/knees now sell the "broken heap": bent knees, folded
  //      arms — no more plank limbs on corpses. ----
  function deathPose(ch, seed, fall) {
    if (!ch || !ch.parts) return;
    ch.sitting = false;
    const s = seed || 0;
    const p = ch.parts;
    const J = ch.low || {};
    const j = (k) => Math.sin(s * k);   // cheap per-corpse jitter in [-1,1]
    const knee = (g, v) => { if (g) g.rotation.set(Math.max(0, v), 0, 0); };
    const elbow = (g, v) => { if (g) g.rotation.set(Math.min(0, v), 0, 0); };
    let pick = Math.abs(j(5.1));        // 0..1
    if (fall != null) pick = pick * 0.5 + fall * 0.5;
    const tmpl = pick < 0.4 ? 0 : (pick < 0.75 ? 1 : 2);
    if (tmpl === 1) {
      // FACE-DOWN crumple: arms forward/under, legs trailing, head aside
      if (p.la) { p.la.rotation.set(-1.5 + j(1.7) * 0.4, 0.2, 0.4 + j(2.1) * 0.2); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-1.3 + j(2.9) * 0.4, -0.2, -0.5 - j(1.3) * 0.2); p.ra.position.z = 0; }
      elbow(J.la, -0.5 - Math.abs(j(3.7)) * 0.5); elbow(J.ra, -0.2 - Math.abs(j(4.1)) * 0.4);
      if (p.ll) { p.ll.rotation.set(-0.15 + j(3.3) * 0.15, 0, 0.2 + j(1.1) * 0.15); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(0.1 + j(2.3) * 0.15, 0, -0.25 - j(2.7) * 0.15); p.rl.scale.y = 1; }
      knee(J.ll, 0.15 + Math.abs(j(6.1)) * 0.5); knee(J.rl, 0.45 + Math.abs(j(5.3)) * 0.6);
      if (ch.body) { ch.body.rotation.set(0.1 * j(1.9), 0, 0.08 * j(2.5)); ch.body.position.y = 0; }
      if (ch.neck) ch.neck.rotation.set(-0.4, 0.7 * (j(1.5) >= 0 ? 1 : -1), 0.25 * j(2.2));
    } else if (tmpl === 2) {
      // ON-THE-SIDE fold: knees drawn up, top arm flung across
      const side = j(4.3) >= 0 ? 1 : -1;
      if (p.la) { p.la.rotation.set(-0.6 + j(1.7) * 0.4, 0.25, (0.9 + j(2.1) * 0.2) * (side > 0 ? 1 : 0.4)); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-0.5 + j(2.9) * 0.4, -0.25, (-0.95 - j(1.3) * 0.2) * (side < 0 ? 1 : 0.4)); p.ra.position.z = 0; }
      elbow(J.la, -0.7 - Math.abs(j(3.1)) * 0.6); elbow(J.ra, -0.9 - Math.abs(j(2.6)) * 0.5);
      if (p.ll) { p.ll.rotation.set(-0.75 + j(3.3) * 0.25, 0, 0.30 + j(1.1) * 0.2); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(-0.55 + j(2.3) * 0.25, 0, -0.28 - j(2.7) * 0.2); p.rl.scale.y = 1; }
      knee(J.ll, 1.1 + Math.abs(j(4.7)) * 0.5); knee(J.rl, 0.85 + Math.abs(j(3.9)) * 0.5);
      if (ch.body) { ch.body.rotation.set(0.18 * j(1.9), 0, side * 0.14); ch.body.position.y = 0; }
      if (ch.neck) ch.neck.rotation.set(-0.45, side * 0.55, side * 0.3);
    } else {
      // FACE-UP sprawl: arms flung out, legs splayed, one knee cocked
      if (p.la) { p.la.rotation.set(-0.9 + j(1.7) * 0.5, 0.25, 1.15 + j(2.1) * 0.25); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-0.7 + j(2.9) * 0.5, -0.25, -1.2 - j(1.3) * 0.25); p.ra.position.z = 0; }
      elbow(J.la, -0.35 - Math.abs(j(2.8)) * 0.55); elbow(J.ra, -0.15 - Math.abs(j(3.4)) * 0.35);
      if (p.ll) { p.ll.rotation.set(0.25 + j(3.3) * 0.2, 0, 0.4 + j(1.1) * 0.2); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(-0.45 + j(2.3) * 0.3, 0, -0.45 - j(2.7) * 0.2); p.rl.scale.y = 1; }
      knee(J.ll, 0.1 + Math.abs(j(5.7)) * 0.3); knee(J.rl, 0.6 + Math.abs(j(6.3)) * 0.7);   // one cocked knee
      if (ch.body) { ch.body.rotation.set(0.12 * j(1.9), 0, 0.1 * j(2.5)); ch.body.position.y = 0; }
      if (ch.neck) ch.neck.rotation.set(-0.55, 0.5 * j(1.5), 0.3 * j(2.2));
    }
  }

  CBZ.makeCharacter = makeCharacter;
  CBZ.animChar = animChar;
  CBZ.deathPose = deathPose;
  CBZ.lerpAngle = lerpAngle;
  CBZ.damp = damp;
})();
