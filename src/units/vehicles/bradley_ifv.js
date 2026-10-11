/* ============================================================
   units/vehicles/bradley_ifv.js — M2A3 Bradley infantry fighting vehicle (USA).

   THE BODY: city/mil_armor.js buildIFV via CBZ.milArmor.ifv(). No new art in wave A: this file
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
  CBZ.unitKit.register("bradley_ifv", {
    kind: "vehicle",
    domain: "ground",
    drive: "tracked",
    stats: {hp: 600, mass: 30400, speed: 18.3, reverse: 7, accel: 2.8, turn: 0.85, length: 6.55, width: 3.28, height: 2.98, armour: {front: 60, side: 30, rear: 20, top: 15}, standoff: 220, dismountAt: 140},
    turret: {rate: 1, elevRate: 0.8, elevMin: -0.15, elevMax: 1},
    crew: [{seat: "driver", pos: [0.7, 1.4, 2]}, {seat: "gunner", pos: [-0.4, 2.2, 0.2]}, {seat: "commander", pos: [0.4, 2.4, 0]}],
    passengers: 6,
    weapons: [
      {id: "m242_25mm", seat: "gunner", kind: "autocannon", turret: true, rof: 3.3, burst: 4, pause: 1, pen: 60, beh: 140, he: {pen: 20, beh: 120, blast: 3, power: 1}, speed: 1100, heSpeed: 1100, grav: 9.8, range: 2000, ammo: 900},
      {id: "tow_2b", seat: "gunner", kind: "missile", turret: true, rof: 0.05, vs: "armour", pen: 900, beh: 950, speed: 280, range: 3750, minRange: 65, ammo: 7},
      {id: "m240_coax", seat: "gunner", kind: "mg", wid: "lmg", turret: true, rof: 10, burst: 10, pause: 1.2, dmg: 22, pen: 9, range: 900, ammo: 2200},
    ],
    build: function (ctx) {
    const a = CBZ.milArmor;
    if (!a || !a.ifv) return null;          // city/mil_armor.js not loaded: the runtime stands in a hull
    const b = a.ifv();
    return { group: b.group, rig: b.group.userData.rig || null, footW: b.footW, footL: b.footL, height: b.height };
    },
  });
})();
