/* ============================================================
   city/biome_forest.js — THE FOREST BIOME (archipelago landmass).

   A massive dense conifer forest on the south-west of the map,
   connected to the military island by a dirt logging causeway.

   WHY a forest at all: the city is glass + asphalt. The forest is the
   ANTI-city — somewhere you go to lose a wanted level under cover, hunt,
   hike, or hole up in a cabin. Every prop here earns its place:
     • TREES (thousands) — the cover. Dense interior, clearings to breathe.
     • TRAILS — so it's navigable, not a pathless wall of trunks.
     • LAKE — a landmark + a reason a campsite/cabin sit where they do.
     • LOG CABIN / ranger station — an enterable building (cityMakeBuilding),
       the human anchor: rangers, a place that "owns" the woods.
     • CAMPSITE (tents + fire ring) — hikers stop here; gives the peds a why.
     • FALLEN-TREE BRIDGE + LOOKOUT TOWER — traversal + a vista landmark.
     • DEER — life; the forest feels alive, and hunters have prey.

   DRAW-CALL DISCIPLINE (owner rule #4): there are THOUSANDS of trees, so
   each ecological storey is instanced with shared geometry + material.
   Detached canopy and thicket close the scene without adding collision;
   actual trunks use tight height-gated solids, so a player can weave between
   trees while cars cannot drive through the timber.

   Everything is parented to city.root and the region is registered so
   clampToCity / swim / fullmap treat it as walkable land.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- footprint (given) ------------------------------------------------
  // The rect comes from world/layout.js (CBZ.worldFoot) — one place holds the
  // authored anchor, the world-layout dial and the stage-4 footprint scale.
  // Authored literals are the degrade-safe fallback.
  const _WOFF = (CBZ.worldOff && CBZ.worldOff("forest")) || { dx: 0, dz: 0 };   // world-layout dial
  const _FOOT = (CBZ.worldFoot && CBZ.worldFoot("forest")) ||
    { cx: -560 + _WOFF.dx, cz: -1350 + _WOFF.dz, hx: 390, hz: 330 };
  const CX = _FOOT.cx, CZ = _FOOT.cz, HX = _FOOT.hx, HZ = _FOOT.hz;
  const FSC = (CBZ.worldFootScale && CBZ.worldFootScale("forest")) || 1;
  const MINX = CX - HX, MAXX = CX + HX;   // authored -950 .. -170
  const MINZ = CZ - HZ, MAXZ = CZ + HZ;   // authored -1680 .. -1020

  // causeway: a 14-wide dirt logging road from the forest's north edge up
  // to the military island's south edge. RE-DERIVED from the two anchors it
  // connects (stage-2 dial): the lane tracks the base gate axis (military
  // CEN_X + 60 — today -560) and the deck spans forest MAXZ -> military
  // MINZ (CEN_Z - HZ, HZ=250 in island_military.js — keep in sync), so any
  // offset combination keeps both shores touching; only the length changes.
  const _MILOFF = (CBZ.worldOff && CBZ.worldOff("military")) || { dx: 0, dz: 0 };
  const CW_CX = (-620 + _MILOFF.dx) + 60;
  const CW_MINX = CW_CX - 7, CW_MAXX = CW_CX + 7;
  const CW_MINZ = MAXZ, CW_MAXZ = (-700 + _MILOFF.dz) - 250;
  const LAKE_X = CX - 150, LAKE_Z = CZ + 90, LAKE_R = 95;

  // ---- a tiny local seeded RNG (owner rule #5) --------------------------
  // mulberry32 — deterministic so the same forest grows every run.
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // shared-cache material (never disposed — survives mode swaps).
  const mat = CBZ.cmat || CBZ.mat;

  // distance helper for clearings / lake / road keep-outs.
  function d2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  CBZ.addLandmass(function (city) {
    const root = city.root;
    const rng = CBZ.seedStream ? CBZ.seedStream("forest") : makeRng(0x0F02E57);
    const layout = CBZ.worldLayout;

    // register the walkable region + the causeway (drivable land bridge).
    CBZ.registerCityRegion(city, {
      name: "Redhollow Woods", subtitle: "State Forest", biome: "forest", kind: "rect",
      minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 8,
    });
    // causeway widened to the 24m highway deck (x-span ±12 about the centreline)
    const _cwCX = (CW_MINX + CW_MAXX) / 2;
    CBZ.registerCityRegion(city, {
      name: "Redhollow Bridge", subtitle: "State Forest", kind: "rect",
      minX: _cwCX - 12, maxX: _cwCX + 12, minZ: CW_MINZ, maxZ: CW_MAXZ, pad: 1,
    });
    if (CBZ.registerCityWaterBody) CBZ.registerCityWaterBody(city, {
      id: "redhollow-lake", name: "Redhollow Lake", kind: "circle",
      cx: LAKE_X, cz: LAKE_Z, r: LAKE_R, inland: true,
    });
    // give traffic a road down the causeway (runs along Z → vertical)
    if (city.roads) {
      city.roads.push({ x: _cwCX, z: (CW_MINZ + CW_MAXZ) / 2, vertical: true, len: CW_MAXZ - CW_MINZ, district: "highway", w: 24, lanesPerDir: 2, laneW: 3.6 });
    }

    // ================================================================
    //  GROUND — mossy forest floor (one big plane, slightly above the
    //  sea/ground so it reads as its own terrain).
    // ================================================================
    // baked hash-colour variation (moss / fern / leaf-litter / duff patches)
    // so kilometres of floor stop reading as one flat slab. Deterministic per
    // seed (position hash only — the biome's rng stream is untouched).
    // 80 x 68 over the authored 796 x 676 m floor is a ~10 m colour cell; the
    // cell is the constant, so the segment counts follow the footprint rather
    // than letting the moss/fern patches stretch as the forest grows.
    const floorGeo = new THREE.PlaneGeometry(HX * 2 + 16, HZ * 2 + 16,
      Math.max(80, Math.round((HX * 2 + 16) / 9.95)),
      Math.max(68, Math.round((HZ * 2 + 16) / 9.94)));
    floorGeo.rotateX(-Math.PI / 2);
    {
      const fpos = floorGeo.attributes.position;
      const fcol = new Float32Array(fpos.count * 3);
      const cMoss = new THREE.Color(0x35451f), cDuffC = new THREE.Color(0x2c3a18);
      const cLeaf = new THREE.Color(0x4a5526), cFern = new THREE.Color(0x3b5a28);
      const cLakeBed = new THREE.Color(0x343b32), cLakeMud = new THREE.Color(0x665d40);
      const cLakeShore = new THREE.Color(0x7a6a44);
      const cForestEdge = new THREE.Color(0x4b6338);
      const fc = new THREE.Color(), edgeColor = new THREE.Color();
      for (let i = 0; i < fpos.count; i++) {
        const wx = fpos.getX(i) + CX, wz = fpos.getZ(i) + CZ;
        const h1 = CBZ.hash01 ? CBZ.hash01(Math.floor(wx / 34), Math.floor(wz / 34), 8821) : 0.5;
        const h2 = CBZ.hash01 ? CBZ.hash01(Math.floor(wx / 11), Math.floor(wz / 11), 8822) : 0.5;
        fc.copy(h1 < 0.5 ? cMoss : (h1 < 0.78 ? cFern : cLeaf));
        if (h2 > 0.88) fc.copy(cDuffC);
        const lakeD = Math.hypot(wx - LAKE_X, wz - LAKE_Z);
        if (lakeD <= LAKE_R) {
          // A real basin exposes the ONE world-ocean mesh below. Keep every
          // underwater vertex beneath the lowest 0.355m swell so green ground
          // can never flash through a trough.
          const t = Math.max(0, Math.min(1, lakeD / LAKE_R));
          const sm = t * t * (3 - 2 * t);
          fpos.setY(i, -1.72 + sm * 0.62);
          fc.copy(cLakeBed).lerp(cLakeMud, sm * 0.72);
        } else if (lakeD < LAKE_R + 14) {
          // The dry bank is part of this same heightfield, not another circle
          // laid on top. It rises from the submerged edge to the forest floor.
          let t = (lakeD - LAKE_R) / 14; t = t * t * (3 - 2 * t);
          fpos.setY(i, -1.10 + t * 1.10);
          fc.copy(cLakeShore).lerp(cMoss, t);
        }
        const edgeDist = Math.min(wx - (MINX - 8), (MAXX + 8) - wx, wz - (MINZ - 8), (MAXZ + 8) - wz);
        edgeColor.copy(cForestEdge).lerp(fc, Math.max(0, Math.min(1, edgeDist / 82)));
        fc.copy(edgeColor);
        const shade = 0.9 + h2 * 0.14;
        fcol[i * 3] = fc.r * shade; fcol[i * 3 + 1] = fc.g * shade; fcol[i * 3 + 2] = fc.b * shade;
      }
      floorGeo.setAttribute("color", new THREE.BufferAttribute(fcol, 3));
      floorGeo.attributes.position.needsUpdate = true;
      floorGeo.computeVertexNormals();
    }
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    floor.position.set(CX, 0.02, CZ);
    floor.receiveShadow = true;
    floor.userData.terrain = true;
    floor.userData.worldSurface = true;
    floor.name = "redhollow-forest-surface";
    root.add(floor);

    // Duff variation is already baked into the heightfield vertex colours.
    // The former ten coplanar circles were redundant and flickered from air.

    // Only draw the feather OUTSIDE the forest floor. A second, larger full
    // plane looked like a hard rectangular map layer from the air.
    if (CBZ.makeBiomeEdgeRing) {
      CBZ.makeBiomeEdgeRing(root, {
        cx: CX, cz: CZ, hx: HX + 8, hz: HZ + 8, feather: 20, segments: 18,
        // Redhollow can grow mostly west into open country and feather into
        // the alpine foothills north/east without swallowing their core.
        // Rides the footprint scale: with BIOME_ORGANIC_EDGES on this field IS
        // the woods' functional edge outside the rect, so an absolute spread
        // would shrink in proportion every time the forest grew.
        spread: { west: 600 * FSC, east: 90 * FSC, north: 320 * FSC, south: 280 * FSC },
        inner: 0x4b6338, outer: 0x45684e, featherNorm: 0.22,
        y: 0.008, seed: 0x0f02e57, owner: "forest",
      });
    }

    // ================================================================
    //  CAUSEWAY — dirt logging road deck (drive the bridge to the woods).
    // ================================================================
    const cwW = CW_MAXX - CW_MINX, cwL = CW_MAXZ - CW_MINZ;
    const cwCX = (CW_MINX + CW_MAXX) / 2;
    if (CBZ.buildHighway) {
      // REAL wide dirt-logging highway over the water to the woods. heightAt:
      // grade-follow world/terrain.js relief (0 over this rect's flat
      // playable footprint — a free, safe hook for the backdrop rim).
      CBZ.buildHighway(root, {
        path: [{ x: cwCX, z: CW_MINZ }, { x: cwCX, z: CW_MAXZ }],
        width: 24, lanesPerDir: 2, laneW: 3.6, theme: "dirt",
        guardrail: false, elevated: false, rng: rng,
        heightAt: CBZ.terrainHeight,
      });
    } else {
      // ---- fallback: bespoke narrow dirt deck (only if buildHighway absent) ----
      const road = new THREE.Mesh(new THREE.PlaneGeometry(cwW + 6, cwL + 4), mat(0x6b5536));
      road.rotation.x = -Math.PI / 2;
      road.position.set(cwCX, 0.04, (CW_MINZ + CW_MAXZ) / 2);
      road.receiveShadow = true; root.add(road);
    }

    // ================================================================
    //  LAKE — the basin was carved into the forest heightfield above and its
    //  footprint registered with the shared coast oracle. The sole world-sea
    //  mesh now flows through it, so there is no second lake-water material or
    //  overlapping shore disc here.
    // ================================================================
    const lakeX = LAKE_X, lakeZ = LAKE_Z, lakeR = LAKE_R;

    // ================================================================
    //  TRAILS — winding thin dirt planes so the woods are navigable.
    //  Each trail is a chain of short rotated quads (a polyline ribbon).
    //  We remember trail centre-points as tree keep-outs so trunks don't
    //  grow in the path.
    // ================================================================
    const trailPts = [];            // {x,z} sampled along all trails
    const TRAIL_KEEP = 7 * 7;       // squared radius cleared around a trail point

    function trail(x0, z0, x1, z1, wid, kinks) {
      const segs = 14;
      let px = x0, pz = z0;
      // a gently meandering path from start->end with per-trail kink noise.
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const bx = x0 + (x1 - x0) * t, bz = z0 + (z1 - z0) * t;
        const wob = (kinks || 22) * Math.sin(t * Math.PI * (1.5 + rng() * 2));
        const nx = bx + wob * (rng() - 0.5);
        const nz = bz + wob * (rng() - 0.5);
        const dx = nx - px, dz = nz - pz, len = Math.hypot(dx, dz) || 1;
        const mx = (px + nx) / 2, mz = (pz + nz) / 2;
        // A trail may approach the bank but never become a coplanar dirt road
        // across the lake. The old centre-origin branch produced the tan slabs
        // visible all over the water in the aerial QA shot.
        if (d2(mx, mz, LAKE_X, LAKE_Z) < (LAKE_R + 2) * (LAKE_R + 2)) {
          px = nx; pz = nz; continue;
        }
        const seg = new THREE.Mesh(new THREE.PlaneGeometry(wid, len + 1.5), mat(0x5a4a2e));
        seg.rotation.x = -Math.PI / 2;
        seg.rotation.z = -Math.atan2(dx, dz);
        seg.position.set((px + nx) / 2, 0.06, (pz + nz) / 2);
        seg.receiveShadow = true; root.add(seg);
        trailPts.push({ x: mx, z: mz });
        if (layout) {
          // AABB intentionally covers the rotated ribbon plus shoulder: tree
          // placement is conservative around a path, never clipped through it.
          layout.reserve("forest:trail:" + trailPts.length, {
            minX: Math.min(px, nx) - wid, maxX: Math.max(px, nx) + wid,
            minZ: Math.min(pz, nz) - wid, maxZ: Math.max(pz, nz) + wid,
          }, { pad: 2 });
        }
        px = nx; pz = nz;
      }
    }
    // main spine from the causeway mouth down into the interior, plus branches.
    trail(CW_CX, MAXZ + 5, lakeX, lakeZ - lakeR, 5.5, 26);
    trail(CW_CX, MAXZ + 5, CX - 260, CZ - 150, 4.5, 34);
    (function lakeShoreBranch() {
      const tx = CX + 260, tz = CZ - 210, dx = tx - lakeX, dz = tz - lakeZ, inv = 1 / Math.hypot(dx, dz);
      trail(lakeX + dx * inv * (lakeR + 5), lakeZ + dz * inv * (lakeR + 5), tx, tz, 4.0, 30);
    })();
    trail(CX - 260, CZ - 150, CX + 200, CZ + 50, 3.6, 28);

    function nearTrail(x, z) {
      for (let i = 0; i < trailPts.length; i++)
        if (d2(x, z, trailPts[i].x, trailPts[i].z) < TRAIL_KEEP) return true;
      return false;
    }

    // ================================================================
    //  CLEARINGS — spots where trees DON'T grow (vistas / breathing room /
    //  where the camp + cabin sit). The lake is also a keep-out.
    // ================================================================
    const clearings = [
      { x: lakeX, z: lakeZ, r: lakeR + 18 },     // the lake
      { x: CW_CX, z: MAXZ - 60, r: 34 },         // causeway mouth landing
      { x: CX + 260, z: CZ + 170, r: 40 },       // cabin clearing
      { x: CX - 140, z: CZ + 100, r: 30 },       // campsite clearing
      { x: CX + 100, z: CZ - 210, r: 36 },       // deep-woods vista
    ];
    if (layout) {
      layout.reserveCircle("forest:lake", lakeX, lakeZ, lakeR + 18, { pad: 2 });
      layout.reserve("forest:causeway", { minX: CW_MINX - 12, maxX: CW_MAXX + 12, minZ: CW_MINZ, maxZ: MAXZ }, { pad: 2 });
      clearings.forEach(function (c, i) { layout.reserveCircle("forest:clearing:" + i, c.x, c.z, c.r, { pad: 2 }); });
    }
    function claimNature(x, z, r) { return !layout || layout.claimNature(x, z, r, { pad: 0.35 }); }
    function openNature(x, z, r) { return !layout || layout.canPlaceNature(x, z, r, { pad: 0.2 }); }
    function inClearing(x, z) {
      for (let i = 0; i < clearings.length; i++) {
        const c = clearings[i];
        if (d2(x, z, c.x, c.z) < c.r * c.r) return true;
      }
      // keep trees off the causeway corridor too.
      if (x > CW_MINX - 12 && x < CW_MAXX + 12 && z > CW_MINZ - 4 && z < MAXZ) return true;
      return false;
    }

    // ================================================================
    //  THE FOREST — INSTANCED, BUT LAYERED. Real trunks are only one storey.
    //  world/vegetation.js supplies metre-authored mature wood and irregular
    //  crowns; independent lower/upper roof patches close the sky BETWEEN
    //  those trees, and a coarse thicket storey closes eye-level horizon.
    //  That separation is what makes the woods read as scenery instead of a
    //  crowd of complete cone-on-stick characters.
    //
    //  Density rises toward the interior (a denser core, thinner at edges),
    //  trees are skipped in clearings / on trails / in the lake.
    //
    //  SIMPLE DISTANCE LOD: a throttled onUpdate (see lodUpdate below) flips
    //  the ground-detail InstancedMeshes (bushes/rocks — the fine clutter
    //  that reads at point-blank but is wasted detail far away) invisible
    //  once the player is far from this biome's whole footprint, and back on
    //  when they approach. O(1) per check (one distance test), not per-tree.
    // ================================================================
    // SCENERY_VEGETATION is the new shared visual grammar. TREES_V2 still owns
    // its original physical guarantees: every wood/crown chain is registered,
    // bases are seated and only timber collides. If the shared kit is missing,
    // the former V2 stacked-cone path remains a safe load-order fallback.
    const TREES2 = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_V2 !== false && CBZ.treeRegisterTree);
    const KIT = CBZ.vegetationKit;
    const SCENERY = !!(TREES2 && KIT && CBZ.CONFIG.SCENERY_VEGETATION !== false);
    // THE FOREST LOOK BLOCK (world/forestlook.js). Redhollow is the game's
    // flagship wood and it was drawn in ONE green with a ±0.15 jitter and a
    // single crown silhouette — the two faults the owner's reference names
    // first. Degrade-safe: without the block every line below falls back to
    // exactly the colours and the single species this file already had.
    const FLOOK = (CBZ.CONFIG.FOREST_LOOK !== false) ? CBZ.forestLook : null;
    const FMIX = !!(FLOOK && CBZ.CONFIG.FOREST_SPECIES_MIX !== false);
    if (TREES2 && CBZ.treeAuditResetSite) CBZ.treeAuditResetSite("forest");
    // The scenery-scale kit remains the authoritative visual owner. The older
    // one-tree grammar only supplies the flag-off fallback, where it adds roots
    // without rescaling or replacing the newer metre-authored archetypes.
    const GRAM = !!(!SCENERY && TREES2 && CBZ.CONFIG &&
      CBZ.CONFIG.TREES_ONE_GRAMMAR !== false && CBZ.treeCrownGeo);
    const trunkGeo = SCENERY ? KIT.geometry("mature-wood")
      : (GRAM && CBZ.treeTrunkGeo
        ? CBZ.treeTrunkGeo({ rTop: 0.22, rBase: 0.42, h: 1, seg: 5, site: "forest", spread: 2.25, flare: 1.45 })
        : (function () { const g = new THREE.CylinderGeometry(0.22, 0.42, 1, 5); g.translate(0, 0.5, 0); return g; })());
    const conGeo = SCENERY ? KIT.geometry("mature-crown") : (function () {
      if (!TREES2) return new THREE.ConeGeometry(1, 1, 6);         // unit cone; scaled per-instance
      if (GRAM) return CBZ.treeCrownGeo({ tiers: 2, r: 1, h: 1, seg: 6, site: "forest" });
      const merge = THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries;
      if (merge) {
        // two stacked cones in unit space (total height 1, base at y=0);
        // tier 2's base sinks 0.17 into tier 1 — connected by construction.
        const a = new THREE.ConeGeometry(1.0, 0.62, 6); a.translate(0, 0.31, 0);
        const b = new THREE.ConeGeometry(0.70, 0.55, 6); b.translate(0, 0.45 + 0.275, 0);
        const g = merge([a, b], false);
        if (g) return g;
      }
      return new THREE.ConeGeometry(1, 1, 6);
    })();
    const ROUND_STACK = !!(!SCENERY && GRAM);
    const roundGeo = SCENERY ? KIT.geometry("subcanopy")
      : (ROUND_STACK
        ? CBZ.treeCrownGeo({ tiers: 2, r: 1, h: 1, seg: 6, taper: 0.64, site: "forest" })
        : new THREE.IcosahedronGeometry(1, 0));
    if (!TREES2) conGeo.translate(0, 0.5, 0);
    if (!SCENERY && !ROUND_STACK) {
      roundGeo.translate(0, 0.5, 0);
      if (CBZ.treeGrammarLegacy) CBZ.treeGrammarLegacy("forest");
    }
    const V2SINK = 0.2;             // trunk base below the floor plane (seated, not flush)

    const trunkMat = SCENERY ? KIT.material("mature-wood") : new THREE.MeshLambertMaterial({ color: 0xffffff });
    const foliMat = SCENERY ? KIT.material("mature-crown") : new THREE.MeshLambertMaterial({ color: 0xffffff });
    const roundMat = SCENERY ? KIT.material("subcanopy") : new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    trunkMat._shared = true; foliMat._shared = true; roundMat._shared = true;

    // first pass: decide every tree's transform (so we know the exact count
    // before allocating the InstancedMesh buffers — InstancedMesh needs a
    // fixed capacity at construction).
    const trees = [], roundTrees = [];
    // The old sqrt(FSC) pitch quietly made every tree 20% farther apart when
    // the biome grew, causing a 31% local-density regression. Scene-scale trees
    // keep a fixed physical spacing. 12.5m is the upper end of a mature stand;
    // detached roof patches below fill coverage without a collider per patch.
    const STEP = SCENERY ? 12.5 : 11 * Math.sqrt(FSC);
    const dummy = new THREE.Object3D();
    const colTrunk = new THREE.Color(), colFoli = new THREE.Color();
    const trunkColors = [], foliColors = [];
    const roundTrunkColors = [], roundColors = [];

    for (let gx = MINX + 14; gx <= MAXX - 14; gx += STEP) {
      for (let gz = MINZ + 14; gz <= MAXZ - 14; gz += STEP) {
        // jitter off the grid so it never reads as rows.
        const x = gx + (rng() - 0.5) * STEP * 1.3;
        const z = gz + (rng() - 0.5) * STEP * 1.3;
        if (x < MINX + 8 || x > MAXX - 8 || z < MINZ + 8 || z > MAXZ - 8) continue;
        if (inClearing(x, z) || nearTrail(x, z)) continue;

        // density falloff: denser core, sparser rim — skip some near edges.
        const edge = Math.min(
          (x - MINX) / HX, (MAXX - x) / HX,
          (z - MINZ) / HZ, (MAXZ - z) / HZ
        );                                            // 0 at rim .. ~1 deep inside
        const keepP = 0.55 + Math.min(0.42, edge * 0.6);
        if (rng() > keepP) continue;
        if (!claimNature(x, z, 2.4)) continue;

        // The small share is a real subcanopy storey. The rest are mature wood
        // with a heavy-tailed scale: most 21-33m, rare emergents near 42m.
        const speciesRoll = rng();
        const broad = !SCENERY && speciesRoll < 0.12;
        const round = SCENERY ? speciesRoll < 0.18 : (!broad && speciesRoll < 0.22);
        // WHICH SPECIES, from the shared patch mask — a POSITION hash, so it
        // consumes nothing from the stream above and the conifer stands here
        // line up with the ones the backcountry grows on the other side of
        // the biome's edge instead of stopping at it.
        const conifer = !!(FMIX && FLOOK.species(x, z, { site: "forest" }).conifer);
        const tShade = 0.34 + rng() * 0.18;
        colTrunk.setRGB(tShade, tShade * 0.66, tShade * 0.38);

        if (round) {
          // Sapling / subcanopy — still larger than a person, but clearly below
          // the roof. Its complete silhouette is hidden inside the forest mass.
          const h = SCENERY ? 5.5 + rng() * 4.5 : 6 + rng() * 6;
          const tr = SCENERY ? 0.8 + rng() * 0.5 : 0.32 + rng() * 0.22;
          const rot = rng() * Math.PI * 2;
          const lean = (rng() - 0.5) * 0.08;
          const folR = SCENERY ? 0.62 + rng() * 0.42 : h * (0.30 + rng() * 0.12);
          const folH = SCENERY ? 0.72 + rng() * 0.36 : folR;
          const folY = SCENERY ? h - 0.65 : h * (0.66 + rng() * 0.1);
          colFoli.setRGB(0.28 + rng() * 0.12, 0.44 + rng() * 0.16, 0.16 + rng() * 0.08);
          roundTrees.push({ x, z, h, tr, rot, lean, folR, folH, folY });
          roundTrunkColors.push(colTrunk.r, colTrunk.g, colTrunk.b);
          roundColors.push(colFoli.r, colFoli.g, colFoli.b);
          continue;
        }

        const giant = SCENERY && rng() < 0.075;
        const sc = SCENERY ? (giant ? 1.28 + rng() * 0.30 : 0.80 + rng() * 0.42) : 1;
        const h = SCENERY ? KIT.nominal.matureWoodHeight * sc : (broad ? 6 + rng() * 5 : 9 + rng() * 12);
        const tr = SCENERY ? sc : 0.5 + rng() * 0.4;
        const rot = rng() * Math.PI * 2;
        const lean = (rng() - 0.5) * 0.08;            // slight tilt

        const folH = SCENERY ? sc * (0.90 + rng() * 0.16) : (broad ? h * 0.7 : h * 0.95);
        const folR = SCENERY ? sc * (0.88 + rng() * 0.20) : (broad ? h * 0.42 : h * 0.30);
        const folY = SCENERY ? KIT.nominal.matureCrownBase * sc : (broad ? h * 0.55 : h * 0.35);

        // COLOUR — one ramp for every wood in the game (world/forestlook.js).
        // The three rng draws are KEPT and PASSED IN rather than replaced:
        // this file's placement rides one sequential stream, so removing a
        // draw would re-deal every cabin, trail and animal downstream of it.
        // The block turns them into a jitter on a field instead of being the
        // whole colour, which is the entire difference between "many greens"
        // and "green plus noise".
        const j0 = rng(), j1 = rng(), j2 = rng();
        if (SCENERY && FLOOK) {
          FLOOK.tint(colFoli, x, z, {
            conifer: conifer, j0: j0, j1: j1, closure: 0.92, alt: 0, sun: 0.42, site: "forest",
          });
        } else if (SCENERY) colFoli.setRGB(0.14 + j0 * 0.10, 0.32 + j1 * 0.15, 0.10 + j2 * 0.07);
        else if (broad) colFoli.setRGB(0.30 + j0 * 0.18, 0.46 + j1 * 0.16, 0.16 + j2 * 0.10);
        else colFoli.setRGB(0.10 + j0 * 0.08, 0.30 + j1 * 0.14, 0.13 + j2 * 0.08);

        trees.push({ x, z, h, tr, sc, rot, lean, folH, folR, folY, giant, conifer });
        trunkColors.push(colTrunk.r, colTrunk.g, colTrunk.b);
        foliColors.push(colFoli.r, colFoli.g, colFoli.b);
      }
    }

    const N = trees.length;
    // ---- THE SECOND SILHOUETTE ---------------------------------------
    // A share of the mature storey wears the kit's conifer spire instead of
    // the rounded crown, in the same low-frequency patches the backcountry
    // uses. Cost: ONE extra InstancedMesh (the trunk mesh is shared — a
    // spruce bole is the same timber), and the spire is 40 triangles against
    // the rounded crown's 100, so the mix is cheaper than the monoculture.
    let nSpire = 0;
    for (let i = 0; i < N; i++) if (trees[i].conifer) nSpire++;
    const spireGeo = (FMIX && nSpire) ? KIT.geometry("conifer-spire") : null;
    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
    const treeShadows = !SCENERY || (CBZ.qualityLevel == null ? 2 : CBZ.qualityLevel) >= 2;
    trunkInst.castShadow = treeShadows;
    trunkInst.receiveShadow = true;
    trunkInst.name = SCENERY ? "redhollow-mature-wood" : "redhollow-tree-trunks";
    trunkInst.frustumCulled = false;
    trunkInst.userData.vegetationLayer = "mature-wood";
    trunkInst.userData.sceneryScale = SCENERY;
    trunkInst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(trunkColors), 3);

    /* ---- ONE WOOD, MANY CROWNS ---------------------------------------
       This stand used to draw every one of its ~2,600 crowns from a SINGLE
       geometry — the cloned-tree tell, and the loudest thing separating a
       generated wood from a photographed one. world/vegetation.js now grows
       K structurally different crowns per archetype (see NO TWO TREES ARE
       THE SAME MESH there); a pool is one InstancedMesh per variant, sized
       to exactly the trees that chose it.

       WHICH variant a tree wears is a POSITION hash, not a draw on this
       file's sequential rng — so adopting this re-deals nothing downstream
       (every cabin, trail, tent and deer stays where it was), and a conifer
       on the biome's edge agrees with the backcountry conifer across the
       seam. Every variant shares variant 0's bounding box by construction,
       so the folR/folH/folY scaling below and TREES_V2's connection law are
       untouched. K is 1 at quality tier 0 and whenever the kit is absent, in
       which case a pool is exactly the single InstancedMesh this was. */
    function crownPool(kind, baseGeo, list, nameBase, layer, mat) {
      mat = mat || foliMat;
      const K = (SCENERY && KIT.variantCount && baseGeo === null) ? KIT.variantCount(kind) : 1;
      const caps = new Array(K).fill(0);
      const vOf = K > 1
        ? function (x, z) { return KIT.variantAt(x, z, kind); }
        : function () { return 0; };
      for (let i = 0; i < list.length; i++) caps[vOf(list[i].x, list[i].z)]++;
      const meshes = [], cols = [], bbs = [], n = new Array(K).fill(0);
      for (let v = 0; v < K; v++) {
        // a variant nobody drew builds nothing: no geometry, no mesh, no draw
        if (!caps[v]) { meshes.push(null); cols.push(null); bbs.push(null); continue; }
        const g = K > 1 ? KIT.geometry(kind, v) : (baseGeo || KIT.geometry(kind));
        const m = new THREE.InstancedMesh(g, mat, caps[v]);
        m.name = nameBase + (K > 1 ? "-v" + v : "");
        m.castShadow = treeShadows; m.receiveShadow = true; m.frustumCulled = false;
        m.userData.vegetationLayer = layer || kind;
        m.userData.sceneryScale = SCENERY;
        m.userData.vegetationVariant = v;
        meshes.push(m);
        cols.push(new Float32Array(caps[v] * 3));
        bbs.push(TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(g) : null);
      }
      return {
        kind: kind, K: K, meshes: meshes,
        // returns the geometry bounds of the mesh this instance landed in, so
        // the caller can push the RIGHT canopy AABB into the audit chain.
        add: function (x, z, matrix, r, g2, b) {
          const v = vOf(x, z);
          const i = n[v]++;
          meshes[v].setMatrixAt(i, matrix);
          cols[v][i * 3] = r; cols[v][i * 3 + 1] = g2; cols[v][i * 3 + 2] = b;
          return bbs[v];
        },
        finish: function () {
          for (let v = 0; v < K; v++) {
            if (!meshes[v] || !n[v]) continue;
            meshes[v].count = n[v];
            meshes[v].instanceColor = new THREE.InstancedBufferAttribute(cols[v], 3);
            meshes[v].instanceMatrix.needsUpdate = true;
            root.add(meshes[v]);
            if (KIT.noteUse) KIT.noteUse("forest", kind, v, n[v]);
          }
        },
      };
    }
    const broadList = [], spireList = [];
    for (let i = 0; i < N; i++) {
      if (trees[i].conifer && spireGeo) spireList.push(trees[i]); else broadList.push(trees[i]);
    }
    const foliPool = crownPool("mature-crown", SCENERY ? null : conGeo, broadList,
      SCENERY ? "redhollow-mature-crowns" : "redhollow-tree-foliage", "mature-crown");
    const spirePool = spireGeo
      ? crownPool("conifer-spire", null, spireList, "redhollow-conifer-spires", "conifer-spire")
      : null;

    const tbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(trunkGeo) : null;
    for (let i = 0; i < N; i++) {
      const t = trees[i];
      // trunk (V2: base sunk V2SINK below the floor, top unchanged at t.h)
      dummy.position.set(t.x, TREES2 ? -V2SINK : 0, t.z);
      dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
      if (SCENERY) dummy.scale.setScalar(t.sc);
      else dummy.scale.set(t.tr, TREES2 ? t.h + V2SINK : t.h, t.tr);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
      let parts = null;
      if (TREES2 && tbb) {
        parts = [];
        CBZ.treeAabbPush(parts, dummy.matrix, tbb.min.x, tbb.min.y, tbb.min.z, tbb.max.x, tbb.max.y, tbb.max.z);
      }
      // crown (rides above, same lean). The spire is authored 23 m tall with
      // its foliage running down the bole, so it is seated LOW and stretched
      // to land its tip above the rounded roof — the reference's skyline.
      let bb;
      if (t.conifer && spirePool) {
        dummy.position.set(t.x, KIT.nominal.matureCrownBase * t.sc * 0.30, t.z);
        dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
        dummy.scale.set(t.sc * 0.92, t.sc * (KIT.nominal.matureWoodHeight / KIT.nominal.spireHeight) * 1.34, t.sc * 0.92);
        dummy.updateMatrix();
        bb = spirePool.add(t.x, t.z, dummy.matrix, foliColors[i * 3], foliColors[i * 3 + 1], foliColors[i * 3 + 2]);
      } else {
        dummy.position.set(t.x, t.folY, t.z);
        dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
        dummy.scale.set(t.folR, t.folH, t.folR);
        dummy.updateMatrix();
        bb = foliPool.add(t.x, t.z, dummy.matrix, foliColors[i * 3], foliColors[i * 3 + 1], foliColors[i * 3 + 2]);
      }
      if (parts && bb) {
        CBZ.treeAabbPush(parts, dummy.matrix, bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z);
        CBZ.treeRegisterTree("forest", 0, parts);      // flat biome floor (plane top at 0.02)
      }
    }
    trunkInst.instanceMatrix.needsUpdate = true;
    root.add(trunkInst);
    foliPool.finish();
    if (spirePool) spirePool.finish();

    // ---- SUBCANOPY trees: a separate, lower storey beneath the detached roof.
    const RN = roundTrees.length;
    const roundTrunkGeo = !SCENERY && GRAM && CBZ.treeTrunkGeo
      ? CBZ.treeTrunkGeo({ rTop: 0.20, rBase: 0.30, h: 1, seg: 5, roots: 3, spread: 2.4, flare: 1.4, site: "forest" })
      : (function () {
        const g = new THREE.CylinderGeometry(SCENERY ? 0.24 : 0.20, SCENERY ? 0.38 : 0.30, 1, 5);
        g.translate(0, 0.5, 0);
        return g;
      })();
    const roundTrunkMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    roundTrunkMat._shared = true;
    const roundTrunkInst = new THREE.InstancedMesh(roundTrunkGeo, roundTrunkMat, RN);
    // The subcanopy storey is the one you actually brush past, so it gets the
    // same variant pool the mature crowns do. `roundMat` is flat-shaded where
    // the mature crown's is not, so this pool carries its own material.
    const roundPool = crownPool("subcanopy", SCENERY ? null : roundGeo, roundTrees,
      SCENERY ? "redhollow-subcanopy-crowns" : "redhollow-round-crowns", "subcanopy", roundMat);
    roundTrunkInst.castShadow = treeShadows;
    roundTrunkInst.receiveShadow = true;
    roundTrunkInst.name = SCENERY ? "redhollow-subcanopy-wood" : "redhollow-round-trunks";
    roundTrunkInst.frustumCulled = false;
    roundTrunkInst.userData.vegetationLayer = "subcanopy-wood";
    roundTrunkInst.userData.sceneryScale = SCENERY;
    roundTrunkInst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(roundTrunkColors), 3);
    const rtbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(roundTrunkGeo) : null;
    for (let i = 0; i < RN; i++) {
      const t = roundTrees[i];
      dummy.position.set(t.x, TREES2 ? -V2SINK : 0, t.z);
      dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
      dummy.scale.set(t.tr, TREES2 ? t.h + V2SINK : t.h, t.tr);
      dummy.updateMatrix();
      roundTrunkInst.setMatrixAt(i, dummy.matrix);
      let parts = null;
      if (TREES2 && rtbb) {
        parts = [];
        CBZ.treeAabbPush(parts, dummy.matrix, rtbb.min.x, rtbb.min.y, rtbb.min.z, rtbb.max.x, rtbb.max.y, rtbb.max.z);
      }
      // CROWN VOLUME PRESERVED ACROSS THE SHAPE CHANGE. The blob was a unit
      // sphere-ish geo (y[-0.5..1.5], radius 1) placed at folY and scaled
      // uniformly by folR, so it filled y[folY-0.5folR, folY+1.5folR]. The
      // stack is base-at-0/height-1, so it lands in the same volume from
      // (folY - 0.5folR) with a Y-scale of 2folR — which is what keeps the
      // trunk-top overlap (and therefore CBZ.treeAudit()'s chain) exactly
      // where it was, instead of quietly lifting the canopy off the tree.
      dummy.position.set(t.x, ROUND_STACK ? t.folY - 0.5 * t.folR : t.folY, t.z);
      dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
      dummy.scale.set(t.folR,
        SCENERY ? (t.folH || t.folR) : (ROUND_STACK ? t.folR * 2 : t.folR),
        t.folR);
      dummy.updateMatrix();
      const rcbb = roundPool.add(t.x, t.z, dummy.matrix,
        roundColors[i * 3], roundColors[i * 3 + 1], roundColors[i * 3 + 2]);
      if (parts && rcbb) {
        CBZ.treeAabbPush(parts, dummy.matrix, rcbb.min.x, rcbb.min.y, rcbb.min.z, rcbb.max.x, rcbb.max.y, rcbb.max.z);
        CBZ.treeRegisterTree("forest", 0, parts);
      }
    }
    roundTrunkInst.instanceMatrix.needsUpdate = true;
    root.add(roundTrunkInst);
    roundPool.finish();

    // ---- DETACHED CANOPY ROOF --------------------------------------------
    // Trees alone preserve one complete silhouette per trunk. These two
    // non-colliding layers deliberately break that identity: a lower roof fills
    // the 12-22m band and a looser upper phase fills 21-32m. The two grids are
    // independent, so their seams never line up. No new rng draws — position
    // hashes keep every later cabin/animal placement stream unchanged.
    function vh(x, z, cell, salt) {
      const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
      const fx0 = x / cell - ix, fz0 = z / cell - iz;
      const sx = fx0 * fx0 * (3 - 2 * fx0), sz = fz0 * fz0 * (3 - 2 * fz0);
      function H(a, b) {
        if (CBZ.hash01) return CBZ.hash01(a * cell, b * cell, salt);
        const q = Math.sin(a * 127.1 + b * 311.7 + salt * 0.017) * 43758.5453;
        return q - Math.floor(q);
      }
      const a = H(ix, iz), b = H(ix + 1, iz), c = H(ix, iz + 1), d = H(ix + 1, iz + 1);
      return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz;
    }
    function forestClump(x, z) {
      // Heavy tail from three physical scales (broad stand / grove / knot).
      // Multiplication produces saturated masses and real pockets rather than
      // the old low-variance "even spacing by construction" peppering.
      const a = 0.30 + 0.70 * vh(x, z, 84, 0x4f21);
      const b = 0.34 + 0.66 * vh(x, z, 28, 0x4f22);
      const c = 0.42 + 0.58 * vh(x, z, 10.4, 0x4f23);
      return a * b * c;
    }
    function roofAllowed(x, z, upper) {
      if (x < MINX + 5 || x > MAXX - 5 || z < MINZ + 5 || z > MAXZ - 5) return false;
      // The lake stays a genuine hole in the roof. Human clearings retain a
      // controlled sky window, but upper crowns can lean over their margins.
      for (let i = 0; i < clearings.length; i++) {
        const c = clearings[i], keep = i === 0 ? c.r + 7 : c.r * (upper ? 0.48 : 0.70);
        if (d2(x, z, c.x, c.z) < keep * keep) return false;
      }
      if (x > CW_MINX - 9 && x < CW_MAXX + 9 && z > CW_MINZ - 4 && z < MAXZ) return false;
      return true;
    }
    function roofLayer(step, upper, salt) {
      const out = [];
      for (let gx = MINX + step * 0.5; gx < MAXX; gx += step) {
        for (let gz = MINZ + step * 0.5; gz < MAXZ; gz += step) {
          const jx = (CBZ.hash01 ? CBZ.hash01(gx, gz, salt) : 0.5) - 0.5;
          const jz = (CBZ.hash01 ? CBZ.hash01(gx, gz, salt + 1) : 0.5) - 0.5;
          const x = gx + jx * step * 0.82, z = gz + jz * step * 0.82;
          if (!roofAllowed(x, z, upper)) continue;
          const cl = forestClump(x, z);
          const die = CBZ.hash01 ? CBZ.hash01(x, z, salt + 2) : 0.5;
          if (die > (upper ? 0.24 + cl * 0.52 : 0.43 + cl * 0.56)) continue;
          const hv = CBZ.hash01 ? CBZ.hash01(x, z, salt + 3) : 0.5;
          const cv = CBZ.hash01 ? CBZ.hash01(x, z, salt + 4) : 0.5;
          const s = (upper ? 0.72 : 0.68) + hv * (upper ? 0.46 : 0.42);
          out.push({
            x: x, z: z, y: (upper ? 20.0 : 11.8) + cv * (upper ? 5.0 : 5.6),
            sx: s * (0.92 + jx * 0.16), sy: s * (upper ? 0.86 : 0.98), sz: s * (0.94 + jz * 0.15),
            ry: hv * Math.PI * 2, rx: jx * 0.045, rz: jz * 0.045,
            j0: hv, j1: cv,
            r: upper ? 0.13 + cv * 0.08 : 0.10 + cv * 0.07,
            g: upper ? 0.31 + hv * 0.13 : 0.27 + hv * 0.12,
            b: upper ? 0.10 + cv * 0.055 : 0.075 + cv * 0.045,
          });
        }
      }
      return out;
    }
    const lowerRoof = SCENERY ? roofLayer(10.5, false, 0x4f30) : [];
    const upperRoof = SCENERY ? roofLayer(13.5, true, 0x4f40) : [];
    function roofMesh(name, items, upper) {
      if (!SCENERY || !items.length) return null;
      return KIT.instanceLayer(root, {
        kind: "canopy-patch", name: name, owner: "forest",
        castShadow: false, receiveShadow: true,
        // THE ROOF IS TWO STOREYS OF LIGHT, and that is the whole reason
        // this reads as a canopy and not a green ceiling: the upper phase is
        // what the sun actually lands on, the lower phase is what it does
        // not. One `sun` argument to the shared ramp says so (world/
        // forestlook.js), replacing two hand-typed colour ladders here.
        color: function (c, p) {
          if (FLOOK) {
            FLOOK.tint(c, p.x, p.z, {
              conifer: false, closure: upper ? 0.55 : 0.95, alt: 0,
              sun: upper ? 0.72 : 0.24, j0: p.j0, j1: p.j1, site: "forest-roof",
            });
          } else c.setRGB(p.r, p.g, p.b);
        },
      }, items);
    }
    const lowerRoofMesh = roofMesh("redhollow-canopy-lower", lowerRoof, false);
    const upperRoofMesh = roofMesh("redhollow-canopy-upper", upperRoof, true);

    // EVERY TRUNK IS SOLID. This used to be 24 hand-picked "landmark" trunks
    // near the trail, on the reasoning "NOT thousands of them (perf)" — which
    // left ~2,600 conifers and ALL ~250 birches (the round-canopy loop was
    // never even iterated here) as pure silhouette, i.e. a whole forest you
    // sprint and drive straight through. Two things make the perf line wrong:
    //   • the broadphase is a SPATIAL GRID (systems/physics.js), so what costs
    //     a frame is colliders-per-8m-bucket, not colliders-in-the-world. The
    //     grid pitch here is 11 m with a hard 2.4 m `claimNature` separation,
    //     so a bucket holds one or two trunks — the per-frame query is
    //     unchanged whether this pushes 24 boxes or 2,900.
    //   • the AABB is now the trunk's REAL radius (the geometry's own base
    //     radius times the instance's own scale) instead of `tr*0.45 + 0.3`,
    //     which was nearly double the timber. Tightest gap that leaves is
    //     2.4 - 0.76 = 1.64 m: a 1.1 m body walks the woods, a 1.9 m car does
    //     not — which is the correct difference between a forest and a lawn.
    // FOLIAGE IS STILL FREE: only trunks. Flag: BIOME_SOLID_TRUNKS.
    const SOLID_TRUNKS = !(CBZ.CONFIG && CBZ.CONFIG.BIOME_SOLID_TRUNKS === false);
    let placed = 0;
    if (SOLID_TRUNKS) {
      for (let i = 0; i < N; i++) {
        const t = trees[i];
        const r = SCENERY ? 0.82 * t.sc : t.tr * 0.42 + 0.06;
        CBZ.colliders.push({ minX: t.x - r, maxX: t.x + r, minZ: t.z - r, maxZ: t.z + r, y0: 0, y1: t.h, noCam: true });
        placed++;
      }
      for (let i = 0; i < RN; i++) {
        const t = roundTrees[i];
        const r = t.tr * (SCENERY ? 0.38 : 0.30) + 0.05;
        CBZ.colliders.push({ minX: t.x - r, maxX: t.x + r, minZ: t.z - r, maxZ: t.z + r, y0: 0, y1: t.h, noCam: true });
        placed++;
      }
    } else {
      // legacy: the 24 landmark trunks, byte-identical (the one-line revert)
      for (let i = 0; i < N && placed < 24; i++) {
        const t = trees[i];
        if (t.h < 16) continue;
        if (!nearTrailZone(t.x, t.z)) continue;
        const r = t.tr * 0.45 + 0.3;
        CBZ.colliders.push({ minX: t.x - r, maxX: t.x + r, minZ: t.z - r, maxZ: t.z + r, y0: 0, y1: t.h });
        placed++;
      }
    }
    CBZ.forestTrunkSolids = placed;
    function nearTrailZone(x, z) {
      for (let i = 0; i < trailPts.length; i++)
        if (d2(x, z, trailPts[i].x, trailPts[i].z) < 18 * 18) return true;
      return false;
    }

    // ================================================================
    //  GROUND DETAIL — ferns / bushes / rocks / fallen logs, INSTANCED.
    //  Two instanced meshes: a leafy shrub clump and a small fractured
    //  stone. Logs are a SMALL count so plain meshes ok.
    //
    //  OWNER: "there are little green and little gray rocks — these little
    //  geometric things. Get rid of those... You can have small rocks, but
    //  not these, like, boulders." Both of these WERE those things: the bush
    //  was a unit IcosahedronGeometry (a green faceted ball) and the rock a
    //  unit DodecahedronGeometry scaled to 0.5-1.5 m — a grey geometric solid
    //  the size of a suitcase, sitting on the forest floor 260 times.
    //    • the SHRUB joins the one tree grammar: a squat two-whorl cone
    //      clump, authored in the blob's exact unit envelope (y[-0.85,0.85],
    //      radius 0.85) so not one line of the placement loop moves.
    //    • the STONE goes through world/rockscliffs.js — the ONE rock factory
    //      in this game, whose scrape algorithm produces real planar fracture
    //      facets instead of a smooth solid — and SHRINKS to boot-sized
    //      (SMALL_ROCK below). Small rocks are allowed; boulders made of six
    //      pentagons are not.
    // ================================================================
    // Near understory plus a separate hash-clumped thicket wall. The former
    // keeps the historical 900-item rng budget; the latter is additive and
    // position-hashed, so later logs/landmarks keep their seeded placement.
    const bushGeo = SCENERY ? KIT.geometry("thicket")
      : (GRAM && CBZ.treeCrownGeo
        ? CBZ.treeCrownGeo({ tiers: 2, r: 0.85, h: 1.7, y0: -0.85, seg: 5, taper: 0.68, site: "forest-shrub" })
        : new THREE.IcosahedronGeometry(1, 0));
    const bushMat = SCENERY ? KIT.material("thicket") : new THREE.MeshLambertMaterial({ color: 0xffffff });
    bushMat._shared = true;
    // 0.28 turns the old 0.5-1.5 m geometric solid into a 0.28-0.84 m field
    // stone standing at most ~0.5 m proud — around physics.js's 0.45 STEP_UP,
    // i.e. scenery you walk over. These have never carried colliders and
    // still do not.
    const SMALL_ROCK = (!CBZ.CONFIG || CBZ.CONFIG.WILD_SMALL_ROCKS !== false) ? 0.28 : 1;
    const rockGeo = SMALL_ROCK !== 1 && CBZ.makeRock
      ? CBZ.makeRock(1, 0x5F0235, 1, { scrapes: 9, depthMin: 0.06, depthMax: 0.34 })
      : new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }); rockMat._shared = true;

    const bushes = [], rocks = [];
    const NB = 900, NR = 260;
    // METHOD (PROCGEN.md #1): jittered-grid scatter instead of rejection
    // retries — cell size derives from the requested count, one candidate
    // per cell with sub-cell jitter, clearings simply leave their cells
    // empty. Even spacing by construction (no two samples share a cell),
    // deterministic, and never spins: exactly one pass over the grid.
    function fillScatter(arr, count) {
      const W = HX * 2 - 20, D = HZ * 2 - 20;
      const step = Math.sqrt((W * D) / count);
      for (let gx = MINX + 10 + step / 2; gx < MINX + 10 + W; gx += step) {
        for (let gz = MINZ + 10 + step / 2; gz < MINZ + 10 + D; gz += step) {
          const x = gx + (rng() - 0.5) * step * 0.9;
          const z = gz + (rng() - 0.5) * step * 0.9;
          if (inClearing(x, z) || !openNature(x, z, 0.9)) continue;
          arr.push({ x, z, s: 0.5 + rng() * 1.0, rot: rng() * 6.28 });
        }
      }
    }
    fillScatter(bushes, NB);
    fillScatter(rocks, NR);

    const bushInst = new THREE.InstancedMesh(bushGeo, bushMat, bushes.length);
    const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    bushInst.castShadow = true; rockInst.castShadow = true;
    bushInst.receiveShadow = true; rockInst.receiveShadow = true;
    const bushCol = [], rockCol = [], bc = new THREE.Color(), rc = new THREE.Color();
    for (let i = 0; i < bushes.length; i++) {
      const b = bushes[i];
      dummy.position.set(b.x, SCENERY ? 0.02 : b.s * 0.5, b.z);
      dummy.rotation.set(0, b.rot, 0);
      dummy.scale.set(SCENERY ? b.s * 0.72 : b.s, SCENERY ? b.s * 0.58 : b.s * 0.7, SCENERY ? b.s * 0.72 : b.s);
      dummy.updateMatrix(); bushInst.setMatrixAt(i, dummy.matrix);
      bc.setRGB(0.16 + rng() * 0.12, 0.34 + rng() * 0.16, 0.14 + rng() * 0.08);
      bushCol.push(bc.r, bc.g, bc.b);
    }
    for (let i = 0; i < rocks.length; i++) {
      const r = rocks[i];
      // SMALL_ROCK shrinks the drawn stone WITHOUT touching the scatter: r.s
      // still comes off the same single rng() draw it always did (the claim
      // radius here was a fixed 0.9 and never rode r.s), so the stream — and
      // therefore every bush, log and tree dealt after it — is untouched.
      const rs = r.s * SMALL_ROCK;
      dummy.position.set(r.x, rs * 0.4, r.z);
      dummy.rotation.set(rng() * 0.6, r.rot, rng() * 0.6);
      dummy.scale.set(rs, rs * 0.8, rs);
      dummy.updateMatrix(); rockInst.setMatrixAt(i, dummy.matrix);
      const g = 0.42 + rng() * 0.16; rc.setRGB(g, g, g * 1.02);
      rockCol.push(rc.r, rc.g, rc.b);
    }
    bushInst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bushCol), 3);
    rockInst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(rockCol), 3);
    bushInst.instanceMatrix.needsUpdate = true;
    rockInst.instanceMatrix.needsUpdate = true;
    bushInst.name = SCENERY ? "redhollow-near-thicket" : "redhollow-bushes";
    rockInst.name = "redhollow-rocks";
    bushInst.frustumCulled = rockInst.frustumCulled = false;
    bushInst.userData.vegetationLayer = SCENERY ? "near-thicket" : "bush";
    bushInst.userData.sceneryScale = SCENERY;
    root.add(bushInst); root.add(rockInst);

    const farThickets = [];
    if (SCENERY) {
      const step = 11.5;
      for (let gx = MINX + step * 0.5; gx < MAXX; gx += step) {
        for (let gz = MINZ + step * 0.5; gz < MAXZ; gz += step) {
          const jx = (CBZ.hash01 ? CBZ.hash01(gx, gz, 0x4f51) : 0.5) - 0.5;
          const jz = (CBZ.hash01 ? CBZ.hash01(gx, gz, 0x4f52) : 0.5) - 0.5;
          const x = gx + jx * step * 0.82, z = gz + jz * step * 0.82;
          if (inClearing(x, z) || nearTrail(x, z)) continue;
          const cl = forestClump(x, z);
          const die = CBZ.hash01 ? CBZ.hash01(x, z, 0x4f53) : 0.5;
          if (die > Math.min(0.91, 0.16 + cl * 1.16)) continue;
          const h = CBZ.hash01 ? CBZ.hash01(x, z, 0x4f54) : 0.5;
          const c = CBZ.hash01 ? CBZ.hash01(x, z, 0x4f55) : 0.5;
          farThickets.push({
            x: x, y: 0.02, z: z,
            sx: 0.58 + h * 0.52, sy: 0.62 + c * 0.58, sz: 0.58 + (1 - h) * 0.52,
            ry: h * Math.PI * 2,
            r: 0.09 + c * 0.055, g: 0.25 + h * 0.12, b: 0.07 + c * 0.045,
          });
        }
      }
    }
    const farThicketMesh = SCENERY && farThickets.length ? KIT.instanceLayer(root, {
      kind: "thicket", name: "redhollow-far-thicket", owner: "forest",
      castShadow: false, receiveShadow: true,
      color: function (c, p) { c.setRGB(p.r, p.g, p.b); },
    }, farThickets) : null;

    // Executable visual-scale facts for the browser regression. These are
    // authored-source metrics, not a screenshot heuristic: they directly state
    // whether the live build has mature height and independent forest storeys.
    const matureTops = SCENERY ? trees.map(function (t) {
      return t.folY + KIT.nominal.matureCrownHeight * t.folH;
    }).sort(function (a, b) { return a - b; }) : [];
    const patchArea = SCENERY ? lowerRoof.concat(upperRoof).reduce(function (sum, p) {
      const rr = KIT.nominal.canopyPatchRadius * Math.max(p.sx, p.sz);
      return sum + Math.PI * rr * rr;
    }, 0) : 0;
    const usableArea = HX * 2 * HZ * 2 - Math.PI * LAKE_R * LAKE_R;
    CBZ.forestSceneryAudit = function () {
      const mid = matureTops.length ? matureTops[(matureTops.length / 2) | 0] : 0;
      return {
        owner: "forest", enabled: SCENERY,
        matureTrees: N, subcanopyTrees: RN,
        lowerRoof: lowerRoof.length, upperRoof: upperRoof.length,
        nearThicket: bushes.length, farThicket: farThickets.length,
        matureMedianHeight: +mid.toFixed(2),
        matureMedianPlayerHeights: +(mid / 1.8).toFixed(2),
        emergentHeight: matureTops.length ? +matureTops[matureTops.length - 1].toFixed(2) : 0,
        roofCoveragePotential: usableArea > 0 ? +(patchArea / usableArea).toFixed(3) : 0,
        physicalTreeSpacing: STEP,
        completeConeCrowns: SCENERY ? 0 : N,
        crownVariants: foliPool.K,
        layers: [trunkInst].concat(foliPool.meshes, spirePool ? spirePool.meshes : [],
          [roundTrunkInst], roundPool.meshes, [lowerRoofMesh, upperRoofMesh, bushInst, farThicketMesh])
          .filter(function (m) { return m && m.parent; })
          .map(function (m) { return { name: m.name, count: m.count, visible: m.visible !== false }; }),
      };
    };

    // ================================================================
    //  SIMPLE DISTANCE LOD — fine ground clutter (bushes/ferns/rocks) reads
    //  at point-blank but is wasted fill-rate + vertex cost when the player
    //  is nowhere near this biome (the forest is a big chunk of the far
    //  archipelago; a player in the city or on the desert highway is paying
    //  for ~1160 instances of detail they can't see). A throttled distance
    //  check (one sqrt, not per-instance) flips both InstancedMeshes
    //  invisible past LOD_FAR and back on inside LOD_NEAR — cheap hysteresis
    //  band so it doesn't flicker at the boundary. Trees/landmarks stay
    //  visible always (the canopy silhouette reads from far away and is the
    //  point of the biome); this only trims the close-range clutter layer.
    // ================================================================
    (function groundDetailLOD() {
      if (!CBZ.onUpdate) return;
      const LOD_NEAR = HX + 260, LOD_FAR = HX + 420;   // hysteresis band (forest half-extent + margin)
      let detailOn = true;
      CBZ.onUpdate(46.25, function () {
        const P = CBZ.player;
        if (!P || !P.pos) return;
        const d = Math.hypot(P.pos.x - CX, P.pos.z - CZ);
        if (detailOn && d > LOD_FAR) {
          detailOn = false; bushInst.visible = false; rockInst.visible = false;
          if (farThicketMesh) farThicketMesh.visible = false;
        } else if (!detailOn && d < LOD_NEAR) {
          detailOn = true; bushInst.visible = true; rockInst.visible = true;
          if (farThicketMesh) farThicketMesh.visible = true;
        }
      });
    })();

    // ================================================================
    //  FALLEN LOGS — a few plain meshes (small count). One is the bridge.
    // ================================================================
    const logMat = mat(0x5a4327);
    function fallenLog(x, z, len, rad, rotY, y) {
      const g = new THREE.CylinderGeometry(rad, rad * 0.85, len, 7);
      const m = new THREE.Mesh(g, logMat);
      m.rotation.z = Math.PI / 2; m.rotation.y = rotY;
      m.position.set(x, y == null ? rad : y, z);
      m.castShadow = true; m.receiveShadow = true; root.add(m);
      return m;
    }
    for (let i = 0; i < 8; i++) {
      const x = MINX + 40 + rng() * (HX * 2 - 80);
      const z = MINZ + 40 + rng() * (HZ * 2 - 80);
      // A fallen trunk is large enough to be a landmark; it must respect the
      // same reserved clearings, trails, and tree claims as every other
      // generated object rather than clipping through them.
      if (inClearing(x, z) || !claimNature(x, z, 6.5)) continue;
      fallenLog(x, z, 5 + rng() * 5, 0.35 + rng() * 0.25, rng() * 6.28);
    }

    // FALLEN-TREE BRIDGE: a big log spanning a narrow neck of the lake — a
    // shortcut a player can run across (raised, with a collider top so you
    // can stand on it). Justified traversal landmark.
    const bgX = lakeX + lakeR - 6, bgZ = lakeZ;
    const bridge = fallenLog(bgX, bgZ, 30, 0.9, 0, 1.0);
    CBZ.colliders.push({ minX: bgX - 15, maxX: bgX + 15, minZ: bgZ - 1.0, maxZ: bgZ + 1.0, y0: 0, y1: 1.9, ref: bridge });

    // ================================================================
    //  LANDMARK: LOG CABIN / RANGER STATION — enterable building.
    //  cityMakeBuilding(root, ox, oz, w, d, storeys, color, doorSide, opts).
    //  Warm timber tint, single storey, retail-style so the door is a real
    //  walk-in portal. This is the human anchor of the woods.
    // ================================================================
    const cabX = CX + 260, cabZ = CZ + 170;
    if (CBZ.cityMakeBuilding) {
      try {
        CBZ.cityMakeBuilding(root, cabX, cabZ, 16, 12, 1, 0x6e5436, "south",
          { retail: true, glassKind: "clear", facade: "retail", label: "RANGER STATION" });
      } catch (e) { /* keep biome alive if building gen rejects opts */ }
    }
    // a ranger-station sign so it reads on approach.
    if (CBZ.makeLabelSprite) {
      const sign = CBZ.makeLabelSprite("RANGER STATION");
      sign.position.set(cabX, 5.4, cabZ - 6.4);
      sign.scale.set(10, 2.4, 1);
      root.add(sign);
    }

    // ================================================================
    //  LANDMARK: LOOKOUT TOWER — four legs + a cabin on top + a REAL climb.
    //  A vista landmark. NO-DECOY FIX: this used to be pure decoration (a
    //  small ground-level collider only) despite its own header comment
    //  calling it "a vista landmark" — nothing let you actually reach the
    //  deck. Fixed with the SAME z-axis ramp-platform rig city buildings use
    //  for stairs (city/buildings.js / city/elevators.js: CBZ.platforms
    //  ramp records interpolate height along Z only — see systems/physics.js
    //  groundAt — so every flight below runs along Z, switching back on a
    //  mid-landing, exactly like the proven fire-escape rig). The deck itself
    //  is ALSO a registered platform (a real standable surface, not a
    //  decorative box), and a lookout/vista interaction fires once you're up
    //  there — the payoff the header comment promised.
    // ================================================================
    const twX = CX + 100, twZ = CZ - 210, twH = 14;
    const towerWoodA = mat(0x7a5d38), towerWoodB = mat(0x4a3a22);
    const legR = 0.35;
    [[-3, -3], [3, -3], [-3, 3], [3, 3]].forEach(function (o) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR, twH, 6), towerWoodA);
      leg.position.set(twX + o[0], twH / 2, twZ + o[1]);
      leg.castShadow = true; root.add(leg);
    });
    // deck
    const deckHalf = 4.25;
    const deck = new THREE.Mesh(CBZ.boxGeom(8.5, 0.4, 8.5), towerWoodB);
    deck.position.set(twX, twH, twZ); deck.castShadow = true; deck.receiveShadow = true; root.add(deck);
    // cabin shell on top (open-front lookout)
    const tcab = new THREE.Mesh(CBZ.boxGeom(7, 3, 7), towerWoodA);
    tcab.position.set(twX, twH + 1.7, twZ); tcab.castShadow = true; root.add(tcab);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6, 2.4, 4), mat(0x3a2c1a));
    roof.rotation.y = Math.PI / 4; roof.position.set(twX, twH + 4.4, twZ); roof.castShadow = true; root.add(roof);
    CBZ.colliders.push({ minX: twX - 4, maxX: twX + 4, minZ: twZ - 4, maxZ: twZ + 4, y0: 0, y1: 1.2 });
    if (CBZ.makeLabelSprite) {
      const ts = CBZ.makeLabelSprite("FIRE LOOKOUT");
      ts.position.set(twX, twH + 7, twZ); ts.scale.set(9, 2.2, 1); root.add(ts);
    }

    // ---- THE CLIMB: a switchback staircase up the +x face (clear of the
    // legs at ±3), two flights around a mid-landing, exactly the elevators.js
    // fire-escape idiom (tilted stringer slab + rail visual, CBZ.platforms
    // ramp records for the actual walk-surface). CBZ.platforms only exists
    // once city/buildings.js has loaded (it inits the array) — guard so a
    // headless/stripped build never throws.
    if (CBZ.platforms) {
      const railMat = mat(0x2c333d);
      const stairX0 = twX + deckHalf - 0.05, stairX1 = twX + deckHalf + 1.15;   // stringer strip, just past the deck edge
      const stairXC = (stairX0 + stairX1) / 2;
      const zA = twZ - 6.5, zB = twZ + 6.5, LD = 1.0;      // flight run bounds + landing depth (~35° slope, matches elevators.js's fire-escape feel)
      const midY = twH / 2;                                 // mid-landing height (half the climb)
      function flight(zStart, zEnd, y0, y1) {
        const dir = zEnd > zStart ? 1 : -1;
        const rampEnd = zEnd - dir * LD;
        CBZ.platforms.push({
          minX: stairX0, maxX: stairX1,
          minZ: Math.min(zStart, rampEnd), maxZ: Math.max(zStart, rampEnd),
          top: y1, ramp: { z0: zStart, z1: rampEnd, y0, y1 },
        });
        // flat landing nosing at the top of this flight
        CBZ.platforms.push({
          minX: stairX0, maxX: stairX1,
          minZ: Math.min(rampEnd, zEnd), maxZ: Math.max(rampEnd, zEnd), top: y1,
        });
        // visual: one tilted stringer slab (mesh-count bound — no per-tread boxes)
        const run = Math.abs(rampEnd - zStart), rise = y1 - y0;
        const hyp = Math.hypot(run, rise), tilt = -dir * Math.atan2(rise, run);
        const slab = new THREE.Mesh(CBZ.boxGeom(1.2, 0.1, hyp), towerWoodB);
        slab.position.set(stairXC, (y0 + y1) / 2 - 0.05, (zStart + rampEnd) / 2);
        slab.rotation.x = tilt; slab.castShadow = true; root.add(slab);
        const rail = new THREE.Mesh(CBZ.boxGeom(0.07, 0.9, hyp), railMat);
        rail.position.set(stairX1 + 0.03, (y0 + y1) / 2 + 0.4, (zStart + rampEnd) / 2);
        rail.rotation.x = tilt; root.add(rail);
      }
      // flight 1: ground -> mid-landing (rising +z), flight 2: mid-landing -> deck (rising -z)
      flight(zA, zB, 0, midY);
      flight(zB, zA, midY, twH);
      // mid-landing platform (small square where the flights meet)
      CBZ.platforms.push({ minX: stairX0, maxX: stairX1, minZ: zB - LD, maxZ: zB + LD, top: midY });
      // guard rail colliders on the outer stringer edge, y-gated above 1.6m so
      // ground-level foot traffic never snags on them (mirrors elevators.js's
      // y-gated fall-guard rail).
      CBZ.colliders.push({ minX: stairX1 - 0.05, maxX: stairX1 + 0.12, minZ: zA - LD, maxZ: zB + LD, y0: 1.6, y1: twH + 1.0 });
      // THE DECK is a real standable platform (was purely decorative before —
      // groundAt() never saw it, so the box was a visual lie). Registered flat
      // (no ramp) at the deck's walking height.
      CBZ.platforms.push({ minX: twX - deckHalf, maxX: twX + deckHalf, minZ: twZ - deckHalf, maxZ: twZ + deckHalf, top: twH + 0.2 });

      // ---- VISTA interaction: a simple lookout payoff once you're up top ----
      if (CBZ.interactions && CBZ.interactions.registerZone) {
        const vistaSpot = { x: twX, z: twZ, kind: "lookout-vista" };
        CBZ.interactions.registerZone({
          id: "forest-lookout-vista", kind: "lookout-vista", radius: deckHalf + 0.5,
          find: function (px, pz) {
            const P = CBZ.player;
            if (!P || P.pos.y < twH - 1.0) return null;        // only up on the deck, not from the ground below
            const dx = vistaSpot.x - px, dz = vistaSpot.z - pz;
            return (dx * dx + dz * dz) < (deckHalf + 0.5) * (deckHalf + 0.5) ? vistaSpot : null;
          },
          options: [{
            id: "lookout-scan", slot: "e", label: "Scan the treeline",
            onSelect: function () {
              if (CBZ.city && CBZ.city.note) CBZ.city.note("From up here the whole of Redhollow Woods spreads out below.", 2.6);
            },
          }],
        });
      }
    }

    // ================================================================
    //  CAMPSITE — tents + fire ring. Hikers stop here (gives peds a why).
    // ================================================================
    const campX = CX - 140, campZ = CZ + 100;
    function tent(x, z, col) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.6, 4), mat(col));
      body.rotation.y = Math.PI / 4; body.position.y = 1.3; body.castShadow = true;
      g.add(body);
      g.position.set(x, 0, z); g.rotation.y = rng() * 6.28; root.add(g);
    }
    tent(campX - 5, campZ - 3, 0xb5532e);
    tent(campX + 4, campZ + 4, 0x2e6db5);
    tent(campX - 2, campZ + 6, 0x4a7a32);
    // fire ring (stones) + a small flame box
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.28;
      const s = new THREE.Mesh(rockGeo, mat(0x6a6a6a));
      s.position.set(campX + Math.cos(a) * 1.5, 0.25, campZ + Math.sin(a) * 1.5);
      s.scale.setScalar(0.35); root.add(s);
    }
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.1, 6),
      new THREE.MeshLambertMaterial({ color: 0xff7a18, emissive: 0xd24400, emissiveIntensity: 1.2 }));
    fire.position.set(campX, 0.6, campZ); root.add(fire);
    if (CBZ.makeLabelSprite) {
      const cs = CBZ.makeLabelSprite("CAMP HOLLOW");
      cs.position.set(campX, 4.2, campZ); cs.scale.set(8, 2, 1); root.add(cs);
    }

    // ================================================================
    //  LIFE — hikers / hunters / rangers via cityMakePed.
    //  cityMakePed(x, z, rng, opts) -> {group, ...}; push group to root,
    //  ped to CBZ.cityPeds so the normal ped brain + interactions pick it up.
    // ================================================================
    if (CBZ.cityMakePed && CBZ.cityPeds) {
      const spawns = [
        { x: cabX + 4, z: cabZ + 8, job: "park ranger", name: "Ranger", outfit: 0x4a5a32, armed: true, weapon: "Pistol" },
        { x: cabX - 5, z: cabZ + 7, job: "park ranger", name: "Ranger", outfit: 0x4a5a32 },
        { x: campX + 3, z: campZ - 2, job: "hiker", name: "Hiker", outfit: 0xc25a2e },
        { x: campX - 3, z: campZ + 3, job: "hiker", name: "Hiker", outfit: 0x2e6db5 },
        { x: lakeX - 30, z: lakeZ + 30, job: "hunter", name: "Hunter", outfit: 0x5a4a2e, armed: true, weapon: "Shotgun", aggr: 0.55 },
        { x: CW_CX, z: MAXZ - 40, job: "hiker", name: "Hiker", outfit: 0x4a7a32 },
      ];
      for (let i = 0; i < spawns.length; i++) {
        const s = spawns[i];
        try {
          const ped = CBZ.cityMakePed(s.x, s.z, rng, {
            kind: "civilian", archetype: "resident", behavior: "wander",
            job: s.job, name: s.name, outfit: s.outfit,
            armed: !!s.armed, weapon: s.weapon || null,
            aggr: s.aggr != null ? s.aggr : 0.2, wealth: 0.18,
          });
          if (ped && ped.group) {
            root.add(ped.group);
            CBZ.cityPeds.push(ped);
            if (s.armed) ped.ammo = 24;
          }
        } catch (e) { /* a single ped failing must not kill the forest */ }
      }
    }

    // ================================================================
    //  WORK-ANCHOR — the ranger's beat: the station, then a ring of trail
    //  points (the causeway-mouth landing, a deep-woods vista, the lake
    //  shore). The aigoals brain walks rangers this loop on the schedule.
    //  WHY: the ranger keeps the trails — patrols the woods, checks the camp.
    //  Ranger station = home. Reuses the trail/landmark coords already built.
    // ================================================================
    if (CBZ.registerWorkAnchor) {
      CBZ.registerWorkAnchor({
        biome: "forest", kind: "trailhead", role: "park ranger", patrol: true,
        x: cabX, z: cabZ + 8, cap: 3,
        home: { x: cabX, z: cabZ },                        // the ranger station
        spots: [
          { x: cabX, z: cabZ + 8 },                         // the station trailhead
          { x: CW_CX, z: MAXZ - 60 },                       // the causeway-mouth landing
          { x: campX, z: campZ + 6 },                       // past the campsite
          { x: lakeX - 20, z: lakeZ - lakeR + 10 },         // the lake shore trail
        ],
      });
    }

    // ================================================================
    //  DEER — low-poly animals that WANDER (a light onUpdate drift). Cheap:
    //  a handful of tiny mesh groups, each with a slow heading-wander so the
    //  forest feels alive and hunters have prey. No physics, no colliders.
    // ================================================================
    const deer = [];
    // The shared wildlife system owns real, hittable whitetail actors. Do not
    // layer a second decorative-only herd over them; the legacy mini-deer below
    // remains solely as a fallback when that system/species is unavailable.
    const sharedDeer = !!(CBZ.cityWildlife && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.whitetail_deer);
    function makeDeer(x, z) {
      const g = new THREE.Group();
      const bodyMat = mat(0x8a5a32);
      const body = new THREE.Mesh(CBZ.boxGeom(1.6, 0.8, 0.7), bodyMat); body.position.y = 1.0; g.add(body);
      const neck = new THREE.Mesh(CBZ.boxGeom(0.4, 0.9, 0.4), bodyMat); neck.position.set(0.8, 1.45, 0); neck.rotation.z = -0.5; g.add(neck);
      const head = new THREE.Mesh(CBZ.boxGeom(0.55, 0.45, 0.4), bodyMat); head.position.set(1.15, 1.85, 0); g.add(head);
      [[-0.6, 0.25], [0.6, 0.25], [-0.6, -0.25], [0.6, -0.25]].forEach(function (o) {
        const leg = new THREE.Mesh(CBZ.boxGeom(0.18, 1.0, 0.18), bodyMat);
        leg.position.set(o[0], 0.5, o[1]); g.add(leg);
      });
      body.castShadow = head.castShadow = true;
      const heading = rng() * 6.28;
      g.position.set(x, 0, z);
      if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(g, heading); else g.rotation.y = -heading;
      root.add(g);
      deer.push({ g, heading, turnT: 0, spd: 1.2 + rng() * 1.0 });
    }
    const deerSpots = [
      [lakeX + 40, lakeZ - 30], [CX + 80, CZ - 130], [CX - 160, CZ - 50],
      [CX + 200, CZ + 50], [CX - 60, CZ + 170], [CX - 260, CZ - 210],
    ];
    if (!sharedDeer) {
      for (let i = 0; i < deerSpots.length; i++) makeDeer(deerSpots[i][0], deerSpots[i][1]);
      CBZ.cityDecorAnimals = (CBZ.cityDecorAnimals || 0) + deerSpots.length;   // audit: decorative animal count
    }

    if (CBZ.onUpdate && deer.length) {
      // WHY rng (not Math.random): owner determinism contract — every other
      // placement decision in this file already routes through the seeded
      // mulberry32 `rng` above; the deer wander loop was the one spot still
      // calling Math.random() directly, which would make deer paths differ
      // between runs of the SAME seed. Fixed to reuse the same closure-
      // captured rng so wander is deterministic like everything else here.
      CBZ.onUpdate(46.3, function (dt) {
        if (!dt || dt > 0.5) dt = 0.05;           // clamp pauses / first frame
        for (let i = 0; i < deer.length; i++) {
          const d = deer[i];
          d.turnT -= dt;
          if (d.turnT <= 0) {                      // pick a new heading occasionally
            d.heading += (rng() - 0.5) * 1.6;
            d.turnT = 2 + rng() * 4;
            d.spd = 0.8 + rng() * 1.6;
          }
          const nx = d.g.position.x + Math.cos(d.heading) * d.spd * dt;
          const nz = d.g.position.z + Math.sin(d.heading) * d.spd * dt;
          // stay inside the forest rect (turn back at the edge); avoid the lake.
          let ok = nx > MINX + 12 && nx < MAXX - 12 && nz > MINZ + 12 && nz < MAXZ - 12;
          if (ok && d2(nx, nz, lakeX, lakeZ) < (lakeR + 6) * (lakeR + 6)) ok = false;
          if (!ok) { d.heading += Math.PI * (0.6 + rng() * 0.4); continue; }
          d.g.position.x = nx; d.g.position.z = nz;
          if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(d.g, d.heading); else d.g.rotation.y = -d.heading;
        }
      });
    }
  }, 32);
})();
