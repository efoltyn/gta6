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
   • snow stays at 0,0 — its interior (lodge/lift/piste/Greater Mercy) and
     the exported oracles snowTerrainHeightAt/snowRunXAt/greaterMercy*
     bake absolute coordinates; translating it is its own stage. The north
     is anchored by it; everything else spreads away from the city.
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
    if (CFG.WORLD_ENLARGE_V2 == null && typeof location !== "undefined" && location.search) {
      const v = new URLSearchParams(location.search).get("cfg_WORLD_ENLARGE_V2");
      if (v != null) CFG.WORLD_ENLARGE_V2 = !(v === "0" || v === "false");
    }
  } catch (e) {}
  if (CFG.WORLD_ENLARGE_V2 == null) CFG.WORLD_ENLARGE_V2 = true;
  const ON = CFG.WORLD_ENLARGE_V2 !== false;

  // Per-landmass translation, applied to each file's anchor constants.
  // Zero = the stage-1 authored spot. Flag off = ALL zero (old world).
  const SPREAD = {
    // biomes / islands (anchor consts in their own files)
    snow:     { dx: 0,    dz: 0 },      // pinned — see header
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
  const ZERO = { dx: 0, dz: 0 };
  const OFFSETS = {};
  for (const id in SPREAD) OFFSETS[id] = ON ? SPREAD[id] : ZERO;

  CBZ.WORLD_LAYOUT_OFFSETS = OFFSETS;
  CBZ.worldOff = function (id) { return OFFSETS[id] || ZERO; };

  // The enlarged seed FLAT rect for the terrain contract — the union of
  // every offset landmass ABOVE (nations included), with a small slack.
  // world/terrain.js grows its FLAT to this at build time (never shrinks),
  // so relief/backdrop rings stand clear of ALL land — including the far
  // nation sites, which the (no-op — CBZ.city is unset during landmass
  // build) live sync never actually covered; mbeya used to sit on 60u of
  // backdrop ring because of that. The north edge deliberately stays near
  // the snow core (-1890): the Greater Mercy envelope overhangs FLAT on
  // purpose so the northern backdrop ring keeps rising inside snow-labeled
  // cover, exactly like the stage-1 world.
  CBZ.WORLD_ENLARGE_FLAT = ON
    ? { minX: -3160, maxX: 3060, minZ: -1890, maxZ: 1030 }
    : null;
})();
