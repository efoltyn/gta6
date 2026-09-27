/* ============================================================
   city/storegoods.js — A SHOP FLOOR THAT READS AS A SHOP.

   OWNER: "gun store having all the real guns for sale on shelves ... i dont
   want a store with a bunch of fake shit why should that even be built." And
   2026-09-27, the de-slop wave: "de-slopify every surface and prop ...
   furniture arranged like real people arrange rooms."

   WHAT THIS FILE REPLACED. The first cut of it stood three grey 2 m boxes a
   side and put TWO scaled-up item models on each board: a 22 cm apple, a
   burger the size of a loaf, round red and yellow blobs spaced a metre apart
   down the far walls of a 28 m hall whose middle was empty floor. From the
   door it read as a warehouse somebody had forgotten to stock. (And
   buildings.js's furnishShop, under it, had been painting rows of 22 cm
   coloured cubes on wall shelves whose own clearance gate never let a single
   one land. That dead code is deleted in the same wave.)

   WHAT A SHOP FLOOR IS, AND SO WHAT THIS FILE STANDS:
     - WALL BAYS down both side walls: a continuous run of 1.25 m sections on
       a perforated back panel, slotted uprights at every section, a base deck
       on a kick plate, four boards with a price channel on every lip and a
       header panel along the top. Full, not sparse.
     - GONDOLA AISLES through the middle: double-sided runs 1.6 m tall (you can
       see over them to the counter), end caps at both ends, broken by a cross
       aisle, and a clear main aisle from the door to the till.
     - A REACH-IN COOLER BANK where the trade sells drinks: black frame, glass
       doors with handles, lit interior, wire shelves, bottles and cans.
     - A COFFEE STATION at a gas station / corner store; a HOT FOOD WARMER on
       the counter where the trade sells hot food.
     - GOODS THAT READ AS GOODS: cereal boxes, cans, bottles, chip bags, jars,
       pill bottles, boxed electronics, paint cans, cartons — real sizes, faced
       up to the front of the board in blocks of one product the way a shop is
       merchandised, a price ticket under every block. Drawn as a handful of
       InstancedMeshes over ONE shared label atlas (a detail texture + a tint
       mask, so a white label panel stays white on a red box).
     - THE REAL, BUYABLE STOCK (cityEcon.stockFor(kind)) as the game's real
       item models (CBZ.itemAsset) at their real size, at waist height: cold
       drinks in the cooler, hot food in the warmer, coffee on the coffee
       station, everything else on the wall bays. [E] buys, [I] pockets (the
       clerk who can see it calls it in), and the unit leaves the shelf until
       the daily restock.

   COST. Nothing here is eager: a store's fixtures, goods and real stock are
   built only for the few stores near you (MAX_LIVE), as ~2 merged fixture
   meshes + ~12 instanced goods batches + one merged mesh per stocked product,
   with the fixtures solid (colliders pushed while live, removed after). The
   goods are drawn only inside SHOW_R. No lights: the ceiling fit-out
   (fitout_work.js) owns the troffers; these materials take the same night
   self-lit share the fit-out surfaces do, so a lit shop at night is lit.

   Everything is authored in BUILDING-LOCAL coordinates and parented to the
   shell's own group (a town's translated root included); world numbers are
   derived from the shell's matrixWorld (refreshWorld).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;

  // Kinds a FLAGSHIP walk-in already owns end to end (gunstore.js's wall,
  // jewelry.js's cases, clothingstore.js's racks, pawnshop.js, realtyoffice.js,
  // modshop/carlot showrooms), the civic counters, the bar, the bank — and the
  // trap house, which is a gang's front room, not a shop with gondolas.
  const SKIP = {
    guns: 1, jewelry: 1, pawn: 1, clothing: 1, boutique: 1, realtor: 1,
    carlot: 1, chop: 1, casino: 1, bar: 1, bank: 1, cityhall: 1, raceway: 1,
    courthouse: 1, federal: 1, cityannex: 1, postoffice: 1, dmv: 1,
    library: 1, firestation: 1, drugs: 1,
  };

  const LIVE_R = 48;        // a store BUILDS this far out (no pop-in at the glass)
  const SHOW_R = 26;        // …and DRAWS its goods only this close
  const MAX_LIVE = 3;       // never more than this many stores standing at once
  const REACH = 2.6;        // arm's length at the shelf
  const GOODS_BUDGET = 5000; // packaged-goods instances per store (see fillGoods)

  /* ---- THE PLAN, PER TRADE ------------------------------------------------
     walls     which side walls get a run of bays (+1 / -1 on the tangent)
     wallStart how far in from the door wall the runs begin (the front corners
               keep the plant, the bin, the window display)
     lanes     gondola lanes PER SIDE of the main aisle
     cooler    reach-in cooler doors at the back of one wall run (0 = none)
     coffee    a coffee station at the front of the other run
     mix       the packaged goods this trade sells */
  const PROFILE = {
    store:       { walls: [-1, 1], wallStart: 3.4, lanes: 3, cooler: 5, coffee: false, mix: "grocery" },
    gas:         { walls: [-1, 1], wallStart: 3.4, lanes: 3, cooler: 6, coffee: true, mix: "grocery" },
    transit:     { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 4, coffee: true, mix: "grocery" },
    food:        { walls: [-1, 1], wallStart: 10.6, lanes: 1, centreStart: 10.6, cooler: 4, coffee: false, mix: "grocery", warmer: true },
    hardware:    { walls: [-1, 1], wallStart: 4.4, lanes: 3, cooler: 0, coffee: false, mix: "hardware" },
    electronics: { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 0, coffee: false, mix: "electronics" },
    security:    { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 0, coffee: false, mix: "security" },
    hospital:    { walls: [1], wallStart: 12.6, lanes: 0, cooler: 0, coffee: false, mix: "pharmacy" },
    gym:         { walls: [1], wallStart: 10.6, lanes: 0, cooler: 3, coffee: false, mix: "grocery", maxBays: 5 },
    barber:      { walls: [1], wallStart: 8.2, lanes: 0, cooler: 0, coffee: false, mix: "beauty", maxBays: 3 },
    eyewear:     { walls: [-1, 1], wallStart: 3.4, lanes: 1, cooler: 0, coffee: false, mix: "eyewear" },
    arena:       { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 4, coffee: true, mix: "grocery" },
    paintball:   { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 3, coffee: false, mix: "hardware" },
    airfield:    { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 4, coffee: true, mix: "grocery" },
  };
  const DEFAULT_PROFILE = PROFILE.store;

  // where the REAL catalog items stand, by what they are
  const COLD = { Soda: 1, "Energy Drink": 1, Water: 1 };
  const HOT = { Burger: 1, Hotdog: 1, "Pizza Slice": 1, Fries: 1 };
  const BREW = { Coffee: 1 };

  /* ---- FIXTURE DIMENSIONS (metres, above the finished floor) --------------- */
  const BAY = 1.25;                                     // one shelf section
  const WALL = { deep: 0.47, h: 2.2, top: 2.46, levels: [0.14, 0.56, 0.96, 1.50, 1.90] };
  const GOND = { half: 0.50, h: 1.60, levels: [0.14, 0.56, 0.96, 1.30], cap: 0.40 };
  const COOL = { deep: 0.82, h: 2.25, levels: [0.2, 0.56, 0.92, 1.28, 1.62] };
  const REAL_LEVEL = 2;                                 // index into WALL.levels: the 0.96 board
  const COL = {
    body: 0xdcddd8, upright: 0xb7b9b6, board: 0xe9e9e4, kick: 0x4c5056,
    rail: 0xc3c7ca, ticket: 0xf6f6f0, sale: 0xf0cf36, perf: 0xe4e5e1,
    coolFrame: 0x1e2124, coolWire: 0x8d9398, coolLight: 0xe6eef0, handle: 0xc9ced3,
    lam: 0x6f5642, stone: 0xd9d5cc, splash: 0x3b3431, black: 0x1c1d1f, steel: 0xaab0b5,
    warmLight: 0xffcf8f,
  };
  const HEADER = [0x2f5d8a, 0x8a3530, 0x2f7a4a, 0x7a5a2a, 0x4a3f78, 0x1f6f6a];

  const PLANS = [];
  const BY_LOT = new WeakMap();
  const RECTS = new WeakMap();            // shell group -> local rects (fitout_work.js reads them)
  const S = { arena: null, live: [], scanT: 0, refreshed: false };
  const LIT = { value: 0.12 };           // night self-lit share (the fit-out's own formula)

  function econ() { return CBZ.cityEcon || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function hash01(x, z, k) { return CBZ.hash01 ? CBZ.hash01(x, z, k) : 0.5; }
  function today() { return (CBZ.dayCount ? CBZ.dayCount() : 0) | 0; }

  /* ============================================================
     0. SHARED MATERIALS + THE LABEL ATLAS (built once, never freed)
     ============================================================ */
  function litHook(mat, extra) {
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uSgLit = LIT;
      if (extra) extra(sh);
      sh.fragmentShader = sh.fragmentShader
        .replace("void main() {", "uniform float uSgLit;\nvoid main() {")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uSgLit;");
    };
    return mat;
  }
  let _mats = null;
  function perfTex() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d");
    x.fillStyle = "#e6e7e3"; x.fillRect(0, 0, 128, 128);
    x.fillStyle = "#6f7275";
    const p = 128 / 12;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
      x.beginPath(); x.arc((i + 0.5) * p, (j + 0.5) * p, 1.7, 0, Math.PI * 2); x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function mats() {
    if (_mats) return _mats;
    const fix = litHook(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const perf = litHook(new THREE.MeshLambertMaterial({ vertexColors: true, map: perfTex() }));
    const glass = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false });
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    const A = atlas();
    const goods = litHook(new THREE.MeshLambertMaterial({ map: A.detail }), function (sh) {
      sh.uniforms.uGoodsMask = { value: A.mask };
      sh.fragmentShader = sh.fragmentShader
        .replace("void main() {", "uniform sampler2D uGoodsMask;\nvoid main() {")
        .replace("#include <color_fragment>",
          "#if defined( USE_COLOR ) && defined( USE_MAP )\n" +
          "\tdiffuseColor.rgb *= mix( vec3( 1.0 ), vColor, texture2D( uGoodsMask, vUv ).r );\n" +
          "#elif defined( USE_COLOR )\n\tdiffuseColor.rgb *= vColor;\n#endif");
    });
    for (const m of [fix, perf, glass, glow, goods]) m._shared = true;
    _mats = { fix: fix, perf: perf, glass: glass, glow: glow, goods: goods };
    return _mats;
  }

  /* THE LABEL ATLAS. 4x4 cells of 128 px. `detail` is what is printed; `mask`
     says where the brand colour (the instance colour) applies — white = tint,
     black = keep the print as painted. So a cereal box is brand-red with a
     cream bowl panel, a soda can is brand-blue with a white wave and bare
     metal rims, and one texture + one material draws every product in town.
     No words anywhere (signage law): print is bars, bands, panels, photos. */
  const CELLS = 4, CS = 128;
  let _atlas = null;
  function atlas() {
    if (_atlas) return _atlas;
    const N = CELLS * CS;
    const cd = document.createElement("canvas"); cd.width = cd.height = N;
    const cm = document.createElement("canvas"); cm.width = cm.height = N;
    const D = cd.getContext("2d"), M = cm.getContext("2d");
    D.fillStyle = "#ffffff"; D.fillRect(0, 0, N, N);
    M.fillStyle = "#000000"; M.fillRect(0, 0, N, N);
    let ox = 0, oy = 0;
    function R(x, y, w, h, col, tint) {
      D.fillStyle = col; D.fillRect(ox + x, oy + y, w, h);
      M.fillStyle = tint ? "#ffffff" : "#000000"; M.fillRect(ox + x, oy + y, w, h);
    }
    function E(x, y, rx, ry, col, tint) {
      D.fillStyle = col; D.beginPath(); D.ellipse(ox + x, oy + y, rx, ry, 0, 0, Math.PI * 2); D.fill();
      M.fillStyle = tint ? "#ffffff" : "#000000"; M.beginPath(); M.ellipse(ox + x, oy + y, rx, ry, 0, 0, Math.PI * 2); M.fill();
    }
    function P(pts, col, tint) {
      D.fillStyle = col; M.fillStyle = tint ? "#ffffff" : "#000000";
      for (const X of [D, M]) {
        X.beginPath(); X.moveTo(ox + pts[0], oy + pts[1]);
        for (let i = 2; i < pts.length; i += 2) X.lineTo(ox + pts[i], oy + pts[i + 1]);
        X.closePath(); X.fill();
      }
    }
    function metal(y, h) {                          // a can rim / lid: bare brushed metal
      for (let i = 0; i < h; i++) { const t = 170 + ((Math.sin(i * 1.7) * 18) | 0); R(0, y + i, CS, 1, "rgb(" + t + "," + (t + 4) + "," + (t + 8) + ")", false); }
    }
    function bars(x, y, n, w, col) { for (let i = 0; i < n; i++) R(x, y + i * 6, w * (1 - i * 0.22), 3, col, false); }
    const DRAW = [
      function cereal() {
        R(0, 0, CS, CS, "#ffffff", true);
        R(10, 8, 108, 26, "#f5efdd", false); bars(16, 13, 3, 70, "#2b2b2b");
        E(64, 80, 46, 30, "#f3e9cf", false);
        for (let i = 0; i < 14; i++) E(36 + (i * 37) % 58, 70 + (i * 23) % 22, 7, 4, i & 1 ? "#d5973a" : "#e9bb5c", false);
        R(86, 112, 34, 12, "#f4f4f0", false);
      },
      function snack() {
        R(0, 0, CS, CS, "#ffffff", true);
        R(0, 0, CS, 10, "#9a9a9a", true);
        P([0, 70, 128, 34, 128, 58, 0, 94], "#f7f5ee", false);
        E(88, 96, 22, 18, "#c5773b", false); E(84, 92, 8, 6, "#e3a35e", false);
        bars(12, 20, 2, 60, "#f7f5ee");
      },
      function soda() {
        R(0, 0, CS, CS, "#ffffff", true);
        P([0, 58, 32, 48, 64, 62, 96, 50, 128, 60, 128, 76, 96, 66, 64, 78, 32, 64, 0, 74], "#f6f6f2", false);
        E(40, 96, 10, 10, "#f6f6f2", false);
        metal(0, 10); metal(118, 10);
      },
      function tin() {
        metal(0, 8); metal(120, 8);
        R(0, 8, CS, 22, "#ffffff", true);
        R(0, 30, CS, 66, "#efe4c8", false);
        E(44, 62, 20, 18, "#b5452a", false); E(76, 66, 16, 14, "#5f8f3a", false); E(58, 72, 10, 8, "#d9a441", false);
        bars(88, 40, 3, 34, "#3a3a3a");
        R(0, 96, CS, 24, "#ffffff", true);
      },
      function bottle() {
        R(0, 0, CS, 20, "#ffffff", true);              // cap
        R(0, 20, CS, 42, "#9da2a3", true);             // neck + shoulder (darker, tinted)
        R(0, 62, CS, 32, "#f4f4f0", false);            // label
        R(0, 70, CS, 10, "#ffffff", true); bars(10, 84, 1, 60, "#2d2d2d");
        R(0, 94, CS, 34, "#8f9394", true);             // lower body
      },
      function water() {
        R(0, 0, CS, 18, "#ffffff", true);              // cap
        R(0, 18, CS, 110, "#d4e5ee", false);
        for (let i = 0; i < 6; i++) R(i * 22 + 6, 18, 4, 110, "#edf5f9", false);
        R(0, 58, CS, 28, "#ffffff", true);
        P([0, 72, 40, 66, 80, 74, 128, 66, 128, 72, 80, 80, 40, 72, 0, 78], "#f6fbfd", false);
      },
      function chips() {
        R(0, 0, CS, CS, "#ffffff", true);
        R(0, 0, CS, 12, "#c7ccd1", false); R(0, 116, CS, 12, "#c7ccd1", false);
        for (let i = 0; i < 16; i++) { R(i * 8, 0, 2, 12, "#9aa0a6", false); R(i * 8, 116, 2, 12, "#9aa0a6", false); }
        bars(16, 20, 2, 80, "#f6f3e8");
        E(64, 78, 32, 28, "#f0cf6c", false);
        for (let i = 0; i < 8; i++) E(48 + (i * 13) % 34, 66 + (i * 17) % 26, 9, 5, "#d8a043", false);
      },
      function jar() {
        R(0, 0, CS, 18, "#ffffff", true);
        for (let i = 0; i < 6; i++) R(0, 2 + i * 3, CS, 1, "#c8c8c8", true);
        R(0, 18, CS, 110, "#7a2e1c", false);
        R(0, 50, CS, 46, "#f1e7cf", false); R(0, 58, CS, 10, "#ffffff", true); bars(14, 74, 2, 60, "#3a2a20");
      },
      function medbox() {
        R(0, 0, CS, CS, "#f3f4f5", false);
        R(0, 40, CS, 30, "#ffffff", true);
        E(96, 96, 22, 12, "#ffffff", true);
        bars(12, 12, 3, 70, "#7d848c"); bars(12, 82, 2, 50, "#7d848c");
      },
      function pills() {
        R(0, 0, CS, 16, "#e9e9e6", false);
        R(0, 16, CS, 112, "#f2f2f0", false);
        R(0, 50, CS, 30, "#ffffff", true); bars(12, 86, 2, 70, "#8a8f94");
      },
      function ebox() {
        R(0, 0, CS, CS, "#1d1f22", false);
        const g = D.createLinearGradient(0, oy + 22, 0, oy + 94);
        g.addColorStop(0, "#56697a"); g.addColorStop(1, "#27313b");
        D.fillStyle = g; D.fillRect(ox + 14, oy + 22, 100, 72);
        R(20, 28, 88, 3, "#8fa3b3", false);
        R(0, 108, CS, 8, "#ffffff", true); bars(14, 8, 2, 56, "#e6e6e6");
      },
      function paint() {
        metal(0, 128);
        R(0, 30, CS, 74, "#ffffff", true);
        R(18, 44, 38, 38, "#f4f4f0", false); bars(66, 50, 3, 44, "#2a2a2a");
        R(0, 0, CS, 6, "#9ea3a8", false); R(0, 122, CS, 6, "#9ea3a8", false);
      },
      function carton() {
        R(0, 0, CS, CS, "#b3875a", false);
        for (let i = 0; i < 40; i++) R((i * 29) % 128, (i * 47) % 128, 18, 1, "#a47a4f", false);
        R(8, 8, 112, 44, "#ffffff", true);
        R(14, 60, 52, 52, "#f0f0ec", false); R(24, 80, 32, 10, "#5a6068", false); R(50, 72, 8, 26, "#5a6068", false);
        bars(74, 66, 3, 44, "#3b2b1c");
      },
      function spray() {
        R(0, 0, CS, 28, "#ffffff", true);
        R(0, 28, CS, 100, "#ffffff", true);
        R(0, 60, CS, 40, "#f4f4f0", false); bars(12, 66, 3, 70, "#303030");
      },
      function caseCell() {
        R(0, 0, CS, CS, "#ffffff", true);
        R(0, 58, CS, 6, "#c9a54a", false);
      },
      function carafe() {
        R(0, 0, CS, 18, "#1b1b1b", false);
        R(0, 18, CS, 26, "#c9d3d6", false);
        R(0, 44, CS, 84, "#3b2417", false);
        for (let i = 0; i < 4; i++) R(i * 32 + 6, 44, 5, 84, "#5a3b28", false);
      },
    ];
    for (let i = 0; i < DRAW.length; i++) {
      ox = (i % CELLS) * CS; oy = ((i / CELLS) | 0) * CS;
      D.save(); D.beginPath(); D.rect(ox, oy, CS, CS); D.clip();
      M.save(); M.beginPath(); M.rect(ox, oy, CS, CS); M.clip();
      try { DRAW[i](); } catch (e) { /* a cell that fails to paint stays plain */ }
      D.restore(); M.restore();
    }
    const detail = new THREE.CanvasTexture(cd);
    detail.encoding = THREE.sRGBEncoding;
    const mask = new THREE.CanvasTexture(cm);
    for (const t of [detail, mask]) {
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      try { const Rr = CBZ.renderer; if (Rr && Rr.capabilities) t.anisotropy = Math.min(4, Rr.capabilities.getMaxAnisotropy()); } catch (e) {}
    }
    _atlas = { detail: detail, mask: mask };
    return _atlas;
  }
  const CELL = { cereal: 0, snack: 1, soda: 2, tin: 3, bottle: 4, water: 5, chips: 6, jar: 7,
    medbox: 8, pills: 9, ebox: 10, paint: 11, carton: 12, spray: 13, case: 14, carafe: 15 };
  function cellRect(i) {
    const cx = i % CELLS, cy = (i / CELLS) | 0, s = 1 / CELLS, m = 1.5 / (CELLS * CS);
    return { u0: cx * s + m, u1: (cx + 1) * s - m, v0: 1 - (cy + 1) * s + m, v1: 1 - cy * s - m };
  }

  /* ---- UNIT GOODS GEOMETRY: base on y = 0, 1 m on every axis, front = +z --- */
  const GEO = Object.create(null);
  function remapGroup(geo, gi, fn) {
    const g = geo.groups[gi]; if (!g) return;
    const uv = geo.attributes.uv, idx = geo.index, seen = new Set();
    for (let k = g.start; k < g.start + g.count; k++) {
      const v = idx ? idx.getX(k) : k;
      if (seen.has(v)) continue; seen.add(v);
      const o = fn(uv.getX(v), uv.getY(v), v);
      uv.setXY(v, o[0], o[1]);
    }
  }
  function goodsGeo(shape, cell) {
    const key = shape + ":" + cell;
    if (GEO[key]) return GEO[key];
    const C = cellRect(cell), du = C.u1 - C.u0, dv = C.v1 - C.v0;
    const full = function (u, v) { return [C.u0 + u * du, C.v0 + v * dv]; };
    const edge = function (u, v) { return [C.u0 + u * du * 0.07, C.v0 + v * dv]; };        // side strip
    const cap = function () { return [C.u0 + du * 0.5, C.v1 - dv * 0.02]; };              // lid / rim colour
    let geo;
    if (shape === "box" || shape === "bag") {
      geo = new THREE.BoxGeometry(1, 1, 1, 1, shape === "bag" ? 4 : 1, 1);
      geo.translate(0, 0.5, 0);
      // groups: +x, -x, +y, -y, +z (front), -z
      remapGroup(geo, 0, edge); remapGroup(geo, 1, edge);
      remapGroup(geo, 2, function (u, v) { return [C.u0 + u * du * 0.07, C.v1 - (1 - v) * dv * 0.04]; });
      remapGroup(geo, 3, cap);
      remapGroup(geo, 4, full); remapGroup(geo, 5, full);
      if (shape === "bag") {
        // a chip bag: pillowed, crimped flat at the top seam
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i), t = Math.max(0, Math.min(1, (y - 0.72) / 0.28)), s = t * t * (3 - 2 * t);
          const bt = Math.max(0, Math.min(1, (0.18 - y) / 0.18));
          p.setZ(i, p.getZ(i) * (1 - 0.82 * s) * (1 - 0.3 * bt));
          p.setX(i, p.getX(i) * (1 - 0.04 * s));
        }
        geo.computeVertexNormals();
      }
    } else if (shape === "cyl") {
      geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, false);
      geo.translate(0, 0.5, 0);
      remapGroup(geo, 0, full);
      remapGroup(geo, 1, cap); remapGroup(geo, 2, cap);
      // the bottom cap stands on a board and is never seen: drop its triangles
      const g2 = geo.groups[2];
      if (g2 && geo.index) {
        const a = geo.index.array, keep = [];
        for (let i = 0; i < a.length; i++) if (i < g2.start || i >= g2.start + g2.count) keep.push(a[i]);
        geo.setIndex(keep);
        geo.clearGroups();
      }
    } else {                                             // "bottle": a lathe, v by height
      const pts = [[0.47, 0.0], [0.5, 0.05], [0.5, 0.58], [0.2, 0.78], [0.17, 0.86],
        [0.2, 0.985], [0.001, 1]].map(function (q) { return new THREE.Vector2(q[0], q[1]); });
      geo = new THREE.LatheGeometry(pts, 8);
      const p = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) { const o = full(uv.getX(i), p.getY(i)); uv.setXY(i, o[0], o[1]); }
    }
    if (geo.attributes.uv2) geo.deleteAttribute("uv2");
    geo.computeBoundingSphere();
    GEO[key] = geo;
    return geo;
  }

  /* ---- THE PRODUCTS --------------------------------------------------------
     w/h/d in metres (cyl/bottle: w is the diameter). rows: how many deep a
     cylinder stands (boxes are one long facing to the back of the board). */
  const PAL = {
    brand: [0xb8322a, 0xd4621e, 0xdc9f22, 0x2e8b3e, 0x1f6f5c, 0x2a64a8, 0x243f8f, 0x6d3a8e, 0x8c1f3f, 0x3b2f2a, 0xc9b27a, 0x4a4f57, 0x9c2b22, 0x157a8c],
    water: [0xcfe3ee, 0xd9ecf3, 0xbfd8e6, 0x9fc8e0],
    dark: [0x2a2d31, 0x1f2226, 0x3a3f46, 0xe9e9e6, 0x2a64a8, 0xb8322a],
    white: [0xffffff],
  };
  const T = {
    cereal: { g: "box", c: "cereal", w: 0.19, h: 0.29, d: 0.07, pal: "brand" },
    snack: { g: "box", c: "snack", w: 0.15, h: 0.21, d: 0.05, pal: "brand" },
    soda: { g: "cyl", c: "soda", w: 0.066, h: 0.122, pal: "brand", rows: 2 },
    tin: { g: "cyl", c: "tin", w: 0.076, h: 0.11, pal: "brand", rows: 2 },
    bottle: { g: "bottle", c: "bottle", w: 0.072, h: 0.3, pal: "brand", rows: 2 },
    water: { g: "bottle", c: "water", w: 0.066, h: 0.24, pal: "water", rows: 2 },
    chips: { g: "bag", c: "chips", w: 0.21, h: 0.28, d: 0.09, pal: "brand" },
    jar: { g: "cyl", c: "jar", w: 0.082, h: 0.13, pal: "brand", rows: 2 },
    medbox: { g: "box", c: "medbox", w: 0.11, h: 0.13, d: 0.045, pal: "brand" },
    pills: { g: "cyl", c: "pills", w: 0.055, h: 0.1, pal: "brand", rows: 2 },
    ebox: { g: "box", c: "ebox", w: 0.2, h: 0.16, d: 0.07, pal: "dark" },
    ebig: { g: "box", c: "ebox", w: 0.42, h: 0.3, d: 0.12, pal: "dark", low: true },
    paint: { g: "cyl", c: "paint", w: 0.17, h: 0.19, pal: "brand", rows: 2, low: true },
    carton: { g: "box", c: "carton", w: 0.3, h: 0.13, d: 0.22, pal: "brand", low: true },
    tool: { g: "box", c: "carton", w: 0.16, h: 0.24, d: 0.06, pal: "brand" },
    spray: { g: "bottle", c: "spray", w: 0.066, h: 0.23, pal: "brand", rows: 2 },
    case: { g: "box", c: "case", w: 0.16, h: 0.06, d: 0.07, pal: "dark" },
    carafe: { g: "bottle", c: "carafe", w: 0.15, h: 0.22, pal: "white", rows: 1 },
    cups: { g: "cyl", c: "pills", w: 0.09, h: 0.34, pal: "brand", rows: 1 },
  };
  const MIX = {
    grocery: [["cereal", 3], ["snack", 3], ["soda", 2], ["tin", 3], ["bottle", 2], ["water", 1], ["chips", 3], ["jar", 2]],
    drinks: [["soda", 4], ["bottle", 3], ["water", 2]],
    hardware: [["paint", 3], ["carton", 3], ["tool", 3], ["spray", 2], ["jar", 1]],
    electronics: [["ebox", 5], ["ebig", 2], ["case", 1]],
    pharmacy: [["medbox", 5], ["pills", 3], ["spray", 1], ["jar", 1]],
    beauty: [["spray", 3], ["pills", 1], ["jar", 2], ["case", 1]],
    eyewear: [["case", 4], ["medbox", 1]],
    security: [["ebox", 3], ["ebig", 1], ["carton", 2]],
  };
  function pick(mixName, r, level, clr) {
    const mix = MIX[mixName] || MIX.grocery;
    let tot = 0;
    const w = [];
    for (let i = 0; i < mix.length; i++) {
      const t = T[mix[i][0]];
      let wt = t.h <= clr - 0.02 ? mix[i][1] : 0;
      if (t.low) wt *= level <= 1 ? 2 : 0.4;
      w.push(wt); tot += wt;
    }
    if (tot <= 0) return null;
    let x = r * tot;
    for (let i = 0; i < mix.length; i++) { x -= w[i]; if (x <= 0) return mix[i][0]; }
    return mix[mix.length - 1][0];
  }

  /* ============================================================
     1. THE FIXTURE KIT — boxes into merge buckets (vertex colour)
     ============================================================ */
  const FACES = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const HC = new THREE.Color();
  function Kit(fy) {
    const B = Object.create(null);
    function bk(key) { return B[key] || (B[key] = { pos: [], nor: [], col: [], uv: [], idx: [] }); }
    // (x, y, z) = CENTRE, building-local.
    function box(key, x, y, z, w, h, d, hex) {
      if (!(w > 0.001 && h > 0.001 && d > 0.001)) return;
      const k = bk(key);
      HC.setHex(hex >>> 0);
      const hw = w / 2, hh = h / 2, hd = d / 2, ext = [hw, hh, hd];
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        if (f === 3 && y - hh <= fy + 0.01) continue;                     // no underside on the floor
        const nx = F.n[0], ny = F.n[1], nz = F.n[2];
        const cx = x + nx * hw, cy = y + ny * hh, cz = z + nz * hd;
        const uh = Math.abs(F.u[0]) * ext[0] + Math.abs(F.u[1]) * ext[1] + Math.abs(F.u[2]) * ext[2];
        const vh = Math.abs(F.v[0]) * ext[0] + Math.abs(F.v[1]) * ext[1] + Math.abs(F.v[2]) * ext[2];
        const base = k.pos.length / 3;
        for (let q = 0; q < 4; q++) {
          const su = (q === 0 || q === 3) ? -1 : 1, sv = q < 2 ? -1 : 1;
          const px = cx + F.u[0] * su * uh + F.v[0] * sv * vh;
          const py = cy + F.u[1] * su * uh + F.v[1] * sv * vh;
          const pz = cz + F.u[2] * su * uh + F.v[2] * sv * vh;
          k.pos.push(px, py, pz); k.nor.push(nx, ny, nz);
          // contact shade: the foot of every vertical face, the underside of boards
          let s = 1;
          if (ny === 0) { const up = py - fy; if (up < 0.3) s = 0.7 + 0.3 * Math.max(0, up / 0.3); }
          else if (ny < 0) s = 0.78;
          k.col.push(HC.r * s, HC.g * s, HC.b * s);
          if (key === "perf") {
            const U = nx ? pz : px, V = ny ? pz : py;
            k.uv.push(U / 0.3, V / 0.3);
          }
        }
        k.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    function finish(group) {
      const M = mats(), out = [];
      for (const key in B) {
        const k = B[key];
        if (!k.idx.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(k.pos, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(k.nor, 3));
        g.setAttribute("color", new THREE.Float32BufferAttribute(k.col, 3));
        if (key === "perf") g.setAttribute("uv", new THREE.Float32BufferAttribute(k.uv, 2));
        const n = k.pos.length / 3;
        g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(k.idx), 1) : new THREE.BufferAttribute(new Uint16Array(k.idx), 1));
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, M[key] || M.fix);
        m.castShadow = false; m.receiveShadow = key !== "glow" && key !== "glass";
        if (key === "glass") m.renderOrder = 2;
        m.matrixAutoUpdate = false; m.updateMatrix();
        group.add(m); out.push(m);
      }
      return out;
    }
    return { box: box, finish: finish };
  }

  /* ============================================================
     2. THE PLAN — pure data, computed once at city build
     ============================================================ */
  function frameOf(b) {
    const dr = b.localDoor;
    if (!dr) return null;
    const inx = dr.nx || 0, inz = dr.nz || 0;
    if (!inx && !inz) return null;
    const tx = -inz, tz = inx, along = Math.abs(inx) > 0.5;
    const halfIn = (along ? b.w : b.d) / 2, halfTan = (along ? b.d : b.w) / 2;
    const wt = b.wt != null ? b.wt : 0.4;
    const F = {
      inx: inx, inz: inz, tx: tx, tz: tz, along: along, halfIn: halfIn, halfTan: halfTan, wt: wt,
      Ti: halfTan - wt, Bi: 2 * halfIn - wt,
      x: function (d, l) { return inx * (-halfIn + d) + tx * l; },
      z: function (d, l) { return inz * (-halfIn + d) + tz * l; },
      d: function (x, z) { return x * inx + z * inz + halfIn; },
      l: function (x, z) { return x * tx + z * tz; },
    };
    return F;
  }
  // a box in the door frame: centre (d, l), BOTTOM y0, extent du on IN, dl on the tangent
  function fbox(kit, F, key, d, l, y0, du, dl, h, col) {
    kit.box(key, F.x(d, l), y0 + h / 2, F.z(d, l), F.along ? du : dl, h, F.along ? dl : du, col);
  }
  function clearAt(b, F, d, l, pad) { return !b.clearFloorPoint || b.clearFloorPoint(F.x(d, l), F.z(d, l), pad); }

  function counterOf(b, F) {
    const s = CBZ.fitoutSiteOf ? CBZ.fitoutSiteOf(b) : null;
    const rec = s && s.floors && s.floors[0];
    const K = rec && rec.info && rec.info.counter;
    if (!K) return null;
    const cIn = F.d(K.x, K.z), cLat = F.l(K.x, K.z);
    const hIn = (F.along ? K.w : K.d) / 2, hLat = (F.along ? K.d : K.w) / 2;
    return { cIn: cIn, cLat: cLat, hIn: hIn, hLat: hLat };
  }

  // a board goods can stand on. (d, l) is the FRONT-EDGE MIDPOINT; the run is
  // `len` along `ax` (IN or tangent), goods face `fd` (+/-1) on the OTHER axis.
  function board(plan, o) { plan.boards.push(o); return o; }

  function planWalls(plan, prof, F, b, K) {
    const out = [];
    const end = Math.min(2 * F.halfIn - 5.0, K ? K.cIn - K.hIn - 1.8 : 1e9);
    for (let si = 0; si < prof.walls.length; si++) {
      const s = prof.walls[si];
      const L0 = prof.wallStart, n = Math.floor((end - L0) / BAY);
      if (n < 1) continue;
      // test each bay: centre + both ends, with the unit's half-depth as pad
      const ok = [];
      for (let i = 0; i < n; i++) {
        const dc = L0 + (i + 0.5) * BAY, lc = s * (F.Ti - WALL.deep / 2);
        const pad = WALL.deep / 2 - 0.06;
        ok.push(clearAt(b, F, dc, lc, pad) && clearAt(b, F, dc - BAY / 2 + 0.08, lc, pad) && clearAt(b, F, dc + BAY / 2 - 0.08, lc, pad));
      }
      let i = 0;
      while (i < n) {
        if (!ok[i]) { i++; continue; }
        let j = i;
        while (j + 1 < n && ok[j + 1]) j++;
        out.push({ s: s, d0: L0 + i * BAY, d1: L0 + (j + 1) * BAY, bays: j - i + 1 });
        i = j + 1;
      }
    }
    // a small trade keeps only a few bays
    if (prof.maxBays) {
      for (const r of out) if (r.bays > prof.maxBays) { r.d1 = r.d0 + prof.maxBays * BAY; r.bays = prof.maxBays; }
    }
    return out;
  }

  function planLanes(plan, prof, F, b, K) {
    const out = [];
    if (!prof.lanes) return out;
    const d0 = prof.centreStart || 5.6;
    const d1 = Math.min(2 * F.halfIn - 6.6, K ? K.cIn - K.hIn - 2.4 : 1e9);
    if (d1 - d0 < 3) return out;
    // the main aisle: door (lat 0) to the till (lat cLat), 1.5 m clear each side
    const aLo = Math.min(0, K ? K.cLat : 0) - 1.5, aHi = Math.max(0, K ? K.cLat : 0) + 1.5;
    const W = GOND.half, AIS = 1.8;
    const maxOuter = F.Ti - WALL.deep - 1.5;             // an aisle in front of the wall bays
    // as many lanes as fit at a real aisle pitch (<= the trade's count), spread
    // EVENLY from the main aisle to the wall aisle: a store floor, not a cluster
    // of gondolas in the middle of an empty hall
    const n = Math.max(0, Math.min(prof.lanes, Math.floor((maxOuter - 1.6) / (2 * W + AIS))));
    if (!n) return out;
    const pitch = (maxOuter - 1.6) / n;
    for (const s of [-1, 1]) {
      for (let k = 0; k < n; k++) {
        const c = s * (1.6 + pitch * (k + 0.5));
        if (c + W > aLo && c - W < aHi) continue;
        // segments of <= 8 m, split by 2 m cross aisles
        const L = d1 - d0, nSeg = Math.max(1, Math.ceil((L + 2) / 10));
        const seg = (L - 2 * (nSeg - 1)) / nSeg;
        if (seg < 2.4) continue;
        for (let q = 0; q < nSeg; q++) {
          let a = d0 + q * (seg + 2), z = a + seg;
          // shrink from both ends until every sample along the spine is clear
          let good = false;
          for (let tries = 0; tries < 6 && z - a >= 2.4; tries++) {
            let bad = false;
            for (let t = a + 0.2; t <= z - 0.2 + 1e-6; t += 0.9) if (!clearAt(b, F, t, c, W + 0.05)) { bad = true; break; }
            if (!bad && !clearAt(b, F, z - 0.2, c, W + 0.05)) bad = true;
            if (!bad) { good = true; break; }
            a += 0.6; z -= 0.6;
          }
          if (!good) continue;
          out.push({ c: c, d0: a, d1: z });
        }
      }
    }
    return out;
  }

  function planLot(lot) {
    const e = econ(), b = lot && lot.building;
    if (!e || !b) return null;
    if (b.gunstore || b.jewelry) return null;                    // flagship walk-ins
    const kind = (b.shop && b.shop.kind) || lot.kind || "";
    if (SKIP[kind]) return null;
    const stock = (e.stockFor(kind) || []).filter(function (n) { return !!e.ITEMS[n]; });
    if (!stock.length) return null;
    if (typeof b.clearFloorPoint !== "function") return null;
    const F = frameOf(b);
    if (!F || F.Ti < 3.2) return null;
    const prof = PROFILE[kind] || DEFAULT_PROFILE;
    const K = counterOf(b, F);
    const FY = ((b.floorTops && b.floorTops[0] != null) ? b.floorTops[0] : 0.14) + 0.06;

    const plan = {
      lot: lot, kind: kind, prof: prof, F: F, K: K, FY: FY, cx: lot.cx, cz: lot.cz,
      runs: [], lanes: [], cooler: null, coffee: null, warmer: null,
      boards: [], goods: [], tickets: [], slots: [], names: [], rects: [],
      group: null, built: false, meshes: [], cols: [], real: Object.create(null),
    };
    const W2 = new THREE.Vector3();
    plan.toWorld = function (lx, ly, lz) {
      W2.set(lx, ly || 0, lz);
      const g = plan.lot.building && plan.lot.building.group;
      // updateWorldMatrix(true, false) walks the ANCESTORS first: a town root
      // that has not yet composed its own matrixWorld must not leave the shell
      // composed against identity.
      if (g) {
        try {
          if (g.updateWorldMatrix) g.updateWorldMatrix(true, false);
          else g.updateMatrixWorld(true);
          W2.applyMatrix4(g.matrixWorld);
        } catch (err) { /* no transform available: local IS world */ }
      }
      return W2;
    };

    // ---- the runs, the lanes, and what takes a slice of them ----
    plan.runs = planWalls(plan, prof, F, b, K);
    plan.lanes = planLanes(plan, prof, F, b, K);
    // the cooler takes the BACK bays of the first run on its preferred side
    if (prof.cooler && plan.runs.length) {
      const pref = plan.runs.filter(function (r) { return r.s === 1; }).concat(plan.runs.filter(function (r) { return r.s === -1; }));
      for (const r of pref) {
        const bays = Math.min(r.bays, Math.max(2, Math.ceil(prof.cooler * 0.78 / BAY)));
        if (bays < 2) continue;
        const d1 = r.d1, d0 = d1 - bays * BAY;
        plan.cooler = { s: r.s, d0: d0, d1: d1, doors: Math.max(2, Math.floor((d1 - d0) / 0.76)) };
        r.d1 = d0; r.bays -= bays;
        break;
      }
    }
    // the coffee station takes the FRONT two bays of the other side
    if (prof.coffee && plan.runs.length) {
      const other = plan.cooler ? -plan.cooler.s : -1;
      const r = plan.runs.filter(function (q) { return q.s === other && q.bays >= 3; })[0];
      const r2 = r || plan.runs.filter(function (q) { return q.bays >= 3; })[0];
      if (r2) { plan.coffee = { s: r2.s, d0: r2.d0, d1: r2.d0 + 2 * BAY }; r2.d0 += 2 * BAY; r2.bays -= 2; }
    }
    plan.runs = plan.runs.filter(function (r) { return r.bays >= 1 && r.d1 - r.d0 > BAY - 0.01; });
    if (prof.warmer && K && K.hLat > 1.2) {
      // the end of the counter away from the till (the till sits at lat -0.7)
      const sd = K.cLat - 0.7 <= K.cLat ? 1 : -1;
      plan.warmer = { l: K.cLat + sd * (K.hLat - 0.52), d: K.cIn - K.hIn + 0.3, top: 1.245 };
    }

    layoutBoards(plan);
    if (!plan.boards.length && !plan.cooler) return null;
    placeStock(plan, stock);
    fillGoods(plan);

    // footprints (building-local) for the fit-out's occupancy ledger
    const R = function (dA, dB, lA, lB, wall) {
      const xa = F.x(dA, lA), xb = F.x(dB, lB), za = F.z(dA, lA), zb = F.z(dB, lB);
      plan.rects.push({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb),
        d0: Math.min(dA, dB), d1: Math.max(dA, dB), wall: !!wall });
    };
    for (const r of plan.runs) R(r.d0, r.d1, r.s * F.Ti, r.s * (F.Ti - WALL.deep - 0.03), true);
    if (plan.cooler) R(plan.cooler.d0, plan.cooler.d1, plan.cooler.s * F.Ti, plan.cooler.s * (F.Ti - COOL.deep - 0.05), true);
    if (plan.coffee) R(plan.coffee.d0, plan.coffee.d1, plan.coffee.s * F.Ti, plan.coffee.s * (F.Ti - 0.7), true);
    for (const g of plan.lanes) R(g.d0, g.d1, g.c - GOND.half - 0.02, g.c + GOND.half + 0.02, false);
    if (b.group) RECTS.set(b.group, plan.rects);

    refreshWorld(plan);
    // THE OLD SHOPLIFT STOPS HERE: buildings.js's flavour-word grab enumerates
    // lot.building.shoplift, and a dressed store has exactly one way to take
    // something off its shelf, which hands you a real object.
    b.storeShelves = b.shoplift || null;
    b.shoplift = null;
    BY_LOT.set(lot, plan);
    return plan;
  }

  /* ---- where every board is (pure data; the kit draws the same numbers) ---- */
  function layoutBoards(plan) {
    const F = plan.F, FY = plan.FY;
    // wall bays
    for (const r of plan.runs) {
      const s = r.s, L = r.d1 - r.d0, dm = (r.d0 + r.d1) / 2;
      for (let k = 0; k < WALL.levels.length; k++) {
        const dep = k === 0 ? WALL.deep - 0.02 : (k <= 2 ? WALL.deep - 0.05 : WALL.deep - 0.11);
        const clr = (k + 1 < WALL.levels.length ? WALL.levels[k + 1] - 0.028 : WALL.h + 0.02) - WALL.levels[k] - 0.02;
        board(plan, { kind: "wall", run: r, d: dm, l: s * (F.Ti - dep), ax: "in", len: L - 0.08, fd: -s, sd: dep - 0.05,
          y: FY + WALL.levels[k], clr: clr, level: k });
      }
    }
    // gondolas: two faces + two end caps each
    for (const g of plan.lanes) {
      const bd0 = g.d0 + GOND.cap, bd1 = g.d1 - GOND.cap, L = bd1 - bd0, dm = (bd0 + bd1) / 2;
      for (const s of [-1, 1]) for (let k = 0; k < GOND.levels.length; k++) {
        const clr = (k + 1 < GOND.levels.length ? GOND.levels[k + 1] - 0.028 : GOND.h + 0.02) - GOND.levels[k] - 0.02;
        board(plan, { kind: "gond", lane: g, d: dm, l: g.c + s * GOND.half, ax: "in", len: L - 0.06, fd: s, sd: GOND.half - 0.07,
          y: FY + GOND.levels[k], clr: k === GOND.levels.length - 1 ? 0.34 : clr, level: k });
      }
      for (const e of [-1, 1]) for (let k = 0; k < 3; k++) {
        const lv = GOND.levels[k];
        const clr = GOND.levels[k + 1] - 0.028 - lv - 0.02;
        board(plan, { kind: "cap", lane: g, d: e < 0 ? g.d0 : g.d1, l: g.c, ax: "tan", len: 2 * GOND.half - 0.1, fd: e,
          sd: GOND.cap - 0.06, y: FY + lv, clr: clr, level: k });
      }
    }
    // the cooler's shelves
    if (plan.cooler) {
      const C = plan.cooler, dm = (C.d0 + C.d1) / 2;
      for (let k = 0; k < COOL.levels.length; k++) {
        const clr = (k + 1 < COOL.levels.length ? COOL.levels[k + 1] - 0.02 : COOL.h - 0.34) - COOL.levels[k] - 0.02;
        board(plan, { kind: "cool", d: dm, l: C.s * (F.Ti - COOL.deep + 0.06), ax: "in", len: C.d1 - C.d0 - 0.14, fd: -C.s,
          sd: COOL.deep - 0.26, y: FY + COOL.levels[k], clr: clr, level: k, mix: "drinks" });
      }
    }
  }

  // a point on a board: t along its run (centred), depth r back from its front edge
  function boardPt(F, bo, t, back) {
    let d = bo.d, l = bo.l;
    if (bo.ax === "in") { d += t; l -= bo.fd * back; } else { l += t; d -= bo.fd * back; }
    return { x: F.x(d, l), z: F.z(d, l) };
  }
  function faceYaw(F, bo) {
    // the direction the goods face, as a local vector, as a yaw
    let fx, fz;
    if (bo.ax === "in") { fx = F.tx * bo.fd; fz = F.tz * bo.fd; } else { fx = F.inx * bo.fd; fz = F.inz * bo.fd; }
    return Math.atan2(fx, fz);
  }

  /* ---- THE REAL STOCK: where each catalog name stands ---------------------- */
  function placeStock(plan, stock) {
    const F = plan.F;
    const used = new Set();
    const addSlots = function (name, bo, t0, span, n) {
      for (let u = 0; u < n; u++) {
        const t = t0 - span / 2 + (u + 0.5) * (span / n);
        const p = boardPt(F, bo, t, Math.min(0.12, bo.sd * 0.4));
        plan.slots.push({ plan: plan, lot: plan.lot, name: name, lx: p.x, ly: bo.y + 0.004, lz: p.z,
          yaw: faceYaw(F, bo) + (hash01(p.x + u, p.z, 0x9ab3) - 0.5) * 0.3, clr: bo.clr,
          taken: false, tookDay: -1, x: 0, y: 0, z: 0 });
      }
      bo.reserved = bo.reserved || [];
      bo.reserved.push([t0 - span / 2 - 0.03, t0 + span / 2 + 0.03]);
      if (plan.names.indexOf(name) < 0) plan.names.push(name);
    };
    const cool = plan.boards.filter(function (bo) { return bo.kind === "cool" && (bo.level === 2 || bo.level === 3); });
    const eye = plan.boards.filter(function (bo) { return bo.kind === "wall" && bo.level === REAL_LEVEL; });
    const gTop = plan.boards.filter(function (bo) { return bo.kind === "gond" && bo.level === GOND.levels.length - 1; });
    let ci = 0;
    // cold drinks: behind the cooler glass at eye level, a 0.5 m section each
    for (const name of stock) {
      if (!COLD[name] || !cool.length) continue;
      const bo = cool[ci % cool.length], lane = (ci / cool.length) | 0;
      const t0 = -bo.len / 2 + 0.35 + lane * 0.72;
      if (t0 + 0.28 > bo.len / 2) continue;
      addSlots(name, bo, t0, 0.5, 3);
      used.add(name); ci++;
    }
    // hot food: in the warmer on the counter
    if (plan.warmer) {
      const hot = stock.filter(function (n) { return HOT[n]; });
      const W = plan.warmer;
      for (let i = 0; i < hot.length && i < 6; i++) {
        const tier = (i / 3) | 0, col = i % 3;
        const l = W.l + (col - 1) * 0.26, d = W.d + 0.02;
        plan.slots.push({ plan: plan, lot: plan.lot, name: hot[i], lx: F.x(d, l), ly: W.top + (tier ? 0.252 : 0.05),
          lz: F.z(d, l), yaw: Math.atan2(-F.inx, -F.inz), clr: 0.17, taken: false, tookDay: -1, x: 0, y: 0, z: 0 });
        used.add(hot[i]);
        if (plan.names.indexOf(hot[i]) < 0) plan.names.push(hot[i]);
      }
    }
    // coffee: on the coffee station's worktop, beside the brewer
    if (plan.coffee) {
      for (const name of stock) {
        if (!BREW[name]) continue;
        const C = plan.coffee, l = C.s * (plan.F.Ti - 0.34), d = C.d0 + 1.35;
        for (let u = 0; u < 3; u++) {
          const dd = d + u * 0.12;
          plan.slots.push({ plan: plan, lot: plan.lot, name: name, lx: F.x(dd, l), ly: plan.FY + 0.92, lz: F.z(dd, l),
            yaw: Math.atan2(-C.s * F.tx, -C.s * F.tz), clr: 0.3, taken: false, tookDay: -1, x: 0, y: 0, z: 0 });
        }
        used.add(name);
        if (plan.names.indexOf(name) < 0) plan.names.push(name);
      }
    }
    // everything else: a section of a wall bay at the 0.96 board, spread down
    // the runs (then the gondola top boards if the walls ran out)
    const rest = stock.filter(function (n) { return !used.has(n); });
    const pool = eye.concat(gTop);
    if (!pool.length) return;
    // sections: 0.72 m each, walking the boards front-to-back, alternating sides
    const sections = [];
    for (const bo of pool) {
      const n = Math.max(1, Math.floor(bo.len / 1.6));
      for (let i = 0; i < n; i++) sections.push({ bo: bo, t0: -bo.len / 2 + (i + 0.5) * (bo.len / n) });
    }
    sections.sort(function (a, c) { return (a.bo.kind === "gond") - (c.bo.kind === "gond") || a.bo.d + a.t0 - (c.bo.d + c.t0); });
    const step = Math.max(1, Math.floor(sections.length / Math.max(1, rest.length)));
    for (let i = 0; i < rest.length; i++) {
      // a name with no section left is simply sold over the counter
      const sec = sections[i * step];
      if (!sec) break;
      addSlots(rest[i], sec.bo, sec.t0, Math.min(0.72, sec.bo.len), 3);
    }
  }

  /* ---- THE PACKAGED GOODS: blocks of one product, faced up --------------- */
  function fillGoods(plan) {
    const F = plan.F;
    const mixName = plan.prof.mix || "grocery";
    for (let bi = 0; bi < plan.boards.length; bi++) {
      const bo = plan.boards[bi];
      const mix = bo.mix || mixName;
      // the free intervals of this board (real stock reserves its sections)
      let free = [[-bo.len / 2, bo.len / 2]];
      if (bo.reserved) for (const rv of bo.reserved) {
        const nx = [];
        for (const iv of free) {
          if (rv[1] <= iv[0] || rv[0] >= iv[1]) { nx.push(iv); continue; }
          if (rv[0] > iv[0]) nx.push([iv[0], rv[0]]);
          if (rv[1] < iv[1]) nx.push([rv[1], iv[1]]);
        }
        free = nx;
      }
      const yaw = faceYaw(F, bo);
      for (let fi = 0; fi < free.length; fi++) {
        let pos = free[fi][0];
        const end = free[fi][1];
        let k = 0;
        while (end - pos > 0.12 && k < 64) {
          const hr = hash01(bo.d * 3.1 + pos * 7.3 + bi, bo.l * 2.7 + bo.y * 11 + k, 0x6d11);
          const tn = pick(mix, hr, bo.level, bo.clr);
          k++;
          if (!tn) break;
          const t = T[tn];
          const jit = 0.92 + 0.16 * hash01(pos, bi, 0x71c3);
          const w = t.w * jit, h = Math.min(t.h * jit, bo.clr - 0.02), gap = t.g === "box" || t.g === "bag" ? 0.008 : 0.004;
          const blockTarget = 0.3 + 0.55 * hash01(bi + k, pos, 0x2c9d);
          let n = Math.max(1, Math.round(blockTarget / (w + gap)));
          n = Math.min(n, Math.floor((end - pos) / (w + gap)));
          if (n < 1) continue;                   // too wide for what is left: try another
          const palette = PAL[t.pal] || PAL.brand;
          const color = palette[Math.floor(hash01(pos * 5.1, bo.y * 3 + bi, 0x41a7) * palette.length) % palette.length];
          const geoKey = t.g + ":" + CELL[t.c];
          // a price ticket at the left of the block, on the price channel
          plan.tickets.push({ bo: bo, t: pos + Math.min(0.06, w * 0.4), sale: hash01(pos, bi * 7, 0x5a1e) < 0.12 });
          for (let u = 0; u < n; u++) {
            const tc = pos + u * (w + gap) + w / 2;
            if (t.g === "box" || t.g === "bag") {
              const dp = t.d * jit, rows = Math.max(1, Math.floor(bo.sd / (dp + 0.004)));
              const deep = Math.min(bo.sd, rows * (dp + 0.004) - 0.004);
              const p = boardPt(F, bo, tc, 0.012 + deep / 2);
              plan.goods.push({ key: geoKey, x: p.x, y: bo.y, z: p.z, yaw: yaw, sx: w, sy: h, sz: deep, color: color });
            } else {
              const rows = Math.max(1, Math.min(t.rows || 2, Math.floor(bo.sd / (w + 0.006))));
              for (let r = 0; r < rows; r++) {
                const p = boardPt(F, bo, tc, 0.012 + w / 2 + r * (w + 0.006));
                plan.goods.push({ key: geoKey, x: p.x, y: bo.y, z: p.z, yaw: yaw + r * 0.9 + u * 0.37, sx: w, sy: h, sz: w, color: color, back: r > 0 });
              }
            }
          }
          pos += n * (w + gap) + 0.012;
        }
      }
    }
    // A STORE HAS A GOODS BUDGET. Past it, the rows BEHIND the front facing go
    // first, evenly across the whole store (every k-th kept), so no shelf reads
    // emptier than its neighbour and the faced-up front row is never touched.
    if (plan.goods.length > GOODS_BUDGET) {
      let backs = 0;
      for (const g of plan.goods) if (g.back) backs++;
      const over = plan.goods.length - GOODS_BUDGET;
      if (backs > 0) {
        const keepFrac = Math.max(0, 1 - over / backs);
        let acc = 0;
        plan.goods = plan.goods.filter(function (g) {
          if (!g.back) return true;
          acc += keepFrac;
          if (acc >= 1) { acc -= 1; return true; }
          return false;
        });
      }
    }
    // the coffee station's own things: two carafes on the warmers, cup stacks
    if (plan.coffee) {
      const C = plan.coffee, l = C.s * (F.Ti - 0.3), y = plan.FY + 0.92;
      const yaw = Math.atan2(-C.s * F.tx, -C.s * F.tz);
      for (let i = 0; i < 2; i++) {
        const d = C.d0 + 0.38 + i * 0.22, p = { x: F.x(d, l), z: F.z(d, l) };
        plan.goods.push({ key: "bottle:" + CELL.carafe, x: p.x, y: y + 0.03, z: p.z, yaw: yaw, sx: 0.15, sy: 0.22, sz: 0.15, color: 0xffffff });
      }
      for (let i = 0; i < 3; i++) {
        const d = C.d0 + 1.9 + i * 0.13, p = { x: F.x(d, l), z: F.z(d, l) };
        plan.goods.push({ key: "cyl:" + CELL.pills, x: p.x, y: y, z: p.z, yaw: 0, sx: 0.09, sy: 0.3 + 0.05 * i, sz: 0.09, color: [0x8c1f3f, 0x2a64a8, 0x3b2f2a][i] });
      }
    }
  }

  /* WORLD COORDINATES ARE A DERIVED, REFRESHABLE FACT. */
  function refreshWorld(plan) {
    const w0 = plan.toWorld(0, 0, 0);
    plan.cx = w0.x; plan.cz = w0.z;
    const F = plan.F;
    for (let i = 0; i < plan.boards.length; i++) {
      const bo = plan.boards[i], c = boardPt(F, bo, 0, bo.sd / 2), w = plan.toWorld(c.x, bo.y, c.z);
      bo.wx = w.x; bo.wy = w.y; bo.wz = w.z;
      const yaw = faceYaw(F, bo), w2 = plan.toWorld(c.x + Math.sin(yaw), bo.y, c.z + Math.cos(yaw));
      const dx = w2.x - bo.wx, dz = w2.z - bo.wz, dl = Math.hypot(dx, dz) || 1;
      bo.wfx = dx / dl; bo.wfz = dz / dl;
    }
    for (let i = 0; i < plan.slots.length; i++) {
      const sl = plan.slots[i], w = plan.toWorld(sl.lx, sl.ly, sl.lz);
      sl.x = w.x; sl.y = w.y; sl.z = w.z;
    }
    plan.worldFresh = true;
  }

  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    const A = city || CBZ._settlementArena || (CBZ.city && CBZ.city.arena) || null;
    if (!A) return;
    for (let i = PLANS.length - 1; i >= 0; i--) if (PLANS[i]._arena !== A) PLANS.splice(i, 1);
    teardownAll();
    const lots = A.shopLots || A.lots || [];
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      if (!lot || !lot.building || lot.demolished) continue;
      if (BY_LOT.get(lot)) continue;
      let p = null;
      try { p = planLot(lot); } catch (err) { p = null; }
      if (p) { p._arena = A; PLANS.push(p); }
    }
    S.arena = A;
    S.refreshed = false;
  }, 90.5);

  /* ============================================================
     3. THE LIVE BUILD — fixtures, goods, real stock, colliders
     ============================================================ */
  function drawFixtures(plan, kit) {
    const F = plan.F, FY = plan.FY;
    // ---- wall bays ----
    for (let ri = 0; ri < plan.runs.length; ri++) {
      const r = plan.runs[ri], s = r.s, L = r.d1 - r.d0, dm = (r.d0 + r.d1) / 2, UD = WALL.deep;
      fbox(kit, F, "perf", dm, s * (F.Ti - 0.013), FY, L, 0.024, WALL.top, COL.perf);                // back panel
      const hc = HEADER[(Math.abs(Math.round(dm * 3 + s * 7)) + ri) % HEADER.length];
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.034), FY + WALL.h + 0.04, L, 0.018, WALL.top - WALL.h - 0.06, hc);   // header panel
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.1), FY + WALL.h + 0.01, L, 0.16, 0.025, COL.body);             // top cap
      for (let i = 0; i <= r.bays; i++) {                                                              // uprights
        const d = Math.min(r.d1 - 0.025, Math.max(r.d0 + 0.025, r.d0 + i * BAY));
        fbox(kit, F, "fix", d, s * (F.Ti - 0.045), FY, 0.05, 0.042, WALL.h + 0.02, COL.upright);
      }
      for (const e of [r.d0 + 0.012, r.d1 - 0.012])                                                     // end panels
        fbox(kit, F, "fix", e, s * (F.Ti - UD / 2 - 0.01), FY, 0.024, UD + 0.02, WALL.h, COL.body);
      fbox(kit, F, "fix", dm, s * (F.Ti - UD + 0.012), FY, L - 0.05, 0.022, 0.12, COL.kick);                 // kick plate
      for (let k = 0; k < WALL.levels.length; k++) {
        const y = FY + WALL.levels[k];
        const dep = k === 0 ? UD - 0.02 : (k <= 2 ? UD - 0.05 : UD - 0.11);
        fbox(kit, F, "fix", dm, s * (F.Ti - dep / 2 - 0.02), y - 0.025, L - 0.05, dep - 0.02, 0.025, COL.board);   // board
        fbox(kit, F, "fix", dm, s * (F.Ti - dep - 0.006), y - 0.034, L - 0.05, 0.014, 0.04, COL.rail);            // price channel
      }
    }
    // ---- gondolas ----
    for (const g of plan.lanes) {
      const bd0 = g.d0 + GOND.cap, bd1 = g.d1 - GOND.cap, L = bd1 - bd0, dm = (bd0 + bd1) / 2, W = GOND.half;
      fbox(kit, F, "perf", dm, g.c, FY, L, 0.05, GOND.h, COL.perf);                                    // spine
      fbox(kit, F, "fix", dm, g.c, FY + GOND.h, L + 0.04, 0.09, 0.03, COL.body);                        // top cap
      for (const e of [bd0 + 0.012, bd1 - 0.012]) fbox(kit, F, "fix", e, g.c, FY, 0.024, 2 * W + 0.02, GOND.h, COL.body);   // end panels
      const nUp = Math.max(1, Math.round(L / BAY));
      for (let i = 1; i < nUp; i++) fbox(kit, F, "fix", bd0 + i * (L / nUp), g.c, FY, 0.05, 0.075, GOND.h, COL.upright);
      for (const s of [-1, 1]) {
        fbox(kit, F, "fix", dm, g.c + s * (W - 0.011), FY, L - 0.05, 0.022, 0.12, COL.kick);
        for (let k = 0; k < GOND.levels.length; k++) {
          const y = FY + GOND.levels[k];
          fbox(kit, F, "fix", dm, g.c + s * (W / 2 + 0.01), y - 0.025, L - 0.05, W - 0.04, 0.025, COL.board);
          fbox(kit, F, "fix", dm, g.c + s * (W + 0.006), y - 0.034, L - 0.05, 0.014, 0.04, COL.rail);
        }
      }
      // end caps: a shallow display facing the cross aisle, cheeks either side
      for (const e of [-1, 1]) {
        const dc = e < 0 ? g.d0 + GOND.cap / 2 : g.d1 - GOND.cap / 2, outer = e < 0 ? g.d0 : g.d1;
        for (const s of [-1, 1]) fbox(kit, F, "fix", dc, g.c + s * (W - 0.012), FY, GOND.cap, 0.024, GOND.levels[2] + 0.36, COL.body);
        fbox(kit, F, "fix", outer - e * 0.011, g.c, FY, 0.022, 2 * W - 0.05, 0.12, COL.kick);
        for (let k = 0; k < 3; k++) {
          const y = FY + GOND.levels[k];
          fbox(kit, F, "fix", dc, g.c, y - 0.025, GOND.cap - 0.04, 2 * W - 0.05, 0.025, COL.board);
          fbox(kit, F, "fix", outer + e * 0.006, g.c, y - 0.034, 0.014, 2 * W - 0.05, 0.04, COL.rail);
        }
      }
    }
    // ---- the cooler bank ----
    if (plan.cooler) {
      const C = plan.cooler, s = C.s, L = C.d1 - C.d0, dm = (C.d0 + C.d1) / 2, CD = COOL.deep;
      const front = s * (F.Ti - CD);
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.02), FY, L, 0.04, COOL.h, COL.coolFrame);                   // back
      for (const e of [C.d0 + 0.025, C.d1 - 0.025]) fbox(kit, F, "fix", e, s * (F.Ti - CD / 2), FY, 0.05, CD, COOL.h, COL.coolFrame);
      fbox(kit, F, "fix", dm, s * (F.Ti - CD / 2), FY + COOL.h - 0.3, L, CD, 0.3, COL.coolFrame);       // header
      fbox(kit, F, "fix", dm, s * (F.Ti - CD / 2), FY, L, CD, 0.16, COL.coolFrame);                     // base + grille
      for (let i = 0; i < 6; i++) fbox(kit, F, "fix", dm, front - s * 0.004, FY + 0.03 + i * 0.022, L - 0.12, 0.006, 0.008, 0x3a3e43);
      fbox(kit, F, "glow", dm, s * (F.Ti - 0.045), FY + 0.17, L - 0.1, 0.01, COOL.h - 0.48, COL.coolLight);   // lit interior back
      for (let k = 0; k < COOL.levels.length; k++)                                                    // wire shelves
        fbox(kit, F, "fix", dm, s * (F.Ti - CD / 2 - 0.04), FY + COOL.levels[k] - 0.02, L - 0.12, CD - 0.2, 0.02, COL.coolWire);
      const dw = L / C.doors;
      for (let i = 0; i <= C.doors; i++)                                                              // mullions
        fbox(kit, F, "fix", C.d0 + i * dw, front + s * 0.03, FY + 0.16, 0.05, 0.06, COOL.h - 0.46, COL.coolFrame);
      fbox(kit, F, "fix", dm, front + s * 0.03, FY + 0.16, L, 0.06, 0.05, COL.coolFrame);
      fbox(kit, F, "fix", dm, front + s * 0.03, FY + COOL.h - 0.35, L, 0.06, 0.05, COL.coolFrame);
      for (let i = 0; i < C.doors; i++) {
        const dc = C.d0 + (i + 0.5) * dw;
        fbox(kit, F, "glass", dc, front + s * 0.03, FY + 0.21, dw - 0.06, 0.012, COOL.h - 0.56, 0xdfeff5);
        const hd = dc + (i % 2 ? -1 : 1) * (dw / 2 - 0.09);
        fbox(kit, F, "fix", hd, front - s * 0.012, FY + 0.82, 0.025, 0.03, 0.72, COL.handle);             // handle
        fbox(kit, F, "glow", C.d0 + i * dw + 0.03, front + s * 0.07, FY + 0.2, 0.012, 0.02, COOL.h - 0.56, 0xf3f8fa);   // LED strip
      }
    }
    // ---- the coffee station ----
    if (plan.coffee) {
      const C = plan.coffee, s = C.s, L = C.d1 - C.d0, dm = (C.d0 + C.d1) / 2;
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.31), FY + 0.1, L - 0.04, 0.6, 0.78, COL.lam);                // cabinet
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.3), FY, L - 0.08, 0.56, 0.1, COL.black);                     // kick
      for (let i = 1; i < 3; i++) fbox(kit, F, "fix", C.d0 + i * L / 3, s * (F.Ti - 0.611), FY + 0.14, 0.008, 0.006, 0.7, 0x4a3a2c);
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.33), FY + 0.88, L, 0.66, 0.04, COL.stone);                   // worktop
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.012), FY + 0.92, L, 0.024, 1.2, COL.splash);                 // back panel
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.17), FY + 2.12, L, 0.34, 0.22, COL.splash);                  // canopy
      fbox(kit, F, "glow", dm, s * (F.Ti - 0.3), FY + 2.1, L - 0.2, 0.05, 0.018, COL.warmLight);         // under-canopy light
      // the brewer: body, hood, two warmer plates
      const bd = C.d0 + 0.5;
      fbox(kit, F, "fix", bd, s * (F.Ti - 0.13), FY + 0.92, 0.6, 0.2, 0.66, COL.black);                  // tower
      fbox(kit, F, "fix", bd, s * (F.Ti - 0.31), FY + 1.36, 0.6, 0.2, 0.2, COL.steel);                   // brew head over the pots
      for (let i = 0; i < 2; i++) fbox(kit, F, "fix", C.d0 + 0.38 + i * 0.22, s * (F.Ti - 0.3), FY + 0.92, 0.17, 0.2, 0.03, 0x2a2a2a);
      // a lid + sugar caddy
      fbox(kit, F, "fix", C.d0 + 1.0, s * (F.Ti - 0.25), FY + 0.92, 0.26, 0.2, 0.1, 0x2a2d31);
      fbox(kit, F, "fix", C.d0 + 2.36, s * (F.Ti - 0.25), FY + 0.92, 0.18, 0.18, 0.12, COL.steel);
    }
    // ---- the hot food warmer on the counter ----
    if (plan.warmer) {
      const Wm = plan.warmer, y = Wm.top, wl = Wm.l, wd = Wm.d;
      fbox(kit, F, "fix", wd, wl, y, 0.42, 0.84, 0.05, COL.steel);                                      // base
      for (const e of [-1, 1]) fbox(kit, F, "fix", wd, wl + e * 0.41, y + 0.05, 0.4, 0.02, 0.4, COL.steel);   // end frames
      fbox(kit, F, "fix", wd, wl, y + 0.43, 0.42, 0.84, 0.03, COL.steel);                               // lid
      fbox(kit, F, "glow", wd, wl, y + 0.415, 0.3, 0.7, 0.012, COL.warmLight);                          // heat lamp
      fbox(kit, F, "fix", wd + 0.02, wl, y + 0.24, 0.3, 0.8, 0.012, 0x9aa0a4);                         // wire tier
      fbox(kit, F, "glass", wd - 0.2, wl, y + 0.05, 0.01, 0.8, 0.38, 0xf2e6d8);                         // front glass
      fbox(kit, F, "glass", wd + 0.2, wl, y + 0.05, 0.01, 0.8, 0.38, 0xf2e6d8);                         // back glass
    }
    // ---- price tickets on every block ----
    for (const tk of plan.tickets) {
      const bo = tk.bo;
      const off = 0.015;                          // proud of the price channel (or the wire shelf)
      let d = bo.d, l = bo.l;
      if (bo.ax === "in") { d += tk.t; l += bo.fd * off; } else { l += tk.t; d += bo.fd * off; }
      const tw = 0.06, th = 0.032;
      kit.box("fix", F.x(d, l), bo.y - 0.014, F.z(d, l),
        bo.ax === "in" ? (F.along ? tw : 0.004) : (F.along ? 0.004 : tw), th,
        bo.ax === "in" ? (F.along ? 0.004 : tw) : (F.along ? tw : 0.004), tk.sale ? COL.sale : COL.ticket);
    }
  }

  // the fixtures are SOLID while the store is live
  function fixtureCols(plan) {
    const F = plan.F, cols = [];
    const add = function (dA, dB, lA, lB, h) {
      const a = plan.toWorld(F.x(dA, lA), plan.FY, F.z(dA, lA));
      const ax = a.x, ay = a.y, az = a.z;
      const c = plan.toWorld(F.x(dB, lB), plan.FY, F.z(dB, lB));
      cols.push({ minX: Math.min(ax, c.x), maxX: Math.max(ax, c.x), minZ: Math.min(az, c.z), maxZ: Math.max(az, c.z),
        y0: ay - 0.1, y1: ay + h, ref: plan.group, _storegoods: true });
    };
    for (const r of plan.runs) add(r.d0, r.d1, r.s * F.Ti, r.s * (F.Ti - WALL.deep), WALL.top);
    for (const g of plan.lanes) add(g.d0, g.d1, g.c - GOND.half, g.c + GOND.half, GOND.h);
    if (plan.cooler) add(plan.cooler.d0, plan.cooler.d1, plan.cooler.s * F.Ti, plan.cooler.s * (F.Ti - COOL.deep), COOL.h);
    if (plan.coffee) add(plan.coffee.d0, plan.coffee.d1, plan.coffee.s * F.Ti, plan.coffee.s * (F.Ti - 0.64), 0.92);
    return cols;
  }

  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  function drawGoods(plan, group) {
    const byKey = Object.create(null);
    for (const g of plan.goods) (byKey[g.key] || (byKey[g.key] = [])).push(g);
    const M = mats(), out = [];
    const col = new THREE.Color();
    for (const key in byKey) {
      const list = byKey[key], sp = key.split(":");
      const geo = goodsGeo(sp[0], +sp[1]);
      const im = new THREE.InstancedMesh(geo, M.goods, list.length);
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        _v.set(g.x, g.y, g.z); _e.set(0, g.yaw, 0); _q.setFromEuler(_e); _s.set(g.sx, g.sy, g.sz);
        _m4.compose(_v, _q, _s);
        im.setMatrixAt(i, _m4);
        im.setColorAt(i, col.setHex(g.color));
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;                   // instances span the store; the geometry sphere does not
      im.castShadow = false; im.receiveShadow = false;
      im.matrixAutoUpdate = false; im.updateMatrix();
      group.add(im); out.push(im);
    }
    return out;
  }

  /* ---- THE REAL STOCK, MERGED PER PRODUCT ---------------------------------
     One product = one model (CBZ.itemAsset), baked once per name into parts
     (geometry per material, at the model's REAL size). Every facing of that
     product in a store is merged into one mesh per material, and rebuilt when
     a unit leaves or comes back. ~4 draw calls a product, not 4 per unit. */
  const PARTS = Object.create(null);
  const SMAX = 0.5, TINY = 0.08, TPOW = 0.6;
  function partsOf(name) {
    if (PARTS[name] !== undefined) return PARTS[name];
    PARTS[name] = null;
    if (!CBZ.itemAsset) return null;
    let o = null;
    try { o = CBZ.itemAsset(name); } catch (err) { o = null; }
    if (!o) return null;
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o);
    if (!isFinite(bb.min.x) || !isFinite(bb.max.x)) return null;
    const m = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    let k = 1;
    if (m > 1e-4) {
      if (m > SMAX) k = SMAX / m;
      else if (m < TINY) k = Math.min(TINY / m, Math.pow(TINY / m, TPOW));   // earrings stay small, not invisible
    }
    const byMat = new Map();
    const fix = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2));
    o.traverse(function (ms) {
      if (!ms.isMesh || !ms.geometry || !ms.material || Array.isArray(ms.material)) return;
      let g = ms.geometry.clone();
      if (g.index) g = g.toNonIndexed();
      const keep = { position: 1, normal: 1, uv: !!ms.material.map };
      for (const a in g.attributes) if (!keep[a]) g.deleteAttribute(a);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (ms.material.map && !g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(fix, ms.matrixWorld));
      const arr = byMat.get(ms.material) || [];
      arr.push(g); byMat.set(ms.material, arr);
    });
    const parts = [];
    const BGU = THREE.BufferGeometryUtils;
    byMat.forEach(function (arr, mat) {
      let g = null;
      if (arr.length === 1) g = arr[0];
      else if (BGU && BGU.mergeBufferGeometries) { try { g = BGU.mergeBufferGeometries(arr, false); } catch (err) { g = null; } }
      if (g) parts.push({ geo: g, mat: mat });
      else for (const a of arr) parts.push({ geo: a, mat: mat });
    });
    const h = (bb.max.y - bb.min.y) * k;
    PARTS[name] = parts.length ? { parts: parts, h: h } : null;
    return PARTS[name];
  }
  function slotAvailable(sl) { return !sl.taken || sl.tookDay !== today(); }
  function buildReal(plan, name) {
    const prev = plan.real[name];
    if (prev) for (const m of prev) { if (m.parent) m.parent.remove(m); try { m.geometry.dispose(); } catch (err) {} }
    plan.real[name] = [];
    if (!plan.group) return;
    const P = partsOf(name);
    if (!P) return;
    const BGU = THREE.BufferGeometryUtils;
    for (const part of P.parts) {
      const geos = [];
      for (const sl of plan.slots) {
        if (sl.name !== name || !slotAvailable(sl)) continue;
        const kk = P.h > sl.clr - 0.01 && P.h > 0 ? Math.max(0.3, (sl.clr - 0.01) / P.h) : 1;
        _v.set(sl.lx, sl.ly, sl.lz); _e.set(0, sl.yaw, 0); _q.setFromEuler(_e); _s.set(kk, kk, kk);
        _m4.compose(_v, _q, _s);
        geos.push(part.geo.clone().applyMatrix4(_m4));
      }
      if (!geos.length) continue;
      let g = geos[0];
      if (geos.length > 1 && BGU && BGU.mergeBufferGeometries) { try { g = BGU.mergeBufferGeometries(geos, false) || geos[0]; } catch (err) { g = geos[0]; } }
      const mesh = new THREE.Mesh(g, part.mat);
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.userData.storeGood = name;
      (plan.goodsGroup || plan.group).add(mesh);
      plan.real[name].push(mesh);
    }
    for (const sl of plan.slots) if (sl.name === name) sl.obj = slotAvailable(sl) && plan.real[name].length ? plan.real[name] : null;
  }

  function buildPlan(plan) {
    if (plan.built) return;
    if (!plan.livedOnce) { plan.livedOnce = true; refreshWorld(plan); }
    const root = (plan.lot.building && plan.lot.building.group) ||
                 (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    if (!root) return;
    const grp = new THREE.Group();
    grp.userData.storeGoods = plan.kind;
    grp.userData.dynamic = true;                 // never folded by core/batch.js
    root.add(grp);
    plan.group = grp;
    const fix = new THREE.Group(); fix.name = "storegoods:fixtures";
    const goods = new THREE.Group(); goods.name = "storegoods:goods";
    grp.add(fix); grp.add(goods);
    plan.fixGroup = fix; plan.goodsGroup = goods;
    const kit = Kit(plan.FY);
    try { drawFixtures(plan, kit); } catch (err) { /* a half-drawn fixture set still stands */ }
    plan.meshes = kit.finish(fix).concat(drawGoods(plan, goods));
    for (const name of plan.names) buildReal(plan, name);
    plan.cols = fixtureCols(plan);
    if (plan.cols.length && CBZ.colliders) {
      for (const c of plan.cols) { c.ref = grp; CBZ.colliders.push(c); }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    plan.built = true;
  }

  function teardownPlan(plan) {
    if (!plan.built) return;
    if (plan.group && plan.group.parent) plan.group.parent.remove(plan.group);
    for (const m of plan.meshes) {
      // fixture geometry is per store; goods geometry and every material are shared
      if (m.isInstancedMesh) { try { m.dispose(); } catch (err) {} }
      else { try { m.geometry.dispose(); } catch (err) {} }
    }
    for (const k in plan.real) for (const m of plan.real[k]) { try { m.geometry.dispose(); } catch (err) {} }
    plan.real = Object.create(null);
    plan.meshes = [];
    if (plan.cols.length && CBZ.colliders) {
      const set = new Set(plan.cols), C = CBZ.colliders;
      let w = 0;
      for (let i = 0; i < C.length; i++) if (!set.has(C[i])) C[w++] = C[i];
      C.length = w;
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    plan.cols = [];
    plan.group = null; plan.fixGroup = null; plan.goodsGroup = null;
    for (let i = 0; i < plan.slots.length; i++) plan.slots[i].obj = null;
    plan.built = false;
  }
  function teardownAll() { for (let i = 0; i < PLANS.length; i++) teardownPlan(PLANS[i]); S.live.length = 0; }

  // take one unit off the shelf (bought or pocketed): it leaves the shelf
  function clearSlot(sl) {
    sl.taken = true; sl.tookDay = today();
    const p = sl.plan;
    if (p && p.built) buildReal(p, sl.name);
    sl.obj = null;
  }

  CBZ.onUpdate(37.6, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "city") { if (S.live.length) teardownAll(); return; }
    if (!PLANS.length) return;
    if (S.live.length) {
      const night = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
      LIT.value = 0.12 + 0.42 * Math.max(0, Math.min(1, night));
    }
    S.scanT -= dt;
    if (S.scanT > 0) return;
    S.scanT = 0.4;
    const P = CBZ.player;
    if (!P) return;
    if (!S.refreshed) { S.refreshed = true; for (let i = 0; i < PLANS.length; i++) refreshWorld(PLANS[i]); }
    const px = P.pos.x, pz = P.pos.z;
    const near = [];
    for (let i = 0; i < PLANS.length; i++) {
      const p = PLANS[i];
      const d = Math.hypot(p.cx - px, p.cz - pz);
      if (d <= LIVE_R) near.push([d, p]);
    }
    near.sort(function (a, b) { return a[0] - b[0]; });
    if (near.length > MAX_LIVE) near.length = MAX_LIVE;
    const want = near.map(function (r) { return r[1]; });
    const dOf = new Map();
    for (let i = 0; i < near.length; i++) dOf.set(near[i][1], near[i][0]);
    let builtThisTick = false;
    for (let i = 0; i < PLANS.length; i++) {
      const p = PLANS[i];
      if (want.indexOf(p) < 0) { if (p.built) teardownPlan(p); continue; }
      // ONE store built per scan: a store is a few thousand boxes of stock
      if (!p.built) { if (builtThisTick) continue; buildPlan(p); builtThisTick = true; }
      else {
        // a name the day-count restocked comes back without a rebuild of the store
        for (const name of p.names) {
          if (!partsOf(name)) continue;           // no model: nothing to restock
          let missing = false;
          for (const sl of p.slots) if (sl.name === name && !sl.obj && slotAvailable(sl)) { missing = true; break; }
          if (missing) buildReal(p, name);
        }
      }
      // BUILT IS NOT DRAWN: the goods show only once you are close enough to
      // read a shelf; the fixtures stand at the glass from further out.
      if (p.goodsGroup) p.goodsGroup.visible = (dOf.get(p) || 0) < SHOW_R;
    }
    S.live = want;
  });

  /* ============================================================
     4. THE VERBS — one zone, every store in the city
     ============================================================ */
  function nearestSlot(px, pz) {
    let best = null, bd = REACH;
    for (let i = 0; i < S.live.length; i++) {
      const p = S.live[i];
      if (!p.built) continue;
      if (Math.abs(p.cx - px) > 40 || Math.abs(p.cz - pz) > 40) continue;
      for (let k = 0; k < p.slots.length; k++) {
        const sl = p.slots[k];
        if (!sl.obj) continue;
        const d = Math.hypot(sl.x - px, sl.z - pz);
        if (d < bd) { bd = d; best = sl; }
      }
    }
    return best;
  }

  function priceOf(name) { const e = econ(); return (e && e.buyPrice) ? e.buyPrice(name) : 0; }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }

  function buySlot(sl) {
    if (!sl || !sl.obj) return;
    if (!CBZ.cityShopAcquire) { note("The clerk waves you to the counter.", 1.6); return; }
    if (!CBZ.cityShopAcquire(sl.lot, sl.name, 1, null)) return;   // failed spend keeps the goods
    clearSlot(sl);
  }

  function takeSlot(sl) {
    if (!sl || !sl.obj) return;
    // one theft model for the whole city: the shoplift system's own charge
    if (CBZ.cityShopTheftSeen && CBZ.cityShopTheftSeen(sl.lot, sl.x, sl.z)) return;
    if (!CBZ.cityShopAcquire || !CBZ.cityShopAcquire(sl.lot, sl.name, 1, { free: true })) return;
    if (CBZ.sfx) CBZ.sfx("coin");
    clearSlot(sl);
  }

  const I = CBZ.interactions;
  if (I && I.registerZone) {
    I.registerZone({
      id: "zone-store-goods", kind: "storegoods", prio: 8, driving: false,
      find: function (px, pz) {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || CBZ.cityMenuOpen) return null;
        return nearestSlot(px, pz);
      },
      options: [
        {
          id: "storegoods-buy", slot: "e",
          label: function (sl) { return "Buy " + sl.name + ", " + fmt$(priceOf(sl.name)); },
          onSelect: function (sl) { buySlot(sl); },
        },
        {
          id: "storegoods-take", slot: "i", bad: true,
          label: function (sl) {
            const seen = CBZ.cityShopClerkSees && CBZ.cityShopClerkSees(sl.lot, sl.x, sl.z);
            return seen ? "Pocket the " + sl.name + " (they're watching)" : "Pocket the " + sl.name;
          },
          onSelect: function (sl) { takeSlot(sl); },
        },
      ],
    });
    if (I.describe) I.describe("storegoods", function (sl) {
      return { label: sl.name, note: fmt$(priceOf(sl.name)) };
    });
  }

  /* ============================================================
     5. PUBLIC HOOKS
     ============================================================ */
  // shops.js reads this to trim the counter menu: the names actually standing
  // in this store.
  CBZ.cityGoodsLive = function (lot) {
    const p = lot && BY_LOT.get(lot);
    return p ? p.names : null;
  };
  // the boards goods stand on, in world coords (tools / tripods)
  CBZ.cityStoreGoodsShelves = function (lot) {
    const p = lot && BY_LOT.get(lot);
    if (!p) return null;
    return p.boards.map(function (bo) {
      return { x: bo.wx, y: bo.wy, z: bo.wz, top: bo.y, fx: bo.wfx, fz: bo.wfz, island: bo.kind !== "wall", kind: bo.kind };
    });
  };
  // the fit-out's occupancy ledger: building-local footprints of every fixture
  // this file stands in a shell (fitout_work.js keeps its plant, bin, stockroom
  // and set pieces out of them instead of re-deriving the layout).
  CBZ.storeGoodsRects = function (b) { return (b && b.group && RECTS.get(b.group)) || null; };
  CBZ.cityGoodsLot = function (kind) {
    for (let i = 0; i < PLANS.length; i++) if (!kind || PLANS[i].kind === kind) return PLANS[i].lot;
    return null;
  };
  // headless / harness handle: buy a named unit off the nearest live store
  CBZ.cityGoodsBuy = function (name) {
    for (let i = 0; i < S.live.length; i++) {
      const p = S.live[i];
      for (let k = 0; k < p.slots.length; k++) {
        const sl = p.slots[k];
        if (sl.obj && sl.name === name) { buySlot(sl); return true; }
      }
    }
    return false;
  };
  CBZ.cityStoreGoodsAudit = function () {
    let shelves = 0, slots = 0, standing = 0, goods = 0, meshes = 0;
    const kinds = {};
    for (let i = 0; i < PLANS.length; i++) {
      const p = PLANS[i];
      shelves += p.boards.length;
      slots += p.slots.length;
      goods += p.goods.length;
      kinds[p.kind] = (kinds[p.kind] | 0) + 1;
      for (let k = 0; k < p.slots.length; k++) if (p.slots[k].obj) standing++;
      if (p.group) p.group.traverse(function (m) { if (m.isMesh) meshes++; });
    }
    return { stores: PLANS.length, kinds: kinds, shelves: shelves, slots: slots, standing: standing,
             goods: goods, meshes: meshes, live: S.live.length };
  };
  CBZ.cityStoreGoodsNear = function () {
    const P = CBZ.player;
    if (!P) return null;
    let best = null, bd = 1e9;
    for (let i = 0; i < PLANS.length; i++) {
      const d = Math.hypot(PLANS[i].cx - P.pos.x, PLANS[i].cz - P.pos.z);
      if (d < bd) { bd = d; best = PLANS[i]; }
    }
    if (!best) return null;
    let standing = 0, mesh = 0;
    for (let k = 0; k < best.slots.length; k++) if (best.slots[k].obj) standing++;
    if (best.group) best.group.traverse(function (m) { if (m.isMesh) mesh++; });
    return { kind: best.kind, dist: Math.round(bd * 10) / 10, names: best.names.slice(),
             shelves: best.boards.length, runs: best.runs.length, lanes: best.lanes.length,
             cooler: !!best.cooler, coffee: !!best.coffee, warmer: !!best.warmer,
             slots: best.slots.length, standing: standing, goods: best.goods.length,
             meshes: mesh, built: !!best.built };
  };
})();
