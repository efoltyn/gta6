/* ============================================================
   city/mil_air.js — MILITARY AIRFRAMES AS SURFACES, NOT BOX PILES.

   OWNER: "It's all poorly drawn right now, but close. Just redraw it all,
   like you did with cars." The base's fighter, helicopters and bomber were
   40-95 taperBoxes each; a fuselage is a lofted surface, a wing is an
   aerofoil with a planform, and a helicopter has a tandem cockpit, a chin
   gun and a tailwheel. This file is the kit and the airframes.

   THE KIT (pure geometry, r128 BufferGeometry, no rng — deterministic):
     loft(stations, o)    closed or open-arc superellipse sections along Z,
                          smooth-shaded; o.split(z, theta) re-emits chosen
                          quads (windows) as a second geometry that shares
                          the same arithmetic, so a windscreen IS the hull.
     wing(stations, o)    NACA-00xx aerofoil sections along +X (planform:
                          x, le, c, tc, y), hard trailing edge, capped.
     annulus(a, b)        the ring between two sections (an open intake lip).
     Kit                  geometry bucketed by material, merged ONCE into
                          one mesh per material per node.

   THE AIRFRAMES (real metres, nose +Z, wheels on y = 0, group scale 1):
     fighter     F-35-class single-seat: 15.6 L x 10.7 span x 4.4 H
     attackHeli  AH-64-class: 14.6 m rotor, 15.5 m fuselage, tandem seats
     utilityHeli UH-60-class: 16.4 m rotor, wheels not skids
     drone       MQ-9-class MALE: 11 L x 20 span, V-tail, pusher prop
     bomber      B-52H Stratofortress: 48.5 x 56.4 x 12.4, eight engines in four pods

   COST: every type is built ONCE into a template (merged per material,
   geometry flagged _shared so no disposer frees it) and each placement is
   a clone that shares geometry and material. Only moving parts are their
   own nodes: control surfaces, rotors, props, canopy, gear, chin gun. The
   per-instance extras are the afterburner plume and one nozzle-glow
   material, because those animate per aircraft.

   RUNTIME CONTRACT (read by aircraft.js / playeraircraft.js):
     CBZ.milAir.make(type)        -> {group, footW, footL, height, aircraftDims}
     CBZ.milAirDrive(group, s, dt) control surfaces follow the airframe's own
                                   roll/pitch/yaw rates, nozzle glow + props
                                   follow s.thr (0..1), gear hides when
                                   s.agl > 9. Cheap, allocation-free.
     CBZ.milAirAim(group, x,y,z)   slews a chin turret at a world point.
     CBZ.milAirPoint(group, key, i, out) world position of a published
                                   local point (launch rails, gun muzzle).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const TAU = Math.PI * 2, DEG = Math.PI / 180;

  // ---- materials: cached singletons only --------------------------------
  function cm(hex, o) {
    if (CBZ.cmat) return CBZ.cmat(hex, o);
    if (CBZ.mat) return CBZ.mat(hex, o);
    return new THREE.MeshLambertMaterial({ color: hex });
  }
  function vm(role, hex, o) {
    if (CBZ.vehicleMat) { try { const m = CBZ.vehicleMat(role, hex, o); if (m && m.isMaterial) return m; } catch (e) {} }
    return cm(hex);
  }
  function lamp(hex) { return cm(hex, { emissive: hex, ei: 0.9 }); }

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
  //  2. KIT + BUILD (template) + INSTANCE
  // =====================================================================
  function Kit(node, pre) { this.node = node; this.pre = pre || null; this.m = new Map(); }
  Kit.prototype.add = function (g, mat) {
    if (!g) return this;
    if (Array.isArray(g)) { for (let i = 0; i < g.length; i++) this.add(g[i], mat); return this; }
    if (this.pre) xm(g, this.pre);
    let b = this.m.get(mat); if (!b) this.m.set(mat, b = []);
    b.push(g); return this;
  };
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
  Kit.prototype.bake = function (shadow) {
    let k = 0;
    this.m.forEach(function (list, mat) {
      const mesh = new THREE.Mesh(merge(list), mat);
      mesh.castShadow = shadow !== false; mesh.receiveShadow = true;
      mesh.name = (this.node.name || "part") + "#" + (k++);
      this.node.add(mesh);
    }, this);
    this.m.clear();
  };

  function Build(type) {
    this.type = type;
    this.root = new THREE.Group(); this.root.name = "milair-" + type;
    this.kits = [];
    this.main = this.kit(this.root);
    this.refs = {};                     // userData key -> node name (resolved per clone)
    this.ud = { milAir: { type: type, surf: [], props: [] } };
    this.post = [];
  }
  Build.prototype.kit = function (node) {
    node.updateMatrixWorld(true);
    const pre = node === this.root ? null : new THREE.Matrix4().copy(node.matrixWorld).invert();
    const k = new Kit(node, pre); this.kits.push(k); return k;
  };
  Build.prototype.node = function (name, x, y, z, parent) {
    const g = new THREE.Group(); g.name = name; g.position.set(x || 0, y || 0, z || 0);
    (parent || this.root).add(g); this.root.updateMatrixWorld(true);
    return g;
  };
  // A HINGE: a group at `o` whose local +X runs along `axis`, with a child
  // node that deflects about that axis (rotation.x). Parts added to the
  // returned kit are authored in MODEL space.
  Build.prototype.hinge = function (name, o, axis, role, max) {
    const h = new THREE.Group(); h.name = name + ":hinge"; h.position.set(o[0], o[1], o[2]);
    const ax = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
    h.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), ax);
    this.root.add(h);
    const d = new THREE.Group(); d.name = name; h.add(d);
    this.root.updateMatrixWorld(true);
    if (role) this.ud.milAir.surf.push({ name: name, role: role, side: o[0] >= 0 ? 1 : -1, max: max || 0.35 });
    return this.kit(d);
  };
  Build.prototype.finish = function (dims, extra) {
    for (let i = 0; i < this.kits.length; i++) this.kits[i].bake();
    this.ud.aircraftDims = dims;
    if (extra) for (const k in extra) this.ud[k] = extra[k];
    this.root.userData = this.ud;
    return this;
  };

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

  const TPL = Object.create(null), BUILDERS = Object.create(null);
  function instance(type) {
    let T = TPL[type];
    if (!T) { T = TPL[type] = BUILDERS[type](); }
    const g = T.root.clone(true);
    for (const key in T.refs) { const o = g.getObjectByName(T.refs[key]); if (o) g.userData[key] = o; }
    if (g.userData.muzzle && g.userData.muzzle.isObject3D) g.userData.muzzleLocal = g.userData.muzzle.position.clone();
    // runtime handles live OFF userData so a clone of an instance stays cheap
    const M = g.userData.milAir, rt = { surf: [], props: [], glow: null, gear: g.userData.gear || null,
      cr: 0, cp: 0, cy: 0, r0: null, p0: 0, h0: 0 };
    for (let i = 0; i < M.surf.length; i++) {
      const s = M.surf[i], node = g.getObjectByName(s.name);
      if (node) rt.surf.push({ node: node, role: s.role, side: s.side, max: s.max });
    }
    for (let i = 0; i < M.props.length; i++) { const p = g.getObjectByName(M.props[i]); if (p) rt.props.push(p); }
    g._milRt = rt;
    for (let i = 0; i < T.post.length; i++) T.post[i](g, rt);
    const d = g.userData.aircraftDims;
    return { group: g, footW: d.span, footL: d.length, height: d.height, aircraftDims: d,
      colliderW: d.bodyW || null, colliderL: d.bodyL || null };
  }

  // ---- shared bits every airframe uses --------------------------------------
  function navLights(B, pts) {
    // pts: [[x,y,z,hex], ...]
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      B.main.add(xf(sph(0.09, 8, 6), p[0], p[1], p[2]), lamp(p[3]));
    }
  }
  const RED = 0xff4a3d, GREEN = 0x37d67a, WHITE = 0xf2f4ff;
  function muzzleNode(B, x, y, z) {
    const n = B.node("muzzle", x, y, z); B.refs.muzzle = "muzzle"; return n;
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
  function bomb(len, r) {
    const out = [loft([
      rnd(len / 2, r * 0.25), rnd(len / 2 - r * 0.6, r * 0.8), rnd(len / 2 - r * 2.2, r),
      rnd(-len / 2 + r * 2.4, r), rnd(-len / 2 + r * 0.4, r * 0.55), rnd(-len / 2, r * 0.45),
    ], { n: 12 })];
    for (let k = 0; k < 4; k++) {
      out.push(xf(wing([{ x: r * 0.4, le: -len / 2 + r * 2.6, c: r * 2.6, tc: 0.05 }, { x: r * 1.9, le: -len / 2 + r * 1.2, c: r * 1.2, tc: 0.05 }], { K: 3 }),
        0, 0, 0, 0, 0, k * Math.PI / 2 + Math.PI / 4));
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
  function addPlume(g, rt, x, y, z, r) {
    if (!CBZ.createRocketPlume) return;
    const p = CBZ.createRocketPlume({ name: "fighter-afterburner", lightRange: 13 });
    p.position.set(x, y, z); p.scale.setScalar(r || 1); g.add(p);
    if (CBZ.setRocketPlume) CBZ.setRocketPlume(p, 0, 0);
    g.userData.plume = (g.userData.plume || []).concat([p]);
    g.userData.plumeMat = g.userData.plume[0].userData.outerMaterial;
  }
  function addGlow(g, rt, list) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x140c08 });
    for (let i = 0; i < list.length; i++) {
      const L = list[i];
      const m = new THREE.Mesh(xf(new THREE.CircleGeometry(L[3], 16), 0, 0, 0, 0, Math.PI), mat);
      m.geometry._shared = false;
      m.position.set(L[0], L[1], L[2]); m.name = "nozzle-glow"; g.add(m);
    }
    rt.glow = mat;
  }

  // =====================================================================
  //  3. FIGHTER — F-35-class single-seat, single engine, twin canted fins
  //     15.6 m long, 10.7 m span, 4.4 m tall. Real planform: 34° LE,
  //     forward-swept TE, a LERX kink at the root, flaperons, all-moving
  //     stabilators, canted twin fins with rudders. Side caret intakes
  //     with a real open lip and a dark engine face down the duct.
  // =====================================================================
  BUILDERS.fighter = function () {
    const B = new Build("fighter");
    const SKIN = cm(0x7d858e), SKIND = cm(0x626a73), GLASS = vm("glass", 0x2a3b4d);
    const GUN = vm("plastic", 0x202327), TRIM = vm("interior", 0x0d0e10), RUB = vm("tire", 0x14161a);
    const RIM = vm("rim", 0xb9bdc4), STORE = cm(0xd4d9df), DUCT = cm(0x15171a), GEARM = cm(0xc9ccd0);
    const K = B.main;
    // ---- fuselage: one loft, chined forebody (p≈3) blending into the
    // wide intake/wing-root midbody and squaring into the nozzle.
    const FUS = [
      [ 8.00, 0.03, 0.03, 0.03, 1.72, 2.0],
      [ 7.40, 0.26, 0.24, 0.22, 1.71, 2.3],
      [ 6.60, 0.46, 0.37, 0.34, 1.73, 2.6],
      [ 5.60, 0.64, 0.47, 0.44, 1.76, 2.9],
      [ 4.40, 0.82, 0.55, 0.50, 1.80, 3.0],
      [ 3.20, 1.22, 0.60, 0.55, 1.81, 3.2],
      [ 2.00, 1.56, 0.64, 0.58, 1.82, 3.3],
      [ 0.50, 1.70, 0.68, 0.60, 1.84, 3.3],
      [-1.50, 1.66, 0.64, 0.59, 1.86, 3.2],
      [-3.50, 1.42, 0.57, 0.54, 1.87, 3.0],
      [-5.00, 1.06, 0.50, 0.48, 1.88, 2.8],
      [-6.20, 0.74, 0.46, 0.44, 1.88, 2.4],
      [-6.95, 0.60, 0.42, 0.42, 1.88, 2.0],
    ].map(function (r) { return { z: r[0], w: r[1], t: r[2], b: r[3], y: r[4], p: r[5] }; });
    K.add(loft(FUS, { n: 24 }), SKIN);
    // dorsal spine behind the canopy
    K.add(loft([
      { z: 2.4, y: 2.30, w: 0.05, t: 0.02, b: 0.05 }, { z: 1.6, y: 2.32, w: 0.42, t: 0.20, b: 0.1, p: 2.4 },
      { z: -2.5, y: 2.28, w: 0.52, t: 0.18, b: 0.1, p: 2.6 }, { z: -5.2, y: 2.18, w: 0.3, t: 0.08, b: 0.1 },
    ], { n: 14 }), SKIN);
    // ---- intakes (built on +X, mirrored): outer trunk with NO front cap,
    // an inset duct liner, the lip annulus between them and the engine face.
    {
      const L = [];
      const trunk = [
        { z: 4.55, x: 1.04, y: 1.78, w: 0.34, t: 0.37, b: 0.31, p: 2.6 },
        { z: 3.90, x: 1.08, y: 1.79, w: 0.38, t: 0.42, b: 0.36, p: 2.8 },
        { z: 2.60, x: 1.02, y: 1.80, w: 0.36, t: 0.45, b: 0.40, p: 2.8 },
        { z: 1.40, x: 0.86, y: 1.80, w: 0.28, t: 0.38, b: 0.34, p: 2.6 },
      ];
      const inset = function (s, d, z) { return { z: z == null ? s.z : z, x: s.x, y: s.y, w: s.w - d, t: s.t - d, b: s.b - d, p: s.p }; };
      const outer = loft(trunk, { n: 18, capFront: false });
      const duct = loft([inset(trunk[0], 0.045), inset(trunk[0], 0.07, 3.7)], { n: 18, flipped: true, caps: false });
      const lip = annulus(trunk[0], inset(trunk[0], 0.045), 18, [0, 0, 1]);
      const face = xf(new THREE.CircleGeometry(0.26, 14), 1.04, 1.78, 3.72);
      const dsi = loft([{ z: 4.75, x: 0.80, y: 1.84, w: 0.02, t: 0.02, b: 0.02 }, { z: 4.25, x: 0.80, y: 1.84, w: 0.13, t: 0.22, b: 0.2 }, { z: 3.55, x: 0.80, y: 1.84, w: 0.02, t: 0.02, b: 0.02 }], { n: 10 });
      K.add([outer, mir(outer)], SKIN).add([lip, mir(lip)], SKIND).add([duct, mir(duct), face, mir(face)], DUCT).add([dsi, mir(dsi)], SKIN);
    }
    // ---- canopy: its own node (aircraft_doors lifts it), hinged aft ----
    const can = B.node("canopy", 0, 2.36, 1.55); B.refs.canopy = "canopy";
    const CK = B.kit(can);
    const CAN = [[5.95, 0.04, 0.03], [5.40, 0.30, 0.28], [4.60, 0.44, 0.56], [3.60, 0.47, 0.66], [2.60, 0.41, 0.52], [1.85, 0.22, 0.24], [1.40, 0.05, 0.03]];
    CK.add(loft(CAN.map(function (c) { return { z: c[0], y: 2.34 + (5.95 - c[0]) * 0.012, w: c[1], t: c[2], b: 0.12 }; }), { n: 18 }), GLASS);
    const bow = xf(new THREE.TorusGeometry(0.47, 0.035, 6, 18, Math.PI), 0, 2.37, 3.9, 0, 0, 0, 1.0, 0.64 / 0.47 * 1.02, 1);
    CK.add(bow, SKIND);
    [-1, 1].forEach(function (s) { CK.add(rod([s * 0.42, 2.38, 5.2], [s * 0.4, 2.40, 2.3], 0.03, 6), SKIND); });
    // cockpit you can see through the glass
    K.add(xf(box(0.62, 0.16, 0.5), 0, 2.36, 4.95), TRIM);                         // coaming
    K.add(xf(box(0.5, 0.36, 0.08), 0, 2.30, 4.72, -0.3), TRIM);                   // panel
    K.add(xf(box(0.14, 0.16, 0.02), 0, 2.55, 5.02, -0.55), GLASS);                // HUD combiner
    K.add(xf(box(0.52, 0.12, 0.52), 0, 2.08, 3.72), TRIM);                        // seat pan
    K.add(xf(box(0.52, 0.82, 0.14), 0, 2.46, 3.40, 0.28), TRIM);                  // seat back
    K.add(xf(box(0.30, 0.22, 0.18), 0, 2.92, 3.30, 0.28), TRIM);                  // headbox
    // ---- wings: planform knots (LE / TE z at span x) ------------------------
    const WK = [{ x: 1.0, le: 2.8, te: -4.5, tc: 0.035, y: 1.95 }, { x: 1.75, le: 0.6, te: -4.3, tc: 0.05, y: 1.96 }, { x: 5.35, le: -1.85, te: -3.3, tc: 0.045, y: 2.02 }];
    const FC = 0.58, F0 = 1.95, F1 = 4.85;
    const wst = [planAt(WK, 1.0), planAt(WK, 1.75), planAt(WK, F0), planAt(WK, F0, FC), planAt(WK, F1, FC), planAt(WK, F1), planAt(WK, 5.35)];
    const wg = wing(wst, { K: 7 });
    K.add([wg, mir(wg)], SKIN);
    [-1, 1].forEach(function (s) {
      const a = planAt(WK, F0 + 0.03, FC), b = planAt(WK, F1 - 0.03, FC);
      const hk = B.hinge(s > 0 ? "flaperonL" : "flaperonR", [s * a.x, a.y, a.le - a.c], [s * (b.x - a.x), b.y - a.y, (b.le - b.c) - (a.le - a.c)], "ail", 0.35);
      let fg = wing([{ x: a.x, le: a.le - a.c - 0.01, c: FC, tc: 0.07, y: a.y }, { x: b.x, le: b.le - b.c - 0.01, c: FC * 0.95, tc: 0.07, y: b.y }], { K: 4 });
      if (s < 0) fg = mir(fg);
      hk.add(fg, SKIND);
    });
    // ---- all-moving stabilators --------------------------------------------
    [-1, 1].forEach(function (s) {
      const hk = B.hinge(s > 0 ? "stabL" : "stabR", [s * 1.0, 1.9, -5.75], [s, 0, 0], "stab", 0.35);
      let sg = wing([{ x: 0.85, le: -4.65, c: 2.8, tc: 0.045, y: 1.9 }, { x: 3.35, le: -6.3, c: 0.95, tc: 0.04, y: 1.86 }], { K: 5 });
      if (s < 0) sg = mir(sg);
      hk.add(sg, SKIN);
    });
    // ---- twin canted fins + rudders ------------------------------------------
    const CANT = 25 * DEG, FIN_Y = 2.38;
    const FK = [{ x: 0, le: -3.15, te: -6.25, tc: 0.05 }, { x: 2.15, le: -4.85, te: -6.05, tc: 0.045 }];
    const RC = 0.52, R0 = 0.3, R1 = 1.85;
    const finM = function (s) {   // fin-space (+X = up the fin) → model
      const M = new THREE.Matrix4();
      _q.setFromEuler(_e.set(0, 0, s > 0 ? Math.PI / 2 - CANT : Math.PI / 2 + CANT));
      M.compose(_v.set(s * 0.72, FIN_Y, 0), _q, _s.set(1, 1, 1));
      return M;
    };
    [-1, 1].forEach(function (s) {
      const M = finM(s);
      const fst = [planAt(FK, 0), planAt(FK, R0), planAt(FK, R0, RC), planAt(FK, R1, RC), planAt(FK, R1), planAt(FK, 2.15)];
      K.add(xm(wing(fst, { K: 6 }), M), SKIN);
      const a = planAt(FK, R0 + 0.03, RC), b = planAt(FK, R1 - 0.03, RC);
      const pa = new THREE.Vector3(a.x, 0, a.le - a.c).applyMatrix4(M), pb = new THREE.Vector3(b.x, 0, b.le - b.c).applyMatrix4(M);
      const hk = B.hinge(s > 0 ? "rudderL" : "rudderR", [pa.x, pa.y, pa.z], [pb.x - pa.x, pb.y - pa.y, pb.z - pa.z], "rud", 0.4);
      hk.add(xm(wing([{ x: a.x, le: a.le - a.c - 0.01, c: RC, tc: 0.07 }, { x: b.x, le: b.le - b.c - 0.01, c: RC * 0.9, tc: 0.07 }], { K: 4 }), M), SKIND);
    });
    // ---- nozzle: a round convergent can with a dark throat ------------------
    K.add(loft([rnd(-6.75, 0.62, 1.88), rnd(-7.3, 0.58, 1.88), rnd(-7.9, 0.50, 1.88)], { n: 20, caps: false }), GUN);
    K.add(loft([rnd(-7.9, 0.46, 1.88), rnd(-7.45, 0.36, 1.88)], { n: 20, caps: false, flipped: true }), DUCT);
    K.add(annulus(rnd(-7.9, 0.5, 1.88), rnd(-7.9, 0.46, 1.88), 20, [0, 0, -1]), GUN);
    // ---- underwing stores: inner bombs, outer missiles, on pylons ------------
    const launch = [];
    [-1, 1].forEach(function (s) {
      const pi = planAt(WK, 2.7), po = planAt(WK, 4.0);
      K.add(pylon(s * 2.7, pi.y - 0.02, 1.64, pi.le - 0.5, 1.6), SKIND);
      K.add(pylon(s * 4.0, po.y - 0.02, 1.76, po.le - 0.25, 1.1), SKIND);
      K.add(bomb(2.4, 0.19).map(function (g) { return xf(g, s * 2.7, 1.43, pi.le - 1.3); }), STORE);
      K.add(missile(3.65, 0.09).map(function (g) { return xf(g, s * 4.0, 1.64, po.le - 0.8); }), STORE);
      launch.push([s * 4.0, 1.64, po.le - 0.8 + 1.83]);
    });
    B.ud.launchLocal = launch;
    // ---- landing gear (one node: playeraircraft hides it above 9 m AGL) ------
    const gear = B.node("gear"); B.refs.gear = "gear";
    const GK = B.kit(gear);
    {
      const nw = wheel(0.30, 0.18), mw = wheel(0.40, 0.26);
      GK.add(rod([0, 1.30, 4.55], [0, 0.30, 4.62], 0.06), GEARM).add(rod([0, 1.25, 4.1], [0, 0.55, 4.58], 0.035), GEARM);
      GK.add(xf(nw.tire, 0, 0.30, 4.62), RUB).add(xf(nw.hub, 0, 0.30, 4.62), RIM);
      GK.add(xf(box(0.03, 0.5, 1.2), 0.2, 1.05, 4.35), SKIND).add(xf(box(0.03, 0.5, 1.2), -0.2, 1.05, 4.35), SKIND);
      [-1, 1].forEach(function (s) {
        GK.add(rod([s * 1.35, 1.5, -1.55], [s * 1.62, 0.40, -1.62], 0.075), GEARM);
        GK.add(rod([s * 0.95, 1.40, -2.3], [s * 1.5, 0.85, -1.6], 0.04), GEARM);
        GK.add(xf(mw.tire, s * 1.62, 0.40, -1.62), RUB).add(xf(mw.hub, s * 1.62, 0.40, -1.62), RIM);
        GK.add(xf(box(0.035, 0.62, 1.4), s * 1.15, 1.08, -1.6, 0, 0, s * 0.15), SKIND);
      });
    }
    navLights(B, [[5.36, 2.03, -2.5, RED], [-5.36, 2.03, -2.5, GREEN], [0, 2.45, -5.2, WHITE]]);
    muzzleNode(B, 0, 1.72, 8.08);
    B.ud.cabin = { seats: [{ id: "seat-captain", role: "pilot", cockpit: true, x: 0, y: 2.14, z: 3.72 }] };
    B.ud.fighterSurfaces = true;
    B.post.push(function (g, rt) {
      addGlow(g, rt, [[0, 1.88, -7.46, 0.36]]);
      addPlume(g, rt, 0, 1.88, -7.92, 1.35);
    });
    return B.finish({ family: "F-35-class", length: 15.9, span: 10.7, height: 4.4 });
  };

  // =====================================================================
  //  4. ATTACK HELICOPTER — AH-64-class. Narrow tandem cockpit (gunner
  //     forward and low, pilot aft and high) glazed as flat plates, stub
  //     wings with a rocket pod and a four-missile rail each side, a chin
  //     gun turret that slews, engine nacelles either side of the mast,
  //     4-blade 14.6 m main rotor, 4-blade tail rotor on the port side,
  //     fixed main gear and a tailwheel.
  // =====================================================================
  BUILDERS.attackHeli = function () {
    const B = new Build("attackHeli");
    const OD = cm(0x3f4636), ODD = cm(0x30362a), GLASS = vm("glass", 0x2a3b4d), GUN = vm("plastic", 0x202327);
    const TRIM = vm("interior", 0x0d0e10), RUB = vm("tire", 0x14161a), RIM = vm("rim", 0x9aa0a8), BLADE = cm(0x1c2126);
    const K = B.main;
    const FUS = [
      [ 5.95, 0.10, 0.10, 0.10, 1.40, 2.0],
      [ 5.50, 0.40, 0.42, 0.46, 1.42, 2.6],
      [ 4.60, 0.50, 0.52, 0.55, 1.45, 3.2],
      [ 3.60, 0.54, 0.68, 0.60, 1.50, 3.6],
      [ 2.80, 0.56, 1.02, 0.66, 1.55, 3.6],
      [ 1.50, 0.60, 1.08, 0.70, 1.60, 3.4],
      [ 0.20, 0.66, 1.12, 0.72, 1.64, 3.2],
      [-1.60, 0.62, 1.00, 0.64, 1.70, 3.0],
      [-3.20, 0.42, 0.60, 0.42, 1.84, 2.6],
      [-5.00, 0.27, 0.36, 0.28, 2.00, 2.4],
      [-8.00, 0.19, 0.27, 0.21, 2.10, 2.2],
      [-9.20, 0.16, 0.25, 0.18, 2.14, 2.2],
    ].map(function (r) { return { z: r[0], w: r[1], t: r[2], b: r[3], y: r[4], p: r[5] }; });
    // the canopy IS the hull above the sill across the two cockpits: those
    // quads are re-emitted as glass (flat plates at p≈3.5 read as the real
    // faceted Apache glazing)
    const parts = loft(FUS, {
      n: 20, split: function (z, th, a, b) {
        if (z > 5.0 || z < 1.25) return false;
        const s = Math.sin(th);
        return s > (z > 3.1 ? 0.38 : 0.52);
      },
    });
    K.add(parts[0], OD); if (parts[1]) K.add(parts[1], GLASS);
    // inner liner over the cockpits so the glass looks into a room
    K.add(loft(FUS.slice(1, 7).map(function (s) { return { z: s.z, w: s.w - 0.05, t: s.t - 0.05, b: s.b - 0.05, y: s.y, p: s.p }; }), { n: 20, flipped: true, caps: false }), TRIM);
    // cockpit furniture: two stepped tubs
    [[3.70, 1.24, 0.34], [2.25, 1.66, 0.50]].forEach(function (c) {
      K.add(xf(box(0.56, 0.10, 0.55), 0, c[1] - 0.05, c[0]), TRIM);
      K.add(xf(box(0.56, 0.78, 0.12), 0, c[1] + 0.34, c[0] - 0.32, 0.18), TRIM);
      K.add(xf(box(0.66, 0.34, 0.1), 0, c[1] + 0.5, c[0] + 0.72, -0.35), TRIM);
    });
    // canopy frame bows
    [4.62, 3.12, 1.35].forEach(function (z) {
      K.add(xf(new THREE.TorusGeometry(0.56, 0.03, 5, 14, Math.PI), 0, z > 3 ? 1.95 : 2.2, z, 0, 0, 0, 1.0, z > 3 ? 1.1 : 1.5, 1), ODD);
    });
    // TADS/PNVS nose turret
    K.add(loft([rnd(6.35, 0.05, 1.28), rnd(6.2, 0.30, 1.28), rnd(5.6, 0.34, 1.28), rnd(5.3, 0.25, 1.28)], { n: 14 }), ODD);
    K.add(xf(box(0.3, 0.22, 0.04), 0, 1.3, 6.33), GLASS);
    // engine nacelles (+X built, mirrored) with dark intakes + turned exhausts
    {
      const nac = loft([{ z: 0.75, x: 0.92, y: 2.28, w: 0.32, t: 0.34, b: 0.32 }, { z: 0.3, x: 0.95, y: 2.3, w: 0.40, t: 0.42, b: 0.38, p: 2.6 },
        { z: -2.2, x: 0.95, y: 2.3, w: 0.40, t: 0.40, b: 0.36, p: 2.6 }, { z: -2.9, x: 1.0, y: 2.34, w: 0.26, t: 0.26, b: 0.24 }], { n: 16, capFront: false });
      const face = xf(new THREE.CircleGeometry(0.3, 12), 0.92, 2.28, 0.7);
      const exh = loft([rnd(-2.75, 0.2, 2.34, 1.05), rnd(-3.35, 0.24, 2.34, 1.3)], { n: 12, caps: false });
      K.add([nac, mir(nac)], OD).add([face, mir(face)], GUN).add([exh, mir(exh)], GUN);
      // mast fairing
      K.add(loft([{ z: 0.9, y: 2.6, w: 0.1, t: 0.1, b: 0.1 }, { z: 0.4, y: 2.62, w: 0.46, t: 0.38, b: 0.2 }, { z: -1.2, y: 2.62, w: 0.42, t: 0.34, b: 0.2 }, { z: -2.6, y: 2.5, w: 0.1, t: 0.08, b: 0.1 }], { n: 14 }), OD);
    }
    // stub wings, pylons, rocket pods and missile rails
    const launch = [];
    {
      const sw = wing([{ x: 0.3, le: 0.05, c: 1.35, tc: 0.14, y: 1.95 }, { x: 2.62, le: -0.15, c: 1.0, tc: 0.12, y: 1.86 }], { K: 5 });
      K.add([sw, mir(sw)], OD);
      [-1, 1].forEach(function (s) {
        const P = pod(1.55, 0.19);
        K.add([pylon(s * 1.35, 1.9, 1.62, 0.05, 0.9), pylon(s * 2.3, 1.86, 1.62, -0.05, 0.8)], ODD);
        K.add(xf(P.body, s * 1.35, 1.38, -0.2), OD).add(xf(P.face, s * 1.35, 1.38, -0.2), GUN);
        launch.push([s * 1.35, 1.38, 0.62]);
        K.add(xf(box(0.08, 0.1, 1.6), s * 2.3, 1.58, -0.25), GUN);
        [[-0.13, 1.44], [0.13, 1.44], [-0.13, 1.2], [0.13, 1.2]].forEach(function (m) {
          K.add(missile(1.63, 0.089).map(function (g) { return xf(g, s * 2.3 + m[0], m[1], -0.2); }), cm(0x5a6048));
          if (m[1] > 1.3) launch.push([s * 2.3 + m[0], m[1], 0.62]);
        });
      });
    }
    B.ud.launchLocal = launch;
    // chin gun: yaw node → pitch node → receiver + barrel. Slewed by milAirAim.
    const yaw = B.node("chinYaw", 0, 0.9, 4.25); const pit = B.node("chinPitch", 0, 0, 0, yaw);
    B.kit(yaw).add(loft([rnd(4.5, 0.05, 0.9), rnd(4.43, 0.2, 0.9), rnd(4.05, 0.22, 0.9), rnd(3.95, 0.1, 0.9)], { n: 12 }), ODD);
    const PK = B.kit(pit);
    PK.add(xf(box(0.22, 0.2, 0.62), 0, 0.78, 4.3), GUN);
    PK.add(xf(cylZ(0.045, 0.045, 1.45, 8), 0, 0.9 - 0.12, 4.25 + 1.0), GUN);
    PK.add(xf(cylZ(0.07, 0.07, 0.16, 8), 0, 0.9 - 0.12, 4.25 + 1.68), GUN);
    const mz = B.node("chinMuzzle", 0, -0.12, 1.78, pit);
    B.ud.chinGun = { yaw: "chinYaw", pitch: "chinPitch", muzzle: "chinMuzzle" };
    B.refs.chinMuzzle = "chinMuzzle";
    // mast + main rotor (4 blades, R 7.3) — its own node spun about Y
    K.add(xf(cylZ(0.14, 0.14, 1.1, 10), 0, 3.2, 0, -Math.PI / 2), GUN);
    const rotor = B.node("rotor", 0, 3.78, 0); B.refs.rotor = "rotor";
    const RK = B.kit(rotor);
    RK.add(xf(box(0.7, 0.24, 0.7), 0, 3.78, 0, 0, Math.PI / 4), GUN);
    for (let i = 0; i < 4; i++) {
      RK.add(xf(wing([{ x: 0.35, le: 0.14, c: 0.5, tc: 0.12, y: 0 }, { x: 7.3, le: 0.14, c: 0.53, tc: 0.08, y: -0.16 }], { K: 4 }), 0, 3.8, 0, 0, i * Math.PI / 2 + 0.1), BLADE);
    }
    // tail: fin, stabilator, tail rotor on the PORT (+X) side, tailwheel
    const fin = wing([{ x: 0, le: -8.35, c: 1.3, tc: 0.14 }, { x: 1.95, le: -9.35, c: 0.95, tc: 0.12 }], { K: 5 });
    K.add(xf(fin, 0, 2.2, 0, 0, 0, Math.PI / 2), OD);
    const st = wing([{ x: 0.1, le: -8.4, c: 0.9, tc: 0.1, y: 2.2 }, { x: 1.7, le: -8.6, c: 0.7, tc: 0.1, y: 2.2 }], { K: 4 });
    K.add([st, mir(st)], OD);
    K.add(xf(cylX(0.06, 0.4, 8), 0.2, 3.72, -9.05), GUN);
    const trot = B.node("tailRotor", 0.4, 3.72, -9.05); B.refs.tailRotor = "tailRotor"; B.refs.trotor = "tailRotor";
    const TK = B.kit(trot);
    TK.add(xf(box(0.14, 0.2, 0.2), 0.4, 3.72, -9.05), GUN);
    [0, 0.95, Math.PI, Math.PI + 0.95].forEach(function (a) {   // scissor pairs
      TK.add(xf(wing([{ x: 0.12, le: 0.1, c: 0.24, tc: 0.1 }, { x: 1.38, le: 0.1, c: 0.24, tc: 0.08 }], { K: 3 }), 0.4, 3.72, -9.05, a, 0, Math.PI / 2), BLADE);
    });
    // gear: fixed trailing-arm mains + tailwheel (parked static geometry)
    {
      const mw = wheel(0.38, 0.2), tw = wheel(0.2, 0.12);
      [-1, 1].forEach(function (s) {
        K.add(rod([s * 0.55, 1.05, 1.7], [s * 1.0, 0.38, 1.2], 0.07), ODD).add(rod([s * 0.6, 1.1, 0.7], [s * 1.0, 0.38, 1.2], 0.05), ODD);
        K.add(xf(mw.tire, s * 1.0, 0.38, 1.2), RUB).add(xf(mw.hub, s * 1.0, 0.38, 1.2), RIM);
      });
      K.add(rod([0, 1.9, -8.0], [0, 0.2, -8.35], 0.05), ODD);
      K.add(xf(tw.tire, 0, 0.2, -8.35), RUB).add(xf(tw.hub, 0, 0.2, -8.35), RIM);
    }
    navLights(B, [[2.64, 1.87, -0.4, RED], [-2.64, 1.87, -0.4, GREEN], [0, 4.2, -9.3, WHITE]]);
    muzzleNode(B, 0, 1.2, 6.4);
    // real metres: the gunship crew sit HERE (aircraft.js seats them by job)
    B.ud.crewSeats = [
      { job: "Pilot", x: 0, y: 1.66, z: 2.25, yaw: 0, cushionH: 0.42, floorBelow: 0.42 },
      { job: "Weapons Systems Officer", x: 0, y: 1.24, z: 3.70, yaw: 0, cushionH: 0.42, floorBelow: 0.42 },
    ];
    B.ud.cabin = { seats: [
      { id: "seat-captain", role: "pilot", cockpit: true, x: 0, y: 1.66, z: 2.25 },
      { id: "seat-gunner", role: "copilot", cockpit: true, x: 0, y: 1.24, z: 3.70 },
    ] };
    B.ud.attackHeli = true;
    return B.finish({ family: "AH-64-class", length: 17.7, span: 14.6, height: 4.9, bodyW: 5.3, bodyL: 16.0 });
  };

  // =====================================================================
  //  5. UTILITY HELICOPTER — UH-60-class. A real cabin (2.36 m wide) with
  //     glazed cockpit and cabin windows cut out of the hull, engines atop,
  //     16.4 m 4-blade rotor, canted tail rotor on the starboard pylon,
  //     stabilator, main wheels and a tailwheel. Door gun in the cabin.
  // =====================================================================
  BUILDERS.utilityHeli = function () {
    const B = new Build("utilityHeli");
    const OD = cm(0x3b4131), ODD = cm(0x2d3226), GLASS = vm("glass", 0x2a3b4d), GUN = vm("plastic", 0x202327);
    const TRIM = vm("interior", 0x0d0e10), RUB = vm("tire", 0x14161a), RIM = vm("rim", 0x9aa0a8), BLADE = cm(0x1c2126);
    const K = B.main;
    const FUS = [
      [ 5.60, 0.12, 0.12, 0.12, 1.30, 2.0],
      [ 5.20, 0.58, 0.58, 0.46, 1.36, 2.3],
      [ 4.40, 0.96, 0.86, 0.60, 1.44, 2.7],
      [ 3.20, 1.15, 0.96, 0.70, 1.50, 3.3],
      [ 2.00, 1.18, 0.92, 0.75, 1.55, 3.8],
      [-1.20, 1.16, 0.86, 0.75, 1.60, 3.8],
      [-2.20, 0.86, 0.76, 0.46, 1.80, 3.0],
      [-4.00, 0.46, 0.46, 0.34, 2.02, 2.6],
      [-7.50, 0.28, 0.30, 0.25, 2.12, 2.4],
      [-8.80, 0.25, 0.42, 0.25, 2.26, 2.4],
    ].map(function (r) { return { z: r[0], w: r[1], t: r[2], b: r[3], y: r[4], p: r[5] }; });
    const parts = loft(FUS, {
      n: 24, split: function (z, th) {
        const s = Math.sin(th), c = Math.cos(th);
        if (z > 3.0 && z < 5.3) return s > -0.05 && !(Math.abs(c) < 0.18 && z < 4.1);      // windscreen + chin + doors, roof beam solid
        if (z > -0.9 && z < 1.4) return s > 0.15 && s < 0.62 && Math.abs(c) > 0.5;        // cabin windows
        return false;
      },
    });
    K.add(parts[0], OD); if (parts[1]) K.add(parts[1], GLASS);
    K.add(loft(FUS.slice(1, 6).map(function (s) { return { z: s.z, w: s.w - 0.06, t: s.t - 0.06, b: s.b - 0.06, y: s.y, p: s.p }; }), { n: 24, flipped: true, caps: false }), TRIM);
    // cabin floor, cockpit panel + seats, troop seats
    K.add(xf(box(2.1, 0.08, 7.6), 0, 0.95, 1.4), TRIM);
    K.add(xf(box(1.8, 0.38, 0.14), 0, 1.72, 4.45, -0.4), TRIM);
    [-0.55, 0.55].forEach(function (x) {
      K.add(xf(box(0.52, 0.1, 0.5), x, 1.33, 3.35), TRIM).add(xf(box(0.52, 0.8, 0.12), x, 1.72, 3.05, 0.12), TRIM);
    });
    K.add(xf(box(1.9, 0.1, 0.5), 0, 1.33, -0.9), cm(0x6a5c44)).add(xf(box(1.9, 0.6, 0.08), 0, 1.66, -1.15), cm(0x6a5c44));
    // sliding-door rails + door gun on the starboard (-X) window
    K.add(xf(box(0.04, 0.06, 2.4), 1.2, 2.3, 0.3), ODD).add(xf(box(0.04, 0.06, 2.4), -1.2, 2.3, 0.3), ODD);
    K.add(rod([-1.05, 1.0, 0.8], [-1.05, 1.62, 0.8], 0.035), GUN);
    K.add(xf(box(0.14, 0.16, 0.7), -1.12, 1.7, 0.95), GUN).add(xf(cylZ(0.03, 0.03, 0.7, 6), -1.12, 1.7, 1.6), GUN);
    // upper deck: transmission fairing + twin engines, exhausts turned out
    K.add(loft([{ z: 2.6, y: 2.35, w: 0.2, t: 0.05, b: 0.1 }, { z: 2.0, y: 2.38, w: 0.8, t: 0.5, b: 0.1, p: 2.6 }, { z: -2.2, y: 2.38, w: 0.78, t: 0.46, b: 0.1, p: 2.6 }, { z: -3.4, y: 2.3, w: 0.2, t: 0.06, b: 0.1 }], { n: 16 }), OD);
    {
      const eng = loft([{ z: 1.2, x: 0.62, y: 2.6, w: 0.26, t: 0.28, b: 0.26 }, { z: 0.8, x: 0.65, y: 2.62, w: 0.34, t: 0.34, b: 0.3, p: 2.4 }, { z: -1.9, x: 0.65, y: 2.6, w: 0.32, t: 0.32, b: 0.3, p: 2.4 }, { z: -2.4, x: 0.7, y: 2.6, w: 0.18, t: 0.18, b: 0.18 }], { n: 14, capFront: false });
      const face = xf(new THREE.CircleGeometry(0.24, 12), 0.62, 2.6, 1.15);
      const ex = loft([rnd(-2.2, 0.16, 2.62, 0.78), rnd(-2.6, 0.18, 2.62, 1.12)], { n: 10, caps: false });
      K.add([eng, mir(eng)], OD).add([face, mir(face)], GUN).add([ex, mir(ex)], GUN);
    }
    // tail pylon (swept, starboard tail rotor) + stabilator
    K.add(xf(wing([{ x: 0, le: -8.2, c: 1.5, tc: 0.16 }, { x: 1.75, le: -9.25, c: 1.05, tc: 0.14 }], { K: 5 }), 0, 2.4, 0, 0, 0, Math.PI / 2), OD);
    const stb = wing([{ x: 0.1, le: -7.9, c: 1.05, tc: 0.1, y: 1.95 }, { x: 2.2, le: -8.05, c: 0.9, tc: 0.1, y: 1.95 }], { K: 4 });
    K.add([stb, mir(stb)], OD);
    // tail rotor canted 20° (spin node inside a canted carrier)
    const carrier = B.node("tailCant", -0.28, 3.55, -9.35); carrier.rotation.z = -20 * DEG; B.root.updateMatrixWorld(true);
    const trot = B.node("tailRotor", 0, 0, 0, carrier); B.refs.tailRotor = "tailRotor"; B.refs.trotor = "tailRotor";
    const TK = B.kit(trot);
    const tr0 = new THREE.Vector3().setFromMatrixPosition(trot.matrixWorld);
    TK.add(xf(box(0.12, 0.24, 0.24), tr0.x, tr0.y, tr0.z), GUN);
    for (let i = 0; i < 4; i++) {
      const bl = wing([{ x: 0.12, le: 0.12, c: 0.26, tc: 0.1 }, { x: 1.68, le: 0.12, c: 0.26, tc: 0.08 }], { K: 3 });
      xf(bl, 0, 0, 0, i * Math.PI / 2, 0, Math.PI / 2);
      TK.add(xm(bl, new THREE.Matrix4().multiplyMatrices(trot.matrixWorld, new THREE.Matrix4())), BLADE);
    }
    // mast + rotor (4 blades, R 8.18)
    K.add(xf(cylZ(0.15, 0.15, 0.9, 10), 0, 3.35, -0.1, -Math.PI / 2), GUN);
    const rotor = B.node("rotor", 0, 3.78, -0.1); B.refs.rotor = "rotor";
    const RK = B.kit(rotor);
    RK.add(xf(box(0.8, 0.26, 0.8), 0, 3.78, -0.1, 0, Math.PI / 4), GUN);
    for (let i = 0; i < 4; i++) {
      RK.add(xf(wing([{ x: 0.4, le: 0.15, c: 0.5, tc: 0.12 }, { x: 8.18, le: 0.18, c: 0.53, tc: 0.08, y: -0.2 }], { K: 4 }), 0, 3.8, -0.1, 0, i * Math.PI / 2 + 0.3), BLADE);
    }
    // gear: sponson-mounted mains, tailwheel
    {
      const mw = wheel(0.38, 0.22), tw = wheel(0.22, 0.12);
      [-1, 1].forEach(function (s) {
        K.add(loft([{ z: 2.6, x: s * 1.18, y: 1.0, w: 0.05, t: 0.05, b: 0.05 }, { z: 2.2, x: s * 1.2, y: 1.0, w: 0.2, t: 0.2, b: 0.2 }, { z: 1.2, x: s * 1.2, y: 1.0, w: 0.2, t: 0.2, b: 0.2 }, { z: 0.8, x: s * 1.18, y: 1.0, w: 0.05, t: 0.05, b: 0.05 }], { n: 10 }), OD);
        K.add(rod([s * 1.2, 1.0, 1.7], [s * 1.35, 0.38, 1.75], 0.07), ODD).add(rod([s * 1.0, 0.9, 2.5], [s * 1.35, 0.38, 1.75], 0.045), ODD);
        K.add(xf(mw.tire, s * 1.42, 0.38, 1.75), RUB).add(xf(mw.hub, s * 1.42, 0.38, 1.75), RIM);
      });
      K.add(rod([0, 1.85, -7.0], [0, 0.22, -7.25], 0.05), ODD);
      K.add(xf(tw.tire, 0, 0.22, -7.25), RUB).add(xf(tw.hub, 0, 0.22, -7.25), RIM);
    }
    navLights(B, [[1.2, 1.9, 1.4, RED], [-1.2, 1.9, 1.4, GREEN], [0, 4.2, -9.6, WHITE]]);
    muzzleNode(B, 0, 1.2, 5.7);
    B.ud.crewSeats = [
      { job: "Pilot", x: -0.55, y: 1.38, z: 3.35, yaw: 0, cushionH: 0.42, floorBelow: 0.42 },
      { job: "Weapons Systems Officer", x: 0.55, y: 1.38, z: 3.35, yaw: 0, cushionH: 0.42, floorBelow: 0.42 },
      { job: "Door Gunner", x: -0.75, y: 1.38, z: 0.6, yaw: -Math.PI / 2, cushionH: 0.42, floorBelow: 0.42 },
    ];
    B.ud.cabin = { seats: [
      { id: "seat-captain", role: "pilot", cockpit: true, x: -0.55, y: 1.38, z: 3.35 },
      { id: "seat-firstofficer", role: "copilot", cockpit: true, x: 0.55, y: 1.38, z: 3.35 },
    ] };
    return B.finish({ family: "UH-60-class", length: 19.8, span: 16.4, height: 5.2, bodyW: 3.0, bodyL: 17.5 });
  };

  // =====================================================================
  //  6. DRONE — MQ-9-class MALE: 11 m long, 20 m straight high-aspect
  //     wing, V-tail over a ventral fin, 3-blade pusher, satcom bulge,
  //     sensor ball, four hardpoints. No cockpit: nobody boards it.
  // =====================================================================
  BUILDERS.drone = function () {
    const B = new Build("drone");
    const SK = cm(0x9aa0a6), SKD = cm(0x7f858b), GUN = vm("plastic", 0x202327), GLASS = vm("glass", 0x1a2530);
    const RUB = vm("tire", 0x14161a), RIM = vm("rim", 0x9aa0a8), STORE = cm(0x5a6048), K = B.main;
    K.add(loft([
      { z: 5.55, y: 1.62, w: 0.05, t: 0.05, b: 0.05 }, { z: 5.15, y: 1.66, w: 0.38, t: 0.44, b: 0.30, p: 2.2 },
      { z: 4.3, y: 1.62, w: 0.50, t: 0.56, b: 0.40, p: 2.3 }, { z: 3.0, y: 1.56, w: 0.45, t: 0.45, b: 0.42, p: 2.4 },
      { z: 0.5, y: 1.55, w: 0.42, t: 0.42, b: 0.40, p: 2.4 }, { z: -2.5, y: 1.60, w: 0.34, t: 0.34, b: 0.32, p: 2.2 },
      { z: -4.4, y: 1.62, w: 0.22, t: 0.22, b: 0.20 }, { z: -5.0, y: 1.62, w: 0.13, t: 0.13, b: 0.13 },
    ], { n: 18 }), SK);
    const w = wing([{ x: 0.2, le: 0.75, c: 1.3, tc: 0.15, y: 1.88 }, { x: 3.0, le: 0.7, c: 1.1, tc: 0.14, y: 1.92 }, { x: 10.05, le: 0.45, c: 0.55, tc: 0.12, y: 2.05 }], { K: 6 });
    K.add([w, mir(w)], SK);
    // V-tail (45°) + ventral fin
    const vt = wing([{ x: 0, le: -3.2, c: 1.25, tc: 0.1 }, { x: 2.3, le: -3.9, c: 0.62, tc: 0.08 }], { K: 4 });
    K.add(xf(vt.clone(), 0.12, 1.72, 0, 0, 0, 45 * DEG), SKD).add(mir(xf(vt.clone(), 0.12, 1.72, 0, 0, 0, 45 * DEG)), SKD);
    K.add(xf(wing([{ x: 0, le: -3.3, c: 1.0, tc: 0.1 }, { x: 0.9, le: -3.6, c: 0.6, tc: 0.08 }], { K: 4 }), 0, 1.35, 0, 0, 0, -Math.PI / 2), SKD);
    // sensor ball
    K.add(xf(cylZ(0.08, 0.08, 0.3, 8), 0, 1.08, 4.3, -Math.PI / 2), GUN).add(xf(sph(0.25, 14, 10), 0, 0.84, 4.3), SKD);
    K.add(xf(box(0.16, 0.12, 0.04), 0, 0.84, 4.54), GLASS);
    // pusher prop (spins about Z)
    const prop = B.node("prop0", 0, 1.62, -5.12); B.ud.milAir.props.push("prop0");
    const PK = B.kit(prop);
    PK.add(loft([rnd(-4.95, 0.13, 1.62), rnd(-5.3, 0.1, 1.62), rnd(-5.55, 0.01, 1.62)], { n: 10 }), SKD);
    for (let i = 0; i < 3; i++) {
      const bl = xf(wing([{ x: 0.12, le: 0.12, c: 0.26, tc: 0.1 }, { x: 1.2, le: 0.06, c: 0.14, tc: 0.08 }], { K: 3 }), 0, 0, 0, 1.2);   // blade pitch
      PK.add(xf(bl, 0, 1.62, -5.15, 0, 0, i * TAU / 3), GUN);
    }
    // hardpoints
    [-1, 1].forEach(function (s) {
      K.add(pylon(s * 2.6, 1.8, 1.55, 0.6, 0.8), SKD).add(pylon(s * 4.4, 1.82, 1.6, 0.55, 0.7), SKD);
      K.add(missile(1.63, 0.089).map(function (g) { return xf(g, s * 2.6, 1.42, 0.2); }), STORE);
      K.add(bomb(3.3, 0.19).map(function (g) { return xf(g, s * 4.4, 1.36, 0.1); }), cm(0x6b7058));
    });
    // gear
    {
      const mw = wheel(0.24, 0.13), nw = wheel(0.2, 0.11);
      K.add(rod([0, 1.2, 4.2], [0, 0.2, 4.25], 0.045), SKD).add(xf(nw.tire, 0, 0.2, 4.25), RUB).add(xf(nw.hub, 0, 0.2, 4.25), RIM);
      [-1, 1].forEach(function (s) {
        K.add(rod([s * 0.3, 1.2, 0.2], [s * 1.25, 0.24, 0.1], 0.05), SKD);
        K.add(xf(mw.tire, s * 1.3, 0.24, 0.1), RUB).add(xf(mw.hub, s * 1.3, 0.24, 0.1), RIM);
      });
    }
    navLights(B, [[10.05, 2.05, 0.2, RED], [-10.05, 2.05, 0.2, GREEN], [0, 2.02, -4.1, WHITE]]);
    B.ud.drone = true;
    return B.finish({ family: "MQ-9-class", length: 11.1, span: 20.1, height: 3.3 });
  };

  // =====================================================================
  //  7. HEAVY BOMBER — B-52H Stratofortress.
  // =====================================================================
  /* THE HEAVY BOMBER IS A B-52H (2026-10-09). Every menu, the war room and
     the arsenal call this airframe "B-52" — and it was a B-1 (swing wing,
     four engines in two boxes, a cruciform tail, 41.7 m span). Nothing about
     that silhouette says Stratofortress, so it is rebuilt from the B-52H's
     own numbers: 48.5 m long, 56.4 m span, 12.4 m to the fin tip; a long
     slab-sided fuselage; a shoulder wing swept 35° that droops on the ground
     until the tip outriggers carry it; EIGHT engines in four twin pods on
     pylons ahead of the leading edge; the tall fin; bicycle main gear (four
     two-wheel trucks under the fuselage) and the 700-gal tip tanks. */
  BUILDERS.bomber = function () {
    const B = new Build("bomber");
    const SK = cm(0x50565d), SKD = cm(0x3d4247), GLASS = vm("glass", 0x1d2833);
    const TRIM = vm("interior", 0x0d0e10), RUB = vm("tire", 0x14161a), RIM = vm("rim", 0x9aa0a8), DUCT = cm(0x121417), GEARM = cm(0xb9bdc4);
    const NOSE = cm(0x3b3f44);
    const K = B.main;
    // fuselage: z, half-width, top, bottom, centre y, superellipse
    const FUS = [
      [ 24.2, 0.06, 0.06, 0.06, 3.05, 2.0],
      [ 23.5, 0.72, 0.78, 0.70, 3.05, 2.2],
      [ 22.0, 1.22, 1.30, 1.15, 3.10, 2.6],
      [ 20.2, 1.45, 1.72, 1.45, 3.15, 2.9],
      [ 18.2, 1.52, 1.98, 1.62, 3.15, 3.0],
      [ 15.0, 1.52, 1.90, 1.78, 3.08, 3.2],
      [  6.0, 1.52, 1.86, 1.82, 3.02, 3.4],
      [ -5.0, 1.52, 1.86, 1.82, 3.02, 3.4],
      [-12.0, 1.42, 1.80, 1.45, 3.20, 3.2],
      [-18.0, 1.10, 1.60, 0.95, 3.62, 3.0],
      [-22.6, 0.58, 1.10, 0.50, 4.10, 2.6],
      [-23.9, 0.12, 0.30, 0.12, 4.40, 2.0],
    ].map(function (r) { return { z: r[0], w: r[1], t: r[2], b: r[3], y: r[4], p: r[5] }; });
    const parts = loft(FUS, {
      n: 28, split: function (z, th) {
        const s = Math.sin(th), c = Math.cos(th);
        if (z > 19.0 && z < 20.6) return s > 0.42 && Math.abs(c) > 0.06;           // the windscreen band
        if (z > 17.4 && z < 18.6) return s > 0.25 && s < 0.62;                       // side windows
        return false;
      },
    });
    K.add(parts[0], SK); if (parts[1]) K.add(parts[1], GLASS);
    K.add(loft([rnd(24.25, 0.06, 3.05), rnd(23.3, 0.76, 3.05), rnd(22.6, 1.0, 3.07)], { n: 20, caps: false }), NOSE);   // the radome
    // the flight deck behind the glass: two seats abreast, glareshield
    K.add(loft(FUS.slice(3, 5).map(function (s) { return { z: s.z, w: s.w - 0.08, t: s.t - 0.08, b: s.b - 0.08, y: s.y, p: s.p }; }), { n: 28, flipped: true, caps: false }), TRIM);
    [[-0.6, 18.9], [0.6, 18.9]].forEach(function (c) {
      K.add(xf(box(0.56, 0.12, 0.56), c[0], 3.95, c[1]), TRIM).add(xf(box(0.56, 0.86, 0.14), c[0], 4.38, c[1] - 0.34, 0.12), TRIM);
    });
    K.add(xf(box(2.2, 0.3, 0.3), 0, 4.55, 20.0, -0.4), TRIM);
    // THE WING: shoulder-mounted, 35° at the quarter chord, drooping to the
    // outriggers. Root on top of the fuselage, tip 1.8 m lower.
    const WY = 4.78;
    const le = function (x) { return 6.4 - (x - 1.5) * 0.735; };
    const wy = function (x) { return WY - 1.75 * Math.pow(Math.max(0, x - 1.5) / 26.7, 1.6); };
    const WS = [1.5, 6, 10.5, 15, 19.5, 24, 28.2].map(function (x) {
      const c = 11.6 - (x - 1.5) * (11.6 - 3.7) / 26.7;
      return { x: x, le: le(x), c: c, tc: 0.105 - 0.03 * (x - 1.5) / 26.7, y: wy(x) };
    });
    const wg = wing(WS, { K: 7 });
    K.add([wg, mir(wg)], SK);
    // EIGHT ENGINES, FOUR PODS. Each pod is two nacelles side by side under a
    // shared pylon, slung ahead of and below the leading edge.
    [9.6, 18.4].forEach(function (px) {
      const y = wy(px) - 1.75, zf = le(px) + 3.6, zb = zf - 6.6;
      [-1, 1].forEach(function (s) {
        [-0.66, 0.66].forEach(function (dx) {
          const x = s * px + dx;
          const N = [rnd(zf, 0.62, y, x), rnd(zf - 0.6, 0.68, y, x), rnd(zf - 3.6, 0.66, y, x), rnd(zb + 0.7, 0.55, y, x), rnd(zb, 0.42, y, x)];
          K.add(loft(N, { n: 18, capFront: false, capBack: false }), SK);
          K.add(annulus(rnd(zf, 0.62, y, x), rnd(zf, 0.5, y, x), 18, [0, 0, 1]), SKD);
          K.add(loft([rnd(zf, 0.5, y, x), rnd(zf - 0.9, 0.46, y, x)], { n: 18, caps: false, flipped: true }), DUCT);
          K.add(xf(new THREE.CircleGeometry(0.46, 18), x, y, zf - 0.9), DUCT);
          K.add(xf(new THREE.CircleGeometry(0.42, 16), x, y, zb + 0.01, 0, Math.PI), DUCT);
          K.add(xf(new THREE.CircleGeometry(0.30, 14), x, y, zb + 0.02, 0, Math.PI), cm(0x2a1d16));
        });
        // the pylon: a swept blade from the pod's back to the wing's underside
        const pl = wing([{ x: 0, le: zf - 2.2, c: 5.2, tc: 0.12 }, { x: 1.45, le: le(px) - 0.4, c: 5.6, tc: 0.12 }], { K: 4 });
        K.add(xf(pl, s * px, y + 0.4, 0, 0, 0, Math.PI / 2), SKD);
      });
    });
    // 700-gal external tanks, outboard of the outer pods
    [-1, 1].forEach(function (s) {
      const x = s * 23.2, y = wy(23.2) - 0.75, z0 = le(23.2) - 0.2;
      K.add(loft([rnd(z0 + 0.2, 0.05, y, x), rnd(z0 - 0.6, 0.42, y, x), rnd(z0 - 3.6, 0.48, y, x), rnd(z0 - 6.4, 0.25, y, x), rnd(z0 - 7.2, 0.04, y, x)], { n: 14 }), SK);
      K.add(xf(box(0.12, 0.5, 2.6), x, y + 0.45, z0 - 3.4), SKD);
    });
    // TAIL: the tall swept fin (12.4 m to the tip) and the low stabiliser
    K.add(xf(wing([{ x: 0, le: -12.8, c: 10.8, tc: 0.08 }, { x: 7.6, le: -19.6, c: 3.8, tc: 0.07 }], { K: 6 }), 0, 4.8, 0, 0, 0, Math.PI / 2), SK);
    const hs = wing([{ x: 0.9, le: -16.6, c: 6.6, tc: 0.08, y: 4.25 }, { x: 8.4, le: -21.4, c: 2.4, tc: 0.07, y: 4.35 }], { K: 5 });
    K.add([hs, mir(hs)], SK);
    // the ECM / tail-cone fairing and the antennae ahead of the fin
    K.add(loft([rnd(-22.8, 0.42, 4.25), rnd(-23.9, 0.18, 4.3), rnd(-24.2, 0.04, 4.3)], { n: 12 }), NOSE);
    K.add(xf(box(0.06, 0.5, 0.9), 0, 5.2, 9.0), SKD).add(xf(box(0.06, 0.4, 0.7), 0, 5.15, -2.0), SKD);
    // bomb bay doors on the belly, between the main gear trucks
    K.add(xf(box(1.0, 0.05, 8.6), -0.52, 1.215, 2.5), SKD).add(xf(box(1.0, 0.05, 8.6), 0.52, 1.215, 2.5), SKD);
    // ---- GEAR: bicycle trucks under the fuselage + wingtip outriggers ----
    const gear = B.node("gear"); B.refs.gear = "gear";
    const GK = B.kit(gear);
    [10.6, -7.8].forEach(function (gz) {
      [-1, 1].forEach(function (s) {
        const gx = s * 0.95;
        GK.add(rod([gx, 1.45, gz], [gx, 0.56, gz], 0.13), GEARM);
        GK.add(xf(box(0.22, 0.2, 2.0), gx, 0.56, gz), GEARM);
        [-0.62, 0.62].forEach(function (dz) {
          const w = wheel(0.56, 0.36);
          GK.add(xf(w.tire, gx + s * 0.24, 0.56, gz + dz), RUB).add(xf(w.hub, gx + s * 0.24, 0.56, gz + dz), RIM);
        });
        GK.add(xf(box(0.04, 0.85, 2.4), s * 1.42, 1.0, gz), SKD);     // the truck doors, hanging open
      });
    });
    [-1, 1].forEach(function (s) {
      const x = s * 24.6, yb = wy(24.6) - 0.25, z = le(24.6) - 2.0;
      GK.add(rod([x, yb, z], [x, 0.36, z - 0.15], 0.07), GEARM);
      const w = wheel(0.36, 0.2);
      GK.add(xf(w.tire, x, 0.36, z - 0.15), RUB).add(xf(w.hub, x, 0.36, z - 0.15), RIM);
    });
    navLights(B, [[28.2, wy(28.2), le(28.2) - 1.8, RED], [-28.2, wy(28.2), le(28.2) - 1.8, GREEN], [0, 12.35, -20.6, WHITE]]);
    muzzleNode(B, 0, 3.05, 24.4);
    B.ud.cabin = { seats: [
      { id: "seat-captain", role: "pilot", cockpit: true, x: -0.6, y: 4.0, z: 18.9 },
      { id: "seat-firstofficer", role: "copilot", cockpit: true, x: 0.6, y: 4.0, z: 18.9 },
    ] };
    B.ud.cockpitClass = "bomber";
    return B.finish({ family: "B-52-class", length: 48.5, span: 56.4, height: 12.4, bodyW: 6.0, bodyL: 48.5 });
  };

  // =====================================================================
  //  8. RUNTIME
  // =====================================================================
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  CBZ.milAirDrive = function (g, s, dt) {
    const rt = g && g._milRt;
    if (!rt) return false;
    dt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    s = s || {};
    const rz = g.rotation.z, rx = g.rotation.x, ry = g.rotation.y;
    if (rt.r0 == null) { rt.r0 = rz; rt.p0 = rx; rt.h0 = ry; }
    let dh = ry - rt.h0; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const k = Math.min(1, dt * 6);
    rt.cr += (clamp((rz - rt.r0) / dt * 1.5, -1, 1) - rt.cr) * k;      // roll-right rate
    rt.cp += (clamp(-(rx - rt.p0) / dt * 2.0, -1, 1) - rt.cp) * k;     // nose-up rate
    rt.cy += (clamp(dh / dt * 2.0, -1, 1) - rt.cy) * k;                 // yaw-left rate
    rt.r0 = rz; rt.p0 = rx; rt.h0 = ry;
    for (let i = 0; i < rt.surf.length; i++) {
      const S = rt.surf[i];
      let d = 0;
      if (S.role === "ail") d = -S.max * rt.cr;
      else if (S.role === "stab") d = S.side * S.max * rt.cp - S.max * 0.35 * rt.cr;
      else if (S.role === "rud") d = -S.max * rt.cy;
      S.node.rotation.x = d;
    }
    const thr = clamp(s.thr != null ? s.thr : 0, 0, 1);
    if (rt.glow) {
      const h = thr * thr;
      rt.glow.color.setRGB(0.08 + 0.92 * h, 0.05 + 0.45 * h * h, 0.03 + 0.12 * h * h * h);
    }
    for (let i = 0; i < rt.props.length; i++) rt.props[i].rotation.z += dt * (4 + 70 * thr);
    if (s.agl != null && rt.gear) rt.gear.visible = s.agl < 9;
    return true;
  };
  const _aim = new THREE.Vector3(), _inv = new THREE.Matrix4();
  CBZ.milAirAim = function (g, x, y, z, dt) {
    const cg = g && g.userData && g.userData.chinGun;
    if (!cg) return false;
    const rt = g._milRt; if (!rt) return false;
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
  CBZ.milAirPoint = function (g, key, i, out) {
    const ud = g && g.userData; if (!ud) return null;
    out = out || new THREE.Vector3();
    if (key === "gun") {
      const m = ud.chinMuzzle; if (!m || !m.isObject3D) return null;
      g.updateMatrixWorld(true);
      return out.setFromMatrixPosition(m.matrixWorld);
    }
    const L = ud.launchLocal; if (!L || !L.length) return null;
    const p = L[((i | 0) % L.length + L.length) % L.length];
    g.updateMatrixWorld(true);
    return out.set(p[0], p[1], p[2]).applyMatrix4(g.matrixWorld);
  };

  CBZ.milAir = {
    make: instance,
    types: function () { return Object.keys(BUILDERS); },
    // the kit, for the other airframes (the cargo lifter's hold) and checks
    kit: { loft: loft, wing: wing, annulus: annulus, planAt: planAt, xf: xf, xm: xm, mir: mir, box: box, cylX: cylX, cylZ: cylZ,
      sph: sph, rod: rod, wheel: wheel, rnd: rnd, merge: merge, mergeStatic: mergeStatic, Kit: Kit, Build: Build, missile: missile, bomb: bomb, pod: pod, pylon: pylon,
      navLights: navLights, lamp: lamp, cm: cm, vm: vm },
    // register another airframe on the same template cache (island_military's cargo lifter)
    define: function (type, fn) { BUILDERS[type] = fn; },
    models: {
      fighter: function () { return instance("fighter"); },
      attackHeli: function () { return instance("attackHeli"); },
      utilityHeli: function () { return instance("utilityHeli"); },
      drone: function () { return instance("drone"); },
      bomber: function () { return instance("bomber"); },
    },
  };
})();
