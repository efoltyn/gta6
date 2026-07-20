/* ============================================================
   systems/lockon.js — MISSILE LOCK-ON + THE REAL SNIPER SCOPE.

   TWO player-facing systems, one file, both flag-gated:

   1) WEAPON LOCK-ON (CBZ.CONFIG.WEAPON_LOCKON, default ON)
      Whenever the player wields a missile-class weapon — the RPG on foot, a
      stolen armed aircraft's missiles, the tank's main gun, a modshop car
      launcher — EVERY live craft on screen grows a target square: street
      cars, military armor, police air (the 3★ Air-1 chopper included),
      parked + ambient civil aircraft, the player's own parked birds
      (CBZ.CONFIG.LOCKON_UNIVERSAL_TARGETS — list owners feed the pool via
      plural cityXxxEnumTargets(cb) twins beside their old single-best
      acquire APIs). Three-state color grammar, NO words on screen:
        GREEN  = candidate (in range, roughly on screen)
        YELLOW = acquiring (aim held near it — the square tightens in)
        RED    = LOCKED (steady, hard corners, lock tone)
      Exactly ONE lock at a time; nearest-to-crosshair wins with hysteresis
      (same idiom as city/interactions.js targeting: the current target keeps
      its role unless a rival is meaningfully better) so the square never
      flickers between two cars. Locks are LINE-OF-SIGHT gated: aiming at a
      car THROUGH a building never locks (CBZ.losBlockers raycast, the same
      blockers fpsmode's aimedActor honors).

      FIRING WITH A RED LOCK = HOMING. The lock feeds the two existing
      projectile systems through two tiny fire-time hooks (no parallel
      projectile system):
        • systems/fpsmode.js RPG branch → CBZ.lockonFireTarget() replaces the
          old pull-time acquireHomingTarget when this system is on: red lock
          homes (per-weapon turn rate — the RPG deliberately sluggish), no
          lock flies EXACTLY the legacy straight/ballistic arc.
        • city/aircraft.js CBZ.cityFireMissile → CBZ.lockonMissileSeek()
          hands the shared military missile pool a live seek getter with a
          snappier air-to-air turn rate + a proximity fuse, so near-misses
          still kill. No lock → the legacy straight shot.
      Both hooks return UNDEFINED when the flag is off, which makes every
      caller fall through to its byte-identical legacy path (one-line revert).

      The existing crosshair is untouched — squares are additive. Rendering is
      ONE overlay of pooled DOM nodes (max 8 squares), no per-frame innerHTML,
      no per-frame allocation beyond the unavoidable transform strings.

      Touch-layer API (mobile agent): CBZ.lockonTarget() → locked record or
      null; CBZ.lockonState() → {active,state,progress,candidates,locked};
      CBZ.lockonActive(); CBZ.lockonLastLaunch() → launch-event feedback.

   2) REAL SNIPER SCOPE (CBZ.CONFIG.SNIPER_REAL_SCOPE, default ON)
      The factory sniper's scope was a prop: the tube renders (optics.js) but
      RMB gave the same ~14° ADS nudge every pistol gets. Now the sniper truly
      scopes: RMB (which already means "aim") rides into a REAL optic —
      camera.fov eased to SCOPE_FOV (fpsmode's existing single-owner FOV block
      reads CBZ.fpsScopeFov(), so there is no second writer to race), look
      sensitivity scaled DOWN by the same fov ratio (CBZ.fpsLookSensMul, read
      by camera.js yaw + fpsmode pitch), a full-screen blacked-ring overlay
      with a fine mil crosshair, and a slight idle sway applied to the ACTUAL
      aim (cam.yaw / fps.fp) so the round flies where the swaying reticle
      points — scoped fire IS the zoomed camera ray. Third person snaps to
      first person while scoped (scopeview.js's own magnified-optic pattern)
      and restores on release. A gunsmith-bought optic (city/gunmods.js +
      scopeview.js) takes precedence: if one is fitted this system stands
      down entirely so the two overlays can never fight.
      Touch-layer API: CBZ.fpsCanScope() / CBZ.fpsScope(down) hold-style /
      CBZ.fpsScopeToggle() — both styles implemented.

   ENGINE CONTRACT: plain IIFE on window.CBZ, THREE r128, no build step.
   Every cross-module read is feature-detected + resolved at call time.
   Runtime-only FX may use Math.random (sway drift) — nothing here touches a
   world-build path. Loads AFTER fpsmode.js + scopeview.js (index.html) so it
   can wrap CBZ.cityScopeHigh for gamepad fine-aim.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- feature flags (one-line revert each) --------------------------------
  if (CBZ.CONFIG.WEAPON_LOCKON == null) CBZ.CONFIG.WEAPON_LOCKON = true;

  // ---- HOMING ON/OFF (owner: "make homing something you can turn off and
  // on, even on the iPad"). Runtime session state, default ON. OFF = rockets
  // dumb-fire straight even with a red lock, and the whole square UI stands
  // down (dumb-fire mode is visually quiet). fpsmode's [H] key and the touch
  // pill both drive it through this one setter.
  let homingOn = true;
  CBZ.lockonHomingOn = function () { return homingOn; };
  CBZ.lockonHomingSet = function (v) {
    v = v !== false;
    if (v === homingOn) return homingOn;
    homingOn = v;
    if (!homingOn) resetAll();
    return homingOn;
  };
  if (CBZ.CONFIG.SNIPER_REAL_SCOPE == null) CBZ.CONFIG.SNIPER_REAL_SCOPE = true;
  // UNIVERSAL ACQUISITION (owner: "homing works for vehicles and planes, but
  // doesn't work for small planes / police helicopters / a lot of things like
  // that"): every module that owns a craft list enumerates ALL its live craft
  // into the candidate pool, instead of the old single-best-along-the-ray
  // acquire calls that hid every craft but one (and covered no ambient/police
  // air at all). false = the pre-universal two-acquire behaviour.
  if (CBZ.CONFIG.LOCKON_UNIVERSAL_TARGETS == null) CBZ.CONFIG.LOCKON_UNIVERSAL_TARGETS = true;

  const DEG = Math.PI / 180;

  /* ==========================================================================
     1) LOCK-ON
  ========================================================================== */

  // per-platform seeker tuning. turnRate is the per-weapon homing cap the
  // owner asked for: the shoulder-fired RPG is sluggish and dramatic, an
  // air-to-air shot off a jet rail is snappy, vehicle pods sit in between.
  const PLATFORMS = {
    rpg:  { range: 280, acquire: Math.cos(8 * DEG),  keep: Math.cos(17 * DEG), lockT: 0.60, turnRate: 2.2, proxPad: 1.2 },
    air:  { range: 430, acquire: Math.cos(11 * DEG), keep: Math.cos(25 * DEG), lockT: 0.35, turnRate: 4.2, proxPad: 2.2 },
    tank: { range: 240, acquire: Math.cos(9 * DEG),  keep: Math.cos(18 * DEG), lockT: 0.50, turnRate: 3.2, proxPad: 1.5 },
    car:  { range: 240, acquire: Math.cos(9 * DEG),  keep: Math.cos(18 * DEG), lockT: 0.50, turnRate: 3.2, proxPad: 1.5 },
  };
  const LIST_CONE = Math.cos(62 * DEG);   // candidates surface (green) inside this of the aim
  const MIN_LOCK_DIST = 9;                // never lock the car you're standing on
  const MAX_SQUARES = 8;                  // busy streets don't wallpaper the screen
  const MAX_CANDS = 24;                   // scoring pool cap
  const LOS_GRACE = 0.45;                 // s a LOCK survives behind cover before breaking
  const AIM_HYST = 0.75;                  // rival must beat the current acquiring score by this (interactions.js idiom)

  // ---- scratch (no per-frame allocation) ----
  const _aimO = new THREE.Vector3();      // aim ray origin (world)
  const _aimD = new THREE.Vector3();      // aim ray dir (unit)
  const _v = new THREE.Vector3();         // projection scratch
  const _losO = new THREE.Vector3();
  const _losD = new THREE.Vector3();
  const _ray = new THREE.Raycaster();

  // ---- candidate slots (persistent pool; obj-keyed for hysteresis) ----
  function makeSlot() {
    return { used: false, obj: null, key: "", kind: "", seek: null,
      x: 0, y: 0, z: 0, radius: 2, dist: 0, dot: 0, score: 0,
      losBlocked: false, losT: -9, sx: 50, sy: 50, px: 40, inView: false };
  }
  const slots = [];
  for (let i = 0; i < MAX_CANDS; i++) slots.push(makeSlot());
  let slotCount = 0;
  const order = [];                        // sort indices (persistent, ints only)

  // seek closures are allocated only when a slot BINDS a new object (rare),
  // never per frame. Cars/military records are live objects; every other
  // craft registry hands us its own per-craft cached seek getters (see the
  // EnumTargets contract below).
  function carSeek(c) {
    return function () {
      if (!c || c.dead || !c.pos || !c.group || c.group.visible === false) return null;
      const dm = c.dims || {};
      return { x: c.pos.x, y: (c.pos.y || 0) + (dm.height || 1.8) * 0.55, z: c.pos.z };
    };
  }
  function milSeek(v) {
    return function () {
      if (!v || v.destroyed || !v.group || !v.group.parent || v.group.visible === false) return null;
      return { x: v.pos.x, y: (v.pos.y || 0) + 1.6, z: v.pos.z };
    };
  }

  // ---- universal craft enumeration (CBZ.CONFIG.LOCKON_UNIVERSAL_TARGETS) ----
  // Contract: each list-owner module exposes cityXxxEnumTargets(cb) beside its
  // older single-best acquire API (kept for the legacy pull-time homing path).
  // The module calls cb(obj, seek, x, y, z, radius, kind) once per LIVE craft
  // — obj is the stable record identity, seek a per-craft CACHED zero-arg
  // getter (live {x,y,z} or null once the craft dies/despawns) — and stops
  // walking when cb returns false (pool full). Modules do live-ness filtering;
  // range/cone scoring happens here. Nothing in this path may allocate per
  // frame: the callback below is built once, and the seek getters are cached
  // on the craft records by their owners.
  const ENUM_SOURCES = [
    "cityAircraftEnumTargets",        // aircraft.js — 5★ military gunship + jets
    "cityCivilAircraftEnumTargets",   // island_airport.js — parked airliner / private jets
    "cityPoliceAirEnumTargets",       // police.js — the 3★ Air-1 searchlight chopper
    "cityAirTrafficEnumTargets",      // airtraffic.js — ambient GA planes + light helis
    "cityPlayerAircraftEnumTargets",  // playeraircraft.js — the player's parked birds
    "cityPlayerAirEnumTargets",       // playerair.js — summoned taxi heli + strike jet
  ];
  let _enumT = null;                       // platform tuning for the running pass
  // Stable per-craft slot keys. Object identity is the primary hysteresis
  // match; the key only needs to be unique and STABLE so slot LOS state isn't
  // reset by list-index churn the way the "car"+i keys are.
  let _ukeyN = 0;
  const _ukeys = typeof WeakMap === "function" ? new WeakMap() : null;
  function ukey(obj) {
    if (!_ukeys) return "u?";
    let k = _ukeys.get(obj);
    if (!k) { k = "u" + (_ukeyN++); _ukeys.set(obj, k); }
    return k;
  }
  function enumCB(obj, seek, x, y, z, radius, kind) {
    if (slotCount >= MAX_CANDS) return false;
    if (!obj || typeof obj !== "object" || !seek) return true;
    const P = CBZ.player;
    if (P && obj === P._aircraft) return true;   // never square the craft you're flying
    const dx = x - _aimO.x, dy = y - _aimO.y, dz = z - _aimO.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < MIN_LOCK_DIST || d > _enumT.range) return true;
    const dot = (dx * _aimD.x + dy * _aimD.y + dz * _aimD.z) / d;
    if (dot < LIST_CONE) return true;
    const s = slots[slotCount++];
    bindSlot(s, obj, ukey(obj), kind || "aircraft", seek, x, y, z, radius || 3.2, d, dot);
    return slotCount < MAX_CANDS;
  }

  // ---- lock state ----
  // aim = the candidate currently being ACQUIRED (yellow); lock = RED.
  // Both are obj/key snapshots with their own seek closure so they survive
  // slot recycling between frames.
  let aimObj = null, aimKey = "", aimSeek = null, aimKind = "", aimRadius = 2, aimProgress = 0;
  let lockObj = null, lockKey = "", lockSeek = null, lockKind = "", lockRadius = 2, lockDist = 0;
  let lockLosT = 0;                        // s the lock has been continuously occluded
  let lockFlash = 0;                       // brief square pop on lock / on launch
  let launchAt = -1, launchKind = "";      // CBZ.lockonLastLaunch feedback
  let platKey = "";                        // "" | "rpg" | "air" | "tank" | "car"
  let losRR = 0;                           // round-robin cursor for green-candidate LOS

  function sfx(n, o) { if (CBZ.sfx) { try { CBZ.sfx(n, o); } catch (e) {} } }

  // which missile platform (if any) the player is presenting right now.
  // Fills _aimO/_aimD with the platform's true fire ray.
  function platform() {
    if (CBZ.CONFIG.WEAPON_LOCKON === false) return "";
    const g = CBZ.game;
    if (!g || g.state !== "playing") return "";
    const P = CBZ.player;
    if (!P || P.dead || !CBZ.camera) return "";
    // FLYING an armed aircraft: missiles leave the NOSE, so score off it.
    const craft = P._aircraft;
    if (craft && craft.armed !== false && (craft.ammo == null || craft.ammo > 0) && craft.pos != null) {
      const cp = Math.cos(craft.pitch || 0);
      _aimD.set(Math.sin(craft.heading || 0) * cp, Math.sin(craft.pitch || 0), Math.cos(craft.heading || 0) * cp);
      if (_aimD.lengthSq() < 1e-6) _aimD.set(0, 0, 1); else _aimD.normalize();
      _aimO.set(craft.pos.x, craft.pos.y, craft.pos.z);
      return "air";
    }
    // TANK main gun (militaryvehicles.js armor sim; the turret slews to the
    // camera's look heading, so the camera ray IS the converged fire intent).
    if (CBZ.cityArmorActive && CBZ.cityArmorActive()) {
      CBZ.camera.getWorldDirection(_aimD).normalize();
      _aimO.copy(CBZ.camera.position);
      return "tank";
    }
    // CAR with a fitted modshop rocket launcher (fires camera-forward).
    const car = P._vehicle;
    if (car && car.mods && car.mods.launcher && (car.mods.launcher.ammo | 0) > 0) {
      CBZ.camera.getWorldDirection(_aimD).normalize();
      _aimO.copy(CBZ.camera.position);
      return "car";
    }
    // ON FOOT with the RPG (FPS or the shoulder cam) — the camera ray is the
    // same intent ray shoot() samples (aimForward/preKickAim).
    if (P.driving) return "";
    const w = CBZ.currentGun && CBZ.currentGun();
    if (w && w.explosive && (CBZ.fpsActive && CBZ.fpsActive() || (CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive()))) {
      CBZ.camera.getWorldDirection(_aimD).normalize();
      _aimO.copy(CBZ.camera.position);
      return "rpg";
    }
    return "";
  }

  // LOS: is the straight line aim-origin → candidate blocked by world
  // geometry? Same blocker set fpsmode's wallDistance consults; the small
  // end-margin keeps the target's own bounding fuzz from counting as cover.
  function losBlockedTo(x, y, z, dist) {
    const blockers = CBZ.losBlockers;
    if (!blockers || !blockers.length) return false;
    _losD.set(x - _aimO.x, y - _aimO.y, z - _aimO.z);
    const d = _losD.length();
    if (d < 1e-4) return false;
    _losD.multiplyScalar(1 / d);
    _losO.copy(_aimO);
    _ray.set(_losO, _losD);
    _ray.far = Math.max(0.1, Math.min(dist, d) - 1.6);
    const hits = CBZ.losRaycast ? CBZ.losRaycast(_ray, blockers) : _ray.intersectObjects(blockers, false);
    return !!(hits && hits.length);
  }

  function bindSlot(s, obj, key, kind, seek, x, y, z, radius, dist, dot) {
    if (s.obj !== obj || s.key !== key) {   // new binding → fresh closure + LOS state
      s.obj = obj; s.key = key; s.losBlocked = false; s.losT = -9;
      s.seek = seek;
    } else if (seek && kind !== "car" && kind !== "mil") {
      s.seek = seek;                        // aircraft getters refresh each frame
    }
    s.used = true; s.kind = kind;
    s.x = x; s.y = y; s.z = z; s.radius = radius; s.dist = dist; s.dot = dot;
    s.score = (1 - dot) * 8 + (dist / (PLATFORMS[platKey] ? PLATFORMS[platKey].range : 280)) * 0.5;
  }

  // gather candidates into the slot pool. Cheap: distance/cone math per
  // vehicle, no raycasts here (LOS is budgeted separately).
  function gatherCandidates(T) {
    slotCount = 0;
    const P = CBZ.player;
    const ownCar = P && P._vehicle;
    // ---- street cars ----
    const cars = CBZ.game.mode === "city" && CBZ.cityCars;
    if (cars) {
      for (let i = 0; i < cars.length && slotCount < MAX_CANDS; i++) {
        const c = cars[i];
        if (!c || c.dead || c === ownCar || (c.player && P && P.driving) || !c.pos || !c.group || c.group.visible === false) continue;
        const dm = c.dims || {};
        const cy = (c.pos.y || 0) + (dm.height || 1.8) * 0.55;
        const dx = c.pos.x - _aimO.x, dy = cy - _aimO.y, dz = c.pos.z - _aimO.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < MIN_LOCK_DIST || d > T.range) continue;
        const dot = (dx * _aimD.x + dy * _aimD.y + dz * _aimD.z) / d;
        if (dot < LIST_CONE) continue;
        const s = slots[slotCount++];
        const wasSame = s.obj === c;
        bindSlot(s, c, "car" + i, "car", wasSame ? s.seek : carSeek(c), c.pos.x, cy, c.pos.z,
          Math.max(1.4, Math.min(3.0, (dm.length || 4.6) * 0.45)), d, dot);
      }
    }
    // ---- military machines / parked aircraft (tanks, helis, jets, gate planes) ----
    const mil = CBZ.game.mode === "city" && CBZ.cityMilitaryVehicles;
    if (mil) {
      for (let i = 0; i < mil.length && slotCount < MAX_CANDS; i++) {
        const v = mil[i];
        if (!v || v.destroyed || !v.pos || !v.group || !v.group.parent || v.group.visible === false) continue;
        const vy = (v.pos.y || 0) + 1.6;
        const dx = v.pos.x - _aimO.x, dy = vy - _aimO.y, dz = v.pos.z - _aimO.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < MIN_LOCK_DIST || d > T.range) continue;
        const dot = (dx * _aimD.x + dy * _aimD.y + dz * _aimD.z) / d;
        if (dot < LIST_CONE) continue;
        const s = slots[slotCount++];
        const wasSame = s.obj === v;
        bindSlot(s, v, "mil" + i, "mil", wasSame ? s.seek : milSeek(v), v.pos.x, vy, v.pos.z,
          Math.max(1.8, Math.min(4.0, (v.footL || 5) * 0.5)), d, dot);
      }
    }
    // ---- EVERY other craft registry (police air, civil aircraft, ambient GA
    // traffic, the player's own parked/summoned birds): walk the plural
    // EnumTargets twins so each live craft gets its own candidate square. The
    // old single-best acquire calls surfaced ONE craft along the whole ray
    // and covered no ambient/police air at all — the owner's "doesn't work
    // for small planes / police helicopters" report.
    const universal = CBZ.CONFIG.LOCKON_UNIVERSAL_TARGETS !== false;
    if (CBZ.game.mode === "city" && universal) {
      _enumT = T;
      for (let i = 0; i < ENUM_SOURCES.length && slotCount < MAX_CANDS; i++) {
        const fn = CBZ[ENUM_SOURCES[i]];
        if (fn) { try { fn(enumCB); } catch (e) {} }
      }
    }
    // Single-best acquire fallbacks: the whole pre-universal behaviour when
    // the flag is off, and a safety net for a build missing an enum twin.
    if (CBZ.game.mode === "city" && slotCount < MAX_CANDS && CBZ.cityAircraftAcquireTarget &&
        (!universal || !CBZ.cityAircraftEnumTargets)) {
      const a = CBZ.cityAircraftAcquireTarget(_aimO.x, _aimO.y, _aimO.z, _aimD.x, _aimD.y, _aimD.z, T.range, LIST_CONE);
      if (a && a.seek) {
        const p = a.seek();
        if (p) {
          const s = slots[slotCount++];
          bindSlot(s, "police-air", "police-air", "aircraft", a.seek, p.x, p.y, p.z, a.radius || 3.4, a.distance, a.dot);
        }
      }
    }
    if (CBZ.game.mode === "city" && slotCount < MAX_CANDS && CBZ.cityCivilAircraftAcquireTarget &&
        (!universal || !CBZ.cityCivilAircraftEnumTargets)) {
      const a = CBZ.cityCivilAircraftAcquireTarget(_aimO.x, _aimO.y, _aimO.z, _aimD.x, _aimD.y, _aimD.z, T.range, LIST_CONE);
      if (a && a.seek) {
        const p = a.seek();
        if (p) {
          const s = slots[slotCount++];
          bindSlot(s, "civil-air", "civil-air", "aircraft", a.seek, p.x, p.y, p.z, a.radius || 4.2, a.distance, a.dot);
        }
      }
    }
    // DEDUPE (owner: "multiple green squares on one vehicle"): a single craft
    // can surface from two registries at once — a parked airliner lives in the
    // military list AND the civil-aircraft acquirer; police air can double
    // with a mil record. Collapse any slots whose anchor points sit within a
    // hull-ish radius of an earlier one (keep the earlier = closer-scored
    // source). O(n²) over ≤MAX_CANDS slots — negligible.
    let w = 0;
    for (let i = 0; i < slotCount; i++) {
      const a = slots[i];
      let dup = false;
      for (let j = 0; j < w; j++) {
        const b = slots[j];
        const ddx = a.x - b.x, ddy = a.y - b.y, ddz = a.z - b.z;
        if (ddx * ddx + ddy * ddy + ddz * ddz < 3.2 * 3.2) { dup = true; break; }
      }
      if (dup) continue;
      if (w !== i) {
        const t = slots[w]; slots[w] = slots[i]; slots[i] = t;   // swap slot OBJECTS (pooled DOM stays owned by its slot)
      }
      w++;
    }
    slotCount = w;
    for (let i = slotCount; i < MAX_CANDS; i++) slots[i].used = false;
  }

  function findSlotByKeyObj(key, obj) {
    for (let i = 0; i < slotCount; i++) {
      const s = slots[i];
      if (s.used && (s.obj === obj || s.key === key)) return s;
    }
    return null;
  }

  function clearAim() { aimObj = null; aimKey = ""; aimSeek = null; aimProgress = 0; }
  function clearLock(quiet) {
    if (lockObj && !quiet) sfx("empty", { pitch: 0.82, volume: 0.16 });
    lockObj = null; lockKey = ""; lockSeek = null; lockLosT = 0;
  }
  function resetAll() { clearAim(); clearLock(true); }

  // ---- the per-frame lock state machine (runs at onAlways 54, after the
  // camera is final for the frame: camera.js 50 / fpsmode 52 / scopeview 53) --
  function lockTick(dt) {
    const prevPlat = platKey;
    platKey = platform();
    if (!platKey) { if (prevPlat) resetAll(); hideSquares(); return; }
    if (!homingOn) { if (prevPlat) resetAll(); hideSquares(); return; }   // dumb-fire mode: no squares, no locks
    if (platKey !== prevPlat) resetAll();   // switching seat/weapon drops the lock
    const T = PLATFORMS[platKey];
    gatherCandidates(T);

    // LOS budget: one green candidate per frame round-robin; the acquiring +
    // locked targets are checked EVERY frame (they gate real homing).
    if (slotCount > 0) {
      losRR = (losRR + 1) % slotCount;
      const s = slots[losRR];
      if (s.used) { s.losBlocked = losBlockedTo(s.x, s.y, s.z, s.dist); s.losT = 0; }
    }

    // ---- LOCKED: validate or break ----
    if (lockObj) {
      const p = lockSeek && lockSeek();
      let ok = !!p;
      if (ok) {
        const dx = p.x - _aimO.x, dy = p.y - _aimO.y, dz = p.z - _aimO.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        lockDist = d;
        const dot = d > 1e-4 ? (dx * _aimD.x + dy * _aimD.y + dz * _aimD.z) / d : 1;
        if (d > T.range * 1.15 || dot < T.keep) ok = false;
        else if (losBlockedTo(p.x, p.y, p.z, d)) {
          lockLosT += dt;                       // grace: cover must HOLD to break the lock
          if (lockLosT > LOS_GRACE) ok = false;
        } else lockLosT = 0;
      }
      if (!ok) clearLock();
    }

    // ---- ACQUIRING (only while not locked): nearest-to-crosshair wins, with
    // hysteresis so two close cars don't strobe the yellow square ----
    if (!lockObj) {
      let best = null;
      for (let i = 0; i < slotCount; i++) {
        const s = slots[i];
        if (!s.used || s.dot < T.acquire || s.losBlocked) continue;
        if (!best || s.score < best.score) best = s;
      }
      const cur = aimObj ? findSlotByKeyObj(aimKey, aimObj) : null;
      // current acquiring target keeps its role unless the rival is clearly
      // better (interactions.js HYSTERESIS idiom) AND it itself still tracks.
      if (cur && cur.used && cur.dot >= T.acquire * 0.995 && !cur.losBlocked &&
          (!best || best === cur || best.score + AIM_HYST > cur.score)) best = cur;
      if (best) {
        if (best.obj !== aimObj) {
          aimObj = best.obj; aimKey = best.key; aimKind = best.kind;
          aimSeek = best.seek; aimRadius = best.radius; aimProgress = 0;
          sfx("switch", { pitch: 1.5, volume: 0.2 });
        } else {
          aimSeek = best.seek; aimRadius = best.radius;
        }
        // per-frame LOS on the acquiring target — never walk a lock up through a wall
        if (losBlockedTo(best.x, best.y, best.z, best.dist)) { best.losBlocked = true; aimProgress = Math.max(0, aimProgress - dt * 2); }
        else {
          aimProgress += dt / T.lockT;
          if (aimProgress >= 1) {
            lockObj = aimObj; lockKey = aimKey; lockKind = aimKind;
            lockSeek = aimSeek; lockRadius = aimRadius; lockDist = best.dist;
            lockLosT = 0; lockFlash = 0.16;
            clearAim();
            sfx("key", { pitch: 1.55, volume: 0.5 });   // the lock CLUNK
          }
        }
      } else if (aimObj) {
        aimProgress -= dt * 2.5;                        // aim drifted off — bleed out
        if (aimProgress <= 0) clearAim();
      }
    }

    if (lockFlash > 0) lockFlash = Math.max(0, lockFlash - dt);
    drawSquares(T);
  }

  /* ---- overlay: pooled DOM squares (built once, class-toggled) ------------ */
  let overlay = null;
  const squares = [];                       // { el, shown, cls, w }
  function buildOverlay() {
    if (overlay || typeof document === "undefined" || !document.body) return;
    const st = document.createElement("style");
    st.textContent =
      "#lockonOverlay{position:fixed;inset:0;pointer-events:none;z-index:36;overflow:hidden}" +
      ".lksq{position:absolute;left:0;top:0;box-sizing:border-box;display:none;will-change:transform;" +
        "border:1.5px solid rgba(112,255,150,.78);box-shadow:0 0 6px rgba(70,255,120,.22),inset 0 0 4px rgba(70,255,120,.12)}" +
      ".lksq.y{border-color:#ffd451;border-width:2px;box-shadow:0 0 9px rgba(255,212,81,.4),inset 0 0 5px rgba(255,212,81,.18)}" +
      ".lksq.r{border-color:#ff3b30;border-width:2.5px;box-shadow:0 0 12px rgba(255,59,48,.55),inset 0 0 6px rgba(255,59,48,.22)}" +
      ".lksq i{position:absolute;width:9px;height:9px;display:none;border:0 solid #ff3b30}" +
      ".lksq.r i{display:block}" +
      ".lksq i.tl{left:-4px;top:-4px;border-left-width:3px;border-top-width:3px}" +
      ".lksq i.tr{right:-4px;top:-4px;border-right-width:3px;border-top-width:3px}" +
      ".lksq i.bl{left:-4px;bottom:-4px;border-left-width:3px;border-bottom-width:3px}" +
      ".lksq i.br{right:-4px;bottom:-4px;border-right-width:3px;border-bottom-width:3px}";
    // NO text on any square (owner: "it shouldn't say lock") — lock state is
    // carried entirely by color (green/yellow/red), the hard corner ticks, and
    // the lock tone, per the word-free combat HUD doctrine.
    document.head.appendChild(st);
    overlay = document.createElement("div");
    overlay.id = "lockonOverlay";
    for (let i = 0; i < MAX_SQUARES; i++) {
      const el = document.createElement("div");
      el.className = "lksq";
      for (const c of ["tl", "tr", "bl", "br"]) {
        const k = document.createElement("i");
        k.className = c;
        el.appendChild(k);
      }
      overlay.appendChild(el);
      squares.push({ el, shown: false, cls: "", w: -1 });
    }
    document.body.appendChild(overlay);
  }
  function hideSquares() {
    for (let i = 0; i < squares.length; i++) {
      const q = squares[i];
      if (q.shown) { q.el.style.display = "none"; q.shown = false; }
    }
  }

  // project one world point through the LIVE camera; fills s.sx/sy/px/inView.
  function projectSlot(s, fovTan) {
    _v.set(s.x, s.y, s.z).project(CBZ.camera);
    s.inView = _v.z > -1 && _v.z < 1 && _v.x > -1.04 && _v.x < 1.04 && _v.y > -1.06 && _v.y < 1.06;
    if (!s.inView) return;
    s.sx = (_v.x * 0.5 + 0.5) * 100;
    s.sy = (-_v.y * 0.5 + 0.5) * 100;
    const h = window.innerHeight || 800;
    s.px = Math.max(26, Math.min(h * 0.32, (s.radius * 1.7) * h / (2 * Math.max(4, s.dist) * fovTan)));
  }

  function styleSquare(q, cls, sxPct, syPct, px, rot, scale) {
    if (cls !== q.cls) { q.el.className = "lksq" + (cls ? " " + cls : ""); q.cls = cls; }
    const w = Math.round(px);
    if (w !== q.w) { q.el.style.width = w + "px"; q.el.style.height = w + "px"; q.w = w; }
    q.el.style.transform =
      "translate(calc(" + sxPct.toFixed(2) + "vw - 50%),calc(" + syPct.toFixed(2) + "vh - 50%))" +
      (rot ? "rotate(" + rot.toFixed(1) + "deg)" : "") +
      (scale !== 1 ? "scale(" + scale.toFixed(3) + ")" : "");
    if (!q.shown) { q.el.style.display = "block"; q.shown = true; }
  }

  function drawSquares(T) {
    buildOverlay();
    if (!overlay || !CBZ.camera) return;
    const fovTan = Math.tan(((CBZ.camera.fov || 60) * DEG) / 2);
    // sort candidate indices by score (persistent int array — no allocation)
    order.length = 0;
    for (let i = 0; i < slotCount; i++) if (slots[i].used) order.push(i);
    order.sort(function (a, b) { return slots[a].score - slots[b].score; });
    let qi = 0;
    // RED square first — the locked target always gets a square.
    if (lockObj) {
      const p = lockSeek && lockSeek();
      if (p) {
        // project directly (the lock may not occupy a slot this frame)
        _v.set(p.x, p.y, p.z).project(CBZ.camera);
        if (_v.z > -1 && _v.z < 1) {
          const sx = (_v.x * 0.5 + 0.5) * 100, sy = (-_v.y * 0.5 + 0.5) * 100;
          const h = window.innerHeight || 800;
          const px = Math.max(30, Math.min(h * 0.32, (lockRadius * 1.7) * h / (2 * Math.max(4, lockDist) * fovTan)));
          const pop = lockFlash > 0 ? 1 + lockFlash * 1.6 : 1;
          styleSquare(squares[qi++], "r", Math.max(-4, Math.min(104, sx)), Math.max(-4, Math.min(104, sy)), px, 0, pop);
        }
      }
    }
    for (let oi = 0; oi < order.length && qi < MAX_SQUARES; oi++) {
      const s = slots[order[oi]];
      if (lockObj && (s.obj === lockObj || s.key === lockKey)) continue;   // red already drawn
      if (s.losBlocked) continue;                                          // behind a wall → no square
      projectSlot(s, fovTan);
      if (!s.inView) continue;
      if (!lockObj && aimObj && (s.obj === aimObj || s.key === aimKey)) {
        // YELLOW: the acquiring square TIGHTENS onto the target (scale 1.75→1 as
        // progress walks to the lock). The old build ALSO spun it 135°→0°, which
        // the owner killed ("goes yellow→red and spins the square — really
        // stupid"): the color flip, the corner ticks and the lock tone carry the
        // acquire read now. Set LOCKON_SQUARE_SPIN=true to restore the rotation.
        const k = Math.max(0, Math.min(1, aimProgress));
        const spin = CBZ.CONFIG.LOCKON_SQUARE_SPIN === true ? (1 - k) * 135 : 0;
        styleSquare(squares[qi++], "y", s.sx, s.sy, s.px, spin, 1 + (1 - k) * 0.75);
      } else {
        styleSquare(squares[qi++], "", s.sx, s.sy, s.px, 0, 1);
      }
    }
    for (let i = qi; i < squares.length; i++) {
      const q = squares[i];
      if (q.shown) { q.el.style.display = "none"; q.shown = false; }
    }
  }

  /* ---- fire-time integration ---------------------------------------------- */

  // build the guided-target record fpsmode's explosive branch consumes —
  // shaped exactly like acquireHomingTarget's result, plus the per-weapon
  // turnRate the lock system owns.
  function lockedRecord() {
    if (!lockObj || !lockSeek) return null;
    const p = lockSeek();
    if (!p) { clearLock(true); return null; }
    const T = PLATFORMS[platKey] || PLATFORMS.rpg;
    return {
      kind: lockKind, dot: 1, distance: lockDist,
      radius: Math.max(1.4, lockRadius + T.proxPad * 0.5),
      seek: lockSeek,
      turnRate: T.turnRate,
    };
  }

  // systems/fpsmode.js RPG branch. UNDEFINED = lock-on disabled → the caller
  // runs its byte-identical legacy path. NULL = system on, no red lock →
  // straight flight. Record = red lock → home on it.
  CBZ.lockonFireTarget = function () {
    if (!homingOn) return null;   // dumb-fire mode: red lock or not, no guidance
    if (CBZ.CONFIG.WEAPON_LOCKON === false) return undefined;
    const r = lockedRecord();
    if (r) { launchAt = (CBZ.now || Date.now()); launchKind = platKey; lockFlash = Math.max(lockFlash, 0.3); }
    return r;
  };

  // city/aircraft.js cityFireMissile. Same undefined/null/value contract; the
  // seek getter carries .turnRate (air-to-air snappier than the pool default)
  // and .prox (proximity fuse — near-misses still detonate).
  CBZ.lockonMissileSeek = function () {
    if (!homingOn) return null;   // dumb-fire mode
    if (CBZ.CONFIG.WEAPON_LOCKON === false) return undefined;
    const r = lockedRecord();
    if (!r) return null;
    const seek = r.seek, proxR = r.radius + (PLATFORMS[platKey] || PLATFORMS.air).proxPad;
    const fn = function () { return seek(); };
    fn.turnRate = r.turnRate;
    fn.prox = function (x, y, z) {
      const t = seek();
      if (!t) return false;
      const dx = t.x - x, dy = t.y - y, dz = t.z - z;
      return dx * dx + dy * dy + dz * dz <= proxR * proxR;
    };
    launchAt = (CBZ.now || Date.now()); launchKind = platKey; lockFlash = Math.max(lockFlash, 0.3);
    return fn;
  };

  /* ---- public state for the touch layer / HUD ----------------------------- */
  CBZ.lockonActive = function () { return !!platKey; };
  CBZ.lockonTarget = function () {
    if (!lockObj) return null;
    return { kind: lockKind, key: lockKey, obj: lockObj, dist: lockDist, seek: lockSeek, state: "locked" };
  };
  CBZ.lockonState = function () {
    return {
      active: !!platKey,
      platform: platKey,
      state: lockObj ? "locked" : (aimObj ? "acquiring" : (slotCount ? "scan" : "idle")),
      progress: lockObj ? 1 : Math.max(0, Math.min(1, aimProgress)),
      candidates: slotCount,
      locked: lockObj ? { kind: lockKind, dist: Math.round(lockDist) } : null,
    };
  };
  CBZ.lockonLastLaunch = function () { return launchAt >= 0 ? { t: launchAt, kind: launchKind } : null; };
  // TOUCH_AIM_ASSIST read surface (systems/touch.js): project the LIVE candidate
  // pool to screen so the touch layer can add gentle reticle friction + a small
  // magnetism nudge. PURE READ — never mutates aim / lock / acquire state (no
  // acquisition change). Each entry carries the NDC centre (nx,ny in -1..1, y
  // up), the world anchor (x,y,z) and the range (dist). Returns a REUSED array
  // (no per-call allocation) + a live count `n`. The pool is populated ONLY when
  // a missile platform is live (RPG on foot / armed aircraft / tank / rocket
  // car) — regular guns never fill it, so n===0 and the assist is a safe no-op.
  const _candScreen = [];
  for (let _ci = 0; _ci < MAX_CANDS; _ci++) _candScreen.push({ nx: 0, ny: 0, x: 0, y: 0, z: 0, dist: 0 });
  CBZ.lockonCandidateScreen = function () {
    let n = 0;
    if (platKey && CBZ.camera && slotCount > 0) {
      for (let i = 0; i < slotCount; i++) {
        const s = slots[i];
        if (!s.used || s.losBlocked) continue;      // behind a wall → not a target
        _v.set(s.x, s.y, s.z).project(CBZ.camera);
        if (!(_v.z > -1 && _v.z < 1)) continue;      // behind the camera / clipped
        const e = _candScreen[n++];
        e.nx = _v.x; e.ny = _v.y; e.x = s.x; e.y = s.y; e.z = s.z; e.dist = s.dist;
      }
    }
    return { n: n, arr: _candScreen };
  };

  /* ==========================================================================
     2) REAL SNIPER SCOPE
  ========================================================================== */

  const SCOPE_FOV = 16;                    // hip 75 → ~4.7× true optical zoom
  const SCOPE_HIP = 75;                    // fpsmode's fixed FP hip baseline
  let manualScope = false;                 // touch hold/toggle state
  let scopedNow = false;
  let scopeForcedFP = false;
  let swayT = 0, swayYawApplied = 0, swayPitchApplied = 0;
  let driftY = 0, driftP = 0, driftTgtY = 0, driftTgtP = 0, driftClock = 0;

  function scopeWeapon() {
    const w = CBZ.currentGun && CBZ.currentGun();
    return (w && (w.key === "sniper" || w.scoped === true)) ? w : null;
  }
  function canScope() {
    if (CBZ.CONFIG.SNIPER_REAL_SCOPE === false) return false;
    const g = CBZ.game;
    if (!g || g.state !== "playing") return false;
    const P = CBZ.player;
    if (!P || P.dead || P.driving || P._swim) return false;
    if (!scopeWeapon()) return false;
    // a bought gunsmith optic owns the scope experience (scopeview.js) —
    // stand down entirely so two overlays/FOV writers can never fight.
    if (CBZ.gunModsScopeOf && CBZ.currentWeaponId && CBZ.gunModsScopeOf(CBZ.currentWeaponId)) return false;
    return true;
  }

  // resolve the scoped state NOW (shared by the per-frame tick AND the touch
  // API calls, so a button tap engages the very same call — no one-frame lag).
  function resolveScope() {
    const want = canScope() && (manualScope || (CBZ.fpsAimHeld && CBZ.fpsAimHeld()));
    if (want && !scopedNow) scopeEngage();
    else if (!want && scopedNow) scopeRelease();
    return scopedNow;
  }

  // ---- touch-layer API (mobile agent wires these to a button) ----
  CBZ.fpsCanScope = canScope;
  CBZ.fpsScoped = function () { return scopedNow; };
  // hold-style: press = scope down, release = scope up. Also drives ADS so the
  // spread/recoil benefits and gun pose match the scoped read.
  CBZ.fpsScope = function (down) {
    manualScope = !!down && canScope();
    if (CBZ.fpsSetAim) CBZ.fpsSetAim(manualScope);
    resolveScope();
    return manualScope;
  };
  // toggle-style: one tap in, one tap out.
  CBZ.fpsScopeToggle = function () {
    manualScope = !manualScope && canScope();
    if (CBZ.fpsSetAim) CBZ.fpsSetAim(manualScope);
    resolveScope();
    return manualScope;
  };
  // fpsmode's single-owner FP FOV block reads this (takes precedence over the
  // plain ADS drop; a gunsmith optic never reaches here — canScope defers).
  CBZ.fpsScopeFov = function () { return scopedNow ? SCOPE_FOV : null; };
  // camera.js (yaw) + fpsmode (pitch) scale the mouse by this — proportional
  // to the zoom so a scoped flick covers the same WORLD angle feel.
  CBZ.fpsLookSensMul = function () { return scopedNow ? SCOPE_FOV / SCOPE_HIP : 1; };

  // gamepad fine-aim: gamepad.js already slows the right stick when a
  // magnified optic is live (CBZ.cityScopeHigh). Wrap it so OUR scope reads
  // high-mag too — scopeview.js's own answer still wins when it's the owner.
  const prevScopeHigh = CBZ.cityScopeHigh;
  CBZ.cityScopeHigh = function () {
    if (prevScopeHigh) { try { if (prevScopeHigh()) return true; } catch (e) {} }
    return scopedNow;
  };

  // ---- scope overlay (one DOM tree, display-toggled) ----
  let scopeEl = null;
  function buildScope() {
    if (scopeEl || typeof document === "undefined" || !document.body) return;
    scopeEl = document.createElement("div");
    scopeEl.id = "realScope";
    scopeEl.style.cssText = "position:fixed;inset:0;z-index:45;display:none;pointer-events:none;overflow:hidden";
    scopeEl.innerHTML =
      // glass + hard blackout ring (everything else recedes underneath)
      "<div style='position:absolute;inset:0;background:radial-gradient(circle at 50% 50%," +
        "rgba(140,175,205,.05) 0,rgba(20,30,40,.02) 20vmin,rgba(0,0,0,0) 32.6vmin,rgba(2,2,3,.995) 33.4vmin)'></div>" +
      // subtle in-glass vignette so the image sits IN a tube
      "<div style='position:absolute;inset:0;background:radial-gradient(circle at 50% 50%," +
        "rgba(0,0,0,0) 0,rgba(0,0,0,0) 24vmin,rgba(0,0,0,.28) 32vmin,rgba(0,0,0,0) 33vmin)'></div>" +
      // bezel
      "<div style='position:absolute;left:50%;top:50%;width:66.4vmin;height:66.4vmin;transform:translate(-50%,-50%);" +
        "border-radius:50%;border:3px solid rgba(8,9,11,.95);box-shadow:0 0 0 1.5px rgba(70,80,92,.45) inset,0 0 46px rgba(0,0,0,.7) inset'></div>" +
      // fine crosshair
      "<div style='position:absolute;left:50%;top:calc(50% - 33vmin);width:1px;height:66vmin;background:rgba(8,12,14,.92);transform:translateX(-.5px)'></div>" +
      "<div style='position:absolute;top:50%;left:calc(50% - 33vmin);height:1px;width:66vmin;background:rgba(8,12,14,.92);transform:translateY(-.5px)'></div>" +
      // mil ticks down each axis
      [8, 16, 24].map(function (d) {
        return "<div style='position:absolute;left:50%;top:calc(50% + " + d + "vmin);width:9px;height:1.5px;background:rgba(8,12,14,.9);transform:translate(-50%,-50%)'></div>" +
          "<div style='position:absolute;left:50%;top:calc(50% - " + d + "vmin);width:9px;height:1.5px;background:rgba(8,12,14,.9);transform:translate(-50%,-50%)'></div>" +
          "<div style='position:absolute;top:50%;left:calc(50% + " + d + "vmin);height:9px;width:1.5px;background:rgba(8,12,14,.9);transform:translate(-50%,-50%)'></div>" +
          "<div style='position:absolute;top:50%;left:calc(50% - " + d + "vmin);height:9px;width:1.5px;background:rgba(8,12,14,.9);transform:translate(-50%,-50%)'></div>";
      }).join("") +
      // centre dot
      "<div style='position:absolute;left:50%;top:50%;width:3px;height:3px;border-radius:50%;background:rgba(200,30,24,.9);transform:translate(-50%,-50%)'></div>";
    document.body.appendChild(scopeEl);
  }

  function crossEl() { return document.getElementById("crosshair"); }

  function scopeEngage() {
    scopedNow = true;
    swayT = 0; swayYawApplied = 0; swayPitchApplied = 0;
    driftY = driftP = driftTgtY = driftTgtP = 0; driftClock = 0;
    buildScope();
    if (scopeEl) scopeEl.style.display = "block";
    // magnified image needs the clean down-the-barrel view: snap to FP like
    // scopeview.js does for bought high-mag optics; restore on release.
    if (CBZ.fpsActive && !CBZ.fpsActive() && CBZ.fpsSetActive) {
      const P = CBZ.player;
      if (P && !P.driving && !P.dead) { CBZ.fpsSetActive(true); scopeForcedFP = true; }
    }
    sfx("rack", { pitch: 1.25, volume: 0.24 });
  }
  function scopeRelease() {
    scopedNow = false;
    // remove any residual sway so the aim lands exactly where it visually was
    if (CBZ.cam) CBZ.cam.yaw -= swayYawApplied;
    if (CBZ.fps && CBZ.fps.active) CBZ.fps.fp = Math.max(-1.3, Math.min(1.3, CBZ.fps.fp - swayPitchApplied));
    swayYawApplied = 0; swayPitchApplied = 0;
    if (scopeEl) scopeEl.style.display = "none";
    if (scopeForcedFP) {
      if (CBZ.fpsActive && CBZ.fpsActive() && CBZ.fpsSetActive) CBZ.fpsSetActive(false);
      scopeForcedFP = false;
    }
    // fpsmode only rewrites the crosshair display on STATE changes (cached),
    // so restore what we hid each scoped frame.
    const cx = crossEl();
    if (cx && CBZ.game && CBZ.game.state === "playing" &&
      ((CBZ.fpsActive && CBZ.fpsActive()) || (CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive()))) {
      cx.style.display = "block";
    }
  }

  // runs BEFORE fpsmode's onAlways(52) so this frame's camera write already
  // includes the sway and fpsmode's FOV block reads a current fpsScopeFov.
  CBZ.onAlways(51.5, function (dt) {
    if (manualScope && !canScope()) manualScope = false;   // weapon switched / context lost
    resolveScope();
    if (!scopedNow) return;

    // ---- idle sway: a slow figure-8 + a tiny random wander, applied to the
    // REAL aim (cam.yaw / fps.fp) so the fired round follows the swaying
    // reticle. Runtime-only FX — Math.random is allowed here.
    swayT += dt;
    driftClock -= dt;
    if (driftClock <= 0) {
      driftClock = 1.4 + Math.random() * 1.2;
      driftTgtY = (Math.random() - 0.5) * 0.0016;
      driftTgtP = (Math.random() - 0.5) * 0.0012;
    }
    driftY += (driftTgtY - driftY) * Math.min(1, dt * 1.2);
    driftP += (driftTgtP - driftP) * Math.min(1, dt * 1.2);
    const AMP = 0.0015;   // radians — a breath, not a wobble
    const wantYaw = Math.sin(swayT * 0.9) * AMP + Math.sin(swayT * 2.17 + 1.3) * AMP * 0.35 + driftY;
    const wantPitch = Math.cos(swayT * 1.23) * AMP * 0.8 + Math.sin(swayT * 2.9) * AMP * 0.3 + driftP;
    if (CBZ.cam) { CBZ.cam.yaw += wantYaw - swayYawApplied; swayYawApplied = wantYaw; }
    if (CBZ.fps && CBZ.fps.active) {
      CBZ.fps.fp = Math.max(-1.3, Math.min(1.3, CBZ.fps.fp + (wantPitch - swayPitchApplied)));
      swayPitchApplied = wantPitch;
    }
    // the optic's own reticle replaces the HUD crosshair while scoped
    const cx = crossEl();
    if (cx && cx.style.display !== "none") cx.style.display = "none";
  });

  // lock-on state machine + squares — AFTER the frame's final camera (camera
  // 50, fpsmode 52, scopeview 53) so projections match what's rendered.
  CBZ.onAlways(54, lockTick);
})();
