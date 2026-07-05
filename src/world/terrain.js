/* ============================================================
   world/terrain.js — PROCEDURAL BACKDROP TERRAIN.

   The whole playable archipelago (city + 3 islands + 4 biomes +
   every causeway) is a FLAT plane at y=0 by contract — cars, NPCs,
   buildings and spawns all assume it. This file does NOT touch that.
   It paints a DRAMATIC snow-capped mountain range + rolling hills in
   the FAR BACKDROP RING that encircles the map, so the horizon stops
   being flat sea-into-fog and becomes a real landscape you look out
   AT but never walk on.

   HOW IT STAYS SAFE (owner's untested-ship rule):
     CBZ.terrainHeight(x,z) returns EXACTLY 0 over a generous flat
     region (cityFalloff == 0) that encloses every walkable footprint
     plus a ~150u margin. Relief only switches on past that ring. So
     CBZ.floorAt (which world.js routes to terrainHeight) is byte-for-
     byte 0 anywhere a person or vehicle can actually be — physics is
     unchanged, nothing can fall off a hill.

   DRAW CALLS (engine is draw-call bound, ~1000 NPCs):
     • ONE big non-indexed PlaneGeometry mesh carries the entire relief
       field with per-vertex height-band vertex colours (sea→sand→grass
       →rock→snow), flat-shaded for crisp facets = 1 draw call.
     • A handful of hand-placed HERO PEAKS (rock cones + snow caps) are
       merged via BufferGeometryUtils into ONE mesh = 1 draw call.
     Total backdrop cost: 2 draw calls. frustumCulled=false so the ring
     never pops as the camera turns.

   Analytic + allocation-free: terrainHeight/terrainNormal are pure math
   (no per-call allocation) because they're sampled per-vertex at build
   AND potentially per floorAt() query.

   Gated behind CBZ.PROC_TERRAIN (default ON). Set CBZ.PROC_TERRAIN=false
   before world build to disable entirely (terrainHeight then absent →
   world.js falls back to flat 0).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (!window.noise) { /* noise.js must load first */ }

  // ----------------------------------------------------------------------
  //  SEED — fixed constant (deterministic world, matching the repo style).
  // ----------------------------------------------------------------------
  // derived from the one world-seed knob (core/seed.js); 1337 is the legacy
  // fallback so a partial load without seed.js still builds the same backdrop.
  const SEED = (window.CBZ && CBZ.hashN) ? (CBZ.hashN(1337) % 65536) : 1337;
  if (window.noise && window.noise.seed) window.noise.seed(SEED);

  // ----------------------------------------------------------------------
  //  THE FLAT (PLAYABLE) REGION — the union AABB of every walkable
  //  footprint registered in the archipelago, padded by a generous margin.
  //  Computed from:
  //    city mainland ......... ~ x[-176,176]  z[-876,524-]  (centre 0,-700)
  //    commerce annex ........ x[228,469]      z[-820,-580]
  //    speedway island ....... x[270,670]      z[-530,-130]
  //    airport island ........ x[-370,290]     z[-280,40]
  //    military island ....... x[-860,-380]    z[-950,-450]
  //    desert biome .......... x[670,1560]     z[-320,620]   (MASSIVE south basin)
  //    forest biome .......... x[-950,-170]    z[-1680,-1020]
  //    farmland biome ........ x[780,1580]     z[-1280,-480]
  //    snow biome ............ x[-70,770]      z[-1780,-1120]
  //    + every causeway between them.
  //  Union: x[-960,1580]  z[-1790,760].  We KEEP IT FLAT generously —
  //  when unsure, flat wins (owner rule). Margin pushes the relief ring
  //  well clear of anywhere anyone can stand. maxZ was pushed 290→760 to
  //  hold the enlarged desert basin; the backdrop rings sit at radius
  //  1900-2380 from the field centre so the south flat edge (z760, ~1510
  //  from centre) stays well clear of them.
  // ----------------------------------------------------------------------
  const FLAT = { minX: -960, maxX: 1580, minZ: -1790, maxZ: 760 };
  const MARGIN = 150;        // dead-flat for this much PAST the union edge
  const RAMP = 460;          // smoothstep distance from flat edge → full relief

  // expose the flat extents for tooling / other agents
  CBZ.TERRAIN_FLAT = FLAT;

  // ----------------------------------------------------------------------
  //  ANALYTIC NOISE FIELD — all pure functions, zero allocation.
  // ----------------------------------------------------------------------
  function s2(x, z) { return window.noise ? window.noise.simplex2(x, z) : 0; }

  // smoothstep(0..1)
  function smooth(e0, e1, x) {
    if (e1 === e0) return x < e0 ? 0 : 1;
    let t = (x - e0) / (e1 - e0);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  // signed-ish distance from a point to the FLAT rectangle: 0 inside,
  // grows positive as you move away (Chebyshev/box distance to the rect).
  function distOutsideFlat(x, z) {
    const dx = Math.max(FLAT.minX - x, 0, x - FLAT.maxX);
    const dz = Math.max(FLAT.minZ - z, 0, z - FLAT.maxZ);
    // Euclidean box distance (rounds the corners — no hard square ridge).
    return Math.sqrt(dx * dx + dz * dz);
  }

  // cityFalloff: 0 across the whole playable region (+ margin), smoothly
  // rising to 1 only in the far ring. EXACTLY 0 inside flat → relief can't
  // leak under anyone.
  CBZ.terrainFalloff = function (x, z) {
    const d = distOutsideFlat(x, z);
    if (d <= MARGIN) return 0;
    return smooth(MARGIN, MARGIN + RAMP, d);
  };

  // fractal Brownian motion — rolling hills (4 octaves, analytic).
  const HILL_AMP = 46;       // hill relief amplitude (u)
  const HILL_FREQ = 1 / 620; // base wavelength (~620u features)
  function fbm(x, z) {
    let f = HILL_FREQ, a = 0.5, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) {
      sum += a * s2(x * f + o * 13.7, z * f - o * 7.3);
      norm += a;
      f *= 2.03; a *= 0.5;
    }
    return (sum / norm) * HILL_AMP;
  }

  // ridged multifractal — sharp mountain crests for the OUTER band only.
  const RIDGE_AMP = 150;       // peak height contribution (u) → ~150u peaks (raised so foothills cap white)
  const RIDGE_FREQ = 1 / 900;  // big mountain wavelength
  function ridged(x, z) {
    let f = RIDGE_FREQ, a = 1.0, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) {
      let n = s2(x * f - o * 21.1, z * f + o * 17.9);
      n = 1 - Math.abs(n);       // crease → ridge
      n = n * n;                 // sharpen
      sum += a * n;
      norm += a;
      f *= 2.07; a *= 0.5;
    }
    return (sum / norm) * RIDGE_AMP;
  }

  // the OUTER mountain band: ridges only really kick in further out than the
  // hills, so you get rolling foothills first, then a dramatic peak wall.
  function mountainMask(x, z) {
    const d = distOutsideFlat(x, z);
    // foothills start ~at the ramp, big peaks ~RAMP further still.
    return smooth(MARGIN + RAMP * 0.6, MARGIN + RAMP * 2.2, d);
  }

  // ----------------------------------------------------------------------
  //  THE ORACLE — CBZ.terrainHeight(x,z). Returns 0 over the flat region.
  // ----------------------------------------------------------------------
  CBZ.terrainHeight = function (x, z) {
    const fo = CBZ.terrainFalloff(x, z);
    if (fo <= 0) return 0;                 // dead flat — physics-safe
    const hills = fbm(x, z);
    const mtn = ridged(x, z) * mountainMask(x, z);
    return (hills + mtn) * fo;
  };

  // central-difference normal (for slope keep-outs / the nature agent).
  const _EPS = 2.0;
  CBZ.terrainNormal = function (x, z, out) {
    out = out || new THREE.Vector3();
    const hL = CBZ.terrainHeight(x - _EPS, z), hR = CBZ.terrainHeight(x + _EPS, z);
    const hD = CBZ.terrainHeight(x, z - _EPS), hU = CBZ.terrainHeight(x, z + _EPS);
    out.set(hL - hR, 2 * _EPS, hD - hU).normalize();
    return out;
  };

  // ----------------------------------------------------------------------
  //  HEIGHT-BAND COLOUR — pick a vertex colour from elevation.
  // ----------------------------------------------------------------------
  const COL_WATER = new THREE.Color(0x2f6f9e);  // matches the sea plane tone
  const COL_SAND  = new THREE.Color(0xc8b385);
  const COL_GRASS = new THREE.Color(0x4f7d3f);
  const COL_GRASS2= new THREE.Color(0x3c6a33);
  const COL_ROCK  = new THREE.Color(0x6f6a63);
  const COL_ROCKH = new THREE.Color(0x8a8378);
  const COL_SNOW  = new THREE.Color(0xeef3f8);
  const _c = new THREE.Color();
  function bandColor(y, slope, out) {
    // slope (0 flat .. 1 vertical-ish) darkens grass toward rock on steeps.
    if (y < 0.5) { out.copy(COL_WATER); return; }
    if (y < 6)   { out.copy(COL_SAND).lerp(COL_GRASS, smooth(2, 6, y)); return; }
    if (y < 30)  {
      out.copy(COL_GRASS).lerp(COL_GRASS2, smooth(8, 28, y));
      if (slope > 0.45) out.lerp(COL_ROCK, smooth(0.45, 0.8, slope));
      return;
    }
    if (y < 52)  {
      out.copy(COL_ROCK).lerp(COL_ROCKH, smooth(30, 50, y));
      // snow starts creeping onto flatter high ground (snowline lowered)
      if (slope < 0.6) out.lerp(COL_SNOW, smooth(34, 54, y) * (1 - slope));
      return;
    }
    // high peaks: snow, except the steepest faces stay bare rock.
    out.copy(COL_SNOW);
    if (slope > 0.7) out.lerp(COL_ROCKH, smooth(0.7, 1.0, slope));
  }

  // ----------------------------------------------------------------------
  //  BUILD — ONE relief mesh + ONE merged hero-peaks mesh. Called by
  //  world.js at city-build time (guarded). Idempotent.
  // ----------------------------------------------------------------------
  let _built = null;
  CBZ.buildTerrain = function (parent) {
    if (CBZ.PROC_TERRAIN === false) return null;     // gate (default ON)
    if (_built) return _built;
    if (!window.noise) { console.warn("[terrain] window.noise missing — skipped"); return null; }
    window.noise.seed(SEED);

    const root = parent || CBZ.scene;
    if (!root) return null;

    // --- 1) the big relief field --------------------------------------
    // PERF: this used to be ONE 6000×6000 mesh at 280×280 segments —
    // ~157k flat-shaded triangles (~470k de-indexed verts) with
    // frustumCulled=false, so the ENTIRE relief was vertex-processed
    // every frame no matter where the camera looked. It's now a 4×4 grid
    // of tiles with the SAME vertex spacing (1500/70 == 6000/280 → the
    // geometry is byte-identical where tiles meet, flat shading keeps
    // per-face normals so there is no seam), each with a real bounding
    // sphere and default frustum culling: looking down a street submits
    // ~a third of the verts the monolith did, for +15 draw calls.
    const SPAN = 6000, TILES = 4, TSPAN = SPAN / TILES, TSEG = 70; // 4×(70·4)=280 → same density
    // centre the field over the archipelago (the sea plane sits ~(150,-900)).
    const CX = (FLAT.minX + FLAT.maxX) / 2;   // ~310
    const CZ = (FLAT.minZ + FLAT.maxZ) / 2;   // ~-750

    const terrMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const terrainTiles = [];
    for (let tj = 0; tj < TILES; tj++) for (let ti = 0; ti < TILES; ti++) {
      const tcx = CX - SPAN / 2 + (ti + 0.5) * TSPAN;
      const tcz = CZ - SPAN / 2 + (tj + 0.5) * TSPAN;
      const geo = new THREE.PlaneGeometry(TSPAN, TSPAN, TSEG, TSEG);
      // lay it flat in XZ and centre this tile.
      geo.rotateX(-Math.PI / 2);
      geo.translate(tcx, 0, tcz);

      const pos = geo.attributes.position;
      const vcount = pos.count;
      // displace every vertex by terrainHeight (same sampler as before —
      // shared edges get identical heights on both tiles).
      for (let i = 0; i < vcount; i++) {
        pos.setY(i, CBZ.terrainHeight(pos.getX(i), pos.getZ(i)));
      }
      pos.needsUpdate = true;

      // flat-shaded crisp facets: drop the index so each tri owns its verts,
      // then recompute per-face normals.
      const flatGeo = geo.toNonIndexed();
      flatGeo.computeVertexNormals();

      // colour per (now de-indexed) vertex from its height + local slope.
      const fp = flatGeo.attributes.position;
      const fn = flatGeo.attributes.normal;
      const fcount = fp.count;
      const fcolors = new Float32Array(fcount * 3);
      for (let i = 0; i < fcount; i++) {
        const y = fp.getY(i);
        // slope from the face normal (1 = flat-up, 0 = vertical) → invert.
        const ny = fn.getY(i);
        const slope = 1 - Math.min(1, Math.max(0, ny));
        bandColor(y, slope, _c);
        fcolors[i * 3] = _c.r; fcolors[i * 3 + 1] = _c.g; fcolors[i * 3 + 2] = _c.b;
      }
      flatGeo.setAttribute("color", new THREE.BufferAttribute(fcolors, 3));
      geo.dispose();   // the indexed source is no longer needed
      flatGeo.computeBoundingSphere();       // real bounds → frustum culling works

      const tile = new THREE.Mesh(flatGeo, terrMat);
      // The relief is coincident with the city ground plane at y=0 across the
      // flat region (both are exactly 0 there). Nudge the WHOLE relief down a
      // hair so the city's textured ground always wins the depth fight; the
      // far ring (where it actually rises) is unaffected at any visible scale.
      tile.position.y = -0.06;
      tile.receiveShadow = true;
      tile.castShadow = false;
      tile.matrixAutoUpdate = false; tile.updateMatrix();
      tile.userData.terrain = true;          // spares it from batch + farcull
      root.add(tile);
      terrainTiles.push(tile);
    }
    const terrain = terrainTiles[0];         // legacy return value (first tile)

    // --- 2) HERO PEAKS — a dramatic snow-capped MOUNTAIN RANGE in the
    //        backdrop ring, merged into ONE mesh. These are pure backdrop,
    //        placed well OUTSIDE the flat region (radius ~1850-2300) so they
    //        tower on the skyline without ever being reachable — NO valleyGuard
    //        and the playable floor (terrainHeight over the flat region) is
    //        untouched. Technique + math are the SHARED window.noise.buildRidgedRange
    //        helper (src/vendor/noise.js) — the exact same ridged-fbm + altitude/
    //        slope vertex shading city/biome_snow.js's range uses (consolidated
    //        so the two can't silently drift apart), with a far-distance fog
    //        desaturation baked into the vertex colors via the palette.fog term
    //        so the peaks recede (a feature only this caller uses).
    const BGU = THREE.BufferGeometryUtils;
    const buildRidge = window.noise && window.noise.buildRidgedRange;

    // -- palette (rock / ragged snow / cliff + this caller's distance haze) -
    const heroPalette = {
      rock: new THREE.Color(0x6f6a63),
      rockDark: new THREE.Color(0x4a463f),
      snow: new THREE.Color(0xeef3f8),
      snowShade: new THREE.Color(0xd6e0ea),
      fog: new THREE.Color(0x9fb4c4),   // distance haze tint (sky/sea-ish)
    };

    // -- RANGE LAYOUT: ridge spines on the backdrop ring (radius ~1850-2300
    //    around the field centre). Each spine is an arc segment; depthDir
    //    points radially outward. A near foreground ring + a taller, farther
    //    (foggier) backdrop ring give layered depth.
    const RING_SEG = 9;            // arc segments around the ring
    const heroGeoms = [];
    const heroSpines = [];         // crest sample arrays [{x,z,h}, ...] per segment — reused below for rock scatter candidates
    function ringSpines(radius, span, cfg, fogBase, fogDepth) {
      if (!buildRidge) return;
      for (let i = 0; i < RING_SEG; i++) {
        const a0 = (i / RING_SEG) * Math.PI * 2;
        const a1 = ((i + span) / RING_SEG) * Math.PI * 2;
        const p0 = { x: CX + Math.cos(a0) * radius, z: CZ + Math.sin(a0) * radius };
        const p1 = { x: CX + Math.cos(a1) * radius, z: CZ + Math.sin(a1) * radius };
        // outward radial direction at the segment midpoint
        const am = (a0 + a1) / 2;
        const dir = { x: Math.cos(am), z: Math.sin(am) };
        const c = Object.assign({}, cfg, {
          seedOff: cfg.seedBase + i * 137.1,
          fogBase: fogBase, fogDepth: fogDepth,
          // taper the front edge to the ground so the range meets the relief
          // field smoothly (NO valleyGuard needed — pure backdrop, far out).
          footGuard: 0.18,
          palette: heroPalette,
        });
        const built = buildRidge(THREE, p0, p1, dir, c);
        if (built) { heroGeoms.push(built.geo); if (built.spine) heroSpines.push(built.spine); }
      }
    }
    // near ring — the dominant craggy peaks
    ringSpines(1900, 1.04, {
      cols: 40, rows: 7, depthLen: 280, peakAmp: 360, noiseScale: 0.0055, seedBase: 1000,
    }, 0.04, 0.10);
    // far ring — taller, pushed out, hazier (recedes into the sky)
    ringSpines(2250, 1.04, {
      cols: 38, rows: 5, depthLen: 360, peakAmp: 470, noiseScale: 0.0045, seedBase: 5000,
    }, 0.22, 0.22);

    // ====================================================================
    //  MOUNT COLOSSUS — the ONE super-super-tall signature mountain. A single
    //  narrow spine with a MASSIVE peakAmp (~2x the far ring) placed due north,
    //  so a lone snow-capped titan looms over the whole range and the snow
    //  country beneath it. Pure backdrop like every other peak — you look AT
    //  it, never on it (terrainHeight stays 0 over all walkable ground).
    // ====================================================================
    //  A shared helper so both signature titans are built the RIGHT way — the
    //  ring code passes (THREE, p0, p1, dir, cfg) and reads .geo/.spine; the
    //  old Colossus block dropped the THREE arg and the palette and pushed the
    //  raw {geo,spine} object, which threw a TypeError inside an un-guarded IIFE
    //  and silently killed EVERY hero peak + the boulder scatter (world went
    //  flat-backdrop-only). This routes both through buildRidge correctly.
    function heroPeak(name, bearing, R, half, cfg) {
      if (!buildRidge) return;
      const cx0 = CX + Math.cos(bearing) * R, cz0 = CZ + Math.sin(bearing) * R;
      const perp = { x: -Math.sin(bearing), z: Math.cos(bearing) };
      const p0 = { x: cx0 - perp.x * half, z: cz0 - perp.z * half };
      const p1 = { x: cx0 + perp.x * half, z: cz0 + perp.z * half };
      const dir = { x: Math.cos(bearing), z: Math.sin(bearing) };
      const built = buildRidge(THREE, p0, p1, dir, Object.assign({
        footGuard: 0.16, palette: heroPalette,
      }, cfg));
      if (built) { heroGeoms.push(built.geo); if (built.spine) heroSpines.push(built.spine); }
      return { x: cx0, z: cz0, height: cfg.peakAmp };
    }

    // ====================================================================
    //  MOUNT COLOSSUS — the original narrow snow-capped titan, due north.
    // ====================================================================
    {
      const c = heroPeak("Mount Colossus", -Math.PI / 2, 2050, 150, {
        cols: 28, rows: 9, depthLen: 560, peakAmp: 1050, noiseScale: 0.006,
        seedOff: 90210, fogBase: 0.10, fogDepth: 0.12,
      });
      CBZ.MOUNT_COLOSSUS = { name: "Mount Colossus", x: c.x, z: c.z, height: c.height };
    }

    // ====================================================================
    //  MOUNT EVEREST — the ROOF OF THE WORLD. Taller than Colossus (peakAmp
    //  1500 vs 1050) and set on a WIDE footprint so its shoulders read as a
    //  true Himalayan massif, not a lone spire. Placed north-north-east so it
    //  and Colossus both loom on the skyline as two distinct giants instead of
    //  overlapping. Snowline is shared (45% of peak) → a huge white summit that
    //  towers over everything. Pure backdrop — walkable ground stays y=0.
    // ====================================================================
    {
      const e = heroPeak("Mount Everest", -Math.PI / 2 + 0.62, 2380, 360, {
        cols: 52, rows: 11, depthLen: 820, peakAmp: 1500, noiseScale: 0.0048,
        seedOff: 29029, fogBase: 0.12, fogDepth: 0.16,
      });
      CBZ.MOUNT_EVEREST = { name: "Mount Everest", x: e.x, z: e.z, height: e.height };
    }

    const heroMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    // PERF: the spines used to be merged into ONE frustumCulled=false mesh —
    // the whole 360° mountain ring was vertex-processed every frame. Each
    // spine is now its OWN mesh with a real bounding sphere: the ridges
    // behind the camera cull away (same pixels on screen, ~20 extra draw
    // calls, most of the ring's verts skipped whenever you aren't panning).
    const heroMeshes = [];
    function addHeroSpines(geoms) {
      for (const g of geoms) {
        g.computeVertexNormals();                // crisp flat facets w/ flatShading
        g.computeBoundingSphere();               // real bounds → frustum culling works
        const m = new THREE.Mesh(g, heroMat);
        m.castShadow = false; m.receiveShadow = true;
        m.matrixAutoUpdate = false; m.updateMatrix();
        m.userData.terrain = true;
        root.add(m);
        heroMeshes.push(m);
      }
    }
    addHeroSpines(heroGeoms);

    // --- 3) BOULDER SCATTER — a modest field of fractured rocks (world/
    //        rockscliffs.js) dressing the mountain ring's slopes. WHY: the
    //        hero-peak facets alone read as a smooth folded surface; a
    //        scatter of chipped boulders sitting IN the slope (not glued on
    //        top) sells "this is a real rockfall-strewn mountainside" from
    //        the vantage points the player actually sees it from (city
    //        edges looking out). Candidates are drawn from the ridge
    //        spine samples every ringSpines() call already computed (free —
    //        no extra sampling pass), jittered around each spine point so
    //        rocks scatter near the crest instead of sitting in a dead-
    //        straight line. Slope-aware exclusion (scatterRocks' angle-of-
    //        repose cutoff) throws out anything on a cliff face too steep to
    //        hold a loose rock — using THIS file's own terrainNormal, so the
    //        scatter always agrees with the actual relief mesh it sits on.
    //        Pure backdrop: every candidate is already outside the flat
    //        playable region (spine points come from the ring layout, which
    //        starts at radius ~1900) — nothing here can land on walkable
    //        ground. One extra InstancedMesh cluster (a couple variants),
    //        not a new draw-call category.
    if (CBZ.scatterRocks) {
      // gather every spine sample from both rings as jittered candidates —
      // reuses the ridge builder's own crest data instead of re-deriving it.
      const spinePts = [];
      for (const g of heroSpines) {
        for (const s of g) spinePts.push(s);
      }
      if (spinePts.length) {
        function pickNearSpine(rng) {
          const p = spinePts[(rng() * spinePts.length) | 0];
          if (!p) return null;
          // jitter around the crest sample so rocks don't line up in a row
          return { x: p.x + (rng() - 0.5) * 90, z: p.z + (rng() - 0.5) * 90 };
        }
        const scat = CBZ.scatterRocks(root, {
          count: 90,
          pick: pickNearSpine,
          heightAt: CBZ.terrainHeight,
          normalAt: CBZ.terrainNormal,
          repeatAngleDeg: 38,             // angle of repose — matches the requested 35-40deg band
          minSize: 3, maxSize: 9,          // mountain-scale boulders, bigger than desert clutter
          baseRadius: 1, detail: 1,
          variants: 3,
          colorHex: 0x716b60,             // dark weathered granite, close to terrain's COL_ROCK band
          seed: 4242,
        });
        if (scat && scat.meshes) for (const m of scat.meshes) heroMeshes.push(m);
      }
    }

    // ---- perf/quality tier gate -----------------------------------------
    // At tiers 0-1 the city fog is pulled in to ~170-260u (core/quality.js)
    // while the mountain ring starts at radius ~1900: every hero peak +
    // boulder is 100% fog-dissolved — invisible — yet still costs its full
    // vertex/raster pass. Hide them outright there; tiers 2-4 (fog ≥ 350)
    // keep today's skyline byte-identical. Shadow RECEIVE on the relief is
    // also dropped at tiers 0-1 (the shadow pass is off/minimal there
    // anyway) — one material flip for all tiles, not per-mesh churn.
    function applyTerrainTier() {
      const q = CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel;
      const showBackdrop = q >= 2;
      for (const m of heroMeshes) m.visible = showBackdrop;
      const recv = q >= 2;
      if (terrMat.userData._recv !== recv) {
        terrMat.userData._recv = recv;
        for (const t of terrainTiles) t.receiveShadow = recv;
        for (const m of heroMeshes) if (m.receiveShadow !== undefined && !m.isInstancedMesh) m.receiveShadow = recv;
        terrMat.needsUpdate = true; heroMat.needsUpdate = true;
      }
    }
    if (CBZ.onQualityChange) CBZ.onQualityChange(applyTerrainTier);

    _built = terrain;
    return terrain;
  };
})();
