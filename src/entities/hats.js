/* ============================================================
   entities/hats.js — THE HAT LIBRARY (CBZ.hats).

   Owner (2026-11-02), for Stick City: "the only thing is hats — bandana,
   police hat, general hat etc etc ... this is also a chance to redo and
   improve and add many many hats to the game."

   Every hat here is procedural, built ONCE per (kind, colourway, detail) into
   ONE merged BufferGeometry with per-vertex colour, drawn with ONE shared
   vertex-coloured material. So a hat is one draw call on a rig, pools in
   entities/pedinstance.js like any rigid part, and can be baked into the GPU
   crowd (entities/crowdgpu.js) as gear.

   THE FRAME. A hat is authored on a UNIT HEAD: a sphere of radius 1 centred
   at the origin, +Y up, +Z the way the face looks (the rig faces +Z). A caller
   seats it by putting the mesh at the head's centre and scaling it by the
   head's radius. Nothing here knows about any body, so the realistic people
   can adopt it later with a head-centre + radius of their own.

   PUBLIC  CBZ.hats = {
     ids()                     every kind id, in catalogue order
     info(id)                  {id, name, group, colorways, tags, ...} or null
     geometry(id, opts)        cached merged geometry. opts: {cw: index | {a,b,c}, lod: 0 near | 1 far}
     split(id, opts)           {main, detail}: main = the 'a' parts with NO colour attribute
                               (a host tints it), detail = the rest, vertex coloured
     material()                the one shared hat material (vertexColors)
     mesh(id, opts)            a THREE.Mesh on the shared geometry + material
     pick(list, h)             a deterministic pick from a list by a 32-bit hash
     colorOf(id, cw)           the colourway record {a, b, c}
     audit()                   counts (kinds, cached geometries, verts)
   }

   Colour keys in a part: 'a' primary, 'b' secondary, 'c' trim, or a literal
   hex. A colourway is {a, b, c}; geometry(id, {cw: {a: 0xff0000}}) overrides
   the default colourway's keys (a gang's bandana in its own colour).
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE || CBZ.hats) return;

  const TAU = Math.PI * 2;
  const V3 = THREE.Vector3, V2 = THREE.Vector2;

  /* ---------------------------------------------------------------- helpers
     Every builder gets a kit `K` bound to one detail level. Each primitive
     returns a geometry; `K.put(g, colourKey, xf)` files it as a part. xf is
     {p:[x,y,z], r:[x,y,z] (Euler XYZ), s: n | [x,y,z]} applied scale, rotate,
     translate. */
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new V3(), _p = new V3();
  function xform(g, xf) {
    if (!xf) return g;
    const s = xf.s == null ? 1 : xf.s;
    if (Array.isArray(s)) _s.set(s[0], s[1], s[2]); else _s.set(s, s, s);
    const r = xf.r || [0, 0, 0];
    _e.set(r[0], r[1], r[2], xf.o || "XYZ"); _q.setFromEuler(_e);
    const p = xf.p || [0, 0, 0]; _p.set(p[0], p[1], p[2]);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    return g;
  }
  // per-vertex deformation; normals recomputed (smooth if indexed)
  const _v = new V3();
  function deform(g, fn) {
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      _v.set(P.getX(i), P.getY(i), P.getZ(i));
      fn(_v, i);
      P.setXYZ(i, _v.x, _v.y, _v.z);
    }
    P.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }
  function azi(v) { return Math.atan2(v.x, v.z); }   // 0 = front (+Z), +pi/2 = +X

  function kit(lod) {
    const far = lod >= 1;
    // lod 2: the GPU crowd (every instance pays every vertex of every hat it might wear)
    const S = function (n) { return lod >= 2 ? Math.max(5, Math.round(n * 0.3)) : far ? Math.max(6, Math.round(n * 0.5)) : n; };
    const parts = [];
    const K = {
      far: far, S: S, parts: parts,
      put: function (g, c, xf) { if (g) parts.push({ g: xform(g, xf), c: c }); return g; },
      // revolve a profile [[r, y], ...] round +Y (phi 0 = front)
      lathe: function (pts, o) {
        o = o || {};
        const v = pts.map(function (p) { return new V2(Math.max(0, p[0]), p[1]); });
        return new THREE.LatheGeometry(v, o.segs || S(o.n || 28), o.phi0 || 0, o.phiL == null ? TAU : o.phiL);
      },
      // a sphere cap from the top (theta 0) down to theta t1
      sphere: function (r, o) {
        o = o || {};
        return new THREE.SphereGeometry(r, o.ws || S(o.n || 24), o.hs || S(o.m || 14), o.p0 || 0, o.pL == null ? TAU : o.pL, o.t0 || 0, o.tL == null ? Math.PI : o.tL);
      },
      // a dome of radius r whose open rim sits at height y0
      dome: function (r, y0, o) {
        o = o || {};
        const t = Math.acos(Math.max(-1, Math.min(1, y0 / r)));
        return new THREE.SphereGeometry(r, S(o.n || 26), S(o.m || 12), 0, TAU, 0, t);
      },
      cyl: function (rt, rb, h, o) {
        o = o || {};
        return new THREE.CylinderGeometry(rt, rb, h, o.segs || S(o.n || 24), o.hs || 1, !!o.open, o.t0 || 0, o.tL == null ? TAU : o.tL);
      },
      torus: function (R, r, o) {
        o = o || {};
        return new THREE.TorusGeometry(R, r, o.rs || S(o.m || 8), o.ts || S(o.n || 32), o.arc == null ? TAU : o.arc);
      },
      box: function (w, h, d, sx, sy, sz) { return new THREE.BoxGeometry(w, h, d, sx || 1, sy || 1, sz || 1); },
      cone: function (r, h, o) { o = o || {}; return new THREE.ConeGeometry(r, h, o.segs || S(o.n || 20), 1, !!o.open); },
      ball: function (r, n) { return new THREE.SphereGeometry(r, S(n || 12), S(Math.max(6, (n || 12) * 0.7 | 0))); },
      // a tube through points [[x,y,z],...]; r a number or fn(t)
      tube: function (pts, r, o) {
        o = o || {};
        const curve = new THREE.CatmullRomCurve3(pts.map(function (p) { return new V3(p[0], p[1], p[2]); }));
        const ts = o.ts || S(o.n || 16), rs = o.rs || S(o.m || 8);
        const g = new THREE.TubeGeometry(curve, ts, typeof r === "number" ? r : 1, rs, !!o.closed);
        if (typeof r === "function") {
          // taper: scale each ring about its centre point
          const P = g.attributes.position, per = rs + 1;
          for (let i = 0; i <= ts; i++) {
            const c = curve.getPointAt(i / ts), k = r(i / ts);
            for (let j = 0; j < per; j++) {
              const idx = i * per + j;
              P.setXYZ(idx, c.x + (P.getX(idx) - c.x) * k, c.y + (P.getY(idx) - c.y) * k, c.z + (P.getZ(idx) - c.z) * k);
            }
          }
          g.computeVertexNormals();
        }
        return g;
      },
      // a flat plate in the XZ plane (outline [[x, z], ...]), `t` thick, top at y = 0
      plate: function (outline, t) {
        const sh = new THREE.Shape();
        sh.moveTo(outline[0][0], -outline[0][1]);
        for (let i = 1; i < outline.length; i++) sh.lineTo(outline[i][0], -outline[i][1]);
        const g = new THREE.ExtrudeGeometry(sh, { depth: t || 0.05, bevelEnabled: false, curveSegments: 4 });
        g.rotateX(-Math.PI / 2);          // shape XY -> XZ (shape y = -z), extrude along +Y
        g.translate(0, -(t || 0.05), 0);
        return g;
      },
      // A CURVED VISOR: the peak of a cap. A grid (not an extrusion) so it
      // bends cleanly: width w at the crown edge, reaching `len` forward from
      // the band at z0, drooping `droop` at the tip and curving `curve` down
      // at its sides. Two-sided (top and underside both drawn).
      visor: function (o) {
        o = o || {};
        const w = o.w || 1.5, len = o.len || 0.75, z0 = o.z0 == null ? 0.82 : o.z0, y0 = o.y == null ? 0.22 : o.y;
        const droop = o.droop == null ? 0.16 : o.droop, curve = o.curve == null ? 0.22 : o.curve, t = o.t || 0.045;
        const nu = far ? 6 : 12, nv = far ? 3 : 6;
        const pos = [], idx = [];
        // the inner edge follows the crown (an arc), the outer is a rounded tip
        function pt(u, v, top) {
          const half = w / 2 * Math.sqrt(Math.max(0, 1 - Math.pow(v, 2.4) * 0.55));
          const x = u * half;
          const inner = z0 - (1 - Math.sqrt(Math.max(0, 1 - Math.pow(u * w / 2 / 1.08, 2)))) * 0.9;
          const z = inner + v * (len + 0.18 * (1 - u * u)) * (o.round === false ? 1 : (1 - 0.18 * u * u));
          const y = y0 - droop * v * v - curve * u * u * (0.3 + 0.7 * v) - (top ? 0 : t);
          return [x, y, z];
        }
        for (let s = 0; s < 2; s++) for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
          const p = pt(-1 + 2 * i / nu, j / nv, s === 0); pos.push(p[0], p[1], p[2]);
        }
        const row = nv + 1, half = (nu + 1) * row;
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
          const a = i * row + j, b = (i + 1) * row + j, c = b + 1, d = a + 1;
          idx.push(a, d, b, b, d, c);                           // top faces up
          idx.push(half + a, half + b, half + d, half + b, half + c, half + d);   // underside faces down
        }
        // the rim (outer edge + sides) so it has thickness
        for (let i = 0; i < nu; i++) { const a = i * row + nv, b = (i + 1) * row + nv; idx.push(a, b, half + a, b, half + b, half + a); }
        for (let j = 0; j < nv; j++) {
          const a = j, b = j + 1; idx.push(a, half + a, b, b, half + a, half + b);
          const c = nu * row + j, d = c + 1; idx.push(c, d, half + c, d, half + d, half + c);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
      },
      // A FITTED SHELL: cloth or a shell ON the ball (radius r), from the
      // crown down to an edge whose height edgeY(phi) varies round the head
      // (phi 0 = the front). Snug by construction: every vertex is on r.
      shell: function (r, edgeY, o) {
        o = o || {};
        const n = S(o.n || 36), m = far ? 6 : (o.m || 12);
        const pos = [], idx = [];
        for (let i = 0; i <= n; i++) {
          const ph = i / n * TAU, te = Math.acos(Math.max(-0.999, Math.min(0.999, edgeY(ph) / r)));
          for (let j = 0; j <= m; j++) {
            const th = te * j / m;
            pos.push(r * Math.sin(th) * Math.sin(ph), r * Math.cos(th), r * Math.sin(th) * Math.cos(ph));
          }
        }
        const row = m + 1;
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
          const a = i * row + j, b = (i + 1) * row + j;
          idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        // the crown's pole and the seam share one normal (straight out)
        const P = g.attributes.position, N = g.attributes.normal;
        for (let k = 0; k < P.count; k++) { const x = P.getX(k), y = P.getY(k), z = P.getZ(k), l = Math.hypot(x, y, z) || 1; N.setXYZ(k, x / l, y / l, z / l); }
        return g;
      },
      // a point ON the skull: azimuth phi (0 = front), height y, `off` proud of the ball
      onHead: function (ph, y, off) { const rr = Math.sqrt(Math.max(0, 1 - y * y)) + (off || 0); return [Math.sin(ph) * rr, y, Math.cos(ph) * rr]; },
      // A RIBBON: a flat strip of cloth along a path, `w` wide (fn of t or a
      // number), lying across `side` (default x). Drawn both sides.
      ribbon: function (pts, w, o) {
        o = o || {};
        const curve = new THREE.CatmullRomCurve3(pts.map(function (p) { return new V3(p[0], p[1], p[2]); }));
        const n = S(o.n || 14), pos = [], idx = [];
        const side = new V3(1, 0, 0);
        for (let i = 0; i <= n; i++) {
          const t = i / n, c = curve.getPointAt(t), ww = (typeof w === "function" ? w(t) : w) / 2;
          pos.push(c.x - side.x * ww, c.y, c.z, c.x + side.x * ww, c.y, c.z);
        }
        for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
      },
      // a BRIM: a ring from r0 to r1 at height y, `t` thick; shape(phi, k) -> dy
      // bends it (k = 0 at the crown edge .. 1 at the rim); rx/rz stretch it
      brim: function (r0, r1, y, o) {
        o = o || {};
        const t = o.t || 0.05, n = S(o.n || 40), m = far ? 3 : (o.m || 6);
        const rx = o.rx || 1, rz = o.rz || 1, sh = o.shape;
        const pos = [], idx = [];
        for (let s = 0; s < 2; s++) for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
          const ph = i / n * TAU, k = j / m, r = r0 + (r1 - r0) * k;
          const x = Math.sin(ph) * r * rx, z = Math.cos(ph) * r * rz;
          const dy = sh ? sh(ph, k, x, z) : 0;
          pos.push(x, y + dy - (s ? t : 0), z);
        }
        const row = m + 1, half = (n + 1) * row;
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
          const a = i * row + j, b = (i + 1) * row + j, c = b + 1, d = a + 1;
          idx.push(a, b, d, b, c, d);
          idx.push(half + a, half + d, half + b, half + b, half + d, half + c);
        }
        for (let i = 0; i < n; i++) {                           // outer and inner edges
          const a = i * row + m, b = (i + 1) * row + m; idx.push(a, half + a, b, b, half + a, half + b);
          const c = i * row, d = (i + 1) * row; idx.push(c, d, half + c, d, half + d, half + c);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
      },
    };
    return K;
  }

  /* ---------------------------------------------------------------- palette
     Colours are written the way the rest of this codebase writes them (hex
     straight into a colour, renderer output sRGB). */
  const C = {
    black: 0x15161a, white: 0xeceae4, navy: 0x1b2a4a, police: 0x14213d, silver: 0xc9ccd2, gold: 0xe0b440,
    olive: 0x4b5a32, khaki: 0xb59f72, tan: 0xc9a46b, brown: 0x6b4428, darkbrown: 0x3d2716, red: 0xc0282d,
    maroon: 0x6e1c2a, orange: 0xe8741e, yellow: 0xf0c419, grey: 0x7a7d84, charcoal: 0x30333a, blue: 0x2f6bd6,
    sky: 0x6fb6e6, green: 0x2f8a4a, teal: 0x1aa39a, pink: 0xe86aa6, purple: 0x6a3fa0, cream: 0xe9dcc0,
    straw: 0xdcc07a, steel: 0x8b9099, hivis: 0xd6ef2a, scarlet: 0xd6221e, ivory: 0xf3eedf, plum: 0x7a2f6a,
  };

  /* ---------------------------------------------------------------- the catalogue
     group: law | military | work | street | formal | sport | travel | fun.
     Each build(K) files parts with colour keys. `seat` (optional) lifts or
     tilts the whole hat when seated. */
  const CAT = [];
  const BY = Object.create(null);
  function def(id, name, group, colorways, build, extra) {
    const d = Object.assign({ id: id, name: name, group: group, colorways: colorways, build: build }, extra || {});
    CAT.push(d); BY[id] = d;
    return d;
  }
  const cw = function (a, b, c) { return { a: a, b: b != null ? b : a, c: c != null ? c : (b != null ? b : a) }; };

  // a cap crown: the dome every ball cap shares, tilted so the back sits low
  function capCrown(K, o) {
    o = o || {};
    const r = o.r || 1.07, y0 = o.y0 == null ? 0.12 : o.y0, tilt = o.tilt == null ? -0.22 : o.tilt;
    const g = K.dome(r, y0, { n: 28, m: 12 });
    if (o.flatten) deform(g, function (v) { if (v.y > 0.5) v.y = 0.5 + (v.y - 0.5) * o.flatten; });
    if (o.front) deform(g, function (v) { if (v.z > 0) { const k = v.z / r; v.y += o.front * k * Math.max(0, v.y - y0) ; } });
    K.put(g, o.c || "a", { r: [tilt, 0, 0], p: [0, o.dy || 0, o.dz || 0] });
    if (o.button !== false) K.put(K.ball(0.085, 10), o.bc || o.c || "a", { p: [0, (o.dy || 0) + r * Math.cos(Math.abs(tilt)) - 0.01, (o.dz || 0) - r * Math.sin(tilt)] });
    return tilt;
  }
  // a peaked (service) cap: band, a crown that flares to a flat top, a peak
  function peaked(K, o) {
    o = o || {};
    const top = o.top || 1.26, bandR = 1.04, y0 = 0.16, y1 = 0.48, yt = o.yt || 0.86;
    const crown = K.lathe([[bandR * 0.99, y1 - 0.02], [bandR * 1.03, y1 + 0.12], [top * 0.96, yt - 0.06], [top, yt - 0.02], [top * 0.95, yt + 0.02], [top * 0.6, yt + 0.05], [0, yt + 0.06]], { n: 34 });
    // the crown rides high at the front (the wire stiffens it into a saddle)
    deform(crown, function (v) { const a = azi(v), f = Math.cos(a); v.y += (o.saddle == null ? 0.10 : o.saddle) * Math.max(0, f) * Math.max(0, (v.y - y1) / (yt - y1)); });
    K.put(crown, o.crown || "a", { r: [-0.06, 0, 0] });
    K.put(K.cyl(bandR, bandR, y1 - y0, { n: 34, open: true }), o.band || "b", { p: [0, (y0 + y1) / 2, 0], r: [-0.06, 0, 0] });
    K.put(K.visor({ w: 1.55, len: o.peakLen || 0.62, z0: 0.86, y: y0 + 0.05, droop: 0.24, curve: 0.12, t: 0.04 }), o.peak || "b", { r: [-0.06, 0, 0] });
    if (o.cord) K.put(K.tube([[-0.82, y0 + 0.13, 0.62], [-0.4, y0 + 0.11, 0.95], [0, y0 + 0.10, 1.05], [0.4, y0 + 0.11, 0.95], [0.82, y0 + 0.13, 0.62]], 0.035, { n: 16 }), o.cord, { r: [-0.06, 0, 0] });
    return { y0: y0, y1: y1, yt: yt };
  }
  function badge(K, c, x, y, z, s, kind) {
    s = s || 1;
    let g;
    if (kind === "star") {
      const pts = [];
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, r = (i % 2 ? 0.07 : 0.16) * s; pts.push([Math.sin(a) * r, Math.cos(a) * r]); }
      g = K.plate(pts, 0.04);
      g.rotateX(Math.PI / 2);
    } else if (kind === "wings") {
      g = K.plate([[-0.34, 0.02], [-0.1, -0.05], [0, -0.09], [0.1, -0.05], [0.34, 0.02], [0.1, 0.05], [0, 0.03], [-0.1, 0.05]].map(function (p) { return [p[0] * s, p[1] * s * 1.5]; }), 0.04);
      g.rotateX(Math.PI / 2);
    } else if (kind === "cross") {
      const a = 0.05 * s, b = 0.16 * s;
      g = K.plate([[-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a], [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a]], 0.03);
      g.rotateX(Math.PI / 2);
    } else {
      // a shield
      g = K.plate([[0, -0.2], [0.13, -0.15], [0.15, 0.02], [0.08, 0.15], [0, 0.2], [-0.08, 0.15], [-0.15, 0.02], [-0.13, -0.15]].map(function (p) { return [p[0] * s, p[1] * s]; }), 0.04);
      g.rotateX(Math.PI / 2);
    }
    // the plate faces +Z; lean it back with the surface it sits on
    K.put(g, c, { p: [x, y, z], r: [-0.18, 0, 0] });
  }

  /* ===== STREET ===== */
  /* THE BANDANA, tied over the head: the cloth laid ON the skull (a fitted
     shell), its folded hem straight across the brow, the knot low at the back
     of the head and two tails falling from it. The gang colour is `a`. */
  def("bandana", "Bandana", "street", [cw(C.red, 0x7d1616, C.white), cw(C.blue, 0x153d82, C.white), cw(C.black, 0x050507, C.white), cw(C.green, 0x15502b, C.white), cw(C.purple, 0x3b2160, C.white)], function (K) {
    const edge = function (ph) { const c = Math.cos(ph); return c >= 0 ? 0.04 + 0.28 * Math.pow(c, 2) : 0.04 - 0.24 * Math.pow(-c, 1.4); };
    K.put(K.shell(1.04, edge, { n: 40, m: 12 }), "a");
    // the folded hem across the brow, round to the back
    const hem = [];
    for (let i = -12; i <= 12; i++) { const ph = i / 12 * 2.75; hem.push(K.onHead(ph, edge(ph) + 0.015, 0.06)); }
    K.put(K.tube(hem, 0.055, { n: 44, m: 6 }), "b", { s: [1, 0.8, 1] });
    // the print: a few paisley flecks in the trim colour
    [[0.5, 0.78], [-0.6, 0.7], [1.9, 0.62], [-2.2, 0.5], [0.05, 0.93], [2.8, 0.66]].forEach(function (q) { K.put(K.ball(0.055, 8), "c", { p: K.onHead(q[0], q[1], 0.045), s: [1, 0.5, 1] }); });
    // the knot and the two tails
    const kn = K.onHead(Math.PI, edge(Math.PI) + 0.02, 0.12);
    K.put(K.ball(0.15, 12), "a", { p: kn, s: [1.3, 0.9, 0.8] });
    for (const sx of [-1, 1]) K.put(K.ribbon([[kn[0] + sx * 0.05, kn[1] - 0.04, kn[2]], [sx * 0.2, kn[1] - 0.32, kn[2] + 0.04], [sx * 0.32, kn[1] - 0.62, kn[2] + 0.12]], function (t) { return 0.2 * (1 - 0.6 * t); }, { n: 8 }), "a");
  }, { fit: false, tags: ["gang"] });

  /* THE ROLLED BANDANA. A folded bandana rolled into a rope and tied round
     the head: snug ON the skull, across the forehead just above the brow,
     dipping a little at the back where the knot sits, two short tails. Every
     point is laid on the ball (K.onHead), so it can never float. */
  def("headband", "Rolled Bandana", "street", [cw(C.red, 0x7d1616), cw(C.blue, 0x153d82), cw(C.black, 0x2a2a30), cw(C.white, C.grey), cw(C.green, 0x15502b)], function (K) {
    const N = 24, ring = [];
    for (let i = 0; i < N; i++) { const ph = i / N * TAU; ring.push(K.onHead(ph, 0.3 + 0.07 * Math.cos(ph), 0.055)); }
    K.put(K.tube(ring, 0.105, { closed: true, n: 40, m: 8 }), "a", { s: [1, 0.8, 1] });
    // the paisley fleck of a print on the front
    K.put(K.ball(0.05, 8), "b", { p: K.onHead(0.35, 0.37, 0.13) });
    K.put(K.ball(0.04, 8), "b", { p: K.onHead(-0.45, 0.36, 0.13) });
    // the knot at the back and its two tails, laid against the skull and falling
    const kn = K.onHead(Math.PI, 0.22, 0.13);
    K.put(K.ball(0.16, 12), "a", { p: kn, s: [1.3, 0.95, 0.85] });
    for (const sx of [-1, 1]) {
      const p1 = K.onHead(Math.PI - sx * 0.2, 0.0, 0.08), p2 = K.onHead(Math.PI - sx * 0.34, -0.42, 0.07);
      K.put(K.ribbon([[kn[0] + sx * 0.06, kn[1] - 0.04, kn[2]], p1, p2], function (t) { return 0.2 * (1 - 0.5 * t); }, { n: 10 }), "a");
    }
  }, { fit: false, tags: ["gang", "sport"] });

  /* THE DURAG. A fitted cap of stretch cloth hugging the whole top and back
     of the head: its edge sits on the brow at the front, crosses above the
     ears and runs down to the nape at the back. The tie band goes across the
     forehead and round to the back; the long flap and the two ties hang down
     the back of the neck. */
  def("durag", "Durag", "street", [cw(C.black, 0x2a2a30), cw(C.navy, 0x2a3c66), cw(C.red, 0x8e1c1c), cw(0xc9b27a, 0x9c8656), cw(C.white, 0xc8c8c8), cw(C.purple, 0x3b2160)], function (K) {
    const edge = function (ph) { const c = Math.cos(ph); return c >= 0 ? 0.05 + 0.3 * Math.pow(c, 1.5) : 0.05 - 0.68 * Math.pow(-c, 1.25); };
    K.put(K.shell(1.035, edge, { n: 40, m: 14 }), "a");
    // the centre seam, front edge over the crown to the nape
    const seam = [];
    const bf = Math.acos(edge(0) / 1.05), bb = Math.acos(edge(Math.PI) / 1.05);
    for (let i = 0; i <= 16; i++) { const t = i / 16, be = bf - (bf + bb) * t; seam.push([0, Math.cos(be) * 1.05, Math.sin(be) * 1.05]); }
    K.put(K.tube(seam, 0.018, { n: 30, m: 5 }), "b");
    // the tie band: across the forehead on the edge, round the sides, down to the nape
    const band = [];
    for (let i = -10; i <= 10; i++) { const ph = i / 10 * 2.1; const y = Math.min(edge(ph), 0.33) + 0.02; band.push(K.onHead(ph, y, 0.05)); }
    const left = band.slice(0, 1)[0], right = band[band.length - 1];
    const knot = K.onHead(Math.PI, -0.5, 0.1);
    K.put(K.tube(band, 0.05, { n: 40, m: 6 }), "a", { s: [1, 0.85, 1] });
    for (const end of [left, right]) K.put(K.tube([end, K.onHead(Math.sign(end[0]) * 2.6, -0.32, 0.07), knot], 0.045, { n: 10, m: 5 }), "a");
    K.put(K.ball(0.09, 10), "a", { p: knot, s: [1.3, 0.8, 0.8] });
    // the flap: wide at the nape, hanging down the back of the neck
    const nape = K.onHead(Math.PI, edge(Math.PI) + 0.02, 0.03);
    K.put(K.ribbon([nape, [0, -0.95, -0.72], [0, -1.35, -0.52], [0, -1.7, -0.42]], function (t) { return 0.62 - 0.24 * t; }, { n: 14 }), "a");
    // and the two long ties, either side of it
    for (const sx of [-1, 1]) K.put(K.tube([knot, [sx * 0.16, -0.9, -0.82], [sx * 0.2, -1.3, -0.62], [sx * 0.22, -1.62, -0.5]], function (t) { return 0.04 * (1 - 0.3 * t); }, { n: 12, m: 5 }), "a", { s: [1, 1, 0.6] });
  }, { fit: false, tags: ["street", "gang"] });

  def("ballcap", "Baseball Cap", "street", [cw(C.red, C.red, C.white), cw(C.navy, C.navy, C.white), cw(C.black, C.black, C.red), cw(C.white, C.blue), cw(C.green, C.green, C.white), cw(C.grey, C.charcoal), cw(C.yellow, C.black), cw(C.sky, C.white)], function (K) {
    capCrown(K, { r: 1.07, y0: 0.1, tilt: -0.22 });
    K.put(K.visor({ w: 1.5, len: 0.8, z0: 0.9, y: 0.36, droop: 0.2, curve: 0.25 }), "b");
    // the logo on the front panel
    K.put(K.ball(0.13, 10), "c", { p: [0, 0.68, 0.86], s: [1, 1, 0.25], r: [-0.65, 0, 0] });
  }, { tags: ["civ", "street", "sport"] });
  // the same cap, worn three ways
  def("ballcap_back", "Backwards Cap", "street", BY.ballcap.colorways, function (K) { BY.ballcap.build(K); }, { yaw: Math.PI, tags: ["civ", "street"] });
  def("ballcap_side", "Sideways Cap", "street", BY.ballcap.colorways, function (K) { BY.ballcap.build(K); }, { yaw: Math.PI / 2, tags: ["civ", "street"] });

  def("snapback", "Snapback", "street", [cw(C.black, 0x2f8a4a, C.gold), cw(C.red, C.black, C.white), cw(C.white, C.black, C.black), cw(C.teal, C.black, C.white), cw(C.purple, C.gold, C.gold)], function (K) {
    // a tall structured front: the crown is fuller and stands up at the front
    capCrown(K, { r: 1.09, y0: 0.12, tilt: -0.16, front: 0.25 });
    // a dead-flat visor, its underside in a contrasting colour
    K.put(K.visor({ w: 1.55, len: 0.85, z0: 0.92, y: 0.38, droop: 0.0, curve: 0.0, t: 0.05 }), "a");
    K.put(K.visor({ w: 1.5, len: 0.82, z0: 0.93, y: 0.335, droop: 0.0, curve: 0.0, t: 0.008 }), "b");
    // the snap strap at the back
    K.put(K.box(0.42, 0.06, 0.06), "c", { p: [0, 0.05, -1.0], r: [0.2, 0, 0] });
    K.put(K.box(0.14, 0.25, 0.05), "c", { p: [0, 0.75, 0.9], r: [-0.55, 0, 0] });
  }, { tags: ["civ", "street"] });

  def("trucker", "Trucker Cap", "street", [cw(C.navy, C.white, C.red), cw(C.red, C.white, C.navy), cw(C.black, C.white, C.orange), cw(C.green, C.cream, C.brown), cw(C.orange, C.white, C.black)], function (K) {
    // the mesh back and the tall foam front panel in two colours
    const back = K.dome(1.07, 0.1, { n: 28, m: 12 });
    K.put(back, "a", { r: [-0.18, 0, 0] });
    const front = K.sphere(1.1, { n: 20, m: 10, p0: Math.PI * 0.18 + Math.PI, pL: Math.PI * 0.64, t0: 0, tL: 1.35 });
    deform(front, function (v) { v.y += 0.18 * Math.max(0, v.z); });
    K.put(front, "b", { r: [-0.18, Math.PI, 0] });
    K.put(K.visor({ w: 1.5, len: 0.8, z0: 0.92, y: 0.36, droop: 0.24, curve: 0.3 }), "a");
    K.put(K.box(0.5, 0.2, 0.04), "c", { p: [0, 0.72, 1.06], r: [-0.45, 0, 0] });
    K.put(K.ball(0.08, 8), "a", { p: [0, 1.06, -0.2] });
  }, { tags: ["civ", "work"] });

  def("beanie", "Beanie", "street", [cw(C.charcoal, 0x23252b), cw(C.red, 0x8e1c1c), cw(C.navy, 0x14203a), cw(C.olive, 0x37432a), cw(C.orange, 0xb35512), cw(C.cream, 0xbfb398), cw(C.black, 0x0b0b0d)], function (K) {
    const g = K.dome(1.07, 0.05, { n: 30, m: 12 });
    // knit ribs
    deform(g, function (v) { const a = azi(v); const k = 1 + 0.012 * Math.cos(a * 18); v.x *= k; v.z *= k; if (v.y > 0.7) v.y += (v.y - 0.7) * 0.25; });
    K.put(g, "a", { r: [-0.12, 0, 0] });
    // the rolled cuff
    K.put(K.cyl(1.11, 1.12, 0.3, { n: 32, open: true }), "b", { p: [0, 0.2, 0], r: [-0.12, 0, 0] });
    K.put(K.torus(1.11, 0.06, { n: 32, m: 6 }), "b", { r: [Math.PI / 2 - 0.12, 0, 0], p: [0, 0.35, 0.04] });
  }, { tags: ["civ", "street", "work"] });

  def("beanie_pom", "Pom Beanie", "street", [cw(C.red, C.white, C.white), cw(C.navy, C.white, C.red), cw(C.green, C.white, C.white), cw(C.pink, C.white, C.white), cw(C.yellow, C.black, C.black)], function (K) {
    BY.beanie.build(K);
    K.put(K.ball(0.28, 12), "c", { p: [0, 1.28, -0.16] });
    K.put(K.cyl(1.105, 1.105, 0.06, { n: 32, open: true }), "c", { p: [0, 0.5, 0], r: [-0.12, 0, 0] });
  }, { tags: ["civ"] });

  def("bucket", "Bucket Hat", "street", [cw(C.khaki, 0x8a7550), cw(C.white, C.grey), cw(C.black, C.charcoal), cw(C.olive, 0x37432a), cw(C.sky, C.navy), cw(C.red, 0x8e1c1c)], function (K) {
    K.put(K.lathe([[1.03, 0.12], [1.0, 0.55], [0.92, 0.82], [0.6, 0.9], [0, 0.91]], { n: 30 }), "a");
    K.put(K.brim(1.0, 1.62, 0.14, { t: 0.04, shape: function (ph, k) { return -0.32 * k; } }), "a");
    K.put(K.cyl(1.035, 1.03, 0.1, { n: 30, open: true }), "b", { p: [0, 0.2, 0] });
  }, { tags: ["civ", "travel"] });

  def("flatcap", "Flat Cap", "street", [cw(C.grey, 0x5a5d63), cw(C.brown, 0x4b3020), cw(0x5b5f4a, 0x3a3d2e), cw(C.charcoal, C.black), cw(0x8a6a4a, 0x5a4430)], function (K) {
    // a wedge: high at the back, sloping forward onto the short peak
    const g = K.dome(1.08, 0.1, { n: 28, m: 12 });
    deform(g, function (v) {
      if (v.y > 0.35) v.y = 0.35 + (v.y - 0.35) * 0.45;
      v.z += 0.22 * Math.max(0, v.y - 0.2);
      v.y -= 0.08 * Math.max(0, v.z);
    });
    K.put(g, "a", { r: [-0.14, 0, 0] });
    K.put(K.visor({ w: 1.6, len: 0.38, z0: 1.02, y: 0.36, droop: 0.06, curve: 0.08, t: 0.05 }), "a");
    K.put(K.ball(0.05, 6), "b", { p: [0, 0.72, 0.62] });
  }, { tags: ["civ", "formal"] });

  def("newsboy", "Newsboy Cap", "street", [cw(C.charcoal, C.black), cw(C.khaki, 0x8a7550), cw(C.brown, 0x3d2716), cw(C.grey, C.charcoal), cw(0x6b2f2f, 0x3d1616)], function (K) {
    // eight full panels that overhang the front, a button on top
    const g = K.dome(1.16, 0.12, { n: 32, m: 12 });
    deform(g, function (v) {
      const a = azi(v), k = 1 + 0.035 * Math.abs(Math.cos(a * 4));
      v.x *= k; v.z *= k;
      if (v.y > 0.45) v.y = 0.45 + (v.y - 0.45) * 0.55;
      v.z += 0.18 * Math.max(0, v.y - 0.2);
    });
    K.put(g, "a", { r: [-0.14, 0, 0] });
    K.put(K.ball(0.09, 8), "b", { p: [0, 0.78, 0.18] });
    K.put(K.visor({ w: 1.4, len: 0.42, z0: 0.98, y: 0.32, droop: 0.1, curve: 0.1 }), "b");
  }, { tags: ["civ", "work"] });

  /* ===== FORMAL ===== */
  function crease(K, o) {
    // a fedora-family crown: oval, a centre dent and two front pinches
    const h = o.h, r0 = o.r0 || 1.04, rt = o.rt || 0.9, y0 = o.y0 || 0.2;
    const pts = [[r0, y0], [r0 * 0.99, y0 + h * 0.5], [rt, y0 + h * 0.9], [rt * 0.8, y0 + h], [rt * 0.45, y0 + h * 0.96], [0, y0 + h * (o.dent == null ? 0.82 : o.dent)]];
    const g = K.lathe(pts, { n: 32 });
    deform(g, function (v) {
      const a = azi(v);
      v.z *= o.oval || 1.08;
      // the front pinch: two dimples either side of the front
      const top = Math.max(0, (v.y - y0) / h);
      const pinch = Math.exp(-Math.pow((Math.abs(a) - 0.55) / 0.28, 2)) * top * (o.pinch == null ? 0.16 : o.pinch);
      const r = Math.hypot(v.x, v.z) || 1;
      v.x -= v.x / r * pinch; v.z -= v.z / r * pinch;
      // the front of the crown is a touch lower
      v.y -= (o.fall || 0.06) * Math.max(0, Math.cos(a)) * top;
    });
    return g;
  }
  def("fedora", "Fedora", "formal", [cw(C.charcoal, C.black), cw(0x4a3a2a, 0x231a12), cw(0x8a8478, 0x2a2a2a), cw(C.black, 0x7a1414), cw(C.cream, C.black), cw(0x3a4a5a, 0x1a222a)], function (K) {
    K.put(crease(K, { h: 0.78, r0: 1.04, rt: 0.92, y0: 0.22 }), "a");
    K.put(K.cyl(1.045, 1.055, 0.2, { n: 32, open: true }), "b", { p: [0, 0.32, 0], s: [1, 1, 1.08] });
    // the brim snaps down at the front and turns up at the back
    K.put(K.brim(1.03, 1.6, 0.22, { t: 0.04, rz: 1.06, shape: function (ph, k, x, z) { return k * (Math.cos(ph) < 0 ? 0.16 * -Math.cos(ph) : -0.2 * Math.cos(ph)) + 0.05 * k * Math.abs(Math.sin(ph)); } }), "a");
  }, { tags: ["formal", "civ", "crime"] });

  def("trilby", "Trilby", "formal", [cw(0x8a8478, 0x2a2a2a), cw(C.charcoal, C.black), cw(C.straw, C.black), cw(0x4a5a3a, 0x2a2a2a), cw(C.navy, C.black)], function (K) {
    K.put(crease(K, { h: 0.62, r0: 1.04, rt: 0.82, y0: 0.24, fall: 0.12, oval: 1.12 }), "a", { r: [0.05, 0, 0] });
    K.put(K.cyl(1.045, 1.05, 0.16, { n: 32, open: true }), "b", { p: [0, 0.32, 0], s: [1, 1, 1.12] });
    K.put(K.brim(1.03, 1.36, 0.24, { t: 0.035, rz: 1.1, shape: function (ph, k) { return k * (Math.cos(ph) < 0 ? 0.24 * -Math.cos(ph) : -0.12 * Math.cos(ph)); } }), "a");
  }, { tags: ["formal", "civ"] });

  def("porkpie", "Pork Pie", "formal", [cw(C.black, C.black), cw(C.charcoal, 0x7a1414), cw(C.straw, C.black), cw(C.brown, 0x2a1a10), cw(C.navy, C.white)], function (K) {
    // a short flat crown with the telescope dent ringed round the top
    K.put(K.lathe([[1.04, 0.22], [1.03, 0.62], [0.98, 0.7], [0.86, 0.66], [0.84, 0.62], [0, 0.62]], { n: 32 }), "a");
    K.put(K.cyl(1.045, 1.05, 0.14, { n: 32, open: true }), "b", { p: [0, 0.3, 0] });
    K.put(K.brim(1.03, 1.42, 0.23, { t: 0.04, shape: function (ph, k) { return 0.08 * k * k; } }), "a");
  }, { tags: ["formal", "civ"] });

  def("tophat", "Top Hat", "formal", [cw(C.black, 0x3a1010), cw(0x2a2a2e, C.black), cw(C.white, C.black), cw(0x5a1a24, C.black), cw(0x4a4a50, C.gold)], function (K) {
    K.put(K.lathe([[0.95, 0.3], [0.93, 0.9], [0.98, 1.55], [1.0, 1.62], [0.6, 1.63], [0, 1.63]], { n: 32 }), "a");
    K.put(K.cyl(0.958, 0.952, 0.22, { n: 32, open: true }), "b", { p: [0, 0.44, 0] });
    K.put(K.brim(0.93, 1.48, 0.32, { t: 0.04, rz: 1.06, shape: function (ph, k) { return 0.2 * k * k * Math.pow(Math.abs(Math.sin(ph)), 2) - 0.04 * k * Math.max(0, Math.cos(ph)); } }), "a");
  }, { tags: ["formal", "boss", "fun"] });

  def("bowler", "Bowler", "formal", [cw(C.black, C.black), cw(C.brown, 0x2a1a10), cw(C.charcoal, C.black), cw(0x3a2a4a, C.black)], function (K) {
    K.put(K.lathe([[1.04, 0.2], [1.06, 0.45], [1.0, 0.72], [0.82, 0.92], [0.48, 1.02], [0, 1.05]], { n: 32 }), "a");
    K.put(K.cyl(1.065, 1.065, 0.12, { n: 32, open: true }), "b", { p: [0, 0.28, 0] });
    K.put(K.brim(1.04, 1.36, 0.22, { t: 0.04, rz: 1.05, shape: function (ph, k) { return 0.18 * k * k * Math.pow(Math.abs(Math.sin(ph)), 1.5) - 0.03 * k * Math.cos(ph); } }), "a");
  }, { tags: ["formal", "civ"] });

  def("boater", "Straw Boater", "formal", [cw(C.straw, C.black), cw(C.straw, C.red), cw(C.straw, C.navy), cw(C.cream, 0x2f6bd6)], function (K) {
    K.put(K.lathe([[1.04, 0.22], [1.04, 0.62], [0.9, 0.64], [0, 0.64]], { n: 32 }), "a");
    K.put(K.cyl(1.05, 1.05, 0.2, { n: 32, open: true }), "b", { p: [0, 0.48, 0] });
    K.put(K.brim(1.03, 1.62, 0.23, { t: 0.04 }), "a");
  }, { tags: ["formal", "civ", "travel"] });

  def("homburg", "Homburg", "formal", [cw(C.black, C.black, C.black), cw(C.charcoal, C.black, C.black), cw(0x4a4a50, C.black, C.black)], function (K) {
    K.put(crease(K, { h: 0.82, r0: 1.04, rt: 0.94, y0: 0.22, pinch: 0.02, dent: 0.8, fall: 0.0 }), "a");
    K.put(K.cyl(1.045, 1.05, 0.18, { n: 32, open: true }), "b", { p: [0, 0.32, 0], s: [1, 1, 1.08] });
    // the rolled, bound edge curls up all round
    K.put(K.brim(1.03, 1.46, 0.22, { t: 0.04, rz: 1.06, shape: function (ph, k) { return 0.16 * Math.pow(k, 3) * (0.6 + 0.4 * Math.abs(Math.sin(ph))); } }), "a");
    K.put(K.torus(1.46, 0.04, { n: 40, m: 6 }), "c", { r: [Math.PI / 2, 0, 0], p: [0, 0.37, 0], s: [1, 1.06, 1] });
  }, { tags: ["formal", "boss"] });

  /* ===== LAW ===== */
  def("police", "Police Cap", "law", [cw(C.police, C.black, C.silver), cw(C.white, C.black, C.silver), cw(0x2e3440, C.black, C.gold), cw(0x5a6068, C.black, C.silver)], function (K) {
    const P = peaked(K, { top: 1.24, crown: "a", band: "b", peak: "b", cord: "b" });
    // the band's checker tape (a city force's, not a real one's)
    K.put(K.cyl(1.046, 1.046, 0.08, { n: 34, open: true }), "c", { p: [0, P.y0 + 0.2, 0], r: [-0.06, 0, 0] });
    badge(K, "c", 0, 0.64, 1.08, 1.0, "shield");
  }, { tags: ["law"] });

  def("police_chief", "Police Captain's Cap", "law", [cw(C.white, C.black, C.gold), cw(C.police, C.black, C.gold)], function (K) {
    peaked(K, { top: 1.27, crown: "a", band: "b", peak: "b", cord: "c" });
    badge(K, "c", 0, 0.64, 1.09, 1.15, "shield");
    // the gold leaf on the peak
    K.put(K.tube([[-0.5, 0.15, 1.1], [-0.25, 0.12, 1.32], [0, 0.11, 1.38], [0.25, 0.12, 1.32], [0.5, 0.15, 1.1]], 0.03, { n: 14 }), "c", { r: [-0.06, 0, 0] });
  }, { tags: ["law", "boss"] });

  def("campaign", "Campaign Hat", "law", [cw(C.khaki, 0x3d2716, C.gold), cw(0x6b5a3a, C.black, C.gold), cw(C.grey, C.black, C.silver), cw(C.olive, C.darkbrown, C.gold)], function (K) {
    // the Montana peak: a tall crown pinched into four dents
    const g = K.lathe([[1.04, 0.22], [1.0, 0.6], [0.72, 1.05], [0.3, 1.28], [0, 1.32]], { n: 32 });
    deform(g, function (v) {
      const a = azi(v), top = Math.max(0, (v.y - 0.3) / 1.0), r = Math.hypot(v.x, v.z) || 1;
      const dent = 0.18 * top * Math.max(0, Math.cos(2 * a)) * Math.max(0, Math.cos(2 * a));
      v.x -= v.x / r * dent; v.z -= v.z / r * dent;
    });
    K.put(g, "a");
    K.put(K.cyl(1.045, 1.05, 0.12, { n: 32, open: true }), "b", { p: [0, 0.3, 0] });
    // a broad, dead-flat stiff brim
    K.put(K.brim(1.03, 1.95, 0.24, { t: 0.045, n: 44 }), "a");
    badge(K, "c", 0, 0.42, 1.06, 0.7, "star");
  }, { tags: ["law", "travel"] });

  def("swat", "SWAT Helmet", "law", [cw(C.black, 0x2a2c30, 0x3a3d44), cw(0x2e3440, C.black, 0x4a4d54), cw(C.olive, 0x2a3220, 0x3a4230)], function (K) {
    // a high-cut ballistic shell: the ear cut-outs lift the rim at the sides
    const g = K.dome(1.16, -0.35, { n: 32, m: 14 });
    deform(g, function (v) {
      const a = azi(v), side = Math.pow(Math.abs(Math.sin(a)), 2);
      if (v.y < 0.2) v.y = Math.max(v.y, -0.35 + 0.42 * side * (Math.cos(a) > -0.2 ? 1 : 0.4));
      if (Math.cos(a) > 0.5 && v.y < 0.28) v.y = 0.28;
    });
    K.put(g, "a", { r: [-0.1, 0, 0] });
    // accessory rails along the sides and the NVG shroud on the front
    K.put(K.box(0.08, 0.16, 0.9), "b", { p: [1.13, 0.08, -0.05] });
    K.put(K.box(0.08, 0.16, 0.9), "b", { p: [-1.13, 0.08, -0.05] });
    K.put(K.box(0.36, 0.22, 0.12), "b", { p: [0, 0.62, 1.04], r: [-0.55, 0, 0] });
    // the face shield flipped up over the brow
    const visor = K.sphere(1.27, { n: 24, m: 6, p0: Math.PI * 0.62 + Math.PI, pL: Math.PI * 0.76, t0: 0.95, tL: 0.55 });
    K.put(visor, "c", { r: [-0.5, Math.PI, 0] });
  }, { tags: ["law", "military"] });

  def("riot", "Riot Helmet", "law", [cw(C.police, C.black, 0x8fa4b8), cw(C.white, C.black, 0x8fa4b8), cw(C.black, 0x2a2c30, 0x8fa4b8)], function (K) {
    K.put(K.dome(1.18, -0.5, { n: 30, m: 14 }), "a", { r: [-0.06, 0, 0] });
    K.put(K.torus(1.16, 0.05, { n: 32, m: 6 }), "b", { r: [Math.PI / 2 - 0.06, 0, 0], p: [0, -0.42, 0.03] });
    // the long face shield down
    K.put(K.sphere(1.3, { n: 24, m: 8, p0: Math.PI * 0.6 + Math.PI, pL: Math.PI * 0.8, t0: 1.15, tL: 1.05 }), "c", { r: [0, Math.PI, 0] });
    K.put(K.box(0.8, 0.12, 0.1), "b", { p: [0, 0.52, 1.1], r: [-0.4, 0, 0] });
  }, { tags: ["law"] });

  /* ===== MILITARY ===== */
  def("general", "General's Cap", "military", [cw(C.olive, C.red, C.gold), cw(C.khaki, 0x7a1414, C.gold), cw(C.navy, C.black, C.gold), cw(C.white, C.black, C.gold), cw(0x5a6a7a, C.navy, C.gold)], function (K) {
    // the big-top peaked cap: a wide flaring crown, a red band, braid and
    // the "scrambled eggs" gold leaf on the peak
    const P = peaked(K, { top: 1.36, yt: 0.96, saddle: 0.22, crown: "a", band: "b", peak: 0x0e0f12, cord: "c" });
    K.put(K.tube([[-0.7, 0.14, 1.06], [-0.38, 0.1, 1.34], [0, 0.08, 1.42], [0.38, 0.1, 1.34], [0.7, 0.14, 1.06]], 0.04, { n: 16 }), "c", { r: [-0.06, 0, 0] });
    K.put(K.tube([[-0.55, 0.16, 1.18], [-0.28, 0.13, 1.42], [0, 0.12, 1.48], [0.28, 0.13, 1.42], [0.55, 0.16, 1.18]], 0.028, { n: 14 }), "c", { r: [-0.06, 0, 0] });
    // the badge: a gold wreath and a star
    K.put(K.torus(0.15, 0.03, { n: 16, m: 5 }), "c", { p: [0, 0.68, 1.12], r: [-0.25, 0, 0] });
    badge(K, "c", 0, 0.68, 1.15, 0.7, "star");
    K.put(K.cyl(1.05, 1.05, 0.05, { n: 34, open: true }), "c", { p: [0, P.y1 - 0.02, 0], r: [-0.06, 0, 0] });
  }, { tags: ["military", "boss"] });

  def("helmet", "Combat Helmet", "military", [cw(C.olive, 0x37432a, 0x2a3220), cw(C.tan, 0x9c8656, 0x6b5a3a), cw(0x5a5e52, 0x3a3e34, 0x2a2e24), cw(C.charcoal, C.black, C.black)], function (K) {
    // the PASGT shell: deep, flared at the rim, lower over the ears and nape
    const g = K.dome(1.2, -0.45, { n: 32, m: 14 });
    deform(g, function (v) {
      const a = azi(v);
      if (Math.cos(a) > 0.3 && v.y < 0.16) v.y = 0.16 + (v.y - 0.16) * 0.2;
      if (v.y < 0) { const r = Math.hypot(v.x, v.z) || 1, fl = 0.1 * Math.min(1, -v.y / 0.4); v.x += v.x / r * fl; v.z += v.z / r * fl; }
    });
    K.put(g, "a", { r: [-0.04, 0, 0] });
    // the band and its scrim, and the chin strap
    K.put(K.cyl(1.215, 1.21, 0.16, { n: 32, open: true }), "b", { p: [0, 0.44, 0] });
    K.put(K.torus(0.98, 0.03, { arc: Math.PI, n: 18, m: 5 }), "c", { r: [0, Math.PI / 2, Math.PI], p: [0, -0.32, 0.06], s: [1, 0.9, 1] });
  }, { tags: ["military"] });

  def("beret", "Beret", "military", [cw(C.maroon, 0x3a0f16, C.gold), cw(C.green, 0x15502b, C.gold), cw(C.black, C.black, C.silver), cw(C.red, 0x7d1616, C.gold), cw(C.sky, 0x3a6a8a, C.silver), cw(C.navy, C.black, C.gold)], function (K) {
    // a soft disc, pulled down over one ear
    K.put(K.lathe([[1.02, 0.3], [1.12, 0.48], [1.22, 0.62], [1.12, 0.75], [0.6, 0.85], [0, 0.86]], { n: 32 }), "a", { r: [0, 0, 0.28], p: [-0.16, 0.0, -0.04] });
    K.put(K.torus(1.02, 0.05, { n: 32, m: 6 }), "b", { r: [Math.PI / 2, 0, 0.28], p: [-0.1, 0.27, -0.04] });
    badge(K, "c", 0.42, 0.56, 0.92, 0.6, "shield");
  }, { tags: ["military", "civ"] });

  // THE FOLDED CAP: a long fold that sits ON the crown. Its underside is laid
  // onto the skull (so it hugs the head instead of floating on it) and its top
  // pinches to the fold line.
  function foldCap(K, w, h, len, top, c, band) {
    const g = K.box(w, h, len, 6, 2, 10);
    g.translate(0, top - h / 2, -0.05);
    deform(g, function (v) {
      const zf = (v.z + 0.05) / (len / 2), k = (v.y - (top - h)) / h;   // 0 bottom .. 1 top
      v.x *= 1 - 0.62 * k;                                              // the fold pinches at the top
      const seat = Math.sqrt(Math.max(0.05, 1.08 - v.x * v.x - v.z * v.z));
      if (k < 0.5) v.y = seat - 0.02 + k * 2 * Math.max(0.04, (top - 0.08 * zf * zf) - seat) * 0.5;
      else v.y = Math.max(seat + 0.06, top - 0.08 * zf * zf - (1 - k) * h * 0.4);
    });
    K.put(g, c);
    // the turned-up band along the bottom of the fold, in the trim colour
    if (band) {
      const bg = K.box(w * 1.02, h * 0.22, len * 1.01, 6, 1, 10);
      bg.translate(0, top - h * 0.86, -0.05);
      deform(bg, function (v) { const seat = Math.sqrt(Math.max(0.05, 1.08 - v.x * v.x - v.z * v.z)); if (v.y < top - h * 0.86) v.y = Math.max(v.y, seat - 0.01); });
      K.put(bg, band);
    }
  }
  def("garrison", "Garrison Cap", "military", [cw(C.olive, C.khaki, C.gold), cw(C.navy, C.gold, C.gold), cw(C.white, C.navy, C.gold), cw(0x7a1414, C.gold, C.gold)], function (K) {
    foldCap(K, 1.15, 0.5, 2.05, 1.2, "a", "b");
    badge(K, "c", 0.26, 1.02, 0.7, 0.55, "star");
  }, { fit: false, tags: ["military", "work"] });

  def("boonie", "Boonie Hat", "military", [cw(C.olive, 0x37432a), cw(C.tan, 0x9c8656), cw(0x5a5e52, 0x3a3e34), cw(C.khaki, C.brown)], function (K) {
    K.put(K.lathe([[1.03, 0.14], [1.02, 0.55], [0.95, 0.78], [0.5, 0.86], [0, 0.85]], { n: 28 }), "a");
    K.put(K.cyl(1.04, 1.035, 0.12, { n: 28, open: true }), "b", { p: [0, 0.34, 0] });
    K.put(K.brim(1.0, 1.65, 0.14, { t: 0.035, shape: function (ph, k) { return -0.22 * k + 0.08 * k * Math.sin(ph * 3); } }), "a");
  }, { tags: ["military", "travel", "civ"] });

  def("flight", "Flight Helmet", "military", [cw(C.white, 0x3a3d44, 0x1a1c22), cw(C.olive, 0x3a3d44, 0x1a1c22), cw(0x8a9099, C.black, 0x1a1c22), cw(0xd2c070, C.black, 0x1a1c22)], function (K) {
    K.put(K.dome(1.2, -0.75, { n: 30, m: 14 }), "a", { r: [-0.1, 0, 0] });
    // the visor housing and the dark visor down over the eyes
    K.put(K.torus(1.21, 0.07, { arc: Math.PI * 0.9, n: 22, m: 6 }), "b", { r: [Math.PI / 2 - 0.25, 0, Math.PI * 0.05], p: [0, 0.45, 0], o: "YXZ" });
    K.put(K.sphere(1.27, { n: 24, m: 6, p0: Math.PI * 0.66 + Math.PI, pL: Math.PI * 0.68, t0: 1.25, tL: 0.55 }), "c", { r: [0, Math.PI, 0] });
    // the oxygen mask and its hose
    K.put(K.cone(0.3, 0.42, { n: 14 }), "b", { p: [0, -0.48, 1.06], r: [Math.PI / 2 + 0.3, 0, 0] });
    K.put(K.tube([[0, -0.62, 1.2], [0.2, -0.95, 1.05], [0.35, -1.25, 0.7]], 0.07, { n: 10, m: 6 }), "b");
  }, { tags: ["military", "travel"] });

  /* ===== TRAVEL / SEA / AIR ===== */
  def("pilot", "Pilot's Cap", "travel", [cw(C.navy, C.black, C.gold), cw(C.black, C.black, C.gold), cw(C.white, C.black, C.gold)], function (K) {
    peaked(K, { top: 1.2, crown: "a", band: "b", peak: "b", cord: "c" });
    badge(K, "c", 0, 0.62, 1.1, 1.0, "wings");
  }, { tags: ["travel"] });

  def("captain", "Captain's Hat", "travel", [cw(C.white, C.black, C.gold), cw(C.navy, C.black, C.gold)], function (K) {
    peaked(K, { top: 1.28, crown: "a", band: "b", peak: "b", cord: "c", saddle: 0.06 });
    // the anchor in a wreath
    K.put(K.torus(0.17, 0.028, { n: 16, m: 5 }), "c", { p: [0, 0.62, 1.1], r: [-0.25, 0, 0] });
    K.put(K.box(0.04, 0.24, 0.04), "c", { p: [0, 0.62, 1.12], r: [-0.25, 0, 0] });
    K.put(K.torus(0.09, 0.022, { arc: Math.PI, n: 10, m: 4 }), "c", { p: [0, 0.54, 1.13], r: [-0.25, 0, Math.PI] });
  }, { tags: ["travel", "boss"] });

  def("sailor", "Sailor Cap", "travel", [cw(C.white, C.white, C.navy), cw(C.navy, C.navy, C.white)], function (K) {
    // the dixie cup: a stitched brim turned straight up round a low crown
    K.put(K.lathe([[1.0, 0.25], [1.0, 0.5], [0.94, 0.66], [0.5, 0.7], [0, 0.7]], { n: 32 }), "a");
    K.put(K.lathe([[1.02, 0.22], [1.16, 0.3], [1.22, 0.62], [1.18, 0.64], [1.1, 0.34], [1.02, 0.3]], { n: 32 }), "b");
    K.put(K.cyl(1.215, 1.215, 0.05, { n: 32, open: true }), "c", { p: [0, 0.5, 0] });
  }, { tags: ["travel", "civ"] });

  def("pith", "Pith Helmet", "travel", [cw(C.cream, C.khaki), cw(C.khaki, C.brown), cw(C.white, C.cream)], function (K) {
    K.put(K.lathe([[1.6, 0.0], [1.3, 0.18], [1.06, 0.4], [0.98, 0.75], [0.72, 1.05], [0.3, 1.18], [0.1, 1.22], [0, 1.24]], { n: 32 }), "a", { s: [1, 1, 1.12] });
    K.put(K.lathe([[1.6, 0.0], [1.55, -0.02], [1.24, 0.15], [1.03, 0.36]], { n: 32 }), "a", { s: [1, 1, 1.12] });
    K.put(K.cyl(1.065, 1.07, 0.14, { n: 32, open: true }), "b", { p: [0, 0.44, 0], s: [1, 1, 1.12] });
    K.put(K.ball(0.1, 8), "b", { p: [0, 1.25, 0] });
  }, { tags: ["travel"] });

  def("visor", "Sun Visor", "sport", [cw(C.white, C.navy), cw(C.yellow, C.black), cw(C.pink, C.white), cw(C.red, C.white), cw(C.teal, C.white)], function (K) {
    K.put(K.cyl(1.05, 1.06, 0.22, { n: 32, open: true }), "a", { p: [0, 0.36, 0], r: [-0.12, 0, 0] });
    K.put(K.visor({ w: 1.55, len: 0.85, z0: 0.95, y: 0.36, droop: 0.22, curve: 0.25 }), "b");
  }, { tags: ["sport", "civ", "travel"] });

  def("sunhat", "Sun Hat", "travel", [cw(C.straw, C.red), cw(C.straw, C.black), cw(C.cream, C.navy), cw(C.white, C.pink), cw(C.straw, C.teal)], function (K) {
    K.put(K.lathe([[1.04, 0.2], [1.02, 0.55], [0.9, 0.78], [0.5, 0.86], [0, 0.86]], { n: 32 }), "a");
    K.put(K.cyl(1.045, 1.04, 0.16, { n: 32, open: true }), "b", { p: [0, 0.3, 0] });
    K.put(K.brim(1.02, 2.15, 0.22, { t: 0.035, n: 48, shape: function (ph, k) { return -0.18 * k * k + 0.1 * k * Math.sin(ph * 2 + 1); } }), "a");
  }, { tags: ["travel", "civ"] });

  def("cowboy", "Cowboy Hat", "travel", [cw(C.brown, 0x2a1a10, C.silver), cw(C.black, 0x2a1a10, C.silver), cw(C.cream, 0x6b4428, C.gold), cw(C.tan, 0x3d2716, C.silver), cw(C.white, C.black, C.silver)], function (K) {
    // the cattleman crease: a deep centre crease and two front pinches
    const g = crease(K, { h: 0.86, r0: 1.04, rt: 0.94, y0: 0.22, dent: 0.72, pinch: 0.22, fall: 0.08, oval: 1.12 });
    deform(g, function (v) { if (Math.abs(v.x) < 0.3 && v.y > 0.8) v.y -= 0.12 * (1 - Math.abs(v.x) / 0.3); });
    K.put(g, "a");
    K.put(K.cyl(1.045, 1.05, 0.12, { n: 32, open: true }), "b", { p: [0, 0.3, 0], s: [1, 1, 1.12] });
    K.put(K.box(0.12, 0.1, 0.06), "c", { p: [0.4, 0.3, 1.1] });
    // the brim curls up hard at the sides and dips front and back
    K.put(K.brim(1.03, 2.0, 0.24, { t: 0.045, rz: 1.12, n: 44, shape: function (ph, k, x) { return 0.55 * Math.pow(k, 2.2) * Math.pow(Math.abs(Math.sin(ph)), 2.5) - 0.12 * k * Math.abs(Math.cos(ph)); } }), "a");
  }, { tags: ["travel", "civ", "crime"] });

  def("sombrero", "Sombrero", "travel", [cw(C.straw, C.red, C.green), cw(C.black, C.gold, C.gold), cw(C.cream, C.red, C.gold)], function (K) {
    K.put(K.lathe([[1.04, 0.2], [0.98, 0.8], [0.78, 1.45], [0.45, 1.72], [0, 1.78]], { n: 32 }), "a");
    K.put(K.cyl(1.0, 1.03, 0.2, { n: 32, open: true }), "b", { p: [0, 0.42, 0] });
    K.put(K.brim(1.0, 2.9, 0.22, { t: 0.04, n: 56, m: 8, shape: function (ph, k) { return -0.12 * k + 0.75 * Math.pow(Math.max(0, (k - 0.75) / 0.25), 1.6); } }), "a");
    K.put(K.torus(2.82, 0.07, { n: 56, m: 6 }), "c", { r: [Math.PI / 2, 0, 0], p: [0, 0.73, 0] });
  }, { tags: ["travel", "fun"] });

  /* ===== WORK ===== */
  def("hardhat", "Hard Hat", "work", [cw(C.yellow, 0xc99a0a), cw(C.orange, 0xb35512), cw(C.white, 0xc8c8c8), cw(C.blue, 0x153d82), cw(C.red, 0x8e1c1c), cw(C.hivis, 0x9fb020)], function (K) {
    K.put(K.dome(1.13, 0.05, { n: 30, m: 12 }), "a", { r: [-0.08, 0, 0], s: [1, 1.02, 1.06] });
    // the centre ridge and the two side ribs
    K.put(K.torus(1.135, 0.07, { arc: Math.PI, n: 22, m: 6 }), "a", { r: [0, Math.PI / 2, 0], s: [1, 1.02, 1.06] });
    K.put(K.torus(1.1, 0.04, { arc: Math.PI * 0.8, n: 18, m: 5 }), "b", { r: [0, Math.PI / 2, 0.42], p: [0, 0.03, 0], s: [1, 1.02, 1.06] });
    K.put(K.torus(1.1, 0.04, { arc: Math.PI * 0.8, n: 18, m: 5 }), "b", { r: [0, Math.PI / 2, -0.42], p: [0, 0.03, 0], s: [1, 1.02, 1.06] });
    // the brim all round, longer at the front peak
    K.put(K.brim(1.08, 1.32, 0.12, { t: 0.05, rz: 1.06, shape: function (ph, k) { return -0.04 * k; } }), "a");
    K.put(K.visor({ w: 1.4, len: 0.5, z0: 1.05, y: 0.16, droop: 0.1, curve: 0.12, t: 0.05 }), "a");
  }, { tags: ["work"] });

  def("miner", "Miner's Helmet", "work", [cw(C.yellow, 0x3a3a3a, 0xfff6c0), cw(C.white, 0x3a3a3a, 0xfff6c0), cw(C.orange, 0x3a3a3a, 0xfff6c0)], function (K) {
    BY.hardhat.build(K);
    // the lamp and its cable
    K.put(K.cyl(0.18, 0.2, 0.24, { n: 14 }), "b", { p: [0, 0.52, 1.18], r: [Math.PI / 2 - 0.3, 0, 0] });
    K.put(K.cyl(0.15, 0.15, 0.03, { n: 14 }), "c", { p: [0, 0.48, 1.31], r: [Math.PI / 2 - 0.3, 0, 0] });
    K.put(K.tube([[0.1, 0.55, 1.05], [0.6, 0.6, 0.7], [1.0, 0.3, 0.1], [1.05, -0.2, -0.4]], 0.035, { n: 12, m: 5 }), "b");
  }, { tags: ["work"] });

  def("fire", "Fire Helmet", "work", [cw(C.scarlet, C.black, C.gold), cw(C.yellow, C.black, C.white), cw(C.black, C.gold, C.gold), cw(C.white, C.red, C.gold)], function (K) {
    // the traditional helmet: a domed shell, a long tail at the back, the
    // leather front shield standing up
    K.put(K.dome(1.12, 0.12, { n: 30, m: 12 }), "a", { r: [-0.05, 0, 0] });
    K.put(K.torus(1.12, 0.06, { arc: Math.PI * 1.0, n: 22, m: 6 }), "a", { r: [0, Math.PI / 2, 0], s: [1, 1.04, 1] });
    K.put(K.brim(1.08, 1.5, 0.14, { t: 0.05, rz: 1.2, shape: function (ph, k) { const back = Math.max(0, -Math.cos(ph)); return -k * (0.12 + 0.55 * back * back); } }), "a", { p: [0, 0, -0.12] });
    // the front shield and its number
    K.put(K.plate([[-0.34, 0], [0.34, 0], [0.4, 0.3], [0.2, 0.52], [0, 0.6], [-0.2, 0.52], [-0.4, 0.3]].map(function (p) { return [p[0], -p[1]]; }), 0.05), "b", { p: [0, 0.58, 1.08], r: [Math.PI / 2 + 0.5, 0, 0] });
    K.put(K.box(0.16, 0.22, 0.03), "c", { p: [0, 0.86, 1.02], r: [-0.95, 0, 0] });
    K.put(K.box(0.18, 0.1, 0.12), "c", { p: [0, 1.0, 0.75], r: [-0.6, 0, 0] });
  }, { tags: ["work"] });

  def("chef", "Chef's Toque", "work", [cw(C.white, 0xdedcd6), cw(C.black, 0x2a2a2a)], function (K) {
    K.put(K.cyl(1.04, 1.04, 0.42, { n: 32, open: true }), "b", { p: [0, 0.42, 0] });
    // the puffed, pleated top
    const g = K.lathe([[1.02, 0.6], [1.12, 0.9], [1.28, 1.4], [1.24, 1.68], [0.9, 1.86], [0.4, 1.92], [0, 1.9]], { n: 40 });
    deform(g, function (v) { const a = azi(v), r = Math.hypot(v.x, v.z) || 1, k = 0.05 * Math.max(0, Math.cos(a * 14)) * Math.min(1, (v.y - 0.6) / 0.4); v.x += v.x / r * k; v.z += v.z / r * k; });
    K.put(g, "a");
  }, { tags: ["work"] });

  def("paper", "Paper Hat", "work", [cw(C.white, C.red), cw(C.white, C.navy), cw(C.white, C.green)], function (K) {
    // the soda-fountain fold, with a stripe
    foldCap(K, 1.1, 0.55, 2.0, 1.22, "a", "b");
  }, { fit: false, tags: ["work"] });

  def("medic", "Medic Cap", "work", [cw(C.white, C.red, C.red), cw(0x2a4a8a, C.white, C.white), cw(0xd6ef2a, C.navy, C.navy)], function (K) {
    capCrown(K, { r: 1.07, y0: 0.1, tilt: -0.22, button: true });
    K.put(K.visor({ w: 1.5, len: 0.78, z0: 0.9, y: 0.36, droop: 0.2, curve: 0.25 }), "a");
    K.put(K.cyl(1.072, 1.072, 0.07, { n: 32, open: true }), "c", { p: [0, 0.32, 0.02], r: [-0.22, 0, 0] });
    badge(K, "b", 0, 0.7, 0.9, 1.1, "cross");
  }, { tags: ["work"] });

  def("nurse", "Nurse's Cap", "work", [cw(C.white, C.red, C.red), cw(0xf3eedf, 0x2a4a8a, 0x2a4a8a)], function (K) {
    // the starched fold on top of the head
    const g = K.box(1.3, 0.42, 0.52);
    deform(g, function (v) { v.z += 0.25 * (v.y + 0.21) / 0.42 * (1 - Math.abs(v.x) / 0.65 * 0.4); v.x *= 1 - 0.18 * (v.y + 0.21) / 0.42; });
    K.put(g, "a", { p: [0, 0.98, 0.18], r: [-0.35, 0, 0] });
    K.put(K.box(1.32, 0.06, 0.06), "b", { p: [0, 0.82, 0.48], r: [-0.35, 0, 0] });
    badge(K, "c", 0, 1.06, 0.48, 0.75, "cross");
  }, { fit: false, tags: ["work"] });

  def("scrubcap", "Scrub Cap", "work", [cw(0x5aa8c8, 0x3a88a8), cw(0x6ab080, 0x4a9060), cw(0x8a6ac8, 0x6a4aa8), cw(C.navy, C.blue)], function (K) {
    const g = K.dome(1.08, 0.0, { n: 30, m: 12 });
    deform(g, function (v) { if (v.z > 0.2) v.y = Math.max(v.y, 0.32); const k = 1 + 0.03 * Math.cos(azi(v) * 10); v.x *= k; v.z *= k; });
    K.put(g, "a", { r: [-0.12, 0, 0] });
    K.put(K.torus(1.06, 0.05, { n: 32, m: 6 }), "b", { r: [Math.PI / 2 - 0.12, 0, 0], p: [0, 0.27, 0.03] });
  }, { tags: ["work"] });

  def("bellhop", "Bellhop Cap", "work", [cw(C.red, C.gold, C.black), cw(C.navy, C.gold, C.black), cw(C.black, C.gold, C.black)], function (K) {
    K.put(K.lathe([[0.82, 0.5], [0.84, 1.0], [0.6, 1.02], [0, 1.02]], { n: 30 }), "a", { r: [0, 0, 0.18], p: [0.08, 0.02, 0] });
    K.put(K.cyl(0.845, 0.845, 0.1, { n: 30, open: true }), "b", { r: [0, 0, 0.18], p: [0.07, 0.6, 0] });
    K.put(K.cyl(0.845, 0.845, 0.06, { n: 30, open: true }), "b", { r: [0, 0, 0.18], p: [0.1, 0.92, 0] });
    K.put(K.torus(0.9, 0.025, { arc: Math.PI, n: 16, m: 4 }), "c", { r: [0, Math.PI / 2, Math.PI], p: [0.05, 0.25, 0] });
  }, { fit: false, tags: ["work", "fun"] });

  def("convict", "Convict Cap", "work", [cw(C.white, 0x101012), cw(C.orange, 0x101012)], function (K) {
    // the cartoon pillbox in prison stripes
    const n = 5, h = 0.6, y0 = 0.28;
    for (let i = 0; i < n; i++) {
      K.put(K.cyl(1.04, 1.045, h / n, { n: 30, open: true }), i % 2 ? "b" : "a", { p: [0, y0 + (i + 0.5) * h / n, 0], r: [-0.1, 0, 0] });
    }
    K.put(K.cyl(1.04, 1.04, 0.04, { n: 30 }), "b", { p: [0, y0 + h, 0.06], r: [-0.1, 0, 0] });
  }, { tags: ["work"] });

  /* ===== SPORT ===== */
  def("moto", "Motorbike Helmet", "sport", [cw(C.black, 0x0a0a0c, 0x2a3a4a), cw(C.red, C.white, 0x2a3a4a), cw(C.white, C.blue, 0x2a3a4a), cw(C.yellow, C.black, 0x2a3a4a), cw(C.charcoal, C.orange, 0x2a3a4a)], function (K) {
    // a full-face shell round the whole head, the chin bar in front
    K.put(K.sphere(1.24, { n: 30, m: 16 }), "a", { p: [0, -0.06, 0.02], s: [1, 1.02, 1.08] });
    K.put(K.torus(1.1, 0.06, { arc: Math.PI * 1.1, n: 24, m: 6 }), "b", { r: [0, Math.PI / 2, 0], p: [0, 0, 0], s: [1.13, 1.1, 1.05] });
    // the dark visor across the face
    K.put(K.sphere(1.255, { n: 24, m: 6, p0: Math.PI * 0.68 + Math.PI, pL: Math.PI * 0.64, t0: 1.18, tL: 0.6 }), "c", { r: [0, Math.PI, 0], p: [0, -0.06, 0.03], s: [1, 1.02, 1.08] });
  }, { tags: ["sport", "crime"] });

  def("racing", "Race Helmet", "sport", [cw(C.white, C.red, 0x1a1c22), cw(C.yellow, C.blue, 0x1a1c22), cw(C.blue, C.white, 0x1a1c22), cw(C.black, C.gold, 0x1a1c22)], function (K) {
    BY.moto.build(K);
    // the stripes and a spoiler
    K.put(K.torus(1.27, 0.06, { arc: Math.PI * 1.1, n: 24, m: 6 }), "b", { r: [0, Math.PI / 2, 0], p: [0.25, -0.06, 0.02], s: [1, 1.02, 1.08] });
    K.put(K.torus(1.27, 0.06, { arc: Math.PI * 1.1, n: 24, m: 6 }), "b", { r: [0, Math.PI / 2, 0], p: [-0.25, -0.06, 0.02], s: [1, 1.02, 1.08] });
    K.put(K.box(0.8, 0.06, 0.3), "b", { p: [0, 0.75, -1.08], r: [0.5, 0, 0] });
  }, { tags: ["sport"] });

  def("bikehelmet", "Bike Helmet", "sport", [cw(C.sky, C.black, C.white), cw(C.red, C.black, C.white), cw(C.hivis, C.black, C.black), cw(C.white, C.charcoal, C.charcoal)], function (K) {
    // an elongated shell with a pointed tail and vents
    const g = K.dome(1.14, 0.05, { n: 30, m: 12 });
    deform(g, function (v) { if (v.z < 0) { v.z *= 1 + 0.25 * Math.max(0, v.y - 0.2); } v.y -= 0.08 * Math.max(0, -v.z); });
    K.put(g, "a", { r: [-0.1, 0, 0], s: [0.96, 0.95, 1.08] });
    for (let i = -2; i <= 2; i++) K.put(K.box(0.07, 0.04, 0.95), "b", { p: [i * 0.26, 1.08 - Math.abs(i) * 0.12, -0.08], r: [0, 0, i * -0.22] });
    K.put(K.visor({ w: 1.1, len: 0.32, z0: 1.08, y: 0.32, droop: 0.06, curve: 0.08, t: 0.04 }), "c");
  }, { tags: ["sport", "civ"] });

  def("headphones", "Headphones", "sport", [cw(C.black, 0x2a2a30, C.red), cw(C.white, C.silver, C.white), cw(C.red, C.black, C.white), cw(C.teal, C.black, C.black), cw(C.gold, C.black, C.black)], function (K) {
    K.put(K.torus(1.12, 0.07, { arc: Math.PI, n: 26, m: 8 }), "a", { r: [0, Math.PI / 2, 0], p: [0, 0.05, -0.05], s: [1, 1.02, 1] });
    for (const s of [-1, 1]) {
      K.put(K.cyl(0.42, 0.42, 0.28, { n: 20 }), "b", { p: [s * 1.13, 0.0, -0.05], r: [0, 0, Math.PI / 2] });
      K.put(K.cyl(0.3, 0.3, 0.05, { n: 18 }), "c", { p: [s * 1.29, 0.0, -0.05], r: [0, 0, Math.PI / 2] });
    }
  }, { tags: ["sport", "civ", "street"] });

  def("sweatband", "Sweatband", "sport", [cw(C.white, C.red), cw(C.red, C.white), cw(C.blue, C.white), cw(C.yellow, C.black), cw(C.pink, C.white)], function (K) {
    K.put(K.cyl(1.04, 1.05, 0.26, { n: 32, open: true }), "a", { p: [0, 0.33, 0], r: [-0.14, 0, 0] });
    K.put(K.cyl(1.055, 1.055, 0.06, { n: 32, open: true }), "b", { p: [0, 0.33, 0], r: [-0.14, 0, 0] });
  }, { tags: ["sport"] });

  /* ===== WORLD ===== */
  def("turban", "Turban", "travel", [cw(C.orange, 0xb35512), cw(C.white, 0xd8d4c8), cw(C.navy, 0x14203a), cw(C.red, 0x8e1c1c), cw(C.black, 0x2a2a30), cw(C.pink, 0xb04a80)], function (K) {
    // wound layers, crossing to a point at the front
    K.put(K.dome(1.1, 0.1, { n: 30, m: 12 }), "a", { r: [-0.1, 0, 0], s: [1, 1.08, 1.06] });
    for (let i = 0; i < 4; i++) {
      const y = 0.25 + i * 0.17, r = 1.12 - i * 0.07 - (i > 2 ? 0.08 : 0);
      K.put(K.torus(r, 0.1, { n: 32, m: 6 }), i % 2 ? "b" : "a", { r: [Math.PI / 2 - 0.12 - (i % 2 ? 0.16 : -0.1), 0, i % 2 ? 0.08 : -0.08], p: [0, y, -0.02] });
    }
    K.put(K.cone(0.3, 0.5, { n: 10 }), "a", { p: [0, 0.82, 0.86], r: [0.9, 0, 0], s: [1.4, 1, 0.5] });
  }, { tags: ["civ"] });

  def("keffiyeh", "Keffiyeh", "travel", [cw(C.white, C.black, C.red), cw(C.white, C.black, C.black), cw(0xe9e2d2, C.black, 0x8e1c1c)], function (K) {
    K.put(K.dome(1.07, -0.05, { n: 30, m: 12 }), "a", { r: [-0.08, 0, 0] });
    // the cloth falls to the shoulders, open at the face
    const g = K.cyl(1.07, 1.32, 1.3, { n: 30, hs: 4, open: true, t0: Math.PI * 0.18, tL: Math.PI * 1.64 });
    deform(g, function (v) { const k = (0.65 - v.y) / 1.3; v.z -= 0.12 * k; });
    K.put(g, "a", { p: [0, -0.6, 0], r: [0, Math.PI, 0] });
    // a check border in the trim colour, and the black double agal on top
    K.put(K.cyl(1.325, 1.325, 0.06, { n: 30, open: true, t0: Math.PI * 0.18, tL: Math.PI * 1.64 }), "c", { p: [0, -1.2, 0], r: [0, Math.PI, 0] });
    K.put(K.torus(0.9, 0.07, { n: 30, m: 6 }), "b", { r: [Math.PI / 2 - 0.08, 0, 0], p: [0, 0.6, 0.02] });
    K.put(K.torus(0.86, 0.06, { n: 30, m: 6 }), "b", { r: [Math.PI / 2 - 0.08, 0, 0], p: [0, 0.72, 0.01] });
  }, { tags: ["civ"] });

  def("kufi", "Kufi", "travel", [cw(C.white, 0xd8d4c8), cw(C.black, 0x2a2a30), cw(0x6b1c2a, C.gold), cw(0x1a5a3a, C.gold)], function (K) {
    K.put(K.lathe([[1.04, 0.32], [1.04, 0.72], [0.95, 0.8], [0, 0.82]], { n: 30 }), "a", { r: [-0.08, 0, 0] });
    K.put(K.cyl(1.045, 1.045, 0.08, { n: 30, open: true }), "b", { p: [0, 0.6, 0], r: [-0.08, 0, 0] });
  }, { tags: ["civ"] });

  def("fez", "Fez", "travel", [cw(C.red, C.black, C.black), cw(C.maroon, C.gold, C.gold)], function (K) {
    K.put(K.lathe([[0.98, 0.35], [0.76, 1.25], [0, 1.25]], { n: 30 }), "a", { r: [-0.05, 0, 0] });
    K.put(K.tube([[0, 1.27, -0.02], [0.2, 1.24, -0.4], [0.32, 0.95, -0.66], [0.38, 0.7, -0.72]], 0.04, { n: 10, m: 5 }), "b");
    K.put(K.cone(0.1, 0.22, { n: 8 }), "b", { p: [0.38, 0.62, -0.72] });
  }, { tags: ["civ", "fun"] });

  def("ushanka", "Ushanka", "travel", [cw(0x5a4636, 0x8a7a6a, C.gold), cw(C.black, 0x3a3a3a, C.red), cw(C.grey, 0xb8b8b8, C.red), cw(C.cream, 0xe8e0d0, C.gold)], function (K) {
    K.put(K.lathe([[1.06, 0.1], [1.1, 0.7], [0.95, 0.98], [0, 1.02]], { n: 30 }), "a", { r: [-0.08, 0, 0] });
    // the fur: a fat front flap turned up and the ear flaps tied up top
    K.put(K.cyl(1.2, 1.2, 0.42, { n: 30, open: false, t0: -Math.PI * 0.4, tL: Math.PI * 0.8 }), "b", { p: [0, 0.48, 0.04], r: [-0.18, 0, 0] });
    for (const s of [-1, 1]) K.put(K.box(0.24, 0.72, 0.68), "b", { p: [s * 1.12, 0.62, -0.1], r: [0, 0, s * 0.35] });
    badge(K, "c", 0, 0.62, 1.24, 0.6, "star");
  }, { tags: ["civ", "travel"] });

  /* ===== FUN ===== */
  def("crown", "Crown", "fun", [cw(C.gold, C.red, 0x2f6bd6), cw(C.gold, C.green, C.white), cw(C.silver, C.blue, C.white), cw(C.gold, C.purple, C.white)], function (K) {
    const R = 0.86, y0 = 0.62, h = 0.32, N = 8;
    K.put(K.cyl(R, R * 0.96, h, { n: 32 * (K.far ? 1 : 1), open: true }), "a", { p: [0, y0 + h / 2, 0] });
    K.put(K.torus(R, 0.05, { n: 32, m: 6 }), "a", { r: [Math.PI / 2, 0, 0], p: [0, y0, 0] });
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU, x = Math.sin(a) * R, z = Math.cos(a) * R;
      K.put(K.cone(0.16, 0.42, { n: 6 }), "a", { p: [x, y0 + h + 0.18, z] });
      K.put(K.ball(0.075, 8), "a", { p: [x, y0 + h + 0.42, z] });
      K.put(K.ball(0.08, 8), i % 2 ? "b" : "c", { p: [x * 1.04, y0 + h * 0.45, z * 1.04] });
    }
    // the velvet cap inside it
    K.put(K.dome(0.84, 0.62, { n: 24, m: 8 }), "b", { s: [1, 1.15, 1], p: [0, 0.18, 0] });
  }, { tags: ["fun", "boss"] });

  def("tiara", "Tiara", "fun", [cw(C.silver, C.pink, C.white), cw(C.gold, C.red, C.white)], function (K) {
    K.put(K.torus(1.0, 0.04, { arc: Math.PI * 1.1, n: 22, m: 5 }), "a", { r: [Math.PI / 2 - 0.35, 0, Math.PI * 0.5 - Math.PI * 0.05], p: [0, 0.5, 0.04], o: "YXZ" });
    K.put(K.cone(0.22, 0.5, { n: 6 }), "a", { p: [0, 0.98, 0.72], r: [0.35, 0, 0], s: [1, 1, 0.3] });
    K.put(K.cone(0.14, 0.3, { n: 6 }), "a", { p: [0.4, 0.88, 0.62], r: [0.35, 0, -0.35], s: [1, 1, 0.3] });
    K.put(K.cone(0.14, 0.3, { n: 6 }), "a", { p: [-0.4, 0.88, 0.62], r: [0.35, 0, 0.35], s: [1, 1, 0.3] });
    K.put(K.ball(0.09, 8), "b", { p: [0, 0.9, 0.78] });
  }, { fit: false, tags: ["fun", "formal"] });

  def("halo", "Halo", "fun", [cw(0xfff3b0, C.gold), cw(C.white, C.white)], function (K) {
    K.put(K.torus(0.72, 0.075, { n: 36, m: 8 }), "a", { r: [Math.PI / 2 - 0.1, 0, 0], p: [0, 1.45, -0.05] });
  }, { fit: false, tags: ["fun"] });

  def("horns", "Devil Horns", "fun", [cw(C.scarlet, C.black), cw(C.black, C.scarlet)], function (K) {
    for (const s of [-1, 1]) K.put(K.tube([[s * 0.45, 0.75, 0.25], [s * 0.62, 1.05, 0.32], [s * 0.66, 1.34, 0.22], [s * 0.56, 1.52, 0.06]], function (t) { return 0.19 * (1 - 0.92 * t); }, { n: 12, m: 8 }), "a");
    K.put(K.torus(1.01, 0.035, { arc: Math.PI, n: 20, m: 5 }), "b", { r: [0, Math.PI / 2, 0], p: [0, 0.0, 0.16] });
  }, { fit: false, tags: ["fun"] });

  def("party", "Party Hat", "fun", [cw(C.pink, C.yellow, C.white), cw(C.blue, C.gold, C.white), cw(C.green, C.red, C.yellow), cw(C.purple, C.teal, C.gold)], function (K) {
    K.put(K.cone(0.5, 1.15, { n: 24, open: true }), "a", { p: [0.18, 1.32, 0.05], r: [0, 0, -0.22] });
    for (let i = 0; i < 3; i++) K.put(K.torus(0.42 - i * 0.12, 0.035, { n: 20, m: 4 }), "b", { r: [Math.PI / 2, 0, -0.22], p: [0.18 + (0.22 + i * 0.3) * Math.sin(0.22), 0.9 + i * 0.3, 0.05] });
    K.put(K.ball(0.16, 10), "c", { p: [0.18 + 0.6 * Math.sin(0.22), 1.32 + 0.57 * Math.cos(0.22) + 0.06, 0.05] });
  }, { fit: false, tags: ["fun"] });

  def("viking", "Viking Helmet", "fun", [cw(C.steel, C.ivory, 0x6b4428), cw(0x9a8a5a, C.ivory, C.gold)], function (K) {
    K.put(K.dome(1.12, 0.05, { n: 28, m: 12 }), "a", { r: [-0.05, 0, 0] });
    K.put(K.cyl(1.125, 1.125, 0.14, { n: 30, open: true }), "c", { p: [0, 0.18, 0] });
    K.put(K.torus(1.12, 0.05, { arc: Math.PI, n: 20, m: 5 }), "c", { r: [0, Math.PI / 2, 0] });
    K.put(K.box(0.14, 0.5, 0.08), "a", { p: [0, 0.0, 1.12] });
    for (const s of [-1, 1]) K.put(K.tube([[s * 1.0, 0.42, 0.05], [s * 1.38, 0.62, 0.15], [s * 1.58, 1.02, 0.22], [s * 1.52, 1.42, 0.18]], function (t) { return 0.22 * (1 - 0.88 * t); }, { n: 14, m: 8 }), "b");
  }, { tags: ["fun"] });

  def("tricorne", "Pirate Hat", "fun", [cw(C.black, C.gold, C.white), cw(0x3d2716, C.gold, C.white), cw(C.navy, C.gold, C.white)], function (K) {
    K.put(K.lathe([[1.04, 0.22], [1.02, 0.6], [0.8, 0.82], [0, 0.86]], { n: 30 }), "a");
    // the brim cocked up on three sides into a triangle, point at the front
    K.put(K.brim(1.02, 1.62, 0.24, { t: 0.05, n: 48, shape: function (ph, k) { const c = Math.cos(3 * (ph)) ; return Math.pow(k, 1.3) * (0.62 - 0.55 * Math.max(0, c)); } }), "a");
    K.put(K.torus(1.6, 0.035, { n: 48, m: 4 }), "b", { r: [Math.PI / 2, 0, 0], p: [0, 0.6, 0], s: [1, 1, 1] });
    // the skull badge
    K.put(K.ball(0.14, 10), "c", { p: [0, 0.62, 1.06], s: [1, 1, 0.4] });
    K.put(K.box(0.36, 0.05, 0.03), "c", { p: [0, 0.48, 1.06], r: [0, 0, 0.6] });
    K.put(K.box(0.36, 0.05, 0.03), "c", { p: [0, 0.48, 1.06], r: [0, 0, -0.6] });
  }, { tags: ["fun", "crime"] });

  def("wizard", "Wizard Hat", "fun", [cw(C.purple, C.gold, C.gold), cw(C.navy, C.silver, C.silver), cw(0x2a5a3a, C.gold, C.gold)], function (K) {
    const g = K.lathe([[1.04, 0.24], [0.8, 0.9], [0.5, 1.7], [0.2, 2.4], [0, 2.7]], { n: 28 });
    deform(g, function (v) { const k = Math.max(0, v.y - 1.4) / 1.3; v.z -= 0.5 * k * k; v.y -= 0.18 * k * k; });
    K.put(g, "a");
    K.put(K.brim(1.03, 1.85, 0.25, { t: 0.04, n: 44, shape: function (ph, k) { return -0.12 * k * k + 0.06 * k * Math.sin(ph * 3); } }), "a");
    K.put(K.cyl(1.0, 1.0, 0.14, { n: 28, open: true }), "b", { p: [0, 0.36, 0] });
    badge(K, "c", 0.3, 1.2, 0.68, 0.8, "star");
    badge(K, "c", -0.32, 0.8, 0.82, 0.55, "star");
  }, { tags: ["fun"] });

  def("witch", "Witch Hat", "fun", [cw(C.black, C.purple, C.gold), cw(0x2a1a3a, C.orange, C.gold)], function (K) {
    const g = K.lathe([[1.04, 0.24], [0.78, 0.9], [0.4, 1.75], [0.12, 2.35], [0, 2.5]], { n: 28 });
    deform(g, function (v) { const k = Math.max(0, v.y - 1.2) / 1.3; v.z -= 0.6 * k * k * k; v.x += 0.15 * k * k; });
    K.put(g, "a");
    K.put(K.brim(1.03, 2.05, 0.25, { t: 0.04, n: 44, shape: function (ph, k) { return -0.06 * k + 0.1 * k * k * Math.cos(ph * 2); } }), "a");
    K.put(K.cyl(0.99, 0.98, 0.16, { n: 28, open: true }), "b", { p: [0, 0.38, 0] });
    K.put(K.box(0.24, 0.2, 0.05), "c", { p: [0, 0.38, 1.0] });
  }, { tags: ["fun"] });

  def("santa", "Santa Hat", "fun", [cw(C.scarlet, C.white, C.white)], function (K) {
    const g = K.lathe([[1.06, 0.25], [0.96, 0.75], [0.66, 1.25], [0.32, 1.6], [0, 1.75]], { n: 26 });
    deform(g, function (v) { const k = Math.max(0, v.y - 0.8) / 0.95; v.x += 0.9 * k * k; v.y -= 0.7 * k * k * k; });
    K.put(g, "a", { r: [-0.08, 0, 0] });
    K.put(K.torus(1.07, 0.16, { n: 32, m: 8 }), "b", { r: [Math.PI / 2 - 0.08, 0, 0], p: [0, 0.27, 0.02] });
    K.put(K.ball(0.24, 12), "c", { p: [0.86, 1.02, -0.14] });
  }, { tags: ["fun"] });

  def("grad", "Graduation Cap", "fun", [cw(C.black, C.gold, C.gold), cw(C.navy, C.gold, C.gold), cw(C.maroon, C.gold, C.gold)], function (K) {
    K.put(K.dome(1.06, 0.18, { n: 28, m: 10 }), "a", { r: [-0.15, 0, 0] });
    K.put(K.box(2.0, 0.06, 2.0), "a", { p: [0, 1.02, -0.08], r: [-0.08, Math.PI / 4, 0] });
    K.put(K.ball(0.07, 8), "b", { p: [0, 1.07, -0.08] });
    K.put(K.tube([[0, 1.07, -0.08], [0.45, 1.06, 0.2], [0.98, 0.98, 0.38], [1.02, 0.6, 0.42]], 0.025, { n: 12, m: 4 }), "b");
    K.put(K.cyl(0.07, 0.11, 0.28, { n: 8 }), "c", { p: [1.02, 0.44, 0.42] });
  }, { tags: ["fun"] });

  def("propeller", "Propeller Beanie", "fun", [cw(C.red, C.blue, C.yellow), cw(C.green, C.yellow, C.red), cw(C.blue, C.red, C.yellow)], function (K) {
    // four panels in alternating colours, a button and the propeller
    for (let i = 0; i < 4; i++) K.put(K.sphere(1.07, { n: 8, m: 10, p0: i * Math.PI / 2, pL: Math.PI / 2, t0: 0, tL: 1.42 }), i % 2 ? "b" : "a", { r: [-0.12, 0, 0] });
    K.put(K.visor({ w: 1.2, len: 0.42, z0: 0.95, y: 0.28, droop: 0.12, curve: 0.18 }), "b");
    K.put(K.cyl(0.04, 0.04, 0.32, { n: 8 }), "c", { p: [0, 1.18, -0.13] });
    K.put(K.box(1.3, 0.025, 0.16), "c", { p: [0, 1.34, -0.13], r: [0.15, 0.4, 0] });
    K.put(K.ball(0.07, 8), "c", { p: [0, 1.36, -0.13] });
  }, { tags: ["fun", "civ"] });

  def("catears", "Cat Ears", "fun", [cw(C.black, C.pink, C.black), cw(C.white, C.pink, C.white), cw(C.pink, C.white, C.pink)], function (K) {
    K.put(K.torus(1.04, 0.05, { arc: Math.PI, n: 22, m: 5 }), "a", { r: [0, Math.PI / 2, 0], p: [0, 0.02, 0.08] });
    for (const s of [-1, 1]) {
      K.put(K.cone(0.34, 0.55, { n: 4 }), "a", { p: [s * 0.52, 1.0, 0.08], r: [0, Math.PI / 4, s * -0.45], s: [1, 1, 0.45] });
      K.put(K.cone(0.22, 0.36, { n: 4 }), "b", { p: [s * 0.52, 0.99, 0.15], r: [0, Math.PI / 4, s * -0.45], s: [1, 1, 0.3] });
    }
  }, { fit: false, tags: ["fun"] });

  def("bunny", "Bunny Ears", "fun", [cw(C.white, C.pink, C.white), cw(C.pink, C.white, C.pink), cw(C.black, C.red, C.black)], function (K) {
    K.put(K.torus(1.04, 0.05, { arc: Math.PI, n: 22, m: 5 }), "a", { r: [0, Math.PI / 2, 0], p: [0, 0.02, 0.06] });
    for (const s of [-1, 1]) {
      K.put(K.tube([[s * 0.4, 0.92, 0.1], [s * 0.5, 1.45, 0.14], [s * 0.56, 2.0, 0.06], [s * 0.6, 2.3, -0.1]], function (t) { return 0.2 * Math.sin(Math.PI * (0.12 + 0.86 * t)) + 0.02; }, { n: 14, m: 8 }), "a", { s: [1, 1, 1] });
      K.put(K.tube([[s * 0.4, 1.0, 0.24], [s * 0.5, 1.45, 0.28], [s * 0.56, 1.95, 0.2]], function (t) { return 0.11 * Math.sin(Math.PI * (0.12 + 0.8 * t)) + 0.01; }, { n: 12, m: 6 }), "b", { s: [1, 1, 0.5] });
    }
  }, { fit: false, tags: ["fun"] });

  def("jester", "Jester Hat", "fun", [cw(C.red, C.yellow, C.gold), cw(C.purple, C.green, C.gold), cw(C.blue, C.red, C.gold)], function (K) {
    K.put(K.dome(1.07, 0.1, { n: 28, m: 10 }), "a", { r: [-0.1, 0, 0] });
    const tips = [[-1, "a"], [0, "b"], [1, "a"]];
    for (let i = 0; i < 3; i++) {
      const s = tips[i][0];
      K.put(K.tube([[s * 0.35, 0.75, -0.05], [s * 0.95, 1.25, -0.15], [s * 1.35, 1.1, -0.2], [s * 1.5, 0.7, -0.15]], function (t) { return 0.32 * (1 - 0.85 * t); }, { n: 14, m: 8 }), tips[i][1]);
      K.put(K.ball(0.13, 10), "c", { p: [s * 1.52, 0.6, -0.15] });
    }
    K.put(K.torus(1.07, 0.09, { n: 32, m: 6 }), "c", { r: [Math.PI / 2 - 0.1, 0, 0], p: [0, 0.16, 0.02] });
  }, { fit: false, tags: ["fun"] });

  def("knight", "Knight's Helm", "fun", [cw(C.steel, 0x14151a, C.gold), cw(0x9aa0a8, 0x14151a, C.red)], function (K) {
    // the great helm: a flat-topped barrel over the whole head, an eye slit
    K.put(K.cyl(1.14, 1.18, 2.2, { n: 28 }), "a", { p: [0, -0.15, 0] });
    K.put(K.box(1.3, 0.12, 0.2), "b", { p: [0, 0.22, 1.12] });
    K.put(K.box(0.08, 1.3, 0.08), "c", { p: [0, -0.15, 1.19] });
    for (let i = 0; i < 6; i++) K.put(K.ball(0.05, 6), "c", { p: [-0.5 + i * 0.2, -0.35, 1.17] });
  }, { tags: ["fun"] });

  def("cone", "Traffic Cone", "fun", [cw(C.orange, C.white, 0x202022)], function (K) {
    K.put(K.cone(0.86, 2.1, { n: 24, open: true }), "a", { p: [0, 1.48, 0] });
    K.put(K.cyl(0.62, 0.71, 0.26, { n: 24, open: true }), "b", { p: [0, 1.0, 0] });
    K.put(K.cyl(0.38, 0.46, 0.2, { n: 24, open: true }), "b", { p: [0, 1.6, 0] });
    K.put(K.box(1.8, 0.1, 1.8), "c", { p: [0, 0.47, 0] });
  }, { tags: ["fun"] });

  def("balaclava", "Balaclava", "street", [cw(C.black, 0xd8d4c8, 0x050507), cw(0x2a3a2a, 0xd8d4c8, 0x050507), cw(C.red, 0x101012, 0x050507), cw(C.navy, 0xd8d4c8, 0x050507)], function (K) {
    // the knit hood over the whole head, eye and mouth holes ringed bright
    K.put(K.sphere(1.05, { n: 28, m: 16 }), "a", { s: [1, 1.04, 1] });
    for (const s of [-1, 1]) K.put(K.torus(0.17, 0.04, { n: 14, m: 5 }), "b", { p: [s * 0.32, 0.18, 0.99], r: [0, s * 0.3, 0], s: [1.35, 0.85, 1] });
    K.put(K.torus(0.15, 0.04, { n: 12, m: 5 }), "b", { p: [0, -0.42, 0.93], r: [-0.4, 0, 0], s: [1.4, 0.8, 1] });
  }, { tags: ["crime"] });

  /* ---------------------------------------------------------------- the cache */
  let MAT = null;
  function material() {
    if (MAT) return MAT;
    MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide });
    MAT._shared = true; MAT.name = "hats";
    return MAT;
  }
  function colorOf(id, cwArg) {
    const d = BY[id]; if (!d) return null;
    let base = d.colorways[0];
    if (typeof cwArg === "number") base = d.colorways[((cwArg % d.colorways.length) + d.colorways.length) % d.colorways.length];
    else if (cwArg && typeof cwArg === "object") base = Object.assign({}, base, cwArg);
    return base;
  }
  function cwKey(cwRec) { return cwRec.a + "," + cwRec.b + "," + cwRec.c; }
  const GEO = new Map();
  let VERTS = 0;
  // merge parts (any filter) into one non-indexed geometry; colour optional
  const _c = new THREE.Color();
  // merge parts into ONE indexed geometry (shared vertices stay shared: a
  // crowd instance pays every vertex of every hat it might wear)
  function merge(parts, cwRec, withColour) {
    let n = 0, ni = 0;
    for (let i = 0; i < parts.length; i++) {
      const g = parts[i].g;
      if (!g.attributes.normal) g.computeVertexNormals();
      n += g.attributes.position.count;
      ni += g.index ? g.index.count : g.attributes.position.count;
    }
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = withColour ? new Float32Array(n * 3) : null;
    const idx = n > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let o = 0, io = 0;
    for (let i = 0; i < parts.length; i++) {
      const g = parts[i].g, P = g.attributes.position, N = g.attributes.normal, base = o / 3;
      for (let k = 0; k < P.count; k++) {
        pos[o + k * 3] = P.getX(k); pos[o + k * 3 + 1] = P.getY(k); pos[o + k * 3 + 2] = P.getZ(k);
        nrm[o + k * 3] = N.getX(k); nrm[o + k * 3 + 1] = N.getY(k); nrm[o + k * 3 + 2] = N.getZ(k);
      }
      if (col) {
        const key = parts[i].c, hex = typeof key === "number" ? key : (cwRec[key] != null ? cwRec[key] : 0xff00ff);
        // authored as the colour you SEE: the renderer writes sRGB, so the
        // vertex colour is stored linear (otherwise every hat reads pastel)
        _c.setHex(hex); _c.convertSRGBToLinear();
        for (let k = 0; k < P.count; k++) { col[o + k * 3] = _c.r; col[o + k * 3 + 1] = _c.g; col[o + k * 3 + 2] = _c.b; }
      }
      if (g.index) { const I = g.index; for (let k = 0; k < I.count; k++) idx[io++] = base + I.getX(k); }
      else for (let k = 0; k < P.count; k++) idx[io++] = base + k;
      o += P.count * 3;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    if (col) out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere(); out.computeBoundingBox();
    out._shared = true;
    VERTS += n;
    return out;
  }
  function built(id, lod) {
    const d = BY[id];
    const K = kit(lod);
    d.build(K);
    if (d.yaw) for (let i = 0; i < K.parts.length; i++) K.parts[i].g.rotateY(d.yaw);
    /* THE HAT SITS ON THE HEAD: NEVER IN IT, NEVER FLOATING OVER IT.
       Every hat is authored round a band of radius ~1.04 at height `seat`
       (default 0.2). On a ball that band only touches the head at the
       equator, so a hat that just rose until its crown cleared the skull
       left its band hanging in the air. Instead each hat is SEATED:
         s   a uniform scale (1 = as authored, down to 0.55: a smaller hat
             sits higher, where the ball is narrower, its band ON the skin)
         dy  the lift that puts the scaled band exactly on the ball
         k   a stretch of the crown over the band, if the skull would still
             poke through a flat top or a dent (capped per hat: `tall`)
       The largest hat that fits wins. Measured once per build. */
    if (d.fit !== false) {
      const yb = d.seat != null ? d.seat : 0.2, Rb = d.band || 1.04, kmax = d.tall || 1.3;
      const P0 = K.parts.map(function (p) { return p.g.attributes.position; });
      let best = null;
      for (let s = 1.0; s >= 0.549; s -= 0.025) {
        const rb = Rb * s;
        const dy = rb < 0.995 ? Math.sqrt(1 - rb * rb) + 0.012 - yb * s : 0;
        const ys = yb * s + dy;
        let k = 1;
        for (let i = 0; i < P0.length; i++) {
          const P = P0[i];
          for (let j = 0; j < P.count; j++) {
            const x = P.getX(j) * s, y = P.getY(j) * s + dy, z = P.getZ(j) * s, r2 = x * x + z * z;
            if (r2 > 0.6 || y < ys + 0.06) continue;
            const want = Math.sqrt(1.035 - r2);
            if (y < want) k = Math.max(k, (want - ys) / (y - ys));
          }
        }
        if (k <= kmax || s < 0.56) { best = { s: s, dy: dy, ys: ys, k: Math.min(k, 2.2) }; break; }
      }
      const B = best;
      if (B && (B.s < 0.999 || B.dy > 1e-4 || B.k > 1.0001)) for (let i = 0; i < K.parts.length; i++) {
        const g = K.parts[i].g, P = g.attributes.position;
        for (let j = 0; j < P.count; j++) {
          let y = P.getY(j) * B.s + B.dy;
          if (y > B.ys) y = B.ys + (y - B.ys) * B.k;
          P.setXYZ(j, P.getX(j) * B.s, y, P.getZ(j) * B.s);
        }
        P.needsUpdate = true;
        g.computeVertexNormals();
      }
      d._lift = B ? B.k - 1 : 0; d._fit = B;
    }
    return K.parts;
  }
  function geometry(id, o) {
    o = o || {};
    const d = BY[id]; if (!d) return null;
    const lod = o.lod ? Math.min(2, o.lod | 0) : 0, cwRec = colorOf(id, o.cw);
    const key = id + "|" + lod + "|" + cwKey(cwRec);
    let g = GEO.get(key);
    if (g) return g;
    g = merge(built(id, lod), cwRec, true);
    g.userData.hat = { id: id, lod: lod, cw: cwRec };
    GEO.set(key, g);
    return g;
  }
  // for a host that tints the primary per instance (the GPU crowd)
  const SPLIT = new Map();
  function split(id, o) {
    o = o || {};
    const d = BY[id]; if (!d) return null;
    const lod = o.lod ? Math.min(2, o.lod | 0) : 0, cwRec = colorOf(id, o.cw);
    const key = id + "|" + lod + "|" + cwKey(cwRec);
    let s = SPLIT.get(key);
    if (s) return s;
    const parts = built(id, lod);
    const main = parts.filter(function (p) { return p.c === "a"; }), detail = parts.filter(function (p) { return p.c !== "a"; });
    s = { main: main.length ? merge(main, cwRec, false) : null, detail: detail.length ? merge(detail, cwRec, true) : null };
    SPLIT.set(key, s);
    return s;
  }
  function mesh(id, o) {
    const g = geometry(id, o);
    if (!g) return null;
    const m = new THREE.Mesh(g, material());
    m.name = "hat:" + id;
    m.userData.hatId = id;
    m.castShadow = true; m.receiveShadow = false;
    return m;
  }
  // a deterministic pick (never the shared rng: appearance must be per seed)
  function pick(list, h) { return list && list.length ? list[((h >>> 0) % list.length)] : null; }

  CBZ.hats = {
    ids: function () { return CAT.map(function (d) { return d.id; }); },
    info: function (id) { const d = BY[id]; return d ? { id: d.id, name: d.name, group: d.group, colorways: d.colorways.slice(), tags: (d.tags || []).slice(), lift: d._lift || 0, fit: d._fit || null } : null; },
    has: function (id) { return !!BY[id]; },
    byTag: function (tag) { return CAT.filter(function (d) { return (d.tags || []).indexOf(tag) >= 0 || d.group === tag; }).map(function (d) { return d.id; }); },
    geometry: geometry,
    split: split,
    material: material,
    mesh: mesh,
    pick: pick,
    colorOf: colorOf,
    PALETTE: C,
    audit: function () { return { kinds: CAT.length, geometries: GEO.size + SPLIT.size, verts: VERTS }; },
    // the modelling kit and the merge, for other part libraries (entities/jewels.js)
    kit: kit,
    merge: merge,
    deform: deform,
  };
})();
