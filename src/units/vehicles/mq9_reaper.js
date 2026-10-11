/* ============================================================
   units/vehicles/mq9_reaper.js — MQ-9A Reaper (USA), flown from the ground: no crew on the field.

   THE BODY: city/mil_air.js BUILDERS.drone via CBZ.milAir.make('drone'). No new art in wave A: this file
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
  CBZ.unitKit.register("mq9_reaper", {
    kind: "vehicle",
    domain: "air",
    drive: "jet",
    stats: {hp: 120, mass: 4760, speed: 80, accel: 6, turn: 0.4, alt: 4500, length: 11, width: 20, height: 3.8, armour: {front: 0, side: 0, rear: 0, top: 0}, standoff: 3000, remote: true},
    crew: [],
    passengers: 0,
    weapons: [
      {id: "agm114_hellfire", seat: null, kind: "missile", vs: "any", mount: "fixed", arc: 0.5, rof: 0.125, pen: 1000, beh: 1000, he: {pen: 1000, beh: 1000, blast: 6, power: 1.8}, speed: 425, range: 8000, minRange: 300, ammo: 4},
    ],
    build: function (ctx) {
    const a = CBZ.milAir;
    if (!a || !a.make) return null;           // city/mil_air.js not loaded: the runtime stands in a frame
    const b = a.make("drone");
    return b ? { group: b.group, rig: null, footW: b.footW, footL: b.footL, height: b.height } : null;
    },
  });
})();
