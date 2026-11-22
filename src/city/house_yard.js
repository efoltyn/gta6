/* ============================================================
   city/house_yard.js — THE HOUSE LOT: a detached house standing on its land.

   OWNER: "the houses in the game are also dumb." And: "first making all
   assets look great, and you can reuse great ones from Natural Disaster,
   like great stop signs and roads and fences and houses."

   A house reads as a house from the street and from the air because of its
   LAND: it stands back from the street behind a front yard, it has side
   yards, a driveway runs past it to a garage, a walk runs to its door, and
   the lot is bounded by a fence with a gate in it and a mailbox at the kerb.

     CBZ.houseLot.plan(o)    lot + door face + the house the street wants ->
                             where the house stands (centre, size) and where
                             its garage and its driveway go.
     CBZ.houseLot.dress(root, p)   the land round a built house, by WHO LIVES
                             THERE (p.tier, city/house_plan.js: the
                             neighbourhood's own wealth):
        poor   chain link or nothing on the street line, a carport or a bare
               drive, weeds for a border, a washing line and what got left
               out the back
        mid    a white picket fence or a clipped hedge with a gate on the
               walk, shrubs and flowers under the windows, a board fence
               round the back yard, a patio with a table, a shed, a bin
        rich   a rendered wall between piers (or a tall hedge) with iron
               gates, lanterns on the walk, a walled back garden with a
               pool where there is room for one, a double garage

     THE FENCES, GATE POSTS, PATHS, MAILBOX, BIN AND SHRUBS ARE THE NATURAL
     DISASTER ISLAND'S (world/island_dressing.js's own builders, asked for as
     a kit): the pointed pickets, the capped wall, the hedge. What is the
     city's own is laid with the same emitters. One vertex-coloured mesh per
     lot (one draw call), colliders for everything you could walk into.

   THE CAR. dress() says where a car stands on this lot (lot.building.garage:
   on the drive, nose to the garage door) and city/realestate.js keeps the
   owner's car there.

   Reference proportions (US suburban codes and plan guides: friscotexas.gov
   "Single-Family Front Entry Lot Layout Guidelines", ecode360 Town and
   Country MO suburban districts): front setback 6-8 m (20-25 ft), side yards
   1.5 m (5 ft) or more, a 3-6 m driveway (10-20 ft), a 1.2 m front walk, a
   1.0-1.2 m front fence or hedge, a 1.8 m privacy fence round the back yard,
   a single garage 3.6 x 6.5 m, a double 6.2 x 6.5 m.

   DETERMINISM: pure geometry plus position hashes. No rng draw anywhere.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function h01(x, z, s) {
    if (CBZ.hash01) return CBZ.hash01(x, z, s);
    const v = Math.sin(x * 12.9898 + z * 78.233 + s * 0.123) * 43758.5453;
    return v - Math.floor(v);
  }
  function shadeHex(hex, f) {
    const r = Math.max(0, Math.min(255, (((hex >> 16) & 255) * f) | 0));
    const g = Math.max(0, Math.min(255, (((hex >> 8) & 255) * f) | 0));
    const b = Math.max(0, Math.min(255, ((hex & 255) * f) | 0));
    return (r << 16) | (g << 8) | b;
  }

  const HL = {};
  // the standard pieces (m)
  HL.FRONT = 6.5;          // front yard, lot line to the house face
  HL.SIDE = 1.5;           // side yard minimum
  HL.REAR = 3.0;           // back yard minimum
  HL.GARAGE1 = 3.6;        // single garage width
  HL.GARAGE2 = 6.2;        // double
  HL.GARAGE_D = 6.6;       // garage depth
  HL.DRIVE = 5.4;          // city/approach.js DRIVE_W: the driveway the lot gets

  /* ---- THE PLAN --------------------------------------------------------------
     o: { cx, cz, w, d (the lot), nx, nz (OUTWARD unit normal of the street
          face), want: { w, d } the house the street would build (along the
          street, back from it), minW, minD (smallest acceptable house),
          garage: bool (allowed), garageW (a wider garage where the frontage
          holds it), rear (a deeper back yard where the lot holds it), salt }
     Returns { x, z, w, d (the house, world, axis-aligned), garage: { t, w,
     d } | null (t: along the street from the lot centre), front, side,
     t (house centre along the street), a (along the normal, from the lot
     centre), tx, tz (the street tangent) } */
  HL.plan = function (o) {
    const nx = o.nx || 0, nz = o.nz || 0;
    const tx = -nz, tz = nx;                                    // along the street
    const lotT = Math.abs(nx) > 0.5 ? o.d : o.w;               // the lot's frontage
    const lotA = Math.abs(nx) > 0.5 ? o.w : o.d;               // its depth
    const want = o.want || {};
    const minW = o.minW || 8, minD = o.minD || 8;
    const salt = o.salt || 0;
    // the front yard: ~a quarter of a deep lot, never under 3.5 m
    const front = clamp(lotA * 0.24, 3.5, o.front != null ? o.front : HL.FRONT);
    const rear = Math.max(clamp(lotA * 0.12, 1.5, HL.REAR + 2), Math.min(o.rear || 0, lotA - front - minD));
    let hd = clamp(want.d || lotA - front - rear, minD, Math.max(minD, lotA - front - rear));
    let hw = clamp(want.w || lotT - 2 * HL.SIDE, minW, Math.max(minW, lotT - 2 * HL.SIDE));
    // a garage beside the house when the frontage holds both
    let garage = null;
    const gs = h01(o.cx, o.cz, 0x9a7 + salt) < 0.5 ? -1 : 1;  // which side of the drive the house is on
    // the driveway: on the lot's centreline where the kerb is already cut
    // for it (o.driveFixed: the Gang City grid, world.js drops the kerb from
    // city/approach.js's solve before any house exists), else wherever the
    // house wants it, a single 3.2 m drive down one side of the lot
    let driveAt = 0, driveHalf = HL.DRIVE / 2;
    let t = null;
    const room = lotT / 2 - HL.SIDE;                             // centreline to the side yard
    if (o.driveFixed) {
      if (o.garage !== false) {
        // the garage on the centreline, the house beside it
        for (const gw of [HL.GARAGE2, HL.GARAGE1]) {
          const maxHouse = room - gw / 2;                          // the garage's far edge to the side yard
          if (maxHouse >= minW && hd > HL.GARAGE_D * 0.7) {
            hw = Math.min(hw, maxHouse);
            garage = { t: 0, w: gw, d: Math.min(HL.GARAGE_D, hd - 0.5) };
            t = gs * (gw / 2 + hw / 2);
            break;
          }
        }
      }
      if (t == null) {
        const slack = Math.max(0, room - hw / 2);
        t = gs * Math.min(slack, driveHalf + 0.3 + hw / 2);
      }
    } else {
      driveHalf = 1.6;
      // a garage at the end of a side drive, the house against it (a double
      // one where it was asked for and the frontage still holds the house)
      for (const gw of (o.garageW > HL.GARAGE1 ? [o.garageW, HL.GARAGE1] : [HL.GARAGE1])) {
        const gC = lotT / 2 - 0.5 - gw / 2;                        // the garage (and drive) centre, from the lot centre
        const withG = room + gC - gw / 2;                           // the house from the garage edge to the far side yard
        if (o.garage !== false && withG >= Math.max(minW, gw > HL.GARAGE1 ? Math.min(hw, 11.5) : minW) && hd > HL.GARAGE_D * 0.7) {
          hw = Math.min(hw, withG);
          driveAt = -gs * gC;
          driveHalf = gw > HL.GARAGE1 ? 2.7 : 1.6;
          garage = { t: driveAt, w: gw, d: Math.min(HL.GARAGE_D, hd - 0.5) };
          const u0 = gC - gw / 2;                                   // the garage's inner edge, on the house's side
          t = gs * (-u0 + hw / 2);
          break;
        }
      }
      if (!garage) {
        const dC = lotT / 2 - 0.5 - driveHalf;                    // a drive down the side line
        const span = room + (dC - driveHalf - 0.4);               // the house from the drive's edge to the side yard
        if (span >= minW) {
          hw = Math.min(hw, span);
          driveAt = -gs * dC;
          t = gs * (-(dC - driveHalf - 0.4) + hw / 2);
        } else {
          // too narrow for a side drive: the house in the middle, a parking
          // pad in front of it (the drive runs to its face)
          driveAt = 0; driveHalf = HL.DRIVE / 2; t = 0;
        }
      }
    }
    const a = lotA / 2 - front - hd / 2;                        // the house face is `front` behind the lot line
    const x = o.cx + tx * t + nx * a, z = o.cz + tz * t + nz * a;
    const w = Math.abs(nx) > 0.5 ? hd : hw, d = Math.abs(nx) > 0.5 ? hw : hd;
    return { x: x, z: z, w: w, d: d, hw: hw, hd: hd, t: t, a: a, front: front, garage: garage, gs: gs, driveAt: driveAt, driveHalf: driveHalf,
      tx: tx, tz: tz, nx: nx, nz: nz, lotT: lotT, lotA: lotA, cx: o.cx, cz: o.cz };
  };

  /* ---- THE DRESSING ------------------------------------------------------------
     root: the group to add the lot's mesh to. p: HL.plan's result plus
       y      the lot surface's height (the house's floor sits on it)
       doorT  the door's position along the street (default the house centre)
       storeys
       tier   "poor" | "mid" | "rich" (default mid), wealth 0..1
       style  the street line: "chain" | "picket" | "hedge" | "wall" | "open"
              (default: by tier and position)
       pal    { body, trim, roof } (default: the house grammar's, published
              by city/facades/house_parts.js, else neutral)
       ownGarage  the house grammar drew its own garage door (the ranch)
       lot    the lot record: its building learns where its car stands
     Returns { mesh, colliders, garageRect, stand }. */
  let _mat = null;
  function yardMat() {
    if (_mat) return _mat;
    _mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    _mat._shared = true;
    _mat.name = "house-lot";
    return _mat;
  }
  const _col = new THREE.Color();
  function lin(hex) { _col.setHex(hex >>> 0); return [_col.r, _col.g, _col.b]; }

  HL.dress = function (root, p) {
    if (!root || !p) return null;
    const ID = CBZ.islandDressing;
    if (!ID || !ID.build) return null;
    const y0 = p.y || 0;
    const nx = p.nx, nz = p.nz, tx = p.tx, tz = p.tz;
    const alongX = Math.abs(nz) > 0.5;                           // the street runs along x
    // (t, a) -> world. t along the street, a out toward it, both from the lot centre.
    const W = function (t, a) { return [p.cx + tx * t + nx * a, p.cz + tz * t + nz * a]; };
    const tier = p.tier === "poor" || p.tier === "rich" ? p.tier : "mid";
    const halfT = p.lotT / 2, halfA = p.lotA / 2;
    const hT0 = p.t - p.hw / 2, hT1 = p.t + p.hw / 2;           // the house along the street
    const hA1 = p.a + p.hd / 2, hA0 = p.a - p.hd / 2;           // its front face, its back
    const doorT = p.doorT != null ? p.doorT : p.t;
    const pal = p.pal || (CBZ.HOUSE_PARTS && CBZ.HOUSE_PARTS.palAt(p.x, p.z)) || { body: 0xb9ae98, trim: 0xe9e5da, roof: 0x4a4a48 };
    const hs = h01(p.cx, p.cz, 0x7d1);
    const driveHalf = p.driveHalf != null ? p.driveHalf : HL.DRIVE / 2;
    const dC = p.driveAt || 0;                                     // the drive's centre along the street
    const ownGarage = !!(p.ownGarage || pal.ownGarage);
    const G = p.garage && !ownGarage ? p.garage : null;

    // ---- THE ISLAND'S YARD KIT, laying at this lot's level -------------------------
    // (its clearance tests know this house and its garage, nothing else)
    const hA = W(hT0, hA0), hB = W(hT1, hA1);
    const own = [{ minX: Math.min(hA[0], hB[0]), maxX: Math.max(hA[0], hB[0]), minZ: Math.min(hA[1], hB[1]), maxZ: Math.max(hA[1], hB[1]), y0: y0 - 1, y1: y0 + 3 }];
    let K = null;
    try { K = ID.build({ kitOnly: true, root: root, cx: p.cx, cz: p.cz, R: Math.max(p.lotT, p.lotA), groundHeightAt: function () { return y0; }, colliders: own }); } catch (e) { K = null; }
    if (!K || !K.A) return null;
    const A = K.A, COL = K.COL;
    const c0 = K.out.colliders.length;
    // a box in the lot's frame
    const bx = function (acc, t0, t1, ya, yb, a0, a1, col, o) {
      if (t1 - t0 < 0.004 || yb - ya < 0.004 || a1 - a0 < 0.004) return;
      const c = W((t0 + t1) / 2, (a0 + a1) / 2);
      K.box(acc, c[0], (ya + yb) / 2, c[1], alongX ? t1 - t0 : a1 - a0, yb - ya, alongX ? a1 - a0 : t1 - t0, 0, col, o || {});
    };
    const solid = function (t0, t1, ya, yb, a0, a1, tag) {
      const P = W(t0, a0), Q = W(t1, a1);
      return K.addCol(Math.min(P[0], Q[0]), Math.max(P[0], Q[0]), Math.min(P[1], Q[1]), Math.max(P[1], Q[1]), ya, yb, tag || "yard");
    };
    // a straight run of the island's fence along the street (constant a) or
    // back from it (constant t), with gaps given in the lot's frame
    const run = function (style, t0, a0, t1, a1, gaps, tone) {
      const P = W(t0, a0), Q = W(t1, a1);
      const axisX = Math.abs(Q[0] - P[0]) >= Math.abs(Q[1] - P[1]);
      const gs2 = (gaps || []).map(function (g) {
        const c = Math.abs(t1 - t0) >= Math.abs(a1 - a0) ? W(g.at, a0) : W(t0, g.at);
        return { at: axisX ? c[0] : c[1], w: g.w };
      });
      return K.drain(K.fenceRun(style, P[0], P[1], Q[0], Q[1], gs2, tone, { b: { x: p.x, z: p.z, w: p.w, d: p.d } }));
    };
    // a clipped hedge, bay by bay (the island's hedge bay; its run-layer reads a
    // hedge's own wide collider as something in the next bay's way and lays
    // every other one)
    const hedge = function (t0, a0, t1, a1, gaps) {
      const along = Math.abs(t1 - t0) >= Math.abs(a1 - a0);
      let segs = [[along ? Math.min(t0, t1) : Math.min(a0, a1), along ? Math.max(t0, t1) : Math.max(a0, a1)]];
      for (const g of (gaps || [])) { const nxt = []; for (const s of segs) { const a = g.at - g.w / 2, b = g.at + g.w / 2; if (b <= s[0] || a >= s[1]) { nxt.push(s); continue; } if (a - s[0] > 0.5) nxt.push([s[0], a]); if (s[1] - b > 0.5) nxt.push([b, s[1]]); } segs = nxt; }
      for (const s of segs) {
        const n = Math.max(1, Math.ceil((s[1] - s[0]) / 2.4));
        for (let i = 0; i < n; i++) {
          const u0 = s[0] + (s[1] - s[0]) * i / n, u1 = s[0] + (s[1] - s[0]) * (i + 1) / n;
          const P = along ? W(u0, a0) : W(t0, u0), Q = along ? W(u1, a0) : W(t0, u1);
          K.fenceBay("hedge", P[0], P[1], Q[0], Q[1], null, null);
        }
      }
    };
    // chain link: galvanised posts, a top rail, the mesh as a few wires
    const chain = function (t0, a0, t1, a1, H) {
      const L = Math.hypot(t1 - t0, a1 - a0);
      if (L < 0.6) return;
      const n = Math.max(1, Math.ceil(L / 2.4));
      const P = function (k) { return W(t0 + (t1 - t0) * k, a0 + (a1 - a0) * k); };
      for (let i = 0; i <= n; i++) { const q = P(i / n); K.cylY(A.paint, q[0], y0 - 0.1, q[1], 0.028, 0.028, H + 0.15, 6, COL.galv, { ao: y0 }); }
      const s = P(0), e = P(1);
      K.rod(A.paint, s[0], y0 + H, s[1], e[0], y0 + H, e[1], 0.02, 5, COL.galv, {});
      for (const hh of [0.08, H * 0.35, H * 0.66]) K.beam(A.paint, s[0], y0 + hh, s[1], e[0], y0 + hh, e[1], 0.012, 0.012, K.shade(COL.galv, 0.8), {});
      const m = Math.max(2, Math.round(L / 0.6));
      for (let i = 1; i < m; i++) { const q = P(i / m); K.beam(A.paint, q[0], y0 + 0.05, q[1], q[0], y0 + H, q[1], 0.01, 0.01, K.shade(COL.galv, 0.8), {}); }
      const c = W(Math.min(t0, t1) - 0.04, Math.min(a0, a1) - 0.04), d = W(Math.max(t0, t1) + 0.04, Math.max(a0, a1) + 0.04);
      K.addCol(Math.min(c[0], d[0]), Math.max(c[0], d[0]), Math.min(c[1], d[1]), Math.max(c[1], d[1]), y0, y0 + H, "fence");
    };
    // a 1.8 m board fence (timber) or a rendered garden wall, back from the street or along it
    const tall = function (kind, t0, a0, t1, a1) {
      const along = Math.abs(t1 - t0) >= Math.abs(a1 - a0);
      const lo = along ? Math.min(t0, t1) : Math.min(a0, a1), hi = along ? Math.max(t0, t1) : Math.max(a0, a1);
      if (hi - lo < 0.5) return;
      const fix = along ? a0 : t0;
      const B2 = function (acc, u0, u1, ya, yb, hw, col, o) { if (along) bx(acc, u0, u1, ya, yb, fix - hw, fix + hw, col, o); else bx(acc, fix - hw, fix + hw, ya, yb, u0, u1, col, o); };
      if (kind === "wall") {
        const tone = COL.render[(h01(p.cx, p.cz, 0x7e1) * COL.render.length) | 0];
        B2(A.mason, lo, hi, y0 - 0.2, y0 + 1.85, 0.11, tone, { ao: y0, aoK: 0.35, aoH: 0.5 });
        B2(A.mason, lo - 0.02, hi + 0.02, y0 + 1.85, y0 + 1.92, 0.16, COL.capstone, {});
        for (let u = lo; u <= hi + 0.01; u += Math.max(2.4, (hi - lo) / Math.max(1, Math.round((hi - lo) / 3.2)))) B2(A.mason, u - 0.19, u + 0.19, y0 - 0.2, y0 + 2.0, 0.19, tone, { ao: y0 });
      } else {
        const col = K.vary(COL.timber, h01(p.cx, p.cz, 0x7dc), 0.2);
        const n = Math.max(1, Math.round((hi - lo) / 0.6));
        for (let i = 0; i < n; i++) { const u = lo + (hi - lo) * (i + 0.5) / n; B2(A.wood, u - (hi - lo) / n * 0.47, u + (hi - lo) / n * 0.47, y0 + 0.04, y0 + 1.8 - 0.03 * h01(u, fix, 0x7de), 0.012, K.vary(col, h01(u, fix + 1, 0x7df), 0.12), { ao: y0, aoK: 0.25 }); }
        for (const ry of [0.35, 1.45]) B2(A.wood, lo, hi, y0 + ry, y0 + ry + 0.09, 0.045, K.shade(col, 0.85), {});
        for (let u = lo; u <= hi + 0.01; u += 2.4) B2(A.wood, u - 0.05, u + 0.05, y0 - 0.1, y0 + 1.86, 0.06, K.shade(col, 0.8), { ao: y0 });
      }
      if (along) solid(lo, hi, y0, y0 + 1.85, fix - 0.1, fix + 0.1, "fence"); else solid(fix - 0.1, fix + 0.1, y0, y0 + 1.85, lo, hi, "fence");
    };

    // ---- THE GARAGE WING, or (a poor street) a carport over the drive ---------------
    let garageRect = null;
    let gFront = hA1;                                               // where the drive ends
    if (G) {
      const g0 = G.t - G.w / 2, g1 = G.t + G.w / 2;
      gFront = hA1 - 0.3;
      const gBack = gFront - G.d, gh = 2.9;
      const body = lin(pal.body), trim = lin(pal.trim), roofHex = pal.roof;
      bx(A.paint, g0, g1, y0, y0 + gh, gBack, gFront, body, { ao: y0, aoK: 0.2, aoH: 0.6 });
      bx(A.mason, g0 - 0.03, g1 + 0.03, y0 - 0.25, y0 + 0.2, gBack - 0.03, gFront + 0.03, lin(shadeHex(pal.body, 0.75)), {});
      // the sectional door(s), recessed in a trimmed opening
      const nD = G.w > 5 ? (h01(p.cx, p.cz, 0x7d2) < 0.5 ? 1 : 2) : 1;
      const dw = nD === 1 ? G.w - 0.9 : (G.w - 1.2) / 2;
      const dCol = lin(shadeHex(pal.trim, 0.97));
      for (let i = 0; i < nD; i++) {
        const c = nD === 1 ? G.t : G.t + (i ? 1 : -1) * (dw / 2 + 0.15);
        const a = c - dw / 2, b = c + dw / 2;
        bx(A.paint, a - 0.12, b + 0.12, y0, y0 + 2.3, gFront, gFront + 0.05, trim, {});
        bx(A.paint, a, b, y0 + 0.02, y0 + 2.18, gFront + 0.02, gFront + 0.07, dCol, {});
        for (let k = 1; k < 4; k++) bx(A.paint, a, b, y0 + 2.18 * k / 4 - 0.015, y0 + 2.18 * k / 4 + 0.015, gFront + 0.07, gFront + 0.085, K.shade(dCol, 0.8), {});
        const np = Math.max(2, Math.round(dw / 0.65));
        for (let k = 1; k < np; k++) { const tt = a + dw * k / np; bx(A.paint, tt - 0.012, tt + 0.012, y0 + 0.05, y0 + 2.13, gFront + 0.07, gFront + 0.08, K.shade(dCol, 0.86), {}); }
      }
      // a coach lamp beside the door
      bx(A.paint, g1 + (p.gs > 0 ? -0.6 : 0.1), g1 + (p.gs > 0 ? -0.5 : 0.2), y0 + 1.7, y0 + 2.0, gFront, gFront + 0.06, COL.steelDark, {});
      // the roof: the house's own carpentry, a gable whose end faces the street
      const HP = CBZ.HOUSE_PARTS, F = CBZ.FACADE_F;
      if (HP && F && !pal.flat) {
        const gctx = {
          w: G.w, d: G.d, storeys: 1, FH: gh, rTop: gh, pp: 0, doorSide: 1, noDoor: true, ox: 0, oz: 0,
          hash: function (s) { return h01(p.cx, p.cz, s + 0x7d3); },
          lbox: function (x, y, z, w, h, d, col) {
            // garage-local: x along the street (t), z out toward it (a)
            bx(A.paint, G.t + x - w / 2, G.t + x + w / 2, y0 + y - h / 2, y0 + y + h / 2, (gFront + gBack) / 2 + z - d / 2, (gFront + gBack) / 2 + z + d / 2, lin(col), {});
          },
        };
        gctx.dbox = gctx.lbox;
        try {
          const H = HP.begin(gctx, F);
          H.roof({ kind: h01(p.cx, p.cz, 0x7d4) < 0.6 ? "gable" : "hip", axis: "z", base: gh, pitch: 0.55, step: 0.13, eave: 0.35, rake: 0.25,
            roof: roofHex, roof2: shadeHex(roofHex, 0.9), core: pal.body, coreProj: 0.05, soffit: pal.trim, fascia: pal.trim, ridge: shadeHex(roofHex, 0.8), rakeBoard: true, hipCaps: true });
        } catch (e) {}
      } else {
        // a flat roof: a fascia slab oversailing a little
        bx(A.paint, g0 - 0.3, g1 + 0.3, y0 + gh, y0 + gh + 0.3, gBack - 0.3, gFront + 0.3, lin(pal.flat ? pal.trim : pal.roof), {});
      }
      solid(g0, g1, y0, y0 + gh, gBack, gFront, "garage");
      garageRect = (function () { const a = W(g0, gBack), b = W(g1, gFront); return { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[1], b[1]), maxZ: Math.max(a[1], b[1]) }; })();
    } else if (!ownGarage && tier === "poor" && h01(p.cx, p.cz, 0x7e2) < 0.55 && Math.abs(dC) > 0.5) {
      // a carport: four posts and a tin roof over the head of the drive
      const c0t = dC - driveHalf + 0.1, c1t = dC + driveHalf - 0.1, ca0 = hA1 - 0.2, ca1 = hA1 + 4.4;
      for (const tt of [c0t, c1t]) for (const aa of [ca0 + 0.1, ca1 - 0.1]) { const q = W(tt, aa); K.cylY(A.paint, q[0], y0, q[1], 0.05, 0.05, 2.3, 6, COL.galv, { ao: y0 }); solid(tt - 0.06, tt + 0.06, y0, y0 + 2.3, aa - 0.06, aa + 0.06, "post"); }
      bx(A.paint, c0t - 0.25, c1t + 0.25, y0 + 2.3, y0 + 2.38, ca0 - 0.2, ca1 + 0.3, COL.roofTin, {});
      bx(A.paint, c0t - 0.25, c1t + 0.25, y0 + 2.2, y0 + 2.3, ca1 + 0.22, ca1 + 0.3, K.shade(COL.roofTin, 0.7), {});
    }

    // ---- THE DRIVE: a poured slab from the street to the garage door ----------------
    // (drawn 2 cm proud of the lot: the street kit's crossing meets it at the lot line)
    {
      const d0 = gFront + 0.02, d1 = halfA - 0.02;
      const n = Math.max(1, Math.round((d1 - d0) / 2.6));
      const base = tier === "poor" ? K.shade(COL.concrete, 0.82) : COL.concrete;
      for (let i = 0; i < n; i++) {
        const a = d0 + (d1 - d0) * i / n, b = d0 + (d1 - d0) * (i + 1) / n - 0.035;
        bx(A.mason, dC - driveHalf, dC + driveHalf, y0 - 0.05, y0 + 0.022, a, b, K.vary(base, h01(p.cx + i, p.cz, 0x7e3), 0.07), {});
      }
      if (tier === "poor") {
        // an oil stain, a crack line
        bx(A.asph, dC - 0.45, dC + 0.25, y0 + 0.022, y0 + 0.026, gFront + 1.5, gFront + 2.4, COL.asphalt, {});
        bx(A.asph, dC - driveHalf + 0.2, dC + driveHalf - 0.5, y0 + 0.022, y0 + 0.025, (d0 + d1) / 2, (d0 + d1) / 2 + 0.03, K.shade(COL.concrete, 0.45), {});
      }
    }

    // ---- THE FRONT WALK: door to the street, in poured bays (the island's path) ------
    const walkHits = Math.abs(doorT - dC) < driveHalf + 0.6;     // the door is on the drive: the drive is the walk
    if (!walkHits && halfA - hA1 > 1.0) {
      const P = W(doorT, hA1 + 0.45), Q = W(doorT, halfA - 0.05);
      K.pathSeg(P[0], P[1], Q[0], Q[1], tier === "rich" ? 1.5 : 1.2);
      // a leg along the house front to the drive, so the drive also reaches the door
      const dEdge = dC + Math.sign(doorT - dC) * (driveHalf - 0.05);
      if (h01(p.cx, p.cz, 0x7d6) < 0.6 && Math.abs(doorT - dEdge) > 1.2) { const R = W(doorT, hA1 + 1.0), S = W(dEdge, hA1 + 1.0); K.pathSeg(R[0], R[1], S[0], S[1], 1.0); }
      if (tier === "rich") {
        // low lanterns either side of the walk
        for (const aa of [hA1 + 1.4, (hA1 + halfA) / 2, halfA - 1.2]) for (const sd of [-1, 1]) {
          const q = W(doorT + sd * 1.0, aa);
          K.cylY(A.paint, q[0], y0, q[1], 0.035, 0.035, 0.55, 6, COL.steelDark, { ao: y0 });
          K.box(A.lens, q[0], y0 + 0.62, q[1], 0.12, 0.14, 0.12, 0, [0.9, 0.82, 0.6], {});
          K.box(A.paint, q[0], y0 + 0.7, q[1], 0.16, 0.03, 0.16, 0, COL.steelDark, {});
        }
      }
    }

    // ---- UNDER THE WINDOWS: a planted bed along the house front ----------------------
    {
      const bands = [[hT0 + 0.3, doorT - 1.25], [doorT + 1.25, hT1 - 0.3]];
      let bi = 0;
      for (const bd of bands) {
        bi++;
        let lo = bd[0], hi = bd[1];
        // keep off the drive
        if (hi > dC - driveHalf - 0.2 && lo < dC + driveHalf + 0.2) { if (dC > (lo + hi) / 2) hi = Math.min(hi, dC - driveHalf - 0.2); else lo = Math.max(lo, dC + driveHalf + 0.2); }
        if (hi - lo < 0.9) continue;
        const c = W((lo + hi) / 2, hA1 + 0.62);
        if (tier === "poor") {
          // what grows by itself: a few weeds against the wall
          K.drain(K.shrubs(c[0], c[1], alongX ? (hi - lo) * 0.6 : 0.4, alongX ? 0.4 : (hi - lo) * 0.6, Math.max(1, Math.round((hi - lo) / 2.6)), 0x7d8 + bi, y0, false));
          continue;
        }
        bx(A.soil, lo, hi, y0 - 0.02, y0 + 0.045, hA1 + 0.16, hA1 + 1.12, COL.mulch, {});
        K.drain(K.shrubs(c[0], c[1], alongX ? (hi - lo) * 0.68 : 0.55, alongX ? 0.55 : (hi - lo) * 0.68, Math.max(2, Math.round((hi - lo) / (tier === "rich" ? 0.75 : 1.0))), 0x7d8 + bi, y0 + 0.03, true));
        if (tier === "rich") for (const tt of [lo + 0.45, hi - 0.45]) { const q = W(tt, hA1 + 0.62); K.blob(A.plant, q[0], y0 + 0.5, q[1], 0.42, 0.5, 0.42, K.shade(COL.hedge, 1.1), 7 + bi, { ao: y0, aoK: 0.5, aoH: 0.7 }); }
      }
    }

    // ---- THE STREET LINE: a fence with a gate on the walk, a gap for the drive ---------
    const style = p.style || (tier === "poor" ? (hs < 0.55 ? "chain" : "open")
      : tier === "rich" ? (hs < 0.6 ? "wall" : "hedge")
      : (hs < 0.5 ? "picket" : hs < 0.8 ? "hedge" : "open"));
    const fa = halfA - 0.35;                                      // just inside the lot line
    const gateW = tier === "rich" ? 1.5 : 1.1;
    const gaps = [{ at: dC, w: 2 * driveHalf + 0.5 }];
    if (!walkHits) gaps.push({ at: doorT, w: gateW });
    const tone = COL.render[(h01(p.cx, p.cz, 0x7e1) * COL.render.length) | 0];
    if (style === "chain") {
      // the runs between the gaps
      let segs = [[-halfT + 0.3, halfT - 0.3]];
      for (const g of gaps) { const nxt = []; for (const s of segs) { const a = g.at - g.w / 2, b = g.at + g.w / 2; if (b <= s[0] || a >= s[1]) { nxt.push(s); continue; } if (a - s[0] > 0.5) nxt.push([s[0], a]); if (s[1] - b > 0.5) nxt.push([b, s[1]]); } segs = nxt; }
      for (const s of segs) chain(s[0], fa, s[1], fa, 1.2);
    } else if (style === "hedge") {
      hedge(-halfT + 0.3, fa, halfT - 0.3, fa, gaps);
    } else if (style !== "open") {
      run(style, -halfT + 0.3, fa, halfT - 0.3, fa, gaps, tone);
    }
    // THE GATE on the walk: its posts, and the leaf standing open into the yard
    if (style !== "open" && !walkHits) {
      const gp = W(doorT, fa);
      if (style === "picket" || style === "wall") K.gatePosts(style, gp[0], gp[1], alongX, gateW, tone);
      else for (const sd of [-1, 1]) { const q = W(doorT + sd * (gateW / 2 + 0.06), fa); K.cylY(A.paint, q[0], y0 - 0.1, q[1], 0.04, 0.04, style === "chain" ? 1.4 : 1.25, 8, style === "chain" ? COL.galv : COL.steelDark, { ao: y0 }); }
      // a leaf hinged on each post it needs, swung ~70 degrees in
      const leaves = tier === "rich" ? [[-1, gateW / 2], [1, gateW / 2]] : [[-1, gateW - 0.06]];
      for (const lf of leaves) {
        const hingeT = doorT + lf[0] * (gateW / 2 - 0.02), L = lf[1] - 0.04;
        const ang = 1.2;
        // the leaf's own direction, in the lot's frame: turned from along the street toward the house
        const et = -lf[0] * Math.cos(ang), ea = -Math.sin(ang);
        const at = function (u) { return W(hingeT + et * u, fa + ea * u); };
        const yaw = (function () { const a = at(0), b = at(1); return Math.atan2(-(b[1] - a[1]), b[0] - a[0]); })();
        const piece = function (acc, u0, u1, ya, yb, th, col) { const c = at((u0 + u1) / 2); K.box(acc, c[0], (ya + yb) / 2, c[1], u1 - u0, yb - ya, th, yaw, col, {}); };
        if (style === "picket") {
          for (const ry of [0.24, 0.72]) piece(A.wood, 0.02, L, y0 + ry, y0 + ry + 0.07, 0.03, COL.paintWhite);
          for (let u = 0.06; u < L; u += 0.14) piece(A.wood, u - 0.035, u + 0.035, y0 + 0.07, y0 + 0.95, 0.018, COL.paintWhite);
        } else if (style === "chain") {
          for (const ry of [0.06, 1.14]) piece(A.paint, 0, L, y0 + ry, y0 + ry + 0.035, 0.035, COL.galv);
          for (const u of [0.02, L - 0.02]) piece(A.paint, u - 0.018, u + 0.018, y0 + 0.06, y0 + 1.17, 0.035, COL.galv);
          for (let u = 0.2; u < L - 0.1; u += 0.22) piece(A.paint, u - 0.005, u + 0.005, y0 + 0.08, y0 + 1.14, 0.01, K.shade(COL.galv, 0.8));
        } else {
          // iron: a frame, upright bars, a rail of finials
          const IR = COL.steelDark, top = style === "wall" ? 1.25 : 1.15;
          for (const ry of [0.1, top - 0.12]) piece(A.paint, 0, L, y0 + ry, y0 + ry + 0.04, 0.04, IR);
          for (let u = 0.03; u <= L; u += 0.125) piece(A.paint, u - 0.012, u + 0.012, y0 + 0.1, y0 + top + (Math.abs(u - L / 2) < L / 4 ? 0.1 : 0.03), 0.024, IR);
        }
      }
    }
    // the front yard's side line on the far side from the drive, low, in the street's style
    if (style === "picket" || style === "hedge" || style === "wall") {
      const st = -Math.sign(dC || p.gs) * (halfT - 0.3);
      if (hA1 + 0.4 < fa - 0.5) { if (style === "hedge") hedge(st, hA1 + 0.4, st, fa - 0.45, null); else run(style, st, hA1 + 0.4, st, fa, null, tone); }
    }

    // ---- THE BACK YARD -----------------------------------------------------------------
    // (each shared line is drawn by one lot: the +t side here, the back line
    // only on lots facing +x / +z, so two neighbours never stack two fences)
    const backKind = tier === "poor" ? (h01(p.cx, p.cz, 0x7db) < 0.6 ? "chain" : "none") : tier === "rich" ? "wall" : "board";
    const sideT = halfT - 0.05, backA = -halfA + 0.05;
    const yardA = hA0 + Math.min(1.0, p.hd * 0.2);                // the returns to the house's back corners
    const nearA = G ? Math.min(yardA, gFront - G.d - 0.15) : yardA;
    if (backKind !== "none") {
      const line = function (t0, a0, t1, a1) { if (backKind === "chain") chain(t0, a0, t1, a1, 1.5); else tall(backKind, t0, a0, t1, a1); };
      // the returns: from each back corner of the house (or the garage) out to the side line
      const loEdge = G && G.t < p.t ? G.t - G.w / 2 : hT0, hiEdge = G && G.t > p.t ? G.t + G.w / 2 : hT1;
      const loA = G && G.t < p.t ? nearA : yardA, hiA = G && G.t > p.t ? nearA : yardA;
      // (a side gate's width left open in the return on the side away from the drive)
      const gateSide = dC > 0 ? -1 : 1;
      if (sideT - hiEdge > 0.6) { if (gateSide > 0 && sideT - hiEdge > 1.8) line(hiEdge + 1.05, hiA, sideT, hiA); else line(hiEdge + 0.05, hiA, sideT, hiA); }
      if (loEdge + sideT > 0.6) { if (gateSide < 0 && loEdge + sideT > 1.8) line(-sideT, loA, loEdge - 1.05, loA); else line(-sideT, loA, loEdge - 0.05, loA); }
      line(sideT, backA, sideT, hiA);
      if (nx + nz > 0) line(-sideT + 0.05, backA, sideT - 0.05, backA);
    }
    // what is in it
    {
      const yd0 = backA + 0.5, yd1 = hA0 - 0.4, depth = yd1 - yd0;
      const mid = p.t;
      if (depth >= 2.2 && tier !== "poor") {
        // a patio behind the house: pavers, a table and chairs
        const pw = Math.min(4.2, p.hw - 1.5), pd = Math.min(3.0, depth - 0.4);
        const n = Math.max(2, Math.round(pw / 0.9)), m = Math.max(2, Math.round(pd / 0.9));
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++)
          bx(A.mason, mid - pw / 2 + pw * i / n + 0.01, mid - pw / 2 + pw * (i + 1) / n - 0.01, y0 - 0.04, y0 + 0.03, yd1 - pd * (j + 1) / m + 0.01, yd1 - pd * j / m - 0.01, K.vary(COL.pavers, h01(p.cx + i, p.cz + j, 0x7f1), 0.1), {});
        if (pd >= 1.9) {
          const ta = yd1 - pd / 2, tt = mid - pw * 0.18;
          const TB = lin(0x5a4632);
          bx(A.wood, tt - 0.6, tt + 0.6, y0 + 0.7, y0 + 0.75, ta - 0.4, ta + 0.4, TB, {});
          for (const e of [-1, 1]) for (const f of [-1, 1]) bx(A.wood, tt + e * 0.52 - 0.03, tt + e * 0.52 + 0.03, y0 + 0.03, y0 + 0.7, ta + f * 0.32 - 0.03, ta + f * 0.32 + 0.03, TB, { ao: y0 });
          for (const e of [-1, 1]) { bx(A.wood, tt + e * 0.95 - 0.22, tt + e * 0.95 + 0.22, y0 + 0.4, y0 + 0.45, ta - 0.22, ta + 0.22, TB, {}); bx(A.wood, tt + e * 1.15 - 0.03, tt + e * 1.15 + 0.03, y0 + 0.03, y0 + 0.9, ta - 0.22, ta + 0.22, TB, { ao: y0 }); for (const f of [-1, 1]) bx(A.wood, tt + e * 0.77 - 0.025, tt + e * 0.77 + 0.025, y0 + 0.03, y0 + 0.4, ta + f * 0.19 - 0.025, ta + f * 0.19 + 0.025, TB, {}); }
          solid(tt - 0.6, tt + 0.6, y0, y0 + 0.75, ta - 0.4, ta + 0.4, "table");
          // a kettle barbecue at the patio's end
          const q = W(mid + pw * 0.34, yd1 - 0.6);
          K.cylY(A.paint, q[0], y0 + 0.55, q[1], 0.26, 0.3, 0.2, 10, COL.steelDark, {});
          K.cylY(A.paint, q[0], y0 + 0.75, q[1], 0.3, 0.12, 0.16, 10, COL.steelDark, {});
          for (const e of [[-0.18, -0.12], [0.18, -0.12], [0, 0.2]]) K.cylY(A.paint, q[0] + e[0], y0, q[1] + e[1], 0.015, 0.015, 0.56, 5, COL.galv, {});
          K.addCol(q[0] - 0.3, q[0] + 0.3, q[1] - 0.3, q[1] + 0.3, y0, y0 + 0.9, "bbq");
        }
      }
      if (tier === "rich" && depth >= 5.2 && p.lotT >= 20) {
        // a pool along the back: stone coping, the water a hand below it
        const pl = Math.min(8, p.lotT - 9), pwd = Math.min(3.6, depth - 3.6), pc = mid * 0.4, pa = yd0 + 0.9 + pwd / 2;
        bx(A.mason, pc - pl / 2 - 0.35, pc + pl / 2 + 0.35, y0 - 0.1, y0 + 0.06, pa - pwd / 2 - 0.35, pa + pwd / 2 + 0.35, COL.capstone, {});
        bx(A.paint, pc - pl / 2, pc + pl / 2, y0 + 0.02, y0 + 0.064, pa - pwd / 2, pa + pwd / 2, [0.05, 0.3, 0.42], {});
        bx(A.paint, pc - pl / 2 + 0.25, pc + pl / 2 - 0.25, y0 + 0.064, y0 + 0.066, pa - pwd / 2 + 0.25, pa + pwd / 2 - 0.25, [0.08, 0.4, 0.52], {});
        // two loungers on the house side
        for (const e of [-1, 1]) { const lt = pc + e * 1.1, la = pa + pwd / 2 + 1.05; bx(A.wood, lt - 0.32, lt + 0.32, y0 + 0.24, y0 + 0.3, la - 0.9, la + 0.9, COL.paintWhite, {}); bx(A.wood, lt - 0.32, lt + 0.32, y0 + 0.3, y0 + 0.36, la + 0.45, la + 0.9, COL.paintCream, {}); for (const f of [-0.7, 0.7]) bx(A.wood, lt - 0.3, lt + 0.3, y0 + 0.02, y0 + 0.24, la + f - 0.03, la + f + 0.03, COL.paintWhite, {}); solid(lt - 0.32, lt + 0.32, y0, y0 + 0.36, la - 0.9, la + 0.9, "lounger"); }
      } else if (tier === "rich" && depth >= 2.6) {
        // a clipped hedge along the back wall
        if (yd0 + 0.5 < yd1 - 2.6) hedge(-sideT + 0.6, yd0 + 0.45, sideT - 0.6, yd0 + 0.45, null);
      }
      if (tier !== "rich" && depth >= 2.0) {
        // a washing line: two posts and the lines between them, shirts on it
        const wa = yd0 + Math.min(0.9, depth * 0.35), w0 = -halfT + 1.6, w1 = Math.min(-halfT + 6.4, hT0 + 3);
        if (w1 - w0 > 2.2) {
          const P = W(w0, wa), Q = W(w1, wa);
          for (const q of [P, Q]) { K.cylY(A.paint, q[0], y0 - 0.1, q[1], 0.03, 0.03, 1.95, 6, COL.galv, { ao: y0 }); K.addCol(q[0] - 0.05, q[0] + 0.05, q[1] - 0.05, q[1] + 0.05, y0, y0 + 1.85, "post"); }
          for (const off of [-0.18, 0.18]) { const o2 = W(0, off), z0 = W(0, 0); K.rod(A.paint, P[0] + o2[0] - z0[0], y0 + 1.8, P[1] + o2[1] - z0[1], Q[0] + o2[0] - z0[0], y0 + 1.8, Q[1] + o2[1] - z0[1], 0.006, 4, [0.6, 0.6, 0.58], {}); }
          const CL = [[0.5, 0.5, 0.48], [0.1, 0.2, 0.42], [0.45, 0.08, 0.08], [0.55, 0.5, 0.2]];
          for (let i = 0; i < 4; i++) { const u = w0 + (w1 - w0) * (0.16 + i * 0.22); bx(A.paint, u - 0.26, u + 0.26, y0 + 1.15 + (i & 1) * 0.12, y0 + 1.8, wa - 0.185, wa - 0.175, CL[(i + ((hs * 4) | 0)) % 4], {}); }
        }
      }
      if (tier === "mid" && depth >= 2.4 && h01(p.cx, p.cz, 0x7f2) < 0.7) {
        // a shed in the back corner on the drive's side
        const sd = dC > 0 ? 1 : -1, s0 = sd * (halfT - 2.6), sa = yd0 + 0.9;
        const SW = lin(0x6a5a44);
        bx(A.wood, s0 - 0.95, s0 + 0.95, y0, y0 + 1.9, sa - 0.75, sa + 0.75, SW, { ao: y0, aoK: 0.3 });
        bx(A.paint, s0 - 1.1, s0 + 1.1, y0 + 1.9, y0 + 2.0, sa - 0.9, sa + 0.9, COL.roofTin, {});
        bx(A.wood, s0 - 0.35, s0 + 0.35, y0 + 0.05, y0 + 1.7, sa + 0.75, sa + 0.78, K.shade(SW, 0.8), {});
        solid(s0 - 0.95, s0 + 0.95, y0, y0 + 2.0, sa - 0.75, sa + 0.75, "shed");
      }
      if (tier === "poor" && depth >= 1.6) {
        // what got left out the back: a stack of tyres, a rusted drum, a pallet
        const jt = (dC > 0 ? -1 : 1) * (halfT - 2.2), ja = yd0 + 0.8;
        const q = W(jt, ja);
        for (let i = 0; i < 3; i++) K.cylY(A.paint, q[0] + (i === 2 ? 0.5 : 0), y0 + (i === 2 ? 0 : i * 0.2), q[1] + (i === 2 ? 0.3 : 0), 0.3, 0.3, 0.2, 10, [0.03, 0.03, 0.035], {});
        const r = W(jt + 1.3, ja + 0.2);
        K.cylY(A.paint, r[0], y0, r[1], 0.29, 0.29, 0.86, 10, [0.3, 0.13, 0.06], { ao: y0 });
        bx(A.wood, jt - 1.7, jt - 0.7, y0, y0 + 0.14, ja - 0.4, ja + 0.4, K.shade(COL.timberGrey, 1.4), {});
        K.addCol(q[0] - 0.35, q[0] + 0.35, q[1] - 0.35, q[1] + 0.35, y0, y0 + 0.4, "junk");
        K.addCol(r[0] - 0.3, r[0] + 0.3, r[1] - 0.3, r[1] + 0.3, y0, y0 + 0.86, "junk");
        // bare earth where the grass gave up
        bx(A.soil, jt - 2.2, jt + 2.0, y0 - 0.02, y0 + 0.012, ja - 0.9, ja + 1.0, COL.soil, {});
      }
    }

    // ---- THE MAILBOX at the kerb beside the drive, the bin in the side yard -----------
    {
      let mt = dC - p.gs * (driveHalf + 0.55);
      if (Math.abs(mt) > halfT - 0.4) mt = dC + p.gs * (driveHalf + 0.55);
      const q = W(mt, halfA - 0.25);
      K.mailbox(q[0], q[1], Math.atan2(nx, nz));
      K.addCol(q[0] - 0.14, q[0] + 0.14, q[1] - 0.14, q[1] + 0.14, y0, y0 + 1.25, "mailbox");
      // the wheelie bin: against the house's side wall, on the drive's side
      const bt = dC > p.t ? hT1 + 0.5 : hT0 - 0.5;
      if (Math.abs(bt) < halfT - 0.6 && !(G && Math.abs(bt - G.t) < G.w / 2 + 0.4)) { const r = W(bt, hA1 - 1.3); K.wheelieBin(r[0], r[1], Math.atan2(tx, tz) * (bt > p.t ? 1 : -1), 0x7e5); }
      else { const r = W(dC + Math.sign(dC - p.t || 1) * (driveHalf + 0.5), gFront + 0.5); if (Math.abs(dC + Math.sign(dC - p.t || 1) * (driveHalf + 0.5)) < halfT - 0.5) K.wheelieBin(r[0], r[1], 0, 0x7e5); }
    }

    // ---- WHERE A CAR STANDS ON THIS LOT (city/realestate.js keeps the owner's there) ----
    // on the drive, its nose to the garage door (or to the house, on a lot with none)
    const standA = Math.min(gFront + 3.1, halfA - 2.5 > gFront + 2.2 ? halfA - 2.5 : gFront + 3.1);
    const heading = Math.atan2(-nx, -nz);
    const stands = [];
    if (driveHalf > 2.4) for (const e of [-1, 1]) { const q = W(dC + e * 1.35, standA); stands.push({ x: q[0], z: q[1], heading: heading }); }
    else { const q = W(dC, standA); stands.push({ x: q[0], z: q[1], heading: heading }); const q2 = W(dC, standA + 5.4); if (standA + 7.4 < halfA) stands.push({ x: q2[0], z: q2[1], heading: heading }); }
    const b = p.lot && p.lot.building;
    if (b && (!b.garage || b.garage.approach || b.garage.house)) b.garage = { x: stands[0].x, z: stands[0].z, heading: heading, stands: stands, spots: [], house: true };

    // ---- ONE MESH ------------------------------------------------------------------------
    let nv = 0;
    for (const k in A) nv += A[k].p.length;
    const cols = K.out.colliders.slice(c0);
    if (!nv) return { mesh: null, colliders: cols, garageRect: garageRect, stand: stands[0] };
    const P = new Float32Array(nv), N = new Float32Array(nv), C = new Float32Array(nv);
    let o = 0;
    for (const k in A) { const a = A[k]; P.set(a.p, o); N.set(a.n, o); C.set(a.c, o); o += a.p.length; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(C, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, yardMat());
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.name = "house-lot";
    root.add(mesh);
    for (const c of cols) if (c.dressing !== "fence") c.ref = mesh;
    return { mesh: mesh, colliders: cols, garageRect: garageRect, stand: stands[0] };
  };

  CBZ.houseLot = HL;
})();
