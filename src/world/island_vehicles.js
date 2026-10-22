/* ============================================================
   world/island_vehicles.js — THE DISASTER ISLAND'S REAL MACHINES.

   Gang City has the whole vehicle stack — the lofted cars (city/
   playercars.js), the chassis (city/cardyn.js driven by city/vehicles.js),
   the cabin seat, the chase camera, the seat exit, the helicopters (city/
   playeraircraft.js + city/airframes.js), the door arc and the bailout, the
   parked-car sleep and the instanced far pools (city/carinstances.js +
   city/carlod.js). This file is NOT a second one of any of those. It is the
   island's side of the contract config.js opened (CBZ.VEHICLE_MODES): it says
   WHICH machines stand WHERE on the island, wires the walk-up verbs, and feeds
   the island's weather into them.

   1. EVERY CAR IS REAL. Owner: "there's some real cars, some fake. Get rid of
      the fakes." The island used to draw ~90 prop cars of its own (an
      extruded-profile mesh on a box collider each, behind an instanced proxy)
      and swap 8 of them for real cars at match start. world/disaster_arena.js
      now builds NO car: it publishes arena.carSpots (where a car is parked,
      which way, in what paint) and this file stands a real vehicle on every
      spot through CBZ.cityAddParkedCar: the same models the city parks,
      enterable ([E] / tap "Drive"), drivable on the real chassis, solid to
      bodies and to other cars. Those vehicle RECORDS are what arena.cars
      holds, so every disaster that reads the island's cars reads vehicles.

      COST. Parked, a car costs nothing per frame: city/vehicles.js seats it
      once, then it is drawn by the shared instanced pools past 35 m (far tier:
      carlod.js's sub-pixel twins) and slept past the fog, exactly like a city
      street; the car-vs-car solve skips any pair with no mover in it. The
      island's town fleet is four catalog styles (a small town's hatchback,
      saloon, SUV and pickup) so the pools stay a handful of draws, whatever
      the paint. The fleet is built a few cars a frame (nearest first), never
      ninety in one hitch, and between matches only the cars a match actually
      touched are rebuilt; the rest are put back on their spots.

      DISASTERS act on these records through the one door city/vehicles.js
      opens, CBZ.vehicleDisaster: a disaster that carries a car off (the
      tornado's flyer, the tsunami's debris field, the flood's floating body,
      the meteor's blast wave, the sinkhole's throat, the hurricane's shove)
      sets the record's `flung` flag, which on these records IS take() /
      release(): the car is woken out of the pools, its driver put out, it is
      billed as a wreck, and the vehicle system stops seating it while the
      disaster has it. Fire (wildfire.js -> CBZ.cityCarIgnite: the vehicle's
      own burn and cook-off), blasts (impactbus.js) and falling buildings
      (collapse.js crushCars) already were the vehicle's own damage paths.
      The rest pose (x, z, oy, rotY: what the quake's rattle and the
      hurricane's rocking swing a parked car about) follows the car wherever
      it is left.

      WHILE YOU DRIVE ONE it leaves arena.cars (no disaster may snatch the car
      you are steering back to where it was parked), and the island's weather
      acts on the chassis itself instead (drivenWeather): the hurricane's and
      the tornado's wind push it through its tyres, an EF2+ core lifts it into
      the air on the same law tornado.js uses for a parked car, flood water
      past two feet takes its grip and floods the engine.

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
   this puts the machines back).
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CFG.ISLAND_HELIPAD == null) CFG.ISLAND_HELIPAD = true;

  /* THE WORLDS THESE MACHINES SERVE: the disaster island, and every island of
     the archipelago (world/archipelago.js swaps CBZ.surv.arena as you cross
     to the next one; setup() below follows it). A record is tagged with the
     world it was built in (config.js CBZ.vehicleInWorld). */
  const WORLDS = { survival: 1, archipelago: 1 };
  // the archipelago's own machines, island to island: the jet on the
  // airstrip and the speedboat on the quay (world/island_plan.js airstrip,
  // the harbour's quay face). Not on the disaster island.
  function islandHopping() { return g && g.mode === "archipelago"; }
  const CAR_REACH = 1.6;           // m from the car's flank to offer "Drive"
  const HELI_REACH = 4.2;          // m from the cabin to offer "Board"
  const PAD_RISE = 3.0;            // deck walk surface over the roof walk surface (clears the lift car)
  const DECK_T = 0.25;             // deck slab thickness
  // a small island town's fleet: catalog names (city/economy.js), one per body kind
  const TOWN_MODELS = ["Kotori Sprout", "Bison Vista", "Bison Frontier", "Bison Rampart"];
  const PHONE = (CBZ.deviceClass || "") === "phone";
  const BUILD_PER_FRAME = PHONE ? 2 : 5;   // cars stood up per frame (a car is a few ms to build)
  const REST_MOVE = 0.6;           // m a parked car must be moved before its rest pose follows it

  // the live state, rebuilt per match
  const S = {
    arena: null,                   // the surv.arena the machines were built for
    stats: null,                   // surv.stats identity (a new object = a new match)
    cars: [],                      // { car, spot, out } one per standing vehicle
    queue: [],                     // spots still to stand a car on
    pad: null,                     // the helipad record (built once per arena)
    heli: null,                    // the parked craft
    jet: null,                     // the archipelago's parked jet (the airstrip)
    boats: [],                     // { car, spot } the archipelago's speedboat on the quay
    fallenSeen: new Set(),         // towers already handled as fallen this match
    armCar: null, armHeli: null,   // what the pinned verb would act on
    drivenLift: 0, drivenFloat: 0, // driven-car weather state
    heliAsh: 0,
  };

  function on() { return g && !!WORLDS[g.mode] && CBZ.surv && CBZ.surv.arena; }
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
     1. THE FLEET
     ============================================================ */
  // a car you can still get into and drive away
  function drivable(c) { return !!(c && !c.dead && !c._husk && !c._disaster && !c._wrecked && !c._scrapped && !c._flooded); }

  /* THE RECORD'S ISLAND HALF. What every disaster has always read off an
     island car: its rest pose (x, z, oy, rotY), a collider (none: the vehicle
     is solid through the car resolvers in physics.js and vehicles.js) and the
     `flung` flag, which on a vehicle IS the disaster door. */
  function dressRecord(car, spot) {
    car._world = g.mode;
    car.owned = true;                 // an island car is anybody's: no theft, no witnesses
    car._islandCar = true;
    car._islandSpot = spot;
    car.ai = false;
    car.x = spot.x; car.z = spot.z; car.oy = spot.y; car.rotY = spot.heading;
    car.collider = null;
    const d = car.dims || {};
    car.roofH = +d.height || 1.45;
    Object.defineProperty(car, "flung", {
      configurable: true, enumerable: true,
      get: function () { return !!car._disaster; },
      set: function (v) {
        const D = CBZ.vehicleDisaster;
        if (!D) return;
        if (v) D.take(car, cause("wrecked by the disaster")); else D.release(car);
      },
    });
  }
  function standCar(spot) {
    if (!CBZ.cityAddParkedCar) return null;
    // (a dealer's spot names its own model: world/island_dealers.js, island_lots.js)
    const model = spot.model || TOWN_MODELS[(hash01(spot.x, spot.z, 11) * TOWN_MODELS.length) | 0];
    let car = null;
    try { car = CBZ.cityAddParkedCar(spot.x, spot.z, spot.heading, { force: true, modelName: model, color: spot.color }); } catch (e) { car = null; }
    if (!car) return null;
    dressRecord(car, spot);
    homeCar(car, spot);
    return car;
  }
  // stand it back on its spot, as parked (the parked pass re-seats it on the ground)
  function homeCar(car, spot) {
    car.heading = spot.heading;
    car.v = 0; car.vx = 0; car.vz = 0; car.wreckT = 0; car.spin = 0;
    if (car.group) {
      car.group.position.set(spot.x, spot.y, spot.z);     // car.pos IS this vector
      car.group.rotation.set(0, spot.heading, 0);
      car.group.scale.set(1, 1, 1);
    }
    car.x = spot.x; car.z = spot.z; car.oy = spot.y; car.rotY = spot.heading;
    // a showroom car stands on the tiles, not on the ground under the floor:
    // seat it there and leave it (the parked pass re-seats only a car that moved)
    if (spot.floor) { car._parkX = spot.x; car._parkZ = spot.z; car._parkH = spot.heading; car._terrY = spot.y; car._terrPitch = car._terrRoll = 0; }
    else { car._parkX = car._parkZ = car._parkH = null; car._terrY = car._terrPitch = car._terrRoll = null; }
  }
  // still exactly the car the spot was given: nothing hit, burnt, moved or drove it
  function pristine(car, spot, A) {
    if (!car || car._scrapped || car._reap || car.dead || car._husk || car._exploded || car._disaster || car._disasterTouched) return false;
    if (car._everDriven || car._playerLeft || car._wrecked || car._flats || car._wf || car._onFire || car._smoking) return false;
    if (car.crumple > 0 || (car.engineHp != null && car.engineHp < 100)) return false;
    if (!car.group || car.group.parent !== A.root || CBZ.cityCars.indexOf(car) < 0) return false;
    return Math.abs(car.pos.x - spot.x) < 0.05 && Math.abs(car.pos.z - spot.z) < 0.05;
  }
  function scrapCar(car) {
    if (!car) return;
    if (CBZ.cityScrapCar) { try { CBZ.cityScrapCar(car); return; } catch (e) {} }
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    const i = CBZ.cityCars.indexOf(car); if (i >= 0) CBZ.cityCars.splice(i, 1);
  }
  // keep: the one machine the player is in (crossing to the next island in it)
  function scrapFleet(keep) {
    for (let i = 0; i < S.cars.length; i++) if (S.cars[i].car !== keep) scrapCar(S.cars[i].car);
    S.cars.length = 0; S.queue.length = 0; held.length = 0;
    if (S.arena && S.arena.cars) S.arena.cars.length = 0;
    for (let i = 0; i < S.boats.length; i++) if (S.boats[i].car !== keep) scrapCar(S.boats[i].car);
    S.boats.length = 0;
  }
  /* A NEW MATCH: every untouched car is put back on its spot as it stands;
     every car the last match touched (thrown, floated, burnt, crushed,
     dented, driven off) is scrapped through the vehicle system's own door and
     its spot queued for a fresh one. A new island: every spot is queued. */
  function resetFleet(A) {
    const spots = A.carSpots || [];
    const keep = [];
    const have = new Set();
    for (let i = 0; i < S.cars.length; i++) {
      const r = S.cars[i];
      if (pristine(r.car, r.spot, A)) { homeCar(r.car, r.spot); r.out = false; keep.push(r); have.add(r.spot); }
      else scrapCar(r.car);
    }
    S.cars = keep;
    if (A.cars) { A.cars.length = 0; for (let i = 0; i < keep.length; i++) A.cars.push(keep[i].car); }
    S.queue = spots.filter(function (s) { return !have.has(s); });
    held.length = 0;
    // nearest the player first: the street you are standing in is real at once
    const Pl = P(), px = Pl && Pl.pos ? Pl.pos.x : 0, pz = Pl && Pl.pos ? Pl.pos.z : 0;
    S.queue.sort(function (a, b) { return ((b.x - px) * (b.x - px) + (b.z - pz) * (b.z - pz)) - ((a.x - px) * (a.x - px) + (a.z - pz) * (a.z - pz)); });
    // (cars live outside CBZ.colliders: nothing here for the collider grid)
  }
  // a few cars a frame off the end of the queue (the nearest is last)
  /* A SOLD SPOT STAYS SOLD. A dealer's spot whose car you bought (your car
     standing on it, or bought off it today: world/island_dealers.js
     spotTaken) gets no new car on top of yours; it waits here and is
     restocked only once it is empty and nobody is looking at it. */
  const held = [];
  let heldT = 0;
  function spotTaken(spot) {
    const D = CBZ.islandDealers;
    return !!(spot && spot.sale && D && D.spotTaken && D.spotTaken(spot));
  }
  function restockHeld(dt) {
    if (!held.length || (heldT += dt) < 2) return;
    heldT = 0;
    for (let i = held.length - 1; i >= 0; i--) {
      const s = held[i];
      if (spotTaken(s)) continue;
      if (CBZ.leave && CBZ.leave.unseen && !CBZ.leave.unseen({ x: s.x, y: s.y, z: s.z })) continue;
      held.splice(i, 1);
      S.queue.push(s);
    }
  }
  function buildSome() {
    const A = S.arena;
    if (!A || !S.queue.length || !CBZ.cityAddParkedCar) return;
    // (a car is a few ms on a desktop and 25-40 on a phone-class core: the
    // next one waits for the next frame once this frame's cars took 2 ms)
    const t0 = performance.now();
    for (let n = 0; n < BUILD_PER_FRAME && S.queue.length; n++) {
      if (n > 0 && performance.now() - t0 > 2) break;
      const spot = S.queue.pop();
      if (spotTaken(spot)) { held.push(spot); continue; }
      const car = standCar(spot);
      if (!car) continue;
      S.cars.push({ car: car, spot: spot, out: false });
      if (A.cars) A.cars.push(car);
    }
  }
  /* THE SPEEDBOAT (archipelago): broadside to the quay face between the
     marina jetties and the cargo pier, where a man on the quay steps down
     into it. A real cityCars record (city/vehicles.js) on the hull model
     the city sells, driven by world/water_helm.js and floated by
     world/water_buoyancy.js, exactly as a city boat. */
  function boatSpot(A) {
    const P0 = A.plan;
    if (!P0 || !P0.harbour || !P0.harbour.quay) return null;
    const Q = P0.harbour.quay, K = P0.K || 1;
    const x = P0.cx + 26 * K, z = Q.z1 + 1.9;
    if (x < Q.x0 + 4 || x > Q.x1 - 4) return null;
    return { x: x, z: z, y: A.oceanY != null ? A.oceanY : -0.8, heading: Math.PI / 2, boat: true };
  }
  function standBoat(spot) {
    if (!CBZ.cityAddParkedCar) return null;
    let car = null;
    try { car = CBZ.cityAddParkedCar(spot.x, spot.z, spot.heading, { force: true, modelName: "Speedboat" }); } catch (e) { car = null; }
    if (!car) return null;
    car._world = g.mode;
    car.owned = true;
    car._islandCar = true;
    car._islandBoat = true;
    car.ai = false;
    if (car.group) car.group.position.set(spot.x, spot.y, spot.z);
    return car;
  }

  // the driven car is out of the arena list, so no disaster writes its group
  function liftEntry(r) {
    const A = S.arena; if (!A || !A.cars || r.out) return;
    const i = A.cars.indexOf(r.car);
    if (i >= 0) { A.cars.splice(i, 1); r.out = true; }
  }
  function restoreEntry(r) {
    const A = S.arena; if (!A || !A.cars || !r.out) return;
    if (A.cars.indexOf(r.car) < 0) A.cars.push(r.car);
    r.out = false;
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
    const driven = Pl && Pl.driving ? Pl._vehicle : null;
    for (let i = S.cars.length - 1; i >= 0; i--) {
      const r = S.cars[i], car = r.car;
      // a husk the vehicle system retired, a car scrapped: gone until the next match
      if (car._scrapped || car._reap) {
        S.cars.splice(i, 1);
        const A = S.arena, k = A && A.cars ? A.cars.indexOf(car) : -1;
        if (k >= 0) A.cars.splice(k, 1);
        continue;
      }
      if (car === driven) { liftEntry(r); drivenWeather(r, dt); continue; }
      if (r.out) restoreEntry(r);
      if (car._disaster || car._husk) continue;
      // left somewhere else (driven off and parked, shoved): its rest pose follows,
      // once it has come to a stop (never the few cm a rattle swings it)
      const p = car.pos;
      if (!(car.wreckT > 0) && !car.v && (Math.abs(p.x - car.x) > REST_MOVE || Math.abs(p.z - car.z) > REST_MOVE)) {
        car.x = p.x; car.z = p.z; car.oy = p.y; car.rotY = car.heading || 0;
      }
    }
  }

  // a tower coming down takes its helipad (the cars under it are crushed by
  // city/collapse.js crushCars, the vehicle system's own crush)
  function fallenTick() {
    const A = S.arena; if (!A || !A.fragile || !S.pad) return;
    const b = S.pad.b;
    if (b.fallen && !S.fallenSeen.has(b)) { S.fallenSeen.add(b); dropPad(); }
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
    // (everything above was PUSHED: the broadphase grids file a pushed tail
    // in place, where a dirty mark was a rebuild of every wall and floor on
    // the sea in the frame the island arrived)

    // merge nothing else: ~40 small meshes once per island; the island's
    // static freeze pass (core/staticfreeze.js) owns their matrices
    root.traverse(function (o) { o.matrixAutoUpdate = false; o.updateMatrix(); });
    root.updateMatrixWorld(true);

    return {
      b: b, e: e, root: root, plats: plats, cols: cols, owner: owner, flight: fl, dropped: false, listed: true,
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
    padLists(pad, false);
    if (CBZ.stairs && CBZ.stairs.setOwnerActive) CBZ.stairs.setOwnerActive(pad.owner, false);
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
    padLists(pad, true);
    if (CBZ.stairs && CBZ.stairs.setOwnerActive) CBZ.stairs.setOwnerActive(pad.owner, true);
  }
  /* The pad's floors and walls in or out of the world's lists, edited in the
     broadphase grids in place (a dirty mark rebuilt the whole sea's grids on
     every island arrival: raisePad runs on each one, pad standing or not). */
  function padLists(pad, on) {
    if (pad.listed === !!on) return;
    pad.listed = !!on;
    const PL = CBZ.platforms, CL = CBZ.colliders;
    if (on) {
      if (CBZ.platformAddMany) CBZ.platformAddMany(pad.plats); else for (const p of pad.plats) PL.push(p);
      if (CBZ.colliderAddMany) CBZ.colliderAddMany(pad.cols); else for (const c of pad.cols) CL.push(c);
      return;
    }
    if (CBZ.platformRemoveMany) CBZ.platformRemoveMany(pad.plats);
    else { for (const p of pad.plats) { const i = PL.indexOf(p); if (i >= 0) PL.splice(i, 1); } if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty(); }
    if (CBZ.colliderRemoveMany) CBZ.colliderRemoveMany(pad.cols);
    else { for (const c of pad.cols) { const i = CL.indexOf(c); if (i >= 0) CL.splice(i, 1); } if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
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
    if (!r || !Pl || Pl.dead || Pl.driving || !drivable(r.car)) return false;
    if (!CBZ.cityEnterVehicle) return false;
    const ok = CBZ.cityEnterVehicle(r.car);
    if (ok) { r.car._everDriven = true; liftEntry(r); }
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
    if (!Pl || !Pl.pos || Pl.dead || Pl.driving || Pl._aircraft || Pl._doorArc || Pl._swim) return;
    if (g.state !== "playing") return;
    const px = Pl.pos.x, py = Pl.pos.y, pz = Pl.pos.z;
    let best = null, bd = CAR_REACH;
    for (let i = 0; i < S.cars.length; i++) {
      const r = S.cars[i], c = r.car;
      // ~90 cars: a box reject first, the car's own OBB only for the few in reach
      if (Math.abs(c.pos.x - px) > 5 || Math.abs(c.pos.z - pz) > 5) continue;
      if (!drivable(c) || c.player || !c.group) continue;
      if (Math.abs(c.pos.y - py) > 1.6) continue;
      const gap = carGap(c, px, pz);
      if (gap < bd) { bd = gap; best = r; }
    }
    // a boat lies a step down off the quay (or alongside you in the shallows)
    for (let i = 0; i < S.boats.length; i++) {
      const r = S.boats[i], c = r.car;
      if (!c || !c.pos || Math.abs(c.pos.x - px) > 8 || Math.abs(c.pos.z - pz) > 8) continue;
      if (!drivable(c) || c.player || !c.group) continue;
      if (Math.abs(c.pos.y - py) > 2.4) continue;
      const gap = carGap(c, px, pz);
      if (gap < Math.max(bd, 2.2)) { bd = gap; best = r; }
    }
    if (best) {
      S.armCar = best;
      const c = best.car;
      // the verb is armed by reach alone; the pill is how it is shown (and tapped)
      if (CBZ.prisonPrompt) CBZ.prisonPrompt("island-car-drive", "@islandCarDrive", "Drive",
        { at: { x: c.pos.x, y: c.pos.y + 1.7, z: c.pos.z }, key: "e", bind: true, d2: bd * bd });
    }
    // the helicopter, and the archipelago's jet: whichever you stand at
    let hb = null, hd = 1e9;
    for (const h of [S.heli, S.jet]) {
      if (!h || h.destroyed || !h.group || h.group.visible === false) continue;
      const dy = (h.pos.y - (h.groundOffset || 0)) - py;
      const d = Math.hypot(h.pos.x - px, h.pos.z - pz);
      if (d < HELI_REACH && Math.abs(dy) < 1.4 && d < hd) { hd = d; hb = h; }
    }
    if (hb) {
      S.armHeli = hb;
      if (CBZ.prisonPrompt) CBZ.prisonPrompt("island-heli-board", "@islandHeliBoard", "Board",
        { at: { x: hb.pos.x, y: hb.pos.y + 1.2, z: hb.pos.z }, key: "e", bind: true, d2: Math.max(0.01, (hd - 2) * (hd - 2)) });
    }
  }

  /* ============================================================
     LIFECYCLE
     ============================================================ */
  // the pad of an island being left: its deck, walls and stair go with it
  function retirePad() {
    const pad = S.pad;
    S.pad = null;
    if (!pad) return;
    if (pad.root && pad.root.parent) pad.root.parent.remove(pad.root);
    // its deck, girders and lights leave the GPU too (the island it stood on
    // is walked for its buffers later, and the pad is no longer under it)
    if (pad.root && CBZ.freeTree) { try { CBZ.freeTree(pad.root); } catch (e) {} }
    padLists(pad, false);
    if (CBZ.stairs && CBZ.stairs.removeOwner) CBZ.stairs.removeOwner(pad.owner);
  }
  function parkJet(A) {
    const st = A.airstrip && A.airstrip.stand;
    if (!st || !CBZ.airParkFlyable) return null;
    // the F-35A (playeraircraft.js buildJet: the units/vehicles airframe),
    // unarmed, its bays shut; null while its file is still loading
    return CBZ.airParkFlyable({ kind: "jet", x: st.x, y: A.airstrip.deck, z: st.z, heading: st.heading, name: "F-35A" });
  }
  function setup() {
    const A = CBZ.surv.arena;
    const Pl = P();
    const flown = Pl && Pl._aircraft ? Pl._aircraft : null;
    const ridden = Pl && Pl.driving ? Pl._vehicle : null;
    if (S.arena !== A) {
      // a new island (first match, a rebuilt arena, or the next island of the
      // archipelago): the pad, the fleet, the jet and the boat are per arena.
      // The machine you are in comes with you; the rest of the last island's go.
      retirePad();
      scrapFleet(ridden);
      // the boat you crossed in is this island's boat now: it moves under the
      // new island's root (vehicles.js retires a parked fixture whose root
      // is not the live one) and is tracked with its machines
      if (ridden && ridden._islandCar) {
        ridden._arenaRoot = A.root;
        if (ridden.group && A.root && ridden.group.parent !== A.root) A.root.add(ridden.group);
        if (ridden._islandBoat) S.boats.push({ car: ridden, spot: null, out: false });
      }
      if (flown && flown.group && A.root && flown.group.parent !== A.root) A.root.add(flown.group);
      if (S.heli && S.heli !== flown) unparkHeli();
      if (S.jet && S.jet !== flown) { if (CBZ.airUnpark) { try { CBZ.airUnpark(S.jet); } catch (e) {} } S.jet = null; }
      S.arena = A;
      if (CFG.ISLAND_HELIPAD !== false) { try { S.pad = buildPad(A); } catch (e) { console.error("[island helipad]", e); S.pad = null; } }
    }
    if (S.pad) { if (S.pad.b.fallen) dropPad(); else raisePad(); }
    try { resetFleet(A); } catch (e) { console.error("[island cars]", e); }
    // (a helicopter you are flying stays yours: no second one on the new pad)
    if (S.pad && !S.pad.dropped && !(S.heli && S.heli === flown)) { try { S.heli = parkHeli(); } catch (e) { console.error("[island heli]", e); S.heli = null; } }
    if (islandHopping()) {
      if (!(S.jet && S.jet === flown) && A.airstrip) {
        if (S.jet && CBZ.airUnpark) { try { CBZ.airUnpark(S.jet); } catch (e) {} }
        try { S.jet = parkJet(A); } catch (e) { console.error("[island jet]", e); S.jet = null; }
      }
      if (!(ridden && ridden._islandBoat) && !S.boats.length) {
        const sp = boatSpot(A);
        const b = sp ? standBoat(sp) : null;
        if (b) S.boats.push({ car: b, spot: sp, out: false });
      }
    }
    S.fallenSeen.clear();
    S.drivenLift = 0; S.drivenFloat = 0;
  }
  function teardown() {
    const Pl = P();
    if (Pl && Pl._aircraft && S.heli && Pl._aircraft === S.heli && CBZ.cityPlayerAircraftExit) {
      try { CBZ.cityPlayerAircraftExit(); } catch (e) {}
    }
    if (Pl && Pl.driving && Pl._vehicle && Pl._vehicle._islandCar && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
    unparkHeli();
    if (S.jet && CBZ.airUnpark) { try { CBZ.airUnpark(S.jet); } catch (e) {} }
    S.jet = null;
    // a new match puts the boat back on the quay (setup stands a fresh one)
    for (let i = 0; i < S.boats.length; i++) scrapCar(S.boats[i].car);
    S.boats.length = 0;
  }

  // before the driven car (11) and the flight (12) read their inputs
  CBZ.onUpdate(10.95, function (dt) {
    if (!on()) {
      // leaving the island in a seat: out first (a world switch never keeps you in an island machine)
      const Pl = P();
      if (Pl && Pl.driving && Pl._vehicle && Pl._vehicle._islandCar && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
      return;
    }
    const st = CBZ.surv.stats;
    if (st !== S.stats || S.arena !== CBZ.surv.arena) {
      if (S.stats) teardown();
      S.stats = st;
      setup();
    }
    buildSome();
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    // THE RUNWAY'S F-35 ARRIVES WITH ITS FILE. The jet is the units/vehicles
    // F-35A, which loads on demand: until it is on the page parkJet answers
    // null (and has asked for it), so ask again once a second.
    if (islandHopping() && !S.jet && S.arena && S.arena.airstrip && (S.jetT = (S.jetT || 0) - dt) <= 0) {
      S.jetT = 1;
      try { S.jet = parkJet(S.arena); } catch (e) { console.error("[island jet]", e); S.jet = null; S.jetT = 30; }
    }
    restockHeld(dt);
    const Pl = P();
    // dead at the wheel: out, so the death's own fall plays (physics.js
    // yields the body to a vehicle while P.driving)
    if (Pl && Pl.dead && Pl.driving && Pl._vehicle && Pl._vehicle._islandCar && CBZ.cityExitVehicle) {
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

  /* CBZ.islandCarsAudit() — is every island car standing, and DRAWN? No
     node, no tool: one call in the page. A car is drawn by itself (its group
     and every parent visible, in the scene), or by the vehicle system's pools
     (_proxy: carinstances.js holds it in a live instanced mesh), or it is
     asleep past the fog (hidden on purpose). Anything else is `hidden`: a car
     nobody draws. belowGround: its wheels more than 0.3 m inside the island. */
  function shownInScene(o) {
    let n = o, top = null;
    while (n) { if (n.visible === false) return false; top = n; n = n.parent; }
    return !!(top && top.isScene);
  }
  CBZ.islandCarsAudit = function () {
    const A = S.arena, cam = CBZ.camera && CBZ.camera.position;
    const out = { spots: A && A.carSpots ? A.carSpots.length : 0, built: S.cars.length, queued: S.queue.length,
      inArena: A && A.cars ? A.cars.length : 0, visibleNear: 0, near: 0, drawnSelf: 0, pooled: 0, asleep: 0, held: 0,
      hidden: 0, belowGround: 0, hiddenSample: [], props: 0,
      pools: CBZ.carInstanceAudit ? CBZ.carInstanceAudit() : null };
    for (let i = 0; i < S.cars.length; i++) {
      const c = S.cars[i].car, g0 = c.group;
      const d = cam ? Math.hypot(c.pos.x - cam.x, c.pos.z - cam.z) : 0;
      const self = !!(g0 && shownInScene(g0));
      if (c._disaster) out.held++;
      if (self) out.drawnSelf++;
      else if (c._proxy) out.pooled++;
      else if (c._sleep) out.asleep++;
      else { out.hidden++; if (out.hiddenSample.length < 5) out.hiddenSample.push({ x: Math.round(c.pos.x), z: Math.round(c.pos.z), d: Math.round(d), vis: g0 ? g0.visible : null, parent: !!(g0 && g0.parent), deferred: !!c._deferred, kids: g0 ? g0.children.length : 0 }); }
      if (d < 80) { out.near++; if (self || c._proxy) out.visibleNear++; }
      if (c.pos.y < groundAt(c.pos.x, c.pos.z) - 0.3) out.belowGround++;
    }
    return out;
  };

  // ---- what the lab and the tools read ----
  CBZ.islandVehicles = {
    state: function () {
      const Pl = P();
      const A = S.arena;
      return {
        // THE COUNT THE OWNER ASKED FOR: every parked car is a vehicle record;
        // the island builds no prop car at all (props is a constant 0)
        fleet: { spots: A && A.carSpots ? A.carSpots.length : 0, real: S.cars.length, props: 0, queued: S.queue.length,
          inArena: A && A.cars ? A.cars.length : 0,
          asleep: S.cars.filter(function (r) { return r.car._sleep; }).length,
          pooled: S.cars.filter(function (r) { return r.car._proxy; }).length,
          held: S.cars.filter(function (r) { return r.car._disaster; }).length },
        cars: S.cars.map(function (r) {
          return { x: +r.car.pos.x.toFixed(2), z: +r.car.pos.z.toFixed(2), dead: !!r.car.dead, wrecked: r.car._wrecked || null,
            held: r.car._disaster || null, driven: !!(Pl && Pl._vehicle === r.car), model: r.car.model ? r.car.model.name : null };
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
    jet: function () { return S.jet; },
    boats: function () { return S.boats.map(function (r) { return r.car; }); },
    pad: function () { return S.pad; },
    rebuild: function () { if (S.stats) teardown(); scrapFleet(); S.stats = null; },
    // the island world is going away (world/archipelago.js leaving its mode):
    // every machine, the pad and its stair go with it
    arenaOf: function () { return S.arena; },
    leave: function () {
      teardown();
      scrapFleet();
      retirePad();
      S.arena = null; S.stats = null; S.armCar = null; S.armHeli = null;
    },
  };
})();
