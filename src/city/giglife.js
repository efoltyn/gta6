/* ============================================================
   city/giglife.js — THE VISIBLE GIG ECONOMY (couriers & cabs that DRIVE).

   WHY-first: the city already has couriers, delivery drivers and cab
   drivers in its job table (aigoals.js CITY_JOBS) — but they just walked
   to a storefront door and "clocked in" at a black box. A courier whose
   whole job is to MOVE THINGS that never moves is a lie the player can
   see through. This module gives them a felt, in-world WHY they're on the
   road: a courier carries a VISIBLE package from a shop to someone's
   door; a cab carries a VISIBLE FARE from a stand to a destination. Money
   changes hands at the dropoff. That is the economy you can WATCH happen —
   and (via gigfleet.js) it is how a player-owned gig company's employees
   appear on the street earning the boss money.

   This file owns three things, all feature-detected and headless/MP-safe:

     1) GIG ANCHOR PAIRS — at city build it registers work-anchors
        (worldmap.js CBZ.registerWorkAnchor) so the SAME anchor system the
        biome workers use also describes "where a gig starts / ends":
          • kind 'gig-pickup' at FOOD/SHOP lots (role 'courier' at a store
            counter, role 'cabstand' at transit/gas) — where a run BEGINS.
          • kind 'gig-drop'   at RESIDENTIAL/OFFICE lots — where it ENDS.
        These are pure data points; aigoals.js' goGigRun routes a driver
        pickup→dropoff across them.

     2) THE GIG-CAR DRIVER LOOP — a gig car is an ordinary cityMakeCar with
        car.npcDriver set (exactly like the carjack path) but road:null, so
        the ambient traffic AI (vehicles.js, which skips `!c.road`) leaves
        it alone and WE steer it toward car._gigTarget each frame (mirrors
        vehicles.js advanceRoadRage: lerp heading, throttle, clamp to the
        arena). It carries a visible prop: a package box (courier) or a
        seated passenger silhouette (cab). Concurrency is hard-capped so the
        streets never fill with gig cars (perf + it stays an EVENT you read).

     3) HELPERS FOR gigfleet.js — cityGigClaimPickup / cityGigNearestDrop /
        cityGigSpawnCar / cityGigReturnCar + cap query, so a company can
        spawn its own liveried drivers onto the same machinery.

   Runs its driver loop at onUpdate order 36.5 — AFTER aigoals @33 (which
   sets the goal + spawns the car) and BEFORE the ambient traffic AI @37
   (which we deliberately don't want touching our road:null cars). City
   mode only; defers entirely when not in city / no arena.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const now = () => CBZ.now || 0;

  // independent deterministic PRNG (never touch peds.js / aigoals.js streams)
  let _s = 90217;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  function inCity() { return g && g.mode === "city"; }
  function noSim() { return CBZ.net && CBZ.net.noSim && CBZ.net.noSim(); }  // MP guest: host owns sim
  function arena() { return CBZ.city && CBZ.city.arena; }

  // ============================================================
  //  CONCURRENCY CAP — gig cars are expensive (a real car + a driven loop)
  //  and the WHY is "a run you can WATCH", not "gridlock". Keep it to a
  //  handful citywide; respects the spirit of vehicles.js' npcDrivers>=3
  //  carjack cap (we can't read that private counter, so we cap our own
  //  pool — the two are independent kinds of NPC driver). The cap RIDES the
  //  LIVE quality tier (lo 2 → hi 6) and is read at every check, so the
  //  pause-menu slider takes effect immediately.
  // ============================================================
  const GIG_CAR_MAX = () => Math.round(CBZ.qScale ? CBZ.qScale(2, 6) : 3);
  let _gigCars = [];                  // live gig cars we own + steer (bounded by GIG_CAR_MAX)

  function activeGigCars() {
    // prune dead/ejected first so the count is honest
    for (let i = _gigCars.length - 1; i >= 0; i--) {
      const c = _gigCars[i];
      if (!c || c.dead || !c.group || !c.group.parent || c.npcDriver == null) _gigCars.splice(i, 1);
    }
    return _gigCars.length;
  }
  CBZ.cityGigCount = activeGigCars;   // gigfleet.js reads this for HUD / dispatch budget
  CBZ.cityGigCap = function () { return GIG_CAR_MAX(); };

  // ============================================================
  //  GIG ANCHORS — registered at city build into CBZ.cityWorkAnchors.
  //  These are a SEPARATE kind from the biome anchors (officejobs.js'
  //  cityClaimWorkAnchor keys off CITY_JOBS[job].anchor, which the gig jobs
  //  don't set), so we own claim/release ourselves below — no collision.
  // ------------------------------------------------------------
  //  PICKUP lots: where a gig BEGINS. food/shop counters for couriers, a
  //  transit/gas curb for cabs (a cab stand). DROP lots: where it ENDS —
  //  someone's home or an office tower. We tag each anchor record with
  //  .gig 'pickup'|'drop' + .role so the helpers + goGigRun can filter fast.
  // ============================================================
  const PICKUP_KINDS = ["food", "electronics", "hardware", "clothing", "pawn", "gas", "transit"];
  const CABSTAND_KINDS = ["transit", "gas", "casino", "bar"];
  const DROP_SHOP_KINDS = ["office", "bank", "cityhall", "realtor"];  // office-side dropoffs (shopLots)

  let _pickups = [], _drops = [];     // cached refs into cityWorkAnchors (for the helpers)

  function regAnchor(rec) {
    if (!CBZ.registerWorkAnchor) return null;
    const a = CBZ.registerWorkAnchor(rec);
    return a;
  }

  // register the gig anchor pairs from the live arena's lots. Called from the
  // landmass builder (after lots exist) AND idempotently re-checked each driver
  // tick if the arena swapped under us without a rebuild (defensive).
  function buildGigAnchors(A) {
    _pickups = []; _drops = [];
    if (!A) return;
    const shop = A.shopLots || [], homes = A.homeLots || [];
    // ---- PICKUPS (couriers at stores, cabs at stands) ----
    for (let i = 0; i < shop.length; i++) {
      const l = shop[i];
      if (!l || !l.building || !l.building.door) continue;
      const d = l.building.door, isCab = CABSTAND_KINDS.indexOf(l.kind) >= 0, isPick = PICKUP_KINDS.indexOf(l.kind) >= 0;
      if (!isCab && !isPick) continue;
      const a = regAnchor({
        biome: "city", kind: "gig-pickup", x: d.x, z: d.z,
        role: isCab ? "cabstand" : "courier",
        gig: "pickup", lotKind: l.kind, cap: 4, lot: l,
        // a curb spot just off the door so the car has somewhere to pull up
        spots: [{ x: d.x, z: d.z }],
      });
      if (a) _pickups.push(a);
    }
    // ---- DROPOFFS (homes + office towers) ----
    for (let i = 0; i < homes.length; i++) {
      const l = homes[i];
      const dx = (l.building && l.building.door) ? l.building.door.x : l.cx;
      const dz = (l.building && l.building.door) ? l.building.door.z : l.cz;
      if (dx == null) continue;
      const a = regAnchor({ biome: "city", kind: "gig-drop", x: dx, z: dz, role: "resident", gig: "drop", cap: 99, lot: l });
      if (a) _drops.push(a);
    }
    for (let i = 0; i < shop.length; i++) {
      const l = shop[i];
      if (!l || DROP_SHOP_KINDS.indexOf(l.kind) < 0) continue;
      const dx = (l.building && l.building.door) ? l.building.door.x : l.cx;
      const dz = (l.building && l.building.door) ? l.building.door.z : l.cz;
      if (dx == null) continue;
      const a = regAnchor({ biome: "city", kind: "gig-drop", x: dx, z: dz, role: "office", gig: "drop", cap: 99, lot: l });
      if (a) _drops.push(a);
    }
  }

  // the live gig-anchor lists, rebuilt lazily if the arena swapped (cityWorkAnchors
  // is wiped + rebuilt per run by cityWorldGeo, so a stale ref can't survive a run,
  // but a re-cache keeps _pickups/_drops pointing at THIS run's records).
  let _seenWA = null;
  function ensureAnchors() {
    const list = CBZ.cityWorkAnchors;
    if (!list) return false;
    if (list !== _seenWA || (!_pickups.length && !_drops.length)) {
      // re-derive our cached views from whatever pickups/drops live in the list now
      _pickups = list.filter((a) => a && a.gig === "pickup");
      _drops = list.filter((a) => a && a.gig === "drop");
      _seenWA = list;
    }
    return _pickups.length > 0 && _drops.length > 0;
  }

  // ---- public helpers (goGigRun + gigfleet.js consume these) ----------------

  // nearest gig-pickup of the right role for this ped's job, with a free slot.
  // 'cab driver' wants a cabstand; couriers/delivery want a store counter.
  CBZ.cityGigClaimPickup = function (ped) {
    if (!ped || !ensureAnchors()) return null;
    if (ped._gigPickup && _pickups.indexOf(ped._gigPickup) >= 0 &&
        ped._gigPickup.occupants.indexOf(ped) >= 0) return ped._gigPickup;
    const wantCab = ped.job === "cab driver";
    const px = ped.pos ? ped.pos.x : 0, pz = ped.pos ? ped.pos.z : 0;
    let best = null, bd = Infinity;
    for (let i = 0; i < _pickups.length; i++) {
      const a = _pickups[i];
      if (a.lot && a.lot.demolished) continue;      // no counter/curb left to stage at
      const roleOk = wantCab ? (a.role === "cabstand") : (a.role === "courier");
      if (!roleOk) continue;
      if (a.occupants.length >= (a.cap | 0) && a.occupants.indexOf(ped) < 0) continue;
      const dd = (a.x - px) * (a.x - px) + (a.z - pz) * (a.z - pz);
      if (dd < bd) { bd = dd; best = a; }
    }
    // cab fallback: if no dedicated stand, a cab can pick up at any pickup point
    if (!best && wantCab) for (let i = 0; i < _pickups.length; i++) {
      const a = _pickups[i];
      if (a.lot && a.lot.demolished) continue;
      if (a.occupants.length >= (a.cap | 0)) continue;
      const dd = (a.x - px) * (a.x - px) + (a.z - pz) * (a.z - pz);
      if (dd < bd) { bd = dd; best = a; }
    }
    if (!best) return null;
    if (best.occupants.indexOf(ped) < 0) best.occupants.push(ped);
    ped._gigPickup = best;
    return best;
  };
  CBZ.cityGigReleasePickup = function (ped) {
    if (!ped) return;
    const a = ped._gigPickup;
    if (a && a.occupants) { const i = a.occupants.indexOf(ped); if (i >= 0) a.occupants.splice(i, 1); }
    ped._gigPickup = null;
  };

  // a dropoff a sensible distance from the pickup (a real run goes SOMEWHERE),
  // weighted toward farther drops so the player actually sees the car travel.
  CBZ.cityGigNearestDrop = function (fromX, fromZ, minDist) {
    if (!ensureAnchors()) return null;
    minDist = minDist || 30;
    let best = null, bestScore = -1;
    for (let i = 0; i < _drops.length; i++) {
      const a = _drops[i];
      if (a.lot && a.lot.demolished) continue;      // no door to drop the package at
      const d = Math.hypot(a.x - fromX, a.z - fromZ);
      if (d < minDist) continue;
      // prefer mid-range drops (visible trip, not a cross-map slog), small jitter
      const score = (1 / (1 + Math.abs(d - 120) / 120)) * (0.7 + rng() * 0.6);
      if (score > bestScore) { bestScore = score; best = a; }
    }
    // if everything's too close, just take the farthest we have
    if (!best) for (let i = 0; i < _drops.length; i++) {
      const a = _drops[i]; if (a.lot && a.lot.demolished) continue;
      const d = Math.hypot(a.x - fromX, a.z - fromZ);
      if (d > bestScore) { bestScore = d; best = a; }
    }
    return best;
  };

  // ============================================================
  //  VISIBLE PROPS — the WHY you can SEE. A courier's package rides in the
  //  car (and is shown only when on-screen via the car's own visibility);
  //  a cab's fare is a seated silhouette beside the driver. Both are tiny
  //  meshes parented to the car group (so they move + cull with it for free)
  //  and disposed when the run ends. Shared geometry/material = draw-call cheap.
  // ============================================================
  let _pkgGeo = null, _pkgMat = null, _faGeo = null, _faMat = null, _faHeadGeo = null;
  function pkgGeo() { return _pkgGeo || (_pkgGeo = new THREE.BoxGeometry(0.5, 0.45, 0.4)); }
  function pkgMat() { return _pkgMat || (_pkgMat = new THREE.MeshLambertMaterial({ color: 0xb98a4b })); }
  function faGeo() { return _faGeo || (_faGeo = new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.22, 0.5, 3, 6) : new THREE.CylinderGeometry(0.24, 0.24, 0.9, 6)); }
  function faMat() { return _faMat || (_faMat = new THREE.MeshLambertMaterial({ color: 0x33384a })); }
  function faHeadGeo() { return _faHeadGeo || (_faHeadGeo = new THREE.SphereGeometry(0.17, 8, 6)); }

  function addPackageProp(car) {
    if (car._gigProp || !car.group) return;
    const m = new THREE.Mesh(pkgGeo(), pkgMat());
    m.position.set(0, 0.95, -0.15);          // on the back seat / parcel shelf
    m.rotation.y = 0.3;
    car.group.add(m);
    car._gigProp = m;
  }
  function addFareProp(car) {
    if (car._gigProp || !car.group) return;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(faGeo(), faMat());
    body.position.y = 0.55;
    grp.add(body);
    const head = new THREE.Mesh(faHeadGeo(), faMat());
    head.position.y = 1.05;
    grp.add(head);
    // SEAT-SNAP: passenger sits in the right-rear seat, slightly reclined
    grp.position.set(0.42, 0.55, -0.35);
    grp.rotation.x = 0.18;
    car.group.add(grp);
    car._gigProp = grp;
  }
  function clearProp(car) {
    if (car && car._gigProp) {
      if (car._gigProp.parent) car._gigProp.parent.remove(car._gigProp);
      car._gigProp = null;
    }
  }

  // ============================================================
  //  SPAWN / RETURN a gig car. cityMakeCar gives a real, detailed car; we
  //  set road:null + npcDriver=ped (the carjack pattern) so vehicles.js'
  //  ambient AI leaves it for US to steer. The driver ped rides hidden.
  // ============================================================
  CBZ.cityGigSpawnCar = function (ped, dropAnchor, opts) {
    if (!ped || ped.dead || !inCity() || noSim()) return null;
    if (activeGigCars() >= GIG_CAR_MAX()) return null;
    const A = arena(); if (!A || !CBZ.cityMakeCar) return null;
    opts = opts || {};
    const econ = CBZ.cityEcon;
    let model = econ && econ.pickCar ? econ.pickCar(false) : null;
    if (opts.color != null) model = Object.assign({}, model || {}, { color: opts.color });   // company livery
    // spawn at the pickup, heading toward the first leg
    const sx = ped.pos.x, sz = ped.pos.z;
    const tx = dropAnchor ? dropAnchor.x : sx, tz = dropAnchor ? dropAnchor.z : sz;
    const heading = Math.atan2(tx - sx, tz - sz) || 0;
    const car = CBZ.cityMakeCar(sx + (rng() - 0.5) * 1.5, sz + (rng() - 0.5) * 1.5, heading, false, model, 0.25);
    if (!car) return null;
    car.road = null;                 // <- ambient AI (vehicles.js @37) skips !c.road; WE drive it
    car.ai = true; car.stolen = false; car.owned = false;
    car.npcDriver = ped; car.baseV = 10 + rng() * 3;
    car._gig = true;
    car._gigKind = (ped.job === "cab driver") ? "cab" : "courier";
    car._gigCompany = opts.company || null;     // gigfleet.js tags employer rides
    // ride the ped: hidden, controlled (so aigoals/peds won't fight us for it)
    ped.inCar = car; ped.controlled = true;
    if (ped.group) ped.group.visible = false;
    // the visible cargo / fare
    if (car._gigKind === "cab") addFareProp(car); else addPackageProp(car);
    _gigCars.push(car);
    return car;
  };

  // end a gig car: drop the prop, eject the driver beside the car, then DESPAWN
  // the transient gig vehicle (it had road:null so the ambient AI never adopted
  // it — leaving it would slowly litter the streets with stopped cars). We pull
  // it from cityCars + the scene exactly like the chop-shop sale does, but ONLY
  // when the player isn't sitting in it (defensive — they could've stolen it).
  CBZ.cityGigReturnCar = function (car, paid) {
    if (!car) return;
    clearProp(car);
    const ped = car.npcDriver;
    car.npcDriver = null; car._gig = false; car._gigTarget = null;
    const i = _gigCars.indexOf(car); if (i >= 0) _gigCars.splice(i, 1);
    if (ped) {
      ped.inCar = null; ped.controlled = false;
      if (ped.group) ped.group.visible = true;
      ped.pos.set(car.pos.x + 1.7, 0, car.pos.z);
      if (ped.target) ped.target.copy(ped.pos);
    }
    // despawn unless the player has taken the wheel (then let it live as a normal
    // car they're driving — never yank a car out from under the player)
    if (car.player) { car.ai = false; return; }
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    if (car.group) car.group.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
      if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
    });
    const cars = CBZ.cityCars; if (cars) { const k = cars.indexOf(car); if (k >= 0) cars.splice(k, 1); }
    car.dead = true;
  };

  // ============================================================
  //  THE DRIVER LOOP — steer every live gig car toward car._gigTarget.
  //  Mirrors vehicles.js advanceRoadRage (the proven npcDriver steering),
  //  but for a benign cruise: lerp heading toward the goal, throttle up to
  //  baseV, clamp to the arena, keep the driver body riding with the car.
  //  goGigRun (aigoals.js) sets/advances car._gigTarget + handles arrival
  //  resolution (pay + cycle); here we only MOVE the car.
  // ============================================================
  CBZ.onUpdate(36.5, function (dt) {
    if (!inCity() || noSim()) return;
    const A = arena(); if (!A) return;
    if (!_gigCars.length) return;
    const cam = CBZ.camera;
    for (let i = _gigCars.length - 1; i >= 0; i--) {
      const car = _gigCars[i];
      // self-heal: a gig car that died / lost its driver / got picked up by the
      // player leaves the pool (drop the prop so it doesn't ghost).
      if (!car || car.dead || car.player || !car.group || !car.group.parent) {
        if (car) clearProp(car);
        _gigCars.splice(i, 1);
        continue;
      }
      const ped = car.npcDriver;
      if (!ped || ped.dead || ped.inCar !== car) { CBZ.cityGigReturnCar(car, false); continue; }
      const tgt = car._gigTarget;
      if (!tgt) { continue; }     // aigoals hasn't set/cleared a leg this frame; idle a beat
      const dx = tgt.x - car.pos.x, dz = tgt.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      // arrival is owned by goGigRun's resolver; here just ease off near the goal
      const desired = Math.atan2(dx, dz);
      car.heading = CBZ.lerpAngle ? CBZ.lerpAngle(car.heading, desired, 1 - Math.pow(0.0009, dt)) : desired;
      const top = Math.max(7, car.baseV || 10);
      const want = dist < 6 ? Math.min(top, dist * 1.2) : top;   // slow into the curb
      car.v += Math.max(-22 * dt, Math.min(16 * dt, want - car.v));
      if (car.v < 0) car.v = 0;
      car.pos.x += Math.sin(car.heading) * car.v * dt;
      car.pos.z += Math.cos(car.heading) * car.v * dt;
      if (A.clampToCity) A.clampToCity(car.pos, 1.4);
      car.group.position.set(car.pos.x, 0, car.pos.z);
      car.group.rotation.y = car.heading;
      if (ped.pos) ped.pos.set(car.pos.x, 0, car.pos.z);    // body rides with the car
      // distance cull (match vehicles.js' 150m group-visibility budget)
      if (cam) {
        const cdx = car.pos.x - cam.position.x, cdz = car.pos.z - cam.position.z;
        car.group.visible = (cdx * cdx + cdz * cdz) < 150 * 150;
      }
    }
  });

  // ============================================================
  //  BUILD HOOK — register the anchors once the arena's lots exist. We hook
  //  the landmass builder list (runs from CBZ.cityWorldGeo, AFTER buildings
  //  built shop/home lots) at a late order so lots are present; a defensive
  //  re-derive (ensureAnchors) covers any path that builds lots differently.
  // ============================================================
  if (CBZ.addLandmass) {
    CBZ.addLandmass(function (city) {
      buildGigAnchors(city || arena());
    }, 95);   // late: after every island/biome + the base lots are in
  }

  // gigfleet.js convenience: force-(re)build anchors for the live arena (e.g.
  // after a company is founded mid-run). Idempotent + cheap.
  CBZ.cityGigBuildAnchors = function () { buildGigAnchors(arena()); };

  // expose the cached lists (read-only views) for gigfleet.js dispatch logic
  CBZ.cityGigPickups = function () { ensureAnchors(); return _pickups; };
  CBZ.cityGigDrops = function () { ensureAnchors(); return _drops; };
})();
