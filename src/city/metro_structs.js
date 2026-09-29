/* ============================================================
   city/metro_structs.js — WHAT A METRO PLAN BUILDS THAT IS NEITHER A
   BUILDING NOR THE GROUND: the elevated downtown loop and monuments.

   city/metroplan.js puts them in the plan as data (P.structs):
     mover      Kingsport's Downtown Loop (style "detroit"): a closed
                guideway polyline over the kerb of the arterials round the
                downtown, 8.2 m deck, columns on the sidewalk, three
                stations standing out over the street, a stair tower each.
     monuments  Karvel's square: a stepped plinth and a tapering pylon.
                Of no one: no figure, no symbol, no text.
   This file draws them. It is not a parallel city system: the plan is the
   metro's, the colliders go where the metro's go, the meshes hang from the
   metro's group, and the material rides the same haze as the metro's
   ground (terrainFogScale 0.10 + the aerial haze) so it recedes with the
   city round it. It is small (a 3.9 km guideway is ~10k triangles), so it
   is ONE merged mesh per city, built at load (landmass 44, right after the
   metro registers at 43) and kept: the same object at every distance, no
   stand-in. Colliders only where something can be walked or driven into:
   the columns, the stair towers, the monument's plinth. One two-car train
   runs the loop (a single small mesh moved each frame while the camera is
   within 3 km).

   Exposes CBZ.metroStructsAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;

  // sRGB-authored colours -> linear (a Lambert vertex colour is linear)
  function lin(hex) {
    const f = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
  }
  const C = {
    concrete: lin(0xb3aea4), concreteDark: lin(0x8e8a82), soffit: lin(0x77736c), glass: lin(0x2e3a44),
    trim: lin(0x5b5f63), plinth: lin(0x8f8b84), pylon: lin(0xa9a59c), car: lin(0xd4d4cf), carBand: lin(0x23282d), carStripe: lin(0x6f7478),
  };

  // ---------------------------------------------------------------------
  //  THE WRITER: flat-shaded quads into growable arrays
  // ---------------------------------------------------------------------
  function Writer() { this.p = []; this.n = []; this.c = []; this.i = []; this.v = 0; }
  Writer.prototype.quad = function (a, b, c, d, col) {
    // a b c d counter-clockwise seen from outside; the normal from the winding
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const q of [a, b, c, d]) { this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
    const o = this.v; this.i.push(o, o + 1, o + 2, o, o + 2, o + 3); this.v += 4;
  };
  // an oriented box: centre (x, z), half extents along (hw) and across (hd)
  // its yaw (along = (sin yaw, cos yaw)), from y0 to y1
  Writer.prototype.box = function (x, z, hw, hd, yaw, y0, y1, col, colTop, noBottom) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const P = function (a, b, y) { return [x + a * s + b * c, y, z + a * c - b * s]; };
    const A = [P(-hw, -hd, 0), P(hw, -hd, 0), P(hw, hd, 0), P(-hw, hd, 0)];
    const at = function (k, y) { return [A[k][0], y, A[k][2]]; };
    for (let k = 0; k < 4; k++) {
      const j = (k + 1) % 4;
      this.quad(at(j, y0), at(k, y0), at(k, y1), at(j, y1), col);
    }
    this.quad(at(0, y1), at(1, y1), at(2, y1), at(3, y1), colTop || col);
    if (!noBottom) this.quad(at(3, y0), at(2, y0), at(1, y0), at(0, y0), col);
  };
  Writer.prototype.geometry = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.v > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }

  let _mat = null;
  function material() {
    if (_mat) return _mat;
    _mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    // the WINDING above is not guaranteed on every box face orientation
    // (yawed boxes flip handedness), so both sides draw
    _mat.side = THREE.DoubleSide;
    if (CBZ.terrainFogScale) CBZ.terrainFogScale(_mat, 0.10);
    return _mat;
  }

  // ---------------------------------------------------------------------
  //  THE GUIDEWAY: a ribbon along the closed polyline (mitred at every
  //  vertex, so the corners are continuous), a box girder with low walls
  // ---------------------------------------------------------------------
  function offsets(pts, closed) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const pv = pts[(i - 1 + n) % n], p = pts[i], nx_ = pts[(i + 1) % n];
      const a = closed || i > 0 ? pv : p, b = closed || i < n - 1 ? nx_ : p;
      let t1x = p.x - a.x, t1z = p.z - a.z, t2x = b.x - p.x, t2z = b.z - p.z;
      const l1 = Math.hypot(t1x, t1z) || 1, l2 = Math.hypot(t2x, t2z) || 1;
      t1x /= l1; t1z /= l1; t2x /= l2; t2z /= l2;
      let tx = t1x + t2x, tz = t1z + t2z; const lt = Math.hypot(tx, tz) || 1; tx /= lt; tz /= lt;
      // left normal of the mean tangent, scaled for the mitre
      const nx = -tz, nz = tx, cosH = Math.max(0.5, nx * -t1z + nz * t1x);
      out.push({ x: p.x, z: p.z, nx: nx / cosH, nz: nz / cosH, tx: tx, tz: tz });
    }
    return out;
  }
  function ribbon(W, O, closed, u0, u1, y0, y1, col, colTop, colBottom) {
    // the band between lateral offsets u0 < u1, from y0 to y1: top, bottom, both sides
    const n = O.length, segs = closed ? n : n - 1;
    const at = function (o, u, y) { return [o.x + o.nx * u, y, o.z + o.nz * u]; };
    for (let i = 0; i < segs; i++) {
      const a = O[i], b = O[(i + 1) % n];
      W.quad(at(a, u0, y1), at(a, u1, y1), at(b, u1, y1), at(b, u0, y1), colTop || col);          // top
      W.quad(at(b, u0, y0), at(b, u1, y0), at(a, u1, y0), at(a, u0, y0), colBottom || col);       // soffit
      W.quad(at(a, u1, y0), at(b, u1, y0), at(b, u1, y1), at(a, u1, y1), col);                    // left face
      W.quad(at(b, u0, y0), at(a, u0, y0), at(a, u0, y1), at(b, u0, y1), col);                    // right face
    }
  }
  function nearestYaw(pts, x, z) {
    let best = 1e9, yaw = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz; if (L2 < 1e-6) continue;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      if (d < best) { best = d; yaw = Math.atan2(dx, dz); }
    }
    return yaw;
  }

  function buildMover(W, M, mv, cols, ground) {
    const D = mv.deckY, H = mv.depth, hw = mv.width / 2;
    const O = offsets(mv.pts, true);
    // the girder (deck D-H .. D), its two parapet walls (1.05 m), a running
    // beam down the middle the cars straddle
    ribbon(W, O, true, -hw, hw, D - H, D, C.concrete, C.concreteDark, C.soffit);
    ribbon(W, O, true, -hw, -hw + 0.22, D, D + 1.05, C.concrete);
    ribbon(W, O, true, hw - 0.22, hw, D, D + 1.05, C.concrete);
    ribbon(W, O, true, -0.45, 0.45, D, D + 0.32, C.trim);
    // columns + caps (the cap reaches from the column to the girder's far side)
    for (const c of mv.cols) {
      const g = ground(c.x, c.z), yaw = nearestYaw(mv.pts, c.x, c.z);
      W.box(c.x, c.z, 0.55, 0.55, yaw, g - 0.2, D - H, C.concreteDark, null, true);
      W.box(c.x, c.z, 0.8, 1.9, yaw, D - H - 0.9, D - H, C.concreteDark);
      cols.push(oriented(c.x, c.z, 0.6, 0.6, yaw, g - 0.2, D - H));
    }
    // stations: a glazed box round the track, the floor slab level with the
    // deck, the roof 3.6 m over it, posts at the corners and every 8 m
    for (const st of mv.stations) {
      const yaw = st.yaw, L = st.len / 2, Wd = st.wid / 2;
      W.box(st.x, st.z, L, Wd, yaw, D - H, D - 0.05, C.concreteDark, C.concrete);
      W.box(st.x, st.z, L + 0.3, Wd + 0.3, yaw, D + 3.6, D + 4.1, C.concrete, C.concreteDark);
      const s = Math.sin(yaw), c = Math.cos(yaw);
      for (let a = -L; a <= L + 0.01; a += st.len / 4) for (const b of [-Wd + 0.15, Wd - 0.15]) {
        W.box(st.x + a * s + b * c, st.z + a * c - b * s, 0.15, 0.15, yaw, D, D + 3.6, C.trim, null, true);
      }
      // the glass: two long walls (the ends stay open to the track)
      for (const b of [-Wd + 0.1, Wd - 0.1]) W.box(st.x + b * c, st.z - b * s, L - 0.2, 0.04, yaw, D + 0.9, D + 3.5, C.glass, null, true);
      if (st.stair) {
        const t = st.stair, g = ground(t.x, t.z);
        W.box(t.x, t.z, t.d / 2, t.w / 2, yaw, g - 0.2, D + 3.0, C.concrete, C.concreteDark, true);
        W.box(t.x, t.z, t.d / 2 + 0.02, t.w / 2 + 0.02, yaw, g + 2.4, D + 2.2, C.glass, null, true);
        cols.push(oriented(t.x, t.z, t.d / 2, t.w / 2, yaw, g - 0.2, D + 3.0));
      }
    }
  }

  // ---------------------------------------------------------------------
  //  THE MONUMENT: three stepped tiers and a tapering square pylon
  // ---------------------------------------------------------------------
  function buildMonument(W, m, cols, ground) {
    const g = ground(m.x, m.z);
    const b = m.base || 38, h = m.h || 82;
    const tiers = [[b / 2, 1.2], [b / 2 - 5, 1.2], [b / 2 - 10, 1.4]];
    let y = g;
    for (const t of tiers) { W.box(m.x, m.z, t[0], t[0], 0, y - 0.3, y + t[1], C.plinth, C.plinth, true); y += t[1]; }
    cols.push({ minX: m.x - b / 2, maxX: m.x + b / 2, minZ: m.z - b / 2, maxZ: m.z + b / 2, y0: g - 0.3, y1: g + 1.2 });
    cols.push({ minX: m.x - b / 2 + 5, maxX: m.x + b / 2 - 5, minZ: m.z - b / 2 + 5, maxZ: m.z + b / 2 - 5, y0: g - 0.3, y1: g + 2.4 });
    cols.push({ minX: m.x - b / 2 + 10, maxX: m.x + b / 2 - 10, minZ: m.z - b / 2 + 10, maxZ: m.z + b / 2 - 10, y0: g - 0.3, y1: y });
    // the pylon: a square frustum in 6 drums (each its own taper), a cap
    const r0 = 3.6, r1 = 1.2, n = 6;
    for (let k = 0; k < n; k++) {
      const ya = y + h * k / n, yb = y + h * (k + 1) / n;
      const ra = r0 + (r1 - r0) * k / n, rb = r0 + (r1 - r0) * (k + 1) / n;
      const P = function (sx, sz, r, yy) { return [m.x + sx * r, yy, m.z + sz * r]; };
      const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let q = 0; q < 4; q++) {
        const a = cs[q], bb = cs[(q + 1) % 4];
        W.quad(P(a[0], a[1], ra, ya), P(bb[0], bb[1], ra, ya), P(bb[0], bb[1], rb, yb), P(a[0], a[1], rb, yb), C.pylon);
      }
    }
    W.box(m.x, m.z, r1 + 0.25, r1 + 0.25, 0, y + h, y + h + 0.6, C.plinth);
    cols.push({ minX: m.x - r0, maxX: m.x + r0, minZ: m.z - r0, maxZ: m.z + r0, y0: y, y1: y + h });
  }

  function oriented(cx, cz, hw, hd, yaw, y0, y1) {
    // (hw along the yaw, hd across) -> the collider world's oriented record
    if (CBZ.orientedCollider) return CBZ.orientedCollider(cx, cz, hd, hw, yaw, y0, y1);
    const ac = Math.abs(Math.cos(yaw)), as = Math.abs(Math.sin(yaw));
    const ex = hw * as + hd * ac, ez = hw * ac + hd * as;
    return { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, y0: y0, y1: y1 };
  }

  // ---------------------------------------------------------------------
  //  THE TRAIN: two cars that run the loop, stopping at every station
  // ---------------------------------------------------------------------
  function trainMesh() {
    const W = new Writer();
    for (const x0 of [-11.6, 0.4]) {
      const cx = x0 + 5.6;
      // body, window band, a darker skirt; the "along" axis is local +z
      W.box(0, cx, 5.5, 1.3, 0, 0.35, 3.25, C.car, C.car);
      W.box(0, cx, 5.2, 1.32, 0, 1.55, 2.55, C.carBand, null, true);
      W.box(0, cx, 5.45, 1.25, 0, 0.1, 0.5, C.carStripe, null, true);
    }
    const m = new THREE.Mesh(W.geometry(), material());
    m.castShadow = true; m.receiveShadow = true; m.name = "metro-mover-train";
    return m;
  }
  function loopTrack(pts) {
    const segs = []; let L = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b.x - a.x, b.z - a.z);
      if (l < 1e-6) continue;
      segs.push({ a: a, b: b, l: l, s: L }); L += l;
    }
    return { segs: segs, L: L };
  }
  function trackAt(T, s) {
    s = ((s % T.L) + T.L) % T.L;
    let lo = 0, hi = T.segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T.segs[m].s <= s) lo = m; else hi = m - 1; }
    const g = T.segs[lo], t = (s - g.s) / g.l;
    return { x: g.a.x + (g.b.x - g.a.x) * t, z: g.a.z + (g.b.z - g.a.z) * t, yaw: Math.atan2(g.b.x - g.a.x, g.b.z - g.a.z) };
  }
  function trackS(T, x, z) {
    let best = 1e9, bs = 0;
    for (const g of T.segs) {
      const dx = g.b.x - g.a.x, dz = g.b.z - g.a.z;
      let t = ((x - g.a.x) * dx + (z - g.a.z) * dz) / (g.l * g.l); t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - g.a.x - dx * t, z - g.a.z - dz * t);
      if (d < best) { best = d; bs = g.s + g.l * t; }
    }
    return bs;
  }

  // ---------------------------------------------------------------------
  //  BUILD — every metro city with structs
  // ---------------------------------------------------------------------
  const _audit = { cities: [], trains: 0 };
  const trains = [];
  function build(city) {
    _audit.cities.length = 0; trains.length = 0;
    for (const M of CBZ.metroCities || []) {
      const S = M.plan && M.plan.structs;
      if (!S || !M.group) continue;
      const T0 = performance.now();
      const ground = function (x, z) {
        const y = M.solve && M.solve.heightAt ? M.solve.heightAt(x, z) : null;
        return y == null ? 0.16 : y;
      };
      const W = new Writer(), cols = [];
      if (S.mover) buildMover(W, M.plan, S.mover, cols, ground);
      for (const m of S.monuments || []) buildMonument(W, m, cols, ground);
      if (!W.v) continue;
      const mesh = new THREE.Mesh(W.geometry(), material());
      mesh.name = "metro-" + M.id + "-structs";
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.userData = { metro: M.id, structs: true };
      M.group.add(mesh);
      for (const c of cols) { c.ref = mesh; CBZ.colliders.push(c); }
      if (cols.length && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (S.mover) {
        const tm = trainMesh(), T = loopTrack(S.mover.pts);
        tm.userData = { metro: M.id };
        M.group.add(tm);
        const stops = S.mover.stations.map(function (st) { return trackS(T, st.x, st.z); }).sort(function (a, b) { return a - b; });
        trains.push({ mesh: tm, T: T, y: S.mover.deckY, stops: stops, s: stops[0] || 0, wait: 12, M: M });
      }
      M.structs = { mesh: mesh, colliders: cols.length, triangles: W.i.length / 3 };
      _audit.cities.push({ id: M.id, triangles: W.i.length / 3, colliders: cols.length, ms: +(performance.now() - T0).toFixed(1),
        mover: S.mover ? { length: S.mover.length, columns: S.mover.cols.length, stations: S.mover.stations.length } : null,
        monuments: (S.monuments || []).length });
    }
    _audit.trains = trains.length;
  }

  // the train: 11 m/s between stations, 16 s at each, eased in and out
  const V = 11, DWELL = 16, EASE = 40;
  const _cam = new THREE.Vector3();
  function tick(dt) {
    if (!trains.length) return;
    const cam = CBZ.camera || (CBZ.game && CBZ.game.camera);
    if (cam && cam.getWorldPosition) cam.getWorldPosition(_cam);
    dt = Math.min(0.1, dt || 0);
    for (const tr of trains) {
      if (!tr.mesh.parent || (tr.M.group && !tr.M.group.visible)) continue;
      const p0 = trackAt(tr.T, tr.s);
      if (cam && Math.hypot(_cam.x - p0.x, _cam.z - p0.z) > 3000) continue;
      if (tr.wait > 0) tr.wait -= dt;
      else {
        // distance to the next stop ahead
        let next = null;
        for (const s of tr.stops) { const d = ((s - tr.s) % tr.T.L + tr.T.L) % tr.T.L; if (d > 0.5 && (next == null || d < next)) next = d; }
        if (next == null) next = tr.T.L;
        const v = Math.max(1.2, V * Math.min(1, next / EASE));
        const step = Math.min(next, v * dt);
        tr.s = (tr.s + step) % tr.T.L;
        if (next - step < 0.05) tr.wait = DWELL;
      }
      const p = trackAt(tr.T, tr.s);
      tr.mesh.position.set(p.x, tr.y, p.z);
      tr.mesh.rotation.set(0, p.yaw, 0);
    }
  }

  CBZ.metroStructs = { build: build };
  CBZ.metroStructsAudit = function () {
    return { cities: _audit.cities.slice(), trains: trains.map(function (t) { return { city: t.M.id, s: Math.round(t.s), loop: Math.round(t.T.L), waiting: t.wait > 0 }; }) };
  };
  if (CBZ.onAlways) CBZ.onAlways(62.4, tick);
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    try { build(city); } catch (e) { console.error("[metro structs]", e); }
  }, 44);
})();
