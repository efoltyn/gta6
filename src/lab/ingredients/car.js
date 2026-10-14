/* lab ingredient "car": a REAL Gang City car on the lab floor, driven by the
   REAL chassis.

   WHAT IS REAL
     model    city/economy.js's catalog (CBZ.cityEcon.carByName), built by
              city/vehicles.js CBZ.cityMakeCar -> buildCar -> city/playercars.js
              (the shipped lofted body, wheels, glass, interior, occupants)
     record   the car record cityMakeCar pushes onto CBZ.cityCars: pos /
              heading / v / vx / vz / dims / mass. Everything that looks for
              cars (systems/pushables.js carHit, runOver, the brain's hearing)
              sees it exactly as it sees traffic.
     chassis  city/cardyn.js (CBZ.carDyn): tyres, friction circle, gearbox,
              load transfer, fed by vehicles.js's own feel record
              (CBZ.cityCarDynamics, published for this) for the car's body kind
     walls    vehicles.js CBZ.cityCollideVehicle: the OBB swept resolver the
              driven car uses (loose chairs are skipped by it on purpose:
              pushables flings them)

   WHAT IS THE LAB'S (the stubs, each the smallest that stands in)
     CBZ.city.arena.root   cityMakeCar parents the car under the city arena's
                           root; the lab gives it the lab's host group. Only
                           `root` (and an empty roads list) exist: every city
                           updater in vehicles.js is gated on mode === "city",
                           and the lab runs mode "lab", so none of them run.
     the pedals            the per-frame loop below is the shape of
                           vehicles.js's player-driven loop (onUpdate 11:
                           pedals -> carDyn.step -> write car.v / heading /
                           vx / vz -> integrate -> collide) without the player,
                           the camera, audio, skids and seat: a cruise
                           controller holds `speed` with the throttle, `brake()`
                           stands on the brake. No traffic AI: there is no road.
     ground                y = 0 (the lab floor), no terrain seat.

   opts: at [x, z], heading (deg; forward = (sin h, cos h)), model (catalog
         name, default "Bison Vista"), speed (m/s cruise target, default 0)
   handle: drive(mps), brake(), coast(), state() */
