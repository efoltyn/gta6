/* ============================================================
   systems/verbs_pickup.js — CBZ.verbs.pickup: TAKING A THING, WITH A HAND.

   OWNER: "you press Take keycard and it doesn't actually show you picking
   it up." Every take in the game was the same two lines: hide the mesh, add
   the item. The card on the desk simply stopped existing on the frame you
   pressed E. This is the one verb every take/grab-an-item action goes
   through (keycard, cash, guns, loot, stash items, keys), for the player and
   for anyone else who picks something up.

     CBZ.verbs.pickup(actor, item, opts) -> P (a handle) or null
       actor   the player (CBZ.player / a player adapter) or any NPC actor the
               CBZ.verbs.body adapter understands (a.char / a.ch / a rig)
       item    the world Object3D being taken, or a descriptor
               { obj?, x, y, z, kind? } (kind picks a stand-in when there is
               no mesh: "card" | "cash" | "gun" | "bag" | "key" | "box")
       opts    onTaken()   the game's consequence: inventory, flags, sfx. It
                           fires EXACTLY ONCE, at the grab frame (the hand is on
                           the thing), or at once if the verb cannot play (no
                           rig, in a vehicle, headless). A cancelled pickup
                           still fires it, so a take is never lost.
               onDone()    after the hand is back
               hand        "r" | "l" (default: the free hand; "l" when armed)
               pose        "card" (thin: cards, cash, paper) | "grip" (a
                           handle, a gun, a bottle) | "fist" | "open"
                           (default from the item's size)
               dur         seconds (default 0.36 in first person, 0.6-0.95 in
                           third person by the item's height)
               keep        true: the thing ends up held (a gun you now carry),
                           the hand brings it to the chest; false (default): it
                           goes into a pocket
               leave       true: the world object is NOT hidden (taking one
                           from a pile that stays)
               (the handle's P.cancel() ends it early and still takes;
               P.abort() ends it with no take and puts the thing back)
               key         a de-dup key for descriptor items (an Object3D is
                           its own key): a second pickup of the same item while
                           the first is running returns the first handle and
                           never fires onTaken twice.
               copy        false: a reach with nothing coming away in the hand
                           (the thing stays, or there is nothing to show)
               lens        true: play it on a hand drawn in the camera even
                           when first person is off (automatic whenever the
                           player's body is hidden, e.g. an inspect camera)

     CBZ.verbs.takeFrom(actor, body, opts) — a reach into a person or a corpse
       (a pocket, a hip, a collar: opts.at names a CBZ.verbs contact point,
       default "pocketR"); a stand-in (opts.kind: "cash" wallet, "key", ...)
       comes out in the hand. Same opts as pickup.

     CBZ.verbs.putDown(actor, item, spot, opts) — the same reach reversed. The
       thing (hidden until then) comes out of the pocket in the hand, is set
       down so it lands exactly as `item` rests (spot {x,y,z} overrides where
       the hand aims), and the hand goes back. Phases reach -> release ->
       withdraw -> done; opts.onPlaced() fires on the release frame (the real
       object reappears there), onDone after. Same hand/pose/dur/lens opts.

   A MOVING PLAYER is not pulled onto the thing: faster than a stroll the take
   skips the step-in and the turn, the body dips less and the whole beat is
   shorter (a scoop on the move); the thing trails to the hand if it lay out
   of reach.

   PHASES: reach -> close -> lift -> done (first person with a gun out adds
   lower before and raise after: the gun dips out of frame, the hand does
   the take, the gun comes back).
     reach  the hand travels to the thing (FP: along the ray to its screen
            position; TP: the body bends by the thing's height — a waist lean
            for a desk, hips down and knees bent for the floor, upright for a
            shelf — and the arm is solved onto it)
     close  THE GRAB FRAME opens this phase: the world object is hidden, a
            visual copy of it is put in exactly the same place (the same
            screen position in first person) and from then on it moves with the
            hand, seating into the palm; the hand closes (card / grip); the
            game's onTaken fires.
     lift   the hand brings it up and away: into a pocket (out of view in
            first person), or to the chest when kept; the body stands.

   FIRST PERSON is systems/fpsmode.js's hands: fpsmode calls
   CBZ.verbs.fpPickup(vm, fistT, handR, handL, armed) once per frame just
   before it solves its arms; for the length of the take this file writes one
   fist's wrist target (vm space), roll, bend and curl, and says whether the
   gun must dip. The copy of the item lives in the viewmodel (drawn after the
   depth clear like the hands) and is scaled about the eye, so on the grab
   frame it covers exactly the pixels the real one did.

   THIRD PERSON is a late pose layer: CBZ.onUpdate(91.5) (after animChar,
   reactions 89, grapple 90 and the verbs core 91) writes damped-by-phase
   absolute rotations, CBZ.lockCharacterHips, then the arm solve
   (CBZ.verbs.handTo when the core is loaded, CBZ.charArmTo otherwise) and
   the hand pose. It re-asserts once more at CBZ.onAlways(54.7), after
   gunhands (54.6) has put an armed player's off hand back on the gun.

   Loads in any order, feature-detects everything, allocates nothing per
   frame while a take runs (the copy is built once, at the grab frame).
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ = root.CBZ || {};
  const THREE = root.THREE;
  const V = CBZ.verbs = CBZ.verbs || {};
  if (V._pickupLoaded) return;
  V._pickupLoaded = true;

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; }

  function instant(item, opts) {
    // nothing can play the take: the consequence still happens, the thing still goes
    const obj = item && (item.isObject3D ? item : item.obj);
    if (obj && obj.isObject3D && !(opts && opts.leave)) obj.visible = false;
    fire(opts && opts.onTaken);
    fire(opts && opts.onDone);
    return null;
  }
  function fire(fn, arg) {
    if (typeof fn !== "function") return;
    try { fn(arg); } catch (e) { if (root.console) console.error("[verbs.pickup]", e); }
  }

  if (!THREE) {
    V.pickup = function (actor, item, opts) { return instant(item, opts || {}); };
    return;
  }

  /* ============================================================
     THE ACTOR (the core's adapter when it is loaded; a minimal one if not)
     ============================================================ */
  function isPlayer(a) {
    if (!a) return false;
    if (V.isPlayer) return V.isPlayer(a);
    return a.isPlayer === true || a === CBZ.player;
  }
  function bodyOf(a) {
    if (V.body) {
      const pa = isPlayer(a) && V.playerActor ? V.playerActor() : a;
      const B = V.body(pa);
      if (B) {
        if (B.isPlayer && CBZ.playerChar) B.ch = CBZ.playerChar;
        if (B.isPlayer && CBZ.player && CBZ.player.pos) B.pos = CBZ.player.pos;
        return B;
      }
    }
    // no core loaded: a small adapter of our own (once per take, not per frame)
    const B = { a: a, ch: null, pos: null, isPlayer: isPlayer(a), hipY: 0.665, shoulderY: 1.29, arm: 0.63, scale: 0.7 };
    B.ch = B.isPlayer ? (CBZ.playerChar || null) : ((a.char && a.char.parts) ? a.char : (a.ch && a.ch.parts) ? a.ch : (a.parts && a.group) ? a : null);
    B.pos = B.isPlayer ? (CBZ.player && CBZ.player.pos) : (a.pos || (a.group && a.group.position) || (B.ch && B.ch.group && B.ch.group.position) || null);
    const ch = B.ch, s = (ch && ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.7;
    const P = (ch && ch.profile) || {};
    B.scale = s;
    B.hipY = (ch && ch.hipY || 0.95) * s;
    B.shoulderY = ((ch && ch.hipY || 0.95) - 0.005 + (P.torsoH || 0.95) - 0.055) * s;
    B.arm = (CBZ.charArmTo && CBZ.charArmTo.span && ch) ? CBZ.charArmTo.span(ch, "r") : 0.63;
    return B;
  }
  function actorDead(a, B) {
    if (B.isPlayer) return !!(CBZ.player && CBZ.player.dead);
    return !!(a && a.dead);
  }
  function fpActive() { return !!(CBZ.fpsActive && CBZ.fpsActive()); }
  function playerBusy() {
    const p = CBZ.player;
    if (!p) return false;
    return !!(p.driving || p.inCar || p.vehicle || p.seated || p.swimming);
  }
  function armedNow(B) {
    if (B.isPlayer) return !!(CBZ.playerArmed && CBZ.playerArmed());
    const a = B.a;
    return !!(a && (a.armed || a.gun || a.weapon));
  }

  /* ============================================================
     THE COPY THAT TRAVELS WITH THE HAND
     Object3D.clone() JSON-copies userData (actors, pools, circular refs), so
     the copy is built by hand: meshes and sprites share geometry and
     material, groups keep their transforms.
     ============================================================ */
  function copyNode(o) {
    let c = null;
    if (o.isInstancedMesh) return null;
    if (o.isMesh) c = new THREE.Mesh(o.geometry, o.material);
    else if (o.isSprite) c = new THREE.Sprite(o.material);
    else if (o.isLight || o.isCamera || o.isLine || o.isPoints) return null;
    else c = new THREE.Group();
    c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale);
    c.visible = o.visible;
    c.castShadow = false; c.receiveShadow = false;
    for (let i = 0; i < o.children.length; i++) {
      const k = copyNode(o.children[i]);
      if (k) c.add(k);
    }
    return c;
  }
  let _standMats = null;
  function standIn(kind) {
    if (!_standMats) {
      _standMats = {
        card: new THREE.MeshLambertMaterial({ color: 0xf0efe8 }),
        cash: new THREE.MeshLambertMaterial({ color: 0x5f8f55 }),
        gun: new THREE.MeshLambertMaterial({ color: 0x1d2126 }),
        bag: new THREE.MeshLambertMaterial({ color: 0x2c2f33 }),
        key: new THREE.MeshLambertMaterial({ color: 0xc9a13a }),
        box: new THREE.MeshLambertMaterial({ color: 0x8a6d4a }),
      };
    }
    const dims = {
      card: [0.086, 0.003, 0.054], cash: [0.156, 0.014, 0.066], gun: [0.20, 0.13, 0.035],
      bag: [0.30, 0.22, 0.16], key: [0.06, 0.006, 0.025], box: [0.12, 0.08, 0.10],
    };
    const k = dims[kind] ? kind : "box";
    const d = dims[k];
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(d[0], d[1], d[2]), _standMats[k]);
    m.userData._pickupOwnGeo = true;
    g.add(m);
    return g;
  }
  function disposeCopy(P) {
    const c = P.proxy;
    if (!c) return;
    if (c.parent) c.parent.remove(c);
    c.traverse(function (o) {
      if (o.userData && o.userData._pickupOwnGeo && o.geometry) o.geometry.dispose();
    });
    for (let i = 0; i < P.fpMats.length; i++) P.fpMats[i].dispose();
    P.fpMats.length = 0;
    P.proxy = null;
  }
  // the copy goes into the viewmodel: drawn after the depth clear, like the hands
  function toViewmodel(P) {
    const c = P.proxy;
    c.traverse(function (o) {
      o.renderOrder = 1000;
      o.frustumCulled = false;
      if (o.material) {
        const src = o.material;
        const fix = function (m) {
          const n = m.clone();
          n.depthTest = true; n.depthWrite = true; n.transparent = true;
          P.fpMats.push(n);
          return n;
        };
        o.material = Array.isArray(src) ? src.map(fix) : fix(src);
      }
    });
  }

  /* ============================================================
     HAND GRIP POINTS (hand frame: wrist origin, fingers -Z, palm -Y,
     thumb -X on the right hand; the left hand is a mirror)
     ============================================================ */
  const _grip = new THREE.Vector3();
  function gripLocal(pose, side, out) {
    const H = CBZ.fpHands;
    if (pose === "card" || pose === "open" || pose === "relaxed") out.set(-0.030, -0.022, -0.100);    // thumb-to-index pinch
    else if (H && H.gripCentre) H.gripCentre(pose === "fist" ? "grip" : pose, out);
    else out.set(-0.006, -0.033, -0.086);
    if (side < 0) out.x = -out.x;
    return out;
  }

  /* ============================================================
     THE TAKES
     ============================================================ */
  const active = [];               // running takes
  const FP_SPLIT = [0.36, 0.12, 0.52];   // reach, close, lift (fractions of dur)
  const TP_SPLIT = [0.45, 0.12, 0.43];
  const ARM_DIP = 0.08, ARM_RAISE = 0.10;
  const MOVING = 1.5;              // m/s: faster than this the player scoops on the move
  const POCKET_U = 0.62;           // TP: the copy goes into the pocket here (fraction of lift)

  const _c = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
  const _box = new THREE.Box3(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion();

  function itemKey(item, opts) {
    if (opts && opts.key != null) return opts.key;
    if (item && item.isObject3D) return item;
    if (item && item.obj && item.obj.isObject3D) return item.obj;
    return null;
  }
  // world centre + size of the thing (once, at the start)
  function measureItem(P) {
    const obj = P.obj;
    if (obj) {
      obj.updateWorldMatrix(true, true);
      _box.makeEmpty();
      _box.setFromObject(obj);
      if (!_box.isEmpty()) {
        _box.getCenter(P.point);
        _box.getSize(_v);
        P.size = Math.max(_v.x, _v.y, _v.z);
        P.thin = Math.min(_v.x, _v.y, _v.z) < 0.02;
      } else obj.getWorldPosition(P.point);
    }
    const it = P.item;
    if (!obj || (it && !it.isObject3D && it.x != null)) {
      if (it && it.x != null) P.point.set(+it.x || 0, +it.y || 0, +it.z || 0);
      const k = (it && it.kind) || "box";
      P.size = { card: 0.09, cash: 0.16, gun: 0.2, bag: 0.3, key: 0.06 }[k] || 0.12;
      P.thin = k === "card" || k === "cash" || k === "key";
    }
  }

  function makeTake(actor, item, opts) {
    const P = {
      actor: actor, item: item, opts: opts, B: null, ch: null,
      obj: item && item.isObject3D ? item : (item && item.obj && item.obj.isObject3D ? item.obj : null),
      key: null, point: new THREE.Vector3(), size: 0.12, thin: false,
      fp: false, armed: false, hand: "r", side: 1, pose: "card",
      t: 0, T: { lower: 0, reach: 0, close: 0, lift: 0, raise: 0 }, total: 0,
      phase: "reach", grabbed: false, taken: false, done: false, cancelled: false,
      proxy: null, fpMats: [], proxyGone: false,
      itemMat: new THREE.Matrix4(), hidObj: false,
      // TP state
      yaw0: 0, yawT: 0, drop: 0, lean: 0, step: new THREE.Vector3(), stepFrom: new THREE.Vector3(), stepLen: 0,
      heightKind: "table", handPose0: null, wroteModel: false,
      seatFrom: new THREE.Vector3(), seatDelta: new THREE.Vector3(),
      // FP state
      fpRel: new THREE.Matrix4(), fpSeat: new THREE.Vector3(), fpReady: false, fpGrip: new THREE.Vector3(),
      lens: false, moving: false, put: false, localCenter: new THREE.Vector3(),
      cancel: null,
    };
    P.cancel = function () { finish(P, true); };
    // a run reset / mode exit: the take never happened (no onTaken, the thing
    // is put back if the verb hid it)
    P.abort = function () {
      if (P.done) return;
      P.taken = true; P.grabbed = true;
      if (P.hidObj && P.obj && !P.put) P.obj.visible = true;
      finish(P, true);
    };
    return P;
  }

  function lensWanted(opts) {
    if (opts.lens) return true;
    const pc = CBZ.playerChar;
    return !!(pc && pc.group && pc.group.visible === false && CBZ.camera);
  }
  function start(actor, item, opts, put) {
    opts = opts || {};
    const doneNow = function () {
      if (put) { const o = item && (item.isObject3D ? item : item.obj); if (o && o.isObject3D) o.visible = true; fire(opts.onPlaced); fire(opts.onDone); return null; }
      return instant(item, opts);
    };
    if (!item) { if (put) { fire(opts.onPlaced); fire(opts.onDone); } else { fire(opts.onTaken); fire(opts.onDone); } return null; }
    actor = actor || CBZ.player;
    const key = itemKey(item, opts);
    // the same thing is already being taken: that take is the answer
    if (key != null) {
      for (let i = 0; i < active.length; i++) if (active[i].key === key && !active[i].done) return active[i];
    }
    const B = actor ? bodyOf(actor) : null;
    const player = !!(B && B.isPlayer);
    const lens = player && !fpActive() && lensWanted(opts) && !!CBZ.fpHands;
    const fp = player && (fpActive() || lens);
    if (!B || opts.instant || actorDead(actor, B) || (player && playerBusy()) || (!fp && !(B.ch && B.ch.parts && B.ch.body))) {
      return doneNow();
    }
    // one take per actor: a new one finishes the old one first (its onTaken fires)
    for (let i = active.length - 1; i >= 0; i--) if (sameActor(active[i], B)) finish(active[i], true);

    const P = makeTake(actor, item, opts);
    P.key = key;
    P.put = !!put;
    P.B = B; P.ch = B.ch; P.fp = fp; P.lens = lens;
    P.armed = !lens && armedNow(B);
    P.moving = player && !fp && !put && !!(CBZ.player && (CBZ.player.speed || 0) > MOVING);
    measureItem(P);
    if (put && opts.spot && opts.spot.x != null) P.point.set(+opts.spot.x || 0, +opts.spot.y || 0, +opts.spot.z || 0);
    P.hand = opts.hand === "l" || opts.hand === "r" ? opts.hand : (P.armed && !fp ? "l" : "r");
    P.side = P.hand === "l" ? -1 : 1;
    P.pose = opts.pose === "open" ? "grip" : (opts.pose || (P.thin || P.size < 0.1 ? "card" : "grip"));
    if (P.fp) {
      const dur = opts.dur > 0 ? +opts.dur : (put ? 0.42 : 0.36);
      P.T.lower = P.armed ? ARM_DIP : 0;
      P.T.reach = dur * FP_SPLIT[0]; P.T.close = dur * FP_SPLIT[1]; P.T.lift = dur * FP_SPLIT[2];
      if (put) { P.T.reach = dur * 0.5; P.T.close = dur * 0.12; P.T.lift = dur * 0.38; }
      P.T.raise = P.armed ? ARM_RAISE : 0;
    } else {
      planBody(P);
      const base = P.heightKind === "floor" ? 1.05 : P.heightKind === "table" ? 0.7 : 0.6;
      const dur = opts.dur > 0 ? +opts.dur : (P.moving ? base * 0.6 : base);
      P.T.reach = dur * TP_SPLIT[0]; P.T.close = dur * TP_SPLIT[1]; P.T.lift = dur * TP_SPLIT[2];
    }
    if (put) beginPut(P);
    P.total = P.T.lower + P.T.reach + P.T.close + P.T.lift + P.T.raise;
    P.phase = P.T.lower > 0 ? "lower" : "reach";
    if (P.ch && P.ch.parts) {
      const m = handMesh(P.ch, P.hand);
      P.handPose0 = m ? m.userData.handPose : null;
      P.ch.pickupHand = P.hand;          // other hand writers can see the hand is taken
    }
    active.push(P);
    return P;
  }
  V.pickup = function (actor, item, opts) { return start(actor, item, opts, false); };
  V.putDown = function (actor, item, spot, opts) {
    opts = Object.assign({}, opts || {});
    if (spot) opts.spot = spot;
    return start(actor, item, opts, true);
  };
  // a reach into a body: the pocket (or any contact point) is the place
  const _tf = new THREE.Vector3();
  V.takeFrom = function (actor, target, opts) {
    opts = Object.assign({}, opts || {});
    if (opts.key == null) opts.key = target;
    let pt = null;
    const tch = target && (target.char || target.ch || (target.parts && target.group ? target : null));
    if (tch && V.contactPoint) { try { pt = V.contactPoint(tch, opts.at || "pocketR", _tf); } catch (e) { pt = null; } }
    if (!pt && tch && tch.body) {
      // no contact table: the hip of the body, off its live matrix
      tch.group.updateMatrixWorld(true);
      pt = _tf.set(0, (tch.hipY || 0.95) - 0.05, 0.12);
      tch.body.localToWorld(pt);
    }
    if (!pt) {
      const p = target && (target.pos || (target.group && target.group.position));
      if (!p) return start(actor, null, opts, false);
      const down = !!(target.dead || target.ko > 0);
      pt = _tf.set(p.x, (p.y || 0) + (down ? 0.2 : 0.9), p.z);
    }
    return start(actor, { x: pt.x, y: pt.y, z: pt.z, kind: opts.kind || "cash" }, opts, false);
  };
  function sameActor(P, B) {
    if (P.B && P.B.isPlayer && B.isPlayer) return true;
    return P.B && P.B.ch && P.B.ch === B.ch;
  }
  V.pickupOf = function (actor) {
    if (!actor) return null;
    const pl = isPlayer(actor);
    for (let i = 0; i < active.length; i++) {
      const P = active[i];
      if (P.done) continue;
      if (pl ? (P.B && P.B.isPlayer) : P.actor === actor) return P;
    }
    return null;
  };
  V.pickups = active;

  /* ============================================================
     THIRD PERSON — the plan (once), the pose (every frame)
     ============================================================ */
  function handMesh(ch, arm) {
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const m = part && part.userData && part.userData.cap;
    return m && m.isObject3D ? m : null;
  }
  function setHand(ch, arm, pose) {
    if (!ch || !pose) return;
    if (typeof ch.setHandPose === "function") ch.setHandPose(arm, pose);
    else if (CBZ.charSetHandPose) CBZ.charSetHandPose(ch, arm, pose);
  }
  // the hand's grip point in world space (where the thing sits in it)
  function handGripWorld(ch, arm, pose, out) {
    const m = handMesh(ch, arm);
    if (m) {
      gripLocal(pose, m.userData && m.userData.side < 0 ? -1 : 1, out);
      m.updateWorldMatrix(true, false);
      return out.applyMatrix4(m.matrixWorld);
    }
    const s = ch.sockets && (arm === "l" ? ch.sockets.leftHand : ch.sockets.rightHand);
    if (!s) return null;
    s.updateWorldMatrix(true, false);
    return s.getWorldPosition(out);
  }
  V.pickupGripPoint = handGripWorld;

  function shoulderLateral(ch, arm) {
    const part = ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const s = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.7;
    return part ? part.position.x * s : (arm === "l" ? 0.2 : -0.2);
  }

  /* How low, how far over, where to stand. A person does not stoop to the
     floor with straight legs: under ~0.4 m the knees go (a squat), at desk
     height it is the waist, above the shoulder nothing bends. The search is a
     60-cell grid over (hip drop, torso lean) on the body's own measurements;
     the arm solve (with shoulder protraction) closes whatever is left. */
  function planBody(P) {
    const B = P.B, ch = P.ch, pos = B.pos;
    const dx = P.point.x - pos.x, dz = P.point.z - pos.z;
    const dh = Math.hypot(dx, dz);
    const yRel = P.point.y - pos.y;
    const hipY = B.hipY || 0.665, shY = B.shoulderY || 1.29;
    const Lt = shY - hipY;
    P.heightKind = yRel < hipY * 0.62 ? "floor" : (yRel < shY - 0.12 ? "table" : "shelf");
    // stand where the hand can work: a desk keeps the body off its edge
    const workD = P.opts.workD > 0 ? +P.opts.workD : (P.heightKind === "floor" ? 0.40 : P.heightKind === "table" ? 0.58 : 0.45);
    const maxStep = B.isPlayer ? 0.8 : 1.2;
    P.stepFrom.set(pos.x, pos.y, pos.z);
    P.stepLen = 0;
    if (dh > workD + 0.06 && !P.opts.noStep && !P.moving) {
      P.stepLen = Math.min(maxStep, dh - workD);
      P.step.set(dx / dh * P.stepLen, 0, dz / dh * P.stepLen);
    } else P.step.set(0, 0, 0);
    const dAfter = Math.max(0.05, dh - P.stepLen);
    // face so the thing is in front of the REACHING shoulder, not the chest
    const sx = shoulderLateral(ch, P.hand) * 0.6;   // a little across the body is natural
    const bearing = Math.atan2(dx, dz);
    const ratio = Math.max(-0.9, Math.min(0.9, sx / Math.max(dAfter, 0.3)));
    P.yaw0 = ch.group ? ch.group.rotation.y : 0;
    P.yawT = P.moving ? P.yaw0 : bearing - Math.asin(ratio);   // on the move the body keeps its line
    const df = Math.sqrt(Math.max(0.0025, dAfter * dAfter - sx * sx));
    const reachR = (B.arm || 0.63) * 0.9;
    let best = null, bestCost = 1e9;
    // nobody takes a thing off a desk bolt upright: the waist goes by the height
    const leanMin = P.heightKind === "table" ? 0.22 + 0.45 * clamp01((shY - 0.2 - yRel) / 0.6) : (P.heightKind === "floor" ? 0.3 : 0);
    const hMin = P.heightKind === "floor" ? 0.30 : 0;
    const hMax = P.heightKind === "floor" ? 0.60 : (P.heightKind === "table" ? 0.18 : 0);
    for (let hi = 0; hi <= 6; hi++) {
      const hk = hMin + (hMax - hMin) * hi / 6;
      const h = hk * hipY;
      for (let li = 0; li <= 10; li++) {
        const th = Math.max(leanMin, li * 0.1);
        const sxF = Lt * Math.sin(th), syF = hipY - h + Lt * Math.cos(th);
        const d = Math.hypot(df - sxF, yRel - syF);
        const cost = hk * 1.6 + th * 0.9 + Math.max(0, d - reachR) * 12;
        if (cost < bestCost) { bestCost = cost; best = [h, th]; }
      }
    }
    P.drop = P.heightKind === "shelf" ? 0 : best[0] * (P.moving ? 0.6 : 1);
    P.lean = P.heightKind === "shelf" ? 0 : best[1];
  }

  // the TP pose weight for this frame: 0 standing, 1 fully down on the thing
  function bodyWeight(P) {
    const T = P.T, t = P.t;
    const tr = T.lower, tc = tr + T.reach, tl = tc + T.close, te = tl + T.lift;
    if (t < tr) return 0;
    if (t < tc) return smooth((t - tr) / T.reach);
    if (t < tl) return 1;
    return 1 - smooth((t - tl) / (te - tl) / 0.95);
  }

  const _tgt = new THREE.Vector3(), _pk = new THREE.Vector3(), _hp = new THREE.Vector3();
  function legSolve(ch, dropW) {
    const P = ch.profile || {};
    const s = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.7;
    const Lu = P.legUp || 0.46, Ll = P.legLo || 0.49;
    const hip = ch.hipY || (Lu + Ll);
    const D = Math.max(0.35 * (Lu + Ll), Math.min(Lu + Ll - 1e-4, hip - dropW / s));
    const a = Math.acos(Math.max(-1, Math.min(1, (Lu * Lu + D * D - Ll * Ll) / (2 * Lu * D))));
    const k = Math.PI - Math.acos(Math.max(-1, Math.min(1, (Lu * Lu + Ll * Ll - D * D) / (2 * Lu * Ll))));
    return [a, k];
  }

  // write the body: lean, hips down, knees, head; then the arm onto its target
  function poseBody(P, reassert) {
    const ch = P.ch;
    if (!ch || !ch.body || !ch.parts) return;
    const w = bodyWeight(P);
    const T = P.T, t = P.t;
    const tc = T.lower + T.reach, tl = tc + T.close, te = tl + T.lift;
    // root: the step in, and the turn to the thing (reach + close only)
    if (!reassert && P.t <= tl && P.B.pos) {
      const u = smooth(Math.min(1, (t - T.lower) / (T.reach * 0.8)));
      if (P.stepLen > 0) {
        const p = P.B.pos;
        p.x = P.stepFrom.x + P.step.x * u;
        p.z = P.stepFrom.z + P.step.z * u;
        if (P.B.isPlayer && ch.group && ch.group.position !== p) { ch.group.position.x = p.x; ch.group.position.z = p.z; }
      }
      if (ch.group) ch.group.rotation.y = P.yaw0 + angDiff(P.yaw0, P.yawT) * u;
    }
    if (w > 0.001 || P.wroteModel) {
      const drop = P.drop * w;
      const lk = legSolve(ch, drop);
      const J = ch.low || {};
      const ll = ch.parts.ll, rl = ch.parts.rl;
      // the leg on the reaching side steps a touch forward, the other stays under
      const fwd = 0.10 * w * (P.drop > 0 ? 1 : 0);
      if (ll) { ll.rotation.x = lerp(ll.rotation.x, -lk[0] - (P.hand === "l" ? fwd : -fwd * 0.5), w); ll.rotation.z = lerp(ll.rotation.z, 0.06, w * 0.6); }
      if (rl) { rl.rotation.x = lerp(rl.rotation.x, -lk[0] - (P.hand === "r" ? fwd : -fwd * 0.5), w); rl.rotation.z = lerp(rl.rotation.z, -0.06, w * 0.6); }
      if (J.ll) J.ll.rotation.x = lerp(J.ll.rotation.x, lk[1], w);
      if (J.rl) J.rl.rotation.x = lerp(J.rl.rotation.x, lk[1], w);
      if (ch.model) { ch.model.position.y = w > 0.001 ? -drop : 0; P.wroteModel = w > 0.001; }
      ch.body.rotation.x = lerp(ch.body.rotation.x, P.lean, w);
      ch.body.rotation.z = lerp(ch.body.rotation.z, 0.05 * P.side * (P.lean > 0.2 ? 1 : 0), w);
      if (ch.neck) ch.neck.rotation.x = lerp(ch.neck.rotation.x, Math.max(0.05, 0.42 - P.lean * 0.35), w);
      if (CBZ.lockCharacterHips) CBZ.lockCharacterHips(ch);
    }
    // THE ARM
    const tr = T.lower;
    let k = 0, pose = null;
    if (P.put) {
      // the reverse: out of the pocket to the spot, open, and back
      pocketPoint(P, _pk);
      if (t < tc) {
        const u = (t - tr) / T.reach;
        k = smooth(u / 0.3);
        _tgt.copy(_pk).lerp(P.point, smooth(u));
        pose = P.pose;
      } else if (t < tl) { k = 1; _tgt.copy(P.point); pose = "open"; }
      else {
        const u = (t - tl) / (te - tl);
        _tgt.copy(P.point).lerp(_pk, smooth(u / 0.8));
        k = 1 - smooth((u - 0.4) / 0.6);
        pose = "relaxed";
      }
    } else if (t < tr) k = 0;
    else if (t < tc) {
      const u = (t - tr) / T.reach;
      k = smooth(u / 0.9);
      _tgt.copy(P.point);
      pose = "open";
    } else if (t < tl) {
      k = 1; _tgt.copy(P.point); pose = P.pose;
    } else {
      const u = (t - tl) / (te - tl);
      pocketPoint(P, _pk);
      _tgt.copy(P.point).lerp(_pk, smooth(u / 0.8));
      // the arm hands back to the gait as it nears the hip: a hanging arm IS
      // the hand at the pocket, and solving straight down is the one
      // direction a shoulder solve cannot hold (the Euler wraps)
      k = 1 - smooth((u - 0.5) / 0.5);
      pose = u < POCKET_U ? P.pose : "relaxed";
    }
    if (pose) setHand(ch, P.hand, pose);
    if (k > 0.001) {
      // aim so the GRIP point (the pinch, the palm) lands on the thing: the
      // solver places its own hand point, so carry the difference over
      const iters = k > 0.999 ? 3 : 1;
      for (let i = 0; i < iters; i++) {
        if (ch.group) ch.group.updateMatrixWorld(true);
        const own = handGripWorld(ch, P.hand, pose || "relaxed", _hp);
        // the lift uses the closed-form solve only: its Euler channels blend
        // smoothly back into the gait (the core's exact quaternion solve
        // writes a twist that a partial blend would snap through)
        const exact = P.put ? (t >= tc && t < tl) || (t < tc && (t - tr) / T.reach > 0.6) : t < tl;
        if (exact && V.handTo && V.handPoint && own && V.handPoint(ch, P.hand, _w)) {
          _v.copy(_tgt).sub(_hp).add(_w);
          V.handTo(ch, P.hand, _v, k);
        } else if (CBZ.charArmTo) {
          const s = ch.sockets && (P.hand === "l" ? ch.sockets.leftHand : ch.sockets.rightHand);
          if (s && own) { s.updateWorldMatrix(true, false); s.getWorldPosition(_w); _v.copy(_tgt).sub(_hp).add(_w); }
          else _v.copy(_tgt);
          CBZ.charArmTo(ch, _v, P.hand, k);
        }
      }
    }
  }
  // where the hand ends: a hip pocket, or the chest when the thing is kept
  function pocketPoint(P, out) {
    const ch = P.ch, m = ch.model || ch.group;
    const Pp = ch.profile || {};
    const hip = ch.hipY || 0.95;
    const sx = shoulderLateral(ch, P.hand) / ((ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.7);
    if (P.opts.keep) out.set(sx * 0.35, hip + (Pp.torsoH || 0.95) * 0.55, 0.32);
    else out.set(sx * 1.0, hip - 0.06, (Pp.pelvisD || 0.48) * 0.5 + 0.14);   // in FRONT of the thigh
    m.updateWorldMatrix(true, false);
    return m.localToWorld(out);
  }

  /* ============================================================
     THE GRAB FRAME
     ============================================================ */
  function grab(P) {
    if (P.grabbed) return;
    P.grabbed = true;
    const obj = P.obj;
    if (P.opts.copy === false) {
      // a reach with nothing coming away in the hand
      if (obj && !P.opts.leave) { obj.visible = false; P.hidObj = true; }
      P.proxyGone = true;
      take(P);
      return;
    }
    // the copy, built from the real thing BEFORE the game's onTaken may
    // dispose, pool or remove it
    if (obj) {
      obj.updateWorldMatrix(true, true);
      P.itemMat.copy(obj.matrixWorld);
      P.proxy = copyNode(obj);
      if (P.proxy) { P.proxy.position.set(0, 0, 0); P.proxy.quaternion.identity(); P.proxy.scale.set(1, 1, 1); P.proxy.visible = true; }
      if (!P.opts.leave) { obj.visible = false; P.hidObj = true; }
    }
    if (!P.proxy) {
      P.proxy = standIn((P.item && P.item.kind) || (P.thin ? "card" : "box"));
      P.itemMat.makeTranslation(P.point.x, P.point.y, P.point.z);
      if (P.B && P.B.pos) {
        // lie it along the body's facing
        _q.setFromAxisAngle(_v.set(0, 1, 0), P.ch && P.ch.group ? P.ch.group.rotation.y : 0);
        _m4.makeRotationFromQuaternion(_q);
        P.itemMat.multiply(_m4);
      }
    }
    if (!P.fp) attachTP(P);
    else P.fpReady = false;                 // the viewmodel hook places it this frame
    take(P);
  }
  function take(P) {
    if (P.taken) return;
    P.taken = true;
    fire(P.opts.onTaken, P);
  }
  function attachTP(P) {
    const ch = P.ch, hand = handMesh(ch, P.hand) ||
      (ch.sockets && (P.hand === "l" ? ch.sockets.leftHand : ch.sockets.rightHand));
    const c = P.proxy;
    if (!hand || !c) return;
    const scene = CBZ.scene || (ch.group && ch.group.parent);
    // place the copy exactly where the thing was, then hand it to the hand
    P.itemMat.decompose(c.position, c.quaternion, c.scale);
    if (scene) scene.add(c);
    c.updateMatrixWorld(true);
    ch.group.updateMatrixWorld(true);
    hand.attach(c);
    P.seatFrom.copy(c.position);
    // seat it: the thing's centre slides onto the grip point in the palm
    const side = hand.userData && hand.userData.side < 0 ? -1 : 1;
    gripLocal(P.pose, side, _grip);
    _v.copy(P.point); hand.worldToLocal(_v);
    P.seatDelta.copy(_grip).sub(_v);
    const ws = hand.matrixWorld.getMaxScaleOnAxis() || 1;
    const maxL = (P.moving ? 2.0 : 0.12) / ws;          // on the move it trails in to the hand from where it lay
    if (P.seatDelta.length() > maxL) P.seatDelta.setLength(maxL);
  }
  function seatTP(P) {
    const c = P.proxy;
    if (!c || P.fp || !c.parent) return;
    const tl = P.T.lower + P.T.reach;
    const u = smooth((P.t - tl) / (P.T.close * (P.moving ? 3.5 : 1.6)));
    c.position.copy(P.seatFrom).addScaledVector(P.seatDelta, u);
  }

  /* ============================================================
     PUT DOWN — the copy starts in the hand and ends exactly where the thing
     rests; on the release frame it is swapped for the real object
     ============================================================ */
  function beginPut(P) {
    const obj = P.obj;
    if (obj) {
      obj.updateWorldMatrix(true, true);
      P.itemMat.copy(obj.matrixWorld);
      P.proxy = copyNode(obj);
      if (P.proxy) { P.proxy.position.set(0, 0, 0); P.proxy.quaternion.identity(); P.proxy.scale.set(1, 1, 1); P.proxy.visible = true; }
      obj.visible = false; P.hidObj = true;
    }
    if (!P.proxy && P.opts.copy !== false) {
      P.proxy = standIn((P.item && P.item.kind) || (P.thin ? "card" : "box"));
      P.itemMat.makeTranslation(P.point.x, P.point.y, P.point.z);
    }
    // the thing's centre in its own frame (the hand seats THAT)
    P.localCenter.copy(P.point).applyMatrix4(_m4.copy(P.itemMat).invert());
    if (!P.fp && P.proxy) {
      const hand = handMesh(P.ch, P.hand);
      if (hand) hand.add(P.proxy); else { disposeCopy(P); }
    }
    P.fpReady = false;
  }
  const _rp = new THREE.Vector3(), _rq = new THREE.Quaternion(), _rs = new THREE.Vector3();
  function seatPutTP(P) {
    const c = P.proxy;
    if (!c || !P.put || P.fp || P.grabbed || !c.parent) return;
    const hand = c.parent;
    hand.updateMatrixWorld(true);
    _m4.copy(hand.matrixWorld).invert().multiply(P.itemMat);
    _m4.decompose(_rp, _rq, _rs);
    const side = hand.userData && hand.userData.side < 0 ? -1 : 1;
    gripLocal(P.pose, side, _grip);
    _v.copy(P.localCenter).applyMatrix4(_m4);            // its centre, hand frame, at rest
    const u = (P.t - P.T.lower) / P.T.reach;
    const u2 = smooth((u - 0.5) / 0.5);
    c.position.copy(_grip).sub(_v).multiplyScalar(1 - u2).add(_rp);
    c.quaternion.copy(_rq);
    c.scale.copy(_rs).multiplyScalar(Math.max(0.001, smooth(u / 0.2)));
  }
  function place(P) {
    if (P.grabbed) return;
    P.grabbed = true;
    disposeCopy(P);
    P.proxyGone = true;
    if (P.obj) P.obj.visible = true;
    P.hidObj = false;
    if (!P.taken) { P.taken = true; fire(P.opts.onPlaced, P); }
  }

  /* ============================================================
     FIRST PERSON — fpsmode.js calls this once per frame, before its arms
     ============================================================ */
  const SHOULDER_CAM = [[0.30, -0.45, 0.12], [-0.30, -0.45, 0.12]];
  const _cam = new THREE.Vector3(), _u = new THREE.Vector3(), _S = new THREE.Vector3(), _G = new THREE.Vector3();
  const _W = new THREE.Vector3(), _show = new THREE.Vector3(), _pocket = new THREE.Vector3();
  const _vmInv = new THREE.Matrix4(), _Hf = new THREE.Matrix4(), _M0 = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);
  const _eye = new THREE.Vector3(), _hq = new THREE.Quaternion(), _pos = new THREE.Vector3(), _scl = new THREE.Vector3();
  const FP_OUT = { hands: false, gunDip: 0, phase: "" };
  const LOW = { x: 0.30, y: -0.72, z: 0.12 };      // a hand below the frame (vm space)

  // camera-space point -> vm space
  function camToVm(vmObj, x, y, z, out) {
    vmObj.updateMatrix();
    _vmInv.copy(vmObj.matrix).invert();
    return out.set(x, y, z).applyMatrix4(_vmInv);
  }
  V.fpPickup = function (vmObj, fistT, handR, handL, armedFp) {
    let P = null;
    const isLens = vmObj === LENS.vm;
    for (let i = 0; i < active.length; i++) {
      const A = active[i];
      if (A.fp && !A.done && A.lens === isLens) { P = A; break; }
    }
    if (!P || !vmObj || !fistT) return null;
    const cam = CBZ.camera;
    if (!cam) return null;
    const T = P.T, t = P.t;
    const tr = T.lower, tc = tr + T.reach, tl = tc + T.close, te = tl + T.lift, tf = te + T.raise;
    FP_OUT.phase = P.phase;
    // the gun: down before, up after
    FP_OUT.gunDip = !P.armed ? 0 : (t < tr ? smooth(t / T.lower) : t < te ? 1 : 1 - smooth((t - te) / T.raise));
    FP_OUT.hands = !P.armed || (t >= tr && t < te);
    if (!FP_OUT.hands) return FP_OUT;

    const i = P.side < 0 ? 1 : 0;
    const F = fistT[i], other = fistT[1 - i];
    const hand = i === 0 ? handR : handL;
    if (P.armed && other) other.vis = false;
    cam.updateMatrixWorld(true);
    vmObj.updateMatrix();
    vmObj.updateMatrixWorld(true);
    const K = (hand && hand.scale && hand.scale.x) || 1.9;
    const handQ = hand ? hand.quaternion : _hq.identity();

    // the grip point: along the ray to the thing, as far as the arm reaches
    _cam.copy(P.point); cam.worldToLocal(_cam);
    const D = _cam.length() || 1;
    _u.copy(_cam).multiplyScalar(1 / D);
    let inView = true;
    if (_u.z > -0.3) { _u.z = -0.3; _u.normalize(); inView = false; }
    const sh = SHOULDER_CAM[i];
    _S.set(sh[0], sh[1], sh[2]);
    const us = _u.dot(_S), r = 1.0;
    const disc = us * us - _S.lengthSq() + r * r;
    const dReach = Math.max(0.55, Math.min(1.0, disc > 0 ? us + Math.sqrt(disc) : 0.8));
    P.fpD = D; P.fpDReach = dReach; P.fpInView = inView;
    camToVm(vmObj, _u.x * dReach, _u.y * dReach, _u.z * dReach, _G);           // grip target, vm space
    // the wrist that puts the grip point there, with the hand's current attitude
    gripLocal(t < tc ? "card" : P.pose, P.side, _grip);
    _v.copy(_grip).multiplyScalar(K).applyQuaternion(handQ);
    _W.copy(_G).sub(_v);
    // show (lower middle, close) and pocket (under the frame), vm space
    camToVm(vmObj, 0.14 * P.side, -0.30, -0.62, _show);
    camToVm(vmObj, 0.34 * P.side, -0.62, -0.42, _pocket);

    const base = (P.armed || P.lens) ? LOW : F;   // the hand's own pose this frame (animFists), or below the frame
    const bx = base.x, by = base.y, bz = base.z;
    let wx, wy, wz, wgt = 1, roll = 0.35, bend = -0.30, curl = "open";
    if (P.put) {
      // out of the pocket, to the spot, open, back
      if (t < tc) {
        const u = smooth((t - tr) / T.reach);
        _v.copy(_pocket).lerp(_W, u);
        wgt = smooth(((t - tr) / T.reach) / 0.3);
        roll = 0.9 - 0.55 * u; bend = -0.05 - 0.25 * u;
        curl = P.pose;
      } else if (t < tl) { _v.copy(_W); curl = "open"; }
      else {
        const u = (t - tl) / (te - tl);
        _v.copy(_W).lerp(_pocket, smooth(u / 0.8));
        wgt = 1 - smooth((u - 0.6) / 0.4);
        curl = "relaxed";
      }
      wx = _v.x; wy = _v.y; wz = _v.z;
    } else if (t < tc) {
      const u = smooth((t - tr) / T.reach);
      wgt = u;
      wx = _W.x; wy = _W.y; wz = _W.z;
      // the hand turns palm-down on the way in, fingers opening
      curl = u < 0.25 ? (F.curl || "relaxed") : "open";
    } else if (t < tl) {
      wx = _W.x; wy = _W.y; wz = _W.z;
      curl = P.pose;
    } else {
      // lift, from where the hand closed: grip -> show -> pocket -> its own pose
      const u = (t - tl) / (te - tl);
      if (u < 0.4) _v.copy(P.fpGrip).lerp(_show, smooth(u / 0.4));
      else if (u < 0.86) _v.copy(_show).lerp(_pocket, smooth((u - 0.4) / 0.46));
      else _v.copy(_pocket);
      wx = _v.x; wy = _v.y; wz = _v.z;
      roll = 0.35 + 0.55 * smooth(u / 0.4);
      bend = -0.30 + 0.25 * smooth(u / 0.4);
      curl = u < 0.86 ? P.pose : "relaxed";
      wgt = u < 0.86 ? 1 : 1 - smooth((u - 0.86) / 0.14);
    }
    F.x = lerp(bx, wx, wgt); F.y = lerp(by, wy, wgt); F.z = lerp(bz, wz, wgt);
    F.roll = lerp(F.roll != null && !P.armed ? F.roll : 0.95, roll, wgt);
    F.bend = lerp(F.bend != null && !P.armed ? F.bend : -0.2, bend, wgt);
    F.vis = true;
    F.hook = 0;
    F.curl = curl;
    if (t < tl) P.fpGrip.set(F.x, F.y, F.z);

    // PUT: the copy is carried in the hand frame and lands on the rest pose
    // (scaled about the eye, so the release frame is the same pixels as the
    // real object that replaces it)
    if (P.put) {
      if (P.proxy && !P.grabbed) {
        if (!P.fpReady) { P.fpReady = true; toViewmodel(P); vmObj.add(P.proxy); }
        _Hf.compose(_pos.set(F.x, F.y, F.z), handQ, _one);
        cam.getWorldPosition(_eye);
        if (inView) {
          const k = dReach / D;
          _M0.makeTranslation(-_eye.x, -_eye.y, -_eye.z).premultiply(_m4.makeScale(k, k, k))
            .premultiply(_m4.makeTranslation(_eye.x, _eye.y, _eye.z)).multiply(P.itemMat);
          _M0.premultiply(_vmInv.copy(vmObj.matrixWorld).invert());
        } else {
          P.itemMat.decompose(_pos, _q, _scl);
          _M0.compose(_G, _q.identity(), _scl.multiplyScalar(dReach / D));
        }
        const rel = P.fpRel.copy(_Hf).invert().multiply(_M0);   // rest, in the hand frame
        _v.copy(P.localCenter).applyMatrix4(rel);
        gripLocal(P.pose, P.side, _grip).multiplyScalar(K).sub(_v);
        const u2 = 1 - smooth((((t - tr) / T.reach) - 0.5) / 0.5);
        _M0.makeTranslation(_grip.x * u2, _grip.y * u2, _grip.z * u2).multiply(rel).premultiply(_Hf);
        _M0.decompose(P.proxy.position, P.proxy.quaternion, P.proxy.scale);
      }
      return FP_OUT;
    }

    // THE COPY: placed on the grab frame by scaling the thing about the eye
    // (same pixels), then carried by the hand frame, seating into the pinch
    if (P.grabbed && P.proxy && !P.proxyGone) {
      _Hf.compose(_pos.set(F.x, F.y, F.z), handQ, _one);
      if (!P.fpReady) {
        P.fpReady = true;
        toViewmodel(P);
        vmObj.add(P.proxy);
        cam.getWorldPosition(_eye);
        if (inView) {
          const k = dReach / D;
          // world: E + k (X - E)  ->  T(E) S(k) T(-E) X
          _M0.makeTranslation(-_eye.x, -_eye.y, -_eye.z).premultiply(_m4.makeScale(k, k, k))
            .premultiply(_m4.makeTranslation(_eye.x, _eye.y, _eye.z)).multiply(P.itemMat);
          _M0.premultiply(_vmInv.copy(vmObj.matrixWorld).invert());
        } else {
          // it was out of view: it appears in the hand
          P.itemMat.decompose(_pos, _q, _scl);
          _M0.compose(_G, _q.identity(), _scl.multiplyScalar(dReach / D));
        }
        P.fpRel.copy(_Hf).invert().multiply(_M0);
        // seat: the thing's centre onto the pinch, in the hand frame
        _M0.decompose(P.proxy.position, P.proxy.quaternion, P.proxy.scale);
        P.proxy.updateMatrixWorld(true);
        _box.setFromObject(P.proxy);
        if (!_box.isEmpty()) { _box.getCenter(_v); vmObj.worldToLocal(_v); } else _v.copy(P.proxy.position);
        _v.applyMatrix4(_m4.copy(_Hf).invert());
        gripLocal(P.pose, P.side, _grip).multiplyScalar(K);
        P.fpSeat.copy(_grip).sub(_v);
        if (P.fpSeat.length() > 0.25) P.fpSeat.setLength(0.25);
      }
      const us2 = smooth((t - tc) / (T.close * 1.6));
      _M0.makeTranslation(P.fpSeat.x * us2, P.fpSeat.y * us2, P.fpSeat.z * us2).multiply(P.fpRel);
      _M0.premultiply(_Hf);
      _M0.decompose(P.proxy.position, P.proxy.quaternion, P.proxy.scale);
      // into the pocket, under the frame: gone (the moment it leaves the frame)
      if (t >= tl) {
        P.proxy.updateMatrixWorld(true);
        P.proxy.getWorldPosition(_v).project(cam);
        if (_v.y < -1.15 || (t - tl) / (te - tl) >= 0.86) { disposeCopy(P); P.proxyGone = true; }
      }
    }
    return FP_OUT;
  };

  /* ============================================================
     THE CLOCK AND THE LATE PASSES
     ============================================================ */
  function phaseOf(P) {
    const T = P.T, t = P.t;
    if (t < T.lower) return "lower";
    if (t < T.lower + T.reach) return "reach";
    if (t < T.lower + T.reach + T.close) return P.put ? "release" : "close";
    if (t < T.lower + T.reach + T.close + T.lift) return P.put ? "withdraw" : "lift";
    if (t < P.total) return "raise";
    return "done";
  }
  function finish(P, cut) {
    if (P.done) return;
    if (!P.grabbed) {
      if (P.put) place(P);               // cut short: it is set down all the same
      else {
        // cut short before the hand got there: the take still happens
        if (P.obj && !P.opts.leave) P.obj.visible = false;
        P.grabbed = true;
        take(P);
      }
    }
    disposeCopy(P);
    P.proxyGone = true;
    const ch = P.ch;
    if (ch && !P.fp) {
      if (P.wroteModel && ch.model) ch.model.position.y = 0;
      P.wroteModel = false;
      setHand(ch, P.hand, P.handPose0 || "relaxed");
    }
    if (ch && ch.pickupHand === P.hand) ch.pickupHand = null;
    P.done = true;
    P.cancelled = !!cut;
    P.phase = "done";
    const i = active.indexOf(P);
    if (i >= 0) active.splice(i, 1);
    fire(P.opts.onDone, P);
  }
  function update(dt) {
    if (!active.length) return;
    dt = Math.min(0.1, Math.max(0, dt || 0));
    for (let i = active.length - 1; i >= 0; i--) {
      const P = active[i];
      if (!P || P.done) continue;
      if (actorDead(P.actor, P.B) || (P.B.isPlayer && playerBusy())) { finish(P, true); continue; }
      P.t += dt;
      const was = P.phase;
      P.phase = phaseOf(P);
      if (!P.fp) poseBody(P, false);
      if (P.put) {
        if (!P.fp) seatPutTP(P);
        if (!P.grabbed && P.t >= P.T.lower + P.T.reach) place(P);
        if (P.phase === "done" || was === "done") finish(P, false);
        continue;
      }
      if (!P.grabbed && P.t >= P.T.lower + P.T.reach) grab(P);
      if (!P.fp) seatTP(P);
      // the copy goes into the pocket out of sight (TP: when the hand is there)
      if (!P.fp && P.proxy && P.phase === "lift" && !P.opts.keep &&
          (P.t - P.T.lower - P.T.reach - P.T.close) / P.T.lift >= POCKET_U) { disposeCopy(P); P.proxyGone = true; }
      if (P.phase === "done" || (was === "done")) finish(P, false);
    }
  }
  function lateTP() {
    for (let i = 0; i < active.length; i++) {
      const P = active[i];
      if (!P.done && !P.fp && P.armed) { poseBody(P, true); if (P.put) seatPutTP(P); else seatTP(P); }
    }
  }
  /* ============================================================
     THE LENS HAND. When the player's body is not being drawn and first
     person is off (an inspect camera a foot from a gun case, a cinematic
     close-up), the take still needs a hand: the same fphands hand and arm
     fpsmode uses, on its own small viewmodel under the camera, posed by the
     same fpPickup maths. Built on first use, hidden when no take needs it.
     ============================================================ */
  const LENS = { vm: null, hR: null, hL: null, aR: null, aL: null, T: null, mats: null };
  const LENS_REST = { x: 0.30, y: -0.72, z: 0.12, roll: 0.95, bend: -0.2 };
  function lensBuild() {
    const H = CBZ.fpHands, cam = CBZ.camera;
    if (LENS.vm || !H || !cam) return !!LENS.vm;
    const skin = new THREE.MeshLambertMaterial({ color: 0xd6a57e });
    const fore = new THREE.MeshLambertMaterial({ color: 0x3a4048 });
    const upper = new THREE.MeshLambertMaterial({ color: 0x3a4048 });
    LENS.mats = { skin: skin, fore: fore, upper: upper };
    const vm = new THREE.Group();
    vm.name = "pickup_lens_vm";
    vm.position.set(0.12, -0.30, -0.66);
    LENS.hR = H.makeHand(1, "relaxed", skin); LENS.hL = H.makeHand(-1, "relaxed", skin);
    LENS.hR.scale.setScalar(1.9); LENS.hL.scale.setScalar(1.9);
    LENS.aR = H.makeArm({ fore: fore, upper: upper }); LENS.aL = H.makeArm({ fore: fore, upper: upper });
    vm.add(LENS.hR, LENS.hL, LENS.aR, LENS.aL);
    vm.traverse(function (o) {
      o.renderOrder = 1000; o.frustumCulled = false;
      if (o.material) { o.material.depthTest = true; o.material.depthWrite = true; o.material.transparent = true; }
    });
    // the depth clear: the hand draws over the case lid it is reaching into
    const dcGeo = new THREE.BufferGeometry();
    dcGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    const dc = new THREE.Mesh(dcGeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true }));
    dc.frustumCulled = false; dc.renderOrder = 999;
    dc.onBeforeRender = function (renderer) { renderer.clearDepth(); };
    vm.add(dc);
    LENS.T = [Object.assign({ vis: false, curl: "relaxed", hook: 0 }, LENS_REST),
              Object.assign({ vis: false, curl: "relaxed", hook: 0 }, LENS_REST, { x: -0.30 })];
    vm.visible = false;
    cam.add(vm);
    LENS.vm = vm;
    return true;
  }
  const _lS = new THREE.Vector3(), _lE = new THREE.Vector3(), _lW = new THREE.Vector3(), _lA = new THREE.Vector3();
  const _sArr = [0, 0, 0], _wArr = [0, 0, 0], _pole = [0, 0, 0];
  function lensTick() {
    let need = false;
    for (let i = 0; i < active.length; i++) if (active[i].lens && !active[i].done) { need = true; break; }
    if (!need) { if (LENS.vm && LENS.vm.visible) LENS.vm.visible = false; return; }
    if (!lensBuild()) return;
    const H = CBZ.fpHands;
    if (LENS.vm.parent !== CBZ.camera && CBZ.camera) CBZ.camera.add(LENS.vm);
    for (let i = 0; i < 2; i++) Object.assign(LENS.T[i], LENS_REST, { x: i ? -0.30 : 0.30, vis: false, curl: "relaxed" });
    const out = V.fpPickup(LENS.vm, LENS.T, LENS.hR, LENS.hL, false);
    LENS.vm.visible = !!(out && out.hands);
    if (!LENS.vm.visible) return;
    // the body's dress on the lens arms
    const d = H.dressOf ? H.dressOf(CBZ.playerChar, {}) : null;
    if (d) { LENS.mats.skin.color.setHex(d.hand); LENS.mats.fore.color.setHex(d.fore); LENS.mats.upper.color.setHex(d.upper); }
    LENS.vm.updateMatrix();
    _vmInv.copy(LENS.vm.matrix).invert();
    for (let i = 0; i < 2; i++) {
      const T = LENS.T[i], hand = i ? LENS.hL : LENS.hR, arm = i ? LENS.aL : LENS.aR, side = i ? -1 : 1;
      hand.visible = arm.visible = !!T.vis;
      if (!T.vis) continue;
      H.setPose(hand, T.curl || "relaxed");
      const sh = SHOULDER_CAM[i];
      _lS.set(sh[0], sh[1], sh[2]).applyMatrix4(_vmInv);
      _lW.set(T.x, T.y, T.z);
      _sArr[0] = _lS.x; _sArr[1] = _lS.y; _sArr[2] = _lS.z;
      _wArr[0] = _lW.x; _wArr[1] = _lW.y; _wArr[2] = _lW.z;
      _pole[0] = side * 0.45; _pole[1] = -1; _pole[2] = 0.15;
      const e = H.math.solveElbow(_sArr, _wArr, _pole, 0.46, 0.44);
      _lE.set(e[0], e[1], e[2]);
      _lA.subVectors(_lW, _lE);
      H.orientAlong(side, _lA, T.roll || 0, T.bend || 0, hand.quaternion);
      hand.position.copy(_lW);
      H.poseArm(arm, _lW, _lE, _lS, hand.quaternion, 1.9, !!(d && d.sleeved));
    }
  }
  V.pickupLens = LENS;

  V.pickupUpdate = update;          // the clock + TP pose (tools/verbs-pickup-check.mjs drives it by hand)
  V.pickupLensTick = lensTick;
  V.pickupLate = lateTP;
  if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(91.5, update);
  if (typeof CBZ.onAlways === "function") CBZ.onAlways(54.7, lateTP);
  // the lens hand after the cameras have moved (camera 50, fpsmode 52, gunhands 54.6)
  if (typeof CBZ.onAlways === "function") CBZ.onAlways(54.8, lensTick);
})();
