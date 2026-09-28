/* ============================================================
   systems/actorweapons.js - visible actor-carried guns + muzzle sockets.

   City combat, police response, gangs, and prison/city stand-offs should not
   invent their own "shot origin" coordinates. This helper attaches the same
   weapon appearance models to actor hands and exposes a world-space barrel tip.

   It also OWNS gun-away intent: a beat cop's pistol on the belt at 0★ is what
   makes the DRAW an escalation cue, and a stowed gun behind cover is what keeps
   muzzles from poking through walls. actor.armed=false (how police.js ships
   holstering today) and the canonical actor._holstered both read "in the
   leather"; actor._gunLowered / actor._gunHidden (police gun-stops, combat.js
   walled-off stows) read "drawn but away". The per-frame pose pass respects
   ALL of them — its self-heal must never force a deliberately-stowed gun back
   into the hand. Stowing is a visibility flip ONLY: the prop never leaves its
   socket and a re-draw never rebuilds geometry (we're draw-call/alloc bound).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.WEAPON_GROUND_PHYSICS == null) CBZ.CONFIG.WEAPON_GROUND_PHYSICS = true;

  /* ==== CBZ.gunHold — THE BODY'S HANDS CLOSED ON THE GUN'S OWN GRIPS =======
     Owner: "the hands during gun holding [need to be] fixed."

     WHAT WAS WRONG (measured, tools/gun-hold-check.mjs, before this block):
       · the firing hand's ORIENTATION came only from its forearm (fingers
         down the arm, character.js placeBodyHand) while the drawn gun's came
         from the crosshair (holsterprops.js barrel lock). Two unrelated
         rotations: the fist's grip axis sat 16-61 degrees off the pistol grip
         it was meant to be closed round, and its centre 3-9 cm off the grip;
       · the support hand was solved to a POINT (grips.support, a spot under
         the handguard) through the wrist SOCKET, with the hand hanging off the
         forearm at whatever angle — then walked back along the gun when out
         of reach, so on every long gun the off hand ended half a metre behind
         its handguard, palm down, holding the receiver's air;
       · a pistol's support hand had no idea there was a firing fist to cup.

     THE FIX: every grip on a gun is a FRAME — a point on the part's axis, the
     axis itself (which way the thumb runs along it), and the side the back of
     the hand prefers — authored once per weapon from the data it already has
     (the kit's K.hand spec for the firing grip, userData.grips.hold for the
     handguard / foregrip, and for a pistol the firing fist itself, grown by
     the firing fingers' thickness, for the thumbs-forward cup). A body hand
     (fphands' one hand, at its body LOD, sized to the part: trigNN / holdNN)
     is then ORIENTED on that frame — its wrap axis (hand X) along the part,
     tilting toward the forearm and rolling round the part only as far as a
     wrist really gives — and its WRIST is where the arm has to put the
     crease (charArmTo.wrist, with the forearm led in from where the hand
     wants it). Wrist bend is capped; past the cap the forearm is swivelled
     first, and only where the gun is not aim-locked does the gun turn with
     the hand.

     WHO MOVES: the firing hand is where the ARM is and the GUN follows it —
     the gun's orientation is the aim (player presenting) or the forearm (NPC,
     low ready), its position is "grip in the fist". The support hand moves
     to the gun. An NPC's whole two-hand ready pose is solved ONCE per (body,
     gun) in its body frame and copied every frame after (ready() below).
     It lives HERE, beside buildActorWeapon, because every page that puts a
     gun in a body's hands loads this file (the warlord and battle pages load
     no gunhands.js); systems/gunhands.js (player support hand + reload) and
     holsterprops.js (player firing hand) call it.
     Pure maths is on CBZ.gunHold.math for tools/gun-hold-check.mjs. */
  const GH = (function () {
    const BEND_MAX = 0.70;            // rad the wrist may bend off the forearm line (~40°)
    const TILT = { fire: 0.30, guard: 0.45, vgrip: 0.25, cup: 0.30 };   // fist axis off the part axis
    const ROLL = { fire: 0.30, guard: 1.10, vgrip: 0.50, cup: 0.75 };   // round the part, off the preferred side
    const WEB = 0.040;                // m (hand): grip centre below the web / top of a grip
    const FINGERS_THICK = 0.020;      // m (hand): what a cupping hand wraps over the firing fingers

    const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
    const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _m = new THREE.Matrix4();
    /* THE HAND FRAME ON A GRIP. x0 = where the hand's X (its wrap axis) should
       point — along the part, thumb-ward sign already applied for the side;
       n = where the back of the hand would rather face; f = the forearm, wrist
       -> elbow (unit) or null. The fist axis tilts from x0 toward the plane
       square to the forearm by at most `tilt`, then the hand rolls round that
       axis toward the forearm by at most `roll` from n. Writes the rotation to
       outQ, returns the remaining wrist bend (radians between hand +Z, the
       straight-wrist line, and the forearm). */
    function solveFrame(outQ, x0, n, f, tilt, roll) {
      _x.copy(x0).normalize();
      if (f) {
        _t1.copy(_x).addScaledVector(f, -_x.dot(f));
        const l = _t1.length();
        if (l > 1e-6) {
          _t1.multiplyScalar(1 / l);
          const b = Math.acos(Math.max(-1, Math.min(1, _x.dot(_t1))));
          if (b > 1e-6) {
            const s = Math.min(b, tilt) / b;
            _x.multiplyScalar(1 - s).addScaledVector(_t1, s).normalize();
          }
        }
      }
      _y.copy(n).addScaledVector(_x, -n.dot(_x));
      if (_y.lengthSq() < 1e-10) _y.set(0, 1, 0).addScaledVector(_x, -_x.y);
      _y.normalize();
      if (f && roll > 0) {
        _t1.copy(f).addScaledVector(_x, -f.dot(_x));            // the forearm, square to the axis
        if (_t1.lengthSq() > 1e-8) {
          _t1.normalize();
          _t2.crossVectors(_t1, _x).normalize();                  // the back of the hand that puts Z on it
          let th = Math.atan2(_z.crossVectors(_y, _t2).dot(_x), _y.dot(_t2));
          th = Math.max(-roll, Math.min(roll, th));
          _t1.crossVectors(_x, _y);
          _y.multiplyScalar(Math.cos(th)).addScaledVector(_t1, Math.sin(th)).normalize();
        }
      }
      _z.crossVectors(_x, _y);
      _m.makeBasis(_x, _y, _z);
      outQ.setFromRotationMatrix(_m);
      return f ? Math.acos(Math.max(-1, Math.min(1, _z.dot(f)))) : 0;
    }
    /* Turn a hand frame (and anything welded to it) so its straight-wrist line
       comes within `max` of the forearm: dq = the minimal rotation. */
    function clampBend(hq, f, max, dqOut) {
      _z.set(0, 0, 1).applyQuaternion(hq);
      const b = Math.acos(Math.max(-1, Math.min(1, _z.dot(f))));
      dqOut.identity();
      if (b <= max) return b;
      _t1.crossVectors(_z, f);
      const l = _t1.length();
      if (l < 1e-8) return b;
      dqOut.setFromAxisAngle(_t1.multiplyScalar(1 / l), b - max);
      hq.premultiply(dqOut);
      return max;
    }

    /* ---- the grip frames of one weapon, in its own model space ----------
       Cached on the prop: the prop's model never changes shape. */
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    function fireFrom(h, M, sc) {
      const R = h.rake || 0;
      const axis = V(0, Math.cos(R), -Math.sin(R));
      const u = V(1, 0, 0);
      const fwd = V(0, 0, 0).crossVectors(axis, u);
      const n = u.clone().addScaledVector(fwd, -0.22).normalize();
      // the hand's X: down the grip (a right thumb is -X), tilted toward the
      // kit's diagonal heading where it has one (the shotgun's steep wrist)
      const x0 = axis.clone().negate();
      let used = 0;
      if (h.heading) {
        const hd = V(h.heading[0], h.heading[1], h.heading[2]);
        const zz = hd.addScaledVector(n, -hd.dot(n)).normalize().negate();
        const xx = V(0, 0, 0).crossVectors(n, zz);
        const b = Math.acos(Math.max(-1, Math.min(1, xx.dot(x0))));
        used = Math.min(b, 0.18);
        if (b > 1e-6) x0.multiplyScalar(1 - used / b).addScaledVector(xx, used / b).normalize();
      }
      const top = V(0, h.at[0], h.at[1]);
      const out = {
        top: top.applyMatrix4(M), axis: axis.transformDirection(M), u: u.transformDirection(M),
        fwd: fwd.transformDirection(M), n: n.transformDirection(M), x0: x0.transformDirection(M),
        hw: h.gripW * 0.5 * sc, hh: h.gripD * 0.5 * sc, tilt: Math.max(0.05, TILT.fire - used),
      };
      return out;
    }
    function specOf(prop) {
      const ud = prop && prop.userData;
      if (!ud) return null;
      if (ud._holdSpec !== undefined) return ud._holdSpec;
      let owner = null;
      prop.traverse(function (o) { if (!owner && o.userData && o.userData.fireGrip) owner = o; });
      // owner -> prop matrix (the taser builds its grip inside a scaled group)
      const M = new THREE.Matrix4();
      let sc = 1;
      for (let o = owner; o && o !== prop; o = o.parent) {
        o.updateMatrix();
        M.premultiply(o.matrix);
        sc *= o.scale.x || 1;
      }
      let fire = null;
      if (owner) fire = fireFrom(owner.userData.fireGrip, M, sc);
      else if (!ud.weaponMelee && ud.weaponId) {
        // the unknown-id fallback gun: its grip box, 0.2 rad rake
        fire = fireFrom({ at: [-0.04, -0.02], rake: 0.2, gripW: 0.12, gripD: 0.12 }, M, 1);
      }
      const g = ud.grips, hold = g && g.hold;
      let sup = null;
      if (g && g.support === null) sup = null;                              // one-handed (the taser)
      else if (hold && hold.kind === "guard") {
        sup = { kind: "guard", o: V(0, hold.y, hold.z + (hold.slide == null ? 0.03 : hold.slide)),
          axis: V(0, 0, -1), n: V(-0.30, -1, 0).normalize(), hw: hold.w / 2, hh: hold.h / 2 };
        sup.x0 = sup.axis.clone();                                          // a LEFT thumb runs forward: +X
      } else if (hold && hold.kind === "vgrip") {
        const ax = V(0, Math.cos(hold.rake || 0), -Math.sin(hold.rake || 0)), u = V(1, 0, 0);
        const fwd = V(0, 0, 0).crossVectors(ax, u);
        sup = { kind: "vgrip", o: V(0, hold.y, hold.z), axis: ax, x0: ax.clone(),
          n: u.clone().negate().addScaledVector(fwd, -0.22).normalize(), hw: hold.w / 2, hh: hold.d / 2 };
      } else if (fire && g && g.support) {
        // THUMBS FORWARD on a pistol: the off hand wraps the firing fist
        sup = { kind: "cup", o: fire.top.clone(), axis: fire.axis.clone(), x0: fire.axis.clone(),
          n: fire.u.clone().negate().addScaledVector(fire.fwd, -0.30).normalize(), hw: fire.hw, hh: fire.hh };
      } else if (g && g.support) {
        // authored point only: a handguard just above it, along the bore
        sup = { kind: "guard", o: g.support.clone().add(V(0, 0.04, 0)), axis: V(0, 0, -1),
          n: V(-0.30, -1, 0).normalize(), hw: 0.04, hh: 0.04 };
        sup.x0 = sup.axis.clone();
      }
      const spec = fire ? { fire, sup } : null;
      ud._holdSpec = spec;
      return spec;
    }
    /* Body-dependent numbers (k = model units per hand metre): the grip
       centres on each part and the pose that wraps each part. Cached on the
       spec for the last hand size asked (a prop lives in one body's hand). */
    function sized(spec, k) {
      if (spec._k === k) return spec._z;
      const H = CBZ.fpHands;
      const f = spec.fire, s = spec.sup;
      const z = spec._z || { fc: new THREE.Vector3(), sc: new THREE.Vector3(), fPose: "pistol", sPose: "support" };
      z.fc.copy(f.top).addScaledVector(f.axis, -WEB * k);
      z.fPose = H && H.holdPose ? H.holdPose("trig", Math.sqrt(f.hw * f.hh) / k) : "pistol";
      if (s) {
        if (s.kind === "cup") {
          z.sc.copy(z.fc).addScaledVector(s.axis, -0.012 * k);
          z.sPose = H && H.holdPose ? H.holdPose("hold", Math.sqrt((s.hw / k + FINGERS_THICK) * (s.hh / k + FINGERS_THICK * 0.8))) : "cupover";
        } else {
          z.sc.copy(s.o);
          if (s.kind === "vgrip") z.sc.addScaledVector(s.axis, -(WEB + 0.010) * k);
          z.sPose = H && H.holdPose ? H.holdPose("hold", Math.sqrt(s.hw * s.hh) / k) : "support";
        }
      }
      spec._k = k; spec._z = z;
      return z;
    }
    const _gc = new THREE.Vector3();
    function gripCentreOf(pose, side, out) {
      const H = CBZ.fpHands;
      if (H && H.gripCentre) H.gripCentre(pose, out); else out.set(-0.006, -0.034, -0.086);
      if (side < 0) out.x = -out.x;
      return out;
    }
    const handOf = (ch, side) => {
      const part = ch && ch.parts && (side < 0 ? ch.parts.la : ch.parts.ra);
      const cap = part && part.userData && part.userData.cap;
      return cap && cap.userData && cap.userData.fit ? cap : null;
    };

    /* ---- THE FIRING HAND: the fist where the arm is, the gun in the fist --
       aimed = the gun's world orientation is the aim (player presenting): it
       never turns; the arm swivels instead. Otherwise the gun turns with the
       fist when the wrist would have to bend past the cap. */
    const _gq = new THREE.Quaternion(), _lq = new THREE.Quaternion(), _hq = new THREE.Quaternion();
    const _dq = new THREE.Quaternion(), _pq = new THREE.Quaternion();
    const _f = new THREE.Vector3(), _x0 = new THREE.Vector3(), _n = new THREE.Vector3();
    const _w = new THREE.Vector3(), _c = new THREE.Vector3(), _o = new THREE.Vector3(), _s = new THREE.Vector3();
    const last = { fireBend: 0, supBend: 0, supGap: 0, slide: 0 };
    function frameFire(spec, low) {
      low.getWorldQuaternion(_lq);
      _f.set(0, 1, 0).applyQuaternion(_lq);
      _x0.copy(spec.fire.x0).applyQuaternion(_gq);
      _n.copy(spec.fire.n).applyQuaternion(_gq);
      return solveFrame(_hq, _x0, _n, _f, spec.fire.tilt, ROLL.fire);
    }
    function fire(ch, prop, aimed, lift) {
      const spec = specOf(prop), hand = handOf(ch, 1);
      if (!spec || !hand || !prop.parent) return null;
      const fit = hand.userData.fit, low = hand.parent;
      const z = sized(spec, fit.s / (prop.scale.x || 1));
      if (ch.setHandPose) ch.setHandPose("r", z.fPose);
      prop.getWorldQuaternion(_gq);
      frameFire(spec, low);
      // The wrist stays where the arm has it (plus the ground-rest lift, which
      // rides the arm); the ELBOW swings round so the forearm arrives along
      // the hand's own straight-wrist line. Every frame, not "when the bend is
      // bad": a switch on a threshold flickers.
      CBZ.charArmTo.crease(ch, "r", _w);
      if (lift) _w.y += lift;
      _s.set(0, 0, 1).applyQuaternion(_hq);
      CBZ.charArmTo.wrist(ch, _w, "r", _s, 1);
      let bend = frameFire(spec, low);
      if (aimed && bend > BEND_MAX - 0.10) {
        /* The barrel is locked to the aim, so the wrist has to come to the
           gun: move the WRIST to where the forearm arrives along the hand's
           straight-wrist line (elbow on the upper arm's sphere, as near the
           current elbow as it can be), only as far as the cap needs. The gun
           rides the fist there — translation never touches the aim. */
        const part = ch.parts.ra;
        for (let it = 0; it < 4 && bend > BEND_MAX - 0.10; it++) {
          low.updateWorldMatrix(true, false);
          _s.setFromMatrixScale(low.matrixWorld);
          const l1 = -low.position.y * _s.x, l2 = -fit.wristY * _s.x;
          CBZ.charArmTo.crease(ch, "r", _w);
          part.getWorldPosition(_o);                      // the shoulder
          _c.set(0, 0, 1).applyQuaternion(_hq);           // the hand's own forearm line
          _x0.copy(_w).addScaledVector(_c, l2).sub(_o).normalize();
          _n.copy(_o).addScaledVector(_x0, l1).addScaledVector(_c, -l2);   // wrist with a straight wrist
          // continuous in the bend (a step here flickers frame to frame)
          _w.lerp(_n, Math.min(1, (bend - (BEND_MAX - 0.10)) / bend * 1.5));
          CBZ.charArmTo.wrist(ch, _w, "r", _c, 1);
          bend = frameFire(spec, low);
        }
      }
      if (!aimed && bend > BEND_MAX) {
        bend = clampBend(_hq, _f, BEND_MAX, _dq);
        _gq.premultiply(_dq);                         // the gun turns with the fist
      }
      last.fireBend = bend;
      // the hand: at the crease, on the frame
      hand.quaternion.copy(_lq).invert().multiply(_hq);
      hand.position.set(0, fit.wristY, 0);
      // the gun: its grip centre in the fist's
      hand.updateMatrixWorld(true);
      gripCentreOf(z.fPose, 1, _c);
      hand.localToWorld(_c);
      prop.parent.updateWorldMatrix(true, false);
      prop.parent.matrixWorld.decompose(_w, _pq, _s);
      const ps = (prop.scale.x || 1) * _s.x;
      _o.copy(z.fc).multiplyScalar(ps).applyQuaternion(_gq);
      _w.copy(_c).sub(_o);
      prop.parent.worldToLocal(_w);
      prop.position.copy(_w);
      prop.quaternion.copy(_pq.invert()).multiply(_gq);
      return bend;
    }

    /* ---- GRIP-TO-BUTT, in model units, off the weapon's own geometry --------
       The shared model convention runs the barrel down -Z from a grip at the
       origin, so the +Z extent IS the buttpad. Measured once per prop from its
       LOCAL bounds (a world box would rotate with the aim). */
    const _bb = new THREE.Box3(), _bbInv = new THREE.Matrix4(), _bbM = new THREE.Matrix4();
    function stockZ(prop) {
      const ud = prop.userData;
      if (ud._stockZ != null) return ud._stockZ;
      // a launcher whose tube runs on past the shoulder (the RPG-7's venturi
      // sits half a metre behind the man) names its own shoulder point
      if (ud.shoulderZ != null) return (ud._stockZ = ud.shoulderZ / (prop.scale.x || 1));
      prop.updateWorldMatrix(true, true);
      _bbInv.copy(prop.matrixWorld).invert();
      let maxZ = 0;
      prop.traverse(function (o) {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        _bb.copy(o.geometry.boundingBox);
        _bbM.multiplyMatrices(_bbInv, o.matrixWorld);
        _bb.applyMatrix4(_bbM);
        if (_bb.max.z > maxZ) maxZ = _bb.max.z;
      });
      // prop space is pre-scale: model units = this / prop.scale
      ud._stockZ = maxZ / (prop.scale.x || 1);
      return ud._stockZ;
    }

    /* ---- NPC READY: BOTH HANDS ON THE GUN, SOLVED ONCE, THEN COPIED --------
       The old ready pose was a table of Euler angles with the barrel run down
       the forearm: every NPC long gun was held out at arm's length like a
       pistol, its handguard a metre from the off shoulder (the off hand
       "held" it 25 cm behind, in the air), and a pistol's cup hand fell 18 cm
       short. An NPC's ready pose is FIXED in its own body frame (setReadyPose
       writes absolute angles and nothing aims the pitch), so the right answer
       is also fixed there — solve it once per (body, gun) with the same
       machinery the player uses, cache the joint values, and copy them:
         · a LONG gun is shouldered: the body BLADED (support shoulder forward,
           the neck turned back onto the sights), the butt at the shoulder
           pocket toward the chest, the barrel straight down-range;
         · a PISTOL is a two-hand isosceles at the chest, pushed inboard so the
           cup hand can meet it;
         · the firing arm is solved so the fist wraps the grip, the gun seated
           in it; the off arm is solved onto the handguard / foregrip / fist.
       Per frame this is copies — no solve, for every armed NPC, not a
       budgeted few. */
    const BLADE = 0.60, BLADE_NECK = 0.85;
    const PISTOL_AT = new THREE.Vector3(0, -0.21, 0.56);    // body units, off the inboard shoulder point
    const _rd = new THREE.Vector3(), _ro = new THREE.Vector3(), _rc = new THREE.Vector3();
    const _rbq = new THREE.Quaternion(), _rwq = new THREE.Quaternion(), _rm = new THREE.Matrix4();
    const _r0 = new THREE.Vector3(0, 0, 0), _rUp = new THREE.Vector3(0, 1, 0), _rX = new THREE.Vector3(1, 0, 0), _rpa = new THREE.Vector3();
    function seatProp(prop, worldPos, worldQ) {
      prop.parent.updateWorldMatrix(true, false);
      prop.parent.getWorldQuaternion(_pq);
      prop.quaternion.copy(_pq.invert()).multiply(worldQ);
      prop.position.copy(worldPos);
      prop.parent.worldToLocal(prop.position);
    }
    function solveReady(ch, prop, spec, C, pitch) {
      const elev = -(pitch || 0);                                // combat's convention: negative pitch = barrel up
      const body = ch.body, ra = ch.parts.ra, la = ch.parts.la;
      const hr = handOf(ch, 1), fit = hr.userData.fit;
      const z = sized(spec, fit.s / (prop.scale.x || 1));
      const stock = stockZ(prop) * (prop.scale.x || 1);        // rig (body) units
      const long = stock > 0.26;
      const blade = long ? BLADE : 0;
      ra.position.z = 0; la.position.z = 0;
      if (CBZ.charArmTo.rest) { CBZ.charArmTo.rest(ch, "r", 0); CBZ.charArmTo.rest(ch, "l", 0); }
      // the gun in the BODY frame: down-range once the body is bladed
      _rd.set(Math.sin(blade) * Math.cos(elev), Math.sin(elev), Math.cos(blade) * Math.cos(elev));
      _rm.lookAt(_r0, _rd, _rUp);
      _rbq.setFromRotationMatrix(_rm);
      let fireBend = 0;
      const low = hr.parent;
      const attempt = function (pull, inb) {
        // every attempt starts from the same hanging arms, so the answer is a
        // function of the body and the gun alone
        ra.position.z = 0; la.position.z = 0;
        ra.quaternion.identity(); la.quaternion.identity();
        ra.userData.low.rotation.set(-0.2, 0, 0); la.userData.low.rotation.set(-0.2, 0, 0);
        _ro.lerpVectors(ra.position, la.position, long ? 0.38 : inb);
        // the butt sits IN the shoulder pocket — on the chest's front surface,
        // not at the shoulder joint's centre inside the torso
        if (long) { _ro.y -= 0.07; _ro.z = ((ch.profile && ch.profile.torsoD) || 0.5) * 0.5; _ro.addScaledVector(_rd, stock); }
        else {
          // the arms swing up/down from the shoulders — but a pistol lowered
          // stays out in FRONT (the shoulders protract), or both straight arms
          // would cut through the chest's corners on the way to it
          _rpa.copy(PISTOL_AT).applyAxisAngle(_rX, -elev);
          if (_rpa.z < PISTOL_AT.z) _rpa.z = PISTOL_AT.z;
          _ro.add(_rpa);
          // a compact's support grip ahead of the fist (the Uzi's receiver):
          // the gun comes back toward the chest by that much
          const ahead = spec.sup ? -z.sc.z * (prop.scale.x || 1) : 0;
          if (ahead > 0.09) _ro.addScaledVector(_rd, -(ahead - 0.09) * pull);
        }
        body.updateWorldMatrix(true, false);
        body.getWorldQuaternion(_rwq);
        _rwq.multiply(_rbq);                                      // gun, world
        _gq.copy(_rwq);
        _rc.copy(z.fc).multiplyScalar(prop.scale.x || 1).applyQuaternion(_rbq).add(_ro);
        body.localToWorld(_rc);                                   // the grip centre, world
        body.localToWorld(_ro);
        seatProp(prop, _ro, _rwq);
        // the firing arm to the grip, the forearm led in along the fist
        gripCentreOf(z.fPose, 1, _gc);
        if (ch.setHandPose) ch.setHandPose("r", z.fPose);
        for (let i = 0; i < 3; i++) {
          _gq.copy(_rwq);
          frameFire(spec, low);
          low.updateWorldMatrix(true, false);
          _s.setFromMatrixScale(low.matrixWorld);
          _w.copy(_gc).multiplyScalar(fit.s * _s.x).applyQuaternion(_hq);
          _w.subVectors(_rc, _w);
          _s.set(0, 0, 1).applyQuaternion(_hq);
          CBZ.charArmTo.wrist(ch, _w, "r", _s, 1);
        }
        seatProp(prop, _ro, _rwq);
        fire(ch, prop, true, 0);                                  // fist on the grip, gun in the fist, still down-range
        fireBend = last.fireBend;
        return supportLand(ch, prop, 1, 0.03, 4, null);
      };
      // a two-hand pistol / compact whose support grip is hard to reach: try
      // the gun a little further inboard and (a compact) back toward the
      // chest, and keep the best hold the firing wrist can live with
      let gap = attempt(0.25, 0.42);
      if (!long && spec.sup && gap != null && gap > 0.015) {
        let best = { gap: gap, pull: 0.25, inb: 0.42 };
        const ahead = -z.sc.z * (prop.scale.x || 1) > 0.09;
        for (const inb of [0.42, 0.5, 0.56, 0.62]) {
          for (const pull of ahead ? [0.25, 0.5, 0.75, 1, 1.25, 1.5] : [0]) {
            if (inb === 0.42 && pull === 0.25) continue;
            const g = attempt(pull, inb);
            const chest = CBZ.charArmTo.inChest ? CBZ.charArmTo.inChest(ch, "l") + CBZ.charArmTo.inChest(ch, "r") : 0;
            if (g != null && fireBend <= BEND_MAX + 0.005 && !chest && g < best.gap - 0.002) best = { gap: g, pull: pull, inb: inb };
          }
        }
        gap = attempt(best.pull, best.inb);
      }
      C = C || { raQ: new THREE.Quaternion(), laQ: new THREE.Quaternion(), raL: new THREE.Vector3(), laL: new THREE.Vector3(),
        hrQ: new THREE.Quaternion(), hrP: new THREE.Vector3(), hlQ: new THREE.Quaternion(), hlP: new THREE.Vector3(),
        gQ: new THREE.Quaternion(), gP: new THREE.Vector3() };
      const lowR = ra.userData.low, lowL = la.userData.low, hl = handOf(ch, -1);
      C.s = fit.s; C.blade = blade; C.fPose = z.fPose; C.sPose = spec.sup ? z.sPose : null;
      C.raQ.copy(ra.quaternion); C.raZ = ra.position.z; C.raL.set(lowR.rotation.x, lowR.rotation.y, lowR.rotation.z);
      C.laQ.copy(la.quaternion); C.laZ = la.position.z; C.laL.set(lowL.rotation.x, lowL.rotation.y, lowL.rotation.z);
      C.hrQ.copy(hr.quaternion); C.hrP.copy(hr.position);
      if (hl) { C.hlQ.copy(hl.quaternion); C.hlP.copy(hl.position); }
      C.gQ.copy(prop.quaternion); C.gP.copy(prop.position);
      C.fireBend = fireBend; C.supBend = last.supBend; C.supGap = gap; C.slide = last.slide;
      C.hasSupport = !!(spec.sup && hl && gap != null);
      return C;
    }
    // the neck counter-turn of a bladed body: a baked offset, backed out when
    // the ready pose stops being asked for (a timeout, so a throttled caller —
    // the warlord battle re-poses engaged men every few frames — does not
    // flicker it)
    const bladed = new Set();
    let readyClock = 0;
    function bakeNeck(ch, want) {
      if (!ch.neck) return;
      ch.neck.rotation.y += want - (ch._bladeNeck || 0);
      ch._bladeNeck = want;
      if (want) { bladed.add(ch); ch._readyAt = readyClock; }
    }
    function readyDecay(dt) {
      readyClock += dt || 0.016;
      if (!bladed.size) return;
      bladed.forEach(function (ch) {
        if (readyClock - (ch._readyAt || 0) < 0.4) return;
        const w = (ch._bladeNeck || 0) * Math.max(0, 1 - 8 * (dt || 0.016));
        bakeNeck(ch, Math.abs(w) < 1e-3 ? 0 : w);
        if (!ch._bladeNeck) bladed.delete(ch);
      });
    }
    /* ready(ch, prop, arms): arms = true poses both arms + the blade (the ready
       pose); false seats only the gun in the right fist (the gun is out but
       the arms belong to someone else this frame). */
    const READY = new Map();
    const r4 = (v) => Math.round(v * 1e4);
    function readyKey(ch, prop, hr) {
      const ra = ch.parts.ra, la = ch.parts.la, fit = hr.userData.fit, P = ch.profile || {};
      const sk = ch.sockets || {}, rh = sk.rightHand, tw = sk.thirdPersonWeapon;
      return [prop.userData.weaponId, r4(prop.scale.x), r4(fit.s), r4(fit.wristY), r4(ra.userData.low.position.y),
        r4(la.userData.low.position.y), r4(ra.position.x), r4(ra.position.y), r4(la.position.x), r4(la.position.y),
        r4(P.torsoD || 0), r4(P.torsoW || 0), r4(P.waistD || 0),
        rh ? r4(rh.position.y) + ":" + r4(rh.position.z) : "", tw ? r4(tw.position.x) + ":" + r4(tw.position.y) + ":" + r4(tw.position.z) : ""].join("|");
    }
    // the cached solve for this body + gun at one pitch level (0.05 rad steps)
    const PITCH_STEP = 0.05;
    function getReady(ch, prop, spec, hr, level, arms) {
      const key = readyKey(ch, prop, hr) + "|" + level;
      let C = READY.get(key);
      if (C) return C;
      // the solve poses the arms; a seat-only caller gets them back
      const keep = arms ? null : [ch.parts.ra.quaternion.clone(), ch.parts.ra.position.z, ch.parts.ra.userData.low.rotation.clone(),
        ch.parts.la.quaternion.clone(), ch.parts.la.position.z, ch.parts.la.userData.low.rotation.clone()];
      C = solveReady(ch, prop, spec, null, level * PITCH_STEP);
      if (keep) {
        ch.parts.ra.quaternion.copy(keep[0]); ch.parts.ra.position.z = keep[1]; ch.parts.ra.userData.low.rotation.copy(keep[2]);
        ch.parts.la.quaternion.copy(keep[3]); ch.parts.la.position.z = keep[4]; ch.parts.la.userData.low.rotation.copy(keep[5]);
      }
      if (READY.size > 1024) READY.clear();
      READY.set(key, C);
      return C;
    }
    const _bq = new THREE.Quaternion(), _bv = new THREE.Vector3();
    // write a solved ready pose (B, t: blended toward a neighbouring pitch level)
    function applyReady(ch, prop, A, B, t, arms) {
      const hr = handOf(ch, 1), ra = ch.parts.ra, la = ch.parts.la;
      const k = B && t > 0 ? t : 0;
      if (ch.setHandPose) ch.setHandPose("r", A.fPose);
      hr.quaternion.copy(A.hrQ); if (k) hr.quaternion.slerp(B.hrQ, k);
      hr.position.copy(A.hrP); if (k) hr.position.lerp(B.hrP, k);
      prop.quaternion.copy(A.gQ); if (k) prop.quaternion.slerp(B.gQ, k);
      prop.position.copy(A.gP); if (k) prop.position.lerp(B.gP, k);
      last.fireBend = A.fireBend + ((B ? B.fireBend : A.fireBend) - A.fireBend) * k;
      if (!arms) return;
      ra.quaternion.copy(A.raQ); if (k) ra.quaternion.slerp(B.raQ, k);
      ra.position.z = A.raZ + ((B ? B.raZ : A.raZ) - A.raZ) * k;
      _bv.copy(A.raL); if (k) _bv.lerp(B.raL, k);
      ra.userData.low.rotation.set(_bv.x, _bv.y, _bv.z);
      if (A.hasSupport && (!k || B.hasSupport)) {
        la.quaternion.copy(A.laQ); if (k) la.quaternion.slerp(B.laQ, k);
        la.position.z = A.laZ + ((B ? B.laZ : A.laZ) - A.laZ) * k;
        _bv.copy(A.laL); if (k) _bv.lerp(B.laL, k);
        la.userData.low.rotation.set(_bv.x, _bv.y, _bv.z);
        const hl = handOf(ch, -1);
        if (ch.setHandPose) ch.setHandPose("l", A.sPose);
        hl.quaternion.copy(A.hlQ); if (k) hl.quaternion.slerp(B.hlQ, k);
        hl.position.copy(A.hlP); if (k) hl.position.lerp(B.hlP, k);
        last.supBend = A.supBend; last.supGap = A.supGap; last.slide = A.slide;
      } else if (ch.setHandPose) ch.setHandPose("l", "relaxed");     // one-handed: the off hand is free
      if (A.blade) ch.body.rotation.y = -A.blade;
      bakeNeck(ch, A.blade * BLADE_NECK);
    }
    function readyOk(ch, prop) {
      return !!(specOf(prop) && handOf(ch, 1) && prop.parent && ch.parts && ch.parts.ra && ch.parts.la && ch.body &&
        CBZ.charArmTo && CBZ.charArmTo.wrist);
    }
    function ready(ch, prop, arms) {
      if (!readyOk(ch, prop)) return false;
      const hr = handOf(ch, 1);
      let C = prop.userData._ready;
      if (!C || prop.userData._readyCh !== ch || C.s !== hr.userData.fit.s) {
        // The answer depends on the body's arm geometry and the gun, not on
        // who the body is: every cop of one build with one pistol shares it,
        // so a squad spawning at once solves once.
        C = getReady(ch, prop, specOf(prop), hr, 0, arms);
        prop.userData._ready = C;
        prop.userData._readyCh = ch;
        if (prop.userData._readyLv) prop.userData._readyLv.clear();
      }
      applyReady(ch, prop, C, null, 0, arms);
      return true;
    }
    /* The ready pose PITCHED onto a target above or below (city/combat.js NPC
       aim elevation; negative = barrel up, its old rotation.x convention).
       Each pitch level is its own full solve — a long gun pivots in the
       shoulder pocket, a pistol's arms swing from the shoulders, the elbows
       stay out of the chest, the off hand re-lands — cached like the level
       pose and blended between neighbouring levels, so a tracking NPC's
       hands never leave the gun. */
    function pitchNpc(ch, prop, pitch) {
      if (!ready(ch, prop, true)) return false;
      if (!(Math.abs(pitch) > 1e-4)) return true;
      const hr = handOf(ch, 1), spec = specOf(prop);
      const p = Math.max(-0.75, Math.min(0.75, pitch)) / PITCH_STEP;
      const lo = Math.floor(p), t = p - lo;
      // this prop's own level table first: a tracking NPC looks its levels up
      // every frame, and the shared key is a string
      const L = prop.userData._readyLv || (prop.userData._readyLv = new Map());
      let A = L.get(lo);
      if (!A) { A = getReady(ch, prop, spec, hr, lo, true); L.set(lo, A); }
      let B = null;
      if (t > 1e-3) { B = L.get(lo + 1); if (!B) { B = getReady(ch, prop, spec, hr, lo + 1, true); L.set(lo + 1, B); } }
      applyReady(ch, prop, A, B, t, true);
      return true;
    }

    /* ---- THE SUPPORT HAND: to the gun ---------------------------------------
       slide 0..1 walks a handguard grip back toward the firing grip (the
       honest fallback when the handguard is out of the arm's reach). The
       frame and the arm are solved against each other a few rounds: the hand
       rolls toward the forearm, the forearm is led in along the hand. Returns
       the metres between the hand's grip centre and the grip. */
    const _cw = new THREE.Vector3(), _gcw = new THREE.Vector3();
    function supportTarget(spec, z, prop, slide, out) {
      out.copy(z.sc);
      // back ALONG THE BORE LINE, under the gun, to just ahead of the firing
      // hand — the hand stays on the weapon's underside the whole way
      // (a foregrip out of reach: the hand takes the tube behind it the same way)
      if (slide > 0 && spec.sup.kind !== "cup") out.z += (Math.max(out.z, z.fc.z - 0.11 * spec._k) - out.z) * slide;
      return prop.localToWorld(out);
    }
    function frameSupport(spec, low) {
      low.getWorldQuaternion(_lq);
      _f.set(0, 1, 0).applyQuaternion(_lq);
      _x0.copy(spec.sup.x0).applyQuaternion(_gq);
      _n.copy(spec.sup.n).applyQuaternion(_gq);
      return solveFrame(_hq, _x0, _n, _f, TILT[spec.sup.kind], ROLL[spec.sup.kind]);
    }
    function support(ch, prop, blend, slide, rounds, floorY) {
      const spec = specOf(prop), hand = handOf(ch, -1);
      if (!spec || !spec.sup || !hand || !CBZ.charArmTo || !CBZ.charArmTo.wrist) return null;
      const fit = hand.userData.fit, low = hand.parent;
      const z = sized(spec, fit.s / (prop.scale.x || 1));
      if (ch.setHandPose) ch.setHandPose("l", z.sPose);
      prop.updateWorldMatrix(true, false);
      prop.getWorldQuaternion(_gq);
      supportTarget(spec, z, prop, slide || 0, _cw);
      if (floorY != null && _cw.y < floorY) _cw.y = floorY;
      gripCentreOf(z.sPose, -1, _gc);
      low.updateWorldMatrix(true, false);
      _s.setFromMatrixScale(low.matrixWorld);
      const sw = fit.s * _s.x;
      let bend = 0;
      for (let i = 0, n = rounds || 3; i < n; i++) {
        bend = frameSupport(spec, low);
        // a wrist that would bend past the cap gives at the wrist, and the
        // ARM carries the grip centre back onto the part
        if (bend > BEND_MAX) bend = clampBend(_hq, _f, BEND_MAX, _dq);
        _w.copy(_gc).multiplyScalar(sw).applyQuaternion(_hq);
        _w.subVectors(_cw, _w);                            // where the wrist must be
        _s.set(0, 0, 1).applyQuaternion(_hq);
        CBZ.charArmTo.wrist(ch, _w, "l", _s, blend == null ? 1 : blend);
      }
      bend = frameSupport(spec, low);
      if (bend > BEND_MAX) bend = clampBend(_hq, _f, BEND_MAX, _dq);
      hand.quaternion.copy(_lq).invert().multiply(_hq);
      hand.position.set(0, fit.wristY, 0);
      hand.updateMatrixWorld(true);
      _gcw.copy(_gc);
      hand.localToWorld(_gcw);
      last.supBend = bend;
      last.supGap = _gcw.distanceTo(_cw);
      return last.supGap;
    }
    /* Walk a handguard grip back toward the receiver until the arm lands it
       (bisection on the measured gap: no reach model to be wrong). */
    function supportLand(ch, prop, blend, tol, steps, floorY) {
      last.slide = 0;
      let gap = support(ch, prop, blend, 0, 3, floorY);
      const spec = specOf(prop);
      if (gap == null || gap <= tol || !spec.sup || spec.sup.kind === "cup") return gap;
      let lo = 0, hi = 1;
      for (let i = 0; i < steps; i++) {
        const mid = (lo + hi) / 2;
        const g = support(ch, prop, blend, mid, 2, floorY);
        if (g != null && g > tol) lo = mid; else hi = mid;
      }
      last.slide = hi;
      return support(ch, prop, blend, hi, 3, floorY);
    }
    /* The hand's rest frame under the forearm (character.js placeBodyHand's
       hold basis) — what a reload blends toward while it carries the hand
       off the gun. */
    const REST_L = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(1, 0, 0), V(0, 1, 0)));
    function supportOrient(ch, prop, w) {
      const spec = specOf(prop), hand = handOf(ch, -1);
      if (!spec || !spec.sup || !hand) return;
      const fit = hand.userData.fit;
      const z = sized(spec, fit.s / (prop.scale.x || 1));
      if (ch.setHandPose) ch.setHandPose("l", z.sPose);
      prop.getWorldQuaternion(_gq);
      let bend = frameSupport(spec, hand.parent);
      if (bend > BEND_MAX) clampBend(_hq, _f, BEND_MAX, _dq);
      hand.quaternion.copy(_lq).invert().multiply(_hq);
      if (w > 0) hand.quaternion.slerp(REST_L, Math.min(1, w));
      hand.position.set(0, fit.wristY, 0);
    }
    // where the support hand's grip is on this gun, world (for reach tests / floors)
    function supportPoint(ch, prop, out) {
      const spec = specOf(prop), hand = handOf(ch, -1);
      if (!spec || !spec.sup || !hand) return prop.localToWorld(out.set(0, 0, 0));
      const z = sized(spec, hand.userData.fit.s / (prop.scale.x || 1));
      prop.updateWorldMatrix(true, false);
      return prop.localToWorld(out.copy(z.sc));
    }
    return {
      fire, ready, pitchNpc, readyDecay, support, supportLand, supportOrient, supportPoint, specOf, stockZ, last,
      BEND_MAX, TILT, ROLL, BLADE, BLADE_NECK,
      math: { solveFrame, clampBend, sized, gripCentreOf },
    };
  })();
  CBZ.gunHold = GH;

  const NAME_TO_ID = {
    Pistol: "sidearm",
    pistol: "sidearm",
    Sidearm: "sidearm",
    sidearm: "sidearm",
    Gun: "sidearm",
    gun: "sidearm",
    SMG: "smg",
    smg: "smg",
    Carbine: "carbine",
    carbine: "carbine",
    Rifle: "carbine",
    rifle: "carbine",
    Shotgun: "shotgun",
    shotgun: "shotgun",
    Taser: "taser",
    taser: "taser",
    Revolver: "revolver", revolver: "revolver",
    "Desert Eagle": "deagle", deagle: "deagle",
    Uzi: "uzi", uzi: "uzi",
    "AK-47": "ak47", ak47: "ak47",   // the status rifle gets its OWN model (wood + banana mag) — it must be recognizable in NPC hands
    Sniper: "sniper", sniper: "sniper",
    LMG: "lmg", lmg: "lmg",
    // MELEE. Without these rows the fall-through below hands a 9 mm pistol to
    // anyone carrying a blade — "Shiv" is the name nine years of prison loot
    // tables use, "Shank" is what the weapon row calls itself, and both have
    // to land on the same model or an inmate frisked for a shiv draws a Glock.
    Shank: "shank", shank: "shank",
    Shiv: "shank", shiv: "shank",
  };

  const mat = {
    dark: new THREE.MeshLambertMaterial({ color: 0x161a20 }),
    black: new THREE.MeshLambertMaterial({ color: 0x080a0c }),
    bore: new THREE.MeshLambertMaterial({ color: 0x010203 }),
    steel: new THREE.MeshLambertMaterial({ color: 0x48515c }),
    worn: new THREE.MeshLambertMaterial({ color: 0x747f8c }),
    tan: new THREE.MeshLambertMaterial({ color: 0x8b6a42 }),
    polymer: new THREE.MeshLambertMaterial({ color: 0x232a24 }),
    brass: new THREE.MeshLambertMaterial({ color: 0xd6a33b }),
    redShell: new THREE.MeshLambertMaterial({ color: 0x9d2523 }),
    skin: new THREE.MeshLambertMaterial({ color: 0x161a20 }),
  };
  Object.keys(mat).forEach((k) => { mat[k]._shared = true; });

  // geometry cache: every armed actor rebuilds the same 8-24 boxes/cylinders
  // per weapon model — cops spawn in bursts, so uncached geometry was pure GC
  // churn (every other geometry factory in the repo caches; this one didn't).
  const GEO = new Map();
  function boxGeo(sx, sy, sz) {
    const k = "b" + sx + "," + sy + "," + sz;
    let g = GEO.get(k);
    if (!g) { g = new THREE.BoxGeometry(sx, sy, sz); g._shared = true; GEO.set(k, g); }
    return g;
  }
  function cylGeo(r, len) {
    const k = "c" + r + "," + len;
    let g = GEO.get(k);
    if (!g) { g = new THREE.CylinderGeometry(r, r, len, 12); g._shared = true; GEO.set(k, g); }
    return g;
  }

  function box(parent, sx, sy, sz, material, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(boxGeo(sx, sy, sz), material);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  function cyl(parent, r, len, material, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(cylGeo(r, len), material);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  function normalizeWeaponId(name) {
    if (!name) return "sidearm";
    const direct = CBZ.weaponById && CBZ.weaponById(name);
    const id = direct ? (direct.id || direct.key)
      : (NAME_TO_ID[name] || NAME_TO_ID[String(name).toLowerCase()]);
    /* PRISON_SHANK=0 means "give me the body this game had before the shank",
       and that body INCLUDED the bug the missing row was hiding: with no entry
       for a blade name, the fall-through below answered "sidearm", so asking
       this function what a shiv looks like handed back a 9 mm pistol. The
       revert has to reproduce that too, or the flag's off-side is a world that
       never existed and the A/B is measuring the wrong difference. */
    if (id === "shank" && CBZ.CONFIG && CBZ.CONFIG.PRISON_SHANK === false) return "sidearm";
    return id || "sidearm";
  }

  function weaponMeta(id) {
    if (CBZ.weaponById) {
      const meta = CBZ.weaponById(id);
      if (meta) return meta;
    }
    return { id, key: id, slot: id === "sidearm" || id === "taser" ? "pistol" : "long" };
  }

  function fallbackWeapon() {
    const g = new THREE.Group();
    box(g, 0.15, 0.10, 0.54, mat.steel, 0, 0.04, -0.3);
    box(g, 0.12, 0.23, 0.12, mat.dark, 0, -0.15, -0.02, -0.2);
    g.userData.muzzle = new THREE.Vector3(0, 0.06, -0.62);
    return g;
  }

  function buildActorWeapon(name) {
    const id = normalizeWeaponId(name);
    const meta = weaponMeta(id);
    const builder = CBZ.weaponAppearance && CBZ.weaponAppearance[meta.appearanceFactory || meta.key || id];
    // noHand: the first-person grip hand is a viewmodel prop; a body already has hands
    const model = builder ? builder({ THREE, box, cyl, mat, noHand: true }) : fallbackWeapon();
    model.userData.weaponId = id;
    model.userData.weaponSlot = meta.slot || "pistol";
    // Does this prop have a BARREL? Every consumer that reasons about aim —
    // muzzle direction, arm elevation, gunpoint reactions — has been able to
    // assume "a weapon is out" means "a gun is out", because until the shank
    // there was no other kind. Stamped once at build so a per-frame reader
    // never has to look the row up again.
    model.userData.weaponMelee = !!meta.melee;
    model.userData.weaponHold = Object.assign({ heavy: 0, support: 0, stance: "" }, meta.hold || {});
    // REAL-DIMENSION SIZING (weapons/weapon-scale.js): the scalar is derived
    // from the researched real gun length so an NPC's rifle is the SAME size
    // as the player's — the old 0.82/0.92 pair drew NPC guns ~35% smaller
    // than the player's identical third-person gun ("guns feel small"). The
    // legacy pair stays as the fallback when the scale module is absent or
    // CBZ.CONFIG.WEAPON_REAL_SCALE=false.
    const heldScale = (CBZ.weaponHeldScale && CBZ.weaponHeldScale(id)) ||
      ((meta.slot === "pistol" || meta.slot === "utility") ? 0.92 : 0.82);
    model.scale.setScalar(heldScale);
    model.position.set(0.02, 0.02, 0.03);
    // barrel runs ALONG the forearm (grip in the hand, muzzle past the fingers)
    // so an extended arm points the gun FORWARD, upright. (+π/2, π) verified
    // numerically: arm −1.45 → barrel (0,−0.17,+0.99) forward, up (0,+0.99,…).
    model.rotation.set(Math.PI / 2, Math.PI, 0);
    model.traverse((obj) => {
      if (obj.material) obj.material.depthWrite = true;
    });
    return model;
  }

  /* ============================================================
     THE WEAPON/GROUND LAW

     A gun is geometry with mass, not a marker:
       • a held barrel samples the ground ALONG its whole length, including
         the muzzle point, and lifts only enough to stop intersecting it;
       • a released gun carries world velocity + angular momentum, substeps
         wall/ground contact, bounces, and settles on its measured thin side;
       • the pickup record follows the physical model, so the thing you grab
         is where the gun actually came to rest.

     This lives beside buildActorWeapon because that is the one owner which
     knows every gun's real model. Inventory, death and third-person posing
     consume it; none keeps a second gun-physics approximation.
     ============================================================ */
  const WP_REQUIRED = ["tp-held", "inventory-drops", "fps-death"];
  const wpAdopters = new Set();
  const wpBodies = [];
  const WP_CAP = 64;
  const WP_GRAVITY = 20.5;
  const WP_CLEAR = 0.012;
  const WP_CORPSE_CLEAR = 0.018;
  const WP_CORPSE_PASSES = 12;
  const wpBox = new THREE.Box3();
  const wpCorpseBox = new THREE.Box3();
  const wpLocalBox = new THREE.Box3();
  const wpInvRoot = new THREE.Matrix4();
  const wpRel = new THREE.Matrix4();
  const wpCorner = new THREE.Vector3();
  const wpSize = new THREE.Vector3();
  const wpCenter = new THREE.Vector3();
  const wpHalf = new THREE.Vector3();
  const wpPos = new THREE.Vector3();
  const wpLocalPos = new THREE.Vector3();
  const wpCenterOff = new THREE.Vector3();
  const wpAxisX = new THREE.Vector3();
  const wpAxisY = new THREE.Vector3();
  const wpAxisZ = new THREE.Vector3();
  const wpParentQ = new THREE.Quaternion();
  const wpWorldQ = new THREE.Quaternion();
  const wpDeltaQ = new THREE.Quaternion();
  const wpEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const wpSpinEuler = new THREE.Euler();
  const wpSeenActors = new Set();
  const wpSeenParts = new Set();
  const WP_STATS = { attached: 0, settled: 0, wallHits: 0, groundHits: 0, corpseHits: 0 };

  function wpFinite(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function wpGround(x, z, fromY, override) {
    if (override) {
      const y = override(x, z, fromY);
      return isFinite(y) ? y : 0;
    }
    if (CBZ.groundAt) {
      try {
        const y = CBZ.groundAt(x, z, fromY);
        if (isFinite(y)) return y;
      } catch (e) {}
    }
    if (CBZ.floorAt) {
      try {
        const y = CBZ.floorAt(x, z);
        if (isFinite(y)) return y;
      } catch (e) {}
    }
    return 0;
  }

  // Mutates `dir` in place. Four samples catch a kerb/brow BETWEEN the hand
  // and muzzle; three passes account for the x/z samples moving inward as the
  // barrel pitches up. The final direction stays normalized and keeps azimuth.
  function wpSolveGroundDirection(origin, dir, length, clearance, groundFn) {
    length = Math.max(0.02, wpFinite(length, 0));
    clearance = Math.max(0, wpFinite(clearance, 0.05));
    if (!origin || !dir || length <= 0.02) return dir;
    const dl = Math.hypot(dir.x, dir.y, dir.z);
    if (!(dl > 1e-5)) return dir;
    dir.multiplyScalar(1 / dl);
    for (let pass = 0; pass < 3; pass++) {
      let needY = dir.y;
      for (let i = 1; i <= 4; i++) {
        const t = i * 0.25;
        const x = origin.x + dir.x * length * t;
        const z = origin.z + dir.z * length * t;
        const fromY = origin.y + Math.max(0, dir.y * length * t) + 0.45;
        const floor = wpGround(x, z, fromY, groundFn);
        needY = Math.max(needY, (floor + clearance - origin.y) / (length * t));
      }
      if (dir.y >= needY - 1e-5) break;
      const y = Math.min(0.985, Math.max(-0.985, needY));
      const h = Math.hypot(dir.x, dir.z);
      if (h < 1e-5) dir.set(0, 1, 0);
      else {
        const k = Math.sqrt(Math.max(0, 1 - y * y)) / h;
        dir.set(dir.x * k, y, dir.z * k);
      }
    }
    return dir.normalize();
  }

  function wpClearDirection(origin, dir, length, clearance) {
    if (CBZ.CONFIG.WEAPON_GROUND_PHYSICS === false) return dir;
    return wpSolveGroundDirection(origin, dir, length, clearance, null);
  }

  // Geometry bounds in the weapon ROOT's local frame. This is measured once
  // when the body is born; cached/shared child geometry remains untouched.
  function wpMeasureLocal(mesh) {
    wpLocalBox.makeEmpty();
    mesh.updateWorldMatrix(true, true);
    wpInvRoot.copy(mesh.matrixWorld).invert();
    mesh.traverse(function (o) {
      const geo = o.geometry;
      if (!geo) return;
      if (!geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
      const b = geo.boundingBox;
      if (!b || b.isEmpty()) return;
      wpRel.multiplyMatrices(wpInvRoot, o.matrixWorld);
      for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
        wpCorner.set(ix ? b.max.x : b.min.x, iy ? b.max.y : b.min.y, iz ? b.max.z : b.min.z);
        wpLocalBox.expandByPoint(wpCorner.applyMatrix4(wpRel));
      }
    });
    if (wpLocalBox.isEmpty()) {
      wpCenter.set(0, 0, 0); wpHalf.set(0.28, 0.08, 0.12);
    } else {
      wpLocalBox.getCenter(wpCenter);
      wpLocalBox.getSize(wpSize);
      wpHalf.copy(wpSize).multiplyScalar(0.5);
    }
    const sx = Math.abs(mesh.scale.x || 1), sy = Math.abs(mesh.scale.y || 1), sz = Math.abs(mesh.scale.z || 1);
    return {
      center: new THREE.Vector3(wpCenter.x * sx, wpCenter.y * sy, wpCenter.z * sz),
      half: new THREE.Vector3(wpHalf.x * sx, wpHalf.y * sy, wpHalf.z * sz),
    };
  }

  function wpMeasureSpan(b) {
    wpCenterOff.copy(b.center).applyQuaternion(b.q);
    wpAxisX.set(1, 0, 0).applyQuaternion(b.q);
    wpAxisY.set(0, 1, 0).applyQuaternion(b.q);
    wpAxisZ.set(0, 0, 1).applyQuaternion(b.q);
    const ext = Math.abs(wpAxisX.y) * b.half.x +
      Math.abs(wpAxisY.y) * b.half.y +
      Math.abs(wpAxisZ.y) * b.half.z;
    const cy = b.pos.y + wpCenterOff.y;
    b.bottom = cy - ext;
    b.top = cy + ext;
    return b;
  }

  function wpWrite(b) {
    const m = b.mesh;
    if (!m) return;
    const parent = m.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      wpLocalPos.copy(b.pos);
      parent.worldToLocal(wpLocalPos);
      m.position.copy(wpLocalPos);
      parent.getWorldQuaternion(wpParentQ);
      m.quaternion.copy(wpParentQ.invert()).multiply(b.q);
    } else {
      m.position.copy(b.pos);
      m.quaternion.copy(b.q);
    }
    m.updateMatrixWorld(true);
  }

  function wpSyncRecord(b) {
    const r = b.record;
    if (!r) return;
    r.x = b.pos.x; r.z = b.pos.z; r.y = b.pos.y;
    r.y0 = b.settled ? b.supportY : b.pos.y;
  }

  // A dead actor is not scenery. Prison death drops are born beside the body
  // which owned them, so floor/wall-only physics lets a perfectly solid gun or
  // torch finish inside the torso while the corpse topples. Consume the real
  // articulated rig here: each anatomical mesh contributes its current world
  // AABB, including the group's fall rotation and the limb pose. No guessed
  // corpse capsule and no prison-local second weapon solver.
  const WP_CORPSE_SLOT_KEYS = [
    "torso", "collar", "pelvis", "legs", "legsLower", "shoes",
    "arms", "armsLower", "hands", "head",
  ];

  function wpEachCorpsePart(b, visit) {
    wpSeenActors.clear();
    const lists = [CBZ.guards, CBZ.npcs, CBZ.cityPeds, CBZ.cityCops];
    const scanActor = function (actor, group, ch) {
      if (!actor || !actor.dead || !group || !group.parent || group.visible === false || !ch || !ch.skinSlots) return true;
      if (wpSeenActors.has(actor)) return true;
      wpSeenActors.add(actor);
      const dx = b.pos.x - group.position.x, dz = b.pos.z - group.position.z;
      const metric = ch.metric || (group.userData && group.userData.characterMetric) || {};
      const reach = Math.max(2.4, wpFinite(metric.height, 1.82) + Math.max(b.half.x, b.half.z) + 0.55);
      if (dx * dx + dz * dz > reach * reach) return true;
      wpSeenParts.clear();
      for (let k = 0; k < WP_CORPSE_SLOT_KEYS.length; k++) {
        const slot = ch.skinSlots[WP_CORPSE_SLOT_KEYS[k]] || [];
        for (let i = 0; i < slot.length; i++) {
          const part = slot[i];
          if (!part || !part.isMesh || !part.parent || part.visible === false || wpSeenParts.has(part)) continue;
          wpSeenParts.add(part);
          const geo = part.geometry;
          if (!geo) continue;
          if (!geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
          if (!geo.boundingBox || geo.boundingBox.isEmpty()) continue;
          part.updateWorldMatrix(true, false);
          wpCorpseBox.copy(geo.boundingBox).applyMatrix4(part.matrixWorld);
          // A toppled voxel rig can extend a hidden sliver below the floor. That
          // buried volume must not shove a floor-resting weapon away from air.
          const cx = (wpCorpseBox.min.x + wpCorpseBox.max.x) * 0.5;
          const cz = (wpCorpseBox.min.z + wpCorpseBox.max.z) * 0.5;
          const floor = wpGround(cx, cz, wpCorpseBox.max.y + 0.3);
          wpCorpseBox.min.y = Math.max(wpCorpseBox.min.y, floor - 0.01);
          if (wpCorpseBox.max.y <= wpCorpseBox.min.y + 0.006) continue;
          if (visit(wpCorpseBox, actor, part) === false) return false;
        }
      }
      return true;
    };
    for (let l = 0; l < lists.length; l++) {
      const list = lists[l] || [];
      for (let i = 0; i < list.length; i++) if (scanActor(list[i], list[i] && list[i].group, list[i] && list[i].char) === false) return;
    }
    // Player-death weapon drops use the same law even though the player record
    // stores its render group on CBZ.playerChar rather than `player.group`.
    if (CBZ.player && CBZ.player.dead && CBZ.playerChar) {
      scanActor(CBZ.player, CBZ.playerChar.group, CBZ.playerChar);
    }
  }

  function wpCorpseOverlapCount(b) {
    if (!b || !b.mesh || !b.mesh.parent || !b.corpseCollision) return 0;
    wpWrite(b);
    wpBox.setFromObject(b.mesh);
    let overlaps = 0;
    wpEachCorpsePart(b, function (c) {
      const ox = Math.min(wpBox.max.x, c.max.x) - Math.max(wpBox.min.x, c.min.x);
      const oy = Math.min(wpBox.max.y, c.max.y) - Math.max(wpBox.min.y, c.min.y);
      const oz = Math.min(wpBox.max.z, c.max.z) - Math.max(wpBox.min.z, c.min.z);
      if (ox > 0.004 && oy > 0.004 && oz > 0.004) overlaps++;
    });
    return overlaps;
  }

  function wpResolveCorpses(b) {
    const contact = { hit: false, landed: false, impact: 0 };
    if (!b.corpseCollision || !b.mesh || !b.mesh.parent) return contact;
    for (let pass = 0; pass < WP_CORPSE_PASSES; pass++) {
      wpWrite(b);
      wpBox.setFromObject(b.mesh);
      let moved = false;
      wpEachCorpsePart(b, function (c) {
        const ox = Math.min(wpBox.max.x, c.max.x) - Math.max(wpBox.min.x, c.min.x);
        const oy = Math.min(wpBox.max.y, c.max.y) - Math.max(wpBox.min.y, c.min.y);
        const oz = Math.min(wpBox.max.z, c.max.z) - Math.max(wpBox.min.z, c.min.z);
        if (ox <= 0.001 || oy <= 0.001 || oz <= 0.001) return true;

        const sx0 = c.min.x - wpBox.max.x - WP_CORPSE_CLEAR;
        const sx1 = c.max.x - wpBox.min.x + WP_CORPSE_CLEAR;
        const sx = Math.abs(sx0) <= Math.abs(sx1) ? sx0 : sx1;
        const sz0 = c.min.z - wpBox.max.z - WP_CORPSE_CLEAR;
        const sz1 = c.max.z - wpBox.min.z + WP_CORPSE_CLEAR;
        const sz = Math.abs(sz0) <= Math.abs(sz1) ? sz0 : sz1;
        // Corpse volume below the weapon is support. Never resolve downward
        // through the floor; an overhead hit either sets the object on top or
        // lets the smaller horizontal separation roll it clear.
        const sy = c.max.y - wpBox.min.y + WP_CORPSE_CLEAR;
        const ax = Math.abs(sx), ay = Math.abs(sy), az = Math.abs(sz);
        if (ay <= ax && ay <= az) {
          const impact = Math.max(0, -b.vy);
          b.pos.y += sy;
          if (b.vy < 0) b.vy = 0;
          b.vx *= 0.70; b.vz *= 0.70;
          contact.landed = true;
          contact.impact = Math.max(contact.impact, impact);
        } else if (ax <= az) {
          b.pos.x += sx;
          if ((sx > 0 && b.vx < 0) || (sx < 0 && b.vx > 0)) b.vx *= -0.24;
          else b.vx *= 0.55;
        } else {
          b.pos.z += sz;
          if ((sz > 0 && b.vz < 0) || (sz < 0 && b.vz > 0)) b.vz *= -0.24;
          else b.vz *= 0.55;
        }
        b.wx *= 0.72; b.wy *= 0.72; b.wz *= 0.72;
        wpMeasureSpan(b);
        WP_STATS.corpseHits++;
        contact.hit = moved = true;
        return false; // recompute the weapon box before resolving another part
      });
      if (!moved) break;
    }
    wpWrite(b);
    return contact;
  }

  function wpClatter(b, impact) {
    if (b.sounded || impact < 1.4 || !CBZ.sfx) return;
    if (CBZ.camera) {
      const dx = b.pos.x - CBZ.camera.position.x, dz = b.pos.z - CBZ.camera.position.z;
      if (dx * dx + dz * dz > 70 * 70) return;
    }
    b.sounded = true;
    try { CBZ.sfx(b.sound || "shell"); } catch (e) {}
  }

  function wpRestOnGround(b) {
    // Set the model's REAL lowest vertex on the highest support under its
    // footprint. The corner/centre sweep prevents a long rifle bridging a
    // kerb or slope from leaving one end below the surface.
    wpWrite(b);
    wpBox.setFromObject(b.mesh);
    let support = -Infinity;
    const xs = [wpBox.min.x, (wpBox.min.x + wpBox.max.x) * 0.5, wpBox.max.x];
    const zs = [wpBox.min.z, (wpBox.min.z + wpBox.max.z) * 0.5, wpBox.max.z];
    const fromY = wpBox.max.y + 0.5;
    for (let ix = 0; ix < 3; ix++) for (let iz = 0; iz < 3; iz++) {
      support = Math.max(support, wpGround(xs[ix], zs[iz], fromY));
    }
    if (!isFinite(support)) support = wpGround(b.pos.x, b.pos.z, b.pos.y + 0.5);
    b.pos.y += support + WP_CLEAR - wpBox.min.y;
    b.supportY = support;
    wpMeasureSpan(b);
    wpWrite(b);
    return support;
  }

  function wpSettle(b) {
    // A firearm rests on a SIDE, never balanced upright on its grip. Keep the
    // tumble's yaw so two drops do not form a copied row.
    wpEuler.setFromQuaternion(b.q, "YXZ");
    wpEuler.set(0, wpEuler.y, b.side * (Math.PI / 2 - 0.06), "YXZ");
    b.q.setFromEuler(wpEuler);
    b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
    b.settled = true;
    wpRestOnGround(b);
    // Resting against a corpse is still resting: separate from the actual
    // posed body after the ground snap, then keep tracking this body while the
    // corpse finishes its fall so a later frame cannot rotate through it.
    wpResolveCorpses(b);
    wpSyncRecord(b);
    WP_STATS.settled++;
  }

  function wpStepResting(b) {
    wpRestOnGround(b);
    wpResolveCorpses(b);
    wpMeasureSpan(b);
    wpWrite(b);
    wpSyncRecord(b);
  }

  function wpRelease(bodyOrMesh) {
    const body = bodyOrMesh && bodyOrMesh.mesh ? bodyOrMesh
      : bodyOrMesh && bodyOrMesh.userData && bodyOrMesh.userData.weaponBody;
    if (!body) return false;
    body.dead = true;
    if (body.mesh && body.mesh.userData && body.mesh.userData.weaponBody === body) {
      delete body.mesh.userData.weaponBody;
    }
    const i = wpBodies.indexOf(body);
    if (i >= 0) wpBodies.splice(i, 1);
    return true;
  }

  function wpDrop(mesh, opts) {
    opts = opts || {};
    if (!mesh || CBZ.CONFIG.WEAPON_GROUND_PHYSICS === false) return null;
    if (mesh.userData && mesh.userData.weaponBody) wpRelease(mesh);
    while (wpBodies.length >= WP_CAP) {
      const old = wpBodies.shift();
      if (old && old.mesh && old.mesh.parent) wpSettle(old);
    }
    const bounds = wpMeasureLocal(mesh);
    mesh.getWorldPosition(wpPos);
    mesh.getWorldQuaternion(wpWorldQ);
    const body = {
      mesh: mesh, record: opts.record || null, source: opts.source || "unknown",
      pos: wpPos.clone(), q: wpWorldQ.clone(), center: bounds.center, half: bounds.half,
      vx: wpFinite(opts.vx, 0), vy: wpFinite(opts.vy, 0), vz: wpFinite(opts.vz, 0),
      wx: wpFinite(opts.wx, (Math.random() - 0.5) * 10),
      wy: wpFinite(opts.wy, (Math.random() - 0.5) * 8),
      wz: wpFinite(opts.wz, (Math.random() - 0.5) * 12),
      wallR: Math.max(0.05, Math.min(0.22, Math.min(bounds.half.x, bounds.half.z) * 0.7)),
      side: opts.side === -1 ? -1 : opts.side === 1 ? 1 : (Math.random() < 0.5 ? -1 : 1),
      sound: opts.sound || "shell", sounded: false, bounces: 0, t: 0,
      bottom: 0, top: 0, supportY: 0, settled: false, dead: false,
      corpseCollision: !!opts.corpseCollision,
    };
    mesh.userData = mesh.userData || {};
    mesh.userData.weaponBody = body;
    wpBodies.push(body);
    wpMeasureSpan(body);
    wpSyncRecord(body);
    WP_STATS.attached++;
    return body;
  }

  function wpStepBody(b, dt) {
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const steps = Math.max(1, Math.min(8, Math.ceil(speed * dt / 0.24)));
    const sdt = dt / steps;
    for (let n = 0; n < steps && !b.settled; n++) {
      b.t += sdt;
      b.vy -= WP_GRAVITY * sdt;
      b.pos.x += b.vx * sdt; b.pos.y += b.vy * sdt; b.pos.z += b.vz * sdt;
      wpSpinEuler.set(b.wx * sdt, b.wy * sdt, b.wz * sdt, "XYZ");
      wpDeltaQ.setFromEuler(wpSpinEuler);
      b.q.multiply(wpDeltaQ).normalize();
      wpMeasureSpan(b);

      if (CBZ.collide) {
        const ox = b.pos.x, oz = b.pos.z;
        CBZ.collide(b.pos, b.wallR, b.bottom, b.top);
        if (Math.abs(b.pos.x - ox) > 1e-5) { b.vx *= -0.24; WP_STATS.wallHits++; }
        if (Math.abs(b.pos.z - oz) > 1e-5) { b.vz *= -0.24; WP_STATS.wallHits++; }
        if (b.pos.x !== ox || b.pos.z !== oz) { b.wx *= 0.72; b.wy *= 0.72; b.wz *= 0.72; wpMeasureSpan(b); }
      }

      const corpseContact = wpResolveCorpses(b);
      if (corpseContact.landed) {
        const impact = corpseContact.impact;
        wpClatter(b, impact);
        if (impact > 1.45 && b.bounces < 2) {
          b.bounces++;
          b.vy = impact * (b.bounces === 1 ? 0.18 : 0.10);
          b.vx *= 0.48; b.vz *= 0.48;
          b.wx *= 0.45; b.wy *= 0.40; b.wz *= 0.45;
        } else {
          wpSettle(b);
          break;
        }
      }

      const support = wpGround(b.pos.x, b.pos.z, b.top + 0.2);
      if (b.bottom <= support && b.vy <= 0) {
        const impact = -b.vy;
        b.pos.y += support + WP_CLEAR - b.bottom;
        b.supportY = support;
        WP_STATS.groundHits++;
        wpClatter(b, impact);
        if (impact > 1.45 && b.bounces < 2) {
          b.bounces++;
          b.vy = impact * (b.bounces === 1 ? 0.22 : 0.12);
          b.vx *= 0.52; b.vz *= 0.52;
          b.wx *= 0.48; b.wy *= 0.42; b.wz *= 0.48;
        } else wpSettle(b);
      }
      const airDrag = Math.pow(0.985, sdt);
      b.vx *= airDrag; b.vz *= airDrag;
      if (b.t > 4 && !b.settled) wpSettle(b);
    }
    if (!b.settled) { wpWrite(b); wpSyncRecord(b); }
  }

  if (CBZ.onUpdate) CBZ.onUpdate(37.45, function (dt) {
    if (CBZ.CONFIG.WEAPON_GROUND_PHYSICS === false) return;
    dt = Math.min(0.1, Math.max(0, dt || 0));
    for (let i = wpBodies.length - 1; i >= 0; i--) {
      const b = wpBodies[i];
      if (!b || b.dead || !b.mesh || !b.mesh.parent ||
          !b.mesh.userData || b.mesh.userData.weaponBody !== b) {
        wpBodies.splice(i, 1); continue;
      }
      if (b.settled) {
        if (b.corpseCollision) wpStepResting(b);
        else wpBodies.splice(i, 1);
      } else wpStepBody(b, dt);
    }
  });

  CBZ.weaponPhysics = {
    clearDirection: wpClearDirection,
    drop: wpDrop,
    release: wpRelease,
    adopt: function (id) { if (id) wpAdopters.add(String(id)); },
  };
  CBZ.weaponPhysicsAudit = function () {
    const o = new THREE.Vector3(0, 0.55, 0);
    const d = new THREE.Vector3(0.12, -0.82, 0.56).normalize();
    const testGround = function (x, z) { return 0.08 + z * 0.20 + Math.max(0, x - 0.18) * 0.28; };
    wpSolveGroundDirection(o, d, 1.55, 0.05, testGround);
    let solverPenetration = 0;
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      const x = o.x + d.x * 1.55 * t, z = o.z + d.z * 1.55 * t;
      const y = o.y + d.y * 1.55 * t;
      if (y < testGround(x, z) + 0.05 - 1e-4) solverPenetration++;
    }
    let underground = 0, active = 0, corpseOverlaps = 0, corpseTracked = 0;
    for (let i = 0; i < wpBodies.length; i++) {
      const b = wpBodies[i];
      if (!b.settled) active++;
      wpMeasureSpan(b);
      if (b.bottom < wpGround(b.pos.x, b.pos.z, b.top + 0.2) - 0.02) underground++;
      if (b.corpseCollision) {
        corpseTracked++;
        corpseOverlaps += wpCorpseOverlapCount(b);
      }
    }
    const missing = WP_REQUIRED.filter(function (id) { return !wpAdopters.has(id); });
    return {
      required: WP_REQUIRED.length, adopted: wpAdopters.size, missing: missing,
      solverPenetration: solverPenetration, active: active, tracked: wpBodies.length,
      underground: underground, cap: WP_CAP,
      attached: WP_STATS.attached, settled: WP_STATS.settled,
      wallHits: WP_STATS.wallHits, groundHits: WP_STATS.groundHits,
      corpseTracked: corpseTracked, corpseOverlaps: corpseOverlaps, corpseHits: WP_STATS.corpseHits,
    };
  };

  function disposeGroup(group) {
    group.traverse((obj) => {
      // cached weapon geometries (_shared) outlive any one prop — disposing
      // them would evict the GL buffers out from under every other armed actor
      if (obj.geometry && obj.geometry.dispose && !obj.geometry._shared) obj.geometry.dispose();
      if (obj.material) {
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x && !x._shared && x.dispose && x.dispose());
        else if (!m._shared && m.dispose) m.dispose();
      }
    });
  }

  function socketOf(actor) {
    const ch = actor && actor.char;
    return ch && ch.sockets && (ch.sockets.thirdPersonWeapon || ch.sockets.weapon || ch.sockets.rightHand);
  }

  // THE HAND CLOSES ON WHAT IT HOLDS: every body's hand is the first-person
  // hand (character.js HANDS block). A gun in the socket = the pistol grip
  // (index on the trigger), a melee weapon = a closed grip, nothing = relaxed.
  // setHandPose is a compare when nothing changed, so per-frame calls are free.
  // A GUN IS SEATED IN THE FIST: CBZ.gunHold.ready (above) closes a hand
  // sized to this gun's own grip, oriented on it, and moves the prop so the
  // grip is IN that hand. Seat-only here (the arms may belong to anyone this
  // frame); setReadyPose poses both arms from the same cached solve.
  function gripHand(actor, prop) {
    const ch = actor && actor.char;
    if (!ch || !ch.setHandPose) return;
    if (prop && prop.visible && !(prop.userData && prop.userData.weaponMelee) && GH.ready(ch, prop, false)) return;
    ch.setHandPose("r", !prop || !prop.visible ? "relaxed"
      : (prop.userData && prop.userData.weaponMelee ? "grip" : "pistol"));
  }
  function syncActorWeapon(actor) {
    const prop = syncActorWeaponProp(actor);
    gripHand(actor, prop);
    return prop;
  }
  function syncActorWeaponProp(actor) {
    if (!actor || !actor.char) return null;
    // HOLSTER GATE: armed=false (police.js holsterGun ships exactly this) and
    // the canonical _holstered flag both mean "gun's in the leather" — hide the
    // prop but KEEP it socketed with its id intact, so the next draw is a free
    // visibility flip (a rebuild is for weapon SWAPS only). _gunLowered /
    // _gunHidden are deliberately NOT honored here: an explicit sync call is a
    // firing path saying "gun out NOW" (police fireAt clears its lowering
    // first) — the per-frame pose pass is what enforces those visual stows.
    const shouldShow = !!(actor.armed && !actor.dead && !actor._holstered);
    const id = shouldShow ? normalizeWeaponId(actor.weapon || (actor.swat ? "SMG" : "Pistol")) : null;
    if (!shouldShow) {
      if (actor._weaponProp) actor._weaponProp.visible = false;
      return null;
    }
    const socket = socketOf(actor);
    if (!socket) return null;
    if (!actor._weaponProp || actor._weaponPropId !== id) {
      if (actor._weaponProp && actor._weaponProp.parent) actor._weaponProp.parent.remove(actor._weaponProp);
      if (actor._weaponProp) disposeGroup(actor._weaponProp);
      actor._weaponProp = buildActorWeapon(id);
      actor._weaponPropId = id;
    }
    if (actor._weaponProp.parent !== socket) socket.add(actor._weaponProp);
    actor._weaponProp.visible = true;
    return actor._weaponProp;
  }

  function actorForward(actor, out) {
    const g = actor && actor.group;
    if (g) {
      g.updateMatrixWorld(true);
      out.set(0, 0, 1).applyQuaternion(g.getWorldQuaternion(quat)).normalize();
      return out;
    }
    return out.set(0, 0, 1);
  }

  function actorMuzzle(actor, out) {
    out = out || new THREE.Vector3();
    const prop = syncActorWeapon(actor);
    if (prop && prop.userData && prop.userData.muzzle) {
      if (actor && actor.group) actor.group.updateMatrixWorld(true);
      prop.updateMatrixWorld(true);
      return prop.localToWorld(out.copy(prop.userData.muzzle));
    }
    const socket = socketOf(actor);
    if (socket) {
      if (actor && actor.group) actor.group.updateMatrixWorld(true);
      socket.updateMatrixWorld(true);
      return socket.localToWorld(out.set(0, 0.04, 0.45));
    }
    actorForward(actor, fwd);
    const pos = actor && actor.pos ? actor.pos : { x: 0, y: 0, z: 0 };
    return out.set(pos.x, (pos.y || 0) + 1.42, pos.z).addScaledVector(fwd, 0.46);
  }

  function actorAimAt(actor, target, dt) {
    if (!actor || !target || !actor.group || !target.pos) return;
    const dx = target.pos.x - actor.pos.x;
    const dz = target.pos.z - actor.pos.z;
    if (dx * dx + dz * dz > 0.0001) {
      const turn = dt != null ? 1 - Math.pow(0.0005, dt) : 1;
      const lerp = CBZ.lerpAngle || function (a, b, t) {
        let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (d < -Math.PI) d += Math.PI * 2;
        return a + d * t;
      };
      actor.group.rotation.y = lerp(actor.group.rotation.y, Math.atan2(dx, dz), turn);
    }
    const ch = actor.char;
    if (!ch || !ch.parts) return;
    setReadyPose(ch, actor._weaponProp || syncActorWeapon(actor));
  }

  // hold the gun FORWARD at chest height (not dangling at the hip). The right arm
  // swings up to roughly horizontal so the muzzle reads as "weapon ready".
  // mirror the PLAYER's known-good forward-aim arm pose (fpsmode third-person)
  // so NPC guns point forward at chest height — not at the hip, not up at the sky.
  function setReadyPose(ch, prop) {
    if (!ch || !ch.parts) return;
    const ud = prop && prop.userData ? prop.userData : {};
    // A FIREARM: both hands on it, solved for this body and this gun
    // (CBZ.gunHold.ready — shouldered and bladed for a long gun, a two-hand
    // isosceles for a pistol, the off hand free on a one-handed taser).
    if (prop && prop.visible && !ud.weaponMelee && GH.ready(ch, prop, true)) return;
    // Anything the solve cannot take (a blade, a rig without hands) keeps the
    // old fixed forward pose.
    const slot = ud.weaponSlot || "pistol";
    const longGun = slot === "long" || slot === "rifle" || slot === "auto";
    const hold = ud.weaponHold || {};
    const heavy = Math.max(0, Math.min(1, hold.heavy || 0));
    const support = Math.max(0, Math.min(0.5, hold.support || 0));
    const shoulder = hold.stance === "shoulder";
    const elbow = function (part, angle) {
      const low = part && part.userData && part.userData.low;
      if (low) low.rotation.x = angle;
    };
    // gun arm raised to ~horizontal-forward, NO y/z twist (twist was throwing the
    // muzzle off). With the prop's +π/2 mount this points the barrel forward.
    if (ch.parts.ra) {
      ch.parts.ra.rotation.set((longGun ? -1.54 : -1.50) + heavy * 0.10, longGun ? 0.12 : 0.18, longGun ? 0.30 : 0.34);
      ch.parts.ra.position.z = 0.14;
      elbow(ch.parts.ra, shoulder ? -0.28 : (longGun ? -0.10 - heavy * 0.12 : -0.16));
    }
    // Every firearm is a two-hand object while presented. Pistols meet at the
    // firing wrist; long guns move the left hand forward by the weapon's own
    // support measurement. A shoulder launcher stays close to the receiver.
    if (ch.parts.la) {
      if (longGun) {
        ch.parts.la.rotation.set(
          (shoulder ? -1.38 : -1.55) - heavy * 0.10,
          shoulder ? -0.18 : -0.34 - heavy * 0.08,
          shoulder ? -0.34 : -0.42 - support * 0.18
        );
        ch.parts.la.position.z = (shoulder ? 0.16 : 0.24) + support * 0.5;
        elbow(ch.parts.la, shoulder ? -0.48 : -0.72 - heavy * 0.26);
      } else {
        ch.parts.la.rotation.set(-1.56, -0.32, -0.68);
        ch.parts.la.position.z = 0.20;
        elbow(ch.parts.la, -0.22 - heavy * 0.12);
      }
    }
  }

  // every frame (AFTER the walk animation), force any actor whose gun is OUT
  // to carry it in the ready pose so it never droops to the hip while standing
  // or walking. "Out" respects intent: holstered/lowered/hidden actors are
  // skipped (and kept stowed) so escalation cues and wall-stows actually read.
  function poseList(list) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.dead || a._parked || (a.ko > 0) || !a.armed) continue;
      // A culled ped's group is out of the scene (city/peds.js removes it);
      // posing arms nobody can see is a walk over ~700 actors for nothing.
      if (a.culled) continue;
      // character.js owns every limb during a vault/mantle. A late gun-ready
      // overwrite would pin one arm forward and erase the hand plant/grab that
      // makes the obstacle contact physically readable.
      if (a._traversal || (a.char && a.char.traversePose)) continue;
      if (a.surrender || (a.surrenderT || 0) > 0 || (a.char && (a.char.surrender || a.char.handsUp))) continue;
      // INTENT FLAGS BEAT THE SELF-HEAL: _holstered (canonical, CBZ.actorHolster),
      // _gunLowered (police gun-stop challenge / combat.js walled-off stow) and
      // _gunHidden (occlusion hide) are deliberate "armed but gun away" states.
      // Force-re-showing here every frame was exactly what defeated them — a
      // challenge never read as a lowered muzzle and stowed guns popped back
      // through walls. Enforce the hide (visibility flip only — prop stays on
      // its socket) and leave the arms free for the owning system / reactions.
      if (a._holstered || a._gunLowered || a._gunHidden) {
        if (a._weaponProp && a._weaponProp.visible) a._weaponProp.visible = false;
        gripHand(a, null);
        continue;
      }
      // Skip ONLY a genuinely ragdolling body (down / airborne / held). Do NOT use
      // CBZ.body.busy() here: in city it was widened to report ANY body still
      // slightly pitched (rotation.x>0.04) as busy — which would steal the gun-
      // ready pose from a shooter that merely has a tiny lean, leaving its arm
      // (and gun) dangling at the hip and the shots reading as "from the chest".
      const ph = a._phys;
      if (ph && (ph.down > 0 || ph.air || ph.heldBy)) continue;
      // ATTACH + show the gun prop right here if it isn't already (self-heal): if
      // the spawn-time syncActorWeapon ever no-op'd (armed flipped on later, a
      // recycle, etc.) the ped would otherwise fire an INVISIBLE gun from the
      // hand. Building is cheap — syncActorWeapon early-returns when the prop is
      // already attached with the right id, only rebuilding when the weapon changed.
      const prop = syncActorWeapon(a);
      if (!prop) continue;
      setReadyPose(a.char, prop);
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(36, function () {
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    poseList(CBZ.cityPeds); poseList(CBZ.cityCops);
  });
  // every mode: a body no longer asked for its bladed ready pose turns its
  // head back (the neck counter-turn is a baked offset, see GH.ready)
  if (CBZ.onUpdate) CBZ.onUpdate(36.5, function (dt) { GH.readyDecay(dt); });

  // ---- CANONICAL HOLSTER INTENT --------------------------------------------
  // WHY: police.js holsters by flipping .armed — honored above forever (back-
  // compat). But .armed doubles as "this actor HAS a gun", so any system that
  // wants "the gun stays his, it's just in the leather" (gang truces, club
  // door checks, cop adoption later) sets intent here instead of mutating
  // .armed and confusing threat-assessment readers. Visibility flip ONLY: the
  // prop never leaves its socket and a re-draw never rebuilds geometry.
  function actorHolster(actor, on) {
    if (!actor) return;
    actor._holstered = on !== false;
    if (actor._holstered) {
      if (actor.weapon) actor._beltGun = actor.weapon;   // what rides the belt (same field police.js uses)
      if (actor._weaponProp) actor._weaponProp.visible = false;
    } else {
      if (!actor.weapon && actor._beltGun) actor.weapon = actor._beltGun;
      if (actor.armed && !actor.dead) syncActorWeapon(actor);
    }
  }

  CBZ.weaponIdFromName = normalizeWeaponId;
  CBZ.buildActorWeapon = buildActorWeapon;
  CBZ.syncActorWeapon = syncActorWeapon;
  CBZ.actorHolster = actorHolster;
  CBZ.actorMuzzle = actorMuzzle;
  CBZ.actorAimAt = actorAimAt;
  CBZ.actorReadyPose = function (actor) {
    const prop = syncActorWeapon(actor);
    if (prop && actor && actor.char) setReadyPose(actor.char, prop);
    return prop;
  };
})();
