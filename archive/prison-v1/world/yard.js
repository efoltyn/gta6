/* ============================================================
   world/yard.js — the outdoor perimeter. The compound is now far
   larger: the original north exercise yard is unchanged, then the
   walls STEP OUTWARD at z=52 into a wider, longer "South Block"
   (workshops, chapel, infirmary, lower yard, sally port) with the
   freedom gate at the very far south. All extents come from
   CBZ.WORLD so the perimeter, clamp, minimap and towers agree.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox, COL, DIM, WORLD } = CBZ;
  const { WALL, TRIM } = COL;
  const YH = DIM.YH;
  const N = WORLD.northYard, S = WORLD.southBlock, gap = WORLD.exit.gap;

  // THE PERIMETER HOLDS (2026-08-06). Explosions now open real walk-through
  // holes in walls everywhere, not just the city (city/fracture.js blastAt ->
  // buildings.js carveHole). That is a gift to the prison's INTERIOR — the gun
  // room stocks an RPG, so blowing your way through the block is the gun-room
  // grammar chained into itself. Applied to the OUTER wall it would collapse
  // the whole escape game into one verb and orphan the authored gradient the
  // keycard, the maintenance crawls, the ceiling hatches, the drainage and the
  // culvert (world/escape_routes.js) exist to be. So every segment of the
  // compound perimeter declares `noBreach`: the blast still scars it, shakes
  // the camera and throws debris — it just does not open. ONE line, and it is
  // the whole policy; delete it and the prison becomes a jailbreak sandbox.
  const wall = (x, z, w, d) => {
    const m = addBox(x, YH / 2, z, w, YH, d, WALL, { solid: true, blockLOS: true });
    if (m && m.userData && m.userData.collider) m.userData.collider.noBreach = true;
    return m;
  };
  // red warning trim hugging a wall top; ax 'x' runs along x, 'z' along z
  function trim(x, z, len, ax) {
    if (ax === "z") addBox(x, YH - 0.5, z, 0.4, 0.4, len, TRIM, { cast: false });
    else addBox(x, YH - 0.5, z, len, 0.4, 0.4, TRIM, { cast: false });
  }

  // ---- north exercise yard (original footprint, x[-30,30] z[-8,52]) ----
  const nW = N.x1 - N.x0, nCx = (N.x0 + N.x1) / 2;
  const nLen = N.z1 - N.z0, nCz = (N.z0 + N.z1) / 2;
  wall(N.x0, nCz, 1, nLen);  // west
  wall(N.x1, nCz, 1, nLen);  // east
  trim(N.x0, nCz, nLen, "z");
  trim(N.x1, nCz, nLen, "z");

  // close the gap between the (narrow) cell block and the yard's north end
  wall(-23, N.z0, 14, 1);  // x[-30,-16]
  wall(23, N.z0, 14, 1);   // x[16,30]

  // ---- step the walls outward at z=52 (the yard widens going south) ----
  // only the widened shoulders are walled; the central x[-30,30] is an
  // open throat connecting the two yards.
  const stepW = (S.x1 - N.x1);               // how far each side juts out (14)
  wall(N.x0 - stepW / 2, N.z1, stepW, 1);    // west shoulder  x[-44,-30]
  wall(N.x1 + stepW / 2, N.z1, stepW, 1);    // east shoulder  x[30,44]

  // ---- south block (wider + longer, x[-44,44] z[52,128]) ----
  const sLen = S.z1 - S.z0, sCz = (S.z0 + S.z1) / 2;
  wall(S.x0, sCz, 1, sLen);  // west
  wall(S.x1, sCz, 1, sLen);  // east
  trim(S.x0, sCz, sLen, "z");
  trim(S.x1, sCz, sLen, "z");

  // far south wall with the exit gap in the middle
  const halfRun = (S.x1 - gap);              // length of each side segment (40)
  const segC = (gap + S.x1) / 2;             // centre of each segment (24)
  wall(-segC, S.z1, halfRun, 1);             // south-left   x[-44,-4]
  wall(segC, S.z1, halfRun, 1);              // south-right  x[4,44]
  trim(-segC, S.z1, halfRun, "x");
  trim(segC, S.z1, halfRun, "x");

  /* ==========================================================
     THE COMPOUND CLAIMS ITS GROUND (PRISON_ROAD_FIX).

     OWNER: "there's a road going through the jail."

     Two separate faults produced one picture, and this is the second of them
     (the first is the compound's own 9 m paving — world/ground.js).

     THE PRISON WAS NEVER REGISTERED AS A PLACE. The escape arena stands in the
     SAME world coordinate space as the city (src/config.js: "all three worlds
     coexist" — prison near z≈0, city near z≈-700), and `city.regions` has been
     the registry of PLACES since worldmap.js shipped. The compound appears in
     it ZERO times. So:
       · CBZ.roadClearance / roadClamp (city/roadrules.js) build their place
         table from `city.regions` and their keep-out table from `city.noSpawn`.
         With the prison in NEITHER, the shared law that stops every other
         builder crossing a facility had literally nothing to test against —
         no road in this game could ever be blocked by the prison;
       · worse, the ground is claimed by SOMEBODY ELSE. city/island_airport.js
         registers Halloran Field as x[-1120,70] z[-280,40], which covers the
         whole cell block and the northern two-thirds of the exercise yard, and
         its landside kerb road record runs at z = 38.5 for x[-260,48] — i.e.
         straight down the north yard, entering at x=-30 and leaving at x=+30.
         Under the destination rule that road is LEGAL, because it sits inside
         its own owner's region.
     The airport geometry is parented to `city.root` and hidden outside city
     mode, so it is not what the escape-mode camera sees — but the ROAD RECORD
     is global and never mode-gated, which is why `citySpawnBlocked` refuses
     points in the yard and why detail_kit's kerb walkers will stand street
     furniture inside a prison.

     BUT THE WORLDS ARE PARALLEL, AND THE REGISTRIES ARE NOT (orchestrator
     merge finding, 2026-08-03). The first cut of this fix registered the
     compound in `city.regions` + `city.noSpawn`, exactly like a city facility
     — and the math gate immediately proved that wrong four different ways
     (region overlap with Halloran Field, a foreign biome in the golden set,
     the kerb record "crossing a restricted facility" it legally predates, and
     13 kerb-walker props suddenly "inside a place"). The truth is that the
     three worlds STACK on shared coordinates by design and toggle visibility
     per mode: in city mode this ground is open grass and the airport kerb is
     the terminal's only access; in escape mode the airport's road record has
     no deck, no traffic and no consequence. Neither facility is wrong, and a
     registry that cannot say "in which world" cannot hold either claim.
     So the compound claims NOTHING in the city's registries. What the owner
     actually saw from the air was the compound's own 9 m lined paving —
     fixed for real in world/ground.js — and walkwayW below stays the ratchet
     for it. (The city-side COUNTY jail is a real city building and does
     register/keep-out properly — see games/jail.js.)
     ========================================================== */
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_ROAD_FIX == null) CBZ.CONFIG.PRISON_ROAD_FIX = true;
  const RECT = {
    minX: Math.min(N.x0, S.x0) - 6, maxX: Math.max(N.x1, S.x1) + 6,
    minZ: (WORLD.cellBlock ? WORLD.cellBlock.z0 : -44) - 6, maxZ: S.z1 + 8,
  };

  /* THE RATCHET. `walkwayW` is the owner's complaint stated as a number: the
     compound's own paving was 9 m of lined carriageway, and 2.8 kerbed metres
     is the fix. `cityRecordsUnder` counts city-world road records whose
     footprint passes under the compound's coordinates — expected 1 (the
     Halloran Field kerb, invisible and traffic-free in escape mode); it is
     printed so a NEW record sneaking under the prison is still seen. */
  CBZ.prisonRoadAudit = function () {
    const city = (CBZ.city && CBZ.city.arena) || null;
    let crossing = 0, near = 0;
    const roads = (city && city.roads) || [];
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      if (!r || !isFinite(+r.x) || !isFinite(+r.z)) continue;
      const hw = (+r.w || 12) / 2, hl = (+r.len || 0) / 2;
      const minX = r.vertical ? r.x - hw : r.x - hl, maxX = r.vertical ? r.x + hw : r.x + hl;
      const minZ = r.vertical ? r.z - hl : r.z - hw, maxZ = r.vertical ? r.z + hl : r.z + hw;
      if (maxX > RECT.minX && minX < RECT.maxX && maxZ > RECT.minZ && minZ < RECT.maxZ) crossing++;
      else if (maxX > RECT.minX - 40 && minX < RECT.maxX + 40 && maxZ > RECT.minZ - 40 && minZ < RECT.maxZ + 40) near++;
    }
    const regions = (city && city.regions) || [];
    let mine = 0, overlapping = 0;
    for (let i = 0; i < regions.length; i++) {
      const g2 = regions[i];
      if (!g2) continue;
      if (g2._govOwner === "prison") { mine++; continue; }
      if (g2.kind === "rect" && g2.maxX > RECT.minX && g2.minX < RECT.maxX && g2.maxZ > RECT.minZ && g2.minZ < RECT.maxZ) overlapping++;
    }
    return {
      on: CBZ.CONFIG.PRISON_ROAD_FIX !== false,
      cityRecordsUnder: crossing,         // parallel-world records below us; 1 known (airport kerb)
      roadsNearby: near,
      regions: mine,                      // 0 — the compound claims nothing in city registries
      foreignRegions: overlapping,        // Halloran Field is the known one
      walkwayW: (CBZ.prisonWalkway && CBZ.prisonWalkway.w) || 9,
      rect: RECT,
    };
  };
})();
