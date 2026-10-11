/* ============================================================
   units/vehicles/uh60_black_hawk.js — UH-60M Black Hawk utility helicopter (USA).

   THE BODY: city/mil_air.js BUILDERS.utilityHeli via CBZ.milAir.make('utilityHeli'). No new art in wave A: this file
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
  CBZ.unitKit.register("uh60_black_hawk", {
    kind: "vehicle",
    domain: "air",
    drive: "rotor",
    stats: {hp: 380, mass: 9980, speed: 82, accel: 7, turn: 0.8, alt: 40, length: 19.8, width: 5.4, height: 5.1, armour: {front: 8, side: 6, rear: 4, top: 4}, standoff: 250, dismountAt: 400},
    crew: [{seat: "pilot", pos: [0.6, 2.2, 3.2]}, {seat: "copilot", pos: [-0.6, 2.2, 3.2]}, {seat: "gunner", pos: [1.1, 1.8, 1.4]}],
    passengers: 11,
    weapons: [
      {id: "m134_door", seat: "gunner", kind: "mg", wid: "lmg", rof: 50, burst: 40, pause: 2, dmg: 22, pen: 9, range: 900, ammo: 4000},
    ],
    build: function (ctx) {
    const a = CBZ.milAir;
    if (!a || !a.make) return null;           // city/mil_air.js not loaded: the runtime stands in a frame
    const b = a.make("utilityHeli");
    return b ? { group: b.group, rig: null, footW: b.footW, footL: b.footL, height: b.height } : null;
    },
  });
})();
