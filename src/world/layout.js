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
    }
  } catch (e) {}
  if (CFG.WORLD_ENLARGE_V2 == null) CFG.WORLD_ENLARGE_V2 = true;
  // STAGE 3 — the whole re-lay is this one flag (owner: a bad terrain change
  // is hard to eyeball and easy to regret, so it must be a one-line revert).
  // Consumers: city/continent.js (rim relief + plate bail + worldLayoutAudit),
  // city/minicities.js (authored-frame seeding + size gradient),
  // city/biome_snow.js (authored-frame Pinecrest seeding).
  if (CFG.WORLD_LAYOUT_V2 == null) CFG.WORLD_LAYOUT_V2 = true;
  const ON = CFG.WORLD_ENLARGE_V2 !== false;
  const V3 = ON && CFG.WORLD_LAYOUT_V2 !== false;

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
    //     MEASURED AND NOT FIXED (2026-07-27) — the Mercy Causeway lane
    //     RUNS THROUGH THE COMMERCE ANNEX. biome_snow.js authors the deck at
    //     x 463..477 (snow berms out to 455.7..490.3) from the snow shore
    //     (z = -2620) south to CAUSEWAY_MAXZ = -552, the speedway hand-off.
    //     The annex is a 120 m disc at (city.maxX + 215, city.center.z) =
    //     (380, -700) with a 14 m sand ring, i.e. x 246..514, z -834..-566.
    //     The lane is therefore inside the island's x-span and its z-span
    //     covers the island whole: ~158 m of 24 m concrete deck + white berms
    //     crosses the island's east side, over its street grid, at y 0..0.6
    //     against island ground at y 0 and island asphalt at y 0.05.
    //     It is NOT a stage-3 regression — it has been true since the lane
    //     was first derived from the speedway — and the annex cannot dodge it:
    //     west of the lane it lands on the mainland's harbour bay ring
    //     (x 193..260) and east of it on the Ironjaw Arena (x 520..760).
    //     The CORRIDOR has to move or terminate, not the island. It also
    //     escapes roadrules.js's clearance law twice over: the deck is
    //     GEOMETRY (only `city.roads` records are clamped) and the name
    //     "Mercy Causeway" matches the CONNECTOR exemption.
    //     city/expansion.js now registers the annex in `city.regions` (it
    //     never had been — which is why every clearance and spacing rule in
    //     the game was blind to a 240 m city island), so the audit can at
    //     last SEE the clash.
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

  const SPREAD = V3 ? SPREAD_V3 : SPREAD_V2;
  const ZERO = { dx: 0, dz: 0 };
  const OFFSETS = {};
  for (const id in SPREAD) OFFSETS[id] = ON ? SPREAD[id] : ZERO;

  CBZ.WORLD_LAYOUT_OFFSETS = OFFSETS;
  CBZ.WORLD_LAYOUT_STAGE = ON ? (V3 ? 3 : 2) : 1;
  CBZ.worldOff = function (id) { return OFFSETS[id] || ZERO; };

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
  CBZ.WORLD_ENLARGE_FLAT = ON
    ? (V3
      ? { minX: -3960, maxX: 3860, minZ: -1890 + SPREAD_V3.snow.dz, maxZ: 1420 }
      : { minX: -3160, maxX: 3060, minZ: -1890 + SPREAD_V2.snow.dz, maxZ: 1030 })
    : null;
})();
