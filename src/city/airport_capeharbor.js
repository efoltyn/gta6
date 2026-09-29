/* ============================================================
   city/airport_capeharbor.js — CAPE HARBOR REGIONAL. THE SECOND AIRPORT.

   OWNER (2026-08-09): "put another airport in another city."

   THIS FILE IS THE ARGUMENT. Halloran Field is 3,977 lines. A second
   airport — real runway, real markings, real edge lights, real stands with
   real parked airliners with real pilots in them, a terminal, a tower, a
   fence, a kerb, an access causeway to the town it serves, a walkable
   region, an airside keep-out and a ticket desk that sells you a seat — is
   the SPEC BELOW and one call. If the third airport takes more than this
   file's length, the packaging failed.

   WHERE, and why there. Cape Harbor is the port mini-city (city/minicities.js
   authored anchor 430,175). The field sits on its own reclaimed ground beyond
   the town's far shore, on the SAME world-layout dial as the town — author
   the anchor once, and if `world/layout.js` slides Cape Harbor, its airport
   slides with it and no number in this file changes. The footprint was
   measured against every neighbour at the live stage-5 offsets, and against
   the two CAUSEWAYS that cross this quarter of the map — which is the check
   that actually moved the field, twice:

     bounds       x[454,1497]  z[1260,1759]
     Cape Harbor  x[490,730]   z[875,1115]   -> 145 m clear (its own town)
     Goldspire    x[32,268]    z[1250,1490]  -> 186 m clear
     Saltlands basin  minX 1719              -> 222 m clear
     Cape Harbor causeway  x[598,622] z[-130,875]  -> 385 m clear in z
     Goldspire causeway    x[138,162] z[470,1250]  -> 292 m clear in x

     The causeways are why the field is not on the town's near shore, which
     is where it was first drawn: Cape Harbor's own access deck runs 1,000 m
     up x=610 and would have gone straight down the runway.

   BEARING 196 (yaw 0.28 + PI), deliberately NOT an axis. Halloran is 09/27,
   dead east-west, so a second field on the same bearing would prove nothing
   about the frame: every consumer could still be reading world axes and
   nobody would know. A crooked runway means the taxi route, the lead-in
   lines, the hold-shorts, the keep-out and the departure/arrival tracks are
   all coming out of `ap.toWorld` for real. The PI is not decoration either —
   the terminal is always on the field's local +Z side, so the half-turn is
   what puts the kerb on the TOWN's side. Point it the other way and the
   access causeway has to cross its own runway to reach the door.

   IT IS A REGIONAL FIELD, NOT A SECOND INTERNATIONAL — and since the
   2026-09-29 redraw it is drawn to the same code E numbers as Halloran,
   because the same aeroplane lands on it: a 45 m runway (900 m), a 23 m
   parallel taxiway 95 m off the centreline, three nose-in stands on a
   concrete apron, a one-level terminal (check-in, security, a lounge with
   doors out to the apron: passengers walk to the airstairs, there are no
   bridges at a field this size), a tower, an ARFF station, a hangar, a
   cargo shed, a two-tank fuel farm, radar, ILS and approach lights, and a
   surface car park at the kerb. The field sits 60 m further from the town
   than it did (AP_Z +625, was +565), because the landside grew: its bounds
   now clear Cape Harbor's rect by ~65 m (tools/airfield-check.mjs measures
   it against the neighbours listed above).

   Loads at landmass order 22: after island_airport.js (21), which is what
   publishes `CBZ.airportKit`'s airframe factories, and before the mini-cities
   (34) that this field's causeway plugs into.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.addLandmass) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.AIRPORT_CAPEHARBOR == null) CFG.AIRPORT_CAPEHARBOR = true;

  // The town this field serves, on its own dial — the SAME authored anchor
  // city/minicities.js uses, read through the same accessor. One source.
  const CH_AX = 430, CH_AZ = 175, CH_HX = 120, CH_HZ = 120;
  const _OC = (CBZ.worldOff && CBZ.worldOff("capeharbor")) || { dx: 0, dz: 0 };
  const CH_X = CH_AX + _OC.dx, CH_Z = CH_AZ + _OC.dz;

  // The field: authored as an offset FROM the town, so the pair moves as one.
  // (Redraw 2026-09-29: the field grew a real code E apron and landside, so
  // it moved 60 m further out; see the bounds note in the header.)
  const AP_X = CH_X + 380, AP_Z = CH_Z + 625;
  const YAW = 0.28 + Math.PI;             // runway 11/29, kerb facing the town

  CBZ.addLandmass(function (city) {
    if (CFG.AIRPORT_CAPEHARBOR === false || !CBZ.buildAirfield) return;
    // A world rebuild re-runs every landmass builder; registerAirport replaces
    // by id, so nothing here needs a reset guard.
    const ap = CBZ.buildAirfield(city, {
      id: "capeharbor-air",
      name: "Cape Harbor Regional",
      subtitle: "Regional Airport",
      code: "CHR",
      city: "Cape Harbor",
      biome: "airport",
      x: AP_X, z: AP_Z, yaw: YAW,
      // LOCAL metres, all of them (origin = runway midpoint, +Z = apron side).
      runway: { len: 900, w: 45 },
      taxiZ: 95, taxiX0: -430, taxiX1: 430,
      conns: [-420, 0, 420],
      // a one-level regional terminal: check-in, security, a ground-floor
      // lounge with doors out to the apron; passengers walk to the airstairs
      terminal: { x0: -90, x1: 90, z0: 210, z1: 250, levels: 1, islands: 3, canopy: 8, name: "Cape Harbor Regional" },
      kerbZ: 262,
      extent: { x0: -530, x1: 530, z0: -92, z1: 322 },
      stands: [
        { id: "CHR-1", num: "1", lx: -68 },
        { id: "CHR-2", num: "2", lx: 0 },
        { id: "CHR-3", num: "3", lx: 68 },
      ],
      // ONE airliner sits on the ramp; the other two stands stay open so the
      // scheduled flights have somewhere to park when they arrive.
      parked: ["CHR-1"],
      jets: [{ lx: 135, lz: 160, heading: -Math.PI / 2 + 0.15 }, { lx: 163, lz: 172, heading: -Math.PI / 2 - 0.2 }],
      aprons: [{ x0: -125, z0: 106.5, x1: 190, z1: 210 }],
      paved: [
        { x0: -200, z0: 106.5, x1: -140, z1: 138, color: 0x3c3f44 },     // fire station
        { x0: -290, z0: 106.5, x1: -225, z1: 140, color: 0x8f8d87 },     // hangar apron
        { x0: -370, z0: 106.5, x1: -310, z1: 150, color: 0x8f8d87 },     // cargo apron
        { x0: -480, z0: 200, x1: -90, z1: 207, color: 0x3c3f44 },        // airside service road
        { x0: -150, z0: 268, x1: 150, z1: 316, color: 0x45484c },        // the surface car park
        { x0: -120, z0: 256, x1: 120, z1: 268, color: 0x45484c },        // the kerb lane
      ],
      tower: { lx: -122, lz: 232, H: 24 },
      fence: {
        runs: [
          [-525, -88, 525, -88], [-525, -88, -525, 200], [525, -88, 525, 200],
          [-525, 212, -90.3, 212], [90.3, 212, 525, 212],
        ],
        center: { x: 0, z: 60 },
      },
      paint: function (PA) {
        // the surface car park: bay lines, the aisle, a kerb line at the doors
        const W = 0xe6e9ec;
        for (let x = -146; x < 146; x += 2.6) for (const z of [274, 289, 297, 312]) PA.rect(x, z, 0.12, 5, W);
        PA.line([[-150, 281.5], [150, 281.5]], 0.12, W, [3, 3]);
        PA.line([[-150, 304.5], [150, 304.5]], 0.12, W, [3, 3]);
        PA.line([[-120, 256.6], [120, 256.6]], 0.15, W);
        for (let k = 0; k < 3; k++) PA.rect(0, 259 + k * 0.9, 4.0, 0.45, W);
      },
      dressing: {
        hangars: [{ lx: -258, lz: 162, yaw: Math.PI, w: 44, d: 38, h: 15, type: "arch", open: 0.5 }],
        sheds: [{ lx: -340, lz: 168, yaw: Math.PI, w: 50, d: 28, h: 9, airside: 3, docks: 4 }],
        fuel: { lx: -440, lz: 165, yaw: 0, tanks: [[-11, -2, 7, 10], [11, -2, 7, 10]], bund: { x0: -21, z0: -12, x1: 21, z1: 10 } },
        fire: { lx: -170, lz: 150, yaw: Math.PI, bays: 3 },
        rental: { lx: 118, lz: 296, w: 30, d: 12, yaw: Math.PI / 2 },
        asr: { lx: 330, lz: 175, h: 18 },
        radome: { lx: 400, lz: 182, h: 14 },
        ils: { end: 0, locDist: 70, gsOffset: 60, gsSide: -1 },
        approach: [{ end: 0, len: 420, flashers: 5 }, { end: 1, len: 420, flashers: 0 }],
        masts: [[-102, 152], [-34, 152], [34, 152], [102, 152], [-120, 292], [0, 292], [120, 292]],
        windsocks: [[-250, 55, 0.9], [250, 55, 0.9]],
        ulds: [[-345, 128, 0, 1], [-341, 125, 0, 1], [-330, 128, Math.PI / 2, 0], [-326, 128, Math.PI / 2, 1]],
      },
      // the causeway plug: the town's far edge, the one the kerb faces.
      road: { x: CH_X, z: CH_Z + CH_HZ },
    });
    if (ap) ap.hub = false;
  }, 22);
})();
