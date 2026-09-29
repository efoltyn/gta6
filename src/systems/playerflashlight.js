/* ============================================================
   systems/playerflashlight.js — THE PLAYER'S OWN FLASHLIGHT.

   OWNER: "The flashlight is a cool thing in inventory because at night it
   helps. That's inventory that matters."

   The item already existed and already changed hands: the prison's "Guard
   Torch" (systems/economy.js) comes off a dead guard as a physical drop
   (systems/prisondrops.js) or out of a living one's pocket (economy.js
   liftBest), and the city now sells a "Flashlight" at the hardware counter
   (city/economy.js SHOP_STOCK.hardware) and turns one up in racks/stockrooms
   (city/interior_programs.js LOOT_ITEMS). What was missing is the only reason
   to carry it: LIGHT. This file is that and nothing else.

   ONE MODEL. The thing in your hand is CBZ.buildFlashlight (weapons/
   flashlight.js), the same factory the guards hold, the floor drop lies as
   and the inventory icon photographs.

   IN A HAND, NEVER FLOATING. Owner: "the flashlight isn't held correctly
   right now: it isn't in the hand." It was hung off a wrist socket beside a
   hand that never closed on it (third person) and drawn nowhere at all in
   first person (the light came from a point next to the camera). Now the
   torch is a CHILD OF A HAND, seated by systems/fphands.js torchMount() in
   the 'torch' grip — reverse fist, fingers round the 3 cm body, thumb on the
   tail switch, lens out of the little-finger side — and the hand is posed
   so the lens points where you look. Who holds it:
     · nothing drawn          the RIGHT hand, carried forward at chest height;
     · a one-hand gun         the OFF (left) hand, Harries-style: the torch
       (pistol, taser)        fist tucked under the firing fist, both aimed
                              down the same line (it leaves the two-hand cup);
     · a long gun             the off hand is on the handguard, so the torch
       (grips.hold: rifle,    goes on the gun's RAIL instead, under the bore
       shotgun, launcher)     ahead of the handguard (a side rail on a tube
                              launcher), glass behind the muzzle.
   First person does the same in the viewmodel through fpsmode.js's hook
   (CBZ.fpTorchHold, called right after its arms are posed): the right fist
   or the gun's own support hand takes the 'torch' grip and its arm is
   re-solved by fpsmode's own gunArm.

   THE BEAM LEAVES THE LENS. Every frame the SpotLight, its target and the
   floor pool are synced to the held torch's lens (its world transform, all
   scratch vectors, no allocation). In first person the viewmodel is a
   ~2.5x world hung in front of the camera, so the lens point is pulled back
   toward the eye by that scale: same point on screen, real distance.

   ONE LIGHT, BUILT ONCE. r128 compiles the light count into every lit
   program, so adding a light mid-game (or flipping its `visible`) recompiles
   every material in view: a hitch. The SpotLight is created the first time
   you OWN a torch (the hitch lands on the pickup, not on the click) and is
   never removed or hidden again; off is `intensity = 0`. Shadowless.

   ONE POOL. Lambert in r128 is lit per VERTEX, and a prison floor is two
   triangles across ten metres: a real spot on it is close to invisible. So,
   exactly as prisonnight.js does for the guards' torches, the beam also lays
   a soft pool where it meets the floor, and that is what you actually see.

   YOU LIGHT YOURSELF UP. `CBZ.player.flashlightOn` is the same field a guard
   carries. systems/fixtures.js reads it twice: as a SENSOR the holder sees
   the whole range inside his beam, and as a TARGET a man holding a lit torch
   in the black is seen as though he stood under a lamp. The trade is real.

   Contract (the hotbar toggles through this; do not rename):
     CBZ.playerFlashlight = { owned(), on(), toggle(), set(on) }
   Audit: CBZ.playerFlashlightAudit() -> { owned, on, lightBuilt, intensity, holder }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  // ---- what counts as owning one, per mode --------------------------------
  const ITEM = { escape: "Guard Torch", city: "Flashlight" };
  function mode() { return (CBZ.game && CBZ.game.mode) || ""; }
  function owned() {
    const g = CBZ.game;
    if (!g) return false;
    const m = g.mode;
    if (m === "escape") return ((g.inventory && g.inventory[ITEM.escape]) || 0) > 0;
    if (m === "city") return ((g.cityInv && g.cityInv[ITEM.city]) || 0) > 0;
    return false;
  }

  let lit = false;
  function click() { if (CBZ.sfx) { try { CBZ.sfx("switch"); } catch (e) {} } }
  function publish() { if (CBZ.player) CBZ.player.flashlightOn = lit; }
  function set(on) {
    const want = !!on && owned();
    if (want === lit) return;
    lit = want;
    publish();
    click();
  }
  // cuffed (CBZ.arrest.playerCuffed): the torch is in a pocket, not a hand.
  // It goes out when the cuffs go on and comes back on when they come off.
  function cuffed() { const C = CBZ.cuffedPlayer; return !!(C && C.on && C.on()); }
  let cuffLit = false;
  function toggle() {
    if (!owned()) { if (lit) set(false); return false; }
    if (cuffed()) return false;
    set(!lit);
    return lit;
  }
  CBZ.playerFlashlight = {
    owned: owned,
    on: function () { return lit && owned(); },
    toggle: toggle,
    set: set,
  };

  // ---- the numbers ----------------------------------------------------------
  const COLOR = 0xfff1d6;      // warm white incandescent-ish LED
  const ANGLE = 0.38;          // rad half-angle: a hand torch, not a flood
  const PENUMBRA = 0.45;
  const DIST = 24;             // m the light reaches at all
  const DECAY = 1.6;
  const AIM = 12;              // m out along the look the torch is pointed at
  const POOL_MAX = 18;         // m: past this the floor pool has faded out
  const DAY_I = 0.35, NIGHT_I = 2.1;   // intensity in daylight .. in true black
  // appearance units per real metre (weapons/appearances/sidearm.js GUN_K):
  // a rail torch is drawn at the gun's own scale
  const RAIL_K = 2.0;

  // ---- the rig (built once, on first ownership) ---------------------------
  const R = {
    built: false, light: null, target: null, pivot: null, pool: null,
    world: null,        // the torch a BODY holds: a body hand, or the drawn gun's rail
    fp: null,           // the viewmodel's torch (own materials, viewmodel render queue)
    tpSide: 0,          // which body hand holds it: -1 left, 1 right, 0 none
    arm: 0,             // 0..1 the holding arm's blend onto its target
    fpSeen: false,      // fpsmode ran the hook this frame
    fpView: null, fpHand: null, holder: "none",
  };
  function build() {
    if (R.built || !THREE || !CBZ.scene) return;
    R.built = true;
    const s = new THREE.SpotLight(COLOR, 0, DIST, ANGLE, PENUMBRA, DECAY);
    s.castShadow = false;
    const t = new THREE.Object3D();
    s.target = t;
    s.userData.mover = true; t.userData.mover = true;
    CBZ.scene.add(s); CBZ.scene.add(t);
    R.light = s; R.target = t;

    // The pool: a pivot yawed to the beam heading carrying a flat disc whose
    // local Y (after the -PI/2 lay-down, world -Z of the pivot) is stretched
    // along the heading, so a raking beam throws an ellipse, not a coin.
    const pivot = new THREE.Group();
    pivot.userData.mover = true;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    pool.rotation.x = -Math.PI / 2;
    pool.renderOrder = 2;
    pool.frustumCulled = false;
    pivot.add(pool);
    pivot.visible = false;
    CBZ.scene.add(pivot);
    R.pivot = pivot; R.pool = pool;
  }

  // ---- the two torches (built on first use) --------------------------------
  function worldTorch() {
    if (!R.world && CBZ.buildFlashlight) {
      R.world = CBZ.buildFlashlight({ lit: true });
      R.world.visible = false;
      R.world.userData.dynamic = true;
    }
    return R.world;
  }
  function fpTorch() {
    if (!R.fp && CBZ.buildFlashlight) {
      const t = CBZ.buildFlashlight({ lit: true, private: true });
      // the viewmodel's queue: drawn after the depth clear, depth-tested
      // against itself, like the hands and guns it sits among
      t.traverse(function (o) {
        o.renderOrder = 1000;
        o.frustumCulled = false;
        o.castShadow = false;
        if (o.material) { o.material.depthTest = true; o.material.depthWrite = true; o.material.transparent = true; }
      });
      t.visible = false;
      R.fp = t;
    }
    return R.fp;
  }

  // ---- seating ---------------------------------------------------------------
  function seatInHand(t, hand, side) {
    if (t.parent !== hand) hand.add(t);
    CBZ.fpHands.torchMount(side, t.userData.handle, t.position, t.quaternion);
    t.scale.setScalar(1);
    t.visible = true;
  }
  /* THE RAIL: where a torch mounts on a long gun, in the gun's own frame,
     measured once per gun model from its real parts. Under the bore just
     ahead of the handguard (the support hand's part, grips.hold), glass a
     few cm behind the muzzle; on a vertical-grip tube (the launchers) the
     underside is the grip hand's, so it goes on the left side of the tube. */
  const RAILS = new WeakMap();
  const _rb = new THREE.Box3(), _rbb = new THREE.Box3(), _rm = new THREE.Matrix4();
  const RAIL_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);  // torch +Z onto the gun's -Z (forward)
  function skipForRail(o, model) {
    for (let p = o; p && p !== model; p = p.parent) {
      if (p.userData && (p.userData.fpGripHand || p.userData.side || p.userData.flashlight)) return true;
      if (p === model.userData.fpSupport) return true;
    }
    return false;
  }
  function railOf(model, t) {
    let r = RAILS.get(model);
    if (r !== undefined) return r;
    r = null;
    const gr = model.userData.grips, hold = gr && gr.hold, mz = model.userData.muzzle;
    if (hold && mz) {
      const K = RAIL_K, len = t.userData.length * K, head = t.userData.headRadius * K;
      const under = hold.kind !== "vgrip";
      let tailZ = under ? hold.z - (hold.len || 0.2) / 2 + 0.02 * K : hold.z - (hold.d || 0.08) / 2 - 0.03 * K;
      let lensZ = tailZ - len;
      const lim = mz.z + 0.03 * K;                      // the glass stays behind the muzzle
      if (lensZ < lim) { lensZ = lim; tailZ = lensZ + len; }
      _rb.makeEmpty();
      model.traverse(function (o) {
        if (!o.isMesh || !o.geometry || skipForRail(o, model)) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        _rm.identity();
        for (let p = o; p && p !== model; p = p.parent) { p.updateMatrix(); _rm.premultiply(p.matrix); }
        _rbb.copy(o.geometry.boundingBox).applyMatrix4(_rm);
        if (_rbb.max.z < lensZ || _rbb.min.z > tailZ) return;
        if (under && (_rbb.min.x > 0.08 * K || _rbb.max.x < -0.08 * K)) return;   // off to a side: not under the bore
        _rb.union(_rbb);
      });
      const gap = head + 0.003 * K;
      const pos = new THREE.Vector3();
      if (under) pos.set(mz.x, (_rb.isEmpty() ? mz.y - 0.05 * K : _rb.min.y) - gap, 0);
      else pos.set((_rb.isEmpty() ? mz.x - 0.06 * K : _rb.min.x) - gap, mz.y, 0);
      pos.z = lensZ + t.userData.beamOrigin.z * K;       // RAIL_Q maps torch z onto -z
      r = { pos: pos, k: K };
    }
    RAILS.set(model, r);
    return r;
  }
  function seatOnRail(t, model) {
    const r = railOf(model, t);
    if (!r) return false;
    if (t.parent !== model) model.add(t);
    t.position.copy(r.pos);
    t.quaternion.copy(RAIL_Q);
    t.scale.setScalar(r.k);
    t.visible = true;
    return true;
  }

  /* The hand's frame from what the torch must do: its X runs along the torch
     (the lens out of the little finger: +X right hand, -X left), its Z up the
     forearm toward `elbowHint` (made square to the torch — a reverse grip
     holds the tube across the forearm). */
  const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4();
  function handBasis(side, dir, elbowHint, outQ) {
    _bx.copy(dir).multiplyScalar(side < 0 ? -1 : 1);
    _bz.copy(elbowHint).addScaledVector(_bx, -elbowHint.dot(_bx));
    if (_bz.lengthSq() < 1e-8) _bz.set(0, -1, 0).addScaledVector(_bx, _bx.y);
    _bz.normalize();
    _by.crossVectors(_bz, _bx);
    _bm.makeBasis(_bx, _by, _bz);
    return outQ.setFromRotationMatrix(_bm);
  }

  // ---- third person: a body hand ---------------------------------------------
  function bodyHand(ch, side) {
    const part = ch && ch.parts && (side < 0 ? ch.parts.la : ch.parts.ra);
    const cap = part && part.userData && part.userData.cap;
    return cap && cap.userData && cap.userData.fit ? cap : null;
  }
  function releaseBodyHand(ch) {
    if (R.tpSide && ch && ch.setHandPose) ch.setHandPose(R.tpSide < 0 ? "l" : "r", "relaxed");
    R.tpSide = 0;
    R.arm = 0;
  }
  function armBusy(ch) {
    return !!(ch.slidePose || ch.cuffed || ch.surrender || ch.handsUp || ch.verbHold || (CBZ.player && CBZ.player.dead));
  }
  const _hq = new THREE.Quaternion(), _lq = new THREE.Quaternion(), _gc = new THREE.Vector3();
  const _W = new THREE.Vector3(), _s = new THREE.Vector3(), _fz = new THREE.Vector3();
  // close `side`'s body hand on the torch with the lens along `dir`, its grip
  // centre at world C, the arm solved to it (blend R.arm)
  function holdInBodyHand(ch, side, C, dir, elbowHint, solveArm) {
    const hand = bodyHand(ch, side);
    if (!hand) return null;
    const arm = side < 0 ? "l" : "r";
    if (ch.setHandPose) ch.setHandPose(arm, "torch");
    if (!solveArm || !CBZ.charArmTo || !CBZ.charArmTo.wrist) return hand;   // held where the arm already is
    handBasis(side, dir, elbowHint, _hq);
    const fit = hand.userData.fit, low = hand.parent;
    low.updateWorldMatrix(true, false);
    _s.setFromMatrixScale(low.matrixWorld);
    CBZ.fpHands.gripCentre("torch", _gc);
    if (side < 0) _gc.x = -_gc.x;
    _W.copy(_gc).multiplyScalar(fit.s * _s.x).applyQuaternion(_hq);
    _W.subVectors(C, _W);                                   // where the wrist crease must be
    _fz.set(0, 0, 1).applyQuaternion(_hq);                  // wrist -> elbow
    try { CBZ.charArmTo.wrist(ch, _W, arm, _fz, R.arm); } catch (e) {}
    low.updateWorldMatrix(true, false);
    low.getWorldQuaternion(_lq);
    hand.quaternion.copy(_lq.invert()).multiply(_hq);
    hand.position.set(0, fit.wristY, 0);
    return hand;
  }

  const _fwd = new THREE.Vector3(), _org = new THREE.Vector3(), _v = new THREE.Vector3();
  const _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _C = new THREE.Vector3();
  const _dir = new THREE.Vector3(), _eh = new THREE.Vector3(), _camP = new THREE.Vector3();
  const _bf = new THREE.Vector3(), _br = new THREE.Vector3();

  // systems/helditems.js puts a charge / frag / detonator in the RIGHT hand
  function itemInRight() {
    try { return !!(CBZ.heldItem && CBZ.heldItem.current && CBZ.heldItem.current()); } catch (e) { return false; }
  }

  // third person: who holds it and where; returns the torch whose lens lights
  function holdThirdPerson(ch, P, dt) {
    const t = worldTorch();
    if (!t || !ch || !CBZ.fpHands || !CBZ.fpHands.torchMount) return null;
    const prop = CBZ.tpHandWeapon ? CBZ.tpHandWeapon() : null;
    const gr = prop && prop.userData && prop.userData.grips;
    if (prop && gr && gr.hold) {
      // a long gun: the off hand is on the handguard, the torch on the rail
      releaseBodyHand(ch);
      if (!seatOnRail(t, prop)) { t.visible = false; return null; }
      R.holder = "rail";
      return t;
    }
    const item = !prop && itemInRight();
    const side = prop || item ? -1 : 1;
    if (R.tpSide !== side) { releaseBodyHand(ch); R.tpSide = side; }
    const busy = armBusy(ch);
    R.arm = busy ? 0 : R.arm + (1 - R.arm) * Math.min(1, 10 * (dt || 0.016));
    // body frame (the rig faces its own group yaw, not the camera)
    const yaw = ch.group ? ch.group.rotation.y : 0;
    _bf.set(Math.sin(yaw), 0, Math.cos(yaw));
    _br.set(-Math.cos(yaw), 0, Math.sin(yaw));             // the body's right
    // pointed where you look, unless that is behind the body
    _dir.copy(_fwd);
    if (_dir.x * _bf.x + _dir.z * _bf.z < 0.15) _dir.set(_bf.x, _fwd.y, _bf.z);
    _dir.normalize();
    if (prop) {
      // HARRIES: the torch fist under the firing fist, aimed down the same line
      const fg = prop.userData.fireGrip;
      if (fg && fg.at) { prop.updateWorldMatrix(true, false); prop.localToWorld(_C.set(0, fg.at[0], fg.at[1])); }
      else { const hr = bodyHand(ch, 1); if (hr) hr.getWorldPosition(_C); else _C.set(P.pos.x, P.pos.y + 1.25, P.pos.z).addScaledVector(_bf, 0.4); }
      _C.addScaledVector(_up, -0.09).addScaledVector(_dir, 0.03);
      _eh.copy(_br).multiplyScalar(-0.8).addScaledVector(_up, -0.6);
    } else {
      // nothing drawn: carried forward at chest height in the right hand (the
      // left, mirrored, while a charge / frag / detonator has the right)
      _C.set(P.pos.x, P.pos.y + 1.25, P.pos.z).addScaledVector(_bf, 0.40).addScaledVector(_br, 0.16 * side);
      _eh.copy(_up).negate().addScaledVector(_br, 0.35 * side).addScaledVector(_bf, -0.1);
    }
    const hand = holdInBodyHand(ch, side, _C, _dir, _eh, !busy);
    if (!hand) { t.visible = false; return null; }
    seatInHand(t, hand, side);
    R.holder = side < 0 ? "off-hand" : "right-hand";
    return t;
  }

  // ---- first person: the viewmodel hook (fpsmode.js FP_TORCH_VIEW) ------------
  const TORCH_FORE = new THREE.Vector3(0, 0, 1);            // straight wrist: forearm continues the hand's +Z
  const _vmInv = new THREE.Matrix4(), _pm = new THREE.Matrix4(), _hm = new THREE.Matrix4(), _k3 = new THREE.Vector3();
  const _aim = new THREE.Vector3(), _fW = new THREE.Vector3(), _fq = new THREE.Quaternion();
  // put a viewmodel hand at vm-space wrist W, rotation Q, size k
  function setInVm(V, hand, W, Q, k) {
    _pm.identity();
    for (let o = hand.parent; o && o !== V.vm; o = o.parent) { o.updateMatrix(); _pm.premultiply(o.matrix); }
    _hm.compose(W, Q, _k3.set(k, k, k));
    _hm.premultiply(_pm.invert());
    _hm.decompose(hand.position, hand.quaternion, hand.scale);
  }
  function armFor(V, i, hand, arm) {
    const fl = hand.userData.foreLocal;
    hand.userData.foreLocal = TORCH_FORE;
    try { V.gunArm(i, hand, arm); } catch (e) {}
    hand.userData.foreLocal = fl;
    arm.visible = true;
  }
  // give back the hand the torch borrowed last frame (fpsmode re-poses
  // position/pose every frame; rotation and size are what it does not)
  function restoreFpHand(V) {
    const h = R.fpHand;
    R.fpHand = null;
    if (!h) return;
    if (h.userData.baseQ) h.quaternion.copy(h.userData.baseQ);
    if (h === V.handL) h.scale.setScalar(V.HAND_K);
  }
  function fpHold(V) {
    R.fpSeen = true;
    R.fpView = V;
    restoreFpHand(V);
    const t = R.fp;
    const want = lit && owned() && V.vm.visible && !V.dying() && !!(CBZ.fpHands && CBZ.fpHands.torchMount);
    const model = want ? V.model() : null;
    const gr = model && model.userData.grips;
    const kind = !want ? "" : model ? (gr && gr.hold ? "rail" : "off")
      : !V.fists.visible ? "" : itemInRight() ? "left" : (V.handR.visible ? "right" : "");
    if (!kind) { if (t) t.visible = false; return; }
    const T = fpTorch();
    if (!T) return;
    if (kind === "rail") {
      if (!seatOnRail(T, model)) T.visible = false;
      return;
    }
    const H = CBZ.fpHands;
    V.vm.updateMatrix();
    _vmInv.copy(V.vm.matrix).invert();
    _aim.set(0, 0, -AIM).applyMatrix4(_vmInv);              // the crosshair's point, vm space
    if (kind === "right" || kind === "left") {
      // nothing drawn: the right fist carries it (the left while a held item
      // has the right), wherever the fist table has that wrist
      const side = kind === "right" ? 1 : -1;
      const hand = side > 0 ? V.handR : V.handL;
      if (hand.visible) V.inVm(hand, null, _fW, null);
      // the left's carry: fpsmode's HAND_REST wrist mirrored across the
      // CAMERA (vm hangs right of the eye), brought into vm space
      else _fW.set(-0.62, -0.58, -0.68).applyMatrix4(_vmInv);
      hand.visible = true;
      _dir.subVectors(_aim, _fW).normalize();
      handBasis(side, _dir, _eh.set(0.40 * side, -1, 0.30), _fq);
      H.setPose(hand, "torch");
      setInVm(V, hand, _fW, _fq, V.HAND_K);
      seatInHand(T, hand, side);
      armFor(V, side > 0 ? 0 : 1, hand, side > 0 ? V.armR : V.armL);
      R.fpHand = hand;
      return;
    }
    // THE OFF HAND on a one-hand gun: out of the two-hand cup, under the
    // firing fist (Harries), the torch aimed down the same line
    const fire = model.userData.fpFire;
    const k = fire ? V.worldScaleInVm(fire) : V.HAND_K;
    let hand = model.userData.fpSupport;
    if (hand) hand.visible = true;       // (at the hip a handgun's off hand is out of frame: the torch brings it up)
    if (!hand) {
      // a gun with no support hand (the taser): the fist rig's left hand
      hand = V.handL;
      V.fists.visible = true; V.handR.visible = false; hand.visible = true;
    }
    const fg = fire && fire.userData.grasp;
    if (fg && fg.prism) V.inVm(fire.parent, fg.prism.o, _C, null);
    else V.inVm(model, null, _C, null);
    _dir.subVectors(_aim, _C).normalize();
    _C.addScaledVector(_up, -0.085 * k).addScaledVector(_dir, 0.02 * k);
    handBasis(-1, _dir, _eh.set(-0.80, -0.65, 0.25), _fq);
    H.gripCentre("torch", _gc);
    _gc.x = -_gc.x;
    _fW.copy(_gc).multiplyScalar(k).applyQuaternion(_fq);
    _fW.subVectors(_C, _fW);
    H.setPose(hand, "torch");
    setInVm(V, hand, _fW, _fq, k);
    seatInHand(T, hand, -1);
    armFor(V, 1, hand, V.armL);
    R.fpHand = hand;
  }
  CBZ.fpTorchHold = fpHold;

  // ---- how dark it is where you stand --------------------------------------
  function darkness(x, z) {
    const m = mode();
    if (m === "escape" && CBZ.prisonLights && CBZ.prisonLights.level) {
      try { return 1 - Math.max(0, Math.min(1, CBZ.prisonLights.level(x, z))); } catch (e) {}
    }
    const d = typeof CBZ.dayness === "number" ? CBZ.dayness : 1;
    return 1 - Math.max(0, Math.min(1, d));
  }

  function firstPerson() {
    if (CBZ.fps && CBZ.fps.active) return true;
    return mode() === "city" && !!(CBZ.cityCam && CBZ.cityCam.fp);
  }

  function hideAll() {
    if (R.light) R.light.intensity = 0;
    if (R.pivot) R.pivot.visible = false;
    if (R.world) R.world.visible = false;
    if (R.fp) R.fp.visible = false;
    releaseBodyHand(CBZ.playerChar);
    R.holder = "none";
  }

  function tick(dt) {
    const m = mode();
    const has = (m === "escape" || m === "city") && owned();
    // LOSING IT PUTS IT OUT: sold, frisked, dropped on death, a new run.
    if (!has && lit) { lit = false; publish(); }
    const cuffs = has && cuffed();
    if (cuffs && lit) { cuffLit = true; set(false); }
    else if (!cuffs && cuffLit) { cuffLit = false; if (has) set(true); }
    if (has && !R.built) build();
    const fpSeen = R.fpSeen;
    R.fpSeen = false;
    // the viewmodel skipped its pass (a car, a cutscene): nothing may stay
    // borrowed or drawn there
    if (!fpSeen) {
      if (R.fp) R.fp.visible = false;
      if (R.fpHand && R.fpView) restoreFpHand(R.fpView);
    }
    if (!R.built) return;
    const P = CBZ.player, cam = CBZ.camera;
    if (P && P.flashlightOn !== lit) P.flashlightOn = lit;
    // a mode that swaps the scene root must not strand the one light
    if (R.light.parent !== CBZ.scene && CBZ.scene) { CBZ.scene.add(R.light); CBZ.scene.add(R.target); CBZ.scene.add(R.pivot); }
    if (!lit || !P || !P.pos || !cam || P.dead) { hideAll(); return; }

    const fp = firstPerson();
    cam.getWorldDirection(_fwd);
    cam.getWorldPosition(_camP);
    const ch = CBZ.playerChar;

    // ---- the hand ----------------------------------------------------------
    let src = null;
    if (fp) {
      if (R.world) R.world.visible = false;
      releaseBodyHand(ch);
      if (fpSeen && R.fp && R.fp.visible) { src = R.fp; R.holder = R.fpHand ? (R.fpHand === (R.fpView && R.fpView.handR) ? "right-hand" : "off-hand") : "rail"; }
      else R.holder = "none";
    } else {
      src = holdThirdPerson(ch, P, dt);
      if (!src) { if (R.world) R.world.visible = false; releaseBodyHand(ch); R.holder = "none"; }
    }

    // ---- the beam: out of the lens ----------------------------------------
    if (src) {
      src.updateWorldMatrix(true, false);
      _org.copy(src.userData.beamOrigin);
      src.localToWorld(_org);
      if (fp) {
        // the viewmodel is a scaled world in front of the eye: bring the lens
        // back to real distance along its own sight line, and aim at the
        // crosshair's point the viewmodel torch is pointed at
        const s = src.matrixWorld.getMaxScaleOnAxis() || 1;
        _org.sub(_camP).multiplyScalar(1 / s).add(_camP);
        _v.copy(_camP).addScaledVector(_fwd, AIM);
        _fwd.subVectors(_v, _org).normalize();
      } else {
        _v.copy(src.userData.beamOrigin).add(src.userData.forward);
        src.localToWorld(_v);
        _fwd.subVectors(_v, _org).normalize();
      }
    } else if (fp) {
      // no hand in view (a car, a pickup beat): at the camera, a little right and below
      _right.crossVectors(_fwd, _up).normalize();
      _org.copy(_camP).addScaledVector(_right, 0.16).addScaledVector(_up, -0.2).addScaledVector(_fwd, 0.12);
    } else {
      // no reachable hand (rig without hands): chest height, just ahead
      _org.set(P.pos.x + _fwd.x * 0.35, P.pos.y + 1.3, P.pos.z + _fwd.z * 0.35);
    }

    // ---- the light --------------------------------------------------------
    const dark = darkness(P.pos.x, P.pos.z);
    R.light.position.copy(_org);
    R.target.position.copy(_org).addScaledVector(_fwd, AIM);
    R.light.intensity = DAY_I + (NIGHT_I - DAY_I) * dark;
    R.light.updateMatrixWorld(); R.target.updateMatrixWorld();
    if (src && src.userData.lensMat) src.userData.lensMat.emissiveIntensity = 1.2 + dark * 0.8;

    // ---- the pool where the beam meets the floor --------------------------
    let shown = false;
    if (_fwd.y < -0.03) {
      let floor = P.pos.y;
      const t0 = (_org.y - floor) / -_fwd.y;
      if (t0 > 0.4 && t0 < POOL_MAX) {
        const hx = _org.x + _fwd.x * t0, hz = _org.z + _fwd.z * t0;
        if (CBZ.groundAt) {
          try { const gy = CBZ.groundAt(hx, hz, _org.y); if (isFinite(gy) && Math.abs(gy - floor) < 1.2) floor = gy; } catch (e) {}
        }
        const t = Math.max(0.4, (_org.y - floor) / -_fwd.y);
        if (t < POOL_MAX) {
          const r = Math.max(0.25, t * Math.tan(ANGLE) * 0.95);
          const stretch = Math.min(3, 1 / Math.max(0.2, -_fwd.y));
          R.pivot.position.set(_org.x + _fwd.x * t, floor + 0.03, _org.z + _fwd.z * t);
          R.pivot.rotation.set(0, Math.atan2(_fwd.x, _fwd.z), 0);
          R.pool.scale.set(r, r * stretch, 1);
          R.pool.material.opacity = (0.05 + 0.2 * dark) * (1 - t / POOL_MAX);
          shown = true;
        }
      }
    }
    R.pivot.visible = shown;
  }

  // 54.7: after camera.js (50), fpsmode (52, which runs CBZ.fpTorchHold right
  // after its arms), holsterprops (54) and gunhands' off-hand pass (54.6), so
  // the arm we take is not overwritten this frame and the light leaves from
  // where the lens and the camera actually ended up.
  if (CBZ.onAlways) CBZ.onAlways(54.7, tick);

  CBZ.playerFlashlightAudit = function () {
    return {
      owned: owned(),
      on: CBZ.playerFlashlight.on(),
      lightBuilt: !!R.light,
      intensity: R.light ? Math.round(R.light.intensity * 1000) / 1000 : 0,
      holder: R.holder,
    };
  };


  /* ============================================================
     WHERE A PRISONER FINDS ONE (besides a guard's belt).
     Laid through prisondrops.js's CBZ.prisonPlaceItem: the same prop, the
     same walk-over pickup (addItem("Guard Torch")), the same new-run re-lay.
     Deferred to the first escape tick for the same reason every other
     placement is: prisondrops registers its prop type after the world parses.
     ============================================================ */
  const PLACED = [
    // the corner duty desk (entities/keycard.js: slab top 0.94, x 12.95..14.85,
    // z -11.98..-11.03), front edge between the card (13.5,-11.5) and the mug
    // (14.52,-11.24), clear of the clipboard and the lamp base at the back.
    ["Guard Torch", 14.05, 1.02, -11.24],
    // the powerhouse (world/prisonwings.js): left on the top run of the middle
    // pipe bank (x -96..-85, z 83, top at 1.59 m), between two stanchions.
    ["Guard Torch", -90.8, 1.68, 83.0, "honest"],
  ];
  let placed = false;
  if (CBZ.onUpdate) CBZ.onUpdate(41.9, function () {
    if (placed || !CBZ.prisonPlaceItem || mode() !== "escape") return;
    placed = true;
    const honest = !(CBZ.CONFIG && CBZ.CONFIG.PRISON_PROP_HONESTY_V1 === false);
    for (let i = 0; i < PLACED.length; i++) {
      const p = PLACED[i];
      if (p[4] === "honest" && !honest) continue;     // no pipe bank to lie on
      try { CBZ.prisonPlaceItem(p[0], p[1], p[2], p[3]); } catch (e) {}
    }
  });
})();
