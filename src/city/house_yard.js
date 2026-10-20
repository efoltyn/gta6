/* ============================================================
   city/house_yard.js — THE HOUSE LOT: a detached house standing on its land.

   OWNER: "the houses in the game are also dumb."

   What made them dumb, read off the code: a town home was its lot less 75 cm
   a side (a 14 x 14 m box shouldered against the next one), a Gang City
   house street put one 23 m three-storey block on every 30 m parcel, and
   neither had anything round it but painted grass. A house reads as a house
   from the street and from the air because of its LAND: it stands back from
   the street behind a front yard, it has side yards, a driveway runs past it
   to a garage, a walk runs to its door, and the lot is bounded by a hedge or
   a fence with a mailbox at the kerb.

   This file is that, and nothing else:

     CBZ.houseLot.plan(o)    lot + door face + the house the street wants ->
                             where the house stands (centre, size) and where
                             its garage goes, so the driveway the approach
                             (city/approach.js) lays on the lot's centreline
                             ends at a garage door, not at the front door.
     CBZ.houseLot.dress(root, p)   the land round a built house: the attached
                             garage wing (walls, door, a roof in the house's
                             own carpentry, house_parts.js), a front walk, the
                             front hedge / picket / low wall with its gaps, a
                             back-yard privacy fence, foundation shrubs, a
                             mailbox. One vertex-coloured mesh per lot (one
                             draw call), colliders for everything you could
                             walk into.

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
  function shade(hex, f) {
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
          garage: bool (allowed), salt }
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
    const rear = clamp(lotA * 0.12, 1.5, HL.REAR + 2);
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
      // a single garage at the end of a side drive, the house against it
      const gw = HL.GARAGE1;
      const gC = lotT / 2 - 0.5 - gw / 2;                        // the garage (and drive) centre, from the lot centre
      const withG = room + gC - gw / 2;                           // the house from the garage edge to the far side yard
      if (o.garage !== false && withG >= minW && hd > HL.GARAGE_D * 0.7) {
        hw = Math.min(hw, withG);
        driveAt = -gs * gC;
        garage = { t: driveAt, w: gw, d: Math.min(HL.GARAGE_D, hd - 0.5) };
        const u0 = gC - gw / 2;                                   // the garage's inner edge, on the house's side
        t = gs * (-u0 + hw / 2);
      } else {
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
       storeys, fh   (the garage wing stays one storey)
       style  "hedge" | "picket" | "wall" | "open" (default: hashed)
       pal    { body, trim, roof } (default: the house grammar's, published
              by city/facades/house_parts.js, else neutral)
       ownGarage  the house grammar drew its own garage door (the ranch)
     Returns { mesh, colliders, garageRect }. */
  let _mat = null;
  function yardMat() {
    if (_mat) return _mat;
    _mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    _mat._shared = true;
    return _mat;
  }
  HL.dress = function (root, p) {
    if (!root || !p) return null;
    const BGU = THREE.BufferGeometryUtils;
    const y0 = p.y || 0;
    const geos = [];
    const cols = [];
    const nx = p.nx, nz = p.nz, tx = p.tx, tz = p.tz;
    // (t, a) -> world. t along the street, a out toward it, both from the lot centre.
    const W = function (t, a) { return [p.cx + tx * t + nx * a, p.cz + tz * t + nz * a]; };
    function box(t0, t1, ya, yb, a0, a1, col) {
      if (t1 - t0 < 0.005 || yb - ya < 0.005 || a1 - a0 < 0.005) return;
      const c = W((t0 + t1) / 2, (a0 + a1) / 2);
      const sx = Math.abs(nx) > 0.5 ? a1 - a0 : t1 - t0, sz = Math.abs(nx) > 0.5 ? t1 - t0 : a1 - a0;
      const g = new THREE.BoxGeometry(sx, yb - ya, sz);
      g.deleteAttribute("uv");
      g.translate(c[0], (ya + yb) / 2, c[1]);
      const n = g.attributes.position.count, ca = new Float32Array(n * 3);
      const r = ((col >> 16) & 255) / 255, gg = ((col >> 8) & 255) / 255, b = (col & 255) / 255;
      for (let i = 0; i < n; i++) { ca[i * 3] = r; ca[i * 3 + 1] = gg; ca[i * 3 + 2] = b; }
      g.setAttribute("color", new THREE.BufferAttribute(ca, 3));
      geos.push(g);
    }
    function solid(t0, t1, ya, yb, a0, a1) {
      if (!CBZ.colliders) return null;
      const A = W(t0, a0), B = W(t1, a1);
      const c = { minX: Math.min(A[0], B[0]), maxX: Math.max(A[0], B[0]), minZ: Math.min(A[1], B[1]), maxZ: Math.max(A[1], B[1]), y0: ya, y1: yb, ref: null, noCam: true, dressing: "yard" };
      CBZ.colliders.push(c); cols.push(c);
      return c;
    }
    const halfT = p.lotT / 2, halfA = p.lotA / 2;
    const hT0 = p.t - p.hw / 2, hT1 = p.t + p.hw / 2;           // the house along the street
    const hA1 = p.a + p.hd / 2, hA0 = p.a - p.hd / 2;           // its front face, its back
    const doorT = p.doorT != null ? p.doorT : p.t;
    const pal = p.pal || (CBZ.HOUSE_PARTS && CBZ.HOUSE_PARTS.palAt(p.x, p.z)) || { body: 0xb9ae98, trim: 0xe9e5da, roof: 0x4a4a48 };
    const hs = h01(p.cx, p.cz, 0x7d1);
    const style = p.style || (hs < 0.32 ? "hedge" : hs < 0.55 ? "picket" : hs < 0.68 ? "wall" : "open");
    const GREEN = [0x3c5a2c, 0x46632f, 0x36522a], greenAt = function (s) { return GREEN[(h01(p.cx, p.cz, s) * GREEN.length) | 0]; };
    const WOOD = 0x8a6e52, CONC = 0xa9a69c, WHITE = 0xece9e0;
    const driveHalf = p.driveHalf != null ? p.driveHalf : HL.DRIVE / 2;
    const dC = p.driveAt || 0;                                     // the drive's centre along the street

    // ---- THE GARAGE WING ----------------------------------------------------------
    let garageRect = null;
    const ownGarage = !!(p.ownGarage || pal.ownGarage);
    if (p.garage && !ownGarage) {
      const G = p.garage;
      const g0 = G.t - G.w / 2, g1 = G.t + G.w / 2;
      const gFront = hA1 - 0.3, gBack = gFront - G.d;
      const gh = 2.9;
      const body = pal.body, trim = pal.trim, roof = pal.roof;
      box(g0, g1, y0, y0 + gh, gBack, gFront, body);                            // the walls
      box(g0 - 0.03, g1 + 0.03, y0 - 0.25, y0 + 0.2, gBack - 0.03, gFront + 0.03, shade(body, 0.75));
      // the sectional door(s), recessed in a trimmed opening
      const nD = G.w > 5 ? (h01(p.cx, p.cz, 0x7d2) < 0.5 ? 1 : 2) : 1;
      const dw = nD === 1 ? G.w - 0.9 : (G.w - 1.2) / 2;
      const dCol = shade(trim, 0.97);
      for (let i = 0; i < nD; i++) {
        const c = nD === 1 ? G.t : G.t + (i ? 1 : -1) * (dw / 2 + 0.15);
        const a = c - dw / 2, b = c + dw / 2;
        box(a - 0.12, b + 0.12, y0, y0 + 2.3, gFront, gFront + 0.05, trim);
        box(a, b, y0 + 0.02, y0 + 2.18, gFront + 0.02, gFront + 0.07, dCol);
        for (let k = 1; k < 4; k++) box(a, b, y0 + 2.18 * k / 4 - 0.015, y0 + 2.18 * k / 4 + 0.015, gFront + 0.07, gFront + 0.085, shade(dCol, 0.84));
        const np = Math.max(2, Math.round(dw / 0.65));
        for (let k = 1; k < np; k++) { const tt = a + dw * k / np; box(tt - 0.012, tt + 0.012, y0 + 0.05, y0 + 2.13, gFront + 0.07, gFront + 0.08, shade(dCol, 0.88)); }
      }
      // a coach lamp beside the door, a side door into the yard
      box(g1 + (p.gs > 0 ? -0.6 : 0.1) - 0.0, g1 + (p.gs > 0 ? -0.5 : 0.2), y0 + 1.7, y0 + 2.0, gFront, gFront + 0.06, 0x2a2a2a);
      // the roof: the house's own carpentry, a gable whose end faces the street
      const HP = CBZ.HOUSE_PARTS, F = CBZ.FACADE_F;
      if (HP && F && !pal.flat) {
        const gctx = {
          w: G.w, d: G.d, storeys: 1, FH: gh, rTop: gh, pp: 0, doorSide: 1, noDoor: true, ox: 0, oz: 0,
          hash: function (s) { return h01(p.cx, p.cz, s + 0x7d3); },
          lbox: function (x, y, z, w, h, d, col) {
            // garage-local: x along the street (t), z out toward it (a)
            box(G.t + x - w / 2, G.t + x + w / 2, y0 + y - h / 2, y0 + y + h / 2, (gFront + gBack) / 2 + z - d / 2, (gFront + gBack) / 2 + z + d / 2, col);
          },
        };
        gctx.dbox = gctx.lbox;
        const H = HP.begin(gctx, F);
        H.roof({ kind: h01(p.cx, p.cz, 0x7d4) < 0.6 ? "gable" : "hip", axis: "z", base: gh, pitch: 0.55, step: 0.13, eave: 0.35, rake: 0.25,
          roof: roof, roof2: shade(roof, 0.9), core: body, coreProj: 0.05, soffit: trim, fascia: trim, ridge: shade(roof, 0.8), rakeBoard: true, hipCaps: true });
      } else {
        // a flat roof: a fascia slab oversailing a little
        box(g0 - 0.3, g1 + 0.3, y0 + gh, y0 + gh + 0.3, gBack - 0.3, gFront + 0.3, pal.flat ? pal.trim : roof);
      }
      solid(g0, g1, y0, y0 + gh, gBack, gFront);
      garageRect = (function () { const A = W(g0, gBack), B = W(g1, gFront); return { minX: Math.min(A[0], B[0]), maxX: Math.max(A[0], B[0]), minZ: Math.min(A[1], B[1]), maxZ: Math.max(A[1], B[1]) }; })();
    }

    // ---- THE FRONT WALK: door to the street, in poured bays -----------------------
    const walkA0 = hA1 + 0.15, walkA1 = halfA - 0.05;
    const walkHits = Math.abs(doorT - dC) < driveHalf + 0.6;     // the door is on the drive: the drive is the walk
    if (!walkHits && walkA1 - walkA0 > 0.6) {
      const n = Math.max(1, Math.round((walkA1 - walkA0) / 1.2));
      for (let i = 0; i < n; i++) {
        const a = walkA0 + (walkA1 - walkA0) * i / n, b = walkA0 + (walkA1 - walkA0) * (i + 1) / n - 0.03;
        box(doorT - 0.6, doorT + 0.6, y0 - 0.02, y0 + 0.035, a, b, shade(CONC, 0.96 + 0.08 * h01(p.cx + i, p.cz, 0x7d5)));
      }
      // a leg along the house front to the drive, so the drive also reaches the door
      const legA = hA1 + 0.15;
      const dEdge = dC + Math.sign(doorT - dC) * (driveHalf - 0.05);
      const d0 = Math.min(doorT, dEdge), d1 = Math.max(doorT, dEdge);
      if (h01(p.cx, p.cz, 0x7d6) < 0.5 && d1 - d0 > 0.8) box(d0, d1, y0 - 0.02, y0 + 0.035, legA, legA + 1.0, CONC);
    }

    // ---- FOUNDATION SHRUBS along the house front ----------------------------------
    {
      const sa0 = hA1 + 0.25, sa1 = hA1 + 0.95;
      const bands = [[hT0 + 0.3, doorT - 1.25], [doorT + 1.25, hT1 - 0.3]];
      for (const bd of bands) {
        if (bd[1] - bd[0] < 0.8) continue;
        // keep off the drive
        const lo = bd[0], hi = bd[1];
        const n = Math.max(1, Math.round((hi - lo) / 1.1));
        for (let i = 0; i < n; i++) {
          const a = lo + (hi - lo) * i / n + 0.08, b = lo + (hi - lo) * (i + 1) / n - 0.08;
          if (Math.max(a, b) > dC - driveHalf && Math.min(a, b) < dC + driveHalf) continue;
          const hh = 0.6 + 0.35 * h01(p.cx + a, p.cz + i, 0x7d7);
          box(a, b, y0, y0 + hh, sa0, sa1, greenAt(0x7d8 + i));
        }
        box(lo, hi, y0 - 0.02, y0 + 0.04, sa0 - 0.1, sa1 + 0.1, 0x4a3628);              // the mulch bed
      }
    }

    // ---- THE FRONT LINE: a hedge, a picket fence or a low wall, with gaps -----------
    const fa = halfA - 0.35;                                      // just inside the lot line
    const gaps = [[dC - driveHalf - 0.3, dC + driveHalf + 0.3]];
    if (!walkHits) gaps.push([doorT - 0.75, doorT + 0.75]);
    const runs = (function () {
      let out = [[-halfT + 0.3, halfT - 0.3]];
      for (const g of gaps) {
        const nx2 = [];
        for (const r of out) {
          if (g[1] <= r[0] || g[0] >= r[1]) { nx2.push(r); continue; }
          if (g[0] - r[0] > 0.4) nx2.push([r[0], g[0]]);
          if (r[1] - g[1] > 0.4) nx2.push([g[1], r[1]]);
        }
        out = nx2;
      }
      return out;
    })();
    for (const r of runs) {
      if (style === "hedge") {
        const n = Math.max(1, Math.round((r[1] - r[0]) / 1.6));
        for (let i = 0; i < n; i++) {
          const a = r[0] + (r[1] - r[0]) * i / n, b = r[0] + (r[1] - r[0]) * (i + 1) / n;
          const hh = 1.05 + 0.12 * h01(p.cx + a, p.cz, 0x7d9);
          box(a, b + 0.02, y0, y0 + hh - 0.12, fa - 0.38, fa + 0.38, greenAt(0x7da + i));
          box(a + 0.03, b - 0.01, y0 + hh - 0.12, y0 + hh, fa - 0.3, fa + 0.3, shade(greenAt(0x7da + i), 1.12));
        }
        solid(r[0], r[1], y0, y0 + 1.1, fa - 0.38, fa + 0.38);
      } else if (style === "picket") {
        const col = WHITE;
        box(r[0], r[1], y0 + 0.2, y0 + 0.28, fa - 0.06, fa - 0.02, col);
        box(r[0], r[1], y0 + 0.72, y0 + 0.8, fa - 0.06, fa - 0.02, col);
        for (let t = r[0]; t <= r[1] + 0.01; t += 2.4) box(t - 0.05, t + 0.05, y0 - 0.1, y0 + 1.05, fa - 0.07, fa + 0.03, col);
        for (let t = r[0] + 0.1; t < r[1] - 0.05; t += 0.16) box(t - 0.035, t + 0.035, y0 + 0.06, y0 + 0.95, fa - 0.01, fa + 0.01, col);
        solid(r[0], r[1], y0, y0 + 1.0, fa - 0.08, fa + 0.05);
      } else if (style === "wall") {
        const col = shade(pal.body, 0.92);
        box(r[0], r[1], y0 - 0.2, y0 + 0.62, fa - 0.12, fa + 0.12, col);
        box(r[0] - 0.03, r[1] + 0.03, y0 + 0.62, y0 + 0.7, fa - 0.16, fa + 0.16, shade(pal.trim, 0.95));
        for (const t of [r[0], r[1]]) box(t - 0.2, t + 0.2, y0 - 0.2, y0 + 0.85, fa - 0.2, fa + 0.2, col);
        solid(r[0], r[1], y0, y0 + 0.75, fa - 0.16, fa + 0.16);
      }
    }

    // ---- THE BACK YARD: a 1.8 m board fence from the house's back corners --------
    // (each shared line is drawn by one lot: the +t side here, the back line
    // only on lots facing +x / +z, so two neighbours never stack two fences)
    if (h01(p.cx, p.cz, 0x7db) < 0.7) {
      const bh = 1.8, col = shade(WOOD, 0.9 + 0.2 * h01(p.cx, p.cz, 0x7dc));
      const sideT = halfT - 0.05, backA = -halfA + 0.05;
      const fenceAlongA = function (t, a0, a1) {
        if (a1 - a0 < 0.5) return;
        box(t - 0.03, t + 0.03, y0, y0 + bh, a0, a1, col);
        for (let a = a0; a <= a1 + 0.01; a += 2.4) box(t - 0.06, t + 0.06, y0, y0 + bh + 0.08, a - 0.05, a + 0.05, shade(col, 0.85));
        solid(t - 0.05, t + 0.05, y0, y0 + bh, a0, a1);
      };
      const fenceAlongT = function (a, t0, t1) {
        if (t1 - t0 < 0.5) return;
        box(t0, t1, y0, y0 + bh, a - 0.03, a + 0.03, col);
        for (let t = t0; t <= t1 + 0.01; t += 2.4) box(t - 0.05, t + 0.05, y0, y0 + bh + 0.08, a - 0.06, a + 0.06, shade(col, 0.85));
        solid(t0, t1, y0, y0 + bh, a - 0.05, a + 0.05);
      };
      // from the house's back corners out to the side lines
      const yardA = hA0 + Math.min(1.0, p.hd * 0.2);
      // the house's own side (away from the drive) and the drive's side,
      // which on a garage lot closes behind the garage against the house wall
      const farA = yardA, nearA = (p.garage && !ownGarage) ? Math.min(yardA, hA1 - 0.3 - p.garage.d - 0.15) : yardA;
      if (p.gs > 0) { fenceAlongT(farA, hT1 + 0.05, sideT); fenceAlongT(nearA, -sideT, hT0 - 0.05); }
      else { fenceAlongT(farA, -sideT, hT0 - 0.05); fenceAlongT(nearA, hT1 + 0.05, sideT); }
      fenceAlongA(sideT, backA, p.gs > 0 ? farA : nearA);
      if (nx + nz > 0) fenceAlongT(backA, -halfT + 0.05, halfT - 0.05);
    }

    // ---- THE MAILBOX at the kerb, beside the drive -------------------------------
    {
      let mt = dC - p.gs * (driveHalf + 0.55);
      if (Math.abs(mt) > halfT - 0.4) mt = dC + p.gs * (driveHalf + 0.55);
      const ma = halfA - 0.25;
      box(mt - 0.045, mt + 0.045, y0 - 0.1, y0 + 1.05, ma - 0.045, ma + 0.045, WOOD);
      box(mt - 0.11, mt + 0.11, y0 + 1.05, y0 + 1.25, ma - 0.25, ma + 0.25, h01(p.cx, p.cz, 0x7dd) < 0.5 ? 0x2c2e30 : 0x575a5c);
      box(mt + 0.11, mt + 0.125, y0 + 1.15, y0 + 1.3, ma - 0.05, ma + 0.08, 0xa02622);
      solid(mt - 0.12, mt + 0.12, y0, y0 + 1.25, ma - 0.25, ma + 0.25);
    }

    if (!geos.length) return { mesh: null, colliders: cols, garageRect: garageRect };
    let mesh = null;
    if (BGU && BGU.mergeBufferGeometries) {
      const merged = BGU.mergeBufferGeometries(geos);
      for (const g of geos) g.dispose();
      mesh = new THREE.Mesh(merged, yardMat());
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.name = "house-lot";
      root.add(mesh);
    }
    return { mesh: mesh, colliders: cols, garageRect: garageRect };
  };

  CBZ.houseLot = HL;
})();
