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
     • One walkable "underlay" region registered LAST so specific places
       keep winning point-in-region queries; swim.js treats the whole span
       as land, clampToCity lets you walk POI to POI in a straight line.

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

  CBZ.addLandmass(function (city) {
    if (CFG.CITY_CONTINENT === false) return;
    const regs = (city.regions || []).slice();
    if (!regs.length) return;

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

    // ---- the ground plate: one draw call, vertex-coloured country ---------
    const SEG = 72;
    const geo = new THREE.PlaneGeometry(W, D, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x69a05a), cDry = new THREE.Color(0x8f9a58);
    const cDirt = new THREE.Color(0x9a7d52), cScrub = new THREE.Color(0x5b8a5e);
    const c = new THREE.Color();
    const cx0 = (minX + maxX) / 2, cz0 = (minZ + maxZ) / 2;
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + cx0, wz = pos.getZ(i) + cz0;
      // two octaves of position-hash "noise" pick the patch tone —
      // deterministic per seed, no shared rng stream touched.
      const h1 = CBZ.hash01 ? CBZ.hash01(Math.floor(wx / 90), Math.floor(wz / 90), 8801) : 0.5;
      const h2 = CBZ.hash01 ? CBZ.hash01(Math.floor(wx / 22), Math.floor(wz / 22), 8802) : 0.5;
      c.copy(h1 < 0.55 ? cGrass : (h1 < 0.8 ? cScrub : cDry));
      if (h2 > 0.86) c.copy(cDirt);                        // dirt breaks
      const shade = 0.92 + h2 * 0.1;                       // subtle facet variation
      colors[i * 3] = c.r * shade; colors[i * 3 + 1] = c.g * shade; colors[i * 3 + 2] = c.b * shade;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const plate = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    // just under the islands' y=0 slabs (no z-fight), well above the sea at -0.5
    plate.position.set(cx0, -0.06, cz0);
    plate.receiveShadow = true;
    plate.userData.terrain = true;         // farcull: backdrop class, never culled
    city.root.add(plate);

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

    // ---- the walkable underlay region (registered LAST on purpose: every
    //      specific place wins point-in-region queries; this only catches the
    //      country between them) -------------------------------------------
    CBZ.registerCityRegion(city, {
      name: "The Backcountry", subtitle: "Open Country", biome: "wilds", kind: "rect",
      minX, maxX, minZ, maxZ, pad: 4, underlay: true,
    });
  }, 97);   // after every island/biome/mini-city/country builder
})();
