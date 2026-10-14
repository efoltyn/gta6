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
   control on `speed`, A/D to pull out and hold the street's centre line
   (the island parks against the kerb, 2.2 m off it, on the car's right, so
   the line is 2.2 m to its left: clear of every parked car), and where the
   street ahead is blocked (a junction's post, the sea) it turns onto the
   clearest cross street, slowing for the corner. The car is the one with the
   longest clear street ahead of it.

   lab.html?kit=car-enter-drive&dist=100&speed=14
   probe(): verb armed at the door, in the seat, metres driven, turns, top speed,
   seconds to the distance, wall contacts, out of the seat beside the door on
   the ground, the player's hp. ok = all of it. */
(function () {
"use strict";

const CENTRE = 2.2;   // world/disaster_arena.js CAR_OFF: kerb to centre line, toward the car's left (+X)
// metres of clear street from (x,z) along heading h: the sea, a bank, any
// collider at bumper-to-roof height, any other car, sampled every metre over a
// 2.4 m corridor at 0.3 m (a lamp post is 0.3 m)
function clearAhead(A, self, x0, z0, y0, h, max) {
  const fx = Math.sin(h), fz = Math.cos(h), sx = Math.cos(h), sz = -Math.sin(h);
  const cols = CBZ.colliders || [], cars = CBZ.cityCars || [];
  const sea = (A.oceanY != null ? A.oceanY : -0.5) + 0.1;
  for (let d = 0.5; d < max; d += 1) {
    for (let k = -4; k <= 4; k++) {
      const x = x0 + fx * d + sx * k * 0.3, z = z0 + fz * d + sz * k * 0.3;
      const gy = A.groundHeightAt(x, z);
      if (!(gy > sea) || Math.abs(gy - y0) > 1.2) return d;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        if (c.y0 != null && (gy + 0.5 > c.y1 || gy + 1.4 < c.y0)) continue;
        return d;
      }
      for (let i = 0; i < cars.length; i++) {
        const o = cars[i];
        if (o === self || o.dead || (o._world && o._world !== "survival")) continue;
        if (Math.hypot(o.pos.x - x, o.pos.z - z) < 2.4) return d;
      }
    }
  }
  return max;
}
// the street's centre line beside a parked car (2.2 m to its left)
function centreOf(c) {
  const h = c.heading || 0;
  return { x: c.pos.x + Math.cos(h) * CENTRE, z: c.pos.z - Math.sin(h) * CENTRE };
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
        for (const c of cars) { const o = centreOf(c); const r = clearAhead(A, c, o.x, o.z, c.pos.y, c.heading, 80); if (!best || r > best.r) best = { c: c, r: r }; }
        M.car = best.c; M.run = Math.round(best.r);
        // stand at the driver's door (the car's local +X flank)
        const c = M.car, h = c.heading;
        const half = ((c.dims && c.dims.width) || 1.9) / 2;
        Pl.pos.set(c.pos.x + Math.cos(h) * (half + 0.7), c.pos.y, c.pos.z - Math.sin(h) * (half + 0.7));
        Pl.vy = 0; Pl.grounded = true;
        M.hp0 = Pl.hp;
        const o = centreOf(c);
        M.line = { x: o.x, z: o.z, h: h, fx: Math.sin(h), fz: Math.cos(h) };
        M.turns = 0;
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
        // THE ROUTE: hold the street's centre line; where the street ahead is
        // blocked (a junction's signal post, the sea, a parked car), turn onto
        // whichever cross street (or back the way it came) is clearest
        const L = M.line;
        if (M.phase === "drive" && M.odo > 3) {
          const look = 8 + v * 0.9;
          const ahead = clearAhead(A, car, car.pos.x, car.pos.z, car.pos.y, L.h, look + 1);
          if (ahead < look) {
            let pick = null;
            for (const dh of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
              const r = clearAhead(A, car, car.pos.x, car.pos.z, car.pos.y, L.h + dh, 40);
              if (!pick || r > pick.r) pick = { dh: dh, r: r };
            }
            if (pick && pick.r > 12) {
              const nh = L.h + pick.dh;
              M.line = { x: car.pos.x, z: car.pos.z, h: nh, fx: Math.sin(nh), fz: Math.cos(nh) };
              M.turns++; W.event("kit", "turn " + Math.round(pick.dh * 180 / Math.PI) + " deg (" + Math.round(pick.r) + " m clear)");
            }
          }
        }
        const N = M.line;
        const lat = (car.pos.x - N.x) * N.fz - (car.pos.z - N.z) * N.fx;
        const hErr = Math.atan2(Math.sin(car.heading - N.h), Math.cos(car.heading - N.h));
        if (M.odo > 15 && Math.abs(hErr) < 0.15) M.laneErrMax = Math.max(M.laneErrMax, Math.abs(lat));
        const steer = -(lat * 0.35 + hErr * 2.2);              // + = steer left (A)
        keys.a = steer > 0.08; keys.d = steer < -0.08;
        // slow for the corner, back up to cruise once lined up
        const want = Math.abs(hErr) > 0.35 ? 5 : SPEED;
        if (M.phase === "drive") {
          keys.w = v < want - 0.8; keys.s = v > want + 2.5;
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
      stoppedAt: M.stoppedAt, turns: M.turns, wallHits: M.walls,
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
