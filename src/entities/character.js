/* ============================================================
   entities/character.js — blocky Roblox-style avatar + a layered
   PROCEDURAL animation rig. Hierarchy is built so we can animate
   weight, not just spin limbs:

     root (g)            ← world transform (position / facing / KO)
      ├─ ll, rl          ← leg pivots at the hips (feet stay planted)
      └─ body            ← everything above the hips; we bob / sway /
          ├─ torso,collar,  lean THIS so the upper body has weight
          ├─ la, ra      ← arm pivots at the shoulders
          └─ neck → head ← head pivot for look / bob

   Animation is built from layered sine waves (gait, bob, sway, lean)
   plus spring-eased transitions, the way procedural locomotion is
   normally done. See sources cited in chat.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const mat = CBZ.mat, cmat = CBZ.cmat, boxGeom = CBZ.boxGeom;

  // a swinging limb: pivot group at the joint, mesh hanging below,
  // optional end-cap (hand / shoe).
  function limb(w, h, d, color, capColor, capH) {
    const grp = new THREE.Group();
    const m = new THREE.Mesh(boxGeom(w, h, d), cmat(color));
    m.position.y = -h / 2;
    m.castShadow = m.receiveShadow = true;
    grp.add(m);
    grp.userData.main = m;
    if (capColor != null) {
      // The cap (hand on the arm, shoe on the leg) must STRICTLY enclose the
      // limb's lower end. The old cap shared a plane with the sleeve/trouser
      // box on its BOTTOM face (−y: both sat exactly at −h) and very nearly on
      // its BACK face (−z), so the opaque limb z-fought THROUGH the cap — the
      // reported "shirt color shows through the hands" (and the same on shoes).
      // Keep the cap TOP exactly where it was (−h + ch; the visible wrist/ankle
      // seam is unchanged) but deepen it and drop its bottom 0.03 past the limb
      // so no two faces are co-planar and the skin/shoe cap always wins the
      // depth test. Silhouette is effectively unchanged.
      const ch = capH || 0.22;
      const cap = new THREE.Mesh(boxGeom(w * 1.04, ch + 0.03, d * 1.34), cmat(capColor));
      cap.position.y = -h - 0.03 + (ch + 0.03) / 2;
      cap.position.z = d * 0.08;
      cap.castShadow = true;
      grp.add(cap);
      grp.userData.cap = cap;
    }
    return grp;
  }

  function makeCharacter(c) {
    const g = new THREE.Group();

    // ---- legs (children of root: feet stay planted) ----
    const ll = limb(0.34, 0.95, 0.34, c.legs, c.shoes, 0.2);
    const rl = limb(0.34, 0.95, 0.34, c.legs, c.shoes, 0.2);
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

    const la = limb(0.3, 0.92, 0.3, c.arms, c.skin, 0.2);
    const ra = limb(0.3, 0.92, 0.3, c.arms, c.skin, 0.2);
    la.position.set(-0.62, 1.84, 0); ra.position.set(0.62, 1.84, 0);
    body.add(la, ra);
    const leftHand = new THREE.Group();
    const rightHand = new THREE.Group();
    leftHand.position.set(0, -0.93, 0.035);
    rightHand.position.set(0, -0.93, 0.035);
    la.add(leftHand); ra.add(rightHand);
    const thirdPersonWeapon = new THREE.Group();
    thirdPersonWeapon.position.set(0.02, -0.03, 0.06);
    rightHand.add(thirdPersonWeapon);

    // neck pivot so the head can turn/tilt independently
    const neck = new THREE.Group();
    neck.position.y = 1.88;
    // head keeps a FRESH (unshared) material — systems/reactions.js flashes
    // its emissive per-actor on hits, so it must not be a shared cache entry.
    const head = new THREE.Mesh(boxGeom(0.6, 0.6, 0.6), mat(c.skin));
    head.position.y = 0.3; head.castShadow = true;
    // FACE READS AT RANGE: slightly bigger, darker, prouder features so a face
    // is legible at 20-40u (street distance), not just in a close-up. Deeper
    // boxes wrap back into the head so the features hold up at oblique angles
    // instead of vanishing edge-on. facial.js owns eye x/y + mouth y at runtime
    // (it rewrites them every frame); z and geometry size are ours to set here.
    const eyeMat = cmat(0x101010);
    const le = new THREE.Mesh(boxGeom(0.13, 0.16, 0.08), eyeMat);
    const re = new THREE.Mesh(boxGeom(0.13, 0.16, 0.08), eyeMat);
    le.position.set(-0.14, 0.34, 0.315); re.position.set(0.14, 0.34, 0.315);
    // a brow line + a small mouth for expression (animated by systems/facial.js)
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

    const rig = {
      group: g, body, neck, head,
      parts: { ll, rl, la, ra },
      sockets: { leftHand, rightHand, weapon: rightHand, thirdPersonWeapon },
      skinSlots: {
        torso: [torso],
        collar: [collar],
        legs: [ll.userData.main, rl.userData.main],
        shoes: [ll.userData.cap, rl.userData.cap].filter(Boolean),
        arms: [la.userData.main, ra.userData.main],
        hands: [la.userData.cap, ra.userData.cap].filter(Boolean),
        head: [head],
        stripes: body.userData.stripes || [],
        belt: beltParts,
        badge: badgeParts,
        cap: capParts,
        hair: hairParts,
      },
      face: { eyeL: le, eyeR: re, brow, mouth }, // animated by systems/facial.js
      // small features only legible up close — hidden by the NPC LOD at
      // distance to cut draw calls (entities/npc.js toggles .visible on these).
      detail: [le, re, brow, mouth].concat(hairParts, capParts, body.userData.stripes || [], badgeParts),
      phase: Math.random() * 6.28,  // desync gaits between actors
      bob: 0, breath: Math.random() * 6.28,
      lean: 0, sway: 0, headYaw: 0,
    };
    // PAINTED CLOTHING opt-in (city/clothes.js): a caster may pass an outfit
    // record as c.clothes to dress the rig in canvas-painted garments. When
    // absent — every jail/survival caller — nothing runs and the rig is the
    // exact flat-color build above (CBZ.applyClothes also restores it fully).
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

  /* ---- the layered animation update ----
     speed: current planar speed (units/s). dt: seconds. */
  function animChar(ch, speed, dt) {
    const moving = speed > 0.2;
    const walkRef = (CBZ.TUNE && CBZ.TUNE.walkSpeed) || 6.4;
    const norm = Math.min(speed / walkRef, 1);    // 0..1 walk→run, scaled to player walk speed
    ch.breath += dt;

    // ---- SEATED (office-jobs): a worker who reached their desk sits the shift.
    // city/officejobs.js + peds.js set ch.sitting once the ped snaps to a desk
    // anchor; this is a full-rig pose that OWNS the body (like the legGone crawl)
    // so a sitting clerk doesn't keep walk-swimming their limbs. Drop the hips,
    // fold the thighs forward so the shins hang to the floor, sit the torso
    // upright with a slight working lean, rest the arms toward the desktop. Modeled
    // on the surrender DAMP skeleton below. Early-return so no gait layer fights it.
    // (Jail/survival never set ch.sitting → this is a no-op there, byte-identical.)
    if (ch.sitting) {
      const sr = 12;
      ch.body.position.y = damp(ch.body.position.y, -0.6, sr, dt);     // hips drop into the chair
      ch.body.rotation.x = damp(ch.body.rotation.x, 0.14, sr, dt);     // slight working lean
      ch.body.rotation.z = damp(ch.body.rotation.z, 0, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      if (ch.parts.ll) { ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -1.2, sr, dt); ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.06, sr, dt); ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, sr, dt); ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt); }
      if (ch.parts.rl) { ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -1.2, sr, dt); ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.06, sr, dt); ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, sr, dt); ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt); }
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.5, sr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.12, sr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt); ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.06, sr, dt); }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.5, sr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.12, sr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt); ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.06, sr, dt); }
      if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.04, sr, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt); }
      return;   // seated pose owns the whole rig
    }

    // gait advances with DISTANCE TRAVELLED, not a wall clock — one stride per
    // STRIDE_LEN metres covered, so the cadence is exactly tied to how far the
    // feet actually carry the body. WHY: the old `2.3 + speed*0.92` was a clock
    // — it kept ticking the legs over at full cadence even when the body crept
    // forward a few cm/s (a slow creep, a body being nudged, a near-planted
    // promoted ped), so the feet swung through a full step while the ground
    // barely moved under them → the filmed FOOT-SLIDE / leg-strobe. Pacing the
    // phase off `speed*dt/STRIDE_LEN` plants the feet: half the speed → half the
    // cadence → the stride still covers ~STRIDE_LEN of ground per swing, and a
    // body that isn't really translating doesn't pump its legs. A tiny idle
    // term keeps a stopped rig from freezing mid-stride one frame after it halts
    // (the leg/lift/bob layers below all gate on `moving`, so at a true standstill
    // this only feeds the gentle sway, never a slide). STRIDE_LEN≈1.15m reads as
    // a brisk, weighty walk; norm still LENGTHENS the stride (amplitude) at speed.
    const STRIDE_LEN = 1.15;
    ch.phase += dt * 0.9 + (speed * dt) / STRIDE_LEN;
    const swing = Math.sin(ch.phase) * (0.24 + 0.34 * norm);

    // ---- LEG WOUND / LIMP STATE (systems/wounds.js sets ch.legHurt on a leg
    //      hit; systems/gore.js sets ch.legGone when a leg is severed) --------
    // legHurt = { side:-1(left)|+1(right), sev:0..1, t:seconds }. A wounded leg
    // favours the good side: a stiff, shortened, dragging stride on the hurt
    // leg and a weight-bearing DIP toward it each time it plants; severity
    // scales the read and cuts move speed via ch.limpSpeedMul (movement code
    // reads it). A SEVERED leg can't bear weight at all → the rig can't walk.
    let lh = ch.legHurt;
    if (lh) {
      lh.t -= dt;
      // light wounds ease off over ~20s; heavy wounds persist until death/heal.
      if (lh.sev < 0.5) lh.sev = Math.max(0, lh.sev - dt * (0.5 / 20));
      if (lh.sev <= 0.001 || lh.t <= 0) { ch.legHurt = null; lh = null; }
    }
    // STALE-FLAG GUARD (intermittent "walk folds face-down ~90°" bug): gore.js
    // sets ch.legGone when a leg is SEVERED and HIDES that leg mesh; the crawl
    // branch below then folds the body to 0.95rad (a deliberate one-legged
    // collapse). gore.js clears the flag on a restore/recycle audit — but that
    // audit and the crowd pool's re-assign (crowd.js) run on DIFFERENT frames, so
    // a pooled rig can be promoted into a fresh walker with legGone still set for a
    // frame or few before the audit fires → the new ped walks folded face-down.
    // The leg mesh is the ground truth: a severed leg is invisible, a restored one
    // is visible. If legGone claims a leg is gone but its pivot is actually VISIBLE,
    // the flag is stale from a previous life — clear it so the rig walks upright.
    // (Jail/survival never sever legs, so legGone is always 0|undef there and this
    // guard is a no-op — byte-identical.)
    if (ch.legGone) {
      const gonePart = ch.legGone < 0 ? ch.parts.ll : ch.parts.rl;
      if (gonePart && gonePart.visible !== false) { ch.legGone = 0; }
    }
    const legGone = ch.legGone;                     // -1 left / +1 right / 0|undef
    const hurtSide = lh ? lh.side : 0;              // which leg is bad
    const sev = lh ? Math.min(1, lh.sev) : 0;
    ch.limpSpeedMul = legGone ? 0.0 : (1 - sev * 0.5);   // movement code may read this

    // ---- limbs: legs opposed, arms counter to legs ----
    const legRate = 16, armRate = 14;
    // per-leg swing: the hurt leg swings LESS (stiff, dragging), shifting the
    // labour to the good leg. The severed-leg case is handled by the collapse
    // branch below (no normal locomotion on a missing limb).
    const lSwing = moving ? swing * (hurtSide < 0 ? 1 - sev * 0.62 : 1) : 0;
    const rSwing = moving ? -swing * (hurtSide > 0 ? 1 - sev * 0.62 : 1) : 0;
    // a hurt leg also holds a small constant stiff-knee bend it never straightens
    const lBend = hurtSide < 0 ? sev * 0.22 : 0;
    const rBend = hurtSide > 0 ? sev * 0.22 : 0;
    ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, lSwing - lBend, legRate, dt);
    ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, rSwing - rBend, legRate, dt);
    // CROSS-LEG GUARD: legs are only ever swung on rotation.x — z/y belong to
    // pose layers (deathPose splay, reactions get-up). Pooled rigs get recycled
    // for fresh peds, so a corpse's stale splay can ride into a new walker
    // (user-filmed crossed/splayed legs). animChar only ever runs on a LIVE,
    // upright actor (peds.js skips dead/ragdolled/busy bodies), so damping the
    // leg z/y back to neutral here straightens the stride without ever fighting
    // an intentional pose — deathPose/ragdoll rigs never reach this code.
    ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0, 12, dt);
    ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, 0, 12, dt);
    ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, 12, dt);
    ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, 12, dt);

    // knee-bend / foot-lift: shorten the swing leg at mid-stride so the
    // foot picks up off the floor instead of sliding (fakes foot-plant).
    // The hurt leg lifts LESS (it drags); the good leg works as normal.
    const liftL = moving ? Math.max(0, Math.sin(ch.phase)) * (hurtSide < 0 ? 1 - sev * 0.7 : 1) : 0;
    const liftR = moving ? Math.max(0, -Math.sin(ch.phase)) * (hurtSide > 0 ? 1 - sev * 0.7 : 1) : 0;
    ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1 - liftL * 0.14, 16, dt);
    ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1 - liftR * 0.14, 16, dt);

    // arms: aiming a gun (3PS present-weapon) OWNS the arms; else cuffed pins
    // them behind the back; else counter-swing.
    if (ch.aimingPose) {
      // FORTNITE-STYLE PRESENT-WEAPON: raise the right (gun) arm forward to hold
      // the weapon out toward the crosshair, bring the left arm in as a support
      // grip on the handguard. animChar is the SINGLE owner of the arms while
      // aiming (fpsmode.js only RAISES ch.aimingPose + feeds aimLong/aimRecoil/
      // aimRecoilSide) — holding the pose here every frame means nothing fights
      // it back toward idle. The barrel PITCHES with the camera: looking up is
      // the NEGATIVE-pitch direction (camera.js), and a more-negative arm
      // rotation.x raises the arm higher, so adding cam.pitch points the muzzle
      // where the reticle is. Recoil adds a snappy upward/sideways kick.
      const longGun = !!ch.aimLong;
      const recoil = ch.aimRecoil || 0;
      const recoilSide = ch.aimRecoilSide || 0;
      const pitch = (CBZ.cam && typeof CBZ.cam.pitch === "number") ? CBZ.cam.pitch : 0;
      const ar = 16;   // settle quickly so the present-weapon pose reads snappy
      // BASELINE -1.571 (-π/2) = arm HORIZONTAL-FORWARD. Paired with the carried
      // gun's new local orientation (rotation.x≈-1.571, no Math.PI) the muzzle
      // lies along the forearm and points dead level at cam.pitch≈0. SIGN: looking
      // UP is NEGATIVE cam.pitch (camera.js cam.pitch-=movementY) and a MORE-negative
      // arm rotation.x raises the muzzle, so we SUBTRACT pitch — look up → muzzle up,
      // look down → muzzle down (tracks the crosshair). Recoil kicks the muzzle up.
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -1.571 - pitch * 0.8 - recoil * 0.16, ar, dt);
      ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, -0.18 + recoilSide * 0.22, ar, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.34, ar, dt);
      ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.14, ar, dt);
      ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, (longGun ? -1.55 : -1.45) - pitch * 0.8, ar - 1, dt);
      ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, longGun ? 0.34 : 0.22, ar - 1, dt);
      ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, longGun ? 0.42 : 0.30, ar - 1, dt);
      ch.parts.la.position.z = damp(ch.parts.la.position.z, longGun ? 0.24 : 0.14, ar - 1, dt);
    } else if (ch.cuffed) {
      ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, 0.5, 10, dt);
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, 0.5, 10, dt);
      ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.5, 10, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, 0.5, 10, dt);
    } else {
      ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, moving ? -swing * 1.05 : 0, armRate, dt);
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, moving ? swing * 1.05 : 0, armRate, dt);
      ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.08, 6, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.08, 6, dt);
    }
    // The aim pose owns arm .y + .position.z (it sets non-zero targets above);
    // these recenter-to-zero defaults would otherwise fight it, so skip them
    // while aiming. cuffed/walk/idle all expect the recenter and keep it.
    if (!ch.aimingPose) {
      ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, 10, dt);
      ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, 10, dt);
      ch.parts.la.position.z = damp(ch.parts.la.position.z, 0, 12, dt);
      ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0, 12, dt);
    }

    // ---- body: bob (2× stride), side sway, forward lean ----
    const bobTarget = moving ? -Math.abs(Math.sin(ch.phase)) * (0.03 + 0.055 * norm) : 0;
    const idleBreath = moving ? 0 : Math.sin(ch.breath * 2.2) * 0.012;  // gentle breathing at rest
    ch.bob = damp(ch.bob, bobTarget, 12, dt);
    ch.body.position.y = ch.bob + idleBreath;

    const swayTarget = moving ? Math.sin(ch.phase) * (0.015 + 0.035 * norm) : 0;
    ch.sway = damp(ch.sway, swayTarget, 10, dt);
    ch.body.rotation.z = ch.sway;

    const leanTarget = norm * 0.12;               // lean into the run
    ch.lean = damp(ch.lean, leanTarget, 8, dt);
    ch.body.rotation.x = ch.lean;

    // ---- LIMP: the body dips toward the hurt leg as it bears weight ----
    // ll plants when sin(phase) < 0, rl plants when sin(phase) > 0 (legs are
    // opposed). On the planting beat of the BAD leg the torso drops + rolls
    // toward it — the favouring lurch that reads as a limp. Layered on top of
    // the sway/bob already written above (additive, so the gait keeps its base).
    if (sev > 0.02 && moving && !legGone) {
      const sp = Math.sin(ch.phase);
      const plant = hurtSide < 0 ? Math.max(0, -sp) : Math.max(0, sp);  // bad-leg weight phase
      ch.body.position.y -= plant * sev * 0.09;
      ch.body.rotation.z += hurtSide * plant * sev * 0.16;
    }

    // ---- LEG SEVERED: you can't stand on a leg that isn't there ----
    // gore.js sets ch.legGone (-1 left, +1 right) and HIDES that leg mesh. The
    // actor sinks into a low crawl/collapse: the body drops and rolls toward the
    // missing side, the stump leg tucks, the good leg pushes, the arms drag the
    // body forward. limpSpeedMul is already 0 so the movement code won't carry
    // them on a phantom limb; this is a late override so punch/surrender layers
    // below don't pull a one-legged rig back upright. (peds.js should knock a
    // severed-leg ped down — see report — but this keeps the rig honest until.)
    if (legGone) {
      const crawl = moving ? Math.sin(ch.phase) : 0;
      ch.body.position.y = damp(ch.body.position.y, -0.85, 8, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, 0.95, 8, dt);   // pitched face-down
      ch.body.rotation.z = damp(ch.body.rotation.z, legGone * 0.45, 8, dt);
      const goodLeg = legGone < 0 ? ch.parts.rl : ch.parts.ll;
      const stumpLeg = legGone < 0 ? ch.parts.ll : ch.parts.rl;
      if (goodLeg) { goodLeg.rotation.x = damp(goodLeg.rotation.x, -0.5 + crawl * 0.5, 10, dt); goodLeg.scale.y = damp(goodLeg.scale.y, 1, 10, dt); }
      if (stumpLeg) stumpLeg.rotation.x = damp(stumpLeg.rotation.x, -0.2, 10, dt);
      // arms reach and pull along the ground
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -1.5 + crawl * 0.6, 10, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.2, 10, dt); }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -1.5 - crawl * 0.6, 10, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.2, 10, dt); }
      if (ch.neck) ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.5, 9, dt);
      return;   // a one-legged crawl owns the whole rig
    }

    // ---- punch: anticipation -> shoulder turn -> drive -> recovery.
    if (ch.punchT > 0) {
      ch.punchT -= dt;
      const dur = ch.punchDur || 0.28;
      const prog = 1 - Math.max(0, ch.punchT) / dur;    // 0..1 over the punch
      const wind = Math.max(0, 1 - prog / 0.24);
      const drive = Math.sin(Math.min(1, Math.max(0, (prog - 0.16) / 0.54)) * Math.PI);
      const recover = Math.max(0, (prog - 0.62) / 0.38);
      const left = ch.punchArm === "l";
      const arm = left ? ch.parts.la : ch.parts.ra;
      const guard = left ? ch.parts.ra : ch.parts.la;
      const sgn = left ? 1 : -1;
      if (ch.punchKind === "upper") {                   // rising uppercut
        arm.rotation.x = 0.78 - 3.25 * drive;
        arm.rotation.y = sgn * 0.22 * drive;
        arm.rotation.z = sgn * (0.22 + 0.16 * drive);
        arm.position.z = 0.08 + 0.22 * drive;
        guard.rotation.x = -0.62 * drive;
        guard.rotation.z = -sgn * 0.30;
        ch.body.rotation.x = ch.lean - 0.34 * drive + 0.16 * wind;
        ch.body.rotation.y = sgn * (0.24 * wind + 0.68 * drive - 0.16 * recover);
      } else if (ch.punchKind === "hook") {             // horizontal rounded hook
        // the fist travels a lateral arc: rotation.y sweeps the arm from just
        // outside the shoulder (sgn*0.2) around across the body (sgn*-1.1)
        // while rotation.x lifts it to chin height; the torso whips harder
        // than a jab — the hook's power is the shoulder turn.
        const swp = Math.min(1, prog / 0.7);            // arc position over the swing
        arm.rotation.x = 0.3 * wind - 1.3 * drive + 0.18 * recover;
        arm.rotation.y = sgn * (0.2 - 1.3 * swp) * drive;   // 0.2 -> -1.1 around the side
        arm.rotation.z = sgn * (0.3 + 0.34 * drive);        // elbow up and out
        arm.position.z = 0.02 * wind + 0.2 * drive;
        guard.rotation.x = -0.72 * drive;
        guard.rotation.z = -sgn * 0.3;
        ch.body.rotation.x = ch.lean - 0.1 * drive + 0.06 * wind;
        ch.body.rotation.y = sgn * (0.3 * wind + 0.95 * drive - 0.22 * recover);
      } else {                                          // straight jab/cross
        arm.rotation.x = 0.45 * wind - 2.42 * drive + 0.24 * recover;
        arm.rotation.y = sgn * -0.18 * drive;
        arm.rotation.z = sgn * (0.12 + 0.18 * drive);
        arm.position.z = -0.06 * wind + 0.30 * drive;
        guard.rotation.x = -0.78 * drive;
        guard.rotation.z = -sgn * 0.28;
        ch.body.rotation.x = ch.lean - 0.13 * drive + 0.08 * wind;
        ch.body.rotation.y = sgn * (0.22 * wind + 0.58 * drive - 0.18 * recover);
      }
    } else {
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, 10, dt);
    }

    // ==== FIGHT LAYERS (all additive, all flag-gated: when the fight director
    // sets none of these, every block below is a single falsy check and the
    // frame is byte-identical to before). They run AFTER the punch block so a
    // director can layer/override mid-exchange; they SET pose values directly
    // (like the punch block) so the gait/idle damps above restore everything
    // automatically the frame after a flag clears. ====

    // ---- FIGHT STANCE idle: bladed, hands-up, ready. Only when not mid-move,
    // so any actual strike/reaction below (or the punch above) wins outright.
    if (ch.fightStance && !(ch.punchT > 0) && !(ch.kickT > 0) && !(ch.blockT > 0) &&
        !(ch.dodgeT > 0) && !(ch.staggerT > 0) && !(ch.koT > 0) && !ch.koPose &&
        !ch.aimingPose && !ch.cuffed && !ch.surrender && !ch.handsUp) {
      ch.fightPh = (ch.fightPh || 0) + dt;              // own phase: weave, don't walk
      const w = Math.sin(ch.fightPh * 2.6);             // slow weave
      const w2 = Math.sin(ch.fightPh * 5.2 + 1.3);      // faster forearm pump
      // forearms up near the chin, tucked slightly inward, a touch forward
      ch.parts.la.rotation.x = -0.9 + w2 * 0.05;
      ch.parts.la.rotation.z = -0.26;
      ch.parts.la.rotation.y = 0.1;
      ch.parts.la.position.z = 0.1;
      ch.parts.ra.rotation.x = -0.98 - w2 * 0.05;
      ch.parts.ra.rotation.z = 0.26;
      ch.parts.ra.rotation.y = -0.1;
      ch.parts.ra.position.z = 0.1;
      // bladed torso + subtle rhythmic weave; soft knees when standing still
      ch.body.rotation.y = -0.18 + w * 0.1;
      ch.body.rotation.x = ch.lean + 0.08;
      ch.body.rotation.z = ch.sway + w * 0.04;
      if (!moving) {
        ch.body.position.y -= 0.05 + w * 0.02;          // sit into the stance, bob
        ch.parts.ll.scale.y = 0.96;
        ch.parts.rl.scale.y = 0.96;
      }
    }

    // ---- KICK: chamber -> extend -> recover, same envelope family as the
    // punch. kickKind "front" (default) snaps the foot straight out with the
    // torso leaning back; "round" whips the leg around the side off a hip turn.
    if (ch.kickT > 0) {
      ch.kickT -= dt;
      const kdur = ch.kickDur || 0.5;
      const kprog = 1 - Math.max(0, ch.kickT) / kdur;
      const kwind = Math.max(0, 1 - kprog / 0.24);
      const kdrive = Math.sin(Math.min(1, Math.max(0, (kprog - 0.16) / 0.54)) * Math.PI);
      const krec = Math.max(0, (kprog - 0.62) / 0.38);
      const kleft = ch.kickLeg === "l";
      const kleg = kleft ? ch.parts.ll : ch.parts.rl;
      const kplant = kleft ? ch.parts.rl : ch.parts.ll;
      const ksgn = kleft ? 1 : -1;
      if (ch.kickKind === "round") {                    // roundhouse off the hip
        const kswp = Math.min(1, kprog / 0.7);
        kleg.rotation.x = 0.28 * kwind - 1.3 * kdrive;
        kleg.rotation.y = ksgn * (0.3 - 1.35 * kswp) * kdrive;   // sweeps around the side
        kleg.rotation.z = ksgn * (0.5 * kdrive + 0.15 * kwind);  // splayed out through the arc
        kleg.scale.y = 1 - 0.1 * kwind;                          // slight chamber shortening
        ch.body.rotation.y = ksgn * (0.3 * kwind + 1.0 * kdrive - 0.3 * krec);  // big hip turn
        ch.body.rotation.x = ch.lean - 0.18 * kdrive;
        ch.body.rotation.z = -ksgn * 0.14 * kdrive;              // counter-tilt over the plant leg
      } else {                                          // front snap kick
        kleg.rotation.x = 0.35 * kwind - 1.75 * kdrive + 0.2 * krec;  // cock back, drive up
        kleg.rotation.y = 0;
        kleg.rotation.z = ksgn * 0.06;
        kleg.scale.y = 1 - 0.2 * kwind - 0.06 * (1 - kdrive);    // knee chamber, straight at impact
        ch.body.rotation.x = ch.lean - 0.3 * kdrive + 0.08 * kwind;  // torso leans back
        ch.body.rotation.y = ksgn * 0.16 * kdrive;
      }
      // plant the standing leg: braced, soft knee, no swing
      kplant.rotation.x = 0.14 * kdrive;
      kplant.rotation.y = 0;
      kplant.scale.y = 1 - 0.05 * kdrive;
      // arms counter-balance out and back
      ch.parts.la.rotation.x = -0.4 * kdrive - 0.1 * kwind;
      ch.parts.ra.rotation.x = -0.4 * kdrive - 0.1 * kwind;
      ch.parts.la.rotation.z = 0.55 * kdrive + 0.08;
      ch.parts.ra.rotation.z = -0.55 * kdrive - 0.08;
      ch.body.position.y -= 0.05 * kdrive;              // sink into the plant leg
    }

    // ---- BLOCK / GUARD: both forearms up in front of the face, torso hunched.
    // Onset eases in via a small accumulator (reset when the timer runs out);
    // release is free — the gait damps above pull everything home next frame.
    if (ch.blockT > 0) {
      ch.blockT -= dt;
      ch.blockK = Math.min(1, (ch.blockK || 0) + dt * 12);   // quick raise
      const bk = ch.blockK;
      // optional impact jitter: director sets ch.blockHitT (~0.15) on a blocked hit
      let bjit = 0;
      if (ch.blockHitT > 0) {
        ch.blockHitT -= dt;
        bjit = Math.sin(ch.blockHitT * 55) * Math.max(0, ch.blockHitT) * 0.8;
      }
      ch.parts.la.rotation.x = (-1.5 + bjit * 0.12) * bk;
      ch.parts.la.rotation.z = -0.35 * bk;              // tuck inward
      ch.parts.la.rotation.y = 0.12 * bk;
      ch.parts.la.position.z = 0.12 * bk;
      ch.parts.ra.rotation.x = (-1.5 - bjit * 0.12) * bk;
      ch.parts.ra.rotation.z = 0.35 * bk;
      ch.parts.ra.rotation.y = -0.12 * bk;
      ch.parts.ra.position.z = 0.12 * bk;
      ch.body.rotation.x = ch.lean + (0.16 + bjit * 0.05) * bk;   // hunch behind the guard
      ch.body.position.y -= 0.04 * bk;
      if (ch.blockT <= 0) ch.blockK = 0;                // clean slate for the next guard
    }

    // ---- DODGE / SLIP: a quick weave to dodgeDir (-1 left, +1 right) that
    // peaks mid-timer and eases back out by itself (sin envelope -> 0 at end).
    if (ch.dodgeT > 0) {
      ch.dodgeT -= dt;
      const ddur = ch.dodgeDur || 0.35;
      const dprog = 1 - Math.max(0, ch.dodgeT) / ddur;
      const denv = Math.sin(Math.min(1, dprog) * Math.PI);   // out and back
      const ddir = ch.dodgeDir || 1;
      ch.body.rotation.z = ch.sway + ddir * 0.42 * denv;     // whole-torso lean
      ch.body.rotation.y = ddir * 0.28 * denv;               // shoulders slip with it
      ch.body.position.y -= 0.16 * denv;                     // bob down under the shot
      ch.parts.ll.scale.y = 1 - 0.08 * denv;                 // knees give a touch
      ch.parts.rl.scale.y = 1 - 0.08 * denv;
      // keep the hands home while slipping
      ch.parts.la.rotation.x = -0.8 * denv + ch.parts.la.rotation.x * (1 - denv);
      ch.parts.ra.rotation.x = -0.8 * denv + ch.parts.ra.rotation.x * (1 - denv);
    }

    // ---- STAGGER: took a hit — snap back hard, wobble out over the timer.
    if (ch.staggerT > 0) {
      ch.staggerT -= dt;
      const sdur = ch.staggerDur || 0.55;
      const sk = Math.max(0, ch.staggerT) / sdur;             // 1 at impact -> 0
      const swob = Math.sin((1 - sk) * 18) * sk;              // damping head/torso wobble
      ch.body.rotation.x = ch.lean - (0.48 * sk * sk + 0.1 * swob);   // lean-back snap
      ch.body.rotation.y = swob * 0.22;
      ch.body.rotation.z = ch.sway + swob * 0.14;
      ch.body.position.y -= 0.07 * sk;                        // knees buckle a touch
      ch.body.position.z = -0.14 * sk;                        // small backward recoil
      // arms fling out loose
      ch.parts.la.rotation.x = -0.6 * sk;
      ch.parts.ra.rotation.x = -0.65 * sk;
      ch.parts.la.rotation.z = 0.55 * sk + 0.08;
      ch.parts.ra.rotation.z = -0.6 * sk - 0.08;
      if (ch.staggerT <= 0) ch.body.position.z = 0;           // no residual recoil offset
    }

    // Hands-up surrender/intimidation pose. This is a late animation layer so
    // gunpoint victims do not keep idle-swimming their arms while frozen.
    if (ch.surrender || ch.handsUp) {
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -2.5, 18, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0.16, 14, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.62, 14, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.22, 14, dt);
      }
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -2.5, 18, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, -0.16, 14, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, 0.62, 14, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.22, 14, dt);
      }
      ch.body.rotation.x = damp(ch.body.rotation.x, -0.07, 10, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, 12, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, 0, 12, dt);
    }

    // ---- head: subtle counter-bob + breathing tilt, keeps eyes level ----
    if (ch.neck) {
      ch.neck.rotation.x = damp(ch.neck.rotation.x, -ch.lean * 0.7 + (moving ? Math.sin(ch.phase * 2) * 0.02 : 0), 9, dt);
      ch.neck.rotation.z = damp(ch.neck.rotation.z, -ch.sway * 0.6, 9, dt);
    }

    // ---- KO / KNOCKDOWN: crumple to the canvas. LAST layer on purpose — it
    // blends every pose channel (including the head layer just above) toward
    // the downed shape, so nothing pulls a KO'd fighter back upright. koT
    // animates the fall over koDur; ch.koPose=true holds the downed pose after
    // (or indefinitely, without koT at all). Clearing both restores upright:
    // the gate below hands the rig straight back to the gait/idle writes above,
    // and the delta-tracked group drop is refunded exactly once.
    if (ch.koT > 0 || ch.koPose) {
      if (ch.koT > 0) ch.koT -= dt;
      const kodur = ch.koDur || 0.7;
      const kraw = ch.koT > 0 ? 1 - Math.max(0, ch.koT) / kodur : 1;
      ch.koK = Math.max(ch.koK || 0, Math.min(1, kraw));      // never un-fall mid-hold
      const e = ch.koK * ch.koK * (3 - 2 * ch.koK);           // smoothstep crumple
      const inv = 1 - e;
      // torso pitches back and down onto the canvas, a slight roll so it
      // reads as a body, not a plank
      ch.body.rotation.x = ch.body.rotation.x * inv - 1.25 * e;
      ch.body.rotation.y = ch.body.rotation.y * inv;
      ch.body.rotation.z = ch.body.rotation.z * inv + 0.12 * e;
      ch.body.position.y = ch.body.position.y * inv - 0.62 * e;
      // legs fold — one knee drawn up, the other flopped, both shortened so
      // the feet come off their standing plant
      ch.parts.ll.rotation.x = ch.parts.ll.rotation.x * inv - 0.6 * e;
      ch.parts.ll.rotation.z = ch.parts.ll.rotation.z * inv + 0.28 * e;
      ch.parts.ll.scale.y = ch.parts.ll.scale.y * inv + 0.78 * e;
      ch.parts.rl.rotation.x = ch.parts.rl.rotation.x * inv - 0.25 * e;
      ch.parts.rl.rotation.z = ch.parts.rl.rotation.z * inv - 0.34 * e;
      ch.parts.rl.scale.y = ch.parts.rl.scale.y * inv + 0.9 * e;
      // arms splayed loose, palms-up-ish — not a T-pose
      ch.parts.la.rotation.x = ch.parts.la.rotation.x * inv - 0.55 * e;
      ch.parts.la.rotation.z = ch.parts.la.rotation.z * inv + 0.95 * e;
      ch.parts.la.rotation.y = ch.parts.la.rotation.y * inv;
      ch.parts.la.position.z = ch.parts.la.position.z * inv;
      ch.parts.ra.rotation.x = ch.parts.ra.rotation.x * inv - 0.3 * e;
      ch.parts.ra.rotation.z = ch.parts.ra.rotation.z * inv - 1.05 * e;
      ch.parts.ra.rotation.y = ch.parts.ra.rotation.y * inv;
      ch.parts.ra.position.z = ch.parts.ra.position.z * inv;
      if (ch.neck) {
        ch.neck.rotation.x = ch.neck.rotation.x * inv - 0.35 * e;   // head lolled back
        ch.neck.rotation.z = ch.neck.rotation.z * inv + 0.22 * e;
      }
      // sink the whole rig toward the floor. Delta-tracked (koLift remembers
      // what we've added) so the offset never compounds frame-over-frame and
      // is refunded exactly when the KO clears.
      const lift = -0.5 * e;
      ch.group.position.y += lift - (ch.koLift || 0);
      ch.koLift = lift;
    } else if (ch.koLift) {
      ch.group.position.y -= ch.koLift;                       // refund the sink
      ch.koLift = 0;
      ch.koK = 0;
    }
  }

  // ---- dramatic death sprawl: splay the rig into a limp, broken-looking
  //      heap. Deterministic per `seed` so each corpse lands differently.
  //      The GROUP rotation (which way they topple) is owned by the caller
  //      (body physics); this only poses the limbs/torso/head.
  //
  //      VARIETY (research: real corpses don't all land in one canned splay):
  //      the seed picks one of three resting templates — a face-up sprawl
  //      (arms loose, head lolled), a face-down crumple (arms tucked/forward,
  //      head turned), or an on-the-side fold (knees drawn, arms across) — so
  //      a mowed-down crowd reads as a heap of distinct bodies, and the pose
  //      matches the way they fell. `fall` (optional, 0..1 → face-up..face-down
  //      bias from the caller's topple direction) nudges the template choice
  //      without breaking the seed-only callers (grapple/net/physics). ----
  function deathPose(ch, seed, fall) {
    if (!ch || !ch.parts) return;
    ch.sitting = false;                 // a corpse is never "at its desk" — clear the seated pose
    const s = seed || 0;
    const p = ch.parts;
    const j = (k) => Math.sin(s * k);   // cheap per-corpse jitter in [-1,1]
    // template: 0 face-up, 1 face-down, 2 on-side. seed spreads them; an
    // explicit `fall` bias (forward topple → face-down) tips the choice.
    let pick = Math.abs(j(5.1));        // 0..1
    if (fall != null) pick = pick * 0.5 + fall * 0.5;
    const tmpl = pick < 0.4 ? 0 : (pick < 0.75 ? 1 : 2);
    if (tmpl === 1) {
      // FACE-DOWN crumple: arms forward/under, legs trailing, head turned aside
      if (p.la) { p.la.rotation.set(-1.5 + j(1.7) * 0.4, 0.2, 0.4 + j(2.1) * 0.2); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-1.3 + j(2.9) * 0.4, -0.2, -0.5 - j(1.3) * 0.2); p.ra.position.z = 0; }
      if (p.ll) { p.ll.rotation.set(-0.15 + j(3.3) * 0.15, 0, 0.2 + j(1.1) * 0.15); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(0.1 + j(2.3) * 0.15, 0, -0.25 - j(2.7) * 0.15); p.rl.scale.y = 1; }
      if (ch.body) { ch.body.rotation.set(0.1 * j(1.9), 0, 0.08 * j(2.5)); ch.body.position.y = 0; }
      if (ch.neck) ch.neck.rotation.set(-0.4, 0.7 * (j(1.5) >= 0 ? 1 : -1), 0.25 * j(2.2));
    } else if (tmpl === 2) {
      // ON-THE-SIDE fold: knees drawn up, top arm flung across, lower arm under
      const side = j(4.3) >= 0 ? 1 : -1;
      if (p.la) { p.la.rotation.set(-0.6 + j(1.7) * 0.4, 0.25, (0.9 + j(2.1) * 0.2) * (side > 0 ? 1 : 0.4)); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-0.5 + j(2.9) * 0.4, -0.25, (-0.95 - j(1.3) * 0.2) * (side < 0 ? 1 : 0.4)); p.ra.position.z = 0; }
      if (p.ll) { p.ll.rotation.set(0.6 + j(3.3) * 0.25, 0, 0.35 + j(1.1) * 0.2); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(0.5 + j(2.3) * 0.25, 0, -0.3 - j(2.7) * 0.2); p.rl.scale.y = 1; }
      if (ch.body) { ch.body.rotation.set(0.18 * j(1.9), 0, side * 0.14); ch.body.position.y = 0; }
      if (ch.neck) ch.neck.rotation.set(-0.45, side * 0.55, side * 0.3);
    } else {
      // FACE-UP sprawl (the original): arms flung out/overhead, legs splayed,
      // head lolled to one side, slightly asymmetric per seed.
      if (p.la) { p.la.rotation.set(-0.9 + j(1.7) * 0.5, 0.25, 1.15 + j(2.1) * 0.25); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-0.7 + j(2.9) * 0.5, -0.25, -1.2 - j(1.3) * 0.25); p.ra.position.z = 0; }
      if (p.ll) { p.ll.rotation.set(0.25 + j(3.3) * 0.2, 0, 0.4 + j(1.1) * 0.2); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(-0.2 + j(2.3) * 0.2, 0, -0.45 - j(2.7) * 0.2); p.rl.scale.y = 1; }
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
