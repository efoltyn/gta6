/* ============================================================
   city/itemassets.js — EVERY ITEM IS A REAL OBJECT.

   OWNER (2026-07-28, verbatim): "Look how guns are a tiny actual gun in the
   icon but all other things in the icon are retarded. Fix the others — make
   them the exact same thing. We have so many assets built that can be shrunk
   for an icon, and if it isn't an asset that can be shrunk, why is it a thing
   that can be an icon? Make the asset then."

   He is describing a SPLIT, and the split is real. A gun in a slot is a
   photograph of the gun you actually carry — `weapon_thumbnails.js` boots one
   offscreen renderer, calls `CBZ.buildActorWeapon(id)` (the SAME wood-and-steel
   AK an NPC holds) and caches the PNG. Everything else in the bag was a 12x12
   hand-drawn pixel sprite. Two art forms in one grid, and the doodle loses.

   The second half of his sentence is the law and it is the reason this file
   exists rather than a bigger sprite sheet: **an item you can hold must be a
   thing that exists.** If the catalog can register it, the world must be able
   to draw it — in your hand, on the pavement where you dropped it, and in the
   slot. One model, three jobs. A pictogram can only ever do the third.

   SO: `CBZ.itemAsset(name, row, opts)` returns a real THREE object for ANY
   catalog row, and it is what `city/itemicons.js` photographs and what
   `city/inventory.js` drops on the ground. A dropped Boar Hide is a rolled
   hide lying on the pavement — not the BACKPACK every non-gun drop used to be.

   WHY KIND AND NOT NAME (the same reason itemicons.js classifies by kind):
   half this catalog is registered at RUNTIME — every pelt and every meat in
   wildlife.js, the fishing catch, roleverbs' produce, C4, the chest, ordnance.
   A name->model table can never cover those. So the registry is keyed on
   `CBZ.itemKind` — the ONE classifier, never a second one — and the species
   TINT parameterises the model rather than forking it. A polar bear's hide and
   a boar's hide are the same rolled bundle in two colours; adding a species to
   the bestiary tomorrow costs no row here and no row anywhere.

   REUSED vs AUTHORED. Reused, by calling the builder the world already runs:
   guns (`CBZ.buildActorWeapon`). Authored here, because nothing in the game
   had ever drawn them: the other ~50. Four models MOVED here out of
   `city/inventory.js` (chest · briefcase · backpack · melee) so the drop path
   and the icon path can never disagree about what a chest looks like — that
   file now delegates and keeps only a one-box degrade.

   AUTHORING CONVENTIONS, and they are what make the icons read as one family:
     • REAL METRES. An apple is 8 cm because an apple is 8 cm. The icon bake
       auto-frames, so honest scale costs the icon nothing and buys the ground
       pickup everything (`itemAssetPickup` lifts the tiny ones into a
       findable band rather than lying in the model).
     • BASE AT y = 0, centred on X. A pickup sits on the pavement; a chest
       stands where it is placed.
     • THE LONG AXIS RUNS ALONG Z. itemicons.js photographs from a fixed 3/4
       hero angle, and under that camera a Z-aligned rod lays itself across the
       frame's DIAGONAL — which is 1.41x the room a horizontal one gets. That
       is the whole reason a rifle still reads as a rifle in a square 30 px
       cell. `buildActorWeapon` already authors its barrel along Z, so the guns
       were obeying this convention before it was written down.
     • FEW PRIMITIVES, SHARED GEOMETRY. 3-8 boxes/cylinders each, every
       geometry cached and `_shared`, every material through `CBZ.cmat` (the
       repo's pooled Lambert). A drop is a fresh Group over shared buffers.

   Flag: this file authors no behaviour and needs none — `itemicons.js`'s
   `ITEM_ICONS_RENDERED` gates the icon side, and every consumer here is
   already written `CBZ.itemAsset ? ... : <old inline>`.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  // ============================================================
  //  1. THE KIT — cached geometry, pooled materials, terse placers.
  // ============================================================
  const GEO = new Map();
  function G(key, make) {
    let g = GEO.get(key);
    if (!g) { g = make(); g._shared = true; GEO.set(key, g); }
    return g;
  }
  function gBox(w, h, d) { return G("b" + w + "," + h + "," + d, function () { return new THREE.BoxGeometry(w, h, d); }); }
  function gCyl(rt, rb, h, seg, ts, tl) {
    seg = seg || 12;
    const s = ts || 0, l = tl == null ? Math.PI * 2 : tl;
    return G("c" + rt + "," + rb + "," + h + "," + seg + "," + s + "," + l,
      function () { return new THREE.CylinderGeometry(rt, rb, h, seg, 1, false, s, l); });
  }
  function gSph(r) { return G("s" + r, function () { return new THREE.SphereGeometry(r, 12, 9); }); }
  function gCon(r, h, seg) { seg = seg || 12; return G("n" + r + "," + h + "," + seg, function () { return new THREE.ConeGeometry(r, h, seg); }); }
  function gTor(r, t, seg) { seg = seg || 16; return G("t" + r + "," + t + "," + seg, function () { return new THREE.TorusGeometry(r, t, 6, seg); }); }
  function gOct(r) { return G("o" + r, function () { return new THREE.OctahedronGeometry(r); }); }
  function gDod(r) { return G("d" + r, function () { return new THREE.DodecahedronGeometry(r); }); }
  // A ROUNDED-CORNER SLAB lying flat on XZ, base at y=0: the one shape a card
  // needs (a CR80 card is a rectangle with 3 mm corner radii, and a square
  // corner is the thing that made the old "keycard" read as a tile).
  function gRRect(w, d, r, h) {
    return G("r" + w + "," + d + "," + r + "," + h, function () {
      const s = new THREE.Shape(), x0 = -w / 2, z0 = -d / 2;
      s.moveTo(x0 + r, z0);
      s.lineTo(x0 + w - r, z0); s.absarc(x0 + w - r, z0 + r, r, -Math.PI / 2, 0, false);
      s.lineTo(x0 + w, z0 + d - r); s.absarc(x0 + w - r, z0 + d - r, r, 0, Math.PI / 2, false);
      s.lineTo(x0 + r, z0 + d); s.absarc(x0 + r, z0 + d - r, r, Math.PI / 2, Math.PI, false);
      s.lineTo(x0, z0 + r); s.absarc(x0 + r, z0 + r, r, Math.PI, Math.PI * 1.5, false);
      const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 4 });
      // the shape is drawn in XY and extruded along +Z; lay it down so the
      // shape's Y becomes world Z and the extrusion becomes the thickness (+Y)
      geo.rotateX(Math.PI / 2);
      geo.translate(0, h, 0);
      return geo;
    });
  }

  // one material path, and it is the repo's pooled one (CLAUDE.md's raw-material
  // ratchet counts every construction that bypasses cmat — do not add to it).
  const FALLBACK_MAT = new Map();
  function M(hex, opts) {
    if (CBZ.cmat) return CBZ.cmat(hex, opts);
    let m = FALLBACK_MAT.get(hex);
    if (!m) { m = new THREE.MeshLambertMaterial({ color: hex }); m._shared = true; FALLBACK_MAT.set(hex, m); }
    return m;
  }

  function put(g, geom, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    g.add(m);
    return m;
  }
  function bx(g, mat, w, h, d, x, y, z, rx, ry, rz) { return put(g, gBox(w, h, d), mat, x, y, z, rx, ry, rz); }
  function cy(g, mat, rt, rb, h, x, y, z, rx, ry, rz, seg) { return put(g, gCyl(rt, rb, h, seg), mat, x, y, z, rx, ry, rz); }
  function wg(g, mat, r, h, ts, tl, x, y, z, rx, ry, rz) { return put(g, gCyl(r, r, h, 18, ts, tl), mat, x, y, z, rx, ry, rz); }
  function sh(g, mat, r, x, y, z, sx, sy, sz) {
    const m = put(g, gSph(r), mat, x, y, z);
    if (sx != null) m.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    return m;
  }
  function cn(g, mat, r, h, x, y, z, rx, ry, rz) { return put(g, gCon(r, h), mat, x, y, z, rx, ry, rz); }
  function to(g, mat, r, t, x, y, z, rx, ry, rz) { return put(g, gTor(r, t), mat, x, y, z, rx, ry, rz); }
  function oc(g, mat, r, x, y, z) { return put(g, gOct(r), mat, x, y, z); }

  // A CylinderGeometry's axis is Y. LZ lays it along Z (the long-axis rule);
  // LX lays it along X. Written once so no builder ever guesses the sign.
  const LZ = Math.PI / 2, LX = -Math.PI / 2, TAU = Math.PI * 2;

  // ---- colour arithmetic (the tint is the only thing a species changes) ----
  function cl(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
  function dk(h, k) { return (cl((h >> 16 & 255) * k) << 16) | (cl((h >> 8 & 255) * k) << 8) | cl((h & 255) * k); }
  function lt(h, t) {
    const r = h >> 16 & 255, g = h >> 8 & 255, b = h & 255;
    return (cl(r + (255 - r) * t) << 16) | (cl(g + (255 - g) * t) << 8) | cl(b + (255 - b) * t);
  }

  // Neutrals every builder shares, so a steel jaw and a steel blade are the
  // same steel and the bag reads as one workshop.
  const STEEL = 0x8e98a4, IRON = 0x5b636e, DARK = 0x1d222a, BONE = 0xe4ddc8,
        LEATH = 0x4a3423, BRASS = 0xc9a44a, GLASSY = 0x8ecbe8, PAPER = 0xd8d0ad,
        LEAF = 0x5f9b46, RED = 0xc03a30, OFFWHITE = 0xe8ebef, CARD = 0xb08a55;

  // ---- PAPER MONEY, at real size. One note is 156 x 66 mm; a hundred of
  // them is 11 mm thick. A note is pale grey-green paper with DARKER green
  // print (border, corner numerals, the portrait oval) — the contrast between
  // the pale paper edge and the printed face is the whole read at 5 m.
  const BILL_W = 0.066, BILL_L = 0.156;
  const BILL = { edge: 0xd3d7c4, face: 0xa3b193, print: 0x55684b, portrait: 0x6e7c62,
                 strapA: 0xc9a23a, strapB: 0x7b5a9e };           // $10k mustard, $2k violet straps
  // a dye pack went off in the bag: the same notes, soaked red
  const BILL_DYED = { edge: 0xc79a92, face: 0xa56a62, print: 0x6a2c28, portrait: 0x80403a,
                      strapA: 0x9a5a3a, strapB: 0x6a3a5a };
  function billPrint(p, y, len, pal) {                // the printed face of a note whose paper top is at y
    pal = pal || BILL;
    const pr = M(pal.print), yy = y + 0.00015, L = len || BILL_L;
    bx(p, pr, 0.0030, 0.0003, L - 0.014, 0.0265, yy, 0);
    bx(p, pr, 0.0030, 0.0003, L - 0.014, -0.0265, yy, 0);
    bx(p, pr, BILL_W - 0.014, 0.0003, 0.0030, 0, yy, L / 2 - 0.0065);
    bx(p, pr, BILL_W - 0.014, 0.0003, 0.0030, 0, yy, -(L / 2 - 0.0065));
    if (L > 0.1) {
      const o = put(p, gCyl(0.0145, 0.0145, 0.0003, 14), M(pal.portrait), 0, yy, 0.012);
      o.scale.set(1.25, 1, 1);
      bx(p, pr, 0.010, 0.0003, 0.012, 0.018, yy, -0.056);
      bx(p, pr, 0.010, 0.0003, 0.012, -0.018, yy, 0.058);
    }
  }
  // a strapped stack; returns its height
  function billStack(g, x, y, z, ry, bills, strapKind, pal) {
    pal = pal || BILL;
    const s = new THREE.Group();
    s.position.set(x, y, z); s.rotation.y = ry || 0; g.add(s);
    const t = Math.max(0.003, bills * 0.00011);
    bx(s, M(pal.edge), BILL_W, t, BILL_L, 0, t / 2, 0);
    bx(s, M(pal.face), BILL_W - 0.002, 0.0004, BILL_L - 0.002, 0, t + 0.0002, 0);
    billPrint(s, t + 0.0004, 0, pal);
    bx(s, M(strapKind ? pal.strapB : pal.strapA), BILL_W + 0.0016, t + 0.0016, 0.038, 0, (t + 0.0016) / 2, 0);
    return t + 0.0016;
  }
  // one loose note, one end curling up off whatever it lies on
  function looseBill(g, x, y, z, ry) {
    const s = new THREE.Group();
    s.position.set(x, y + 0.003, z); s.rotation.y = ry || 0; g.add(s);
    const c = new THREE.Group(); c.rotation.x = -0.035; s.add(c);
    bx(c, M(BILL.face), BILL_W, 0.0004, BILL_L, 0, 0.0002, 0);
    billPrint(c, 0.0004);
  }
  // a folded wad: a few notes doubled over, the fold edge rounded, the top
  // leaf springing open a few millimetres the way folded paper does
  function billFold(g, x, y, z, ry) {
    const s = new THREE.Group();
    s.position.set(x, y, z); s.rotation.y = ry || 0; g.add(s);
    const H = BILL_L / 2;
    bx(s, M(BILL.edge), BILL_W, 0.005, H, 0, 0.0025, 0);
    put(s, gCyl(0.0028, 0.0028, BILL_W, 8), M(BILL.face), 0, 0.0028, -H / 2, 0, 0, Math.PI / 2);
    const leaf = new THREE.Group();
    leaf.position.set(0, 0.0052, -H / 2); leaf.rotation.x = -0.06; s.add(leaf);
    bx(leaf, M(BILL.face), BILL_W, 0.0005, H, 0, 0.00025, H / 2);
    const lp = new THREE.Group(); lp.position.z = H / 2; leaf.add(lp);
    billPrint(lp, 0.0005, H);
  }

  // ============================================================
  //  2. THE TONE KIT — itemicons.js already solved "what colour is this
  //  thing", including the per-species pelt tint and the flesh ladder. It is
  //  read, never re-derived: two tables that disagree about what a boar is
  //  would put a brown hide in the bag and a grey one on the pavement.
  // ============================================================
  const DEFAULT_TONE = [0xb59a72, 0x8a6a3a, 0x5c4a2c];
  function kitFor(name, row) {
    let t = null;
    if (CBZ.itemTone) { try { t = CBZ.itemTone(name, row); } catch (e) { t = null; } }
    if (!t || t.length < 3) t = DEFAULT_TONE;
    const A = t[0], D = t[1], F = t[2];
    return {
      A: A, D: D, F: F,
      mA: M(A), mD: M(D), mF: M(F),
      mL: M(lt(A, 0.30)), mS: M(dk(A, 0.62)),        // base lit / base shaded
      mDL: M(lt(D, 0.28)), mDS: M(dk(D, 0.62)),      // accent lit / shaded
      m: M, lt: lt, dk: dk,
    };
  }

  // ============================================================
  //  3. THE ROSTER. One builder per KIND — `CBZ.itemKind`'s whole vocabulary,
  //  which is what makes `assetless` structurally 0 instead of aspirationally
  //  0. A kind may serve a hundred names; a name never gets its own row.
  // ============================================================
  const BUILD = {

    // ---- the hunt pays ---------------------------------------------------
    // A bone-in cut. The KNUCKLE is what says meat and not "a red blob" — it
    // is the one feature a 30 px silhouette can still resolve.
    meat: function (g, C) {
      const mb = M(BONE);
      cy(g, mb, 0.016, 0.016, 0.25, 0, 0.062, 0, LZ);
      sh(g, mb, 0.030, 0, 0.062, 0.118, 1, 0.85, 0.85);
      sh(g, mb, 0.028, 0, 0.062, -0.118, 1, 0.85, 0.85);
      sh(g, C.mA, 0.075, 0, 0.062, 0.005, 1.0, 0.82, 1.42);
      sh(g, C.mS, 0.052, 0.012, 0.048, -0.055, 1.0, 0.72, 1.10);
      bx(g, C.mDL, 0.086, 0.006, 0.030, 0, 0.106, 0.02, 0, 0.28, 0.06);  // fat cap
    },
    // A boneless slab. The CUT STRIATIONS are the whole idea — colour alone
    // would just be "a pink box".
    fillet: function (g, C) {
      bx(g, C.mA, 0.130, 0.030, 0.200, 0, 0.016, 0, 0.05, 0, 0);
      bx(g, C.mS, 0.120, 0.010, 0.185, 0, 0.003, 0, 0.05, 0, 0);
      for (let i = -1; i <= 1; i++) bx(g, C.mDL, 0.112, 0.004, 0.012, 0, 0.033, i * 0.052, 0.05, 0, 0);
      bx(g, C.mDL, 0.020, 0.007, 0.190, 0.055, 0.032, 0, 0.05, 0, 0);        // fat edge
    },
    // Nose at +Z, forked tail at -Z, one dark eye. A fish is read by its tail —
    // and a tail is VERTICAL, which is a statement about which local axis gets
    // squashed: after LZ the cone's local X is world X, so `scale.x` is the one
    // that flattens it into a fin instead of a fluke.
    fish: function (g, C) {
      sh(g, C.mA, 0.075, 0, 0.072, 0.010, 0.72, 1.0, 2.15);
      sh(g, C.mL, 0.055, 0, 0.052, 0.030, 0.62, 0.72, 1.75);                 // pale belly
      cn(g, C.mA, 0.052, 0.090, 0, 0.078, 0.180, LZ, 0, 0);                  // snout, apex +Z
      cn(g, C.mF, 0.062, 0.085, 0, 0.078, -0.185, LZ, 0, 0).scale.set(0.20, 1, 1);
      cn(g, C.mF, 0.045, 0.055, 0, 0.128, -0.030, 0, 0, 0).scale.set(0.20, 1, 1.35); // dorsal
      cn(g, C.mF, 0.030, 0.040, 0.038, 0.048, 0.030, 0, 0, -0.6).scale.set(0.22, 1, 1);
      sh(g, M(DARK), 0.012, 0.040, 0.098, 0.150);
      sh(g, M(DARK), 0.012, -0.040, 0.098, 0.150);
    },
    // A hide is not a flat cutout — a skinned hide gets ROLLED and tied, which
    // is also the only shape that survives being 30 px wide.
    pelt: function (g, C) {
      cy(g, C.mA, 0.085, 0.085, 0.50, 0, 0.085, 0, LZ);
      cy(g, C.mL, 0.083, 0.083, 0.012, 0, 0.085, 0.252, LZ);                 // pale inner face
      cy(g, C.mL, 0.083, 0.083, 0.012, 0, 0.085, -0.252, LZ);
      to(g, M(LEATH), 0.089, 0.010, 0, 0.085, 0.135);                        // the ties
      to(g, M(LEATH), 0.089, 0.010, 0, 0.085, -0.135);
      bx(g, C.mS, 0.030, 0.020, 0.44, 0.070, 0.140, 0, 0, 0, 0.35);          // rolled seam
    },
    // A quill and two vanes. Every cone points its apex at +Z so the vanes are
    // widest at the QUILL and taper to the tip, which is the way round a real
    // feather goes; after LZ the cone's local Z is world Y, so `scale.z` is what
    // flattens it into a vane.
    feather: function (g, C) {
      cy(g, C.mF, 0.0022, 0.0055, 0.220, 0, 0.008, 0.010, LZ);
      cn(g, C.mA, 0.048, 0.170, -0.020, 0.010, -0.010, LZ, 0, 0.10).scale.set(1, 1, 0.14);
      cn(g, C.mL, 0.044, 0.160, 0.020, 0.010, -0.005, LZ, 0, -0.10).scale.set(1, 1, 0.14);
      cn(g, C.mF, 0.010, 0.030, 0, 0.008, 0.118, LZ, 0, 0);   // tip, apex +Z
    },
    // A dorsal fin: chord fore-aft along Z, thin ACROSS the body in X, swept back.
    fin: function (g, C) {
      cn(g, C.mA, 0.095, 0.190, 0, 0.098, -0.012, -0.36, 0, 0).scale.set(0.22, 1, 1.15);
      cn(g, C.mL, 0.070, 0.140, 0, 0.078, -0.004, -0.36, 0, 0).scale.set(0.14, 1, 1.10);
      bx(g, C.mF, 0.028, 0.020, 0.090, 0, 0.010, 0.010);
    },
    tooth: function (g, C) {
      cn(g, C.mL, 0.023, 0.105, 0, 0.078, 0.012, 0.22, 0, 0);
      cy(g, C.mA, 0.021, 0.025, 0.048, 0, 0.024, 0, 0.22, 0, 0);
      bx(g, C.mF, 0.006, 0.004, 0.030, 0.010, 0.070, 0.020, 0.22, 0, 0);     // enamel crack
    },
    bone: function (g, C) {
      const m = M(BONE), s = M(dk(BONE, 0.80));
      cy(g, m, 0.019, 0.019, 0.235, 0, 0.030, 0, LZ);
      sh(g, m, 0.030, 0.021, 0.030, 0.118); sh(g, s, 0.028, -0.021, 0.030, 0.118);
      sh(g, m, 0.030, 0.021, 0.030, -0.118); sh(g, s, 0.028, -0.021, 0.030, -0.118);
    },

    // ---- food you buy ----------------------------------------------------
    meal: function (g, C) {                                   // the burger
      cy(g, C.mA, 0.056, 0.052, 0.024, 0, 0.012, 0);
      cy(g, C.mD, 0.058, 0.058, 0.022, 0, 0.033, 0);          // patty
      cy(g, M(LEAF), 0.064, 0.064, 0.009, 0, 0.048, 0);       // lettuce
      bx(g, M(0xe0a83a), 0.098, 0.005, 0.098, 0, 0.055, 0, 0, 0.42, 0);  // cheese
      sh(g, C.mA, 0.058, 0, 0.058, 0, 1, 0.62, 1);            // crown
      sh(g, C.mL, 0.008, 0.020, 0.086, 0.016); sh(g, C.mL, 0.008, -0.018, 0.088, -0.012);
    },
    pizza: function (g, C) {                                  // one slice, apex at origin
      wg(g, C.mF, 0.170, 0.011, -0.44, 0.88, 0, 0.006, 0);    // base + crust
      wg(g, C.mA, 0.152, 0.009, -0.42, 0.84, 0, 0.015, 0);    // cheese
      wg(g, C.mD, 0.020, 0.005, 0, TAU, 0.030, 0.021, 0.075);
      wg(g, C.mD, 0.020, 0.005, 0, TAU, -0.034, 0.021, 0.090);
      wg(g, C.mD, 0.018, 0.005, 0, TAU, 0.004, 0.021, 0.132);
    },
    fries: function (g, C) {
      cy(g, C.mA, 0.056, 0.038, 0.120, 0, 0.060, 0, 0, Math.PI / 4, 0, 4);
      bx(g, C.mDL, 0.070, 0.024, 0.070, 0, 0.098, 0, 0, Math.PI / 4, 0);     // fold band
      const fry = M(0xe0b455);
      const at = [[-0.020, 0.145, 0.010, 0.12], [0.014, 0.152, -0.012, -0.10],
                  [0.002, 0.160, 0.022, 0.04], [0.026, 0.140, 0.016, -0.16], [-0.026, 0.138, -0.018, 0.18]];
      for (let i = 0; i < at.length; i++) bx(g, fry, 0.013, 0.090, 0.013, at[i][0], at[i][1], at[i][2], at[i][3], 0, at[i][3] * 0.6);
    },
    drink: function (g, C) {
      cy(g, C.mA, 0.042, 0.031, 0.140, 0, 0.070, 0);
      cy(g, C.mD, 0.0435, 0.0365, 0.044, 0, 0.062, 0);        // printed band
      cy(g, C.mDS, 0.046, 0.046, 0.013, 0, 0.146, 0);         // lid
      cy(g, M(OFFWHITE), 0.0065, 0.0065, 0.095, 0.014, 0.195, 0, 0, 0, 0.30);
    },
    bread: function (g, C) {
      sh(g, C.mA, 0.070, 0, 0.056, 0, 0.94, 0.86, 1.95);
      sh(g, C.mL, 0.050, 0, 0.086, 0, 0.86, 0.42, 1.60);      // floured crown
      for (let i = -1; i <= 1; i++) bx(g, C.mF, 0.062, 0.006, 0.014, 0, 0.104, i * 0.048, 0, 0.34, 0);
    },
    can: function (g, C) {
      cy(g, M(STEEL), 0.033, 0.033, 0.118, 0, 0.059, 0);
      cy(g, C.mD, 0.0338, 0.0338, 0.062, 0, 0.056, 0);        // label
      cy(g, C.mA, 0.0344, 0.0344, 0.014, 0, 0.056, 0);        // brand band
      cy(g, M(lt(STEEL, 0.28)), 0.030, 0.030, 0.008, 0, 0.121, 0);
      cy(g, M(lt(STEEL, 0.28)), 0.030, 0.030, 0.008, 0, -0.003, 0);
    },
    produce: function (g, C) {                                // the apple
      sh(g, C.mA, 0.042, 0, 0.041, 0, 1, 0.94, 1);
      sh(g, C.mS, 0.030, -0.016, 0.036, -0.014, 1, 0.86, 1);
      cy(g, C.mF, 0.0042, 0.0055, 0.030, 0.004, 0.088, 0, 0.18, 0, 0.22);
      bx(g, M(LEAF), 0.024, 0.0035, 0.014, 0.020, 0.088, 0.004, 0, 0.5, 0.25);
    },

    // ---- product ---------------------------------------------------------
    // Product is packaged the way product is actually packaged, and the NAME
    // picks the package: weed is a zip baggie of buds, crystal is a baggie
    // of shards, everything else (coke, heroin, "brick") is a kilo brick in
    // layered brown packing tape with a crew's stamp. The old one-size white
    // slab with a tape cross read as a bar of soap.
    drug: function (g, C, name) {
      const n = String(name || "").toLowerCase();
      if (/weed|kush|bud|marijuana|cannabis|ganja|joint|haze/.test(n)) {
        // a quarter-ounce zip bag lying flat, buds pushing the plastic up
        const bag = M(0xdfe5e2), seal = M(0x3b62a8);
        const b1 = M(0x5e7a2e), b2 = M(0x72903a), b3 = M(0x4c6426), hair = M(0xb4763a);
        bx(g, bag, 0.100, 0.006, 0.140, 0, 0.003, 0);
        bx(g, seal, 0.101, 0.004, 0.006, 0, 0.004, 0.058);           // the zip track
        bx(g, bag, 0.101, 0.002, 0.016, 0, 0.002, 0.066);            // lip above the zip
        const at = [[-0.022, 0.018, -0.030, 1.0, b1], [0.020, 0.016, -0.004, 0.9, b2],
                    [-0.010, 0.015, 0.026, 0.85, b3], [0.026, 0.014, -0.040, 0.75, b1],
                    [-0.028, 0.013, 0.004, 0.7, b2]];
        for (let i = 0; i < at.length; i++) {
          const d = put(g, gDod(0.024), at[i][4], at[i][0], at[i][1] * 0.8 + 0.008, at[i][2]);
          d.scale.set(at[i][3], at[i][3] * 0.62, at[i][3] * 1.25); d.rotation.set(0.4 * i, 0.9 * i, 0.2);
        }
        sh(g, hair, 0.004, -0.018, 0.024, -0.024); sh(g, hair, 0.004, 0.022, 0.021, 0.0);
        return;
      }
      if (/meth|crystal|\bice\b|shard|crank/.test(n)) {
        const bag = M(0xdfe5e2), seal = M(0xb03a32), xtal = M(0xe8f2f7), xtal2 = M(0xc8dde8);
        bx(g, bag, 0.070, 0.005, 0.095, 0, 0.0025, 0);
        bx(g, seal, 0.071, 0.004, 0.005, 0, 0.0035, 0.038);
        const at = [[-0.012, -0.012, 0.012], [0.010, -0.018, 0.010], [0.000, 0.004, 0.013],
                    [-0.016, 0.014, 0.009], [0.014, 0.012, 0.011], [0.004, -0.030, 0.008]];
        for (let i = 0; i < at.length; i++) {
          const o = put(g, gOct(at[i][2]), i % 2 ? xtal : xtal2, at[i][0], 0.006 + at[i][2] * 0.35, at[i][1]);
          o.scale.set(0.8, 0.5, 1.3); o.rotation.set(0.3 * i, 1.1 * i, 0);
        }
        return;
      }
      // THE KILO BRICK. ~12 x 4.5 x 19 cm, wrapped in overlapping bands of tan
      // packing tape laid at angles (the uneven layering is what says "taped
      // by hand" and not "a box"), a pressed crew stamp on the face.
      const tape = M(0xb99a62), tapeD = M(0xa4854f), tapeL = M(0xcdb483), stamp = M(0x7c2420);
      bx(g, tape, 0.120, 0.045, 0.190, 0, 0.0225, 0);
      bx(g, tapeD, 0.122, 0.047, 0.050, 0, 0.0225, -0.058, 0, 0.06, 0);   // tape bands wrapped round
      bx(g, tapeL, 0.122, 0.047, 0.046, 0, 0.0225, 0.022, 0, -0.10, 0);
      bx(g, tapeD, 0.122, 0.047, 0.040, 0, 0.0225, 0.074, 0, 0.12, 0);
      bx(g, tapeL, 0.050, 0.047, 0.192, 0.028, 0.0225, 0, 0, 0.04, 0);     // one run lengthwise
      bx(g, stamp, 0.040, 0.0015, 0.040, -0.024, 0.0475, -0.012, 0, 0.3, 0); // the stamp
    },
    pill: function (g, C) {                                   // the bottle
      cy(g, C.mA, 0.026, 0.026, 0.072, 0, 0.036, 0);
      cy(g, M(OFFWHITE), 0.0266, 0.0266, 0.038, 0, 0.032, 0); // label
      cy(g, C.mD, 0.028, 0.028, 0.018, 0, 0.080, 0);          // childproof cap
      cy(g, C.mD, 0.009, 0.009, 0.006, 0.040, 0.003, 0.016);          // two spilled tablets,
      cy(g, C.mDL, 0.009, 0.009, 0.006, 0.052, 0.003, -0.010);        // lying flat
    },

    // ---- arms ------------------------------------------------------------
    // REUSED: the exact model the player and every armed NPC carries.
    // buildActorWeapon ships a HAND-MOUNT transform (rot pi/2, pi — the barrel
    // lying along a forearm); the appearance underneath is authored along the
    // ground plane with its barrel down -Z, which is this file's long-axis
    // convention already. Unmount it and it is a gun on a table.
    gun: function (g, C, name, row) {
      let model = null;
      const id = (row && row.gun) || name || "sidearm";
      if (CBZ.buildActorWeapon) { try { model = CBZ.buildActorWeapon(id); } catch (e) { model = null; } }
      if (!model) {
        bx(g, M(IRON), 0.055, 0.048, 0.240, 0, 0.088, -0.070);
        bx(g, M(DARK), 0.048, 0.105, 0.055, 0, 0.040, 0.040, -0.20, 0, 0);
        cy(g, M(DARK), 0.010, 0.010, 0.090, 0, 0.100, -0.215, LZ);
        return;
      }
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      // REAL-DIMENSION SIZING (weapons/weapon-scale.js): pavement drops are
      // world space, so the world scalar applies directly. The compact-class
      // READ boost inside the module is the same "a pistol on a pavement is
      // missed" rule the old 1.2 nudge encoded; that nudge stays as the
      // module-absent fallback.
      model.scale.setScalar(
        (CBZ.weaponWorldScale && CBZ.weaponWorldScale(model.userData.weaponId || id)) ||
        (model.userData && model.userData.weaponSlot === "pistol" ? 1.2 : 1.0)
      );
      g.add(model);
      // seat it on its own lowest point so a dropped gun lies ON the ground
      const b = new THREE.Box3().setFromObject(model);
      if (isFinite(b.min.y)) model.position.y = -b.min.y;
    },
    // MOVED here out of city/inventory.js. The four silhouettes a melee name
    // can mean; the name picks one, and nothing else in the game has to know.
    melee: function (g, C, name) {
      const n = String(name || "").toLowerCase();
      const steel = M(STEEL), edge = M(lt(STEEL, 0.42)), grip = M(LEATH), wood = M(0x7a4d2a);
      // A knife and a pick TAPER TO A POINT, so they are cones with the apex at
      // +Z. An AXE DOES THE OPPOSITE — the bit flares OUT toward the edge — so a
      // cone would draw a spike on a stick. It is three boxes instead, and that
      // difference is the whole reason this branch is not one shape with three
      // tints.
      if (/hatchet|\baxe\b/.test(n)) {
        cy(g, wood, 0.014, 0.017, 0.400, 0, 0.020, -0.040, LZ);
        bx(g, steel, 0.028, 0.072, 0.060, 0, 0.030, 0.168);     // eye + poll
        bx(g, steel, 0.017, 0.116, 0.072, 0, 0.030, 0.228);     // the flaring bit
        bx(g, edge, 0.006, 0.128, 0.018, 0, 0.030, 0.268);      // the edge itself
        bx(g, grip, 0.017, 0.020, 0.090, 0, 0.020, -0.200);
      } else if (/pickaxe|\bpick\b/.test(n)) {
        cy(g, wood, 0.015, 0.018, 0.430, 0, 0.026, -0.030, LZ);
        cn(g, steel, 0.022, 0.170, 0.086, 0.040, 0.150, 0, 0, LX);
        cn(g, steel, 0.022, 0.170, -0.086, 0.040, 0.150, 0, 0, -LX);
        bx(g, steel, 0.030, 0.036, 0.034, 0, 0.040, 0.150);
        bx(g, grip, 0.018, 0.021, 0.100, 0, 0.026, -0.190);
      } else if (/knife|shiv|blade|machete|cleaver|razor|hacksaw/.test(n)) {
        bx(g, steel, 0.030, 0.007, 0.185, 0, 0.010, 0.075, 0, 0, 0.03);
        cn(g, edge, 0.021, 0.055, 0, 0.010, 0.192, LZ, 0, 0).scale.set(0.72, 1, 0.17);
        bx(g, grip, 0.026, 0.024, 0.098, 0, 0.010, -0.055);
        bx(g, M(DARK), 0.040, 0.012, 0.012, 0, 0.010, -0.002);   // guard
      } else {
        cy(g, /bat/.test(n) ? wood : steel, 0.034, 0.017, 0.640, 0, 0.034, 0.050, LZ);
        cy(g, grip, 0.021, 0.021, 0.150, 0, 0.034, -0.320, LZ);
        cy(g, M(DARK), 0.023, 0.023, 0.014, 0, 0.034, -0.398, LZ);
      }
    },
    ammo: function (g, C) {
      bx(g, C.mA, 0.140, 0.070, 0.096, 0, 0.035, 0);
      bx(g, C.mS, 0.142, 0.010, 0.098, 0, 0.062, 0);          // lid lip
      bx(g, C.mDL, 0.070, 0.003, 0.034, 0, 0.071, 0.014);     // stencil
      const br = M(BRASS), tip = M(dk(BRASS, 0.70));
      for (let i = -1; i <= 1; i++) {
        cy(g, br, 0.0085, 0.0085, 0.046, i * 0.024, 0.093, -0.032);
        cn(g, tip, 0.0085, 0.017, i * 0.024, 0.124, -0.032);
      }
    },
    grenade: function (g, C) {
      sh(g, C.mA, 0.043, 0, 0.052, 0, 1, 1.18, 1);
      bx(g, C.mS, 0.088, 0.006, 0.088, 0, 0.052, 0);          // fragmentation band
      cy(g, C.mF, 0.015, 0.017, 0.022, 0, 0.104, 0);          // fuze
      bx(g, C.mD, 0.010, 0.058, 0.009, 0.041, 0.076, 0, 0, 0, -0.10);  // spoon
      to(g, C.mDL, 0.014, 0.0035, 0.050, 0.108, 0, 0, LZ, 0);          // pin ring
    },
    bomb: function (g, C) {                                   // C4 / demolition charge
      bx(g, C.mA, 0.145, 0.055, 0.090, 0, 0.028, 0);
      bx(g, C.mS, 0.148, 0.014, 0.093, 0, 0.010, 0);
      bx(g, C.mF, 0.150, 0.058, 0.018, 0, 0.028, 0.025);      // taped band
      cy(g, M(STEEL), 0.009, 0.009, 0.048, -0.030, 0.078, 0);  // detonator
      cy(g, M(RED), 0.0035, 0.0035, 0.060, -0.010, 0.098, 0.014, 0.5, 0, 0.9);
      cy(g, M(DARK), 0.0035, 0.0035, 0.060, -0.048, 0.096, -0.012, -0.4, 0, -0.8);
      bx(g, M(0x2f3a2a), 0.036, 0.010, 0.024, 0.048, 0.062, 0);         // arming plate
    },

    // ---- kit -------------------------------------------------------------
    // A ROLL OF GAUZE lying on its side: the wound cloth, the cardboard core
    // showing at both ends, and the loose end unrolled across the table.
    bandage: function (g, C) {
      cy(g, C.mA, 0.046, 0.046, 0.072, 0, 0.046, 0, 0, 0, LZ * -1, 20);   // the roll
      cy(g, C.mD, 0.048, 0.048, 0.010, 0.018, 0.046, 0, 0, 0, LZ * -1, 20); // an outer turn, a shade darker
      cy(g, C.mF, 0.017, 0.017, 0.074, 0, 0.046, 0, 0, 0, LZ * -1, 12);   // the core
      bx(g, C.mA, 0.068, 0.003, 0.098, 0, 0.0015, 0.070);                // the loose end, flat on the table
      bx(g, C.mD, 0.068, 0.004, 0.012, 0, 0.003, 0.118);                 // its frayed edge
    },
    medkit: function (g, C) {
      bx(g, C.mA, 0.150, 0.096, 0.110, 0, 0.048, 0);
      bx(g, C.mS, 0.153, 0.008, 0.113, 0, 0.070, 0);          // clamshell seam
      bx(g, C.mD, 0.068, 0.005, 0.020, 0, 0.098, 0);          // the cross, on the lid
      bx(g, C.mD, 0.020, 0.005, 0.068, 0, 0.098, 0);
      bx(g, C.mF, 0.046, 0.009, 0.012, 0, 0.104, -0.038);     // handle
      bx(g, M(STEEL), 0.016, 0.014, 0.008, 0.052, 0.070, 0.056);
      bx(g, M(STEEL), 0.016, 0.014, 0.008, -0.052, 0.070, 0.056);
    },
    armor: function (g, C) {                                  // plate carrier
      bx(g, C.mA, 0.200, 0.230, 0.058, 0, 0.150, 0);
      bx(g, C.mS, 0.210, 0.060, 0.064, 0, 0.062, 0);          // cummerbund
      bx(g, C.mD, 0.062, 0.058, 0.034, -0.052, 0.128, 0.042); // mag pouches
      bx(g, C.mD, 0.062, 0.058, 0.034, 0.052, 0.128, 0.042);
      bx(g, C.mDS, 0.040, 0.100, 0.048, -0.078, 0.290, 0, 0, 0, 0.22);  // shoulder straps
      bx(g, C.mDS, 0.040, 0.100, 0.048, 0.078, 0.290, 0, 0, 0, -0.22);
      bx(g, C.mS, 0.120, 0.026, 0.052, 0, 0.268, 0);          // collar yoke
    },
    tool: function (g, C) {                                   // the wrench
      const s = M(STEEL);
      bx(g, s, 0.022, 0.013, 0.190, 0, 0.008, 0);
      bx(g, s, 0.052, 0.014, 0.040, 0, 0.008, 0.108);         // open head
      bx(g, C.mD, 0.016, 0.016, 0.030, -0.018, 0.008, 0.116);
      to(g, s, 0.027, 0.011, 0, 0.008, -0.108, LZ, 0, 0);     // ring end
      bx(g, C.mDS, 0.024, 0.015, 0.060, 0, 0.008, -0.020);    // grip wrap
    },
    crowbar: function (g, C) {
      cy(g, C.mA, 0.011, 0.011, 0.480, 0, 0.014, -0.040, LZ);
      cy(g, C.mA, 0.011, 0.011, 0.110, 0, 0.045, 0.230, LZ - 0.85);
      bx(g, C.mL, 0.030, 0.009, 0.040, 0, 0.078, 0.272, -0.85, 0, 0);   // chisel claw
      bx(g, C.mL, 0.026, 0.009, 0.048, 0, 0.014, -0.294, 0.16, 0, 0);   // flattened heel
    },
    pick: function (g, C) {                                   // a lockpick fold
      bx(g, M(LEATH), 0.076, 0.011, 0.112, 0, 0.006, 0);
      bx(g, M(dk(LEATH, 0.72)), 0.078, 0.004, 0.030, 0, 0.013, -0.040);
      const s = M(lt(STEEL, 0.30));
      for (let i = -1; i <= 1; i++) {
        bx(g, s, 0.0035, 0.0022, 0.130, i * 0.020, 0.014, 0.020);
        bx(g, s, 0.0035, 0.0022, 0.014, i * 0.020, 0.014, 0.088, 0, i * 0.5, 0);
      }
    },
    // A KEY IS A BUNCH OF KEYS ON A RING, lying flat: a steel split ring, two
    // cut keys fanned off it (a brass one and a nickel one, bow + blade +
    // bitting notches), and a leather fob. The old one was a rod through a
    // doughnut hovering 3 mm under its own origin.
    key: function (g, C) {
      const ringM = M(0x9aa2aa), nickel = M(0xb9bec4), leather = M(0x4a2f1e);
      to(g, ringM, 0.014, 0.0014, 0, 0.0016, 0, LZ, 0, 0);            // the split ring, flat
      const keyAt = [[C.mA, 0.35], [nickel, -0.55]];
      for (let k = 0; k < keyAt.length; k++) {
        const kg = new THREE.Group();
        kg.rotation.y = keyAt[k][1];
        g.add(kg);
        const m = keyAt[k][0];
        cy(kg, m, 0.012, 0.012, 0.0022, 0, 0.0011, 0.024);              // the bow
        cy(kg, M(DARK), 0.0032, 0.0032, 0.0024, 0, 0.0012, 0.017);       // the hole the ring runs through
        bx(kg, m, 0.0085, 0.0020, 0.046, 0, 0.0010, 0.058);             // the blade
        bx(kg, m, 0.0100, 0.0022, 0.004, 0, 0.0011, 0.036);             // the shoulder
        for (let i = 0; i < 4; i++) {
          bx(kg, m, 0.0030, 0.0020, 0.0045, 0.0055, 0.0010, 0.044 + i * 0.009 + (i % 2) * 0.002);  // bitting teeth
        }
      }
      // the leather fob hanging off the other side of the ring
      bx(g, leather, 0.020, 0.0035, 0.050, 0, 0.00175, -0.042, 0, 0.12, 0);
      cy(g, M(BRASS), 0.0045, 0.0045, 0.004, 0.0015, 0.002, -0.020);    // its rivet/snap
    },
    // A KEYCARD: a CR80 card (85.6 x 54 mm, rounded corners) face-up, the
    // issuer's colour stripe across the top, a head-and-shoulders PHOTO, two
    // printed lines, the gold contact chip — clipped to a badge reel and a
    // lanyard lying in a loose loop. Every one of those is a thing a real
    // access card has; together they are what make it read as "somebody's
    // pass" and not "a white tile".
    keycard: function (g, C) {
      const white = M(0xf1f1ec), stripe = C.mD, stripeD = C.mF;
      const skin = M(0xc49a74), hair = M(0x2e241e), shirt = M(0x3d4a5c), photoBg = M(0xb9c4cf);
      const ink = M(0x5a6068), chip = M(0xc9a44a), chipD = M(0x8a6c22);
      const T = 0.0012;                                                   // card thickness (a real one is 0.76 mm)
      put(g, gRRect(0.054, 0.0856, 0.003, T), white, 0, 0, 0);
      bx(g, stripe, 0.0536, 0.0004, 0.017, 0, T + 0.0002, 0.0336);        // issuer stripe across the top
      bx(g, photoBg, 0.019, 0.0004, 0.024, -0.0135, T + 0.0002, 0.0060);  // photo
      bx(g, shirt, 0.017, 0.0003, 0.007, -0.0135, T + 0.0005, -0.0020);
      bx(g, skin, 0.008, 0.0003, 0.010, -0.0135, T + 0.0005, 0.0065);
      bx(g, hair, 0.009, 0.0003, 0.004, -0.0135, T + 0.0006, 0.0128);
      bx(g, ink, 0.020, 0.0003, 0.0025, 0.012, T + 0.0002, 0.0100);        // name line
      bx(g, ink, 0.014, 0.0003, 0.0020, 0.009, T + 0.0002, 0.0050);        // title line
      bx(g, stripeD, 0.040, 0.0003, 0.0030, 0, T + 0.0002, -0.0330);       // number band at the foot
      bx(g, chip, 0.0110, 0.0005, 0.0090, 0.0125, T + 0.0002, -0.0110);    // the contact chip
      bx(g, chipD, 0.0110, 0.0002, 0.0008, 0.0125, T + 0.0005, -0.0110);
      bx(g, chipD, 0.0008, 0.0002, 0.0090, 0.0125, T + 0.0005, -0.0110);
      bx(g, M(0x6b7078), 0.010, 0.0004, 0.0025, 0, T + 0.0002, 0.0395);   // the slot punched for the clip
      // badge-reel strap + clip, then the lanyard in a loose loop on the ground
      bx(g, M(0x8e969e), 0.007, 0.0012, 0.018, 0, 0.0006, 0.0500);
      bx(g, M(STEEL), 0.012, 0.0030, 0.014, 0, 0.0015, 0.0620);
      const loop = to(g, stripeD, 0.034, 0.0022, 0, 0.0022, 0.100, LZ, 0, 0);
      loop.scale.set(1, 1.35, 1);                                          // an oval, the way a dropped lanyard lies
    },
    // MOVED here out of city/inventory.js's buildChestMesh — SAME dimensions
    // and SAME palette, so a placed chest is byte-identical to the one that
    // has been standing in saved worlds, and the bag now shows that exact box.
    // A WOODEN STORAGE TRUNK, same 1.0 x 0.8 x 0.8 footprint the saved chests
    // were placed with: planked sides (the plank seams are what say wood), a
    // slightly proud lid, steel corner bands, rope side handles and a hasp
    // with a padlock. It was three boxes with an emissive lift and a GLOWING
    // gold latch — a treasure chest out of a platformer.
    chest: function (g) {
      const wood = M(0x5e3f24), woodL = M(0x6d4a2b), seam = M(0x3a2614), steel = M(0x3a3e44),
            steelL = M(0x6b7178), rope = M(0x9a8660), brass = M(0xa88a3e);
      bx(g, wood, 1.0, 0.6, 0.8, 0, 0.30, 0);
      for (const y of [0.15, 0.30, 0.45]) {                          // plank seams, all four faces
        bx(g, seam, 1.004, 0.008, 0.804, 0, y, 0);
      }
      bx(g, woodL, 1.04, 0.19, 0.84, 0, 0.705, 0);                    // the lid
      bx(g, seam, 1.044, 0.008, 0.844, 0, 0.705, 0);                  // lid plank seam
      bx(g, steel, 1.05, 0.03, 0.85, 0, 0.615, 0);                    // lid rim band
      bx(g, steel, 1.01, 0.04, 0.81, 0, 0.03, 0);                     // base band
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {          // steel corner bands
        bx(g, steel, 0.06, 0.62, 0.012, sx * 0.475, 0.31, sz * 0.404);
        bx(g, steel, 0.012, 0.62, 0.06, sx * 0.504, 0.31, sz * 0.375);
      }
      for (const sx of [-1, 1]) {                                    // rope handles in cleats
        bx(g, steelL, 0.02, 0.05, 0.05, sx * 0.51, 0.46, -0.10);
        bx(g, steelL, 0.02, 0.05, 0.05, sx * 0.51, 0.46, 0.10);
        cy(g, rope, 0.012, 0.012, 0.22, sx * 0.525, 0.43, 0, LZ);
      }
      bx(g, steel, 0.10, 0.16, 0.012, 0, 0.60, 0.426);               // the hasp
      to(g, steelL, 0.022, 0.006, 0, 0.50, 0.440, 0, 0, 0);           // padlock shackle
      bx(g, brass, 0.05, 0.045, 0.022, 0, 0.47, 0.442);               // padlock body
    },

    // ---- materials -------------------------------------------------------
    wood: function (g, C) {
      cy(g, C.mA, 0.075, 0.075, 0.400, 0, 0.075, 0, LZ);
      cy(g, C.mD, 0.072, 0.072, 0.010, 0, 0.075, 0.204, LZ);  // end grain
      cy(g, C.mD, 0.072, 0.072, 0.010, 0, 0.075, -0.204, LZ);
      cy(g, C.mS, 0.052, 0.052, 0.300, 0.112, 0.052, -0.030, LZ);
      cy(g, C.mD, 0.050, 0.050, 0.010, 0.112, 0.052, 0.124, LZ);
    },
    stone: function (g, C) {
      const a = put(g, gDod(0.105), C.mA, 0, 0.082, 0);
      a.scale.set(1.00, 0.78, 1.20); a.rotation.set(0.30, 0.85, 0.12);
      const b = put(g, gDod(0.062), C.mS, 0.086, 0.048, -0.058);
      b.scale.set(1.00, 0.78, 1.00); b.rotation.set(0.90, 0.40, 1.10);
      const c = put(g, gDod(0.038), C.mL, -0.074, 0.030, 0.062);
      c.scale.set(1.00, 0.78, 1.00); c.rotation.set(0.20, 1.60, 0.50);
    },
    scrap: function (g, C) {
      bx(g, C.mA, 0.160, 0.010, 0.092, 0, 0.020, 0, 0.20, 0.50, 0.10);
      bx(g, C.mS, 0.120, 0.008, 0.130, 0.012, 0.048, -0.010, -0.28, -0.40, 0.16);
      cy(g, C.mD, 0.010, 0.010, 0.190, -0.030, 0.062, 0.020, LZ + 0.3, 0.5, 0);
      to(g, C.mDS, 0.026, 0.008, 0.070, 0.030, 0.050, LZ, 0, 0.4);
    },

    // ---- money & shine ---------------------------------------------------
    // A VAULT BRICK: nine strapped stacks deep, three across — how a cash
    // centre shelves money — drawn as ONE paper block with the layer lines,
    // each column's strap stripe and the printed top face, so a strongroom
    // holding a hundred of them stays cheap. (19.8 x 11.3 x 15.6 cm.)
    cashbrick: function (g) {
      const cols = 3, layers = 9, t = 0.0126, W = BILL_W * cols, H = t * layers, L = BILL_L;
      bx(g, M(BILL.edge), W, H, L, 0, H / 2, 0);
      bx(g, M(BILL.face), W - 0.002, 0.0004, L - 0.002, 0, H + 0.0002, 0);
      const line = M(dk(BILL.edge, 0.78));
      for (let i = 1; i < layers; i++) bx(g, line, W + 0.001, 0.0008, L + 0.001, 0, i * t, 0);
      for (let c = 0; c < cols; c++) {
        const cx = (c - (cols - 1) / 2) * BILL_W;
        const top = new THREE.Group(); top.position.x = cx; g.add(top);
        billPrint(top, H + 0.0004);
        bx(g, M(c === 1 ? BILL.strapB : BILL.strapA), BILL_W - 0.003, H + 0.0016, 0.038, cx, (H + 0.0016) / 2, 0);
      }
    },
    // ONE STRAPPED STACK: a hundred notes, 156 x 66 mm and 11 mm thick, the
    // paper strap across the middle, and one loose note slipped off the top.
    // (The old one was a 3 cm green brick — a stack of cash is THIN; the
    // thinness and the pale paper edges are what say money.)
    cash: function (g) {
      billStack(g, 0, 0, 0, 0, 100, 0);
      looseBill(g, 0.010, 0.0126, 0.012, 0.22);
    },
    // CASH ON THE GROUND, sized by what it is worth (opts.amount). A pocket's
    // worth is a folded wad of loose notes; a real take is banded stacks
    // spilled in a heap. Never a briefcase that appears from nowhere.
    cashpile: function (g, C, name, row, opts) {
      const amt = Math.max(1, (opts && opts.amount) || 100);
      if (amt < 400) {
        billFold(g, 0, 0, 0, 0.3);
        looseBill(g, 0.070, 0, -0.020, 1.1);
        if (amt >= 120) looseBill(g, -0.060, 0, 0.050, -0.6);
        return;
      }
      const n = Math.max(1, Math.min(10, Math.round(amt / 2000)));
      const LOW = [[0, 0, 0.10], [0.074, 0.020, -0.18], [-0.072, 0.028, 0.24], [0.018, 0.168, 1.46], [-0.030, -0.166, 1.62]];
      const TOP = [[0.034, 0.012, 0.52], [-0.036, 0.018, -0.36], [0.004, 0.092, 1.20], [0.010, -0.082, 1.78], [0.000, 0.000, 0.92]];
      const t = 0.011;
      for (let i = 0; i < n; i++) {
        const top = i >= 5, p = top ? TOP[i - 5] : LOW[i];
        billStack(g, p[0], top ? t + 0.0016 : 0, p[1], p[2], 100, i % 3 === 1 ? 1 : 0);
      }
      if (n <= 3) { looseBill(g, 0.110, 0, 0.060, 0.8); looseBill(g, -0.100, 0, -0.080, -0.4); }
    },
    // MOVED here out of city/inventory.js's makeBriefcase (opts.small keeps the
    // corpse-container's two sizes).
    briefcase: function (g, C, name, row, opts) {
      const k = opts && opts.small ? 0.72 : 1;
      const cse = M(0x3a2719), trim = M(0x17191d), metal = M(0xb5a56a);
      bx(g, cse, 0.82 * k, 0.38 * k, 0.22 * k, 0, 0.22 * k, 0);
      bx(g, trim, 0.84 * k, 0.045 * k, 0.24 * k, 0, 0.22 * k, 0);
      bx(g, trim, 0.24 * k, 0.05 * k, 0.07 * k, 0, 0.46 * k, 0);
      bx(g, trim, 0.05 * k, 0.16 * k, 0.06 * k, -0.12 * k, 0.42 * k, 0);
      bx(g, trim, 0.05 * k, 0.16 * k, 0.06 * k, 0.12 * k, 0.42 * k, 0);
      bx(g, metal, 0.07 * k, 0.08 * k, 0.025 * k, -0.18 * k, 0.23 * k, -0.125 * k);
      bx(g, metal, 0.07 * k, 0.08 * k, 0.025 * k, 0.18 * k, 0.23 * k, -0.125 * k);
    },
    // THE MONEY BAG. Not a catalog row — it is a WORLD OBJECT (city/inventory.js's
    // CBZ.cashBags) and it is reached by kind, not by name: a vault's haul, a
    // cracked armoured truck's load and a casino count room's drop all draw THIS.
    //
    // It has to read as "that is a bag of money" from ten metres in a dark
    // strongroom, so the three cues are drawn PROUD and nothing else is: the
    // canvas barrel, TWO webbing handles standing up off the top (the silhouette
    // that says "pick me up"), and banded bricks visible through an unzipped
    // mouth. Real duffel: ~0.78 m long, 0.36 tall. Long axis down Z per the
    // file's convention. `opts.tone` tints the canvas so a stained (dye-packed)
    // bag is the same model in the colour that says it is ruined.
    moneybag: function (g, C, name, row, opts) {
      const o = opts || {};
      const base = o.canvas != null ? o.canvas : 0x4a5a3f;        // olive crew duffel
      const canvas = M(base);
      const light = M(lt(base, 0.16));
      const dark = M(dk(base, 0.58));
      const strap = M(dk(base, 0.34));
      const brass = M(0xb59a4a);
      /* THE SILHOUETTE IS A BARREL, NOT A BOX. The first draft led with a
         0.34x0.26x0.60 slab and read as a toolbox; the fix is to let the
         SPHERES carry the volume and use one shallow box only to give the
         thing a flat bottom to sit on. Three overlapping ellipsoids down Z is
         also how a loaded holdall actually slumps — fat in the middle,
         tapering to the zip ends.

         THREE STATES (opts.state): "open" (default — unzipped, banded
         stacks showing: a vault haul), "closed" (zipped shut, a zip track
         and pull along the crown: a bag somebody stashed), "empty" (the
         canvas slumped to half height, unzipped, handles lying flat: a bag
         somebody already went through). */
      const state = o.state || "open";
      const body = new THREE.Group();
      g.add(body);
      if (state === "empty") body.scale.set(1.08, 0.46, 1.0);
      sh(body, canvas, 0.175, 0, 0.180, 0, 1.00, 0.98, 1.35);        // the belly
      sh(body, canvas, 0.150, 0, 0.170, -0.200, 1.00, 0.95, 1.05);   // and the two ends
      sh(body, canvas, 0.150, 0, 0.170, 0.200, 1.00, 0.95, 1.05);
      bx(g, dark, 0.180, 0.030, 0.380, 0, 0.015, 0);                 // flat load-bearing base
      if (state === "closed") {
        // the zip runs the crown: a dark track, the sliders and a pull tab
        bx(g, dark, 0.016, 0.008, 0.270, 0, 0.349, 0);
        bx(g, dark, 0.016, 0.008, 0.090, 0, 0.334, 0.170, -0.26, 0, 0);
        bx(g, dark, 0.016, 0.008, 0.090, 0, 0.334, -0.170, 0.26, 0, 0);
        bx(g, brass, 0.020, 0.010, 0.024, 0, 0.354, 0.080);
        bx(g, strap, 0.010, 0.004, 0.034, 0.012, 0.357, 0.100, 0, 0.35, 0);
      } else {
        /* THE MOUTH IS A RECESS, NOT A TRAY. Dropping the dark plate below
           the belly's crown is what turns the opening into something you are
           looking DOWN INTO. */
        const my = state === "empty" ? 0.150 : 0.286;
        bx(g, dark, 0.155, 0.040, 0.440, 0, my, 0);
        if (state === "open") {
          // real banded stacks, jumbled in the mouth (the old ones were 5 cm
          // green bricks — five times the thickness of any stack that exists)
          const pal = o.dyed ? BILL_DYED : null;
          const at = [[-0.030, 0.300, -0.130, 0.25], [0.028, 0.300, -0.010, -0.18], [-0.020, 0.300, 0.120, 0.10],
                      [0.024, 0.3126, 0.080, 0.42], [-0.012, 0.3126, -0.070, -0.30]];
          for (let i = 0; i < at.length; i++) billStack(g, at[i][0], at[i][1], at[i][2], at[i][3], 100, i % 2, pal);
        }
        // the lit lip of the open mouth, so the recess reads as an opening
        bx(g, light, 0.190, 0.022, 0.470, 0, my - 0.010, 0);
        bx(g, brass, 0.026, 0.026, 0.020, 0, my, 0.232);               // the zip pulls, run to the ends
        bx(g, brass, 0.026, 0.026, 0.020, 0, my, -0.232);
      }
      if (state === "empty") {
        // handles lying flat across the slumped canvas, not standing up
        for (const sx of [-0.120, 0.120]) bx(g, strap, 0.024, 0.008, 0.260, sx, 0.150, 0, 0, sx * 0.8, 0);
        bx(g, strap, 0.020, 0.010, 0.44, 0.176, 0.005, 0.02, 0, 0.06, 0);   // shoulder strap fallen to the floor
      } else {
        // TWO webbing handles arching off the top — the whole reason the
        // silhouette reads as a bag and not a crate. Deliberately SLIM (0.022):
        // at 0.035 they read as a suitcase grip instead of nylon tape.
        for (const sx of [-0.090, 0.090]) {
          bx(g, strap, 0.022, 0.140, 0.024, sx, 0.352, -0.078, 0.12, 0, 0);
          bx(g, strap, 0.022, 0.140, 0.024, sx, 0.352, 0.078, -0.12, 0, 0);
          bx(g, strap, 0.022, 0.022, 0.180, sx, 0.420, 0);
        }
        bx(g, strap, 0.020, 0.048, 0.44, 0.166, 0.230, 0, 0, 0, 0.10);   // shoulder strap running the flank
      }
      // stencilled bank/house flash on the flank (a colour block, never text)
      if (o.flash !== false) {
        bx(g, M(o.flash != null ? o.flash : 0xc9a227), 0.012, state === "empty" ? 0.034 : 0.070, 0.210,
          -0.168, state === "empty" ? 0.090 : 0.190, 0.04);
      }
    },
    // MOVED here out of city/inventory.js's makeBackpack — the container a
    // corpse's belongings still spill into.
    backpack: function (g) {
      const cloth = M(0x354553), cloth2 = M(0x1f2b35), leather = M(0x241a14);
      bx(g, cloth, 0.56, 0.66, 0.28, 0, 0.36, 0);
      bx(g, cloth2, 0.50, 0.23, 0.06, 0, 0.58, -0.17, -0.18, 0, 0);
      bx(g, cloth2, 0.38, 0.22, 0.09, 0, 0.22, -0.19);
      bx(g, leather, 0.07, 0.54, 0.05, -0.20, 0.37, 0.17, 0, 0, -0.10);
      bx(g, leather, 0.07, 0.54, 0.05, 0.20, 0.37, 0.17, 0, 0, 0.10);
    },
    // A HOME SAFE, door on +Z: a charcoal body standing on four feet, the
    // door proud of the body inside a dark gap line, two barrel hinges on the
    // left, the combination dial with its ring, and a three-spoke handle.
    // Replaces a bare steel cube with a disc stuck on it.
    safe: function (g) {
      const body = M(0x2b2f35), door = M(0x363b42), gap = M(0x15171a), hinge = M(0x1e2125);
      const steel = M(0x9aa1a8), dial = M(0xc9c2a4), ring = M(0x121417);
      for (const fx of [-0.25, 0.25]) for (const fz of [-0.21, 0.21]) bx(g, gap, 0.07, 0.035, 0.07, fx, 0.0175, fz);
      bx(g, body, 0.62, 0.76, 0.56, 0, 0.035 + 0.38, 0);
      bx(g, gap, 0.54, 0.66, 0.006, 0, 0.415, 0.281);                    // the door gap
      bx(g, door, 0.52, 0.64, 0.030, 0, 0.415, 0.295);                   // the door itself
      bx(g, body, 0.46, 0.58, 0.006, 0, 0.415, 0.312);                   // its raised panel
      for (const hy of [0.22, 0.61]) cy(g, hinge, 0.017, 0.017, 0.10, -0.268, hy, 0.300);
      cy(g, ring, 0.056, 0.056, 0.012, 0.06, 0.52, 0.318, LZ, 0, 0, 20);  // dial ring
      cy(g, dial, 0.044, 0.044, 0.022, 0.06, 0.52, 0.326, LZ, 0, 0, 20);  // the dial
      cy(g, ring, 0.010, 0.010, 0.026, 0.06, 0.52, 0.330, LZ, 0, 0, 8);   // knob
      bx(g, M(0xb03a32), 0.004, 0.012, 0.004, 0.06, 0.588, 0.322);        // index mark
      cy(g, steel, 0.020, 0.020, 0.030, 0.06, 0.34, 0.325, LZ);           // handle hub
      for (let i = 0; i < 3; i++) {
        const a = i * (TAU / 3) + 0.3;
        cy(g, steel, 0.0065, 0.0065, 0.090, 0.06 + Math.cos(a) * 0.045, 0.34 + Math.sin(a) * 0.045, 0.335,
          0, 0, a - Math.PI / 2);
        sh(g, steel, 0.012, 0.06 + Math.cos(a) * 0.092, 0.34 + Math.sin(a) * 0.092, 0.335);
      }
    },
    // A HARD CASE (the black waterproof kind people keep guns and money in),
    // long axis along Z, latches and carry handle on the +X face. opts.open
    // swings the lid back on its rear hinge and shows the empty foam: that
    // is what a stash looks like after somebody got to it first.
    stashcase: function (g, C, name, row, opts) {
      const o = opts || {};
      const shellHex = o.shell != null ? o.shell : 0x1d1f22;
      const shell = M(shellHex), seam = M(dk(shellHex, 0.6)), rib = M(lt(shellHex, 0.08));
      const latch = M(0x4b5057), foam = M(0x34363a), cut = M(0x121315);
      const W = 0.36, L = 0.56, HB = 0.150, HL = 0.070, F = 0.012;
      for (const fx of [-0.14, 0.14]) for (const fz of [-0.22, 0.22]) bx(g, seam, 0.05, F, 0.05, fx, F / 2, fz);
      bx(g, shell, W, HB, L, 0, F + HB / 2, 0);
      bx(g, seam, W + 0.008, 0.012, L + 0.008, 0, F + HB - 0.006, 0);   // the parting-line flange
      for (const lz of [-0.15, 0.15]) bx(g, latch, 0.016, 0.060, 0.070, W / 2 + 0.008, F + HB - 0.008, lz);
      bx(g, latch, 0.022, 0.020, 0.150, W / 2 + 0.020, F + HB - 0.040, 0);   // carry handle
      bx(g, latch, 0.020, 0.030, 0.014, W / 2 + 0.010, F + HB - 0.040, 0.068);
      bx(g, latch, 0.020, 0.030, 0.014, W / 2 + 0.010, F + HB - 0.040, -0.068);
      const lid = new THREE.Group();
      lid.position.set(-W / 2, F + HB, 0);                              // hinged along the rear (-X) edge
      g.add(lid);
      bx(lid, shell, W, HL, L, W / 2, HL / 2, 0);
      for (const rz of [-0.14, 0.14]) bx(lid, rib, W - 0.06, 0.012, 0.040, W / 2, HL + 0.006, rz);
      if (o.open) {
        lid.rotation.z = 1.95;                                          // swung back past vertical
        bx(lid, foam, W - 0.03, 0.006, L - 0.03, W / 2, -0.003, 0);      // lid-side egg-crate foam
        bx(g, foam, W - 0.03, 0.006, L - 0.03, 0, F + HB - 0.004, 0);    // pick-and-pluck foam, plucked empty
        bx(g, cut, 0.14, 0.004, 0.22, -0.06, F + HB - 0.001, -0.10);
        bx(g, cut, 0.10, 0.004, 0.16, 0.08, F + HB - 0.001, 0.12);
      }
    },
    // THE INGOT. A 4-segment cylinder is a square prism and a tapered one is the
    // trapezoid every gold bar has. The square is squared by thetaStart (pi/4),
    // NOT by yawing the mesh — a yaw would be applied AFTER the non-uniform
    // scale below (three composes T*R*S) and would swing the bar's long axis out
    // to 45 degrees across the frame instead of down Z.
    gold: function (g, C) {
      const bar = put(g, gCyl(0.052, 0.072, 0.044, 4, Math.PI / 4, TAU), C.mA, 0, 0.022, 0);
      bar.scale.set(1, 1, 2.30);
      bx(g, C.mDL, 0.052, 0.003, 0.090, 0, 0.045, 0);         // assay stamp
      bx(g, C.mF, 0.028, 0.002, 0.018, 0, 0.047, 0.036);
    },
    gem: function (g, C) {
      const s = oc(g, C.mA, 0.046, 0, 0.048, 0);
      s.scale.set(1, 1.30, 1); s.rotation.y = 0.4;
      cy(g, C.mDL, 0.021, 0.021, 0.005, 0, 0.093, 0, 0, 0.4, 0, 8);   // table facet
      // the girdle must sit PROUD of the stone's widest point (r 0.046) or it
      // is a disc buried inside an octahedron, i.e. three draw calls of nothing.
      cy(g, C.mDL, 0.049, 0.049, 0.004, 0, 0.050, 0, 0, 0.4, 0, 8);
    },
    pouch: function (g, C) {
      sh(g, C.mA, 0.062, 0, 0.055, 0, 1, 0.86, 1);
      cy(g, C.mS, 0.026, 0.044, 0.048, 0, 0.108, 0);          // gathered neck
      to(g, C.mD, 0.029, 0.0075, 0, 0.104, 0, LZ, 0, 0);      // drawstring
      cy(g, C.mD, 0.0035, 0.0035, 0.050, 0.036, 0.112, 0.012, 0, 0, 1.1);
    },
    phone: function (g, C) {
      bx(g, C.mA, 0.070, 0.010, 0.146, 0, 0.005, 0);
      bx(g, C.mD, 0.060, 0.003, 0.128, 0, 0.011, 0.002);      // screen
      bx(g, C.mDL, 0.060, 0.001, 0.040, 0, 0.013, 0.040);     // glare band
      bx(g, C.mF, 0.020, 0.004, 0.020, -0.020, 0.011, -0.056);
      bx(g, C.mS, 0.018, 0.002, 0.004, 0, 0.011, 0.068);      // earpiece
    },
    laptop: function (g, C) {
      bx(g, C.mA, 0.300, 0.016, 0.210, 0, 0.008, 0);
      bx(g, C.mS, 0.250, 0.004, 0.130, 0, 0.017, 0.020);      // keys
      bx(g, C.mL, 0.090, 0.003, 0.050, 0, 0.017, -0.070);     // trackpad
      const lid = new THREE.Group();
      // NEGATIVE x-rotation: +0.30 would lean the screen FORWARD over its own
      // keyboard (the deck runs to +Z, the hinge is at -Z).
      lid.position.set(0, 0.016, -0.105); lid.rotation.x = -0.30;
      bx(lid, C.mA, 0.300, 0.194, 0.013, 0, 0.097, -0.004);
      bx(lid, C.mD, 0.272, 0.166, 0.004, 0, 0.097, 0.005);    // panel
      g.add(lid);
    },
    wallet: function (g, C) {
      bx(g, C.mA, 0.098, 0.013, 0.078, 0, 0.014, -0.038, -0.10, 0, 0);
      bx(g, C.mA, 0.098, 0.013, 0.078, 0, 0.014, 0.038, 0.10, 0, 0);
      bx(g, C.mS, 0.098, 0.006, 0.014, 0, 0.008, 0);          // spine
      bx(g, C.mD, 0.046, 0.003, 0.032, -0.020, 0.025, 0.028, 0.10, 0, 0);   // card
      bx(g, M(0x6f9f68), 0.062, 0.003, 0.026, 0.018, 0.024, -0.030, -0.10, 0, 0);
    },

    // ---- what you wear. A garment in a bag is FOLDED — that is the shape a
    //  30 px cell can read, and it is what a shop actually hands you.
    hat: function (g, C) {
      sh(g, C.mA, 0.084, 0, 0.038, -0.008, 1, 0.66, 1);
      wg(g, C.mD, 0.128, 0.013, -1.05, 2.10, 0, 0.012, 0.020);        // peak
      bx(g, C.mS, 0.128, 0.018, 0.012, 0, 0.020, 0.128, 0.18, 0, 0);  // peak edge
      sh(g, C.mDL, 0.011, 0, 0.090, -0.008);                          // button
    },
    top: function (g, C) {
      bx(g, C.mA, 0.200, 0.034, 0.170, 0, 0.017, 0);
      bx(g, C.mS, 0.200, 0.006, 0.170, 0, 0.008, 0);
      bx(g, C.mS, 0.056, 0.022, 0.092, -0.100, 0.026, -0.010, 0, 0.10, 0);   // sleeve folds
      bx(g, C.mS, 0.056, 0.022, 0.092, 0.100, 0.026, 0.010, 0, -0.10, 0);
      bx(g, C.mD, 0.078, 0.008, 0.020, 0, 0.038, 0.074);                     // collar
    },
    outer: function (g, C) {
      bx(g, C.mA, 0.216, 0.056, 0.186, 0, 0.028, 0);
      bx(g, C.mS, 0.216, 0.008, 0.186, 0, 0.013, 0);
      bx(g, C.mD, 0.130, 0.022, 0.032, 0, 0.062, 0.084);                     // collar
      bx(g, C.mDL, 0.013, 0.006, 0.170, 0, 0.060, 0);                        // zip
      bx(g, C.mS, 0.060, 0.024, 0.100, -0.106, 0.036, -0.014, 0, 0.12, 0);
      bx(g, C.mS, 0.060, 0.024, 0.100, 0.106, 0.036, 0.014, 0, -0.12, 0);
    },
    bottom: function (g, C) {
      bx(g, C.mA, 0.188, 0.046, 0.152, 0, 0.023, 0);
      bx(g, C.mS, 0.188, 0.007, 0.152, 0, 0.010, 0);
      bx(g, C.mD, 0.188, 0.016, 0.026, 0, 0.052, 0.064);                     // waistband
      bx(g, C.mDL, 0.008, 0.004, 0.140, 0, 0.048, 0);                        // crease
      bx(g, C.mS, 0.026, 0.006, 0.024, 0.058, 0.049, 0.050);                 // pocket
    },
    shoes: function (g, C) {
      bx(g, C.mD, 0.086, 0.024, 0.240, 0, 0.012, 0);                         // sole
      sh(g, C.mA, 0.062, 0, 0.052, -0.030, 0.70, 0.66, 1.30);
      bx(g, C.mA, 0.082, 0.046, 0.096, 0, 0.045, 0.076, -0.10, 0, 0);        // toe box
      for (let i = 0; i < 3; i++) bx(g, C.mDL, 0.052, 0.005, 0.008, 0, 0.082, 0.010 + i * 0.026);
      bx(g, C.mS, 0.070, 0.036, 0.020, 0, 0.070, -0.110);                    // heel tab
    },
    glasses: function (g, C) {
      const fr = C.mA, ln = C.mD;
      bx(g, fr, 0.052, 0.006, 0.034, -0.030, 0.007, 0);
      bx(g, fr, 0.052, 0.006, 0.034, 0.030, 0.007, 0);
      bx(g, ln, 0.046, 0.003, 0.028, -0.030, 0.011, 0);
      bx(g, ln, 0.046, 0.003, 0.028, 0.030, 0.011, 0);
      bx(g, fr, 0.016, 0.005, 0.007, 0, 0.008, 0.004);                       // bridge
      bx(g, fr, 0.006, 0.004, 0.098, -0.050, 0.005, -0.062, 0, 0.14, 0);     // folded temples
      bx(g, fr, 0.006, 0.004, 0.098, 0.050, 0.003, -0.062, 0, -0.14, 0);
    },
    chain: function (g, C) {
      to(g, C.mA, 0.074, 0.009, 0, 0.009, 0, LZ, 0, 0);
      to(g, C.mL, 0.074, 0.004, 0, 0.014, 0, LZ, 0, 0);                      // highlight pass
      bx(g, C.mD, 0.030, 0.010, 0.030, 0, 0.010, 0.086, 0, 0.79, 0);         // pendant
      cy(g, C.mS, 0.008, 0.008, 0.014, 0, 0.010, -0.078, LZ);                // clasp
    },
    watch: function (g, C) {
      cy(g, C.mA, 0.022, 0.022, 0.011, 0, 0.020, 0);
      cy(g, C.mD, 0.024, 0.024, 0.004, 0, 0.026, 0);                         // bezel
      // the dial must clear the bezel it sits in — 0.028 buried it in the disc
      cy(g, C.mL, 0.017, 0.017, 0.003, 0, 0.0295, 0);
      bx(g, C.mF, 0.003, 0.002, 0.011, 0.004, 0.0325, 0.004, 0, 0.6, 0);     // hands
      cy(g, C.mA, 0.005, 0.005, 0.008, 0.026, 0.020, 0, 0, 0, LX);           // crown
      bx(g, C.mS, 0.030, 0.006, 0.072, 0, 0.014, 0.052, -0.34, 0, 0);        // strap
      bx(g, C.mS, 0.030, 0.006, 0.072, 0, 0.014, -0.052, 0.34, 0, 0);
    },
    ring: function (g, C) {
      to(g, C.mA, 0.014, 0.0038, 0, 0.0038, 0, LZ, 0, 0);
      oc(g, C.mD, 0.0105, 0, 0.019, 0).scale.set(1, 1.25, 1);
      cy(g, C.mL, 0.007, 0.009, 0.006, 0, 0.010, 0, 0, 0, 0, 6);             // setting
    },

    // The last resort, and still a real object: a wrapped, twined parcel.
    parcel: function (g, C) {
      bx(g, C.mA, 0.140, 0.100, 0.112, 0, 0.050, 0);
      bx(g, C.mD, 0.144, 0.104, 0.012, 0, 0.050, 0);          // twine
      bx(g, C.mD, 0.012, 0.104, 0.116, 0, 0.050, 0);
      bx(g, C.mL, 0.056, 0.003, 0.040, 0.030, 0.102, 0.028, 0, 0.16, 0);     // label
      bx(g, C.mS, 0.142, 0.006, 0.114, 0, 0.098, 0);          // fold flap
    },
  };

  // ============================================================
  //  4. PUBLIC FACE
  // ============================================================
  function rowOf(name, row) {
    if (row) return row;
    if (CBZ.itemRow) { try { return CBZ.itemRow(name, null); } catch (e) {} }
    const IT = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || (CBZ.econ && CBZ.econ.ITEMS) || null;
    return (IT && IT[name]) || null;
  }
  function kindOf(name, row, opts) {
    if (opts && opts.kind) return opts.kind;
    if (CBZ.itemKind) { try { return CBZ.itemKind(name, row); } catch (e) {} }
    return "parcel";
  }

  // THE one call. Returns a fresh Group over SHARED geometry/materials — cheap
  // to make, cheap to throw away, and never disposed out from under a sibling.
  CBZ.itemAsset = function (name, row, opts) {
    row = rowOf(name, row);
    const kind = kindOf(name, row, opts);
    const b = BUILD[kind] || BUILD.parcel;
    const g = new THREE.Group();
    try { b(g, kitFor(name, row), name, row, opts || null); } catch (e) { /* a half-built asset still draws */ }
    if (!g.children.length) return null;
    g.userData.itemAsset = kind;
    g.userData.itemName = name || null;
    return g;
  };
  CBZ.itemAssetKind = function (name, row, opts) { return kindOf(name, rowOf(name, row), opts); };

  // ============================================================
  //  4b. THE BAKE — one Mesh per object instead of 10-40.
  //  An authored asset is a Group of small primitives, which is the right way
  //  to WRITE it and the wrong way to DRAW forty of them on the city's roofs.
  //  `bakeGroup` flattens every visible mesh under a group into ONE
  //  non-indexed BufferGeometry in the group's own frame, carrying each
  //  part's material colour as a vertex colour, drawn with ONE shared
  //  vertex-coloured Lambert. Same look (every material here is a flat pooled
  //  Lambert colour), one draw call. Geometry is cached per variant key and
  //  flagged `_shared`, so the repo's dispose paths never free it out from
  //  under a sibling.
  // ============================================================
  let VC_MAT = null;
  function vcMat() {
    if (!VC_MAT) { VC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true }); VC_MAT._shared = true; }
    return VC_MAT;
  }
  const _bm = new THREE.Matrix4(), _bi = new THREE.Matrix4(), _bn = new THREE.Matrix3(),
        _bv = new THREE.Vector3(), _bw = new THREE.Vector3();
  function bakeGroup(root) {
    root.updateMatrixWorld(true);
    _bi.copy(root.matrixWorld).invert();
    const pos = [], nrm = [], col = [];
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return;
      const src = o.geometry, geo = src.index ? src.toNonIndexed() : src;
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const P = geo.attributes.position, N = geo.attributes.normal;
      _bm.multiplyMatrices(_bi, o.matrixWorld);
      _bn.getNormalMatrix(_bm);
      const mirrored = _bm.determinant() < 0;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const c = (mat && mat.color) || { r: 1, g: 1, b: 1 };
      const n = P.count;
      for (let t = 0; t < n; t += 3) {
        // a mirrored transform flips winding; swap two corners to keep faces out
        const order = mirrored ? [t, t + 2, t + 1] : [t, t + 1, t + 2];
        for (let k = 0; k < 3; k++) {
          const i = order[k];
          _bv.fromBufferAttribute(P, i).applyMatrix4(_bm);
          pos.push(_bv.x, _bv.y, _bv.z);
          _bw.fromBufferAttribute(N, i).applyMatrix3(_bn).normalize();
          nrm.push(_bw.x, _bw.y, _bw.z);
          col.push(c.r, c.g, c.b);
        }
      }
      if (geo !== src) geo.dispose();
    });
    if (!pos.length) return null;
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    out.computeBoundingBox(); out.computeBoundingSphere();
    out._shared = true;
    return out;
  }
  const BAKED = new Map();
  function bakeKey(name, opts) {
    let k = String(name == null ? "" : name) + "|";
    if (opts) { try { k += JSON.stringify(opts); } catch (e) { k += "?"; } }
    return k;
  }
  // CBZ.itemAssetBaked(key|null, name, row, opts) -> a fresh Mesh over a cached
  // baked geometry (key defaults to name+opts). Same frame and origin as
  // CBZ.itemAsset's Group, so it is a drop-in replacement wherever a static
  // object is placed.
  CBZ.itemAssetBaked = function (key, name, row, opts) {
    const k = key || bakeKey(name, opts);
    let e = BAKED.get(k);
    if (!e) {
      const grp = CBZ.itemAsset(name, row, opts);
      if (!grp) return null;
      const geo = bakeGroup(grp);
      if (!geo) return null;
      e = { geo: geo, kind: grp.userData.itemAsset, name: grp.userData.itemName };
      BAKED.set(k, e);
    }
    const m = new THREE.Mesh(e.geo, vcMat());
    m.castShadow = true; m.receiveShadow = true;
    m.userData.itemAsset = e.kind;
    m.userData.itemName = e.name;
    return m;
  };
  // for callers that author their own group (systems/resources.js's scrap pile)
  CBZ.itemAssetBakeGroup = bakeGroup;
  CBZ.itemAssetVCMat = vcMat;

  // A DROPPED ITEM IS ITS REAL SIZE (2026-09-27 de-slop). This used to be a
  // findability RAMP, `k = (0.34/m)^0.62`, that lifted every small thing
  // toward 34 cm: a 15.6 cm stack of notes became a 25 cm green brick, a
  // wallet became a 21 cm clutch bag, a key ring a doorstop. It was the one
  // place the file lied about size, and it is what made pickups read as
  // arcade tokens instead of objects somebody dropped. What makes a thing
  // findable is that it reads as itself — pale paper, a white card on a
  // coloured lanyard, brass on asphalt — so the ramp is gone.
  //
  // Two honest limits remain. Anything under 6 cm (a ring, a loose gem) is
  // lifted to 6 cm at most 1.6x, because below that it is a single pixel at
  // third-person distance. Anything over 1.05 m is brought down to 1.05 m,
  // except the NO_SCALE world furniture (a gun is the model every armed NPC
  // carries; a chest/case/duffel/safe is the same object on a shelf).
  const PICK_MIN = 0.06, PICK_MIN_K = 1.6, PICK_MAX = 1.05;
  const NO_SCALE = { gun: 1, chest: 1, briefcase: 1, backpack: 1, moneybag: 1, safe: 1, stashcase: 1 };
  CBZ.itemAssetPickup = function (name, row, opts) {
    // everything but a gun is BAKED: one draw call, one shared geometry per
    // variant, however many of them are lying around. (A gun stays a live
    // weapon model: the physics body and the NPC-drop replacement inspect it.)
    let o = null;
    const kind = kindOf(name, rowOf(name, row), opts);
    if (kind !== "gun" && CBZ.itemAssetBaked) o = CBZ.itemAssetBaked(null, name, row, opts);
    if (!o) o = CBZ.itemAsset(name, row, opts);
    if (!o) return null;
    o.updateMatrixWorld(true);
    let b = new THREE.Box3().setFromObject(o);
    if (isFinite(b.min.x) && isFinite(b.max.x)) {
      const m = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
      let k = 1;
      if (m > 1e-4 && !NO_SCALE[o.userData.itemAsset]) {
        if (m < PICK_MIN) k = Math.min(PICK_MIN_K, PICK_MIN / m);
        else if (m > PICK_MAX) k = PICK_MAX / m;
      }
      if (k !== 1) { o.scale.multiplyScalar(k); o.updateMatrixWorld(true); b = new THREE.Box3().setFromObject(o); }
      if (isFinite(b.min.y)) o.position.y -= b.min.y;
    }
    const w = new THREE.Group();
    w.add(o);
    w.userData.itemAsset = o.userData.itemAsset;
    w.userData.itemName = o.userData.itemName;
    return w;
  };

  // ============================================================
  //  5. RATCHET — `assetless` is the count of catalog rows the registry cannot
  //  draw. It is STRUCTURALLY 0: the roster covers every kind the classifier
  //  can return and an unrecognised one falls to `parcel`, which is a real
  //  object and not an apology. `kinds`/`builders` print beside it so a "fix"
  //  that classifies everything as parcel cannot pass.
  // ============================================================
  CBZ.itemAssetAudit = function () {
    const IT = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || (CBZ.econ && CBZ.econ.ITEMS) || {};
    let items = 0, assetless = 0, parcelled = 0;
    const kinds = {}, assetlessNames = [], parcelNames = [];
    for (const n in IT) {
      items++;
      const k = kindOf(n, IT[n], null);
      kinds[k] = (kinds[k] | 0) + 1;
      if (!BUILD[k]) { assetless++; if (assetlessNames.length < 20) assetlessNames.push(n); }
      if (k === "parcel") { parcelled++; if (parcelNames.length < 20) parcelNames.push(n); }
    }
    return {
      items: items, assetless: assetless, assetlessNames: assetlessNames,
      parcelled: parcelled, parcelNames: parcelNames,
      kinds: kinds, builders: Object.keys(BUILD).length,
      reused: 1,                                  // guns, via CBZ.buildActorWeapon
      geometry: GEO.size,
    };
  };
})();
