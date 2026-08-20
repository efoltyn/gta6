(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;
  const T = window.THREE;

  /* ==========================================================================
     THE SEA, REBUILT FROM THE REFERENCE SHEET (docs/SHARK-REFERENCE.md).

     What was here before was a pile of axis-aligned boxes: every fin in the
     ocean was `box(w, h, d)`, the countershading was one uniform ring cut, the
     mouth had one row of cone teeth on a hairline gum, and the great white's
     head could not open — the mandible swung and the skull stayed put.

     Three shared builders now carry the whole file:

       finGeom()   ONE fin grammar. Swept blade, concave (scythe) trailing
                   edge, free rear tip, rounded-or-pointed apex, thickness that
                   falls to a knife edge at both the tip and both edges. Every
                   dorsal, pectoral, pelvic, anal, caudal lobe, keel, flipper,
                   fluke and manta wing in this file is one call to it.
       hullShell() ONE body grammar. Elliptical cross-sections, and a
                   countershading boundary that is a FUNCTION OF THE RING plus
                   deterministic raggedness — so the white kicks up behind the
                   pectoral and over the gills instead of running dead level.
       addSharkMouth() ONE mouth. Swept gum/lip bands (not boxes), three tooth
                   rows merged into one mesh per jaw, a dark PINK-RED interior,
                   and an upper jaw that SLIDES FORWARD AND DOWN while the
                   rostrum lifts off it.

     BUDGET. Everything is built through a module-scope geometry cache keyed on
     its own parameters, so a pack of three great whites — or a sixty-fish
     sardine shoal — allocates each shape exactly once. The mouth alone went
     from 81 meshes (fifty arc boxes + thirty per-tooth ConeGeometries, all
     freshly allocated per animal) to 8 shared ones.

     DETERMINISM. No Math.random() anywhere below. Skin marks, scars and the
     ragged countershading edge come from CBZ.hash01 on integer indices, so
     they are a property of the SPECIES, not of the individual — per-individual
     variation belongs to whoever owns the spawner, not to a build function.
     ========================================================================== */

  function h01(a, b, salt) {
    return CBZ.hash01 ? CBZ.hash01(a, b, salt | 0) : (((a * 73 + b * 151 + salt * 31) % 97) / 97);
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // read a small control array as a continuous curve over t in [0,1]
  function sample(arr, t) {
    if (!arr.length) return 0;
    if (arr.length === 1) return arr[0];
    const f = clamp(t, 0, 1) * (arr.length - 1);
    const i = Math.min(arr.length - 2, Math.floor(f));
    return lerp(arr[i], arr[i + 1], f - i);
  }
  /* A BODY IS A PROFILE, NOT A STACK OF BOXES. Every fish below is one call:
     the length, the waterline the model rides at, a height curve, a width
     curve, and how many cross-sections to spend on it. */
  function bodyRings(x0, x1, y, hProfile, wProfile, n) {
    const rings = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      rings.push({
        x: lerp(x0, x1, t), y: typeof y === "function" ? y(t) : y,
        ry: sample(hProfile, t), rz: sample(wProfile, t),
      });
    }
    return rings;
  }

  /* ---- geometry cache: build a shape once, hand it to every animal ------- */
  const GEOM = new Map();
  function cachedGeom(key, make) {
    let g = GEOM.get(key);
    if (!g) { g = make(); g._shared = true; GEOM.set(key, g); }
    return g;
  }

  /* ---- indexed shell builder -------------------------------------------
     Vertices are deduplicated by quantised position, which is what gives the
     hulls and fins SMOOTH normals across their rings without an explicit
     normal pass, and which automatically welds a fin's two surfaces where the
     foil thickness reaches zero at the leading/trailing edge. Triangles go
     into numbered groups = material slots. */
  function Shell() { this.p = []; this.k = new Map(); this.g = []; }
  Shell.prototype.v = function (x, y, z) {
    const key = ((x * 8192) | 0) + "," + ((y * 8192) | 0) + "," + ((z * 8192) | 0);
    let i = this.k.get(key);
    if (i === undefined) { i = this.p.length / 3; this.p.push(x, y, z); this.k.set(key, i); }
    return i;
  };
  Shell.prototype.tri = function (g, a, b, c) {
    if (a === b || b === c || a === c) return;
    (this.g[g] || (this.g[g] = [])).push(a, b, c);
  };
  Shell.prototype.quad = function (g, a, b, c, d) { this.tri(g, a, b, c); this.tri(g, a, c, d); };
  // quad, wound to face `nrm`. p* are the four positions in order, v* the
  // interned indices for the same points.
  Shell.prototype.quadN = function (g, nrm, p, v) {
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
    const wx = p[3][0] - p[0][0], wy = p[3][1] - p[0][1], wz = p[3][2] - p[0][2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    if (nx * nrm[0] + ny * nrm[1] + nz * nrm[2] >= 0) this.quad(g, v[0], v[1], v[2], v[3]);
    else this.quad(g, v[3], v[2], v[1], v[0]);
  };
  // an axis-aligned plate lying in the (u,v) plane at `c`, used for scars,
  // pores and skin folds so dozens of marks cost ONE mesh.
  Shell.prototype.plate = function (g, c, u, v, w, h, n) {
    const hu = [u[0] * w * 0.5, u[1] * w * 0.5, u[2] * w * 0.5];
    const hv = [v[0] * h * 0.5, v[1] * h * 0.5, v[2] * h * 0.5];
    const p = function (su, sv) {
      return [c[0] + hu[0] * su + hv[0] * sv, c[1] + hu[1] * su + hv[1] * sv, c[2] + hu[2] * su + hv[2] * sv];
    };
    const pa = p(-1, -1), pb = p(1, -1), pd = p(1, 1), pe = p(-1, 1);
    const a = this.v.apply(this, pa), b = this.v.apply(this, pb);
    const d = this.v.apply(this, pd), e = this.v.apply(this, pe);
    const nrm = n || cross3(u, v);
    this.quadN(g, nrm, [pa, pb, pd, pe], [a, b, d, e]);
  };
  Shell.prototype.geom = function () {
    const idx = [], groups = [];
    let start = 0;
    for (let i = 0; i < this.g.length; i++) {
      const arr = this.g[i];
      if (!arr || !arr.length) continue;
      for (let j = 0; j < arr.length; j++) idx.push(arr[j]);
      groups.push([start, arr.length, i]);
      start += arr.length;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(this.p, 3));
    geo.setIndex(idx);
    for (let i = 0; i < groups.length; i++) geo.addGroup(groups[i][0], groups[i][1], groups[i][2]);
    geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  };
  // one group used => hand the mesh a single material so r128 issues ONE draw
  // call and ignores the groups entirely.
  function meshOf(geo, mats) {
    let used = 0;
    for (let i = 0; i < geo.groups.length; i++) used = Math.max(used, geo.groups[i].materialIndex + 1);
    return new T.Mesh(geo, used > 1 ? mats : mats[0]);
  }

  /* ======================================================================
     THE FIN. One blade grammar for every fin in the ocean.

     Built in a local frame: chord along +x (leading edge forward), span along
     +y (root -> apex), thickness along ±z, then baked into whatever world
     basis the caller asks for so left/right pairs, drooped pectorals and
     raked caudal lobes need no Euler gymnastics at the call site.

     The outline has FOUR corners, which is what a real fin has and a box does
     not: root-leading, apex, free REAR TIP (the sharp corner that trails below
     and behind the apex), root-trailing. The leading edge bows slightly
     forward; the trailing edge between the rear tip and the apex is CONCAVE —
     that scythe cut is the single thing that reads as "shark fin" from a boat.
     ====================================================================== */
  function norm3(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function emitFin(sh, o) {
    const span = o.span, cr = o.chordRoot;
    const xL0 = cr * 0.5, xT0 = -cr * 0.5;
    const xA = xL0 - span * Math.tan(o.sweep || 0);
    const ct = o.chordTip == null ? cr * 0.16 : o.chordTip;
    const hR = o.rearTipH == null ? 0.14 : o.rearTipH;
    const xR = xT0 - (o.rearTipBack == null ? span * 0.12 : o.rearTipBack);
    const con = o.concavity == null ? 0.20 : o.concavity;
    const bow = o.leadBow == null ? 0.05 : o.leadBow;
    const ar = o.apexRound == null ? 0.16 : o.apexRound;
    const th0 = o.thick == null ? cr * 0.14 : o.thick;
    const nS = o.spanSteps || 5, nC = o.chordSteps || 4;
    // How far the blade is buried below its root plane. This is the fix for
    // "the fin is a slab bolted to the shark": the root cap ends up inside the
    // hull, so what the camera sees is a blade coming OUT of the skin.
    const emb = o.embed == null ? cr * 0.30 : o.embed;
    const tipDark = o.tipDark == null ? 2 : o.tipDark;      // >1 disables
    const paleBase = o.paleBase == null ? -1 : o.paleBase;  // <0 disables
    // Reference sheet §5: the above-water dorsal is "LIGHTER and slightly
    // translucent along the trailing edge". That is a CHORDWISE band, not a
    // spanwise one, so it needs its own term — the fraction of the chord back
    // from the trailing edge that takes the pale material. 0 disables.
    // Callers that set it must pass a 4th material.
    const trailPale = o.trailPale == null ? 0 : o.trailPale;
    const under = !!o.under;

    // orthonormal basis: u = chord (forward), v = span (root->tip), w = u x v
    const u = norm3(o.chordDir || [1, 0, 0]);
    let v = o.spanDir || [0, 1, 0];
    const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    v = norm3([v[0] - u[0] * d, v[1] - u[1] * d, v[2] - u[2] * d]);
    const w = norm3(cross3(u, v));
    const og = o.origin || [0, 0, 0];
    function pt(x, y, z) {
      return [og[0] + u[0] * x + v[0] * y + w[0] * z,
        og[1] + u[1] * x + v[1] * y + w[1] * z,
        og[2] + u[2] * x + v[2] * y + w[2] * z];
    }
    function lead(h) { return xL0 + (xA - xL0) * h + bow * span * Math.sin(Math.PI * h); }
    function trail(h) {
      if (h <= hR) return xT0 + (xR - xT0) * (hR > 0 ? h / hR : 1);
      const t = (h - hR) / (1 - hR || 1);
      return xR + ((xA - ct) - xR) * t + con * span * Math.sin(Math.PI * t);
    }
    function wide(h) {
      if (ar <= 0 || h <= 1 - ar) return 1;
      const t = (h - (1 - ar)) / ar;
      return Math.sqrt(Math.max(0, 1 - t * t));
    }

    const rows = [];
    const hMin = span > 1e-6 ? -emb / span : 0;
    const nRoot = emb > 1e-6 ? 1 : 0;          // one extra row for the buried stub
    for (let i = -nRoot; i <= nS; i++) {
      const h = i < 0 ? hMin : i / nS;
      // Below the root plane the outline is PRISMATIC — the root section
      // extruded straight into the body — so the buried stub cannot pinch,
      // twist or poke back out through the far side of the hull.
      const hc = h < 0 ? 0 : h;
      const xl = lead(hc), xt = trail(hc);
      const mid = (xl + xt) * 0.5;
      const half = Math.max(0.0008, (xl - xt) * 0.5) * wide(hc);
      const tk = th0 * Math.pow(Math.min(1.3, 1 - h), 1.25) + th0 * 0.04;
      const top = [], bot = [];
      for (let j = 0; j <= nC; j++) {
        const s = j / nC;
        const x = mid + half * (2 * s - 1);
        const prof = Math.pow(Math.max(0, 4 * s * (1 - s)), 0.55);
        const z = tk * 0.5 * prof;
        top.push(sh.v.apply(sh, pt(x, span * h, z)));
        bot.push(sh.v.apply(sh, pt(x, span * h, -z)));
      }
      rows.push([top, bot]);
    }
    for (let i = 0; i < nS + nRoot; i++) {
      const hm = ((i - nRoot) + 0.5) / nS;
      const gT = hm >= tipDark ? 2 : (hm < paleBase ? 3 : 0);
      const gB = hm >= tipDark ? 2 : (under ? 1 : (hm < paleBase ? 3 : 0));
      for (let j = 0; j < nC; j++) {
        // s = 0 is the TRAILING edge (x = mid - half), s = 1 the leading edge.
        const sm = (j + 0.5) / nC;
        const trail = trailPale > 0 && sm < trailPale && hm < tipDark;
        sh.quad(trail ? 3 : gT, rows[i][0][j], rows[i][0][j + 1], rows[i + 1][0][j + 1], rows[i + 1][0][j]);
        sh.quad(trail ? 3 : gB, rows[i][1][j], rows[i + 1][1][j], rows[i + 1][1][j + 1], rows[i][1][j + 1]);
      }
    }
    for (let j = 0; j < nC; j++) {   // root cap, so the blade is a closed solid
      sh.quad(under ? 1 : 0, rows[0][0][j], rows[0][1][j], rows[0][1][j + 1], rows[0][0][j + 1]);
    }
  }
  // mats: [main, under, tip, base]
  function finMesh(mats, at, shape) {
    const geo = cachedGeom("fin|" + JSON.stringify(shape), function () {
      const sh = new Shell(); emitFin(sh, shape); return sh.geom();
    });
    const m = meshOf(geo, mats);
    if (at) m.position.set(at[0], at[1], at[2]);
    return m;
  }
  /* Several blades in ONE mesh. A cetacean fluke has to be a single object:
     the swim rig picks the rear-most child and decides fish-vs-whale from its
     proportions, and two separate lobes each read as a tall narrow blade. */
  function finsMesh(mats, at, shapes) {
    const geo = cachedGeom("fins|" + JSON.stringify(shapes), function () {
      const sh = new Shell();
      for (let i = 0; i < shapes.length; i++) emitFin(sh, shapes[i]);
      return sh.geom();
    });
    const m = meshOf(geo, mats);
    if (at) m.position.set(at[0], at[1], at[2]);
    return m;
  }
  /* ---- THE PUBLISHED SURFACE -------------------------------------------
     Other marine builders (city/wildlife_orca.js, city/wildlife_shark.js's
     surface proxy) must not grow a second fin grammar. Everything they need is
     here, and CBZ.finBlade takes BOTH call shapes so a caller can ask for a
     finished mesh or just the blade geometry:

       CBZ.finBlade([mat, under, tip, pale], [x,y,z], shape)  -> T.Mesh
       CBZ.finBlade(THREE, shape)                             -> BufferGeometry
       CBZ.finBlade(shape)                                    -> BufferGeometry

     `shape` is emitFin's option bag, and it also accepts the descriptive
     spelling — {root:[x,y,z], tip:[x,y,z], chordRoot, chordTip, sweep,
     concavity, thickRoot} — where root/tip give the origin, the span axis and
     the span length in one, which is usually how you actually know a fin.
     Geometry is cached on the shape, so a pack of six pays for one blade. */
  function finShape(o) {
    if (!o || (!o.root && !o.tip && o.thickRoot == null)) return o;
    const s = {};
    for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) s[k] = o[k];
    if (o.thickRoot != null && s.thick == null) s.thick = o.thickRoot;
    if (o.root) s.origin = o.root;
    if (o.root && o.tip) {
      const d = [o.tip[0] - o.root[0], o.tip[1] - o.root[1], o.tip[2] - o.root[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      if (l > 1e-6) { s.span = l; s.spanDir = [d[0] / l, d[1] / l, d[2] / l]; }
    }
    delete s.root; delete s.tip; delete s.thickRoot; delete s.mat; delete s.tipMat;
    return s;
  }
  function finBladeGeom(shape) {
    const s = finShape(shape);
    return cachedGeom("fin|" + JSON.stringify(s), function () {
      const sh = new Shell(); emitFin(sh, s); return sh.geom();
    });
  }
  CBZ.finBlade = function (a, b, c) {
    if (Array.isArray(a)) return finMesh(a, b, finShape(c));   // (mats, at, shape)
    if (a && a.BufferGeometry) return finBladeGeom(b);         // (THREE, shape)
    return finBladeGeom(a);                                    // (shape)
  };
  CBZ.finBladeGeometry = finBladeGeom;
  CBZ.aquaticFin = finMesh;     // the in-file spelling, kept: callers exist
  CBZ.aquaticFins = finsMesh;   // several blades welded into ONE mesh (flukes)
  // hull-from-rings, with the same shaped/ragged countershading the sharks use
  CBZ.aquaticHull = function (mats, rings, o) { return hullMesh(mats, rings, o || {}); };
  CBZ.aquaticHullGeometry = hullShell;
  CBZ.aquaticBodyRings = bodyRings;

  /* ======================================================================
     THE HULL. Elliptical cross-sections with a SHAPED countershading line.

     `bellyCut` may now be a number (flat, as before), an array (one value per
     ring) or a function(i, u). The value is the sine of the ring angle below
     which a face belongs to the belly, so -1 is all-dark, +1 all-white, and a
     value that rises at the pectoral ring makes the white KICK UP behind the
     fin exactly the way the reference photographs do. A small deterministic
     jitter per column breaks the line into a ragged edge instead of a
     machine-straight seam.
     ====================================================================== */
  function hullShell(o) {
    const rings = o.rings, n = rings.length, sides = Math.max(8, o.sides || 12);
    const rag = o.ragged == null ? 0.06 : o.ragged;
    const seed = o.seed || 11;
    const cutRaw = o.bellyCut == null ? -0.16 : o.bellyCut;
    // an array of cut values is SAMPLED across the rings, so a six-value
    // countershading profile drapes correctly over a twelve-ring body.
    const cutAt = typeof cutRaw === "function" ? cutRaw
      : (Array.isArray(cutRaw)
        ? function (i, u) { return sample(cutRaw, n > 1 ? i / (n - 1) : 0); }
        : function () { return cutRaw; });
    const paint = o.paint || null;
    const sh = new Shell(), id = [];
    for (let i = 0; i < n; i++) {
      const r = rings[i], row = [];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        row.push(sh.v(r.x, r.y + Math.sin(a) * r.ry, Math.cos(a) * r.rz));
      }
      id.push(row);
    }
    function bucket(i, j) {
      const a0 = (j / sides) * Math.PI * 2, a1 = ((j + 1) / sides) * Math.PI * 2;
      const s = (Math.sin(a0) + Math.sin(a1)) * 0.5;
      // ragged: a per-column offset (a wandering line down the flank) plus a
      // smaller per-ring wobble. Both are hash-derived, so the same species
      // always tears the same way and the world stays byte-identical.
      const jitter = (h01(j * 7 + 1, 0, seed) - 0.5) * 2 * rag
        + (h01(j * 7 + 1, i * 13 + 3, seed + 1) - 0.5) * rag * 0.6;
      const belly = s < cutAt(i, n > 1 ? i / (n - 1) : 0) + jitter;
      if (paint) {
        const over = paint(i, n > 1 ? i / (n - 1) : 0, j, s, belly);
        if (over >= 0) return over;
      }
      return belly ? 1 : 0;
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const nj = (j + 1) % sides, g = bucket(i, j);
        sh.quad(g, id[i][j], id[i + 1][j], id[i + 1][nj], id[i][nj]);
      }
    }
    // flat caps keep a deliberately blunt nose/tail instead of quietly turning
    // the end ring back into a cone.
    const rear = sh.v(rings[0].x, rings[0].y, 0);
    const fr = rings[n - 1], front = sh.v(fr.x, fr.y, 0);
    for (let j = 0; j < sides; j++) {
      const nj = (j + 1) % sides;
      sh.tri(bucket(0, j), rear, id[0][j], id[0][nj]);
      sh.tri(bucket(n - 1, j), front, id[n - 1][nj], id[n - 1][j]);
    }
    return sh.geom();
  }
  function hullMesh(mats, rings, o) {
    o = o || {};
    const shape = {
      rings: rings, sides: o.sides, bellyCut: o.bellyCut, ragged: o.ragged, seed: o.seed,
    };
    const key = "hull|" + JSON.stringify(shape) + "|" + (o.paintKey || "");
    const geo = cachedGeom(key, function () {
      return hullShell({
        rings: rings, sides: o.sides, bellyCut: o.bellyCut, ragged: o.ragged,
        seed: o.seed, paint: o.paint,
      });
    });
    return meshOf(geo, mats);
  }
  // interpolate a cross-section, so details can be laid ON the skin instead of
  // floating in front of it (the old gill slabs' whole problem).
  function ringAt(rings, x) {
    let i = 0;
    while (i < rings.length - 2 && rings[i + 1].x < x) i++;
    const a = rings[i], b = rings[i + 1];
    const t = b.x === a.x ? 0 : clamp((x - a.x) / (b.x - a.x), 0, 1);
    return { x: x, y: lerp(a.y, b.y, t), ry: lerp(a.ry, b.ry, t), rz: lerp(a.rz, b.rz, t) };
  }
  function surfPt(rings, x, ang, out) {
    const r = ringAt(rings, x);
    return [x + (out || 0) * 0, r.y + Math.sin(ang) * r.ry, Math.cos(ang) * r.rz];
  }
  function surfNorm(rings, x, ang) {
    const r = ringAt(rings, x);
    return norm3([0, Math.sin(ang) / Math.max(0.01, r.ry), Math.cos(ang) / Math.max(0.01, r.rz)]);
  }
  // a point just PROUD of the skin, with the local outward normal — the pair
  // every surface detail below is placed with.
  function onSkin(rings, x, ang, lift) {
    const p = surfPt(rings, x, ang), nn = surfNorm(rings, x, ang);
    return { p: [p[0] + nn[0] * lift, p[1] + nn[1] * lift, p[2] + nn[2] * lift], n: nn };
  }

  function addSharkHull(g, o) {
    const rings = o.rings || [];
    if (rings.length < 2) return null;
    const hull = hullMesh([o.top, o.belly || o.top], rings, {
      sides: o.sides, bellyCut: o.bellyCut, ragged: o.ragged, seed: o.seed,
    });
    hull.name = "sharkHull";
    g.add(hull);
    const maxWidth = rings.reduce(function (v, r) { return Math.max(v, r.rz * 2); }, 0);
    const maxHeight = rings.reduce(function (v, r) { return Math.max(v, r.ry * 2); }, 0);
    const fr = rings[rings.length - 1];
    const len = rings[rings.length - 1].x - rings[0].x;
    const cut = o.bellyCut;
    let lo = 9, hi = -9;
    if (Array.isArray(cut)) for (let i = 0; i < cut.length; i++) { lo = Math.min(lo, cut[i]); hi = Math.max(hi, cut[i]); }
    else { lo = hi = (typeof cut === "number" ? cut : -0.16); }
    g.userData.sharkShape = {
      profile: o.profile || "broad-wedge",
      noseWidth: fr.rz * 2, noseHeight: fr.ry * 2, headWidth: maxWidth,
      noseWidthRatio: maxWidth > 0 ? (fr.rz * 2) / maxWidth : 0,
      // plan-view read: what a lookout on a deck actually sees
      hullLength: len, hullWidth: maxWidth, hullHeight: maxHeight,
      planRatio: len > 0 ? maxWidth / len : 0,
      bellyLineSpan: hi - lo,                 // 0 = the old dead-level seam
      bellyLineRagged: o.ragged == null ? 0.06 : o.ragged,
    };
    return hull;
  }

  /* ======================================================================
     FACE: eyes, ampullae pores, curved nostril SLITS, gill slots that are
     cut INTO the skin instead of hovering in front of it.
     ====================================================================== */
  function addSharkFaceDetails(g, T_, m, o) {
    const dark = m(o.dark || 0x10161a);
    const rings = o.rings;
    if (o.eyeSize !== 0) {
      const eyeGeom = cachedGeom("eye|" + (o.eyeSize || 0.075), function () {
        return new T.SphereGeometry(o.eyeSize || 0.075, 8, 6);
      });
      [-1, 1].forEach(function (side) {
        const eye = new T.Mesh(eyeGeom, dark);
        eye.name = "sharkEye";
        eye.position.set(o.eyeX, o.eyeY, side * o.eyeZ);
        eye.scale.set(0.85, 1, 0.6);
        g.add(eye);
      });
    }

    // NOSTRILS — short dark CURVED slits on the underside of the rostrum, not
    // spheres. Swept from a tiny arc so they follow the snout's curve.
    const nl = o.nostrilLen || 0.14, nw = o.nostrilWidth || 0.028;
    const slit = cachedGeom("slit|" + nl + "|" + nw, function () {
      const sh = new Shell(), n = 5, rows = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n - 0.5;
        const x = t * nl, z = -Math.cos(t * Math.PI * 0.9) * nl * 0.22;
        rows.push([sh.v(x, 0, z - nw * 0.5), sh.v(x, 0, z + nw * 0.5),
          sh.v(x, -nw * 0.9, z + nw * 0.5), sh.v(x, -nw * 0.9, z - nw * 0.5)]);
      }
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) % 4;
          sh.quad(0, rows[i][k], rows[i][k2], rows[i + 1][k2], rows[i + 1][k]);
        }
      }
      return sh.geom();
    });
    // the snout shell, when there is one, OWNS the nostrils and the ampullae:
    // they lift with the rostrum as the upper jaw slides out from under it.
    const snoutOf = function (mesh) {
      if (!o.snout) { g.add(mesh); return; }
      mesh.position.x -= o.snout.position.x;
      mesh.position.y -= o.snout.position.y;
      mesh.position.z -= o.snout.position.z;
      o.snout.add(mesh);
    };
    [-1, 1].forEach(function (side) {
      const nn = new T.Mesh(slit, dark);
      nn.name = "sharkNostril";
      nn.position.set(o.noseX, o.noseY, side * o.noseZ);
      nn.rotation.y = side * (o.nostrilYaw == null ? 0.5 : o.nostrilYaw);
      snoutOf(nn);
    });

    // GILLS — five slots per side, each one built ON the interpolated hull
    // cross-section so it hugs the flank. Merged into ONE mesh per side: the
    // old version was ten free-floating boxes that read as detached plates.
    const gills = o.gills || 5, pale = m(o.gillColor || 0xbcc6c8);
    if (rings && gills > 0) {
      const gx = o.gillX, gstep = o.gillStep || 0.09;
      const gh = o.gillHeight || 0.34, gAng = o.gillAngle == null ? 0.0 : o.gillAngle;
      const gw = o.gillWidth || 0.032;
      [-1, 1].forEach(function (side) {
        const key = "gill|" + [gills, gx, gstep, gh, gw, gAng, side, o.gillCenter].join(",")
          + "|" + JSON.stringify(rings);
        const geo = cachedGeom(key, function () {
          const sh = new Shell();
          for (let i = 0; i < gills; i++) {
            const x = gx - i * gstep;
            const hgt = gh * (1 - i * 0.05);
            const steps = 4;
            const prev = [];
            for (let k = 0; k <= steps; k++) {
              // walk the slot up the flank along the real ring angle
              const t = k / steps - 0.5;
              const ang = (o.gillCenter == null ? 0 : o.gillCenter) + side * 0 + t * (hgt / Math.max(0.05, ringAt(rings, x).ry));
              const a = side > 0 ? ang : Math.PI - ang;
              const sk = onSkin(rings, x - t * hgt * Math.sin(gAng), a, 0.005);
              const c = sk.p, hw = gw * 0.5;
              const P = function (dx) { return [c[0] + dx, c[1], c[2]]; };
              const q = [P(hw), P(-hw), P(-hw - gw * 0.10), P(-hw - gw * 0.62)];
              prev.push({ n: sk.n, p: q, v: q.map(function (r) { return sh.v(r[0], r[1], r[2]); }) });
              if (k > 0) {
                const a0 = prev[k - 1], a1 = prev[k];
                sh.quadN(0, a1.n, [a0.p[0], a1.p[0], a1.p[1], a0.p[1]],
                  [a0.v[0], a1.v[0], a1.v[1], a0.v[1]]);        // the pale slot
                sh.quadN(1, a1.n, [a0.p[2], a1.p[2], a1.p[3], a0.p[3]],
                  [a0.v[2], a1.v[2], a1.v[3], a0.v[3]]);        // its shadow line
              }
            }
          }
          return sh.geom();
        });
        const gm = meshOf(geo, [pale, m(o.gillDark || 0x1d2429)]);
        gm.name = "sharkGill";
        g.add(gm);
      });
    }

    // AMPULLAE OF LORENZINI — dozens of dark pores speckled over the WHITE
    // underside of the rostrum. One merged mesh, hash-placed, so it is a
    // species trait and costs a single draw call.
    if (rings && o.pores !== 0) {
      const count = o.pores || 46, pr = o.poreSize || 0.018;
      const x0 = o.poreX0, x1 = o.poreX1, spread = o.poreSpread == null ? 0.85 : o.poreSpread;
      const pRings = o.snoutRings || rings;
      const key = "pore|" + [count, pr, x0, x1, spread, o.poreSeed || 5].join(",") + "|" + JSON.stringify(pRings);
      const geo = cachedGeom(key, function () {
        const sh = new Shell();
        for (let i = 0; i < count; i++) {
          const u = h01(i * 3 + 1, 7, o.poreSeed || 5);
          const w2 = h01(i * 3 + 2, 11, o.poreSeed || 5);
          const x = lerp(x0, x1, u * u * 0.85 + 0.08);
          const ang = -Math.PI * 0.5 + (w2 - 0.5) * 2 * spread;
          const sk = onSkin(pRings, x, ang, 0.006);
          const tang = norm3(cross3(sk.n, [1, 0, 0]));
          const fwd = norm3(cross3(tang, sk.n));
          const s2 = pr * (0.65 + h01(i, 3, 9) * 0.7);
          sh.plate(0, sk.p, fwd, tang, s2, s2, sk.n);
        }
        return sh.geom();
      });
      const pm = new T.Mesh(geo, m(o.poreColor || 0x3c4348));
      pm.name = "sharkPores";
      snoutOf(pm);
      if (g.userData.sharkShape) g.userData.sharkShape.pores = count;
    }
  }

  /* ======================================================================
     SKIN: rake scars on the dark dorsal surface + horizontal flank folds
     behind the head. Both merged into ONE two-group mesh.
     ====================================================================== */
  function addSharkSkin(g, m, o) {
    const rings = o.rings;
    if (!rings) return;
    const scars = o.scars == null ? 9 : o.scars, folds = o.folds == null ? 3 : o.folds;
    if (!scars && !folds) return;
    const seed = o.skinSeed || 17;
    const key = "skin|" + [scars, folds, seed, o.scarLen || 0.4, o.foldX || 0, o.foldSpan || 0.5].join(",")
      + "|" + JSON.stringify(rings);
    const geo = cachedGeom(key, function () {
      const sh = new Shell();
      const x0 = rings[0].x, x1 = rings[rings.length - 1].x;
      for (let i = 0; i < scars; i++) {
        const u = h01(i * 5 + 1, 2, seed);
        const w2 = h01(i * 5 + 3, 4, seed);
        const x = lerp(x0 + (x1 - x0) * 0.18, x0 + (x1 - x0) * 0.92, u);
        const ang = Math.PI * 0.5 + (w2 - 0.5) * 1.9;      // upper (dark) surfaces only
        const sk = onSkin(rings, x, ang, 0.006);
        const tang = norm3(cross3(sk.n, [1, 0, 0]));
        const fwd = norm3(cross3(tang, sk.n));
        void sk; void tang; void fwd;
        const len = (o.scarLen || 0.4) * (0.4 + h01(i, 9, seed) * 1.1);
        const rot = (h01(i, 13, seed) - 0.5) * 1.5;
        const hw = (o.scarWidth || 0.022) * (0.7 + h01(i, 21, seed) * 0.8) * 0.5;
        const steps = 4;
        const ry0 = Math.max(0.05, ringAt(rings, x).ry);
        const dX = Math.cos(rot) * len, dA = Math.sin(rot) * len / ry0;
        const st = [];
        for (let k = 0; k <= steps; k++) {
          const t = k / steps - 0.5;
          st.push(onSkin(rings, clamp(x + dX * t, x0 + 0.03, x1 - 0.03), ang + dA * t, 0.006));
        }
        const side = [];
        for (let k = 0; k <= steps; k++) {
          const a = st[Math.max(0, k - 1)].p, b = st[Math.min(steps, k + 1)].p;
          const dir = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
          const tg = norm3(cross3(st[k].n, dir));
          const q = st[k].p;
          const p0 = [q[0] + tg[0] * hw, q[1] + tg[1] * hw, q[2] + tg[2] * hw];
          const p1 = [q[0] - tg[0] * hw, q[1] - tg[1] * hw, q[2] - tg[2] * hw];
          side.push({ n: st[k].n, p: [p0, p1], v: [sh.v(p0[0], p0[1], p0[2]), sh.v(p1[0], p1[1], p1[2])] });
        }
        for (let k = 1; k <= steps; k++) {
          const a0 = side[k - 1], a1 = side[k];
          sh.quadN(0, a1.n, [a0.p[0], a1.p[0], a1.p[1], a0.p[1]],
            [a0.v[0], a1.v[0], a1.v[1], a0.v[1]]);
        }
      }
      // WRINKLE FOLDS — long horizontal creases along the flank behind the
      // head. Cheap, and per the reference sheet enormously effective.
      for (let i = 0; i < folds; i++) {
        const x = (o.foldX || 0) - i * (o.foldStep || 0.16);
        const span = o.foldSpan || 0.5;
        for (let side = -1; side <= 1; side += 2) {
          const steps = 5, prev = [];
          for (let k = 0; k <= steps; k++) {
            const t = k / steps;
            const ang = side > 0 ? lerp(-0.25, 0.75, t) : Math.PI - lerp(-0.25, 0.75, t);
            const sk = onSkin(rings, x - t * span * 0.28, ang, 0.004);
            const tang = norm3(cross3(sk.n, [1, 0, 0]));
            const hw = (o.foldWidth || 0.03) * 0.5;
            const pf = [sk.p[0] + tang[0] * hw, sk.p[1] + tang[1] * hw, sk.p[2] + tang[2] * hw];
            const pb = [sk.p[0] - tang[0] * hw, sk.p[1] - tang[1] * hw, sk.p[2] - tang[2] * hw];
            prev.push({ n: sk.n, p: [pf, pb], v: [sh.v(pf[0], pf[1], pf[2]), sh.v(pb[0], pb[1], pb[2])] });
            if (k > 0) {
              const a0 = prev[k - 1], a1 = prev[k];
              sh.quadN(1, a1.n, [a0.p[0], a1.p[0], a1.p[1], a0.p[1]],
                [a0.v[0], a1.v[0], a1.v[1], a0.v[1]]);
            }
          }
        }
      }
      return sh.geom();
    });
    const mesh = meshOf(geo, [m(o.scarColor || 0xb9c0c2), m(o.foldColor || 0x4d565c)]);
    mesh.name = "sharkSkinMarks";
    g.add(mesh);
    if (g.userData.sharkShape) {
      g.userData.sharkShape.scars = scars;
      g.userData.sharkShape.folds = folds;
    }
  }

  /* ======================================================================
     THE MOUTH.

     Reference sheet §1, in order of how badly it was wrong:

     1. THE UPPER JAW PROTRUDES. A great white does not hinge a lid; the
        palatoquadrate SLIDES FORWARD AND DOWN out from under the snout and
        the snout LIFTS off it. At full gape the upper tooth row ends up in
        FRONT of the closed-mouth rostrum tip. wildlife.js's swimJaw already
        reads `protrude`/`upperDrop` off the contract, so the numbers below
        reach the shipping driver for free; the extra rake of the tooth row and
        the rostrum lift ride an updateMatrix hook on the upper-jaw group (and
        CBZ.sharkJawProtrude, for any driver that wants to call it directly).
     2. The gape ROUNDS OUT — the corner pulls back, it is not a wedge.
     3. Gums are a thick, wet, dark RED-PINK band, darkening in the corners.
     4. The interior is dark PINK-RED. A near-black void reads as a hole in the
        mesh, which is exactly what 0x10070a looked like.
     5. THREE tooth rows, the rear ones smaller and raked further back, teeth
        shrinking and raking toward the jaw corners, warm off-white with a
        pink root where the enamel meets the gum. Serrated edges.

     All of it merges to EIGHT meshes (was 81), every geometry cached.
     ====================================================================== */
  /* A TOOTH, not a cone. A flat triangular blade with SERRATED edges, a rake
     curve toward the jaw corner, and a pinkish root band where the enamel
     meets the gum. Emitted into a shared Shell so a whole three-row tooth
     field is ONE mesh instead of forty freshly-allocated ConeGeometries.
     groups: 0 = enamel, 1 = root. */
  function emitTooth(sh, origin, wDir, hDir, t) {
    const nDir = norm3(cross3(wDir, hDir));
    const half = t.thick * 0.5;
    function P(x, y, z) {
      return [origin[0] + wDir[0] * x + hDir[0] * y + nDir[0] * z,
        origin[1] + wDir[1] * x + hDir[1] * y + nDir[1] * z,
        origin[2] + wDir[2] * x + hDir[2] * y + nDir[2] * z];
    }
    const ax = t.curve * t.w * 0.5, hgt = t.h;
    const out = [];
    out.push([t.w * 0.5, 0]);
    const ns = t.serr > 0 ? 2 : 0;
    for (let k = 1; k <= ns; k++) {
      const f = k / (ns + 1);
      const nudge = (k % 2 ? -1 : 1) * t.serr * t.w;
      out.push([lerp(t.w * 0.5, ax, f) + nudge, hgt * f]);
    }
    out.push([ax, hgt]);
    for (let k = ns; k >= 1; k--) {
      const f = k / (ns + 1);
      const nudge = (k % 2 ? 1 : -1) * t.serr * t.w;
      out.push([lerp(-t.w * 0.5, ax, f) + nudge, hgt * f]);
    }
    out.push([-t.w * 0.5, 0]);
    const gRoot = 1, gEn = 0;
    const front = [], back = [];
    for (let k = 0; k < out.length; k++) {
      front.push(sh.v.apply(sh, P(out[k][0], out[k][1], half)));
      back.push(sh.v.apply(sh, P(out[k][0], out[k][1], -half)));
    }
    const cF = sh.v.apply(sh, P(0, 0, half)), cB = sh.v.apply(sh, P(0, 0, -half));
    const grpFor = function (k) { return out[k][1] < hgt * t.rootFrac ? gRoot : gEn; };
    for (let k = 0; k < out.length - 1; k++) {
      sh.tri(grpFor(k), cF, front[k], front[k + 1]);
      sh.tri(grpFor(k), cB, back[k + 1], back[k]);
      sh.quad(grpFor(k), front[k], back[k], back[k + 1], front[k + 1]);
    }
    sh.tri(gRoot, cF, front[out.length - 1], front[0]);
    sh.tri(gRoot, cB, back[0], back[out.length - 1]);
  }

  function addSharkMouth(g, T_, m, o) {
    const hingeX = o.hingeX, hingeY = o.hingeY, len = o.length, width = o.width, gap = o.gap;
    const gumH = o.gumHeight || gap * 0.30;
    const lipH = gumH + gap * 0.09;
    const railIn = o.railIn || width * 0.11;
    const railOut = o.railOut || width * 0.10;
    const toothH = o.toothHeight || gap * 0.48;
    const toothW = o.toothWidth || toothH * 0.86;
    const rowTeeth = o.rowTeeth || 17;
    const A = o.arcSpan == null ? Math.PI * 0.49 : o.arcSpan;
    const upperY = gap * 0.27, lowerY = -gap * 0.27;
    const cx = len * 0.18, rad = len * 0.82, hw = width * 0.5;

    const gum = m(o.gum || 0x8e3b42), gumDark = m(o.gumDark || 0x5e2229);
    const enamel = m(o.tooth || 0xf2ead6), root = m(o.toothRoot || 0xd6a9a4);
    const cavityMat = m(o.cavity || 0x63262c);
    const skin = m(o.skin || 0xdfe4e6), upperSkin = m(o.upperSkin || o.skin || 0x6b7880);

    // The jaw line is not level. It rises toward the corners so the whole arc
    // follows the underside of the head — which is what actually seats the
    // mouth inside the skull instead of hanging it off the chin.
    const cornerRise = o.cornerRise == null ? gap * 0.42 : o.cornerRise;
    function riseAt(a) { return cornerRise * Math.pow(Math.abs(a) / (A || 1), 1.7); }
    function arcPt(a) { return [cx + rad * Math.cos(a), hw * Math.sin(a)]; }
    function arcN(a) {   // outward normal in XZ
      const tx = -rad * Math.sin(a), tz = hw * Math.cos(a);
      const l = Math.hypot(tx, tz) || 1;
      return [tz / l, -tx / l];
    }

    /* ---- the gum + lip band: one swept solid with an inner (gum) face and
            an outer (skin) face, replacing ten overlapping boxes per jaw ---- */
    function bandGeom(y, up, stations) {
      const sh = new Shell(), rows = [];
      for (let i = 0; i <= stations; i++) {
        const a = -A + (i / stations) * 2 * A;
        const p = arcPt(a), nn = arcN(a);
        const yr = y + riseAt(a);
        const corner = function (dn, dy) {
          return sh.v(p[0] + nn[0] * dn, yr + dy, p[1] + nn[1] * dn);
        };
        rows.push({
          a: a,
          c: [corner(-railIn, gumH * 0.5), corner(-railIn, -gumH * 0.5),
            corner(railOut, -lipH * 0.45), corner(railOut, lipH * 0.45)],
        });
      }
      // face 0 inner, 1 bottom, 2 outer, 3 top.  The mouth-facing pair is the
      // gum; the pair facing the world is skin.
      const gumFaces = up ? { 0: 1, 1: 1, 2: 0, 3: 0 } : { 0: 1, 1: 0, 2: 0, 3: 1 };
      for (let i = 0; i < stations; i++) {
        const am = (rows[i].a + rows[i + 1].a) * 0.5;
        const corner = Math.abs(am) > A * 0.60;
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) % 4;
          const grp = gumFaces[k] ? (corner ? 2 : 0) : 1;
          sh.quad(grp, rows[i].c[k], rows[i].c[k2], rows[i + 1].c[k2], rows[i + 1].c[k]);
        }
      }
      sh.quad(2, rows[0].c[3], rows[0].c[2], rows[0].c[1], rows[0].c[0]);
      const L = rows[stations].c;
      sh.quad(2, L[0], L[1], L[2], L[3]);
      return sh.geom();
    }
    function band(y, up, name, parent) {
      const key = "jawband|" + [y, up, gumH, lipH, railIn, railOut, len, width, A, cornerRise].join(",");
      const geo = cachedGeom(key, function () { return bandGeom(y, up, 14); });
      const mesh = meshOf(geo, [gum, up ? upperSkin : skin, gumDark]);
      mesh.name = name;
      parent.add(mesh);
      return mesh;
    }

    /* ---- one merged tooth field per jaw: three rows, tapering and raking
            toward the corners, serrated, pink where enamel meets gum ------- */
    function toothField(up) {
      const rows = o.toothRows || [
        { n: rowTeeth, r: 1.00, size: 1.00, rake: 0.16 },
        { n: rowTeeth, r: 0.86, size: 0.70, rake: 0.62 },
        { n: Math.max(5, (rowTeeth * 0.55) | 0), r: 0.72, size: 0.44, rake: 1.02 },
      ];
      const key = "teeth|" + [up, len, width, toothH, toothW, A, cornerRise, JSON.stringify(rows)].join(",");
      const geo = cachedGeom(key, function () {
        const sh = new Shell();
        const sgn = up ? -1 : 1;                     // which way the crowns point
        const baseY = up ? upperY - gumH * 0.22 : lowerY + gumH * 0.22;
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          for (let i = 0; i < row.n; i++) {
            const t = row.n === 1 ? 0.5 : i / (row.n - 1);
            const a = -A * 0.94 + t * 2 * A * 0.94;
            const corner = Math.abs(a) / A;
            // front teeth are broad; they shrink and rake back toward the
            // corners exactly as the reference sheet calls out
            const sc = row.size * (1 - 0.44 * corner * corner);
            const rk = row.rake + 0.5 * corner;
            const p = arcPt(a), nn = arcN(a);
            const px = cx + (p[0] - cx) * row.r, pz = p[1] * row.r;
            const wDir = norm3([-rad * Math.sin(a), 0, hw * Math.cos(a)]);
            const hDir = norm3([-nn[0] * Math.sin(rk), sgn * Math.cos(rk), -nn[1] * Math.sin(rk)]);
            emitTooth(sh, [px, baseY + riseAt(a), pz], wDir, hDir, {
              w: toothW * sc, h: toothH * sc, thick: toothW * sc * 0.17,
              serr: r === 0 ? 0.055 : 0, curve: 0.10 + corner * 0.28,
              rootFrac: 0.30,
            });
          }
        }
        return sh.geom();
      });
      const mesh = meshOf(geo, [enamel, root]);
      mesh.name = up ? "sharkUpperTooth" : "sharkLowerTooth";
      return { mesh: mesh, count: rows.reduce(function (s, r) { return s + r.n; }, 0) };
    }
    /* ---------------------------------------------------------------- build */
    const cavity = new T.Mesh(
      cachedGeom("cavity", function () { return new T.SphereGeometry(1, 12, 8); }), cavityMat);
    cavity.name = "sharkMouthCavity";
    cavity.position.set(hingeX + len * 0.58, hingeY - gap * 0.04, 0);
    cavity.scale.set(len * 0.74, gap * 0.10, width * 0.44);
    g.add(cavity);

    const upper = new T.Group(); upper.name = "sharkUpperJaw";
    const lower = new T.Group(); lower.name = "sharkLowerJaw";
    upper.position.set(hingeX, hingeY, 0);
    lower.position.set(hingeX, hingeY, 0);   // this origin IS the physical hinge
    g.add(upper); g.add(lower);

    band(upperY, true, "sharkUpperGum", upper);
    band(lowerY, false, "sharkLowerGum", lower);
    // the mandible: a slim seat under the lower gum. The hull is the chin — a
    // thick slab here is what used to read as a bolted-on box of dentures.
    const mandKey = "mandible|" + [lowerY, gumH, railIn, railOut, len, width, A, cornerRise].join(",");
    const mand = meshOf(cachedGeom(mandKey, function () {
      const save = [gumH, lipH];
      void save;
      const sh = new Shell(), rows = [];
      const y = lowerY - gumH * 0.62, h = gumH * 1.0, ri = railIn * 1.05, ro = railOut * 1.15;
      for (let i = 0; i <= 14; i++) {
        const a = -A + (i / 14) * 2 * A;
        const p = arcPt(a), nn = arcN(a);
        const yr = y + riseAt(a);
        const corner = function (dn, dy) { return sh.v(p[0] + nn[0] * dn, yr + dy, p[1] + nn[1] * dn); };
        rows.push([corner(-ri, h * 0.5), corner(-ri, -h * 0.4), corner(ro, -h * 0.5), corner(ro, h * 0.5)]);
      }
      for (let i = 0; i < 14; i++) {
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) % 4;
          sh.quad(0, rows[i][k], rows[i][k2], rows[i + 1][k2], rows[i + 1][k]);
        }
      }
      sh.quad(0, rows[0][3], rows[0][2], rows[0][1], rows[0][0]);
      sh.quad(0, rows[14][0], rows[14][1], rows[14][2], rows[14][3]);
      return sh.geom();
    }), [skin]);
    mand.name = "sharkMandible";
    lower.add(mand);

    const ut = toothField(true), lt = toothField(false);
    upper.add(ut.mesh); lower.add(lt.mesh);

    // The front lip lobes stay their own small meshes: they are the visible
    // front of the mouth line AND the pair every mouth test measures the gape
    // between, which a merged ring cannot answer for.
    const lipGeom = cachedGeom("liptip|" + [len, lipH, width].join(","), function () {
      return new T.BoxGeometry(len * 0.13, lipH, width * 0.20);
    });
    const ul = new T.Mesh(lipGeom, upperSkin); ul.name = "sharkUpperLip";
    ul.position.set(cx + rad * 1.0, upperY, 0); upper.add(ul);
    const ll = new T.Mesh(lipGeom, skin); ll.name = "sharkLowerLip";
    ll.position.set(cx + rad * 1.0, lowerY, 0); lower.add(ll);

    const restClose = 0.04;
    lower.rotation.z = restClose;

    const protrude = o.protrude == null ? len * 0.42 : o.protrude;
    const upperDrop = o.upperDrop == null ? gap * 0.34 : o.upperDrop;
    const upperRake = o.upperRake == null ? 0.30 : o.upperRake;
    const snoutLift = o.snoutLift == null ? 0.11 : o.snoutLift;

    const contract = {
      version: 3,
      shape: "arched-underside",
      hinge: { x: hingeX, y: hingeY, z: 0 },
      // THE DAMAGE SOCKET follows the mouth DOWN. The upper jaw now drops and
      // rakes as it protrudes, so a socket pinned to the hinge height ends up
      // above the open tooth ring — i.e. damage resolving in clear water just
      // over the teeth. Bias it to the centre of the open gape instead.
      bite: { x: hingeX + len * 0.96, y: hingeY - (o.upperDrop == null ? gap * 0.34 : o.upperDrop) * 0.6, z: 0 },
      maxOpen: o.maxOpen || 1.05,
      travel: (o.maxOpen || 1.05) + restClose,
      restClose: restClose,
      protrude: protrude,
      upperDrop: upperDrop,
      upperRake: upperRake,
      snoutLift: snoutLift,
      toothRows: (o.toothRows || [0, 0, 0]).length,
      upperTeeth: ut.count,
      lowerTeeth: lt.count,
      // the fact the reference sheet is really asking for: how far past the
      // closed rostrum tip the upper tooth row travels
      upperReachX: hingeX + len + protrude,
    };
    g.userData.aquaticMouth = contract;
    g._aquaticMouth = { lower: lower, upper: upper, cavity: cavity, contract: contract };

    /* ---- THE PROTRUSION DRIVE ------------------------------------------
       wildlife.js's swimJaw translates the named upper-jaw group by
       `protrude`/`upperDrop`. That is already the whole slide; what it cannot
       do without knowing about sharks is RAKE the tooth row over and LIFT the
       rostrum. Both hang off the group's own updateMatrix, so any driver that
       moves the named group at all — the shipping one does — gets them free,
       and CBZ.sharkJawProtrude(group, openness) is there for one that would
       rather ask directly. */
    const baseX = upper.position.x, baseY = upper.position.y;
    function applyGape(k) {
      const oo = clamp(k, 0, 1);
      upper.rotation.z = -oo * upperRake;
      const rost = g.userData._sharkRostrum;
      if (rost) rost.rotation.z = oo * snoutLift;
    }
    upper.updateMatrix = function () {
      const k = protrude > 1e-6 ? (this.position.x - baseX) / protrude
        : (upperDrop > 1e-6 ? (baseY - this.position.y) / upperDrop : 0);
      applyGape(k);
      T.Object3D.prototype.updateMatrix.call(this);
    };
    g._aquaticMouth.applyGape = applyGape;
    return g._aquaticMouth;
  }

  // A driver that wants the full protrusion without going through swimJaw can
  // call this: it does the slide, the drop, the tooth-row rake and the snout
  // lift in one, and leaves the mandible to whoever owns the hinge.
  CBZ.sharkJawProtrude = function (group, openness) {
    const mouth = group && group._aquaticMouth;
    if (!mouth) return false;
    const c = mouth.contract, k = clamp(openness || 0, 0, 1);
    mouth.upper.position.x = c.hinge.x + k * c.protrude;
    mouth.upper.position.y = c.hinge.y - k * c.upperDrop;
    if (mouth.applyGape) mouth.applyGape(k);
    return true;
  };

  /* The lifting snout. The hull is one static mesh, so the rostrum forward of
     the jaw hinge is built as its OWN shell that overlaps back into the head —
     it pivots up out of the way as the palatoquadrate slides out from under
     it, and at rest it is simply the front of the animal. */
  function addSharkRostrum(g, mats, rings, o) {
    const px = o.pivotX, py = o.pivotY;
    const local = rings.map(function (r) {
      return { x: r.x - px, y: r.y - py, ry: r.ry * (r.x < px ? (o.tuck || 0.97) : 1), rz: r.rz * (r.x < px ? (o.tuck || 0.97) : 1) };
    });
    const mesh = hullMesh(mats, local, {
      sides: o.sides, bellyCut: o.bellyCut, ragged: o.ragged, seed: o.seed,
    });
    mesh.name = "sharkRostrum";
    mesh.position.set(px, py, 0);
    g.add(mesh);
    g.userData._sharkRostrum = mesh;
    return mesh;
  }

  /* ============================================================
     GREAT WHITE SHARK — Carcharodon carcharias. ~4.5 m. THE HERO MODEL.
     Everything above exists for this animal; every other shark in the
     catalogue is a deviation from it. Read docs/SHARK-REFERENCE.md alongside.
     ============================================================ */
  const GW_RINGS = [
    { x: -1.62, y: 0.860, ry: 0.170, rz: 0.115 },
    { x: -1.15, y: 0.855, ry: 0.320, rz: 0.225 },
    { x: -0.50, y: 0.850, ry: 0.500, rz: 0.375 },
    { x: 0.20, y: 0.850, ry: 0.600, rz: 0.455 },
    { x: 0.85, y: 0.860, ry: 0.615, rz: 0.485 },   // MAX GIRTH — the pectoral line
    { x: 1.45, y: 0.885, ry: 0.545, rz: 0.455 },
    { x: 1.95, y: 0.935, ry: 0.420, rz: 0.405 },   // wide, low head dome
    { x: 2.16, y: 0.965, ry: 0.296, rz: 0.320 },   // buried under the rostrum shell
  ];
  const GW_SNOUT = [
    { x: 1.70, y: 0.905, ry: 0.487, rz: 0.432 },   // tucks back inside the head
    { x: 1.95, y: 0.935, ry: 0.420, rz: 0.405 },
    { x: 2.33, y: 1.000, ry: 0.255, rz: 0.315 },
    { x: 2.62, y: 1.035, ry: 0.125, rz: 0.195 },   // blunt, slightly upturned tip
  ];
  // The countershading LINE, per ring. It runs low across the cheek and kicks
  // hard UP behind the pectoral and over the gills — reference sheet §2. The
  // old single scalar made it a dead-level band all the way down the animal.
  const GW_BELLY = [-0.38, -0.34, -0.26, -0.10, 0.16, 0.00, -0.20, -0.28];
  const GW_SNOUT_BELLY = [-0.14, -0.20, -0.36, -0.46];

  S({
    id: "great_white_shark", name: "Great White Shark", biome: "water",
    rarity: "rare", hp: 140, fur: "Shark Fin", furValue: 260,
    meat: "Shark Meat", meatValue: 30, packs: 3, spd: 2.6, danger: 0.6,
    bite: 30, aquatic: true, scale: 1.2, color: 0x363c40,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const grey = m(0x363c40), white = m(0xf1f4f4);
      const finDark = m(0x2b3134), finTip = m(0x1b1f22), finPale = m(0x545c60);

      addSharkHull(g, {
        top: grey, belly: white, sides: 16, rings: GW_RINGS,
        bellyCut: GW_BELLY, ragged: 0.075, seed: 21, profile: "torpedo-wedge",
      });
      // the mouth goes in BEFORE the rostrum so the snout's matrix is solved
      // after the upper jaw has told it how far to lift this frame
      addSharkMouth(g, T, m, {
        hingeX: 1.62, hingeY: 0.716, length: 0.90, width: 0.66, gap: 0.30,
        toothHeight: 0.145, toothWidth: 0.118, rowTeeth: 19, cornerRise: 0.135,
        maxOpen: 1.05, skin: 0xf1f4f4, upperSkin: 0x363c40,
      });
      const snout = addSharkRostrum(g, [grey, white], GW_SNOUT, {
        pivotX: 1.95, pivotY: 0.950, sides: 16,
        bellyCut: GW_SNOUT_BELLY, ragged: 0.055, seed: 22, tuck: 0.90,
      });
      addSharkFaceDetails(g, T, m, {
        rings: GW_RINGS, snout: snout, snoutRings: GW_SNOUT,
        eyeX: 2.10, eyeY: 1.065, eyeZ: 0.335, eyeSize: 0.055, dark: 0x07090a,
        noseX: 2.36, noseY: 0.782, noseZ: 0.115, nostrilLen: 0.15, nostrilWidth: 0.026,
        gillX: 1.56, gillY: 0.90, gillZ: 0, gills: 5, gillCenter: -0.11,
        gillHeight: 0.33, gillStep: 0.115, gillWidth: 0.060, gillAngle: 0.24,
        gillColor: 0xc3cccd,
        pores: 52, poreSize: 0.019, poreX0: 1.98, poreX1: 2.58, poreSpread: 0.95,
        poreSeed: 31, poreColor: 0x252b2f,
      });
      addSharkSkin(g, m, {
        rings: GW_RINGS, scars: 11, scarLen: 0.42, scarWidth: 0.024, scarColor: 0xa8b1b3,
        folds: 3, foldX: 1.28, foldStep: 0.17, foldSpan: 0.55, foldWidth: 0.030,
        foldColor: 0x3f4548, skinSeed: 41,
      });

      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      // FIRST DORSAL — broad triangle, rounded apex leaning back, deeply
      // concave trailing edge, paler at the base. The Jaws silhouette.
      fin([finDark, finDark, finDark, finPale], [0.35, 1.36, 0], {
        span: 1.12, chordRoot: 1.00, chordTip: 0.16, sweep: 0.60, concavity: 0.30,
        leadBow: 0.07, rearTipH: 0.09, rearTipBack: 0.34, apexRound: 0.34,
        thick: 0.14, spanSteps: 6, chordSteps: 5, paleBase: 0.18, trailPale: 0.17,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([finDark], [-1.05, 1.12, 0], {
        span: 0.30, chordRoot: 0.30, chordTip: 0.05, sweep: 0.55, concavity: 0.28,
        rearTipH: 0.10, rearTipBack: 0.13, apexRound: 0.10, thick: 0.045,
        spanSteps: 4, chordSteps: 3, spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      // PECTORALS — long, swept back ~30° in plan, drooped, dark above with a
      // dark tip and a white underside.
      [1, -1].forEach(function (s2) {
        fin([grey, white, finTip], [0.88, 0.515, s2 * 0.38], {
          span: 1.25, chordRoot: 0.66, chordTip: 0.05, sweep: 0.66, concavity: 0.24,
          leadBow: 0.06, rearTipH: 0.09, rearTipBack: 0.20, apexRound: 0.05,
          thick: 0.085, spanSteps: 6, chordSteps: 4, under: true, tipDark: 0.76,
          spanDir: [-0.497, -0.200, s2 * 0.845], chordDir: [1, 0.06, s2 * 0.16],
        });
        // PELVICS — small, swept, white underneath. A shark seen from a boat
        // has these; the old model simply did not.
        fin([grey, white], [-0.62, 0.478, s2 * 0.19], {
          span: 0.40, chordRoot: 0.34, chordTip: 0.04, sweep: 0.55, concavity: 0.22,
          rearTipH: 0.10, rearTipBack: 0.11, apexRound: 0.07, thick: 0.045,
          spanSteps: 4, chordSteps: 3, under: true,
          spanDir: [-0.160, -0.883, s2 * 0.441], chordDir: [1, 0, s2 * 0.1],
        });
        // CAUDAL KEEL — the horizontal ridge that turns a peduncle into a
        // shark's peduncle.
        fin([grey], [-1.45, 0.860, s2 * 0.145], {
          span: 0.15, chordRoot: 0.46, chordTip: 0.10, sweep: 0.12, concavity: 0.05,
          rearTipH: 0.20, rearTipBack: 0.04, apexRound: 0.50, thick: 0.05,
          spanSteps: 3, chordSteps: 3, spanDir: [0, 0, s2], chordDir: [1, 0, 0],
        });
      });
      fin([grey], [-1.05, 0.512, 0], {   // anal fin
        span: 0.26, chordRoot: 0.26, chordTip: 0.04, sweep: 0.55, concavity: 0.25,
        rearTipH: 0.10, rearTipBack: 0.11, apexRound: 0.08, thick: 0.04,
        spanSteps: 4, chordSteps: 3, spanDir: [0, -1, 0], chordDir: [1, 0, 0],
      });

      // PEDUNCLE — a tapered sleeve over the hull's tail, so the swim rig has
      // a body section to carry the wave instead of a rectangular block.
      const ped = hullMesh([grey, white], [
        { x: -0.502, y: 0.000, ry: 0.044, rz: 0.027 },
        { x: -0.28, y: 0.000, ry: 0.085, rz: 0.048 },
        { x: 0.10, y: 0.000, ry: 0.155, rz: 0.098 },
        { x: 0.46, y: 0.000, ry: 0.245, rz: 0.172 },
      ], { sides: 12, bellyCut: [-0.36, -0.34, -0.32, -0.30], ragged: 0.05, seed: 23 });
      ped.position.set(-1.88, 0.860, 0);
      g.add(ped);

      // CAUDAL FIN — tall crescent, UPPER LOBE CLEARLY LONGER (§4).
      fin([grey, white], [-2.10, 0.900, 0], {
        span: 1.30, chordRoot: 0.52, chordTip: 0.06, sweep: 0.30, concavity: 0.24,
        leadBow: 0.05, rearTipH: 0.10, rearTipBack: 0.22, apexRound: 0.05,
        thick: 0.075, spanSteps: 6, chordSteps: 4,
        spanDir: [-0.588, 0.809, 0], chordDir: [1, 0, 0],
      });
      fin([grey, white], [-2.04, 0.800, 0], {
        span: 0.72, chordRoot: 0.46, chordTip: 0.05, sweep: 0.28, concavity: 0.20,
        rearTipH: 0.10, rearTipBack: 0.16, apexRound: 0.06, thick: 0.065,
        spanSteps: 5, chordSteps: 4, under: true,
        spanDir: [-0.788, -0.616, 0], chordDir: [1, 0, 0],
      });
      return g;
    },
  });

  /* ============================================================
     MEGALODON — Otodus megalodon. The great white's grammar, scaled up and
     made heavier: girth carried far forward, a battering-ram rostrum, and a
     mouth you could park a dinghy in.
     ============================================================ */
  const MEG_RINGS = [
    { x: -2.10, y: 0.98, ry: 0.26, rz: 0.18 },
    { x: -1.35, y: 0.96, ry: 0.58, rz: 0.42 },
    { x: -0.35, y: 0.95, ry: 0.92, rz: 0.72 },
    { x: 0.60, y: 0.96, ry: 1.02, rz: 0.83 },     // max girth, forward of centre
    { x: 1.60, y: 0.99, ry: 0.95, rz: 0.80 },
    { x: 2.50, y: 1.06, ry: 0.76, rz: 0.70 },
    { x: 3.20, y: 1.16, ry: 0.55, rz: 0.60 },
    { x: 3.52, y: 1.20, ry: 0.40, rz: 0.49 },
  ];
  const MEG_SNOUT = [
    { x: 2.90, y: 1.11, ry: 0.66, rz: 0.66 },
    { x: 3.20, y: 1.16, ry: 0.55, rz: 0.60 },
    { x: 3.68, y: 1.22, ry: 0.35, rz: 0.45 },
    { x: 3.98, y: 1.24, ry: 0.19, rz: 0.31 },
  ];
  S({
    id: "megalodon", name: "Megalodon", biome: "water", rarity: "legendary",
    hp: 1200, fur: "Legendary Megalodon Tooth", furValue: 3000, respawn: false,
    packs: 1, spd: 2.4, danger: 0.8, bite: 60, aquatic: true,
    scale: 2.6, color: 0x2a3035,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const dark = m(0x2a3035), white = m(0xe6ebec);
      const finDark = m(0x232930), finTip = m(0x161a1e), finPale = m(0x474f55);
      addSharkHull(g, {
        top: dark, belly: white, sides: 16, rings: MEG_RINGS,
        bellyCut: [-0.40, -0.34, -0.24, -0.06, 0.18, 0.02, -0.18, -0.26],
        ragged: 0.08, seed: 51, profile: "battering-ram",
      });
      addSharkMouth(g, T, m, {
        hingeX: 2.30, hingeY: 0.800, length: 1.58, width: 1.10, gap: 0.56,
        toothHeight: 0.30, toothWidth: 0.245, rowTeeth: 21, cornerRise: 0.25,
        maxOpen: 1.02, skin: 0xe6ebec, upperSkin: 0x2a3035,
      });
      const snout = addSharkRostrum(g, [dark, white], MEG_SNOUT, {
        pivotX: 3.20, pivotY: 1.160, sides: 16,
        bellyCut: [-0.12, -0.20, -0.36, -0.46], ragged: 0.06, seed: 52, tuck: 0.90,
      });
      addSharkFaceDetails(g, T, m, {
        rings: MEG_RINGS, snout: snout, snoutRings: MEG_SNOUT,
        eyeX: 3.34, eyeY: 1.315, eyeZ: 0.505, eyeSize: 0.085, dark: 0x07090a,
        noseX: 3.72, noseY: 0.942, noseZ: 0.19, nostrilLen: 0.24, nostrilWidth: 0.042,
        gillX: 2.62, gillY: 1.0, gillZ: 0, gills: 5, gillCenter: -0.14,
        gillHeight: 0.60, gillStep: 0.20, gillWidth: 0.105, gillAngle: 0.22,
        gillColor: 0xb4bec1,
        pores: 60, poreSize: 0.030, poreX0: 3.05, poreX1: 3.94, poreSpread: 0.95,
        poreSeed: 33, poreColor: 0x2f363a,
      });
      addSharkSkin(g, m, {
        rings: MEG_RINGS, scars: 14, scarLen: 0.70, scarWidth: 0.036, scarColor: 0x99a3a7,
        folds: 3, foldX: 2.30, foldStep: 0.28, foldSpan: 0.90, foldWidth: 0.05,
        foldColor: 0x2f353a, skinSeed: 43,
      });
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      fin([finDark, finDark, finDark, finPale], [0.20, 1.86, 0], {
        span: 1.95, chordRoot: 1.60, chordTip: 0.24, sweep: 0.58, concavity: 0.30,
        leadBow: 0.07, rearTipH: 0.09, rearTipBack: 0.55, apexRound: 0.30,
        thick: 0.24, spanSteps: 6, chordSteps: 5, paleBase: 0.18, trailPale: 0.17,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([finDark], [-1.35, 1.48, 0], {
        span: 0.50, chordRoot: 0.50, chordTip: 0.08, sweep: 0.55, concavity: 0.28,
        rearTipBack: 0.22, apexRound: 0.10, thick: 0.08, spanSteps: 4, chordSteps: 3,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        fin([dark, white, finTip], [0.62, 0.42, s2 * 0.65], {
          span: 2.05, chordRoot: 1.10, chordTip: 0.08, sweep: 0.66, concavity: 0.24,
          leadBow: 0.06, rearTipH: 0.09, rearTipBack: 0.34, apexRound: 0.05,
          thick: 0.15, spanSteps: 6, chordSteps: 4, under: true, tipDark: 0.78,
          spanDir: [-0.497, -0.200, s2 * 0.845], chordDir: [1, 0.06, s2 * 0.16],
        });
        fin([dark, white], [-0.80, 0.38, s2 * 0.33], {
          span: 0.68, chordRoot: 0.56, chordTip: 0.06, sweep: 0.55, concavity: 0.22,
          rearTipBack: 0.18, apexRound: 0.07, thick: 0.075, spanSteps: 4, chordSteps: 3,
          under: true, spanDir: [-0.160, -0.883, s2 * 0.441], chordDir: [1, 0, s2 * 0.1],
        });
        fin([dark], [-1.80, 0.98, s2 * 0.235], {
          span: 0.24, chordRoot: 0.78, chordTip: 0.16, sweep: 0.12, concavity: 0.05,
          rearTipH: 0.20, rearTipBack: 0.06, apexRound: 0.50, thick: 0.08,
          spanSteps: 3, chordSteps: 3, spanDir: [0, 0, s2], chordDir: [1, 0, 0],
        });
      });
      fin([dark], [-1.35, 0.42, 0], {
        span: 0.44, chordRoot: 0.42, chordTip: 0.06, sweep: 0.55, concavity: 0.25,
        rearTipBack: 0.18, apexRound: 0.08, thick: 0.065, spanSteps: 4, chordSteps: 3,
        spanDir: [0, -1, 0], chordDir: [1, 0, 0],
      });
      const ped = hullMesh([dark, white], [
        { x: -0.744, y: 0, ry: 0.068, rz: 0.042 },
        { x: -0.42, y: 0, ry: 0.13, rz: 0.075 },
        { x: 0.16, y: 0, ry: 0.25, rz: 0.16 },
        { x: 0.66, y: 0, ry: 0.38, rz: 0.27 },
      ], { sides: 12, bellyCut: [-0.36, -0.34, -0.32, -0.30], ragged: 0.05, seed: 53 });
      ped.position.set(-2.46, 0.98, 0);
      g.add(ped);
      fin([dark, white], [-2.82, 1.02, 0], {
        span: 2.25, chordRoot: 0.92, chordTip: 0.10, sweep: 0.30, concavity: 0.24,
        rearTipH: 0.10, rearTipBack: 0.40, apexRound: 0.05, thick: 0.14,
        spanSteps: 6, chordSteps: 4, spanDir: [-0.588, 0.809, 0], chordDir: [1, 0, 0],
      });
      fin([dark, white], [-2.74, 0.90, 0], {
        span: 1.30, chordRoot: 0.82, chordTip: 0.08, sweep: 0.28, concavity: 0.20,
        rearTipBack: 0.28, apexRound: 0.06, thick: 0.12, spanSteps: 5, chordSteps: 4,
        under: true, spanDir: [-0.788, -0.616, 0], chordDir: [1, 0, 0],
      });
      return g;
    },
  });

  /* ============================================================
     GREAT HAMMERHEAD — Sphyrna mokarran. The cephalofoil is a HYDROFOIL, so
     it is built with the fin grammar: rounded tips, a bowed leading edge and
     a white underside, instead of a rectangular bar across the face.
     ============================================================ */
  const HH_RINGS = [
    { x: -1.50, y: 0.90, ry: 0.155, rz: 0.105 },
    { x: -0.85, y: 0.90, ry: 0.320, rz: 0.220 },
    { x: -0.10, y: 0.90, ry: 0.460, rz: 0.330 },
    { x: 0.60, y: 0.91, ry: 0.470, rz: 0.350 },
    { x: 1.20, y: 0.92, ry: 0.400, rz: 0.300 },
    { x: 1.62, y: 0.93, ry: 0.280, rz: 0.240 },
  ];
  S({
    id: "hammerhead_shark", name: "Great Hammerhead", biome: "water",
    rarity: "rare", hp: 150, fur: "Shark Fin", furValue: 300,
    meat: "Shark Meat", meatValue: 30, spd: 2.5, danger: 0.5,
    bite: 26, aquatic: true, scale: 1.25, color: 0x434c50,
    clearance: 40, swimDepth: 2.5,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const grey = m(0x434c50), pale = m(0xe9edec), finDark = m(0x363e42), eye = m(0x07090a);
      addSharkHull(g, {
        top: grey, belly: pale, sides: 14, rings: HH_RINGS,
        bellyCut: [-0.36, -0.30, -0.12, 0.12, -0.06, -0.26],
        ragged: 0.07, seed: 61, profile: "cephalofoil",
      });
      addSharkMouth(g, T, m, {
        hingeX: 1.26, hingeY: 0.688, length: 0.74, width: 0.56, gap: 0.24,
        toothHeight: 0.115, toothWidth: 0.095, rowTeeth: 17, cornerRise: 0.115,
        maxOpen: 0.94, skin: 0xe9edec, upperSkin: 0x434c50,
      });
      // THE CEPHALOFOIL: a centre block plus two rounded-tip wings.
      const head = hullMesh([grey, pale], [
        { x: -0.28, y: 0, ry: 0.245, rz: 0.215 },
        { x: 0.00, y: 0, ry: 0.180, rz: 0.255 },
        { x: 0.22, y: 0, ry: 0.155, rz: 0.235 },
      ], { sides: 12, bellyCut: [-0.20, -0.14, -0.18], ragged: 0.05, seed: 62 });
      head.position.set(1.88, 0.93, 0);
      g.add(head);
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      [1, -1].forEach(function (s2) {
        fin([grey, pale], [1.88, 0.925, s2 * 0.18], {
          span: 1.12, chordRoot: 0.58, chordTip: 0.42, sweep: 0.02, concavity: 0.02,
          leadBow: 0.10, rearTipH: 0.50, rearTipBack: 0.02, apexRound: 0.34,
          thick: 0.24, spanSteps: 5, chordSteps: 4, under: true,
          spanDir: [0, 0, s2], chordDir: [1, 0, 0],
        });
        const e = new T.Mesh(cachedGeom("eye|0.105", function () {
          return new T.SphereGeometry(0.105, 8, 6);
        }), eye);
        e.name = "sharkEye"; e.position.set(1.90, 0.925, s2 * 1.27); g.add(e);
      });
      addSharkFaceDetails(g, T, m, {
        rings: HH_RINGS, eyeSize: 0, eyeX: 0, eyeY: 0, eyeZ: 0, dark: 0x0d1114,
        noseX: 2.02, noseY: 0.898, noseZ: 0.90, nostrilLen: 0.20, nostrilWidth: 0.028,
        nostrilYaw: 0.05,
        gillX: 1.30, gillY: 0.92, gillZ: 0, gills: 5, gillCenter: -0.14,
        gillHeight: 0.26, gillStep: 0.10, gillWidth: 0.052, gillAngle: 0.22,
        gillColor: 0xc6cfcf, pores: 0,
      });
      addSharkSkin(g, m, {
        rings: HH_RINGS, scars: 8, scarLen: 0.34, scarWidth: 0.02, scarColor: 0xa9b2b4,
        folds: 2, foldX: 1.05, foldStep: 0.15, foldSpan: 0.42, foldWidth: 0.026,
        foldColor: 0x4a5356, skinSeed: 63,
      });
      // the scythe dorsal — taller and thinner than a great white's
      fin([finDark, finDark, finDark, m(0x8d979b)], [0.20, 1.28, 0], {
        span: 1.55, chordRoot: 0.70, chordTip: 0.09, sweep: 0.42, concavity: 0.34,
        leadBow: 0.05, rearTipH: 0.08, rearTipBack: 0.28, apexRound: 0.10,
        thick: 0.11, spanSteps: 6, chordSteps: 5, paleBase: 0.16, trailPale: 0.18,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([finDark], [-0.95, 1.16, 0], {
        span: 0.30, chordRoot: 0.28, chordTip: 0.04, sweep: 0.55, concavity: 0.28,
        rearTipBack: 0.12, apexRound: 0.10, thick: 0.04, spanSteps: 4, chordSteps: 3,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        fin([grey, pale], [0.62, 0.560, s2 * 0.28], {
          span: 1.05, chordRoot: 0.50, chordTip: 0.04, sweep: 0.68, concavity: 0.24,
          rearTipH: 0.09, rearTipBack: 0.17, apexRound: 0.05, thick: 0.06,
          spanSteps: 5, chordSteps: 4, under: true,
          spanDir: [-0.497, -0.200, s2 * 0.845], chordDir: [1, 0.06, s2 * 0.16],
        });
        fin([grey, pale], [-0.55, 0.520, s2 * 0.16], {
          span: 0.32, chordRoot: 0.28, chordTip: 0.04, sweep: 0.55, concavity: 0.22,
          rearTipBack: 0.10, apexRound: 0.07, thick: 0.04, spanSteps: 4, chordSteps: 3,
          under: true, spanDir: [-0.160, -0.883, s2 * 0.441], chordDir: [1, 0, s2 * 0.1],
        });
        fin([grey], [-1.32, 0.900, s2 * 0.12], {
          span: 0.12, chordRoot: 0.36, chordTip: 0.08, sweep: 0.12, concavity: 0.05,
          rearTipH: 0.20, rearTipBack: 0.03, apexRound: 0.50, thick: 0.04,
          spanSteps: 3, chordSteps: 3, spanDir: [0, 0, s2], chordDir: [1, 0, 0],
        });
      });
      fin([grey], [-0.95, 0.560, 0], {
        span: 0.24, chordRoot: 0.24, chordTip: 0.03, sweep: 0.55, concavity: 0.25,
        rearTipBack: 0.10, apexRound: 0.08, thick: 0.035, spanSteps: 4, chordSteps: 3,
        spanDir: [0, -1, 0], chordDir: [1, 0, 0],
      });
      const ped = hullMesh([grey, pale], [
        { x: -0.464, y: 0, ry: 0.039, rz: 0.024 },
        { x: -0.26, y: 0, ry: 0.075, rz: 0.042 },
        { x: 0.10, y: 0, ry: 0.140, rz: 0.090 },
        { x: 0.42, y: 0, ry: 0.215, rz: 0.150 },
      ], { sides: 12, bellyCut: [-0.36, -0.34, -0.32, -0.30], ragged: 0.05, seed: 64 });
      ped.position.set(-1.76, 0.90, 0);
      g.add(ped);
      fin([grey, pale], [-1.98, 0.94, 0], {
        span: 1.42, chordRoot: 0.46, chordTip: 0.05, sweep: 0.32, concavity: 0.26,
        rearTipH: 0.10, rearTipBack: 0.20, apexRound: 0.05, thick: 0.07,
        spanSteps: 6, chordSteps: 4, spanDir: [-0.616, 0.788, 0], chordDir: [1, 0, 0],
      });
      fin([grey, pale], [-1.92, 0.84, 0], {
        span: 0.62, chordRoot: 0.38, chordTip: 0.04, sweep: 0.28, concavity: 0.20,
        rearTipBack: 0.14, apexRound: 0.06, thick: 0.055, spanSteps: 5, chordSteps: 4,
        under: true, spanDir: [-0.788, -0.616, 0], chordDir: [1, 0, 0],
      });
      return g;
    },
  });

  /* ============================================================
     BULL SHARK — Carcharhinus leucas. Stocky, thick, and the one that comes
     into the surf (clearance 12), so it is the shark the player actually
     MEETS. Same grammar, blunter everything.
     ============================================================ */
  const BULL_RINGS = [
    { x: -1.32, y: 0.88, ry: 0.180, rz: 0.130 },
    { x: -0.75, y: 0.87, ry: 0.400, rz: 0.310 },
    { x: -0.05, y: 0.88, ry: 0.580, rz: 0.470 },
    { x: 0.60, y: 0.89, ry: 0.600, rz: 0.500 },
    { x: 1.20, y: 0.92, ry: 0.520, rz: 0.460 },
    { x: 1.66, y: 0.98, ry: 0.360, rz: 0.380 },
    { x: 1.84, y: 1.00, ry: 0.270, rz: 0.318 },
  ];
  const BULL_SNOUT = [
    { x: 1.44, y: 0.955, ry: 0.430, rz: 0.420 },
    { x: 1.66, y: 0.980, ry: 0.360, rz: 0.380 },
    { x: 1.96, y: 1.020, ry: 0.250, rz: 0.310 },
    { x: 2.16, y: 1.025, ry: 0.150, rz: 0.225 },
  ];
  S({
    id: "bull_shark", name: "Bull Shark", biome: "water",
    rarity: "uncommon", hp: 110, fur: "Shark Fin", furValue: 190,
    meat: "Shark Meat", meatValue: 24, spd: 2.7, danger: 0.55,
    bite: 24, aquatic: true, scale: 0.95, color: 0x464e52,
    clearance: 12, swimDepth: 1.5,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const grey = m(0x464e52), white = m(0xf0f2f2), finDark = m(0x394045), finTip = m(0x252b2f);
      addSharkHull(g, {
        top: grey, belly: white, sides: 14, rings: BULL_RINGS,
        bellyCut: [-0.36, -0.30, -0.14, 0.14, -0.02, -0.22, -0.30],
        ragged: 0.075, seed: 71, profile: "stocky-blunt",
      });
      addSharkMouth(g, T, m, {
        hingeX: 1.36, hingeY: 0.716, length: 0.78, width: 0.56, gap: 0.28,
        toothHeight: 0.135, toothWidth: 0.108, rowTeeth: 17, cornerRise: 0.12,
        maxOpen: 1.00, skin: 0xf0f2f2, upperSkin: 0x464e52,
      });
      const snout = addSharkRostrum(g, [grey, white], BULL_SNOUT, {
        pivotX: 1.66, pivotY: 0.980, sides: 14,
        bellyCut: [-0.14, -0.20, -0.36, -0.46], ragged: 0.055, seed: 72, tuck: 0.90,
      });
      addSharkFaceDetails(g, T, m, {
        rings: BULL_RINGS, snout: snout, snoutRings: BULL_SNOUT,
        eyeX: 1.80, eyeY: 1.150, eyeZ: 0.260, eyeSize: 0.048, dark: 0x07090a,
        noseX: 1.98, noseY: 0.806, noseZ: 0.105, nostrilLen: 0.13, nostrilWidth: 0.024,
        gillX: 1.28, gillY: 0.90, gillZ: 0, gills: 5, gillCenter: -0.14,
        gillHeight: 0.29, gillStep: 0.10, gillWidth: 0.055, gillAngle: 0.22,
        gillColor: 0xc3cccd,
        pores: 40, poreSize: 0.017, poreX0: 1.70, poreX1: 2.12, poreSpread: 0.95,
        poreSeed: 34, poreColor: 0x424a4e,
      });
      addSharkSkin(g, m, {
        rings: BULL_RINGS, scars: 9, scarLen: 0.34, scarWidth: 0.022, scarColor: 0xaeb6b8,
        folds: 3, foldX: 1.06, foldStep: 0.14, foldSpan: 0.45, foldWidth: 0.026,
        foldColor: 0x4f585c, skinSeed: 73,
      });
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      fin([finDark, finDark, finDark, m(0x5f686c)], [0.25, 1.32, 0], {
        span: 0.98, chordRoot: 0.92, chordTip: 0.14, sweep: 0.60, concavity: 0.30,
        leadBow: 0.07, rearTipH: 0.09, rearTipBack: 0.30, apexRound: 0.30,
        thick: 0.12, spanSteps: 6, chordSteps: 5, paleBase: 0.18, trailPale: 0.17,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([finDark], [-0.85, 1.14, 0], {
        span: 0.26, chordRoot: 0.26, chordTip: 0.04, sweep: 0.55, concavity: 0.28,
        rearTipBack: 0.11, apexRound: 0.10, thick: 0.04, spanSteps: 4, chordSteps: 3,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        fin([grey, white, finTip], [0.64, 0.520, s2 * 0.39], {
          span: 1.02, chordRoot: 0.58, chordTip: 0.05, sweep: 0.66, concavity: 0.24,
          rearTipH: 0.09, rearTipBack: 0.18, apexRound: 0.05, thick: 0.075,
          spanSteps: 6, chordSteps: 4, under: true, tipDark: 0.78,
          spanDir: [-0.497, -0.200, s2 * 0.845], chordDir: [1, 0.06, s2 * 0.16],
        });
        fin([grey, white], [-0.52, 0.470, s2 * 0.20], {
          span: 0.36, chordRoot: 0.32, chordTip: 0.04, sweep: 0.55, concavity: 0.22,
          rearTipBack: 0.10, apexRound: 0.07, thick: 0.042, spanSteps: 4, chordSteps: 3,
          under: true, spanDir: [-0.160, -0.883, s2 * 0.441], chordDir: [1, 0, s2 * 0.1],
        });
        fin([grey], [-1.18, 0.880, s2 * 0.15], {
          span: 0.13, chordRoot: 0.40, chordTip: 0.09, sweep: 0.12, concavity: 0.05,
          rearTipH: 0.20, rearTipBack: 0.04, apexRound: 0.50, thick: 0.045,
          spanSteps: 3, chordSteps: 3, spanDir: [0, 0, s2], chordDir: [1, 0, 0],
        });
      });
      fin([grey], [-0.85, 0.500, 0], {
        span: 0.24, chordRoot: 0.24, chordTip: 0.03, sweep: 0.55, concavity: 0.25,
        rearTipBack: 0.10, apexRound: 0.08, thick: 0.035, spanSteps: 4, chordSteps: 3,
        spanDir: [0, -1, 0], chordDir: [1, 0, 0],
      });
      const ped = hullMesh([grey, white], [
        { x: -0.432, y: 0, ry: 0.044, rz: 0.027 },
        { x: -0.24, y: 0, ry: 0.085, rz: 0.048 },
        { x: 0.10, y: 0, ry: 0.150, rz: 0.098 },
        { x: 0.40, y: 0, ry: 0.240, rz: 0.170 },
      ], { sides: 12, bellyCut: [-0.36, -0.34, -0.32, -0.30], ragged: 0.05, seed: 74 });
      ped.position.set(-1.58, 0.88, 0);
      g.add(ped);
      fin([grey, white], [-1.78, 0.92, 0], {
        span: 1.06, chordRoot: 0.46, chordTip: 0.05, sweep: 0.30, concavity: 0.24,
        rearTipH: 0.10, rearTipBack: 0.19, apexRound: 0.05, thick: 0.065,
        spanSteps: 6, chordSteps: 4, spanDir: [-0.588, 0.809, 0], chordDir: [1, 0, 0],
      });
      fin([grey, white], [-1.72, 0.82, 0], {
        span: 0.60, chordRoot: 0.40, chordTip: 0.04, sweep: 0.28, concavity: 0.20,
        rearTipBack: 0.14, apexRound: 0.06, thick: 0.055, spanSteps: 5, chordSteps: 4,
        under: true, spanDir: [-0.788, -0.616, 0], chordDir: [1, 0, 0],
      });
      return g;
    },
  });

  /* ==========================================================================
     THE BONY FISH.

     Every one of these used to be a stack of three flat boxes with cone fins
     glued on. They are now the same profiled hull + the same blade grammar as
     the sharks: countershaded in one connected mesh, with a proper dorsal,
     paired pectorals and pelvics, an anal fin and a real FORKED caudal —
     because a fish seen beside a boat is mostly fin.

     Markings (mackerel bars, marlin stripes, barracuda blotches) are PAINTED
     INTO the hull as an extra material group, which costs one draw call and
     zero extra geometry — the old bars were separate boxes punched through
     the body.
     ========================================================================== */

  // ---- MACKEREL — Scomber scombrus. Iridescent green-blue back, silver
  //      flank, wavy dark bars, deeply forked tail.
  S({
    id: "fish", name: "Mackerel", biome: "water", rarity: "common",
    hp: 5, fur: "Fresh Fish", furValue: 8, meat: "Fish Fillet", meatValue: 5,
    herd: [10, 20], packs: 4, spd: 2.0, danger: 0, aquatic: true,
    scale: 0.5, color: 0x6a8fa8,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const back = m(0x2b6a63), belly = m(0xdde5e7), bar = m(0x143039);
      const rings = bodyRings(-0.86, 1.22, 0.50,
        [0.05, 0.19, 0.27, 0.27, 0.24, 0.17, 0.09],
        [0.035, 0.115, 0.175, 0.175, 0.145, 0.105, 0.055], 12);
      const hull = hullMesh([back, belly, bar], rings, {
        sides: 12, bellyCut: [-0.30, -0.22, -0.18, -0.20, -0.28, -0.40], ragged: 0.10, seed: 81,
        paintKey: "mackerel-bars",
        paint: function (i, u, j, s, isBelly) {
          if (isBelly || s < 0.06) return -1;
          const wob = h01(j * 5 + 1, 0, 91) > 0.55 ? 1 : 0;
          return ((i + wob) % 3) === 0 ? 2 : -1;
        },
      });
      hull.name = "fishHull"; g.add(hull);
      [0.085, -0.085].forEach(function (z) {
        const e = new T.Mesh(cachedGeom("eye|0.038", function () {
          return new T.SphereGeometry(0.038, 6, 5);
        }), m(0x0d1114));
        e.name = "fishEye";
        e.position.set(1.03, 0.545, z); e.scale.set(0.85, 1, 0.7); g.add(e);
      });
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      fin([back], [0.30, 0.72, 0], {
        span: 0.24, chordRoot: 0.26, chordTip: 0.03, sweep: 0.42, concavity: 0.22,
        rearTipBack: 0.10, apexRound: 0.08, thick: 0.03, spanSteps: 4, chordSteps: 3,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([back], [-0.26, 0.68, 0], {
        span: 0.14, chordRoot: 0.18, chordTip: 0.02, sweep: 0.40, concavity: 0.20,
        rearTipBack: 0.06, apexRound: 0.08, thick: 0.02, spanSteps: 3, chordSteps: 3,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([back], [-0.30, 0.32, 0], {
        span: 0.13, chordRoot: 0.16, chordTip: 0.02, sweep: 0.40, concavity: 0.20,
        rearTipBack: 0.06, apexRound: 0.08, thick: 0.02, spanSteps: 3, chordSteps: 3,
        spanDir: [0, -1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        fin([back, belly], [0.42, 0.44, s2 * 0.13], {
          span: 0.30, chordRoot: 0.18, chordTip: 0.02, sweep: 0.55, concavity: 0.22,
          rearTipBack: 0.06, apexRound: 0.06, thick: 0.02, spanSteps: 4, chordSteps: 3,
          under: true, spanDir: [-0.45, -0.30, s2 * 0.84], chordDir: [1, 0, s2 * 0.1],
        });
        fin([belly], [0.08, 0.30, s2 * 0.07], {
          span: 0.16, chordRoot: 0.13, chordTip: 0.02, sweep: 0.5, concavity: 0.2,
          rearTipBack: 0.05, apexRound: 0.06, thick: 0.016, spanSteps: 3, chordSteps: 3,
          spanDir: [-0.2, -0.86, s2 * 0.47], chordDir: [1, 0, 0],
        });
      });
      const ped = hullMesh([back, belly], bodyRings(-0.472, 0.1, 0,
        [0.015, 0.03, 0.075], [0.0108, 0.02, 0.048], 4),
        { sides: 10, bellyCut: [-0.28], ragged: 0.04, seed: 82 });
      ped.position.set(-0.92, 0.50, 0); g.add(ped);
      [1, -1].forEach(function (s2) {
        fin([back, belly], [-1.22, 0.50 + s2 * 0.02, 0], {
          span: 0.44, chordRoot: 0.20, chordTip: 0.03, sweep: 0.42, concavity: 0.30,
          rearTipBack: 0.07, apexRound: 0.05, thick: 0.024, spanSteps: 5, chordSteps: 3,
          under: true, spanDir: [-0.56, s2 * 0.83, 0], chordDir: [1, 0, 0],
        });
      });
      return g;
    },
  });

  /* ==========================================================================
     THE OCEAN IS NOT FIVE FISH.

     OWNER: "make water absolutely massive and make fish and potential predator
     like shark spawn in like npc in that water".

     A SPECIES IS A ROW. `clearance` is how far offshore this animal needs to
     be and `swimDepth` is how far the model origin rides below the surface;
     both are declared here rather than hard-coded name tables in wildlife.js,
     which is the whole reason the sea reads as a place with regions in it.
     ========================================================================== */

  // ---- SARDINE — the bait ball. Sixty at a time, so it stays deliberately
  //      cheap: ten-sided hull, five blades, every geometry shared.
  S({
    id: "sardine", name: "Sardine", biome: "water", rarity: "common",
    hp: 3, fur: "Fresh Fish", furValue: 4, meat: "Fish Fillet", meatValue: 3,
    herd: [26, 60], spd: 2.3, danger: 0, aquatic: true,
    scale: 0.34, color: 0x9fb4c2, clearance: 14, swimDepth: 0.55,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const back = m(0x24565f), silver = m(0xeaf0f2);
      const rings = bodyRings(-0.62, 0.82, 0.40,
        [0.035, 0.13, 0.18, 0.17, 0.12, 0.06],
        [0.025, 0.075, 0.105, 0.10, 0.07, 0.035], 8);
      const hull = hullMesh([back, silver], rings,
        { sides: 10, bellyCut: [-0.24, -0.14, -0.16, -0.30], ragged: 0.10, seed: 83 });
      hull.name = "fishHull"; g.add(hull);
      [0.055, -0.055].forEach(function (z) {
        const e = new T.Mesh(cachedGeom("eye|0.026", function () {
          return new T.SphereGeometry(0.026, 6, 4);
        }), m(0x0e1216));
        e.name = "fishEye";
        e.position.set(0.68, 0.425, z); e.scale.set(0.85, 1, 0.7); g.add(e);
      });
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      fin([back], [0.10, 0.55, 0], {
        span: 0.15, chordRoot: 0.17, chordTip: 0.02, sweep: 0.40, concavity: 0.22,
        rearTipBack: 0.06, apexRound: 0.08, thick: 0.018, spanSteps: 3, chordSteps: 3,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([silver], [-0.18, 0.28, 0], {
        span: 0.10, chordRoot: 0.12, chordTip: 0.02, sweep: 0.40, concavity: 0.20,
        rearTipBack: 0.04, apexRound: 0.08, thick: 0.014, spanSteps: 3, chordSteps: 3,
        spanDir: [0, -1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        fin([silver], [0.26, 0.36, s2 * 0.07], {
          span: 0.18, chordRoot: 0.11, chordTip: 0.02, sweep: 0.55, concavity: 0.2,
          rearTipBack: 0.04, apexRound: 0.06, thick: 0.012, spanSteps: 3, chordSteps: 3,
          spanDir: [-0.45, -0.30, s2 * 0.84], chordDir: [1, 0, 0],
        });
      });
      const ped = hullMesh([back, silver], bodyRings(-0.33, 0.06, 0,
        [0.01, 0.02, 0.05], [0.0076, 0.014, 0.03], 4),
        { sides: 8, bellyCut: [-0.24], ragged: 0.04, seed: 84 });
      ped.position.set(-0.66, 0.40, 0); g.add(ped);
      [1, -1].forEach(function (s2) {
        fin([back, silver], [-0.86, 0.40 + s2 * 0.01, 0], {
          span: 0.30, chordRoot: 0.13, chordTip: 0.02, sweep: 0.42, concavity: 0.30,
          rearTipBack: 0.05, apexRound: 0.05, thick: 0.015, spanSteps: 4, chordSteps: 3,
          spanDir: [-0.56, s2 * 0.83, 0], chordDir: [1, 0, 0],
        });
      });
      return g;
    },
  });

  // ---- ATLANTIC BLUEFIN TUNA — a steel torpedo. Rigid crescent tail on a
  //      keeled peduncle, the yellow finlet row, long sickle pectorals.
  S({
    id: "tuna", name: "Bluefin Tuna", biome: "water", rarity: "uncommon",
    hp: 55, fur: "Fresh Fish", furValue: 90, meat: "Fish Fillet", meatValue: 26,
    herd: [3, 9], spd: 4.2, danger: 0, aquatic: true,
    scale: 0.85, color: 0x35506b, clearance: 90, swimDepth: 1.5,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const back = m(0x24364d), silver = m(0xc3ceD6), belly = m(0xeff3f5);
      const finlet = m(0xd8b436), eye = m(0x0d1116);
      const rings = bodyRings(-1.30, 1.72, 0.78,
        [0.10, 0.36, 0.50, 0.52, 0.46, 0.34, 0.16],
        [0.07, 0.26, 0.38, 0.39, 0.34, 0.25, 0.11], 12);
      const hull = hullMesh([back, belly, silver], rings, {
        sides: 14, bellyCut: [-0.40, -0.28, -0.18, -0.22, -0.34, -0.48], ragged: 0.07, seed: 85,
        paintKey: "tuna-flank",
        paint: function (i, u, j, s, isBelly) {
          return (!isBelly && s < 0.10 && s > -0.42) ? 2 : -1;   // silver flank band
        },
      });
      hull.name = "fishHull"; g.add(hull);
      [0.26, -0.26].forEach(function (z) {
        const e = new T.Mesh(cachedGeom("eye|0.075", function () {
          return new T.SphereGeometry(0.075, 8, 6);
        }), eye);
        e.position.set(1.28, 0.90, z); e.scale.set(0.8, 1, 0.55); g.add(e);
      });
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      fin([back], [0.34, 1.20, 0], {          // tall spiny first dorsal
        span: 0.60, chordRoot: 0.50, chordTip: 0.05, sweep: 0.50, concavity: 0.26,
        rearTipBack: 0.18, apexRound: 0.08, thick: 0.05, spanSteps: 5, chordSteps: 4,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([back], [-0.34, 1.06, 0], {         // low soft second dorsal
        span: 0.30, chordRoot: 0.30, chordTip: 0.03, sweep: 0.55, concavity: 0.28,
        rearTipBack: 0.12, apexRound: 0.07, thick: 0.035, spanSteps: 4, chordSteps: 3,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([belly], [-0.34, 0.50, 0], {
        span: 0.28, chordRoot: 0.28, chordTip: 0.03, sweep: 0.55, concavity: 0.28,
        rearTipBack: 0.11, apexRound: 0.07, thick: 0.033, spanSteps: 4, chordSteps: 3,
        spanDir: [0, -1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        fin([back, belly], [0.72, 0.66, s2 * 0.30], {   // long sickle pectoral
          span: 0.98, chordRoot: 0.30, chordTip: 0.03, sweep: 0.72, concavity: 0.30,
          rearTipBack: 0.10, apexRound: 0.04, thick: 0.04, spanSteps: 5, chordSteps: 3,
          under: true, spanDir: [-0.52, -0.24, s2 * 0.82], chordDir: [1, 0, s2 * 0.1],
        });
        fin([belly], [0.24, 0.44, s2 * 0.16], {
          span: 0.34, chordRoot: 0.20, chordTip: 0.02, sweep: 0.55, concavity: 0.22,
          rearTipBack: 0.07, apexRound: 0.05, thick: 0.024, spanSteps: 4, chordSteps: 3,
          spanDir: [-0.2, -0.86, s2 * 0.47], chordDir: [1, 0, 0],
        });
      });
      // THE FINLET ROW — the one detail that says "tuna" and nothing else.
      // Merged: ten of them for one draw call.
      const finlets = meshOf(cachedGeom("tuna-finlets", function () {
        const sh = new Shell();
        for (let i = 0; i < 5; i++) {
          const x = -0.62 - i * 0.145;
          const r = ringAt(rings, x);
          for (let sgn = -1; sgn <= 1; sgn += 2) {
            const y = r.y + sgn * r.ry * 0.94;
            sh.plate(0, [x, y + sgn * 0.045, 0.0022], [1, 0, 0], [0, sgn, 0], 0.075, 0.09, [0, 0, 1]);
            sh.plate(0, [x, y + sgn * 0.045, -0.0022], [1, 0, 0], [0, sgn, 0], 0.075, 0.09, [0, 0, -1]);
          }
        }
        return sh.geom();
      }), [finlet]);
      g.add(finlets);
      const ped = hullMesh([back, belly], bodyRings(-0.588, 0.14, 0,
        [0.0275, 0.055, 0.135], [0.0162, 0.03, 0.085], 4),
        { sides: 10, bellyCut: [-0.30], ragged: 0.04, seed: 86 });
      ped.position.set(-1.42, 0.78, 0); g.add(ped);
      [1, -1].forEach(function (s2) {
        fin([back], [-1.30, 0.78, s2 * 0.09], {   // the peduncle keel
          span: 0.10, chordRoot: 0.30, chordTip: 0.06, sweep: 0.1, concavity: 0.04,
          rearTipH: 0.2, rearTipBack: 0.03, apexRound: 0.5, thick: 0.025,
          spanSteps: 3, chordSteps: 3, spanDir: [0, 0, s2], chordDir: [1, 0, 0],
        });
        fin([back, belly], [-1.80, 0.78 + s2 * 0.03, 0], {   // rigid crescent
          span: 0.92, chordRoot: 0.34, chordTip: 0.04, sweep: 0.60, concavity: 0.34,
          rearTipBack: 0.10, apexRound: 0.04, thick: 0.05, spanSteps: 5, chordSteps: 3,
          under: true, spanDir: [-0.62, s2 * 0.78, 0], chordDir: [1, 0, 0],
        });
      });
      return g;
    },
  });

  // ---- BLUE MARLIN — the trophy. A long SPEAR bill, a sail-like front
  //      dorsal, cobalt stripes painted into the flank, a huge stiff crescent.
  S({
    id: "marlin", name: "Blue Marlin", biome: "water", rarity: "rare",
    hp: 130, fur: "Marlin Bill", furValue: 420, meat: "Fish Fillet", meatValue: 34,
    packs: 1, spd: 4.6, danger: 0.15, aquatic: true,
    scale: 1.05, color: 0x1c3f6d, clearance: 150, swimDepth: 1.9,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const back = m(0x14315f), belly = m(0xe9eef1), stripe = m(0x2f6fc4), eye = m(0x0a0d11);
      const rings = bodyRings(-1.60, 1.86, 0.88,
        [0.11, 0.42, 0.56, 0.56, 0.48, 0.36, 0.17],
        [0.07, 0.24, 0.33, 0.33, 0.29, 0.22, 0.10], 13);
      const hull = hullMesh([back, belly, stripe], rings, {
        sides: 14, bellyCut: [-0.44, -0.30, -0.22, -0.24, -0.36, -0.50], ragged: 0.06, seed: 87,
        paintKey: "marlin-stripes",
        paint: function (i, u, j, s, isBelly) {
          if (isBelly || s < -0.30) return -1;
          return (i % 2) === 1 && (j % 6) < 4 ? 2 : -1;
        },
      });
      hull.name = "fishHull"; g.add(hull);
      // THE BILL — long, round, and the whole silhouette
      const bill = new T.Mesh(cachedGeom("marlin-bill", function () {
        return new T.CylinderGeometry(0.04, 0.12, 1.30, 8);
      }), back);
      bill.position.set(2.48, 1.00, 0); bill.rotation.z = -Math.PI / 2; g.add(bill);
      [0.20, -0.20].forEach(function (z) {
        const e = new T.Mesh(cachedGeom("eye|0.085", function () {
          return new T.SphereGeometry(0.085, 8, 6);
        }), eye);
        e.position.set(1.66, 1.06, z); e.scale.set(0.8, 1, 0.6); g.add(e);
      });
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      // THE SAIL — tall at the front, falling away into a ridge
      fin([back], [0.92, 1.30, 0], {
        span: 0.95, chordRoot: 0.80, chordTip: 0.08, sweep: 0.34, concavity: 0.28,
        leadBow: 0.10, rearTipH: 0.06, rearTipBack: 0.42, apexRound: 0.22,
        thick: 0.06, spanSteps: 5, chordSteps: 4, spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([back], [-0.42, 1.20, 0], {
        span: 0.24, chordRoot: 0.30, chordTip: 0.03, sweep: 0.55, concavity: 0.26,
        rearTipBack: 0.12, apexRound: 0.08, thick: 0.03, spanSteps: 4, chordSteps: 3,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([belly], [-0.42, 0.56, 0], {
        span: 0.24, chordRoot: 0.28, chordTip: 0.03, sweep: 0.55, concavity: 0.26,
        rearTipBack: 0.11, apexRound: 0.08, thick: 0.03, spanSteps: 4, chordSteps: 3,
        spanDir: [0, -1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        fin([back, belly], [0.92, 0.70, s2 * 0.26], {
          span: 1.14, chordRoot: 0.30, chordTip: 0.03, sweep: 0.72, concavity: 0.32,
          rearTipBack: 0.10, apexRound: 0.04, thick: 0.04, spanSteps: 5, chordSteps: 3,
          under: true, spanDir: [-0.55, -0.30, s2 * 0.78], chordDir: [1, 0, s2 * 0.1],
        });
        fin([back], [0.34, 0.50, s2 * 0.10], {   // the long ribbon pelvics
          span: 0.52, chordRoot: 0.11, chordTip: 0.02, sweep: 0.40, concavity: 0.14,
          rearTipBack: 0.04, apexRound: 0.04, thick: 0.02, spanSteps: 4, chordSteps: 2,
          spanDir: [-0.25, -0.92, s2 * 0.30], chordDir: [1, 0, 0],
        });
      });
      const ped = hullMesh([back, belly], bodyRings(-0.646, 0.16, 0,
        [0.0275, 0.055, 0.15], [0.0162, 0.03, 0.085], 4),
        { sides: 10, bellyCut: [-0.32], ragged: 0.04, seed: 88 });
      ped.position.set(-1.74, 0.88, 0); g.add(ped);
      [1, -1].forEach(function (s2) {
        fin([back, belly], [-2.12, 0.88 + s2 * 0.03, 0], {
          span: 1.16, chordRoot: 0.40, chordTip: 0.05, sweep: 0.58, concavity: 0.34,
          rearTipBack: 0.12, apexRound: 0.04, thick: 0.06, spanSteps: 5, chordSteps: 3,
          under: true, spanDir: [-0.60, s2 * 0.80, 0], chordDir: [1, 0, 0],
        });
      });
      return g;
    },
  });

  // ---- GREAT BARRACUDA — a silver pike with an underslung jaw full of fangs,
  //      dark blotches down the lower flank, two widely SEPARATED dorsals.
  S({
    id: "barracuda", name: "Great Barracuda", biome: "water",
    rarity: "common", hp: 34, fur: "Fresh Fish", furValue: 46,
    meat: "Fish Fillet", meatValue: 14, herd: [1, 4], spd: 3.1, danger: 0.3,
    bite: 10, aquatic: true, scale: 0.6, color: 0xa9b6bd,
    clearance: 26, swimDepth: 1.2,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const back = m(0x46565f), silver = m(0xb6c2c8), belly = m(0xf1f4f5);
      const blotch = m(0x27313a), tooth = m(0xf6f7f6), eye = m(0x0d1014);
      const rings = bodyRings(-1.24, 1.42, 0.55,
        [0.07, 0.22, 0.28, 0.28, 0.26, 0.22, 0.13],
        [0.05, 0.15, 0.20, 0.20, 0.19, 0.16, 0.09], 12);
      const hull = hullMesh([silver, belly, blotch], rings, {
        sides: 12, bellyCut: [-0.34, -0.26, -0.22, -0.26, -0.36], ragged: 0.09, seed: 89,
        paintKey: "cuda-blotch",
        paint: function (i, u, j, s, isBelly) {
          if (isBelly || s > -0.05 || s < -0.55) return -1;
          return h01(i * 3 + 1, j * 7 + 2, 93) > 0.62 ? 2 : -1;
        },
      });
      hull.name = "fishHull"; g.add(hull);
      // the pike head: a dark back cap, then an UNDERSLUNG jaw
      const upper = hullMesh([back, silver], bodyRings(-0.18, 0.34, 0,
        [0.075, 0.045], [0.085, 0.045], 3), { sides: 10, bellyCut: [-0.55], seed: 90 });
      upper.position.set(1.56, 0.615, 0); g.add(upper);
      const lower = hullMesh([silver, belly], bodyRings(-0.18, 0.40, 0,
        [0.070, 0.042], [0.080, 0.042], 3), { sides: 10, bellyCut: [-0.10], seed: 91 });
      lower.position.set(1.60, 0.470, 0); g.add(lower);
      // the fang set: twelve teeth in ONE mesh, through the same tooth builder
      // the sharks use, so a barracuda's underslung grin is not twelve cones.
      const fangs = meshOf(cachedGeom("cuda-fangs", function () {
        const sh = new Shell();
        [0.06, -0.08, -0.22].forEach(function (dx, i) {
          [0.045, -0.045].forEach(function (z) {
            emitTooth(sh, [1.78 + dx, 0.560, z], [0, 0, 1], [0, -1, 0],
              { w: 0.055, h: 0.115 - i * 0.015, thick: 0.016, serr: 0, curve: 0.35, rootFrac: 0.25 });
            emitTooth(sh, [1.82 + dx, 0.505, z], [0, 0, 1], [0, 1, 0],
              { w: 0.05, h: 0.10 - i * 0.012, thick: 0.015, serr: 0, curve: 0.35, rootFrac: 0.25 });
          });
        });
        return sh.geom();
      }), [tooth, tooth]);
      g.add(fangs);
      [0.115, -0.115].forEach(function (z) {
        const e = new T.Mesh(cachedGeom("eye|0.055", function () {
          return new T.SphereGeometry(0.055, 7, 5);
        }), eye);
        e.position.set(1.42, 0.655, z); g.add(e);
      });
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      fin([back], [0.42, 0.78, 0], {
        span: 0.30, chordRoot: 0.24, chordTip: 0.03, sweep: 0.42, concavity: 0.24,
        rearTipBack: 0.10, apexRound: 0.07, thick: 0.026, spanSteps: 4, chordSteps: 3,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([back], [-0.62, 0.76, 0], {
        span: 0.26, chordRoot: 0.22, chordTip: 0.03, sweep: 0.48, concavity: 0.26,
        rearTipBack: 0.09, apexRound: 0.07, thick: 0.024, spanSteps: 4, chordSteps: 3,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([belly], [-0.62, 0.34, 0], {
        span: 0.24, chordRoot: 0.22, chordTip: 0.03, sweep: 0.48, concavity: 0.26,
        rearTipBack: 0.09, apexRound: 0.07, thick: 0.024, spanSteps: 4, chordSteps: 3,
        spanDir: [0, -1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        fin([silver, belly], [0.72, 0.46, s2 * 0.15], {
          span: 0.38, chordRoot: 0.18, chordTip: 0.02, sweep: 0.60, concavity: 0.24,
          rearTipBack: 0.07, apexRound: 0.05, thick: 0.022, spanSteps: 4, chordSteps: 3,
          under: true, spanDir: [-0.48, -0.28, s2 * 0.83], chordDir: [1, 0, 0],
        });
        fin([belly], [0.30, 0.38, s2 * 0.09], {
          span: 0.22, chordRoot: 0.15, chordTip: 0.02, sweep: 0.5, concavity: 0.2,
          rearTipBack: 0.05, apexRound: 0.05, thick: 0.018, spanSteps: 3, chordSteps: 3,
          spanDir: [-0.2, -0.88, s2 * 0.43], chordDir: [1, 0, 0],
        });
      });
      const ped = hullMesh([silver, belly], bodyRings(-0.472, 0.1, 0,
        [0.0175, 0.035, 0.085], [0.013, 0.024, 0.055], 4),
        { sides: 10, bellyCut: [-0.30], ragged: 0.04, seed: 92 });
      ped.position.set(-1.34, 0.55, 0); g.add(ped);
      [1, -1].forEach(function (s2) {
        fin([back, belly], [-1.64, 0.55 + s2 * 0.02, 0], {
          span: 0.58, chordRoot: 0.24, chordTip: 0.03, sweep: 0.48, concavity: 0.32,
          rearTipBack: 0.08, apexRound: 0.05, thick: 0.03, spanSteps: 5, chordSteps: 3,
          under: true, spanDir: [-0.56, s2 * 0.83, 0], chordDir: [1, 0, 0],
        });
      });
      return g;
    },
  });

  /* ==========================================================================
     THE CETACEANS. Same hull and blade grammar; the difference that matters is
     the tail, which is a HORIZONTAL fluke. wildlife.js decides fish-vs-whale
     from the proportions of the rear-most child, so the fluke is built as one
     merged two-lobed mesh — two separate lobes would each read as a tall
     narrow caudal blade and the whale would swim like a shark.
     ========================================================================== */

  // ---- ORCA. Gloss black over a white chin/belly, the white eye patch and
  //      the pale saddle PAINTED into the hull, a towering dorsal.
  S({
    id: "orca", name: "Orca", biome: "water", rarity: "rare",
    hp: 620, fur: "Orca Hide", furValue: 520, meat: "Whale Meat", meatValue: 44,
    herd: [3, 6], spd: 3.4, danger: 0.5, bite: 42, aquatic: true,
    scale: 1.55, color: 0x14171b, clearance: 110, swimDepth: 2.6,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const black = m(0x14171b), white = m(0xf4f6f6), saddle = m(0x4b545c), eye = m(0x06070a);
      const rings = bodyRings(-2.30, 3.20, 1.00,
        [0.22, 0.62, 0.82, 0.86, 0.80, 0.66, 0.42],
        [0.20, 0.56, 0.74, 0.78, 0.72, 0.58, 0.34], 13);
      const hull = hullMesh([black, white, saddle], rings, {
        sides: 14, bellyCut: [-0.52, -0.34, -0.30, -0.34, -0.30, -0.10, 0.30],
        ragged: 0.05, seed: 95, paintKey: "orca-marks",
        paint: function (i, u, j, s, isBelly) {
          if (isBelly) return -1;
          if (u > 0.80 && u < 0.90 && s > 0.10 && s < 0.62) return 1;   // white eye patch
          if (u > 0.42 && u < 0.56 && s > 0.55) return 2;               // pale saddle
          return -1;
        },
      });
      hull.name = "cetaceanHull"; g.add(hull);
      [0.60, -0.60].forEach(function (z) {
        const e = new T.Mesh(cachedGeom("eye|0.09", function () {
          return new T.SphereGeometry(0.09, 8, 6);
        }), eye);
        e.position.set(2.34, 1.16, z); g.add(e);
      });
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      fin([black], [0.30, 1.72, 0], {          // the tower
        span: 1.95, chordRoot: 1.05, chordTip: 0.10, sweep: 0.34, concavity: 0.22,
        leadBow: 0.05, rearTipH: 0.08, rearTipBack: 0.28, apexRound: 0.14,
        thick: 0.20, spanSteps: 6, chordSteps: 4, spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        fin([black, white], [1.35, 0.62, s2 * 0.62], {   // big paddle pectoral
          span: 1.18, chordRoot: 0.86, chordTip: 0.20, sweep: 0.40, concavity: 0.10,
          leadBow: 0.10, rearTipH: 0.16, rearTipBack: 0.18, apexRound: 0.30,
          thick: 0.17, spanSteps: 5, chordSteps: 4, under: true,
          spanDir: [-0.36, -0.34, s2 * 0.87], chordDir: [1, 0, s2 * 0.1],
        });
      });
      const ped = hullMesh([black, white], bodyRings(-1.026, 0.3, 0,
        [0.08, 0.16, 0.4], [0.054, 0.1, 0.3], 5),
        { sides: 12, bellyCut: [-0.42], ragged: 0.04, seed: 96 });
      ped.position.set(-2.60, 1.00, 0); g.add(ped);
      const fluke = finsMesh([black, white], [-3.20, 1.00, 0], [1, -1].map(function (s2) {
        return {
          span: 1.30, chordRoot: 0.86, chordTip: 0.06, sweep: 0.62, concavity: 0.26,
          rearTipH: 0.10, rearTipBack: 0.22, apexRound: 0.05, thick: 0.13,
          spanSteps: 5, chordSteps: 4, under: true,
          spanDir: [0, 0, s2], chordDir: [1, 0, 0], origin: [0, 0, s2 * 0.06],
        };
      }));
      g.add(fluke);
      return g;
    },
  });

  // ---- BOTTLENOSE DOLPHIN. Grey back into a pale belly, a tall FALCATE
  //      dorsal, a short beak, a notched horizontal fluke.
  S({
    id: "dolphin", name: "Dolphin", biome: "water", rarity: "common",
    hp: 40, fur: "Dolphin Hide", furValue: 70, packs: 3, herd: [4, 8],
    spd: 3.0, danger: 0, aquatic: true, scale: 0.9, color: 0x5c6873,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const grey = m(0x5c6873), pale = m(0xd6dde1), eye = m(0x0d1013);
      const rings = bodyRings(-1.45, 2.10, 0.82,
        [0.13, 0.36, 0.46, 0.47, 0.42, 0.30, 0.14],
        [0.11, 0.32, 0.41, 0.42, 0.37, 0.26, 0.12], 12);
      const hull = hullMesh([grey, pale], rings,
        { sides: 12, bellyCut: [-0.46, -0.30, -0.24, -0.26, -0.34, -0.44], ragged: 0.06, seed: 97 });
      hull.name = "cetaceanHull"; g.add(hull);
      // melon + short thick beak
      const beak = hullMesh([grey, pale], bodyRings(-0.20, 0.50, 0,
        [0.15, 0.075], [0.16, 0.070], 4), { sides: 10, bellyCut: [-0.30], seed: 98 });
      beak.position.set(2.06, 0.760, 0); g.add(beak);
      [0.20, -0.20].forEach(function (z) {
        const e = new T.Mesh(cachedGeom("eye|0.045", function () {
          return new T.SphereGeometry(0.045, 7, 5);
        }), eye);
        e.position.set(1.88, 0.930, z); g.add(e);
      });
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      fin([grey], [0.00, 1.22, 0], {           // FALCATE — swept hard back
        span: 0.86, chordRoot: 0.62, chordTip: 0.05, sweep: 0.72, concavity: 0.34,
        leadBow: 0.06, rearTipH: 0.08, rearTipBack: 0.20, apexRound: 0.07,
        thick: 0.09, spanSteps: 5, chordSteps: 4, spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        fin([grey, pale], [0.86, 0.560, s2 * 0.33], {
          span: 0.62, chordRoot: 0.38, chordTip: 0.05, sweep: 0.56, concavity: 0.22,
          rearTipBack: 0.12, apexRound: 0.10, thick: 0.06, spanSteps: 5, chordSteps: 3,
          under: true, spanDir: [-0.42, -0.34, s2 * 0.84], chordDir: [1, 0, s2 * 0.1],
        });
      });
      const ped = hullMesh([grey, pale], bodyRings(-0.6, 0.18, 0,
        [0.0375, 0.075, 0.185], [0.0297, 0.055, 0.14], 4),
        { sides: 10, bellyCut: [-0.40], ragged: 0.04, seed: 99 });
      ped.position.set(-1.62, 0.82, 0); g.add(ped);
      const fluke = finsMesh([grey, pale], [-2.02, 0.82, 0], [1, -1].map(function (s2) {
        return {
          span: 0.62, chordRoot: 0.46, chordTip: 0.04, sweep: 0.60, concavity: 0.26,
          rearTipH: 0.10, rearTipBack: 0.12, apexRound: 0.05, thick: 0.07,
          spanSteps: 5, chordSteps: 3, under: true,
          spanDir: [0, 0, s2], chordDir: [1, 0, 0], origin: [0, 0, s2 * 0.04],
        };
      }));
      g.add(fluke);
      return g;
    },
  });

  // ---- HUMPBACK WHALE. Very long knobbly white pectorals (~1/3 of the body),
  //      a grooved white throat, a tubercled head, a broad horizontal fluke.
  S({
    id: "humpback_whale", name: "Humpback Whale", biome: "water",
    rarity: "rare", hp: 900, fur: "Whale Blubber", furValue: 600,
    meat: "Whale Meat", meatValue: 50, packs: 2, spd: 1.6, danger: 0.1,
    aquatic: true, scale: 1.6, color: 0x2f3c45,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const dark = m(0x2f3c45), white = m(0xdae0e2), groove = m(0x232d34), knob = m(0x3c4952);
      const rings = bodyRings(-3.10, 3.70, 0.95,
        [0.26, 0.80, 1.02, 1.05, 1.00, 0.86, 0.55],
        [0.22, 0.72, 0.94, 0.98, 0.94, 0.82, 0.50], 14);
      const hull = hullMesh([dark, white, groove], rings, {
        sides: 14, bellyCut: [-0.52, -0.40, -0.30, -0.18, 0.02, 0.10, -0.10],
        ragged: 0.05, seed: 101, paintKey: "humpback-grooves",
        paint: function (i, u, j, s, isBelly) {
          if (!isBelly || u < 0.42) return -1;
          return (j % 2) === 0 ? 2 : -1;                 // the throat pleats
        },
      });
      hull.name = "cetaceanHull"; g.add(hull);
      // TUBERCLES — the knobs on the rostrum, one merged mesh.
      const knobs = meshOf(cachedGeom("humpback-knobs", function () {
        const sh = new Shell();
        for (let i = 0; i < 16; i++) {
          const x = lerp(2.30, 3.60, h01(i * 3 + 1, 5, 77));
          const ang = Math.PI * 0.5 + (h01(i * 3 + 2, 9, 77) - 0.5) * 2.2;
          const sk = onSkin(rings, x, ang, 0.02);
          const tg = norm3(cross3(sk.n, [1, 0, 0]));
          const fw = norm3(cross3(tg, sk.n));
          sh.plate(0, sk.p, fw, tg, 0.15, 0.15, sk.n);
        }
        return sh.geom();
      }), [knob]);
      g.add(knobs);
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      fin([dark], [-0.75, 1.94, 0], {          // the low dorsal hump
        span: 0.42, chordRoot: 0.80, chordTip: 0.10, sweep: 0.55, concavity: 0.16,
        leadBow: 0.12, rearTipH: 0.20, rearTipBack: 0.20, apexRound: 0.30,
        thick: 0.20, spanSteps: 4, chordSteps: 4, spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        // the enormous white flipper, a third of the body long
        fin([white, white], [1.40, 0.65, s2 * 0.80], {
          span: 2.90, chordRoot: 0.72, chordTip: 0.16, sweep: 0.30, concavity: 0.12,
          leadBow: 0.14, rearTipH: 0.14, rearTipBack: 0.22, apexRound: 0.22,
          thick: 0.20, spanSteps: 7, chordSteps: 4, under: true,
          spanDir: [-0.30, -0.24, s2 * 0.92], chordDir: [1, 0, s2 * 0.1],
        });
      });
      const ped = hullMesh([dark, white], bodyRings(-1.21, 0.35, 0,
        [0.1, 0.2, 0.5], [0.0756, 0.14, 0.36], 5),
        { sides: 12, bellyCut: [-0.44], ragged: 0.04, seed: 102 });
      ped.position.set(-3.45, 0.95, 0); g.add(ped);
      const fluke = finsMesh([dark, white], [-4.15, 0.95, 0], [1, -1].map(function (s2) {
        return {
          span: 1.85, chordRoot: 1.05, chordTip: 0.06, sweep: 0.66, concavity: 0.30,
          rearTipH: 0.10, rearTipBack: 0.30, apexRound: 0.05, thick: 0.16,
          spanSteps: 5, chordSteps: 4, under: true,
          spanDir: [0, 0, s2], chordDir: [1, 0, 0], origin: [0, 0, s2 * 0.08],
        };
      }));
      g.add(fluke);
      return g;
    },
  });

  /* ---- GIANT MANTA RAY. The wing IS a fin, so it is built with the fin
     grammar: one swept blade per side with a bowed leading edge, a concave
     trailing edge and a knife-edge tip, dark above and white below. The old
     one was four boxes per side. */
  S({
    id: "manta_ray", name: "Giant Manta Ray", biome: "water",
    rarity: "uncommon", hp: 90, fur: "Manta Hide", furValue: 210,
    meat: "Fish Fillet", meatValue: 18, herd: [1, 3], spd: 1.9, danger: 0,
    aquatic: true, scale: 1.1, color: 0x262c33, clearance: 70, swimDepth: 2.2,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const dark = m(0x262c33), pale = m(0xeaeeef), slit = m(0x141a1e), eye = m(0x0a0c0f);
      const core = hullMesh([dark, pale], bodyRings(-0.95, 1.05, 0.58,
        [0.10, 0.20, 0.24, 0.22, 0.15], [0.35, 0.60, 0.66, 0.60, 0.44], 8),
        { sides: 14, bellyCut: [0.02], ragged: 0.04, seed: 103 });
      core.name = "mantaCore"; g.add(core);
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      [1, -1].forEach(function (s2) {
        fin([dark, pale], [0.05, 0.575, s2 * 0.52], {
          span: 2.30, chordRoot: 1.75, chordTip: 0.10, sweep: 0.62, concavity: 0.22,
          leadBow: 0.09, rearTipH: 0.10, rearTipBack: 0.55, apexRound: 0.06,
          thick: 0.20, spanSteps: 7, chordSteps: 5, under: true,
          spanDir: [-0.10, -0.06, s2 * 0.99], chordDir: [1, 0, 0],
        });
        // the rolled cephalic lobe ("horn") and the eye behind it
        fin([dark, pale], [1.16, 0.560, s2 * 0.34], {
          span: 0.52, chordRoot: 0.22, chordTip: 0.07, sweep: 0.10, concavity: 0.05,
          rearTipH: 0.30, rearTipBack: 0.05, apexRound: 0.30, thick: 0.14,
          spanSteps: 4, chordSteps: 3, under: true,
          spanDir: [0.90, -0.36, s2 * 0.24], chordDir: [0, 0, s2],
        });
        const e = new T.Mesh(cachedGeom("eye|0.06", function () {
          return new T.SphereGeometry(0.06, 7, 5);
        }), eye);
        e.position.set(0.98, 0.605, s2 * 0.60); g.add(e);
      });
      // THE MOUTH — a wide terminal SLOT, bowed forward in the middle, with a
      // pale lip above and below. It was a BoxGeometry laid across the face,
      // which is the last primitive that read as a brick in this animal.
      const mouth = meshOf(cachedGeom("manta-mouth2", function () {
        const sh = new Shell(), n = 12, cols = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n - 0.5;
          const z = t * 0.92;
          const x = 1.13 - t * t * 0.46;                 // bowed forward
          cols.push({
            a: sh.v(x, 0.575, z),                        // upper lip, outer
            b: sh.v(x - 0.055, 0.528, z),                // slot, upper
            c: sh.v(x - 0.070, 0.489, z),                // slot, lower
            d: sh.v(x - 0.010, 0.446, z),                // lower lip, outer
          });
        }
        for (let i = 0; i < n; i++) {
          const p0 = cols[i], p1 = cols[i + 1];
          sh.quad(1, p0.a, p1.a, p1.b, p0.b);            // upper lip
          sh.quad(0, p0.b, p1.b, p1.c, p0.c);            // the dark slot
          sh.quad(1, p0.c, p1.c, p1.d, p0.d);            // lower lip
        }
        return sh.geom();
      }), [slit, m(0x8f9498)]);
      mouth.name = "mantaMouth";
      g.add(mouth);
      const gills = meshOf(cachedGeom("manta-gills", function () {
        const sh = new Shell();
        for (let s2 = -1; s2 <= 1; s2 += 2) {
          for (let i = 0; i < 5; i++) {
            sh.plate(0, [0.36 - i * 0.17, 0.435, s2 * 0.42], [1, 0, 0], [0, 0, 1], 0.05, 0.30);
          }
        }
        return sh.geom();
      }), [slit]);
      g.add(gills);
      // the whip tail — thin, long, and what the swim rig undulates
      const tail = hullMesh([dark, dark], bodyRings(-1.30, 0.10, 0,
        [0.018, 0.075], [0.018, 0.075], 5), { sides: 8, bellyCut: [-1], seed: 104 });
      tail.position.set(-1.05, 0.58, 0); g.add(tail);
      return g;
    },
  });

  /* ---- GREEN SEA TURTLE. A low domed carapace with a scute mosaic painted
     into it, a cream plastron, and two long FLIPPERS that row. */
  S({
    id: "sea_turtle", name: "Green Sea Turtle", biome: "water",
    rarity: "common", hp: 45, fur: "Turtle Shell", furValue: 65,
    meat: "Fish Fillet", meatValue: 12, herd: [1, 3], spd: 1.1, danger: 0,
    aquatic: true, scale: 0.7, color: 0x4f6535,
    clearance: 20, swimDepth: 1.1,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const shell = m(0x4f6535), scute = m(0x384a26), cream = m(0xd6cfa8);
      const skin = m(0x6f7b53), eye = m(0x121418);
      const car = hullMesh([shell, cream, scute], bodyRings(-0.78, 0.80, 0.52,
        [0.10, 0.22, 0.26, 0.24, 0.14], [0.26, 0.52, 0.58, 0.52, 0.30], 9), {
        sides: 14, bellyCut: [-0.30], ragged: 0.03, seed: 105, paintKey: "turtle-scutes",
        paint: function (i, u, j, s, isBelly) {
          if (isBelly || s < 0.15) return -1;
          return ((i + ((j * 2 / 14) | 0)) % 2) === 0 ? 2 : -1;
        },
      });
      car.name = "turtleShell"; g.add(car);
      const neck = hullMesh([skin, skin], bodyRings(-0.10, 0.44, 0,
        [0.13, 0.09], [0.13, 0.10], 3), { sides: 10, bellyCut: [-1], seed: 106 });
      neck.position.set(0.86, 0.520, 0); g.add(neck);
      const beak = new T.Mesh(cachedGeom("turtle-beak", function () {
        return new T.ConeGeometry(0.085, 0.16, 6);
      }), cream);
      beak.position.set(1.36, 0.500, 0); beak.rotation.z = -Math.PI / 2; g.add(beak);
      [0.085, -0.085].forEach(function (z) {
        const e = new T.Mesh(cachedGeom("eye|0.035", function () {
          return new T.SphereGeometry(0.035, 6, 5);
        }), eye);
        e.position.set(1.16, 0.565, z); g.add(e);
      });
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      [1, -1].forEach(function (s2) {
        fin([skin, cream], [0.44, 0.470, s2 * 0.34], {   // the long rowing flipper
          span: 1.05, chordRoot: 0.42, chordTip: 0.05, sweep: 0.52, concavity: 0.20,
          leadBow: 0.08, rearTipH: 0.12, rearTipBack: 0.14, apexRound: 0.08,
          thick: 0.075, spanSteps: 5, chordSteps: 4, under: true,
          spanDir: [-0.40, -0.24, s2 * 0.88], chordDir: [1, 0, s2 * 0.1],
        });
        fin([skin, cream], [-0.54, 0.450, s2 * 0.30], { // the short rear paddle
          span: 0.42, chordRoot: 0.30, chordTip: 0.06, sweep: 0.42, concavity: 0.12,
          rearTipH: 0.20, rearTipBack: 0.08, apexRound: 0.24, thick: 0.055,
          spanSteps: 4, chordSteps: 3, under: true,
          spanDir: [-0.44, -0.20, s2 * 0.88], chordDir: [1, 0, 0],
        });
      });
      // a short pointed tail — the swim rig needs SOMETHING behind the origin
      const tail = hullMesh([skin, skin], bodyRings(-0.24, 0.06, 0,
        [0.030, 0.070], [0.030, 0.070], 3), { sides: 8, bellyCut: [-1], seed: 107 });
      tail.position.set(-0.86, 0.470, 0); g.add(tail);
      return g;
    },
  });
})();
