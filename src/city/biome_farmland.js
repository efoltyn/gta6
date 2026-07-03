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
    // 1) GROUND — earthy soil/grass valley floor under everything.
    // =====================================================================
    plane(CX, CZ, (MAXX - MINX) + 16, (MAXZ - MINZ) + 16, M.soil, 0.01);
    // a few grass tinted overlays so the bare lanes read as soil, the rest green
    plane(CX, CZ, (MAXX - MINX) - 40, (MAXZ - MINZ) - 40, M.grass, 0.012);

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
        if (inTown(px, pz)) continue;       // T7 — this cell is the market town, not a field
        const crop = pick(CROPS);
        // striped bulk quad — the field "body" in one draw call
        const tex = stripeTex(crop.base, crop.row, crop.gap, crop.period);
        const tm = new THREE.MeshLambertMaterial({ map: tex.clone() });
        tm.map.repeat.set(Math.max(1, cellW / 6), Math.max(1, cellD / 6));
        tm.map.needsUpdate = true;
        // alternate stripe direction per parcel so the patchwork reads
        const rotY = (rng() < 0.5) ? Math.PI / 2 : 0;
        plane(px, pz, cellW, cellD, tm, 0.03, rotY);
        parcels.push({ px, pz, crop, w: cellW, d: cellD });

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

    // =====================================================================
    // 4) IRRIGATION — thin water channels along two dirt lanes (low alpha-free
    //    flat quads, a couple of draw calls).
    // =====================================================================
    plane(CX, fieldArea.minZ + cellD + LANE / 2, MAXX - MINX - 80, 1.4, M.water, 0.05);
    plane(fieldArea.minX + cellW + LANE / 2, CZ, 1.4, MAXZ - MINZ - 80, M.water, 0.05);

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
      const bx = HX - 28, bz = HZ - 18, bw = 22, bd = 16;
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
    for (let i = 0; i < 3; i++) {
      const sx = HX - 6 + i * 7, sz = HZ - 30;
      cyl(sx, 7, sz, 2.6, 2.6, 14, M.silo, true);
      cyl(sx, 14 + 1.2, sz, 0.2, 2.7, 2.6, M.siloCap, false);
    }

    // -- FARMHOUSE (enterable, where the farm family lives) --
    if (build) {
      const fx = HX + 22, fz = HZ + 6, fw = 14, fd = 12;
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
    const wtx = HX + 4, wtz = HZ + 34;
    for (const lx of [-3, 3]) for (const lz of [-3, 3]) {
      const leg = box(wtx + lx, 5, wtz + lz, 0.4, 10, 0.4, M.metal, false);
      leg.rotation.z = -lx * 0.04; leg.rotation.x = lz * 0.04;
    }
    cyl(wtx, 11.5, wtz, 3, 3, 4, M.metal, true);
    cyl(wtx, 14.5, wtz, 0.1, 3, 2, M.metal, false);
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
    box(HX + 30, 1.2, HZ - 24, 5, 2.4, 4, M.woodLt, true);
    box(HX + 30, 3.2, HZ - 24, 5.4, 1.2, 4.4, M.houseRoof, false);
    // a handful of chickens (instanced)
    const chickMats = [];
    for (let i = 0; i < 8; i++) {
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      _p.set(HX + 30 + rr(-3, 3), 0.3, HZ - 24 + rr(-3, 3)); _scl.set(1, 1, 1);
      _m.compose(_p, _q, _scl); chickMats.push(_m.clone());
    }
    buildInstanced(new THREE.BoxGeometry(0.4, 0.4, 0.6), M.chick, chickMats, false);

    // -- ROADSIDE FARM STAND (next to the causeway) --
    box(ROAD_X + 14, 1.6, MAXZ - 16, 6, 3.2, 4, M.woodLt, true);
    box(ROAD_X + 14, 3.6, MAXZ - 16, 7.5, 0.4, 5, M.barnRed, false);
    if (CBZ.makeLabelSprite) {
      const s = CBZ.makeLabelSprite("FARM STAND — FRESH PRODUCE");
      if (s) { s.position.set(ROAD_X + 14, 5.4, MAXZ - 16); s.scale.set(9, 2.1, 1); root.add(s); }
    }

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
    function staticTractor(x, z, bodyMat) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 4.2), bodyMat);
      body.position.y = 1.3; body.castShadow = true; g.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2), M.metal);
      cab.position.set(0, 2.6, -0.4); g.add(cab);
      // big rear wheels, small front
      for (const [wx, wz, wr] of [[-1.3, -1.2, 1.1], [1.3, -1.2, 1.1], [-1.1, 1.5, 0.6], [1.1, 1.5, 0.6]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.5, 12), M.tire);
        w.rotation.z = Math.PI / 2; w.position.set(wx, wr, wz); g.add(w);
      }
      root.add(g);
      cols.push({ minX: x - 1.5, maxX: x + 1.5, minZ: z - 2.4, maxZ: z + 2.4 });
      return g;
    }
    staticTractor(HX - 4, HZ + 4, M.tractorGreen);
    // combine: bigger yellow body with a header up front
    const comb = staticTractor(HX - 12, HZ + 6, M.tractorYellow);
    const header = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.8, 1.4), M.metal);
    header.position.set(0, 0.8, 2.8); comb.add(header);

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
        name: "Harvest Market", district: "farmland",
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
      CBZ.buildHighway(root, {
        path: [{ x: ROAD_X, z: ROAD_MINZ }, { x: ROAD_X, z: ROAD_MAXZ }],
        width: 24, lanesPerDir: 2, laneW: 3.6, theme: "dirt",
        guardrail: true, lights: true, elevated: false, rng: rng,
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
    // guard posts along the causeway (instanced) — only for the bespoke
    // fallback deck; the real highway supplies its own guardrails.
    if (!CBZ.buildHighway) {
      const guardMats = [];
      for (let z = ROAD_MINZ; z <= ROAD_MAXZ; z += 10) for (const side of [-1, 1]) {
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
        _p.set(ROAD_X + side * (ROAD_HW + 0.6), 0.5, z); _scl.set(1, 1, 1);
        _m.compose(_p, _q, _scl); guardMats.push(_m.clone());
      }
      buildInstanced(new THREE.BoxGeometry(0.16, 1, 0.16), M.wood, guardMats, false);
    }

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
      const farmHome = { x: HX + 22, z: HZ + 6 };          // the farmhouse door area
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

    // farm dog — simple low-poly that trots near the homestead
    const dog = new THREE.Group();
    dog.position.set(HX + 6, 0, HZ + 8);
    const dbody = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 1.0), M.dog);
    dbody.position.y = 0.5; dbody.castShadow = true; dog.add(dbody);
    const dhead = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), M.dog);
    dhead.position.set(0, 0.62, 0.6); dog.add(dhead);
    root.add(dog);

    // =====================================================================
    // 11) ANIMATION — windmill spin + dog trot. ONE onUpdate, cheap.
    // =====================================================================
    if (CBZ.onUpdate) {
      let t = 0;
      const dogHome = new THREE.Vector3(HX + 6, 0, HZ + 8);
      CBZ.onUpdate(33.3, function (dt) {
        t += dt || 0.016;
        millHub.rotation.z = t * 0.6;
        // dog ambles in a small loop near the farmhouse
        const a = t * 0.4;
        dog.position.x = dogHome.x + Math.cos(a) * 6;
        dog.position.z = dogHome.z + Math.sin(a) * 6;
        dog.rotation.y = -a + Math.PI / 2;
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
      city.roads.push({ x: ROAD_X, z: (ROAD_MINZ + ROAD_MAXZ) / 2, vertical: true, len: ROAD_MAXZ - ROAD_MINZ, district: "highway" });
    }
  }, 33);
})();
