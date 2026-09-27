/* ============================================================
   city/world.js — the GTA-style open CITY map.

   A bright low-poly downtown built FAR from the prison and the
   disaster island (z≈-700) so all three worlds coexist with zero
   refactor: an escape/survival match never sees it, a city match
   teleports here. Everything lives in one group (city.root) so the
   other modes just hide it.

   This file lays the FOUNDATION only — the street grid (drawn as ONE
   solved cross-section by city/streetkit.js: asphalt, rounded kerbs,
   footways, ramps, markings; the city floor reads the same surface),
   and the descriptor (lots / roads / intersections / waypoint
   helpers + the DISTRICT personality field: density-weighted spawn
   pickers so downtown is packed and the docks are quiet BY DESIGN —
   crime pacing needs busy and dead streets) that the rest of the city
   is built on. Buildings, the
   connected island district, shops, props and traffic lights are added
   by sibling modules through the hooks at the end of buildCity().

   WHY the coast + ground identity (this pass): the map edge used to be
   raw void — now ONE huge day/night-tinted sea plane sits under city +
   island so every edge reads as coastline, the bridge gap carries real
   moored vehicles rather than prop hulls, and the GROUND tells
   you where the money is without a map: grass yards (the island's own
   checker) in residential/projects, poured plazas downtown, work-yard
   dirt in industrial, raised medians on the two avenues, painted turn
   arrows through the Midtown core, red fire kerbs at hydrants.

   CBZ.buildCity() builds once and returns the city descriptor.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;

  let city = null;

  // deterministic RNG so the city is the same each run (learnable streets).
  // The stream derives from the ONE world-seed knob (core/seed.js) — change
  // CBZ.CONFIG.WORLD_SEED and every layer of the world re-rolls coherently.
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream("world") : (function () { let s = 90210; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();

  CBZ.buildCity = function () {
    if (city) return city;
    // loading-meter checkpoints (systems/bootprogress.js) — AFTER the memo
    // guard: a cached call is free and must not report a build step.
    if (CBZ.bootStep) CBZ.bootStep("city:core");
    armRng();
    const C = CBZ.CITY;
    const cx = C.center.x, cz = C.center.z;
    const N = C.blocks, BLK = C.block, ROAD = C.road;
    const step = BLK + ROAD;
    const half = (N * step) / 2;

    const root = new THREE.Group();
    CBZ.scene.add(root);

    // grid road centre-lines (N+1 lines bounding N blocks, both axes)
    const xLines = [], zLines = [];
    for (let k = 0; k <= N; k++) { xLines.push(cx - half + k * step); zLines.push(cz - half + k * step); }
    const minX = xLines[0] - ROAD / 2, maxX = xLines[N] + ROAD / 2;
    const minZ = zLines[0] - ROAD / 2, maxZ = zLines[N] + ROAD / 2;
    const spanX = maxX - minX, spanZ = maxZ - minZ;

    // PHOTO LAYER: when assets/textures/*.jpg exist, draw the photo into an
    // existing procedural canvas texture, then let `after` re-tint it so the
    // game palette survives the photo grain. Missing file / tainted canvas →
    // the procedural pattern simply stays. Full fallback, no error path.
    function photoLayer(tex, url, after) {
      if (!tex || !tex.image || !tex.image.getContext) return;
      const img = new Image();
      img.onload = function () {
        try {
          const c = tex.image, g2 = c.getContext("2d");
          g2.drawImage(img, 0, 0, c.width, c.height);
          if (after) after(g2, c);
          tex.magFilter = THREE.LinearFilter;
          tex.needsUpdate = true;
        } catch (e) { /* keep the procedural fallback */ }
      };
      img.src = url;
    }

    // ---- ground: the whole street layer (road, harbour apron, kerbs,
    //      footways, markings, lot pads) is ONE solved cross-section built by
    //      city/streetkit.js further down, once the lots exist. There is no
    //      base plane under the grid any more: nothing lies under the road to
    //      fight it for depth from the air. ----

    // ---- THE SEA: one giant water plane under city + island, so every map
    //      edge reads as COASTLINE instead of void (the perimeter wall becomes
    //      a seawall; the east bridge crosses a real harbor). ONE Lambert
    //      material with fog:true so the horizon melts into the daynight fog;
    //      its colour is lerped per-frame from the daynight cycle — a single
    //      material write, effectively free. It deliberately shares the island
    //      ocean's exact colour/shadow flags (expansion.js) so the batch pass
    //      folds both planes into one mesh still driven by THIS material. ----
    const seaMat = new THREE.MeshLambertMaterial({ color: 0x2f6f9e, fog: true });
    // ---- SEA OVERHAUL (flagged): the flat single-color plane becomes a
    //      segmented, vertex-tinted, gently animated sea (built at the END of
    //      buildCity, once every landmass has registered, so the depth tint
    //      can be baked from real distance-to-land). seaMat stays alive as
    //      the day/night colour master — expansion.js's island ocean plane
    //      still shares it, and the new sea copies its colour every frame.
    //      Revert: CBZ.CONFIG.SEA_OVERHAUL = false (old plane returns). ----
    const CFGW = (CBZ.CONFIG = CBZ.CONFIG || {});
    if (CFGW.SEA_OVERHAUL == null) CFGW.SEA_OVERHAUL = true;
    // SEA_HORIZON_FUSE — the far sea converges on the live fog colour before
    // the flight far plane clips the disc, closing the hard sea/sky edge seen
    // from any altitude. `?cfg_SEA_HORIZON_FUSE=0` reverts.
    if (CFGW.SEA_HORIZON_FUSE == null) CFGW.SEA_HORIZON_FUSE = true;
    const SEA_Y = -0.48;                 // mean surface (three swells ride ±0.355)
    CBZ.SEA_Y = SEA_Y;                   // single source of truth for tooling
    // Publish the actual rendered sea footprint before cityWorldGeo runs.
    // Wildlife is built inside that pass, before the sea mesh itself is added,
    // and must never fall back to a pre-expansion hard-coded ocean coordinate.
    // Keep the sole ocean mesh beyond the longest city camera frustum. The old
    // 7km square ended inside aircraft sight range, so its hard edge exposed
    // the fog-coloured background and read as a second, flat kind of water.
    // WORLD_SCALE_V4: the 16000 was measured against a world whose plate
    // reached x +-6100; a plate that outgrows this record gets land the water
    // system does not know is coastline. world/layout.js derives the span from
    // the FLAT rect it also derives (see CBZ.WORLD_SEA_SPAN there) — the
    // literal stays as the degrade-safe fallback, so a build without layout.js
    // (or with the flag off) is byte-identical. Costs nothing: the rendered
    // ocean is a camera-centred disc (world/water_spec.js), so this sizes the
    // published BOUNDS record and the geometry's bounding box, not a mesh.
    const SEA_WORLD_SPAN = CFGW.SEA_OVERHAUL !== false
      ? (CBZ.WORLD_SEA_SPAN || 16000) : 12000;
    const SEA_WORLD_CX = CFGW.SEA_OVERHAUL !== false ? 310 : cx + 150;
    const SEA_WORLD_CZ = CFGW.SEA_OVERHAUL !== false ? -750 : cz - 200;
    CBZ.SEA_WORLD_BOUNDS = {
      minX: SEA_WORLD_CX - SEA_WORLD_SPAN / 2,
      maxX: SEA_WORLD_CX + SEA_WORLD_SPAN / 2,
      minZ: SEA_WORLD_CZ - SEA_WORLD_SPAN / 2,
      maxZ: SEA_WORLD_CZ + SEA_WORLD_SPAN / 2,
    };
    let seaMat2 = null;                  // the animated sea material (below)
    let seaUniforms = null;              // its LIVE uniform block (by reference)
    if (CFGW.SEA_OVERHAUL === false) {
      // legacy path: one giant flat plane, widened to 6200 so the whole
      // archipelago sits ON open water, not past the plane's edge.
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(6200, 6200), seaMat);
      sea.rotation.x = -Math.PI / 2; sea.position.set(cx + 150, -0.5, cz - 200);
      sea.receiveShadow = false; root.add(sea);
    }
    // THE BODY COLOUR OF THE OPEN SEA (owner's coastal reference, 2026-08-03).
    // 0x0d3b58 was a NAVY: blue channel nearly half again the green, which is
    // the colour of a swimming pool photographed through a grey sky, not of
    // cold northern ocean. The reference is a deep, saturated TEAL — green and
    // blue within a few percent of each other, with the green ahead of the blue
    // in sunlight — and it has to stay dark enough that the near field reads
    // opaque. Night keeps the same hue relationship at a tenth the luminance;
    // dusk is a mauve wash and is unchanged. water_spec.js publishes these so
    // the shader sea, the planar mirror and anything else asking "what colour
    // is the sea" read one table (degrade-safe: the literals stay as fallback).
    // (The fallbacks are the ORIGINAL navy: a build where water_spec.js failed
    // to load renders exactly the sea that shipped before this pass.)
    const TONES = CBZ.WATER_TONES || {};
    const seaDay = new THREE.Color(TONES.day != null ? TONES.day : 0x0d3b58),
      seaNight = new THREE.Color(TONES.night != null ? TONES.night : 0x04131d),
      seaDusk = new THREE.Color(TONES.dusk != null ? TONES.dusk : 0x34364d);
    // THE SEA WAS FROZEN. This block used to write the wave clock into a local
    // `seaTimeU` object and scroll `seaNormalTex.offset` — but the material's
    // uniforms had been built with THREE.UniformsUtils.merge(), and r128's
    // cloneUniforms() rebuilds every uniform object and CLONES every texture.
    // Both references were therefore severed at construction: uSeaTime stayed
    // 0.0 for the whole session and the ripple map never moved a pixel, so the
    // "animated" ocean was a still photograph of one instant of wave noise.
    // The uniform block below is now attached BY REFERENCE (see buildSea), and
    // world/water_spec.js's shared driver advances the clock, the sun vector
    // and the weather-driven chop for BOTH sea surfaces from one place.
    CBZ.onAlways(93, function () {
      if (!root.visible) return;                 // city hidden → other modes untouched
      const k = CBZ.dayness != null ? CBZ.dayness : 1;
      seaMat.color.copy(seaNight).lerp(seaDay, k);
      if (CBZ.duskness) seaMat.color.lerp(seaDusk, CBZ.duskness * 0.5);
      if (seaMat2) {
        // the animated sea follows the same day/night tone (one colour copy;
        // seaMat2.color IS the uSeaColor uniform value, aliased below)
        seaMat2.color.copy(seaMat.color);
        if (CBZ.waterDriveCommonUniforms) CBZ.waterDriveCommonUniforms(seaUniforms);
      }
    });

    // ---- roads: the drivable centre-line records every system reads ----
    // (traffic, props, roadrules junctions, approach, minimap...). The
    // DRAWN street comes from city/streetkit.js below; these records keep
    // their historical shape. `grid: true` is additive: it tells
    // props.js's junction pass that the kit already drew these corners.
    const roads = [];     // {x,z,vertical,len,w[,avenue,lanesPerDir,laneW],grid}
    const TRAF = (C.traf) || {};
    const lanesPerDir = Math.max(1, (TRAF.lanesPerDir != null ? TRAF.lanesPerDir : 2) | 0);
    const laneW = (TRAF.laneW != null ? TRAF.laneW : 3.6);
    // ---- THE TWO ARTERIAL AVENUES (xLines[2]/xLines[4]) ----------------------
    // Same four 3.6 m travel lanes as every street (the traffic contract), plus
    // a raised 0.7 m median and a double yellow each side of it: the avenue's
    // hierarchy cue. Stamped onto the two road records (avenue:true).
    const AVENUE_LINES = [2, 4];
    function isAvenueLine(i) { return AVENUE_LINES.indexOf(i) >= 0; }
    const AVE_LANES = lanesPerDir, AVE_LANEW = laneW, AVE_MEDIAN = 0.7;
    xLines.forEach((x, i) => {              // avenues (run along z)
      const seg = { x, z: (minZ + maxZ) / 2, vertical: true, len: spanZ, w: ROAD, grid: true };
      if (isAvenueLine(i)) { seg.avenue = true; seg.lanesPerDir = AVE_LANES; seg.laneW = AVE_LANEW; }
      roads.push(seg);
    });
    zLines.forEach((z) => {                 // cross-streets (run along x)
      roads.push({ x: (minX + maxX) / 2, z, vertical: false, len: spanX, w: ROAD, grid: true });
    });

    // ---- intersections (signal phase records; the paint is the kit's) ----
    const intersections = [];
    xLines.forEach((x, i) => zLines.forEach((z, j) => {
      intersections.push({ x, z, i, j, phase: (i + j) % 2 === 0 ? 0 : 1, t: rng() * 6, ns: true, light: null });
    }));

    // ---- blocks: lots + a DISTRICT-flavoured lot pad ----
    // GROUND IDENTITY (why: you should know WHERE you are — and where the
    // money is — without the map): residential + projects keep grass yards
    // wearing the island's exact checker (the two landmasses read as one
    // world), the core + commercial blocks get poured concrete plazas and
    // industrial gets a dusty work yard.
    // (district field hoisted here — the lot pads need it at build time;
    // the spawn-weight pickers further down reuse these same definitions)
    const DISTRICTS = (C.districts && C.districts.length) ? C.districts : [];
    const dSpan = Math.ceil(N / 3);
    function districtQ(i, j) {
      const di = Math.min(2, (i / dSpan) | 0), dj = Math.min(2, (j / dSpan) | 0);
      return dj * 3 + di;
    }
    const grassTex = CBZ.checkerTex ? CBZ.checkerTex(CBZ.COL.GRASS_A, CBZ.COL.GRASS_B, 2) : null;
    if (grassTex) photoLayer(grassTex, "assets/textures/grass512.jpg", function (g2, c) {
      // keep the island's checker identity visible over the photo grain
      const s = c.width / 2; g2.globalAlpha = 0.38;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        g2.fillStyle = (i + j) % 2 ? CBZ.COL.GRASS_A : CBZ.COL.GRASS_B;
        g2.fillRect(i * s, j * s, s, s);
      }
      g2.globalAlpha = 1;
    });
    const grassMat = grassTex ? new THREE.MeshLambertMaterial({ map: grassTex })
                              : new THREE.MeshLambertMaterial({ color: 0x55903f });
    // The footway is 2 m inside the block envelope (BLK), so the lot pad is
    // BLK - 4 and the full 18 m of carriageway shows between kerbs.
    const LOT_HALF = (BLK - 4) / 2;
    const lots = [], padKind = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const bx = (xLines[i] + xLines[i + 1]) / 2;
      const bz = (zLines[j] + zLines[j + 1]) / 2;
      const dq = districtQ(i, j);
      const dk = (DISTRICTS[dq] && DISTRICTS[dq].kind) || "";
      padKind.push({ bi: i, bj: j, kind: (dk === "core" || dk === "commercial") ? "plaza" : (dk === "industrial" ? "yard" : "grass") });
      // `grid` (additive): this parcel's kerb, footway and driveway mouth are
      // drawn by the street kit; approach.js only surfaces the lot side.
      lots.push({ cx: bx, cz: bz, w: BLK - 4, d: BLK - 4, i, j, district: dq, kind: null, building: null, grid: true });
    }

    // ---- THE STREET (city/streetkit.js): road + harbour apron, rounded
    //      kerbs, footways, ramps, driveway mouths, markings, ironwork. ----
    // The driveway mouths come from the SAME solve approach.js uses (one
    // crossing per parcel, on the face turned toward the city centre) so the
    // dropped kerb and the driveway can never disagree.
    const driveways = [];
    for (const lot of lots) {
      const ap = CBZ.cityLotApproach ? CBZ.cityLotApproach(lot, { x: cx, z: cz }) : null;
      if (!ap) continue;
      driveways[lot.i * N + lot.j] = ap.nx
        ? { face: ap.nx > 0 ? "x+" : "x-", at: ap.z, half: ap.half, flare: 1.1 }
        : { face: ap.nz > 0 ? "z+" : "z-", at: ap.x, half: ap.half, flare: 1.1 };
    }
    // the kerb-return radius roadrules.js solves for this cross-section
    // (AASHTO design vehicle, capped by the 2 m footway): ~4.8 m
    const cornerR = CBZ.roadCornerRadius ? CBZ.roadCornerRadius(roads[0], roads[N + 1], 2.0) : 4.8;
    const street = CBZ.streetKit ? CBZ.streetKit.build({
      root, xLines, zLines, ROAD, BLK, lotHalf: LOT_HALF, cornerR,
      laneW, lanesPerDir, aveMedian: AVE_MEDIAN,
      isAvenue: isAvenueLine,
      // painted turn arrows on the Midtown approaches: the money-side streets look administered
      isMidtown: function (i, j) { return i >= 2 && i <= 4 && j >= 2 && j <= 4; },
      driveways,
    }) : null;
    if (!street) console.error("[city] city/streetkit.js did not load: the grid has no streets");
    const SP = street ? street.profile : { yRoad: 0, yWalk: 0, yLot: 0 };
    // lot pads: one mesh per surface, each a fan to the footway's own back edge
    if (street) {
      const byKind = { grass: [], plaza: [], yard: [] };
      for (const pk of padKind) byKind[pk.kind].push(pk);
      street.lotMesh("lot-grass", byKind.grass, grassMat, 1 / 8);
      street.lotMesh("lot-plaza", byKind.plaza, street.plazaMaterial(), 1 / 6);
      const yardMat = new THREE.MeshLambertMaterial();
      yardMat.color.setRGB(0.20, 0.19, 0.165);     // dusty work yard, linear
      street.lotMesh("lot-yard", byKind.yard, yardMat, 1 / 8);
    }
    // the raised concrete MEDIAN on the two avenues, stopping short of the
    // stop bars so the crosswalk and the junction stay open (one merged mesh)
    // It was a flat-grey BoxGeometry (unit UVs, no texture): a placeholder slab
    // down the middle of the avenue. It is cut from the SAME granite kerb stone
    // the footway kerbs use (streetkit's kerb atlas: top band v 0.53-0.98, sawn
    // face v < 0.5, 1 m stones along u), so the island reads as kerbed concrete
    // with road grime up its faces, and its noses are rounded like a real one.
    if (street) {
      const kTex = street.kerbTexture || null;
      const medMat = kTex ? new THREE.MeshLambertMaterial({ map: kTex }) : mat(0x6f737a);
      if (kTex && CBZ.terrainFogScale) CBZ.terrainFogScale(medMat, 0.10);
      const P = [], Nn = [], U = [];
      const yB = SP.yRoad - 0.02, yT = SP.yRoad + 0.17, H = yT - yB;
      const vFace0 = Math.max(0, 0.5 - (H / 0.32) * 0.5);
      // one triangle, wound so its face normal agrees with n (never trust the
      // hand-ordered ring to be CCW in three's left-handed top view)
      function tri(a, b, c, n, ua, ub, uc) {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
        const L = d < 0 ? [[a, ua], [c, uc], [b, ub]] : [[a, ua], [b, ub], [c, uc]];
        for (const [p, uv] of L) { P.push(p[0], p[1], p[2]); Nn.push(n[0], n[1], n[2]); U.push(uv[0], uv[1]); }
      }
      function quad(a, b, c, d, n, ua, ub, uc, ud) { tri(a, b, c, n, ua, ub, uc); tri(a, c, d, n, ua, uc, ud); }
      function medianRun(x, z0, z1) {
        const hw = AVE_MEDIAN / 2, R = hw, SEG = 6;
        // outline: straight sides + a semicircular nose at each end (CCW from above)
        const ring = [];
        for (let k = 0; k <= SEG; k++) { const a = Math.PI + (k / SEG) * Math.PI; ring.push([x + Math.cos(a) * R, z0 + R + Math.sin(a) * R]); }
        for (let k = 0; k <= SEG; k++) { const a = (k / SEG) * Math.PI; ring.push([x + Math.cos(a) * R, z1 - R + Math.sin(a) * R]); }
        // top: fan from the centre line (granite top band)
        const cz = (z0 + z1) / 2;
        let s = 0;
        const along = [0];
        for (let k = 1; k <= ring.length; k++) { const a = ring[k - 1], b = ring[k % ring.length]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); along.push(s); }
        for (let k = 0; k < ring.length; k++) {
          const a = ring[k], b = ring[(k + 1) % ring.length];
          const vA = 0.53 + 0.45 * (a[0] - (x - hw)) / (2 * hw), vB = 0.53 + 0.45 * (b[0] - (x - hw)) / (2 * hw);
          // top triangle (centre, b, a) faces +y
          tri([x, yT, cz], [b[0], yT, b[1]], [a[0], yT, a[1]], [0, 1, 0], [cz / 4, 0.755], [b[1] / 4, vB], [a[1] / 4, vA]);
          // side face, outward normal
          const mx = (a[0] + b[0]) / 2 - x, mz = (a[1] + b[1]) / 2 - Math.min(Math.max((a[1] + b[1]) / 2, z0 + R), z1 - R);
          const nl = Math.hypot(mx, mz) || 1, n = [mx / nl, 0, mz / nl];
          const u0 = along[k] / 4, u1 = along[k + 1] / 4;
          quad([a[0], yB, a[1]], [a[0], yT, a[1]], [b[0], yT, b[1]], [b[0], yB, b[1]], n, [u0, vFace0], [u0, 0.5], [u1, 0.5], [u1, vFace0]);
        }
      }
      const noseOff = street.solve.stop1 + 0.8;
      AVENUE_LINES.forEach((i) => {
        const x = xLines[i];
        for (let j = 0; j < N; j++) {
          const z0 = zLines[j] + noseOff, z1 = zLines[j + 1] - noseOff;
          if (z1 - z0 < 1.5) continue;
          medianRun(x, z0, z1);
        }
      });
      if (P.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(Nn, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
        g.computeBoundingSphere();
        const med = new THREE.Mesh(g, medMat);
        med.name = "avenue-medians";
        med.castShadow = false; med.receiveShadow = true; med.matrixAutoUpdate = false; med.updateMatrix(); root.add(med);
      }
    }

    // ---- perimeter: a visible, jumpable waterfront cap. Its collider is the
    //      exact box that is drawn — no hidden four-metre collision slab around
    //      a 1.4m cap, and no mathematical boundary inside the quay. ----
    function wall(x, z, w, d) {
      // visible cap: full length along the seawall, 1.4m thick, knee-high.
      // The collider uses those same visible dimensions and height. Walking
      // into it stops you like any wall, but a jump clears it into the harbor.
      const vw = w >= d ? w : 1.4, vd = d > w ? d : 1.4;
      const m = new THREE.Mesh(new THREE.BoxGeometry(vw, 0.55, vd), mat(0x9aa0a6));
      m.position.set(x, 0.275, z); m.castShadow = false; m.receiveShadow = true; root.add(m);
      CBZ.colliders.push({ minX: x - vw / 2, maxX: x + vw / 2, minZ: z - vd / 2, maxZ: z + vd / 2, ref: m, y0: 0, y1: 0.55 });
    }
    /* EVERY SEAWALL RUN GOES THROUGH THE SHARED ROAD-GAP LAW.
       (city/roadrules.js, CBZ.roadGapDefer.) The three authored gates below are
       KEPT — they are the degrade path, and they are what this file draws with
       no roadrules.js at all or with ROAD_GAP_RUNS off — but they are no longer
       the only way a road gets through this wall. Each of them exists because
       somebody drove into an invisible knee-wall at ONE causeway mouth and
       typed the hole in by hand, in this file, against a constant owned by a
       different one; a fourth approach reaching this coast used to get nothing.
       Now the law that already knows where every road is opens its own hole.

       DEFERRED, and that is the whole reason roadGapDefer exists: this runs
       inside buildCity's main body, hundreds of lines BEFORE cityWorldGeo()
       hands `city` to the landmass builders that push the causeway records. A
       run split here and now would be split against an empty road list. The
       closure is called back at order 98.6, once every road in the world
       exists, and draws exactly the pieces this file would have drawn. */
    const EW = minX - 26, EE = maxX + 26, ES = minZ - 26, EN = maxZ + 26, T = 1.4;
    function gapWall(x, z, w, d) {
      if (!CBZ.roadGapDefer) return wall(x, z, w, d);
      const horiz = w >= d;
      const x0 = horiz ? x - w / 2 : x, x1 = horiz ? x + w / 2 : x;
      const z0 = horiz ? z : z - d / 2, z1 = horiz ? z : z + d / 2;
      // `min`: a piece shorter than the wall is THICK is not a wall, it is a
      // stub — and wall() picks its own long axis from w >= d, so a 2 m stub of
      // a 4 m-thick seawall would be drawn rotated. Drop it instead.
      return CBZ.roadGapDefer(x0, z0, x1, z1,
        { id: "world:seawall", thick: horiz ? d : w, min: (horiz ? d : w) + 0.5 },
        function (s) {
          wall((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2,
            horiz ? Math.abs(s.x1 - s.x0) : w,
            horiz ? d : Math.abs(s.z1 - s.z0));
        });
    }
    // THE BEACH GAP: the south seawall opens over one stretch — city/beach.js
    // lays sand there and the shore must run straight into the water (no
    // knee-wall, no cap). The wall resumes either side of the span.
    // BEACH_V2 (2026-08-16): the span grows 100 → 160 m. A city beach one
    // block long read as an amenity strip, not a coastline. Every consumer —
    // the sand, the swash apron, the minimap band, the stash spots — reads
    // this pair off the descriptor, so the wider opening propagates without
    // another file changing. ?cfg_BEACH_V2=0 → the old 100 m gap.
    if (CBZ.CONFIG.BEACH_V2 == null) CBZ.CONFIG.BEACH_V2 = true;
    const BEACH2 = CBZ.CONFIG.BEACH_V2 !== false;
    const BX0 = cx - (BEACH2 ? 150 : 110), BX1 = cx + (BEACH2 ? 10 : -10);
    gapWall((EW + BX0) / 2, ES, BX0 - EW, T); gapWall((BX1 + EE) / 2, ES, EE - BX1, T);
    // THE NORTH CAUSEWAY GATE: city/island_airport.js runs a 24m-wide highway
    // causeway straight across the harbor from the mainland's NORTH edge (centred
    // on cx) up to the airport island. The north seawall MUST open for it, or the
    // player hits an invisible knee-wall at the causeway mouth while NPC cars
    // (which navigate by region-clamp, not colliders) drive right through. The
    // gap matches the deck width; the causeway's own side curbs carry the
    // fall-guard line across the opening, so no car can slip off into the sea.
    const NGATE = 26;                                   // ≥ 24m deck width
    gapWall((EW + (cx - NGATE / 2)) / 2, EN, (cx - NGATE / 2) - EW, T);
    gapWall(((cx + NGATE / 2) + EE) / 2, EN, EE - (cx + NGATE / 2), T);
    // THE WEST CAUSEWAY GATE: city/island_military.js runs the 24m-wide highway
    // causeway from the mainland's WEST edge (authored centred on cz, z=-700)
    // out to the military base. Same fix as the north gate — open the seawall
    // or the player hits an invisible knee-wall at the mouth while NPC cars
    // (region-clamp, not colliders) drive through. The deck's z-band rides the
    // military world-layout dial (island_military.js CW_* = CEN_Z ∓ 12), so
    // the GATE rides the same dial — a gate fixed at cz would leave the wall
    // solid across the moved mouth with a useless gap 150u away. The airport
    // (north) gate stays on cx: that causeway's mainland lane never moves.
    const WGATE = 26;                                   // ≥ 24m deck width
    const _MILW = (CBZ.worldOff && CBZ.worldOff("military")) || { dx: 0, dz: 0 };
    const wgz = cz + _MILW.dz;                          // deck centreline == CEN_Z
    gapWall(EW, (ES + (wgz - WGATE / 2)) / 2, T, (wgz - WGATE / 2) - ES);
    gapWall(EW, ((wgz + WGATE / 2) + EN) / 2, T, EN - (wgz + WGATE / 2));
    // The east wall has a real road gate. city/expansion.js continues this
    // centre cross-street across a bridge into the island district.
    const GATE = 22;
    gapWall(EE, (ES + (cz - GATE / 2)) / 2, T, cz - GATE / 2 - ES);
    gapWall(EE, ((cz + GATE / 2) + EN) / 2, T, EN - (cz + GATE / 2));

    // ---- waypoint helpers ----
    function lotAt(i, j) { return lots.find((l) => l.i === i && l.j === j); }
    function randomSidewalkPoint() {
      // a point on the sidewalk ring around a random block
      const l = lots[(rng() * lots.length) | 0];
      const edge = (rng() * 4) | 0, t = (rng() - 0.5) * l.w;
      const off = l.w / 2 + 1.6;
      if (edge === 0) return { x: l.cx + t, z: l.cz - off };
      if (edge === 1) return { x: l.cx + t, z: l.cz + off };
      if (edge === 2) return { x: l.cx - off, z: l.cz + t };
      return { x: l.cx + off, z: l.cz + t };
    }
    function randomRoadPoint() {
      const r = roads[(rng() * roads.length) | 0];
      const along = (rng() - 0.5) * r.len * 0.9;
      const lane = (rng() < 0.5 ? -1 : 1) * (ROAD * 0.22);
      return r.vertical ? { x: r.x + lane, z: r.z + along, vertical: true }
                        : { x: r.x + along, z: r.z + lane, vertical: false };
    }
    function nearestIntersection(x, z) {
      // Intersections are a regular (N+1)² grid. The nearest 2D point is
      // exactly the independently nearest x-line and z-line, so avoid scanning
      // the whole grid for every traffic car, every frame.
      const i = Math.max(0, Math.min(N, Math.round((x - xLines[0]) / step)));
      const j = Math.max(0, Math.min(N, Math.round((z - zLines[0]) / step)));
      return intersections[i * (N + 1) + j];
    }
    // ---- DISTRICT FIELD: busy and quiet by DESIGN -----------------------
    // WHY: pacing. config.js CITY.districts gives every 2×2-lot quadrant a
    // personality (downtown packed, docks sparse) so foot traffic, casting
    // and cop beats differ by neighbourhood and "where do I do this crime"
    // is a real decision. Same 3×3 carve + names as turf.js zones, so the
    // takeover map and the population field agree. All weights live in
    // config; the pickers below are deterministic from the caller's rng,
    // so the harness world stays stable.
    // (DISTRICTS / districtQ now live ABOVE the lot loop — the lot pads need
    // the district kind at build time, and each lot is stamped at push.)
    function districtAt(x, z) {
      const i = Math.max(0, Math.min(N - 1, ((x - xLines[0]) / step) | 0));
      const j = Math.max(0, Math.min(N - 1, ((z - zLines[0]) / step) | 0));
      return DISTRICTS[districtQ(i, j)] || null;
    }
    // OFFICE-TOWER POLICY (consumed by city/buildings.js): which TALL towers read
    // as workplaces instead of homes. WHY: downtown/midtown should be glass office
    // stacks full of seated workers (witnesses + payroll), not just apartments —
    // the skyline tells you where the 9-to-5 money is. Deterministic (NO rng draw,
    // so the world build stays byte-identical): only the busy commercial cores
    // (core = Midtown, commercial = Eastgate/Westend/Harborside) qualify, and a
    // stable ~half of THOSE lots flip — a lot-index parity hash — so a believable
    // MIX of offices and flats lines each downtown block rather than all-or-none.
    // buildings.js further gates on storeys>=3 and never overrides a listed home.
    function officeLot(lot) {
      if (!lot) return false;
      const D = DISTRICTS[lot.district];
      if (!D || (D.kind !== "core" && D.kind !== "commercial")) return false;
      return (((lot.i | 0) * 3 + (lot.j | 0)) & 1) === 0;   // stable subset (~half)
    }
    // cumulative lot weights, built once per key (no rng draws → world build
    // is byte-identical to before; only the CALLERS' picks redistribute).
    function lotCum(key) {
      const cum = new Float64Array(lots.length);
      let t = 0;
      for (let k = 0; k < lots.length; k++) {
        const d = DISTRICTS[lots[k].district];
        t += d && d[key] != null ? d[key] : 1;
        cum[k] = t;
      }
      return { cum, total: t };
    }
    const popW = lotCum("pop"), copW = lotCum("cops");
    function pickWeightedLot(w, r) {
      if (!(w.total > 0)) return lots[(r() * lots.length) | 0];
      const x = r() * w.total;
      for (let k = 0; k < w.cum.length; k++) if (x <= w.cum[k]) return lots[k];
      return lots[lots.length - 1];
    }
    function sidewalkOf(l, r) {           // a point on a lot's sidewalk ring
      const edge = (r() * 4) | 0, t = (r() - 0.5) * l.w;
      const off = l.w / 2 + 1.6;
      if (edge === 0) return { x: l.cx + t, z: l.cz - off };
      if (edge === 1) return { x: l.cx + t, z: l.cz + off };
      if (edge === 2) return { x: l.cx - off, z: l.cz + t };
      return { x: l.cx + off, z: l.cz + t };
    }
    // density-weighted sidewalk point: downtown draws ~4× the docks. Pass your
    // own rng for a deterministic stream; defaults to the city rng.
    function weightedSidewalkPoint(r) { r = r || rng; return sidewalkOf(pickWeightedLot(popW, r), r); }
    // cop-beat point: a road lane point bordering a cops-weighted lot, so
    // police presence follows the money (heavy downtown, thin at the docks).
    // police.js can swap its randomRoadPoint() calls for this — same shape.
    function copBeatPoint(r) {
      r = r || rng;
      const l = pickWeightedLot(copW, r);
      const lane = (r() < 0.5 ? -1 : 1) * (ROAD * 0.22);
      if (r() < 0.5) {                    // a bordering avenue (runs along z)
        const x = xLines[l.i + (r() < 0.5 ? 0 : 1)];
        return { x: x + lane, z: l.cz + (r() - 0.5) * l.d, vertical: true };
      }
      const z = zLines[l.j + (r() < 0.5 ? 0 : 1)];   // a bordering cross-street
      return { x: l.cx + (r() - 0.5) * l.w, z: z + lane, vertical: false };
    }

    function clampRect(p, x0, x1, z0, z1) {
      return { x: Math.max(x0, Math.min(x1, p.x)), z: Math.max(z0, Math.min(z1, p.z)) };
    }
    function clampCircle(p, x, z, radius) {
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz) || 1;
      const s = radius / d;
      return { x: x + dx * s, z: z + dz * s };
    }
    function clampToCity(p, r) {
      // This helper is containment for autonomous actors, not a player/world
      // boundary. The player and their current vehicle must be allowed to leave
      // every registered region; visible geometry, terrain and water own that.
      const P = CBZ.player;
      if (P && (p === P.pos || (P._vehicle && p === P._vehicle.pos))) return;
      r = r || 0.6;
      const x0 = minX - 22 + r, x1 = maxX + 22 - r;
      const z0 = minZ - 22 + r, z1 = maxZ + 22 - r;
      if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) return;

      // city/expansion.js installs these after the base descriptor exists.
      // Treat the mainland, bridge and island as one connected walkable union.
      const A = city && city.annex, B = city && city.bridge;
      if (B && p.x >= B.minX + r && p.x <= B.maxX - r && p.z >= B.minZ + r && p.z <= B.maxZ - r) return;
      if (A && Math.hypot(p.x - A.cx, p.z - A.cz) <= A.radius - r) return;

      // worldmap.js islands & biomes (+ their bridges) register here as a
      // connected walkable union — same treatment as the mainland/annex.
      const regs = city && city.regions;
      if (regs && CBZ.cityRegionHit) {
        for (let i = 0; i < regs.length; i++) if (CBZ.cityRegionHit(regs[i], p.x, p.z, r)) return;
      }

      const spots = [clampRect(p, x0, x1, z0, z1)];
      if (B) spots.push(clampRect(p, B.minX + r, B.maxX - r, B.minZ + r, B.maxZ - r));
      if (A) spots.push(clampCircle(p, A.cx, A.cz, A.radius - r));
      if (regs && CBZ.cityRegionClamp) {
        for (let i = 0; i < regs.length; i++) spots.push(CBZ.cityRegionClamp(regs[i], p.x, p.z, r));
      }
      let best = spots[0], bd = Infinity;
      for (const q of spots) {
        const d = (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z);
        if (d < bd) { bd = d; best = q; }
      }
      p.x = best.x; p.z = best.z;
    }

    // ---- LAND-VALUE FIELD (PROCGEN.md roadmap #3) -----------------------
    // WHY: "field → structure → detail" (Minecraft's pipeline / SimCity land
    // value) — a cheap global scalar sampled by structures downstream (right
    // now: districtStoreys' height gradient + the abandoned-lot gate in
    // buildings.js), instead of every consumer hand-rolling its own distance
    // math. Three ingredients, purely geometric + a coarse deterministic
    // noise field — NO rng draw, so this is byte-identical every build:
    //   1) distance-to-centre falloff (money concentrates downtown)
    //   2) waterfront/seawall proximity bonus (coastal lots command a premium)
    //   3) low-frequency smoothed hash noise so the falloff isn't a perfect
    //      bullseye — a few "good blocks near the edge" / "so-so blocks near
    //      the core" the way real land value maps are lumpy, not radial.
    // Returns roughly [0,1]; consumers may exceed slightly at the water/core
    // overlap corners, which is fine (they treat it as a continuous weight).
    const _lvRmax = Math.hypot(half, half) || 1;   // centre→corner distance
    // smoothstep-interpolated CBZ.hash01 over a coarse (140m) grid: cheap,
    // deterministic, order-independent (no dependency on window.noise / the
    // terrain module's seeding order).
    const LV_CELL = 140, LV_SALT = 0xA17;
    function lvSmooth(t) { return t * t * (3 - 2 * t); }
    function lvNoise(x, z) {
      const gx = x / LV_CELL, gz = z / LV_CELL;
      const x0 = Math.floor(gx), z0 = Math.floor(gz);
      const fx = lvSmooth(gx - x0), fz = lvSmooth(gz - z0);
      const h00 = CBZ.hash01(x0 * LV_CELL, z0 * LV_CELL, LV_SALT);
      const h10 = CBZ.hash01((x0 + 1) * LV_CELL, z0 * LV_CELL, LV_SALT);
      const h01 = CBZ.hash01(x0 * LV_CELL, (z0 + 1) * LV_CELL, LV_SALT);
      const h11 = CBZ.hash01((x0 + 1) * LV_CELL, (z0 + 1) * LV_CELL, LV_SALT);
      const a = h00 + (h10 - h00) * fx, b = h01 + (h11 - h01) * fx;
      return a + (b - a) * fz;   // [0,1)
    }
    // distance (rectilinear, to the nearest seawall line) — 0 right at the
    // water, growing inland. EW/EE/ES/EN are the four seawall lines above.
    const LV_WATER_RANGE = 140;   // waterfront premium fades out by ~140m inland
    function landValueAt(x, z) {
      const dd = Math.hypot(x - cx, z - cz);
      const distScore = 1 - Math.min(1, dd / _lvRmax);                  // 1 centre → 0 rim
      const distToWater = Math.max(0, Math.min(x - EW, EE - x, z - ES, EN - z));
      const waterBonus = Math.max(0, 1 - distToWater / LV_WATER_RANGE) * 0.35;
      const jitter = (lvNoise(x, z) - 0.5) * 0.3;                       // ±0.15, low-frequency
      return Math.max(0, Math.min(1, distScore * 0.6 + waterBonus + jitter));
    }

    // ---- THE CITY FLOOR IS THE DRAWN STREET ----
    // The street kit samples every road, kerb, footway, ramp and apron vertex
    // from ONE analytic surface (street.heightAt), so physics reads that same
    // function: the player and peds step up the 13 cm kerb, walk down the
    // corner ramps, and cars roll over the driveway aprons, exactly on what
    // is drawn. Off the grid it returns null and the registered terrain
    // oracle (Mount Mercy etc.) owns the answer; where real terrain is higher
    // it always wins.
    function streetY(x, z) {
      return street ? street.heightAt(x, z) : null;
    }
    function realGround(x, z) {
      return CBZ.cityGroundHeightAt ? (+CBZ.cityGroundHeightAt(x, z) || 0) : 0;
    }
    function groundHeightAt(x, z) {
      const real = realGround(x, z);
      const s = streetY(x, z);
      return Math.max(0, real, s == null ? 0 : s);
    }
    // top of the DRAWN ground — what a decal (blood, scorch, tyre smear)
    // seats on. With the street and the floor now the same surface this is
    // the floor itself; kept as its own export for the consumers that ask.
    function groundDecalYAt(x, z) { return groundHeightAt(x, z); }
    // the rendered support under a tyre (vehicles.js suspension probes)
    function vehicleSurfaceYAt(x, z) { return groundHeightAt(x, z); }

    city = {
      root, center: { x: cx, z: cz },
      N, step, BLK, ROAD, xLines, zLines, minX, maxX, minZ, maxZ,
      lots, roads, intersections, rng,
      // street census (ba preset city-roads-traffic reads the first two):
      // road-surface vertices, lane/crosswalk paint quads (every one worn in
      // the shader), and the full street-kit breakdown
      roadLook: street ? Object.assign({ fieldVertices: street.stats.roadVerts, wornDashes: street.stats.paintQuads }, street.stats)
                       : { fieldVertices: 0, wornDashes: 0 },
      // the solved cross-section (heights, corner radius, crosswalk and stop
      // bar setbacks) for anything that dresses the street: furniture seats
      // on `heightAt`, a pole goes behind `cornerR`, etc.
      street: street ? {
        yRoad: SP.yRoad, yWalk: SP.yWalk, yLot: SP.yLot, kerbTop: SP.kerbTop, gutter: SP.gutter,
        footway: street.solve.FW, cornerR: street.solve.R,
        crosswalk: { near: street.solve.cw0, far: street.solve.cw1 },
        stopBar: { near: street.solve.stop0, far: street.solve.stop1 },
        heightAt: street.heightAt, regionAt: street.regionAt,
      } : null,
      // the day/night-tinted water material — expansion.js's island ocean can
      // share it so the whole sea shifts tone together
      seaMat,
      // the waterfront lines + the south seawall's beach gap (city/beach.js
      // builds sand/boardwalk/pier inside this span; the wall above skips it)
      shore: { EW, EE, ES, EN, beach: { x0: BX0, x1: BX1 } },
      // Universal ground-height oracle (mode.js routes CBZ.floorAt here in
      // city mode): the street surface on the grid (see streetY above), the
      // registered reachable landmasses everywhere else, whichever is higher.
      groundHeightAt,
      // top of the DRAWN ground — what a ground decal seats on
      groundDecalY: groundDecalYAt,
      // rendered support for wheel/suspension probes (vehicles.js)
      vehicleSurfaceY: vehicleSurfaceYAt,
      // land-value field (PROCGEN.md roadmap #3): distance-to-centre falloff +
      // waterfront proximity bonus + low-freq deterministic noise, ~[0,1].
      // Sampled by buildings.js (height gradient, abandoned-lot gate) — cheap
      // enough to call per-lot at build time or per-frame at runtime.
      landValue: landValueAt,
      lotAt, randomSidewalkPoint, randomRoadPoint, nearestIntersection, clampToCity,
      // district personality field (peds/crowd density, casting, cop beats)
      districts: DISTRICTS, districtAt, weightedSidewalkPoint, copBeatPoint,
      // which tall towers are OFFICES (workplaces) vs homes — buildings.js reads it
      officeLot,
      // a clear spawn: the central intersection sidewalk corner
      spawn: { x: cx + ROAD / 2 + 2, z: cz + ROAD / 2 + 2 },
      transients: [],
      reset() {
        // remove any per-run transient meshes (crashed cars, drops, fx) so a
        // replay starts clean; permanent geometry (roads/buildings) stays.
        for (let i = root.children.length - 1; i >= 0; i--) {
          const ch = root.children[i];
          if (ch.userData && ch.userData.transient) {
            root.remove(ch);
            if (ch.geometry && ch.geometry.dispose) ch.geometry.dispose();
            if (ch.material && ch.material.dispose) ch.material.dispose();
          }
        }
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      },
    };

    // ---- THE WORLD STREAM STAYS WHERE IT WAS ----
    // The old decal pass (manholes, gutter grates, asphalt patches, skid
    // stains) drew from the shared "world" rng stream, which city.rng hands
    // on to buildings/props. All of that is now hash-seeded in the street kit
    // and the asphalt shader, but removing the draws would reshuffle every
    // building in the city. So the exact count and order of the old draws is
    // consumed here and discarded. (Pure bookkeeping: nothing is drawn.)
    (function burnLegacyStreetRng() {
      for (const r of roads) {                          // manhole covers
        const n = Math.max(1, Math.floor(r.len / 40));
        for (let i = 1; i < n; i++) { if (rng() > 0.6) continue; rng(); rng(); }
      }
      for (let k = 0; k < intersections.length; k++) { rng(); rng(); rng(); rng(); }   // gutter grates
      for (const r of roads) {                          // asphalt patches
        const n = Math.max(2, Math.floor(r.len / 30));
        for (let i = 0; i < n; i++) { if (rng() > 0.55) continue; for (let q = 0; q < 7; q++) rng(); }
      }
      for (let k = 0; k < intersections.length; k++) {  // skid stains
        if (rng() > 0.5) continue;
        for (let q = 0; q < 8; q++) rng();
      }
    })();

    // ---- RED KERB painter (hydrant fire lanes) ----
    // props.js places hydrants AFTER this, so the pass at the bottom of
    // buildCity decides WHICH hydrants get a fire lane and WHICH lot (so which
    // kerb) each fronts; the kit paints the kerb face + granite top there, all
    // fire lanes merged into one mesh.
    let redCurbsPainted = 0;   // census for CBZ.solidityAudit()
    function paintRedCurb(lot, px, pz) {
      if (!street || !lot) return;
      if (street.paintRedKerb(lot.i, lot.j, px, pz)) redCurbsPainted++;
    }

    // ---- let sibling modules furnish the city (buildings, props, lights) ----
    if (CBZ.bootStep) CBZ.bootStep("city:buildings");
    if (CBZ.cityBuildings) try { CBZ.cityBuildings(city); } catch (e) { console.error("[city buildings]", e); }
    if (CBZ.bootStep) CBZ.bootStep("city:expansion");
    if (CBZ.cityExpansion) try { CBZ.cityExpansion(city); } catch (e) { console.error("[city expansion]", e); }
    // worldmap.js: 3 new islands (speedway/airport/military) + 4 biome
    // landmasses (desert/forest/farmland/snow). Runs AFTER the original island
    // so it can read city.maxX/annex and register its own walkable regions.
    if (CBZ.cityWorldGeo) try { CBZ.cityWorldGeo(city); } catch (e) { console.error("[city worldgeo]", e); }
    // No procedural horizon/backdrop terrain is built. Elevation must be owned
    // by a reachable registered landmass and its shared ground-height oracle.
    if (CBZ.bootStep) CBZ.bootStep("city:props");
    if (CBZ.cityProps) try { CBZ.cityProps(city); } catch (e) { console.error("[city props]", e); }

    // ---- RED CURBS at hydrants (props.js just placed them): paint the curb
    //      beside every other hydrant — the fire lane explains itself and
    //      blocks stop reading copy-paste identical. Runs AFTER the hooks
    //      because hydrants don't exist until cityProps; draws no rng. ----
    if (paintRedCurb && city.streetProps) {
      // The kerb line is NOT computed here any more — see paintRedCurb's note.
      // This pass only decides WHICH hydrants get a fire lane and WHICH lot
      // (i.e. which kerb) each one fronts; the painter owns the geometry.
      let painted = 0, idx = 0;
      for (const p of city.streetProps) {
        if (p.type !== "hydrant") continue;
        if ((idx++ & 1) || painted >= 8) continue;     // every other one, max 8
        let lot = null, bd = 1e9;
        for (const l of lots) {
          const d = Math.abs(p.x - l.cx) + Math.abs(p.z - l.cz);
          if (d < bd) { bd = d; lot = l; }
        }
        if (!lot) break;
        paintRedCurb(lot, p.x, p.z);
        painted++;
      }
    }
    if (street) street.finishRed();
    city._redCurbs = redCurbsPainted;

    // ---- SEAT THE STREET FURNITURE ON THE STREET ----
    // The props pass authored its furniture on the OLD datums: y = 0 (the
    // flat floor) or ~0.08-0.09 (the old 8 cm sidewalk slab / 10 cm lot pad).
    // On the real cross-section those sink into the 18 cm footway or under
    // the 12.5 cm lot pad. Re-seat exactly those: direct children of the city
    // root, by where their foot is. A lot object at y = 0 is never touched
    // (buildings own their own foundation), and nothing on the road moves.
    // Their y-banded colliders move with them.
    if (street) {
      const byRef = new Map();
      for (const c of (CBZ.colliders || [])) if (c && c.ref && c.y1 != null) { let a = byRef.get(c.ref); if (!a) byRef.set(c.ref, a = []); a.push(c); }
      let seated = 0;
      for (const o of root.children) {
        if (!o || o.isInstancedMesh) continue;
        if (o.userData && (o.userData.terrain || o.userData.roadPaint || o.userData.dynamic)) continue;
        const px = o.position.x, pz = o.position.z, oy = o.position.y;
        const onOldSlab = oy >= 0.07 && oy <= 0.105;
        const region = street.regionAt(px, pz);
        let dy = 0;
        if (region === 1) {
          const y = street.heightAt(px, pz);
          if (Math.abs(oy) < 0.005) dy = y - oy;
          else if (onOldSlab) dy = y - 0.08;
        } else if (region === 2 && onOldSlab) dy = SP.yLot - 0.10;
        if (!(Math.abs(dy) > 0.004)) continue;
        o.position.y = oy + dy;
        if (!o.matrixAutoUpdate) o.updateMatrix();
        const cs = byRef.get(o);
        if (cs) for (const c of cs) { if (c.y0 != null) c.y0 += dy; c.y1 += dy; }
        seated++;
      }
      city.roadLook.seatedProps = seated;
    }

    // ---- NO-DECOY FIX: the harbor's moored hulls used to be dead THREE.Mesh
    //      boxes — no collider, no cityCars entry, no [E] prompt: a boat you
    //      could see but never reach, the classic "decoy" prop. The 3 EAST
    //      HARBOR hulls (the ones you actually pass close to, crossing the
    //      bridge) are now REAL vehicles.js cars: recorded here as spawn
    //      spots, then handed to cityMakeCar with economy.js's "Speedboat"
    //      model once vehicles.js exists — same pipeline expansion.js uses for
    //      the island's parked cars (spawnCityTraffic clears cityCars on every
    //      run, so re-fire this hook right after it, or the harbor goes empty
    //      after the first respawn). They get playercars.js's real makeBoat()
    //      visual (via cityInferCarStyle reading detailStyle:"boat") and are
    //      enterable through the exact same cityEnterVehicle every car uses.
    //      The other coast hulls (west/south/north) stay pure decor — the
    //      task only asks for 2-3 real ones, and this keeps the draw-call/
    //      cityCars-array cost of the change minimal. ----
    const _harborBoatSpots = [];
    let _harborHookWrapped = false;
    function wrapHarborBoatSpawn() {
      if (_harborHookWrapped || !CBZ.spawnCityTraffic) return;
      _harborHookWrapped = true;
      const orig = CBZ.spawnCityTraffic;
      CBZ.spawnCityTraffic = function (n) {
        const r = orig(n);
        spawnHarborBoats();
        return r;
      };
    }
    function spawnHarborBoats() {
      // cityMakeCar reaches into CBZ.city.arena — which mode.js only assigns
      // AFTER this whole buildCity() call returns, so this must NEVER run
      // synchronously from inside buildCity() itself (only from the
      // spawnCityTraffic hook below, which always fires later, post-build).
      if (!CBZ.cityMakeCar || !CBZ.cityEcon || !CBZ.cityEcon.carByName || !CBZ.city || !CBZ.city.arena) return;
      const model = CBZ.cityEcon.carByName("Speedboat");
      if (!model) return;
      for (const s of _harborBoatSpots) {
        const c = CBZ.cityMakeCar(s.x, s.z, s.yaw, false, model, 0);
        if (!c) continue;
        c.ai = false; c.v = 0; c.baseV = 0; c.road = null;   // moored — sits still until jacked
      }
    }
    // ---- EAST HARBOR: only real, boardable vehicles live here. The old sand
    //      patch, cube rip-rap, bollards and box-built decoy boats are gone. ----
    const EEx = maxX + 26;
    _harborBoatSpots.push({ x: EEx + 34, z: cz - 26, yaw: 0.35 });
    _harborBoatSpots.push({ x: EEx + 46, z: cz + 24, yaw: -0.5 });
    _harborBoatSpots.push({ x: EEx + 38, z: cz + 44, yaw: 0.15 });
    // Install the respawn hook (buildCity() runs once at city-mode entry, well
    // after every script — incl. vehicles.js, which loads AFTER world.js in
    // index.html — has loaded, so CBZ.spawnCityTraffic is live by now despite
    // the script tag order). Do NOT spawn here directly: mode.js's build()
    // only sets CBZ.city.arena AFTER this buildCity() call returns, and
    // cityMakeCar needs it — the first real spawn happens when mode.js calls
    // CBZ.spawnCityTraffic() right after, same as expansion.js's annex cars.
    wrapHarborBoatSpawn();

    // ---- THE WATERFRONT WITH A PURPOSE (city/beach.js): sand beach +
    //      boardwalk + pier in the south seawall gap and a painted parking
    //      apron. Runs last, after the seawall and landmass builders. ----
    if (CBZ.bootStep) CBZ.bootStep("city:beach");
    if (CBZ.cityBuildBeach) try { CBZ.cityBuildBeach(city); } catch (e) { console.error("[city beach]", e); }
    if (CBZ.bootStep) CBZ.bootStep("city:finish");

    // =====================================================================
    //  THE SEA, REBUILT AGAIN (CBZ.CONFIG.SEA_OVERHAUL + WATER_V2, both on
    //  by default). Runs LAST so every landmass/region/lake exists and the
    //  shore field can be baked from the real coastline. ONE draw call.
    //
    //  WHAT CHANGED vs. the previous pass, and why:
    //
    //  1. THE WAVES ACTUALLY MOVE NOW. The old uniform block was built with
    //     THREE.UniformsUtils.merge(), whose r128 implementation rebuilds
    //     every uniform object and clones every texture — so the `uSeaTime`
    //     object this file kept writing to each frame was NOT the one the
    //     shader read. uSeaTime sat at 0.0 for the entire session: every
    //     swell, every ripple flow, every foam band was frozen mid-stride.
    //     The block below is assembled by hand (only the fog chunk is
    //     cloned, and nothing holds a reference into that) so the clock,
    //     the sun vector and the weather chop reach the GPU.
    //
    //  2. TESSELLATION WHERE THE PLAYER IS. The old mesh was a uniform 16km
    //     grid at 144 segments — 111 metres per quad, while the SHORTEST
    //     swell is 105 metres long. Every wave sat exactly at the Nyquist
    //     limit and aliased into noise; up close the sea was geometrically
    //     a flat sheet. world/water_spec.js now builds a camera-centred
    //     RADIAL disc with geometrically growing rings (~0.15m at your feet,
    //     ~9m a hundred metres out, ~100m at a kilometre) for FEWER total
    //     vertices than before. The disc is re-centred in the vertex program
    //     from `cameraPosition.xz`, so the mesh transform never moves: the
    //     batch/farcull contract and matrixAutoUpdate=false both behave exactly
    //     as they did — and it stays correct inside the
    //     planar-mirror pass, because mirroring a camera through a horizontal
    //     plane leaves its XZ untouched.
    //
    //  3. A REAL SHORELINE. The baked field texture gained a smooth land
    //     RAMP instead of a binary stencil (bilinear filtering now puts the
    //     discard boundary on a sub-texel iso-line rather than a texel
    //     staircase — that staircase WAS the hard shoreline seam), a
    //     depth-graded colour ramp from turquoise shallows to deep blue, an
    //     advancing surf band that travels up the beach instead of a static
    //     painted ring that only pulsed, whitecaps that break on real crests,
    //     and an inland-water channel so a registered lake renders calmer,
    //     greener and far less specular than the open ocean.
    //
    //  4. DOUBLE SIDED. You can now be UNDER it and see a surface overhead.
    //
    //  Determinism: no rng anywhere — the field bake reads the shoreline
    //  oracle, the geometry is closed-form trigonometry, and the wave clock
    //  is runtime-only FX (explicitly allowed). userData.terrain spares the
    //  mesh from the batch pass and farcull.
    // =====================================================================
    if (CFGW.SEA_OVERHAUL !== false) (function buildSea() {
      // LOAD-ORDER INSURANCE: world/water_spec.js owns the swell table, the
      // shared GLSL and the surface geometry, and its <script> tag MUST come
      // before this file's. If it somehow did not, fall back to a plain flat
      // ocean plane rather than throwing — a world with dull water is
      // recoverable, a world that fails to build is not.
      if (!CBZ.waterCommonUniforms || !CBZ.waterBuildSeaGeometry) {
        console.error("[sea] world/water_spec.js did not load before city/world.js, falling back to the flat ocean plane");
        // drop the expansion island's own ocean plane first — it shares seaMat
        // and would z-fight this one (same sweep the real path does below)
        const stale = [];
        root.traverse(function (o) { if (o.isMesh && o.material === seaMat) stale.push(o); });
        for (const o of stale) if (o.parent) o.parent.remove(o);
        const fb = new THREE.Mesh(new THREE.PlaneGeometry(SEA_WORLD_SPAN, SEA_WORLD_SPAN), seaMat);
        fb.rotation.x = -Math.PI / 2;
        fb.position.set(SEA_WORLD_CX, SEA_Y, SEA_WORLD_CZ);
        fb.name = "world-sea";
        fb.receiveShadow = false; fb.castShadow = false;
        fb.frustumCulled = false;
        fb.userData.terrain = true;
        fb.userData.waterSurface = true;
        fb.userData.surfaceOwner = "world-water";
        fb.userData.unifiedSurface = true;
        root.add(fb);
        CBZ.citySea = fb;
        return;
      }
      // Registered inland lakes must be known before the field bake (their
      // footprint becomes the mask's alpha channel) and before the first
      // frame (they damp the swells over a pond).
      if (CBZ.waterSyncInlandBodies) CBZ.waterSyncInlandBodies(city);
      const inlandAt = CBZ.waterInlandFactorAt || function () { return 0; };

      const shoreAt = city.mapTerrain && typeof city.mapTerrain.shoreAt === "function"
        ? city.mapTerrain.shoreAt : null;

      // ---- the baked shore field -----------------------------------------
      // R: smooth land ramp centred 1.5m inland over a 9m band. The shader
      //    discards R > 0.5, and because R interpolates the cut follows the
      //    real coast smoothly instead of stepping texel to texel.
      // G: waterline proximity, 1 at the shore falling to 0 at 22m out.
      // B: normalised distance into deep water (the depth colour ramp).
      // A: inland-water flag (lake vs. ocean look).
      // 640² over the map bounds: ~1.5x the old texel density for ~1.5x the
      // bake cost, which is the one part of this that is not free.
      let seaLandMaskTex = null;
      const seaLandBounds = new THREE.Vector4(0, 0, 1, 1);
      if (shoreAt && city.mapTerrain && city.mapTerrain.bounds) {
        const mb = city.mapTerrain.bounds;
        seaLandBounds.set(mb.minX, mb.minZ, mb.maxX, mb.maxZ);
        const MS = 640;
        const mask = new Uint8Array(MS * MS * 4);
        for (let mz = 0; mz < MS; mz++) {
          const wz = mb.minZ + (mb.maxZ - mb.minZ) * (mz + 0.5) / MS;
          for (let mx = 0; mx < MS; mx++) {
            const wx = mb.minX + (mb.maxX - mb.minX) * (mx + 0.5) / MS;
            const signed = +shoreAt(wx, wz);
            const land = Math.max(0, Math.min(1, 0.5 + (signed - 1.5) / 9));
            // Surf is a narrow waterline treatment, not a wide second pale
            // band — a wider field used to cover most of Redhollow Lake and
            // visibly split it into alternating blue/white slabs.
            const shoreNear = signed < 0 ? Math.max(0, Math.min(1, 1 - (-signed) / 22)) : 1;
            const deep = signed < 0 ? Math.max(0, Math.min(1, (-signed) / 420)) : 0;
            const q = (mz * MS + mx) * 4;
            mask[q] = Math.round(land * 255);
            mask[q + 1] = Math.round(shoreNear * 255);
            mask[q + 2] = Math.round(deep * 255);
            mask[q + 3] = Math.round(Math.max(0, Math.min(1, inlandAt(wx, wz))) * 255);
          }
        }
        seaLandMaskTex = new THREE.DataTexture(mask, MS, MS, THREE.RGBAFormat);
        seaLandMaskTex.wrapS = seaLandMaskTex.wrapT = THREE.ClampToEdgeWrapping;
        seaLandMaskTex.magFilter = seaLandMaskTex.minFilter = THREE.LinearFilter;
        seaLandMaskTex.generateMipmaps = false;
        seaLandMaskTex.needsUpdate = true;
        CBZ.citySeaFieldTexture = seaLandMaskTex;
        CBZ.citySeaFieldBounds = seaLandBounds;
      }

      // ---- uniforms: BY REFERENCE, never through UniformsUtils.merge ------
      const U = CBZ.waterCommonUniforms();
      U.uSeaLandMask.value = seaLandMaskTex;
      U.uSeaLandBounds.value.copy(seaLandBounds);
      U.uSeaHasLandMask.value = seaLandMaskTex ? 1 : 0;
      U.uSeaY.value = SEA_Y;
      seaUniforms = U;
      CBZ.citySeaUniforms = U;

      const vs = [
        CBZ.waterVertexDecl(),
        "varying vec3 vSeaWorld;",
        "varying vec3 vSeaNormal;",
        "varying float vSeaHeight;",
        "varying float vSeaDist;",
        "varying float vSeaFade;",
        "varying float vSeaInland;",
        "#include <fog_pars_vertex>",
        "void main() {",
        CBZ.waterVertexBody("modelMatrix * vec4(position, 1.0)"),
        "  vSeaWorld = wWorld;",
        "  vSeaNormal = wNormal;",
        "  vSeaHeight = wHeightN;",
        "  vSeaDist = wDist;",
        "  vSeaFade = wFade;",
        "  vSeaInland = wInland;",
        "  vec4 mvPosition = viewMatrix * vec4(wWorld, 1.0);",
        "  gl_Position = projectionMatrix * mvPosition;",
        "  #include <fog_vertex>",
        // Ocean atmosphere accumulates more slowly than city-block fog.
        // Without this, near water stayed richly shaded while the same mesh
        // became a flat baby-blue sheet only a kilometre away.
        "  #ifdef USE_FOG",
        "    fogDepth *= 0.66;",
        "  #endif",
        "}",
      ].join("\n");

      const fs = [
        CBZ.waterFragmentDecl(),
        "varying vec3 vSeaWorld;",
        "varying vec3 vSeaNormal;",
        "varying float vSeaHeight;",
        "varying float vSeaDist;",
        "varying float vSeaFade;",
        "varying float vSeaInland;",
        "#include <fog_pars_fragment>",
        "void main() {",
        "  vec4 field = cbzWaterField(vSeaWorld.xz);",
        // Depth offsets keep the country underlay behind authored roads and
        // runways, but at a 2.8km flight frustum they can also quantise valid
        // land BEHIND the sea. Rejecting sea fragments over dry land outright
        // means water and ground never fight for depth ownership, so there is
        // no green flicker and no apparent ocean growing around trees.
        "  if (uSeaHasLandMask > 0.5 && field.r > cbzShoreCutAt(vSeaWorld.xz)) discard;",
        "  float inland = max(vSeaInland, field.a);",
        // WATER_SURFACE_LOOK: the ripple field, the streak lanes and the shore
        // calm band all live in world/water_spec.js so the planar mirror gets
        // the identical surface. `lane` is 0.5 and `calm` 0 with the flag off,
        // and cbzSeaNormal then runs the exact two-sample ripple this replaced.
        "  float calm = cbzShoreCalm(field);",
        "  float lane = cbzLane(vSeaWorld.xz);",
        "  float detail = mix(0.60, 0.16, smoothstep(90.0, 1500.0, vSeaDist)) * mix(1.0, 0.42, inland) * (1.0 + uChop * 0.5);",
        "  vec3 N = cbzSeaNormal(vSeaNormal, vSeaWorld.xz, vSeaDist, detail, calm, lane);",
        "  vec3 V = normalize(cameraPosition - vSeaWorld);",
        "  float under = gl_FrontFacing ? 0.0 : 1.0;",
        "  N = mix(N, -N, under);",             // looking up from below
        "  vec3 L = normalize(uSunDir);",
        "  float ndl = max(dot(N, L), 0.0);",
        // Mirror Fresnel near, rough-surface Fresnel far (see cbzRough): a
        // faded ripple normal is a MIRROR, and a grazing mirror returns the
        // brightest band of sky, which is what bleached the far ocean white.
        "  float fres = cbzFresnel(dot(N, V), vSeaDist);",
        "  vec3 body = cbzDepthColor(uSeaColor, field, inland);",
        "  vec3 base = body * mix(vec3(0.96, 1.04, 1.09), vec3(0.95, 1.06, 1.03), step(0.001, uLook.x)) + mix(vec3(0.003, 0.012, 0.020), vec3(0.003, 0.012, 0.018), step(0.001, uLook.x));",
        "  base *= 0.63 + ndl * 0.37;",
        // The reflected sky as RADIANCE (horizon band == the live fog colour,
        // deep cool sky overhead) instead of a brightened copy of the water's
        // own colour. Off -> the old expression, byte for byte.
        "  vec3 R = reflect(-V, N);",
        "  vec3 sky = cbzSkyTone(R, cbzRough(vSeaDist, dot(N, V)) * 0.12);",
        "  vec3 skyOld = uSeaColor * 1.34 + vec3(0.060, 0.125, 0.190);",
        "  sky = mix(skyOld, sky * 0.58, step(0.001, uLook.x));",   // REFL_GAIN, water_spec.js
        "  sky = mix(sky, uSunColor * 0.34 + sky * 0.70, 0.22);",
        "  vec3 outColor = mix(base, sky, fres * mix(0.66, 0.90, step(0.001, uLook.x)) * mix(1.0, 0.55, inland));",
        "  outColor += cbzSunGlitter(N, V, L, fres, vSeaFade) * mix(1.0, 0.30, inland);",
        "  outColor += cbzSheen(N, V, L, lane, vSeaDist, fres) * mix(1.0, 0.35, inland);",
        // The old foam was a static bake whose only motion was a brightness
        // pulse. cbzSurf() phases the band by DISTANCE-TO-SHORE minus TIME, so
        // white water advances up the beach and dies at the waterline.
        "  float surf = cbzSurf(vSeaWorld.xz, field, vSeaHeight, vSeaFade);",
        "  float cap = cbzWhitecap(vSeaWorld.xz, vSeaHeight, vSeaFade, inland);",
        "  float foam = clamp(surf * 0.66 + cap * 0.60, 0.0, 0.92) * (1.0 - under * 0.72);",
        // Seen from underneath the surface reads as a bright silvery ceiling
        // that goes mirror-like at grazing angles (total internal reflection).
        "  vec3 underCol = mix(body * 0.72, sky * 1.20 + uSunColor * 0.16, clamp(fres * 1.45, 0.0, 1.0));",
        "  outColor = mix(outColor, underCol, under);",
        "  outColor = mix(outColor, uFoamColor, foam);",
        // HORIZON FUSE (aerial seam): airborne, the camera far plane cuts this
        // 16km disc at 7km while the ocean is still mostly unfogged — its fog
        // runs at 0.66x AND the height fog thins to ~43% at altitude, so the
        // sea slammed into the sky dome as a hard teal-on-grey edge mid-frame.
        // Converge on fogColor before the clip: the pixel then rides the SAME
        // tonemap+encode the graded fog does, landing exactly on the dome's
        // below-horizon band (core/sky.js's seam law), so the edge vanishes.
        // Saturates far beyond ground-level fog range — invisible on foot.
        (CFGW.SEA_HORIZON_FUSE !== false
          ? "  #ifdef USE_FOG\n  outColor = mix(outColor, fogColor, smoothstep(3600.0, 6400.0, vSeaDist));\n  #endif"
          : ""),
        /* SEA_TRANSLUCENT (world/water_spec.js). The sea stops being a painted
           lid. cbzSeaAlpha is a view-angle switch, not a constant: looking
           down into water you see through it, looking ACROSS it you do not,
           and past ~240 m it is 1.0 again — so the horizon fuse two lines up
           still converges on a fully opaque pixel and the far ocean costs
           exactly what it always did. Foam is air and stays opaque; the
           underside (a swimmer looking up) stays a solid silvery ceiling. */
        "  gl_FragColor = vec4(outColor, cbzSeaAlpha(V, vSeaDist, under, foam));",
        "  #include <tonemapping_fragment>",
        "  #include <encodings_fragment>",
        "  #include <fog_fragment>",
        "}",
      ].join("\n");

      const seaClear = CBZ.seaTranslucentOn ? CBZ.seaTranslucentOn() : false;
      seaMat2 = new THREE.ShaderMaterial({
        name: "CBZ Ocean Water",
        uniforms: U,
        fog: true,
        // depthWrite STAYS ON while transparent — see the note in
        // makeDisasterWaterMaterial. The sea must keep owning its depth; all
        // that changes is that it is now drawn after the opaque bodies it has
        // to show through, and blends instead of overwriting.
        depthWrite: true,
        depthTest: true,
        transparent: seaClear,
        side: THREE.DoubleSide,          // you can swim UNDER the sea now
        vertexShader: vs,
        fragmentShader: fs,
      });
      // Preserve the old material.color update contract used by the day/night
      // loop above; it aliases the actual shader uniform.
      seaMat2.color = U.uSeaColor.value;
      seaMat2.userData.waterMode = "fresnel-flow-shore";

      const sea = new THREE.Mesh(CBZ.waterBuildSeaGeometry(), seaMat2);
      sea.name = "world-sea";
      /* THE SEA IS THE FIRST TRANSPARENT THING, ALWAYS. Once it blends, three
         sorts it into the transparent list by the distance to its ORIGIN — and
         because this disc is re-centred on the camera in the vertex shader,
         that distance is meaningless: near the city centre the sea would sort
         LAST and wash over every spray sprite and foam layer already drawn.
         renderOrder -1 pins it ahead of all of them, which is also exactly
         where it sat when it was opaque. */
      sea.renderOrder = -1;
      sea.receiveShadow = false; sea.castShadow = false;
      sea.frustumCulled = false;                   // the horizon is everywhere
      sea.position.set(0, SEA_Y, 0);               // mean level; XZ comes from the shader
      sea.updateMatrix();
      sea.matrixAutoUpdate = false;                // static transform, always
      sea.userData.terrain = true;                 // batch + farcull exempt
      sea.userData.waterSurface = true;
      sea.userData.surfaceOwner = "world-water";
      sea.userData.unifiedSurface = true;
      root.add(sea);
      CBZ.citySea = sea;
      CBZ.citySeaMaterial = seaMat2;

      // A live quality-tier change re-tessellates the disc (cheap: ~10k verts,
      // no texture work, no material rebuild). Tier 0 drops to 56 rings.
      let seaTier = CBZ.qualityLevel != null ? CBZ.qualityLevel : 2;
      if (CBZ.onQualityChange) CBZ.onQualityChange(function (tier) {
        if (tier == null || tier === seaTier) return;
        const a = CBZ.waterTierParams(seaTier), b = CBZ.waterTierParams(tier);
        seaTier = tier;
        if (a.rings === b.rings && a.sectors === b.sectors) return;
        try {
          const old = sea.geometry;
          sea.geometry = CBZ.waterBuildSeaGeometry(tier);
          if (old && old.dispose) old.dispose();
        } catch (e) { console.error("[sea retessellate]", e); }
      });

      // the island annex's own flat ocean plane (expansion.js, y=-0.44) sat
      // ABOVE parts of the wave band — with the real sea in place it could
      // only ever show through as a dead calm disk. REMOVE it (not just
      // visible=false): the static batch pass runs after buildCity and
      // would otherwise fold the plane into a merged bucket where the
      // original's visibility no longer matters. Same material instance =
      // safe identity test; nothing else shares seaMat.
      const oldSeas = [];
      root.traverse(function (o) {
        if (o !== sea && o.isMesh && o.material === seaMat) oldSeas.push(o);
      });
      for (const o of oldSeas) if (o.parent) o.parent.remove(o);
    })();

    root.visible = false;     // hidden until city mode activates
    return city;
  };
})();
