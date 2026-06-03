/* ============================================================
   systems/fpsmode.js - FIRST-PERSON MODE.

   The armory now unlocks a compact shooter loadout instead of one
   flat debug pistol: a sidearm, pump shotgun, and carbine with distinct
   magazines, reserve ammo, recoil, spread, fire cadence, tracers,
   impact puffs, shell ejection, reload behavior, and viewmodel motion.
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
  function armed() { return availableIndices().length > 0; }
  function shoulderActive() { return !fps.active && armed() && CBZ.game.state === "playing"; }
  function maxHpOf(a) { return (a.kind === "guard" || a.kind === "warden") ? 140 : 100; }

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
  const PUNCH_DUR = 0.26;
  let shotCD = 0, dryCD = 0, triggerHeld = false, reloadWeapon = 0;

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

  function muzzleWorld(out) {
    if (shoulderActive()) {
      const model = carriedModels[fps.weapon];
      if (model && model.userData.muzzle) {
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.updateMatrixWorld(true);
        model.updateMatrixWorld(true);
        return model.localToWorld(out.copy(model.userData.muzzle));
      }
    }
    if (fps.active) {
      const model = weaponModels[fps.weapon];
      if (model && model.userData.muzzle) {
        if (CBZ.camera) CBZ.camera.updateMatrixWorld(true);
        model.updateMatrixWorld(true);
        return model.localToWorld(out.copy(model.userData.muzzle));
      }
    }
    // last-resort fallback: drop it to GUN height/forward (down + out from the
    // eye) so a tracer never visibly streaks out of the player's head.
    forward(fwd); buildBasis(fwd);
    return out.copy(CBZ.camera.position)
      .addScaledVector(right, 0.18)
      .addScaledVector(aimUp, -0.34)
      .addScaledVector(fwd, 0.5);
  }

  function setMuzzleSpriteFromModel(sprite, model) {
    if (!model || !model.userData.muzzle) return false;
    if (CBZ.camera) CBZ.camera.updateMatrixWorld(true);
    model.updateMatrixWorld(true);
    gun.updateMatrixWorld(true);
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
    return hits.length ? hits[0] : null;
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
    if (CBZ.game.mode === "city") { scan(CBZ.cityPeds); scan(CBZ.cityCops); }   // same gun, city targets
    else { scan(CBZ.guards); scan(CBZ.npcs); }
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
    const maxT = wall ? Math.max(0.1, wall.distance - 0.04) : w.range;
    const hit = findActorHit(eye, dir, maxT, w);
    if (hit) return hit;
    return {
      actor: null,
      wall: !!wall,
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
      if (a.hp <= 0) { CBZ.cityKillPed && CBZ.cityKillPed(a, { fromX: fx, fromZ: fz, force: 6, fling: 3 }, hit.head ? "headshot" : "shot"); down = true; }
      else {
        CBZ.cityAlarm && CBZ.cityAlarm(a.pos.x, a.pos.z, 16, 1, CBZ.city.playerActor);
        CBZ.body && CBZ.body.hit(a, { fromX: fx, fromZ: fz, force: hit.head ? 6.5 : 4.5 });
        // getting shot provokes the same fight-or-flight an NPC bullet would
        const B = (CBZ.CITY && CBZ.CITY.aggro) || {};
        if (!a.rage) { if (a.aggr >= (B.bold || 0.5)) { a.rage = CBZ.city.playerActor; a.state = "fight"; } else { a.state = "flee"; a.alarmed = Math.max(a.alarmed || 0, 6); } }
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

    const RK = 0.6;   // global recoil dampener — the guns were kicking too hard
    recoil = Math.min(w.maxRecoil, recoil + w.recoil * RK);
    recoilSide += (Math.random() * 2 - 1) * w.sideKick * RK;
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

    CBZ.sfx && CBZ.sfx(w.sfx || "shoot");
    CBZ.shake && CBZ.shake(w.shake);
    CBZ.doHitstop && CBZ.doHitstop(w.key === "shotgun" ? 0.028 : 0.014);
    if (CBZ.game.mode !== "city") CBZ.reportCrime && CBZ.reportCrime(w.heat, { type: w.nonlethal ? "taser" : "gunfire", actorRole: CBZ.game.role, weapon: w.key });
    ejectCasing(w);

    const origin = muzzleWorld(tmp2);
    aimForward(fwd);
    const pellets = w.pellets || 1;
    let head = false, down = false, hitSomething = false;
    for (let i = 0; i < pellets; i++) {
      spreadDir(fwd, w.spread * (1 + recoil * 0.18), shotDir);
      const hit = resolveShot(w, shotDir);
      const end = hit.point || eye.clone().addScaledVector(shotDir, w.range);
      if (i < 5 || pellets === 1) fireTracer(origin, end, w.tracer, w.key === "shotgun" ? 0.045 : 0.055);
      // city: a window anywhere in this pellet's path shatters (glass never blocks the shot)
      if (CBZ.game.mode === "city" && CBZ.cityShatterRay) {
        CBZ.cityShatterRay(origin.x, origin.y, origin.z, shotDir.x, shotDir.y, shotDir.z, hit.dist != null ? hit.dist + 0.5 : w.range);
      }
      if (hit.actor) {
        hitSomething = true;
        const r = gunHit(hit, w);
        head = head || r.head;
        down = down || r.down;
        spawnImpact(hit.point, true, w.key === "shotgun");
      } else if (hit.crowd != null) {
        // shot an ambient crowd member (the far NPCs that used to be unkillable)
        hitSomething = true;
        if (!w.nonlethal && CBZ.cityCrowdKill) { CBZ.cityCrowdKill(hit.crowd, { head: hit.head, fromX: origin.x, fromZ: origin.z }); down = true; }
        head = head || hit.head;
        spawnImpact(hit.point, true, w.key === "shotgun");
      } else if (hit.wall) {
        spawnImpact(hit.point, false, w.key === "shotgun");
      }
    }
    if (head) { CBZ.sfx && CBZ.sfx("headshot"); if (CBZ.flashHint) CBZ.flashHint(down ? "HEADSHOT KILL" : "HEADSHOT", 1.0); }
    else if (hitSomething) { CBZ.sfx && CBZ.sfx("hit"); if (down && CBZ.flashHint) CBZ.flashHint("TARGET DOWN", 0.9); }
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
    shotCD = Math.min(shotCD, 0.08);
    syncAmmo();
    weaponModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    carriedModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    muzzle.position.copy(weaponModels[fps.weapon].userData.muzzle);
    CBZ.sfx && CBZ.sfx("switch");
    CBZ.flashHint && CBZ.flashHint(weapon().label, 0.85);
    setAmmoHud();
  }

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
    // Auto-drop into FIRST-PERSON the moment you actually pick up a gun in
    // third person — FPS-with-a-gun is the intended way to shoot. Only on a
    // brand-new acquisition (first), only mid-play, never in survival.
    if (first && !fps.active && CBZ.game.state === "playing" && CBZ.game.mode !== "survival" && CBZ.game.mode !== "city") {
      setActive(true);
      fps.fp = Math.max(fps.fp, 0.06);
      CBZ.flashHint && CBZ.flashHint("🔫 Weapon up — first-person", 1.4);
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

    if (worldMuzzleT > 0) {
      worldMuzzleT -= dt;
      worldMuzzle.material.opacity = Math.max(0, worldMuzzleT / 0.065);
      if (worldMuzzleT <= 0) worldMuzzle.visible = false;
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
    if (triggerHeld && weapon().auto) shoot();

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

    recoil += (0 - recoil) * Math.min(1, 11 * dt);
    recoilSide += (0 - recoilSide) * Math.min(1, 10 * dt);
    vmPunch += (0 - vmPunch) * Math.min(1, 10 * dt);
    pumpT = Math.max(0, pumpT - dt * 4.5);

    if (!armed()) animFists(dt);

    const w = weapon();
    const reloadDip = fps.reloading > 0 ? 0.13 + Math.sin(CBZ.now * 0.018) * 0.025 : 0;
    if (fps.active) {
      if (armed()) {
        vm.position.set(
          0.36 - bobX * 0.5 + recoilSide * 0.9,
          -0.34 + bobY * 0.5 - recoil * 0.12 - vmPunch * 0.18 - reloadDip,
          -0.72 + recoil * 0.22 - vmPunch * 0.3
        );
        vm.rotation.x = -0.10 + recoil * 0.55 + vmPunch * 0.4 + reloadDip * 0.8;   // level the barrel forward (was tilted up)
        vm.rotation.z = recoilSide * 1.2 - bobX * 0.18;
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

    if (cross) {
      const aim = aimedActor(armed() ? w.range : MELEE);
      const size = armed()
        ? 18 + w.spread * 280 + recoil * 34 + (fps.reloading > 0 ? 8 : 0)
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
