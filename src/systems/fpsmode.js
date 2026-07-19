/* ============================================================
   systems/fpsmode.js - FIRST-PERSON MODE.

   The armory now unlocks a compact shooter loadout instead of one
   flat debug pistol: a sidearm, pump shotgun, and carbine with distinct
   magazines, reserve ammo, recoil, spread, fire cadence, tracers,
   impact puffs, shell ejection, reload behavior, and viewmodel motion.

   BULLETS MARK THE WORLD BY CALIBER (owner's rule: a gun that exists
   must AFFECT buildings and cars). Every impact is threaded with the
   firing weapon's round weight: 7.62/12g visibly chew concrete (bigger
   bursts, dust, the odd knocked-off chunk, deeper thuds), punch car
   panels (real engine damage + crumple + a panel shudder + paint chips
   in the car's own coat) and blow out glass at ANY range — while a 9mm
   stays light and only breaks panes up close. Persistent pooled pock
   decals (gunfx.js CBZ.bulletHole) keep the evidence on walls AND on
   the cars you sprayed — the aftermath of a firefight is half its drama.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const SENS = (CBZ.TUNE && CBZ.TUNE.sens) || 0.0024;
  const MELEE = 1.9;
  const BODY_R = 0.60;

  // ---- DETERMINISM (owner rule): every roll in this file — shot spread,
  // recoil jitter, casing tumble, the death-drop toss — goes through this
  // seeded LCG instead of Math.random(). Combat outcome (where a bullet
  // actually lands) used to be the one place in fpsmode.js that broke the
  // project's seeded-RNG contract; fixed here for all of it, cosmetic rolls
  // included (a death-drop toss isn't decision-critical, but a stray
  // Math.random() left in a file this central is exactly the kind of thing
  // that quietly reintroduces non-determinism later).
  let _s = 77345;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  const WEAPONS = (CBZ.FPS_WEAPONS && CBZ.FPS_WEAPONS.length) ? CBZ.FPS_WEAPONS : [{
    key: "sidearm", label: "9MM SIDEARM", short: "9MM",
    mag: 15, reserve: 75, reload: 1.15, interval: 0.16, range: 78,
    damage: 38, headMult: 2.65, dropStart: 42, minDamage: 0.58,
    spread: 0.010, bodyRadius: 0.48, headRadius: 0.28,
    recoil: 0.23, maxRecoil: 0.62, climb: 0.026, sideKick: 0.018,
    shake: 0.28, heat: 45, knock: 1.35, flash: 0.38,
    sfx: "shoot_pistol", tracer: 0.018, auto: false,
  }];

  const fps = CBZ.fps = {
    active: false,
    fp: 0.0,
    weapon: 0,
    ammo: WEAPONS[0].mag,
    mag: WEAPONS[0].mag,
    reserve: WEAPONS[0].reserve,
    reloading: 0,
    rounds: WEAPONS.map((w) => w.mag),
    reserves: WEAPONS.map((w) => w.reserve),
    rocketAmmoType: "standard",
  };

  // ---- reusable math temporaries ----
  const eye = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const aimUp = new THREE.Vector3();
  const shotDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmpMuzzle = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();
  const preKickAim = new THREE.Vector3();
  const sightPoint = new THREE.Vector3();
  const reticleOrigin = new THREE.Vector3();
  const reticleDir = new THREE.Vector3();
  const reticlePoint = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const ray = new THREE.Raycaster();
  const wallQ = new THREE.Quaternion();   // rocket impacts: raycast face normal → world

  function weaponIdOf(i) { return WEAPONS[i] && (WEAPONS[i].id || WEAPONS[i].key); }
  // effective magazine size for weapon slot i — a bought Extended/Drum mag
  // (city/gunmods.js) bumps the base capacity. One helper so syncAmmo, reload,
  // finishReloadStep and resetWeapons all agree on the true mag size.
  function magOf(i) {
    const w = WEAPONS[i]; if (!w) return 0;
    return (CBZ.gunModsMag) ? CBZ.gunModsMag(weaponIdOf(i), w.mag) : w.mag;
  }
  function weaponIndex(id) {
    for (let i = 0; i < WEAPONS.length; i++) if (weaponIdOf(i) === id || WEAPONS[i].key === id) return i;
    return -1;
  }
  function hasWeaponIndex(i) {
    const id = weaponIdOf(i);
    if (!id) return false;
    if (CBZ.hasWeapon && CBZ.hasWeapon(id)) return true;
    return !!(CBZ.econ && CBZ.econ.hasItem("Gun") && (!CBZ.weaponInventory || CBZ.weaponInventory.length === 0));
  }
  function availableIndices() {
    const out = [];
    for (let i = 0; i < WEAPONS.length; i++) if (hasWeaponIndex(i)) out.push(i);
    return out;
  }
  function normalizeWeapon() {
    if (CBZ.currentWeaponId) {
      const idx = weaponIndex(CBZ.currentWeaponId);
      if (idx >= 0 && hasWeaponIndex(idx)) fps.weapon = idx;
    }
    if (hasWeaponIndex(fps.weapon)) return;
    const av = availableIndices();
    if (av.length) {
      fps.weapon = av[0];
      CBZ.currentWeaponId = weaponIdOf(fps.weapon);
    }
  }
  function weapon() { normalizeWeapon(); return WEAPONS[fps.weapon] || WEAPONS[0]; }
  const DEFAULT_ROCKET_SPEC = Object.freeze({ id: "guided", label: "GUIDED", homing: true, lockRange: 280, lockConeDeg: 22, turnRate: 2.8, speed: 92 });
  function rocketAmmoSpec(w, id) {
    const modes = w && w.ammoTypes;
    if (!modes || !modes.length) return w && w.explosive ? DEFAULT_ROCKET_SPEC : null;
    id = id || fps.rocketAmmoType;
    for (let i = 0; i < modes.length; i++) if (modes[i].id === id) return modes[i];
    return modes[0];
  }
  function setRocketAmmoType(id) {
    const w = weapon(), spec = rocketAmmoSpec(w, id);
    if (!w.explosive || !spec) return false;
    fps.rocketAmmoType = spec.id;
    if (typeof document !== "undefined" && typeof CustomEvent !== "undefined") {
      document.dispatchEvent(new CustomEvent("cbz-rocket-ammo", { detail: { id: spec.id, label: spec.label || spec.id } }));
    }
    setAmmoHud();
    return true;
  }
  function cycleRocketAmmoType() {
    const w = weapon(), modes = w.ammoTypes;
    if (!w.explosive || !modes || modes.length < 2) return false;
    let idx = 0;
    for (let i = 0; i < modes.length; i++) if (modes[i].id === fps.rocketAmmoType) { idx = i; break; }
    return setRocketAmmoType(modes[(idx + 1) % modes.length].id);
  }
  CBZ.fpsRocketAmmoType = function () { return fps.rocketAmmoType; };
  CBZ.fpsSetRocketAmmoType = setRocketAmmoType;
  CBZ.fpsCycleRocketAmmoType = cycleRocketAmmoType;
  // HOLSTER (city-only de-escalation): when the player holsters, armed() reads
  // FALSE so the EXISTING fists viewmodel shows and every cityHasGun()/witness/
  // wanted/panic system automatically treats the player as unarmed — the
  // de-escalation comes free from this single gate. Default false (undefined =
  // not holstered). Jail/survival are untouched (the holster flag is city-only).
  CBZ.cityHolster = function (on) {
    if (CBZ.game.mode !== "city") return;
    CBZ.game.cityHolstered = (on === undefined) ? !CBZ.game.cityHolstered : !!on;
    setAmmoHud();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };
  function armed() {
    if (CBZ.game.mode === "city" && CBZ.game.cityHolstered) return false;   // holstered = read as unarmed (fists show, de-escalates)
    return availableIndices().length > 0 && !(CBZ.game.mode === "city" && CBZ.game.cityMeleeWeapon);
  }
  function shoulderActive() {
    const p = CBZ.player;
    // The shoulder owner is strictly an alive, on-foot third-person state.
    // Previously it stayed true in cars/aircraft and after death, leaving the
    // crosshair/context-menu capture and aim pose active while another controller
    // owned the player. Downstream one-off guards hid some symptoms, not the state.
    return !fps.active && !!p && !p.dead && !p.driving && armed() && CBZ.game.state === "playing";
  }
  // ---- TP PRESENT SIGNAL (owner: "TP camera moves too much / arms always up") --
  // The twitchy armed camera tier and the raised aim pose used to key off merely
  // OWNING an un-holstered gun (shoulderActive), and the default city loadout
  // hands you one at spawn — so the player lived permanently in the aim stance.
  // "Presenting" is the actual intent signal: scoping (RMB/ADS), holding the
  // trigger, or a short post-shot linger while the recoil settles. Merely-armed
  // now reads as the relaxed carry (camera AND pose).
  if (CBZ.CONFIG.CITY_TP_ADS_CAMERA == null) CBZ.CONFIG.CITY_TP_ADS_CAMERA = true;
  if (CBZ.CONFIG.CITY_TP_LOWREADY == null) CBZ.CONFIG.CITY_TP_LOWREADY = true;
  const PRESENT_LINGER = 0.9;   // s after the last shot before the gun lowers
  function presenting() {
    if (!shoulderActive()) return false;
    return aimHeld || triggerHeld || sinceShot < PRESENT_LINGER;
  }
  // Camera-side hook (systems/camera.js): gates the tight armed tier — yaw
  // snap, tight position/look damps, pitch-follow, close collision floor —
  // on presenting instead of merely-armed. Framing (DIST/SIDE/FOV/HEIGHT) is
  // already flat for merely-armed by design and is not touched by this. With
  // CITY_TP_ADS_CAMERA=false it reverts to the old merely-armed gate exactly.
  CBZ.tpPresenting = function () {
    if (CBZ.CONFIG.CITY_TP_ADS_CAMERA === false) return shoulderActive();
    return presenting();
  };
  function maxHpOf(a) { return (a.kind === "guard" || a.kind === "warden") ? 140 : 100; }

  // ---- CALIBER: how hard each round MARKS the world -----------------------
  // One scalar per weapon threaded into every surface impact: burst size,
  // debris, decal diameter, thud depth, car damage, glass reach. WHY: buying
  // the AK has to SHOW — the street it shot up must read differently from a
  // street a 9mm shot up, or the price tag bought nothing visible.
  const CAL = {
    sniper: 1.9, ak47: 1.6, shotgun: 1.5, lmg: 1.35, deagle: 1.3,
    carbine: 1.2, revolver: 1.15, smg: 0.85, sidearm: 0.8, uzi: 0.7, taser: 0.25,
  };
  function caliber(w) { return CAL[w.key] != null ? CAL[w.key] : (w.damage >= 30 ? 1.2 : 0.8); }
  // rifle-class rounds keep their authority at range (full-distance glass
  // breaks, deep marks); pocket calibers shed energy fast.
  function heavyRound(w) { return caliber(w) >= 1.0; }
  const GLASS_PISTOL_REACH = 28;   // a 9mm/SMG slug only breaks a pane this close

  // per-weapon impact THUD (reused opts object — no per-shot allocation; far
  // must be re-cleared because audio.js sets it on the object for far hits)
  const thudSfxOpts = { pitch: 1, volume: 1, dist: null, far: false };
  function surfaceThud(name, cal, dist) {
    if (!CBZ.sfx) return;
    thudSfxOpts.pitch = Math.max(0.6, 1.18 - cal * 0.3) * (0.95 + rng() * 0.1);  // heavier round = deeper smack
    thudSfxOpts.volume = 0.35 + cal * 0.4;
    thudSfxOpts.dist = dist;
    thudSfxOpts.far = false;
    CBZ.sfx(name, thudSfxOpts);
  }

  function syncAmmo() {
    fps.ammo = fps.rounds[fps.weapon];
    fps.mag = magOf(fps.weapon);
    fps.reserve = fps.reserves[fps.weapon];
  }

  function resetWeapons() {
    if (CBZ.game.mode === "city") CBZ.game.cityHolstered = false;   // a fresh run / respawn is never holstered (PROG also zeroes it)
    fps.weapon = CBZ.currentWeaponId ? Math.max(0, weaponIndex(CBZ.currentWeaponId)) : 0;
    normalizeWeapon();
    fps.rounds = WEAPONS.map((w, i) => magOf(i));
    fps.reserves = WEAPONS.map((w) => w.reserve);
    fps.reloading = 0;
    fps.rocketAmmoType = "standard";
    shotCD = 0;
    dryCD = 0;
    triggerHeld = false;
    recoil = 0; recoilSide = 0; bloom = 0; recoilHold = 0;
    recoilPitch = 0; recoilYaw = 0; shotsInBurst = 0; sinceShot = 99;
    fpsHipFov = 0;
    hitMarkerT = 0;
    if (hitMarker && hitMarker.wrap) hitMarker.wrap.style.display = "none";
    syncAmmo();
    setAmmoHud();
  }

  function forward(out) {
    const y = CBZ.cam.yaw, p = fps.fp, cp = Math.cos(p);
    out.set(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
    return out;
  }

  function buildBasis(dir) {
    right.crossVectors(dir, UP);
    if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
    else right.normalize();
    aimUp.crossVectors(right, dir).normalize();
  }

  function spreadDir(base, cone, out) {
    buildBasis(base);
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * cone;
    out.copy(base)
      .addScaledVector(right, Math.cos(a) * r)
      .addScaledVector(aimUp, Math.sin(a) * r)
      .normalize();
    return out;
  }

  // ---- viewmodel ----
  const vm = new THREE.Group();
  vm.visible = false;
  CBZ.camera.add(vm);

  const gun = new THREE.Group();
  const weaponModels = [];
  const carriedGun = new THREE.Group();
  const carriedModels = [];
  const mat = {
    dark: new THREE.MeshLambertMaterial({ color: 0x161a20 }),
    black: new THREE.MeshLambertMaterial({ color: 0x080a0c }),
    steel: new THREE.MeshLambertMaterial({ color: 0x48515c }),
    worn: new THREE.MeshLambertMaterial({ color: 0x747f8c }),
    tan: new THREE.MeshLambertMaterial({ color: 0x8b6a42 }),
    polymer: new THREE.MeshLambertMaterial({ color: 0x232a24 }),
    brass: new THREE.MeshLambertMaterial({ color: 0xd6a33b, emissive: 0x2b1600, emissiveIntensity: 0.2 }),
    redShell: new THREE.MeshLambertMaterial({ color: 0x9d2523, emissive: 0x210000, emissiveIntensity: 0.12 }),
    skin: new THREE.MeshLambertMaterial({ color: 0xf0c39a }),
  };
  const brass = mat.brass;
  const redShell = mat.redShell;

  function box(parent, sx, sy, sz, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }

  function cyl(parent, r, len, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }

  const appearanceCtx = { THREE, box, cyl, mat };
  function fallbackAppearance() {
    const g = new THREE.Group();
    box(g, 0.14, 0.10, 0.48, mat.steel, 0, 0.03, -0.28);
    box(g, 0.12, 0.22, 0.12, mat.dark, 0, -0.15, -0.04, -0.25);
    g.userData.muzzle = new THREE.Vector3(0, 0.05, -0.58);
    return g;
  }

  function buildWeaponModel(w) {
    const builder = CBZ.weaponAppearance && CBZ.weaponAppearance[w.appearanceFactory || w.key];
    return builder ? builder(appearanceCtx) : fallbackAppearance();
  }

  WEAPONS.forEach((w, i) => {
    const viewModel = buildWeaponModel(w);
    if (!viewModel.userData.muzzle) viewModel.userData.muzzle = new THREE.Vector3(0, 0.05, -0.58);  // every gun MUST have a barrel tip (else tracers fall back to the head)
    viewModel.visible = i === 0;
    viewModel.scale.setScalar(1.28);
    viewModel.traverse((obj) => {
      obj.renderOrder = 1000;
      if (obj.material) {
        // REAL depth WITHIN the gun (USER-FILMED: with depthTest off, the
        // gun's parts drew over each other in arbitrary order — the pistol
        // read as detached, half-transparent pieces up close, while the same
        // model looked perfect in an NPC's hand). The gun still never clips
        // into walls: a sentinel mesh below clears the depth buffer right
        // before the viewmodel draws, so it always paints over the world.
        obj.material.depthTest = true;
        obj.material.depthWrite = true;
        // transparent:true moves the gun into the TRANSPARENT render queue
        // (renderOrder still wins the sort there). The depth-clear sentinel
        // must fire AFTER the world's glass — when it lived in the opaque
        // queue, every transparent pane in the city depth-tested against a
        // wiped buffer and bled through solid buildings (user-filmed).
        obj.material.transparent = true;
      }
    });
    weaponModels.push(viewModel);
    gun.add(viewModel);

    const carried = buildWeaponModel(w);
    if (!carried.userData.muzzle) carried.userData.muzzle = new THREE.Vector3(0, 0.05, -0.58);
    carried.visible = i === 0;
    // TP guns read BIGGER than FP-scale (standard third-person trick — the
    // over-shoulder camera sits metres away; at 1.05 the held gun vanished
    // into the blocky hand and the owner couldn't see it at all).
    carried.scale.setScalar(1.45);
    carriedModels.push(carried);
    carriedGun.add(carried);
  });
  carriedGun.position.set(0.02, 0.02, 0.03);
  // Local orientation so the barrel lies along the socket -Y (down the forearm):
  // rotation.x ≈ -π/2 (no Math.PI on Y). Paired with animChar's -1.571 arm
  // baseline (character.js) this points the muzzle HORIZONTAL-FORWARD at the
  // crosshair instead of double-rotating it skyward.
  carriedGun.rotation.set(-1.571, 0, 0);
  carriedGun.visible = false;
  // world barrel-lock scratch (no per-frame allocation)
  const _blGunPos = new THREE.Vector3(), _blDir = new THREE.Vector3(), _blTarget = new THREE.Vector3();
  const _blZero = new THREE.Vector3(0, 0, 0), _blUp = new THREE.Vector3(0, 1, 0);
  const _blMat = new THREE.Matrix4();
  const _blWorldQ = new THREE.Quaternion(), _blParentQ = new THREE.Quaternion();
  function attachCarriedGun() {
    const ch = CBZ.playerChar;
    const socket = ch && ch.sockets && (ch.sockets.thirdPersonWeapon || ch.sockets.weapon);
    if (socket && carriedGun.parent !== socket) socket.add(carriedGun);
    else if (!socket && ch && ch.body && carriedGun.parent !== ch.body) ch.body.add(carriedGun);
  }
  attachCarriedGun();

  // muzzle flash sprite at the active barrel tip
  const flashTex = (function () {
    const c = document.createElement("canvas"); c.width = c.height = 48;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(24, 24, 1, 24, 24, 23);
    g.addColorStop(0, "rgba(255,255,235,1)");
    g.addColorStop(0.34, "rgba(255,210,90,.9)");
    g.addColorStop(0.68, "rgba(255,110,34,.45)");
    g.addColorStop(1, "rgba(255,60,20,0)");
    x.fillStyle = g; x.fillRect(0, 0, 48, 48);
    return new THREE.CanvasTexture(c);
  })();
  const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  muzzle.visible = false;
  gun.add(muzzle);
  const worldMuzzle = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  worldMuzzle.visible = false;
  CBZ.scene.add(worldMuzzle);

  // unarmed first-person = ONE hand, bottom-right, Minecraft-style: a forearm
  // + knuckled fist that swings forward to punch. (Two hands read as weird;
  // the gun viewmodels already look great so they stay untouched.)
  const fists = new THREE.Group();
  const HAND_REST = { x: 0.26, y: -0.26, z: 0.04, rx: 0.16, ry: -0.34, rz: -0.12 };
  (function buildHand() {
    const sleeve = new THREE.MeshLambertMaterial({ color: 0xff7a1a });
    const knuckMat = new THREE.MeshLambertMaterial({ color: 0xe7b58c });
    const g = new THREE.Group();
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.46), sleeve);
    forearm.position.set(0, 0, 0.16);            // recedes toward the camera
    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.1), mat.skin);
    wrist.position.set(0, 0, -0.07);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.21, 0.21), mat.skin);
    fist.position.set(0, 0.005, -0.22);
    const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), knuckMat);
    knuckles.position.set(0, 0.075, -0.31);      // knuckle ridge so it reads as a fist
    g.add(forearm, wrist, fist, knuckles);
    g.position.set(HAND_REST.x, HAND_REST.y, HAND_REST.z);
    g.rotation.set(HAND_REST.rx, HAND_REST.ry, HAND_REST.rz);
    fists.add(g); fists.userData.hand = g;
  })();

  vm.add(gun, fists);
  fists.traverse((obj) => {
    obj.renderOrder = 1000;
    if (obj.material) {
      obj.material.depthTest = true;     // fists self-occlude like the guns now
      obj.material.depthWrite = true;
      obj.material.transparent = true;   // same late-queue ride as the guns
    }
  });
  // DEPTH-CLEAR SENTINEL: a degenerate, invisible triangle that renders just
  // before the viewmodel (renderOrder 999 < 1000, opaque queue) and wipes the
  // depth buffer — the world is already drawn, so the gun then depth-tests
  // only against ITSELF: correct part-on-part occlusion, zero wall clipping.
  (function () {
    const dcGeo = new THREE.BufferGeometry();
    dcGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    const dcMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true });
    const dc = new THREE.Mesh(dcGeo, dcMat);
    dc.frustumCulled = false;
    dc.renderOrder = 999;
    dc.onBeforeRender = function (renderer) { renderer.clearDepth(); };
    vm.add(dc);
  })();
  vm.position.set(0.36, -0.34, -0.72);

  let recoil = 0, recoilSide = 0, vmPunch = 0, bobPhase = 0, muzzleT = 0, worldMuzzleT = 0, pumpT = 0;
  let punchT = 0;
  // BLOOM: an extra spread term (radians) that GROWS while moving + auto-firing
  // and TIGHTENS back toward the weapon's base cone when you stand still. This
  // is the "fire discipline" reward — tap or hold still for laser shots, run-
  // and-gun and the cone opens up. recoilHold delays recoil recovery slightly
  // for a snappier kick-then-settle (instead of an instant rubber-band).
  let bloom = 0, recoilHold = 0;
  // View-return debt. A shot kicks the actual first/third-person aim, then a
  // damped spring returns most (not all) of that impulse. There is no hidden
  // bullet-only recoil channel: what moves on screen is what moves the shot.
  let recoilPitch = 0, recoilYaw = 0;
  let shotsInBurst = 0;                    // pattern position; reset by a fire gap
  let sinceShot = 99;                      // s since last shot — drives the burst reset
  // deterministic L/R yaw weave (signed fractions of basePitch): straight up for
  // the first few, then a learnable side-to-side sway. Scaled per weapon by
  // w.yawWeave. This is the PATTERN (skill expression), not random bloom.
  const YAW_PATTERN = [0, 0.10, 0.20, 0.15, -0.10, -0.25, -0.15, 0.20, 0.35, 0.30, 0.10, -0.20, -0.30, -0.10, 0.25];
  // ramp curve: first ~3 shots controllable (1.0), then climb to rampMax over
  // shots 3..12, clamped thereafter — sustained auto fire kicks harder.
  function rampCurve(n, rampMax) {
    if (n < 3) return 1.0;
    if (n >= 12) return rampMax;
    return 1.0 + (rampMax - 1.0) * ((n - 3) / 9);
  }
  // ADS multiplier: holding RMB (CBZ.isADS) softens recoil ~0.55x. Applies in
  // ALL modes (strict feel improvement); RMB is already wired (aimHeld).
  function adsRecoilMul() { return aimHeld ? 0.55 : 1; }
  // The M249's authored legs are a real support, not decoration.  Crouch,
  // shoulder the gun, and stop on a solid surface to load the receiver into the
  // bipod: recoil, yaw and cone tighten hard.  Moving/airborne/swimming breaks
  // the support immediately; no hidden toggle or fourth-wall prompt.
  function bipodActive(w) {
    const p = CBZ.player;
    return !!(w && w.key === "lmg" && aimHeld && p && p.crouch && p.grounded !== false &&
      !p._swim && Math.abs(p.speed || 0) < 0.8);
  }
  CBZ.fpsBipodActive = function () { return bipodActive(weapon()); };
  function kickView(pitchKick, yawKick) {
    if (fps.active) fps.fp = Math.max(-1.3, Math.min(1.3, fps.fp + pitchKick));
    else if (CBZ.cam) CBZ.cam.pitch = Math.max(-1.0, Math.min(0.9, CBZ.cam.pitch - pitchKick));
    if (CBZ.cam) CBZ.cam.yaw += yawKick;
    // Return about 72%; the remaining displacement is player-controllable
    // muzzle climb instead of a rubber-band that erases every burst.
    recoilPitch = Math.min(0.10, recoilPitch + pitchKick * 0.72);
    recoilYaw = Math.max(-0.065, Math.min(0.065, recoilYaw + yawKick * 0.72));
  }
  // FPS ADS zoom: fpsmode owns the FPS camera (runs after systems/camera.js), so
  // the slight zoom-on-RMB lives here. We track the HIP fov (whatever camera.js
  // set this frame, captured only while NOT aiming so it never ratchets) and ease
  // toward hip-ADS_FOV_DROP when RMB is held. ~14° tighter = a red-dot punch-in.
  let fpsHipFov = 0;          // last-known hip fov (refreshed every non-ADS frame)
  const ADS_FOV_DROP = 25;   // real ADS punch-in: hip ~75 → ADS ~50
  const PUNCH_DUR = 0.26;
  let shotCD = 0, dryCD = 0, triggerHeld = false, reloadWeapon = 0;
  // reusable per-shot sfx options (no per-shot allocation at auto-fire rates):
  // heavy guns (AK) re-pitch a shared sample DOWN for a deeper bark — same
  // audio file, different character, zero new assets.
  const shotSfxOpts = { pitch: 1, volume: 1 };

  function triggerFistPunch(silent) {
    punchT = PUNCH_DUR;
    vmPunch = 0.5;                    // small viewmodel kick
    // One restrained cloth movement per real swing. Callers that reuse the
    // hand animation for pressing/placing objects can request a silent pose.
    if (!silent && CBZ.sfx) CBZ.sfx("whoosh");
  }
  // disaster grapple-punch (grapple.js) triggers the same hand swing
  CBZ.fpsPunchAnim = triggerFistPunch;

  // single-hand Minecraft-style swing: wind back, snap forward toward the
  // crosshair, then recover.
  function animFists(dt) {
    if (punchT > 0) punchT = Math.max(0, punchT - dt);
    const h = fists.userData.hand, r = HAND_REST;
    let drive = 0, wind = 0;
    if (punchT > 0) {
      const prog = 1 - punchT / PUNCH_DUR;             // 0..1 over the punch
      wind = Math.max(0, 1 - prog / 0.2);              // quick pull-back up front
      drive = Math.sin(Math.min(1, prog / 0.6) * Math.PI); // forward thrust, peaks mid
    }
    h.position.set(
      r.x - drive * 0.16,                              // pull toward centre as it extends
      r.y + wind * 0.05 - drive * 0.04,
      r.z + wind * 0.10 - drive * 0.5                  // wind back, then punch forward
    );
    h.rotation.set(r.rx + wind * 0.25 - drive * 0.7, r.ry * (1 - drive * 0.6), r.rz);
  }
  let aimHeld = false;     // third-person ADS (right mouse): raise the gun to aim
  let switchCD = 0;        // debounce weapon switching so mashing Q can't spam/stall
  let qWasDown = false;    // edge-detect Q in the frame loop (not per keydown event)
  let introWantsFPS = false;

  // ---- tracer pool ----
  const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.9, depthWrite: false });
  const tracers = [];
  let tracerIdx = 0;
  for (let i = 0; i < 22; i++) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    CBZ.scene.add(mesh);
    tracers.push({ mesh, life: 0, max: 0.055 });
  }

  function fireTracer(from, to, radius, life) {
    const d = tmp.copy(to).sub(from);
    const len = d.length();
    if (len < 0.1) return;
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % tracers.length;
    t.mesh.position.copy(from).addScaledVector(d, 0.5);
    t.mesh.scale.set(radius, len, radius);
    t.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = life || 0.055;
    t.max = t.life;
  }

  // ---- REAL ROCKET FLIGHT (b) -------------------------------------------------
  // The RPG used to be "a hitscan-to-impact rocket" (resolve impact instantly,
  // draw a tracer, detonate the same frame) — every other heavy-ordnance game
  // gives a rocket actual hang time you can see and react to. The impact POINT
  // (and the wall it lands on) is still resolved up-front at the moment of
  // firing, exactly like before (so it always lands precisely under the
  // reticle — the existing "no recoil bias, ever" contract is unchanged) and
  // handed to launchRocket() as the flight's fixed endpoint; only WHEN the
  // detonation actually fires moved, from instant to a real flight-time delay.
  // shoot()'s explosive branch builds a `detonate` closure that runs the
  // EXACT same FX call sequence the old instant branch ran and passes it in
  // as onArrive — see (b) there for the full original-vs-new diff explanation.
  const rocketGeo = new THREE.CylinderGeometry(0.065, 0.075, 0.46, 10);
  const rocketMat = new THREE.MeshLambertMaterial({ color: 0x2a2e22 });
  const rockets = [];
  for (let i = 0; i < 3; i++) {
    const body = new THREE.Mesh(rocketGeo, rocketMat);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.16, 10), new THREE.MeshLambertMaterial({ color: 0x485042 }));
    nose.position.y = 0.31; body.add(nose);
    const finMat = new THREE.MeshLambertMaterial({ color: 0x20251f });
    for (let f = 0; f < 4; f++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.15, 0.14), finMat);
      fin.position.y = -0.16; fin.rotation.y = f * Math.PI * 0.5; body.add(fin);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0.85,
    }));
    glow.scale.set(0.34, 0.72, 1);
    glow.position.y = -0.46;  // body points +Y; fire leaves the actual tail
    body.add(glow);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, color: 0xff9b35, transparent: true, depthTest: false,
      blending: THREE.AdditiveBlending, opacity: 1,
    }));
    core.scale.set(0.18, 0.42, 1); core.position.y = -0.34; body.add(core);
    body.visible = false;
    CBZ.scene.add(body);
    rockets.push({
      mesh: body, active: false, t: 0, dur: 0.3,
      ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0,   // origin + impact point (straight-line endpoints)
      sagY: 0,                                     // peak mid-flight gravity sag (world units, visual only)
      detonate: null,                               // bound closure: () => runs the exact old detonation block
      homing: false, seek: null, speed: 0, turnRate: 0, life: 0, maxLife: 0, targetRadius: 2,
      velocity: new THREE.Vector3(), impactPoint: null, onImpact: null,
      smokeT: 0,
    });
  }
  const rocketSmokeTex = (function () {
    const c = document.createElement("canvas"); c.width = c.height = 48;
    const x = c.getContext("2d"), g = x.createRadialGradient(24, 24, 2, 24, 24, 23);
    g.addColorStop(0, "rgba(195,195,185,.75)"); g.addColorStop(.42, "rgba(105,108,105,.48)"); g.addColorStop(1, "rgba(55,58,60,0)");
    x.fillStyle = g; x.fillRect(0, 0, 48, 48); return new THREE.CanvasTexture(c);
  })();
  const rocketSmoke = [];
  let rocketSmokeIdx = 0;
  for (let i = 0; i < 42; i++) {
    const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: rocketSmokeTex, transparent: true, depthWrite: false, opacity: 0 }));
    mesh.visible = false; CBZ.scene.add(mesh); rocketSmoke.push({ mesh, life: 0, max: 0.72 });
  }
  function emitRocketSmoke(pos) {
    const s = rocketSmoke[rocketSmokeIdx]; rocketSmokeIdx = (rocketSmokeIdx + 1) % rocketSmoke.length;
    s.mesh.position.copy(pos); s.mesh.position.y += (rng() - 0.5) * 0.04;
    s.mesh.scale.setScalar(0.16 + rng() * 0.08); s.mesh.material.opacity = 0.62;
    s.mesh.visible = true; s.life = s.max = 0.62 + rng() * 0.18;
  }
  function updateRocketSmoke(dt) {
    for (let i = 0; i < rocketSmoke.length; i++) {
      const s = rocketSmoke[i]; if (s.life <= 0) continue;
      s.life -= dt; s.mesh.position.y += dt * 0.16; s.mesh.scale.multiplyScalar(1 + dt * 1.8);
      s.mesh.material.opacity = Math.max(0, s.life / s.max) * 0.5;
      if (s.life <= 0) s.mesh.visible = false;
    }
  }
  let rocketIdx = 0;
  // launch a projectile from `from`→`to` over `dur` seconds, sagging under
  // `sag` world-units of (visual) gravity at the midpoint, then call `onArrive`.
  function acquireHomingTarget(from, dir, spec) {
    const range = (spec && spec.lockRange) || 240;
    const cone = Math.cos((((spec && spec.lockConeDeg) || 18) * Math.PI) / 180);
    let best = null, bestScore = Infinity;
    if (CBZ.game.mode === "city" && CBZ.cityAircraftAcquireTarget) {
      const a = CBZ.cityAircraftAcquireTarget(from.x, from.y, from.z, dir.x, dir.y, dir.z, range, cone);
      if (a) { best = a; bestScore = (1 - a.dot) * 8 + a.distance / range * 0.08; }
    }
    // Passenger aircraft use the same live records that boarding and flight
    // consume. Include them in lock-on instead of inventing a target proxy.
    if (CBZ.game.mode === "city" && CBZ.cityCivilAircraftAcquireTarget) {
      const a = CBZ.cityCivilAircraftAcquireTarget(from.x, from.y, from.z, dir.x, dir.y, dir.z, range, cone);
      if (a) {
        let covered = false;
        const p = a.seek && a.seek();
        if (p) {
          _rocketWant.set(p.x - from.x, p.y - from.y, p.z - from.z);
          const d = _rocketWant.length();
          if (d > 1e-5) {
            _rocketWant.multiplyScalar(1 / d);
            const cover = wallDistance(from, _rocketWant, d);
            covered = !!(cover && cover.distance < d - 1.2);
          }
        }
        const score = (1 - a.dot) * 8 + a.distance / range * 0.08;
        if (!covered && score < bestScore) { best = a; bestScore = score; }
      }
    }
    const cars = CBZ.game.mode === "city" && CBZ.cityCars;
    if (cars) for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || c.player || !c.pos || !c.group || c.group.visible === false) continue;
      const dims = c.dims || {};
      const cy = (c.pos.y || 0) + (dims.height || 1.8) * 0.5;
      const dx = c.pos.x - from.x, dy = cy - from.y, dz = c.pos.z - from.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 5 || d > range) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (dot < cone) continue;
      // Do not lock a car through a building; acquisition only runs once per
      // trigger pull, so this single raycast per plausible candidate is cheap.
      _rocketWant.set(dx / d, dy / d, dz / d);
      const cover = wallDistance(from, _rocketWant, d);
      if (cover && cover.distance < d - 1.2) continue;
      const score = (1 - dot) * 8 + d / range * 0.08;
      if (score >= bestScore) continue;
      const target = c;
      bestScore = score;
      best = {
        kind: "car", dot, distance: d,
        radius: Math.max(1.4, Math.min(3.0, (dims.length || 4.6) * 0.45)),
        seek: function () {
          if (!target || target.dead || !target.pos || !target.group || target.group.visible === false) return null;
          const td = target.dims || {};
          return { x: target.pos.x, y: (target.pos.y || 0) + (td.height || 1.8) * 0.5, z: target.pos.z };
        },
      };
    }
    return best;
  }

  function launchRocket(from, to, dur, sag, onArrive, opts) {
    opts = opts || {};
    const r = rockets[rocketIdx];
    rocketIdx = (rocketIdx + 1) % rockets.length;
    r.active = true; r.t = 0; r.dur = Math.max(0.02, dur);
    r.ox = from.x; r.oy = from.y; r.oz = from.z;
    r.dx = to.x; r.dy = to.y; r.dz = to.z;
    r.sagY = sag;
    r.detonate = onArrive;
    r.homing = !!(opts.homing && opts.seek);
    r.seek = r.homing ? opts.seek : null;
    r.speed = opts.speed || 0;
    r.turnRate = opts.turnRate || 2.4;
    r.life = 0;
    r.smokeT = 0;
    r.maxLife = opts.maxLife || Math.max(3.2, r.dur + 2.0);
    r.targetRadius = opts.targetRadius || 2;
    r.impactPoint = opts.impactPoint || null;
    r.onImpact = typeof opts.onImpact === "function" ? opts.onImpact : null;
    r.velocity.set(to.x - from.x, to.y - from.y, to.z - from.z);
    if (r.velocity.lengthSq() < 1e-6) r.velocity.set(0, 0, -1);
    r.velocity.normalize().multiplyScalar(r.speed || (from.distanceTo(to) / r.dur));
    r.mesh.position.copy(from);
    r.mesh.visible = true;
    return r;
  }
  // quadratic sag added to a straight-line lerp (peaks at the midpoint, zero
  // at both ends) — reads as gravity without a full ballistic re-solve, and
  // the rocket still ARRIVES exactly at the pre-resolved impact point.
  const _rocketPos = new THREE.Vector3(), _rocketPrev = new THREE.Vector3();
  const _rocketDir = new THREE.Vector3(), _rocketWant = new THREE.Vector3();
  function finishRocket(r, point, wallHit) {
    if (point && r.impactPoint && r.impactPoint.copy) r.impactPoint.copy(point);
    if (r.onImpact) { try { r.onImpact(point || r.mesh.position, wallHit || null); } catch (e) {} }
    r.active = false; r.mesh.visible = false;
    const fn = r.detonate;
    r.detonate = null; r.seek = null; r.onImpact = null; r.impactPoint = null; r.homing = false;
    if (fn) fn();
  }
  function updateRockets(dt) {
    for (let i = 0; i < rockets.length; i++) {
      const r = rockets[i];
      if (!r.active) continue;
      _rocketPrev.copy(r.mesh.position);
      r.smokeT += dt;
      if (r.smokeT >= 0.035) { r.smokeT = 0; emitRocketSmoke(_rocketPrev); }
      if (r.homing) {
        r.t += dt; r.life += dt;
        const target = r.seek ? r.seek() : null;
        if (target) {
          _rocketDir.copy(r.velocity).normalize();
          _rocketWant.set(target.x - r.mesh.position.x, target.y - r.mesh.position.y, target.z - r.mesh.position.z);
          if (_rocketWant.lengthSq() > 1e-6) {
            _rocketWant.normalize();
            const dot = Math.max(-1, Math.min(1, _rocketDir.dot(_rocketWant)));
            const angle = Math.acos(dot), maxTurn = r.turnRate * dt;
            if (angle <= maxTurn || angle < 1e-4) _rocketDir.copy(_rocketWant);
            else _rocketDir.lerp(_rocketWant, maxTurn / angle).normalize();
            r.velocity.copy(_rocketDir).multiplyScalar(r.speed);
          }
        }
        r.mesh.position.addScaledVector(r.velocity, dt);
        _rocketPos.copy(r.mesh.position);
        _rocketDir.copy(_rocketPos).sub(_rocketPrev);
        const stepLen = _rocketDir.length();
        let wallHit = null, impact = null;
        if (stepLen > 1e-5) {
          _rocketDir.multiplyScalar(1 / stepLen);
          wallHit = wallDistance(_rocketPrev, _rocketDir, stepLen + 0.12);
          if (wallHit && wallHit.distance <= stepLen + 0.1) impact = wallHit.point;
        }
        const gy = CBZ.floorAt ? (+CBZ.floorAt(_rocketPos.x, _rocketPos.z) || 0) : 0;
        if (!impact && _rocketPos.y <= gy + 0.1) {
          _rocketPos.y = gy + 0.1; impact = _rocketPos; wallHit = null;
        }
        if (!impact && target) {
          const dx = target.x - _rocketPos.x, dy = target.y - _rocketPos.y, dz = target.z - _rocketPos.z;
          if (dx * dx + dy * dy + dz * dz <= Math.pow(r.targetRadius + Math.min(2, stepLen), 2)) impact = _rocketPos;
        }
        if (!impact && r.life >= r.maxLife) impact = _rocketPos;
        if (stepLen > 1e-6) r.mesh.quaternion.setFromUnitVectors(UP, _rocketDir);
        if (impact) finishRocket(r, impact, wallHit);
        continue;
      }
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const sag = r.sagY * 4 * k * (1 - k);
      _rocketPos.set(
        r.ox + (r.dx - r.ox) * k,
        r.oy + (r.dy - r.oy) * k - sag,
        r.oz + (r.dz - r.oz) * k
      );
      r.mesh.position.copy(_rocketPos);
      // orient along the instantaneous travel direction so the body+exhaust
      // glow visibly pitches through the arc instead of staying level.
      tmp.copy(_rocketPos).sub(_rocketPrev);
      if (tmp.lengthSq() > 1e-6) r.mesh.quaternion.setFromUnitVectors(UP, tmp.normalize());
      if (k >= 1) {
        finishRocket(r, _rocketPos, null);
      }
    }
  }

  // ---- tiny deferred-call queue (sniper travel-time feedback) ---------------
  // GENERIC, NOT just for the sniper: a short list of {t, fn} pairs ticked
  // every frame in the same onAlways(52,...) loop as everything else here.
  // Used ONLY for the sniper's "travel time" (b): damage/game-state still
  // resolves THIS frame (hit-scan, deterministic, doesn't risk the per-pellet
  // branch logic below — see resolveShotSniper's header comment), but the
  // PLAYER-FACING feedback (tracer draw, hit-thwack sfx/marker) is held back
  // by the round's real flight time so a 200m headshot doesn't feel instant.
  const deferred = [];
  function deferCall(delay, fn) { if (delay > 0.001) deferred.push({ t: delay, fn }); else fn(); }
  function updateDeferred(dt) {
    for (let i = deferred.length - 1; i >= 0; i--) {
      deferred[i].t -= dt;
      if (deferred[i].t <= 0) { const fn = deferred[i].fn; deferred.splice(i, 1); fn(); }
    }
  }

  // ---- impact puff pool ----
  function radialTexture(stops) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 30);
    stops.forEach((s) => g.addColorStop(s[0], s[1]));
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const sparkTex = radialTexture([
    [0, "rgba(255,255,235,1)"], [0.35, "rgba(255,178,74,.88)"], [1, "rgba(90,90,90,0)"],
  ]);
  const dustTex = radialTexture([
    [0, "rgba(215,40,34,.95)"], [0.45, "rgba(125,10,10,.75)"], [1, "rgba(80,0,0,0)"],
  ]);
  const impacts = [];
  let impactIdx = 0;
  for (let i = 0; i < 18; i++) {
    const mesh = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sparkTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    mesh.visible = false;
    CBZ.scene.add(mesh);
    impacts.push({ mesh, life: 0, max: 0.14 });
  }

  function spawnImpact(pos, blood, big, power) {
    const p = impacts[impactIdx];
    impactIdx = (impactIdx + 1) % impacts.length;
    p.mesh.material.map = blood ? dustTex : sparkTex;
    p.mesh.material.blending = blood ? THREE.NormalBlending : THREE.AdditiveBlending;
    p.mesh.position.copy(pos);
    const k = Math.max(0.55, Math.min(1.7, power == null ? 1 : power));
    p.mesh.scale.setScalar((big ? 0.92 : 0.5) * k);
    p.mesh.material.opacity = 1;
    p.mesh.visible = true;
    p.life = blood ? 0.18 : 0.12;
    p.max = p.life;
  }

  // ---- casing pool ----
  const casingGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.085, 8);
  const casings = [];
  let casingIdx = 0;
  for (let i = 0; i < 28; i++) {
    const mesh = new THREE.Mesh(casingGeo, brass);
    mesh.visible = false;
    CBZ.scene.add(mesh);
    casings.push({ mesh, vel: new THREE.Vector3(), life: 0 });
  }

  function ejectCasing(w) {
    aimForward(fwd); buildBasis(fwd);
    const c = casings[casingIdx];
    casingIdx = (casingIdx + 1) % casings.length;
    c.mesh.material = w.key === "shotgun" ? redShell : brass;
    c.mesh.scale.setScalar(w.key === "shotgun" ? 1.45 : 1);
    c.mesh.position.copy(muzzleWorld(tmp2))
      .addScaledVector(right, 0.18)
      .addScaledVector(aimUp, -0.16)
      .addScaledVector(fwd, -0.08);
    c.vel.copy(right).multiplyScalar(2.4 + rng() * 1.2)
      .addScaledVector(aimUp, 1.0 + rng() * 0.9)
      .addScaledVector(fwd, -0.25 + rng() * 0.25);
    c.mesh.rotation.set(rng() * 4, rng() * 4, rng() * 4);
    c.mesh.visible = true;
    c.life = 1.5;
    if (CBZ.sfx && w.key !== "carbine") setTimeout(() => CBZ.sfx("shell"), 90 + rng() * 80);
  }

  // ---- DEATH DROP: the gun leaves your hands when you die -------------------
  // WHY: dying with the viewmodel welded to the lens (and the carried gun still
  // posed in the corpse's grip) reads fake — a body lets go. On death the
  // first-person gun pitches forward, drops and yaws out of frame (~0.5s,
  // TRANSFORM-ONLY on the `gun` group: the depth-clear sentinel + transparent
  // material setup are untouched), and a cosmetic world mesh of the same
  // weapon tumbles from the body and lies beside it. Purely visual: inventory
  // and ammo survive the respawn and NPCs can't loot it (it's not a cityDrop).
  let ddT = -1;                        // >=0 while the viewmodel tumble plays
  const DD_DUR = 0.5;
  let dropMesh = null, dropVx = 0, dropVy = 0, dropVz = 0,
    dropSx = 0, dropSy = 0, dropSz = 0, dropLife = 0, dropLanded = false;
  function clearWorldDrop() {
    if (!dropMesh) return;
    if (dropMesh.parent) dropMesh.parent.remove(dropMesh);
    dropMesh.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });   // materials are the shared kit — never disposed
    dropMesh = null;
  }
  function spawnWorldDrop(w) {
    clearWorldDrop();
    if (!CBZ.scene || !CBZ.player || !CBZ.player.pos) return;
    const p = CBZ.player.pos;
    dropMesh = buildWeaponModel(w);
    dropMesh.scale.setScalar(1.05);
    const a = rng() * 6.28;
    dropMesh.position.set(p.x + Math.cos(a) * 0.3, p.y + 1.35, p.z + Math.sin(a) * 0.3);   // out of the dying grip, hand-high
    dropMesh.rotation.set(rng() * 6.28, rng() * 6.28, 0);
    CBZ.scene.add(dropMesh);
    dropVx = Math.cos(a) * (1.2 + rng() * 1.2);
    dropVz = Math.sin(a) * (1.2 + rng() * 1.2);
    dropVy = 2.0 + rng() * 1.2;
    dropSx = (rng() - 0.5) * 14; dropSy = (rng() - 0.5) * 10; dropSz = (rng() - 0.5) * 14;
    dropLife = 30; dropLanded = false;
  }
  // called by city/death.js the frame you die; returns true when the
  // first-person tumble plays (death.js holds the orbit cam a beat for it)
  CBZ.fpsDeathDrop = function () {
    if (!armed()) return false;
    spawnWorldDrop(weapon());          // the body lets go — the gun lands beside it
    carriedGun.visible = false;        // third person: nothing left in the grip
    if (!fps.active) return false;
    ddT = 0;                           // first person: the viewmodel tumbles away
    return true;
  };
  // respawn / mode reset: cancel the tumble, restore the gun group, clear the prop
  CBZ.fpsDeathDropReset = function () {
    if (ddT >= 0) { ddT = -1; gun.position.set(0, 0, 0); gun.rotation.set(0, 0, 0); vm.visible = fps.active; }
    clearWorldDrop();
  };

  // The model socket is the source of truth. Previous camera-space component
  // clamps could silently relocate a perfectly valid socket, so the flash stayed
  // on the barrel while the bullet began beside it. Keep only a catastrophic-rig
  // fallback; every healthy shot leaves the exact rendered front tip.
  const _muzM = new THREE.Matrix4();
  function clampMuzzleBelowEye(out) {
    const cam = CBZ.camera; if (!cam) return out;
    if (cam.updateWorldMatrix) cam.updateWorldMatrix(true, false);
    const e = _muzM.extractRotation(cam.matrixWorld).elements;
    const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6], fx = -e[8], fy = -e[9], fz = -e[10];
    const dx = out.x - cam.position.x, dy = out.y - cam.position.y, dz = out.z - cam.position.z;
    const f = dx * fx + dy * fy + dz * fz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (Number.isFinite(d2) && d2 > 0.02 && d2 < 36 && f > 0.08) return out;
    return out.set(cam.position.x, cam.position.y, cam.position.z)
      .addScaledVector({ x: rx, y: ry, z: rz }, 0.18)
      .addScaledVector({ x: ux, y: uy, z: uz }, -0.34)
      .addScaledVector({ x: fx, y: fy, z: fz }, 0.5);
  }

  // THIRD-PERSON (shoulder cam) clamp: the camera-space box above is wrong out
  // here — the lens hangs 5–16m BEHIND the player (camera.js zoom clamp), so
  // "0.45–3.2m in front of the lens, just under its eye-line" is a point in
  // mid-air behind the character that projects EXACTLY onto his head on screen.
  // That's the filmed bug: every clamped round poured from the skull. From the
  // shoulder the truth anchor is the GUN HAND — bound the origin to a sphere of
  // THIS gun's barrel length (+slack) around the carried-gun root. A healthy
  // pose sits exactly at barrel length, so this is a pure safety net (no-op
  // every normal frame) that catches degenerate rigs/unparented guns instead of
  // ever relocating the stream. Rounds pour from the muzzle, tap or mag-dump.
  const _handPos = new THREE.Vector3();
  function clampMuzzleToHand(out, model) {
    carriedGun.getWorldPosition(_handPos);   // r128: refreshes parent matrices itself
    const sc = (model.scale && model.scale.x) || 1;
    const r = model.userData.muzzle.length() * sc * 2.5 + 1.0;
    const d = out.distanceTo(_handPos);
    if (!Number.isFinite(d) || d > r) {
      aimForward(fwd);
      out.copy(_handPos).addScaledVector(fwd, Math.min(2.2, model.userData.muzzle.length() * sc));
    }
    return out;
  }

  function muzzleWorld(out) {
    if (shoulderActive()) {
      const model = carriedModels[fps.weapon];
      if (model && model.userData.muzzle) {
        attachCarriedGun();
        // A shot can happen between render frames. Force every parent transform
        // current before converting the barrel socket, otherwise stale hand/rig
        // matrices make tracers appear to leave the player's chest.
        if (model.updateWorldMatrix) model.updateWorldMatrix(true, false);
        else {
          if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.updateMatrixWorld(true);
          model.updateMatrixWorld(true);
        }
        // hand-anchored clamp (NOT the camera box — see clampMuzzleToHand)
        return clampMuzzleToHand(model.localToWorld(out.copy(model.userData.muzzle)), model);
      }
    }
    if (fps.active) {
      const model = weaponModels[fps.weapon];
      if (model && model.userData.muzzle) {
        // The viewmodel is parented camera -> vm -> gun -> model. Updating only
        // the leaf can leave vm/gun stale on the input event, which visually
        // launches the tracer from the camera/face instead of the barrel.
        if (model.updateWorldMatrix) model.updateWorldMatrix(true, false);
        else {
          if (CBZ.camera) CBZ.camera.updateMatrixWorld(true);
          model.updateMatrixWorld(true);
        }
        return clampMuzzleBelowEye(model.localToWorld(out.copy(model.userData.muzzle)));
      }
    }
    // last-resort fallback: drop it to GUN height/forward (down + out from the
    // eye) so a tracer never visibly streaks out of the player's head. From the
    // shoulder cam the lens is metres BEHIND the player (a tracer from there
    // would streak THROUGH the body), so anchor at the gun-side chest instead.
    aimForward(fwd); buildBasis(fwd);
    if (shoulderActive() && CBZ.player && CBZ.player.pos) {
      const pp = CBZ.player.pos;
      return out.set(pp.x, pp.y + 1.45, pp.z)
        .addScaledVector(right, 0.24)
        .addScaledVector(fwd, 0.5);
    }
    return out.copy(CBZ.camera.position)
      .addScaledVector(right, 0.18)
      .addScaledVector(aimUp, -0.34)
      .addScaledVector(fwd, 0.5);
  }

  function setMuzzleSpriteFromModel(sprite, model) {
    if (!model || !model.userData.muzzle) return false;
    if (model.updateWorldMatrix) model.updateWorldMatrix(true, false);
    else {
      if (CBZ.camera) CBZ.camera.updateMatrixWorld(true);
      model.updateMatrixWorld(true);
    }
    if (gun.updateWorldMatrix) gun.updateWorldMatrix(true, false);
    else gun.updateMatrixWorld(true);
    model.localToWorld(tmpMuzzle.copy(model.userData.muzzle));
    gun.worldToLocal(tmpMuzzle);
    sprite.position.copy(tmpMuzzle);
    return true;
  }

  function aimForward(out) {
    if (shoulderActive()) return CBZ.camera.getWorldDirection(out).normalize();
    return forward(out);
  }

  // Recoil now moves the visible view, so a bullet never receives an invisible
  // second aim offset. The reticle, lens and round always agree.
  function aimWithRecoil(out) {
    return aimForward(out);
  }

  // ---- HUD ----
  const cross = document.getElementById("crosshair");
  const ammoEl = document.getElementById("ammo");
  const stripEl = document.getElementById("weaponStrip");
  // One reticle element serves both camera modes. Keep the cached visibility
  // beside the element so setActive() can invalidate/update it when V toggles
  // between first person and the third-person shoulder owner.
  let _crossShown = null;
  const reticleState = { blocked: false, target: "", x: 50, y: 50, conePx: 16 };
  CBZ.fpsReticleState = function () {
    return { blocked: reticleState.blocked, target: reticleState.target, x: reticleState.x, y: reticleState.y, conePx: reticleState.conePx };
  };

  function reticleHitIdentity(hit) {
    if (!hit) return null;
    return hit.actor || hit.corpse || hit.car || hit.civilAircraft || (hit.aircraft ? "response-aircraft" : null) ||
      (hit.wallHit && hit.wallHit.object) || null;
  }
  function reticleHitKind(hit) {
    if (!hit) return "";
    if (hit.actor) return "person";
    if (hit.corpse) return "body";
    if (hit.car) return "vehicle";
    if (hit.civilAircraft) return "aircraft";
    if (hit.aircraft) return "aircraft";
    if (hit.wall) return "surface";
    return "";
  }
  function reticleDamageable(hit) {
    return !!(hit && (hit.actor || hit.corpse || hit.car || hit.civilAircraft || hit.aircraft));
  }

  // ---- HIT MARKER ----------------------------------------------------------
  // Built entirely in JS (no index.html/CSS edits): four angled ticks that
  // splay out around the crosshair on a connecting shot (GTA/CoD feel). A plain
  // hit is a white flash; a KILL turns the marker red and spins it slightly
  // into an X (the GTA "you got 'em" tell); a headshot adds a sharper snap.
  const hitMarker = (function () {
    const wrap = document.createElement("div");
    wrap.id = "hitMarker";
    wrap.style.cssText =
      "position:absolute;left:50%;top:50%;width:34px;height:34px;" +
      "transform:translate(-50%,-50%);pointer-events:none;display:none;" +
      "opacity:0;z-index:30;will-change:transform,opacity;";
    // four ticks, each a short bar pointing diagonally out from centre
    const ticks = [];
    const angles = [45, 135, 225, 315];
    for (let i = 0; i < 4; i++) {
      const t = document.createElement("div");
      t.style.cssText =
        "position:absolute;left:50%;top:50%;width:2.2px;height:9px;" +
        "background:#fff;border-radius:1px;box-shadow:0 0 3px rgba(0,0,0,.85);" +
        "transform-origin:50% 50%;";
      wrap.appendChild(t);
      ticks.push(t);
    }
    function placeTicks(spread) {
      for (let i = 0; i < 4; i++) {
        const a = angles[i] * Math.PI / 180;
        const dx = Math.cos(a) * spread, dy = Math.sin(a) * spread;
        ticks[i].style.transform =
          "translate(-50%,-50%) translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px) rotate(" + (angles[i]) + "deg)";
      }
    }
    if (cross && cross.parentNode) cross.parentNode.insertBefore(wrap, cross.nextSibling);
    else document.body.appendChild(wrap);
    return { wrap, ticks, placeTicks };
  })();
  let hitMarkerT = 0, hitMarkerDur = 0.001, hitMarkerKill = false;

  function flashHitMarker(kill, head) {
    const col = kill ? "#ff3b30" : (head ? "#fff0b0" : "#ffffff");
    for (let i = 0; i < hitMarker.ticks.length; i++) {
      hitMarker.ticks[i].style.background = col;
      hitMarker.ticks[i].style.height = (kill ? 11 : head ? 10 : 8.5).toFixed(1) + "px";
    }
    hitMarkerKill = !!kill;
    hitMarkerDur = kill ? 0.42 : 0.18;
    hitMarkerT = hitMarkerDur;
    if (cross) {
      hitMarker.wrap.style.left = cross.style.left || "50%";
      hitMarker.wrap.style.top = cross.style.top || "50%";
    }
    hitMarker.wrap.style.display = "block";
    hitMarker.wrap.style.opacity = "1";
  }
  CBZ.fpsHitMarker = flashHitMarker;

  function setAmmoHud() {
    if (!ammoEl) return;
    syncAmmo();
    // city/life mode shows ammo whenever you're holding a gun (third-person too),
    // not only while aiming — you always want to see your rounds.
    if ((fps.active || shoulderActive() || CBZ.game.mode === "city") && armed()) {
      const w = weapon();
      ammoEl.style.display = "block";
      // City play is always instrumentation-only.  This cannot depend on a
      // campaign mission being active: sandbox/side-job weapons were still
      // writing weapon names, RELOADING and RES over the world.
      const campaignMinimal = CBZ.game.mode === "city" ||
        !!(CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission());
      const rocketSpec = w.explosive ? rocketAmmoSpec(w) : null;
      const rocketMode = rocketSpec ? (rocketSpec.label || rocketSpec.id || "").toUpperCase() : "";
      if (campaignMinimal) {
        // Prison shares the engine ammo panel rather than city/hud.js. Keep the
        // same campaign rule here: reload is a glyph and every other character
        // is numeric, with no weapon/reserve labels floating over the world.
        // One compact lock glyph is enough to reveal that homing is armed; no
        // floating tutorial prose is introduced into the minimal campaign HUD.
        ammoEl.textContent = (fps.reloading > 0 ? "↻\n" : "") + (rocketSpec && rocketSpec.homing ? "◎ " : "") + fps.ammo + " / " + fps.mag + " · " + fps.reserve;
      } else {
        const held = rocketMode ? w.short + " · " + rocketMode : w.label;
        const top = fps.reloading > 0 ? "RELOADING " + w.short : held;
        ammoEl.textContent = top + "\n" + fps.ammo + " / " + fps.mag + "   RES " + fps.reserve;
      }
    } else ammoEl.style.display = "none";
    setWeaponStrip();
  }

  function setWeaponStrip() {
    if (!stripEl) return;
    // The city owns one unified boxed inventory/hotbar.  The engine strip was
    // a second row of FIST / 9MM / 556 / RPG words, and inline display writes
    // could resurrect it despite the city stylesheet.
    if (CBZ.game.mode === "city") {
      stripEl.innerHTML = "";
      stripEl.style.display = "none";
      return;
    }
    if (!(fps.active || shoulderActive()) || !armed()) {
      stripEl.style.display = "none";
      return;
    }
    const html = availableIndices().map((idx) => {
      const w = WEAPONS[idx];
      const active = idx === fps.weapon ? " class=\"active\"" : "";
      return `<span${active}>${w.short}</span>`;
    }).join("  /  ");
    stripEl.innerHTML = html;
    stripEl.style.display = html ? "block" : "none";
  }

  // ---- raycast helpers ----
  function wallDistance(origin, dir, maxRange) {
    ray.set(origin, dir);
    ray.far = maxRange;
    const hits = CBZ.losRaycast ? CBZ.losRaycast(ray, CBZ.losBlockers) : ray.intersectObjects(CBZ.losBlockers, false);
    // city: a wall hit landing inside an OPEN (shattered) window pane's rect
    // (CBZ.cityShotHole, buildings.js) is a hole, not a wall — skip it and
    // keep tracing, so firing out of (or into) a broken window carries past
    // the frame instead of stamping a bullet pock on thin air. Intact glass
    // still protects: panes aren't blockers, their SOLID wall is, and the
    // first round breaks the pane (cityShatterRay below) so the next pass.
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (CBZ.game.mode === "city" && CBZ.cityShotHole) {
        const n = h.face && h.face.normal;   // axis-aligned walls: object-space normal == world
        if (CBZ.cityShotHole(h.point.x, h.point.y, h.point.z, n ? n.x : 0, n ? n.z : 0)) continue;
      }
      return h;
    }
    return null;
  }

  // Long-lived wall wounds belong only to static architecture. A raycast can
  // also hit a parked/moving aircraft or other dynamic prop; stamping that
  // world-space point left a dark disc hanging in empty air after the object
  // moved — the filmed RPG "painting thin air" bug.
  function canLeaveBlastScar(hit) {
    let o = hit && hit.object;
    while (o) {
      const u = o.userData || {};
      if (u.aircraftDims || u.hijackable || u.craft || u.milKind || u.dynamic || u.transient) return false;
      o = o.parent;
    }
    return !!hit;
  }

  // ---- ray vs the CAR fleet (cars were invisible to bullets before this) ----
  // WHY: cars are the street furniture of every firefight — they must take the
  // round (panel hole, paint chips, engine damage) AND act as real cover so a
  // ped crouched behind a sedan is actually safe. Cheap sphere broad-phase per
  // car, then a slab test in the car's yaw-local frame; tracks WHICH face the
  // bullet entered so the decal/debris hug the actual panel.
  function findCarHit(origin, dir, maxT) {
    if (CBZ.game.mode !== "city" || !CBZ.cityCars || !CBZ.cityCars.length) return null;
    const cars = CBZ.cityCars;
    let best = null, bestT = maxT, bnx = 0, bny = 0, bnz = 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || !c.group || (c.player && CBZ.player.driving)) continue;
      const dims = c.dims;
      const hy = dims ? dims.height * 0.5 : 0.95;
      const cx = c.pos.x, cy = hy, cz = c.pos.z;
      // broad phase: closest approach of the ray to the car centre
      const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
      const tc = ox * dir.x + oy * dir.y + oz * dir.z;
      const rad = (dims ? dims.length : 4.6) * 0.6 + 0.6;
      if (tc < -rad || tc - rad > bestT) continue;
      const px = ox - dir.x * tc, py = oy - dir.y * tc, pz = oz - dir.z * tc;
      if (px * px + py * py + pz * pz > rad * rad) continue;
      // narrow phase: slab test in the car's local frame (yaw = heading)
      const h = c.heading || 0, ch = Math.cos(h), sh = Math.sin(h);
      const lox = ch * -ox - sh * -oz, loy = -oy, loz = sh * -ox + ch * -oz;  // origin rel. centre, un-yawed
      const ldx = ch * dir.x - sh * dir.z, ldy = dir.y, ldz = sh * dir.x + ch * dir.z;
      const hx = (dims ? dims.width : 2.2) * 0.5 + 0.05;
      const hz = (dims ? dims.length : 4.6) * 0.5 + 0.05;
      let tmin = 0.05, tmax = bestT, axis = -1, sign = 1;
      let miss = false;
      // x slab
      if (Math.abs(ldx) < 1e-8) { if (Math.abs(lox) > hx) continue; }
      else {
        let t0 = (-hx - lox) / ldx, t1 = (hx - lox) / ldx;
        if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
        if (t0 > tmin) { tmin = t0; axis = 0; sign = ldx > 0 ? -1 : 1; }
        if (t1 < tmax) tmax = t1;
        if (tmin > tmax) continue;
      }
      // y slab (box sits feet-to-roof: centre cy, half height hy)
      if (Math.abs(ldy) < 1e-8) { if (Math.abs(loy) > hy) miss = true; }
      else {
        let t0 = (-hy - loy) / ldy, t1 = (hy - loy) / ldy;
        if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
        if (t0 > tmin) { tmin = t0; axis = 1; sign = ldy > 0 ? -1 : 1; }
        if (t1 < tmax) tmax = t1;
        if (tmin > tmax) miss = true;
      }
      if (miss) continue;
      // z slab
      if (Math.abs(ldz) < 1e-8) { if (Math.abs(loz) > hz) continue; }
      else {
        let t0 = (-hz - loz) / ldz, t1 = (hz - loz) / ldz;
        if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
        if (t0 > tmin) { tmin = t0; axis = 2; sign = ldz > 0 ? -1 : 1; }
        if (t1 < tmax) tmax = t1;
        if (tmin > tmax) continue;
      }
      if (axis < 0 || tmin >= bestT) continue;   // started inside / not nearest
      // entry-face normal, yawed back to world
      const lnx = axis === 0 ? sign : 0, lny = axis === 1 ? sign : 0, lnz = axis === 2 ? sign : 0;
      best = c; bestT = tmin;
      bnx = ch * lnx + sh * lnz; bny = lny; bnz = -sh * lnx + ch * lnz;
    }
    return best ? { car: best, dist: bestT, normal: { x: bnx, y: bny, z: bnz } } : null;
  }

  // ---- PANEL SHUDDER: a shot car's hull jolts for a beat -------------------
  // Tiny decaying rotation.x wobble on the deformable body mesh (crumpleCar
  // owns rotation.z/position — rotation.x is exclusively ours, restored to 0
  // when done so the wreck pose is untouched). Bounded to 6 live shudders.
  const shudders = [];
  function carShudder(car, cal) {
    const ud = car.group && car.group.userData;
    if (!ud || !ud.body) return;
    for (let i = 0; i < shudders.length; i++) {
      if (shudders[i].car === car) { shudders[i].t = 0; shudders[i].amp = Math.max(shudders[i].amp, 0.015 + cal * 0.02); return; }
    }
    if (shudders.length >= 6) {
      const old = shudders.shift();
      const oud = old.car.group && old.car.group.userData;
      if (oud && oud.body) oud.body.rotation.x = 0;
    }
    shudders.push({ car, t: 0, dur: 0.18, amp: 0.015 + cal * 0.02 });
  }

  // Hitboxes tuned to the ACTUAL character model (feet at y≈0): the head
  // cube sits ~y2.15, the torso ~y1.4, the legs ~y0.65. The head sphere is
  // checked FIRST and wins outright — if the ray passes through it the shot
  // is a headshot regardless of the body behind it, so aiming at the head
  // connects cleanly instead of the body "stealing" the hit.
  const HEAD_Y = 1.50, TORSO_Y = 1.00, LEG_Y = 0.46;

  // distance at which a ray ENTERS a sphere (or -1 if it misses)
  function sphereEntry(origin, dir, cx, cy, cz, r, maxT) {
    tmp.set(cx, cy, cz).sub(origin);
    const t = tmp.dot(dir);
    if (t > maxT + r) return -1;
    const perpSq = tmp.lengthSq() - t * t;
    if (perpSq > r * r) return -1;
    let entry = t - Math.sqrt(Math.max(0, r * r - perpSq));
    if (entry < 0) entry = Math.max(0.05, t); // muzzle already inside the sphere
    if (entry < 0.05 || entry > maxT) return -1;
    return entry;
  }

  // ---- VEHICLE/AIRCRAFT OCCUPANTS as aim candidates ------------------------
  // OWNER: "if there's a person in a helicopter, autoscoping should scope for
  // the person in that helicopter, just like it works for a person in front of
  // me." The acquire stack (assist spheres, hot crosshair, CBZ.aimedActor
  // consumers) only scanned ON-FOOT lists, so people seated inside vehicles /
  // aircraft were invisible to it even when you could SEE them through the
  // real glass. Two halves, one flag:
  //   • findActorHit: a hidden-body actor seated in a LIVE car (hijackers and
  //     scripted riders use the `a.inCar = <car record>` convention) presents
  //     seated head/torso spheres at the cabin — the PERSON acquires, and car
  //     glass never blocks the snap (car meshes are not LOS blockers).
  //   • aimedActor: the police gunship/jets + civil planes join via their
  //     published ray tests, so aiming at a visible pilot acquires a live
  //     person-grade target.
  // DAMAGE IS UNCHANGED — exactly what a direct manual shot does today:
  // resolveShot already ray-tests the same craft (hull/canopy hit →
  // cityAircraftDamage / cityDamageCivilAircraft) and findCarHit clamps
  // cabin-bound rounds at the panel (the car takes the hit). No new damage
  // systems; the acquire just stops being blind to people inside vehicles.
  if (CBZ.CONFIG.AIM_VEHICLE_OCCUPANTS == null) CBZ.CONFIG.AIM_VEHICLE_OCCUPANTS = true;
  const OCC_HEAD_Y = 1.12, OCC_TORSO_Y = 0.78;   // seated heights above the cabin floor
  const occPoint = new THREE.Vector3();
  // one cached pseudo-record for aircraft crew: enough shape (kind/pos) for
  // generic consumers, deliberately WITHOUT char/vendor/relPlayer fields so
  // aim_dossier's person filter skips it instead of pinning UI to a proxy.
  const occPilot = { kind: "pilot", occupant: true, name: "Pilot", pos: new THREE.Vector3() };

  function findActorHit(origin, dir, maxT, w) {
    // generous-but-fair aim assist (bigger from the third-person shoulder cam)
    const headAssist = shoulderActive() ? 0.22 : (fps.active ? 0.13 : 0);
    const bodyAssist = shoulderActive() ? 0.40 : (fps.active ? 0.16 : 0);
    const hr = (w.headRadius || 0.33) + headAssist;
    const br = (w.bodyRadius || BODY_R) + bodyAssist;
    let bestActor = null, bestDist = maxT, bestHead = false, bestOcc = false;
    const scan = function (list) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || a.dead || a.ko > 0 || a.escaped || !a.group) continue;
        if (a.group.visible === false) {
          // SEATED OCCUPANT (hidden body, live vehicle): only LIVE riders whose
          // record links the actual car object. (AIM_VEHICLE_OCCUPANTS)
          if (CBZ.CONFIG.AIM_VEHICLE_OCCUPANTS === false) continue;
          const car = a.inCar;
          if (!car || typeof car !== "object" || !car.pos || car.dead) continue;
          const cy = car.pos.y || 0;
          // refresh the rider's dead-while-driving pos so anything reading it
          // (overhead tags, map dots) points at the car, not the sidewalk spot
          // where they got in (eject rewrites it from car.pos anyway).
          if (a.pos && a.pos.set) a.pos.set(car.pos.x, cy, car.pos.z);
          const ohd = sphereEntry(origin, dir, car.pos.x, cy + OCC_HEAD_Y, car.pos.z, hr, maxT);
          if (ohd >= 0 && ohd < bestDist) { bestActor = a; bestDist = ohd; bestHead = true; bestOcc = true; continue; }
          const otd = sphereEntry(origin, dir, car.pos.x, cy + OCC_TORSO_Y, car.pos.z, br, maxT);
          if (otd >= 0 && otd < bestDist) { bestActor = a; bestDist = otd; bestHead = false; bestOcc = true; }
          continue;
        }
        const gp = a.group.position, gy = gp.y || 0;
        // HEAD first — small high sphere, takes priority
        const hd = sphereEntry(origin, dir, gp.x, gy + HEAD_Y, gp.z, hr, maxT);
        if (hd >= 0 && hd < bestDist) { bestActor = a; bestDist = hd; bestHead = true; bestOcc = false; continue; }
        // BODY — torso + legs spheres
        const td = sphereEntry(origin, dir, gp.x, gy + TORSO_Y, gp.z, br, maxT);
        const ld = sphereEntry(origin, dir, gp.x, gy + LEG_Y, gp.z, br * 0.82, maxT);
        let bd = Math.min(td < 0 ? Infinity : td, ld < 0 ? Infinity : ld);
        if (bd < bestDist) { bestActor = a; bestDist = bd; bestHead = false; bestOcc = false; }
      }
    };
    if (CBZ.game.mode === "city") { scan(CBZ.cityPeds); scan(CBZ.cityCops); if (CBZ.cityMedics) scan(CBZ.cityMedics); if (CBZ.cityWildlife) scan(CBZ.cityWildlife); }   // same gun, city targets (wildlife are huntable too)
    else { scan(CBZ.guards); scan(CBZ.npcs); }
    // multiplayer: remote player avatars + host-synced puppet NPCs are real targets
    if (CBZ.net && CBZ.net.active && CBZ.net.targetList) scan(CBZ.net.targetList());
    // the ambient instanced crowd is also a valid target (so you can shoot ANYONE,
    // not just the few promoted peds). It competes on distance → real occlusion.
    let crowdIdx = -1;
    if (CBZ.game.mode === "city" && CBZ.cityCrowdRayHit) {
      const ch = CBZ.cityCrowdRayHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, bestDist, hr, br);
      if (ch) { bestActor = null; crowdIdx = ch.i; bestDist = ch.dist; bestHead = ch.head; bestOcc = false; }
    }
    if (!bestActor && crowdIdx < 0) return null;
    return { actor: bestActor, crowd: crowdIdx >= 0 ? crowdIdx : null, occupant: bestOcc, dist: bestDist, head: bestHead, point: origin.clone().addScaledVector(dir, bestDist) };
  }

  // ---- ray vs the DOWNED (CITY-ONLY) -----------------------------------------
  // OWNER: you must be able to keep shooting a corpse — more holes, it reacts.
  // findActorHit deliberately skips dead actors (so a live target isn't blocked
  // by a body in front of it); this is its dead-only twin. A corpse lies PRONE,
  // so the standing head/torso/leg spheres don't fit — instead we test a couple
  // of low, fat spheres around the body's settled root (group.position tracks the
  // ragdoll). Returns the nearest dead actor + whether the hit landed up near the
  // head end (for the decap read). City-only; never runs in jail/survival.
  const CORPSE_R = 0.62;        // prone body is a low fat sausage
  function findCorpseHit(origin, dir, maxT) {
    if (CBZ.game.mode !== "city") return null;
    let best = null, bestDist = maxT, bestHead = false;
    const scan = function (list) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || !a.dead || a.escaped || !a.group || a.group.visible === false) continue;
        const gp = a.group.position, gy = gp.y || 0;
        // a settled body hugs the ground: one sphere at the torso mass (low),
        // one a touch higher toward the head end. Heading is unknown post-topple,
        // so we keep them vertically split — a head shot reads as the upper hit.
        const td = sphereEntry(origin, dir, gp.x, gy + 0.35, gp.z, CORPSE_R, maxT);
        if (td >= 0 && td < bestDist) { best = a; bestDist = td; bestHead = false; }
        const hd = sphereEntry(origin, dir, gp.x, gy + 0.62, gp.z, CORPSE_R * 0.7, maxT);
        if (hd >= 0 && hd < bestDist) { best = a; bestDist = hd; bestHead = true; }
      }
    };
    scan(CBZ.cityPeds); scan(CBZ.cityCops); scan(CBZ.cityMedics);
    if (!best) return null;
    return { corpse: best, dist: bestDist, head: bestHead, point: origin.clone().addScaledVector(dir, bestDist) };
  }

  function resolveShot(w, dir, rayOrigin) {
    eye.copy(rayOrigin || CBZ.camera.position);
    const wall = wallDistance(eye, dir, w.range);
    let maxT = wall ? Math.max(0.1, wall.distance - 0.04) : w.range;
    // CARS are hard cover AND targets: the nearest car along the ray clamps the
    // search so a ped ducked behind a sedan is safe — the panel eats the round.
    const carHit = findCarHit(eye, dir, maxT);
    if (carHit) maxT = Math.max(0.1, carHit.dist - 0.04);
    const hit = findActorHit(eye, dir, maxT, w);
    // the police gunship overhead is a valid target — ray-test it (no damage here;
    // the shoot loop / rocket splash applies it) and take it if it's the nearest.
    const policeAir = (CBZ.game.mode === "city" && CBZ.cityAircraftRayTest) ? CBZ.cityAircraftRayTest(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxT) : null;
    const civilAir = (CBZ.game.mode === "city" && CBZ.cityCivilAircraftRayTest) ? CBZ.cityCivilAircraftRayTest(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxT) : null;
    let air = policeAir;
    let civil = false;
    if (civilAir && (!air || civilAir.dist < air.dist)) { air = civilAir; civil = true; }
    if (hit && (!air || hit.dist <= air.dist)) return hit;
    if (air) return civil
      ? { actor: null, civilAircraft: air.rec, dist: air.dist, point: new THREE.Vector3(air.x, air.y, air.z) }
      : { actor: null, aircraft: true, dist: air.dist, point: new THREE.Vector3(air.x, air.y, air.z) };
    // a DOWNED body in the path (city-only): only when NO live actor was hit, so a
    // corpse never shadows a living target. Competes on distance with car/wall —
    // shoot it for more holes + a jerk; wins only if it's nearer than those.
    const corpse = findCorpseHit(eye, dir, maxT);
    if (corpse && (!carHit || corpse.dist <= carHit.dist)) return corpse;
    if (carHit) return { actor: null, car: carHit.car, normal: carHit.normal, dist: carHit.dist, point: eye.clone().addScaledVector(dir, carHit.dist) };
    return {
      actor: null,
      wall: !!wall,
      wallHit: wall || null,   // raw raycast hit (face/object) — rockets stamp the struck face
      dist: wall ? wall.distance : w.range,
      point: wall ? wall.point.clone() : eye.clone().addScaledVector(dir, w.range),
    };
  }

  // ---- SNIPER BULLET DROP / TRAVEL TIME (b) ----------------------------------
  // Bullets stay hitscan for every weapon (the owner's call — see the file
  // header's rocket section for the one weapon that gets a real projectile).
  // The sniper alone gets a believable LONG-RANGE correction instead of the
  // same flat linear falloff every other gun uses: past w.sniperDrop.start,
  // the shot direction is bent DOWN by a small angle so the round lands lower
  // than dead-center-of-reticle at extreme range (a real slow heavy bullet
  // sags over a long flight), and resolution is delayed by a short, scaled
  // "time of flight" so a 200m shot doesn't register as instant. Two-stage:
  // resolve once with the TRUE aim to learn the real distance, then (only if
  // past `start`) bend by an angle sized to that distance and re-resolve —
  // so the bend amount always matches how far the round actually travels,
  // not a guess. Returns the hit (possibly the original, undropped one) plus
  // the flight delay (seconds, 0 for non-snipers / under `start`).
  function resolveShotSniper(w, dir, rayOrigin) {
    const drop = w.sniperDrop;
    if (!drop) return { hit: resolveShot(w, dir, rayOrigin), delay: 0 };
    const probe = resolveShot(w, dir, rayOrigin);
    const dist = probe.dist != null ? probe.dist : w.range;
    if (dist <= drop.start) return { hit: probe, delay: 0 };
    const over = Math.min(dist - drop.start, (w.range - drop.start) || dist);
    const dropAmt = Math.min(drop.maxDrop || 1.6, over * (drop.perM || 0.01));
    // bend the AIM down by the small angle whose tangent over `dist` yields
    // dropAmt world-units of sag at that range — small-angle, single basis
    // rebuild (buildBasis already ran inside spreadDir's caller; redo it here
    // since `dir` may have been perturbed by spread since). Uses `hitPoint`
    // (an otherwise-unused module scratch Vector3) — NOT tmp2, which IS the
    // live `origin` reference for this shot (muzzleWorld(tmp2) aliases it; a
    // shared scratch write here would silently relocate the muzzle origin).
    buildBasis(dir);
    const ang = Math.atan2(dropAmt, Math.max(1, dist));
    hitPoint.copy(dir).addScaledVector(aimUp, -ang).normalize();   // aimUp is "up" from buildBasis; bend DOWN
    const dropped = resolveShot(w, hitPoint, rayOrigin);
    dir.copy(hitPoint);   // caller's shotDir must reflect the bent path (tracer, glass-shatter ray, etc. all read it after this call)
    const flight = Math.min(0.55, dist * (drop.flightPerM || 0));   // capped — a delay, not a simulated arc
    return { hit: dropped, delay: flight };
  }

  // ---- BULLET PENETRATION + RICOCHET (d) -------------------------------------
  // Every raycast used to stop dead at the first solid hit. Two small, RARE,
  // clearly-telegraphed additions (own request: flavor/danger, not a core
  // mechanic — neither fires often and both are capped to a single extra
  // event per shot, so a firefight doesn't turn into a pinball table):
  //   PENETRATION — a "thin" wall (read the SAME way los.js derives real wall
  //   thickness: BoxGeometry.parameters along the struck face's axis) lets a
  //   sufficiently powerful round carry through to whatever's standing right
  //   behind it, at reduced exit damage. Pellet guns (shotgun) never
  //   penetrate (a shot charge dumps its energy into the first thing it
  //   hits — also keeps a 9-pellet blast from rolling 9 penetration checks).
  //   RICOCHET — a hit on a THICK/hard wall at a shallow GRAZING angle (the
  //   shot direction nearly parallel to the surface, not punching square into
  //   it) has a small chance to kick a deflected tracer off along the
  //   reflection vector, with a much smaller chance of clipping a nearby
  //   actor for token stray damage. Visual-first: the deflected beam is what
  //   sells it ("that round just skipped off the wall"), the stray hit is a
  //   rare bonus, never the point.
  const PEN_THIN_MAX = 0.22;      // at/under this real thickness, a wall is "thin" (PWT≈0.16 partitions qualify; WT=0.4 exterior walls don't)
  const PEN_MIN_CAL = 0.9;        // rounds lighter than this (uzi/sidearm/taser) don't reliably punch even thin cover
  const PEN_DMG_MUL = 0.45;       // reduced exit damage on whatever's struck behind the cover
  const RICOCHET_GRAZE = 0.16;    // |shotDir·wallNormal| below this = a shallow enough graze to maybe deflect
  const RICOCHET_CHANCE = 0.16;   // telegraphed-rare: most grazing hits do NOT ricochet
  const RICOCHET_STRAY_CHANCE = 0.12;  // of the ricochets that DO fire, how often a nearby actor catches token stray damage
  const RICOCHET_STRAY_DMG = 6;        // flavor-tier, never a real threat on its own

  // Real thickness of the struck axis-aligned wall box, along the face's
  // horizontal normal — identical technique to los.js's boxThicknessAlong
  // (separate IIFE closures can't share the helper, so this is the fpsmode
  // copy; both read the same BoxGeometry.parameters convention). Returns
  // Infinity (never "thin") for non-box geometry — can't penetrate what we
  // can't measure.
  function wallThickness(wallHit) {
    const obj = wallHit && wallHit.object, n = wallHit && wallHit.face && wallHit.face.normal;
    const geo = obj && obj.geometry, p = geo && geo.parameters;
    if (!p || p.width == null || p.depth == null) return Infinity;
    const nx = n ? n.x : 0, nz = n ? n.z : 0;
    return Math.abs(nx) >= Math.abs(nz) ? p.width : p.depth;
  }

  // Attempts penetration first; if it doesn't apply, attempts a ricochet.
  // Mutually exclusive per shot (a round either punches through OR skips off,
  // never both) — called once from the hit.wall branch in shoot()'s pellet
  // loop, AFTER the normal wall pock/spark/hole have already been stamped.
  // `wnx,wnz` is the wall-facing normal the caller already computed (a
  // SYNTHETIC reflected-shot-direction approximation used for the spark
  // cone's cosmetics — NOT the wall's true face normal). The grazing-angle
  // test below needs the REAL face normal instead (the synthetic one is, by
  // construction, always anti-parallel-ish to shotDir and would make every
  // shot read as a square hit) — read straight off wallHit.face, the same
  // axis-aligned-object-space-equals-world-space assumption this file
  // already relies on elsewhere (wallDistance/cityShotHole). Fires RARELY
  // (thin-wall gate / grazing-angle-plus-dice-roll gate below), so this
  // deliberately allocates plain Vector3s instead of fighting over the
  // file's hot-path scratch pool — clarity over micro-reuse for a cold path.
  function tryPenetrateOrRicochet(w, hit, shotDir, cal, wnx, wnz) {
    if (w.pellets) return;                       // shotgun: no penetration/ricochet rolls
    const wallHit = hit.wallHit;
    if (!wallHit) return;
    const faceN = wallHit.face && wallHit.face.normal;
    const fnx = faceN ? faceN.x : wnx, fnz = faceN ? faceN.z : wnz;
    const graze = Math.abs(shotDir.x * fnx + shotDir.z * fnz);   // ~0 = parallel to the TRUE wall face, ~1 = square hit
    const thickness = wallThickness(wallHit);

    // PENETRATION — thin cover + a round heavy enough to carry through.
    if (thickness <= PEN_THIN_MAX && cal >= PEN_MIN_CAL && hit.dist < w.range - 0.5) {
      const exitPt = hit.point.clone().addScaledVector(shotDir, thickness + 0.06);
      const remaining = Math.max(0.5, w.range - hit.dist - thickness);
      const beyondActor = findActorHit(exitPt, shotDir, Math.min(remaining, 24), w);
      if (beyondActor && beyondActor.actor) {
        // a SECOND, lighter gunHit on whatever was standing behind the cover —
        // same damage pipeline (falloff, headshot, city/prison routing), just
        // pre-multiplied down for the energy the wall already ate.
        const exitHit = { actor: beyondActor.actor, head: beyondActor.head, dist: hit.dist + thickness + beyondActor.dist, point: beyondActor.point };
        const penW = Object.create(w); penW.damage = w.damage * PEN_DMG_MUL;   // cheap prototype override — never mutates the shared weapon table
        gunHit(exitHit, penW, shotDir);
        spawnImpact(beyondActor.point, true, false, cal * 0.75);
        if (CBZ.gore && CBZ.gore.spray) CBZ.gore.spray(beyondActor.point, 0.4, shotDir);
        fireTracer(exitPt, beyondActor.point, w.tracer * 0.8, 0.05);
      } else {
        // nothing behind it: still show the round carrying through the cover —
        // a short, visibly DIFFERENT exit puff so a penetration clearly reads
        // as "that went through", not a second impossible impact on the wall.
        const farPt = exitPt.clone().addScaledVector(shotDir, Math.min(remaining, 6));
        fireTracer(exitPt, farPt, w.tracer * 0.7, 0.04);
      }
      return;
    }

    // RICOCHET — thick/hard surface, shallow grazing angle, rare + telegraphed.
    if (graze < RICOCHET_GRAZE && rng() < RICOCHET_CHANCE) {
      // reflect shotDir off the TRUE wall normal (horizontal-plane reflection
      // — walls here are near-vertical, same simplification the wall-impact
      // branch above already makes for its spark cone, but using fnx/fnz
      // here — not the synthetic wnx/wnz — so the deflection is a real
      // physical reflection, not just "back roughly the way it came".
      const dot = shotDir.x * fnx + shotDir.z * fnz;
      const rx = shotDir.x - 2 * dot * fnx, rz = shotDir.z - 2 * dot * fnz;
      const rl = Math.hypot(rx, rz) || 1;
      const deflectDir = new THREE.Vector3(rx / rl, shotDir.y * 0.4, rz / rl).normalize();
      const deflectEnd = hit.point.clone().addScaledVector(deflectDir, 7 + rng() * 5);
      fireTracer(hit.point, deflectEnd, w.tracer * 0.6, 0.06);
      if (CBZ.bulletImpact) CBZ.bulletImpact(hit.point, { x: fnx, y: 0.25, z: fnz }, { kind: "spark", power: cal * 1.2 });
      CBZ.sfx && CBZ.sfx("hit", { pitch: 1.3, volume: 0.5 });
      // tiny stray-damage roll: a nearby actor along the deflection MIGHT eat
      // a token hit. Deliberately small range + flat damage — this is flavor,
      // never the headline outcome of firing a gun near a wall.
      if (rng() < RICOCHET_STRAY_CHANCE) {
        const strayHit = findActorHit(hit.point, deflectDir, 9, w);
        if (strayHit && strayHit.actor) {
          const strayW = Object.create(w); strayW.damage = RICOCHET_STRAY_DMG; strayW.headMult = 1;
          gunHit({ actor: strayHit.actor, head: false, dist: strayHit.dist, point: strayHit.point }, strayW, deflectDir);
          spawnImpact(strayHit.point, true, false, 0.65);
        }
      }
    }
  }

  function aimedActor(maxRange) {
    aimForward(fwd);
    const p = CBZ.player;
    if (shoulderActive()) eye.copy(CBZ.camera.position);
    else eye.set(p.pos.x, p.pos.y + (p.crouch ? 1.18 : 1.65), p.pos.z);
    const w = armed() ? weapon() : { range: maxRange, bodyRadius: BODY_R, headRadius: 0.32 };
    const wall = wallDistance(eye, fwd, maxRange);
    const lim = wall ? Math.max(0.1, wall.distance - 0.04) : maxRange;
    const hit = findActorHit(eye, fwd, lim, w);
    // AIRCRAFT CREW (AIM_VEHICLE_OCCUPANTS): the police gunship/jets and civil
    // planes fly with real pilots visible through real canopy glass, but they
    // live outside the on-foot lists, so the acquire was blind to them. Ray-
    // test the SAME published craft volumes resolveShot fires against — the
    // nearest wins against any on-foot hit, walls still occlude (lim), and the
    // canopy glass IS the craft: a snap onto it routes today's manual damage
    // (cityAircraftDamage / cityDamageCivilAircraft), no new damage path.
    if (CBZ.CONFIG.AIM_VEHICLE_OCCUPANTS !== false && CBZ.game.mode === "city") {
      const cap = hit ? hit.dist : lim;
      const pol = CBZ.cityAircraftRayTest ? CBZ.cityAircraftRayTest(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, cap) : null;
      const civ = CBZ.cityCivilAircraftRayTest ? CBZ.cityCivilAircraftRayTest(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, cap) : null;
      let air = pol, civil = false;
      if (civ && (!air || civ.dist < air.dist)) { air = civ; civil = true; }
      if (air && (!hit || air.dist < hit.dist)) {
        occPilot.pos.set(air.x, air.y, air.z);   // live cockpit point for pos consumers
        occPoint.set(air.x, air.y, air.z);
        return civil
          ? { actor: null, occupant: occPilot, civilAircraft: air.rec, dist: air.dist, head: false, point: occPoint }
          : { actor: null, occupant: occPilot, aircraft: true, dist: air.dist, head: false, point: occPoint };
      }
    }
    return hit;
  }

  // ---- damage ----
  // CITY mode reuses this exact hitscan but routes the hit into the city's own
  // death/loot/crime systems (cops, gangs, wanted) instead of the prison AI.
  function cityGunHit(a, hit, w, shotDir) {
    if (shotDir) hit.dir = shotDir; // wildlife + downstream death physics read the same resolved trajectory
    // WILDLIFE: an animal routes into the hunting system (its own damage/skin
    // path — never the human death/wanted/gore chain). See city/wildlife.js.
    if (a.animal && CBZ.cityWildlifeHit) return CBZ.cityWildlifeHit(a, hit, w);
    // multiplayer target (remote player or synced puppet): authority is over the
    // wire — net code routes the damage and plays the local juice.
    if (a.netKind && CBZ.net && CBZ.net.localGunHit) return CBZ.net.localGunHit(a, hit, w);
    // (e) per-weapon-CLASS falloff SHAPE, not one shared linear ramp — the
    // shotgun/sniper/smg/rifle curves live once in weapon-data.js and every
    // shooter (this + the prison gunHit below) calls the same evaluator.
    const fall = CBZ.weaponFalloffMul ? CBZ.weaponFalloffMul(w, hit.dist)
      : (hit.dist <= w.dropStart ? 1 : Math.max(w.minDamage, 1 - ((hit.dist - w.dropStart) / Math.max(1, w.range - w.dropStart)) * (1 - w.minDamage)));
    const dmg = Math.max(1, Math.round(w.damage * (hit.head ? w.headMult : 1) * fall));
    const lethalHead = hit.head && !w.nonlethal;
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    const cal = caliber(w);
    const dir = shotDir ? { x: shotDir.x, y: shotDir.y, z: shotDir.z } : null;
    // One coherent impulse record follows the round into survivors, deaths and
    // cops. Weapon knock, caliber and remaining range energy now affect the
    // reaction; the exact ray direction replaces generic "away from player".
    const force = (3.0 + ((w.knock || 1) * 2.7)) * (0.72 + cal * 0.28) * Math.sqrt(Math.max(0.25, fall));
    const fling = w.key === "shotgun" && hit.dist <= 7 ? 6.5 : Math.max(1.4, force * 0.38);
    const imp = {
      fromX: fx, fromZ: fz, dir: dir, force: force, fling: fling,
      cal: cal, wkey: w.key, dist: hit.dist, point: hit.point,
      headshot: !!hit.head, byPlayer: true,
    };
    if (a.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(a.gang, 0.4);
    let down = false;
    if (a.kind === "cop") {
      CBZ.cityHurtCop && CBZ.cityHurtCop(a, lethalHead ? 9999 : dmg, imp);
      down = !!a.dead;
    } else if (w.nonlethal) {
      CBZ.cityKOPed && CBZ.cityKOPed(a, fx, fz); down = true;       // taser → KO
    } else {
      if (lethalHead) a.hp = 0; else a.hp -= dmg;
      if (a.hp <= 0) { CBZ.cityKillPed && CBZ.cityKillPed(a, imp, hit.head ? "headshot" : "shot"); down = true; }
      else {
        // a suppressed round barely carries — far fewer bystanders snap to it
        const supp = !!(CBZ.gunModsSuppressed && CBZ.gunModsSuppressed(CBZ.currentWeaponId));
        CBZ.cityAlarm && CBZ.cityAlarm(a.pos.x, a.pos.z, supp ? 6 : 16, 1, CBZ.city.playerActor);
        CBZ.body && CBZ.body.hit(a, { fromX: fx, fromZ: fz, dir: dir, force: force * (hit.head ? 1.2 : 1) });
        // getting shot provokes fight-or-flight. ANYONE HOLDING A GUN shoots BACK —
        // a person who's strapped and gets hit draws and returns fire (self-defence),
        // even a normally-meek civilian. Only the UNARMED + non-bold flee.
        const B = (CBZ.CITY && CBZ.CITY.aggro) || {};
        if (!a.rage) {
          if (a.armed || a.aggr >= (B.bold || 0.5)) { a.rage = CBZ.city.playerActor; a.state = "fight"; a.alarmed = Math.max(a.alarmed || 0, 6); }
          else { a.state = "flee"; a.alarmed = Math.max(a.alarmed || 0, 6); }
        }
      }
    }
    // every connecting shot pops the target's head (same juice as the prison) —
    // the death/cop paths route through their own systems, so flash explicitly.
    if (CBZ.body && CBZ.body.flash) CBZ.body.flash(a);
    if (CBZ.doHitstop) CBZ.doHitstop(hit.head ? 0.085 : 0.05);
    if (lethalHead && down && CBZ.doSlowmo) CBZ.doSlowmo(0.18);
    else if (hit.head && CBZ.doSlowmo) CBZ.doSlowmo(0.1);   // reward a non-fatal headshot too
    return { head: hit.head, down, dmg };
  }

  function gunHit(hit, w, shotDir) {
    const a = hit.actor;
    if (CBZ.game.mode === "city") return cityGunHit(a, hit, w, shotDir);
    const guardish = a.kind === "guard" || a.kind === "warden";
    if (a.hp == null) a.hp = maxHpOf(a);
    // (e) same shared per-class falloff evaluator as cityGunHit above.
    const fall = CBZ.weaponFalloffMul ? CBZ.weaponFalloffMul(w, hit.dist)
      : (hit.dist <= w.dropStart ? 1 : Math.max(w.minDamage, 1 - ((hit.dist - w.dropStart) / Math.max(1, w.range - w.dropStart)) * (1 - w.minDamage)));
    const dmg = Math.max(1, Math.round(w.damage * (hit.head ? w.headMult : 1) * fall));
    const lethalHeadshot = hit.head && !w.nonlethal;
    if (lethalHeadshot) a.hp = 0;
    else a.hp -= dmg;

    if (CBZ.knockback) CBZ.knockback(a, CBZ.player.pos.x, CBZ.player.pos.z, w.knock * (hit.head ? 1.25 : 1));
    if (guardish) a.hunt = 3;
    else if (CBZ.provokeGang) CBZ.provokeGang(a, 12);

    if (w.nonlethal) {
      a.hp = Math.max(a.hp, 28);
      a.ko = Math.max(a.ko || 0, guardish ? 4.5 : 5.5);
      a.aiState = a.aiState === "fight" ? "flee" : a.aiState;
      CBZ.game.kos = (CBZ.game.kos || 0) + 1;
      if (CBZ.game.koLog) CBZ.game.koLog[a.data.name] = true;
      if (!guardish && a.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(a, "ko", 7, { source: w.key || "taser" });
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(a, w.key);
      CBZ.doHitstop && CBZ.doHitstop(0.075);
      if (CBZ.econ && CBZ.econ.lootActor) CBZ.econ.lootActor(a, {}); // frisk the stunned target
      return { head: false, down: true, dmg };
    }

    let down = false;
    if ((lethalHeadshot || a.hp <= 0) && !(a.ko > 0) && !a.dead) {
      down = true;
      if (CBZ.aiKill) CBZ.aiKill(a, { group: CBZ.playerChar.group }, { noKnock: true });
      else { a.dead = true; a.ko = 0; a.hp = 0; }
      if (CBZ.game.koLog) CBZ.game.koLog[a.data.name] = true;
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(a, w.key);
      CBZ.doHitstop && CBZ.doHitstop(hit.head ? 0.085 : 0.055);
      if (hit.head && CBZ.doSlowmo) CBZ.doSlowmo(0.18);
    }
    return { head: hit.head, down, dmg: lethalHeadshot ? maxHpOf(a) : dmg };
  }

  // ---- firing and reload control ----
  function finishReloadStep() {
    const w = WEAPONS[reloadWeapon];
    const cap = magOf(reloadWeapon);   // extended/drum mag capacity (gunmods.js)
    if (reloadWeapon !== fps.weapon) { fps.reloading = 0; syncAmmo(); setAmmoHud(); return; }

    if (w.shellReload) {
      if (fps.rounds[reloadWeapon] < cap && fps.reserves[reloadWeapon] > 0) {
        fps.rounds[reloadWeapon]++;
        fps.reserves[reloadWeapon]--;
        CBZ.sfx && CBZ.sfx("shell");
      }
      if (fps.rounds[reloadWeapon] < cap && fps.reserves[reloadWeapon] > 0 && !triggerHeld) {
        fps.reloading = w.reload;
      } else {
        fps.reloading = 0;
        CBZ.sfx && CBZ.sfx("rack");
      }
      syncAmmo();
      setAmmoHud();
      return;
    }

    const need = cap - fps.rounds[reloadWeapon];
    const give = Math.min(need, fps.reserves[reloadWeapon]);
    fps.rounds[reloadWeapon] += give;
    fps.reserves[reloadWeapon] -= give;
    fps.reloading = 0;
    CBZ.sfx && CBZ.sfx("rack");
    syncAmmo();
    setAmmoHud();
  }

  function reload() {
    if (!(fps.active || shoulderActive()) || !armed()) return;
    const w = weapon();
    if (fps.reloading > 0 || fps.rounds[fps.weapon] >= magOf(fps.weapon) || fps.reserves[fps.weapon] <= 0) return;
    reloadWeapon = fps.weapon;
    fps.reloading = w.reload;
    CBZ.sfx && CBZ.sfx("reload");
    setAmmoHud();
  }

  function dryClick() {
    if (dryCD > 0) return;
    dryCD = 0.22;
    CBZ.sfx && CBZ.sfx("empty");
    CBZ.flashHint && CBZ.flashHint(fps.reserve > 0 ? "Empty - press R" : "No reserve ammo", 1.0);
  }

  function shoot() {
    if (!(fps.active || shoulderActive()) || CBZ.game.state !== "playing" || CBZ.player.dead || (CBZ.player.stun || 0) > 0 || CBZ.player.driving || CBZ.player._swim) return;
    if (!armed()) {
      if (CBZ.game.mode === "city") return;   // city/combat.js owns unarmed melee in the city
      const hit = aimedActor(MELEE);
      triggerFistPunch();
      if (CBZ.punch) { const r = CBZ.punch(hit && hit.actor); if (r && r.msg) CBZ.flashHint(r.msg, 2.4); }
      else CBZ.sfx && CBZ.sfx("step");
      return;
    }

    const w = weapon();
    // ---- attached weapon mods (city/gunmods.js): a suppressor kills the flash
    // + muffles the report, a muzzle brake / grip settles the recoil, a grip /
    // laser tightens the cone. All no-ops (mul 1, supp false) when nothing's on
    // the gun or gunmods.js isn't loaded, so every other mode is byte-identical.
    const _mid = weaponIdOf(fps.weapon);
    const modSupp = !!(CBZ.gunModsSuppressed && CBZ.gunModsSuppressed(_mid));
    const modRec = (CBZ.gunModsRecoilMul && CBZ.gunModsRecoilMul(_mid)) || 1;
    const modSpr = (CBZ.gunModsSpreadMul && CBZ.gunModsSpreadMul(_mid)) || 1;
    if (shotCD > 0) return;
    if (fps.reloading > 0) {
      if (w.shellReload && fps.rounds[fps.weapon] > 0) {
        fps.reloading = 0;
        CBZ.sfx && CBZ.sfx("rack");
        setAmmoHud();
      } else return;
    }
    if (fps.rounds[fps.weapon] <= 0) { dryClick(); return; }

    shotCD = w.interval;
    fps.rounds[fps.weapon]--;
    syncAmmo();
    setAmmoHud();

    // Sample intent before the discharge kicks the view. The first round leaves
    // on the aim the player saw; the next round naturally reads the kicked view.
    aimForward(preKickAim);

    const RK = 0.32;  // controlled climb; view kick still sells weapon weight
    // BURST RESET: a fire gap > 0.25s wipes the ramp + pattern position, so the
    // next round is a fresh first-shot (soft, dead-centre). sinceShot was
    // accumulated by the frame loop; reset it now that we've fired.
    if (sinceShot > 0.25) shotsInBurst = 0;
    sinceShot = 0;
    const adsK = adsRecoilMul();
    const supportK = bipodActive(w) ? 0.34 : 1;
    // cosmetic accumulators (viewmodel kick + reticle bloom) — unchanged feel,
    // just softened under ADS so holding RMB visibly settles the gun.
    recoil = Math.min(w.maxRecoil, recoil + w.recoil * RK * adsK * supportK * modRec);
    recoilSide += (rng() * 2 - 1) * w.sideKick * RK * adsK * supportK * modRec;
    recoilHold = 0.06;   // brief hold before recovery kicks in (snappy kick → settle)
    // each shot pumps bloom; auto fire stacks fast, single shots barely at all.
    // capped so even mag-dumps stay usable. moving adds extra below in the loop.
    bloom = Math.min(w.spread * 2.6, bloom + w.spread * (w.auto ? 0.9 : 0.45) * adsK * supportK);
    if (!w.noRecoil) {
      // AIM-OFFSET kick (the part that decides where bullets go) — into the
      // dedicated recoilPitch/recoilYaw channels, NOT the player's stored aim.
      const ramp = rampCurve(shotsInBurst, w.rampMax || 1.6);
      // first shot of a fresh burst is SOFTER (0.6x) + dead-centre — pinpoint tap.
      const firstShot = shotsInBurst === 0 ? 0.6 : 1;
      const basePitch = w.climb * RK;
      const jitter = 0.92 + rng() * 0.16;                       // <=8% noise
      const pitchKick = basePitch * ramp * firstShot * jitter * adsK * supportK * modRec;
      const pat = YAW_PATTERN[shotsInBurst % YAW_PATTERN.length];
      const yawKick = (pat * (w.yawWeave || 0.6) + (rng() * 2 - 1) * 0.15) * basePitch * ramp * adsK * supportK * modRec;
      kickView(pitchKick, yawKick);
      shotsInBurst++;
    }
    pumpT = w.pump ? 1 : pumpT;

    // a suppressor chokes the muzzle flash down to a dim spit and clips the tail
    const flashScale = w.flash * (0.9 + rng() * 0.28) * (modSupp ? 0.2 : 1);
    const flashT = modSupp ? 0.02 : (w.key === "shotgun" ? 0.065 : 0.04);
    if (fps.active) {
      const activeModel = weaponModels[fps.weapon];
      if (!setMuzzleSpriteFromModel(muzzle, activeModel)) muzzle.position.copy(activeModel.userData.muzzle);
      muzzle.scale.setScalar(flashScale);
      muzzle.rotation.z = rng() * Math.PI * 2;
      muzzle.visible = flashScale > 0.02;
      muzzleT = flashT;
    } else {
      worldMuzzle.position.copy(muzzleWorld(tmp2));
      worldMuzzle.scale.setScalar(flashScale * 1.2);
      worldMuzzle.material.opacity = 1;
      worldMuzzle.visible = flashScale > 0.02;
      worldMuzzleT = flashT;
    }

    if (CBZ.sfx) {
      // suppressed: drop the volume + pitch to a muffled "thup" (the audio system
      // reads {pitch,volume}); otherwise the weapon's own sfx tuning stands.
      if (modSupp || w.sfxPitch || w.sfxVol) {
        shotSfxOpts.pitch = (w.sfxPitch || 1) * (modSupp ? 0.78 : 1) * (0.96 + rng() * 0.08);  // jitter so bursts don't sound machine-stamped
        shotSfxOpts.volume = (w.sfxVol || 1) * (modSupp ? 0.34 : 1);
        CBZ.sfx(w.sfx || "shoot", shotSfxOpts);
      } else CBZ.sfx(w.sfx || "shoot");
    }
    CBZ.shake && CBZ.shake(w.shake);
    CBZ.doHitstop && CBZ.doHitstop(w.key === "shotgun" ? 0.028 : 0.014);
    if (CBZ.game.mode !== "city") CBZ.reportCrime && CBZ.reportCrime(w.heat, { type: w.nonlethal ? "taser" : "gunfire", actorRole: CBZ.game.role, weapon: w.key });
    ejectCasing(w);

    const origin = muzzleWorld(tmp2);
    // Two-ray shoulder aim: camera ray establishes intent, then the actual ray
    // starts at the rendered muzzle and converges on that point. Close cover can
    // therefore catch the barrel-side shot (truthful parallax), while open-space
    // rounds still land exactly under the reticle instead of leaving the chest.
    fwd.copy(preKickAim);
    const sight = resolveShot(w, fwd);
    if (sight && sight.point) sightPoint.copy(sight.point);
    else sightPoint.copy(CBZ.camera.position).addScaledVector(fwd, w.range);
    fwd.copy(sightPoint).sub(origin).normalize();
    if (CBZ.net && CBZ.net.active && CBZ.net.onShot) CBZ.net.onShot(origin, fwd, w);

    // EXPLOSIVE (RPG/bazooka) — REAL PROJECTILE FLIGHT (b): the impact POINT is
    // still resolved synchronously at the moment of firing (so it always lands
    // exactly under the reticle — unchanged from before), but the rocket no
    // longer detonates the same frame it's fired. A visible projectile now
    // flies the eye→impact line over a real flight time (launchRocket, with a
    // gravity sag), and `detonate()` below — the EXACT same FX call sequence
    // the old instant branch ran, unchanged line-for-line — fires once it
    // actually arrives. CITY-ONLY (escape/survival never see these systems).
    // The BLAST is the kill, so the normal per-pellet damage loop is skipped.
    if (w.explosive) {
      const MIN_DET = 4;
      const ammoSpec = rocketAmmoSpec(w) || { id: "standard", homing: false };
      // LOCK-ON (systems/lockon.js): a RED on-screen lock overrides pull-time
      // acquisition — undefined means that system is absent/disabled, so the
      // legacy path below runs byte-identically; null means it's on with no
      // lock, which flies dead straight (the owner's "no lock, no homing").
      let guidedTarget = CBZ.lockonFireTarget ? CBZ.lockonFireTarget() : undefined;
      if (guidedTarget === undefined) guidedTarget = ammoSpec.homing ? acquireHomingTarget(origin, fwd, ammoSpec) : null;
      // a rocket REACHES across the whole map — its detonation must not be capped
      // at the gun's per-pellet `range` (200), or a tower you aim at 250u down a
      // boulevard shows the fireball in empty air SHORT of the wall and the facade
      // never reacts (owner-filmed "far/high building unaffected"). FAR ≈ the map
      // diagonal: long enough to reach any facade, the trace is the same cheap
      // losBlockers raycast regardless of distance.
      const FAR = 450;
      const hit = resolveShot(w, fwd, origin);
      // A DEDICATED long-range wall trace so a distant facade beyond w.range is
      // actually struck — resolveShot only looks out to w.range, so a far tower
      // returns wall:false and the rocket used to die at 200u in open air.
      const farWall = wallDistance(eye, fwd, FAR);
      // Detonate at the NEAREST of: what the close ray HIT (actor/car/near wall),
      // the FAR wall down the sightline, where the ray crosses the STREET, or FAR.
      // The ground-crossing is the original "far-away" fix; the far-wall trace is
      // the new one — together a rocket lands ON whatever it's pointed at, near or
      // far, and the big blast radius does the rest.
      let detT = (hit.wall || hit.actor || hit.car || hit.aircraft || hit.civilAircraft) && hit.dist ? Math.max(0.1, hit.dist) : FAR;
      if (farWall && farWall.distance < detT) detT = Math.max(0.1, farWall.distance);
      if (fwd.y < -0.01) { const gt = (0 - eye.y) / fwd.y; if (gt > 0 && gt < detT) detT = gt; }  // ground (street ≈ y0)
      detT = Math.max(MIN_DET, Math.min(detT, FAR));   // never on the shooter, never past the map
      // the wall the rocket actually lands on (close hit OR the far facade) — used
      // below to stamp the struck face's scar at the real impact point.
      let wallStruck = (hit.wall && hit.wallHit && hit.dist <= detT + 0.6) ? hit.wallHit
        : (farWall && Math.abs(farWall.distance - detT) < 0.6) ? farWall : null;
      let wallPoint = (hit.wall && hit.wallHit && hit.dist <= detT + 0.6) ? hit.point
        : (farWall && Math.abs(farWall.distance - detT) < 0.6 && farWall.point) ? farWall.point.clone() : null;
      const pt = eye.clone().addScaledVector(fwd, detT);
      // pre-resolved shot direction + origin for the detonation closure below.
      // MUST be clones, not the shared `eye`/`fwd` scratch vectors — detonate()
      // can now run many frames after this shot (real flight time), by which
      // point other shots/frames will have overwritten the shared vectors.
      const launchDir = fwd.clone();
      const launchEye = eye.clone();
      const detonate = function () {
        if (CBZ.game.mode === "city") {
          const groundHit = pt.y < 3.5;   // the blast actually couples to the street
          // the fireball/smoke/damage bloom AT the impact height — a tower hit
          // 30u up no longer pops at the kerb below it (crashfx reads opts.y). This
          // single call is ALSO what carves the facade: cityExplosion is wrapped to
          // run the fracture chain (cityFracture.blastAt at opts.y, power-scaled), so
          // the hole/scar appears at ANY impact height. The RPG branch must NOT carve
          // the same wall a second time — it only adds flavor (scar/debris/breach).
          if (CBZ.cityExplosion) CBZ.cityExplosion(pt.x, pt.z, { power: w.blastPower || 1.4, radius: w.blastRadius || 7, byPlayer: true, y: pt.y });
          // a guest's blast never reaches the host's sim otherwise — the host
          // can't count structural HP for a detonation it never saw (mirrors
          // localGunHit's "hit" forwarding in net.js). FX stays local (above);
          // this only feeds the host's demolition ledger.
          if (CBZ.net && CBZ.net.active && !CBZ.net.isHost()) {
            CBZ.net.sendEv({ e: "blast", to: CBZ.net.hostId, x: pt.x, z: pt.z, y: pt.y, power: w.blastPower || 1.4, radius: w.blastRadius || 7 });
          }
          // wreck the storefront HARD — shatter a wide radius of glass (was +2)
          if (CBZ.cityShatter) CBZ.cityShatter(pt.x, pt.z, (w.blastRadius || 7) + 8);
          // AND ray-shatter every pane in the rocket's ACTUAL flight path (eye→impact):
          // the radial burst above only reaches glass near where the blast LANDS, so a
          // rocket that detonates a hair short of (or beside) a tower used to leave the
          // window you aimed at intact. This is the SAME path ray-shatter that makes the
          // rifle reliably break far glass — now on the rocket, so "even RPGs" break it.
          if (CBZ.cityShatterRay) CBZ.cityShatterRay(launchEye.x, launchEye.y, launchEye.z, launchDir.x, launchDir.y, launchDir.z, detT + (w.blastRadius || 7), true);
          if (groundHit && CBZ.cityScorch) CBZ.cityScorch(pt.x, pt.z, (w.blastRadius || 7) * 0.6);   // big scorch on the building/ground
          // a DIRECT hit on a ground-floor wall blasts a real, WALKABLE hole through
          // it (blastRadius 13 → r≈3.6, a satisfying car-sized breach you can run in).
          // GROUND-ONLY BONUS: the facade carve at any height already came from the
          // cityExplosion chain above; this just widens a street-level hit into a
          // walkable breach. cityBreach self-dedups via cityFracture.recent() (which
          // blastAt armed synchronously a tick ago) so it never double-carves.
          if (groundHit && CBZ.cityBreach) CBZ.cityBreach(pt.x, pt.z, (w.blastRadius || 7) * 0.28);
          // detonated ON a building face (near OR far) → the facade REACTS (crashfx):
          // debris avalanche pouring down the facade, a lingering smoke column from
          // the wound, a parapet block near the roofline, concrete dust. NO carve
          // (cityBlastWall is flavor only — the real hole is the cityExplosion chain).
          // DEGATED: now fires for a far facade too, not just a near-wall hit.
          if (wallStruck && canLeaveBlastScar(wallStruck) && CBZ.cityBlastWall) {
            // wall-face normal: the raycast's struck face rotated to world (the
            // exact face-entry normal, same idea as findCarHit's AABB slabs);
            // falls back to the reflected horizontal shot direction.
            const sd = new THREE.Vector3(-launchDir.x, 0, -launchDir.z);
            if (sd.lengthSq() < 1e-6) sd.set(0, 1, 0); else sd.normalize();
            const wf = wallStruck.face, wo = wallStruck.object;
            if (wf && wo && wo.getWorldQuaternion) {
              const wn = wf.normal.clone().applyQuaternion(wo.getWorldQuaternion(wallQ));
              if (wn.lengthSq() > 0.25) {
                if (wn.dot(launchDir) > 0) wn.multiplyScalar(-1);   // always face the shooter
                sd.copy(wn.normalize());
              }
            }
            // MIN_DET can push pt past a point-blank wall — stamp at the wall point
            CBZ.cityBlastWall(wallPoint || pt, sd, { power: w.blastPower || 1.4 });
          }
          // a rocket that lands on/near the gunship nearly halves it (≈2 rockets kill)
          if (CBZ.cityAircraftSplash) CBZ.cityAircraftSplash(pt.x, pt.y, pt.z, (w.blastRadius || 7) + 4, 90);
          // Civil aircraft are the real boardable plane records, not disposable
          // target dummies. A direct RPG wrecks one; a near miss falls off.
          if (CBZ.cityCivilAircraftSplash) CBZ.cityCivilAircraftSplash(pt.x, pt.y, pt.z, (w.blastRadius || 7) + 4, 520, { byPlayer: true });
        }
        // kick scales with how close the blast is to the lens — a rocket at your
        // feet rattles, one parked 100u up a tower rumbles (crashfx attenuates
        // its own explosion shake the same way)
        const camD = CBZ.camera ? CBZ.camera.position.distanceTo(pt) : 0;
        CBZ.shake && CBZ.shake(((w.shake || 1) + 0.6) * Math.max(0.3, Math.min(1, 1.25 - camD / 130)));
        CBZ.doHitstop && CBZ.doHitstop(0.05);
      };
      // FLIGHT TIME + visible arc: projSpeed/projGravity (weapon-data.js) drive
      // a real travel delay instead of detonating the instant the trigger is
      // pulled. Weapons without projSpeed (defensive default) keep the OLD
      // instant-detonate behaviour so this never silently breaks a future
      // explosive that doesn't carry the new fields.
      const projSpeed = (guidedTarget && ammoSpec.speed) || w.projSpeed || 0;
      if (projSpeed > 0) {
        const lockPoint = guidedTarget && guidedTarget.seek ? guidedTarget.seek() : null;
        const flightDist = lockPoint
          ? Math.hypot(lockPoint.x - origin.x, lockPoint.y - origin.y, lockPoint.z - origin.z)
          : origin.distanceTo(pt);
        const flightDur = Math.max(0.04, flightDist / projSpeed);
        // visual sag: how far the arc dips at its midpoint under projGravity
        // over the flight time (s = 1/8 * g * t^2 for a midpoint sag — the
        // peak of a parabola released over the full duration), capped so a
        // very long shot doesn't sag the rocket into the ground mid-flight.
        const sag = guidedTarget ? 0 : Math.min(flightDist * 0.18, 0.125 * (w.projGravity || 0) * flightDur * flightDur);
        const guideOpts = guidedTarget ? {
          homing: true,
          seek: guidedTarget.seek,
          speed: projSpeed,
          turnRate: guidedTarget.turnRate || ammoSpec.turnRate || 2.4,   // lockon.js carries a per-weapon cap
          targetRadius: guidedTarget.radius || 2,
          maxLife: Math.max(3.8, Math.min(8, flightDur + 2.5)),
          impactPoint: pt,
          onImpact: function (actualPoint, actualWall) {
            pt.copy(actualPoint);
            detT = launchEye.distanceTo(pt);
            wallStruck = actualWall || null;
            wallPoint = actualWall && actualWall.point ? actualWall.point.clone() : null;
          },
        } : null;
        launchRocket(origin, pt, flightDur, sag, detonate, guideOpts);
        // a brief launch flare only (the flying mesh IS the tracer now) — no
        // fireTracer() instant line all the way to `pt`, which would visibly
        // spoil the flight by drawing the whole path before the rocket arrives.
      } else {
        fireTracer(origin, pt, w.tracer, 0.07);
        detonate();
      }
      // firing still raises wanted: replicate the witnessed-crime block below so
      // launching a rocket is at least as loud as discharging a firearm. This
      // fires at LAUNCH (the report is "shots fired", not "it landed") so a
      // witness reacts to the whoosh/launch sound immediately, same as before.
      if (CBZ.game.mode === "city" && CBZ.cityCrime) {
        CBZ.cityCrime(120, { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: "shots-fired" });
        CBZ.cityEvent && CBZ.cityEvent("bullet-impact", { weapon: w.key, panic: 4, damage: 0.3 }, { silent: true, noWanted: true });
        CBZ.cityAlarm && CBZ.cityAlarm(CBZ.player.pos.x, CBZ.player.pos.z, 40, 1.6, CBZ.city.playerActor);
      }
      return;
    }

    const pellets = w.pellets || 1;
    // effective cone = base spread, opened by recoil + accumulated bloom, with
    // a hipfire/movement penalty (moving fast while shooting throws shots wide).
    // Standing still + tapping ≈ the gun's tight base cone for precise shots.
    const supported = bipodActive(w);
    const moving = supported ? 0 : (CBZ.player.grounded === false ? 0.6 : Math.min(1, (CBZ.player.speed || 0) / 6));
    // per-weapon movement penalty: heavy rifles (AK moveSpread 2.3) punish
    // run-and-gun harder than the 1.4 default — plant your feet for the payoff.
    const moveBloom = w.spread * moving * (w.moveSpread || 1.4);
    // ADS (RMB held) collapses the whole cone ~0.4x for pinpoint shots — the
    // single biggest accuracy change, à la CoD. Applies in all modes (strict
    // improvement); hip cone unchanged when RMB isn't held.
    const adsSpreadK = aimHeld ? 0.4 : 1;
    // SUPPRESSION (c): a round that just buzzed the player rattles their aim
    // for a few seconds (gunfx.js tracks it off the SAME near-miss test that
    // already drives the "you're being shot at" muzzle-flash/bolt juice — no
    // new detection, just a real cost wired onto an existing read). Feature-
    // detected so this file degrades gracefully if gunfx.js isn't loaded.
    // modSpr = the equipped scope/grip's spread multiplier (gun-mods branch).
    const suppressK = CBZ.suppressionAccuracyMul ? CBZ.suppressionAccuracyMul(CBZ.player) : 1;
    const cone = (w.spread * (1 + recoil * 0.18) + bloom + moveBloom) * adsSpreadK *
      (supported ? 0.32 : 1) * suppressK * modSpr;
    const cal = caliber(w);   // round weight, threaded into every surface impact below
    let head = false, down = false, hitSomething = false;
    let wallThudDist = -1, carThudDist = -1;   // one thud per trigger pull, not per pellet
    let feedbackDelay = 0;   // (b) sniper travel-time: hoisted out of the loop so the post-loop hit-marker/sfx can wait for it too (sniper is always single-pellet, so there's exactly one value to carry)
    for (let i = 0; i < pellets; i++) {
      spreadDir(fwd, cone, shotDir);
      // (b) SNIPER DROP/TRAVEL-TIME: every other weapon resolves exactly as
      // before (resolveShotSniper no-ops to plain resolveShot when the
      // weapon carries no sniperDrop table). For the sniper at long range,
      // shotDir is bent down in-place to the real drop-compensated path
      // BEFORE resolveShot runs, so every system below (glass shatter ray,
      // wall pock, gore, etc.) reads the SAME dropped trajectory — there's
      // only one resolved path per shot, not a cosmetic one and a real one.
      const sniperShot = resolveShotSniper(w, shotDir, origin);
      const hit = sniperShot.hit;
      feedbackDelay = sniperShot.delay;
      const end = hit.point || eye.clone().addScaledVector(shotDir, w.range);
      // Damage/world-state above (gunHit, glass, wall pocks...) still resolve
      // THIS frame — only the player-FACING feedback (tracer beam + the
      // worst-of-the-burst hit marker/hit-sfx further down) waits for the
      // round's real flight time, so a 200m headshot doesn't feel instant
      // without touching the deterministic hit-resolution timing at all.
      if (i < 5 || pellets === 1) {
        if (sniperShot.delay > 0) deferCall(sniperShot.delay, function () { fireTracer(origin, end, w.tracer, w.key === "shotgun" ? 0.045 : 0.055); });
        else fireTracer(origin, end, w.tracer, w.key === "shotgun" ? 0.045 : 0.055);
      }
      // city: a window in this pellet's path shatters (glass never blocks the
      // shot). EVERY round breaks the pane it actually passes through, out to
      // wherever the bullet really travels (reach = the hit distance, already
      // bounded by the wall/actor it strikes and the weapon's range). A 9mm
      // round through a far window breaks it just like a rifle slug does — the
      // old caliber clamp (GLASS_PISTOL_REACH) made only rifles break far glass.
      // FIX 5 — GLASS-BEHIND-WALL POCK SUPPRESSION. cityShatterRay publishes the
      // muzzle-ray distance at which it just broke a pane (CBZ.cityLastShatterDist,
      // -1 if nothing broke). When THIS round broke a pane and the solid wall the
      // raycast returned sits at (or just behind) that pane, the wall hit is really
      // a wall BEHIND a now-open window — stamping a pock there double-marks a fresh
      // break (the filmed bug: a fresh window break also pocks the wall behind it).
      // We compare WORLD impact points because cityShatterRay measures from the
      // muzzle `origin` while resolveShot measures `hit.dist` from the camera `eye`
      // — different frames; the pane's world point is origin+shotDir*lastShatterDist.
      let glassPockSuppress = false;
      if (CBZ.game.mode === "city" && CBZ.cityShatterRay) {
        const reach = hit.dist != null ? hit.dist + 0.5 : w.range;
        CBZ.cityShatterRay(origin.x, origin.y, origin.z, shotDir.x, shotDir.y, shotDir.z, reach, true);
        const sd = CBZ.cityLastShatterDist;
        if (sd != null && sd >= 0 && hit.wall && hit.point) {
          // pane world impact along the muzzle ray
          const gpx = origin.x + shotDir.x * sd, gpy = origin.y + shotDir.y * sd, gpz = origin.z + shotDir.z * sd;
          const ddx = hit.point.x - gpx, ddy = hit.point.y - gpy, ddz = hit.point.z - gpz;
          // wall sits within the pane's offset + a wall depth (≈0.62) past it (or
          // essentially coincident) → it's the wall behind the just-broken glass.
          if (ddx * ddx + ddy * ddy + ddz * ddz < 0.95 * 0.95) glassPockSuppress = true;
        }
      }
      if (hit.actor) {
        hitSomething = true;
        const r = gunHit(hit, w, shotDir);
        head = head || r.head;
        down = down || r.down;
        spawnImpact(hit.point, !w.nonlethal, w.key === "shotgun", cal);
        // One small flesh response per round/pellet. The death path already emits
        // its single full gore event; calling that here as well used to create a
        // pool-sized explosion for every pellet in a shotgun blast.
        if (!w.nonlethal && !hit.actor.animal && CBZ.gore && CBZ.gore.spray) {
          const wet = w.pellets ? 0.34 : (r.head ? 0.95 : 0.58) * Math.max(0.7, cal);
          CBZ.gore.spray(hit.point, wet, shotDir);
        }
        // the body CARRIES the hit: a dark entry wound stamped on the struck
        // part + blood soaking into the clothing (systems/wounds.js). Per
        // pellet — a shotgun blast scatters wounds (wounds.js caps the burst).
        if (CBZ.bodyWound && !w.nonlethal && !hit.actor.animal && (!r.down || hit.actor.kind === "cop")) CBZ.bodyWound(hit.actor, hit.point, { head: hit.head, cal });
      } else if (hit.corpse) {
        // DOWNED BODY (city-only): keep shooting it — it accumulates holes AND
        // jerks. cityCorpseHit (ragdoll.js) wakes the verlet slot on-hit only,
        // banks the impulse so it reacts, and STAMPS the wound itself — so we do
        // NOT call bodyWound here (that would double-stamp). Force scales with
        // caliber on the same scale cityRagdoll uses (~6 pistol .. ~14 shotgun).
        hitSomething = true;
        const force = (w.pellets ? 5.2 : 4.4) * (0.65 + 0.42 * cal) * (w.knock || 1);
        if (CBZ.cityCorpseHit) CBZ.cityCorpseHit(hit.corpse, hit.point, shotDir, force);
        else if (CBZ.bodyWound && !w.nonlethal) CBZ.bodyWound(hit.corpse, hit.point, { head: hit.head, cal });
        spawnImpact(hit.point, !w.nonlethal, w.key === "shotgun", cal);
        if (!w.nonlethal && CBZ.gore && CBZ.gore.spray) CBZ.gore.spray(hit.point, w.pellets ? 0.28 : 0.42 * cal, shotDir);
        // Only a muzzle-close shotgun headshot can sever even post-mortem
        // (gore.js's decap read), guarded so one head only severs once. Live kills
        // route this through cityKillPed's killCtx; a corpse has no kill ctx, so we
        // drive the public sever directly. Non-heavy guns never reach here.
        if (CBZ.game.mode === "city" && hit.head && !w.nonlethal && !hit.corpse._decapped
            && CBZ.goreSever && w.key === "shotgun" && hit.dist <= 5.5) {
          if (CBZ.goreSever(hit.corpse, "head", { dir: shotDir })) hit.corpse._decapped = true;
        }
      } else if (hit.crowd != null) {
        // shot an ambient crowd member (the far NPCs that used to be unkillable)
        hitSomething = true;
        if (!w.nonlethal && CBZ.cityCrowdKill) { CBZ.cityCrowdKill(hit.crowd, { head: hit.head, fromX: origin.x, fromZ: origin.z }); down = true; }
        head = head || hit.head;
        spawnImpact(hit.point, !w.nonlethal, w.key === "shotgun", cal);
        if (!w.nonlethal && CBZ.gore && CBZ.gore.spray) CBZ.gore.spray(hit.point, hit.head ? 0.9 : 0.55, shotDir);
      } else if (hit.aircraft) {
        // bullets chip the gunship — sparks off the hull, damage routed to the heli
        hitSomething = true;
        if (CBZ.cityAircraftDamage) CBZ.cityAircraftDamage(w.damage, origin.x, origin.z);
        spawnImpact(hit.point, false, true);
        if (CBZ.bulletImpact) CBZ.bulletImpact(hit.point, { x: -shotDir.x, y: 0.4, z: -shotDir.z }, { kind: "spark", power: 1.3 });
      } else if (hit.civilAircraft) {
        // The parked gate plane itself takes the round. Damage, boarding and
        // later flight all share this record, so a wreck can never be hijacked.
        hitSomething = true;
        if (CBZ.cityDamageCivilAircraft) CBZ.cityDamageCivilAircraft(hit.civilAircraft, w.damage, hit.point, { byPlayer: true });
        spawnImpact(hit.point, false, true);
        if (CBZ.bulletImpact) CBZ.bulletImpact(hit.point, { x: -shotDir.x, y: 0.35, z: -shotDir.z }, { kind: "spark", power: Math.max(1, cal) });
      } else if (hit.car) {
        // CALIBER vs SHEET METAL: real engine damage (rifle rounds punch panels
        // ~2x harder than a 9mm; heavy rounds also dent), a panel shudder, paint
        // chips in THIS car's coat, and a persistent hole that RIDES the panel.
        const car = hit.car;
        if (CBZ.cityDamageCar) CBZ.cityDamageCar(car, (w.pellets ? 1.7 : 4.2) * cal, { byPlayer: true, crumple: cal >= 1.0, point: hit.point, normal: hit.normal, cal: cal });
        spawnImpact(hit.point, false, cal >= 1.3);
        if (CBZ.bulletImpact) {
          CBZ.bulletImpact(hit.point, hit.normal, { kind: "spark", power: cal });
          if (hit.dist < 45) CBZ.bulletImpact(hit.point, hit.normal, { kind: "chip", power: cal * 0.8, color: car.color });
        }
        if (CBZ.bulletHole && car.group) CBZ.bulletHole(hit.point, hit.normal, { size: 0.12 + cal * 0.1, parent: car.group, dist: hit.dist });
        carShudder(car, cal);
        if (carThudDist < 0) carThudDist = hit.dist;
      } else if (hit.wall && glassPockSuppress) {
        // FIX 5: the "wall" the ray returned is the solid wall BEHIND a pane this
        // round just shattered — the bullet really flew through the fresh hole, so
        // we stamp NO mark on the wall behind the glass (no pock, no spark/dust, no
        // thud). The glass break + its shards/SFX already came from cityShatterRay
        // above. Once the pane is open, follow-up rounds get hit.wall === false
        // (cityShotHole skips the open frame) and fly past normally.
      } else if (hit.wall) {
        // B5: a confirmed losBlockers hit whose struck object carries
        // userData.pieceId (systems/pieces.js stamps this on every piece
        // mesh it builds) is a player-built piece taking a bullet — chip it
        // for the weapon's base damage (structdamage.js applies the wood-
        // tier bullet mult, ~0.35, so ~30 rifle rounds fell a 250hp wall).
        // Only wall/doorframe-shaped pieces register as losBlockers today
        // (systems/building.js's blockLOS flags), so this is the whole
        // hit-testable set this wave; other bullet paths (car/actor/corpse/
        // crowd/aircraft above) have no piece concept to hook.
        const wallObj = hit.wallHit && hit.wallHit.object;
        const pieceId = wallObj && wallObj.userData && wallObj.userData.pieceId;
        if (pieceId != null && CBZ.structDamage) CBZ.structDamage.hit(pieceId, w.damage, "bullet");
        spawnImpact(hit.point, false, cal >= 1.3);
        // surface normal of the struck wall (faces back toward the shooter):
        // walls in this game are near-vertical, so reflect the shot dir onto the
        // horizontal plane for a believable ricochet cone + a persistent hole.
        const nx = -shotDir.x, nz = -shotDir.z;
        const nl = Math.hypot(nx, nz) || 1;
        const wnx = nx / nl, wnz = nz / nl;
        if (CBZ.bulletImpact) {
          CBZ.bulletImpact(hit.point, { x: wnx, y: 0.18, z: wnz }, { kind: "spark", power: cal });
          // heavy rounds CHEW concrete: a second dust kick + the odd chunk
          // knocked clean off the face (LOD: only worth drawing inside ~45u)
          if (cal >= 1.2 && hit.dist < 45) {
            CBZ.bulletImpact(hit.point, { x: wnx, y: 0.3, z: wnz }, { kind: "dust", power: cal - 0.3 });
            if (CBZ.cityChunk && rng() < (cal - 1.1) * 0.45) CBZ.cityChunk(hit.point.x, hit.point.y, hit.point.z, { count: 1, force: 1.6 });
          }
        }
        // persistent pock — the wall you magdumped STAYS pocked, 7.62 > 9mm
        if (CBZ.bulletHole) CBZ.bulletHole(hit.point, { x: wnx, y: 0, z: wnz }, { size: 0.15 + cal * 0.13, dist: hit.dist });
        else if (CBZ.cityBulletHole) CBZ.cityBulletHole(hit.point.x, hit.point.y, hit.point.z, wnx, 0, wnz);
        // rifle-class rounds CHEW: sustained heavy fire on one wall cell quietly
        // grinds open a murder hole (city/fracture.js counts per 1.2u cell)
        if (CBZ.game.mode === "city" && cal >= 1.2 && !w.pellets && CBZ.cityFracture && CBZ.cityFracture.chewWall)
          CBZ.cityFracture.chewWall(hit.point.x, hit.point.y, hit.point.z);
        if (wallThudDist < 0) wallThudDist = hit.dist;
        // (d) PENETRATION / RICOCHET — purely additive flavor on top of the
        // normal wall mark above; rare + telegraphed (see the function header).
        tryPenetrateOrRicochet(w, hit, shotDir, cal, wnx, wnz);
      }
    }
    // impact THUD by caliber — a 7.62 lands a deeper, louder smack on whatever
    // it chewed (concrete thud / car-panel clank). Once per trigger pull, and
    // never over the flesh-hit foley below.
    if (carThudDist >= 0) surfaceThud("clank", cal, carThudDist);
    else if (wallThudDist >= 0 && !hitSomething) surfaceThud("hit", cal, wallThudDist);
    // HIT MARKER: one flash per trigger pull that connected. Kills paint it red.
    // (b) sniper travel-time: the marker/sfx wait for feedbackDelay too (same
    // "round's still in the air" feel as the deferred tracer above) — game
    // STATE (damage, kills, crime) already happened this frame; only the
    // confirmation the PLAYER sees/hears is held back to match the flight.
    if (feedbackDelay > 0) {
      if (hitSomething) deferCall(feedbackDelay, function () { flashHitMarker(down, head); });
      if (head) deferCall(feedbackDelay, function () { CBZ.sfx && CBZ.sfx("headshot"); });
      else if (hitSomething) deferCall(feedbackDelay, function () { CBZ.sfx && CBZ.sfx("hit"); });
    } else {
      if (hitSomething) flashHitMarker(down, head);
      // (no "HEADSHOT"/"TARGET DOWN" text — the red hit marker, gore and foley own the kill)
      if (head) { CBZ.sfx && CBZ.sfx("headshot"); }
      else if (hitSomething) { CBZ.sfx && CBZ.sfx("hit"); }
    }
    // discharging a firearm in the city is a witnessed crime (city wanted system)
    if (CBZ.game.mode === "city" && CBZ.cityCrime) {
      CBZ.cityCrime(w.nonlethal ? 20 : (hitSomething ? 100 : 55), { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: "shots-fired" });
      CBZ.cityEvent && CBZ.cityEvent("bullet-impact", { weapon: w.key, panic: w.nonlethal ? 1 : 3, damage: hitSomething ? 0 : 0.3 }, { silent: true, noWanted: true });
      CBZ.cityAlarm && CBZ.cityAlarm(CBZ.player.pos.x, CBZ.player.pos.z, 24, 1.2, CBZ.city.playerActor);
    }
  }

  function fireControl(down) {
    if (typeof down === "boolean") {
      triggerHeld = down;
      if (down) shoot();
      return;
    }
    shoot();
  }

  function switchWeapon(delta) {
    if (!armed()) return;
    if (switchCD > 0) return;            // ignore rapid repeats — prevents Q spam/lag
    const av = availableIndices();
    if (av.length <= 1) return;          // nothing to switch to: stay silent, no sfx churn
    switchCD = 0.22;
    const pos = Math.max(0, av.indexOf(fps.weapon));
    fps.weapon = av[(pos + delta + av.length) % av.length];
    CBZ.currentWeaponId = weaponIdOf(fps.weapon);
    fps.reloading = 0;
    // per-weapon draw time: a heavy rifle (AK equip 0.5s) takes a beat to
    // shoulder before it can fire — switching itself stays instant.
    shotCD = Math.max((WEAPONS[fps.weapon] && WEAPONS[fps.weapon].equip) || 0, Math.min(shotCD, 0.08));
    syncAmmo();
    weaponModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    carriedModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    muzzle.position.copy(weaponModels[fps.weapon].userData.muzzle);
    CBZ.sfx && CBZ.sfx("switch");
    CBZ.flashHint && CBZ.flashHint(weapon().label, 0.85);
    setAmmoHud();
    if (CBZ.game.mode === "city" && CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // DIRECT SLOT SELECT (number keys 1-9) — pick the Nth weapon in the hotbar,
  // in the SAME order the city HUD draws them, so [1]..[9] map to what you see.
  // WHY: scrolling/Q through a growing arsenal is clumsy; an RPG, an AK and a
  // sidearm should each be one keypress (GTA/CS muscle memory). 0-based slot.
  function selectWeaponSlot(slot) {
    if (CBZ.game.mode === "city") CBZ.game.cityHolstered = false;   // drawing a gun un-holsters (re-arms)
    const av = availableIndices();
    if (slot < 0 || slot >= av.length) return false;
    const idx = av[slot];
    if (idx === fps.weapon) return true;
    fps.weapon = idx;
    CBZ.currentWeaponId = weaponIdOf(fps.weapon);
    fps.reloading = 0;
    shotCD = Math.max((WEAPONS[fps.weapon] && WEAPONS[fps.weapon].equip) || 0, Math.min(shotCD, 0.08));  // heavy guns take a beat to shoulder
    syncAmmo();
    weaponModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    carriedModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    if (weaponModels[fps.weapon] && weaponModels[fps.weapon].userData.muzzle) muzzle.position.copy(weaponModels[fps.weapon].userData.muzzle);
    CBZ.sfx && CBZ.sfx("switch");
    CBZ.flashHint && CBZ.flashHint(weapon().label, 0.85);
    setAmmoHud();
    if (CBZ.game.mode === "city" && CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  CBZ.fpsSelectSlot = selectWeaponSlot;

  // ---- UNIFIED CITY HOTBAR (shared with HOTBAR + CHARPANEL) -----------------
  // CITY-ONLY. The single source of truth for the in-world bar AND the mirrored
  // bar in the I-screen. Order (contract): [0] HOLSTER/fists chip, then the
  // OWNED GUNS in their current left-to-right order (gunSlot = index into
  // availableIndices, selected byte-identically via CBZ.fpsSelectSlot), then the
  // USABLE ITEMS (g.cityInv entries whose econ tag is food/drug/throwable).
  // Each entry: { kind:"holster"|"gun"|"item", label, short, item?, gunSlot?,
  //   count?, active }. HOTBAR/CHARPANEL render exactly this; CBZ.cityHotbarSelect
  // dispatches a bar index. Pure read (no side effects) so the renderers can poll.
  const USABLE_TAGS = { food: 1, drug: 1, throwable: 1 };
  function hotbarItemNames() {
    // stable order: ITEMS catalog declaration order, filtered to owned usables.
    const inv = CBZ.game.cityInv || {}, ITEMS = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || {};
    const out = [];
    for (const name in ITEMS) {
      const it = ITEMS[name];
      if (it && USABLE_TAGS[it.tag] && (inv[name] || 0) > 0) out.push(name);
    }
    // any owned usable not in the catalog map (defensive) appended after
    for (const name in inv) {
      if ((inv[name] || 0) > 0 && !ITEMS[name] && out.indexOf(name) < 0) out.push(name);
    }
    return out;
  }
  function cityHotbar() {
    if (CBZ.game.mode !== "city") return [];
    const bar = [];
    const guns = availableIndices();
    // holster chip is "active" when holstered OR when you simply have no gun (so
    // the bar always shows your current empty-hand state highlighted)
    bar.push({ kind: "holster", label: "FISTS", short: "FIST", active: !!CBZ.game.cityHolstered || guns.length === 0 });
    for (let s = 0; s < guns.length; s++) {
      const w = WEAPONS[guns[s]];
      bar.push({ kind: "gun", id: w.id || w.key, gunSlot: s, label: w.label, short: w.short, active: !CBZ.game.cityHolstered && guns[s] === fps.weapon });
    }
    const items = hotbarItemNames(), inv = CBZ.game.cityInv || {};
    for (let i = 0; i < items.length; i++) {
      const name = items[i];
      bar.push({ kind: "item", item: name, label: name, short: name, count: inv[name] || 0, active: false });
    }
    return bar;
  }
  CBZ.cityHotbar = cityHotbar;

  // dispatch a UNIFIED-bar index: holster -> de-escalate; gun -> existing
  // fpsSelectSlot (byte-identical) + un-holster; item -> the EXISTING consume/
  // throw path for that item's tag. Returns true if it acted on a valid slot.
  function cityHotbarSelect(barIdx) {
    if (CBZ.game.mode !== "city") return false;
    const bar = cityHotbar();
    if (barIdx < 0 || barIdx >= bar.length) return false;
    const e = bar[barIdx];
    if (e.kind === "holster") { CBZ.cityHolster(true); return true; }
    if (e.kind === "gun") { CBZ.game.cityHolstered = false; return selectWeaponSlot(e.gunSlot); }   // fpsSelectSlot also clears holster
    if (e.kind === "item") return useHotbarItem(e.item);
    return false;
  }
  CBZ.cityHotbarSelect = cityHotbarSelect;

  // route a usable item to its EXISTING consume/throw path (no new mechanics):
  // food -> CBZ.cityEat, throwable -> CBZ.cityThrowFromInventory. Drugs have no
  // existing player-consume action (they're product to sell) — a graceful note.
  function useHotbarItem(name) {
    const ITEMS = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || {};
    const it = ITEMS[name];
    if (!it) return false;
    if (it.tag === "food" && CBZ.cityEat) return CBZ.cityEat(name);
    if (it.tag === "throwable" && CBZ.cityThrowFromInventory) { CBZ.cityThrowFromInventory(); return true; }
    if (it.tag === "drug") { CBZ.city && CBZ.city.note("Sell " + name + " to a dealer — not for using.", 1.4); return false; }
    return false;
  }

  // number-key hotbar in CITY (jail keeps its own stash-hotbar in inventory.js).
  // [1]..[9] map across the WHOLE unified bar (holster + guns + usable items),
  // so a keypress matches exactly what HOTBAR/CHARPANEL draw. Guns still select
  // byte-identically. Gated so it never fires while a menu/map is up.
  addEventListener("keydown", function (e) {
    if (e.repeat || CBZ.game.mode !== "city" || CBZ.game.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.fullMap && CBZ.fullMap.active)) return;
    const n = "123456789".indexOf(e.key);
    if (n >= 0) { if (cityHotbarSelect(n)) e.preventDefault(); }
  });

  function setActive(on) {
    fps.active = on;
    if (CBZ.playerChar) CBZ.playerChar.group.visible = !on;
    vm.visible = on;
    if (cross) {
      // Leaving FP used to write display:none even though shoulderActive()
      // became true in the same call. The per-frame change-only cache still
      // remembered `true`, so it never restored the element in third person.
      // Resolve the final shared owner now and keep the cache honest.
      const show = (fps.active || shoulderActive()) && CBZ.game.state === "playing";
      cross.style.display = show ? "block" : "none";
      _crossShown = show;
    }
    document.body.classList.toggle("fps", on);
    setAmmoHud();
    if (on && fps.fp === 0) fps.fp = 0.06;
    if (!on) {
      triggerHeld = false;
      // hand the FP look pitch to the third-person orbit so toggling out of
      // first person keeps looking where you were looking — the orbit used to
      // inherit whatever stale cam.pitch was left over (often the steep spawn
      // value), which armed-3PS turned into a sky/ceiling stare.
      if (CBZ.cam && typeof fps.fp === "number") CBZ.cam.pitch = Math.max(-0.6, Math.min(0.9, fps.fp));
    }
    // toggling FPS on hides the body; clear the 3PS present-weapon/carry poses
    // so the rig's arms are not stuck raised when the body re-appears
    // unarmed/holstered.
    if (CBZ.playerChar && on) { CBZ.playerChar.aimingPose = false; CBZ.playerChar.carryPose = false; }
  }

  CBZ.toggleFPS = function () { setActive(!fps.active); };
  CBZ.setFPS = function (on) { setActive(!!on); };
  CBZ.armFPSAfterIntro = function () {
    introWantsFPS = true;
    if (fps.active) setActive(false);
  };
  // Campaign prison runs deliberately stay in the same over-the-shoulder
  // language as the city.  State.js calls this before starting the prison
  // reveal so a stale one-shot arm from an earlier run cannot flip the camera
  // back to first person when camera.js announces intro completion.
  CBZ.disarmFPSAfterIntro = function () {
    introWantsFPS = false;
    if (fps.active) setActive(false);
  };
  const prevIntroComplete = CBZ.onIntroComplete;
  CBZ.onIntroComplete = function () {
    if (prevIntroComplete) prevIntroComplete();
    if (introWantsFPS && CBZ.game.state === "playing") {
      introWantsFPS = false;
      setActive(true);
      fps.fp = Math.max(fps.fp, 0.06);
    }
  };
  CBZ.fpsFire = fireControl;
  CBZ.fpsReload = reload;
  CBZ.fpsNextWeapon = function () { switchWeapon(1); };
  CBZ.fpsPrevWeapon = function () { switchWeapon(-1); };
  CBZ.fpsResetWeapons = resetWeapons;
  // add reserve ammo to a weapon (city shops / ammo boxes top you up)
  CBZ.fpsAddAmmo = function (n, id) {
    const i = id != null ? weaponIndex(id) : fps.weapon;
    if (i < 0 || !fps.reserves) return;
    fps.reserves[i] = (fps.reserves[i] || 0) + (n || 0);
    if (i === fps.weapon) syncAmmo();
    setAmmoHud();
  };
  CBZ.fpsActive = function () { return fps.active; };
  CBZ.fpsSetActive = setActive;                       // programmatic FP enter/exit (scope snap)
  // ---- gamepad + weapon-mod hooks ----
  // let a controller (systems/gamepad.js) drive ADS the same as holding RMB.
  CBZ.fpsSetAim = function (on) { aimHeld = !!on; };
  CBZ.fpsAimHeld = function () { return aimHeld; };
  // expose the per-weapon view/carry model arrays + id lookup so city/gunmods.js
  // can bolt scope / suppressor / grip child meshes onto the actual held guns.
  CBZ.fpsWeaponModels = weaponModels;      // first-person viewmodels (index === weapon slot)
  CBZ.fpsCarriedModels = carriedModels;    // third-person carried guns
  CBZ.fpsWeaponIdOf = weaponIdOf;
  CBZ.fpsWeaponCount = function () { return WEAPONS.length; };
  CBZ.fpsWeaponIndex = function () { return fps.weapon; };
  // re-seed the current mag/reserve display after a mod purchase changes capacity
  CBZ.fpsResyncAmmo = function () { syncAmmo(); setAmmoHud(); };
  // TRUE while the player is HOLDING RMB to aim down sights, with a gun out and
  // mid-play (FPS or the 3PS shoulder). Read by city/camera.js to punch the
  // over-shoulder cam IN + narrow FOV on ADS. (Spread/recoil reduction is read
  // locally via aimHeld; this is the camera-side hook.)
  CBZ.isADS = function () { return aimHeld && armed() && (fps.active || shoulderActive()) && CBZ.game.state === "playing"; };
  CBZ.weaponThirdPersonActive = shoulderActive;
  CBZ.playerArmed = armed;
  CBZ.playerMuzzleWorld = function (out) { return muzzleWorld(out || new THREE.Vector3()); };
  // ---- aim introspection for other systems (e.g. systems/intimidate.js) ----
  CBZ.currentGun = function () { return armed() ? weapon() : null; };   // equipped weapon or null
  CBZ.aimedActor = aimedActor;                                         // {actor,dist,head,point} | null
  // true while the player is actively presenting a firearm (FPS or the
  // third-person shoulder), in either pointing or aiming stance, mid-play.
  CBZ.isAimingWeapon = function () {
    return CBZ.game.state === "playing" && armed() && (fps.active || shoulderActive());
  };
  CBZ.onWeaponInventoryChanged = function (id, first) {
    const idx = weaponIndex(id);
    if (idx >= 0) fps.weapon = idx;
    normalizeWeapon();
    fps.reloading = 0;
    syncAmmo();
    weaponModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    carriedModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    setAmmoHud();
    if (CBZ.game.mode === "city" && CBZ.cityHudDirty) CBZ.cityHudDirty();
    // Auto-drop into FIRST-PERSON the moment you actually pick up a gun in
    // third person — FPS-with-a-gun is the intended way to shoot. Only on a
    // brand-new acquisition (first), only mid-play, never in survival.
    if (first && !fps.active && CBZ.game.state === "playing" && CBZ.game.mode !== "survival" && CBZ.game.mode !== "city") {
      setActive(true);
      fps.fp = Math.max(fps.fp, 0.06);
      // (no announcement — the camera dropping into first person IS the message)
    }
  };

  // ---- input ----
  document.addEventListener("mousemove", (e) => {
    if (!fps.active || document.pointerLockElement == null) return;
    // scoped look is proportionally finer (systems/lockon.js real sniper scope)
    const sensMul = CBZ.fpsLookSensMul ? CBZ.fpsLookSensMul() : 1;
    fps.fp = Math.max(-1.3, Math.min(1.3, fps.fp - e.movementY * SENS * sensMul));
  });
  document.addEventListener("mousedown", (e) => {
    if (CBZ.game.mode === "survival") return;   // disaster mode: grapple.js owns push/grab/punch
    if ((fps.active || shoulderActive()) && CBZ.game.state === "playing" && document.pointerLockElement) {
      e.preventDefault();
      if (e.button === 0) fireControl(true);
      else if (e.button === 2) aimHeld = true;   // RMB raises the gun to aim
    }
  });
  document.addEventListener("mouseup", (e) => {
    if (e.button === 0) fireControl(false);
    else if (e.button === 2) aimHeld = false;
  });
  // suppress the context menu so right-click can drive third-person aiming
  document.addEventListener("contextmenu", (e) => {
    if ((fps.active || shoulderActive()) && CBZ.game.state === "playing") e.preventDefault();
  });
  // index of the currently-selected entry in the unified city bar (the active
  // gun, or the holster chip when holstered/empty-handed). For scroll stepping.
  function cityHotbarCurrentIndex() {
    const bar = cityHotbar();
    for (let i = 0; i < bar.length; i++) if (bar[i].active) return i;
    return 0;   // fall back to the holster chip
  }
  addEventListener("wheel", (e) => {
    // CITY: scroll cycles the DURABLE selection (holster chip + guns), so you
    // can wheel back to fists or to any gun — works even while holstered. Item
    // slots are intentionally SKIPPED by the wheel (one-shot uses would fire
    // just from scrolling past them); reach items with the number keys.
    if (CBZ.game.mode === "city") {
      if (CBZ.game.state !== "playing" || CBZ.cityMenuOpen || (CBZ.fullMap && CBZ.fullMap.active)) return;
      const bar = cityHotbar();
      // selectable = holster + gun entries only
      const sel = [];
      for (let i = 0; i < bar.length; i++) if (bar[i].kind !== "item") sel.push(i);
      if (sel.length <= 1) return;
      e.preventDefault();
      const cur = cityHotbarCurrentIndex();
      let pos = sel.indexOf(cur); if (pos < 0) pos = 0;
      const dir = e.deltaY > 0 ? 1 : -1;
      cityHotbarSelect(sel[(pos + dir + sel.length) % sel.length]);
      return;
    }
    if (!(fps.active || shoulderActive()) || !armed()) return;
    e.preventDefault();
    switchWeapon(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "v" && CBZ.game.mode !== "city") CBZ.toggleFPS();   // city owns [V] via city/view.js
    else if (k === "r" && (fps.active || shoulderActive())) reload();
    else if (k === "x" && (fps.active || shoulderActive()) && weapon().explosive &&
      !CBZ.cityMenuOpen && !(CBZ.fullMap && CBZ.fullMap.active) &&
      !(CBZ.buildMode && CBZ.buildMode.active)) {
      if (cycleRocketAmmoType()) { e.preventDefault(); if (CBZ.sfx) CBZ.sfx("rack", { volume: 0.35 }); }
    }
    // NOTE: Q (swap gun) is intentionally NOT handled here. Browsers buffer
    // keydown events during a lag spike and drain them over the following
    // frames, which produced "leftover" weapon switches after you stopped
    // mashing. Instead we read the live key state once per frame below
    // (rising-edge + cooldown), so buffered duplicates collapse to nothing.
    else if (k === "f" && (fps.active || shoulderActive()) && CBZ.game.mode !== "survival") fireControl(true);
  });
  addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() === "f") fireControl(false);
  });

  // ---- per-run reset ----
  let lastElapsed = 0;
  function checkReset() {
    const el = (CBZ.game.elapsed || 0);
    if (el + 0.001 < lastElapsed) {
      if (fps.active) setActive(false);
      if (CBZ.gunModsReset) CBZ.gunModsReset();   // a fresh run strips fitted attachments before rounds re-seed
      resetWeapons();
      // a fresh run starts on unmarked streets — wipe last run's bullet pocks
      // and rocket scars/smoking wounds
      if (CBZ.bulletHolesReset) CBZ.bulletHolesReset();
      if (CBZ.cityBlastFxReset) CBZ.cityBlastFxReset();
      shudders.length = 0;
    }
    lastElapsed = el;
  }

  // ---- SOFT AIM-LOCK (GTA-style, on-foot) ----------------------------------
  // When you aim down sights — even without a scope — the reticle eases onto the
  // nearest target in a forward cone and tracks it. Modeled on the vehicle
  // homing acquisition (cone-dot score + nearest), but instead of steering a
  // projectile it nudges cam.yaw / pitch, so the muzzle ray (and the bullet)
  // follow for free. One-line revert: CBZ.CONFIG.AIM_LOCK_ASSIST = false.
  if (CBZ.CONFIG.AIM_LOCK_ASSIST == null) CBZ.CONFIG.AIM_LOCK_ASSIST = true;
  let lockTarget = null, lockScanT = 0;
  const _lockEye = new THREE.Vector3(), _lockDir = new THREE.Vector3(), _lockRay = new THREE.Vector3();
  const _lockCands = [];
  function lockValid(a) { return a && !a.dead && (a.ko || 0) <= 0 && !a.escaped && a.group && a.group.visible !== false; }
  function pickLockActor(eye, fwd, range, coneCos) {
    _lockCands.length = 0;
    const consider = function (list) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!lockValid(a)) continue;
        const gp = a.group.position, gy = gp.y || 0;
        const tx = gp.x - eye.x, ty = (gy + TORSO_Y) - eye.y, tz = gp.z - eye.z;
        const dist = Math.hypot(tx, ty, tz); if (dist < 0.6 || dist > range) continue;
        const dot = (tx * fwd.x + ty * fwd.y + tz * fwd.z) / dist;
        if (dot < coneCos) continue;                       // outside the acquire cone
        _lockCands.push({ a: a, dist: dist, nx: tx / dist, ny: ty / dist, nz: tz / dist,
          score: (1 - dot) * 8 + (dist / range) * 0.08 }); // most on-axis wins, nearness breaks ties
      }
    };
    consider(CBZ.cityPeds); consider(CBZ.cityCops); if (CBZ.cityMedics) consider(CBZ.cityMedics);
    _lockCands.sort(function (p, q) { return p.score - q.score; });
    // Best-first, first candidate with a clear line of sight wins — the same
    // no-lock-through-walls contract as the rocket acquisition above. Capped
    // raycasts (rescans run at 10Hz, so keep the per-tick cost bounded).
    for (let i = 0; i < _lockCands.length && i < 4; i++) {
      const c = _lockCands[i];
      _lockRay.set(c.nx, c.ny, c.nz);
      const cover = wallDistance(eye, _lockRay, c.dist);
      if (cover && cover.distance < c.dist - 1.2) continue;   // behind a wall
      return c.a;
    }
    return null;
  }
  // Ease the live aim toward the locked target's chest. Corrects against the
  // ACTUAL aim direction, so it works identically in FPS and 3rd-person shoulder
  // (both map an increasing cam.yaw to an increasing atan2(x,z) heading).
  function applyAimLock(dt) {
    if (CBZ.CONFIG.AIM_LOCK_ASSIST === false || !armed() || !CBZ.camera || !(CBZ.isADS && CBZ.isADS())) { lockTarget = null; return; }
    aimForward(_lockDir);
    CBZ.camera.getWorldPosition(_lockEye);
    lockScanT -= dt;
    if (!lockValid(lockTarget) || lockScanT <= 0) {
      lockScanT = 0.1;
      // The pick embeds the occlusion test, so re-running it every tick also
      // BREAKS the lock when the held target ducks behind cover — no tracking
      // people through walls (matches the dossier's aim contract).
      lockTarget = pickLockActor(_lockEye, _lockDir, 55, Math.cos(0.45));   // ~26° cone, 55m
    }
    if (!lockValid(lockTarget)) return;
    const gp = lockTarget.group.position, gy = gp.y || 0;
    const dx = gp.x - _lockEye.x, dy = (gy + TORSO_Y) - _lockEye.y, dz = gp.z - _lockEye.z;
    const dlen = Math.hypot(dx, dy, dz) || 1;
    let dHead = Math.atan2(dx / dlen, dz / dlen) - Math.atan2(_lockDir.x, _lockDir.z);
    while (dHead > Math.PI) dHead -= 2 * Math.PI; while (dHead < -Math.PI) dHead += 2 * Math.PI;
    const dPitch = Math.asin(Math.max(-1, Math.min(1, dy / dlen))) - Math.asin(Math.max(-1, Math.min(1, _lockDir.y)));
    const k = 1 - Math.pow(0.02, dt);                     // smooth ~fast settle onto target
    if (CBZ.cam) CBZ.cam.yaw += dHead * k;
    if (fps.active) fps.fp = Math.max(-1.3, Math.min(1.3, fps.fp + dPitch * k));
    else if (CBZ.cam) CBZ.cam.pitch = Math.max(-1.0, Math.min(0.9, CBZ.cam.pitch + dPitch * k));
  }
  CBZ.aimLockTarget = function () { return lockTarget; };

  // ---- camera override and effects update ----
  // change-only style write: setting style.display every frame invalidates
  // style and measured milliseconds across a session (perf pass)
  CBZ.onAlways(52, function (dt) {
    checkReset();
    const aiming = fps.active || shoulderActive();
    const crossShow = aiming && CBZ.game.state === "playing";
    if (cross && crossShow !== _crossShown) { cross.style.display = crossShow ? "block" : "none"; _crossShown = crossShow; }

    if (shotCD > 0) shotCD = Math.max(0, shotCD - dt);
    if (dryCD > 0) dryCD = Math.max(0, dryCD - dt);
    if (switchCD > 0) switchCD = Math.max(0, switchCD - dt);

    // Q = swap gun, polled at frame rate. A switch only fires on a fresh
    // press (key was up last frame, down now) and only when off cooldown,
    // so a backlog of buffered keydowns can never replay as extra switches.
    const qNow = !!(CBZ.keys && CBZ.keys["q"]);
    if (qNow && !qWasDown && switchCD <= 0 && aiming && armed()) switchWeapon(1);
    qWasDown = qNow;

    for (let i = 0; i < tracers.length; i++) {
      const t = tracers[i];
      if (t.life > 0) {
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life / t.max) * 0.9;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    updateRockets(dt);   // (b) in-flight RPG projectiles: fly the arc, detonate on arrival
    updateRocketSmoke(dt);
    updateDeferred(dt);  // (b) sniper travel-time feedback queue
    for (let i = 0; i < impacts.length; i++) {
      const p = impacts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.mesh.material.opacity = Math.max(0, p.life / p.max);
        p.mesh.scale.multiplyScalar(1 + dt * 5.5);
        if (p.life <= 0) p.mesh.visible = false;
      }
    }
    for (let i = 0; i < casings.length; i++) {
      const c = casings[i];
      if (c.life > 0) {
        c.life -= dt;
        c.vel.y -= 8.5 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += dt * 9;
        c.mesh.rotation.z += dt * 6;
        if (c.mesh.position.y < 0.06) {
          c.mesh.position.y = 0.06;
          c.vel.y = Math.abs(c.vel.y) * 0.22;
          c.vel.x *= 0.72;
          c.vel.z *= 0.72;
        }
        if (c.life <= 0) c.mesh.visible = false;
      }
    }

    // PANEL SHUDDER decay: shot cars wobble then settle dead-flat. Runs here
    // (above the !aiming early-out) so a shudder finishes even if the player
    // holsters the instant after the burst.
    for (let i = shudders.length - 1; i >= 0; i--) {
      const s = shudders[i];
      s.t += dt;
      const ud = s.car.group && s.car.group.userData;
      if (!ud || !ud.body || s.car.dead) { shudders.splice(i, 1); continue; }
      const k = s.t / s.dur;
      if (k >= 1) { ud.body.rotation.x = 0; shudders.splice(i, 1); continue; }
      ud.body.rotation.x = Math.sin(s.t * 72) * s.amp * (1 - k);
    }

    if (worldMuzzleT > 0) {
      worldMuzzleT -= dt;
      worldMuzzle.material.opacity = Math.max(0, worldMuzzleT / 0.065);
      if (worldMuzzleT <= 0) worldMuzzle.visible = false;
    }

    // DEATH DROP — runs in the unconditional zone so it finishes even though
    // view.js flips fps off the instant you die. The viewmodel pitches forward,
    // accelerates down and yaws/rolls out of the grip, then hides; meanwhile
    // the world prop falls from hand height, smacks the pavement and settles
    // on its side beside the body.
    if (ddT >= 0) {
      ddT += dt;
      const k = Math.min(1, ddT / DD_DUR);
      vm.visible = true; gun.visible = true; fists.visible = false; muzzle.visible = false;
      gun.position.set(k * 0.34, -k * k * 1.5, -k * 0.18);     // falls away, accelerating
      gun.rotation.set(k * 1.9, -k * 0.8, k * 1.1);            // pitches forward, yaws + rolls free
      if (k >= 1) { ddT = -1; gun.position.set(0, 0, 0); gun.rotation.set(0, 0, 0); vm.visible = false; }
    }
    if (dropMesh) {
      dropLife -= dt;
      if (dropLife <= 0) clearWorldDrop();
      else if (!dropLanded) {
        dropVy -= 20 * dt;
        dropMesh.position.x += dropVx * dt; dropMesh.position.y += dropVy * dt; dropMesh.position.z += dropVz * dt;
        dropMesh.rotation.x += dropSx * dt; dropMesh.rotation.y += dropSy * dt; dropMesh.rotation.z += dropSz * dt;
        const fl = (CBZ.floorAt ? CBZ.floorAt(dropMesh.position.x, dropMesh.position.z) : 0) + 0.09;
        if (dropMesh.position.y <= fl && dropVy < 0) {
          dropMesh.position.y = fl; dropLanded = true;
          dropMesh.rotation.set(0, dropMesh.rotation.y, Math.PI / 2 - 0.18);   // settles on its side
          if (CBZ.sfx) CBZ.sfx("shell");                                        // the clatter of steel on pavement
        }
      }
    }

    // HIT MARKER animation: ticks punch OUT from centre on the hit, then ease
    // back in while fading. A kill marker also rotates the whole cluster a few
    // degrees into an X and lingers longer. Runs unconditionally so it always
    // finishes its fade even if you lower the gun the instant after a kill.
    if (hitMarkerT > 0) {
      hitMarkerT = Math.max(0, hitMarkerT - dt);
      const k = hitMarkerT / hitMarkerDur;             // 1 -> 0
      const e = k * k;                                  // ease-out fade
      // splay snaps wide (~9px) then settles to ~5px as it fades
      const spread = 5 + e * 5;
      hitMarker.placeTicks(spread);
      const spin = hitMarkerKill ? (1 - k) * 14 : 0;    // tilt into an X on a kill
      const sc = 0.85 + e * 0.35;
      hitMarker.wrap.style.transform =
        "translate(-50%,-50%) rotate(" + spin.toFixed(1) + "deg) scale(" + sc.toFixed(2) + ")";
      hitMarker.wrap.style.opacity = Math.min(1, k * 1.6).toFixed(3);
      if (hitMarkerT <= 0) hitMarker.wrap.style.display = "none";
    }

    // a corpse doesn't present a weapon: shoulderActive() doesn't know about
    // death, so without this gate the carried gun stayed posed in the dead
    // player's grip and the arm-damp below kept aiming the ragdoll (user: "you
    // don't hold your weapon when you die"). The death tumble above owns the vm.
    if (!aiming || (CBZ.player && CBZ.player.dead)) {
      carriedGun.visible = false;
      // STUCK-POSE FIX: this early-out skips the pose writer at the bottom of
      // the TP branch, so holstering / switching to melee / dying while in TP
      // used to leave aimingPose latched true and the rig frozen squared-up
      // forever ("holds arms up like squaring up all the time"). Clear both
      // stance flags on the way out so animChar's natural idle takes over.
      if (CBZ.playerChar) { CBZ.playerChar.aimingPose = false; CBZ.playerChar.carryPose = false; }
      return;
    }

    if (fps.reloading > 0) {
      fps.reloading -= dt;
      if (fps.reloading <= 0) finishReloadStep();
      else setAmmoHud();
    }
    // NOTE: held-trigger auto fire moved BELOW the pose updates — see end of
    // this callback. Firing here read last frame's camera/rig mid-recoil-swing,
    // which is the other half of "sustained fire creeps off the barrel".

    let bobY = 0, bobX = 0;
    const p = CBZ.player;
    if (fps.active) {
      const eyeH = p.crouch ? 1.18 : 1.65;
      if (p.grounded && p.speed > 0.6 && (p.stun || 0) <= 0) {
        bobPhase += dt * (6 + p.speed * 1.1);
        bobY = Math.sin(bobPhase * 2) * 0.035;
        bobX = Math.sin(bobPhase) * 0.03;
      }
      forward(fwd);
      buildBasis(fwd);
      eye.set(p.pos.x, p.pos.y + eyeH + bobY, p.pos.z).addScaledVector(right, bobX);
      CBZ.camera.position.copy(eye);
      tmp.copy(eye).add(fwd);
      CBZ.camera.lookAt(tmp);
      // ADS ZOOM (RMB): ease the FPS lens ~14° tighter while aiming, back out on
      // release. Capture the hip fov from camera.js's value only while NOT aiming
      // (and clamp sane) so reading our own zoomed value can never ratchet it.
      //
      // SINGLE-OWNER GATE (city FPS-FOV flicker fix): in the CITY, the first-person
      // lens is OWNED by systems/camera.js's cc.fp branch (onAlways 50) — it eases
      // camera.fov toward an ADS-aware target with its OWN SmoothDamp state. This
      // block ALSO ran every city frame easing toward fpsHipFov-ADS_FOV_DROP with a
      // SEPARATE easing; two writers racing toward the (same) target with different
      // smoothing states produced the in/out ADS FLICKER while RMB was held. So in
      // city we SKIP this entirely and let camera.js solely drive the FOV. Outside
      // city (prison/escape FPS) camera.js's city branch never runs, so this block
      // remains the sole FOV owner there — byte-identical behaviour for those modes.
      // FP-FOV runs in ALL modes now. While fps.active, camera.js bows out of the
      // FP lens (it early-returns) so THIS block is the genuine sole FP-FOV owner
      // — no second writer to race, no flicker. (The old `mode!=="city"` gate left
      // city FP with nobody narrowing the FOV → RMB never zoomed.)
      {
        const ads = aimHeld && armed();
        // HIP FOV IS A STABLE BASELINE — captured ONCE, never re-read from the
        // live lens. The old code re-captured it every non-ADS frame; that was
        // the RATCHET bug: camera.js now bows out of the FP lens (sole-owner fix),
        // so right after you release RMB the lens is still easing BACK from the
        // ADS punch-in — re-capturing that half-zoomed value as the new "hip" made
        // every right-click zoom in further and never zoom back out. A fixed hip
        // means RMB eases to hip−DROP and release eases cleanly back to hip.
        if (fpsHipFov === 0) fpsHipFov = 75;   // FP hip → ADS lands ~50 (hip − ADS_FOV_DROP)
        // a mounted scope (city/gunmods.js) overrides the ADS target with a much
        // tighter lens — a red-dot barely nudges it, a sniper scope slams it to ~12°.
        // The factory sniper's REAL scope (systems/lockon.js) reads first; it
        // returns null whenever a gunsmith optic is fitted, so exactly one wins.
        const scopeF = (CBZ.fpsScopeFov && CBZ.fpsScopeFov()) || (CBZ.cityScopeFov && CBZ.cityScopeFov());
        const wantFov = scopeF ? scopeF : (ads ? fpsHipFov - ADS_FOV_DROP : fpsHipFov);
        if (Math.abs(CBZ.camera.fov - wantFov) > 0.05) {
          CBZ.camera.fov += (wantFov - CBZ.camera.fov) * Math.min(1, dt * 12);
          CBZ.camera.updateProjectionMatrix();
        }
      }
    }

    // SMOOTHER recoil RECOVERY: after a brief hold (so the kick reads), the gun
    // springs back toward true centre with an ease that's gentle near zero —
    // no abrupt rubber-band snap, no lingering offset. recoilSide settles a bit
    // faster (horizontal kick should self-correct first, like real muzzle climb
    // recovery). Pulling the muzzle climb (fp/pitch) back down is what makes a
    // mag-dump return to where you were aiming instead of drifting up the wall.
    if (recoilHold > 0) recoilHold = Math.max(0, recoilHold - dt);
    else {
      const rk = 1 - Math.pow(0.0004, dt);          // ~smooth critically-damped feel (settles a touch faster — mag dumps recenter)
      recoil += (0 - recoil) * rk;
    }
    // Return the visible camera impulse. Recovery moves the same pitch/yaw the
    // shot kicked; it cannot silently bend a bullet away from the reticle.
    {
      const wNow = armed() ? weapon() : null;
      const recenter = (wNow && wNow.recenter) || 0.18;     // seconds to settle
      // "firing this frame" while an auto weapon's trigger is held → recover slow
      // (so the kick reads); otherwise recover full speed (4x).
      const firing = recoilHold > 0 || (triggerHeld && wNow && wNow.auto && fps.rounds[fps.weapon] > 0);
      const recoverK = firing ? 0.25 : 1.0;
      const settle = recoverK * (1 - Math.exp(-dt / recenter));
      const rp = recoilPitch * settle;
      const ry = recoilYaw * settle;
      if (fps.active) fps.fp = Math.max(-1.3, Math.min(1.3, fps.fp - rp));
      else if (CBZ.cam) CBZ.cam.pitch = Math.max(-1.0, Math.min(0.9, CBZ.cam.pitch + rp));
      if (CBZ.cam) CBZ.cam.yaw -= ry;
      recoilPitch -= rp;
      recoilYaw -= ry;
      if (Math.abs(recoilPitch) < 1e-5) recoilPitch = 0;
      if (Math.abs(recoilYaw) < 1e-5) recoilYaw = 0;
      // BURST RESET: a fire gap of >0.25s wipes the ramp + pattern position so
      // the next round is a fresh, pinpoint first shot.
      sinceShot += dt;
      if (sinceShot > 0.25 && shotsInBurst !== 0) shotsInBurst = 0;
    }
    recoilSide += (0 - recoilSide) * Math.min(1, 13 * dt);
    vmPunch += (0 - vmPunch) * Math.min(1, 10 * dt);
    pumpT = Math.max(0, pumpT - dt * 4.5);
    // BLOOM tightens back toward zero when not firing; faster while standing
    // still (the discipline reward). triggerHeld auto-fire keeps it propped up.
    {
      const settleSpeed = (CBZ.player.speed || 0) < 0.6 && CBZ.player.grounded !== false ? 6.5 : 3.2;
      bloom = Math.max(0, bloom - bloom * Math.min(1, settleSpeed * dt) - 0.0008 * dt);
    }

    if (!armed()) animFists(dt);

    const w = weapon();
    const reloadDip = fps.reloading > 0 ? 0.13 + Math.sin(CBZ.now * 0.018) * 0.025 : 0;
    if (fps.active) {
      // First-person: the player body is hidden, so the 3PS aim/carry poses
      // must not linger on the rig (animChar reads these flags). Clear here.
      if (CBZ.playerChar) { CBZ.playerChar.aimingPose = false; CBZ.playerChar.carryPose = false; }
      if (armed()) {
        // Sustained-fire climb stays small; bullets now use the exact live
        // muzzle socket, so the rendered barrel and projectile remain welded
        // together through the kick instead of diverging under an origin clamp.
        vm.position.set(
          0.36 - bobX * 0.5 + recoilSide * 0.55,
          -0.34 + bobY * 0.5 - recoil * 0.08 - vmPunch * 0.18 - reloadDip,
          -0.72 + recoil * 0.12 - vmPunch * 0.3
        );
        vm.rotation.x = -0.10 + recoil * 0.26 + vmPunch * 0.4 + reloadDip * 0.8;   // level the barrel forward (was tilted up)
        vm.rotation.z = recoilSide * 0.7 - bobX * 0.18;
      } else {
        // unarmed single hand sits low and to the right (Minecraft-style)
        vm.position.set(0.12 + bobX * 0.4, -0.30 + bobY * 0.5 - vmPunch * 0.05, -0.66 - vmPunch * 0.05);
        vm.rotation.x = vmPunch * 0.10;
        vm.rotation.z = -bobX * 0.10;
      }
      carriedGun.visible = false;
    } else {
      attachCarriedGun();
      carriedGun.visible = armed() && !CBZ.player._swim;
      const longGun = w.slot === "long" || w.slot === "rifle" || w.slot === "auto";
      const util = w.slot === "utility";
      // Two carry stances: a relaxed LOW-READY (gun lowered and tucked to
      // the side so it never juts through the chest when viewed from
      // behind) and a raised AIM pose. We only raise when actually PRESENTING
      // — aiming (RMB), holding the trigger, or while recoil settles after a
      // shot — so by default the player CARRIES the weapon (RDR2/Fortnite
      // carry) instead of permanently pointing it. A regression had hard-wired
      // `aim = true`, which both squared the arms up forever AND barrel-locked
      // the gun along the camera ray every frame — from the over-shoulder cam
      // a forward-locked barrel is foreshortened to a few pixels behind the
      // torso, which is why the owner never SAW the gun in third person.
      // CITY_TP_LOWREADY=false reverts to the old always-raised behavior.
      const aim = CBZ.CONFIG.CITY_TP_LOWREADY === false ? true : presenting();
      // gun sits a touch lower / tilted down when at the ready
      // Nudge the carried gun a touch UP + FORWARD so the muzzle clears the
      // chest silhouette when the arm is raised into the present-weapon pose
      // (animChar owns the arm; this just keeps the barrel reading on-screen).
      carriedGun.position.set(
        (longGun ? 0.04 : 0.00) + recoilSide * 0.18,
        (aim ? (longGun ? 0.04 : 0.01) : -0.12) - reloadDip * 0.16,
        (aim ? (longGun ? 0.30 : (util ? 0.14 : 0.22)) : 0.02) - recoil * 0.07
      );
      // Barrel-down-the-forearm baseline (-π/2, no Math.PI on Y) — the FALLBACK
      // orientation if the world barrel-lock below can't run (no parent yet).
      carriedGun.rotation.set(
        -1.571 + (aim ? 0.0 : 0.18) + recoil * 0.12 + reloadDip * 0.22,
        -0.04,
        -0.03 + recoilSide * 0.75
      );
      // ---- WORLD BARREL LOCK (the owner-reported "gun faces the wrong way" in
      // third person): the pose chain (body-yaw damp → shoulder → elbow → hand)
      // only APPROXIMATES the aim, so the barrel visibly drifted off the
      // crosshair — FP is exact because it draws its own viewmodel. Standard TP
      // fix: keep the gun's POSITION parented to the hand, but override its
      // ORIENTATION in world space every frame so the barrel points exactly at
      // the crosshair ray's far point (parallax-correct from the gun's own
      // position). Recoil/reload kick re-applied as local perturbations on top.
      // Only while PRESENTING — the low-ready carry keeps the local
      // down-forward fallback pose above (a lowered gun locked to the horizon
      // crosshair would twist against the hip-carry arm).
      if (aim && carriedGun.parent && CBZ.camera) {
        carriedGun.parent.updateWorldMatrix(true, false);
        carriedGun.getWorldPosition(_blGunPos);
        _blDir.set(0, 0, -1).applyQuaternion(CBZ.camera.quaternion);
        _blTarget.copy(CBZ.camera.position).addScaledVector(_blDir, 120);
        _blDir.copy(_blTarget).sub(_blGunPos).normalize();
        // matrix with -Z along the aim dir (+Y kept upright) = barrel on target
        _blMat.lookAt(_blZero, _blDir, _blUp);
        _blWorldQ.setFromRotationMatrix(_blMat);
        carriedGun.parent.getWorldQuaternion(_blParentQ);
        carriedGun.quaternion.copy(_blParentQ.invert()).multiply(_blWorldQ);
        // kick: muzzle climbs on recoil, dips on reload — about the gun's own X
        carriedGun.rotateX(recoil * 0.12 + reloadDip * 0.22);
      }
      if (CBZ.playerChar) {
        const yaw = Math.atan2(-Math.sin(CBZ.cam.yaw), -Math.cos(CBZ.cam.yaw));
        // CAM_FACING_BLEND: ramp the ease rate in after a draw (see physics.js's
        // twin on the unarmed side) so drawing a gun sweeps the body to camera-
        // forward instead of snapping it.
        const faceEase = CBZ.camFacingEase ? CBZ.camFacingEase() : 1;
        CBZ.playerChar.group.rotation.y = CBZ.lerpAngle(CBZ.playerChar.group.rotation.y, yaw, 1 - Math.pow(0.00008, dt * faceEase));
        // HAND OFF the arm pose to animChar (the single owner of the arms — see
        // entities/character.js). fpsmode no longer writes ra/la directly: it
        // only RAISES the flag + feeds the data the pose needs, so the per-frame
        // animChar pass can HOLD the aim pose without a tug-of-war damping the
        // arm back toward idle. animChar reads aimingPose / aimLong / aimRecoil /
        // aimRecoilSide and builds the Fortnite-style present-weapon pose.
        // TWO-STANCE: present pose only while actually presenting; otherwise
        // the LOW-READY carry (armed() is guaranteed true in this branch —
        // shoulderActive() gates `aiming`). Unarmed/holstered never reaches
        // here (early-out above clears both flags), giving the NPC-style idle.
        CBZ.playerChar.aimingPose = aim;
        CBZ.playerChar.carryPose = !aim;
        CBZ.playerChar.aimLong = longGun;
        CBZ.playerChar.aimRecoil = recoil;
        CBZ.playerChar.aimRecoilSide = recoilSide;
      }
    }

    weaponModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    carriedModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    const sg = weaponModels[1];
    if (sg && sg.userData.pump) sg.userData.pump.position.z = sg.userData.pumpBaseZ + Math.sin(pumpT * Math.PI) * 0.22;
    const carriedSg = carriedModels[1];
    if (carriedSg && carriedSg.userData.pump) carriedSg.userData.pump.position.z = carriedSg.userData.pumpBaseZ + Math.sin(pumpT * Math.PI) * 0.22;
    gun.visible = armed();
    fists.visible = !armed();

    if (muzzleT > 0) {
      muzzleT -= dt;
      muzzle.material.opacity = Math.max(0, muzzleT / (w.key === "shotgun" ? 0.065 : 0.04));
      if (muzzleT <= 0) muzzle.visible = false;
    }

    // SOFT AIM-LOCK: ease the reticle onto the nearest target while ADS, before
    // the held-fire + reticle sample below read the aim — so both track the lock.
    applyAimLock(dt);

    // HELD-TRIGGER auto fire — AFTER this frame's camera + viewmodel +
    // carried-gun/arm pose are final, so every round of a burst samples the
    // SAME fresh matrices a single tap does (taps fire post-render from the
    // mouse event). The flash sprite, tracer and casing all read muzzleWorld
    // off the pose that's about to be RENDERED, keeping the stream visually
    // welded to the barrel through a whole mag-dump.
    if (triggerHeld && w.auto) shoot();

    if (cross) {
      const aim = aimedActor(armed() ? w.range : MELEE);
      // reticle breathes with the live cone: tight at rest, blooms with recoil,
      // bloom accumulation, movement AND suppression — so the crosshair
      // HONESTLY shows where shots will land (the AAA contract between
      // reticle and spread; suppressK mirrors the same penalty shoot() folds
      // into the actual cone, so a rattled player SEES why they're missing).
      const mv = CBZ.player.grounded === false ? 0.6 : Math.min(1, (CBZ.player.speed || 0) / 6);
      const suppK = CBZ.suppressionAccuracyMul ? CBZ.suppressionAccuracyMul(CBZ.player) : 1;
      const adsReticleK = aimHeld ? 0.58 : 1;
      const bipodK = bipodActive(w) ? 0.48 : 1;
      const size = armed()
        ? Math.min(30, Math.max(16, (12 + w.spread * 180 + bloom * 240 + recoil * 16 + mv * 7 + (fps.reloading > 0 ? 6 : 0)) * suppK * adsReticleK * bipodK))
        : 18;
      cross.style.width = size.toFixed(1) + "px";
      cross.style.height = size.toFixed(1) + "px";
      reticleState.conePx = size;

      // Project the REAL muzzle ray's nearest impact. In open space this sits
      // at screen centre; beside a wall it shifts to expose shoulder parallax
      // instead of promising a shot the barrel cannot physically make.
      let cameraHit = null, muzzleHit = null, muzzleBlocked = false;
      if (armed() && CBZ.camera) {
        aimForward(reticleDir);
        cameraHit = resolveShot(w, reticleDir);
        if (cameraHit && cameraHit.point) reticlePoint.copy(cameraHit.point);
        else reticlePoint.copy(CBZ.camera.position).addScaledVector(reticleDir, w.range);
        muzzleWorld(reticleOrigin);
        const intendedDistance = reticleOrigin.distanceTo(reticlePoint);
        reticleDir.copy(reticlePoint).sub(reticleOrigin).normalize();
        muzzleHit = resolveShot(w, reticleDir, reticleOrigin);
        const cameraIdentity = reticleHitIdentity(cameraHit);
        const muzzleIdentity = reticleHitIdentity(muzzleHit);
        // Camera intent and barrel truth are allowed to disagree beside cover,
        // but the HUD must SAY so. Amber means the actual muzzle ray is caught
        // by something nearer than the object under the centre sight.
        muzzleBlocked = !!(cameraIdentity && muzzleIdentity !== cameraIdentity && muzzleHit &&
          muzzleHit.dist + 0.22 < intendedDistance && (muzzleHit.wall || reticleDamageable(muzzleHit)));
        if (muzzleHit && muzzleHit.point) reticlePoint.copy(muzzleHit.point);
        reticlePoint.project(CBZ.camera);
        if (Number.isFinite(reticlePoint.x) && Number.isFinite(reticlePoint.y) && reticlePoint.z > -1 && reticlePoint.z < 1) {
          const sx = Math.max(4, Math.min(96, (reticlePoint.x * 0.5 + 0.5) * 100));
          const sy = Math.max(4, Math.min(96, (-reticlePoint.y * 0.5 + 0.5) * 100));
          cross.style.left = sx.toFixed(2) + "%";
          cross.style.top = sy.toFixed(2) + "%";
          reticleState.x = sx; reticleState.y = sy;
        } else {
          cross.style.left = cross.style.top = "50%";
          reticleState.x = reticleState.y = 50;
        }
      } else {
        reticleState.x = reticleState.y = 50;
      }
      reticleState.blocked = muzzleBlocked;
      reticleState.target = reticleHitKind(muzzleHit || cameraHit);
      cross.classList.toggle("hot", !muzzleBlocked && (!!aim || reticleDamageable(muzzleHit)));
      cross.classList.toggle("blocked", muzzleBlocked);
      cross.classList.toggle("dry", armed() && fps.ammo <= 0);
      cross.classList.toggle("locked", !!lockTarget);   // soft aim-lock is tracking someone
    }
  });

  // keep ammo HUD honest if you pick up the gun mid-FPS
  CBZ.onUpdate(53, setAmmoHud);
})();
