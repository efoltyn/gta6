/* ============================================================
   units/vehicles/technical.js — pickup technical with a belt-fed machine gun.

   THE BODY: a stand-in pickup built in this file (warlord/mounts.js buildTechnical needs CBZ.warlord, which NPC War does not load). No new art in wave A: this file
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
  CBZ.unitKit.register("technical", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    stats: {hp: 140, mass: 2200, speed: 30, reverse: 8, accel: 4, turn: 0.8, wheelbase: 3.1, maxSteer: 0.6, length: 5.3, width: 1.85, height: 1.8, armour: {front: 1, side: 0, rear: 0, top: 0}, standoff: 140},
    turret: {rate: 2.4, elevRate: 1.4, elevMin: -0.3, elevMax: 0.9},
    crew: [{seat: "driver", pos: [0.45, 1.2, 0.6]}, {seat: "gunner", pos: [0, 1.9, -1.3]}],
    passengers: 2,
    weapons: [
      {id: "pkm", seat: "gunner", kind: "mg", wid: "lmg", turret: true, rof: 10, burst: 10, pause: 1.2, dmg: 22, pen: 9, range: 800, ammo: 1000},
    ],
    build: function (ctx) {
    // A STAND-IN, honest about it: a cab, a bed and a machine gun on a post.
    // The technical agent ports warlord/mounts.js buildTechnical here (or has
    // that file export it) and replaces this.
    const T = ctx.THREE; if (!T) return null;
    const g = new T.Group(); g.name = "technical";
    const mat = function (c) { return ctx.mat ? ctx.mat(c) : new T.MeshLambertMaterial({ color: c }); };
    const box = function (w, h, d, c, x, y, z) { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    box(1.82, 0.55, 5.2, 0xd8d2c4, 0, 0.75, 0);          // body sides
    box(1.78, 0.7, 1.7, 0xd8d2c4, 0, 1.35, 0.55);        // cab
    box(1.7, 0.45, 1.1, 0x2b3036, 0, 1.45, 1.45);        // windscreen band
    [[-0.86, 1.65], [0.86, 1.65], [-0.86, -1.5], [0.86, -1.5]].forEach(function (p) {
      const w = new T.Mesh(new T.CylinderGeometry(0.38, 0.38, 0.3, 14), mat(0x1c1c1c));
      w.rotation.z = Math.PI / 2; w.position.set(p[0], 0.38, p[1]); g.add(w);
    });
    const turret = new T.Group(); turret.name = "turret"; turret.position.set(0, 1.55, -1.3); g.add(turret);
    const post = new T.Mesh(new T.CylinderGeometry(0.05, 0.06, 0.7, 8), mat(0x30343a)); post.position.y = 0.0; turret.add(post);
    const gun = new T.Group(); gun.name = "gun"; gun.position.y = 0.4; turret.add(gun);
    const tube = new T.Mesh(new T.BoxGeometry(0.1, 0.12, 1.2), mat(0x1a1c1e)); tube.position.z = 0.45; gun.add(tube);
    const muzzle = new T.Object3D(); muzzle.name = "muzzle"; muzzle.position.z = 1.05; gun.add(muzzle);
    return { group: g, rig: null, footW: 1.85, footL: 5.3, height: 1.8 };
    },
  });
})();
