/* ============================================================
   units/vehicles/hmmwv.js — M1151 HMMWV, up-armoured (USA).

   THE BODY: city/mil_armor.js buildLUV via CBZ.milArmor.luv(). No new art in wave A: this file
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
  CBZ.unitKit.register("hmmwv", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    stats: {hp: 220, mass: 5400, speed: 31, reverse: 8, accel: 4.2, turn: 0.8, wheelbase: 3.3, maxSteer: 0.55, length: 4.57, width: 2.16, height: 1.83, armour: {front: 10, side: 10, rear: 8, top: 5}, standoff: 160},
    turret: {rate: 2, elevRate: 1.2, elevMin: -0.25, elevMax: 0.9},
    crew: [{seat: "driver", pos: [0.5, 1.2, 0.5]}, {seat: "gunner", pos: [0, 2, -0.2]}],
    passengers: 2,
    weapons: [
      {id: "m2_50cal_ring", seat: "gunner", kind: "mg", wid: "lmg", turret: true, rof: 8, burst: 8, pause: 1.4, dmg: 38, pen: 24, range: 1500, ammo: 1200},
    ],
    build: function (ctx) {
    const a = CBZ.milArmor;
    if (!a || !a.luv) return null;          // city/mil_armor.js not loaded: the runtime stands in a hull
    const b = a.luv();
    return { group: b.group, rig: b.group.userData.rig || null, footW: b.footW, footL: b.footL, height: b.height };
    },
  });
})();
