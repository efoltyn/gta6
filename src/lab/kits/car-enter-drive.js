/* lab kit "car-enter-drive": walk up to one of the disaster island's real
   cars, get in, drive it 100 m down its street, stop, get out.

   Everything is the game's: the island (world/disaster_arena.js through
   modes/survival.js), its real cars (world/island_vehicles.js on
   city/vehicles.js CBZ.cityAddParkedCar), the "Drive" verb pinned on the car
   (CBZ.islandCarDrive is what [E] / a tap on the pill calls), the driven
   chassis (vehicles.js order 11 on city/cardyn.js, opened to the island by
   config.js CBZ.VEHICLE_MODES), the cars-are-solid resolver and the seat
   exit (systems/seat_exit.js CBZ.seatExit, what [E] / #tExit calls).

   The driver is a little autopilot holding the real keys: W/S as a cruise
   control on `speed`, A/D to hold the kerb lane it started in. The car is
   picked as the one with the longest clear run ahead of it (sampled against
   the colliders and the other cars), so the kit tests driving, not a wall.

   lab.html?kit=car-enter-drive&dist=100&speed=14
   probe(): verb armed at the door, in the seat, metres driven, top speed,
   seconds to the distance, wall contacts, out of the seat beside the door on
   the ground, the player's hp. ok = all of it. */
