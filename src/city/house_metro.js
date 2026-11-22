/* ============================================================
   city/house_metro.js — A METRO SUBURB'S HOUSE, MADE REAL WHILE YOU ARE ON
   ITS STREET.

   Kingsport, Karvel and the ring towns draw their ~2,900 houses as part of
   one merged mesh per 800 m tile (city/metro_fabric.js): a painted box with
   a roof, no door, nothing inside. A real house (a shell with a floor plan,
   a stair, room doors, a fit-out, a yard) costs dozens of meshes and
   colliders; nobody can hold 2,900 of them, a phone least of all. So the
   houses round the player on foot are made real one at a time and go back
   to the tile when the player has left:

     * WHICH. A plan record of type "house" that stands square to the axes
       (the shell builder is axis-aligned; the ones on a diagonal avenue stay
       painted) on level ground, nearest first, within R_IN of its footprint.
       Not while driving fast or flying: a house you pass at speed is a
       facade either way.
     * WHAT. The same house a town lot gets: the shell through
       CBZ.cityMakeBuilding in the grammar its district wears, the floor plan
       and stair (city/house_plan.js), the walk-in fit-out
       (city/fitout_house.js), and the lot dressed by the yard kit
       (city/house_yard.js) in the tier of the district's wealth. Its body,
       its garage wing and its drive are where the tile drew them
       (CBZ.metroFabric.houseParts: one rule for both).
     * THE LOT is read from the world, not stored: the side lines are half
       the gap to the next house in the row, the back line half the gap to
       the house behind, the front line where the lawn ends at the street
       (the metro ground's own kindAt), every corner on lawn.
     * HOW IT LEAVES. The whole build runs as one owner-held stream job
       (core/citystream.js CBZ.streamOwnJob): every mesh, collider,
       platform, door, stair and light it registered leaves with it, the
       tile's copy of the house and its collider come back
       (metro_fabric.js cutBuilding), and its fit-out site is forgotten.

   These houses are for walking into, living next to and robbing; they are
   not on the property ladder (city/realestate.js sells town and city lots).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || CBZ.metroHomes) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.METRO_HOMES == null) CFG.METRO_HOMES = true;

  const HM = (CBZ.metroHomes = {});
  const CELL = 48;                 // metres: the house index's grid
  const SCAN = 0.25;               // seconds between decisions
  const GY = 0.16;                 // the pad level a metro house stands on (metro_fabric.js)
  const live = [];                 // { M, P, i, b, job, lot, built, cx, cz, rect }
  const byB = new Map();           // plan building -> entry
  const refused = new WeakSet();   // records that cannot be a real house (tried once)
  const IDX = new WeakMap();       // plan -> { cells }
  const stats = { built: 0, freed: 0, refused: 0, lastMs: 0, maxMs: 0 };
  let rootRef = null, scanT = 0;

  function q(lo, hi) { return CBZ.qScale ? CBZ.qScale(lo, hi) : hi; }
  function rIn() { return q(24, 44); }
  function rOut() { return rIn() + 24; }
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
  function h01(x, z, s) {
    if (CBZ.hash01) return CBZ.hash01(x, z, s);
    let h = (Math.round(x * 8) * 374761393 + Math.round(z * 8) * 668265263 + (s | 0) * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

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
  function quarter(b) {
    const r = +b.rot || 0, k = Math.round(r / (Math.PI / 2));
    return Math.abs(r - k * Math.PI / 2) > 0.05 ? null : k;
  }
  // half extents of a house along a unit axis (ux, uz)
  function extent(b, ux, uz) {
    const r = +b.rot || 0, c = Math.cos(r), s = Math.sin(r);
    // local x = (c, -s), local z = (s, c)
    return Math.abs(ux * c - uz * s) * b.w / 2 + Math.abs(ux * s + uz * c) * b.d / 2;
  }

  /* ---- THE LOT, READ FROM THE WORLD ---------------------------------------
     Returns city/house_yard.js's plan record (HL.plan's shape) for house i of
     M's plan, or null where no real house can stand. */
  function lotPlan(M, i) {
    const P = M.plan, b = P.bldgs[i];
    const MF = CBZ.metroFabric, HL = CBZ.houseLot;
    if (!MF || !MF.houseParts || !HL) return null;
    const k = quarter(b);
    if (k == null || Math.abs(+b.y || 0) > 0.3 || !(b.w >= 7 && b.d >= 7.6)) return null;
    const fx = Math.round(Math.sin(k * Math.PI / 2)), fz = Math.round(Math.cos(k * Math.PI / 2));   // toward the street
    const tx = -fz, tz = fx;                                     // house_yard.js's street axis (the tile's local x is -t)
    const S = M.ground && M.ground.solve;
    const lawn = function (x, z) {
      if (!S || !S.kindAt) return true;
      let kd = 0; try { kd = S.kindAt(x, z); } catch (e) { return false; }
      return kd === 4 || kd === 3;
    };
    if (S && S.heightAt) { let y = null; try { y = S.heightAt(b.x, b.z); } catch (e) {} if (y != null && Math.abs(y - GY) > 0.25) return null; }
    // the next house each way along the row, and the one behind
    let gHi = 1e9, gLo = 1e9, gBack = 1e9;
    eachNear(P, b.x, b.z, 44, function (j, o) {
      if (j === i) return;
      const dx = o.x - b.x, dz = o.z - b.z;
      const dt = dx * tx + dz * tz, da = dx * fx + dz * fz;
      const eT = extent(o, tx, tz), eA = extent(o, fx, fz);
      if (Math.abs(da) < b.d / 2 + eA + 1.5) {
        if (dt > 0) gHi = Math.min(gHi, dt - eT - b.w / 2); else gLo = Math.min(gLo, -dt - eT - b.w / 2);
      } else if (da < 0 && Math.abs(dt) < b.w / 2 + eT + 1) gBack = Math.min(gBack, -da - eA - b.d / 2);
    });
    let sHi = gHi > 1e8 ? 2.8 : clamp(gHi / 2, 1.0, 4.5), sLo = gLo > 1e8 ? 2.8 : clamp(gLo / 2, 1.0, 4.5);
    let rear = gBack > 1e8 ? 6.5 : clamp(gBack / 2, 2.4, 9);
    // the front line: where the lawn ends
    let fy = 0;
    for (let t = 0.5; t <= 16; t += 0.5) { if (!lawn(b.x + fx * (b.d / 2 + t), b.z + fz * (b.d / 2 + t))) break; fy = t; }
    const front = fy - 1.0;                                      // a metre of verge at the kerb
    if (front < 2.6) return null;
    // every corner on lawn: pull a line in until it is
    const ok = function (t, a) { return lawn(b.x + tx * t + fx * a, b.z + tz * t + fz * a); };
    for (let n = 0; n < 8 && sHi > 1.0 && !(ok(b.w / 2 + sHi, b.d / 2 + front) && ok(b.w / 2 + sHi, 0) && ok(b.w / 2 + sHi, -b.d / 2 - rear)); n++) sHi = Math.max(1.0, sHi - 0.5);
    for (let n = 0; n < 8 && sLo > 1.0 && !(ok(-b.w / 2 - sLo, b.d / 2 + front) && ok(-b.w / 2 - sLo, 0) && ok(-b.w / 2 - sLo, -b.d / 2 - rear)); n++) sLo = Math.max(1.0, sLo - 0.5);
    for (let n = 0; n < 12 && rear > 2.4 && !(ok(0, -b.d / 2 - rear) && ok(b.w / 2 + sHi, -b.d / 2 - rear) && ok(-b.w / 2 - sLo, -b.d / 2 - rear)); n++) rear = Math.max(2.4, rear - 0.5);

    const HP = MF.houseParts(b);
    const tc = (sHi - sLo) / 2, ac = (front - rear) / 2;         // the lot centre, from the record's
    const lotT = b.w + sLo + sHi, lotA = b.d + rear + front;
    const cx = b.x + tx * tc + fx * ac, cz = b.z + tz * tc + fz * ac;
    const bodyT = -HP.bx;                                        // the body's centre along t, from the record's
    const hw = HP.bhw * 2, hd = b.d;
    const x = b.x + tx * bodyT, z = b.z + tz * bodyT;
    let garage = null, driveAt, driveHalf;
    if (HP.gW > 0) {
      const gT = -HP.gs * (b.w / 2 - HP.gW / 2);
      garage = { t: gT - tc, w: HP.gW, d: Math.min(HL.GARAGE_D, hd - 0.5) };
      driveAt = gT - tc; driveHalf = HP.gW > 5 ? 2.7 : 1.6;
    } else {
      driveAt = -HP.driveOff - tc; driveHalf = 1.6;
      // a front too narrow to leave the door clear of the drive: the drive on the side line
      if (Math.abs(-HP.driveOff - bodyT) < 2.6) driveAt = -HP.gs * (b.w / 2 - 1.7) - tc;
    }
    const t = bodyT - tc;
    return {
      x: x, z: z, w: fx ? hd : hw, d: fx ? hw : hd, hw: hw, hd: hd, t: t, a: -ac, front: front, garage: garage,
      gs: (driveAt - t) > 0 ? -1 : 1, driveAt: driveAt, driveHalf: driveHalf,
      tx: tx, tz: tz, nx: fx, nz: fz, lotT: lotT, lotA: lotA, cx: cx, cz: cz,
      side: fz > 0 ? 1 : fz < 0 ? 0 : fx > 0 ? 3 : 2,
      // the lines nobody shares with this lot (house_yard.js draws those itself)
      open: { lo: gLo > 1e8 || gLo > 9.5, back: gBack > 1e8 || gBack > 18 },
    };
  }

  /* ---- who lives there, and in what -------------------------------------- */
  const LOOKS = {
    "hood-brick": ["brickhouse", "queenanne"], "hood-wood": ["queenanne", "brickhouse"],
    "house-ranch": ["ranch", "desertmod"], "house-colonial": ["greekrev", "manor"],
    "house-craftsman": ["queenanne", "ranch"], "house-stucco": ["adobe", "desertmod"],
  };
  function styleOf(M, b, storeys, wealth) {
    const HK = CBZ.cityHouse, d = M.plan.districts && M.plan.districts[b.dist];
    const fits = function (id) {
      const def = id && CBZ.facadeDef ? CBZ.facadeDef(id) : null;
      return !!def && storeys >= (def.minStoreys || 0) && storeys <= (def.maxStoreys || Infinity);
    };
    const list = d && d.look ? LOOKS[d.look.id] : null;
    if (list) {
      let id = h01(b.x, b.z, 0x4c1) < 0.74 ? list[0] : list[1];
      // a half-timbered manor is money: on a street without it, the plain one
      if (id === "manor" && wealth < 0.64) id = list[0] === "manor" ? "brickhouse" : list[0];
      if (fits(id)) return id;
      if (fits(list[0])) return list[0];
    }
    return HK && HK.styleFor ? HK.styleFor({ cx: b.x, cz: b.z, town: M.name + ":" + (d ? d.name : "") }, storeys, wealth) : null;
  }
  /* A plan's district wealth is its land value, and a metro's land value is
     its downtown's: every district with houses in it scores 0.1 to 0.6, which
     by a town's measure is one poor street after another. So a house's
     wealth is its district's place AMONG THE DISTRICTS THAT HAVE HOUSES, the
     poorest of them poor and the best of them rich. */
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

  /* ---- build one --------------------------------------------------------- */
  function build(M, i) {
    const P = M.plan, b = P.bldgs[i], root = arenaRoot();
    const HK = CBZ.cityHouse, HL = CBZ.houseLot, MF = CBZ.metroFabric;
    if (!root || !HK || !HL || !MF || !CBZ.cityMakeBuilding || !CBZ.streamOwnJob) return null;
    const tile = MF.tileOfBuilding ? MF.tileOfBuilding(P, i) : null;
    if (!tile || !tile.built) return null;                       // its street is not drawn yet
    const p = lotPlan(M, i);
    if (!p) { refused.add(b); stats.refused++; return null; }
    const storeys = clamp(b.st > 0 ? Math.round(b.st) : 1, 1, 3);
    const wealth = wealthOf(M, b), tier = HK.tierOf(wealth);
    const style = styleOf(M, b, storeys, wealth);
    const e = { M: M, P: P, i: i, b: b, job: null, lot: null, built: null, cx: p.cx, cz: p.cz, p: p, t: 0 };
    const a = { x: p.cx - p.tx * p.lotT / 2 - p.nx * p.lotA / 2, z: p.cz - p.tz * p.lotT / 2 - p.nz * p.lotA / 2 };
    const c = { x: p.cx + p.tx * p.lotT / 2 + p.nx * p.lotA / 2, z: p.cz + p.tz * p.lotT / 2 + p.nz * p.lotA / 2 };
    e.rect = { minX: Math.min(a.x, c.x), maxX: Math.max(a.x, c.x), minZ: Math.min(a.z, c.z), maxZ: Math.max(a.z, c.z) };
    const t0 = performance.now();
    e.job = CBZ.streamOwnJob(e.rect, function () {
      const shells = root.userData && root.userData.shells, n0 = shells ? shells.length : 0;
      const opts = { stairs: false };
      if (style) opts.dress = { style: style };
      const built = CBZ.cityMakeBuilding(root, p.x, p.z, p.w, p.d, storeys, b.wall != null ? b.wall : 0xcfc8b8, p.side, opts);
      // out of the shell registry: metro.js would give it a far copy (the tile has one)
      if (shells && shells.length > n0) shells.splice(n0, shells.length - n0);
      if (!built || !built.group) return;
      built.metroHome = true;
      const doorPt = { x: p.x + p.nx * (p.hd / 2 + 1.6), z: p.z + p.nz * (p.hd / 2 + 1.6), nx: p.nx, nz: p.nz };
      built.name = "House"; built.side = p.side; built.door = doorPt; built.x = p.x; built.z = p.z;
      built.driveAt = p.driveAt; built.driveHalf = p.driveHalf;
      built.home = { tier: 0, name: "Home", price: 0, rent: Math.round(60 + wealth * 240), listed: false, owned: false, floorY: 0, door: doorPt, metro: true };
      const d = P.districts && P.districts[b.dist];
      const lot = { cx: p.x, cz: p.z, w: p.w, d: p.d, kind: "home", town: M.name, district: d ? d.name : "", building: built,
        wealth: wealth, parcel: { w: p.nx ? p.lotA : p.lotT, d: p.nx ? p.lotT : p.lotA }, metro: M.id, metroIndex: i, metroHome: true };
      e.built = built; e.lot = lot;
      if (built.lbox) { try { HK.furnish(built, lot); } catch (err) { if (window.console) console.warn("[metro house]", err); } }
    }, "metro-house");
    // (its yard is the next decision's work: two short builds, not one long one)
    e.yardArgs = Object.assign({}, p, { y: GY, storeys: storeys, tier: tier, wealth: wealth });
    if (!e.built) {
      if (e.job) CBZ.streamOwnFree(e.job);
      refused.add(b); stats.refused++;
      return null;
    }
    // the tile's copy of it, and that copy's collider, step aside
    try { MF.cutBuilding(P, i, true); } catch (err) {}
    const S = CBZ.structure;
    if (S && S.extraLots) S.extraLots.push(e.lot);
    byB.set(b, e); live.push(e);
    stats.built++; stats.lastMs = Math.round(performance.now() - t0); stats.maxMs = Math.max(stats.maxMs, stats.lastMs);
    return e;
  }

  function buildYard(e) {
    const root = arenaRoot(), HL = CBZ.houseLot, args = e.yardArgs;
    e.yardArgs = null;
    if (!root || !HL || !args || !e.lot) return;
    const t0 = performance.now();
    e.yardJob = CBZ.streamOwnJob(e.rect, function () {
      try { e.yard = HL.dress(root, Object.assign(args, { lot: e.lot })); }
      catch (err) { if (window.console) console.warn("[metro house lot]", err); }
    }, "metro-house-lot");
    stats.maxMs = Math.max(stats.maxMs, Math.round(performance.now() - t0));
  }

  /* ---- and let one go ---------------------------------------------------- */
  function free(e, worldGone) {
    const k = live.indexOf(e); if (k >= 0) live.splice(k, 1);
    byB.delete(e.b);
    const S = CBZ.structure;
    if (e.lot) {
      try { if (S && S.forgetLot) S.forgetLot(e.lot); } catch (err) {}
      if (S && S.extraLots) { const j = S.extraLots.indexOf(e.lot); if (j >= 0) S.extraLots.splice(j, 1); }
      e.lot.demolished = true;                                   // anything still holding it lets go
    }
    if (e.built) {
      try { if (CBZ.collapse && CBZ.collapse.forget) CBZ.collapse.forget(e.built); } catch (err) {}
      try { if (CBZ.fitoutForget) CBZ.fitoutForget(e.built); } catch (err) {}
      for (const dr of e.built.doors || []) dr.demolished = true;
      const all = CBZ.cityDoorsGet ? CBZ.cityDoorsGet() : null;
      if (all && e.built.doors) for (const dr of e.built.doors) { const j = all.indexOf(dr); if (j >= 0) all.splice(j, 1); }
    }
    if (worldGone) { if (e.P && e.P.__cut) e.P.__cut.delete(e.i); return; }
    try { if (e.yardJob) CBZ.streamOwnFree(e.yardJob); } catch (err) { if (window.console) console.warn("[metro house lot free]", err); }
    try { if (e.job) CBZ.streamOwnFree(e.job); } catch (err) { if (window.console) console.warn("[metro house free]", err); }
    try { if (CBZ.metroFabric && CBZ.metroFabric.cutBuilding) CBZ.metroFabric.cutBuilding(e.P, e.i, false); } catch (err) {}
    stats.freed++;
  }
  HM.freeAll = function () { for (let i = live.length - 1; i >= 0; i--) free(live[i]); };

  /* ---- the decision, four times a second --------------------------------- */
  function inRect(r, x, z, pad) { return x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad; }
  function tick(dt) {
    const root = arenaRoot();
    if (root !== rootRef) { for (let i = live.length - 1; i >= 0; i--) free(live[i], !!rootRef); rootRef = root; }
    if (!root) return;
    if (!inCity() || !CFG.METRO_HOMES) { if (live.length) HM.freeAll(); return; }
    scanT -= dt;
    if (scanT > 0) return;
    scanT = SCAN;
    const Pl = CBZ.player;
    if (!Pl || !Pl.pos) return;
    const px = Pl.pos.x, pz = Pl.pos.z;
    const RI = rIn(), RO = rOut(), cap = maxLive();
    // those the player has left
    for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i];
      if (Math.hypot(e.cx - px, e.cz - pz) > RO + 10 && !inRect(e.rect, px, pz, 2)) free(e);
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
        const d = Math.max(0, Math.hypot(b.x - px, b.z - pz) - Math.min(b.w, b.d) / 2);
        if (d < bd) { bd = d; best = { M: M, i: i }; }
      });
    }
    if (!best) return;
    if (live.length >= cap) {
      // room for a nearer one: the farthest goes back first
      let far = null, fd = bd + 14;
      for (const e of live) { const d = Math.hypot(e.cx - px, e.cz - pz); if (d > fd && !inRect(e.rect, px, pz, 2)) { fd = d; far = e; } }
      if (!far) return;
      free(far);
    }
    build(best.M, best.i);
  }
  if (CBZ.onUpdate) CBZ.onUpdate(41.7, function (dt) { try { tick(dt || 0.016); } catch (e) { if (window.console) console.warn("[metro homes]", e); } });

  HM.live = function () { return live.slice(); };
  HM.stats = stats;
  HM.lotPlan = lotPlan;
  HM.of = function (b) { return byB.get(b) || null; };
  // (tools and presets) make house i of plan M real now, whoever stands where
  HM.buildNow = function (M, i) {
    const b = M && M.plan && M.plan.bldgs[i]; if (!b) return null;
    const e = byB.get(b) || build(M, i);
    if (e && e.yardArgs) buildYard(e);
    return e;
  };
})();
