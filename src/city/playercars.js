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
    "tesla-s", "tesla-3", "tesla-x", "tesla-y", "hatch", "cybertruck",
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
    cybertruck: "Cybertruck",
  };

  const mats = new Map();
  const boxes = new Map();
  const prisms = new Map();
  const wheels = new Map();
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

  function addBox(root, w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), material);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  }

  function addPrism(root, width, profile, y, material) {
    const mesh = new THREE.Mesh(prismGeo(width, profile), material);
    mesh.position.y = y || 0;
    mesh.castShadow = true;
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
      wheel.castShadow = true;
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

  function makeRoadCar(style) {
    const root = new THREE.Group();
    const paint = sharedMat("paint-" + style, ({
      "tesla-s": 0xd1262f, "tesla-3": 0x67717b, "tesla-x": 0x185bd6,
      "tesla-y": 0x1470e3, porsche: 0xf3cf39, aventador: 0xf28c28,
      enzo: 0xe02025, veyron: 0x202225,
      muscle: 0x161922, lowrider: 0x7d2bd6, hatch: 0x2ec4d6,
    })[style] || 0xd1262f);
    const dark = sharedMat("glass", 0x16242e, { emissive: 0x081015, ei: 0.35 });
    const red = sharedMat("rear-light", 0xff3344, { emissive: 0xff2233, ei: 0.7 });
    const white = sharedMat("front-light", 0xeaf8ff, { emissive: 0xc8efff, ei: 0.7 });
    let w = 2.0, len = 4.8, wheelR = 0.46, baseH = 0.62;
    let cabin = [[-1.48, 0], [-0.93, 0.75], [0.62, 0.75], [1.5, 0]];

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

    addBox(root, w, baseH, len, 0, wheelR + baseH * 0.45, 0, paint);
    addPrism(root, w * 0.84, cabin, wheelR + baseH * 0.68, dark);
    addBox(root, w * 0.72, 0.08, len * 0.28, 0, wheelR + baseH + cabin[1][1] * 0.74, -0.16, paint);
    addBox(root, w * 0.84, 0.16, 0.07, 0, wheelR + baseH * 0.47, len * 0.5 + 0.04, white);
    addBox(root, w * 0.82, 0.15, 0.07, 0, wheelR + baseH * 0.5, -len * 0.5 - 0.04, red);
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
    const silver = sharedMat("cyber-silver", 0xa8afb2);
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
    addWheels(root, w + 0.13, len, wheelR, 0.43);
    return root;
  }

  function makeProcedural(style) {
    let template = procTemplates.get(style);
    if (!template) {
      template = style === "cybertruck" ? makeCybertruck() : makeRoadCar(style);
      procTemplates.set(style, template);
    }
    return template.clone(true);
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
    active = car;
    placeholder(car, true);
    return true;
  }

  function inferStyle(car) {
    const model = car && car.model;
    if (model && model.detailStyle) return model.detailStyle;
    const name = model ? model.name : "";
    if (/ferrari/i.test(name)) return "ferrari";
    if (/charger|mustang|camaro|challenger/i.test(name)) return "muscle";
    if (/impala|cadillac|low\s*rider/i.test(name)) return "lowrider";
    if (/corvette|370z/i.test(name)) return "porsche";
    if (/f-150|cherokee/i.test(name)) return "cybertruck";
    if (/mercedes/i.test(name)) return "tesla-s";
    if (/prius|civic|golf|hatch/i.test(name)) return "hatch";
    if (/caravan/i.test(name)) return "tesla-y";
    return "tesla-3";
  }

  CBZ.cityPromotePlayerCar = function (car) {
    if (!car) return;
    car.detailStyle = car.detailStyle || inferStyle(car);
    if (car.detailStyle === "ferrari") preloadFerrari();
    attach(car, car.detailStyle);
  };

  CBZ.cityDemotePlayerCar = function (car) {
    detach(car);
    if (active === car) active = null;
  };

  CBZ.cityUpdatePlayerCarVisual = function (car, dt) {
    const visual = car && car._playerCarVisual;
    if (!visual) return;
    const list = visual.userData.playerWheels || [];
    for (let i = 0; i < list.length; i++) list[i].rotation.x -= car.v * dt * 1.6;
  };

  CBZ.cityCyclePlayerCarStyle = function () {
    if (!active) return;
    const at = Math.max(0, STYLE_ORDER.indexOf(active.detailStyle));
    active.detailStyle = STYLE_ORDER[(at + 1) % STYLE_ORDER.length];
    if (active.detailStyle === "ferrari") preloadFerrari();
    attach(active, active.detailStyle);
    if (CBZ.city && CBZ.city.note) CBZ.city.note("Car style: " + STYLE_LABEL[active.detailStyle], 1.2);
  };

  CBZ.cityPlayerCarStyles = STYLE_ORDER.slice();
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
