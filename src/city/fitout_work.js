/* ============================================================
   city/fitout_work.js — THE WORKPLACE FIT-OUT: office floors and shops.

   The lazy half (city/fitout.js) of the floors interior_programs.js and
   buildings.js already drew eagerly. Nothing here re-draws what the eager
   pass owns: it READS the eager plan (the desk grid formula, the meeting
   table, the lobby's door frame, the shop dresser's placement gates) and
   fits out AROUND it, the way a contractor fits out a shell after the
   furniture order is already on the floor plan.

     deskfarm   carpet tile, a 600 grid ceiling with troffers on a real
                module, blinds, a keyboard on every desk and the clutter of
                whoever sits there, a copier station, a water cooler, tall
                plants, and a restroom pair wherever the plan leaves a wall.
     meeting    carpet, pendants over the table, a credenza under the screen,
                a blank whiteboard, a plant.
     lobby      terrazzo, a feature wall behind reception, a seating group
                opposite the waiting bench, planters, pendants over the desk,
                a blank directory board, the ground-floor restrooms.
     breakroom  vinyl, a kitchenette on the far wall (fridge, sink run,
                microwave, coffee machine, wall cabinets).
     storage    sealed slab, battens over the aisles, a trolley of archive
                boxes, an extinguisher.
     empty      a floor to let: bare slab, exposed battens (some dead), a
                duct run, and on the untouched floors the contractor's kit.
     shop       per trade: the floor finish, a clad counter with a card
                reader and an impulse rack, the till as a register, a
                stockroom in the back corner where the room allows, CCTV,
                and the set pieces the eager dresser's gates never let land.

   Also registers two CBZ.fitoutDraw verbs for the owned-property
   catalogue: "bar" and "pooltable".

   Everything is building-local metres; box y is a CENTRE so the helpers
   below all take a BOTTOM (yb) and add half the height. Deterministic
   (B.h / CBZ.hash01), no Math.random.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.fitoutPlan) return;

  const PI = Math.PI;
  const T = 0.12;                                  // partition thickness

  // ---- palette ---------------------------------------------------------
  const C = {
    plaster: 0xe9e4da, white: 0xf2f1ec, porcelain: 0xf4f4f0, steel: 0xb9bec4,
    chrome: 0xd4d8dc, dark: 0x24272c, charcoal: 0x33373d, grey: 0x8a9098,
    laminate: 0xd9d4c8, oak: 0xa77b52, walnut: 0x5d4330, stone: 0xd8d4cc,
    mirror: 0xc4d0d6, leaf: 0x3f7f45, leaf2: 0x4f9454, leaf3: 0x2f6b3a,
    pot: 0x3a3a3c, soil: 0x3b2c20, carton: 0xb58a5a, carton2: 0x9c7446,
    paper: 0xf6f5ef, felt: 0x1f6b43, rubber: 0x2a2c30, yellow: 0xe8c23a,
    red: 0xb3342e, blue: 0x3a6ea5, water: 0x9cc8e6, brass: 0xc9a54a,
    glowWhite: 0xf6f3e8, glowWarm: 0xffe2b0, screen: 0x6fc3e8,
  };

  // ---- small geometry helpers -----------------------------------------
  function box(B, x, yb, z, w, h, d, col, o) { return B.box(x, yb + h / 2, z, w, h, d, col, o); }
  // a frame: u runs along (ax,az), v along (nx,nz); both axis-aligned units
  function Frame(ox, oz, ax, az, nx, nz) {
    const alongX = Math.abs(ax) > 0.5;
    const F = {
      ox: ox, oz: oz, ax: ax, az: az, nx: nx, nz: nz,
      x: function (u, v) { return ox + ax * u + nx * v; },
      z: function (u, v) { return oz + az * u + nz * v; },
      // centre (u,v), bottom yb, extents du (along u) × h × dv (along v)
      box: function (B, u, v, yb, du, h, dv, col, o) {
        return B.box(F.x(u, v), yb + h / 2, F.z(u, v), alongX ? du : dv, h, alongX ? dv : du, col, o);
      },
      // the same by its u/v RANGE (order-free)
      span: function (B, u0, u1, v0, v1, yb, h, col, o) {
        return F.box(B, (u0 + u1) / 2, (v0 + v1) / 2, yb, Math.abs(u1 - u0), h, Math.abs(v1 - v0), col, o);
      },
      rect: function (u0, v0, u1, v1) {
        const xa = F.x(u0, v0), xb = F.x(u1, v1), za = F.z(u0, v0), zb = F.z(u1, v1);
        return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) };
      },
      // a solid partition RUNNING along u at depth v (gaps are u-centres)
      wallU: function (B, v, u0, u1, gaps, o) {
        const oo = Object.assign({}, o || {});
        oo.gaps = (gaps || []).map(function (g) { return { c: alongX ? F.x(g.c, v) : F.z(g.c, v), w: g.w, h: g.h }; });
        if (alongX) B.wall("x", F.z(0, v), F.x(u0, v), F.x(u1, v), oo);
        else B.wall("z", F.x(0, v), F.z(u0, v), F.z(u1, v), oo);
      },
      // …RUNNING along v at lateral u (gaps are v-centres)
      wallV: function (B, u, v0, v1, gaps, o) {
        const oo = Object.assign({}, o || {});
        oo.gaps = (gaps || []).map(function (g) { return { c: alongX ? F.z(u, g.c) : F.x(u, g.c), w: g.w, h: g.h }; });
        if (alongX) B.wall("z", F.x(u, 0), F.z(u, v0), F.z(u, v1), oo);
        else B.wall("x", F.z(u, 0), F.x(u, v0), F.x(u, v1), oo);
      },
      // yaw (repo convention forward = (sin, cos)) of a frame direction
      yaw: function (du, dv) { return Math.atan2(ax * du + nx * dv, az * du + nz * dv); },
      // a sub-frame whose origin is (u,v) here
      at: function (u, v, flipV) {
        return flipV ? Frame(F.x(u, v), F.z(u, v), ax, az, -nx, -nz) : Frame(F.x(u, v), F.z(u, v), ax, az, nx, nz);
      },
    };
    return F;
  }
  function inRect(R, x, z, m) { return x > R.x0 + m && x < R.x1 - m && z > R.z0 + m && z < R.z1 - m; }
  function overlap(a, b) { return a.x1 > b.x0 && a.x0 < b.x1 && a.z1 > b.z0 && a.z0 < b.z1; }
  function grow(R, m) { return { x0: R.x0 - m, x1: R.x1 + m, z0: R.z0 - m, z1: R.z1 + m }; }
  function hashPick(B, arr, a, b, s) { return arr[Math.min(arr.length - 1, Math.floor(B.h(a, b, s) * arr.length))]; }

  // THE SHELL — the building's own inside faces (the rect programs are handed
  // stops 0.4 m short of them; architecture and wall-hung pieces use these).
  function shellOf(B) {
    const b = B.b, wt = b.wt != null ? b.wt : 0.4;
    // (the stair core is a reserved rect inside this, handled by the builder's
    // core guard + holes, not by moving a face: the old -x "open stair strip"
    // side was keyed on buildings.js's dead hasStairs gate and never existed)
    return { x0: -b.w / 2 + wt, x1: b.w / 2 - wt, z0: -b.d / 2 + wt, z1: b.d / 2 - wt, wt: wt };
  }
  function holesOf(B) { return (B.holes && B.holes()) || []; }
  function inHole(B, x, z, pad) {
    const H = holesOf(B);
    for (let i = 0; i < H.length; i++) {
      const h = H[i];
      if (x > h.x0 - pad && x < h.x1 + pad && z > h.z0 - pad && z < h.z1 + pad) return true;
    }
    return false;
  }

  // THE OCCUPANCY LEDGER — rects the eager plan or this plan already owns.
  function Occ() {
    const L = [];
    return {
      list: L,
      add: function (R) { if (R) L.push(R); return R; },
      hit: function (R) { for (let i = 0; i < L.length; i++) if (overlap(R, L[i])) return true; return false; },
    };
  }
  // a footprint is free: nothing owns it, and the building's own aisle /
  // stair / shaft predicate passes on a 0.45 m sample grid across it.
  function rectFree(B, occ, R, pad) {
    if (occ && occ.hit(R)) return false;
    const p = pad == null ? 0.05 : pad;
    const ix = Math.max(1, Math.ceil((R.x1 - R.x0 - 0.16) / 0.45)), iz = Math.max(1, Math.ceil((R.z1 - R.z0 - 0.16) / 0.45));
    for (let i = 0; i <= ix; i++) for (let j = 0; j <= iz; j++) {
      const x = R.x0 + 0.08 + (R.x1 - R.x0 - 0.16) * (i / ix), z = R.z0 + 0.08 + (R.z1 - R.z0 - 0.16) * (j / iz);
      if (!B.clear(x, z, p)) return false;
    }
    return true;
  }

  // the four inside faces as frames: u along the wall, v into the room
  function sidesOf(S) {
    return {
      x0: { F: Frame(S.x0, S.z0, 0, 1, 1, 0), len: S.z1 - S.z0, open: false, openA: false, openB: false },
      z1: { F: Frame(S.x0, S.z1, 1, 0, 0, -1), len: S.x1 - S.x0, open: false, openA: false, openB: false },
      x1: { F: Frame(S.x1, S.z1, 0, -1, -1, 0), len: S.z1 - S.z0, open: false, openA: false, openB: false },
      z0: { F: Frame(S.x1, S.z0, -1, 0, 0, 1), len: S.x1 - S.x0, open: false, openA: false, openB: false },
    };
  }
  // does any facade window on the wall behind frame P overlap u0..u1, yb..yt?
  function winHit(B, P, u0, u1, yb, yt) {
    const W = B.windows ? B.windows() : [];
    for (let i = 0; i < W.length; i++) {
      const w = W[i];
      const dx = w.x - P.ox, dz = w.z - P.oz;
      const dv = dx * P.nx + dz * P.nz;
      if (Math.abs(dv) > 0.9) continue;
      const wu = dx * P.ax + dz * P.az;
      if (wu + w.hw < Math.min(u0, u1) - 0.05 || wu - w.hw > Math.max(u0, u1) + 0.05) continue;
      if (w.y + w.hh < yb || w.y - w.hh > yt) continue;
      return true;
    }
    return false;
  }
  // a free run of wall `len` long, `dep` deep, with `front` of walkway in
  // front of it. Returns a piece frame (u 0..len along the wall, v 0..dep
  // off it) or null. opts.tall: the piece's top above the floor (windows
  // with a sill under it are refused); opts.hang: [yb,yt] wall-hung band.
  function wallSpot(B, occ, S, len, dep, opts) {
    opts = opts || {};
    const sides = sidesOf(S), names = opts.sides || ["x0", "z1", "x1", "z0"];
    const front = opts.front == null ? 0.8 : opts.front;
    const salt = opts.salt | 0;
    for (let s = 0; s < names.length; s++) {
      const sd = sides[names[s]];
      if (!sd || sd.open || sd.len < len + 0.4) continue;
      const n = Math.max(1, Math.floor((sd.len - len - 0.3) / 0.4));
      const start = Math.floor(B.h(len * 7 + s, dep * 3 + salt, 0x7a11 + salt) * n);
      for (let q = 0; q < n; q++) {
        const u0 = 0.15 + ((start + q) % n) * 0.4;
        if (sd.openA && u0 < 0.3) continue;
        if (sd.openB && u0 + len > sd.len - 0.3) continue;
        const R = sd.F.rect(u0, 0, u0 + len, dep);
        const Rf = sd.F.rect(u0, 0, u0 + len, dep + front);
        if (occ.hit(Rf) || !rectFree(B, null, R, 0.05)) continue;
        if (opts.tall && winHit(B, sd.F, u0, u0 + len, B.fy + 0.05, B.fy + opts.tall)) continue;
        if (opts.hang && winHit(B, sd.F, u0, u0 + len, B.fy + opts.hang[0], B.fy + opts.hang[1])) continue;
        occ.add(opts.noFront ? R : Rf);
        const P = sd.F.at(u0, 0);
        P.len = len; P.side = names[s];
        return P;
      }
    }
    return null;
  }
  // a free floor spot for a loose piece (w×d) near a preferred point
  function floorSpot(B, occ, R, w, d, px, pz, pad) {
    const hw = w / 2, hd = d / 2;
    let best = null, bd = 1e9;
    for (let x = R.x0 + hw + 0.05; x <= R.x1 - hw - 0.05; x += 0.5) {
      for (let z = R.z0 + hd + 0.05; z <= R.z1 - hd - 0.05; z += 0.5) {
        const dd = (x - px) * (x - px) + (z - pz) * (z - pz);
        if (dd >= bd) continue;
        const F = { x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd };
        if (!rectFree(B, occ, grow(F, pad == null ? 0.4 : pad), 0.05)) continue;
        best = { x: x, z: z, R: F }; bd = dd;
      }
    }
    if (best) occ.add(grow(best.R, 0.3));
    return best;
  }

  // ---- THE TV: the game's one set (city/newsroom.js, through B.tv), hung
  // on a free run of wall with its screen centre `cy` over the floor. On
  // NEWS ONE, like every set in the city.
  function wallTV(B, occ, S, w, cy, salt) {
    if (!B.tv || B.ceil - B.fy < cy + w * 0.3 + 0.15) return null;
    const run = w + 0.1, sh = w * 9 / 16;
    const P = wallSpot(B, occ, S, run, 0.14, { hang: [cy - sh / 2 - 0.05, cy + sh / 2 + 0.05], front: 0, noFront: true, salt: salt | 0 });
    if (!P) return null;
    return B.tv(P.x(run / 2, 0), P.z(run / 2, 0), Math.atan2(P.nx, P.nz), { w: w, mount: "wall", atWall: true, y: B.fy + cy });
  }

  // ---- surfaces ---------------------------------------------------------
  // a floor finish over R, split at every hole edge so the stairwell and
  // lift chase are cut clean instead of losing a whole metre cell round them
  function floorPlane(B, R, mat, tint, dy, ceiling) {
    const H = holesOf(B);
    const xs = [R.x0, R.x1], zs = [R.z0, R.z1];
    for (let i = 0; i < H.length; i++) {
      const h = H[i];
      if (!(h.x1 > R.x0 && h.x0 < R.x1 && h.z1 > R.z0 && h.z0 < R.z1)) continue;
      if (h.x0 > R.x0 && h.x0 < R.x1) xs.push(h.x0);
      if (h.x1 > R.x0 && h.x1 < R.x1) xs.push(h.x1);
      if (h.z0 > R.z0 && h.z0 < R.z1) zs.push(h.z0);
      if (h.z1 > R.z0 && h.z1 < R.z1) zs.push(h.z1);
    }
    xs.sort(function (a, b) { return a - b; }); zs.sort(function (a, b) { return a - b; });
    const y = ceiling ? B.ceil - 0.012 : B.fy + (dy || 0);
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
      const a0 = xs[i], a1 = xs[i + 1], b0 = zs[j], b1 = zs[j + 1];
      if (a1 - a0 < 0.02 || b1 - b0 < 0.02) continue;
      if (inHole(B, (a0 + a1) / 2, (b0 + b1) / 2, 0)) continue;
      B.plane(a0, b0, a1, b1, y, mat, tint, { cell: ceiling ? 1.2 : 1.0, holes: [], down: !!ceiling });
    }
  }
  // THE FIXTURE WITHOUT ITS SOURCE — the same boxes fitout.js's B.light
  // draws, for the fixtures that are not baked sources. The bake is
  // vertices × sources with no culling, so a real 3 m grid of troffers
  // bakes from every other fixture (a checkerboard, wider radius) and the
  // rest are the lit fittings you see.
  function fixtureOnly(B, x, z, o) { B.fixture(x, z, o); }
  // 600×600 troffers (or battens, domes, bulbs) on a real module;
  // skip(x,z) vetoes a slot
  function troffers(B, R, module, skip, o) {
    o = o || {};
    const W = R.x1 - R.x0, D = R.z1 - R.z0;
    const nx = Math.max(1, Math.round(W / module)), nz = Math.max(1, Math.round(D / module));
    const every = nx * nz > 2;                      // tiny rooms: every fitting is a source
    let n = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = R.x0 + (i + 0.5) * W / nx, z = R.z0 + (j + 0.5) * D / nz;
      if (inHole(B, x, z, 0.45) || (skip && skip(x, z))) continue;
      if (every && ((i + j) & 1)) { fixtureOnly(B, x, z, o); continue; }
      B.light(x, z, { kind: o.kind || "panel", r: (o.r || 5.2) * (every ? 1.3 : 1), i: o.i == null ? 0.55 : o.i, rect: o.rect || null,
                      color: o.color, len: o.len, axis: o.axis, drop: o.drop });
      n++;
    }
    return n;
  }
  function inAny(list, x, z, m) { for (let i = 0; i < list.length; i++) if (inRect(grow(list[i], m || 0), x, z, 0)) return true; return false; }
  // pendant drop so the shade hangs ~2.1 m over the floor
  function pendantDrop(B, over) { return Math.max(0.35, Math.min(1.3, B.ceil - (B.fy + (over || 2.1)) - 0.17)); }

  // blinds: a headrail and a rolled band at the head of each window
  function blinds(B, S, tint) {
    const W = B.windows ? B.windows() : [];
    let n = 0;
    for (let i = 0; i < W.length && n < 90; i++) {
      const w = W[i];
      const top = Math.min(w.y + w.hh, B.ceil - 0.02);
      const lowered = B.h(w.x, w.z, 0x6b11) < 0.4;
      const band = lowered ? Math.min(w.hh * 2 * 0.35, 0.7) : 0.12;
      // clip the run to the room's own faces (a corner window's pane can
      // run into the return wall)
      const lo0 = w.axis === "z" ? S.z0 + 0.02 : S.x0raw + 0.02, hi0 = w.axis === "z" ? S.z1 - 0.02 : S.x1 - 0.02;
      const c = w.axis === "z" ? w.z : w.x;
      const a = Math.max(lo0, c - w.hw - 0.04), e = Math.min(hi0, c + w.hw + 0.04);
      if (e - a < 0.25) continue;
      const mid = (a + e) / 2, span = e - a;
      if (w.axis === "z") {
        const x = w.side < 0 ? S.x0raw + 0.05 : S.x1 - 0.05;
        box(B, x, top - 0.08, mid, 0.07, 0.08, span, 0xd9dcdc);
        box(B, x - w.side * 0.01, top - 0.08 - band, mid, 0.02, band, span - 0.04, tint);
      } else {
        const z = w.side < 0 ? S.z0 + 0.05 : S.z1 - 0.05;
        box(B, mid, top - 0.08, z, span, 0.08, 0.07, 0xd9dcdc);
        box(B, mid, top - 0.08 - band, z - w.side * 0.01, span - 0.04, band, 0.02, tint);
      }
      n++;
    }
    return n;
  }

  // ---- pieces (P: a wall frame, u along the wall, v off it) --------------
  // a floor plant is the furniture kit's F.planter (a ficus in a big pot): it
  // used to be three green cubes stacked on a grey one
  function plant(B, x, z, s) {
    return B.furn("planter", x, z, 0, { kind: "tree", s: (s || 1) * 0.95 });
  }
  function bin(B, x, z) {
    box(B, x, B.fy, z, 0.34, 0.6, 0.34, 0x4a5058);
    box(B, x, B.fy + 0.6, z, 0.36, 0.03, 0.36, 0x2f3338);
  }
  function copierStation(B, P) {                 // len 1.65, dep 0.7
    const y = B.fy;
    P.span(B, 0.05, 0.69, 0.04, 0.66, y, 0.92, 0xd4d6d4, { solid: true });       // body
    P.span(B, 0.07, 0.67, 0.08, 0.6, y + 0.92, 0.07, 0x9a9ea2);                   // scanner lid
    P.span(B, 0.5, 0.66, 0.5, 0.64, y + 0.92, 0.03, C.dark);                      // control panel
    P.span(B, 0.52, 0.62, 0.53, 0.61, y + 0.95, 0.008, C.screen, { glow: true });  // its screen
    P.span(B, 0.1, 0.4, 0.66, 0.9, y + 0.62, 0.02, 0x9a9ea2);                     // output tray
    P.span(B, 0.12, 0.38, 0.68, 0.88, y + 0.64, 0.03, C.paper);                   // printed sheets
    P.span(B, 0.08, 0.66, 0.66, 0.67, y + 0.12, 0.62, 0xbfc2c0);                  // drawer faces
    P.span(B, 0.82, 1.6, 0.0, 0.45, y, 0.9, C.laminate, { solid: true });          // supply cabinet
    P.span(B, 0.8, 1.62, 0.0, 0.47, y + 0.9, 0.03, 0x8a8f94);                     // cabinet top
    P.span(B, 0.9, 1.2, 0.06, 0.28, y + 0.93, 0.22, C.paper);                     // reams
    P.span(B, 1.26, 1.52, 0.06, 0.4, y + 0.93, 0.26, C.carton);                   // toner box
    P.span(B, 1.2, 1.21, 0.451, 0.46, y + 0.2, 0.55, 0x6a6f74);                   // cabinet door seam
  }
  function waterCooler(B, P) {                   // len 0.45, dep 0.45
    const y = B.fy;
    P.span(B, 0.07, 0.39, 0.06, 0.38, y, 1.0, C.white);
    P.span(B, 0.1, 0.36, 0.09, 0.35, y + 1.0, 0.42, C.water);
    P.span(B, 0.16, 0.3, 0.15, 0.29, y + 1.42, 0.04, 0x5f8fb5);
    P.span(B, 0.1, 0.2, 0.38, 0.43, y + 0.82, 0.05, C.blue);                      // cold tap
    P.span(B, 0.26, 0.36, 0.38, 0.43, y + 0.82, 0.05, C.red);                     // hot tap
    P.span(B, 0.12, 0.34, 0.38, 0.44, y + 0.55, 0.02, C.grey);                    // drip tray
  }
  function extinguisher(B, P) {                  // len 0.3, dep 0.22
    const y = B.fy;
    P.span(B, 0.02, 0.28, 0.0, 0.02, y + 0.35, 0.62, 0x9a9ea2);                   // wall plate
    P.span(B, 0.07, 0.23, 0.03, 0.19, y + 0.42, 0.5, C.red);                      // cylinder
    P.span(B, 0.11, 0.19, 0.07, 0.15, y + 0.92, 0.08, C.dark);                    // head
  }
  function shelfUnit(B, x, z, yaw, len, salt) {
    const r = B.furn("shelf", x, z, yaw, { len: len, deep: 0.45, h: 2.0 });
    // cartons on the four standing surfaces: plinth top + three boards
    const gap = (2.0 - 0.35) / 4;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);
    for (let k = 0; k < 4; k++) {
      const yb = B.fy + (k === 0 ? 0.30 : 0.30 + gap * k + 0.05);
      const hMax = k === 0 ? gap - 0.02 : gap - 0.1;
      let u = -len / 2 + 0.1;
      let i = 0;
      while (u < len / 2 - 0.3 && i < 5) {
        const h = B.h(x + u, z + k, salt + i);
        const w = 0.28 + h * 0.22, hh = Math.min(hMax, 0.2 + h * 0.18);
        if (u + w > len / 2 - 0.08) break;
        if (h < 0.82) {
          const cu = u + w / 2, cf = -0.02;
          const cx = x + lx * cu + fx * cf, cz = z + lz * cu + fz * cf;
          const sw = Math.abs(lx) > 0.5;
          box(B, cx, yb, cz, sw ? w : 0.34, hh, sw ? 0.34 : w, h < 0.4 ? C.carton : C.carton2);
          box(B, cx, yb + hh * 0.55, cz, sw ? w + 0.004 : 0.345, 0.03, sw ? 0.345 : w + 0.004, 0xd8c7a0);   // tape band
        }
        u += w + 0.05; i++;
      }
    }
    return r;
  }
  function mopBucket(B, x, z) {
    box(B, x, B.fy, z, 0.36, 0.32, 0.3, C.yellow);
    box(B, x + 0.1, B.fy + 0.32, z, 0.12, 0.1, 0.26, 0x9a8a3a);                   // wringer
    box(B, x - 0.06, B.fy + 0.1, z, 0.03, 1.25, 0.03, 0x8a6a3a);                  // handle
  }
  function stepladder(B, x, z, alongX) {
    const W = alongX ? function (a, b) { return [a, b]; } : function (a, b) { return [b, a]; };
    for (let s = -1; s <= 1; s += 2) {
      let d = W(s * 0.22, -0.22); box(B, x + d[0], B.fy, z + d[1], 0.04, 1.55, 0.05, C.chrome);
      d = W(s * 0.22, 0.28); box(B, x + d[0], B.fy, z + d[1], 0.04, 1.45, 0.05, C.chrome);
    }
    for (let i = 0; i < 4; i++) {
      const d = W(0, -0.2 + i * 0.02);
      const s = W(0.46, 0.1);
      box(B, x + d[0], B.fy + 0.32 + i * 0.36, z + d[1], s[0], 0.03, s[1], 0x9aa0a6);
    }
    const s2 = W(0.5, 0.56);
    box(B, x, B.fy + 1.55, z + 0, s2[0], 0.05, 0.3, 0xe0a33a);                    // top cap
  }

  // ---- the restroom pair ----------------------------------------------
  // Two rooms side by side in a corner, each a stall (partition, pilaster,
  // an ajar leaf, a WC) and a vanity with a mirror, doors side by side at
  // the divider. Returns the two room rects, or null.
  function restroomPair(B, occ, S, order, dark) {
    const RW = 1.95, RD = 2.3;
    const sides = sidesOf(S);
    for (let s = 0; s < order.length; s++) {
      const sd = sides[order[s].side];
      if (!sd) continue;
      const v0 = sd.open ? T : 0;
      const ends = order[s].ends || [0, 1];
      for (let e = 0; e < ends.length; e++) {
        const end = ends[e];
        const wallA = end === 0 ? sd.openA : true;
        const wallB = end === 0 ? true : sd.openB;
        const blockU = 2 * RW + T + (wallA ? T : 0) + (wallB ? T : 0);
        if (sd.len < blockU + 1.2) continue;
        const ua = end === 0 ? 0 : sd.len - blockU, ub = ua + blockU;
        const vF = v0 + RD + T;
        const R = sd.F.rect(ua, 0, ub, vF);
        const Rc = sd.F.rect(ua - 0.3, 0, ub + 0.3, vF + 1.1);   // walk-up clearance in front + round the end
        if (occ.hit(Rc) || !rectFree(B, null, R, 0.04)) continue;
        // the walk-up strip must be floor you can stand on (not the stairwell)
        if (!rectFree(B, null, sd.F.rect(ua, vF, ub, vF + 0.9), 0.02)) continue;
        occ.add(Rc);
        return buildRestrooms(B, sd.F, ua, ub, v0, RW, RD, wallA, wallB, sd.open, dark);
      }
    }
    return null;
  }
  function buildRestrooms(B, F, ua, ub, v0, RW, RD, wallA, wallB, openBack, dark) {
    const ia = ua + (wallA ? T : 0), ib = ub - (wallB ? T : 0);
    const vF = v0 + RD;                              // the front wall's inner face
    const y = B.fy;
    const wo = { tint: C.plaster, t: T };
    // front wall with the two doors, near the divider
    const dA = ia + RW - 0.55, dBc = ia + RW + T + 0.55;
    F.wallU(B, vF + T / 2, ua, ub, [{ c: dA, w: 0.85, h: 2.1 }, { c: dBc, w: 0.85, h: 2.1 }], wo);
    F.wallV(B, ia + RW + T / 2, v0, vF, null, wo);                    // divider
    if (wallA) F.wallV(B, ua + T / 2, 0, vF + T, null, wo);
    if (wallB) F.wallV(B, ub - T / 2, 0, vF + T, null, wo);
    if (openBack) F.wallU(B, T / 2, ua, ub, null, wo);                // the stairwell side
    const rooms = [];
    const doRoom = function (ru0, ru1, mir, doorU) {
      const us = function (s) { return mir > 0 ? ru0 + s : ru1 - s; };
      const sp = function (s0, s1, va, vb, yb, h, col, o) { F.span(B, us(s0), us(s1), va, vb, yb, h, col, o); };
      const R = F.rect(ru0, v0, ru1, vF);
      rooms.push(R);
      B.plane(R.x0, R.z0, R.x1, R.z1, y + 0.004, "tile", 0xffffff, { holes: [], cell: 0.8 });
      // wet wall tiled to 1.5 m (the back wall), skirting-free
      const alongX = Math.abs(F.ax) > 0.5;
      const back = F.at(0, v0);
      if (alongX) B.skin("x", back.z(0, 0), F.x(ru0, v0), F.x(ru1, v0), F.nz, { mat: "subway", h: 1.5, noSkirt: true, tint: 0xffffff });
      else B.skin("z", back.x(0, 0), F.z(ru0, v0), F.z(ru1, v0), F.nx, { mat: "subway", h: 1.5, noSkirt: true, tint: 0xffffff });
      // --- the stall: partition, pilaster, ajar leaf ---
      sp(0.985, 1.015, v0, v0 + 1.5, y + 0.15, 1.7, 0xc9ccc8);                 // side partition
      sp(0.0, 0.3, v0 + 1.485, v0 + 1.515, y + 0.15, 1.7, 0xc9ccc8);           // pilaster panel
      sp(0.28, 0.32, v0 + 1.485, v0 + 1.515, y, 2.0, C.chrome);                // pilaster post
      sp(0.3, 0.33, v0 + 0.86, v0 + 1.5, y + 0.15, 1.6, 0xb6bab6);              // the leaf, swung in
      // --- the WC ---
      sp(0.3, 0.7, v0 + 0.0, v0 + 0.18, y + 0.42, 0.36, C.porcelain);          // cistern
      sp(0.36, 0.64, v0 + 0.03, v0 + 0.15, y + 0.78, 0.03, 0xe2e2de);          // cistern lid
      sp(0.4, 0.6, v0 + 0.18, v0 + 0.5, y, 0.26, C.porcelain);                 // trap pedestal
      sp(0.33, 0.67, v0 + 0.18, v0 + 0.56, y + 0.26, 0.12, C.porcelain);       // bowl
      sp(0.36, 0.64, v0 + 0.56, v0 + 0.68, y + 0.26, 0.12, C.porcelain);       // its rounded front
      sp(0.32, 0.68, v0 + 0.2, v0 + 0.72, y + 0.38, 0.03, 0xfafaf6);           // seat
      sp(0.88, 0.98, v0 + 0.55, v0 + 0.66, y + 0.7, 0.1, C.chrome);            // roll holder
      sp(0.89, 0.97, v0 + 0.56, v0 + 0.65, y + 0.64, 0.1, C.paper);            // the roll
      // --- the vanity ---
      const s0 = 1.14, s1 = RW - 0.05;
      sp(s0, s1, v0, v0 + 0.5, y + 0.1, 0.72, 0xd9d6d0, { solid: true });      // cabinet
      sp(s0 + 0.03, s1 - 0.03, v0, v0 + 0.46, y, 0.1, 0x6a6f74);               // kick
      sp(s0 - 0.02, s1 + 0.0, v0, v0 + 0.53, y + 0.82, 0.04, C.stone);         // top
      const sc = (s0 + s1) / 2;
      sp(sc - 0.2, sc + 0.2, v0 + 0.12, v0 + 0.42, y + 0.858, 0.004, 0xa8b0b6); // basin
      sp(sc - 0.02, sc + 0.02, v0 + 0.04, v0 + 0.08, y + 0.86, 0.2, C.chrome);   // tap post
      sp(sc - 0.02, sc + 0.02, v0 + 0.04, v0 + 0.2, y + 1.04, 0.03, C.chrome);   // spout
      sp(s0 + 0.02, s1 - 0.02, v0 + 0.0, v0 + 0.02, y + 1.12, 0.78, C.mirror);   // mirror
      sp(s1 - 0.14, s1 - 0.04, v0 + 0.0, v0 + 0.08, y + 1.0, 0.16, C.white);     // soap
      // towel dispenser + bin on the divider/end wall beside the vanity
      sp(RW - 0.1, RW, v0 + 0.8, v0 + 1.1, y + 1.2, 0.36, C.white);
      sp(RW - 0.34, RW - 0.04, v0 + 0.8, v0 + 1.1, y, 0.5, 0x8a9098);
      // the room's door leaf, open flat to the hinge wall
      const hs = doorU(mir);
      sp(hs - 0.03, hs, vF - 0.8, vF, y + 0.02, 2.05, 0xd8d3c8);
      if (dark) B.box(F.x((ru0 + ru1) / 2, (v0 + vF) / 2), B.ceil - 0.035, F.z((ru0 + ru1) / 2, (v0 + vF) / 2), 0.34, 0.07, 0.34, 0xc9c6bc);
      else B.light(F.x((ru0 + ru1) / 2, (v0 + vF) / 2), F.z((ru0 + ru1) / 2, (v0 + vF) / 2), { kind: "dome", r: 3.2, i: 0.62, rect: R, color: 0xf6f8ff });
    };
    // room A: stall at the ua end, door near the divider (hinge on the divider side)
    doRoom(ia, ia + RW, 1, function () { return RW - 0.1; });
    doRoom(ia + RW + T, ib, -1, function () { return RW - 0.1; });
    return rooms;
  }
  // which walls a floor's restroom core tries, in order
  function restroomOrder(B, S) {
    const b = B.b, d = b.localDoor || null;
    const out = [];
    let away = "z1";
    if (d) { if (Math.abs(d.nx) > 0.5) away = d.nx > 0 ? "x1" : "x0"; else away = d.nz > 0 ? "z1" : "z0"; }
    const all = [away, "x0", "z1", "x1", "z0"];
    for (let i = 0; i < all.length; i++) {
      if (!out.some(function (o) { return o.side === all[i]; })) out.push({ side: all[i] });
    }
    return out;
  }

  // ---- shared office finishing -------------------------------------------
  // floor + ceiling + troffers for a whole plate. `rooms` are enclosed rooms
  // with their own light; `skip` vetoes troffer slots (pendants etc.).
  function officeShell(B, S, floorMat, floorTint, o) {
    o = o || {};
    const R = { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1 };
    floorPlane(B, R, floorMat, floorTint);
    if (o.ceiling !== false) floorPlane(B, R, o.ceilMat || "ceiling", o.ceilTint == null ? 0xffffff : o.ceilTint, 0, true);
    const mod = o.module || (B.h(1, 2, 0x51) < 0.5 ? 3.0 : 3.6);
    const rooms = o.rooms || [];
    return troffers(B, R, mod, function (x, z) {
      if (inAny(rooms, x, z, 0.35)) return true;
      if (o.skip && o.skip(x, z)) return true;
      return false;
    }, { r: o.lightR || 5.4, i: o.lightI || 0.5, kind: o.fixture || "panel" });
  }
  // the S rect with the raw x0 (the facade under the stairwell) remembered
  function shellFull(B) {
    const S = shellOf(B);
    const wt = S.wt;
    S.x0raw = -B.b.w / 2 + wt;
    return S;
  }
  function baseOcc(B, S) {
    // the stair core's landing mouth stays clear of every planner's ledger
    const occ = Occ();
    for (const r of (B.b.keepRects || [])) occ.add(grow(r, 0.1));
    return occ;
  }
  function officeExtras(B, S, occ, o) {
    o = o || {};
    // a copier station and a water cooler, against real walls
    if (o.copier !== false) { const P = wallSpot(B, occ, S, 1.65, 0.7, { tall: 1.0, salt: 3 }); if (P) copierStation(B, P); }
    if (o.cooler !== false) { const P = wallSpot(B, occ, S, 0.45, 0.45, { tall: 1.5, salt: 5, front: 0.7 }); if (P) waterCooler(B, P); }
    if (o.extinguisher !== false) { const P = wallSpot(B, occ, S, 0.3, 0.22, { salt: 7, front: 0.5 }); if (P) extinguisher(B, P); }
    // tall plants in the rect's corners
    const R = B.rect;
    if (R && o.plants !== false) {
      const cs = [[R.x0 + 0.35, R.z0 + 0.35], [R.x1 - 0.35, R.z0 + 0.35], [R.x0 + 0.35, R.z1 - 0.35], [R.x1 - 0.35, R.z1 - 0.35]];
      let n = 0;
      for (let i = 0; i < cs.length && n < (o.maxPlants || 4); i++) {
        const P = { x0: cs[i][0] - 0.33, x1: cs[i][0] + 0.33, z0: cs[i][1] - 0.33, z1: cs[i][1] + 0.33 };
        if (!rectFree(B, occ, P, 0.1)) continue;
        occ.add(P);
        plant(B, cs[i][0], cs[i][1], 1);
        n++;
      }
    }
  }

  // ---- the eager desk grid, recomputed (interior_programs.js progDeskFarm)
  const PITCH_X = 3.0, PITCH_Z = 2.6, DESK_CAP = 96;
  function gridCap(cols, rows, cap) {
    if (cols * rows <= cap) return [cols, rows];
    const s = Math.sqrt(cap / (cols * rows));
    return [Math.max(1, Math.floor(cols * s)), Math.max(1, Math.floor(rows * s))];
  }
  function deskGrid(B) {
    const r = B.rect, out = [];
    if (!r) return out;
    const spanX = (r.x1 - r.x0) - 2.0, spanZ = (r.z1 - r.z0) - 2.8;
    if (spanX < 0.5 || spanZ < 0.5) return out;
    const cap = gridCap(Math.max(1, 1 + Math.floor(spanX / PITCH_X)), Math.max(1, 1 + Math.floor(spanZ / PITCH_Z)), DESK_CAP);
    const cols = cap[0], rows = cap[1];
    const gx0 = (r.x0 + r.x1) / 2 - ((cols - 1) * PITCH_X) / 2;
    const gz0 = (r.z0 + r.z1) / 2 - ((rows - 1) * PITCH_Z) / 2 - 0.3;
    for (let c = 0; c < cols; c++) for (let w = 0; w < rows; w++) {
      const dx = gx0 + c * PITCH_X, dz = gz0 + w * PITCH_Z;
      if (!B.clear(dx, dz + 0.85, 0.6) || !B.clear(dx, dz, 0.7)) continue;
      out.push({ x: dx, z: dz, c: c, w: w });
    }
    return out;
  }
  // the floor level the EAGER program authored its boxes from (ground
  // programs were dressed from y = 0, upper floors from the slab top)
  function eagerY(B) { return (B.rect && B.rect.y != null) ? B.rect.y : (B.k === 0 ? 0 : B.y0); }

  function deskClutter(B, d, top, lampsLeft) {
    const x = d.x, z = d.z, eY = top - 0.76;
    // what the eager bench desk leaves to the walk-in: a mobile drawer
    // pedestal under the right of the top, a fabric screen clamped to the
    // back edge with an aluminium cap, and the task chair's arms
    box(B, x + 0.52, eY + 0.03, z + 0.06, 0.42, 0.58, 0.52, 0x4a5260);
    for (let i = 0; i < 3; i++) box(B, x + 0.52, eY + 0.1 + i * 0.19, z + 0.326, 0.38, 0.17, 0.012, 0x565e6c);
    for (let i = 0; i < 3; i++) box(B, x + 0.52, eY + 0.22 + i * 0.19, z + 0.337, 0.12, 0.015, 0.012, 0xb9bec4);
    box(B, x, top, z - 0.44, 1.6, 0.42, 0.03, hashPick(B, [0x5b6571, 0x6b6f63, 0x4f5b66], d.c | 0, 1, 0xd9));
    box(B, x, top + 0.42, z - 0.44, 1.61, 0.012, 0.036, 0xc5c9cc);
    for (const a of [-1, 1]) {
      box(B, x + a * 0.27, eY + 0.48, z + 0.9, 0.03, 0.17, 0.03, C.dark);
      box(B, x + a * 0.27, eY + 0.65, z + 0.86, 0.05, 0.03, 0.26, C.dark);
    }
    box(B, x, top, z + 0.12, 0.44, 0.022, 0.15, 0x2a2d31);                         // keyboard
    box(B, x, top + 0.022, z + 0.125, 0.41, 0.003, 0.12, 0x3c4046);                  // its keys
    box(B, x + 0.34, top, z + 0.14, 0.06, 0.03, 0.1, 0x2a2d31);                    // mouse
    const h1 = B.h(x, z, 0xd1), h2 = B.h(x, z, 0xd2), h3 = B.h(x, z, 0xd3);
    if (h1 < 0.7) {                                                                // a mug
      const mc = hashPick(B, [0xf2f1ec, 0xb3342e, 0x3a6ea5, 0x2f2f33, 0xe8c23a], x, z, 0xd4);
      box(B, x + 0.55, top, z + 0.25, 0.08, 0.1, 0.08, mc);
    }
    if (h2 < 0.55) {                                                               // paper and a folder
      box(B, x - 0.5, top, z + 0.05, 0.3, 0.02 + h2 * 0.1, 0.22, C.paper);
      box(B, x - 0.48, top + 0.02 + h2 * 0.1, z + 0.06, 0.31, 0.012, 0.23, 0xd9b86a);
    }
    if (h3 < 0.4) {                                                                // a desk phone
      box(B, x - 0.55, top, z - 0.25, 0.2, 0.05, 0.18, 0x2f3338);
      box(B, x - 0.6, top + 0.05, z - 0.25, 0.06, 0.035, 0.18, 0x24272c);
    }
    if (h3 > 0.75 && lampsLeft.n > 0) {                                            // a task lamp, lit
      lampsLeft.n--;
      box(B, x + 0.6, top, z - 0.3, 0.14, 0.02, 0.14, C.dark);
      box(B, x + 0.6, top + 0.02, z - 0.3, 0.02, 0.36, 0.02, C.dark);
      box(B, x + 0.6, top + 0.34, z - 0.22, 0.03, 0.03, 0.18, C.dark);
      box(B, x + 0.6, top + 0.3, z - 0.14, 0.14, 0.06, 0.1, C.dark);
      box(B, x + 0.6, top + 0.295, z - 0.14, 0.1, 0.006, 0.07, C.glowWarm, { glow: true });
      B.lamp(x + 0.6, top + 0.28, z - 0.14, { r: 1.6, i: 0.3 });
    } else if (h1 > 0.85) {                                                        // a small succulent
      box(B, x + 0.62, top, z - 0.3, 0.1, 0.09, 0.1, 0xc9b8a0);
      box(B, x + 0.62, top + 0.09, z - 0.3, 0.12, 0.08, 0.12, C.leaf2);
    }
  }

  /* ========================================================================
     OFFICE PLANNERS
     ======================================================================== */
  function planDeskFarm(B) {
    if (!B.rect) return;
    const S = shellFull(B), occ = baseOcc(B, S);
    const desks = deskGrid(B);
    for (let i = 0; i < desks.length; i++) {
      const d = desks[i];
      occ.add({ x0: d.x - 0.81 - 0.7, x1: d.x + 0.81 + 0.7, z0: d.z - 0.5 - 0.7, z1: d.z + 1.2 + 0.7 });
    }
    const rooms = restroomPair(B, occ, S, restroomOrder(B, S)) || [];
    officeShell(B, S, "carpet", hashPick(B, [0xffffff, 0xd8dde6, 0xe6e0d6], 3, 4, 0x61), { rooms: rooms });
    const top = eagerY(B) + 0.76;
    const lamps = { n: 8 };
    for (let i = 0; i < desks.length; i++) deskClutter(B, desks[i], top, lamps);
    officeExtras(B, S, occ);
    blinds(B, S, 0xcfd2d0);
  }

  function planMeeting(B) {
    if (!B.rect) return;
    const r = B.rect, S = shellFull(B), occ = baseOcc(B, S);
    const opts = (B.info && B.info.opts) || null;
    const din = (opts && opts.door) || { x: (r.x0 + r.x1) / 2, z: r.z0, nx: 0, nz: 1 };
    const alongX = Math.abs(din.nx) > 0.5;
    let room = null;
    if (!alongX) {
      const zc = (r.z0 + r.z1) / 2;
      room = din.nz > 0 ? { x0: r.x0, x1: r.x1, z0: zc, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: r.z0, z1: zc };
      if (room.z1 - room.z0 < 3.4) room = null;
    } else {
      const xc = (r.x0 + r.x1) / 2;
      room = din.nx > 0 ? { x0: xc, x1: r.x1, z0: r.z0, z1: r.z1 } : { x0: r.x0, x1: xc, z0: r.z0, z1: r.z1 };
      if (room.x1 - room.x0 < 3.4) room = null;
    }
    let table = null;
    if (room) {
      const mx = (room.x0 + room.x1) / 2, mz = (room.z0 + room.z1) / 2;
      if (B.clear(mx, mz, 1.0)) {
        const tanSpan = alongX ? (room.z1 - room.z0) : (room.x1 - room.x0);
        const TL = Math.max(2.2, Math.min(4.6, tanSpan - 3.0));
        table = { x: mx, z: mz, TL: TL };
        const ha = TL / 2 + 0.75 + 0.35, hd = 1.05 + 0.4;
        occ.add(alongX ? { x0: mx - hd - 0.5, x1: mx + hd + 0.5, z0: mz - ha - 0.5, z1: mz + ha + 0.5 }
                       : { x0: mx - ha - 0.5, x1: mx + ha + 0.5, z0: mz - hd - 0.5, z1: mz + hd + 0.5 });
      }
    }
    const rooms = restroomPair(B, occ, S, restroomOrder(B, S)) || [];
    const pend = [];
    if (table) {
      const drop = pendantDrop(B, 2.05);
      for (let i = -1; i <= 1; i++) {
        const off = i * table.TL / 3;
        const x = alongX ? table.x : table.x + off, z = alongX ? table.z + off : table.z;
        B.light(x, z, { kind: "pendant", drop: drop, r: 4.2, i: 0.55, shade: 0x2b2e33 });
        pend.push({ x: x, z: z });
      }
    }
    officeShell(B, S, "carpet", 0xcfd6e2, {
      rooms: rooms,
      skip: function (x, z) { for (let i = 0; i < pend.length; i++) if (Math.abs(x - pend[i].x) < 1.4 && Math.abs(z - pend[i].z) < 1.4) return true; return false; },
    });
    if (table && room) {
      // the far wall (the screen's wall) and the room's two side walls
      const sides = sidesOf(S);
      const farName = alongX ? (din.nx > 0 ? "x1" : "x0") : (din.nz > 0 ? "z1" : "z0");
      const far = sides[farName];
      if (far && !far.open) {
        // credenza under the screen, centred on the table's axis
        const cu = alongX ? (far.F.az * (table.z - far.F.oz)) : (far.F.ax * (table.x - far.F.ox));
        const L = Math.min(2.0, table.TL);
        const P = far.F.at(cu - L / 2, 0);
        const R = far.F.rect(cu - L / 2, 0, cu + L / 2, 0.46);
        if (rectFree(B, null, R, 0.04) && !winHit(B, far.F, cu - L / 2, cu + L / 2, B.fy, B.fy + 0.8)) {
          B.furn("credenza", P.x(L / 2, 0.245), P.z(L / 2, 0.245), P.yaw(0, 1), { len: L, h: 0.74, deep: 0.47, tone: { wood: C.walnut } });
          P.span(B, 0.2, 0.5, 0.1, 0.34, B.fy + 0.74, 0.06, C.paper);                  // a stack of handouts
          P.span(B, L - 0.38, L - 0.27, 0.16, 0.27, B.fy + 0.74, 0.22, 0xcfd6dc, { glass: true });   // a water carafe
          P.span(B, L - 0.37, L - 0.28, 0.17, 0.26, B.fy + 0.74, 0.13, 0x9cc8e6);        // the water in it
          occ.add(R);
        }
      }
      // whiteboard on a side wall of the room, plant in the other far corner
      const sideNames = alongX ? ["z0", "z1"] : ["x0", "x1"];
      let wbSide = null;
      for (let i = 0; i < 2 && !wbSide; i++) {
        const sd = sides[sideNames[(i + (B.h(2, 9, 0x77) < 0.5 ? 0 : 1)) % 2]];
        if (!sd || sd.open) continue;
        const cu = alongX ? (sd.F.ax * (table.x - sd.F.ox)) : (sd.F.az * (table.z - sd.F.oz));
        if (winHit(B, sd.F, cu - 0.95, cu + 0.95, B.fy + 0.85, B.fy + 2.15)) continue;
        if (!rectFree(B, null, sd.F.rect(cu - 0.95, 0, cu + 0.95, 0.12), 0.04)) continue;
        const P = sd.F.at(cu - 0.95, 0);
        P.span(B, 0, 1.9, 0, 0.03, B.fy + 0.88, 1.24, 0xa9adb2);                       // frame
        P.span(B, 0.03, 1.87, 0.03, 0.035, B.fy + 0.91, 1.18, 0xfbfbf8);               // the board (blank)
        P.span(B, 0.2, 1.7, 0.03, 0.1, B.fy + 0.86, 0.03, 0xa9adb2);                   // tray
        P.span(B, 0.5, 0.64, 0.05, 0.08, B.fy + 0.89, 0.02, 0x2a4f9a);                 // markers
        P.span(B, 0.7, 0.84, 0.05, 0.08, B.fy + 0.89, 0.02, 0xb3342e);
        P.span(B, 1.3, 1.45, 0.04, 0.09, B.fy + 0.89, 0.04, 0x3a3a3c);                 // eraser
        wbSide = sd;
      }
      const R2 = room;
      const px = alongX ? (din.nx > 0 ? R2.x1 - 0.35 : R2.x0 + 0.35) : (B.h(4, 1, 0x78) < 0.5 ? R2.x0 + 0.35 : R2.x1 - 0.35);
      const pz = alongX ? (B.h(4, 1, 0x78) < 0.5 ? R2.z0 + 0.35 : R2.z1 - 0.35) : (din.nz > 0 ? R2.z1 - 0.35 : R2.z0 + 0.35);
      const PR = { x0: px - 0.33, x1: px + 0.33, z0: pz - 0.33, z1: pz + 0.33 };
      if (rectFree(B, occ, PR, 0.1)) { occ.add(PR); plant(B, px, pz, 1); }
    }
    officeExtras(B, S, occ, { copier: false, plants: true, maxPlants: 2 });
    blinds(B, S, 0xcfd2d0);
  }

  function planLobby(B) {
    if (!B.rect) return;
    const r = B.rect, S = shellFull(B), occ = baseOcc(B, S);
    const opts = (B.info && B.info.opts) || null;
    const din = (opts && opts.door && opts.door.nx != null) ? opts.door : B.b.localDoor;
    const pend = [];
    let A = null;
    if (din) {
      const nx = din.nx, nz = din.nz;
      A = Frame(din.x, din.z, -nz, nx, nx, nz);             // u = lateral, v = in from the door
      const along = Math.abs(nx) > 0.5;
      const depth = along ? (r.x1 - r.x0) : (r.z1 - r.z0);
      const dIn = Math.min(6.0, Math.max(5.2, depth * 0.45));
      const pd = { x: A.x(0, dIn), z: A.z(0, dIn) };
      const deskLanded = inRect(r, pd.x, pd.z, 1.2) && B.clear(pd.x, pd.z, 0.9);
      // what the eager lobby stands: desk + chair + band, the bench, the planters
      if (deskLanded) occ.add(A.rect(-1.8, dIn - 0.8, 1.8, dIn + 2.1));
      const benchD = Math.min(dIn - 0.6, 4.6);
      occ.add(A.rect(-3.1 - 0.9, benchD - 1.4, -3.1 + 0.9, benchD + 1.4));
      for (let s = -1; s <= 1; s += 2) occ.add(A.rect(s * 2.6 - 0.5, 1.5, s * 2.6 + 0.5, 2.5));
      occ.add(A.rect(-1.0, -0.5, 1.0, 5.0));                // the walk to the desk
      // entrance mat, flat, in the aisle
      box(B, A.x(0, 1.3), B.fy, A.z(0, 1.3), along ? 1.4 : 2.0, 0.012, along ? 2.0 : 1.4, 0x2b2d31);
      if (deskLanded) {
        // THE FEATURE WALL behind reception: the lit band now hangs on something
        // the eager lobby stands the wall (with its lit band); this is its
        // timber veneer, 4 mm proud of it, and a shadow-line skirting
        if (B.info && B.info.featureWall) {
          A.span(B, -1.905, 1.905, dIn + 1.796, dIn + 1.8, B.fy, B.ceil - B.fy - 0.012, C.walnut, { mat: "wood" });
          A.span(B, -1.91, 1.91, dIn + 1.78, dIn + 1.796, B.fy, 0.1, C.dark);
        }
        // three pendants over the desk
        const drop = pendantDrop(B, 2.2);
        for (let i = -1; i <= 1; i++) {
          const x = A.x(i * 0.9, dIn), z = A.z(i * 0.9, dIn);
          B.light(x, z, { kind: "pendant", drop: drop, r: 4.0, i: 0.6, shade: 0xc9a54a });
          pend.push({ x: x, z: z });
        }
        // planters flanking the feature wall
        for (let s = -1; s <= 1; s += 2) {
          const px = A.x(s * 2.5, dIn + 1.6), pz = A.z(s * 2.5, dIn + 1.6);
          const PR = { x0: px - 0.33, x1: px + 0.33, z0: pz - 0.33, z1: pz + 0.33 };
          if (inRect(r, px, pz, 0.35) && rectFree(B, occ, PR, 0.05)) { occ.add(PR); plant(B, px, pz, 1.1); }
        }
      }
      // THE SEATING GROUP opposite the waiting bench: two armchairs and a side table
      const sy = Math.atan2(-A.ax, -A.az);                    // facing across the walk (-lateral)
      const sg = A.rect(2.8, benchD - 1.2, 3.8, benchD + 1.2);
      if (inRect(r, A.x(3.3, benchD), A.z(3.3, benchD), 0.7) && rectFree(B, occ, sg, 0.1)) {
        occ.add(sg);
        B.furn("armchair", A.x(3.3, benchD - 0.75), A.z(3.3, benchD - 0.75), sy, { tone: "exec" });
        B.furn("armchair", A.x(3.3, benchD + 0.75), A.z(3.3, benchD + 0.75), sy, { tone: "exec" });
        // a pedestal side table between them: disc foot, stem, top
        const tx = A.x(3.35, benchD), tz = A.z(3.35, benchD);
        box(B, tx, B.fy, tz, 0.36, 0.02, 0.36, C.dark);
        box(B, tx, B.fy + 0.02, tz, 0.05, 0.5, 0.05, C.dark);
        box(B, tx, B.fy + 0.52, tz, 0.5, 0.03, 0.5, C.walnut);
        box(B, tx, B.fy + 0.55, tz, 0.26, 0.02, 0.2, C.paper);                    // magazines
        box(B, tx + 0.02, B.fy + 0.57, tz + 0.01, 0.24, 0.012, 0.19, 0x7a2e2e);
      }
      // THE DIRECTORY: a plain dark panel on the side wall by the door
      const sides = sidesOf(S);
      for (let s = 1; s >= -1; s -= 2) {
        // the side face the +/- lateral direction runs into
        const dx = -nz * s, dz = nx * s;
        const name = Math.abs(dx) > 0.5 ? (dx > 0 ? "x1" : "x0") : (dz > 0 ? "z1" : "z0");
        const sd = sides[name];
        if (!sd || sd.open) continue;
        // where the door's approach line (v = 2.3..3.5 in) meets that wall
        const pu0 = (A.x(0, 2.3) - sd.F.ox) * sd.F.ax + (A.z(0, 2.3) - sd.F.oz) * sd.F.az;
        const pu1 = (A.x(0, 3.5) - sd.F.ox) * sd.F.ax + (A.z(0, 3.5) - sd.F.oz) * sd.F.az;
        const u0 = Math.min(pu0, pu1), u1 = Math.max(pu0, pu1);
        if (u0 < 0.2 || u1 > sd.len - 0.2) continue;
        if (winHit(B, sd.F, u0, u1, B.fy + 1.0, B.fy + 2.3)) continue;
        if (occ.hit(sd.F.rect(u0, 0, u1, 0.6))) continue;
        const P = sd.F.at(u0, 0);
        P.span(B, 0, u1 - u0, 0, 0.04, B.fy + 1.05, 1.3, 0x9aa0a6);
        P.span(B, 0.04, u1 - u0 - 0.04, 0.04, 0.05, B.fy + 1.09, 1.22, 0x14171c);
        P.span(B, 0.1, u1 - u0 - 0.1, 0.05, 0.055, B.fy + 2.2, 0.03, C.glowWhite, { glow: true });
        break;
      }
    }
    const rooms = restroomPair(B, occ, S, restroomOrder(B, S)) || [];
    wallTV(B, occ, S, 1.2, 1.95, 11);                       // the waiting area's TV
    officeShell(B, S, "terrazzo", 0xffffff, {
      rooms: rooms, ceilMat: "plaster", ceilTint: 0xf4f2ee, fixture: "can", module: 2.4, lightR: 4.2, lightI: 0.5,
      skip: function (x, z) { for (let i = 0; i < pend.length; i++) if (Math.abs(x - pend[i].x) < 1.6 && Math.abs(z - pend[i].z) < 1.6) return true; return false; },
    });
    officeExtras(B, S, occ, { copier: false, cooler: false, plants: true, maxPlants: 2 });
  }

  function planBreakroom(B) {
    if (!B.rect) return;
    const r = B.rect, S = shellFull(B), occ = baseOcc(B, S);
    const opts = (B.info && B.info.opts) || null;
    const din = (opts && opts.door && opts.door.nx != null) ? opts.door : { x: (r.x0 + r.x1) / 2, z: r.z0, nx: 0, nz: 1 };
    const nx = din.nx, nz = din.nz, tx = -nz, tz = nx;
    const along = Math.abs(nx) > 0.5;
    const inset = Math.max(0, (opts && opts.inset) || 0);
    const ctr = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
    const ax = (along ? (nx > 0 ? r.x0 : r.x1) : ctr.x) + nx * inset;
    const az = (along ? ctr.z : (nz > 0 ? r.z0 : r.z1)) + nz * inset;
    const A = Frame(ax, az, tx, tz, nx, nz);                          // u = lat, v = in
    const depth = (along ? (r.x1 - r.x0) : (r.z1 - r.z0)) - inset;
    const span = along ? (r.z1 - r.z0) : (r.x1 - r.x0);
    // what roombuild/the degrade path stand: the counter on the far wall,
    // the table in the middle, a shelf on a side wall, the vending corner
    occ.add(A.rect(-1.75, depth - 1.9, 1.75, depth + 0.5));
    occ.add(A.rect(-1.9, depth * 0.48 - 1.9, 1.9, depth * 0.48 + 1.9));
    occ.add(A.rect(span / 2 - 2.2, depth - 1.8, span / 2 + 0.5, depth + 0.5));
    for (let s = -1; s <= 1; s += 2) occ.add(A.rect(s * span / 2 - 0.9, depth / 2 - 2.0, s * span / 2 + 0.9, depth / 2 + 2.6));
    occ.add(A.rect(-1.0, -0.6, 1.0, 2.0));                            // the way in
    // THE KITCHENETTE on the far wall, on the -lateral side of the counter
    const sides = sidesOf(S);
    const farName = along ? (nx > 0 ? "x1" : "x0") : (nz > 0 ? "z1" : "z0");
    const far = sides[farName];
    if (far && !far.open) {
      // distances from the arrival origin to the far face (+n) and to the
      // -lateral face (-t); the stair edge is not a wall to hang a kitchen on
      const farV = Math.abs(along ? (nx > 0 ? S.x1 : S.x0) - ax : (nz > 0 ? S.z1 : S.z0) - az);
      const negX = Math.abs(tx) > 0.5;
      const negFace = negX ? (-tx > 0 ? S.x1 : S.x0) : (-tz > 0 ? S.z1 : S.z0);
      const latNeg = Math.abs(negFace - (negX ? ax : az));
      // the kitchen's own frame: origin in that corner on the far wall, u
      // running along +t toward the counter, v back into the room
      const K = Frame(A.x(-latNeg, farV), A.z(-latNeg, farV), tx, tz, -nx, -nz);
      const kStart = 0;
      const Lk = (latNeg - 1.75) - kStart;
      if (Lk >= 1.55) {
        const u0 = kStart;
        const R = K.rect(u0, 0, u0 + Lk, 0.72);
        const winLow = winHit(B, K, u0, u0 + Lk, B.fy + 0.9, B.fy + 2.2);
        if (rectFree(B, null, R, 0.04)) {
          const y = B.fy;
          const fridge = !winHit(B, K, u0, u0 + 0.74, B.fy, B.fy + 1.9);
          let u = u0;
          if (fridge) {
            K.span(B, u + 0.02, u + 0.72, 0, 0.68, y, 1.85, 0xdadcdc, { solid: true });
            K.span(B, u + 0.04, u + 0.7, 0.68, 0.7, y + 1.2, 0.62, 0xe6e8e8);        // freezer door
            K.span(B, u + 0.04, u + 0.7, 0.68, 0.7, y + 0.04, 1.14, 0xe6e8e8);       // fridge door
            K.span(B, u + 0.62, u + 0.66, 0.7, 0.74, y + 0.7, 0.36, C.chrome);       // handles
            K.span(B, u + 0.62, u + 0.66, 0.7, 0.74, y + 1.3, 0.3, C.chrome);
            u += 0.74;
          }
          const ue = u0 + Lk;
          if (ue - u >= 0.8) {
            K.span(B, u, ue, 0, 0.58, y + 0.1, 0.76, 0xe8e4dc, { solid: true });      // base run
            K.span(B, u + 0.02, ue - 0.02, 0, 0.54, y, 0.1, 0x5a5f64);               // kick
            K.span(B, u - 0.01, ue, 0, 0.62, y + 0.86, 0.04, 0x8f8a80);              // worktop
            for (let d = u + 0.6; d < ue - 0.1; d += 0.6) K.span(B, d - 0.004, d + 0.004, 0.58, 0.585, y + 0.14, 0.68, 0xb8b4ac);
            // sink next to the fridge
            const sk = u + 0.45;
            K.span(B, sk - 0.25, sk + 0.25, 0.1, 0.5, y + 0.898, 0.004, 0x9ea6ac);
            K.span(B, sk - 0.02, sk + 0.02, 0.04, 0.08, y + 0.9, 0.28, C.chrome);
            K.span(B, sk - 0.02, sk + 0.02, 0.04, 0.26, y + 1.16, 0.03, C.chrome);
            // backsplash + wall cabinets, unless a window is there
            if (!winLow) {
              K.span(B, u, ue, 0, 0.01, y + 0.9, 0.55, 0xffffff, { mat: "subway" });
              K.span(B, u, ue, 0, 0.34, y + 1.45, 0.7, 0xe8e4dc);
              for (let d = u + 0.6; d < ue - 0.1; d += 0.6) K.span(B, d - 0.004, d + 0.004, 0.34, 0.345, y + 1.47, 0.66, 0xb8b4ac);
            }
            // microwave + coffee machine at the far end of the run
            if (ue - u >= 1.5) {
              K.span(B, ue - 0.58, ue - 0.06, 0.06, 0.42, y + 0.9, 0.3, 0x2a2d31);
              K.span(B, ue - 0.56, ue - 0.2, 0.42, 0.43, y + 0.93, 0.24, 0x14171c);
              K.span(B, ue - 0.17, ue - 0.09, 0.42, 0.43, y + 1.12, 0.03, 0x7cf0a0, { glow: true });
            }
            if (ue - u >= 2.1) {
              const cm = ue - 0.95;
              K.span(B, cm - 0.14, cm + 0.14, 0.08, 0.42, y + 0.9, 0.4, 0x1c1e22);
              K.span(B, cm - 0.1, cm + 0.1, 0.3, 0.44, y + 0.9, 0.02, 0x4a4d52);
              K.span(B, cm - 0.04, cm + 0.04, 0.33, 0.41, y + 0.92, 0.09, C.white);   // the cup
              K.span(B, cm - 0.12, cm + 0.12, 0.1, 0.3, y + 1.3, 0.06, 0x4a3020);     // bean hopper
            }
          }
          occ.add(K.rect(u0, 0, u0 + Lk, 1.4));
        }
      }
    }
    const rooms = restroomPair(B, occ, S, restroomOrder(B, S)) || [];
    wallTV(B, occ, S, 1.0, 1.75, 7);                        // the news over lunch
    officeShell(B, S, "vinyl", 0xf0ece4, { rooms: rooms, module: 3.0 });
    officeExtras(B, S, occ, { copier: false, cooler: false, plants: true, maxPlants: 2 });
    blinds(B, S, 0xd6d0c4);
  }

  function planStorage(B) {
    if (!B.rect) return;
    const r = B.rect, S = shellFull(B), occ = baseOcc(B, S);
    const RACK_PITCH = 2.6, RACK_SEG = 2.2, RACK_GAP = 0.5, RACK_CAP = 80;   // == interior_programs.js progStorage
    const spanX = (r.x1 - r.x0) - 2.0;
    const aisles = [];
    let zLo = r.z0 + 1.2, zHi = r.z1 - 1.0;
    if (spanX >= 0.5) {
      const segs = Math.max(1, Math.floor(((r.z1 - 1.0) - (r.z0 + 1.2)) / (RACK_SEG + RACK_GAP)) + 1);
      const runs = gridCap(Math.max(1, 1 + Math.floor(spanX / RACK_PITCH)), segs, RACK_CAP)[0];
      const zEnd = r.z0 + 1.2 + Math.min(segs, Math.ceil(RACK_CAP / runs)) * (RACK_SEG + RACK_GAP);
      zHi = Math.min(zHi, zEnd);
      const rx0 = (r.x0 + r.x1) / 2 - ((runs - 1) * RACK_PITCH) / 2;
      occ.add({ x0: rx0 - 0.33 - 0.9, x1: rx0 + (runs - 1) * RACK_PITCH + 0.33 + 0.9, z0: zLo - 0.6, z1: zHi + 0.6 });
      for (let i = 0; i + 1 < runs; i++) aisles.push(rx0 + (i + 0.5) * RACK_PITCH);
      if (runs >= 1) { aisles.push(rx0 - RACK_PITCH / 2); aisles.push(rx0 + (runs - 0.5) * RACK_PITCH); }
    }
    const rooms = restroomPair(B, occ, S, restroomOrder(B, S)) || [];
    floorPlane(B, { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1 }, B.h(5, 5, 0x5a) < 0.5 ? "concrete" : "vinyl", 0xd4d2cc);
    floorPlane(B, { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1 }, "plaster", 0xd9d9d5, 0, true);   // painted slab soffit
    // STOCK THE RACKS (interior_programs.js draws them open: four uprights,
    // five decks at 0.10 + 0.52 k). Archive cartons on the lower four decks,
    // gaps where somebody pulled one, the same grid the eager pass walked.
    if (spanX >= 0.5) {
      const eY = eagerY(B);
      const segs = Math.max(1, Math.floor(((r.z1 - 1.0) - (r.z0 + 1.2)) / (RACK_SEG + RACK_GAP)) + 1);
      const runs = gridCap(Math.max(1, 1 + Math.floor(spanX / RACK_PITCH)), segs, RACK_CAP)[0];
      const zEnd = r.z0 + 1.2 + Math.min(segs, Math.ceil(RACK_CAP / runs)) * (RACK_SEG + RACK_GAP);
      const rx0 = (r.x0 + r.x1) / 2 - ((runs - 1) * RACK_PITCH) / 2;
      const CART = [C.carton, C.carton2, 0xe6dcc4, 0xd8ccb0];
      for (let i = 0; i < runs; i++) {
        const x = rx0 + i * RACK_PITCH;
        for (let z = r.z0 + 1.2; z + RACK_SEG <= Math.min(r.z1 - 1.0, zEnd); z += RACK_SEG + RACK_GAP) {
          const zc = z + RACK_SEG / 2;
          if (!B.clear(x, zc, 0.8)) continue;
          for (let lv = 0; lv < 4; lv++) {
            const yb = eY + 0.1 + lv * 0.52 + 0.015;
            let u = -RACK_SEG / 2 + 0.08, q = 0;
            while (u < RACK_SEG / 2 - 0.4 && q < 7) {
              const hv = B.h(x + u * 3.1, zc + lv * 1.7, 0x5a1 + q);
              const w = 0.3 + hv * 0.08;
              if (hv > 0.18) {
                const hh = 0.26 + (hv * 7.3 % 1) * 0.1;
                box(B, x, yb, z + RACK_SEG / 2 + u + w / 2, 0.42, hh, w, CART[(hv * 13.7 | 0) % CART.length]);
                box(B, x, yb + hh, z + RACK_SEG / 2 + u + w / 2, 0.43, 0.012, w + 0.006, 0xcfc2a6);   // the lid
              }
              u += w + 0.03; q++;
            }
          }
        }
      }
    }
    // battens down the aisles (a store room is lit where you walk)
    let n = 0;
    for (let i = 0; i < aisles.length; i++) {
      const x = aisles[i];
      if (x < S.x0 + 0.3 || x > S.x1 - 0.3) continue;
      for (let z = zLo + 0.6; z <= zHi - 0.4 && n < 60; z += 2.4) {
        if (inHole(B, x, z, 0.3) || inAny(rooms, x, z, 0.3)) continue;
        if (n & 1) fixtureOnly(B, x, z, { kind: "strip", axis: "z", len: 1.5 });
        else B.light(x, z, { kind: "strip", axis: "z", len: 1.5, r: 6.0, i: 0.6 });
        n++;
      }
    }
    // the cross aisles at both ends get a line too
    troffers(B, { x0: S.x0, x1: S.x1, z0: S.z0, z1: Math.max(S.z0 + 0.5, zLo - 0.2) }, 3.2,
      function (x, z) { return inAny(rooms, x, z, 0.35); }, { kind: "strip", len: 1.2, r: 4.4, i: 0.5 });
    troffers(B, { x0: S.x0, x1: S.x1, z0: Math.min(S.z1 - 0.5, zHi + 0.2), z1: S.z1 }, 3.2,
      function (x, z) { return inAny(rooms, x, z, 0.35); }, { kind: "strip", len: 1.2, r: 4.4, i: 0.5 });
    // a trolley of archive boxes and a kick stool, where the floor is free
    const t = floorSpot(B, occ, r, 1.0, 0.6, (r.x0 + r.x1) / 2, r.z0 + 0.6, 0.3);
    if (t) {
      box(B, t.x, B.fy + 0.08, t.z, 0.95, 0.04, 0.55, 0x3a6ea5);
      for (let s = -1; s <= 1; s += 2) for (let q = -1; q <= 1; q += 2) box(B, t.x + s * 0.4, B.fy, t.z + q * 0.2, 0.08, 0.08, 0.08, C.dark);
      box(B, t.x + 0.45, B.fy + 0.12, t.z, 0.03, 0.85, 0.5, 0x2f5a88);       // push handle
      for (let i = 0; i < 3; i++) box(B, t.x - 0.25 + (i % 2) * 0.4, B.fy + 0.12 + (i > 1 ? 0.3 : 0), t.z, 0.38, 0.3, 0.3, 0xe6dcc4);
    }
    const ks = floorSpot(B, occ, r, 0.45, 0.45, r.x1 - 0.8, r.z0 + 0.6, 0.2);
    if (ks) { box(B, ks.x, B.fy, ks.z, 0.42, 0.4, 0.42, C.charcoal); box(B, ks.x, B.fy + 0.4, ks.z, 0.36, 0.03, 0.36, C.rubber); }
    officeExtras(B, S, occ, { copier: false, cooler: false, plants: false });
  }

  // THE EMPTY FLOOR — shell and core, to let. The eager program already
  // rolled its variant (bare / renovation / moveout / afterhours, and the
  // dark storey); the same hashes are re-read here so the fit-out agrees.
  const EMPTY_KINDS = ["bare", "renovation", "moveout", "afterhours"];
  const EMPTY_CUM = [0.42, 0.66, 0.85, 1.01];
  function emptyRead(B) {
    const ox = B.ox, oz = B.oz, k = B.k;
    let kind = "bare";
    if (CBZ.CONFIG && CBZ.CONFIG.INTERIOR_EMPTY_VARIETY === false || !CBZ.hash01) kind = "bare";
    else { const v = CBZ.hash01(ox, oz, 0x0E11); for (let i = 0; i < EMPTY_CUM.length; i++) if (v < EMPTY_CUM[i]) { kind = EMPTY_KINDS[i]; break; } }
    const dark = kind !== "bare" && k > 0 && CBZ.hash01 && CBZ.hash01(ox + k * 13.7, oz - k * 7.1, 0x0E12) < 0.18;
    return { kind: kind, dark: !!dark };
  }
  function planEmpty(B) {
    if (!B.rect) return;
    const r = B.rect, S = shellFull(B), occ = baseOcc(B, S);
    const E = emptyRead(B);
    // the eager variant's props sit round this point: keep clear of it
    if (E.kind !== "bare") {
      const j = CBZ.hash01 ? CBZ.hash01(B.ox, B.oz, 0x0E14) : 0.5;
      const w = r.x1 - r.x0, mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
      const sx = mx + (j - 0.5) * Math.min(3.0, w * 0.25);
      occ.add({ x0: sx - 3.4, x1: sx + 3.4, z0: mz - 2.8, z1: mz + 2.8 });
      if (E.kind === "renovation") occ.add({ x0: mx - Math.min(w - 1.2, 6.0) / 2, x1: mx + Math.min(w - 1.2, 6.0) / 2, z0: r.z1 - 0.8, z1: r.z1 + 0.5 });
    }
    const rooms = restroomPair(B, occ, S, restroomOrder(B, S), E.dark) || [];
    floorPlane(B, { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1 }, "concrete", 0xd8d6d0);
    floorPlane(B, { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1 }, "concrete", 0xe6e5e1, 0, true);   // bare slab soffit
    // exposed battens on a 3.0 × 2.4 grid, about a quarter of them dead
    const W = S.x1 - S.x0, D = S.z1 - S.z0;
    const nx = Math.max(1, Math.round(W / 3.0)), nz = Math.max(1, Math.round(D / 2.4));
    for (let i = 0; i < nx; i++) for (let jn = 0; jn < nz; jn++) {
      const x = S.x0 + (i + 0.5) * W / nx, z = S.z0 + (jn + 0.5) * D / nz;
      if (inHole(B, x, z, 0.5) || inAny(rooms, x, z, 0.4)) continue;
      const dead = E.dark || B.h(x, z, 0xdead) < 0.26;
      if (dead) {
        box(B, x, B.ceil - 0.08, z, 1.2, 0.06, 0.14, 0xc9ccca);
        box(B, x, B.ceil - 0.1, z, 1.16, 0.02, 0.08, 0x9a9c98);
      } else if ((i + jn) & 1) {
        fixtureOnly(B, x, z, { kind: "strip", len: 1.2 });
      } else {
        B.light(x, z, { kind: "strip", len: 1.2, r: 6.5, i: 0.55 });
      }
    }
    // a duct run down the long axis, on hangers
    const lx = W >= D;
    const dc = lx ? (S.z0 + S.z1) / 2 + (B.h(8, 8, 0x4d) - 0.5) * D * 0.3 : (S.x0 + S.x1) / 2 + (B.h(8, 8, 0x4d) - 0.5) * W * 0.3;
    const a0 = lx ? S.x0 + 0.6 : S.z0 + 0.6, a1 = lx ? S.x1 - 0.6 : S.z1 - 0.6;
    if (a1 - a0 > 2) {
      const dy = B.ceil - 0.42;
      if (lx) box(B, (a0 + a1) / 2, dy, dc, a1 - a0, 0.34, 0.5, 0xaeb3b6);
      else box(B, dc, dy, (a0 + a1) / 2, 0.5, 0.34, a1 - a0, 0xaeb3b6);
      for (let a = a0 + 0.8; a < a1; a += 3.0) {
        if (lx) box(B, a, dy + 0.34, dc, 0.03, B.ceil - dy - 0.34, 0.54, 0x6a6f72);
        else box(B, dc, dy + 0.34, a, 0.54, B.ceil - dy - 0.34, 0.03, 0x6a6f72);
      }
    }
    // the contractor's kit on an untouched floor: tile stack, stepladder,
    // paint, a drop cloth — the floor is being readied for a tenant
    if (E.kind === "bare") {
      const sp = floorSpot(B, occ, r, 3.4, 2.2, r.x0 + (r.x1 - r.x0) * (0.25 + 0.5 * B.h(1, 3, 0x9)), r.z1 - 1.6, 0.5);
      if (sp) {
        const x = sp.x, z = sp.z;
        box(B, x, B.fy, z, 3.0, 0.006, 1.9, 0xe6e2d6);                                  // drop cloth
        box(B, x - 1.0, B.fy + 0.006, z - 0.4, 0.62, 0.2, 0.62, 0xe9e9e6, { mat: "ceiling" });   // tile stack
        box(B, x - 0.98, B.fy + 0.206, z - 0.38, 0.62, 0.016, 0.62, 0xefefec);
        stepladder(B, x + 0.2, z + 0.1, true);
        for (let i = 0; i < 3; i++) {
          const px = x + 0.9 + (i % 2) * 0.36, pz = z - 0.5 + i * 0.38;
          box(B, px, B.fy + 0.006, pz, 0.3, 0.36, 0.3, i === 1 ? 0xd9d4c4 : 0xf0efe8);
          box(B, px, B.fy + 0.366, pz, 0.31, 0.02, 0.31, 0x8a8f94);
        }
        box(B, x + 0.9, B.fy + 0.006, z + 0.7, 0.42, 0.05, 0.3, 0x5a5f64);             // roller tray
        box(B, x + 0.9, B.fy + 0.056, z + 0.66, 0.3, 0.012, 0.18, 0xece9df);
      }
    }
    officeExtras(B, S, occ, { copier: false, cooler: false, plants: false });
  }

  /* ========================================================================
     SHOPS — one planner, the trade picks the set.
     ======================================================================== */
  const FLOOR = {
    food: ["tile", 0xf3efe6], bar: ["wood", 0x7a5a48], casino: ["carpet", 0xb04848],
    clothing: ["wood", 0xffffff], eyewear: ["wood", 0xf0e8de], jewelry: ["wood", 0xa88a78],
    hospital: ["tile", 0xffffff], gym: ["vinyl", 0x4a4d52], guns: ["concrete", 0xd4cfc4],
    drugs: ["concrete", 0xa89f90], barber: ["checker", 0xffffff], bank: ["terrazzo", 0xffffff],
    cityhall: ["terrazzo", 0xffffff], courthouse: ["terrazzo", 0xf0ece4], federal: ["terrazzo", 0xe8e8ea],
    cityannex: ["terrazzo", 0xffffff], postoffice: ["vinyl", 0xe6ebf0], dmv: ["vinyl", 0xe2e6dc],
    library: ["carpet", 0x9ab09a], realtor: ["wood", 0xffffff], firestation: ["concrete", 0xc8c2b8],
    electronics: ["vinyl", 0xf4f4f4], hardware: ["concrete", 0xe0dace], security: ["vinyl", 0xccd0d6],
    pawn: ["vinyl", 0xd8ccb8], gas: ["vinyl", 0xffffff], raceway: ["vinyl", 0xd8dce6],
  };
  // trades whose counter a flagship file dresses (never touched here)
  const FLAG_COUNTER = { guns: 1, jewelry: 1, pawn: 1, bank: 1, casino: 1, realtor: 1, carlot: 1, chop: 1, clothing: 1, raceway: 1 };
  // no floor from us: the showroom's turntable pads sit at the old floor
  const NO_FLOOR = { carlot: 1, chop: 1 };
  // (the trap house gets a real ceiling: an old storefront's drop ceiling, stained, its
  //  bare bulbs hanging from it; it used to show the raw slab over a concrete floor)
  const NO_CEILING = { carlot: 1, firestation: 1, gym: 1 };
  // trades that get a stockroom when the room is not already back-walled
  // the trades with a TV on over the counter (planShop)
  const TV_KINDS = { food: 1, bar: 1, barber: 1, gym: 1, hospital: 1, gas: 1, pawn: 1, security: 1, drugs: 1, store: 1, liquor: 1 };
  const STOCK_KINDS = { store: 1, gas: 1, electronics: 1, hardware: 1, security: 1, gym: 1, drugs: 1,
    hospital: 1, barber: 1, eyewear: 1, paintball: 1 };
  // the trades that keep buildings.js's back-of-house partition (and so get no
  // stockroom here): the bank and the civic halls
  const BACK_OF_HOUSE = { bank: 1, cityhall: 1, courthouse: 1, federal: 1, cityannex: 1, postoffice: 1, dmv: 1, library: 1 };
  const CLAD = {
    food: [0xb8bcc0, 0xc23a36, 0xd8d8d4], hospital: [0xf2f3f4, 0x5b8bd0, 0xe8ecef], gas: [0xd8dadc, 0xe24b4b, 0x9aa0a6],
    electronics: [0xf2f3f4, 0x39d0c0, 0x2a2d31], hardware: [0xc8a878, 0xffd166, 0x8a7a5a], bar: [0x3a2618, 0xc9a54a, 0x2a1a10],
    drugs: [0x5a5048, 0x4caf6e, 0x4a4038], gym: [0x2e3238, 0x66d9c0, 0x3a3f46], barber: [0xf0ece4, 0x6bb6ff, 0xd8d0c4],
    security: [0x49566b, 0x49a0c0, 0x5a6270],
  };

  function planShop(B) {
    const b = B.b, I = B.info || {}, kind = I.kind || "store";
    const S = shellFull(B);
    const door = I.door || b.localDoor;
    const wt = S.wt;
    if (!door || door.nx == null) {                         // no frame: the finishes only
      const f = FLOOR[kind] || ["vinyl", 0xffffff];
      if (!NO_FLOOR[kind]) floorPlane(B, { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1 }, f[0], f[1]);
      troffers(B, { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1 }, 3.0, null, { r: 5.4, i: 0.5 });
      return;
    }
    const inx = door.nx, inz = door.nz, tx = -inz, tz = inx;
    const along = Math.abs(inx) > 0.5;
    const halfIn = (along ? b.w : b.d) / 2, halfTan = (along ? b.d : b.w) / 2;
    // the eager dresser's own frame: u = lat (tangent), v = inDepth from the door face
    const F = Frame(-inx * halfIn, -inz * halfIn, tx, tz, inx, inz);
    const ept = function (inD, lat, pad) {
      const x = F.x(lat, inD), z = F.z(lat, inD);
      return (!b.clearFloorPoint || b.clearFloorPoint(x, z, pad == null ? 0.7 : pad)) ? { x: x, z: z } : null;
    };
    const Bi = 2 * halfIn - wt;                             // inner back face
    const Ti = halfTan - wt;                                // inner side faces at lat ±Ti
    // (buildings.js keeps its back-of-house partition for the bank and the civic
    // halls only; every other trade gets a stockroom BESIDE the counter, below)
    const backWalled = !!BACK_OF_HOUSE[kind] && (2 * halfTan) >= 8 && (2 * halfIn) >= 13;
    const occ = baseOcc(B, S);
    const y = B.fy;
    const latOf = function (x, z) { return x * tx + z * tz; };
    const inOf = function (x, z) { return x * inx + z * inz + halfIn; };

    // ---- the counter ----
    const K = I.counter || null;
    let cIn = 0, cLat = 0, hIn = 0, hLat = 0, cTop = 1.2;
    if (K) {
      cIn = inOf(K.x, K.z); cLat = latOf(K.x, K.z);
      hIn = (along ? K.w : K.d) / 2; hLat = (along ? K.d : K.w) / 2;
      occ.add({ x0: K.x - K.w / 2 - 0.3, x1: K.x + K.w / 2 + 0.3, z0: K.z - K.d / 2 - 0.3, z1: K.z + K.d / 2 + 0.3 });
      // the clerk's side of the counter, down to the back wall: staff only
      occ.add(F.rect(cLat - hLat - 0.2, cIn - hIn, cLat + hLat + 0.2, Bi + 0.1));
      // …and the customer's queue in front of it
      occ.add(F.rect(cLat - hLat, cIn - hIn - 1.4, cLat + hLat, cIn - hIn));
    }
    const vendor = K ? { x: K.x + inx * 1.2, z: K.z + inz * 1.2 } : null;

    // ---- storegoods.js's sales floor: wall bays, gondolas, cooler, coffee ----
    // It publishes the footprints it stood (building-local); they go straight
    // into the ledger, with an aisle's worth in front of the wall pieces, so
    // nothing below lands in a gondola. (This used to RE-DERIVE storegoods'
    // old layout formula here, a second copy of it that drifted.)
    const sgSpans = [];
    const SGR = (CBZ.storeGoodsRects && CBZ.storeGoodsRects(b)) || [];
    for (let i = 0; i < SGR.length; i++) {
      const r = SGR[i];
      occ.add(grow(r, r.wall ? 0.35 : 0.2));
      if (r.wall) sgSpans.push([r.d0, r.d1]);
    }
    const inSg = function (d0, d1) { for (let i = 0; i < sgSpans.length; i++) if (d1 > sgSpans[i][0] && d0 < sgSpans[i][1]) return true; return false; };

    // ---- the eager trade pieces that DID land (same gates, same points) ----
    const eagerAt = function (inD, lat, pad, rad) {
      const p = ept(inD, lat, pad);
      if (p) occ.add({ x0: p.x - rad, x1: p.x + rad, z0: p.z - rad, z1: p.z + rad });
      return p;
    };
    const hi2 = 2 * halfIn;
    if (kind === "drugs") { eagerAt(hi2 - 4.0, halfTan - 1.7, 0.9, 1.4); eagerAt(hi2 - 6.0, halfTan - 2.4, 0.9, 0.8); }
    if (kind === "gym") { for (let i = 0; i < 2; i++) for (let s = -1; s <= 1; s += 2) eagerAt(5.4 + i * 3.0, s * (halfTan - 1.8), 0.9, 1.0); eagerAt(hi2 - 3.4, halfTan - 1.6, 0.7, 1.4); }
    if (kind === "hospital") { for (let i = 0; i < 2; i++) eagerAt(5.6 + i * 3.2, -(halfTan - 1.9), 0.9, 1.3); }
    if (kind === "barber") { for (let s = -1; s <= 1; s += 2) eagerAt(6.0, s * (halfTan - 1.6), 0.9, 0.6); }
    // (hardware/gas/electronics/security/generic eager floor pieces are gone:
    //  their sales floors are storegoods.js's, already in the ledger above)
    if (kind === "food") { for (let i = 0; i < 2; i++) for (let s = -1; s <= 1; s += 2) eagerAt(5.0 + i * 3.2, s * (halfTan - 1.7), 0.8, 0.8); }

    // ---- THE STOCKROOM: a back corner beside the counter ----
    const extraRooms = [];
    if (STOCK_KINDS[kind] && !backWalled && K) {
      const SRd = 2.2 + 0.8 * B.h(3, 7, 0x5c);
      const pref = kind === "drugs" || kind === "gym" ? [-1, 1] : kind === "hospital" ? [1, -1]
        : (B.h(2, 2, 0x5d) < 0.5 ? [-1, 1] : [1, -1]);
      for (let pi = 0; pi < pref.length; pi++) {
        const s = pref[pi];
        const Li = cLat + s * (hLat + 0.9);                // inner (door) wall line
        const width = s > 0 ? Ti - Li : Li + Ti;
        if (width < 2.0) continue;
        if (Bi - SRd < cIn - hIn - 0.2) continue;          // would run in front of the counter
        const lo = Math.min(Li, s * Ti), hiL = Math.max(Li, s * Ti);
        const R = F.rect(lo, Bi - SRd - T, hiL, Bi);
        const RC = F.rect(lo - 0.1, Bi - SRd - T - 0.8, hiL + 0.1, Bi);
        // the stockroom may not swallow anything already standing there
        let blocked = false;
        for (let i = 0; i < occ.list.length && !blocked; i++) {
          const o = occ.list[i];
          if (!overlap(RC, o)) continue;
          // the counter's own staff band is the room we open onto, not a clash
          const staff = F.rect(cLat - hLat - 0.2, cIn - hIn, cLat + hLat + 0.2, Bi + 0.1);
          if (Math.abs(o.x0 - staff.x0) < 1e-6 && Math.abs(o.z0 - staff.z0) < 1e-6) continue;
          blocked = true;
        }
        if (blocked || !rectFree(B, null, R, 0.04)) continue;
        if (vendor && inRect(grow(R, 0.4), vendor.x, vendor.z, 0)) continue;
        buildStockroom(B, F, s, Li, Ti, Bi, SRd, cIn, hIn, extraRooms);
        occ.add(RC);
        break;
      }
    }

    // ---- floor, ceiling, light ----
    const f = FLOOR[kind] || ["vinyl", 0xffffff];
    const SR = { x0: S.x0, x1: S.x1, z0: S.z0, z1: S.z1 };
    if (!NO_FLOOR[kind]) floorPlane(B, SR, f[0], f[1]);
    if (!NO_CEILING[kind]) floorPlane(B, SR, "ceiling", kind === "drugs" ? 0xc4bca9 : 0xffffff, 0, true);   // nicotine-yellowed in the trap house
    const pend = [];
    if (kind === "bar" || kind === "casino") {
      // warm pendants over the counter; the eager neon owns the rest of the mood
      if (K) {
        const drop = pendantDrop(B, 2.25);
        for (let i = -1; i <= 1; i++) {
          const la = cLat + i * Math.min(1.2, hLat * 0.6);
          B.light(F.x(la, cIn), F.z(la, cIn), { kind: "pendant", drop: drop, r: 3.6, i: 0.55, color: 0xffc98a, shade: 0x6a2a1a });
          pend.push(1);
        }
      }
      troffers(B, SR, 4.2, function (x, z) { return inAny(extraRooms, x, z, 0.3); }, { kind: "dome", r: 4.5, i: 0.28, color: 0xffd9b0 });
    } else if (kind === "drugs") {
      troffers(B, SR, 3.6, function (x, z) { return inAny(extraRooms, x, z, 0.3); }, { kind: "bulb", r: 4.2, i: 0.45, color: 0xffe0a0, drop: 0.5 });
    } else if (kind === "gym" || kind === "firestation") {
      troffers(B, SR, 3.0, function (x, z) { return inAny(extraRooms, x, z, 0.3); }, { kind: "strip", len: 1.5, r: 5.0, i: 0.55 });
    } else if (!NO_FLOOR[kind]) {
      troffers(B, SR, kind === "food" ? 2.4 : 3.0, function (x, z) { return inAny(extraRooms, x, z, 0.3); }, { r: 5.0, i: 0.5 });
    }

    // entrance mat (the eager one sits in the aisle its own gate refuses)
    box(B, F.x(0, 1.3), y, F.z(0, 1.3), along ? 1.2 : 1.9, 0.012, along ? 1.9 : 1.2, 0x2b2d31);

    // ---- the counter, dressed (flagship trades keep theirs) ----
    if (K && !FLAG_COUNTER[kind]) {
      const clad = CLAD[kind] || [0xd9d4c8, 0x6a7078, 0xe8e4dc];
      const kx = K.x, kz = K.z, kw = K.w, kd = K.d;
      box(B, kx, y, kz, kw + 0.04, cTop - y, kd + 0.04, clad[0]);                       // cladding
      box(B, kx, cTop, kz, kw + 0.1, 0.04, kd + 0.1, clad[2]);                          // worktop
      // a kick band and a trim line on the customer face
      F.span(B, cLat - hLat - 0.02, cLat + hLat + 0.02, cIn - hIn - 0.03, cIn - hIn - 0.02, y, 0.1, 0x2a2c30);
      F.span(B, cLat - hLat - 0.02, cLat + hLat + 0.02, cIn - hIn - 0.03, cIn - hIn - 0.02, y + 0.62, 0.05, clad[1]);
      // the till the eager dresser stood on the counter is the register
      const rp = ept(hi2 - 2.8, -0.7, 0.4) || ept(hi2 - 2.8, 0, 0.4);
      const regLat = rp ? latOf(rp.x, rp.z) : cLat;
      const regIn = rp ? inOf(rp.x, rp.z) : cIn;
      // the till is robbed through the counter (interact.js), not as a second container
      void regIn;
      const top = cTop + 0.04;
      // card reader on the customer edge beside the till
      const crLat = Math.max(cLat - hLat + 0.15, Math.min(cLat + hLat - 0.15, regLat + 0.42));
      F.box(B, crLat, cIn - hIn + 0.14, top, 0.05, 0.08, 0.05, C.dark);
      F.box(B, crLat, cIn - hIn + 0.14, top + 0.08, 0.09, 0.05, 0.15, 0x2a2d31);
      F.box(B, crLat, cIn - hIn + 0.1, top + 0.13, 0.06, 0.004, 0.05, 0x7fd6ff, { glow: true });
      // impulse rack at the far end of the counter from the till
      const irSide = regLat <= cLat ? 1 : -1;
      const irLat = cLat + irSide * (hLat - 0.26);
      // THE IMPULSE RACK: a wire counter stand of three stepped trays, each
      // holding three columns of candy bars lying flat, front to back, the size
      // candy bars are (13 x 3.5 x 1.4 cm). It was three rows of 10 cm painted
      // cubes. Not on a food counter: the hot food warmer stands at that end.
      if (hLat > 0.7 && Math.abs(irLat - regLat) > 0.5 && kind !== "food") {
        const IV = cIn - hIn + 0.16;
        const WIRE = 0x3a3d42;
        for (let s = -1; s <= 1; s += 2) {
          F.box(B, irLat + s * 0.2, IV, top, 0.012, 0.46, 0.012, WIRE);                    // upright
          F.box(B, irLat + s * 0.2, IV + 0.1, top, 0.012, 0.3, 0.012, WIRE);
        }
        const cols = [0x8c1f2a, 0xd9a21e, 0x2e6b3a, 0x2a4f8f, 0x5a2d6e, 0xc4541f, 0x3b2a22, 0xb8322a, 0x1f6f5c];
        for (let r2 = 0; r2 < 3; r2++) {
          const ty = top + 0.04 + r2 * 0.14, tv = IV - 0.04 + r2 * 0.045;            // stepped back as it rises
          F.box(B, irLat, tv, ty, 0.4, 0.008, 0.2, WIRE);                               // tray
          F.box(B, irLat, tv - 0.1, ty, 0.4, 0.03, 0.008, WIRE);                        // front lip
          for (let i = 0; i < 3; i++) {
            const c = cols[(r2 * 3 + i) % cols.length], la = irLat - 0.13 + i * 0.13;
            for (let k = 0; k < 5; k++) F.box(B, la, tv - 0.075 + k * 0.037, ty + 0.008 + (k & 1) * 0.001, 0.12, 0.014, 0.034, c);
          }
        }
      }
      if (kind === "food") {                                                           // tip jar by the till
        const tj = Math.max(cLat - hLat + 0.12, Math.min(cLat + hLat - 0.12, regLat - 0.38));
        if (Math.abs(tj - crLat) > 0.15) F.box(B, tj, cIn - hIn + 0.14, top, 0.12, 0.16, 0.12, 0xcfe4ec);
      }
      // the lit menu board for the food trades when the eager one never landed
      if (kind === "food" && !ept(hi2 - 1.8, 0, 0.6)) {
        const bw = Math.min(2.6, hLat * 2);
        F.box(B, cLat, Bi - 0.03, y + 2.0, bw + 0.1, 0.8, 0.05, 0x1c1e22);
        F.box(B, cLat, Bi - 0.06, y + 2.04, bw, 0.72, 0.01, 0xfff0d6, { glow: true });
        for (let i = 1; i < 3; i++) F.box(B, cLat - bw / 2 + bw * i / 3, Bi - 0.065, y + 2.04, 0.03, 0.72, 0.01, 0x2a2018);
      }
    }
    // ---- THE TV over the counter: the game's one set on a ceiling drop,
    // facing the customers (and the door), on NEWS ONE. A diner, a bar, a
    // barber, a gym, a waiting room, a gas station: the places a TV is on.
    if (K && TV_KINDS[kind] && B.tv && B.ceil - y >= 2.7) {
      const side = B.h(6, 2, 0x7b) < 0.5 ? -1 : 1;
      const tw = Math.min(1.0, Math.max(0.7, hLat * 0.6));
      const la = cLat + side * Math.min(hLat * (kind === "bar" || kind === "casino" ? 0.3 : 0.55), Math.max(0, hLat - tw / 2));
      const vd = cIn - hIn + 0.05;
      const tx2 = F.x(la, vd), tz2 = F.z(la, vd);
      const sh = tw * 9 / 16;
      const cy = Math.max(y + 2.08 + sh / 2, B.ceil - 0.42 - sh / 2);
      if (!inHole(B, tx2, tz2, 0.6) && cy + sh / 2 < B.ceil - 0.15) B.tv(tx2, tz2, Math.atan2(-inx, -inz), { w: tw, mount: "ceiling", y: cy });
    }
    // THE SHOP WINDOW: an electronics store shows its sets to the street,
    // each on a plinth just inside the glass, every one of them on the news
    if (kind === "electronics" && B.tv) {
      for (let s = -1; s <= 1; s += 2) {
        const la = s * Math.max(1.6, Ti * 0.55), v0 = wt + 0.25, v1 = wt + 0.85;
        if (Math.abs(la) + 0.75 > Ti) continue;
        const R = F.rect(la - 0.7, v0, la + 0.7, v1);
        if (!rectFree(B, occ, grow(R, 0.1), 0.05)) continue;
        occ.add(grow(R, 0.3));
        F.span(B, la - 0.7, la + 0.7, v0, v1, y, 0.5, 0x22252a, { solid: true });                 // the plinth
        F.span(B, la - 0.71, la + 0.71, v0 - 0.01, v1 + 0.01, y + 0.5, 0.02, 0xd8dadc);          // its top
        const fv = (v0 + v1) / 2 - 0.08;
        B.tv(F.x(la - 0.32, fv), F.z(la - 0.32, fv), Math.atan2(-inx, -inz), { w: 0.62, mount: "stand", base: y + 0.52, spill: false });
        B.tv(F.x(la + 0.36, fv), F.z(la + 0.36, fv), Math.atan2(-inx, -inz), { w: 0.52, mount: "stand", base: y + 0.52, spill: false });
      }
    }
    // ---- CCTV: a dome over the counter's customer side and one by the door
    if (K && kind !== "drugs") {
      const dx = F.x(cLat, cIn - hIn - 0.6), dz = F.z(cLat, cIn - hIn - 0.6);
      if (!inHole(B, dx, dz, 0.3)) { box(B, dx, B.ceil - 0.025, dz, 0.2, 0.025, 0.2, C.white); box(B, dx, B.ceil - 0.1, dz, 0.13, 0.075, 0.13, 0x1c2026); }
    }
    {
      const s = (B.h(9, 1, 0x3c) < 0.5 ? -1 : 1);
      const la = s * (Ti - 0.35);
      const dx = F.x(la, 0.9 + wt), dz = F.z(la, 0.9 + wt);
      if (!inHole(B, dx, dz, 0.3)) {
        box(B, dx, B.ceil - 0.12, dz, 0.06, 0.12, 0.06, C.white);
        F.box(B, la, 0.9 + wt + 0.08, B.ceil - 0.2, 0.1, 0.09, 0.2, 0xe8e8e4);
      }
    }
    // a plant and a bin inside the door (the eager pair's gate never passes)
    if (!NO_FLOOR[kind]) {
      const s = B.h(4, 4, 0x3b) < 0.5 ? 1 : -1;
      const pp = { x: F.x(s * (Ti - 0.38), wt + 1.0), z: F.z(s * (Ti - 0.38), wt + 1.0) };
      const PR = { x0: pp.x - 0.33, x1: pp.x + 0.33, z0: pp.z - 0.33, z1: pp.z + 0.33 };
      if (kind !== "drugs" && rectFree(B, occ, PR, 0.05)) { occ.add(PR); plant(B, pp.x, pp.z, 0.95); }
      const bp = { x: F.x(-s * (Ti - 0.3), wt + 0.7), z: F.z(-s * (Ti - 0.3), wt + 0.7) };
      const BR = { x0: bp.x - 0.25, x1: bp.x + 0.25, z0: bp.z - 0.25, z1: bp.z + 0.25 };
      if (rectFree(B, occ, BR, 0.05)) { occ.add(BR); bin(B, bp.x, bp.z); }
    }

    // ---- the trade's own set pieces, where the eager dresser has none ----
    if (kind === "food") shopFoodBooths(B, F, ept, halfTan, Ti);
    // (the bar is the Velvet Club: its back bar and dance floor are club.js's)
    if (kind === "hardware") shopPegboard(B, F, S, Ti, wt, inSg);
    if (kind === "barber") shopBarberMirrors(B, F, ept, halfTan, Ti, inSg);
    if (kind === "gym") { shopGymMirror(B, F, Ti, wt, Bi, inSg); shopGymMats(B, F, ept, along, halfIn); }
    if (kind === "hospital") shopWaiting(B, F, S, Ti, wt, occ);
    if (kind === "firestation") shopBayStripes(B, F, ept, along, halfIn, wt);
  }

  function buildStockroom(B, F, s, Li, Ti, Bi, SRd, cIn, hIn, rooms) {
    const y = B.fy;
    const vFront = Bi - SRd;                                  // the front wall's room face
    const wo = { tint: 0xe6e2d8 };
    // front wall across the corner, and the side wall with the door in it
    F.wallU(B, vFront - T / 2, Li - s * T, s * Ti, null, wo);
    const doorV = Math.max(vFront + 0.55, Math.min(Bi - 0.55, (cIn + hIn + Bi) / 2));
    F.wallV(B, Li - s * T / 2, vFront - T, Bi, [{ c: doorV, w: 0.9, h: 2.1 }], wo);
    const lo = Math.min(Li, s * Ti), hi = Math.max(Li, s * Ti);
    const R = F.rect(lo, vFront, hi, Bi);
    rooms.push(R);
    B.plane(R.x0, R.z0, R.x1, R.z1, y + 0.004, "concrete", 0xcfcac0, { holes: [], cell: 0.8 });
    B.light(F.x((lo + hi) / 2, (vFront + Bi) / 2), F.z((lo + hi) / 2, (vFront + Bi) / 2), { kind: "bulb", r: 3.4, i: 0.55, rect: R, color: 0xfff0d0, drop: 0.35 });
    const W = hi - lo;
    // shelving across the back wall (faces the room: forward = -n)
    const backYaw = F.yaw(0, -1);
    const bl = Math.min(W - 0.2, 2.2);
    const bc = s > 0 ? hi - 0.1 - bl / 2 : lo + 0.1 + bl / 2;
    shelfUnit(B, F.x(bc, Bi - 0.24), F.z(bc, Bi - 0.24), backYaw, bl, 0x51);
    B.loot(F.x(bc, Bi - 0.5), F.z(bc, Bi - 0.5), "stockroom");
    // a second unit down the outer side wall when the room is deep enough
    if (SRd >= 2.4) {
      const sl = Math.min(SRd - 0.55 - 0.15, 1.6);
      const sideYaw = F.yaw(-s, 0);
      const sv = Bi - 0.5 - sl / 2 - 0.02;
      shelfUnit(B, F.x(s * (Ti - 0.24), sv), F.z(s * (Ti - 0.24), sv), sideYaw, sl, 0x52);
    }
    // a small desk against the front wall, facing it, where there is width
    const dl = 1.0;
    let desk = false;
    if (W >= 2.4) {
      const du = s > 0 ? hi - 0.62 - dl / 2 - (SRd >= 2.4 ? 0.0 : 0) : lo + 0.62 + dl / 2;
      const dUse = Math.abs(du - Li) > dl / 2 + 0.95 ? du : null;
      if (dUse != null) {
        desk = true;
        const dv = vFront + 0.3;
        // desk against the front wall: the worker looks toward it (-n)
        const res = B.furn("desk", F.x(dUse, dv), F.z(dUse, dv), F.yaw(0, -1), { len: dl, deep: 0.55 });
        if (!res) {
          F.box(B, dUse, dv, y, dl, 0.74, 0.55, C.laminate);
          F.box(B, dUse, dv - 0.18, y + 0.74, 0.5, 0.34, 0.04, C.dark);
        }
      }
    }
    // the mop bucket by the door, on the room side
    const mu = Li + s * 0.35;
    mopBucket(B, F.x(mu, vFront + 0.3), F.z(mu, vFront + 0.3));
    // a flattened carton leaning on the front wall, where the desk is not
    if (!desk) F.box(B, Li + s * 0.9, vFront + 0.04, y, 0.7, 0.9, 0.04, C.carton2);
  }

  function shopFoodBooths(B, F, ept, halfTan, Ti) {
    const drop = pendantDrop(B, 2.0);
    for (let i = 0; i < 2; i++) for (let s = -1; s <= 1; s += 2) {
      const inD = 5.0 + i * 3.2;
      const table = ept(inD, s * (halfTan - 1.7), 0.8);
      if (!table) continue;
      // the eager banquette's own gate always refuses it: stand the real one
      if (!ept(inD, s * (halfTan - 0.7), 0.8)) {
        const la = s * (Ti - 0.29);
        const x = F.x(la, inD), z = F.z(la, inD);
        if (B.clear(x, z, 0.05)) B.furn("bench", x, z, F.yaw(-s, 0), { len: 1.4 });
      }
      B.light(table.x, table.z, { kind: "pendant", drop: drop, r: 3.0, i: 0.5, color: 0xffe2b0, shade: 0xc23a36 });
    }
  }
  function shopPegboard(B, F, S, Ti, wt, inSg) {
    const d0 = wt + 1.1, d1 = d0 + 2.4;
    if (inSg(d0, d1)) return;
    for (let pass = 0; pass < 2; pass++) {
      const s = pass === 0 ? -1 : 1;
      const la = s * Ti;
      // wall frame: u = inDepth, v = off the wall
      const P = Frame(F.x(la, d0), F.z(la, d0), F.nx, F.nz, -s * F.ax, -s * F.az);
      if (winHit(B, P, 0, 2.4, B.fy + 0.9, B.fy + 2.3)) continue;
      if (!B.clear(F.x(la - s * 0.1, (d0 + d1) / 2), F.z(la - s * 0.1, (d0 + d1) / 2), 0.05)) continue;
      const y = B.fy;
      P.span(B, 0, 2.4, 0, 0.02, y + 0.9, 1.4, 0xa88258);
      const tools = [0xb3342e, 0x8a9098, 0xe8c23a, 0x2a2d31, 0x3a6ea5];
      for (let r2 = 0; r2 < 3; r2++) for (let i = 0; i < 5; i++) {
        const u = 0.3 + i * 0.45, yy = y + 1.05 + r2 * 0.42;
        const c = tools[(i + r2) % tools.length];
        const k = (i + r2 * 2) % 3;
        if (k === 0) { P.span(B, u - 0.02, u + 0.02, 0.02, 0.05, yy, 0.26, 0x6a4a2a); P.span(B, u - 0.07, u + 0.07, 0.02, 0.06, yy + 0.24, 0.05, c); }   // hammer
        else if (k === 1) P.span(B, u - 0.02, u + 0.02, 0.02, 0.04, yy, 0.3, c);                                                                       // wrench/driver
        else P.span(B, u - 0.1, u + 0.1, 0.02, 0.08, yy + 0.06, 0.14, c);                                                                                 // packaged goods
      }
      return;
    }
  }
  function shopBarberMirrors(B, F, ept, halfTan, Ti, inSg) {
    for (let s = -1; s <= 1; s += 2) {
      if (!ept(6.0, s * (halfTan - 1.6), 0.9)) continue;
      if (inSg(5.4, 6.6)) continue;
      const P = Frame(F.x(s * Ti, 5.45), F.z(s * Ti, 5.45), F.nx, F.nz, -s * F.ax, -s * F.az);
      if (winHit(B, P, 0, 1.1, B.fy + 0.9, B.fy + 2.2)) continue;
      const y = B.fy;
      P.span(B, 0, 1.1, 0, 0.03, y + 0.95, 1.25, 0x2a2d31);
      P.span(B, 0.04, 1.06, 0.03, 0.035, y + 0.99, 1.17, C.mirror);
      P.span(B, 0.05, 1.05, 0, 0.26, y + 0.86, 0.03, 0xe8e4dc);                        // ledge
      for (let i = 0; i < 3; i++) P.span(B, 0.2 + i * 0.25, 0.27 + i * 0.25, 0.08, 0.15, y + 0.89, 0.16 + i * 0.03, [0x39d0c0, 0xe8e8e8, 0x6b4a2a][i]);
    }
  }
  function shopGymMirror(B, F, Ti, wt, Bi, inSg) {
    for (let d0 = wt + 1.4; d0 + 3.0 < Bi - 0.5; d0 += 0.5) {
      if (inSg(d0, d0 + 3.0)) continue;
      const s = -1;
      const P = Frame(F.x(s * Ti, d0), F.z(s * Ti, d0), F.nx, F.nz, -s * F.ax, -s * F.az);
      if (winHit(B, P, 0, 3.0, B.fy + 0.3, B.fy + 2.2)) continue;
      if (!B.clear(F.x(s * (Ti - 0.1), d0 + 1.5), F.z(s * (Ti - 0.1), d0 + 1.5), 0.05)) continue;
      P.span(B, 0, 3.0, 0, 0.02, B.fy + 0.35, 1.85, C.mirror);
      P.span(B, 0, 3.0, 0, 0.04, B.fy + 0.3, 0.05, C.chrome);
      return;
    }
  }
  function shopGymMats(B, F, ept, along, halfIn) {
    void halfIn;
    for (let i = 0; i < 3; i++) {
      const p = ept(5.5 + i * 2.6, 0, 0.9);
      if (!p) continue;
      box(B, p.x, B.fy, p.z, along ? 1.6 : 1.8, 0.02, along ? 1.8 : 1.6, [0x222931, 0x2a323a][i % 2]);
    }
  }
  // the apparatus bay's edge stripes (the eager pair lie under the slab, and
  // their 12 m length ran out through the facade of a shallow house: clip it)
  function shopBayStripes(B, F, ept, along, halfIn, wt) {
    const p = ept(halfIn * 0.8, 0, 1.6);
    if (!p) return;
    const L = Math.min(2 * halfIn - 2, 12);
    const v0 = Math.max(wt + 0.1, halfIn * 0.8 - L / 2), v1 = Math.min(2 * halfIn - wt - 0.1, halfIn * 0.8 + L / 2);
    if (v1 - v0 < 1) return;
    for (let i = -1; i <= 1; i += 2) F.span(B, i * 2.1 - 0.08, i * 2.1 + 0.08, v0, v1, B.fy, 0.006, 0xd8c05a);
  }
  function shopWaiting(B, F, S, Ti, wt, occ) {
    const s = 1;
    const la = s * (Ti - 0.33);
    const yaw = F.yaw(-s, 0);
    let n = 0;
    for (let i = 0; i < 3; i++) {
      const v = wt + 1.7 + i * 0.62;
      const x = F.x(la, v), z = F.z(la, v);
      const R = { x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 };
      if (!rectFree(B, occ, R, 0.05)) continue;
      occ.add(R);
      if (B.furn("chair", x, z, yaw, { tone: "clinic" })) n++;
    }
    return n;
  }

  /* ========================================================================
     REGISTRATION
     ======================================================================== */
  CBZ.fitoutPlan("deskfarm", planDeskFarm);
  CBZ.fitoutPlan("meeting", planMeeting);
  CBZ.fitoutPlan("lobby", planLobby);
  CBZ.fitoutPlan("breakroom", planBreakroom);
  CBZ.fitoutPlan("storage", planStorage);
  CBZ.fitoutPlan("empty", planEmpty);
  CBZ.fitoutPlan("shop", planShop);

  /* ---- the owned-property catalogue: a home bar, a pool table -----------
     fn(B, x, z, yaw, item): building-local centre, cardinal yaw, the FRONT
     (customer side / the long side you break from) faces along yaw. */
  function pieceFrame(x, z, yaw) {
    const fx = Math.round(Math.sin(yaw)), fz = Math.round(Math.cos(yaw));
    // u = lateral (right of forward), v = forward
    return Frame(x, z, fz, -fx, fx, fz);
  }
  if (CBZ.fitoutDraw) {
    CBZ.fitoutDraw("bar", function (B, x, z, yaw) {
      const P = pieceFrame(x, z, yaw || 0), y = B.fy;
      // counter 2.0 × 0.6, bar-height 1.06, a raised back ledge of bottles
      P.span(B, -1.0, 1.0, -0.35, 0.25, y + 0.1, 0.92, C.walnut, { solid: true });
      P.span(B, -0.97, 0.97, -0.32, 0.22, y, 0.1, 0x1a1a1c);
      P.span(B, -1.05, 1.05, -0.35, 0.35, y + 1.02, 0.04, 0x3a2618);                   // top, overhang to the front
      P.span(B, -1.0, 1.0, 0.33, 0.37, y + 0.2, 0.04, C.brass);                         // foot rail
      P.span(B, -1.0, 1.0, -0.35, -0.2, y + 1.06, 0.12, 0x2a1a10);                      // back ledge
      const cols = [0x6fbf73, 0xc7b06f, 0x8a3b2e, 0xd8d0b0, 0x6f9fbf, 0x4a2a1a, 0xc7b06f];
      for (let i = 0; i < 7; i++) {
        const u = -0.84 + i * 0.28, h = 0.24 + B.h(x + u, z, 0xba) * 0.1;
        P.box(B, u, -0.275, y + 1.18, 0.07, h, 0.07, cols[i]);
        P.box(B, u, -0.275, y + 1.18 + h, 0.025, 0.06, 0.025, 0x2a2a2a);
      }
      P.box(B, 0.5, 0.05, y + 1.06, 0.07, 0.1, 0.07, 0xcfe4ec);                        // two glasses
      P.box(B, 0.64, 0.08, y + 1.06, 0.07, 0.1, 0.07, 0xcfe4ec);
      // two stools on the front
      const fx = Math.sin(yaw || 0), fz = Math.cos(yaw || 0);
      for (let s = -1; s <= 1; s += 2) {
        const sx = P.x(s * 0.5, 0.72), sz = P.z(s * 0.5, 0.72);
        if (!B.furn("stool", sx, sz, Math.atan2(-fx, -fz))) {
          box(B, sx, y, sz, 0.36, 0.05, 0.36, C.dark);
          box(B, sx, y + 0.05, sz, 0.1, 0.55, 0.1, C.dark);
          box(B, sx, y + 0.6, sz, 0.42, 0.08, 0.42, 0x6a1622);
        }
      }
      B.lamp(x, y + 1.9, z, { r: 2.4, i: 0.3 });
    });
    CBZ.fitoutDraw("pooltable", function (B, x, z, yaw) {
      const P = pieceFrame(x, z, yaw || 0), y = B.fy;
      // u runs the table's length: swap so the long side lies across `yaw`
      const L = 2.34, Wd = 1.3, top = y + 0.8;
      const Q = Frame(P.ox, P.oz, P.ax, P.az, P.nx, P.nz);
      for (let a = -1; a <= 1; a += 2) for (let c = -1; c <= 1; c += 2)
        Q.box(B, a * (L / 2 - 0.16), c * (Wd / 2 - 0.14), y, 0.14, 0.62, 0.14, C.walnut);           // legs
      Q.box(B, 0, 0, y + 0.52, L - 0.1, 0.1, Wd - 0.1, 0x3a2618);                                  // stretcher frame
      Q.box(B, 0, 0, y + 0.62, L, 0.15, Wd, C.walnut, { solid: true });                            // apron / body
      Q.box(B, 0, 0, top - 0.03, L - 0.24, 0.03, Wd - 0.24, C.felt);                               // the bed
      for (let s = -1; s <= 1; s += 2) {
        Q.box(B, 0, s * (Wd / 2 - 0.09), top - 0.03, L - 0.24, 0.05, 0.06, 0x1a5a38);               // long cushions
        Q.box(B, s * (L / 2 - 0.09), 0, top - 0.03, 0.06, 0.05, Wd - 0.24, 0x1a5a38);               // short cushions
        Q.box(B, 0, s * (Wd / 2 - 0.03), top - 0.03, L, 0.06, 0.06, 0x5a3a24);                     // rail caps
        Q.box(B, s * (L / 2 - 0.03), 0, top - 0.03, 0.06, 0.06, Wd, 0x5a3a24);
      }
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c += 2)                                 // six pockets
        Q.box(B, a * (L / 2 - 0.11), c * (Wd / 2 - 0.11), top - 0.025, 0.1, 0.03, 0.1, 0x0c0c0c);
      // the rack of fifteen, and the cue ball at the head spot
      const bc = [0xe8c23a, 0x2a4f9a, 0xb3342e, 0x5a2a7a, 0xe07a2a, 0x1f6b43, 0x7a1f1f, 0x111111];
      let i = 0;
      for (let row = 0; row < 5; row++) for (let k = 0; k <= row; k++) {
        const u = 0.45 + row * 0.05, v = (k - row / 2) * 0.058;
        Q.box(B, u, v, top, 0.055, 0.055, 0.055, bc[i % bc.length]);
        i++;
      }
      Q.box(B, -0.58, 0, top, 0.055, 0.055, 0.055, 0xf4f2ea);
      // cues: on a rack on the nearest wall if there is one within reach,
      // otherwise laid across the rails
      const S = shellOf(B);
      const cands = [
        { d: x - S.x0, ok: true, wx: S.x0, axis: "x", s: 1 }, { d: S.x1 - x, ok: true, wx: S.x1, axis: "x", s: -1 },
        { d: z - S.z0, ok: true, wz: S.z0, axis: "z", s: 1 }, { d: S.z1 - z, ok: true, wz: S.z1, axis: "z", s: -1 },
      ].filter(function (c) { return c.ok && c.d > 0.9 && c.d < 2.8; }).sort(function (a, b) { return a.d - b.d; });
      if (cands.length) {
        const c = cands[0];
        const hx = c.axis === "x" ? c.wx + c.s * 0.03 : x, hz = c.axis === "z" ? c.wz + c.s * 0.03 : z;
        if (c.axis === "x") {
          box(B, hx, y + 0.35, hz, 0.04, 0.06, 0.62, C.walnut);
          box(B, hx, y + 1.5, hz, 0.04, 0.08, 0.62, C.walnut);
          for (let q = 0; q < 3; q++) box(B, hx + c.s * 0.04, y + 0.36, hz - 0.2 + q * 0.2, 0.025, 1.42, 0.025, q === 1 ? 0x8a6a3a : 0xc9a06a);
        } else {
          box(B, hx, y + 0.35, hz, 0.62, 0.06, 0.04, C.walnut);
          box(B, hx, y + 1.5, hz, 0.62, 0.08, 0.04, C.walnut);
          for (let q = 0; q < 3; q++) box(B, hx - 0.2 + q * 0.2, y + 0.36, hz + c.s * 0.04, 0.025, 1.42, 0.025, q === 1 ? 0x8a6a3a : 0xc9a06a);
        }
      } else {
        for (let s = -1; s <= 1; s += 2) Q.box(B, -0.1, s * (Wd / 2 - 0.03), top + 0.03, 1.45, 0.025, 0.025, 0xc9a06a);
      }
      B.light(x, z, { kind: "pendant", drop: pendantDrop(B, 1.75), r: 3.2, i: 0.55, shade: 0x1f4a33, color: 0xfff0d0 });
    });
  }

  // tools / audits
  CBZ.fitoutWork = { planners: ["deskfarm", "meeting", "lobby", "breakroom", "storage", "empty", "shop"],
                     verbs: ["bar", "pooltable"], _deskGrid: deskGrid, _emptyRead: emptyRead };
})();
