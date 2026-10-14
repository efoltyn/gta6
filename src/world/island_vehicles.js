/* ============================================================
   world/island_vehicles.js — THE DISASTER ISLAND'S REAL MACHINES.

   The island used to have cars you could only look at: one merged mesh each
   on a box collider (world/disaster_arena.js makeCar), thrown about by the
   disasters and never driven. Gang City has the whole vehicle stack — the
   lofted cars (city/playercars.js), the chassis (city/cardyn.js driven by
   city/vehicles.js), the cabin seat, the chase camera, the seat exit, the
   helicopters (city/playeraircraft.js + city/airframes.js), the door arc and
   the bailout. This file is NOT a second one of any of those. It is the
   island's side of the contract config.js opened (CBZ.VEHICLE_MODES): it
   says WHICH machines stand WHERE on the island, wires the walk-up verbs,
   and feeds the island's weather into them.

   1. REAL CARS. A share of the arena's parked prop cars (arena.cars, the
      record every disaster throws) become real CBZ.cityCars records built by
      CBZ.cityAddParkedCar at the prop's own spot and heading. The prop mesh
      is hidden and its collider lifted; the arena record keeps pointing at
      the real car's group, so the tsunami, the flood, the sinkhole and the
      tornado keep throwing it with THEIR OWN fling, exactly as before. A car
      a disaster has thrown is a wreck (dead): you cannot drive a car that
      just cartwheeled down the street.
      "Drive" is pinned on the car ([E] / tap), CBZ.cityEnterVehicle seats
      you, the chassis drives it, systems/seat_exit.js gets you out.
      WHILE YOU DRIVE IT the car leaves the arena list (no disaster may
      teleport the car you are steering back to where it was parked), and the
      island's weather acts on the chassis itself instead (drivenWeather):
      the hurricane's and the tornado's wind push it through its tyres, an
      EF2+ core lifts it into the air on the same law tornado.js uses for a
      parked car, flood water past two feet takes its grip and floods the
      engine, a building coming down on it wrecks it.

   2. THE HELIPAD. One tower (CBZ.island.buildings when the island publishes
      it, else the arena's towers: the tallest with an open roof) gets a real
      rooftop helipad: a steel deck on four columns over the roof, a
      cantilevered overhang, a painted touchdown circle and H, green
      perimeter lights, a safety-net shelf with an edge rail, and a steel
      stair up from the roof the tower's own lift reaches (the lift is the
      route up from the street: lobby door -> Call -> Up -> stair -> deck).
      CBZ.stairs.flight makes the stair's walk surface and its AI link.

   3. THE HELICOPTER. A civil executive helicopter (city/airframes.js's VIP
      airframe in island livery) parked on the pad through
      CBZ.airParkFlyable. "Board" pinned on it; the flight is
      playeraircraft.js's: collective (Space/Shift up, Ctrl down), cyclic
      (W/S/A/D or the touch stick), pedals (Q/E or the TURN pills), F out
      (or #tExit). The island's weather is written on it as moving air
      (craft.windX/Z/Y, playeraircraft.js flyHeliV2): the hurricane carries
      it, a tornado drags, lifts and tears at it, a volcano's ash column
      chokes the turbine (airframe damage -> autorotation). Flying out over
      the sea is a legitimate way to outlast a disaster; CBZ.disasterHurt
      (systems/disasterhurt.js) already keeps the ground's hazards off an
      aircraft in the air.

   Everything here re-runs per match (the arena's reset() puts the town back;
   this puts the machines back). Phone budget: CONFIG.ISLAND_REAL_CARS real
   cars (default 8); the rest of the street stays the light props.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CFG.ISLAND_REAL_CARS == null) CFG.ISLAND_REAL_CARS = 8;
  if (CFG.ISLAND_HELIPAD == null) CFG.ISLAND_HELIPAD = true;

  const WORLD = "survival";
  const CAR_REACH = 1.6;           // m from the car's flank to offer "Drive"
  const HELI_REACH = 4.2;          // m from the cabin to offer "Board"
  const PAD_RISE = 3.0;            // deck walk surface over the roof walk surface (clears the lift car)
  const DECK_T = 0.25;             // deck slab thickness

  // the live state, rebuilt per match
  const S = {
    arena: null,                   // the surv.arena the machines were built for
    stats: null,                   // surv.stats identity (a new object = a new match)
    cars: [],                      // { car, entry, prop:{group, collider}, dummy }
    pad: null,                     // the helipad record (built once per arena)
    heli: null,                    // the parked craft
    fallenSeen: new Set(),         // towers already handled as fallen this match
    armCar: null, armHeli: null,   // what the pinned verb would act on
    drivenLift: 0, drivenFloat: 0, // driven-car weather state
    heliAsh: 0,
  };

  function on() { return g && g.mode === WORLD && CBZ.surv && CBZ.surv.arena; }
  function P() { return CBZ.player; }
  function groundAt(x, z) {
    const A = CBZ.surv && CBZ.surv.arena;
    if (A && A.groundHeightAt) { const y = +A.groundHeightAt(x, z); if (Number.isFinite(y)) return y; }
    return CBZ.floorAt ? +CBZ.floorAt(x, z) || 0 : 0;
  }
  // a seeded pick so every client parks the same cars (never Math.random)
  function hash01(x, z, salt) {
    let h = (Math.floor(x * 7.31) * 73856093) ^ (Math.floor(z * 3.17) * 19349663) ^ (salt * 83492791);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // the island's own cause for a hit while the round runs
  function cause(fallback) { return (CBZ.surv && CBZ.surv._cause) || fallback; }
  function hurtPlayer(amount, why, x, y, z) {
    if (!(amount > 0)) return;
    if (CBZ.disasterHurt) { try { CBZ.disasterHurt(amount, why, { x: x, y: y, z: z }); return; } catch (e) {} }
    if (CBZ.hurtWorldPlayer) CBZ.hurtWorldPlayer(amount, x, z, why);
  }

  /* ============================================================
     1. REAL CARS
     ============================================================ */
  function pickEntries(A, n) {
    const list = (A.cars || []).filter(function (e) { return e && e.group && !e.flung && !e.realCar; });
    if (!list.length || n <= 0) return [];
    // spread round the town: order by bearing from the island centre, take
    // every k-th, offset by a seeded phase
    const cx = A.center ? A.center.x : 0, cz = A.center ? A.center.z : 0;
    list.sort(function (a, b) { return Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx); });
    const step = list.length / Math.min(n, list.length);
    const phase = hash01(cx, cz, 5) * step;
    const out = [];
    for (let i = 0; i < Math.min(n, list.length); i++) out.push(list[Math.floor(phase + i * step) % list.length]);
    return out;
  }
  // the catalog cars a small island town plausibly parks (economy.js names)
  const TOWN_MODELS = null;   // null = cityAddParkedCar's position-hashed catalog pick
  function buildCars(A) {
    if (!CBZ.cityAddParkedCar) return;
    const want = Math.max(0, CFG.ISLAND_REAL_CARS | 0);
    const picks = pickEntries(A, want);
    for (let i = 0; i < picks.length; i++) {
      const e = picks[i];
      let car = null;
      try { car = CBZ.cityAddParkedCar(e.x, e.z, e.rotY || 0, { force: true, modelName: TOWN_MODELS ? TOWN_MODELS[i % TOWN_MODELS.length] : null }); } catch (err) { car = null; }
      if (!car) continue;
      car._world = WORLD;
      car.owned = true;                 // an island car is anybody's: no theft, no witnesses
      car._islandCar = true;
      car.ai = false;
      car.pos.y = e.oy != null ? e.oy : groundAt(e.x, e.z);
      if (car.group) { car.group.position.y = car.pos.y; car.group.rotation.set(0, car.heading, 0); }
      // the prop leaves; the arena record now IS the real car
      const prop = { group: e.group, collider: e.collider };
      if (e.group) e.group.visible = false;
      const ci = CBZ.colliders.indexOf(e.collider);
      if (ci >= 0) CBZ.colliders.splice(ci, 1);
      // A stand-in for the record's collider: the arena's reset() and every
      // fling pull and push `collider` on CBZ.colliders. The real car is
      // solid through the car resolver (physics.js), so this one is a 1 cm
      // box a kilometre underground that nothing can ever touch.
      const dummy = { minX: e.x, maxX: e.x + 0.01, minZ: e.z, maxZ: e.z + 0.01, y0: -1000, y1: -999.99, ref: null, noCam: true, noAircraft: true };
      e.group = car.group; e.collider = dummy; e.realCar = car;
      S.cars.push({ car: car, entry: e, prop: prop, dummy: dummy, base: { x: e.x, z: e.z } });
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function teardownCars() {
    const Pl = P();
    for (let i = 0; i < S.cars.length; i++) {
      const r = S.cars[i];
      if (Pl && Pl._vehicle === r.car && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
      const e = r.entry;
      // the record goes back to the prop it was
      e.group = r.prop.group; e.collider = r.prop.collider; e.realCar = null;
      if (e.group) { e.group.visible = true; e.group.position.set(e.x, e.oy, e.z); e.group.rotation.set(0, e.rotY, 0); }
      const di = CBZ.colliders.indexOf(r.dummy); if (di >= 0) CBZ.colliders.splice(di, 1);
      if (e.collider && CBZ.colliders.indexOf(e.collider) < 0) CBZ.colliders.push(e.collider);
      if (r.out) restoreEntry(r);
      if (CBZ.cityScrapCar) { try { CBZ.cityScrapCar(r.car); } catch (err) {} }
      else if (r.car.group && r.car.group.parent) r.car.group.parent.remove(r.car.group);
    }
    S.cars.length = 0;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  // the driven car is out of the arena list, so no disaster writes its group
  function liftEntry(r) {
    const A = S.arena; if (!A || !A.cars || r.out) return;
    const i = A.cars.indexOf(r.entry);
    if (i >= 0) { A.cars.splice(i, 1); r.out = true; }
  }
  function restoreEntry(r) {
    const A = S.arena; if (!A || !A.cars || !r.out) return;
    if (A.cars.indexOf(r.entry) < 0) A.cars.push(r.entry);
    r.out = false;
  }
  function wreck(r, why) {
    const car = r.car;
    if (car.dead) return;
    const Pl = P();
    if (Pl && Pl._vehicle === car && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
    if (CBZ.cityDamageCar) { try { CBZ.cityDamageCar(car, 60, { crash: true, crumple: true }); } catch (e) {} }
    car.dead = true; car._husk = true; car.ai = false; car.v = 0; car.vx = 0; car.vz = 0;
    r.wrecked = why || "wrecked";
  }

  // the car's flank distance from a point (its own frame, the OBB)
  function carGap(car, x, z) {
    const d = car.dims || {};
    const hw = (+d.width || 2) * 0.5, hl = (+d.length || 4.5) * 0.5;
    const h = car.heading || 0, s = Math.sin(h), c = Math.cos(h);
    const dx = x - car.pos.x, dz = z - car.pos.z;
    const lz = dx * s + dz * c, lx = dx * c - dz * s;
    const ox = Math.max(0, Math.abs(lx) - hw), oz = Math.max(0, Math.abs(lz) - hl);
    return Math.hypot(ox, oz);
  }

  /* THE DRIVEN CAR IN THE WEATHER. Every number is the disaster's own scale:
     the tornado's lift bar is tornado.js's EF2 "cars lifted" gust and its
     throw is the one it gives a parked car; two feet of water floats a car
     (the flood's own threshold). */
  const LIFT_SPEED = 55;           // m/s at the car: EF2, "cars lifted"
  function drivenWeather(r, dt) {
    const car = r.car;
    if (car.dead) return;
    const x = car.pos.x, z = car.pos.z;
    let wx = 0, wz = 0, ws = 0, lift = 0, tor = 0;
    const H = CBZ.hurricane;
    if (H && H.active && H.active() && H.windAt) {
      const w = H.windAt(x, z);
      if (w) { wx += w.x || 0; wz += w.z || 0; }
    }
    const T = CBZ.tornado;
    if (T && T.at) {
      const t = T.at(x, z);
      if (t && t.speed > 0) { wx += t.vx || 0; wz += t.vz || 0; lift = t.lift || 0; tor = t.speed; }
    }
    ws = Math.hypot(wx, wz);
    // the wind leans on the body: ~0.5 rho CdA v^2 / m for a car's side,
    // which past ~45 m/s beats the tyres and slides it
    if (ws > 12 && !car._airborne) {
      const k = 0.0035 * ws * dt;
      car.vx = (car.vx || 0) + wx * k; car.vz = (car.vz || 0) + wz * k;
      const h = car.heading || 0;
      car.v = car.vx * Math.sin(h) + car.vz * Math.cos(h);
    }
    // an EF2+ core takes the car off the road: the same throw tornado.js
    // gives a parked one (along the wind, hard up, priced off the updraft)
    S.drivenLift = Math.max(0, S.drivenLift - dt);
    if (tor > LIFT_SPEED && S.drivenLift <= 0 && !car._airborne) {
      const inv = 1 / Math.max(1, tor);
      const push = Math.min(22, tor * 0.3);
      car.vx = (car.vx || 0) + wx * inv * push; car.vz = (car.vz || 0) + wz * inv * push;
      const h = car.heading || 0;
      car.v = car.vx * Math.sin(h) + car.vz * Math.cos(h);
      car._airborne = true; car._airY = Math.max(0.15, car._airY || 0);
      car._airVy = Math.min(14, 4 + lift * 0.4);
      r.thrownBy = cause("thrown by the tornado");
      S.drivenLift = 2.0;
      if (CBZ.shake) CBZ.shake(0.8);
    }
    // the landing: the chassis takes its own damage (vehicles.js); the body
    // in the seat takes the rest of the impact past ~9 m/s
    if (car._airborne) r.fallV = Math.max(r.fallV || 0, -(car._airVy || 0));
    else if (r.fallV) {
      const v = r.fallV; r.fallV = 0;
      if (v > 9) hurtPlayer((v - 9) * 5, r.thrownBy || cause("thrown in the car"), car.pos.x, car.pos.y, car.pos.z);
      r.thrownBy = null;
    }
    // WATER. Two feet floats it: the tyres lose the road and the car goes
    // where the water goes (downhill, toward the sea); past a metre the
    // engine drinks and dies (vehicles.js reads car._flooded as no throttle)
    let depth = 0;
    if (CBZ.survFloodDepthMeanAt) { try { depth = Math.max(depth, +CBZ.survFloodDepthMeanAt(x, z) || 0); } catch (e) {} }
    if (CBZ.groundWaterAt) { try { depth = Math.max(depth, +CBZ.groundWaterAt(x, z) || 0); } catch (e) {} }
    if (depth > 0.6 && !car._airborne) {
      const k = Math.min(1, (depth - 0.6) / 0.6);
      const damp = Math.exp(-1.6 * k * dt);
      car.vx *= damp; car.vz *= damp; car.v *= damp;
      // the water's way: down the ground's slope, toward the sea
      const e = 1.5;
      const gx = groundAt(x + e, z) - groundAt(x - e, z), gz = groundAt(x, z + e) - groundAt(x, z - e);
      const gl = Math.hypot(gx, gz);
      let fx = 0, fz = 0;
      if (gl > 1e-3) { fx = -gx / gl; fz = -gz / gl; }
      else if (CBZ.surv.arena.center) { fx = x - CBZ.surv.arena.center.x; fz = z - CBZ.surv.arena.center.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl; }
      const drift = 2.4 * k;
      car.vx += (fx * drift - car.vx) * Math.min(1, dt * 0.8 * k);
      car.vz += (fz * drift - car.vz) * Math.min(1, dt * 0.8 * k);
      S.drivenFloat = depth;
      if (depth > 1.0 && !car._flooded) {
        car._flooded = true;
        if (CBZ.carAudio && CBZ.carAudio.stop) { try { CBZ.carAudio.stop(); } catch (err) {} }
      }
    } else S.drivenFloat = 0;
  }

  function carsTick(dt) {
    const Pl = P();
    for (let i = 0; i < S.cars.length; i++) {
      const r = S.cars[i], car = r.car, e = r.entry;
      const driven = !!(Pl && Pl._vehicle === car && Pl.driving);
      if (driven) {
        liftEntry(r);
        drivenWeather(r, dt);
        continue;
      }
      if (r.out) {
        // left where it was parked: the arena record follows it
        e.x = car.pos.x; e.z = car.pos.z; e.oy = car.pos.y; e.rotY = car.heading || 0;
        restoreEntry(r);
        r.base.x = e.x; r.base.z = e.z;
      }
      // a disaster threw it (the record's own fling): it is a wreck now
      if (e.flung && !car.dead) wreck(r, "thrown");
      // shoved by the storm or another car: the record's rest point follows
      if (!e.flung && !car.dead && Math.hypot(car.pos.x - r.base.x, car.pos.z - r.base.z) > 0.8) {
        e.x = car.pos.x; e.z = car.pos.z; r.base.x = e.x; r.base.z = e.z;
      }
    }
  }

  // a tower coming down crushes the machines on and beside it
  function fallenTick() {
    const A = S.arena; if (!A || !A.fragile) return;
    for (let b of A.fragile) {
      if (!b.fallen || S.fallenSeen.has(b)) continue;
      S.fallenSeen.add(b);
      const hx = (b.w || 8) / 2 + 1.5, hz = (b.d || 8) / 2 + 1.5;
      for (let i = 0; i < S.cars.length; i++) {
        const r = S.cars[i], c = r.car.pos;
        if (Math.abs(c.x - b.x) < hx && Math.abs(c.z - b.z) < hz) wreck(r, "crushed");
      }
      if (S.pad && S.pad.b === b) dropPad();
    }
  }

  /* ============================================================
     2. THE HELIPAD
     ============================================================ */
  // the tower to crown: CBZ.island.buildings when the island publishes it
  // (footprints + heights), else the arena's lift towers. Tallest OPEN roof
  // (a lift that stops at the shell roof, nothing over the shaft); a tower
  // whose crown fills the roof is passed over.
  function chooseTower(A) {
    const elevs = A.elevators || [];
    const isl = CBZ.island && Array.isArray(CBZ.island.buildings) ? CBZ.island.buildings : null;
    let towers = isl && isl.length ? openTowers(isl, elevs) : [];
    if (!towers.length) towers = openTowers(A.fragile || [], elevs);
    return bestTower(towers);
  }
  function openTowers(src, elevs) {
    const towers = [];
    for (let i = 0; i < src.length; i++) {
      const raw = src[i];
      // an island.buildings row may wrap the arena record ({rec|b|building}) or be it
      const b = (raw && (raw.rec || raw.b || raw.building)) || raw;
      if (!b || b.fallen || b.liftTop == null) continue;
      const e = elevs.find(function (q) { return q.b === b; });
      if (!e || !e.stops || !e.stops.length) continue;
      const roofStop = e.stops.indexOf(b.h);
      if (roofStop < 0) continue;                       // the crown buries the roof
      if (b.liftTop > b.h + 0.3) continue;              // the lift rides up into a crown
      if (Math.min(b.w, b.d) < 6.5) continue;
      towers.push({ b: b, e: e });
    }
    return towers;
  }
  function bestTower(towers) {
    towers.sort(function (p, q) { return (q.b.gy + q.b.h) - (p.b.gy + p.b.h); });
    // nothing standing on the open roof above the parapet (a grammar's roof
    // furniture): measure the tower's drawn top
    const box = new THREE.Box3();
    for (let i = 0; i < towers.length; i++) {
      const T = towers[i];
      try {
        T.b.group.updateMatrixWorld(true);
        box.setFromObject(T.b.group);
        T.top = box.max.y;
      } catch (e) { T.top = T.b.gy + T.b.h; }
      if (T.top <= T.b.gy + T.b.h + 1.6) return T;
    }
    return towers[0] || null;
  }

  const MAT = {};
  function mats() {
    if (MAT.deck) return MAT;
    const M = function (c, o) { return CBZ.mat ? CBZ.mat(c, o) : new THREE.MeshLambertMaterial({ color: c }); };
    const vm = function (role, c, o) { try { if (CBZ.vehicleMat) return CBZ.vehicleMat(role, c, o); } catch (e) {} return M(c, o); };
    MAT.deck = M(0x3b4047);                                 // painted steel deck, non-slip grey
    MAT.steel = vm("metal", 0x59626c);                      // girders, columns, stair
    MAT.dark = M(0x23272c);
    MAT.white = new THREE.MeshLambertMaterial({ color: 0xf2f2ee, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    MAT.yellow = new THREE.MeshLambertMaterial({ color: 0xf2c230, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    MAT.net = new THREE.MeshLambertMaterial({ color: 0x2a2e33, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false });
    MAT.green = new THREE.MeshBasicMaterial({ color: 0x3cff6a });
    MAT.amber = new THREE.MeshBasicMaterial({ color: 0xffb43a });
    MAT.rail = vm("metal", 0xd8a21e);
    for (const k in MAT) MAT[k]._shared = true;
    return MAT;
  }

  function buildPad(A) {
    const T = chooseTower(A);
    if (!T) return null;
    const b = T.b, e = T.e;
    const m = mats();
    const root = new THREE.Group();
    root.name = "island-helipad";
    root.position.set(b.ox, b.gy, b.oz);
    A.root.add(root);
    const plats = [], cols = [], owner = "island-helipad";
    const w = b.w, d = b.d, TW = 0.4;
    const iw = w / 2 - TW, id = d / 2 - TW, s = e.s;
    const roofY = b.h + 0.1;                      // the roof ring's walk surface (local)
    const deckY = roofY + PAD_RISE;               // the deck's walk surface (local)
    const W = b.gy;                               // local -> world y

    // ---- the deck plan: a rectangle over the roof, cantilevered past it ----
    const zBack = d / 2 + 0.6;
    const L = Math.max(13, d + 1.2);              // depth (z)
    const zFront = zBack - L;
    const halfX = Math.max(6.5, w / 2 + 1.0);     // half width (x)
    const cz = (zFront + zBack) / 2;              // touchdown centre (local)

    // ---- the stair: roof ring -> deck, up the back strip (between the shaft
    //      and the back wall), rising toward +x through a hatch in the deck ----
    const strip = id - s;
    const sw = Math.max(0.75, Math.min(1.0, strip - 0.3));
    const sz = (s + id) / 2;                      // flight centre line (local z)
    const run = PAD_RISE / Math.tan(37 * Math.PI / 180);
    const sx0 = -iw + 0.45;                       // bottom nosing (local x)
    const sx1 = Math.min(iw - 0.45, sx0 + run);   // top nosing
    const nSteps = Math.max(8, Math.round(PAD_RISE / 0.19));
    // where a climber needs the deck gone overhead (2.1 m clear over the tread)
    const holeX0 = sx0 + (sx1 - sx0) * Math.max(0, (PAD_RISE - DECK_T - 2.1) / PAD_RISE) - 0.2;
    const holeX1 = sx1 + 0.05;
    const holeZ0 = sz - sw / 2 - 0.12, holeZ1 = sz + sw / 2 + 0.12;

    // deck slabs: the rectangle minus the hatch, as 4 rects
    const rects = [
      [-halfX, halfX, zFront, holeZ0],
      [-halfX, halfX, holeZ1, zBack],
      [-halfX, holeX0, holeZ0, holeZ1],
      [holeX1, halfX, holeZ0, holeZ1],
    ];
    const box = function (x0, x1, y0, y1, z0, z1, mat, parent) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      mesh.castShadow = true; mesh.receiveShadow = true;
      (parent || root).add(mesh);
      return mesh;
    };
    for (const r of rects) {
      if (r[1] - r[0] < 0.05 || r[3] - r[2] < 0.05) continue;
      box(r[0], r[1], deckY - DECK_T, deckY, r[2], r[3], m.deck);
      const p = { minX: b.ox + r[0], maxX: b.ox + r[1], minZ: b.oz + r[2], maxZ: b.oz + r[3], top: W + deckY, helipad: true };
      CBZ.platforms.push(p); plats.push(p);
    }
    // ---- structure: perimeter girders under the deck, four corner columns
    //      standing on the tower's corners, knee braces out to the overhang ----
    const gH = 0.45;
    box(-halfX, halfX, deckY - DECK_T - gH, deckY - DECK_T, zFront, zFront + 0.25, m.steel);
    box(-halfX, halfX, deckY - DECK_T - gH, deckY - DECK_T, zBack - 0.25, zBack, m.steel);
    box(-halfX, -halfX + 0.25, deckY - DECK_T - gH, deckY - DECK_T, zFront, zBack, m.steel);
    box(halfX - 0.25, halfX, deckY - DECK_T - gH, deckY - DECK_T, zFront, zBack, m.steel);
    // main girders over the walls, front to back
    box(-w / 2 + 0.05, -w / 2 + 0.35, deckY - DECK_T - gH * 1.3, deckY - DECK_T, zFront, zBack, m.steel);
    box(w / 2 - 0.35, w / 2 - 0.05, deckY - DECK_T - gH * 1.3, deckY - DECK_T, zFront, zBack, m.steel);
    const colTop = deckY - DECK_T - gH * 1.3;
    const colXs = [-w / 2 + 0.2, w / 2 - 0.2], colZs = [-d / 2 + 0.2, d / 2 - 0.2];
    for (const cx of colXs) for (const czc of colZs) {
      box(cx - 0.16, cx + 0.16, b.h, colTop, czc - 0.16, czc + 0.16, m.steel);
      const c = { minX: b.ox + cx - 0.18, maxX: b.ox + cx + 0.18, minZ: b.oz + czc - 0.18, maxZ: b.oz + czc + 0.18, y0: W + b.h, y1: W + colTop, ref: null, noAircraft: true };
      CBZ.colliders.push(c); cols.push(c);
    }
    // knee braces from the front columns out to the cantilever's front edge
    for (const cx of colXs) {
      const zc0 = -d / 2 + 0.2, y0 = b.h + 0.8, y1 = colTop;
      const len = Math.hypot(zc0 - (zFront + 0.3), y1 - y0);
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, len), m.steel);
      br.position.set(cx, (y0 + y1) / 2, (zc0 + zFront + 0.3) / 2);
      br.rotation.x = Math.atan2(y1 - y0, zc0 - (zFront + 0.3));
      root.add(br);
    }

    // ---- the markings: touchdown circle (yellow), H (white), perimeter line ----
    const mk = deckY + 0.004;
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.75, 3.0, 48), m.yellow);
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, mk, cz); root.add(ring);
    const hW = 0.42, hL = 2.7, hS = 1.0;
    // the H is laid so its uprights run along the approach (x): read from the stair
    const bar = function (x0, x1, z0, z1, mat) {
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
      pm.rotation.x = -Math.PI / 2; pm.position.set((x0 + x1) / 2, mk, (z0 + z1) / 2); root.add(pm);
    };
    bar(-hL / 2, hL / 2, cz - hS - hW / 2, cz - hS + hW / 2, m.white);
    bar(-hL / 2, hL / 2, cz + hS - hW / 2, cz + hS + hW / 2, m.white);
    bar(-hW / 2, hW / 2, cz - hS + hW / 2, cz + hS - hW / 2, m.white);
    const lw = 0.22, ins = 0.35;
    bar(-halfX + ins, halfX - ins, zFront + ins, zFront + ins + lw, m.white);
    bar(-halfX + ins, halfX - ins, zBack - ins - lw, zBack - ins, m.white);
    bar(-halfX + ins, -halfX + ins + lw, zFront + ins, zBack - ins, m.white);
    bar(halfX - ins - lw, halfX - ins, zFront + ins, zBack - ins, m.white);

    // ---- the lit perimeter: green flush lights every ~1.1 m (one draw) ----
    const lights = [];
    const perim = function (ax, ay, bx, by) {
      const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 1.1));
      for (let i = 0; i < n; i++) { const t = i / n; lights.push([ax + (bx - ax) * t, ay + (by - ay) * t]); }
    };
    perim(-halfX + 0.12, zFront + 0.12, halfX - 0.12, zFront + 0.12);
    perim(halfX - 0.12, zFront + 0.12, halfX - 0.12, zBack - 0.12);
    perim(halfX - 0.12, zBack - 0.12, -halfX + 0.12, zBack - 0.12);
    perim(-halfX + 0.12, zBack - 0.12, -halfX + 0.12, zFront + 0.12);
    const lm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.07, 0.16), m.green, lights.length);
    const M4 = new THREE.Matrix4();
    for (let i = 0; i < lights.length; i++) { M4.makeTranslation(lights[i][0], deckY + 0.035, lights[i][1]); lm.setMatrixAt(i, M4); }
    lm.instanceMatrix.needsUpdate = true;
    lm.frustumCulled = false;
    lm.name = "helipad-perimeter-lights";
    root.add(lm);
    // the wind cone on the back corner, and an amber beacon on each corner post
    const pole = box(halfX - 0.5, halfX - 0.42, deckY, deckY + 2.4, zBack - 0.5, zBack - 0.42, m.steel);
    pole.castShadow = false;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.08, 1.1, 10, 1, true), MAT.amber);
    cone.rotation.z = Math.PI / 2; cone.position.set(halfX - 0.46 - 0.55, deckY + 2.3, zBack - 0.46);
    root.add(cone);

    // ---- the safety-net shelf round the deck edge + its rail (the rail is
    //      the collider: the net would catch you, the game stops you) ----
    const netW = 1.4, netDrop = 0.35;
    const netSide = function (ax, az, bx, bz, ox, oz) {
      const len = Math.hypot(bx - ax, bz - az);
      // a frame per side whose local +z points OUT from the deck edge
      const side = new THREE.Group();
      side.position.set((ax + bx) / 2, deckY - DECK_T, (az + bz) / 2);
      side.rotation.y = Math.atan2(ox, oz);
      root.add(side);
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(len + netW * 2, netW), m.net);
      pm.rotation.x = -Math.PI / 2 + Math.atan2(netDrop, netW);     // dips toward the outer bar
      pm.position.set(0, -netDrop / 2, netW / 2);
      side.add(pm);
      // the outer frame bar and the arms that hold it off the girder
      const fb = new THREE.Mesh(new THREE.BoxGeometry(len + netW * 2, 0.06, 0.06), m.rail);
      fb.position.set(0, -netDrop, netW);
      side.add(fb);
      const arms = Math.max(2, Math.round(len / 3) + 1);
      for (let i = 0; i < arms; i++) {
        const ax2 = -len / 2 + len * i / (arms - 1);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, Math.hypot(netW, netDrop)), m.steel);
        arm.position.set(ax2, -netDrop / 2, netW / 2);
        arm.rotation.x = Math.atan2(netDrop, netW);
        side.add(arm);
      }
      // the rail collider at the deck edge, knee-high over the deck
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
      const z0 = Math.min(az, bz), z1 = Math.max(az, bz);
      const c = {
        minX: b.ox + (ox ? (ox > 0 ? x1 : x0 - 0.15) : x0), maxX: b.ox + (ox ? (ox > 0 ? x1 + 0.15 : x0) : x1),
        minZ: b.oz + (oz ? (oz > 0 ? z1 : z0 - 0.15) : z0), maxZ: b.oz + (oz ? (oz > 0 ? z1 + 0.15 : z0) : z1),
        y0: W + deckY - 0.3, y1: W + deckY + 1.05, ref: null, noAircraft: true, noCam: true,
      };
      CBZ.colliders.push(c); cols.push(c);
    };
    netSide(-halfX, zFront, halfX, zFront, 0, -1);
    netSide(-halfX, zBack, halfX, zBack, 0, 1);
    netSide(-halfX, zFront, -halfX, zBack, -1, 0);
    netSide(halfX, zFront, halfX, zBack, 1, 0);

    // ---- the stair: treads (one instanced draw), two stringers, a handrail ----
    const rise = PAD_RISE / nSteps, tread = (sx1 - sx0) / nSteps;
    const tm = new THREE.InstancedMesh(new THREE.BoxGeometry(tread + 0.04, 0.05, sw), m.steel, nSteps);
    for (let i = 0; i < nSteps; i++) {
      M4.makeTranslation(sx0 + tread * (i + 0.5), roofY + rise * (i + 1) - 0.025, sz);
      tm.setMatrixAt(i, M4);
    }
    tm.instanceMatrix.needsUpdate = true; tm.frustumCulled = false; tm.castShadow = true;
    root.add(tm);
    const strLen = Math.hypot(sx1 - sx0, PAD_RISE), ang = Math.atan2(PAD_RISE, sx1 - sx0);
    for (const sd of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(strLen, 0.22, 0.05), m.steel);
      st.position.set((sx0 + sx1) / 2, roofY + PAD_RISE / 2 - 0.05, sz + sd * (sw / 2 + 0.03));
      st.rotation.z = ang; root.add(st);
      const rl = new THREE.Mesh(new THREE.BoxGeometry(strLen, 0.05, 0.05), m.rail);
      rl.position.set((sx0 + sx1) / 2, roofY + PAD_RISE / 2 + 0.95, sz + sd * (sw / 2 + 0.03));
      rl.rotation.z = ang; root.add(rl);
    }
    // the hatch's guard rail on the deck (both long sides and the low end; the
    // high end is where you step off)
    const hatchRail = function (x0, x1, z0, z1) {
      box(x0, x1, deckY + 0.98, deckY + 1.04, z0, z1, m.rail);
      const c = { minX: b.ox + x0, maxX: b.ox + x1, minZ: b.oz + z0, maxZ: b.oz + z1, y0: W + deckY - 0.1, y1: W + deckY + 1.05, ref: null, noAircraft: true, noCam: true };
      CBZ.colliders.push(c); cols.push(c);
      const posts = Math.max(2, Math.round(Math.max(x1 - x0, z1 - z0) / 1.0) + 1);
      for (let i = 0; i < posts; i++) {
        const t = i / (posts - 1);
        const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
        box(px - 0.025, px + 0.025, deckY, deckY + 1.0, pz - 0.025, pz + 0.025, m.rail);
      }
    };
    hatchRail(holeX0, holeX1, holeZ0 - 0.06, holeZ0);
    hatchRail(holeX0, holeX1, holeZ1, holeZ1 + 0.06);
    hatchRail(holeX0 - 0.06, holeX0, holeZ0, holeZ1);
    // the walk surface (+ the AI link) of the flight
    let fl = null;
    if (CBZ.stairs && CBZ.stairs.flight) {
      fl = CBZ.stairs.flight({
        bottom: { x: b.ox + sx0, y: W + roofY, z: b.oz + sz },
        top: { x: b.ox + sx1, y: W + deckY, z: b.oz + sz },
        width: sw, steps: nSteps, owner: owner, plats: plats, kind: "stair",
      });
    }
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    // merge nothing else: ~40 small meshes once per island; the island's
    // static freeze pass (core/staticfreeze.js) owns their matrices
    root.traverse(function (o) { o.matrixAutoUpdate = false; o.updateMatrix(); });
    root.updateMatrixWorld(true);

    return {
      b: b, e: e, root: root, plats: plats, cols: cols, owner: owner, flight: fl, dropped: false,
      // world points the rest of this file and the lab read
      centre: { x: b.ox, y: W + deckY, z: b.oz + cz },
      deckY: W + deckY, roofY: W + roofY,
      stairBottom: { x: b.ox + sx0 - 0.6, y: W + roofY, z: b.oz + sz },
      stairTop: { x: b.ox + sx1 + 0.6, y: W + deckY, z: b.oz + sz },
      door: { x: b.ox, z: b.oz - d / 2 - 1.2 },                 // the street side of the lobby door
      liftIn: { x: b.ox, z: b.oz },                              // the lift car's floor centre
      roofStop: e.stops.indexOf(b.h),
      half: { x: halfX, z0: zFront, z1: zBack },
    };
  }
  // the pad goes with its tower
  function dropPad() {
    const pad = S.pad; if (!pad || pad.dropped) return;
    pad.dropped = true;
    pad.root.visible = false;
    for (const p of pad.plats) { const i = CBZ.platforms.indexOf(p); if (i >= 0) CBZ.platforms.splice(i, 1); }
    for (const c of pad.cols) { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); }
    if (CBZ.stairs && CBZ.stairs.setOwnerActive) CBZ.stairs.setOwnerActive(pad.owner, false);
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    // a parked helicopter comes down with the roof
    const c = S.heli;
    if (c && !c.destroyed && P() && P()._aircraft !== c) {
      const gy = groundAt(c.pos.x, c.pos.z);
      c.pos.y = gy + (c.groundOffset || 1); c.group.position.copy(c.pos);
      if (CBZ.airWreck) CBZ.airWreck(c);
    }
  }
  function raisePad() {
    const pad = S.pad; if (!pad || !pad.dropped) return;
    pad.dropped = false;
    pad.root.visible = true;
    for (const p of pad.plats) if (CBZ.platforms.indexOf(p) < 0) CBZ.platforms.push(p);
    for (const c of pad.cols) if (CBZ.colliders.indexOf(c) < 0) CBZ.colliders.push(c);
    if (CBZ.stairs && CBZ.stairs.setOwnerActive) CBZ.stairs.setOwnerActive(pad.owner, true);
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  /* ============================================================
     3. THE HELICOPTER
     ============================================================ */
  function parkHeli() {
    const pad = S.pad;
    if (!pad || pad.dropped || !CBZ.airParkFlyable) return null;
    // nose toward the open side of the island (away from the centre): the
    // takeoff is out over the town edge, not into the next tower
    const A = S.arena, c = A.center || { x: 0, z: 0 };
    const hd = Math.atan2(pad.centre.x - c.x, pad.centre.z - c.z);
    // a helipad heli is parked along the pad's long axis (x), nose the way out
    const heading = Math.sin(hd) >= 0 ? Math.PI / 2 : -Math.PI / 2;
    return CBZ.airParkFlyable({
      x: pad.centre.x, y: pad.deckY, z: pad.centre.z, heading: heading,
      variant: "vip", name: "Island Air",
      livery: { body: 0xe9e6dd, belly: 0x1f4f7a, accent: 0xd8a21e },
    });
  }
  function unparkHeli() {
    if (S.heli && CBZ.airUnpark) { try { CBZ.airUnpark(S.heli); } catch (e) {} }
    S.heli = null;
  }

  /* THE FLOWN HELICOPTER IN THE WEATHER. The air mass's own velocity, written
     where playeraircraft.js's flight step reads it. */
  function heliWeather(c, dt) {
    const x = c.pos.x, z = c.pos.z;
    let wx = 0, wz = 0, wy = 0, tor = 0;
    const H = CBZ.hurricane;
    if (H && H.active && H.active() && H.windAt) {
      const w = H.windAt(x, z);
      if (w) { wx += w.x || 0; wz += w.z || 0; }
    }
    const T = CBZ.tornado;
    if (T && T.at) {
      const t = T.at(x, z);
      if (t && t.speed > 0) {
        // the vortex reaches up the column: full strength low, fading by ~250 m
        const agl = Math.max(0, c.pos.y - groundAt(x, z));
        const k = Math.max(0, 1 - agl / 250);
        wx += (t.vx || 0) * k; wz += (t.vz || 0) * k; wy += (t.lift || 0) * 0.6 * k; tor = (t.speed || 0) * k;
      }
    }
    // gusts: the air is never smooth in a storm (seeded off the craft's own
    // clock, not Math.random, so a replay flies the same)
    const ws = Math.hypot(wx, wz);
    if (ws > 8) {
      const tt = (c._gustT = (c._gustT || 0) + dt);
      const gk = ws * 0.18;
      wx += Math.sin(tt * 1.7 + 0.3) * gk; wz += Math.cos(tt * 1.3 + 1.1) * gk; wy += Math.sin(tt * 2.3) * gk * 0.4;
    }
    c.windX = wx; c.windZ = wz; c.windY = wy;
    // a tornado's core tears at the airframe: an EF2+ core is not survivable
    // for a light twin, an EF0 edge only rattles it
    if (tor > 45 && CBZ.airCraftDamage) CBZ.airCraftDamage(c, (tor - 45) * 1.6 * dt, x, z);
    // VOLCANIC ASH IS ENGINE DEATH. A turbine that flies the eruption column
    // ingests glass: power fades (airframe hp -> autorotation) the longer you
    // stay in it. The column stands over the crater and leans downwind.
    S.heliAsh = 0;
    const D = CBZ.disasters;
    if (D && D.currentId && D.currentId() === "volcano" && D.state && D.state() === "active") {
      const A = S.arena, hill = A && A.hills && A.hills[0];
      if (hill) {
        const vx = hill.x, vz = hill.z, peak = Math.max(hill.peak || 30, groundAt(vx, vz));
        const above = c.pos.y - peak;
        const dh = Math.hypot(x - vx, z - vz);
        // the column widens as it rises; the leeward drift is not modelled here
        const r = 30 + Math.max(0, above) * 0.35;
        if (above > -15 && dh < r) {
          S.heliAsh = 1 - dh / r;
          if (CBZ.airCraftDamage) CBZ.airCraftDamage(c, 14 * S.heliAsh * dt, vx, vz);
        }
      }
    }
  }

  /* ============================================================
     THE VERBS (on foot)
     ============================================================ */
  CBZ.islandCarDrive = function () {
    const r = S.armCar; const Pl = P();
    if (!r || !Pl || Pl.dead || Pl.driving || r.car.dead) return false;
    if (!CBZ.cityEnterVehicle) return false;
    const ok = CBZ.cityEnterVehicle(r.car);
    if (ok) liftEntry(r);
    return ok;
  };
  CBZ.islandHeliBoard = function () {
    const c = S.armHeli; const Pl = P();
    if (!c || !Pl || Pl.dead || Pl.driving || c.destroyed || !CBZ.airBoard) return false;
    return CBZ.airBoard(c);
  };
  // the ratchet's site list (systems/interactions.js prompt audit)
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "island-car-drive", act: "@islandCarDrive", was: "island cars were props", now: "Drive, pinned on the car" },
    { id: "island-heli-board", act: "@islandHeliBoard", was: "no aircraft on the island", now: "Board, pinned on the helicopter" }
  );
  function armVerbs() {
    S.armCar = null; S.armHeli = null;
    const Pl = P();
    if (!Pl || !Pl.pos || Pl.dead || Pl.driving || Pl._aircraft || Pl._doorArc || Pl._swim || !CBZ.prisonPrompt) return;
    if (g.state !== "playing") return;
    const px = Pl.pos.x, py = Pl.pos.y, pz = Pl.pos.z;
    let best = null, bd = CAR_REACH;
    for (let i = 0; i < S.cars.length; i++) {
      const r = S.cars[i], c = r.car;
      if (c.dead || c.player || !c.group || !c.group.visible) continue;
      if (Math.abs(c.pos.y - py) > 1.6) continue;
      const gap = carGap(c, px, pz);
      if (gap < bd) { bd = gap; best = r; }
    }
    if (best) {
      S.armCar = best;
      const c = best.car;
      CBZ.prisonPrompt("island-car-drive", "@islandCarDrive", "Drive",
        { at: { x: c.pos.x, y: c.pos.y + 1.7, z: c.pos.z }, key: "e", bind: true, d2: bd * bd });
    }
    const h = S.heli;
    if (h && !h.destroyed && h.group && h.group.visible !== false) {
      const dy = (h.pos.y - (h.groundOffset || 0)) - py;
      const d = Math.hypot(h.pos.x - px, h.pos.z - pz);
      if (d < HELI_REACH && Math.abs(dy) < 1.4) {
        S.armHeli = h;
        CBZ.prisonPrompt("island-heli-board", "@islandHeliBoard", "Board",
          { at: { x: h.pos.x, y: h.pos.y + 1.2, z: h.pos.z }, key: "e", bind: true, d2: Math.max(0.01, (d - 2) * (d - 2)) });
      }
    }
  }

  /* ============================================================
     LIFECYCLE
     ============================================================ */
  function setup() {
    const A = CBZ.surv.arena;
    if (S.arena !== A) {
      // a new island (first match, or a rebuilt arena): the pad is per arena
      if (S.pad && S.pad.root && S.pad.root.parent) S.pad.root.parent.remove(S.pad.root);
      S.pad = null;
      S.arena = A;
      if (CFG.ISLAND_HELIPAD !== false) { try { S.pad = buildPad(A); } catch (e) { console.error("[island helipad]", e); S.pad = null; } }
    }
    if (S.pad) { if (S.pad.b.fallen) dropPad(); else raisePad(); }
    try { buildCars(A); } catch (e) { console.error("[island cars]", e); }
    if (S.pad && !S.pad.dropped) { try { S.heli = parkHeli(); } catch (e) { console.error("[island heli]", e); S.heli = null; } }
    S.fallenSeen.clear();
    S.drivenLift = 0; S.drivenFloat = 0;
  }
  function teardown() {
    const Pl = P();
    if (Pl && Pl._aircraft && S.heli && Pl._aircraft === S.heli && CBZ.cityPlayerAircraftExit) {
      try { CBZ.cityPlayerAircraftExit(); } catch (e) {}
    }
    teardownCars();
    unparkHeli();
  }

  // before the driven car (11) and the flight (12) read their inputs
  CBZ.onUpdate(10.95, function (dt) {
    if (!on()) {
      // leaving the island in a seat: out first (a world switch never keeps you in an island machine)
      const Pl = P();
      if (Pl && Pl.driving && Pl._vehicle && Pl._vehicle._world === WORLD && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
      return;
    }
    const st = CBZ.surv.stats;
    if (st !== S.stats || S.arena !== CBZ.surv.arena) {
      if (S.stats) teardown();
      S.stats = st;
      setup();
    }
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    const Pl = P();
    // dead at the wheel: out, so the death's own fall plays (physics.js
    // yields the body to a vehicle while P.driving)
    if (Pl && Pl.dead && Pl.driving && Pl._vehicle && Pl._vehicle._world === WORLD && CBZ.cityExitVehicle) {
      try { CBZ.cityExitVehicle(); } catch (e) {}
    }
    carsTick(dt);
    fallenTick();
    const c = S.heli;
    if (c && Pl && Pl._aircraft === c) heliWeather(c, dt);
    else if (c) {
      c.windX = c.windY = c.windZ = 0;
      // a parked bird in a tornado core or a hurricane's eyewall is lost
      if (!c.destroyed) {
        let ws = 0;
        const T = CBZ.tornado;
        if (T && T.at) { const t = T.at(c.pos.x, c.pos.z); if (t) ws = Math.max(ws, t.speed || 0); }
        const H = CBZ.hurricane;
        if (H && H.active && H.active() && H.windAt) { const w = H.windAt(c.pos.x, c.pos.z); if (w) ws = Math.max(ws, w.speed || Math.hypot(w.x || 0, w.z || 0)); }
        if (ws > 62 && CBZ.airWreck) CBZ.airWreck(c);
      }
    }
    armVerbs();
  });

  // ---- what the lab and the tools read ----
  CBZ.islandVehicles = {
    state: function () {
      const Pl = P();
      return {
        cars: S.cars.map(function (r) {
          return { x: +r.car.pos.x.toFixed(2), z: +r.car.pos.z.toFixed(2), dead: !!r.car.dead, wrecked: r.wrecked || null,
            driven: !!(Pl && Pl._vehicle === r.car), model: r.car.model ? r.car.model.name : null };
        }),
        pad: S.pad ? { tower: { x: S.pad.b.ox, z: S.pad.b.oz, w: S.pad.b.w, d: S.pad.b.d, h: S.pad.b.h, gy: S.pad.b.gy },
          deckY: +S.pad.deckY.toFixed(2), roofY: +S.pad.roofY.toFixed(2), dropped: S.pad.dropped,
          centre: S.pad.centre, stairBottom: S.pad.stairBottom, stairTop: S.pad.stairTop } : null,
        heli: S.heli ? { x: +S.heli.pos.x.toFixed(2), y: +S.heli.pos.y.toFixed(2), z: +S.heli.pos.z.toFixed(2),
          destroyed: !!S.heli.destroyed, hp: Math.round(S.heli.hp), flown: !!(Pl && Pl._aircraft === S.heli), onGround: !!S.heli.onGround } : null,
        armed: { car: !!S.armCar, heli: !!S.armHeli },
        drivenFloat: S.drivenFloat, heliAsh: S.heliAsh,
      };
    },
    cars: function () { return S.cars.map(function (r) { return r.car; }); },
    heli: function () { return S.heli; },
    pad: function () { return S.pad; },
    rebuild: function () { if (S.stats) teardown(); S.stats = null; },
  };
})();
