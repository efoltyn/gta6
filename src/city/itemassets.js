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
    drug: function (g, C) {                                   // a taped brick
      bx(g, C.mA, 0.150, 0.056, 0.100, 0, 0.028, 0);
      bx(g, C.mS, 0.152, 0.012, 0.102, 0, 0.010, 0);          // wrap seam
      bx(g, C.mD, 0.154, 0.060, 0.020, 0, 0.028, 0);          // tape cross
      bx(g, C.mD, 0.022, 0.060, 0.104, 0, 0.028, 0);
      bx(g, C.mDL, 0.050, 0.003, 0.036, -0.040, 0.057, 0.026);
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
    key: function (g, C) {
      cy(g, C.mA, 0.0048, 0.0048, 0.080, 0, 0.005, 0.018, LZ);
      to(g, C.mA, 0.019, 0.0055, 0, 0.005, -0.032, LZ, 0, 0);
      bx(g, C.mA, 0.0048, 0.011, 0.008, 0, -0.001, 0.044);
      bx(g, C.mA, 0.0048, 0.014, 0.008, 0, -0.003, 0.058);
      bx(g, C.mD, 0.006, 0.003, 0.010, 0, 0.010, -0.032);     // brass tag
    },
    // MOVED here out of city/inventory.js's buildChestMesh — SAME dimensions
    // and SAME palette, so a placed chest is byte-identical to the one that
    // has been standing in saved worlds, and the bag now shows that exact box.
    chest: function (g, C) {
      put(g, gBox(1.0, 0.6, 0.8), M(0x6b4a2a, { emissive: 0x241505, ei: 0.15 }), 0, 0.3, 0);
      put(g, gBox(1.04, 0.2, 0.84), M(0x4a3320, { emissive: 0x1a0f04, ei: 0.15 }), 0, 0.7, 0);
      put(g, gBox(0.14, 0.18, 0.06), M(0xc9a44a, { emissive: 0x6b4f12, ei: 0.4 }), 0, 0.58, 0.44);
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
    cash: function (g, C) {
      bx(g, C.mA, 0.155, 0.030, 0.070, 0, 0.015, 0);
      bx(g, C.mS, 0.155, 0.006, 0.070, 0, 0.020, 0);
      bx(g, C.mA, 0.155, 0.005, 0.070, 0, 0.033, 0, 0, 0.13, 0);   // slipped top bills
      bx(g, C.mA, 0.155, 0.005, 0.070, 0, 0.039, 0, 0, -0.07, 0);
      bx(g, C.mD, 0.030, 0.040, 0.074, 0, 0.020, 0);               // paper band
      bx(g, C.mF, 0.026, 0.004, 0.026, 0, 0.043, 0);               // seal
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
      const note = M(o.note != null ? o.note : 0x6fae5a);         // banded notes
      const band = M(0xd8d2c0);
      /* THE SILHOUETTE IS A BARREL, NOT A BOX. The first draft led with a
         0.34x0.26x0.60 slab and read as a toolbox; the fix is to let the
         SPHERES carry the volume and use one shallow box only to give the
         thing a flat bottom to sit on. Three overlapping ellipsoids down Z is
         also how a loaded holdall actually slumps — fat in the middle,
         tapering to the zip ends. */
      sh(g, canvas, 0.175, 0, 0.180, 0, 1.00, 0.98, 1.35);        // the belly
      sh(g, canvas, 0.150, 0, 0.170, -0.200, 1.00, 0.95, 1.05);   // and the two ends
      sh(g, canvas, 0.150, 0, 0.170, 0.200, 1.00, 0.95, 1.05);
      bx(g, dark, 0.180, 0.044, 0.380, 0, 0.014, 0);              // flat load-bearing base
      /* THE MOUTH IS A RECESS, NOT A TRAY. The first draft floated the dark
         plate and the bricks ABOVE the canvas line, so the notes read as
         cargo strapped to the roof of a bag. Dropping both below the belly's
         crown (0.30 against the ellipsoid's ~0.35) is what turns them into
         something you are looking DOWN INTO. */
      bx(g, dark, 0.155, 0.040, 0.440, 0, 0.286, 0);
      for (let i = -1; i <= 1; i++) {
        bx(g, note, 0.122, 0.048, 0.090, i * 0.006, 0.296, i * 0.140, 0, i * 0.20, 0);
        bx(g, band, 0.032, 0.051, 0.093, i * 0.006, 0.296, i * 0.140, 0, i * 0.20, 0);
      }
      // TWO webbing handles arching off the top — the whole reason the
      // silhouette reads as a bag and not a crate. Deliberately SLIM (0.022):
      // at 0.035 they read as a suitcase grip instead of nylon tape.
      for (const sx of [-0.090, 0.090]) {
        bx(g, strap, 0.022, 0.140, 0.024, sx, 0.352, -0.078, 0.12, 0, 0);
        bx(g, strap, 0.022, 0.140, 0.024, sx, 0.352, 0.078, -0.12, 0, 0);
        bx(g, strap, 0.022, 0.022, 0.180, sx, 0.420, 0);
      }
      // shoulder strap running the flank, and the end-cap zip pulls
      bx(g, strap, 0.020, 0.048, 0.44, 0.166, 0.230, 0, 0, 0, 0.10);
      bx(g, brass, 0.026, 0.026, 0.020, 0, 0.286, 0.232);
      bx(g, brass, 0.026, 0.026, 0.020, 0, 0.286, -0.232);
      // the lit lip of the open mouth, so the recess reads as an opening
      bx(g, light, 0.190, 0.022, 0.470, 0, 0.276, 0);
      // stencilled bank/house flash on the flank (a colour block, never text)
      bx(g, M(o.flash != null ? o.flash : 0xc9a227), 0.012, 0.070, 0.210, -0.168, 0.190, 0.04);
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

  // A DROPPED item must be FINDABLE, and the models are honest about size — an
  // apple is 8 cm because an apple is 8 cm, and 8 cm of apple on a pavement is
  // invisible. So the PICKUP scales, and the model never lies about itself.
  //
  // The scale is a RAMP, not a clamp, and that distinction is the whole reason
  // it does not look stupid: clamping every small thing to one floor makes a
  // ring and a medkit the same size on the kerb. `k = (REF/m)^0.62` lifts the
  // tiniest things most while PRESERVING ORDER — ring 15 cm < apple 21 < medkit
  // 25 < loaf 31 < knife 32 — so the pavement still tells you which is which.
  // Anything already big is left exactly alone up to a hard 1.05 m ceiling.
  //
  // NO_SCALE kinds opt out entirely: a gun's size comes from the model every
  // armed NPC in the game carries, and a chest/case/pack is world furniture
  // already. Normalising those would make a dropped pistol 68% longer than the
  // one on the corpse beside it.
  const PICK_REF = 0.34, PICK_MAX = 1.05, PICK_POW = 0.62;
  // `moneybag` joins them for the same reason a briefcase does: it is world
  // furniture at honest scale, and normalising it would make a duffel on a
  // vault shelf a different size from the one on the pavement beside it.
  const NO_SCALE = { gun: 1, chest: 1, briefcase: 1, backpack: 1, moneybag: 1 };
  CBZ.itemAssetPickup = function (name, row, opts) {
    const o = CBZ.itemAsset(name, row, opts);
    if (!o) return null;
    o.updateMatrixWorld(true);
    let b = new THREE.Box3().setFromObject(o);
    if (isFinite(b.min.x) && isFinite(b.max.x)) {
      const m = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
      let k = 1;
      if (m > 1e-4 && !NO_SCALE[o.userData.itemAsset]) {
        if (m < PICK_REF) k = Math.min(PICK_REF / m, Math.pow(PICK_REF / m, PICK_POW));
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
