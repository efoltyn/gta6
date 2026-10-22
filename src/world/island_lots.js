/* ============================================================
   world/island_lots.js — THE MOTEL AND THE USED CAR LOT, BUILT.

   Two places an archipelago island has that are not a building on a shop
   lot (world/island_plan.js lays them as places: kind "motel", "carlot";
   world/disaster_arena.js hands the lot here and keeps the record as a
   venue site, island.sites).

   THE MOTEL. Long and low on the ring road, the way a motel is: its own car
   park across the front, a bay nose-in to every room; behind it a row of six
   rooms on two storeys, every room's door and window off an open gallery,
   the upper gallery a deck on posts with a rail, a straight steel-and-
   concrete stair up at the far end, a flat roof over the lot; the office at
   the near end, single storey, glass to the car park, OFFICE lit over its
   door. Every room is a room: a double bed (the isles' bed registry: you can
   lie in it), a nightstand and its lamp, the TV on its cabinet, a table and
   chair by the window, a bathroom behind its own partition. Every door is
   shut and locked; the one the office lets is a real door on its hinge
   (world/island_lodging.js opens it for the guest who paid).
     b.motel = { rooms: [{ n, k, i, local {x0,x1,z0,z1}, y, box {minX..maxZ,
       y0, y1}, bed {x, z}, door (the let room: { pivot, col, y0, y1, open,
       t, at, inside }) | null, at {x, y, z} (outside it) }], rent (index),
       office { local {x0..z1}, door {x, y, z} } }
     b.interior is the office (the front desk goes in it).

   THE USED CAR LOT. A concrete forecourt with a kerb round it and a way in
   off the street, two rows of cars facing the road (their windscreen cards
   are world/island_dealers.js's), flag poles along the front with bunting
   strung between them and back to the posts at the rear, and the little
   sales cabin in the back corner: a door, a window, a desk inside.
     b.carlot = { spots [the car spots], cabin { local, door {x, y, z} } }
     b.interior is the cabin.

   API: CBZ.islandLots.build(l, ctx) -> site record (or null)
     ctx: { root, makeCar(x, z, yaw, color) -> spot, furnish(name, host, x,
            y, z, yaw, o) (the arena's: building-local, beds kept),
            addGlass(group, lx, ly, lz, w, h, d, ox, oz, gy) }
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  if (!window.THREE) return;
  const THREE = window.THREE;

  function h01(x, z, s) {
    if (CBZ.hash01) return CBZ.hash01(x, z, s);
    const v = Math.sin(x * 12.9898 + z * 78.233 + s * 0.123) * 43758.5453;
    return v - Math.floor(v);
  }
  function pick(a, x, z, s) { return a[(h01(x, z, s) * a.length) | 0]; }

  function siteOf(l, ctx, kind, h, storeys, color, roofHex) {
    const gy = l.gy != null ? l.gy : (l.gyHint || 0);
    const grp = new THREE.Group();
    grp.position.set(l.x, gy, l.z);
    grp.rotation.y = l.yaw || 0;
    grp.name = "island-" + kind;
    ctx.root.add(grp);
    const quarter = Math.abs(Math.round(Math.sin(l.yaw || 0))) === 1;
    return {
      group: grp, ox: l.x, oz: l.z, gy: gy, x: l.x, z: l.z,
      w: quarter ? l.d : l.w, d: quarter ? l.w : l.d, lw: l.w, ld: l.d, rotY: l.yaw || 0,
      h: h, storeys: storeys, kind: kind, colliders: [], fallen: false, color: color, roofHex: roofHex,
      roofY: gy + h,
    };
  }
  // what of a site stands up, for the island's far form (world/archipelago.js)
  function farBox(K, b, x0, x1, z0, z1, top) {
    const a = K.lw(x0, z0), c = K.lw(x1, z1);
    return { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z), y1: b.gy + top };
  }
  // a pane of the island's glass (the arena's addGlass) at a building-local
  // spot: placed in world axes on the root, so a quarter turn swaps its size
  function pane(ctx, b, K, lx, ly, lz, w, h, d) {
    if (!ctx.addGlass) { K.lbox(lx, ly, lz, w, h, d, 0x9fb4bf, { glass: true }); return; }
    const c = K.lw(lx, lz);
    const q = Math.abs(Math.round(Math.sin(b.rotY || 0))) === 1;
    ctx.addGlass(ctx.root, c.x, b.gy + ly, c.z, q ? d : w, h, q ? w : d, 0, 0, 0, null);
  }
  // a wall along local x at z (thickness t), from x0 to x1 and y0 to y1,
  // with rectangular holes [{x0, x1, y0, y1}] cut through it
  function wallX(K, x0, x1, z, t, y0, y1, holes, col, o) {
    const xs = [x0, x1];
    for (const hl of holes) { xs.push(Math.max(x0, hl.x0), Math.min(x1, hl.x1)); }
    xs.sort(function (a, b) { return a - b; });
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = xs[i], c = xs[i + 1];
      if (c - a < 0.005) continue;
      const mid = (a + c) / 2;
      // the spans of y that are solid over this column
      let ys = [[y0, y1]];
      for (const hl of holes) {
        if (mid <= hl.x0 || mid >= hl.x1) continue;
        const next = [];
        for (const s of ys) {
          if (hl.y1 <= s[0] || hl.y0 >= s[1]) { next.push(s); continue; }
          if (hl.y0 > s[0]) next.push([s[0], hl.y0]);
          if (hl.y1 < s[1]) next.push([hl.y1, s[1]]);
        }
        ys = next;
      }
      for (const s of ys) if (s[1] - s[0] > 0.005) K.lbox(mid, (s[0] + s[1]) / 2, z, c - a, s[1] - s[0], t, col, o);
    }
  }

  /* ======================================================================
     THE MOTEL
     ====================================================================== */
  const WALLS = [0xeadfc6, 0xe9d2ad, 0xd8e1dc, 0xf1e6d2, 0xe6cfc1];
  const TRIMS = [0x2f6f73, 0x8a2f2f, 0x2c4a6e, 0x5d7f35, 0x9a6a2a];
  function motel(l, ctx) {
    const m = l.motel;
    if (!m || !CBZ.islandFit) return null;
    const W = l.w, D = l.d;
    const T = 0.2, FY0 = 0.15, FH = 3.0, f1 = FY0 + FH, roofY = FY0 + 2 * FH, OH = 3.5;
    const zf = -D / 2, zb0 = zf + m.parkD, zr0 = zb0 + m.galleryD, zb1 = D / 2;
    const xo0 = -W / 2, xr0 = xo0 + m.officeW, xr1 = xr0 + m.rooms * m.roomW, xe = W / 2;
    const WALL = pick(WALLS, l.x, l.z, 0x3e1), TRIM = pick(TRIMS, l.x, l.z, 0x3e2);
    const SLAB = 0xa19d95, ROOF = 0x5f5b55, RAIL = 0xf0efea, CARPET = pick([0x5b4a43, 0x3f4b57, 0x6a5440], l.x, l.z, 0x3e3), TILE = 0xd7d3ca;
    const b = siteOf(l, ctx, "motel", roofY + 0.3, 2, WALL, ROOF);
    const K = CBZ.islandFit.kit(b, { parent: ctx.root, rooms: false, raw: true, los: true, cast: true, name: "motel" });
    const S = { solid: true };
    const WS = { solid: true, noBreach: false };

    // ---- the slab the whole block stands on (the gallery's ground walk too)
    K.lbox((xo0 + xe) / 2, (FY0 - 0.5) / 2, (zb0 + zb1) / 2, xe - xo0, FY0 + 0.5, zb1 - zb0, SLAB, { plat: true });
    // the kerb of the walk along the car park
    K.lbox((xo0 + xe) / 2, FY0 - 0.06, zb0 + 0.06, xe - xo0, 0.14, 0.14, 0xc9c5bb);

    // ---- THE OFFICE (single storey, glass to the car park) --------------
    K.lbox(xo0 + T / 2, OH / 2, (zb0 + zb1) / 2, T, OH, zb1 - zb0, WALL, WS);
    K.lbox((xo0 + xr0) / 2, OH / 2, zb1 - T / 2, xr0 - xo0, OH, T, WALL, WS);
    // its east wall: under the gallery, and the rooms' end wall behind
    K.lbox(xr0, OH / 2, (zb0 + zr0) / 2, T, OH, zr0 - zb0, WALL, WS);
    const dx0 = xr0 - 1.65, dx1 = xr0 - 0.65, gx0 = xo0 + 0.3, gx1 = xr0 - 1.85;
    wallX(K, xo0, xr0 - T / 2, zb0 + T / 2, T, 0, OH,
      [{ x0: gx0, x1: gx1, y0: FY0 + 0.45, y1: FY0 + 2.45 }, { x0: dx0, x1: dx1, y0: 0, y1: FY0 + 2.15 }], WALL, WS);
    pane(ctx, b, K, (gx0 + gx1) / 2, FY0 + 1.45, zb0 + T / 2, gx1 - gx0, 2.0, 0.04);
    // the office door, glass in a dark frame, standing open into the office
    K.lbox(dx0 + 0.03, FY0 + 1.05, zb0 + T + 0.48, 0.05, 2.1, 0.92, 0x2a2e33);
    // its roof, overhanging the walk, a fascia in the trim colour
    K.lbox((xo0 + xr0) / 2, OH + 0.12, (zb0 + zb1) / 2 - 0.3, xr0 - xo0 + 0.3, 0.24, zb1 - zb0 + 0.6, ROOF, S);
    K.lbox((xo0 + xr0) / 2, OH + 0.12, zb0 - 0.62, xr0 - xo0 + 0.32, 0.36, 0.06, TRIM);
    // inside: a tiled floor, a ceiling light
    K.lbox((xo0 + xr0) / 2, FY0 + 0.006, (zb0 + zb1) / 2, xr0 - xo0 - 2 * T, 0.012, zb1 - zb0 - 2 * T, TILE);
    K.lbox((xo0 + xr0) / 2, OH - 0.04, (zb0 + zb1) / 2, 0.6, 0.04, 0.6, 0xf6efe0, { glow: true });

    // ---- THE ROOMS BLOCK -------------------------------------------------
    K.lbox((xr0 + xr1) / 2, roofY / 2, zb1 - T / 2, xr1 - xr0, roofY, T, WALL, WS);
    K.lbox(xr0, roofY / 2, (zr0 + zb1) / 2, T, roofY, zb1 - zr0, WALL, WS);
    K.lbox(xr1, roofY / 2, (zr0 + zb1) / 2, T, roofY, zb1 - zr0, WALL, WS);
    for (let i = 1; i < m.rooms; i++) K.lbox(xr0 + i * m.roomW, roofY / 2, (zr0 + zb1 - T) / 2, 0.15, roofY, zb1 - T - zr0, WALL, WS);
    // the first floor over the rooms and the gallery (the stair's landing beside it)
    K.lbox((xr0 + xr1) / 2, f1 - 0.125, (zb0 + zb1) / 2, xr1 - xr0, 0.25, zb1 - zb0, SLAB, { plat: true });
    K.lbox(xr1 + 0.75, f1 - 0.125, zb0 + 1.4, 1.5, 0.25, 2.8, SLAB, { plat: true });
    // the roof over the whole row, the stair and the landing
    K.lbox((xr0 + xe) / 2, roofY + 0.12, (zb0 + zb1) / 2 - 0.15, xe - xr0 + 0.3, 0.24, zb1 - zb0 + 0.7, ROOF, S);
    K.lbox((xr0 + xe) / 2, roofY + 0.1, zb0 - 0.52, xe - xr0 + 0.32, 0.4, 0.06, TRIM);

    // the fronts, a room at a time: a door and a window, both storeys
    const rooms = [];
    const rentI = 1 * m.rooms + ((h01(l.x, l.z, 0x3e4) * m.rooms) | 0);
    const DW = 0.95, DH = 2.1;
    for (let k = 0; k < 2; k++) {
      const fk = k ? f1 : FY0, ya = k ? f1 - 0.25 : 0, yb = k ? roofY : f1 - 0.25;
      for (let i = 0; i < m.rooms; i++) {
        const rx0 = xr0 + i * m.roomW, rx1 = rx0 + m.roomW;
        const d0 = rx0 + 0.35, d1 = d0 + DW, w0 = rx0 + 1.85, w1 = rx1 - 0.45;
        wallX(K, rx0 + (i === 0 ? T / 2 : 0.075), rx1 - (i === m.rooms - 1 ? T / 2 : 0.075), zr0 + T / 2, T, ya, yb,
          [{ x0: d0, x1: d1, y0: ya - 1, y1: fk + DH }, { x0: w0, x1: w1, y0: fk + 0.9, y1: fk + 2.15 }], WALL, WS);
        pane(ctx, b, K, (w0 + w1) / 2, fk + 1.525, zr0 + T / 2, w1 - w0, 1.25, 0.04);
        // the window's sill and the door's frame, in the trim colour
        K.lbox((w0 + w1) / 2, fk + 0.87, zr0 - 0.04, w1 - w0 + 0.12, 0.06, 0.1, TRIM);
        K.lbox(d0 - 0.04, fk + DH / 2, zr0 - 0.02, 0.08, DH, 0.06, TRIM);
        K.lbox(d1 + 0.04, fk + DH / 2, zr0 - 0.02, 0.08, DH, 0.06, TRIM);
        K.lbox((d0 + d1) / 2, fk + DH + 0.04, zr0 - 0.02, DW + 0.16, 0.08, 0.06, TRIM);
        const n = (k + 1) * 100 + i + 1, idx = k * m.rooms + i;
        const rz0 = zr0 + T, rz1 = zb1 - T, ix0 = rx0 + 0.075, ix1 = rx1 - 0.075;
        const at = K.lw((d0 + d1) / 2, zr0 - 0.6), inside = K.lw((d0 + d1) / 2, zr0 + T + 0.6);
        const rec = { n: n, k: k, i: i, local: { x0: ix0, x1: ix1, z0: rz0, z1: rz1 }, y: b.gy + fk, door: null,
          at: { x: at.x, y: b.gy + fk + 1.2, z: at.z } };
        const a0 = K.lw(ix0, rz0), a1 = K.lw(ix1, rz1);
        rec.box = { minX: Math.min(a0.x, a1.x), maxX: Math.max(a0.x, a1.x), minZ: Math.min(a0.z, a1.z), maxZ: Math.max(a0.z, a1.z),
          y0: b.gy + fk - 0.2, y1: b.gy + fk + FH - 0.3 };
        if (idx === rentI) {
          // THE LET ROOM'S DOOR: a leaf on its hinge, shut and solid until the
          // office lets you the room (world/island_lodging.js doorSet)
          const mat = new THREE.MeshLambertMaterial({ color: TRIM });
          mat.name = "island-motel-door";
          if (CBZ.islandRoomLight) CBZ.islandRoomLight(mat, false);
          const pivot = new THREE.Group();
          pivot.position.set(d0, fk, zr0 + T / 2);
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(DW - 0.02, DH - 0.02, 0.05), mat);
          leaf.position.set((DW - 0.02) / 2, (DH - 0.02) / 2, 0);
          leaf.castShadow = true; leaf.receiveShadow = true;
          pivot.add(leaf);
          const knob = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.12), new THREE.MeshLambertMaterial({ color: 0xb08d4a }));
          knob.position.set(DW - 0.14, 1.0, 0);
          pivot.add(knob);
          b.group.add(pivot);
          const col = K.lbox((d0 + d1) / 2, fk + DH / 2, zr0 + T / 2, DW, DH, T + 0.04, 0, { solid: true, noVis: true });
          rec.door = { pivot: pivot, col: col, y0: col.y0, y1: col.y1, open: false, t: 0,
            at: rec.at, inside: { x: inside.x, y: b.gy + fk + 1.2, z: inside.z } };
        } else {
          // every other door: shut and locked
          K.lbox((d0 + d1) / 2, fk + DH / 2, zr0 + T / 2, DW - 0.02, DH - 0.02, 0.05, TRIM, { solid: true, y0: b.gy + fk, y1: b.gy + fk + DH });
          K.lbox(d1 - 0.14, fk + 1.0, zr0 + T / 2 - 0.05, 0.08, 0.04, 0.1, 0xb08d4a);
        }
        // the room's number over its door
        K.lbox((d0 + d1) / 2, fk + DH + 0.22, zr0 - 0.015, 0.34, 0.14, 0.02, 0xb08d4a);
        rooms.push(rec);
        roomInside(ctx, K, rec, fk, ix0, ix1, rz0, rz1, d0, d1, CARPET, WALL);
      }
    }

    // ---- THE GALLERY: posts, the upper deck's rail --------------------
    for (let i = 0; i <= m.rooms; i++) K.lbox(xr0 + i * m.roomW, roofY / 2, zb0 + 0.12, 0.18, roofY, 0.18, RAIL, S);
    K.lbox(xr1 + 1.45, roofY / 2, zb0 + 0.12, 0.18, roofY, 0.18, RAIL, S);
    const rl0 = xr0 + 0.1, rl1 = xr1 + 1.5;
    K.lbox((rl0 + rl1) / 2, f1 + 1.0, zb0 + 0.08, rl1 - rl0, 0.06, 0.08, RAIL);
    K.lbox((rl0 + rl1) / 2, f1 + 0.5, zb0 + 0.08, rl1 - rl0, 0.04, 0.05, RAIL);
    for (let x = rl0 + 0.25; x < rl1 - 0.1; x += 0.5) K.lbox(x, f1 + 0.5, zb0 + 0.08, 0.035, 1.0, 0.035, RAIL);
    K.lbox((rl0 + rl1) / 2, f1 + 0.55, zb0 + 0.08, rl1 - rl0, 1.1, 0.1, 0, { solid: true, noVis: true });
    // the landing's open side
    K.lbox(xr1 + 1.52, f1 + 1.0, zb0 + 1.4, 0.06, 0.06, 2.8, RAIL);
    K.lbox(xr1 + 1.52, f1 + 0.55, zb0 + 1.4, 0.1, 1.1, 2.8, 0, { solid: true, noVis: true });
    for (let z = zb0 + 0.4; z < zb0 + 2.8; z += 0.5) K.lbox(xr1 + 1.52, f1 + 0.5, z, 0.035, 1.0, 0.035, RAIL);

    // ---- THE STAIR: a straight flight down the end, up to the landing ----
    const n = 17, rise = (f1 - FY0) / n, go = 0.27;
    const xL = xr1 + 0.78, zt = zb0 + 2.8, zB = zt + n * go;
    if (CBZ.stairs && CBZ.stairs.flight) {
      const bw = K.lw(xL, zB), tw = K.lw(xL, zt);
      CBZ.stairs.flight({ bottom: { x: bw.x, y: b.gy + FY0, z: bw.z }, top: { x: tw.x, y: b.gy + f1, z: tw.z },
        // (no AI link: the stairs registry keeps links past an island's
        // life unless their owner is one of its buildings)
        width: 1.1, overlap: 0.3, steps: n, underside: true, plats: [], cols: b.colliders, owner: b.group, link: false });
    }
    for (let i = 0; i < n; i++) {
      const yt = FY0 + (i + 1) * rise, zc = zB - (i + 0.5) * go;
      K.lbox(xL, yt - 0.03, zc, 1.16, 0.06, go + 0.02, 0x8f8b84);
      K.lbox(xL, yt - rise / 2 - 0.03, zB - i * go - 0.02, 1.16, rise - 0.06, 0.03, 0x6d6a65);
    }
    // the stringers (stepped), the rail on the open side
    for (let i = 0; i < n; i += 3) {
      const y0 = FY0 + i * rise, z1 = zB - i * go, z0 = Math.max(zt, z1 - 3 * go);
      K.lbox(xL + 0.62, y0 + 0.5 + 1.5 * rise, (z0 + z1) / 2, 0.06, 1.0 + 3 * rise, z1 - z0, 0, { solid: true, noVis: true });
      K.lbox(xL + 0.62, y0 + 1.0 + 1.5 * rise, (z0 + z1) / 2, 0.05, 0.05, z1 - z0, RAIL);
      K.lbox(xL + 0.62, y0 + 0.5 + rise, z1 - 0.05, 0.04, 1.0, 0.04, RAIL);
      K.lbox(xL + 0.6, y0 + 0.12, (z0 + z1) / 2, 0.06, 0.24 + 3 * rise, z1 - z0, 0x6d6a65);
    }

    // ---- THE OFFICE'S SIGN, lit over its door ----------------------------
    const T0 = CBZ.islandFit.text(["OFFICE"], { bg: "#1d2a36", fg: "#ffe6a8", w: 256, h: 64 });
    if (T0) CBZ.islandFit.panel(b, ctx.root, (dx0 + dx1) / 2, FY0 + 2.75, zb0 - 0.66, 1.5, 0.38, Math.PI, T0, true);

    K.flush();
    b.colliders.push.apply(b.colliders, K.cols);
    b.floorTop = b.gy + FY0;
    b.interior = {
      kind: "motel", x0: xo0 + T, x1: xr0 - T / 2, z0: zb0 + T, z1: zb1 - T,
      keepOut: [{ x0: dx0 - 0.4, x1: xr0 - T / 2, z0: zb0 + T, z1: zb0 + T + 1.7, why: "door" }],
      covers: [], furn: [], fyOf: [FY0, FH, FY0],
    };
    b.far = [farBox(K, b, xr0, xe, zb0, zb1, roofY + 0.24), farBox(K, b, xo0, xr0, zb0, zb1, OH + 0.24)];
    const od = K.lw((dx0 + dx1) / 2, zb0 - 0.6);
    b.motel = { rooms: rooms, rent: rentI,
      office: { local: { x0: xo0 + T, x1: xr0 - T / 2, z0: zb0 + T, z1: zb1 - T }, door: { x: od.x, y: b.gy + FY0, z: od.z } } };
    return b;
  }
  // one room's furniture (the arena's furnish: its bed is kept for the isles'
  // bed registry and turned through the building with the rest)
  function roomInside(ctx, K, rec, fk, x0, x1, z0, z1, d0, d1, CARPET, WALL) {
    const host = function (x, y, z, w, h, d, col, o) { return K.lbox(x, y, z, w, h, d, col, o); };
    const F = ctx.furnish;
    K.lbox((x0 + x1) / 2, fk + 0.006, (z0 + z1) / 2, x1 - x0, 0.012, z1 - z0, CARPET);
    // the bathroom across the back, its door open
    const bz = z1 - 2.0, bdx0 = x0 + 0.25, bdx1 = bdx0 + 0.75;
    const H = 2.75;
    K.lbox((bdx1 + x1) / 2, fk + H / 2, bz, x1 - bdx1, H, 0.1, 0xe2e0da, { solid: true });
    K.lbox((x0 + bdx0) / 2, fk + H / 2, bz, bdx0 - x0, H, 0.1, 0xe2e0da, { solid: true });
    K.lbox((bdx0 + bdx1) / 2, fk + 2.1 + (H - 2.1) / 2, bz, 0.75, H - 2.1, 0.1, 0xe2e0da);
    K.lbox(bdx1 - 0.02, fk + 1.02, bz + 0.38, 0.04, 2.0, 0.72, 0xd9d4ca);
    K.lbox((x0 + x1) / 2, fk + 0.008, (bz + z1) / 2, x1 - x0, 0.014, z1 - bz - 0.06, 0xd9dcd8);
    K.lbox(x1 - 0.35, fk + 0.2, z1 - 0.32, 0.38, 0.4, 0.5, 0xf2f2ef, { solid: true });
    K.lbox(x1 - 0.35, fk + 0.62, z1 - 0.1, 0.42, 0.42, 0.16, 0xf2f2ef);
    K.lbox(x0 + 1.6, fk + 0.84, z1 - 0.26, 0.5, 0.1, 0.42, 0xf2f2ef);
    K.lbox(x0 + 1.6, fk + 0.4, z1 - 0.28, 0.16, 0.8, 0.16, 0xf2f2ef);
    K.lbox(x0 + 1.6, fk + 1.45, z1 - 0.02, 0.55, 0.7, 0.02, 0xb9c4c9);
    K.lbox(x0 + 0.55, fk + 0.05, z1 - 0.5, 0.9, 0.1, 0.9, 0xeeeeea);
    // the bed, its head to the side wall, in the middle of the room
    const bzc = (z0 + bz) / 2 + 0.25, BL = 2.0;
    if (F) F("bed", host, x1 - BL / 2 - 0.06, fk, bzc, Math.PI / 2, { len: BL, wide: 1.5, tone: { cloth: 0x3b4a5c, wood: 0x3a2b1e, frame: 0x2e2620 } });
    rec.bed = K.lw(x1 - BL / 2 - 0.06, bzc);
    // the nightstand and its lamp, toward the window
    const nz = bzc - 0.75 - 0.3;
    K.lbox(x1 - 0.26, fk + 0.27, nz, 0.44, 0.54, 0.4, 0x4a3324, { solid: true, noStep: true });
    K.lbox(x1 - 0.26, fk + 0.72, nz, 0.03, 0.3, 0.03, 0x3a3a3a);
    K.lbox(x1 - 0.26, fk + 0.92, nz, 0.24, 0.2, 0.24, 0xf3dcae, { glow: true });
    // the TV on its cabinet against the other wall, facing the bed
    K.lbox(x0 + 0.24, fk + 0.25, bzc, 0.45, 0.5, 1.2, 0x3b2c22, { solid: true, noStep: true });
    K.lbox(x0 + 0.08, fk + 1.15, bzc, 0.05, 0.6, 1.0, 0x0e1013);
    // a table and a chair by the window
    if (F) {
      F("table", host, x1 - 0.65, fk, z0 + 0.85, 0, { len: 0.8, deep: 0.7, seats: 0, tone: { wood: 0x6f5139 } });
      F("chair", host, x1 - 1.45, fk, z0 + 0.85, Math.PI / 2, { tone: { cloth: 0x7a3b2e, wood: 0x4a3324 } });
    }
    // the light in the room
    K.lbox((x0 + x1) / 2, fk + H - 0.03, (z0 + bz) / 2, 0.4, 0.04, 0.4, 0xf6efe0, { glow: true });
  }

  /* ======================================================================
     THE USED CAR LOT
     ====================================================================== */
  const USED = ["Kotori Sprout", "Kotori Pip", "Bison Vista", "Bison Hauler", "Bison Rampart", "Bison Frontier", "Kotori Kaze", "Metro Cab"];
  const FADED = [0xb9b2a6, 0x8c8f8a, 0x6f7f8c, 0x9b6b5a, 0x7d8a6c, 0xc8c2ad, 0x5f6670, 0xa89a7e, 0x7b6d8a, 0xd2cbbb];
  function carlot(l, ctx) {
    if (!CBZ.islandFit) return null;
    const W = l.w, D = l.d, zf = -D / 2, TOP = 0.08;
    const CONC = 0xb7b2a6, KERB = 0xd0ccc2;
    const b = siteOf(l, ctx, "carlot", 3.1, 1, 0xf1efe8, 0x55585c);
    const K = CBZ.islandFit.kit(b, { parent: ctx.root, rooms: false, raw: true, los: true, cast: true, name: "carlot" });
    // the forecourt, its kerb, the way in
    K.lbox(0, (TOP - 0.35) / 2, 0, W, TOP + 0.35, D, CONC, { plat: true });
    const ex1 = -W / 2 + 8;
    K.lbox((ex1 + W / 2) / 2, TOP + 0.06, zf + 0.08, W / 2 - ex1, 0.12, 0.16, KERB);
    K.lbox(-W / 2 + 0.08, TOP + 0.06, 0, 0.16, 0.12, D, KERB);
    K.lbox(W / 2 - 0.08, TOP + 0.06, 0, 0.16, 0.12, D, KERB);
    K.lbox(0, TOP + 0.06, D / 2 - 0.08, W, 0.12, 0.16, KERB);
    // the joints in the concrete
    for (let x = -W / 2 + 4; x < W / 2; x += 4) K.lbox(x, TOP + 0.002, 0, 0.03, 0.004, D - 0.4, 0x8c887f);
    for (let z = zf + 4; z < D / 2; z += 4) K.lbox(0, TOP + 0.002, z, W - 0.4, 0.004, 0.03, 0x8c887f);

    // ---- THE CABIN, back corner ------------------------------------------
    const cx0 = W / 2 - 5.2, cx1 = W / 2 - 0.6, cz0 = D / 2 - 4.0, cz1 = D / 2 - 0.6;
    const T = 0.15, PL = 0.22, CH = 2.8;
    const WHITE = 0xf1efe8, BLUE = 0x2c4a6e;
    K.lbox((cx0 + cx1) / 2, PL / 2, (cz0 + cz1) / 2, cx1 - cx0 + 0.3, PL, cz1 - cz0 + 0.3, 0x9c978d, { plat: true });
    K.lbox(cx0 + T / 2, PL + CH / 2, (cz0 + cz1) / 2, T, CH, cz1 - cz0, WHITE, { solid: true });
    K.lbox(cx1 - T / 2, PL + CH / 2, (cz0 + cz1) / 2, T, CH, cz1 - cz0, WHITE, { solid: true });
    K.lbox((cx0 + cx1) / 2, PL + CH / 2, cz1 - T / 2, cx1 - cx0, CH, T, WHITE, { solid: true });
    const dd0 = cx0 + 0.45, dd1 = dd0 + 0.9, ww0 = dd1 + 0.5, ww1 = cx1 - 0.35;
    wallX(K, cx0, cx1, cz0 + T / 2, T, PL, PL + CH, [{ x0: dd0, x1: dd1, y0: 0, y1: PL + 2.05 }, { x0: ww0, x1: ww1, y0: PL + 0.95, y1: PL + 2.05 }], WHITE, { solid: true });
    pane(ctx, b, K, (ww0 + ww1) / 2, PL + 1.5, cz0 + T / 2, ww1 - ww0, 1.1, 0.04);
    K.lbox(dd0 + 0.03, PL + 1.0, cz0 + T + 0.44, 0.05, 2.0, 0.86, BLUE);
    K.lbox((cx0 + cx1) / 2, PL + CH + 0.08, (cz0 + cz1) / 2 - 0.2, cx1 - cx0 + 0.5, 0.16, cz1 - cz0 + 0.7, 0x55585c, { solid: true });
    K.lbox((cx0 + cx1) / 2, PL + CH + 0.08, cz0 - 0.56, cx1 - cx0 + 0.52, 0.3, 0.05, BLUE);
    K.lbox((cx0 + cx1) / 2, PL + 0.006, (cz0 + cz1) / 2, cx1 - cx0 - 2 * T, 0.012, cz1 - cz0 - 2 * T, 0x7a6a58);
    K.lbox((cx0 + cx1) / 2, PL + CH - 0.04, (cz0 + cz1) / 2, 0.5, 0.04, 0.5, 0xf6efe0, { glow: true });
    const host = function (x, y, z, w, h, d, col, o) { return K.lbox(x, y, z, w, h, d, col, o); };
    if (ctx.furnish) {
      ctx.furnish("desk", host, (cx0 + cx1) / 2 + 0.6, PL, cz1 - 1.0, Math.PI, { len: 1.4, deep: 0.7 });
      ctx.furnish("chair", host, cx0 + 0.6, PL, cz1 - 0.6, Math.PI / 2, {});
    }

    // ---- THE FLAGS AND THE BUNTING -----------------------------------------
    const poles = [];
    for (let i = 0; i < 5; i++) poles.push({ x: ex1 + 0.6 + i * (W / 2 - 0.6 - ex1 - 0.6) / 4, z: zf + 0.45, h: 5.0 });
    poles.push({ x: -W / 2 + 0.45, z: D / 2 - 0.45, h: 3.6 }, { x: cx0 - 0.5, z: D / 2 - 0.45, h: 3.6 });
    for (const p of poles) {
      K.lbox(p.x, TOP + p.h / 2, p.z, 0.08, p.h, 0.08, 0xc9ccd0, { solid: true });
      K.lbox(p.x, TOP + p.h + 0.04, p.z, 0.14, 0.08, 0.14, 0xd8b34a);
    }
    const PEN = [0xd62828, 0xf7c548, 0x1d70b8, 0xf2f2f2, 0x2a9d4b];
    let pc = 0;
    function string(a, c) {
      const ya = b.gy + TOP + a.h - 0.15, yc = b.gy + TOP + c.h - 0.15;
      const A = K.lw(a.x, a.z), C = K.lw(c.x, c.z);
      const L = Math.hypot(C.x - A.x, C.z - A.z), n = Math.max(2, Math.floor(L / 0.42));
      const sag = Math.min(0.9, L * 0.06);
      const P = function (t) { return [A.x + (C.x - A.x) * t, ya + (yc - ya) * t - sag * 4 * t * (1 - t), A.z + (C.z - A.z) * t]; };
      for (let i = 0; i < n; i++) {
        const p0 = P(i / n), p1 = P((i + 0.7) / n), mid = P((i + 0.35) / n);
        const tip = [mid[0], mid[1] - 0.3, mid[2]];
        K.quad(p0, p1, tip, tip, PEN[pc++ % PEN.length]);
      }
      // the line itself
      for (let i = 0; i < n; i++) {
        const p0 = P(i / n), p1 = P((i + 1) / n);
        K.quad(p0, p1, [p1[0], p1[1] - 0.015, p1[2]], [p0[0], p0[1] - 0.015, p0[2]], 0x3a3a3a);
      }
    }
    for (let i = 0; i + 1 < 5; i++) string(poles[i], poles[i + 1]);
    string(poles[0], poles[5]); string(poles[4], poles[6]); string(poles[2], poles[5]); string(poles[2], poles[6]);

    // ---- THE CARS, two rows facing the road --------------------------------
    const spots = [];
    if (ctx.makeCar) {
      const xs = [-W / 2 + 9.2, -W / 2 + 12.4, -W / 2 + 15.6, -W / 2 + 18.8, -W / 2 + 22.0];
      const rows = [zf + 3.6, zf + 10.0];
      for (let r = 0; r < rows.length; r++) for (let i = 0; i < xs.length; i++) {
        if (r === 1 && xs[i] > cx0 - 2.0) continue;
        const c = K.lw(xs[i], rows[r]);
        const model = pick(USED, c.x, c.z, 0x5a1 + r);
        const spot = ctx.makeCar(c.x, c.z, l.yaw || 0, pick(FADED, c.x, c.z, 0x5a2));
        if (!spot) continue;
        spot.y = b.gy + TOP + 0.045; spot.floor = true;
        spot.model = model;
        spot.sale = { use: "usedcars", used: true, wear: 0.55 + h01(c.x, c.z, 0x5a3) * 0.25 };
        spots.push(spot);
      }
    }

    K.flush();
    b.colliders.push.apply(b.colliders, K.cols);
    b.floorTop = b.gy + PL;
    b.interior = { kind: "carlot", x0: cx0 + T, x1: cx1 - T, z0: cz0 + T, z1: cz1 - T,
      keepOut: [{ x0: dd0 - 0.2, x1: dd1 + 0.2, z0: cz0 + T, z1: cz0 + T + 1.2, why: "door" }],
      covers: [], furn: [], fyOf: [PL] };
    b.far = [farBox(K, b, cx0, cx1, cz0, cz1, PL + CH + 0.16)];
    const cd = K.lw((dd0 + dd1) / 2, cz0 - 0.6);
    b.carlot = { spots: spots, cabin: { local: { x0: cx0, x1: cx1, z0: cz0, z1: cz1 }, door: { x: cd.x, y: b.gy + TOP, z: cd.z } } };
    return b;
  }

  function build(l, ctx) {
    if (!l || !ctx || !ctx.root) return null;
    try {
      if (l.kind === "motel") return motel(l, ctx);
      if (l.kind === "carlot") return carlot(l, ctx);
    } catch (e) { console.error("[island lots " + l.kind + "]", e); }
    return null;
  }
  CBZ.islandLots = { build: build };
})();
