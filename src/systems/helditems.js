/* ============================================================
   systems/helditems.js — THE CHARGE, THE DETONATOR AND THE FRAG ARE IN
   YOUR HAND, AND THE ONE USE INPUT DOES WHAT THE THING IN YOUR HAND DOES.

   OWNER (2026-09-28): "it's not clear how to use it (you hold to use it). It
   shouldn't be its own button, that's dumb; it should be something you have
   to hold."

   Before: a dedicated C4 button on the glass with a tap/hold grammar you had
   to be told about ([B] tap = plant, hold = detonate), and a grenade that
   left your pocket the instant you touched its hotbar cell.

   Now (rules in systems/helditem_model.js, pure and node-checked):
     select the CHARGE cell (or [B]) -> the brick is in your right hand. Look
       at a wall / door / car / person / the ground within reach and a ghost
       of the brick lies flush on it. HOLD use: the hand pushes forward and
       presses it on. A quick press with nothing in reach throws it.
     a charge is out -> a DETONATOR cell appears. In your hand, press use:
       your fingers squeeze its lever and everything goes.
     select the GRENADE cell -> the frag is in your hand. HOLD use: the ring
       comes out and the arm winds back. RELEASE: the throw, harder the
       longer you held.
   Drawing a gun puts the item away; selecting the item holsters the gun.

   Seams: CBZ.heldItem = { current(), select(kind), clear(), use(down),
   fpHold(vm, fistT, handR, handL) } (fpsmode.js calls fpHold in its viewmodel
   pass and use() at the top of fireControl; touch.js's FIRE calls use()).
   Explosives: CBZ.cityC4PlantAt / cityC4Throw / cityC4Detonate
   (city/explosives.js); frag: CBZ.cityThrowFromInventory({power}).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.heldItemModel) return;
  const M = CBZ.heldItemModel;

  let held = null;          // "c4" | "detonator" | "grenade" | null
  let down = false, downT = 0;
  let pressedT = 0;         // the push-and-return after a brick goes on
  let squeezeT = -1, squeezeFired = false;
  let throwGone = 0;        // the frag has left the hand; a fresh one comes up after
  let ghostPl = null;       // this frame's placement under the look
  let lastMode = "";

  function game() { return CBZ.game || {}; }
  function mode() { return game().mode || ""; }
  function blastLive() { return CBZ.modeHas ? CBZ.modeHas("blast") : mode() === "city"; }
  function c4Count() { try { return CBZ.cityC4Count ? CBZ.cityC4Count() | 0 : 0; } catch (e) { return 0; } }
  function planted() { try { return CBZ.cityC4Planted ? CBZ.cityC4Planted() | 0 : 0; } catch (e) { return 0; } }
  function grenades() { try { return mode() === "city" && CBZ.cityGrenadeCount ? CBZ.cityGrenadeCount() | 0 : 0; } catch (e) { return 0; } }
  function state() {
    const live = blastLive();
    return { c4: live ? c4Count() : 0, planted: live ? planted() : 0, grenades: grenades(), held: held };
  }
  function gunDrawn() { try { return !!(CBZ.fpsArmed && CBZ.fpsArmed()); } catch (e) { return false; } }
  function holsterGun() {
    if (!gunDrawn()) return;
    if (mode() === "city" && CBZ.cityHolster) CBZ.cityHolster(true);
    else if (CBZ.playerHolster) CBZ.playerHolster(true);
  }
  function sfx(name, o) { if (CBZ.sfx) { try { CBZ.sfx(name, o || {}); } catch (e) {} } }

  function setHeld(k) {
    if (k === held) return;
    held = k;
    down = false; downT = 0; squeezeT = -1; squeezeFired = false; throwGone = 0; pressedT = 0;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function select(kind) {
    const s = state();
    const k = M.resolveHeld(kind, s);
    if (!k) return false;
    if (k === held) { setHeld(null); sfx("equip", { volume: 0.25 }); return true; }   // picked again = put away
    holsterGun();
    setHeld(k);
    sfx("equip", { volume: 0.4 });
    return true;
  }

  // ---- USE: the one input -------------------------------------------------
  function use(isDown) {
    if (!held) return false;
    const G = game(), P = CBZ.player;
    if (G.state !== "playing" || !P || P.dead) return false;
    if (CBZ.cityMenuOpen) return false;
    if (held === "detonator") {
      if (isDown && squeezeT < 0) { squeezeT = 0; squeezeFired = false; }
      return true;
    }
    if (P.driving) return false;           // the brick and the frag want both feet on the ground
    if (held === "c4") {
      if (isDown) { down = true; downT = 0; }
      else if (down) {
        down = false;
        // released before the press finished: nothing under the look means
        // it was a throw; a surface under the look means you let go early
        if (!ghostPl && downT < M.PLACE_HOLD && CBZ.cityC4Throw) {
          if (CBZ.cityC4Throw()) { pressedT = 0.3; sfx("whoosh", { volume: 0.4 }); }
        }
      }
      return true;
    }
    if (held === "grenade") {
      if (throwGone > 0) return true;
      if (isDown) { down = true; downT = 0; sfx("switch", { volume: 0.5, pitch: 1.6 }); }   // the pin
      else if (down) {
        down = false;
        const power = M.throwPower(downT);
        if (CBZ.cityThrowFromInventory) { try { CBZ.cityThrowFromInventory({ power: power }); } catch (e) {} }
        throwGone = 0.55;
      }
      return true;
    }
    return false;
  }

  // ---- the props ------------------------------------------------------------
  const PROPS = { fp: {}, tp: {} };
  function buildProp(kind) {
    let m = null;
    if (kind === "c4" && CBZ.buildC4Brick) m = CBZ.buildC4Brick(THREE);
    else if (kind === "detonator" && CBZ.buildC4Detonator) m = CBZ.buildC4Detonator(THREE);
    else if (kind === "grenade" && CBZ.grenadeMesh) {
      m = CBZ.grenadeMesh(THREE);
      if (m) {
        // held at its real size (9 cm tall), whatever the thrown-read boost is
        const box = new THREE.Box3().setFromObject(m), sz = box.getSize(new THREE.Vector3());
        if (sz.y > 1e-4) m.scale.multiplyScalar(0.09 / sz.y);
      }
    }
    return m;
  }
  // FP copies ride the viewmodel's late queue (after its depth clear), so they
  // get their own material clones: the world's charges keep the shared set.
  function fpProp(kind) {
    if (PROPS.fp[kind] !== undefined) return PROPS.fp[kind];
    const m = buildProp(kind);
    if (m) m.traverse(function (o) {
      o.frustumCulled = false; o.renderOrder = 1001;
      if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.depthTest = true; o.material.depthWrite = o.material.opacity >= 1; }
    });
    PROPS.fp[kind] = m || null;
    return PROPS.fp[kind];
  }
  function tpProp(kind) {
    if (PROPS.tp[kind] !== undefined) return PROPS.tp[kind];
    const m = buildProp(kind);
    if (m) m.traverse(function (o) { o.userData.dynamic = true; });
    PROPS.tp[kind] = m || null;
    return PROPS.tp[kind];
  }

  // How each prop sits in a closed hand. Hand frame (systems/fphands.js): +X
  // across the palm (the grip axis), +Y the back of the hand, +Z up the arm;
  // gripCentre(pose) is the middle of what the fingers close round.
  const GRIP = {
    // the brick lies across the palm, its face (+Y, the receiver) outward
    c4: { pose: "hold034", basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], off: [0.02, 0.006, 0] },
    // the detonator's body runs along the grip axis, its lever (-Z face) in the fingers
    detonator: { pose: "hold022", basis: [[0, 0, 1], [1, 0, 0], [0, 1, 0]], off: [0, 0, 0] },
    grenade: { pose: "hold034", basis: [[0, 0, 1], [1, 0, 0], [0, 1, 0]], off: [0, 0, 0] },
  };
  const _gc = new THREE.Vector3(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
  const _mb = new THREE.Matrix4();
  function seatInHand(prop, kind, FPH) {
    const G = GRIP[kind];
    if (FPH && FPH.gripCentre) FPH.gripCentre(G.pose, _gc); else _gc.set(0, -0.05, -0.04);
    prop.position.set(_gc.x + G.off[0], _gc.y + G.off[1], _gc.z + G.off[2]);
    _bx.fromArray(G.basis[0]); _by.fromArray(G.basis[1]); _bz.fromArray(G.basis[2]);
    _mb.makeBasis(_bx, _by, _bz);
    prop.quaternion.setFromRotationMatrix(_mb);
  }

  // the detonator lever and the frag's ring follow the hand's state
  function animProp(prop, kind) {
    if (!prop) return;
    if (kind === "detonator" && prop.userData.lever) {
      const o = prop.userData.leverOpen, s = prop.userData.leverShut;
      const k = squeezeT < 0 ? 0 : Math.min(1, squeezeT / 0.1) * (squeezeT > 0.4 ? Math.max(0, 1 - (squeezeT - 0.4) / 0.2) : 1);
      prop.userData.lever.rotation.x = o + (s - o) * k;
    }
    if (kind === "grenade" && prop.userData.ring) prop.userData.ring.visible = !down;
  }

  /* FIRST PERSON: fpsmode.js calls this in its viewmodel pass, the same slot
     systems/verbs_pickup.js's fpPickup uses. It owns the RIGHT wrist target
     while an item is held, and parents the prop to the right hand, so the
     arm IK, the hand and the thing in it are one object. */
  const PRESENT = { x: 0.15, y: -0.13, z: 0.02, roll: 0.55, bend: 0.12 };
  function fpHold(vm, fistT, handR) {
    const kinds = ["c4", "detonator", "grenade"];
    for (let i = 0; i < kinds.length; i++) {
      const p = PROPS.fp[kinds[i]];
      if (p && kinds[i] !== held) p.visible = false;
    }
    if (!held || !handR || !fistT || !fistT[0]) return false;
    if (held === "grenade" && throwGone > 0) return false;      // the fists play the throw
    const prop = fpProp(held);
    if (!prop) return false;
    const FPH = CBZ.fpHands;
    if (prop.parent !== handR) { handR.add(prop); seatInHand(prop, held, FPH); }
    prop.visible = true;
    animProp(prop, held);
    const T = fistT[0];
    T.vis = true; T.hook = 0;
    T.curl = GRIP[held].pose;
    T.x = PRESENT.x; T.y = PRESENT.y; T.z = PRESENT.z; T.roll = PRESENT.roll; T.bend = PRESENT.bend;
    if (held === "c4") {
      // the press: the hand drives the brick out toward the surface
      const k = down ? Math.min(1, downT / M.PLACE_HOLD) : (pressedT > 0 ? pressedT / 0.3 : 0);
      const e = k * k * (3 - 2 * k);
      T.z -= 0.34 * e; T.y += 0.07 * e; T.x -= 0.05 * e; T.bend -= 0.35 * e;
    } else if (held === "grenade" && down) {
      const w = Math.min(1, downT / 0.35);
      T.x += 0.05 * w; T.y += 0.13 * w; T.z += 0.16 * w; T.bend -= 0.45 * w; T.roll += 0.3 * w;
    } else if (held === "detonator") {
      T.y += 0.03; T.roll += 0.25;
      if (squeezeT >= 0 && squeezeT < 0.3) T.z += 0.015 * Math.sin(Math.min(1, squeezeT / 0.1) * Math.PI);
    }
    return true;
  }

  // THIRD PERSON: the same prop in the body's right hand, the arm brought up
  // in front of the chest while presenting it.
  const _hand = new THREE.Vector3();
  let tpKind = null;
  function tpTick(dt) {
    const ch = CBZ.playerChar;
    const sock = ch && ch.sockets && ch.sockets.rightHand;
    const fp = !!(CBZ.fps && CBZ.fps.active);
    const show = held && !fp && sock && !(held === "grenade" && throwGone > 0);
    if (tpKind && (tpKind !== held || !show)) {
      const old = PROPS.tp[tpKind];
      if (old) old.visible = false;
      tpKind = null;
    }
    if (!show) return;
    const prop = tpProp(held);
    if (!prop) return;
    if (prop.parent !== sock) {
      sock.add(prop);
      // the socket's frame is the hand's; the same seat numbers as the FP hand
      // at the body hand's scale (a body hand is drawn at ~1.1x)
      seatInHand(prop, held, CBZ.fpHands);
    }
    prop.visible = true; tpKind = held;
    animProp(prop, held);
    const P = CBZ.player;
    if (!ch.group || !P || !P.pos || !CBZ.charArmTo) return;
    const yaw = ch.group.rotation.y, bx = Math.sin(yaw), bz = Math.cos(yaw);
    let reach = 0.36, up = 1.18;
    if (held === "c4") {
      const k = down ? Math.min(1, downT / M.PLACE_HOLD) : (pressedT > 0 ? pressedT / 0.3 : 0);
      reach += 0.3 * k; up += 0.12 * k;
    } else if (held === "grenade" && down) { reach = 0.05; up = 1.6; }
    _hand.set(P.pos.x + bx * reach - bz * 0.16, P.pos.y + up, P.pos.z + bz * reach + bx * 0.16);
    try {
      if (CBZ.charArmTo.rest) CBZ.charArmTo.rest(ch, "r", 0);
      CBZ.charArmTo(ch, _hand, "r", 1);
      if (ch.setHandPose) ch.setHandPose("r", "grip");
    } catch (e) {}
  }

  // ---- the ghost: where the brick will go ---------------------------------
  let ghost = null;
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xc8d6a6, transparent: true, opacity: 0.32, depthWrite: false });
  function ensureGhost() {
    if (ghost || !CBZ.buildC4Brick) return ghost;
    ghost = CBZ.buildC4Brick(THREE);
    ghost.traverse(function (o) { if (o.material) o.material = ghostMat; o.renderOrder = 2; });
    if (ghost.userData.led) ghost.userData.led.visible = false;
    ghost.visible = false;
    return ghost;
  }
  const _eye = new THREE.Vector3(), _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3();
  const _boxes = [], _cars = [], _actors = [], _near = [];
  const _o = { x: 0, y: 0, z: 0 }, _d = { x: 0, y: 0, z: 0 };
  const _personBoxes = [];
  for (let i = 0; i < 8; i++) _personBoxes.push({ minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, y1: 0, person: true, ref: null });
  const _carRecs = [];
  for (let i = 0; i < 8; i++) _carRecs.push({ x: 0, y: 0, z: 0, yaw: 0, hx: 1, hy: 0.75, hz: 2.2, ref: null });
  const WORLD = { boxes: _boxes, cars: _cars, floorAt: null };

  function gatherWorld(px, pz, R) {
    _boxes.length = 0; _cars.length = 0;
    const cols = CBZ.queryCollidersNear ? CBZ.queryCollidersNear(px, pz, R, _near) : (CBZ.colliders || []);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || c.maxX < px - R || c.minX > px + R || c.maxZ < pz - R || c.minZ > pz + R) continue;
      _boxes.push(c);
    }
    const cars = CBZ.cityCars || [];
    for (let i = 0, k = 0; i < cars.length && k < _carRecs.length; i++) {
      const c = cars[i];
      if (!c || !c.pos || !c.group || c.player || (CBZ.player && CBZ.player.driving === c)) continue;
      if (Math.abs(c.pos.x - px) > R + 3 || Math.abs(c.pos.z - pz) > R + 3) continue;
      const d = c._visualDims || c.dims || {};
      const r = _carRecs[k++];
      r.x = c.pos.x; r.y = c.pos.y || 0; r.z = c.pos.z; r.yaw = +c.heading || 0;
      r.hx = (d.width || 2) / 2; r.hz = (d.length || 4.4) / 2; r.hy = (d.height || 1.45) / 2; r.ref = c;
      _cars.push(r);
    }
    if (CBZ.worldActors) {
      const list = CBZ.worldActors(_actors);
      let k = 0;
      for (let i = 0; i < list.length && k < _personBoxes.length; i++) {
        const a = list[i];
        if (!a || !a.group || a.dead) continue;
        const ap = CBZ.actorPos ? CBZ.actorPos(a) : (a.pos || a.group.position);
        if (!ap || Math.abs(ap.x - px) > R || Math.abs(ap.z - pz) > R) continue;
        const b = _personBoxes[k++];
        b.minX = ap.x - 0.24; b.maxX = ap.x + 0.24; b.minZ = ap.z - 0.24; b.maxZ = ap.z + 0.24;
        b.y0 = (ap.y || 0) + 0.2; b.y1 = (ap.y || 0) + 1.75; b.ref = a;
        _boxes.push(b);
      }
      _actors.length = 0;
    }
    WORLD.floorAt = CBZ.floorAt || null;
    return WORLD;
  }

  function pickTick() {
    ghostPl = null;
    const P = CBZ.player, cam = CBZ.camera;
    if (held !== "c4" || !P || !P.pos || !cam || P.driving || P.dead) return;
    if (c4Count() <= 0 || planted() >= (CBZ.cityC4MaxPlanted ? CBZ.cityC4MaxPlanted() : M.MAX_OUT)) return;
    cam.getWorldPosition(_eye); cam.getWorldDirection(_dir);
    const cx = P.pos.x, cy = (P.pos.y || 0) + 1.3, cz = P.pos.z;
    const back = Math.hypot(_eye.x - cx, _eye.y - cy, _eye.z - cz);
    _o.x = _eye.x; _o.y = _eye.y; _o.z = _eye.z; _d.x = _dir.x; _d.y = _dir.y; _d.z = _dir.z;
    const hit = M.pickSurface(_o, _d, gatherWorld(cx, cz, M.REACH + 1.5), M.REACH + back);
    if (!hit) return;
    // the charge goes where YOUR HAND can reach, not where the camera can
    if (Math.hypot(hit.point.x - cx, hit.point.y - cy, hit.point.z - cz) > M.REACH) return;
    // never onto yourself
    if (hit.kind === "person" && hit.ref === CBZ.player) return;
    ghostPl = M.placement(hit, M.REACH + back);
  }

  function ghostTick() {
    const gh = ensureGhost();
    if (!gh) return;
    if (!ghostPl) { gh.visible = false; return; }
    if (gh.parent !== CBZ.scene && CBZ.scene) CBZ.scene.add(gh);
    gh.position.set(ghostPl.pos.x, ghostPl.pos.y, ghostPl.pos.z);
    _n.set(ghostPl.normal.x, ghostPl.normal.y, ghostPl.normal.z);
    gh.quaternion.setFromUnitVectors(_up, _n);
    // brightens as the press completes
    ghostMat.opacity = 0.22 + (down ? 0.4 * Math.min(1, downT / M.PLACE_HOLD) : 0);
    gh.visible = true;
  }

  // ---- the frame ------------------------------------------------------------
  function tick(dt) {
    const G = game(), m = mode();
    if (m !== lastMode) { lastMode = m; setHeld(null); }
    if (held) {
      const P = CBZ.player;
      if (G.state !== "playing" || !P || P.dead) setHeld(null);
      else if (gunDrawn()) setHeld(null);                 // a gun came up: the item went away
      else {
        const k = M.resolveHeld(held, state());
        if (k !== held) setHeld(k);                       // last brick on: the detonator is in your hand
      }
    }
    if (pressedT > 0) pressedT = Math.max(0, pressedT - dt);
    if (throwGone > 0) throwGone = Math.max(0, throwGone - dt);
    if (down) downT += dt;
    pickTick();
    if (held === "c4" && down && downT >= M.PLACE_HOLD && ghostPl) {
      down = false;
      const ok = CBZ.cityC4PlantAt ? CBZ.cityC4PlantAt(ghostPl) : false;
      if (ok) pressedT = 0.3;
      ghostPl = null;
    }
    if (held === "detonator" && squeezeT >= 0) {
      squeezeT += dt;
      if (!squeezeFired && squeezeT >= 0.1) {
        squeezeFired = true;
        sfx("switch", { volume: 0.7, pitch: 0.55 });
        if (CBZ.cityC4Detonate) { try { CBZ.cityC4Detonate(); } catch (e) {} }
      }
      if (squeezeT >= 0.6) squeezeT = -1;
    }
    ghostTick();
    tpTick(dt);
  }
  if (CBZ.onAlways) CBZ.onAlways(51.9, tick);

  // ---- the mouse: while an item is in hand the left button is ITS use -------
  // Window capture so it wins over the unarmed punch and the gun's own
  // listener; only while something is actually held.
  function mouseEligible() {
    return held && game().state === "playing" && document.pointerLockElement && !CBZ.cityMenuOpen;
  }
  addEventListener("mousedown", function (e) {
    if (e.button !== 0 || !mouseEligible()) return;
    if (use(true)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener("mouseup", function (e) {
    if (e.button !== 0 || !held) return;
    if (use(false)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // the hotbar face of the detonator cell: the device itself, drawn
  CBZ.detonatorFaceHtml = function () {
    return "<svg viewBox='0 0 40 40' aria-hidden='true' style='width:70%;height:70%'>" +
      "<rect x='14' y='6' width='12' height='26' rx='2' fill='#4b5438' stroke='#1d2016'/>" +
      "<path d='M13 9 L7 30' stroke='#5d6846' stroke-width='4' stroke-linecap='round'/>" +
      "<path d='M17 5 q3 -4 6 0' fill='none' stroke='#8a9096' stroke-width='1.6'/>" +
      "<path d='M20 32 v3 q0 3 -4 3 h-6' fill='none' stroke='#39402c' stroke-width='1.6'/></svg>";
  };

  CBZ.heldItem = {
    current: function () { return held; },
    select: select,
    clear: function () { setHeld(null); },
    use: use,
    fpHold: fpHold,
    ghost: function () { return ghostPl; },
    audit: function () { return { held: held, down: down, downT: downT, ghost: !!ghostPl, state: state() }; },
  };
})();
