/* ============================================================
   systems/gunhands.js — THE OFF HAND ACTUALLY HOLDS THE GUN,
                         AND IT ACTUALLY RELOADS IT.

   OWNER, two bugs in one sentence: "I want animation in player for reloading
   gun, and I want to improve how they hold gun — right now it looks like the
   non-trigger hand is holding ABOVE the gun, not holding it."

   ---- WHY THE SUPPORT HAND MISSED --------------------------------------
   The drawn weapon is parented to the RIGHT hand socket and then has its
   world orientation overwritten every frame (systems/holsterprops.js locks
   the barrel to the crosshair). So the gun's real position and angle are the
   product of: body yaw damp → shoulder → elbow → wrist socket → aim lock →
   the ground-rest lift → this gun's own length and scale.

   The LEFT arm, meanwhile, was a table of hand-tuned Euler constants
   (entities/character.js, the `aimingPose` and `carryPose` branches). Those
   constants are a GUESS at where that chain ends up, and the guess has to be
   wrong, because it cannot depend on the two things that actually move the
   answer: which gun is drawn (a 1.3 m M249 handguard is nowhere near a
   pistol's), and where the aim lock just pointed it. Every previous fix
   re-tuned the guess for one more weapon — the git log has three rounds of
   exactly that, each ending "screenshot-diagnosed".

   So this module stops guessing. Each weapon publishes where its handguard
   IS (userData.grips.support, weapons/appearances/*.js), and the arm is
   SOLVED to that point with entities/character.js's exact two-bone IK. The
   hand lands on the gun for every weapon, every stance and every aim angle,
   including guns added tomorrow, because nothing here knows a weapon's name.

   ---- AND THE RELOAD ----------------------------------------------------
   There was no reload animation at all: `fps.reloading` counted down, the HUD
   drew a "↻", the first-person viewmodel dipped, and in third person the
   player stood still holding a gun that silently refilled itself.

   A reload is the off hand's job, and the off hand is now solvable — so it is
   choreographed as a path THROUGH the same anchors: handguard → magwell →
   belt → magwell → charging handle → handguard, with the real magazine
   falling out of the gun on the way and a fresh one carried up in the fist.
   Five styles, picked from the weapon's own `grips.style`, because a belt-fed
   M249, a pump shotgun, a revolver and an RPG are not reloaded alike.

   Everything is driven off fps.reloading, which fpsmode.js already owns — no
   second timer, so the animation cannot desync from the ammo count.

   Flags (one-line reverts):
     CHAR_SUPPORT_HAND_IK  false → the old hand-tuned support-arm constants.
     CHAR_RELOAD_ANIM      false → reload is invisible again, hold IK stays.
     CHAR_SHOULDER_LONGGUN false → long guns go back to arm's length (and
                                   their handguards back out of reach).
     NPC_SUPPORT_HAND_IK   false → player only; the street keeps the old pose.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (!CBZ.onAlways) return;
  if (CBZ.CONFIG.CHAR_SUPPORT_HAND_IK == null) CBZ.CONFIG.CHAR_SUPPORT_HAND_IK = true;
  if (CBZ.CONFIG.CHAR_RELOAD_ANIM == null) CBZ.CONFIG.CHAR_RELOAD_ANIM = true;
  if (CBZ.CONFIG.CHAR_SHOULDER_LONGGUN == null) CBZ.CONFIG.CHAR_SHOULDER_LONGGUN = true;

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (u) => u * u * (3 - 2 * u);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3();
  const _tmp = new THREE.Vector3(), _bodyQ = new THREE.Quaternion();

  /* ---- WHERE A WEAPON'S HANDS GO ----------------------------------------
     Authored per weapon in weapons/appearances/*.js. The one prop that can
     reach here without them is actorweapons.js's `fallbackWeapon` — an
     unknown id — so that shape's own handguard is the default rather than a
     null that would silently turn the whole layer off. Cached on the prop. */
  const FALLBACK_GRIPS = {
    support: new THREE.Vector3(0, -0.030, -0.450),
    mag: new THREE.Vector3(0, -0.170, -0.050),
    charge: null,
    style: "mag",
    authored: false,
  };
  function gripsOf(prop) {
    const ud = prop.userData;
    if (ud._gripCache) return ud._gripCache;
    const g = ud.grips;
    const out = g ? {
      support: g.support || null,
      mag: g.mag || g.support || null,
      charge: g.charge || null,
      style: g.style || "mag",
      authored: true,
    } : FALLBACK_GRIPS;
    ud._gripCache = out;
    return out;
  }

  /* ---- THE CHOREOGRAPHY -------------------------------------------------
     Each row is [pStart, pEnd, fromAnchor, toAnchor, arc]. Anchors are
     resolved live: "support"/"mag"/"charge" are points ON THE GUN (so they
     travel with it while the player keeps moving and aiming), "pouch" is a
     point on the BODY. `arc` bows the path outward so a hand going to the
     belt swings clear of the ribs instead of through them. from === to is a
     dwell — the beat where the thing actually happens.

     p runs 0..1 across ONE reload step. The shotgun re-arms its timer per
     shell, so its whole table runs again for each shell it feeds. */
  const CHOREO = {
    // box mag: rifles, SMGs, pistols, the bolt gun
    mag: [
      [0.00, 0.15, "support", "mag", 0.05],
      [0.15, 0.24, "mag", "mag", 0],                 // thumb the catch — mag falls
      [0.24, 0.45, "mag", "pouch", 0.14],
      [0.45, 0.56, "pouch", "pouch", 0],             // pull a fresh one
      [0.56, 0.79, "pouch", "mag", 0.12],
      [0.79, 0.87, "mag", "mag", 0],                 // seat it, slap the base
      [0.87, 0.94, "mag", "charge", 0.06],
      [0.94, 1.00, "charge", "support", 0.04],
    ],
    // one shell at a time through the loading port; the pump racks at the end
    shell: [
      [0.00, 0.30, "support", "pouch", 0.10],
      [0.30, 0.44, "pouch", "pouch", 0],
      [0.44, 0.74, "pouch", "mag", 0.09],
      [0.74, 0.86, "mag", "mag", 0],
      [0.86, 1.00, "mag", "support", 0.05],
    ],
    // swing the cylinder/drum out, dump the brass, speedloader in
    cylinder: [
      [0.00, 0.16, "support", "mag", 0.05],
      [0.16, 0.30, "mag", "mag", 0],                 // out and eject
      [0.30, 0.48, "mag", "pouch", 0.13],
      [0.48, 0.60, "pouch", "pouch", 0],
      [0.60, 0.82, "pouch", "mag", 0.11],
      [0.82, 0.92, "mag", "mag", 0],                 // snap it closed
      [0.92, 1.00, "mag", "support", 0.04],
    ],
    // belt-fed: cover up, box off, box on, belt laid in, cover down
    belt: [
      [0.00, 0.12, "support", "charge", 0.04],
      [0.12, 0.22, "charge", "charge", 0],           // feed cover open
      [0.22, 0.34, "charge", "mag", 0.05],
      [0.34, 0.44, "mag", "mag", 0],                 // empty box off
      [0.44, 0.60, "mag", "pouch", 0.15],
      [0.60, 0.70, "pouch", "pouch", 0],
      [0.70, 0.84, "pouch", "mag", 0.13],
      [0.84, 0.92, "mag", "charge", 0.05],           // lay the belt in
      [0.92, 1.00, "charge", "support", 0.04],
    ],
    // a rocket goes in the FRONT of the tube — the longest reach in the game
    rocket: [
      [0.00, 0.28, "support", "pouch", 0.12],
      [0.28, 0.42, "pouch", "pouch", 0],
      [0.42, 0.76, "pouch", "mag", 0.16],
      [0.76, 0.88, "mag", "mag", 0],
      [0.88, 1.00, "mag", "support", 0.06],
    ],
  };
  // when the old magazine physically leaves the gun, per style (null = never)
  const EJECT_AT = { mag: 0.20, cylinder: 0.26, belt: 0.40, shell: null, rocket: null };
  // when a fresh one is in the fist: [grabbed, seated]
  const CARRY = {
    mag: [0.52, 0.84], cylinder: [0.56, 0.88], belt: [0.66, 0.88],
    shell: [0.38, 0.80], rocket: [0.36, 0.84],
  };

  /* ---- reload state, read straight off fpsmode's own timer -------------- */
  const R = {
    active: false, style: "mag", total: 1, last: 0, p: 0, w: 0,
    cant: 0, dip: 0, carry: 0, ejected: false, id: null, step: 0,
  };
  /* Published for systems/holsterprops.js, which owns the drawn gun's world
     orientation: a gun being reloaded is not a gun being aimed. */
  CBZ.gunReloadPose = function () {
    return R.active
      ? { active: true, p: R.p, weight: R.w, cant: R.cant, dip: R.dip, style: R.style }
      : { active: false, p: 0, weight: 0, cant: 0, dip: 0, style: null };
  };

  function reloadRow() {
    const fps = CBZ.fps;
    if (!fps || !CBZ.FPS_WEAPONS) return null;
    return CBZ.FPS_WEAPONS[fps.weapon] || null;
  }

  function reloadTick(dt) {
    stepDebris(dt || 0);          // the ejected mags keep falling after the reload ends
    const fps = CBZ.fps;
    const left = fps && fps.reloading > 0 ? fps.reloading : 0;
    if (!left || CBZ.CONFIG.CHAR_RELOAD_ANIM === false ||
        !CBZ.player || CBZ.player.dead) {
      R.active = false; R.w = 0; R.p = 0; R.cant = 0; R.dip = 0; R.carry = 0;
      R.last = 0;
      return;
    }
    // the STYLE is the drawn weapon's own, read before the envelope needs it
    const drawn = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    if (drawn) R.style = gripsOf(drawn).style || "mag";
    const row = reloadRow();
    // A NEW STEP is a timer that went UP: either the reload just started, or
    // the shotgun re-armed for the next shell. Either way the path restarts.
    if (!R.active || left > R.last + 1e-4) {
      R.total = Math.max(0.12, (row && row.reload) || left);
      R.ejected = false;
      R.step = R.active ? R.step + 1 : 0;
      if (!R.active) R.id = CBZ.currentWeaponId || null;
      R.active = true;
    }
    R.last = left;
    R.p = clamp01(1 - left / R.total);
    // ease the whole layer in and out so a reload never snaps on
    R.w = smooth(clamp01(Math.min(R.p / 0.12, (1 - R.p) / 0.12)));
    // The gun cants toward the body to present its own magwell — that roll is
    // most of what makes a reload READ from the chase camera, more than the
    // hand does. Cylinder guns cant hardest (you look into the chambers), a
    // belt gun barely at all (it is fed from the top and it is 7.5 kg).
    const rollK = R.style === "cylinder" ? 1.35 : R.style === "belt" ? 0.45
      : R.style === "rocket" ? 0.30 : 1;
    R.cant = 0.62 * rollK * R.w;
    R.dip = 0.30 * R.w;
    const car = CARRY[R.style] || CARRY.mag;
    R.carry = R.p > car[0] && R.p < car[1] ? 1 : 0;
  }

  /* ---- anchors ---------------------------------------------------------- */
  function torsoScale(ch) {
    const pf = ch.profile;
    return pf && pf.torsoH ? (pf.legUp + pf.legLo + pf.torsoH) / 1.90 : 1;
  }
  // Magazines ride the LEFT front hip; a rocket comes off the left shoulder.
  // (makeCharacter mirrors the arm roots, so the player's LEFT is body +X.)
  function pouchLocal(ch, style, out) {
    const s = torsoScale(ch);
    if (style === "rocket") return out.set(0.30 * s, 1.28 * s, -0.14 * s);
    if (style === "shell") return out.set(0.30 * s, 1.10 * s, 0.06 * s);
    return out.set(0.31 * s, 1.01 * s, 0.11 * s);
  }
  function anchorWorld(key, ch, prop, grips, out) {
    if (key === "pouch") {
      pouchLocal(ch, grips.style, out);
      return ch.body.localToWorld(out);
    }
    const v = grips[key] || grips.support;
    if (!v) return null;
    out.copy(v);
    return prop.localToWorld(out);
  }

  /* ---- the falling magazine --------------------------------------------
     A reload you can only see in the arms is half an animation; the piece
     that sells it is the empty mag hitting the pavement behind you. Pooled,
     six deep, physical enough to bounce once and lie down. */
  const debris = [];
  let debrisMat = null;
  function magMesh(style) {
    if (!debrisMat) {
      debrisMat = new THREE.MeshLambertMaterial({ color: 0x22262b });
      debrisMat._shared = true;
    }
    const d = style === "belt" ? [0.15, 0.20, 0.26] : style === "cylinder" ? [0.07, 0.05, 0.07]
      : [0.07, 0.21, 0.10];
    const m = new THREE.Mesh(new THREE.BoxGeometry(d[0], d[1], d[2]), debrisMat);
    m.castShadow = true;
    return m;
  }
  function dropMag(pos, style) {
    const root = CBZ.prisonRoot || CBZ.scene;
    if (!root) return;
    // Pool of six: reuse a spent record, else grow, else evict the oldest.
    // A field of magazines is set dressing, not a leak.
    let rec = null;
    for (let i = 0; i < debris.length; i++) if (debris[i].free) { rec = debris[i]; break; }
    if (!rec && debris.length < 6) {
      rec = { mesh: null, style: null, free: true, t: 0, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0, landed: false };
      debris.push(rec);
    }
    if (!rec) {
      rec = debris[0];
      for (let i = 1; i < debris.length; i++) if (debris[i].t > rec.t) rec = debris[i];
    }
    if (!rec.mesh || rec.style !== style) {
      if (rec.mesh) {
        if (rec.mesh.parent) rec.mesh.parent.remove(rec.mesh);
        rec.mesh.geometry.dispose();
      }
      rec.mesh = magMesh(style);
      rec.style = style;
    }
    const p = CBZ.player;
    rec.mesh.position.copy(pos);
    rec.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    rec.vx = (p && p.vx ? p.vx * 0.5 : 0) + (Math.random() - 0.5) * 0.5;
    rec.vz = (p && p.vz ? p.vz * 0.5 : 0) + (Math.random() - 0.5) * 0.5;
    rec.vy = -0.4;
    rec.sx = (Math.random() - 0.5) * 7; rec.sy = (Math.random() - 0.5) * 7; rec.sz = (Math.random() - 0.5) * 7;
    rec.t = 0; rec.free = false; rec.landed = false;
    rec.mesh.visible = true;
    if (rec.mesh.parent !== root) root.add(rec.mesh);
  }
  function stepDebris(dt) {
    for (let i = 0; i < debris.length; i++) {
      const r = debris[i];
      if (r.free) continue;
      r.t += dt;
      if (!r.landed) {
        r.vy -= 19 * dt;
        r.mesh.position.x += r.vx * dt;
        r.mesh.position.y += r.vy * dt;
        r.mesh.position.z += r.vz * dt;
        r.mesh.rotation.x += r.sx * dt; r.mesh.rotation.y += r.sy * dt; r.mesh.rotation.z += r.sz * dt;
        const fl = (CBZ.floorAt ? CBZ.floorAt(r.mesh.position.x, r.mesh.position.z) : 0) + 0.04;
        if (r.mesh.position.y <= fl && r.vy < 0) {
          if (r.vy < -2.2) {                       // one bounce, then it lies down
            r.mesh.position.y = fl; r.vy *= -0.28;
            r.vx *= 0.5; r.vz *= 0.5; r.sx *= 0.4; r.sy *= 0.4; r.sz *= 0.4;
          } else {
            r.mesh.position.y = fl; r.landed = true;
            r.mesh.rotation.set(0, r.mesh.rotation.y, Math.PI / 2 - 0.2);
            if (CBZ.sfx) CBZ.sfx("shell");
          }
        }
      }
      if (r.t > 14) {                              // fade the field out, never grow it
        r.free = true; r.mesh.visible = false;
        if (r.mesh.parent) r.mesh.parent.remove(r.mesh);
      }
    }
  }

  /* ---- the fresh magazine, carried in the fist -------------------------- */
  let carried = null, carriedStyle = null;
  function showCarried(ch, style, on) {
    if (!on) { if (carried) carried.visible = false; return; }
    const socket = ch.sockets && ch.sockets.leftHand;
    if (!socket) return;
    if (!carried || carriedStyle !== style) {
      if (carried && carried.parent) carried.parent.remove(carried);
      if (carried) carried.geometry.dispose();
      carried = magMesh(style);
      carriedStyle = style;
    }
    if (carried.parent !== socket) socket.add(carried);
    const s = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 1;
    carried.scale.setScalar(1 / (s || 1));
    carried.position.set(0, -0.10, 0.02);
    carried.rotation.set(0.4, 0, 0.15);
    carried.visible = true;
  }

  /* ---- the pass: put the off hand where the gun is ---------------------- */
  let blend = 0;
  const seen = { pass: 0, drive: 0, why: "never ran" };
  function poseHands(dt) {
    seen.pass++;
    const ch = CBZ.playerChar;
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    const own = !!(prop && ch && ch.parts && ch.parts.la && ch.body && ch.sockets &&
      CBZ.CONFIG.CHAR_SUPPORT_HAND_IK !== false && CBZ.charArmTo &&
      !ch.slidePose && !ch.cuffed && !ch.surrender && !ch.handsUp &&
      !(CBZ.player && CBZ.player.dead) &&
      !(CBZ.weaponTransferState && CBZ.weaponTransferState().active));
    // A one-handed weapon (the taser) publishes no support grip and keeps its
    // off arm free — that is a fact about the weapon, not a missing anchor.
    const grips = own ? gripsOf(prop) : null;
    if (!grips || !grips.support) {
      // Hand the arm back. Nothing to unwind: every channel this pass writes
      // is one that animChar damps home on its own the next frame — the same
      // contract entities/poses.js and the reach layer rely on.
      blend = 0;
      if (carried) carried.visible = false;
      seen.why = !prop ? "no drawn weapon"
        : !ch ? "no player rig"
        : ch.slidePose ? "slide pose owns the rig"
        : (ch.cuffed || ch.surrender || ch.handsUp) ? "hands are busy"
        : (CBZ.player && CBZ.player.dead) ? "dead"
        : (CBZ.weaponTransferState && CBZ.weaponTransferState().active) ? "stowing"
        : grips ? "one-handed weapon" : "no rig parts";
      return;
    }
    seen.drive++; seen.why = "";
    blend += (1 - blend) * Math.min(1, 9 * (dt || 0.016));

    R.style = grips.style || "mag";
    prop.updateWorldMatrix(true, false);
    ch.body.updateWorldMatrix(true, false);

    // ---- target: the handguard, or wherever the reload is up to ----------
    // A closure, because the shoulder solve below MOVES the gun and every one
    // of these anchors is measured off it: the target has to be re-derived
    // afterwards, not carried over from before the weapon moved.
    const reloadSeg = (R.active && R.w > 0)
      ? (function () {
          const table = CHOREO[R.style] || CHOREO.mag;
          for (let i = 0; i < table.length; i++) if (R.p <= table[i][1]) return table[i];
          return table[table.length - 1];
        })()
      : null;
    function computeTarget() {
      let t = anchorWorld("support", ch, prop, grips, _t);
      if (reloadSeg) {
        const span = Math.max(1e-4, reloadSeg[1] - reloadSeg[0]);
        const u = smooth(clamp01((R.p - reloadSeg[0]) / span));
        const from = anchorWorld(reloadSeg[2], ch, prop, grips, _a);
        const to = anchorWorld(reloadSeg[3], ch, prop, grips, _b);
        if (from && to) {
          _tmp.lerpVectors(from, to, u);
          // bow the path away from the ribs (body +X is the player's LEFT)
          const arc = reloadSeg[4] * Math.sin(Math.PI * u);
          if (arc > 0) {
            ch.body.getWorldQuaternion(_bodyQ);
            _tmp.add(_a.set(arc, -arc * 0.35, 0).applyQuaternion(_bodyQ));
          }
          t = _t.lerpVectors(t, _tmp, R.w);
        }
      }
      // A HAND MAY NOT GO THROUGH THE FLOOR. Prone puts the whole rig at
      // ankle height and the ground-rest pass then lifts the GUN, so a solve
      // that trusted the anchor blindly would drive the elbow into the road.
      if (CBZ.floorAt) {
        const fl = CBZ.floorAt(t.x, t.z) + 0.05;
        if (t.y < fl) t.y = fl;
      }
      return t;
    }
    let target = computeTarget();
    if (reloadSeg) {
      if (!R.ejected && EJECT_AT[R.style] != null && R.p >= EJECT_AT[R.style]) {
        R.ejected = true;
        const mp = anchorWorld("mag", ch, prop, grips, _a);
        if (mp) dropMag(mp, R.style);
        target = computeTarget();      // _a was the scratch the drop just used
      }
      showCarried(ch, R.style, R.carry > 0);
      // The body squares up for the work even if the player never raised the
      // sights: animChar reads these, and fpsmode rewrites them each frame
      // from its own state the moment the reload is done.
      ch.aimingPose = true;
      ch.carryPose = false;
    } else {
      showCarried(ch, R.style, false);
    }

    /* ---- SHOULDER THE RIFLE ------------------------------------------
       MEASURED, and it is the real reason the off hand could never be on a
       long gun: the present-weapon pose holds the firing arm nearly STRAIGHT
       (character.js: shoulder -1.571, elbow -0.10, plus 0.14 of shoulder
       protraction), which puts the grip ~0.55 m in front of the chest. An
       M4 drawn at its researched world length carries its handguard another
       0.46 m past that. The off arm's total span is 0.63 m. The handguard
       was 0.4 m OUT OF REACH — no support pose, tuned or solved, could ever
       have touched it, which is exactly why three rounds of re-tuning the
       angles never fixed the owner's complaint.

       You cannot pose your way out of that; the GUN has to come back. So
       when the support anchor is beyond the off arm, the firing hand is
       pulled straight back along the barrel by the shortfall — the rifle
       goes into the shoulder instead of being held out at arm's length,
       which is both how a rifle is actually held and what puts the
       handguard inside the other arm's reach. Weapon-agnostic: a pistol's
       support anchor is beside its own grip, so the pull is zero and
       nothing about sidearms moves. */
    if (CBZ.CONFIG.CHAR_SHOULDER_LONGGUN !== false) {
      const reach = armSpan(ch);
      shoulderWorld(ch, "l", _sh);
      let over = _sh.distanceTo(target) - reach;
      if (over > 0.01) {
        // A little PAST just-reachable. Sitting exactly on the reach limit
        // leaves the off arm locked straight, which reads as a second set of
        // zombie arms; the margin buys a visible, load-bearing elbow. The
        // loop is self-stabilising — animChar damps the firing arm back
        // toward its own pose each frame, this pulls it in by whatever is
        // still missing, and `over` shrinks to zero at the balance point.
        const pull = Math.min(over + 0.06, 0.42);
        prop.getWorldQuaternion(_bodyQ);
        _fwd.set(0, 0, -1).applyQuaternion(_bodyQ);        // the barrel's own axis
        ch.sockets.rightHand.updateWorldMatrix(true, false);
        ch.sockets.rightHand.getWorldPosition(_rt);
        _rt.addScaledVector(_fwd, -pull);
        CBZ.charArmTo.rest(ch, "r", 0);
        CBZ.charArmTo(ch, _rt, "r", blend);
        // The gun rode the wrist back, so its world aim is now stale in both
        // inputs the lock uses (socket orientation, and the parallax origin).
        if (CBZ.tpHandWeaponRelock) CBZ.tpHandWeaponRelock();
        prop.updateWorldMatrix(true, false);
        target = computeTarget();
        over = _sh.distanceTo(target) - reach;
      }
      if (over > 0.01) slideToReach(ch, prop, target, reach, _sh);
    }

    CBZ.charArmTo.rest(ch, "l", 0);
    CBZ.charArmTo(ch, target, "l", blend);
  }

  /* Still short — a bipod-legged M249, an NPC whose gun this pass may not
     move, or a rocket reload that reaches for a muzzle a metre out. Then the
     honest answer is that the hand holds the weapon FURTHER BACK rather than
     floating in the air off the end of it: slide the anchor along the gun
     toward the grip (which is in the other hand, so it is always reachable)
     until it lands. Bisection, four steps, because the reachable set is an
     interval — and the hand ends up ON the weapon either way. */
  function slideToReach(ch, prop, target, reach, shoulder) {
    prop.updateWorldMatrix(true, false);
    _grip.set(0, 0, 0);
    prop.localToWorld(_grip);
    if (shoulder.distanceTo(_grip) > reach) return target;   // even the grip is gone
    let lo = 0, hi = 1;
    for (let i = 0; i < 4; i++) {
      const mid = (lo + hi) / 2;
      _tmp.lerpVectors(target, _grip, mid);
      if (shoulder.distanceTo(_tmp) > reach) lo = mid; else hi = mid;
    }
    return target.lerp(_grip, hi);
  }
  /* The off arm's real span in WORLD metres. l1/l2 mirror charArmTo's own
     link lengths; the rig's metre conversion is on the group. */
  const _sh = new THREE.Vector3(), _fwd = new THREE.Vector3();
  const _rt = new THREE.Vector3(), _grip = new THREE.Vector3();
  function armSpan(ch) {
    const P = ch.profile;
    if (!P) return 0.62;
    const l1 = Math.max(0.12, P.armUp - 0.02);
    const l2 = Math.hypot(P.armLo + 0.01, 0.035);
    const s = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.70;
    return (l1 + l2) * 0.985 * s;
  }
  function shoulderWorld(ch, arm, out) {
    const part = arm === "l" ? ch.parts.la : ch.parts.ra;
    out.copy(part.position);
    ch.body.updateWorldMatrix(true, false);
    return ch.body.localToWorld(out);
  }

  /* ---- EVERY OTHER ARMED BODY IN THE CITY -------------------------------
     systems/actorweapons.js's setReadyPose carries the same fixed-angle
     support pose the player's did, for the same reason (it predates any way
     to ask a weapon where its handguard is) — so a street full of cops and
     gangbangers has the bug the owner reported, N times over, and the player
     sees THEIR hands far more often than his own.

     The same solve fixes them, and it is nearly free: setReadyPose has
     already put the arm within a few degrees, so this is a correction rather
     than a pose. Budgeted anyway — nearest first, capped, on-foot armed
     actors only — because "cheap per actor" is not a licence to run it on a
     crowd of two hundred. Reload choreography is deliberately NOT extended
     here: NPCs have no reload clock to drive it from, and inventing one would
     be a second source of truth for something fpsmode owns. */
  if (CBZ.CONFIG.NPC_SUPPORT_HAND_IK == null) CBZ.CONFIG.NPC_SUPPORT_HAND_IK = true;
  const NPC_RANGE2 = 34 * 34, NPC_BUDGET = 14;
  const _npcT = new THREE.Vector3();
  function npcArmed(a) {
    return a && a.armed && !a.dead && !a._parked && !(a.ko > 0) && !a._traversal &&
      !a._holstered && !a._gunLowered && !a._gunHidden && !a.surrender &&
      a.char && a.char.parts && a.char.parts.la && a.char.body && a.char.sockets &&
      !a.char.traversePose && !a.char.surrender && !a.char.handsUp &&
      !a.char.slidePose && !a.char.cuffed &&
      a._weaponProp && a._weaponProp.visible;
  }
  function poseNpcList(list, origin, out) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!npcArmed(a)) continue;
      const p = a.pos || (a.char.group && a.char.group.position);
      if (!p) continue;
      const dx = p.x - origin.x, dz = p.z - origin.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > NPC_RANGE2) continue;
      out.push({ a, d2 });
    }
  }
  const _npcPicks = [];
  function poseNpcHands() {
    if (CBZ.CONFIG.NPC_SUPPORT_HAND_IK === false ||
        CBZ.CONFIG.CHAR_SUPPORT_HAND_IK === false || !CBZ.charArmTo) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const cam = CBZ.camera;
    if (!cam) return;
    _npcPicks.length = 0;
    poseNpcList(CBZ.cityPeds, cam.position, _npcPicks);
    poseNpcList(CBZ.cityCops, cam.position, _npcPicks);
    if (!_npcPicks.length) return;
    _npcPicks.sort((x, y) => x.d2 - y.d2);
    const n = Math.min(NPC_BUDGET, _npcPicks.length);
    for (let i = 0; i < n; i++) {
      const a = _npcPicks[i].a, ch = a.char, prop = a._weaponProp;
      const grips = gripsOf(prop);
      if (!grips.support) continue;
      prop.updateWorldMatrix(true, false);
      _npcT.copy(grips.support);
      prop.localToWorld(_npcT);
      if (CBZ.floorAt) {
        const fl = CBZ.floorAt(_npcT.x, _npcT.z) + 0.05;
        if (_npcT.y < fl) _npcT.y = fl;
      }
      // NPCs get the anchor slide but NOT the shoulder pull: their weapon's
      // orientation comes from the forearm itself (actorweapons.js mounts the
      // prop at a fixed local rotation), so moving that arm would swing the
      // barrel off whatever combat.js is aiming it at. Sliding the off hand
      // back along the gun puts it on the weapon and touches nothing else.
      slideToReach(ch, prop, _npcT, armSpan(ch), shoulderWorld(ch, "l", _sh));
      CBZ.charArmTo.rest(ch, "l", 0);
      CBZ.charArmTo(ch, _npcT, "l", 1);
    }
  }

  // 53.9: after fpsmode's own tick (52) so fps.reloading is this frame's, and
  // BEFORE holsterprops (54) so the gun it draws is already canted for the
  // reload rather than a frame behind it.
  CBZ.onAlways(53.9, reloadTick);
  // 54.6: after holsterprops has finished placing and aiming the gun — the
  // support hand is solved to where the weapon ACTUALLY ended up this frame,
  // which is the whole point.
  CBZ.onAlways(54.6, function (dt) { poseHands(dt); poseNpcHands(); });

  /* Test/measurement surface — tools/visual-presets/gun-hold-reload.mjs
     reports the residual in centimetres, so "the hand is on the gun" is a
     number instead of an opinion. */
  CBZ.gunHandAudit = function () {
    const ch = CBZ.playerChar;
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    if (!ch || !prop || !ch.sockets || !ch.sockets.leftHand) return null;
    const grips = gripsOf(prop);
    if (!grips.support) return { weapon: prop.userData.weaponId, oneHanded: true };
    prop.updateWorldMatrix(true, false);
    const want = anchorWorld("support", ch, prop, grips, _a);
    ch.sockets.leftHand.updateWorldMatrix(true, false);
    const got = ch.sockets.leftHand.getWorldPosition(_b);
    return {
      weapon: prop.userData.weaponId,
      style: grips.style,
      authored: grips.authored,
      gap: got.distanceTo(want),
      above: got.y - want.y,
      blend,
      passes: seen.pass,
      driven: seen.drive,
      why: seen.why,
      reloading: R.active,
      reloadP: R.p,
    };
  };
})();
