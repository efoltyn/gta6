/* ============================================================
   city/playercars.js - promoted player-car visuals.

   Ambient traffic stays on the tiny city/vehicles.js box rig. Only the car
   currently controlled by the player gets one richer child visual. This keeps
   traffic simulation and draw cost independent from garage variety.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const STYLE_ORDER = [
    "ferrari", "enzo", "veyron", "aventador", "porsche", "muscle", "lowrider",
    "tesla-s", "tesla-3", "tesla-x", "tesla-y", "hatch", "suv", "van",
    "cybertruck", "motorcycle", "helicopter", "boat",
  ];
  const STYLE_LABEL = {
    ferrari: "Ferrari",
    enzo: "Ferrari Enzo",
    veyron: "Bugatti Veyron",
    aventador: "Aventador",
    porsche: "Porsche 911",
    muscle: "Muscle Car",
    lowrider: "Lowrider",
    "tesla-s": "Tesla Model S",
    "tesla-3": "Tesla Model 3",
    "tesla-x": "Tesla Model X",
    "tesla-y": "Tesla Model Y",
    hatch: "Hot Hatch",
    suv: "SUV",
    van: "Cargo Van",
    cybertruck: "Cybertruck",
    motorcycle: "Superbike",
    helicopter: "Helicopter",
    boat: "Speedboat",
  };

  // ---- per-style HANDLING FEEL hooks (GTA vehicle-class inspired) ----
  // Multipliers the driving sim can read off car._playerCarFeel. Numbers are
  // tuned from GTA class behaviour: Super/Sports = grippy + fast, Muscle =
  // grunty but loose tail, Lowrider = floaty soft, SUV/Van = heavy & numb with
  // tippy body roll, Motorcycle = razor turn + low grip wheelspin. Helicopter
  // and Boat are flagged aircraft/marine so movement code can branch.
  const FEEL = {
    ferrari:    { class: "super",  accel: 1.18, top: 1.20, turn: 1.12, grip: 1.16, brake: 1.12, drift: 0.9, roll: 0.4 },
    enzo:       { class: "super",  accel: 1.20, top: 1.22, turn: 1.10, grip: 1.18, brake: 1.12, drift: 0.9, roll: 0.4 },
    veyron:     { class: "super",  accel: 1.24, top: 1.28, turn: 1.04, grip: 1.20, brake: 1.10, drift: 0.85, roll: 0.35 },
    aventador:  { class: "super",  accel: 1.16, top: 1.18, turn: 1.14, grip: 1.16, brake: 1.10, drift: 0.95, roll: 0.4 },
    porsche:    { class: "sports", accel: 1.12, top: 1.12, turn: 1.16, grip: 1.14, brake: 1.10, drift: 0.95, roll: 0.45 },
    muscle:     { class: "muscle", accel: 1.14, top: 1.10, turn: 0.92, grip: 0.88, brake: 0.95, drift: 1.35, roll: 0.7 },
    lowrider:   { class: "lowrider", accel: 0.92, top: 0.96, turn: 0.90, grip: 0.92, brake: 0.92, drift: 1.2, roll: 1.1 },
    "tesla-s":  { class: "sports", accel: 1.20, top: 1.08, turn: 1.04, grip: 1.10, brake: 1.05, drift: 0.9, roll: 0.5 },
    "tesla-3":  { class: "sedan",  accel: 1.10, top: 1.00, turn: 1.02, grip: 1.04, brake: 1.0, drift: 0.95, roll: 0.6 },
    "tesla-x":  { class: "suv",    accel: 1.02, top: 0.96, turn: 0.86, grip: 0.92, brake: 0.95, drift: 1.0, roll: 1.0 },
    "tesla-y":  { class: "suv",    accel: 1.04, top: 0.98, turn: 0.90, grip: 0.94, brake: 0.96, drift: 1.0, roll: 0.95 },
    hatch:      { class: "compact", accel: 1.0, top: 0.94, turn: 1.10, grip: 1.0, brake: 1.0, drift: 1.0, roll: 0.6 },
    suv:        { class: "suv",    accel: 0.96, top: 0.94, turn: 0.84, grip: 0.86, brake: 0.92, drift: 1.05, roll: 1.15 },
    van:        { class: "van",    accel: 0.86, top: 0.88, turn: 0.78, grip: 0.82, brake: 0.86, drift: 1.1, roll: 1.3 },
    cybertruck: { class: "suv",    accel: 1.06, top: 1.0, turn: 0.82, grip: 0.9, brake: 0.95, drift: 1.0, roll: 1.05 },
    motorcycle: { class: "motorcycle", accel: 1.22, top: 1.14, turn: 1.4, grip: 0.84, brake: 0.9, drift: 1.5, roll: 1.0, twoWheel: true },
    helicopter: { class: "helicopter", accel: 1.0, top: 1.3, turn: 1.0, grip: 1.0, brake: 1.0, drift: 1.0, roll: 0.0, air: true },
    boat:       { class: "boat",   accel: 1.0, top: 1.1, turn: 1.0, grip: 1.0, brake: 0.7, drift: 1.4, roll: 0.6, marine: true },
  };
  const DEFAULT_FEEL = { class: "sedan", accel: 1.0, top: 1.0, turn: 1.0, grip: 1.0, brake: 1.0, drift: 1.0, roll: 0.6 };

  const mats = new Map();
  const boxes = new Map();
  const prisms = new Map();
  const wheels = new Map();
  const spheres = new Map();
  const procTemplates = new Map();
  let ferrariTemplate = null;
  let ferrariLoading = false;
  let active = null;

  function sharedMat(key, color, opts) {
    let m = mats.get(key);
    if (m) return m;
    opts = opts || {};
    m = opts.basic
      ? new THREE.MeshBasicMaterial({ color: color })
      : new THREE.MeshLambertMaterial({
        color: color,
        emissive: opts.emissive || 0,
        emissiveIntensity: opts.ei == null ? 1 : opts.ei,
        side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
      });
    m._shared = true;
    mats.set(key, m);
    return m;
  }

  function boxGeo(w, h, d) {
    const key = w + "|" + h + "|" + d;
    let geo = boxes.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(w, h, d);
      geo._shared = true;
      boxes.set(key, geo);
    }
    return geo;
  }

  function prismGeo(width, profile) {
    const key = width + "|" + profile.map((p) => p.join(",")).join("|");
    let geo = prisms.get(key);
    if (geo) return geo;
    const pos = [];
    const half = width / 2;
    function tri(a, b, c) { pos.push(...a, ...b, ...c); }
    for (let side = -1; side <= 1; side += 2) {
      const x = side * half;
      for (let i = 1; i < profile.length - 1; i++) {
        const a = [x, profile[0][1], profile[0][0]];
        const b = [x, profile[i][1], profile[i][0]];
        const c = [x, profile[i + 1][1], profile[i + 1][0]];
        if (side < 0) tri(a, c, b); else tri(a, b, c);
      }
    }
    for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length;
      const a = [-half, profile[i][1], profile[i][0]];
      const b = [half, profile[i][1], profile[i][0]];
      const c = [half, profile[j][1], profile[j][0]];
      const d = [-half, profile[j][1], profile[j][0]];
      tri(a, b, c); tri(a, c, d);
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    geo._shared = true;
    prisms.set(key, geo);
    return geo;
  }

  function wheelGeo(radius, width) {
    const key = radius + "|" + width;
    let geo = wheels.get(key);
    if (!geo) {
      geo = new THREE.CylinderGeometry(radius, radius, width, 12);
      geo._shared = true;
      wheels.set(key, geo);
    }
    return geo;
  }

  function sphereGeo(radius) {
    let geo = spheres.get(radius);
    if (!geo) {
      geo = new THREE.SphereGeometry(radius, 10, 6);
      geo._shared = true;
      spheres.set(radius, geo);
    }
    return geo;
  }

  function addBox(root, w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), material);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.castShadow = false;
    root.add(mesh);
    return mesh;
  }

  function addPrism(root, width, profile, y, material) {
    const mesh = new THREE.Mesh(prismGeo(width, profile), material);
    mesh.position.y = y || 0;
    mesh.castShadow = false;
    root.add(mesh);
    return mesh;
  }

  function addSphere(root, radius, x, y, z, material, sx, sy, sz) {
    const mesh = new THREE.Mesh(sphereGeo(radius), material);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.scale.set(sx || 1, sy || 1, sz || 1);
    mesh.castShadow = false;
    root.add(mesh);
    return mesh;
  }

  function addWheels(root, width, length, radius, wheelWidth) {
    const tire = sharedMat("tire", 0x15171a);
    const hub = sharedMat("hub", 0x59616b);
    const wz = length * 0.32;
    [[width / 2, wz], [-width / 2, wz], [width / 2, -wz], [-width / 2, -wz]].forEach(function (p) {
      const wheel = new THREE.Mesh(wheelGeo(radius, wheelWidth), tire);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(p[0], radius, p[1]);
      wheel.castShadow = false;
      wheel.userData.playerWheel = true;
      root.add(wheel);
      const cap = new THREE.Mesh(wheelGeo(radius * 0.57, wheelWidth + 0.02), hub);
      cap.position.y = 0;
      wheel.add(cap);
    });
  }

  function collectWheels(root) {
    const out = [];
    root.traverse(function (o) {
      if ((o.userData && o.userData.playerWheel) || (o.name && /^wheel_(fl|fr|rl|rr)$/.test(o.name))) out.push(o);
    });
    root.userData.playerWheels = out;
  }

  function addRoadDetails(root, style, w, len, wheelR, baseH, cabin, paint, glass, trim, white, red) {
    const bodyY = wheelR * 0.55, bodyTop = bodyY + baseH;
    const plate = sharedMat("plate", 0xe8edf2, { emissive: 0x202428, ei: 0.3 });
    const chrome = sharedMat("road-chrome", 0xabb3bc, { emissive: 0x252a30, ei: 0.35 });
    const noGrille = /^tesla/.test(style);

    // Hood/trunk breaks, mirrors, door cuts and wheel-arch brows give every
    // silhouette readable vehicle anatomy before model-specific trim is added.
    addBox(root, w * 0.78, 0.035, len * 0.27, 0, bodyTop + 0.02, len * 0.31, paint);
    addBox(root, w * 0.74, 0.035, len * 0.18, 0, bodyTop + 0.02, -len * 0.39, paint);
    [1, -1].forEach(function (side) {
      addBox(root, 0.18, 0.12, 0.28, side * (w * 0.53), bodyTop + cabin[1][1] * 0.34, len * 0.15, trim);
      [-len * 0.14, len * 0.12].forEach(function (z) {
        addBox(root, 0.025, baseH * 0.72, 0.028, side * (w * 0.505), bodyY + baseH * 0.57, z, trim);
      });
      [len * 0.32, -len * 0.32].forEach(function (z) {
        addBox(root, 0.06, 0.09, len * 0.2, side * (w * 0.505), wheelR * 1.66, z, trim);
      });
    });
    addBox(root, w * 0.28, 0.13, 0.025, 0, bodyY + baseH * 0.45, -len * 0.5 - 0.075, plate);
    addBox(root, w * 0.96, 0.12, 0.16, 0, bodyY + 0.04, len * 0.5 - 0.03, trim);
    addBox(root, w * 0.96, 0.13, 0.14, 0, bodyY + 0.05, -len * 0.5 + 0.02, trim);
    if (!noGrille) addBox(root, w * 0.56, 0.2, 0.055, 0, bodyY + baseH * 0.38, len * 0.5 + 0.035, trim);
    else addBox(root, w * 0.5, 0.07, 0.045, 0, bodyY + baseH * 0.25, len * 0.5 + 0.03, trim);

    if (style === "porsche") {
      addSphere(root, 0.18, w * 0.3, bodyY + baseH * 0.72, len * 0.48, white, 1.2, 0.72, 0.38);
      addSphere(root, 0.18, -w * 0.3, bodyY + baseH * 0.72, len * 0.48, white, 1.2, 0.72, 0.38);
    } else {
      [1, -1].forEach(function (side) {
        const lightW = style === "aventador" || style === "enzo" ? w * 0.25 : w * 0.3;
        const light = addBox(root, lightW, 0.13, 0.065, side * w * 0.28, bodyY + baseH * 0.66, len * 0.5 + 0.045, white);
        if (style === "aventador" || style === "enzo") light.rotation.z = side * -0.16;
      });
    }
    if (/tesla|veyron/.test(style)) addBox(root, w * 0.82, 0.1, 0.06, 0, bodyY + baseH * 0.68, -len * 0.5 - 0.035, red);
    else [1, -1].forEach(function (side) {
      addBox(root, w * 0.28, 0.14, 0.065, side * w * 0.29, bodyY + baseH * 0.64, -len * 0.5 - 0.035, red);
    });

    if (/ferrari|enzo|aventador|porsche|veyron/.test(style)) {
      [1, -1].forEach(function (side) {
        addBox(root, 0.2, 0.12, 0.16, side * w * 0.25, bodyY + 0.11, -len * 0.5 - 0.06, chrome);
      });
    }
    root.userData.vehicleDims = { width: w, length: len, height: bodyTop + cabin[1][1], wheelbase: len * 0.64 };
  }

  function makeRoadCar(style) {
    const root = new THREE.Group();
    const paint = sharedMat("paint-" + style, ({
      "tesla-s": 0xd1262f, "tesla-3": 0x67717b, "tesla-x": 0x185bd6,
      "tesla-y": 0x1470e3, porsche: 0xf3cf39, aventador: 0xf28c28,
      ferrari: 0xd1262f, enzo: 0xe02025, veyron: 0x202225,
      muscle: 0x161922, lowrider: 0x7d2bd6, hatch: 0x2ec4d6,
    })[style] || 0xd1262f);
    paint._bodyPaint = true;   // per-car recolour (city/vehicles.js) targets this
    const dark = sharedMat("glass", 0x16242e, { emissive: 0x081015, ei: 0.35 });
    const red = sharedMat("rear-light", 0xff3344, { emissive: 0xff2233, ei: 0.7 });
    const white = sharedMat("front-light", 0xeaf8ff, { emissive: 0xc8efff, ei: 0.7 });
    let w = 2.0, len = 4.8, wheelR = 0.46, baseH = 0.62;
    let cabin = [[-1.48, 0], [-0.93, 0.75], [0.62, 0.75], [1.5, 0]];

    if (style === "ferrari") { w = 2.02; len = 4.62; wheelR = 0.47; baseH = 0.51; cabin = [[-1.1, 0], [-0.58, 0.61], [0.3, 0.61], [1.08, 0]]; }
    if (style === "tesla-3") { w = 1.92; len = 4.55; cabin = [[-1.42, 0], [-0.82, 0.77], [0.48, 0.77], [1.45, 0]]; }
    if (style === "tesla-x") { w = 2.08; len = 5.0; wheelR = 0.52; baseH = 0.76; cabin = [[-1.57, 0], [-1.0, 0.98], [0.58, 0.98], [1.58, 0]]; }
    if (style === "tesla-y") { w = 2.02; len = 4.72; wheelR = 0.5; baseH = 0.73; cabin = [[-1.47, 0], [-0.88, 0.88], [0.52, 0.88], [1.5, 0]]; }
    if (style === "porsche") { w = 1.94; len = 4.35; wheelR = 0.47; baseH = 0.57; cabin = [[-1.1, 0], [-0.68, 0.67], [0.42, 0.67], [1.0, 0]]; }
    if (style === "aventador") { w = 2.08; len = 4.72; wheelR = 0.48; baseH = 0.49; cabin = [[-1.08, 0], [-0.55, 0.57], [0.25, 0.57], [1.08, 0]]; }
    if (style === "enzo") { w = 2.03; len = 4.7; wheelR = 0.47; baseH = 0.5; cabin = [[-1.05, 0], [-0.55, 0.6], [0.28, 0.6], [1.08, 0]]; }
    if (style === "veyron") { w = 2.08; len = 4.55; wheelR = 0.5; baseH = 0.58; cabin = [[-1.2, 0], [-0.66, 0.68], [0.5, 0.68], [1.2, 0]]; }
    // long-hood American muscle: wide, low, a fat greenhouse set back
    if (style === "muscle") { w = 2.06; len = 4.95; wheelR = 0.5; baseH = 0.6; cabin = [[-1.35, 0], [-0.92, 0.66], [0.18, 0.66], [0.78, 0]]; }
    // lowrider: dropped ride height, long body, narrow chopped roofline
    if (style === "lowrider") { w = 2.04; len = 5.05; wheelR = 0.4; baseH = 0.56; cabin = [[-1.4, 0], [-0.86, 0.6], [0.42, 0.6], [1.3, 0]]; }
    // hot hatch: short, tall, upright greenhouse over a stubby body
    if (style === "hatch") { w = 1.84; len = 4.0; wheelR = 0.44; baseH = 0.66; cabin = [[-1.18, 0], [-0.74, 0.84], [0.86, 0.84], [1.36, 0]]; }

    const bodyY = wheelR * 0.55, bodyTop = bodyY + baseH;
    const bodyProfile = [[-len * 0.5, 0], [-len * 0.5, baseH * 0.62], [-len * 0.37, baseH], [len * 0.34, baseH], [len * 0.5, baseH * 0.58], [len * 0.5, 0]];
    addPrism(root, w, bodyProfile, bodyY, paint);
    addPrism(root, w * 0.84, cabin, bodyTop - 0.04, dark);
    addBox(root, w * 0.72, 0.08, len * 0.28, 0, bodyTop + cabin[1][1] * 0.74, -0.16, paint);
    // sculpted lower body: a contrasting rocker/sill down each flank + a slim
    // front splitter so the nose reads as a real bumper, not a flat box face.
    const sill = sharedMat("sill-" + style, 0x14171c);
    addBox(root, w + 0.04, 0.14, len * 0.9, 0, wheelR + 0.08, 0, sill);
    addBox(root, w * 0.96, 0.1, 0.18, 0, wheelR + 0.06, len * 0.5 - 0.04, sill);   // front splitter
    addRoadDetails(root, style, w, len, wheelR, baseH, cabin, paint, dark, sill, white, red);
    if (style === "ferrari") {
      addBox(root, w * 0.22, 0.22, 0.08, -w * 0.29, bodyY + baseH * 0.38, len * 0.5 + 0.04, sill);
      addBox(root, w * 0.22, 0.22, 0.08, w * 0.29, bodyY + baseH * 0.38, len * 0.5 + 0.04, sill);
      addBox(root, w * 0.34, 0.18, 0.08, 0, bodyY + baseH * 0.34, len * 0.5 + 0.05, paint);
    }
    if (style === "aventador") addBox(root, w * 0.76, 0.12, 0.16, 0, wheelR + baseH + 0.18, -len * 0.42, paint);
    if (style === "porsche") addBox(root, w * 0.72, 0.1, 0.14, 0, wheelR + baseH + 0.14, -len * 0.44, paint);
    if (style === "enzo") {
      addBox(root, w * 0.92, 0.1, 0.12, 0, wheelR + baseH + 0.11, -len * 0.44, paint);
      addBox(root, w * 0.32, 0.1, 0.12, 0, wheelR + 0.34, len * 0.51, sharedMat("enzo-black", 0x101317));
    }
    if (style === "veyron") {
      const orange = sharedMat("veyron-orange", 0xff6b20);
      addBox(root, w + 0.02, 0.17, len * 0.94, 0, wheelR + 0.12, 0, orange);
      addBox(root, w * 0.74, 0.12, 0.14, 0, wheelR + baseH + 0.16, -len * 0.42, paint);
    }
    if (style === "muscle") {
      const black = sharedMat("muscle-black", 0x0c0e12);
      // hood scoop + twin racing stripes up the long hood
      addBox(root, w * 0.34, 0.14, 0.6, 0, wheelR + baseH + 0.06, len * 0.28, black);
      addBox(root, 0.18, 0.02, len * 0.9, -0.28, wheelR + baseH * 0.95, 0, black);
      addBox(root, 0.18, 0.02, len * 0.9, 0.28, wheelR + baseH * 0.95, 0, black);
      // chunky rear wing
      addBox(root, w * 0.78, 0.08, 0.16, 0, wheelR + baseH + 0.26, -len * 0.46, black);
    }
    if (style === "lowrider") {
      const chrome = sharedMat("low-chrome", 0xc9ccd2, { emissive: 0x2a2d33, ei: 0.4 });
      const roof = sharedMat("low-roof", 0xf2f3f6);
      // chrome rocker trim down both sides + a painted hardtop roof cap
      addBox(root, w + 0.06, 0.07, len * 0.92, 0, wheelR + 0.05, 0, chrome);
      addBox(root, w * 0.7, 0.07, len * 0.32, 0, wheelR + baseH + cabin[1][1] * 0.86, -0.1, roof);
    }
    if (style === "hatch") {
      const black = sharedMat("hatch-black", 0x14171c);
      // roof-edge spoiler over the tailgate + a black A-pillar wrap
      addBox(root, w * 0.82, 0.06, 0.14, 0, wheelR + baseH + cabin[1][1] + 0.02, -len * 0.46, black);
      addBox(root, w * 0.86, 0.05, len * 0.94, 0, wheelR + baseH - 0.04, 0, black);
    }
    addWheels(root, w + 0.08, len, wheelR, 0.34);
    return root;
  }

  function makeCybertruck() {
    const root = new THREE.Group();
    const silver = sharedMat("cyber-silver", 0xa8afb2); silver._bodyPaint = true;
    const trim = sharedMat("cyber-trim", 0x20262a);
    const glass = sharedMat("cyber-glass", 0x17242b, { emissive: 0x081116, ei: 0.35 });
    const red = sharedMat("cyber-rear", 0xff3344, { emissive: 0xff2233, ei: 0.8 });
    const white = sharedMat("cyber-front", 0xe6f8ff, { emissive: 0xbbeeff, ei: 0.8 });
    const w = 2.28, len = 5.35, wheelR = 0.61;
    addBox(root, w, 0.74, len, 0, 0.93, 0, silver);
    addBox(root, w + 0.08, 0.2, len * 0.82, 0, 0.54, -0.08, trim);
    addPrism(root, w * 0.93, [[-2.0, 0], [-0.72, 1.18], [0.32, 1.18], [1.82, 0]], 1.12, silver);
    addPrism(root, w * 0.84, [[-1.62, 0], [-0.66, 0.93], [0.25, 0.93], [1.38, 0]], 1.2, glass);
    addBox(root, w * 0.88, 0.13, 0.09, 0, 1.02, len * 0.5 + 0.05, white);
    addBox(root, w * 0.88, 0.14, 0.09, 0, 1.06, -len * 0.5 - 0.05, red);
    [1, -1].forEach(function (side) {
      addBox(root, 0.08, 0.2, len * 0.84, side * (w * 0.51), 0.68, 0, trim);
      addBox(root, 0.025, 0.74, 0.03, side * (w * 0.505), 1.12, -0.28, trim);
      addBox(root, 0.035, 0.5, len * 0.34, side * (w * 0.47), 1.48, 0.28, glass);
      addBox(root, 0.16, 0.13, 0.3, side * (w * 0.54), 1.3, 0.85, trim);
    });
    addBox(root, w * 0.84, 0.08, len * 0.3, 0, 1.58, -len * 0.29, trim);   // dark tonneau cover
    addWheels(root, w + 0.13, len, wheelR, 0.43);
    root.userData.vehicleDims = { width: w, length: len, height: 2.3, wheelbase: len * 0.68 };
    return root;
  }

  // --- a tall boxy 3-box SUV: high greenhouse, roof rails, beefy fenders. ---
  function makeSUV() {
    const root = new THREE.Group();
    const paint = sharedMat("suv-paint", 0x2e3a4a); paint._bodyPaint = true;
    const dark = sharedMat("suv-glass", 0x16242e, { emissive: 0x081015, ei: 0.35 });
    const trim = sharedMat("suv-trim", 0x14171c);
    const rail = sharedMat("suv-rail", 0x40474f, { emissive: 0x1a1d22, ei: 0.3 });
    const red = sharedMat("rear-light", 0xff3344, { emissive: 0xff2233, ei: 0.7 });
    const white = sharedMat("front-light", 0xeaf8ff, { emissive: 0xc8efff, ei: 0.7 });
    const w = 2.16, len = 5.1, wheelR = 0.56, baseH = 0.92;
    addBox(root, w, baseH, len, 0, wheelR + baseH * 0.5, 0, paint);
    addBox(root, w + 0.06, 0.22, len * 0.96, 0, wheelR + 0.12, 0, trim);   // wide fender flares
    // tall upright greenhouse cab set back over rear seats
    addPrism(root, w * 0.9, [[-1.7, 0], [-1.2, 0.96], [1.0, 0.96], [1.6, 0]], wheelR + baseH, dark);
    addBox(root, w * 0.78, 0.1, len * 0.5, 0, wheelR + baseH + 0.96, -0.1, paint);   // flat roof
    addBox(root, 0.07, 0.07, len * 0.46, w * 0.4, wheelR + baseH + 1.02, -0.1, rail);  // roof rails
    addBox(root, 0.07, 0.07, len * 0.46, -w * 0.4, wheelR + baseH + 1.02, -0.1, rail);
    addBox(root, w * 0.9, 0.16, 0.08, 0, wheelR + baseH * 0.55, len * 0.5 + 0.04, white);
    addBox(root, w * 0.9, 0.18, 0.08, 0, wheelR + baseH * 0.6, -len * 0.5 - 0.04, red);
    addBox(root, w * 0.7, 0.4, 0.12, 0, wheelR + 0.18, len * 0.5 + 0.06, trim);   // brush-guard bumper
    [1, -1].forEach(function (side) {
      addBox(root, 0.035, 0.58, len * 0.43, side * (w * 0.455), wheelR + baseH + 0.49, -0.08, dark);
      addBox(root, 0.18, 0.14, 0.28, side * (w * 0.54), wheelR + baseH + 0.42, len * 0.22, trim);
    });
    addSphere(root, 0.46, 0, wheelR + baseH * 0.58, -len * 0.52, trim, 1, 1, 0.34);   // rear spare
    addWheels(root, w + 0.14, len, wheelR, 0.42);
    root.userData.vehicleDims = { width: w, length: len, height: wheelR + baseH + 1.08, wheelbase: len * 0.66 };
    return root;
  }

  // --- a tall long cargo van: flat slab sides (sliding-door crease), short hood. ---
  function makeVan() {
    const root = new THREE.Group();
    const paint = sharedMat("van-paint", 0xe9ebee); paint._bodyPaint = true;
    const dark = sharedMat("van-glass", 0x16242e, { emissive: 0x081015, ei: 0.35 });
    const trim = sharedMat("van-trim", 0x202428);
    const red = sharedMat("rear-light", 0xff3344, { emissive: 0xff2233, ei: 0.7 });
    const white = sharedMat("front-light", 0xeaf8ff, { emissive: 0xc8efff, ei: 0.7 });
    const w = 2.18, len = 5.6, wheelR = 0.5, boxH = 1.5;
    // big slab cargo box
    addBox(root, w, boxH, len * 0.74, 0, wheelR + boxH * 0.5, -len * 0.1, paint);
    // sliding-door crease line + lower rocker trim down the slab
    addBox(root, w + 0.02, 0.05, len * 0.7, 0, wheelR + boxH * 0.62, -len * 0.1, trim);
    addBox(root, w + 0.02, 0.18, len * 0.72, 0, wheelR + 0.1, -len * 0.1, trim);
    // sloped short hood up front
    addPrism(root, w * 0.96, [[len * 0.18, 0], [len * 0.18, 0.62], [len * 0.5, 0.62], [len * 0.5, 0.2]], wheelR + 0.06, paint);
    addPrism(root, w * 0.9, [[len * 0.16, 0], [len * 0.16, 0.5], [len * 0.46, 0.5]], wheelR + 0.62, dark);  // windshield
    addBox(root, w * 0.86, 0.5, 0.04, 0, wheelR + boxH - 0.3, len * 0.5 - 0.02, dark);   // cab side glass front
    addBox(root, w * 0.9, 0.18, 0.07, 0, wheelR + 0.32, len * 0.5 + 0.02, white);
    addBox(root, w * 0.92, 0.22, 0.07, 0, wheelR + boxH - 0.1, -len * 0.47 - 0.04, red);   // tall rear-door lights ON the cargo-box rear face (box ends at -len*0.47; the old -len*0.42 buried them INSIDE the box — invisible, so the van showed no tail/brake lights)
    [1, -1].forEach(function (side) {
      addBox(root, 0.035, 0.52, len * 0.16, side * (w * 0.505), wheelR + boxH * 0.68, len * 0.27, dark);
      addBox(root, 0.025, boxH * 0.72, 0.035, side * (w * 0.505), wheelR + boxH * 0.51, -len * 0.1, trim);
      addBox(root, 0.17, 0.13, 0.28, side * (w * 0.55), wheelR + boxH * 0.7, len * 0.35, trim);
    });
    addBox(root, 0.035, boxH * 0.74, 0.04, 0, wheelR + boxH * 0.5, -len * 0.47, trim);   // split rear doors
    addWheels(root, w + 0.1, len, wheelR, 0.4);
    root.userData.vehicleDims = { width: w, length: len, height: wheelR + boxH, wheelbase: len * 0.68 };
    return root;
  }

  // --- superbike: two fat wheels, fuel tank, low clip-on bars, tail cowl, rider. ---
  function makeMotorcycle() {
    const root = new THREE.Group();
    const paint = sharedMat("moto-paint", 0x16a0e0);
    const black = sharedMat("moto-black", 0x101317);
    const chrome = sharedMat("moto-chrome", 0xb9c0c8, { emissive: 0x1f242a, ei: 0.35 });
    const seat = sharedMat("moto-seat", 0x18191c);
    const rider = sharedMat("moto-rider", 0x20242c);
    const red = sharedMat("rear-light", 0xff3344, { emissive: 0xff2233, ei: 0.8 });
    const white = sharedMat("front-light", 0xeaf8ff, { emissive: 0xc8efff, ei: 0.8 });
    const wheelR = 0.42, wb = 0.78;   // wheelbase half-length
    // two in-line wheels (front/back along z)
    [[wb, 0.46], [-wb, 0.5]].forEach(function (p) {
      const wheel = new THREE.Mesh(wheelGeo(wheelR, p[1]), black);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(0, wheelR, p[0]);
      wheel.castShadow = false;
      wheel.userData.playerWheel = true;
      root.add(wheel);
      const disc = new THREE.Mesh(wheelGeo(wheelR * 0.45, p[1] + 0.02), chrome);
      wheel.add(disc);
    });
    // engine block + tank + tail, set low between the wheels
    addBox(root, 0.4, 0.42, 0.9, 0, wheelR + 0.18, -0.05, black);   // engine/gearbox mass
    addPrism(root, 0.46, [[0.45, 0.1], [0.2, 0.62], [-0.35, 0.55], [-0.45, 0.1]], wheelR + 0.36, paint);  // tank
    addBox(root, 0.34, 0.12, 0.5, 0, wheelR + 0.62, -0.42, seat);   // seat
    addPrism(root, 0.3, [[-0.3, 0.0], [-0.55, 0.34], [-0.7, 0.12]], wheelR + 0.62, paint);  // tail cowl
    // front fork + fairing + headlamp, raked forward over the front wheel
    addBox(root, 0.12, 0.95, 0.12, 0, wheelR + 0.5, wb - 0.05, chrome);   // fork tubes
    addPrism(root, 0.42, [[wb + 0.06, 0.0], [wb - 0.18, 0.62], [wb - 0.4, 0.2]], wheelR + 0.2, paint);  // front fairing
    addBox(root, 0.34, 0.18, 0.08, 0, wheelR + 0.55, wb + 0.04, white);   // headlamp
    addBox(root, 0.5, 0.06, 0.06, 0, wheelR + 0.95, wb - 0.18, black);   // clip-on bars
    addBox(root, 0.26, 0.14, 0.07, 0, wheelR + 0.68, -wb + 0.06, red);   // tail light
    // a hunched rider so it reads as ridden, not a parked bike
    const r = new THREE.Group();
    addBox(r, 0.42, 0.6, 0.34, 0, wheelR + 1.06, -0.18, rider);   // torso
    addBox(r, 0.24, 0.24, 0.24, 0, wheelR + 1.46, -0.05, sharedMat("moto-helmet", 0x0d0f12, { emissive: 0x05080a, ei: 0.3 }));  // helmet
    addBox(r, 0.5, 0.16, 0.5, 0, wheelR + 0.74, -0.42, rider);   // legs/hips
    r.name = "moto_rider";
    root.add(r);
    root.userData.leanRider = r;
    root.userData.vehicleDims = { width: 0.72, length: wb * 2 + 0.85, height: 1.9, wheelbase: wb * 2 };
    return root;
  }

  // --- light helicopter: fuselage pod, tail boom, skids, animated main + tail rotor. ---
  function makeHelicopter() {
    const root = new THREE.Group();
    const body = sharedMat("heli-body", 0x1b2b3c);
    const glass = sharedMat("heli-glass", 0x132330, { emissive: 0x0a141d, ei: 0.4 });
    const dark = sharedMat("heli-dark", 0x14171c);
    const blade = sharedMat("heli-blade", 0x202428);
    const tail = sharedMat("heli-tail", 0xd14a2a);
    const groundY = 0.34;   // skid clearance above the ground plane
    // rounded cockpit pod
    addPrism(root, 1.5, [[-1.4, 0], [-1.1, 1.0], [0.9, 1.0], [1.7, 0.55], [1.55, 0]], groundY, body);
    addPrism(root, 1.36, [[-0.4, 0.08], [0.2, 0.92], [1.4, 0.5], [1.3, 0.1]], groundY + 0.02, glass);  // bubble canopy
    // tapered tail boom reaching back
    addBox(root, 0.34, 0.34, 2.6, 0, groundY + 0.95, -2.4, body);
    addPrism(root, 0.4, [[0, 0.0], [0, 0.7], [-0.7, 0.5], [-0.6, 0.0]], groundY + 0.95, tail);  // tail fin
    // skids
    const skidY = 0.06;
    addBox(root, 0.08, 0.08, 2.0, 0.75, skidY, 0.2, dark);
    addBox(root, 0.08, 0.08, 2.0, -0.75, skidY, 0.2, dark);
    addBox(root, 0.1, 0.4, 0.1, 0.62, skidY + 0.22, 0.7, dark);   // skid struts
    addBox(root, 0.1, 0.4, 0.1, -0.62, skidY + 0.22, 0.7, dark);
    addBox(root, 0.1, 0.4, 0.1, 0.62, skidY + 0.22, -0.3, dark);
    addBox(root, 0.1, 0.4, 0.1, -0.62, skidY + 0.22, -0.3, dark);
    // main rotor: hub + 3 long blades, spins about Y
    const mast = groundY + 1.4;
    addBox(root, 0.18, 0.5, 0.18, 0, mast - 0.2, 0.1, dark);   // mast
    const mainRotor = new THREE.Group();
    mainRotor.position.set(0, mast, 0.1);
    const hub = new THREE.Mesh(boxGeo(0.3, 0.12, 0.3), dark); mainRotor.add(hub);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(boxGeo(6.4, 0.05, 0.26), blade);
      b.rotation.y = (i / 3) * Math.PI * 2;
      mainRotor.add(b);
    }
    mainRotor.name = "heli_mainRotor";
    root.add(mainRotor);
    root.userData.mainRotor = mainRotor;
    // tail rotor: 2 blades, spins about X at the tail
    const tailRotor = new THREE.Group();
    tailRotor.position.set(0.22, groundY + 1.05, -3.55);
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(boxGeo(0.06, 1.5, 0.16), blade);
      b.rotation.x = i * Math.PI / 2;
      tailRotor.add(b);
    }
    tailRotor.name = "heli_tailRotor";
    root.add(tailRotor);
    root.userData.tailRotor = tailRotor;
    root.userData.vehicleDims = { width: 2.1, length: 5.8, height: 2.1, wheelbase: 2.8 };
    return root;
  }

  // --- speedboat: V-hull, raked windshield, seats, outboard, animated prop wake. ---
  function makeBoat() {
    const root = new THREE.Group();
    const hull = sharedMat("boat-hull", 0xeceff2);
    const stripe = sharedMat("boat-stripe", 0x1574d6);
    const deck = sharedMat("boat-deck", 0x6b4a2c);
    const glass = sharedMat("boat-glass", 0x18303f, { emissive: 0x0a161f, ei: 0.4 });
    const dark = sharedMat("boat-dark", 0x101317);
    const chrome = sharedMat("boat-chrome", 0xb9c0c8, { emissive: 0x1f242a, ei: 0.35 });
    const w = 2.1, len = 6.2;
    const baseY = 0.25;
    // pointed planing V-hull (prism profile along z gives the bow rake)
    addPrism(root, w, [[len * 0.5, 0.0], [len * 0.2, 0.55], [-len * 0.5, 0.55], [-len * 0.5, 0.0]], baseY, hull);
    addBox(root, w + 0.02, 0.14, len * 0.7, 0, baseY + 0.34, -len * 0.06, stripe);   // waterline stripe
    addBox(root, w * 0.82, 0.06, len * 0.6, 0, baseY + 0.56, -len * 0.08, deck);   // open deck
    // raked windshield + low console mid-ship
    addPrism(root, w * 0.7, [[len * 0.08, 0.0], [len * 0.08, 0.4], [len * 0.24, 0.0]], baseY + 0.56, glass);
    addBox(root, w * 0.7, 0.22, 0.5, 0, baseY + 0.68, len * 0.04, dark);   // dash console
    // two bucket seats
    addBox(root, 0.5, 0.36, 0.5, w * 0.22, baseY + 0.74, -len * 0.06, dark);
    addBox(root, 0.5, 0.36, 0.5, -w * 0.22, baseY + 0.74, -len * 0.06, dark);
    // chrome bow rail
    addBox(root, w * 0.6, 0.05, 0.05, 0, baseY + 0.62, len * 0.34, chrome);
    // outboard engine at the transom + animated screw
    addBox(root, 0.46, 0.7, 0.5, 0, baseY + 0.4, -len * 0.5 - 0.1, dark);
    const prop = new THREE.Group();
    prop.position.set(0, baseY + 0.05, -len * 0.5 - 0.28);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(boxGeo(0.05, 0.5, 0.16), chrome);
      b.rotation.z = (i / 3) * Math.PI * 2;
      prop.add(b);
    }
    prop.name = "boat_prop";
    root.add(prop);
    root.userData.boatProp = prop;
    root.userData.vehicleDims = { width: w, length: len, height: 1.25, wheelbase: len * 0.6 };
    return root;
  }

  // Recolour the body PAINT of a freshly-cloned visual to `color`, leaving every
  // accent material (glass, trim, sills, stripes, chrome, lights) untouched. The
  // template's paint material is tagged `_bodyPaint`; clone(true) shares material
  // refs, so we swap those meshes onto a per-car cloned material (one per unique
  // source paint) and tag it `_playerCarOwned` so detach()/dispose can clean up.
  function recolorBody(root, color) {
    const c = new THREE.Color(color);
    const swapped = new Map();
    root.traverse(function (o) {
      const m = o.material;
      if (!m || Array.isArray(m) || !m._bodyPaint) return;
      let nm = swapped.get(m.id);
      if (!nm) {
        nm = m.clone();
        nm.color = c.clone();
        if (nm.emissive) nm.emissive = c.clone().multiplyScalar(0.16);
        nm._shared = false; nm._bodyPaint = false; nm._playerCarOwned = true;
        swapped.set(m.id, nm);
      }
      o.material = nm;
    });
  }

  function makeProcedural(style, color) {
    let template = procTemplates.get(style);
    if (!template) {
      if (style === "cybertruck") template = makeCybertruck();
      else if (style === "suv") template = makeSUV();
      else if (style === "van") template = makeVan();
      else if (style === "motorcycle") template = makeMotorcycle();
      else if (style === "helicopter") template = makeHelicopter();
      else if (style === "boat") template = makeBoat();
      else template = makeRoadCar(style);
      procTemplates.set(style, template);
    }
    const clone = template.clone(true);
    // clone(true) copies userData by reference, so animated-group handles still
    // point at the (hidden) template. Re-resolve them against the clone by name
    // so the per-frame update spins THIS instance's rotors/prop/rider.
    if (template.userData.mainRotor) clone.userData.mainRotor = clone.getObjectByName("heli_mainRotor");
    if (template.userData.tailRotor) clone.userData.tailRotor = clone.getObjectByName("heli_tailRotor");
    if (template.userData.boatProp) clone.userData.boatProp = clone.getObjectByName("boat_prop");
    if (template.userData.leanRider) clone.userData.leanRider = clone.getObjectByName("moto_rider");
    if (color != null) recolorBody(clone, color);
    return clone;
  }

  function markFerrariShared(root) {
    root.traverse(function (o) {
      if (o.geometry) o.geometry._shared = true;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach(function (m) { if (m) m._shared = true; });
    });
  }

  function preloadFerrari() {
    if (ferrariTemplate || ferrariLoading || !THREE.GLTFLoader) return;
    ferrariLoading = true;
    const loader = new THREE.GLTFLoader();
    if (THREE.DRACOLoader) {
      const draco = new THREE.DRACOLoader();
      draco.setDecoderPath("https://unpkg.com/three@0.128.0/examples/js/libs/draco/gltf/");
      loader.setDRACOLoader(draco);
    }
    loader.load("assets/cars/ferrari.glb", function (gltf) {
      ferrariTemplate = gltf.scene.children[0] || gltf.scene;
      markFerrariShared(ferrariTemplate);
      ferrariLoading = false;
      if (active && active.detailStyle === "ferrari") attach(active, "ferrari");
    }, undefined, function (err) {
      ferrariLoading = false;
      console.warn("[player car] Ferrari mesh unavailable; using lightweight sports fallback.", err);
    });
  }

  function importedFerrari(car) {
    if (!ferrariTemplate) return null;
    const root = ferrariTemplate.clone(true);
    const size = new THREE.Vector3();
    const bounds = new THREE.Box3().setFromObject(root);
    bounds.getSize(size);
    const scale = 4.72 / Math.max(size.x, size.z);
    root.scale.setScalar(scale);
    if (size.x > size.z) root.rotation.y = -Math.PI / 2;
    root.position.y = -bounds.min.y * scale;
    root.userData.vehicleDims = { width: Math.min(size.x, size.z) * scale, length: Math.max(size.x, size.z) * scale, height: size.y * scale, wheelbase: 2.65 };
    const body = root.getObjectByName("body");
    if (body && body.material && body.material.clone) {
      body.material = body.material.clone();
      body.material.color.setHex(car.color || 0xd1262f);
      body.material._playerCarOwned = true;
    }
    collectWheels(root);
    return root;
  }

  function placeholder(car, hide) {
    if (!car._cityPlaceholder) car._cityPlaceholder = car.group.children.slice();
    car._cityPlaceholder.forEach(function (child) { child.visible = !hide; });
  }

  function detach(car) {
    if (!car) return;
    if (car._playerCarVisual) {
      car._playerCarVisual.traverse(function (o) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach(function (m) { if (m && m._playerCarOwned && m.dispose) m.dispose(); });
      });
      car.group.remove(car._playerCarVisual);
      car._playerCarVisual = null;
    }
    car._visualDims = null;
    placeholder(car, false);
  }

  function attach(car, style) {
    if (!car) return false;
    if (active && active !== car) detach(active);
    detach(car);
    let visual = style === "ferrari" ? importedFerrari(car) : makeProcedural(style);
    if (!visual) visual = makeProcedural("aventador");
    collectWheels(visual);
    visual.name = "player-car-" + style;
    visual.userData.playerCarStyle = style;
    car.group.add(visual);
    car._playerCarVisual = visual;
    car._playerCarActualStyle = style;
    car._visualDims = visual.userData.vehicleDims || car.dims || null;
    // publish the handling-feel hook so the driving sim can read it per style.
    car._playerCarFeel = FEEL[style] || DEFAULT_FEEL;
    active = car;
    placeholder(car, true);
    return true;
  }

  // Resolve a procedural STYLE for a car or a raw model. Named models carry a
  // valid `detailStyle` (e.g. "suv","muscle","tesla-3"); otherwise fall back to
  // the name, then the body class, then a clean sedan. Used for BOTH the driven
  // car AND every ambient car now (city/vehicles.js builds the same visual).
  function inferStyle(car) {
    const model = car && (car.model || car);   // accept a car OR a model directly
    if (model && model.detailStyle && STYLE_LABEL[model.detailStyle]) return model.detailStyle;
    const name = model ? (model.name || "") : "";
    if (/ferrari/i.test(name)) return "ferrari";
    if (/charger|mustang|camaro|challenger/i.test(name)) return "muscle";
    if (/impala|cadillac|low\s*rider/i.test(name)) return "lowrider";
    if (/corvette|370z/i.test(name)) return "porsche";
    if (/harley|ducati|bike|moto|superbike|chopper/i.test(name)) return "motorcycle";
    if (/heli|chopper|buzzard|maverick/i.test(name)) return "helicopter";
    if (/boat|speedboat|jetmax|yacht|dinghy/i.test(name)) return "boat";
    if (/van|transit|sprinter|cargo/i.test(name)) return "van";
    if (/cybertruck/i.test(name)) return "cybertruck";
    if (/f-150|cherokee|escalade|suburban|tahoe|suv|range/i.test(name)) return "suv";
    if (/mercedes/i.test(name)) return "tesla-s";
    if (/prius|civic|golf|hatch/i.test(name)) return "hatch";
    if (/caravan/i.test(name)) return "tesla-y";
    // body-class fallback so generic traffic still gets a fitting silhouette
    const body = model && model.body;
    if (body === "muscle") return "muscle";
    if (body === "suv") return "suv";
    if (body === "van") return "van";
    if (body === "pickup") return "cybertruck";
    if (body === "coupe") return "porsche";
    if (body === "hatch") return "hatch";
    return "tesla-3";
  }
  CBZ.cityInferCarStyle = inferStyle;

  // Promotion no longer SWAPS the body — every car (city/vehicles.js) is already
  // built with its detailed, per-car-coloured visual. Promotion just registers
  // this car as the active one so the driving sim spins ITS wheels and reads its
  // handling feel. (Legacy fallback: a car built without a unified visual — e.g.
  // the headless box rig — still gets a hero overlay via attach.)
  CBZ.cityPromotePlayerCar = function (car) {
    if (!car) return;
    const grp = car.group, ud = grp && grp.userData;
    const visual = ud && ud.carVisual;
    if (visual) {
      collectWheels(visual);
      car._playerCarVisual = visual;
      car.detailStyle = ud.carStyle || inferStyle(car);
      car._playerCarFeel = FEEL[car.detailStyle] || DEFAULT_FEEL;
      car._visualDims = visual.userData.vehicleDims || car.dims || null;
      active = car;
      return;
    }
    car.detailStyle = car.detailStyle || inferStyle(car);
    if (car.detailStyle === "ferrari") preloadFerrari();
    attach(car, car.detailStyle);
  };

  CBZ.cityDemotePlayerCar = function (car) {
    // Only tear down a LEGACY overlay (one that hid a box rig). The unified
    // visual IS the car's permanent body — leave it in place when you step out.
    if (car && car._cityPlaceholder) detach(car);
    if (active === car) active = null;
  };

  // Rebuild a car's unified visual for a new style, keeping its colour. Used by
  // the [C] style-cycler AND any system that re-skins a car in place.
  function setUnifiedVisual(car, style) {
    const grp = car && car.group; if (!grp) return false;
    const ud = grp.userData;
    const old = ud.carVisual;
    if (old) {
      // crash deformation state (vertex rest snapshots, hung panels, dead-lamp
      // swaps) belongs to the OLD body — release it before the swap orphans it.
      if (CBZ.cityCarImpactReset) CBZ.cityCarImpactReset(car);
      old.traverse(function (o) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach(function (m) { if (m && m._playerCarOwned && m.dispose) m.dispose(); });
      });
      grp.remove(old);
    }
    if (style === "ferrari") preloadFerrari();
    const visual = makeProcedural(style, car.color);
    grp.add(visual);
    ud.carVisual = visual; ud.carStyle = style;
    collectWheels(visual);
    car.detailStyle = style;
    car._playerCarVisual = visual;
    car._playerCarFeel = FEEL[style] || DEFAULT_FEEL;
    car._visualDims = visual.userData.vehicleDims || car._visualDims || car.dims || null;
    return true;
  }
  CBZ.citySetCarVisual = setUnifiedVisual;

  CBZ.cityUpdatePlayerCarVisual = function (car, dt) {
    const visual = car && car._playerCarVisual;
    if (!visual) return;
    const ud = visual.userData;
    const list = ud.playerWheels || [];
    for (let i = 0; i < list.length; i++) list[i].rotation.x -= car.v * dt * 1.6;
    // motorcycle leans into the turn — read steering from heading change.
    if (ud.leanRider) {
      const dh = car.heading - (car._lastHeading == null ? car.heading : car._lastHeading);
      let d = dh; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      const bank = Math.max(-0.55, Math.min(0.55, (d / Math.max(dt, 0.001)) * 0.18 * Math.sign(car.v || 1)));
      visual.rotation.z += (bank - visual.rotation.z) * Math.min(1, dt * 8);
    }
    car._lastHeading = car.heading;
    // spinning rotors/props: faster with throttle, idle when parked. Blade blur
    // sells "running"; we keep the same mesh so draw cost is unchanged.
    const spin = (4 + Math.abs(car.v) * 0.5) * dt;
    if (ud.mainRotor) ud.mainRotor.rotation.y -= spin * 6;
    if (ud.tailRotor) ud.tailRotor.rotation.x -= spin * 10;
    if (ud.boatProp) ud.boatProp.rotation.z -= spin * 8;
  };

  CBZ.cityCyclePlayerCarStyle = function () {
    if (!active) return;
    const at = Math.max(0, STYLE_ORDER.indexOf(active.detailStyle));
    const style = STYLE_ORDER[(at + 1) % STYLE_ORDER.length];
    // unified path when the car carries a permanent visual; else legacy overlay.
    if (active.group && active.group.userData && active.group.userData.carVisual) setUnifiedVisual(active, style);
    else { active.detailStyle = style; if (style === "ferrari") preloadFerrari(); attach(active, style); }
    if (CBZ.city && CBZ.city.note) CBZ.city.note("Car style: " + STYLE_LABEL[style], 1.2);
  };

  CBZ.cityPlayerCarStyles = STYLE_ORDER.slice();
  CBZ.cityPlayerCarStyleLabels = Object.assign({}, STYLE_LABEL);
  CBZ.cityBuildPlayerCarVisual = function (style, color) {
    // The gallery uses the lightweight fallback so auditing all styles never
    // blocks on the optional high-poly GLB/network decoder. `color` (optional)
    // paints THIS instance's body without touching the shared style template.
    return makeProcedural(style, color);
  };
  // public handling-feel lookup so the driving sim / other systems can branch on
  // vehicle class (e.g. air/marine/twoWheel flags) and apply the multipliers.
  CBZ.cityPlayerCarFeel = function (style) {
    return FEEL[style] || (active && active._playerCarFeel) || DEFAULT_FEEL;
  };
  preloadFerrari();

  addEventListener("keydown", function (e) {
    const g = CBZ.game;
    if (!g || g.mode !== "city" || g.state !== "playing" || !CBZ.player.driving || e.repeat) return;
    if (e.key.toLowerCase() === "c") {
      e.preventDefault();
      CBZ.cityCyclePlayerCarStyle();
    }
  });
})();
