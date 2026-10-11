/* ============================================================
   units/vehicles/b52.js — B-52H Stratofortress (USA).

   THE BODY: city/mil_air.js BUILDERS.bomber via CBZ.milAir.make('bomber'). No new art in wave A: this file
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
  CBZ.unitKit.register("b52", {
    kind: "vehicle",
    domain: "air",
    drive: "jet",
    stats: {hp: 900, mass: 120000, speed: 230, accel: 6, turn: 0.15, alt: 9000, length: 48.5, width: 56.4, height: 12.4, armour: {front: 0, side: 0, rear: 0, top: 0}, standoff: 0},
    crew: [{seat: "pilot", pos: [0, 4, 18]}, {seat: "copilot", pos: [0, 4, 18]}, {seat: "navigator", pos: [0, 3, 17]}, {seat: "radar", pos: [0, 3, 17]}, {seat: "ewo", pos: [0, 4, 16]}],
    passengers: 0,
    weapons: [
      {id: "mk82_stick", seat: "navigator", kind: "bombs", vs: "soft", rof: 8.333333333333334, salvo: 12, reload: 40, pen: 120, beh: 1800, he: {pen: 120, beh: 1800, blast: 18, power: 2.8}, range: 9000, ammo: 51},
    ],
    build: function (ctx) {
    const a = CBZ.milAir;
    if (!a || !a.make) return null;           // city/mil_air.js not loaded: the runtime stands in a frame
    const b = a.make("bomber");
    return b ? { group: b.group, rig: null, footW: b.footW, footL: b.footL, height: b.height } : null;
    },
  });
})();
