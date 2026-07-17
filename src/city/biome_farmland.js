/* ============================================================
   city/biome_farmland.js — THE MASSIVE FARMLAND BIOME.

   WHY this exists (owner's WHY-first law): the archipelago is a string
   of dense, hard-edged islands (speedway, airport, military, desert).
   A wide-open agricultural valley is the breathing-room counterpoint —
   it answers "where does the city's FOOD come from?" with a felt place:
   patchwork crop parcels you can walk/drive through, a working family
   farmstead worth entering, livestock that read at distance, and a
   country road causeway that physically links it to the desert biome
   to its south. Nothing here is a stat or a menu — it is all geometry
   that pays off the moment you arrive over the bridge.

   DRAW-CALL DISCIPLINE (owner rule #4 — crop fields = HUGE counts):
   the BULK of every field is ONE striped quad (a single mesh per parcel
   carrying a generated row-striped CanvasTexture), so a 120x120 cornfield
   that would be tens of thousands of plants costs exactly one draw call
   for its ground. CLOSE-UP density (the plants that read when you stand
   in the field) is one InstancedMesh per parcel — a few hundred matrices,
   one draw call. Fences (posts+rails), hay bales and livestock are each a
   single InstancedMesh too. Result: the whole 800x800 biome is a few
   dozen draw calls, not tens of thousands of meshes.

   Registers via the archipelago contract (CBZ.addLandmass), order 33 so
   it builds before late cosmetic passes. Footprint rect center
   (1180,-880) half-extents (400,400). A country-road causeway rect runs
   south from the farm edge to the desert biome's north edge.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  // local seeded rng (owner rule #5 — deterministic, no Math.random in layout)
  // seeded from CBZ.WORLD_SEED via the named-stream registry (core/seed.js)
  // — one world-seed knob instead of a per-file magic literal. rng() is
  // re-armed at build entry so a rebuild replays the identical stream.
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream('farmland') : (function () { let s = 0x5eed1180; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();
  function rr(a, b) { return a + rng() * (b - a); }
  function ri(a, b) { return a + ((rng() * (b - a + 1)) | 0); }
  function pick(arr) { return arr[(rng() * arr.length) | 0]; }

  // ---- footprint -----------------------------------------------------------
  const MINX = 780, MAXX = 1580, MINZ = -1280, MAXZ = -480;
  const CX = (MINX + MAXX) / 2, CZ = (MINZ + MAXZ) / 2;

  // causeway: a thin country-road rect running south from the farm's south
  // edge (z=-480) down to the desert biome's north edge (z=280) at x≈1180.
  const ROAD_X = 1180, ROAD_HW = 7;        // half-width 7 → 14u drivable deck
  const ROAD_MINZ = -480, ROAD_MAXZ = 280;

  // shared materials (one instance each → no per-mesh material churn)
  const M = {
    soil: mat(0x6b4f33),
    grass: mat(0x4f7a36),
    road: mat(0x8d8472),
    roadLine: mat(0xcdb98a),
    barnRed: mat(0xa33327),
    barnTrim: mat(0xf2ece0),
    barnRoof: mat(0x39312b),
    silo: mat(0xc9cdd2),
    siloCap: mat(0x9aa0a6),
    house: mat(0xe7ddc9),
    houseRoof: mat(0x5a4536),
    wood: mat(0x6e5132),
    woodLt: mat(0x9b7b4e),
    metal: mat(0x7c8288),
    cornGreen: mat(0x4e7d2c),
    cornTassel: mat(0xc8b24a),
    wheat: mat(0xc9a93f),
    hay: mat(0xcda84a),
    leafGreen: mat(0x3f6e2a),
    cow: mat(0x2b2622),
    cowSpot: mat(0xe9e4da),
    sheep: mat(0xe6e1d6),
    dog: mat(0x8a6034),
    water: mat(0x3a6f9e),
    tractorGreen: mat(0x3a6b2e),
    tractorYellow: mat(0xe0b321),
    tire: mat(0x1c1c1c),
    scareShirt: mat(0xb53d3d),
    scareHead: mat(0xd9b46a),
    chick: mat(0xcf4633),
  };

  // a generated striped texture for a field's bulk quad (rows of crop colour
  // on soil) — this is the trick that makes a giant field cost ONE draw call.
  const _texCache = {};
  function stripeTex(base, row, gap, period) {
    const key = base + "|" + row + "|" + gap + "|" + period;
    if (_texCache[key]) return _texCache[key];
    const px = 64, c = document.createElement("canvas"); c.width = c.height = px;
    const g = c.getContext("2d");
    g.fillStyle = "#" + (base >>> 0).toString(16).padStart(6, "0");
    g.fillRect(0, 0, px, px);
    g.fillStyle = "#" + (row >>> 0).toString(16).padStart(6, "0");
    const bandW = Math.max(2, Math.floor(px / period * gap));
    for (let x = 0; x < px; x += Math.floor(px / period)) g.fillRect(x, 0, bandW, px);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    _texCache[key] = t;
    return t;
  }

  CBZ.addLandmass(function (city) {
    const root = city.root;
    if (!root) return;
    armRng();

    const cols = CBZ.colliders || (CBZ.colliders = []);

    // ---- HARVEST MARKET town (T7) -----------------------------------------
    // A real farm-county market grown from the reusable CBZ.buildTown generator
    // using the farmland-tied recipe (citytemplates.js: grocer/feed&seed/co-op
    // bank/diner/dry-goods). Placed on the farm-road spine (ROAD_X=1180) near the
    // south edge, on open ground that clears the homestead (SE cell, x≈1454) and
    // the farm stand. The field/scatter loops below SKIP this rect via inTown so
    // crops/hay/scarecrows don't grow in the streets — but ONLY when the
    // generator + recipe are present (HAS_TOWN), so the biome is byte-identical
    // if towngen is absent (zero regression).
    const HAS_TOWN = typeof CBZ.buildTown === "function" && !!(CBZ.CITY_TEMPLATES && CBZ.CITY_TEMPLATES.harvestmarket);
    const TOWN_CX = 1180, TOWN_CZ = -560, TOWN_HX = 130, TOWN_HZ = 70;
    const TOWN = { minX: TOWN_CX - TOWN_HX, maxX: TOWN_CX + TOWN_HX, minZ: TOWN_CZ - TOWN_HZ, maxZ: TOWN_CZ + TOWN_HZ };
    function inTown(x, z) {
      return HAS_TOWN && x > TOWN.minX - 8 && x < TOWN.maxX + 8 && z > TOWN.minZ - 8 && z < TOWN.maxZ + 8;
    }
    // A parcel is an area, not a point. The old centre-point check let a field
    // straddle the market boundary, so crops/fences could visibly continue
    // underneath buildings. Reject any parcel whose actual footprint meets the
    // protected town rectangle.
    function parcelTouchesTown(x, z, w, d) {
      if (!HAS_TOWN) return false;
      return x - w / 2 < TOWN.maxX + 8 && x + w / 2 > TOWN.minX - 8 &&
             z - d / 2 < TOWN.maxZ + 8 && z + d / 2 > TOWN.minZ - 8;
    }
    if (CBZ.worldLayout && HAS_TOWN) CBZ.worldLayout.reserve("farm:harvest-market", TOWN, { pad: 12 });

    // ---- helpers (mirror expansion.js idioms) ----------------------------
    function plane(x, z, w, d, material, y, rotY) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
      m.rotation.x = -Math.PI / 2;
      if (rotY) m.rotation.z = rotY;
      m.position.set(x, y == null ? 0.02 : y, z);
      m.receiveShadow = true;
      root.add(m);
      return m;
    }
    function box(x, y, z, w, h, d, material, solid) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      root.add(m);
      if (solid) cols.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: m });
      return m;
    }
    function cyl(x, y, z, rTop, rBot, h, material, solid) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 12), material);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      root.add(m);
      if (solid) {
        const rad = Math.max(rTop, rBot);
        cols.push({ minX: x - rad, maxX: x + rad, minZ: z - rad, maxZ: z + rad, ref: m });
      }
      return m;
    }
    function tag(group, text, y, scale) {
      if (!CBZ.makeLabelSprite) return;
      const s = CBZ.makeLabelSprite(text);
      if (!s) return;
      s.position.set(0, y, 0); s.scale.set(scale || 6, (scale || 6) * 0.24, 1);
      group.add(s);
    }

    // =====================================================================
    // 1) GROUND OWNERSHIP — the actual skin is built after parcel selection
    //    below, so soil, grass, crop rows, lanes and irrigation can all live in
    //    ONE texture on ONE mesh. No hidden full-size substrate remains.
    // =====================================================================

    // A true exterior feather replaces the old larger full rectangle, so the
    // valley no longer reads as an overlapping square layer from the air.
    if (CBZ.makeBiomeEdgeRing) {
      CBZ.makeBiomeEdgeRing(root, {
        cx: CX, cz: CZ, hx: (MAXX - MINX) / 2 + 8, hz: (MAXZ - MINZ) / 2 + 8,
        feather: 104, segments: 20,
        feathers: (CBZ.CONFIG && CBZ.CONFIG.MAP_RESERVE_V1) ? { west: 0, north: 0 } : { west: 0 },
        // The working parcels remain deliberately rectilinear, but the farm
        // COUNTY around them now extends for kilometres as rolling pasture.
        spread: { west: 70, east: 560, north: 440, south: 150 },
        inner: 0x647847, outer: 0x567048, featherNorm: 0.22,
        owner: "farmland",
        y: 0.006, seed: 0xfa411,
      });
    }

    // =====================================================================
    // 2) FIELD PARCELS — patchwork of big rectangular fields. Each parcel:
    //    a single striped bulk quad (ONE draw call) + ONE InstancedMesh of
    //    close-up plants. Lanes between parcels stay bare soil.
    // =====================================================================
    const CROPS = [
      { name: "corn", base: 0x5a4a30, row: 0x4e7d2c, period: 16, gap: 0.45, h: 2.1, plant: "corn", green: M.cornGreen },
      { name: "wheat", base: 0x8a6f34, row: 0xc9a93f, period: 22, gap: 0.55, h: 0.95, plant: "wheat", green: M.wheat },
      { name: "plowed", base: 0x5b4029, row: 0x46301e, period: 14, gap: 0.4, h: 0, plant: null, green: null },
      { name: "pasture", base: 0x4f7a36, row: 0x5d8b3f, period: 10, gap: 0.5, h: 0, plant: "grass", green: M.leafGreen },
      { name: "soy", base: 0x55582c, row: 0x6f8a32, period: 18, gap: 0.5, h: 0.7, plant: "wheat", green: M.leafGreen },
    ];

    // a coarse grid of parcels with a dirt lane gutter between them.
    const fieldArea = { minX: MINX + 40, maxX: MAXX - 40, minZ: MINZ + 40, maxZ: MAXZ - 40 };
    const COLS = 4, ROWS = 4, LANE = 10;
    const cellW = (fieldArea.maxX - fieldArea.minX - LANE * (COLS - 1)) / COLS;
    const cellD = (fieldArea.maxZ - fieldArea.minZ - LANE * (ROWS - 1)) / ROWS;

    // reserve the SE-ish cell for the farmstead (no crops there)
    const homesteadCol = COLS - 1, homesteadRow = ROWS - 1;
    const parcels = [];

    // build all plant instances per crop type into ONE InstancedMesh each
    // (matrices gathered across every parcel of that crop → one draw call).
    const plantMatrices = {};        // cropName -> [Matrix4...]

    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
      _p = new THREE.Vector3(), _scl = new THREE.Vector3();
    function pushPlant(name, x, y, z, sx, sy, sz, ry) {
      (plantMatrices[name] || (plantMatrices[name] = []));
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry || 0);
      _p.set(x, y, z); _scl.set(sx, sy, sz);
      _m.compose(_p, _q, _scl);
      plantMatrices[name].push(_m.clone());
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const px = fieldArea.minX + cellW / 2 + c * (cellW + LANE);
        const pz = fieldArea.minZ + cellD / 2 + r * (cellD + LANE);
        if (c === homesteadCol && r === homesteadRow) { parcels.push({ px, pz, crop: null, homestead: true }); continue; }
        if (parcelTouchesTown(px, pz, cellW, cellD)) continue; // town gets a clean block, never crop fragments under it
        const crop = pick(CROPS);
        // Alternate row direction per parcel. The rows are baked into the
        // unified ground after this deterministic selection pass.
        const rotY = (rng() < 0.5) ? Math.PI / 2 : 0;
        parcels.push({ px, pz, crop, w: cellW, d: cellD, rotY });

        // close-up density: scatter a few hundred plant instances inside it.
        if (crop.plant) {
          const dens = crop.plant === "corn" ? 240 : crop.plant === "grass" ? 160 : 200;
          for (let i = 0; i < dens; i++) {
            const x = px + rr(-cellW / 2 + 2, cellW / 2 - 2);
            const z = pz + rr(-cellD / 2 + 2, cellD / 2 - 2);
            const sy = rr(0.8, 1.2);
            pushPlant(crop.plant, x, (crop.h || 0.6) * sy / 2 + 0.04, z,
              rr(0.8, 1.15), sy, rr(0.8, 1.15), rr(0, Math.PI));
          }
        }
      }
    }

    // One physical/rendered farm surface. Parcel colours and row direction are
    // still deterministic, but they are texels rather than coplanar quads.
    (function buildUnifiedFarmSurface() {
      const x0 = MINX - 8, z0 = MINZ - 8;
      const W = (MAXX - MINX) + 16, D = (MAXZ - MINZ) + 16;
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 2048;
      const ctx = canvas.getContext("2d");
      function css(c) { return "#" + (c >>> 0).toString(16).padStart(6, "0"); }
      function rx(x) { return (x - x0) / W * canvas.width; }
      function rz(z) { return (z - z0) / D * canvas.height; }
      function rect(x, z, w, d, color) {
        ctx.fillStyle = css(color);
        ctx.fillRect(rx(x - w / 2), rz(z - d / 2), w / W * canvas.width, d / D * canvas.height);
      }
      // Pastoral verge matches the continent's organic farm influence. Fields
      // remain intentionally rectangular inside it (real agriculture is), but
      // the COUNTY no longer ends at one giant square soil border.
      ctx.fillStyle = css(0x647847); ctx.fillRect(0, 0, canvas.width, canvas.height);
      rect(CX, CZ, (MAXX - MINX) - 14, (MAXZ - MINZ) - 14, 0x6b4f33);
      rect(CX, CZ, (MAXX - MINX) - 40, (MAXZ - MINZ) - 40, 0x5f8248);
      // real dirt access lanes
      for (let c = 1; c < COLS; c++) {
        const x = fieldArea.minX + c * cellW + (c - 0.5) * LANE;
        rect(x, CZ, LANE, fieldArea.maxZ - fieldArea.minZ, 0x6b4f33);
      }
      for (let r = 1; r < ROWS; r++) {
        const z = fieldArea.minZ + r * cellD + (r - 0.5) * LANE;
        rect(CX, z, fieldArea.maxX - fieldArea.minX, LANE, 0x6b4f33);
      }
      // crop bodies + rows
      for (const p of parcels) {
        if (!p.crop) continue;
        rect(p.px, p.pz, p.w, p.d, p.crop.base);
        const spacing = 6, band = Math.max(1.2, spacing * p.crop.gap);
        if (p.rotY) {
          for (let z = p.pz - p.d / 2 + spacing / 2; z < p.pz + p.d / 2; z += spacing) rect(p.px, z, p.w, band, p.crop.row);
        } else {
          for (let x = p.px - p.w / 2 + spacing / 2; x < p.px + p.w / 2; x += spacing) rect(x, p.pz, band, p.d, p.crop.row);
        }
      }
      // irrigation is part of the same farm skin, not a second blue plane
      rect(CX, fieldArea.minZ + cellD + LANE / 2, MAXX - MINX - 80, 1.4, 0x3f8196);
      rect(fieldArea.minX + cellW + LANE / 2, CZ, 1.4, MAXZ - MINZ - 80, 0x3f8196);
      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = Math.min(8, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(CX, 0, CZ);
      mesh.receiveShadow = true;
      mesh.userData.terrain = true; mesh.userData.worldSurface = true;
      mesh.userData.surfaceOwner = "farmland"; mesh.userData.unifiedSurface = true;
      mesh.name = "farmland-unified-surface";
      root.add(mesh);
      CBZ.farmlandSurface = mesh;
    })();

    // ---- instanced plant prototypes -------------------------------------
    function buildInstanced(geo, material, mats, castShadow) {
      if (!mats || !mats.length) return null;
      const im = new THREE.InstancedMesh(geo, material, mats.length);
      for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = !!castShadow;
      im.receiveShadow = true;
      root.add(im);
      return im;
    }
    // corn: tall thin green stalk box (read close, cheap)
    buildInstanced(new THREE.BoxGeometry(0.18, 2.1, 0.18), M.cornGreen, plantMatrices.corn, true);
    // wheat / soy clump: short golden cone
    buildInstanced(new THREE.ConeGeometry(0.22, 0.95, 5), M.wheat, plantMatrices.wheat, false);
    // pasture grass tuft: tiny cone
    buildInstanced(new THREE.ConeGeometry(0.3, 0.55, 4), M.leafGreen, plantMatrices.grass, false);

    // =====================================================================
    // 3) FENCES — one InstancedMesh of posts + one thin box rail per field
    //    perimeter. We gather post matrices across all fields → one draw call.
    // =====================================================================
    const postMats = [], railMats = [];
    function fenceLine(x0, z0, x1, z1) {
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      const segs = Math.max(1, Math.round(len / 4));
      const ang = Math.atan2(dx, dz);
      for (let i = 0; i <= segs; i++) {
        const t = i / segs, x = x0 + dx * t, z = z0 + dz * t;
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
        _p.set(x, 0.55, z); _scl.set(1, 1, 1);
        _m.compose(_p, _q, _scl); postMats.push(_m.clone());
      }
      // two rails along the run
      for (let railY = 0.4; railY <= 0.9; railY += 0.5) {
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
        _p.set((x0 + x1) / 2, railY, (z0 + z1) / 2); _scl.set(1, 1, len);
        _m.compose(_p, _q, _scl); railMats.push(_m.clone());
      }
    }
    // fence each cropped parcel
    for (const p of parcels) {
      if (!p.crop) continue;
      const hw = p.w / 2 - 1, hd = p.d / 2 - 1;
      fenceLine(p.px - hw, p.pz - hd, p.px + hw, p.pz - hd);
      fenceLine(p.px + hw, p.pz - hd, p.px + hw, p.pz + hd);
      fenceLine(p.px + hw, p.pz + hd, p.px - hw, p.pz + hd);
      fenceLine(p.px - hw, p.pz + hd, p.px - hw, p.pz - hd);
    }
    buildInstanced(new THREE.BoxGeometry(0.12, 1.1, 0.12), M.wood, postMats, false);
    buildInstanced(new THREE.BoxGeometry(0.06, 0.08, 1), M.woodLt, railMats, false);

    // Irrigation channels are painted into the unified surface above.

    // =====================================================================
    // 5) THE FARMSTEAD — enterable barn + farmhouse, silos, windmill/water
    //    tower, chicken coop, farm stand. Lives in the reserved homestead cell.
    // =====================================================================
    const hs = parcels.find((p) => p.homestead) || { px: MAXX - 120, pz: MAXZ - 120 };
    const HX = hs.px, HZ = hs.pz;
    const build = CBZ.cityMakeBuilding;
    const lots = (city.lots = city.lots || []);

    // -- BIG RED BARN (enterable: registered as a building lot) --
    let barnLot = null;
    if (build) {
      // A working county barn, not a house-sized prop. The reserved parcel is
      // nearly 190m across, so this remains comfortably separated from the
      // silo line while reading correctly from the road and from aircraft.
      const bx = HX - 31, bz = HZ - 16, bw = 38, bd = 24;
      const b = build(root, bx, bz, bw, bd, 1, 0xa33327, 0);
      // gable roof on top of the barn shell
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.001, bw * 0.62, 6, 4, 1), M.barnRoof);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(bx, (b && b.FH ? b.FH : 5) + 2.6, bz);
      roof.scale.set(1, 1, bd / bw);
      roof.castShadow = true; root.add(roof);
      // white trim X on the big door
      box(bx, 2, bz - bd / 2 + 0.2, 0.4, 4, 0.3, M.barnTrim);
      const door = { x: bx, z: bz - bd / 2 + 1.6, nx: 0, nz: 1 };
      barnLot = { cx: bx, cz: bz, w: bw, d: bd, kind: "barn", district: "farmland", building: { ...(b || {}), name: "Red Barn", door } };
      lots.push(barnLot);
      tag(root, "RED BARN", 9, 7);
      root.children[root.children.length - 1].position.set(bx, 9, bz);
    }

    // -- SILOS (cylinders, solid colliders) --
    // NO-DECOY FIX: a silo can't take cityMakeBuilding's box shell (wrong
    // footprint entirely), but a real grain silo DOES have a real exterior
    // ladder to a roof hatch — so instead of a sealed doorless cylinder we
    // give each one a climbable rung ladder (CBZ.platforms ramp, the same
    // z-axis-interpolated rig the fire lookout tower / building stairs use)
    // up to a small standable cap platform, plus a work-anchor so a farmhand
    // is actually seen tending the silo line, not just walking past it.
    const siloH = 21, siloR = 3.7, siloTop = siloH + 0.2;
    for (let i = 0; i < 4; i++) {
      const sx = HX - 4 + i * 9.5, sz = HZ - 34, sr = siloR;
      cyl(sx, siloH / 2, sz, sr, sr, siloH, M.silo, true);
      cyl(sx, siloH + 1.7, sz, 0.2, sr + 0.1, 3.4, M.siloCap, false);
      // exterior rung ladder up the +z face (clear of the silo's own AABB, a
      // thin z-aligned ramp so groundAt sees a real climbable surface)
      const lz0 = sz + sr + 0.02, lz1 = sz + sr + 0.9;
      CBZ.platforms.push({
        minX: sx - 0.5, maxX: sx + 0.5, minZ: Math.min(lz0, lz1), maxZ: Math.max(lz0, lz1),
        top: siloTop, ramp: { z0: sz + sr + 0.35, z1: sz + sr + 0.75, y0: 0, y1: siloTop },
      });
      // small round cap platform (stand on the roof hatch)
      CBZ.platforms.push({ minX: sx - 1.6, maxX: sx + 1.6, minZ: sz - 1.6, maxZ: sz + 1.6, top: siloTop });
      // rung visuals (instanced-free — only 3 silos, cheap as plain meshes)
      for (let r = 0; r < 15; r++) {
        const ry = 0.8 + r * 1.32;
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), M.metal);
        rung.position.set(sx, ry, sz + sr + 0.35); root.add(rung);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, siloH, 0.06), M.metal);
      rail.position.set(sx - 0.32, siloH / 2, sz + sr + 0.35); root.add(rail);
      const rail2 = rail.clone(); rail2.position.x = sx + 0.32; root.add(rail2);
    }
    if (CBZ.registerWorkAnchor) {
      CBZ.registerWorkAnchor({
        biome: "farmland", kind: "silo", role: "farmhand",
        x: HX + 10, z: HZ - 34, cap: 2, home: { x: HX + 27, z: HZ + 8 },
        spots: [
          { x: HX - 4, z: HZ - 34 }, { x: HX + 5.5, z: HZ - 34 },
          { x: HX + 15, z: HZ - 34 }, { x: HX + 24.5, z: HZ - 34 },
        ],
      });
    }

    // -- FARMHOUSE (enterable, where the farm family lives) --
    if (build) {
      const fx = HX + 29, fz = HZ + 11, fw = 22, fd = 17;
      const fb = build(root, fx, fz, fw, fd, 2, 0xe7ddc9, 0);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.001, fw * 0.62, 4.5, 4, 1), M.houseRoof);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(fx, (fb && fb.FH ? fb.FH * 2 : 8) + 1.9, fz);
      roof.scale.set(1, 1, fd / fw);
      roof.castShadow = true; root.add(roof);
      const door = { x: fx, z: fz - fd / 2 + 1.6, nx: 0, nz: 1 };
      lots.push({ cx: fx, cz: fz, w: fw, d: fd, kind: "house", district: "farmland", building: { ...(fb || {}), name: "Farmhouse", door } });
      // dress interiors if the shared dresser exists
      if (CBZ.cityFurnishApartment && fb) {
        const fh = fb.FH || 4;
        for (let k = 0; k < 2; k++) CBZ.cityFurnishApartment(fb, k * fh, ((fx | 0) + (fz | 0) + k) & 0x7fffffff);
      }
    }

    // -- WATER TOWER / WINDMILL (tank on legs + spinning blades) --
    // NO-DECOY FIX: same treatment as the silos — a real exterior ladder up
    // one leg to a small catwalk ring platform under the tank, registered as
    // a real climbable/standable surface (CBZ.platforms), not just a solid
    // collider you bump into.
    const wtx = HX + 5, wtz = HZ + 38;
    for (const lx of [-3, 3]) for (const lz of [-3, 3]) {
      // VEH_COLLIDE_FIX: legs are solid steel — the tank above was already a
      // collider but a car could drive clean through its supports.
      const legSolid = !CBZ.CONFIG || CBZ.CONFIG.VEH_COLLIDE_FIX !== false;
      const leg = box(wtx + lx, 5, wtz + lz, 0.4, 10, 0.4, M.metal, legSolid);
      leg.rotation.z = -lx * 0.04; leg.rotation.x = lz * 0.04;
    }
    cyl(wtx, 11.5, wtz, 3, 3, 4, M.metal, true);
    cyl(wtx, 14.5, wtz, 0.1, 3, 2, M.metal, false);
    (function waterTowerLadder() {
      const catwalkY = 9.5;                  // just under the tank
      const lz0 = wtz + 3 + 0.02, lz1 = wtz + 3 + 0.85;
      CBZ.platforms.push({
        minX: wtx - 0.5, maxX: wtx + 0.5, minZ: Math.min(lz0, lz1), maxZ: Math.max(lz0, lz1),
        top: catwalkY, ramp: { z0: wtz + 3.3, z1: wtz + 3.7, y0: 0, y1: catwalkY },
      });
      CBZ.platforms.push({ minX: wtx - 2.4, maxX: wtx + 2.4, minZ: wtz - 2.4, maxZ: wtz + 2.4, top: catwalkY });
      for (let r = 0; r < 7; r++) {
        const ry = 0.8 + r * 1.25;
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), M.metal);
        rung.position.set(wtx, ry, wtz + 3.3); root.add(rung);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 9.5, 0.06), M.metal);
      rail.position.set(wtx - 0.32, 4.75, wtz + 3.3); root.add(rail);
      const rail2 = rail.clone(); rail2.position.x = wtx + 0.32; root.add(rail2);
    })();
    // windmill blades (animated)
    const millHub = new THREE.Group();
    millHub.position.set(wtx, 15.5, wtz - 3.2);
    root.add(millHub);
    for (let i = 0; i < 6; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.5), M.woodLt);
      blade.position.y = 1.3;
      const holder = new THREE.Group();
      holder.rotation.z = (i / 6) * Math.PI * 2;
      holder.add(blade);
      millHub.add(holder);
    }

    // -- CHICKEN COOP (small box + run) --
    // NO-DECOY FIX: too small to fit cityMakeBuilding's real-room shell
    // proportionately (a 5x4 coop would be a comically tiny "building"), so
    // per the task's own sanctioned fallback this gets a simple WORK-ANCHOR +
    // a lightweight "collect eggs" interaction instead of a full interior —
    // proportionate to what a coop actually is.
    const coopX = HX + 30, coopZ = HZ - 24;
    box(coopX, 1.2, coopZ, 5, 2.4, 4, M.woodLt, true);
    box(coopX, 3.2, coopZ, 5.4, 1.2, 4.4, M.houseRoof, false);
    // a handful of chickens (instanced)
    const chickMats = [];
    for (let i = 0; i < 8; i++) {
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      _p.set(coopX + rr(-3, 3), 0.3, coopZ + rr(-3, 3)); _scl.set(1, 1, 1);
      _m.compose(_p, _q, _scl); chickMats.push(_m.clone());
    }
    buildInstanced(new THREE.BoxGeometry(0.4, 0.4, 0.6), M.chick, chickMats, false);
    if (CBZ.registerWorkAnchor) {
      CBZ.registerWorkAnchor({
        biome: "farmland", kind: "coop", role: "farmhand",
        x: coopX, z: coopZ, cap: 1, home: { x: HX + 29, z: HZ + 11 },
        spots: [{ x: coopX - 2, z: coopZ + 3 }, { x: coopX + 2, z: coopZ + 3 }],
      });
    }
    if (CBZ.interactions && CBZ.interactions.registerZone) {
      const coopSpot = { x: coopX, z: coopZ + 3.2, kind: "coop-eggs" };
      let nextEggT = 0;
      CBZ.interactions.registerZone({
        id: "farm-coop-eggs", kind: "coop-eggs", radius: 3.0,
        find: function (px, pz) {
          const dx = coopSpot.x - px, dz = coopSpot.z - pz;
          return (dx * dx + dz * dz) < 3.0 * 3.0 ? coopSpot : null;
        },
        options: [{
          id: "coop-collect-eggs", slot: "e",
          label: function () { return (CBZ.now || 0) < nextEggT ? "Coop's picked clean for now" : "Collect eggs"; },
          canShow: function () { return (CBZ.now || 0) >= nextEggT; },
          onSelect: function () {
            nextEggT = (CBZ.now || 0) + 180000;        // ~3 min — a real coop refills slowly
            if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(12);
            if (CBZ.sfx) CBZ.sfx("coin");
            if (CBZ.city && CBZ.city.note) CBZ.city.note("🥚 Collected a basket of eggs — sold for $12.", 2.0);
          },
        }],
      });
    }

    // -- ROADSIDE FARM STAND (next to the causeway) --
    // NO-DECOY FIX: had a "FRESH PRODUCE" sign but zero vendor wiring, unlike
    // every other shop in the game. Mirrors the exact owner+counter+vendorSpot
    // contract city/buildings.js stamps on every hand-placed shop lot (see the
    // barn/farmhouse above for the cityMakeBuilding half of that contract) and
    // pushes into city.shopLots the same way city/towngen.js exposes its town
    // shops to the arena (A.shopLots) — that's the ONE list peds.js's finishSpawn
    // walks to actually staff a counter with a vendor ped, and shops.js's
    // generic ped:vendor registry (interact.js) opens the buy menu off it. No
    // new vendor system invented — this is the existing one, reused.
    const standX = ROAD_X + 14, standZ = MAXZ - 16, standW = 6, standD = 4;
    box(standX, 1.6, standZ, standW, 3.2, standD, M.woodLt, true);
    box(standX, 3.6, standZ, standW + 1.5, 0.4, standD + 1, M.barnRed, false);
    if (CBZ.makeLabelSprite) {
      const s = CBZ.makeLabelSprite("FARM STAND — FRESH PRODUCE");
      if (s) { s.position.set(standX, 5.4, standZ); s.scale.set(9, 2.1, 1); root.add(s); }
    }
    (function farmStandVendor() {
      // the road (ROAD_X=1180) sits WEST of the stand (standX=ROAD_X+14), so
      // the customer-facing counter/door is the -x face; door/vendorSpot both
      // sit just OUTSIDE the solid stand box (half-width standW/2=3) so the
      // vendor ped never spawns overlapping its own collider.
      const standDoor = { x: standX - standW / 2 - 1.2, z: standZ, nx: -1, nz: 0 };
      const vendorSpot = { x: standX - standW / 2 - 0.9, z: standZ, face: Math.PI / 2 };   // at the counter, facing the road
      const standLot = {
        cx: standX, cz: standZ, w: standW, d: standD, kind: "food", district: "farmland",
        building: {
          name: "Farm Stand", sign: 0xa33327, shop: { kind: "food", name: "Farm Stand", sign: 0xa33327 },
          door: standDoor, vendorSpot,
          owner: { type: "business", id: null, name: "Farmer Dale", buyable: true, _acct: { cash: 700 } },
        },
      };
      // lots IS city.lots (aliased above) — one push covers both. Then mirror
      // towngen.js's T1 exposure: also push into city.shopLots (== A.shopLots,
      // the arena), the ONE list peds.js's finishSpawn walks to actually spawn
      // a vendor ped at vendorSpot, and every generic vendor interaction reads.
      lots.push(standLot);
      (city.shopLots = city.shopLots || []).push(standLot);
    })();

    // =====================================================================
    // 6) HAY BALES + SCARECROWS (instanced / cheap)
    // =====================================================================
    const baleMats = [];
    if (CBZ.cityScatterInRegion) {
      const reg = { kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 0 };
      const pts = CBZ.cityScatterInRegion(reg, 26, rng, 20);
      for (const pt of pts) {
        if (inTown(pt.x, pt.z)) continue;   // T7 — no hay bales in the market streets
        _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);   // lay cylinder on side
        _p.set(pt.x, 0.7, pt.z); _scl.set(1, 1, 1);
        _m.compose(_p, _q, _scl); baleMats.push(_m.clone());
        // VEH_COLLIDE_FIX: a 1.4m round bale is a half-ton of packed hay — it
        // looked solid but was pure InstancedMesh decoration a car ghosted
        // through. AABB matches the side-lying cylinder's footprint.
        if (!CBZ.CONFIG || CBZ.CONFIG.VEH_COLLIDE_FIX !== false) {
          cols.push({ minX: pt.x - 0.85, maxX: pt.x + 0.85, minZ: pt.z - 0.85, maxZ: pt.z + 0.85 });
        }
      }
    }
    buildInstanced(new THREE.CylinderGeometry(0.7, 0.7, 1.6, 10), M.hay, baleMats, true);

    // scarecrows: cross post + straw head, in a few cropped parcels
    let scareCount = 0;
    for (const p of parcels) {
      if (!p.crop || scareCount >= 5) continue;
      if (rng() < 0.55) {
        const sx = p.px + rr(-p.w / 4, p.w / 4), sz = p.pz + rr(-p.d / 4, p.d / 4);
        box(sx, 1.1, sz, 0.12, 2.2, 0.12, M.wood, false);
        box(sx, 1.7, sz, 1.6, 0.12, 0.12, M.wood, false);
        box(sx, 2.4, sz, 0.45, 0.5, 0.45, M.scareHead, false);
        box(sx, 1.6, sz, 0.7, 0.7, 0.25, M.scareShirt, false);
        scareCount++;
      }
    }

    // =====================================================================
    // 7) LIVESTOCK — instanced cows (in pasture) + sheep flock. Low-poly,
    //    each species ONE InstancedMesh (body) → reads at distance cheaply.
    // =====================================================================
    function placeHerd(material, count, cx, cz, spread, sx, sy, sz) {
      const mats = [];
      for (let i = 0; i < count; i++) {
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
        _p.set(cx + rr(-spread, spread), sy / 2 + 0.05, cz + rr(-spread, spread));
        _scl.set(1, 1, 1); _m.compose(_p, _q, _scl); mats.push(_m.clone());
      }
      buildInstanced(new THREE.BoxGeometry(sx, sy, sz), material, mats, true);
      return mats;
    }
    // cows graze a pasture parcel (find one tagged pasture, else use a corner)
    const pastureParcel = parcels.find((p) => p.crop && p.crop.name === "pasture") ||
      { px: MINX + 120, pz: MINZ + 120 };
    placeHerd(M.cow, 12, pastureParcel.px, pastureParcel.pz, 26, 1.8, 1.1, 0.9);
    // sheep flock tighter, lighter
    placeHerd(M.sheep, 16, MINX + 130, MAXZ - 140, 16, 1.0, 0.8, 0.6);

    // =====================================================================
    // 8) TRACTOR + COMBINE — try traffic-car models so they read as vehicles;
    //    fall back to simple static boxes so the farm never looks empty.
    // =====================================================================
    // FARM EQUIPMENT IS REAL now (owner: "farm has fake equipment"): each rig
    // registers as a first-class parked vehicle via CBZ.cityRegisterVehicle —
    // enterable/drivable ("Boost it" like any parked car), solid to traffic
    // (resolveCars), keeping its own custom body. persist:true so a traffic
    // reset never strips the farm. Fallback (helper absent / flag off): the
    // old static AABB collider, so the rigs are at minimum solid.
    const equipReal = (!CBZ.CONFIG || CBZ.CONFIG.FARM_EQUIPMENT_REAL !== false) && !!CBZ.cityRegisterVehicle;
    function staticTractor(x, z, bodyMat, name) {
      // HUMAN-RATIO PASS: real farm-tractor envelope is ~4.6L x 2.4W x ~2.9H to
      // the cab roof (John Deere 8530-class chassis is ~3.25m but the owner
      // wanted the toy read pulled down toward a mid-size utility tractor so it
      // sits believably beside a 1.82m driver). Was 2.4x4.2 body + a 3.4-tall
      // cab and ~3.1-wide wheel stance — a full head-and-shoulders too tall/wide
      // next to the shrunk human. Members stay chunky (>=0.3u) and every box
      // overlaps its neighbour in y so the rig is support-connected to the wheels.
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.25, 4.0), bodyMat);
      body.position.y = 1.15; body.castShadow = true; g.add(body);   // top 1.775
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.8), M.metal);
      cab.position.set(0, 2.2, -0.4); g.add(cab);                    // top 2.9, base 1.5 overlaps body
      // non-empty userData spares every panel from the static batch merge —
      // a driven rig must take its whole body with it, not leave a baked ghost.
      if (equipReal) { body.userData.vehiclePart = true; cab.userData.vehiclePart = true; }
      // big rear wheels, small front — stance trimmed so the outer tyre face
      // lands at |x|=1.2 (0.95 hub + 0.25 half-tread) → 2.4u track.
      for (const [wx, wz, wr] of [[-0.95, -1.2, 0.9], [0.95, -1.2, 0.9], [-0.85, 1.5, 0.55], [0.85, 1.5, 0.55]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.5, 12), M.tire);
        w.rotation.z = Math.PI / 2; w.position.set(wx, wr, wz); g.add(w);
        // tagged so the driven rig spins its wheels — the non-empty userData
        // also spares these meshes from the static batch merge.
        if (equipReal) w.userData.playerWheel = true;
      }
      root.add(g);
      if (equipReal) {
        g.userData.farmRig = name || "Tractor";   // spares the group's meshes' parent from batching by ref
        CBZ.cityRegisterVehicle(g, {
          body: "pickup", style: "van", persist: true, heading: 0,
          model: { name: name || "Tractor", value: 2600, rarity: 0.05, body: "pickup" },
          dims: { width: 2.4, length: 4.6, height: 2.9, wheelbase: 2.5 },
          color: 0x2e7d32,
        });
      } else {
        // static fallback: at least a solid obstacle, never a ghost
        cols.push({ minX: x - 1.2, maxX: x + 1.2, minZ: z - 2.3, maxZ: z + 2.3 });
      }
      return g;
    }
    staticTractor(HX - 4, HZ + 4, M.tractorGreen, "Tractor");
    // combine: bigger yellow body with a header up front (the header is what
    // reads it as a harvester; the chassis matches the tractor envelope above).
    const comb = staticTractor(HX - 12, HZ + 6, M.tractorYellow, "Combine Harvester");
    const header = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.7, 1.4), M.metal);
    header.position.set(0, 0.75, 2.6); comb.add(header);   // inner edge overlaps the 4.0-long body
    if (equipReal) header.userData.vehiclePart = true;
    // Exact official Three.js 3MF sample truck: its loader/model/materials are
    // preserved and the shared vehicle registrar makes it stealable/drivable.
    // The procedural tractor/combine remain because they are different farm
    // machines, not placeholders for this road truck.
    if (CBZ.spawnOfficialFarmTruck) CBZ.spawnOfficialFarmTruck(root, HX + 11, HZ - 8, Math.PI * 0.08);

    // =====================================================================
    // 8b) HARVEST MARKET — the farm county's market town, grown from the
    //     reusable generator on the road spine (T7). Now that the keystone (T1)
    //     wired the arena, the grocer/feed-store/co-op-bank become REAL buyable,
    //     walk-in, staffed businesses serving the county. FALLBACK: if towngen /
    //     the recipe is absent this whole block no-ops and the fields above stand
    //     as the farm (the inTown skips were HAS_TOWN-gated → zero regression).
    // =====================================================================
    if (HAS_TOWN) {
      if (CBZ.placement && CBZ.placement.seedFromColliders) { try { CBZ.placement.seedFromColliders(); } catch (e) {} }
      const town = CBZ.buildTown(root, Object.assign({}, CBZ.CITY_TEMPLATES.harvestmarket, {
        cx: TOWN_CX, cz: TOWN_CZ, region: TOWN, rng: rng,
        name: "Harvest Market", district: "farmland", integratedSkyline: true,
      }));
      // WORK-ANCHORS at the grocer + co-op bank so county NPCs commute to the
      // market (the same schedule/goal brain the mainland uses). Feature-detected.
      if (town && CBZ.registerWorkAnchor) {
        const findLot = function (kw) {
          return (town.lots || []).find(function (l) {
            return l.building && l.building.shop && l.building.name &&
              l.building.name.toUpperCase().indexOf(kw) >= 0;
          });
        };
        const grocer = findLot("GROCER") || (town.lots || []).find(function (l) { return l.building && l.building.shop; });
        const coop = findLot("CO-OP") || findLot("BANK");
        for (const a of [grocer, coop]) {
          if (!a || !a.building || !a.building.vendorSpot) continue;
          try {
            CBZ.registerWorkAnchor({
              biome: "farmland", kind: "shop", role: "shopkeeper",
              x: a.cx, z: a.cz, cap: 1,
              spots: [{ x: a.building.vendorSpot.x, z: a.building.vendorSpot.z }],
              home: { x: a.cx, z: a.cz },
            });
          } catch (e) {}
        }
      }
    }

    // =====================================================================
    // 9) THE CAUSEWAY — drivable country-road deck south to the desert.
    // =====================================================================
    if (CBZ.buildHighway) {
      // REAL wide dirt country-road highway over the water to the desert.
      // heightAt: grade-follow world/terrain.js relief (0 over this rect's
      // flat playable footprint — a free, safe hook for the backdrop rim).
      CBZ.buildHighway(root, {
        path: [{ x: ROAD_X, z: ROAD_MINZ }, { x: ROAD_X, z: ROAD_MAXZ }],
        width: 24, lanesPerDir: 2, laneW: 3.6, theme: "dirt",
        guardrail: false, elevated: false, rng: rng,
        heightAt: CBZ.terrainHeight,
      });
      // soft soil shoulder so the deck reads as raised land over the sea
      plane(ROAD_X, (ROAD_MINZ + ROAD_MAXZ) / 2, 24 + 8, ROAD_MAXZ - ROAD_MINZ, M.soil, 0.025);
    } else {
      // ---- fallback: bespoke narrow deck (only if buildHighway absent) ----
      plane(ROAD_X, (ROAD_MINZ + ROAD_MAXZ) / 2, ROAD_HW * 2, ROAD_MAXZ - ROAD_MINZ, M.road, 0.04);
      // dashed centre line
      for (let z = ROAD_MINZ + 4; z < ROAD_MAXZ; z += 12) plane(ROAD_X, z, 0.4, 5, M.roadLine, 0.06);
      // soft soil shoulders so the deck reads as raised land over the sea
      plane(ROAD_X, (ROAD_MINZ + ROAD_MAXZ) / 2, ROAD_HW * 2 + 8, ROAD_MAXZ - ROAD_MINZ, M.soil, 0.025);
    }
    // Country roads are intentionally open: no guard posts or hidden edge
    // blocks.  Drivers, horses and wildlife can leave the road anywhere.

    // =====================================================================
    // 10) LIVE PEDS — a small cast: farmer + farmhands + a farm dog. Kept
    //     LOW count (owner rule) so the open valley stays cheap.
    // =====================================================================
    if (CBZ.cityMakePed && CBZ.cityPeds) {
      function farmHand(x, z, name, job) {
        const ped = CBZ.cityMakePed(x, z, rng, {
          name: name, kind: "civilian", job: job, wealth: 0.25,
          archetype: "resident", aggr: 0.2,
        });
        if (!ped) return null;
        ped.group.position.set(x, 0, z);
        root.add(ped.group);
        CBZ.cityPeds.push(ped);
        if (ped.target) ped.target.set(x, 0, z);
        return ped;
      }
      farmHand(HX + 10, HZ + 2, "Farmer Dale", "farmer");
      farmHand(HX - 16, HZ - 6, "Farmhand", "farmhand");
      farmHand(pastureParcel.px, pastureParcel.pz, "Rancher", "rancher");
    }
    // =====================================================================
    //  WORK-ANCHORS — publish where the farm's people actually WORK, reusing
    //  the geometry already built (field parcels, the barn, the pasture). The
    //  aigoals job/schedule brain routes farmers/ranchers to these and works
    //  them through the day. The farmhouse is everyone's home. (NO new geometry.)
    // =====================================================================
    if (CBZ.registerWorkAnchor) {
      const farmHome = { x: HX + 29, z: HZ + 11 };          // the farmhouse door area
      // each cropped parcel is a FIELD a farmer tends (3 task points inside it)
      for (const p of parcels) {
        if (!p.crop) continue;
        const hw = (p.w || cellW) / 2 - 6, hd = (p.d || cellD) / 2 - 6;
        CBZ.registerWorkAnchor({
          biome: "farmland", kind: "field", role: "farmer",
          x: p.px, z: p.pz, cap: 2, home: farmHome,
          spots: [
            { x: p.px - hw, z: p.pz - hd },
            { x: p.px + hw, z: p.pz + hd },
            { x: p.px, z: p.pz },
          ],
        });
      }
      // the barn is a RANCH a rancher works: barn door, the pasture, the hay/coop
      const bDoor = (barnLot && barnLot.building && barnLot.building.door) || { x: HX - 28, z: HZ - 26 };
      CBZ.registerWorkAnchor({
        biome: "farmland", kind: "ranch", role: "rancher",
        x: bDoor.x, z: bDoor.z, cap: 2, home: farmHome,
        spots: [
          { x: bDoor.x, z: bDoor.z },                       // barn door
          { x: pastureParcel.px, z: pastureParcel.pz },     // out with the herd
          { x: HX + 30, z: HZ - 24 },                       // the chicken coop / hay
        ],
      });
    }

    // Request a normal dogs.js actor at the homestead. The old two-box prop
    // slid around a circle with frozen legs and could not be hurt, fed or
    // tamed; this anchor is consumed after the shared dog system owns its root.
    (CBZ.cityDogSpawnRequests || (CBZ.cityDogSpawnRequests = [])).push({
      x: HX + 6, z: HZ + 8, name: "Farm Dog", homeRadius: 12,
    });

    // =====================================================================
  // 11) ANIMATION — windmill spin. The real farm dog animates in dogs.js.
    // =====================================================================
    if (CBZ.onUpdate) {
      let t = 0;
      CBZ.onUpdate(33.3, function (dt) {
        t += dt || 0.016;
        millHub.rotation.z = t * 0.6;
      });
    }

    // =====================================================================
    // 12) REGISTER REGIONS (archipelago contract) — biome + causeway.
    // =====================================================================
    CBZ.registerCityRegion(city, { name: "Coyle Valley", subtitle: "Farm County", biome: "farmland", kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 8 });
    // causeway widened to the 24m highway deck (x-span ±12 about the centreline)
    CBZ.registerCityRegion(city, { name: "Coyle Causeway", subtitle: "Farm County", kind: "rect", minX: ROAD_X - 12, maxX: ROAD_X + 12, minZ: ROAD_MINZ, maxZ: ROAD_MAXZ, pad: 1 });
    // give traffic a road down the causeway (runs along Z → vertical)
    if (city.roads) {
      city.roads.push({ x: ROAD_X, z: (ROAD_MINZ + ROAD_MAXZ) / 2, vertical: true, len: ROAD_MAXZ - ROAD_MINZ, district: "highway", w: 24, lanesPerDir: 2, laneW: 3.6 });
    }
  }, 33);
})();
