/* ============================================================
   city/carparts.js — the MANUFACTURER UNIVERSE + modular part library.

   Every car in the game belongs to one of six fictional marques, and each
   marque owns a DESIGN LANGUAGE: a grille signature, a headlight/taillight
   shape family, a badge, an exhaust layout and a bumper treatment. This file
   is the single vocabulary both the unified player-car visuals
   (city/playercars.js) and the legacy box rig (city/vehicles.js) consume, so
   two cars of the same brand read as siblings from across the street.

     BRANDS
       falcone — Italian exotic house. Low wide mouth, slanted slim lamps,
                 gold shield badge, twin round tails, centred quad exhaust.
       adler   — German precision marque. Twin chrome grille bars, oval
                 lamps + amber markers, chrome roundel, full-width tail bar,
                 dual oval pipes, chrome bumper strips.
       bison   — American muscle/truck giant. Tall slatted grille with a
                 thick chrome crossbar + red bowtie bar, square quad lamps,
                 VERTICAL stacked tails, offset dual pipes, chunky bumpers.
       voltra  — EV disruptor. Closed body-colour nose, slim LED brow,
                 chevron badge, full-width red tail blade, no exhaust.
       kotori  — Japanese economy giant. Slim upper slot + big lower mouth
                 ("smile"), compact rectangular lamps, red-dot badge, small
                 twin square tails, single hidden pipe.
       vitesse — French hyper-luxury house. Chrome horseshoe grille, slim
                 rectangular lamps, framed full-width tail, one huge centre
                 exhaust, gold V badge.

   HARD CONTRACTS honoured here (several systems key off material values):
     • headlight emissive g>0.6 && b>0.6      (dead-lamp swap on crash)
     • taillight emissive r>0.78 && g<0.45 && b<0.5   (brake-light flip)
     • glass colour b-r>0.045 && b<0.4 && r<0.25       (frost damage)
     • part meshes carry NO userData and only SHARED (cached) materials, so
       vehicles.js mergeStaticCarParts bakes them into per-material buckets.
     • deterministic: nothing here draws randomness — parts derive purely
       from brand/model/style, so multiplayer clients build identical cars.

   ON THE SKIN (the loft wave). The road bodies are curved shells now
   (city/carbody.js), so every face part is PLACED by `put()` onto the
   fascia grid the body publishes (ctx.fz / ctx.rz): a lamp sits on the
   bumper corner it belongs to, turned to the surface, instead of floating
   in front of a flat plane. Lamps are units (housing, chrome reflector, lit
   element; tails: dark red lens, lit bar, reverse lamp), every car carries a
   plain plate front and rear (no text, no marque), and the fleet liveries
   are built here too: model.livery "police" (white doors + roof over the
   black paint, a shaped roof bar whose red/blue halves city/police.js
   flashes by name, push bar, spotlight) and "taxi" (the roof sign).

   Loads BEFORE playercars.js / vehicles.js (index.html order).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  function vmat(role, color, opts) {
    return (CBZ.vehicleMat) ? CBZ.vehicleMat(role, color, opts)
                            : (CBZ.cmat || CBZ.mat)(color == null ? 0x888888 : color, opts);
  }

  // ---- shared caches (materials + geometries live for the whole session) ----
  const mats = new Map();
  function M(key, role, color, opts) {
    let m = mats.get(key);
    if (m) return m;
    m = vmat(role, color, opts);
    m._shared = true;
    mats.set(key, m);
    return m;
  }
  // colour-true cached material (carfx's named roles — plastic/chrome/metal/
  // light* — return fleet singletons that IGNORE the colour arg, so badges,
  // amber markers and the taxi sign would all come back grey/chrome through
  // vmat). Lambert + emissive keeps the exact colour and a night glow.
  function L(key, color, opts) {
    let m = mats.get(key);
    if (m) return m;
    m = (CBZ.cmat || CBZ.mat)(color, opts || {});
    m._shared = true;
    mats.set(key, m);
    return m;
  }
  // lamp materials — the carfx singletons satisfy the contracts exactly
  // (lightFront emissive 0xfff2cc: g,b>0.6; lightTail 0xff2020: r>0.78).
  const head = () => M("cp-head", "lightFront", 0xeaf8ff, { emissive: 0xc8efff, ei: 0.9 });
  const tail = () => M("cp-tail", "lightTail", 0xff3344, { emissive: 0xff2233, ei: 0.95 });
  // amber marker: emissive g=0.63 keeps it OUT of both lamp detectors.
  const amber = () => L("cp-amber", 0xffb347, { emissive: 0xffa028, ei: 0.7 });
  const chrome = () => M("cp-chrome", "chrome", 0xc4ccd4, { emissive: 0x262b31, ei: 0.3 });
  const grille = () => M("cp-grille", "plastic", 0x0d1014, { emissive: 0, ei: 0 });
  const darkTrim = () => M("cp-dark", "plastic", 0x14171c);
  const bumperM = () => L("cp-bumper", 0x23272d, { emissive: 0x0b0d10, ei: 0.3 });
  const badgeGold = () => L("cp-gold", 0xe8c14d, { emissive: 0x3a2f10, ei: 0.4 });
  const badgeRed = () => L("cp-bred", 0xd12b2b, { emissive: 0x330a0a, ei: 0.35 });
  const silverM = () => L("cp-silver", 0x9aa2ab, { emissive: 0x22262b, ei: 0.3 });

  const boxGeos = new Map();
  function boxGeo(w, h, d) {
    const k = w + "|" + h + "|" + d;
    let g3 = boxGeos.get(k);
    if (!g3) { g3 = new THREE.BoxGeometry(w, h, d); g3._shared = true; boxGeos.set(k, g3); }
    return g3;
  }
  const cylGeos = new Map();
  function cylGeo(r, h, seg) {
    const k = r + "|" + h + "|" + (seg || 12);
    let g3 = cylGeos.get(k);
    if (!g3) { g3 = new THREE.CylinderGeometry(r, r, h, seg || 12); g3._shared = true; cylGeos.set(k, g3); }
    return g3;
  }
  const torusGeos = new Map();
  function torGeo(r, t) {
    const k = r + "|" + t;
    let g3 = torusGeos.get(k);
    if (!g3) { g3 = new THREE.TorusGeometry(r, t, 6, 16); g3._shared = true; torusGeos.set(k, g3); }
    return g3;
  }

  function add(root, w, h, d, x, y, z, material) {
    const m = new THREE.Mesh(boxGeo(w, h, d), material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = false;
    root.add(m);
    return m;
  }
  // a round lamp / pipe facing ±z (cylinder spun onto the z axis).
  function addRound(root, r, depth, x, y, z, material, seg) {
    const m = new THREE.Mesh(cylGeo(r, depth, seg || 12), material);
    m.position.set(x, y, z);
    m.rotation.x = Math.PI / 2;
    m.castShadow = false;
    root.add(m);
    return m;
  }
  function addRing(root, r, t, x, y, z, material) {
    const m = new THREE.Mesh(torGeo(r, t), material);   // torus faces +z already
    m.position.set(x, y, z);
    m.castShadow = false;
    root.add(m);
    return m;
  }

  // ============================================================
  //  BRAND DEFINITIONS — palette bias feeds spawn colour steering,
  //  rim style feeds playercars' wheel factory, face() builds the
  //  grille/lamp/badge/exhaust identity on any body given anchors.
  // ============================================================
  const BRANDS = {
    falcone: { name: "Falcone", country: "Italian exotic house", rim: "twin10",
               palette: [0xd1262f, 0xf2c020, 0xe25822, 0x14161a, 0xeef1f4] },
    adler:   { name: "Adler", country: "German precision marque", rim: "turbine",
               palette: [0xb9c0c7, 0x191d24, 0x27436e, 0x5f6871, 0xe8eaee] },
    bison:   { name: "Bison", country: "American muscle & trucks", rim: "sixlug",
               palette: [0xe24b4b, 0x2f5f9e, 0x1c1f26, 0xd8dade, 0xe88a3c] },
    voltra:  { name: "Voltra", country: "EV disruptor", rim: "aero",
               palette: [0xeceff2, 0x67717b, 0x1470e3, 0xd1262f, 0x22262c] },
    kotori:  { name: "Kotori", country: "Japanese economy giant", rim: "steel",
               palette: [0x9fb4c4, 0x4caf6e, 0xd9d4c8, 0x6b6f78, 0xc9552e] },
    vitesse: { name: "Vitesse", country: "French hyper-luxury", rim: "turbine",
               palette: [0x202225, 0x27436e, 0x7d2bd6, 0xe8e4da] },
  };

  // which marque "makes" each playercars silhouette when no model is known
  // (style-cycler, studio pcar:<style> subjects, gang cars without a model).
  const STYLE_BRAND = {
    ferrari: "falcone", enzo: "falcone", aventador: "falcone",
    veyron: "vitesse", porsche: "adler",
    "tesla-s": "voltra", "tesla-3": "voltra", "tesla-x": "voltra", "tesla-y": "voltra",
    cybertruck: "voltra",
    muscle: "bison", lowrider: "bison", suv: "bison", van: "bison", pickup: "bison",
    hatch: "kotori",
  };

  // ---- legacy bumper masses: ONLY for a body that does not carry its own
  //      bumpers (the loft bodies do: ctx.noBumpers). ----
  function addBumpers(root, ctx, chromeStrip) {
    const w = ctx.w, bY = ctx.baseY;
    [[ctx.frontZ + 0.07, 1], [ctx.rearZ - 0.07, -1]].forEach(function (end) {
      const z = end[0];
      add(root, w * 1.02, 0.2, 0.22, 0, bY, z, bumperM());
      [1, -1].forEach(function (side) {
        add(root, 0.16, 0.2, 0.3, side * w * 0.46, bY, z - end[1] * 0.12, bumperM());
      });
      if (chromeStrip) add(root, w * 0.92, 0.045, 0.05, 0, bY + 0.12, z + end[1] * 0.01, chrome());
    });
  }

  /* ============================================================
     ON THE SKIN. A loft body publishes its nose and tail as a grid of
     surface z over (x, y) (carbody.js faceGrid). Every face part is placed
     by `put`: it sits ON the curved fascia at that (x, y), turned to the
     local surface normal, so a lamp at the bumper corner follows the corner
     instead of floating in front of it. A body without a grid (the legacy
     slabs) falls back to its flat frontZ/rearZ plane — the old behaviour.
  ============================================================ */
  function gridZ(G, x, y) {
    const xs = G.xs, ys = G.ys, Z = G.z;
    x = Math.abs(x);
    const fx = Math.max(0, Math.min(xs.length - 1.0001, (x - xs[0]) / (xs[1] - xs[0])));
    const fy = Math.max(0, Math.min(ys.length - 1.0001, (y - ys[0]) / (ys[1] - ys[0])));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    // a null cell = the point is outside the body there: use the nearest
    // valid cell inward (smaller x, then lower y)
    function at(ii, jj) {
      for (let a = ii; a >= 0; a--) if (Z[jj][a] != null) return Z[jj][a];
      for (let b = jj; b >= 0; b--) if (Z[b][ii] != null) return Z[b][ii];
      return null;
    }
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    const pick = (p, q) => (p == null ? q : q == null ? p : null);
    const ab = (a != null && b != null) ? a + (b - a) * u : pick(a, b);
    const cd = (c != null && d != null) ? c + (d - c) * u : pick(c, d);
    if (ab == null && cd == null) return null;
    if (ab == null) return cd;
    if (cd == null) return ab;
    return ab + (cd - ab) * v;
  }
  function surfZ(ctx, end, x, y) {
    const G = end > 0 ? ctx.fz : ctx.rz;
    const flat = end > 0 ? ctx.frontZ : ctx.rearZ;
    if (!G) return flat;
    const z = gridZ(G, x, y);
    return z == null ? flat : z;
  }
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _n = new THREE.Vector3(), _zA = new THREE.Vector3(0, 0, 1);
  // place `mesh` on the fascia at (x, y), `proud` metres out along the normal,
  // turned so its local +z is the outward normal (roll = extra spin about it)
  function put(mesh, ctx, end, x, y, proud, roll) {
    const e = 0.035;
    const z = surfZ(ctx, end, x, y);
    const zx = (surfZ(ctx, end, x + e, y) - surfZ(ctx, end, x - e, y)) / (2 * e);
    const zy = (surfZ(ctx, end, x, y + e) - surfZ(ctx, end, x, y - e)) / (2 * e);
    _n.set(-zx, -zy * end, 1).normalize();                 // the normal in the part's frame (rear parts are turned 180 about y)
    // limit the turn: a lamp on a corner wraps, it does not face sideways
    if (_n.z < 0.45) { _n.z = 0.45; _n.normalize(); }
    _q.setFromUnitVectors(_zA, _n);
    if (end < 0) { _q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); _q.premultiply(_q2); }
    if (roll) { _q2.setFromAxisAngle(_zA, roll); _q.multiply(_q2); }
    const wn = _n.clone(); if (end < 0) { wn.x = -wn.x; wn.z = -wn.z; }
    mesh.position.set(x + wn.x * proud, y + wn.y * proud, z + wn.z * proud);
    mesh.quaternion.copy(_q);
    return mesh;
  }

  // ---- shaped part geometry: rounded rectangles / discs, extruded -------
  const shapeGeos = new Map();
  // a rounded slab w x h, `d` deep, its FRONT face at z=0 (back at -d), a
  // small bevel on the front edge so it catches a highlight like a lens
  // a rounded slab w x h, `d` deep, its FRONT face at z=0: walls + a
  // chamfered front, NO back cap (it is always buried in the body) — ~50
  // triangles, a quarter of an ExtrudeGeometry's, because a face carries
  // two dozen of these and traffic carries dozens of faces
  function slabGeo(w, h, d, r, bevel) {
    const k = [w, h, d, r, bevel || 0].map((v) => (+v).toFixed(3)).join("|");
    let g = shapeGeos.get(k);
    if (g) return g;
    const b = Math.min(bevel || 0, d * 0.5, Math.min(w, h) * 0.2);
    r = Math.max(0, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3));
    const ring = (inset) => {
      const out = [], rr = Math.max(0, r - inset), hw = w / 2 - inset, hh = h / 2 - inset;
      const cs = [[hw - rr, hh - rr, 0], [-(hw - rr), hh - rr, Math.PI / 2], [-(hw - rr), -(hh - rr), Math.PI], [hw - rr, -(hh - rr), Math.PI * 1.5]];
      cs.forEach(function (c) {
        for (let i = 0; i <= 2; i++) { const a = c[2] + (Math.PI / 2) * i / 2; out.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]); }
      });
      return out;
    };
    const R0 = ring(0), R1 = ring(b), n = R0.length, pos = [];
    const tri = (A, B, C) => pos.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a0 = [R0[i][0], R0[i][1], -d], b0 = [R0[j][0], R0[j][1], -d], a1 = [R0[i][0], R0[i][1], -b], b1 = [R0[j][0], R0[j][1], -b];
      tri(a0, b0, b1); tri(a0, b1, a1);                                     // wall (ring is CCW: outward)
      if (b > 0) { const a2 = [R1[i][0], R1[i][1], 0], b2 = [R1[j][0], R1[j][1], 0]; tri(a1, b1, b2); tri(a1, b2, a2); }
    }
    const F = b > 0 ? R1 : R0;
    for (let i = 1; i + 1 < n; i++) tri([F[0][0], F[0][1], 0], [F[i][0], F[i][1], 0], [F[i + 1][0], F[i + 1][1], 0]);
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g._shared = true;
    shapeGeos.set(k, g);
    return g;
  }
  function slab(root, w, h, d, r, material, bevel) {
    const m = new THREE.Mesh(slabGeo(w, h, d, r, bevel), material);
    m.castShadow = false;
    m.userData.noSeal = true;
    root.add(m);
    return m;
  }

  // ---- face materials. DRAW CALLS: every distinct material is one more
  //      merged bucket per car, so these are few and shared fleet-wide. ----
  // near-black and UNLIT-ish: an opening in a bumper is a hole, it must not
  // catch the sun as a mid-grey slot (carfx's plastic singleton did exactly that)
  const holeM = () => L("cp-hole", 0x0b0c0e, { emissive: 0, ei: 0 });
  const rimM = () => L("cp-rim", 0x1a1d21, { emissive: 0x060708, ei: 0.4 });            // intake surrounds, fins, splitter
  const smokeM = () => L("cp-smoke", 0x10151b, { emissive: 0x06090c, ei: 0.5 });        // smoked lamp housing
  const reflector = () => M("cp-chrome", "chrome", 0xc4ccd4, { emissive: 0x262b31, ei: 0.3 });
  const tailLens = () => L("cp-taillens", 0x4a0a10, { emissive: 0x2a0306, ei: 0.5 });   // dark red outer lens (NOT a tail by the detector: r<0.78)
  const plateM = () => L("cp-plate", 0xe8ebef, { emissive: 0x30343a, ei: 0.35 });
  const reverseM = () => plateM();                                                      // unlit reverse lamp
  const grilleM = () => holeM();

  /* ============================================================
     SKIN PATCHES. A lamp or an intake is not a box stuck on the nose: it is
     a piece of the nose. skinPatch() samples the body's own fascia grid
     over a (u, v) parameter square mapped to (x, y), and lays a mesh `off`
     metres out along the local surface normal — so a headlamp that runs out
     to the bumper corner WRAPS round it toward the fender, and a smoked
     housing sits flush instead of standing 5 cm proud in a black frame.
     Built in the car frame (the mesh has no transform) and cached per
     (body template, brand), so every clone reuses the geometry.
  ============================================================ */
  function surfPt(ctx, end, x, y, off) {
    const e = 0.02;
    const z = surfZ(ctx, end, x, y);
    const zx = (surfZ(ctx, end, x + e, y) - surfZ(ctx, end, x - e, y)) / (2 * e);
    const zy = (surfZ(ctx, end, x, y + e) - surfZ(ctx, end, x, y - e)) / (2 * e);
    let nx = -zx * end, ny = -zy * end, nz = end;
    if (end < 0) { nx = zx; ny = zy; nz = -1; }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    return { p: [x + nx * off, y + ny * off, z + nz * off], n: [nx, ny, nz] };
  }
  // map(u, v) -> [x, y]; u across (nu cells), v up (nv cells)
  function skinPatch(ctx, end, map, nu, nv, off, walls) {
    const P = [], N = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const xy = map(i / nu, j / nv), s = surfPt(ctx, end, xy[0], xy[1], off);
      P.push(s.p); N.push(s.n);
    }
    const pos = [], nor = [];
    const idx = (i, j) => j * (nu + 1) + i;
    const push = (k) => { pos.push(P[k][0], P[k][1], P[k][2]); nor.push(N[k][0], N[k][1], N[k][2]); };
    const tri = (a, b, c) => {
      const A = P[a], B = P[b], C = P[c];
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      if (Math.hypot(fx, fy, fz) < 1e-10) return;
      if (fx * N[a][0] + fy * N[a][1] + fz * N[a][2] >= 0) { push(a); push(b); push(c); } else { push(a); push(c); push(b); }
    };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      tri(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)); tri(idx(i, j), idx(i + 1, j + 1), idx(i, j + 1));
    }
    // RIM: the opening's wall, from the skin out to `walls.h`, facing in —
    // what makes a black patch read as a HOLE with depth and not as paint
    if (walls) {
      const ring = [];
      for (let i = 0; i <= nu; i++) ring.push([i / nu, 0]);
      for (let j = 1; j <= nv; j++) ring.push([1, j / nv]);
      for (let i = nu - 1; i >= 0; i--) ring.push([i / nu, 1]);
      for (let j = nv - 1; j >= 1; j--) ring.push([0, j / nv]);
      const cxy = map(0.5, 0.5);
      for (let k = 0; k < ring.length; k++) {
        const r0 = ring[k], r1 = ring[(k + 1) % ring.length];
        const a = map(r0[0], r0[1]), b = map(r1[0], r1[1]);
        const pa0 = surfPt(ctx, end, a[0], a[1], off), pb0 = surfPt(ctx, end, b[0], b[1], off);
        const pa1 = surfPt(ctx, end, a[0], a[1], off + walls.h), pb1 = surfPt(ctx, end, b[0], b[1], off + walls.h);
        // outward in-plane direction of this edge = away from the centre
        const mx = (a[0] + b[0]) / 2 - cxy[0], my = (a[1] + b[1]) / 2 - cxy[1];
        const wall = [pa0.p, pb0.p, pb1.p, pa1.p];
        const ux = wall[1][0] - wall[0][0], uy = wall[1][1] - wall[0][1], uz = wall[1][2] - wall[0][2];
        const vx = wall[3][0] - wall[0][0], vy = wall[3][1] - wall[0][1], vz = wall[3][2] - wall[0][2];
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz;
        const inward = -(fx * mx + fy * my) >= 0;
        const n = inward ? [fx, fy] : [-fx, -fy];
        const nl = Math.hypot(n[0], n[1]) || 1;
        const nn = [n[0] / nl, n[1] / nl, 0];
        const q = inward ? [wall[0], wall[1], wall[2], wall[3]] : [wall[0], wall[3], wall[2], wall[1]];
        [[0, 1, 2], [0, 2, 3]].forEach(function (t) { t.forEach(function (ti) { pos.push(q[ti][0], q[ti][1], q[ti][2]); nor.push(nn[0], nn[1], nn[2]); }); });
        // the lip on top of the wall, a thin band outward (the bezel face)
        const w = walls.lip || 0.012, ml = Math.hypot(mx, my) || 1;
        const ox = mx / ml * w, oy = my / ml * w;
        const pa2 = surfPt(ctx, end, a[0] + ox, a[1] + oy, off + walls.h * 0.6), pb2 = surfPt(ctx, end, b[0] + ox, b[1] + oy, off + walls.h * 0.6);
        const lip = [pa1.p, pb1.p, pb2.p, pa2.p], ln = pa1.n;
        const lu = [lip[1][0] - lip[0][0], lip[1][1] - lip[0][1], lip[1][2] - lip[0][2]], lv = [lip[3][0] - lip[0][0], lip[3][1] - lip[0][1], lip[3][2] - lip[0][2]];
        const lf = [lu[1] * lv[2] - lu[2] * lv[1], lu[2] * lv[0] - lu[0] * lv[2], lu[0] * lv[1] - lu[1] * lv[0]];
        const ok = lf[0] * ln[0] + lf[1] * ln[1] + lf[2] * ln[2] >= 0;
        const lq = ok ? lip : [lip[0], lip[3], lip[2], lip[1]];
        [[0, 1, 2], [0, 2, 3]].forEach(function (t) { t.forEach(function (ti) { pos.push(lq[ti][0], lq[ti][1], lq[ti][2]); nor.push(ln[0], ln[1], ln[2]); }); });
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.computeBoundingSphere();
    g._shared = true;
    return g;
  }
  function addGeo(root, geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    m.userData.noSeal = true;
    root.add(m);
    return m;
  }
  // a swept band: x from xa to xb, centre y and height varying linearly,
  // ends rounded by `round` (0 square .. 1 pill)
  function band(xa, xb, ya, yb, ha, hb, round) {
    return function (u, v) {
      const r = round == null ? 0.5 : round;
      const e = Math.min(u, 1 - u) * 2;                       // 0 at the ends
      const k = r > 0 ? Math.pow(Math.min(1, e / 0.35), 0.5) * r + (1 - r) : 1;
      const h = (ha + (hb - ha) * u) * Math.max(0.35, k);
      return [xa + (xb - xa) * u, ya + (yb - ya) * u + (v - 0.5) * h];
    };
  }
  function disc(cx, cy, rx, ry) {
    return function (u, v) { const a = u * Math.PI * 2; return [cx + Math.cos(a) * rx * v, cy + Math.sin(a) * ry * v]; };
  }

  /* HEADLAMP CLUSTER: a smoked housing laid flush on the nose, running from
     `xi` out to `xo` (signed: the side is in the sign) and wrapping the
     corner; inside it a thin bright strip (the lightFront singleton —
     carlamps pushes it at night, crashdeform kills it) and/or projector
     dots, and a chrome sliver of reflector under the strip. */
  // the outer end of a cluster never runs past the skin at ANY height it
  // spans (a tall tail over a rolled deck edge would sample empty grid and
  // spike off the corner)
  function clampOuter(ctx, end, o) {
    const yo = o.y + (o.slant || 0), hh = Math.max(o.hi || 0, o.ho || 0) / 2;
    let m = o.xo;
    for (let k = 0; k <= 4; k++) m = Math.min(m, cornerX(ctx, end, yo - hh + (2 * hh) * k / 4, 0.025));
    o.xo = Math.max(o.xi + 0.04, m);
  }
  function headCluster(root, ctx, o) {
    clampOuter(ctx, 1, o);
    const s = o.side, yi = o.y, yo = o.y + (o.slant || 0);
    const xi = s * o.xi, xo = s * o.xo;
    addGeo(root, skinPatch(ctx, 1, band(xi, xo, yi, yo, o.hi, o.ho, o.round), 10, 2, 0.006), smokeM());
    const ei = xi + s * (o.xo - o.xi) * 0.06, eo = xo - s * (o.xo - o.xi) * 0.05;
    const ey = o.stripAt != null ? o.stripAt : 0.26;           // strip centre, fraction of height above the middle
    const eh = o.strip != null ? o.strip : 0.24;
    if (eh > 0) addGeo(root, skinPatch(ctx, 1, band(ei, eo, yi + o.hi * ey, yo + o.ho * ey, o.hi * eh, o.ho * eh, 1), 8, 1, 0.011), head());
    addGeo(root, skinPatch(ctx, 1, band(ei, eo, yi - o.hi * 0.22, yo - o.ho * 0.22, o.hi * 0.12, o.ho * 0.12, 1), 8, 1, 0.009), reflector());
    (o.dots || []).forEach(function (f) {
      const x = xi + (xo - xi) * f, y = yi + (yo - yi) * f - o.hi * 0.05;
      const r = Math.min(o.hi, o.ho) * (o.dotR || 0.3);
      addGeo(root, skinPatch(ctx, 1, disc(x, y, r, r), 10, 1, 0.012), head());
    });
  }
  /* TAIL CLUSTER: a dark red lens wrapping the rear corner, a thinner lit
     band inside it (the lightTail singleton — braking brightens it), and a
     reverse lamp at the inboard end. */
  function tailCluster(root, ctx, o) {
    if (!o.round) clampOuter(ctx, -1, o);
    const s = o.side, xi = s * o.xi, xo = s * o.xo;
    const yi = o.y, yo = o.y + (o.slant || 0);
    if (o.round) {
      addGeo(root, skinPatch(ctx, -1, disc(xi, yi, o.hi / 2, o.hi / 2), 12, 1, 0.006), tailLens());
      addGeo(root, skinPatch(ctx, -1, disc(xi, yi, o.hi * 0.3, o.hi * 0.3), 10, 1, 0.011), tail());
      return;
    }
    addGeo(root, skinPatch(ctx, -1, band(xi, xo, yi, yo, o.hi, o.ho, 0.35), 10, 2, 0.006), tailLens());
    const f0 = o.rev ? 0.22 : 0.05;
    const bi = xi + (xo - xi) * f0, bo = xo - (xo - xi) * 0.04;
    addGeo(root, skinPatch(ctx, -1, band(bi, bo, yi + (yo - yi) * f0 + o.hi * 0.12, yo + o.ho * 0.12, o.hi * 0.34, o.ho * 0.34, 1), 8, 1, 0.011), tail());
    if (o.rev) {
      const ri = xi + (xo - xi) * 0.03, ro = xi + (xo - xi) * 0.19;
      addGeo(root, skinPatch(ctx, -1, band(ri, ro, yi, yi + (yo - yi) * 0.19, o.hi * 0.5, o.hi * 0.5, 1), 3, 1, 0.011), reverseM());
    }
  }
  /* AN OPENING: near-black, with a rim wall standing out of the skin
     around it so it reads as a recess with depth; `fins` horizontal bars
     across it; `lip` a splitter blade along its bottom edge. */
  function intake(root, ctx, end, x, y, w, h, o) {
    o = o || {};
    const map = band(x - w / 2, x + w / 2, y, y + (o.slant || 0), h, h, o.round == null ? 0.35 : o.round);
    addGeo(root, skinPatch(ctx, end, map, 8, 1, 0.003), holeM());
    addGeo(root, skinPatch(ctx, end, map, 8, 1, 0.003, { h: o.depth || 0.03, lip: o.bezel || 0.012 }), o.chrome ? reflector() : rimM());
    for (let i = 1; i <= (o.fins || 0); i++) {
      const fy = y - h / 2 + h * i / ((o.fins || 0) + 1);
      addGeo(root, skinPatch(ctx, end, band(x - w / 2 + 0.02, x + w / 2 - 0.02, fy, fy + (o.slant || 0), 0.014, 0.014, 0), 6, 1, 0.018), o.chrome ? reflector() : rimM());
    }
    if (o.lip) splitter(root, ctx, end, x - w / 2 - 0.04, x + w / 2 + 0.04, y - h / 2 - 0.03, o.lip);
  }
  // a thin blade standing out of the skin along a line (the splitter lip)
  function splitter(root, ctx, end, x0, x1, y, depth) {
    const n = 10, pos = [], nor = [];
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n;
      const a = surfPt(ctx, end, x, y, 0), b = surfPt(ctx, end, x, y, depth);
      const c = [b.p[0], b.p[1] - 0.018, b.p[2]], d = [a.p[0], a.p[1] - 0.018, a.p[2]];
      pts.push([a.p, b.p, c, d]);
    }
    const quad = (A, B, C, D, nn) => { [A, B, C, A, C, D].forEach((p) => { pos.push(p[0], p[1], p[2]); nor.push(nn[0], nn[1], nn[2]); }); };
    for (let i = 0; i < n; i++) {
      const P0 = pts[i], P1 = pts[i + 1];
      quad(P0[0], P1[0], P1[1], P0[1], [0, 1, 0]);                        // top
      quad(P0[1], P1[1], P1[2], P0[2], [0, 0, end]);                      // front edge
      quad(P0[3], P0[2], P1[2], P1[3], [0, -1, 0]);                       // underside
    }
    // wind every triangle to its stated normal
    for (let t = 0; t < pos.length; t += 9) {
      const ux = pos[t + 3] - pos[t], uy = pos[t + 4] - pos[t + 1], uz = pos[t + 5] - pos[t + 2];
      const vx = pos[t + 6] - pos[t], vy = pos[t + 7] - pos[t + 1], vz = pos[t + 8] - pos[t + 2];
      const f = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      if (f[0] * nor[t] + f[1] * nor[t + 1] + f[2] * nor[t + 2] < 0) {
        for (let k = 0; k < 3; k++) { const tmp = pos[t + 3 + k]; pos[t + 3 + k] = pos[t + 6 + k]; pos[t + 6 + k] = tmp; }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.computeBoundingSphere();
    addGeo(root, g, rimM());
  }
  // a plain plate in a dark recess (no marque, no text)
  function plate(root, ctx, end, y) {
    put(slab(root, 0.56, 0.16, 0.03, 0.012, holeM()), ctx, end, 0, y, 0.004);
    put(slab(root, 0.52, 0.12, 0.02, 0.01, plateM()), ctx, end, 0, y, 0.014);
  }
  function pipe(root, ctx, x, y, r, material) {
    const m = new THREE.Mesh(cylGeo(r, 0.16, 12), material || chrome());
    m.castShadow = false;
    const z = surfZ(ctx, -1, x, y);
    m.position.set(x, y, z - 0.02);
    m.rotation.x = Math.PI / 2;
    root.add(m);
    const inner = new THREE.Mesh(cylGeo(r * 0.72, 0.165, 10), holeM());
    inner.position.copy(m.position); inner.rotation.x = Math.PI / 2;
    root.add(inner);
  }
  // the lamp corner x: out to the body's side at that height, less a margin
  function cornerX(ctx, end, y, margin) {
    const G = end > 0 ? ctx.fz : ctx.rz;
    let x = ctx.w * 0.47;
    if (G) {
      // the widest x that still has surface in the grid at this height
      const j = Math.max(0, Math.min(G.ys.length - 1, Math.round((y - G.ys[0]) / (G.ys[1] - G.ys[0]))));
      for (let i = G.xs.length - 1; i >= 0; i--) if (G.z[j][i] != null) { x = G.xs[i]; break; }
    }
    return x - (margin == null ? 0.03 : margin);
  }

  // ============================================================
  //  BRAND FACES — the design language, laid INTO the skin.
  //  No badges: the house rule is no invented logos, so a marque is
  //  told apart by its lamps, its openings and its tail, not a plaque.
  // ============================================================
  const FACES = {
    falcone: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      [1, -1].forEach(function (s) {
        headCluster(root, ctx, { side: s, xi: w * 0.17, xo: cornerX(ctx, 1, hy + 0.02, 0.02), y: hy - 0.01, slant: 0.035, hi: 0.055, ho: 0.095, strip: 0.2, stripAt: 0.22, round: 0.6 });
        intake(root, ctx, 1, s * w * 0.34, ctx.baseY + 0.08, w * 0.17, 0.12, { fins: 1, slant: 0.02, lip: 0.05 });
      });
      intake(root, ctx, 1, 0, ctx.baseY + 0.06, w * 0.40, 0.10, { fins: 2, lip: 0.06 });
      [1, -1].forEach(function (s) {
        [0.37, 0.23].forEach(function (fx) { tailCluster(root, ctx, { side: s, xi: w * fx, y: ctx.tailY, hi: 0.13, round: true }); });
      });
      intake(root, ctx, -1, 0, ctx.baseY + 0.02, w * 0.62, 0.11, { fins: 0 });
      [-0.2, -0.08, 0.08, 0.2].forEach(function (fx) { pipe(root, ctx, fx * w, ctx.baseY + 0.02, 0.042); });
      plate(root, ctx, -1, (ctx.baseY + ctx.tailY) / 2 + 0.02);
    },
    adler: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      if (!ctx.noBumpers) addBumpers(root, ctx, true);
      intake(root, ctx, 1, 0, hy - 0.05, w * 0.34, 0.11, { fins: 2, chrome: true, round: 0.5 });
      intake(root, ctx, 1, 0, ctx.baseY + 0.04, w * 0.54, 0.08, { fins: 0, lip: ctx.sport ? 0.05 : 0 });
      [1, -1].forEach(function (s) {
        headCluster(root, ctx, { side: s, xi: w * 0.22, xo: cornerX(ctx, 1, hy, 0.03), y: hy, slant: 0.01, hi: 0.10, ho: 0.12, strip: 0.12, stripAt: 0.36, dots: [0.3, 0.62], dotR: 0.28, round: 0.9 });
        tailCluster(root, ctx, { side: s, xi: w * 0.12, xo: cornerX(ctx, -1, ctx.tailY, 0.02), y: ctx.tailY, slant: 0.01, hi: 0.07, ho: 0.10, rev: true });
      });
      [1, -1].forEach(function (s) { pipe(root, ctx, s * w * 0.3, ctx.baseY + 0.02, 0.045); });
      plate(root, ctx, 1, ctx.baseY + 0.04);
      plate(root, ctx, -1, (ctx.baseY + ctx.tailY) / 2 - 0.02);
    },
    bison: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      if (!ctx.noBumpers) addBumpers(root, ctx, true);
      const gH = Math.max(0.16, Math.min(0.30, (hy - ctx.baseY) * 1.0));
      const gy = (hy + ctx.baseY) / 2 + 0.04;
      intake(root, ctx, 1, 0, gy, w * 0.46, gH, { fins: 3, round: 0.2, depth: 0.035 });
      addGeo(root, skinPatch(ctx, 1, band(-w * 0.25, w * 0.25, gy, gy, 0.045, 0.045, 0.3), 8, 1, 0.03), reflector());   // chrome crossbar
      [1, -1].forEach(function (s) {
        headCluster(root, ctx, { side: s, xi: w * 0.27, xo: cornerX(ctx, 1, hy, 0.02), y: hy, hi: 0.12, ho: 0.13, strip: 0.14, stripAt: 0.36, dots: [0.28, 0.66], dotR: 0.3, round: 0.3 });
      });
      const tH = Math.max(0.2, Math.min(0.42, (ctx.tailTopY || ctx.tailY + 0.2) - ctx.baseY - 0.12));
      const tx = ctx.tailX != null ? ctx.tailX : cornerX(ctx, -1, ctx.tailY, 0.03) - 0.05;
      const tw = ctx.tailW || 0.16;
      [1, -1].forEach(function (s) { tailCluster(root, ctx, { side: s, xi: tx - tw / 2, xo: tx + tw / 2 + (ctx.tailX != null ? 0 : 0.05), y: ctx.tailY, hi: tH, ho: tH * 0.9, rev: false }); });
      [1, -1].forEach(function (s) { pipe(root, ctx, s * w * 0.32, ctx.baseY - 0.01, 0.05); });
      plate(root, ctx, 1, ctx.baseY + 0.02);
      plate(root, ctx, -1, ctx.rearPlateY != null ? ctx.rearPlateY : (ctx.baseY + ctx.tailY) / 2);
    },
    voltra: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      if (!ctx.noBumpers) addBumpers(root, ctx, false);
      // closed nose: slim swept lamps, a fine dark upper grille line between
      // them, a low aero intake with a lip
      [1, -1].forEach(function (s) {
        headCluster(root, ctx, { side: s, xi: w * 0.19, xo: cornerX(ctx, 1, hy + 0.02, 0.02), y: hy, slant: 0.03, hi: 0.05, ho: 0.095, strip: 0.2, stripAt: 0.18, dots: [0.72], dotR: 0.22, round: 0.7 });
      });
      intake(root, ctx, 1, 0, hy - 0.07, w * 0.30, 0.03, { fins: 0, depth: 0.018, bezel: 0.008, round: 1 });
      intake(root, ctx, 1, 0, ctx.baseY + 0.05, w * 0.46, 0.08, { fins: 1, lip: ctx.sport ? 0.05 : 0.025 });
      // wraparound tails joined by a thin light line
      [1, -1].forEach(function (s) {
        tailCluster(root, ctx, { side: s, xi: w * 0.2, xo: cornerX(ctx, -1, ctx.tailY, 0.02), y: ctx.tailY, slant: 0.015, hi: 0.05, ho: 0.08 });
      });
      addGeo(root, skinPatch(ctx, -1, band(-w * 0.21, w * 0.21, ctx.tailY + 0.005, ctx.tailY + 0.005, 0.018, 0.018, 1), 10, 1, 0.009), tail());
      intake(root, ctx, -1, 0, ctx.baseY + 0.02, w * 0.5, 0.07, { fins: 0 });
      plate(root, ctx, -1, (ctx.baseY + ctx.tailY) / 2 - 0.02);
    },
    kotori: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      if (!ctx.noBumpers) addBumpers(root, ctx, false);
      intake(root, ctx, 1, 0, hy, w * 0.32, 0.05, { fins: 0, round: 1 });
      intake(root, ctx, 1, 0, ctx.baseY + 0.08, w * 0.48, 0.13, { fins: 2, round: 0.8 });
      [1, -1].forEach(function (s) {
        headCluster(root, ctx, { side: s, xi: w * 0.2, xo: cornerX(ctx, 1, hy, 0.02), y: hy, slant: 0.02, hi: 0.07, ho: 0.10, strip: 0.16, stripAt: 0.3, dots: [0.35], dotR: 0.34, round: 0.6 });
        tailCluster(root, ctx, { side: s, xi: w * 0.24, xo: cornerX(ctx, -1, ctx.tailY, 0.02), y: ctx.tailY, slant: 0.01, hi: 0.10, ho: 0.13, rev: true });
      });
      pipe(root, ctx, -w * 0.28, ctx.baseY - 0.01, 0.038);
      plate(root, ctx, 1, ctx.baseY - 0.02);
      plate(root, ctx, -1, (ctx.baseY + ctx.tailY) / 2 - 0.02);
    },
    vitesse: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      // the horseshoe grille front and centre, chrome-rimmed
      intake(root, ctx, 1, 0, hy - 0.06, 0.2, 0.19, { fins: 2, chrome: true, round: 1 });
      intake(root, ctx, 1, 0, ctx.baseY + 0.04, w * 0.6, 0.08, { fins: 0, lip: 0.05 });
      [1, -1].forEach(function (s) {
        headCluster(root, ctx, { side: s, xi: w * 0.2, xo: cornerX(ctx, 1, hy, 0.02), y: hy, slant: 0.015, hi: 0.05, ho: 0.07, strip: 0.22, stripAt: 0.2, dots: [0.4, 0.7], dotR: 0.3, round: 0.8 });
        tailCluster(root, ctx, { side: s, xi: w * 0.08, xo: cornerX(ctx, -1, ctx.tailY, 0.02), y: ctx.tailY, hi: 0.07, ho: 0.09 });
      });
      intake(root, ctx, -1, 0, ctx.baseY + 0.02, 0.22, 0.12, { fins: 0, chrome: true, round: 0.6 });   // the one big exhaust
    },
  };

  function brandForStyle(style) { return STYLE_BRAND[style] || "bison"; }

  /* The face depends only on the body template and the marque, so it is
     BUILT ONCE per (template ctx, brand) and every clone gets meshes that
     share its geometry — the conforming patches cost real work to sample
     and none of it needs repeating per car in traffic. */
  const faceCache = new WeakMap();
  function applyBrandFace(root, brandKey, ctx) {
    const face = FACES[brandKey] || FACES.bison;
    let per = faceCache.get(ctx);
    if (!per) { per = new Map(); faceCache.set(ctx, per); }
    let parts = per.get(brandKey);
    if (!parts) {
      const tmp = new THREE.Group();
      face(tmp, ctx);
      parts = [];
      tmp.children.forEach(function (m) {
        if (m.geometry) m.geometry._shared = true;
        parts.push({ geo: m.geometry, mat: m.material, p: m.position.clone(), q: m.quaternion.clone(), s: m.scale.clone(), noSeal: !!(m.userData && m.userData.noSeal) });
      });
      per.set(brandKey, parts);
    }
    for (let i = 0; i < parts.length; i++) {
      const P = parts[i], m = new THREE.Mesh(P.geo, P.mat);
      m.position.copy(P.p); m.quaternion.copy(P.q); m.scale.copy(P.s);
      m.castShadow = false;
      if (P.noSeal) m.userData.noSeal = true;
      root.add(m);
    }
  }

  // ---- a strip laid along the body's top line (stripes), skipping glass ---
  function topStrip(root, ctx, xOff, halfW, material, lift) {
    if (!ctx.lines || !ctx.lines.top) return;
    const T = ctx.lines.top, pos = [];
    for (let i = 0; i + 1 < T.length; i++) {
      const a = T[i], b = T[i + 1];
      const onGlass = (g) => g > 0.02 && g < 0.98;
      if (onGlass(a[4]) || onGlass(b[4])) continue;
      const ya = a[1] + lift, yb = b[1] + lift;
      const x0 = xOff - halfW, x1 = xOff + halfW;
      pos.push(x0, ya, a[0], x1, ya, a[0], x1, yb, b[0], x0, ya, a[0], x1, yb, b[0], x0, yb, b[0]);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.userData.noSeal = true;
    root.add(m);
  }
  function topAt(ctx, z) {
    const T = ctx.lines && ctx.lines.top;
    if (!T) return ctx.noseTopY;
    for (let i = 0; i + 1 < T.length; i++) if (z >= T[i][0] && z <= T[i + 1][0]) {
      const u = (z - T[i][0]) / Math.max(1e-6, T[i + 1][0] - T[i][0]);
      return T[i][1] + (T[i + 1][1] - T[i][1]) * u;
    }
    return T[z < T[0][0] ? 0 : T.length - 1][1];
  }

  // ---- ROOF ACCESSORIES ----------------------------------------------------
  const extr = new Map();
  // a trapezoid prism across x: the taxi sign / lightbar body
  function trapGeo(w, h, dBot, dTop) {
    const k = [w, h, dBot, dTop].join("|");
    let g = extr.get(k);
    if (g) return g;
    const s = new THREE.Shape();
    s.moveTo(-dBot / 2, 0); s.lineTo(dBot / 2, 0); s.lineTo(dTop / 2, h); s.lineTo(-dTop / 2, h); s.lineTo(-dBot / 2, 0);
    g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 1 });
    g.translate(0, 0, -w / 2);
    g.rotateY(Math.PI / 2);        // extrude axis z -> x; the trapezoid now spans z (depth) and y
    g.computeVertexNormals();
    g._shared = true;
    extr.set(k, g);
    return g;
  }
  function addTaxiSign(root, ctx) {
    const signM = L("cp-taxisign", 0xf8e46b, { emissive: 0x8a7020, ei: 0.7 });
    const z = ctx.roofZ || 0;
    add(root, 0.5, 0.03, 0.18, 0, ctx.roofY + 0.012, z, darkTrim()).userData.noSeal = true;   // mount
    const s = new THREE.Mesh(trapGeo(0.62, 0.17, 0.28, 0.12), signM);
    s.position.set(0, ctx.roofY + 0.025, z);
    s.userData.noSeal = true;
    root.add(s);
    if (!ctx.loft) add(root, ctx.w + 0.03, 0.1, ctx.len * 0.46, 0, ctx.bodyY + ctx.baseH * 0.5, -ctx.len * 0.03, darkTrim());
  }
  function addRoofRails(root, ctx) {
    const railM = L("cp-rail", 0x8f979f, { emissive: 0x1a1d22, ei: 0.3 });
    [1, -1].forEach(function (side) {
      add(root, 0.05, 0.05, (ctx.roofLen || ctx.len * 0.36) * 0.86, side * (ctx.roofW || ctx.w * 0.8) * 0.44, ctx.roofY + 0.01, ctx.roofZ || 0, railM).userData.noSeal = true;
    });
  }

  /* THE BLACK-AND-WHITE (model.livery "police"). Doors and the roof/pillars
     (the loft's "upper" paint zone) go white over the car's black paint; a
     shaped roof bar whose red and blue halves are the visibility-flip
     meshes city/police.js flashes (it finds them by name — see rbDecorate),
     a push bar and a driver's-side spotlight. The white is NOT _bodyPaint, so
     a respray leaves the livery alone. */
  let policeWhite = null;
  function whitePaint() {
    if (policeWhite) return policeWhite;
    const m = vmat("paint", 0xeef1f4, { metalness: 0.3, roughness: 0.4 });
    if (m.flatShading) { m.flatShading = false; m.needsUpdate = true; }
    m._bodyPaint = false; m._shared = true;
    policeWhite = m;
    return m;
  }
  const lbMats = {};
  function lbMat(k, c) {
    if (!lbMats[k]) { lbMats[k] = new THREE.MeshBasicMaterial({ color: c }); lbMats[k]._shared = true; }
    return lbMats[k];
  }
  function policeLightbar(ctx) {
    const bar = new THREE.Group();
    bar.name = "police_lightbar";
    const base = new THREE.Mesh(trapGeo(1.12, 0.05, 0.3, 0.26), darkTrim());
    base.name = "lb_base"; bar.add(base);
    const red = new THREE.Mesh(trapGeo(0.44, 0.075, 0.26, 0.2), lbMat("red", 0xff2d3e));
    red.name = "lb_red"; red.position.set(0.3, 0.05, 0); bar.add(red);
    const blue = new THREE.Mesh(trapGeo(0.44, 0.075, 0.26, 0.2), lbMat("blue", 0x2d6bff));
    blue.name = "lb_blue"; blue.position.set(-0.3, 0.05, 0); bar.add(blue);
    const mid = new THREE.Mesh(trapGeo(0.14, 0.06, 0.24, 0.2), lbMat("mid", 0xdfe9f4));
    mid.name = "lb_mid"; mid.position.set(0, 0.05, 0); bar.add(mid);
    bar.position.set(0, ctx.roofY + 0.012, (ctx.roofZ || 0) + (ctx.roofLen || 1) * 0.12);
    bar.traverse(function (o) { o.userData.noSeal = true; });
    return bar;
  }
  function applyPolice(root, ctx) {
    const white = whitePaint();
    root.traverse(function (o) {
      if (!o.material || !o.userData) return;
      const z = o.userData.paintZone;
      if (z === "upper" || z === "door") o.material = white;
    });
    root.add(policeLightbar(ctx));
    // push bar: a blade + two uprights ahead of the nose
    const pbY = ctx.baseY + 0.16, w = ctx.w;
    const z = surfZ(ctx, 1, 0, pbY) + 0.1;
    add(root, w * 0.5, 0.2, 0.06, 0, pbY, z, darkTrim()).userData.noSeal = true;
    [1, -1].forEach(function (s) { add(root, 0.06, 0.34, 0.06, s * w * 0.2, pbY - 0.02, z - 0.02, darkTrim()).userData.noSeal = true; });
    // A-pillar spotlight, driver's side (+x)
    const sp = new THREE.Mesh(cylGeo(0.06, 0.12, 10), reverseM());
    sp.rotation.x = Math.PI / 2;
    sp.position.set(ctx.w * 0.47, (ctx.beltY || ctx.roofY - 0.4) + 0.12, (ctx.zCowl != null ? ctx.zCowl : 0.8) - 0.3);
    sp.userData.noSeal = true;
    root.add(sp);
  }

  // ============================================================
  //  PER-MODEL IDENTITY — the small bolt-ons that split two
  //  same-silhouette siblings apart, plus the fleet liveries.
  // ============================================================
  function applyModelIdentity(root, model, ctx) {
    if (!model || !ctx) return;
    const ds = model.designStyle;
    if (model.livery === "police") applyPolice(root, ctx);
    if (model.livery === "taxi" || ds === "cab") addTaxiSign(root, ctx);
    if (ds === "kanzler") {
      // hood ornament + a chrome rocker strip between the arches
      add(root, 0.03, 0.07, 0.03, 0, topAt(ctx, ctx.frontZ - 0.34) + 0.03, ctx.frontZ - 0.34, chrome()).userData.noSeal = true;
      const R = ctx.lines && ctx.lines.rock;
      if (R) {
        const mid = R[(R.length / 2) | 0];
        [1, -1].forEach(function (s) { add(root, 0.02, 0.03, ctx.len * 0.36, s * (mid[1] + 0.012), mid[2] - 0.02, 0, chrome()).userData.noSeal = true; });
      }
    } else if (ds === "surge" && ctx.paint) {
      const z = ctx.rearZ + 0.1;
      add(root, ctx.w * 0.55, 0.03, 0.1, 0, topAt(ctx, z) + 0.02, z, ctx.paint).userData.noSeal = true;   // lip spoiler
    } else if (ds === "kaze") {
      add(root, (ctx.roofW || ctx.w * 0.8) * 0.8, 0.03, 0.14, 0, topAt(ctx, (ctx.roofZ || 0) - (ctx.roofLen || 1) * 0.5) + 0.02, (ctx.roofZ || 0) - (ctx.roofLen || 1) * 0.5, darkTrim()).userData.noSeal = true;
    } else if (ds === "apex" || ds === "stampede") {
      // twin centre stripes over the hood, roof and deck — never over the glass
      [-0.12, 0.12].forEach(function (fx) { topStrip(root, ctx, fx, 0.07, darkTrim(), 0.004); });
    } else if (ds === "halo") {
      addRoofRails(root, ctx);
    } else if (ds === "eldorado") {
      add(root, ctx.w * 0.3, 0.03, 0.04, 0, topAt(ctx, ctx.frontZ - 0.12) + 0.01, ctx.frontZ - 0.12, badgeGold()).userData.noSeal = true;
    }
  }

  // ============================================================
  //  LEGACY BOX-RIG identity (absorbs vehicles.js addModelIdentity):
  //  the fallback rig used when the unified visual system isn't loaded.
  //  Accepts BOTH the new designStyle names and the old strings other
  //  modules still pass (police "malibu", gigfleet "cab"/"van").
  // ============================================================
  const DS_ALIAS = {
    sprout: "prius", pip: "civic", vista: "malibu", hauler: "caravan",
    rampart: "f150", kaze: "370z", frontier: "cherokee", stampede: "charger",
    apex: "corvette", kanzler: "sclass", surge: "models", nova: "modelx",
    adler901: "porsche", furia: "aventador", rondine: "ferrari",
    tempesta: "enzo", millenne: "veyron", ion: "model3", halo: "modely",
    colossus: "cybertruck",
  };
  function applyBoxIdentity(grp, model, d) {
    let style = model && model.designStyle;
    if (!style) return;
    style = DS_ALIAS[style] || style;
    const { w, len, hullH, hullY, roofW, roofH, roofY, roofZ, paint, trim } = d;
    const bodyY = 0.78 + (hullY - 0.72);
    const front = len * 0.5 + 0.055, rear = -len * 0.5 - 0.055;
    const chromeM = chrome(), headM = head(), tailM = tail();
    const A = function (ww, hh, dd, x, y, z, material) {
      const mesh = new THREE.Mesh(boxGeo(ww, hh, dd), material);
      mesh.position.set(x, y, z); grp.add(mesh); return mesh;
    };
    if (style === "prius") {
      [1, -1].forEach((side) => A(0.12, roofH * 0.62, 0.065, side * w * 0.39, roofY - roofH * 0.08, rear, tailM));
    } else if (style === "civic") {
      [1, -1].forEach((side) => A(0.18, 0.12, 0.16, side * w * 0.28, bodyY - hullH * 0.32, rear, chromeM));
    } else if (style === "malibu") {
      [-0.1, 0.1].forEach((yy) => A(w * 0.58, 0.035, 0.035, 0, bodyY + yy, front, chromeM));
    } else if (style === "caravan") {
      [1, -1].forEach((side) => {
        A(0.05, 0.05, len * 0.64, side * roofW * 0.45, roofY + roofH * 0.55, roofZ - len * 0.04, trim);
        A(0.035, 0.035, len * 0.44, side * w * 0.505, bodyY + hullH * 0.24, -len * 0.12, trim);
      });
    } else if (style === "f150") {
      [1, -1].forEach((side) => A(0.07, 0.08, len * 0.38, side * w * 0.46, bodyY + hullH * 0.62, -len * 0.22, trim));
      [-0.13, 0.13].forEach((yy) => A(w * 0.62, 0.045, 0.04, 0, bodyY + yy, front, chromeM));
    } else if (style === "370z") {
      A(roofW * 0.68, 0.035, len * 0.2, 0, roofY + roofH * 0.52, roofZ - len * 0.02, trim);
      [1, -1].forEach((side) => A(0.18, 0.1, 0.14, side * w * 0.3, bodyY - hullH * 0.28, rear, chromeM));
    } else if (style === "cherokee") {
      [1, -1].forEach((side) => A(0.055, 0.06, len * 0.58, side * roofW * 0.43, roofY + roofH * 0.54, roofZ, trim));
      for (let i = -3; i <= 3; i++) A(0.055, hullH * 0.42, 0.04, i * w * 0.075, bodyY, front, trim);
    } else if (style === "charger") {
      [1, -1].forEach((side) => A(w * 0.16, 0.035, len * 0.34, side * w * 0.19, bodyY + hullH * 0.53, len * 0.18, trim));
    } else if (style === "corvette") {
      [1, -1].forEach((side) => {
        A(0.18, 0.1, 0.14, side * w * 0.28, bodyY - hullH * 0.3, rear, chromeM);
        A(w * 0.1, 0.035, len * 0.44, side * w * 0.12, bodyY + hullH * 0.5, len * 0.1, trim);
      });
    } else if (style === "sclass") {
      [-0.12, 0, 0.12].forEach((yy) => A(w * 0.56, 0.035, 0.035, 0, bodyY + yy, front, chromeM));
      A(0.035, 0.18, 0.035, 0, bodyY + hullH * 0.62, len * 0.38, chromeM);
    } else if (style === "models") {
      A(w * 0.7, 0.055, 0.09, 0, bodyY + hullH * 0.47, rear, paint);
    } else if (style === "modelx") {
      [1, -1].forEach((side) => A(0.04, roofH * 0.48, 0.04, side * roofW * 0.5, roofY, roofZ, trim));
    } else if (style === "porsche") {
      [1, -1].forEach((side) => A(0.26, 0.24, 0.07, side * w * 0.29, bodyY + hullH * 0.45, front, headM));
    } else if (style === "aventador") {
      [1, -1].forEach((side) => {
        const lamp = A(w * 0.24, 0.08, 0.075, side * w * 0.3, bodyY + hullH * 0.42, front, headM);
        lamp.rotation.z = side * -0.18;
      });
      A(w * 0.74, 0.07, 0.18, 0, bodyY + hullH * 0.65, -len * 0.43, trim);
    } else if (style === "ferrari") {
      [1, -1].forEach((side) => A(w * 0.13, 0.05, len * 0.24, side * w * 0.18, bodyY + hullH * 0.52, len * 0.13, trim));
    } else if (style === "enzo") {
      [1, -1].forEach((side) => A(w * 0.14, 0.055, len * 0.32, side * w * 0.2, bodyY + hullH * 0.5, len * 0.12, trim));
      A(w * 0.16, 0.06, len * 0.38, 0, bodyY + hullH * 0.53, len * 0.12, paint);
    } else if (style === "veyron") {
      A(w * 0.24, 0.045, len * 0.66, 0, bodyY + hullH * 0.53, -len * 0.02, chromeM);
      [1, -1].forEach((side) => A(0.18, 0.16, 0.06, side * w * 0.2, bodyY, front, trim));
    }
  }

  CBZ.carParts = {
    BRANDS: BRANDS,
    brandForStyle: brandForStyle,
    brandOf: function (model) { return (model && model.brand) || null; },
    applyBrandFace: applyBrandFace,
    applyModelIdentity: applyModelIdentity,
    applyBoxIdentity: applyBoxIdentity,
    addTaxiSign: addTaxiSign,
    addRoofRails: addRoofRails,
    addBumpers: addBumpers,
    rimStyleFor: function (styleOrBrand) {
      // a body that wears something other than its marque's signature wheel
      // (carwheels.js styles): the lowrider on laced wire, a work van on
      // steelies, the muscle car on a five-spoke, the German coupe on a mesh
      const own = { lowrider: "wire", van: "steel", muscle: "sport5", porsche: "mesh" }[styleOrBrand];
      if (own) return own;
      const b = BRANDS[styleOrBrand] || BRANDS[STYLE_BRAND[styleOrBrand]];
      return (b && b.rim) || "sport5";
    },
    mat: M,
  };
})();
