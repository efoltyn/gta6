/* ============================================================
   world/fuel_station.js — ONE filling station, built for real.

   Shared by the Natural Disaster island (world/disaster_arena.js) and the
   city annex (city/expansion.js). Both used to carry their own copy of the
   same sketch: a grey pad, four white posts under a white slab with a red
   stripe, orange boxes for pumps, a yellow card on a stick for a price sign
   and a glass box for a shop. This is the one builder both now call.

   What a stranger should recognise in a screenshot:
     - a canopy with a THICK fascia (banded, LED edge strip) whose soffit
       carries a grid of recessed lights, and a warm pool of light on the
       concrete under it after dark (additive decal riding CBZ.nightAmount:
       no real THREE lights, so no shader recompiles on the iPad);
     - two raised pump islands with steel bollards, each carrying a
       two-sided dispenser: dark cabinet, white head, LCD screens, grade
       buttons, pump numbers, nozzles in their boots and hoses that loop;
       a bin and a squeegee bucket at the island ends;
     - a broom-finished concrete forecourt with saw-cut expansion joints and
       oil stains where cars actually stand;
     - a convenience store with an aluminium storefront, a lit interior you
       can see through the glass (gondola shelves of stock, glowing drink
       coolers on the back wall, the counter), an entrance awning with
       downlights, bollards in front of the glass, an ice merchandiser, a
       propane exchange cage, an air/water machine and a dumpster;
     - a price pylon with LED prices (octane numbers and prices only, no
       invented brand);
     - painted parking stalls with wheel stops, curbs along the sides and
       drive-in aprons to the road.

   LOCAL FRAME: x runs along the road frontage (-12..12), z runs from the
   road (-13, the front edge) to the back of the lot (+13). opts.rotY turns
   local -z toward the road; it must be a multiple of 90 degrees so the
   colliders stay axis-aligned.

   Draw calls per station: ~8, shared materials across every station.

   CBZ.buildFuelStation(opts) -> { group, footprint, deckY }
     opts.parent    THREE.Object3D to add to (default CBZ.scene)
     opts.x, z, y   world position of the lot centre; y = ground under it
     opts.rotY      0 | PI/2 | PI | -PI/2
     opts.deck      forecourt top above y (island 0.15 = sidewalk height)
     opts.walkRise  store-front walk / store floor above the deck
     opts.apron     length of drive-in aprons to build in front of the lot
                    (0 when the road system cuts its own curb)
     opts.onGlass(mesh, wx, wy, wz, span)  register shatterable glass
     opts.onCut({x0,x1,z0,z1})             a driveway crossing the sidewalk
     opts.onPad({x0,x1,z0,z1}, topY)       a walkable raised surface
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};

  const W2 = 12, D2 = 13;            // lot half-extents (frontage, depth)

  // ---- colour helpers: author in sRGB hex, store LINEAR (vertex colours) --
  const _c = new THREE.Color();
  function lin(hex, k) {
    _c.setHex(hex); _c.convertSRGBToLinear();
    k = k == null ? 1 : k;
    return [_c.r * k, _c.g * k, _c.b * k];
  }
  // the island grades bright: real albedos times ~0.65
  const C = {
    fascia: lin(0xe9ecef, 0.62), soffit: lin(0xdfe3e8, 0.34),
    stripe: lin(0x173a78, 0.8), pin: lin(0xc8202a, 0.8),
    led: [1.0, 0.98, 0.94], ledWarm: [1.0, 0.86, 0.62],
    column: lin(0xd9dde2, 0.55), clad: lin(0x2a2f36, 0.7),
    concrete: lin(0xa9a69f, 0.55), curb: lin(0xb9b6ae, 0.6),
    island: lin(0xbdbab2, 0.6), islandEdge: lin(0xd8a91c, 0.7),
    cabinet: lin(0x2b3036, 0.7), head: lin(0xeef0f2, 0.6), bezel: lin(0x15181c, 0.7),
    steel: lin(0x9aa1a8, 0.55), black: lin(0x0e0f10, 0.7), rubber: lin(0x1a1b1d, 0.7),
    bollard: lin(0xe3b21a, 0.62), band: lin(0x151515, 0.7),
    stucco: lin(0xc9b89c, 0.55), stuccoDk: lin(0x8f8270, 0.55), bulkhead: lin(0x6b4a3a, 0.6),
    alum: lin(0xb4b9be, 0.5), roof: lin(0x77797b, 0.5), hvac: lin(0xa7abae, 0.5),
    binGreen: lin(0x2f4a3a, 0.6), dump: lin(0x2c5a3c, 0.6), red: lin(0xc0282a, 0.7),
    blue: lin(0x2a5aa8, 0.7), iceWhite: lin(0xf2f4f6, 0.6), tank: lin(0xeeeeea, 0.62),
    paintW: [0.78, 0.78, 0.76], paintY: lin(0xf0c419, 0.9), stain: [1, 1, 1],
    // interior (unlit Basic: the store is lit from inside, day and night)
    inFloor: lin(0xd8d6cf, 0.62), inWall: lin(0xe6e2d8, 0.55), inCeil: lin(0xf0f0ea, 0.62),
    gondola: lin(0xd0d3d6, 0.5), counter: lin(0x6d5a48, 0.55), inDark: lin(0x30343a, 0.55),
    panel: [1.0, 1.0, 0.97],
  };

  // ---- atlas (signage + stock + decals), one 1024 canvas, baked once -----
  // rects in canvas pixels [x, y, w, h]
  const R = {
    price: [0, 0, 440, 520], lcd: [448, 0, 192, 128], num: [640, 0, 96, 96],
    buttons: [448, 128, 256, 64], air: [704, 96, 160, 80], ice: [864, 96, 160, 80],
    propane: [448, 192, 320, 80], open: [768, 192, 256, 96],
    goods: [0, 528, 1024, 256], cooler: [0, 784, 512, 240],
    stain: [512, 784, 128, 128], white: [648, 792, 48, 48], stain2: [704, 784, 128, 128],
    hours: [840, 784, 184, 96],
  };
  const AT = 1024;
  function uvRect(r, sub) {             // -> [u0, v0, u1, v1] (flipY)
    let x = r[0], y = r[1], w = r[2], h = r[3];
    if (sub) { x += sub[0] * w; y += sub[1] * h; w *= sub[2]; h *= sub[3]; }
    return [x / AT, 1 - (y + h) / AT, (x + w) / AT, 1 - y / AT];
  }

  function lcg(seed) { let s = seed >>> 0 || 1; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

  function bakeAtlas() {
    const cv = document.createElement("canvas"); cv.width = cv.height = AT;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, AT, AT);
    const rnd = lcg(0x5f1a7);
    const font = function (px, w) { return (w || "bold") + " " + px + "px Helvetica, Arial, sans-serif"; };
    function text(t, x, y, px, col, align, w) {
      g.font = font(px, w); g.fillStyle = col; g.textAlign = align || "center"; g.textBaseline = "middle"; g.fillText(t, x, y);
    }
    // PRICE PANEL: octane rows, red LED prices, the tenth-cent 9
    (function () {
      const [x, y, w, h] = R.price;
      g.fillStyle = "#1d2126"; g.fillRect(x, y, w, h);
      g.fillStyle = "#0b0c0e"; g.fillRect(x + 10, y + 10, w - 20, h - 20);
      const rows = [["87", "3.49"], ["89", "3.79"], ["93", "4.09"], ["DIESEL", "3.99"]];
      const rh = (h - 40) / 4;
      rows.forEach(function (r, i) {
        const ry = y + 20 + i * rh;
        g.fillStyle = "#e9ecef"; g.fillRect(x + 20, ry + 8, 120, rh - 16);
        text(r[0], x + 80, ry + rh / 2, r[0].length > 3 ? 30 : 54, "#16202c");
        g.fillStyle = "#050505"; g.fillRect(x + 150, ry + 8, w - 170, rh - 16);
        g.save(); g.shadowColor = "#ff3b1f"; g.shadowBlur = 14;
        text(r[1], x + 150 + (w - 170) * 0.45, ry + rh / 2 + 2, 84, "#ff3a22", "center", "bold");
        text("9", x + w - 40, ry + rh / 2 - 16, 40, "#ff3a22", "center", "bold");
        g.restore();
      });
    })();
    // PUMP LCD
    (function () {
      const [x, y, w, h] = R.lcd;
      g.fillStyle = "#222"; g.fillRect(x, y, w, h);
      g.fillStyle = "#a9c3a4"; g.fillRect(x + 8, y + 8, w - 16, h - 16);
      text("$", x + 30, y + 38, 28, "#1b2a1b"); text("0.00", x + 120, y + 38, 40, "#1b2a1b", "center", "bold");
      text("GAL", x + 34, y + 90, 20, "#1b2a1b"); text("0.000", x + 124, y + 90, 30, "#1b2a1b", "center", "bold");
    })();
    // PUMP NUMBERS 1..4 (tiles side by side in one 96 px row: 4 x 96 = 384)
    for (let i = 0; i < 4; i++) {
      const x = R.num[0] + i * 96, y = R.num[1];
      g.fillStyle = "#173a78"; g.fillRect(x + 4, y + 4, 88, 88);
      text(String(i + 1), x + 48, y + 50, 64, "#ffffff");
    }
    // GRADE BUTTONS
    (function () {
      const [x, y, w, h] = R.buttons;
      g.fillStyle = "#101214"; g.fillRect(x, y, w, h);
      const cols = ["#e9ecef", "#e9ecef", "#e9ecef", "#f2c419"];
      ["87", "89", "93", "DSL"].forEach(function (t, i) {
        const bx = x + 8 + i * 62;
        g.fillStyle = cols[i]; g.fillRect(bx, y + 10, 54, h - 20);
        text(t, bx + 27, y + h / 2, 22, "#111");
      });
    })();
    function label(r, bg, fg, t, px) {
      const [x, y, w, h] = r;
      g.fillStyle = bg; g.fillRect(x, y, w, h);
      g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(x + 6, y + 6, w - 12, h - 12);
      text(t, x + w / 2, y + h / 2 + 2, px, fg);
    }
    label(R.air, "#c0282a", "#ffffff", "AIR", 46);
    label(R.ice, "#f4f6f8", "#1f5fb8", "ICE", 50);
    label(R.propane, "#f4f6f8", "#c0282a", "PROPANE", 50);
    label(R.hours, "#f4f6f8", "#16202c", "24 HOURS", 30);
    // OPEN neon
    (function () {
      const [x, y, w, h] = R.open;
      g.fillStyle = "#050505"; g.fillRect(x, y, w, h);
      g.save(); g.shadowColor = "#ff2020"; g.shadowBlur = 18; g.strokeStyle = "#ff5040"; g.lineWidth = 5;
      g.strokeRect(x + 14, y + 12, w - 28, h - 24);
      text("OPEN", x + w / 2, y + h / 2 + 2, 52, "#ff6a5a"); g.restore();
    })();
    // GOODS: four shelves of packaged stock, 64 px per shelf
    (function () {
      const [x, y, w, h] = R.goods;
      g.fillStyle = "#cfd3d6"; g.fillRect(x, y, w, h);
      const pal = ["#c8202a", "#f2c419", "#1f5fb8", "#2f8f3a", "#f07f1a", "#7b2f8f", "#e8e2d0", "#1a1a1a", "#d84f8f", "#3fb8c8", "#8a5a2a"];
      for (let s = 0; s < 4; s++) {
        const sy = y + s * 64;
        g.fillStyle = "#7d8286"; g.fillRect(x, sy, w, 6);                 // back panel shadow
        let px = x + 2;
        while (px < x + w - 8) {
          const pw = 10 + ((rnd() * 20) | 0), ph = 26 + ((rnd() * 26) | 0), n = 1 + ((rnd() * 4) | 0);
          const col = pal[(rnd() * pal.length) | 0];
          for (let k = 0; k < n && px < x + w - 8; k++) {
            g.fillStyle = col; g.fillRect(px, sy + 56 - ph, pw - 1, ph);
            g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(px + 1, sy + 56 - ph + 4, pw - 3, 4);
            g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(px + pw - 3, sy + 56 - ph, 2, ph);
            px += pw;
          }
          px += (rnd() * 3) | 0;
        }
        g.fillStyle = "#e9ecef"; g.fillRect(x, sy + 56, w, 8);             // shelf edge
        for (let t = x + 10; t < x + w; t += 40 + ((rnd() * 30) | 0)) { g.fillStyle = "#f7f3a0"; g.fillRect(t, sy + 57, 14, 6); }
      }
    })();
    // COOLER DOORS: bottles behind glass, lit
    (function () {
      const [x, y, w, h] = R.cooler;
      g.fillStyle = "#f4f6f4"; g.fillRect(x, y, w, h);
      const pal = ["#c8202a", "#1f5fb8", "#2f8f3a", "#f2c419", "#bfe0f0", "#f07f1a", "#222"];
      for (let s = 0; s < 5; s++) {
        const sy = y + 12 + s * 45;
        g.fillStyle = "#9aa0a4"; g.fillRect(x, sy + 38, w, 4);
        let px = x + 3;
        while (px < x + w - 6) {
          const col = pal[(rnd() * pal.length) | 0], n = 3 + ((rnd() * 6) | 0);
          for (let k = 0; k < n && px < x + w - 6; k++) {
            g.fillStyle = col; g.fillRect(px, sy + 10, 8, 28); g.fillRect(px + 2, sy + 4, 4, 7);
            g.fillStyle = "rgba(255,255,255,0.3)"; g.fillRect(px + 1, sy + 12, 2, 24);
            px += 10;
          }
          px += 2;
        }
      }
      g.fillStyle = "#2a2e32";
      for (let d = 0; d <= 4; d++) g.fillRect(x + d * (w / 4) - (d === 4 ? 8 : 0), y, 8, h);   // door frames
      g.fillRect(x, y, w, 8); g.fillRect(x, y + h - 8, w, 8);
      const gr = g.createLinearGradient(x, y, x + w, y + h);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, "rgba(255,255,255,0.18)"); gr.addColorStop(0.56, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(x, y, w, h);
    })();
    // STAINS (alpha) and WHITE paint
    function stain(r, seed) {
      const [x, y, w, h] = r, r2 = lcg(seed);
      const id = g.createImageData(w, h), d = id.data;
      const blobs = [];
      for (let i = 0; i < 7; i++) blobs.push([w * (0.3 + r2() * 0.4), h * (0.3 + r2() * 0.4), w * (0.08 + r2() * 0.2)]);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        let a = 0;
        for (const b of blobs) { const dd = Math.hypot(i - b[0], j - b[1]) / b[2]; a += Math.max(0, 1 - dd * dd); }
        a = Math.min(1, a) * (0.75 + 0.25 * r2());
        const o = (j * w + i) * 4;
        d[o] = 8; d[o + 1] = 7; d[o + 2] = 6; d[o + 3] = Math.round(a * 150);
      }
      g.putImageData(id, x, y);
    }
    stain(R.stain, 0x0113); stain(R.stain2, 0x0a51);
    g.fillStyle = "#ffffff"; g.fillRect(R.white[0], R.white[1], R.white[2], R.white[3]);
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  }

  // broom-finished concrete, 8 m tile, saw-cut joints every 4 m, stains
  function bakeSlab() {
    const N = (CBZ.qualityLevel != null && CBZ.qualityLevel <= 1) ? 512 : 1024;
    const cv = document.createElement("canvas"); cv.width = cv.height = N;
    const g = cv.getContext("2d");
    const id = g.createImageData(N, N), d = id.data, rnd = lcg(0xc0c2e7);
    const h01 = CBZ.hash01 || function (a, b, s) { const v = Math.sin(a * 12.9898 + b * 78.233 + s) * 43758.5453; return v - Math.floor(v); };
    function vn(x, y, cell, salt) {
      const gx = x / cell, gy = y / cell, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), P = N / cell;
      const w = function (a) { return ((a % P) + P) % P; };
      const a = h01(w(ix), w(iy), salt), b = h01(w(ix + 1), w(iy), salt), c = h01(w(ix), w(iy + 1), salt), e = h01(w(ix + 1), w(iy + 1), salt);
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + e) * ux * uy;
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const blot = vn(i, j, N / 8, 11) * 0.6 + vn(i, j, N / 32, 12) * 0.4;
      const broom = (h01(i, j >> 1, 13) - 0.5) * 10;        // fine broom streaks run across
      let v = 150 + (blot - 0.5) * 26 + broom + (rnd() - 0.5) * 10;
      const o = (j * N + i) * 4;
      d[o] = v + 1; d[o + 1] = v - 1; d[o + 2] = v - 5; d[o + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    // saw-cut joints: dark line with a light chipped lip
    const jw = Math.max(2, N / 340);
    for (const p of [0, N / 2]) {
      g.fillStyle = "rgba(48,46,44,0.85)"; g.fillRect(p, 0, jw, N); g.fillRect(0, p, N, jw);
      g.fillStyle = "rgba(200,198,190,0.35)"; g.fillRect(p + jw, 0, 1, N); g.fillRect(0, p + jw, N, 1);
    }
    // hairline cracks
    g.strokeStyle = "rgba(60,58,54,0.55)"; g.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      let x = rnd() * N, y = rnd() * N, a = rnd() * 6.28;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 14; s++) { a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * N / 90; y += Math.sin(a) * N / 90; g.lineTo(x, y); }
      g.stroke();
    }
    // tyre scuffs + small drips (the big stains are placed as decals)
    for (let k = 0; k < 26; k++) {
      const x = rnd() * N, y = rnd() * N, r = N / 200 + rnd() * N / 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(30,28,26,0.35)"); gr.addColorStop(1, "rgba(30,28,26,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  }

  // soft rounded-rect light pool (data: additive intensity)
  function bakePool() {
    const N = 128, cv = document.createElement("canvas"); cv.width = cv.height = N;
    const g = cv.getContext("2d"), id = g.createImageData(N, N), d = id.data;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = Math.abs(i / (N - 1) * 2 - 1), v = Math.abs(j / (N - 1) * 2 - 1);
      const du = Math.max(0, u - 0.45) / 0.55, dv = Math.max(0, v - 0.45) / 0.55;
      const r = Math.min(1, Math.hypot(du, dv));
      const a = Math.pow(1 - r * r, 2);
      const o = (j * N + i) * 4, b = Math.round(255 * a);
      d[o] = b; d[o + 1] = b; d[o + 2] = b; d[o + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return new THREE.CanvasTexture(cv);
  }

  let M = null;
  function mats() {
    if (M) return M;
    let atlas = null, slab = null, pool = null;
    try { atlas = bakeAtlas(); slab = bakeSlab(); pool = bakePool(); } catch (e) { /* no canvas */ }
    const sh = function (m, name) { m._shared = true; m.name = name; return m; };
    M = {
      solid: sh(new THREE.MeshLambertMaterial({ vertexColors: true }), "fuel-solid"),
      glow: sh(new THREE.MeshBasicMaterial({ vertexColors: true }), "fuel-glow"),
      sign: sh(new THREE.MeshBasicMaterial({ vertexColors: true, map: atlas }), "fuel-sign"),
      label: sh(new THREE.MeshLambertMaterial({ vertexColors: true, map: atlas }), "fuel-label"),
      decal: sh(new THREE.MeshLambertMaterial({ vertexColors: true, map: atlas, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), "fuel-decal"),
      slab: sh(new THREE.MeshLambertMaterial({ vertexColors: true, map: slab }), "fuel-slab"),
      glass: sh(new THREE.MeshPhongMaterial({ color: 0x0b1418, specular: 0x6a7378, shininess: 90,
        transparent: true, opacity: 0.3, depthWrite: false }), "fuel-glass"),
      pool: sh(new THREE.MeshBasicMaterial({ map: pool, color: 0xffe9c8, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true,
        polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), "fuel-lightpool"),
    };
    if (!atlas) { M.sign.map = null; M.label.map = null; M.decal.map = null; M.decal.visible = false; }
    if (!slab) M.slab.color.setRGB(0.3, 0.29, 0.27);
    else M.slab.color.setRGB(0.62, 0.62, 0.62);   // canvas ~0.30 linear -> ~0.19 albedo
    // the forecourt comes alive after dark
    if (CBZ.onUpdate) CBZ.onUpdate(48.2, function () {
      const n = CBZ.lightsOnAmount();
      const s = n <= 0.15 ? 0 : Math.min(1, (n - 0.15) / 0.5);
      M.pool.opacity = s * s * (3 - 2 * s) * 0.4;
      M.pool.visible = M.pool.opacity > 0.01;
    });
    return M;
  }

  /* HOW DARK IS IT, 0..1 — what switches street and forecourt lights on.
     The city runs the day/night clock (CBZ.nightAmount). On the island the
     light is the clock's hour graded by the disaster (modes/survival.js), so
     darkness is measured off the light rig itself (last frame's sun + sky):
     the lamps come on at dusk and night, and also under a black storm, an
     ash cloud or the nuke's winter. */
  CBZ.lightsOnAmount = function () {
    const island = CBZ.islandModeOn && CBZ.game && CBZ.islandModeOn(CBZ.game.mode);
    if (!island || !CBZ.sun) return CBZ.nightAmount || 0;
    const sc = CBZ.sun.color, lum = CBZ.sun.intensity * (0.3 * sc.r + 0.59 * sc.g + 0.11 * sc.b) +
      (CBZ.hemi ? CBZ.hemi.intensity * 0.5 : 0);
    const k = (1.05 - lum) / 0.6;
    return k < 0 ? 0 : k > 1 ? 1 : k;
  };

  CBZ.buildFuelStation = function (opts) {
    opts = opts || {};
    const m = mats();
    const deck = opts.deck != null ? opts.deck : 0.15;
    const rise = opts.walkRise != null ? opts.walkRise : 0.15;
    const rotY = opts.rotY || 0;
    const ox = opts.x || 0, oz = opts.z || 0, oy = opts.y || 0;
    const group = new THREE.Group();
    group.name = "fuel-station";
    group.position.set(ox, oy, oz); group.rotation.y = rotY;
    (opts.parent || CBZ.scene).add(group);
    const cs = Math.round(Math.cos(rotY)), sn = Math.round(Math.sin(rotY));
    function toW(lx, lz) { return [ox + lx * cs + lz * sn, oz - lx * sn + lz * cs]; }
    function aabbW(x0, x1, z0, z1) {
      const a = toW(x0, z0), b = toW(x1, z1);
      return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) };
    }
    const cols = [];
    // local AABB collider, y relative to the station ground
    function solid(x0, x1, z0, z1, y0, y1, noCam) { cols.push({ a: aabbW(x0, x1, z0, z1), y0: oy + y0, y1: oy + y1, noCam: !!noCam }); }

    // ---- geometry accumulator ----------------------------------------------
    const acc = {};
    function put(key, g, c) {
      if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
      const cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(cnt * 2), 2));
      (acc[key] || (acc[key] = [])).push(g);
      return g;
    }
    function bx(key, x, y, z, w, h, d, c) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return put(key, g, c); }
    function cy(key, x, y, z, rt, rb, h, c, seg, ts, tl) {
      const g = new THREE.CylinderGeometry(rt, rb, h, seg || 10, 1, false, ts || 0, tl || Math.PI * 2);
      g.translate(x, y, z); return put(key, g, c);
    }
    // a flat quad facing `face` with optional atlas uv rect
    function quad(key, x, y, z, w, h, face, c, uv) {
      const g = new THREE.PlaneGeometry(w, h);
      if (uv) {
        const a = g.attributes.uv;
        for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
      }
      if (face === "nz") g.rotateY(Math.PI);
      else if (face === "px") g.rotateY(Math.PI / 2);
      else if (face === "nx") g.rotateY(-Math.PI / 2);
      else if (face === "up") g.rotateX(-Math.PI / 2);
      else if (face === "dn") g.rotateX(Math.PI / 2);
      g.translate(x, y, z);
      return put(key, g, c);
    }
    function tube(key, pts, r, c) {
      const curve = new THREE.CatmullRomCurve3(pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }));
      return put(key, new THREE.TubeGeometry(curve, 18, r, 5, false), c);
    }
    function bollard(x, z, y) {
      y = y == null ? deck : y;
      cy("solid", x, y + 0.5, z, 0.085, 0.085, 1.0, C.bollard, 10);
      cy("solid", x, y + 0.78, z, 0.088, 0.088, 0.1, C.band, 10);
      cy("solid", x, y + 1.02, z, 0.06, 0.085, 0.05, C.bollard, 10);
      solid(x - 0.1, x + 0.1, z - 0.1, z + 0.1, 0, y + 1.05, true);
    }

    // ---- FORECOURT SLAB: textured top, concrete skirt, side curbs ---------
    {
      const g = new THREE.PlaneGeometry(W2 * 2, D2 * 2, 1, 1);
      g.rotateX(-Math.PI / 2); g.translate(0, deck, 0);
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 8, p.getZ(i) / 8);
      put("slab", g, [1, 1, 1]);
      const sk = C.concrete, SK = deck + 0.6;
      bx("solid", 0, deck - SK / 2 - 0.004, D2 - 0.05, W2 * 2, SK, 0.1, sk);
      bx("solid", -W2 + 0.05, deck - SK / 2 - 0.004, 0, 0.1, SK, D2 * 2, sk);
      bx("solid", W2 - 0.05, deck - SK / 2 - 0.004, 0, 0.1, SK, D2 * 2, sk);
      bx("solid", 0, deck - SK / 2 - 0.004, -D2 + 0.05, W2 * 2, SK, 0.1, sk);
      // raised border curbs down both sides and the back (not the frontage)
      bx("solid", -W2 + 0.12, deck + 0.075, 0.4, 0.24, 0.15, D2 * 2 - 0.8, C.curb);
      bx("solid", W2 - 0.12, deck + 0.075, 0.4, 0.24, 0.15, D2 * 2 - 0.8, C.curb);
      bx("solid", 0, deck + 0.075, D2 - 0.12, W2 * 2, 0.15, 0.24, C.curb);
      if (opts.onPad) opts.onPad(aabbW(-W2, W2, -D2, D2), oy + deck);
    }
    // drive-in aprons out to the road edge (when the road doesn't cut its own)
    const AP = [[-10, -4.6], [4.6, 10]];
    AP.forEach(function (a) {
      const x0 = a[0], x1 = a[1];
      if (opts.onCut) opts.onCut(aabbW(x0 - 0.6, x1 + 0.6, -D2 - (opts.cutDepth || 2.3), -D2 + 0.01));
      if (opts.apron > 0) {
        const L = opts.apron, g = new THREE.PlaneGeometry(x1 - x0, L);
        g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, deck - 0.004, -D2 - L / 2);
        const p = g.attributes.position, uv = g.attributes.uv;
        for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 8, p.getZ(i) / 8);
        put("slab", g, [0.95, 0.95, 0.95]);
      }
    });

    // ---- CANOPY: columns on the islands, thick banded fascia, lit soffit ---
    const CX0 = -8, CX1 = 8, CZ0 = -10.2, CZ1 = -1.8, CH = 4.7, FH = 1.15;
    const ccx = (CX0 + CX1) / 2, ccz = (CZ0 + CZ1) / 2, cw = CX1 - CX0, cd = CZ1 - CZ0;
    [[-4, -8.4], [-4, -3.6], [4, -8.4], [4, -3.6]].forEach(function (p) {
      bx("solid", p[0], deck + 0.18 + (CH - 0.18) / 2, p[1], 0.42, CH - 0.18, 0.42, C.column);
      bx("solid", p[0], deck + 0.18 + 0.55, p[1], 0.5, 1.1, 0.5, C.clad);           // kick cladding
      solid(p[0] - 0.25, p[0] + 0.25, p[1] - 0.25, p[1] + 0.25, 0, deck + CH);
    });
    bx("solid", ccx, deck + CH + FH / 2, ccz, cw, FH, cd, C.fascia);                  // the fascia box
    bx("solid", ccx, deck + CH + FH * 0.56, ccz, cw + 0.04, 0.34, cd + 0.04, C.stripe); // colour band
    bx("solid", ccx, deck + CH + FH * 0.56 - 0.24, ccz, cw + 0.03, 0.06, cd + 0.03, C.pin);
    bx("glow", ccx, deck + CH + 0.04, ccz, cw + 0.05, 0.05, cd + 0.05, C.led);        // LED edge strip
    bx("solid", ccx, deck + CH + FH + 0.04, ccz, cw - 0.3, 0.08, cd - 0.3, C.roof);   // roof membrane
    quad("glow", ccx, deck + CH - 0.02, ccz, cw - 0.06, cd - 0.06, "dn", C.soffit);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
      const lx = CX0 + 1.6 + i * (cw - 3.2) / 4, lz = CZ0 + 1.4 + j * (cd - 2.8) / 2;
      quad("glow", lx, deck + CH - 0.036, lz, 0.75, 0.75, "dn", C.led);
      bx("solid", lx, deck + CH - 0.025, lz, 0.9, 0.01, 0.9, C.bezel);
    }
    solid(CX0, CX1, CZ0, CZ1, deck + CH, deck + CH + FH);

    // ---- PUMP ISLANDS + DISPENSERS -------------------------------------------
    const IY = deck + 0.18;
    [-4, 4].forEach(function (ix, k) {
      const z0 = -9.3, z1 = -2.7, zc = (z0 + z1) / 2, L = z1 - z0 - 1.3;
      bx("solid", ix, deck + 0.09, zc, 1.3, 0.18, L, C.island);
      cy("solid", ix, deck + 0.09, zc - L / 2, 0.65, 0.65, 0.18, C.island, 12, Math.PI / 2, Math.PI);
      cy("solid", ix, deck + 0.09, zc + L / 2, 0.65, 0.65, 0.18, C.island, 12, -Math.PI / 2, Math.PI);
      bx("solid", ix - 0.652, deck + 0.09, zc, 0.01, 0.16, L, C.islandEdge);
      bx("solid", ix + 0.652, deck + 0.09, zc, 0.01, 0.16, L, C.islandEdge);
      if (opts.onPad) opts.onPad(aabbW(ix - 0.65, ix + 0.65, z0, z1), oy + IY);
      [z0 + 0.25, z1 - 0.25].forEach(function (bz) { bollard(ix - 0.35, bz, IY); bollard(ix + 0.35, bz, IY); });
      // bin + squeegee bucket by the columns
      cy("solid", ix, IY + 0.45, z0 + 1.05, 0.26, 0.24, 0.9, C.binGreen, 12);
      cy("solid", ix, IY + 0.92, z0 + 1.05, 0.27, 0.27, 0.06, C.black, 12);
      cy("solid", ix, IY + 0.35, z1 - 1.05, 0.16, 0.14, 0.3, C.blue, 10);
      bx("solid", ix, IY + 0.62, z1 - 1.05, 0.03, 0.55, 0.03, C.black);
      // dispenser: cabinet, head, screens both sides
      const dz = zc, DH = 1.95;
      bx("solid", ix, IY + 0.55, dz, 0.62, 1.1, 1.3, C.cabinet);
      bx("solid", ix, IY + 1.1 + 0.425, dz, 0.66, 0.85, 1.36, C.head);
      bx("solid", ix, IY + DH - 0.02, dz, 0.7, 0.08, 1.4, C.stripe);
      bx("solid", ix, IY + 0.04, dz, 0.7, 0.08, 1.4, C.black);                      // plinth
      solid(ix - 0.35, ix + 0.35, dz - 0.7, dz + 0.7, 0, IY + DH);
      [-1, 1].forEach(function (sd, si) {
        const fx = ix + sd * 0.332, face = sd > 0 ? "px" : "nx";
        quad("sign", fx + sd * 0.004, IY + 1.62, dz - 0.2, 0.42, 0.28, face, [1, 1, 1], uvRect(R.lcd));
        quad("sign", fx + sd * 0.004, IY + 1.3, dz - 0.2, 0.52, 0.13, face, [1, 1, 1], uvRect(R.buttons));
        bx("solid", fx, IY + 1.45, dz + 0.36, 0.02, 0.36, 0.26, C.bezel);              // card reader
        quad("sign", fx + sd * 0.004, IY + 1.84, dz + 0.36, 0.16, 0.16, face, [1, 1, 1],
          uvRect(R.num, [((k * 2 + si) % 4) / 4, 0, 0.25, 1]));
        // two nozzles in their boots, hoses looping from the head
        [-0.42, 0.42].forEach(function (nz, ni) {
          const bz = dz + nz, by = IY + 0.95;
          bx("solid", fx + sd * 0.05, by, bz, 0.1, 0.34, 0.14, C.black);                  // boot
          bx("solid", fx + sd * 0.12, by + 0.1, bz, 0.08, 0.1, 0.26, ni ? C.stripe : C.rubber);   // grip
          cy("solid", fx + sd * 0.12, by - 0.08, bz - 0.1, 0.012, 0.012, 0.22, C.steel, 6);        // spout
          tube("solid", [
            [ix + sd * 0.2, IY + DH + 0.05, bz * 0.6 + dz * 0.4],
            [fx + sd * 0.25, IY + DH - 0.15, bz],
            [fx + sd * 0.42, IY + 0.9, bz + 0.05],
            [fx + sd * 0.34, IY + 0.3, bz],
            [fx + sd * 0.2, by + 0.02, bz + 0.13],
          ], 0.019, C.rubber);
        });
      });
    });
    // oil stains where cars stand at the pumps, and a few in the lane
    [[-6.2, -7.2], [-6.1, -4.4], [-1.9, -7.6], [-2.0, -4.9], [1.9, -6.8], [2.1, -4.2], [6.1, -7.4], [6.2, -4.6], [-0.2, -12.0], [0.4, 0.6]]
      .forEach(function (p, i) {
        const s = 0.9 + ((i * 37) % 7) * 0.12;
        quad("decal", p[0], deck + 0.004, p[1], s * 1.2, s * 1.6, "up", C.stain, uvRect(i & 1 ? R.stain2 : R.stain));
      });

    // ---- STORE ----------------------------------------------------------------
    const SX0 = -11.2, SX1 = 2.2, SZ0 = 7.6, SZ1 = 12.6, WALL = 0.25, SH = 4.2, PAR = 4.9;
    const fy = deck + rise;                               // store / walk floor
    const sxc = (SX0 + SX1) / 2, sw = SX1 - SX0, sd = SZ1 - SZ0, szc = (SZ0 + SZ1) / 2;
    // store-front walk with a curb, awning above it
    if (rise > 0) {
      bx("solid", sxc, deck + rise / 2, SZ0 - 0.7, sw + 1.2, rise, 1.4, C.curb);
      if (opts.onPad) opts.onPad(aabbW(SX0 - 0.6, SX1 + 0.6, SZ0 - 1.4, SZ1), oy + fy);
    }
    // walls (back, sides) and the parapet
    bx("solid", sxc, fy + PAR / 2 - rise / 2, SZ1 - WALL / 2, sw, PAR + rise, WALL, C.stucco);
    bx("solid", SX0 + WALL / 2, fy + PAR / 2 - rise / 2, szc, WALL, PAR + rise, sd, C.stucco);
    bx("solid", SX1 - WALL / 2, fy + PAR / 2 - rise / 2, szc, WALL, PAR + rise, sd, C.stucco);
    bx("solid", sxc, fy + PAR - 0.06, szc, sw + 0.1, 0.12, sd + 0.1, C.stuccoDk);      // coping
    bx("solid", sxc, fy + SH + 0.02, szc, sw - 0.4, 0.06, sd - 0.4, C.roof);          // roof deck
    bx("solid", sxc + 3, fy + SH + 0.5, szc + 0.6, 2.2, 0.9, 1.4, C.hvac);            // rooftop unit
    bx("solid", sxc + 3, fy + SH + 0.97, szc + 0.6, 1.2, 0.04, 1.0, C.bezel);
    bx("solid", sxc - 3.4, fy + SH + 0.35, szc + 1.2, 1.2, 0.6, 1.0, C.hvac);
    solid(SX0, SX1, SZ1 - WALL, SZ1, 0, fy + PAR);
    solid(SX0, SX0 + WALL, SZ0, SZ1, 0, fy + PAR);
    solid(SX1 - WALL, SX1, SZ0, SZ1, 0, fy + PAR);
    solid(SX0, SX1, SZ0, SZ1, fy + SH, fy + PAR);
    // storefront: bulkhead, mullions, transom, sign band, door opening
    const DOOR0 = -5.9, DOOR1 = -4.1;
    const GY0 = fy + 0.45, GY1 = fy + 2.9;
    [[SX0, DOOR0], [DOOR1, SX1]].forEach(function (s) {
      const a = s[0] + (s[0] === SX0 ? WALL : 0), b = s[1] - (s[1] === SX1 ? WALL : 0);
      bx("solid", (a + b) / 2, fy + 0.225, SZ0 + 0.1, b - a, 0.45, 0.2, C.bulkhead);
      solid(a, b, SZ0, SZ0 + 0.2, 0, GY1);
      const nm = Math.max(1, Math.round((b - a) / 1.6));
      for (let i = 0; i <= nm; i++) bx("solid", a + (b - a) * i / nm, (GY0 + GY1) / 2, SZ0 + 0.1, 0.08, GY1 - GY0, 0.14, C.alum);
    });
    bx("solid", sxc, GY1 + 0.04, SZ0 + 0.1, sw - 0.5, 0.08, 0.16, C.alum);             // head rail
    bx("solid", sxc, GY0 - 0.02, SZ0 + 0.1, sw - 0.5, 0.05, 0.16, C.alum);
    bx("solid", DOOR0, (fy + GY1) / 2, SZ0 + 0.1, 0.1, GY1 - fy, 0.16, C.alum);   // door jambs
    bx("solid", DOOR1, (fy + GY1) / 2, SZ0 + 0.1, 0.1, GY1 - fy, 0.16, C.alum);
    bx("solid", sxc, (GY1 + 0.08 + fy + PAR) / 2, SZ0 + WALL / 2, sw, fy + PAR - GY1 - 0.08, WALL, C.stucco);  // sign band wall
    // glass: one pane set per station (shatters as one storefront)
    const gl = [];
    [[SX0 + WALL, DOOR0 - 0.05], [DOOR1 + 0.05, SX1 - WALL]].forEach(function (s) {
      const g = new THREE.BoxGeometry(s[1] - s[0], GY1 - GY0, 0.03); g.translate((s[0] + s[1]) / 2, (GY0 + GY1) / 2, SZ0 + 0.1); gl.push(g);
    });
    // sliding door leaves parked open behind the fixed glass
    { const g = new THREE.BoxGeometry(0.95, GY1 - fy - 0.1, 0.03); g.translate(DOOR0 - 0.4, fy + (GY1 - fy) / 2, SZ0 + 0.22); gl.push(g); }
    { const g = new THREE.BoxGeometry(0.95, GY1 - fy - 0.1, 0.03); g.translate(DOOR1 + 0.4, fy + (GY1 - fy) / 2, SZ0 + 0.22); gl.push(g); }
    // entrance awning with downlights
    bx("solid", sxc, fy + 3.25, SZ0 - 0.75, sw + 0.4, 0.35, 1.5, C.stripe);
    bx("solid", sxc, fy + 3.25 + 0.2, SZ0 - 0.75, sw + 0.42, 0.05, 1.52, C.fascia);
    quad("glow", sxc, fy + 3.06, SZ0 - 0.75, sw + 0.3, 1.4, "dn", C.soffit);
    for (let i = 0; i < 6; i++) quad("glow", SX0 + 1.2 + i * (sw - 2.4) / 5, fy + 3.055, SZ0 - 0.75, 0.3, 0.3, "dn", C.ledWarm);
    // OPEN + 24 HOURS in the glass, lit
    quad("sign", -7.6, fy + 2.2, SZ0 + 0.14, 0.9, 0.34, "nz", [1, 1, 1], uvRect(R.open));
    quad("label", -2.8, fy + 2.35, SZ0 + 0.13, 0.7, 0.36, "nz", [1, 1, 1], uvRect(R.hours));
    // store-front bollards (a car can't reach the glass)
    for (let x = SX0 + 0.8; x < SX1; x += 2.2) if (x < DOOR0 - 0.6 || x > DOOR1 + 0.6) bollard(x, SZ0 - 1.22, fy);
    // ---- interior (lit from inside: unlit Basic colours) ----
    const IX0 = SX0 + WALL + 0.01, IX1 = SX1 - WALL - 0.01, IZ1 = SZ1 - WALL - 0.01, IZ0 = SZ0 + 0.2;
    const ixc = (IX0 + IX1) / 2, izc = (IZ0 + IZ1) / 2, iw = IX1 - IX0, id = IZ1 - IZ0, CEIL = fy + 3.2;
    if (rise > 0) bx("solid", ixc, deck + rise / 2, izc, iw, rise, id, C.concrete);
    quad("glow", ixc, fy + 0.006, izc, iw, id, "up", C.inFloor);
    quad("glow", ixc, CEIL, izc, iw, id, "dn", C.inCeil);
    quad("glow", ixc, (fy + CEIL) / 2, IZ1, iw, CEIL - fy, "nz", C.inWall);
    quad("glow", IX0, (fy + CEIL) / 2, izc, id, CEIL - fy, "px", C.inWall);
    quad("glow", IX1, (fy + CEIL) / 2, izc, id, CEIL - fy, "nx", C.inWall);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++)
      quad("glow", IX0 + 1.6 + i * (iw - 3.2) / 3, CEIL - 0.01, IZ0 + 1.3 + j * 2.4, 1.2, 0.3, "dn", C.panel);
    // wall coolers along the back
    bx("glow", -6.6, fy + 1.05, IZ1 - 0.4, 7.6, 2.1, 0.8, C.inDark);
    quad("sign", -6.6, fy + 1.05, IZ1 - 0.805, 7.4, 1.95, "nz", [1, 1, 1], uvRect(R.cooler));
    solid(-10.4, -2.8, IZ1 - 0.8, IZ1, 0, fy + 2.1);
    // two gondola runs, stocked both faces
    const gz = 9.75;
    [[-10.3, -6.5], [-5.6, -1.8]].forEach(function (run) {
      const g0 = run[0], g1 = run[1], gc = (g0 + g1) / 2, gl2 = g1 - g0;
      bx("glow", gc, fy + 0.8, gz, gl2, 1.6, 0.8, C.gondola);
      quad("sign", gc, fy + 0.85, gz - 0.405, gl2 - 0.1, 1.45, "nz", [1, 1, 1], uvRect(R.goods, [0, 0, gl2 / 7.4, 1]));
      quad("sign", gc, fy + 0.85, gz + 0.405, gl2 - 0.1, 1.45, "pz", [1, 1, 1], uvRect(R.goods, [0.3, 0, gl2 / 7.4, 1]));
      solid(g0, g1, gz - 0.4, gz + 0.4, 0, fy + 1.6);
    });
    // counter, register, back rack
    bx("glow", -0.4, fy + 0.5, 9.7, 0.8, 1.0, 3.0, C.counter);
    bx("glow", -0.4, fy + 1.02, 9.7, 0.9, 0.04, 3.1, C.inWall);
    bx("glow", -0.35, fy + 1.2, 9.0, 0.3, 0.3, 0.35, C.inDark);
    quad("glow", -0.52, fy + 1.3, 9.0, 0.24, 0.16, "nx", [0.35, 0.75, 0.9]);
    bx("glow", 1.5, fy + 1.3, 10.0, 0.4, 2.2, 3.4, C.inDark);
    quad("sign", 1.29, fy + 1.45, 10.0, 3.2, 1.3, "nx", [1, 1, 1], uvRect(R.goods, [0.6, 0, 0.4, 1]));
    solid(-0.8, 0, 8.2, 11.2, 0, fy + 1.05);
    solid(1.3, 1.7, 8.3, 11.7, 0, fy + 2.4);

    // ---- ICE merchandiser, PROPANE cage, AIR machine, dumpster --------------
    bx("solid", -10.2, fy + 0.62, SZ0 - 0.45, 1.6, 1.24, 0.75, C.iceWhite);
    bx("solid", -10.2, fy + 1.27, SZ0 - 0.45, 1.64, 0.06, 0.79, C.blue);
    quad("label", -10.2, fy + 0.8, SZ0 - 0.83, 1.0, 0.5, "nz", [1, 1, 1], uvRect(R.ice));
    solid(-11.0, -9.4, SZ0 - 0.85, SZ0 - 0.05, 0, fy + 1.3);
    // propane cage against the store's right wall
    {
      const px0 = 2.6, px1 = 4.4, pz0 = 8.2, pz1 = 11.0, ph = 1.9;
      [[px0, pz0], [px1, pz0], [px0, pz1], [px1, pz1]].forEach(function (p) { bx("solid", p[0], deck + ph / 2, p[1], 0.06, ph, 0.06, C.steel); });
      for (const y of [0.05, 0.95, ph]) {
        bx("solid", (px0 + px1) / 2, deck + y, pz0, px1 - px0, 0.04, 0.04, C.steel);
        bx("solid", (px0 + px1) / 2, deck + y, pz1, px1 - px0, 0.04, 0.04, C.steel);
        bx("solid", px1, deck + y, (pz0 + pz1) / 2, 0.04, 0.04, pz1 - pz0, C.steel);
      }
      for (let i = 0; i < 9; i++) bx("solid", px1, deck + ph / 2, pz0 + (i + 0.5) * (pz1 - pz0) / 9, 0.02, ph, 0.02, C.steel);
      for (let i = 0; i < 4; i++) {
        bx("solid", px0 + (i + 0.5) * (px1 - px0) / 4, deck + ph / 2, pz0, 0.02, ph, 0.02, C.steel);
        bx("solid", px0 + (i + 0.5) * (px1 - px0) / 4, deck + ph / 2, pz1, 0.02, ph, 0.02, C.steel);
      }
      for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        const tx = px0 + 0.5 + j * 0.8, tz = pz0 + 0.55 + i * 0.85, ty = deck + 0.08 + r * 0.95;
        cy("solid", tx, ty + 0.3, tz, 0.15, 0.15, 0.6, C.tank, 10);
        cy("solid", tx, ty + 0.66, tz, 0.07, 0.07, 0.14, C.steel, 8);
      }
      bx("solid", (px0 + px1) / 2, deck + ph / 2, pz0 + 0.02, px1 - px0, 0.02, 0.02, C.steel);
      quad("label", px1 + 0.03, deck + ph + 0.25, (pz0 + pz1) / 2, 1.5, 0.38, "px", [1, 1, 1], uvRect(R.propane));
      bx("solid", (px0 + px1) / 2, deck + ph + 0.02, (pz0 + pz1) / 2, px1 - px0, 0.04, pz1 - pz0, C.steel);
      solid(px0, px1, pz0, pz1, 0, deck + ph);
    }
    // air / water machine on its own pad with bollards
    {
      const ax = 9.8, az = 3.2;
      bx("solid", ax, deck + 0.05, az, 1.4, 0.1, 1.0, C.island);
      bx("solid", ax, deck + 0.5, az + 0.15, 0.12, 0.8, 0.12, C.steel);
      bx("solid", ax, deck + 1.25, az + 0.15, 0.62, 0.9, 0.42, C.red);
      quad("label", ax, deck + 1.45, az - 0.065, 0.46, 0.23, "nz", [1, 1, 1], uvRect(R.air));
      bx("solid", ax, deck + 1.1, az - 0.07, 0.3, 0.2, 0.02, C.bezel);
      const tor = new THREE.TorusGeometry(0.17, 0.018, 5, 18); tor.rotateY(Math.PI / 2); tor.translate(ax + 0.34, deck + 1.15, az + 0.15);
      put("solid", tor, C.black);
      bollard(ax - 0.75, az - 0.75); bollard(ax + 0.75, az - 0.75);
      solid(ax - 0.35, ax + 0.35, az - 0.1, az + 0.4, 0, deck + 1.7);
    }
    // dumpster in a block enclosure behind the canopy side
    {
      const dx = 8.8, dz = 10.6;
      bx("solid", dx, deck + 0.9, dz + 1.2, 3.4, 1.8, 0.2, C.stuccoDk);
      bx("solid", dx - 1.6, deck + 0.9, dz, 0.2, 1.8, 2.4, C.stuccoDk);
      bx("solid", dx + 1.6, deck + 0.9, dz, 0.2, 1.8, 2.4, C.stuccoDk);
      bx("solid", dx, deck + 0.65, dz + 0.2, 2.4, 1.2, 1.4, C.dump);
      bx("solid", dx, deck + 1.3, dz + 0.1, 2.5, 0.08, 1.55, C.black);
      solid(dx - 1.7, dx + 1.7, dz - 0.6, dz + 1.3, 0, deck + 1.8);
    }

    // ---- PAINT: parking stalls + wheel stops in front of the store ----------
    const WHITE = uvRect(R.white);
    for (let i = 0; i <= 4; i++) {
      const x = SX0 + 0.6 + i * 2.9;
      quad("decal", x, deck + 0.003, SZ0 - 4.15, 0.1, 4.6, "up", C.paintW, WHITE);
      if (i < 4) {
        bx("solid", x + 1.45, deck + 0.06, SZ0 - 2.3, 1.8, 0.12, 0.2, C.curb);
        solid(x + 0.55, x + 2.35, SZ0 - 2.4, SZ0 - 2.2, 0, deck + 0.12, true);
      }
    }
    // stop line at the canopy exit + direction lines along the islands
    quad("decal", 0, deck + 0.003, -10.9, 5.0, 0.3, "up", C.paintW, WHITE);
    [-4, 4].forEach(function (ix) { quad("decal", ix, deck + 0.003, -6, 1.7, 7.4, "up", C.paintY, WHITE); });

    // ---- PRICE PYLON at the front corner --------------------------------------
    {
      const px = -10.6, pz = -11.8, PH = 6.4;
      bx("solid", px, deck + 0.3, pz, 1.7, 0.6, 0.9, C.stuccoDk);
      bx("solid", px, deck + 0.6 + (PH - 3.2) / 2, pz, 0.34, PH - 3.2, 0.5, C.clad);
      bx("solid", px, deck + PH - 1.4, pz, 0.36, 2.9, 2.5, C.clad);
      bx("solid", px, deck + PH + 0.12, pz, 0.46, 0.24, 2.6, C.stripe);
      quad("sign", px + 0.185, deck + PH - 1.4, pz, 2.3, 2.7, "px", [1, 1, 1], uvRect(R.price));
      quad("sign", px - 0.185, deck + PH - 1.4, pz, 2.3, 2.7, "nx", [1, 1, 1], uvRect(R.price));
      solid(px - 0.85, px + 0.85, pz - 0.45, pz + 0.45, 0, deck + PH);
    }

    // ---- NIGHT: light pools on the concrete ----------------------------------
    const pools = [];
    { const g = new THREE.PlaneGeometry(cw + 5, cd + 5); g.rotateX(-Math.PI / 2); g.translate(ccx, deck + 0.01, ccz); pools.push(g); }
    { const g = new THREE.PlaneGeometry(sw + 2, 4.6); g.rotateX(-Math.PI / 2); g.translate(sxc, deck + 0.01, SZ0 - 2.0); pools.push(g); }

    // ---- build the meshes ----------------------------------------------------
    const BGU = THREE.BufferGeometryUtils;
    let ref = null;
    Object.keys(acc).forEach(function (key) {
      const geo = BGU.mergeBufferGeometries(acc[key], false);
      acc[key].forEach(function (g) { g.dispose(); });
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, m[key]);
      mesh.name = "fuel-" + key;
      mesh.userData.fuelStation = true;               // batch.js: keep identity
      mesh.castShadow = key === "solid";
      mesh.receiveShadow = key === "solid" || key === "slab" || key === "label";
      if (key === "decal") mesh.renderOrder = 1;
      group.add(mesh);
      if (key === "solid") ref = mesh;
    });
    const glassMesh = new THREE.Mesh(BGU.mergeBufferGeometries(gl, false), m.glass);
    gl.forEach(function (g) { g.dispose(); });
    glassMesh.name = "fuel-glass"; glassMesh.renderOrder = 2; glassMesh.userData.fuelStation = true;
    group.add(glassMesh);
    const poolMesh = new THREE.Mesh(BGU.mergeBufferGeometries(pools, false), m.pool);
    pools.forEach(function (g) { g.dispose(); });
    poolMesh.name = "fuel-lightpool"; poolMesh.renderOrder = 1; poolMesh.userData.fuelStation = true;
    group.add(poolMesh);
    group.updateMatrixWorld(true);
    if (opts.onGlass) {
      const c = toW(sxc, SZ0 + 0.1);
      opts.onGlass(glassMesh, c[0], oy + (GY0 + GY1) / 2, c[1], sw / 2);
    }

    // ---- colliders -------------------------------------------------------------
    const colliders = opts.colliders || CBZ.colliders;
    if (colliders) cols.forEach(function (c) {
      const rec = { minX: c.a.x0, maxX: c.a.x1, minZ: c.a.z0, maxZ: c.a.z1, ref: ref, y0: c.y0, y1: c.y1 };
      if (c.noCam) rec.noCam = true;
      colliders.push(rec);
    });

    return { group: group, footprint: aabbW(-W2, W2, -D2, D2), deckY: oy + deck, toWorld: toW };
  };
  CBZ.FUEL_STATION_SIZE = { frontage: W2 * 2, depth: D2 * 2 };
})();
