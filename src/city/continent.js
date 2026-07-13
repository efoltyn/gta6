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
   into the plate's outer rim (the outermost 8-42u), slopes it down through
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

  CBZ.addLandmass(function (city) {
    if (CFG.CITY_CONTINENT === false) return;
    const regs = (city.regions || []).slice();
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
    const PAD = 40;
    minX -= PAD; maxX += PAD; minZ -= PAD; maxZ += PAD;
    const W = maxX - minX, D = maxZ - minZ;
    if (!isFinite(W) || W <= 0 || W > 12000) return;

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
    // coast inset: how far inside the plate rect the waterline sits (8-42u,
    // two blended wavelengths so headlands + small notches both appear)
    function coastInset(x, z) {
      return 8 + (noise2(x, z, 260, 8810) * 0.72 + noise2(x, z, 90, 8811) * 0.28) * 34;
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
    function shoreField(x, z) {
      const e = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);  // inset in plate rect
      let s = e - coastInset(x, z);
      if (HARBOR) {
        const bd = bayDist(x, z);
        const sBay = bd <= BAY0 ? (BAY0 - bd)
                   : (bd >= BAY1 ? (bd - BAY1) : -Math.min(bd - BAY0, BAY1 - bd));
        if (sBay < s) s = sBay;
      }
      if (s < 12 && inSolidRegion(x, z, 8)) s = 12;   // POIs are never carved
      return s;
    }

    // ---- the ground plate: one draw call, vertex-coloured country ---------
    // With COAST on the grid is denser (the rim needs resolution) and the
    // outer band slopes through sand into carved seabed under the sea plane.
    const SEG = COAST ? 160 : 72;
    const geo = new THREE.PlaneGeometry(W, D, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x69a05a), cDry = new THREE.Color(0x8f9a58);
    const cDirt = new THREE.Color(0x9a7d52), cScrub = new THREE.Color(0x5b8a5e);
    const cLush = new THREE.Color(0x4e8a52);                 // moist shore band
    const cSand = new THREE.Color(0xdcc794), cWet = new THREE.Color(0xbfa877);
    const cBed = new THREE.Color(0x8a8a6b);                  // submerged seabed
    const c = new THREE.Color(), c2 = new THREE.Color();
    const cx0 = (minX + maxX) / 2, cz0 = (minZ + maxZ) / 2;
    const GROUND_Y = -0.06;                                   // interior land level
    // cache the shore field per vertex — the foam pass re-reads it below
    const sGrid = COAST ? new Float32Array(pos.count) : null;
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + cx0, wz = pos.getZ(i) + cz0;
      // two octaves of position-hash "noise" pick the patch tone —
      // deterministic per seed, no shared rng stream touched.
      const h1 = CBZ.hash01 ? CBZ.hash01(Math.floor(wx / 90), Math.floor(wz / 90), 8801) : 0.5;
      const h2 = CBZ.hash01 ? CBZ.hash01(Math.floor(wx / 22), Math.floor(wz / 22), 8802) : 0.5;
      c.copy(h1 < 0.55 ? cGrass : (h1 < 0.8 ? cScrub : cDry));
      if (h2 > 0.86) c.copy(cDirt);                        // dirt breaks
      // large-scale hue drift (300u) so kilometres of country stop reading
      // as one repeated swatch — dryer here, greener there.
      const drift = noise2(wx, wz, 300, 8812) - 0.5;
      c.lerp(cDry, Math.max(0, drift) * 0.5);
      c.lerp(cLush, Math.max(0, -drift) * 0.4);
      let y = GROUND_Y;
      if (COAST) {
        const s = shoreField(wx, wz);
        sGrid[i] = s;
        if (s < 0) {
          // underwater: slope the seabed down below the sea plane (-0.48)
          const t = Math.min(1, -s / 9);
          y = -0.44 - t * 1.15;                            // -0.44 → -1.59
          c.copy(cWet).lerp(cBed, t);
        } else if (s < 26) {
          // the shore rim: wet sand at the waterline → dry sand → grass
          y = -0.44 + sm(Math.min(1, s / 26)) * (GROUND_Y + 0.44);
          if (s < 6) c.copy(cWet).lerp(cSand, sm(s / 6));
          else if (s < 15) c.copy(cSand);
          else c2.copy(c), c.copy(cSand).lerp(c2, sm((s - 15) / 11));
        } else if (s < 52) {
          // moist band just behind the sand — the coast reads vegetated
          c.lerp(cLush, (1 - (s - 26) / 26) * 0.35);
        }
      }
      const shade = 0.92 + h2 * 0.1;                       // subtle facet variation
      pos.setY(i, y);
      colors[i * 3] = c.r * shade; colors[i * 3 + 1] = c.g * shade; colors[i * 3 + 2] = c.b * shade;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (COAST) geo.computeVertexNormals();                 // the rim slopes want real shading
    const plate = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    // interior sits just under the islands' y=0 slabs (no z-fight), well
    // above the sea; carved verts carry their own absolute depth.
    plate.position.set(cx0, COAST ? 0 : -0.06, cz0);
    plate.receiveShadow = true;
    plate.userData.terrain = true;         // farcull: backdrop class, never culled
    city.root.add(plate);

    // ---- FOAM BREAKERS: marched along the true coast ----------------------
    // Scan the plate grid for zero crossings of the cached shore field and
    // drop a small white dash at each, oriented along the coast (perpendicular
    // to the field gradient). One merged mesh, one Basic material whose
    // opacity pulses in onAlways — the shoreline visibly breathes.
    let foamMat = null;
    if (COAST && CBZ.hash01) (function foam() {
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
        if (h > 0.34) continue;                              // sparse country, not a forest
        const jx = gx + ((CBZ.hash01 ? CBZ.hash01(gx, gz, 8804) : 0.5) - 0.5) * CELL * 0.8;
        const jz = gz + ((CBZ.hash01 ? CBZ.hash01(gx, gz, 8805) : 0.5) - 0.5) * CELL * 0.8;
        if (insideAnything(jx, jz, 14)) continue;            // never dress a place
        if (COAST && shoreField(jx, jz) < 16) continue;      // never dress the water/sand
        spots.push({ x: jx, z: jz, h });
      }
    }
    if (spots.length) {
      const dummy = new THREE.Object3D();
      const nTree = spots.filter((s) => s.h < 0.24).length;
      const trunkG = new THREE.BoxGeometry(0.5, 2.6, 0.5);
      const canopyG = new THREE.BoxGeometry(2.6, 2.6, 2.6);
      const rockG = new THREE.BoxGeometry(1.6, 1.1, 1.4);
      const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x6b4a2a }), Math.max(1, nTree));
      const canopies = new THREE.InstancedMesh(canopyG, new THREE.MeshLambertMaterial({ color: 0x3f7a3f }), Math.max(1, nTree));
      const rocks = new THREE.InstancedMesh(rockG, new THREE.MeshLambertMaterial({ color: 0x8b8f96 }), Math.max(1, spots.length - nTree));
      let ti = 0, ri = 0;
      for (const s of spots) {
        const scale = 0.8 + (CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8806) : 0.5) * 0.7;
        const rot = (CBZ.hash01 ? CBZ.hash01(s.x, s.z, 8807) : 0.3) * Math.PI * 2;
        if (s.h < 0.24) {
          dummy.position.set(s.x, 1.3 * scale - 0.06, s.z); dummy.rotation.set(0, rot, 0); dummy.scale.setScalar(scale);
          dummy.updateMatrix(); trunks.setMatrixAt(ti, dummy.matrix);
          dummy.position.y = (2.6 + 1.3) * scale - 0.06;
          dummy.updateMatrix(); canopies.setMatrixAt(ti, dummy.matrix);
          ti++;
        } else {
          dummy.position.set(s.x, 0.45 * scale - 0.06, s.z); dummy.rotation.set(0, rot, 0); dummy.scale.setScalar(scale);
          dummy.updateMatrix(); rocks.setMatrixAt(ri, dummy.matrix);
          ri++;
        }
      }
      trunks.count = canopies.count = ti; rocks.count = ri;
      trunks.instanceMatrix.needsUpdate = canopies.instanceMatrix.needsUpdate = rocks.instanceMatrix.needsUpdate = true;
      trunks.frustumCulled = canopies.frustumCulled = rocks.frustumCulled = false;
      trunks.userData.terrain = canopies.userData.terrain = rocks.userData.terrain = true;
      city.root.add(trunks, canopies, rocks);
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
    const IN = COAST ? 44 : -4;            // 44u coast margin; legacy ≈ old pad 4
    if (HARBOR && hasCity) {
      reg(city.minX - BAY0, city.maxX + BAY0, city.minZ - BAY0, city.maxZ + BAY0); // city + quay apron
      reg(minX + IN, city.minX - BAY1, minZ + IN, maxZ - IN);                      // west country
      reg(city.maxX + BAY1, maxX - IN, minZ + IN, maxZ - IN);                      // east country
      reg(city.minX - BAY1, city.maxX + BAY1, city.maxZ + BAY1, maxZ - IN);        // north band
      reg(city.minX - BAY1, city.maxX + BAY1, minZ + IN, city.minZ - BAY1);        // south band
    } else {
      reg(minX + IN, maxX - IN, minZ + IN, maxZ - IN);
    }
  }, 97);   // after every island/biome/mini-city/country builder
})();
