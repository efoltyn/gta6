/* ============================================================
   city/marina.js — THE MARINA + THE BERTH BLOCK (WP-3)

   OWNER WANT
   ----------
   "I want water to be real, BOATS TO BE LEGIT, YACHTS to be buildable and
   buyable." Today the only boats in the world are three free hulls moored in
   the east-harbour gap (world.js:961-1096) that you jack. There is nowhere to
   BUY one and — more fundamentally — nowhere to PUT one: every storage spot in
   the game (realestate.js's home garage, storage.js's lock-ups) is on LAND, so
   a retrieved boat spawns beached in a car park.

   THIS FILE SHIPS TWO THINGS
   --------------------------
   1) CBZ.cityBerth — THE BLOCK. A water-side vehicle spot. It is the piece the
      repo was missing, and it adopts in ZERO lines at the call site because it
      WRAPS the function everybody already calls:

          CBZ.citySpawnOwnedCar(x, z, modelName)

      If the model is a marine hull and (x,z) is dry ground, the spawn is
      redirected to a real berth on real water. realestate.js retrieveCar(),
      shops.js buyCar() and storage.js retrieveVehicle() become berth-aware
      without one of them changing a character — which is the whole point of
      THE BLOCK LAW (CLAUDE.md): a block must REPLACE code the caller writes
      anyway, never add parallel bookkeeping.

      CBZ.cityBerthAudit() -> the number of marine hulls that still spawned on
      dry ground this run. Pin it at 0 in the math gate; it may only go DOWN.

   2) A REAL MARINA, built on the coast beside the existing east harbour, with
      the geometry a marina actually has (research §G):
        · floating finger pontoons — 0.42m of freeboard, and they RISE AND FALL
          WITH THE SWELL (the first real consumer of WP-1's CBZ.movingPlatform;
          feature-detected, falls back to a static CBZ.platforms entry)
        · berth width = beam + 0.5-1.0m clearance each side; finger length ~40%
          of the berthed boat's LOA; finger width 0.8m
        · a Med-moor superyacht quay (stern-to: a 34m yacht occupies only its
          BEAM of quay, which is exactly how a big hull fits a small harbour)
        · fuel dock on its OWN pontoon near the entrance
        · harbourmaster office, chandlery, yacht-club terrace, travel-lift
          gantry over a lift well, hardstand yard with hulls on cradles
        · rubble-mound breakwater arms with a walkable cap and a channel
          entrance marked IALA REGION B ("red, right, returning": red cans to
          STARBOARD entering from seaward — this game reads American)
        · cleats every 4m, piles, fenders, mooring lines
        · life: dockhands and liveaboards via CBZ.npcLife.definePopulation —
          the EXISTING shared spawner. No new NPC loop is created here.
        · THE TRADES THAT WERE MISSING (2026-07-27): nine authored bodies stood
          on this quay and not one of them was a captain, a deckhand, a
          mechanic, a fuel attendant or a fisherman — a travel-lift gantry, a
          hardstand yard, a Med-moor superyacht quay and a fuel dock with
          nobody working any of them. Five more jobs are declared against the
          geometry that implies each one and manned by city/citystaff.js only
          inside 170 m. The work anchor was also DEAD (`kind: "work"` matched no
          job in aigoals.js's CITY_JOBS, so the dockhands it exists for could
          never route to it); it is now `kind: "marina"`, which citystaff.js's
          TRADES table registers every waterfront trade against.

   DETERMINISM: this is a world-BUILD path. Every random draw goes through
   CBZ.seedStream("marina") / CBZ.hash01. No Math.random anywhere in build.

   FLAGS (one-line revert each, declared here — config.js is off-limits):
     CBZ.CONFIG.MARINA              (true)  — build the marina at all
     CBZ.CONFIG.MARINA_FLOAT        (true)  — pontoons track the live swell
     CBZ.CONFIG.BOAT_BERTH_REDIRECT (true)  — the citySpawnOwnedCar wrapper

   Exposes: CBZ.cityBerth, CBZ.cityBerthAudit, CBZ.cityMarina.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (C.MARINA == null) C.MARINA = true;
  if (C.MARINA_FLOAT == null) C.MARINA_FLOAT = true;
  if (C.BOAT_BERTH_REDIRECT == null) C.BOAT_BERTH_REDIRECT = true;

  const SEA_Y = (CBZ.SEA_Y != null ? +CBZ.SEA_Y : -0.48);
  const PONTOON_FB = 0.42;                 // floating pontoon freeboard (0.3-0.5m, §G)
  const PONTOON_TOP = SEA_Y + PONTOON_FB;  // mean deck height of every pontoon
  const QUAY_TOP = 0.40;                   // fixed quay — a step-up (physics STEP_UP 0.45)

  function waterAt(x, z) { return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)); }
  function seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : SEA_Y; }

  /* ============================================================
     PART 1 — THE BERTH BLOCK  (CBZ.cityBerth)
     ------------------------------------------------------------
     A berth is a water-side parking spot: { id, x, z, heading, loa, beam,
     kind, claim }. Registered by whoever builds water (this file today; a
     future island harbour tomorrow) and consumed by everything that spawns a
     hull. Installed UNCONDITIONALLY — the MARINA flag gates the geometry, not
     the registry, so flipping the marina off still leaves owned boats a place
     to appear (the fallback roadstead anchorage near the east harbour).
     ============================================================ */
  const berths = [];
  let _beached = 0;               // THE RATCHET: marine hulls spawned on dry land
  let _snapDropped = 0;           // DIAGNOSIS: berths silently lost to the snap radius
  let _fallbackDone = false;

  function clearBerths() { berths.length = 0; _fallbackDone = false; _snapDropped = 0; }

  // Register one berth. Water is VERIFIED here (and snapped to the nearest
  // navigable point if the authored coordinate drifted onto a sandbar), so a
  // berth that survives registration is always somewhere a hull can float.
  // THE SNAP RADIUS IS A TRAP AND IT IS NOW COUNTED. 90 m was sized for a
  // finger berth authored a few metres off the quay it belongs to, and for that
  // it is right. But it is SHORTER THAN ONE HULL LENGTH for anything over 90 m,
  // and the failure is silent — a null return, no record, no warning — so a
  // caller registering an offshore anchorage can lose every berth it asked for
  // and read the result as "the feature is off". That is exactly how the
  // superyacht roadstead vanished for a whole merge. A caller that knows it is
  // working at scale passes its own `spec.snap`; everything already in the game
  // keeps 90 and is byte-identical.
  const SNAP_R = 90;
  function registerBerth(spec) {
    if (!spec || !isFinite(spec.x) || !isFinite(spec.z)) return null;
    let x = +spec.x, z = +spec.z;
    if (!waterAt(x, z)) {
      const wf = CBZ.waterField;
      const snap = Math.max(SNAP_R, +spec.snap || 0);
      const near = wf && wf.nearestWater ? wf.nearestWater(x, z, 0.4, snap) : null;
      if (!near) {
        // no water here — drop it, don't lie, but SAY SO.
        _snapDropped++;
        if (window.console) console.warn("[berth] '" + (spec.id || "?") + "' dropped: no water within " + Math.round(snap) + "m of " + (x | 0) + "," + (z | 0));
        return null;
      }
      x = near.x; z = near.z;
    }
    const b = {
      id: spec.id || ("berth-" + berths.length),
      x: x, z: z,
      heading: isFinite(spec.heading) ? +spec.heading : 0,
      loa: +spec.loa || 8, beam: +spec.beam || 3,
      kind: spec.kind || "finger",          // finger | med | alongside | fuel | dealer | anchorage
      label: spec.label || null,
      claim: null,                          // the owner key holding it, or null
      resident: !!spec.resident,            // the marina's own working boats live here
      occupant: null,                       // live car record currently sitting in it
    };
    berths.push(b);
    return b;
  }

  // The safety net: if nothing registered a berth (marina flag off, or the
  // coast moved), park owned hulls on a ROADSTEAD — open-water anchorage just
  // off the east harbour, offset clear of world.js's three free moored boats.
  function ensureFallbackBerths() {
    if (_fallbackDone) return;
    _fallbackDone = true;
    if (berths.length) return;
    const A = (CBZ.city && CBZ.city.arena) || CBZ._settlementArena || null;
    if (!A) return;
    const cz = A.center ? A.center.z : 0;
    const EEx = A.maxX + 26;                          // the east seawall line (world.js:1010)
    for (let i = 0; i < 4; i++) {
      registerBerth({
        id: "roadstead-" + i, x: EEx + 62 + i * 4, z: cz - 60 + i * 30,
        heading: -Math.PI / 2, loa: 20, beam: 6, kind: "anchorage",
        label: "East Roadstead " + (i + 1),
      });
    }
  }

  function fits(b, loa, beam) {
    if (!loa && !beam) return true;
    return (b.loa + 0.5) >= (loa || 0) && (b.beam + 0.5) >= (beam || 0);
  }
  function isFree(b) { return !b.resident && !b.claim; }

  function berthList() { ensureFallbackBerths(); return berths.slice(); }
  function berthById(id) { ensureFallbackBerths(); for (const b of berths) if (b.id === id) return b; return null; }

  function nearestBerth(x, z, r) {
    ensureFallbackBerths();
    let best = null, bd = (r || 1e9) * (r || 1e9);
    for (const b of berths) { const dx = b.x - x, dz = b.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = b; } }
    return best;
  }

  // Smallest FREE berth that still fits the hull — a 34m yacht never squats a
  // 4m finger berth, and a jetski never eats the superyacht quay.
  function freeBerth(loa, beam, prefKind) {
    ensureFallbackBerths();
    let best = null;
    for (const b of berths) {
      if (!isFree(b) || !fits(b, loa, beam)) continue;
      if (prefKind && b.kind !== prefKind) continue;
      if (!best || (b.loa * b.beam) < (best.loa * best.beam)) best = b;
    }
    if (!best && prefKind) return freeBerth(loa, beam, null);
    return best;
  }

  function claimBerth(b, key) {
    if (typeof b === "string") b = berthById(b);
    if (!b || (b.claim && b.claim !== key)) return null;
    b.claim = key || "player";
    return b;
  }
  function releaseBerth(b) {
    if (typeof b === "string") b = berthById(b);
    if (!b) return false;
    b.claim = null; b.occupant = null;
    return true;
  }

  // Is this model name a marine hull? Three independent oracles, any of which
  // may be absent: WP-2's registry, the economy catalog's body flag, and the
  // legacy name regex playercars.js's inferStyle() already uses.
  function isMarineName(name) {
    if (!name) return false;
    if (CBZ.marineHulls && CBZ.marineHulls.styleFor) {
      try { if (CBZ.marineHulls.styleFor(name, null)) return true; } catch (e) {}
    }
    const econ = CBZ.cityEcon;
    if (econ && econ.carByName) {
      const m = econ.carByName(name);
      if (m && (m.body === "boat" || m.detailStyle === "boat")) return true;
    }
    // STRONG words only. A flat /cruiser/ or /tender/ regex here would turn
    // police.js's "Police Cruiser" (body:"sedan") into a motor yacht — the
    // exact trap water_hulls.js's styleFor() documents. Weak words are left to
    // the two oracles above, which corroborate against the real body flag.
    return /\b(boat|speedboat|jetmax|yacht|dinghy|skiff|trawler|catamaran)\b/i.test(String(name));
  }

  // Spawn an OWNED hull at a berth. Goes through citySpawnOwnedCar (the ONE
  // owned-vehicle spawn path) — we only choose the water and the heading.
  function spawnAtBerth(b, modelName, opts) {
    if (typeof b === "string") b = berthById(b);
    if (!b || !CBZ.citySpawnOwnedCar) return null;
    const raw = CBZ.citySpawnOwnedCar._berthOrig || CBZ.citySpawnOwnedCar;
    const car = raw(b.x, b.z, modelName);
    if (!car) return null;
    car.heading = b.heading || 0;
    car.v = 0; car.vx = 0; car.vz = 0; car.baseV = 0; car.road = null; car.ai = false;
    if (car.group) { car.group.position.x = b.x; car.group.position.z = b.z; car.group.rotation.y = car.heading; }
    if (car.pos) { car.pos.x = b.x; car.pos.z = b.z; }
    car._berthId = b.id;
    b.occupant = car;
    if (opts && opts.key) { b.claim = opts.key; car._boatKey = opts.key; }
    return car;
  }

  /* ---- THE ONE-LINE ADOPTION: wrap citySpawnOwnedCar ----------------------
     Every existing owned-vehicle spawn in the game funnels through this
     function. Wrapping it (the exact pattern world.js uses on
     CBZ.spawnCityTraffic) makes THREE call sites we are forbidden to edit —
     realestate.js:335 retrieveCar(), shops.js:770 buyCar(), and any future
     one — berth-aware for free. A NON-marine spawn is passed straight through
     untouched: byte-identical behaviour for every car in the game.          */
  function wrapSpawn() {
    if (!CBZ.citySpawnOwnedCar || CBZ.citySpawnOwnedCar._berthWrapped) return !!(CBZ.citySpawnOwnedCar && CBZ.citySpawnOwnedCar._berthWrapped);
    const orig = CBZ.citySpawnOwnedCar;
    const wrapped = function (x, z, modelName) {
      if (C.BOAT_BERTH_REDIRECT !== false && isMarineName(modelName) && !waterAt(x, z)) {
        // Ask the boatyard first — a boat you OWN goes back to ITS berth, not
        // to whatever slot happens to be empty (feature-detected: boatyard.js
        // may not be loaded, or this may be a hull nobody owns).
        let b = null;
        if (CBZ.cityBoatyard && CBZ.cityBoatyard.berthForModel) {
          try { b = CBZ.cityBoatyard.berthForModel(modelName); } catch (e) {}
        }
        if (!b) {
          const hull = hullDimsFor(modelName);
          b = freeBerth(hull.loa, hull.beam) || nearestBerth(x, z);
        }
        if (b) {
          const car = orig(b.x, b.z, modelName);
          if (car) {
            car.heading = b.heading || 0;
            car.v = 0; car.vx = 0; car.vz = 0; car.baseV = 0; car.road = null;
            if (car.group) { car.group.rotation.y = car.heading; }
            car._berthId = b.id; b.occupant = car;
          }
          return car;
        }
        // No water anywhere we can reach. Spawn it anyway (never swallow the
        // player's vehicle) but COUNT it — this is the ratchet.
        _beached++;
        if (window.console) console.warn("[berth] no berth for marine hull '" + modelName + "' — spawned on land at " + (x | 0) + "," + (z | 0));
      }
      return orig(x, z, modelName);
    };
    wrapped._berthWrapped = true;
    wrapped._berthOrig = orig;
    CBZ.citySpawnOwnedCar = wrapped;
    return true;
  }

  // Best-known dimensions for a model name (WP-2's registry if present, else
  // the existing 6.2m x 2.1m runabout — the one hull that exists today).
  function hullDimsFor(name) {
    if (CBZ.marineHulls) {
      try {
        const key = CBZ.marineHulls.styleFor ? CBZ.marineHulls.styleFor(name, null) : null;
        const rec = key && CBZ.marineHulls.get ? CBZ.marineHulls.get(key) : null;
        const h = rec && (rec.hull || rec.spec);
        if (h && isFinite(h.loa)) return { loa: +h.loa, beam: +h.beam || 2.1 };
        const list = CBZ.marineHulls.list ? CBZ.marineHulls.list() : null;
        if (list) for (const r of list) {
          if (!r || (r.label !== name && r.key !== name && r.model !== name)) continue;
          const rh = r.hull || r.spec;
          if (rh && isFinite(rh.loa)) return { loa: +rh.loa, beam: +rh.beam || 2.1 };
        }
      } catch (e) {}
    }
    return { loa: 6.2, beam: 2.1 };
  }

  CBZ.cityBerth = {
    register: registerBerth, list: berthList, byId: berthById,
    nearest: nearestBerth, free: freeBerth, claim: claimBerth, release: releaseBerth,
    spawn: spawnAtBerth, isMarine: isMarineName, dimsFor: hullDimsFor,
    clear: clearBerths,
    count: function () { ensureFallbackBerths(); return berths.length; },
  };
  // THE RATCHET (CLAUDE.md block law #5). Marine hulls that still spawned on
  // dry ground this run. Pin at 0 in tools/math-gate.mjs; may only go DOWN.
  // SHAPE IS LOAD-BEARING: it returns a NUMBER and the gate pins that number.
  // The snap diagnosis below is deliberately a separate export rather than a
  // field on this, because widening the return type would break the pin.
  CBZ.cityBerthAudit = function () { return _beached | 0; };
  // Berths a caller asked for and silently did not get. Not a ratchet — a
  // DIAGNOSIS. A non-zero reading here means somebody's water-side feature is
  // quietly missing, which is precisely the failure mode that hid the
  // superyacht roadstead. Widening a snap can only ever ADD berths, so it can
  // never push cityBerthAudit() (hulls with NO berth at all) off zero.
  CBZ.cityBerthSnapDropped = function () { return _snapDropped | 0; };

  if (!wrapSpawn() && CBZ.onUpdate) {
    // vehicles.js parses after us in some orders — retry cheaply until it exists.
    CBZ.onUpdate(9.3, function () { if (!CBZ.citySpawnOwnedCar || CBZ.citySpawnOwnedCar._berthWrapped) return; wrapSpawn(); });
  }

  /* ============================================================
     PART 2 — THE MARINA (geometry)
     ============================================================ */
  if (!window.THREE) return;
  const THREE = window.THREE;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  const WOOD_A = 0xb99a6b, WOOD_B = 0xa88a5e, WOOD_DK = 0x6f5a3c;
  const CONCRETE = 0x9aa0a6, CONCRETE_DK = 0x7c8288;
  const PONTOON_C = 0xd6d9dc, ROCK = 0x6a7076, CLEAT = 0x2e3238;

  let site = null;                 // the resolved marina descriptor (or null)
  let pontoonGrp = null;           // the floating group (tracks the swell)
  let pontoonRig = null;           // CBZ.movingPlatform handle, if WP-1 is live
  let staticPlats = [];            // fallback platform records we pushed
  let residentSpots = [];          // where the marina's own working hulls moor
  let floatHandles = [];           // CBZ.waterFloat handles (buoys) — released on rebuild

  function marinaRng() {
    if (CBZ.seedStream) return CBZ.seedStream("marina");
    let s = 4242421; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  CBZ.addLandmass && CBZ.addLandmass(function (city) {
    if (C.MARINA === false) return null;
    if (!city || !city.root) return null;
    // a rebuild re-runs this builder — drop stale state before anything else
    clearBerths();
    site = null; pontoonGrp = null; pontoonRig = null;
    staticPlats.length = 0; residentSpots.length = 0;
    for (const h of floatHandles) { try { h.release(); } catch (e) {} }
    floatHandles.length = 0;

    const root = city.root;
    const cz = city.center ? city.center.z : 0;
    const EEx = city.maxX + 26;                 // the east seawall line (world.js)

    // ---- SITE SELECTION -------------------------------------------------
    // North of the bridge span (world.js keeps |z-cz| < 12 clear) and clear of
    // the three free moored hulls at cz-26 / cz+24 / cz+44. Then walk EAST
    // until we find real, navigable water with a basin behind it. If the coast
    // isn't where we think it is, we build NOTHING rather than a marina on
    // grass — the berth registry falls back to the roadstead.
    const BZ = cz - 96;                         // basin centre line (z)
    let QX = 0, found = false;
    for (let x = EEx + 12; x <= EEx + 140; x += 3) {
      if (waterAt(x + 6, BZ) && waterAt(x + 46, BZ) && waterAt(x + 46, BZ + 40) && waterAt(x + 46, BZ - 40)) { QX = x; found = true; break; }
    }
    if (!found) return null;

    const rng = marinaRng();
    // WHO WORKS THIS MARINA, collected as the geometry that implies each job is
    // drawn. Data only — city/citystaff.js mints the bodies when you are near.
    const crewSpots = [];
    const mats = new Map();
    function m(c) { let v = mats.get(c); if (!v) { v = cmat(c); mats.set(c, v); } return v; }
    const BGU = THREE.BufferGeometryUtils;
    function boxGeoAt(x, y, z, w, h, d, ry, rz) {
      const gm = new THREE.BoxGeometry(w, h, d);
      if (rz) gm.rotateZ(rz);
      if (ry) gm.rotateY(ry);
      gm.translate(x, y, z);
      return gm;
    }
    function mergeAdd(geoms, material, parent, cast) {
      if (!geoms.length) return null;
      const p = parent || root;
      if (BGU && BGU.mergeBufferGeometries) {
        const mesh = new THREE.Mesh(BGU.mergeBufferGeometries(geoms), material);
        mesh.castShadow = !!cast; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
        p.add(mesh); return mesh;
      }
      for (const gm of geoms) { const mesh = new THREE.Mesh(gm, material); mesh.castShadow = !!cast; mesh.receiveShadow = true; p.add(mesh); }
      return null;
    }
    function solid(x, z, w, d, ref, y0, y1) {
      const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: ref, noCam: true };
      if (y1 != null) { c.y0 = y0 || 0; c.y1 = y1; }
      CBZ.colliders.push(c);
    }
    function plat(minX, maxX, minZ, maxZ, top, ramp) {
      const p = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, top: top };
      if (ramp) p.ramp = ramp;
      CBZ.platforms.push(p); staticPlats.push(p);
      return p;
    }

    // =====================================================================
    //  1) THE QUAY — a fixed concrete apron along the landward edge. Every
    //     shore-side building sits on it; the pontoons hang off it.
    // =====================================================================
    const QZ0 = BZ - 56, QZ1 = BZ + 48;         // quay z-span
    const QW0 = QX - 20, QW1 = QX + 1;          // quay x-span (land -> water edge)
    // THE LIFT WELL — a notch of OPEN WATER cut into the quay so the travel
    // lift can straddle a hull and pick it out. It is a real hole: the slab is
    // built as three boxes around it and no platform record covers it, so you
    // can fall in. A decorative notch you cannot fall into would be a lie.
    const WELL_Z = BZ - 46, WELL_HZ = 3.4, WELL_X0 = QX - 12;
    {
      function slabBox(x0, x1, z0, z1) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, QUAY_TOP + 1.4, z1 - z0), m(CONCRETE));
        s.position.set((x0 + x1) / 2, QUAY_TOP - (QUAY_TOP + 1.4) / 2, (z0 + z1) / 2);
        s.receiveShadow = true; root.add(s);
        plat(x0, x1, z0, z1, QUAY_TOP);
      }
      slabBox(QW0, QW1, QZ0, WELL_Z - WELL_HZ);              // south of the well
      slabBox(QW0, QW1, WELL_Z + WELL_HZ, QZ1);              // north of the well
      slabBox(QW0, WELL_X0, WELL_Z - WELL_HZ, WELL_Z + WELL_HZ);  // landward side of it

      // fenders on the quay face — old tyres and black cylinders, every 5m
      const fend = [];
      for (let z = QZ0 + 4; z < QZ1 - 4; z += 5) {
        fend.push(boxGeoAt(QW1 + 0.12, SEA_Y + 0.30, z, 0.24, 0.62, 0.5));
      }
      mergeAdd(fend, m(0x24272b));

      // bollards along the quay edge (every 6m — §G says 3-6m)
      const boll = [];
      for (let z = QZ0 + 3; z < QZ1 - 3; z += 6) {
        boll.push(boxGeoAt(QW1 - 0.9, QUAY_TOP + 0.28, z, 0.34, 0.56, 0.34));
        boll.push(boxGeoAt(QW1 - 0.9, QUAY_TOP + 0.58, z, 0.46, 0.10, 0.46));   // the mushroom cap
      }
      mergeAdd(boll, m(CLEAT));
    }

    // =====================================================================
    //  2) THE FLOATING PONTOONS — main walkway + finger berths.
    //     Built into ONE group anchored at (QX, 0, BZ) so the whole dock can
    //     be lifted by the live swell in one write. Decks are handed to
    //     CBZ.movingPlatform (WP-1) if it exists; otherwise they are ordinary
    //     static CBZ.platforms entries at the mean waterline — the old
    //     inline value, so adopting the primitive cannot break walking.
    // =====================================================================
    const decks = [];                // LOCAL-space {x,z,w,d,top} for movingPlatform
    const localPlats = [];           // world-space fallback records (built from the same numbers)
    pontoonGrp = new THREE.Group();
    pontoonGrp.position.set(QX, 0, BZ);
    root.add(pontoonGrp);
    const PGX = QX, PGZ = BZ;
    function deck(lx, lz, w, d) {
      decks.push({ x: lx, z: lz, w: w, d: d, top: PONTOON_TOP });
      localPlats.push({ minX: PGX + lx - w / 2, maxX: PGX + lx + w / 2, minZ: PGZ + lz - d / 2, maxZ: PGZ + lz + d / 2, top: PONTOON_TOP });
    }

    const pontGeo = [], cleatGeo = [];
    const MAIN_LEN = 68, MAIN_W = 2.4;
    const MAIN_X0 = 3, MAIN_X1 = MAIN_X0 + MAIN_LEN;      // local x
    // main walkway
    pontGeo.push(boxGeoAt((MAIN_X0 + MAIN_X1) / 2, PONTOON_TOP - 0.18, 0, MAIN_LEN, 0.36, MAIN_W));
    deck((MAIN_X0 + MAIN_X1) / 2, 0, MAIN_LEN, MAIN_W);
    // cleats every 4m down both edges of the walkway
    for (let x = MAIN_X0 + 2; x < MAIN_X1; x += 4) {
      cleatGeo.push(boxGeoAt(x, PONTOON_TOP + 0.09, -MAIN_W / 2 + 0.16, 0.30, 0.18, 0.12));
      cleatGeo.push(boxGeoAt(x, PONTOON_TOP + 0.09, MAIN_W / 2 - 0.16, 0.30, 0.18, 0.12));
    }

    // ---- the berth ladder. Sized from WP-2's hull registry when it is
    // loaded (so a 14m sport cruiser actually gets a 14m berth), else the
    // standard 3/4/5/6m width bands with the existing 6.2m runabout in mind.
    function hullLadder() {
      const out = [];
      if (CBZ.marineHulls && CBZ.marineHulls.list) {
        try {
          for (const r of CBZ.marineHulls.list()) {
            const h = r && (r.hull || r.spec);
            if (h && isFinite(h.loa) && isFinite(h.beam)) out.push({ loa: +h.loa, beam: +h.beam, label: r.label || r.key });
          }
        } catch (e) {}
      }
      if (!out.length) {
        out.push({ loa: 3.3, beam: 1.25 }, { loa: 4.5, beam: 2.0 }, { loa: 6.2, beam: 2.1 },
                 { loa: 9.5, beam: 3.0 }, { loa: 14, beam: 4.2 }, { loa: 34, beam: 7.6 });
      }
      out.sort(function (a, b) { return a.loa - b.loa; });
      return out;
    }
    const ladder = hullLadder();
    const small = ladder.filter(function (h) { return h.loa < 8; });
    const mid = ladder.filter(function (h) { return h.loa >= 8 && h.loa < 20; });
    const big = ladder.filter(function (h) { return h.loa >= 20; });
    function sizeAt(list, i, fb) { return list.length ? list[i % list.length] : fb; }
    // berth width = beam + 0.5-1.0m clearance EACH SIDE (§G)
    function clearanceFor(beam) { return Math.max(0.5, Math.min(1.0, beam * 0.18)); }
    function berthWidth(h) { return h.beam + clearanceFor(h.beam) * 2; }
    // finger length ~ 1/3 - 1/2 of LOA (§G); finger width 0.6-1.0m
    function fingerLen(h) { return Math.max(2.0, h.loa * 0.42); }
    const FINGER_W = 0.8;

    // SOUTH side (-z): the small-craft trots.
    let cursor = MAIN_X0 + 4, sIdx = 0;
    const southBerths = [];
    while (cursor < MAIN_X1 - 5 && sIdx < 8) {
      const h = sizeAt(small, sIdx, { loa: 6.2, beam: 2.1 });
      const w = berthWidth(h), fl = fingerLen(h);
      // the finger on the LOW-x edge of this berth
      pontGeo.push(boxGeoAt(cursor, PONTOON_TOP - 0.16, -MAIN_W / 2 - fl / 2, FINGER_W, 0.32, fl));
      deck(cursor, -MAIN_W / 2 - fl / 2, FINGER_W, fl);
      cleatGeo.push(boxGeoAt(cursor, PONTOON_TOP + 0.09, -MAIN_W / 2 - fl + 0.4, 0.24, 0.16, 0.10));
      southBerths.push({ x: cursor + w / 2, h: h, fl: fl });
      cursor += w; sIdx++;
    }
    // the closing finger
    {
      const fl = fingerLen(sizeAt(small, sIdx, { loa: 6.2, beam: 2.1 }));
      pontGeo.push(boxGeoAt(cursor, PONTOON_TOP - 0.16, -MAIN_W / 2 - fl / 2, FINGER_W, 0.32, fl));
      deck(cursor, -MAIN_W / 2 - fl / 2, FINGER_W, fl);
    }

    // NORTH side (+z): the bigger boats — deeper water, longer fingers.
    cursor = MAIN_X0 + 5; let nIdx = 0;
    const northBerths = [];
    while (cursor < MAIN_X1 - 8 && nIdx < 5) {
      const h = sizeAt(mid.length ? mid : small, nIdx, { loa: 9.5, beam: 3.0 });
      const w = berthWidth(h), fl = fingerLen(h);
      pontGeo.push(boxGeoAt(cursor, PONTOON_TOP - 0.16, MAIN_W / 2 + fl / 2, FINGER_W, 0.32, fl));
      deck(cursor, MAIN_W / 2 + fl / 2, FINGER_W, fl);
      cleatGeo.push(boxGeoAt(cursor, PONTOON_TOP + 0.09, MAIN_W / 2 + fl - 0.4, 0.24, 0.16, 0.10));
      northBerths.push({ x: cursor + w / 2, h: h, fl: fl });
      cursor += w; nIdx++;
    }
    {
      const fl = fingerLen(sizeAt(mid.length ? mid : small, nIdx, { loa: 9.5, beam: 3.0 }));
      pontGeo.push(boxGeoAt(cursor, PONTOON_TOP - 0.16, MAIN_W / 2 + fl / 2, FINGER_W, 0.32, fl));
      deck(cursor, MAIN_W / 2 + fl / 2, FINGER_W, fl);
    }

    // FUEL DOCK — its own short pontoon near the ENTRANCE (§G), so a boat can
    // fuel without threading the whole basin.
    const FUEL_X = MAIN_X1 - 4, FUEL_Z = MAIN_W / 2 + 14;
    pontGeo.push(boxGeoAt(FUEL_X, PONTOON_TOP - 0.18, FUEL_Z, 12, 0.36, 2.6));
    deck(FUEL_X, FUEL_Z, 12, 2.6);
    // link the fuel dock to the main walkway with a catwalk
    pontGeo.push(boxGeoAt(FUEL_X, PONTOON_TOP - 0.16, (MAIN_W / 2 + FUEL_Z) / 2, 1.0, 0.32, FUEL_Z - MAIN_W / 2));
    deck(FUEL_X, (MAIN_W / 2 + FUEL_Z) / 2, 1.0, FUEL_Z - MAIN_W / 2);

    // DEALER DOCK — the brokerage's own water frontage at the landward end,
    // with demo hulls floating alongside it. boatyard.js reads these berths.
    const DEAL_X = MAIN_X0 + 2, DEAL_Z = -MAIN_W / 2 - 26;
    pontGeo.push(boxGeoAt(DEAL_X + 6, PONTOON_TOP - 0.18, DEAL_Z, 18, 0.36, 2.6));
    deck(DEAL_X + 6, DEAL_Z, 18, 2.6);
    pontGeo.push(boxGeoAt(DEAL_X, PONTOON_TOP - 0.16, (DEAL_Z - MAIN_W / 2) / 2 - MAIN_W / 4, 1.0, 0.32, Math.abs(DEAL_Z) - MAIN_W / 2));
    deck(DEAL_X, (DEAL_Z - MAIN_W / 2) / 2 - MAIN_W / 4, 1.0, Math.abs(DEAL_Z) - MAIN_W / 2);

    mergeAdd(pontGeo, m(PONTOON_C), pontoonGrp, false);
    mergeAdd(cleatGeo, m(CLEAT), pontoonGrp, false);

    // the GANGWAY / BROW: a hinged ramp from the fixed quay down to the
    // floating dock. Registered STATIC at the mean waterline — a real brow
    // pivots, and a pivoting ramp is not worth a per-frame platform rewrite.
    plat(QX + 0.6, QX + 3.4, BZ - 1.1, BZ + 1.1, QUAY_TOP, { axis: "x", x0: QX + 0.6, x1: QX + 3.4, y0: QUAY_TOP, y1: PONTOON_TOP });
    {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 2.2), m(0xb8bcc0));
      brow.position.set(QX + 2.0, (QUAY_TOP + PONTOON_TOP) / 2, BZ);
      brow.rotation.z = Math.atan2(PONTOON_TOP - QUAY_TOP, 2.8);
      brow.receiveShadow = true; root.add(brow);
    }

    // ---- REGISTER THE BERTHS (world-space; the boats do not move with the
    // pontoon, the water carries them — water_buoyancy.js owns their ride) --
    // A finger berth lies alongside its finger, bow toward the walkway: the
    // bow points -x, i.e. heading atan2(-1, 0) = -PI/2 (forward = sin/cos h).
    const HEAD_IN = -Math.PI / 2;
    southBerths.forEach(function (b, i) {
      registerBerth({
        id: "marina-s" + i, x: QX + b.x, z: BZ - MAIN_W / 2 - b.fl * 0.55,
        heading: HEAD_IN, loa: b.h.loa, beam: b.h.beam, kind: "finger",
        label: "South Trot " + String.fromCharCode(65 + i),
        resident: i < 2,                       // the first two are locals' boats
      });
    });
    northBerths.forEach(function (b, i) {
      registerBerth({
        id: "marina-n" + i, x: QX + b.x, z: BZ + MAIN_W / 2 + b.fl * 0.55,
        heading: HEAD_IN, loa: b.h.loa, beam: b.h.beam, kind: "finger",
        label: "North Trot " + String.fromCharCode(65 + i),
        resident: i === 0,
      });
    });
    registerBerth({ id: "marina-fuel", x: QX + FUEL_X, z: BZ + FUEL_Z + 3.4, heading: HEAD_IN, loa: 16, beam: 5, kind: "fuel", label: "Fuel Dock", resident: true });
    for (let i = 0; i < 3; i++) {
      registerBerth({
        // 16m of demo berth so the showroom can float a sport cruiser, not
        // just the small stuff — a brokerage that only shows dinghies is not
        // a brokerage.
        id: "marina-demo" + i, x: QX + DEAL_X + 1 + i * 7, z: BZ + DEAL_Z - 4.6,
        heading: HEAD_IN, loa: 16, beam: 5, kind: "dealer", label: "Demo Berth " + (i + 1), resident: true,
      });
    }
    // The hulls that must actually FLOAT here: two liveaboards on the south
    // trot and the brokerage's three demo boats (research §H — a dealer is a
    // showroom on the water with demo hulls at its own dock, and you should be
    // able to walk up to them). Read back from the REGISTERED berths so we use
    // the snapped, water-verified coordinates, not the authored ones.
    for (const b of berths) {
      if (b.kind === "dealer" || (b.kind === "finger" && b.resident)) {
        residentSpots.push({ x: b.x, z: b.z, heading: b.heading, berth: b });
      }
    }

    // =====================================================================
    //  3) THE MED-MOOR QUAY — the superyacht basin. Stern-to the quay with a
    //     bow line out: a 34m yacht then occupies only its BEAM of quay
    //     (7.6m), which is the ONLY way a hull that long fits a harbour this
    //     small (§G). 6m+ of water here, 3-4m in the rest of the basin.
    // =====================================================================
    const MEDZ = BZ + 44;                       // the quay face the sterns touch
    {
      const face = new THREE.Mesh(new THREE.BoxGeometry(58, QUAY_TOP + 1.8, 5), m(CONCRETE_DK));
      face.position.set(QX + 30, QUAY_TOP - (QUAY_TOP + 1.8) / 2, MEDZ + 2.5);
      face.receiveShadow = true; root.add(face);
      plat(QX + 1, QX + 59, MEDZ, MEDZ + 5, QUAY_TOP);

      const bigH = big.length ? big[0] : { loa: 34, beam: 7.6 };
      const step = bigH.beam + 3.0;             // beam + working clearance
      const boll = [], lines = [];
      for (let i = 0; i < 3; i++) {
        const bx = QX + 10 + i * step;
        // A 34 m hull stern-to a quay is not left unattended. The first berth
        // gets its CAPTAIN and its DECKHAND on the quay beside the passerelle;
        // the rest of the row is quiet, which is also how a real superyacht
        // basin looks (one boat working, the others shut up).
        if (i === 0) {
          crewSpots.push({ x: bx - bigH.beam / 2 - 1.6, z: MEDZ + 2.0, face: Math.PI, job: "yacht captain",
            id: "captain", wealth: 0.9, outfit: 0x1d2a44, pose: "foldarms" });
          crewSpots.push({ x: bx + bigH.beam / 2 + 1.4, z: MEDZ + 2.6, face: Math.PI * 0.86, job: "deckhand",
            id: "deckhand", wealth: 0.3, outfit: 0xe8eaec, pose: "table" });
        }
        registerBerth({
          id: "marina-med" + i, x: bx, z: MEDZ - bigH.loa * 0.5 - 1.2,
          heading: Math.PI,                     // bow -z, stern to the quay
          loa: bigH.loa, beam: bigH.beam, kind: "med",
          label: "Superyacht Quay " + (i + 1),
        });
        // the pair of stern bollards + a passerelle stub for each berth
        boll.push(boxGeoAt(bx - bigH.beam / 2, QUAY_TOP + 0.3, MEDZ + 0.9, 0.4, 0.6, 0.4));
        boll.push(boxGeoAt(bx + bigH.beam / 2, QUAY_TOP + 0.3, MEDZ + 0.9, 0.4, 0.6, 0.4));
        // stern lines running down to the water (thin angled boxes — the read)
        for (const sgn of [-1, 1]) {
          lines.push(boxGeoAt(bx + sgn * bigH.beam / 2, (QUAY_TOP + SEA_Y) / 2 + 0.1, MEDZ - 0.6, 0.06, 1.8, 0.06, 0, sgn * 0.5));
        }
      }
      mergeAdd(boll, m(CLEAT));
      mergeAdd(lines, m(0x1d1f22));
    }

    // =====================================================================
    //  4) SHORE FURNITURE — harbourmaster, chandlery, club terrace,
    //     travel-lift gantry over a lift well, hardstand yard.
    // =====================================================================
    // -- harbourmaster office: two storeys, a window band, a signal mast --
    {
      const hx = QX - 11, hz = BZ + 10;
      const body = new THREE.Mesh(new THREE.BoxGeometry(8, 6.2, 6), m(0xe6e8ea));
      body.position.set(hx, QUAY_TOP + 3.1, hz); body.castShadow = true; body.receiveShadow = true; root.add(body);
      solid(hx, hz, 8, 6, body, 0, QUAY_TOP + 6.2);
      const band = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.3, 6.2), m(0x2f4a63));
      band.position.set(hx, QUAY_TOP + 4.6, hz); root.add(band);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.24, 6.8), m(0x8c9298));
      roof.position.set(hx, QUAY_TOP + 6.3, hz); root.add(roof);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5.0, 0.16), m(0xd8dade));
      mast.position.set(hx + 3.4, QUAY_TOP + 8.9, hz - 2.4); root.add(mast);
      const pennant = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 1.2), m(0xd94a3a));
      pennant.position.set(hx + 3.4, QUAY_TOP + 10.8, hz - 1.7); root.add(pennant);
    }
    // -- chandlery: a low shed with a roller door + a rack of fenders --
    {
      const sx = QX - 12, sz = BZ - 8;
      const shed = new THREE.Mesh(new THREE.BoxGeometry(10, 4.2, 7), m(0xb7c0c6));
      shed.position.set(sx, QUAY_TOP + 2.1, sz); shed.castShadow = true; shed.receiveShadow = true; root.add(shed);
      solid(sx, sz, 10, 7, shed, 0, QUAY_TOP + 4.2);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.0, 3.4), m(0x50575c));
      door.position.set(sx + 5.05, QUAY_TOP + 1.5, sz); root.add(door);
      const eave = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.2, 7.6), m(0x7d848a));
      eave.position.set(sx, QUAY_TOP + 4.3, sz); root.add(eave);
      const rack = [];
      for (let i = 0; i < 6; i++) rack.push(boxGeoAt(sx + 6.2, QUAY_TOP + 0.6 + (i % 2) * 0.9, sz - 2.4 + i * 0.8, 0.4, 0.8, 0.4));
      mergeAdd(rack, m(0x24272b));
    }
    // -- yacht club terrace: a raised deck with tables and umbrellas --
    {
      const tx = QX - 8, tz = BZ + 24, TW = 12, TD = 9, TT = QUAY_TOP + 0.4;
      const planks = [];
      for (let x = tx - TW / 2 + 0.6; x < tx + TW / 2; x += 1.1) planks.push(boxGeoAt(x, TT - 0.06, tz, 1.0, 0.12, TD));
      mergeAdd(planks, m(WOOD_A));
      plat(tx - TW / 2, tx + TW / 2, tz - TD / 2, tz + TD / 2, TT);
      const rail = [];
      rail.push(boxGeoAt(tx, TT + 0.95, tz - TD / 2 + 0.06, TW, 0.08, 0.08));
      rail.push(boxGeoAt(tx + TW / 2 - 0.06, TT + 0.95, tz, 0.08, 0.08, TD));
      for (let x = tx - TW / 2; x <= tx + TW / 2; x += 1.6) rail.push(boxGeoAt(x, TT + 0.5, tz - TD / 2 + 0.06, 0.07, 0.9, 0.07));
      mergeAdd(rail, m(0xe4e7ea));
      for (let i = 0; i < 3; i++) {
        const ux = tx - 3.6 + i * 3.6, uz = tz + 1.4;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 0.12), m(0x9aa0a6));
        post.position.set(ux, TT + 1.15, uz); root.add(post);
        const canopy = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 8), m(i % 2 ? 0xe8ebee : 0x2f6d8f));
        canopy.position.set(ux, TT + 2.3, uz); root.add(canopy);
        const table = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.08, 10), m(0xdfe3e6));
        table.position.set(ux, TT + 0.74, uz); root.add(table);
      }
    }
    // -- travel-lift gantry straddling the lift well (the well itself is the
    //    hole left in the quay slab above — real open water, no platform) --
    {
      const wx0 = WELL_X0, wx1 = QW1;
      const legs = [], beams = [];
      for (const lx of [wx0 + 1.5, wx1 - 1.5]) for (const lz of [WELL_Z - 4.2, WELL_Z + 4.2]) {
        legs.push(boxGeoAt(lx, QUAY_TOP + 4.2, lz, 0.7, 8.4, 0.7));
        // SOLID: four 8.4 m steel legs standing on the quay you walk along.
        // `boxGeoAt`/`mergeAdd` are DRAW-ONLY in this file (the collider comes
        // from `solid()`), so the biggest machine on the waterfront was a
        // silhouette. Legs only — the beams are 8.7-9.2 m up, over your head.
        solid(lx, lz, 0.7, 0.7, null, QUAY_TOP, QUAY_TOP + 8.4);
      }
      for (const lz of [WELL_Z - 4.2, WELL_Z + 4.2]) beams.push(boxGeoAt((wx0 + wx1) / 2, QUAY_TOP + 8.7, lz, wx1 - wx0 - 1.4, 0.7, 0.8));
      beams.push(boxGeoAt((wx0 + wx1) / 2, QUAY_TOP + 9.2, WELL_Z, 1.4, 0.6, 9.2));
      mergeAdd(legs, m(0x2f6d8f), root, true);
      mergeAdd(beams, m(0x2f6d8f), root, true);
      const slings = [];
      for (const sz of [WELL_Z - 2.0, WELL_Z + 2.0]) slings.push(boxGeoAt((wx0 + wx1) / 2, QUAY_TOP + 6.6, sz, 0.14, 4.6, 0.14));
      mergeAdd(slings, m(0x3a3f44));
      // A GANTRY DOES NOT LIFT A BOAT BY ITSELF. The lift operator stands at
      // the head of the well where the controls are, watching the slings.
      crewSpots.push({ x: (wx0 + wx1) / 2 - 2.0, z: WELL_Z - 5.6, face: 0, job: "boat mechanic",
        id: "lift", wealth: 0.32, outfit: 0x3a78c9, pose: "foldarms" });
    }
    // -- hardstand yard: hulls out of the water, chocked on steel cradles --
    {
      const yx = QX - 15;
      const cradles = [], hulls = [], hulled = [];
      for (let i = 0; i < 5; i++) {
        const yz = BZ - 38 + i * 6.4;
        const len = 6.5 + CBZ.hash01(yx, yz, 771) * 5.5;
        const bm = 1.9 + CBZ.hash01(yx, yz, 772) * 1.3;
        const yaw = (CBZ.hash01(yx, yz, 773) - 0.5) * 0.12;
        for (const dx of [-len * 0.28, len * 0.28]) {
          cradles.push(boxGeoAt(yx + dx, QUAY_TOP + 0.55, yz, 0.5, 1.1, bm + 1.0, yaw));
        }
        hulls.push(boxGeoAt(yx, QUAY_TOP + 1.7, yz, len, 1.5, bm, yaw));
        hulls.push(boxGeoAt(yx, QUAY_TOP + 2.5, yz - 0.1, len * 0.42, 0.9, bm * 0.7, yaw));
        hulled.push({ x: yx, z: yz, w: len, d: bm + 0.6 });
      }
      mergeAdd(cradles, m(0x8a5f2e));
      // colliders carry the MERGED mesh as their ref (batch.js/LOS/demolition
      // all resolve a collider back to a real object — never leave ref null)
      const hullMesh = mergeAdd(hulls, m(0xe2e5e8), root, true);
      for (const h of hulled) solid(h.x, h.z, h.w, h.d, hullMesh, 0, QUAY_TOP + 2.4);
    }
    // -- the brokerage building: the dealer's showroom, glass to the water.
    //    boatyard.js registers its sales desk at deskX/deskZ (exposed below).
    const DESK = { x: QX - 6.5, z: BZ + DEAL_Z + 4 };
    {
      const bx = QX - 9, bz = BZ + DEAL_Z + 4;
      const body = new THREE.Mesh(new THREE.BoxGeometry(13, 5.4, 11), m(0xf0f2f4));
      body.position.set(bx, QUAY_TOP + 2.7, bz); body.castShadow = true; body.receiveShadow = true; root.add(body);
      solid(bx, bz, 13, 11, body, 0, QUAY_TOP + 5.4);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.6, 10.4), m(0x8fc4e0));
      glass.position.set(bx + 6.6, QUAY_TOP + 2.5, bz); root.add(glass);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(13.8, 0.26, 11.8), m(0xb9bfc4));
      roof.position.set(bx, QUAY_TOP + 5.5, bz); root.add(roof);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 8.4), m(0x123a5a));
      sign.position.set(bx + 6.9, QUAY_TOP + 6.3, bz); root.add(sign);
      // the desk marker the interaction zone sits on
      const desk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 0.9), m(WOOD_DK));
      desk.position.set(DESK.x, QUAY_TOP + 0.5, DESK.z); desk.castShadow = true; root.add(desk);
    }

    // =====================================================================
    //  5) BREAKWATER ARMS + THE CHANNEL — rubble mound with a walkable
    //     concrete cap, hooking in to leave a 26m entrance. IALA REGION B:
    //     entering from seaward (heading WEST) starboard is the -z side, so
    //     RED goes on the SOUTH head and GREEN on the NORTH head, and the
    //     channel cans repeat the pair. "Red, right, returning."
    // =====================================================================
    const CAP_TOP = 1.6;
    function breakwater(z, hookZ) {
      // The arms start clear of the quay's z-ends (QZ0/QZ1) so rip-rap never
      // grows out of the apron, and clear of the Med quay face at MEDZ+5.
      const x0 = QX + 8, x1 = QX + 80;
      const rocks = [];
      for (let x = x0; x <= x1; x += 3.2) {
        const s = 1.6 + CBZ.hash01(x, z, 811) * 2.4;
        rocks.push(boxGeoAt(x, SEA_Y + 0.2 + CBZ.hash01(x, z, 812) * 0.5, z + (CBZ.hash01(x, z, 813) - 0.5) * 2.2, s, s * 0.8, s * 1.15, CBZ.hash01(x, z, 814) * Math.PI));
      }
      const hz0 = Math.min(z, hookZ), hz1 = Math.max(z, hookZ);
      for (let zz = hz0; zz <= hz1; zz += 3.2) {
        const s = 1.6 + CBZ.hash01(x1, zz, 815) * 2.4;
        rocks.push(boxGeoAt(x1 + (CBZ.hash01(x1, zz, 816) - 0.5) * 2.2, SEA_Y + 0.2 + CBZ.hash01(x1, zz, 817) * 0.5, zz, s, s * 0.8, s * 1.15, CBZ.hash01(x1, zz, 818) * Math.PI));
      }
      mergeAdd(rocks, m(ROCK));
      // the cap: a 2.2m concrete walkway along the crest, both legs
      const cap = [];
      cap.push(boxGeoAt((x0 + x1) / 2, CAP_TOP - 0.2, z, x1 - x0, 0.4, 2.2));
      cap.push(boxGeoAt(x1, CAP_TOP - 0.2, (hz0 + hz1) / 2, 2.2, 0.4, hz1 - hz0));
      mergeAdd(cap, m(CONCRETE_DK));
      plat(x0, x1, z - 1.1, z + 1.1, CAP_TOP);
      plat(x1 - 1.1, x1 + 1.1, hz0, hz1, CAP_TOP);
      // A CAP 1.6m above the water is not climbable from a swim (STEP_UP is
      // 0.45m), so the root of each arm gets three concrete steps down to the
      // waterline — you can get out of the sea onto the mole, which is what
      // makes the arms somewhere to go rather than scenery.
      const steps = [];
      const NSTEP = 5, RISE = 0.40;                       // each riser < STEP_UP (0.45)
      for (let s = 0; s < NSTEP; s++) {
        const top = SEA_Y + 0.38 + s * RISE;              // -0.10 .. 1.50, then the cap at 1.60
        const sx = x0 - 0.7 - (NSTEP - 1 - s) * 1.2;
        steps.push(boxGeoAt(sx, top - 0.2, z, 1.2, 0.4, 2.0));
        plat(sx - 0.6, sx + 0.6, z - 1.0, z + 1.0, top);
      }
      mergeAdd(steps, m(CONCRETE_DK));
      return { x1: x1, hookZ: hookZ };
    }
    const southArm = breakwater(BZ - 62, BZ - 14);
    const northArm = breakwater(BZ + 58, BZ + 12);

    // head lights + channel buoys (IALA Region B)
    function navHead(x, z, color) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 3.4, 8), m(0xe8ebee));
      col.position.set(x, CAP_TOP + 1.7, z); col.castShadow = true; root.add(col);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6),
        new THREE.MeshLambertMaterial({ color: color, emissive: color, emissiveIntensity: 0.9 }));
      lamp.position.set(x, CAP_TOP + 3.7, z); root.add(lamp);
      solid(x, z, 1.4, 1.4, col, 0, CAP_TOP + 3.4);
    }
    // RED to STARBOARD entering from seaward => the SOUTH head is red.
    navHead(southArm.x1, southArm.hookZ, 0xd42f2f);
    navHead(northArm.x1, northArm.hookZ, 0x2fbd57);
    {
      const cans = [];
      for (let i = 0; i < 3; i++) {
        const bx = QX + 92 + i * 26;
        // red CAN to starboard (south side of the channel), green to port
        cans.push({ x: bx, z: BZ - 13 - i * 2, c: 0xd42f2f, can: true });
        cans.push({ x: bx, z: BZ + 11 + i * 2, c: 0x2fbd57, can: false });
      }
      for (const b of cans) {
        if (!waterAt(b.x, b.z)) continue;
        const buoy = new THREE.Group();
        buoy.position.set(b.x, SEA_Y, b.z);
        const hull = new THREE.Mesh(b.can
          ? new THREE.CylinderGeometry(0.62, 0.62, 1.5, 8)          // CAN (flat top) = red, Region B
          : new THREE.ConeGeometry(0.68, 1.7, 8),                   // NUN (conical) = green
          m(b.c));
        hull.position.y = 0.75; buoy.add(hull);
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), m(b.c));
        top.position.y = 1.9; buoy.add(top);
        root.add(buoy);
        // buoys ride the swell like anything else afloat
        if (CBZ.waterFloat) {
          try { const h = CBZ.waterFloat(buoy, { len: 1.4, beam: 1.4, buoy: 1, tilt: 0.5, kind: "buoy" }); if (h && h.release) floatHandles.push(h); } catch (e) {}
        }
      }
    }

    // =====================================================================
    //  6) PILES + MOORING LINES around the basin mouth (the working read)
    // =====================================================================
    {
      const piles = [];
      for (let i = 0; i < 8; i++) {
        const px = QX + 12 + i * 8;
        const pz = BZ + (i % 2 ? 34 : -34);
        if (!waterAt(px, pz)) continue;
        piles.push(boxGeoAt(px, SEA_Y + 1.4, pz, 0.42, 5.2, 0.42, CBZ.hash01(px, pz, 831) * 0.3));
        // a mooring pile is a driven timber, and a boat that motors THROUGH the
        // piles marking its own channel mouth is the whole reason they read as
        // paint. Full-height (they stand from the seabed up), 0.42 square.
        solid(px, pz, 0.42, 0.42, null);
      }
      mergeAdd(piles, m(WOOD_DK), root, true);
    }

    site = {
      QX: QX, BZ: BZ, quay: { x0: QW0, x1: QW1, z0: QZ0, z1: QZ1, top: QUAY_TOP },
      desk: DESK, well: { x: QX - 6, z: WELL_Z },
      fuel: { x: QX + FUEL_X, z: BZ + FUEL_Z },
      med: { z: MEDZ }, root: root, group: pontoonGrp,
      decks: decks, localPlats: localPlats,
    };

    // =====================================================================
    //  7) FLOATING: hand the pontoon decks to WP-1's moving-platform
    //     primitive if it exists, else fall back to STATIC platform records
    //     at the mean waterline (exactly the old inline value). Degrade-safe:
    //     adopting the block can never break walking on the dock.
    // =====================================================================
    if (C.MARINA_FLOAT !== false && CBZ.movingPlatform) {
      try { pontoonRig = CBZ.movingPlatform(pontoonGrp, { decks: decks, riders: true, yaw: false, camYaw: false }); } catch (e) { pontoonRig = null; }
    }
    if (!pontoonRig) { for (const p of localPlats) { CBZ.platforms.push(p); staticPlats.push(p); } }

    // =====================================================================
    //  8) LIFE — dockhands and liveaboards. REUSED spawner: npcLife's
    //     definePopulation (the same path island_airport/biome_desert use).
    //     No new NPC update loop is created by this file.
    // =====================================================================
    (function populate() {
      const NL = CBZ.npcLife;
      const at = [];
      function person(profile, x, z, opts, role) { at.push({ profile: profile, x: x, z: z, opts: opts || {}, role: role }); }
      person("groundCrew", QX - 4, BZ + 4, { kind: "worker", archetype: "laborer", job: "dockhand", outfit: 0xf0a020, wealth: 0.3, aggr: 0.12 }, "dockhand");
      person("groundCrew", QX - 3, BZ - 14, { kind: "worker", archetype: "laborer", job: "dockhand", outfit: 0xf0a020, wealth: 0.3, aggr: 0.12 }, "dockhand");
      person("groundCrew", QX - 13, WELL_Z + 2, { kind: "worker", archetype: "laborer", job: "yard hand", outfit: 0x3a78c9, wealth: 0.28, aggr: 0.14 }, "yard");
      person("cityResident", QX - 10, BZ + 8, { kind: "civilian", archetype: "resident", job: "harbourmaster", wealth: 0.55, aggr: 0.08 }, "harbourmaster");
      person("cityResident", QX - 8, BZ + 24, { kind: "civilian", archetype: "resident", job: "club member", wealth: 0.9, aggr: 0.05 }, "club");
      person("cityResident", QX - 7, BZ + 26, { kind: "civilian", archetype: "resident", job: "club member", wealth: 0.88, aggr: 0.05 }, "club");
      person("cityResident", QX + 6, BZ - 3, { kind: "civilian", archetype: "resident", job: "liveaboard", wealth: 0.42, aggr: 0.1 }, "liveaboard");
      person("cityResident", QX + 22, BZ + 2, { kind: "civilian", archetype: "resident", job: "liveaboard", wealth: 0.44, aggr: 0.1 }, "liveaboard");
      person("cityResident", QX - 6.5, BZ + DEAL_Z + 6, { kind: "civilian", archetype: "resident", job: "yacht broker", wealth: 0.95, aggr: 0.04 }, "broker");

      if (NL && NL.definePopulation) {
        NL.definePopulation("marina-authored", {
          root: root,
          entries: at.map(function (p) {
            return {
              profile: p.profile, placement: { x: p.x, z: p.z, rng: rng }, overrides: p.opts,
              configure: function (a) { a._marinaRole = p.role; },
            };
          }),
        });
      } else if (CBZ.cityMakePed) {
        for (const p of at) {
          const a = CBZ.cityMakePed(p.x, p.z, rng, p.opts);
          if (!a || !a.group) continue;
          root.add(a.group);
          if (CBZ.cityPeds && CBZ.cityPeds.indexOf(a) < 0) CBZ.cityPeds.push(a);
          a._marinaRole = p.role;
        }
      }
      // liveaboard clutter: bicycles chained to the quay rail + potted plants
      const clutter = [];
      for (let i = 0; i < 4; i++) {
        const bx = QX - 2.4, bz = BZ - 2 + i * 5.5;
        clutter.push(boxGeoAt(bx, QUAY_TOP + 0.55, bz, 0.14, 0.9, 1.5));         // frame
        clutter.push(boxGeoAt(bx, QUAY_TOP + 0.35, bz - 0.62, 0.1, 0.66, 0.66)); // wheels (read)
        clutter.push(boxGeoAt(bx, QUAY_TOP + 0.35, bz + 0.62, 0.1, 0.66, 0.66));
      }
      mergeAdd(clutter, m(0x3d4145));
      const pots = [];
      for (let i = 0; i < 6; i++) {
        const px = QX - 5.5 + (i % 2) * 1.4, pz = BZ + 14 + i * 1.6;
        pots.push(boxGeoAt(px, QUAY_TOP + 0.24, pz, 0.5, 0.48, 0.5));
      }
      mergeAdd(pots, m(0xa8643c));
      const leaves = [];
      for (let i = 0; i < 6; i++) {
        const px = QX - 5.5 + (i % 2) * 1.4, pz = BZ + 14 + i * 1.6;
        leaves.push(boxGeoAt(px, QUAY_TOP + 0.75, pz, 0.7, 0.6, 0.7));
      }
      mergeAdd(leaves, m(0x3f7a3a));
    })();

    // A work anchor so the city's existing job brain routes dockhands here —
    // reuse, not a new schedule system.
    //
    // IT WAS DEAD. `kind: "work"` matched NO job in aigoals.js's CITY_JOBS, and
    // an anchor kind nothing routes to is a stat fiction with coordinates: the
    // marina's own dockhands, yard hands and harbourmaster had a label and
    // nowhere to go. The kind is now "marina", which is what citystaff.js's
    // TRADES table registers every waterfront trade against, and `role` names
    // the trade the way every other biome anchor in the game does.
    if (CBZ.registerWorkAnchor) {
      try {
        CBZ.registerWorkAnchor({
          biome: "coast", kind: "marina", role: "dockhand",
          name: "Marina", x: QX - 4, z: BZ, cap: 5,
          home: { x: QX - 10, z: BZ + 8 },                 // the harbourmaster's office
          spots: [{ x: QX - 4, z: BZ + 4 }, { x: QX - 3, z: BZ - 14 }, { x: QX - 13, z: WELL_Z + 2 }, { x: QX + 10, z: BZ }],
        });
      } catch (e) {}
    }

    /* =====================================================================
       9) THE REST OF THE PEOPLE WHO WORK HERE.

       OWNER: "every place should have the people who work there." This marina
       drew a travel-lift gantry, a hardstand yard, a Med-moor superyacht quay
       and a fuel dock and staffed NONE of them — the authored population above
       is nine bodies standing on the quay, and not one of them is a captain, a
       deckhand or a mechanic. These four are the missing trades, declared
       against the geometry that implies them and manned by city/citystaff.js
       only when you are inside 170 m (a full rig is ~16 draw calls, and this
       basin is 200 m of waterfront you can only stand on one part of).

       They are ordinary peds — killable through the feed, aimable, and every
       ped verb interactions.js already registers works on them.
       ===================================================================== */
    crewSpots.push({ x: QX + FUEL_X - 3.6, z: BZ + FUEL_Z + 0.9, face: -Math.PI / 2, job: "fuel attendant",
      id: "fuel", wealth: 0.26, outfit: 0xe0a93b, pose: "table" });
    if (CBZ.cityStaffVenue && CBZ.cityStaffPost) {
      // 9 authored bodies + 4 crew + the quay fisherman = the whole staff.
      CBZ.cityStaffVenue("marina", {
        stations: 14, note: "quay, yard, lift well, fuel dock, superyacht quay",
        // the authored population (dockhands, harbourmaster, liveaboards,
        // broker) mans itself through npcLife.definePopulation — count it here
        // so the audit is not told the marina is 9 people short of itself.
        census: function () {
          const peds = CBZ.cityPeds || [];
          let n = 0;
          for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i]._marinaRole && !peds[i].dead) n++;
          return n;
        },
      });
      for (let i = 0; i < crewSpots.length; i++) {
        const s = crewSpots[i];
        CBZ.cityStaffPost({
          venue: "marina", id: "marina:" + s.id, job: s.job,
          archetype: s.job === "yacht captain" ? "professional" : "laborer",
          x: s.x, z: s.z, face: s.face, pose: s.pose,
          opts: { wealth: s.wealth, outfit: s.outfit, aggr: 0.1 },
        });
      }
    }

    // THE WATER IS FISHED. Two stations on geometry that already exists: the
    // quay edge beside the harbourmaster's office and the end of the fuel
    // pontoon. Each validates its own water (city/fishing.js refuses a station
    // whose water point is not water), so if a future coastline moves out from
    // under this marina the stations disappear instead of lying.
    if (CBZ.fishSpotRegister) {
      const quaySpot = CBZ.fishSpotRegister(QX - 2.5, BZ + 20, {
        name: "Marina Quay", face: Math.PI / 2, y: QUAY_TOP, water: { x: QX + 16, z: BZ + 20 },
      });
      CBZ.fishSpotRegister(QX + FUEL_X + 5.0, BZ + FUEL_Z, {
        name: "Fuel Dock", face: Math.PI / 2, water: { x: QX + FUEL_X + 16, z: BZ + FUEL_Z },
      });
      // ...and the man who works one of them. level.js has carried a
      // "Fisherman" title for its whole life with nobody wearing it; this is
      // one of the two bodies that finally do.
      if (quaySpot && CBZ.cityStaffPost) {
        CBZ.cityStaffPost({
          venue: "marina", id: "marina:angler", job: "fisherman", archetype: "laborer",
          x: quaySpot.x - 1.1, z: quaySpot.z, face: quaySpot.face, pose: "table",
          opts: { wealth: 0.22, outfit: 0x4a5232, aggr: 0.08 },
          after: function (ped) { if (CBZ.fishWorkRod) CBZ.fishWorkRod(ped, quaySpot); },
        });
      }
    }

    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return null;
  }, 66);

  /* ============================================================
     PART 3 — THE MARINA'S OWN HULLS (spawned after traffic)
     ------------------------------------------------------------
     cityMakeCar needs CBZ.city.arena, which mode.js only assigns AFTER
     buildCity() returns — so, exactly like world.js's harbour boats, we hang
     off CBZ.spawnCityTraffic (which also clears cityCars on every run, so the
     marina must re-fire after each respawn or it goes empty).
     ============================================================ */
  function spawnResidents() {
    if (!site || !CBZ.cityMakeCar || !CBZ.cityEcon || !CBZ.cityEcon.carByName || !CBZ.city || !CBZ.city.arena) return;
    const fallback = CBZ.cityEcon.carByName("Speedboat");
    if (!fallback) return;
    // The brokerage's DEMO berths show the actual range on offer (§H: a dealer
    // is a showroom on the water with demo hulls at its own dock). We read the
    // yard's catalog for that — feature-detected, and a berth we can't stock
    // just gets the runabout, never an empty slot.
    let cat = null;
    if (CBZ.cityBoatyard && CBZ.cityBoatyard.catalog) { try { cat = CBZ.cityBoatyard.catalog(); } catch (e) {} }
    let demoIdx = 0;
    for (const s of residentSpots) {
      let model = fallback;
      if (s.berth && s.berth.kind === "dealer" && cat && cat.length) {
        // walk the ladder from the top down so the showroom leads with the
        // big money, and skip anything that will not physically fit the berth
        for (let k = cat.length - 1 - demoIdx; k >= 0; k--) {
          const e = cat[k];
          if (e.loa <= s.berth.loa + 0.5 && e.model) { const mm = CBZ.cityEcon.carByName(e.model); if (mm) { model = mm; break; } }
        }
        demoIdx++;
      }
      const c = CBZ.cityMakeCar(s.x, s.z, s.heading, false, model, 0);
      if (!c) continue;
      c.ai = false; c.v = 0; c.baseV = 0; c.road = null;   // moored — sits still until jacked
      c._marinaResident = true;
      if (s.berth) s.berth.occupant = c;
    }
  }
  (function wrapTraffic() {
    function bind() {
      if (!CBZ.spawnCityTraffic || CBZ.spawnCityTraffic._marinaWrapped) return !!(CBZ.spawnCityTraffic && CBZ.spawnCityTraffic._marinaWrapped);
      const orig = CBZ.spawnCityTraffic;
      const w = function (n) { const r = orig(n); try { spawnResidents(); } catch (e) {} return r; };
      // carry EVERY existing wrap marker forward (the repo's wrapper doctrine)
      for (const k in orig) { try { w[k] = orig[k]; } catch (e) {} }
      w._marinaWrapped = true;
      CBZ.spawnCityTraffic = w;
      return true;
    }
    if (!bind() && CBZ.onUpdate) CBZ.onUpdate(14.6, function () { if (CBZ.spawnCityTraffic && CBZ.spawnCityTraffic._marinaWrapped) return; bind(); });
  })();

  /* ============================================================
     PART 4 — THE PONTOONS RIDE THE SWELL
     ------------------------------------------------------------
     Priority 9.4 — one frame-write, BEFORE moving platforms (9.5) and
     physics.updatePlayer (10), so a rider standing on the dock is carried by
     the same surface the boats float on. Skipped entirely when the player is
     far away (nobody can tell, and it is free).
     ============================================================ */
  if (CBZ.onUpdate) CBZ.onUpdate(9.4, function () {
    if (!pontoonGrp || !site || C.MARINA_FLOAT === false) return;
    if (g.mode !== "city") return;
    const P = CBZ.player;
    if (P && P.pos) {
      const dx = P.pos.x - site.QX, dz = P.pos.z - site.BZ;
      if (dx * dx + dz * dz > 240 * 240) return;
    }
    const y = seaY(site.QX + 30, site.BZ) - SEA_Y;
    // a pontoon is restrained by its piles: it heaves with the water but does
    // not surf the chop, so damp the target rather than tracking it raw.
    pontoonGrp.position.y += (y - pontoonGrp.position.y) * 0.25;
  });

  /* ============================================================
     PUBLIC SURFACE
     ============================================================ */
  CBZ.cityMarina = {
    site: function () { return site; },
    exists: function () { return !!site; },
    desk: function () { return site ? site.desk : null; },
    fuelDock: function () { return site ? site.fuel : null; },
    berths: berthList,
    pontoonRig: function () { return pontoonRig; },
    audit: function () { return CBZ.cityBerthAudit(); },
  };
  CBZ.cityMarinaReset = function () { site = null; pontoonGrp = null; pontoonRig = null; clearBerths(); residentSpots.length = 0; };
})();
