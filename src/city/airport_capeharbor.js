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

   IT IS A REGIONAL FIELD, NOT A SECOND INTERNATIONAL. 900 m of runway
   against Halloran's 1,090, three stands against four gates, no jet bridge,
   no concourse to walk through — a check-in counter under the kerb canopy.
   That is what the kit builds, and it is the honest silhouette for a port
   town of Cape Harbor's size.

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
  const AP_X = CH_X + 380, AP_Z = CH_Z + 565;
  const YAW = 0.28 + Math.PI;             // runway 20/02, kerb facing the town

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
      runway: { len: 900, w: 30, tdz: 150 },
      // LOCAL metres, all of them. The kit lays the surfaces these imply.
      taxiZ: 48, apronZ: 88, standZ: 74, termZ: 112, kerbZ: 126,
      // three stands down the ramp, noses out toward the taxiway (-Z local),
      // with the same 55 m pitch Halloran parks its airliners on.
      gates: [
        { id: "CHR-1", lx: -55, lz: 74, heading: -Math.PI / 2 },
        { id: "CHR-2", lx: 0, lz: 74, heading: -Math.PI / 2 },
        { id: "CHR-3", lx: 55, lz: 74, heading: -Math.PI / 2 },
      ],
      // ONE airliner sits on the ramp; the other two stands stay open so the
      // scheduled flights have somewhere to park when they arrive.
      parked: 1,
      // the check-in counter, under the landside canopy, facing the kerb.
      desk: { lx: 0, lz: 120, heading: 0, label: "Cape Harbor Regional. Check-in" },
      // the causeway plug: the town's far edge, the one the kerb faces.
      road: { x: CH_X, z: CH_Z + CH_HZ },
    });
    if (ap) ap.hub = false;
  }, 22);
})();
