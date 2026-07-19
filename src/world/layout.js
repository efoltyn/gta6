/* ============================================================
   world/layout.js — THE WORLD LAYOUT DIAL (map-enlargement stage 1).

   OWNER GOAL: "make the map and biomes significantly bigger, and get rid
   of all the overlaps." The blocker: every biome/island anchors itself
   with private absolute constants (snow CX=350, speedway CX=490, military
   CEN_X=-620 …), so there is no single place to stretch the world.

   THIS FILE is that place. Each biome's anchor constants now route
   through CBZ.worldOff(id) — a per-biome {dx,dz} translation that ships
   ALL-ZERO, so today's world is byte-identical (the smoke gate's exact
   lot/shop/road counts prove it). The actual enlargement (stage 2) then
   becomes DATA: raise the offsets to spread the biomes apart, grow the
   continent underlay + FLAT terrain contract to match, and re-derive the
   causeway/highway links. Verify stage 2 with
   tools/terrain-map-audit.mjs (overlaps must stay zero) + the gate.

   Wired anchors (stage 1): snow, forest, desert, farmland, speedway,
   military, airport — plus terrain_overhaul's snow-range window.
   NOT yet wired (stage 2 work): causeway rectangles between landmasses,
   highways.js endpoints, continent nation islands (kesh/mbeya/veridia/
   solara — data-driven in their own files), FLAT AABB growth.

   DETERMINISM: offsets are build-time constants (no rng, no per-seed
   variation), so worlds stay byte-identical per seed across clients.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // Per-biome translation, applied to each file's anchor constants.
  // STAGE 1: all zero (world unchanged). STAGE 2 raises these to spread
  // the map — e.g. snow {dx:0,dz:-400}, desert {dx:500,dz:200} — after
  // the cross-links (causeways/highways/FLAT) are taught to follow.
  const OFFSETS = {
    snow:     { dx: 0, dz: 0 },
    forest:   { dx: 0, dz: 0 },
    desert:   { dx: 0, dz: 0 },
    farmland: { dx: 0, dz: 0 },
    speedway: { dx: 0, dz: 0 },
    military: { dx: 0, dz: 0 },
    airport:  { dx: 0, dz: 0 },
  };
  const ZERO = { dx: 0, dz: 0 };

  CBZ.WORLD_LAYOUT_OFFSETS = OFFSETS;
  CBZ.worldOff = function (id) { return OFFSETS[id] || ZERO; };
})();
