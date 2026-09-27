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

  // lamp materials beyond the two contract singletons. DRAW CALLS: every
  // distinct material is one more merged bucket per car, so the reflector
  // bowl and the plate recess share the grille's black, and the reverse lamp
  // shares the plate's white.
  const housing = () => grille();                                                       // dark reflector bowl
  const reflector = () => M("cp-chrome", "chrome", 0xc4ccd4, { emissive: 0x262b31, ei: 0.3 });
  const tailLens = () => L("cp-taillens", 0x4a0a10, { emissive: 0x2a0306, ei: 0.5 });    // dark red outer lens (NOT a tail by the detector: r<0.78)
  const plateM = () => L("cp-plate", 0xe8ebef, { emissive: 0x30343a, ei: 0.35 });
  const reverseM = () => plateM();                                                      // unlit reverse lamp
  const plateRim = () => grille();

  /* A HEADLAMP UNIT: a dark reflector housing set into the fascia, a chrome
     reflector ring and the lit element (the lightFront contract singleton —
     carlamps.js pushes its emissive at night, crashdeform kills it). */
  function headLamp(root, ctx, x, y, w, h, roll, kind) {
    const r = kind === "round" ? Math.min(w, h) / 2 : kind === "brow" ? h / 2 : Math.min(w, h) * 0.32;
    put(slab(root, w + 0.03, h + 0.03, 0.05, r + 0.015, housing()), ctx, 1, x, y, 0.004, roll);
    if (kind !== "brow") put(slab(root, w, h, 0.02, r, reflector(), 0.004), ctx, 1, x, y, 0.012, roll);
    const ew = kind === "brow" ? w : w * (kind === "quad" ? 0.62 : 0.78), eh = kind === "brow" ? h * 0.8 : h * 0.62;
    put(slab(root, ew, eh, 0.02, Math.min(ew, eh) * 0.45, head(), 0.004), ctx, 1, x + (kind === "brow" ? 0 : Math.sign(x) * w * 0.06), y, 0.024, roll);
  }
  /* A TAIL LAMP: dark red lens, a bright bar inside it (the lightTail
     singleton — vehicles.js swaps it for the braking twin), a reverse lamp. */
  function tailLamp(root, ctx, x, y, w, h, roll, kind, rev) {
    const r = kind === "round" ? Math.min(w, h) / 2 : Math.min(w, h) * 0.3;
    put(slab(root, w + 0.02, h + 0.02, 0.045, r, tailLens(), 0.005), ctx, -1, x, y, 0.004, roll);
    if (kind === "round") put(slab(root, w * 0.66, h * 0.66, 0.02, w * 0.33, tail()), ctx, -1, x, y, 0.016, roll);
    else put(slab(root, w * 0.86, Math.max(0.03, h * 0.36), 0.02, 0.012, tail()), ctx, -1, x, y + h * 0.16, 0.016, roll);
    if (rev) put(slab(root, Math.min(0.12, w * 0.3), Math.max(0.03, h * 0.26), 0.02, 0.01, reverseM()), ctx, -1, x - Math.sign(x) * w * 0.22, y - h * 0.24, 0.016, roll);
  }
  // a plain plate in a dark recess (no marque, no text)
  function plate(root, ctx, end, y) {
    put(slab(root, 0.56, 0.16, 0.03, 0.012, plateRim()), ctx, end, 0, y, 0.002);
    put(slab(root, 0.52, 0.12, 0.02, 0.01, plateM()), ctx, end, 0, y, 0.012);
  }
  function grilleAt(root, ctx, w, h, y, r, frame) {
    put(slab(root, w, h, 0.05, r, grille()), ctx, 1, 0, y, 0.003);
    if (frame) put(slab(root, w + 0.04, 0.025, 0.03, 0.01, frame), ctx, 1, 0, y + h / 2 + 0.005, 0.012);
  }
  function pipe(root, ctx, x, y, r, material) {
    const m = new THREE.Mesh(cylGeo(r, 0.16, 12), material || chrome());
    m.castShadow = false;
    const z = surfZ(ctx, -1, x, y);
    m.position.set(x, y, z - 0.02);
    m.rotation.x = Math.PI / 2;
    root.add(m);
    const inner = new THREE.Mesh(cylGeo(r * 0.72, 0.165, 10), grille());
    inner.position.copy(m.position); inner.rotation.x = Math.PI / 2;
    root.add(inner);
  }

  // ============================================================
  //  BRAND FACES — the design language, placed ON the skin.
  //  ctx (playercars loftCtx): w, frontZ/rearZ, baseY (valance), headY,
  //  tailY, noseTopY, fz/rz grids, lines, paint, noBumpers
  // ============================================================
  const FACES = {
    falcone: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      // a low wide mouth under a slim nose, twin side intakes
      put(slab(root, w * 0.46, 0.11, 0.05, 0.05, grille()), ctx, 1, 0, ctx.baseY + 0.07, 0.003);
      [1, -1].forEach(function (s) {
        put(slab(root, w * 0.16, 0.12, 0.05, 0.04, grille()), ctx, 1, s * w * 0.34, ctx.baseY + 0.08, 0.003, s * 0.12);
        headLamp(root, ctx, s * w * 0.33, hy, w * 0.22, 0.075, s * -0.16, "slant");
      });
      put(slab(root, 0.07, 0.09, 0.02, 0.02, badgeGold()), ctx, 1, 0, hy + 0.02, 0.01);
      // twin round tails a side, quad pipes in a finned diffuser
      [1, -1].forEach(function (s) {
        [0.36, 0.23].forEach(function (fx) { tailLamp(root, ctx, s * w * fx, ctx.tailY, 0.13, 0.13, 0, "round", false); });
      });
      put(slab(root, w * 0.62, 0.12, 0.06, 0.03, grille()), ctx, -1, 0, ctx.baseY + 0.02, 0.003);
      [-0.2, -0.08, 0.08, 0.2].forEach(function (fx) { pipe(root, ctx, fx * w, ctx.baseY + 0.03, 0.042); });
      plate(root, ctx, -1, (ctx.baseY + ctx.tailY) / 2 + 0.02);
    },
    adler: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      if (!ctx.noBumpers) addBumpers(root, ctx, true);
      grilleAt(root, ctx, w * 0.42, 0.12, ctx.baseY + 0.12, 0.04, chrome());
      put(slab(root, w * 0.5, 0.1, 0.05, 0.04, grille()), ctx, 1, 0, ctx.baseY + 0.02, 0.003);   // lower intake
      [1, -1].forEach(function (s) {
        headLamp(root, ctx, s * w * 0.32, hy, 0.24, 0.15, s * -0.08, "round");
        put(slab(root, 0.05, 0.04, 0.02, 0.012, amber()), ctx, 1, s * w * 0.44, hy - 0.08, 0.008);
      });
      put(slab(root, 0.08, 0.08, 0.015, 0.04, chrome()), ctx, 1, 0, hy + 0.02, 0.01);            // roundel
      // full-width slim tail bar
      [1, -1].forEach(function (s) { tailLamp(root, ctx, s * w * 0.26, ctx.tailY, w * 0.42, 0.08, 0, "bar", true); });
      [1, -1].forEach(function (s) { pipe(root, ctx, s * w * 0.3, ctx.baseY + 0.03, 0.045); });
      plate(root, ctx, 1, ctx.baseY + 0.04);
      plate(root, ctx, -1, (ctx.baseY + ctx.tailY) / 2);
    },
    bison: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      if (!ctx.noBumpers) addBumpers(root, ctx, true);
      // tall slatted grille with a chrome crossbar and a red badge bar
      const gH = Math.max(0.16, Math.min(0.32, (hy - ctx.baseY) * 1.1));
      const gy = (hy + ctx.baseY) / 2 + 0.03;
      put(slab(root, w * 0.5, gH, 0.05, 0.03, grille()), ctx, 1, 0, gy, 0.003);
      for (let i = -2; i <= 2; i++) put(slab(root, 0.028, gH * 0.9, 0.02, 0.006, darkTrim()), ctx, 1, i * w * 0.09, gy, 0.012);
      put(slab(root, w * 0.54, 0.05, 0.03, 0.012, chrome()), ctx, 1, 0, gy, 0.02);
      put(slab(root, 0.14, 0.06, 0.02, 0.012, badgeRed()), ctx, 1, 0, gy, 0.034);
      [1, -1].forEach(function (s) { headLamp(root, ctx, s * w * 0.37, hy, 0.24, 0.13, 0, "quad"); });
      // vertical tails at the corners
      const tH = Math.max(0.2, Math.min(0.42, (ctx.tailTopY || ctx.tailY + 0.2) - ctx.baseY - 0.12));
      // (a body with a rear opening says where its lamps may go: the van's
      // tail posts, its bumper step — never the door that swings away)
      const tx = ctx.tailX != null ? ctx.tailX : w * 0.4;
      [1, -1].forEach(function (s) { tailLamp(root, ctx, s * tx, ctx.tailY, ctx.tailW || 0.11, tH, 0, "bar", true); });
      [1, -1].forEach(function (s) { pipe(root, ctx, s * w * 0.32, ctx.baseY - 0.01, 0.05); });
      plate(root, ctx, 1, ctx.baseY + 0.02);
      plate(root, ctx, -1, ctx.rearPlateY != null ? ctx.rearPlateY : (ctx.baseY + ctx.tailY) / 2);
    },
    voltra: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      if (!ctx.noBumpers) addBumpers(root, ctx, false);
      // closed nose: a slim LED brow each side + a low aero slot, no grille
      [1, -1].forEach(function (s) { headLamp(root, ctx, s * w * 0.33, hy, w * 0.2, 0.05, s * -0.05, "brow"); });
      put(slab(root, w * 0.44, 0.07, 0.05, 0.03, grille()), ctx, 1, 0, ctx.baseY + 0.05, 0.003);
      [1, -1].forEach(function (s) {
        const b = put(slab(root, 0.07, 0.02, 0.015, 0.008, chrome()), ctx, 1, s * 0.03, hy + 0.01, 0.01, s * -0.6);
        b.userData.noSeal = true;
      });
      // full-width tail blade
      tailLamp(root, ctx, 0, ctx.tailY, w * 0.84, 0.06, 0, "bar", false);
      put(slab(root, w * 0.5, 0.08, 0.05, 0.03, grille()), ctx, -1, 0, ctx.baseY + 0.02, 0.003);
      plate(root, ctx, -1, (ctx.baseY + ctx.tailY) / 2 - 0.02);
    },
    kotori: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      if (!ctx.noBumpers) addBumpers(root, ctx, false);
      // slim upper slot + a big lower "smile"
      put(slab(root, w * 0.34, 0.05, 0.05, 0.02, grille()), ctx, 1, 0, hy, 0.003);
      put(slab(root, w * 0.5, 0.14, 0.05, 0.05, grille()), ctx, 1, 0, ctx.baseY + 0.06, 0.003);
      [1, -1].forEach(function (s) {
        headLamp(root, ctx, s * w * 0.32, hy, 0.22, 0.1, s * -0.06, "rect");
        put(slab(root, 0.05, 0.05, 0.02, 0.012, amber()), ctx, 1, s * w * 0.45, hy - 0.02, 0.008);
      });
      put(slab(root, 0.06, 0.06, 0.015, 0.03, badgeRed()), ctx, 1, 0, hy, 0.02);
      [1, -1].forEach(function (s) { tailLamp(root, ctx, s * w * 0.36, ctx.tailY, 0.18, 0.13, 0, "rect", true); });
      pipe(root, ctx, -w * 0.28, ctx.baseY - 0.01, 0.038);
      plate(root, ctx, 1, ctx.baseY + 0.06 - 0.1);
      plate(root, ctx, -1, (ctx.baseY + ctx.tailY) / 2);
    },
    vitesse: function (root, ctx) {
      const w = ctx.w, hy = ctx.headY;
      // chrome horseshoe grille front and centre, slim lamps
      put(slab(root, 0.2, 0.2, 0.05, 0.1, grille()), ctx, 1, 0, hy - 0.06, 0.003);
      put(slab(root, 0.24, 0.024, 0.03, 0.01, chrome()), ctx, 1, 0, hy + 0.04, 0.012);
      put(slab(root, w * 0.56, 0.08, 0.05, 0.03, grille()), ctx, 1, 0, ctx.baseY + 0.03, 0.003);
      [1, -1].forEach(function (s) { headLamp(root, ctx, s * w * 0.31, hy, 0.2, 0.07, s * -0.04, "rect"); });
      tailLamp(root, ctx, 0, ctx.tailY, w * 0.78, 0.09, 0, "bar", false);
      put(slab(root, 0.2, 0.12, 0.05, 0.05, chrome()), ctx, -1, 0, ctx.baseY + 0.02, 0.004);
      put(slab(root, 0.14, 0.08, 0.05, 0.04, grille()), ctx, -1, 0, ctx.baseY + 0.02, 0.02);
    },
  };

  function brandForStyle(style) { return STYLE_BRAND[style] || "bison"; }

  function applyBrandFace(root, brandKey, ctx) {
    const face = FACES[brandKey] || FACES.bison;
    face(root, ctx);
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
