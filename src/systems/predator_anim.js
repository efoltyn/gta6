// ============================================================================
// predator_anim.js — THE LAND BODY LAYER (CBZ)
// ----------------------------------------------------------------------------
// WHY THIS FILE EXISTS: the census is blunt — land animals in this game have no
// jaw and no spine/tail bend AT ALL. Every land creature is leg-swing plus a
// whole-group bob/sway/pitch. The shark got CBZ.swimJaw (a real gape) and reads
// as alive when it bites; a bear that has you in its mouth today moves NOTHING
// on its body. This is the land sibling of buildSwimRig/animateSwim/swimJaw:
// maw, rear, swat, worry, coil.
//
// DISCOVERY, NOT DECLARATION (the law this file lives by): there are 45 species
// across 10 bestiary files. A species table here would be a build failure — the
// 46th animal must animate for free. So every joint is found GEOMETRICALLY out
// of the rig wildlife.js already discovered:
//   a.gait.cols  -> leg columns, x>0 = FRONT (models are authored nose-toward +X)
//   a.gait.head  -> the head cluster; its lower/forward half IS the lower jaw
//   a.swim       -> aquatic: hand the gape straight to CBZ.swimJaw, done
//   a.segs       -> snakes: the segment chain we tighten into a coil
// buildSwimRig's jaw discovery (wildlife.js:606-618) is the proven prior art —
// the land maw below is the same idea run against the gait head cluster.
//
// THE COMPOSITION LAW (this is the bug this file is most likely to cause):
// gaitAnimate writes `m.position.x = pt.bx + swing` — an ABSOLUTE write, EVERY
// frame while the legs swing, and then it LATCHES and stops writing once they
// settle. So neither "+= offset" (ratchets the leg into orbit once the gait
// latches) nor "= base + offset" (silently erased while the gait is swinging)
// is correct on its own. Two writers, two rules:
//   set()  — bones whose AUTHORED base we know (legs/head come from gait's own
//            pt.bx/pt.by). We write base+offset, which also cancels the gait
//            swing by construction — exactly what a rear-up needs ("front legs
//            go limp, do NOT keep walking them").
//   put()  — bones with no knowable base: the GROUP transform (contested by the
//            terrain slope, the lumber sway, animateAttack and thrashAttacker)
//            and SNAKE segments (snakeAnimate recomputes them procedurally).
//            We remember the exact value we left behind: still there => nobody
//            else wrote, so undo our old offset first; changed => that new value
//            is the authoritative base and we simply add on top of it.
// Either way the applied offset is tracked per bone and always returns to zero,
// so a pose can never drift a mesh out of the model.
//
// LAYERS COMPOSE, THEY DO NOT OVERWRITE EACH OTHER EITHER: predatorRear and
// predatorSwat both want the same front leg; predatorMaw and predatorWorry both
// want the same head meshes (the jaw parts ARE head parts). So the public
// functions only set weights on the rig and then call ONE applier per bone group
// (applyLegs / applyHead / applyBody / applyCoil) which sums every active layer
// and writes each mesh exactly once. That is why a bear can rear, swat and gape
// in the same frame without the last call winning.
//
// NO TICK OF ITS OWN. Nothing here runs on an updater — this layer is driven
// entirely by its callers (creature_combat's animateAttack and predator.js's
// seize thrash), which is also why it must be called AFTER whatever else moved
// the actor that frame. Two ordering facts that follow from that:
//   - The seize (onUpdate 47.35) poses AFTER the wildlife tick (47.1) ran the
//     gait, so a seize pose is always the last word. Good.
//   - Inside the wildlife tick, creatureFight runs BEFORE gaitAnimate, so for
//     the first few frames of a strike — while the legs are still swinging
//     their weight down — the gait's absolute writes win on the LEG meshes
//     (never on the group: gaitAnimate yields the body transform whenever
//     _flinchT > 0 or _atkAnim >= 0, and a strike sets the latter). The pose
//     appears in full the moment the legs settle, which is ~0.3s of a stopped
//     animal, i.e. before the attack that matters. Nothing drifts either way:
//     set() recomputes from the authored base every frame.
//
// ALLOCATION-FREE PER FRAME: the rig (arrays + per-bone number slots) is built
// once per actor and cached on a._prig; every pose function is pure arithmetic
// on module-scope temps. No `new THREE.*` anywhere in this file — and geometries
// are SHARED between actors, so we only ever touch mesh.position / .rotation.
//
// r128 NOTE (verified, not remembered): THREE.Euler's default order is 'XYZ',
// which composes R = Rx·Ry·Rz — Rz is applied FIRST, in model-local space. With
// the nose at +X and up at +Y that makes group.rotation.z the model-local PITCH
// (positive = nose up), which is the axis a rear-up uses. group.rotation.x is a
// world-X tilt applied AFTER the yaw and is NOT a clean body axis, so this file
// never writes a "roll" onto the group (a true long-axis roll needs
// rotation.order = 'YXZ' for the duration, and the seize owns that).
// ============================================================================
(function () {
  'use strict';
  var CBZ = window.CBZ;
  if (!CBZ) return;

  // ---- feature flag: the one-line revert (declared here, not in config.js) --
  if (!CBZ.CONFIG) CBZ.CONFIG = {};
  if (CBZ.CONFIG.PREDATOR_ANIM == null) CBZ.CONFIG.PREDATOR_ANIM = true;
  function ON() { return CBZ.CONFIG.PREDATOR_ANIM !== false; }

  // ---- tuning (all continuous, all derived — no species is ever named) -----
  var MAW_ANGLE = 0.55;    // rad the lower jaw drops at a full gape (~32deg)
  var REAR_PITCH = 0.55;   // rad of model-local pitch at a full rear-up
  var REAR_LIFT = 0.85;    // front paws rise this fraction of the leg height
  var WORRY_YAW = 0.55;    // rad of head yaw at full thrash
  var WORRY_ROLL = 0.30;   // rad of head roll (the off-axis cant that sells it)
  var WORRY_HZ = 8.0;      // shake frequency: research says 6-10 Hz reads violent
  var SHUDDER_HZ = 18.0;   // the big cat's pin micro-shudder (stillness + tremor)
  var STRIKE_AT = 0.45;    // must match creature_combat's strike moment exactly

  // axis ids — integers, so the hot path never indexes by string
  var AX = 0, AY = 1, AZ = 2;
  var TAU = 6.283185307179586;

  // module-scope temps (never allocate in a pose)
  var _t = 0, _x = 0, _y = 0, _z = 0;
  var INFO = { front: 0, rear: 0, maw: false, head: false, segs: 0 };

  function clamp01(v) { return v > 0 ? (v > 1 ? 1 : v) : 0; }
  function ease(t) { return t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t)); }
  function frac(p) { return p - Math.floor(p); }
  // creature_combat's triangular strike envelope, duplicated because its copy is
  // module-private. Keep STRIKE_AT in sync or an attack pose peaks off the hit.
  function env(p) {
    if (p <= 0 || p >= 1) return 0;
    return p < STRIKE_AT ? ease(p / STRIKE_AT) : ease(1 - (p - STRIKE_AT) / (1 - STRIKE_AT));
  }
  function windup(p) { return p < STRIKE_AT ? ease(p / STRIKE_AT) : 0; }

  // ---- the two write disciplines ------------------------------------------
  function rd(v, ax) { return ax === AX ? v.x : (ax === AY ? v.y : v.z); }
  function wr(v, ax, n) { if (ax === AX) v.x = n; else if (ax === AY) v.y = n; else v.z = n; }

  // SET — we know the authored base (gait handed us pt.bx/pt.by). Writing
  // base+offset both applies the pose AND cancels whatever swing the gait put
  // there this frame, which is the whole point for a limp/pressed limb.
  function set(b, ax, want) {
    if (want === 0 && b.o[ax] === 0) return;      // already at rest: free
    var v = b.b[ax] + want;
    wr(b.m.position, ax, v);
    b.o[ax] = want; b.l[ax] = v;
  }
  // PUT — no knowable base (group transform, snake segments). Undo our own last
  // offset only if the value is still exactly the one we left; otherwise a
  // foreign writer ran and ITS value is the base we compose on top of.
  function put(b, ax, want) {
    var p = b.m.position, cur = rd(p, ax);
    if (want === 0 && b.o[ax] === 0) return;
    var base = (cur === b.l[ax]) ? cur - b.o[ax] : cur;
    var v = base + want;
    wr(p, ax, v);
    b.o[ax] = want; b.l[ax] = v;
  }
  // blend the live value toward an absolute LOCAL target by k (snake coil)
  function putTo(b, ax, target, k) {
    var p = b.m.position, cur = rd(p, ax);
    var base = (cur === b.l[ax]) ? cur - b.o[ax] : cur;
    put(b, ax, (target - base) * k);
  }
  // rotations on a discovered bone are UNCONTESTED on land (gaitAnimate never
  // writes a leg or head rotation; the graze dip is position-only), so the
  // simple base+offset form is correct and cheaper.
  function setR(b, ax, want) {
    if (want === 0 && b.ro[ax] === 0) return;
    wr(b.m.rotation, ax, b.r[ax] + want);
    b.ro[ax] = want;
  }
  // ..the GROUP's rotation is contested by four writers, so it needs put()'s
  // "did someone else touch it" test.
  function putR(b, ax, want) {
    var e = b.m.rotation, cur = rd(e, ax);
    if (want === 0 && b.ro[ax] === 0) return;
    var base = (cur === b.rl[ax]) ? cur - b.ro[ax] : cur;
    var v = base + want;
    wr(e, ax, v);
    b.ro[ax] = want; b.rl[ax] = v;
  }

  // A BONE is one mesh plus its rest state and the offset we currently own.
  // l/rl start as NaN so the very first comparison always takes the "someone
  // else owns this value" branch (NaN !== NaN) — no special-casing frame one.
  function bone(m, bx, by, bz) {
    return {
      m: m,
      b: [bx, by, bz],
      r: [m.rotation.x, m.rotation.y, m.rotation.z],
      o: [0, 0, 0], l: [NaN, NaN, NaN],
      ro: [0, 0, 0], rl: [NaN, NaN, NaN],
      jaw: false,
    };
  }

  // ==========================================================================
  //  RIG DISCOVERY
  // ==========================================================================
  function newRig(a, src) {
    var g = a.group;
    var rig = {
      a: a, src: src, gb: bone(g, g.position.x, g.position.y, g.position.z),
      front: [], rear: [], head: null, segs: null,
      maw: false, swimMaw: false,
      jx: 0, jy: 0, hx: 0, hy: 0, hz: 0, hspan: 0.3,
      legH: 0.5, reach: 0.4,
      // live layer weights — the public functions set these, the appliers sum them
      mawK: 0, worK: 0, worPh: 0, cantK: 0, dipK: 0,
      rearK: 0, swK: 0, swSide: -1, swCol: null,
      flatK: 0, crouchK: 0, extK: 0, shudK: 0, shudPh: 0, coilK: 0,
      // the knuckle-walker layers: both forearms hammering, both arms hoisting
      // a load, and the chest beat (drumPh is a rectified 0..1 pound, not an angle)
      slamK: 0, hoistK: 0, drumK: 0, drumPh: 0,
      // "is anything applied" latches so a resting actor costs nothing
      legsOn: 0, headOn: 0, bodyOn: 0, coilOn: 0, act: 0,
      cyc: 0, lp: 0,
    };

    var gt = a.gait;
    if (gt && gt.cols) {
      for (var c = 0; c < gt.cols.length; c++) {
        var col = gt.cols[c];
        var rec = { x: col.x, z: col.z, h: col.h || 0.4, parts: [] };
        for (var p = 0; p < col.parts.length; p++) {
          var pt = col.parts[p];
          // bases come from GAIT's own authored numbers, never from the live
          // mesh: a rig built mid-stride would otherwise bake the swing in.
          rec.parts.push(bone(pt.m, pt.bx, pt.by, pt.m.position.z));
        }
        if (rec.h > rig.legH) rig.legH = rec.h;
        // nose is +X, so a column in front of the origin is a FRONT leg.
        if (col.x > 0) rig.front.push(rec); else rig.rear.push(rec);
      }
      // sort by z so side=-1 / side=+1 mean the same paw every frame, on every
      // species, regardless of the order the model author added the boxes.
      rig.front.sort(function (u, v) { return u.z - v.z; });
      rig.rear.sort(function (u, v) { return u.z - v.z; });
      for (var r = 0; r < rig.rear.length; r++) {
        _t = Math.abs(rig.rear[r].x);
        if (_t > rig.reach) rig.reach = _t;      // hind-foot lever arm for the rear-up lift
      }
    }

    // ---- head cluster + the maw ------------------------------------------
    if (gt && gt.head && gt.head.length) {
      var hd = gt.head, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      var i;
      for (i = 0; i < hd.length; i++) {
        if (hd[i].bx < minX) minX = hd[i].bx;
        if (hd[i].bx > maxX) maxX = hd[i].bx;
        if (hd[i].by < minY) minY = hd[i].by;
        if (hd[i].by > maxY) maxY = hd[i].by;
      }
      var midX = (minX + maxX) * 0.5, midY = (minY + maxY) * 0.5;
      rig.head = [];
      var jawN = 0;
      for (i = 0; i < hd.length; i++) {
        var hb = bone(hd[i].m, hd[i].bx, hd[i].by, hd[i].m.position.z);
        // THE LOWER JAW, discovered exactly the way buildSwimRig finds a shark's:
        // the parts sitting in the LOWER half of the cluster's y-range AND
        // forward of its x-midpoint — i.e. the mandible and its tooth row, never
        // the skull, never an ear or a horn (those are high, or behind).
        if (hd[i].by <= midY && hd[i].bx >= midX && jawN < 14) { hb.jaw = true; jawN++; }
        rig.head.push(hb);
      }
      // hinge = the BACK of the head cluster, on the line that splits skull from
      // jaw. Hinging at the cluster's very top instead throws the tooth row up
      // through the snout when the mouth opens.
      rig.jx = minX; rig.jy = midY;
      rig.hspan = Math.max(0.08, maxY - minY);
      // head pivot for the thrash: the discovered head BOX if wildlife.js found
      // one (it is the block the aggro eyes ride), else the cluster centroid.
      if (gt.headMesh) {
        rig.hx = gt.headMesh.position.x; rig.hy = gt.headMesh.position.y; rig.hz = gt.headMesh.position.z;
      } else {
        _x = 0; _y = 0; _z = 0;
        for (i = 0; i < hd.length; i++) { _x += hd[i].bx; _y += hd[i].by; _z += hd[i].m.position.z; }
        rig.hx = _x / hd.length; rig.hy = _y / hd.length; rig.hz = _z / hd.length;
      }
      rig.maw = jawN > 0;
    }

    // ---- aquatic: the gape already exists and is proven. Delegate. --------
    if (a.swim) { rig.swimMaw = true; rig.maw = false; }

    // ---- snakes: the segment chain (no legs, no head cluster) -------------
    if (a.segs && a.segs.length) {
      rig.segs = [];
      for (var s = 0; s < a.segs.length; s++) {
        var sm = a.segs[s];
        if (!sm || !sm.position) continue;
        // snakeAnimate recomputes these procedurally every frame, so the bases
        // stored here are only a fallback — the coil composes with put/putTo.
        rig.segs.push(bone(sm, sm.position.x, sm.position.y, sm.position.z));
      }
      if (!rig.segs.length) rig.segs = null;
    }
    return rig;
  }

  // Idempotent. Rebuilds only if the rig it was derived from changed identity —
  // which happens exactly once, when wildlife.js finishes building a.gait/a.swim
  // AFTER something already asked us to pose the actor.
  function predatorRigBuild(a) {
    if (!a || !a.group || !a.group.position) return null;
    var src = a.gait || a.swim || (a.segs && a.segs.length ? a.segs : null);
    var rig = a._prig;
    if (rig && rig.src === src) return rig;
    rig = a._prig = newRig(a, src);
    return rig;
  }

  // ==========================================================================
  //  THE APPLIERS — one write per mesh per frame, summing every active layer
  // ==========================================================================
  function applyCols(rig, list, isFront) {
    for (var c = 0; c < list.length; c++) {
      var col = list[c], h = col.h;
      var ox = 0, oy = 0, rz = 0;

      // REAR-UP: the front legs go LIMP and leave the ground (the single most
      // important read on a bear — a rearing animal whose forelegs keep walking
      // reads as a bug), the hind legs take the load and compress a little.
      if (rig.rearK > 0) {
        if (isFront) { oy += h * REAR_LIFT * rig.rearK; ox += -h * 0.22 * rig.rearK; rz += 0.35 * rig.rearK; }
        else { oy += -h * 0.05 * rig.rearK; }
      }
      // SWAT: one front paw arcs up-forward then comes down. sin() for the lift
      // (it returns), eased ramp for the reach (it stays out through contact).
      if (rig.swK > 0 && col === rig.swCol) {
        _t = clamp01(rig.swK);
        oy += h * 0.5 * Math.sin(_t * Math.PI);
        ox += h * 1.0 * ease(_t);
        rz += 0.9 * ease(_t);                 // +z tips a box's top back, paw forward
      }
      // FLAT: the death roll and the constrictor's press — limbs folded against
      // the body, zero leg animation. Sourced biomechanics: a rolling crocodile
      // does no footwork at all, it is pure angular momentum.
      if (rig.flatK > 0) {
        oy += h * 0.32 * rig.flatK;
        ox += (col.x > 0 ? -1 : 1) * h * 0.18 * rig.flatK;
        rz += (isFront ? 0.5 : -0.5) * rig.flatK;
      }
      // CROUCH: the body sinks (applyBody drops the group); the legs move UP the
      // same distance in local units so the feet stay planted instead of sinking
      // through the floor with it.
      if (rig.crouchK > 0) oy += h * 0.18 * rig.crouchK;
      // EXTEND: mid-pounce — forelegs reach forward, hind legs trail back.
      if (rig.extK > 0) { ox += (isFront ? 1 : -1) * h * 0.45 * rig.extK; oy += h * 0.12 * rig.extK; }

      /* ---- THE KNUCKLE-WALKER LAYERS. On an ape the FRONT columns are arms,
         not legs — apes.js says so in its header and the discovery agrees
         (a 1.26 m ground-planted forearm reads as a leg by exactly the test
         that makes the gait work). Everything below is what arms do that legs
         cannot, and all three drive BOTH front columns because two hands is
         the whole difference from `swK`'s single paw. Derived, never tabled:
         any species whose front columns are long enough to matter gets them. */
      // SLAM: both forearms go up and hammer DOWN and forward together. 0..0.5
      // of the weight is the raise, 0.5..1 is the fall — a triangle, so the
      // caller's own strike envelope drives the whole arc with one number.
      if (rig.slamK > 0 && isFront) {
        _t = rig.slamK;
        var up = _t < 0.5 ? (_t * 2) : (1 - (_t - 0.5) * 2);
        oy += h * 0.95 * up;
        ox += h * (0.15 * up + 0.55 * (_t > 0.5 ? (_t - 0.5) * 2 : 0));
        rz += -0.9 * up + 0.5 * (_t > 0.5 ? (_t - 0.5) * 2 : 0);
      }
      // HOIST: both arms held HIGH and out — this is a body being carried at
      // the end of them, and it is the pose the whole flail hangs off.
      if (rig.hoistK > 0) {
        if (isFront) { oy += h * 1.05 * rig.hoistK; ox += h * 0.42 * rig.hoistK; rz += -1.05 * rig.hoistK; }
        else { oy += -h * 0.08 * rig.hoistK; }   // hind legs take the load and dig in
      }
      // DRUM: the chest beat. Elbows in, hands high and close, pounding — the
      // frequency is the caller's (it rides drumK as a rectified oscillation).
      if (rig.drumK > 0 && isFront) {
        oy += h * (0.72 + 0.16 * rig.drumPh) * clamp01(rig.drumK);
        ox += -h * 0.30 * clamp01(rig.drumK);
        rz += (-0.55 - 0.35 * rig.drumPh) * clamp01(rig.drumK);
      }

      for (var p = 0; p < col.parts.length; p++) {
        var b = col.parts[p];
        set(b, AX, ox); set(b, AY, oy); setR(b, AZ, rz);
      }
    }
  }
  function applyLegs(rig) {
    var live = (rig.rearK > 0 || rig.swK > 0 || rig.flatK > 0 || rig.crouchK > 0 || rig.extK > 0 ||
                rig.slamK > 0 || rig.hoistK > 0 || rig.drumK > 0) ? 1 : 0;
    if (!live && !rig.legsOn) return;          // resting: costs nothing
    rig.legsOn = live;
    applyCols(rig, rig.front, true);
    applyCols(rig, rig.rear, false);
  }

  function applyHead(rig) {
    var hd = rig.head; if (!hd) return;
    var live = (rig.mawK > 0 || rig.worK > 0 || rig.cantK > 0 || rig.dipK > 0) ? 1 : 0;
    if (!live && !rig.headOn) return;
    rig.headOn = live;
    // the gape, about the discovered hinge (same rotation swimJaw uses)
    var th = -rig.mawK * MAW_ANGLE;
    var jc = Math.cos(th), js = Math.sin(th);
    // the thrash: a decaying-sine head shake at WORRY_HZ, plus a static cant for
    // the death roll (head and tail canted off the roll axis) and the head-drop
    // that gore/ram/worry all want.
    var yaw = Math.sin(rig.worPh) * WORRY_YAW * rig.worK + rig.cantK * 0.35;
    var roll = Math.sin(rig.worPh * 0.5 + 1.0) * WORRY_ROLL * rig.worK + rig.cantK * 0.5;
    var drop = -rig.hspan * (0.35 * rig.worK + 0.55 * rig.dipK);
    var yc = Math.cos(yaw), ys = Math.sin(yaw);
    for (var i = 0; i < hd.length; i++) {
      var b = hd[i], bx = b.b[AX], by = b.b[AY], bz = b.b[AZ];
      _x = bx; _y = by; _z = bz;
      if (b.jaw && th !== 0) {                 // 1) swing the mandible about the hinge
        var dx = bx - rig.jx, dy = by - rig.jy;
        _x = rig.jx + dx * jc - dy * js;
        _y = rig.jy + dx * js + dy * jc;
      }
      if (yaw !== 0) {                         // 2) yaw the WHOLE cluster (jaw included) about the head pivot
        var ex = _x - rig.hx, ez = _z - rig.hz;
        _x = rig.hx + ex * yc + ez * ys;
        _z = rig.hz - ex * ys + ez * yc;
      }
      _y += drop;
      set(b, AX, _x - bx); set(b, AY, _y - by); set(b, AZ, _z - bz);
      setR(b, AY, yaw); setR(b, AX, roll); setR(b, AZ, b.jaw ? th : 0);
    }
  }

  function applyBody(rig) {
    // AN APE STANDS UP TO USE ITS HANDS, and that is the same rotation a bear's
    // rear-up is — so hoist and drum feed the identical pitch/lift maths rather
    // than a second, subtly different one. `rearE` is the EFFECTIVE rear the
    // sagitta compensation must cancel; forgetting these two here is exactly the
    // buried-hind-leg bug the note below records, in a new coat.
    var rearE = rig.rearK + rig.hoistK * 0.62 + rig.drumK * 0.70;
    var live = (rearE > 0 || rig.crouchK > 0 || rig.shudK > 0 || rig.slamK > 0) ? 1 : 0;
    if (!live && !rig.bodyOn) return;
    rig.bodyOn = live;
    var g = rig.gb.m;
    var sy = (g.scale && g.scale.y) ? g.scale.y : 1;
    // model-local pitch (see the r128 note at the top): +z lifts the nose.
    var pitch = rearE * REAR_PITCH - rig.crouchK * 0.12;
    if (rig.shudK > 0) pitch += Math.sin(rig.shudPh) * 0.02 * rig.shudK;
    // the overhead hammer takes the whole trunk over with it: up on the raise,
    // driven down past level on the fall (a triangle off the same slamK)
    if (rig.slamK > 0) {
      pitch += (rig.slamK < 0.5 ? rig.slamK * 2 : -(rig.slamK - 0.5) * 2) * 0.42;
    }
    // Pitching about the model origin drives the HIND feet below the floor
    // (a point at -x rotates down), so lift the group by the sagitta of that
    // rotation. Child offsets are group-LOCAL but the group's y is WORLD, hence
    // the scale factor — forgetting it sinks a big animal into the ground.
    // WE ARE NOT THE ONLY WRITER OF THIS PITCH. predator.js's `maul` writes the
    // group's rear straight onto rotation.z every frame (deliberately — the
    // style has to read with this file absent), and putR composes on top of
    // whatever it finds. Computing the sagitta from OUR pitch alone left the
    // bear rotated ~1.36 rad while lifting for only 0.44 of it, burying half a
    // metre of hind leg in the terrain at the top of every rear. The lift must
    // cancel the TOTAL rotation, so read the co-writer's contribution first.
    // Only while actually rearing: gaitAnimate's ordinary slope/sway pitch is
    // meant to follow the ground, and compensating THAT would hover the animal.
    var lift;
    if (rearE > 0) {
      var curZ = rd(g.rotation, AZ);
      var baseZ = (curZ === rig.gb.rl[AZ]) ? curZ - rig.gb.ro[AZ] : curZ;
      var total = baseZ + pitch;
      lift = (total > 0 ? Math.sin(total) * rig.reach : 0);
    } else {
      lift = (pitch > 0 ? Math.sin(pitch) * rig.reach : 0);
    }
    lift -= rig.crouchK * rig.legH * 0.18;
    putR(rig.gb, AZ, pitch);
    put(rig.gb, AY, lift * sy);
  }

  function applyCoil(rig) {
    var segs = rig.segs; if (!segs) return;
    var live = rig.coilK > 0 ? 1 : 0;
    if (!live && !rig.coilOn) return;
    rig.coilOn = live;
    var a = rig.a;
    var sp = (typeof a.spacing === 'number' && a.spacing > 0) ? a.spacing : 0.3;
    // How many segments make one turn — derived from the chain's own length so a
    // garter snake and an anaconda both close a believable loop.
    var loop = Math.max(5, Math.min(9, segs.length * 0.5));
    var dA = TAU / loop;
    // The tightening: radius SHRINKS as k rises, so escalating pulses read as a
    // squeeze that is winning. (Real constriction stops circulation in seconds —
    // it must read fast and escalating, not as a slow drain.)
    var R = (sp * loop) / TAU * (1 - 0.30 * rig.coilK);
    for (var i = 0; i < segs.length; i++) {
      var ang = i * dA;
      // head end (i=0) stays where snakeAnimate put it; the body wraps behind it
      putTo(segs[i], AX, R * Math.cos(ang) - R, rig.coilK);
      putTo(segs[i], AZ, R * Math.sin(ang), rig.coilK);
    }
  }

  // Hand EVERYTHING back: every layer to zero, one final write per mesh, then
  // latch off. Called whenever a caller passes k<=0 (or a garbage k) — that is
  // the contract that guarantees a pose can never be left stuck on an actor.
  function release(rig) {
    if (!rig.act && !rig.legsOn && !rig.headOn && !rig.bodyOn && !rig.coilOn) return;
    rig.mawK = rig.worK = rig.cantK = rig.dipK = 0;
    rig.rearK = rig.swK = rig.flatK = rig.crouchK = rig.extK = rig.shudK = rig.coilK = 0;
    rig.slamK = rig.hoistK = rig.drumK = rig.drumPh = 0;
    rig.swCol = null;
    applyLegs(rig); applyHead(rig); applyBody(rig); applyCoil(rig);
    // a delegated gape has to be shut here too, or a shark that let go keeps its
    // mouth hanging open for the rest of its life.
    if (rig.swimMaw && CBZ.swimJaw) { try { CBZ.swimJaw(rig.a, 0); } catch (e) {} }
    rig.act = 0;
  }

  // ==========================================================================
  //  PUBLIC POSES — each one sets its weights and re-runs the appliers, so any
  //  of them can be called on its own or in any combination in the same frame.
  //
  //  THEY ARE LATCHES, NOT ONE-SHOTS. Each owns exactly one layer and holds it
  //  until you say otherwise: call it again with k = 0 to drop that layer, or
  //  `predatorPose(a, style, 0, 0, 0)` to release the whole rig at once. A
  //  caller that raises a layer and then simply stops calling leaves the animal
  //  posed forever — which is correct for an animation system and a trap for a
  //  probe. `predatorPose` is the real API; these exist so a future consumer can
  //  build a pose this file does not know about yet.
  // ==========================================================================
  function predatorMaw(a, k) {
    if (!ON()) return;
    // aquatic: the shark's gape is already proven and already owns these meshes.
    if (a && a.swim) { if (CBZ.swimJaw) { try { CBZ.swimJaw(a, clamp01(k)); } catch (e) {} } return; }
    var rig = predatorRigBuild(a); if (!rig || !rig.maw) return;   // no head cluster: no-op
    rig.mawK = clamp01(k); if (rig.mawK > 0) rig.act = 1;
    applyHead(rig);
  }

  function predatorRear(a, k) {
    if (!ON()) return;
    var rig = predatorRigBuild(a); if (!rig) return;
    rig.rearK = clamp01(k); if (rig.rearK > 0) rig.act = 1;
    applyLegs(rig); applyBody(rig);
  }

  function predatorSwat(a, k, side) {
    if (!ON()) return;
    var rig = predatorRigBuild(a); if (!rig || !rig.front.length) return;
    rig.swK = clamp01(k);
    rig.swSide = (side < 0) ? -1 : 1;
    // z-sorted, so this is the same paw every frame for every species.
    rig.swCol = rig.swK > 0 ? (rig.swSide < 0 ? rig.front[0] : rig.front[rig.front.length - 1]) : null;
    if (rig.swK > 0) rig.act = 1;
    applyLegs(rig);
  }

  function predatorWorry(a, k, ph) {
    if (!ON()) return;
    var rig = predatorRigBuild(a); if (!rig || !rig.head) return;
    rig.worK = clamp01(k);
    if (typeof ph === 'number' && isFinite(ph)) rig.worPh = ph;
    if (rig.worK > 0) rig.act = 1;
    applyHead(rig);
  }

  function predatorCoil(a, k) {
    if (!ON()) return;
    var rig = predatorRigBuild(a); if (!rig || !rig.segs) return;
    rig.coilK = clamp01(k); if (rig.coilK > 0) rig.act = 1;
    applyCoil(rig);
  }

  // ==========================================================================
  //  THE COMPOSER — the single entry both consumers call.
  //    style : a SEIZE style (maul|worry|pin|constrict|shake|roll|drag) or an
  //            ATTACK style (maul|pounce|lunge|bite|strike|ram|gore|stomp|peck)
  //    p     : 0..1 phase. Attack callers pass a one-shot progress; seize
  //            callers pass a looping phase — the cyclic styles read frac(p) so
  //            both work, and a wrap flips the swat side (left, right, left...).
  //    k     : 0..1 weight. k<=0 means "let go", and it fully restores the rig.
  // ==========================================================================
  function predatorPose(a, style, p, k, dt) {
    if (!ON()) return;
    var rig = predatorRigBuild(a); if (!rig) return;
    if (!(k > 0)) { release(rig); return; }         // also catches NaN/undefined
    if (k > 1) k = 1;
    if (typeof p !== 'number' || !isFinite(p)) p = 0;
    if (typeof dt !== 'number' || !isFinite(dt) || dt < 0) dt = 0;

    var f = frac(p);
    if (f < rig.lp) rig.cyc++;                      // a phase wrap = one more beat
    rig.lp = f;
    var side = (rig.cyc & 1) ? 1 : -1;
    // free-running jitter phases (the "alive-ness" layer that sits on top of the
    // eased pose blends — this is what stops a static bite-hold reading as dead)
    rig.worPh += dt * WORRY_HZ * TAU;
    rig.shudPh += dt * SHUDDER_HZ * TAU;
    if (rig.worPh > 1e6) rig.worPh -= 1e6;
    if (rig.shudPh > 1e6) rig.shudPh -= 1e6;

    // every layer starts at zero each frame; only the branch below raises them
    var maw = 0, wor = 0, cant = 0, dip = 0;
    var rear = 0, sw = 0, flat = 0, crouch = 0, ext = 0, shud = 0, coil = 0;
    var slam = 0, hoist = 0, drum = 0, drumPh = 0;
    var t;

    switch (style) {
      // ---- SEIZE: maul — THE BEAR. An asymmetric SAW, never a sine: the
      //      rhythm is the horror. You can hear the next slam coming.
      // ONE CLOCK, ONE SET OF THRESHOLDS. These were 0.55/0.67 against
      // predator.js's 0.57/0.70 on the same cycle fraction, which is not a
      // rounding difference: at the frame the slam beat latches, the body was
      // still 37 degrees in the air while the forelegs had already planted and
      // the swat was 76% through its arc — the trauma, hitstop and impact cue
      // all landing on nothing. Matched to CORE exactly; if either moves, both
      // move.
      case 'maul':
        if (f < 0.57) {                              // REAR (slow, ~0.57 of the cycle)
          t = ease(f / 0.57);
          rear = 0.8 * t; maw = 0.25 + 0.5 * t;
        } else if (f < 0.70) {                       // SLAM (fast, ~0.13)
          t = (f - 0.57) / 0.13;
          rear = 0.8 * (1 - ease(t)); maw = 0.75 * (1 - t); sw = t;
        } else {                                     // press and worry, then repeat
          t = (f - 0.70) / 0.30;
          rear = 0.06; maw = 0.15; wor = Math.sin(t * Math.PI) * 0.5;
        }
        break;

      // ---- SEIZE: worry — the dog/wolf. Head yawing hard with the maw SHUT
      //      (the grip is behavioural refusal to let go, not a locking jaw),
      //      body low and driving. The backward drag is root motion and belongs
      //      to the caller — this is the body on top of it.
      case 'worry':
        wor = 1; maw = 0.05; crouch = 0.3;
        break;

      // ---- SEIZE: pin — the big cat. The scare is STILLNESS: the body stops,
      //      one paw holds, the maw is shut on the throat and the only motion is
      //      a tight micro-shudder... until one hard yank at the end of the beat.
      case 'pin':
        maw = 0.12; sw = 0.55; crouch = 0.35; shud = 1;
        // THE YANK IS A PULSE, NOT A RAMP — predator.js drives the body's yank
        // as a sine that peaks at 0.935 and is back to zero by 0.99. A monotone
        // ramp here put the head layer at maximum exactly as the body finished,
        // so the cat's one hard yank and its head never once coincided. Same
        // shape, same window, off the same number.
        if (f > 0.88) { t = Math.sin(Math.min(1, (f - 0.88) / 0.11) * Math.PI); wor = 0.8 * t; maw += 0.3 * t; }
        break;

      // ---- SEIZE: constrict — the snake. No thrash at all; the coil tightens
      //      in PULSES, each one landing tighter than the last.
      case 'constrict':
        coil = clamp01((0.4 + 0.6 * clamp01(p)) * (0.62 + 0.38 * Math.sin(f * TAU * 3)));
        break;

      // ---- SEIZE: roll — the death roll. Limbs pressed FLAT, head and tail
      //      canted off-axis, ZERO leg animation. The ~1.6 Hz spin about the
      //      long axis is the group transform and predator.js owns it (a true
      //      body-local roll needs rotation.order='YXZ'); we do the body.
      case 'roll':
        flat = 1; cant = 1; maw = 0.1;
        break;

      // ---- SEIZE: drag — hauling the prey. Low, braced, jaw shut. The
      //      low-frequency speed modulation on the root is the caller's.
      case 'drag':
        crouch = 0.4; maw = 0.02; wor = 0.2;
        break;

      // ---- SEIZE: shake (the default) — a straight thrash, and the maw WORKS
      //      the prey rather than sitting at a constant gape. predator.js hands
      //      us a real phase for this; ignoring it (as a flat `maw = 0.2` did)
      //      froze every open-world shark's jaw for the whole seize while the
      //      phase it computed went nowhere.
      case 'shake':
        wor = 0.85; maw = 0.35 + 0.35 * Math.sin(f * TAU);
        break;

      // ---- ATTACK: pounce — crouch, then extended flight, maw open at contact.
      //      The parabolic root arc is animateAttack's; this is the pose blend
      //      keyed to the same normalised time.
      case 'pounce':
        if (p < STRIKE_AT) { t = windup(p); crouch = t; maw = 0.2 * t; }
        else {
          t = ease(Math.min(1, ((p - STRIKE_AT) / (1 - STRIKE_AT)) * 1.6));
          ext = t; crouch = 0; maw = clamp01(env(p) * 1.4);
        }
        break;

      // ---- ATTACK: lunge — aquatic. creature_combat's own swimJaw call owns
      //      the shark's gape (one master), and there are no legs to pose.
      case 'lunge':
        break;

      // ---- ATTACK: strike — the snake. snakeAnimate drives the head lunge;
      //      the coil GATHERS during the windup and releases through the strike.
      case 'strike':
        coil = windup(p) * 0.6;
        break;

      // ---- ATTACK: ram / gore — no bite at contact: the head goes DOWN and the
      //      mass drives through. Horns, not teeth.
      case 'ram':
        dip = Math.max(windup(p), env(p)) * 0.8; crouch = 0.2 * env(p);
        break;
      // GORE is the one attack in the vocabulary that is not a straight line.
      // A boar does not stab: it drives in with the head LOW and then throws it
      // UP AND ACROSS, and that upward-lateral hook is the whole read — a tusk
      // works sideways because that is the axis it is mounted on. `dip` alone
      // (which is all this row used to be) is a hammer, and a hammer is what
      // `ram` already is. So the windup keeps the dip and the strike TRADES it
      // for a cant: the head comes off the floor and swings, and because
      // applyHead composes yaw and roll from the same cantK the tusk arcs
      // rather than sweeping flat. `side` alternates on every phase wrap, so
      // repeated passes hook from alternating sides for free.
      case 'gore':
        t = windup(p);
        if (p < STRIKE_AT) { dip = t * 0.95; }
        else {
          var gk = (p - STRIKE_AT) / (1 - STRIKE_AT);
          var hook = Math.sin(Math.min(1, gk * 1.75) * Math.PI);
          dip = env(p) * 0.55 * (1 - hook);   // the head is released as it hooks
          cant = hook * 0.85;
        }
        break;

      // ---- ATTACK: stomp — rear onto the hind legs, then bring BOTH forefeet
      //      down. The rear-up here is the same discovered lift the bear uses.
      case 'stomp':
        if (p < STRIKE_AT) rear = windup(p) * 0.7;
        else { t = (p - STRIKE_AT) / (1 - STRIKE_AT); rear = 0.7 * (1 - ease(t)); sw = ease(Math.min(1, t * 1.6)); }
        break;

      // ---- ATTACK: peck — the beak opens on each high-frequency jab, matching
      //      creature_combat's own 6-per-strike jab rate.
      case 'peck':
        maw = Math.max(0, Math.sin(p * Math.PI * 6)) * env(p);
        break;

      /* ======================= THE APE FAMILY =============================
         A knuckle-walker's front columns are ARMS, and these are the six
         things arms do that no other land style in this file could ask for.
         systems/ape_combat.js owns WHICH one is thrown and what it costs; this
         owns what the body does while it happens. Every one of them composes
         out of the layers above plus the three added for hands, so nothing
         here is a species table — a chimpanzee, a mandrill and whatever ape
         ships next all animate off the same six rows for free. */

      // CHARGE — the quadrupedal rush. It stays DOWN: the whole point of a
      // silverback charge is that it arrives on four limbs at speed and the
      // rear-up (if any) is on the far side of contact.
      case 'ape_charge':
        if (p < STRIKE_AT) { crouch = windup(p) * 0.75; maw = 0.15 * windup(p); }
        else {
          t = ease(Math.min(1, ((p - STRIKE_AT) / (1 - STRIKE_AT)) * 1.9));
          ext = t; crouch = 0.4 * (1 - t); maw = clamp01(env(p) * 1.2);
        }
        break;

      // SMASH — both forearms up and over. `slam` is a triangle by construction
      // (see applyCols), so it is handed the raw 0..1 progress and does the
      // raise and the fall itself; the body pitch follows it in applyBody.
      case 'ape_smash':
        slam = clamp01(p);
        maw = 0.25 + 0.55 * env(p);              // it roars into the blow
        break;

      // BACKHAND — the arm that swings is the one on the swing side, thrown
      // out and across at full extension. The body's yaw is creature_combat's
      // (a sweep IS the trunk turning); this is the arm on the end of it.
      case 'ape_sweep':
        t = env(p);
        sw = t;                                   // one arm, the existing swat layer
        ext = 0.35 * t;
        maw = 0.2 + 0.4 * t;
        break;

      // GRAB — low and committed. The arm goes UNDER, so the body drops on the
      // reach and then STANDS UP into the hoist as the load comes off the
      // ground; that hand-over is the whole tell that he has got someone.
      case 'ape_grab':
        if (p < STRIKE_AT) { crouch = windup(p) * 0.8; ext = windup(p) * 0.7; maw = 0.3 * windup(p); }
        else {
          t = ease((p - STRIKE_AT) / (1 - STRIKE_AT));
          crouch = 0.8 * (1 - t); ext = 0.7 * (1 - t * 0.5);
          hoist = t * 0.55; maw = 0.55;
        }
        break;

      // FLAIL — the hold itself. Arms locked high with the mass on the end,
      // maw open the whole way round (it is screaming; a spinning silverback
      // is not doing this quietly), and a small periodic surge as the weight
      // comes past the front of the swing.
      case 'ape_flail':
        hoist = 0.85 + 0.15 * Math.sin(f * TAU);
        maw = 0.55 + 0.35 * Math.max(0, Math.sin(f * TAU));
        wor = 0.25;
        break;

      // BITE — the canines. Harder and shorter than the generic biter's gape:
      // this mouth is a finisher.
      case 'ape_bite':
        maw = clamp01(env(p) * 1.75);
        dip = 0.35 * env(p);
        break;

      // DRUM — the chest beat. Reared, planted, hands pounding at ~10 Hz. The
      // rectified sine IS the pound; it deliberately produces no travel and no
      // damage, and it is still the most recognisable thing a gorilla does.
      case 'ape_drum':
        t = Math.min(1, p * 2.8) * (1 - ease(Math.max(0, p - 0.74) / 0.26));
        drum = t;
        drumPh = Math.abs(Math.sin(p * Math.PI * 10));
        maw = 0.45 * t;
        break;

      // ---- ATTACK: bite (and anything unknown) — the mouth opens on the strike
      //      envelope and shuts on the far side. This is the line that finally
      //      gives every generic biter in the game a moving jaw.
      default:
        maw = clamp01(env(p) * 1.5);
        break;
    }

    // ATTACK styles on an aquatic actor never touch the maw: creature_combat's
    // existing swimJaw call is the single master of a shark's gape.
    if (a.swim && style !== 'shake' && style !== 'roll' && style !== 'drag' &&
        style !== 'worry' && style !== 'pin' && style !== 'maul') maw = 0;

    rig.mawK = clamp01(maw * k);
    rig.worK = clamp01(wor * k);
    rig.cantK = clamp01(cant * k);
    rig.dipK = clamp01(dip * k);
    rig.rearK = clamp01(rear * k);
    rig.flatK = clamp01(flat * k);
    rig.crouchK = clamp01(crouch * k);
    rig.extK = clamp01(ext * k);
    rig.shudK = clamp01(shud * k);
    rig.coilK = clamp01(coil * k);
    rig.swK = clamp01(sw * k);
    // the hand layers. slamK is a PHASE, not a weight — it must reach 1.0 for
    // the hammer to complete its fall — so it is scaled by k only enough to
    // fade in and out, never enough to truncate the arc.
    rig.slamK = (slam > 0) ? clamp01(slam) : 0;
    rig.hoistK = clamp01(hoist * k);
    rig.drumK = clamp01(drum * k);
    rig.drumPh = drumPh;
    // WHICH ARM. Normally the phase-wrap alternation above (left, right, left…).
    // An ape's backhand is different: creature_combat turns the whole TRUNK for
    // it off `_apeSide`, so the arm has to be the one that trunk is throwing or
    // the body swings one way and the hand the other.
    if (style === 'ape_sweep' && a._apeSide) side = a._apeSide;
    rig.swCol = (rig.swK > 0 && rig.front.length)
      ? (side < 0 ? rig.front[0] : rig.front[rig.front.length - 1]) : null;
    rig.swSide = side;
    rig.act = 1;

    // the maw layer lives on the head meshes, so aquatic delegation happens here
    if (rig.swimMaw && rig.mawK > 0 && CBZ.swimJaw) { try { CBZ.swimJaw(a, rig.mawK); } catch (e) {} }
    applyLegs(rig);
    applyHead(rig);
    applyBody(rig);
    applyCoil(rig);
  }

  // What did discovery actually find? For probes — read it immediately, the
  // object is reused (same discipline as creature_combat's RES).
  function predatorRigInfo(a) {
    INFO.front = 0; INFO.rear = 0; INFO.maw = false; INFO.head = false; INFO.segs = 0;
    var rig = predatorRigBuild(a);
    if (!rig) return INFO;
    INFO.front = rig.front.length;
    INFO.rear = rig.rear.length;
    INFO.maw = !!(rig.maw || (rig.swimMaw && a.swim && a.swim.jaw));
    INFO.head = !!rig.head;
    INFO.segs = rig.segs ? rig.segs.length : 0;
    return INFO;
  }

  // ---- expose ---------------------------------------------------------------
  CBZ.predatorRigBuild = predatorRigBuild;
  CBZ.predatorMaw = predatorMaw;
  CBZ.predatorRear = predatorRear;
  CBZ.predatorSwat = predatorSwat;
  CBZ.predatorWorry = predatorWorry;
  CBZ.predatorCoil = predatorCoil;
  CBZ.predatorPose = predatorPose;
  CBZ.predatorRigInfo = predatorRigInfo;
})();
