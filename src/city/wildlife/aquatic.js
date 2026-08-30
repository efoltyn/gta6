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
                   rows merged into one mesh per jaw, a cavity that is a HOLE
                   — an inside-out banded ellipsoid receding maroon-to-black
                   (§6), never a convex pink mass — an upper jaw that SLIDES
                   FORWARD AND DOWN while the rostrum lifts off it, and (§7)
                   a lower jaw that IS the body: a chin cut from the species'
                   own rings, dropping out of a hull notched along the seam,
                   so a bite splits the head into its dark and white halves
                   instead of swinging a clamp under a closed one.

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

  /* ---- THE SPLIT-BODY MOUTH SWITCH ---------------------------------------
     Owner, with the orca photograph on the table (2026-08-21): the shark's
     mouth "is a clamp detached from the shape of the shark". The orca is the
     brief — when its mouth opens, the HEAD ITSELF splits: the black upper
     half lifts, the white lower half drops, and both halves are continuations
     of the body's own mass. So the sharks now open the same way: the hull
     ends at the jaw corner and hands the whole head front to TWO JAW SHELLS
     cut from the species' own rings — the dark upper half (addSnoutShell,
     carrying the eyes and a real nose tip) and the white CHIN — with the
     gums and tooth rows living INSIDE them, between palate and chin deck,
     visible only when the body pries open. ?sharkmouth=off (or
     CBZ.CONFIG.SHARK_MOUTH_SPLIT = false) reverts to the old band-clamp
     mouth — that is what the before/after preset's BEFORE column renders. */
  function mouthSplitOn() {
    if (typeof location !== "undefined" && location.search &&
        /(^|[?&])sharkmouth=off(&|$)/.test(location.search)) return false;
    return !(CBZ.CONFIG && CBZ.CONFIG.SHARK_MOUTH_SPLIT === false);
  }
  /* The SEAM — the closed-mouth line on the side of the head, y as a function
     of x. It follows the gum arc: level at the front lip, rising toward the
     jaw corner exactly like addSharkMouth's riseAt, so the hull notch, the
     rostrum notch and the chin rim all land on the same line and the closed
     head stays sealed. mo is the same options object addSharkMouth takes. */
  function mouthSeamY(mo, x) {
    const len = mo.length, A = mo.arcSpan == null ? Math.PI * 0.49 : mo.arcSpan;
    const rise0 = mo.cornerRise == null ? mo.gap * 0.42 : mo.cornerRise;
    const cx = len * 0.18, rad = len * 0.82;
    const ca = clamp((x - mo.hingeX - cx) / rad, -1, 1);
    const a = Math.min(A, Math.acos(ca));
    return mo.hingeY - mo.gap * 0.27 + rise0 * Math.pow(a / (A || 1), 1.7);
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
    /* WHICH FACE IS THE UNDERSIDE. The blade's two faces are +w and -w, and
       slot 1 (the pale belly) used to be nailed to -w. But a left/right pair
       is built by NEGATING spanDir, which negates w — so on exactly one side
       of every animal the "underside" faced the sky. On a hammerhead, whose
       cephalofoil wings are horizontal, that is not subtle: one wing came out
       white from above and the other grey. Every shark's pectorals and pelvics
       had the same flip at a shallower angle.

       Countershading follows GRAVITY, not winding order. So ask which way the
       thickness axis actually points in the model's own frame, and let the
       lower face wear the belly. A vertical blade (dorsal, caudal — w is
       horizontal) has no lower face, w[1] is ~0, and nothing changes for it. */
    const flipFaces = w[1] < -1e-3;
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
      const gUp = hm >= tipDark ? 2 : (hm < paleBase ? 3 : 0);
      const gDn = hm >= tipDark ? 2 : (under ? 1 : (hm < paleBase ? 3 : 0));
      // rows[i][0] is the +w face and rows[i][1] the -w face; which of those
      // two is the upper one depends on the mirror (see flipFaces).
      const gT = flipFaces ? gDn : gUp;
      const gB = flipFaces ? gUp : gDn;
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
    /* THE BLADE REMEMBERS ITS OWN RECIPE.

       city/wildlife_shark.js draws the above-water dorsal itself, because the
       body is LOD-hidden for most of an encounter and a fin has to keep
       cutting the water after the shark stops being drawn. It had no way to
       ask what the authored dorsal actually looks like, so it measured a
       bounding box and re-guessed a blade — which means the fin you see at
       forty metres and the fin you see at eight are two different shapes, and
       the handover between them is a pop.

       Recording the shape bag here closes that for every species at once, with
       no naming convention to keep in sync: the proxy already finds the dorsal
       geometrically, and can now read the exact options off the mesh it found
       and hand them straight to CBZ.finBlade. One line, and the two fins
       become the same fin. */
    m.userData.finShape = shape;
    if (at) m.userData.finAt = [at[0], at[1], at[2]];
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
  // ONE weld rule for the whole ocean: wildlife_orca.js builds its own hull
  // from its own ring grammar, but a tail joint is a tail joint, and a second
  // copy of this arithmetic is exactly how the two descriptions drifted apart
  // in the first place. See weldedSleeve below.
  CBZ.aquaticWeldedSleeve = function (hullRings, o) { return weldedSleeve(hullRings, o); };
  CBZ.aquaticWeldedRostrum = function (hullRings, o) { return weldedRostrum(hullRings, o); };

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
    /* THE MOUTH NOTCH (split-body mouth). o.mouth carries the addSharkMouth
       options (plus optional xOff/yOff for a shell built in a pivot-local
       frame, and `lift` metres above the seam). Any vertex forward of the jaw
       corner that would fall BELOW the seam line is raised onto it — so the
       hull simply has no chin of its own in the mouth region. The raised
       floor tucks inward in proportion to how far the vertex travelled, which
       keeps the cheek wall flush above the seam while the palate hides inside
       the dropping chin. Faces that got cut are painted with the interior
       material (slot 2): when the jaws open, what you see up there is the
       dark roof of the mouth, not a second, static chin. */
    const mo = o.mouth || null;
    const moX = mo ? (mo.xOff || 0) : 0, moY = mo ? (mo.yOff || 0) : 0;
    const moLift = mo ? (mo.lift || 0) : 0;
    const moFrom = mo ? mo.hingeX + mo.length * 0.05 - moX : 0;
    const notched = mo ? [] : null;
    const sh = new Shell(), id = [];
    for (let i = 0; i < n; i++) {
      const r = rings[i], row = [], cutRow = [];
      let roof = -1e9;
      if (mo && r.x > moFrom) roof = mouthSeamY(mo, r.x + moX) + moLift - moY;
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        let y = r.y + Math.sin(a) * r.ry, z = Math.cos(a) * r.rz;
        const cut = y < roof;
        if (cut) {
          const deep = Math.min(1, (roof - y) / Math.max(0.05, r.ry));
          y = roof;
          z *= 1 - 0.30 * deep;
        }
        cutRow.push(cut);
        row.push(sh.v(r.x, y, z));
      }
      id.push(row);
      if (notched) notched.push(cutRow);
    }
    function bucket(i, j) {
      const nj = (j + 1) % sides;
      if (notched) {
        // interior-dark only when the quad lies fully inside the notch. The
        // half-in transition quads (an intact ring on one side, a clamped one
        // on the other) keep their skin paint: they are the tissue fold at
        // the jaw corner, they slope INTO the mouth, and painting them dark
        // put maroon patches on the outside of a closed head.
        const r0 = notched[i], r1 = notched[i + 1];
        const in0 = r0 && (r0[j] || r0[nj]), in1 = r1 && (r1[j] || r1[nj]);
        if (r0 && r1 ? (in0 && in1) : (in0 || in1)) return 2;
      }
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
      mouth: o.mouth || 0,
    };
    const key = "hull|" + JSON.stringify(shape) + "|" + (o.paintKey || "");
    const geo = cachedGeom(key, function () {
      return hullShell({
        rings: rings, sides: o.sides, bellyCut: o.bellyCut, ragged: o.ragged,
        seed: o.seed, paint: o.paint, mouth: o.mouth,
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

  /* ======================================================================
     THE TAIL WELD (owner, 2026-08-27: "where the tail meets the body the
     tail part is much wider than the body part — the tail circle is much
     bigger, when they should be identical so the tail looks connected").

     A caudal peduncle is not a cone bolted to the back of an animal. It IS
     the body, continued past the station where the hull mesh stops. But it
     has to be a SEPARATE mesh, because the swim rig hinges it against a
     rigid trunk — so for years every species here carried TWO independent
     descriptions of the same cross-section: the hull's profile curve, and a
     hand-typed front ring on the sleeve. Nothing kept them in step, and
     nothing ever did: measured on the shipped models, the sleeve's front rim
     was 1.03x the hull's circle on the great white, 1.13x on the hammerhead,
     1.31x on the dolphin, 1.88x on the humpback and 2.06x on the orca. Seen
     head-on, the orca's tail was a tube twice the diameter of the animal it
     grew out of; seen from the side, the body tapered to a point and a
     bigger cone started behind it.

     `weldedSleeve` deletes the second description. The front ring is READ OFF
     THE HULL at the station where the sleeve emerges, so the two circles are
     the same circle by construction and cannot drift when either profile is
     retuned later. The taper behind it also LEAVES at the hull's own slope:
     the exponent of the power curve is solved from the hull's measured taper
     at the weld, so the silhouette has no kink at the seam either — matching
     radius alone still leaves a visible corner where the two skins meet.

     What a species still declares is what only it knows: where the stock ends
     and how thin it gets there.

       at     [x, y] the sleeve mesh is placed at, in root space
       x1     the WELD, in sleeve-local x (the sleeve's front face)
       x0     the tip station, in sleeve-local x
       tipRy  half-height / half-width at that tip
       tipRz
       sides  MUST be the hull's own side count: the two rings are then the
              same polygon, not two polygons inscribed in the same ellipse.

     WHY THE SLEEVE STILL LEAVES SLIGHTLY SHALLOWER THAN THE HULL (SLOPE_K):
     on the sharks the sleeve is pushed a fifth of a metre INTO the hull, and
     that buried overlap is what hides the wedge the swim rig's hinge opens
     when the tail beats. Matching the hull's taper exactly would lay the two
     skins on top of each other through that overlap and they would z-fight.
     Leaving at 72% of the hull's slope diverges the sleeve outward from the
     first millimetre — the hull's tail stays buried — while the seam still
     reads as one curve, because the radii are equal AT the weld and it is a
     step in radius, not a soft change of slope, that the eye reads as a joint.
     ====================================================================== */
  const SLOPE_K = 0.72;
  function weldedSleeve(hullRings, o) {
    const weldX = o.x1, tipX = o.x0, L = Math.max(1e-4, weldX - tipX);
    const w = ringAt(hullRings, o.at[0] + weldX);            // the hull's own circle
    // the hull's taper AT the weld, per unit of x — measured, never typed
    const probe = ringAt(hullRings, o.at[0] + weldX + L * 0.25);
    // ry(t) = tip + (weld - tip) * t^p, t = 0 at the tip, 1 at the weld.
    // dry/dx at the weld is (weld - tip) * p / L, so p is the hull's slope
    // expressed in the sleeve's own coordinates. Clamped: a hull that flares
    // hard behind the weld must not be allowed to fold the stock into a waist
    // (p too high) or blow it into a cylinder (p too low).
    function expo(hullR, tipR) {
      const drop = w[hullR] - o[tipR];
      if (!(drop > 1e-4)) return 1;
      const slope = Math.max(0, (probe[hullR] - w[hullR]) / (L * 0.25));
      return clamp(slope * SLOPE_K * L / drop, 0.65, 2.6);
    }
    const py = expo("ry", "tipRy"), pz = expo("rz", "tipRz");
    const n = Math.max(3, o.n || 5), out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      out.push({
        x: lerp(tipX, weldX, t),
        y: w.y - o.at[1],                    // coaxial with the hull's tail
        ry: o.tipRy + (w.ry - o.tipRy) * Math.pow(t, py),
        rz: o.tipRz + (w.rz - o.tipRz) * Math.pow(t, pz),
      });
    }
    return out;
  }
  /* ======================================================================
     THE HEAD WELD — the same defect, at the other end of the animal.

     Owner, 2026-08-30, with three photographs of a live great white: "the head
     of the great white, like the tail, the former issue we had — the head
     meets the body and the head is less wide in diameter than the body where
     the geometry meets, and that should be fixed and streamlined like the tail
     was."

     He is right, and it is the same bug with the same cause. A shark's snout
     forward of the jaw hinge is its own shell (it has to be: it LIFTS — see
     addSnoutShell), and its rings were hand-typed exactly the way the tail
     sleeve's were. Measured on the shipped great white by firing rays at the
     built mesh, station by station from the nose back: the outline narrowed
     into the joint, stepped OUT by 22 mm where the shell's rim emerged, and
     changed slope in the same millimetre. That reads as a head plugged into a
     body — a wall you can see in plan view — and no amount of retuning either
     table fixes it, because there are two tables.

     So the snout is generated the way the tailstock is: its rim is READ OFF
     THE HULL at the weld station, and it leaves at the hull's own taper (times
     SLOPE_K, for the same reason the sleeve does — an exactly matched slope
     lays the two skins on each other through the buried overlap and they
     z-fight). What a species still declares is only what is its own: where the
     shell emerges, where the nose ends, and how blunt it is there.

     THE ONE THING THE TAIL DOES NOT NEED: a rostrum swings. At full gape the
     shell rotates up about the jaw hinge, so its rear rim cannot sit exactly
     on the skin or the lift opens a crescent of daylight behind it. The first
     ring is therefore BEHIND the weld and inside the head (buryK of the hull's
     own circle), which is solid geometry to swing inside of.
     ====================================================================== */
  function weldedRostrum(hullRings, o) {
    const weldX = o.x1, tipX = o.x0, L = Math.max(1e-4, tipX - weldX);
    const w = ringAt(hullRings, weldX);                  // the hull's own circle
    const probe = ringAt(hullRings, weldX - L * 0.25);   // ..and its taper behind it
    function expo(hullR, tipR) {
      const drop = w[hullR] - o[tipR];
      if (!(drop > 1e-4)) return 1;
      const slope = Math.max(0, (probe[hullR] - w[hullR]) / (L * 0.25));
      return clamp(slope * SLOPE_K * L / drop, 0.55, 2.6);
    }
    const py = expo("ry", "tipRy"), pz = expo("rz", "tipRz");
    const n = Math.max(3, o.n || 5);
    const tipY = o.tipY == null ? w.y : o.tipY;
    const out = [];
    const bx = weldX - (o.bury == null ? L * 0.26 : o.bury);
    const bw = ringAt(hullRings, bx), bk = o.buryK == null ? 0.88 : o.buryK;
    out.push({ x: bx, y: bw.y, ry: bw.ry * bk, rz: bw.rz * bk });
    for (let i = 0; i < n; i++) {
      const t = 1 - i / (n - 1);            // 1 at the weld, 0 at the tip
      const s = 1 - t;
      out.push({
        x: lerp(tipX, weldX, t),
        // the snout RISES to the tip, which is the one thing about a shark's
        // profile the ring radii cannot say. Smoothstepped so the crown line
        // has no corner at the weld either.
        y: w.y + (tipY - w.y) * (s * s * (3 - 2 * s)),
        ry: o.tipRy + (w.ry - o.tipRy) * Math.pow(t, py),
        rz: o.tipRz + (w.rz - o.tipRz) * Math.pow(t, pz),
      });
    }
    return out;
  }
  // The countershading line has to cross the weld without a jog, so the
  // snout's belly cuts are generated too: they leave at the hull's own value
  // at the weld station and ramp to whatever the species wants at the nose.
  function bellyAt(rings, cuts, x) {
    if (!Array.isArray(cuts)) return cuts == null ? -0.16 : cuts;
    let i = 0;
    while (i < rings.length - 2 && rings[i + 1].x < x) i++;
    const a = rings[i], b = rings[i + 1];
    const t = b.x === a.x ? 0 : clamp((x - a.x) / (b.x - a.x), 0, 1);
    return lerp(cuts[i], cuts[Math.min(cuts.length - 1, i + 1)], t);
  }
  function rostrumBelly(snoutRings, weldCut, tipCut) {
    const x0 = snoutRings[1].x, x1 = snoutRings[snoutRings.length - 1].x;
    return snoutRings.map(function (r) {
      const t = clamp((r.x - x0) / Math.max(1e-4, x1 - x0), 0, 1);
      return weldCut + (tipCut - weldCut) * (t * t * (3 - 2 * t));
    });
  }
  /* Everything a species needs to say about its own snout, in one call: the
     rings AND the belly line that has to cross the same seam. */
  function rostrumOf(hullRings, hullBelly, o) {
    const rings = weldedRostrum(hullRings, o);
    return { rings: rings, belly: rostrumBelly(rings, bellyAt(hullRings, hullBelly, o.x1), o.tipCut) };
  }

  // build it, name it (every sleeve in this file used to be anonymous, which
  // is why the tools that measure this joint have to find it by shape), and
  // hang it on the animal at the one position the weld was solved for.
  function tailSleeve(g, mats, hullRings, o) {
    const ped = hullMesh(mats, weldedSleeve(hullRings, o), {
      sides: o.sides || 12, bellyCut: o.bellyCut,
      ragged: o.ragged == null ? 0.05 : o.ragged, seed: o.seed,
    });
    ped.name = "tailSleeve";
    ped.position.set(o.at[0], o.at[1], 0);
    g.add(ped);
    return ped;
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
    let rings = o.rings || [];
    if (rings.length < 2) return null;
    // the split-body mouth notches the hull along the seam; the third material
    // is the mouth-interior dark those cut faces take. Flag off -> the old
    // closed hull, byte-identical.
    const mo = (o.mouth && mouthSplitOn()) ? o.mouth : null;
    if (mo && mo.snoutShell) {
      /* §7b: WHEN THE SPECIES HAS A SNOUT SHELL, THE HULL HANDS OVER THE
         WHOLE HEAD FRONT. Everything forward of the jaw corner is the two
         jaw shells now — the dark upper half (addSnoutShell) and the white
         chin — so the hull that kept a static dome there would just be a
         face that cannot open. It ends a shade past the hinge instead,
         closed by a cap the notch paints as throat where it shows through
         the open mouth. */
      const endX = mo.hingeX + mo.length * 0.07;
      const kept = rings.filter(function (r) { return r.x < endX; });
      if (kept.length >= 2 && kept.length < rings.length) {
        const rEnd = ringAt(rings, endX);
        kept.push({ x: endX, y: rEnd.y, ry: rEnd.ry, rz: rEnd.rz });
        rings = kept;
      }
    }
    const hull = hullMesh([o.top, o.belly || o.top, o.interior || o.top], rings, {
      sides: o.sides, bellyCut: o.bellyCut, ragged: o.ragged, seed: o.seed,
      mouth: mo,
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
    // the snout shell, when there is one, OWNS whatever is handed here:
    // those details lift with the upper jaw instead of floating in place.
    const snoutOf = function (mesh) {
      if (!o.snout) { g.add(mesh); return; }
      // Split-body snouts are children of the authored upper-envelope group,
      // so their local position is no longer their root-space origin.  Keep the
      // original builder-space origin on the shell and use it for every eye,
      // nostril and pore.  Otherwise reparenting the real head geometry would
      // leave its face details one hinge-length in front of it.
      const origin = o.snout.userData && o.snout.userData._rootOrigin;
      mesh.position.x -= origin ? origin.x : o.snout.position.x;
      mesh.position.y -= origin ? origin.y : o.snout.position.y;
      mesh.position.z -= origin ? origin.z : o.snout.position.z;
      o.snout.add(mesh);
    };
    if (o.eyeSize !== 0) {
      const eyeGeom = cachedGeom("eye|" + (o.eyeSize || 0.075), function () {
        return new T.SphereGeometry(o.eyeSize || 0.075, 8, 6);
      });
      [-1, 1].forEach(function (side) {
        const eye = new T.Mesh(eyeGeom, dark);
        eye.name = "sharkEye";
        eye.position.set(o.eyeX, o.eyeY, side * o.eyeZ);
        eye.scale.set(0.85, 1, 0.6);
        // §7c: the eye lives on the head's UPPER HALF, so when that half is
        // a jaw shell the eye rides it — look at the orca photograph: the
        // eye rotates up with the bite. On the legacy rostrum path the eye
        // stays on the body, exactly as before.
        if (o.snout && o.snout.userData && o.snout.userData._splitShell) snoutOf(eye);
        else g.add(eye);
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
      // A PORE NEEDS SKIN UNDER IT. These are hash-placed on the rostrum
      // rings' theoretical underside, but on a split-body mouth that underside
      // is the NOTCH: the skin there belongs to the chin, which swings away
      // while the pores stay parented to the snout — grey plates floating in
      // the open gape, and z-fighting the closed chin at rest. Inside the
      // authored oral plan and below the seam, there is no snout skin, so no
      // pore.
      const mo2 = o.mouth && mouthSplitOn() ? o.mouth : null;
      const key = "pore|v2|" + [count, pr, x0, x1, spread, o.poreSeed || 5, !!mo2].join(",") + "|" + JSON.stringify(pRings);
      const geo = cachedGeom(key, function () {
        const sh = new Shell();
        for (let i = 0; i < count; i++) {
          const u = h01(i * 3 + 1, 7, o.poreSeed || 5);
          const w2 = h01(i * 3 + 2, 11, o.poreSeed || 5);
          const x = lerp(x0, x1, u * u * 0.85 + 0.08);
          const ang = -Math.PI * 0.5 + (w2 - 0.5) * 2 * spread;
          const sk = onSkin(pRings, x, ang, 0.006);
          if (mo2) {
            const mu = (sk.p[0] - mo2.hingeX - mo2.length * 0.18) / (mo2.length * 0.82);
            const mv = sk.p[2] / (mo2.width * 0.5);
            if (mu * mu + mv * mv < 1.15 * 1.15 &&
              sk.p[1] < mo2.hingeY + mo2.gap * 0.30) continue;
          }
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
    // scars stop at the jaw corner when the head front is jaw shells — a rake
    // mark floating where the hull no longer is would be the old bug back in
    // a new suit. (The shells carry their own ragged paint forward.)
    const xCap = (o.mouth && o.mouth.snoutShell && mouthSplitOn())
      ? o.mouth.hingeX + o.mouth.length * 0.02 : 1e9;
    const key = "skin|" + [scars, folds, seed, o.scarLen || 0.4, o.foldX || 0, o.foldSpan || 0.5, xCap].join(",")
      + "|" + JSON.stringify(rings);
    const geo = cachedGeom(key, function () {
      const sh = new Shell();
      const x0 = rings[0].x, x1 = Math.min(xCap, rings[rings.length - 1].x);
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
        FRONT of the closed-mouth rostrum tip. The shared swim rig reads the
        authored mouth contract and advances the real upper-head envelope; a
        builder callback adds the rostrum lift and any small, species-authored
        relative dental motion without creating a second animation owner.
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

  /* ---- THE MOUTH INTERIOR (reference sheet §6) --------------------------
     Owner, 2026-08-25: "when a shark opens its mouth you see deep inside its
     massive mouth, not a protruding giant tongue."

     Two generations of this failed the same way, and both failures were the
     same mistake wearing different clothes: ONE BLOB, SCALED IN Y BY THE GAPE.

       gen 1: an ellipsoid in the middle of the mouth, grown tenfold. It was
              scaled about its own centre while the jaws swing about the hinge,
              so at full gape a third of it hung in open water under the snout.
              MeshLambert then lit its far wall to bright salmon: the tongue.
       gen 2: the same trick anchored on the hinge and painted dark. Better
              maths, same class of bug — a jaw ROTATES, and no amount of y-scale
              tracks a 62-degree rotation. The front of the fan stayed out at
              full jaw length while the real mandible tip had swung back and
              down to two-fifths of it, so the bore still hung past the teeth.

     There is no single mesh that can do this. An interior bounded by two parts
     that move differently has to be built in the parts' own frames, so this is
     THREE pieces, and each one is welded to whatever moves it:

       ROOF   -> the upper jaw. The palate, arching up away from the gum band.
       FLOOR  -> the mandible. The shallow basin the tongueless floor of a
                 shark's mouth actually is; it travels with the chin.
       THROAT -> the head. Behind the oral arc, where neither jaw reaches, a
                 closed inside-out bore running a jaw-length back into the body
                 and clamped inside the hull's own cross-section. This is the
                 black at the back, and it is the only piece that has to fill a
                 hole rather than skin a jaw.

     Nothing scales. Nothing can protrude, because every surface is a fixed
     distance from the bone that carries it. All of it is UNLIT and DoubleSide:
     no light reaches the back of a throat, and a mouth interior seen from a
     grazing angle must never turn into a hole in the mesh. */
  const UNLIT_CACHE = new Map();
  /* THESE HEX VALUES LOOK ABSURDLY DARK AND THEY ARE CORRECT. core/renderer.js
     runs outputEncoding = sRGBEncoding with ColorManagement.enabled = false, so
     an authored colour is treated as LINEAR and brightened on the way out:
     0x53211f leaves the pipe at about rgb(140,85,70), a milk-chocolate brown.
     That is the second half of why the old cavity read as a tongue — its wall
     was never the dark it was written as. Author the throat in linear and it
     lands where a throat belongs. 0x140505 -> ~rgb(80,43,43). */
  function unlit(c) {
    let mm = UNLIT_CACHE.get(c);
    if (!mm) {
      mm = new T.MeshBasicMaterial({ color: c, side: T.DoubleSide });
      UNLIT_CACHE.set(c, mm);
    }
    return mm;
  }

  function addSharkMouth(g, T_, m, o) {
    const hingeX = o.hingeX, hingeY = o.hingeY, len = o.length, width = o.width, gap = o.gap;
    // Keep gingiva inside the moving head envelope.  A tall exposed band may
    // technically connect teeth to skull, but in profile it is still a pink
    // prosthetic rail.  The outer lip is a narrow skin fold; the roots and the
    // bulk of the gum live behind it.
    const gumH = o.gumHeight || gap * 0.18;
    const lipH = gumH + gap * 0.035;
    // The oral margin belongs just INSIDE the head silhouette. The previous
    // front boxes were centred on the arc's furthest point and extended another
    // 6.5% of jaw length into open water — the pink/white tusk-like lips the
    // player could see in profile. Seat the shared band and its front seal
    // behind the arc instead; pure-biting apex sharks have only subtle labial
    // supports compared with suction feeders' conspicuous lip cartilages.
    const lipRecess = o.lipRecess == null ? len * 0.035 : o.lipRecess;
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
    const skin = m(o.skin || 0xdfe4e6);
    /* AND ONE DOUBLE-SIDED COPY OF IT. The buccal sack's outer wrap is swept
       with ONE winding for both cheeks — they face opposite ways, so on one
       flank of every shark in this game that wrap was back-facing and culled,
       and the dark cavity wall behind it showed through the closed mouth as an
       arch. Found by firing a ray through that arch and asking the scene what
       it hit (the probe in tools/visual-presets/shark-head-weld.mjs):
       sharkBuccalSack, on the side the winding loses. One material per animal,
       no vertices moved, both flanks fixed. */
    const skinWrap = skin.clone(); skinWrap.side = T_.DoubleSide;

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
        // Taper the world-facing rail inward only around the front bite line.
        // The cheek/corner tissue keeps its full section and therefore stays
        // joined to the head; the centre no longer grows a bumper beyond it.
        const front = Math.pow(Math.max(0, 1 - Math.abs(a) / (A * 0.46)), 1.7);
        const seat = lipRecess * front;
        const corner = function (dn, dy) {
          const d = dn - seat;
          return sh.v(p[0] + nn[0] * d, yr + dy, p[1] + nn[1] * d);
        };
        // THE UPPER BAND IS A LIP, NOT A BUMPER. The protruded palatoquadrate
        // in the reference photographs is a THIN pale wrap around the tooth
        // row; built at the lower jaw's cross-section it read as a rigid grey
        // roll bar across the mouth and, head-on at full rake, as a helmet
        // over the snout. So the upper jaw takes a much slimmer section:
        // shallower rails and under half the lip height — downward. UPWARD,
        // in the split-body mouth, the outer face reaches tall: that is the
        // pale membrane connecting the slid-out tooth row to the lifted
        // snout, and it is what stopped the upper jaw reading as a floating
        // denture ring with daylight behind it. At rest the tall part lives
        // inside the rostrum shell, invisible.
        const split = mouthSplitOn();
        /* THE LOWER RAIL IS A CREASE, NOT A SHELF. Coloured by part, the jaw
           line came out as four stacked rails — gum, lip, tooth base, chin
           deck — each catching its own highlight, which is what read as white
           slabs bolted along the mouth. In every reference photograph the
           lower jaw is skin, then a thin dark crease, then teeth. Halving the
           lower band's outward reach is what turns the stack back into a
           line; the tissue is still there, it just stops standing out of the
           face. */
        /* AND THE UPPER BAND DOES NOT STAND OFF THE FACE EITHER. Removing the
           skirt took the bumper's HEIGHT away; this takes its THICKNESS. At
           half of railOut the upper band was still a pale rail proud of the
           snout, catching its own highlight above the tooth row — the same
           "protruding lip that doesn't exist in reality", just thinner. On a
           real great white the upper teeth come straight out of the gum under
           the snout and there is nothing outboard of them. 0.10 leaves the
           band as a seam, not a rail. The lower jaw keeps its lip: it has one. */
        const kIn = up ? 0.75 : 1, kOut = (up ? 0.10 : 0.55) * (1 - front * 0.82);
        /* ---- THE LIP COVERS THE TEETH, WHICH IS WHY A CLOSED SHARK MOUTH IS
           A LINE ------------------------------------------------------------
           Owner, 2026-08-30, on the front of the great white's mouth: "there
           are too many pieces — it looks like white chunks all over, poorly
           streamlined."  Photographed and counted (the part-map page): at rest
           SIX surfaces were in that square centimetre — rostrum, upper gum,
           upper tooth field, lower tooth field, lower gum, chin — with the
           buccal sack showing between the crowns.

           The cause is that the tooth row is 0.145 long and the lip band that
           is supposed to cover it reached 0.0135 down: the crowns hung into
           the gap between the two bands, and through that gap you could see
           the inside of the animal. Every reference photograph of a closed
           great white shows the opposite — skin, one dark crease, and the TIPS
           of the upper teeth, with the gums nowhere. So each band's outer face
           now carries a SKIRT that reaches most of a crown toward the other
           jaw. Nothing is added and nothing is deleted: the same band is
           simply as deep as the teeth it is the lip for. */
        /* THE TWO SKIRTS ARE NOT THE SAME LENGTH, and that asymmetry IS the
           closed-mouth silhouette: an upper lip that comes most of the way
           down over its crowns, a lower lip that comes only a quarter of the
           way up, and the tips of the upper teeth overhanging the gap between
           them. Made them equal once and the mouth vanished into the face —
           one blank white surface, which is a different wrong picture. */
        /* ---- AND THE UPPER JAW HAS NO LIP AT ALL --------------------------
           Owner, 2026-08-30, with three photographs on the table: "your bottom
           mouth is good, the top mouth is weird, and there's this protruding
           lip you have that doesn't exist in reality — and the teeth should be
           scary and noticeable."

           He is right and it was my own doing. Closing the front of the mouth
           by hanging a skirt of skin down over the upper crowns did remove the
           chunks, but it invented an anatomy: a white bumper along the top jaw
           that no shark has. Look at what the photographs actually show — on a
           CLOSED great white the upper teeth hang over the lower lip, bare,
           and they are the most noticeable thing on the face. The lower jaw is
           the one with a lip, and its skirt stays: in the same photographs the
           lower crowns are tucked away behind it.

           So the upper skirt is zero. What keeps the mouth from going back to
           being a pile of pieces is the work that actually fixed it — the
           buccal sack pulled behind the seal and inside the lips, and the gum
           line above the tooth row, so the teeth stand against dark tissue
           instead of white belly skin. */
        const skirtK = up ? (o.lipSkirt == null ? 0 : o.lipSkirt)
          : (o.lipSkirtLower == null ? 0.26 : o.lipSkirtLower);
        /* AND IT DRAPES DEEPER AT THE CORNER, not shallower. The corner is
           where the part map found the last of the chunks: a column of buccal
           sack and tooth field showing between the end of the upper lip and
           the chin's rim, which on a real animal is the deepest fold of skin
           on the whole mouth. Tapering the skirt there (the first attempt)
           opened that gap wider; growing it closes it. */
        const corner3 = Math.pow(Math.abs(a) / (A || 1), 3);
        const skirt = toothH * skirtK * (up ? 1 + corner3 * 0.55 : 1 - corner3 * 0.30);
        const kGum = up ? 0.80 : 1, kLipDn = up ? 0.21 : 0.45;
        const kLipUp = up ? (split ? 1.05 : 0.21) : 0.45;
        rows.push({
          a: a,
          c: [corner(-railIn * kIn, gumH * 0.5 * kGum), corner(-railIn * kIn, -gumH * 0.5 * kGum),
            corner(railOut * kOut, -lipH * kLipDn - (up ? skirt : 0)),
            corner(railOut * kOut, lipH * kLipUp + (up ? 0 : skirt))],
        });
      }
      // face 0 inner, 1 bottom, 2 outer, 3 top.  Gingiva belongs on the wet
      // inner/bottom faces; the world-facing upper lip is the same pale skin
      // as the rostrum around it.  This is what visually joins the dental row
      // to the moving crown instead of drawing a long pink bar under it.
      const faceGroup = up ? [0, 0, 1, 1] : [0, 1, 1, 0];
      for (let i = 0; i < stations; i++) {
        const am = (rows[i].a + rows[i + 1].a) * 0.5;
        const corner = Math.abs(am) > A * 0.60;
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) % 4;
          let grp = faceGroup[k];
          if (corner && (grp === 0 || grp === 2)) grp = 2;
          sh.quad(grp, rows[i].c[k], rows[i].c[k2], rows[i + 1].c[k2], rows[i + 1].c[k]);
        }
      }
      sh.quad(2, rows[0].c[3], rows[0].c[2], rows[0].c[1], rows[0].c[0]);
      const L = rows[stations].c;
      sh.quad(2, L[0], L[1], L[2], L[3]);
      return sh.geom();
    }
    function band(y, up, name, parent) {
      const key = "jawband3|" + mouthSplitOn() + "|" +
        [y, up, gumH, lipH, lipRecess, railIn, railOut, len, width, A, cornerRise].join(",");
      // 20 stations, not 14: the skirt's edge is now a visible line on the
      // face, and at 14 the teeth behind it poked through between stations.
      const geo = cachedGeom(key, function () { return bandGeom(y, up, 20); });
      // both jaws' world-facing faces are the PALE jaw skin: in the
      // photographs the protruded upper jaw is whitish-pink, and painting it
      // the dark dorsal colour is exactly what made it read as a bolted-on
      // grey object instead of the animal's own lip.
      const mesh = meshOf(geo, [gum, skin, gumDark]);
      mesh.name = name;
      parent.add(mesh);
      return mesh;
    }

    /* ---- one merged tooth field per jaw: three rows, tapering and raking
            toward the corners, serrated, pink where enamel meets gum ------- */
    function toothField(up) {
      const rows = o.toothRows || [
        /* THE FRONT ROW IS ON THE ARC. It was pulled inboard to hide behind an
           upper lip that no longer exists; on a real animal the working row IS
           the edge of the jaw, which is why you can count the teeth in every
           photograph ever taken of one. */
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

    // THE UPPER ENVELOPE is the real head, not the teeth.  `upper` is the
    // articulation root that will also receive addSnoutShell's crown/rostrum;
    // `dental` is the palatoquadrate nested inside it.  Sharks protrude that
    // tooth-bearing cartilage relative to the lifting head, but because both
    // start in one envelope the teeth cannot become a free denture hoop.
    const upper = new T.Group(); upper.name = "sharkUpperEnvelope";
    const dental = new T.Group(); dental.name = "sharkUpperJaw";
    const lower = new T.Group(); lower.name = "sharkLowerJaw";
    upper.position.set(hingeX, hingeY, 0);
    lower.position.set(hingeX, hingeY, 0);   // this origin IS the physical hinge
    upper.add(dental);
    g.add(upper); g.add(lower);

    band(upperY, true, "sharkUpperGum", dental);
    band(lowerY, false, "sharkLowerGum", lower);

    /* THE CHIN — the orca move, and the whole point of the split-body mouth.
       The lower jaw used to be an arc of bands and a slab: a clamp, hanging
       under a hull whose own white underside NEVER MOVED, so a bite read as
       dentures swinging below a closed head. This is the body's actual front
       underside, rebuilt from the species' own rings — the belly line is the
       hull's belly line, the beam is the hull's beam pulled in a whisker so
       the jaw seam reads as a crease — and parented at the hinge. When the
       jaw drops, the white half of the head is what drops, and the notched
       hull above shows the dark mouth roof: the black-over-white separation
       of the reference photograph. The deck along its top is recessed and
       painted interior-dark; the gum band and tooth row stand proud of it. */
    function chinMesh() {
      const rings = o.rings;
      const key = "sharkchin|" + [hingeX, hingeY, len, width, gap, cornerRise, A].join(",") +
        "|" + JSON.stringify(rings);
      const geo = cachedGeom(key, function () {
        const sh = new Shell();
        const N = 10, ARCP = 9;
        // End the moving chin at the authored oral arc. Its former 1.04len
        // station plus 0.03len cap recreated the old front lip's 6.5% beak,
        // even after the soft seal itself was recessed.
        const xB = -len * 0.30, xF = len * 0.99;
        const lastX = rings[rings.length - 1].x;
        const deckDrop = gap * 0.12;
        const st = [];
        for (let i = 0; i < N; i++) {
          const t = i / (N - 1);
          const lx = lerp(xB, xF, t);
          const wx = hingeX + lx;
          const b = ringAt(rings, Math.min(wx, lastX));
          const ca = clamp((lx - cx) / rad, -1, 1);
          const aA = Math.min(A, Math.acos(ca));
          const rise = cornerRise * Math.pow(aA / (A || 1), 1.7);
          // the rim rides the seam; at the very corner it reaches a little
          // higher still, up behind the notched hull edge, so no sightline
          // finds daylight between cheek and chin on a closed head
          /* THE CORNER OF THE MOUTH IS SKIN, NOT A SLOT. Forward of the hull's
             cut face there is no cheek: whatever covers the join between the
             snout shell's seam and the chin has to BE the chin. At gap*0.10
             with a sixth-power ramp it reached that seam only in the last few
             degrees, and the part map found what was behind the gap — two
             walls of buccal sack, framing a dark arch cut into the side of the
             jaw from every low three-quarter angle. Reach the seam earlier and
             further and the corner closes into a fold. */
          const rim = lowerY - gumH * 0.12 + rise + gap * 0.26 * Math.pow(aA / (A || 1), 4);
          let bot = Math.min((b.y - b.ry) - hingeY, rim - gap * 0.36);
          let rz = Math.min(b.rz * 0.96, hw * 1.30);
          if (wx > lastX) {
            // past the hull's front cap: round the jaw off toward the lip
            const f = clamp((wx - lastX) / Math.max(0.05, hingeX + xF - lastX), 0, 1);
            rz = lerp(rz, width * 0.34, f * f);
            bot = lerp(bot, rim - gap * 0.42, f * 0.55);
          }
          if (i === 0) { rz *= 0.72; bot = lerp(rim - gap * 0.30, bot, 0.45); }
          bot += 0.006;      // a hair above the intact hull belly it duplicates
          const dep = Math.max(gap * 0.10, rim - bot);
          /* AND THE DECK NARROWS INTO THE JAW. The mouth's floor was carried
             at a flat 55% of the section's width all the way to the last
             station, so the forward cap — a fan from that wide flat deck to a
             single point — came out as a WHITE BOX stuck on the front of the
             chin, with the dark deck showing as a panel in it. Every reference
             photograph has a lower jaw that closes to a rounded blade. Taper
             the deck over the front fifth and the cap becomes that blade. */
          const nose = clamp((t - 0.78) / 0.22, 0, 1);
          const deckZ = rz * 0.55 * (1 - 0.72 * nose * nose);
          const pts = [], v = [];
          for (let k = 0; k < ARCP; k++) {
            let p;
            if (k <= 6) {                        // rim +z, around the belly, rim -z
              const ph = (k / 6) * Math.PI;
              p = [lx, rim - dep * Math.pow(Math.sin(ph), 0.8), Math.cos(ph) * rz];
            } else if (k === 7) p = [lx, rim - deckDrop, -deckZ];
            else p = [lx, rim - deckDrop, deckZ];
            pts.push(p); v.push(sh.v(p[0], p[1], p[2]));
          }
          st.push({ pts: pts, v: v, lx: lx, rim: rim, dep: dep });
        }
        for (let i = 0; i < N - 1; i++) {
          const A0 = st[i], A1 = st[i + 1];
          for (let k = 0; k < ARCP; k++) {
            const k2 = (k + 1) % ARCP;
            let nrm, grp;
            if (k < 6) {                         // the white skin
              grp = 0;
              const my = (A0.pts[k][1] + A0.pts[k2][1]) * 0.5 - (A0.rim - A0.dep * 0.4);
              const mz = (A0.pts[k][2] + A0.pts[k2][2]) * 0.5;
              nrm = [0, my, mz];
              if (Math.abs(nrm[1]) + Math.abs(nrm[2]) < 1e-4) nrm = [0, -1, 0];
            } else if (k === 7) { grp = 1; nrm = [0, 1, 0]; }          // the deck
            else { grp = 1; nrm = [0, 0.35, k === 6 ? 1 : -1]; }       // deck walls
            sh.quadN(grp, nrm,
              [A0.pts[k], A0.pts[k2], A1.pts[k2], A1.pts[k]],
              [A0.v[k], A0.v[k2], A1.v[k2], A1.v[k]]);
          }
        }
        // caps: the visible jaw tip forward, the buried root aft
        const F = st[N - 1], B = st[0];
        const tip = [F.lx + len * 0.01, F.rim - F.dep * 0.45, 0];
        const vt = sh.v(tip[0], tip[1], tip[2]);
        const root = [B.lx - len * 0.02, B.rim - B.dep * 0.5, 0];
        const vr = sh.v(root[0], root[1], root[2]);
        for (let k = 0; k < ARCP; k++) {
          const k2 = (k + 1) % ARCP;
          // The forward cap is exposed outer anatomy from every profile angle.
          // Painting its two deck wedges with the recessed interior material
          // left a small pink rectangle at the chin tip that still read as a
          // protruding lip. Keep the deck behind it dark, but close this cap
          // entirely in the shark's pale skin.
          sh.quadN(0, [1, 0, 0], [F.pts[k], F.pts[k2], tip, tip], [F.v[k], F.v[k2], vt, vt]);
          sh.quadN(0, [-1, 0, 0], [B.pts[k], B.pts[k2], root, root], [B.v[k], B.v[k2], vr, vr]);
        }
        return sh.geom();
      });
      // THE DECK IS THE FLOOR OF THE MOUTH, not a stripe on the chin. Lit, its
      // 0x45191d rendered as a broad salmon plank running the whole mandible —
      // the single biggest thing inside an open gape, and half of what the
      // owner was pointing at. It joins the buccal sack and the liner in the
      // unlit interior palette instead.
      return meshOf(geo, [skin, unlit(o.chinDeck || 0x0b0304)]);
    }

    // the mandible: a slim seat under the lower gum — the pre-split clamp
    // look, kept whole behind the flag so ?sharkmouth=off is a real revert.
    const mandKey = "mandible|" + [lowerY, gumH, railIn, railOut, len, width, A, cornerRise].join(",");
    const buildMandible = function () { return meshOf(cachedGeom(mandKey, function () {
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
    }), [skin]); };

    const bodySplit = mouthSplitOn() && !!(o.rings && o.rings.length > 1);
    const mand = bodySplit ? chinMesh() : buildMandible();
    mand.name = bodySplit ? "sharkChin" : "sharkMandible";
    lower.add(mand);

    const ut = toothField(true), lt = toothField(false);
    dental.add(ut.mesh); lower.add(lt.mesh);

    /* THE FRONT SEAL IS AN ARC, NOT TWO BOXES. The old `liptip` cuboids were
       centred at x=len, 13% of len deep, so half of each block projected past
       the jaw and read as a pink upper tusk plus a white lower beak. This short
       swept seal follows the same oral curve as the gums, overlaps that band
       behind the front line, and never reaches the theoretical arc tip. It
       remains a named mesh because visual/physics contracts need a precise
       boundary from which to measure gape. */
    function frontLipGeom(y, up) {
      const sh = new Shell(), rows = [], ST = 6, span = A * 0.20;
      // Recessed does not mean paper-thin: let the two soft margins overlap the
      // closed seam vertically while keeping their entire volume behind the
      // head outline. This hides tooth roots at rest without rebuilding the
      // protruding bumper silhouette.
      const halfH = gap * (up ? 0.055 : 0.075);
      const depth = Math.max(gap * 0.10, len * 0.040);
      for (let i = 0; i <= ST; i++) {
        const a = -span + (i / ST) * span * 2;
        const p = arcPt(a), nn = arcN(a);
        const yr = y + riseAt(a) + (up ? -gap * 0.035 : gap * 0.035);
        // Both faces are behind the arc. The inner face reaches back into the
        // full gum band so the seal is one connected piece of mouth tissue.
        const outer = -lipRecess * 0.82;
        const inner = outer - depth;
        const q = function (dn, dy) {
          return sh.v(p[0] + nn[0] * dn, yr + dy, p[1] + nn[1] * dn);
        };
        rows.push([
          q(inner, halfH), q(inner, -halfH),
          q(outer, -halfH * 0.72), q(outer, halfH * 0.72),
        ]);
      }
      for (let i = 0; i < ST; i++) {
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) % 4;
          // The world-facing outer/top faces are body skin. Group 1 is kept
          // for topology diagnostics, but the finished seal paints both
          // groups as skin: the full gum band immediately behind it already
          // supplies the wet oral margin without a pink tab at the snout.
          const grp = (k === 0 || k === 1) ? 1 : 0;
          sh.quad(grp, rows[i][k], rows[i][k2], rows[i + 1][k2], rows[i + 1][k]);
        }
      }
      // These lateral caps are exposed in a profile/three-quarter view. They
      // are outer lip skin, not a cross-section of bright gingiva; painting
      // them wet-dark recreated a little pink tab at each mouth corner.
      sh.quad(0, rows[0][3], rows[0][2], rows[0][1], rows[0][0]);
      const L = rows[ST]; sh.quad(0, L[0], L[1], L[2], L[3]);
      return sh.geom();
    }
    function frontLip(y, up, name, parent) {
      const key = "frontLipArc|v1|" +
        [y, up, gap, len, width, A, cornerRise, lipRecess].join(",");
      const mesh = meshOf(cachedGeom(key, function () { return frontLipGeom(y, up); }), [skin, skin]);
      mesh.name = name; parent.add(mesh); return mesh;
    }
    frontLip(upperY, true, "sharkUpperLip", dental);
    frontLip(lowerY, false, "sharkLowerLip", lower);

    const restClose = 0.04;
    lower.rotation.z = restClose;

    // Two nested anatomical parts, one visually continuous envelope.  The
    // crown carries almost all of the protrusion so the actual head advances
    // with the teeth.  Builders may opt into a small relative palatoquadrate
    // slide, but the shared default is zero: a large dental-only translation
    // simply recreates the detached-denture failure under a moving snout.
    const hasUpperEnvelope = bodySplit && !!o.snoutShell;
    const protrude = o.envelopeProtrude == null ? (hasUpperEnvelope ? len * 0.22 : 0) : o.envelopeProtrude;
    const upperDrop = o.envelopeDrop == null ? (hasUpperEnvelope ? gap * 0.035 : 0) : o.envelopeDrop;
    const dentalProtrude = o.dentalProtrude == null ? 0 : o.dentalProtrude;
    const dentalDrop = o.dentalDrop == null ? 0 : o.dentalDrop;
    const dentalRake = o.dentalRake == null ? 0 : o.dentalRake;
    const snoutLift = o.snoutLift == null ? (hasUpperEnvelope ? 0.16 : 0) : o.snoutLift;

    /* §6: THE INTERIOR IS TWO PIECES, AND EACH IS WELDED TO A BONE.

       Built here, at the end, because the throat's proportions ARE the travel
       numbers: what has to be plugged behind the oral arc is exactly what the
       mandible's `travel` and the snout's `snoutLift` open up.

       THE BUCCAL SACK rides the upper jaw. It is a CLOSED shell — palate,
       two side walls, floor, front and back caps — lofted over the same plan
       ellipse the gum bands and tooth rows are swept along, and it is the
       whole answer to "you should see deep inside". A surface pair (a roof and
       a floor on separate bones) cannot be, because at a 62-degree gape the
       two rims are nowhere near each other and a side-on sightline goes in one
       cheek and straight out of the other. A sack has cheeks.

       Its floor is CLAMPED to the animal's own belly line at every station via
       ringAt — the same min() the chin is cut with — so at rest it is buried
       inside the closed chin, and at full gape it can never be the silhouette.
       That clamp is why the mouth is shallow at the snout and deepens toward
       the throat, which is also what a shark's mouth does.

       THE LINER rides the mandible: a thin dark skin over the inner face of
       the lower jaw, because otherwise the gum band's lit gingiva is the
       biggest thing in the open mouth and the cave reads pink. */
    /* 0.84, NOT 0.92 — THE SACK LIVES INSIDE THE LIPS. Coloured by part, the
       last chunks on the closed mouth were two columns of buccal sack standing
       at the mouth CORNER, outboard of the gum band that is supposed to be the
       outside of the animal there: from a low three-quarter view that read as
       a dark arch cut into the jaw. The cavity is a cavity; it has no business
       reaching the skin. Costs the open mouth nothing visible — the sack's
       walls are still the cheeks you see down the throat. */
    function oralPlan(x) {
      const u = clamp((x - cx) / rad, -1, 1);
      return { u: u, hz: hw * Math.sqrt(Math.max(0, 1 - u * u)) * 0.78 };
    }
    /* THE FLOOR OF THE SACK STOPS AT THE CHIN'S DECK, and this is a hard
       floor, not a preference. The chin is a SHELL: the deck is its top face,
       and the space under it is the inside of a piece of the shark's body,
       not room to put a mouth in. A sack dipping below the deck reads at rest
       as a rust patch bleeding through the closed white chin — which is
       exactly what it did on the first build. chinMesh cuts its deck at
       rim - gap*0.12; sit a hair above that and the closed jaw hides
       everything.

       The depth the mouth loses here it gets back overhead: the palate can
       arch as far up into the head as it likes, and behind it the throat runs
       a jaw-length into the body. Depth belongs where there is body to put it
       in, not hanging under a chin. */
    // ..and its floor keeps further off the chin's deck than it used to: at
    // gap*0.09 the wrap under the sack was surfacing through the closed chin
    // in patches, which is the same defect pointing down instead of forward.
    function sackFloorAt(rimY) { return rimY - gap * 0.03; }
    function sackRoofAt(x, topY) {
      if (!o.rings || o.rings.length < 2) return topY;
      const r = ringAt(o.rings, hingeX + x);
      return Math.min(topY, (r.y + r.ry * 0.55) - hingeY);
    }

    const sack = meshOf(cachedGeom("buccalSack|v3|" + [hingeX, hingeY, len, width,
      gap, cx, rad, A, cornerRise, upperY, lowerY,
      JSON.stringify(o.rings || null)].join(","), function () {
      /* THE SACK STOPS BEHIND THE SEAL. Its front wall used to stand exactly
         ON the arc's front point, which is where the lip band and the front
         seal also are — so above and below the narrow band, a wall of mouth
         cavity was the front of the animal. Painted green to find it, it came
         out as two slabs standing proud of a closed jaw with the dark of the
         cavity between them: the owner's "white chunks", most of them, in one
         object. Six per cent of a jaw behind the seal there is skin in front
         of it from every angle. */
      const sh = new Shell(), N = 14, M = 10, xFront = cx + rad - len * 0.06, xBack = -len * 0.16;
      const top = [], bot = [];
      for (let i = 0; i <= N; i++) {
        const ti = i / N, x = lerp(xFront, xBack, ti);
        const pl = oralPlan(x);
        // the loft ramps in over the first fifth so the plan's forward tip
        // stays pinched behind the front seal instead of splitting it
        const fx = clamp(ti / 0.22, 0, 1);
        /* AND IT PINCHES AT THE BACK TOO. The rear cap sat at full plan width
           a sixth of a jaw behind the hinge — right in the hull's mouth notch
           — and the part map found it looking out through the corner of the
           closed mouth as a tall dark ARCH cut into the side of the jaw, on
           every low three-quarter view. A throat narrows; nothing about this
           animal is a rectangular box at its widest where it meets the body. */
        const bx = clamp((ti - 0.50) / 0.50, 0, 1);
        const hzAt = pl.hz * (1 - 0.46 * bx * bx);
        const tr = [], br = [];
        for (let j = 0; j <= M; j++) {
          const sg = -1 + (2 * j) / M, z = hzAt * sg;
          const ang = Math.atan2(z / hw, pl.u), rise = riseAt(clamp(ang, -A, A));
          const dome = (1 - sg * sg) * fx;
          tr.push([x, sackRoofAt(x, upperY + rise + gap * 0.62 * dome), z]);
          br.push([x, Math.max(lowerY + rise - gap * 0.30 * dome,
            sackFloorAt(lowerY + rise)), z]);
        }
        top.push(tr); bot.push(br);
      }
      const band = function (ti) { return ti < 0.22 ? 0 : (ti < 0.45 ? 1 : (ti < 0.72 ? 2 : 3)); };
      const q = function (g2, a2, b2, c2, d2) {
        sh.quad(g2, sh.v(a2[0], a2[1], a2[2]), sh.v(b2[0], b2[1], b2[2]),
          sh.v(c2[0], c2[1], c2[2]), sh.v(d2[0], d2[1], d2[2]));
      };
      for (let i = 0; i < N; i++) {
        const grp = band((i + 0.5) / N);
        for (let j = 0; j < M; j++) {
          q(grp, top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]);
          q(grp, bot[i][j], bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j]);
        }
        // THE CHEEKS: the two walls that stop a side-on sightline passing
        // through the head, and the reason this is a sack and not two bowls
        q(grp, top[i][0], bot[i][0], bot[i + 1][0], top[i + 1][0]);
        q(grp, top[i][M], bot[i][M], bot[i + 1][M], top[i + 1][M]);
      }
      for (let j = 0; j < M; j++) {          // front and back caps
        q(0, top[0][j], top[0][j + 1], bot[0][j + 1], bot[0][j]);
        q(3, top[N][j], top[N][j + 1], bot[N][j + 1], bot[N][j]);
      }
      /* THE OUTSIDE OF A CHEEK IS THE ANIMAL, NOT THE MOUTH. Every face above
         is interior — unlit near-black, DoubleSide — but the sack hangs off
         the upper jaw, so the moment the chin swings away its cheeks' outer
         sides, its floor's underside and its front pinch face the WORLD:
         every shark wore a maroon curtain below its open mouth, its closed
         tooth gaps punched maroon wedges, and the sack's own box was the
         silhouette against open water. A gaping great white shows pale
         protruded-jaw tissue there, so group 4 lays a thin outset wrap over
         exactly those faces, painted with the body's lit skin. The offset
         keeps it clear of the dark walls' depth without ever reaching the
         chin deck below or the tooth arc outside. */
      const wOff = gap * 0.022;
      const qW = function (a2, b2, c2, d2, n2) {
        const P = [a2, b2, c2, d2].map(function (p2) {
          return [p2[0] + n2[0] * wOff, p2[1] + n2[1] * wOff, p2[2] + n2[2] * wOff];
        });
        sh.quadN(4, n2, P, P.map(function (p2) { return sh.v(p2[0], p2[1], p2[2]); }));
      };
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < M; j++)          // the floor's underside
          qW(bot[i][j], bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j], [0, -1, 0]);
        // the cheeks' outer walls
        qW(top[i][0], bot[i][0], bot[i + 1][0], top[i + 1][0], [0, 0, -1]);
        qW(top[i][M], bot[i][M], bot[i + 1][M], top[i + 1][M], [0, 0, 1]);
      }
      for (let j = 0; j < M; j++)            // the front pinch
        qW(top[0][j], top[0][j + 1], bot[0][j + 1], bot[0][j], [1, 0, 0]);
      return sh.geom();
    /* AND THE WRAP IS DOUBLE-SIDED, which is the whole reason it was not
       working. The outer skin over the sack's cheeks is swept with ONE winding
       for both walls — they face opposite ways, so on one flank of every shark
       in this game the wrap was back-facing and culled, and the dark cavity
       wall behind it showed through the closed mouth as an arch. Found by
       firing a ray through that arch and asking the scene what it hit
       (shark-head-weld's probe): sharkBuccalSack, on the side the winding
       loses. Painting the wrap DoubleSide fixes both flanks without touching
       a single vertex, and costs one material per animal. */
    }), [unlit(o.cavity || 0x140505), unlit(o.cavityDeep || 0x070202),
      unlit(0x020101), unlit(o.cavityEnd || 0x000000), skinWrap]);
    sack.name = "sharkBuccalSack";
    dental.add(sack);

    const liner = meshOf(cachedGeom("mandibleLiner|v3|" + [len, width, gap, cx, rad,
      A, cornerRise, lowerY].join(","), function () {
      const sh = new Shell(), N = 12, M = 10, xFront = cx + rad, xBack = 0;
      const rows = [];
      for (let i = 0; i <= N; i++) {
        const ti = i / N, x = lerp(xFront, xBack, ti);
        const pl = oralPlan(x), fx = clamp(ti / 0.22, 0, 1), row = [];
        for (let j = 0; j <= M; j++) {
          const sg = -1 + (2 * j) / M, z = pl.hz * sg;
          const ang = Math.atan2(z / hw, pl.u);
          // shallower than the chin's own recessed deck on purpose: dip below
          // it and the deck wins the depth test, which is how a lit pink plank
          // ended up being the biggest thing in an open mouth
          row.push([x, lowerY + riseAt(clamp(ang, -A, A))
            - gap * 0.075 * (1 - sg * sg) * fx, z]);
        }
        rows.push(row);
      }
      for (let i = 0; i < N; i++) {
        const t = (i + 0.5) / N, grp = t < 0.3 ? 0 : (t < 0.65 ? 1 : 2);
        for (let j = 0; j < M; j++) {
          const p = [rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]];
          sh.quad(grp, sh.v(p[0][0], p[0][1], p[0][2]), sh.v(p[1][0], p[1][1], p[1][2]),
            sh.v(p[2][0], p[2][1], p[2][2]), sh.v(p[3][0], p[3][1], p[3][2]));
        }
      }
      return sh.geom();
    }), [unlit(o.cavity || 0x140505), unlit(o.cavityDeep || 0x070202), unlit(0x020101)]);
    liner.name = "sharkMandibleLiner";
    lower.add(liner);

    /* THE THROAT. Behind the oral arc neither jaw reaches, so this is the one
       closed piece that fills a hole rather than skinning a bone: an
       inside-out bore from inside the arc's back chord to a pole a full
       jaw-length into the body, shut at both ends so no sightline escapes it.
       Its section is clamped to the hull's own rings, which is the guarantee
       the two scaled-blob generations never had — the bore is bounded by the
       shark, so it can never become the shark's outline. */
    const throat = meshOf(cachedGeom("sharkThroat|v1|" +
      [hingeX, hingeY, len, width, gap, JSON.stringify(o.rings || null)].join(","),
      function () {
        const sh = new Shell(), SEG = 14, ST = 12;
        const xF = len * 0.30, xB = -len * 1.05;
        const rings = [];
        for (let i = 0; i <= ST; i++) {
          const t = i / ST, x = lerp(xF, xB, t);
          const cap = Math.pow(Math.min(clamp((xF - x) / (len * 0.26), 0, 1),
            clamp((x - xB) / (len * 0.34), 0, 1)), 0.55);
          let ry = gap * 1.10 * cap, rz = width * 0.42 * cap;
          if (o.rings && o.rings.length > 1) {
            const r = ringAt(o.rings, hingeX + x);
            const up = (r.y + r.ry * 0.86) - hingeY, dn = hingeY - (r.y - r.ry * 0.86);
            ry = Math.min(ry, Math.max(gap * 0.10, Math.min(up, dn)));
            rz = Math.min(rz, r.rz * 0.82);
          }
          const row = [];
          for (let j = 0; j < SEG; j++) {
            const th = (j / SEG) * Math.PI * 2;
            row.push(sh.v(x, Math.sin(th) * ry, Math.cos(th) * rz));
          }
          rings.push(row);
        }
        for (let i = 0; i < ST; i++) {
          const t = (i + 0.5) / ST;
          const grp = t < 0.18 ? 0 : (t < 0.40 ? 1 : (t < 0.66 ? 2 : 3));
          for (let j = 0; j < SEG; j++) {
            const nj = (j + 1) % SEG;
            // wound inside-out: the visible face is the INTERIOR (the pole
            // rows degenerate to triangles inside Shell.quad, which skips them)
            sh.quad(grp, rings[i][j], rings[i + 1][j], rings[i + 1][nj], rings[i][nj]);
          }
        }
        return sh.geom();
      }), [unlit(o.cavityDeep || 0x070202), unlit(0x020101), unlit(0x010000),
      unlit(o.cavityEnd || 0x000000)]);
    throat.name = "sharkThroat";
    throat.position.set(hingeX, hingeY, 0);
    g.add(throat);
    // the authored-mouth contract still wants one named cavity handle; the
    // throat is the piece that is a hole rather than a skinned jaw
    const cavity = throat;

    const contract = {
      version: 4,
      shape: "articulated-body-envelope",
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
      dentalProtrude: dentalProtrude,
      dentalDrop: dentalDrop,
      dentalRake: dentalRake,
      snoutLift: snoutLift,
      lipProfile: "recessed-arc-seal",
      lipRecess: lipRecess,
      toothRows: (o.toothRows || [0, 0, 0]).length,
      upperTeeth: ut.count,
      lowerTeeth: lt.count,
      // the lower jaw is the body's own white underside (see THE CHIN above),
      // and the hull/rostrum are notched along the seam to make room for it
      bodySplit: bodySplit,
      articulatedEnvelope: hasUpperEnvelope,
      lowerShell: mand.name,
      // the fact the reference sheet is really asking for: how far past the
      // closed rostrum tip the upper tooth row travels
      upperReachX: hingeX + len + protrude + dentalProtrude,
    };
    g.userData.aquaticMouth = contract;
    g._aquaticMouth = {
      lower: lower, upper: upper, dental: dental, lowerShell: mand, cavity: cavity,
      contract: contract, applyGape: null,
    };

    /* ---- THE PROTRUSION DRIVE ------------------------------------------
       The shared rig advances the named upper-envelope group by the contract's
       `protrude`/`upperDrop`. This builder callback adds the shark-specific
       rostrum lift and optional relative dental rake while preserving that one
       openness owner. CBZ.sharkJawProtrude exposes the same callback for tools
       that deliberately pose an authored animal outside the runtime loop. */
    function applyGape(k) {
      const oo = clamp(k, 0, 1);
      // The CROWN and the teeth now share this moving envelope.  The crown
      // lifts and advances with its nested tooth-bearing jaw. Any optional
      // species-authored relative dental motion remains inside that envelope
      // and defaults to zero, so no daylight can open behind a naked hoop.
      upper.rotation.z = oo * snoutLift;
      dental.position.x = oo * dentalProtrude;
      dental.position.y = -oo * dentalDrop;
      dental.rotation.z = -oo * dentalRake;
      // NOTHING TO REVEAL. The roof rides `dental`, the floor rides `lower`
      // and the throat is fixed in the head, so the interior opens because the
      // jaws opened. The old scale-the-blob reveal is what put a lump in the
      // mouth in the first place.
    }
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

  /* §7c. THE UPPER JAW IS THE BODY TOO (owner, 2026-08-21: "I want the mouth
     inside the geometry and prying open the geometry — the colors already
     show the part that needs to split").

     The old rostrum was a closed ellipsoid shell over a still-closed hull: a
     bite lifted a lid over a face that stayed a face. This is the head's
     actual upper half — every cross-section runs from the mouth SEAM on one
     side, up over the crown, back down to the seam on the other side — cut
     from the same rings and painted with the same ragged countershade cut,
     so the dark top and the white upper-lip band pry away from the white
     chin along the line the colours already draw. Underneath it closes with
     a dark palate (the roof of the mouth); the gum band and tooth rows hang
     below that, INSIDE the closed head, and only exist to the eye when the
     jaws part. And the nose finally ends in a NOSE: the sections taper into
     a single slightly-upturned tip point instead of a sawn-off end cap. */
  function addSnoutShell(g, mats, rings, o) {
    const px = o.pivotX, py = o.pivotY;
    const mo = o.mouth;
    const len = mo.length, gap = mo.gap;
    const cutRaw = o.bellyCut == null ? -0.2 : o.bellyCut;
    const cutOf = Array.isArray(cutRaw) ? function (u) { return sample(cutRaw, u); }
      : function () { return +cutRaw; };
    const x0 = mo.hingeX - len * 0.24;                 // buried behind the corner
    const xTip = rings[rings.length - 1].x + len * 0.07;
    const seed = o.seed || 7;
    const key = "snoutshell|" + [px, py, gap, len, seed].join(",") +
      "|" + JSON.stringify(rings) + "|" + JSON.stringify(cutRaw) +
      "|" + [mo.hingeX, mo.hingeY, mo.cornerRise].join(",");
    const geo = cachedGeom(key, function () {
      const sh = new Shell();
      /* 13 x 14, not 11 x 10. This shell IS the front of the animal's face and
         it is the one surface a player gets close to; at ten stations around
         the arc the countershading boundary could only step in 20-degree
         jumps, which is what turned the white under the snout into a row of
         hard pale slabs. */
      const N = 13, K = 14, M = K + 2;
      const st = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const x = lerp(x0, xTip - len * 0.10, t);
        const r = ringAt(rings, x);
        let ry = r.ry, rz = r.rz;
        // the root tucks progressively inside the hull it overlaps (the old
        // rostrum's tuck: 0.90, made continuous): full size only past the
        // hull's cut face, so the two skins never share a surface
        const inHull = clamp((mo.hingeX + len * 0.115 - x) / (len * 0.30), 0, 1);
        const tuck = 1 - 0.13 * inHull;
        ry *= tuck; rz *= tuck;
        const seam = mouthSeamY(mo, x);
        // where the seam crosses this section; below the ring entirely at the
        // tip, where the snout is a full closed volume above the mouth line
        const a0 = Math.asin(clamp((seam - r.y) / Math.max(0.02, ry), -1, 1));
        const pal = Math.max(seam + gap * 0.26, r.y - ry + gap * 0.05) - py;
        const pts = [], v = [], ang = [];
        for (let k = 0; k < K; k++) {
          const a = a0 + (k / (K - 1)) * (Math.PI - 2 * a0);  // seam +z -> crown -> seam -z
          const p = [x - px, r.y + Math.sin(a) * ry - py, Math.cos(a) * rz];
          pts.push(p); ang.push(a); v.push(sh.v(p[0], p[1], p[2]));
        }
        const zi = Math.cos(a0) * rz * 0.78;
        [-zi, zi].forEach(function (zz) {
          const p = [x - px, pal, zz];                 // the palate, closing it below
          pts.push(p); ang.push(null); v.push(sh.v(p[0], p[1], p[2]));
        });
        st.push({ pts: pts, v: v, ang: ang, yc: r.y - py, ry: ry });
      }
      function skinGrp(am, i, k, u) {
        /* THE GUM LINE. Above the tooth row a shark is oral tissue, not belly:
           in every reference photograph the upper teeth stand against a dark
           margin, and that contrast IS what makes them read as teeth. This
           shell painted its countershading white all the way down to the seam,
           so at full gape the crowns were white-on-white and the whole upper
           jaw came back as one blank bar — the owner's "white chunks" seen
           from inside the mouth instead of outside it. The two courses nearest
           the seam take the interior material, on both flanks. */
        // ..and it is a MARGIN, not a course. Painting whole courses dark put
        // a red stripe down the side of the head, because a course near the
        // seam is nearly vertical and covers a lot of face. Measured against
        // the station's own seam angle instead: eight degrees of oral tissue,
        // and skin above it.
        const seamA = st[i] && st[i].ang ? st[i].ang[0] : -1.4;
        // 0.14 rad and no wider: at 0.30 the margin stopped following the jaw
        // line and came out as a maroon patch in the middle of the snout's
        // white underside, which is a blotch, not a gum.
        if (am < seamA + 0.14 || am > Math.PI - seamA - 0.14) return 2;
        const s = Math.sin(am);
        /* THE RAGGED EDGE IS A HINT, NOT A SAW. At +/-0.11 in sin-space the
           jitter was wider than the gap between two stations, so adjacent
           quads flipped sides of the line and the boundary came out as
           interlocking teeth of white and grey. Halved, it reads as the soft
           irregular margin the photographs show. */
        const jit = (h01(k * 7 + 1, 0, seed) - 0.5) * 0.07
          + (h01(k * 7 + 1, i * 13 + 3, seed + 1) - 0.5) * 0.04;
        return s < cutOf(u) + jit ? 1 : 0;
      }
      for (let i = 0; i < N - 1; i++) {
        const A0 = st[i], A1 = st[i + 1];
        const u = (i + 0.5) / (N - 1);
        for (let k = 0; k < M; k++) {
          const k2 = (k + 1) % M;
          let grp, nrm;
          if (k < K - 1) {                             // the outer skin
            const am = (A0.ang[k] + A0.ang[k2]) * 0.5;
            grp = skinGrp(am, i, k, u);
            nrm = [0, Math.sin(am), Math.cos(am)];
          } else {                                     // seam walls + palate: interior
            grp = 2;
            nrm = k === K - 1 ? [0, -0.4, -1] : (k === K ? [0, -1, 0] : [0, -0.4, 1]);
          }
          sh.quadN(grp, nrm,
            [A0.pts[k], A0.pts[k2], A1.pts[k2], A1.pts[k]],
            [A0.v[k], A0.v[k2], A1.v[k2], A1.v[k]]);
        }
      }
      // THE NOSE TIP — a point, slightly upturned (reference §2), where the
      // hull grammar used to leave a flat octagon.
      const F = st[N - 1];
      const rT = ringAt(rings, xTip - len * 0.10);
      const tip = [xTip - px, rT.y - py + rT.ry * 0.18, 0];
      const vt = sh.v(tip[0], tip[1], tip[2]);
      const B = st[0];
      const back = [x0 - px - len * 0.02, B.yc + gap * 0.15, 0];
      const vb = sh.v(back[0], back[1], back[2]);
      for (let k = 0; k < M; k++) {
        const k2 = (k + 1) % M;
        const tg = k < K - 1 ? skinGrp((F.ang[k] + F.ang[k2]) * 0.5, N - 1, k, 1) : 2;
        sh.quadN(tg, [1, 0, 0], [F.pts[k], F.pts[k2], tip, tip], [F.v[k], F.v[k2], vt, vt]);
        sh.quadN(0, [-1, 0, 0], [B.pts[k], B.pts[k2], back, back], [B.v[k], B.v[k2], vb, vb]);
      }
      return sh.geom();
    });
    const mesh = meshOf(geo, mats);
    mesh.name = "sharkRostrum";
    mesh.userData._splitShell = true;   // face details put the EYES on this one
    mesh.userData._rootOrigin = { x: px, y: py, z: 0 };
    const authored = g._aquaticMouth;
    if (authored && authored.upper && authored.contract && authored.contract.articulatedEnvelope) {
      // This is the decisive ownership change: the visible crown/rostrum is a
      // child of the mouth's upper articulation root.  Its geometry remains in
      // the exact same rest-space location, but every production CBZ.swimJaw
      // call now lifts REAL HEAD VERTICES together with the embedded dentition.
      mesh.position.set(px - authored.contract.hinge.x, py - authored.contract.hinge.y, 0);
      authored.upper.add(mesh);
      authored.upperShell = mesh;
      authored.contract.upperShell = "sharkRostrum";
    } else {
      mesh.position.set(px, py, 0);
      g.add(mesh);
    }
    g.userData._sharkRostrum = mesh;
    return mesh;
  }

  /* The lifting snout. The hull is one static mesh, so the rostrum forward of
     the jaw hinge is built as its OWN shell that overlaps back into the head.
     It lifts and advances with the tooth-bearing upper envelope; at rest it is
     simply the front of the animal, and at full gape no dental hoop can leave
     it behind as a separate prosthesis. */
  function addSharkRostrum(g, mats, rings, o) {
    if (o.mouth && o.mouth.snoutShell && mouthSplitOn()) {
      return addSnoutShell(g, mats, rings, o);
    }
    const px = o.pivotX, py = o.pivotY;
    const local = rings.map(function (r) {
      return { x: r.x - px, y: r.y - py, ry: r.ry * (r.x < px ? (o.tuck || 0.97) : 1), rz: r.rz * (r.x < px ? (o.tuck || 0.97) : 1) };
    });
    // The rostrum is the mouth's other body-half: it, too, loses everything
    // under the seam (lifted to palate height, one gum-band above the chin's
    // rim) so the lifted snout shows a dark mouth roof, not a round pale belly
    // hanging into the gape. Same frame trick as the rings above: the shell
    // lives in pivot-local coordinates, so the seam is offset to match.
    const mo = (o.mouth && mouthSplitOn())
      ? Object.assign({}, o.mouth, { xOff: px, yOff: py, lift: o.mouth.gap * 0.26 })
      : null;
    const mesh = hullMesh(mats, local, {
      sides: o.sides, bellyCut: o.bellyCut, ragged: o.ragged, seed: o.seed,
      mouth: mo,
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
    { x: -1.62, y: 0.860, ry: 0.235, rz: 0.165 },   // THE TAILSTOCK (see weldedSleeve)
    { x: -1.15, y: 0.855, ry: 0.350, rz: 0.245 },
    { x: -0.50, y: 0.850, ry: 0.500, rz: 0.375 },
    { x: 0.20, y: 0.850, ry: 0.600, rz: 0.455 },
    { x: 0.85, y: 0.860, ry: 0.615, rz: 0.485 },   // MAX GIRTH — the pectoral line
    /* THE CHEEK KEEPS THE BEAM. This ring used to give up 6% of the animal's
       width before the head had even started, so the widest thing about a
       great white seen head-on was its shoulders and the face was a ball
       hanging off the front of them. In the reference photographs the beam
       carries forward through the gills and lets go only at the cheek. */
    { x: 1.45, y: 0.885, ry: 0.530, rz: 0.480 },
    /* ..and from the weld forward the hull is BURIED INSIDE THE ROSTRUM (see
       weldedRostrum). These two rings are never seen: they exist to carry the
       mouth notch and to give the gill and pore fields a cross-section to sit
       on, and they are kept comfortably inside the shell's own curve. */
    { x: 1.95, y: 0.935, ry: 0.370, rz: 0.380 },
    { x: 2.16, y: 0.965, ry: 0.260, rz: 0.280 },
  ];
  // The countershading LINE, per ring. It runs low across the cheek and kicks
  // hard UP behind the pectoral and over the gills — reference sheet §2. The
  // old single scalar made it a dead-level band all the way down the animal.
  const GW_BELLY = [-0.38, -0.34, -0.26, -0.10, 0.16, 0.00, -0.20, -0.28];
  /* THE SNOUT IS NOT A SECOND TABLE ANY MORE. Rings and countershading are
     both solved off the hull at the weld: the species says only where the
     shell emerges (x1), where the nose ends (x0), how blunt and how flat it is
     there (tipRy/tipRz — a great white's rostrum is a FLATTENED cone, wider
     than it is deep, which is why tipRz is the larger of the two), how far the
     nose lifts (tipY) and where the white reaches (tipCut). */
  /* THE WELD STATION IS THE HULL'S OWN LAST STATION, and it is not a matter
     of taste: addSharkHull hands the whole head front to the jaw shells at
     `hingeX + length*0.07` (1.683 here) and caps itself there. A shell whose
     rim is solved anywhere FORWARD of that is solved against a hull that has
     already stopped, which is exactly how the old snout table came to stand
     22 mm proud of nothing. 1.66 puts the rim a hair inside the hull's last
     ring, where there is still skin for it to match. */
  const GW_ROSTRUM = rostrumOf(GW_RINGS, GW_BELLY, {
    /* AND THE HEAD IS A WEDGE, NOT A BALL. tipRz is the LARGER of the two on
       purpose: a great white's rostrum is flattened top to bottom, so the
       shell's width has to give up less of itself per metre than its depth
       does. The body behind it stays deeper than it is wide, which is the
       contrast the head-on photograph is all about. */
    x1: 1.66, x0: 2.62, tipRy: 0.090, tipRz: 0.250, tipY: 1.030, tipCut: -0.46, n: 5,
  });
  const GW_SNOUT = GW_ROSTRUM.rings;
  const GW_SNOUT_BELLY = GW_ROSTRUM.belly;

  S({
    id: "great_white_shark", name: "Great White Shark", biome: "water",
    rarity: "rare", hp: 140, fur: "Shark Fin", furValue: 260,
    meat: "Shark Meat", meatValue: 30, packs: 3, spd: 2.6, danger: 0.6,
    bite: 30, aquatic: true, scale: 1.2, color: 0x363c40,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const grey = m(0x363c40), white = m(0xf1f4f4);
      const finDark = m(0x2b3134), finTip = m(0x1b1f22), finPale = m(0x545c60);

      // ONE mouth definition drives three shells: the notch cut into the
      // hull, the notch cut into the rostrum, and the chin the lower jaw
      // actually is. They must share numbers or the closed head leaks.
      /* THE MOUTH IS AS WIDE AS THE HEAD IS. 0.66 of width against a head
         whose own half-width at the jaw is 0.449 left the jaw line inboard of
         the cheek on both sides: head-on, a small mouth in a big face, and in
         plan the chin was visibly narrower than the skull it hangs under.
         In the reference photographs the corners of the mouth ARE the widest
         part of the head. */
      /* THE MOUTH IS AS WIDE AS THE HEAD CAN CARRY IT, AND NOT ONE
         MILLIMETRE WIDER. The jaw line's corners sit at hw + railOut from the
         axis; the head's own half-width where they land is 0.404. At 0.80 the
         gum band came out past the cheek on both sides — from above, a pink
         rail running outside the skull. 0.72 with a slimmer outer rail puts
         the corners just inside the face, which is where a mouth goes. */
      /* AND THE CORNER OF THE MOUTH WRAPS BACK, which is where the last of
         the owner's "white chunks" were hiding. The jaw arc stopped at
         0.49pi — a hair short of a half ellipse — so the gum bands ended at
         x = 1.805 while the buccal sack behind them ran back to 1.476 and the
         hull's own skin stopped at 1.683. Between those three numbers was a
         slot with nothing in it, and a raycast probe through the dark arch in
         the closed mouth named what was looking out of it: the sack. A real
         shark's mouth line curves back UNDER the cheek past its widest point;
         at 0.56pi ours does too, and the band that is the lip is there to
         cover the hole. */
      const MOUTH = { hingeX: 1.62, hingeY: 0.716, length: 0.90, width: 0.72, gap: 0.30, cornerRise: 0.135, snoutShell: true, railOut: 0.72 * 0.055, arcSpan: Math.PI * 0.56 };
      addSharkHull(g, {
        // 20, not 16, and only on the hero: head-on, the face is the one part
        // of this animal a player is ever close enough to count the flats on,
        // and at 16 the silhouette of the head reads as a drawn polygon.
        top: grey, belly: white, sides: 20, rings: GW_RINGS,
        bellyCut: GW_BELLY, ragged: 0.075, seed: 21, profile: "torpedo-wedge",
        mouth: MOUTH, interior: m(0x3a1518),
      });
      // the mouth goes in BEFORE the rostrum so the snout's matrix is solved
      // after the upper jaw has told it how far to lift this frame
      addSharkMouth(g, T, m, Object.assign({}, MOUTH, {
        rings: GW_RINGS,
        // BIGGER, AND MEANT TO BE SEEN. A great white's front teeth are a
        // third of the height of its own gape in the reference photographs;
        // at 0.145 against a 0.30 gap ours were a comb. Wider too, so the
        // triangles read as triangles at the distance a player meets one.
        toothHeight: 0.178, toothWidth: 0.132, rowTeeth: 19,
        maxOpen: 1.05, skin: 0xf1f4f4,
      }));
      const snout = addSharkRostrum(g, [grey, white, m(0x421a1e)], GW_SNOUT, {
        // MUST be the hull's own side count: the weld ring and the hull ring
        // are then the same polygon, not two polygons on the same ellipse.
        pivotX: 1.95, pivotY: 0.950, sides: 20,
        bellyCut: GW_SNOUT_BELLY, ragged: 0.055, seed: 22, tuck: 0.90,
        mouth: MOUTH,
      });
      addSharkFaceDetails(g, T, m, {
        rings: GW_RINGS, snout: snout, snoutRings: GW_SNOUT, mouth: MOUTH,
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
        foldColor: 0x3f4548, skinSeed: 41, mouth: MOUTH,
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
      tailSleeve(g, [grey, white], GW_RINGS, {
        at: [-1.88, 0.860], x0: -0.502, x1: 0.46, tipRy: 0.060, tipRz: 0.038,
        sides: 16, bellyCut: [-0.36, -0.34, -0.32, -0.30], ragged: 0.05, seed: 23,
      });

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
    { x: -2.10, y: 0.98, ry: 0.360, rz: 0.255 },   // THE TAILSTOCK (see weldedSleeve)
    { x: -1.35, y: 0.96, ry: 0.640, rz: 0.460 },
    { x: -0.35, y: 0.95, ry: 0.92, rz: 0.72 },
    { x: 0.60, y: 0.96, ry: 1.02, rz: 0.83 },     // max girth, forward of centre
    { x: 1.60, y: 0.99, ry: 0.95, rz: 0.80 },
    { x: 2.50, y: 1.06, ry: 0.74, rz: 0.68 },
    // buried inside the rostrum from here forward (see weldedRostrum)
    { x: 3.20, y: 1.16, ry: 0.52, rz: 0.55 },
    { x: 3.52, y: 1.20, ry: 0.36, rz: 0.42 },
  ];
  /* THE APEX FORM HAD THE WORST OF IT. Its snout table began at x = 2.90 and
     the hull hands the head over at 2.41, so ringAt() was clamping: the shell
     left the head as a 0.66 CYLINDER while the hull's own cap stood 0.71 wide
     around it — a collar of body edge visible right round the base of the
     face, and the largest single step measured on any shark here. */
  const MEG_BELLY = [-0.40, -0.34, -0.24, -0.06, 0.18, 0.02, -0.18, -0.26];
  const MEG_ROSTRUM = rostrumOf(MEG_RINGS, MEG_BELLY, {
    x1: 2.38, x0: 3.98, tipRy: 0.16, tipRz: 0.42, tipY: 1.240, tipCut: -0.46, n: 5,
  });
  const MEG_SNOUT = MEG_ROSTRUM.rings;
  S({
    id: "megalodon", name: "Megalodon", biome: "water", rarity: "legendary",
    hp: 1200, fur: "Legendary Megalodon Tooth", furValue: 3000, respawn: false,
    packs: 1, spd: 2.4, danger: 0.8, bite: 60, aquatic: true,
    scale: 2.6, color: 0x2a3035,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const dark = m(0x2a3035), white = m(0xe6ebec);
      const finDark = m(0x232930), finTip = m(0x161a1e), finPale = m(0x474f55);
      const MOUTH = { hingeX: 2.30, hingeY: 0.800, length: 1.58, width: 1.10, gap: 0.56, cornerRise: 0.25, snoutShell: true };
      addSharkHull(g, {
        top: dark, belly: white, sides: 16, rings: MEG_RINGS,
        bellyCut: [-0.40, -0.34, -0.24, -0.06, 0.18, 0.02, -0.18, -0.26],
        ragged: 0.08, seed: 51, profile: "battering-ram",
        mouth: MOUTH, interior: m(0x33131a),
      });
      addSharkMouth(g, T, m, Object.assign({}, MOUTH, {
        rings: MEG_RINGS,
        toothHeight: 0.30, toothWidth: 0.245, rowTeeth: 21,
        maxOpen: 1.02, skin: 0xe6ebec,
      }));
      const snout = addSharkRostrum(g, [dark, white, m(0x3c171d)], MEG_SNOUT, {
        pivotX: 3.20, pivotY: 1.160, sides: 16,
        bellyCut: MEG_ROSTRUM.belly, ragged: 0.06, seed: 52, tuck: 0.90,
        mouth: MOUTH,
      });
      addSharkFaceDetails(g, T, m, {
        rings: MEG_RINGS, snout: snout, snoutRings: MEG_SNOUT, mouth: MOUTH,
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
        foldColor: 0x2f353a, skinSeed: 43, mouth: MOUTH,
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
      tailSleeve(g, [dark, white], MEG_RINGS, {
        at: [-2.46, 0.98], x0: -0.744, x1: 0.66, tipRy: 0.090, tipRz: 0.056,
        sides: 16, bellyCut: [-0.36, -0.34, -0.32, -0.30], ragged: 0.05, seed: 53,
      });
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
    { x: -1.50, y: 0.90, ry: 0.175, rz: 0.120 },   // THE TAILSTOCK (see weldedSleeve)
    { x: -0.85, y: 0.90, ry: 0.350, rz: 0.235 },
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
      const MOUTH = { hingeX: 1.26, hingeY: 0.688, length: 0.74, width: 0.56, gap: 0.24, cornerRise: 0.115 };
      addSharkHull(g, {
        top: grey, belly: pale, sides: 14, rings: HH_RINGS,
        bellyCut: [-0.36, -0.30, -0.12, 0.12, -0.06, -0.26],
        ragged: 0.07, seed: 61, profile: "cephalofoil",
        mouth: MOUTH, interior: m(0x371519),
      });
      addSharkMouth(g, T, m, Object.assign({}, MOUTH, {
        rings: HH_RINGS,
        toothHeight: 0.115, toothWidth: 0.095, rowTeeth: 17,
        maxOpen: 0.94, skin: 0xe9edec,
      }));
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
      tailSleeve(g, [grey, pale], HH_RINGS, {
        at: [-1.76, 0.90], x0: -0.464, x1: 0.42, tipRy: 0.050, tipRz: 0.031,
        sides: 14, bellyCut: [-0.36, -0.34, -0.32, -0.30], ragged: 0.05, seed: 64,
      });
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
  /* OWNER, 2026-08-30: "the body is too wide diameter for the head and tall,
     way too puffer, and doesn't match where they meet — looking very dumb,
     like a fat dog." He is right on all three counts, and the three are one
     table. MEASURED on the shipped animal: 27.7% of total length deep and
     23.1% wide, which is not a shark, it is a manatee — and FATTER in both
     axes than the great white two hundred lines down, when a white shark is
     the deeper-bodied animal of the two. A real Carcharhinus leucas, the
     stockiest requiem shark there is, runs about 18% deep and 16% wide.

     The third complaint is the great white's OWN head-weld bug (see GW_RINGS),
     which the bull never got the fix for. The beam used to let go 8% before
     the head had even started and then fall off a cliff into it: 0.460 at the
     gills, 0.360 at the next station. So the face read as a small ball plugged
     into a barrel, with a visible wall between them. The rule the great white
     already follows: THE CHEEK KEEPS THE BEAM. Width is carried forward
     through the gill field almost intact and is given up only at the mouth
     corner; DEPTH is what goes, and it goes early. That is what turns the
     section over from deeper-than-wide (a body) to wider-than-deep (a broad
     flat head) BEFORE the weld rather than at it, so the shell picks up a
     cross-section it already matches.

     Two stations are new (-0.96 and 1.04). The old table asked one straight
     segment to cover 0.65 of body from the shoulder to the gills and another
     to cover the whole head weld, and a lerp across a span that long is a
     ramp with corners at both ends, not a curve. ---- */
  const BULL_RINGS = [
    { x: -1.32, y: 0.880, ry: 0.152, rz: 0.118 },   // THE TAILSTOCK (see weldedSleeve)
    { x: -0.96, y: 0.874, ry: 0.236, rz: 0.188 },
    { x: -0.58, y: 0.870, ry: 0.306, rz: 0.252 },
    { x: -0.05, y: 0.876, ry: 0.377, rz: 0.322 },
    { x: 0.60, y: 0.888, ry: 0.402, rz: 0.352 },   // MAX GIRTH — the pectoral line
    { x: 1.04, y: 0.902, ry: 0.360, rz: 0.352 },   // THE GILL FIELD — full beam, depth already easing
    /* THE CHEEK, and the station the whole complaint turns on: rz is now the
       LARGER of the pair. The head is wider than it is deep before the snout
       shell ever starts, which is both what a bull shark looks like from in
       front and what makes the weld invisible — the shell's own tip is
       flattened the same way (tipRz > tipRy below).

       AND THE BEAM LETS GO HERE, NOT AT THE WELD. First attempt held the full
       beam all the way to the weld station, which fixed the step and bought a
       worse bug: weldedRostrum reads the hull's TAPER at the weld and leaves
       on it, so a hull that arrives flat hands the shell a slope of nothing,
       the exponent floors at 0.55, and the snout comes out a CYLINDER with a
       rounded-off end. There has to be hull between the cheek and the weld for
       the shell to inherit a taper from — the great white leaves 0.21 of it
       (1.45 -> 1.66) and this now leaves the same 0.19.

       THE SECTION TURNS OVER ACROSS THESE TWO STATIONS, and that is the whole
       answer to "way too puffer". Head-on, the shipped animal was a circle
       (rz/ry = 0.94 at the cheek) with a round chin under it, which is a
       balloon, not a shark. Depth is now given up nearly twice as fast as
       width through the head, so the section runs 0.98 round at the gills ->
       1.30 at the weld -> 1.5 at the nose: a broad flattened wedge that gets
       flatter the further forward you read it. The snout shell inherits it
       for free, because its rim IS this circle. */
    { x: 1.22, y: 0.914, ry: 0.300, rz: 0.350 },
    { x: 1.46, y: 0.936, ry: 0.222, rz: 0.298 },
    /* ..and from here forward the hull is BURIED INSIDE THE ROSTRUM (see
       weldedRostrum). These two are never seen: they carry the mouth notch and
       give the gill and pore fields a cross-section, kept inside the shell. */
    { x: 1.72, y: 0.974, ry: 0.184, rz: 0.254 },
    { x: 1.88, y: 1.000, ry: 0.148, rz: 0.210 },
  ];
  // The countershading line, per ring — low along the cheek, kicking hard UP
  // behind the pectoral. One array, used by BOTH the hull and the rostrum;
  // the hull call used to re-type it as a literal, which is a second copy
  // waiting to drift out of step with this one.
  /* The kick used to be +0.14 at the pectoral against a flank deep enough to
     absorb it. On this one it drew a white rectangle on the side of the animal
     — the seam climbing a quarter of the section in one ring step, with the
     coarse station spacing turning the ramp into a wall at each end. Same
     shape, a third of the amplitude. */
  const BULL_BELLY = [-0.36, -0.33, -0.29, -0.22, -0.04, -0.07, -0.11, -0.18, -0.25, -0.30];
  /* THE WELD STATION IS THE HULL'S OWN CAP, DERIVED AND NOT TYPED. addSharkHull
     hands the head front to the jaw shells at `hingeX + length*0.07` and caps
     itself there with a flat disc. The shipped table solved the shell at 1.39
     against a cap at 1.4146, so 25 mm of hull stood PAST the shell's rim and
     ended in that disc — a ledge you can see as a ring right round the head in
     the three-quarter view, and the literal "doesn't match where they meet".
     Solved AT the cap the two rims are the same circle to the last decimal
     (measured: 0.00 mm proud), and the disc is interior to the shell's own
     forward cone, so there is nothing left to catch the light. It is written
     as the expression rather than as 1.4146 so that moving the mouth can never
     silently re-open the ledge. */
  const MOUTH_HINGE_X = 1.36, MOUTH_LENGTH = 0.78;
  const BULL_ROSTRUM = rostrumOf(BULL_RINGS, BULL_BELLY, {
    x1: MOUTH_HINGE_X + MOUTH_LENGTH * 0.07,   // == the hull's own cap. See above.
    x0: 2.16, tipRy: 0.140, tipRz: 0.215, tipY: 1.006, tipCut: -0.46, n: 6,
  });
  const BULL_SNOUT = BULL_ROSTRUM.rings;
  S({
    id: "bull_shark", name: "Bull Shark", biome: "water",
    rarity: "uncommon", hp: 110, fur: "Shark Fin", furValue: 190,
    meat: "Shark Meat", meatValue: 24, spd: 2.7, danger: 0.55,
    bite: 24, aquatic: true, scale: 0.95, color: 0x464e52,
    clearance: 12, swimDepth: 1.5,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const grey = m(0x464e52), white = m(0xf0f2f2), finDark = m(0x394045), finTip = m(0x252b2f);
      /* THE MOUTH RIDES THE HEAD IT IS CUT INTO. Every number below is the
         same FRACTION of the head's local section it always was, re-solved
         against the slimmer one: the hinge sits 0.427 of the half-depth below
         the spine, the arc spans 67% of the half-beam, and the gape and teeth
         scale with the depth. Left at the shipped values on this head the jaw
         hung below the belly line and the teeth read like a bear trap. */
      const MOUTH = {
        hingeX: MOUTH_HINGE_X, hingeY: 0.818, length: MOUTH_LENGTH,
        width: 0.500, gap: 0.149, cornerRise: 0.064, snoutShell: true,
      };
      addSharkHull(g, {
        // 24, not the shipped 14. The countershading seam is quantised to
        // whole faces (see hullShell's bucket()), so a coarse hull draws the
        // kick behind the pectoral as a white RECTANGLE on the flank rather
        // than a line — and 14 sides also left the head visibly polygonal
        // head-on, which is the view the "puffer" complaint came from.
        top: grey, belly: white, sides: 24, rings: BULL_RINGS,
        bellyCut: BULL_BELLY,
        ragged: 0.055, seed: 71, profile: "stocky-blunt",
        mouth: MOUTH, interior: m(0x3a1518),
      });
      addSharkMouth(g, T, m, Object.assign({}, MOUTH, {
        rings: BULL_RINGS,
        toothHeight: 0.075, toothWidth: 0.063, rowTeeth: 19,
        maxOpen: 1.00, skin: 0xf0f2f2,
      }));
      const snout = addSharkRostrum(g, [grey, white, m(0x421a1e)], BULL_SNOUT, {
        pivotX: 1.66, pivotY: 0.966, sides: 24,
        bellyCut: BULL_ROSTRUM.belly, ragged: 0.055, seed: 72, tuck: 0.90,
        mouth: MOUTH,
      });
      addSharkFaceDetails(g, T, m, {
        rings: BULL_RINGS, snout: snout, snoutRings: BULL_SNOUT, mouth: MOUTH,
        eyeX: 1.80, eyeY: 1.150, eyeZ: 0.260, eyeSize: 0.048, dark: 0x07090a,
        noseX: 1.98, noseY: 0.806, noseZ: 0.105, nostrilLen: 0.13, nostrilWidth: 0.024,
        gillX: 1.28, gillY: 0.898, gillZ: 0, gills: 5, gillCenter: -0.11,
        gillHeight: 0.180, gillStep: 0.10, gillWidth: 0.046, gillAngle: 0.22,
        gillColor: 0xaeb8ba,
        pores: 40, poreSize: 0.017, poreX0: 1.70, poreX1: 2.12, poreSpread: 0.95,
        poreSeed: 34, poreColor: 0x424a4e,
      });
      addSharkSkin(g, m, {
        rings: BULL_RINGS, scars: 9, scarLen: 0.34, scarWidth: 0.022, scarColor: 0xaeb6b8,
        folds: 3, foldX: 1.06, foldStep: 0.14, foldSpan: 0.45, foldWidth: 0.026,
        foldColor: 0x4f585c, skinSeed: 73, mouth: MOUTH,
      });
      function fin(mats, at, shape) { const f = finMesh(mats, at, shape); g.add(f); return f; }
      fin([finDark, finDark, finDark, m(0x5f686c)], [0.25, 1.169, 0], {
        span: 0.66, chordRoot: 0.62, chordTip: 0.10, sweep: 0.60, concavity: 0.30,
        leadBow: 0.07, rearTipH: 0.09, rearTipBack: 0.30, apexRound: 0.30,
        thick: 0.12, spanSteps: 6, chordSteps: 5, paleBase: 0.18, trailPale: 0.17,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      fin([finDark], [-0.85, 1.047, 0], {
        span: 0.21, chordRoot: 0.26, chordTip: 0.04, sweep: 0.55, concavity: 0.28,
        rearTipBack: 0.11, apexRound: 0.10, thick: 0.04, spanSteps: 4, chordSteps: 3,
        spanDir: [0, 1, 0], chordDir: [1, 0, 0],
      });
      [1, -1].forEach(function (s2) {
        fin([grey, white, finTip], [0.64, 0.639, s2 * 0.276], {
          span: 0.84, chordRoot: 0.52, chordTip: 0.05, sweep: 0.66, concavity: 0.24,
          rearTipH: 0.09, rearTipBack: 0.18, apexRound: 0.05, thick: 0.075,
          spanSteps: 6, chordSteps: 4, under: true, tipDark: 0.78,
          spanDir: [-0.497, -0.200, s2 * 0.845], chordDir: [1, 0.06, s2 * 0.16],
        });
        fin([grey, white], [-0.52, 0.606, s2 * 0.137], {
          span: 0.30, chordRoot: 0.28, chordTip: 0.04, sweep: 0.55, concavity: 0.22,
          rearTipBack: 0.10, apexRound: 0.07, thick: 0.042, spanSteps: 4, chordSteps: 3,
          under: true, spanDir: [-0.160, -0.883, s2 * 0.441], chordDir: [1, 0, s2 * 0.1],
        });
        fin([grey], [-1.18, 0.879, s2 * 0.103], {
          span: 0.10, chordRoot: 0.36, chordTip: 0.09, sweep: 0.12, concavity: 0.05,
          rearTipH: 0.20, rearTipBack: 0.04, apexRound: 0.50, thick: 0.045,
          spanSteps: 3, chordSteps: 3, spanDir: [0, 0, s2], chordDir: [1, 0, 0],
        });
      });
      fin([grey], [-0.85, 0.631, 0], {
        span: 0.20, chordRoot: 0.21, chordTip: 0.03, sweep: 0.55, concavity: 0.25,
        rearTipBack: 0.10, apexRound: 0.08, thick: 0.035, spanSteps: 4, chordSteps: 3,
        spanDir: [0, -1, 0], chordDir: [1, 0, 0],
      });
      tailSleeve(g, [grey, white], BULL_RINGS, {
        at: [-1.58, 0.88], x0: -0.432, x1: 0.40, tipRy: 0.036, tipRz: 0.024,
        sides: 24, bellyCut: [-0.36, -0.34, -0.32, -0.30], ragged: 0.05, seed: 74,
      });
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
    // real mackerel school by the hundreds of thousands; game-scaled this is
    // "a proper swirling shoal", clearly smaller than a sardine ball
    herd: [12, 30], packs: 4, spd: 2.0, danger: 0, aquatic: true,
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
      tailSleeve(g, [back, belly], rings, {
        at: [-0.92, 0.50], x0: -0.472, x1: 0.1, tipRy: 0.015, tipRz: 0.0108,
        sides: 12, bellyCut: [-0.28], ragged: 0.04, seed: 82,
      });
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
    // the biggest school in this sea, always — surveyed sardine schools run
    // ~25 to millions; the RATIO to mackerel is what's kept here
    herd: [25, 70], spd: 2.3, danger: 0, aquatic: true,
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
      tailSleeve(g, [back, silver], rings, {
        at: [-0.66, 0.40], x0: -0.33, x1: 0.06, tipRy: 0.01, tipRz: 0.0076,
        sides: 10, bellyCut: [-0.24], ragged: 0.04, seed: 84,
      });
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
      tailSleeve(g, [back, belly], rings, {
        at: [-1.42, 0.78], x0: -0.588, x1: 0.14, tipRy: 0.0275, tipRz: 0.0162,
        sides: 14, bellyCut: [-0.30], ragged: 0.04, seed: 86,
      });
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
      tailSleeve(g, [back, belly], rings, {
        at: [-1.74, 0.88], x0: -0.646, x1: 0.16, tipRy: 0.0275, tipRz: 0.0162,
        sides: 14, bellyCut: [-0.32], ragged: 0.04, seed: 88,
      });
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
    meat: "Fish Fillet", meatValue: 14, herd: [1, 2], spd: 3.1, danger: 0.3,
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
      tailSleeve(g, [silver, belly], rings, {
        at: [-1.34, 0.55], x0: -0.472, x1: 0.1, tipRy: 0.0175, tipRz: 0.013,
        sides: 12, bellyCut: [-0.30], ragged: 0.04, seed: 92,
      });
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
    // transient pods run 2-7, residents 5-50; [3,8] is the game-scaled band
    // (wildlife_orca.js re-registers this species — keep its herd in step)
    herd: [3, 8], spd: 3.4, danger: 0.5, bite: 42, aquatic: true,
    scale: 1.55, color: 0x14171b, clearance: 110, swimDepth: 2.6,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const black = m(0x14171b), white = m(0xf4f6f6), saddle = m(0x4b545c), eye = m(0x06070a);
      // THE TAILSTOCK IS PART OF THE BODY CURVE. The first pair of numbers is
      // where the hull hands over to the tail sleeve, and while the sleeve was
      // free to be any size the hull was allowed to taper to a spindle there
      // and let a fatter cone start behind it. Welded, that spindle would be
      // the whole tailstock — so it carries the depth the cone used to fake,
      // laterally compressed the way a cetacean's peduncle actually is.
      const rings = bodyRings(-2.30, 3.20, 1.00,
        [0.40, 0.64, 0.82, 0.86, 0.80, 0.66, 0.42],      // [0] = the tail weld
        [0.24, 0.57, 0.74, 0.78, 0.72, 0.58, 0.34], 13);
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
      tailSleeve(g, [black, white], rings, {
        at: [-2.60, 1.00], x0: -1.026, x1: 0.3, tipRy: 0.10, tipRz: 0.062,
        sides: 14, bellyCut: [-0.42], ragged: 0.04, seed: 96,
      });
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
    // coastal bottlenose pods are 2-15; the old [4,8] max was capped by
    // marine_frenzy's bait test (herd max ≥ 10 + no teeth = bait), which now
    // also requires a small body, so a real pod no longer reads as a bait ball
    hp: 40, fur: "Dolphin Hide", furValue: 70, packs: 3, herd: [4, 12],
    spd: 3.0, danger: 0, aquatic: true, scale: 0.9, color: 0x5c6873,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const grey = m(0x5c6873), pale = m(0xd6dde1), eye = m(0x0d1013);
      const rings = bodyRings(-1.45, 2.10, 0.82,
        [0.21, 0.38, 0.46, 0.47, 0.42, 0.30, 0.14],      // [0] = the tail weld
        [0.115, 0.33, 0.41, 0.42, 0.37, 0.26, 0.12], 12);
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
      tailSleeve(g, [grey, pale], rings, {
        at: [-1.62, 0.82], x0: -0.6, x1: 0.18, tipRy: 0.045, tipRz: 0.034,
        sides: 12, bellyCut: [-0.40], ragged: 0.04, seed: 99,
      });
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
    meat: "Whale Meat", meatValue: 50, packs: 2, herd: [1, 2], spd: 1.6, danger: 0.1,
    aquatic: true, scale: 1.6, color: 0x2f3c45,
    build: function (ctx) {
      const m = ctx.mat, g = new T.Group();
      const dark = m(0x2f3c45), white = m(0xdae0e2), groove = m(0x232d34), knob = m(0x3c4952);
      const rings = bodyRings(-3.10, 3.70, 0.95,
        [0.46, 0.84, 1.02, 1.05, 1.00, 0.86, 0.55],      // [0] = the tail weld
        [0.27, 0.74, 0.94, 0.98, 0.94, 0.82, 0.50], 14);
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
      tailSleeve(g, [dark, white], rings, {
        at: [-3.45, 0.95], x0: -1.21, x1: 0.35, tipRy: 0.12, tipRz: 0.085,
        sides: 14, bellyCut: [-0.44], ragged: 0.04, seed: 102,
      });
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
