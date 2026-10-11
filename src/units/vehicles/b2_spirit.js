/* ============================================================
   units/vehicles/b2_spirit.js — B-2A Spirit (USA).

   THE BODY: city/strategic.js makeB2 via CBZ.strategicModels.b2(), else the mil_air bomber frame. No new art in wave A: this file
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
  CBZ.unitKit.register("b2_spirit", {
    kind: "vehicle",
    domain: "air",
    drive: "jet",
    stats: {hp: 800, mass: 71700, speed: 250, accel: 6, turn: 0.16, alt: 12000, length: 21, width: 52.4, height: 5.2, armour: {front: 0, side: 0, rear: 0, top: 0}, standoff: 0},
    crew: [{seat: "pilot", pos: [0, 2.5, 6]}, {seat: "commander", pos: [0, 2.5, 6]}],
    passengers: 0,
    weapons: [
      {id: "gbu31_jdam", seat: "commander", kind: "bombs", vs: "any", guided: true, rof: 3.3333333333333335, salvo: 4, reload: 30, pen: 300, beh: 3000, he: {pen: 300, beh: 3000, blast: 34, power: 4}, range: 9000, ammo: 16},
    ],
    build: function (ctx) {
    const S = CBZ.strategicModels;
    if (S && S.b2) { const b = S.b2(); const g = b && (b.group || b); if (g && g.isObject3D) return { group: g, rig: null, footW: 52.4, footL: 21, height: 5.2 }; }
    return null;
    },
  });
})();
