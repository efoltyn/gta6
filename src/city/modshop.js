/* ============================================================
   city/modshop.js — THE MOD GARAGE / WAR-MACHINE WORKSHOP.

   WHY (why-first law): the city already has a CHOP SHOP, but the chop shop
   only ever DELETES a car — you drive a ride in and it vanishes for cash.
   That's the whole reason the player never keeps a good car: there's no
   in-world reason to. This garage is that reason. You drive your car into a
   second bay alongside the chop shop and instead of cutting it up you turn it
   into a WAR MACHINE you want to keep:

     • SELL          — same payout math as the chop shop (a fair-market exit).
     • RESPRAY       — repaint + restyle (cheap heat-shedding cosmetic).
     • ARMOR "black shields" — matte-black bolt-on plates along the doors,
                       hood and grille that SHRUG bullets/rams (but NOT
                       explosives — an RPG/C4 stays the counter, per armored.js).
     • ROCKET BOOSTER — a rear nozzle + a [Shift] velocity burst with a
                       recharge meter, for escapes and ramming.
     • ROOF TURRET   — an aimable MG on the roof. It YAWS toward where the
                       camera looks; hold left-click to hitscan-fire (tracer,
                       damages the first ped/car hit). Firing = a crime.
     • ROCKET LAUNCHER — twin hood pods; left-click (or [R] to toggle which
                       weapon fires) launches a REAL missile via the exact
                       aircraft.js cityFireMissile chain. Finite ammo,
                       resupplied at the shop.
     • PERFORMANCE   — bumps the car's handling-feel (accel/top/grip) so a
                       war machine also DRIVES like one.

   The aim is the CAMERA forward (decoupled from the car heading) so you can
   drive one way and shoot another — the GTA weaponized-vehicle feel.

   DESIGN / SAFETY:
     • All mod state lives on the car object (car.mods) so it survives the
       instance; applyMods(car) rebuilds the child meshes from that state,
       which is MP-safe (a puppet car re-dresses from its own mods record).
     • Attachments are CHILD MESHES on car.group — we NEVER touch the
       playercars.js geometry. They rotate with the car for free.
     • cityDamageCar is wrapped ONCE (idempotent guard) to apply the armor
       multiplier — mirrors armored.js exactly. Explosives bypass it (they
       route through cityExplosion), so RPG/C4 stays a hard counter.
     • Everything gates g.mode==='city'; jail / disaster-survival never run a
       line. Every cross-module call is feature-detected.
     • The shop is a driving:true interaction zone at the chop shop's second
       bay (buildings.js stamps building.modZone); opening shows an HTML menu.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  if (!g) return;

  // ---- tuning ---------------------------------------------------------------
  const TUNE = {
    armorMul: { light: 0.5, heavy: 0.2 },   // fraction of bullet/ram damage taken
    boostBurst: 22,           // velocity added (m/s) over the burst
    boostDur: 0.6,            // seconds of burst
    boostRecharge: 2.5,       // seconds to refill
    turretCD: 0.1,            // seconds between turret shots
    turretDmgPed: 34,         // hitscan damage to a ped
    turretDmgCar: 26,         // hitscan damage to a car
    turretRange: 90,
    launcherCD: 0.9,          // seconds between rockets
    launcherAmmoMax: 12,
    crimeShots: 120,          // CBZ.cityCrime weight for opening fire
  };

  // tiered prices (gated on cash). Sell has no price (it pays YOU).
  const PRICE = {
    respray:   1200,
    armor:    { light: 6500, heavy: 14000 },
    booster:   9000,
    turret:    18000,
    launcher:  26000,
    launcherAmmo: 4000,       // a full resupply
    perf:     { 1: 5000, 2: 11000, 3: 20000 },
  };

  // shared materials (one set, reused across every bolt-on → draw-call cheap).
  let MAT = null;
  function assets() {
    if (MAT) return MAT;
    MAT = {
      plate:  new THREE.MeshLambertMaterial({ color: 0x14161a }),   // matte near-black armor
      plateE: new THREE.MeshLambertMaterial({ color: 0x202329 }),   // edge trim
      metal:  new THREE.MeshLambertMaterial({ color: 0x33373d }),   // gun metal
      barrel: new THREE.MeshLambertMaterial({ color: 0x1c1f24 }),
      nozzle: new THREE.MeshLambertMaterial({ color: 0x2a2d33 }),
      flame:  new THREE.MeshBasicMaterial({ color: 0xffae3a }),
      pod:    new THREE.MeshLambertMaterial({ color: 0x2b2f36 }),
      tip:    new THREE.MeshBasicMaterial({ color: 0xff6a3a }),
    };
    for (const k in MAT) MAT[k]._shared = true;
    return MAT;
  }

  // ---- dims of THIS car's visual (defensive — many fallbacks) ----------------
  function carDims(car) {
    let d = car && car._visualDims;
    if (!d && car && car.group && car.group.userData) {
      const v = car.group.userData.carVisual;
      d = (v && v.userData && v.userData.vehicleDims) || car.group.userData.vehicleDims;
    }
    d = d || (car && car.dims) || null;
    return {
      width:  (d && d.width)  || 2.0,
      length: (d && d.length) || 4.4,
      height: (d && d.height) || 1.5,
    };
  }

  // ---- find / create the attachment root on the car.group --------------------
  // One group holds every bolt-on so applyMods can wipe + rebuild cleanly.
  function modRoot(car, make) {
    const grp = car && car.group;
    if (!grp) return null;
    let root = grp.userData && grp.userData._modRoot;
    if (root && root.parent !== grp) root = null;   // a visual swap orphaned it
    if (!root && make) {
      root = new THREE.Group();
      root.userData._modRoot = true;
      grp.add(root);
      grp.userData._modRoot = root;
    }
    return root || null;
  }
  function clearModRoot(car) {
    const grp = car && car.group; if (!grp) return;
    const root = grp.userData && grp.userData._modRoot;
    if (root) {
      root.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
      });
      if (root.parent) root.parent.remove(root);
      grp.userData._modRoot = null;
    }
  }

  // ============================================================
  // BUILD each attachment as child meshes (local space: +z = nose, +y = up).
  // ============================================================
  function buildArmor(root, dims, tier) {
    const M = assets();
    const hw = dims.width / 2, hl = dims.length / 2;
    const heavy = tier === "heavy";
    const th = heavy ? 0.16 : 0.1;                  // plate thickness
    const yMid = dims.height * 0.42;
    // door plates down each flank
    [-1, 1].forEach(function (sx) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(th, dims.height * 0.5, dims.length * 0.62), M.plate);
      p.position.set(sx * (hw + th * 0.4), yMid, -dims.length * 0.04);
      root.add(p);
      // a bolted edge rib so it reads as added armor, not paint
      const rib = new THREE.Mesh(new THREE.BoxGeometry(th * 0.6, 0.07, dims.length * 0.62), M.plateE);
      rib.position.set(sx * (hw + th * 0.7), yMid + dims.height * 0.22, -dims.length * 0.04);
      root.add(rib);
    });
    // hood slab
    const hood = new THREE.Mesh(new THREE.BoxGeometry(dims.width * 0.86, th, dims.length * 0.34), M.plate);
    hood.position.set(0, dims.height * 0.62, hl * 0.5);
    root.add(hood);
    // grille / ram bar across the nose
    const grille = new THREE.Mesh(new THREE.BoxGeometry(dims.width * 0.96, dims.height * 0.34, th * 1.4), M.plate);
    grille.position.set(0, dims.height * 0.34, hl + th);
    root.add(grille);
    if (heavy) {
      // a second nose ram tusk + roof plate for the heavy kit
      const tusk = new THREE.Mesh(new THREE.BoxGeometry(dims.width * 0.7, 0.12, 0.5), M.plateE);
      tusk.position.set(0, dims.height * 0.2, hl + 0.32);
      root.add(tusk);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(dims.width * 0.7, th, dims.length * 0.3), M.plate);
      roof.position.set(0, dims.height + 0.02, -dims.length * 0.02);
      root.add(roof);
    }
  }

  function buildBooster(root, dims) {
    const M = assets();
    const hl = dims.length / 2;
    const grp = new THREE.Group();
    grp.userData._booster = true;
    // twin rear nozzles
    const flames = [];
    [-1, 1].forEach(function (sx) {
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.5, 8), M.nozzle);
      noz.rotation.x = Math.PI / 2;
      noz.position.set(sx * dims.width * 0.28, dims.height * 0.34, -hl - 0.22);
      grp.add(noz);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 8), M.flame);
      flame.rotation.x = -Math.PI / 2;
      flame.position.set(sx * dims.width * 0.28, dims.height * 0.34, -hl - 0.85);
      flame.visible = false;
      grp.add(flame);
      flames.push(flame);
    });
    grp.userData.flames = flames;
    root.add(grp);
    return grp;
  }

  function buildTurret(root, dims) {
    const M = assets();
    const grp = new THREE.Group();          // yaws each frame
    grp.userData._turret = true;
    grp.position.set(0, dims.height + 0.06, -dims.length * 0.02);
    // base ring
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.18, 10), M.metal);
    base.position.y = 0.09; grp.add(base);
    // body + barrel that point along the group's local +z (we yaw the group)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.5), M.metal);
    body.position.set(0, 0.3, 0); grp.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8), M.barrel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.34, 0.6); grp.add(barrel);
    // muzzle anchor (worldpos read for tracers/hitscan origin)
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.34, 1.15); grp.add(muzzle);
    grp.userData.muzzle = muzzle;
    root.add(grp);
    return grp;
  }

  function buildLauncher(root, dims) {
    const M = assets();
    const hl = dims.length / 2;
    const grp = new THREE.Group();
    grp.userData._launcher = true;
    const muzzles = [];
    [-1, 1].forEach(function (sx) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.9), M.pod);
      pod.position.set(sx * dims.width * 0.3, dims.height * 0.66, hl * 0.55);
      grp.add(pod);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 7), M.tip);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(sx * dims.width * 0.3, dims.height * 0.66, hl * 0.55 + 0.5);
      grp.add(tip);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(sx * dims.width * 0.3, dims.height * 0.66, hl * 0.55 + 0.62);
      grp.add(muzzle);
      muzzles.push(muzzle);
    });
    grp.userData.muzzles = muzzles;
    root.add(grp);
    return grp;
  }

  // ============================================================
  // APPLY: (re)build every saved mod from car.mods onto car.group.
  // ============================================================
  function applyMods(car) {
    if (!car || !car.group || !car.mods) return;
    clearModRoot(car);
    const root = modRoot(car, true);
    if (!root) return;
    const dims = carDims(car);
    const m = car.mods;
    // cache live handles on the car so the per-frame loop avoids a scene walk
    car._modFx = car._modFx || {};
    try {
      if (m.armor) buildArmor(root, dims, m.armor);
      if (m.booster) car._modFx.booster = buildBooster(root, dims);
      if (m.turret) car._modFx.turret = buildTurret(root, dims);
      if (m.launcher) car._modFx.launcher = buildLauncher(root, dims);
    } catch (e) { /* a dressing failure must never break the car */ }
  }
  CBZ.cityApplyCarModsRebuild = applyMods;   // public: re-dress after a visual swap / MP spawn

  // single mod application (from the shop menu)
  function cityApplyCarMod(car, modId, tier) {
    if (!car || !car.group) return false;
    car.mods = car.mods || {};
    const m = car.mods;
    switch (modId) {
      case "armor":    m.armor = (tier === "heavy") ? "heavy" : "light"; break;
      case "booster":  m.booster = true; break;
      case "turret":   m.turret = true; break;
      case "launcher": m.launcher = m.launcher || { ammo: 0 }; m.launcher.ammo = TUNE.launcherAmmoMax; break;
      case "perf":     m.perf = Math.max(m.perf || 0, tier | 0 || 1); applyPerf(car); break;
      case "paint":    m.paint = tier || m.paint; break;
      default: return false;
    }
    applyMods(car);
    return true;
  }
  CBZ.cityApplyCarMod = cityApplyCarMod;

  // PERFORMANCE: bump the published handling-feel (vehicles.js reads
  // car._playerCarFeel for accel/top/grip). We layer a multiplier so it
  // composes with the style's base feel and is idempotent per tier.
  function applyPerf(car) {
    const tier = (car.mods && car.mods.perf) | 0;
    if (!tier) return;
    const base = car._perfBaseFeel || car._playerCarFeel || (CBZ.cityPlayerCarFeel && CBZ.cityPlayerCarFeel(car.detailStyle)) || null;
    if (!base) return;
    if (!car._perfBaseFeel) car._perfBaseFeel = Object.assign({}, base);
    const k = 1 + tier * 0.16;                       // +16% per tier
    const f = Object.assign({}, car._perfBaseFeel);
    if (f.accel != null) f.accel *= k;
    if (f.top != null) f.top *= (1 + tier * 0.1);
    if (f.grip != null) f.grip *= (1 + tier * 0.06);
    car._playerCarFeel = f;
  }

  // ============================================================
  // ARMOR: wrap cityDamageCar ONCE (idempotent), mirroring armored.js.
  // Explosives bypass this (they route through cityExplosion) so RPG/C4 stays
  // the counter. Everything that isn't a modded car passes straight through.
  // ============================================================
  function installDamageWrap() {
    const orig = CBZ.cityDamageCar;
    if (typeof orig !== "function" || orig._modWrapped) return;
    const wrapped = function (car, amount, opts) {
      let amt = amount;
      try {
        if (car && car.mods && car.mods.armor && g.mode === "city" && !car.dead) {
          const ram = !opts || (!opts.point && !opts.crumple);   // crash path passes no point
          // explosives DON'T arrive here as car-damage — but if a caller routes
          // a blast through here we still let it through unscaled (opts.blast).
          // ram and bullet both shrug equally here (the armor is omnidirectional);
          // `ram` is kept readable for future per-direction tuning.
          if (!(opts && opts.blast)) {
            void ram;
            amt = amount * (TUNE.armorMul[car.mods.armor] || 1);
          }
        }
      } catch (e) { /* never break the shared damage chain */ }
      return orig.call(this, car, amt, opts);
    };
    wrapped._modWrapped = true;
    // preserve any flags prior wrappers (armored.js) stamped so feature-detects
    // elsewhere keep working through our wrapper.
    wrapped._armoredWrapped = orig._armoredWrapped;
    wrapped._origArmored = orig._origArmored;
    wrapped._origMod = orig;
    CBZ.cityDamageCar = wrapped;
  }

  // ============================================================
  // AIM: camera-forward direction (decoupled from car heading).
  // ============================================================
  const _camDir = new THREE.Vector3();
  function cameraForward() {
    const cam = CBZ.camera;
    if (cam && cam.getWorldDirection) {
      cam.getWorldDirection(_camDir);
      if (_camDir.lengthSq() > 1e-6) return _camDir;
    }
    // fallback: the player car's heading
    const car = liveCar();
    if (car) { _camDir.set(Math.sin(car.heading), 0, Math.cos(car.heading)); return _camDir; }
    _camDir.set(0, 0, 1);
    return _camDir;
  }

  function liveCar() {
    const P = CBZ.player;
    return (P && P.driving && P._vehicle) ? P._vehicle : null;
  }

  // ============================================================
  // TRACER pool (turret fire) — a few reused thin boxes.
  // ============================================================
  const tracers = [];
  let TRACER_GEO = null, TRACER_MAT = null;
  function fireTracer(x, y, z, dx, dy, dz, len) {
    if (!TRACER_GEO) {
      TRACER_GEO = new THREE.BoxGeometry(0.04, 0.04, 1);
      TRACER_MAT = new THREE.MeshBasicMaterial({ color: 0xffe27a });
      TRACER_GEO._shared = TRACER_MAT._shared = true;
    }
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    if (!root) return;
    const t = new THREE.Mesh(TRACER_GEO, TRACER_MAT);
    t.position.set(x + dx * len * 0.5, y + dy * len * 0.5, z + dz * len * 0.5);
    t.scale.z = len;
    t.lookAt(x + dx * len, y + dy * len, z + dz * len);
    root.add(t);
    tracers.push({ mesh: t, life: 0.06 });
  }
  function stepTracers(dt) {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      if (t.life <= 0) { if (t.mesh.parent) t.mesh.parent.remove(t.mesh); tracers.splice(i, 1); }
    }
  }

  // ============================================================
  // TURRET hitscan: ray from muzzle worldpos along camera dir; damage the
  // first ped/car hit (closest along the ray within a small lateral radius).
  // ============================================================
  const _muzW = new THREE.Vector3();
  function fireTurret(car) {
    const turret = car._modFx && car._modFx.turret;
    if (!turret || !turret.userData.muzzle) return;
    turret.userData.muzzle.getWorldPosition(_muzW);
    const dir = cameraForward();
    const ox = _muzW.x, oy = _muzW.y, oz = _muzW.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    const R = TUNE.turretRange;
    let bestT = R, hitKind = null, hitObj = null, hx = 0, hy = 0, hz = 0;

    // helper: closest-approach test of a point to the ray
    function consider(px, py, pz, radius, kind, obj) {
      const rx = px - ox, ry = py - oy, rz = pz - oz;
      const along = rx * dx + ry * dy + rz * dz;
      if (along < 0.5 || along > bestT) return;
      const cx = ox + dx * along, cy = oy + dy * along, cz = oz + dz * along;
      const off = Math.hypot(px - cx, py - cy, pz - cz);
      if (off > radius) return;
      bestT = along; hitKind = kind; hitObj = obj; hx = px; hy = py; hz = pz;
    }

    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i]; if (!p || p.dead || !p.pos) continue;
      consider(p.pos.x, 1.0, p.pos.z, 1.0, "ped", p);
    }
    const cops = CBZ.cityCops || [];
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i]; if (!c || c.dead || !c.pos) continue;
      consider(c.pos.x, 1.0, c.pos.z, 1.0, "ped", c);
    }
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]; if (!c || c === car || c.dead || !c.pos) continue;
      consider(c.pos.x, 0.9, c.pos.z, 1.6, "car", c);
    }

    const tlen = (hitKind ? bestT : R);
    fireTracer(ox, oy, oz, dx, dy, dz, tlen);
    if (CBZ.sfx) CBZ.sfx("hit");

    if (hitKind === "ped") {
      const p = hitObj;
      p.hp = (p.hp == null ? 100 : p.hp) - TUNE.turretDmgPed;
      if (p.hp <= 0) {
        if (CBZ.cityKillPed) CBZ.cityKillPed(p, { fromX: ox, fromZ: oz, attacker: (CBZ.city && CBZ.city.playerActor) || null, byPlayer: true, force: 6, fling: 5 }, "turret");
        else { p.dead = true; }
      } else if (CBZ.body && CBZ.body.hit) {
        const ndx = hx - ox, ndz = hz - oz, nl = Math.hypot(ndx, ndz) || 1;
        CBZ.body.hit(p, { dir: { x: ndx / nl, z: ndz / nl }, force: 4 });
      }
    } else if (hitKind === "car") {
      if (CBZ.cityDamageCar) CBZ.cityDamageCar(hitObj, TUNE.turretDmgCar, { byPlayer: true, point: { x: hx, y: hy, z: hz } });
    }
    if (CBZ.cityCrime) CBZ.cityCrime(TUNE.crimeShots, { type: "shots-fired", x: car.pos.x, z: car.pos.z });
  }

  // ============================================================
  // ROCKET LAUNCHER: real missile via aircraft.js cityFireMissile.
  // ============================================================
  function fireLauncher(car) {
    if (!CBZ.cityFireMissile) return;
    const m = car.mods && car.mods.launcher;
    if (!m || (m.ammo | 0) <= 0) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("Rocket pods empty — resupply at the mod garage.", 1.6);
      if (CBZ.sfx) CBZ.sfx("empty");
      return;
    }
    const L = car._modFx && car._modFx.launcher;
    const muzzles = (L && L.userData.muzzles) || [];
    car._modPodPick = ((car._modPodPick | 0) + 1) % Math.max(1, muzzles.length);
    const mz = muzzles[car._modPodPick];
    const dir = cameraForward();
    let fx, fy, fz;
    if (mz) { mz.getWorldPosition(_muzW); fx = _muzW.x; fy = _muzW.y; fz = _muzW.z; }
    else { fx = car.pos.x + dir.x * 2; fy = 1.4; fz = car.pos.z + dir.z * 2; }
    // nudge the spawn forward so it clears the car's own collider
    fx += dir.x * 1.2; fy += dir.y * 1.2; fz += dir.z * 1.2;
    const ok = CBZ.cityFireMissile(fx, fy, fz, dir.x, dir.y, dir.z, { byPlayer: true });
    if (ok) {
      m.ammo -= 1;
      if (CBZ.sfx) CBZ.sfx("whoosh");
      if (CBZ.shake) CBZ.shake(0.5);
      if (CBZ.cityCrime) CBZ.cityCrime(TUNE.crimeShots + 40, { type: "shots-fired", x: car.pos.x, z: car.pos.z });
      if (m.ammo <= 0 && CBZ.city && CBZ.city.note) CBZ.city.note("Last rocket away — pods empty.", 1.4);
    }
  }

  // ============================================================
  // INPUT: own keydown / mousedown handlers gated on driving.
  //   • [Shift]  → booster burst
  //   • [R]      → toggle active weapon (turret ⇄ launcher)
  //   • L-click  → fire the active weapon (hold for turret)
  // ============================================================
  let mouseDown = false;
  function activeWeapon(car) {
    // prefer the explicitly-toggled weapon if it exists; else whichever is fitted
    const m = car.mods || {};
    if (car._modWeapon === "launcher" && m.launcher) return "launcher";
    if (car._modWeapon === "turret" && m.turret) return "turret";
    if (m.turret) return "turret";
    if (m.launcher) return "launcher";
    return null;
  }

  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    const car = liveCar();
    if (!car || CBZ.cityMenuOpen || (CBZ.player && CBZ.player.dead)) return;
    const k = (e.key || "").toLowerCase();
    if ((k === "shift" || e.key === "Shift") && car.mods && car.mods.booster) {
      if (!e.repeat) startBoost(car);
      return;
    }
    if (k === "r" && !e.repeat && car.mods && car.mods.turret && car.mods.launcher) {
      car._modWeapon = (activeWeapon(car) === "turret") ? "launcher" : "turret";
      if (CBZ.city && CBZ.city.note) CBZ.city.note("Weapon: " + (car._modWeapon === "turret" ? "🔫 roof turret" : "🚀 rocket launcher"), 1.0);
      e.preventDefault();
    }
  });

  addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (g.mode !== "city" || g.state !== "playing") return;
    const car = liveCar();
    if (!car || CBZ.cityMenuOpen || (CBZ.player && CBZ.player.dead)) return;
    const w = activeWeapon(car);
    if (!w) return;
    mouseDown = true;
    if (w === "launcher") fireLauncherGated(car);   // single shot per click
  });
  addEventListener("mouseup", function (e) { if (e.button === 0) mouseDown = false; });

  function fireLauncherGated(car) {
    if ((car._modLaunchCD || 0) > 0) return;
    car._modLaunchCD = TUNE.launcherCD;
    fireLauncher(car);
  }

  // ---- booster physics -------------------------------------------------------
  function startBoost(car) {
    if ((car._boostReady == null ? 1 : car._boostReady) < 1) return;  // still recharging
    car._boostT = TUNE.boostDur;
    car._boostReady = 0;
    if (CBZ.sfx) CBZ.sfx("whoosh");
    if (CBZ.shake) CBZ.shake(0.4);
  }
  function stepBooster(car, dt) {
    // recharge
    if ((car._boostReady == null ? 1 : car._boostReady) < 1 && (car._boostT || 0) <= 0) {
      car._boostReady = Math.min(1, (car._boostReady || 0) + dt / TUNE.boostRecharge);
    }
    const fx = car._modFx && car._modFx.booster;
    const flames = fx && fx.userData.flames;
    if ((car._boostT || 0) > 0) {
      car._boostT -= dt;
      // push velocity along the heading (vehicles.js reads car.v + car.vx/vz)
      const add = TUNE.boostBurst * dt / TUNE.boostDur;
      car.v = (car.v || 0) + add;
      const fwdX = Math.sin(car.heading), fwdZ = Math.cos(car.heading);
      if (car.vx != null) car.vx += fwdX * add;
      if (car.vz != null) car.vz += fwdZ * add;
      if (flames) for (let i = 0; i < flames.length; i++) flames[i].visible = true;
    } else if (flames) {
      for (let i = 0; i < flames.length; i++) flames[i].visible = false;
    }
  }

  // ---- turret aim + auto-fire while held -------------------------------------
  const _carPosW = new THREE.Vector3();
  function stepTurret(car, dt) {
    const t = car._modFx && car._modFx.turret;
    if (!t) return;
    // yaw the turret toward camera-forward, in the car-group's LOCAL frame
    const dir = cameraForward();
    const worldYaw = Math.atan2(dir.x, dir.z);
    const localYaw = worldYaw - (car.heading || 0);
    // ease toward target
    let cur = t.rotation.y;
    let diff = localYaw - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    t.rotation.y = cur + diff * Math.min(1, dt * 12);
    // fire while held (turret weapon active)
    car._modTurretCD = Math.max(0, (car._modTurretCD || 0) - dt);
    if (mouseDown && activeWeapon(car) === "turret" && car._modTurretCD <= 0 && !CBZ.cityMenuOpen) {
      car._modTurretCD = TUNE.turretCD;
      fireTurret(car);
    }
  }

  // ============================================================
  // PER-FRAME (order 12 — just after the player drive at order 11): aim,
  // booster physics, cooldowns, weapon, HUD.
  // ============================================================
  CBZ.onUpdate(12.2, function (dt) {
    installDamageWrap();   // idempotent; survives load-order + hot reloads
    stepTracers(dt);
    if (g.mode !== "city") { hideHud(); return; }
    if (g.state !== "playing") { hideHud(); return; }
    const car = liveCar();
    if (!car) { hideHud(); return; }
    // ensure attachments exist (MP puppet / after a visual swap)
    if (car.mods && (!car._modFx || (car.mods.turret && !car._modFx.turret) ||
        (car.mods.launcher && !car._modFx.launcher) || (car.mods.booster && !car._modFx.booster))) {
      applyMods(car);
    }
    car._modLaunchCD = Math.max(0, (car._modLaunchCD || 0) - dt);
    if (car.mods && car.mods.booster) stepBooster(car, dt);
    if (car.mods && car.mods.turret) stepTurret(car, dt);
    updateHud(car);
  });

  // ============================================================
  // HUD: a small DOM strip — boost meter + active-weapon + rocket ammo.
  // ============================================================
  let HUD = null;
  function hudEl() {
    if (HUD) return HUD;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "modshopHud";
    d.style.cssText = "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:45;display:none;" +
      "background:rgba(13,16,21,.78);border:1px solid #3a4150;border-radius:10px;padding:5px 12px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:13px;pointer-events:none;text-align:center;white-space:nowrap";
    document.body.appendChild(d);
    HUD = d;
    return d;
  }
  function hideHud() { if (HUD && HUD.style.display !== "none") HUD.style.display = "none"; }
  let _hudTxt = "";
  function updateHud(car) {
    const m = car.mods;
    if (!m || (!m.booster && !m.turret && !m.launcher)) { hideHud(); return; }
    const el = hudEl(); if (!el) return;
    let parts = [];
    if (m.booster) {
      const r = (car._boostReady == null ? 1 : car._boostReady);
      const pct = Math.round(r * 100);
      const bars = Math.round(r * 10);
      parts.push("🚀 BOOST [" + "█".repeat(bars) + "·".repeat(10 - bars) + "] " + (r >= 1 ? "READY" : pct + "%"));
    }
    const w = activeWeapon(car);
    if (m.turret || m.launcher) {
      let ws = "";
      if (w === "turret") ws = "🔫 TURRET";
      else if (w === "launcher") ws = "🚀 ROCKETS x" + ((m.launcher && m.launcher.ammo) | 0);
      if (m.turret && m.launcher) ws += "  ·  [R] swap";
      parts.push(ws);
    }
    const txt = parts.join("   |   ");
    if (txt !== _hudTxt) { el.innerHTML = txt; _hudTxt = txt; }
    if (el.style.display !== "block") el.style.display = "block";
  }

  // ============================================================
  // THE SHOP: a driving:true interaction zone at the mod-garage bay, + an
  // HTML menu panel (styled after gunstore/clothingstore).
  // ============================================================
  function modLot() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A) return null;
    // the mod garage rides on the chop shop building (buildings.js stamps
    // building.modZone there alongside the chopZone).
    const lot = A.chopShop;
    if (lot && lot.building && lot.building.modZone) return lot;
    return null;
  }

  // ---- the menu panel --------------------------------------------------------
  const S = { panel: null, open: false, tab: "sell", prevMenu: undefined };
  function fmt$(n) { return "$" + ((n | 0).toLocaleString ? (n | 0).toLocaleString("en-US") : ("" + (n | 0))); }
  function cash() { return (g.cash | 0) || 0; }

  function panelEl() {
    if (S.panel) return S.panel;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "modshopPanel";
    d.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;" +
      "background:rgba(13,16,21,.96);border:1px solid #4a5a3a;border-radius:16px;padding:18px 22px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:15px;min-width:360px;max-width:88vw;box-shadow:0 18px 60px rgba(0,0,0,.6)";
    document.body.appendChild(d);
    S.panel = d;
    return d;
  }

  const TABS = [
    ["sell", "Sell"], ["respray", "Respray"], ["armor", "Armor"],
    ["booster", "Booster"], ["turret", "Turret"], ["launcher", "Launcher"], ["perf", "Performance"],
  ];

  function sellPayout(car) {
    // mirror sellToChop math: base value × owned/stolen fraction × condition.
    const E = (CBZ.CITY && CBZ.CITY.econ) || {};
    const base = car.model ? (car.model.value || 3000) : 3000;
    const frac = car.owned ? (E.chopOwned || 0.85) : (E.chopStolen || 0.42);
    let cond = { valueMul: 1, label: "fair" };
    if (CBZ.cityVehicleCondition) { try { cond = CBZ.cityVehicleCondition(car) || cond; } catch (e) { /* keep default */ } }
    // a built-out war machine is worth more on the exit
    let modBonus = 1;
    const m = car.mods || {};
    if (m.armor) modBonus += m.armor === "heavy" ? 0.18 : 0.09;
    if (m.booster) modBonus += 0.08;
    if (m.turret) modBonus += 0.12;
    if (m.launcher) modBonus += 0.14;
    if (m.perf) modBonus += m.perf * 0.05;
    return { pay: Math.round(base * frac * (cond.valueMul || 1) * modBonus), cond: cond };
  }

  function rowsFor(car, tab) {
    // each row: { label, price (0=free/owned), action, owned }
    const m = car.mods || {};
    switch (tab) {
      case "sell": {
        const sp = sellPayout(car);
        return [{ label: "SELL this " + (car.model ? car.model.name : "car"), price: -sp.pay,
          sub: (sp.cond.label || "") + " · payout", action: function () { doSell(car); } }];
      }
      case "respray":
        return [{ label: "Respray + restyle", price: PRICE.respray, sub: "fresh paint · sheds heat",
          action: function () { doRespray(car); } }];
      case "armor":
        return [
          { label: "Black-shield plating — LIGHT", price: PRICE.armor.light, sub: "shrugs ~50% small-arms",
            owned: m.armor === "light", action: function () { doMod(car, "armor", "light", PRICE.armor.light); } },
          { label: "Black-shield plating — HEAVY", price: PRICE.armor.heavy, sub: "shrugs ~80% small-arms · RPG still kills",
            owned: m.armor === "heavy", action: function () { doMod(car, "armor", "heavy", PRICE.armor.heavy); } },
        ];
      case "booster":
        return [{ label: "Rocket booster", price: PRICE.booster, sub: "[Shift] burst · recharges",
          owned: !!m.booster, action: function () { doMod(car, "booster", null, PRICE.booster); } }];
      case "turret":
        return [{ label: "Roof MG turret", price: PRICE.turret, sub: "aim with camera · hold L-click",
          owned: !!m.turret, action: function () { doMod(car, "turret", null, PRICE.turret); } }];
      case "launcher": {
        const rows = [{ label: "Twin rocket launcher", price: PRICE.launcher, sub: "L-click · " + TUNE.launcherAmmoMax + " rockets",
          owned: !!m.launcher, action: function () { doMod(car, "launcher", null, PRICE.launcher); } }];
        if (m.launcher) rows.push({ label: "Resupply rockets (full " + TUNE.launcherAmmoMax + ")",
          price: PRICE.launcherAmmo, sub: "currently " + ((m.launcher.ammo) | 0) + " loaded",
          action: function () { doResupply(car); } });
        return rows;
      }
      case "perf": {
        const cur = m.perf | 0;
        return [1, 2, 3].map(function (t) {
          return { label: "Performance — Stage " + t, price: PRICE.perf[t], sub: "faster · grippier",
            owned: cur >= t, action: function () { doMod(car, "perf", t, PRICE.perf[t]); } };
        });
      }
      default: return [];
    }
  }

  function renderPanel() {
    const d = panelEl(); if (!d) return;
    const car = liveCar();
    if (!car) { closePanel(); return; }
    let html = "<div style='font-weight:700;font-size:18px;margin-bottom:2px;color:#bfe39a'>🔧 Mod Garage</div>";
    html += "<div style='color:#8a93a3;font-size:12px;margin-bottom:10px'>Keep the ride — build a war machine. " +
      "<span style='color:#7ed957'>" + fmt$(cash()) + "</span> on hand</div>";
    // tab bar (keys [1]-[7])
    html += "<div style='display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px'>";
    TABS.forEach(function (t, i) {
      const on = S.tab === t[0];
      html += "<span style='padding:3px 8px;border-radius:8px;font-size:12px;" +
        (on ? "background:#3c5a2a;color:#dff5c8" : "background:#22262c;color:#9aa3ad") + "'>" +
        "<b>" + (i + 1) + "</b> " + t[1] + "</span>";
    });
    html += "</div>";
    const rows = rowsFor(car, S.tab);
    S._rows = rows;
    if (!rows.length) html += "<div style='color:#9aa0a6'>Nothing here.</div>";
    rows.forEach(function (r, i) {
      const owned = r.owned;
      const priceTxt = r.price < 0
        ? "<span style='color:#7ed957'>+" + fmt$(-r.price) + "</span>"
        : owned ? "<span style='color:#7ed957'>✓ installed</span>"
        : (cash() >= r.price ? "<span style='color:#e7c84f'>" + fmt$(r.price) + "</span>"
                             : "<span style='color:#c46a6a'>" + fmt$(r.price) + "</span>");
      html += "<div style='display:flex;justify-content:space-between;gap:16px;padding:5px 0;border-top:1px solid #262b22'>" +
        "<span><b style='color:#bfe39a'>" + (i + 1 <= 9 ? "[" + String.fromCharCode(97 + i) + "]" : "") + "</b> " +
        r.label + (r.sub ? "<span style='color:#7f8794'> · " + r.sub + "</span>" : "") + "</span>" +
        "<span>" + priceTxt + "</span></div>";
    });
    html += "<div style='border-top:1px solid #2a3122;margin:12px 0 4px'></div>";
    html += "<div style='color:#8a93a3;font-size:12px'>[1-7] tab · [a-d] buy/select · [Esc]/[E] close</div>";
    d.innerHTML = html;
  }

  function openPanel() {
    const d = panelEl(); if (!d) return;
    if (!liveCar()) { if (CBZ.city && CBZ.city.note) CBZ.city.note("Pull your car into the bay first.", 1.4); return; }
    S.open = true;
    S.prevMenu = CBZ.cityMenuOpen;
    CBZ.cityMenuOpen = true;
    if (S.tab == null) S.tab = "sell";
    renderPanel();
    d.style.display = "block";
  }
  function closePanel() {
    if (S.panel) S.panel.style.display = "none";
    if (S.open) CBZ.cityMenuOpen = S.prevMenu;
    S.open = false; S.prevMenu = undefined;
  }
  CBZ.cityModShopOpen = openPanel;   // headless / harness handle

  function panelKey(k) {
    if (k === "escape" || k === "e") { closePanel(); return; }
    const n = parseInt(k, 10);
    if (!isNaN(n) && n >= 1 && n <= TABS.length) { S.tab = TABS[n - 1][0]; renderPanel(); return; }
    // letter = buy/select the matching row
    if (k.length === 1 && k >= "a" && k <= "z") {
      const idx = k.charCodeAt(0) - 97;
      if (S._rows && S._rows[idx] && S._rows[idx].action) { S._rows[idx].action(); renderPanel(); }
    }
  }

  // ---- shop actions ----------------------------------------------------------
  function doMod(car, modId, tier, price) {
    if (price > 0 && !(CBZ.city && CBZ.city.spend && CBZ.city.spend(price))) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("That runs " + fmt$(price) + " — come back with the money.", 1.8);
      if (CBZ.sfx) CBZ.sfx("glass");
      return;
    }
    cityApplyCarMod(car, modId, tier);
    if (CBZ.sfx) CBZ.sfx("clank");
    if (CBZ.city && CBZ.city.note) CBZ.city.note("🔧 Installed — your ride's meaner now.", 1.6);
  }
  function doResupply(car) {
    const m = car.mods && car.mods.launcher; if (!m) return;
    if (m.ammo >= TUNE.launcherAmmoMax) { if (CBZ.city && CBZ.city.note) CBZ.city.note("Pods already full.", 1.2); return; }
    if (!(CBZ.city && CBZ.city.spend && CBZ.city.spend(PRICE.launcherAmmo))) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("Rockets run " + fmt$(PRICE.launcherAmmo) + " a load.", 1.6);
      if (CBZ.sfx) CBZ.sfx("glass"); return;
    }
    m.ammo = TUNE.launcherAmmoMax;
    if (CBZ.sfx) CBZ.sfx("reload");
    if (CBZ.city && CBZ.city.note) CBZ.city.note("🚀 Rockets loaded — " + m.ammo + " ready.", 1.6);
  }
  function doRespray(car) {
    if (!(CBZ.city && CBZ.city.spend && CBZ.city.spend(PRICE.respray))) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("A respray runs " + fmt$(PRICE.respray) + ".", 1.6);
      if (CBZ.sfx) CBZ.sfx("glass"); return;
    }
    // pick a fresh colour + cycle style; recolour the visual.
    const palette = [0x2b2f36, 0xb02a2a, 0x1f5fb0, 0x2f8f4f, 0xe0a52a, 0xe8e8ec, 0x6a2f9a, 0xff6a00];
    const col = palette[(Math.random() * palette.length) | 0];
    car.color = col;
    let restyled = false;
    if (CBZ.cityCyclePlayerCarStyle) { try { CBZ.cityCyclePlayerCarStyle(); restyled = true; } catch (e) { /* keep */ } }
    // recolour the live visual body to the new colour (paint without a rebuild).
    try { recolor(car, col); } catch (e) { /* cosmetic */ }
    // a visual swap orphaned our attachments — re-dress.
    if (car.mods) applyMods(car);
    if (CBZ.sfx) CBZ.sfx("switch");
    if (CBZ.city && CBZ.city.note) CBZ.city.note("🎨 Fresh paint" + (restyled ? " + new lines" : "") + " — looks clean.", 1.8);
    renderPanelSafe();
  }
  function recolor(car, col) {
    const visual = car._playerCarVisual || (car.group && car.group.userData && car.group.userData.carVisual);
    if (!visual) return;
    visual.traverse(function (o) {
      if (!o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach(function (mm) {
        if (mm && mm._playerCarOwned && mm.color && mm.color.setHex && o.userData && o.userData.bodyPaint) mm.color.setHex(col);
        // fallback: paint the largest body materials even without a bodyPaint tag
        else if (mm && mm._playerCarOwned && mm.color && mm.color.setHex && o.userData && o.userData.isBody) mm.color.setHex(col);
      });
    });
  }
  function doSell(car) {
    const sp = sellPayout(car);
    if (CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    if (CBZ.cityCars) { const idx = CBZ.cityCars.indexOf(car); if (idx >= 0) CBZ.cityCars.splice(idx, 1); }
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(sp.pay); else g.cash = (g.cash || 0) + sp.pay;
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(2);
    if (CBZ.city && CBZ.city.big) CBZ.city.big("SOLD " + (car.model ? car.model.name : "car") + " + " + fmt$(sp.pay));
    if (CBZ.sfx) CBZ.sfx("coin");
    closePanel();
  }
  function renderPanelSafe() { if (S.open) renderPanel(); }

  // ---- panel keyboard (capture so we win the key over interact.js) -----------
  addEventListener("keydown", function (e) {
    if (!S.open) return;
    const k = (e.key || "").toLowerCase();
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.stopPropagation();
    panelKey(k);
  }, true);

  // ============================================================
  // ZONE registration: a driving:true zone at the mod garage bay.
  // ============================================================
  function registerZone() {
    if (!CBZ.interactions || !CBZ.interactions.registerZone) return;
    if (registerZone._done) return;
    registerZone._done = true;
    const I = CBZ.interactions;
    I.registerZone({
      id: "zone-modshop", kind: "modshop", prio: 12, driving: true,
      find: function (px, pz) {
        const lot = modLot(); if (!lot) return null;
        const mz = lot.building.modZone;
        if (Math.hypot(px - mz.x, pz - mz.z) > mz.r) return null;
        if (!lot._modZTarget) lot._modZTarget = { x: mz.x, z: mz.z, lot: lot };
        return lot._modZTarget;
      },
      options: [{
        id: "modshop-open", slot: "i",
        label: function () { return "🔧 Open the mod garage"; },
        onSelect: function () { openPanel(); },
      }],
    });
  }

  // install the zone once interactions exist (retry on the update loop until then)
  CBZ.onUpdate(99.7, function () {
    if (g.mode !== "city") return;
    registerZone();
  });

})();
