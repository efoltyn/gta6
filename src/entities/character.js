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
      const cap = new THREE.Mesh(boxGeom(w * 1.04, capH || 0.22, d * 1.18), cmat(capColor));
      cap.position.y = -h + (capH || 0.22) / 2;
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

    return {
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

    // gait advances with stride length; faster = quicker cadence.
    // Tuned so a normal walk reads as a brisk, weighty stride rather
    // than a frantic sprint, and the stride lengthens (not just speeds
    // up) as you move faster.
    ch.phase += dt * (2.3 + speed * 0.92);
    const swing = Math.sin(ch.phase) * (0.24 + 0.34 * norm);

    // ---- limbs: legs opposed, arms counter to legs ----
    const legRate = 16, armRate = 14;
    ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, moving ? swing : 0, legRate, dt);
    ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, moving ? -swing : 0, legRate, dt);

    // knee-bend / foot-lift: shorten the swing leg at mid-stride so the
    // foot picks up off the floor instead of sliding (fakes foot-plant).
    const liftL = moving ? Math.max(0, Math.sin(ch.phase)) : 0;
    const liftR = moving ? Math.max(0, -Math.sin(ch.phase)) : 0;
    ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1 - liftL * 0.14, 16, dt);
    ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1 - liftR * 0.14, 16, dt);

    // arms: cuffed (escort) pins them behind the back; else counter-swing
    if (ch.cuffed) {
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
    ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, 10, dt);
    ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, 10, dt);
    ch.parts.la.position.z = damp(ch.parts.la.position.z, 0, 12, dt);
    ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0, 12, dt);

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
  }

  // ---- dramatic death sprawl: splay the rig into a limp, broken-looking
  //      heap. Deterministic per `seed` so each corpse lands differently.
  //      The GROUP rotation (which way they topple) is owned by the caller
  //      (body physics); this only poses the limbs/torso/head. ----
  function deathPose(ch, seed) {
    if (!ch || !ch.parts) return;
    const s = seed || 0;
    const p = ch.parts;
    const j = (k) => Math.sin(s * k);   // cheap per-corpse jitter in [-1,1]
    // arms flung out and overhead, slightly asymmetric
    if (p.la) { p.la.rotation.set(-0.9 + j(1.7) * 0.5, 0.25, 1.15 + j(2.1) * 0.25); p.la.position.z = 0; }
    if (p.ra) { p.ra.rotation.set(-0.7 + j(2.9) * 0.5, -0.25, -1.2 - j(1.3) * 0.25); p.ra.position.z = 0; }
    // legs splayed at the hips, one more bent than the other
    if (p.ll) { p.ll.rotation.set(0.25 + j(3.3) * 0.2, 0, 0.4 + j(1.1) * 0.2); p.ll.scale.y = 1; }
    if (p.rl) { p.rl.rotation.set(-0.2 + j(2.3) * 0.2, 0, -0.45 - j(2.7) * 0.2); p.rl.scale.y = 1; }
    // torso limp, head lolled to one side
    if (ch.body) { ch.body.rotation.set(0.12 * j(1.9), 0, 0.1 * j(2.5)); ch.body.position.y = 0; }
    if (ch.neck) ch.neck.rotation.set(-0.55, 0.5 * j(1.5), 0.3 * j(2.2));
  }

  CBZ.makeCharacter = makeCharacter;
  CBZ.animChar = animChar;
  CBZ.deathPose = deathPose;
  CBZ.lerpAngle = lerpAngle;
  CBZ.damp = damp;
})();
