/* ============================================================
   units/vehicles/switchblade_300.js — AeroVironment Switchblade 300 (Block
   20), the small anti-personnel loitering munition (USA; fielded here by
   any nation's army).

   The backpack Switchblade: one soldier carries it, sets the tube on the
   ground (or holds it up), and it is in the air in seconds. 2.5 kg, a
   ~0.5 m round body with the same folding tandem wings as the 600 (0.69 m
   span), a two-blade folding pusher prop, a forward-firing fragmentation
   warhead with a little anti-materiel bite. Cruise 101 km/h (28 m/s), dash
   160 km/h (44 m/s), ~15 min in the air, 10 km of datalink. It goes after
   MEN: a machine-gun nest, a rocket team, a group in a trench, a soft
   vehicle; it leaves armour to the 600.

   THE BODY is units/kit/drone.js's Switchblade family at the 300's numbers
   (the same builder as switchblade_600.js); the doctrine is
   src/battle/drones.js.

   Units: metres, m/s, kg, mm RHA. Nose +Z, +X port, y up from the bottom.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;

  const SPEC = {
    id: "switchblade_300", len: 0.50, R: 0.034,
    fwSpan: 0.345, fwChord: 0.060, fwZ: 0.06,       // 0.69 m tip to tip
    awSpan: 0.26, awChord: 0.052, awZ: -0.18,
    finH: 0.06, propR: 0.10, tubeL: 0.72, tubeR: 0.052, legs: true,
    paint: 0x8a8c86, tubePaint: 0x5a5d48,
  };
  let FAM = null;
  function fam() { return FAM || (FAM = CBZ.droneKit.switchblade(SPEC)); }

  CBZ.unitKit.register("switchblade_300", {
    kind: "vehicle",
    domain: "air",
    drive: "drone",
    stats: {
      hp: 6, mass: 2.5, speed: 28, length: SPEC.len, width: SPEC.fwSpan * 2, height: 0.09,
      armour: { front: 0, side: 0, rear: 0, top: 0 },
      remote: true,
      rcs: 0.005,
      detect: 180,
    },
    crew: [],
    passengers: 0,
    weapons: [],
    drone: {
      cls: "loiter", frame: "wing", launch: "tube", link: "digital",
      range: 10000, endurance: 900, cruise: 28, dash: 44, turn: 0.75, climb: 5,
      agl: 110, loiterAGL: 150, loiterR: 300, scan: 7,
      perOp: 3, prep: 15, warheads: ["sb300_frag"],
      carriers: ["hmmwv", "jltv", "stryker_apc"],
      terminal: 450, dive: 0.75,
    },
    tactics: {
      role: "loitering-munition",
      priorities: ["launcher", "mg", "dugin", "men", "soft"],
      attack: "dive",
      waveOff: true,
      operator: { cover: true, back: 300 },
      loiter: true,
    },
    build: function (ctx) { return fam().build(ctx); },
    animate: function (veh, dt, ctx) {
      const r = veh && veh.rig;
      if (r && r.tick) r.tick(dt, veh.dr || null, ctx);
    },
  });
})();
