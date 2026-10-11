/* ============================================================
   units/vehicles/m35_truck.js — M35A2 2½-ton 6x6 cargo truck (USA).

   THE BODY: city/mil_armor.js buildTruck('cargo') via CBZ.milArmor.truck(). No new art in wave A: this file
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
  CBZ.unitKit.register("m35_truck", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    stats: {hp: 160, mass: 6100, speed: 25, reverse: 6, accel: 2.4, turn: 0.55, wheelbase: 4.7, maxSteer: 0.5, length: 7.95, width: 2.5, height: 3.22, armour: {front: 2, side: 0, rear: 0, top: 0}, standoff: 320, dismountAt: 220},
    crew: [{seat: "driver", pos: [0.55, 1.8, 2.6]}, {seat: "commander", pos: [-0.55, 1.8, 2.6]}],
    passengers: 16,
    weapons: [

    ],
    build: function (ctx) {
    const a = CBZ.milArmor;
    if (!a || !a.truck) return null;          // city/mil_armor.js not loaded: the runtime stands in a hull
    const b = a.truck();
    return { group: b.group, rig: b.group.userData.rig || null, footW: b.footW, footL: b.footL, height: b.height };
    },
  });
})();
