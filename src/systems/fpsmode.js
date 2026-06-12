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
  const MELEE = 2.7;
  const BODY_R = 0.85;

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
  const UP = new THREE.Vector3(0, 1, 0);
  const ray = new THREE.Raycaster();
  const wallQ = new THREE.Quaternion();   // rocket impacts: raycast face normal → world

  function weaponIdOf(i) { return WEAPONS[i] && (WEAPONS[i].id || WEAPONS[i].key); }
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
  function armed() {
    return availableIndices().length > 0 && !(CBZ.game.mode === "city" && CBZ.game.cityMeleeWeapon);
  }
  function shoulderActive() { return !fps.active && armed() && CBZ.game.state === "playing"; }
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
    thudSfxOpts.pitch = Math.max(0.6, 1.18 - cal * 0.3) * (0.95 + Math.random() * 0.1);  // heavier round = deeper smack
    thudSfxOpts.volume = 0.35 + cal * 0.4;
    thudSfxOpts.dist = dist;
    thudSfxOpts.far = false;
    CBZ.sfx(name, thudSfxOpts);
  }

  function syncAmmo() {
    const w = weapon();
    fps.ammo = fps.rounds[fps.weapon];
    fps.mag = w.mag;
    fps.reserve = fps.reserves[fps.weapon];
  }

  function resetWeapons() {
    fps.weapon = CBZ.currentWeaponId ? Math.max(0, weaponIndex(CBZ.currentWeaponId)) : 0;
    normalizeWeapon();
    fps.rounds = WEAPONS.map((w) => w.mag);
    fps.reserves = WEAPONS.map((w) => w.reserve);
    fps.reloading = 0;
    shotCD = 0;
    dryCD = 0;
    triggerHeld = false;
    recoil = 0; recoilSide = 0; bloom = 0; recoilHold = 0;
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
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * cone;
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
        obj.material.depthTest = false;
        obj.material.depthWrite = false;
      }
    });
    weaponModels.push(viewModel);
    gun.add(viewModel);

    const carried = buildWeaponModel(w);
    if (!carried.userData.muzzle) carried.userData.muzzle = new THREE.Vector3(0, 0.05, -0.58);
    carried.visible = i === 0;
    carried.scale.setScalar(1.05);
    carriedModels.push(carried);
    carriedGun.add(carried);
  });
  carriedGun.position.set(0.02, 0.02, 0.03);
  carriedGun.rotation.set(0.02, Math.PI, 0);
  carriedGun.visible = false;
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
      obj.material.depthTest = false;
      obj.material.depthWrite = false;
    }
  });
  vm.position.set(0.36, -0.34, -0.72);

  let recoil = 0, recoilSide = 0, vmPunch = 0, bobPhase = 0, muzzleT = 0, worldMuzzleT = 0, pumpT = 0;
  let punchT = 0;
  // BLOOM: an extra spread term (radians) that GROWS while moving + auto-firing
  // and TIGHTENS back toward the weapon's base cone when you stand still. This
  // is the "fire discipline" reward — tap or hold still for laser shots, run-
  // and-gun and the cone opens up. recoilHold delays recoil recovery slightly
  // for a snappier kick-then-settle (instead of an instant rubber-band).
  let bloom = 0, recoilHold = 0;
  const PUNCH_DUR = 0.26;
  let shotCD = 0, dryCD = 0, triggerHeld = false, reloadWeapon = 0;
  // reusable per-shot sfx options (no per-shot allocation at auto-fire rates):
  // heavy guns (AK) re-pitch a shared sample DOWN for a deeper bark — same
  // audio file, different character, zero new assets.
  const shotSfxOpts = { pitch: 1, volume: 1 };

  function triggerFistPunch() {
    punchT = PUNCH_DUR;
    vmPunch = 0.5;                    // small viewmodel kick
    CBZ.sfx && CBZ.sfx("whoosh");
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

  function spawnImpact(pos, blood, big) {
    const p = impacts[impactIdx];
    impactIdx = (impactIdx + 1) % impacts.length;
    p.mesh.material.map = blood ? dustTex : sparkTex;
    p.mesh.material.blending = blood ? THREE.NormalBlending : THREE.AdditiveBlending;
    p.mesh.position.copy(pos);
    p.mesh.scale.setScalar(big ? 1.1 : 0.62);
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
    c.vel.copy(right).multiplyScalar(2.4 + Math.random() * 1.2)
      .addScaledVector(aimUp, 1.0 + Math.random() * 0.9)
      .addScaledVector(fwd, -0.25 + Math.random() * 0.25);
    c.mesh.rotation.set(Math.random() * 4, Math.random() * 4, Math.random() * 4);
    c.mesh.visible = true;
    c.life = 1.5;
    if (CBZ.sfx && w.key !== "carbine") setTimeout(() => CBZ.sfx("shell"), 90 + Math.random() * 80);
  }

  // The bullet ORIGIN must stay pinned to the GUN, not swing with recoil. The
  // viewmodel kicks up AND rolls sideways under sustained fire, and with the
  // barrel tip ~2m out on that pivot the muzzle socket flings far up + left after
  // the first burst — so tracers streak out of your head / two feet to your left.
  // The first burst looks perfect because recoil is zero; the fix is to BOUND the
  // origin to a tight gun-region BOX in camera space, so the clean rest-pose
  // values pass through untouched but recoil drift is clamped to the box edge.
  // The gun model + muzzle FLASH still climb (they read the raw socket); only the
  // world bullet/tracer/casing origin is held steady.
  const _muzM = new THREE.Matrix4();
  // camera-space bounds: down-and-right of the lens, out in front, never at the eye.
  // FIRST-PERSON ONLY — this box is "the gun region" solely when the camera IS the
  // shooter's eye. The shoulder cam clamps to the gun HAND instead (see below).
  // WIDE enough that every healthy rest pose passes through UNTOUCHED — the
  // old box (up max -0.16, right max 0.62) was tighter than the current
  // viewmodels' real barrel tips, so the clamp engaged at REST and shifted the
  // bullet origin up-left of the visible muzzle (user-filmed ~cm overlap).
  // Recoil drift this box exists for flings way beyond these bounds.
  const MUZ_UP = [-1.05, -0.1], MUZ_RIGHT = [0.04, 0.9], MUZ_FWD = [0.45, 3.2];
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clampMuzzleBelowEye(out) {
    const cam = CBZ.camera; if (!cam) return out;
    if (cam.updateWorldMatrix) cam.updateWorldMatrix(true, false);
    const e = _muzM.extractRotation(cam.matrixWorld).elements;
    const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6], fx = -e[8], fy = -e[9], fz = -e[10];
    const dx = out.x - cam.position.x, dy = out.y - cam.position.y, dz = out.z - cam.position.z;
    const f = clamp(dx * fx + dy * fy + dz * fz, MUZ_FWD[0], MUZ_FWD[1]);
    const u = clamp(dx * ux + dy * uy + dz * uz, MUZ_UP[0], MUZ_UP[1]);
    const r = clamp(dx * rx + dy * ry + dz * rz, MUZ_RIGHT[0], MUZ_RIGHT[1]);
    return out.set(
      cam.position.x + fx * f + ux * u + rx * r,
      cam.position.y + fy * f + uy * u + ry * r,
      cam.position.z + fz * f + uz * u + rz * r);
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
    const r = model.userData.muzzle.length() * sc + 0.5;  // bazooka 1.4*1.05 ≈ 1.47 still passes
    const d = out.distanceTo(_handPos);
    if (d > r) out.sub(_handPos).multiplyScalar(r / d).add(_handPos);
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

  // ---- HUD ----
  const cross = document.getElementById("crosshair");
  const ammoEl = document.getElementById("ammo");
  const stripEl = document.getElementById("weaponStrip");

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
      const top = fps.reloading > 0 ? "RELOADING " + w.short : w.label;
      ammoEl.textContent = top + "\n" + fps.ammo + " / " + fps.mag + "   RES " + fps.reserve;
    } else ammoEl.style.display = "none";
    setWeaponStrip();
  }

  function setWeaponStrip() {
    if (!stripEl) return;
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
    const hits = ray.intersectObjects(CBZ.losBlockers, false);
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
  const HEAD_Y = 2.12, TORSO_Y = 1.42, LEG_Y = 0.66;

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

  function findActorHit(origin, dir, maxT, w) {
    // generous-but-fair aim assist (bigger from the third-person shoulder cam)
    const headAssist = shoulderActive() ? 0.22 : (fps.active ? 0.13 : 0);
    const bodyAssist = shoulderActive() ? 0.40 : (fps.active ? 0.16 : 0);
    const hr = (w.headRadius || 0.33) + headAssist;
    const br = (w.bodyRadius || BODY_R) + bodyAssist;
    let bestActor = null, bestDist = maxT, bestHead = false;
    const scan = function (list) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || a.dead || a.ko > 0 || a.escaped || !a.group || a.group.visible === false) continue;
        const gp = a.group.position, gy = gp.y || 0;
        // HEAD first — small high sphere, takes priority
        const hd = sphereEntry(origin, dir, gp.x, gy + HEAD_Y, gp.z, hr, maxT);
        if (hd >= 0 && hd < bestDist) { bestActor = a; bestDist = hd; bestHead = true; continue; }
        // BODY — torso + legs spheres
        const td = sphereEntry(origin, dir, gp.x, gy + TORSO_Y, gp.z, br, maxT);
        const ld = sphereEntry(origin, dir, gp.x, gy + LEG_Y, gp.z, br * 0.82, maxT);
        let bd = Math.min(td < 0 ? Infinity : td, ld < 0 ? Infinity : ld);
        if (bd < bestDist) { bestActor = a; bestDist = bd; bestHead = false; }
      }
    };
    if (CBZ.game.mode === "city") { scan(CBZ.cityPeds); scan(CBZ.cityCops); if (CBZ.cityMedics) scan(CBZ.cityMedics); }   // same gun, city targets
    else { scan(CBZ.guards); scan(CBZ.npcs); }
    // multiplayer: remote player avatars + host-synced puppet NPCs are real targets
    if (CBZ.net && CBZ.net.active && CBZ.net.targetList) scan(CBZ.net.targetList());
    // the ambient instanced crowd is also a valid target (so you can shoot ANYONE,
    // not just the few promoted peds). It competes on distance → real occlusion.
    let crowdIdx = -1;
    if (CBZ.game.mode === "city" && CBZ.cityCrowdRayHit) {
      const ch = CBZ.cityCrowdRayHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, bestDist, hr, br);
      if (ch) { bestActor = null; crowdIdx = ch.i; bestDist = ch.dist; bestHead = ch.head; }
    }
    if (!bestActor && crowdIdx < 0) return null;
    return { actor: bestActor, crowd: crowdIdx >= 0 ? crowdIdx : null, dist: bestDist, head: bestHead, point: origin.clone().addScaledVector(dir, bestDist) };
  }

  function resolveShot(w, dir) {
    eye.copy(CBZ.camera.position);
    const wall = wallDistance(eye, dir, w.range);
    let maxT = wall ? Math.max(0.1, wall.distance - 0.04) : w.range;
    // CARS are hard cover AND targets: the nearest car along the ray clamps the
    // search so a ped ducked behind a sedan is safe — the panel eats the round.
    const carHit = findCarHit(eye, dir, maxT);
    if (carHit) maxT = Math.max(0.1, carHit.dist - 0.04);
    const hit = findActorHit(eye, dir, maxT, w);
    // the police gunship overhead is a valid target — ray-test it (no damage here;
    // the shoot loop / rocket splash applies it) and take it if it's the nearest.
    const air = (CBZ.game.mode === "city" && CBZ.cityAircraftRayTest) ? CBZ.cityAircraftRayTest(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxT) : null;
    if (hit && (!air || hit.dist <= air.dist)) return hit;
    if (air) return { actor: null, aircraft: true, dist: air.dist, point: new THREE.Vector3(air.x, air.y, air.z) };
    if (carHit) return { actor: null, car: carHit.car, normal: carHit.normal, dist: carHit.dist, point: eye.clone().addScaledVector(dir, carHit.dist) };
    return {
      actor: null,
      wall: !!wall,
      wallHit: wall || null,   // raw raycast hit (face/object) — rockets stamp the struck face
      dist: wall ? wall.distance : w.range,
      point: wall ? wall.point.clone() : eye.clone().addScaledVector(dir, w.range),
    };
  }

  function aimedActor(maxRange) {
    aimForward(fwd);
    const p = CBZ.player;
    if (shoulderActive()) eye.copy(CBZ.camera.position);
    else eye.set(p.pos.x, p.pos.y + (p.crouch ? 1.45 : 2.05), p.pos.z);
    const w = armed() ? weapon() : { range: maxRange, bodyRadius: BODY_R, headRadius: 0.32 };
    const wall = wallDistance(eye, fwd, maxRange);
    return findActorHit(eye, fwd, wall ? Math.max(0.1, wall.distance - 0.04) : maxRange, w);
  }

  // ---- damage ----
  // CITY mode reuses this exact hitscan but routes the hit into the city's own
  // death/loot/crime systems (cops, gangs, wanted) instead of the prison AI.
  function cityGunHit(a, hit, w) {
    // multiplayer target (remote player or synced puppet): authority is over the
    // wire — net code routes the damage and plays the local juice.
    if (a.netKind && CBZ.net && CBZ.net.localGunHit) return CBZ.net.localGunHit(a, hit, w);
    const fall = hit.dist <= w.dropStart ? 1
      : Math.max(w.minDamage, 1 - ((hit.dist - w.dropStart) / Math.max(1, w.range - w.dropStart)) * (1 - w.minDamage));
    const dmg = Math.max(1, Math.round(w.damage * (hit.head ? w.headMult : 1) * fall));
    const lethalHead = hit.head && !w.nonlethal;
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    if (a.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(a.gang, 0.4);
    let down = false;
    if (a.kind === "cop") {
      CBZ.cityHurtCop && CBZ.cityHurtCop(a, lethalHead ? 9999 : dmg, { fromX: fx, fromZ: fz });
      down = !!a.dead;
    } else if (w.nonlethal) {
      CBZ.cityKOPed && CBZ.cityKOPed(a, fx, fz); down = true;       // taser → KO
    } else {
      if (lethalHead) a.hp = 0; else a.hp -= dmg;
      if (a.hp <= 0) { CBZ.cityKillPed && CBZ.cityKillPed(a, { fromX: fx, fromZ: fz, force: 6, fling: 3, cal: caliber(w), wkey: w.key, dist: hit.dist, point: hit.point }, hit.head ? "headshot" : "shot"); down = true; }
      else {
        CBZ.cityAlarm && CBZ.cityAlarm(a.pos.x, a.pos.z, 16, 1, CBZ.city.playerActor);
        CBZ.body && CBZ.body.hit(a, { fromX: fx, fromZ: fz, force: (hit.head ? 6.5 : 4.5) * (0.6 + 0.45 * caliber(w)) });
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

  function gunHit(hit, w) {
    const a = hit.actor;
    if (CBZ.game.mode === "city") return cityGunHit(a, hit, w);
    const guardish = a.kind === "guard" || a.kind === "warden";
    if (a.hp == null) a.hp = maxHpOf(a);
    const fall = hit.dist <= w.dropStart
      ? 1
      : Math.max(w.minDamage, 1 - ((hit.dist - w.dropStart) / Math.max(1, w.range - w.dropStart)) * (1 - w.minDamage));
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
    if (reloadWeapon !== fps.weapon) { fps.reloading = 0; syncAmmo(); setAmmoHud(); return; }

    if (w.shellReload) {
      if (fps.rounds[reloadWeapon] < w.mag && fps.reserves[reloadWeapon] > 0) {
        fps.rounds[reloadWeapon]++;
        fps.reserves[reloadWeapon]--;
        CBZ.sfx && CBZ.sfx("shell");
      }
      if (fps.rounds[reloadWeapon] < w.mag && fps.reserves[reloadWeapon] > 0 && !triggerHeld) {
        fps.reloading = w.reload;
      } else {
        fps.reloading = 0;
        CBZ.sfx && CBZ.sfx("rack");
      }
      syncAmmo();
      setAmmoHud();
      return;
    }

    const need = w.mag - fps.rounds[reloadWeapon];
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
    if (fps.reloading > 0 || fps.rounds[fps.weapon] >= w.mag || fps.reserves[fps.weapon] <= 0) return;
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
    if (!(fps.active || shoulderActive()) || CBZ.game.state !== "playing" || CBZ.player.dead || (CBZ.player.stun || 0) > 0 || CBZ.player.driving) return;
    if (!armed()) {
      if (CBZ.game.mode === "city") return;   // city/combat.js owns unarmed melee in the city
      const hit = aimedActor(MELEE);
      triggerFistPunch();
      if (CBZ.punch) { const r = CBZ.punch(hit && hit.actor); if (r && r.msg) CBZ.flashHint(r.msg, 2.4); }
      else CBZ.sfx && CBZ.sfx("step");
      return;
    }

    const w = weapon();
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

    const RK = 0.45;  // global recoil dampener — the guns were kicking too hard
    recoil = Math.min(w.maxRecoil, recoil + w.recoil * RK);
    recoilSide += (Math.random() * 2 - 1) * w.sideKick * RK;
    recoilHold = 0.06;   // brief hold before recovery kicks in (snappy kick → settle)
    // each shot pumps bloom; auto fire stacks fast, single shots barely at all.
    // capped so even mag-dumps stay usable. moving adds extra below in the loop.
    bloom = Math.min(w.spread * 2.6, bloom + w.spread * (w.auto ? 0.9 : 0.45));
    if (fps.active) fps.fp = Math.min(1.3, fps.fp + (w.climb + Math.random() * w.climb * 0.45) * RK);
    else CBZ.cam.pitch = Math.min(1.15, CBZ.cam.pitch + w.climb * 0.36 * RK);
    CBZ.cam.yaw += (Math.random() * 2 - 1) * w.sideKick * 0.55 * RK;
    pumpT = w.pump ? 1 : pumpT;

    const flashScale = w.flash * (0.9 + Math.random() * 0.28);
    if (fps.active) {
      const activeModel = weaponModels[fps.weapon];
      if (!setMuzzleSpriteFromModel(muzzle, activeModel)) muzzle.position.copy(activeModel.userData.muzzle);
      muzzle.scale.setScalar(flashScale);
      muzzle.rotation.z = Math.random() * Math.PI * 2;
      muzzle.visible = true;
      muzzleT = w.key === "shotgun" ? 0.065 : 0.04;
    } else {
      worldMuzzle.position.copy(muzzleWorld(tmp2));
      worldMuzzle.scale.setScalar(flashScale * 1.2);
      worldMuzzle.material.opacity = 1;
      worldMuzzle.visible = true;
      worldMuzzleT = w.key === "shotgun" ? 0.065 : 0.04;
    }

    if (CBZ.sfx) {
      if (w.sfxPitch || w.sfxVol) {
        shotSfxOpts.pitch = (w.sfxPitch || 1) * (0.96 + Math.random() * 0.08);  // jitter so bursts don't sound machine-stamped
        shotSfxOpts.volume = w.sfxVol || 1;
        CBZ.sfx(w.sfx || "shoot", shotSfxOpts);
      } else CBZ.sfx(w.sfx || "shoot");
    }
    CBZ.shake && CBZ.shake(w.shake);
    CBZ.doHitstop && CBZ.doHitstop(w.key === "shotgun" ? 0.028 : 0.014);
    if (CBZ.game.mode !== "city") CBZ.reportCrime && CBZ.reportCrime(w.heat, { type: w.nonlethal ? "taser" : "gunfire", actorRole: CBZ.game.role, weapon: w.key });
    ejectCasing(w);

    const origin = muzzleWorld(tmp2);
    aimForward(fwd);
    if (CBZ.net && CBZ.net.active && CBZ.net.onShot) CBZ.net.onShot(origin, fwd, w);

    // EXPLOSIVE (RPG/bazooka): a hitscan-to-impact rocket. Resolve where the
    // shot lands, draw a tracer there, then detonate via the city explosion +
    // glass-shatter systems (CITY-ONLY — escape/survival never see these). The
    // BLAST is the kill, so we skip the normal per-pellet damage loop entirely.
    if (w.explosive) {
      const MIN_DET = 4;
      const hit = resolveShot(w, fwd);   // sets `eye` to the camera; resolves wall/actor along fwd
      // Detonate at the NEAREST of: what the ray HIT (wall/NPC), where it crosses
      // the STREET, or max range. The ground-crossing is the key "far-away" fix —
      // a rocket aimed down a block at distant targets used to fly OVER them (their
      // rigs LOD-culled, so findActorHit missed) and pop in empty air at max range.
      // Now it lands ON the street among them, and the big blast radius does the rest.
      let detT = hit.point ? Math.max(0.1, hit.dist || w.range) : w.range;
      if (fwd.y < -0.01) { const gt = (0 - eye.y) / fwd.y; if (gt > 0 && gt < detT) detT = gt; }  // ground (street ≈ y0)
      detT = Math.max(MIN_DET, Math.min(detT, w.range));   // never on the shooter, never past range
      const pt = eye.clone().addScaledVector(fwd, detT);
      fireTracer(origin, pt, w.tracer, 0.07);
      if (CBZ.game.mode === "city") {
        const groundHit = pt.y < 3.5;   // the blast actually couples to the street
        // the fireball/smoke/damage bloom AT the impact height — a tower hit
        // 30u up no longer pops at the kerb below it (crashfx reads opts.y)
        if (CBZ.cityExplosion) CBZ.cityExplosion(pt.x, pt.z, { power: w.blastPower || 1.4, radius: w.blastRadius || 7, byPlayer: true, y: pt.y });
        // wreck the storefront HARD — shatter a wide radius of glass (was +2)
        if (CBZ.cityShatter) CBZ.cityShatter(pt.x, pt.z, (w.blastRadius || 7) + 8);
        if (groundHit && CBZ.cityScorch) CBZ.cityScorch(pt.x, pt.z, (w.blastRadius || 7) * 0.6);   // big scorch on the building/ground
        // a DIRECT hit on a ground-floor wall blasts a real, WALKABLE hole through
        // it (blastRadius 13 → r≈3.6, a satisfying car-sized breach you can run in)
        if (groundHit && CBZ.cityBreach) CBZ.cityBreach(pt.x, pt.z, (w.blastRadius || 7) * 0.28);
        // detonated ON a building face → the facade REACTS (crashfx): blackened
        // blast scar on the wall, debris avalanche pouring down the facade, a
        // lingering smoke column from the wound, a parapet block near the roof-
        // line. Composes WITH the ground breach on a ground-floor wall hit.
        if (hit.wall && hit.wallHit && hit.dist <= detT + 0.6 && CBZ.cityBlastWall) {
          // wall-face normal: the raycast's struck face rotated to world (the
          // exact face-entry normal, same idea as findCarHit's AABB slabs);
          // falls back to the reflected horizontal shot direction.
          shotDir.set(-fwd.x, 0, -fwd.z);
          if (shotDir.lengthSq() < 1e-6) shotDir.set(0, 1, 0); else shotDir.normalize();
          const wf = hit.wallHit.face, wo = hit.wallHit.object;
          if (wf && wo && wo.getWorldQuaternion) {
            tmp.copy(wf.normal).applyQuaternion(wo.getWorldQuaternion(wallQ));
            if (tmp.lengthSq() > 0.25) {
              if (tmp.dot(fwd) > 0) tmp.multiplyScalar(-1);   // always face the shooter
              shotDir.copy(tmp.normalize());
            }
          }
          // MIN_DET can push pt past a point-blank wall — stamp at the wall point
          CBZ.cityBlastWall(hit.dist < detT - 0.05 ? hit.point : pt, shotDir, { power: w.blastPower || 1.4 });
        }
        // a rocket that lands on/near the gunship nearly halves it (≈2 rockets kill)
        if (CBZ.cityAircraftSplash) CBZ.cityAircraftSplash(pt.x, pt.y, pt.z, (w.blastRadius || 7) + 4, 90);
      }
      // kick scales with how close the blast is to the lens — a rocket at your
      // feet rattles, one parked 100u up a tower rumbles (crashfx attenuates
      // its own explosion shake the same way)
      const camD = CBZ.camera ? CBZ.camera.position.distanceTo(pt) : 0;
      CBZ.shake && CBZ.shake(((w.shake || 1) + 0.6) * Math.max(0.3, Math.min(1, 1.25 - camD / 130)));
      CBZ.doHitstop && CBZ.doHitstop(0.05);
      // firing still raises wanted: replicate the witnessed-crime block below so
      // launching a rocket is at least as loud as discharging a firearm.
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
    const moving = CBZ.player.grounded === false ? 0.6 : Math.min(1, (CBZ.player.speed || 0) / 6);
    // per-weapon movement penalty: heavy rifles (AK moveSpread 2.3) punish
    // run-and-gun harder than the 1.4 default — plant your feet for the payoff.
    const moveBloom = w.spread * moving * (w.moveSpread || 1.4);
    const cone = w.spread * (1 + recoil * 0.18) + bloom + moveBloom;
    const cal = caliber(w);   // round weight, threaded into every surface impact below
    let head = false, down = false, hitSomething = false;
    let wallThudDist = -1, carThudDist = -1;   // one thud per trigger pull, not per pellet
    for (let i = 0; i < pellets; i++) {
      spreadDir(fwd, cone, shotDir);
      const hit = resolveShot(w, shotDir);
      const end = hit.point || eye.clone().addScaledVector(shotDir, w.range);
      if (i < 5 || pellets === 1) fireTracer(origin, end, w.tracer, w.key === "shotgun" ? 0.045 : 0.055);
      // city: a window in this pellet's path shatters (glass never blocks the
      // shot) — but CALIBER decides REACH: a rifle slug still carries pane-
      // breaking energy across the block, a 9mm/SMG round only up close.
      if (CBZ.game.mode === "city" && CBZ.cityShatterRay) {
        const reach = hit.dist != null ? hit.dist + 0.5 : w.range;
        CBZ.cityShatterRay(origin.x, origin.y, origin.z, shotDir.x, shotDir.y, shotDir.z,
          heavyRound(w) ? reach : Math.min(reach, GLASS_PISTOL_REACH), true);
      }
      if (hit.actor) {
        hitSomething = true;
        const r = gunHit(hit, w);
        head = head || r.head;
        down = down || r.down;
        spawnImpact(hit.point, true, w.key === "shotgun");
        // a real wet blood puff on flesh (the survival gore kit) — directional,
        // sprayed away from the shooter along the bullet path.
        if (CBZ.gore) CBZ.gore(hit.point.x, hit.point.y, hit.point.z, {
          dir: shotDir, amount: (r.head ? 1.4 : 0.8) * (w.key === "shotgun" ? 1.5 : 1), player: true,
        });
        // the body CARRIES the hit: a dark entry wound stamped on the struck
        // part + blood soaking into the clothing (systems/wounds.js). Per
        // pellet — a shotgun blast scatters wounds (wounds.js caps the burst).
        if (CBZ.bodyWound && !w.nonlethal) CBZ.bodyWound(hit.actor, hit.point, { head: hit.head, cal });
      } else if (hit.crowd != null) {
        // shot an ambient crowd member (the far NPCs that used to be unkillable)
        hitSomething = true;
        if (!w.nonlethal && CBZ.cityCrowdKill) { CBZ.cityCrowdKill(hit.crowd, { head: hit.head, fromX: origin.x, fromZ: origin.z }); down = true; }
        head = head || hit.head;
        spawnImpact(hit.point, true, w.key === "shotgun");
        if (CBZ.gore) CBZ.gore(hit.point.x, hit.point.y, hit.point.z, { dir: shotDir, amount: hit.head ? 1.2 : 0.7, player: true });
      } else if (hit.aircraft) {
        // bullets chip the gunship — sparks off the hull, damage routed to the heli
        hitSomething = true;
        if (CBZ.cityAircraftDamage) CBZ.cityAircraftDamage(w.damage, origin.x, origin.z);
        spawnImpact(hit.point, false, true);
        if (CBZ.bulletImpact) CBZ.bulletImpact(hit.point, { x: -shotDir.x, y: 0.4, z: -shotDir.z }, { kind: "spark", power: 1.3 });
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
      } else if (hit.wall) {
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
            if (CBZ.cityChunk && Math.random() < (cal - 1.1) * 0.45) CBZ.cityChunk(hit.point.x, hit.point.y, hit.point.z, { count: 1, force: 1.6 });
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
      }
    }
    // impact THUD by caliber — a 7.62 lands a deeper, louder smack on whatever
    // it chewed (concrete thud / car-panel clank). Once per trigger pull, and
    // never over the flesh-hit foley below.
    if (carThudDist >= 0) surfaceThud("clank", cal, carThudDist);
    else if (wallThudDist >= 0 && !hitSomething) surfaceThud("hit", cal, wallThudDist);
    // HIT MARKER: one flash per trigger pull that connected. Kills paint it red.
    if (hitSomething) flashHitMarker(down, head);
    // (no "HEADSHOT"/"TARGET DOWN" text — the red hit marker, gore and foley own the kill)
    if (head) { CBZ.sfx && CBZ.sfx("headshot"); }
    else if (hitSomething) { CBZ.sfx && CBZ.sfx("hit"); }
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
  // number-key hotbar in CITY (jail keeps its own stash-hotbar in inventory.js).
  // Gated so it never fires while a menu/map is up or you're typing in a panel.
  addEventListener("keydown", function (e) {
    if (e.repeat || CBZ.game.mode !== "city" || CBZ.game.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.fullMap && CBZ.fullMap.active)) return;
    const n = "123456789".indexOf(e.key);
    if (n >= 0 && armed()) { if (selectWeaponSlot(n)) e.preventDefault(); }
  });

  function setActive(on) {
    fps.active = on;
    if (CBZ.playerChar) CBZ.playerChar.group.visible = !on;
    vm.visible = on;
    if (cross) cross.style.display = on && CBZ.game.state === "playing" ? "block" : "none";
    document.body.classList.toggle("fps", on);
    setAmmoHud();
    if (on && fps.fp === 0) fps.fp = 0.06;
    if (!on) triggerHeld = false;
  }

  CBZ.toggleFPS = function () { setActive(!fps.active); };
  CBZ.setFPS = function (on) { setActive(!!on); };
  CBZ.armFPSAfterIntro = function () {
    introWantsFPS = true;
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
    fps.fp = Math.max(-1.3, Math.min(1.3, fps.fp - e.movementY * SENS));
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
  addEventListener("wheel", (e) => {
    if (!(fps.active || shoulderActive()) || !armed()) return;
    e.preventDefault();
    switchWeapon(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "v" && CBZ.game.mode !== "city") CBZ.toggleFPS();   // city owns [V] via city/view.js
    else if (k === "r" && (fps.active || shoulderActive())) reload();
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
      resetWeapons();
      // a fresh run starts on unmarked streets — wipe last run's bullet pocks
      // and rocket scars/smoking wounds
      if (CBZ.bulletHolesReset) CBZ.bulletHolesReset();
      if (CBZ.cityBlastFxReset) CBZ.cityBlastFxReset();
      shudders.length = 0;
    }
    lastElapsed = el;
  }

  // ---- camera override and effects update ----
  CBZ.onAlways(52, function (dt) {
    checkReset();
    const aiming = fps.active || shoulderActive();
    if (cross) cross.style.display = (aiming && CBZ.game.state === "playing") ? "block" : "none";

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

    if (!aiming) {
      carriedGun.visible = false;
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
      const eyeH = p.crouch ? 1.45 : 2.05;
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
      // bleed the upward climb back toward neutral so sustained fire recenters
      if (fps.active) fps.fp += (0 - fps.fp) * (1 - Math.pow(0.55, dt)) * Math.min(1, recoil * 4 + 0.15);
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
      if (armed()) {
        // Sustained-fire climb is kept SMALL on purpose: the bullet origin is
        // clamped to a tight camera-space box (muzzleWorld), so if the visible
        // barrel pivots far under recoil, tracers visibly stop leaving the gun.
        // The per-shot KICK reads through vmPunch (snappy, decays in ~0.1s);
        // the accumulated recoil only nudges. Kick feel without the detach.
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
      carriedGun.visible = armed();
      const longGun = w.slot === "long" || w.slot === "rifle" || w.slot === "auto";
      const util = w.slot === "utility";
      // Two carry stances: a relaxed LOW-READY (gun lowered and tucked to
      // the side so it never juts through the chest when viewed from
      // behind) and a raised AIM pose. We only raise when actually aiming
      // (RMB), firing, or while recoil is settling — so by default the
      // convict just carries the weapon instead of permanently pointing it.
      // ALWAYS hold the gun forward-ready (pointed where the crosshair is) — no
      // need to ADS/zoom to point it. RMB still zooms for those who want it, but
      // the pose no longer drops to a lowered idle. Put it away by switching slots.
      const aim = true;
      // gun sits a touch lower / tilted down when at the ready
      carriedGun.position.set(
        (longGun ? 0.04 : 0.00) + recoilSide * 0.18,
        (aim ? (longGun ? -0.02 : -0.05) : -0.12) - reloadDip * 0.16,
        (aim ? (longGun ? 0.18 : (util ? 0.04 : 0.10)) : 0.02) - recoil * 0.07
      );
      carriedGun.rotation.set(
        (aim ? 0.03 : 0.42) + recoil * 0.12 + reloadDip * 0.22,
        Math.PI - 0.04,
        -0.03 + recoilSide * 0.75
      );
      if (CBZ.playerChar) {
        const yaw = Math.atan2(-Math.sin(CBZ.cam.yaw), -Math.cos(CBZ.cam.yaw));
        CBZ.playerChar.group.rotation.y = CBZ.lerpAngle(CBZ.playerChar.group.rotation.y, yaw, 1 - Math.pow(0.00008, dt));
        if (CBZ.playerChar.parts) {
          const ra = CBZ.playerChar.parts.ra, la = CBZ.playerChar.parts.la;
          if (ra) {
            ra.rotation.x = CBZ.damp(ra.rotation.x, (aim ? -1.32 : -0.46) - recoil * 0.14, 14, dt);
            ra.rotation.y = CBZ.damp(ra.rotation.y, (aim ? -0.18 : -0.05) + recoilSide * 0.22, 14, dt);
            ra.rotation.z = CBZ.damp(ra.rotation.z, aim ? -0.34 : -0.15, 14, dt);
            ra.position.z = CBZ.damp(ra.position.z, aim ? 0.14 : 0.04, 14, dt);
          }
          if (la) {
            la.rotation.x = CBZ.damp(la.rotation.x, aim ? (longGun ? -1.12 : -0.62) : -0.30, 13, dt);
            la.rotation.y = CBZ.damp(la.rotation.y, aim ? (longGun ? 0.34 : 0.12) : 0.06, 13, dt);
            la.rotation.z = CBZ.damp(la.rotation.z, aim ? (longGun ? 0.42 : 0.16) : 0.12, 13, dt);
            la.position.z = CBZ.damp(la.position.z, aim ? (longGun ? 0.24 : 0.08) : 0.03, 13, dt);
          }
        }
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
      // bloom accumulation and movement — so the crosshair HONESTLY shows where
      // shots will land (the AAA contract between reticle and spread).
      const mv = CBZ.player.grounded === false ? 0.6 : Math.min(1, (CBZ.player.speed || 0) / 6);
      const size = armed()
        ? 18 + w.spread * 280 + bloom * 300 + recoil * 34 + mv * 10 + (fps.reloading > 0 ? 8 : 0)
        : 22;
      cross.style.width = size.toFixed(1) + "px";
      cross.style.height = size.toFixed(1) + "px";
      cross.classList.toggle("hot", !!aim);
      cross.classList.toggle("dry", armed() && fps.ammo <= 0);
    }
  });

  // keep ammo HUD honest if you pick up the gun mid-FPS
  CBZ.onUpdate(53, setAmmoHud);
})();
