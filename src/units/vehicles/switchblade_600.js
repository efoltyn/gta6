/* ============================================================
   units/vehicles/switchblade_600.js — AeroVironment Switchblade 600, the
   anti-armour loitering munition (USA; fielded here by any nation's army).

   WHAT IT IS. A tube-launched, electric, folding-wing kamikaze aircraft with
   a Javelin-derived tandem shaped charge in its nose. The gunner sets the
   tube on its legs (or a vehicle carries it in a cradle), the gas generator
   throws the round out, the wings swing open in the first fraction of a
   second, the pusher prop unfolds and starts, and it climbs away. It then
   LOITERS over the fight on its EO/IR sensor (up to ~40 min, 40+ km of
   datalink) while the gunner looks for the right target on the handheld
   ground control station; when he commits, it dives on the target at its
   dash speed and attacks the roof (top attack, where a tank is thin). The
   gunner can wave it off right up to the last seconds and send it round
   again.

   THE AIRFRAME (real metres): ~1.3 m long, 0.15 m round body; the forward
   wing pair (1.32 m span) on top, folded back along the body in the tube and
   swung out at the pivot; the aft pair (0.96 m) underneath, folded forward;
   two tail fins that spring up; a two-blade folding pusher prop on the
   electric motor in the tail cone; the sensor dome in the nose. ~15 kg
   airframe, 54.5 lb (24.7 kg) with its launch tube. Cruise 113 km/h
   (31 m/s), dash 185 km/h (51 m/s). The canister: 1.55 m, 0.115 m radius,
   a frangible front cap, a gas generator in the rear closure, a carry
   handle, legs that fold out.

   THE BODY is units/kit/drone.js's Switchblade family (one builder for the
   600 and the 300, by spec): build, the wings and prop rigged on the battle
   clock. The doctrine that flies it is src/battle/drones.js.

   COUNTER-DRONE. It is small and fast: rifle and machine-gun fire can bring
   it down, with difficulty (its box is 1.3 x 1.3 x 0.35 m at 31-51 m/s); a
   Patriot does not engage it (stats.rcs under any SAM's floor).

   Units: metres, m/s, kg, mm RHA. Nose +Z, +X port, y up from the bottom.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;

  const SPEC = {
    id: "switchblade_600", len: 1.30, R: 0.075,
    fwSpan: 0.66, fwChord: 0.13, fwZ: 0.16,          // half-wing span: 1.32 m tip to tip
    awSpan: 0.48, awChord: 0.11, awZ: -0.47,
    finH: 0.13, propR: 0.21, tubeL: 1.55, tubeR: 0.115, legs: true,
    paint: 0x8e9190, tubePaint: 0x5c5f4c,
  };
  let FAM = null;
  function fam() { return FAM || (FAM = CBZ.droneKit.switchblade(SPEC)); }

  CBZ.unitKit.register("switchblade_600", {
    kind: "vehicle",
    domain: "air",
    drive: "drone",
    stats: {
      hp: 14, mass: 15, speed: 31, length: SPEC.len, width: SPEC.fwSpan * 2, height: 0.18,
      // aluminium and composite: nothing stops a round, everything is vital
      armour: { front: 1, side: 1, rear: 1, top: 1 },
      remote: true,                                  // flown from the ground: nobody aboard
      rcs: 0.02,                                     // m2: under any SAM radar's floor
      detect: 260,                                   // an electric motor: near silent, seen only close
    },
    crew: [],
    passengers: 0,
    weapons: [],                                     // the airframe IS the weapon (drone.warheads)
    /* THE DOCTRINE'S NUMBERS (src/battle/drones.js). range: the datalink's
       reach from the gunner (40 km; on a battle map, the whole map);
       endurance in seconds; cruise/dash m/s; turn rad/s (bank-limited);
       agl: transit height; loiter: the orbit's height and radius; perOp:
       rounds one team carries and flies one at a time; prep: seconds to set
       up the next tube. */
    drone: {
      cls: "loiter", frame: "wing", launch: "tube", link: "digital",
      range: 40000, endurance: 2400, cruise: 31, dash: 51, turn: 0.55, climb: 6,
      agl: 150, loiterAGL: 220, loiterR: 420, scan: 9,
      perOp: 2, prep: 30, warheads: ["sb600_tandem"],
      carriers: ["hmmwv", "jltv", "stryker_apc"],
      terminal: 700, dive: 1.05,                     // commits inside 700 m and dives at ~60 deg onto the roof
    },
    tactics: {
      role: "loitering-munition",
      // what it is FOR: the hulls that matter most, the weapons that hurt most
      priorities: ["tank", "sam", "artillery", "ifv", "apc", "launcher", "vehicle"],
      attack: "top",                                 // a top-attack dive onto the roof or the engine deck
      waveOff: true,                                 // the gunner sends it round again when the mark is gone
      operator: { cover: true, back: 550 },          // the team stays in cover well behind its own line
      loiter: true,
    },
    build: function (ctx) { return fam().build(ctx); },
    animate: function (veh, dt, ctx) {
      const r = veh && veh.rig;
      if (r && r.tick) r.tick(dt, veh.dr || null, ctx);
    },
  });
})();
