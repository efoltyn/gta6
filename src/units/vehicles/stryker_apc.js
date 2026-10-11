/* ============================================================
   units/vehicles/stryker_apc.js — M1126 Stryker ICV, 8x8 (USA).

   THE BODY: city/mil_armor.js buildAPC via CBZ.milArmor.apc(). No new art in wave A: this file
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
  CBZ.unitKit.register("stryker_apc", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    stats: {hp: 420, mass: 16500, speed: 27, reverse: 8, accel: 3.2, turn: 0.7, wheelbase: 4.6, maxSteer: 0.5, length: 6.95, width: 2.72, height: 2.64, armour: {front: 20, side: 14, rear: 12, top: 8}, standoff: 200, dismountAt: 160},
    turret: {rate: 1.6, elevRate: 1, elevMin: -0.3, elevMax: 1},
    crew: [{seat: "driver", pos: [0.6, 1.6, 2.2]}, {seat: "commander", pos: [-0.3, 2.4, 0.8]}],
    passengers: 9,
    weapons: [
      {id: "m2_50cal_rws", seat: "commander", kind: "mg", wid: "lmg", turret: true, rof: 8, burst: 8, pause: 1.4, dmg: 38, pen: 24, range: 1500, ammo: 2000},
    ],
    build: function (ctx) {
    const a = CBZ.milArmor;
    if (!a || !a.apc) return null;          // city/mil_armor.js not loaded: the runtime stands in a hull
    const b = a.apc();
    return { group: b.group, rig: b.group.userData.rig || null, footW: b.footW, footL: b.footL, height: b.height };
    },
  });
})();
