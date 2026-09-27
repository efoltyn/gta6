/* ============================================================
   city/carparts.js — the MANUFACTURER UNIVERSE + modular part library.

   Every car in the game belongs to one of six fictional marques, and each
   marque owns a DESIGN LANGUAGE: a grille signature, a headlight/taillight
   shape family, a badge, an exhaust layout and a bumper treatment. This file
   is the single vocabulary both the unified player-car visuals
   (city/playercars.js) and the legacy box rig (city/vehicles.js) consume, so
   two cars of the same brand read as siblings from across the street.

     BRANDS (each bent per CLASS: sedan / hatch / cross / suv / truck /
     van / semi / cyber / sports / super / muscle / classic)
       falcone — Italian exotic. Slim slanted lamps with a FANG DRL and LED
                 cells, wedge side intakes (fins over mesh), meshed mouth +
                 splitter; round twin tails (a Y blade on the aventador),
                 finned diffuser, centred quad tips.
       adler   — German precision. Twin chrome-framed kidneys with chrome
                 slats, twin-projector lamps with ANGEL-EYE halos + amber
                 strip, LED fog strips; L tails, dual oval tips. The sports
                 class drops the grille: oval lamps with the four-point LED
                 signature, three intakes, a full-width tail blade.
       bison   — American. Trucks/SUVs/vans: tall chrome-framed grilles
                 (bars + crossbars / fine mesh / plain commercial slats),
                 square C-clamp lamps, round fogs, stacked vertical tails.
                 Muscle: blacked-out full-width mesh grille with quad round
                 halo lamps set IN it, a segmented full-width tail. Classic
                 (lowrider): chrome vertical-bar grille, chrome bezels,
                 chrome bumper blades, triple round tails.
       voltra  — EV. Closed nose, slim swept lamps (brow DRL, two small
                 projectors), meshed low intake + air-curtain slits, a
                 FULL-WIDTH tail light bar, finned diffuser, no exhaust.
       kotori  — Japanese economy. Slot + honeycomb smile, round fogs in
                 pockets, single-projector chrome lamps with a J DRL and an
                 amber corner, ringed tails, one tip.
       vitesse — French hyper-luxury. Chrome HORSESHOE, slim lamps with
                 four LED cells, big slatted side intakes, a full-width tail
                 line and one huge slatted centre exhaust.

   HARD CONTRACTS honoured here (several systems key off material values):
     • headlight emissive g>0.6 && b>0.6      (dead-lamp swap on crash)
     • taillight emissive r>0.78 && g<0.45 && b<0.5   (brake-light flip)
     • glass colour b-r>0.045 && b<0.4 && r<0.25       (frost damage) — the
       clear lamp lens is deliberately OUTSIDE this window (a crash kills a
       lamp, it does not craze it like a windshield)
     • part meshes carry only noSeal userData and only SHARED materials; a
       face is BAKED per (body template, brand) into one mesh per material,
       so vehicles.js mergeStaticCarParts folds it into the car's buckets.
     • deterministic: nothing here draws randomness — parts derive purely
       from brand/class/style, so multiplayer clients build identical cars.

   ON THE SKIN. The road bodies are curved shells (city/carbody.js), so
   every face part is laid onto the fascia grid the body publishes (ctx.fz
   / ctx.rz). A lamp is a UNIT — housing (chrome reflector or gloss black)
   inside a bezel wall, projectors in chrome bowls / LED cells / a DRL
   signature / an amber segment, and a clear domed lens over all of it. An
   opening is a RECESS — near-black floor, a frame wall standing out of the
   skin, real slats / fins / diamond mesh strands set inside it. Parts stop
   where the skin turns into the flank (safeX), so nothing spikes off a
   corner. Every car carries a plain plate (no text, no marque), and the
   fleet liveries are built here too: model.livery "police" (white doors +
   roof over the black paint, a shaped roof bar whose red/blue halves
   city/police.js flashes by name, push bar, spotlight) and "taxi" (the
   roof sign).

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
  const darkTrim = () => M("cp-dark", "plastic", 0x14171c);
  const bumperM = () => L("cp-bumper", 0x23272d, { emissive: 0x0b0d10, ei: 0.3 });
  const badgeGold = () => L("cp-gold", 0xe8c14d, { emissive: 0x3a2f10, ei: 0.4 });

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
  function add(root, w, h, d, x, y, z, material) {
    const m = new THREE.Mesh(boxGeo(w, h, d), material);
    m.position.set(x || 0, y || 0, z || 0);
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

  /* ============================================================
     FACE MATERIALS. DRAW CALLS: every distinct material is one merged
     bucket per car, so a face owns only five of its own (hole, tail lens,
     plate, amber, clear lens); the rest are the fleet singletons the body
     already draws with (satin-black trim, chrome, the two lamp emissives).
  ============================================================ */
  // near-black and unlit-ish: an opening in a bumper is a hole, it must not
  // catch the sun as a mid-grey slot
  const holeM = () => L("cp-hole", 0x0b0c0e, { emissive: 0, ei: 0 });
  // satin black (carfx 'plastic' singleton = the body's own trim bucket):
  // lamp housings, bezels, grille frames and slats, splitters, diffusers
  const blackM = () => darkTrim();
  const reflector = () => chrome();
  // the tail lamp's outer lens: a deep red that reads as red glass by day
  // (NOT a tail by the brake detector: emissive r = 0.2 < 0.78)
  const tailLens = () => L("cp-taillens", 0x6a0d16, { emissive: 0x330409, ei: 0.55 });
  const plateM = () => L("cp-plate", 0xe8ebef, { emissive: 0x30343a, ei: 0.35 });
  const reverseM = () => plateM();                                                      // unlit reverse lamp
  /* THE CLEAR LENS over every lamp. A Physical pane with high transmission:
     r128's transmission is an ALPHA law (alpha = 1 - transmission + the
     luminance of what it reflects), so the lens is nearly invisible where
     it reflects nothing and flashes where it catches the sky — which is
     exactly how a lamp's polycarbonate cover reads. Colour 0xeef3f8 sits far
     OUTSIDE crashdeform's frost window (r >= 0.25), so a crash never turns a
     headlamp into a crazed windshield. */
  let lensMat = null;
  function lensM() {
    if (!lensMat) {
      lensMat = new THREE.MeshPhysicalMaterial({
        color: 0xeef3f8, metalness: 0, roughness: 0.05, transmission: 0.9,
        transparent: true, opacity: 1, depthWrite: false, envMapIntensity: 1.2,
      });
      lensMat._shared = true;
    }
    if (!lensMat.envMap && CBZ.ENV) { lensMat.envMap = CBZ.ENV; lensMat.needsUpdate = true; }
    return lensMat;
  }

  /* ============================================================
     SKIN PATCHES. A lamp or an intake is not a box stuck on the nose: it is
     a piece of the nose. skinPatch() samples the body's own fascia grid
     over a (u, v) parameter square mapped to (x, y), and lays a mesh `off`
     metres out along the local surface normal (`off` may be a function of
     (u, v): a domed lens, a concave reflector bowl). Built in the car frame
     (the mesh has no transform) and cached per (body template, brand).
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
  function geoOf(pos, nor) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.computeBoundingSphere();
    g._shared = true;
    return g;
  }
  // map(u, v) -> [x, y]; u across (nu cells), v up (nv cells)
  function skinPatch(ctx, end, map, nu, nv, off) {
    const offAt = typeof off === "function" ? off : () => off;
    const P = [], N = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const xy = map(i / nu, j / nv), s = surfPt(ctx, end, xy[0], xy[1], offAt(i / nu, j / nv));
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
    return geoOf(pos, nor);
  }
  function addGeo(root, geo, mat) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    m.userData.noSeal = true;
    root.add(m);
    return m;
  }
  // a quad A B C D pushed as two triangles wound to face N
  function quadN(pos, nor, A, B, C, D, N) {
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const f = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const flip = f[0] * N[0] + f[1] * N[1] + f[2] * N[2] < 0;
    const T = flip ? [A, C, B, A, D, C] : [A, B, C, A, C, D];
    for (let i = 0; i < 6; i++) { pos.push(T[i][0], T[i][1], T[i][2]); nor.push(N[0], N[1], N[2]); }
  }
  const nrm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // ---- outlines in (x, y) ----------------------------------------------
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
  function ringMap(cx, cy, r0, r1) {
    return function (u, v) { const a = u * Math.PI * 2, r = r0 + (r1 - r0) * v; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  }
  // bilinear quad through four (x, y) corners (A B along u at v=0, D C at v=1)
  function quadMap(A, B, C, D) {
    return function (u, v) {
      const x0 = A[0] + (B[0] - A[0]) * u, y0 = A[1] + (B[1] - A[1]) * u;
      const x1 = D[0] + (C[0] - D[0]) * u, y1 = D[1] + (C[1] - D[1]) * u;
      return [x0 + (x1 - x0) * v, y0 + (y1 - y0) * v];
    };
  }
  // a strip `t` wide along the segment A->B (ends extended t/2 so joints close)
  function segMap(A, B, t) {
    const dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    const ax = A[0] - ux * t * 0.5, ay = A[1] - uy * t * 0.5, bx = B[0] + ux * t * 0.5, by = B[1] + uy * t * 0.5;
    return function (u, v) { return [ax + (bx - ax) * u - uy * (v - 0.5) * t, ay + (by - ay) * u + ux * (v - 0.5) * t]; };
  }
  // the boundary of a map() patch as a closed loop
  function loopOf(map, nu, nv) {
    const L2 = [];
    for (let i = 0; i < nu; i++) L2.push(map(i / nu, 0));
    for (let j = 0; j < nv; j++) L2.push(map(1, j / nv));
    for (let i = nu; i > 0; i--) L2.push(map(i / nu, 1));
    for (let j = nv; j > 0; j--) L2.push(map(0, j / nv));
    return L2;
  }
  function discLoop(cx, cy, r, n) {
    const L2 = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; L2.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return L2;
  }

  /* WALL: the side of an opening / a lamp body — the loop swept from the
     skin (o0) out to o1 along the surface normal. `out` faces away from the
     centre (a lamp standing proud, seen from the side), `in` faces the
     centre (the cavity wall of an intake, the inside of a lamp bowl seen
     through its lens). `lip` lays a flat bezel ring outward on top. */
  function wallGeo(ctx, end, loop, o0, o1, o) {
    o = o || {};
    const n = loop.length, pos = [], nor = [];
    let cx = 0, cy = 0;
    loop.forEach(function (p) { cx += p[0]; cy += p[1]; });
    cx /= n; cy /= n;
    // per-vertex outward direction in (x, y): perpendicular of the chord
    // through the neighbours, turned away from the centre
    const out2 = loop.map(function (p, i) {
      const a = loop[(i + n - 1) % n], b = loop[(i + 1) % n];
      let dx = b[1] - a[1], dy = -(b[0] - a[0]);
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      if (dx * (p[0] - cx) + dy * (p[1] - cy) < 0) { dx = -dx; dy = -dy; }
      return [dx, dy];
    });
    const S0 = loop.map((p) => surfPt(ctx, end, p[0], p[1], o0));
    const S1 = loop.map((p) => surfPt(ctx, end, p[0], p[1], o1));
    const lipW = o.lip || 0;
    const S2 = lipW ? loop.map((p, i) => surfPt(ctx, end, p[0] + out2[i][0] * lipW, p[1] + out2[i][1] * lipW, o0 + (o1 - o0) * 0.7)) : null;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const A0 = S0[i].p, B0 = S0[j].p, A1 = S1[i].p, B1 = S1[j].p;
      const f = nrm3(cross3([B0[0] - A0[0], B0[1] - A0[1], B0[2] - A0[2]], [A1[0] - A0[0], A1[1] - A0[1], A1[2] - A0[2]]));
      const mx = (loop[i][0] + loop[j][0]) / 2 - cx, my = (loop[i][1] + loop[j][1]) / 2 - cy;
      const fo = (f[0] * mx + f[1] * my) >= 0 ? f : [-f[0], -f[1], -f[2]];
      if (o.out) quadN(pos, nor, A0, B0, B1, A1, fo);
      if (o.in) quadN(pos, nor, A0, B0, B1, A1, [-fo[0], -fo[1], -fo[2]]);
      if (S2) quadN(pos, nor, A1, B1, S2[j].p, S2[i].p, S1[i].n);
    }
    return geoOf(pos, nor);
  }

  /* RIBS: slats, mesh strands, fins — each a thin box-section strip laid
     along a polyline on the fascia (two sides + a top face; the ends are
     buried in the frame). One geometry for any number of strands. */
  function ribGeo(ctx, end, lines, t, h, off) {
    const pos = [], nor = [];
    lines.forEach(function (pts) {
      const S = pts.map((p) => surfPt(ctx, end, p[0], p[1], off));
      for (let i = 0; i + 1 < S.length; i++) {
        const A = S[i].p, B = S[i + 1].p, nA = S[i].n, nB = S[i + 1].n;
        const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        const sd = nrm3(cross3(nA, d)), hs = t / 2;
        const A0 = [A[0] - sd[0] * hs, A[1] - sd[1] * hs, A[2] - sd[2] * hs], A1 = [A[0] + sd[0] * hs, A[1] + sd[1] * hs, A[2] + sd[2] * hs];
        const B0 = [B[0] - sd[0] * hs, B[1] - sd[1] * hs, B[2] - sd[2] * hs], B1 = [B[0] + sd[0] * hs, B[1] + sd[1] * hs, B[2] + sd[2] * hs];
        const up = (P, nn) => [P[0] + nn[0] * h, P[1] + nn[1] * h, P[2] + nn[2] * h];
        const A0t = up(A0, nA), A1t = up(A1, nA), B0t = up(B0, nB), B1t = up(B1, nB);
        quadN(pos, nor, A0, B0, B0t, A0t, [-sd[0], -sd[1], -sd[2]]);
        quadN(pos, nor, A1, B1, B1t, A1t, sd);
        quadN(pos, nor, A0t, B0t, B1t, A1t, nA);
      }
    });
    return geoOf(pos, nor);
  }
  /* LATTICE: the strand polylines of a grille fill, laid out in the opening's
     own (u, v) so they follow its slant, taper and rounded ends.
       "h"  horizontal slats   "v"  vertical slats / fins
       "diamond"  a 45-degree cross mesh (the honeycomb read at any range)
     `w`/`h` are the opening's size in metres so the pitch is metric. */
  function lattice(map, w, h, kind, pitch) {
    const out = [], U0 = 0.03, U1 = 0.97, V0 = 0.08, V1 = 0.92;
    const poly = (f, n) => { const pts = []; for (let i = 0; i <= n; i++) pts.push(f(i / n)); return pts; };
    if (kind === "h") {
      const n = Math.max(1, Math.round(h / pitch) - 1);
      for (let i = 1; i <= n; i++) { const v = i / (n + 1); out.push(poly((t) => map(U0 + (U1 - U0) * t, v), Math.max(2, Math.ceil(w / 0.2)))); }
    } else if (kind === "v") {
      const n = Math.max(1, Math.round(w / pitch) - 1);
      for (let i = 1; i <= n; i++) { const u = i / (n + 1); out.push(poly((t) => map(u, V0 + (V1 - V0) * t), Math.max(1, Math.ceil(h / 0.2)))); }
    } else if (kind === "diamond") {
      const k = h / w, du = pitch * Math.SQRT2 / w;
      [1, -1].forEach(function (s) {
        for (let c = -k + du * 0.5; c <= 1 + k; c += du) {
          const lo = (U0 - c) / (s * k) + 0.5, hi = (U1 - c) / (s * k) + 0.5;
          const va = Math.max(V0, Math.min(lo, hi)), vb = Math.min(V1, Math.max(lo, hi));
          if (vb - va < 0.1) continue;
          const n = Math.max(1, Math.ceil((vb - va) * h / 0.15));
          out.push(poly((t) => { const v = va + (vb - va) * t; return map(c + s * k * (v - 0.5), v); }, n));
        }
      });
    }
    return out;
  }
  // a lit / coloured stroke along a polyline of (x, y) points
  function stroke(root, ctx, end, pts, t, off, mat) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      addGeo(root, skinPatch(ctx, end, segMap(pts[i], pts[i + 1], t), Math.max(1, Math.ceil(l / 0.06)), 1, off), mat);
    }
  }
  // the lens dome over a patch: `d` out at the rim, bulging `b` in the middle
  const dome = (d, b) => (u, v) => d + b * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);

  // the outer end of a lamp never runs past the skin at ANY height it spans
  // (a tall tail over a rolled deck edge would sample empty grid and spike
  // off the corner)
  function clampOuter(ctx, end, o) {
    const yo = o.y + (o.slant || 0), hh = Math.max(o.hi || 0, o.ho || 0) / 2;
    o.xo = Math.max(o.xi + 0.04, Math.min(o.xo, safeX(ctx, end, yo - hh, yo + hh, 0.015)));
  }
  /* THE USABLE EDGE of the fascia at height y: walking out from the centre,
     the last x before the skin turns steeper than ~55 degrees toward the
     flank. A lamp or opening that ran on into the corner turn would lay its
     last cell across the whole bend (the bezel spikes out sideways, the lit
     strip pokes past its lens), so parts END here and read as wrapping the
     corner instead of falling off it. safeX = the tightest edge over a
     height span, less a margin. */
  function edgeX(ctx, end, y) {
    const lim = cornerX(ctx, end, y, 0), dx = 0.02;
    let zp = surfZ(ctx, end, 0, y);
    for (let x = dx; x <= lim; x += dx) {
      const z = surfZ(ctx, end, x, y);
      if (Math.abs(z - zp) / dx > 1.45) return x - dx;
      zp = z;
    }
    return lim;
  }
  function safeX(ctx, end, y0, y1, margin) {
    let m = Infinity;
    for (let k = 0; k <= 4; k++) m = Math.min(m, edgeX(ctx, end, y0 + (y1 - y0) * k / 4));
    return m - (margin == null ? 0.02 : margin);
  }

  /* ============================================================
     LAMP UNITS. What makes a lamp read as a lamp from 3 m and from 20 m is
     LAYERS, not a bright bar: a housing (chrome reflector or gloss black)
     standing a couple of centimetres proud inside a black bezel wall, the
     elements set into it (projector lenses in chrome bowls, LED cells, a
     DRL signature line), an amber indicator segment, and over all of it a
     clear domed lens that catches the sky. Every lit element uses the
     lightFront / lightTail singletons (the crash + brake contracts).
     Positions inside a lamp are given in its own (f, g): f 0 at the
     inboard end .. 1 at the outboard end, g -0.5 bottom .. +0.5 top.
  ============================================================ */
  function lampFrame(o, end) {
    const s = o.side, xi = s * o.xi, xo = s * o.xo, yi = o.y, yo = o.y + (o.slant || 0);
    const map = band(xi, xo, yi, yo, o.hi, o.ho, o.round == null ? 0.55 : o.round);
    const P = (f, g) => [xi + (xo - xi) * f, yi + (yo - yi) * f + g * (o.hi + (o.ho - o.hi) * f)];
    return { map: map, P: P, len: Math.abs(xo - xi), hMin: Math.min(o.hi, o.ho), end: end };
  }
  // a rectangular cell in lamp space (amber segment, reverse lamp, LED cell)
  function cell(root, ctx, F, f0, f1, g0, g1, off, mat) {
    addGeo(root, skinPatch(ctx, F.end, quadMap(F.P(f0, g0), F.P(f1, g0), F.P(f1, g1), F.P(f0, g1)), 2, 1, off), mat);
  }
  // a projector: a chrome reflector bowl (concave), a black barrel ring, the
  // lit lens; `halo` adds a lit ring round the bowl (the angel eye)
  function projector(root, ctx, end, c, R, halo) {
    addGeo(root, skinPatch(ctx, end, ringMap(c[0], c[1], R * 0.62, R), 12, 1, (u, v) => 0.004 + 0.008 * v), reflector());
    addGeo(root, skinPatch(ctx, end, ringMap(c[0], c[1], R * 0.5, R * 0.62), 12, 1, 0.011), blackM());
    addGeo(root, skinPatch(ctx, end, disc(c[0], c[1], R * 0.5, R * 0.5), 12, 1, 0.0125), head());
    if (halo) addGeo(root, skinPatch(ctx, end, ringMap(c[0], c[1], R * 1.0, R * 1.0 + Math.max(0.008, R * 0.14)), 14, 1, 0.0135), head());
  }
  /* HEADLAMP. o: side, xi, xo (|x|), y, slant, hi, ho, round,
       chrome   housing is a chrome reflector (else gloss black)
       proj     [f..] projector centres, projG their g, projR x height, halo
       leds     [f..] LED cells, ledG, ledW, ledH (metres)
       drl      [[ [f,g], [f,g], .. ], ..] lit signature polylines, drlT
       amber    [f0, f1, g0, g1] indicator segment
       vanes    [f..] thin chrome dividers across the housing          */
  function headLamp(root, ctx, o) {
    clampOuter(ctx, 1, o);
    const F = lampFrame(o, 1), D = o.depth || 0.024;
    const nu = F.len > 0.36 ? 14 : 10;
    addGeo(root, skinPatch(ctx, 1, F.map, nu, 2, 0.004), o.chrome ? reflector() : blackM());
    addGeo(root, wallGeo(ctx, 1, loopOf(F.map, nu, 2), 0, D, { out: true, lip: 0.009 }), blackM());
    (o.vanes || []).forEach(function (f) { stroke(root, ctx, 1, [F.P(f, -0.34), F.P(f + 0.02, 0.34)], 0.006, 0.007, reflector()); });
    (o.proj || []).forEach(function (f) { projector(root, ctx, 1, F.P(f, o.projG || -0.04), F.hMin * (o.projR || 0.3), o.halo); });
    (o.leds || []).forEach(function (f) {
      const c = Array.isArray(f) ? F.P(f[0], f[1]) : F.P(f, o.ledG || 0), hw = (o.ledW || 0.032) / 2, hh = (o.ledH || 0.024) / 2;
      addGeo(root, skinPatch(ctx, 1, quadMap([c[0] - hw - 0.006, c[1] - hh - 0.006], [c[0] + hw + 0.006, c[1] - hh - 0.006], [c[0] + hw + 0.006, c[1] + hh + 0.006], [c[0] - hw - 0.006, c[1] + hh + 0.006]), 1, 1, 0.008), reflector());
      addGeo(root, skinPatch(ctx, 1, quadMap([c[0] - hw, c[1] - hh], [c[0] + hw, c[1] - hh], [c[0] + hw, c[1] + hh], [c[0] - hw, c[1] + hh]), 1, 1, 0.0125), head());
    });
    (o.drl || []).forEach(function (pl) { stroke(root, ctx, 1, pl.map((q) => F.P(q[0], q[1])), o.drlT || 0.012, 0.014, head()); });
    if (o.amber) cell(root, ctx, F, o.amber[0], o.amber[1], o.amber[2], o.amber[3], 0.01, amber());
    addGeo(root, skinPatch(ctx, 1, F.map, nu, 2, dome(D, 0.006)), lensM());
  }
  /* TAILLAMP. The dark red outer lens IS the housing floor; lit elements
     (lightTail: brake flips them) drawn over it as strokes in lamp space,
     an amber indicator and a white reverse cell, the clear lens on top. */
  function tailLamp(root, ctx, o) {
    clampOuter(ctx, -1, o);
    const F = lampFrame(o, -1), D = o.depth || 0.018;
    const nu = F.len > 0.36 ? 14 : 10;
    addGeo(root, skinPatch(ctx, -1, F.map, nu, 2, 0.004), tailLens());
    addGeo(root, wallGeo(ctx, -1, loopOf(F.map, nu, 2), 0, D, { out: true, lip: 0.007 }), blackM());
    const t = o.t || Math.max(0.014, Math.min(0.03, F.hMin * 0.2));
    (o.lit || []).forEach(function (pl) { stroke(root, ctx, -1, pl.map((q) => F.P(q[0], q[1])), t, 0.009, tail()); });
    if (o.amber) cell(root, ctx, F, o.amber[0], o.amber[1], o.amber[2], o.amber[3], 0.007, amber());
    if (o.rev) cell(root, ctx, F, o.rev[0], o.rev[1], o.rev[2], o.rev[3], 0.007, reverseM());
    addGeo(root, skinPatch(ctx, -1, F.map, nu, 2, dome(D, 0.004)), lensM());
  }
  // lit shapes in lamp space for the tails
  const TL = {
    C: [[[0.92, 0.27], [0.12, 0.27], [0.12, -0.27], [0.92, -0.27]]],
    L: [[[0.1, 0.27], [0.9, 0.27], [0.9, -0.28]]],
    bars: [[[0.1, 0.27], [0.9, 0.27]], [[0.14, 0], [0.9, 0]], [[0.18, -0.27], [0.9, -0.27]]],
    blade: [[[0.04, 0.05], [0.96, 0.05]]],
    ring: [[[0.12, 0.28], [0.9, 0.28], [0.9, -0.28], [0.12, -0.28], [0.12, 0.28]]],
  };
  /* A ROUND LAMP: bezel, concave reflector bowl, lit centre (or a lit ring:
     the classic round tail), a domed lens. `tail` makes it a taillamp. */
  function roundLamp(root, ctx, end, cx, cy, R, o) {
    o = o || {};
    const D = o.depth || 0.022;
    addGeo(root, wallGeo(ctx, end, discLoop(cx, cy, R * 1.04, 16), 0, D, { out: true, lip: o.lip == null ? 0.009 : o.lip }), o.chromeBezel ? reflector() : blackM());
    if (o.tail) {
      addGeo(root, skinPatch(ctx, end, disc(cx, cy, R * 1.04, R * 1.04), 16, 1, 0.002), tailLens());
      addGeo(root, skinPatch(ctx, end, ringMap(cx, cy, R * 0.62, R * 0.86), 16, 1, 0.008), tail());
      addGeo(root, skinPatch(ctx, end, disc(cx, cy, R * 0.22, R * 0.22), 10, 1, 0.008), tail());
    } else {
      addGeo(root, skinPatch(ctx, end, ringMap(cx, cy, R * 0.42, R * 1.04), 16, 1, (u, v) => 0.003 + 0.01 * v), reflector());
      addGeo(root, skinPatch(ctx, end, disc(cx, cy, R * 0.42, R * 0.42), 12, 1, 0.012), head());
      if (o.halo) addGeo(root, skinPatch(ctx, end, ringMap(cx, cy, R * 0.8, R * 0.92), 16, 1, 0.014), head());
    }
    addGeo(root, skinPatch(ctx, end, disc(cx, cy, R * 1.04, R * 1.04), 16, 2, (u, v) => D + 0.008 * (1 - v * v)), lensM());
  }
  // a fog lamp in its own black pocket: round, or a horizontal LED strip
  function fogLamp(root, ctx, x, y, r, o) {
    o = o || {};
    if (o.strip) {
      const map = band(x - o.strip / 2, x + o.strip / 2, y, y, r, r, 0.8);
      addGeo(root, skinPatch(ctx, 1, band(x - o.strip / 2 - 0.02, x + o.strip / 2 + 0.02, y, y, r + 0.03, r + 0.03, 0.8), 6, 1, 0.002), holeM());
      addGeo(root, wallGeo(ctx, 1, loopOf(map, 6, 1), 0, 0.016, { in: true, out: true, lip: 0.006 }), blackM());
      addGeo(root, skinPatch(ctx, 1, band(x - o.strip * 0.44, x + o.strip * 0.44, y, y, r * 0.45, r * 0.45, 1), 6, 1, 0.009), head());
      addGeo(root, skinPatch(ctx, 1, map, 6, 1, dome(0.016, 0.003)), lensM());
      return;
    }
    addGeo(root, skinPatch(ctx, 1, disc(x, y, r * 1.55, r * 1.3), 14, 1, 0.002), holeM());
    roundLamp(root, ctx, 1, x, y, r, { depth: 0.018, chromeBezel: o.chrome, lip: 0.006 });
  }
  /* A LIGHT BAR: the EV's full-width signature — a black channel with a
     single lit blade in it and the lens over (front: lightFront, rear:
     lightTail). */
  function lightBar(root, ctx, end, x0, x1, y, h, lit) {
    const lim = safeX(ctx, end, y - h / 2, y + h / 2, 0.02);
    x0 = Math.max(x0, -lim); x1 = Math.min(x1, lim);
    const map = band(x0, x1, y, y, h, h, 0.3);
    addGeo(root, skinPatch(ctx, end, map, 12, 1, 0.002), end > 0 ? blackM() : tailLens());
    addGeo(root, wallGeo(ctx, end, loopOf(map, 12, 1), 0, 0.012, { in: true, out: true, lip: 0.005 }), blackM());
    addGeo(root, skinPatch(ctx, end, band(x0 + 0.01, x1 - 0.01, y, y, h * 0.42, h * 0.42, 0.3), 12, 1, 0.007), lit);
    addGeo(root, skinPatch(ctx, end, map, 12, 1, dome(0.012, 0.002)), lensM());
  }

  /* ============================================================
     OPENINGS: grilles, intakes, diffusers. We can't cut the shell, so an
     opening is BUILT as a recess: a near-black floor on the skin, a frame
     wall standing out of it (its inside faces are the cavity walls), and
     the fill — slats, fins, a diamond mesh — as real strands with depth,
     set back inside the frame. Chrome crossbars ride proud of the frame.
       o: x, y (centre at the INBOARD end), w, h, ho (outboard height),
          slant (outboard end higher), round, depth, bezel, chrome,
          fill [{ k: "h"|"v"|"diamond", p: pitch, t: strand, d: depth x, chrome }],
          bars [v..] chrome crossbars, barT, lip (splitter blade)
  ============================================================ */
  // strands stop at anything set INTO the grille (round lamps): each
  // polyline is resampled to 1.5 cm and split where it enters a hole
  function cutHoles(lines, holes) {
    const inside = (p) => holes.some((h) => Math.hypot(p[0] - h[0], p[1] - h[1]) < h[2]);
    const out = [];
    lines.forEach(function (pts) {
      let run = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.015));
        for (let k = (i === 0 ? 0 : 1); k <= n; k++) {
          const p = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n];
          if (inside(p)) { if (run.length > 1) out.push(simplify(run)); run = []; } else run.push(p);
        }
      }
      if (run.length > 1) out.push(simplify(run));
    });
    return out;
  }
  // collinear resampled points back down to a few (a straight strand needs two)
  function simplify(run) {
    if (run.length <= 2) return run;
    const step = Math.max(1, Math.floor(run.length / 4)), o = [];
    for (let i = 0; i < run.length; i += step) o.push(run[i]);
    if (o[o.length - 1] !== run[run.length - 1]) o.push(run[run.length - 1]);
    return o;
  }
  // the horseshoe: a flat-topped arch that closes to a round bottom
  function horseshoe(xin, xout, y, h) {
    const cx = (xin + xout) / 2, hw0 = Math.abs(xout - xin) / 2, y0 = y - h / 2;
    return function (u, v) {
      const hw = v < 0.62 ? hw0 * Math.sqrt(Math.max(0.02, 1 - Math.pow((0.62 - v) / 0.62, 2))) : hw0 * (1 - 0.14 * Math.pow((v - 0.62) / 0.38, 2));
      return [cx + (u - 0.5) * 2 * hw, y0 + v * h];
    };
  }
  function opening(root, ctx, end, o) {
    const sg = o.x < -0.02 ? -1 : 1;
    const hIn = o.h, hOut = o.ho != null ? o.ho : o.h;
    const yIn = o.y, yOut = o.y + (o.slant || 0);
    // never run into the corner turn: pull the outer end in (both ends, for
    // a centred opening), keeping the inboard end where it was asked for
    const lim = safeX(ctx, end, Math.min(yIn - hIn / 2, yOut - hOut / 2), Math.max(yIn + hIn / 2, yOut + hOut / 2), 0.02);
    if (Math.abs(o.x) < 0.02) o.w = Math.min(o.w, lim * 2);
    else o.w = Math.max(0.04, Math.min(o.w, lim - (Math.abs(o.x) - o.w / 2)));
    const xin = Math.abs(o.x) < 0.02 ? -o.w / 2 : o.x - sg * o.w / 2, xout = Math.abs(o.x) < 0.02 ? o.w / 2 : xin + sg * o.w;
    const map = o.map ? o.map(xin, xout, yIn, hIn) : band(xin, xout, yIn, yOut, hIn, hOut, o.round == null ? 0.35 : o.round);
    const D = o.depth || 0.032, nu = Math.max((o.round || 0) > 0.7 ? 12 : 6, Math.min(12, Math.ceil(o.w / 0.08)));
    addGeo(root, skinPatch(ctx, end, map, nu, 2, 0.003), holeM());
    addGeo(root, wallGeo(ctx, end, loopOf(map, nu, 2), 0, D, { in: true, out: true, lip: o.bezel == null ? 0.01 : o.bezel }), o.chrome ? reflector() : blackM());
    (o.fill || []).forEach(function (fl) {
      let lines = lattice(map, o.w, Math.max(hIn, hOut), fl.k, fl.p || 0.04);
      if (o.holes) lines = cutHoles(lines, o.holes);
      if (lines.length) addGeo(root, ribGeo(ctx, end, lines, fl.t || 0.007, D * (fl.d || 0.55), 0.002), fl.chrome ? reflector() : blackM());
    });
    if (o.bars && o.bars.length) {
      const lines = o.bars.map(function (g) { const pts = []; for (let i = 0; i <= 8; i++) pts.push(map(0.015 + 0.97 * i / 8, g)); return pts; });
      addGeo(root, ribGeo(ctx, end, lines, o.barT || 0.03, D * 1.2, 0.002), reflector());
    }
    if (o.lip) splitter(root, ctx, end, Math.min(xin, xout) - 0.04, Math.max(xin, xout) + 0.04, Math.min(yIn - hIn / 2, yOut - hOut / 2) - 0.025, o.lip);
    return map;
  }
  // a thin blade standing out of the skin along a line (the splitter lip)
  function splitter(root, ctx, end, x0, x1, y, depth) {
    const n = 10, pos = [], nor = [];
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n;
      const a = surfPt(ctx, end, x, y, 0), b = surfPt(ctx, end, x, y, depth);
      pts.push([a.p, b.p, [b.p[0], b.p[1] - 0.02, b.p[2]], [a.p[0], a.p[1] - 0.02, a.p[2]]]);
    }
    for (let i = 0; i < n; i++) {
      const P0 = pts[i], P1 = pts[i + 1];
      quadN(pos, nor, P0[0], P1[0], P1[1], P0[1], [0, 1, 0]);                        // top
      quadN(pos, nor, P0[1], P1[1], P1[2], P0[2], [0, 0, end]);                      // front edge
      quadN(pos, nor, P0[3], P0[2], P1[2], P1[3], [0, -1, 0]);                       // underside
    }
    addGeo(root, geoOf(pos, nor), blackM());
  }
  // a chrome strip laid along the fascia (the classic bumper blade)
  function chromeStrip(root, ctx, end, x0, x1, y, h) {
    const map = band(x0, x1, y, y, h, h, 0.2);
    addGeo(root, skinPatch(ctx, end, map, 12, 1, 0.012), reflector());
    addGeo(root, wallGeo(ctx, end, loopOf(map, 12, 1), 0, 0.012, { out: true }), reflector());
  }
  // a plain plate on a black bracket (no marque, no text); `proud` lifts it
  // clear of a grille fill behind it
  function plate(root, ctx, end, y, proud) {
    const p = proud || 0;
    put(slab(root, 0.56, 0.16, 0.03 + p, 0.012, blackM()), ctx, end, 0, y, 0.004 + p);
    put(slab(root, 0.52, 0.12, 0.02, 0.01, plateM()), ctx, end, 0, y, 0.014 + p);
  }
  /* EXHAUST TIPS: a lathed tube — the outer barrel, a rolled lip, the inner
     wall running back into the dark — and a black floor 6 cm down, so the
     tip reads HOLLOW from any angle. `oval` stretches it wide, `black` is a
     black-chrome finish (the plastic singleton). */
  const tipGeos = new Map();
  function tipGeo(r, inner) {
    const k = r.toFixed(3) + (inner ? "i" : "");
    let g = tipGeos.get(k);
    if (g) return g;
    const V = (a, b) => new THREE.Vector2(a, b);
    const prof = inner
      ? [V(r * 0.8, -0.062), V(0.0001, -0.062)]
      : [V(r, -0.16), V(r, -0.012), V(r * 0.985, -0.003), V(r * 0.92, 0), V(r * 0.84, -0.004), V(r * 0.8, -0.014), V(r * 0.8, -0.066)];
    g = new THREE.LatheGeometry(prof, 16);
    g.computeVertexNormals();
    g._shared = true;
    tipGeos.set(k, g);
    return g;
  }
  function tip(root, ctx, x, y, r, o) {
    o = o || {};
    const z = surfZ(ctx, -1, x, y) - (o.out == null ? 0.035 : o.out);
    [[tipGeo(r, false), o.black ? blackM() : reflector()], [tipGeo(r, true), holeM()]].forEach(function (gm) {
      const m = new THREE.Mesh(gm[0], gm[1]);
      m.position.set(x, y, z);
      m.rotation.x = -Math.PI / 2;           // lathe +y (the tip end) -> car -z (out of the tail)
      if (o.oval) m.scale.set(o.oval, 1, 1);
      m.castShadow = false;
      m.userData.noSeal = true;
      root.add(m);
    });
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
  //  BRAND FACES — the design language, laid INTO the skin, and bent per
  //  CLASS on top: a Bison pickup and a Bison muscle car share a family
  //  but not a face. No badges: the house rule is no invented logos, so a
  //  marque is told apart by its lamps, its openings and its tail.
  // ============================================================
  const CLASS = {
    "tesla-3": "sedan", "tesla-s": "sedan", hatch: "hatch", "tesla-y": "cross", "tesla-x": "cross",
    suv: "suv", pickup: "truck", van: "van", semi: "semi", cybertruck: "cyber",
    porsche: "sports", ferrari: "super", enzo: "super", aventador: "super", veyron: "super",
    muscle: "muscle", lowrider: "classic",
  };
  function klass(ctx) { return CLASS[ctx.style] || (ctx.sport ? "super" : "sedan"); }
  const TALL = { suv: 1, truck: 1, van: 1, semi: 1, cyber: 1 };
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  // shared rear furniture: plate, a diffuser, tips
  function rearPlate(root, ctx, y) { plate(root, ctx, -1, y != null ? y : (ctx.rearPlateY != null ? ctx.rearPlateY : (ctx.baseY + ctx.tailY) / 2)); }
  function diffuser(root, ctx, x, w, h, pitch) {
    opening(root, ctx, -1, { x: x, y: ctx.baseY + h / 2 - 0.005, w: w, h: h, round: 0.25, depth: 0.04, fill: [{ k: "v", p: pitch || 0.09, t: 0.01, d: 0.9 }] });
  }

  const FACES = {
    /* FALCONE — Italian exotic. Slim slanted lamps with a FANG DRL and LED
       cells, wedge side intakes (fins over mesh), a mesh mouth and a
       splitter; round twin tails (the super cars; a Y blade on the
       aventador), a finned diffuser and a centred quad. */
    falcone: function (root, ctx) {
      const k = klass(ctx), w = ctx.w, hy = ctx.headY, by = ctx.baseY;
      const sup = k === "super" || k === "sports";
      const hi = sup ? 0.06 : 0.075, ho = sup ? 0.1 : 0.125;
      [1, -1].forEach(function (s) {
        headLamp(root, ctx, { side: s, xi: w * 0.2, xo: cornerX(ctx, 1, hy + 0.02, 0.02), y: hy - 0.01, slant: 0.035, hi: hi, ho: ho, round: 0.55,
          leds: [0.44, 0.58, 0.72], ledG: -0.1, ledW: 0.034, ledH: hi * 0.36,
          drl: [[[0.05, -0.2], [0.24, 0.3], [0.94, 0.3]]], drlT: 0.011,
          amber: [0.82, 0.93, -0.32, -0.06] });
        // the wedge intake tucks UNDER its lamp with a body-colour gap
        const sh = sup ? 0.1 : 0.09, sho = sup ? 0.15 : 0.12;
        const sy = Math.max(by + 0.07, Math.min(by + 0.1, hy - 0.01 - hi / 2 - 0.035 - sho / 2 - 0.02));
        opening(root, ctx, 1, { x: s * w * 0.335, y: sy, w: w * 0.2, h: sh, ho: sho, slant: 0.02, round: 0.3, depth: 0.042,
          fill: [{ k: "diamond", p: 0.032, t: 0.006, d: 0.45 }, { k: "v", p: 0.07, t: 0.012, d: 0.95 }] });
        if (!sup) fogLamp(root, ctx, s * w * 0.3, sy + 0.01, 0.02, { strip: 0.1 });
      });
      opening(root, ctx, 1, { x: 0, y: by + 0.065, w: w * 0.4, h: 0.1, depth: 0.036, fill: [{ k: "diamond", p: 0.032, t: 0.006 }], lip: 0.06 });
      if (!sup) plate(root, ctx, 1, by + 0.09, 0.03);
      // tails
      const ty = ctx.tailY;
      if (ctx.style === "aventador") {
        [1, -1].forEach(function (s) {
          tailLamp(root, ctx, { side: s, xi: w * 0.18, xo: cornerX(ctx, -1, ty, 0.02), y: ty, slant: 0.02, hi: 0.06, ho: 0.11, round: 0.3,
            lit: [[[0.06, 0.3], [0.45, 0], [0.06, -0.3]], [[0.45, 0], [0.94, 0]]], t: 0.013, rev: [0.6, 0.9, -0.32, -0.14] });
        });
      } else if (sup) {
        [1, -1].forEach(function (s) {
          [0.37, 0.23].forEach(function (fx) { roundLamp(root, ctx, -1, s * w * fx, ty, 0.068, { tail: true }); });
        });
      } else {
        [1, -1].forEach(function (s) {
          tailLamp(root, ctx, { side: s, xi: w * 0.2, xo: cornerX(ctx, -1, ty, 0.02), y: ty, slant: 0.012, hi: 0.08, ho: 0.1,
            lit: TL.C, rev: [0.3, 0.5, -0.12, 0.12], amber: [0.6, 0.8, -0.12, 0.12] });
        });
      }
      diffuser(root, ctx, 0, w * 0.64, 0.11, 0.1);
      [-0.2, -0.08, 0.08, 0.2].forEach(function (fx) { tip(root, ctx, fx * w, by + 0.135, 0.04); });
      rearPlate(root, ctx, Math.max(by + 0.26, Math.min(ty - 0.14, (by + ty) / 2 + 0.05)));
    },

    /* ADLER — German precision. Twin chrome-framed kidney grilles with
       vertical chrome slats, lamps with two projectors ringed by ANGEL-EYE
       halos and an amber strip, a meshed lower intake with LED fog strips;
       L-shaped tails with an inner bar, dual oval tips. The SPORTS class is
       the rear-engined coupe: no grille at all, oval lamps with the four-
       point LED signature, three intakes, a full-width tail blade. */
    adler: function (root, ctx) {
      const k = klass(ctx), w = ctx.w, hy = ctx.headY, by = ctx.baseY, ty = ctx.tailY;
      if (!ctx.noBumpers) addBumpers(root, ctx, true);
      if (k === "sports" || k === "super") {
        [1, -1].forEach(function (s) {
          const lh = clampN((ctx.noseTopY - by) * 0.34, 0.09, 0.13), ly = Math.min(hy, ctx.noseTopY - lh / 2 - 0.01);
          const xo = safeX(ctx, 1, ly - lh / 2, ly + lh / 2, 0.015);
          headLamp(root, ctx, { side: s, xi: Math.max(w * 0.24, xo - 0.3), xo: xo, y: ly, hi: lh, ho: lh, round: 1, chrome: true,
            proj: [0.5], projG: 0, projR: 0.34,
            leds: [[0.24, 0.24], [0.76, 0.24], [0.24, -0.24], [0.76, -0.24]], ledW: 0.024, ledH: 0.016 });
          const ih = Math.min(0.13, ly - lh / 2 - 0.04 - by);
          opening(root, ctx, 1, { x: s * w * 0.34, y: by + ih / 2 + 0.01, w: w * 0.18, h: ih, round: 0.45, depth: 0.04, fill: [{ k: "diamond", p: 0.03, t: 0.006 }] });
          fogLamp(root, ctx, s * w * 0.34, by + ih - 0.012, 0.014, { strip: w * 0.13 });
        });
        opening(root, ctx, 1, { x: 0, y: by + 0.07, w: w * 0.36, h: 0.09, round: 0.5, depth: 0.036, fill: [{ k: "h", p: 0.03, t: 0.01, d: 0.8 }], lip: 0.04 });
        lightBar(root, ctx, -1, -cornerX(ctx, -1, ty, 0.04), cornerX(ctx, -1, ty, 0.04), ty + 0.02, 0.03, tail());
        [1, -1].forEach(function (s) {
          tailLamp(root, ctx, { side: s, xi: w * 0.3, xo: cornerX(ctx, -1, ty, 0.02), y: ty - 0.04, hi: 0.05, ho: 0.06, round: 0.5, lit: TL.blade, amber: [0.08, 0.3, -0.3, 0.3] });
        });
        diffuser(root, ctx, 0, w * 0.5, 0.09, 0.08);
        [1, -1].forEach(function (s) { tip(root, ctx, s * w * 0.06, by + 0.13, 0.042, { oval: 1.5 }); });
        rearPlate(root, ctx, (by + ty) / 2 + 0.03);
        return;
      }
      const tall = !!TALL[k];
      const kH = clampN((ctx.noseTopY - by) * (tall ? 0.46 : 0.42), 0.13, 0.26);
      [1, -1].forEach(function (s) {
        opening(root, ctx, 1, { x: s * w * 0.085, y: hy - kH * 0.2, w: w * 0.145, h: kH, ho: kH * 0.9, round: 0.55, chrome: true, depth: 0.04, bezel: 0.016,
          fill: [{ k: "diamond", p: 0.03, t: 0.005, d: 0.4 }, { k: "v", p: 0.03, t: 0.009, d: 0.9, chrome: true }] });
        headLamp(root, ctx, { side: s, xi: w * 0.19, xo: cornerX(ctx, 1, hy, 0.03), y: hy, slant: 0.01, hi: tall ? 0.14 : 0.105, ho: tall ? 0.15 : 0.12, round: 0.85,
          proj: [0.3, 0.64], projR: 0.33, halo: true, amber: [0.5, 0.93, -0.42, -0.3] });
        opening(root, ctx, 1, { x: s * w * 0.38, y: by + 0.1, w: w * 0.12, h: 0.1, round: 0.4, depth: 0.036, fill: [{ k: "diamond", p: 0.028, t: 0.005 }] });
        fogLamp(root, ctx, s * w * 0.38, by + 0.1, 0.018, { strip: w * 0.09 });
      });
      opening(root, ctx, 1, { x: 0, y: by + 0.07, w: w * 0.42, h: tall ? 0.12 : 0.09, round: 0.35, depth: 0.036, fill: [{ k: "diamond", p: 0.03, t: 0.006 }], lip: ctx.sport ? 0.05 : 0 });
      plate(root, ctx, 1, by + 0.07, 0.03);
      [1, -1].forEach(function (s) {
        tailLamp(root, ctx, { side: s, xi: w * 0.14, xo: cornerX(ctx, -1, ty, 0.02), y: ty, slant: 0.01, hi: tall ? 0.1 : 0.075, ho: tall ? 0.13 : 0.1,
          lit: [TL.L[0], [[0.18, -0.02], [0.72, -0.02]]], amber: [0.2, 0.5, -0.36, -0.2], rev: [0.04, 0.16, -0.3, 0.3] });
      });
      diffuser(root, ctx, 0, w * 0.44, 0.08, 0.09);
      [1, -1].forEach(function (s) { tip(root, ctx, s * w * 0.3, by + 0.06, 0.04, { oval: 1.55 }); });
      rearPlate(root, ctx, (by + ty) / 2 - 0.01);
    },

    /* BISON — American muscle & trucks, three faces. TRUCKS/SUVs/VANS: a
       tall chrome-framed grille of thick bars over mesh with a chrome
       crossbar, square lamps with a C-clamp DRL, round fog lamps, vertical
       stacked tails. MUSCLE: a full-width blacked-out mesh grille with quad
       round halo lamps set in it, a full-width segmented tail blade.
       CLASSIC (the lowrider): chrome everything — a vertical-bar grille,
       chrome-bezel quad rounds, chrome bumper blades, triple round tails. */
    bison: function (root, ctx) {
      const k = klass(ctx), w = ctx.w, hy = ctx.headY, by = ctx.baseY, ty = ctx.tailY;
      if (!ctx.noBumpers) addBumpers(root, ctx, true);
      if (k === "muscle" || k === "classic") {
        const classic = k === "classic";
        const gH = clampN((ctx.noseTopY - by) * 0.42, 0.16, 0.24), gy = hy - 0.01;
        const gx = safeX(ctx, 1, gy - gH / 2, gy + gH / 2, 0.02);
        const R = clampN(gH * 0.36, 0.05, 0.075);
        const lampsX = [gx - R * 1.7, gx - R * 4.1];
        const holes = [];
        [1, -1].forEach(function (s) { lampsX.forEach(function (x) { holes.push([s * x, gy, R * 1.22]); }); });
        opening(root, ctx, 1, { x: 0, y: gy, w: gx * 2, h: gH, round: 0.15, depth: 0.034, chrome: classic, bezel: classic ? 0.016 : 0.01, holes: holes,
          fill: classic ? [{ k: "v", p: 0.04, t: 0.011, d: 0.95, chrome: true }] : [{ k: "diamond", p: 0.038, t: 0.007, d: 0.5 }, { k: "h", p: 0.07, t: 0.012, d: 0.8 }] });
        holes.forEach(function (h) { roundLamp(root, ctx, 1, h[0], h[1], R, { halo: !classic, chromeBezel: classic, depth: 0.036 }); });
        if (classic) {
          chromeStrip(root, ctx, 1, -w * 0.47, w * 0.47, by + 0.05, 0.05);
          chromeStrip(root, ctx, -1, -w * 0.47, w * 0.47, by + 0.05, 0.05);
          [1, -1].forEach(function (s) {
            [0.4, 0.29, 0.18].forEach(function (fx) { roundLamp(root, ctx, -1, s * w * fx, ty, 0.055, { tail: true, chromeBezel: true }); });
            tip(root, ctx, s * w * 0.3, by - 0.01, 0.036);
          });
          plate(root, ctx, 1, by + 0.12, 0.012);
          rearPlate(root, ctx, (by + ty) / 2 + 0.03);
          return;
        }
        opening(root, ctx, 1, { x: 0, y: by + 0.07, w: w * 0.5, h: 0.09, depth: 0.036, fill: [{ k: "diamond", p: 0.03, t: 0.006 }], lip: 0.045 });
        [1, -1].forEach(function (s) {
          tailLamp(root, ctx, { side: s, xi: 0.03, xo: cornerX(ctx, -1, ty, 0.02), y: ty, hi: 0.085, ho: 0.085, round: 0.2,
            lit: [[[0.06, 0], [0.3, 0]], [[0.37, 0], [0.62, 0]], [[0.69, 0], [0.93, 0]]], t: 0.03 });
          tip(root, ctx, s * w * 0.34, by + 0.03, 0.05);
        });
        plate(root, ctx, 1, by + 0.07, 0.03);
        rearPlate(root, ctx, (by + ty) / 2 - 0.02);
        return;
      }
      if (k === "semi") {
        /* THE TRACTOR has no loft grid: it is built from blocks (playercars
           makeSemi), with a grille box whose face sits 7 cm behind noseZ,
           box headlamps 3 cm behind it and box tails on the underride bar
           23 cm behind tailZ. The face DRESSES those blocks — it lays its
           units on those planes, sized to cover them — instead of hanging a
           second grille and a second pair of lamps in the air in front. */
        const fy = ctx.bodyY, G = Object.assign({}, ctx, { frontZ: ctx.frontZ - 0.068 });
        const LF = Object.assign({}, ctx, { frontZ: ctx.frontZ - 0.028 }), LR = Object.assign({}, ctx, { rearZ: ctx.rearZ - 0.232 });
        opening(root, G, 1, { x: 0, y: fy + 0.66, w: w * 0.68, h: 0.84, round: 0.1, chrome: true, depth: 0.05, bezel: 0.03,
          fill: [{ k: "diamond", p: 0.036, t: 0.006, d: 0.35 }, { k: "h", p: 0.1, t: 0.034, d: 0.85 }], bars: [0.34, 0.66], barT: 0.06 });
        [1, -1].forEach(function (s) {
          headLamp(root, LF, { side: s, xi: w * 0.33 - 0.2, xo: w * 0.33 + 0.2, y: fy + 0.44, hi: 0.23, ho: 0.23, round: 0.15, chrome: true,
            proj: [0.3, 0.64], projR: 0.28, vanes: [0.47],
            drl: [[[0.95, 0.38], [0.06, 0.38], [0.06, -0.38], [0.95, -0.38]]], drlT: 0.016, amber: [0.84, 0.94, -0.26, 0.26] });
          const lit = [];
          for (let i = 0; i < 4; i++) lit.push([[0.14, 0.34 - i * 0.16], [0.86, 0.34 - i * 0.16]]);
          tailLamp(root, LR, { side: s, xi: w * 0.34 - 0.095, xo: w * 0.34 + 0.095, y: 0.72, hi: 0.37, ho: 0.37, round: 0.12, lit: lit, t: 0.022, rev: [0.12, 0.88, -0.44, -0.3] });
        });
        return;
      }
      /* the big-body faces: TRUCK = thick bars + two chrome crossbars,
         C-clamp chrome lamps, chrome fogs, a lower skid bar; SUV = a chrome
         frame round a fine mesh with one bar, black-housing lamps with an L
         DRL; VAN = a plain black commercial grille of slats, reflector
         lamps, no chrome at all. Anything else wearing the marque gets the
         medium slatted grille. */
      const big = !!TALL[k], truck = k === "truck" || k === "semi", van = k === "van", suv = k === "suv";
      const gTop = Math.min(ctx.noseTopY - 0.035, hy + (big ? 0.11 : 0.06)), gBot = by + (big ? 0.17 : 0.14);
      const gH = Math.max(0.14, gTop - gBot), gW = w * (truck ? 0.54 : big ? 0.5 : 0.44);
      opening(root, ctx, 1, { x: 0, y: (gTop + gBot) / 2, w: gW, h: gH, round: van ? 0.25 : 0.12, chrome: !van, depth: 0.045, bezel: van ? 0.012 : 0.022,
        fill: suv ? [{ k: "diamond", p: 0.036, t: 0.007, d: 0.6 }]
          : van ? [{ k: "h", p: 0.045, t: 0.014, d: 0.8 }]
          : [{ k: "diamond", p: 0.03, t: 0.005, d: 0.35 }, { k: "h", p: big ? 0.08 : 0.06, t: big ? 0.03 : 0.024, d: 0.85 }],
        bars: van ? [] : truck ? [0.33, 0.67] : [0.5], barT: big ? 0.05 : 0.036 });
      const lh = big ? (van ? 0.15 : 0.17) : 0.12;
      [1, -1].forEach(function (s) {
        headLamp(root, ctx, { side: s, xi: gW / 2 + 0.035, xo: cornerX(ctx, 1, hy, 0.02), y: hy, hi: lh, ho: lh, round: 0.15, chrome: !suv,
          proj: van ? [0.36] : [0.3, 0.64], projR: van ? 0.42 : 0.3, vanes: van ? [0.62] : [0.47], halo: false,
          drl: suv ? [[[0.06, 0.38], [0.95, 0.38], [0.95, -0.2]]] : van ? [] : [[[0.95, 0.38], [0.06, 0.38], [0.06, -0.38], [0.95, -0.38]]], drlT: 0.014,
          amber: [0.84, 0.94, -0.26, 0.26] });
        fogLamp(root, ctx, s * w * 0.36, by + 0.085, big ? 0.045 : 0.035, { chrome: truck });
      });
      opening(root, ctx, 1, { x: 0, y: by + 0.06, w: w * 0.4, h: 0.07, depth: 0.03, fill: [{ k: "h", p: 0.025, t: 0.008 }] });
      if (truck) chromeStrip(root, ctx, 1, -w * 0.22, w * 0.22, by + 0.005, 0.03);
      plate(root, ctx, 1, by + 0.06, 0.03);
      // vertical stacked tails on the corners (the van's ride its rear posts)
      const tH = clampN((ctx.tailTopY || ty + 0.2) - by - 0.12, 0.2, 0.42);
      // a posted tail (the van) sits where the body says; otherwise the lamp
      // is laid inward from the usable corner so it keeps its full width
      const tw = ctx.tailW || (big ? 0.2 : 0.16);
      const tx = ctx.tailX != null ? ctx.tailX : safeX(ctx, -1, ty - tH / 2, ty + tH / 2, 0.015) - tw / 2;
      [1, -1].forEach(function (s) {
        const lit = [];
        const n = Math.max(2, Math.round(tH / 0.08));
        for (let i = 0; i < n; i++) { const g = 0.36 - i * (0.5 / Math.max(1, n - 1)); lit.push([[0.12, g], [0.88, g]]); }
        tailLamp(root, ctx, { side: s, xi: tx - tw / 2, xo: tx + tw / 2, y: ty, hi: tH, ho: tH * 0.92, round: 0.12,
          lit: lit, t: 0.02, rev: [0.12, 0.88, -0.44, -0.3] });
        tip(root, ctx, s * w * 0.32, by - 0.01, 0.048, { black: k === "suv" });
      });
      rearPlate(root, ctx);
    },

    /* VOLTRA — the EV. A closed nose: slim swept lamps (a brow DRL and two
       small projectors), no grille, a meshed low intake with a lip and
       air-curtain slits at the corners; a FULL-WIDTH light bar joining the
       tails, a finned diffuser, no exhaust. The wedge truck wears only its
       bars (its nose bar is built with the body). */
    voltra: function (root, ctx) {
      const k = klass(ctx), w = ctx.w, hy = ctx.headY, by = ctx.baseY, ty = ctx.tailY;
      if (!ctx.noBumpers) addBumpers(root, ctx, false);
      if (k === "cyber") {
        opening(root, ctx, 1, { x: 0, y: by + 0.05, w: w * 0.7, h: 0.06, round: 0.1, depth: 0.03, fill: [{ k: "h", p: 0.02, t: 0.008 }] });
        const xb = cornerX(ctx, -1, ty, 0.04);
        lightBar(root, ctx, -1, -xb, xb, ty + 0.05, 0.05, tail());
        diffuser(root, ctx, 0, w * 0.5, 0.08, 0.1);
        rearPlate(root, ctx, (by + ty) / 2);
        return;
      }
      const cross = k === "cross" || k === "suv";
      const hi = cross ? 0.065 : 0.052, ho = cross ? 0.11 : 0.095;
      [1, -1].forEach(function (s) {
        headLamp(root, ctx, { side: s, xi: w * 0.19, xo: cornerX(ctx, 1, hy + 0.02, 0.02), y: hy, slant: 0.03, hi: hi, ho: ho, round: 0.7,
          proj: [0.62, 0.8], projR: 0.36, projG: -0.08,
          drl: [[[0.04, -0.05], [0.2, 0.3], [0.95, 0.32]]], drlT: 0.01 });
        opening(root, ctx, 1, { x: s * w * 0.38, y: by + 0.12, w: 0.05, h: cross ? 0.14 : 0.11, round: 0.6, depth: 0.03 });
      });
      opening(root, ctx, 1, { x: 0, y: by + 0.06, w: w * 0.48, h: cross ? 0.1 : 0.08, round: 0.5, depth: 0.034, fill: [{ k: "diamond", p: 0.028, t: 0.005 }], lip: ctx.sport ? 0.05 : 0.03 });
      [1, -1].forEach(function (s) {
        tailLamp(root, ctx, { side: s, xi: w * 0.2, xo: cornerX(ctx, -1, ty, 0.02), y: ty, slant: 0.015, hi: cross ? 0.065 : 0.05, ho: cross ? 0.1 : 0.08, round: 0.45,
          lit: [[[0.96, 0.24], [0.2, 0.24], [0.06, 0], [0.2, -0.24], [0.96, -0.24]]], t: 0.011, rev: [0.34, 0.5, -0.12, 0.12] });
      });
      lightBar(root, ctx, -1, -w * 0.21, w * 0.21, ty + 0.005, 0.028, tail());
      diffuser(root, ctx, 0, w * 0.5, 0.08, 0.08);
      rearPlate(root, ctx, (by + ty) / 2 - 0.02);
    },

    /* KOTORI — Japanese economy. A thin upper slot with a chrome bar, the
       big honeycomb "smile" below with round fog lamps in black pockets,
       compact lamps with ONE projector over a chrome reflector, a J-shaped
       DRL under it and an amber corner; ringed tails with amber + reverse
       inboard, a single tip. The hatch sits taller and gets a lip. */
    kotori: function (root, ctx) {
      const k = klass(ctx), w = ctx.w, hy = ctx.headY, by = ctx.baseY, ty = ctx.tailY;
      if (!ctx.noBumpers) addBumpers(root, ctx, false);
      const hatch = k === "hatch", tall = !!TALL[k] || k === "cross";
      opening(root, ctx, 1, { x: 0, y: hy - 0.005, w: w * 0.36, h: 0.05, round: 1, depth: 0.024, bars: [0.5], barT: 0.014, fill: [{ k: "h", p: 0.02, t: 0.006 }] });
      [1, -1].forEach(function (s) {
        headLamp(root, ctx, { side: s, xi: w * 0.2, xo: cornerX(ctx, 1, hy, 0.02), y: hy, slant: 0.02, hi: tall ? 0.1 : 0.078, ho: tall ? 0.13 : 0.11, round: 0.6, chrome: true,
          proj: [0.34], projR: 0.46, projG: 0.04,
          drl: [[[0.1, -0.33], [0.84, -0.33], [0.93, -0.12]]], drlT: 0.01,
          amber: [0.66, 0.9, 0.06, 0.3] });
        fogLamp(root, ctx, s * w * 0.375, by + 0.085, 0.032);
      });
      opening(root, ctx, 1, { x: 0, y: by + 0.1, w: w * 0.5, h: hatch ? 0.16 : 0.14, round: 0.8, depth: 0.038, fill: [{ k: "diamond", p: 0.03, t: 0.006, d: 0.55 }], lip: hatch ? 0.035 : 0 });
      plate(root, ctx, 1, by + 0.08, 0.035);
      [1, -1].forEach(function (s) {
        tailLamp(root, ctx, { side: s, xi: w * 0.24, xo: cornerX(ctx, -1, ty, 0.02), y: ty, slant: 0.01, hi: hatch ? 0.13 : 0.1, ho: hatch ? 0.16 : 0.13, round: 0.35,
          lit: [[[0.36, 0.28], [0.92, 0.28], [0.92, -0.28], [0.36, -0.28], [0.36, 0.28]], [[0.46, 0], [0.84, 0]]], amber: [0.06, 0.18, -0.26, 0.26], rev: [0.2, 0.31, -0.26, 0.26] });
      });
      tip(root, ctx, -w * 0.28, by - 0.005, 0.036);
      rearPlate(root, ctx, (by + ty) / 2 - 0.02);
    },

    /* VITESSE — French hyper-luxury. The chrome HORSESHOE (a meshed
       chrome-framed arch) front and centre, slim lamps with four LED cells
       in a row under a brow, big slatted side intakes, a splitter; a full-
       width framed tail line and ONE huge slatted centre exhaust between
       two finned diffusers. */
    vitesse: function (root, ctx) {
      const k = klass(ctx), w = ctx.w, hy = ctx.headY, by = ctx.baseY, ty = ctx.tailY;
      const hsH = clampN((ctx.noseTopY - by) * 0.62, 0.17, 0.3);
      opening(root, ctx, 1, { x: 0, y: ctx.noseTopY - hsH / 2 - 0.02, w: 0.24, h: hsH, map: horseshoe, chrome: true, depth: 0.045, bezel: 0.022,
        fill: [{ k: "diamond", p: 0.026, t: 0.005, d: 0.5 }] });
      [1, -1].forEach(function (s) {
        headLamp(root, ctx, { side: s, xi: w * 0.2, xo: cornerX(ctx, 1, hy, 0.02), y: hy, slant: 0.015, hi: 0.058, ho: 0.078, round: 0.8, chrome: true,
          leds: [0.3, 0.45, 0.6, 0.75], ledG: -0.08, ledW: 0.03, ledH: 0.022,
          drl: [[[0.08, 0.34], [0.94, 0.34]]], drlT: 0.009 });
        opening(root, ctx, 1, { x: s * w * 0.33, y: by + 0.12, w: w * 0.22, h: 0.13, ho: 0.16, slant: 0.01, round: 0.35, depth: 0.042,
          fill: [{ k: "diamond", p: 0.03, t: 0.005, d: 0.4 }, { k: "h", p: 0.035, t: 0.012, d: 0.9 }] });
      });
      opening(root, ctx, 1, { x: 0, y: by + 0.055, w: w * 0.34, h: 0.07, depth: 0.032, fill: [{ k: "diamond", p: 0.028, t: 0.005 }], lip: 0.05 });
      const xt = cornerX(ctx, -1, ty, 0.03);
      lightBar(root, ctx, -1, -xt, xt, ty + 0.02, 0.026, tail());
      [1, -1].forEach(function (s) {
        tailLamp(root, ctx, { side: s, xi: w * 0.3, xo: xt, y: ty - 0.035, hi: 0.04, ho: 0.05, round: 0.6, lit: TL.blade, t: 0.01, rev: [0.06, 0.2, -0.3, 0.3] });
        diffuser(root, ctx, s * w * 0.3, w * 0.26, 0.08, 0.07);
      });
      opening(root, ctx, -1, { x: 0, y: by + 0.075, w: 0.26, h: 0.12, round: 0.6, chrome: true, depth: 0.05, bezel: 0.016, fill: [{ k: "h", p: 0.03, t: 0.01, d: 0.7 }] });
      if (k !== "super") rearPlate(root, ctx, (by + ty) / 2 + 0.04);
    },
  };

  function brandForStyle(style) { return STYLE_BRAND[style] || "bison"; }

  /* The face depends only on the body template and the marque, so it is
     BUILT ONCE per (template ctx, brand) and BAKED: every part is flattened
     into the car frame and merged per material, so a face is ~9 meshes per
     car (one per material) instead of a hundred, and each clone just
     reuses those geometries. */
  const faceCache = new WeakMap();
  const _nm = new THREE.Matrix3(), _v3 = new THREE.Vector3();
  function bakeFace(tmp) {
    const buckets = new Map();
    tmp.children.forEach(function (m) {
      if (!m.geometry || !m.material) return;
      m.updateMatrix();
      let b = buckets.get(m.material);
      if (!b) { b = []; buckets.set(m.material, b); }
      b.push(m);
    });
    const parts = [];
    buckets.forEach(function (list, mat) {
      let n = 0;
      const geos = list.map(function (m) { const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry; n += g.attributes.position.count; return [g, m]; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      let o = 0;
      geos.forEach(function (gm) {
        const g = gm[0], M4 = gm[1].matrix, P = g.attributes.position, N = g.attributes.normal;
        _nm.getNormalMatrix(M4);
        for (let i = 0; i < P.count; i++, o += 3) {
          _v3.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(M4);
          pos[o] = _v3.x; pos[o + 1] = _v3.y; pos[o + 2] = _v3.z;
          if (N) { _v3.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(_nm).normalize(); nor[o] = _v3.x; nor[o + 1] = _v3.y; nor[o + 2] = _v3.z; }
        }
        if (g !== gm[1].geometry) g.dispose();
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      geo.computeBoundingSphere();
      geo._shared = true;
      parts.push({ geo: geo, mat: mat });
    });
    return parts;
  }
  function applyBrandFace(root, brandKey, ctx) {
    const face = FACES[brandKey] || FACES.bison;
    let per = faceCache.get(ctx);
    if (!per) { per = new Map(); faceCache.set(ctx, per); }
    let parts = per.get(brandKey);
    if (!parts) {
      const tmp = new THREE.Group();
      face(tmp, ctx);
      parts = bakeFace(tmp);
      per.set(brandKey, parts);
    }
    for (let i = 0; i < parts.length; i++) {
      const m = new THREE.Mesh(parts[i].geo, parts[i].mat);
      m.castShadow = false;
      m.userData.noSeal = true;
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
