/* ============================================================
   city/house_metro.js — A METRO SUBURB'S HOUSE, MADE REAL WHILE YOU ARE ON
   ITS STREET.

   Kingsport, Karvel and the ring towns draw their ~2,900 houses as part of
   one merged mesh per 800 m tile (city/metro_fabric.js). The houses round
   the player on foot are made real one at a time and go back to the tile
   when the player has left. THE SWAP ONLY ADDS DETAIL:

     * ONE HOUSE, TWO LEVELS OF DETAIL. metro_fabric.js houseSpec(P, i) is
       the house: body, garage wing, storeys, colours, roof form / pitch /
       eave / springing height, window bays and their size, the door, the
       shutters, the chimney, the hood. The tile paints it; the real house is
       a buildings.js shell dressed by the "metrohouse" grammar below, which
       builds exactly those numbers (and nothing the tile does not have), and
       house_yard.js builds the garage wing to the same spec. The lot (fence
       lines, walk, carport) is read once, here, and the tile draws its far
       form (farLot) from the same record the real yard is built from.
     * ANY YAW. A house on a skewed street is built in its own frame (the
       shell and yard axis-aligned round the house's centre, then the whole
       of what they added to the world turned onto the street: meshes in one
       wrapper group, colliders and platforms oriented, door records, the
       stair's ramp, the yard's gate, garage doors and car stand).
     * COLLIDERS. A real house is a handful of boxes, not a hundred: one per
       outer wall run (the door's gap left open, the windows are wall to a
       walker), partitions merged up the storeys, the stair's underside and
       rail merged, the yard's fence bays joined into runs and the small yard
       things (a mailbox, a bin, a table) not solid.
     * FOR SALE. A share of the suburb's houses is on the market at any time
       (priced by district wealth and size), listed in the same ledger as the
       town's (city/zillow.js's registry), sold at the kerb sign or by the
       agent (city/plots.js, city/realestate.js). A house you own keeps one
       lot record for good (its key, safe, rack, the car on its drive, the
       save) and stays real while you are anywhere near it.

   WHICH. Not while driving fast or flying; nearest first, within R_IN of its
   footprint, at most maxLive at once (4 on a phone, 12 on a desktop; owned
   houses do not count). HOW IT LEAVES: each build is an owner-held stream
   job (core/citystream.js CBZ.streamOwnJob), so everything it registered
   leaves with it, and the tile's copy comes back (cutBuilding).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || CBZ.metroHomes) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.METRO_HOMES == null) CFG.METRO_HOMES = true;

  const HM = (CBZ.metroHomes = {});
  const CELL = 48;                 // metres: the house index's grid
  const SCAN = 0.25;               // seconds between decisions
  const GY = 0.16;                 // the pad level a metro house stands on (metro_fabric.js)
  const SALE_SHARE = 0.07;         // of the suburb's houses, on the market
  const live = [];                 // { M, P, i, b, S, L, job, yardJob, lot, built, cx, cz, rect, Q, r, diag }
  const byB = new Map();           // plan building -> entry
  const refused = new WeakSet();   // records that cannot be a real house (tried once)
  const IDX = new WeakMap();       // plan -> { cells }
  const LOT = new WeakMap();       // plan -> Map(i -> lot read, or null)
  const stats = { built: 0, freed: 0, refused: 0, lastMs: 0, maxMs: 0, diag: 0, farMs: 0, farN: 0 };
  let rootRef = null, scanT = 0;

  function q(lo, hi) { return CBZ.qScale ? CBZ.qScale(lo, hi) : hi; }
  // THE SWAP DISTANCE. The far house and the real one are the same house, so
  // the swap is no longer something to hide close up: it happens where the
  // real one's relief (reveals, casings, the door) starts to read
  function rIn() { return q(34, 60); }
  function rOut() { return rIn() + 20; }
  function maxLive() { return Math.round(q(4, 12)); }
  function inCity() { return CBZ.game && CBZ.game.mode === "city"; }
  function arenaRoot() { const a = CBZ.city && CBZ.city.arena; return a ? a.root : null; }
  function plans() {
    const out = [];
    for (const M of CBZ.metroCities || []) if (M && M.plan && M.plan.bldgs) out.push(M);
    const C = CBZ.metroCountryside;
    if (C && C.plan && C.plan.bldgs) out.push(C);
    return out;
  }
  function metroOf(P) { for (const M of plans()) if (M.plan === P) return M; return null; }
  function h01(x, z, s) {
    if (CBZ.hash01) return CBZ.hash01(x, z, s);
    let h = (Math.round(x * 8) * 374761393 + Math.round(z * 8) * 668265263 + (s | 0) * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function shade(hex, f) {
    const r = Math.max(0, Math.min(255, (((hex >> 16) & 255) * f) | 0)), g = Math.max(0, Math.min(255, (((hex >> 8) & 255) * f) | 0)), b = Math.max(0, Math.min(255, ((hex & 255) * f) | 0));
    return (r << 16) | (g << 8) | b;
  }

  /* ---- the index: every house of a plan, by 48 m cell --------------------- */
  function indexOf(P) {
    let ix = IDX.get(P);
    if (ix && ix.n === P.bldgs.length) return ix;
    ix = { cells: new Map(), n: P.bldgs.length, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
    for (let i = 0; i < P.bldgs.length; i++) {
      const b = P.bldgs[i];
      if (!b || b.type !== "house") continue;
      const k = Math.floor(b.x / CELL) * 100003 + Math.floor(b.z / CELL);
      let a = ix.cells.get(k); if (!a) ix.cells.set(k, a = []);
      a.push(i);
      if (b.x < ix.x0) ix.x0 = b.x; if (b.x > ix.x1) ix.x1 = b.x;
      if (b.z < ix.z0) ix.z0 = b.z; if (b.z > ix.z1) ix.z1 = b.z;
    }
    IDX.set(P, ix);
    return ix;
  }
  function eachNear(P, x, z, r, fn) {
    const ix = indexOf(P);
    if (x < ix.x0 - r || x > ix.x1 + r || z < ix.z0 - r || z > ix.z1 + r) return;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = ix.cells.get(i * 100003 + j);
      if (a) for (let k = 0; k < a.length; k++) fn(a[k], P.bldgs[a[k]]);
    }
  }
  // the quarter turn a house stands at, or null on a diagonal
  function quarter(r) {
    const k = Math.round(r / (Math.PI / 2));
    return Math.abs(r - k * Math.PI / 2) > 0.02 ? null : ((k % 4) + 4) % 4;
  }
  // half extents of a house along a world unit axis (ux, uz)
  function extent(b, ux, uz) {
    const r = +b.rot || 0, c = Math.cos(r), s = Math.sin(r);
    return Math.abs(ux * c - uz * s) * b.w / 2 + Math.abs(ux * s + uz * c) * b.d / 2;
  }

  /* ---- THE HOUSE'S FRAME ---------------------------------------------------
     The plan record's own frame (metro_fabric.js frame(b.x, b.z, b.rot)):
     local +z toward the street, local +x along it. world = (b.x, b.z) +
     lx (cos r, -sin r) + lz (sin r, cos r). */
  function L2W(b, lx, lz) {
    const r = +b.rot || 0, c = Math.cos(r), s = Math.sin(r);
    return [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
  }

  /* ---- THE LOT, READ FROM THE WORLD (once per house, cached) ---------------
     In the record's frame: the side lines are half the gap to the next house
     each way along the row, the back line half the gap to the house behind,
     the front line where the lawn ends at the street (the metro ground's own
     kindAt), every corner on lawn. null where no real house can stand. */
  function lotLocal(M, i) {
    const P = M.plan;
    let C = LOT.get(P); if (!C) { C = new Map(); LOT.set(P, C); }
    if (C.has(i)) return C.get(i);
    const out = readLot(M, i);
    const S = M.ground && M.ground.solve;
    if (out || (S && S.kindAt)) C.set(i, out);          // (not cached before the ground exists)
    return out;
  }
  function readLot(M, i) {
    const P = M.plan, b = P.bldgs[i];
    const MF = CBZ.metroFabric;
    if (!MF || !MF.houseSpec) return null;
    if (Math.abs(+b.y || 0) > 0.3 || !(b.w >= 7 && b.d >= 7.6)) return null;
    const Sp = MF.houseSpec(P, i);
    if (!Sp) return null;
    const r = +b.rot || 0, co = Math.cos(r), si = Math.sin(r);
    const S = M.ground && M.ground.solve;
    const lawn = function (lx, lz) {
      if (!S || !S.kindAt) return true;
      const w = L2W(b, lx, lz);
      let kd = 0; try { kd = S.kindAt(w[0], w[1]); } catch (e) { return false; }
      return kd === 4 || kd === 3;
    };
    if (S && S.heightAt) { let y = null; try { y = S.heightAt(b.x, b.z); } catch (e) {} if (y != null && Math.abs(y - GY) > 0.25) return null; }
    // local axes in the world
    const ax = co, az = -si, nx = si, nz = co;
    let gPX = 1e9, gNX = 1e9, gBack = 1e9;
    eachNear(P, b.x, b.z, 44, function (j, o) {
      if (j === i) return;
      const dx = o.x - b.x, dz = o.z - b.z;
      const lx = dx * ax + dz * az, lz = dx * nx + dz * nz;
      const eX = extent(o, ax, az), eZ = extent(o, nx, nz);
      if (Math.abs(lz) < b.d / 2 + eZ + 1.5) {
        if (lx > 0) gPX = Math.min(gPX, lx - eX - b.w / 2); else gNX = Math.min(gNX, -lx - eX - b.w / 2);
      } else if (lz < 0 && Math.abs(lx) < b.w / 2 + eX + 1) gBack = Math.min(gBack, -lz - eZ - b.d / 2);
    });
    let sPX = gPX > 1e8 ? 2.8 : clamp(gPX / 2, 1.0, 4.5), sNX = gNX > 1e8 ? 2.8 : clamp(gNX / 2, 1.0, 4.5);
    let rear = gBack > 1e8 ? 6.5 : clamp(gBack / 2, 2.4, 9);
    let fy = 0;
    for (let t = 0.5; t <= 16; t += 0.5) { if (!lawn(0, b.d / 2 + t)) break; fy = t; }
    const front = fy - 1.0;                                      // a metre of verge at the kerb
    if (front < 2.6) return null;
    const ok = function (lx, lz) { return lawn(lx, lz); };
    const zF = b.d / 2 + front;
    for (let n = 0; n < 8 && sPX > 1.0 && !(ok(b.w / 2 + sPX, zF) && ok(b.w / 2 + sPX, 0) && ok(b.w / 2 + sPX, -b.d / 2 - rear)); n++) sPX = Math.max(1.0, sPX - 0.5);
    for (let n = 0; n < 8 && sNX > 1.0 && !(ok(-b.w / 2 - sNX, zF) && ok(-b.w / 2 - sNX, 0) && ok(-b.w / 2 - sNX, -b.d / 2 - rear)); n++) sNX = Math.max(1.0, sNX - 0.5);
    for (let n = 0; n < 12 && rear > 2.4 && !(ok(0, -b.d / 2 - rear) && ok(b.w / 2 + sPX, -b.d / 2 - rear) && ok(-b.w / 2 - sNX, -b.d / 2 - rear)); n++) rear = Math.max(2.4, rear - 0.5);
    const lcx = (sPX - sNX) / 2, lcz = (front - rear) / 2;
    const lotW = b.w + sNX + sPX, lotD = b.d + rear + front;
    const G = Sp.garage;
    let driveX, driveHalf;
    if (G) { driveX = G.cx; driveHalf = G.hw * 2 > 5 ? 2.7 : 1.6; }
    else {
      driveX = Sp.driveOff; driveHalf = 1.6;
      // a front too narrow to leave the door clear of the drive: the drive on the side line
      if (Math.abs(Sp.driveOff - Sp.body.cx) < 2.6) driveX = Sp.gs * (b.w / 2 - 1.7);
    }
    // who lives here, and how their lot is kept (house_yard.js's own rule,
    // hashed on the lot's centre in the WORLD so a lot on a skewed street
    // keeps its own whatever frame it is built in)
    const lc = L2W(b, lcx, lcz);
    const wealth = wealthOf(M, b), tier = CBZ.cityHouse && CBZ.cityHouse.tierOf ? CBZ.cityHouse.tierOf(wealth) : (wealth < 0.36 ? "poor" : wealth < 0.64 ? "mid" : "rich");
    const hs = h01(lc[0], lc[1], 0x7d1);
    const style = tier === "poor" ? (hs < 0.55 ? "chain" : "open") : tier === "rich" ? (hs < 0.6 ? "wall" : "hedge") : (hs < 0.5 ? "picket" : hs < 0.8 ? "hedge" : "open");
    const carport = !G && tier === "poor" && h01(lc[0], lc[1], 0x7e2) < 0.55;
    // the lines nobody shares (house_yard.js draws those itself), and the
    // back line drawn by the lot whose street side faces +x/+z in the world
    return {
      lcx: lcx, lcz: lcz, lotW: lotW, lotD: lotD, front: front, rear: rear, sPX: sPX, sNX: sNX,
      driveX: driveX, driveHalf: driveHalf, wcx: lc[0], wcz: lc[1],
      wealth: wealth, tier: tier, style: style, carport: carport,
      open: { lo: gPX > 1e8 || gPX > 9.5, back: gBack > 1e8 || gBack > 18 },
      backOwn: (nx + nz) > 1e-6,
    };
  }

  /* ---- THE LOT IN house_yard.js TERMS, in the space the house is built in.
     T: the build-space map of a local point and of a local direction. */
  function yardPlan(b, Sp, Lt, T) {
    const N = T.dir(0, 1), X = T.dir(1, 0);
    const tx = -X[0], tz = -X[1];                                 // house_yard.js t runs along -local x
    const tOf = function (lx) { return -(lx - Lt.lcx); };
    const body = T.pt(Sp.body.cx, 0), lc = T.pt(Lt.lcx, Lt.lcz);
    const hw = Sp.body.hw * 2, hd = b.d;
    const G = Sp.garage;
    const t = tOf(Sp.body.cx), driveAt = tOf(Lt.driveX);
    return {
      x: body[0], z: body[1], w: Math.abs(N[0]) > 0.5 ? hd : hw, d: Math.abs(N[0]) > 0.5 ? hw : hd, hw: hw, hd: hd,
      t: t, a: -Lt.lcz, front: Lt.front, garage: G ? { t: tOf(G.cx), w: G.hw * 2, d: G.z1 - G.z0, kind: G.kind, pitch: G.pitch, eave: G.eave, doors: G.doors } : null,
      gs: (driveAt - t) > 0 ? -1 : 1, driveAt: driveAt, driveHalf: Lt.driveHalf,
      tx: tx, tz: tz, nx: N[0], nz: N[1], lotT: Lt.lotW, lotA: Lt.lotD, cx: lc[0], cz: lc[1],
      open: Lt.open, backOwn: Lt.backOwn, style: Lt.style, carport: Lt.carport,
      pal: { body: Sp.wall, trim: Sp.trim, roof: Sp.roof, flat: false },
    };
  }

  /* ---- THE LOT, FAR: what the tile draws of it (metro_fabric.js house()) --
     [x0, x1, z0, z1, y0, y1, hex, noTop] boxes in the record's frame: the
     street fence with its gaps, the front yard's far side line, the back
     fence, the walk, a carport. The same lines house_yard.js builds. */
  const FAR = new WeakMap();
  const FENCE = { picket: [1.0, 0.06, 0xe8e6df], hedge: [1.15, 0.5, 0x3f5a30], wall: [1.9, 0.22, 0xd6ccba], chain: [1.2, 0.04, 0x8f9598] };
  const BACK = { board: [1.8, 0.08, 0x86684a], wall: [1.9, 0.22, 0xd6ccba], chain: [1.5, 0.04, 0x8f9598] };
  HM.farLot = function (P, i) {
    let C = FAR.get(P); if (!C) { C = new Map(); FAR.set(P, C); }
    if (C.has(i)) return C.get(i);
    const t0 = performance.now();
    try { return farLotOf(P, i, C); } finally { stats.farMs += performance.now() - t0; stats.farN++; }
  };
  function farLotOf(P, i, C) {
    const M = metroOf(P), b = P.bldgs[i];
    const MF = CBZ.metroFabric;
    const Lt = M && b && b.type === "house" ? lotLocal(M, i) : null;
    const Sp = Lt && MF && MF.houseSpec ? MF.houseSpec(P, i) : null;
    if (!Lt || !Sp) { if (M && M.ground && M.ground.solve) C.set(i, null); return null; }
    const out = [];
    const y0 = GY;
    // (t, a) of the lot frame -> the record's x, z
    const X = function (t) { return Lt.lcx - t; }, Z = function (a) { return Lt.lcz + a; };
    const run = function (t0, t1, a, spec, gaps) {
      let segs = [[Math.min(t0, t1), Math.max(t0, t1)]];
      for (const g of gaps || []) { const nx = []; for (const s of segs) { const a0 = g.at - g.w / 2, a1 = g.at + g.w / 2; if (a1 <= s[0] || a0 >= s[1]) { nx.push(s); continue; } if (a0 - s[0] > 0.5) nx.push([s[0], a0]); if (s[1] - a1 > 0.5) nx.push([a1, s[1]]); } segs = nx; }
      for (const s of segs) { const xa = X(s[1]), xb = X(s[0]); out.push([xa, xb, Z(a) - spec[1] / 2, Z(a) + spec[1] / 2, y0, y0 + spec[0], spec[2], false]); }
    };
    const runA = function (t, a0, a1, spec) {
      if (Math.abs(a1 - a0) < 0.5) return;
      out.push([X(t) - spec[1] / 2, X(t) + spec[1] / 2, Z(Math.min(a0, a1)), Z(Math.max(a0, a1)), y0, y0 + spec[0], spec[2], false]);
    };
    const halfT = Lt.lotW / 2, halfA = Lt.lotD / 2;
    const tH = -(Sp.body.cx - Lt.lcx), hw = Sp.body.hw, hA1 = b.d / 2 - Lt.lcz, hA0 = -b.d / 2 - Lt.lcz;
    const hT0 = tH - hw, hT1 = tH + hw;
    const dC = -(Lt.driveX - Lt.lcx), dH = Lt.driveHalf;
    const walkHits = Math.abs(tH - dC) < dH + 0.6;
    const fa = halfA - 0.35, gateW = Lt.tier === "rich" ? 1.5 : 1.1;
    const gaps = [{ at: dC, w: 2 * dH + 0.5 }];
    if (!walkHits) gaps.push({ at: tH, w: gateW });
    const F = FENCE[Lt.style];
    if (F) run(-halfT + 0.3, halfT - 0.3, fa, F, gaps);
    if (Lt.style === "picket" || Lt.style === "hedge" || Lt.style === "wall") {
      const st = -Math.sign(dC || 1) * (halfT - 0.3);
      if (hA1 + 0.4 < fa - 0.5) runA(st, hA1 + 0.4, fa, F);
    }
    // the walk, door to the street
    if (!walkHits && halfA - hA1 > 1.0) {
      const w2 = Lt.tier === "rich" ? 0.75 : 0.6;
      out.push([X(tH) - w2, X(tH) + w2, Z(hA1 + 0.45), Z(halfA - 0.05), y0 - 0.02, y0 + 0.025, 0xb9b4a8, false]);
    }
    // the back fence (house_yard.js's lines)
    const backKind = Lt.tier === "poor" ? (h01(Lt.wcx, Lt.wcz, 0x7db) < 0.6 ? "chain" : null) : Lt.tier === "rich" ? "wall" : "board";
    const B = backKind ? BACK[backKind] : null;
    if (B) {
      const G = Sp.garage, gT = G ? -(G.cx - Lt.lcx) : 0;
      const sideT = halfT - 0.05, backA = -halfA + 0.05;
      const yardA = hA0 + Math.min(1.0, b.d * 0.2);
      const gFront = hA1 - 0.3, nearA = G ? Math.min(yardA, gFront - (G.z1 - G.z0) - 0.15) : yardA;
      const loEdge = G && gT < tH ? gT - G.hw : hT0, hiEdge = G && gT > tH ? gT + G.hw : hT1;
      const loA = G && gT < tH ? nearA : yardA, hiA = G && gT > tH ? nearA : yardA;
      const gateSide = dC > 0 ? -1 : 1;
      if (sideT - hiEdge > 0.6) run(gateSide > 0 && sideT - hiEdge > 1.8 ? hiEdge + 1.05 : hiEdge + 0.05, sideT, hiA, B);
      if (loEdge + sideT > 0.6) run(-sideT, gateSide < 0 && loEdge + sideT > 1.8 ? loEdge - 1.05 : loEdge - 0.05, loA, B);
      runA(sideT, backA, hiA, B);
      if (Lt.open.lo) runA(-sideT, backA, loA, B);
      if (Lt.backOwn || Lt.open.back) run(-sideT + 0.05, sideT - 0.05, backA, B);
    }
    // a carport over the head of the drive
    if (Lt.carport && Math.abs(dC) > 0.5) {
      const c0 = dC - dH + 0.1, c1 = dC + dH - 0.1, a0 = hA1 - 0.2, a1 = hA1 + 4.4;
      out.push([X(c1 + 0.25), X(c0 - 0.25), Z(a0 - 0.2), Z(a1 + 0.3), y0 + 2.3, y0 + 2.38, 0x8a8f8c, false]);
      for (const tt of [c0, c1]) for (const aa of [a0 + 0.1, a1 - 0.1]) out.push([X(tt) - 0.05, X(tt) + 0.05, Z(aa) - 0.05, Z(aa) + 0.05, y0, y0 + 2.3, 0x9aa0a2, true]);
    }
    C.set(i, out);
    return out;
  }

  /* ---- who lives there --------------------------------------------------- */
  /* A plan's district wealth is its land value, and a metro's land value is
     its downtown's: every district with houses in it scores 0.1 to 0.6, which
     by a town's measure is one poor street after another. So a house's
     wealth is its district's place AMONG THE DISTRICTS THAT HAVE HOUSES. */
  const RANGE = new WeakMap();
  function wealthOf(M, b) {
    const P = M.plan, D = P.districts || [];
    let r = RANGE.get(P);
    if (!r) {
      r = { lo: 1e9, hi: -1e9 };
      const has = {};
      for (const o of P.bldgs) if (o && o.type === "house" && D[o.dist] && D[o.dist].wealth != null) has[o.dist] = 1;
      for (const k in has) { const w = +D[k].wealth; if (w < r.lo) r.lo = w; if (w > r.hi) r.hi = w; }
      RANGE.set(P, r);
    }
    const d = D[b.dist];
    const w = d && d.wealth != null ? +d.wealth : (r.lo + r.hi) / 2;
    const rel = r.hi - r.lo > 0.02 ? (w - r.lo) / (r.hi - r.lo) : 0.5;
    return clamp(0.18 + 0.66 * rel + (h01(b.x, b.z, 0x4c2) - 0.5) * 0.1, 0.02, 1);
  }

  /* ============================================================
     THE GRAMMAR: the spec's house in boxes (city/facades/house_parts.js
     carpentry). Nothing here is chosen: every number is the spec's, so the
     real house is the painted one with depth.
     ============================================================ */
  /* ONE COLOUR PIPELINE. The tile decodes its paint (MF_MAIN: the sRGB curve,
     then 30% toward grey); a shell's box grades its hex (buildings.js
     gradeHex: 82% of that curve plus 18% of the raw swatch, the same ease),
     which leaves a dark colour (a door, a shutter, a roof) up to twice as
     light near as far. The grammar hands the shell the hex whose grade is the
     tile's decode, so both draw the same colour. */
  const NEARC = new Map();
  function dec(c) { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }
  function nearHex(hex) {
    hex = hex >>> 0;
    let v = NEARC.get(hex);
    if (v != null) return v;
    const ch = function (c8) {
      const T = dec(c8 / 255);
      let lo = 0, hi = 1;
      for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (0.82 * dec(m) + 0.18 * m < T) lo = m; else hi = m; }
      return Math.round((lo + hi) / 2 * 255);
    };
    v = (ch((hex >> 16) & 255) << 16) | (ch((hex >> 8) & 255) << 8) | ch(hex & 255);
    NEARC.set(hex, v);
    return v;
  }
  // the hex a plain material's colour is given (the city's materials take
  // theirs as linear reflectance) so it lands where the tile's paint does:
  // decoded, then 30% toward its grey
  function leafHex(hex) {
    const r = dec(((hex >> 16) & 255) / 255), g = dec(((hex >> 8) & 255) / 255), b = dec((hex & 255) / 255);
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const enc = function (v) { v = L + (v - L) * 0.7; return Math.max(0, Math.min(255, Math.round(v * 255))); };
    return (enc(r) << 16) | (enc(g) << 8) | enc(b);
  }
  // THE FRONT DOOR IS THE TILE'S DOOR. The kit paints a door in one of the
  // facade's colours, picked by hash; this house's door has its own (the
  // spec's), so the leaf wears that
  function paintDoor(built, hex) {
    const lh = leafHex(hex), rh = shade(lh, 1.25);
    for (const r of built.doors || []) {
      if (!r || !r.home) continue;
      for (const lf of [r.leaf, r.leaf2]) if (lf && lf.material) { if (!lf.userData.tinted) { lf.material = lf.material.clone(); lf.userData.tinted = true; } lf.material.color.setHex(lh); }
      for (const rl of [r.rails, r.rails2]) if (rl && rl.material) { if (!rl.userData.tinted) { rl.material = rl.material.clone(); rl.userData.tinted = true; } rl.material.color.setHex(rh); }
    }
  }
  function registerGrammar() {
    if (!CBZ.registerFacade || !CBZ.facadeDef || CBZ.facadeDef("metrohouse")) return;
    CBZ.registerFacade("metrohouse", {
      label: "Metro House", structure: "timber", crownsRoof: true, ownDoor: true, maxStoreys: 4, window: "sash",
      build: function (ctx, F, spec) {
        const HP = CBZ.HOUSE_PARTS, S = spec && spec.house, T = spec && spec.toShell;
        if (!HP || !S || !T) return;
        const H = HP.begin(ctx, F);
        const FH = H.FH, SK = 0.05;
        const wall = nearHex(S.wall), trim = nearHex(S.trim), wt = nearHex(0xe6e3d9), roof = nearHex(S.roof);
        H.publish({ body: S.wall, trim: S.trim, roof: S.roof, flat: false, ownGarage: false });
        // a record-frame point -> shell face + t; a record-frame direction -> shell
        const faceAt = function (nlx, nlz) { const d = T.dir(nlx, nlz); return Math.abs(d[0]) > Math.abs(d[1]) ? (d[0] > 0 ? 3 : 2) : (d[1] > 0 ? 1 : 0); };
        const holes = [];
        const dh = H.doorHole();
        if (dh) holes.push(dh);
        const bx = S.body.cx, bhw = S.body.hw, hd = S.body.hd;
        // the tile's faces: 0 = +z (front), 1 = +x, 2 = -z, 3 = -x; each run
        // left-to-right from outside from corner L along R
        const FK = [[-1, 1, 1, 0, 0, 1], [1, 1, 0, -1, 1, 0], [1, -1, -1, 0, 0, -1], [-1, -1, 0, 1, -1, 0]];
        for (let k = 0; k < 4; k++) {
          const f = FK[k], len = (k & 1) ? 2 * hd : 2 * bhw, n = S.bays[k], bw = len / n;
          const s = faceAt(f[4], f[5]), face = H.faces[s];
          for (let st = 0; st < S.st; st++) {
            for (let c = 0; c < n; c++) {
              if (k === 0 && st === 0 && c === (n >> 1)) continue;      // the door's bay
              const u = (c + 0.5) * bw;
              const lx = bx + f[0] * bhw + f[2] * u, lz = f[1] * hd + f[3] * u;
              const p = T.pt(lx, lz);
              const t = face.horiz ? p[0] : p[1];
              const w = 2 * S.win.hx * bw;
              if (w < 0.45) continue;
              holes.push(H.win(face, st, t, w, S.win.lo * FH, S.win.hi * FH));
            }
          }
        }
        // THE WALLS: the spec's paint, siding / brick courses / stucco
        const top = S.base - 0.02;
        H.skinAll(-0.3, top, holes, wall, SK);
        if (S.mode === "wood") {
          for (const f of H.faces) H.courses(f, 0.05, top - 0.15, holes, 0.2, 0.03, SK + 0.018, shade(wall, 0.86));
          H.cornerBoards(-0.3, top, 0.12, SK + 0.03, trim);
        } else if (S.mode === "brick") {
          for (const f of H.faces) H.courses(f, 0.1, top - 0.15, holes, 0.231, 0.012, SK + 0.01, shade(wall, 0.82));
        }
        for (let k = 1; k < S.st; k++) if (S.mode === "wood") H.belt(k * FH - 0.04, k * FH + 0.1, holes, SK + 0.035, trim);
        H.belt(-0.3, 0.16, holes, SK + 0.03, shade(wall, 0.7));                        // the foundation line
        // THE WINDOWS' TRIM: the shader's painted frame, sill and shutters
        for (const op of holes) {
          if (op.door) continue;
          H.trim(op, { skin: SK, cw: 0.08, cp: 0.025, col: wt, head: "flat",
            sill: { h: 0.05, proj: 0.05, over: 0.03, col: wt },
            shut: S.shutters != null ? { col: nearHex(S.shutters), w: 0.3, louvre: false } : null });
          if (S.win.paired) { const m = (op.t0 + op.t1) / 2; H.fb(op.f, m - 0.035, m + 0.035, op.y0, op.y1, SK - 0.3, SK - 0.02, wt); }
        }
        // THE ROOF the tile draws: its form, pitch, eave and springing height
        const ax = T.dir(1, 0), axis = Math.abs(ax[0]) > 0.5 ? (S.alongX ? "x" : "z") : (S.alongX ? "z" : "x");
        H.roof({ kind: S.kind, axis: axis, base: S.base, pitch: S.pitch, step: 0.12, eave: S.eave, rake: S.rake,
          roof: roof, roof2: shade(roof, 0.9), core: wall, soffit: trim, fascia: trim, fasciaH: 0.2,
          gutter: shade(trim, 0.86), ridge: shade(roof, 0.8), rakeBoard: true, hipCaps: true });
        // THE DOOR: its colour, a casing, the hood over it
        H.doorColour(nearHex(S.door));
        H.doorcase("casing", { col: trim, skin: SK, w: 0.12 });
        if (!H.noDoor) {
          const df = H.df, hw2 = S.hood.w / 2, hy = S.hood.y;
          H.fb(df, -hw2, hw2, hy, hy + 0.15, SK, SK + S.hood.d * 0.5, roof);
          H.fb(df, -hw2, hw2, hy - 0.15, hy, SK + S.hood.d * 0.5, SK + S.hood.d, roof);
          H.fb(df, -hw2, hw2, hy - 0.3, hy - 0.15, SK + S.hood.d * 0.5 - 0.02, SK + S.hood.d, trim);
        }
        // THE CHIMNEY
        if (S.chimney) {
          const c = S.chimney, a = T.pt(c.x - c.hw, c.z - c.hw), b2 = T.pt(c.x + c.hw, c.z + c.hw);
          H.ab(Math.min(a[0], b2[0]), Math.max(a[0], b2[0]), c.y0, c.y1, Math.min(a[1], b2[1]), Math.max(a[1], b2[1]), nearHex(0x7a4a3a));
          H.ab(Math.min(a[0], b2[0]) - 0.05, Math.max(a[0], b2[0]) + 0.05, c.y1 - 0.12, c.y1, Math.min(a[1], b2[1]) - 0.05, Math.max(a[1], b2[1]) + 0.05, nearHex(0x5e3a2e));
        }
      },
    });
  }

  /* ============================================================
     COLLIDERS: a house is a handful of boxes
     ============================================================ */
  function near(a, b, e) { return Math.abs(a - b) < (e || 0.02); }
  // the shell's own (ox, oz, w, d), colliders appended since c0 (CBZ.colliders
  // tail, not yet indexed): merged in place. Returns the dropped set.
  function mergeHouseCols(b, c0, keep) {
    const C = CBZ.colliders, tail = C.splice(c0);
    const ox = b.ox, oz = b.oz, hw = b.w / 2, hd = b.d / 2;
    const top = (b.storeys || 1) * (b.FH || 3.2) + (b.parapetH || 0.8) + 0.1;
    const dropped = new Set(), add = [];
    const ring = function (c) {
      if (c.door || keep.has(c) || c.yaw) return false;
      const x0 = c.minX - ox, x1 = c.maxX - ox, z0 = c.minZ - oz, z1 = c.maxZ - oz;
      if (c.y0 != null && c.y0 > top) return false;
      return (x0 >= -hw - 0.15 && x1 <= -hw + 0.75) || (x1 <= hw + 0.15 && x0 >= hw - 0.75) ||
        (z0 >= -hd - 0.15 && z1 <= -hd + 0.75) || (z1 <= hd + 0.15 && z0 >= hd - 0.75);
    };
    let ref = null;
    for (const c of tail) if (ring(c)) { dropped.add(c); if (!ref && c.ref && c.ref.isMesh) ref = c.ref; }
    // one box per wall run; the door's face round its leaf
    const WT = 0.4, side = b.side | 0;
    const door = (b.doors || []).find(function (d) { return d && d.home; }) || (b.doors || [])[0];
    const dc = door && door.col;
    const mk = function (x0, x1, z0, z1, y0, y1) { if (x1 - x0 > 0.05 && z1 - z0 > 0.05 && y1 - y0 > 0.05) add.push({ minX: ox + x0, maxX: ox + x1, minZ: oz + z0, maxZ: oz + z1, y0: y0, y1: y1, ref: ref, houseWall: true }); };
    const faces = [[-hw, hw, -hd, -hd + WT], [-hw, hw, hd - WT, hd], [-hw, -hw + WT, -hd + WT, hd - WT], [hw - WT, hw, -hd + WT, hd - WT]];
    for (let s = 0; s < 4; s++) {
      const f = faces[s];
      if (s === side && dc) {
        const g0 = (s < 2 ? dc.minX - ox : dc.minZ - oz) - 0.02, g1 = (s < 2 ? dc.maxX - ox : dc.maxZ - oz) + 0.02, gTop = (dc.y1 || 2.3) + 0.05;
        if (s < 2) { mk(f[0], g0, f[2], f[3], 0, top); mk(g1, f[1], f[2], f[3], 0, top); mk(g0, g1, f[2], f[3], gTop, top); }
        else { mk(f[0], f[1], f[2], g0, 0, top); mk(f[0], f[1], g1, f[3], 0, top); mk(f[0], f[1], g0, g1, gTop, top); }
      } else mk(f[0], f[1], f[2], f[3], 0, top);
    }
    // partitions stacked storey on storey: one box up the house
    const rest = tail.filter(function (c) { return !dropped.has(c); });
    const key = function (c) { return [c.minX, c.maxX, c.minZ, c.maxZ].map(function (v) { return Math.round(v * 20); }).join(","); };
    const groups = new Map();
    for (const c of rest) {
      if (c.door || c.yaw || c.stairSoffit || c.houseGuard || c.noStep || keep.has(c) || c.y0 == null) continue;
      const k = key(c); let a = groups.get(k); if (!a) groups.set(k, a = []); a.push(c);
    }
    for (const a of groups.values()) {
      if (a.length < 2) continue;
      a.sort(function (p, q2) { return p.y0 - q2.y0; });
      let cur = a[0];
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c.y0 <= cur.y1 + 0.7) { cur.y1 = Math.max(cur.y1, c.y1); dropped.add(c); } else cur = c;
      }
    }
    // the stair: its underside bands two by two, its rail in one
    const soff = rest.filter(function (c) { return c.stairSoffit && !c.yaw; });
    for (let j = 0; j + 1 < soff.length; j += 2) {
      const a = soff[j], c = soff[j + 1];
      a.minX = Math.min(a.minX, c.minX); a.maxX = Math.max(a.maxX, c.maxX); a.minZ = Math.min(a.minZ, c.minZ); a.maxZ = Math.max(a.maxZ, c.maxZ);
      a.y0 = Math.min(a.y0, c.y0); a.y1 = Math.min(a.y1, c.y1); dropped.add(c);
    }
    const rails = rest.filter(function (c) { return c.houseGuard; });
    const used = new Set();
    for (const a of rails) {
      if (used.has(a)) continue;
      const thinX = a.maxX - a.minX < 0.25;
      for (const c of rails) {
        if (c === a || used.has(c)) continue;
        const same = thinX ? (near(c.minX, a.minX, 0.05) && near(c.maxX, a.maxX, 0.05) && c.minZ <= a.maxZ + 0.05 && c.maxZ >= a.minZ - 0.05)
          : (near(c.minZ, a.minZ, 0.05) && near(c.maxZ, a.maxZ, 0.05) && c.minX <= a.maxX + 0.05 && c.maxX >= a.minX - 0.05);
        if (!same) continue;
        a.minX = Math.min(a.minX, c.minX); a.maxX = Math.max(a.maxX, c.maxX); a.minZ = Math.min(a.minZ, c.minZ); a.maxZ = Math.max(a.maxZ, c.maxZ);
        a.y0 = Math.min(a.y0, c.y0); a.y1 = Math.max(a.y1, c.y1);
        used.add(c); dropped.add(c);
      }
    }
    for (const c of tail) if (!dropped.has(c)) C.push(c);
    for (const c of add) C.push(c);
    if (b.colliders) {
      const L = b.colliders.filter(function (c) { return !dropped.has(c); });
      b.colliders.length = 0;
      for (const c of L) b.colliders.push(c);
      for (const c of add) b.colliders.push(c);
    }
    return dropped;
  }

  /* ============================================================
     ANY YAW: what a build added to the world, turned about Q by r
     ============================================================ */
  function Xform(Q, r) {
    const co = Math.cos(r), si = Math.sin(r);
    const X = {
      Q: Q, r: r,
      pt: function (x, z) { const dx = x - Q.x, dz = z - Q.z; return [Q.x + dx * co + dz * si, Q.z - dx * si + dz * co]; },
      dir: function (x, z) { return [x * co + z * si, -x * si + z * co]; },
    };
    X.col = function (c) {
      if (!c || c._hmX) return;
      c._hmX = true;
      let cx, cz, hw, hd, yaw;
      if (c.yaw && c.cx != null) { cx = c.cx; cz = c.cz; hw = c.hw; hd = c.hd; yaw = c.yaw; }
      else { cx = (c.minX + c.maxX) / 2; cz = (c.minZ + c.maxZ) / 2; hw = (c.maxX - c.minX) / 2; hd = (c.maxZ - c.minZ) / 2; yaw = 0; }
      const p = X.pt(cx, cz), ny = yaw + r;
      const ac = Math.abs(Math.cos(ny)), as = Math.abs(Math.sin(ny));
      const ex = hw * ac + hd * as, ez = hw * as + hd * ac;
      c.minX = p[0] - ex; c.maxX = p[0] + ex; c.minZ = p[1] - ez; c.maxZ = p[1] + ez;
      if (as > 1e-4 && ac > 1e-4) { c.cx = p[0]; c.cz = p[1]; c.hw = hw; c.hd = hd; c.yaw = ny; }
      else { delete c.yaw; delete c.cx; delete c.cz; delete c.hw; delete c.hd; }
      delete c._triYaw;
    };
    X.plat = function (p) {
      if (!p || p._hmX) return;
      p._hmX = true;
      let cx, cz, hl, hw, ux = 1, uz = 0;
      if (p.obb) { cx = p.obb.cx; cz = p.obb.cz; hl = p.obb.hl; hw = p.obb.hw; ux = p.obb.ux; uz = p.obb.uz; }
      else { cx = (p.minX + p.maxX) / 2; cz = (p.minZ + p.maxZ) / 2; hl = (p.maxX - p.minX) / 2; hw = (p.maxZ - p.minZ) / 2; }
      const c = X.pt(cx, cz), u = X.dir(ux, uz);
      const ex = Math.abs(u[0]) * hl + Math.abs(u[1]) * hw, ez = Math.abs(u[1]) * hl + Math.abs(u[0]) * hw;
      p.minX = c[0] - ex; p.maxX = c[0] + ex; p.minZ = c[1] - ez; p.maxZ = c[1] + ez;
      p.obb = { cx: c[0], cz: c[1], ux: u[0], uz: u[1], hl: hl, hw: hw };
      const R = p.ramp;
      if (R) {
        if (R.dir) { const o = X.pt(R.ox, R.oz), d = X.dir(R.dx, R.dz); R.ox = o[0]; R.oz = o[1]; R.dx = d[0]; R.dz = d[1]; }
        else {
          const ax = R.axis === "x" || (R.x0 != null && R.z0 == null);
          const a0 = ax ? R.x0 : R.z0, a1 = ax ? R.x1 : R.z1, sg = a1 >= a0 ? 1 : -1;
          const o = ax ? X.pt(a0, cz) : X.pt(cx, a0), d = ax ? X.dir(sg, 0) : X.dir(0, sg);
          p.ramp = { dir: true, ox: o[0], oz: o[1], dx: d[0], dz: d[1], len: Math.abs(a1 - a0), y0: R.y0, y1: R.y1 };
          if (R.steps) p.ramp.steps = R.steps;
        }
      }
    };
    // a world object added under the root: into one wrapper turned about Q
    X.wrap = function (root, objs) {
      const W = new THREE.Group();
      W.name = "metro-house-frame";
      W.position.set(Q.x, 0, Q.z); W.rotation.y = r;
      const T = new THREE.Matrix4().makeTranslation(-Q.x, 0, -Q.z);
      for (const o of objs) {
        root.remove(o);
        if (o.matrixAutoUpdate === false) { o.matrix.premultiply(T); o.matrix.decompose(o.position, o.quaternion, o.scale); }
        else { o.position.x -= Q.x; o.position.z -= Q.z; }
        W.add(o);
        if (o.matrixAutoUpdate === false) o.updateMatrix();
      }
      root.add(W);
      W.updateMatrixWorld(true);
      return W;
    };
    return X;
  }
  // everything a build registered since the marks, turned
  function marks(root) {
    return { r0: root.children.length, c0: CBZ.colliders.length, p0: (CBZ.platforms || []).length,
      d0: CBZ.cityDoorsGet ? CBZ.cityDoorsGet().length : 0, u0: CBZ.cityUnitDoors ? CBZ.cityUnitDoors.count() : 0 };
  }
  function turnAll(X, root, m, extra) {
    if (CBZ.cityFlushPools) { try { CBZ.cityFlushPools(); } catch (e) {} }
    const objs = root.children.slice(m.r0);
    const W = objs.length ? X.wrap(root, objs) : null;
    const C = CBZ.colliders; for (let i = m.c0; i < C.length; i++) X.col(C[i]);
    const Pl = CBZ.platforms || []; for (let i = m.p0; i < Pl.length; i++) X.plat(Pl[i]);
    const D = CBZ.cityDoorsGet ? CBZ.cityDoorsGet() : [];
    for (let i = m.d0; i < D.length; i++) {
      const d = D[i]; if (!d || d._hmX) continue; d._hmX = true;
      const p = X.pt(d.wx, d.wz), n = X.dir(d.inx, d.inz); d.wx = p[0]; d.wz = p[1]; d.inx = n[0]; d.inz = n[1];
      if (d.col) X.col(d.col);
    }
    const U = CBZ.cityUnitDoors;
    if (U && U.count() > m.u0) {
      const L = U.all().slice(m.u0);
      for (const d of L) {
        if (d._hmX) continue; d._hmX = true;
        // the swinging leaf is hung now, in the unturned frame, then hidden:
        // it lives in the shell's group and turns with it
        try { U.dress(d, true); U.dress(d, false); } catch (e) {}
        U.remove(d);
        const p = X.pt(d.x, d.z); d.x = p[0]; d.z = p[1];
        if (d.col) X.col(d.col);
        U.add(d);
      }
    }
    if (extra) extra(X);
    return W;
  }

  /* ============================================================
     FOR SALE: the suburb's market, and the lots that outlive their house
     ============================================================ */
  const LOTS = new Map();          // "metroId:i" -> the house's one lot record
  const STREETS = ["Maple", "Elm", "Birch", "Willow", "Cedar", "Linden", "Hawthorn", "Juniper", "Chestnut", "Laurel", "Alder", "Sycamore", "Aspen", "Magnolia", "Rowan", "Poplar"];
  const KINDS = ["Drive", "Lane", "Court", "Avenue", "Road", "Way", "Place", "Street"];
  function keyOf(M, i) { return (M.id || M.name || "m") + ":" + i; }
  function listed(M, b) { return h01(b.x, b.z, 0x5a1e) < SALE_SHARE; }
  // the house's lot record: made once, the same object every time it is built
  function lotRecord(M, i) {
    const k = keyOf(M, i);
    let lot = LOTS.get(k);
    if (lot) return lot;
    const P = M.plan, b = P.bldgs[i], MF = CBZ.metroFabric;
    const Sp = MF && MF.houseSpec ? MF.houseSpec(P, i) : null;
    if (!Sp) return null;
    const d = P.districts && P.districts[b.dist];
    const wealth = wealthOf(M, b);
    const r = Sp.rot, n = [Math.sin(r), Math.cos(r)];
    const door = L2W(b, Sp.body.cx, b.d / 2 + 1.6);
    const doorPt = { x: door[0], z: door[1], nx: n[0], nz: n[1] };
    const area = Sp.body.hw * 2 * b.d * Sp.st + (Sp.garage ? 25 : 0);
    const price = Math.round(((55000 + area * 1150) * (0.42 + 1.5 * wealth)) / 500) * 500;
    const beds = Math.max(1, Math.min(5, Math.round(Sp.body.hw * 2 * b.d * Sp.st / 38)));
    const home = { tier: 0, name: "House", price: price, rent: Math.round(60 + wealth * 240), listed: false, owned: false, floorY: 0, door: doorPt, metro: true,
      wealth: wealth, beds: beds, sqft: Math.round(area * 10.76) };
    // the house's footprint in the space it is built in (buildHouse): its
    // centre and size never change, so the lot's key never does
    const k4 = quarter(r), across = k4 != null && (k4 & 1) === 1;
    const wS = across ? b.d : Sp.body.hw * 2, dS = across ? Sp.body.hw * 2 : b.d;
    const stub = { name: "House", home: home, door: doorPt, ox: Sp.px, oz: Sp.pz, x: Sp.px, z: Sp.pz, w: wS, d: dS, storeys: Sp.st, metroStub: true };
    lot = { cx: Sp.px, cz: Sp.pz, w: wS, d: dS, kind: "home", town: M.name, district: d ? d.name : "", building: stub, _stub: stub, home: home,
      wealth: wealth, metro: M.id, metroIndex: i, metroHome: true, metroKey: k, forSale: listed(M, b) };
    // its sign at the kerb (beside the walk, facing the street) and its post
    // inside the line, from the lot read when the ground can say
    LOTS.set(k, lot);
    return lot;
  }
  function placeSigns(M, i, lot) {
    if (lot.signAt) return;
    const Lt = lotLocal(M, i), b = M.plan.bldgs[i];
    if (!Lt) return;
    const sideT = Math.min(9, Lt.lotW * 0.3);
    const za = Lt.lcz + Lt.lotD / 2;
    const s = L2W(b, Lt.lcx - sideT, za - 1.3), m = L2W(b, Lt.lcx + sideT, za - 2.4);
    const yaw = +b.rot || 0;
    lot.signAt = { x: s[0], z: s[1], yaw: yaw };
    lot.postAt = { x: m[0], z: m[1], yaw: yaw };
    lot.parcelAt = { cx: Lt.wcx, cz: Lt.wcz, w: Lt.lotW, d: Lt.lotD, yaw: yaw };
  }
  // the suburb's houses on the market, and every one the player owns
  HM.saleLots = function () {
    const out = [];
    for (const lot of LOTS.values()) if (lot.forSale || (lot.home && lot.home.owned)) out.push(lot);
    return out;
  };
  HM.lotOf = function (M, i) { return lotRecord(M, i); };
  HM.ownedLots = function () { const out = []; for (const lot of LOTS.values()) if (lot.home && lot.home.owned) out.push(lot); return out; };
  // into the market's ledger (city/zillow.js's registry): one listing per
  // house on the market, registered once the ledger exists
  let regRef = null, regDone = false, restored = false;
  function register() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !CBZ.cityZillow || !CBZ.cityZillow.listings) return;
    if (!A.realty) { try { CBZ.cityZillow.listings(); } catch (e) { return; } }
    const R = A.realty; if (!R) return;
    if (regRef === R && regDone) return;
    regRef = R; regDone = true;
    for (const M of CBZ.metroCities || []) {
      if (!M || !M.plan || !M.plan.bldgs) continue;
      const B = M.plan.bldgs;
      for (let i = 0; i < B.length; i++) {
        const b = B[i]; if (!b || b.type !== "house" || !listed(M, b)) continue;
        const lot = lotRecord(M, i); if (!lot) continue;
        addListing(R, M, i, lot);
      }
    }
    restoreOwned(R);
  }
  function addListing(R, M, i, lot) {
    const id = "m:" + lot.metroKey;
    if (R.byId[id]) return R.byId[id];
    const b = M.plan.bldgs[i], h = lot.home;
    const corp = ["corp_castellano", "corp_vance", "corp_sterling", "corp_okafor", "corp_petrov", "corp_zhang"][(h01(b.x, b.z, 0x5a1f) * 6) | 0];
    const num = 2 + ((h01(b.x, b.z, 0x5a20) * 98) | 0) * 2 + (h01(b.x, b.z, 0x5a23) < 0.5 ? 1 : 0);
    const street = STREETS[(h01(b.x, b.z, 0x5a21) * STREETS.length) | 0] + " " + KINDS[(h01(b.x, b.z, 0x5a22) * KINDS.length) | 0];
    const rec = {
      id: id, lot: lot, idx: -1, district: "metro", kind: "home", category: "residence", legal: true,
      base: h.price, value: h.price, name: "House on " + street, address: num + " " + street + ", " + (M.name || ""),
      beds: h.beds, sqft: h.sqft, homeTier: 0, homeListed: false, flagship: false, blurb: "", storeys: lot.building.storeys || 1,
      business: null, flavor: "", occupant: null, occType: null, marketable: true, beta: 0.7 + h01(b.x, b.z, 0x5a24) * 0.6,
      initialOwnerId: corp, ownerId: corp, initialLegal: true, initialCategory: "residence", boughtAt: 0, rent: Math.round(h.price * 0.0016 / 5) * 5,
    };
    R.listings.push(rec); R.byId[id] = rec; if (R.byLot) R.byLot.set(lot, rec);
    return rec;
  }
  // what the save says you own here (zillow.js reads the ledger before these
  // listings exist and drops ids it does not know: this is the other half)
  function restoreOwned(R) {
    let w = null;
    try { w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null; } catch (e) { w = null; }
    const list = w && w.assets && w.assets.realtyOwned;
    if (!Array.isArray(list)) return;
    const g = CBZ.game, own = (g.cityRealtyOwned = g.cityRealtyOwned || {});
    for (const id of list) {
      const rec = R.byId[id];
      if (!rec || !rec.lot || !rec.lot.metroHome) continue;
      own[id] = true; rec.ownerId = "player";
      if (rec.lot.home) rec.lot.home.owned = true;
    }
    restored = true;
    if (CBZ.cityHomeRetry) { try { CBZ.cityHomeRetry(); } catch (e) {} }
  }
  HM.registered = function () { return regDone; };
  HM.rehydrate = function () { regDone = false; };

  /* ---- build one --------------------------------------------------------- */
  function build(M, i) {
    const P = M.plan, b = P.bldgs[i], root = arenaRoot();
    const HK = CBZ.cityHouse, HL = CBZ.houseLot, MF = CBZ.metroFabric;
    if (!root || !HK || !HL || !MF || !MF.houseSpec || !CBZ.cityMakeBuilding || !CBZ.streamOwnJob) return null;
    const tile = MF.tileOfBuilding ? MF.tileOfBuilding(P, i) : null;
    if (!tile || !tile.built) return null;                       // its street is not drawn yet
    const Sp = MF.houseSpec(P, i), Lt = Sp ? lotLocal(M, i) : null;
    if (!Sp || !Lt) { refused.add(b); stats.refused++; return null; }
    registerGrammar();
    const lot = lotRecord(M, i);
    if (!lot) { refused.add(b); stats.refused++; return null; }
    placeSigns(M, i, lot);
    const r = Sp.rot, k = quarter(r), diag = k == null;
    const Q = { x: Sp.px, z: Sp.pz };
    const bhw = Sp.body.hw, hd = Sp.body.hd;
    // THE BUILD SPACE. A house square to the axes is built where it stands,
    // its door on the side the street is; one on a diagonal is built square
    // round its own centre with its door to +z, and turned afterwards.
    const T = diag
      ? { pt: function (lx, lz) { return [Q.x + lx - Sp.body.cx, Q.z + lz]; }, dir: function (x, z) { return [x, z]; } }
      : (function () {
        const c = Math.round(Math.cos(r)), s = Math.round(Math.sin(r));
        return { pt: function (lx, lz) { return [b.x + lx * c + lz * s, b.z - lx * s + lz * c]; }, dir: function (x, z) { return [x * c + z * s, -x * s + z * c]; } };
      })();
    const N = T.dir(0, 1);
    const side = N[1] > 0.5 ? 1 : N[1] < -0.5 ? 0 : N[0] > 0.5 ? 3 : 2;
    const wS = Math.abs(N[0]) > 0.5 ? b.d : bhw * 2, dS = Math.abs(N[0]) > 0.5 ? bhw * 2 : b.d;
    // the shell's local frame is its centre: the spec's points relative to it
    const toShell = { pt: function (lx, lz) { const p = T.pt(lx, lz); return [p[0] - Q.x, p[1] - Q.z]; }, dir: T.dir };
    const yard = yardPlan(b, Sp, Lt, T);
    const wealth = Lt.wealth, tier = Lt.tier;
    const e = { M: M, P: P, i: i, b: b, S: Sp, L: Lt, job: null, lot: lot, built: null, cx: Lt.wcx, cz: Lt.wcz, Q: Q, r: r, diag: diag, t: 0, owned: !!(lot.home && lot.home.owned) };
    // the job's rect: the lot's corners in the world
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (s) { return L2W(b, Lt.lcx + s[0] * Lt.lotW / 2, Lt.lcz + s[1] * Lt.lotD / 2); });
    e.rect = { minX: Math.min.apply(null, cs.map(function (p) { return p[0]; })), maxX: Math.max.apply(null, cs.map(function (p) { return p[0]; })),
      minZ: Math.min.apply(null, cs.map(function (p) { return p[1]; })), maxZ: Math.max.apply(null, cs.map(function (p) { return p[1]; })) };
    const t0 = performance.now();
    const X = diag ? Xform(Q, r) : null;
    e.X = X;
    e.job = CBZ.streamOwnJob(e.rect, function () {
      const m = marks(root);
      const shells = root.userData && root.userData.shells, n0 = shells ? shells.length : 0;
      const opts = { stairs: false, dress: { style: "metrohouse", house: Sp, toShell: toShell } };
      const built = CBZ.cityMakeBuilding(root, Q.x, Q.z, wS, dS, Sp.st, Sp.wall, side, opts);
      // out of the shell registry: metro.js would give it a far copy (the tile has one)
      if (shells && shells.length > n0) shells.splice(n0, shells.length - n0);
      if (!built || !built.group) return;
      built.metroHome = true;
      try { paintDoor(built, Sp.door); } catch (err) {}
      const dp = L2W(b, Sp.body.cx, b.d / 2 + 1.6), dn = [Math.sin(r), Math.cos(r)];
      const doorPt = { x: dp[0], z: dp[1], nx: dn[0], nz: dn[1] };
      built.name = "House"; built.side = side; built.door = doorPt; built.x = Q.x; built.z = Q.z;
      built.driveAt = yard.driveAt; built.driveHalf = yard.driveHalf;
      built.home = lot.home; lot.home.door = doorPt;
      if (diag) built.frameYaw = r;
      lot.building = built; lot.parcel = { w: Math.abs(N[0]) > 0.5 ? Lt.lotD : Lt.lotW, d: Math.abs(N[0]) > 0.5 ? Lt.lotW : Lt.lotD };
      lot.demolished = false;
      e.built = built;
      const keep = new Set();
      for (const dr of built.doors || []) if (dr && dr.col) keep.add(dr.col);
      if (built.lbox) { try { HK.furnish(built, lot); } catch (err) { if (window.console) console.warn("[metro house]", err); } }
      try { mergeHouseCols(built, m.c0, keep); } catch (err) { if (window.console) console.warn("[metro house cols]", err); }
      if (X) turnAll(X, root, m);
      // THE INSIDE IS SOLID WHILE YOU ARE INSIDE: the partitions, the room
      // doors and the stair are out of the world's list until you come in
      // (gateInside); the outer walls and the front door stay
      const C = CBZ.colliders, inner = [];
      let w = m.c0;
      for (let j = m.c0; j < C.length; j++) { const c = C[j]; if (c.houseWall || keep.has(c)) C[w++] = c; else { c._hmOut = true; inner.push(c); } }
      C.length = w;
      e.inner = inner;
    }, "metro-house");
    // (its yard is the next decision's work: two short builds, not one long one)
    e.yardArgs = Object.assign({}, yard, { y: GY, storeys: Sp.st, tier: tier, wealth: wealth });
    if (!e.built) {
      if (e.job) CBZ.streamOwnFree(e.job);
      lot.building = lot._stub;
      refused.add(b); stats.refused++;
      return null;
    }
    // the tile's copy of it, and that copy's collider, step aside
    try { MF.cutBuilding(P, i, true); } catch (err) {}
    const S = CBZ.structure;
    if (S && S.extraLots) S.extraLots.push(lot);
    byB.set(b, e); live.push(e);
    stats.built++; if (diag) stats.diag++;
    stats.lastMs = Math.round(performance.now() - t0); stats.maxMs = Math.max(stats.maxMs, stats.lastMs);
    return e;
  }

  function buildYard(e) {
    const root = arenaRoot(), HL = CBZ.houseLot, args = e.yardArgs;
    e.yardArgs = null;
    if (!root || !HL || !args || !e.lot) return;
    const t0 = performance.now();
    e.yardJob = CBZ.streamOwnJob(e.rect, function () {
      const m = marks(root);
      try { e.yard = HL.dress(root, Object.assign(args, { lot: e.lot })); }
      catch (err) { if (window.console) console.warn("[metro house lot]", err); }
      if (e.X) turnAll(e.X, root, m, function (X) { if (e.yard && HL.turnRec) HL.turnRec(e.yard, X, e.lot && e.lot.building); });
    }, "metro-house-lot");
    stats.maxMs = Math.max(stats.maxMs, Math.round(performance.now() - t0));
  }

  /* ---- and let one go ---------------------------------------------------- */
  function free(e, worldGone) {
    const k = live.indexOf(e); if (k >= 0) live.splice(k, 1);
    byB.delete(e.b);
    const S = CBZ.structure;
    const lot = e.lot;
    if (lot) {
      try { if (S && S.forgetLot) S.forgetLot(lot); } catch (err) {}
      if (S && S.extraLots) { const j = S.extraLots.indexOf(lot); if (j >= 0) S.extraLots.splice(j, 1); }
    }
    if (e.built) {
      try { if (CBZ.collapse && CBZ.collapse.forget) CBZ.collapse.forget(e.built); } catch (err) {}
      try { if (CBZ.fitoutForget) CBZ.fitoutForget(e.built); } catch (err) {}
      for (const dr of e.built.doors || []) dr.demolished = true;
      const all = CBZ.cityDoorsGet ? CBZ.cityDoorsGet() : null;
      if (all && e.built.doors) for (const dr of e.built.doors) { const j = all.indexOf(dr); if (j >= 0) all.splice(j, 1); }
      // the lot outlives the house: back to its record (the drive's stand kept)
      if (lot) {
        if (e.built.garage) lot._stub.garage = e.built.garage;
        lot.building = lot._stub;
        if (lot.home) lot.home.door = lot._stub.door;
      }
    }
    if (worldGone) { if (e.P && e.P.__cut) e.P.__cut.delete(e.i); return; }
    // what the job does not know it has: the inside's boxes while you were in
    if (e.inner && e.inner.length && CBZ.colliderRemoveMany) { try { CBZ.colliderRemoveMany(e.inner); } catch (err) {} }
    try { if (e.yardJob) CBZ.streamOwnFree(e.yardJob); } catch (err) { if (window.console) console.warn("[metro house lot free]", err); }
    try { if (e.job) CBZ.streamOwnFree(e.job); } catch (err) { if (window.console) console.warn("[metro house free]", err); }
    try { if (CBZ.metroFabric && CBZ.metroFabric.cutBuilding) CBZ.metroFabric.cutBuilding(e.P, e.i, false); } catch (err) {}
    stats.freed++;
  }
  HM.freeAll = function () { for (let i = live.length - 1; i >= 0; i--) free(live[i]); };

  /* ---- a turned house's lazy fit-out: its colliders turned as they come --- */
  function turnFitouts() {
    let dirty = false;
    for (const e of live) {
      if (!e.X || !e.built) continue;
      const s = CBZ.fitoutSiteOf ? CBZ.fitoutSiteOf(e.built) : null;
      if (!s || !s.live) continue;
      for (const k in s.live) {
        const L = s.live[k];
        if (!L || !L.cols) continue;
        for (const c of L.cols) if (!c._hmX) { e.X.col(c); dirty = true; }
      }
    }
    if (dirty && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  /* THE FURNITURE IS SOLID WHILE YOU ARE IN THE HOUSE. The fit-out is built
     as you come up the walk (city/fitout.js), and its beds, sofas, tables
     and counters were boxes in the world from then on: twenty more
     colliders per house you only walked past. Outside, they are out. */
  function insideHouse(e, x, z, y) {
    const b = e.built; if (!b) return false;
    let lx = x - b.ox, lz = z - b.oz;
    if (e.X) { const c = Math.cos(e.r), s = Math.sin(e.r); const qx = lx * c - lz * s, qz = lx * s + lz * c; lx = qx; lz = qz; }
    return Math.abs(lx) < b.w / 2 + 0.6 && Math.abs(lz) < b.d / 2 + 0.6 && y < (b.storeys || 1) * (b.FH || 3.2) + 1.5 && y > -2;
  }
  function gateFitouts(px, pz, py) {
    const out = [], back = [];
    const C = CBZ.colliders;
    for (const e of live) {
      if (!e.built) continue;
      const inside = insideHouse(e, px, pz, py);
      if (e.inner && inside !== !!e.inIn) {
        e.inIn = inside;
        for (const c of e.inner) {
          // (a room door shut behind somebody put its own box back already)
          if (inside) { if (c._hmOut) { c._hmOut = false; if (!c.door || C.indexOf(c) < 0) back.push(c); } }
          else if (!c._hmOut) { c._hmOut = true; out.push(c); }
        }
      }
      const s = CBZ.fitoutSiteOf ? CBZ.fitoutSiteOf(e.built) : null;
      if (!s || !s.live) continue;
      for (const k in s.live) {
        const L = s.live[k];
        if (!L || !L.cols) continue;
        for (const c of L.cols) {
          if (inside) { if (c._hmOut) { c._hmOut = false; back.push(c); } }
          else if (!c._hmOut) { c._hmOut = true; out.push(c); }
        }
      }
    }
    if (out.length && CBZ.colliderRemoveMany) CBZ.colliderRemoveMany(out);
    if (back.length) { if (CBZ.colliderAddMany) CBZ.colliderAddMany(back); else for (const c of back) CBZ.colliders.push(c); }
  }

  /* ---- the decision, four times a second --------------------------------- */
  function inRect(r, x, z, pad) { return x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad; }
  function ownedHere(e) { return !!(e.lot && e.lot.home && e.lot.home.owned); }
  function tick(dt) {
    const root = arenaRoot();
    if (root !== rootRef) { for (let i = live.length - 1; i >= 0; i--) free(live[i], !!rootRef); rootRef = root; regDone = false; }
    if (!root) return;
    if (!inCity() || !CFG.METRO_HOMES) { if (live.length) HM.freeAll(); return; }
    turnFitouts();
    scanT -= dt;
    if (scanT > 0) return;
    scanT = SCAN;
    if (!regDone) { try { register(); } catch (err) { if (window.console) console.warn("[metro homes market]", err); regDone = true; } }
    const Pl = CBZ.player;
    if (!Pl || !Pl.pos) return;
    const px = Pl.pos.x, pz = Pl.pos.z;
    gateFitouts(px, pz, Pl.pos.y || 0);
    const RI = rIn(), RO = rOut(), cap = maxLive();
    // those the player has left (a house you own stays real a long way out)
    for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i];
      const d = Math.hypot(e.cx - px, e.cz - pz);
      if (d > (ownedHere(e) ? 320 : RO + 10) && !inRect(e.rect, px, pz, 2)) free(e);
    }
    // a house standing without its yard yet: that first
    for (const e of live) if (e.yardArgs) { buildYard(e); return; }
    // not at speed, not from the air
    const v = Pl._vehicle;
    if (v && (v.airClass || Math.abs(v.v || 0) > 14)) return;
    if (Pl.pos.y > 30) return;
    let best = null, bd = RI;
    for (const M of plans()) {
      eachNear(M.plan, px, pz, RI + 12, function (i, b) {
        if (byB.has(b) || refused.has(b)) return;
        let d = Math.max(0, Math.hypot(b.x - px, b.z - pz) - Math.min(b.w, b.d) / 2);
        const lot = LOTS.get(keyOf(M, i));
        if (lot && lot.home && lot.home.owned) d -= 30;            // yours first
        if (d < bd) { bd = d; best = { M: M, i: i }; }
      });
    }
    if (!best) return;
    let count = 0; for (const e of live) if (!ownedHere(e)) count++;
    if (count >= cap) {
      // room for a nearer one: the farthest goes back first
      let far = null, fd = bd + 14;
      for (const e of live) { if (ownedHere(e)) continue; const d = Math.hypot(e.cx - px, e.cz - pz); if (d > fd && !inRect(e.rect, px, pz, 2)) { fd = d; far = e; } }
      if (!far) return;
      free(far);
    }
    build(best.M, best.i);
  }
  if (CBZ.onUpdate) CBZ.onUpdate(41.7, function (dt) { try { tick(dt || 0.016); } catch (e) { if (window.console) console.warn("[metro homes]", e); } });

  HM.live = function () { return live.slice(); };
  HM.stats = stats;
  HM.lotLocal = lotLocal;
  HM.of = function (b) { return byB.get(b) || null; };
  HM.rIn = rIn;
  // (tools and presets) make house i of plan M real now, whoever stands where
  HM.buildNow = function (M, i) {
    const b = M && M.plan && M.plan.bldgs[i]; if (!b) return null;
    const e = byB.get(b) || build(M, i);
    if (e && e.yardArgs) buildYard(e);
    return e;
  };
  HM.free = function (e) { if (e && live.indexOf(e) >= 0) free(e); };
})();
