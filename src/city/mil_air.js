/* ============================================================
   city/mil_air.js — THE AIRFRAME KIT, AND THE THREE CALLS THE CITY MAKES
   ON A MILITARY AIRFRAME.

   The airframes themselves are NPC War's units now (src/units/vehicles/
   f35.js, ah64_apache.js, uh60_black_hawk.js, mq9_reaper.js, b52.js,
   a400m.js): one model per machine, the same in the battle, at Fort Brandt
   and in the city's air response. The five generic templates this file
   used to build (a "fighter", an "attackHeli", a "utilityHeli", a "drone",
   a "bomber") were deleted with the island's own cargo lifter when Fort
   Brandt started parking the units; nothing builds a second copy.

   What stays is what has no unit equivalent:

   THE KIT (pure geometry, r128 BufferGeometry, no rng — deterministic). The
   unit files that loft their airframes build on it (manifest `needs`), and
   city/strategic.js folds the B-2's static parts with mergeStatic.
     loft(stations, o)    closed or open-arc superellipse sections along Z,
                          smooth-shaded; o.split(z, theta) re-emits chosen
                          quads (windows) as a second geometry that shares
                          the same arithmetic, so a windscreen IS the hull.
     wing(stations, o)    NACA-00xx aerofoil sections along +X (planform:
                          x, le, c, tc, y), hard trailing edge, capped.
     annulus(a, b)        the ring between two sections (an open intake lip).
     merge / mergeStatic  fold geometry / a group's static meshes into one
                          mesh per material.
     missile / pod / pylon  stores and their hangers.

   THE RUNTIME (read by aircraft.js / playeraircraft.js / battle):
     CBZ.milAirDrive(group, s, dt)  the airframe moves with its flight: a
                                    unit-built airframe animates itself
                                    (group.userData.unitDrive, set by
                                    city/island_military.js unitBuild):
                                    rotors, props, gear, surfaces, lights.
                                    s = { thr 0..1, agl, speed, vy, air }.
     CBZ.milAirAim(group, x,y,z)    slews a chin turret at a world point.
     CBZ.milAirPoint(group, key, i, out)  where a round leaves ("gun" the
                                    chin gun's muzzle, "rail" the next
                                    launch rail): the unit's rig answers.
     CBZ.milAirFire(group, key)     that round left: the rig spends it (the
                                    Hellfire comes off its rail).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const TAU = Math.PI * 2;

  // =====================================================================
  //  1. GEOMETRY
  // =====================================================================
  function mkGeo(pos, idx, uv) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  function triN(pos, a, b, c) {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  }
  function flip(idx, from, to) {
    for (let i = from; i < to; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  // Newell polygon normal of a ring of vertex indices
  function newell(pos, ring) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] * 3, b = ring[(i + 1) % ring.length] * 3;
      nx += (pos[a + 1] - pos[b + 1]) * (pos[a + 2] + pos[b + 2]);
      ny += (pos[a + 2] - pos[b + 2]) * (pos[a] + pos[b]);
      nz += (pos[a] - pos[b]) * (pos[a + 1] + pos[b + 1]);
    }
    return [nx, ny, nz];
  }
  // flat fan cap over a ring of existing vertices, facing `want`
  function capFan(pos, idx, uv, ring, want) {
    const n = ring.length; if (n < 3) return;
    const base = pos.length / 3;
    let sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < n; j++) {
      const q = ring[j] * 3;
      pos.push(pos[q], pos[q + 1], pos[q + 2]); uv.push(0, 0);
      sx += pos[q]; sy += pos[q + 1]; sz += pos[q + 2];
    }
    const c = pos.length / 3; pos.push(sx / n, sy / n, sz / n); uv.push(0, 0);
    const own = []; for (let j = 0; j < n; j++) own.push(base + j);
    const nn = newell(pos, own);
    const same = nn[0] * want[0] + nn[1] * want[1] + nn[2] * want[2] >= 0;
    for (let j = 0; j < n; j++) {
      const u = base + j, v = base + (j + 1) % n;
      if (same) idx.push(c, u, v); else idx.push(c, v, u);
    }
  }

  // ---- one superellipse section ------------------------------------------
  // s = {z, x, y, w, t, b, p, pb, open}. `open` (radians) leaves a gap of
  // ±open about straight down: the arc runs CCW (seen from +Z) from just
  // right of the keel, over the top, to just left of it (n+1 points).
  function ring(s, n, out) {
    const p = s.p || 2, pb = s.pb || p, cx = s.x || 0, cy = s.y || 0;
    const open = s.open != null;
    const a0 = open ? -Math.PI / 2 + s.open : 0, a1 = open ? 1.5 * Math.PI - s.open : TAU;
    const cnt = open ? n + 1 : n;
    for (let j = 0; j < cnt; j++) {
      const th = a0 + (a1 - a0) * j / n;
      const c = Math.cos(th), sn = Math.sin(th), e = sn >= 0 ? p : pb;
      const x = cx + s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
      const y = cy + (sn >= 0 ? s.t : s.b) * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e);
      out.push(x, y, s.z, th);
    }
    return cnt;
  }
  function rnd(z, r, y, x, extra) {
    const s = { z: z, x: x || 0, y: y || 0, w: r, t: r, b: r };
    if (extra) for (const k in extra) s[k] = extra[k];
    return s;
  }

  // ---- LOFT ---------------------------------------------------------------
  // o.n ring samples · o.caps (default true, closed bodies) · o.split(z,th)
  // → returns [geo, splitGeo] · o.flipped (inside-facing: a liner)
  function loft(stations, o) {
    o = o || {};
    const st = stations.slice().sort(function (a, b) { return b.z - a.z; });
    const n = o.n || 16, open = st[0].open != null;
    const pos = [], uv = [], idx = [], idx2 = [], th = [];
    let m = 0;
    for (let i = 0; i < st.length; i++) {
      const tmp = [];
      m = ring(st[i], n, tmp);
      for (let j = 0; j < m; j++) {
        pos.push(tmp[j * 4], tmp[j * 4 + 1], tmp[j * 4 + 2]); th.push(tmp[j * 4 + 3]);
        uv.push(j / n, i / Math.max(1, st.length - 1));
      }
    }
    const segs = open ? n : n;
    for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < segs; j++) {
      const a = i * m + j, b = i * m + (open ? j + 1 : (j + 1) % n);
      const tgt = (o.split && o.split((st[i].z + st[i + 1].z) / 2, (th[a] + (open ? th[b] : th[a] + TAU / n)) / 2, st[i], st[i + 1])) ? idx2 : idx;
      tgt.push(a, a + m, b, b, a + m, b + m);
    }
    const bodyEnd = idx.length;
    if (!open && o.caps !== false) {
      for (let e = 0; e < 2; e++) {
        const i = e ? st.length - 1 : 0, s = st[i];
        if (e === 0 && o.capFront === false) continue;
        if (e === 1 && o.capBack === false) continue;
        if (s.w < 1e-3 || (s.t + s.b) < 1e-3) continue;
        const r = []; for (let j = 0; j < n; j++) r.push(i * m + j);
        capFan(pos, idx, uv, r, [0, 0, e ? -1 : 1]);
      }
    }
    if (o.flipped) { flip(idx, 0, idx.length); flip(idx2, 0, idx2.length); }
    const g = mkGeo(pos, idx, uv);
    if (!o.split) return g;
    if (!idx2.length) return [g, null];
    // the cut-out (glass) keeps only the vertices it uses
    const map = new Map(), p2 = [], u2 = [], i2 = [];
    for (let i = 0; i < idx2.length; i++) {
      const v = idx2[i];
      let w = map.get(v);
      if (w == null) { w = p2.length / 3; map.set(v, w); p2.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); u2.push(uv[v * 2], uv[v * 2 + 1]); }
      i2.push(w);
    }
    return [g, mkGeo(p2, i2, u2)];
  }

  // ---- ANNULUS: the face between an outer and an inner section -------------
  function annulus(so, si, n, want) {
    const a = [], b = [];
    ring(so, n, a); ring(si, n, b);
    const pos = [], uv = [], idx = [];
    for (let j = 0; j < n; j++) { pos.push(a[j * 4], a[j * 4 + 1], a[j * 4 + 2]); uv.push(0, 0); }
    for (let j = 0; j < n; j++) { pos.push(b[j * 4], b[j * 4 + 1], b[j * 4 + 2]); uv.push(0, 0); }
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      idx.push(j, n + j, j1, j1, n + j, n + j1);
    }
    const nn = triN(pos, idx[0], idx[1], idx[2]);
    const w = want || [0, 0, 1];
    if (nn[0] * w[0] + nn[1] * w[1] + nn[2] * w[2] < 0) flip(idx, 0, idx.length);
    return mkGeo(pos, idx, uv);
  }

  // ---- WING ---------------------------------------------------------------
  // stations root→tip along +X: {x, le, c, tc, y, cam}. Chord runs from the
  // leading edge (z = le) toward -Z. NACA 00xx thickness, closed TE.
  function naca(x) { return 5 * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x); }
  function wing(st, o) {
    o = o || {};
    const K = o.K || 6, xs = [];
    for (let k = 0; k <= K; k++) xs.push(0.5 * (1 - Math.cos(Math.PI * k / K)));
    const m = 2 * K + 1;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i < st.length; i++) {
      const s = st[i], c = s.c, tc = s.tc != null ? s.tc : 0.08, y0 = s.y || 0, cam = s.cam || 0;
      for (let q = 0; q < m; q++) {
        const top = q <= K, k = top ? K - q : q - K, xc = xs[k];
        const ht = Math.max(0, naca(xc)) * tc * c;   // naca() peaks at 0.5 → full thickness = tc*c
        const y = y0 + cam * c * 4 * xc * (1 - xc) + (top ? ht : -ht);
        pos.push(s.x, y, s.le - xc * c);
        uv.push(xc, i / Math.max(1, st.length - 1));
      }
    }
    for (let i = 0; i < st.length - 1; i++) for (let q = 0; q < m - 1; q++) {
      const a = i * m + q, b = a + 1;
      idx.push(a, a + m, b, b, a + m, b + m);
    }
    // orientation: a top-surface triangle must face +Y
    const tq = Math.max(1, (K >> 1));
    const nn = triN(pos, tq, tq + m, tq + 1);
    if (nn[1] < 0) flip(idx, 0, idx.length);
    const r0 = [], r1 = [], L = (st.length - 1) * m;
    for (let q = 0; q < m - 1; q++) { r0.push(q); r1.push(L + q); }
    if (o.root !== false) capFan(pos, idx, uv, r0, [-1, 0, 0]);
    capFan(pos, idx, uv, r1, [1, 0, 0]);
    return mkGeo(pos, idx, uv);
  }
  // linear planform helper: knots [{x, le, te, tc, y}] → station at x
  function planAt(knots, x, cut) {
    let a = knots[0], b = knots[knots.length - 1];
    for (let i = 0; i < knots.length - 1; i++) if (x >= knots[i].x && x <= knots[i + 1].x) { a = knots[i]; b = knots[i + 1]; break; }
    const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
    const le = a.le + (b.le - a.le) * t, te = a.te + (b.te - a.te) * t;
    const tc = (a.tc || 0.08) + ((b.tc || 0.08) - (a.tc || 0.08)) * t;
    const y = (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t;
    return { x: x, le: le, c: (le - te) - (cut || 0), tc: tc, y: y, te: te };
  }

  // ---- primitives ---------------------------------------------------------
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
  // transform in place; a mirror (negative determinant) reverses winding
  function xf(g, x, y, z, rx, ry, rz, sx, sy, sz) {
    _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0));
    _m4.compose(_v.set(x || 0, y || 0, z || 0), _q, _s.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
    return xm(g, _m4);
  }
  function xm(g, M) {
    g.applyMatrix4(M);
    if (M.determinant() < 0 && g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; }
    return g;
  }
  function mir(g) { return xm(g.clone(), new THREE.Matrix4().makeScale(-1, 1, 1)); }
  function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
  function cylZ(r0, r1, len, seg) { return xf(new THREE.CylinderGeometry(r1, r0, len, seg || 12), 0, 0, 0, Math.PI / 2); }  // r0 at +Z
  function cylX(r, w, seg) { return xf(new THREE.CylinderGeometry(r, r, w, seg || 14), 0, 0, 0, 0, 0, Math.PI / 2); }
  function sph(r, ws, hs) { return new THREE.SphereGeometry(r, ws || 12, hs || 8); }
  // a round rod between two points
  function rod(a, b, r, seg) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
    const g = new THREE.CylinderGeometry(r, r, L, seg || 8);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    _m4.compose(_v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
    return xm(g, _m4);
  }
  function wheel(r, w) {
    return { tire: cylX(r, w, 16), hub: cylX(r * 0.55, w + 0.02, 12) };
  }

  // =====================================================================
  //  2. MERGE
  // =====================================================================
  function merge(geos) {
    let nv = 0, ni = 0;
    for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const g of geos) {
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      P.set(p.array, vo * 3);
      if (n) N.set(n.array, vo * 3);
      if (u && u.itemSize === 2) U.set(u.array, vo * 2);
      if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) I[io + i] = a[i] + vo; io += a.length; }
      else { for (let i = 0; i < p.count; i++) I[io + i] = vo + i; io += p.count; }
      vo += p.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    out.setIndex(new THREE.BufferAttribute(I, 1));
    out.computeBoundingSphere(); out.computeBoundingBox();
    out._shared = true;                    // template geometry: every clone shares it
    return out;
  }

  // Fold a hand-built group's static DIRECT mesh children into one mesh per
  // material (the B-2's loft is already one surface; its deck, fittings and
  // gear were 50 separate draws). `keep(mesh)` → true leaves a part alone.
  function mergeStatic(group, keep) {
    const buckets = new Map();
    group.updateMatrix();
    for (let i = 0; i < group.children.length; i++) {
      const o = group.children[i];
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || Array.isArray(o.material)) continue;
      if (keep && keep(o)) continue;
      let b = buckets.get(o.material); if (!b) buckets.set(o.material, b = []);
      b.push(o);
    }
    let removed = 0;
    buckets.forEach(function (list, mat) {
      if (list.length < 2) return;
      const geos = list.map(function (o) {
        o.updateMatrix();
        let g = o.geometry.clone();
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        return xm(g, o.matrix);
      });
      const m = new THREE.Mesh(merge(geos), mat);
      m.geometry._shared = false;
      m.castShadow = true; m.receiveShadow = true;
      for (let i = 0; i < list.length; i++) { group.remove(list[i]); if (list[i].geometry && !list[i].geometry._shared) list[i].geometry.dispose(); removed++; }
      group.add(m);
    });
    return removed;
  }

  // STORES — a missile / bomb / rocket pod along +Z, centred on the origin
  function missile(len, r) {
    const out = [loft([
      rnd(len / 2, 0.001), rnd(len / 2 - r * 1.2, r * 0.75), rnd(len / 2 - r * 3, r),
      rnd(-len / 2 + r * 0.6, r), rnd(-len / 2, r * 0.8),
    ], { n: 10 })];
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      out.push(xf(wing([{ x: r * 0.8, le: -len / 2 + r * 4.2, c: r * 3.8, tc: 0.06 }, { x: r * 3.2, le: -len / 2 + r * 2.4, c: r * 1.8, tc: 0.06 }], { K: 3 }), 0, 0, 0, 0, 0, a));
      out.push(xf(wing([{ x: r * 0.8, le: len * 0.12, c: r * 2.4, tc: 0.06 }, { x: r * 2.2, le: len * 0.12 - r * 0.9, c: r * 1.3, tc: 0.06 }], { K: 3 }), 0, 0, 0, 0, 0, a));
    }
    return out;
  }
  function pod(len, r) {   // body, with the tube face returned separately (dark)
    return {
      body: loft([rnd(len / 2, r * 0.92), rnd(len / 2 - 0.12, r), rnd(-len / 2 + 0.25, r), rnd(-len / 2, r * 0.45)], { n: 14, capFront: false }),
      face: xf(new THREE.CircleGeometry(r * 0.92, 14), 0, 0, len / 2 - 0.02),
    };
  }
  // a pylon hanging below a wing: a thin aerofoil stood on end
  function pylon(x, yTop, yBot, zLe, c) {
    return xf(wing([{ x: 0, le: zLe, c: c, tc: 0.07 }, { x: yTop - yBot, le: zLe - c * 0.05, c: c * 0.95, tc: 0.07 }], { K: 3 }),
      x, yBot, 0, 0, 0, Math.PI / 2);
  }

  // per-instance: fresh afterburner plume + a glowing nozzle throat
  // =====================================================================
  //  3. RUNTIME
  // =====================================================================
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  /* THE AIRFRAME MOVES WITH ITS FLIGHT. A unit-built airframe owns its own
     look (the unit file's animate: rotors at their real rpm, props, gear,
     surfaces, lights); island_military.js's unitBuild hangs that on
     group.userData.unitDrive, and whoever flies it (playeraircraft.js, the
     air response in aircraft.js) calls this with what the flight is doing. */
  CBZ.milAirDrive = function (g, s, dt) {
    const ud = g && g.userData;
    if (!ud || typeof ud.unitDrive !== "function") return false;
    try { ud.unitDrive(s || {}, dt > 0 ? Math.min(dt, 0.25) : 1 / 60); } catch (e) { return false; }
    return true;
  };
  const _aim = new THREE.Vector3(), _inv = new THREE.Matrix4();
  // the two aim nodes the airframe names (userData.chinGun = { yaw, pitch }):
  // the unit's rig follows them at its own slew rates
  CBZ.milAirAim = function (g, x, y, z, dt) {
    const cg = g && g.userData && g.userData.chinGun;
    if (!cg) return false;
    const rt = g._milAim || (g._milAim = { yaw: null, pitch: null });
    if (!rt.yaw) { rt.yaw = g.getObjectByName(cg.yaw); rt.pitch = g.getObjectByName(cg.pitch); }
    if (!rt.yaw || !rt.pitch) return false;
    g.updateMatrixWorld(true);
    _aim.set(x, y, z).applyMatrix4(_inv.copy(rt.yaw.parent.matrixWorld).invert()).sub(rt.yaw.position);
    const want = clamp(Math.atan2(_aim.x, _aim.z), -1.9, 1.9);
    const el = clamp(Math.atan2(-_aim.y, Math.hypot(_aim.x, _aim.z)), -0.2, 1.05);
    const k = dt > 0 ? Math.min(1, dt * 5) : 1;
    rt.yaw.rotation.y += (want - rt.yaw.rotation.y) * k;
    rt.pitch.rotation.x += (el - rt.pitch.rotation.x) * k;
    return true;
  };
  /* THE ROUND IN HAND for a key, on the unit's own weapons list: "gun" is the
     first cannon / autocannon / machine gun, "rail" the first missile or
     rocket. The rig hooks (muzzleWorld, fire) take the battle's shot shape. */
  function unitShot(g, key, i) {
    const ud = g.userData, K = CBZ.unitKit;
    const def = ud.unitId && K && K.get ? K.get(ud.unitId) : null;
    const W = (def && def.weapons) || [];
    for (let k = 0; k < W.length; k++) {
      const w = W[k], kd = w.kind;
      const gun = kd === "cannon" || kd === "autocannon" || kd === "mg";
      if (key === "gun" ? !gun : !(kd === "missile" || kd === "rockets")) continue;
      const s = ud._milShot || (ud._milShot = { wid: null, wi: 0, n: 0, w: null, kind: null, mount: null, target: null });
      s.wid = w.id; s.wi = k; s.n = i | 0; s.w = w; s.kind = kd; s.mount = w.mount || null;
      return s;
    }
    return null;
  }
  CBZ.milAirPoint = function (g, key, i, out) {
    const ud = g && g.userData; if (!ud) return null;
    out = out || new THREE.Vector3();
    const rig = ud.rig, shot = rig && rig.muzzleWorld ? unitShot(g, key, i) : null;
    if (shot) {
      try { g.updateMatrixWorld(true); const p = rig.muzzleWorld(out, shot); if (p && isFinite(p.x)) return p; } catch (e) {}
    }
    if (key === "gun" && ud.chinGun && ud.chinGun.muzzle) {
      const m = g.getObjectByName(ud.chinGun.muzzle);
      if (m) { g.updateMatrixWorld(true); return out.setFromMatrixPosition(m.matrixWorld); }
    }
    return null;
  };
  // that round left: the rig spends it (a Hellfire comes off its rail)
  CBZ.milAirFire = function (g, key, i) {
    const ud = g && g.userData, rig = ud && ud.rig;
    if (!rig || typeof rig.fire !== "function") return false;
    const shot = unitShot(g, key, i);
    if (!shot) return false;
    try { rig.fire(shot, g.position); } catch (e) { return false; }
    return true;
  };

  CBZ.milAir = {
    kit: { loft: loft, wing: wing, annulus: annulus, planAt: planAt, xf: xf, xm: xm, mir: mir, box: box, cylX: cylX, cylZ: cylZ,
      sph: sph, rod: rod, wheel: wheel, rnd: rnd, merge: merge, mergeStatic: mergeStatic, missile: missile, pod: pod, pylon: pylon },
  };
})();
