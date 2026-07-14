/* ============================================================
   city/biome_snow.js — THE SNOWY MOUNTAIN RANGE biome.

   An archipelago landmass module (see worldmap.js CONTRACT). Builds a
   snowy valley rising into one REAL northern massif. The mountain mesh and
   city floor oracle share the same analytic height function, so the slopes
   can be walked, landed on and used by physics — no decorative skyline ring.
   A
   frozen LAKE (icy plane), instanced snowy PINES, rocky outcrops and
   snowdrifts fill it; the WHY-justified landmarks are a cozy enterable SKI
   LODGE (fireplace), a moving CHAIRLIFT up a slope, a slalom SKI RUN, a
   mountain cabin and a frozen-over outpost. A winding causeway connects the
   south edge down toward the speedway island.

   DRAW-CALL DISCIPLINE: pines / rocks / drifts / lift-chairs / guardrail
   posts are InstancedMesh (one draw call each); the massif is one mesh.
   Bright point-sprite snowfall is disabled: from aircraft it read as dots
   stuck to the HUD. Everything is deterministic from a local seeded rng.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const CFGS = (CBZ.CONFIG = CBZ.CONFIG || {});
  // SOLID rim ranges: the old buildRidgedRange sheets hang their back edge
  // ~25% peak height in MID-AIR (hollow shells from the air). The solid
  // path builds closed "massif pads" whose height envelope reaches the
  // ground on every border. Revert: CBZ.CONFIG.SNOW_SOLID_RANGE = false.
  if (CFGS.SNOW_SOLID_RANGE == null) CFGS.SNOW_SOLID_RANGE = true;
  if (CFGS.SNOWFALL_POINTS == null) CFGS.SNOWFALL_POINTS = false;

  // ---- footprint (per spec): rect center (350,-1450), half (420,330) ------
  const CX = 350, CZ = -1450, HX = 420, HZ = 330;
  const MINX = CX - HX, MAXX = CX + HX;     // -70 .. 770
  const MINZ = CZ - HZ, MAXZ = CZ + HZ;     // -1780 .. -1120

  // local seeded rng — never touch Math.random (determinism contract)
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // shared palette — snow, ice, rock, pine, lodge timber
  const COL = {
    snow: 0xeef3f8, snowShade: 0xdde6ef, ice: 0xbfd9e6, iceDeep: 0x9cc2d6,
    rock: 0x6d7480, rockDark: 0x565c66, pine: 0x2f5d44, pineDk: 0x244a36,
    trunk: 0x5a4632, timber: 0x7a5638, timberDk: 0x5e4129, roofSnow: 0xe7eef5,
    steel: 0x8a8f97, cable: 0x3a3d42, chair: 0xc23a3a, ember: 0xff7a2a, flag: 0xd23b3b,
  };

  // ============================================================
  CBZ.addLandmass(function (city) {
    const root = city.root;
    if (!root) return;
    const mat = CBZ.mat, cmat = CBZ.cmat || CBZ.mat;
    const rng = mulberry((CBZ.WORLD_SEED != null ? CBZ.WORLD_SEED : 0x53170) ^ ((CX * 73856093) ^ (CZ * 19349663)));

    // shared materials (one instance each — draw-call friendly)
    const mSnow = cmat(COL.snow), mSnowShade = cmat(COL.snowShade);
    const mRock = cmat(COL.rock), mPine = cmat(COL.pine), mPineDk = cmat(COL.pineDk);
    const mTrunk = cmat(COL.trunk), mSteel = cmat(COL.steel);
    const mTimber = cmat(COL.timber), mTimberDk = cmat(COL.timberDk);

    function pushCol(minX, maxX, minZ, maxZ, y0, y1, ref) {
      const c = { minX, maxX, minZ, maxZ, ref: ref || null };
      if (y0 != null) c.y0 = y0;
      if (y1 != null) c.y1 = y1;
      CBZ.colliders.push(c);
      return c;
    }
    function box(x, y, z, w, h, d, m, solid) {
      const me = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d), m);
      me.position.set(x, y, z);
      me.castShadow = true; me.receiveShadow = true;
      root.add(me);
      if (solid) pushCol(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y - h / 2, y + h / 2, me);
      return me;
    }
    function tag(group, text, y) {
      if (!CBZ.makeLabelSprite) return;
      const s = CBZ.makeLabelSprite(text);
      if (!s) return;
      s.position.set(0, y, 0); s.scale.set(7, 1.68, 1);
      group.add(s);
    }

    // ---- PINECREST resort town (T8) ---------------------------------------
    // A real alpine RESORT VILLAGE grown from the reusable generator using the
    // snow-tied recipe (citytemplates.js: lodge/outfitter/clinic/gear-pawn/spa).
    // Placed on FLAT base ground SE of the existing lodge + ski run (the snow
    // valley is dead-flat per terrain.js, so it sits level), clear of the lodge,
    // ski run, lake, cabin, outpost + lift. The pine/rock scatter SKIPS this rect
    // via inTown so trees don't grow in the village — gated on HAS_TOWN so the
    // biome is byte-identical if towngen is absent (zero regression).
    const HAS_TOWN = typeof CBZ.buildTown === "function" && !!(CBZ.CITY_TEMPLATES && CBZ.CITY_TEMPLATES.pinecrest);
    const TOWN_CX = 640, TOWN_CZ = -1230, TOWN_HX = 110, TOWN_HZ = 80;
    const TOWN = { minX: TOWN_CX - TOWN_HX, maxX: TOWN_CX + TOWN_HX, minZ: TOWN_CZ - TOWN_HZ, maxZ: TOWN_CZ + TOWN_HZ };
    function inTown(x, z) {
      return HAS_TOWN && x > TOWN.minX - 8 && x < TOWN.maxX + 8 && z > TOWN.minZ - 8 && z < TOWN.maxZ + 8;
    }
    const layout = CBZ.worldLayout;
    // Declare the resort's future landmarks before vegetation is scattered.
    // This prevents pines, rocks, and drifts from being generated through the
    // lodge, lake, lift, ski run, village, and causeway.
    if (layout) {
      if (HAS_TOWN) layout.reserve("snow:pinecrest", TOWN, { pad: 12 });
      layout.reserveCircle("snow:lake", 180, -1380, 104, { pad: 2 });
      layout.reserve("snow:lodge", { minX: 344, maxX: 376, minZ: -1264, maxZ: -1236 }, { pad: 8 });
      layout.reserve("snow:cabin", { minX: 590, maxX: 610, minZ: -1610, maxZ: -1590 }, { pad: 8 });
      layout.reserve("snow:outpost", { minX: 76, maxX: 104, minZ: -1654, maxZ: -1626 }, { pad: 8 });
      layout.reserve("snow:ski-run", { minX: 448, maxX: 492, minZ: -1735, maxZ: -1285 }, { pad: 5 });
      layout.reserve("snow:lift", { minX: 226, maxX: 484, minZ: -1734, maxZ: -1166 }, { pad: 5 });
      layout.reserve("snow:causeway", { minX: 458, maxX: 482, minZ: -1120, maxZ: -530 }, { pad: 3 });
    }
    function claimNature(x, z, r) { return !layout || layout.claimNature(x, z, r, { pad: 0.35 }); }
    function openNature(x, z, r) { return !layout || layout.canPlaceNature(x, z, r, { pad: 0.2 }); }
    let mountainHeightAt = function () { return 0; };

    // ---- snowy GROUND plane (flat valley, y just above 0) ----------------
    (function ground() {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 + 40, HZ * 2 + 40),
        new THREE.MeshLambertMaterial({ color: COL.snow }));
      g.rotation.x = -Math.PI / 2;
      g.position.set(CX, 0.02, CZ);
      g.receiveShadow = true;
      g.userData.terrain = true;
      g.userData.worldSurface = true;
      g.name = "snow-valley-surface";
      root.add(g);
      // Feather only beyond the snow plateau; a larger full plane underneath
      // made the biome visibly overlap the sea/terrain as a square tile.
      if (CBZ.makeBiomeEdgeRing) {
        CBZ.makeBiomeEdgeRing(root, {
          cx: CX, cz: CZ, hx: HX + 20, hz: HZ + 20, feather: 20, segments: 20,
          inner: COL.snowShade, outer: 0xb7a878, y: 0.006, seed: 0x53170, owner: "snow",
        });
      }
    })();

    // ---- THE RANGE: tall snow-capped PEAKS ringing the valley edges ------
    // Each peak = a rock cone + a snow-cap cone on top; base gets a collider
    // square so the player walks AROUND them. They sit on the rim, leaving a
    // traversable valley/plateau in the middle.
    (function peaks() {
      // ----------------------------------------------------------------
      //  REAL low-poly snow-mountain RANGE (replaces the flat cones).
      //  Each ridge = a displaced grid strip (cols along the ridge x rows
      //  deep) emitted as NON-INDEXED triangles so flat-shaded facets read
      //  crisp. Heights come from a seeded RIDGED-fbm noise → connected
      //  craggy ridgelines. Per-vertex COLOR by altitude+slope: rock base,
      //  ragged snowline, dark cliff faces, lit/shaded snow facets. A
      //  valleyGuard term forces the valley-facing edge to y=0 so the flat
      //  walkable floor is never lifted. All ridges merge to 2 meshes.
      //
      //  CONSOLIDATED (was its own hand-rolled copy of this math with a
      //  silently-drifted 0.42 snowline vs world/terrain.js's 0.48): both now
      //  call the ONE shared window.noise.buildRidgedRange helper in
      //  src/vendor/noise.js, so the noise + altitude/slope shading are
      //  byte-identical between the two ranges. Only the LAYOUT (rect edges,
      //  valley-side footGuard threshold, peak amplitudes) stays local — that
      //  is genuinely this biome's own geometry, not duplicated math.
      // ----------------------------------------------------------------
      const BGU = THREE.BufferGeometryUtils;
      const buildRidge = window.noise && window.noise.buildRidgedRange;
      if (!buildRidge) return;     // headless / noise.js missing: skip the range, biome still stands
      const NZ = window.noise;
      const SOLID = CFGS.SNOW_SOLID_RANGE !== false &&
        !!(NZ.rangeRidgedFbm && NZ.rangeVnoise && NZ.rangeShadeVert);

      // ----------------------------------------------------------------
      //  CLOSED MASSIF PAD (the SOLID path): same noise/shading family as
      //  buildRidgedRange, but three broad 2-D peak lobes and their saddles
      //  are multiplied by a sin border falloff (zero on all four edges), so
      //  this reads as a mountain group rather than one long triangular wall.
      //  The pad still closes on flat ground from every angle — no hanging
      //  back edge, no hollow shell. Faces are emitted with a
      //  consistent up-winding so the default FrontSide material works
      //  (half the fragment cost of the old DoubleSide sheets).
      //  Same call/return shape as buildRidgedRange: {geo, spine}.
      // ----------------------------------------------------------------
      function buildPad(T, p0, p1, depthDir, cfg) {
        const cols = cfg.cols, rows = cfg.rows + 2;   // +2 depth rows: the closed back wants resolution
        const peakAmp = cfg.peakAmp, depthLen = cfg.depthLen;
        const seedOff = cfg.seedOff, ns = cfg.noiseScale;
        const dx = p1.x - p0.x, dz = p1.z - p0.z;
        function sampleHeight(u, v, bx, bz) {
          if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
          // Smoothstep the closed border. The old sub-linear power climbed
          // almost vertically at the footprint edge, which made the whole
          // massif read as one giant triangular mound from the airfield.
          const edge = Math.max(0, Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
          const border = edge * edge * (3 - 2 * edge);
          function lobe(cu, cv, su, sv, amp) {
            const du = (u - cu) / su, dv = (v - cv) / sv;
            return amp * Math.exp(-0.5 * (du * du + dv * dv));
          }
          // Five asymmetric peaks create a recognisable range silhouette. Max
          // (rather than sum) preserves real saddles between the summits; one
          // low broad lobe underneath joins them into walkable foothills.
          const base = lobe(0.51, 0.53, 0.50, 0.46, 0.11);
          const peaks = Math.max(
            lobe(0.15, 0.56, 0.13, 0.23, 0.65),
            lobe(0.35, 0.44, 0.15, 0.22, 0.82),
            lobe(0.56, 0.57, 0.15, 0.23, 1.00),
            lobe(0.76, 0.45, 0.14, 0.21, 0.78),
            lobe(0.89, 0.62, 0.10, 0.17, 0.52)
          );
          const crag = 0.74 + 0.26 * NZ.rangeRidgedFbm(
            (bx + seedOff) * ns, (bz - seedOff) * ns);
          const shoulder = 0.04 + base + peaks;
          return peakAmp * border * shoulder * crag;
        }
        const gx = [], gz = [], gy = [];
        for (let r = 0; r <= rows; r++) {
          gx[r] = []; gz[r] = []; gy[r] = [];
          for (let c = 0; c <= cols; c++) {
            const u = c / cols, v = r / rows;
            const bx = p0.x + dx * u + depthDir.x * (v * depthLen);
            const bz = p0.z + dz * u + depthDir.z * (v * depthLen);
            gx[r][c] = bx; gz[r][c] = bz;
            gy[r][c] = sampleHeight(u, v, bx, bz);
          }
        }
        const spine = [];
        for (let c = 0; c <= cols; c++) {
          let mh = 0, mr = 1;
          for (let r = 1; r <= rows; r++) if (gy[r][c] > mh) { mh = gy[r][c]; mr = r; }
          spine.push({ x: gx[mr][c], z: gz[mr][c], h: mh });
        }
        const tris = cols * rows * 2;
        const posA = new Float32Array(tris * 9), colA = new Float32Array(tris * 9);
        let pi = 0, ci = 0;
        const up = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3();
        // A fixed high southern light is baked into the vertex colours. This
        // keeps the one-draw Basic material stable at every time of day while
        // still giving each low-poly face a readable light/dark direction.
        const lightDir = new T.Vector3(0.38, 0.82, 0.42).normalize();
        const A = new T.Vector3(), B = new T.Vector3(), Cc = new T.Vector3(), Dd = new T.Vector3();
        const _cu = new T.Color();
        const palette = cfg.palette;
        function emitTri(a, b, c2) {
          e1.subVectors(b, a); e2.subVectors(c2, a);
          up.crossVectors(e1, e2);
          if (up.y < 0) { const t = b; b = c2; c2 = t; up.multiplyScalar(-1); } // consistent up-winding
          up.normalize();
          const upDot = up.y;
          const faceLight = Math.max(0.52, Math.min(1.03, 0.68 + 0.38 * up.dot(lightDir)));
          const verts = [a, b, c2];
          for (let k = 0; k < 3; k++) {
            const vv = verts[k];
            posA[pi++] = vv.x; posA[pi++] = vv.y; posA[pi++] = vv.z;
            const wob = NZ.rangeVnoise(vv.x * 0.02 + seedOff, vv.z * 0.02 - seedOff);
            // This local range is lower than the distant world giants. Feed a
            // taller shading reference so snow stays on the actual crowns;
            // using raw peakAmp painted almost every gentle slope pale blue,
            // visually merging the entire mountain into the snowfield.
            NZ.rangeShadeVert(palette, vv.y, peakAmp * 1.28, upDot, wob, 0, _cu);
            _cu.multiplyScalar(faceLight);
            colA[ci++] = _cu.r; colA[ci++] = _cu.g; colA[ci++] = _cu.b;
          }
        }
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          A.set(gx[r][c], gy[r][c], gz[r][c]);
          B.set(gx[r][c + 1], gy[r][c + 1], gz[r][c + 1]);
          Cc.set(gx[r + 1][c], gy[r + 1][c], gz[r + 1][c]);
          Dd.set(gx[r + 1][c + 1], gy[r + 1][c + 1], gz[r + 1][c + 1]);
          emitTri(A, Cc, B); emitTri(B, Cc, Dd);
        }
        const g = new T.BufferGeometry();
        g.setAttribute("position", new T.BufferAttribute(posA, 3));
        g.setAttribute("color", new T.BufferAttribute(colA, 3));
        g.computeVertexNormals();
        const len2 = dx * dx + dz * dz || 1;
        const dir2 = depthDir.x * depthDir.x + depthDir.z * depthDir.z || 1;
        function heightAt(x, z) {
          const rx = x - p0.x, rz = z - p0.z;
          const u = (rx * dx + rz * dz) / len2;
          if (u < 0 || u > 1) return 0;
          const bx = p0.x + dx * u, bz = p0.z + dz * u;
          const v = ((x - bx) * depthDir.x + (z - bz) * depthDir.z) / (depthLen * dir2);
          return sampleHeight(u, v, bx + depthDir.x * v * depthLen, bz + depthDir.z * v * depthLen);
        }
        return { geo: g, spine, heightAt };
      }
      const build = SOLID ? buildPad : buildRidge;

      // -- palette: rock / ragged snow / cliff -----------------------------
      // Cool granite + blue-shadow snow keep the reachable massif distinct
      // from both pale sky and white valley. The former orange-brown palette
      // and brown material tint made every face look like the same clay mound.
      const rangePalette = {
        // These are authored in the renderer's linear colour space. Keeping
        // granite well below mid-grey prevents the final sRGB conversion from
        // washing the entire lower mountain into the snow-white valley.
        rock: new THREE.Color(0x3d474e), rockDark: new THREE.Color(0x151b21),
        snow: new THREE.Color(0xbfcfd9), snowShade: new THREE.Color(0x657987),
      };

      // -- REAL MASSIF LAYOUT ------------------------------------------------
      // One broad mountain occupies the northern half of Mount Mercy itself.
      // Its full footprint lies inside the registered landmass and its southern
      // edge returns to y=0 before the lake/resort valley. No edge walls, no
      // distant sheets, no fake horizon geometry.
      const RESV = !!(CBZ.CONFIG && CBZ.CONFIG.MAP_RESERVE_V1);
      const fgEdges = [
        // Leave the cabin and outpost on usable flat shoulders while the ski
        // run occupies the broad centre of the massif.
        { p0: { x: MINX + 180, z: MINZ + 25 }, p1: { x: MAXX - 180, z: MINZ + 25 }, dir: { x: 0, z: 1 }, name: "Mount Mercy", depthLen: 315 },
      ];
      const fgGeoms = [], spines = [], groundFns = [];
      for (let ei = 0; ei < fgEdges.length; ei++) {
        const e = fgEdges[ei];
        const cfg = {
          cols: 72, rows: 24, depthLen: e.depthLen,
          peakAmp: 156 + rng() * 18,             // grounded multi-summit range, not a giant wall
          seedOff: 1000 + ei * 137 + rng() * 50,
          noiseScale: 0.012,
          footGuard: 0.28,                       // valleyGuard: y->0 by row ~28% (flat floor)
          palette: rangePalette,
        };
        const built = build(THREE, e.p0, e.p1, e.dir, cfg);
        fgGeoms.push(built.geo);
        spines.push({ edge: e, spine: built.spine, peakAmp: cfg.peakAmp });
        if (built.heightAt) groundFns.push(built.heightAt);
      }

      mountainHeightAt = function (x, z) {
        let h = 0;
        for (let i = 0; i < groundFns.length; i++) h = Math.max(h, groundFns[i](x, z));
        return h;
      };
      if (CBZ.registerCityGroundHeight) {
        CBZ.registerCityGroundHeight(mountainHeightAt, { name: "Mount Mercy", biome: "snow" });
      }
      const massifBounds = {
        minX: fgEdges[0].p0.x, maxX: fgEdges[0].p1.x,
        minZ: fgEdges[0].p0.z, maxZ: fgEdges[0].p0.z + fgEdges[0].depthLen,
      };
      if (layout && layout.reserve) layout.reserve("snow:real-massif", massifBounds, { pad: 2 });

      // MAP_RESERVE_V1: record the massif's TRUE footprint so the post-build
      // audit sees the mountain range, not just the flat feather skirt. Reserve
      // each ridge as its OWN rect (base segment extruded by its depth) rather
      // than one union box — a single AABB would falsely claim the empty SE
      // corner where the S ridge's x-span crosses the E ridge's z-span. All
      // share owner "snow", so they only ever flag against a DIFFERENT landmass.
      if (RESV && CBZ.worldLayout && CBZ.worldLayout.mapReserve) {
        const edgeRect = (e) => {
          const ax = e.p0.x, az = e.p0.z, bx = e.p1.x, bz = e.p1.z;
          const ex = e.dir.x * e.depthLen, ez = e.dir.z * e.depthLen;
          return {
            minX: Math.min(ax, bx, ax + ex, bx + ex), maxX: Math.max(ax, bx, ax + ex, bx + ex),
            minZ: Math.min(az, bz, az + ez, bz + ez), maxZ: Math.max(az, bz, az + ez, bz + ez),
          };
        };
        const all = fgEdges;
        for (let mi = 0; mi < all.length; mi++) {
          CBZ.worldLayout.mapReserve("massif:snow:" + mi, edgeRect(all[mi]), { owner: "snow", kind: "massif" });
        }
      }

      // -- MERGE: the one real ground mass -> one draw call -----------------
      // Vertex colour is the authored mountain shading. Keep it independent of
      // one-sided normals / sun direction so the range cannot collapse into a
      // black silhouette at night or when viewed from aircraft height.
      // Vertex colours bake both geology bands and per-face slope shading.
      // Use them directly: the city's stacked Lambert lights flattened the
      // whole broad slope into one dark fog-coloured sheet at dusk. The baked
      // palette is held below white so the final sRGB pass cannot clip it.
      // This remains opaque/depth-writing. The reachable local massif opts out
      // of city-block fog: even a scaled fog pass was turning its full surface
      // into the horizon colour and recreating the see-through-sheet read.
      const rangeMat = SOLID
        ? (CBZ.terrainFogScale || function (m) { return m; })(new THREE.MeshBasicMaterial({
            // Vertex colours carry the complete granite/snow palette and the
            // directional face light. A white base avoids muddying it brown.
            color: 0xffffff, vertexColors: true, fog: false,
            // The pad is generated as independently wound non-indexed facets.
            // Render both faces so no camera quadrant can lose half the mass;
            // it is still fully opaque and depth-writing below.
            side: THREE.DoubleSide,
            transparent: false, opacity: 1, depthTest: true, depthWrite: true,
          }))
        : new THREE.MeshBasicMaterial({
            color: 0xffffff, vertexColors: true, flatShading: true,
            side: THREE.DoubleSide, fog: true,
          });
      function mergeAddRange(geoms, cast) {
        if (!geoms.length) return null;
        let mesh;
        if (BGU && BGU.mergeBufferGeometries) {
          mesh = new THREE.Mesh(BGU.mergeBufferGeometries(geoms), rangeMat);
        } else {
          // manual Float32 concat fallback (position + color)
          let np = 0, nc = 0;
          for (const g of geoms) { np += g.attributes.position.array.length; nc += g.attributes.color.array.length; }
          const P = new Float32Array(np), Cc = new Float32Array(nc);
          let po = 0, co = 0;
          for (const g of geoms) {
            P.set(g.attributes.position.array, po); po += g.attributes.position.array.length;
            Cc.set(g.attributes.color.array, co); co += g.attributes.color.array.length;
          }
          const merged = new THREE.BufferGeometry();
          merged.setAttribute("position", new THREE.BufferAttribute(P, 3));
          merged.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
          merged.computeVertexNormals();
          mesh = new THREE.Mesh(merged, rangeMat);
        }
        mesh.castShadow = !!cast; mesh.receiveShadow = true;
        mesh.name = "mount-mercy-ground";
        // This one mesh spans the whole reachable massif. Treat it like every
        // other world surface so far-culling cannot hide the mountain while
        // leaving its ski-run/lift dressing floating in the distance.
        mesh.userData.terrain = true;
        mesh.userData.worldSurface = true;
        mesh.userData.realGround = true;
        mesh.userData.distantLandmark = true;
        // verts are baked in WORLD space, so a computed bounding sphere is
        // correct for auditing/raycasting. This is one draw and a permanent
        // city landmark, so skip object-sphere frustum toggles; the projection
        // plane remains the sole distance authority and cannot flicker around
        // oblique camera edges.
        if (mesh.geometry && !mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        root.add(mesh);
        // Projection-only request: fog and city far-culling keep their normal
        // budgets. This merely lets the explicitly registered one-draw landmark
        // survive the airport/city distance instead of hard-clipping at 1400m.
        CBZ.cityDistantLandmarkFar = Math.max(CBZ.cityDistantLandmarkFar || 0, 2200);
        return mesh;
      }
      mergeAddRange(fgGeoms, true);
    })();

    // ---- frozen LAKE (icy plane, slight blue tint) -----------------------
    (function lake() {
      const lx = 180, lz = -1380, lr = 92;
      const ice = new THREE.Mesh(new THREE.CircleGeometry(lr, 40),
        new THREE.MeshLambertMaterial({ color: COL.ice, emissive: COL.iceDeep, emissiveIntensity: 0.12 }));
      ice.rotation.x = -Math.PI / 2;
      ice.position.set(lx, 0.05, lz);
      ice.receiveShadow = true;
      root.add(ice);
      // a couple of cracked-ice rings for read
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(lr * (0.3 + i * 0.22), lr * (0.32 + i * 0.22), 32),
          new THREE.MeshBasicMaterial({ color: COL.iceDeep, transparent: true, opacity: 0.25 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(lx, 0.06, lz);
        root.add(ring);
      }
    })();

    // ---- instanced SNOWY PINES (one draw call: trunk + canopy each) ------
    (function pines() {
      const COUNT = 130;
      const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 1.6, 5);
      const canopyG = new THREE.ConeGeometry(1.5, 4.2, 6);
      const capG = new THREE.ConeGeometry(0.75, 1.9, 6);       // snow capping the upper canopy (conformal)
      const trunkIM = new THREE.InstancedMesh(trunkG, mTrunk, COUNT);
      const canopyIM = new THREE.InstancedMesh(canopyG, mPine, COUNT);
      const capIM = new THREE.InstancedMesh(capG, mSnow, COUNT);
      trunkIM.castShadow = canopyIM.castShadow = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
      const region = { kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ };
      const pts = CBZ.cityScatterInRegion(region, COUNT, rng, 60);
      let n = 0;
      for (let i = 0; i < COUNT; i++) {
        const p = pts[i];
        // keep pines off the lake + the causeway mouth
        if (Math.hypot(p.x - 180, p.z - (-1380)) < 100) continue;
        if (Math.abs(p.x - 470) < 26 && p.z > MAXZ - 120) continue;
        if (inTown(p.x, p.z)) continue;          // T8 — no pines in the resort village
        if (!claimNature(p.x, p.z, 2.2)) continue;
        const sc = 0.8 + rng() * 1.3;
        const ry = rng() * Math.PI * 2;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        // trunk
        s.set(sc, sc, sc); v.set(p.x, 0.8 * sc, p.z);
        m4.compose(v, q, s); trunkIM.setMatrixAt(n, m4);
        // canopy
        v.set(p.x, (1.6 + 2.1) * sc, p.z); m4.compose(v, q, s); canopyIM.setMatrixAt(n, m4);
        // snow cap — hugs the top ~44% of the canopy, flush with its slope (same q so facets align)
        v.set(p.x, 4.9 * sc, p.z); m4.compose(v, q, s); capIM.setMatrixAt(n, m4);
        n++;
      }
      trunkIM.count = canopyIM.count = capIM.count = n;
      trunkIM.instanceMatrix.needsUpdate = canopyIM.instanceMatrix.needsUpdate = capIM.instanceMatrix.needsUpdate = true;
      // r128 frustum-culls an InstancedMesh by its GEOMETRY's bounding sphere
      // (a ~2u cone at the origin — nowhere near the instances), so these
      // culled in and out at the wrong times. Hand the geometries a sphere
      // that actually covers the snow region → correct culling, and the whole
      // stand (plus its shadow-pass cost) drops when you look away.
      const bs = new THREE.Sphere(
        new THREE.Vector3((MINX + MAXX) / 2, 6, (MINZ + MAXZ) / 2),
        Math.hypot(MAXX - MINX, MAXZ - MINZ) / 2 + 14);
      trunkG.boundingSphere = bs.clone(); canopyG.boundingSphere = bs.clone(); capG.boundingSphere = bs.clone();
      root.add(trunkIM); root.add(canopyIM); root.add(capIM);
    })();

    // ---- instanced ROCKY OUTCROPS + SNOWDRIFTS ---------------------------
    (function rocksAndDrifts() {
      const RC = 40;
      const rockG = new THREE.DodecahedronGeometry(1.1, 0);
      const rockIM = new THREE.InstancedMesh(rockG, mRock, RC);
      rockIM.castShadow = true; rockIM.receiveShadow = true;
      const driftG = new THREE.SphereGeometry(1, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      const driftIM = new THREE.InstancedMesh(driftG, mSnowShade, RC);
      driftIM.receiveShadow = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
      const region = { kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ };
      const pr = CBZ.cityScatterInRegion(region, RC, rng, 70);
      const pd = CBZ.cityScatterInRegion(region, RC, rng, 50);
      let rn = 0, dn = 0;
      for (let i = 0; i < RC; i++) {
        const a = pr[i], sc = 0.7 + rng() * 1.8;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
        // T8 — skip rocks/drifts that fall in the resort village (keep the rng
        // draws above so determinism + the drift below are unchanged).
        if (!inTown(a.x, a.z) && claimNature(a.x, a.z, Math.max(0.9, sc * 0.9))) {
          s.set(sc, sc * (0.7 + rng() * 0.5), sc); v.set(a.x, sc * 0.35, a.z);
          m4.compose(v, q, s); rockIM.setMatrixAt(rn++, m4);
        } else { rng(); }                        // consume the height-jitter draw
        const b = pd[i], dc = 1.4 + rng() * 3.2;
        s.set(dc, dc * (0.32 + rng() * 0.2), dc * (0.7 + rng() * 0.6));
        if (!inTown(b.x, b.z) && openNature(b.x, b.z, dc * 0.8)) {
          v.set(b.x, 0.02, b.z); m4.compose(v, q, s); driftIM.setMatrixAt(dn++, m4);
        }
      }
      rockIM.count = rn; driftIM.count = dn;
      rockIM.instanceMatrix.needsUpdate = driftIM.instanceMatrix.needsUpdate = true;
      root.add(rockIM); root.add(driftIM);
    })();

    // ---- SKI LODGE (enterable; fireplace + warm interior) ----------------
    (function lodge() {
      const lx = 360, lz = -1250, w = 22, d = 16, storeys = 2;
      let b = null;
      if (CBZ.cityMakeBuilding) {
        b = CBZ.cityMakeBuilding(root, lx, lz, w, d, storeys, COL.timber, 0, { stairs: true });
        if (b && CBZ.cityFurnishApartment) {
          const fh = b.FH || 4;
          for (let k = 0; k < storeys; k++) CBZ.cityFurnishApartment(b, k * fh, ((lx | 0) + (lz | 0) + k) >> 1);
        }
      } else {
        b = box(lx, 4, lz, w, 8, d, mTimber, true);
      }
      // snowy A-frame roof slab on top (visual)
      box(lx, storeys * 4 + 1.4, lz, w + 2, 2.6, d + 2, new THREE.MeshLambertMaterial({ color: COL.roofSnow }), false);
      // a warm fireplace glow box flush to the front wall (WHY: "cozy" = light + warmth)
      const fire = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 0.6),
        new THREE.MeshLambertMaterial({ color: COL.timberDk, emissive: COL.ember, emissiveIntensity: 0.85 }));
      fire.position.set(lx - w / 2 + 1.5, 1.4, lz - d / 2 + 0.4);
      root.add(fire);
      const fl = new THREE.PointLight(COL.ember, 0.9, 22, 2);
      fl.position.set(lx - w / 2 + 2.2, 2, lz - d / 2 + 1.4);
      root.add(fl);
      // smoking chimney
      box(lx + w / 2 - 2, storeys * 4 + 2.6, lz, 1.6, 4, 1.6, mTimberDk, false);
      // register a lot so it reads as a real building on the map, if supported
      if (b && city.lots) {
        city.lots.push({ cx: lx, cz: lz, w, d, kind: "lodge", district: "snow",
          building: Object.assign({}, b, { name: "Alpine Ski Lodge",
            door: { x: lx, z: lz - d / 2 + 1.6, nx: 0, nz: 1 } }) });
      }
      const grp = new THREE.Group(); grp.position.set(lx, storeys * 4 + 4, lz); root.add(grp);
      tag(grp, "ALPINE LODGE", 0);
    })();

    // ---- mountain CABIN + frozen-over OUTPOST ----------------------------
    // NO-DECOY FIX: both landmarks used to be sealed doorless box() shells
    // that only carried a name sign — a promise ("cabin"/"outpost" reads as
    // "go inside") the geometry never paid off. Rebuilt on the SAME
    // cityMakeBuilding + cityFurnishApartment pattern the lodge above already
    // uses (real door/collider/interior), each single-storey with a real
    // one-room interior, plus one small interaction matching its name: the
    // cabin is a HUNTER'S rest/warm-up spot (fireplace glow, a stamina nudge),
    // the outpost is a derelict LOOT CACHE (one-time cash grab, then empty).
    (function cabinAndOutpost() {
      // ---- a small log cabin tucked near the trees — enterable, one room ----
      const cx = 600, cz = -1600, cw = 9, cd = 7;
      let cb = null;
      if (CBZ.cityMakeBuilding) {
        try {
          cb = CBZ.cityMakeBuilding(root, cx, cz, cw, cd, 1, COL.timber, 0, { retail: true, glassKind: "clear", facade: "retail" });
          if (cb && CBZ.cityFurnishApartment) CBZ.cityFurnishApartment(cb, 0, (cx | 0) + (cz | 0));
        } catch (e) { cb = null; }   // never let a rejected opt sink the biome
      }
      if (!cb) box(cx, 2, cz, cw, 4, cd, mTimber, true);   // headless/no-buildings.js fallback: old sealed shell
      box(cx, 4.6, cz, cw + 1.4, 1.6, cd + 1.4, new THREE.MeshLambertMaterial({ color: COL.roofSnow }), false);
      box(cx + 3, 5.4, cz - 2, 1, 2, 1, mTimberDk, false);  // chimney
      const cabL = new THREE.PointLight(0xffd9a0, 0.4, 14, 2);
      cabL.position.set(cx, 2.4, cz - 3.2); root.add(cabL);
      const g1 = new THREE.Group(); g1.position.set(cx, 6.6, cz); root.add(g1);
      tag(g1, "HUNTER'S CABIN", 0);
      if (cb && city.lots) {
        city.lots.push({ cx, cz, w: cw, d: cd, kind: "cabin", district: "snow",
          building: Object.assign({}, cb, { name: "Hunter's Cabin",
            door: { x: cx, z: cz - cd / 2 + 1.6, nx: 0, nz: 1 } }) });
      }
      // ---- REST/WARM-UP interaction: a small zone at the fireplace corner ----
      // a hunter ducking out of the cold gets a small HP top-up (mirrors the
      // hospital's healFull idiom in shops.js, just free + tiny + on a cooldown
      // so it reads as "resting by a fire", not a full-heal battery).
      if (CBZ.interactions && CBZ.interactions.registerZone) {
        const warmSpot = { x: cx - cw / 2 + 1.5, z: cz - cd / 2 + 1.2, kind: "cabin-hearth" };
        let nextWarmT = 0;
        CBZ.interactions.registerZone({
          id: "snow-cabin-hearth", kind: "cabin-hearth", radius: 3.2,
          find: function (px, pz) {
            const dx = warmSpot.x - px, dz = warmSpot.z - pz;
            return (dx * dx + dz * dz) < 3.2 * 3.2 ? warmSpot : null;
          },
          options: [{
            id: "cabin-warmup", slot: "e",
            label: function () { return (CBZ.now || 0) < nextWarmT ? "Warming up (still cozy)" : "Warm up by the fire"; },
            canShow: function () { return (CBZ.now || 0) >= nextWarmT; },
            onSelect: function () {
              nextWarmT = (CBZ.now || 0) + 120000;      // ~2 min cooldown — a rest, not a battery
              const P = CBZ.player;
              if (P && P.hp != null && P.maxHp) P.hp = Math.min(P.maxHp, P.hp + Math.round(P.maxHp * 0.08));
              if (CBZ.sfx) CBZ.sfx("door");
              CBZ.city.note("🔥 You warm up by the hearth — the cold eases off.", 2.2);
            },
          }],
        });
      }

      // ---- a derelict frozen-over outpost: enterable concrete shell --------
      const ox = 90, oz = -1640, ow = 14, od = 10;
      let ob = null;
      if (CBZ.cityMakeBuilding) {
        try {
          ob = CBZ.cityMakeBuilding(root, ox, oz, ow, od, 1, COL.rockDark, 0, { retail: true, facade: "office" });
        } catch (e) { ob = null; }
      }
      if (!ob) box(ox, 2.4, oz, ow, 4.8, od, new THREE.MeshLambertMaterial({ color: COL.rockDark }), true);
      // ice crust on the roof
      box(ox, 5.2, oz, ow + 0.4, 0.6, od + 0.4, new THREE.MeshLambertMaterial({ color: COL.ice, transparent: true, opacity: 0.85 }), false);
      // a tilted broken radio mast
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 5), mSteel);
      mast.position.set(ox + 4, 8, oz + 2); mast.rotation.z = 0.22; mast.castShadow = true; root.add(mast);
      const g2 = new THREE.Group(); g2.position.set(ox, 7.2, oz); root.add(g2);
      tag(g2, "FROZEN OUTPOST", 0);
      if (ob && city.lots) {
        city.lots.push({ cx: ox, cz: oz, w: ow, d: od, kind: "outpost", district: "snow",
          building: Object.assign({}, ob, { name: "Frozen Outpost",
            door: { x: ox, z: oz - od / 2 + 1.6, nx: 0, nz: 1 } }) });
      }
      // ---- LOOT CACHE interaction: a one-time cash grab in the abandoned shell ----
      if (CBZ.interactions && CBZ.interactions.registerZone) {
        const cacheSpot = { x: ox, z: oz + od / 2 - 2.2, kind: "outpost-cache" };
        let looted = false;
        CBZ.interactions.registerZone({
          id: "snow-outpost-cache", kind: "outpost-cache", radius: 3.0,
          find: function (px, pz) {
            if (looted) return null;
            const dx = cacheSpot.x - px, dz = cacheSpot.z - pz;
            return (dx * dx + dz * dz) < 3.0 * 3.0 ? cacheSpot : null;
          },
          options: [{
            id: "outpost-loot", slot: "e", label: "Search the abandoned supply crate",
            onSelect: function () {
              if (looted) return;
              looted = true;
              const take = 60 + (((cx * 7 + oz * 13) & 0x3f));   // deterministic small payout, no Math.random
              if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(take);
              if (CBZ.sfx) CBZ.sfx("coin");
              if (CBZ.city && CBZ.city.note) CBZ.city.note("🎒 Frozen supply crate — found $" + take + ". Picked clean now.", 2.4);
            },
          }],
        });
      }
    })();

    // ---- CHAIRLIFT line up a slope (towers + cable + moving chairs) ------
    // WHY: it carries skiers up to the ski run; chairs glide on the cable.
    const lift = { chairIM: null, baseX: 240, baseZ: -1180, topX: 470, topZ: -1585, towerTopY: 16, chairY: 10, n: 8, t: 0 };
    (function chairlift() {
      const dx = lift.topX - lift.baseX, dz = lift.topZ - lift.baseZ;
      const span = Math.hypot(dx, dz);
      const ux = dx / span, uz = dz / span;
      const cableY0 = mountainHeightAt(lift.baseX, lift.baseZ) + 12.6;
      const cableY1 = mountainHeightAt(lift.topX, lift.topZ) + 18.6;
      lift.cableY0 = cableY0; lift.cableY1 = cableY1;
      // Towers start on the same sampled mountain surface used by player
      // physics and reach the cable above it.
      const towers = 5;
      for (let i = 0; i <= towers; i++) {
        const t = i / towers;
        const x = lift.baseX + dx * t, z = lift.baseZ + dz * t;
        const groundY = mountainHeightAt(x, z);
        const cableY = cableY0 + (cableY1 - cableY0) * t;
        const h = Math.max(7, cableY - groundY);
        box(x, groundY + h / 2, z, 0.8, h, 0.8, mSteel, true);
        box(x, cableY, z, 4, 0.4, 0.4, mSteel, false);
      }
      lift.span = span; lift.ux = ux; lift.uz = uz;
      // CABLE: a thin tube from base-top to top-top (two strands = up/down)
      const cableMat = new THREE.MeshLambertMaterial({ color: COL.cable });
      for (const off of [-1.4, 1.4]) {
        const path = new THREE.LineCurve3(
          new THREE.Vector3(lift.baseX + uz * off, cableY0, lift.baseZ - ux * off),
          new THREE.Vector3(lift.topX + uz * off, cableY1, lift.topZ - ux * off));
        const tube = new THREE.Mesh(new THREE.TubeGeometry(path, 1, 0.08, 4, false), cableMat);
        root.add(tube);
      }
      // instanced CHAIRS (one draw call) — positions animated in onUpdate
      const chairG = new THREE.BoxGeometry(1.4, 0.9, 0.8);
      lift.chairIM = new THREE.InstancedMesh(chairG, cmat(COL.chair), lift.n);
      lift.chairIM.castShadow = true;
      root.add(lift.chairIM);
      // place once so it's correct even if onUpdate is throttled
      placeChairs(0);
    })();

    function placeChairs(t) {
      if (!lift.chairIM) return;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(lift.ux, lift.uz));
      for (let i = 0; i < lift.n; i++) {
        // loop fraction 0..1 along the up strand (down strand offset by half)
        let f = ((i / lift.n) + t) % 1;
        const off = (i % 2 === 0) ? 1.4 : -1.4;        // alternate strands
        const x = lift.baseX + (lift.topX - lift.baseX) * f + lift.uz * off;
        const y = lift.cableY0 + (lift.cableY1 - lift.cableY0) * f - 1.2;
        const z = lift.baseZ + (lift.topZ - lift.baseZ) * f - lift.ux * off;
        v.set(x, y, z); m4.compose(v, q, s); lift.chairIM.setMatrixAt(i, m4);
      }
      lift.chairIM.instanceMatrix.needsUpdate = true;
    }

    // ---- SKI RUN with slalom gates (red/blue poles down the slope) -------
    (function skiRun() {
      const sx = 470, sz0 = -1585, sz1 = -1300;     // summit to resort valley
      // A segmented groomed strip follows the exact real-ground oracle. It is
      // world-space geometry, so there is no flat plane cutting through the hill.
      const segZ = 48, halfW = 13;
      const runGeo = new THREE.PlaneGeometry(halfW * 2, sz1 - sz0, 2, segZ);
      runGeo.rotateX(-Math.PI / 2);
      const pa = runGeo.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const wx = sx + pa.getX(i), wz = (sz0 + sz1) / 2 + pa.getZ(i);
        pa.setXYZ(i, wx, mountainHeightAt(wx, wz) + 0.14, wz);
      }
      pa.needsUpdate = true; runGeo.computeVertexNormals(); runGeo.computeBoundingSphere();
      const runMat = new THREE.MeshLambertMaterial({
        color: 0xeaf2f7,
        // Coplanar snow flickered into disconnected white scraps at airfield
        // distance. Bias this authored groomed strip toward the camera in depth
        // without lifting its walkable geometry off the real mountain oracle.
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const run = new THREE.Mesh(runGeo, runMat);
      run.userData.mountMercySkiRun = true;
      run.receiveShadow = true;
      root.add(run);
      // slalom gate poles (instanced — alternating sides)
      const gates = 9;
      const poleG = new THREE.CylinderGeometry(0.14, 0.14, 2.4, 5);
      const poleIM = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: COL.flag }), gates);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < gates; i++) {
        const t = (i + 0.5) / gates;
        const z = sz0 + (sz1 - sz0) * t;
        const x = sx + (i % 2 === 0 ? -7 : 7);
        v.set(x, mountainHeightAt(x, z) + 1.2, z); m4.compose(v, q, s); poleIM.setMatrixAt(i, m4);
      }
      poleIM.instanceMatrix.needsUpdate = true;
      root.add(poleIM);
    })();

    // ============================================================
    //  PINECREST — the alpine resort VILLAGE, grown from the reusable generator
    //  on the flat slope-base SE of the lodge (T8). Now that the keystone (T1)
    //  wired the arena, the lodge/outfitter/clinic/gear-pawn become REAL buyable,
    //  walk-in, staffed businesses for the mountain visitors regionlife streams
    //  (skiers/hikers). FALLBACK: if towngen / the recipe is absent this no-ops
    //  and the slopes above stand alone (the inTown skips were HAS_TOWN-gated →
    //  zero regression).
    // ============================================================
    if (HAS_TOWN) {
      if (CBZ.placement && CBZ.placement.seedFromColliders) { try { CBZ.placement.seedFromColliders(); } catch (e) {} }
      const town = CBZ.buildTown(root, Object.assign({}, CBZ.CITY_TEMPLATES.pinecrest, {
        cx: TOWN_CX, cz: TOWN_CZ, region: TOWN, rng: rng,
        name: "Pinecrest", district: "snow",
      }));
      // WORK-ANCHORS at the lodge + outfitter so the resort staffs up (same
      // schedule/goal brain the mainland uses). Feature-detected.
      if (town && CBZ.registerWorkAnchor) {
        const findLot = function (kw) {
          return (town.lots || []).find(function (l) {
            return l.building && l.building.shop && l.building.name &&
              l.building.name.toUpperCase().indexOf(kw) >= 0;
          });
        };
        const lodge = findLot("LODGE") || (town.lots || []).find(function (l) { return l.building && l.building.shop; });
        const outfitter = findLot("OUTFITTER") || findLot("OUTFIT") || findLot("GEAR");
        for (const a of [lodge, outfitter]) {
          if (!a || !a.building || !a.building.vendorSpot) continue;
          try {
            CBZ.registerWorkAnchor({
              biome: "snow", kind: "shop", role: "shopkeeper",
              x: a.cx, z: a.cz, cap: 1,
              spots: [{ x: a.building.vendorSpot.x, z: a.building.vendorSpot.z }],
              home: { x: a.cx, z: a.cz },
            });
          } catch (e) {}
        }
      }
    }

    // ============================================================
    //  CAUSEWAY: winding snowy road deck south toward the speedway,
    //  with instanced guardrail posts. rect minX=463..477 z -1120..-530.
    // ============================================================
    (function causeway() {
      const rMinX = 463, rMaxX = 477, rMinZ = -1120, rMaxZ = -530;
      const cxMid = (rMinX + rMaxX) / 2;
      if (CBZ.buildHighway) {
        // REAL wide plowed concrete highway over the water toward the speedway.
        // heightAt: grade-follow world/terrain.js relief (it's exactly 0 over
        // this rect's flat playable footprint, so this is a free, safe hook —
        // it only matters if the deck ever extends nearer the backdrop rim).
        CBZ.buildHighway(root, {
          path: [{ x: cxMid, z: rMinZ }, { x: cxMid, z: rMaxZ }],
          width: 24, lanesPerDir: 3, median: true, medianW: 1.2, laneW: 3.6, theme: "concrete",
          guardrail: true, elevated: false, rng: rng,
          heightAt: CBZ.terrainHeight,
        });
        // snow berms flanking the wider deck (visual edge + read)
        for (const ex of [cxMid - 13.2, cxMid + 13.2]) {
          const berm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, rMaxZ - rMinZ), mSnowShade);
          berm.position.set(ex, 0.3, (rMinZ + rMaxZ) / 2);
          berm.receiveShadow = true; root.add(berm);
        }
        return;
      }
      // ---- fallback: bespoke narrow deck (only if buildHighway absent) ----
      // dark plowed road deck (a touch above the snow plane)
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(rMaxX - rMinX, rMaxZ - rMinZ),
        new THREE.MeshLambertMaterial({ color: 0x3b3f45 }));
      deck.rotation.x = -Math.PI / 2;
      deck.position.set(cxMid, 0.06, (rMinZ + rMaxZ) / 2);
      deck.receiveShadow = true;
      root.add(deck);
      // snow berms either side (visual edge + read)
      for (const ex of [rMinX - 1.2, rMaxX + 1.2]) {
        const berm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, rMaxZ - rMinZ), mSnowShade);
        berm.position.set(ex, 0.3, (rMinZ + rMaxZ) / 2);
        berm.receiveShadow = true; root.add(berm);
      }
      // GUARDRAIL posts (instanced, both sides) — short, non-blocking visuals
      const POSTS = 2 * 24;
      const postG = new THREE.CylinderGeometry(0.1, 0.1, 1.0, 5);
      const postIM = new THREE.InstancedMesh(postG, mSteel, POSTS);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      let k = 0;
      for (let i = 0; i < 24; i++) {
        const t = i / 23;
        const z = rMinZ + (rMaxZ - rMinZ) * t;
        for (const ex of [rMinX - 0.5, rMaxX + 0.5]) {
          v.set(ex, 0.5, z); m4.compose(v, q, s); postIM.setMatrixAt(k++, m4);
        }
      }
      postIM.count = k; postIM.instanceMatrix.needsUpdate = true;
      root.add(postIM);
    })();

    // ---- LIFE: a few skiers / hikers (low live count per spec) -----------
    (function life() {
      if (!CBZ.cityMakePed || !CBZ.cityPeds) return;
      const spots = [
        { x: 360, z: -1232 }, { x: 250, z: -1190 },      // near the lodge / lift base
        { x: 470, z: -1320 }, { x: 590, z: -1585 },      // ski run / cabin
        { x: 190, z: -1430 },                            // by the lake
      ];
      const lr = mulberry(0xA17 ^ (CX | 0));
      const populationEntries = [];
      for (const sp of spots) {
        try {
          const opts = {
            job: "hiker", archetype: "resident", behavior: "wander",
            wealth: 0.4 + lr() * 0.3, armed: false,
          };
          if (CBZ.npcLife && CBZ.npcLife.definePopulation) {
            populationEntries.push({ profile: "cityResident", placement: { x: sp.x, z: sp.z, rng: lr }, overrides: opts });
            continue;
          }
          const ped = CBZ.npcLife
            ? CBZ.npcLife.spawnCity("cityResident", { x: sp.x, z: sp.z, parent: root, rng: lr }, opts)
            : CBZ.cityMakePed(sp.x, sp.z, lr, opts);
          if (ped && !CBZ.npcLife) {
            root.add(ped.group);
            if (CBZ.cityPeds.indexOf(ped) < 0) CBZ.cityPeds.push(ped);
          }
        } catch (e) { /* one bad ped can't sink the biome */ }
      }
      if (populationEntries.length && CBZ.npcLife && CBZ.npcLife.definePopulation) {
        CBZ.npcLife.definePopulation("snow-authored", { root: root, entries: populationEntries });
      }
    })();

    // ============================================================
    //  SNOWFALL: ONE THREE.Points cloud (a few hundred recycled flakes),
    //  VISIBLE only while the player stands in the snow biome — so it is
    //  free everywhere else (no per-frame work when hidden).
    // ============================================================
    (function snowfall() {
      if (CFGS.SNOWFALL_POINTS !== true) return;
      const N = 420, SPAN = 120, TOP = 70;
      const pos = new Float32Array(N * 3);
      const vel = new Float32Array(N);       // fall speed per flake
      const sway = new Float32Array(N);      // sway phase
      // seed deterministically (local rng — no Math.random)
      const fr = mulberry(0xF1A4E5);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (fr() - 0.5) * SPAN;
        pos[i * 3 + 1] = fr() * TOP;
        pos[i * 3 + 2] = (fr() - 0.5) * SPAN;
        vel[i] = 6 + fr() * 8;
        sway[i] = fr() * Math.PI * 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const pmat = new THREE.PointsMaterial({
        color: 0xffffff, size: 0.55, sizeAttenuation: true,
        transparent: true, opacity: 0.9, depthWrite: false,
      });
      const points = new THREE.Points(geo, pmat);
      points.frustumCulled = false;
      points.visible = false;
      // parented to scene root; we recentre it on the player each frame
      root.add(points);

      CBZ.onUpdate(37.7, function (dt) {
        const P = CBZ.player;
        if (!P || !P.pos) { if (points.visible) points.visible = false; return; }
        const inSnow = CBZ.cityBiomeAt && CBZ.cityBiomeAt(P.pos.x, P.pos.z) === "snow";
        if (!inSnow) { if (points.visible) points.visible = false; return; }
        points.visible = true;
        // keep the flake box centred on the player so a small cloud feels global
        const cx = P.pos.x, cz = P.pos.z, cy = P.pos.y || 0;
        const arr = geo.attributes.position.array;
        for (let i = 0; i < N; i++) {
          const j = i * 3;
          let ly = arr[j + 1] - vel[i] * dt;           // fall (local y, recycled)
          if (ly < 0) ly += TOP;                       // recycle to the top
          arr[j + 1] = ly;
          sway[i] += dt * 1.4;
          arr[j] += Math.sin(sway[i]) * dt * 1.1;      // drift
          // wrap horizontally within the span around the player
          let lx = arr[j], lz = arr[j + 2];
          if (lx > SPAN / 2) lx -= SPAN; else if (lx < -SPAN / 2) lx += SPAN;
          if (lz > SPAN / 2) lz -= SPAN; else if (lz < -SPAN / 2) lz += SPAN;
          arr[j] = lx; arr[j + 2] = lz;
        }
        geo.attributes.position.needsUpdate = true;
        points.position.set(cx, cy, cz);
      });
    })();

    // ---- CHAIRLIFT animation (slow glide; cheap; only writes a matrix) ---
    CBZ.onUpdate(37.8, function (dt) {
      lift.t = (lift.t + dt * 0.012) % 1;     // very slow loop
      placeChairs(lift.t);
    });

    // ============================================================
    //  WORK-ANCHOR — the ski instructor's day: the lift base, the slope, the
    //  lodge. The aigoals brain routes ski instructors / skiers here on the
    //  schedule. WHY: the slope is WORKED — instructors run the run, skiers
    //  ride the lift and ski down. The lodge is home/base. Reuses the lift
    //  base / ski-run / lodge coords already built (no new geometry).
    //   ski run: top (470,-1720) .. bottom (470,-1300); lift base (240,-1180);
    //   lodge (360,-1250).
    // ============================================================
    if (CBZ.registerWorkAnchor) {
      CBZ.registerWorkAnchor({
        biome: "snow", kind: "slope", role: "ski instructor",
        x: 240, z: -1180, cap: 4,
        home: { x: 360, z: -1250 },                        // the ski lodge
        spots: [
          { x: 240, z: -1180 },                             // the chairlift base
          { x: 470, z: -1320 },                             // bottom of the ski run
          { x: 470, z: -1700 },                             // top of the ski run
          { x: 360, z: -1232 },                             // back by the lodge
        ],
      });
    }

    // ============================================================
    //  REGISTER the regions (the archipelago contract).
    // ============================================================
    CBZ.registerCityRegion(city, {
      name: "Mount Mercy", subtitle: "Alpine Range", biome: "snow", kind: "rect",
      minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 8,
    });
    // causeway widened to the 24m highway deck (x∈[458,482], centre x=470)
    CBZ.registerCityRegion(city, {
      name: "Mercy Causeway", subtitle: "Alpine Range", kind: "rect",
      minX: 458, maxX: 482, minZ: -1120, maxZ: -530, pad: 1,
    });
    // give traffic a road down the causeway (runs along Z → vertical)
    if (city.roads) {
      city.roads.push({ x: 470, z: -825, vertical: true, len: 590, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
    }
  }, 30);
})();
