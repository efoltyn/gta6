/* ============================================================
   units/vehicles/ah64_apache.js — AH-64E Apache attack helicopter (USA).

   THE BODY: city/mil_air.js BUILDERS.attackHeli via CBZ.milAir.make('attackHeli'). No new art in wave A: this file
   registers the vehicle the game already draws, with its real numbers, so
   NPC War can field it. The agent who owns this file redraws it HERE
   (build), and owns its numbers (stats, armour), its crew seats, its weapons
   and, if it wants something better than the shared defaults, its drive /
   aim / fight hooks. The shared maths is units/kit/vehicle.js
   (CBZ.vehicleDrive); the battle runtime is src/battle/vehicles.js.

   Units: metres, m/s, kg, armour in mm of rolled homogeneous armour
   equivalent per face. Nose is local +Z.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  CBZ.unitKit.register("ah64_apache", {
    kind: "vehicle",
    domain: "air",
    drive: "rotor",
    stats: {hp: 520, mass: 8000, speed: 76, accel: 8, turn: 0.9, alt: 55, length: 15.5, width: 5.2, height: 4.6, armour: {front: 20, side: 15, rear: 10, top: 8}, standoff: 900},
    crew: [{seat: "pilot", pos: [0, 2.6, 2.4]}, {seat: "gunner", pos: [0, 2.2, 3.6]}],
    passengers: 0,
    weapons: [
      {id: "m230_30mm", seat: "gunner", kind: "autocannon", chin: true, rof: 10, burst: 10, pause: 1.6, pen: 50, beh: 120, he: {pen: 50, beh: 120, blast: 2.5, power: 0.9}, speed: 805, heSpeed: 805, grav: 9.8, range: 1500, ammo: 1200},
      {id: "agm114_hellfire", seat: "gunner", kind: "missile", vs: "armour", rof: 0.25, pen: 1000, beh: 1000, speed: 425, range: 8000, minRange: 300, ammo: 16},
      {id: "hydra70", seat: "pilot", kind: "rockets", vs: "soft", rof: 4, salvo: 4, reload: 12, pen: 40, beh: 300, he: {pen: 40, beh: 300, blast: 7, power: 1.6}, speed: 700, heSpeed: 700, grav: 9.8, range: 5000, minRange: 150, ammo: 38},
    ],
    build: function (ctx) {
    const a = CBZ.milAir;
    if (!a || !a.make) return null;           // city/mil_air.js not loaded: the runtime stands in a frame
    const b = a.make("attackHeli");
    return b ? { group: b.group, rig: null, footW: b.footW, footL: b.footL, height: b.height } : null;
    },
  });
})();
