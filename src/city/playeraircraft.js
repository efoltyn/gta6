/* ============================================================
   city/playeraircraft.js — THE AIRPOWER YOU FLY YOURSELF.

   The apex of the empire: money → penthouse (home) → its HELICOPTER → the
   HANGAR → the F-22 RAPTOR. The home literally houses your force; missiles
   let you dominate or escape the city.

   This module owns the PLAYER-FLOWN aircraft (distinct from city/aircraft.js,
   which is the POLICE air threat, and city/playerair.js, which is the call-an-
   airstrike-from-the-phone system). Here you physically BOARD and FLY:

     • MISSILE HELICOPTER — yours the moment you own the penthouse
       (g.cityOwnsHeli). Parked on the rooftop helipad. Hovers, climbs, yaws,
       strafes; fires missiles from its nose.
     • F-22 RAPTOR — a buyable jet, based in the deck hangar once you own the
       hangar (g.cityOwnsHangar) AND buy the jet ($3M) at the hangar
       (g.cityOwnsJet). Always-forward arcade flight; wide fast turns.

   Built on the vehicles.js pattern: the player BOARDS on [F], we set
   P.driving=true so physics.js yields the transform, hide the player rig, and
   own the aircraft + player transform in an onUpdate AFTER physics. The
   existing GTA chase-cam (systems/camera.js, gated on player.driving) follows
   for free off player.pos + cam.yaw, which we steer behind the craft.

   Missiles fire through CBZ.cityFireMissile (Agent HOOKS owns it) so they reuse
   the real military missile pool + cityExplosion FX. EVERY cross-module global
   is feature-detected, so a missing sibling degrades gracefully and NOTHING
   here throws at load or worldgen.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  const boxGeo = CBZ.boxGeom || function (w, h, d) { return new THREE.BoxGeometry(w, h, d); };

  // ---- tunables (arcade flight — NOT realistic aero) -----------------------
  const JET_PRICE   = 3000000;     // $3M for the F-22
  const CEILING     = 220;         // hard altitude clamp (m)
  const GROUND_PAD  = 1.2;         // never sink the belly below this over the floor

  // HELI feel
  const HELI_THRUST = 26;          // forward accel
  const HELI_TOP    = 34;          // top forward speed
  const HELI_VLIFT  = 16;          // ascend/descend speed
  const HELI_YAW    = 1.7;         // rad/s yaw from A/D
  const HELI_DRAG   = 1.6;         // velocity bleed when no input (hover)

  // JET feel
  const JET_MIN     = 38;          // min cruise — never stalls/falls
  const JET_MAX     = 120;         // top throttle
  const JET_ACCEL   = 26;          // throttle response
  const JET_TURN    = 1.15;        // bank/turn rate (wide)
  const JET_CLIMB   = 34;          // climb/dive vertical speed

  // weapons
  const FIRE_CD     = 0.6;         // seconds between missiles
  const MISSILE_SPD = 60;          // muzzle ejection speed for the dir hint
  const HELI_AMMO   = 38;          // missiles before resupply
  const JET_AMMO    = 24;
  const RESUPPLY_AT_BASE = true;   // landing on the pad/hangar tops you back up

  // ---- module state --------------------------------------------------------
  let heli = null;                 // the helicopter craft object (or null)
  let jet = null;                  // the F-22 craft object (or null)
  let G = null;                    // lazy shared geometry/material cache
  let _lastHeliFlag = false, _lastJetFlag = false;   // for ownership-flip detection
  let _hudEl = null;

  function arenaRoot() {
    const a = CBZ.city && CBZ.city.arena;
    return a ? a.root : null;
  }
  function tower() {
    if (!CBZ.cityMegaTower) return null;
    try { return CBZ.cityMegaTower(); } catch (e) { return null; }
  }
  function floorY(x, z) {
    if (CBZ.floorAt) { try { return CBZ.floorAt(x, z) || 0; } catch (e) { return 0; } }
    return 0;
  }

  // ============================================================
  //  MODELS — both reuse cached shared mats/geoms (cmat/boxGeom) so a fleet of
  //  rotors/pods costs almost no extra draw setup. A clear nose "muzzle" empty
  //  is tagged on each so missiles spawn from the gun, not the centroid.
  // ============================================================
  function assets() {
    if (G) return G;
    const shared = (o) => { if (o) o._shared = true; return o; };
    G = {
      // shared materials (cmat already caches + flags _shared)
      mBody:   cmat(0x2b3038, { emissive: 0x0c0e12, ei: 0.25 }),
      mDark:   cmat(0x14171d, { emissive: 0x060708, ei: 0.2 }),
      mGrey:   cmat(0x6a727c, { emissive: 0x202329, ei: 0.3 }),
      mGlass:  cmat(0x16242e, { emissive: 0x0a151c, ei: 0.45 }),
      mJet:    cmat(0x424b58, { emissive: 0x10131a, ei: 0.12 }),
      mJetDk:  cmat(0x2c333d, { emissive: 0x0a0d12, ei: 0.15 }),
      mMissile:cmat(0xd8dde4, { emissive: 0x3a3e44, ei: 0.25 }),
      mWarn:   cmat(0xff5a3a, { emissive: 0xff3018, ei: 0.7 }),
      // shared rotor disc (semi-transparent blur) — its own non-cached mat so we
      // can keep it translucent without poisoning cmat's opaque cache
      rotorMat: shared(new THREE.MeshBasicMaterial({ color: 0x10131a, transparent: true, opacity: 0.42, depthWrite: false })),
    };
    return G;
  }

  // a small bright marker at the muzzle so the firing point reads
  function addMuzzle(grp, x, y, z) {
    const a = assets();
    const m = new THREE.Mesh(boxGeo(0.18, 0.18, 0.18), a.mWarn);
    m.position.set(x, y, z);
    grp.add(m);
    grp.userData.muzzle = m;                 // local-space muzzle node
    grp.userData.muzzleLocal = new THREE.Vector3(x, y, z);
  }

  // ---- HELICOPTER: fuselage + main rotor + tail rotor + skids + wing pods ---
  function buildHeli() {
    const a = assets();
    const grp = new THREE.Group();
    // fuselage (chunky nose-forward body, +Z is forward)
    const body = new THREE.Mesh(boxGeo(2.2, 1.4, 4.6), a.mBody); body.position.y = 0.2; grp.add(body);
    const nose = new THREE.Mesh(boxGeo(1.7, 1.0, 1.4), a.mBody); nose.position.set(0, 0.05, 2.6); grp.add(nose);
    // canopy glass
    const canopy = new THREE.Mesh(boxGeo(1.5, 0.85, 1.7), a.mGlass); canopy.position.set(0, 0.5, 1.7); grp.add(canopy);
    // tail boom + fin
    const boom = new THREE.Mesh(boxGeo(0.42, 0.42, 3.4), a.mBody); boom.position.set(0, 0.45, -3.6); grp.add(boom);
    const fin = new THREE.Mesh(boxGeo(0.2, 1.1, 0.7), a.mBody); fin.position.set(0, 0.9, -5.2); grp.add(fin);
    // skids
    [-0.95, 0.95].forEach((sx) => {
      const skid = new THREE.Mesh(boxGeo(0.16, 0.16, 3.4), a.mDark); skid.position.set(sx, -1.0, 0.1); grp.add(skid);
      const strut1 = new THREE.Mesh(boxGeo(0.14, 0.7, 0.14), a.mDark); strut1.position.set(sx, -0.55, 1.0); grp.add(strut1);
      const strut2 = new THREE.Mesh(boxGeo(0.14, 0.7, 0.14), a.mDark); strut2.position.set(sx, -0.55, -1.0); grp.add(strut2);
    });
    // stub wings + missile pods (so missiles read as "from the pods/nose")
    const wing = new THREE.Mesh(boxGeo(3.4, 0.18, 0.8), a.mGrey); wing.position.set(0, 0.0, 0.4); grp.add(wing);
    [-1.6, 1.6].forEach((px) => {
      const pod = new THREE.Mesh(boxGeo(0.5, 0.5, 1.7), a.mDark); pod.position.set(px, -0.15, 0.4); grp.add(pod);
    });
    // MAIN ROTOR (spins about Y) on a mast
    const mast = new THREE.Mesh(boxGeo(0.22, 0.5, 0.22), a.mDark); mast.position.y = 1.1; grp.add(mast);
    const rotor = new THREE.Mesh(boxGeo(9.2, 0.07, 0.6), a.rotorMat); rotor.position.y = 1.4; grp.add(rotor);
    const rotor2 = new THREE.Mesh(boxGeo(0.6, 0.07, 9.2), a.rotorMat); rotor2.position.y = 1.4; grp.add(rotor2);
    // TAIL ROTOR (spins about X)
    const trotor = new THREE.Mesh(boxGeo(0.07, 1.8, 0.3), a.rotorMat); trotor.position.set(0.22, 0.9, -5.4); grp.add(trotor);
    const trotor2 = new THREE.Mesh(boxGeo(0.07, 0.3, 1.8), a.rotorMat); trotor2.position.set(0.22, 0.9, -5.4); grp.add(trotor2);
    grp.userData.rotor = rotor; grp.userData.rotor2 = rotor2;
    grp.userData.trotor = trotor; grp.userData.trotor2 = trotor2;
    // nose muzzle
    addMuzzle(grp, 0, -0.1, 3.4);
    grp.userData.belly = 1.2;                // how far the skids hang below the origin
    return grp;
  }

  // ---- F-22 RAPTOR: angular delta-wing fuselage, twin tails, canopy, missiles
  function buildJet() {
    const a = assets();
    const grp = new THREE.Group();
    // sleek body (+Z forward)
    const body = new THREE.Mesh(boxGeo(1.5, 1.0, 8.6), a.mJet); grp.add(body);
    // angular nose cone
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.8, 4), a.mJet);
    nose.rotation.x = -Math.PI / 2; nose.rotation.z = Math.PI / 4; nose.position.z = 5.4; grp.add(nose);
    // raked canopy
    const canopy = new THREE.Mesh(boxGeo(0.95, 0.7, 2.2), a.mGlass); canopy.position.set(0, 0.55, 1.9); grp.add(canopy);
    // chined forebody (the angular shoulders)
    [-1, 1].forEach((s) => {
      const chine = new THREE.Mesh(boxGeo(1.0, 0.4, 4.0), a.mJetDk);
      chine.position.set(s * 0.9, -0.1, 2.0); chine.rotation.y = s * 0.12; grp.add(chine);
    });
    // delta wings (swept, wide)
    [-1, 1].forEach((s) => {
      const wing = new THREE.Mesh(boxGeo(4.2, 0.16, 3.4), a.mJet);
      wing.position.set(s * 2.6, -0.2, -0.6); wing.rotation.y = s * 0.34; grp.add(wing);
      // under-wing missile
      const msl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.8, 6), a.mMissile);
      msl.rotation.x = Math.PI / 2; msl.position.set(s * 2.2, -0.45, 0.2); grp.add(msl);
    });
    // twin canted vertical tails
    [-1, 1].forEach((s) => {
      const tail = new THREE.Mesh(boxGeo(0.16, 1.5, 1.6), a.mJet);
      tail.position.set(s * 0.9, 0.8, -3.4); tail.rotation.z = s * 0.32; grp.add(tail);
    });
    // horizontal stabs
    [-1, 1].forEach((s) => {
      const stab = new THREE.Mesh(boxGeo(2.2, 0.12, 1.4), a.mJet);
      stab.position.set(s * 1.6, -0.1, -3.8); grp.add(stab);
    });
    // twin exhaust nozzles + afterburner glow
    [-0.5, 0.5].forEach((s) => {
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.8, 8), a.mJetDk);
      noz.rotation.x = Math.PI / 2; noz.position.set(s, -0.05, -4.4); grp.add(noz);
    });
    const burn = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), a.mWarn);
    burn.scale.set(0.7, 0.7, 1.6); burn.position.set(0, -0.05, -5.0); grp.add(burn);
    grp.userData.burn = burn;
    // nose muzzle
    addMuzzle(grp, 0, 0, 5.6);
    grp.userData.belly = 0.6;
    return grp;
  }

  // ============================================================
  //  SPAWN / PLACEMENT
  // ============================================================
  function disposeGroup(obj) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    obj.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      const m = o.material;
      if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
    });
  }

  function makeCraft(kind) {
    const root = arenaRoot(); if (!root) return null;
    const grp = kind === "jet" ? buildJet() : buildHeli();
    root.add(grp);
    const craft = {
      kind, group: grp, muzzle: grp.userData.muzzleLocal || new THREE.Vector3(0, 0, 3),
      pos: grp.position, heading: 0, pitch: 0, roll: 0,
      vx: 0, vy: 0, vz: 0, speed: kind === "jet" ? JET_MIN : 0,
      fireCD: 0, ammo: kind === "jet" ? JET_AMMO : HELI_AMMO, maxAmmo: kind === "jet" ? JET_AMMO : HELI_AMMO,
      rotorSpin: 0,
      belly: grp.userData.belly || 1.0,
    };
    grp.userData.craft = craft;
    return craft;
  }

  // park the helicopter on the rooftop helipad
  function placeHeli() {
    if (!g.cityOwnsHeli) { if (heli) { disposeGroup(heli.group); heli = null; } return; }
    const t = tower(); const pad = t && t.helipad;
    if (!pad) { return; }                   // no pad yet — try again on the next heal pass
    if (!heli) { heli = makeCraft("heli"); if (!heli) return; }
    if (_aircraftFlying() === heli) return; // don't yank it out from under the pilot
    const px = pad.x, pz = pad.z;
    const py = (pad.y != null ? pad.y : floorY(px, pz)) + heli.belly;
    heli.pos.set(px, py, pz);
    heli.heading = 0; heli.pitch = 0; heli.roll = 0;
    heli.vx = heli.vy = heli.vz = 0; heli.speed = 0;
    heli.group.rotation.set(0, 0, 0);
    if (RESUPPLY_AT_BASE) heli.ammo = heli.maxAmmo;
  }

  // base the F-22 on the deck hangar
  function placeJet() {
    if (!g.cityOwnsJet) { if (jet) { disposeGroup(jet.group); jet = null; } return; }
    const t = tower(); const h = t && t.hangar;
    if (!h) { return; }
    if (!jet) { jet = makeCraft("jet"); if (!jet) return; }
    if (_aircraftFlying() === jet) return;
    const px = h.x, pz = h.z;
    const py = (h.y != null ? h.y : floorY(px, pz)) + jet.belly + 0.4;
    jet.pos.set(px, py, pz);
    jet.heading = 0; jet.pitch = 0; jet.roll = 0;
    jet.vx = jet.vy = jet.vz = 0; jet.speed = JET_MIN;
    jet.group.rotation.set(0, 0, 0);
    if (RESUPPLY_AT_BASE) jet.ammo = jet.maxAmmo;
  }

  function refreshFleet() {
    placeHeli();
    placeJet();
    _lastHeliFlag = !!g.cityOwnsHeli;
    _lastJetFlag = !!g.cityOwnsJet;
  }
  // expose for realestate / worldgen to nudge a re-place on ownership change
  CBZ.cityPlayerAircraftRefresh = refreshFleet;

  // ============================================================
  //  ENTER / EXIT (the vehicles.js board pattern)
  // ============================================================
  function _aircraftFlying() {
    const P = CBZ.player;
    return P && P._aircraft ? P._aircraft : null;
  }
  function craftLabel(c) { return c && c.kind === "jet" ? "F-22" : "Heli"; }

  function enterAircraft(craft) {
    if (!craft || !craft.group) return false;
    const P = CBZ.player; if (!P) return false;
    if (P._vehicle && CBZ.cityExitVehicle) CBZ.cityExitVehicle();   // can't fly from a car
    P.driving = true;                       // physics.js yields the transform
    P._aircraft = craft;
    P.vy = 0; P.grounded = false;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
    // snap the player marker into the cockpit
    P.pos.set(craft.pos.x, craft.pos.y, craft.pos.z);
    // point the chase-cam down the craft's nose
    if (CBZ.cam) CBZ.cam.yaw = craft.heading + Math.PI;
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
    if (CBZ.city && CBZ.city.note) {
      const ctrl = craft.kind === "jet"
        ? "W/S throttle · A/D bank · SPACE/CTRL climb/dive · L-click missiles · [F] eject"
        : "W/S thrust · A/D yaw · SPACE/CTRL up/down · mouse look · L-click missiles · [F] land";
      CBZ.city.note("✈ Flying the " + (craft.kind === "jet" ? "F-22 RAPTOR" : "missile chopper") + " — " + ctrl, 3.2);
    }
    return true;
  }

  function exitAircraft() {
    const P = CBZ.player; if (!P) return;
    const craft = P._aircraft;
    P.driving = false; P._aircraft = null;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;
    if (craft) {
      // settle the craft flat where it is, then drop the player onto the surface
      // beside it, never through the ground
      craft.group.rotation.set(0, craft.heading, 0);
      craft.pitch = craft.roll = 0; craft.vx = craft.vy = craft.vz = 0; craft.speed = craft.kind === "jet" ? JET_MIN : 0;
      const gy = floorY(craft.pos.x, craft.pos.z);
      const ox = Math.sin(craft.heading) * 2.2, oz = Math.cos(craft.heading) * 2.2;
      P.pos.set(craft.pos.x + ox, Math.max(gy, craft.pos.y - craft.belly), craft.pos.z + oz);
      P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    }
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
  }
  CBZ.cityPlayerAircraftExit = exitAircraft;

  // nearest owned, on-ground aircraft to the player (on foot)
  function nearestBoardable(x, z, maxd) {
    let best = null, bd = (maxd || 6) * (maxd || 6);
    [heli, jet].forEach((c) => {
      if (!c || !c.group) return;
      const dx = c.pos.x - x, dz = c.pos.z - z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = c; }
    });
    return best;
  }

  // ============================================================
  //  BUY THE F-22 (at the hangar)
  // ============================================================
  function atHangar(x, z) {
    const t = tower(); const h = t && t.hangar; if (!h) return false;
    const hw = (h.w || 10) / 2 + 4, hd = (h.d || 10) / 2 + 4;
    return Math.abs(x - h.x) <= hw && Math.abs(z - h.z) <= hd;
  }
  function tryBuyJet() {
    if (g.cityOwnsJet) return false;
    if (!g.cityOwnsHangar) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("Buy the HANGAR at the penthouse first — then the F-22 is yours to buy here.", 2.8);
      return false;
    }
    const total = (g.cash || 0) + (g.cityBank || 0);
    if (total < JET_PRICE) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("The F-22 RAPTOR costs $" + (JET_PRICE / 1e6).toFixed(0) + "M (cash+bank). Keep grinding.", 2.8);
      return false;
    }
    // charge cash first, then bank — mirror the home/hangar buy
    let owe = JET_PRICE;
    if (CBZ.city && CBZ.city.spend && (g.cash || 0) >= owe) {
      CBZ.city.spend(owe); owe = 0;
    } else {
      const fromCash = Math.min(g.cash || 0, owe); g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
      if (owe > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - owe);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    }
    g.cityOwnsJet = true;
    placeJet();
    if (CBZ.city && CBZ.city.big) CBZ.city.big("🛩 F-22 RAPTOR ACQUIRED");
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(40);
    if (CBZ.city && CBZ.city.note) CBZ.city.note("Your F-22 is on the deck. Stand near it and press [F] to fly.", 3.0);
    return true;
  }
  CBZ.cityBuyJet = tryBuyJet;

  // ============================================================
  //  INPUT — [F] board/eject + buy, [B] also buys at the hangar
  // ============================================================
  function activeCtx() {
    return g.mode === "city" && g.state === "playing" && document.pointerLockElement;
  }
  addEventListener("keydown", function (e) {
    if (!activeCtx() || e.repeat) return;
    const k = (e.key || "").toLowerCase();
    const P = CBZ.player; if (!P) return;
    if (k === "f") {
      // flying → eject; on foot → board nearest owned aircraft if close
      if (P._aircraft) { e.preventDefault(); exitAircraft(); return; }
      if (P.driving) return;                // in a car — vehicles.js owns [F]
      const c = nearestBoardable(P.pos.x, P.pos.z, 6.5);
      if (c) { e.preventDefault(); enterAircraft(c); }
    } else if (k === "b") {
      // buy the F-22 when standing at the hangar
      if (!P._aircraft && !P.driving && !g.cityOwnsJet && atHangar(P.pos.x, P.pos.z)) {
        e.preventDefault(); tryBuyJet();
      }
    }
  });

  // ============================================================
  //  FIRE MISSILES (left-click while flying)
  // ============================================================
  function fireMissile(craft) {
    if (!craft || craft.fireCD > 0) return;
    if (craft.ammo <= 0) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("Out of missiles — land on the pad/hangar to resupply.", 1.6);
      return;
    }
    // world-space muzzle position + forward direction
    const m = craft.group.userData.muzzle;
    let mx, my, mz;
    if (m) { const wp = m.getWorldPosition(new THREE.Vector3()); mx = wp.x; my = wp.y; mz = wp.z; }
    else { mx = craft.pos.x; my = craft.pos.y; mz = craft.pos.z; }
    // forward dir from heading + pitch (the craft's nose vector)
    const cp = Math.cos(craft.pitch);
    let dx = Math.sin(craft.heading) * cp;
    let dy = Math.sin(craft.pitch);
    let dz = Math.cos(craft.heading) * cp;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;

    let fired = false;
    if (CBZ.cityFireMissile) {
      try { CBZ.cityFireMissile(mx, my, mz, dx, dy, dz, { byPlayer: true }); fired = true; } catch (e) { fired = false; }
    }
    if (!fired) {
      // graceful fallback: throw a forward-leading explosion so the weapon still
      // "works" if the missile hook isn't wired. Lands ahead along the aim.
      const reach = 26;
      const tx = mx + dx * reach, tz = mz + dz * reach;
      if (CBZ.cityExplosion) { try { CBZ.cityExplosion(tx, tz, { power: 1.4, radius: 8, byPlayer: true }); } catch (e) {} }
    }
    craft.ammo--;
    craft.fireCD = FIRE_CD;
    if (CBZ.shake) { try { CBZ.shake(0.35); } catch (e) {} }
    if (CBZ.sfx) { try { CBZ.sfx("whoosh"); } catch (e) {} }
    // firing in the city is a crime → raises heat (guarded)
    if (CBZ.cityCrime) { try { CBZ.cityCrime(120, { x: craft.pos.x, z: craft.pos.z, type: "shots-fired" }); } catch (e) {} }
  }

  // left-click fires while flying (pointer-locked)
  addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (!activeCtx()) return;
    const craft = _aircraftFlying(); if (!craft) return;
    e.preventDefault();
    fireMissile(craft);
  });

  // ============================================================
  //  FLIGHT UPDATE — runs AFTER physics (order 12, just past vehicles' 11) and
  //  OWNS the aircraft + player transform while flying.
  // ============================================================
  function clampToCity(pos, r) {
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.clampToCity) { try { A.clampToCity(pos, r); } catch (e) {} }
  }

  function flyHeli(craft, dt) {
    const k = CBZ.keys || {};
    // heading from mouse yaw (look = heading), plus A/D yaw trim
    if (CBZ.cam) {
      // craft faces away from the camera yaw (chase cam sits behind)
      craft.heading = CBZ.cam.yaw + Math.PI;
    }
    let yaw = 0;
    if (k["a"]) yaw += 1;
    if (k["d"]) yaw -= 1;
    if (yaw && CBZ.cam) CBZ.cam.yaw -= yaw * HELI_YAW * dt;   // A/D nudges the heading via cam
    // forward/back thrust along heading
    let thr = 0;
    if (k["w"]) thr += 1;
    if (k["s"]) thr -= 1;
    const fx = Math.sin(craft.heading), fz = Math.cos(craft.heading);
    craft.vx += fx * thr * HELI_THRUST * dt;
    craft.vz += fz * thr * HELI_THRUST * dt;
    // horizontal drag → it can hover to a stop (less drag while thrusting)
    craft.vx *= Math.max(0, 1 - HELI_DRAG * dt * (thr ? 0.3 : 1));
    craft.vz *= Math.max(0, 1 - HELI_DRAG * dt * (thr ? 0.3 : 1));
    // clamp horizontal speed
    const hsp = Math.hypot(craft.vx, craft.vz);
    if (hsp > HELI_TOP) { const s = HELI_TOP / hsp; craft.vx *= s; craft.vz *= s; }
    // vertical: SPACE ascend, SHIFT/CTRL descend
    let lift = 0;
    if (k[" "]) lift += 1;
    if (k["shift"] || k["control"]) lift -= 1;
    craft.vy = lift * HELI_VLIFT;
    // body tilt: nose down on forward thrust, bank into yaw
    craft.pitch = (craft.pitch || 0) + ((-thr * 0.18) - craft.pitch) * Math.min(1, dt * 4);
    craft.roll = (craft.roll || 0) + ((yaw * 0.22) - craft.roll) * Math.min(1, dt * 4);
    // spin the rotors
    craft.rotorSpin += dt * 30;
    const ud = craft.group.userData;
    if (ud.rotor) ud.rotor.rotation.y = craft.rotorSpin;
    if (ud.rotor2) ud.rotor2.rotation.y = craft.rotorSpin + Math.PI / 4;
    if (ud.trotor) ud.trotor.rotation.x = craft.rotorSpin * 1.6;
    if (ud.trotor2) ud.trotor2.rotation.x = craft.rotorSpin * 1.6 + Math.PI / 4;
    craft.speed = hsp;
  }

  function flyJet(craft, dt) {
    const k = CBZ.keys || {};
    // throttle (always a min cruise so it never stalls/falls)
    let thr = 0;
    if (k["w"]) thr += 1;
    if (k["s"]) thr -= 1;
    craft.speed += thr * JET_ACCEL * dt;
    craft.speed = Math.max(JET_MIN, Math.min(JET_MAX, craft.speed));
    // bank/turn: A/D plus mouse yaw both steer the heading (wide turns)
    let bank = 0;
    if (k["a"]) bank += 1;
    if (k["d"]) bank -= 1;
    // mouse yaw feeds the heading too (camera sits behind)
    if (CBZ.cam) {
      const camHeading = CBZ.cam.yaw + Math.PI;
      let dh = camHeading - craft.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      craft.heading += dh * Math.min(1, dt * 2.2);          // ease toward look dir
    }
    craft.heading += bank * JET_TURN * dt;
    // climb/dive
    let climb = 0;
    if (k[" "]) climb += 1;
    if (k["control"] || k["shift"]) climb -= 1;
    craft.pitch = (craft.pitch || 0) + ((climb * 0.4) - craft.pitch) * Math.min(1, dt * 3);
    craft.roll = (craft.roll || 0) + ((bank * 0.5) - craft.roll) * Math.min(1, dt * 3);
    // build velocity: always-forward + vertical from climb/pitch
    const cp = Math.cos(craft.pitch);
    const fx = Math.sin(craft.heading) * cp, fz = Math.cos(craft.heading) * cp;
    craft.vx = fx * craft.speed;
    craft.vz = fz * craft.speed;
    craft.vy = (climb * JET_CLIMB) + Math.sin(craft.pitch) * craft.speed;
    // afterburner pulse
    const ud = craft.group.userData;
    if (ud.burn) ud.burn.scale.z = 1.2 + Math.sin(craft.rotorSpin += dt * 24) * 0.5 + (thr > 0 ? 0.6 : 0);
  }

  function integrate(craft, dt) {
    craft.pos.x += craft.vx * dt;
    craft.pos.y += craft.vy * dt;
    craft.pos.z += craft.vz * dt;
    // altitude ceiling + ground floor (never sink the belly through terrain)
    const gy = floorY(craft.pos.x, craft.pos.z);
    const minY = gy + craft.belly + GROUND_PAD;
    if (craft.pos.y < minY) {
      craft.pos.y = minY;
      if (craft.vy < 0) craft.vy = 0;
      // a jet that bottoms out keeps cruising level (no stall-crash); a heli rests
      if (craft.kind === "jet" && craft.pitch < 0) craft.pitch = 0;
    }
    if (craft.pos.y > CEILING) { craft.pos.y = CEILING; if (craft.vy > 0) craft.vy = 0; }
    // keep inside the world bounds
    clampToCity(craft.pos, 2.0);
    // apply transform
    craft.group.position.set(craft.pos.x, craft.pos.y, craft.pos.z);
    craft.group.rotation.set(craft.pitch || 0, craft.heading, craft.roll || 0);
  }

  CBZ.onUpdate(12, function (dt) {
    if (g.mode !== "city") return;
    // idle rotor spin for a parked-but-owned heli (it reads as "ready")
    if (heli && _aircraftFlying() !== heli && heli.group) {
      heli.rotorSpin += dt * 6;
      const ud = heli.group.userData;
      if (ud.rotor) ud.rotor.rotation.y = heli.rotorSpin;
      if (ud.rotor2) ud.rotor2.rotation.y = heli.rotorSpin + Math.PI / 4;
    }
    const P = CBZ.player;
    const craft = P && P._aircraft;
    if (!craft || P.dead) {
      // dead while flying → eject so death.js takes over on the ground
      if (craft && P && P.dead) exitAircraft();
      return;
    }
    if (craft.fireCD > 0) craft.fireCD = Math.max(0, craft.fireCD - dt);
    if (craft.kind === "jet") flyJet(craft, dt); else flyHeli(craft, dt);
    integrate(craft, dt);
    // own the player transform so physics.js (which bails on P.driving) and the
    // chase-cam (which follows player.pos) both track the aircraft
    P.pos.set(craft.pos.x, craft.pos.y, craft.pos.z);
    P.speed = craft.speed;
    P.vy = 0; P.grounded = false;
    if (CBZ.playerChar && CBZ.playerChar.group) {
      CBZ.playerChar.group.position.copy(P.pos);
      CBZ.playerChar.group.visible = false;
    }
    // The chase-cam (systems/camera.js, gated on player.driving) follows for
    // free off player.pos + cam.yaw. The HELI steers BY the mouse (look=heading)
    // so we leave cam.yaw to the mouse. The JET turns via A/D too, so gently ease
    // the cam back behind its nose so a long A/D turn doesn't lose the craft.
    if (CBZ.cam && craft.kind === "jet" && CBZ.lerpAngle) {
      CBZ.cam.yaw = CBZ.lerpAngle(CBZ.cam.yaw, craft.heading + Math.PI, 1 - Math.pow(0.15, dt));
    }
    // resupply if you settle back onto the base
    if (RESUPPLY_AT_BASE && craft.ammo < craft.maxAmmo) {
      const t = tower();
      const base = craft.kind === "jet" ? (t && t.hangar) : (t && t.helipad);
      if (base) {
        const bx = base.x, bz = base.z;
        if (Math.hypot(craft.pos.x - bx, craft.pos.z - bz) < 8 && craft.speed < 6) {
          craft.ammo = craft.maxAmmo;
        }
      }
    }
    drawHud(craft);
  });

  // ============================================================
  //  HUD — tiny optional flight readout (altitude / missiles / craft)
  // ============================================================
  function hudEl() {
    if (_hudEl) return _hudEl;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "cityFlightHud";
    d.style.cssText = "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);" +
      "font:600 13px/1.4 ui-monospace,Menlo,monospace;color:#cfe6ff;text-align:center;" +
      "background:rgba(8,12,18,0.55);padding:6px 14px;border-radius:8px;border:1px solid rgba(120,180,255,0.25);" +
      "pointer-events:none;z-index:60;display:none;text-shadow:0 1px 2px #000";
    document.body.appendChild(d);
    _hudEl = d;
    return d;
  }
  function drawHud(craft) {
    const el = hudEl(); if (!el) return;
    if (!craft) { el.style.display = "none"; return; }
    const alt = Math.max(0, craft.pos.y - floorY(craft.pos.x, craft.pos.z));
    el.style.display = "block";
    el.innerHTML = "✈ " + (craft.kind === "jet" ? "F-22 RAPTOR" : "MISSILE CHOPPER") +
      "  ·  ALT " + alt.toFixed(0) + "m" +
      "  ·  SPD " + (craft.speed || 0).toFixed(0) +
      "  ·  MISSILES " + craft.ammo + "/" + craft.maxAmmo;
  }
  function hideHud() { if (_hudEl) _hudEl.style.display = "none"; }

  // a separate on-foot proximity prompt ("[F] Fly the Heli" / buy the F-22)
  let _promptEl = null;
  function promptEl() {
    if (_promptEl) return _promptEl;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "cityAircraftPrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:140px;transform:translateX(-50%);" +
      "font:700 15px/1.4 ui-sans-serif,system-ui,sans-serif;color:#ffe7a0;text-align:center;" +
      "background:rgba(8,12,18,0.6);padding:7px 16px;border-radius:9px;border:1px solid rgba(255,210,120,0.35);" +
      "pointer-events:none;z-index:60;display:none;text-shadow:0 1px 3px #000";
    document.body.appendChild(d);
    _promptEl = d;
    return d;
  }
  function showPrompt(msg) {
    const el = promptEl(); if (!el) return;
    el.style.display = "block";
    el.innerHTML = msg;
  }
  function hidePrompt() { if (_promptEl) _promptEl.style.display = "none"; }
  // on-foot context: a board prompt near an owned craft, or a buy prompt at the
  // hangar. Cheap distance checks; only runs when not flying / not driving.
  function updatePrompt(P) {
    if (!P || P.dead || P._aircraft || P.driving || g.state !== "playing") { hidePrompt(); return; }
    const x = P.pos.x, z = P.pos.z;
    const c = nearestBoardable(x, z, 6.5);
    if (c) { showPrompt("[F] Fly the " + (c.kind === "jet" ? "F-22 RAPTOR" : "Missile Heli")); return; }
    if (!g.cityOwnsJet && atHangar(x, z)) {
      if (g.cityOwnsHangar) showPrompt("[B] Buy the F-22 RAPTOR — $" + (JET_PRICE / 1e6).toFixed(0) + "M");
      else showPrompt("Buy the HANGAR at the penthouse to unlock the F-22");
      return;
    }
    hidePrompt();
  }

  // ============================================================
  //  SELF-HEAL + RESET
  // ============================================================
  // a light watchdog: re-place/refresh when a city is (re)built or ownership
  // flips, and tear down the jet meshes if a flag drops. Runs cheap.
  CBZ.onUpdate(13, function () {
    if (g.mode !== "city") { hideHud(); hidePrompt(); return; }
    if (!arenaRoot()) return;
    const heliFlag = !!g.cityOwnsHeli, jetFlag = !!g.cityOwnsJet;
    // ownership flip (bought penthouse / jet, or a flag was cleared)
    if (heliFlag !== _lastHeliFlag) { placeHeli(); _lastHeliFlag = heliFlag; }
    if (jetFlag !== _lastJetFlag) { placeJet(); _lastJetFlag = jetFlag; }
    // self-heal: an owned craft that lost its mesh (city rebuilt → new arena root)
    if (heliFlag && (!heli || !heli.group || heli.group.parent !== arenaRoot())) {
      if (heli && _aircraftFlying() !== heli) { disposeGroup(heli.group); heli = null; }
      if (!heli) placeHeli();
    }
    if (jetFlag && (!jet || !jet.group || jet.group.parent !== arenaRoot())) {
      if (jet && _aircraftFlying() !== jet) { disposeGroup(jet.group); jet = null; }
      if (!jet) placeJet();
    }
    if (!_aircraftFlying()) hideHud();
    updatePrompt(CBZ.player);
  });

  function teardown() {
    const P = CBZ.player;
    if (P && P._aircraft) { P.driving = false; P._aircraft = null; }
    if (P && CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = !P.dead;
    disposeGroup(heli && heli.group); heli = null;
    disposeGroup(jet && jet.group); jet = null;
    g.cityOwnsJet = false;          // heli/hangar flags belong to realestate's reset
    _lastHeliFlag = false; _lastJetFlag = false;
    hideHud(); hidePrompt();
  }
  CBZ.cityPlayerAircraftReset = teardown;

  // chain onto the vehicles reset so a new run clears our flight state too
  // (mode.js calls CBZ.cityVehiclesReset on every fresh run). Wrapping a sibling
  // global is the same hook aircraft.js uses for cityWantedReset.
  function bindResetChain() {
    if (CBZ.cityVehiclesReset && !CBZ.cityVehiclesReset._airWrapped) {
      const orig = CBZ.cityVehiclesReset;
      CBZ.cityVehiclesReset = function () { teardown(); return orig.apply(this, arguments); };
      CBZ.cityVehiclesReset._airWrapped = true;
      return true;
    }
    return false;
  }
  // vehicles.js may load before or after us; try now, else on the first tick.
  if (!bindResetChain()) {
    let _bound = false;
    CBZ.onUpdate(14, function () {
      if (_bound) return;
      if (bindResetChain()) _bound = true;
    });
  }
})();
