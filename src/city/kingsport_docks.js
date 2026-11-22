/* ============================================================
   city/kingsport_docks.js — KINGSPORT'S DOCKS, on Kings Harbour.

   The world plan makes Kingsport "the great port on the south coast at the
   Kings River mouth" (src/world/worldplan.js METROS.kingsport), and the
   coast was brought up to the city's south edge for it. Nothing was built
   there: the metro planner's `port` only nudges which superblocks go
   industrial, and the ones by the water came out empty, so the harbour
   shore east of the river mouth was a sand beach below vacant blocks.
   Standing on Kingsport's waterfront you saw no port at all.

   This lays the container terminal on that shore: a concrete quay apron
   following the coast from the river mouth east, four ship-to-shore
   gantry cranes on the quay edge with their booms over the water, rows
   of stacked containers in the yard behind, two transit sheds, and the
   dock road that ties the terminal to Kingsport's south arterial (x -2705)
   on the traffic graph. The quay line is read off the plan's own coast
   (worldPlan.landAt), never typed.

   Merged geometry, one mesh per material; colliders on the crane legs,
   the stacks and the sheds. Landmass order 44 (after the metros plan).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.addLandmass) return;
  const THREE = window.THREE;
  const BGU = THREE.BufferGeometryUtils;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  const X0 = -3190, X1 = -2740;          // the quay: from just east of where the Kings River fans out (its last meander reaches x -3235) east
  const ROAD_Z = 4600, ROAD_X = -2705;   // the dock road, and the arterial it leaves
  const QUAY_Y = 1.1, SETBACK = 4;       // deck height; quay face this far inland of the plan's shore

  function shoreZ(x) {
    const P = CBZ.worldPlan;
    if (!P || !P.landAt) return null;
    let z = ROAD_Z;
    while (P.landAt(x, z) > 0 && z < ROAD_Z + 600) z += 2;
    return z - SETBACK;
  }

  CBZ.addLandmass(function (city) {
    if (!city || !city.root || !CBZ.worldPlan || !CBZ.worldPlan.landAt) return;
    if (CBZ.worldPlan.landAt(X0, ROAD_Z) < 20) return;        // the coast is not where this file was written for
    const root = city.root;
    const geo = {};
    const put = function (col, g) { (geo[col] || (geo[col] = [])).push(g); };
    const cols = CBZ.colliders || null;
    const solid = function (x0, z0, x1, z1, y1) { if (cols) cols.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), y0: 0, y1: y1 }); };
    // a box at (x, y, z), size (w, h, d), turned `rot` about y
    const box = function (col, x, y, z, w, h, d, rot) {
      const g = new THREE.BoxGeometry(w, h, d);
      if (rot) g.rotateY(rot);
      g.translate(x, y, z); put(col, g);
    };

    // ---- the quay line, every 10 m
    const line = [];
    for (let x = X0; x <= X1 + 0.1; x += 10) { const z = shoreZ(x); if (z != null) line.push({ x: x, z: z }); }
    if (line.length < 4) return;
    let maxZ = -1e9; for (const p of line) maxZ = Math.max(maxZ, p.z);

    // ---- the apron: a strip per 10 m step, from the dock road's kerb to the quay face
    const APRON_Z = ROAD_Z + 6;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], zf = Math.min(a.z, b.z);
      if (zf - APRON_Z < 6) continue;
      box(0x9c9a94, (a.x + b.x) / 2, QUAY_Y / 2 - 0.4, (APRON_Z + zf) / 2, b.x - a.x + 0.2, QUAY_Y + 0.8, zf - APRON_Z);
      // the quay face: a dark concrete wall down into the water, and its fender line
      box(0x55534e, (a.x + b.x) / 2, -1.6, zf + 0.6, b.x - a.x + 0.2, 5.4, 1.2);
      box(0x1d1d1f, (a.x + b.x) / 2, 0.2, zf + 1.3, b.x - a.x - 1, 0.8, 0.3);
    }
    if (CBZ.terrainFlattenUnder) CBZ.terrainFlattenUnder({ minX: X0, maxX: X1, minZ: ROAD_Z - 10, maxZ: maxZ, pad: 8, name: "kingsport docks" });

    // ---- the cranes: legs on the quay, the boom out over the water,
    //      turned square to the quay face where each stands
    const CRANES = [-3120, -3030, -2940, -2850];
    for (const cx of CRANES) {
      const k = Math.max(0, Math.min(line.length - 2, Math.round((cx - X0) / 10)));
      const a = line[k], b = line[k + 1];
      const ang = Math.atan2(b.z - a.z, b.x - a.x);               // along the quay
      const zq = a.z + (b.z - a.z) * ((cx - a.x) / (b.x - a.x || 1));
      const ux = Math.cos(ang), uz = Math.sin(ang), nx = -uz, nz = ux;   // n: out over the water (+z side)
      const at = function (u, v) { return { x: cx + ux * u + nx * v, z: zq + uz * u + nz * v }; };
      const rot = -ang;
      const RED = 0xc8452e, WHITE = 0xe8e6e0, GREY = 0x4a4c50;
      // four legs: 18 m apart along the quay, the seaward pair 6 m in from the face, the landward 30 m
      for (const u of [-9, 9]) for (const v of [-6, -30]) {
        const p = at(u, v);
        box(RED, p.x, 16, p.z, 1.4, 32, 1.4, rot);
        solid(p.x - 1, p.z - 1, p.x + 1, p.z + 1, 32);
      }
      // the portal beams and the sill beams
      for (const v of [-6, -30]) { const p = at(0, v); box(RED, p.x, 31.5, p.z, 20, 1.6, 1.6, rot); box(RED, p.x, 9, p.z, 20, 1, 1, rot); }
      for (const u of [-9, 9]) { const p = at(u, -18); box(RED, p.x, 31.5, p.z, 1.6, 1.6, 25, rot); }
      // the boom: 50 m over the water, 22 m back over the yard, a girder box
      const B = at(0, -30 + (72 / 2) - 22 + 14);
      box(WHITE, B.x, 36, B.z, 3.2, 2.4, 72, rot);
      // the apex frame and the forestays, the machinery house, the trolley
      const A = at(0, -18); box(RED, A.x, 44, A.z, 2, 22, 2, rot);
      const M = at(0, -32); box(GREY, M.x, 39, M.z, 8, 5, 10, rot);
      const T = at(0, 20); box(GREY, T.x, 33.5, T.z, 4, 2.6, 5, rot);
      // the rails the crane runs on
      for (const v of [-6, -30]) {
        const p = at(0, v); box(0x6a6a6a, p.x, QUAY_Y + 0.05, p.z, 120, 0.12, 0.4, rot);
      }
    }

    // ---- the container stacks: rows behind the cranes' landward rail,
    //      blocks of 6 x 4 boxes, one to four high
    const BOXC = [0x3a6ea5, 0xb04a32, 0x2f7d4a, 0xd0a030, 0x7a7d82, 0x8a3a6a];
    let seed = 7;
    const rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let bx = X0 + 90; bx + 80 < X1 - 120; bx += 95) {
      const k = Math.max(0, Math.min(line.length - 1, Math.round((bx + 40 - X0) / 10)));
      const zTop = line[k].z - 40;                                      // landward of the crane rail
      const z0 = APRON_Z + 8;
      if (zTop - z0 < 14) continue;
      const rows = Math.min(6, Math.floor((zTop - z0) / 3.2));
      for (let r = 0; r < rows; r++) for (let c = 0; c < 6; c++) {
        const h = 1 + ((rnd() * 4) | 0);
        for (let l = 0; l < h; l++) box(BOXC[(rnd() * BOXC.length) | 0], bx + c * 13 + 6.1, QUAY_Y + 1.3 + l * 2.6, z0 + r * 3.2 + 1.2, 12.2, 2.5, 2.4);
      }
      solid(bx, z0, bx + 78, z0 + rows * 3.2, QUAY_Y + 10.5);
    }
    // ---- two transit sheds at the east end, by the gate
    for (const s of [{ x: X1 - 70, w: 60 }, { x: X1 - 140, w: 50 }]) {
      const k = Math.max(0, Math.min(line.length - 1, Math.round((s.x - X0) / 10)));
      const z0 = APRON_Z + 10, z1 = Math.min(line[k].z - 44, z0 + 40);
      if (z1 - z0 < 16) continue;
      box(0x8c9296, s.x, QUAY_Y + 5, (z0 + z1) / 2, s.w, 10, z1 - z0);
      box(0x5a6066, s.x, QUAY_Y + 10.4, (z0 + z1) / 2, s.w + 1, 0.8, z1 - z0 + 1);
      solid(s.x - s.w / 2, z0, s.x + s.w / 2, z1, QUAY_Y + 10);
    }

    for (const col in geo) {
      const list = geo[col];
      const g = BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(list) : null;
      if (!g) { for (const one of list) root.add(new THREE.Mesh(one, cmat(+col))); continue; }
      const m = new THREE.Mesh(g, cmat(+col));
      m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      m.name = "kingsport-docks"; root.add(m);
    }

    // ---- the dock road: the arterial to the west end of the terminal
    const ROAD_W = 12;
    if (CBZ.buildHighway) {
      CBZ.buildHighway(root, { path: [{ x: ROAD_X - 4.5, z: ROAD_Z }, { x: X0 + 10, z: ROAD_Z }], width: ROAD_W, lanesPerDir: 1, median: false,
        laneW: 3.6, theme: "asphalt", registerRoads: false, owner: "kingsportdocks", guardrail: false });
    }
    if (city.roads) city.roads.push({ x: (ROAD_X + X0 + 10) / 2, z: ROAD_Z, vertical: false, len: ROAD_X - (X0 + 10), district: "kingsport",
      w: ROAD_W, lanesPerDir: 1, laneW: 3.6, owner: "kingsportdocks", name: "Dock Road" });
    // the terminal's ground as strips that follow the quay: a region holds
    // land (city/waterfield.js), and one rectangle down to the quay's
    // furthest point pushed the harbour back 140 m from the western berths,
    // leaving a beach between the cranes and the water
    for (let i = 0; i + 5 < line.length; i += 5) {
      const seg = line.slice(i, i + 6);
      let zf = 1e9; for (const p of seg) zf = Math.min(zf, p.z);
      CBZ.registerCityRegion(city, { name: "Kingsport Docks", subtitle: "Container Terminal", kind: "rect", biome: "kingsportdocks",
        minX: seg[0].x, maxX: seg[seg.length - 1].x, minZ: ROAD_Z - ROAD_W / 2, maxZ: zf + 1, pad: 0 });
    }
  }, 44);
})();
