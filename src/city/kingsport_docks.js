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

   SECOND PASS (what it looked like from the road and the yard):
     · the apron stood 1.1 m proud of the land as a white block, a step
       along the whole dock road, and nobody stood on it (the ground under
       it was the land's, y 0): people and forklifts were knee-deep in the
       deck. It is laid at grade now, its face following the quay line
       (it was a 10 m staircase along the water);
     · its tones were written for walls and came out snow white and candy
       pastel on flat ground in this sun: the deck is concrete grey, the
       boxes are container colours, the cranes red and white;
     · the transit sheds were blank boxes: they have roller doors on both
       long sides, a man door, a rooflight band;
     · the yard has its slot lines, high-mast lights, a fence along the dock
       road and a gate with a gatehouse at the east end (the fence, lines
       and masts are left out on a phone: CBZ.facadeLite).

   Merged geometry, one mesh per colour (no colour is added for the second
   pass: doors, fence and masts take the cranes' grey, lines the boom's
   white); colliders on the crane legs, the stacks, the sheds, the fence and
   the masts. Landmass order 44 (after the metros plan).
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
  const QUAY_Y = 0.1, SETBACK = 4;       // deck top (at grade: the land the yard stands on is y 0); quay face this far inland of the plan's shore
  // flat ground and big plain faces take the whole sun here: these are the
  // tones that come out as concrete, paint and steel
  // (measured against the sun on the quay: 0x2e2d2a comes out a mid concrete
  // grey on the flat, 0x9c9a94 came out snow)
  const COL = { deck: 0x2e2d2a, face: 0x1a1a18, fender: 0x111111, rail: 0x2a2a2a, red: 0x6a1a0e, white: 0x8c8c88, grey: 0x2e3034,
    shed: 0x3b4044, shedRoof: 0x24282b };
  const BOXC = [0x0c1e3a, 0x3a0e06, 0x0a2412, 0x4a3004, 0x5a5a55, 0x5a1e04];   // six, as before: one draw each

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
    const LITE = CBZ.facadeLite ? CBZ.facadeLite() : false;
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
    // quads [[x,y,z] x4] wound to face out -> one geometry (position, normal, uv, like a box)
    const sheet = function (col, quads) {
      if (!quads.length) return;
      const pos = [], idx = [];
      for (const q of quads) { const s = pos.length / 3; for (const p of q) pos.push(p[0], p[1], p[2]); idx.push(s, s + 1, s + 2, s, s + 2, s + 3); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
      g.setIndex(idx); g.computeVertexNormals();
      put(col, g);
    };

    // ---- the quay line, every 10 m
    const line = [];
    for (let x = X0; x <= X1 + 0.1; x += 10) { const z = shoreZ(x); if (z != null) line.push({ x: x, z: z }); }
    if (line.length < 4) return;
    let maxZ = -1e9; for (const p of line) maxZ = Math.max(maxZ, p.z);
    const zAt = function (x) {
      const k = Math.max(0, Math.min(line.length - 2, Math.floor((x - X0) / 10)));
      const a = line[k], b = line[k + 1];
      return a.z + (b.z - a.z) * Math.max(0, Math.min(1, (x - a.x) / (b.x - a.x || 1)));
    };

    // ---- the apron: the deck from the dock road's kerb to the quay line, at
    //      grade, and the quay face down into the water along that line
    const APRON_Z = ROAD_Z + 6;
    const top = [], face = [];
    let ax0 = null, ax1 = null;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      if (Math.min(a.z, b.z) - APRON_Z < 6) continue;
      if (ax0 == null) ax0 = a.x; ax1 = b.x;
      top.push([[a.x, QUAY_Y, APRON_Z], [a.x, QUAY_Y, a.z], [b.x, QUAY_Y, b.z], [b.x, QUAY_Y, APRON_Z]]);
      face.push([[a.x, QUAY_Y, a.z], [a.x, -4.2, a.z], [b.x, -4.2, b.z], [b.x, QUAY_Y, b.z]]);
      // the fender line, just above the water, square to the face
      const L = Math.hypot(b.x - a.x, b.z - a.z), ang = Math.atan2(b.z - a.z, b.x - a.x);
      box(COL.fender, (a.x + b.x) / 2 - Math.sin(ang) * 0.15, -0.2, (a.z + b.z) / 2 + Math.cos(ang) * 0.15, L - 1, 0.6, 0.3, -ang);
    }
    sheet(COL.deck, top); sheet(COL.face, face);
    if (ax0 == null) return;
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
      // four legs: 18 m apart along the quay, the seaward pair 6 m in from the face, the landward 30 m
      for (const u of [-9, 9]) for (const v of [-6, -30]) {
        const p = at(u, v);
        box(COL.red, p.x, 16, p.z, 1.4, 32, 1.4, rot);
        solid(p.x - 1, p.z - 1, p.x + 1, p.z + 1, 32);
      }
      // the portal beams and the sill beams
      for (const v of [-6, -30]) { const p = at(0, v); box(COL.red, p.x, 31.5, p.z, 20, 1.6, 1.6, rot); box(COL.red, p.x, 9, p.z, 20, 1, 1, rot); }
      for (const u of [-9, 9]) { const p = at(u, -18); box(COL.red, p.x, 31.5, p.z, 1.6, 1.6, 25, rot); }
      // the boom: 50 m over the water, 22 m back over the yard, a girder box
      const B = at(0, -30 + (72 / 2) - 22 + 14);
      box(COL.white, B.x, 36, B.z, 3.2, 2.4, 72, rot);
      // the apex frame and the forestays, the machinery house, the trolley
      const A = at(0, -18); box(COL.red, A.x, 44, A.z, 2, 22, 2, rot);
      const M = at(0, -32); box(COL.grey, M.x, 39, M.z, 8, 5, 10, rot);
      const T = at(0, 20); box(COL.grey, T.x, 33.5, T.z, 4, 2.6, 5, rot);
      // the rails the crane runs on
      for (const v of [-6, -30]) {
        const p = at(0, v); box(COL.rail, p.x, QUAY_Y + 0.05, p.z, 120, 0.12, 0.4, rot);
      }
    }

    // ---- the container stacks: rows behind the cranes' landward rail,
    //      blocks of 6 x 4 boxes, one to four high, with the slot lines
    //      painted round them and a high mast lighting each gap
    let seed = 7;
    const rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const blocks = [];
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
      blocks.push({ x0: bx, x1: bx + 78, z0: z0, z1: z0 + rows * 3.2 });
    }
    if (!LITE) {
      const PY = QUAY_Y + 0.015;
      for (const b of blocks) {
        // the slot lines: one between every row, the bay ends across them
        for (let z = b.z0 - 0.2; z <= b.z1 + 0.01; z += 3.2) box(COL.white, (b.x0 + b.x1) / 2, PY, z, b.x1 - b.x0 + 0.6, 0.03, 0.14);
        for (let c = 0; c <= 6; c++) box(COL.white, b.x0 + c * 13 - 0.35, PY, (b.z0 + b.z1) / 2 - 0.2, 0.14, 0.03, b.z1 - b.z0);
      }
      // the masts: one at each gap between the blocks and one at each end
      const mx = [];
      if (blocks.length) { mx.push(blocks[0].x0 - 8); for (let i = 0; i + 1 < blocks.length; i++) mx.push((blocks[i].x1 + blocks[i + 1].x0) / 2); mx.push(blocks[blocks.length - 1].x1 + 8); }
      for (const x of mx) {
        const z = APRON_Z + 14;
        box(COL.grey, x, 14, z, 0.6, 28, 0.6);
        box(COL.grey, x, 28.2, z, 4.2, 0.4, 1.4);
        box(COL.white, x, 27.85, z, 3.8, 0.3, 1.0);                       // the lamp heads' glass
        solid(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 28);
      }
    }

    // ---- two transit sheds at the east end, by the gate: steel sheds with
    //      a roller door every 12 m on both long sides, a man door, and a
    //      band of rooflights down the ridge line
    for (const s of [{ x: X1 - 70, w: 60 }, { x: X1 - 140, w: 50 }]) {
      const z0 = APRON_Z + 10, z1 = Math.min(zAt(s.x) - 44, z0 + 40);
      if (z1 - z0 < 16) continue;
      const zc = (z0 + z1) / 2, D = z1 - z0;
      box(COL.shed, s.x, QUAY_Y + 5, zc, s.w, 10, D);
      box(COL.shedRoof, s.x, QUAY_Y + 10.4, zc, s.w + 1, 0.8, D + 1);
      box(COL.white, s.x, QUAY_Y + 10.85, zc, s.w - 6, 0.12, 3);           // rooflights
      const n = Math.max(2, Math.floor(s.w / 12));
      for (const sg of [-1, 1]) {
        const zf = sg < 0 ? z0 - 0.07 : z1 + 0.07;
        for (let k = 0; k < n; k++) {
          const x = s.x - s.w / 2 + (k + 0.5) * s.w / n;
          box(COL.grey, x, QUAY_Y + 2.75, zf, 5, 5.5, 0.14);                // the roller door
          box(COL.shedRoof, x, QUAY_Y + 5.75, zf + sg * 0.12, 5.6, 0.5, 0.36); // its box over the opening
        }
        box(COL.grey, s.x - s.w / 2 + 2.2, QUAY_Y + 1.05, zf, 1.0, 2.1, 0.14);  // the man door
      }
      solid(s.x - s.w / 2, z0, s.x + s.w / 2, z1, QUAY_Y + 10);
    }

    // ---- the fence along the dock road, and the gate at the east end with
    //      its gatehouse and barrier (the lorries come in off the arterial)
    const GX0 = X1 - 34, GX1 = X1 - 18, FZ = APRON_Z + 1.2;
    {
      box(COL.white, GX1 + 3, QUAY_Y + 1.4, FZ + 3, 3, 2.8, 3);                  // the gatehouse
      box(COL.grey, GX1 + 3, QUAY_Y + 1.9, FZ + 1.46, 2.4, 0.9, 0.1);           // its window to the lane
      box(COL.shedRoof, GX1 + 3, QUAY_Y + 2.95, FZ + 3, 3.6, 0.3, 3.6);
      solid(GX1 + 1.5, FZ + 1.5, GX1 + 4.5, FZ + 4.5, 3);
      box(COL.white, (GX0 + GX1) / 2 + 2, QUAY_Y + 1.05, FZ + 0.6, GX1 - GX0 - 4, 0.12, 0.12); // the barrier arm
      box(COL.grey, GX1 - 0.4, QUAY_Y + 0.55, FZ + 0.6, 0.5, 1.1, 0.5);
    }
    if (!LITE) {
      const runs = [[ax0, GX0], [GX1, Math.min(ax1, X1)]];
      for (const r of runs) {
        const x0 = r[0], x1 = r[1];
        if (x1 - x0 < 3) continue;
        for (let x = x0; x <= x1 + 0.01; x += 3) box(COL.grey, x, QUAY_Y + 1.2, FZ, 0.08, 2.4, 0.08);
        for (const y of [0.15, 1.2, 2.35]) box(COL.grey, (x0 + x1) / 2, QUAY_Y + y, FZ, x1 - x0, 0.05, 0.05);
        solid(x0, FZ - 0.1, x1, FZ + 0.1, 2.4);
      }
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
