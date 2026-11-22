/* ============================================================
   city/precinct_site.js — THE PRECINCT'S LOT: where the police station
   stands, with its yard for the cruisers.

   The precinct (games/police.js, PRECINCT 13) is a site venue: it had no
   lot kind, so it searched outward from the city for open flat ground and,
   once the coast came to the downtown, found it on the north beach, with
   sand and loungers inside the building. A city puts its police station
   in the downtown on a street, with a yard behind a fence for the cars.

   The WHERE is the world plan's (src/world/worldplan.js sites.precinct,
   published as CBZ.cityPrecinctSite(): the building's origin, its street
   door, the kerb, the yard and its bays). This file claims that ground
   once the boroughs have planned theirs (order 44: the block was left
   empty between their two arterials, and a region there before order 43
   would make Gang City North cut its own street at the precinct's door), lays it flat, and paves it: the forecourt from the door to the kerb,
   the yard beside the building with its bays painted and a fence round it,
   open to the street. The building and everything in it stay
   games/police.js's; the cruisers in the bays are the police's to park
   (CBZ.cityPrecinctSite().yard.bays).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.addLandmass) return;
  const THREE = window.THREE;
  const BGU = THREE.BufferGeometryUtils;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  function slab(list, x0, z0, x1, z1, y) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    list.push(g);
  }
  function post(list, x, z, w, d, h) {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, h / 2, z); list.push(g);
  }
  function mesh(root, list, col, step) {
    if (!list.length) return;
    const g = BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(list) : list[0];
    let m = cmat(col);
    if (step) { m = m.clone(); m.polygonOffset = true; m.polygonOffsetFactor = -step; m.polygonOffsetUnits = -2 * step; }
    const o = new THREE.Mesh(g, m);
    o.receiveShadow = true; o.matrixAutoUpdate = false; o.updateMatrix(); o.name = "precinct-lot";
    root.add(o);
  }

  CBZ.addLandmass(function (city) {
    const S = CBZ.cityPrecinctSite && CBZ.cityPrecinctSite();
    if (!S || !city || !city.root) return;
    const L = S.lot, Y = S.yard, root = city.root;
    CBZ.registerCityRegion(city, { name: "Precinct 13", subtitle: "Gang City Police", kind: "rect", biome: "precinct",
      minX: L.minX, maxX: L.maxX, minZ: L.minZ, maxZ: L.maxZ, pad: 2 });
    if (CBZ.terrainFlattenUnder) CBZ.terrainFlattenUnder({ minX: L.minX, maxX: L.maxX, minZ: L.minZ, maxZ: L.maxZ, pad: 6, name: "precinct" });
    if (CBZ.registerNoSpawnZone) { try { CBZ.registerNoSpawnZone(city, { minX: Y.minX, maxX: Y.maxX, minZ: Y.minZ, maxZ: Y.maxZ, label: "precinct-yard" }); } catch (e) {} }
    const conc = [], asph = [], paint = [], fence = [];
    // the lot's ground, the forecourt (door to kerb), the yard
    slab(conc, L.minX, L.minZ, L.maxX, L.maxZ, 0.04);
    slab(asph, Y.minX, Y.minZ, Y.maxX, Y.maxZ, 0.06);
    // the bays: a white line either side of each, nose to the back fence
    for (const b of Y.bays) {
      for (const s of [-1, 1]) slab(paint, b.x + s * 1.5 - 0.06, b.z - 2.6, b.x + s * 1.5 + 0.06, b.z + 2.6, 0.08);
    }
    // the fence: back and both sides, the street side open (the gate)
    const H = 2.4, T = 0.08;
    for (let x = Y.minX; x <= Y.maxX + 0.01; x += 3) post(fence, x, Y.minZ, 0.12, 0.12, H);
    for (let z = Y.minZ; z <= Y.maxZ - 8; z += 3) { post(fence, Y.minX, z, 0.12, 0.12, H); post(fence, Y.maxX, z, 0.12, 0.12, H); }
    post(fence, (Y.minX + Y.maxX) / 2, Y.minZ, Y.maxX - Y.minX, T, 0.1); fence[fence.length - 1].translate(0, H - 0.1, 0);
    for (const x of [Y.minX, Y.maxX]) { post(fence, x, (Y.minZ + Y.maxZ - 8) / 2, T, Y.maxZ - 8 - Y.minZ, 0.1); fence[fence.length - 1].translate(0, H - 0.1, 0); }
    mesh(root, conc, 0x9a9890, 0); mesh(root, asph, 0x2e3034, 1); mesh(root, paint, 0xe8e8e2, 2); mesh(root, fence, 0x6c7076, 0);
    if (CBZ.colliders) {
      CBZ.colliders.push({ minX: Y.minX - 0.1, maxX: Y.maxX + 0.1, minZ: Y.minZ - 0.1, maxZ: Y.minZ + 0.1, y0: 0, y1: H });
      CBZ.colliders.push({ minX: Y.minX - 0.1, maxX: Y.minX + 0.1, minZ: Y.minZ, maxZ: Y.maxZ - 8, y0: 0, y1: H });
      CBZ.colliders.push({ minX: Y.maxX - 0.1, maxX: Y.maxX + 0.1, minZ: Y.minZ, maxZ: Y.maxZ - 8, y0: 0, y1: H });
    }
  }, 44);
})();
