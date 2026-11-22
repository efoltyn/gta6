/* ============================================================
   src/world/water_buoyancy.js — CITY BOATS SIT IN THE WATER.

   city/vehicles.js floats a marine car at a constant height and never asks
   the water. This post-pass (order 38.5, after every vehicles.js transform
   writer and the helm, before the swimmer at 45.8 and the camera at 50)
   hands every marine city car over water to the one seakeeping model
   (world/water_stability.js, CBZ.hullSeakeep): heave, pitch and roll from the
   hull's own numbers against the water sampled along it, flight and slam,
   the water's flow carrying it, grounding. Then it writes that pose onto the
   car's group, and lifts the driver and camera with it.

   Sea craft (world/sea_craft.js) call the same function from their own ride;
   there is one model of a hull in the water, not two.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  const _e = new THREE.Euler(0, 0, 0, "YXZ");
  const _ws = {};

  function isMarine(car) {
    if (!car) return false;
    if (CBZ.isMarineHull) return CBZ.isMarineHull(car);
    const feel = car._playerCarFeel;
    if (feel) return !!feel.marine;
    return !!(car.model && car.model.body === "boat");
  }
  function overWater(x, z) { return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)); }

  CBZ.onUpdate(38.5, function (dt) {
    if (CFG.WATER_V2 === false || !CBZ.hullSeakeep) return;
    const g = CBZ.game;
    // (the archipelago floats its boats on its own sea: cityWaterAt answers
    // the island water there, world/water_survival.js)
    const arch = !!g && g.mode === "archipelago";
    if (!g || (g.mode !== "city" && !arch)) return;
    const cars = CBZ.cityCars;
    if (!cars || !cars.length || !(dt > 0)) return;

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (!car || car.dead || !car.group || !car.pos || car._airborne) continue;
      if (!isMarine(car)) continue;
      if (arch && car._world !== "archipelago") continue;   // a Gang City boat is not in this sea
      // a hull on dry land belongs to the road path; one the water carried
      // over a street (a flood) is still the water's while there is water
      if (!overWater(car.pos.x, car.pos.z) &&
          !(CBZ.waterSample && CBZ.waterSample(car.pos.x, car.pos.z, _ws, car).wet)) { car._waveHeave = 0; continue; }

      const st = CBZ.hullSeakeep(car, dt);
      if (!st || !st.init) continue;
      const y = st.Y;
      car._waveHeave = y - car.group.position.y;    // read by the wake FX
      car.group.position.set(car.pos.x, y, car.pos.z);
      _e.set(-st.th, car.heading || 0, st.phi, "YXZ");
      car.group.quaternion.setFromEuler(_e);
      car._waveY = y;
      car._pitchNow = -st.th; car._rollNow = st.phi;

      // the player's own boat also owns the player transform this frame
      if (car.player && CBZ.player && CBZ.player.driving) {
        CBZ.player.pos.x = car.pos.x; CBZ.player.pos.z = car.pos.z;
        CBZ.player.pos.y = y;
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(car.pos.x, y, car.pos.z);
      }
    }
  });

  // "How high is this hull riding right now", for anything that wants to sit
  // something on a boat.
  CBZ.cityBoatRideY = function (car) {
    if (!car) return null;
    return car._waveY != null ? car._waveY : null;
  };
})();
