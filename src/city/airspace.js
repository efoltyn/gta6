/* ============================================================
   city/airspace.js — WHAT AN AEROPLANE CAN HIT, EVERYWHERE IN THE WORLD.

   OWNER (2026-10-19): "planes fly too low, and they fly through buildings
   instead of hitting a building 9/11-style."

   Both halves of that were the same missing fact. Every flying thing in the
   game asked CBZ.colliders what was in front of it, and colliders only exist
   where the world is BUILT near the camera: a Kingsbridge tower 3 km away is
   a far HLOD draw with no collider at all, so an airliner flying the old
   90-380 m "scaled" cruise straight across the metro went through every
   tower it met, and nothing could plan a route over a skyline it could not
   see. The buildings were always known — as DATA: the metro planner's
   records (city/metroplan.js, footprint + rotation + height for every
   building in every planned city) and the built world's far records
   (city/metro.js BUILT: every other shell, lot and town plan, the same
   numbers the far HLOD is drawn from). This file reads those records, once
   per world, into one coarse spatial index and answers three questions:

     CBZ.airspace.topNear(x, z, r)   the tallest roof within r (route planning)
     CBZ.airspace.ringTop(cx,cz,R,p) the tallest roof under an orbit ring
     CBZ.airspace.sweep(...)         the first building a moving body meets,
                                     against the RECORDS (far buildings) and
                                     the live colliders (near detail) both
     CBZ.airspace.sweepAirframe(...) the same for a whole airframe (fuselage
                                     + both wingtips, the cut a wing makes)

   THE INDEX. 100 m cells holding every footprint that overlaps them, plus
   two max-height pyramids (400 m, 1600 m) so a corridor query a few km wide
   costs a 3x3 lookup instead of a thousand cells. Numeric keys, no strings.
   A record carries its oriented box (centre, half extents, yaw), its base and
   roof height, and what it is (a Gang City lot, a built-world record, a
   metro plan building) so an impact can be resolved to the building that
   owns it.

   RECORDS VS COLLIDERS. Near the camera the real geometry is registered as
   colliders and those are authoritative (setbacks, podiums, the real roof).
   A record hit is therefore only accepted where no tall collider covers that
   footprint — i.e. exactly where the building exists only as a far draw.
   That keeps a far tower solid without ever letting a coarse record box
   invent a wall in a gap the real building has.

   COST. The index is built once per world (a few tens of thousands of
   records, one pass) and re-checked every 3 s by a length signature. A
   sweep first asks the cell tops along the step: an aircraft above every
   roof under it costs a couple of Map lookups and returns. The live collider
   query only runs below the tallest collider top in the world.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.airspace) return;

  const AS = (CBZ.airspace = {});
  const CELL = 100;                 // metres, level 0
  const K1 = 4, K2 = 16;            // pyramid levels: 400 m, 1600 m cells
  const OFF = 32768;
  function key(ix, iz) { return (ix + OFF) * 65536 + (iz + OFF); }

  let recs = [];
  let cells = new Map();            // L0 key -> { top, list: [rec] }
  let top1 = new Map(), top2 = new Map();
  let maxTop = 0, colTop = 0, colN = -1;
  let sig = "", checkT = -1, builds = 0, stamp = 0;
  const stats = { sweeps: 0, early: 0, recHits: 0, colHits: 0, covered: 0 };

  function inCity() { return !CBZ.game || CBZ.game.mode === "city"; }
  function terrain(x, z) {
    let h = 0;
    if (typeof CBZ.terrainHeight === "function") { const v = +CBZ.terrainHeight(x, z); if (isFinite(v)) h = v; }
    return h;
  }
  AS.terrainAt = terrain;

  // ---- the sources --------------------------------------------------------
  function metroSets() {
    const out = [];
    for (const M of CBZ.metroCities || []) if (M && M.plan && M.plan.bldgs) out.push(M);
    if (CBZ.metroCountryside && CBZ.metroCountryside.plan && CBZ.metroCountryside.plan.bldgs) out.push(CBZ.metroCountryside);
    return out;
  }
  function builtRecs() {
    try { return (CBZ.metroBuiltRecords && CBZ.metroBuiltRecords()) || []; } catch (e) { return []; }
  }
  function arenaLots() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A) return [];
    let lots = A.lots || [];
    if (A.annex && Array.isArray(A.annex.lots) && A.annex.lots.length) lots = lots.concat(A.annex.lots);
    return lots;
  }
  function signature() {
    let n = 0;
    const ms = metroSets();
    for (const M of ms) n += M.plan.bldgs.length;
    const A = CBZ.city && CBZ.city.arena;
    return ms.length + ":" + n + ":" + builtRecs().length + ":" + arenaLots().length + ":" + (A && A.root ? A.root.uuid || 1 : 0);
  }

  function addRec(r) {
    if (!(r.hw > 0.5 && r.hd > 0.5) || !(r.y1 > r.y0 + 1.5) || !isFinite(r.cx) || !isFinite(r.cz)) return;
    if (r.yaw) { r.co = Math.cos(r.yaw); r.si = Math.sin(r.yaw); } else { r.co = 1; r.si = 0; r.yaw = 0; }
    const ac = Math.abs(r.co), as = Math.abs(r.si);
    r.ex = r.hw * ac + r.hd * as; r.ez = r.hw * as + r.hd * ac;     // world AABB half extents
    r.top = Math.max(r.y1, r.tip || 0);
    r._s = 0;
    recs.push(r);
    const ix0 = Math.floor((r.cx - r.ex) / CELL), ix1 = Math.floor((r.cx + r.ex) / CELL);
    const iz0 = Math.floor((r.cz - r.ez) / CELL), iz1 = Math.floor((r.cz + r.ez) / CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const k = key(ix, iz);
      let c = cells.get(k);
      if (!c) cells.set(k, c = { top: 0, list: [] });
      c.list.push(r);
      if (r.top > c.top) c.top = r.top;
      const k1 = key(Math.floor(ix / K1), Math.floor(iz / K1)), k2 = key(Math.floor(ix / K2), Math.floor(iz / K2));
      if (!(top1.get(k1) >= r.top)) top1.set(k1, r.top);
      if (!(top2.get(k2) >= r.top)) top2.set(k2, r.top);
    }
    if (r.top > maxTop) maxTop = r.top;
  }

  function rebuild() {
    recs = []; cells = new Map(); top1 = new Map(); top2 = new Map(); maxTop = 0;
    builds++;
    // 1. the planned cities: every building, at its true footprint, yaw and
    //    height, standing on the fabric's pad level (metro_fabric.js GY)
    for (const M of metroSets()) {
      for (const b of M.plan.bldgs) {
        if (!b || !(b.w > 1 && b.d > 1 && b.h > 1.5)) continue;
        // the same base metro_fabric.js draws and bounds a building at
        const gy = 0.16 + (+b.y || 0);
        let tip = 0;
        if (b.roof === "spire" && b.type === "tower") tip = gy + b.h + Math.max(28, 0.2 * b.h) + 11;
        else if (b.type === "clocktower") tip = gy + b.h + 16;
        addRec({ cx: b.x, cz: b.z, hw: b.w / 2, hd: b.d / 2, yaw: +b.rot || 0, y0: gy - 0.5, y1: gy + b.h, tip: tip,
                 src: "metro", city: M.id, b: b, lot: null, built: null });
      }
    }
    // 2. the built world (Gang City, its estates and annex, towns, compounds,
    //    the island): metro.js's far records — the shells that exist, the
    //    lots not built yet, the town plans and the replayed records. Each
    //    carries its lot when it has one, which is what lets an impact reach
    //    the structural ledger and the collapse system.
    const br = builtRecs();
    if (br.length) {
      for (const r of br) {
        const f = r && r.fab;
        if (!f) continue;
        const gy = +f.y || 0;
        addRec({ cx: f.x, cz: f.z, hw: f.w / 2, hd: f.d / 2, yaw: 0, y0: gy - 0.5, y1: gy + f.h, tip: 0,
                 src: "built", city: null, b: null, lot: r.lot || null, built: r });
      }
    } else {
      // degrade-safe: no far records yet — the arena's own lots
      for (const lot of arenaLots()) {
        const b = lot && lot.building;
        if (!b || b.park) continue;
        const w = +b.w || +lot.w, d = +b.d || +lot.d, h = +b.h || ((+b.storeys || 1) * (+b.FH || 3.2));
        const x = isFinite(+b.ox) ? +b.ox : +lot.cx, z = isFinite(+b.oz) ? +b.oz : +lot.cz;
        addRec({ cx: x, cz: z, hw: w / 2, hd: d / 2, yaw: 0, y0: -0.5, y1: h, tip: 0, src: "lot", city: null, b: b, lot: lot, built: null });
      }
    }
    scanColliderTop(true);
  }

  // the tallest live collider in the world (towers, cranes, masts, bridge
  // pylons) — the ceiling under which a sweep has to look at colliders at all
  function scanColliderTop(force) {
    const cols = CBZ.colliders;
    if (!cols) return;
    if (!force && cols.length === colN) return;
    colN = cols.length;
    let t = 0;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c && c.y1 != null && c.y1 > t && c.y1 < 900 && (c.y1 - (c.y0 || 0)) > 2.5) t = c.y1;
    }
    colTop = t;
  }

  function fresh() {
    const now = (performance && performance.now) ? performance.now() : Date.now();
    if (checkT >= 0 && now - checkT < 3000) return;
    checkT = now;
    const s = signature();
    if (s !== sig) { sig = s; try { rebuild(); } catch (e) { console.error("[airspace]", e); } }
    else scanColliderTop(false);
  }
  AS.refresh = function () { checkT = -1; sig = ""; fresh(); };

  // ---- height queries -----------------------------------------------------
  AS.maxTop = function () { fresh(); return Math.max(maxTop, colTop); };
  AS.topAt = function (x, z) {
    fresh();
    const c = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    return c ? c.top : 0;
  };
  // tallest roof within r of (x,z): the finest level whose cells keep the
  // lookup to <= ~49 cells. Conservative (whole cells), never optimistic.
  AS.topNear = function (x, z, r) {
    fresh();
    r = Math.max(0, r || 0);
    let size = CELL, map = null;
    if (r > 1200) { size = CELL * K2; map = top2; }
    else if (r > 300) { size = CELL * K1; map = top1; }
    const ix0 = Math.floor((x - r) / size), ix1 = Math.floor((x + r) / size);
    const iz0 = Math.floor((z - r) / size), iz1 = Math.floor((z + r) / size);
    let t = 0;
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const k = key(ix, iz);
      const v = map ? map.get(k) : (cells.get(k) || null);
      const h = map ? v : (v ? v.top : 0);
      if (h > t) t = h;
    }
    return t;
  };
  // tallest roof under an orbit ring of radius R, `pad` either side
  AS.ringTop = function (cx, cz, R, pad) {
    fresh();
    const out = R + pad, inn = Math.max(0, R - pad);
    const size = out > 900 ? CELL * K1 : CELL, map = size > CELL ? top1 : null;
    const ix0 = Math.floor((cx - out) / size), ix1 = Math.floor((cx + out) / size);
    const iz0 = Math.floor((cz - out) / size), iz1 = Math.floor((cz + out) / size);
    let t = 0;
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const x0 = ix * size, x1 = x0 + size, z0 = iz * size, z1 = z0 + size;
      const nx = Math.max(x0 - cx, 0, cx - x1), nz = Math.max(z0 - cz, 0, cz - z1);
      if (nx * nx + nz * nz > out * out) continue;
      const fx = Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx)), fz = Math.max(Math.abs(z0 - cz), Math.abs(z1 - cz));
      if (fx * fx + fz * fz < inn * inn) continue;
      const k = key(ix, iz);
      const h = map ? (map.get(k) || 0) : ((cells.get(k) || { top: 0 }).top);
      if (h > t) t = h;
    }
    return t;
  };
  // obstacle top + terrain inside a corridor half-width W at (x,z)
  AS.corridorTop = function (x, z, W, fx, fz) {
    let t = AS.topNear(x, z, W);
    let g = terrain(x, z);
    if (fx != null) {
      // across the track: the terrain either side, not only under the nose
      const rx = -fz * W, rz = fx * W;
      g = Math.max(g, terrain(x + rx, z + rz), terrain(x - rx, z - rz),
        terrain(x + rx * 0.5, z + rz * 0.5), terrain(x - rx * 0.5, z - rz * 0.5));
    }
    return Math.max(t, g);
  };

  // ---- the sweep ----------------------------------------------------------
  // segment vs box in the box's own frame (bounds already padded). Returns the
  // entry t and the entry face normal (local), or null.
  function segBox(x0, y0, z0, dx, dy, dz, minX, maxX, minY, maxY, minZ, maxZ, out) {
    let enter = 0, exit = 1, nx = 0, ny = 0, nz = 0, a, b, n;
    if (Math.abs(dx) < 1e-9) { if (x0 < minX || x0 > maxX) return null; }
    else {
      a = (minX - x0) / dx; b = (maxX - x0) / dx; n = -1;
      if (a > b) { const q = a; a = b; b = q; n = 1; }
      if (a > enter) { enter = a; nx = n; ny = 0; nz = 0; }
      if (b < exit) exit = b; if (enter > exit) return null;
    }
    if (Math.abs(dy) < 1e-9) { if (y0 < minY || y0 > maxY) return null; }
    else {
      a = (minY - y0) / dy; b = (maxY - y0) / dy; n = -1;
      if (a > b) { const q = a; a = b; b = q; n = 1; }
      if (a > enter) { enter = a; ny = n; nx = 0; nz = 0; }
      if (b < exit) exit = b; if (enter > exit) return null;
    }
    if (Math.abs(dz) < 1e-9) { if (z0 < minZ || z0 > maxZ) return null; }
    else {
      a = (minZ - z0) / dz; b = (maxZ - z0) / dz; n = -1;
      if (a > b) { const q = a; a = b; b = q; n = 1; }
      if (a > enter) { enter = a; nz = n; nx = 0; ny = 0; }
      if (b < exit) exit = b; if (enter > exit) return null;
    }
    if (enter > 1 || exit < 0) return null;
    if (!nx && !ny && !nz) {                         // started inside: push back along travel
      const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
      if (ax >= ay && ax >= az) nx = dx > 0 ? -1 : 1; else if (ay >= az) ny = dy > 0 ? -1 : 1; else nz = dz > 0 ? -1 : 1;
    }
    out.t = Math.max(0, enter); out.nx = nx; out.ny = ny; out.nz = nz;
    return out;
  }
  const _q = { t: 0, nx: 0, ny: 0, nz: 0 };

  function isAircraftCollider(c) {
    let o = c && c.ref, n = 0;
    while (o && n++ < 12) {
      if (o.userData && (o.userData.aircraftDims || o.userData.hijackable || o.userData.craft)) return true;
      o = o.parent;
    }
    return false;
  }
  // a collider an aircraft can be destroyed by: a building or a structure,
  // not a lamp post, a sign, a fence post, a kerb (props are not walls)
  function solidForAir(c) {
    if (!c || c.noAircraft || c.y1 == null) return false;
    const h = c.y1 - (c.y0 || 0);
    if (h <= 2.5) return false;
    const wx = c.hw != null ? c.hw * 2 : c.maxX - c.minX, wz = c.hd != null ? c.hd * 2 : c.maxZ - c.minZ;
    if (wx < 1.5 && wz < 1.5) return false;
    return true;
  }
  AS.solidForAir = solidForAir;

  // A record is COVERED when the near build has registered real colliders
  // over its footprint; the colliders then speak for it.
  const _cov = [];
  function covered(r) {
    if (r.built && r.built.gone) return true;                      // demolished: nothing there
    if (r.lot && r.lot.demolished) return true;
    if (!CBZ.queryCollidersNear) return false;
    const cols = CBZ.queryCollidersNear(r.cx, r.cz, Math.min(80, Math.max(r.hw, r.hd)), _cov);
    const need = r.y0 + (r.y1 - r.y0) * 0.5;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!solidForAir(c) || c.y1 < need) continue;
      if (c.maxX < r.cx - r.ex || c.minX > r.cx + r.ex || c.maxZ < r.cz - r.ez || c.minZ > r.cz + r.ez) continue;
      return true;
    }
    return false;
  }

  const _cols = [];
  /* sweep(x0,y0,z0, x1,y1,z1, rad, opts) — the first building the segment
     (a sphere of radius `rad` along it) meets. opts:
       skip      a collider to ignore (the craft's own)
       records   false: colliders only     colliders  false: records only
     Returns { t, x, y, z, nx, ny, nz, rec, collider, lot, building:true } or null. */
  AS.sweep = function (x0, y0, z0, x1, y1, z1, rad, opts) {
    if (!inCity()) return null;
    fresh();
    stats.sweeps++;
    opts = opts || {};
    rad = rad || 0;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const low = Math.min(y0, y1) - rad;
    const ceil = Math.max(maxTop, colTop);
    if (low > ceil) { stats.early++; return null; }
    let best = null, bt = 2;
    // ---- records
    if (opts.records !== false && recs.length) {
      const sid = ++stamp;
      const ix0 = Math.floor((Math.min(x0, x1) - rad) / CELL), ix1 = Math.floor((Math.max(x0, x1) + rad) / CELL);
      const iz0 = Math.floor((Math.min(z0, z1) - rad) / CELL), iz1 = Math.floor((Math.max(z0, z1) + rad) / CELL);
      if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) <= 64) {
        for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
          const c = cells.get(key(ix, iz));
          if (!c || c.top < low) continue;
          for (let i = 0; i < c.list.length; i++) {
            const r = c.list[i];
            if (r._s === sid) continue;
            r._s = sid;
            if (r.top < low) continue;
            // into the record's frame
            const rx = x0 - r.cx, rz = z0 - r.cz;
            const lx = rx * r.co - rz * r.si, lz = rx * r.si + rz * r.co;
            const ldx = dx * r.co - dz * r.si, ldz = dx * r.si + dz * r.co;
            const q = segBox(lx, y0, lz, ldx, dy, ldz, -r.hw - rad, r.hw + rad, r.y0 - rad, r.y1 + rad, -r.hd - rad, r.hd + rad, _q);
            if (!q || q.t >= bt) continue;
            if (covered(r)) { stats.covered++; continue; }
            bt = q.t;
            // normal back to world
            const wnx = q.nx * r.co + q.nz * r.si, wnz = -q.nx * r.si + q.nz * r.co;
            best = { t: q.t, nx: wnx, ny: q.ny, nz: wnz, rec: r, collider: null, lot: r.lot || null };
          }
        }
      }
    }
    // ---- live colliders (the near build: authoritative where it exists)
    if (opts.colliders !== false && low <= colTop && CBZ.queryCollidersNear) {
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const half = Math.hypot(dx, dz) / 2 + rad + 1;
      const cols = CBZ.queryCollidersNear(mx, mz, half, _cols);
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (c === opts.skip || !solidForAir(c)) continue;
        if (c.y1 < low || (c.y0 || 0) > Math.max(y0, y1) + rad) continue;
        if (isAircraftCollider(c)) continue;
        let q, wnx, wnz;
        if (c.yaw && c.hw != null) {
          const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
          const rx = x0 - c.cx, rz = z0 - c.cz;
          q = segBox(rx * co - rz * si, y0, rx * si + rz * co, dx * co - dz * si, dy, dx * si + dz * co,
            -c.hw - rad, c.hw + rad, (c.y0 || 0) - rad, c.y1 + rad, -c.hd - rad, c.hd + rad, _q);
          if (q) { wnx = q.nx * co + q.nz * si; wnz = -q.nx * si + q.nz * co; }
        } else {
          q = segBox(x0, y0, z0, dx, dy, dz, c.minX - rad, c.maxX + rad, (c.y0 || 0) - rad, c.y1 + rad, c.minZ - rad, c.maxZ + rad, _q);
          if (q) { wnx = q.nx; wnz = q.nz; }
        }
        if (!q || q.t >= bt) continue;
        bt = q.t;
        best = { t: q.t, nx: wnx, ny: q.ny, nz: wnz, rec: null, collider: c, lot: null };
      }
    }
    if (!best) return null;
    best.x = x0 + dx * best.t; best.y = y0 + dy * best.t; best.z = z0 + dz * best.t;
    best.building = true;
    if (best.rec) stats.recHits++; else stats.colHits++;
    return best;
  };

  /* sweepAirframe(from, to, dims, opts) — the whole aeroplane: the fuselage
     (a sphere of its own radius) and both wingtips, offset across the
     direction of travel. A wing into a tower IS the crash. `from`/`to` are
     the airframe's reference point (its body centre) at the start and end of
     the step. Returns the earliest hit with `part` set, or null. */
  AS.sweepAirframe = function (from, to, dims, opts) {
    dims = dims || {};
    const dx = to.x - from.x, dz = to.z - from.z;
    const hl = Math.hypot(dx, dz);
    const fus = Math.max(0.6, (dims.fuselage || 2) * 0.5);
    let best = AS.sweep(from.x, from.y, from.z, to.x, to.y, to.z, fus, opts);
    if (best) best.part = "fuselage";
    const half = (dims.span || 0) * 0.5;
    if (half > 1 && hl > 1e-4 && Math.min(from.y, to.y) - 0.6 <= Math.max(maxTop, colTop)) {
      const rx = -dz / hl * half, rz = dx / hl * half;
      for (let k = -1; k <= 1; k += 2) {
        const h = AS.sweep(from.x + rx * k, from.y, from.z + rz * k, to.x + rx * k, to.y, to.z + rz * k, 0.6, opts);
        if (h && (!best || h.t < best.t)) { h.part = k < 0 ? "left-wing" : "right-wing"; best = h; }
      }
    }
    return best;
  };

  AS.records = function () { fresh(); return recs; };
  CBZ.airspaceAudit = function () {
    fresh();
    const src = {};
    for (const r of recs) src[r.src] = (src[r.src] || 0) + 1;
    return { records: recs.length, sources: src, cells: cells.size, maxTop: Math.round(maxTop), colliderTop: Math.round(colTop),
             builds: builds, sweeps: stats.sweeps, early: stats.early, recordHits: stats.recHits, colliderHits: stats.colHits, covered: stats.covered };
  };
})();
