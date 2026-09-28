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
   Audit: CBZ.playerFlashlightAudit() -> { owned, on, lightBuilt, intensity }
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
  function toggle() {
    if (!owned()) { if (lit) set(false); return false; }
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
  const AIM = 12;              // m out along the look to aim the target
  const POOL_MAX = 18;         // m: past this the floor pool has faded out
  const DAY_I = 0.35, NIGHT_I = 2.1;   // intensity in daylight .. in true black

  // ---- the rig (built once, on first ownership) ---------------------------
  const R = { built: false, light: null, target: null, pivot: null, pool: null, model: null, socket: null, arm: 0 };
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

  // The torch in the LEFT hand: the right hand is the weapon hand (its socket
  // carries thirdPersonWeapon). Same mount numbers as guards.js addFlashlight,
  // mirrored: rotate the factory's +Z (beam) onto the socket's -Y, down the
  // forearm and out past the fingers.
  function ensureModel() {
    const ch = CBZ.playerChar;
    const sock = ch && ch.sockets && ch.sockets.leftHand;
    if (!sock || !CBZ.buildFlashlight) return null;
    if (R.model && R.socket === sock) return R.model;
    if (R.model && R.model.parent) R.model.parent.remove(R.model);
    const m = CBZ.buildFlashlight({ lit: true });
    m.position.set(-0.01, -0.025, 0.025);
    m.rotation.x = Math.PI / 2;
    m.visible = false;
    m.userData.dynamic = true;
    sock.add(m);
    R.model = m; R.socket = sock;
    return m;
  }

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

  // is the off hand free to carry it forward? gunhands.js owns it while a
  // drawn weapon publishes a support grip (anything without authored grips
  // falls back to a support grip there too, so only an explicit no-support
  // weapon, the taser, leaves it free).
  function leftArmFree(ch) {
    if (!ch || !ch.parts || !ch.parts.la || !CBZ.charArmTo) return false;
    if (ch.slidePose || ch.cuffed || ch.surrender || ch.handsUp || ch.verbHold) return false;
    if (CBZ.player && CBZ.player.dead) return false;
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    if (!prop) return true;
    const gr = prop.userData && prop.userData.grips;
    return !!(gr && !gr.support);
  }

  const _fwd = new THREE.Vector3(), _org = new THREE.Vector3(), _v = new THREE.Vector3();
  const _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _hand = new THREE.Vector3();

  function hideAll() {
    if (R.light) R.light.intensity = 0;
    if (R.pivot) R.pivot.visible = false;
    if (R.model) R.model.visible = false;
    R.arm = 0;
  }

  function tick(dt) {
    const m = mode();
    const has = (m === "escape" || m === "city") && owned();
    // LOSING IT PUTS IT OUT: sold, frisked, dropped on death, a new run.
    if (!has && lit) { lit = false; publish(); }
    if (has && !R.built) build();
    if (!R.built) return;
    const P = CBZ.player, cam = CBZ.camera;
    if (P && P.flashlightOn !== lit) P.flashlightOn = lit;
    // a mode that swaps the scene root must not strand the one light
    if (R.light.parent !== CBZ.scene && CBZ.scene) { CBZ.scene.add(R.light); CBZ.scene.add(R.target); CBZ.scene.add(R.pivot); }
    if (!lit || !P || !P.pos || !cam || P.dead) { hideAll(); return; }

    const fp = firstPerson();
    cam.getWorldDirection(_fwd);
    const ch = CBZ.playerChar;

    // ---- the hand (third person) -----------------------------------------
    let fromLens = false;
    const model = fp ? null : ensureModel();
    if (model) {
      model.visible = true;
      if (leftArmFree(ch)) {
        R.arm += (1 - R.arm) * Math.min(1, 10 * (dt || 0.016));
        // body frame: the rig faces its own group yaw, not the camera
        const yaw = ch.group.rotation.y;
        const bx = Math.sin(yaw), bz = Math.cos(yaw);
        _hand.set(P.pos.x + bx * 0.42 + bz * 0.14, P.pos.y + 1.22, P.pos.z + bz * 0.42 - bx * 0.14);
        try {
          if (CBZ.charArmTo.rest) CBZ.charArmTo.rest(ch, "l", 0);
          CBZ.charArmTo(ch, _hand, "l", R.arm);
        } catch (e) {}
        if (ch.setHandPose) ch.setHandPose("l", "grip");
      } else {
        R.arm = 0;
      }
      model.updateWorldMatrix(true, false);
      _org.copy(model.userData.beamOrigin || _v.set(0, 0, 0.25));
      model.localToWorld(_org);
      fromLens = true;
    } else if (R.model) {
      R.model.visible = false;
    }
    if (!fromLens) {
      if (fp) {
        // at the camera, a little right and below: where a held torch sits
        _right.crossVectors(_fwd, _up).normalize();
        _org.copy(cam.position).addScaledVector(_right, 0.16).addScaledVector(_up, -0.2).addScaledVector(_fwd, 0.12);
      } else {
        // no reachable hand (rig without sockets): chest height, just ahead
        _org.set(P.pos.x + _fwd.x * 0.35, P.pos.y + 1.3, P.pos.z + _fwd.z * 0.35);
      }
    }

    // ---- the light --------------------------------------------------------
    const dark = darkness(P.pos.x, P.pos.z);
    R.light.position.copy(_org);
    R.target.position.copy(_org).addScaledVector(_fwd, AIM);
    R.light.intensity = DAY_I + (NIGHT_I - DAY_I) * dark;
    R.light.updateMatrixWorld(); R.target.updateMatrixWorld();
    if (R.model && R.model.userData.lensMat) {
      R.model.userData.lensMat.emissiveIntensity = 1.2 + dark * 0.8;
    }

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

  // 54.7: after camera.js (50), fpsmode (52), holsterprops (54) and gunhands'
  // off-hand pass (54.6), so the arm we raise is not overwritten this frame
  // and the light leaves from where the lens and the camera actually ended up.
  if (CBZ.onAlways) CBZ.onAlways(54.7, tick);

  CBZ.playerFlashlightAudit = function () {
    return {
      owned: owned(),
      on: CBZ.playerFlashlight.on(),
      lightBuilt: !!R.light,
      intensity: R.light ? Math.round(R.light.intensity * 1000) / 1000 : 0,
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
