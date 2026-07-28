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
  //  RELIEF_MACRO — one continent-wavelength (2.9km) uplift field organising
  //   the backcountry hills into broad uplands/plains, tanh-saturated under
  //   24u so it can never cross the math gate's 25u mountain threshold.
  //   The measured backcountry mean was 8.7m on an ~11km plate — relief three
  //   orders of magnitude under the horizontal scale reads as dead flat from
  //   any altitude. `?cfg_CONTINENT_RELIEF_MACRO=0` reverts to that.
  if (CFG.CONTINENT_RELIEF_MACRO == null) CFG.CONTINENT_RELIEF_MACRO = true;
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
    // overlap test skips them: "same biome = sibling, fine". A civic
    // campus butted onto its own city, or three villages of one nation
    // clustered together, is DESIGN — counting those would have pinned
    // minPairDistance at 2u (Goldspire <-> its civic campus, measured)
    // and the metric would never have moved again.
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
    const W_ROOF = SCALE_V4() ? 15500 : (LAYOUT_V2() ? 13500 : 12000);
    if (!isFinite(W) || W <= 0 || W > W_ROOF) return;

    function insideAnything(x, z, margin) {
      margin = margin || 0;
      if (isFinite(city.minX) &&
          x > city.minX - margin && x < city.maxX + margin &&
          z > city.minZ - margin && z < city.maxZ + margin) return true;
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
    function noise2(x, z, cell, salt) {
      if (!CBZ.hash01) return 0.5;
      const gx = x / cell, gz = z / cell;
      const x0 = Math.floor(gx), z0 = Math.floor(gz);
      const fx = sm(gx - x0), fz = sm(gz - z0);
      const h00 = CBZ.hash01(x0 * cell, z0 * cell, salt);
      const h10 = CBZ.hash01((x0 + 1) * cell, z0 * cell, salt);
      const h01 = CBZ.hash01(x0 * cell, (z0 + 1) * cell, salt);
      const h11 = CBZ.hash01((x0 + 1) * cell, (z0 + 1) * cell, salt);
      const a = h00 + (h10 - h00) * fx, b = h01 + (h11 - h01) * fx;
      return a + (b - a) * fz;
    }
    // Signed distance inside a rounded continental frame. The old min-to-four-
    // edges field made the whole world a perfect square in orbital views even
    // after noise was added. A broad corner radius changes the land silhouette
    // while the expanded margin keeps the full authored union untouched.
    const coastCX = (minX + maxX) * 0.5, coastCZ = (minZ + maxZ) * 0.5;
    const coastRadius = Math.min(320, Math.min(W, D) * 0.12);
    function plateInsideDistance(x, z) {
      const qx = Math.abs(x - coastCX) - (W * 0.5 - coastRadius);
      const qz = Math.abs(z - coastCZ) - (D * 0.5 - coastRadius);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
      const inside = Math.min(Math.max(qx, qz), 0);
      return -(outside + inside - coastRadius);
    }
    // Broad headlands/bays plus a smaller notch field; these amplitudes remain
    // below the relocated frontier loop's dry-land clearance.
    function coastInset(x, z) {
      return 10 + (
        noise2(x, z, 620, 8809) * 0.46 +
        noise2(x, z, 220, 8810) * 0.36 +
        noise2(x, z, 82, 8811) * 0.18
      ) * 64;
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
    function inSolidRegion(x, z, m) {    // non-bridge regions hold their land
      for (const r of regs) {
        if (isLinkReg(r)) continue;
        if (r.kind === "circle") {
          if (Math.hypot(x - r.cx, z - r.cz) < r.r + (r.pad || 0) + m) return true;
        } else if (x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m) return true;
      }
      return false;
    }
    function waterBodyField(b, x, z) {
      if (!b) return Infinity;
      if (b.kind === "circle") return Math.hypot(x - b.cx, z - b.cz) - b.r;
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      if (dx > 0 || dz > 0) return Math.hypot(dx, dz);
      return -Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
    }
    function inlandWaterField(x, z) {
      let nearest = Infinity;
      for (let i = 0; i < waterBodies.length; i++) nearest = Math.min(nearest, waterBodyField(waterBodies[i], x, z));
      return nearest;
    }
    function shoreField(x, z) {
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
      const inland = inlandWaterField(x, z);
      if (inland < s) s = inland;
      return s;
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
    const FUTURE_ROUTE_IN = COAST ? 190 : 36;
    const futureX0 = minX + FUTURE_ROUTE_IN, futureX1 = maxX - FUTURE_ROUTE_IN;
    const futureZ0 = minZ + FUTURE_ROUTE_IN, futureZ1 = maxZ - FUTURE_ROUTE_IN;
    function frontierDistance(x, z) {
      if (CFG.CONTINENT_EXPANSION_V2 === false || PAD <= LEGACY_PAD + 80) return 1e9;
      let best = 1e9;
      if (x >= futureX0 - 28 && x <= futureX1 + 28) best = Math.min(best, Math.abs(z - futureZ0), Math.abs(z - futureZ1));
      if (z >= futureZ0 - 28 && z <= futureZ1 + 28) best = Math.min(best, Math.abs(x - futureX0), Math.abs(x - futureX1));
      return best;
    }
    // ---- THE RIM LAW (WORLD_LAYOUT_V2) ----------------------------------
    // Owner: "the mountains … should be on the EDGES of the map"; the relief
    // must read as a RIM, not as lumps scattered through the middle. The old
    // field was flat in `rimT` — the same 0-22u hill country stood 200m from
    // downtown and 5km out at the frontier, which is exactly the "cities and
    // mountains are much too close together" complaint at ground level.
    //
    // rimT is a BOX metric (Chebyshev in normalised half-extents) over the
    // plate rect: 0 dead centre, 1 at the plate edge. Using the box metric
    // rather than a radius is deliberate — the plate is a rectangle, and a
    // radial gate would put a circular bald spot in a rectangular map.
    //
    // The gate NEVER lifts a sample above RIM_CEIL, and RIM_CEIL is set
    // strictly UNDER the 25u mountain threshold both the math gate and
    // tools/terrain-map-audit.mjs test. That is a proof, not a hope: the
    // backcountry is `wilds` biome, so a single 25u sample out here would be
    // a mountains-outside-snow violation. This clamp makes it impossible —
    // the doctrine gets MORE true, never less.
    const RIM_IN = 0.42;      // inside this: quiet open country you drive across
    const RIM_OUT = 0.88;     // by here: the full rim swell
    const RIM_LO = 0.20;      // interior keeps a fifth of the swell (not a tabletop)
    const RIM_HI = 1.85;      // the rim gets nearly 2x — then meets the ceiling
    const RIM_CEIL = 23;      // hard ceiling, strictly under the 25u doctrine line
    const rimCX = (minX + maxX) * 0.5, rimCZ = (minZ + maxZ) * 0.5;
    const rimHX = Math.max(1, (maxX - minX) * 0.5), rimHZ = Math.max(1, (maxZ - minZ) * 0.5);
    function rimT(x, z) {
      const tx = Math.abs(x - rimCX) / rimHX, tz = Math.abs(z - rimCZ) / rimHZ;
      return tx > tz ? tx : tz;
    }
    function rimGain(x, z) {
      const g = smooth01((rimT(x, z) - RIM_IN) / (RIM_OUT - RIM_IN));
      return RIM_LO + (RIM_HI - RIM_LO) * g;
    }
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
    const PLATE_CELL = 38;
    const PLATE_SEG = COAST
      ? Math.max(320, Math.min(448, Math.ceil(Math.max(W, D) / PLATE_CELL / 8) * 8))
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
      for (let i = 0; i < authoredSurfaceBounds.length; i++) {
        const b = authoredSurfaceBounds[i];
        // Chebyshev pre-reject first (four compares, no arithmetic) — the same
        // shape highwayNetReliefGate uses, and the reason this gate is
        // affordable inside a 103k-vertex build loop.
        if (x < b.minX - BUILT_REACH || x > b.maxX + BUILT_REACH ||
            z < b.minZ - BUILT_REACH || z > b.maxZ + BUILT_REACH) continue;
        const t = builtBandGate(outsideRectDist(x, z, b.minX, b.maxX, b.minZ, b.maxZ));
        if (t <= 0) return 0;
        if (t < g) g = t;
      }
      for (let i = 0; i < gradedN; i++) {
        const r = gradedRegs[i];
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

    function countryHeightAt(x, z) {
      if (CFG.CONTINENT_RELIEF_V1 === false) return 0;
      if (x < minX || x > maxX || z < minZ || z > maxZ) return 0;
      const built = builtGate(x, z);
      if (built <= 0) return 0;
      const shore = COAST ? shoreField(x, z) : 100;
      if (shore <= 38) return 0;
      const coastFade = smooth01((shore - 38) / 74);
      const n = (CFG.CONTINENT_RELIEF_EROSION === false)
        ? countryFbm(x + 1400, z - 900)
        : countryErodedHills(x + 1400, z - 900);
      const broad = noise2(x, z, 540, 8896);
      const ridge = 1 - Math.abs(2 * noise2(x + 700, z - 300, 250, 8897) - 1);
      let h = (2.0 + Math.max(0, n + 0.18) * 17 + Math.pow(ridge, 2.4) * broad * 8) * coastFade;
      // ---- CONTINENT_RELIEF_MACRO: the missing octave -----------------------
      // Nothing above had a wavelength over 540m on a ~11km plate, so from any
      // altitude the backcountry read as a corduroy of same-sized 8m bumps —
      // texture, not geography (a terrain with no octave near the map's own
      // scale cannot have macro structure, by construction). One continent-
      // wavelength uplift field now organises the same hills into broad
      // uplands and plains. Deterministic (hash01 salt 8905), per-point, and
      // zero wherever h is already 0, so every existing flat gate (coasts,
      // pads, highways below) is untouched.
      //
      // ORDER MATTERS, and this is the merge of two laws that both scale h.
      // The MACRO runs first: it decides the SHAPE of the backcountry — where
      // the uplands and the plains are. WORLD_LAYOUT_V2's rim gain runs second,
      // because it decides WHERE THAT SHAPE IS ALLOWED TO BE TALL (interior
      // 0.20x, rim 1.85x). Reversing them would let the macro's tanh re-inflate
      // the interior the rim law had just flattened, which is exactly the
      // "hills as tall 200m from downtown as 5km out" the owner complained of.
      //
      // Both laws independently keep the result under the math gate's 25u
      // mountain threshold — the macro soft-saturates at 24u, the rim law hard-
      // ceilings at RIM_CEIL (23u). Applying the STRICTER of the two last means
      // "mountains outside snow" stays impossible here by construction, not by
      // luck, whichever flag is on.
      if (CFG.CONTINENT_RELIEF_MACRO !== false && h > 0) {
        const upl = noise2(x + 940, z - 2600, 2900, 8905);
        h = 24 * Math.tanh((h * (1.25 + 2.15 * upl * upl)) / 24);
      }
      if (LAYOUT_V2()) {
        h *= rimGain(x, z);
        if (h > RIM_CEIL) h = RIM_CEIL;
      }
      // Frontier highways are cut into the landscape with broad shoulders;
      // their visible planes never hover over a noisy heightfield.
      const fd = frontierDistance(x, z);
      h *= smooth01((fd - 10) / 36);
      // Same cut for the highway NETWORK (city/highwaynet.js): relief flattens
      // under every route corridor so the flat decks never hover over hills.
      // The gate is 1 everywhere when the network is off/absent — identical
      // relief to before.
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
    const cGrass = new THREE.Color(0x4f7445), cDry = new THREE.Color(0x7f7a4a);
    const cDirt = new THREE.Color(0x795d42), cScrub = new THREE.Color(0x45684e);
    const cLush = new THREE.Color(0x37684a);                 // moist shore band
    const cSand = new THREE.Color(0xdcc794), cWet = new THREE.Color(0xbfa877);
    const cBed = new THREE.Color(0x8a8a6b);                  // submerged seabed
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
    for (let i = 0; i < pos.count; i++) {
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
      applyBiomeLandCover(c, wx, wz);
      const reliefY = countryHeightAt(wx, wz);
      rGrid[i] = reliefY;
      let y = GROUND_Y + reliefY;
      if (COAST) {
        const s = shoreField(wx, wz);
        sGrid[i] = s;
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
          if (s < 6) c.copy(cWet).lerp(cSand, sm(s / 6));
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
    if (CFG.CONTINENT_RELIEF_V1 !== false && CBZ.mtnStrataTint) {
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
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Physically remove the underlay triangles whose centres sit below an
    // authored floor. Border triangles stay as a continuous seam and receive
    // a GPU depth bias below; the large interiors no longer overdraw at all.
    let carvedTriangles = 0;
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
    if (geo.index) {
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
    if (COAST || CFG.CONTINENT_RELIEF_V1 !== false) geo.computeVertexNormals(); // coast + country slopes want real shading
    let plateMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      // Positive polygon offset pushes this UNDERLAY away in depth space. It
      // protects the few seam triangles even when 0.06 world units quantise to
      // the same aircraft-distance depth value as a runway or road.
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 8,
    });
    // Keep the dry continent's colour identity through aerial haze. Normal fog
    // made every point beyond the short city fog wall equal the sky's cyan and
    // therefore indistinguishable from flat water. This retains atmospheric
    // depth at distance while keeping grass/dirt legible from aircraft.
    // Aircraft regularly sees several kilometres of this mesh.  At the normal
    // city fog rate (and even the former 0.40 multiplier) its green/brown
    // vertex colours still converged to the horizon grey, creating the exact
    // visual illusion of a second flat water sheet.  Eight percent keeps a
    // light atmospheric veil while preserving an unmistakably dry hue.
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
      const ROAD_W = 12, ROUTE_IN = COAST ? 190 : 36;
      const x0 = minX + ROUTE_IN, x1 = maxX - ROUTE_IN;
      const z0 = minZ + ROUTE_IN, z1 = maxZ - ROUTE_IN;
      if (!(x1 - x0 > 600 && z1 - z0 > 600)) return null;

      const group = new THREE.Group();
      group.name = "frontier-loop";
      group.userData.terrain = true; // one world-spanning route; never disappear as one far-cull blob
      const roadMat = new THREE.MeshLambertMaterial({ color: 0x30343a });
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
      const gravelMat = new THREE.MeshLambertMaterial({ color: 0x817b68 });
      const steelMat = new THREE.MeshLambertMaterial({ color: 0x68727d });
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x39434d });
      const beaconMat = new THREE.MeshLambertMaterial({ color: 0xff6a45, emissive: 0x7a1d10, emissiveIntensity: 0.45 });
      const mastGeo = new THREE.CylinderGeometry(0.34, 0.62, 30, 6);
      const beamGeoX = new THREE.BoxGeometry(5.6, 0.18, 0.18);
      const beamGeoZ = new THREE.BoxGeometry(0.18, 0.18, 5.6);
      const beaconGeo = new THREE.SphereGeometry(0.46, 8, 6);
      const postGeo = new THREE.BoxGeometry(0.22, 3.2, 0.22);
      const roofGeo = new THREE.BoxGeometry(9, 0.32, 5.6);
      const padGeo = new THREE.PlaneGeometry(32, 24);
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
      return { roads: roadRecords, landmarks, near, loopMeters: roadDefs.reduce((s, d) => s + d.len, 0), roadMinShore };
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

    // ---- dressing: sparse trees + rocks, instanced (3 draw calls) ---------
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
        if (h > Math.max(0.08, Math.min(0.84, density))) continue;
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
        let steep = false;
        if (CFG.CONTINENT_FOREST_V2 !== false) {
          const reliefY = reliefAt(jx, jz);
          const e = 4;                                        // slope: 2-tap finite diff of the SAME height fn the prop sits on
          const sxg = reliefAt(jx + e, jz) - reliefAt(jx - e, jz);
          const szg = reliefAt(jx, jz + e) - reliefAt(jx, jz - e);
          const slope = Math.sqrt(sxg * sxg + szg * szg) / (2 * e);   // rise/run
          steep = slope > 0.85;                               // ridge faces -> rock, not tree
          const treeline = smooth01((22 - reliefY) / 7);      // canopy thins out on the high ridges
          const clearing = noise2(jx, jz, 240, 8815);         // low-freq meadow/clearing field
          const keep = steep ? 0.55 : treeline * smooth01((clearing - 0.30) / 0.22);
          const die = CBZ.hash01 ? CBZ.hash01(jx, jz, 8816) : 0.5;
          if (die > 0.05 + keep * 0.9) continue;              // clearing / treeline reject
        }
        spots.push({ x: jx, z: jz, h, cover: coverHit, steep: steep });
      }
    }
    if (spots.length) {
      const V2 = CFG.CONTINENT_FOREST_V2 !== false;
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
      const nTree = spots.filter(isTreeSpot).length;
      const nRock = Math.max(1, spots.length - nTree);
      // THE TRUNK CHANGES ITS ORIGIN, AND THAT IS THE WHOLE MIGRATION COST.
      // The box was CENTRED (spans y[-1.3,1.3] at height 2.6), so the loop
      // below positions it at the midpoint and scales by span/2.6. The shared
      // bole is BASE-AT-0 over unit height, so it is positioned at the seat
      // and scaled by the span itself. Both branches are kept side by side
      // rather than "fixed up", because a half-migrated trunk origin is
      // exactly how a forest ends up half a tree underground.
      const TRUNK_BASED = !!(GRAM && CBZ.treeTrunkGeo);
      const trunkG = TRUNK_BASED
        ? CBZ.treeTrunkGeo({ rTop: 0.19, rBase: 0.30, h: 1, seg: 5, roots: 4, spread: 2.4, flare: 1.5, site: "continent" })
        : new THREE.BoxGeometry(0.5, 2.6, 0.5);
      const canopyG = GRAM
        ? CBZ.treeCrownGeo({ tiers: 2, r: 1, h: 1, seg: 6, taper: 0.71, ao: true, aoLow: 0.55, site: "continent" })
        : (V2 ? blobCanopyGeo() : new THREE.ConeGeometry(2.0, 4.4, 6));
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
      const SMALL_ROCK = BIG_ROCKS ? 1 : ((CFG.WILD_SMALL_ROCKS !== false && CBZ.makeRock) ? 0.30 : 0);
      const rockG = (SMALL_ROCK && SMALL_ROCK !== 1)
        ? CBZ.makeRock(0.8, 0x8CA117, 1, { scrapes: 9, depthMin: 0.06, depthMax: 0.34 })
        : new THREE.BoxGeometry(1.6, 1.1, 1.4);
      const trunkMat = new THREE.MeshLambertMaterial(V2 ? { color: 0xffffff } : { color: 0x6b4a2a });
      const canopyMat = new THREE.MeshLambertMaterial(V2
        ? { color: 0xffffff, vertexColors: true, flatShading: true }
        : { color: 0x3f7a3f });
      const rockMat = new THREE.MeshLambertMaterial(V2 ? { color: 0xffffff, flatShading: true } : { color: 0x8b8f96 });
      const trunks = new THREE.InstancedMesh(trunkG, trunkMat, Math.max(1, nTree));
      const canopies = new THREE.InstancedMesh(canopyG, canopyMat, Math.max(1, nTree));
      const rocks = new THREE.InstancedMesh(rockG, rockMat, nRock);
      trunks.name = "backcountry-tree-trunks";
      canopies.name = "backcountry-tree-canopies";
      rocks.name = "backcountry-rocks";
      const tCol = V2 ? new Float32Array(Math.max(1, nTree) * 3) : null;
      const cCol = V2 ? new Float32Array(Math.max(1, nTree) * 3) : null;
      const rCol = V2 ? new Float32Array(nRock * 3) : null;
      const tbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(trunkG) : null;
      const cbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(canopyG) : null;
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
      function solidAt(x, z, hx, hz, rot, ref) {
        if (!SOLID_BC || !COLS) return;
        const ex = yawExt(hx, hz, rot, 0), ez = yawExt(hx, hz, rot, 1);
        COLS.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, ref: ref || null, noCam: true });
      }
      let ti = 0, ri = 0, solids = 0;
      for (const s of spots) {
        const scale = 0.8 + (CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8806) : 0.5) * 0.7;
        const rot = (CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8807) : 0.3) * Math.PI * 2;
        if (isTreeSpot(s)) {
          const gy = reliefAt(s.x, s.z);
          if (V2) {
            const hs = CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8808) : 0.5;
            const sc = 0.75 + hs * hs * 1.15;                // squared-bias scale (biases small)
            const trunkH = 2.6 * sc;
            const trunkTop = gy + trunkH - 0.06;
            let seatRef = gy - 0.06, parts = null;
            if (TREES2) {
              // SEATED: base below the lowest footprint sample on the slope
              const gu = CBZ.treeGroundUnder(reliefAt, s.x, s.z, Math.max(0.32 * sc, 0.6));
              seatRef = Math.min(gy, gu.min);
              const seatY = seatRef - 0.25;
              const span = trunkTop - seatY;
              // BASE-AT-0 bole vs CENTRED box — see TRUNK_BASED above. Both
              // land the top at trunkTop, which is what the canopy and the
              // audit chain are keyed to.
              dummy.position.set(s.x, TRUNK_BASED ? seatY : (seatY + trunkTop) / 2, s.z);
              dummy.rotation.set(0, rot, 0);
              dummy.scale.set(sc * 0.9, TRUNK_BASED ? span : span / 2.6, sc * 0.9);
            } else {
              dummy.position.set(s.x, TRUNK_BASED ? gy - 0.06 : gy + trunkH * 0.5 - 0.06, s.z);
              dummy.rotation.set(0, rot, 0);
              dummy.scale.set(sc * 0.9, TRUNK_BASED ? trunkH : sc, sc * 0.9);
            }
            dummy.updateMatrix(); trunks.setMatrixAt(ti, dummy.matrix);
            // trunk footprint = the base box/bole radius under the instance's
            // own xz scale (sc*0.9). A ROUND bole is yaw-invariant, so it is
            // passed rot 0 and gets an exact AABB instead of the square box's
            // up-to-41% diagonal inflation.
            if (TRUNK_BASED) solidAt(s.x, s.z, 0.30 * sc * 0.9, 0.30 * sc * 0.9, 0, trunks);
            else solidAt(s.x, s.z, 0.25 * sc * 0.9, 0.25 * sc * 0.9, rot, trunks);
            solids++;
            if (TREES2 && tbb) {
              parts = [];
              CBZ.treeAabbPush(parts, dummy.matrix, tbb.min.x, tbb.min.y, tbb.min.z, tbb.max.x, tbb.max.y, tbb.max.z);
            }
            const cr = (1.9 + hs * 1.1) * (0.85 + (CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8809) : 0.5) * 0.3);
            const ch = 3.6 + hs * 2.0;
            // blob base: V2-legacy sat ON the trunk top (a one-point touch);
            // the law sinks it 0.55·sc INTO the trunk so the top is embedded.
            dummy.position.set(s.x, TREES2 ? trunkTop - 0.55 * sc : gy + trunkH - 0.06, s.z);
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
            solidAt(s.x, s.z, 0.25 * scale, 0.25 * scale, rot, trunks);
            solids++;
            dummy.position.y = (2.6 + 2.15) * scale - 0.06;
            dummy.updateMatrix(); canopies.setMatrixAt(ti, dummy.matrix);
          }
          ti++;
        } else {
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
            solidAt(s.x, s.z, 0.8 * scale, 0.7 * scale, rot, rocks);
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
      trunks.count = canopies.count = ti; rocks.count = ri;
      if (V2) {
        trunks.instanceColor = new THREE.InstancedBufferAttribute(tCol, 3);
        canopies.instanceColor = new THREE.InstancedBufferAttribute(cCol, 3);
        rocks.instanceColor = new THREE.InstancedBufferAttribute(rCol, 3);
      }
      trunks.instanceMatrix.needsUpdate = canopies.instanceMatrix.needsUpdate = rocks.instanceMatrix.needsUpdate = true;
      trunks.frustumCulled = canopies.frustumCulled = rocks.frustumCulled = false;
      trunks.userData.terrain = canopies.userData.terrain = rocks.userData.terrain = true;
      city.root.add(trunks, canopies, rocks);
      // published for CBZ.solidityAudit() (city/props.js) — the ONE number that
      // says the backcountry is timber and stone rather than a painted backdrop.
      CBZ.backcountrySolids = { trees: ti, rocks: ri, solids: solids, on: SOLID_BC };
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
