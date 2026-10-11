/* ============================================================
   units/vehicles/a400m.js — Airbus A400M Atlas transport.

   THE BODY: city/island_military.js makeCargoPlane via CBZ.milAir.make('cargo') (island_military defines it). No new art in wave A: this file
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
  CBZ.unitKit.register("a400m", {
    kind: "vehicle",
    domain: "air",
    drive: "jet",
    stats: {hp: 600, mass: 78600, speed: 150, accel: 5, turn: 0.2, alt: 380, length: 45.1, width: 42.4, height: 14.7, armour: {front: 0, side: 0, rear: 0, top: 0}, standoff: 0, dismountAt: 99999, airdrop: true},
    crew: [{seat: "pilot", pos: [0, 5, 18]}, {seat: "copilot", pos: [0, 5, 18]}, {seat: "loadmaster", pos: [0, 3, 0]}],
    passengers: 116,
    weapons: [

    ],
    build: function (ctx) {
    const a = CBZ.milAir;
    if (!a || !a.make) return null;           // city/mil_air.js not loaded: the runtime stands in a frame
    const b = a.make("cargo");
    return b ? { group: b.group, rig: null, footW: b.footW, footL: b.footL, height: b.height } : null;
    },
  });
})();
