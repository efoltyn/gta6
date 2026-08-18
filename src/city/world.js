/* ============================================================
   city/world.js — the GTA-style open CITY map.

   A bright low-poly downtown built FAR from the prison and the
   disaster island (z≈-700) so all three worlds coexist with zero
   refactor: an escape/survival match never sees it, a city match
   teleports here. Everything lives in one group (city.root) so the
   other modes just hide it.

   This file lays the FOUNDATION only — a flat ground, a regular grid
   of streets with lane lines + crosswalks, sidewalks ringing every
   block, and the descriptor (lots / roads / intersections / waypoint
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
   checker) in residential/projects, poured plazas downtown, stained
   sidewalks + work-yard dirt in projects/industrial, double-yellow
   arterials + painted turn arrows through the Midtown core, red fire
   curbs at hydrants. Photo textures (assets/textures/*.jpg) layer into
   the procedural canvases when present — procedural stays the fallback.

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

    // ---- ground: asphalt base, then sidewalk + lot slabs on top ----
    const baseTex = CBZ.checkerTex ? CBZ.checkerTex("#2b2e33", "#26292e", 2) : null;   // dark asphalt base
    if (baseTex) baseTex.repeat.set(spanX / 8, spanZ / 8);
    photoLayer(baseTex, "assets/textures/asphalt512.jpg", function (g2, c) {
      // keep the near-black city base tone over the photo grain
      g2.globalAlpha = 0.55; g2.fillStyle = "#26292e"; g2.fillRect(0, 0, c.width, c.height); g2.globalAlpha = 1;
    });
    // ground stops just past the seawall line (bounds+26): the city meets the
    // WATER, not an endless gray apron — the +29 edge tucks under the shoreline
    const groundMat = baseTex ? new THREE.MeshLambertMaterial({ map: baseTex }) : mat(0x3a3e45);
    // FOG-RATE HARMONY (owner, from the air: "city areas look bright and
    // rendered while the ground around them is grayer"): the continent plate
    // fogs at 0.08x and the mountain landmarks at 0.12x, but this city slab
    // fogged at the FULL 1.0x rate — from altitude it washed toward the fog
    // colour ~10x faster than the country touching it, so every authored pad
    // read as a differently-lit sticker on the landscape. Same shared helper,
    // same family of rates; the height fog still clears the air up high.
    if (CBZ.terrainFogScale) CBZ.terrainFogScale(groundMat, 0.10);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(spanX + 58, spanZ + 58), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    ground.receiveShadow = true;
    // A land floor is not disposable scenery.  Far-distance culling can keep
    // the measured building LOD alive after hiding an ordinary top-level mesh;
    // exempting the authored surface prevents the skyline from appearing to
    // stand directly in the harbour when viewed from aircraft or a boat.
    ground.userData.terrain = true;
    ground.userData.worldSurface = true;
    ground.name = "mainland-city-surface";
    root.add(ground);

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

    // flat plane helper (decor, no collider). Optional `paintM` supplies a
    // SHARED material (road-paint decals reuse one polygonOffset singleton
    // instead of minting a material per stripe); color/basic are ignored then.
    function plane(x, z, w, d, color, y, basic, paintM) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
        paintM || (basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color })));
      m.rotation.x = -Math.PI / 2; m.position.set(x, y == null ? 0.02 : y, z);
      m.receiveShadow = !basic; root.add(m);
      return m;
    }

    // merged QUAD FIELD: many ground rects → ONE textured mesh. The batch
    // pass (core/batch.js) deliberately skips textured materials, so any
    // surface that wants a map must pre-merge here or pay a draw call per
    // rect. UVs are world-scaled (~8 m per texture repeat) so one repeating
    // texture fits every rect size.
    function quadField(rects, material, y) {
      const n = rects.length;
      const pos = new Float32Array(n * 18), nrm = new Float32Array(n * 18), uvA = new Float32Array(n * 12);
      let p = 0, u = 0;
      for (const r of rects) {
        const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
        const ux = r.w / 8, uz = r.d / 8;
        const V = [[x0, z0, 0, uz], [x0, z1, 0, 0], [x1, z1, ux, 0], [x0, z0, 0, uz], [x1, z1, ux, 0], [x1, z0, ux, uz]];
        for (const v of V) {
          pos[p] = v[0]; pos[p + 1] = y; pos[p + 2] = v[1];
          nrm[p] = 0; nrm[p + 1] = 1; nrm[p + 2] = 0; p += 3;
          uvA[u] = v[2]; uvA[u + 1] = v[3]; u += 2;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uvA, 2));
      const m = new THREE.Mesh(geo, material);
      m.receiveShadow = true; m.matrixAutoUpdate = false; root.add(m);
      return m;
    }

    // ---- roads: one strip per grid line, full span ----
    // Surface: ONE shared asphalt canvas (photo-layered when the jpg exists,
    // flat #282a30 otherwise) across two merged quad-field meshes — 14 strips
    // cost 2 draw calls instead of 14 unmergeable textured planes.
    const roadCv = document.createElement("canvas"); roadCv.width = roadCv.height = 256;
    const roadCg = roadCv.getContext("2d"); roadCg.fillStyle = "#282a30"; roadCg.fillRect(0, 0, 256, 256);
    const roadTex = new THREE.CanvasTexture(roadCv);
    roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
    photoLayer(roadTex, "assets/textures/asphalt512.jpg", function (g2, c) {
      g2.globalAlpha = 0.42; g2.fillStyle = "#26282e"; g2.fillRect(0, 0, c.width, c.height); g2.globalAlpha = 1;
    });
    // wet-road tie-in (feature-detected): CBZ.roadMat() hands back ONE shared
    // MeshStandardMaterial that materials.js keeps darkening/shining as
    // CBZ.weather.intensity rises — same map, same texture, so the merged
    // quadField batching below is untouched (still one material instance
    // shared across both merged meshes). Falls back to the original flat
    // Lambert road if materials.js hasn't loaded (load-order safe).
    const roadMat = CBZ.roadMat
      ? CBZ.roadMat({ map: roadTex, color: 0xffffff })
      : new THREE.MeshLambertMaterial({ map: roadTex });
    const roads = [];     // {x,z,vertical,len} drivable centre-line segments
    // LANE PAINT (multi-lane US street): off the centreline we paint, per side,
    // (lanesPerDir-1) DASHED WHITE lane dividers at ±k*laneW and a SOLID WHITE
    // edge/fog line near the curb (±road/2-0.3); on the centreline a SINGLE
    // yellow on ordinary streets, solid DOUBLE-YELLOW on the two avenues FRAMING
    // the Midtown core (xLines[2]/xLines[4]) so the arterials read at a glance —
    // you know you're downtown (money) without the map. PERF: every stripe on
    // every street is folded into TWO merged meshes (one white, one yellow) via
    // a tiny rect→geometry baker, so 14 multi-lane streets cost 2 draw calls for
    // ALL paint instead of hundreds of dash meshes. No rng draws (deterministic).
    const TRAF = (C.traf) || {};
    const lanesPerDir = Math.max(1, (TRAF.lanesPerDir != null ? TRAF.lanesPerDir : 2) | 0);
    const laneW = (TRAF.laneW != null ? TRAF.laneW : 3.6);
    // ---- THE TWO ARTERIAL AVENUES (xLines[2]/xLines[4]) ----------------------
    // WHY: road "hierarchy" used to be pure paint (double-yellow, zero geometry
    // difference) — every street drove identically. A real downtown has a couple
    // of avenues with a hard median. The old pass squeezed THREE 2.35m lanes per
    // direction into a 16m envelope: narrower than the 3.6m lanes used by every
    // traffic controller, so the painted road and driven road disagreed. CITY.road
    // is now a real 18m four-lane cross-section; avenues keep those same 3.6m
    // travel lanes and add a 0.7m median inside the remaining clear zone.
    // AVE_LANES/AVE_LANEW
    // are stamped onto these two road records (avenue:true), although they now
    // deliberately equal the global traffic contract. Paint and AI therefore
    // agree on lane count and width; the median is the avenue's hierarchy cue.
    const AVENUE_LINES = [2, 4];
    function isAvenueLine(i) { return AVENUE_LINES.indexOf(i) >= 0; }
    const AVE_LANES = lanesPerDir, AVE_LANEW = laneW, AVE_MEDIAN = 0.7;
    const whiteRects = [], yellowRects = [];   // {x,z,w,d}
    // one centred white DASHED line down a span (axis: 'v' along z, 'h' along x)
    function pushDashes(cx, cz, vertical, len, off) {
      const n = Math.max(1, Math.floor(len / 7));
      const seg = len / n, dashL = Math.min(2.6, seg * 0.55);
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + (i + 0.5) * seg;
        if (vertical) whiteRects.push({ x: cx + off, z: cz + t, w: 0.22, d: dashL });
        else whiteRects.push({ x: cx + t, z: cz + off, w: dashL, d: 0.22 });
      }
    }
    // one centred SOLID line (white edge / yellow centre) down a span
    function pushSolid(cx, cz, vertical, len, off, yellow) {
      const arr = yellow ? yellowRects : whiteRects;
      if (vertical) arr.push({ x: cx + off, z: cz, w: 0.18, d: len });
      else arr.push({ x: cx, z: cz + off, w: len, d: 0.18 });
    }
    // Paint the whole lane set for one street. Avenues retain the same legal
    // lane contract as traffic but use a hard median/double-yellow centreline;
    // ordinary streets keep the single-yellow centreline.
    function paintStreet(cx, cz, vertical, len, avenue) {
      const nLanes = avenue ? AVE_LANES : lanesPerDir, lw = avenue ? AVE_LANEW : laneW;
      // centre line: avenues get a wider double-yellow straddling the median;
      // every ordinary street keeps the original single-yellow centreline.
      if (avenue) { pushSolid(cx, cz, vertical, len, -AVE_MEDIAN / 2 - 0.08, true); pushSolid(cx, cz, vertical, len, AVE_MEDIAN / 2 + 0.08, true); }
      else pushSolid(cx, cz, vertical, len, 0, true);
      // dashed dividers BETWEEN lanes on each side (k=1..nLanes-1 — the k=0 slot
      // is the median/centreline itself, already marked above, never re-striped)
      for (let s = -1; s <= 1; s += 2) {
        const base = avenue ? AVE_MEDIAN / 2 : 0;
        for (let k = 1; k < nLanes; k++) pushDashes(cx, cz, vertical, len, s * (base + k * lw));
        // solid edge/fog line just inside the curb
        pushSolid(cx, cz, vertical, len, s * (ROAD / 2 - 0.3), false);
      }
    }
    // ROADS_V2: markings STOP at every intersection (real streets don't run a
    // yellow centreline straight through a junction box — the owner's screenshot
    // of a "floating yellow line" was that continuous centreline crossing the
    // raised intersection patch). Paint each street as per-block segments that
    // end just behind the stop bar (ROAD/2 + 3.0 from each crossing centre);
    // the crossing itself stays bare asphalt + zebra/stop-bar furniture.
    const ROADS_V2 = !CBZ.CONFIG || CBZ.CONFIG.ROADS_V2 !== false;
    const PAINT_SETBACK = ROAD / 2 + 3.0;
    function paintStreetSegmented(fixed, vertical, crossings, avenue) {
      for (let j = 0; j < crossings.length - 1; j++) {
        const c0 = crossings[j] + PAINT_SETBACK, c1 = crossings[j + 1] - PAINT_SETBACK;
        const segLen = c1 - c0;
        if (segLen < 3) continue;
        const mid = (c0 + c1) / 2;
        if (vertical) paintStreet(fixed, mid, true, segLen, avenue);
        else paintStreet(mid, fixed, false, segLen, avenue);
      }
    }
    const aveRects = [], crossRects = [];
    xLines.forEach((x, i) => {              // avenues (run along z)
      const ave = isAvenueLine(i);
      aveRects.push({ x, z: (minZ + maxZ) / 2, w: ROAD, d: spanZ });
      if (ROADS_V2) paintStreetSegmented(x, true, zLines, ave);
      else paintStreet(x, (minZ + maxZ) / 2, true, spanZ, ave);
      // stamp the avenue's real per-segment lane data (lanesPerDir/laneW/avenue)
      // alongside the ordinary {x,z,vertical,len} shape every consumer expects —
      // a plain additive field, invisible to anything that doesn't look for it.
      const seg = { x, z: (minZ + maxZ) / 2, vertical: true, len: spanZ, w: ROAD };
      if (ave) { seg.avenue = true; seg.lanesPerDir = AVE_LANES; seg.laneW = AVE_LANEW; }
      roads.push(seg);
    });
    zLines.forEach((z) => {                 // cross-streets (run along x)
      crossRects.push({ x: (minX + maxX) / 2, z, w: spanX, d: ROAD });
      if (ROADS_V2) paintStreetSegmented(z, false, xLines, false);
      else paintStreet((minX + maxX) / 2, z, false, spanX, false);
      roads.push({ x: (minX + maxX) / 2, z, vertical: false, len: spanX, w: ROAD });
    });
    // ROAD FLICKER (owner, from an aerial screenshot: "the roads flicker").
    // Avenues sat at 0.040 and cross-streets at 0.045 — a FIVE MILLIMETRE gap
    // between two big coplanar quads that overlap at every single intersection.
    // Up close the depth buffer resolves that fine; from altitude, where the
    // near/far range is enormous and precision collapses, 5mm is inside the
    // noise and the two surfaces trade places per frame. That is the flicker,
    // and it appears exactly on the grid crossings because that is the only
    // place the two layers overlap.
    //
    // polygonOffset cannot fix this one: both fields share the SAME roadMat
    // instance, so any offset would move them together. Widening the ladder to
    // 25mm is the honest fix — still visually flat asphalt, four times the
    // depth separation.
    quadField(aveRects, roadMat, 0.040);
    quadField(crossRects, roadMat, 0.065);
    // bake ALL lane paint into two merged flat meshes (white + yellow).
    // PAINTED, NOT GEOMETRY: every marking material is a polygonOffset decal —
    // the depth offset (factor/units -2) does the separation from the asphalt,
    // so the markings sit near-coplanar (tiny y ladder kept only to order the
    // markings among THEMSELVES) instead of visibly hovering above the road.
    function paintMat(color) {
      return new THREE.MeshBasicMaterial({ color: color,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    }
    function paintMesh(rects, color, y) {
      if (!rects.length) return;
      const m = quadField(rects, paintMat(color), y);
      m.receiveShadow = false;
      // BATCH-EXEMPT (the floating-yellow-line root cause): core/batch.js's V2
      // merge re-materials its buckets with a shared plain material, silently
      // DROPPING polygonOffset — the paint then z-fights/parallax-hovers over
      // the asphalt. Non-empty userData spares the mesh (same guard highways.js
      // uses: userData.roadPaint); renderOrder keeps paint drawn after decks.
      m.renderOrder = 1;
      m.userData.roadPaint = true;
      return m;
    }
    paintMesh(whiteRects, 0xeef1f5, 0.055);
    paintMesh(yellowRects, 0xf2c83a, 0.057);
    // permanent raised concrete MEDIAN on the two avenues — was flag-gated decor
    // (CITY_MEDIANS) shared by every line; now it's the avenues' OWN structural
    // tell (always on), sized to the lane layout above (AVE_MEDIAN), and GAPPED
    // at every cross-street so it reads as a real left-turn-pocket median
    // instead of a concrete island bulldozed straight through every intersection
    // (decor only — no collider either way — but a median floating through a
    // 4-way crossing looked wrong once this stopped being an occasional flag).
    // One merged mesh per avenue (BoxGeometry per segment, BGU-folded), so two
    // avenues still cost about 1 extra draw call total, same budget as before.
    {
      const medMat = mat(0x9aa0a6);
      const medGeoms = [];
      AVENUE_LINES.forEach((i) => {
        const x = xLines[i];
        zLines.forEach((z, j) => {
          const zNext = zLines[j + 1];
          if (zNext == null) return;
          const gapLen = Math.max(0, (zNext - z) - ROAD);   // clear of both intersection boxes (each eats ROAD/2 on its near side)
          if (gapLen < 1) return;
          const segZ = (z + zNext) / 2;
          const g = new THREE.BoxGeometry(AVE_MEDIAN, 0.28, gapLen);
          g.translate(x, 0.14, segZ);
          medGeoms.push(g);
        });
      });
      if (medGeoms.length) {
        const BGU = THREE.BufferGeometryUtils;
        if (BGU && BGU.mergeBufferGeometries) {
          const merged = BGU.mergeBufferGeometries(medGeoms);
          const med = new THREE.Mesh(merged, medMat);
          med.castShadow = false; med.matrixAutoUpdate = false; med.updateMatrix(); root.add(med);
        } else {
          for (const g of medGeoms) { const med = new THREE.Mesh(g, medMat); med.castShadow = false; root.add(med); }
        }
      }
    }

    // ---- intersections + crosswalk stripes ----
    const intersections = [];
    // ONE shared polygonOffset decal material for every zebra stripe in the
    // city (was a fresh MeshBasicMaterial per stripe) — paint, not geometry.
    const zebraM = paintMat(0xeef1f5);
    // ALL zebra stripes accumulate into one merged quadField (was ~60 separate
    // planes PER intersection — thousands of meshes the batcher merged while
    // stripping their polygonOffset, the same float bug as the centrelines).
    const zebraRects = [];
    xLines.forEach((x, i) => zLines.forEach((z, j) => {
      plane(x, z, ROAD, ROAD, 0x202227, 0.05);   // darker box at the crossing
      // zebra stripes on all four approaches — stripe COUNT scales with the
      // road width (ceil(road/1.2)) so a wide multi-lane road gets a full
      // crosswalk that spans it instead of a fixed 5-stripe band.
      const zk = Math.max(2, Math.ceil(ROAD / 1.2) >> 1);
      for (let s = -1; s <= 1; s += 2) {
        for (let k = -zk; k <= zk; k++) {
          zebraRects.push({ x: x + k * 1.1, z: z + s * (ROAD / 2 + 1.2), w: 0.7, d: 2.0 });
          zebraRects.push({ x: x + s * (ROAD / 2 + 1.2), z: z + k * 1.1, w: 2.0, d: 0.7 });
        }
      }
      intersections.push({ x, z, i, j, phase: (i + j) % 2 === 0 ? 0 : 1, t: rng() * 6, ns: true, light: null });
    }));
    if (zebraRects.length) {
      const zm = quadField(zebraRects, zebraM, 0.063);
      zm.receiveShadow = false; zm.renderOrder = 1; zm.userData.roadPaint = true;
    }

    // ---- blocks: a sidewalk slab + a DISTRICT-flavoured lot pad ----
    // GROUND IDENTITY (why: you should know WHERE you are — and where the
    // money is — without the map): residential + projects keep grass yards
    // wearing the island's exact checker (the two landmasses read as one
    // world), the core + commercial blocks get poured concrete plazas,
    // industrial gets an oil-stained work yard, and projects/industrial
    // sidewalks run darker (stained, unwashed) than downtown's bright beige.
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
    const lots = [], grassRects = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const bx = (xLines[i] + xLines[i + 1]) / 2;
      const bz = (zLines[j] + zLines[j + 1]) / 2;
      const dq = districtQ(i, j);
      const dk = (DISTRICTS[dq] && DISTRICTS[dq].kind) || "";
      // The sidewalk belongs INSIDE the block envelope. BLK+4 stole two metres
      // from each side of every road: a nominal 18m four-lane street became 14m
      // of visible asphalt, narrower than its four 3.6m traffic lanes. Keeping
      // the slab at BLK and insetting the lot produces a real 2m sidewalk band.
      plane(bx, bz, BLK, BLK,
        (dk === "projects" || dk === "industrial") ? 0xa39a7e : 0xc2b896, 0.08);
      // lot/yard pad in the centre (buildings sit on it)
      const lotW = BLK - 4, lotD = BLK - 4;
      if (dk === "core" || dk === "commercial") plane(bx, bz, lotW, lotD, 0xaab0b6, 0.10);   // poured plaza
      else if (dk === "industrial") plane(bx, bz, lotW, lotD, 0x767064, 0.10);               // dusty work yard
      else grassRects.push({ x: bx, z: bz, w: lotW, d: lotD });                              // grass yard
      lots.push({ cx: bx, cz: bz, w: lotW, d: lotD, i, j, district: dq, kind: null, building: null });
    }
    // every grass yard in ONE textured mesh (the batch pass skips maps)
    if (grassRects.length) quadField(grassRects, grassMat, 0.10);

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

    // ---- WHERE A DECAL SITS (the drawn ground, not the walkable floor) ----
    //  groundHeightAt below is the WALKABLE floor, and across the flat city
    //  that is 0 everywhere. But the ground is DRAWN as a stack of thin slabs
    //  ABOVE it — avenues 0.040, cross streets 0.065, the block sidewalk slab
    //  0.08, lot pads and grass yards 0.10 (see the road/block passes above).
    //  So anything seated on floorAt() + a few centimetres (blood pools, tyre
    //  smears) lands INSIDE that stack: on the road it clears the asphalt and
    //  shows, on a block it is 2-6 cm UNDER the sidewalk slab and the depth
    //  test eats it whole. Fall off a tower onto the kerb and the blood is
    //  simply not there — which is exactly the report.
    //  This returns the top of whatever is actually drawn at (x,z). On real
    //  terrain (Mount Mercy) none of these slabs exist, so the walkable floor
    //  is the answer and the old behaviour stands.
    const GY_ROAD = 0.065, GY_WALK = 0.08, GY_LOT = 0.10;
    function groundDecalYAt(x, z) {
      const real = Math.max(0, CBZ.cityGroundHeightAt ? (+CBZ.cityGroundHeightAt(x, z) || 0) : 0);
      if (real > 0.2) return real;                                  // raised terrain: no slabs
      if (x < minX || x > maxX || z < minZ || z > maxZ) return real; // off the grid entirely
      // distance to the nearest block centre on each axis (blocks sit halfway
      // between two road centre-lines, one `step` apart)
      const dx = Math.abs((((x - xLines[0]) % step) + step) % step - step / 2);
      const dz = Math.abs((((z - zLines[0]) % step) + step) % step - step / 2);
      if (dx > BLK / 2 || dz > BLK / 2) return GY_ROAD;              // carriageway
      const lotHalf = (BLK - 4) / 2;                                 // the lot/yard pad
      return (dx <= lotHalf && dz <= lotHalf) ? GY_LOT : GY_WALK;    // pad, else sidewalk band
    }

    city = {
      root, center: { x: cx, z: cz },
      N, step, BLK, ROAD, xLines, zLines, minX, maxX, minZ, maxZ,
      lots, roads, intersections, rng,
      // the day/night-tinted water material — expansion.js's island ocean can
      // share it so the whole sea shifts tone together
      seaMat,
      // the waterfront lines + the south seawall's beach gap (city/beach.js
      // builds sand/boardwalk/pier inside this span; the wall above skips it)
      shore: { EW, EE, ES, EN, beach: { x0: BX0, x1: BX1 } },
      // Universal ground-height oracle (mode.js routes CBZ.floorAt here in
      // city mode). Decorative backdrop terrain is disabled; only registered,
      // reachable landmasses may raise the floor. Mount Mercy is the first
      // provider, and its render mesh samples the exact same function.
      groundHeightAt(x, z) {
        const real = CBZ.cityGroundHeightAt ? (+CBZ.cityGroundHeightAt(x, z) || 0) : 0;
        return Math.max(0, real);
      },
      // top of the DRAWN ground stack — what a ground decal seats on. See the
      // note on groundDecalYAt above; never feed this to physics or footing.
      groundDecalY: groundDecalYAt,
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

    // =====================================================================
    //  ROAD + SIDEWALK SURFACE DETAIL — cheap flat geometry that makes the
    //  streets read as REAL: raised curbs along every block, painted stop-bars
    //  at intersections, manhole covers + storm-drain grates, sidewalk
    //  expansion joints, and a sprinkle of asphalt patches/oil stains. All
    //  decor: no colliders, nothing placed in a driving lane.
    // =====================================================================
    let paintRedCurb = null;   // set inside roadDetail; used after the props hook
    let redCurbsPainted = 0;   // census for CBZ.solidityAudit()
    (function roadDetail() {
      // shared materials so hundreds of marks cost almost nothing
      const M = new Map();
      function dm(color, basic) {
        let m = M.get(color + "|" + (basic ? 1 : 0));
        if (!m) {
          // basic == a flat painted marking → polygonOffset decal so it hugs
          // the asphalt like paint; lambert stays plain (curbs/manholes are
          // raised/shadowed geometry, not paint).
          m = basic
            ? new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
            : new THREE.MeshLambertMaterial({ color });
          M.set(color + "|" + (basic ? 1 : 0), m);
        }
        return m;
      }
      // a flat decal quad lying on the ground
      function decal(x, z, w, d, color, y, basic, rotY) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), dm(color, basic));
        m.rotation.x = -Math.PI / 2; if (rotY) m.rotation.z = rotY;
        m.position.set(x, y == null ? 0.085 : y, z);
        m.receiveShadow = !basic; root.add(m);
        return m;
      }
      // a low raised curb box (a sliver of height so it reads as a kerb edge)
      const curbM = dm(0xb9ad88);
      function curb(x, z, len, vertical) {
        const w = vertical ? 0.34 : len, d = vertical ? len : 0.34;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), curbM);
        m.position.set(x, 0.11, z); m.receiveShadow = true; root.add(m);
      }

      // ---- 1) curbs ringing every block (just inside the sidewalk band) ----
      // The sidewalk slab is BLK wide (the road-width pass pulled it back so the
      // full 18m of asphalt shows); the kerb runs along the road-facing edge a
      // touch in from the asphalt so cars visibly mount it but it never blocks.
      // (Was (BLK+4)/2 — that left every kerb box stranded 1.8m OUT in the
      // carriageway once the slab shrank: raised strips lining every street that
      // read as walls and visually narrowed the road.)
      const sidewalkHalf = BLK / 2;
      /* THE DROPPED KERB. Every block used to be ringed by four UNBROKEN runs
         of stone: not one property in the city had a way in that the world
         drew. city/approach.js solves ONE crossing per parcel (the face the
         door goes on, which is a function of the lot and the city centre and
         therefore knowable HERE, hundreds of lines before any building
         exists), and this run is split around it — so the gap in the kerb and
         the driveway laid through it come from the same solve and can never
         end up in different places. Feature-detected: no approach.js, or the
         flag off, and every run is drawn whole exactly as before. */
      function curbRun(x, z, span, vertical, gap) {
        if (!gap) { curb(x, z, span, vertical); return; }
        // `gap` is the crossing's centre along this run's axis, in world
        // coordinates, and its half-width. A crossing that does not actually
        // fall inside the run leaves the run whole.
        const c0 = (vertical ? z : x) - span / 2, c1 = c0 + span;
        const g0 = gap.at - gap.half, g1 = gap.at + gap.half;
        if (g1 <= c0 || g0 >= c1) { curb(x, z, span, vertical); return; }
        // A stub shorter than the kerb is thick is not a kerb, it is a pebble.
        if (g0 - c0 > 0.5) curb(vertical ? x : (c0 + g0) / 2, vertical ? (c0 + g0) / 2 : z, g0 - c0, vertical);
        if (c1 - g1 > 0.5) curb(vertical ? x : (g1 + c1) / 2, vertical ? (g1 + c1) / 2 : z, c1 - g1, vertical);
      }
      for (const lot of lots) {
        const cx2 = lot.cx, cz2 = lot.cz, e = sidewalkHalf - 0.2, span = BLK - 0.8;
        const ap = CBZ.cityLotApproach ? CBZ.cityLotApproach(lot, { x: cx, z: cz }) : null;
        // the crossing sits on ONE face; the other three runs stay whole
        const gz0 = (ap && ap.nz < 0) ? { at: ap.x, half: ap.half + 0.6 } : null;   // -z face
        const gz1 = (ap && ap.nz > 0) ? { at: ap.x, half: ap.half + 0.6 } : null;   // +z face
        const gx0 = (ap && ap.nx < 0) ? { at: ap.z, half: ap.half + 0.6 } : null;   // -x face
        const gx1 = (ap && ap.nx > 0) ? { at: ap.z, half: ap.half + 0.6 } : null;   // +x face
        curbRun(cx2, cz2 - e, span, false, gz0);
        curbRun(cx2, cz2 + e, span, false, gz1);
        curbRun(cx2 - e, cz2, span, true, gx0);
        curbRun(cx2 + e, cz2, span, true, gx1);
        // sidewalk expansion-joint lines (subtle scored concrete grid)
        for (let s = -1; s <= 1; s += 2) {
          for (let j = -1; j <= 1; j += 1) {
            if (j === 0) continue;
            decal(cx2 + j * (BLK / 4), cz2 + s * (sidewalkHalf - 1.0), 0.06, 2.2, 0xa89e7c, 0.088, true);
            decal(cx2 + s * (sidewalkHalf - 1.0), cz2 + j * (BLK / 4), 2.2, 0.06, 0xa89e7c, 0.088, true);
          }
        }
      }

      // ---- 2) painted STOP-BAR at every intersection approach --------------
      // ROAD/2 + 3.6, not 2.6: at 2.6 the bar sat 0.2 m behind the zebra, and
      // MUTCD wants a stop line set back at least 1.2 m from a crosswalk so a
      // stopped car does not overhang the people crossing in front of it.
      // (line ~933's aOff = stopOff + 1.7 follows this for free.)
      const stopOff = ROAD / 2 + 3.6;
      intersections.forEach((it) => {
        // thick white bar across each of the four entries, set back behind the zebra
        decal(it.x - ROAD / 4, it.z - stopOff, ROAD / 2 - 0.4, 0.4, 0xeef1f5, 0.065, true);
        decal(it.x + ROAD / 4, it.z + stopOff, ROAD / 2 - 0.4, 0.4, 0xeef1f5, 0.065, true);
        decal(it.x - stopOff, it.z + ROAD / 4, 0.4, ROAD / 2 - 0.4, 0xeef1f5, 0.065, true);
        decal(it.x + stopOff, it.z - ROAD / 4, 0.4, ROAD / 2 - 0.4, 0xeef1f5, 0.065, true);
      });

      // ---- 3) manhole covers + storm-drain grates -------------------------
      // covers down the centre of avenues; grates hug the kerb at corners where
      // gutter water would drain. Both are flush decals.
      const manholeG = new THREE.CircleGeometry(0.55, 12);
      const manM = dm(0x35383d), grateM = dm(0x202327);
      function manhole(x, z) {
        const m = new THREE.Mesh(manholeG, manM);
        m.rotation.x = -Math.PI / 2; m.position.set(x, 0.066, z); root.add(m);
        // a couple of concentric scribe rings via thin ring decals
        decal(x, z, 0.84, 0.84, 0x2a2d32, 0.067, true);
      }
      for (const r of roads) {
        const n = Math.max(1, Math.floor(r.len / 40));
        for (let i = 1; i < n; i++) {
          if (rng() > 0.6) continue;
          const t = -r.len / 2 + i * (r.len / n) + (rng() - 0.5) * 6;
          const x = r.vertical ? r.x + (rng() - 0.5) * 1.2 : r.x + t;
          const z = r.vertical ? r.z + t : r.z + (rng() - 0.5) * 1.2;
          if (Math.abs(x) < 9990) manhole(x, z);
        }
      }
      // gutter grates near intersection corners
      intersections.forEach((it) => {
        for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
          if (rng() > 0.5) continue;
          const gx = it.x + sx * (ROAD / 2 + 0.5), gz = it.z + sz * (ROAD / 2 + 0.5);
          const g = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), grateM);
          g.rotation.x = -Math.PI / 2; g.position.set(gx, 0.066, gz); root.add(g);
        }
      });

      // ---- 4) asphalt patches + oil stains + tyre marks (grime/realism) ----
      const patchCols = [0x1b1d22, 0x222429, 0x303236];
      for (const r of roads) {
        const n = Math.max(2, Math.floor(r.len / 30));
        for (let i = 0; i < n; i++) {
          if (rng() > 0.55) continue;
          const t = -r.len / 2 + (i + rng()) * (r.len / n);
          const lane = (rng() - 0.5) * (ROAD - 2);
          const x = r.vertical ? r.x + lane : r.x + t;
          const z = r.vertical ? r.z + t : r.z + lane;
          if (Math.abs(x) > 9990) continue;
          const w = 1.5 + rng() * 3, d = 1.0 + rng() * 2.5;
          decal(x, z, r.vertical ? d : w, r.vertical ? w : d, patchCols[(rng() * patchCols.length) | 0], 0.055 + rng() * 0.006, false, (rng() - 0.5) * 0.4);
        }
      }
      // skid/oil stains right in the intersection boxes (where cars launch off)
      intersections.forEach((it) => {
        if (rng() > 0.5) return;
        for (let s = 0; s < 2; s++) {
          decal(it.x + (rng() - 0.5) * ROAD * 0.5, it.z + (rng() - 0.5) * ROAD * 0.5, 0.18, 1.4 + rng() * 1.2, 0x141519, 0.053, true, (rng() - 0.5) * 1.4);
        }
      });

      // ---- 5) painted TURN ARROWS at the Midtown-core intersections --------
      //  (why: managed, money-side streets — the core LOOKS administered).
      //  Shared geometry + the dm() cache; no rng draws, so everything the
      //  sibling modules build from city.rng stays byte-identical.
      const arrowM = dm(0xeef1f5, true);
      const shaftGV = new THREE.PlaneGeometry(0.26, 1.5), shaftGH = new THREE.PlaneGeometry(1.5, 0.26);
      const headG = new THREE.CircleGeometry(0.42, 3);   // 3-segment circle = clean triangle head
      function turnArrow(x, z, fx, fz, rotZ) {
        // shaft along the lane; the head sits at the shaft's front, rotated
        // 90° toward the curb — reads as a right-turn lane marking
        const sM = new THREE.Mesh(fx ? shaftGH : shaftGV, arrowM);
        sM.rotation.x = -Math.PI / 2; sM.position.set(x, 0.065, z); root.add(sM);
        const h = new THREE.Mesh(headG, arrowM);
        h.rotation.x = -Math.PI / 2; h.rotation.z = rotZ;
        h.position.set(x + fx * 0.95, 0.065, z + fz * 0.95); root.add(h);
      }
      // PER-LANE turn arrows at the new lane centres (laneW*(idx+0.5)): the
      // outermost lane on each approach gets the right-turn marking, so the
      // arrows sit ON the real lanes the traffic AI drives in.
      const aOff = stopOff + 1.7, outLane = laneW * (lanesPerDir - 1 + 0.5);
      intersections.forEach((it) => {
        if (it.i < 2 || it.i > 4 || it.j < 2 || it.j > 4) return;   // the Midtown frame only
        turnArrow(it.x + outLane, it.z - aOff, 0, 1, 0);              // south approach → head +x
        turnArrow(it.x - outLane, it.z + aOff, 0, -1, Math.PI);       // north approach → head -x
        turnArrow(it.x - aOff, it.z - outLane, 1, 0, Math.PI / 2);    // west approach → head -z
        turnArrow(it.x + aOff, it.z + outLane, -1, 0, -Math.PI / 2);  // east approach → head +z
      });

      // ---- 6) RED CURB painter (fire lanes) --------------------------------
      //  props.js places hydrants AFTER this pass, so expose a painter the
      //  post-props pass at the bottom of buildCity uses.
      //
      //  OWNER, with a screenshot: "the fire extinguisher thing is to prevent
      //  people parking — cool idea but it shouldn't be geometry... when not
      //  perfect like this in the street it's really annoying, one of those
      //  dumb props." TWO separate faults, and the second one is already
      //  written up as fixed 120 lines above — for the KERB, never for this:
      //
      //  (1) IT WAS GEOMETRY. A 4.2 x 0.24 x 0.38 BoxGeometry: a 24 cm tall red
      //      bar lying loose in the street, with no collider, so it was a
      //      solid-LOOKING object you drove straight through — a decoy twice
      //      over. A no-parking fire lane is PAINT ON A KERB. It is now a flat
      //      quad on the kerb top through the same polygonOffset `dm(...,true)`
      //      decal idiom every stop bar, zebra and turn arrow in this pass uses.
      //  (2) ITS OFFSET WAS STALE. The caller solved the kerb line as
      //      (BLK + 4) / 2 - 0.2 — the EXACT expression the kerb loop above
      //      abandoned when the road width changed ("Was (BLK+4)/2 — that left
      //      every kerb box stranded 1.8m OUT in the carriageway"). The kerbs
      //      moved in by 2 m; this did not, so the bar stood ~1.8 m out in the
      //      travel lane, detached from the hydrant it belongs to. The painter
      //      now takes the LOT and solves the line off `sidewalkHalf` ITSELF,
      //      so no caller can re-type it and the stripe hugs whichever kerb the
      //      hydrant fronts BY CONSTRUCTION rather than by a matching literal.
      paintRedCurb = function (lot, px, pz) {
        const e = sidewalkHalf - 0.2;                    // == the kerb loop's own offset
        const dx = px - lot.cx, dz = pz - lot.cz;
        const vertical = Math.abs(dx) > Math.abs(dz);    // kerb runs along Z
        // 4.2 m of red centred on the hydrant, 0.34 wide = the kerb box's OWN
        // width (line ~830), 5 mm over the kerb top (0.22) so it never z-fights
        // and never reads as a step. Basic material: it is paint, not a solid.
        const w = vertical ? 0.34 : 4.2, d = vertical ? 4.2 : 0.34;
        const x = vertical ? lot.cx + (dx >= 0 ? e : -e) : px;
        const z = vertical ? pz : lot.cz + (dz >= 0 ? e : -e);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), dm(0xc23434, true));
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.225, z);
        m.receiveShadow = false; root.add(m);
        redCurbsPainted++;
      };
    })();

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
    city._redCurbs = redCurbsPainted;

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
        "  if (uSeaHasLandMask > 0.5 && field.r > uShoreCut) discard;",
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
        "  gl_FragColor = vec4(outColor, 1.0);",
        "  #include <tonemapping_fragment>",
        "  #include <encodings_fragment>",
        "  #include <fog_fragment>",
        "}",
      ].join("\n");

      seaMat2 = new THREE.ShaderMaterial({
        name: "CBZ Ocean Water",
        uniforms: U,
        fog: true,
        depthWrite: true,
        depthTest: true,
        transparent: false,
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
