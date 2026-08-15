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
        · harbourmaster office, chandlery, yacht-club deck, travel-lift
          gantry over a lift well and an open hardstand yard
        · walkable breakwater caps with a channel
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

   THE HARBOUR WAS A MODEL OF A HARBOUR (2026-08-15)
   -------------------------------------------------
   OWNER: "the marina needs to be a lot bigger."

   It shipped as ONE 68 m dock carrying 13 finger berths, a 3-berth Med quay
   and a 104 m wall of concrete — and, MEASURED at runtime on the shipping
   seed, most of that was standing on grass. The east water it was authored
   against runs 56 m from the quay; the dock ran 71 m, the breakwater 80, and
   the buoyed channel 144. (The buoys were the only piece that checked
   `cityWaterAt` before drawing itself. They silently did not appear, which is
   why nobody ever noticed the rest.)

   The cause was not the numbers, it was that they were NUMBERS: every
   dimension in Part 2 was a literal, and the site probe only ever asked
   whether water existed 46 m east and 40 m either side of the quay — which is
   precisely the smallest box the old marina fits inside. The harbour could
   therefore never grow without somebody re-typing eleven constants and
   re-checking each one by eye against a coastline none of them knew.

   IT IS NOW MEASURED, AND IT IS MEASURED AGAINST A COASTLINE THAT EXISTS.
   Three rays walk out of a searched quay line until they leave navigable
   water, and every dimension below is SOLVED from those three numbers: the
   dock count, the spine length, the quay span, where the Med quay can stand
   without its 34 m hulls lying across the top dock's fingers, and whether this
   basin wants breakwater arms at all. A genuinely small basin gets exactly the
   marina it can hold, and one too small for any of this is REFUSED back to the
   authored layout rather than paved over — see PART 2's site note for why the
   builder had to move from landmass order 66 to 97.5 for any of that to mean
   anything.

   WHAT IT BUYS, on the shipping coastline: the real water beside this city is
   not a bay, it is a ~60 m dredged channel running ~400 m north-south, so the
   marina it can hold is FIVE short finger docks off a 197 m quay rather than
   one long one — which is what every marina in a cut or a river actually looks
   like — with the channel left open at both ends because a mole thrown across
   the only fairway is a wall, not shelter. 20 berths become ~80, every one of
   them verified afloat, and the trots RAMP seaward (small craft by the shore,
   cruisers at the dock head) so a spine is used along its whole length.

   THE BUDGET THAT SIZES IT is not draw calls — every pontoon and every finger
   in the basin is ONE merged mesh — it is systems/platforms_moving.js's
   rigTopAt(), which linearly scans this rig's deck list on every ground query
   while you are aboard. FINGER_BUDGET caps that list; the docks divide it.

   FLAGS (one-line revert each, declared here — config.js is off-limits):
     CBZ.CONFIG.MARINA              (true)  — build the marina at all
     CBZ.CONFIG.MARINA_FLOAT        (true)  — pontoons track the live swell
     CBZ.CONFIG.BOAT_BERTH_REDIRECT (true)  — the citySpawnOwnedCar wrapper
     CBZ.CONFIG.MARINA_BIG          (true)  — the measured basin. OFF restores
                                              the authored 2026-07 dimensions.

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
  if (C.MARINA_BIG == null) C.MARINA_BIG = true;

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
  const PONTOON_C = 0xd6d9dc, CLEAT = 0x2e3238;

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

    /* ---- SITE SELECTION -------------------------------------------------
       It used to be a KEYHOLE, and that is the deepest reason the marina was
       small. One authored basin line (cz-96), then a walk east stopping at the
       FIRST x where four sample points 46 m out were wet. Four points at 46 m
       is the smallest box the 2026-07 marina fitted inside, so the test could
       only ever find a site big enough for the marina that already existed —
       and on the shipping seed it found a 56 m inlet, into which the file then
       laid a 68 m dock, an 80 m breakwater and a buoyed channel out to 144 m.
       Most of that harbour was standing on dry ground. (The buoys were the one
       piece that checked; they simply vanished, which is why nobody noticed.)

       It now SEARCHES. Every candidate quay line in a band of the east coast
       is scored by the basin actually behind it — measured, in metres, by the
       same three rays that go on to size the harbour — and the best basin
       wins. That is what makes the marina bigger: not a larger literal, but
       standing it somewhere that can hold one.

       AND IT ASKS A COASTLINE THAT EXISTS. This builder used to run at
       landmass order 66; city/continent.js publishes `city.mapTerrain` — the
       real signed shoreline — inside its own builder at order 97. Before that
       moment city/waterfield.js's coastAt() falls back to a boot-time rule
       ("outside the arena rect and outside every registered region IS water"),
       which is true for the near-shore harbour the authored site sat in and
       badly false a couple of hundred metres out. A search run against that
       fallback does not find the biggest basin, it finds the biggest LIE — on
       the shipping seed it picked open countryside 300 m from the sea and put
       104 of 112 berths on grass, every one of which passed registerBerth's
       water check at the instant it was made. The builder is now order 97.5:
       after the coastline, before the late passes. city/captain.js (which
       reads this site synchronously) moved with it.

       The exclusions are kept and are still real: the east bridge span
       (world.js keeps |z-cz| < 12 clear) and the three free moored hulls at
       cz-26 / cz+24 / cz+44, all covered by requiring 70 m of separation from
       the city's centre line. If nothing scores, we build NOTHING rather than
       a marina on grass — the berth registry falls back to the roadstead.  */
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function reachOut(x0, z0, dx, dz, max) {
      let r = 0;
      for (let t = 8; t <= max; t += 4) { if (!waterAt(x0 + dx * t, z0 + dz * t)) break; r = t; }
      return r;
    }
    let BZ = cz - 96, QX = 0, found = false;
    if (C.MARINA_BIG === false) {
      for (let x = EEx + 12; x <= EEx + 140; x += 3) {
        if (waterAt(x + 6, BZ) && waterAt(x + 46, BZ) && waterAt(x + 46, BZ + 40) && waterAt(x + 46, BZ - 40)) { QX = x; found = true; break; }
      }
    } else {
      // COARSE probes here on purpose: this is a search over ~250 candidate
      // sites and the winner is re-measured at full resolution below, so a
      // 12 m stride costs a fifth of the samples and cannot change the answer
      // by more than one stride. Deterministic — pure geometry, no rng.
      function coarse(x0, z0, dx, dz, max) {
        let r = 0;
        for (let t = 12; t <= max; t += 12) { if (!waterAt(x0 + dx * t, z0 + dz * t)) break; r = t; }
        return r;
      }
      let bestScore = 0;
      for (let z = cz - 340; z <= cz + 340; z += 24) {
        if (Math.abs(z - cz) < 70) continue;             // bridge span + the free hulls
        for (let x = EEx + 12; x <= EEx + 200; x += 10) {
          if (!waterAt(x + 8, z)) continue;              // no water at the quay face at all
          const rE = coarse(x, z, 1, 0, 300);
          if (rE < 50) continue;                         // cannot hold a dock worth building
          const mx = x + Math.min(90, rE * 0.45);
          const rN = coarse(mx, z, 0, 1, 420), rS = coarse(mx, z, 0, -1, 420);
          /* A HARBOUR IS BREADTH TIMES LENGTH, and the two caps are NOT the
             same number because the two axes are not the same thing. Breadth
             (east, into the water) is how long ONE dock can be, and past ~140 m
             a longer dock buys nothing this rig can afford to carry. Length
             (along the shore) is how MANY docks there are, and that is where a
             real basin's capacity comes from — so it is capped four times
             higher. The first cut capped them nearly equally at 220/260, which
             quietly told the search that a 220 m-wide bay was worth as much as
             a 400 m-long channel; the shipping coastline is the channel. */
          const score = Math.min(rE, 140) * Math.min(rN + rS, 460);
          if (score > bestScore) { bestScore = score; QX = x; BZ = z; found = true; }
        }
      }
      // …and if the search found nothing at all, fall back to the authored
      // line rather than losing the marina outright.
      if (!found) {
        BZ = cz - 96;
        for (let x = EEx + 12; x <= EEx + 140; x += 3) {
          if (waterAt(x + 6, BZ) && waterAt(x + 46, BZ) && waterAt(x + 46, BZ + 40) && waterAt(x + 46, BZ - 40)) { QX = x; found = true; break; }
        }
      }
    }
    if (!found) return null;

    /* ---- MEASURE THE BASIN, THEN SIZE THE MARINA TO IT ------------------
       Three rays. East along the basin centre line, then north and south at a
       point roughly mid-basin — sampled THERE and not at the quay, because the
       quay stands in the shore notch and would report the notch's width as the
       harbour's. Nothing below is a typed harbour dimension: they are all
       solved off rE/rN/rS against a target and a floor.                     */
    const MAIN_W = 2.4, MAIN_X0 = 3;
    // Fingers this rig may carry. See the header: the cost of a berth is not
    // its geometry (all of them are one merged mesh) but its DECK RECORD, and
    // platforms_moving.js walks that list per ground query while you stand on
    // the dock. 96 is ~5x what the marina had and ~1/35th of the static
    // platform grid the world already carries.
    const FINGER_BUDGET = 96;
    // the authored 2026-07 marina — the degrade path, and the thing
    // MARINA_BIG=false restores
    const LEGACY = {
      mainLen: 68, dockZ: [0], head: false, ramp: false,
      sCap: 8, nCap: 5, legacyIds: true,
      quayZ0: -56, quayZ1: 48, wellZ: -46,
      fuelZ: MAIN_W / 2 + 14, dealZ: -MAIN_W / 2 - 26, dealBerths: 3, dealW: 18,
      medZ: 44, medN: 3, medFaceW: 58, medFaceCx: 30,
      armS: -62, armN: 58, hookS: -14, hookN: 12,
      pileN: 8, pileZS: -34, pileZN: 34, residentCap: 6, arms: true,
    };
    let L = (C.MARINA_BIG === false) ? LEGACY
      : (function measured() {
          const rE = reachOut(QX, BZ, 1, 0, 400);
          const mx = QX + clamp(rE * 0.45, 24, 90);
          const rN = reachOut(mx, BZ, 0, 1, 460);
          const rS = reachOut(mx, BZ, 0, -1, 460);
          /* DOES THIS BASIN WANT BREAKWATERS AT ALL? A mole is shelter, and
             shelter you already have is a WALL. On the shipping coastline the
             best water is a ~60 m dredged channel; an arm reaching 50 m across
             it from the quay leaves under 10 m of fairway, so the thing built
             to protect the harbour would be the thing closing the only way in
             and out of it — for the player's boat, for piracy.js's runners and
             for captain.js's fleet alike. A channel's banks ARE its
             breakwaters, which is why no marina in a river or a cut has any.
             120 m is the width at which arms plus a working fairway plus the
             docks all fit; below it the water is left open.                */
          const wantArms = rE >= 120;
          // What the east margin buys: with arms, the elbow and its hook and a
          // fairway outside them (40); without, just a fairway (20).
          const mainLen = clamp(rE - (wantArms ? 40 : 20), 0, 118);
          // NO FLOOR ON ANY OF THESE THREE. A minimum span is a promise the
          // water has not made: clamping `spanN` up to 52 in a 30 m bay does
          // not widen the bay, it just puts the north breakwater arm 22 m
          // inland. The layout refuses below instead.
          // ALONG THE SHORE IS WHERE THE CAPACITY IS, so these two are capped
          // far higher than the dock length. A marina on a 400 m channel is
          // not one long dock, it is a lot of short ones — which is also what
          // every marina in a river or a dredged cut actually looks like.
          const spanN = clamp(rN - 14, 0, 190);
          const spanS = clamp(rS - 14, 0, 190);
          // WHAT HAS TO FIT ABOVE AND BELOW THE DOCK FIELD, in metres, and why:
          //   north  56  the Med quay stands off the top dock by one 34 m hull
          //              plus that dock's longest finger plus working water —
          //              a superyacht moored stern-to lies ACROSS the basin, and
          //              this is the number that keeps it off the trot.
          //          +18 the north breakwater arm, outside the Med quay with a
          //              working fairway of dolphins behind the face.
          //   south  15  the brokerage's demo dock.
          //          +15 the south breakwater arm outside it.
          const hi = spanN - 74, lo = -spanS + 30;
          // VIABILITY, and it is a REFUSAL, not a clamp. `hi < lo` means the
          // basin cannot hold one dock plus the furniture north and south of
          // it; a 40 m spine means there is no dock worth laying. Returning
          // null hands the whole thing back to the authored layout at the
          // authored site — which is exactly the marina that shipped, so the
          // worst case of this feature is the status quo and never a pontoon
          // on a field.
          if (hi < lo || mainLen < 34) return null;
          const PITCH = 27;                      // dock-to-dock: two trots + fairway
          const n = clamp(Math.floor((hi - lo) / PITCH) + 1, 1, 6);
          const mid = (hi + lo) / 2, span = (n - 1) * PITCH;
          // centred in the band, then held INSIDE it — with one dock the
          // midpoint is the whole band and rounding can still push the row a
          // metre past the edge the Med quay is measured from.
          const base = clamp(mid - span / 2, lo, Math.max(lo, hi - span));
          const dockZ = [];
          for (let i = 0; i < n; i++) dockZ.push(Math.round(base + i * PITCH));
          const fuelZ = dockZ[n - 1] + 16;       // its own pontoon, near the entrance
          const medZ = dockZ[n - 1] + 56;
          const dealZ = dockZ[0] - 15;
          const cap = Math.max(4, Math.floor(FINGER_BUDGET / (n * 2)));
          const bigLoa = 34;
          return {
            mainLen: mainLen, dockZ: dockZ, head: true, ramp: true, arms: wantArms,
            sCap: cap, nCap: cap, legacyIds: false,
            quayZ0: Math.round(dealZ - 12), quayZ1: Math.round(medZ + 6),
            wellZ: Math.round(dealZ - 2),
            fuelZ: fuelZ, dealZ: dealZ,
            dealBerths: 5, dealW: 6 + 5 * 7,
            medZ: medZ,
            // the Med face runs from the quay out along the basin; each hull
            // takes only its BEAM of it, so the count is the face divided by
            // that step and capped where the basin's own arm comes back in.
            medFaceW: Math.round(clamp(mainLen * 0.9, 40, 96)),
            medFaceCx: 0,                        // solved below off medFaceW
            medN: 0,                             // ditto
            armS: Math.round(dealZ - 15), armN: Math.round(medZ + 18),
            hookS: -13, hookN: 13,
            pileN: Math.max(6, Math.round(mainLen / 12)),
            // mooring dolphins down the inner face of each arm — the only two
            // strips of this basin that stay open water once three docks, a
            // fuel pontoon, a demo dock and eight superyachts are in it.
            pileZS: Math.round(dealZ - 15 + 7), pileZN: Math.round(medZ + 18 - 7),
            residentCap: 12, bigLoa: bigLoa,
          };
        })();
    /* THE BASIN SAID NO. `measured()` returns null when the water it walked
       cannot hold the big layout — and then the marina goes back to being
       exactly the marina that shipped, at exactly the site that shipped, which
       is the only honest fallback: the searched site was chosen for SIZE, and
       standing a small marina on it would be picking a spot for a reason that
       no longer applies. If the authored site is not there either, nothing is
       built and CBZ.cityBerth falls back to the roadstead — the same refusal
       this file has always made. */
    if (!L) {
      L = LEGACY;
      found = false;
      BZ = cz - 96;
      for (let x = EEx + 12; x <= EEx + 140; x += 3) {
        if (waterAt(x + 6, BZ) && waterAt(x + 46, BZ) && waterAt(x + 46, BZ + 40) && waterAt(x + 46, BZ - 40)) { QX = x; found = true; break; }
      }
      if (!found) return null;
    }
    if (L.medFaceCx === 0) L.medFaceCx = L.medFaceW / 2 + 1;
    const QUAY_LEN = L.quayZ1 - L.quayZ0;

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
    const QZ0 = BZ + L.quayZ0, QZ1 = BZ + L.quayZ1;   // quay z-span (solved)
    const QW0 = QX - 20, QW1 = QX + 1;          // quay x-span (land -> water edge)
    // THE LIFT WELL — a notch of OPEN WATER cut into the quay so the travel
    // lift can straddle a hull and pick it out. It is a real hole: the slab is
    // built as three boxes around it and no platform record covers it, so you
    // can fall in. A decorative notch you cannot fall into would be a lie.
    const WELL_Z = BZ + L.wellZ, WELL_HZ = 3.4, WELL_X0 = QX - 12;
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
    const MAIN_LEN = L.mainLen;
    const MAIN_X1 = MAIN_X0 + MAIN_LEN;                   // local x

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
    // A TROT RAMPS SEAWARD. Cycling a size list (`sizeAt`) puts a 3 m dinghy
    // next to a 14 m cruiser next to a 3 m dinghy, which is not how any harbour
    // allocates water and — because berth width follows beam — leaves a long
    // dock only half used before the count cap bites. Ramping instead walks the
    // ladder from the shore end outward: small craft in the shallow inner
    // water, the big stuff at the end where the depth is, and the whole spine
    // consumed. `sizeAt` stays for the legacy layout, which must not move.
    function sizeRamp(list, i, n, fb) {
      if (!list.length) return fb;
      const k = Math.min(list.length - 1, Math.floor(i / Math.max(1, n) * list.length));
      return list[k];
    }
    // berth width = beam + 0.5-1.0m clearance EACH SIDE (§G)
    function clearanceFor(beam) { return Math.max(0.5, Math.min(1.0, beam * 0.18)); }
    function berthWidth(h) { return h.beam + clearanceFor(h.beam) * 2; }
    // finger length ~ 1/3 - 1/2 of LOA (§G); finger width 0.6-1.0m
    function fingerLen(h) { return Math.max(2.0, h.loa * 0.42); }
    const FINGER_W = 0.8;
    // A finger berth lies alongside its finger, bow toward the walkway: the
    // bow points -x, i.e. heading atan2(-1, 0) = -PI/2 (forward = sin/cos h).
    const HEAD_IN = -Math.PI / 2;

    /* ---- ONE TROT ------------------------------------------------------
       A row of fingers hanging off one side of one dock spine, and the berths
       between them. This is the loop the file used to carry TWICE, inline,
       once per side of the one dock it had; three docks would have made it six
       copies. Every number in it is the same number those two copies used.  */
    function trot(dz, side, pool, cap, fallback, idPrefix, labeller, residents) {
      let cursor = MAIN_X0 + (side < 0 ? 4 : 5), idx = 0;
      const row = [];
      function pick(i) { return L.ramp ? sizeRamp(pool, i, cap, fallback) : sizeAt(pool, i, fallback); }
      while (cursor < MAIN_X1 - (side < 0 ? 5 : 8) && idx < cap) {
        const h = pick(idx);
        const w = berthWidth(h), fl = fingerLen(h);
        // the finger on the LOW-x edge of this berth
        pontGeo.push(boxGeoAt(cursor, PONTOON_TOP - 0.16, dz + side * (MAIN_W / 2 + fl / 2), FINGER_W, 0.32, fl));
        deck(cursor, dz + side * (MAIN_W / 2 + fl / 2), FINGER_W, fl);
        cleatGeo.push(boxGeoAt(cursor, PONTOON_TOP + 0.09, dz + side * (MAIN_W / 2 + fl - 0.4), 0.24, 0.16, 0.10));
        row.push({ x: cursor + w / 2, h: h, fl: fl });
        cursor += w; idx++;
      }
      // the closing finger — a trot's last berth needs a finger on BOTH sides
      {
        const fl = fingerLen(pick(idx));
        pontGeo.push(boxGeoAt(cursor, PONTOON_TOP - 0.16, dz + side * (MAIN_W / 2 + fl / 2), FINGER_W, 0.32, fl));
        deck(cursor, dz + side * (MAIN_W / 2 + fl / 2), FINGER_W, fl);
      }
      row.forEach(function (b, i) {
        registerBerth({
          id: idPrefix + i, x: QX + b.x, z: BZ + dz + side * (MAIN_W / 2 + b.fl * 0.55),
          heading: HEAD_IN, loa: b.h.loa, beam: b.h.beam, kind: "finger",
          label: labeller(i), resident: i < residents,
        });
      });
      return row;
    }

    /* ---- ONE DOCK: a spine, its cleats, and its two trots --------------- */
    const SMALL_FB = { loa: 6.2, beam: 2.1 }, MID_FB = { loa: 9.5, beam: 3.0 };
    const DOCK_LETTER = "ABCDEF";
    L.dockZ.forEach(function (dz, di) {
      // spine
      pontGeo.push(boxGeoAt((MAIN_X0 + MAIN_X1) / 2, PONTOON_TOP - 0.18, dz, MAIN_LEN, 0.36, MAIN_W));
      deck((MAIN_X0 + MAIN_X1) / 2, dz, MAIN_LEN, MAIN_W);
      // cleats every 4m down both edges of the walkway
      for (let x = MAIN_X0 + 2; x < MAIN_X1; x += 4) {
        cleatGeo.push(boxGeoAt(x, PONTOON_TOP + 0.09, dz - MAIN_W / 2 + 0.16, 0.30, 0.18, 0.12));
        cleatGeo.push(boxGeoAt(x, PONTOON_TOP + 0.09, dz + MAIN_W / 2 - 0.16, 0.30, 0.18, 0.12));
      }
      // WHICH BOATS BERTH WHERE. The inner docks are the small-craft end of
      // the basin and the outer (north, seaward of the fairway) dock carries
      // the sport cruisers, which is both the real allocation and what keeps
      // the deep-draft hulls nearest the channel they leave by.
      const inner = di === 0, outer = di === L.dockZ.length - 1 && L.dockZ.length > 1;
      const sPool = outer ? (mid.length ? mid : small) : small;
      const nPool = inner && L.dockZ.length > 1 ? small : (mid.length ? mid : small);
      const tag = L.legacyIds ? "" : DOCK_LETTER.charAt(di) + " ";
      trot(dz, -1, sPool, L.sCap, SMALL_FB,
        L.legacyIds ? "marina-s" : "marina-" + di + "s",
        function (i) { return L.legacyIds ? ("South Trot " + String.fromCharCode(65 + i)) : ("Dock " + tag + "South " + (i + 1)); },
        // the first two berths on the innermost dock are locals' boats
        inner ? 2 : 0);
      trot(dz, 1, nPool, L.nCap, MID_FB,
        L.legacyIds ? "marina-n" : "marina-" + di + "n",
        function (i) { return L.legacyIds ? ("North Trot " + String.fromCharCode(65 + i)) : ("Dock " + tag + "North " + (i + 1)); },
        inner ? 1 : 0);
    });

    /* ---- THE HEAD WALKWAY. One dock hangs off a brow; three cannot each
       have one, and a marina does not give them one — it runs a walkway along
       the shore end that every dock meets, and lands ONE brow on that. It is
       extended to cover the brow line (local z 0) even when the dock field
       does not reach it, so the ramp off the quay can never end over water. */
    if (L.head) {
      const hz0 = Math.min(L.dockZ[0], 0) - 1.4, hz1 = Math.max(L.dockZ[L.dockZ.length - 1], 0) + 1.4;
      pontGeo.push(boxGeoAt(MAIN_X0, PONTOON_TOP - 0.18, (hz0 + hz1) / 2, MAIN_W, 0.36, hz1 - hz0));
      deck(MAIN_X0, (hz0 + hz1) / 2, MAIN_W, hz1 - hz0);
      for (let z = hz0 + 3; z < hz1 - 2; z += 6) {
        cleatGeo.push(boxGeoAt(MAIN_X0 + MAIN_W / 2 - 0.16, PONTOON_TOP + 0.09, z, 0.12, 0.18, 0.30));
      }
    }

    // FUEL DOCK — its own short pontoon near the ENTRANCE (§G), so a boat can
    // fuel without threading the whole basin.
    const FUEL_X = MAIN_X1 - 4, FUEL_Z = L.fuelZ;
    const FUEL_W = L.head ? 18 : 12;
    const FUEL_LINK = L.dockZ[L.dockZ.length - 1] + MAIN_W / 2;   // the dock it hangs off
    pontGeo.push(boxGeoAt(FUEL_X, PONTOON_TOP - 0.18, FUEL_Z, FUEL_W, 0.36, 2.6));
    deck(FUEL_X, FUEL_Z, FUEL_W, 2.6);
    // link the fuel dock to the outermost walkway with a catwalk
    pontGeo.push(boxGeoAt(FUEL_X, PONTOON_TOP - 0.16, (FUEL_LINK + FUEL_Z) / 2, 1.0, 0.32, FUEL_Z - FUEL_LINK));
    deck(FUEL_X, (FUEL_LINK + FUEL_Z) / 2, 1.0, FUEL_Z - FUEL_LINK);

    // DEALER DOCK — the brokerage's own water frontage at the landward end,
    // with demo hulls floating alongside it. boatyard.js reads these berths.
    const DEAL_X = MAIN_X0 + 2, DEAL_Z = L.dealZ;
    const DEAL_W = L.dealW;
    const DEAL_LINK = L.dockZ[0] - MAIN_W / 2;
    pontGeo.push(boxGeoAt(DEAL_X + DEAL_W / 2 - 3, PONTOON_TOP - 0.18, DEAL_Z, DEAL_W, 0.36, 2.6));
    deck(DEAL_X + DEAL_W / 2 - 3, DEAL_Z, DEAL_W, 2.6);
    pontGeo.push(boxGeoAt(DEAL_X, PONTOON_TOP - 0.16, (DEAL_Z + DEAL_LINK) / 2, 1.0, 0.32, DEAL_LINK - DEAL_Z));
    deck(DEAL_X, (DEAL_Z + DEAL_LINK) / 2, 1.0, DEAL_LINK - DEAL_Z);

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

    // ---- the two docks that are not trots (world-space registration; the
    // boats do not move with the pontoon, the water carries them —
    // water_buoyancy.js owns their ride) --------------------------------
    registerBerth({ id: "marina-fuel", x: QX + FUEL_X, z: BZ + FUEL_Z + 3.4, heading: HEAD_IN, loa: 16, beam: 5, kind: "fuel", label: "Fuel Dock", resident: true });
    for (let i = 0; i < L.dealBerths; i++) {
      registerBerth({
        // 16m of demo berth so the showroom can float a sport cruiser, not
        // just the small stuff — a brokerage that only shows dinghies is not
        // a brokerage.
        id: "marina-demo" + i, x: QX + DEAL_X + 1 + i * 7, z: BZ + DEAL_Z - 4.6,
        heading: HEAD_IN, loa: 16, beam: 5, kind: "dealer", label: "Demo Berth " + (i + 1), resident: true,
      });
    }
    // The hulls that must actually FLOAT here: the liveaboards on the inner
    // trots and the brokerage's demo boats (research §H — a dealer is a
    // showroom on the water with demo hulls at its own dock, and you should be
    // able to walk up to them). Read back from the REGISTERED berths so we use
    // the snapped, water-verified coordinates, not the authored ones.
    //
    // CAPPED, and the cap is the point: every one of these is a REAL vehicle
    // rig spawned by cityMakeCar, so "resident" is the one field in this file
    // whose cost scales with metal rather than with merged geometry. A five-fold
    // marina does not get a five-fold fleet moored in it.
    for (const b of berths) {
      if (residentSpots.length >= L.residentCap) break;
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
    const MEDZ = BZ + L.medZ;                   // the quay face the sterns touch
    {
      const FACE_W = L.medFaceW, FACE_CX = QX + L.medFaceCx;
      const face = new THREE.Mesh(new THREE.BoxGeometry(FACE_W, QUAY_TOP + 1.8, 5), m(CONCRETE_DK));
      face.position.set(FACE_CX, QUAY_TOP - (QUAY_TOP + 1.8) / 2, MEDZ + 2.5);
      face.receiveShadow = true; root.add(face);
      plat(FACE_CX - FACE_W / 2, FACE_CX + FACE_W / 2, MEDZ, MEDZ + 5, QUAY_TOP);

      const bigH = big.length ? big[0] : { loa: 34, beam: 7.6 };
      const step = bigH.beam + 3.0;             // beam + working clearance
      // HOW MANY HULLS THE FACE HOLDS, not how many were typed. The first berth
      // stands 9 m in from the west end (the corner the passerelles and the
      // crew walk past) and the last must still be a full step clear of the
      // east end, so the count is the face length divided by the step.
      const medN = L.medN > 0 ? L.medN
        : Math.max(1, Math.min(8, Math.floor((FACE_W - 12) / step)));
      const boll = [], lines = [];
      for (let i = 0; i < medN; i++) {
        const bx = FACE_CX - FACE_W / 2 + 9 + i * step;
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
    //
    //     PLACED ALONG THE QUAY, NOT AT ITS OLD MIDDLE. Every free-standing
    //     building here used to be BZ + a literal, which was fine while the
    //     quay was 104 m centred on BZ and turns into a huddle at one end the
    //     moment the quay is solved. They now sit at the FRACTIONS of the quay
    //     span they occupied before, so the shore-side row stretches with the
    //     harbour and the legacy layout is unmoved. (The brokerage is not in
    //     here: it belongs to the demo dock and rides with it.)
    // =====================================================================
    function quayAt(t) { return QZ0 + (QZ1 - QZ0) * t; }
    // -- harbourmaster office: two storeys, a window band, a signal mast --
    const HARBOUR_MASTER = { x: QX - 11, z: quayAt(0.6346) };
    {
      const hx = HARBOUR_MASTER.x, hz = HARBOUR_MASTER.z;
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
      const sx = QX - 12, sz = quayAt(0.4615);
      const shed = new THREE.Mesh(new THREE.BoxGeometry(10, 4.2, 7), m(0xb7c0c6));
      shed.position.set(sx, QUAY_TOP + 2.1, sz); shed.castShadow = true; shed.receiveShadow = true; root.add(shed);
      solid(sx, sz, 10, 7, shed, 0, QUAY_TOP + 4.2);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.0, 3.4), m(0x50575c));
      door.position.set(sx + 5.05, QUAY_TOP + 1.5, sz); root.add(door);
      const eave = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.2, 7.6), m(0x7d848a));
      eave.position.set(sx, QUAY_TOP + 4.3, sz); root.add(eave);
    }
    // -- yacht club terrace: a raised, usable deck left deliberately open --
    {
      const tx = QX - 8, tz = quayAt(0.7692), TW = 12, TD = 9, TT = QUAY_TOP + 0.4;
      const planks = [];
      for (let x = tx - TW / 2 + 0.6; x < tx + TW / 2; x += 1.1) planks.push(boxGeoAt(x, TT - 0.06, tz, 1.0, 0.12, TD));
      mergeAdd(planks, m(WOOD_A));
      plat(tx - TW / 2, tx + TW / 2, tz - TD / 2, tz + TD / 2, TT);
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
    //  5) BREAKWATER ARMS + THE CHANNEL — walkable concrete caps hooking in
    //     to leave a 26m entrance. IALA REGION B:
    //     entering from seaward (heading WEST) starboard is the -z side, so
    //     RED goes on the SOUTH head and GREEN on the NORTH head, and the
    //     channel cans repeat the pair. "Red, right, returning."
    // =====================================================================
    const CAP_TOP = 1.6;
    // The arms start clear of the quay's z-ends and reach past the outer end of
    // the docks by one elbow before hooking in — solved off the dock spine, so
    // a longer basin never leaves its own pontoons outside its breakwater.
    const ARM_X0 = QX + 8, ARM_X1 = QX + MAIN_X0 + MAIN_LEN + 9;
    function breakwater(z, hookZ) {
      const x0 = ARM_X0, x1 = ARM_X1;
      const hz0 = Math.min(z, hookZ), hz1 = Math.max(z, hookZ);
      // One grounded concrete mole, not a thin cap floating where the deleted
      // cube-riprap used to hide the gap. Its collision is the exact visible
      // body and height, so the arm is solid without becoming an unseen wall.
      const bodyBottom = -1.4, bodyH = CAP_TOP - bodyBottom;
      const body = [];
      body.push(boxGeoAt((x0 + x1) / 2, bodyBottom + bodyH / 2, z, x1 - x0, bodyH, 2.2));
      body.push(boxGeoAt(x1, bodyBottom + bodyH / 2, (hz0 + hz1) / 2, 2.2, bodyH, hz1 - hz0));
      const bodyMesh = mergeAdd(body, m(CONCRETE_DK));
      solid((x0 + x1) / 2, z, x1 - x0, 2.2, bodyMesh, bodyBottom, CAP_TOP);
      solid(x1, (hz0 + hz1) / 2, 2.2, hz1 - hz0, bodyMesh, bodyBottom, CAP_TOP);
      plat(x0, x1, z - 1.1, z + 1.1, CAP_TOP);
      plat(x1 - 1.1, x1 + 1.1, hz0, hz1, CAP_TOP);
      // A CAP 1.6m above the water is not climbable from a swim (STEP_UP is
      // 0.45m), so the root of each arm gets five concrete steps down to the
      // waterline — you can get out of the sea onto the mole, which is what
      // makes the arms somewhere to go rather than scenery.
      const steps = [], stepSpots = [];
      const NSTEP = 5, RISE = 0.40;                       // each riser < STEP_UP (0.45)
      for (let s = 0; s < NSTEP; s++) {
        const top = SEA_Y + 0.38 + s * RISE;              // -0.10 .. 1.50, then the cap at 1.60
        const sx = x0 - 0.7 - (NSTEP - 1 - s) * 1.2;
        steps.push(boxGeoAt(sx, bodyBottom + (top - bodyBottom) / 2, z, 1.2, top - bodyBottom, 2.0));
        stepSpots.push({ x: sx, top: top });
        plat(sx - 0.6, sx + 0.6, z - 1.0, z + 1.0, top);
      }
      const stepMesh = mergeAdd(steps, m(CONCRETE_DK));
      for (const s of stepSpots) solid(s.x, z, 1.2, 2.0, stepMesh, bodyBottom, s.top);
      return { x1: x1, hookZ: hookZ };
    }
    const southArm = L.arms ? breakwater(BZ + L.armS, BZ + L.hookS) : null;
    const northArm = L.arms ? breakwater(BZ + L.armN, BZ + L.hookN) : null;

    // head lights + channel buoys (IALA Region B)
    function navHead(x, z, color, top) {
      const y = top == null ? CAP_TOP : top;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 3.4, 8), m(0xe8ebee));
      col.position.set(x, y + 1.7, z); col.castShadow = true; root.add(col);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6),
        new THREE.MeshLambertMaterial({ color: color, emissive: color, emissiveIntensity: 0.9 }));
      lamp.position.set(x, y + 3.7, z); root.add(lamp);
      solid(x, z, 1.4, 1.4, col, 0, y + 3.4);
    }
    // RED to STARBOARD entering from seaward => the SOUTH head is red.
    // With no arms there are no arm HEADS either, and a harbour with no lights
    // at all is worse than one with them in the second-best place: the pair
    // moves onto the two ends of the quay, which is what marks the limits of a
    // marina lying alongside a channel rather than behind a mole.
    if (L.arms) {
      navHead(southArm.x1, southArm.hookZ, 0xd42f2f);
      navHead(northArm.x1, northArm.hookZ, 0x2fbd57);
    } else {
      navHead(QW1 - 1.2, QZ0 + 2.0, 0xd42f2f, QUAY_TOP);
      navHead(QW1 - 1.2, QZ1 - 2.0, 0x2fbd57, QUAY_TOP);
    }
    {
      const cans = [];
      if (L.arms) {
        // the approach channel runs seaward from the harbour mouth, so the cans
        // start outside the arm elbow rather than at a typed x.
        for (let i = 0; i < 3; i++) {
          const bx = ARM_X1 + 12 + i * 26;
          // red CAN to starboard (south side of the channel), green to port
          cans.push({ x: bx, z: BZ + L.hookS + 1 - i * 2, c: 0xd42f2f, can: true });
          cans.push({ x: bx, z: BZ + L.hookN - 1 + i * 2, c: 0x2fbd57, can: false });
        }
      } else {
        // NO MOLE, SO THE MARKS ARE THE FAIRWAY'S. A line of cans down the
        // outboard edge of the dock heads is what keeps a boat running the
        // channel off the ends of five finger docks — the job the arms would
        // otherwise have done by being solid. Each still validates its own
        // water, so a can that would land on the far bank simply is not laid.
        const fx = QX + MAIN_X0 + MAIN_LEN + 7;
        const z0 = BZ + L.dockZ[0] - 18, z1 = BZ + L.dockZ[L.dockZ.length - 1] + 18;
        const n = Math.max(2, Math.round((z1 - z0) / 34));
        for (let i = 0; i <= n; i++) {
          const bz = z0 + (z1 - z0) * (i / n);
          cans.push({ x: fx, z: bz, c: (i % 2) ? 0x2fbd57 : 0xd42f2f, can: !(i % 2) });
        }
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
      for (let i = 0; i < L.pileN; i++) {
        const px = QX + 12 + i * 8;
        const pz = BZ + (i % 2 ? L.pileZN : L.pileZS);
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
      layout: L, arms: { x0: ARM_X0, x1: ARM_X1, s: BZ + L.armS, n: BZ + L.armN },
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
      // On the quay, tied to the buildings they belong to — a harbourmaster
      // standing where his office USED to be is the same bug as a lot pad
      // drawn where the block used to be.
      const HM = HARBOUR_MASTER, CLUB = quayAt(0.7692);
      person("groundCrew", QX - 4, quayAt(0.577), { kind: "worker", archetype: "laborer", job: "dockhand", outfit: 0xf0a020, wealth: 0.3, aggr: 0.12 }, "dockhand");
      person("groundCrew", QX - 3, quayAt(0.404), { kind: "worker", archetype: "laborer", job: "dockhand", outfit: 0xf0a020, wealth: 0.3, aggr: 0.12 }, "dockhand");
      person("groundCrew", QX - 13, WELL_Z + 2, { kind: "worker", archetype: "laborer", job: "yard hand", outfit: 0x3a78c9, wealth: 0.28, aggr: 0.14 }, "yard");
      person("cityResident", HM.x + 1, HM.z - 2, { kind: "civilian", archetype: "resident", job: "harbourmaster", wealth: 0.55, aggr: 0.08 }, "harbourmaster");
      person("cityResident", QX - 8, CLUB, { kind: "civilian", archetype: "resident", job: "club member", wealth: 0.9, aggr: 0.05 }, "club");
      person("cityResident", QX - 7, CLUB + 2, { kind: "civilian", archetype: "resident", job: "club member", wealth: 0.88, aggr: 0.05 }, "club");
      // liveaboards live ON the docks, so they follow the dock field
      person("cityResident", QX + 6, BZ + L.dockZ[0] - 3, { kind: "civilian", archetype: "resident", job: "liveaboard", wealth: 0.42, aggr: 0.1 }, "liveaboard");
      person("cityResident", QX + 22, BZ + L.dockZ[L.dockZ.length - 1] + 2, { kind: "civilian", archetype: "resident", job: "liveaboard", wealth: 0.44, aggr: 0.1 }, "liveaboard");
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
          // cap scales with the waterfront: a three-dock basin worked by the
          // same five hands as a one-dock basin is the "geometry with nobody
          // in it" this file was written to stop.
          name: "Marina", x: QX - 4, z: quayAt(0.5), cap: 5 + (L.dockZ.length - 1) * 3,
          home: { x: HARBOUR_MASTER.x + 1, z: HARBOUR_MASTER.z - 2 },   // the harbourmaster's office
          spots: [{ x: QX - 4, z: quayAt(0.577) }, { x: QX - 3, z: quayAt(0.404) },
                  { x: QX - 13, z: WELL_Z + 2 }, { x: QX + 10, z: BZ + L.dockZ[0] }]
            .concat(L.dockZ.slice(1).map(function (dz) { return { x: QX + 10, z: BZ + dz }; })),
        });
      } catch (e) {}
    }

    /* =====================================================================
       9) THE REST OF THE PEOPLE WHO WORK HERE.

       OWNER: "every place should have the people who work there." This marina
       drew a travel-lift gantry, an open hardstand yard, a Med-moor superyacht quay
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
    // ONE BERTHING MASTER PER DOCK, standing at the head of his own dock where
    // the brow lands. Three docks worked by the original single dock's staff
    // would be the same "geometry with nobody in it" this section exists to
    // stop — and these are lazy: citystaff.js mints them only inside 170 m.
    if (L.dockZ.length > 1) {
      L.dockZ.forEach(function (dz, di) {
        crewSpots.push({ x: QX + MAIN_X0 + 7, z: BZ + dz + (di % 2 ? 1.6 : -1.6),
          face: di % 2 ? Math.PI : 0, job: "dockhand", id: "dock" + di,
          wealth: 0.3, outfit: 0xf0a020, pose: "foldarms" });
      });
    }
    if (CBZ.cityStaffVenue && CBZ.cityStaffPost) {
      // 9 authored bodies + the crew posts + the quay fisherman = the staff.
      CBZ.cityStaffVenue("marina", {
        stations: 10 + crewSpots.length, note: "quay, yard, lift well, fuel dock, superyacht quay, dock heads",
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
      const qsZ = quayAt(0.7308);
      const quaySpot = CBZ.fishSpotRegister(QX - 2.5, qsZ, {
        name: "Marina Quay", face: Math.PI / 2, y: QUAY_TOP, water: { x: QX + 16, z: qsZ },
      });
      CBZ.fishSpotRegister(QX + FUEL_X + 5.0, BZ + FUEL_Z, {
        name: "Fuel Dock", face: Math.PI / 2, water: { x: QX + FUEL_X + 16, z: BZ + FUEL_Z },
      });
      // THE MOLE. The south breakwater arm is a walkable cap with concrete
      // steps out of the sea at its root and nothing at all to do on it —
      // which is what every real harbour wall in the world has anglers
      // standing on. The station validates its own water like the other two.
      if (L.arms && L.dockZ.length > 1) {
        const armFishX = (ARM_X0 + ARM_X1) / 2;
        CBZ.fishSpotRegister(armFishX, BZ + L.armS + 1.0, {
          name: "South Mole", face: Math.PI / 2, y: CAP_TOP,
          water: { x: armFishX, z: BZ + L.armS + 8 },
        });
      }
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
    // ORDER 97.5, NOT 66. See the site-selection note: city/continent.js
    // publishes the real signed shoreline (`city.mapTerrain`) inside its own
    // builder at 97, and before that every water question this file asks is
    // answered by waterfield.js's boot-time fallback rule. A harbour builder
    // that runs first cannot know where the sea is. 97.5 is after the
    // coastline and before the late passes (98 / 98.6 / 99).
  }, 97.5);

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
  /* ---- CBZ.cityMarinaSize() — THE MEASURED HARBOUR, read back LIVE.
     Not a counter a build loop kept: every number here is recovered from the
     registry and the rig that actually exist after the build, so a marina that
     silently stops laying docks cannot keep reporting the size it meant to be.
     `dropped` is cityBerthSnapDropped's reading at this instant — a non-zero
     value is the basin telling you it is smaller than the layout asked for. */
  CBZ.cityMarinaSize = function () {
    const out = { built: !!site, docks: 0, spine: 0, decks: 0,
                  finger: 0, med: 0, dealer: 0, fuel: 0, anchorage: 0,
                  moored: 0, dropped: CBZ.cityBerthSnapDropped() };
    if (site && site.layout) {
      out.docks = site.layout.dockZ.length;
      out.spine = Math.round(site.layout.mainLen);
      out.decks = site.decks ? site.decks.length : 0;
    }
    for (const b of berths) {
      if (out[b.kind] != null) out[b.kind]++;
      if (b.occupant) out.moored++;
    }
    return out;
  };
  CBZ.cityMarinaReset = function () { site = null; pontoonGrp = null; pontoonRig = null; clearBerths(); residentSpots.length = 0; };
})();
