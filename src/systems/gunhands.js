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

   …and a POINT was still not a hold: the socket landed near the handguard
   with the hand hanging off the forearm at whatever angle, walked half a
   metre back along every long gun when out of reach. Now the hand is put ON
   the part — a grip frame, a hand sized to it, the wrist where that hand's
   wrist has to be (CBZ.gunHold, systems/actorweapons.js) — and the body
   blades and shoulders the gun so the handguard is in reach at all
   (bladeTick; measured by tools/gun-hold-check.mjs).

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
     (NPC hands: systems/actorweapons.js CBZ.gunHold.ready — solved once per
      body and gun, both hands, no budget.)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  /* The grip frames, the hand-on-grip solve and the NPC ready pose live in
     systems/actorweapons.js (CBZ.gunHold), beside the gun models they read. */
  const GH = CBZ.gunHold;
  if (!GH) return;

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
  // the same choreography, read by fpsmode.js so the FIRST-PERSON off hand
  // walks the identical path through the viewmodel's anchors (one table, two views)
  CBZ.gunReloadChoreo = function (style) { return CHOREO[style] || CHOREO.mag; };
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
     that sells it is the empty mag hitting the pavement behind you. It is
     the SAME magazine model the fist carries, handed to CBZ.debris.adopt:
     the one rigid-body sim gives it real gravity, a bounce off its own
     corner, a tumble onto its side, and then it lies there as settled
     debris (capped and recycled by debris.js). No private pool or
     integrator here any more. */
  let magMat = null;
  function magMesh(style) {
    if (!magMat) {
      magMat = new THREE.MeshLambertMaterial({ color: 0x22262b });
      magMat.name = "magazine";
      magMat._shared = true;
    }
    const d = style === "belt" ? [0.15, 0.20, 0.26] : style === "cylinder" ? [0.07, 0.05, 0.07]
      : [0.07, 0.21, 0.10];
    const m = new THREE.Mesh(new THREE.BoxGeometry(d[0], d[1], d[2]), magMat);
    m.castShadow = true;
    return m;
  }
  const _magV = new THREE.Vector3(), _magW = new THREE.Vector3();
  function dropMag(pos, style) {
    const root = CBZ.scene;
    if (!root || !CBZ.debris) return;
    const m = magMesh(style);
    m.position.copy(pos);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    root.add(m);
    m.updateMatrixWorld(true);
    const p = CBZ.player;
    _magV.set((p && p.vx ? p.vx * 0.5 : 0) + (Math.random() - 0.5) * 0.5, -0.4,
      (p && p.vz ? p.vz * 0.5 : 0) + (Math.random() - 0.5) * 0.5);
    _magW.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
    // kind plastic: a polymer/steel mag body that must not be "bent" like torn sheet metal
    CBZ.debris.adopt(m, { velocity: _magV, angular: _magW, owner: "mags", kind: "plastic" });
    // the body carries its own copy of the geometry; the template goes
    root.remove(m);
    m.geometry.dispose();
    if (CBZ.sfx) setTimeout(function () { try { CBZ.sfx("shell"); } catch (e) {} }, 380);
  }

  /* ---- the fresh magazine, carried in the fist -------------------------- */
  /* A ROCKET is not a magazine: the fresh round in the fist is a copy of the
     launcher's own PG-7V (weapons/appearances/bazooka.js userData.warhead),
     held round the bulb, nose along the fingers, at the launcher's own size.
     The launcher shows its seated round again from the same 84% at which
     this one leaves the hand (fpsmode.js syncWarheads). */
  let carried = null, carriedStyle = null, carriedSrc = null;
  const _wsA = new THREE.Vector3(), _wsB = new THREE.Vector3();
  function showCarried(ch, style, on, prop) {
    if (!on) { if (carried) carried.visible = false; return; }
    const socket = ch.sockets && ch.sockets.leftHand;
    if (!socket) return;
    const round = style === "rocket" && prop && prop.userData.warhead ? prop.userData.warhead : null;
    if (!carried || carriedStyle !== style || (round && carriedSrc !== round)) {
      if (carried && carried.parent) carried.parent.remove(carried);
      if (carried && carried.isMesh) carried.geometry.dispose();   // a round's geometry is shared
      carried = round ? round.clone() : magMesh(style);
      carriedStyle = style;
      carriedSrc = round;
    }
    if (carried.parent !== socket) socket.add(carried);
    if (round) {
      // the launcher's world scale over the hand's: the same size as the tube's round
      prop.getWorldScale(_wsA); socket.getWorldScale(_wsB);
      const k = _wsA.x / (_wsB.x || 1);
      carried.scale.setScalar(k);
      carried.rotation.set(-Math.PI / 2, 0, 0);          // nose (-Z) along the fingers (socket -Y)
      const bulb = (CBZ.rpgRound && CBZ.rpgRound.bulbZ) || -0.32;
      carried.position.set(0, -0.10 - bulb * k, 0.02);   // the bulb in the palm
    } else {
      const s = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 1;
      carried.scale.setScalar(1 / (s || 1));
      carried.position.set(0, -0.10, 0.02);
      carried.rotation.set(0.4, 0, 0.15);
    }
    carried.visible = true;
  }

  /* ---- the pass: put the off hand where the gun is ----------------------
     The FIRING hand is already on the grip when this runs: holsterprops'
     aimHandProp (54) ends in CBZ.gunHold.fire, which closes the body's right
     hand on the gun's own grip and seats the gun in it. This pass owns the
     OFF hand: CBZ.gunHold.support orients it on the handguard / foregrip /
     firing fist and solves the arm so its wrist is where that hand has to
     be, and everything below is about when that is and is not reachable. */
  let blend = 0, drove = false;
  const seen = { pass: 0, drive: 0, why: "never ran" };
  const LANDED = 0.03;                     // 3 cm — a fist's worth of slop
  const _sh = new THREE.Vector3(), _fwd = new THREE.Vector3();
  const _rt = new THREE.Vector3(), _ext = new THREE.Vector3(), _sp = new THREE.Vector3();
  function release(ch) {
    blend = 0;
    if (carried) carried.visible = false;
    // hand the off hand back ONCE: a per-frame "relaxed" here fought every
    // other owner of that hand (the flashlight's torch grip, a verb) each frame
    if (drove && ch && ch.setHandPose) ch.setHandPose("l", "relaxed");
    drove = false;
  }
  function floorUnder(p) {
    return CBZ.floorAt ? CBZ.floorAt(p.x, p.z) + 0.05 : null;
  }
  function poseHands(dt) {
    seen.pass++;
    const ch = CBZ.playerChar;
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    // holsterprops' firing fist (54) may have moved the arm this frame too
    if (prop && ch === snap.ch) snap.live = true;
    const own = !!(prop && ch && ch.parts && ch.parts.la && ch.body && ch.sockets &&
      CBZ.CONFIG.CHAR_SUPPORT_HAND_IK !== false && CBZ.charArmTo && CBZ.charArmTo.wrist &&
      !ch.slidePose && !ch.cuffed && !ch.surrender && !ch.handsUp && !ch.verbHold &&
      !(CBZ.player && CBZ.player.dead) &&
      !(CBZ.weaponTransferState && CBZ.weaponTransferState().active));
    // A one-handed weapon (the taser) publishes no support grip and keeps its
    // off arm free — that is a fact about the weapon, not a missing anchor.
    const grips = own ? gripsOf(prop) : null;
    const spec = own ? GH.specOf(prop) : null;
    if (!grips || !grips.support || !spec || !spec.sup) {
      // Hand the arm back. Nothing to unwind: every channel this pass writes
      // is one that animChar damps home on its own the next frame — the same
      // contract entities/poses.js and the reach layer rely on.
      release(ch);
      seen.why = !prop ? "no drawn weapon"
        : !ch ? "no player rig"
        : ch.slidePose ? "slide pose owns the rig"
        : (ch.cuffed || ch.surrender || ch.handsUp || ch.verbHold) ? "hands are busy"
        : (CBZ.player && CBZ.player.dead) ? "dead"
        : (CBZ.weaponTransferState && CBZ.weaponTransferState().active) ? "stowing"
        : grips ? "one-handed weapon" : "no rig parts";
      return;
    }
    seen.drive++; seen.why = "";
    drove = true;
    blend += (1 - blend) * Math.min(1, 9 * (dt || 0.016));

    R.style = grips.style || "mag";
    prop.updateWorldMatrix(true, false);
    ch.body.updateWorldMatrix(true, false);

    // ---- a reload carries the hand OFF the gun, through its anchors ------
    const reloadSeg = (R.active && R.w > 0)
      ? (function () {
          const table = CHOREO[R.style] || CHOREO.mag;
          for (let i = 0; i < table.length; i++) if (R.p <= table[i][1]) return table[i];
          return table[table.length - 1];
        })()
      : null;
    if (reloadSeg) {
      const computeTarget = function () {
        let t = anchorWorld("support", ch, prop, grips, _t);
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
        // A HAND MAY NOT GO THROUGH THE FLOOR (prone: the rig is at ankle height)
        const fl = floorUnder(t);
        if (fl != null && t.y < fl) t.y = fl;
        return t;
      };
      let target = computeTarget();
      if (!R.ejected && EJECT_AT[R.style] != null && R.p >= EJECT_AT[R.style]) {
        R.ejected = true;
        const mp = anchorWorld("mag", ch, prop, grips, _a);
        if (mp) dropMag(mp, R.style);
        target = computeTarget();      // _a was the scratch the drop just used
      }
      showCarried(ch, R.style, R.carry > 0, prop);
      // The body squares up for the work even if the player never raised the
      // sights: animChar reads these, and fpsmode rewrites them each frame
      // from its own state the moment the reload is done.
      ch.aimingPose = true;
      ch.carryPose = false;
      // The reload owns the hand, and its waypoints are deliberately OFF the
      // weapon (the belt pouch most of all) — never walked back onto the gun.
      CBZ.charArmTo.rest(ch, "l", 0);
      seen.resid0 = seen.residual = CBZ.charArmTo(ch, target, "l", blend);
      seen.slid = 0; seen.placed = 0;
      // the hand leaves its grip frame for its own rest frame as the reload
      // takes it, and comes back the same way — no snap at either end
      GH.supportOrient(ch, prop, R.w);
      return;
    }
    showCarried(ch, R.style, false);

    /* ---- THE ONE HOLD: THE SAME SOLVE EVERY ARMED NPC USES ----------------
       Standing, crouched or walking (the torso upright), the player's hold IS
       CBZ.gunHold's ready pose, the one solved once per body + gun against
       the body as worn (the shaped chest and any plate carrier on it: arms
       and gun kept out of both) and copied:
         · presenting: pitched onto the aim (gunHold.pitchNpc), then the
           barrel is locked exactly onto the crosshair and the fist re-seated
           (holsterprops), and the support hand re-landed on the gun;
         · LOW READY with a long gun: the stock stays in the shoulder pocket
           and BOTH hands stay on the gun, muzzle down and a touch across the
           body (gunHold.lowReady). A pistol keeps its one-hand carry.
       A pitched torso (prone) keeps the placement below. */
    const upright = Math.abs(ch.body.rotation.x || 0) < 0.8 && !ch.pronePose;
    if (upright && (ch.aimingPose || GH.isLong(prop))) {
      const aimed = !!ch.aimingPose;
      if (aimed) {
        if (CBZ.playerAimDir) CBZ.playerAimDir(_fwd); else _fwd.set(0, 0, 1);
        GH.pitchNpc(ch, prop, -Math.asin(Math.max(-1, Math.min(1, _fwd.y))));
      } else {
        GH.lowReady(ch, prop);
        seen.why = "low ready";
      }
      // where the solve put the gun (the support hand is on it there)
      prop.updateWorldMatrix(true, false);
      _m0.copy(prop.matrixWorld);
      // presenting, exactly onto the crosshair: the last half-degree the
      // pitch table leaves, turned into the gun and the fist together
      if (aimed) aimTrim(ch, prop);
      /* AT LOW READY the cached solve can leave a pitched-down stock's toe in
         the chest (or its plate carrier): carry the fist, and the gun in it,
         out by exactly what is inside. (Presenting, the solve's own stand-off
         holds: the fist's aim-locked wrist would only walk it back.) */
      for (let i = 0; i < (aimed ? 0 : 6); i++) {
        const gp = GH.gunInBody(ch, prop);
        if (gp < 0.003) break;
        CBZ.charArmTo.crease(ch, "r", _a);
        ch.body.getWorldQuaternion(_bodyQ);
        const bs = ch.body.matrixWorld.getMaxScaleOnAxis() || 0.7;
        if (prop.userData.shoulderZ != null) _b.set(0, (gp + 0.008) * bs, 0);
        else _b.set(0, 0, (gp + 0.008) * bs).applyQuaternion(_bodyQ);
        _a.add(_b);
        const hr = ch.parts.ra.userData.cap;
        if (hr) { hr.getWorldQuaternion(_eq); _t.set(0, 0, 1).applyQuaternion(_eq); }
        CBZ.charArmTo.wrist(ch, _a, "r", hr ? _t : null, 1);
        GH.fire(ch, prop, aimed, 0);
        if (aimed) aimTrim(ch, prop);
      }
      /* THE SUPPORT HAND STAYS WHERE THE SOLVE PUT IT unless the gun really
         moved (the trim is a fraction of a degree: the hand is still on the
         gun). Only a stand-off off the chest re-lands it: a fresh solve from
         here finds a worse local answer than the cached one. */
      prop.updateWorldMatrix(true, false);
      _tp.setFromMatrixPosition(prop.matrixWorld);
      _t.setFromMatrixPosition(_m0);
      if (_tp.distanceTo(_t) > 0.012 && GH.specOf(prop) && GH.specOf(prop).sup) {
        GH.supportPoint(ch, prop, _sp);
        const floorY = floorUnder(_sp);
        const gap = GH.support(ch, prop, 1, 0, 3, floorY);
        if (gap != null && gap > LANDED) { GH.supportLand(ch, prop, 1, LANDED, 4, floorY); seen.slid = 1; }
      }
      seen.residual = GH.last.supGap; seen.placed = aimed ? 2 : 3;
      easeArms(ch, blend);
      return;
    }

    /* ---- ONE-HAND PORT CARRY (CHAR_PORT_ARMS_CARRY) ----------------------
       At the port-arms carry the handguard rides up the diagonal, and for the
       longer guns it is genuinely outside the off arm's ellipsoid. Both ways
       of forcing two hands onto it were measured and both are worse than not:
         · the shouldered placement re-aims the gun down its own (now diagonal)
           axis and yanks the wrist toward the neck — off hand 50 cm off the
           bore (gunhands-check);
         · the inboard tuck brings the gun to the centreline, where the torso
           eats it from the chase camera — 92% of the barrel visible fell to
           23% (tp-gun-view-check, carry).
       A rifle ported in one hand is a real carry and reads clean, so when the
       handguard is out of reach the off arm is RELEASED to animChar's own
       carry swing rather than left stretching at it. span() is the
       conservative reach; the margin is the protraction it excludes. */
    if (!ch.aimingPose && buttLen(prop) > 0.18 &&
        CBZ.CONFIG.CHAR_PORT_ARMS_CARRY !== false && CBZ.charArmTo.span) {
      shoulderWorld(ch, "l", _sh);
      GH.supportPoint(ch, prop, _sp);
      if (_sh.distanceTo(_sp) > CBZ.charArmTo.span(ch, "l") + 0.10) {
        release(ch);
        seen.why = "port carry: handguard out of reach — off hand at rest";
        return;
      }
    }
    CBZ.charArmTo.rest(ch, "l", 0);
    GH.supportPoint(ch, prop, _sp);
    let floorY = floorUnder(_sp);
    let gap = GH.support(ch, prop, blend, 0, 3, floorY);
    seen.resid0 = gap;
    seen.slid = 0; seen.placed = 0;
    /* AT LOW READY the gun is where the CARRY pose hangs it — a pistol
       beside the thigh, a long gun ported up the diagonal — and nothing here
       moves it: if the off hand can land on it (walked back along a
       handguard if need be) it does, and if it cannot it is a one-hand carry
       and the off arm goes back to the walk. (The old answer, tucking a
       hanging pistol inboard for the other hand, parked the gun and both
       forearms inside the belly — tools/gun-hold-check.mjs.) */
    if (!ch.aimingPose && gap != null && gap > LANDED) {
      if (blend > 0.9) { gap = GH.supportLand(ch, prop, blend, LANDED, 4, floorY); seen.slid = 1; }
      if (gap > LANDED) {
        snapRestoreArm("l");
        release(ch);
        seen.why = "carry: support grip out of reach — off hand at rest";
        seen.residual = gap;
        return;
      }
    }

    /* PUT THE STOCK IN THE SHOULDER. The present-weapon pose holds the firing
       arm nearly straight, which puts the grip ~0.55 m in front of the chest
       and the handguard another 0.46 m past that — beyond anything the off
       arm can touch. A shouldered rifle's geometry is not a matter of
       opinion: the butt sits in the shoulder pocket and the grip is one
       buttstock-length forward of it down the barrel, so
           wrist = pocket + barrelForward x (grip-to-butt length)
       measured off the weapon's own model. PLACED, not nudged — an earlier
       pass moved the hand by the shortfall each frame and animChar's damp
       simply ate it (42 cm requested bought 10 cm). Only fires when the hand
       actually missed, so a pistol whose cup is already in reach never moves.
       At the port-arms CARRY "down the barrel's own axis" is the up-across
       diagonal (it would drive the wrist into the neck), so that case is the
       release above instead; the pistol inboard tuck below stays at carry — it
       is what makes a two-hand low ready reachable at all. */
    const stock = buttLen(prop);
    // Presenting, the gun is ALWAYS placed (a placement gated on "did the
    // hand miss" switches on and off as the miss hovers at the threshold,
    // and the gun jumps with it)
    if (ch.aimingPose && gap != null && CBZ.CONFIG.CHAR_SHOULDER_LONGGUN !== false && blend > 0.9) {
      shoulderWorld(ch, "l", _sh, true);
      prop.getWorldQuaternion(_bodyQ);
      _fwd.set(0, 0, -1).applyQuaternion(_bodyQ);          // the barrel's own axis
      shoulderWorld(ch, "r", _rt, true);                    // the firing shoulder
      prop.getWorldPosition(_ext);                          // where the gun is now
      if (stock <= 0.18 && ch.aimingPose) {
        /* NO STOCK TO SHOULDER — a pistol, held at full arm's length out to
           the firing side, 81 cm from the off shoulder: unreachable for the
           same shoulder-width reason a rifle's handguard is. Both arms come
           to the CENTRELINE and meet there; keep the extension exactly as the
           aim pose set it and only move it inboard. */
        _tmp.copy(_ext).sub(_rt);                               // the arm's own reach
        _rt.lerp(_sh, 0.42).add(_tmp);
        // a compact with its support grip AHEAD of the fist (the Uzi's
        // receiver) comes back toward the chest by that much, elbows bending
        GH.supportPoint(ch, prop, _sp);
        const ahead = _sp.sub(_ext).dot(_fwd);
        if (ahead > 0.06) _rt.addScaledVector(_fwd, -(ahead - 0.06));
        seen.butt = 0;
      } else if (stock <= 0.18) {
        /* A PISTOL AT LOW READY, two hands: in front of the belly, arms angled
           down and forward. (The old tuck took the hanging arm's own
           extension inboard, which parked the gun and both forearms INSIDE
           the belly — tools/gun-hold-check.mjs, chest box.) */
        ch.body.getWorldQuaternion(_bodyQ);
        _rt.lerp(_sh, 0.42).add(_tmp.set(0, -0.40, 0.34).applyQuaternion(_bodyQ));
        seen.butt = 0;
      } else {
        /* TOWARD THE CENTRELINE, not into the firing shoulder pocket: the
           shoulders sit ~0.87 m apart and the arm is 0.63 m, so a gun parked
           in one pocket is unreachable by the other hand by construction.
           The weapon comes to the chest (and the body blades, bladeTick),
           which is where a third-person rifle reads from anyway. */
        _rt.lerp(_sh, 0.38);
        _rt.y -= 0.05;
        // the pocket is the chest's FRONT surface, not the shoulder joint's
        // centre inside the torso (that put the firing wrist in the chest)
        ch.body.getWorldQuaternion(_bodyQ);
        _rt.add(_tmp.set(0, 0, ((ch.profile && ch.profile.torsoD) || 0.5) * 0.5 *
          ((ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.70)).applyQuaternion(_bodyQ));
        seen.butt = stock;
        _rt.addScaledVector(_fwd, stock);
      }
      // _rt is where the GUN goes: carry the fist with it rigidly and solve
      // the arm to that wrist, the forearm led in along the hand
      CBZ.charArmTo.crease(ch, "r", _a);
      _a.add(_rt).sub(_ext);
      const hr = ch.parts.ra.userData.cap;
      if (hr) { hr.getWorldQuaternion(_bodyQ); _b.set(0, 0, 1).applyQuaternion(_bodyQ); }
      CBZ.charArmTo.rest(ch, "r", 0);
      CBZ.charArmTo.wrist(ch, _a, "r", hr ? _b : null, blend);
      seen.placed = 1;
      // The gun rode the wrist back: re-aim it (parallax from its new
      // position) and re-seat it in the fist — both in holsterprops.
      if (CBZ.tpHandWeaponRelock) CBZ.tpHandWeaponRelock();
      prop.updateWorldMatrix(true, false);
      GH.supportPoint(ch, prop, _sp);
      floorY = floorUnder(_sp);
      gap = GH.support(ch, prop, blend, 0, 3, floorY);
    }
    /* Still short — a bipod-legged M249, or shoulders too far apart for the
       handguard to be crossable. Then the honest answer is that the hand holds
       the weapon FURTHER BACK rather than floating off the end of it: walk the
       grip along the gun toward the receiver until the hand lands (bisection
       on the MEASURED gap, so it needs no notion of reach at all). */
    if (blend > 0.9 && gap != null && gap > LANDED) {
      gap = GH.supportLand(ch, prop, blend, LANDED, 4, floorY);
      seen.slid = 1;
    }
    seen.residual = gap;
  }

  /* The hold is laid over the animated arms: while it is coming in (blend
     rising from 0 as the gun comes up) the arms travel there from where the
     animation had them this frame, instead of snapping. */
  const _eq = new THREE.Quaternion(), _m0 = new THREE.Matrix4();
  /* THE BARREL ON THE CROSSHAIR, WITHOUT RE-SOLVING THE ARM. The pitch table
     (gunHold.pitchNpc, 0.05 rad levels blended) and the camera's parallax
     leave the barrel a fraction of a degree off the aim; turn the gun about
     its grip, and the fist round it, by exactly that (holsterprops' relock
     re-solves the whole firing arm, which from an already-solved hold walks
     the wrist centimetres every frame). */
  const _tp = new THREE.Vector3(), _td = new THREE.Vector3(), _tb = new THREE.Vector3();
  const _tqa = new THREE.Quaternion(), _tqg = new THREE.Quaternion(), _tqp = new THREE.Quaternion();
  function aimTrim(ch, prop) {
    if (!CBZ.camera || !prop.parent) return;
    prop.updateWorldMatrix(true, false);
    prop.getWorldPosition(_tp);
    prop.getWorldQuaternion(_tqg);
    if (CBZ.playerAimDir) CBZ.playerAimDir(_td); else _td.set(0, 0, -1).applyQuaternion(CBZ.camera.quaternion);
    _td.multiplyScalar(120).add(CBZ.camera.position).sub(_tp).normalize();
    _tb.set(0, 0, -1).applyQuaternion(_tqg);
    _tqa.setFromUnitVectors(_tb, _td);
    _tqg.premultiply(_tqa);
    prop.parent.getWorldQuaternion(_tqp);
    prop.quaternion.copy(_tqp.invert()).multiply(_tqg);
    const hr = ch.parts.ra.userData.cap;
    if (hr) {
      hr.getWorldQuaternion(_tqg);
      _tqg.premultiply(_tqa);
      hr.parent.getWorldQuaternion(_tqp);
      hr.quaternion.copy(_tqp.invert()).multiply(_tqg);
    }
  }
  function easeArms(ch, k) {
    if (k >= 0.995 || snap.ch !== ch) return;
    for (const side of ["r", "l"]) {
      const part = side === "l" ? ch.parts.la : ch.parts.ra;
      _eq.copy(part.quaternion);
      part.quaternion.copy(side === "l" ? snap.laQ : snap.raQ).slerp(_eq, k);
      const p0 = side === "l" ? snap.laP : snap.raP;
      part.position.lerp(p0, 1 - k);
    }
  }

  /* GRIP-TO-BUTT, in world metres: the gun's own +Z extent (CBZ.gunHold.
     stockZ, measured off its model) through the prop's scale and the rig's
     metre conversion. A pistol measures near zero. */
  function buttLen(prop) {
    if (prop.userData._buttLen != null) return prop.userData._buttLen;
    const rig = (CBZ.playerChar && CBZ.playerChar.group && CBZ.playerChar.group.userData
      && CBZ.playerChar.group.userData.humanScale) || 0.70;
    const len = GH.stockZ(prop) * (prop.scale.x || 1) * rig;
    prop.userData._buttLen = len;
    return len;
  }
  function shoulderWorld(ch, arm, out, atRest) {
    const part = arm === "l" ? ch.parts.la : ch.parts.ra;
    out.copy(part.position);
    if (atRest) out.z = 0;                    // the joint itself, not the pose's protraction
    ch.body.updateWorldMatrix(true, false);
    return ch.body.localToWorld(out);
  }

  /* ---- THE BLADED STANCE -------------------------------------------------
     A shouldered long gun is held with the body TURNED: support shoulder
     forward, firing shoulder back, head turned onto the sights. This rig's
     shoulders sit ~0.87 m apart against a 0.49 m arm to the wrist, and its
     rifles are drawn 1.45x real (weapons/weapon-scale.js READ), so square to
     the target the handguard is 0.8 m from the off shoulder: out of reach for
     every long gun in the game (measured, tools/gun-hold-check.mjs). Blading
     the torso is the joint a real shooter spends on exactly this — it carries
     the off shoulder ~0.2 m toward the handguard — so it is spent here.
     body.rotation.y is written ABSOLUTE while it is up (the gait's shoulder
     counter-swing has no business in a shouldered aim); the neck counter-turns
     as a baked offset that is backed out before the next one is added, the
     same own-channel pattern systems/reactions.js uses for its head track.
     Runs before holsterprops (54) so the gun is aimed and seated off the
     turned body in the same frame. */
  const BLADE = GH.BLADE, BLADE_NECK = GH.BLADE_NECK;   // the NPC ready pose blades the same
  let bladeK = 0, bladeRig = null;
  /* ---- THE HOLD IS AN OVERLAY ON THE ANIMATION, NOT AN INPUT TO IT --------
     animChar damps every arm channel FROM its current value. Every pass here
     (the blade, holsterprops' firing fist, the support hand, the reload) IK-
     solves the arms and writes full 3D shoulder rotations — swing AND twist —
     which read back as large, oddly-branched Euler angles. Left in place,
     next frame's damp starts from them and walks the Euler components toward
     its own targets on their own: the arm swung through the body and back
     (measured: the pistol low-ready's gun jumped 7-15 cm a frame). And any
     solve made relative to where the arm IS (the inboard pistol tuck, the
     ground-rest lift) compounded frame on frame.
     So the arms animChar produced are SNAPSHOTTED before the first of these
     passes and put back just before the player's animChar runs next frame
     (physics.js updatePlayer, onUpdate 10): animChar only ever sees its own
     pose, and the hold is laid over it fresh every frame. A frame with the
     game paused (updaters skipped, these passes still running) restores
     here instead, so a paused hold cannot compound either. Only restored
     after a frame these passes were live, so every other writer of the arms
     keeps its own dynamics. */
  const snap = { ch: null, live: false,
    raQ: new THREE.Quaternion(), laQ: new THREE.Quaternion(), raP: new THREE.Vector3(), laP: new THREE.Vector3(),
    raL: new THREE.Euler(), laL: new THREE.Euler(), by: 0 };
  let ranUpdate = false;
  const _pw = new THREE.Matrix4(), _pl = new THREE.Matrix4(), _ps = new THREE.Vector3();
  function snapRestore() {
    const ch = snap.ch;
    snap.live = false;
    if (!ch || ch !== CBZ.playerChar || !ch.parts || !ch.parts.la || !ch.parts.ra || !ch.body) return;
    // the drawn gun stays where it was SEEN while the arm under it goes back:
    // the ground-rest pass inside animChar measures the gun, and it must
    // measure the one on screen, not the one the un-held arm would carry
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    if (prop && prop.parent) { prop.updateWorldMatrix(true, false); _pw.copy(prop.matrixWorld); }
    ch.parts.ra.quaternion.copy(snap.raQ); ch.parts.ra.position.copy(snap.raP); ch.parts.ra.userData.low.rotation.copy(snap.raL);
    ch.parts.la.quaternion.copy(snap.laQ); ch.parts.la.position.copy(snap.laP); ch.parts.la.userData.low.rotation.copy(snap.laL);
    ch.body.rotation.y = snap.by;
    if (prop && prop.parent) {
      prop.parent.updateWorldMatrix(true, false);
      _pl.copy(prop.parent.matrixWorld).invert().multiply(_pw);
      _pl.decompose(prop.position, prop.quaternion, _ps);          // (its own scale is left exact)
    }
  }
  // put one arm back to this frame's animated pose (a hold that was tried
  // and given up must not leave the arm where the attempt left it)
  function snapRestoreArm(side) {
    const ch = snap.ch;
    if (!ch || ch !== CBZ.playerChar || !ch.parts) return;
    const part = side === "l" ? ch.parts.la : ch.parts.ra;
    if (!part || !part.userData.low) return;
    part.quaternion.copy(side === "l" ? snap.laQ : snap.raQ);
    part.position.copy(side === "l" ? snap.laP : snap.raP);
    part.userData.low.rotation.copy(side === "l" ? snap.laL : snap.raL);
  }
  function snapTake(ch) {
    snap.ch = ch;
    if (!ch || !ch.parts || !ch.parts.la || !ch.parts.ra || !ch.body || !ch.parts.ra.userData.low) return false;
    snap.raQ.copy(ch.parts.ra.quaternion); snap.raP.copy(ch.parts.ra.position); snap.raL.copy(ch.parts.ra.userData.low.rotation);
    snap.laQ.copy(ch.parts.la.quaternion); snap.laP.copy(ch.parts.la.position); snap.laL.copy(ch.parts.la.userData.low.rotation);
    snap.by = ch.body.rotation.y;
    return true;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(9.99, function () {
    if (snap.live) snapRestore();
    ranUpdate = true;
  });

  function bladeTick(dt) {
    const ch = CBZ.playerChar;
    // the base pose for this frame's hold (see the overlay note above)
    if (!ranUpdate && snap.live) snapRestore();
    ranUpdate = false;
    snap.live = !!(snapTake(ch) && CBZ.tpHandWeapon && CBZ.tpHandWeapon());
    if (bladeRig && bladeRig !== ch) {        // a rig swap: back the neck out of the old one
      if (bladeRig.neck && bladeRig._bladeNeck) bladeRig.neck.rotation.y -= bladeRig._bladeNeck;
      if (bladeRig) bladeRig._bladeNeck = 0;
      bladeK = 0;
    }
    bladeRig = ch || null;
    if (!ch || !ch.body) return;
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    // presenting only: a reload squares the body up to its own work position
    // (holsterprops RELOAD_WORK is body-relative), so the blade eases out
    const on = !!(prop && ch.parts && ch.aimingPose && !R.active && !ch.slidePose && !ch.cuffed &&
      !ch.surrender && !ch.handsUp && !ch.verbHold && !(CBZ.player && CBZ.player.dead) &&
      !(CBZ.fps && CBZ.fps.active) && Math.abs(ch.body.rotation.x) < 0.8 &&
      GH.isLong(prop) && GH.specOf(prop) && GH.specOf(prop).sup);   // the ready solve's own test: its blade and this one agree
    bladeK += ((on ? 1 : 0) - bladeK) * Math.min(1, 8 * (dt || 0.016));
    if (bladeK < 1e-3) bladeK = 0;
    const a = -BLADE * bladeK;                  // negative yaw: the left (+X) shoulder comes forward
    if (bladeK > 0) ch.body.rotation.y = a;
    if (ch.neck) {
      const want = -a * BLADE_NECK;
      ch.neck.rotation.y += want - (ch._bladeNeck || 0);
      ch._bladeNeck = want;
    }
  }

  // 53.9: after fpsmode's own tick (52) so fps.reloading is this frame's, and
  // BEFORE holsterprops (54) so the gun it draws is already canted for the
  // reload rather than a frame behind it.
  CBZ.onAlways(53.9, reloadTick);
  // 53.95: the blade, after the reload clock (a reload squares up too) and
  // before holsterprops aims and seats the gun off this body
  CBZ.onAlways(53.95, bladeTick);
  // 54.6: after holsterprops has finished placing and aiming the gun — the
  // support hand is solved to where the weapon ACTUALLY ended up this frame,
  // which is the whole point.
  CBZ.onAlways(54.6, poseHands);

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
      // the hold solve's own working: how far the first solve missed by,
      // whether the stock was re-placed, and what it missed by in the end
      resid0: seen.resid0, placed: seen.placed, butt: seen.butt,
      slid: seen.slid, residual: seen.residual,
      // the grip frames (CBZ.gunHold): support grip-centre gap and how far
      // it walked back, wrist bends (rad) on both hands
      holdGap: GH.last.supGap, holdSlide: seen.slid ? GH.last.slide : 0,
      supportBend: GH.last.supBend, fireBend: GH.last.fireBend,
      reloading: R.active,
      reloadP: R.p,
    };
  };
})();
