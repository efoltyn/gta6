/* ============================================================
   city/waterfield.js — ONE WATER TRUTH FOR RENDERING + GAMEPLAY.

   The rendered continent already owns a signed shoreline function, but the
   player swimmer, boats and aquatic wildlife each used unrelated rectangle /
   radius guesses.  Fish consequently crossed whole islands.  This module
   turns the rendered shoreline into a small navigation field:

     shoreAt(x,z)       +land / -water signed coast distance
     depthAt(x,z)       gameplay bathymetry derived from that distance
     surfaceY(x,z,t)    live surface height — see the note below
     surfaceSlope(...)  dY/dx, dY/dz of that same surface (buoyancy/pitch)
     currentAt(x,z,t)   slow deterministic ocean current
     moveInWater(...)   shore feelers + inward/tangent steering
     nearestWater(...)  closest-valid-point recovery for spawns/births

   surfaceY() USED TO BE a hand-typed CPU copy of world.js's GLSL swell math,
   with a comment asking future editors to keep the coefficients "byte-for-byte
   in sync".  It no longer is: world/water_spec.js owns ONE swell table, GENERATES
   the GLSL from it, and exposes CBZ.waterWaveHeight() as the CPU evaluation of
   the very same table.  The render and the query cannot drift apart any more.

   `isSurfaceWater` excludes bridge decks (cars/people stand on them).
   `isNavigableWater` deliberately does not, so sea life can pass underneath.
   That deck rule is now the ONLY difference between the two: both read the
   same coast + rainwater + surge run-up field, so a flooded street is water
   for a shark on exactly the terms it is water for a swimmer.
   No external runtime is needed and every query is allocation-free except the
   high-level helpers used for spawn/recovery.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const QUAY = 28;
  const MEAN_Y = -0.48;
  let boundArena = null;

  function arena() {
    return boundArena || (CBZ.city && CBZ.city.arena) || null;
  }

  function bindArena(A) {
    if (A) boundArena = A;
    return api;
  }

  function regionHit(r, x, z, margin) {
    margin = margin || 0;
    if (!r) return false;
    const p = (r.pad || 0) + margin;
    if (r.kind === "circle") return Math.hypot(x - r.cx, z - r.cz) <= r.r + p;
    return x >= r.minX - p && x <= r.maxX + p && z >= r.minZ - p && z <= r.maxZ + p;
  }

  function isLink(r) {
    // Region names never change after build, and this used to run the regex
    // for EVERY region on EVERY water query — profiled at >1% of the sim
    // tick on its own. Compute once per region object.
    if (!r || !r.name) return false;
    if (r._isLink === undefined) r._isLink = /bridge|causeway|link/i.test(r.name);
    return r._isLink;
  }

  function overDeck(A, x, z, margin) {
    if (!A) return false;
    const B = A.bridge;
    if (B && x >= B.minX - margin && x <= B.maxX + margin && z >= B.minZ - margin && z <= B.maxZ + margin) return true;
    const regs = A.regions || [];
    for (let i = 0; i < regs.length; i++) if (isLink(regs[i]) && regionHit(regs[i], x, z, margin)) return true;
    return false;
  }

  // Legacy fallback used only before continent.js publishes the real signed
  // shoreline.  It preserves the old gameplay contract during boot.
  function fallbackWater(A, x, z, allowUnderDecks) {
    if (!A || A.minX == null) return false;
    if (x >= A.minX - QUAY && x <= A.maxX + QUAY && z >= A.minZ - QUAY && z <= A.maxZ + QUAY) return false;
    if (!allowUnderDecks && overDeck(A, x, z, 0)) return false;
    const I = A.annex;
    if (I && Math.hypot(x - I.cx, z - I.cz) <= I.radius + 1.5) return false;
    const regs = A.regions || [];
    for (let i = 0; i < regs.length; i++) {
      if (allowUnderDecks && isLink(regs[i])) continue;
      if (regionHit(regs[i], x, z, 0)) return false;
    }
    return true;
  }

  /* THE COAST, and only the coast. `coastAt` is the honest signed distance to
     the shoreline: it is what sea life navigates by, what spawns are validated
     against and what a boat's shore feelers read. The EXPORTED `shoreAt`
     (below) adds standing rainwater on top, because everything that asks
     "is there water on me" must see a flooded street — but nothing that asks
     "can a shark swim here" may, or the megalodon takes the freeway. */
  /* terrain.shoreAt is an analytic field over the BUILT continent — pure per
     city build, but each raw call walks several noise/path fields, and every
     water question in the game (cars' overWater, peds, swim, gore, the
     groundwater flood) funnels through here per entity per frame: profiled at
     ~9% of the whole sim tick. Memoize it on a 4m corner grid with bilinear
     blending: corners hold EXACT field values, the blend between them moves
     the effective coastline by well under a metre on this smooth field, and
     the per-call cost collapses to four Map reads once a cell is warm. The
     value is a pure function of (x,z) and the terrain object, so runs (and MP
     clients) stay deterministic; a rebuilt city gets a fresh cache via the
     terrain-identity check. Far-out-of-band queries (|cell| ≥ 8000, i.e.
     ±32km) skip the cache rather than aliasing keys. */
  const COAST_GRID = 4;
  const COAST_CACHE_MAX = 130000;            // ~few MB worst case, then reset
  let coastCache = new Map(), coastCacheTerrain = null;
  function coastRaw(terrain, x, z) {
    try {
      const s = +terrain.shoreAt(x, z);
      if (Number.isFinite(s)) return s;
    } catch (e) {}
    return null;
  }
  function coastCorner(terrain, ix, iz) {
    const key = (ix + 8192) * 16384 + (iz + 8192);
    let v = coastCache.get(key);
    if (v === undefined) {
      if (coastCache.size >= COAST_CACHE_MAX) coastCache.clear();
      v = coastRaw(terrain, ix * COAST_GRID, iz * COAST_GRID);
      coastCache.set(key, v);
    }
    return v;
  }
  let _lcIx = null, _lcIz = 0, _lc00 = 0, _lc10 = 0, _lc01 = 0, _lc11 = 0;
  function coastAt(x, z) {
    const A = arena();
    const terrain = A && A.mapTerrain;
    if (terrain && typeof terrain.shoreAt === "function") {
      if (coastCacheTerrain !== terrain) { coastCacheTerrain = terrain; coastCache.clear(); _lcIx = null; }
      const gx = x / COAST_GRID, gz = z / COAST_GRID;
      const ix = Math.floor(gx), iz = Math.floor(gz);
      if (ix > -8000 && ix < 7999 && iz > -8000 && iz < 7999) {
        // Consecutive queries overwhelmingly land in the SAME cell (an
        // entity's feelers probe centimetres apart), so keep the last cell's
        // corners in locals and skip even the Map hits on a repeat.
        if (ix !== _lcIx || iz !== _lcIz) {
          const c00 = coastCorner(terrain, ix, iz), c10 = coastCorner(terrain, ix + 1, iz),
                c01 = coastCorner(terrain, ix, iz + 1), c11 = coastCorner(terrain, ix + 1, iz + 1);
          if (c00 === null || c10 === null || c01 === null || c11 === null) {
            const s0 = coastRaw(terrain, x, z);
            if (s0 !== null) return s0;
            return fallbackWater(A, x, z, true) ? -24 : 24;
          }
          _lcIx = ix; _lcIz = iz; _lc00 = c00; _lc10 = c10; _lc01 = c01; _lc11 = c11;
        }
        const fx = gx - ix, fz = gz - iz;
        return (_lc00 * (1 - fx) + _lc10 * fx) * (1 - fz) + (_lc01 * (1 - fx) + _lc11 * fx) * fz;
      }
      const s = coastRaw(terrain, x, z);
      if (s !== null) return s;
    }
    return fallbackWater(A, x, z, true) ? -24 : 24;
  }

  /* ---- THE FLOOD IS WATER FOR THE THINGS THAT LIVE IN IT ------------------
     OWNER: "gang city too and nat disaster should all have these sharks" — and
     a flooded Gang City street with a bull shark in it, and a tsunami that
     carries sharks inland, are the two pictures that sentence describes.

     NEITHER COULD HAPPEN, and the reason was inside this file. Two functions
     here answer "is there water at this point", and they were answering off
     DIFFERENT DATA:

       isSurfaceWater()    shoreAt() + floodReach() — the coast, PLUS standing
                           rainwater, PLUS how far a surge has pushed the
                           waterline inland. This is the one the player, the
                           swim/drown clock, buoyancy, the boats, the gore
                           medium and the underwater view all read, which is
                           why a tsunami floods a street for a PERSON.
       isNavigableWater()  coastAt(), and nothing else. The raw STATIC signed
                           shoreline. Surge-blind and rain-blind, by omission.

     city/tsunami.js's own header states the consequence as if it were already
     true — "the sharks read it too, and their reach is a water test, so deep
     water coming inland means what deep water coming inland means". It was not
     true. The sea rose over the seawall, the swimmer drowned in the street, and
     the shark's navigation still believed that street was dry land: wildlife.js
     tests isNavigableWater every frame and PROJECTS a body that fails it back
     to the nearest valid water, so a shark carried inland was actively teleported
     back out to sea. The file whose header promises "ONE WATER TRUTH FOR
     RENDERING + GAMEPLAY" was holding two.

     The fix is the same expression, not a second flood model. Navigable water is
     the surface field minus exactly one thing — the bridge-deck exclusion, which
     is the documented and deliberate difference between these two tests (sea
     life passes UNDER a deck; a person stands ON it).

     A species' own `clearance` still gates it, so nothing here decides which
     animals go inland: a bull shark (24 m of shore clearance) rides a surge up a
     flooded avenue and a megalodon (88 m) never leaves the deep, and neither of
     those is a rule anybody had to type.

     REVERT: CBZ.CONFIG.MARINE_FLOOD_NAV = false (?cfg_MARINE_FLOOD_NAV=0)
     restores the static-coast test verbatim. */
  function isNavigableWater(x, z, clearance) {
    clearance = Math.max(0, +clearance || 0);
    if (CBZ.CONFIG && CBZ.CONFIG.MARINE_FLOOD_NAV === false) return coastAt(x, z) < -clearance;
    return shoreAt(x, z) < -clearance + floodReach();
  }

  /* ============================================================
     GROUND WATER — THE RAIN THAT HAS NOWHERE TO GO (2026-08-03)

     OWNER: "rain makes flash flood which is gang city water slowly filling
     the ground". A surge moves the SEA, which floods a coast; it can do
     nothing for a street four kilometres inland, and that street is where
     the owner is standing. So this file — which already owns the WATER MASK
     every gameplay system asks — gains a second contribution to the same
     mask: standing water that accumulates on LAND from rainfall.

     It is not a second water system and it is emphatically not a mesh.
     It is one scalar (`gwStage`, metres of standing water measured above the
     LOCAL drainage floor) plus an optional advancing FRONT, folded into the
     three functions the rest of the game already reads:

        cityFloodDepthAt()  → max(sea surge flood, ground water)
        isSurfaceWater()    → true once the street is swim-deep
        surfaceY()          → the pond surface, where it is above the sea

     Everything downstream therefore comes free and unedited: city/swim.js's
     sink-unless-you-swim + 28 s breath + drown-through-the-killfeed, boat
     buoyancy, the gore medium, the underwater view, corpse flotation.

     WHY A *LOCAL* FLOOR. A single world-Y water table would put a hilltop
     under the same metre of water as a hollow. Real standing water is
     governed by depth-to-local-drainage: how far you sit above the lowest
     ground your neighbourhood can shed into. `gwFloor()` measures exactly
     that — the minimum CBZ.floorAt over a ring around the cell — and caches
     it per 12 m cell, so a query is one float compare when it is dry, and a
     Map hit plus one floorAt otherwise. Puddles therefore appear in the low
     spots FIRST and swell outward, which is what rain actually does.

     DETERMINISM: pure terrain arithmetic, no rng, no build-path draws.
     Flag: CBZ.CONFIG.WEATHER_GROUND_WATER (default on) — one-line revert to
     "the sea is the only water there is".
     ============================================================ */
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.WEATHER_GROUND_WATER == null) CFG.WEATHER_GROUND_WATER = true;

  const GW_CELL = 12;        // metres per drainage cell (a street's width)
  const GW_RING = 54;        // metres — the neighbourhood a cell drains into
  const GW_RING_N = 8;       // ring samples per cell (once, then cached)
  const GW_CACHE_MAX = 8000; // cells kept; blown away wholesale when exceeded
  // REPORTED, NOT ENFORCED. city/swim.js owns the swim/stand thresholds
  // (SWIM_DEPTH 1.35 / STAND_DEPTH 1.05) and reads them off the depth this
  // file hands it, so there is exactly one place those numbers live. This
  // constant only exists so the audit can print what they are.
  const GW_SWIM = 1.35;
  const gwCache = new Map();
  let gwStage = 0;           // metres above the local drainage floor
  let gwFront = null;        // optional advancing torrent front
  let gwPeak = 0;            // deepest stage this event (audit evidence)

  function gwFloorAt(x, z) {
    const ix = Math.floor(x / GW_CELL), iz = Math.floor(z / GW_CELL);
    const key = ix * 131071 + iz;
    const hit = gwCache.get(key);
    if (hit !== undefined) return hit;
    const F = CBZ.floorAt;
    const cx = (ix + 0.5) * GW_CELL, cz = (iz + 0.5) * GW_CELL;
    let lo = F ? +F(cx, cz) : 0;
    if (!Number.isFinite(lo)) lo = 0;
    if (F) {
      for (let i = 0; i < GW_RING_N; i++) {
        const a = (i / GW_RING_N) * Math.PI * 2;
        const h = +F(cx + Math.cos(a) * GW_RING, cz + Math.sin(a) * GW_RING);
        if (Number.isFinite(h) && h < lo) lo = h;
      }
    }
    if (gwCache.size >= GW_CACHE_MAX) gwCache.clear();
    gwCache.set(key, lo);
    return lo;
  }
  // A rebuilt world is a different terrain: never answer from the old one.
  CBZ.groundWaterForget = function () { gwCache.clear(); };

  /* THE ONE WRITER'S SEAM. systems/weather.js owns the accumulation model
     (rain fills, dry drains) and pushes the result here every frame; a
     disaster asserts a level through CBZ.weatherDrive({pool}). Nothing else
     should call this — the field is a consequence of weather, not a toy. */
  CBZ.groundWaterSet = function (m) {
    gwStage = Number.isFinite(+m) && +m > 0 ? +m : 0;
    if (gwStage > gwPeak) gwPeak = gwStage;
    return gwStage;
  };
  CBZ.groundWater = function () { return gwStage; };

  /* THE TORRENT FRONT. A flash flood is not a level that rises politely —
     it is a wall coming down a channel with the ground still dry twenty
     metres ahead of it. Rather than draw that wall (a private plane, which
     this engine bans), the front is a term in the SAME depth field: dry
     ahead of `s`, a raised crest in the first `width` metres behind it, the
     standing level after that. Swimming, drowning, buoyancy and the gore
     medium all meet the wall because they are all asking this function. */
  CBZ.groundWaterFrontSet = function (f) {
    if (!f) { gwFront = null; return null; }
    const m = Math.hypot(+f.dx || 0, +f.dz || 0) || 1;
    gwFront = {
      x: +f.x || 0, z: +f.z || 0, dx: (+f.dx || 1) / m, dz: (+f.dz || 0) / m,
      s: +f.s || 0, width: Math.max(2, +f.width || 14),
      crest: Math.max(0, f.crest == null ? 0.55 : +f.crest),
      speed: Math.max(0, +f.speed || 0),
    };
    return gwFront;
  };
  CBZ.groundWaterFront = function () { return gwFront; };

  // metres of standing water at (x,z) — 0 on dry land and 0 at sea.
  function groundWaterAt(x, z) {
    if (gwStage <= 0.001 || CFG.WEATHER_GROUND_WATER === false) return 0;
    // the sea is the sea; a puddle is what sits ON land
    if (coastAt(x, z) < 0) return 0;
    let stage = gwStage;
    if (gwFront) {
      const u = (x - gwFront.x) * gwFront.dx + (z - gwFront.z) * gwFront.dz;
      const behind = gwFront.s - u;
      if (behind <= 0) return 0;                       // still dry ahead of it
      if (behind < gwFront.width) {
        // the crest: the leading metres of a flash flood stand HIGHER than
        // the water that follows, which is why the first hit knocks you flat
        const k = behind / gwFront.width;
        stage *= (0.25 + 0.75 * k) * (1 + gwFront.crest * Math.sin(k * Math.PI));
      }
    }
    const F = CBZ.floorAt;
    const h = F ? +F(x, z) : 0;
    const rel = h - gwFloorAt(x, z);
    const d = stage - (rel > 0 ? rel : 0);
    return d > 0.002 ? d : 0;
  }
  CBZ.groundWaterAt = groundWaterAt;
  // the water surface AT a point that has water on it (world Y), or -Infinity
  CBZ.groundWaterSurfaceY = function (x, z) {
    const d = groundWaterAt(x, z);
    if (d <= 0) return -Infinity;
    return (CBZ.floorAt ? +CBZ.floorAt(x, z) : 0) + d;
  };
  // The LEVEL of the pond this neighbourhood would hold, whether or not the
  // ground at (x,z) is under it. This is the number the rendered waterline
  // needs: a player standing on a kerb ABOVE the flood still has to see the
  // water climbing the kerb, and asking "how deep is it where I stand" (zero,
  // he is dry) would erase the flood the moment he stepped up out of it.
  CBZ.groundWaterLevelY = function (x, z) {
    if (gwStage <= 0.001 || CFG.WEATHER_GROUND_WATER === false) return -Infinity;
    if (coastAt(x, z) < 0) return -Infinity;
    return gwFloorAt(x, z) + gwStage;
  };

  /* THE CURRENT IN THE STREET. Floodwater runs DOWNHILL, and once a front is
     live it runs the way the front is travelling — which is the number that
     knocks a person down at shin depth and floats a car at two feet. One
     allocation-free out-vector; magnitude is metres/sec. */
  const _flow = { x: 0, z: 0, speed: 0 };
  CBZ.groundWaterFlowAt = function (x, z, out) {
    out = out || _flow;
    out.x = 0; out.z = 0; out.speed = 0;
    const d = groundWaterAt(x, z);
    if (d <= 0) return out;
    let vx = 0, vz = 0;
    if (gwFront) {
      // near the front the whole column is moving with it
      const u = (x - gwFront.x) * gwFront.dx + (z - gwFront.z) * gwFront.dz;
      const behind = gwFront.s - u;
      const k = behind < gwFront.width * 3 ? 1 - behind / (gwFront.width * 3) : 0;
      vx += gwFront.dx * gwFront.speed * k;
      vz += gwFront.dz * gwFront.speed * k;
    }
    // plus the terrain's own downhill push (the slope of the ground, not of
    // the water — the water surface is level over a drainage cell)
    const F = CBZ.floorAt;
    if (F) {
      const s = 6;
      const gx = (+F(x + s, z) - +F(x - s, z)) / (2 * s);
      const gz = (+F(x, z + s) - +F(x, z - s)) / (2 * s);
      const g = Math.hypot(gx, gz);
      if (g > 1e-4) {
        // shallow-water speed ~ sqrt(2 g h) capped by slope; kept modest so a
        // puddle does not become a river on a 1% grade
        const v = Math.min(6, Math.sqrt(19.6 * d) * Math.min(1, g * 6));
        vx += (-gx / g) * v; vz += (-gz / g) * v;
      }
    }
    out.x = vx; out.z = vz; out.speed = Math.hypot(vx, vz);
    return out;
  };

  // How far inland a surge pushes the WATERLINE. shoreAt() is a signed
  // horizontal distance to the coast in metres, so converting a vertical
  // surge into it needs a shore gradient — INUNDATE_PER_M is that gradient,
  // and 22:1 is an ordinary run-up ratio for a shallow coast. This is the
  // gameplay twin of water_spec.js's uShoreCut: one moves the rendered edge,
  // this moves the edge that swimming, buoyancy, drowning, boats, sharks and
  // the gore medium all actually ask about. They must move together or the
  // sea will look like it is over the road while the road is still dry.
  const INUNDATE_PER_M = 22;
  function floodReach() {
    const s = CBZ.waterSurge ? CBZ.waterSurge() : 0;
    return s > 0 ? s * INUNDATE_PER_M : 0;
  }
  /* ---- THE EXPORTED SHORE QUERY: coast PLUS standing rainwater -------------
     Once a street carries GW_WET metres of water it IS water, and every system
     that decides "am I in water" from this number has to agree — otherwise the
     player wades through a rendered flood with dry-land physics.

     The conversion is not arbitrary. city/swim.js derives its wading shelf as
     `max(0, -shoreAt) * SHELF_SLOPE` with SHELF_SLOPE = 1.10, so returning
     -(depth / 1.10) makes that shelf come out at EXACTLY the metres of water
     standing on the street — the swimmer therefore enters at its own
     SWIM_DEPTH (1.35 m) and stands up again at STAND_DEPTH (1.05 m) with no
     edit to that file and no second set of thresholds to keep in sync.
     Below GW_WET the number is the honest coast distance, so a puddle you can
     splash through never turns the road into the sea. */
  const GW_WET = 0.35;          // metres — a car stalls, a person wades
  const GW_SHELF_SLOPE = 1.10;  // MUST match city/swim.js's SHELF_SLOPE
  function shoreAt(x, z) {
    const c = coastAt(x, z);
    if (gwStage > 0.001 && c >= 0) {
      const d = groundWaterAt(x, z);
      if (d >= GW_WET) return -d / GW_SHELF_SLOPE;
    }
    return c;
  }

  function isSurfaceWater(x, z, clearance) {
    const A = arena();
    clearance = Math.max(0, +clearance || 0);
    if (overDeck(A, x, z, 0.6)) return false;
    const terrain = A && A.mapTerrain;
    if (terrain && typeof terrain.shoreAt === "function") return shoreAt(x, z) < -clearance + floodReach();
    return fallbackWater(A, x, z, false) || groundWaterAt(x, z) >= GW_WET;
  }
  // Metres of standing water at a point that is only wet BECAUSE of a surge or
  // because the rain had nowhere to go — 0 on ordinary sea. The one read for
  // "am I in the flood", as opposed to "am I in the sea".
  CBZ.cityFloodDepthAt = function (x, z) {
    const gw = groundWaterAt(x, z);
    const reach = floodReach();
    if (reach <= 0) return gw;
    const A = arena();
    const terrain = A && A.mapTerrain;
    if (!terrain || typeof terrain.shoreAt !== "function") return gw;
    const s = coastAt(x, z);
    if (s >= reach) return gw;                          // beyond the run-up
    if (s <= 0) return gw;                              // ordinary sea, not flood
    return Math.max(gw, (reach - s) / INUNDATE_PER_M);  // back to metres of depth
  };

  // Semantic depth in metres.  The deep sea does not need a dense rendered
  // seabed, but wildlife and camera effects do need stable depth lanes.
  function depthAt(x, z) {
    const gw = groundWaterAt(x, z);
    const s = coastAt(x, z);
    if (s >= 0) return gw;                       // land: only what the rain left
    return Math.max(gw, Math.min(62, 1.1 + (-s) * 0.075));
  }

  /* ---- THE SEABED, AND WHY IT HAS TO LIVE HERE ---------------------------
     THERE IS NO QUERYABLE FLOOR UNDER THIS SEA. `CBZ.floorAt` is the WALKABLE
     floor and city/world.js clamps every provider through `Math.max(0, real)`,
     so over the entire ocean it answers exactly 0 — which is ~0.48 m ABOVE
     mean sea level. (Measured 2026-08-03: floorAt returned 0.00 at all 199
     aquatic actors standing in confirmed water.) city/swim.js has said so in
     prose since it shipped — "the walkable floor is flat 0 over the whole sea,
     which is exactly the phantom floor this module exists to stop you standing
     on" — but it kept the answer PRIVATE, so every other water consumer that
     wanted a bed had nothing to ask and reached for floorAt anyway. A "never
     sink into the bed" clamp written against floorAt cannot hold a body down;
     it can only ever push one INTO THE AIR. That was the flying shark.

     The law is swim.js's, unchanged: the synthesised beach shelf close inshore
     (GW_SHELF_SLOPE metres of depth per metre offshore — deliberately narrow,
     because the same shore field also describes a vertical quay) or
     waterfield's own bathymetry offshore, whichever is SHALLOWER. It reads the
     EXPORTED shoreAt, so a flooded street has a bed too, and it reads it ONCE:
     this runs per visible sea creature per frame, so both terms are derived
     from the single signed distance rather than calling depthAt() for a second
     coast sample. Allocation-free, no rng, no state. */
  function bedDepthAt(x, z) {
    const s = shoreAt(x, z);
    if (!(s < 0)) return 0;                      // dry land: no water column
    const shelf = (-s) * GW_SHELF_SLOPE;         // the synthesised beach shelf
    const deep = Math.min(62, 1.1 + (-s) * 0.075);   // depthAt's bathymetry law
    const d = Math.min(shelf, deep);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }
  // World Y of the bed under (x,z) — the live surface minus that column.
  function seaBedY(x, z, t) { return surfaceY(x, z, t) - bedDepthAt(x, z); }

  function clockSeconds() {
    if (CBZ.waterClock) return CBZ.waterClock();
    return ((typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001) % 3600;
  }

  // THE surface height at (x,z).  Delegates to world/water_spec.js so the CPU
  // answer is literally the same summation the vertex program runs (including
  // its horizon-distance and inland-lake amplitude scaling — a boat therefore
  // sits on the crest you can SEE, not on a phantom one).  The inline fallback
  // below is only reachable if water_spec.js failed to load; it reproduces the
  // three historical swells so a stripped page still floats swimmers.
  function surfaceY(x, z, t) {
    // STANDING RAINWATER SITS ON TOP OF THE WORLD, NOT ON TOP OF THE SEA.
    // Where a street is flooded the honest surface is the local pond, and
    // returning it here is what makes the swimmer's waterline, the underwater
    // camera, the gore medium, corpse flotation and every buoyancy probe agree
    // with the water the player can see standing in the road. One early-out
    // float compare keeps this free on the 99.9% of frames that are dry.
    // GATED AT 5 cm, DELIBERATELY. surfaceY is one of the hottest queries in
    // the game (every wake vertex, every hull probe, the submergence test), so
    // it may not grow a coastline lookup for a puddle nothing can float on.
    // Below 5 cm the shader still paints the sheen; nothing needs to SWIM in it.
    if (gwStage > 0.05) {
      const d = groundWaterAt(x, z);
      if (d > 0) {
        const y = (CBZ.floorAt ? +CBZ.floorAt(x, z) : 0) + d;
        const sea = CBZ.waterWaveHeight ? CBZ.waterWaveHeight(x, z, t)
          : (CBZ.waterSeaY ? CBZ.waterSeaY() : MEAN_Y);
        if (y > sea) {
          // a shallow wind chop so the flood is not a sheet of glass; the
          // amplitude is small enough that a hull never porpoises on it
          const tt = Number.isFinite(t) ? t : clockSeconds();
          return y + Math.sin(x * 0.34 + z * 0.21 + tt * 2.1) * Math.min(0.05, d * 0.06);
        }
      }
    }
    if (CBZ.waterWaveHeight) return CBZ.waterWaveHeight(x, z, t);
    if (!Number.isFinite(t)) t = clockSeconds();
    const y0 = CBZ.SEA_Y != null ? CBZ.SEA_Y : MEAN_Y;
    const p1 = x * 0.052 + z * 0.030 + t * 1.1;
    const p2 = x * -0.020 + z * 0.041 + t * 0.7;
    const p3 = (x + z) * 0.011 - t * 0.4;
    return y0 + Math.sin(p1) * 0.145 + Math.sin(p2) * 0.125 + Math.sin(p3) * 0.085;
  }

  // Surface slope (dY/dx, dY/dz) — the analytic derivative of the same swell
  // sum, i.e. exactly what the vertex program tilts its normal by.  Boat pitch
  // and roll ride on this; it is allocation-free with a reused `out`.
  const _slope = { x: 0, z: 0 };
  function surfaceSlope(x, z, t, out) {
    out = out || {};
    if (CBZ.waterWaveSlope) return CBZ.waterWaveSlope(x, z, t, out);
    if (!Number.isFinite(t)) t = clockSeconds();
    const c1 = Math.cos(x * 0.052 + z * 0.030 + t * 1.1) * 0.145;
    const c2 = Math.cos(x * -0.020 + z * 0.041 + t * 0.7) * 0.125;
    const c3 = Math.cos((x + z) * 0.011 - t * 0.4) * 0.085;
    out.x = c1 * 0.052 + c2 * -0.020 + c3 * 0.011;
    out.z = c1 * 0.030 + c2 * 0.041 + c3 * 0.011;
    return out;
  }

  // Upward unit normal of the live surface — handed straight to anything that
  // wants to sit flat on the water (hulls, floating debris, ripple decals).
  function surfaceNormal(x, z, t, out) {
    const s = surfaceSlope(x, z, t, _slope);
    const inv = 1 / Math.sqrt(s.x * s.x + 1 + s.z * s.z);
    out = out || {};
    out.x = -s.x * inv; out.y = inv; out.z = -s.z * inv;
    return out;
  }

  // 1 well inside a registered inland water body (a lake), 0 on open sea.
  // Lets gameplay ask "is this pond water?" with the same answer the shader
  // uses to paint it green and calm.
  function inlandFactorAt(x, z) {
    return CBZ.waterInlandFactorAt ? CBZ.waterInlandFactorAt(x, z) : 0;
  }

  function shoreGradient(x, z, step, out) {
    step = Math.max(2, +step || 8);
    const gx = coastAt(x + step, z) - coastAt(x - step, z);
    const gz = coastAt(x, z + step) - coastAt(x, z - step);
    const d = Math.hypot(gx, gz) || 1;
    out = out || {};
    out.x = gx / d; out.z = gz / d;       // points from water toward land
    return out;
  }

  function currentAt(x, z, t, out) {
    if (!Number.isFinite(t)) t = clockSeconds();
    out = out || {};
    // Two broad curl-like bands: readable drift without conveyor-belt motion.
    let vx = 0.18 + Math.sin(z * 0.0061 + t * 0.035) * 0.16 + Math.sin((x + z) * 0.0027 - t * 0.018) * 0.08;
    let vz = Math.cos(x * 0.0054 - t * 0.031) * 0.14 - Math.cos((x - z) * 0.0031 + t * 0.022) * 0.07;
    // Near shore, remove the component that would push actors onto land.
    const s = coastAt(x, z);
    if (s > -80) {
      const n = shoreGradient(x, z, 7, _grad);
      const towardLand = vx * n.x + vz * n.z;
      if (towardLand > 0) { vx -= n.x * towardLand * 1.15; vz -= n.z * towardLand * 1.15; }
    }
    out.x = vx; out.z = vz;
    return out;
  }

  const _grad = { x: 0, z: 0 }, _cur = { x: 0, z: 0 };

  function nearestWater(x, z, clearance, maxRadius) {
    clearance = Math.max(0, +clearance || 0);
    maxRadius = Math.max(12, +maxRadius || 320);
    if (isNavigableWater(x, z, clearance)) return { x: x, z: z, moved: false };
    // Expanding rings approximate navmesh closest-point projection and are
    // only used for initial spawn/birth/error recovery, never every frame.
    const dirs = 24;
    for (let r = 8; r <= maxRadius; r += Math.max(8, r * 0.22)) {
      let best = null, bestShore = Infinity;
      for (let i = 0; i < dirs; i++) {
        const a = (i / dirs) * Math.PI * 2 + r * 0.0017;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const s = coastAt(px, pz);
        if (s < -clearance && s < bestShore) { bestShore = s; best = { x: px, z: pz, moved: true }; }
      }
      if (best) return best;
    }
    return null;
  }

  function randomWaterPoint(rng, opts) {
    rng = typeof rng === "function" ? rng : Math.random;
    opts = opts || {};
    const cx = +opts.cx || 0, cz = opts.cz == null ? -700 : +opts.cz;
    const r0 = Math.max(0, +opts.r0 || 560), r1 = Math.max(r0 + 1, +opts.r1 || 1500);
    const clearance = Math.max(0, opts.clearance == null ? 18 : +opts.clearance);
    for (let tries = 0; tries < 96; tries++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(r0 * r0 + rng() * (r1 * r1 - r0 * r0));
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (isNavigableWater(x, z, clearance)) return { x: x, z: z };
    }
    const projected = nearestWater(cx + r0, cz, clearance, r1 - r0 + 900);
    if (projected) return projected;

    // The continent expansion can consume an old radial ocean band entirely.
    // Sample the footprint of the ONE sea mesh rather than returning an
    // unchecked legacy coordinate. This mainly matters for huge animals whose
    // required coast clearance cannot fit through the city harbour ring.
    const sb = CBZ.SEA_WORLD_BOUNDS;
    if (sb && [sb.minX, sb.maxX, sb.minZ, sb.maxZ].every(Number.isFinite)) {
      const edge = Math.max(18, clearance + 8);
      const x0 = sb.minX + edge, x1 = sb.maxX - edge;
      const z0 = sb.minZ + edge, z1 = sb.maxZ - edge;
      for (let tries = 0; tries < 192; tries++) {
        const x = x0 + rng() * Math.max(1, x1 - x0);
        const z = z0 + rng() * Math.max(1, z1 - z0);
        if (isNavigableWater(x, z, clearance)) return { x: x, z: z, seaFallback: true };
      }
      // Deterministic exhaustive fallback: choose the deepest valid sample in
      // a 25x25 grid. It consumes no extra RNG and can never resolve to land.
      let best = null, bestShore = Infinity;
      for (let iz = 0; iz <= 24; iz++) for (let ix = 0; ix <= 24; ix++) {
        const x = x0 + (x1 - x0) * ix / 24;
        const z = z0 + (z1 - z0) * iz / 24;
        const s = coastAt(x, z);
        if (s < -clearance && s < bestShore) {
          bestShore = s; best = { x: x, z: z, seaFallback: true };
        }
      }
      if (best) return best;
    }
    // No validated water means no spawn. Callers explicitly skip it; returning
    // an arbitrary point here was the megalodon-on-land bug.
    return null;
  }

  function angleDelta(a, b) {
    let d = (b - a + Math.PI) % (Math.PI * 2);
    if (d < 0) d += Math.PI * 2;
    return d - Math.PI;
  }

  /* ============================================================
     MARINE_STEER_V2 (default ON, ?cfg_MARINE_STEER_V2=0 reverts)

     OWNER (2026-08-25): "when the shark or orca move fast, first sometimes
     their bodies move glitchy — fast left-right movement."

     THIS FUNCTION WAS THE STROBE, and the bug is one missing `dt`. Every
     correction below was applied PER CALL, not per second and not per metre:
     a flat +/-0.34 rad clamp (20 rad/s at 60fps — 1170 deg/s), and a 0.18
     inward blend re-applied every frame. On top of that the left/right feeler
     branch was BANG-BANG: with the two feelers near a tie it picked `leftA`
     one frame and `rightA` the next, and the front-blocked branch could flip
     its tangent by 180 degrees on a dot-product tie. So a body moving fast
     near ANY shore — which for a ridden shark is nearly always, its nav
     clearance is capped by body size — was handed +/-0.34 rad of alternating
     yaw at frame rate. That is the glitch, and it got worse the faster the
     animal moved because the feeler probe reaches further with distance.

     THE FIX IS THE REPO'S OWN LAW: steering rides DISTANCE ACTUALLY MOVED.
     The clamp is now a turn RADIUS (rad per unit travelled), so the same
     path is steered identically at 30fps, 60fps and 144fps; and both
     branch choices carry hysteresis in the caller's own persistent `out`
     object, so a near-tie holds its last decision instead of chattering.
     ============================================================ */
  if (CFG.MARINE_STEER_V2 == null) CFG.MARINE_STEER_V2 = true;
  // 0.38 rad per unit travelled = a ~2.6u turn radius, and it is a CAP on an
  // emergency dodge, not a cruising rate. Measured over 18 coast-hugging runs
  // at 22 u/s it peaks at 8.4 rad/s at 60fps AND at 120fps (v1: 20.4 and 40.8),
  // never produces a single >0.15 rad frame-to-frame snap (v1: 3.8/s), and
  // still beaches nothing (0% blocked). Tying it to the ANIMAL's own turn law
  // instead was tried and measured worse: at the great white's 1.15 rad/s a
  // committed rush could no longer clear a bar and 5% of steps came back
  // blocked, which is a stuck shark grinding a sandbar.
  const TURN_PER_UNIT = 0.38;
  const TURN_FLOOR = 0.012;     // ..but a drifting body may still steer, slowly
  const FEELER_TIE = 0.06;      // |feeler error| under which last frame's side is held
  const TANGENT_HYST = 0.25;    // dot-product margin before the tangent may flip

  function moveInWater(x, z, heading, distance, clearance, t, out) {
    distance = Math.max(0, +distance || 0);
    clearance = Math.max(2, +clearance || 8);
    const v2 = CFG.MARINE_STEER_V2 !== false;
    const probe = Math.max(10, Math.min(44, distance * 6 + clearance * 1.4));
    const hx = Math.cos(heading), hz = Math.sin(heading);
    const frontS = coastAt(x + hx * probe, z + hz * probe);
    const leftA = heading - 0.72, rightA = heading + 0.72;
    const leftS = coastAt(x + Math.cos(leftA) * probe * 0.82, z + Math.sin(leftA) * probe * 0.82);
    const rightS = coastAt(x + Math.cos(rightA) * probe * 0.82, z + Math.sin(rightA) * probe * 0.82);
    let desired = heading;

    if (frontS >= -clearance) {
      const n = shoreGradient(x + hx * probe * 0.5, z + hz * probe * 0.5, 7, _grad);
      // Blend inward with the tangent closest to the current direction. This
      // makes animals follow a bay instead of repeatedly headbutting its edge.
      const tx1 = -n.z, tz1 = n.x, tx2 = n.z, tz2 = -n.x;
      const d1 = tx1 * hx + tz1 * hz, d2 = tx2 * hx + tz2 * hz;
      let useFirst = d1 >= d2;
      if (v2) {
        const prev = out && out._tan ? out._tan : 0;
        if (prev && Math.abs(d1 - d2) < TANGENT_HYST) useFirst = prev > 0;
        if (out) out._tan = useFirst ? 1 : -1;
      }
      const tx = useFirst ? tx1 : tx2, tz = useFirst ? tz1 : tz2;
      desired = Math.atan2(-n.z * 0.82 + tz * 0.58, -n.x * 0.82 + tx * 0.58);
    } else if (v2 && (leftS >= -clearance || rightS >= -clearance)) {
      // PROPORTIONAL, NOT BANG-BANG. v1 slammed `desired` a fixed 0.72 rad to
      // one side the instant either feeler touched, so a body running down a
      // channel crossed the centre line and slammed back the other way — every
      // frame, for as long as it was between two banks. The error signal is the
      // DIFFERENCE between the two feelers, which is exactly zero where the
      // animal is centred, so the correction fades out instead of ringing.
      let err = (leftS - rightS) / (clearance * 2);             // + = right is wetter
      if (err > 1) err = 1; else if (err < -1) err = -1;
      // ..and on a dead tie (both banks equally close) keep last frame's side
      // rather than letting a rounding difference pick a new one each frame.
      if (Math.abs(err) < FEELER_TIE) {
        const prev = out && out._side ? out._side : 0;
        err = prev * FEELER_TIE;
      }
      if (out && err !== 0) out._side = err > 0 ? 1 : -1;
      desired = heading + err * 0.72;
    } else if (!v2 && leftS >= -clearance && rightS < leftS) {
      desired = rightA;
    } else if (!v2 && rightS >= -clearance && leftS < rightS) {
      desired = leftA;
    } else {
      const here = coastAt(x, z);
      if (here > -clearance * 3.4) {
        const n = shoreGradient(x, z, 7, _grad);
        const inward = Math.atan2(-n.z, -n.x);
        // v1 pulled 18% of the way inward EVERY FRAME (a ~0.09 s time constant
        // at 60fps) and fought whatever the caller was steering toward, which
        // is the other half of the left-right limit cycle.
        const pull = v2 ? Math.min(0.18, distance * 0.22) : 0.18;
        desired = heading + angleDelta(heading, inward) * pull;
      } else if (v2 && out) { out._side = 0; out._tan = 0; }   // open water: forget
    }

    // THE STEERING TARGET HAS INERTIA TOO. Capping the turn alone still lets a
    // feeler reading that flips between two frames drive the body to the cap in
    // one direction and then the other — the square wave you can see on the
    // marine-tail steering page. `desired` is therefore low-passed in the
    // caller's own persistent nav object, and the filter constant rides
    // DISTANCE TRAVELLED like everything else here, so it is the same filter at
    // any frame rate. A genuine shore does not disappear in three frames; a
    // sampling flip does.
    if (v2 && out) {
      if (out._des != null && isFinite(out._des)) {
        desired = out._des + angleDelta(out._des, desired) * Math.min(1, distance * 0.9 + 0.02);
      }
      out._des = desired;
    }
    // Turn rate is capped, preventing instant 180-degree pops at shorelines.
    const cap = v2 ? Math.min(0.34, Math.max(TURN_FLOOR, distance * TURN_PER_UNIT)) : 0.34;
    heading += Math.max(-cap, Math.min(cap, angleDelta(heading, desired)));
    let nx = x + Math.cos(heading) * distance;
    let nz = z + Math.sin(heading) * distance;
    const cur = currentAt(x, z, t, _cur);
    nx += cur.x * Math.min(0.35, distance * 0.055);
    nz += cur.z * Math.min(0.35, distance * 0.055);
    let blocked = !isNavigableWater(nx, nz, clearance * 0.55);
    if (blocked) { nx = x; nz = z; }
    out = out || {};
    out.x = nx; out.z = nz; out.heading = heading; out.blocked = blocked; out.shore = frontS;
    return out;
  }

  function sample(x, z, t) {
    const s = shoreAt(x, z);
    const c = currentAt(x, z, t, {});
    return {
      water: s < 0,
      surfaceWater: isSurfaceWater(x, z, 0),
      shore: s,
      depth: s < 0 ? Math.min(62, 1.1 + (-s) * 0.075) : 0,
      surfaceY: surfaceY(x, z, t),
      inland: inlandFactorAt(x, z),
      currentX: c.x,
      currentZ: c.z,
    };
  }

  const api = CBZ.waterField = {
    bindArena: bindArena,
    arena: arena,
    shoreAt: shoreAt,
    coastAt: coastAt,
    groundWaterAt: groundWaterAt,
    depthAt: depthAt,
    bedDepthAt: bedDepthAt,
    seaBedY: seaBedY,
    surfaceY: surfaceY,
    surfaceSlope: surfaceSlope,
    surfaceNormal: surfaceNormal,
    inlandFactorAt: inlandFactorAt,
    currentAt: currentAt,
    shoreGradient: shoreGradient,
    isNavigableWater: isNavigableWater,
    isSurfaceWater: isSurfaceWater,
    nearestWater: nearestWater,
    randomWaterPoint: randomWaterPoint,
    moveInWater: moveInWater,
    sample: sample,
  };

  CBZ.cityWaterAt = function (x, z) { return isSurfaceWater(x, z, 0); };
  /* ---- CBZ.cityNavWaterAt — "is there water here FOR A HULL". -----------
     THE SAME POINT IS BOTH, AND WHICH ONE IT IS DEPENDS ON WHO IS ASKING.
     isSurfaceWater answers "not water" over any deck, because with no y in
     the question a deck is the only proxy it has for "whoever is asking is
     standing on the causeway". That is right for a road car — vehicles.js
     floods anything on water — and wrong for the boat passing UNDER the same
     bridge, which is what the bridge is for.

     One oracle cannot answer both, so this is the second one, and the split
     is by ASKER rather than by place: road cars and swimmers keep
     cityWaterAt; marine hulls and anything asking "can a boat get there" ask
     this. It differs from cityWaterAt in exactly one situation — inside a
     registered navigable channel (city/river.js) that passes beneath a deck.
     Feature-detected: no river in the build, and the two are identical. */
  CBZ.cityNavWaterAt = function (x, z) {
    if (isSurfaceWater(x, z, 0)) return true;
    if (!CBZ.cityChannelAt || !CBZ.cityChannelAt(x, z)) return false;
    return shoreAt(x, z) < 0;
  };
  CBZ.citySeaHeightAt = surfaceY;
  CBZ.citySeaSlopeAt = surfaceSlope;
  CBZ.citySeaNormalAt = surfaceNormal;
  CBZ.cityWaterDepthAt = depthAt;
  // THE ONE SEABED. Anything under water that needs a floor asks these two and
  // never CBZ.floorAt (see the note above bedDepthAt).
  CBZ.citySeaBedDepth = bedDepthAt;
  CBZ.citySeaBedY = seaBedY;

  /* GROUND-WATER EVIDENCE. `privateWaterPlanes` is a LIVE scan, not a promise:
     if anybody ever answers the owner's rising water with a mesh of their own
     instead of this field, it counts them. `peak` proves an event actually put
     water on the ground rather than merely declaring a flag. */
  CBZ.groundWaterAudit = function () {
    // The SANCTIONED oceans are exempt: world/waterfx.js's reflector, the
    // shader sea it swaps with (city/world.js) and the survival arena's own
    // plane are ONE surface each, driven by CBZ.waterSurgeSet. Anything else
    // claiming to be water is somebody's private rising flood, which is the
    // thing this counter exists to catch.
    let planes = 0;
    const ok = [CBZ.citySea, CBZ.citySeaFlat,
      CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.ocean];
    const R = CBZ.scene;
    if (R && R.traverse) R.traverse(function (o) {
      const ud = o.userData;
      if (!ud || (!ud.waterSurface && !ud.floodPlane)) return;
      for (let i = 0; i < ok.length; i++) if (ok[i] && o === ok[i]) return;
      if (o.name && /sea|ocean/i.test(o.name)) return;
      planes++;
    });
    const cam = CBZ.camera && CBZ.camera.position;
    return {
      on: CFG.WEATHER_GROUND_WATER !== false,
      stage: +gwStage.toFixed(3),
      peak: +gwPeak.toFixed(3),
      front: gwFront ? { s: +gwFront.s.toFixed(1), speed: +gwFront.speed.toFixed(1) } : null,
      cells: gwCache.size,
      wetThreshold: GW_WET,
      swimThreshold: GW_SWIM,
      depthUnderCamera: cam ? +groundWaterAt(cam.x, cam.z).toFixed(3) : 0,
      privateWaterPlanes: planes,
    };
  };

  // Bind the live build descriptor before any biome/wildlife builder runs.
  // A rebuilt world is different terrain, so the drainage cache must go with it.
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) { gwCache.clear(); bindArena(city); return null; }, -100);
  // ...and re-read the registered inland water bodies AFTER every biome has
  // registered its lakes (order 900 is past every landmass builder), so the
  // lake look/calm damping in water_spec.js knows where the lakes are.
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    if (CBZ.waterSyncInlandBodies) CBZ.waterSyncInlandBodies(city);
    return null;
  }, 900);
})();