(function () {
"use strict";

function clearRun(A, car, max) {
  const h = car.heading || 0, fx = Math.sin(h), fz = Math.cos(h), sx = Math.cos(h), sz = -Math.sin(h);
  const cols = CBZ.colliders || [], cars = CBZ.cityCars || [];
  const L = ((car.dims && car.dims.length) || 4.5) / 2;
  for (let d = L + 0.5; d < max; d += 1) {
    for (let k = -1; k <= 1; k++) {
      const x = car.pos.x + fx * d + sx * k * 1.1, z = car.pos.z + fz * d + sz * k * 1.1;
      const gy = A.groundHeightAt(x, z);
      if (!(gy > 0.05)) return d;                                    // the sea
      if (Math.abs(gy - car.pos.y) > 1.2) return d;                  // a bank or a step
      const y = gy + 0.8;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        if (c.y0 != null && (y < c.y0 || y > c.y1)) continue;
        return d;
      }
      for (let i = 0; i < cars.length; i++) {
        const o = cars[i];
        if (o === car || o.dead || (o._world && o._world !== "survival")) continue;
        if (Math.hypot(o.pos.x - x, o.pos.z - z) < 2.4) return d;
      }
    }
  }
  return max;
}

CBZ.lab.kit("car-enter-drive", {
  about: "walk up to a real island car, Drive (E), 100 m down the street on the real chassis, stop, get out",
  uses: ["island", "player"],
  mode: "survival",
  params: { dist: 100, speed: 14 },
  duration: 45,
  setup: function (W, P) {
    const I = W.add("island", { name: "island" });
    const pl = W.add("player", { name: "player", at: [I.arena.center.x, I.arena.center.z] });
    const A = I.arena, keys = CBZ.keys || (CBZ.keys = {});
    const DIST = +P.dist || 100, SPEED = +P.speed || 14;
    const M = W.marks = { phase: "boot", car: null, run: 0, armed: false, entered: false, enteredAt: null,
      odo: 0, maxV: 0, reachedAt: null, stoppedAt: null, exited: false, exitGap: null, exitDy: null,
      walls: 0, hp0: null, laneErrMax: 0, line: null, last: null, phaseT: 0, stalled: null };
    const Pl = pl.actor;
    function go(ph) { M.phase = ph; M.phaseT = 0; W.event("kit", ph); }
    W.every(function (dt) {
      M.phaseT += dt;
      const V = CBZ.islandVehicles;
      if (M.phase === "boot") {
        const cars = V ? V.cars() : [];
        if (!cars.length) { if (M.phaseT > 2) { M.stalled = "no real cars on the island"; go("done"); } return; }
        let best = null;
        for (const c of cars) { const r = clearRun(A, c, DIST + 40); if (!best || r > best.r) best = { c: c, r: r }; }
        M.car = best.c; M.run = Math.round(best.r);
        // stand at the driver's door (the car's local +X flank)
        const c = M.car, h = c.heading;
        const half = ((c.dims && c.dims.width) || 1.9) / 2;
        Pl.pos.set(c.pos.x + Math.cos(h) * (half + 0.7), c.pos.y, c.pos.z - Math.sin(h) * (half + 0.7));
        Pl.vy = 0; Pl.grounded = true;
        M.hp0 = Pl.hp;
        M.line = { x: c.pos.x, z: c.pos.z, fx: Math.sin(h), fz: Math.cos(h) };
        go("door");
        return;
      }
      if (M.phase === "door") {
        M.armed = !!(V.state().armed.car);
        if (M.phaseT > 0.3) {
          // what [E] on the pinned "Drive" calls
          if (CBZ.islandCarDrive()) { M.entered = true; M.enteredAt = +W.t().toFixed(2); go("seat"); }
          else if (M.phaseT > 2) { M.stalled = "Drive refused at the door"; go("done"); }
        }
        return;
      }
      const car = M.car;
      if (M.phase === "seat") {
        if (M.phaseT > 0.5) { M.last = { x: car.pos.x, z: car.pos.z }; go("drive"); }
        return;
      }
      if (M.phase === "drive" || M.phase === "brake") {
        if (!Pl.driving || Pl._vehicle !== car) { M.stalled = "lost the seat while driving"; keys.w = keys.s = keys.a = keys.d = false; go("done"); return; }
        const step = Math.hypot(car.pos.x - M.last.x, car.pos.z - M.last.z);
        M.odo += step; M.last.x = car.pos.x; M.last.z = car.pos.z;
        const v = Math.hypot(car.vx || 0, car.vz || 0);
        if (v > M.maxV) M.maxV = v;
        if (car._wallCD > 0.29) M.walls++;
        // the lane: hold the line the car started on
        const L = M.line;
        const lat = (car.pos.x - L.x) * L.fz - (car.pos.z - L.z) * L.fx;
        M.laneErrMax = Math.max(M.laneErrMax, Math.abs(lat));
        const hErr = Math.atan2(Math.sin(car.heading - Math.atan2(L.fx, L.fz)), Math.cos(car.heading - Math.atan2(L.fx, L.fz)));
        const steer = -(lat * 0.35 + hErr * 2.2);             // + = steer left (A)
        keys.a = steer > 0.08; keys.d = steer < -0.08;
        if (M.phase === "drive") {
          keys.w = v < SPEED - 0.8; keys.s = false;
          if (M.odo >= DIST) { M.reachedAt = +W.t().toFixed(2); go("brake"); }
          else if (M.phaseT > 30) { M.stalled = "never made the distance"; go("brake"); }
        } else {
          keys.w = false; keys.s = v > 0.4;
          if (v <= 0.4) { keys.s = keys.a = keys.d = false; M.stoppedAt = +W.t().toFixed(2); go("out"); }
          else if (M.phaseT > 8) { keys.s = false; M.stalled = "never stopped"; go("out"); }
        }
        return;
      }
      if (M.phase === "out") {
        if (M.phaseT > 0.4 && !M.exited) {
          if (CBZ.seatExit) CBZ.seatExit(); else if (CBZ.cityExitVehicle) CBZ.cityExitVehicle();
          M.exited = !Pl.driving;
        }
        if (M.exited && M.phaseT > 1.4) {
          M.exitGap = +Math.hypot(Pl.pos.x - car.pos.x, Pl.pos.z - car.pos.z).toFixed(2);
          M.exitDy = +(Pl.pos.y - A.groundHeightAt(Pl.pos.x, Pl.pos.z)).toFixed(3);
          go("done");
        }
      }
    });
  },
  probe: function (W, P) {
    const M = W.marks, Pl = CBZ.player, DIST = +P.dist || 100;
    const car = M.car;
    const out = {
      car: car ? (car.model && car.model.name) : null, clearRunAhead: M.run,
      verbArmedAtDoor: M.armed, entered: M.entered, enteredAt: M.enteredAt,
      metresDriven: +M.odo.toFixed(1), topSpeed: +M.maxV.toFixed(1), reachedAt: M.reachedAt,
      stoppedAt: M.stoppedAt, laneErrMax: +M.laneErrMax.toFixed(2), wallHits: M.walls,
      exited: M.exited && !Pl.driving, exitGap: M.exitGap, feetOverGround: M.exitDy,
      hp: Pl.hp, hp0: M.hp0, phase: M.phase, stalled: M.stalled,
    };
    out.ok = !!(M.armed && M.entered && M.odo >= DIST && M.exited && !Pl.driving &&
      M.exitGap != null && M.exitGap < 4 && Math.abs(M.exitDy) < 0.3 && !M.stalled);
    out.summary = (out.ok ? "PASS " : "FAIL ") + "entered " + (M.entered ? "yes" : "no") + ", drove " + out.metresDriven +
      " m (top " + out.topSpeed + " m/s), " + (out.exited ? "out " + out.exitGap + " m from the car" : "still in the seat") +
      (M.stalled ? " - " + M.stalled : "");
    return out;
  },
});
})();
