/* ============================================================
   city/exec_office.js — THE EXECUTIVE FLOOR of the flagship mega-tower.

   WHY (owner, verbatim intent): "the building the executive spawns in should
   be an absurdly high office — the TALLEST, top floor, massively tall… the
   office should be more intentional: I like the computers, but there's a lot
   of props that are not needed, and separate rooms — if there's a separate
   room it should be an office with ONE desk with SPACE. You don't understand
   space. Not everything is crammed in."

   So this floor is designed around EMPTINESS. Storey 50 of the 52-storey
   Spire (~160m up, directly under the penthouse), one whole floor for one
   man's firm, three rooms and acres of honed stone between them:

     • THE CORNER OFFICE — the full +x end of the plate behind a frameless
       glass front. ONE walnut desk, ONE leather chair, the triple-monitor
       trading terminal (the read the owner likes), two guest chairs, a
       credenza under the window, one fig tree. Nothing else.
     • THE MEETING ROOM — the -x/-z corner. ONE long table, eight chairs,
       one wall screen over a low credenza.
     • RECEPTION — one desk facing the express-lift core, one bench, two
       planters. The rest of the arrival floor is open.

   THIS IS THE FIRST FRAME OF THE GAME. It used to be ~60 flat-colour boxes
   (white slab desk, black-slab monitors on posts, a lit white cube for a
   lamp, floating plank credenzas, a featureless grey ceiling, and windows
   that showed fog). Everything is now built from real shapes: rounded
   cushions, five-star chair bases on casters, drawer fronts with pulls,
   monitors with bezels whose screens carry real trading charts, a suspended
   plaster ceiling with a perimeter bulkhead, recessed downlights and
   sprinkler heads, fan-coil sill cabinets under the curtain wall, mullion
   caps, baseboards, a walnut-clad lift core with brushed steel doors, a
   floor indicator and a call panel, and a honed limestone floor.

   COST: every part is baked into ONE merged mesh per material (about a dozen
   draw calls for the whole storey) built from this file's own geometry kit;
   no real lights (fixtures are unlit emissive faces); textures are small
   seeded canvases built once and shared. Colliders ride invisible proxy
   boxes so physics sees exactly the furniture the eye sees.

   THE VIEW: the storey's curtain-wall panes are retagged kind "view"
   (buildings.js pools them on CBZ.cityViewGlassMat: low-iron glass, 13%
   opacity) and the fake-room glow panels (interiorlight.js) are cleared off
   this storey, so from anywhere on the floor you SEE the city 160 m below.

   THE EXPRESS LIFT: the walnut core is a real, hollow lift car, a STOP of
   the tower's own lift (city/elevators.js). Call on its button opens the
   doors; the car's floor panel rides you to the lobby (or the penthouse,
   or the roof), and the lobby cab's panel rides you back up. It used to be
   a solid box with painted doors and a card that faded you to the street.

   CONTRACTS:
     CBZ.cityFurnishExecOffice(b, baseY, lot) — called by makeMegaTower
       (buildings.js) BEFORE it spreads b into lot.building. Stamps
       b.execOffice = { floorY, spawn, face, desk, liftLanding, name, keepClear }
       (world coords):
         spawn/face — where the Executive origin stands + looks (origins.js)
         liftLanding — the walnut core as a lift stop: its doors (rig),
                      button, pad, cab frame (see elevators.js THE STOPS)
         keepClear  — keep-clear anchors; elevators.js's interiorAvoids
                      folds them in so the carved full-height shaft column
                      steers into the suite's furniture-free wall slots
     Geometry is fully deterministic (pure functions of b.w/b.d and a local
     integer hash — no Math.random) so world builds stay identical per seed.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const FH = 3.2;                    // floor-to-floor (buildings.js metre contract)
  const CEIL = 2.9;                  // suspended ceiling (the slab above bottoms out at 3.0)
  const SOFFIT = 2.745;              // perimeter bulkhead: hides the curtain-wall head band
  const SILL = 0.6;                  // fan-coil sill cabinet top (curtain spandrel is 0.55)
  const FIRM = "Sterling Capital";   // Marcus Sterling's shop (origins.js fiction)

  // ---- palette (vertex colours; one material per SURFACE, not per colour) --
  const C = {
    plaster: 0xe7e4dd, ceil: 0xf4f2ed, sill: 0xd9d9d5, stool: 0xe8e5de, grille: 0x2b2d30,
    mull: 0x2a2c2f, base: 0x26272a, black: 0x121315, gunmetal: 0x3a3d42, chrome: 0xc8ccd2,
    leather: 0x1c1613, cognac: 0x6a3f24, fabric: 0x3a3f46, mesh: 0x1e2023,
    brass: 0xb38b4c, pot: 0x2d2e30, potPale: 0xd8d4cb, soil: 0x2a2019, trunk: 0x5b4632,
    paper: 0xf0efe9, stoneTop: 0xe4e0d8, white: 0xf3f3f1, ceramic: 0xf6f5f1,
    coffee: 0x2a160b, walnut: 0xffffff, walnutDark: 0xb9a38f, steel: 0xffffff, steelDark: 0xc4c6c8,
    bookA: 0x6a1f22, bookB: 0x1f2c44, bookC: 0xd7cdb8, pageEdge: 0xefe9da,
    lampWarm: 0xfff0d2, lampCool: 0xf4f3ee, amber: 0xffa928, ledOff: 0x2a2d31,
  };

  // ---- deterministic hash (no Math.random: world builds must replay) ------
  function hsh(i, salt) {
    const s = Math.sin(i * 12.9898 + (salt || 0) * 78.233 + 0.5) * 43758.5453;
    return s - Math.floor(s);
  }
  function rng(seed) {
    let a = (seed | 0) || 1;
    return function () { a = (a * 1664525 + 1013904223) | 0; return ((a >>> 0) % 100000) / 100000; };
  }

  // =========================================================================
  //  TEXTURES — small seeded canvases, built once, shared by every rebuild.
  // =========================================================================
  const tex = {};
  function canvasTex(key, w, h, paint, repeat) {
    if (tex[key]) return tex[key];
    if (typeof document === "undefined") return null;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    if (!g) return null;
    paint(g, w, h);
    const t = new THREE.CanvasTexture(cv);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    tex[key] = t;
    return t;
  }
  // WALNUT: straight-grained veneer, one tile = 1 m. Every stroke's period
  // divides the canvas so the tile repeats without a seam.
  function walnutTex() {
    return canvasTex("walnut", 512, 512, function (g, W, H) {
      const R = rng(71);
      g.fillStyle = "#5b3b25"; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 260; i++) {
        const y0 = R() * H, amp = 1 + R() * 5, k = 1 + ((R() * 3) | 0), ph = R() * 6.28;
        const dark = R() < 0.55;
        g.strokeStyle = dark ? "rgba(38,22,12," + (0.06 + R() * 0.22) + ")" : "rgba(140,98,62," + (0.05 + R() * 0.16) + ")";
        g.lineWidth = 0.6 + R() * 2.4;
        for (const off of [-H, 0, H]) {
          g.beginPath();
          for (let x = 0; x <= W; x += 8) {
            const y = y0 + off + Math.sin((x / W) * 6.2832 * k + ph) * amp + Math.sin((x / W) * 6.2832 * 3 + ph * 2) * amp * 0.3;
            if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
      }
      // pores: short dark dashes along the grain
      for (let i = 0; i < 1400; i++) {
        g.fillStyle = "rgba(25,14,8," + (0.12 + R() * 0.2) + ")";
        g.fillRect(R() * W, R() * H, 2 + R() * 5, 1);
      }
    }, true);
  }
  // HONED LIMESTONE: 1200 x 600 tiles in running bond; one tile of the
  // texture = 2.4 m square (4 courses, 2 tiles each).
  function stoneTex() {
    return canvasTex("stone", 1024, 1024, function (g, W, H) {
      const R = rng(19);
      const TW = 512, TH = 256;
      for (let r = 0; r < 4; r++) {
        for (let c = -1; c < 3; c++) {
          const x0 = c * TW + (r & 1) * (TW / 2), y0 = r * TH;
          const v = 196 + ((R() * 14) | 0) - 7;
          const col = "rgb(" + v + "," + (v - 4) + "," + (v - 11) + ")";
          for (const ox of [0, -W, W]) { g.fillStyle = col; g.fillRect(x0 + ox, y0, TW, TH); }
        }
      }
      // cloudy mottling + fossil flecks
      for (let i = 0; i < 900; i++) {
        const x = R() * W, y = R() * H, rr = 4 + R() * 26;
        g.fillStyle = (R() < 0.5 ? "rgba(120,112,100," : "rgba(235,230,220,") + (0.03 + R() * 0.05) + ")";
        g.beginPath(); g.arc(x, y, rr, 0, 6.2832); g.fill();
      }
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = "rgba(90,84,76," + (0.08 + R() * 0.18) + ")";
        g.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2);
      }
      // faint veins
      for (let i = 0; i < 18; i++) {
        let x = R() * W, y = R() * H;
        g.strokeStyle = "rgba(150,140,126," + (0.08 + R() * 0.1) + ")"; g.lineWidth = 0.8 + R();
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 14; s++) { x += 10 + R() * 24; y += (R() - 0.5) * 22; g.lineTo(x, y); }
        g.stroke();
      }
      // grout: hairline joints
      g.fillStyle = "rgba(128,121,110,0.85)";
      for (let r = 0; r < 4; r++) {
        g.fillRect(0, r * TH, W, 2);
        for (let c = -1; c < 3; c++) {
          const x = c * TW + (r & 1) * (TW / 2);
          for (const ox of [0, W]) g.fillRect(((x + ox) % W + W) % W, r * TH, 2, TH);
        }
      }
    }, true);
  }
  // WOOL RUG: heathered charcoal field, a taupe border band. Mapped 0..1 over
  // each rug (not tiled).
  function rugTex() {
    return canvasTex("rug", 512, 512, function (g, W, H) {
      const R = rng(5);
      g.fillStyle = "#3b3a39"; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 26000; i++) {
        const v = 40 + ((R() * 34) | 0);
        g.fillStyle = "rgba(" + v + "," + (v - 1) + "," + (v - 3) + ",0.55)";
        g.fillRect(R() * W, R() * H, 1 + R() * 2, 1);
      }
      const bw = 18, inset = 26;
      g.strokeStyle = "#857b6f"; g.lineWidth = bw;
      g.strokeRect(inset + bw / 2, inset + bw / 2, W - 2 * inset - bw, H - 2 * inset - bw);
      g.strokeStyle = "rgba(133,123,111,0.7)"; g.lineWidth = 3;
      g.strokeRect(inset + bw + 12, inset + bw + 12, W - 2 * (inset + bw + 12), H - 2 * (inset + bw + 12));
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = "rgba(20,20,20," + (0.05 + R() * 0.08) + ")";
        g.fillRect(R() * W, R() * H, 1, 1);
      }
    }, false);
  }
  // BRUSHED STAINLESS: vertical hairline streaks, one tile = 0.6 m.
  function steelTex() {
    return canvasTex("steel", 256, 256, function (g, W, H) {
      const R = rng(33);
      g.fillStyle = "#a7abb0"; g.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x++) {
        const v = 150 + ((R() * 60) | 0);
        g.fillStyle = "rgba(" + v + "," + (v + 3) + "," + (v + 6) + "," + (0.25 + R() * 0.35) + ")";
        g.fillRect(x, 0, 1, H);
      }
      for (let i = 0; i < 300; i++) {
        g.fillStyle = "rgba(255,255,255," + (R() * 0.12) + ")";
        g.fillRect(R() * W, R() * H, 1, 10 + R() * 60);
      }
    }, true);
  }

  // SCREENS: one atlas, six 512x320 slots. The Executive's story is a market
  // crash, so the trading terminal shows one (red candles falling off a cliff).
  const SLOT_W = 512, SLOT_H = 320, ATLAS_C = 3, ATLAS_R = 2;
  function slotUV(i) {
    const c = i % ATLAS_C, r = (i / ATLAS_C) | 0;
    const Wt = SLOT_W * ATLAS_C, Ht = SLOT_H * ATLAS_R, pad = 2;
    return { u0: (c * SLOT_W + pad) / Wt, u1: ((c + 1) * SLOT_W - pad) / Wt,
             v1: 1 - (r * SLOT_H + pad) / Ht, v0: 1 - ((r + 1) * SLOT_H - pad) / Ht };
  }
  function screenAtlas() {
    return canvasTex("screens", SLOT_W * ATLAS_C, SLOT_H * ATLAS_R, function (g) {
      const slots = [paintCandles, paintHeatmap, paintWatchlist, paintInbox, paintBoardroom, paintLiftIndicator];
      for (let i = 0; i < slots.length; i++) {
        const c = i % ATLAS_C, r = (i / ATLAS_C) | 0;
        g.save(); g.translate(c * SLOT_W, r * SLOT_H);
        g.beginPath(); g.rect(0, 0, SLOT_W, SLOT_H); g.clip();
        slots[i](g, SLOT_W, SLOT_H, rng(101 + i * 17));
        g.restore();
      }
    }, false);
  }
  const UP = "#27b36a", DN = "#e04552", DIM = "#6f8296", GRID = "rgba(120,140,165,0.12)";
  function termHeader(g, W, label, R) {
    g.fillStyle = "#121a24"; g.fillRect(0, 0, W, 22);
    g.fillStyle = "#8ea2b7"; g.font = "bold 12px Arial"; g.fillText(label, 8, 15);
    for (let i = 0; i < 4; i++) { g.fillStyle = "#1d2835"; g.fillRect(W - 150 + i * 36, 5, 30, 12); }
  }
  function paintCandles(g, W, H, R) {
    g.fillStyle = "#0a0e13"; g.fillRect(0, 0, W, H);
    termHeader(g, W, "SPX   1D   CANDLES", R);
    const x0 = 8, x1 = W - 58, y0 = 30, y1 = H - 64;
    g.strokeStyle = GRID; g.lineWidth = 1;
    for (let i = 0; i <= 6; i++) { const y = y0 + (y1 - y0) * i / 6; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
    for (let i = 0; i <= 8; i++) { const x = x0 + (x1 - x0) * i / 8; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, H - 8); g.stroke(); }
    const N = 62, bars = [];
    let p = 100;
    for (let i = 0; i < N; i++) {
      const crash = i > N - 13;
      const drift = crash ? -(1.6 + R() * 2.8) : (R() - 0.42) * 1.8;
      const o = p, c = p + drift, hi = Math.max(o, c) + R() * 1.2, lo = Math.min(o, c) - R() * (crash ? 2.2 : 1.2);
      bars.push({ o: o, c: c, hi: hi, lo: lo, v: crash ? 0.55 + R() * 0.45 : 0.12 + R() * 0.3 });
      p = c;
    }
    let mn = 1e9, mx = -1e9;
    for (const b of bars) { mn = Math.min(mn, b.lo); mx = Math.max(mx, b.hi); }
    const Y = function (v) { return y1 - (v - mn) / (mx - mn) * (y1 - y0); };
    const bw = (x1 - x0) / N;
    for (let i = 0; i < N; i++) {
      const b = bars[i], x = x0 + i * bw + bw / 2, up = b.c >= b.o;
      g.strokeStyle = up ? UP : DN; g.fillStyle = up ? UP : DN;
      g.beginPath(); g.moveTo(x, Y(b.hi)); g.lineTo(x, Y(b.lo)); g.stroke();
      const top = Y(Math.max(b.o, b.c)), bot = Y(Math.min(b.o, b.c));
      g.fillRect(x - bw * 0.32, top, bw * 0.64, Math.max(1, bot - top));
      g.globalAlpha = 0.5; g.fillRect(x - bw * 0.32, H - 10 - b.v * 44, bw * 0.64, b.v * 44); g.globalAlpha = 1;
    }
    // moving average
    g.strokeStyle = "#d7a33a"; g.lineWidth = 1.4; g.beginPath();
    for (let i = 0; i < N; i++) {
      let s = 0, n = 0; for (let k = Math.max(0, i - 9); k <= i; k++) { s += bars[k].c; n++; }
      const x = x0 + i * bw + bw / 2, y = Y(s / n); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.font = "11px Arial"; g.fillStyle = DIM;
    for (let i = 0; i <= 6; i++) { const v = mx - (mx - mn) * i / 6; g.fillText((4200 + v * 9).toFixed(0), x1 + 6, y0 + (y1 - y0) * i / 6 + 4); }
    const last = bars[N - 1].c;
    g.fillStyle = DN; g.fillRect(x1 + 2, Y(last) - 8, 54, 16);
    g.fillStyle = "#fff"; g.font = "bold 11px Arial"; g.fillText((4200 + last * 9).toFixed(0), x1 + 6, Y(last) + 4);
  }
  function paintHeatmap(g, W, H, R) {
    g.fillStyle = "#07090c"; g.fillRect(0, 0, W, H);
    termHeader(g, W, "SECTOR MAP   TODAY", R);
    const TICK = ["NVX", "APLR", "MSFR", "AMZE", "GOOB", "METR", "TSLR", "JPMC", "XOMN", "UNHC", "VISA", "BRKX", "LLYN", "AVGR", "WMTS", "HDEP", "COST", "PEPC", "ABBV", "KOIN", "CRMX", "ORCL", "ADBX", "NFLQ"];
    let ti = 0;
    function cell(x, y, w, h, depth) {
      if (depth > 0 && w * h > 5200) {
        const f = 0.35 + R() * 0.3;
        if (w > h) { cell(x, y, w * f, h, depth - 1); cell(x + w * f, y, w * (1 - f), h, depth - 1); }
        else { cell(x, y, w, h * f, depth - 1); cell(x, y + h * f, w, h * (1 - f), depth - 1); }
        return;
      }
      const ch = R() < 0.12 ? R() * 2.5 : -(0.5 + R() * 7.5);
      const k = Math.min(1, Math.abs(ch) / 7);
      g.fillStyle = ch >= 0 ? "rgb(" + (20 + k * 20 | 0) + "," + (70 + k * 90 | 0) + "," + (45 + k * 40 | 0) + ")"
                            : "rgb(" + (70 + k * 150 | 0) + "," + (22 + k * 18 | 0) + "," + (28 + k * 22 | 0) + ")";
      g.fillRect(x + 1, y + 1, w - 2, h - 2);
      if (w > 44 && h > 26) {
        g.fillStyle = "rgba(255,255,255,0.92)"; g.font = "bold " + (w > 110 && h > 60 ? 16 : 11) + "px Arial";
        const t = TICK[ti++ % TICK.length];
        g.fillText(t, x + 6, y + (h > 60 ? 22 : 16));
        g.font = "11px Arial"; g.fillStyle = "rgba(255,255,255,0.75)";
        g.fillText((ch >= 0 ? "+" : "") + ch.toFixed(2) + "%", x + 6, y + (h > 60 ? 38 : 28));
      }
    }
    cell(0, 24, W, H - 24, 7);
  }
  function paintWatchlist(g, W, H, R) {
    g.fillStyle = "#0b0f15"; g.fillRect(0, 0, W, H);
    termHeader(g, W, "WATCHLIST   INDICES", R);
    // index line with a filled area, falling off a ledge at the right
    const cx0 = 8, cx1 = W - 8, cy0 = 30, cy1 = 128;
    g.strokeStyle = GRID;
    for (let i = 0; i <= 4; i++) { const y = cy0 + (cy1 - cy0) * i / 4; g.beginPath(); g.moveTo(cx0, y); g.lineTo(cx1, y); g.stroke(); }
    const pts = []; let v = 0.35;
    for (let i = 0; i <= 90; i++) { v += (i > 74 ? 0.035 + R() * 0.03 : (R() - 0.52) * 0.035); v = Math.max(0.05, Math.min(0.97, v)); pts.push(v); }
    g.beginPath(); g.moveTo(cx0, cy1);
    pts.forEach(function (p, i) { g.lineTo(cx0 + (cx1 - cx0) * i / 90, cy0 + p * (cy1 - cy0)); });
    g.lineTo(cx1, cy1); g.closePath(); g.fillStyle = "rgba(224,69,82,0.18)"; g.fill();
    g.beginPath();
    pts.forEach(function (p, i) { const x = cx0 + (cx1 - cx0) * i / 90, y = cy0 + p * (cy1 - cy0); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.strokeStyle = DN; g.lineWidth = 1.6; g.stroke();
    const rows = ["SPX", "NDQ", "DJI", "RUT", "VIX", "TNX", "DXY", "GLD", "OIL", "BTC"];
    g.font = "12px Arial";
    for (let i = 0; i < rows.length; i++) {
      const y = 150 + i * 16.5;
      if (i & 1) { g.fillStyle = "rgba(255,255,255,0.03)"; g.fillRect(0, y - 12, W, 16.5); }
      const up = rows[i] === "VIX" || rows[i] === "GLD" || rows[i] === "TNX";
      const ch = (up ? 1 : -1) * (0.4 + R() * (rows[i] === "VIX" ? 38 : 6));
      g.fillStyle = "#c9d5e2"; g.fillText(rows[i], 10, y);
      g.fillStyle = DIM; g.fillText((100 + R() * 4900).toFixed(2), 120, y);
      g.fillStyle = up ? UP : DN; g.fillText((ch > 0 ? "+" : "") + ch.toFixed(2) + "%", 250, y);
      g.strokeStyle = up ? UP : DN; g.lineWidth = 1; g.beginPath();
      let q = 0.5;
      for (let s = 0; s < 24; s++) { q += (R() - (up ? 0.4 : 0.6)) * 0.25; q = Math.max(0, Math.min(1, q)); const x = 360 + s * 5.8, yy = y - 2 - q * 9; if (s) g.lineTo(x, yy); else g.moveTo(x, yy); }
      g.stroke();
    }
  }
  function paintInbox(g, W, H, R) {
    g.fillStyle = "#1a212c"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#121821"; g.fillRect(0, 0, 118, H);
    g.fillStyle = "#26303e"; g.fillRect(0, 0, W, 24);
    for (let i = 0; i < 7; i++) { g.fillStyle = i === 1 ? "#34506e" : "#1c2430"; g.fillRect(8, 36 + i * 24, 102, 18); }
    // a day calendar: time rail + muted meeting blocks
    g.fillStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i < 10; i++) g.fillRect(126, 34 + i * 28, W - 134, 1);
    const cols = ["#2e5f86", "#2f6f63", "#6a4f86", "#7a5a2e"];
    for (let i = 0; i < 6; i++) {
      const y = 36 + ((R() * 8) | 0) * 28, h = 24 + ((R() * 2) | 0) * 28, x = 132 + (i % 2) * 180;
      g.fillStyle = cols[i % cols.length]; g.fillRect(x, y, 170, h - 4);
      g.fillStyle = "rgba(255,255,255,0.55)"; g.fillRect(x + 8, y + 7, 60 + R() * 70, 5);
    }
  }
  function paintBoardroom(g, W, H, R) {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#0e1a2b"); gr.addColorStop(1, "#070d17");
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,0.8)"; g.font = "bold 18px Arial"; g.fillText("Q3 REVIEW", 22, 34);
    g.fillStyle = "rgba(255,255,255,0.25)"; g.fillRect(22, 44, 140, 2);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = "rgba(255,255,255,0.06)"; g.fillRect(22 + i * 160, 60, 146, 66);
      g.fillStyle = i === 2 ? DN : "#4aa3ff"; g.font = "bold 22px Arial";
      g.fillText(i === 2 ? "-31.4%" : (i ? "4.1B" : "212"), 32 + i * 160, 100);
      g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(32 + i * 160, 110, 70, 4);
    }
    const x0 = 22, x1 = W - 22, y0 = 148, y1 = H - 24;
    g.strokeStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i <= 4; i++) { const y = y0 + (y1 - y0) * i / 4; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
    g.beginPath(); let v = 0.7;
    for (let i = 0; i <= 40; i++) { v -= (i > 30 ? -0.06 : 0.018) + (R() - 0.5) * 0.04; v = Math.max(0.05, Math.min(0.95, v)); const x = x0 + (x1 - x0) * i / 40, y = y0 + v * (y1 - y0); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.strokeStyle = "#4aa3ff"; g.lineWidth = 2.2; g.stroke();
  }
  function paintLiftIndicator(g, W, H) {
    g.fillStyle = "#040404"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#ffae2e"; g.font = "bold 230px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("50", W * 0.56, H * 0.54);
    g.beginPath(); g.moveTo(58, 120); g.lineTo(118, 120); g.lineTo(88, 200); g.closePath(); g.fill();
    g.textAlign = "left"; g.textBaseline = "alphabetic";
  }

  // =========================================================================
  //  MATERIALS — one per surface, cached for the session.
  // =========================================================================
  let MATS = null;
  function mats() {
    if (MATS) return MATS;
    const wood = walnutTex(), stone = stoneTex(), rug = rugTex(), steel = steelTex(), scr = screenAtlas();
    MATS = {
      paint: new THREE.MeshLambertMaterial({ vertexColors: true }),
      satin: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: 0x262626 }),
      chrome: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x9a9a9a }),
      wood: new THREE.MeshPhongMaterial({ vertexColors: true, map: wood, shininess: 36, specular: 0x1c1c1c }),
      floor: new THREE.MeshPhongMaterial({ vertexColors: true, map: stone, shininess: 55, specular: 0x2a2a2a }),
      rug: new THREE.MeshLambertMaterial({ vertexColors: true, map: rug }),
      steel: new THREE.MeshPhongMaterial({ vertexColors: true, map: steel, shininess: 70, specular: 0x6a6a6a }),
      // the ceiling carries a little self-light: a real office ceiling is the
      // brightest surface in the room (uplight + bounce); unlit it read grey
      ceil: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x4a4944 }),
      emit: new THREE.MeshBasicMaterial({ vertexColors: true }),
      screen: new THREE.MeshBasicMaterial({ map: scr, color: 0xd2d2d2 }),
      leaf: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      glass: new THREE.MeshLambertMaterial({ color: 0xd4e4ea, emissive: 0x0c1418, transparent: true, opacity: 0.16, depthWrite: false }),
    };
    // bucket traits: how UVs are generated before a part is transformed
    MATS.wood.userData = { tile: 1.0 };
    MATS.floor.userData = { tile: 2.4 };
    MATS.steel.userData = { tile: 0.6 };
    MATS.rug.userData = { fit: true };
    return MATS;
  }
  let _proxyGeo = null, _proxyMat = null, _bandMat = null;
  function proxyGeo() { return _proxyGeo || (_proxyGeo = new THREE.BoxGeometry(1, 1, 1)); }
  function proxyMat() { return _proxyMat || (_proxyMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2e })); }
  function bandMat() { return _bandMat || (_bandMat = new THREE.MeshBasicMaterial({ color: 0xf4f6f6, transparent: true, opacity: 0.38, depthWrite: false })); }

  // =========================================================================
  //  GEOMETRY KIT — parts are baked into per-material buckets, then merged.
  // =========================================================================
  // A ROUNDED BOX: a subdivided cube pushed onto a sphere of radius r and
  // then split outward per octant, so edges and corners are true quarter
  // rounds with correct normals and the faces stay flat. This one shape is
  // the difference between "a box" and "a cushion / a monitor / a pot".
  function roundedBoxGeo(w, h, d, r, seg) {
    seg = seg || 4;
    r = Math.max(0.001, Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005, d / 2 - 0.0005));
    const g = new THREE.BoxGeometry(1, 1, 1, seg, seg, seg);
    const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3();
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const sx = v.x > 1e-6 ? 1 : v.x < -1e-6 ? -1 : 0;
      const sy = v.y > 1e-6 ? 1 : v.y < -1e-6 ? -1 : 0;
      const sz = v.z > 1e-6 ? 1 : v.z < -1e-6 ? -1 : 0;
      v.normalize();
      n.setXYZ(i, v.x, v.y, v.z);
      p.setXYZ(i, v.x * r + sx * hx, v.y * r + sy * hy, v.z * r + sz * hz);
    }
    return g;
  }
  // a LEAF: a pointed oval folded along its midrib, drooping toward the tip
  function leafGeo(len, wid, fold, droop) {
    const rows = [[0, 0], [0.22, 0.72], [0.55, 1.0], [0.82, 0.62], [1.0, 0]];
    const P = [];
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i][0], hw = rows[i][1] * wid / 2, z = t * len, y = -droop * t * t;
      P.push([[-hw, y + fold * rows[i][1] * 0.5, z], [0, y, z], [hw, y + fold * rows[i][1] * 0.5, z]]);
    }
    const out = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      out.push(a[0], b[0], b[1], a[0], b[1], a[1], a[1], b[1], b[2], a[1], b[2], a[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([].concat.apply([], out), 3));
    g.computeVertexNormals();
    return g;
  }
  // a SNAKE-PLANT blade: tall, stiff, cupped, narrowing to a point
  function bladeGeo(hgt, wid, lean) {
    const N = 5, out = [];
    const row = function (t) {
      const hw = wid / 2 * (t < 0.12 ? 0.7 + t * 2.5 : 1 - Math.pow((t - 0.12) / 0.88, 1.6) * 0.96);
      const z = lean * t * t * hgt, y = t * hgt;
      return [[-hw, y, z + hw * 0.35], [0, y, z], [hw, y, z + hw * 0.35]];
    };
    for (let i = 0; i < N; i++) {
      const a = row(i / N), b = row((i + 1) / N);
      out.push(a[0], b[0], b[1], a[0], b[1], a[1], a[1], b[1], b[2], a[1], b[2], a[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([].concat.apply([], out), 3));
    g.computeVertexNormals();
    return g;
  }

  function makeKit(Y) {
    const M = mats();
    const buckets = new Map();       // material -> [geometry]
    const P = new THREE.Matrix4().makeTranslation(0, Y, 0);   // current furniture frame
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ");
    const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
    function local(x, y, z, rx, ry, rz) {
      _e.set(rx || 0, ry || 0, rz || 0, "YXZ"); _q.setFromEuler(_e);
      _m.compose(_p.set(x, y, z), _q, _s);
      return _m.premultiply(P);
    }
    // planar UVs in the part's own metres, so a texture lands at real scale
    // whatever the piece's size; grain follows the longest horizontal run
    function planarUV(g, tile) {
      const p = g.attributes.position, n = g.attributes.normal;
      g.computeBoundingBox();
      const bb = g.boundingBox, alongZ = (bb.max.z - bb.min.z) > (bb.max.x - bb.min.x);
      const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
        let u, v;
        if (ay >= ax && ay >= az) { u = alongZ ? p.getZ(i) : p.getX(i); v = alongZ ? p.getX(i) : p.getZ(i); }
        else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
        else { u = p.getX(i); v = p.getY(i); }
        uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
      }
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    }
    function fitUV(g) {
      const p = g.attributes.position;
      g.computeBoundingBox();
      const bb = g.boundingBox, sx = (bb.max.x - bb.min.x) || 1, sz = (bb.max.z - bb.min.z) || 1;
      const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) - bb.min.x) / sx; uv[i * 2 + 1] = (p.getZ(i) - bb.min.z) / sz; }
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    }
    function add(mat, geo, m4, hex, keepUV) {
      let g = geo.index ? geo.toNonIndexed() : geo;
      if (!g.attributes.normal) g.computeVertexNormals();
      const ud = mat.userData || {};
      if (!keepUV) {
        if (ud.tile) planarUV(g, ud.tile);
        else if (ud.fit) fitUV(g);
      }
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(m4);
      _c.setHex(hex == null ? 0xffffff : hex);
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      let a = buckets.get(mat); if (!a) { a = []; buckets.set(mat, a); }
      a.push(g);
    }
    const K = {
      M: M,
      // set the furniture frame: building-local (x, z), yaw, optional lift
      at: function (x, z, yaw, y) { _e.set(0, yaw || 0, 0, "YXZ"); _q.setFromEuler(_e); P.compose(_p.set(x, Y + (y || 0), z), _q, _s); return K; },
      world: function () { P.makeTranslation(0, Y, 0); return K; },
      box: function (mat, x, y, z, w, h, d, hex, rx, ry, rz) { add(mat, new THREE.BoxGeometry(w, h, d), local(x, y, z, rx, ry, rz), hex); },
      rbox: function (mat, x, y, z, w, h, d, r, hex, rx, ry, rz, seg) { add(mat, roundedBoxGeo(w, h, d, r, seg), local(x, y, z, rx, ry, rz), hex); },
      cyl: function (mat, x, y, z, rt, rb, h, seg, hex, rx, ry, rz, open) { add(mat, new THREE.CylinderGeometry(rt, rb, h, seg || 16, 1, !!open), local(x, y, z, rx, ry, rz), hex); },
      sphere: function (mat, x, y, z, r, hex, sx, sy, sz) {
        const g = new THREE.SphereGeometry(r, 12, 8); g.scale(sx || 1, sy || 1, sz || 1);
        add(mat, g, local(x, y, z), hex);
      },
      torus: function (mat, x, y, z, r, tube, arc, hex, rx, ry, rz) { add(mat, new THREE.TorusGeometry(r, tube, 6, 14, arc || Math.PI * 2), local(x, y, z, rx, ry, rz), hex); },
      geo: function (mat, g, x, y, z, hex, rx, ry, rz, keepUV) { add(mat, g, local(x, y, z, rx, ry, rz), hex, keepUV); },
      // a lit screen quad mapped onto atlas slot i (faces the frame's +z)
      screen: function (slot, x, y, z, w, h, rx, ry) {
        const g = new THREE.PlaneGeometry(w, h), s = slotUV(slot), uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, s.u0 + uv.getX(i) * (s.u1 - s.u0), s.v0 + uv.getY(i) * (s.v1 - s.v0));
        add(M.screen, g, local(x, y, z, rx, ry, 0), 0xffffff, true);
      },
      // a thin tube between two frame-local points (chair frames, cables)
      tube: function (mat, a, b, r, hex, seg) {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1e-4;
        const g = new THREE.CylinderGeometry(r, r, L, seg || 8, 1, true);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
        const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
        add(mat, g, m.premultiply(P), hex);
      },
      // bake every bucket into ONE mesh per material under `group`
      flush: function (group, name) {
        const out = [];
        buckets.forEach(function (parts, mat) {
          let nv = 0;
          for (const g of parts) nv += g.attributes.position.count;
          const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
          let o3 = 0, o2 = 0;
          for (const g of parts) {
            pos.set(g.attributes.position.array, o3); nrm.set(g.attributes.normal.array, o3);
            col.set(g.attributes.color.array, o3); uv.set(g.attributes.uv.array, o2);
            o3 += g.attributes.position.count * 3; o2 += g.attributes.position.count * 2;
            g.dispose();
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
          geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
          geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
          geo.computeBoundingSphere();
          const mesh = new THREE.Mesh(geo, mat);
          mesh.name = name || "exec-office";
          // non-empty userData: core/batch.js leaves the kit's own merged
          // meshes alone (they are already one draw call per material)
          mesh.userData.meshKit = true;
          mesh.castShadow = false;
          mesh.receiveShadow = !mat.transparent && mat !== M.emit && mat !== M.screen;
          if (mat.transparent) mesh.renderOrder = 2;
          mesh.matrixAutoUpdate = false; mesh.updateMatrix();
          group.add(mesh);
          out.push(mesh);
        });
        buckets.clear();
        return out;
      },
    };
    return K;
  }

  // THE KIT IS PUBLIC: the three opening scenes (origins.js's tenant squat and
  // barfly doorway) build their hero props with the same shapes, materials
  // and one-mesh-per-material merge instead of a second box pile.
  //   const K = CBZ.cityMeshKit(floorY); K.at(x, z, yaw); K.rbox(K.M.satin, ...);
  //   K.flush(group, "name")  -> the merged meshes (dispose them to remove)
  CBZ.cityMeshKit = makeKit;
  CBZ.cityMeshKit.rounded = roundedBoxGeo;
  CBZ.cityMeshKit.leaf = leafGeo;
  CBZ.cityMeshKit.hash = hsh;

  // =========================================================================
  //  FURNITURE — each builder draws in the kit's current frame: local +z is
  //  the piece's FRONT (the direction a sitter faces), y up from the floor.
  // =========================================================================
  // FIVE-STAR SWIVEL CHAIR. seatTop is the cushion's top (what propuse declares).
  function swivelChair(K, seatTop, o) {
    const M = K.M, up = o.cover || C.leather, back = o.back || 0.78, armed = o.arms !== false;
    const mat = o.fabric ? M.paint : M.satin;
    const hubY = 0.085;
    for (let k = 0; k < 5; k++) {
      const a = k * 1.2566 + 0.3;
      const sx = Math.sin(a), sz = Math.cos(a);
      K.rbox(M.chrome, sx * 0.16, hubY, sz * 0.16, 0.045, 0.03, 0.3, 0.012, C.chrome, 0, a, 0, 2);
      K.cyl(M.satin, sx * 0.3, 0.03, sz * 0.3, 0.026, 0.026, 0.024, 10, C.black, 0, a, Math.PI / 2);
      K.cyl(M.satin, sx * 0.3, 0.058, sz * 0.3, 0.008, 0.008, 0.03, 6, C.black);
    }
    K.cyl(M.chrome, 0, hubY, 0, 0.05, 0.055, 0.05, 14, C.chrome);
    const seatBot = seatTop - 0.1;
    K.cyl(M.chrome, 0, (hubY + seatBot) / 2, 0, 0.021, 0.021, seatBot - hubY - 0.04, 12, C.chrome);
    K.cyl(M.satin, 0, hubY + 0.1, 0, 0.034, 0.036, 0.13, 12, C.black);
    K.box(M.satin, 0, seatBot - 0.025, 0, 0.24, 0.04, 0.24, C.black);
    K.rbox(mat, 0, seatTop - 0.05, 0.01, 0.52, 0.1, 0.5, 0.045, up);
    // back: a tall cushion tilted a few degrees, on a spine off the mechanism
    const tilt = -0.13, bh = back, by = seatTop + 0.05 + bh / 2;
    K.box(M.satin, 0, seatTop - 0.02, -0.25, 0.06, 0.16, 0.03, C.black, tilt);
    if (o.channels && bh > 0.6) {
      // CHANNEL-STITCHED HIGH BACK. The old version was one smooth cushion
      // with three 6 mm lines drawn on it, which at any distance past a metre
      // is a plain box. A real channel back is a row of separately stuffed
      // tubes sewn onto a shell: each tube is its own rounded pad here, so the
      // light rolls over every channel and the seams read as dark grooves.
      // Everything is placed in the back's own tilted frame: u runs up the
      // back from its foot, f runs out of its face toward the sitter.
      const ct = Math.cos(tilt), st = Math.sin(tilt), y0 = seatTop + 0.05, z0 = -0.27;
      const at = function (u, f) { return [y0 + u * ct - f * st, z0 + u * st + f * ct]; };
      const sp = at(bh / 2, -0.012);
      K.rbox(M.satin, 0, sp[0], sp[1], 0.5, bh, 0.065, 0.03, up, tilt);            // the shell
      const N = 6, rim = 0.035, ph = (bh - 2 * rim) / N;
      for (let i = 0; i < N; i++) {
        const p = at(rim + ph * (i + 0.5), 0.034);
        K.rbox(mat, 0, p[0], p[1], 0.455, ph - 0.012, 0.05, 0.022, up, tilt, 0, 0, 3);
      }
      // a rolled head bolster over the top channel
      const hp = at(bh - 0.03, 0.03);
      K.rbox(mat, 0, hp[0], hp[1], 0.47, 0.07, 0.07, 0.03, up, tilt);
    } else {
      K.rbox(mat, 0, by, -0.27 - Math.sin(-tilt) * bh / 2, 0.5, bh, 0.09, 0.04, up, tilt);
    }
    if (armed) for (const s of [-1, 1]) {
      K.box(M.satin, s * 0.285, seatTop + 0.06, -0.02, 0.028, 0.2, 0.05, C.black);
      K.rbox(mat, s * 0.285, seatTop + 0.175, 0.01, 0.07, 0.035, 0.28, 0.015, up);
    }
  }
  // CANTILEVER GUEST CHAIR: a bent chrome sled, cognac leather seat + back.
  function guestChair(K, seatTop) {
    const M = K.M, r = 0.011, ch = C.chrome;
    for (const s of [-1, 1]) {
      const x = s * 0.25;
      K.tube(M.chrome, [x, r, 0.24], [x, r, -0.26], r, ch);
      K.tube(M.chrome, [x, r, 0.24], [x, seatTop - 0.07, 0.2], r, ch);
      K.tube(M.chrome, [x, seatTop - 0.07, 0.2], [x, seatTop - 0.07, -0.22], r, ch);
      K.tube(M.chrome, [x, seatTop - 0.07, -0.22], [x, seatTop + 0.4, -0.29], r, ch);
      K.tube(M.chrome, [x, seatTop + 0.17, -0.25], [x, seatTop + 0.17, 0.14], r, ch);
      K.tube(M.chrome, [x, seatTop + 0.17, 0.14], [x, seatTop - 0.07, 0.17], r, ch);
      K.rbox(M.satin, x, seatTop + 0.185, -0.04, 0.05, 0.02, 0.3, 0.008, C.cognac);
    }
    K.rbox(M.satin, 0, seatTop - 0.035, -0.01, 0.48, 0.07, 0.46, 0.03, C.cognac);
    K.rbox(M.satin, 0, seatTop + 0.2, -0.26, 0.48, 0.34, 0.06, 0.026, C.cognac, -0.14);
  }
  // LOUNGE ARMCHAIR: wool-upholstered box chair on tapered walnut legs.
  function loungeChair(K, cushionTop) {
    const M = K.M, f = C.fabric;
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      K.cyl(M.wood, sx * 0.33, 0.08, sz * 0.31, 0.018, 0.012, 0.16, 10, C.walnutDark);
    K.rbox(M.paint, 0, 0.26, 0, 0.84, 0.2, 0.8, 0.03, f);
    K.rbox(M.paint, 0, cushionTop - 0.05, 0.04, 0.64, 0.1, 0.64, 0.04, f);
    for (const s of [-1, 1]) K.rbox(M.paint, s * 0.37, 0.45, 0.0, 0.1, 0.3, 0.8, 0.04, f);
    K.rbox(M.paint, 0, 0.62, -0.33, 0.84, 0.54, 0.14, 0.05, f, -0.12);
    K.rbox(M.paint, 0, 0.62, -0.235, 0.62, 0.34, 0.1, 0.045, 0x444a52, -0.16);
  }
  // A MONITOR on its own stand: slim bezel, lit screen from the atlas, a neck
  // and a foot. The frame's +z is the viewer's side; y is the desk top.
  function monitor(K, slot, sw, sh) {
    const M = K.M, cy = 0.16 + sh / 2;
    K.rbox(M.satin, 0, 0.007, -0.06, 0.24, 0.014, 0.17, 0.006, C.gunmetal);
    K.rbox(M.satin, 0, 0.16, -0.085, 0.05, 0.3, 0.018, 0.006, C.gunmetal, 0.08);
    K.rbox(M.satin, 0, cy, -0.048, sw + 0.02, sh + 0.025, 0.028, 0.006, C.black);
    K.rbox(M.satin, 0, cy - 0.02, -0.072, sw * 0.5, sh * 0.5, 0.03, 0.01, C.black);
    K.screen(slot, 0, cy + 0.004, -0.0335, sw, sh);
  }
  // SNAKE PLANT in a square fibreglass planter (deterministic by salt).
  function snakePlanter(K, salt, pw, ph, potHex) {
    const M = K.M;
    K.rbox(M.satin, 0, ph / 2, 0, pw, ph, pw, 0.02, potHex || C.pot);
    K.box(M.paint, 0, ph - 0.02, 0, pw - 0.05, 0.02, pw - 0.05, C.soil);
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + hsh(i, salt) * 0.8, rr = 0.03 + hsh(i, salt + 1) * (pw * 0.3);
      const hgt = 0.55 + hsh(i, salt + 2) * 0.55, wid = 0.05 + hsh(i, salt + 3) * 0.035;
      const g = bladeGeo(hgt, wid, 0.05 + hsh(i, salt + 4) * 0.12);
      const shade = hsh(i, salt + 5);
      const col = shade < 0.33 ? 0x2d5634 : shade < 0.66 ? 0x3a6a3a : 0x27482d;
      K.geo(M.leaf, g, Math.sin(a) * rr, ph - 0.02, Math.cos(a) * rr, col, (hsh(i, salt + 6) - 0.5) * 0.25, a, (hsh(i, salt + 7) - 0.5) * 0.25);
    }
  }
  // FIDDLE-LEAF FIG in a tapered round planter: trunk, limbs, big leaves.
  function figTree(K, salt, s) {
    const M = K.M;
    s = s || 1;
    K.cyl(M.satin, 0, 0.24, 0, 0.23, 0.18, 0.48, 24, C.potPale);
    K.torus(M.satin, 0, 0.48, 0, 0.225, 0.012, 0, C.potPale, Math.PI / 2);
    K.cyl(M.paint, 0, 0.455, 0, 0.215, 0.215, 0.01, 20, C.soil);
    const stems = [[0.02, 0, 1.55], [-0.05, 0.04, 1.3], [0.05, -0.05, 1.15]];
    let li = 0;
    for (let k = 0; k < stems.length; k++) {
      const st = stems[k], top = [st[0] * 4, 0.46 + st[2] * s, st[1] * 4];
      K.tube(M.paint, [st[0], 0.46, st[1]], top, 0.018 - k * 0.003, C.trunk, 6);
      const nL = 16 - k * 3;
      for (let i = 0; i < nL; i++, li++) {
        const t = 0.35 + 0.65 * (i / nL);
        const px = st[0] + (top[0] - st[0]) * t, py = 0.46 + (top[1] - 0.46) * t, pz = st[1] + (top[2] - st[1]) * t;
        const yaw = li * 2.39996 + hsh(li, salt) * 0.7;
        const len = (0.26 + hsh(li, salt + 1) * 0.1) * s;
        const g = leafGeo(len, len * 0.72, 0.03, 0.05);
        const col = hsh(li, salt + 2) < 0.5 ? 0x2f5a2c : 0x3c6c34;
        K.geo(M.leaf, g, px, py, pz, col, -0.35 - hsh(li, salt + 3) * 0.5, yaw, 0);
      }
    }
  }
  // WALNUT CREDENZA: recessed plinth, carcass, n doors with shadow gaps and
  // slim steel pulls, a top that oversails. Front = local +z.
  function credenza(K, L, H, D, n) {
    const M = K.M;
    K.box(M.satin, 0, 0.035, -0.02, L - 0.1, 0.07, D - 0.08, C.black);
    K.box(M.wood, 0, 0.07 + (H - 0.105) / 2, -0.01, L - 0.02, H - 0.105, D - 0.04, C.walnutDark);
    K.box(M.wood, 0, H - 0.0175, 0, L + 0.02, 0.035, D, C.walnut);
    const dw = (L - 0.02) / n;
    for (let i = 0; i < n; i++) {
      const lat = -(L - 0.02) / 2 + dw * (i + 0.5);
      K.box(M.wood, lat, 0.075 + (H - 0.12) / 2, D / 2 - 0.02, dw - 0.008, H - 0.125, 0.018, C.walnut);
      K.box(M.steel, lat + ((i % 2) ? -1 : 1) * (dw / 2 - 0.05), H * 0.52, D / 2 - 0.004, 0.012, 0.18, 0.016, C.steelDark);
    }
  }
  // THE EXECUTIVE DESK: walnut, 2.4 x 1.0, 45 mm top, two pedestals with real
  // drawer fronts and pulls, a modesty panel on the visitors' side, a black
  // plinth. Front (the sitter's side) = local +z; visitors at -z.
  function execDesk(K, L, D) {
    const M = K.M, TOP = 0.75, pw = 0.46;
    K.box(M.wood, 0, TOP - 0.0225, 0, L, 0.045, D, C.walnut);
    K.box(M.wood, 0, TOP - 0.052, 0, L - 0.04, 0.016, D - 0.04, C.walnutDark);
    for (const s of [-1, 1]) {
      const x = s * (L / 2 - pw / 2 - 0.02);
      K.box(M.satin, x, 0.03, 0, pw - 0.06, 0.06, D - 0.12, C.black);
      K.box(M.wood, x, 0.06 + (TOP - 0.12) / 2, -0.01, pw, TOP - 0.12, D - 0.06, C.walnutDark);
      const n = s < 0 ? 3 : 2, hh = (TOP - 0.13) / n;
      for (let i = 0; i < n; i++) {
        const y = 0.065 + hh * (i + 0.5);
        K.box(M.wood, x, y, D / 2 - 0.028, pw - 0.012, hh - 0.01, 0.02, C.walnut);
        K.box(M.steel, x, y + hh * 0.3, D / 2 - 0.012, pw * 0.5, 0.012, 0.014, C.steelDark);
      }
    }
    K.box(M.wood, 0, 0.18 + (TOP - 0.23) / 2, -D / 2 + 0.06, L - 2 * pw, TOP - 0.23, 0.022, C.walnut);
  }

  // =========================================================================
  //  THE FURNISHER
  // =========================================================================
  CBZ.cityFurnishExecOffice = function (b, baseY, lot) {
    const W = b.w, D = b.d, Y = baseY || 0;
    const wt = b.wt != null ? b.wt : 0.4;
    const ox = b.ox != null ? b.ox : (lot ? lot.cx : 0);
    const oz = b.oz != null ? b.oz : (lot ? lot.cz : 0);
    const K = makeKit(Y), M = K.M;
    const cols = b.colliders || null;

    // A SEAT THAT DOES NOT DECLARE ITS CUSHION IS A SQUATTING BODY. `cushion`
    // is the drawn cushion's TOP above this floor (read off the builders
    // below, never a table), so character.js lands the pelvis on the leather.
    const seatAt = (x, z, face, kind, cushion) => {
      if (!CBZ.propRegisterSeat) return;
      CBZ.propRegisterSeat(ox + x, Y, oz + z, face, kind, null, { cushion: cushion, floorBelow: 0 });
    };
    // A WALL YOU WALK THROUGH IS A PAINTING OF A WALL: every mass a body
    // should bump gets a height-gated collider on an invisible proxy box
    // (physics/crash consumers read c.ref.material, so ref is a real mesh).
    function solid(x, y, z, w, h, d) {
      const m = new THREE.Mesh(proxyGeo(), proxyMat());
      m.position.set(x, Y + y, z); m.scale.set(w, h, d);
      m.visible = false; m.matrixAutoUpdate = false; m.updateMatrix();
      // non-empty userData: core/batch.js never bakes this body into a drawn
      // merged shell (it did, and the desk drew as a flat tan box)
      m.userData.hitProxy = true;
      b.group.add(m);
      const c = { minX: ox + x - w / 2, maxX: ox + x + w / 2, minZ: oz + z - d / 2, maxZ: oz + z + d / 2, ref: m, y0: Y + y - h / 2, y1: Y + y + h / 2 };
      if (CBZ.colliders) CBZ.colliders.push(c);
      if (cols) cols.push(c);
      return c;
    }
    const cfp = (x, z, pad) => !b.clearFloorPoint || b.clearFloorPoint(x, z, pad == null ? 0.7 : pad);
    function anchor(x, z, pad) {
      if (cfp(x, z, pad)) return { x, z };
      const tries = [[x, z + 3.0], [x, z - 3.0], [x - 2.8, z], [x, z + 5.0], [x, z - 5.0]];
      for (const t of tries) if (cfp(t[0], t[1], pad)) return { x: t[0], z: t[1] };
      return { x, z };
    }

    // ---- the plate ---------------------------------------------------------
    const iX0 = -W / 2 + wt, iX1 = W / 2 - wt, iZ0 = -D / 2 + wt, iZ1 = D / 2 - wt;
    const xS = iX0;
    const xLo = -W / 2 + wt + 0.35;
    const xHi = W / 2 - wt - 0.35;
    const zLo = -D / 2 + wt + 0.35;
    const zHi = D / 2 - wt - 0.35;
    const CX = (xLo + xHi) / 2;
    const paneIn = 0.125;                                     // pane inner face, in from the outer skin
    const SILLD = 0.28;                                       // fan-coil cabinet depth
    const faces = [                                           // the glazed facades this suite owns
      { axis: "z", at: iZ1, s: 1, lo: xS, hi: iX1 },
      { axis: "z", at: iZ0, s: -1, lo: xS, hi: iX1 },
      { axis: "x", at: iX1, s: 1, lo: iZ0, hi: iZ1 },
      { axis: "x", at: iX0, s: -1, lo: iZ0, hi: iZ1 },
    ];

    // THE VIEW. The curtain wall on this storey goes low-iron (buildings.js
    // pools kind "view" on CBZ.cityViewGlassMat), and the fake-room glow
    // panels hung behind every bay are cleared: this floor has a real room.
    if (b.windows) for (const r of b.windows) {
      if (r && !r.external && r.y > Y + 0.2 && r.y < Y + FH - 0.2) r.kind = "view";
    }
    if (CBZ.cityInteriorGlowClearBox) {
      try { CBZ.cityInteriorGlowClearBox(ox - W / 2 - 1, ox + W / 2 + 1, Y + 0.2, Y + FH - 0.2, oz - D / 2 - 1, oz + D / 2 + 1); } catch (e) {}
    }

    // FLOOR: honed limestone, 1200 x 600 running bond, wall to wall.
    K.world();
    K.box(M.floor, (xS + iX1) / 2, 0.006, (iZ0 + iZ1) / 2, iX1 - xS, 0.012, iZ1 - iZ0, 0xffffff);

    // CEILING: smooth plaster at 2.9 m, a perimeter bulkhead dropped to the
    // window head (it is what hides the curtain wall's dark header band).
    K.box(M.ceil, (xS + iX1) / 2, CEIL + 0.01, (iZ0 + iZ1) / 2, iX1 - xS, 0.02, iZ1 - iZ0, C.ceil);
    for (const f of faces) {
      const out = f.s * (wt - paneIn), bw = 0.55 + (wt - paneIn);
      // the bulkhead spans from 0.55 m inside the wall face out to the glass
      const mid = (f.at - f.s * 0.55 + f.at + out) / 2, len = f.hi - f.lo;
      const h = CEIL - SOFFIT, cy = SOFFIT + h / 2;
      if (f.axis === "z") {
        K.box(M.ceil, (f.lo + f.hi) / 2, cy, mid, len, h, bw, C.ceil);
        K.box(M.satin, (f.lo + f.hi) / 2, SOFFIT - 0.002, f.at + f.s * 0.09, len, 0.004, 0.05, C.grille);   // blind pocket
      } else {
        K.box(M.ceil, mid, cy, (f.lo + f.hi) / 2, bw, h, len, C.ceil);
        K.box(M.satin, f.at + f.s * 0.09, SOFFIT - 0.002, (f.lo + f.hi) / 2, 0.05, 0.004, len, C.grille);
      }
      // FAN-COIL SILL CABINETS under the glass: a painted steel run with a
      // stone stool over the window pocket and a grille in its top.
      const sillLen = len, sm = f.at - f.s * SILLD / 2;
      const stoolMid = (f.at - f.s * (SILLD + 0.02) + f.at + out) / 2, stoolW = SILLD + 0.02 + (wt - paneIn);
      if (f.axis === "z") {
        K.box(M.paint, (f.lo + f.hi) / 2, (SILL - 0.03) / 2, sm, sillLen, SILL - 0.03, SILLD, C.sill);
        K.box(M.satin, (f.lo + f.hi) / 2, 0.035, sm - f.s * (SILLD / 2 - 0.004), sillLen, 0.07, 0.01, C.base);
        K.box(M.paint, (f.lo + f.hi) / 2, SILL - 0.015, stoolMid, sillLen, 0.03, stoolW, C.stool);
        for (let x = f.lo + 0.3; x + 1.1 < f.hi - 0.3; x += 1.3)
          K.box(M.satin, x + 0.55, SILL + 0.001, f.at - f.s * 0.13, 1.1, 0.003, 0.1, C.grille);
      } else {
        K.box(M.paint, sm, (SILL - 0.03) / 2, (f.lo + f.hi) / 2, SILLD, SILL - 0.03, sillLen, C.sill);
        K.box(M.satin, sm - f.s * (SILLD / 2 - 0.004), 0.035, (f.lo + f.hi) / 2, 0.01, 0.07, sillLen, C.base);
        K.box(M.paint, stoolMid, SILL - 0.015, (f.lo + f.hi) / 2, stoolW, 0.03, sillLen, C.stool);
        for (let z = f.lo + 0.3; z + 1.1 < f.hi - 0.3; z += 1.3)
          K.box(M.satin, f.at - f.s * 0.13, SILL + 0.001, z + 0.55, 0.1, 0.003, 1.1, C.grille);
      }
      if (f.axis === "z") solid((f.lo + f.hi) / 2, SILL / 2, sm, sillLen, SILL, SILLD);
      else solid(sm, SILL / 2, (f.lo + f.hi) / 2, SILLD, SILL, sillLen);
    }
    // corner columns: plaster cladding over the curtain wall's dark end piers
    const corners = [[iX1, iZ1], [iX1, iZ0], [iX0, iZ1], [iX0, iZ0]];
    for (const c of corners) {
      const sx = Math.sign(c[0]), sz = Math.sign(c[1]);
      const cx = c[0] - sx * 0.31, cz = c[1] - sz * 0.31;
      K.box(M.paint, cx, CEIL / 2, cz, 0.62, CEIL, 0.62, C.plaster);
      K.box(M.satin, cx - sx * 0.002, 0.05, cz - sz * 0.002, 0.63, 0.1, 0.63, C.base);
      solid(cx, CEIL / 2, cz, 0.62, CEIL, 0.62);
    }
    // MULLION CAPS: one slim anodised cap inside every curtain-wall pane
    // joint, read straight off this storey's pane records so they line up.
    if (b.windows) {
      const seen = {};
      for (const r of b.windows) {
        if (!r || r.external || r.y < Y + 0.2 || r.y > Y + FH - 0.2) continue;
        const lx = r.x - ox, lz = r.z - oz, faceZ = r.hd < r.hw;
        for (const e of [-1, 1]) {
          if (faceZ) {
            const ex = lx + e * r.hw; if (ex < xS + 0.05 || ex > iX1 - 0.65 || ex < iX0 + 0.65) continue;
            const key = "z" + Math.round(ex * 20) + ":" + Math.sign(lz); if (seen[key]) continue; seen[key] = 1;
            K.box(M.satin, ex, (SILL + SOFFIT) / 2, lz - Math.sign(lz) * (r.hd + 0.03), 0.05, SOFFIT - SILL, 0.06, C.mull);
          } else {
            const ez = lz + e * r.hd; if (ez < iZ0 + 0.65 || ez > iZ1 - 0.65) continue;
            const key = "x" + Math.round(ez * 20) + ":" + Math.sign(lx); if (seen[key]) continue; seen[key] = 1;
            K.box(M.satin, lx - Math.sign(lx) * (r.hw + 0.03), (SILL + SOFFIT) / 2, ez, 0.06, SOFFIT - SILL, 0.05, C.mull);
          }
        }
      }
    }

    // ---- ceiling fixtures (unlit emissive faces: no real lights) -----------
    const lightSpots = [];
    function downlight(x, z) {
      K.world();
      K.cyl(M.paint, x, CEIL - 0.004, z, 0.085, 0.085, 0.008, 20, C.white);
      K.cyl(M.emit, x, CEIL - 0.0095, z, 0.062, 0.062, 0.003, 20, C.lampWarm);
      lightSpots.push([x, z]);
    }
    function linearSlot(x, z, len, alongX) {
      K.world();
      if (alongX) { K.box(M.paint, x, CEIL - 0.003, z, len + 0.04, 0.006, 0.1, C.white); K.box(M.emit, x, CEIL - 0.0075, z, len, 0.003, 0.06, C.lampCool); }
      else { K.box(M.paint, x, CEIL - 0.003, z, 0.1, 0.006, len + 0.04, C.white); K.box(M.emit, x, CEIL - 0.0075, z, 0.06, 0.003, len, C.lampCool); }
      lightSpots.push([x, z]);
    }

    // ---- partition helpers ---------------------------------------------------
    const PWT = 0.14;
    // a plastered stud wall along X at fixed z, with an optional doorway that
    // carries a real walnut door standing open into the room (+s side)
    function wallX(z, x0, x1, gapX, gapW, doorSide) {
      gapW = gapW || 1.0;
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      const gg = gapX != null && gapX > lo && gapX < hi;
      const segs = gg ? [[lo, gapX - gapW / 2], [gapX + gapW / 2, hi]] : [[lo, hi]];
      K.world();
      for (const s of segs) {
        const L = s[1] - s[0]; if (L < 0.1) continue;
        const cx = (s[0] + s[1]) / 2;
        K.box(M.paint, cx, CEIL / 2, z, L, CEIL, PWT, C.plaster);
        for (const sd of [-1, 1]) K.box(M.satin, cx, 0.05, z + sd * (PWT / 2 + 0.006), L, 0.1, 0.012, C.base);
        solid(cx, CEIL / 2, z, L, CEIL, PWT);
      }
      if (gg) {
        const DH = 2.2;
        K.box(M.paint, gapX, (DH + CEIL) / 2, z, gapW, CEIL - DH, PWT, C.plaster);
        // steel frame: two jambs + head, a hair proud of both faces
        for (const e of [-1, 1]) K.box(M.satin, gapX + e * (gapW / 2 - 0.02), DH / 2, z, 0.04, DH, PWT + 0.02, C.gunmetal);
        K.box(M.satin, gapX, DH - 0.02, z, gapW, 0.04, PWT + 0.02, C.gunmetal);
        // the leaf, swung 95 degrees open into the room, hinged on the low jamb
        const hx = gapX - gapW / 2 + 0.04, sd = doorSide || 1, lw = gapW - 0.08;
        // closed, the leaf runs +x from the hinge; open 95 degrees it points
        // into the room (sd), a hair past square
        K.at(hx, z + sd * (PWT / 2 + 0.025), sd > 0 ? -0.09 : Math.PI + 0.09);
        K.box(M.wood, 0, (DH - 0.02) / 2, lw / 2, 0.045, DH - 0.03, lw, C.walnut);
        for (const e of [-1, 1]) K.box(M.steel, e * 0.045, 1.02, lw - 0.08, 0.02, 0.3, 0.02, C.steelDark);
        K.world();
      }
    }
    // a floor-to-ceiling FRAMELESS GLASS front along Z at fixed x. Each pane is
    // CITY GLASS (cityRegisterGlass: bullets and blasts shatter it and burst
    // frees its collider) on the low-iron view material, with a frosted
    // safety band at 1.0 m (every real glass office front has one) riding as
    // the pane's child so it goes when the pane does. A glass door pair stands
    // open at the doorway; a glass transom closes the head over it.
    function glassZ(x, z0, z1, gapZ, gapW, openSide) {
      gapW = gapW || 1.8;
      const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
      const gg = gapZ != null && gapZ > lo && gapZ < hi;
      const segs = gg ? [[lo, gapZ - gapW / 2], [gapZ + gapW / 2, hi]] : [[lo, hi]];
      const gm = CBZ.cityViewGlassMat ? CBZ.cityViewGlassMat() : M.glass;
      function pane(py0, py1, pz, pd) {
        const ph = py1 - py0, py = Y + py0 + ph / 2;
        let mesh = null;
        if (CBZ.cityRegisterGlass) {
          const rec = CBZ.cityRegisterGlass(b.group, x, py, pz, 0.02, ph, pd, ox, oz, { solid: true });
          mesh = rec && rec.mesh;
        } else {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, ph, pd), gm);
          mesh.position.set(x, py, pz); b.group.add(mesh);
        }
        if (!mesh) return;
        mesh.material = gm;
        mesh.castShadow = false; mesh.receiveShadow = false;
        if (py0 < 1.0 && py1 > 1.2) {
          const band = new THREE.Mesh(proxyGeo(), bandMat());
          band.scale.set(0.024, 0.09, Math.max(0.05, pd - 0.02));
          band.position.set(0, (Y + 1.05) - py, 0);
          band.renderOrder = 3;
          mesh.add(band);
        }
      }
      K.world();
      for (const s of segs) {
        const len = s[1] - s[0]; if (len < 0.25) continue;
        // panes on a ~1.5 m module so one shot takes out one light, not a wall
        const n = Math.max(1, Math.round(len / 1.5)), pl = len / n;
        for (let i = 0; i < n; i++) pane(0.045, CEIL - 0.045, s[0] + pl * (i + 0.5), pl - 0.008);
        // floor + head channels, black anodised
        K.box(M.satin, x, 0.0225, (s[0] + s[1]) / 2, 0.05, 0.045, len, C.mull);
        K.box(M.satin, x, CEIL - 0.0225, (s[0] + s[1]) / 2, 0.05, 0.045, len, C.mull);
      }
      const posts = gg ? [lo, gapZ - gapW / 2, gapZ + gapW / 2, hi] : [lo, hi];
      for (const pz of posts) { K.box(M.satin, x, CEIL / 2, pz, 0.05, CEIL, 0.05, C.mull); solid(x, CEIL / 2, pz, 0.05, CEIL, 0.05); }
      if (gg) {
        const DH = 2.3;
        pane(DH + 0.04, CEIL - 0.045, gapZ, gapW - 0.06);
        K.box(M.satin, x, DH + 0.02, gapZ, 0.05, 0.04, gapW, C.mull);
        // two glass leaves pushed open flat against the fixed glass, inside
        const lw = gapW / 2 - 0.03, sd = openSide || 1;
        for (const e of [-1, 1]) {
          const hz = gapZ + e * (gapW / 2 - 0.025);
          const lx = x + sd * 0.07, lz = hz + e * lw / 2;
          K.box(M.glass, lx, DH / 2, lz, 0.012, DH - 0.03, lw, 0xffffff);
          K.box(M.satin, lx, 0.03, lz, 0.03, 0.05, lw, C.mull);
          K.cyl(M.chrome, lx + sd * 0.04, 1.05, hz + e * (lw - 0.06), 0.013, 0.013, 1.1, 10, C.chrome);
          K.box(M.chrome, lx + sd * 0.022, 0.75, hz + e * (lw - 0.06), 0.03, 0.02, 0.02, C.chrome);
          K.box(M.chrome, lx + sd * 0.022, 1.35, hz + e * (lw - 0.06), 0.03, 0.02, 0.02, C.chrome);
        }
      }
    }
    // closure fin where a partition meets the curtain wall over the sill
    function endFin(x, zFace, s) {
      const z0 = zFace - s * SILLD, z1 = zFace + s * (wt - paneIn);
      K.world();
      K.box(M.satin, x, (SILL + SOFFIT) / 2, (z0 + z1) / 2, 0.06, SOFFIT - SILL, Math.abs(z1 - z0), C.mull);
    }

    // ========================================================================
    //  THE EXPRESS-LIFT CORE — walnut-clad on three faces, brushed steel doors
    //  on the -z face with a floor indicator above and a call panel beside.
    //  A REAL LIFT, NOT A PICTURE OF ONE (owner: "fix the elevator button
    //  opening the elevator"). The core used to be one solid box with a door
    //  pair painted on its face and an [E] card that faded you to the street:
    //  nothing ever opened. It is a hollow car now: three walls and a front
    //  with a doorway, a lit cab inside, two steel leafs that slide into the
    //  cheeks over one y-gated collider, and a call button that lights. It is
    //  a STOP of the tower's own lift (city/elevators.js reads
    //  b.execOffice.liftLanding): Call opens it, the car's floor panel takes
    //  you to the lobby, the penthouse or the roof, and the lobby cab's panel
    //  brings you back up here.
    // ========================================================================
    const core = anchor(CX - W * 0.085, (zLo + zHi) / 2 + 0.8, 1.6);
    const CORE = 2.5, CH = CORE / 2, CW = 0.12;               // CW: the core's wall
    const DW = 1.1, DH = 2.2;
    const fz = core.z - CH;                                    // the door face
    const cheek = CH - DW / 2;                                 // wall either side of the doorway
    solid(core.x, FH / 2, core.z + CH - CW / 2, CORE, FH, CW);          // back
    solid(core.x - CH + CW / 2, FH / 2, core.z, CW, FH, CORE);          // sides
    solid(core.x + CH - CW / 2, FH / 2, core.z, CW, FH, CORE);
    for (const e of [-1, 1]) solid(core.x + e * (DW / 2 + cheek / 2), FH / 2, fz + CW / 2, cheek, FH, CW);
    solid(core.x, (DH + FH) / 2, fz + CW / 2, DW, FH - DH, CW);           // over the doorway
    K.world();
    // the core's mass above the cab ceiling, and its walls' dark cores
    K.box(M.satin, core.x, (DH + 0.32 + CEIL) / 2, core.z, CORE - 0.04, CEIL - DH - 0.32, CORE - 0.04, 0x1a1715);
    // walnut panels with shadow reveals on +z, -x, +x
    const PN = 4, pw = (CORE - (PN - 1) * 0.012) / PN;
    for (let i = 0; i < PN; i++) {
      const t = -CH + pw / 2 + i * (pw + 0.012);
      K.box(M.wood, core.x + t, 0.1 + (CEIL - 0.1) / 2, core.z + CH - 0.005, pw, CEIL - 0.1, 0.03, C.walnut);
      K.box(M.wood, core.x - CH + 0.005, 0.1 + (CEIL - 0.1) / 2, core.z + t, 0.03, CEIL - 0.1, pw, C.walnut);
      K.box(M.wood, core.x + CH - 0.005, 0.1 + (CEIL - 0.1) / 2, core.z + t, 0.03, CEIL - 0.1, pw, C.walnut);
    }
    K.box(M.satin, core.x, 0.05, core.z + CH + 0.005, CORE, 0.1, 0.02, C.base);
    K.box(M.satin, core.x - CH - 0.005, 0.05, core.z, 0.02, 0.1, CORE, C.base);
    K.box(M.satin, core.x + CH + 0.005, 0.05, core.z, 0.02, 0.1, CORE, C.base);
    // THE CAB: brushed steel on the inside of every wall (the leaf pockets
    // behind the cheeks included), a dark floor, a handrail, a lit ceiling
    const IN = CORE - 2 * CW;                                  // cab interior span
    const icz = (fz + CW + core.z + CH - CW) / 2, icd = (core.z + CH - CW) - (fz + CW);
    K.box(M.steel, core.x, 0.1 + DH / 2, core.z + CH - CW - 0.006, IN, DH + 0.2, 0.012, C.steel);
    K.box(M.steel, core.x - CH + CW + 0.006, 0.1 + DH / 2, icz, 0.012, DH + 0.2, icd, C.steel);
    K.box(M.steel, core.x + CH - CW - 0.006, 0.1 + DH / 2, icz, 0.012, DH + 0.2, icd, C.steel);
    for (const e of [-1, 1]) K.box(M.steel, core.x + e * (DW / 2 + cheek / 2), 0.1 + DH / 2, fz + CW + 0.006, cheek, DH + 0.2, 0.012, C.steelDark);
    K.box(M.satin, core.x, DH + 0.1, fz + CW / 2, DW, 0.2, CW - 0.03, C.steelDark);        // the head's soffit
    K.box(M.satin, core.x, 0.016, icz, IN, 0.008, icd, 0x2a2622);
    K.box(M.satin, core.x, DH + 0.3, icz, IN, 0.04, icd, 0x1a1715);
    K.box(M.emit, core.x, DH + 0.277, icz, 0.9, 0.006, 0.9, C.lampWarm);
    K.box(M.chrome, core.x, 0.92, core.z + CH - CW - 0.06, IN - 0.3, 0.035, 0.035, C.chrome);
    // the car's floor panel, inside by the door (the floor buttons sit here)
    const ipx = core.x + DW / 2 + cheek / 2;
    K.rbox(M.steel, ipx, 1.2, fz + CW + 0.016, 0.12, 0.34, 0.012, 0.004, 0xe2e4e6);
    // the lift face: stainless cladding round the doorway, a proud frame,
    // the floor indicator, the call panel, a steel threshold
    for (const e of [-1, 1]) K.box(M.steel, core.x + e * (DW / 2 + cheek / 2), CEIL / 2, fz - 0.005, cheek, CEIL, 0.03, C.steelDark);
    K.box(M.steel, core.x, (DH + CEIL) / 2, fz - 0.005, DW, CEIL - DH, 0.03, C.steelDark);
    for (const e of [-1, 1]) K.box(M.steel, core.x + e * (DW / 2 + 0.04), DH / 2 + 0.02, fz - 0.035, 0.08, DH + 0.04, 0.03, 0xe2e4e6);
    K.box(M.steel, core.x, DH + 0.06, fz - 0.035, DW + 0.16, 0.08, 0.03, 0xe2e4e6);
    K.box(M.steel, core.x, 0.002, fz - 0.07, DW + 0.1, 0.004, 0.14, 0xe2e4e6);
    K.box(M.steel, core.x, 0.004, fz + CW / 2, DW, 0.008, CW, 0xe2e4e6);                    // the sill track
    K.box(M.satin, core.x, DH + 0.26, fz - 0.025, 0.36, 0.13, 0.012, C.black);
    K.at(core.x, fz - 0.032, Math.PI);
    K.screen(5, 0, DH + 0.26, 0, 0.176, 0.11);
    K.world();
    const cpx = core.x + DW / 2 + 0.32;
    K.rbox(M.steel, cpx, 1.12, fz - 0.028, 0.1, 0.26, 0.012, 0.004, 0xe2e4e6);
    K.cyl(M.chrome, cpx, 1.17, fz - 0.036, 0.019, 0.019, 0.01, 16, C.chrome, Math.PI / 2);
    K.cyl(M.chrome, cpx, 1.07, fz - 0.036, 0.019, 0.019, 0.01, 16, C.chrome, Math.PI / 2);
    // THE MOVING PARTS are real meshes (the kit merges everything else):
    // the two leafs, and the call button's lamp, which the lift lights.
    const leafMat = new THREE.MeshPhongMaterial({ color: 0xcfd3d8, shininess: 70, specular: 0x6a6a6a });
    const doorLeafGeo = new THREE.BoxGeometry(DW / 2 - 0.004, DH, 0.03);
    const liftRig = { leaves: [], open: 0, target: 0, autoClose: null, autoCloseAudible: false, trav: DW / 2 - 0.03 };
    for (const e of [-1, 1]) {
      const m = new THREE.Mesh(doorLeafGeo, leafMat);
      m.position.set(core.x + e * (DW / 4 + 0.002), Y + DH / 2, fz + 0.035);
      m.castShadow = true; m.receiveShadow = true;
      m.name = "exec-lift-leaf";
      m.userData.mover = true;          // batch.js must not bake it, staticfreeze.js must not freeze it: it slides
      b.group.add(m);
      liftRig.leaves.push({ m: m, baseX: m.position.x, baseZ: m.position.z, sx: e, sz: 0 });
    }
    {
      const c = solid(core.x, DH / 2, fz + CW / 2, DW, DH, CW);          // the closed leafs
      liftRig.col = c; liftRig.cy0 = c.y0; liftRig.cy1 = c.y1; liftRig.solid = true;
    }
    const btnIdle = new THREE.MeshBasicMaterial({ color: 0x8a5a16 });
    const btnLit = new THREE.MeshBasicMaterial({ color: 0xffc56a });
    const liftBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.006, 16), btnIdle);
    liftBtn.rotation.x = Math.PI / 2;
    liftBtn.position.set(cpx, Y + 1.07, fz - 0.043);
    liftBtn.name = "exec-lift-button";
    liftBtn.userData.mover = true;      // its material swaps; keep it out of the static batch
    b.group.add(liftBtn);
    const backZ = core.z + CH - CW;                           // the cab's back wall (dep 0)
    const liftLanding = {
      name: "Floor " + Math.round(Y / FH),
      base: Y, floor: Y + 0.02,
      rig: liftRig, btn: liftBtn, lamp: null, btnIdle: btnIdle, btnLit: btnLit,
      pad: { x: ox + core.x, z: oz + fz - 0.9 },
      btnAt: { x: ox + cpx, y: Y + 1.07, z: oz + fz - 0.05 },
      panelAt: { x: ox + ipx, y: Y + 1.25, z: oz + fz + CW + 0.03 },
      // cab-local frame: lat across the door, dep from the back wall to the leaf line
      loc: function (x, z) { return { lat: x - (ox + core.x), dep: (oz + backZ) - z }; },
      pt: function (lat, dep) { return { x: ox + core.x + lat, z: oz + backZ - dep }; },
      door: backZ - (fz + CW / 2), half: CH - CW - 0.15, fwd: { x: 0, z: -1 },
    };

    // ========================================================================
    //  RECEPTION — one desk facing the lift, one bench, two planters. Space.
    // ========================================================================
    const rec = { x: core.x, z: core.z - 5.6 };
    K.at(rec.x, rec.z, 0);
    // counter: walnut front in three coursed boards, stone transaction ledge,
    // a lower stone work surface behind it at desk height, black plinth
    K.box(M.satin, 0, 0.04, 0.05, 2.5, 0.08, 0.7, C.black);
    K.box(M.satin, 0, 0.565, 0.25, 2.56, 1.03, 0.2, 0x1b1816);               // the upstand behind the boards
    for (let i = 0; i < 3; i++) K.box(M.wood, 0, 0.1 + 0.32 * i + 0.155, 0.37, 2.6, 0.31, 0.04, C.walnut);
    for (const e of [-1, 1]) K.box(M.wood, e * 1.29, 0.56, 0.02, 0.04, 1.08, 0.74, C.walnut);
    K.box(M.paint, 0, 1.095, 0.26, 2.66, 0.03, 0.3, C.stoneTop);
    K.box(M.paint, 0, 0.745, -0.1, 2.5, 0.03, 0.62, C.stoneTop);
    // a drawer pedestal under her worktop (the knee space stays open)
    K.box(M.wood, -0.86, 0.39, -0.12, 0.44, 0.7, 0.52, C.walnutDark);
    for (let i = 0; i < 3; i++) {
      K.box(M.wood, -0.86, 0.1 + 0.215 * i + 0.1, -0.385, 0.42, 0.205, 0.018, C.walnut);
      K.box(M.steel, -0.86, 0.1 + 0.215 * i + 0.17, -0.397, 0.2, 0.012, 0.012, C.steelDark);
    }
    solid(rec.x, 0.56, rec.z + 0.05, 2.7, 1.12, 0.9);
    // her terminal (faces her, at -z), a desk phone, one white orchid
    K.at(rec.x - 0.55, rec.z - 0.02, Math.PI, 0.76);
    monitor(K, 3, 0.54, 0.31);
    K.at(rec.x + 0.55, rec.z - 0.12, Math.PI + 0.3, 0.76);
    K.rbox(M.satin, 0, 0.03, 0, 0.2, 0.05, 0.2, 0.012, C.black, 0.18);
    K.rbox(M.satin, 0.06, 0.07, 0.0, 0.05, 0.035, 0.2, 0.015, C.black);
    K.at(rec.x + 0.95, rec.z + 0.26, 0, 1.11);
    K.cyl(M.satin, 0, 0.055, 0, 0.065, 0.05, 0.11, 18, C.ceramic);
    for (let i = 0; i < 4; i++) K.geo(M.leaf, leafGeo(0.16, 0.07, 0.01, 0.03), 0, 0.105, 0, 0x2f5a2c, 0.2, i * 1.57 + 0.4, 0);
    K.tube(M.paint, [0, 0.1, 0], [0.03, 0.42, 0.02], 0.004, 0x3b5a2a, 5);
    K.tube(M.paint, [0.03, 0.42, 0.02], [0.14, 0.46, 0.05], 0.004, 0x3b5a2a, 5);
    for (let i = 0; i < 5; i++) K.sphere(M.paint, 0.05 + i * 0.022, 0.43 + Math.sin(i * 1.3) * 0.02, 0.03 + i * 0.006, 0.026, C.white, 1, 0.45, 1);
    // THE RECEPTIONIST SITS BEHIND HER OWN DESK, facing the lift (+z).
    K.at(rec.x, rec.z - 1.0, 0);
    swivelChair(K, 0.49, { cover: C.mesh, back: 0.55, fabric: true });
    seatAt(rec.x, rec.z - 1.0, 0, "chair", 0.49);
    // one visitor bench off to the -x side, facing the desk
    if (cfp(rec.x - 3.8, rec.z + 0.4, 0.8)) {
      K.at(rec.x - 3.8, rec.z + 0.4, Math.PI / 2);
      for (const e of [-1, 1]) {
        const lx = e * 0.95;
        for (const f of [-1, 1]) K.box(M.chrome, lx, 0.19, f * 0.2, 0.03, 0.38, 0.03, C.chrome);
        K.box(M.chrome, lx, 0.015, 0, 0.03, 0.03, 0.43, C.chrome);
        K.box(M.chrome, lx, 0.365, 0, 0.03, 0.03, 0.43, C.chrome);
      }
      K.box(M.wood, 0, 0.395, 0, 2.1, 0.03, 0.48, C.walnut);
      K.rbox(M.satin, 0, 0.44 - 0.035, 0, 2.02, 0.07, 0.46, 0.03, C.leather);
      seatAt(rec.x - 3.8, rec.z + 0.4, Math.PI / 2, "bench", 0.44);
    }
    // two planters flanking the arrival walk
    for (const s of [-1, 1]) {
      const px = core.x + s * 2.6, pz = core.z - 2.6;
      if (!cfp(px, pz, 0.7)) continue;
      K.at(px, pz, s * 0.4);
      snakePlanter(K, 11 + s * 7, 0.5, 0.62);
      solid(px, 0.31, pz, 0.5, 0.62, 0.5);
    }
    for (const dz of [-1.4, 1.6]) downlight(rec.x + (dz > 0 ? 2.2 : -2.2), rec.z + dz);
    linearSlot(rec.x, rec.z - 0.1, 2.4, true);

    // ========================================================================
    //  THE CORNER OFFICE — the whole +x end. ONE desk. SPACE.
    // ========================================================================
    const offX0 = xHi - Math.max(6.8, Math.min(9.2, W * 0.38));      // partition line
    const offDoorZ = core.z;                                         // door lines up with the core walk
    glassZ(offX0, iZ0 + SILLD, iZ1 - SILLD, offDoorZ, 1.8, 1);
    endFin(offX0, iZ0, -1); endFin(offX0, iZ1, 1);
    const offCz = 0;
    // THE DESK — long axis along z, his back to the +x glass
    const dsk = { x: xHi - 3.5, z: offCz };
    const chr = { x: dsk.x + 0.95, z: dsk.z };
    // one wool rug under the desk + guest chairs
    K.world();
    K.box(M.rug, dsk.x - 0.55, 0.018, dsk.z, 4.2, 0.012, 3.2, 0xffffff);
    K.at(dsk.x, dsk.z, Math.PI / 2);
    execDesk(K, 2.4, 1.0);
    solid(dsk.x, 0.39, dsk.z, 1.0, 0.78, 2.4);
    // THE TERMINAL (the read the owner likes): three monitors on the far half
    // of the desk, the wings angled in to the chair. Candles, the sector map
    // and the watchlist: it is the morning the market dies.
    const mons = [[-0.66, 1], [0, 0], [0.66, 2]];
    for (const m of mons) {
      const mx = dsk.x - 0.26 + Math.abs(m[0]) * 0.08, mz = dsk.z + m[0];
      const yaw = Math.atan2(chr.x - mx, chr.z - mz);
      K.at(mx, mz, yaw, 0.75);
      monitor(K, m[1], 0.6, 0.34);
    }
    // CCTV: only the right wing carries the building's camera feed; the other
    // two stay the market. World coords + outward normal toward the chair.
    if (CBZ.cctvAddScreen) {
      const mx = dsk.x - 0.26 + 0.66 * 0.08, mz = dsk.z + 0.66, yaw = Math.atan2(chr.x - mx, chr.z - mz);
      CBZ.cctvAddScreen(ox + mx - Math.sin(yaw) * 0.0335, Y + 0.75 + 0.16 + 0.17, oz + mz - Math.cos(yaw) * 0.0335, Math.sin(yaw), Math.cos(yaw));
    }
    // the working surface: a leather pad, keyboard, mouse, a coffee, the phone,
    // the signature pages with a pen on them, the lamp
    K.at(dsk.x, dsk.z, Math.PI / 2, 0.75);
    K.box(M.satin, 0, 0.002, 0.2, 0.84, 0.004, 0.44, 0x231a15);
    K.rbox(M.chrome, 0.0, 0.009, 0.14, 0.44, 0.012, 0.13, 0.004, 0xb9bcc1, 0.05);
    K.box(M.satin, 0.0, 0.0165, 0.145, 0.41, 0.004, 0.1, 0x1a1b1d, 0.05);
    K.rbox(M.satin, 0.34, 0.013, 0.16, 0.06, 0.026, 0.1, 0.012, C.black);
    K.cyl(M.satin, 0.55, 0.045, 0.3, 0.04, 0.034, 0.09, 18, C.ceramic);
    K.cyl(M.paint, 0.55, 0.086, 0.3, 0.036, 0.036, 0.004, 16, C.coffee);
    K.torus(M.satin, 0.595, 0.05, 0.3, 0.022, 0.006, Math.PI, C.ceramic, 0, 0, -Math.PI / 2);
    K.rbox(M.satin, -0.95, 0.03, 0.08, 0.2, 0.05, 0.2, 0.012, C.black, 0.2, 0.25);
    K.rbox(M.satin, -0.99, 0.065, 0.06, 0.05, 0.035, 0.21, 0.015, C.black, 0, 0.25);
    K.box(M.paint, 0.86, 0.006, 0.12, 0.21, 0.012, 0.297, C.paper, 0, 0.06);
    K.box(M.paint, 0.98, 0.0065, 0.2, 0.21, 0.004, 0.297, C.paper, 0, -0.28);
    K.cyl(M.chrome, 0.88, 0.017, 0.1, 0.005, 0.005, 0.14, 8, C.brass, 0, 0.9, Math.PI / 2);
    // HIS LAPTOP, open on the left of the pad and turned to the chair. A real
    // object: machined aluminium base, the keyboard well and trackpad, a lid
    // on its hinge tilted back 17 degrees, a black bezel and a screen. The
    // Executive's opening is read off THIS screen (origins.js lays a live
    // canvas over the quad using b.execOffice.laptop), never an HTML card.
    const lapL = { x: -0.56, z: 0.1 };                         // desk-frame (yaw PI/2): world = (z, -x)
    const lapX = dsk.x + lapL.z, lapZ = dsk.z - lapL.x;
    const lapYaw = Math.atan2(chr.x - lapX, chr.z - lapZ);
    const TILT = -0.3, LW = 0.32, LH = 0.21, HZ = -0.11, HY = 0.018;
    const lidY = HY + (LH / 2) * Math.cos(TILT), lidZ = HZ + (LH / 2) * Math.sin(TILT);
    const nY = -Math.sin(TILT), nZ = Math.cos(TILT);           // the lid's front normal
    K.at(lapX, lapZ, lapYaw, 0.75);
    K.rbox(M.satin, 0, 0.009, 0, LW, 0.018, 0.22, 0.006, 0xa9aeb4);          // base
    K.box(M.satin, 0, 0.0183, -0.03, 0.28, 0.0012, 0.105, 0x17181a);         // keyboard well
    for (let r = 0; r < 5; r++) for (let k = 0; k < 13; k++)                 // keycaps
      K.box(M.satin, -0.126 + k * 0.021, 0.0192, -0.074 + r * 0.021, 0.017, 0.0012, 0.017, 0x232427);
    K.box(M.satin, 0, 0.0186, 0.068, 0.11, 0.0008, 0.066, 0x9aa0a6);         // trackpad
    K.rbox(M.satin, 0, lidY, lidZ, LW, LH, 0.007, 0.004, 0xa9aeb4, TILT);    // lid
    K.box(M.satin, 0, lidY + nY * 0.0037, lidZ + nZ * 0.0037, LW - 0.008, LH - 0.008, 0.0008, 0x0a0b0c, TILT);   // bezel
    K.screen(3, 0, lidY + nY * 0.0043 + 0.004, lidZ + nZ * 0.0043, 0.288, 0.18, TILT);
    const lapScreen = {
      // world centre of the screen quad, 1.5 mm proud of the atlas screen
      x: ox + lapX + Math.sin(lapYaw) * (lidZ + nZ * 0.006),
      y: Y + 0.75 + lidY + nY * 0.006 + 0.004,
      z: oz + lapZ + Math.cos(lapYaw) * (lidZ + nZ * 0.006),
      yaw: lapYaw, tilt: TILT, w: 0.288, h: 0.18,
    };
    // task lamp: weighted disc, stem, a raked arm and a head lit underneath
    K.at(dsk.x - 0.3, dsk.z + 1.1, Math.PI / 2 + 0.5, 0.75);
    K.cyl(M.satin, 0, 0.01, 0, 0.085, 0.09, 0.02, 24, C.black);
    K.cyl(M.satin, 0, 0.23, 0, 0.008, 0.008, 0.42, 8, C.black);
    K.tube(M.satin, [0, 0.44, 0], [0, 0.5, 0.3], 0.007, C.black, 8);
    K.cyl(M.satin, 0, 0.48, 0.33, 0.055, 0.06, 0.04, 20, C.black, 0.25);
    K.cyl(M.emit, 0, 0.458, 0.335, 0.046, 0.046, 0.004, 20, C.lampWarm, 0.25);
    // HIS chair: high-back channel-stitched leather on a polished five-star base
    K.at(chr.x, chr.z, -Math.PI / 2);
    swivelChair(K, 0.51, { back: 0.82, channels: true });
    seatAt(chr.x, chr.z, -Math.PI / 2, "chair", 0.51);
    // TWO guest chairs across the desk — and that is all the seating there is
    for (const s of [-1, 1]) {
      const gz = dsk.z + s * 0.72, gx = dsk.x - 1.3;
      K.at(gx, gz, Math.PI / 2 + s * 0.18);                          // angled in toward the desk centre
      guestChair(K, 0.47);
      seatAt(gx, gz, Math.PI / 2 + s * 0.18, "chair", 0.47);
    }
    // the credenza under the window behind him, with the few things he keeps
    const crx = iX1 - SILLD - 0.25;
    {
      K.at(crx, offCz, -Math.PI / 2);
      credenza(K, 2.2, 0.62, 0.48, 4);
      K.box(M.paint, -0.6, 0.62 + 0.0175, 0.02, 0.26, 0.035, 0.19, C.bookA, 0, 0.12);
      K.box(M.paint, -0.6, 0.62 + 0.051, 0.02, 0.24, 0.032, 0.17, C.bookB, 0, -0.05);
      K.box(M.paint, -0.6, 0.62 + 0.079, 0.02, 0.22, 0.024, 0.16, C.bookC, 0, 0.2);
      K.box(M.satin, 0.55, 0.62 + 0.05, 0.0, 0.1, 0.1, 0.1, C.black);
      K.sphere(M.chrome, 0.55, 0.62 + 0.17, 0.0, 0.07, C.brass);
      K.box(M.satin, 0.15, 0.62 + 0.12, -0.05, 0.2, 0.25, 0.015, C.black, -0.18);
      solid(crx, 0.31, offCz, 0.48, 0.62, 2.2);
    }
    // one fig in the glass corner, the only other living thing in the room
    const fgx = iX1 - 0.95, fgz = iZ1 - 0.95;
    if (cfp(fgx, fgz, 0.4)) {
      K.at(fgx, fgz, 0.7);
      figTree(K, 37, 1.0);
      solid(fgx, 0.24, fgz, 0.46, 0.48, 0.46);
    }
    // office ceiling: a ring of downlights, a slot over the desk
    for (const dz of [-3.2, 3.2]) for (const dx of [offX0 + 1.7, xHi - 1.2]) if (dz > zLo && dz < zHi) downlight(dx, dz);
    linearSlot(dsk.x - 0.1, dsk.z, 2.2, false);
    downlight(dsk.x - 1.8, dsk.z);

    // ========================================================================
    //  THE MEETING ROOM — the -x/-z corner. ONE long table. Eight chairs.
    // ========================================================================
    const mr = { x0: xLo + 0.15, x1: Math.min(xLo + 8.6, offX0 - 2.6), z0: zLo + 0.15, z1: zLo + 5.9 };
    const mrOk = (mr.x1 - mr.x0) >= 6.0 && (mr.z1 - mr.z0) >= 4.6;
    let mrC = null;
    if (mrOk) {
      const mcx = (mr.x0 + mr.x1) / 2, mcz = (mr.z0 + mr.z1) / 2 - 0.15;
      mrC = { x: mcx, z: mcz };
      wallX(mr.z1, mr.x0, mr.x1, mr.x1 - 1.0, 1.0, -1);           // solid back wall, door near +x end
      glassZ(mr.x1, iZ0 + SILLD, mr.z1 - PWT / 2, null, 0, -1);  // glass side facing the gallery
      endFin(mr.x1, iZ0, -1);
      K.world();
      K.box(M.rug, mcx, 0.018, mcz, Math.min(6.2, mr.x1 - mr.x0 - 0.6), 0.012, 3.4, 0xffffff);
      // ONE long table: a boat-shaped walnut top on two steel plate pedestals
      const TL = Math.min(4.6, (mr.x1 - mr.x0) - 2.8);
      K.at(mcx, mcz, 0);
      K.rbox(M.wood, 0, 0.7375, 0, TL, 0.045, 1.25, 0.02, C.walnut, 0, 0, 0, 3);
      K.box(M.wood, 0, 0.7, 0, TL - 0.3, 0.03, 0.9, C.walnutDark);
      for (const e of [-1, 1]) {
        K.box(M.satin, e * (TL / 2 - 0.9), 0.35, 0, 0.1, 0.68, 0.55, C.gunmetal);
        K.box(M.satin, e * (TL / 2 - 0.9), 0.01, 0, 0.5, 0.02, 0.8, C.gunmetal);
      }
      solid(mcx, 0.38, mcz, TL, 0.76, 1.25);
      // eight chairs: three a side + one at each end, all facing the table
      for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) {
        const cx2 = mcx + i * (TL / 2 - 0.7), cz2 = mcz + s * 0.98;
        const face = s > 0 ? Math.PI : 0;
        K.at(cx2, cz2, face + i * 0.05 * s);
        swivelChair(K, 0.49, { back: 0.56 });
        seatAt(cx2, cz2, face, "chair", 0.49);
      }
      for (const e of [-1, 1]) {
        const cx2 = mcx + e * (TL / 2 + 0.62), face = e > 0 ? -Math.PI / 2 : Math.PI / 2;
        K.at(cx2, mcz, face);
        swivelChair(K, 0.49, { back: 0.56 });
        seatAt(cx2, mcz, face, "chair", 0.49);
      }
      // the table is SET: a pad and a pen in front of every seat, one carafe
      K.at(mcx, mcz, 0, 0.76);
      for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) {
        K.box(M.paint, i * (TL / 2 - 0.7), 0.004, s * 0.38, 0.21, 0.008, 0.28, C.paper, 0, (i + s) * 0.03);
        K.cyl(M.chrome, i * (TL / 2 - 0.7) + 0.14, 0.006, s * 0.38, 0.004, 0.004, 0.14, 8, C.black, Math.PI / 2);
      }
      K.cyl(M.glass, 0, 0.12, 0, 0.055, 0.045, 0.24, 18, 0xffffff);
      K.cyl(M.chrome, 0, 0.005, 0, 0.12, 0.12, 0.01, 24, C.chrome);
      // one wall screen on the back wall over a low credenza
      K.at(mcx, mr.z1 - PWT / 2 - 0.02, Math.PI);
      K.rbox(M.satin, 0, 1.55, 0.02, 1.72, 0.99, 0.035, 0.006, C.black);
      K.screen(4, 0, 1.55, 0.0385, 1.66, 0.93);
      K.at(mcx, mr.z1 - PWT / 2 - 0.25, Math.PI);
      credenza(K, 1.9, 0.56, 0.46, 4);
      solid(mcx, 0.28, mr.z1 - PWT / 2 - 0.25, 1.9, 0.56, 0.46);
      // a linear pendant on two cables over the table
      K.at(mcx, mcz, 0);
      K.rbox(M.satin, 0, 1.95, 0, TL * 0.72, 0.045, 0.07, 0.01, C.black);
      K.box(M.emit, 0, 1.926, 0, TL * 0.7, 0.003, 0.05, C.lampWarm);
      for (const e of [-1, 1]) K.tube(M.satin, [e * TL * 0.3, 1.97, 0], [e * TL * 0.3, CEIL, 0], 0.002, C.black, 4);
      lightSpots.push([mcx, mcz]);
      downlight(mr.x1 - 0.9, mr.z1 - 1.3);
    }

    // ========================================================================
    //  THE NORTH GLASS LOUNGE — two chairs and a table looking over the city
    // ========================================================================
    const lng = { x: CX - W * 0.13, z: zHi - 2.5 };
    if (cfp(lng.x, lng.z, 1.0)) {
      K.world();
      K.box(M.rug, lng.x, 0.018, lng.z + 0.2, 3.4, 0.012, 2.4, 0xffffff);
      for (const s of [-1, 1]) {
        const ax = lng.x + s * 1.0;
        K.at(ax, lng.z, -s * 0.3);
        loungeChair(K, 0.43);
        seatAt(ax, lng.z, -s * 0.3, "armchair", 0.43);             // both face +z: the view
      }
      K.at(lng.x, lng.z + 0.55, 0);
      K.cyl(M.satin, 0, 0.0075, 0, 0.24, 0.26, 0.015, 28, C.gunmetal);
      K.cyl(M.chrome, 0, 0.2, 0, 0.04, 0.04, 0.37, 14, C.gunmetal);
      K.cyl(M.paint, 0, 0.385, 0, 0.42, 0.42, 0.03, 36, C.stoneTop);
      K.box(M.paint, 0.08, 0.412, -0.05, 0.3, 0.024, 0.24, C.bookB, 0, 0.3);
      K.cyl(M.satin, -0.18, 0.43, 0.1, 0.07, 0.04, 0.06, 18, C.black);
      solid(lng.x, 0.2, lng.z + 0.55, 0.84, 0.4, 0.84);
      downlight(lng.x, lng.z + 0.3);
    }

    // ---- open-plan ceiling: a downlight grid on a 2.4 m module over the
    // gallery (skipping the rooms, which have their own), sprinkler heads on a
    // 3 m grid, and slot diffusers along the bulkhead edge
    const inOffice = (x) => x > offX0 - 0.2;
    const inMeet = (x, z) => mrC && x < mr.x1 + 0.2 && z < mr.z1 + 0.2;
    const inCore = (x, z) => Math.abs(x - core.x) < CH + 0.5 && Math.abs(z - core.z) < CH + 0.5;
    for (let x = xS + 1.8; x < iX1 - 1.0; x += 2.4) for (let z = iZ0 + 1.5; z < iZ1 - 1.0; z += 2.4) {
      if (inOffice(x) || inMeet(x, z) || inCore(x, z)) continue;
      let near = false;
      for (const l of lightSpots) if (Math.hypot(l[0] - x, l[1] - z) < 1.3) { near = true; break; }
      if (!near) downlight(x, z);
    }
    K.world();
    for (let x = xS + 1.5; x < iX1 - 0.8; x += 3.0) for (let z = iZ0 + 1.2; z < iZ1 - 0.8; z += 3.0) {
      if (inCore(x, z)) continue;
      let near = false;
      for (const l of lightSpots) if (Math.hypot(l[0] - x, l[1] - z) < 0.6) { near = true; break; }
      if (near) continue;
      K.cyl(M.chrome, x, CEIL - 0.004, z, 0.03, 0.03, 0.008, 12, C.chrome);
      K.cyl(M.chrome, x, CEIL - 0.02, z, 0.008, 0.012, 0.025, 8, C.brass);
    }
    for (const f of faces) {
      for (let t = f.lo + 1.2; t + 1.2 < f.hi - 0.8; t += 4.5) {
        if (f.axis === "z") K.box(M.satin, t + 0.6, SOFFIT - 0.003, f.at - f.s * 0.45, 1.2, 0.004, 0.05, C.grille);
        else K.box(M.satin, f.at - f.s * 0.45, SOFFIT - 0.003, t + 0.6, 0.05, 0.004, 1.2, C.grille);
      }
    }

    K.flush(b.group);

    // ========================================================================
    //  STAMP THE CONTRACT (world coords) — origins.js + the express lift +
    //  the rent-unit skips + elevators.js's shaft steering all read this.
    // ========================================================================
    const keep = [
      { x: ox + core.x, z: oz + core.z, r: 2.8 },
      { x: ox + rec.x, z: oz + rec.z, r: 2.4 },
      { x: ox + dsk.x, z: oz + dsk.z, r: 3.2 },
      { x: ox + dsk.x - 2.0, z: oz + dsk.z, r: 2.0 },
      { x: ox + lng.x, z: oz + lng.z, r: 2.4 },
      // shaft steering: block the carved lift chase out of the corner office's
      // glass walls (+x face slots) and the -z face slot that lands inside it,
      // leaving the NW gallery slots free — the column arrives there and reads
      // as the building core beside the service side.
      { x: ox + xHi - 1.5, z: oz + D * 0.30, r: 3.4 },
      { x: ox + xHi - 1.5, z: oz - D * 0.30, r: 3.4 },
      { x: ox + W * 0.30, z: oz + zLo + 1.5, r: 3.4 },
      { x: ox + W * 0.30, z: oz + zHi - 1.5, r: 3.4 },
    ];
    if (mrC) {
      keep.push({ x: ox + mrC.x, z: oz + mrC.z, r: 3.4 });
      keep.push({ x: ox + mr.x0 + 1.6, z: oz + mrC.z, r: 3.0 });      // table's -x end vs the -x wall slot
    }
    b.execOffice = {
      floorY: Y,
      name: FIRM,
      // he starts on his feet beside his own chair, behind the desk, looking
      // across the monitors and the empty floor at the office door
      spawn: { x: ox + chr.x + 0.15, z: oz + chr.z + 0.85 },
      face: { x: ox + offX0, z: oz + offDoorZ },
      desk: { x: ox + dsk.x, z: oz + dsk.z },
      laptop: lapScreen,
      // the walnut core as a stop of the tower's lift (city/elevators.js)
      liftLanding: liftLanding,
      keepClear: keep,
    };
    return b.execOffice;
  };
})();
