/* ============================================================
   city/continent.js — ONE LANDMASS. The archipelago becomes a continent.

   Every POI (airport, military base, casino strip, speedway, biomes,
   mini-cities) used to sit on its own island with dead ocean between —
   "circles on the map". This builder runs AFTER every other landmass and
   fills the water between them with real, walkable backcountry:

     • ONE vertex-coloured ground plate spanning the union of every
       registered region (grass/dirt/scrub patches from the position hash —
       deterministic per seed, byte-identical across clients).
     • Sparse deterministic dressing (trees + rocks) as three InstancedMesh
       draws, only OUTSIDE existing regions so nothing decorates a runway.
     • Walkable "underlay" region(s) registered LAST so specific places
       keep winning point-in-region queries; swim.js treats the covered
       span as land, clampToCity lets you walk POI to POI.

   THE COAST PASS (CBZ.CONFIG.CONTINENT_COAST, default on) — the plate used
   to be a RAZOR-STRAIGHT rectangle meeting the sea: a game board, not a
   landmass. Now a deterministic noise field carves an IRREGULAR coastline
   into the plate's outer rim, slopes it down through
   a dry-sand → wet-sand rim into the water, and drops the sea floor below
   the (world.js) animated sea surface. A merged strip of foam "breakers"
   is marched along the true zero-crossing of the shore field, so the foam
   always hugs the actual coast (corners, bays, region bulges included).

   THE HARBOR PASS (CBZ.CONFIG.CONTINENT_HARBOR, default on) — the plate
   also used to pave over the mainland city's WATERFRONT: the seawall,
   beach and moored boats all faced a lawn. This re-opens a ~67u water
   ring around the city rect (starting exactly at swim.js's QUAY=28 line,
   so the wall-jump → swim → climb-out loop works again), and registers
   the walkable underlay as a set of rects that EXCLUDE the ring — so
   swim.js reads it as real water and clampToCity keeps NPCs out of it.
   Causeways/bridges keep their own walkable regions and now read as
   decks over water again. Revert either pass with its flag.

   The old bridges/causeways stay — now they're just the paved roads of a
   continuous country instead of the only way across an ocean.
   regionlife spawns nothing here (biome "wilds" has no budget) — open
   country is open, not filled with pointless NPCs.
   Revert: CBZ.CONFIG.CITY_CONTINENT = false (archipelago returns).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.CITY_CONTINENT == null) CFG.CITY_CONTINENT = true;
  if (CFG.CONTINENT_COAST == null) CFG.CONTINENT_COAST = true;
  if (CFG.CONTINENT_HARBOR == null) CFG.CONTINENT_HARBOR = true;
  if (CFG.CONTINENT_EXPANSION_V2 == null) CFG.CONTINENT_EXPANSION_V2 = true;
  // Stage-2 map enlargement (world/layout.js) needs a wider country belt:
  // the V3 backdrop-relief band rises MARGIN+60..MARGIN+1900 (≈2050u) past
  // the FLAT edge, and FLAT now hugs the region union — so the plate (and
  // its wilds/backcountry labeling) must reach ≥2094u past the union or the
  // ring's mountains stand on unlabeled "open sea" cells that read as city
  // in the terrain audit. config.js owns the authoritative default (2200
  // enlarged / 1200 compact — it parses first); this guard only mirrors it
  // for a build without config.js.
  if (CFG.CONTINENT_COUNTRY_MARGIN == null)
    CFG.CONTINENT_COUNTRY_MARGIN = (CFG.WORLD_ENLARGE_V2 !== false) ? 2200 : 1200;
  if (CFG.CONTINENT_RELIEF_V1 == null) CFG.CONTINENT_RELIEF_V1 = true;
  // Adopted terrain/forest techniques from the reference generators (see
  // tools/adoption-terrain-forest.md). Both default ON, one-line revert each.
  //  RELIEF_EROSION — derivative-damped ("Quilez erosion") octaves + domain
  //   warp + per-octave domain rotation replace the plain value-fbm hill core
  //   in countryHeightAt, giving weathered ridgelines and meandering valleys.
  //  FOREST_V2 — the backcountry dressing becomes an ecological instanced
  //   forest: squashed-icosphere blob canopy with baked AO, per-instance
  //   colour, and slope/treeline/clearing rejection sampling.
  if (CFG.CONTINENT_RELIEF_EROSION == null) CFG.CONTINENT_RELIEF_EROSION = true;
  if (CFG.CONTINENT_FOREST_V2 == null) CFG.CONTINENT_FOREST_V2 = true;
  //  (RELIEF_MACRO and the rim law are retired: see THE LANDFORM in the builder.)
  //  LANDCOVER_V2 — smooth multi-scale land-use fields replace the hashed
  //   22/90u colour cells whose hard edges dissolved into orange/green
  //   confetti from any altitude. `?cfg_CONTINENT_LANDCOVER_V2=0` reverts.
  if (CFG.CONTINENT_LANDCOVER_V2 == null) CFG.CONTINENT_LANDCOVER_V2 = true;
  // ---- TERRAIN_PHYSICS_MATCH (owner: "there's no physics, so it's like green
  //   water — driving in it") ------------------------------------------------
  // The relief field is ANALYTIC with a ~17 m finest octave; the plate that
  // RENDERS it is a ~40 m triangle grid. Those are two different surfaces, and
  // the measured gap between them was 0.41 m mean / 9.77 m MAX. ON → the
  // registered ground provider samples the PLATE'S OWN VERTICES across the
  // PLATE'S OWN TRIANGLES, so the surface you SEE is the surface you WALK and
  // DRIVE on by construction, and one query costs a grid fetch instead of ~30
  // hash evaluations (6.03 µs → ~0.35 µs for the whole floorAt stack, which is
  // what makes a per-car-per-frame ground probe affordable at all).
  // OFF → the analytic field is the provider exactly as before.
  if (CFG.TERRAIN_PHYSICS_MATCH == null) CFG.TERRAIN_PHYSICS_MATCH = true;
  // ---- TERRAIN_FLATTEN_UNDER_BUILT (owner: "IT OVERLAPS PARKING LOTS") -----
  // A lot / apron / plaza / town floor is a FLAT slab laid on this plate. The
  // relief gate under them used to be a BOOLEAN with an 8 m margin — but the
  // plate cell is ~40 m, so the triangle that STRADDLES the kerb kept full
  // relief at its outer vertex and its inner half rose straight through the
  // asphalt. That is the green banding across the parking lot, and raising the
  // lot cannot cure it. ON → the gate becomes a DISTANCE (0 inside and for one
  // whole grid cell beyond, then smoothly back to full relief) — the same
  // grammar CBZ.highwayNetReliefGate already uses under a road corridor. It can
  // only ever LOWER h, so the mountains-outside-snow / city-on-mountain
  // doctrines get MORE true. OFF → the old 8 m boolean.
  if (CFG.TERRAIN_FLATTEN_UNDER_BUILT == null) CFG.TERRAIN_FLATTEN_UNDER_BUILT = true;
  // ---- TERRAIN_BUILT_FROM_LOTS -------------------------------------------
  // OWNER: "there is this green ground that is different heights in different
  // places and overlaps with things like the stadium. When I drive on it, or
  // when a building is on it, they overlap instead of things going on top of
  // the ground like real physics."
  //
  // The gate above was already correct ARITHMETIC and still let that happen,
  // because being gated was an OPT-IN: a surface only counted if it tagged a
  // mesh `userData.worldSurface` or set `terrainGrade` on its region record.
  // The Ironjaw Arena does neither (its bowl stands on a bare CylinderGeometry
  // island and its region carries no terrainGrade), so `builtGate` returned 1
  // under a 20-tier stadium and the country climbed straight through the bowl.
  // `groundMatchAudit().ungated` read 0 the whole time BECAUSE IT ONLY SAMPLES
  // WHAT DECLARED — the classic audit-measures-its-own-declaration trap.
  //
  // ON → the gate ALSO derives its built ground from `city.lots`, the registry
  // every building generator in this game already writes to (world.js's
  // mainland grid, towngen.js's towns via `A.lots`), plus CBZ.terrainFlattenUnder
  // below. Nobody declares anything; a building anywhere flattens the ground it
  // stands on. Lots whose ground is ALREADY flat are dropped at build time, so
  // in the shipped world this adds a handful of records, not thousands.
  // OFF → declaration-only, exactly as before.
  if (CFG.TERRAIN_BUILT_FROM_LOTS == null) CFG.TERRAIN_BUILT_FROM_LOTS = true;

  /* ==================================================================
     CBZ.terrainFlattenUnder(rec) — "I AM BUILT GROUND."

     THE LAW (owner): built things sit ON the ground, never inside it —
     so the ground is flattened under anything built on it, and it is the
     TERRAIN that gives way, never the slab that gets raised.

     One line, no schema, no registration order to respect, degrade-safe
     (`CBZ.terrainFlattenUnder && CBZ.terrainFlattenUnder(...)`), and it
     REPLACES nothing the caller writes — which is exactly why the two
     older paths (a `worldSurface` mesh tag, a `terrainGrade` region) are
     kept working untouched. Use it when your footprint is NOT a
     rectangle-shaped rendered floor: a round apron, a bowl, a pad drawn
     as a Cylinder/Circle (continent.js deliberately refuses those as
     carve rects — an AABB around a disc carves four square corners).

       CBZ.terrainFlattenUnder({ cx, cz, r, name })        // circle
       CBZ.terrainFlattenUnder({ minX, maxX, minZ, maxZ }) // rect

     Push any time BEFORE the continent builds (landmass order 97); this
     list is created at parse time so load order cannot lose a record. A
     record pushed later is kept and reported by groundMatchAudit() as
     `lateDeclarations` — it cannot move a plate that already exists, and
     silently doing nothing is how the last one of these rotted.
  ================================================================== */
  const FLATTEN_DECLS = (CBZ._terrainFlattenDecls = CBZ._terrainFlattenDecls || []);
  let flattenSealedAt = -1;                      // set to FLATTEN_DECLS.length at build
  CBZ.terrainFlattenUnder = function (rec) {
    if (!rec) return null;
    const out = { name: rec.name || "(built)", pad: +rec.pad || 0 };
    if (Number.isFinite(rec.r) && Number.isFinite(rec.cx) && Number.isFinite(rec.cz)) {
      out.circle = true; out.cx = +rec.cx; out.cz = +rec.cz; out.rad = +rec.r + out.pad;
      if (!(out.rad > 0)) return null;
    } else if ([rec.minX, rec.maxX, rec.minZ, rec.maxZ].every(Number.isFinite)) {
      out.circle = false;
      out.minX = Math.min(+rec.minX, +rec.maxX) - out.pad;
      out.maxX = Math.max(+rec.minX, +rec.maxX) + out.pad;
      out.minZ = Math.min(+rec.minZ, +rec.maxZ) - out.pad;
      out.maxZ = Math.max(+rec.minZ, +rec.maxZ) + out.pad;
    } else return null;                          // malformed: never poison the gate with NaN
    // Idempotent: this list lives on CBZ and a world rebuild re-runs every
    // builder, so an identical footprint must not stack up.
    const key = out.name + "|" + (out.circle ? out.cx + "," + out.cz + "," + out.rad
      : out.minX + "," + out.maxX + "," + out.minZ + "," + out.maxZ);
    for (let i = 0; i < FLATTEN_DECLS.length; i++) if (FLATTEN_DECLS[i]._key === key) return FLATTEN_DECLS[i];
    out._key = key;
    FLATTEN_DECLS.push(out);
    return out;
  };
  // WORLD_LAYOUT_V2 (declared in world/layout.js, which parses first) — the
  // stage-3 world re-lay. This file is one of its four consumers; the guard
  // below only mirrors the default for a build without layout.js.
  if (CFG.WORLD_LAYOUT_V2 == null) CFG.WORLD_LAYOUT_V2 = true;
  const LAYOUT_V2 = function () { return CFG.WORLD_LAYOUT_V2 !== false; };
  // WORLD_SCALE_V4 (same owner, world/layout.js) — the biomes themselves grew.
  // Two numbers in this file are answerable for it: the plate's sanity roof and
  // its segment count. Same mirror-only guard.
  if (CFG.WORLD_SCALE_V4 == null) CFG.WORLD_SCALE_V4 = true;
  // The STAGE layout.js resolved to when it is present (it rides on top of
  // WORLD_LAYOUT_V2 and WORLD_ENLARGE_V2, so the raw flag is not the answer);
  // the flag pair is the fallback for a build without layout.js.
  const SCALE_V4 = function () {
    return CBZ.WORLD_LAYOUT_STAGE != null
      ? CBZ.WORLD_LAYOUT_STAGE >= 4
      : (LAYOUT_V2() && CFG.WORLD_SCALE_V4 !== false);
  };
  // WORLD_SCALE_V5 — the 10x desert. The same two numbers answer for it again,
  // for the same reason: the region union grew, and both a stale roof and a
  // stale segment count fail SILENTLY (the roof by deleting the continent, the
  // count by coarsening every cell in the world).
  const SCALE_V5 = function () { return (CBZ.WORLD_LAYOUT_STAGE || 1) >= 5; };

  /* ==================================================================
     CBZ.worldLayoutAudit() — THE WORLD LAYOUT AS NUMBERS.

     The owner's complaint ("the cities and mountains … are much too
     close together") is a SPACING complaint, and spacing had no
     measurement anywhere in this repo. This is it, and it is the ONE
     place that answers all four of the layout questions:

       • how far apart are the landmasses, really (edge gap, not centre
         distance — centre distance flatters a big region);
       • is the relief a RIM or is it lumps in the middle
         (mountainCellsInnerHalf + the relief means either side of the
         half-extent line);
       • are the two standing doctrines still true
         (mountainCellsOutsideSnow, cityOnMountain — both RATCHETS that
         may only ever go DOWN; they use the math gate's own strict
         predicates so this number is an upper bound on the gate's);
       • how big is the world at all (span/centre/halfExtent).

     Sampling matches tools/terrain-map-audit.mjs: the same three height
     oracles maxed together (backdrop / snow massif / registered ground),
     the same 25u mountain threshold, and a span derived from the live
     FLAT contract so it scales with the world instead of being pinned to
     a literal that silently stops covering the map.

     Pass {step, mtn, span} to override. Pure read — mutates nothing.
  ================================================================== */
  CBZ.worldLayoutAudit = function (opts) {
    opts = opts || {};
    const MTN = Number.isFinite(+opts.mtn) ? +opts.mtn : 25;
    const STEP = Number.isFinite(+opts.step) && +opts.step > 0 ? +opts.step : 60;
    const A = CBZ.city && (CBZ.city.arena || CBZ.city);
    const F = CBZ.TERRAIN_FLAT || { minX: -1600, maxX: 1600, minZ: -1600, maxZ: 1600 };
    const ccx = (F.minX + F.maxX) / 2, ccz = (F.minZ + F.maxZ) / 2;
    const chx = Math.max(1, (F.maxX - F.minX) / 2), chz = Math.max(1, (F.maxZ - F.minZ) / 2);
    const span = Number.isFinite(+opts.span) ? +opts.span : Math.max(chx, chz) + 400;

    // ---- 1. the PEER landmasses -------------------------------------
    // Same filter the math gate's overlap test uses: a biome-bearing,
    // non-underlay, non-link region. Causeways/bridges deliberately touch
    // two shores, and the wilds underlay covers everything, so neither is
    // a landmass and neither may set the spacing floor.
    // UNDERLAYS: the gate's overlap test drops them all, because an
    // ownership disc that contains a venue is not a clash. Spacing is a
    // different question — Diamond Speedway and the Greater Mercy Range
    // are marked underlay and they are unmistakably PLACES, so they stay;
    // only the `wilds` backcountry (which covers the whole map by
    // construction) is dropped.
    const isLink = function (r) { return /causeway|bridge|link/i.test((r && r.name) || ""); };
    const raw = ((A && A.regions) || []).filter(function (r) {
      return r && r.biome && r.biome !== "wilds" && !isLink(r) &&
        (Number.isFinite(r.minX) || (r.kind === "circle" && Number.isFinite(r.cx) && Number.isFinite(r.r)));
    }).map(function (r) {
      const b = (r.kind === "circle")
        ? { minX: r.cx - r.r, maxX: r.cx + r.r, minZ: r.cz - r.r, maxZ: r.cz + r.r }
        : { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
      return {
        name: r.name || r.biome, biome: r.biome,
        cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2,
        hx: (b.maxX - b.minX) / 2, hz: (b.maxZ - b.minZ) / 2,
        minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ,
        area: Math.max(0, (b.maxX - b.minX) * (b.maxZ - b.minZ)),
      };
    });
    // THE MAINLAND IS NOT A REGION. It lives on city.minX/maxX and has
    // never been in any region sweep — which meant the single biggest
    // landmass in the world was invisible to every spacing question ever
    // asked about it. Synthesise it here; the commerce annex (a disc on
    // city.annex, same story) rides in with it.
    if (A && Number.isFinite(A.minX)) {
      raw.push({ name: "Mainland (downtown)", biome: "city",
        cx: (A.minX + A.maxX) / 2, cz: (A.minZ + A.maxZ) / 2,
        hx: (A.maxX - A.minX) / 2, hz: (A.maxZ - A.minZ) / 2,
        minX: A.minX, maxX: A.maxX, minZ: A.minZ, maxZ: A.maxZ,
        area: (A.maxX - A.minX) * (A.maxZ - A.minZ) });
    }
    const AN = A && A.annex;
    // …unless it now registers itself. city/expansion.js finally puts the
    // Commerce Annex in city.regions (it never had been, which is why this
    // synthetic push exists at all); pushing it twice would put a zero-gap
    // pair in the table and pin minPairDistance at 0 forever.
    const annexIsRegion = raw.some(function (r) { return r && r.biome === "annex"; });
    if (!annexIsRegion && AN && Number.isFinite(AN.cx) && Number.isFinite(AN.radius)) {
      raw.push({ name: "Commerce Annex", biome: "annex",
        cx: AN.cx, cz: AN.cz, hx: AN.radius, hz: AN.radius,
        minX: AN.cx - AN.radius, maxX: AN.cx + AN.radius,
        minZ: AN.cz - AN.radius, maxZ: AN.cz + AN.radius,
        area: 4 * AN.radius * AN.radius });
    }
    // NESTED VENUES ARE NOT LANDMASSES. The jail compound sits inside the
    // city and the pit lane inside the speedway ON PURPOSE (the gate's own
    // 85% nesting rule). Left in, their zero gap would pin
    // minPairDistance at 0 forever and the metric would be dead.
    const regions = raw.filter(function (r) {
      for (let i = 0; i < raw.length; i++) {
        const o = raw[i];
        if (o === r || o.area <= r.area) continue;
        const w = Math.min(r.maxX, o.maxX) - Math.max(r.minX, o.minX);
        const d = Math.min(r.maxZ, o.maxZ) - Math.max(r.minZ, o.minZ);
        if (w > 0 && d > 0 && w * d >= 0.85 * r.area) return false;
      }
      return true;
    });

    // ---- 2. spacing: EDGE gaps, not centre distances ----------------
    // minPairDistance  = the tightest strait anywhere in the world.
    // meanPairDistance = the mean of each landmass's NEAREST-neighbour
    //   gap ("how much open country is around a place"), which is the
    //   number that tracks the owner's complaint. The mean over ALL
    //   pairs grows for free whenever the map does, so it is reported
    //   separately as evidence and is not the headline.
    // SAME-BIOME PAIRS ARE SKIPPED, for the reason the math gate's own
    // overlap test skips them: "same biome = sibling, fine". An annex
    // butted onto its own city, or three villages of one nation
    // clustered together, is DESIGN — counting those pinned
    // minPairDistance at 2u (measured, back when Goldspire still had its
    // civic campus) and the metric would never have moved again.
    let minPair = Infinity, allSum = 0, allPairs = 0, closest = null;
    const nearest = new Array(regions.length).fill(Infinity);
    const tight = [];
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i], b = regions[j];
        if (a.biome === b.biome) continue;
        const dx = Math.max(a.minX - b.maxX, 0, b.minX - a.maxX);
        const dz = Math.max(a.minZ - b.maxZ, 0, b.minZ - a.maxZ);
        const g = Math.sqrt(dx * dx + dz * dz);
        allSum += g; allPairs++;
        if (g < nearest[i]) nearest[i] = g;
        if (g < nearest[j]) nearest[j] = g;
        tight.push({ g: g, n: a.name + " <-> " + b.name });
        if (g < minPair) { minPair = g; closest = a.name + " <-> " + b.name; }
      }
    }
    let nnSum = 0, nnN = 0;
    for (let i = 0; i < nearest.length; i++) if (isFinite(nearest[i])) { nnSum += nearest[i]; nnN++; }
    // the eight tightest straits, named — a bare minimum is not actionable
    tight.sort(function (p, q) { return p.g - q.g; });
    const tightest = tight.slice(0, 8).map(function (t) { return Math.round(t.g) + "u  " + t.n; });

    // ---- 3. the relief grid ------------------------------------------
    const biomeAt = CBZ.cityBiomeAt || function () { return "?"; };
    const th = CBZ.terrainHeight || function () { return 0; };
    const sh = CBZ.snowTerrainHeightAt || function () { return 0; };
    const fl = CBZ.floorAt || function () { return 0; };
    const INNER = 0.5;                       // "the middle half of the map"
    let cells = 0, mtnCells = 0, outSnow = 0, innerMtn = 0, cityMtn = 0;
    let reliefSum = 0, reliefMax = 0, nonFinite = 0;
    let innerCells = 0, innerSum = 0, innerHill = 0, outerCells = 0, outerSum = 0;
    for (let x = ccx - span; x <= ccx + span; x += STEP) {
      for (let z = ccz - span; z <= ccz + span; z += STEP) {
        cells++;
        let b = "?"; try { b = biomeAt(x, z) || "?"; } catch (e) {}
        let h = 0;
        try {
          const h1 = th(x, z), h2 = sh(x, z), h3 = fl(x, z);
          if (!Number.isFinite(h1) || !Number.isFinite(h2) || !Number.isFinite(h3)) nonFinite++;
          h = Math.max(h1 || 0, h2 || 0, h3 || 0);
        } catch (e) { nonFinite++; }
        if (!Number.isFinite(h)) { h = 0; }
        reliefSum += h; if (h > reliefMax) reliefMax = h;
        const tx = Math.abs(x - ccx) / chx, tz = Math.abs(z - ccz) / chz;
        const isInner = (tx > tz ? tx : tz) <= INNER;
        if (isInner) { innerCells++; innerSum += h; if (h > 8) innerHill++; }
        else { outerCells++; outerSum += h; }
        if (h > MTN) {
          mtnCells++;
          // the math gate's OWN predicates, so these are upper bounds on it
          if (b !== "snow" && b !== "?") outSnow++;
          if (/city|urban|downtown|commerce/i.test(b)) cityMtn++;
          if (isInner) innerMtn++;
        }
      }
    }
    const r1 = function (v) { return Math.round(v * 10) / 10; };
    return {
      // --- the seven the layout contract names ---
      regions: regions.map(function (r) {
        return { name: r.name, biome: r.biome, cx: Math.round(r.cx), cz: Math.round(r.cz),
          hx: Math.round(r.hx), hz: Math.round(r.hz) };
      }),
      minPairDistance: isFinite(minPair) ? Math.round(minPair) : null,
      meanPairDistance: nnN ? Math.round(nnSum / nnN) : null,
      mountainCells: mtnCells,
      mountainCellsOutsideSnow: outSnow,      // RATCHET — may only go DOWN
      mountainCellsInnerHalf: innerMtn,       // the owner's "no lumps in the middle"
      cityOnMountain: cityMtn,                // RATCHET — pinned at 0 forever
      // --- evidence (never a ratchet; makes the seven readable) ---
      regionCount: regions.length,
      closestPair: closest,
      tightestStraits: tightest,
      meanAllPairs: allPairs ? Math.round(allSum / allPairs) : null,
      cells: cells, step: STEP, mtn: MTN, span: Math.round(span),
      center: { x: Math.round(ccx), z: Math.round(ccz) },
      halfExtent: { x: Math.round(chx), z: Math.round(chz) },
      reliefMax: Math.round(reliefMax),
      reliefMean: r1(cells ? reliefSum / cells : 0),
      reliefMeanInnerHalf: r1(innerCells ? innerSum / innerCells : 0),
      reliefMeanOuterHalf: r1(outerCells ? outerSum / outerCells : 0),
      hillCellsInnerHalf: innerHill,          // relief > 8u inside the middle half
      nonFinite: nonFinite,
      stage: CBZ.WORLD_LAYOUT_STAGE == null ? 1 : CBZ.WORLD_LAYOUT_STAGE,
      layoutV2: LAYOUT_V2(),
    };
  };

  CBZ.addLandmass(function (city) {
    if (CFG.CITY_CONTINENT === false) return;
    const T_BUILD0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    const regs = (city.regions || []).slice();
    const waterBodies = (city.waterBodies || []).slice();
    if (!regs.length) return;
    const COAST = CFG.CONTINENT_COAST !== false;
    const HARBOR = COAST && CFG.CONTINENT_HARBOR !== false;

    // ---- union bounds of everything walkable (mainland + every region) ----
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    function grow(x0, x1, z0, z1) {
      if (x0 < minX) minX = x0; if (x1 > maxX) maxX = x1;
      if (z0 < minZ) minZ = z0; if (z1 > maxZ) maxZ = z1;
    }
    for (const r of regs) grow(r.minX, r.maxX, r.minZ, r.maxZ);
    if (isFinite(city.minX)) grow(city.minX, city.maxX, city.minZ, city.maxZ);
    // Preserve every authored coordinate and expand OUTWARD from their union.
    // Legacy coast padding was only 40m; after the 44m coast safety inset that
    // left no traversable country beyond the outermost region. V2 creates a
    // substantial dry belt without scaling/moving a single city, biome or POI.
    const authoredBounds = { minX, maxX, minZ, maxZ };
    const LEGACY_PAD = 40;
    const requestedMargin = Number(CFG.CONTINENT_COUNTRY_MARGIN);
    // clamp roof 2400 (was 1800): the enlarged world's 2200 belt must fit —
    // the W ≤ 12000 bail below still bounds the total plate.
    const PAD = CFG.CONTINENT_EXPANSION_V2 === false ? LEGACY_PAD
      : Math.max(180, Math.min(2400, Number.isFinite(requestedMargin) ? requestedMargin : 1200));
    minX -= PAD; maxX += PAD; minZ -= PAD; maxZ += PAD;
    const W = maxX - minX, D = maxZ - minZ;
    // Sanity roof on the plate, NOT a design constraint — it exists so a
    // runaway region can never ask for a kilometre-scale PlaneGeometry. The
    // stage-3 layout (world/layout.js) puts the region union at 7756u wide,
    // which with the 2200u country belt is 12156 — over the old 12000 roof,
    // and blowing it would silently delete the entire continent. Raised to
    // 13500 with the layout flag (still ~1.3k of headroom, and the plate's
    // vertex count is fixed at (SEG+1)^2 regardless of W, so a wider plate
    // costs resolution, never memory). Flag off = the authored 12000.
    //
    // STAGE 4 (WORLD_SCALE_V4) re-measures it, because "silently delete the
    // entire continent" is exactly what a stale roof does and this world got
    // 1.6x wider. The union is now mbeya_west (-4766) to solara (4730) =
    // 9496 u, so W = 9496 + 2x2200 = 13896 and D = 8245 + 4400 = 12645.
    // 15500 keeps the same ~1.6k of headroom the stage-3 roof had.
    //
    // STAGE 5 (WORLD_SCALE_V5) re-measures it a third time. The Saltlands went
    // 10x by area and the three eastern nations moved out past its new shore.
    // MEASURED off the built plate rather than derived from the anchor table
    // (CBZ.worldScaleAudit().plateW), because the union is every REGISTERED
    // rect — link decks and pads included — not just the landmass anchors:
    // W = 17728 and D = 15782 with the 2200 belt. 19500 keeps ~1.8k of
    // headroom, in line with the previous two roofs. THIS IS THE NUMBER THAT
    // DELETES THE WORLD IF IT GOES STALE — `return` below bails the whole
    // plate, silently, and a world with no continent still boots.
    const W_ROOF = SCALE_V5() ? 19500 : (SCALE_V4() ? 15500 : (LAYOUT_V2() ? 13500 : 12000));
    if (!isFinite(W) || W <= 0 || W > W_ROOF) return;

    /* A GRID INDEX OVER RECTS. The plate's field functions each scanned every
       region (223) or every authored surface for all 224k vertices, several
       times a vertex. Each item is filed under the 256 m cells its rect, grown
       by `pad`, touches; a query scans only its own cell's list. Every caller
       is an any/min test, so visiting fewer items in the same relative order
       gives the same answer. A query with a margin wider than `pad` falls back
       to the full list. */
    function gridIndex(n, rectOf, pad) { return CBZ.rectGrid(n, rectOf, pad); }   // core/rectgrid.js
    function regRect(r) {
      if (!r) return null;
      if (r.kind === "circle") { const R = r.r + (r.pad || 0); return [r.cx - R, r.cx + R, r.cz - R, r.cz + R]; }
      return Number.isFinite(r.minX) ? [r.minX, r.maxX, r.minZ, r.maxZ] : null;
    }
    const REG_IX = gridIndex(regs.length, function (i) { return regRect(regs[i]); }, 32);

    function insideAnything(x, z, margin) {
      margin = margin || 0;
      if (isFinite(city.minX) &&
          x > city.minX - margin && x < city.maxX + margin &&
          z > city.minZ - margin && z < city.maxZ + margin) return true;
      if (margin <= REG_IX.pad) {
        const L = REG_IX.list(x, z);
        for (let j = 0; j < L.length; j++) {
          const r = regs[L[j]];
          if (r.kind === "circle") {
            if (Math.hypot(x - r.cx, z - r.cz) < r.r + (r.pad || 0) + margin) return true;
          } else if (x > r.minX - margin && x < r.maxX + margin &&
                     z > r.minZ - margin && z < r.maxZ + margin) return true;
        }
        return false;
      }
      for (const r of regs) {
        if (r.kind === "circle") {
          if (Math.hypot(x - r.cx, z - r.cz) < r.r + (r.pad || 0) + margin) return true;
        } else if (x > r.minX - margin && x < r.maxX + margin &&
                   z > r.minZ - margin && z < r.maxZ + margin) return true;
      }
      return false;
    }

    // The country plate is an UNDERLAY, not another full floor below every
    // authored place. At aircraft distances the 0.06u height gap is smaller
    // than one depth-buffer step (camera far expands to 2200), so the plate's
    // green triangles used to win randomly over runways, roads and biome pads.
    // Collect the already-built authored surface footprints now; the terrain
    // backdrop is intentionally built after this pass and cannot enter the set.
    const authoredSurfaceBounds = [];
    const surfaceBox = new THREE.Box3();
    // Most biome builders position a parent group after creating its local
    // floor. Box3.setFromObject updates the mesh itself but does not guarantee
    // a stale ancestor chain is refreshed. The former ordering therefore
    // recorded translated floors (most visibly Saltlands) at local origin and
    // carved country out of the wrong part of the map beside the speedway.
    // Resolve the complete hierarchy once before collecting world footprints.
    city.root.updateMatrixWorld(true);
    city.root.traverse(function (o) {
      if (!o || !o.isMesh || !o.userData || !o.userData.worldSurface) return;
      // Circle/Ring bounds are rectangles, not coverage. Treating those AABBs
      // as filled floors carved four clear-colour corners around every round
      // island. Sparse heightfields likewise own only their indexed mountain
      // faces; their unused rectangular attribute extent is not land cover.
      const gt = o.geometry && o.geometry.type;
      if (o.userData.sparseTerrain || o.userData.nonRectSurface || gt === "CircleGeometry" || gt === "RingGeometry") return;
      try {
        surfaceBox.setFromObject(o);
        if ([surfaceBox.min.x, surfaceBox.max.x, surfaceBox.min.z, surfaceBox.max.z].every(Number.isFinite)) {
          authoredSurfaceBounds.push({
            name: o.name || "(unnamed)", geometry: gt || "",
            minX: surfaceBox.min.x, maxX: surfaceBox.max.x,
            minZ: surfaceBox.min.z, maxZ: surfaceBox.max.z,
          });
        }
      } catch (e) {}
    });
    function insideAuthoredSurface(x, z, margin) {
      margin = margin || 0;
      // Only actual rendered surfaces may carve geometry. Region records are
      // gameplay/label bounds and are often deliberately broader than their
      // floor mesh; using them here created dry-land holes where the ocean then
      // correctly discarded itself. The mainland plane is already captured
      // below with its real 29u apron, so no synthetic city AABB is needed.
      const annex = city.annex;
      if (annex && Number.isFinite(annex.cx) && Number.isFinite(annex.cz) && Number.isFinite(annex.radius) &&
          Math.hypot(x - annex.cx, z - annex.cz) <= annex.radius + 2 + margin) return true;
      for (const b of authoredSurfaceBounds) {
        if (x >= b.minX - margin && x <= b.maxX + margin &&
            z >= b.minZ - margin && z <= b.maxZ + margin) return true;
      }
      return false;
    }
    function insideTerrainGrade(x, z, margin) {
      margin = margin || 0;
      for (const r of regs) {
        if (!r || !r.terrainGrade) continue;
        const p = (r.pad || 0) + margin;
        if (r.kind === "circle") {
          if (Math.hypot(x - r.cx, z - r.cz) <= r.r + p) return true;
        } else if (x >= r.minX - p && x <= r.maxX + p && z >= r.minZ - p && z <= r.maxZ + p) return true;
      }
      return false;
    }

    // ================= THE SHORE FIELD (deterministic) ====================
    // s(x,z): metres of dry land between the point and the nearest water.
    // Positive on land, negative in water. Two water bodies: the OUTER
    // COAST (a noise-wobbled inset of the plate rect) and, with HARBOR on,
    // the city bay ring. Any NON-bridge region force-holds land so a POI
    // can never be carved. All noise is CBZ.hash01 — byte-identical/seed.
    function sm(t) { return t * t * (3 - 2 * t); }
    const noise2 = CBZ.noise2 || function () { return 0.5; };   // core/seed.js
    // Signed distance inside a rounded continental frame. The old min-to-four-
    // edges field made the whole world a perfect square in orbital views even
    // after noise was added. A broad corner radius changes the land silhouette
    // while the expanded margin keeps the full authored union untouched.
    const coastCX = (minX + maxX) * 0.5, coastCZ = (minZ + maxZ) * 0.5;
    // THE FRONTIER LOOP'S SETBACK, declared once (the relief gate, the loop
    // builder and the coast cap below all read it). It was 190 m, which left
    // the coast room for 64 m of wobble: a ruled line round a rectangle.
    // At 760 m the sea may bite real bays out of the belt and the loop still
    // runs on dry land everywhere (coastInset is capped against it).
    const FRONTIER_IN = COAST ? 760 : 36;
    // Corner radius <= the setback: the rounded frame's inside distance is then
    // exactly FRONTIER_IN along the whole loop, corners included.
    const coastRadius = Math.min(FRONTIER_IN - 60, Math.min(W, D) * 0.12);
    function plateInsideDistance(x, z) {
      const qx = Math.abs(x - coastCX) - (W * 0.5 - coastRadius);
      const qz = Math.abs(z - coastCZ) - (D * 0.5 - coastRadius);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
      const inside = Math.min(Math.max(qx, qz), 0);
      return -(outside + inside - coastRadius);
    }
    // THE COASTLINE (owner: "the coast is a razor-straight line around a
    // rectangular continent"). It was a 10-74 m wobble on a 17 km edge: from
    // any height, a ruler. A real coast is organised at the scale of the land:
    // broad bays and headlands kilometres apart (2.6 km field, sharpened so a
    // bay is a bay and a headland a headland), coves inside them (900 m), and
    // a ragged edge (160 m). Capped strictly inside the frontier loop so the
    // road keeps >= 110 m of dry shoulder; every POI still holds its land
    // through inSolidRegion below. Pure noise2: deterministic per seed.
    const COAST_MAX_IN = FRONTIER_IN - 110;
    function coastInset(x, z) {
      const big = noise2(x + 3100, z - 1700, 2600, 8809);
      const bay = smooth01((big - 0.34) / 0.44);
      let v = 16 + bay * bay * 470
        + (noise2(x, z, 900, 8810) - 0.5) * 160 * (0.35 + bay)
        + (noise2(x, z, 160, 8811) - 0.5) * 36;
      if (v < 10) v = 10;
      return v > COAST_MAX_IN ? COAST_MAX_IN : v;
    }
    const BAY0 = 28, BAY1 = 95;          // bay ring: QUAY line → 95u out
    const hasCity = isFinite(city.minX);
    function bayDist(x, z) {
      // CHEBYSHEV distance outside the city rect — deliberately square, so
      // the water ring is the EXACT complement of the rectangular underlay
      // regions below AND lines up with swim.js's own rectangular
      // mainland-QUAY test (28u). Euclidean corners would leave slivers
      // where land shows but waterAt() says water (swim-on-land bug).
      if (!hasCity) return 1e9;
      const dx = Math.max(city.minX - x, 0, x - city.maxX);
      const dz = Math.max(city.minZ - z, 0, z - city.maxZ);
      return Math.max(dx, dz);
    }
    function isLinkReg(r) { return !!(r && r.name && /bridge|causeway|link/i.test(r.name)); }
    // The shore field asks this for every plate vertex and every coast-cache
    // corner, so the bridge/causeway test (a regex on the name) is decided
    // ONCE here instead of once per region per sample.
    const solidRegs = regs.filter(function (r) { return !isLinkReg(r); });
    const SOLID_IX = gridIndex(solidRegs.length, function (i) { return regRect(solidRegs[i]); }, 32);
    function inSolidRegion(x, z, m) {    // non-bridge regions hold their land
      const L = m <= SOLID_IX.pad ? SOLID_IX.list(x, z) : null;
      const n = L ? L.length : solidRegs.length;
      for (let j = 0; j < n; j++) {
        const r = solidRegs[L ? L[j] : j];
        if (r.kind === "circle") {
          const R = r.r + (r.pad || 0) + m, dx = x - r.cx, dz = z - r.cz;
          // hypot >= max(|dx|,|dz|): outside the square means outside the circle
          if (dx >= R || dx <= -R || dz >= R || dz <= -R) continue;
          if (Math.hypot(dx, dz) < R) return true;
        } else if (x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m) return true;
      }
      return false;
    }
    /* A RIVER IS A POLYLINE, and it had to become a third kind rather than a
       chain of rects. city/river.js's channel is ~7 km of 116 m water: as
       rects that is ~43 bodies, and inlandWaterField below is called for
       every plate vertex (224k of them), every physics ground query and every
       water test in the game — so 43 bodies is a 43x multiplier on the single
       hottest field in the world build. As ONE `path` body it is a bounding
       box reject for the whole country and, inside the box, a scan of the two
       or three segments the sample's own slice can reach.

       `b.half` may be a NUMBER (constant width) or an ARRAY parallel to
       `b.pts` (a channel that tapers, which a real river does at both ends).
       Returns the signed distance to the channel's edge, so a caller cannot
       tell a river from a lake — which is the point. */
    function pathBodyField(b, x, z, exact) {
      const bb = b.bbox;
      if (bb && !exact) {
        const ox = Math.max(bb.minX - x, 0, x - bb.maxX);
        const oz = Math.max(bb.minZ - z, 0, z - bb.maxZ);
        // Outside the box the box distance is only a LOWER BOUND on the
        // channel distance — and it used to be returned as the answer, which
        // drew a straight 26 m strip of sunken sand along every edge of every
        // river's bounding box (x = -2140 read "13.8 m from water" 2 km from
        // the Mercy River). Far out it is harmless (nothing reads the shore
        // beyond the relief's 1.3 km valley ramp); nearer, measure properly.
        if ((ox > 0 || oz > 0) && (ox > 1300 || oz > 1300)) return Math.hypot(ox, oz);
      }
      const p = b.pts;
      if (!p || p.length < 2) return Infinity;
      // per-segment bounds, once per body: a segment whose box is farther than
      // the best edge distance so far (plus its widest half) cannot win, so
      // it is skipped without the projection. Same minimum, a fraction of the
      // work (this field runs for all 224k plate vertices, several times).
      let SB = b._segBox;
      if (!SB || SB.p !== p || SB.n !== p.length || SB.h !== b.half) {
        SB = { p: p, n: p.length, h: b.half, box: new Float64Array((p.length - 1) * 5) };
        // non-enumerable: a cache, never data (the slice manifest clones bodies)
        Object.defineProperty(b, "_segBox", { value: SB, writable: true, configurable: true, enumerable: false });
        for (let i = 0; i + 1 < p.length; i++) {
          const hA = Array.isArray(b.half) ? b.half[i] : (+b.half || 40), hB = Array.isArray(b.half) ? b.half[i + 1] : hA;
          const o = i * 5;
          SB.box[o] = Math.min(p[i].x, p[i + 1].x); SB.box[o + 1] = Math.max(p[i].x, p[i + 1].x);
          SB.box[o + 2] = Math.min(p[i].z, p[i + 1].z); SB.box[o + 3] = Math.max(p[i].z, p[i + 1].z);
          SB.box[o + 4] = Math.max(hA, hB);
        }
      }
      const BX = SB.box;
      let best = Infinity;
      for (let i = 0; i + 1 < p.length; i++) {
        if (best < Infinity) {
          const o = i * 5;
          const ex = BX[o] - x > 0 ? BX[o] - x : (x - BX[o + 1] > 0 ? x - BX[o + 1] : 0);
          const ez = BX[o + 2] - z > 0 ? BX[o + 2] - z : (z - BX[o + 3] > 0 ? z - BX[o + 3] : 0);
          // hypot(ex, ez) - maxHalf is a lower bound on this segment's d
          if (ex - BX[o + 4] >= best || ez - BX[o + 4] >= best || Math.sqrt(ex * ex + ez * ez) - BX[o + 4] >= best) continue;
        }
        const ax = p[i].x, az = p[i].z, bx = p[i + 1].x, bz = p[i + 1].z;
        const vx = bx - ax, vz = bz - az;
        const L2 = vx * vx + vz * vz;
        let t = L2 > 0 ? ((x - ax) * vx + (z - az) * vz) / L2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const dx = x - (ax + vx * t), dz = z - (az + vz * t);
        const half = Array.isArray(b.half)
          ? (b.half[i] + (b.half[i + 1] - b.half[i]) * t)
          : (+b.half || 40);
        const d = Math.hypot(dx, dz) - half;
        if (d < best) best = d;
        if (best < -half) break;                            // deep inside: no closer answer matters
      }
      return best;
    }
    function waterBodyField(b, x, z) {
      if (!b) return Infinity;
      if (b.kind === "path") return pathBodyField(b, x, z);
      if (b.kind === "circle") {
        // A LAKE IS NOT A COMPASS CIRCLE (owner: "Kings Lake is a perfect
        // circle"). The registered radius is the basin's OUTER limit and the
        // shore wanders inside it: two lobe fields (a third and a tenth of the
        // radius) pull bays and points into the ring, never past it, so a
        // lake can only give land back to whatever was planned round it.
        const d = Math.hypot(x - b.cx, z - b.cz);
        // only the big open lakes the plate itself carves: a small pond cut
        // into a biome's own floor mesh (Redhollow) keeps that mesh's circle,
        // or the water oracle and the drawn basin would disagree
        if (d > b.r + 4 || b.r < 300) return d - b.r;
        const k = (b.cx * 0.37 + b.cz * 0.11) | 0;
        const lob = noise2(x + k, z - k, Math.max(50, b.r * 0.45), 8871) * 0.68
                  + noise2(x - k, z + k, Math.max(20, b.r * 0.16), 8872) * 0.32;
        const t = (lob - 0.22) / 0.56;
        return d - b.r * (0.60 + 0.40 * (t < 0 ? 0 : (t > 1 ? 1 : t)));
      }
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      if (dx > 0 || dz > 0) return Math.hypot(dx, dz);
      return -Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
    }
    // a path body whose box, less its widest half, is already past the nearest
    // answer cannot change the minimum (its field is >= that bound either way)
    function pathMaxHalf(b) {
      if (b._maxHalf != null) return b._maxHalf;
      let m = 0;
      if (Array.isArray(b.half)) { for (let i = 0; i < b.half.length; i++) if (b.half[i] > m) m = b.half[i]; }
      else m = +b.half || 40;
      Object.defineProperty(b, "_maxHalf", { value: m, writable: true, configurable: true, enumerable: false });
      return m;
    }
    function inlandWaterField(x, z) {
      let nearest = Infinity;
      for (let i = 0; i < waterBodies.length; i++) {
        const b = waterBodies[i];
        if (b && b.kind === "path" && b.bbox && nearest < Infinity) {
          const bb = b.bbox;
          const ox = Math.max(bb.minX - x, 0, x - bb.maxX), oz = Math.max(bb.minZ - z, 0, z - bb.maxZ);
          if (Math.sqrt(ox * ox + oz * oz) - pathMaxHalf(b) >= nearest) continue;
        }
        nearest = Math.min(nearest, waterBodyField(b, x, z));
      }
      return nearest;
    }
    function shoreField(x, z) { return shoreFieldWith(x, z, inlandWaterField(x, z)); }
    function shoreFieldWith(x, z, inland) {
      const e = plateInsideDistance(x, z);
      let s = e - coastInset(x, z);
      if (HARBOR) {
        const bd = bayDist(x, z);
        const sBay = bd <= BAY0 ? (BAY0 - bd)
                   : (bd >= BAY1 ? (bd - BAY1) : -Math.min(bd - BAY0, BAY1 - bd));
        if (sBay < s) s = sBay;
      }
      if (s < 12 && inSolidRegion(x, z, 8)) s = 12;   // POIs are never carved
      // Explicit inland water wins over its enclosing biome region. This same
      // signed result drives the sea cutout, swimmers, boats, wildlife and map.
      if (inland < s) s = inland;
      return s;
    }

    /* ---- THE RIVER (city/river.js) ------------------------------------
       THE HARBOUR PASS ABOVE BUILDS A MOAT. `bayDist` is a Chebyshev
       distance, so the water it opens between BAY0 and BAY1 is a closed 67 m
       ring around the city rect with no outlet on any side — and a flood
       fill from a marina berth proves it: 314 m and stop, with the nearest
       coast 7 km away. Every boat in this game was floating in a pond.

       The river cannot be a landmass builder of its own. It has to know
       where the SEA is to run to it, and NOTHING in this world knows that
       until the field above exists: before this builder, waterfield.js
       answers from a boot-time fallback that reads open country as ocean
       (which is precisely how city/marina.js came to put 104 of 112 berths
       on grass). So it is called HERE, with `coastOnly` — the same field
       minus the inland term, i.e. the coastline with no river in it yet,
       which is exactly the oracle "how far to the sea" needs — and the body
       it hands back is pushed into the array `inlandWaterField` reads, so
       one line later the shore field carves it like any other water.        */
    function coastOnly(x, z) {
      const e = plateInsideDistance(x, z);
      let s = e - coastInset(x, z);
      if (HARBOR) {
        const bd = bayDist(x, z);
        const sBay = bd <= BAY0 ? (BAY0 - bd)
                   : (bd >= BAY1 ? (bd - BAY1) : -Math.min(bd - BAY0, BAY1 - bd));
        if (sBay < s) s = sBay;
      }
      if (s < 12 && inSolidRegion(x, z, 8)) s = 12;
      return s;
    }
    if (CBZ.cityRiverCarve) {
      try {
        const rb = CBZ.cityRiverCarve(city, {
          shoreAt: coastOnly,
          plate: { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ },
        });
        // `waterBodies` is this builder's own slice and is what the field
        // reads; river.js also files the body on city.waterBodies for the
        // shader/highway consumers. Push here or the carve never happens.
        if (rb) waterBodies.push(rb);
      } catch (e) { console.error("[river]", e); }
    }
    // EVERY LARGE LAKE DRAINS (owner: "nothing flows to the sea"). Kings Lake
    // took the Kings River in and let nothing out. The river router that
    // found the harbour's way to the sea (city/river.js) finds each big
    // lake's too, with the same bridges over whatever road it has to cross;
    // a pond (< 300 m) may stay a pond.
    if (CBZ.cityLakeOutletCarve) {
      const lakes = waterBodies.filter(function (b) { return b && b.kind === "circle" && b.r >= 300; });
      for (let i = 0; i < lakes.length; i++) {
        try {
          const L = lakes[i];
          const ob = CBZ.cityLakeOutletCarve(city, {
            shoreAt: coastOnly, plate: { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ },
          }, { cx: L.cx, cz: L.cz, r: L.r, name: (L.name || "Lake").replace(/\s*(Lake|Pond)$/i, "") + " River",
               inside: function (x, z) { return waterBodyField(L, x, z) < -30; } });
          if (ob) { ob.outletOf = L.name || null; waterBodies.push(ob); }
        } catch (e) { console.error("[lake outlet]", e); }
      }
    }

    // ================= CONTINUOUS COUNTRY RELIEF =========================
    // The old continent only changed Y inside the 20m beach rim.  Everywhere
    // else its 100k vertices were mathematically flat, so even a huge map read
    // as a tabletop.  This height oracle is shared by the plate, floorAt and
    // country dressing.  Authored towns/airports/biomes remain graded pads;
    // broad hills rise only in the land between them.
    function countryFbm(x, z) {
      let sum = 0, amp = 0.58, freq = 1;
      for (let o = 0; o < 4; o++) {
        sum += (noise2(x * freq, z * freq, 310, 8890 + o) - 0.5) * amp;
        freq *= 2.07; amp *= 0.5;
      }
      return sum;
    }
    // Derivative-damped fractal ("Quilez erosion") + domain warp + per-octave
    // domain rotation — adopted from the reference TerrainGenerator (see
    // tools/adoption-terrain-forest.md). Each octave is divided down where the
    // running gradient is already steep, so detail collapses on slopes and
    // concentrates into weathered ridgelines while valley floors flatten; the
    // domain is warped (ridges meander) and rotated ~37deg per octave (no grid
    // lock). Same ~[-0.5,0.5] envelope as countryFbm, so the height composition
    // + coastFade/frontier gating in countryHeightAt are untouched. Analytic,
    // allocation-free, deterministic (noise2 -> CBZ.hash01; no shared rng stream,
    // no Math.random) -> byte-identical per seed across clients.
    const EROS_DAMP = 0.75;   // higher = flatter valleys, sharper ridges
    const EROS_LAC = 2.03;    // lacunarity (off 2 so octaves do not grid-lock)
    const EROS_WARP = 120;    // domain-warp amplitude (world units)
    function countryErodedHills(x, z) {
      const wx = x + (noise2(x + 130, z + 720, 900, 8898) - 0.5) * EROS_WARP;
      const wz = z + (noise2(x + 520, z + 130, 900, 8899) - 0.5) * EROS_WARP;
      let sum = 0, amp = 0.58, dX = 0, dZ = 0, px = wx, pz = wz, freq = 1;
      for (let o = 0; o < 5; o++) {
        const cell = 300 / freq;
        const step = cell * 0.3;
        const salt = 8890 + o;
        const n = noise2(px, pz, cell, salt);
        const nx = noise2(px + step, pz, cell, salt);
        const nz = noise2(px, pz + step, cell, salt);
        // per-cell (dimensionless) running gradient across octaves
        dX += (nx - n) / 0.3;
        dZ += (nz - n) / 0.3;
        sum += amp * (n - 0.5) / (1 + EROS_DAMP * (dX * dX + dZ * dZ));
        const rx = 0.80 * px - 0.60 * pz;   // rotate domain ~37deg per octave
        pz = 0.60 * px + 0.80 * pz; px = rx;
        freq *= EROS_LAC; amp *= 0.5;
      }
      return sum;
    }
    const FUTURE_ROUTE_IN = FRONTIER_IN;
    const futureX0 = minX + FUTURE_ROUTE_IN, futureX1 = maxX - FUTURE_ROUTE_IN;
    const futureZ0 = minZ + FUTURE_ROUTE_IN, futureZ1 = maxZ - FUTURE_ROUTE_IN;
    function frontierDistance(x, z) {
      if (CFG.CONTINENT_EXPANSION_V2 === false || PAD <= LEGACY_PAD + 80) return 1e9;
      let best = 1e9;
      if (x >= futureX0 - 28 && x <= futureX1 + 28) best = Math.min(best, Math.abs(z - futureZ0), Math.abs(z - futureZ1));
      if (z >= futureZ0 - 28 && z <= futureZ1 + 28) best = Math.min(best, Math.abs(x - futureX0), Math.abs(x - futureX1));
      return best;
    }
    // (THE RIM LAW — interior relief at 0.2x under a 23 m ceiling — is retired:
    //  it is what made the inhabited core a tabletop. See THE LANDFORM below.)
    // ---- THE BUILT-GROUND GATE (TERRAIN_FLATTEN_UNDER_BUILT) -------------
    // PLATE_SEG must agree with the SEG used to build the plate below — the
    // whole point of the flat band is that it is at least one PLATE CELL wide,
    // so BOTH vertices of a triangle straddling a kerb read zero relief and the
    // green can no longer climb through the asphalt between them.
    // THE SEGMENT COUNT IS DERIVED FROM THE CELL, NOT TYPED. 320 was measured
    // against a 12156 u plate — i.e. it is really the statement "a plate cell
    // is ~38 m". Left as a literal it would silently COARSEN as the world grew
    // (stage 4's 13896 u plate would run 43 m cells), and everything downstream
    // rides the cell: BUILT_FLAT below is one cell wide by construction, the
    // physics floor samples this grid, and the drawn ground's faceting IS this
    // number. So the cell is the constant and the segments follow it, rounded
    // to a multiple of 8 and capped so a runaway region can never ask for a
    // million-triangle plate.
    //   stage 3: max(12156, 11365)/38 = 320  (byte-identical — the cap and the
    //            rounding both land exactly on the authored value)
    //   stage 4: max(13896, 12645)/38 = 366  ->  368  (cells 37.8 x 34.4 m,
    //            369^2 = 136k verts, 271k triangles)
    //   stage 5: max(17728, 15782)/38 = 467  ->  472  (cells 37.6 x 33.4 m,
    //            473^2 = 224k verts, 446k triangles). The CAP has to move with
    //            it — left at 448 the derivation would CLIP and the cell would
    //            start creeping back up (39.6 m), which is exactly the silent
    //            coarsening this comment exists to prevent.
    const PLATE_CELL = 38;
    const PLATE_SEG = COAST
      ? Math.max(320, Math.min(SCALE_V5() ? 480 : 448, Math.ceil(Math.max(W, D) / PLATE_CELL / 8) * 8))
      : 72;
    const BUILT_FLAT = Math.hypot(W / PLATE_SEG, D / PLATE_SEG) + 6;
    const BUILT_FADE = 110;    // then the country rises back over ~one block
    const BUILT_REACH = BUILT_FLAT + BUILT_FADE;   // past this a surface cannot matter
    // Math.sqrt, never Math.hypot: this runs ~75 times per plate vertex over
    // 103k vertices at build, and V8's hypot (which guards against overflow) is
    // several times slower. The two branches above it mean the sqrt is only
    // reached for a genuine diagonal corner.
    function outsideRectDist(x, z, r0, r1, s0, s1) {
      const dx = Math.max(r0 - x, 0, x - r1), dz = Math.max(s0 - z, 0, z - s1);
      if (dx <= 0) return dz;
      if (dz <= 0) return dx;
      return Math.sqrt(dx * dx + dz * dz);
    }
    function builtBandGate(d) {
      if (d <= BUILT_FLAT) return 0;
      if (d >= BUILT_FLAT + BUILT_FADE) return 1;
      return smooth01((d - BUILT_FLAT) / BUILT_FADE);
    }
    // The graded regions, flattened into a plain array ONCE. The old boolean
    // form re-read `r.terrainGrade` and `r.pad` on every region on every call;
    // there are only ever a handful and they cannot change after the build.
    const gradedRegs = [];
    for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      if (!r || !r.terrainGrade) continue;
      const p = r.pad || 0;
      // A malformed record must not poison the gate with NaN (which silently
      // reads as "no flattening here" and would be invisible).
      if (r.kind === "circle") {
        if (![r.cx, r.cz, r.r].every(Number.isFinite)) continue;
        gradedRegs.push({ circle: true, cx: r.cx, cz: r.cz, rad: r.r + p });
      } else {
        if (![r.minX, r.maxX, r.minZ, r.maxZ].every(Number.isFinite)) continue;
        gradedRegs.push({ circle: false, minX: r.minX - p, maxX: r.maxX + p, minZ: r.minZ - p, maxZ: r.maxZ + p });
      }
    }
    // …and every footprint that declared itself through CBZ.terrainFlattenUnder
    // (round aprons, bowls, anything whose floor is not a rectangular mesh).
    // Snapshot ONCE: the plate is baked below, so a record arriving after this
    // point cannot move it and is reported instead of silently ignored.
    const declaredFlatten = FLATTEN_DECLS.length;
    for (let i = 0; i < declaredFlatten; i++) gradedRegs.push(FLATTEN_DECLS[i]);
    flattenSealedAt = declaredFlatten;
    // `gradedN` is the live scan length. It stays at the DECLARED count while
    // the lot-derived pass below asks "is this lot's ground already flat?", so
    // that answer can never be contaminated by a lot this same pass just added
    // (which would make the result depend on lot iteration order).
    let gradedN = gradedRegs.length;
    let lotsGated = 0, lotsSeen = 0;
    // 1 = untouched country, 0 = graded flat under (and one cell around) a
    // built surface. Allocation-free; the loops are the same ones the old
    // boolean form already walked, now with a Chebyshev pre-reject in front.
    let BG_IX = null;
    function builtGate(x, z) {
      if (CFG.TERRAIN_FLATTEN_UNDER_BUILT === false) {
        return (insideAuthoredSurface(x, z, 8) || insideTerrainGrade(x, z, 8)) ? 0 : 1;
      }
      let g = 1;
      const annex = city.annex;
      if (annex && Number.isFinite(annex.cx) && Number.isFinite(annex.cz) && Number.isFinite(annex.radius)) {
        const t = builtBandGate(Math.hypot(x - annex.cx, z - annex.cz) - (annex.radius + 2));
        if (t <= 0) return 0;
        if (t < g) g = t;
      }
      // the two rect lists grow while the build runs: re-file when they did
      if (!BG_IX || BG_IX.nA !== authoredSurfaceBounds.length || BG_IX.nG !== gradedN) {
        BG_IX = {
          nA: authoredSurfaceBounds.length, nG: gradedN,
          A: gridIndex(authoredSurfaceBounds.length, function (i) { const b = authoredSurfaceBounds[i]; return [b.minX, b.maxX, b.minZ, b.maxZ]; }, BUILT_REACH + 1),
          G: gridIndex(gradedN, function (i) { const r = gradedRegs[i]; return r.circle ? [r.cx - r.rad, r.cx + r.rad, r.cz - r.rad, r.cz + r.rad] : [r.minX, r.maxX, r.minZ, r.maxZ]; }, BUILT_REACH + 1),
        };
      }
      const LA = BG_IX.A.list(x, z), LG = BG_IX.G.list(x, z);
      for (let ia = 0; ia < LA.length; ia++) {
        const b = authoredSurfaceBounds[LA[ia]];
        // Chebyshev pre-reject first (four compares, no arithmetic) — the same
        // shape highwayNetReliefGate uses, and the reason this gate is
        // affordable inside a 103k-vertex build loop.
        if (x < b.minX - BUILT_REACH || x > b.maxX + BUILT_REACH ||
            z < b.minZ - BUILT_REACH || z > b.maxZ + BUILT_REACH) continue;
        const t = builtBandGate(outsideRectDist(x, z, b.minX, b.maxX, b.minZ, b.maxZ));
        if (t <= 0) return 0;
        if (t < g) g = t;
      }
      for (let ig = 0; ig < LG.length; ig++) {
        const r = gradedRegs[LG[ig]];
        let t;
        if (r.circle) {
          const dx = x - r.cx, dz = z - r.cz, rr = r.rad + BUILT_REACH;
          if (dx * dx + dz * dz > rr * rr) continue;
          t = builtBandGate(Math.sqrt(dx * dx + dz * dz) - r.rad);
        } else {
          if (x < r.minX - BUILT_REACH || x > r.maxX + BUILT_REACH ||
              z < r.minZ - BUILT_REACH || z > r.maxZ + BUILT_REACH) continue;
          t = builtBandGate(outsideRectDist(x, z, r.minX, r.maxX, r.minZ, r.maxZ));
        }
        if (t <= 0) return 0;
        if (t < g) g = t;
      }
      if (dgLive) {
        const t = derivedGate(x, z);
        if (t <= 0) return 0;
        if (t < g) g = t;
      }
      return g;
    }

    /* ---- BUILT GROUND, DERIVED (TERRAIN_BUILT_FROM_LOTS) ------------------
       OWNER, after the first pass shipped: "there's STILL green ground
       overlapping the stadium and many roadways."

       He was right, and the reason is the same one that made `ungated` read 0
       while a stadium stood in a hill: the gate was fed ONLY by things that
       opted in. Three registries the whole game already writes to had never
       been asked where the built world is —

         • city.lots      every building (world.js's mainland grid, and
                          towngen.js's towns, which push into the arena's
                          `A.lots`).
         • city.roads     ~198 axis-aligned segments, each carrying
                          {x, z, vertical, len, w}: a ready-made rect apiece.
                          A ROAD IS THE MOST BUILT SURFACE THERE IS.
         • CBZ.platforms  every authored walkable DECK, with its real top
                          height. This is what covers the stadium without
                          hard-coding a stadium: arena_venue.js pushes one
                          record per deck row, so the bowl publishes its own
                          extent (as do the causeway decks, bunkers, marina).
                          Trees and scatter never push platforms, which is
                          exactly why this is the right registry and
                          CBZ.colliders is not.

       COST CONTROL, because this is inside a 103k-vertex loop. Everything
       derived goes into ONE fixed 128 m grid, and a rect is CLIPPED into every
       cell it spans (never stamped whole into the cell of its centre), so a
       cell's union can never leave that cell. A query therefore only has to
       look at the cells within BUILT_REACH — a (2*DG_RAD+1)^2 = 5x5 = 25-entry
       Uint8 scan, most of it empty, INDEPENDENT of how many roads or platforms
       exist. That is a bounded ~25 byte-reads per vertex on top of the ~20
       rect tests already there; it does not scale with the world.

       Every source is pre-filtered by `alreadyFlat`, so a lot on a town pad, a
       street on the mainland slab and a highway the road-network gate already
       flattens contribute NOTHING. What survives is precisely the built things
       standing on raw country — which is the bug.
    ---------------------------------------------------------------------- */
    const DG_CELL = 128;
    const DG_RAD = Math.max(1, Math.ceil(BUILT_REACH / DG_CELL));
    const dgNX = Math.max(1, Math.ceil(W / DG_CELL) + 1), dgNZ = Math.max(1, Math.ceil(D / DG_CELL) + 1);
    const dgHas = new Uint8Array(dgNX * dgNZ);
    const dgBox = new Float32Array(dgNX * dgNZ * 4);
    let dgLive = false, dgCells = 0;
    let builtFromLots = 0, builtFromRoads = 0, builtFromVenues = 0;
    function dgStamp(x0, x1, z0, z1) {
      if (!(x1 > x0)) { const m = (x0 + x1) * 0.5; x0 = m - 0.5; x1 = m + 0.5; }
      if (!(z1 > z0)) { const m = (z0 + z1) * 0.5; z0 = m - 0.5; z1 = m + 0.5; }
      let i0 = Math.floor((x0 - minX) / DG_CELL), i1 = Math.floor((x1 - minX) / DG_CELL);
      let j0 = Math.floor((z0 - minZ) / DG_CELL), j1 = Math.floor((z1 - minZ) / DG_CELL);
      if (i1 < 0 || j1 < 0 || i0 >= dgNX || j0 >= dgNZ) return;
      if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
      if (i1 >= dgNX) i1 = dgNX - 1; if (j1 >= dgNZ) j1 = dgNZ - 1;
      for (let j = j0; j <= j1; j++) {
        const cz0 = minZ + j * DG_CELL, cz1 = cz0 + DG_CELL;
        const a0 = z0 > cz0 ? z0 : cz0, a1 = z1 < cz1 ? z1 : cz1;
        for (let i = i0; i <= i1; i++) {
          const cx0 = minX + i * DG_CELL, cx1 = cx0 + DG_CELL;
          const b0 = x0 > cx0 ? x0 : cx0, b1 = x1 < cx1 ? x1 : cx1;
          const k = j * dgNX + i, o = k * 4;
          if (!dgHas[k]) { dgHas[k] = 1; dgCells++; dgBox[o] = b0; dgBox[o + 1] = b1; dgBox[o + 2] = a0; dgBox[o + 3] = a1; }
          else {
            if (b0 < dgBox[o]) dgBox[o] = b0;
            if (b1 > dgBox[o + 1]) dgBox[o + 1] = b1;
            if (a0 < dgBox[o + 2]) dgBox[o + 2] = a0;
            if (a1 > dgBox[o + 3]) dgBox[o + 3] = a1;
          }
        }
      }
    }
    function derivedGate(x, z) {
      let ix = Math.floor((x - minX) / DG_CELL), iz = Math.floor((z - minZ) / DG_CELL);
      let i0 = ix - DG_RAD, i1 = ix + DG_RAD, j0 = iz - DG_RAD, j1 = iz + DG_RAD;
      if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
      if (i1 >= dgNX) i1 = dgNX - 1; if (j1 >= dgNZ) j1 = dgNZ - 1;
      let g = 1;
      for (let j = j0; j <= j1; j++) {
        const row = j * dgNX;
        for (let i = i0; i <= i1; i++) {
          const k = row + i;
          if (!dgHas[k]) continue;
          const o = k * 4;
          const t = builtBandGate(outsideRectDist(x, z, dgBox[o], dgBox[o + 1], dgBox[o + 2], dgBox[o + 3]));
          if (t <= 0) return 0;
          if (t < g) g = t;
        }
      }
      return g;
    }
    // "Is this point's ground ALREADY flat?" — the declared gate, plus the two
    // other corridor gates countryHeightAt multiplies in below. Composing them
    // here is what stops the highway network (kilometres of segments that
    // highwayNetReliefGate already zeroes) from filling the grid for nothing.
    function alreadyFlat(x, z) {
      if (builtGate(x, z) <= 0) return true;                       // dgLive is false here
      if (frontierDistance(x, z) <= 10) return true;
      if (CBZ.highwayNetReliefGate && CBZ.highwayNetReliefGate(x, z) <= 0) return true;
      return false;
    }
    if (CFG.TERRAIN_BUILT_FROM_LOTS !== false && CFG.TERRAIN_FLATTEN_UNDER_BUILT !== false) {
      // --- buildings -----------------------------------------------------
      const lots = Array.isArray(city.lots) ? city.lots : [];
      for (let i = 0; i < lots.length; i++) {
        const L = lots[i];
        if (!L || !Number.isFinite(L.cx) || !Number.isFinite(L.cz)) continue;
        lotsSeen++;
        if (alreadyFlat(L.cx, L.cz)) continue;
        const hw = Math.max(1, (Number.isFinite(L.w) ? L.w : 0) * 0.5);
        const hd = Math.max(1, (Number.isFinite(L.d) ? L.d : 0) * 0.5);
        dgStamp(L.cx - hw, L.cx + hw, L.cz - hd, L.cz + hd);
        builtFromLots++;
      }
      // --- roads ---------------------------------------------------------
      // Walked in ~64 m steps rather than stamped whole: a 900 m rural link is
      // usually flat where it crosses a town pad and NOT flat in between, and
      // stepping is what lets the grid hold only the parts that are actually
      // owed. `w` is the full deck width; +2.5 m of shoulder each side keeps the
      // straddling plate triangle at the kerb reading zero, which is the entire
      // point of the distance gate.
      const roads = Array.isArray(city.roads) ? city.roads : [];
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i];
        if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
        const len = Math.max(0, +r.len || 0);
        const half = (Math.max(4, +r.w || 8) * 0.5) + 2.5;
        const steps = Math.max(1, Math.ceil(len / 64));
        const seg = len / steps;
        for (let s = 0; s < steps; s++) {
          const off = -len / 2 + (s + 0.5) * seg;
          const px = r.vertical ? r.x : r.x + off;
          const pz = r.vertical ? r.z + off : r.z;
          if (alreadyFlat(px, pz)) continue;
          if (r.vertical) dgStamp(px - half, px + half, pz - seg / 2, pz + seg / 2);
          else dgStamp(px - seg / 2, px + seg / 2, pz - half, pz + half);
          builtFromRoads++;
        }
      }
      // --- venues / decks ------------------------------------------------
      // The stadium is not a lot and never will be. It is ~160 platform records
      // (one per deck row per side) published by arena_venue.js's own build, so
      // its footprint comes from the venue itself and no coordinate is repeated
      // here. Same for causeway decks, bunker roofs and the marina.
      const plats = Array.isArray(CBZ.platforms) ? CBZ.platforms : [];
      for (let i = 0; i < plats.length; i++) {
        const p = plats[i];
        if (!p || ![p.minX, p.maxX, p.minZ, p.maxZ].every(Number.isFinite)) continue;
        const px = (p.minX + p.maxX) * 0.5, pz = (p.minZ + p.maxZ) * 0.5;
        if (alreadyFlat(px, pz)) continue;
        dgStamp(p.minX - 2, p.maxX + 2, p.minZ - 2, p.maxZ + 2);
        builtFromVenues++;
      }
    }
    lotsGated = builtFromLots;
    gradedN = gradedRegs.length;
    dgLive = dgCells > 0;      // the gate now sees the derived grid too

    /* ==================================================================
       THE LANDFORM (owner, 2026-09-29: "make the terrain realer").

       WHAT WAS WRONG, measured on a 250 m sweep of the shipped world: the
       whole inhabited core (x -5000..6000, z -4500..4700) sat on 0-10 m and
       the only relief was a ring at the plate edge. Two laws did that on
       purpose — a "rim law" that kept the interior at a fifth of the swell,
       and a 23 m ceiling written to stay under the terrain audit's 25 m
       "mountain" line — and between them the country was a tabletop with a
       lip. Real land is organised by what made it: uplands and plains at the
       scale of the country, valleys where water runs, a range that rises out
       of foothills, and people who built on the flat land by the water.

       So the relief is now composed from THREE questions per point, and the
       third is the one that makes the others safe:

         1. WHAT LANDFORM IS HERE. A continent-scale upland field (5.6 km +
            2.3 km, domain-warped) sorts the country into plains (4-14 m of
            rolling ground) and uplands (+16..72 m, ridged), over the same
            eroded hill octaves as before. Near the Greater Mercy Range the
            land rises into FOOTHILLS (up to +58 m within ~2.8 km), so the
            range stands on its own apron instead of a flat floor.
         2. WHERE THE WATER IS. Land falls toward every river and lake over
            ~1.2 km (the Kings River, its outlet, the Mercy River run in real
            valleys), and toward the sea over a coast ramp that varies from a
            140 m bluff to a 520 m lowland.
         3. HOW FAR TO THE NEAREST BUILT THING. Every road, highway, causeway,
            the frontier loop, every lot, pad, town, metro and compound is
            rasterised into three distance fields (48 m cells, one chamfer
            pass each). The land is a PLAIN round what people built — full
            relief only ~900 m from a place and ~380 m from a road — so towns
            sit in the flat, roads run along the low ground, and nothing built
            ever meets a slope. The old gates (built/lots, highway corridors,
            frontier) still run last and still zero the ground under all of
            it; this envelope is what stops them from having to dig trenches.

       The same distance fields drive land use below (fields ring the towns,
       hedgerows follow the field grid) — ONE question, asked once.

       Determinism: noise2/hash only; the fields are rasterised from records
       in registration order and the chamfer is order-independent.
       Cost: 3 x ~122k-cell fields (48 m) + two chamfer passes each; the per-
       vertex composition adds ~6 noise2 taps and three bilinear reads.
    ================================================================== */
    const LF = 48;
    const lfNX = Math.max(2, Math.ceil(W / LF) + 1), lfNZ = Math.max(2, Math.ceil(D / LF) + 1);
    const LF_BIG = 1e7;
    const lfT0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    const fRoad = new Float32Array(lfNX * lfNZ).fill(LF_BIG);    // roads, highways, decks, frontier loop
    const fPlace = new Float32Array(lfNX * lfNZ).fill(LF_BIG);   // anything built or graded
    const fTown = new Float32Array(lfNX * lfNZ).fill(LF_BIG);    // where people live (lots, towns, metros)
    function lfRect(F, x0, x1, z0, z1) {
      if (!(x1 >= x0) || !(z1 >= z0)) return;
      let i0 = Math.floor((x0 - minX) / LF) - 1, i1 = Math.ceil((x1 - minX) / LF) + 1;
      let j0 = Math.floor((z0 - minZ) / LF) - 1, j1 = Math.ceil((z1 - minZ) / LF) + 1;
      if (i1 < 0 || j1 < 0 || i0 >= lfNX || j0 >= lfNZ) return;
      if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
      if (i1 >= lfNX) i1 = lfNX - 1; if (j1 >= lfNZ) j1 = lfNZ - 1;
      for (let j = j0; j <= j1; j++) {
        const pz = minZ + j * LF, row = j * lfNX;
        for (let i = i0; i <= i1; i++) {
          const d = outsideRectDist(minX + i * LF, pz, x0, x1, z0, z1);
          if (d < F[row + i]) F[row + i] = d;
        }
      }
    }
    function lfCircle(F, cx, cz, r) { lfRect(F, cx - r, cx + r, cz - r, cz + r); }  // a disc's box: conservative (flatter), never steeper
    function lfSeg(F, ax, az, bx, bz, half) {
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
      if (!(L2 > 0)) { lfRect(F, ax - half, ax + half, az - half, az + half); return; }
      const m = half + LF * 1.5;
      let i0 = Math.floor((Math.min(ax, bx) - m - minX) / LF), i1 = Math.ceil((Math.max(ax, bx) + m - minX) / LF);
      let j0 = Math.floor((Math.min(az, bz) - m - minZ) / LF), j1 = Math.ceil((Math.max(az, bz) + m - minZ) / LF);
      if (i1 < 0 || j1 < 0 || i0 >= lfNX || j0 >= lfNZ) return;
      if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
      if (i1 >= lfNX) i1 = lfNX - 1; if (j1 >= lfNZ) j1 = lfNZ - 1;
      for (let j = j0; j <= j1; j++) {
        const pz = minZ + j * LF, row = j * lfNX;
        for (let i = i0; i <= i1; i++) {
          const px = minX + i * LF;
          let t = ((px - ax) * vx + (pz - az) * vz) / L2;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
          const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
          const d2 = dx * dx + dz * dz;
          if (d2 > m * m) continue;
          const d = Math.sqrt(d2) - half;
          const v = d > 0 ? d : 0;
          if (v < F[row + i]) F[row + i] = v;
        }
      }
    }
    // 3x3 chamfer (1, sqrt2) in metres: two passes, ~8% worst-case overestimate,
    // which only ever makes the plain round a place slightly wider.
    function lfChamfer(F) {
      const a = LF, b = LF * 1.41421356;
      for (let j = 0; j < lfNZ; j++) {
        const row = j * lfNX;
        for (let i = 0; i < lfNX; i++) {
          const k = row + i; let v = F[k];
          if (i > 0 && F[k - 1] + a < v) v = F[k - 1] + a;
          if (j > 0) {
            const u = k - lfNX;
            if (F[u] + a < v) v = F[u] + a;
            if (i > 0 && F[u - 1] + b < v) v = F[u - 1] + b;
            if (i + 1 < lfNX && F[u + 1] + b < v) v = F[u + 1] + b;
          }
          F[k] = v;
        }
      }
      for (let j = lfNZ - 1; j >= 0; j--) {
        const row = j * lfNX;
        for (let i = lfNX - 1; i >= 0; i--) {
          const k = row + i; let v = F[k];
          if (i + 1 < lfNX && F[k + 1] + a < v) v = F[k + 1] + a;
          if (j + 1 < lfNZ) {
            const u = k + lfNX;
            if (F[u] + a < v) v = F[u] + a;
            if (i + 1 < lfNX && F[u + 1] + b < v) v = F[u + 1] + b;
            if (i > 0 && F[u - 1] + b < v) v = F[u - 1] + b;
          }
          F[k] = v;
        }
      }
    }
    function lfAt(F, x, z) {
      let fx = (x - minX) / LF, fz = (z - minZ) / LF;
      if (fx < 0) fx = 0; if (fz < 0) fz = 0;
      if (fx > lfNX - 1.001) fx = lfNX - 1.001; if (fz > lfNZ - 1.001) fz = lfNZ - 1.001;
      const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * lfNX + i;
      const a = F[k] + (F[k + 1] - F[k]) * tx, c = F[k + lfNX] + (F[k + lfNX + 1] - F[k + lfNX]) * tx;
      return a + (c - a) * tz;
    }
    const isMercyTerrain = function (b) { return /mount-mercy/i.test(b.name || ""); };
    const TOWN_SURF = /mini-city|country-settlement|town-street|mainland-city/i;
    (function seedLandform() {
      // ---- roads: every record, every deck, every highway corridor, the frontier loop
      const rds = Array.isArray(city.roads) ? city.roads : [];
      for (let i = 0; i < rds.length; i++) {
        const r = rds[i];
        if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
        const hl = Math.max(0, +r.len || 0) / 2, hw = Math.max(4, +r.w || 8) / 2 + 3;
        if (r.vertical) lfRect(fRoad, r.x - hw, r.x + hw, r.z - hl, r.z + hl);
        else lfRect(fRoad, r.x - hl, r.x + hl, r.z - hw, r.z + hw);
      }
      for (let i = 0; i < regs.length; i++) {
        const r = regs[i];
        if (!r || r.underlay || !isLinkReg(r)) continue;
        if (r.kind === "circle") lfCircle(fRoad, r.cx, r.cz, r.r + (r.pad || 0));
        else if ([r.minX, r.maxX, r.minZ, r.maxZ].every(Number.isFinite)) lfRect(fRoad, r.minX, r.maxX, r.minZ, r.maxZ);
      }
      const cor = CBZ.highwayNetCorridors ? CBZ.highwayNetCorridors() : null;
      if (cor) for (let i = 0; i < cor.length; i++) {
        const c = cor[i];
        if (c && [c.x0, c.z0, c.x1, c.z1].every(Number.isFinite)) lfSeg(fRoad, c.x0, c.z0, c.x1, c.z1, (+c.half || 15) + 8);
      }
      if (CFG.CONTINENT_EXPANSION_V2 !== false && PAD > LEGACY_PAD + 80) {
        const fx0 = minX + FRONTIER_IN, fx1 = maxX - FRONTIER_IN, fz0 = minZ + FRONTIER_IN, fz1 = maxZ - FRONTIER_IN;
        if (fx1 - fx0 > 600 && fz1 - fz0 > 600) {
          lfRect(fRoad, fx0 - 14, fx1 + 14, fz0 - 14, fz0 + 14); lfRect(fRoad, fx0 - 14, fx1 + 14, fz1 - 14, fz1 + 14);
          lfRect(fRoad, fx0 - 14, fx0 + 14, fz0 - 14, fz1 + 14); lfRect(fRoad, fx1 - 14, fx1 + 14, fz0 - 14, fz1 + 14);
          // the four lookouts stand 26 m inside the loop (buildFrontier's MID_IN)
          const mcx = (minX + maxX) / 2, mcz = (minZ + maxZ) / 2;
          lfRect(fPlace, mcx - 18, mcx + 18, fz0 + 26 - 14, fz0 + 26 + 14); lfRect(fPlace, mcx - 18, mcx + 18, fz1 - 26 - 14, fz1 - 26 + 14);
          lfRect(fPlace, fx0 + 26 - 18, fx0 + 26 + 18, mcz - 14, mcz + 14); lfRect(fPlace, fx1 - 26 - 18, fx1 - 26 + 18, mcz - 14, mcz + 14);
        }
      }
      // ---- places: every authored floor, graded pad, declared footprint, region, lot, deck
      for (let i = 0; i < authoredSurfaceBounds.length; i++) {
        const b = authoredSurfaceBounds[i];
        // Mount Mercy's own heightfield is ground, not a pad: it only needs
        // the land to meet its (zero-height) rim, i.e. a road-width ramp.
        lfRect(isMercyTerrain(b) ? fRoad : fPlace, b.minX, b.maxX, b.minZ, b.maxZ);
        if (TOWN_SURF.test(b.name || "")) lfRect(fTown, b.minX, b.maxX, b.minZ, b.maxZ);
      }
      for (let i = 0; i < gradedRegs.length; i++) {
        const r = gradedRegs[i];
        if (r.circle) lfCircle(fPlace, r.cx, r.cz, r.rad);
        else lfRect(fPlace, r.minX, r.maxX, r.minZ, r.maxZ);
      }
      for (let i = 0; i < regs.length; i++) {
        const r = regs[i];
        if (!r || r.underlay || isLinkReg(r) || r.biome === "snow" || r.biome === "wilds") continue;
        const F = fPlace;
        if (r.kind === "circle") { if ([r.cx, r.cz, r.r].every(Number.isFinite)) lfCircle(F, r.cx, r.cz, r.r + (r.pad || 0)); continue; }
        if (![r.minX, r.maxX, r.minZ, r.maxZ].every(Number.isFinite)) continue;
        lfRect(F, r.minX, r.maxX, r.minZ, r.maxZ);
        if (r.metro) lfRect(fTown, r.minX, r.maxX, r.minZ, r.maxZ);
      }
      const an = city.annex;
      if (an && [an.cx, an.cz, an.radius].every(Number.isFinite)) { lfCircle(fPlace, an.cx, an.cz, an.radius); lfCircle(fTown, an.cx, an.cz, an.radius); }
      if (isFinite(city.minX)) { lfRect(fPlace, city.minX, city.maxX, city.minZ, city.maxZ); lfRect(fTown, city.minX, city.maxX, city.minZ, city.maxZ); }
      const lots = Array.isArray(city.lots) ? city.lots : [];
      for (let i = 0; i < lots.length; i++) {
        const L = lots[i];
        if (!L || !Number.isFinite(L.cx) || !Number.isFinite(L.cz)) continue;
        const hw = Math.max(1, (+L.w || 0) * 0.5), hd = Math.max(1, (+L.d || 0) * 0.5);
        lfRect(fPlace, L.cx - hw, L.cx + hw, L.cz - hd, L.cz + hd);
        lfRect(fTown, L.cx - hw, L.cx + hw, L.cz - hd, L.cz + hd);
      }
      const plats = Array.isArray(CBZ.platforms) ? CBZ.platforms : [];
      for (let i = 0; i < plats.length; i++) {
        const p = plats[i];
        if (p && [p.minX, p.maxX, p.minZ, p.maxZ].every(Number.isFinite)) lfRect(fPlace, p.minX, p.maxX, p.minZ, p.maxZ);
      }
      lfChamfer(fRoad); lfChamfer(fPlace); lfChamfer(fTown);
    })();
    const landformMs = (typeof performance !== "undefined" && performance.now) ? performance.now() - lfT0 : 0;
    // ---- the Greater Mercy Range's footprint (biome_snow.js publishes it, dial-mapped)
    const GMB = CBZ.mtnGreatBounds || null;
    const FOOT_REACH = 2800, FOOT_LIFT = 58;
    const RELIEF_CAP = 92;           // soft ceiling: uplands top out in the 80s
    // 0..1 how far from anything built the land is free to rise
    function freedomAt(x, z) {
      const eR = smooth01((lfAt(fRoad, x, z) - 20) / 360);
      if (eR <= 0) return 0;
      const eP = smooth01((lfAt(fPlace, x, z) - 30) / 880);
      return eR < eP ? eR : eP;
    }
    CBZ.countryFreedomAt = freedomAt;
    CBZ.countryTownDistAt = function (x, z) { return lfAt(fTown, x, z); };
    CBZ.countryRoadDistAt = function (x, z) { return lfAt(fRoad, x, z); };
    // THE UPLAND FIELD, shared by the relief and the land use (fields keep to
    // the plains, woods climb the uplands). Memoised on the exact point: the
    // plate loop asks the land use and then the relief at the same vertex.
    const _mac = { x: NaN, z: NaN, wx: 0, wz: 0, upl: 0 };
    function macroAt(x, z) {
      if (x === _mac.x && z === _mac.z) return _mac;
      const wx = x + (noise2(x + 211, z - 977, 2400, 8950) - 0.5) * 1100;
      const wz = z + (noise2(x - 613, z + 419, 2400, 8951) - 0.5) * 1100;
      const m = noise2(wx, wz, 5600, 8952) * 0.6 + noise2(wx, wz, 2300, 8953) * 0.4;
      _mac.x = x; _mac.z = z; _mac.wx = wx; _mac.wz = wz; _mac.upl = smooth01((m - 0.45) / 0.24);
      return _mac;
    }
    function uplandAt(x, z) { return macroAt(x, z).upl; }
    // the raw landform, ungated: {h, upl, hills}
    const _lf = { h: 0, upl: 0, hills: 0 };
    function landformAt(x, z) {
      const n = (CFG.CONTINENT_RELIEF_EROSION === false)
        ? countryFbm(x + 1400, z - 900)
        : countryErodedHills(x + 1400, z - 900);
      let hills = n + 0.5; hills = hills < 0 ? 0 : (hills > 1 ? 1 : hills);
      const M = macroAt(x, z), wx = M.wx, wz = M.wz, upl = M.upl;
      const rg = 1 - Math.abs(2 * noise2(wx + 700, wz - 300, 760, 8954) - 1);
      let h = 2 + 12 * hills + upl * (16 + 40 * rg * rg + 16 * hills);
      if (GMB) {
        const dOut = outsideRectDist(x, z, GMB.minX, GMB.maxX, GMB.minZ, GMB.maxZ);
        if (dOut < FOOT_REACH) {
          const f = 1 - smooth01(dOut / FOOT_REACH);
          h += FOOT_LIFT * f * (0.7 + 0.3 * hills);
        }
      }
      _lf.h = h; _lf.upl = upl; _lf.hills = hills;
      return _lf;
    }

    function countryHeightAt(x, z) {
      if (CFG.CONTINENT_RELIEF_V1 === false) return 0;
      if (x < minX || x > maxX || z < minZ || z > maxZ) return 0;
      const built = builtGate(x, z);
      if (built <= 0) return 0;
      const free = freedomAt(x, z);
      if (free <= 0) return 0;
      // ONE inland-water query serves both the shore and the valley term
      const inland = inlandWaterField(x, z);
      const shore = COAST ? shoreFieldWith(x, z, inland) : 100;
      if (shore <= 38) return 0;
      // the coast ramp varies along the shore: a 140 m bluff here, a 520 m
      // lowland there — never the same ruled bank all the way round
      const coastFade = smooth01((shore - 38) / (140 + 380 * noise2(x, z, 1900, 8956)));
      const L = landformAt(x, z);
      // valleys: the land falls toward every river and lake over ~1.2 km
      const valley = 0.28 + 0.72 * smooth01((inland - 60) / 1200);
      let h = L.h * valley * coastFade * free;
      h = RELIEF_CAP * Math.tanh(h / RELIEF_CAP);
      // Frontier highways are cut into the landscape with broad shoulders;
      // their visible planes never hover over a noisy heightfield.
      const fd = frontierDistance(x, z);
      h *= smooth01((fd - 10) / 36);
      // Same cut for the highway NETWORK (city/highwaynet.js): relief flattens
      // under every route corridor so the flat decks never hover over hills.
      if (CBZ.highwayNetReliefGate) h *= CBZ.highwayNetReliefGate(x, z);
      // …and the same cut under every BUILT surface (lots, aprons, town
      // floors, graded pads). Applied last with the other two gates so all
      // three are the same kind of thing: a multiplier that only removes.
      h *= built;
      return Math.max(0, h);
    }
    function smooth01(v) { v = v < 0 ? 0 : (v > 1 ? 1 : v); return v * v * (3 - 2 * v); }
    CBZ.countryTerrainHeightAt = countryHeightAt;
    // The ONE height every country consumer reads. It starts as the analytic
    // field (nothing has built the plate yet) and is swapped for the plate's
    // own interpolated grid the moment that grid exists — see
    // TERRAIN_PHYSICS_MATCH below. Degrade-safe: if the plate build ever bails,
    // this stays the analytic field and the world is exactly what it was.
    let reliefAt = countryHeightAt;
    let reliefRec = null;
    if (CBZ.registerCityGroundHeight) {
      reliefRec = CBZ.registerCityGroundHeight(function (x, z) { return reliefAt(x, z); },
        { name: "Backcountry relief", biome: "wilds" });
    }

    // Publish the exact coast oracle used by the rendered continent.  The
    // navigation map samples this instead of inventing rounded rectangles or
    // drawing the underlay registry bands as enormous roads.  One coastline
    // now owns world geometry, swimming and cartography.
    city.mapTerrain = {
      bounds: { minX, maxX, minZ, maxZ },
      shoreAt: COAST ? shoreField : function () { return 1; },
      waterBodies: waterBodies,
      inlandWaterAt: function (x, z) { return inlandWaterField(x, z) < 0; },
    };

    // ---- the ground plate: one draw call, vertex-coloured country ---------
    // With COAST on the grid is denser (the rim needs resolution) and the
    // outer band slopes through sand into carved seabed under the sea plane.
    // A 160-cell plate left 20-35m shoreline triangles in this world. Those
    // triangles visibly sliced through the animated sea as large green/tan
    // checker patches from aircraft. The denser coast remains one draw call
    // and is tiny beside the city geometry budget.
    // ONE segment count, declared above with the built-ground gate (which sizes
    // its flat band from the plate CELL and so must not be able to disagree
    // with it). PLATE_SEG is that number.
    const SEG = PLATE_SEG;
    const geo = new THREE.PlaneGeometry(W, D, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    // Keep country unmistakably terrestrial through flight-distance fog.
    // The former pale cyan-leaning greens converged on the sea colour and
    // made correctly grounded trees read as if they were floating in water.
    // THESE ARE sRGB DISPLAY COLOURS, decoded to linear albedo once the
    // whole plate is painted (CONTINENT_LINEAR_ALBEDO below). They used to
    // reach the lights undecoded — a meadow
    // reflecting 45% green, sand 86% — and the whole backcountry came out
    // one pale mint (214,230,201) from the air: "the ground from far away
    // just looks like boring green". Picked so the decoded reflectance is a
    // real one (meadow ~0.08/0.12/0.04, straw ~0.22/0.18/0.09, sand ~0.5).
    const cGrass = new THREE.Color(0x56683a), cDry = new THREE.Color(0x857a57);
    const cDirt = new THREE.Color(0x6f5d4a), cScrub = new THREE.Color(0x565d40);
    const cLush = new THREE.Color(0x40613a);                 // moist shore band
    const cSand = new THREE.Color(0xc4b08a), cWet = new THREE.Color(0x9c8a66);
    const cBed = new THREE.Color(0x8a8a6b);                  // submerged seabed
    // LAND USE seen from the air: woodland floor under the forest's own
    // stands (forestlook's stand mask, so the dark ground is where the trees
    // are), and farm country as a mosaic of parcels, each its own crop
    const cWood = new THREE.Color(0x3a4530);
    const CROPS = [0x455d31, 0x59693f, 0x8c7f59, 0x7f765d, 0x54493c, 0x61654b, 0x4d6434, 0x9c9345].map(function (h) { return new THREE.Color(h); });
    const FLOOK_N = CBZ.forestLook && CBZ.forestLook.noise;
    const hsh = CBZ.hash01 || function () { return 0.5; };
    // FARM COUNTRY RINGS THE PLACES PEOPLE LIVE (owner: "farmland is one
    // square far from any town; towns end abruptly at the country"). The
    // field weight used to be a 1.4 km noise blob that could fall anywhere;
    // it is now a ring round every town, metro and lot (the town distance
    // field above): fields start just past the last building and run out
    // 1.2-2.3 km later into rough grazing and wood. Fields keep to the flat:
    // they give way on uplands and steep ground (the landform's upland
    // term) and on the plains beside rivers they run right to the bank.
    // Parcels are the SAME 190 m grid the hedgerows are planted on, axis-
    // aligned with the roads, some pairs merged into 380 m fields.
    const FIELD_GRID = 190, FIELD_OX = minX + 37, FIELD_OZ = minZ + 61;
    function fieldWeightAt(x, z, upl) {
      const dT = lfAt(fTown, x, z);
      if (dT > 3000) return 0;
      const reach = 1200 + 1100 * noise2(x + 1700, z - 900, 1400, 8840);
      let w = smooth01((dT - 30) / 80) * (1 - smooth01((dT - reach) / 450));
      if (w <= 0) return 0;
      w *= 1 - smooth01(((upl == null ? uplandAt(x, z) : upl) - 0.30) / 0.40);
      return w;
    }
    // -> farmland weight at (x,z); `out` gets that parcel's crop
    function fieldAt(x, z, out, wIn) {
      const w = wIn == null ? fieldWeightAt(x, z) : wIn;
      if (w <= 0) return 0;
      const cu = Math.floor((x - FIELD_OX) / FIELD_GRID), cv = Math.floor((z - FIELD_OZ) / FIELD_GRID);
      // some neighbours share a crop: a 380 m field, split on alternate rows
      const pu = hsh(cu >> 1, cv, 8842) < 0.5 ? cu >> 1 : cu;
      const k = hsh(pu * 3 + (pu === cu ? 1 : 0), cv, 8841);
      const i = k < 0.04 ? 7 : Math.min(6, Math.floor((k - 0.04) / 0.96 * 7));
      out.copy(CROPS[i]).multiplyScalar(0.94 + 0.12 * hsh(pu, cv, 8844));
      return w;
    }
    // Where woods want to be: the uplands and slopes (+), never the farm
    // ring (-). Shared by the ground tone above and the tree stands below.
    function woodBias(x, z, fw, upl) {
      if (upl == null) upl = uplandAt(x, z);
      return 0.16 * upl - 0.30 * (fw == null ? fieldWeightAt(x, z, upl) : fw);
    }
    const cField = new THREE.Color();
    const c = new THREE.Color(), c2 = new THREE.Color();
    const biomeBlends = (city.biomeBlends || CBZ._biomeBlendSpecs || []).slice();
    const biomePalettes = biomeBlends.map(function (spec) {
      return {
        spec: spec,
        inner: new THREE.Color(spec.inner == null ? 0x65724c : spec.inner),
        outer: new THREE.Color(spec.outer == null ? 0x58704c : spec.outer),
      };
    });
    function applyBiomeLandCover(base, x, z) {
      if (!biomePalettes.length || !CBZ.biomeBlendWeightAt) return;
      let sum = 0, rr = 0, gg = 0, bb = 0;
      for (let j = 0; j < biomePalettes.length; j++) {
        const p = biomePalettes[j];
        const w = CBZ.biomeBlendWeightAt(p.spec, x, z);
        if (w <= 0.002) continue;
        const ww = w * w;
        const r = p.outer.r + (p.inner.r - p.outer.r) * w;
        const g = p.outer.g + (p.inner.g - p.outer.g) * w;
        const b = p.outer.b + (p.inner.b - p.outer.b) * w;
        sum += ww; rr += r * ww; gg += g * ww; bb += b * ww;
      }
      if (sum <= 0) return;
      c2.setRGB(rr / sum, gg / sum, bb / sum);
      // Multiple neighboring influences mix by weight instead of one biome
      // painting over another. Their overlap becomes a real ecotone.
      base.lerp(c2, blendSmooth(Math.min(1, sum)) * 0.94);
    }
    function blendSmooth(v) { return v * v * (3 - 2 * v); }
    const cx0 = (minX + maxX) / 2, cz0 = (minZ + maxZ) / 2;
    const GROUND_Y = -0.06;                                   // interior land level
    const SEA_Y = CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;
    // world.js's current swell reaches ±0.355m. Keep submerged coast vertices
    // below the *real* trough with margin; the stale 0.18m offset let every
    // trough reveal the continent mesh through the water.
    const SUBMERGED_Y = SEA_Y - 0.44;
    // cache the shore field per vertex — the foam pass re-reads it below
    const sGrid = COAST ? new Float32Array(pos.count) : null;
    // cache the relief per vertex too: the strata/aspect pass below derives its
    // slope from the NEIGHBOURING grid samples instead of re-evaluating
    // countryHeightAt four more times per vertex (that would have quintupled
    // this 103k-vertex loop's cost for a shading term).
    const rGrid = new Float32Array(pos.count);
    /* THE PLATE IS BAKED ONCE PER VERSION (core/bakecache.js). This loop is the
       biggest single piece of the city build on a phone (~20 field evaluations
       for each of 224k vertices). Its outputs are a pure function of what the
       signature below names: the code (script versions), the seed, the config,
       every region / water body / blend / authored surface / graded footprint
       it reads and the derived built-ground grid. Same inputs: last visit's
       arrays. Anything different: computed exactly as before. */
    let PLATE_SIG = null, PLATE_BAKE = null;
    CBZ._plateSig = null;
    if (CBZ.bakeSig && CBZ.bakeGet) {
      try {
        PLATE_SIG = CBZ.bakeSig("plate|" + CBZ.bakeHash({ W: W, D: D, SEG: SEG, cx0: cx0, cz0: cz0, COAST: COAST, HARBOR: HARBOR,
          regs: regs, water: waterBodies, blends: CBZ._biomeBlendSpecs || null, asb: authoredSurfaceBounds, gr: gradedRegs.slice(0, gradedN),
          annex: city.annex ? { cx: city.annex.cx, cz: city.annex.cz, r: city.annex.radius } : null, cfg: CFG }) + "|" + CBZ.bakeHashArr(dgHas) + CBZ.bakeHashArr(dgBox));
        CBZ._plateSig = PLATE_SIG;            // the backdrop's inputs start here
        PLATE_BAKE = CBZ.bakeGet("continent-plate", PLATE_SIG);
        if (PLATE_BAKE && !(PLATE_BAKE.y && PLATE_BAKE.y.length === pos.count && PLATE_BAKE.c && PLATE_BAKE.c.length === colors.length && PLATE_BAKE.r && (!COAST || (PLATE_BAKE.s && PLATE_BAKE.s.length === pos.count)))) PLATE_BAKE = null;
      } catch (e) { PLATE_SIG = null; PLATE_BAKE = null; }
    }
    if (PLATE_BAKE) {
      const Y = PLATE_BAKE.y;
      for (let i = 0; i < pos.count; i++) pos.setY(i, Y[i]);
      colors.set(PLATE_BAKE.c); rGrid.set(PLATE_BAKE.r);
      if (sGrid) sGrid.set(PLATE_BAKE.s);
    }
    for (let i = PLATE_BAKE ? pos.count : 0; i < pos.count; i++) {
      const wx = pos.getX(i) + cx0, wz = pos.getZ(i) + cz0;
      // two octaves of position-hash "noise" pick the patch tone —
      // deterministic per seed, no shared rng stream touched.
      let shade;
      if (CFG.CONTINENT_LANDCOVER_V2 !== false) {
        // ---- LANDCOVER V2 (the far-view discoloration fix) ----------------
        // The old pick hashed 90u / 22u CELLS (Math.floor — hard edges, no
        // interpolation) straight into a high-contrast palette, plus a ±5%
        // per-cell brightness jitter. Close up that reads as pleasant patchy
        // ground; from a rooftop or a canopy the cells are at the vertex
        // grid's Nyquist limit and the whole country dissolves into the
        // orange/green confetti the owner screenshotted ("looks good close
        // up, far away it looks weird"). Real land cover is the opposite:
        // broad coherent regions with soft ecotones, fine detail only near.
        // Three SMOOTH fields replace the cell hash — a 760u land-use mosaic
        // (meadow vs scrub), a 170u dryness variation, and a low-contrast
        // 46u dirt break — so distance integrates to calm coherent regions
        // instead of noise. Deterministic (noise2 → hash01, fresh salts).
        // `?cfg_CONTINENT_LANDCOVER_V2=0` restores the exact old confetti.
        const use = noise2(wx + 310, wz - 140, 760, 8830);
        const veg = noise2(wx - 90, wz + 260, 170, 8831);
        const fine = noise2(wx + 40, wz + 40, 46, 8832);
        c.copy(cGrass).lerp(cScrub, smooth01((use - 0.34) / 0.34));
        c.lerp(cDry, smooth01((veg - 0.60) / 0.32) * 0.85);
        c.lerp(cDirt, smooth01((fine - 0.76) / 0.18) * 0.38);
        shade = 0.958 + veg * 0.06;                        // gentle, smooth facet variation
      } else {
        const h1 = CBZ.hash01 ? CBZ.hash01(Math.floor(wx / 90), Math.floor(wz / 90), 8801) : 0.5;
        const h2 = CBZ.hash01 ? CBZ.hash01(Math.floor(wx / 22), Math.floor(wz / 22), 8802) : 0.5;
        c.copy(h1 < 0.55 ? cGrass : (h1 < 0.8 ? cScrub : cDry));
        if (h2 > 0.86) c.copy(cDirt);                      // dirt breaks
        shade = 0.92 + h2 * 0.1;
      }
      // large-scale hue drift (300u) so kilometres of country stop reading
      // as one repeated swatch — dryer here, greener there.
      const drift = noise2(wx, wz, 300, 8812) - 0.5;
      c.lerp(cDry, Math.max(0, drift) * 0.5);
      c.lerp(cLush, Math.max(0, -drift) * 0.4);
      if (CFG.CONTINENT_LANDUSE_V1 !== false) {
        // the wood floor follows the same stand decision the trees do (see
        // woodBias: woods climb the uplands and keep off the farm ring)
        const upl = uplandAt(wx, wz), fw0 = fieldWeightAt(wx, wz, upl);
        const stand = (FLOOK_N ? FLOOK_N(wx, wz, 760, 4441) : 0) - 0.19 + woodBias(wx, wz, fw0, upl);
        const wood = smooth01((stand - 0.34) / 0.2);
        const fw = (fw0 > 0 ? fieldAt(wx, wz, cField, fw0) : 0) * (1 - smooth01((stand - 0.22) / 0.12));
        if (fw > 0) c.lerp(cField, fw * 0.9);
        if (wood > 0) c.lerp(cWood, wood * 0.75);
      }
      applyBiomeLandCover(c, wx, wz);
      const reliefY = countryHeightAt(wx, wz);
      rGrid[i] = reliefY;
      let y = GROUND_Y + reliefY;
      if (COAST) {
        const inl = inlandWaterField(wx, wz);
        const s = shoreFieldWith(wx, wz, inl);
        sGrid[i] = s;
        // A RIVER OR LAKE HAS A BANK, NOT A BEACH (owner: "Kings Lake ... with
        // a white rim"): sand is for the sea; fresh water meets mud and reeds.
        const fresh = inl <= s + 0.5;
        if (s < 0) {
          // Underwater: begin below the lowest swell, then slope into a real
          // seabed. The former -0.44 start sat above the mean sea and caused
          // the filmed checkerboard as waves crossed it.
          const t = Math.min(1, -s / 9);
          y = SUBMERGED_Y - t * 1.15;
          c.copy(cWet).lerp(cBed, t);
        } else if (s < 26) {
          // Shore rim: the exact zero crossing starts safely under the moving
          // surface, then rises through wet/dry sand onto solid country. Wave
          // wash can cover the first metres without exposing a coplanar slab.
          y = SUBMERGED_Y + sm(Math.min(1, s / 26)) * (GROUND_Y + reliefY - SUBMERGED_Y);
          if (fresh) {
            c2.copy(c).lerp(cLush, 0.45);
            if (s < 7) c.copy(cWet).lerp(cDirt, sm(s / 7));
            else c.copy(cDirt).lerp(c2, sm((s - 7) / 19));
          }
          else if (s < 6) c.copy(cWet).lerp(cSand, sm(s / 6));
          else if (s < 15) c.copy(cSand);
          else c2.copy(c), c.copy(cSand).lerp(c2, sm((s - 15) / 11));
        } else if (s < 52) {
          // moist band just behind the sand — the coast reads vegetated
          c.lerp(cLush, (1 - (s - 26) / 26) * 0.35);
        }
      }
      pos.setY(i, y);
      colors[i * 3] = c.r * shade; colors[i * 3 + 1] = c.g * shade; colors[i * 3 + 2] = c.b * shade;
    }
    // the loop's own outputs, kept for the combined bake below (the passes
    // after this point change the colours in place)
    let PLATE_Y = null, PLATE_C = null;
    if (!PLATE_BAKE && PLATE_SIG && CBZ.bakePut) {
      PLATE_Y = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) PLATE_Y[i] = pos.getY(i);
      PLATE_C = colors.slice();
    }

    // ==================================================================
    //  TERRAIN_PHYSICS_MATCH — THE SURFACE YOU SEE IS THE SURFACE YOU DRIVE ON
    // ==================================================================
    // rGrid now holds the relief at every plate VERTEX. Interpolating it across
    // the plate's OWN triangles reproduces the rendered surface exactly, which
    // is a stronger statement than "close": there is no tuning constant here
    // and no way for the two to drift apart again, because there is only one
    // set of numbers.
    //
    // r128 PlaneGeometry emits, per cell, indices (a,b,d) then (b,c,d) with
    // a=(ix,iy) b=(ix,iy+1) c=(ix+1,iy+1) d=(ix+1,iy) — so in local cell
    // coordinates the first triangle covers tx+tz<=1 and the second the rest.
    // Getting that split right is the difference between matching the mesh and
    // matching a bilinear approximation of it (up to ~1 m apart on a ridge).
    //
    // COST: one bounds test, one floor, three array reads, ~6 flops. Measured
    // against the analytic field it replaces: 2.2-2.5 µs -> ~0.05 µs per call,
    // which takes the WHOLE CBZ.floorAt stack from 6.03 µs to ~0.35 µs. That
    // is the only reason city/vehicles.js can afford four ground probes per car
    // per frame. Memory: SEG=320 -> 103,041 floats = 412 KB, already allocated.
    const RSTRIDE = SEG + 1;
    const RMINX = cx0 - W / 2, RMINZ = cz0 - D / 2;
    const RINVDX = SEG / W, RINVDZ = SEG / D;
    function reliefSample(x, z) {
      const fx = (x - RMINX) * RINVDX, fz = (z - RMINZ) * RINVDZ;
      if (!(fx >= 0 && fz >= 0 && fx <= SEG && fz <= SEG)) return 0;
      let i0 = fx | 0, j0 = fz | 0;
      if (i0 >= SEG) i0 = SEG - 1;
      if (j0 >= SEG) j0 = SEG - 1;
      const tx = fx - i0, tz = fz - j0;
      const base = j0 * RSTRIDE + i0;
      const a = rGrid[base], b = rGrid[base + RSTRIDE], d = rGrid[base + 1];
      const h = (tx + tz <= 1)
        ? a + (d - a) * tx + (b - a) * tz
        : rGrid[base + RSTRIDE + 1] * (tx + tz - 1) + b * (1 - tx) + d * (1 - tz);
      return h > 0 ? h : 0;
    }
    if (CFG.TERRAIN_PHYSICS_MATCH !== false) reliefAt = reliefSample;
    // The ONE country-height query for anything that stands on, drives over or
    // is scattered across the backcountry. Never re-derive it from
    // countryTerrainHeightAt again — that is the analytic field, and it is not
    // what is drawn.
    CBZ.countryReliefAt = function (x, z) { return reliefAt(x, z); };
    // ---- STRATA + ASPECT on the backcountry relief -----------------------
    // The plate painted its land cover from a position hash alone: two
    // kilometres of hill country and a flat field got the same treatment, so
    // even the eroded ridgelines read as a green tablecloth. This second pass
    // opens ROCK on steep ground (banded by the same warped bedding field the
    // mountains use, so an outcrop in the backcountry is visibly the same
    // geology as Mount Mercy) and shades every face by its sun aspect.
    // Colour only — no vertex is moved, so countryHeightAt, floorAt, the carve
    // pass and every audit are untouched.
    /* THE FINISHED PLATE IS BAKED TOO (core/bakecache.js, same signature as
       the loop above): the strata tint, the linear decode, the carve of the
       triangles under authored floors and the normals are pure functions of
       what the loop made and of the same inputs. A hit sets them and skips
       all four passes (~0.5 M triangle tests, ~0.2 M strata samples). */
    const FIN = PLATE_BAKE && PLATE_BAKE.fc && PLATE_BAKE.fc.length === colors.length && PLATE_BAKE.fi && PLATE_BAKE.fn ? PLATE_BAKE : null;
    let carvedTriangles = 0;
    if (FIN) {
      colors.set(FIN.fc);
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.setIndex(new THREE.BufferAttribute(FIN.fi, 1));
      carvedTriangles = FIN.carved ? FIN.carved[0] : 0;
      if (FIN.fn.length === pos.count * 3) geo.setAttribute("normal", new THREE.BufferAttribute(FIN.fn, 3));
    }
    if (!FIN && CFG.CONTINENT_RELIEF_V1 !== false && CBZ.mtnStrataTint) {
      const stride = SEG + 1;
      const dxw = W / SEG, dzw = D / SEG;
      const rockC = new THREE.Color(), baseC = new THREE.Color();
      const outcrop = new THREE.Color(0x6d6659), outcropD = new THREE.Color(0x3b3f3d);
      const lightV = new THREE.Vector3(-0.36, 0.83, 0.43).normalize();
      const nv = new THREE.Vector3();
      for (let j = 0; j <= SEG; j++) {
        for (let k = 0; k <= SEG; k++) {
          const i = j * stride + k;
          const ry = rGrid[i];
          const w = smooth01((ry - 1.5) / 4.5);
          if (w <= 0.001) continue;                     // flat country keeps its land cover
          const hx0 = rGrid[j * stride + (k > 0 ? k - 1 : k)];
          const hx1 = rGrid[j * stride + (k < SEG ? k + 1 : k)];
          const hz0 = rGrid[(j > 0 ? j - 1 : j) * stride + k];
          const hz1 = rGrid[(j < SEG ? j + 1 : j) * stride + k];
          const gx = (hx1 - hx0) / (2 * dxw), gz = (hz1 - hz0) / (2 * dzw);
          nv.set(-gx, 1, -gz).normalize();
          const slope = 1 - nv.y;
          const faceLight = Math.max(0, nv.dot(lightV));
          const wx = pos.getX(i) + cx0, wz = pos.getZ(i) + cz0;
          const bare = CBZ.mtnStrataTint(rockC, wx, wz, ry, slope, faceLight, {
            rock: outcrop, rockDark: outcropD,
            step: 6, dip: 9, slope0: 0.10, slope1: 0.32, salt: 0x22a7, aspect: 1,
          });
          baseC.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
          baseC.lerp(rockC, Math.min(0.78, bare) * w);
          const shade = 1 + (faceLight - 0.55) * 0.22 * w;
          colors[i * 3] = baseC.r * shade;
          colors[i * 3 + 1] = baseC.g * shade;
          colors[i * 3 + 2] = baseC.b * shade;
        }
      }
    }
    // THE PLATE'S VERTEX COLOUR IS LINEAR ALBEDO. Everything above authors
    // sRGB display colours (the palettes, the biome blends, the strata);
    // they used to reach the lights undecoded and the country rendered pale
    // mint from the air. Decoded here once (the sRGB curve, eased 20% toward
    // grey because the grade re-saturates), so the plate, the ground skin on
    // every tier and CBZ.groundCover (which reads these colours) all see
    // the same real reflectance.
    // ONE decoder for all ground: world/textures_surface.js's CBZ.groundLinear.
    if (!FIN && CFG.CONTINENT_LINEAR_ALBEDO !== false && CBZ.groundLinear) {
      const lc = new THREE.Color();
      for (let i = 0; i < colors.length; i += 3) {
        lc.setRGB(colors[i], colors[i + 1], colors[i + 2]);
        CBZ.groundLinear(lc, lc);
        colors[i] = lc.r; colors[i + 1] = lc.g; colors[i + 2] = lc.b;
      }
    }
    if (!FIN) geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Physically remove the underlay triangles whose centres sit below an
    // authored floor. Border triangles stay as a continuous seam and receive
    // a GPU depth bias below; the large interiors no longer overdraw at all.
    // A triangle is removed only when its *entire footprint* is safely under
    // an authored surface.  The old centroid-only test carved right up to a
    // region boundary.  On this ~17m grid a removed triangle can extend over
    // 20m beyond its centre, so circular pads (most visibly Diamond Speedway)
    // were left with a saw-toothed ring containing neither country nor ocean:
    // the sea shader correctly discarded "land" there and the clear/fog colour
    // showed through as fake blue water.  Keep one grid diagonal of underlay
    // beneath every authored edge; its lower Y + polygon offset make the real
    // pad win while guaranteeing continuous earth at the seam.
    const CARVE_SEAM_INSET = Math.min(32, Math.hypot(W / SEG, D / SEG) + 2);
    if (!FIN && geo.index) {
      const src = geo.index.array, kept = [];
      for (let i = 0; i < src.length; i += 3) {
        const ia = src[i], ib = src[i + 1], ic = src[i + 2];
        const tx = (pos.getX(ia) + pos.getX(ib) + pos.getX(ic)) / 3 + cx0;
        const tz = (pos.getZ(ia) + pos.getZ(ib) + pos.getZ(ic)) / 3 + cz0;
        if (insideAuthoredSurface(tx, tz, -CARVE_SEAM_INSET)) { carvedTriangles++; continue; }
        kept.push(ia, ib, ic);
      }
      geo.setIndex(kept);
    }
    if (!FIN && (COAST || CFG.CONTINENT_RELIEF_V1 !== false)) geo.computeVertexNormals(); // coast + country slopes want real shading
    if (!FIN && PLATE_SIG && CBZ.bakePut && geo.index) {
      // the finished plate joins the loop's record (bakePut replaces it whole)
      const Y2 = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) Y2[i] = pos.getY(i);
      const nrm = geo.attributes.normal;
      CBZ.bakePut("continent-plate", PLATE_SIG, { y: PLATE_Y || Y2, c: PLATE_C || colors, r: rGrid, s: sGrid || new Float32Array(0),
        fc: colors, fi: geo.index.array, fn: nrm ? nrm.array : new Float32Array(0), carved: new Float64Array([carvedTriangles]) });
    }
    // THE GROUND SKIN (world/textures_surface.js, shared with the disaster
    // island): the land cover above stays the macro albedo; per pixel the
    // shader lays grass / soil / sand / stone detail over it by what the
    // ground is and how steep it is. Was a bare vertex-colour Lambert: a
    // green blanket with Gouraud blotches from the road.
    const plateParams = {
      vertexColors: true,
      // Positive polygon offset pushes this UNDERLAY away in depth space. It
      // protects the few seam triangles even when 0.06 world units quantise to
      // the same aircraft-distance depth value as a runway or road.
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 8,
    };
    let plateMat = CBZ.groundSkin
      ? CBZ.groundSkin({ name: "continent-ground", extra: plateParams, far: 520,
          // the plate's relief is gentle backcountry: rock on real banks only
          rockSlope: [0.26, 0.48], sandY: [-0.35, -0.1],
          // (the vertex colours are already linear, decoded below); the
          // distant metros' streets and blocks come from city/metro.js's
          // land-use atlas
          cityMap: true })
      : new THREE.MeshLambertMaterial(plateParams);
    // Keep the dry continent's colour identity through aerial haze. Normal fog
    // made every point beyond the short city fog wall equal the sky's cyan and
    // therefore indistinguishable from flat water. This retains atmospheric
    // depth at distance while keeping grass/dirt legible from aircraft.
    // Aircraft regularly sees several kilometres of this mesh.  At the normal
    // city fog rate (and even the former 0.40 multiplier) its green/brown
    // vertex colours still converged to the horizon grey, creating the exact
    // visual illusion of a second flat water sheet.  Eight percent keeps a
    // light atmospheric veil while preserving an unmistakably dry hue.
    // (terrainFogScale also lays the AIR the scale leaves out: kilometres of
    // country recede blue-grey with their contrast cut — aerialHaze)
    if (CBZ.terrainFogScale) plateMat = CBZ.terrainFogScale(plateMat, 0.08);
    const plate = new THREE.Mesh(geo, plateMat);
    // interior sits just under the islands' y=0 slabs (no z-fight), well
    // above the sea; carved verts carry their own absolute depth.
    plate.position.set(cx0, COAST ? 0 : -0.06, cz0);
    // THE LAST WALKABLE METRE, published. Anything that must stand CLEAR of the
    // playable world (the decorative offshore skyline in world/terrain_overhaul.js)
    // has to measure against THIS rect, not against CBZ.TERRAIN_FLAT: FLAT is the
    // authored-region union and the plate is FLAT plus the country margin plus
    // whatever a late region (the Greater Mercy Range) dragged it out by. Those
    // two numbers disagreed by 2.1 km after the world re-lay, which is precisely
    // how a 1441 m backdrop range ended up standing on driveable backcountry.
    CBZ.CONTINENT_PLATE = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, seg: SEG };
    CBZ.CONTINENT_PLATE_SEG = SEG;
    /* ---- continentCoverAt: THE GRASS FIELD'S QUESTION (world/grassfield.js)
       The plate's own vertex colour decides where the backcountry is grass
       (the same green test groundSkin uses: g/r through 0.88..1.22), and the
       blades take that colour as-is (it is what the plate's shader
       multiplies), so a meadow averages to the ground it grows out of, and
       any land use painted into the vertex colours is what the grass follows.
       Surface height and colour are read off the plate's OWN triangles (the
       split reliefSample uses). Cut out: every authored surface (towns, POIs,
       metros, biomes), the road records (a mown 5 m verge either side), the
       sand rim and the water. Wild meadow everywhere else, lusher and taller
       on the moist band behind a shore. */
    (function continentCover() {
      const cAttr = geo.attributes.color, pAttr = geo.attributes.position;
      let roadIx = null;
      function roads() {
        if (roadIx) return roadIx;
        const B = 32, map = new Map();
        for (const r of city.roads || []) {
          if (!r || !isFinite(r.x) || !isFinite(r.z) || !isFinite(r.len)) continue;
          const hw = (r.w || 12) / 2 + 1.2, hl = r.len / 2;
          const R = r.vertical ? { x0: r.x - hw, x1: r.x + hw, z0: r.z - hl, z1: r.z + hl } : { x0: r.x - hl, x1: r.x + hl, z0: r.z - hw, z1: r.z + hw };
          for (let ix = Math.floor((R.x0 - 9) / B); ix <= Math.floor((R.x1 + 9) / B); ix++)
            for (let iz = Math.floor((R.z0 - 9) / B); iz <= Math.floor((R.z1 + 9) / B); iz++) {
              const k = ix * 100003 + iz; let l = map.get(k); if (!l) map.set(k, l = []); l.push(R);
            }
        }
        return (roadIx = { B: B, map: map });
      }
      function roadDist(x, z) {
        const I = roads(), l = I.map.get(Math.floor(x / I.B) * 100003 + Math.floor(z / I.B));
        if (!l) return 99;
        let d = 99;
        for (let i = 0; i < l.length; i++) {
          const R = l[i];
          const dx = Math.max(R.x0 - x, 0, x - R.x1), dz = Math.max(R.z0 - z, 0, z - R.z1);
          const e = (dx > 0 || dz > 0) ? Math.hypot(dx, dz) : -1;
          if (e < d) d = e;
        }
        return d;
      }
      // authoredSurfaceBounds, bucketed (the plain list is walked per query)
      let authIx = null;
      function authoredAt(x, z) {
        if (!authIx) {
          authIx = new Map();
          for (const b of authoredSurfaceBounds) {
            for (let ix = Math.floor((b.minX - 1) / 64); ix <= Math.floor((b.maxX + 1) / 64); ix++)
              for (let iz = Math.floor((b.minZ - 1) / 64); iz <= Math.floor((b.maxZ + 1) / 64); iz++) {
                const k = ix * 100003 + iz; let l = authIx.get(k); if (!l) authIx.set(k, l = []); l.push(b);
              }
          }
        }
        const an = city.annex;
        if (an && Number.isFinite(an.cx) && Number.isFinite(an.radius) && Math.hypot(x - an.cx, z - an.cz) <= an.radius + 2.5) return true;
        const l = authIx.get(Math.floor(x / 64) * 100003 + Math.floor(z / 64));
        if (l) for (let i = 0; i < l.length; i++) { const b = l[i]; if (x >= b.minX - 0.5 && x <= b.maxX + 0.5 && z >= b.minZ - 0.5 && z <= b.maxZ + 0.5) return true; }
        return false;
      }
      // the palette the LANDCOVER loop paints with, decoded exactly as the
      // plate is (CONTINENT_LINEAR_ALBEDO), and what each grows:
      //   g density, h height, dry straw share
      const LIN = CFG.CONTINENT_LINEAR_ALBEDO !== false && !!CBZ.groundLinear;
      function dec(col) {
        if (!LIN) return [col.r, col.g, col.b];
        const o = CBZ.groundLinear(col, new THREE.Color());
        return [o.r, o.g, o.b];
      }
      const PAL = [
        [cGrass, 1.0, 1.0, 0.2], [cLush, 1.0, 1.3, 0.0], [cScrub, 0.75, 0.85, 0.35], [cDry, 0.9, 0.9, 0.9],
        [cWood, 0.2, 0.7, 0.3], [cDirt, 0.06, 0.6, 0.6], [cSand, 0, 1, 0], [cWet, 0, 1, 0], [cBed, 0, 1, 0],
      ].filter(function (e) { return e[0] && e[0].isColor; }).map(function (e) {
        const c = dec(e[0]), l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 1e-5;
        return { cr: c[0] / l, cg: c[1] / l, cb: c[2] / l, ll: Math.log(l), g: e[1], h: e[2], dry: e[3] };
      });
      const LU = { g: 0, h: 1, dry: 0 };
      function landUse(r, g, b) {
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b + 1e-5, cr = r / l, cg = g / l, cb = b / l, ll = Math.log(l);
        let W = 0, G = 0, H = 0, Dr = 0;
        for (let i = 0; i < PAL.length; i++) {
          const p = PAL[i];
          const d2 = (cr - p.cr) * (cr - p.cr) + (cg - p.cg) * (cg - p.cg) + (cb - p.cb) * (cb - p.cb) + 0.5 * (ll - p.ll) * (ll - p.ll);
          const w = Math.exp(-d2 / 0.004);
          W += w; G += w * p.g; H += w * p.h; Dr += w * p.dry;
        }
        // a colour the palette doesn't know (a biome's blend, a strata tint):
        // green enough to be grass by its hue alone, blended in as W fades
        const gh = Math.max(0, Math.min(1, (g / Math.max(r, 1e-4) - 1.0) / 0.3));
        const k = W / (W + 1e-3);
        LU.g = W > 0 ? k * (G / W) + (1 - k) * gh : gh;
        LU.h = W > 0 ? k * (H / W) + (1 - k) : 1;
        LU.dry = W > 0 ? k * (Dr / W) + (1 - k) * 0.3 : 0.3;
        return LU;
      }
      CBZ.continentLandUse = function (r, g, b) { const o = landUse(r, g, b); return { g: o.g, h: o.h, dry: o.dry }; };
      const PMINX = cx0 - W / 2, PMINZ = cz0 - D / 2, IDX = SEG / W, IDZ = SEG / D, ST = SEG + 1;
      CBZ.continentCoverAt = function (x, z, out) {
        const fx = (x - PMINX) * IDX, fz = (z - PMINZ) * IDZ;
        if (!(fx >= 0 && fz >= 0 && fx < SEG && fz < SEG)) return false;
        if (authoredAt(x, z)) return false;                          // someone else's floor
        out.g = 0;
        // THE COAST MEMO, not the raw field: the grass asks this per blade
        // sample as the player drives into new ground, and the raw field walks
        // every river and lake (the drive's largest garbage source after three
        // itself). waterfield's memo holds this same field on a 4 m grid,
        // exact at the corners (under a metre off between them; the grass
        // bands here are 16/24/52 m wide).
        const WF = CBZ.waterField, T = CBZ.city && CBZ.city.arena && CBZ.city.arena.mapTerrain;
        const s = (WF && WF.coastAt && T && T.shoreAt === shoreField) ? WF.coastAt(x, z) : shoreField(x, z);
        if (!(s > 16)) return true;                                   // sand rim and water
        const rd = roadDist(x, z);
        if (rd < 0) return true;                                      // on a road
        const i0 = fx | 0, j0 = fz | 0, tx = fx - i0, tz = fz - j0, base = j0 * ST + i0;
        let a, b, c, wa, wb, wc;                                      // the plate's own triangle split
        if (tx + tz <= 1) { a = base; b = base + 1; c = base + ST; wa = 1 - tx - tz; wb = tx; wc = tz; }
        else { a = base + ST + 1; b = base + ST; c = base + 1; wa = tx + tz - 1; wb = 1 - tx; wc = 1 - tz; }
        const C = cAttr.array;
        const r = C[a * 3] * wa + C[b * 3] * wb + C[c * 3] * wc;
        const g = C[a * 3 + 1] * wa + C[b * 3 + 1] * wb + C[c * 3 + 1] * wc;
        const bl = C[a * 3 + 2] * wa + C[b * 3 + 2] * wb + C[c * 3 + 2] * wc;
        // WHICH land cover is this? The nearest entries of the plate's OWN
        // palette (decoded like the plate), soft-weighted in chroma+log-lum
        landUse(r, g, bl);
        const gw = LU.g;
        if (gw < 0.05) return true;                                   // dirt, sand, rock, bed
        const Y = pAttr.array;
        out.y = (Y[a * 3 + 1] * wa + Y[b * 3 + 1] * wb + Y[c * 3 + 1] * wc) + (COAST ? 0 : -0.06);
        // meadow, patchy at 7 m; a mown verge along every road
        const patch = 0.55 + 0.45 * noise2(x, z, 7.3, 0x6a11);
        const verge = rd < 5 ? 1 : rd < 9 ? 1 - (rd - 5) / 4 : 0;
        const moist = s < 52 ? 1 - (s - 16) / 36 : 0;
        out.g = gw * (verge > 0.5 ? 1 : patch) * (1 - 0.35 * Math.max(0, (24 - s) / 8));
        out.r = r; out.gr = g; out.b = bl;
        out.wild = verge > 0.5 ? 0 : 1;
        out.h = (verge > 0.5 ? 1.3 : 1) * (1 + 0.35 * moist);
        out.dry = Math.max(0, Math.min(1, LU.dry - moist * 0.3));
        out.h *= LU.h;
        out.flw = verge > 0.5 ? 0.02 : 0.015 + 0.03 * noise2(x, z, 23, 0x6a13);
        return true;
      };
      if (CBZ.groundCover) CBZ.groundCover.register("continent", CBZ.continentCoverAt, 90);
    })();
    plate.receiveShadow = true;
    plate.name = "continent-underlay";
    plate.renderOrder = -10;
    plate.userData.terrain = true;         // farcull: backdrop class, never culled
    plate.userData.underlay = true;
    plate.userData.carvedTriangles = carvedTriangles;
    plate.userData.carveSeamInset = CARVE_SEAM_INSET;
    // Kept as compact build-time evidence for the visual terrain audit. Some
    // official assets replace their loading shell asynchronously; recording
    // the exact carve inputs makes those transient bounds diagnosable later.
    plate.userData.authoredSurfaceBounds = authoredSurfaceBounds.map(function (b) {
      return { name: b.name, geometry: b.geometry, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
    });
    city.root.add(plate);

    /* ==================================================================
       CBZ.groundMatchAudit() — DOES THE GROUND YOU SEE EXIST TO PHYSICS?

       Two numbers, both ratchets, both answering one of the owner's two
       ground complaints as arithmetic instead of opinion:

         • maxErr — the largest gap in metres between the RENDERED country
           plate and the height the walk/drive oracle returns at the same
           point. "Driving on water" IS this number being large. Sampled on
           dry backcountry only (the carved coast rim is deliberately below
           the sea and the walkable floor is deliberately 0 out there —
           swim.js owns that band, and counting it would measure the ocean).
         • ungated — how many BUILT surfaces (authored floors + graded
           regions) still have country relief standing above their own slab,
           i.e. green poking through asphalt. Sampled across each footprint
           AND around its kerb ring, because the kerb is exactly where the
           straddling triangle used to climb through.
         • sunkStructures — THE ONE THAT CANNOT BE GAMED. `ungated` only
           ever measured surfaces that DECLARED themselves to the gate, so
           it read 0 for months while a 20-tier stadium stood in a hill:
           the arena had never declared, so it was never sampled. This
           number is sourced from registries NOBODY OPTS INTO — every lot
           the world built (`city.lots`), every walkable platform record
           (`CBZ.platforms`) and the annex disc — and counts the ones whose
           own top surface sits BELOW the country relief drawn under them.
           A missing declaration therefore SHOWS UP HERE. Structures whose
           ground is owned by another registered landmass oracle (a lodge on
           Mount Mercy, a garage on the speedway banking) are excluded by
           test, not by name: `cityGroundHeightAt` returning MORE than the
           country field means some other surface, not this plate, is what
           they stand on.

       Pure read; mutates nothing. Pass {step} to change the sweep.
    ================================================================== */
    CBZ.groundMatchAudit = function (opts) {
      opts = opts || {};
      const N = Number.isFinite(+opts.step) && +opts.step > 8 ? +opts.step : 120;
      const py0 = plate.position.y;
      function plateYAt(x, z) {
        const fx = (x - RMINX) * RINVDX, fz = (z - RMINZ) * RINVDZ;
        if (!(fx >= 0 && fz >= 0 && fx <= SEG && fz <= SEG)) return null;
        let i0 = fx | 0, j0 = fz | 0;
        if (i0 >= SEG) i0 = SEG - 1;
        if (j0 >= SEG) j0 = SEG - 1;
        const tx = fx - i0, tz = fz - j0, base = j0 * RSTRIDE + i0;
        const a = pos.getY(base), b = pos.getY(base + RSTRIDE), d = pos.getY(base + 1);
        const y = (tx + tz <= 1)
          ? a + (d - a) * tx + (b - a) * tz
          : pos.getY(base + RSTRIDE + 1) * (tx + tz - 1) + b * (1 - tx) + d * (1 - tz);
        return py0 + y;
      }
      let samples = 0, sum = 0, maxErr = 0, worstAt = null;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const wx = RMINX + (i + 0.5) * W / N, wz = RMINZ + (j + 0.5) * D / N;
        if (COAST && shoreField(wx, wz) < 26) continue;   // carved coast: the sea owns it
        const my = plateYAt(wx, wz);
        if (my == null) continue;
        const e = Math.abs((my - GROUND_Y) - reliefAt(wx, wz));
        samples++; sum += e;
        if (e > maxErr) { maxErr = e; worstAt = { x: Math.round(wx), z: Math.round(wz), mesh: +my.toFixed(2), physics: +reliefAt(wx, wz).toFixed(2) }; }
      }
      // --- built ground ---------------------------------------------------
      const built = [];
      for (let i = 0; i < authoredSurfaceBounds.length; i++) {
        const b = authoredSurfaceBounds[i];
        built.push({ name: b.name, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
      }
      for (let i = 0; i < regs.length; i++) {
        const r = regs[i];
        if (!r || !r.terrainGrade) continue;
        const p = r.pad || 0;
        // A circle is sampled over its INSCRIBED square: its bounding box
        // corners are ordinary country by definition, and counting them would
        // report the speedway as ungated for relief that is legitimately
        // outside it. (The kerb ring is still covered — the inscribed square's
        // edge midpoints touch the circle.)
        const q = (r.r + p) * Math.SQRT1_2;
        built.push(r.kind === "circle"
          ? { name: r.name || "(graded)", minX: r.cx - q, maxX: r.cx + q, minZ: r.cz - q, maxZ: r.cz + q }
          : { name: r.name || "(graded)", minX: r.minX - p, maxX: r.maxX + p, minZ: r.minZ - p, maxZ: r.maxZ + p });
      }
      let ungated = 0; const offenders = [];
      for (const b of built) {
        let worst = 0, at = null;
        const K = 7;
        for (let i = 0; i <= K; i++) for (let j = 0; j <= K; j++) {
          // interior grid AND the kerb ring (i or j on the edge is the kerb)
          const x = b.minX + (b.maxX - b.minX) * i / K, z = b.minZ + (b.maxZ - b.minZ) * j / K;
          const h = reliefAt(x, z);
          if (h > worst) { worst = h; at = { x: Math.round(x), z: Math.round(z) }; }
        }
        if (worst > 0.25) { ungated++; offenders.push({ name: b.name, relief: +worst.toFixed(2), at: at }); }
      }
      offenders.sort(function (a, b2) { return b2.relief - a.relief; });

      // --- sunk structures (declaration-free) -----------------------------
      const TOL = 0.25;
      let sunk = 0, structs = 0; const sunkList = [];
      // A point is only "sunk" if the COUNTRY plate is the top surface there.
      // cityGroundHeightAt is the MAX over every registered landmass oracle,
      // so `total > country` means the structure stands on somebody else's
      // ground (snow massif, speedway banking, desert mesa) and this plate is
      // correctly underneath it.
      function countryOnTop(x, z) {
        const country = reliefAt(x, z);
        if (!(country > 0)) return 0;
        const total = CBZ.cityGroundHeightAt ? (+CBZ.cityGroundHeightAt(x, z) || 0) : country;
        return total > country + 0.05 ? 0 : country;
      }
      function checkStruct(name, x, z, top) {
        if (!Number.isFinite(x) || !Number.isFinite(z)) return;
        structs++;
        const h = countryOnTop(x, z);
        if (h > (top || 0) + TOL) {
          sunk++;
          if (sunkList.length < 40) sunkList.push({ name: name, at: { x: Math.round(x), z: Math.round(z) }, ground: +h.toFixed(2), base: +(top || 0).toFixed(2) });
        }
      }
      const lotList = Array.isArray(city.lots) ? city.lots : [];
      for (let i = 0; i < lotList.length; i++) {
        const L = lotList[i];
        if (!L) continue;
        checkStruct((L.district || "lot") + ":building", L.cx, L.cz, 0);
      }
      const AN = city.annex;
      if (AN && Number.isFinite(AN.cx) && Number.isFinite(AN.radius)) {
        // the disc's centre and its four cardinal quarter points
        checkStruct("annex", AN.cx, AN.cz, 0);
        const q = AN.radius * 0.66;
        checkStruct("annex", AN.cx + q, AN.cz, 0); checkStruct("annex", AN.cx - q, AN.cz, 0);
        checkStruct("annex", AN.cx, AN.cz + q, 0); checkStruct("annex", AN.cx, AN.cz - q, 0);
      }
      const plats = Array.isArray(CBZ.platforms) ? CBZ.platforms : [];
      for (let i = 0; i < plats.length; i++) {
        const p = plats[i];
        if (!p || !Number.isFinite(p.top)) continue;
        if (![p.minX, p.maxX, p.minZ, p.maxZ].every(Number.isFinite)) continue;
        checkStruct("platform", (p.minX + p.maxX) / 2, (p.minZ + p.maxZ) / 2, p.top);
      }
      for (let i = 0; i < FLATTEN_DECLS.length; i++) {
        const r = FLATTEN_DECLS[i];
        checkStruct("declared:" + r.name, r.circle ? r.cx : (r.minX + r.maxX) / 2,
          r.circle ? r.cz : (r.minZ + r.maxZ) / 2, 0);
      }
      sunkList.sort(function (a, b2) { return (b2.ground - b2.base) - (a.ground - a.base); });

      // --- PLACES the gate still does not cover ----------------------------
      // Reported, never inferred. A venue that is a REGION rather than a lot
      // (the arena is the standing example) is only covered because it publishes
      // platforms; if some future venue publishes neither lots nor decks it
      // shows up HERE instead of quietly standing in a hill. Links and the
      // `wilds` underlay are excluded — a causeway crosses country on purpose
      // and the backcountry IS the country.
      let ungatedRegions = 0; const regionOffenders = [];
      for (let i = 0; i < regs.length; i++) {
        const r = regs[i];
        if (!r || r.underlay || !r.biome || r.biome === "wilds") continue;
        if (/causeway|bridge|link/i.test(r.name || "")) continue;
        const rx = r.kind === "circle" ? r.cx : (r.minX + r.maxX) / 2;
        const rz = r.kind === "circle" ? r.cz : (r.minZ + r.maxZ) / 2;
        const h = countryOnTop(rx, rz);
        if (h > TOL) { ungatedRegions++; regionOffenders.push({ name: r.name || r.biome, relief: +h.toFixed(2) }); }
      }
      regionOffenders.sort(function (a, b2) { return b2.relief - a.relief; });

      return {
        samples: samples,
        meanErr: +(sum / Math.max(1, samples)).toFixed(4),
        maxErr: +maxErr.toFixed(3),
        worstAt: worstAt,
        builtSurfaces: built.length,
        ungated: ungated,
        offenders: offenders.slice(0, 8),
        // the declaration-free ratchet (see the header): may only go DOWN
        structures: structs,
        sunkStructures: sunk,
        sunkWorst: sunkList.slice(0, 8),
        // HOW THE GATE WAS ACTUALLY FED, broken out by CLASS. `ungated: 0` once
        // read as "everything is fine" while buildings, roads and the stadium
        // were simply never in the list — a number lying. These make the
        // coverage of each class visible instead of inferable.
        flattenDeclared: flattenSealedAt < 0 ? 0 : flattenSealedAt,
        lateDeclarations: Math.max(0, FLATTEN_DECLS.length - Math.max(0, flattenSealedAt)),
        lotsSeen: lotsSeen,
        builtFromLots: builtFromLots,      // ungated BUILDINGS picked up (city.lots)
        builtFromRoads: builtFromRoads,    // ungated ROAD sub-spans picked up (city.roads)
        builtFromVenues: builtFromVenues,  // ungated DECKS picked up (CBZ.platforms)
        builtCells: dgCells,               // occupied 128 m grid cells — the per-vertex cost driver
        builtProbePerVertex: (2 * DG_RAD + 1) * (2 * DG_RAD + 1),
        ungatedRegions: ungatedRegions,    // PLACES with country relief still on top
        regionOffenders: regionOffenders.slice(0, 8),
        lotFootprints: lotsGated,
        matched: CFG.TERRAIN_PHYSICS_MATCH !== false,
        flattened: CFG.TERRAIN_FLATTEN_UNDER_BUILT !== false,
        fromLots: CFG.TERRAIN_BUILT_FROM_LOTS !== false,
        registered: !!reliefRec,
      };
    };

    // ---- FRONTIER EXPANSION: real travel distance, not a camera trick -------
    // Four long rural highway legs live wholly OUTSIDE the old authored union,
    // 190m inside the rounded/noisy coast, keeping the road shoulders dry at
    // straight shores and broad corners. Four navigation
    // beacons sit on the INLAND side of that loop: tall enough to provide scale
    // while approaching, physically reachable, and named on the real map.
    const WALK_IN = COAST ? 44 : -4;
    let frontier = null;
    if (CFG.CONTINENT_EXPANSION_V2 !== false && PAD > LEGACY_PAD + 80) frontier = (function buildFrontier() {
      const ROAD_W = 12, ROUTE_IN = FRONTIER_IN;
      const x0 = minX + ROUTE_IN, x1 = maxX - ROUTE_IN;
      const z0 = minZ + ROUTE_IN, z1 = maxZ - ROUTE_IN;
      if (!(x1 - x0 > 600 && z1 - z0 > 600)) return null;

      const group = new THREE.Group();
      group.name = "frontier-loop";
      group.userData.terrain = true; // one world-spanning route; never disappear as one far-cull blob
      // real asphalt reflectance (0x30343a used to reach the lights as 20%,
      // a pale concrete band), and the plate's own fog scale and air: from
      // the air the loop reads as a dark line across the country instead of
      // fogging out kilometres before the ground it lies on
      const roadMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.072, 0.074, 0.08) });
      if (CBZ.terrainFogScale) CBZ.terrainFogScale(roadMat, 0.08);
      const paintMat = new THREE.MeshBasicMaterial({ color: 0xe6c45a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      // unlit paint on a lit road: without the day tint the dashes glow like
      // LEDs all night while the asphalt under them goes dark
      if (CBZ.terrainDayTint) CBZ.terrainDayTint(paintMat);
      const roadDefs = [
        { x: (x0 + x1) / 2, z: z0, len: x1 - x0, vertical: false },
        { x: x1, z: (z0 + z1) / 2, len: z1 - z0, vertical: true },
        { x: (x0 + x1) / 2, z: z1, len: x1 - x0, vertical: false },
        { x: x0, z: (z0 + z1) / 2, len: z1 - z0, vertical: true },
      ];
      // ---- WHERE A RIVER CROSSES THE LOOP, THE LOOP BRIDGES IT. Every river
      // in this world now reaches the sea, and the loop runs all the way round
      // inside the coast, so each one passes under it. Without a deck region
      // the road plane lay on open water (cars "swam" on the frontier). A
      // /bridge/ name makes waterfield read the span as a deck and continent
      // keep the channel carved under it; river.js's channel oracle lets the
      // hulls through. Piers and parapets make it read as a bridge.
      const loopBridges = [];
      const pathBodies = waterBodies.filter(function (b) { return b && b.kind === "path"; });
      for (let i = 0; i < roadDefs.length && pathBodies.length; i++) {
        const d = roadDefs[i];
        // runs along this leg where a channel comes within 22 m of the
        // carriageway (EXACT distance: the bbox reject is only a lower bound)
        const runs = [];
        let runA = null;
        for (let t = -d.len / 2; t <= d.len / 2 + 8; t += 8) {
          const px = d.vertical ? d.x : d.x + t, pz = d.vertical ? d.z + t : d.z;
          let wetHere = false;
          if (t <= d.len / 2) for (let k = 0; k < pathBodies.length && !wetHere; k++) {
            for (const sd of [-ROAD_W / 2, 0, ROAD_W / 2]) {
              if (pathBodyField(pathBodies[k], px + (d.vertical ? sd : 0), pz + (d.vertical ? 0 : sd), true) < 22) { wetHere = true; break; }
            }
          }
          if (wetHere && runA == null) runA = t;
          else if (!wetHere && runA != null) {
            const last = runs[runs.length - 1];
            if (last && runA - last[1] < 80) last[1] = t; else runs.push([runA, t]);
            runA = null;
          }
        }
        for (const rn of runs) {
          // abutments reach 25 m further onto dry bank either side
          const a = rn[0] - 25, b = rn[1] + 25, mid = (a + b) / 2, span = b - a, deckW = ROAD_W + 6;
          const bx = d.vertical ? d.x : d.x + mid, bz = d.vertical ? d.z + mid : d.z;
          const reg = {
            name: "Frontier " + (["North", "East", "South", "West"][i] || "") + " Bridge " + (loopBridges.length + 1),
            subtitle: "River Crossing", biome: "wilds", kind: "rect", pad: 0,
            minX: d.vertical ? bx - deckW / 2 : bx - span / 2, maxX: d.vertical ? bx + deckW / 2 : bx + span / 2,
            minZ: d.vertical ? bz - span / 2 : bz - deckW / 2, maxZ: d.vertical ? bz + span / 2 : bz + deckW / 2,
          };
          if (CBZ.registerCityRegion) CBZ.registerCityRegion(city, reg);
          loopBridges.push({ x: bx, z: bz, vertical: d.vertical, span: span, w: deckW, region: reg });
        }
      }
      if (loopBridges.length) {
        const BGU = THREE.BufferGeometryUtils;
        const piers = [], rails = [];
        const boxAt = function (x, y, z, w, hh, dd) { const g = new THREE.BoxGeometry(w, hh, dd); g.translate(x, y, z); return g; };
        for (const b of loopBridges) {
          const half = b.span / 2;
          for (let t = -half + 12; t <= half - 12; t += 24) for (const sd of [-1, 1]) {
            piers.push(boxAt(b.vertical ? b.x + sd * (b.w / 2 - 1.2) : b.x + t, -1.4, b.vertical ? b.z + t : b.z + sd * (b.w / 2 - 1.2), 1.4, 3.0, 1.4));
          }
          for (const sd of [-1, 1]) {
            const rx = b.vertical ? b.x + sd * b.w / 2 : b.x, rz = b.vertical ? b.z : b.z + sd * b.w / 2;
            rails.push(boxAt(rx, 0.5, rz, b.vertical ? 0.35 : b.span, 0.85, b.vertical ? b.span : 0.35));
            if (CBZ.colliders) CBZ.colliders.push({
              minX: rx - (b.vertical ? 0.22 : half), maxX: rx + (b.vertical ? 0.22 : half),
              minZ: rz - (b.vertical ? half : 0.22), maxZ: rz + (b.vertical ? half : 0.22), y0: 0, y1: 0.95, noCam: true,
            });
          }
        }
        const addMerged = function (list, hex) {
          if (!list.length) return;
          const mat = CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex });
          if (BGU && BGU.mergeBufferGeometries) {
            const m = new THREE.Mesh(BGU.mergeBufferGeometries(list), mat);
            m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m);
          } else for (const g of list) group.add(new THREE.Mesh(g, mat));
        };
        addMerged(piers, 0x8b9097); addMerged(rails, 0xb4b9bf);
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      }
      const roadRecords = [];
      for (let i = 0; i < roadDefs.length; i++) {
        const d = roadDefs[i];
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.vertical ? ROAD_W : d.len, d.vertical ? d.len : ROAD_W), roadMat);
        mesh.rotation.x = -Math.PI / 2; mesh.position.set(d.x, 0.025, d.z);
        mesh.receiveShadow = true; mesh.name = "frontier-highway-" + i;
        group.add(mesh);
        const rec = { x: d.x, z: d.z, len: d.len, vertical: d.vertical,
          w: ROAD_W, width: ROAD_W, lanesPerDir: 1, laneW: 3.25,
          district: "highway", frontier: true, noLamps: true };
        city.roads.push(rec); roadRecords.push(rec);
      }

      // One merged centre-dash mesh for the entire ~17km circuit. Geometry
      // scales with visible paint length, but remains exactly one draw call.
      const dashPos = [];
      function quad(cx, cz, w, d, y) {
        const x0q = cx - w / 2, x1q = cx + w / 2, z0q = cz - d / 2, z1q = cz + d / 2;
        dashPos.push(x0q,y,z0q, x0q,y,z1q, x1q,y,z1q, x0q,y,z0q, x1q,y,z1q, x1q,y,z0q);
      }
      for (const d of roadDefs) {
        const n = Math.max(1, Math.floor(d.len / 22));
        for (let i = 0; i < n; i++) {
          const t = -d.len / 2 + (i + 0.5) * d.len / n;
          quad(d.x + (d.vertical ? 0 : t), d.z + (d.vertical ? t : 0),
            d.vertical ? 0.24 : 9, d.vertical ? 9 : 0.24, 0.043);
        }
      }
      if (dashPos.length) {
        const dg = new THREE.BufferGeometry();
        dg.setAttribute("position", new THREE.Float32BufferAttribute(dashPos, 3));
        const dm = new THREE.Mesh(dg, paintMat); dm.name = "frontier-highway-paint";
        dm.userData.roadPaint = true; dm.renderOrder = 1; group.add(dm);
      }
      city.root.add(group);
      city.frontierRoads = roadRecords;

      // Small open shelters + tall survey masts. They are navigation objects,
      // not sealed fake buildings, and their footprint is published for the
      // world audit's full 3x3 coast test.
      // The lookout pad is graded gravel on the SHARED ground skin (was a flat
      // 0x817b68 beige card lying on the textured plate). Vertex colour is the
      // gravel tone in the middle, grading to the surrounding scrub over the
      // outer ring, so the pad wears into the country instead of ending on a
      // ruled edge; groundSkin supplies the soil/stone detail per pixel.
      const gravelMat = CBZ.groundSkin
        ? CBZ.groundSkin({ name: "frontier-lookout-pad", far: 260, sandY: [-9, -8], srgb: true,
            extra: { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 } })
        : new THREE.MeshLambertMaterial({ vertexColors: true });
      const steelMat = new THREE.MeshLambertMaterial({ color: 0x68727d });
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x39434d });
      const beaconMat = new THREE.MeshLambertMaterial({ color: 0xff6a45, emissive: 0x7a1d10, emissiveIntensity: 0.45 });
      const mastGeo = new THREE.CylinderGeometry(0.34, 0.62, 30, 6);
      const beamGeoX = new THREE.BoxGeometry(5.6, 0.18, 0.18);
      const beamGeoZ = new THREE.BoxGeometry(0.18, 0.18, 5.6);
      const beaconGeo = new THREE.SphereGeometry(0.46, 8, 6);
      const postGeo = new THREE.BoxGeometry(0.22, 3.2, 0.22);
      const roofGeo = new THREE.BoxGeometry(9, 0.32, 5.6);
      const padGeo = (function () {
        const g = new THREE.PlaneGeometry(36, 28, 12, 10);
        const pos = g.attributes.position, colA = new Float32Array(pos.count * 3);
        const cGravel = new THREE.Color(0x7d725c), cScrubEdge = new THREE.Color(0x55653f), c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i);
          // 0 inside the 32 x 24 working pad, 1 at the frayed outer ring
          const e = Math.max(Math.abs(x) - 14, 0) / 4 + Math.max(Math.abs(y) - 10, 0) / 4;
          const n = CBZ.hash01 ? CBZ.hash01(i, 7, 0x6a1d) : 0.5;
          c.copy(cGravel).lerp(cScrubEdge, Math.min(1, e * (0.75 + 0.5 * n)));
          c.multiplyScalar(0.92 + 0.16 * n);
          colA[i * 3] = c.r; colA[i * 3 + 1] = c.g; colA[i * 3 + 2] = c.b;
        }
        g.setAttribute("color", new THREE.BufferAttribute(colA, 3));
        return g;
      })();
      const landmarks = [];
      function footprintShoreMin(x, z, hx, hz) {
        let best = Infinity;
        for (let iz = -1; iz <= 1; iz++) for (let ix = -1; ix <= 1; ix++) {
          const s = shoreField(x + ix * hx, z + iz * hz);
          if (s < best) best = s;
        }
        return best;
      }
      function landmark(name, x, z) {
        const hx = 16, hz = 12, shoreMin = footprintShoreMin(x, z, hx, hz);
        if (COAST && shoreMin < 24) return; // fail closed: never erect anything near/open in water
        const g = new THREE.Group(); g.name = "frontier-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        g.position.set(x, 0, z); g.userData.terrain = true; g.userData.frontierLandmark = true;
        const pad = new THREE.Mesh(padGeo, gravelMat); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.012; pad.receiveShadow = true; g.add(pad);
        const mast = new THREE.Mesh(mastGeo, steelMat); mast.position.set(-7, 15, 0); mast.castShadow = true; g.add(mast);
        for (const y of [10, 20, 29]) {
          const bx = new THREE.Mesh(beamGeoX, steelMat), bz = new THREE.Mesh(beamGeoZ, steelMat);
          bx.position.set(-7, y, 0); bz.position.set(-7, y, 0); g.add(bx, bz);
        }
        const beacon = new THREE.Mesh(beaconGeo, beaconMat); beacon.position.set(-7, 30.7, 0); g.add(beacon);
        const roof = new THREE.Mesh(roofGeo, roofMat); roof.position.set(7, 3.25, 0); roof.castShadow = true; g.add(roof);
        for (const px of [3.2, 10.8]) for (const pz of [-2.1, 2.1]) {
          const post = new THREE.Mesh(postGeo, steelMat); post.position.set(px, 1.6, pz); g.add(post);
        }
        city.root.add(g);
        if (CBZ.colliders) CBZ.colliders.push({ minX: x - 7.7, maxX: x - 6.3, minZ: z - 0.7, maxZ: z + 0.7, y0: 0, y1: 31, noCam: true, ref: mast });
        const rec = { name, subtitle: "Frontier Lookout", biome: "frontier", kind: "rect",
          minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz,
          x, z, shoreMin, pad: 2 };
        CBZ.registerCityRegion(city, rec); landmarks.push(rec);
      }
      const MID_IN = 26;
      landmark("North Range", cx0, z0 + MID_IN);
      landmark("East Range", x1 - MID_IN, cz0);
      landmark("South Range", cx0, z1 - MID_IN);
      landmark("West Range", x0 + MID_IN, cz0);
      city.frontierLandmarks = landmarks;

      let roadMinShore = Infinity;
      for (const d of roadDefs) for (let i = 0; i <= 64; i++) {
        const t = -d.len / 2 + d.len * i / 64;
        for (const side of [-ROAD_W / 2, 0, ROAD_W / 2]) {
          const sx = d.x + (d.vertical ? side : t), sz = d.z + (d.vertical ? t : side);
          // a bridge span is SUPPOSED to be over water (its abutments are not)
          if (loopBridges.some(function (b) { const R = b.region; return sx >= R.minX && sx <= R.maxX && sz >= R.minZ && sz <= R.maxZ; })) continue;
          roadMinShore = Math.min(roadMinShore, shoreField(sx, sz));
        }
      }
      function near(x, z, margin) {
        margin = margin || 0;
        for (const d of roadDefs) {
          const along = d.vertical ? Math.abs(z - d.z) : Math.abs(x - d.x);
          const across = d.vertical ? Math.abs(x - d.x) : Math.abs(z - d.z);
          if (along <= d.len / 2 + margin && across <= ROAD_W / 2 + margin) return true;
        }
        for (const l of landmarks) if (x >= l.minX - margin && x <= l.maxX + margin && z >= l.minZ - margin && z <= l.maxZ + margin) return true;
        return false;
      }
      return { roads: roadRecords, landmarks, near, defs: roadDefs, loopMeters: roadDefs.reduce((s, d) => s + d.len, 0), roadMinShore, bridges: loopBridges };
    })();

    const legacyW = authoredBounds.maxX - authoredBounds.minX;
    const legacyD = authoredBounds.maxZ - authoredBounds.minZ;
    const playableBounds = {
      minX: Math.min(authoredBounds.minX, minX + WALK_IN),
      maxX: Math.max(authoredBounds.maxX, maxX - WALK_IN),
      minZ: Math.min(authoredBounds.minZ, minZ + WALK_IN),
      maxZ: Math.max(authoredBounds.maxZ, maxZ - WALK_IN),
    };
    const playableW = playableBounds.maxX - playableBounds.minX;
    const playableD = playableBounds.maxZ - playableBounds.minZ;
    const legacyArea = legacyW * legacyD, playableArea = playableW * playableD;
    city.worldScale = {
      version: "continent-expansion-v2", enabled: CFG.CONTINENT_EXPANSION_V2 !== false,
      countryMargin: PAD, legacyMargin: LEGACY_PAD,
      authoredBounds: Object.assign({}, authoredBounds), terrainBounds: { minX, maxX, minZ, maxZ }, playableBounds,
      authoredWidth: legacyW, authoredDepth: legacyD, playableWidth: playableW, playableDepth: playableD,
      authoredArea: legacyArea, playableArea, addedArea: Math.max(0, playableArea - legacyArea),
      areaGainPct: legacyArea > 0 ? (playableArea / legacyArea - 1) * 100 : 0,
      frontierLoopMeters: frontier ? frontier.loopMeters : 0,
      frontierRoadMinShore: frontier ? frontier.roadMinShore : null,
      frontierLandmarkMinShore: frontier && frontier.landmarks.length ? Math.min.apply(null, frontier.landmarks.map(l => l.shoreMin)) : null,
      frontierLandmarks: frontier ? frontier.landmarks.length : 0,
      biomeBlends: biomeBlends.map(function (b) {
        return { biome: b.biome, name: b.name || b.owner, minX: b.minX, maxX: b.maxX,
          minZ: b.minZ, maxZ: b.maxZ, areaScale: b.areaScale || null,
          sources: b.sources ? b.sources.length : 0 };
      }),
      terrainVertices: pos.count,
      // build cost up to here (shore field, landform, plate, frontier), and
      // the landform distance fields' share of it
      plateMs: Math.round(((typeof performance !== "undefined" && performance.now) ? performance.now() : 0) - T_BUILD0),
      landformMs: Math.round(landformMs),
    };

    // ---- FOAM BREAKERS: marched along the true coast ----------------------
    // Scan the plate grid for zero crossings of the cached shore field and
    // drop a small white dash at each, oriented along the coast (perpendicular
    // to the field gradient). One merged mesh, one Basic material whose
    // opacity pulses in onAlways — the shoreline visibly breathes.
    let foamMat = null;
    // The overhauled ocean shader already owns shore wash/whitecaps using the
    // same signed field. A second transparent foam mesh was literally another
    // water-looking surface at a fixed height and crossed the moving waves.
    // Retain it only for the explicitly selected legacy sea.
    if (COAST && CBZ.hash01 && CFG.SEA_OVERHAUL === false) (function foam() {
      const wCells = SEG + 1;
      const quads = [];
      function vAt(ix, iz) { return iz * wCells + ix; }
      function crossing(iA, iB) {
        const sA = sGrid[iA], sB = sGrid[iB];
        if (!((sA < 0) !== (sB < 0))) return null;
        const t = sA / (sA - sB);
        return {
          x: pos.getX(iA) + (pos.getX(iB) - pos.getX(iA)) * t + cx0,
          z: pos.getZ(iA) + (pos.getZ(iB) - pos.getZ(iA)) * t + cz0,
        };
      }
      for (let iz = 0; iz < wCells - 1 && quads.length < 2600; iz++) {
        for (let ix = 0; ix < wCells - 1; ix++) {
          const i00 = vAt(ix, iz);
          const pH = crossing(i00, vAt(ix + 1, iz));
          const pV = crossing(i00, vAt(ix, iz + 1));
          for (const p of [pH, pV]) {
            if (!p) continue;
            // coast tangent = perpendicular of the shore-field gradient
            const eps = 6;
            const gx = shoreField(p.x + eps, p.z) - shoreField(p.x - eps, p.z);
            const gz = shoreField(p.x, p.z + eps) - shoreField(p.x, p.z - eps);
            const gl = Math.hypot(gx, gz) || 1;
            const tx = -gz / gl, tz = gx / gl;
            // jitter length/offset a touch so the dashes read as surf
            const j = CBZ.hash01(p.x, p.z, 8813);
            quads.push({ x: p.x, z: p.z, tx, tz, L: 2.2 + j * 2.4, Wd: 0.9 + j * 0.8 });
            if (quads.length >= 2600) break;
          }
        }
      }
      if (!quads.length) return;
      const fpos = new Float32Array(quads.length * 18);
      let fp = 0;
      const FY = -0.40;                    // just above the sea's wave crests
      for (const q of quads) {
        const hx = q.tx * q.L / 2, hz = q.tz * q.L / 2;      // along the coast
        const wx = -q.tz * q.Wd / 2, wz = q.tx * q.Wd / 2;   // across it
        const ax = q.x - hx - wx, az = q.z - hz - wz;
        const bx = q.x + hx - wx, bz = q.z + hz - wz;
        const cxq = q.x + hx + wx, czq = q.z + hz + wz;
        const dx = q.x - hx + wx, dz = q.z - hz + wz;
        fpos[fp++] = ax; fpos[fp++] = FY; fpos[fp++] = az;
        fpos[fp++] = bx; fpos[fp++] = FY; fpos[fp++] = bz;
        fpos[fp++] = cxq; fpos[fp++] = FY; fpos[fp++] = czq;
        fpos[fp++] = ax; fpos[fp++] = FY; fpos[fp++] = az;
        fpos[fp++] = cxq; fpos[fp++] = FY; fpos[fp++] = czq;
        fpos[fp++] = dx; fpos[fp++] = FY; fpos[fp++] = dz;
      }
      const fgeo = new THREE.BufferGeometry();
      fgeo.setAttribute("position", new THREE.BufferAttribute(fpos, 3));
      foamMat = new THREE.MeshBasicMaterial({
        color: 0xeef6f2, transparent: true, opacity: 0.4,
        depthWrite: false, fog: true,
      });
      const foamMesh = new THREE.Mesh(fgeo, foamMat);
      foamMesh.name = "legacy-continent-foam";
      foamMesh.renderOrder = 2;
      foamMesh.frustumCulled = false;
      foamMesh.matrixAutoUpdate = false;
      foamMesh.userData.terrain = true;
      city.root.add(foamMesh);
      const cityRoot = city.root;
      CBZ.onAlways(93.7, function () {     // runtime-only FX — Math-free pulse
        if (!cityRoot.visible || !foamMat) return;
        const tNow = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
        foamMat.opacity = 0.3 + 0.14 * Math.sin(tNow * 1.25);
      });
    })();

    // ---- dressing: trees + rocks, instanced -------------------------------
    // SUPERSEDED 2026-09-29 (owner: "too many trees", "much much thinner but
    // more intentional"): the carpet below became a PLACEMENT PLAN — see
    // "THE PLACEMENT PLAN" further down. The cell grid and the closure field
    // survive (closure still drives the krummholz band); the per-cell cluster
    // of 1-5 stems is gone.
    // THE CANOPY CARPET (world/forestlook.js). OWNER REFERENCE, coastal
    // Alaska: a wood is a continuous roof on the valley floors and lower
    // slopes — the terrain reads as bumps in the canopy, never as gaps
    // between lollipops — and it ENDS gradually, through broken clumps and
    // fingers up the gullies into scrub and then meadow. What stood here was
    // one tree per 46 m cell at a flat 34% chance: 10,083 stems over 190 km²,
    // i.e. 53 trees per square kilometre. That is not a thin forest, it is
    // parkland, and no amount of crown detail fixes a stem count that low.
    //
    // The cell grid is KEPT (it is what makes the expensive per-cell gates —
    // insideAnything over ~98 regions, the shore field, the authored-surface
    // carve — affordable at country scale); what changes is that a cell now
    // carries a CLUSTER whose size is the block's canopy closure, so density
    // varies continuously with stand mask, altitude, slope and gully instead
    // of being one constant. Everything remains hash01-driven: no sequential
    // stream exists here, so adding or removing a stem re-deals nothing.
    const FLOOK = CBZ.forestLook;
    // CARPET implies the whole scenery-scale stack (the kit's metre-authored
    // archetypes, TREES_V2's seating law and FOREST_V2's ecology), because it
    // reads VKIT.nominal for its heights and registers every stem with
    // world/treeaudit.js. Any one of those flags off = the previous world,
    // which is what makes each of them a real one-line revert.
    const CARPET = !!(FLOOK && CFG.FOREST_LOOK !== false && CFG.FOREST_CANOPY_CARPET !== false &&
      CBZ.vegetationKit && CFG.SCENERY_VEGETATION !== false &&
      CFG.CONTINENT_FOREST_V2 !== false && CFG.TREES_V2 !== false && CBZ.treeRegisterTree);
    // The relief ceiling this builder can actually produce, MEASURED (a 64x64
    // scan of its own height function), never a typed metre constant — the
    // altitude gradient is expressed as a fraction of it, so terrain work
    // that raises the country thins the wood in the same PLACES rather than
    // at the same height. Deterministic: a fixed grid over fixed bounds.
    let reliefTop = 0;
    if (CARPET) {
      for (let i = 0; i <= 64; i++) {
        for (let j = 0; j <= 64; j++) {
          const y = reliefAt(minX + (maxX - minX) * (i / 64), minZ + (maxZ - minZ) * (j / 64));
          if (Number.isFinite(y) && y > reliefTop) reliefTop = y;
        }
      }
    }
    // The ALTITUDE the ecology reads is against a real treeline, not against
    // whatever the country happens to top out at: this is lowland country
    // (uplands in the 80s), and measuring it against its own summit put a
    // "treeline" on every 45 m hill and left the uplands bare — the reverse
    // of where woods stand.
    const altRef = Math.max(reliefTop, 320);
    const CELL = 46;
    const spots = [];
    for (let gx = minX + CELL / 2; gx < maxX; gx += CELL) {
      for (let gz = minZ + CELL / 2; gz < maxZ; gz += CELL) {
        const h = CBZ.hash01 ? CBZ.hash01(Math.floor(gx), Math.floor(gz), 8803) : 1;
        const coverHit = CBZ.biomeBlendDominantAt ? CBZ.biomeBlendDominantAt(biomeBlends, gx, gz) : null;
        // Land-cover expansion changes ecology as well as colour: forest and
        // alpine transitions thicken with trees, farm verges stay sparse, and
        // the desert opens up. Density fades naturally with the same weight.
        let density = 0.34;
        if (coverHit) {
          if (coverHit.biome === "forest") density += 0.48 * coverHit.weight;
          else if (coverHit.biome === "snow") density += 0.20 * coverHit.weight;
          else if (coverHit.biome === "farmland") density -= 0.11 * coverHit.weight;
          else if (coverHit.biome === "desert") density -= 0.22 * coverHit.weight;
        }
        // `bareOk` keeps the (opt-in) field-stone scatter on its old cells.
        const bareOk = h <= Math.max(0.08, Math.min(0.84, density));
        // CARPET: every cell is judged by the placement plan below (stand
        // edge, treeline, riparian, specimen...), never by a flat accept
        // coin — a coin per cell is exactly the "random scatter" the owner
        // rejected. Legacy path keeps its coin.
        if (!CARPET && h > Math.max(0.08, Math.min(0.84, density))) continue;
        const jx = gx + ((CBZ.hash01 ? CBZ.hash01(gx, gz, 8804) : 0.5) - 0.5) * CELL * 0.8;
        const jz = gz + ((CBZ.hash01 ? CBZ.hash01(gx, gz, 8805) : 0.5) - 0.5) * CELL * 0.8;
        if (insideAnything(jx, jz, 14)) continue;            // never dress a place
        if (frontier && frontier.near(jx, jz, 12)) continue; // road shoulder/lookouts stay physically clear
        // The underlay triangles are cut away beneath every authored world
        // surface, including a few meshes whose footprint is slightly wider
        // than its gameplay region (the mainland floor is the common case).
        // Use that exact carve oracle here too: otherwise a tree can survive
        // over a removed triangle and appear to grow straight out of the sea.
        if (insideAuthoredSurface(jx, jz, 12)) continue;
        if (COAST && shoreField(jx, jz) < 16) continue;      // never dress the water/sand
        // FOREST_V2 ecological rejection (adopted from the reference forest —
        // see tools/adoption-terrain-forest.md): slope limit / treeline fade /
        // clearing mask. All hash01/noise2, so adding these gates shifts NO
        // other placement (nothing rides a sequential rng stream). Steep ground
        // is kept but flagged so the build turns it into scree, not trees.
        let steep = false, closure = 0, storey = "canopy", grad = null, slopeV = 0, curvV = 0;
        if (CFG.CONTINENT_FOREST_V2 !== false) {
          const reliefY = reliefAt(jx, jz);
          const e = 4;                                        // slope: 2-tap finite diff of the SAME height fn the prop sits on
          const sxg = reliefAt(jx + e, jz) - reliefAt(jx - e, jz);
          const szg = reliefAt(jx, jz + e) - reliefAt(jx, jz - e);
          const slope = Math.sqrt(sxg * sxg + szg * szg) / (2 * e);   // rise/run
          steep = slope > 0.85;                               // ridge faces -> rock, not tree
          slopeV = slope;
          if (CARPET) {
            // CURVATURE, at gully scale (18 m) and normalised by the relief
            // ceiling so it means the same thing in flat country and in
            // mountains: negative in a concave draw, positive on a convex
            // ridge. This is the term that sends the wood UP the gullies
            // after the open slope beside it has already given out.
            const q = 18;
            const avg4 = (reliefAt(jx + q, jz) + reliefAt(jx - q, jz) +
              reliefAt(jx, jz + q) + reliefAt(jx, jz - q)) * 0.25;
            const curv = (reliefY - avg4) / Math.max(0.5, 0.05 * reliefTop);
            curvV = curv;
            closure = FLOOK.closure(jx, jz, {
              relief: reliefY, top: altRef, slope: slope, curv: curv,
              cover: coverHit && coverHit.biome, weight: coverHit && coverHit.weight,
              site: "continent",
            });
            storey = FLOOK.storey(jx, jz, closure);
            // "none" is NOT dropped any more: open meadow is where the plan
            // decides on a lone specimen or a hilltop clump (or nothing).
            grad = { gx: sxg / (2 * e), gz: szg / (2 * e), alt: reliefY / altRef };
          } else {
            const treeline = smooth01((22 - reliefY) / 7);    // canopy thins out on the high ridges
            const clearing = noise2(jx, jz, 240, 8815);       // low-freq meadow/clearing field
            const keep = steep ? 0.55 : treeline * smooth01((clearing - 0.30) / 0.22);
            const die = CBZ.hash01 ? CBZ.hash01(jx, jz, 8816) : 0.5;
            if (die > 0.05 + keep * 0.9) continue;            // clearing / treeline reject
          }
        }
        // `bareOk` is what keeps the STONE scatter exactly where it was: the
        // stand mask may only ever add cells, and a cell that exists only
        // because a wood grows there must not also deal a field stone into
        // country that never had one (that is 7k pebbles and ~0.7M triangles
        // of pure noise, and the owner asked for FEWER geometric rocks).
        spots.push({ x: jx, z: jz, h, cover: coverHit, steep: steep, c: closure, storey: storey, grad: grad, bare: bareOk,
          slope: slopeV, curv: curvV });
      }
    }
    if (spots.length) {
      const V2 = CFG.CONTINENT_FOREST_V2 !== false;
      const VKIT = CBZ.vegetationKit;
      const SCENERY = !!(V2 && VKIT && CFG.SCENERY_VEGETATION !== false);
      // TREES_V2 (config.js): the blob-canopy tree was physically impossible
      // at the margins — the trunk sank only 0.06 into relief that allows
      // ~40° slopes (the downhill edge floated), and the blob's base pole
      // touched the trunk top at literally ONE POINT (zero embed). V2 seats
      // the trunk below the LOWEST footprint sample and sinks the blob base
      // 0.55·sc into the trunk top, then registers every tree with
      // world/treeaudit.js. Same 3 InstancedMeshes; zero new hash01/rng
      // structure (hash-driven placement is untouched).
      const TREES2 = V2 && !!(CFG.TREES_V2 !== false && CBZ.treeRegisterTree);
      if (TREES2 && CBZ.treeAuditResetSite) CBZ.treeAuditResetSite("continent");
      const dummy = new THREE.Object3D();
      const col = new THREE.Color();
      function isTreeSpot(s) {
        if (V2 && s.steep) return false;                     // steep ground -> scree, never a tree
        if (s.cover && (s.cover.biome === "forest" || s.cover.biome === "snow")) return true;
        if (s.cover && s.cover.biome === "desert") return false;
        return s.h < (s.cover && s.cover.biome === "farmland" ? 0.14 : 0.24);
      }
      // ONE TREE GRAMMAR (world/treeaudit.js §2). OWNER: "there's a type of
      // tree that's this weird geometric shit with a very thin trunk... and
      // that's the same type of tree that we have on MOST TERRAIN. That type
      // sucks... the type that has two cones looks nice, and that needs to
      // replace the other trees in the game."
      //
      // "Most terrain" IS THIS FILE. The Backcountry underlay is the biggest
      // vegetated region in the world and every tree on it was a squashed
      // icosahedron teardrop on a BOX. The blob is retired; the canopy is now
      // the shared two-whorl cone stack, authored in the blob's own unit
      // envelope (base y=0, tip y=1, max radius 1) so every placement number
      // below — and therefore CBZ.treeAudit()'s trunk/canopy overlap — is
      // untouched. The AO ramp the blob baked into its `color` attribute is
      // carried over by the factory (`ao:true`), so canopyMat keeps
      // vertexColors and the one-draw-call depth read survives the swap.
      // The BOX TRUNK is likewise replaced by the shared tapered bole, which
      // brings the roots with it: 0.34-0.86 m of timber standing out of the
      // ground with nothing holding it there was the "not connected to the
      // ground" half of the same complaint.
      // Deliberately ANDed with V2: CONTINENT_FOREST_V2=false is this file's
      // documented one-line revert to the pre-blob backcountry (a plain cone
      // on a centred box), and a half-applied grammar would leave that path
      // with a base-at-0 bole positioned as if it were still centred — i.e.
      // every trunk half-buried. One flag reverts one world.
      const GRAM = !!(V2 && CFG.TREES_ONE_GRAMMAR !== false && CBZ.treeCrownGeo);
      // Blob canopy (LEGACY, flag-off path): a low-poly squashed icosahedron
      // (20 faces, non-indexed -> flat-shaded chunky facets = voxel look)
      // tapered into a teardrop with a small baked lump, base at y=0. A
      // dark-underside -> bright-crown AO ramp is baked into the vertex
      // `color` attribute; per-instance green rides `instanceColor` (r128:
      // vColor = color(AO) *= instanceColor).
      function blobCanopyGeo() {
        if (CBZ.treeGrammarLegacy) CBZ.treeGrammarLegacy("continent");
        const g = new THREE.IcosahedronGeometry(1, 0);
        const pos = g.attributes.position, N = pos.count;
        const colors = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
          const ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i);
          const hh = (uy + 1) / 2;                            // 0 base .. 1 crown
          const taper = 1 - 0.60 * hh;
          const lump = 1 + 0.16 * Math.sin(ux * 3.1) * Math.sin(uy * 2.7 + 1.3) * Math.sin(uz * 3.5 + 2.1);
          const r = taper * lump;
          pos.setXYZ(i, ux * r, hh, uz * r);                 // base y=0, crown y~1
          const ao = 0.55 + 0.45 * hh;
          colors[i * 3] = ao; colors[i * 3 + 1] = ao; colors[i * 3 + 2] = ao;
        }
        pos.needsUpdate = true;
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        return g;
      }
      // ---- THE PLACEMENT PLAN ----------------------------------------
      // OWNER 2026-09-29: "theres too many trees lol" / "rn they are just
      // random scatter" / "it can be much much thinner but more intentional".
      // What stood here was a CLUSTER PASS: every 46 m cell with any closure
      // carried 1-5 stems dealt at random offsets, and every accepted cell
      // kept at least one — ~48.6k stems in a salt-and-pepper carpet that
      // covered open country and forest alike, with the stems' offsets never
      // re-checked against the road, the lots or the shore.
      //
      // Now every tree has a REASON to stand where it stands:
      //   STAND      coherent woods with an edge: a core, a thinning margin,
      //              a treeline that gully fingers push higher, species in
      //              groups (conifer up high and on steep ground, broadleaf in
      //              valleys and by water) — world/forestlook.js stand().
      //   RIPARIAN   a broken line of broadleaf along the river's banks.
      //   HEDGEROW   windbreak lines along field edges on farm country.
      //   AVENUE     even rows either side of the frontier highway, on some
      //              stretches, set back from the shoulder.
      //   SPECIMEN   a small clump on a hilltop, a lone tree on a rise.
      // Open land between them stays OPEN. Every stem position is gated
      // (roads, places, authored surfaces, shore, river, steep ground) and
      // spaced from its neighbours, so nothing grows out of a road, a lot or
      // the water and no two trunks stack. Everything is a position hash —
      // no sequential stream — so the world is identical on every load.
      // Knobs: CBZ.CONFIG.TREE_DENSITY.{backcountry,riparian,hedgerow,avenue,
      // specimen} and CBZ.CONFIG.TREE_CLUSTER (world/forestlook.js).
      const stemList = [], scrubList = [];
      const planStats = { stand: 0, riparian: 0, hedgerow: 0, avenue: 0, specimen: 0, clump: 0, rejected: 0 };
      if (CARPET) {
        const DEN = FLOOK.density, CK = FLOOK.cluster();
        const H01 = CBZ.hash01 || function () { return 0.5; };
        // ---- spacing: an 8 m bucket grid of planted trunks
        const TB = 8, taken = new Map();
        function roomAt(x, z, r) {
          const bx = Math.floor(x / TB), bz = Math.floor(z / TB), span = Math.ceil(r / TB);
          for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) {
            const L = taken.get((bx + i) + "|" + (bz + j));
            if (!L) continue;
            for (let k = 0; k < L.length; k += 2) {
              const dx = L[k] - x, dz = L[k + 1] - z;
              if (dx * dx + dz * dz < r * r) return false;
            }
          }
          return true;
        }
        function claimAt(x, z) {
          const key = Math.floor(x / TB) + "|" + Math.floor(z / TB);
          let L = taken.get(key); if (!L) { L = []; taken.set(key, L); }
          L.push(x, z);
        }
        // ---- the river, for riparian lines and moisture
        // EVERY river, not just the harbour's: the Kings River, its outlet to
        // the sea and the Mercy River all carry riparian woods, and every
        // lake gets a broken ring of them (owner: "trees are random scatter"
        // — along water is exactly where a tree has a reason to be).
        const RIVS = waterBodies.filter(function (b) {
          return b && b.kind === "path" && b.pts && b.pts.length > 1;
        }).map(function (b) {
          const hv = Array.isArray(b.half) ? b.half : b.pts.map(function () { return +b.half || 40; });
          // per-segment box + widest half, for the same exact pruning as
          // pathBodyField: a segment whose box is past the best distance so far
          // cannot win the minimum
          const P = b.pts, bx = new Float64Array((P.length - 1) * 5);
          for (let i = 0; i + 1 < P.length; i++) {
            const o = i * 5;
            bx[o] = Math.min(P[i].x, P[i + 1].x); bx[o + 1] = Math.max(P[i].x, P[i + 1].x);
            bx[o + 2] = Math.min(P[i].z, P[i + 1].z); bx[o + 3] = Math.max(P[i].z, P[i + 1].z);
            bx[o + 4] = Math.max(hv[i], hv[i + 1]);
          }
          return { pts: b.pts, half: hv, box: bx };
        });
        const LAKES = waterBodies.filter(function (b) { return b && b.kind === "circle" && b.r > 0; });
        function riverDist(x, z) {
          let best = Infinity;
          for (let r = 0; r < RIVS.length; r++) {
            const d = oneRiverDist(RIVS[r], x, z);
            if (d < best) best = d;
          }
          return best;
        }
        function oneRiverDist(RIV, x, z) {
          const P = RIV.pts, Hf = RIV.half, BX = RIV.box;
          let best = Infinity;
          for (let i = 0; i + 1 < P.length; i++) {
            if (best < Infinity) {
              const o = i * 5;
              const ex = BX[o] - x > 0 ? BX[o] - x : (x - BX[o + 1] > 0 ? x - BX[o + 1] : 0);
              const ez = BX[o + 2] - z > 0 ? BX[o + 2] - z : (z - BX[o + 3] > 0 ? z - BX[o + 3] : 0);
              if (ex - BX[o + 4] >= best || ez - BX[o + 4] >= best || Math.sqrt(ex * ex + ez * ez) - BX[o + 4] >= best) continue;
            }
            const ax = P[i].x, az = P[i].z, vx = P[i + 1].x - ax, vz = P[i + 1].z - az;
            const L2 = vx * vx + vz * vz;
            let t = L2 > 0 ? ((x - ax) * vx + (z - az) * vz) / L2 : 0;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t)) - (Hf[i] + (Hf[i + 1] - Hf[i]) * t);
            if (d < best) best = d;
          }
          return best;
        }
        function slopeAt(x, z) {
          const e = 4;
          const sx = reliefAt(x + e, z) - reliefAt(x - e, z), sz = reliefAt(x, z + e) - reliefAt(x, z - e);
          return { gx: sx / (2 * e), gz: sz / (2 * e), s: Math.sqrt(sx * sx + sz * sz) / (2 * e) };
        }
        // EVERY STEM is gated where it actually stands (the old pass gated
        // the cell centre and then threw stems up to 21 m off it).
        function groundOK(x, z) {
          if (x < minX + 20 || x > maxX - 20 || z < minZ + 20 || z > maxZ - 20) return false;
          if (insideAnything(x, z, 10)) return false;             // towns, lots, plazas, biomes, links
          if (frontier && frontier.near(x, z, 8)) return false;   // road + shoulder + lookouts
          if (insideAuthoredSurface(x, z, 8)) return false;       // never over a carved-away triangle
          if (COAST && shoreField(x, z) < 16) return false;       // sand, surf, river banks' water edge
          return true;
        }
        // Plant one stem if the ground and its neighbours allow it.
        function stem(x, z, role, o) {
          o = o || {};
          if (!groundOK(x, z)) { planStats.rejected++; return false; }
          if (!roomAt(x, z, o.sep || 7)) { planStats.rejected++; return false; }
          const sl = slopeAt(x, z);
          if (sl.s > 0.85) { planStats.rejected++; return false; }  // scree, not a tree
          const y = reliefAt(x, z);
          const alt = Math.max(0, y / altRef);
          let conifer = false;
          if (o.conifer != null) conifer = o.conifer;
          else conifer = FLOOK.species(x, z, { alt: alt, slope: sl.s, wet: o.wet || 0, site: "continent" }).conifer;
          claimAt(x, z);
          stemList.push({ x: x, z: z, conifer: conifer, c: o.c == null ? 0.4 : o.c, sc: o.sc || 1,
            grad: { gx: sl.gx, gz: sl.gz, alt: alt }, role: role });
          planStats[role]++;
          return true;
        }

        // ---- 1. STANDS, cell by cell --------------------------------------
        const dStand = DEN("backcountry"), dSpec = DEN("specimen");
        for (const s of spots) {
          if (s.steep) continue;
          if (s.cover && s.cover.biome === "desert" && (s.cover.weight || 0) > 0.5) continue;
          const alt = s.grad ? s.grad.alt : 0;
          const rd = RIVS.length ? riverDist(s.x, s.z) : Infinity;
          const wet = Math.max(Math.min(1, Math.max(0, -s.curv * 2)), rd < 200 ? 1 - rd / 200 : 0);
          const inside = FLOOK.stand(s.x, s.z, {
            cover: s.cover && s.cover.biome, weight: s.cover && s.cover.weight,
            alt: alt, slope: s.slope, curv: s.curv, wet: wet, area: "backcountry",
            // woods are the uplands' and the slopes' (and the wet hollows'):
            // open plain is meadow unless the stand field is strong there
            bias: -0.19 + woodBias(s.x, s.z) + 0.09 * smooth01((s.slope - 0.06) / 0.20),
          });
          if (inside > 0) {
            // core: ~2.3 stems a cell (crowns ~25 m across at ~30 m pitch =
            // a near-closed roof with real gaps); margin: 0..0.5 stem,
            // pulled toward the cell centre by TREE_CLUSTER so the edge
            // breaks into groups rather than dissolving into sprinkles.
            const nExp = dStand * (inside < 0.5 ? inside : 0.5 + (inside - 0.5) * 3.6);
            let n = Math.floor(nExp) + (H01(s.x, s.z, 8830) < nExp - Math.floor(nExp) ? 1 : 0);
            if (n > 4) n = 4;
            const spread = CELL * (inside >= 0.5 ? 0.94 : 0.94 - 0.50 * CK);
            for (let k = 0; k < n; k++) {
              const px = s.x + (H01(s.x + k * 97.3, s.z - k * 61.7, 8831) - 0.5) * spread;
              const pz = s.z + (H01(s.x - k * 71.9, s.z + k * 53.1, 8832) - 0.5) * spread;
              stem(px, pz, "stand", { wet: wet, c: Math.max(0.3, inside), sep: 8 });
            }
            continue;
          }
          // OPEN LAND. Krummholz belongs to the treeline band only — a
          // shrub scatter across a lowland meadow was more random filler.
          if (s.storey === "scrub" && alt > 0.40) { scrubList.push(s); continue; }
          if (s.cover && s.cover.biome === "farmland" && (s.cover.weight || 0) > 0.45) continue;  // fields stay fields
          // A HILLTOP CLUMP: convex ground, a few trees standing together.
          if (s.curv > 0.18 && H01(s.x, s.z, 8841) < 0.06 * dSpec) {
            const size = 2 + Math.round(CK * 3);
            const rad = 6 + (1 - CK) * 14;
            const a0 = H01(s.x, s.z, 8842) * Math.PI * 2;
            let got = 0;
            for (let k = 0; k < size; k++) {
              const a = a0 + k * 2.39996, r = k === 0 ? 0 : rad * (0.45 + 0.55 * H01(s.x + k, s.z - k, 8843));
              if (stem(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, "specimen", { sep: 6, c: 0.3 })) got++;
            }
            if (got) planStats.clump++;
            continue;
          }
          // A LONE SPECIMEN on a rise: big, broad, alone.
          if (s.curv > 0.04 && H01(s.x, s.z, 8844) < 0.018 * dSpec) {
            stem(s.x, s.z, "specimen", { sep: 30, sc: 1.15, c: 0.2, conifer: alt > 0.5 });
          }
        }

        // ---- 2. RIPARIAN: a broken line along each bank ---------------------
        const dRip = DEN("riparian");
        for (let rv = 0; rv < RIVS.length && dRip > 0; rv++) {
          const P = RIVS[rv].pts, Hf = RIVS[rv].half;
          const STEP_R = 16 / Math.max(0.25, Math.min(3, dRip));
          for (let i = 0; i + 1 < P.length; i++) {
            const ax = P[i].x, az = P[i].z, vx = P[i + 1].x - ax, vz = P[i + 1].z - az;
            const L = Math.hypot(vx, vz); if (!(L > 1)) continue;
            const tx = vx / L, tz = vz / L, nx = -tz, nz = tx;
            for (let u = 0; u < L; u += STEP_R) {
              const cx = ax + tx * u, cz = az + tz * u;
              const half = Hf[i] + (Hf[i + 1] - Hf[i]) * (u / L);
              for (const side of [-1, 1]) {
                // runs with breaks: a 300 m field decides which reaches carry trees
                if (FLOOK.noise(cx + side * 1000, cz, 300, 8850) < 0.42) continue;
                const off = half + 18 + H01(cx, cz + side, 8851) * 7;
                const jit = (H01(cx - side, cz, 8852) - 0.5) * STEP_R * 0.5;
                stem(cx + nx * off * side + tx * jit, cz + nz * off * side + tz * jit, "riparian",
                  { conifer: false, wet: 1, sep: 11, c: 0.5, sc: 0.85 + H01(cx, cz, 8853) * 0.2 });
              }
            }
          }
        }

        // ---- 2b. LAKESHORE: a broken ring of wet woodland round each lake ----
        for (let lk = 0; lk < LAKES.length && dRip > 0; lk++) {
          const Lb = LAKES[lk];
          const nA = Math.max(24, Math.round(2 * Math.PI * Lb.r / (15 / Math.max(0.25, Math.min(3, dRip)))));
          for (let a = 0; a < nA; a++) {
            const ang = a / nA * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
            // find the real (lobed) bank along this bearing
            let bank = -1;
            for (let rr = Lb.r * 0.72; rr <= Lb.r + 8; rr += 6) {
              if (inlandWaterField(Lb.cx + ca * rr, Lb.cz + sa * rr) >= 0) { bank = rr; break; }
            }
            if (bank < 0) continue;
            const bx = Lb.cx + ca * bank, bz = Lb.cz + sa * bank;
            if (FLOOK.noise(bx, bz, 220, 8855) < 0.45) continue;     // reaches with and without trees
            const off = 20 + H01(bx, bz, 8856) * 10;
            stem(bx + ca * off, bz + sa * off, "riparian",
              { conifer: false, wet: 1, sep: 11, c: 0.5, sc: 0.85 + H01(bx, bz, 8857) * 0.2 });
          }
        }

        // ---- 2c. SHELTER BELTS round the country estates ----------------------
        // A walled estate in open country is ringed by planted trees: the belt
        // is what makes a lawn a property rather than a square cut out of a
        // field (owner, of the presidential estate: "a square lawn").
        for (let eb = 0; eb < authoredSurfaceBounds.length; eb++) {
          const B = authoredSurfaceBounds[eb];
          if (!/^gov-(execmansion|governor|capitol|finca|cliffhouse|compound|freeport|agency|defence)/.test(B.name || "")) continue;
          const OFF = 18, BSTEP = 16;
          const sides = [
            [B.minX - OFF, B.minZ - OFF, B.maxX + OFF, B.minZ - OFF], [B.minX - OFF, B.maxZ + OFF, B.maxX + OFF, B.maxZ + OFF],
            [B.minX - OFF, B.minZ - OFF, B.minX - OFF, B.maxZ + OFF], [B.maxX + OFF, B.minZ - OFF, B.maxX + OFF, B.maxZ + OFF],
          ];
          for (const sd of sides) {
            const L = Math.hypot(sd[2] - sd[0], sd[3] - sd[1]), n = Math.floor(L / BSTEP);
            for (let k = 0; k <= n; k++) {
              const t = k / Math.max(1, n);
              const px = sd[0] + (sd[2] - sd[0]) * t, pz = sd[1] + (sd[3] - sd[1]) * t;
              if (H01(px, pz, 8858) < 0.10) continue;
              const j = (H01(px, pz, 8859) - 0.5) * 4;
              stem(px + (sd[0] === sd[2] ? j : 0), pz + (sd[1] === sd[3] ? j : 0), "hedgerow",
                { conifer: H01(px, pz, 8867) < 0.35, sep: 9, c: 0.4, sc: 0.9 + H01(px, pz, 8868) * 0.2 });
            }
          }
        }

        // ---- 3. HEDGEROWS: windbreaks on field edges in farm country --------
        // Fields are a 190 m grid; each field EDGE (one grid segment) is
        // planted or not as a whole, so a windbreak runs the full edge and
        // stops at the corner, the way a farmer plants it.
        const dHedge = DEN("hedgerow");
        if (dHedge > 0) {
          const FIELD = 190, HSTEP = 20;
          const ox = minX + 37, oz = minZ + 61;          // grid anchor off the plate corner
          const pickP = Math.min(1, 0.16 * dHedge);
          // axis 0: edges running north-south (constant x); axis 1: east-west.
          for (let axis = 0; axis < 2; axis++) {
            const l0 = axis === 0 ? ox : oz, l1 = axis === 0 ? maxX : maxZ;
            const a0 = axis === 0 ? oz : ox, a1 = axis === 0 ? maxZ : maxX;
            const aStart = (axis === 0 ? minZ : minX);
            for (let line = l0; line < l1; line += FIELD) {
              for (let seg = a0 - Math.ceil((a0 - aStart) / FIELD) * FIELD; seg < a1; seg += FIELD) {
                const mx = axis === 0 ? line : seg + FIELD / 2, mz = axis === 0 ? seg + FIELD / 2 : line;
                // farm country = the Coyle Valley's cover OR the field ring
                // round every town (the same field weight the ground paints)
                const cov = CBZ.biomeBlendDominantAt ? CBZ.biomeBlendDominantAt(biomeBlends, mx, mz) : null;
                const inFarm = cov && cov.biome === "farmland" && (cov.weight || 0) >= 0.45;
                if (!inFarm && fieldWeightAt(mx, mz) < 0.55) continue;
                if (H01(mx, mz, 8860 + axis) > (inFarm ? pickP : pickP * 0.25)) continue;
                for (let u = HSTEP * 0.5; u < FIELD; u += HSTEP) {
                  const jit = (H01(mx + u, mz - u, 8862) - 0.5) * 3;
                  const px = axis === 0 ? line + jit : seg + u, pz = axis === 0 ? seg + u : line + jit;
                  if (H01(px, pz, 8863) < 0.12) continue;        // the odd gap / dead stem
                  stem(px, pz, "hedgerow", { conifer: false, sep: 12, c: 0.35, sc: 0.72 + H01(px, pz, 8864) * 0.16 });
                }
              }
            }
          }
        }

        // ---- 4. AVENUES along the frontier highway ----------------------------
        // Stretches of 480 m are planted as a unit, both sides, evenly
        // spaced, same age (near-equal size), 14.5 m off the centreline —
        // 8.5 m back from the asphalt edge.
        const dAve = DEN("avenue");
        if (frontier && frontier.defs && dAve > 0) {
          const STRETCH = 480, ASTEP = 24, OFF = 14.5;
          for (const d of frontier.defs) {
            const n = Math.floor(d.len / STRETCH);
            for (let k = 0; k < n; k++) {
              const t0 = -d.len / 2 + k * STRETCH;
              const cx = d.vertical ? d.x : d.x + t0 + STRETCH / 2, cz = d.vertical ? d.z + t0 + STRETCH / 2 : d.z;
              if (H01(cx, cz, 8870) > Math.min(1, 0.28 * dAve)) continue;
              const sz = 0.92 + H01(cx, cz, 8871) * 0.10;
              for (let u = 30; u < STRETCH - 30; u += ASTEP) {
                for (const side of [-1, 1]) {
                  const along = t0 + u;
                  const px = d.vertical ? d.x + side * OFF : d.x + along;
                  const pz = d.vertical ? d.z + along : d.z + side * OFF;
                  stem(px, pz, "avenue", { conifer: false, sep: 10, c: 0.3, sc: sz });
                }
              }
            }
          }
        }
      }
      const nTree = CARPET ? stemList.length : spots.filter(isTreeSpot).length;
      const nRock = Math.max(1, CARPET
        ? spots.filter(function (s) { return s.bare && s.storey !== "scrub" && s.storey !== "none" && !isTreeSpot(s); }).length
        : spots.length - nTree);
      // Backcountry is the kit's landscape consumer: same metre-authored scale
      // and irregular mass as Redhollow, but the lighter landscape archetypes
      // avoid multiplying close-detail roots/limbs across ~10k far cells.
      const TRUNK_BASED = !!(SCENERY || (GRAM && CBZ.treeTrunkGeo));
      const trunkG = SCENERY ? VKIT.geometry("landscape-wood")
        : (TRUNK_BASED
          ? CBZ.treeTrunkGeo({ rTop: 0.19, rBase: 0.30, h: 1, seg: 5, roots: 4, spread: 2.4, flare: 1.5, site: "continent" })
          : new THREE.BoxGeometry(0.5, 2.6, 0.5));
      const canopyG = SCENERY ? VKIT.geometry("landscape-crown")
        : (GRAM
          ? CBZ.treeCrownGeo({ tiers: 2, r: 1, h: 1, seg: 6, taper: 0.71, ao: true, aoLow: 0.55, site: "continent" })
          : (V2 ? blobCanopyGeo() : new THREE.ConeGeometry(2.0, 4.4, 6)));
      // ---- BACKCOUNTRY BOULDERS: GONE (WILD_ROCK_SCATTER, default false) ---
      // OWNER: "in the wilderness there are little green and little gray rocks
      // — these little geometric things. Get rid of those... You can have
      // small rocks, but not these, like, boulders." A BoxGeometry(1.6,1.1,
      // 1.4) under a scale of 0.8-1.5 is a 1.3-2.4 m grey CUBE, one per
      // non-tree cell across the entire Backcountry — the literal object in
      // the complaint, and the most geometric thing in the wilderness.
      // It becomes a genuinely SMALL fractured stone through
      // world/rockscliffs.js — the ONE rock factory in this game, whose
      // scrape algorithm chips real planar fracture facets instead of
      // presenting six flat sides. SMALL_ROCK is the linear shrink; at 0.30
      // the boulder becomes a 0.4-0.7 m stone standing ~0.35 m proud, which
      // is UNDER physics.js's 0.45 STEP_UP — so it also stops being a thing
      // you have to steer around, and its collider goes with it (see below).
      // Placement is 100% hash01-driven here, so removing/keeping instances
      // cannot re-deal anything: there is no sequential stream to disturb.
      const BIG_ROCKS = CFG.WILD_ROCK_SCATTER === true;
      // Both sizes are opt-in. Empty country is preferable to a repeated field
      // of geometric stones, especially where this underlay crosses the desert.
      const SMALL_ROCK = BIG_ROCKS ? 1 : (CFG.WILD_SMALL_ROCKS === true ? 0.30 : 0);
      const rockG = (SMALL_ROCK && SMALL_ROCK !== 1 && CBZ.makeRock)
        ? CBZ.makeRock(0.8, 0x8CA117, 1, { scrapes: 9, depthMin: 0.06, depthMax: 0.34 })
        : new THREE.BoxGeometry(1.6, 1.1, 1.4);
      const trunkMat = SCENERY ? VKIT.material("landscape-wood")
        : new THREE.MeshLambertMaterial(V2 ? { color: 0xffffff } : { color: 0x6b4a2a });
      const canopyMat = SCENERY ? VKIT.material("landscape-crown") : new THREE.MeshLambertMaterial(V2
        ? { color: 0xffffff, vertexColors: true, flatShading: true }
        : { color: 0x3f7a3f });
      const rockMat = new THREE.MeshLambertMaterial(V2 ? { color: 0xffffff, flatShading: true } : { color: 0x8b8f96 });
      const trunks = new THREE.InstancedMesh(trunkG, trunkMat, Math.max(1, CARPET ? 1 : nTree));
      const canopies = new THREE.InstancedMesh(canopyG, canopyMat, Math.max(1, CARPET ? 1 : nTree));
      const rocks = new THREE.InstancedMesh(rockG, rockMat, nRock);
      trunks.name = "backcountry-tree-trunks";
      canopies.name = "backcountry-tree-canopies";
      rocks.name = "backcountry-rocks";
      const tCol = V2 && !CARPET ? new Float32Array(Math.max(1, nTree) * 3) : null;
      const cCol = V2 && !CARPET ? new Float32Array(Math.max(1, nTree) * 3) : null;
      const rCol = V2 ? new Float32Array(nRock * 3) : null;
      const tbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(trunkG) : null;
      const cbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(canopyG) : null;
      const spireG = CARPET && VKIT ? VKIT.geometry("conifer-spire") : null;
      const scrubG = CARPET && VKIT ? VKIT.geometry("krummholz") : null;
      const sbb = spireG && TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(spireG) : null;
      const cTrunkG = CARPET && VKIT && spireG ? VKIT.geometry("conifer-wood") : null;
      const cTrunkMat = cTrunkG ? VKIT.material("conifer-wood") : null;
      const ctbb = cTrunkG && TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(cTrunkG) : null;

      /* ---- THE DRAWN SET IS A DISC, NOT A COUNTRY ----------------------
         The whole reason a canopy this dense is affordable. One InstancedMesh
         spanning 14.5 x 13 km cannot be frustum-culled by r128 (the test is a
         bounding sphere off the GEOMETRY, so an InstancedMesh either draws
         every instance or none — which is why every scatter in this file is
         `frustumCulled = false`), and the camera's far plane is ~2.2 km. So a
         country-wide forest was paying vertex cost for ~190 km² of trees to
         render the ~15 km² anyone can see.

         The forest is therefore built as a grid of 1.2 km CHUNKS, each with
         its own meshes, and a throttled updater shows only the chunks within
         reach of the camera. Cost of the split: a handful of extra draw calls
         for the chunks actually on screen (this frame already issues
         thousands); saving: ~90% of the instances never enter a vertex
         shader. The chunk is deliberately bigger than the fade distance so a
         chunk switching on is always already behind fog.

         Determinism is untouched — chunking only decides WHICH mesh an
         instance lands in, never whether it exists.                        */
      const CHUNK = 1600;
      const chunkMap = new Map();
      function chunkAt(x, z) {
        const kx = Math.floor(x / CHUNK), kz = Math.floor(z / CHUNK);
        const key = kx + "|" + kz;
        let c = chunkMap.get(key);
        if (!c) {
          c = { cx: (kx + 0.5) * CHUNK, cz: (kz + 0.5) * CHUNK, stems: [], scrub: [], meshes: [] };
          chunkMap.set(key, c);
        }
        return c;
      }
      let nCone = 0, nBroad = 0;
      if (CARPET) {
        for (let i = 0; i < stemList.length; i++) {
          const st = stemList[i];
          chunkAt(st.x, st.z).stems.push(st);
          if (st.conifer) nCone++; else nBroad++;
        }
        for (let i = 0; i < scrubList.length; i++) chunkAt(scrubList[i].x, scrubList[i].z).scrub.push(scrubList[i]);
      }
      // ---- SOLIDITY: a tree you can DRIVE THROUGH is the worst decoy an open
      // world can ship, and until now every one of these trunks and every one
      // of these boulders was pure silhouette. They stand on ground THIS FILE
      // registers as a real walkable region ("The Backcountry", biome `wilds`),
      // so they are not scenery the way the offshore backdrop range is.
      //
      // WHAT GETS A COLLIDER, AND WHAT DELIBERATELY DOES NOT:
      //   • the TRUNK does — it is the part a body and a bumper actually meet,
      //     and it is what city/props.js's planterTree has always collided.
      //   • the CANOPY does NOT. Its blob is 3.8-7 m across; collide it and the
      //     backcountry becomes a wall instead of a wood. Foliage is brushed
      //     through, timber is not.
      //   • a ROCK does, whole — it is a 1.3-2.4 m boulder and there is nothing
      //     soft about it.
      // PERF: the placement grid is CELL = 46 m, so a tree and its neighbour can
      // never share an 8 m broadphase bucket — every one of these lands in a
      // bucket of its own and the per-frame query cost is unchanged. One AABB
      // per object, never one per part.
      const SOLID_BC = CFG.SOLID_BACKCOUNTRY !== false;
      const COLS = CBZ.colliders;
      // yawed-box world half-extent: the instance is rotated about Y by `rot`,
      // so re-typing the geometry's own half-width as an AABB would understate
      // it by up to 41%. Derive it from the SAME rot the matrix was built with.
      function yawExt(hx, hz, rot, axis) {
        const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
        return axis === 0 ? hx * c + hz * s : hx * s + hz * c;
      }
      function solidAt(x, z, hx, hz, rot, ref, y0, y1) {
        if (!SOLID_BC || !COLS) return;
        const ex = yawExt(hx, hz, rot, 0), ez = yawExt(hx, hz, rot, 1);
        const rec = { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, ref: ref || null, noCam: true };
        if (Number.isFinite(y0)) rec.y0 = y0;
        if (Number.isFinite(y1)) rec.y1 = y1;
        COLS.push(rec);
      }
      let ti = 0, ri = 0, solids = 0;

      /* ---- ONE STEM, PLANTED -------------------------------------------
         The two species share this whole body — seating, collider, audit
         chain, bark — and differ in four numbers: how narrow the bole is,
         which crown mesh it wears, how far down the bole that crown starts
         and how far above the broadleaf roof its tip lands. A spruce is not
         a different object, it is a different SHAPE of the same object, and
         writing it as a second placement loop is how a codebase ends up with
         two forests that disagree about the ground.                       */
      function plantStem(st, C) {
        const px = st.x, pz = st.z, conifer = !!st.conifer;
        const gy = reliefAt(px, pz);
        const hs = CBZ.hash01 ? CBZ.hash01(px, pz, 8808) : 0.5;
        const rot = (CBZ.hash01 ? CBZ.hash01(px, pz, 8807) : 0.3) * Math.PI * 2;
        const sc = (0.68 + hs * hs * 0.66) * (st.sc || 1);   // st.sc: avenue/hedgerow/specimen sizing
        const narrow = conifer ? 0.74 : 1;              // spruce bole reads thin
        // A COASTAL WOOD IS NOT A SAVANNA. The kit's landscape archetype is
        // a 20 m bole carrying its crown from 13 m up — emergent-rainforest
        // proportions, and from the air that reads as a field of poles with
        // green lids, which is exactly what the reference is not. The bole is
        // shortened to ~72% and the crown dropped to 6.4 m so the canopy
        // starts at a third of the tree's height, the way an alder or a
        // spruce actually carries foliage.
        const BOLE = 0.72;
        const trunkH = VKIT.nominal.matureWoodHeight * sc * BOLE;
        const trunkTop = gy + trunkH - 0.06;
        // SEATED: base below the LOWEST sample under the footprint (the
        // TREES_V2 law) — unchanged, and it is why a cluster on a slope has
        // no floating stems.
        const gu = CBZ.treeGroundUnder(reliefAt, px, pz, Math.max(0.82 * sc * narrow, 0.6));
        const seatRef = Math.min(gy, gu.min);
        const seatY = seatRef - 0.25;
        dummy.position.set(px, seatY, pz);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.set(sc * narrow, sc * BOLE, sc * narrow);
        // A conifer stands on the limbless spruce bole (see coniferWood in
        // world/vegetation.js — the broadleaf limbs were the "sticks").
        const TM = conifer && C.cTrunks ? C.cTrunks : C.trunks;
        const tIdx = conifer && C.cTrunks ? C.cti : C.ti;
        dummy.updateMatrix(); TM.setMatrixAt(tIdx, dummy.matrix);
        const trunkR = 0.76 * sc * narrow;          // both boles have a 0.76 m base
        solidAt(px, pz, trunkR, trunkR, 0, TM, seatY, trunkTop);
        solids++;
        let parts = null;
        const tb = conifer && C.cTrunks ? ctbb : tbb;
        if (tb) {
          parts = [];
          CBZ.treeAabbPush(parts, dummy.matrix, tb.min.x, tb.min.y, tb.min.z, tb.max.x, tb.max.y, tb.max.z);
        }
        const crownJ = CBZ.hash01 ? CBZ.hash01(px, pz, 8809) : 0.5;
        const alt = st.grad ? st.grad.alt : 0;
        let bb = C.cbb || cbb, idx;
        if (conifer && C.spires) {
          // The spire carries its foliage down the bole and its tip 30-45%
          // above the broadleaf roof — that overshoot IS the reference's
          // skyline, so it is derived from the same sc the roof uses rather
          // than typed as a separate height.
          const sy = sc * (0.86 + crownJ * 0.20);
          const base = gy + 2.6 * sc;
          dummy.position.set(px, base, pz);
          dummy.rotation.set(0, rot, 0);
          dummy.scale.set(sc * (0.92 + crownJ * 0.34), sy, sc * (0.92 + crownJ * 0.34));
          dummy.updateMatrix(); C.spires.setMatrixAt(C.ci, dummy.matrix);
          bb = C.sbb || sbb; idx = C.ci;
        } else {
          const cr = sc * (1.14 + crownJ * 0.28);
          const ch = sc * (0.86 + hs * 0.20);
          dummy.position.set(px, gy + 6.4 * sc, pz);
          dummy.rotation.set(0, rot, 0);
          dummy.scale.set(cr, ch, cr);
          dummy.updateMatrix(); C.canopies.setMatrixAt(C.bi, dummy.matrix);
          bb = C.cbb || cbb; idx = C.bi;
        }
        if (parts && bb) {
          CBZ.treeAabbPush(parts, dummy.matrix, bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z);
          CBZ.treeRegisterTree("continent", seatRef, parts);
        }
        // COLOUR — the block owns the whole ramp now (see world/forestlook.js).
        const topt = {
          conifer: conifer, alt: alt, closure: st.c, site: "continent",
          gx: st.grad ? st.grad.gx : null, gz: st.grad ? st.grad.gz : null,
        };
        FLOOK.tint(col, px, pz, topt);
        const dst = conifer && C.spires ? C.sCol : C.cCol;
        dst[idx * 3] = col.r; dst[idx * 3 + 1] = col.g; dst[idx * 3 + 2] = col.b;
        FLOOK.bark(col, px, pz, topt);
        const TC = conifer && C.cTrunks ? C.ctCol : C.tCol;
        TC[tIdx * 3] = col.r; TC[tIdx * 3 + 1] = col.g; TC[tIdx * 3 + 2] = col.b;
        if (conifer && C.spires) C.ci++; else C.bi++;
        if (conifer && C.cTrunks) C.cti++; else C.ti++;
      }

      // KRUMMHOLZ — the scrub band that turns a treeline into a gradient.
      // Under physics.js's 0.45 STEP_UP is not the point here (it is waist
      // high); it gets no collider because a shrub is something you push
      // through, and a wall of AABBs on an alpine slope is a snag field.
      function plantScrub(s, i, C) {
        const gy = reliefAt(s.x, s.z);
        const hs = CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8838) : 0.5;
        const rot = (CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8839) : 0.5) * Math.PI * 2;
        const ks = 0.65 + hs * 1.05;
        dummy.position.set(s.x, gy - 0.15, s.z);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.set(ks, ks * (0.7 + hs * 0.5), ks);
        dummy.updateMatrix(); C.scrubs.setMatrixAt(i, dummy.matrix);
        FLOOK.tint(col, s.x, s.z, {
          conifer: hs < 0.55, alt: s.grad ? s.grad.alt : 1, closure: 0.1, site: "continent",
          gx: s.grad ? s.grad.gx : null, gz: s.grad ? s.grad.gz : null,
        });
        C.kCol[i * 3] = col.r; C.kCol[i * 3 + 1] = col.g; C.kCol[i * 3 + 2] = col.b;
      }

      // ---- build one chunk's worth of forest ---------------------------
      const forestChunks = [];
      let forestMeshes = 0;
      if (CARPET) {
        chunkMap.forEach(function (ch) {
          const nT = ch.stems.length;
          if (!nT && !ch.scrub.length) return;
          let cone = 0;
          for (let i = 0; i < nT; i++) if (ch.stems[i].conifer) cone++;
          const broad = nT - cone;
          forestChunks.push(ch);
          // CITY SLICES: a chunk is the unit of the stream. Its stems are
          // already decided (the plan above is position-hash only); planting
          // them is what waits until the chunk can be seen.
          const plant = function () {
          ch.meshes.length = 0;
          const C = { ti: 0, bi: 0, ci: 0, cti: 0 };
          /* ---- A COUNTRY THAT IS NOT ONE TREE ---------------------------
             world/vegetation.js now grows K structurally different crowns per
             archetype. Redhollow splits its stand PER INSTANCE because you
             walk through it; out here the forest is already one mesh set per
             1.6 km CHUNK, so the variant is chosen per chunk instead — the
             silhouette changes across the country for exactly ZERO extra draw
             calls, and the visible disc (~3.5 km) always spans a dozen-odd
             chunks, so every variant is on screen at once anyway. Honest
             limitation: two neighbouring trees inside one chunk still share a
             mesh, which at these ranges is a sub-pixel fact.
             The choice is a POSITION hash on the chunk centre — no draw on
             any sequential stream, so not one stem, cabin or animal moves. */
          function chunkGeo(kind, base) {
            if (!SCENERY || !VKIT || !VKIT.variantAt) return base;
            const v = VKIT.variantAt(ch.cx, ch.cz, kind);
            // Variant 0 is noted too — the audit's question is "how many
            // variants did this site actually draw", and a site that reported
            // only its non-zero picks would read as cloned however well it
            // mixed.
            if (VKIT.noteUse) VKIT.noteUse("continent", kind, v, 1);
            if (!v) return base;
            return VKIT.geometry(kind, v) || base;
          }
          const splitBole = !!(cone && spireG && cTrunkG);
          const nBroadBole = splitBole ? broad : nT;
          if (nBroadBole) {
            C.trunks = new THREE.InstancedMesh(trunkG, trunkMat, nBroadBole);
            C.tCol = new Float32Array(nBroadBole * 3);
            C.trunks.name = "backcountry-tree-trunks";
            C.trunks.userData.forestColors = C.tCol;
            ch.meshes.push(C.trunks);
          }
          if (splitBole) {
            C.cTrunks = new THREE.InstancedMesh(cTrunkG, cTrunkMat, cone);
            C.ctCol = new Float32Array(cone * 3);
            C.cTrunks.name = "backcountry-conifer-trunks";
            C.cTrunks.userData.forestColors = C.ctCol;
            ch.meshes.push(C.cTrunks);
          }
          if (broad) {
            const g = chunkGeo("landscape-crown", canopyG);
            C.canopies = new THREE.InstancedMesh(g, canopyMat, broad);
            // every variant shares variant 0's bounding box by construction,
            // but the audit chain is proved from the geometry that actually
            // draws — never from a stand-in.
            C.cbb = g === canopyG ? cbb : (TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(g) : null);
            C.cCol = new Float32Array(broad * 3);
            C.canopies.name = "backcountry-tree-canopies";
            C.canopies.userData.forestColors = C.cCol;
            ch.meshes.push(C.canopies);
          }
          if (cone && spireG) {
            const g = chunkGeo("conifer-spire", spireG);
            C.spires = new THREE.InstancedMesh(g, canopyMat, cone);
            C.sbb = g === spireG ? sbb : (TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(g) : null);
            C.sCol = new Float32Array(cone * 3);
            C.spires.name = "backcountry-conifer-spires";
            C.spires.userData.forestColors = C.sCol;
            ch.meshes.push(C.spires);
          }
          if (ch.scrub.length && scrubG) {
            C.scrubs = new THREE.InstancedMesh(chunkGeo("krummholz", scrubG), canopyMat, ch.scrub.length);
            C.kCol = new Float32Array(ch.scrub.length * 3);
            C.scrubs.name = "backcountry-krummholz";
            C.scrubs.userData.forestColors = C.kCol;
            ch.meshes.push(C.scrubs);
          }
          for (let i = 0; i < nT; i++) plantStem(ch.stems[i], C);
          if (C.scrubs) for (let i = 0; i < ch.scrub.length; i++) plantScrub(ch.scrub[i], i, C);
          for (let i = 0; i < ch.meshes.length; i++) {
            const m = ch.meshes[i];
            // The colour buffer travels WITH its mesh. Reading it out of a
            // fixed five-slot array is how a chunk with no broadleaf hands
            // the conifer buffer to the spires and the world build dies.
            m.instanceColor = new THREE.InstancedBufferAttribute(m.userData.forestColors, 3);
            m.instanceMatrix.needsUpdate = true;
            // Never frustum-culled for the reason in the chunk note above;
            // the chunk's own distance test is what culls it.
            m.frustumCulled = false;
            m.userData.terrain = true;
            m.userData.sceneryScale = true;
            m.userData.vegetationLayer = m === C.trunks ? "landscape-wood"
              : m === C.cTrunks ? "conifer-wood"
              : (m === C.canopies ? "landscape-crown"
                : (m === C.spires ? "conifer-spire" : "krummholz"));
            city.root.add(m);
            forestMeshes++;
          }
          ti += C.ti + C.cti;
          };
          if (CBZ.slice && CBZ.sliceAt) {
            const h = CHUNK / 2 + 40;          // crowns overhang the chunk edge
            CBZ.sliceAt({ minX: ch.cx - h, maxX: ch.cx + h, minZ: ch.cz - h, maxZ: ch.cz + h }, plant,
              { name: "backcountry forest " + ch.cx + "," + ch.cz });
          } else plant();
        });
        // ---- THE DISC. One throttled distance test per chunk, not per
        // tree: 90-odd numbers a few times a second against ~45k instances
        // that would otherwise be submitted every frame from 12 km away.
        // The radius is generously past the camera's far plane so a chunk is
        // always deep in fog before it switches, and it is checked against
        // the CAMERA rather than the player so a helicopter or a long lens
        // never flies into an empty country.
        const SEE = 2350 + CHUNK * 0.71;
        const chunkList = forestChunks;
        let lastCx = 1e9, lastCz = 1e9, lastPx = 1e9, lastPz = 1e9;
        CBZ.onAlways(97.4, function () {
          const cam = CBZ.camera;
          const p = CBZ.player && CBZ.player.pos;
          if (!cam && !p) return;
          // Both eyes, and the union of their discs. A camera can be flown
          // hundreds of metres off the body (aircraft chase, cutscene rigs,
          // a screenshot tool posing a lens), and a chunk hidden because the
          // BODY is far away is a hole in the photograph.
          const cx = cam ? cam.position.x : p.x, cz = cam ? cam.position.z : p.z;
          const px = p ? p.x : cx, pz = p ? p.z : cz;
          if (Math.abs(cx - lastCx) < 90 && Math.abs(cz - lastCz) < 90 &&
              Math.abs(px - lastPx) < 90 && Math.abs(pz - lastPz) < 90) return;
          lastCx = cx; lastCz = cz; lastPx = px; lastPz = pz;
          for (let i = 0; i < chunkList.length; i++) {
            const ch = chunkList[i];
            const dx = ch.cx - cx, dz = ch.cz - cz;
            const ex = ch.cx - px, ez = ch.cz - pz;
            const on = (dx * dx + dz * dz) < SEE * SEE || (ex * ex + ez * ez) < SEE * SEE;
            for (let k = 0; k < ch.meshes.length; k++) ch.meshes[k].visible = on;
          }
        });
      }

      for (const s of spots) {
        if (CARPET && (isTreeSpot(s) || s.storey === "scrub" || s.storey === "none" || !s.bare)) continue;   // planted above
        const scale = 0.8 + (CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8806) : 0.5) * 0.7;
        const rot = (CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8807) : 0.3) * Math.PI * 2;
        if (isTreeSpot(s)) {
          const gy = reliefAt(s.x, s.z);
          if (V2) {
            const hs = CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8808) : 0.5;
            const sc = SCENERY ? 0.75 + hs * hs * 0.78 : 0.75 + hs * hs * 1.15;
            const trunkH = SCENERY ? VKIT.nominal.matureWoodHeight * sc : 2.6 * sc;
            const trunkTop = gy + trunkH - 0.06;
            let seatRef = gy - 0.06, parts = null;
            if (TREES2) {
              // SEATED: base below the lowest footprint sample on the slope
              const gu = CBZ.treeGroundUnder(reliefAt, s.x, s.z, Math.max((SCENERY ? 0.82 : 0.32) * sc, 0.6));
              seatRef = Math.min(gy, gu.min);
              const seatY = seatRef - 0.25;
              const span = trunkTop - seatY;
              // BASE-AT-0 bole vs CENTRED box — see TRUNK_BASED above. Both
              // land the top at trunkTop, which is what the canopy and the
              // audit chain are keyed to.
              dummy.position.set(s.x, TRUNK_BASED ? seatY : (seatY + trunkTop) / 2, s.z);
              dummy.rotation.set(0, rot, 0);
              if (SCENERY) dummy.scale.setScalar(sc);
              else dummy.scale.set(sc * 0.9, TRUNK_BASED ? span : span / 2.6, sc * 0.9);
            } else {
              dummy.position.set(s.x, TRUNK_BASED ? gy - 0.06 : gy + trunkH * 0.5 - 0.06, s.z);
              dummy.rotation.set(0, rot, 0);
              if (SCENERY) dummy.scale.setScalar(sc);
              else dummy.scale.set(sc * 0.9, TRUNK_BASED ? trunkH : sc, sc * 0.9);
            }
            dummy.updateMatrix(); trunks.setMatrixAt(ti, dummy.matrix);
            // Height-gated timber, not the former infinite vertical column.
            const trunkR = SCENERY ? 0.76 * sc : (TRUNK_BASED ? 0.30 * sc * 0.9 : 0.25 * sc * 0.9);
            solidAt(s.x, s.z, trunkR, trunkR, TRUNK_BASED ? 0 : rot, trunks,
              TREES2 ? seatRef - 0.25 : gy - 0.06, trunkTop);
            solids++;
            if (TREES2 && tbb) {
              parts = [];
              CBZ.treeAabbPush(parts, dummy.matrix, tbb.min.x, tbb.min.y, tbb.min.z, tbb.max.x, tbb.max.y, tbb.max.z);
            }
            const crownJ = CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8809) : 0.5;
            const cr = SCENERY ? sc * (0.88 + crownJ * 0.22) : (1.9 + hs * 1.1) * (0.85 + crownJ * 0.3);
            const ch = SCENERY ? sc * (0.90 + hs * 0.16) : 3.6 + hs * 2.0;
            // blob base: V2-legacy sat ON the trunk top (a one-point touch);
            // the law sinks it 0.55·sc INTO the trunk so the top is embedded.
            dummy.position.set(s.x, SCENERY ? gy + VKIT.nominal.matureCrownBase * sc : (TREES2 ? trunkTop - 0.55 * sc : gy + trunkH - 0.06), s.z);
            dummy.rotation.set(0, rot, 0);
            dummy.scale.set(cr, ch, cr);
            dummy.updateMatrix(); canopies.setMatrixAt(ti, dummy.matrix);
            if (parts && cbb) {
              CBZ.treeAabbPush(parts, dummy.matrix, cbb.min.x, cbb.min.y, cbb.min.z, cbb.max.x, cbb.max.y, cbb.max.z);
              CBZ.treeRegisterTree("continent", seatRef, parts);
            }
            // per-instance colour: low-freq regional green drift + hash jitter
            const drift = noise2(s.x, s.z, 520, 8817);
            const gr = CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8818) : 0.5;
            let baseG = 0.46 + drift * 0.14;
            if (s.cover && s.cover.biome === "snow") baseG -= 0.10; // darker, cooler up high
            col.setRGB(0.16 + gr * 0.10, baseG + (gr - 0.5) * 0.10, 0.13 + gr * 0.06);
            cCol[ti * 3] = col.r; cCol[ti * 3 + 1] = col.g; cCol[ti * 3 + 2] = col.b;
            const bk = 0.30 + gr * 0.16;
            col.setRGB(bk, bk * 0.62, bk * 0.38);
            tCol[ti * 3] = col.r; tCol[ti * 3 + 1] = col.g; tCol[ti * 3 + 2] = col.b;
          } else {
            dummy.position.set(s.x, gy + 1.3 * scale - 0.06, s.z); dummy.rotation.set(0, rot, 0); dummy.scale.setScalar(scale);
            dummy.updateMatrix(); trunks.setMatrixAt(ti, dummy.matrix);
            solidAt(s.x, s.z, 0.25 * scale, 0.25 * scale, rot, trunks, gy - 0.06, gy + 2.6 * scale - 0.06);
            solids++;
            dummy.position.y = (2.6 + 2.15) * scale - 0.06;
            dummy.updateMatrix(); canopies.setMatrixAt(ti, dummy.matrix);
          }
          ti++;
        } else {
          if (!SMALL_ROCK) continue;
          if (SMALL_ROCK && SMALL_ROCK !== 1) {
            // SMALL FRACTURED FIELD STONE — 0.4-0.7 m across, squashed,
            // sitting partly IN the soil, standing at most ~0.35 m proud.
            // That ceiling is not taste: physics.js's STEP_UP is 0.45, so a
            // stone under it is something you walk over. NO COLLIDER for
            // exactly that reason — an AABB on a thing you step over is a
            // snag, not a landmark. (`solids` therefore falls by one per
            // stone; CBZ.solidityAudit() reports it and the drop is the
            // boulders leaving, not the world going soft.)
            const rs = scale * SMALL_ROCK;               // geo radius 0.8 -> 0.19..0.36 m
            const halfY = 0.8 * rs * 0.62;
            dummy.position.set(s.x, reliefAt(s.x, s.z) + halfY * 0.55, s.z);
            dummy.rotation.set((CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8821) : 0.5) * 0.7 - 0.35, rot, 0);
            dummy.scale.set(rs, rs * 0.62, rs);
            dummy.updateMatrix(); rocks.setMatrixAt(ri, dummy.matrix);
          } else {
            dummy.position.set(s.x, reliefAt(s.x, s.z) + 0.45 * scale - 0.06, s.z); dummy.rotation.set(0, rot, 0); dummy.scale.setScalar(scale);
            dummy.updateMatrix(); rocks.setMatrixAt(ri, dummy.matrix);
            // the whole rock: a 1.6 x 1.4 box under `scale` (0.8-1.5), so 1.3-2.4 m
            // of boulder standing 1.2-1.65 m proud — well over physics.js's 0.45
            // STEP_UP, i.e. a thing you go around, not over.
            const rockY = reliefAt(s.x, s.z) - 0.06;
            solidAt(s.x, s.z, 0.8 * scale, 0.7 * scale, rot, rocks, rockY, rockY + 1.1 * scale);
            solids++;
          }
          if (V2) {
            const hs = CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8819) : 0.5;
            const g = 0.42 + hs * 0.22;                      // grey with a warm-brown hint
            col.setRGB(g, g * (0.94 + hs * 0.08), g * 0.9);
            rCol[ri * 3] = col.r; rCol[ri * 3 + 1] = col.g; rCol[ri * 3 + 2] = col.b;
          }
          ri++;
        }
      }
      rocks.count = ri;
      if (V2) rocks.instanceColor = new THREE.InstancedBufferAttribute(rCol, 3);
      rocks.instanceMatrix.needsUpdate = true;
      rocks.frustumCulled = false;
      rocks.userData.terrain = true;
      city.root.add(rocks);
      if (!CARPET) {
        trunks.count = canopies.count = ti;
        if (V2) {
          trunks.instanceColor = new THREE.InstancedBufferAttribute(tCol, 3);
          canopies.instanceColor = new THREE.InstancedBufferAttribute(cCol, 3);
        }
        trunks.instanceMatrix.needsUpdate = canopies.instanceMatrix.needsUpdate = true;
        trunks.frustumCulled = canopies.frustumCulled = false;
        trunks.userData.terrain = canopies.userData.terrain = true;
        trunks.userData.vegetationLayer = SCENERY ? "landscape-wood" : "backcountry-trunk";
        canopies.userData.vegetationLayer = SCENERY ? "landscape-crown" : "backcountry-crown";
        trunks.userData.sceneryScale = canopies.userData.sceneryScale = SCENERY;
        city.root.add(trunks, canopies);
      }
      // published for CBZ.solidityAudit() (city/props.js) — the ONE number that
      // says the backcountry is timber and stone rather than a painted backdrop.
      CBZ.backcountrySolids = {
        trees: ti, rocks: ri, solids: solids, on: SOLID_BC, sceneryScale: SCENERY,
        conifers: nCone, broadleaf: nBroad, scrub: scrubList.length,
        carpet: CARPET, reliefTop: reliefTop, chunks: forestChunks.length, meshes: forestMeshes,
        plan: planStats,                  // trees per reason: stand / riparian / hedgerow / avenue / specimen
      };
    }

    // ---- the walkable underlay region(s) (registered LAST on purpose:
    //      every specific place wins point-in-region queries; these only
    //      catch the country between them) --------------------------------
    // COAST shrinks the underlay 44u in from the plate rect so nobody can
    // walk onto carved water (max coast inset is 42u). HARBOR additionally
    // punches the city bay ring OUT of the underlay: 4 country bands + one
    // city-surround rect that ends exactly at the QUAY/BAY0 waterline, so
    // swim.js reads the ring as real water again.
    function reg(x0, x1, z0, z1) {
      if (!(x1 > x0 && z1 > z0)) return;
      CBZ.registerCityRegion(city, {
        name: "The Backcountry", subtitle: "Open Country", biome: "wilds", kind: "rect",
        minX: x0, maxX: x1, minZ: z0, maxZ: z1, pad: 0, underlay: true,
      });
    }
    if (HARBOR && hasCity) {
      reg(city.minX - BAY0, city.maxX + BAY0, city.minZ - BAY0, city.maxZ + BAY0); // city + quay apron
      reg(minX + WALK_IN, city.minX - BAY1, minZ + WALK_IN, maxZ - WALK_IN);                      // west country
      reg(city.maxX + BAY1, maxX - WALK_IN, minZ + WALK_IN, maxZ - WALK_IN);                      // east country
      reg(city.minX - BAY1, city.maxX + BAY1, city.maxZ + BAY1, maxZ - WALK_IN);                  // north band
      reg(city.minX - BAY1, city.maxX + BAY1, minZ + WALK_IN, city.minZ - BAY1);                  // south band
    } else {
      reg(minX + WALK_IN, maxX - WALK_IN, minZ + WALK_IN, maxZ - WALK_IN);
    }
  }, 97);   // after every island/biome/mini-city/country builder
})();
