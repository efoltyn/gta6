/* ============================================================
   world/island_police.js — THE ISLAND'S POLICE STATION.

   Owner, 2026-10-22: "Police offices: that's where the police are, that's
   where they come from."

   On the islands (mode "archipelago") the force city/police.js runs is
   based in a real building: the island's police station (an island_plan.js
   lot with use "police" once the plan stamps uses; until then the Town
   Hall's civic lot stands in). This file is that building's police half:

     THE STATION   found once per island: its front door on the street, the
                   street it fronts, the kerb a unit pulls up at.
     THE FIT-OUT   a venue fit-out (CBZ.islandVenue.on("police")): it runs
                   when the island is built and goes when the island does.
                   Inside, under the building's own group: a front counter
                   with the desk sergeant behind it (a real officer of the
                   force, posted there), and along the back wall a lock-up of
                   two or three holding cells, solid side walls to the
                   ceiling, a barred front, a barred door that swings on its
                   hinge, a bench and a steel toilet in each. The ground
                   floor's house furniture is folded away first
                   (CBZ.islandVenue.clear): no sofa in a station. An island
                   with no police lot gets its Town Hall's the first time the
                   force asks for a station.
     THE YARD      cruisers parked out front (nose-in in the forecourt where
                   there is one, else along the kerb). A patrol unit is one
                   of these pulling out (city/police.js spawnPatrolCar takes
                   one through takeCruiser()); an empty bay is refilled only
                   where nobody can see it happen.
     THE CELLS     city/wanted.js's arrest arc on the islands ends here: the
                   ride stops at this kerb, the walk-in goes through this
                   door, a petty collar is fined at this counter, anything
                   heavier is walked into a cell and the door is shut on him
                   (lockUp / unlock), and only later does the transfer to the
                   prison come.

   API  CBZ.islandPolice = {
          station()         -> the cityPoliceStation record for the island in
                               force: { x, z (the door), lot: { cx, cz,
                               building: { door:{x,z,nx,nz}, h } }, gate }
          gate(heavy)       -> the arrest arc's gate (wanted.js stationGate shape)
          takeCruiser()     -> a parked cruiser, woken, or null
          lockUp(i?) / unlock(i) / cellAt(x, z) / cells()
          drop(A)           -> the island A's station leaves (its colliders)
          state()
        }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const CW = 2.3, CD = 2.6;          // a holding cell: 2.3 m wide, 2.6 m deep (a real 7 x 8 ft cell)
  const WALL_T = 0.15;               // the lock-up's own block walls
  const BAR_H = 2.2;                 // the barred front's height (a header wall above it)
  const LEAF_W = 0.86;               // the cell door
  const BAY_N = 3;                   // cruiser bays at the station

  const STATIONS = new Map();        // arena -> station record
  let active = null;

  function onIsles() { return g.mode === "archipelago"; }

  /* ---- WHICH BUILDING ----------------------------------------------------- */
  function buildingsOf(A) { return (A && (A.fragile || (A.island && A.island.buildings))) || []; }
  function underRoot(b, root) {
    for (let p = b && b.group; p; p = p.parent) if (p === root) return true;
    return false;
  }
  function findStationBuilding(A) {
    const IV = CBZ.islandVenue;
    if (IV && IV.list) {
      try {
        const L = IV.list("police") || [];
        for (const b of L) if (b && !b.fallen && underRoot(b, A.root)) return b;
      } catch (e) {}
    }
    const B = buildingsOf(A);
    for (const b of B) if (b && !b.fallen && (b.use === "police" || (b.lot && b.lot.use === "police"))) return b;
    // until the plan stamps uses: the Town Hall's civic lot
    for (const b of B) if (b && !b.fallen && b.interior && /town hall/i.test(b.name || (b.lot && b.lot.name) || "")) return b;
    let best = null, bd = 1e18;
    for (const b of B) {
      if (!b || b.fallen || !b.interior) continue;
      const k = b.kind || (b.lot && b.lot.kind);
      if (k !== "civic" && k !== "office") continue;
      const d = Math.hypot(b.x - A.center.x, b.z - A.center.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /* ---- THE BUILDING'S FRAME ---------------------------------------------- */
  // local (door on -z) -> world, through the group the building is drawn in
  function frameOf(b) {
    const grp = b.group;
    grp.updateMatrixWorld(true);
    const M = grp.matrixWorld.clone();
    const yaw = b.rotY || grp.rotation.y || 0;
    const v = new THREE.Vector3();
    return {
      M: M, yaw: yaw,
      w: function (lx, ly, lz) { v.set(lx, ly, lz).applyMatrix4(M); return { x: v.x, y: v.y, z: v.z }; },
      // a local direction in the world (yaw only)
      dir: function (lx, lz) { const c = Math.cos(yaw), s = Math.sin(yaw); return { x: lx * c + lz * s, z: -lx * s + lz * c }; },
    };
  }
  function rectHit(a, b) { return a.x1 > b.x0 + 1e-3 && a.x0 < b.x1 - 1e-3 && a.z1 > b.z0 + 1e-3 && a.z0 < b.z1 - 1e-3; }

  /* ---- THE PLAN OF THE FIT-OUT (building-local) -------------------------- */
  function planFit(b) {
    const I = b.interior;
    if (!I) return null;
    const X0 = I.x0, X1 = I.x1, Z0 = I.z0, Z1 = I.z1;
    const keep = (I.keepOut || []).filter(function (k) { return k.why !== "front walk"; });
    const out = { X0, X1, Z0, Z1, cells: [], desk: null, side: 1 };
    // the lock-up: along the back wall, on whichever side clears the stair or
    // the lift, three cells if they fit, else two
    for (let n = 3; n >= 2 && !out.cells.length; n--) {
      for (const side of [1, -1]) {
        const xa = side > 0 ? X1 - n * CW : X0, xb = side > 0 ? X1 : X0 + n * CW;
        const box = { x0: xa - WALL_T, x1: xb, z0: Z1 - CD - 0.2, z1: Z1 };
        if (xa < X0 + 0.4 || xb > X1 + 1e-6) continue;
        if (box.z0 < Z0 + 4.4) continue;                     // the hall in front of it stays a hall
        if (keep.some(function (k) { return rectHit(box, k); })) continue;
        for (let i = 0; i < n; i++) {
          const c0 = side > 0 ? X1 - (i + 1) * CW : X0 + i * CW;
          out.cells.push({ i: i, x0: c0, x1: c0 + CW, z0: Z1 - CD, z1: Z1 });
        }
        out.side = side; out.lock = box;
        break;
      }
    }
    // the front counter: beside the door, past the walk in from it
    for (const s of [out.side, -out.side]) {
      const box = s > 0 ? { x0: 1.9, x1: 3.95, z0: Z0 + 1.45, z1: Z0 + 3.0 } : { x0: -3.95, x1: -1.9, z0: Z0 + 1.45, z1: Z0 + 3.0 };
      if (box.x0 < X0 + 0.3 || box.x1 > X1 - 0.3) continue;
      if (keep.some(function (k) { return rectHit(box, k); })) continue;
      if (out.lock && rectHit(box, out.lock)) continue;
      out.desk = { side: s, box: box, cx: (box.x0 + box.x1) / 2, top: Z0 + 1.45, back: Z0 + 2.05 };
      break;
    }
    // the intake point: just inside the door, on its axis
    out.intake = { x: 0, z: Math.min(Z0 + 3.2, (Z0 + Z1) / 2) };
    return out;
  }

  /* ---- GEOMETRY: boxes merged by material, vertex-coloured ---------------- */
  let MAT = null;
  function mat() {
    if (MAT) return MAT;
    MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
    MAT.name = "island-police:fit";
    MAT._shared = true;
    return MAT;
  }
  function hexRGB(h) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; }
  const FACES = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
    [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
  ];
  function Builder() {
    const pos = [], nor = [], col = [];
    return {
      box: function (cx, cy, cz, w, h, d, hex) {
        const C = hexRGB(hex), hw = w / 2, hh = h / 2, hd = d / 2;
        for (const F of FACES) {
          const n = F[0], q = F[1];
          const v = q.map(function (k) { return [cx + k[0] * hw, cy + k[1] * hh, cz + k[2] * hd]; });
          for (const t of [0, 1, 2, 0, 2, 3]) { pos.push(v[t][0], v[t][1], v[t][2]); nor.push(n[0], n[1], n[2]); col.push(C[0], C[1], C[2]); }
        }
      },
      mesh: function (name) {
        if (!pos.length) return null;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, mat());
        m.name = name || "island-police";
        m.castShadow = false; m.receiveShadow = true;
        return m;
      },
    };
  }

  const STEEL = 0x2b3036, STEEL_LT = 0x4a5058, BLOCK = 0x9a9c98, BENCH = 0x777a7c, PAN = 0x8d9399;
  const LAMINATE = 0x5b4a3a, COUNTER_TOP = 0x8f8a80, SCREEN = 0x101418, CHAIR = 0x22262c;

  // the barred panel x[a, b] at depth z, its rails and bars, into builder B
  function bars(B, a, b, z, fy) {
    B.box((a + b) / 2, fy + 0.04, z, b - a, 0.08, 0.07, STEEL);               // sill rail
    B.box((a + b) / 2, fy + BAR_H - 0.04, z, b - a, 0.08, 0.07, STEEL);       // head rail
    B.box((a + b) / 2, fy + 1.05, z, b - a, 0.06, 0.05, STEEL);               // the mid flat (a food slot height)
    const n = Math.max(2, Math.round((b - a) / 0.125));
    for (let k = 1; k < n; k++) {
      const x = a + (b - a) * k / n;
      B.box(x, fy + BAR_H / 2, z, 0.032, BAR_H - 0.1, 0.032, STEEL_LT);
    }
  }

  /* ---- THE FIT-OUT ------------------------------------------------------- */
  function buildFit(S) {
    const b = S.b, F = S.F, PL = S.plan;
    const fy = (b.floorTop != null ? b.floorTop : b.gy + 0.08) - b.gy;
    const ceil = Math.min(3.25, (b.h / Math.max(1, b.storeys || 1)) - 0.2);
    const grp = new THREE.Group();
    grp.name = "island-police-fit";
    b.group.add(grp);
    S.group = grp;
    const B = Builder();
    const cols = [];
    // a collider from a local box (world AABB: the building turns by quarters)
    function solid(x0, x1, z0, z1, y0, y1, o) {
      const p = [F.w(x0, 0, z0), F.w(x1, 0, z1)];
      const c = { minX: Math.min(p[0].x, p[1].x), maxX: Math.max(p[0].x, p[1].x), minZ: Math.min(p[0].z, p[1].z), maxZ: Math.max(p[0].z, p[1].z),
        ref: null, y0: b.gy + y0, y1: b.gy + y1 };
      if (o && o.noStep) c.noStep = true;
      cols.push(c);
      return c;
    }
    // ---- clear the floor first: a station, not a living room
    const IV = CBZ.islandVenue;
    S.cleared = IV && IV.clear ? !!IV.clear(b, 0) : false;

    // ---- THE LOCK-UP
    S.cells = [];
    if (PL.cells.length) {
      const zF = PL.cells[0].z0;                             // the barred front's line
      const xs = PL.cells.map(function (c) { return c.x0; }).concat(PL.cells.map(function (c) { return c.x1; }));
      const xa = Math.min.apply(null, xs), xb = Math.max.apply(null, xs);
      const wallH = ceil - fy - 0.01;                       // up to the ceiling board, never through it
      // the block walls between and beside the cells, floor to ceiling (the
      // one against the building's own side wall is that wall)
      const walls = [];
      for (const c of PL.cells) { walls.push(c.x0); walls.push(c.x1); }
      const uniq = walls.filter(function (x, i) { return walls.indexOf(x) === i; });
      for (const x of uniq) {
        if (Math.abs(x - PL.X1) < 0.01 || Math.abs(x - PL.X0) < 0.01) continue;
        B.box(x, fy + wallH / 2, (zF + PL.Z1) / 2, WALL_T, wallH, PL.Z1 - zF, BLOCK);
        solid(x - WALL_T / 2, x + WALL_T / 2, zF, PL.Z1, fy, fy + wallH);
      }
      // the header over the bars, to the ceiling
      if (wallH > BAR_H + 0.05) B.box((xa + xb) / 2, fy + (BAR_H + wallH) / 2, zF, xb - xa, wallH - BAR_H, WALL_T, BLOCK);
      for (const c of PL.cells) {
        // which end the door hangs at: the end nearer the intake (the hall)
        const doorLeft = Math.abs(c.x0 - PL.intake.x) < Math.abs(c.x1 - PL.intake.x);
        const hx = doorLeft ? c.x0 + WALL_T / 2 + 0.04 : c.x1 - WALL_T / 2 - 0.04;   // the hinge
        const dx0 = doorLeft ? hx : hx - LEAF_W, dx1 = doorLeft ? hx + LEAF_W : hx;
        // the fixed barred panel beside the door
        const fa = doorLeft ? dx1 + 0.03 : c.x0 + WALL_T / 2, fb = doorLeft ? c.x1 - WALL_T / 2 : dx0 - 0.03;
        if (fb - fa > 0.1) {
          bars(B, fa, fb, zF, fy);
          solid(fa, fb, zF - 0.05, zF + 0.05, fy, fy + BAR_H);
        }
        // the door's jamb posts
        B.box(dx0 - 0.02, fy + BAR_H / 2, zF, 0.05, BAR_H, 0.08, STEEL);
        B.box(dx1 + 0.02, fy + BAR_H / 2, zF, 0.05, BAR_H, 0.08, STEEL);
        // the bench along the back wall and the steel toilet-basin in the far corner
        const bw = CW - WALL_T - 0.9;
        const bx = doorLeft ? c.x1 - WALL_T / 2 - bw / 2 - 0.02 : c.x0 + WALL_T / 2 + bw / 2 + 0.02;
        B.box(bx, fy + 0.43, c.z1 - 0.27, bw, 0.07, 0.5, BENCH);
        B.box(bx, fy + 0.2, c.z1 - 0.06, bw, 0.4, 0.08, BENCH);
        B.box(bx - bw / 2 + 0.06, fy + 0.2, c.z1 - 0.27, 0.06, 0.4, 0.42, BENCH);
        B.box(bx + bw / 2 - 0.06, fy + 0.2, c.z1 - 0.27, 0.06, 0.4, 0.42, BENCH);
        solid(bx - bw / 2, bx + bw / 2, c.z1 - 0.52, c.z1, fy, fy + 0.46, { noStep: true });
        const tx = doorLeft ? c.x0 + WALL_T / 2 + 0.3 : c.x1 - WALL_T / 2 - 0.3;
        B.box(tx, fy + 0.45, c.z1 - 0.28, 0.5, 0.9, 0.45, PAN);
        B.box(tx, fy + 0.93, c.z1 - 0.38, 0.36, 0.06, 0.26, 0x5f666e);
        solid(tx - 0.25, tx + 0.25, c.z1 - 0.5, c.z1, fy, fy + 0.95, { noStep: true });
        // THE DOOR: a barred leaf on its hinge
        const LB = Builder();
        bars(LB, 0.02, LEAF_W - 0.02, 0, 0);
        LB.box(0.02, BAR_H / 2, 0, 0.05, BAR_H - 0.04, 0.06, STEEL);
        LB.box(LEAF_W - 0.02, BAR_H / 2, 0, 0.05, BAR_H - 0.04, 0.06, STEEL);
        LB.box(LEAF_W - 0.12, 1.02, -0.06, 0.1, 0.16, 0.06, 0x7a8088);            // the lock box
        const leaf = LB.mesh("island-police:cell-door");
        const pivot = new THREE.Group();
        pivot.position.set(hx, fy, zF);
        if (!doorLeft) leaf.scale.x = -1;                                          // hung from the other jamb
        pivot.add(leaf);
        grp.add(pivot);
        const sgn = doorLeft ? 1 : -1;
        pivot.rotation.y = sgn * Math.PI / 2;                                      // an empty cell stands open
        const cell = {
          i: S.cells.length, x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1, pivot: pivot, sgn: sgn,
          open: true, t: 1, locked: false, holds: null,
          collider: solid(Math.min(dx0, dx1), Math.max(dx0, dx1), zF - 0.05, zF + 0.05, fy, fy + BAR_H),
          inside: F.w((c.x0 + c.x1) / 2 + (doorLeft ? 0.2 : -0.2), fy, (c.z0 + c.z1) / 2 + 0.1),
          front: F.w(doorLeft ? hx + LEAF_W / 2 : hx - LEAF_W / 2, fy, zF - 0.9),
          doorW: F.w(doorLeft ? hx + LEAF_W / 2 : hx - LEAF_W / 2, fy, zF),
        };
        S.cells.push(cell);
      }
    }
    // ---- THE FRONT COUNTER
    if (PL.desk) {
      const D = PL.desk, x0 = D.box.x0, x1 = D.box.x1, zc = D.top + 0.3;
      B.box((x0 + x1) / 2, fy + 0.52, zc, x1 - x0, 1.04, 0.6, LAMINATE);           // the counter body
      B.box((x0 + x1) / 2, fy + 1.07, zc - 0.04, x1 - x0 + 0.06, 0.05, 0.72, COUNTER_TOP);
      B.box((x0 + x1) / 2, fy + 0.78, zc + 0.36, x1 - x0 - 0.1, 0.04, 0.42, COUNTER_TOP);   // the work shelf behind it
      const mx = D.cx + D.side * 0.35;
      B.box(mx, fy + 1.33, zc + 0.12, 0.52, 0.32, 0.04, SCREEN);                    // the monitor, facing the desk side
      B.box(mx, fy + 1.13, zc + 0.14, 0.06, 0.1, 0.06, SCREEN);
      // the chair behind it
      const cz = D.back + 0.5;
      B.box(D.cx - D.side * 0.2, fy + 0.5, cz, 0.5, 0.06, 0.5, CHAIR);
      B.box(D.cx - D.side * 0.2, fy + 0.8, cz + 0.24, 0.48, 0.55, 0.05, CHAIR);
      B.box(D.cx - D.side * 0.2, fy + 0.25, cz, 0.06, 0.5, 0.06, CHAIR);
      solid(x0, x1, zc - 0.36, zc + 0.3, fy, fy + 1.1);
      S.deskPost = F.w(D.cx + D.side * 0.25, fy, D.back + 0.45);
      const f = F.dir(0, -1);
      S.deskFace = { x: f.x, z: f.z };
      S.counter = F.w(D.cx, fy, D.top - 0.55);                     // where a visitor stands at it
    }
    const mesh = B.mesh("island-police:fit");
    if (mesh) grp.add(mesh);
    // (filed in the physics grid in place: a dirty mark here rebuilt every
    // wall on the sea in one frame, as the island arrived)
    if (CBZ.colliderAddMany) CBZ.colliderAddMany(cols); else for (const c of cols) CBZ.colliders.push(c);
    S.cols = cols;
    // a shut door is its collider; an open one is not
    for (const c of S.cells) setCol(c, false);
    if (!CBZ.colliderAddMany && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function setCol(cell, on) {
    const L = CBZ.colliders, i = L.indexOf(cell.collider);
    if (on && i < 0) { if (CBZ.colliderAdd) CBZ.colliderAdd(cell.collider); else { L.push(cell.collider); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); } }
    else if (!on && i >= 0) { if (CBZ.colliderRemove) CBZ.colliderRemove(cell.collider, i); else { L.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); } }
  }

  /* ---- THE STREET IN FRONT ----------------------------------------------- */
  function streetOf(S) {
    const T = CBZ.islandTown ? CBZ.islandTown.of(S.A) : null;
    const D = S.door;
    if (!T || !T.roads.length) return null;
    let best = null, bd = 1e9;
    for (const r of T.roads) {
      const half = r.len / 2;
      // a street the door FACES: across its axis along the door's normal
      if (r.vertical ? Math.abs(D.nx) < 0.7 : Math.abs(D.nz) < 0.7) continue;
      const along = r.vertical ? D.z - r.z : D.x - r.x;
      if (Math.abs(along) > half + 2) continue;
      const off = r.vertical ? r.x - D.x : r.z - D.z;          // signed, toward the street
      const outward = r.vertical ? off * D.nx : off * D.nz;
      if (outward <= 0) continue;
      if (outward < bd) { bd = outward; best = r; }
    }
    if (!best) return null;
    return { road: best, dist: bd, ux: best.vertical ? 0 : 1, uz: best.vertical ? 1 : 0 };
  }

  function bays(S) {
    const D = S.door, st = S.street;
    const out = [];
    if (!st) return out;
    const ux = st.ux, uz = st.uz;                                 // along the street
    const depth = st.dist - 5.5 - 1.6;                            // forecourt: door step to the back of the footway
    if (depth >= 5.4) {
      // nose-in, side by side, either side of the walk to the door
      const m = 1.6 + depth / 2;
      for (const s of [3.3, -3.3, 6.2]) out.push({ x: D.x + D.nx * m + ux * s, z: D.z + D.nz * m + uz * s, h: Math.atan2(-D.nx, -D.nz) });
    } else {
      // along the kerb, on the footway in front (a unit parks where it can)
      const k = st.dist - 4.4;
      const h = Math.atan2(ux, uz);
      for (const s of [6.2, -6.2, 12.4]) out.push({ x: D.x + D.nx * k + ux * s, z: D.z + D.nz * k + uz * s, h: h });
    }
    return out.slice(0, BAY_N);
  }
  function bayClear(p) {
    if (!CBZ.queryCollidersNear) return true;
    const L = CBZ.queryCollidersNear(p.x, p.z, 3.2, []) || [];
    for (const c of L) {
      if (!c || c.y1 != null && c.y1 < (p.y || 0) + 0.3) continue;
      const nx = Math.max(c.minX, Math.min(p.x, c.maxX)), nz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      if (Math.hypot(nx - p.x, nz - p.z) < 1.25) return false;
    }
    return true;
  }

  /* ---- THE STATION, PER ISLAND -------------------------------------------- */
  function make(A, bIn) {
    const b = bIn || findStationBuilding(A);
    if (!b || !b.group) return null;
    const F = frameOf(b);
    const I = b.interior;
    const z0 = I ? I.z0 : -(b.ld || b.d) / 2;
    const dw = F.w(0, 0, z0 - 0.3 - 0.05);
    const n = F.dir(0, -1);
    const S = {
      A: A, b: b, F: F, door: { x: dw.x, z: dw.z, nx: n.x, nz: n.z },
      plan: planFit(b), cells: [], cols: [], cruisers: [], bays: [], group: null,
      sergeant: null, built: false, refillT: 0, sergeantT: 0,
    };
    S.street = streetOf(S);
    S.bays = bays(S).map(function (p) { return { x: p.x, z: p.z, h: p.h, car: null }; });
    if (S.plan) { try { buildFit(S); } catch (e) { console.error("[island police fit-out]", e); } }
    S.intakeW = S.plan ? F.w(S.plan.intake.x, 0, S.plan.intake.z) : { x: dw.x - n.x * 3, z: dw.z - n.z * 3 };
    // the record city/police.js reads (cityPoliceStation's shape)
    const yaw = F.yaw;
    S.rec = {
      x: S.door.x, z: S.door.z, island: true,
      inside: { x: S.intakeW.x, z: S.intakeW.z, y: b.floorTop != null ? b.floorTop : b.gy + 0.08 },
      // the front step: an officer who starts in the hall walks out to here
      // along the door's axis before his beat (city/police.js _exitPt)
      out: { x: S.door.x + n.x * 2.5, z: S.door.z + n.z * 2.5 },
      lot: { cx: b.x, cz: b.z, w: b.w, d: b.d, kind: "police", name: b.name || "Police",
        // (a published lot's door carries the INWARD normal, the city's way;
        // S.door's own n points out at the street)
        building: { door: { x: S.door.x, z: S.door.z, nx: -n.x, nz: -n.z }, h: b.roofY != null ? b.roofY : b.gy + b.h, rotY: yaw,
          flatRoof: !!(b.roofAccess && b.roof && b.roof.access) } },
    };
    S.built = true;
    return S;
  }

  function cur() {
    if (!onIsles()) return null;
    const A = CBZ.surv && CBZ.surv.arena;
    if (!A || !A.island || !A.root) return null;
    let S = STATIONS.get(A);
    if (S === undefined) {
      S = null;
      try { S = make(A); } catch (e) { console.error("[island police]", e); S = null; }
      STATIONS.set(A, S);
    }
    return S;
  }

  // the island's police lot is fitted out with the island (and taken down
  // with it): city/police.js finds it standing the first time it asks
  if (CBZ.islandVenue && CBZ.islandVenue.on) CBZ.islandVenue.on("police", function (b, lot, job) {
    const A = job && job.arena;
    if (!A || !A.root || STATIONS.get(A)) return null;
    let S = null;
    try { S = make(A, b); } catch (e) { console.error("[island police]", e); S = null; }
    if (!S) return null;
    STATIONS.set(A, S);
    return function () { dropStation(S); if (STATIONS.get(A) === S) STATIONS.delete(A); };
  });

  /* ---- THE YARD ---------------------------------------------------------- */
  function seen(x, y, z) { return !!(CBZ.sightCanSee && CBZ.sightCanSee(x, y + 1, z, 3)); }
  function parkCruiser(S, bay) {
    if (!CBZ.cityMakeCar) return null;
    const model = CBZ.cityCruiserModel ? CBZ.cityCruiserModel() : null;
    let c = null;
    try { c = CBZ.cityMakeCar(bay.x, bay.z, bay.h, false, model, 0.28); } catch (e) { c = null; }
    if (!c) return null;
    c.ai = false; c.v = 0; c.baseV = 0; c.road = null;
    c._cruiser = true; c._stationBay = bay; c._isleTraffic = null;
    if (CBZ.cityMarkCruiser) { try { CBZ.cityMarkCruiser(c); } catch (e) {} }
    // parked: the bar is dark
    const dark = function (cc) { const r = cc._rbBar; if (r) { if (r.red) r.red.visible = false; if (r.blue) r.blue.visible = false; if (r.mid) r.mid.visible = false; } };
    if (CBZ.cityWhenCarBuilt) CBZ.cityWhenCarBuilt(c, dark); else dark(c);
    bay.car = c;
    return c;
  }
  function yardTick(S, dt) {
    S.refillT -= dt;
    if (S.refillT > 0) return;
    S.refillT = 2.5;
    for (const bay of S.bays) {
      const c = bay.car;
      if (c && (c.dead || c._scrapped || CBZ.cityCars.indexOf(c) < 0 || c.ai || c.player || c._stationBay !== bay ||
          Math.hypot(c.pos.x - bay.x, c.pos.z - bay.z) > 3)) { if (c && c._stationBay === bay) c._stationBay = null; bay.car = null; }
      if (bay.car) continue;
      const y = S.A.groundHeightAt ? S.A.groundHeightAt(bay.x, bay.z) : 0;
      if (seen(bay.x, y, bay.z) || !bayClear({ x: bay.x, y: y, z: bay.z })) continue;
      let busy = false;
      for (const o of CBZ.cityCars) if (o && !o.dead && Math.hypot(o.pos.x - bay.x, o.pos.z - bay.z) < 4.2) { busy = true; break; }
      if (busy) continue;
      parkCruiser(S, bay);
      break;                                     // one a beat
    }
  }

  /* ---- THE DESK SERGEANT -------------------------------------------------- */
  function sergeantTick(S, dt) {
    if (!S.deskPost || !CBZ.citySpawnCop) return;
    const c = S.sergeant;
    if (c && !c.dead && !c.culled && CBZ.cityCops.indexOf(c) >= 0) return;
    if (c) { S.sergeant = null; S.sergeantT = c.dead ? 90 : 4; }     // the chair stays empty a while after a death
    S.sergeantT -= dt;
    if (S.sergeantT > 0 || g.state !== "playing") return;
    S.sergeantT = 3;
    const p = S.deskPost, y = S.b.floorTop != null ? S.b.floorTop : S.b.gy;
    if (seen(p.x, y, p.z) && CBZ.camera && Math.hypot(CBZ.camera.position.x - p.x, CBZ.camera.position.z - p.z) < 60) return;
    let s = null;
    try { s = CBZ.citySpawnCop(p.x, p.z, false); } catch (e) { s = null; }
    if (!s) return;
    s.pos.x = p.x; s.pos.z = p.z; s.pos.y = y;
    if (s.group) { s.group.position.x = p.x; s.group.position.z = p.z; s.group.rotation.y = Math.atan2(S.deskFace.x, S.deskFace.z); }
    if (s.target && s.target.set) s.target.set(p.x, 0, p.z);
    s.ambient = false; s._deskSergeant = true; s.name = "Desk Sergeant";
    s._post = CBZ.cityPostStand
      ? CBZ.cityPostStand(s, { x: p.x, z: p.z, fx: S.deskFace.x, fz: S.deskFace.z, relaxed: true, kind: "watch", tag: "police:desk", job: "desk sergeant" })
      : { x: p.x, z: p.z, fx: S.deskFace.x, fz: S.deskFace.z, mount: null, mountT: 0, relaxed: true };
    S.sergeant = s;
  }

  /* ---- THE CELL DOORS ----------------------------------------------------- */
  function setDoor(cell, open) {
    if (!cell || cell.open === !!open) return;
    cell.open = !!open;
    setCol(cell, !cell.open);
    if (CBZ.sfx) { try { CBZ.sfx(cell.open ? "door_open" : "door_close"); } catch (e) {} }
  }
  function doorTick(S, dt) {
    for (const c of S.cells) {
      const want = c.open ? 1 : 0;
      if (c.t !== want) {
        c.t += Math.sign(want - c.t) * Math.min(Math.abs(want - c.t), dt * 1.8);
        // it swings OUT into the hall, a quarter turn
        c.pivot.rotation.y = c.sgn * (Math.PI / 2) * c.t;
      }
    }
  }
  function cellOf(x, z) {
    const S = active;
    if (!S) return null;
    for (const c of S.cells) {
      const p = c.inside;
      const lx = Math.abs(x - p.x), lz = Math.abs(z - p.z);
      if (lx < CW / 2 && lz < CD / 2 + 0.1) return c;
    }
    return null;
  }

  // the door verbs, on the one interaction registry (E: open / shut). A door
  // you are locked behind does not open from the inside.
  let wired = false;
  function wire() {
    const I = CBZ.interactions;
    if (wired || !I || !I.registerZone) return;
    wired = true;
    I.registerZone({
      id: "isle-cell-door", kind: "celldoor", radius: 2.2, prio: 2, islands: true,
      find: function (px, pz) {
        const S = active;
        if (!S || !onIsles()) return null;
        let best = null, bd = 2.2;
        for (const c of S.cells) {
          const d = Math.hypot(px - c.doorW.x, pz - c.doorW.z);
          if (d < bd) { bd = d; best = c; }
        }
        return best ? { x: best.doorW.x, z: best.doorW.z, cell: best } : null;
      },
      options: [{
        id: "isle-cell-door-use", slot: "e",
        label: function (t) { return t && t.cell && t.cell.open ? "Shut" : "Open"; },
        canShow: function (t) { return !!(t && t.cell && !t.cell.locked); },
        onSelect: function (t) { if (t && t.cell && !t.cell.locked) setDoor(t.cell, !t.cell.open); },
      }],
    });
    if (I.describe) I.describe("celldoor", function () { return { label: "Cell" }; });
  }

  /* ---- THE TICK ---------------------------------------------------------- */
  CBZ.onUpdate(34.9, function (dt) {
    if (!onIsles()) { active = null; return; }
    const S = cur();
    active = S;
    if (!S) return;
    wire();
    const d = Math.min(0.1, Math.max(0, dt || 0));
    doorTick(S, d);
    if (g.state !== "playing") return;
    yardTick(S, d);
    sergeantTick(S, d);
  });

  function dropStation(S) {
    if (!S) return;
    if (S.cols && S.cols.length) {
      // (colliderRemoveMany takes out what is there and keeps the grid; the
      // old indexOf per collider was a walk of every wall on the sea each)
      if (CBZ.colliderRemoveMany) CBZ.colliderRemoveMany(S.cols);
      else {
        for (const c of S.cols) { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); }
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      }
    }
    S.cols = [];
    for (const bay of S.bays) bay.car = null;
    S.sergeant = null;
    if (active === S) active = null;
  }

  CBZ.islandPolice = {
    station: function () { const S = cur(); return S ? S.rec : null; },
    /* the arrest arc's gate (city/wanted.js): the unit pulls up at the kerb in
       front of the door, coming along the street (nx, nz point back up it,
       where the sealed cut stages the car); the walk-in goes through the door
       to the counter (petty) or into a cell (heavy) */
    gate: function (heavy) {
      const S = cur();
      if (!S) return null;
      const D = S.door, st = S.street;
      const kd = st ? Math.max(3, st.dist - 1.75) : 6;             // the near lane, in front of the door
      const gx = D.x + D.nx * kd, gz = D.z + D.nz * kd;
      // the run-up: along the street, the way with more street to it
      let ux = st ? st.ux : -D.nz, uz = st ? st.uz : D.nx;
      if (st) {
        const r = st.road, along = r.vertical ? gz - r.z : gx - r.x;
        if (r.len / 2 - along < r.len / 2 + along) { ux = -ux; uz = -uz; }
      }
      const F = S.F, PL = S.plan;
      const z0 = PL ? PL.Z0 : 0;
      const step = { x: D.x + D.nx * 1.2, z: D.z + D.nz * 1.2 };
      const inDoor = PL ? F.w(0, 0, z0 + 0.8) : { x: D.x - D.nx * 0.8, z: D.z - D.nz * 0.8 };
      const cell = heavy ? (S.cells.find(function (c) { return !c.locked && !c.holds; }) || null) : null;
      const path = [step, { x: inDoor.x, z: inDoor.z }];
      let desk;
      if (cell) {
        path.push({ x: S.intakeW.x, z: S.intakeW.z }, { x: cell.front.x, z: cell.front.z });
        desk = cell.inside;
      } else desk = S.counter || S.intakeW;
      path.push({ x: desk.x, z: desk.z });
      return {
        x: gx, z: gz, nx: ux, nz: uz,
        gate: { x: step.x, z: step.z },
        desk: { x: desk.x, z: desk.z },
        path: path,
        cell: cell ? cell.i : -1,
        out: { x: D.x + D.nx * 1.4, z: D.z + D.nz * 1.4, nx: D.nx, nz: D.nz },
        island: true,
      };
    },
    takeCruiser: function () {
      const S = cur();
      if (!S) return null;
      const parked = S.bays.filter(function (b) { return b.car && !b.car.dead && !b.car.ai && !b.car.player; });
      if (parked.length < 2) return null;                         // the station keeps one unit in
      const bay = parked[0], c = bay.car;
      bay.car = null; c._stationBay = null;
      if (CBZ.cityWakeCar) CBZ.cityWakeCar(c);
      S.refillT = 30;                                             // the bay stays empty a while
      return c;
    },
    // shut a cell on whoever stands in it; -1 = the first free one
    lockUp: function (i, who) {
      const S = active || cur();
      if (!S || !S.cells.length) return null;
      const c = i != null && i >= 0 ? S.cells[i] : S.cells.find(function (q) { return !q.locked; });
      if (!c) return null;
      setDoor(c, false);
      c.locked = true; c.holds = who || null;
      return c;
    },
    unlock: function (i) {
      const S = active || cur();
      const c = S && S.cells[i];
      if (!c) return false;
      c.locked = false; c.holds = null;
      setDoor(c, true);
      return true;
    },
    cellAt: cellOf,
    cells: function () { const S = active || cur(); return S ? S.cells : []; },
    drop: function (A) {
      if (!A) { STATIONS.forEach(dropStation); STATIONS.clear(); active = null; return; }
      dropStation(STATIONS.get(A));
      STATIONS.delete(A);
    },
    state: function () {
      const S = active || cur();
      if (!S) return null;
      return {
        building: S.b.name || S.b.kind || null, door: { x: +S.door.x.toFixed(1), z: +S.door.z.toFixed(1) },
        street: !!S.street, cells: S.cells.map(function (c) { return { open: c.open, locked: c.locked }; }),
        desk: !!S.deskPost, sergeant: !!(S.sergeant && !S.sergeant.dead), cleared: S.cleared || 0,
        bays: S.bays.map(function (b) { return !!b.car; }),
      };
    },
  };
})();
