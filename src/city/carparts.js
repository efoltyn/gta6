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
    muscle: "bison", lowrider: "bison", suv: "bison", van: "bison",
    hatch: "kotori",
  };

  // ---- shared bumper masses: real protruding forms at nose + tail so the
  //      body no longer falls straight to the ground at both ends. ----
  function addBumpers(root, ctx, chromeStrip) {
    const w = ctx.w, bY = ctx.baseY;
    [[ctx.frontZ + 0.07, 1], [ctx.rearZ - 0.07, -1]].forEach(function (end) {
      const z = end[0];
      add(root, w * 1.02, 0.2, 0.22, 0, bY, z, bumperM());
      // wrap-around corner caps
      [1, -1].forEach(function (side) {
        add(root, 0.16, 0.2, 0.3, side * w * 0.46, bY, z - end[1] * 0.12, bumperM());
      });
      if (chromeStrip) add(root, w * 0.92, 0.045, 0.05, 0, bY + 0.12, z + end[1] * 0.01, chrome());
    });
  }

  // ============================================================
  //  BRAND FACES — grille + lamps + badge + exhaust + rear treatment.
  //  ctx anchors: { w, len, frontZ, rearZ, baseY, headY, tailY, noseTopY,
  //                 baseH, paint (optional body-paint material), noBumpers }
  // ============================================================
  const FACES = {
    falcone: function (root, ctx) {
      const w = ctx.w;
      // low wide mouth + splitter (the exotic gets aero, not a bumper block)
      add(root, w * 0.66, 0.17, 0.06, 0, ctx.baseY + 0.07, ctx.frontZ + 0.03, grille());
      add(root, w * 0.94, 0.08, 0.24, 0, ctx.baseY - 0.05, ctx.frontZ + 0.04, darkTrim());
      // slanted slim headlamps + inner DRL chip
      [1, -1].forEach(function (side) {
        const bez = add(root, w * 0.28, 0.11, 0.04, side * w * 0.30, ctx.headY, ctx.frontZ + 0.015, darkTrim());
        const lamp = add(root, w * 0.25, 0.075, 0.06, side * w * 0.30, ctx.headY, ctx.frontZ + 0.035, head());
        bez.rotation.z = lamp.rotation.z = side * -0.20;
      });
      add(root, 0.11, 0.15, 0.035, 0, ctx.headY + 0.03, ctx.frontZ + 0.045, badgeGold());   // shield badge
      // twin ROUND tail lamps per side in a dark panel — the house signature
      add(root, w * 0.9, 0.24, 0.04, 0, ctx.tailY, ctx.rearZ - 0.005, darkTrim());
      [1, -1].forEach(function (side) {
        addRound(root, 0.085, 0.06, side * w * 0.34, ctx.tailY, ctx.rearZ - 0.03, tail());
        addRound(root, 0.085, 0.06, side * w * 0.19, ctx.tailY, ctx.rearZ - 0.03, tail());
      });
      add(root, 0.10, 0.13, 0.03, 0, ctx.tailY, ctx.rearZ - 0.035, badgeGold());
      // centred quad exhaust + finned diffuser
      [-0.22, -0.09, 0.09, 0.22].forEach(function (fx) {
        addRound(root, 0.05, 0.12, fx * w, ctx.baseY + 0.02, ctx.rearZ - 0.05, chrome(), 10);
      });
      add(root, w * 0.72, 0.11, 0.12, 0, ctx.baseY - 0.04, ctx.rearZ - 0.04, grille());
      [-0.18, 0, 0.18].forEach(function (fx) {
        add(root, 0.035, 0.15, 0.14, fx * w, ctx.baseY - 0.04, ctx.rearZ - 0.05, darkTrim());
      });
    },

    adler: function (root, ctx) {
      const w = ctx.w;
      if (!ctx.noBumpers) addBumpers(root, ctx, true);
      // twin horizontal chrome bars over a dark inner grille
      add(root, w * 0.54, 0.17, 0.04, 0, ctx.headY - 0.06, ctx.frontZ + 0.02, grille());
      [-0.045, 0.045].forEach(function (dy) {
        add(root, w * 0.5, 0.035, 0.05, 0, ctx.headY - 0.06 + dy, ctx.frontZ + 0.035, chrome());
      });
      // oval lamps (flattened rounds) + amber corner markers
      [1, -1].forEach(function (side) {
        const hb = addRound(root, 0.12, 0.05, side * w * 0.31, ctx.headY, ctx.frontZ + 0.02, darkTrim(), 14);
        hb.scale.set(1.5, 1, 0.9);
        const hl = addRound(root, 0.10, 0.06, side * w * 0.31, ctx.headY, ctx.frontZ + 0.035, head(), 14);
        hl.scale.set(1.45, 1, 1);
        add(root, 0.06, 0.055, 0.05, side * w * 0.465, ctx.headY, ctx.frontZ + 0.02, amber());
      });
      addRound(root, 0.07, 0.035, 0, ctx.headY + 0.11, ctx.frontZ + 0.04, chrome(), 14);   // roundel badge
      // full-width slim tail bar with a chrome underline
      add(root, w * 0.86, 0.05, 0.04, 0, ctx.tailY - 0.08, ctx.rearZ - 0.02, chrome());
      add(root, w * 0.84, 0.10, 0.06, 0, ctx.tailY, ctx.rearZ - 0.012, tail());
      // dual wide oval exhausts
      [1, -1].forEach(function (side) {
        add(root, 0.17, 0.09, 0.11, side * w * 0.30, ctx.baseY + 0.02, ctx.rearZ - 0.05, chrome());
      });
    },

    bison: function (root, ctx) {
      const w = ctx.w;
      if (!ctx.noBumpers) addBumpers(root, ctx, true);
      // tall slatted grille + thick chrome crossbar + red badge bar
      const gH = Math.min(0.34, ctx.baseH * 0.34);
      add(root, w * 0.56, gH, 0.06, 0, ctx.headY - 0.03, ctx.frontZ + 0.02, grille());
      for (let i = -2; i <= 2; i++) {
        add(root, 0.045, gH * 0.9, 0.045, i * w * 0.105, ctx.headY - 0.03, ctx.frontZ + 0.035, darkTrim());
      }
      add(root, w * 0.6, 0.065, 0.05, 0, ctx.headY - 0.03, ctx.frontZ + 0.045, chrome());
      add(root, 0.17, 0.08, 0.035, 0, ctx.headY - 0.03, ctx.frontZ + 0.055, badgeRed());
      // square QUAD headlamps in dark bezels
      [1, -1].forEach(function (side) {
        add(root, 0.27, 0.14, 0.04, side * w * 0.345, ctx.headY, ctx.frontZ + 0.015, darkTrim());
        add(root, 0.11, 0.11, 0.06, side * (w * 0.345 - 0.065), ctx.headY, ctx.frontZ + 0.035, head());
        add(root, 0.11, 0.11, 0.06, side * (w * 0.345 + 0.065), ctx.headY, ctx.frontZ + 0.035, head());
      });
      // VERTICAL stacked tail lamps at the rear corners
      const tH = Math.max(0.22, Math.min(0.5, ctx.baseH * 0.3));
      [1, -1].forEach(function (side) {
        add(root, 0.13, tH + 0.06, 0.04, side * w * 0.38, ctx.tailY, ctx.rearZ - 0.005, darkTrim());
        add(root, 0.10, tH, 0.065, side * w * 0.38, ctx.tailY, ctx.rearZ - 0.02, tail());
      });
      add(root, 0.17, 0.08, 0.03, 0, ctx.tailY, ctx.rearZ - 0.03, badgeRed());
      // offset dual pipes
      [1, -1].forEach(function (side) {
        addRound(root, 0.055, 0.14, side * w * 0.33, ctx.baseY + 0.01, ctx.rearZ - 0.06, chrome(), 10);
      });
    },

    voltra: function (root, ctx) {
      const w = ctx.w;
      if (!ctx.noBumpers) addBumpers(root, ctx, false);
      // closed body-colour nose panel + slim LED brow + low aero slot
      if (ctx.paint) add(root, w * 0.6, 0.13, 0.05, 0, ctx.headY - 0.05, ctx.frontZ + 0.02, ctx.paint);
      add(root, w * 0.74, 0.055, 0.055, 0, ctx.headY + 0.055, ctx.frontZ + 0.03, head());
      add(root, w * 0.5, 0.08, 0.05, 0, ctx.baseY + 0.05, ctx.frontZ + 0.03, grille());
      // chevron badge (two chrome dashes forming a V)
      [1, -1].forEach(function (side) {
        const b = add(root, 0.10, 0.03, 0.035, side * 0.043, ctx.headY - 0.045, ctx.frontZ + 0.045, chrome());
        b.rotation.z = side * -0.65;
      });
      // full-width red tail blade + dark valance
      add(root, w * 0.9, 0.05, 0.04, 0, ctx.tailY - 0.075, ctx.rearZ - 0.015, darkTrim());
      add(root, w * 0.88, 0.085, 0.06, 0, ctx.tailY, ctx.rearZ - 0.012, tail());
      add(root, w * 0.6, 0.1, 0.1, 0, ctx.baseY - 0.02, ctx.rearZ - 0.03, grille());   // diffuser, no pipes
    },

    kotori: function (root, ctx) {
      const w = ctx.w;
      if (!ctx.noBumpers) addBumpers(root, ctx, false);
      // slim upper slot + big lower mouth = the friendly "smile"
      add(root, w * 0.36, 0.055, 0.05, 0, ctx.headY, ctx.frontZ + 0.025, grille());
      add(root, w * 0.56, 0.15, 0.05, 0, ctx.baseY + 0.09, ctx.frontZ + 0.03, grille());
      add(root, w * 0.58, 0.035, 0.04, 0, ctx.baseY + 0.175, ctx.frontZ + 0.035, chrome());
      // compact rectangular lamps + tiny amber corner
      [1, -1].forEach(function (side) {
        add(root, 0.24, 0.11, 0.04, side * w * 0.315, ctx.headY, ctx.frontZ + 0.015, darkTrim());
        add(root, 0.20, 0.085, 0.06, side * w * 0.30, ctx.headY, ctx.frontZ + 0.035, head());
        add(root, 0.055, 0.07, 0.05, side * w * 0.44, ctx.headY, ctx.frontZ + 0.025, amber());
      });
      addRound(root, 0.05, 0.035, 0, ctx.headY, ctx.frontZ + 0.045, badgeRed(), 12);   // red-dot badge
      // twin compact square tails + a small silver reverse chip
      [1, -1].forEach(function (side) {
        add(root, 0.20, 0.15, 0.04, side * w * 0.33, ctx.tailY, ctx.rearZ - 0.005, darkTrim());
        add(root, 0.16, 0.12, 0.065, side * w * 0.33, ctx.tailY, ctx.rearZ - 0.02, tail());
        add(root, 0.06, 0.06, 0.05, side * w * 0.19, ctx.tailY, ctx.rearZ - 0.02, silverM());
      });
      addRound(root, 0.045, 0.1, -w * 0.28, ctx.baseY + 0.01, ctx.rearZ - 0.05, chrome(), 10);   // one shy pipe
    },

    vitesse: function (root, ctx) {
      const w = ctx.w;
      // chrome horseshoe grille, front and centre
      addRound(root, 0.11, 0.05, 0, ctx.headY - 0.05, ctx.frontZ + 0.03, grille(), 14);
      addRing(root, 0.12, 0.028, 0, ctx.headY - 0.05, ctx.frontZ + 0.045, chrome());
      add(root, w * 0.9, 0.08, 0.2, 0, ctx.baseY - 0.04, ctx.frontZ + 0.04, darkTrim());   // splitter lip
      // slim rectangular lamps
      [1, -1].forEach(function (side) {
        add(root, 0.20, 0.09, 0.04, side * w * 0.30, ctx.headY, ctx.frontZ + 0.015, darkTrim());
        add(root, 0.17, 0.07, 0.06, side * w * 0.30, ctx.headY, ctx.frontZ + 0.035, head());
      });
      add(root, 0.08, 0.10, 0.035, 0, ctx.headY + 0.1, ctx.frontZ + 0.04, badgeGold());
      // framed full-width tail bar + one huge centre exhaust
      add(root, w * 0.84, 0.15, 0.04, 0, ctx.tailY, ctx.rearZ - 0.005, chrome());
      add(root, w * 0.8, 0.10, 0.06, 0, ctx.tailY, ctx.rearZ - 0.018, tail());
      add(root, 0.2, 0.13, 0.12, 0, ctx.baseY + 0.02, ctx.rearZ - 0.05, chrome());
      add(root, w * 0.66, 0.1, 0.1, 0, ctx.baseY - 0.04, ctx.rearZ - 0.03, grille());
    },
  };

  function brandForStyle(style) { return STYLE_BRAND[style] || "bison"; }

  function applyBrandFace(root, brandKey, ctx) {
    const face = FACES[brandKey] || FACES.bison;
    face(root, ctx);
  }

  // ---- ROOF ACCESSORIES ----------------------------------------------------
  function addTaxiSign(root, ctx) {
    const signM = L("cp-taxisign", 0xf8e46b, { emissive: 0x5a4a14, ei: 0.5 });
    add(root, 0.62, 0.2, 0.3, 0, ctx.roofY + 0.11, ctx.roofZ || 0, signM);
    // checker band down both flanks at the beltline
    add(root, ctx.w + 0.03, 0.1, ctx.len * 0.46, 0, ctx.bodyY + ctx.baseH * 0.5, -ctx.len * 0.03, darkTrim());
  }
  function addRoofRails(root, ctx) {
    const railM = L("cp-rail", 0x8f979f, { emissive: 0x1a1d22, ei: 0.3 });
    [1, -1].forEach(function (side) {
      add(root, 0.06, 0.06, (ctx.roofLen || ctx.len * 0.36), side * (ctx.roofW || ctx.w * 0.8) * 0.42, ctx.roofY + 0.06, ctx.roofZ || 0, railM);
    });
  }

  // ============================================================
  //  PER-MODEL IDENTITY on the unified visual — the small bolt-ons that
  //  split two same-silhouette siblings apart (and the taxi's roof gear,
  //  which the old chain dropped on the unified path — the known bug).
  // ============================================================
  function applyModelIdentity(root, model, ctx) {
    if (!model || !ctx) return;
    const ds = model.designStyle;
    if (model.livery === "taxi" || ds === "cab") addTaxiSign(root, ctx);
    if (ds === "kanzler") {
      // hood ornament + chrome rocker strip: old-money German luxury
      add(root, 0.035, 0.09, 0.035, 0, ctx.noseTopY + 0.05, ctx.frontZ - 0.32, chrome());
      add(root, ctx.w + 0.05, 0.045, ctx.len * 0.7, 0, ctx.baseY + 0.14, 0, chrome());
    } else if (ds === "surge" && ctx.paint) {
      add(root, ctx.w * 0.62, 0.05, 0.13, 0, ctx.noseTopY + 0.03, ctx.rearZ + 0.32, ctx.paint);   // lip spoiler
    } else if (ds === "kaze") {
      add(root, (ctx.roofW || ctx.w * 0.8) * 0.8, 0.05, 0.16, 0, ctx.roofY + 0.02, (ctx.roofZ || 0) - 0.45, darkTrim());
    } else if (ds === "apex") {
      // twin centre stripes down hood + deck
      [-0.14, 0.14].forEach(function (fx) {
        add(root, 0.16, 0.02, ctx.len * 0.88, fx, ctx.noseTopY + 0.09, 0, darkTrim());
      });
    } else if (ds === "halo" || ds === "frontier") {
      addRoofRails(root, ctx);
    } else if (ds === "eldorado") {
      add(root, ctx.w * 0.3, 0.05, 0.05, 0, ctx.noseTopY + 0.1, ctx.frontZ - 0.1, badgeGold());   // gold nose trim
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
      const b = BRANDS[styleOrBrand] || BRANDS[STYLE_BRAND[styleOrBrand]];
      return (b && b.rim) || "sport5";
    },
    mat: M,
  };
})();
