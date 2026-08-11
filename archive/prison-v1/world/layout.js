/* ============================================================
   world/layout.js — THE WORLD LAYOUT DIAL (map enlargement, stage 2).

   OWNER GOAL: "make the map and biomes significantly bigger, and get rid
   of all the overlaps." Stage 1 routed every biome/island anchor through
   CBZ.worldOff(id) with all-zero offsets (world byte-identical). THIS is
   stage 2: the offsets below are non-zero — each landmass slides radially
   OUTWARD from the mainland city (city + commerce annex stay authored),
   the causeway cross-links re-derive from the anchors they join, and the
   FLAT terrain contract + continent margin grow to match (see
   CBZ.WORLD_ENLARGE_FLAT below, consumed by world/terrain.js).

   HOW THE NUMBERS WERE CHOSEN (constraints, not taste):
   • snow is UN-PINNED (owner: "mountains need to be on a snow area on an
     island very far from regular shit"): biome_snow.js now authors its
     interior in the stage-1 frame and maps world→authored inside every
     exported oracle (snowTerrainHeightAt/snowRunXAt/greaterMercy*), and
     terrain_overhaul's snow window/sector ride the dial too — so the
     whole alpine island + its Greater Mercy envelope + every backdrop
     range translate RIGIDLY with this one offset. dz -800 parks the
     island ~1 km of open sea north of the nearest landmass; the Mercy
     Causeway re-derives from the anchors and stretches to the fixed
     speedway handoff. dx stays 0 so the causeway lane (x 458..482)
     keeps meeting the speedway annex leg.
   • speedway/snow keep dx aligned with the Mercy Causeway lane (x≈470)
     and the Ironjaw Arena plug at x=482 — the arena approach must keep
     touching the lane, and the lane must stay west of the arena rect.
   • airport dx is capped ≈ -220: its causeway's mainland end is fixed at
     x∈[-12,12], so the airport's east edge (290+dx) must keep a shoulder
     east of the deck.
   • nations move OUTWARD at least as far as the biomes nearest them
     (desert/farmland +450 east ≤ veridia/kesh/solara +700; forest -300
     west ≤ mbeya -600), and neonreef/foundry match/exceed the airport's
     westward slide so the 50u Neon Reef seam survives.
   • the whole region union (nations included) must stay well inside the
     continent bail (union + 2×margin ≤ 12000, see city/continent.js) —
     with these offsets the union is ≈ 6160 wide (kolo -3126 .. solara
     3030) × ≈ 2860 deep, so W ≈ 6.2k + 2×2200 ≈ 10.6k and D ≈ 7.3k with
     the enlarged margin. Verify with tools/terrain-map-audit.mjs: zero
     cross-biome overlaps at any seed.

   REVERT: CBZ.CONFIG.WORLD_ENLARGE_V2 = false → every offset returns to
   zero and the enlarged FLAT/margin collapse with it (stage-1 world).
   This file loads BEFORE config.js, so the flag self-defaults here with
   the standard null-guard idiom; config.js documents it.

   ------------------------------------------------------------------
   STAGE 3 — WORLD_LAYOUT_V2 (owner: "the cities and mountains are good
   but they are much too close together … the map should be much more
   intentionally laid out"). Stage 2's offsets bought SOME room and then
   ran out: the measured world still had a 120u strait between Redhollow
   Forest and Fort Brandt, 180u between Diamond Speedway and the
   Saltlands, and 69u between Goldspire and Cape Harbor. That is not
   "open country", it is a seam.

   STAGE 3 IS THE SAME DIAL, TURNED FURTHER, WITH INTENT:
     • RING 0 (unmoved)  mainland city + commerce annex — the one dense
       downtown, dead centre. Everything else is measured from it.
     • RING 1 (~500-1100) airport W, speedway E — the big satellites.
     • RING 2 (~1300-2200) military/forest NW, neonreef/foundry W,
       goldspire/capeharbor S, desert/farmland E — real towns, real gaps.
     • RING 3 (rim)      the alpine north (snow + the Greater Mercy
       range) and the four nations. The rim is where the mountains and
       the SMALL settlements live; the middle is where the big city is.
   Every strait above roughly doubles or better (see the table's inline
   arithmetic). The offsets stay build-time constants — no rng.

   WHAT THIS FILE DOES *NOT* OWN, and the one file that must follow it:
   city/highwaynet.js hard-codes seven "free-country lane" constants
   (timberX/corridorZ/westX/southZ/eastX/foothillZ/dunesX + one R5
   waypoint) that were measured against the STAGE-2 gaps. They do not
   derive from CBZ.worldOff and they must be retuned in the same change
   — see this file's git message / the layout report for the exact
   values. highwaynet's clearanceSweep() warns (console.warn, never
   throws) when a leg clips a landmass, so a stale table is loud but not
   fatal.

   REVERT: CBZ.CONFIG.WORLD_LAYOUT_V2 = false → the stage-2 table, the
   stage-2 FLAT and every stage-3 consumer (continent rim relief,
   mini-city size gradient, authored-frame town seeding) collapse back to
   exactly today's world in one line.

   ------------------------------------------------------------------
   STAGE 4 — WORLD_SCALE_V4 (owner: "make the biomes much much much
   larger making the world massive — right now we have these square
   biomes basically, i want to make them more intentional").

   Stage 3 moved the landmasses apart. It never made any of them BIGGER:
   a biome's half-extents have been the same authored literals since the
   archipelago, so as the world spread the biomes became small tiles on a
   large board. Stage 4 turns TWO dials at once, and the ratio between
   them is the whole design:

     • SPREAD_V4 = SPREAD_V3 x 1.60  — every landmass moves 60% further
       out from the mainland (which never moves; it is the origin of the
       measurement).
     • FOOT — a per-biome LINEAR footprint scale (desert/farmland 1.60,
       forest 1.45, snow 1.30). The offsets grow AT LEAST as fast as the
       footprints, so every strait in the world ends at or above the
       number stage 3 measured. That is the constraint; the sizes are
       what it allows, not the other way round.

   THE FOOTPRINT IS PUBLISHED HERE, ONCE (CBZ.worldFoot). Before this,
   FOUR files hand-copied a biome's rect from another file's literals —
   terrain_overhaul.js re-typed the snow window (SNOW_CX/SNOW_HX/SNOW_NZ),
   biome_farmland.js re-typed the desert's north shore (DESERT_MINZ) —
   and every one of those copies was written against the AUTHORED size, so
   scaling a footprint anywhere else would have silently desynced them.
   The dial and the scale both live here, so the rect does too; every
   consumer reads CBZ.worldFoot(id) with its own literal as the
   degrade-safe fallback.

   PINNED AXES (each is a hard geometric contract, not taste; all seven
   were verified against the shipped decks before this table was written):
     • snow.dx = 0        — the Mercy Causeway lane (x 458..482) must keep
                            meeting the speedway annex leg and stay west of
                            the Ironjaw Arena rect (x >= 510). Neither moves.
     • airport.dx = -220  — its causeway's mainland end is fixed at
                            x in [-12,12]; the field's east edge (290+dx)
                            must keep a shoulder east of that deck.
     • speedway.dx = 400  — LIVE BUILD ZONE. Diamond Speedway and the
                            Ironjaw Arena are being worked on at their
                            current absolute coordinates; a world that is
                            massive around them is worth more than 240 m
                            of extra slide, so this one stays put and the
                            desert moves east instead.
     • goldspire.dx = 0   — highwaynet R3 runs north up x=goldX to z=-200
                            and Halloran Field's east edge is x=70.
     • capeharbor.dx=180  — its link deck (x=cx+-12) must clear the
                            speedway's west rim (x 680); at 180 it clears
                            by 58 u and the speedway is pinned, so the cap is.
     • neonreef.dz = 0    — its link causeway runs west-to-east onto
                            Halloran Field's west edge, so its centreline z
                            has to stay inside the airport's z-span.
     • military.dz        — must stay a multiple of the mainland's 50 u grid
                            step (its HWY-4 connector lands on a cross-street).
                            1.60 x -300 = -480. Exact, no rounding needed.

   REVERT: CBZ.CONFIG.WORLD_SCALE_V4 = false → the stage-3 table, the
   stage-3 FLAT, authored footprints and the authored sea span return in
   one line. Consumers: city/continent.js (plate roof + segment count),
   city/world.js (sea bounds), all four biome files, terrain_overhaul.js,
   city/highwaynet.js (the free-country lanes were re-measured against the
   stage-4 rects — see that file).

   ------------------------------------------------------------------
   STAGE 5 — WORLD_SCALE_V5 (owner: "make the desert 10x bigger and make
   water around world 10x bigger, world will become island").

   TWO NUMBERS, AND THEY ARE READ AS AREA. "10x bigger" applied to a 2D
   basin is 10x the AREA, i.e. x sqrt(10) = 3.162 in each direction. The
   linear reading is not a smaller version of the same idea, it is a
   different world: 10x LINEAR is 100x the area, a 14 x 15 km erg — wider
   than the entire stage-4 region union including all four nations — and
   there is no offset table that keeps a strait open around it. So:

     • DESERT FOOT 1.60 -> 5.06 (= 1.60 x sqrt(10)). The Saltlands go
       1408 x 1504 m -> 4453 x 4756 m, i.e. 2.12 km^2 -> 21.2 km^2 of erg.
       Ten times the sand, and the ONE dial that says so.
     • SEA_OPEN_WATER 2.3 -> 5.45. The published ocean goes 34 km ->
       108 km across: 1156 km^2 -> 11664 km^2, also 10x the area. The land
       reaches 7.7 km from the sea's centre and the water reaches 54 km,
       so the whole continent is a 7% smudge in the middle of an ocean —
       "the world becomes an island" is what that ratio MEANS, and it is
       the ratio, not the coastline, that had to move.

   THE DESERT GROWS EAST AND SOUTH, NOT OUTWARD FROM ITS OWN CENTRE, and
   that is the entire layout design. Holding the basin's NORTH-WEST corner
   (minX 1719, minZ -301 — within 3 u of the stage-4 corner, in the safe
   direction on both axes) keeps three shipped contracts intact for free,
   none of which would survive a symmetric expansion:
     • the Saltlands causeway — the desert's only land link — still docks
       on the speedway's east rim at the same chord (its z clamps into the
       basin's north edge, which has not moved);
     • the speedway<->desert strait stays at its stage-4 618 u (the
       speedway is a live build zone and is PINNED);
     • the Coyle<->Saltlands strait stays at 989 u, so biome_farmland's
       county does not have to move at all.
   What it costs is that the basin's CENTRE — and with it the Dry Gulch
   spine, the town and the mesa spread — walks 2.3 km south, so the
   causeway now lands 2.3 km north of the highway it exists to reach.
   biome_desert.js answers that with an approach leg (see its section 9);
   a 10x basin whose only entrance dead-ends in open dune is not a bigger
   desert, it is a bigger nothing.

   THE NATIONS MOVE, NOTHING ELSE DOES. The grown basin runs east to
   x 6171, which is 1.9 km past veridia's west edge, so veridia/kesh/
   solara slide dx 2400 -> 5600. mbeya (far west), the forest, the alpine
   north, the mini-cities and every ring-0/1 anchor are untouched: only
   what the desert would have swallowed had to move.

   REVERT: CBZ.CONFIG.WORLD_SCALE_V5 = false -> the stage-4 table, scale,
   FLAT, sea multiplier and plate roof return in one line. Consumers:
   city/continent.js (plate roof + segment cap), city/biome_desert.js
   (mesh tiling, scatter density, the approach leg), city/highwaynet.js
   (the two free-country lanes the basin now covers).

   DETERMINISM: offsets are build-time constants (no rng, no per-seed
   variation), so worlds stay byte-identical per seed across clients.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // config.js's generic ?cfg_FLAG URL override runs AFTER this file (script
  // order: layout → terrain → config), so sniff this ONE flag here too —
  // otherwise ?cfg_WORLD_ENLARGE_V2=0 could never reach the offset table.
  try {
    if (typeof location !== "undefined" && location.search) {
      const q = new URLSearchParams(location.search);
      const v = q.get("cfg_WORLD_ENLARGE_V2");
      if (CFG.WORLD_ENLARGE_V2 == null && v != null) CFG.WORLD_ENLARGE_V2 = !(v === "0" || v === "false");
      const v2 = q.get("cfg_WORLD_LAYOUT_V2");
      if (CFG.WORLD_LAYOUT_V2 == null && v2 != null) CFG.WORLD_LAYOUT_V2 = !(v2 === "0" || v2 === "false");
      const v4 = q.get("cfg_WORLD_SCALE_V4");
      if (CFG.WORLD_SCALE_V4 == null && v4 != null) CFG.WORLD_SCALE_V4 = !(v4 === "0" || v4 === "false");
      const v5 = q.get("cfg_WORLD_SCALE_V5");
      if (CFG.WORLD_SCALE_V5 == null && v5 != null) CFG.WORLD_SCALE_V5 = !(v5 === "0" || v5 === "false");
    }
  } catch (e) {}
  if (CFG.WORLD_ENLARGE_V2 == null) CFG.WORLD_ENLARGE_V2 = true;
  // STAGE 3 — the whole re-lay is this one flag (owner: a bad terrain change
  // is hard to eyeball and easy to regret, so it must be a one-line revert).
  // Consumers: city/continent.js (rim relief + plate bail + worldLayoutAudit),
  // city/minicities.js (authored-frame seeding + size gradient),
  // city/biome_snow.js (authored-frame Pinecrest seeding).
  if (CFG.WORLD_LAYOUT_V2 == null) CFG.WORLD_LAYOUT_V2 = true;
  // STAGE 4 — the biomes themselves get bigger (see the header). Rides on top
  // of stage 3: turning stage 3 off turns this off with it, because a
  // footprint scale without the spread that pays for it would close every
  // strait the re-lay opened.
  if (CFG.WORLD_SCALE_V4 == null) CFG.WORLD_SCALE_V4 = true;
  // STAGE 5 — the desert goes 10x by area and the sea goes 10x with it. Rides
  // on top of stage 4 for the same reason stage 4 rides on stage 3: the basin
  // is grown by turning the stage-4 footprint scale further, and a footprint
  // without the spread that pays for it closes every strait east of the city.
  if (CFG.WORLD_SCALE_V5 == null) CFG.WORLD_SCALE_V5 = true;
  const ON = CFG.WORLD_ENLARGE_V2 !== false;
  const V3 = ON && CFG.WORLD_LAYOUT_V2 !== false;
  const V4 = V3 && CFG.WORLD_SCALE_V4 !== false;
  const V5 = V4 && CFG.WORLD_SCALE_V5 !== false;

  // Per-landmass translation, applied to each file's anchor constants.
  // Zero = the stage-1 authored spot. Flag off = ALL zero (old world).
  const SPREAD_V2 = {
    // biomes / islands (anchor consts in their own files)
    snow:     { dx: 0,    dz: -800 },   // FAR north — alpine island alone in open sea (see header)
    forest:   { dx: -300, dz: -200 },   // NW, keeps 120u strait to military
    desert:   { dx: 450,  dz: 100 },    // E/SE, opens the speedway strait
    farmland: { dx: 450,  dz: -200 },   // NE, tracks the desert eastward
    speedway: { dx: 250,  dz: 0 },      // E; annex causeway legs stretch
    military: { dx: -300, dz: -150 },   // W/NW; east causeway lengthens.
    //          dz MUST stay a multiple of the mainland's 50u grid step: the
    //          causeway deck rides CEN_Z and its HWY-4 mainland connector
    //          (highways.js buildArterials) must land ON a grid cross-street
    //          (zLines -850..-550) — -150 puts the deck on zLines[0].
    airport:  { dx: -220, dz: 0 },      // W (capped by the fixed causeway)
    // mini-cities (city/minicities.js placements)
    goldspire:  { dx: 0,    dz: 250 },  // S, off the mainland shore
    capeharbor: { dx: 0,    dz: 250 },  // S
    neonreef:   { dx: -280, dz: 0 },    // W, stays west of the airport
    foundry:    { dx: -280, dz: 0 },    // W
    // nation sites (city/countries.js settlement data)
    veridia: { dx: 700, dz: 0 },
    kesh:    { dx: 700, dz: 0 },
    solara:  { dx: 700, dz: 250 },      // SE corner
    mbeya:   { dx: -600, dz: 0 },       // far west
  };

  // ------------------------------------------------------------------
  // STAGE 3 (WORLD_LAYOUT_V2). Each entry carries the strait it opens,
  // measured world-AABB to world-AABB. "was" = the stage-2 number the
  // audit actually read on 2026-07-27, so every claim here is checkable.
  // ------------------------------------------------------------------
  const SPREAD_V3 = {
    // --- RING 3: the alpine north. dx MUST stay 0 — the Mercy Causeway
    //     lane (x 458..482) has to keep meeting the speedway annex leg and
    //     stay west of the Ironjaw Arena rect (x>=500), and neither moves.
    //     dz -1500 parks Mount Mercy ~2.06 km of open country north of the
    //     speedway (was 1.36 km) and drags the whole Greater Mercy range,
    //     its backdrop ranges and the terrain FLAT north with it.
    //     THE MERCY CAUSEWAY / COMMERCE ANNEX CLASH — MEASURED, THEN FIXED
    //     (2026-07-27). biome_snow.js authored the deck at x 458..482 (berms
    //     455.7..484.3) running from the snow shore (z -2620) south to the
    //     speedway hand-off at z -552. The annex is a 120 m disc at
    //     (city.maxX + 215, city.center.z) = (380, -700) plus a 14 m sand
    //     ring; at the deck's west edge the island spans z -810.6..-589.4 —
    //     so the deck crossed ALL of it: ~220 m of 24 m concrete + white berm
    //     over the island's street grid, deck at y 0..0.6 against island
    //     ground at y 0 and island asphalt at y 0.05. That z-fight is what
    //     read to the owner as a translucent "ghost city" beside the real one.
    //     It was NOT a stage-3 regression — true since the lane was first
    //     derived from the speedway. The annex could not dodge it: west is the
    //     mainland harbour bay ring (x 193..260) and the east gap to the
    //     Ironjaw Arena region (west edge x 514) is ZERO. So the CORRIDOR
    //     terminates instead: biome_snow's causewayCut() derives the cut from
    //     `city.annex`'s own published cx/cz/radius at build time (expansion
    //     runs before cityWorldGeo), ending the deck at z -820.1 — 9.5 m clear
    //     of the sand. The Ironjaw approach junction at z -950 is 130 m north
    //     of the new end, so the arena keeps its mountain link.
    //     LOST, AND STATED PLAINLY: the butt-joint onto the speedway leg at
    //     z -540. That link belongs to expansion.js, which still owes the
    //     annex a road to the speedway leg 26 m off its south beach.
    //     Note it escaped roadrules.js's clearance law TWICE — the deck is
    //     GEOMETRY (only `city.roads` records are clamped) and the name
    //     "Mercy Causeway" matches the CONNECTOR exemption — which is why a
    //     240 m city island could be crossed by a highway for months.
    //     city/expansion.js now also registers the annex in `city.regions`; it
    //     never had been, which is why every clearance and spacing rule in the
    //     game was blind to it.
    snow:     { dx: 0,     dz: -1500 },
    // --- RING 2 NW. forest<->military strait 120u -> 330u; the Redhollow
    //     causeway (forest MAXZ -> military MINZ) stretches to match.
    forest:   { dx: -560,  dz: -560 },
    military: { dx: -560,  dz: -300 },
    //          dz MUST stay a multiple of the mainland's 50u grid step: the
    //          causeway deck rides CEN_Z and its HWY-4 mainland connector
    //          (highways.js buildArterials) must land ON a grid cross-street
    //          (zLines -850..-550). The Brandt deck (x MAXX..-133, fixed
    //          east end) simply gets longer.
    // --- RING 2 E. speedway<->desert strait 180u -> 400u; desert<->farmland
    //     460u -> 940u. The Saltlands causeway west end tracks the SPEEDWAY
    //     dial (biome_desert CW_X0) so both shores stay touching.
    desert:   { dx: 820,   dz: 300 },
    farmland: { dx: 860,   dz: -480 },
    // --- RING 1 E/W. speedway east; airport stays capped at -220 (its
    //     causeway lane x∈[-12,12] is pinned to the mainland slip, so the
    //     field's east edge 290+dx must keep a shoulder east of the deck).
    speedway: { dx: 400,   dz: 0 },
    airport:  { dx: -220,  dz: 0 },
    // --- RING 2 S/W mini-cities (city/minicities.js placements).
    //     goldspire<->capeharbor was SIXTY-NINE metres apart; the pure-south
    //     slide opens that to a 229u corner gap (222u clear in x) without
    //     moving either economy off its authored spot in the frame.
    //     goldspire dx MUST stay 0: highwaynet's R3 runs NORTH up x=goldX all
    //     the way to z=-200, and Halloran Field's east edge is x=70 — a probe
    //     with dx -80 put that deck 12u inside the airport. Its link causeway
    //     also has to stay VERTICAL (|road.x - cx| < |road.z - cz|) for the
    //     R3 dock, which the big dz guarantees.
    //     capeharbor dx is capped at +180: its link causeway is a vertical
    //     deck at x=cx and must clear the speedway's west rim (x 680) — at
    //     dx 180 the deck (x 598..622) clears by 58u. Its `road` plug
    //     (470,-130) keeps it vertical, which the highwaynet R2 dock needs.
    //     neonreef dz MUST stay 0: its link causeway runs WEST-to-EAST onto
    //     Halloran Field's west edge, so its centreline z has to stay inside
    //     the airport's z-span [-280,40].
    goldspire:  { dx: 0,    dz: 560 },
    capeharbor: { dx: 180,  dz: 560 },
    neonreef:   { dx: -640, dz: 0 },
    foundry:    { dx: -640, dz: 340 },
    // --- RING 3: the nations. They stay air/boat-only, so they are free to
    //     go furthest out; they only have to clear the biomes nearest them
    //     (desert maxX 2380 / farmland maxX 2440 < kesh minX 3300;
    //     forest minX -1510 > mbeya_east maxX -3274).
    veridia: { dx: 1500,  dz: 0 },
    kesh:    { dx: 1500,  dz: -400 },
    solara:  { dx: 1500,  dz: 640 },     // SE corner
    mbeya:   { dx: -1400, dz: -250 },    // far west
  };

  // ------------------------------------------------------------------
  // STAGE 4 (WORLD_SCALE_V4). SPREAD_V3 x 1.60, with the seven pinned axes
  // from the header held at their stage-3 values. Every entry below carries
  // the strait it is answerable for, measured world-AABB to world-AABB
  // against the STAGE-4 footprints (i.e. after the biomes grew) — "was" is
  // the stage-3 number, so no claim here is a guess.
  // ------------------------------------------------------------------
  // (the multiplier is 1.60 throughout; it is written out per entry rather
  // than applied in code so every number here is readable at a glance and a
  // pinned axis cannot be silently un-pinned by a loop.)
  const SPREAD_V4 = {
    // --- RING 3 alpine. dx PINNED 0 (Mercy lane / Ironjaw). dz 1500->2400
    //     parks Mount Mercy 692 u of open country north of Redhollow Forest
    //     in z and 698 u clear in x (corner strait 982, was 762), and drags
    //     the whole Greater Mercy envelope + every backdrop range with it.
    snow:     { dx: 0,     dz: -2400 },
    // --- RING 2 NW. forest<->military strait 330 -> 341 u even though the
    //     forest itself grew 45% (that is the ratio doing its job); the
    //     Redhollow causeway (forest MAXZ -> military MINZ) re-derives.
    forest:   { dx: -900,  dz: -900 },
    military: { dx: -900,  dz: -480 },      // -300 x 1.60 = -480, still a 50 u multiple
    // --- RING 2 E. desert dz is PINNED at 300, and that is a fix, not a
    //     freeze: the Saltlands causeway is the desert's only land link to
    //     the speedway and it must land on BOTH shores. Holding dz while the
    //     footprint grows walks the desert's north shore from z -20 to -302,
    //     back INTO the speedway's z-span, which is what lets biome_desert's
    //     new derivation put the deck on real ground (it has been ending 280 u
    //     short in open water since stage 3 moved the basin south).
    //     speedway<->desert strait 400 -> 616 u.
    desert:   { dx: 1300,  dz: 300 },
    //     farmland dz is NOT 1.60 x -480 (-768) but -1050: the desert's own
    //     footprint grew north by 282 u, so holding the Coyle<->Saltlands
    //     strait at its stage-3 value (940 u) needs dz <= -1002. -1050 gives
    //     988 u. THE STRAIT IS THE CONSTRAINT; the offset is what it costs.
    farmland: { dx: 1380,  dz: -1050 },
    // --- RING 1 E/W. Both PINNED (see header): the speedway/arena are a live
    //     build zone and the airport causeway is nailed to the mainland slip.
    speedway: { dx: 400,   dz: 0 },
    airport:  { dx: -220,  dz: 0 },
    // --- RING 2 S/W mini-cities. dx PINNED on both; the slide is pure south.
    //     goldspire and capeharbor deliberately take DIFFERENT dz (900 vs
    //     820): stage 3 moved them by the same amount, so their 229 u corner
    //     strait — the tightest in the world before stage 3, at 69 u — could
    //     never open again. 80 u of differential opens it to 260 u.
    goldspire:  { dx: 0,    dz: 900 },
    capeharbor: { dx: 180,  dz: 820 },
    neonreef:   { dx: -1030, dz: 0 },       // dz PINNED (its link runs onto the airport's west edge)
    foundry:    { dx: -1030, dz: 540 },
    // --- RING 3 nations: air/boat only, so they go furthest. They only have
    //     to clear the biomes nearest them, and those biomes just grew:
    //     farmland maxX 3200 < keshtown minX 4200; desert maxX 3124 <
    //     veridia minX 4255; forest minX -2026 > mbeya_east maxX -4114.
    veridia: { dx: 2400,  dz: 0 },
    kesh:    { dx: 2400,  dz: -640 },
    solara:  { dx: 2400,  dz: 1020 },       // SE corner
    mbeya:   { dx: -2240, dz: -400 },       // far west
  };

  // ------------------------------------------------------------------
  // STAGE 5 (WORLD_SCALE_V5). SPREAD_V4 with exactly SIX entries changed —
  // the desert, because it is the thing that grew, and the three nations it
  // would otherwise have run over. Everything else is SPREAD_V4 verbatim:
  // a landmass that the 10x basin does not reach has no reason to move, and
  // moving it would churn straits that are already measured and correct.
  // ------------------------------------------------------------------
  const SPREAD_V5 = Object.assign({}, SPREAD_V4, {
    // --- RING 2 E. THE 10x BASIN. Both offsets are chosen to HOLD the
    //     basin's north-west corner while its half-extents triple, which is
    //     what keeps the causeway docks and both straits at their stage-4
    //     values (see the header):
    //       dx: minX 1718.6 = 1120 + 2825 - 2226.4   (was 1716)
    //           -> speedway<->desert strait 618.6 u (was 616). The speedway
    //              is PINNED at dx 400, so this is the whole margin there is.
    //       dz: minZ -301.2 = 150 + 1927 - 2378.2    (was -302)
    //           -> Coyle<->Saltlands strait 988.8 u (was 988), so biome_
    //              farmland's county does not move and its causeway, which
    //              re-derives from our published rect, still docks.
    //     The basin therefore runs x 1719..6171, z -301..4455: it grows
    //     3044 u east into open sea and 3252 u south into open sea, and
    //     touches nothing on the two sides where the world already is.
    desert:   { dx: 2825,  dz: 1927 },
    // --- RING 3 nations. 2400 -> 5600, dz unchanged. They are air/boat-only
    //     so the only question is clearance, and the basin's new east shore
    //     (6171) is the constraint: veridia minX 7455 clears it by 1284 u,
    //     solara minX 7670 by 1499 u (solara is the only one whose z-span
    //     lies INSIDE the basin's, so it is the one that had to clear in x),
    //     keshtown minX 7400 clears farmland maxX 3200 by 4200 u.
    //     mbeya is NOT here: it is 4.8 km the other way and the desert never
    //     reaches it, so it keeps its stage-4 offset exactly.
    veridia: { dx: 5600,  dz: 0 },
    kesh:    { dx: 5600,  dz: -640 },
    solara:  { dx: 5600,  dz: 1020 },
  });

  const SPREAD = V5 ? SPREAD_V5 : (V4 ? SPREAD_V4 : (V3 ? SPREAD_V3 : SPREAD_V2));
  const ZERO = { dx: 0, dz: 0 };
  const OFFSETS = {};
  for (const id in SPREAD) OFFSETS[id] = ON ? SPREAD[id] : ZERO;

  CBZ.WORLD_LAYOUT_OFFSETS = OFFSETS;
  // Consumers gate on `>= N`, never on equality — stage 5 is a stage-4 world
  // with a bigger basin, so every `>= 4` branch already shipped stays live.
  CBZ.WORLD_LAYOUT_STAGE = ON ? (V5 ? 5 : (V4 ? 4 : (V3 ? 3 : 2))) : 1;
  CBZ.worldOff = function (id) { return OFFSETS[id] || ZERO; };

  /* ==================================================================
     CBZ.worldFoot(id) — HOW BIG IS THAT BIOME, IN WORLD COORDINATES?

     The ONE answer, and the reason it lives here rather than in the
     biome that draws it: a footprint is (authored anchor) + (the dial)
     x (the scale), and this file is the only place that holds all three.
     Four files used to re-type another file's half-extents; each copy
     was written against the authored size and would have gone stale the
     moment anything scaled. Adoption is one line and degrade-safe —

       const F = (CBZ.worldFoot && CBZ.worldFoot("desert")) ||
                 { cx: 1120 + dx, cz: 150 + dz, hx: 440, hz: 470 };

     — so a build without this file keeps the authored literals exactly.

     THE SCALES ARE NOT UNIFORM, and each one is bounded by what its own
     generator can absorb without churning the world:
       desert   1.60  the erg is analytic; its mesh segment count rides
                      the footprint, so a bigger basin is a bigger basin.
                      This is the owner's headline biome (the dunes).
       farmland 1.60  free: its parcels are a fixed 4x4 grid, so a larger
                      county is larger FIELDS, not more geometry.
       forest   1.45  its trees come off a fixed 11 m grid, so area scales
                      the tree COUNT quadratically; the file scales its
                      grid pitch by sqrt(scale) to keep that linear.
       snow     1.30  deliberately the smallest: every peak, piste knuckle
                      and lift line in Mount Mercy is an authored literal
                      in the stage-1 frame, so growing the rect grows the
                      white country around a fixed massif. It also drags
                      the Greater Mercy envelope (whose south edge IS the
                      snow core's north edge), which is already the single
                      largest region in the world.
     STAGE 5 turns ONE of those four: desert 1.60 -> 5.06, which is
     1.60 x sqrt(10) and therefore exactly 10x the stage-4 AREA
     (2.12 km^2 -> 21.2 km^2). The other three do not move — the owner asked
     for the desert, and a farmland that grew with it would close the Coyle
     strait this table spent two stages opening.

     Flag off -> every scale is 1 and the authored rect returns byte for byte.
  ================================================================== */
  const FOOT_SCALE = V5
    ? { desert: 5.06, farmland: 1.60, forest: 1.45, snow: 1.30 }
    : (V4
      ? { desert: 1.60, farmland: 1.60, forest: 1.45, snow: 1.30 }
      : {});
  // AUTHORED anchors — the stage-1 literals each biome file declares. They are
  // repeated here ON PURPOSE and each names its owner, because this table has
  // to be able to answer for a biome whose file has not parsed yet
  // (terrain_overhaul.js asks about the snow country 300 script tags early).
  const FOOT_AUTHORED = {
    desert:   { cx: 1120, cz: 150,   hx: 440, hz: 470 },   // city/biome_desert.js
    farmland: { cx: 1180, cz: -880,  hx: 400, hz: 400 },   // city/biome_farmland.js (x 780..1580, z -1280..-480)
    forest:   { cx: -560, cz: -1350, hx: 390, hz: 330 },   // city/biome_forest.js
    snow:     { cx: 350,  cz: -1450, hx: 420, hz: 330 },   // city/biome_snow.js
  };
  const FOOT = {};
  for (const id in FOOT_AUTHORED) {
    const a = FOOT_AUTHORED[id], o = OFFSETS[id] || ZERO, s = FOOT_SCALE[id] || 1;
    const hx = a.hx * s, hz = a.hz * s;
    FOOT[id] = {
      scale: s,
      cx: a.cx + o.dx, cz: a.cz + o.dz, hx: hx, hz: hz,
      minX: a.cx + o.dx - hx, maxX: a.cx + o.dx + hx,
      minZ: a.cz + o.dz - hz, maxZ: a.cz + o.dz + hz,
    };
  }
  CBZ.WORLD_FOOTPRINTS = FOOT;
  CBZ.worldFoot = function (id) { return FOOT[id] || null; };
  // Linear scale only, for a generator that has to re-rate a grid pitch or a
  // segment count rather than a coordinate (forest's tree grid, desert's mesh).
  CBZ.worldFootScale = function (id) { const f = FOOT[id]; return f ? f.scale : 1; };

  // The enlarged seed FLAT rect for the terrain contract — the union of
  // every offset landmass ABOVE (nations included), with a small slack.
  // world/terrain.js grows its FLAT to this at build time (never shrinks),
  // so relief/backdrop rings stand clear of ALL land — including the far
  // nation sites, which the (no-op — CBZ.city is unset during landmass
  // build) live sync never actually covered; mbeya used to sit on 60u of
  // backdrop ring because of that. The north edge tracks the SNOW CORE
  // (authored -1890 + the snow dial's dz) so the seed rect hugs the moved
  // island exactly like it hugged the authored one; the Greater Mercy
  // envelope still overhangs FLAT on purpose (its live-synced rect pushes
  // the ring even further out behind snow-labeled cover).
  //
  // STAGE 3 numbers, derived the same way (region union + ~35u slack):
  //   minX  mbeya_west  cx -2460 + dx -1400 - hx 66 = -3926  ->  -3960
  //   maxX  solara      cx  2200 + dx  1500 + hx 130 = 3830  ->   3860
  //   minZ  snow core   -1890 + snow.dz (-1500)              =  -3390
  //   maxZ  solara      cz   600 + dz   640 + hz 125 = 1365  ->   1420
  // FLAT is 7820 x 4810 (was 6220 x 3720). This rect is the ONLY thing
  // that positions the backdrop relief ring (terrain.js terrainRingRadii /
  // terrain_overhaul.js distOutsideFlat), so growing it here is what walks
  // the mountains outward with the world — nothing else has to be told.
  //
  // STAGE 4 numbers, derived exactly the same way (region union + ~40u slack):
  //   minX  mbeya_west  cx -2460 + dx -2240 - hx 66  = -4766  ->  -4800
  //   maxX  solara      cx  2200 + dx  2400 + hx 130 =  4730  ->   4770
  //   minZ  snow core   FOOT.snow.minZ (-1450 -2400 -429)     =  -4279  ->  -4319
  //   maxZ  solara      cz   600 + dz  1020 + hz 125 =  1745  ->   1790
  // FLAT is 9570 x 6109 (was 7820 x 4810). As in stage 3 the Greater Mercy
  // envelope deliberately overhangs this seed to the north — syncTerrainFlat
  // grows the live rect over every registered region at build time, so the
  // ring walks out behind snow-labelled cover on its own.
  //
  // STAGE 5 numbers, same derivation again (region union + ~40u slack). Only
  // the two edges the 10x basin and the nations pushed actually move:
  //   minX  mbeya_west  UNCHANGED (-4766)                       ->  -4800
  //   maxX  solara      cx  2200 + dx  5600 + hx 130 =  7930    ->   7970
  //   minZ  snow core   UNCHANGED (FOOT.snow.minZ, snow.dz -2400) -> -4319
  //   maxZ  desert      FOOT.desert.maxZ 4455.2                 ->   4500
  // FLAT is 12770 x 8819 (was 9570 x 6109). maxZ is the FIRST time a BIOME
  // rather than a nation sets an edge of this rect, which is the whole point:
  // the erg is now the largest single thing in the world.
  const FLAT_V4 = { minX: -4800, maxX: 4770, minZ: Math.round(FOOT.snow.minZ) - 40, maxZ: 1790 };
  CBZ.WORLD_ENLARGE_FLAT = ON
    ? (V5
      ? { minX: -4800, maxX: 7970, minZ: FLAT_V4.minZ, maxZ: 4500 }
      : (V4
        ? FLAT_V4
        : (V3
          ? { minX: -3960, maxX: 3860, minZ: -1890 + SPREAD_V3.snow.dz, maxZ: 1420 }
          : { minX: -3160, maxX: 3060, minZ: -1890 + SPREAD_V2.snow.dz, maxZ: 1030 })))
    : null;

  /* ------------------------------------------------------------------
     CBZ.WORLD_RIM_REF — "how far out is this place, as a fraction of the
     INHABITED world?" (city/minicities.js's size gradient reads it).

     That gradient bends a town's SILHOUETTE by how rim-side it sits, and it
     was tuned against measured fractions: Neon Reef 0.44 (untouched, keeps
     its 38-storey crown), Cape Harbor 0.72, Goldspire 0.84 (44 -> 27). It
     read CBZ.WORLD_ENLARGE_FLAT, which means every world scale silently
     re-tunes it — and stage 5 is where that stops being a rounding error:
     the FLAT centre walks 1.6 km east and 1.35 km south to sit in the middle
     of the new erg, which would drop Goldspire from t 0.84 to t 0.29 and hand
     a shipped city 17 storeys nobody asked for.

     So the REFERENCE rect is pinned at the stage-4 FLAT and the growth of an
     empty quadrant no longer votes on how tall the casino is. This is not the
     terrain rim: continent.js's relief ring still rides the LIVE FLAT and
     walks out with the world, exactly as before. It is the answer to a
     different question — where the world's PEOPLE are — and that has not
     moved. Degrade-safe: consumers fall back to WORLD_ENLARGE_FLAT.
  ------------------------------------------------------------------ */
  CBZ.WORLD_RIM_REF = ON ? (V4 ? FLAT_V4 : CBZ.WORLD_ENLARGE_FLAT) : null;

  /* ------------------------------------------------------------------
     THE SEA'S FOOTPRINT, DERIVED (city/world.js reads this).

     SEA_WORLD_SPAN was a 16000 literal centred on (310,-750), sized by
     hand against a world whose plate reached x +-6100. The rendered ocean
     is a CAMERA-CENTRED radial disc (world/water_spec.js), so this number
     is not the drawn extent — it is the published BOUNDS record that
     waterfield.js, waterfx.js, water_spec.js and games/ocean.js all read
     to answer "is this open sea", plus the geometry's bounding box. A
     world that grows past it gets land the water system does not know
     about, which is the same class of bug as the backdrop standing on the
     plate.

     So it derives: the furthest FLAT corner from the sea's centre, plus
     the continent margin (the plate is FLAT + that belt), x OPEN_WATER for
     the water past the last beach. Stage 4 measures
       max(|-4800-310|, |4770-310|, |-4320+750|, |1790+750|) = 5110
       (5110 + 2200) x 1.7 = 12427  ->  half 12500, span 25000
     which clears the stage-4 plate (x +-6966 / z -8700..3945) on every
     side. Flag off -> null -> world.js keeps its 16000 literal.

     OWNER (2026-07-29): "make water absolutely massive". OPEN_WATER 1.7 ->
     2.3 is the ONE number that grows the sea, and it is the honest place to
     do it: the land is untouched (this reads the FLAT rect, it does not
     write it), so no region moves, no biome rect changes and the terrain
     gate's mountains-outside-snow / city-on-mountain sets are identical.
       (5110 + 2200) x 2.3 = 16813  ->  half 17000, span 34000
     25000 -> 34000 across, i.e. 625 km^2 -> 1156 km^2 of published sea, and
     it still clears the plate by 10.0 km on the tightest side (x) instead of
     5.5 km. The drawn ocean does not change at all — it is a camera-centred
     disc — so this costs nothing to render; what it buys is that every
     consumer that asks "is this open sea" agrees out to 17 km instead of
     12.5 km, which is what makes a long offshore passage in a 156 m hull a
     real voyage rather than a swim to the edge of the record.

     OWNER (2026-08-04): "make water around world 10x bigger, world will
     become island". 2.3 -> 5.45, read as 10x the AREA like the desert
     alongside it, and it is still the same honest place to do it: this reads
     the FLAT rect, it never writes it, so no region moves and no biome
     changes shape.
       reach = max(|-4800-310|, |7970-310|, |-4319+750|, |4500+750|) = 7660
       2 x (7660 + 2200) x 5.45 = 107474  ->  half 54000, span 108000
     34000 -> 108000 across: 1156 km^2 -> 11664 km^2 of published sea, 10.09x.
     WHY THAT MAKES IT AN ISLAND, arithmetically: the land now reaches 7.7 km
     from the sea's centre and the water reaches 54 km, so the continent
     occupies 7% of the sea's width and 1.1% of its area. It clears the
     stage-5 plate (x -7000..10170 / z -6519..6700) by 43.6 km on the tightest
     side. And it is still free to render — the drawn ocean is a
     camera-centred 4.5 km disc (world/water_spec.js), so this sizes the
     published BOUNDS record, the geometry's bounding box and therefore the
     flyable airspace, never a mesh. What it buys is that every consumer that
     asks "is this open sea" agrees out to 54 km: you can point a hull at the
     horizon and keep going for an hour and the world still says ocean.
  ------------------------------------------------------------------ */
  const SEA_OPEN_WATER = V5 ? 5.45 : 2.3;   // sea half-span as a multiple of the land's reach
  CBZ.WORLD_SEA_SPAN = null;
  if (V4 && CBZ.WORLD_ENLARGE_FLAT) {
    const F = CBZ.WORLD_ENLARGE_FLAT, SCX = 310, SCZ = -750;
    const reach = Math.max(Math.abs(F.minX - SCX), Math.abs(F.maxX - SCX),
                           Math.abs(F.minZ - SCZ), Math.abs(F.maxZ - SCZ));
    const margin = 2200;                 // CONTINENT_COUNTRY_MARGIN (config.js, enlarged)
    const span = 2 * (reach + margin) * SEA_OPEN_WATER;
    CBZ.WORLD_SEA_SPAN = Math.max(16000, Math.ceil(span / 1000) * 1000);
  }

  /* ==================================================================
     CBZ.worldScaleAudit() — HOW BIG IS THE WORLD, ACTUALLY?

     Pure read, no mutation, safe before or after a build. Everything it
     can measure LIVE it measures live (the grown FLAT, the built plate,
     the registered region rects, the desert's own height oracle);
     anything the world has not built yet falls back to this file's
     parse-time table, so it answers something useful at any point.

     `gaps` is the edge-to-edge strait between the named pair — the same
     metric worldLayoutAudit's minPairDistance uses, restated for the
     specific pairs stage 4 is answerable for. None of them may end below
     its stage-3 value.
  ================================================================== */
  CBZ.worldScaleAudit = function () {
    const flat = CBZ.TERRAIN_FLAT || CBZ.WORLD_ENLARGE_FLAT || null;
    const plate = CBZ.CONTINENT_PLATE || null;
    const A = CBZ.city && CBZ.city.arena;
    const r2 = function (v) { return Math.round(v * 100) / 100; };
    // live region rect by name fragment, else the parse-time footprint
    function rect(id, nameRe) {
      const regs = (A && A.regions) || [];
      for (let i = 0; i < regs.length; i++) {
        const r = regs[i];
        if (r && r.kind !== "circle" && nameRe.test(r.name || "")) {
          return { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
        }
      }
      return FOOT[id] || null;
    }
    // EXACT names, anchored: "Redhollow" also matches the Redhollow BRIDGE and
    // "Mercy" the Mercy CAUSEWAY, and a link rect answering for a biome would
    // make every gap in this table a fiction.
    const R = {
      desert: rect("desert", /^The Saltlands$/),
      farmland: rect("farmland", /^Coyle Valley$/),
      forest: rect("forest", /^Redhollow Woods$/),
      snow: rect("snow", /^Mount Mercy$/),
    };
    function gap(a, b) {
      if (!a || !b) return null;
      const dx = Math.max(a.minX - b.maxX, 0, b.minX - a.maxX);
      const dz = Math.max(a.minZ - b.maxZ, 0, b.minZ - a.maxZ);
      return Math.round(Math.sqrt(dx * dx + dz * dz));
    }
    const seg = plate && Number.isFinite(plate.seg) ? plate.seg : (CBZ.CONTINENT_PLATE_SEG || null);
    const pw = plate ? plate.maxX - plate.minX : null;
    const pd = plate ? plate.maxZ - plate.minZ : null;
    // the tallest dune the erg actually reaches, sampled off the live oracle
    let duneMax = null;
    if (typeof CBZ.desertDuneHeightAt === "function" && R.desert) {
      duneMax = 0;
      // THE SAMPLE RIDES THE FOOTPRINT, like every other count in this file.
      // A fixed 96x96 grid is really the statement "sample every 15 m" — that
      // is what it measured on the stage-4 basin — and left as a literal it
      // walks to 46 m on the 10x erg, which is wider than the 72 m dunes it is
      // trying to find a crest of. The number would have DROPPED as the basin
      // grew, from an oracle that returns the identical height for the
      // identical point. Capped at 320 so the audit stays a sub-second read.
      const N = Math.max(96, Math.min(320,
        Math.round((R.desert.maxX - R.desert.minX) / 15)));
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const x = R.desert.minX + (i + 0.5) * (R.desert.maxX - R.desert.minX) / N;
        const z = R.desert.minZ + (j + 0.5) * (R.desert.maxZ - R.desert.minZ) / N;
        const h = CBZ.desertDuneHeightAt(x, z);
        if (Number.isFinite(h) && h > duneMax) duneMax = h;
      }
      duneMax = Math.round(duneMax * 10) / 10;
    }
    // The erg as an AREA, which is the unit stage 5's ask was written in.
    const km2 = function (r) {
      return r ? Math.round((r.maxX - r.minX) * (r.maxZ - r.minZ) / 1e4) / 100 : null;
    };
    return {
      stage: CBZ.WORLD_LAYOUT_STAGE,
      scaleV4: V4,
      scaleV5: V5,
      desertKm2: km2(R.desert),
      seaKm2: CBZ.WORLD_SEA_SPAN
        ? Math.round(CBZ.WORLD_SEA_SPAN * CBZ.WORLD_SEA_SPAN / 1e4) / 100 : null,
      flatW: flat ? Math.round(flat.maxX - flat.minX) : null,
      flatD: flat ? Math.round(flat.maxZ - flat.minZ) : null,
      plateW: pw == null ? null : Math.round(pw),
      plateD: pd == null ? null : Math.round(pd),
      plateSeg: seg,
      cellM: (seg && pw) ? r2(Math.max(pw, pd) / seg) : null,
      seaSpan: CBZ.WORLD_SEA_SPAN || 16000,
      biomes: {
        desert: R.desert && { hx: Math.round((R.desert.maxX - R.desert.minX) / 2), hz: Math.round((R.desert.maxZ - R.desert.minZ) / 2) },
        farmland: R.farmland && { hx: Math.round((R.farmland.maxX - R.farmland.minX) / 2), hz: Math.round((R.farmland.maxZ - R.farmland.minZ) / 2) },
        forest: R.forest && { hx: Math.round((R.forest.maxX - R.forest.minX) / 2), hz: Math.round((R.forest.maxZ - R.forest.minZ) / 2) },
        snow: R.snow && { hx: Math.round((R.snow.maxX - R.snow.minX) / 2), hz: Math.round((R.snow.maxZ - R.snow.minZ) / 2) },
      },
      gaps: {
        "desert<->farmland": gap(R.desert, R.farmland),
        "forest<->snow": gap(R.forest, R.snow),
        "farmland<->snow": gap(R.farmland, R.snow),
        "desert<->forest": gap(R.desert, R.forest),
      },
      duneMaxU: duneMax,
      rocksScattered: CBZ.desertRockScatterCount == null ? null : CBZ.desertRockScatterCount,
      organicEdges: !!(CFG.BIOME_ORGANIC_EDGES !== false && CBZ.biomeBlendDominantAt),
    };
  };
})();