CBZ.lab.ingredient("car", {
  /* the model's files are named by hand: playercars.js reads CBZ.carWheels /
     carParts inside its builders (runtime edges), and the car-chair kit runs
     at depth 0 (load-time edges only; see the kit for why), so the tracer
     would not follow them on its own */
  files: ["src/world/carfx.js", "src/city/economy.js", "src/city/carbody.js", "src/city/carwheels.js", "src/city/carparts.js",
    "src/city/playercars.js", "src/city/cardyn.js", "src/city/vehicles.js"],
  make: function (W, o) {
    const THREE = window.THREE;
    const at = o.at || [0, -10];
    const host = W.root || (W.root = (function () { const g = new THREE.Group(); g.name = "labHost"; W.scene.add(g); return g; })());
    // THE STUB: the arena root cityMakeCar adds the car under
    const city = CBZ.city || (CBZ.city = {});
    if (!city.arena) city.arena = { root: host, roads: [], lab: true };
    if (!CBZ.cityMakeCar) throw new Error("CBZ.cityMakeCar missing (city/vehicles.js not loaded)");
    const model = (CBZ.cityEcon && CBZ.cityEcon.carByName && CBZ.cityEcon.carByName(o.model || "Bison Vista")) || null;
    const heading = (o.heading || 0) * Math.PI / 180;
    const car = CBZ.cityMakeCar(at[0], at[1], heading, false, model, 0.3);
    car.ai = false;                 // nobody's traffic: no road, no lane
    car.labName = o.name;
    const CD = CBZ.carDyn;
    const kind = CBZ.cityVehicleBodyKind ? CBZ.cityVehicleBodyKind(car.model) : "sedan";
    const ctl = { target: +o.speed || 0, mode: "cruise", throttle: 0, brake: 0, steer: 0 };
    const In = { throttle: 0, brake: 0, handbrake: false, steer: 0, air: false, flatPull: 0 };
    let walls = 0, wallT = null, maxV = 0;
    const L = function (v) { return Math.round(v * 1000) / 1000; };

    function step(dt) {
      // a car the wind has taken (systems/tornado.js) is a body, not a
      // vehicle: the controller yields, as vehicles.js's `ai` gate does
      if (car.dead || !CD || car._twWreck) return;
      // pedals
      const v = car.v || 0;
      // brake: stand on it until stopped, then hold (cardyn reads a brake
      // pedal at a standstill as REVERSE, like the game's S key)
      if (ctl.mode === "brake") { ctl.throttle = 0; ctl.brake = Math.abs(v) > 0.25 ? 1 : 0; if (!ctl.brake) { car.v = 0; car.vx = 0; car.vz = 0; car._yawRate = 0; } }
      else if (ctl.mode === "coast") { ctl.throttle = 0; ctl.brake = 0; }
      else {
        const err = ctl.target - v;
        ctl.throttle = err > 0 ? Math.min(1, err * 0.6) : 0;
        ctl.brake = err < -1.5 ? Math.min(1, -err * 0.3) : 0;
      }
      In.throttle = ctl.throttle; In.brake = ctl.brake; In.steer = ctl.steer;
      // the chassis, synced from whatever the world did to the car (the same
      // three lines as vehicles.js's driven loop)
      const D = CBZ.cityCarDynamics ? CBZ.cityCarDynamics(car) : { accel: 32, top: 35, turn: 2.6, grip: 7.4, brake: 32, wheelbase: 2.62, steerLock: 0.56 };
      const S = car._dyn || (car._dyn = CD.newState());
      const P = car._dynP = CD.params(D, kind, car._dynP);
      const h0 = car.heading || 0, sh0 = Math.sin(h0), ch0 = Math.cos(h0);
      S.heading = h0;
      S.vx = car.v || 0;
      S.vy = car.vx == null ? 0 : car.vx * ch0 - car.vz * sh0;
      if (!Number.isFinite(S.vy)) S.vy = 0;
      if (Number.isFinite(car._yawRate)) S.r = car._yawRate;
      CD.step(S, In, P, dt);
      car.heading = S.heading; car.v = S.vx; car._yawRate = S.r;
      car._gear = S.gear; car._rev = S.rpm;
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      car.vx = fx * S.vx + fz * S.vy; car.vz = fz * S.vx - fx * S.vy;
      car.pos.x += car.vx * dt; car.pos.z += car.vz * dt;
      car.pos.y = 0;
      if (CBZ.cityCollideVehicle) {
        const push = CBZ.cityCollideVehicle(car);
        if (push > 0.01) { walls++; if (wallT == null) wallT = W.t(); }
      }
      if (car.group) car.group.rotation.y = car.heading;
      const sp = Math.hypot(car.vx, car.vz);
      if (sp > maxV) maxV = sp;
    }
    W.every(function (dt) { step(dt); });

    const h = {
      car: car, obj: car.group,
      drive: function (mps) { ctl.mode = "cruise"; ctl.target = +mps; },
      brake: function () { ctl.mode = "brake"; },
      coast: function () { ctl.mode = "coast"; },
      steer: function (s) { ctl.steer = Math.max(-1, Math.min(1, +s || 0)); },
      speed: function () { return Math.hypot(car.vx || 0, car.vz || 0); },
      state: function () {
        return {
          model: car.model ? car.model.name : null, body: kind,
          visual: (car.group && car.group.userData.carStyle) || "box fallback (playercars.js absent)",
          pos: [L(car.pos.x), L(car.pos.y), L(car.pos.z)], headingDeg: L(car.heading * 180 / Math.PI),
          speed: L(h.speed()), v: L(car.v || 0), maxSpeed: L(maxV), gear: car._gear,
          throttle: L(ctl.throttle), brake: L(ctl.brake), mode: ctl.mode, target: ctl.target,
          wallContacts: walls, firstWallAt: wallT, dims: car.dims ? { w: L(car.dims.width || 0), l: L(car.dims.length || 0) } : null,
          inCityCars: (CBZ.cityCars || []).indexOf(car) >= 0,
        };
      },
      watch: {
        speed: function () { const s = h.speed(); return s < 0.3 ? "stopped" : s < 3 ? "creeping" : s < 7 ? "<7 m/s" : s < 12 ? "7-12 m/s" : ">12 m/s"; },
        pedal: function () { return ctl.mode; },
        wall: function () { return walls ? "hit a wall" : null; },
      },
    };
    return h;
  },
});
