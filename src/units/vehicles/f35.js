/* ============================================================
   units/vehicles/f35.js — F-35A Lightning II (USA).

   THE BODY: city/mil_air.js BUILDERS.fighter via CBZ.milAir.make('fighter'). No new art in wave A: this file
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
  CBZ.unitKit.register("f35", {
    kind: "vehicle",
    domain: "air",
    drive: "jet",
    stats: {hp: 320, mass: 22470, speed: 250, accel: 30, turn: 0.35, alt: 4600, length: 15.6, width: 10.7, height: 4.4, armour: {front: 2, side: 2, rear: 2, top: 2}, standoff: 0},
    crew: [{seat: "pilot", pos: [0, 2.6, 4]}],
    passengers: 0,
    weapons: [
      {id: "gbu12", seat: "pilot", kind: "bombs", vs: "any", guided: true, rof: 2.5, salvo: 2, reload: 0, pen: 200, beh: 2400, he: {pen: 200, beh: 2400, blast: 24, power: 3.4}, range: 9000, ammo: 4},
      {id: "gau22_25mm", seat: "pilot", kind: "autocannon", mount: "fixed", alt: 1500, dive: 0.3, pullOut: 300, rof: 55, burst: 30, pause: 6, pen: 40, beh: 100, he: {pen: 40, beh: 100, blast: 2.2, power: 0.8}, speed: 1040, heSpeed: 1040, grav: 9.8, range: 1800, ammo: 180},
    ],
    build: function (ctx) {
    const a = CBZ.milAir;
    if (!a || !a.make) return null;           // city/mil_air.js not loaded: the runtime stands in a frame
    const b = a.make("fighter");
    return b ? { group: b.group, rig: null, footW: b.footW, footL: b.footL, height: b.height } : null;
    },
  });
})();
