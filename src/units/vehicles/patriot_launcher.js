/* ============================================================
   units/vehicles/patriot_launcher.js — M903 Patriot launching station on a HEMTT (USA).

   THE BODY: city/mil_armor.js buildPatriot via CBZ.milArmor.patriot(). No new art in wave A: this file
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
  CBZ.unitKit.register("patriot_launcher", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    stats: {hp: 240, mass: 38000, speed: 18, reverse: 5, accel: 1.6, turn: 0.45, wheelbase: 6, maxSteer: 0.45, length: 10.2, width: 2.5, height: 3.6, armour: {front: 6, side: 2, rear: 2, top: 2}, standoff: 600},
    launcher: {rate: 0.4, elevRate: 0.3, elevMin: 0, elevMax: 0.66},
    crew: [{seat: "driver", pos: [0.6, 2, 3.6]}, {seat: "commander", pos: [-0.6, 2, 3.6]}],
    passengers: 0,
    weapons: [
      {id: "pac3_mse", seat: "commander", kind: "sam", vs: "air", rof: 0.25, pen: 300, beh: 2000, speed: 1200, range: 35000, minRange: 300, ammo: 4},
    ],
    build: function (ctx) {
    const a = CBZ.milArmor;
    if (!a || !a.patriot) return null;          // city/mil_armor.js not loaded: the runtime stands in a hull
    const b = a.patriot();
    return { group: b.group, rig: b.group.userData.rig || null, footW: b.footW, footL: b.footL, height: b.height };
    },
  });
})();
