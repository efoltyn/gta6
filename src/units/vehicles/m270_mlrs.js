/* ============================================================
   units/vehicles/m270_mlrs.js — M142 HIMARS, 6x6 rocket launcher (USA) — the model is the wheeled six-round pod; the id keeps the census name.

   THE BODY: city/mil_armor.js buildMLRS via CBZ.milArmor.mlrs(). No new art in wave A: this file
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
  CBZ.unitKit.register("m270_mlrs", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    stats: {hp: 260, mass: 16250, speed: 23.6, reverse: 6, accel: 2.4, turn: 0.55, wheelbase: 4.6, maxSteer: 0.45, length: 7, width: 2.4, height: 3.2, armour: {front: 8, side: 2, rear: 2, top: 2}, standoff: 420},
    launcher: {rate: 0.5, elevRate: 0.35, elevMin: 0, elevMax: 1},
    crew: [{seat: "driver", pos: [0.5, 1.8, 2.6]}, {seat: "gunner", pos: [0, 1.8, 2.6]}, {seat: "commander", pos: [-0.5, 1.8, 2.6]}],
    passengers: 0,
    weapons: [
      {id: "m31_gmlrs", seat: "gunner", kind: "rockets", vs: "soft", rof: 0.4, salvo: 6, reload: 90, pen: 100, beh: 900, he: {pen: 100, beh: 900, blast: 26, power: 3.2}, speed: 220, heSpeed: 220, grav: 9.8, indirect: true, range: 70000, minRange: 90, ammo: 6},
    ],
    build: function (ctx) {
    const a = CBZ.milArmor;
    if (!a || !a.mlrs) return null;          // city/mil_armor.js not loaded: the runtime stands in a hull
    const b = a.mlrs();
    return { group: b.group, rig: b.group.userData.rig || null, footW: b.footW, footL: b.footL, height: b.height };
    },
  });
})();
