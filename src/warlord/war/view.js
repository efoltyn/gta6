/* ============================================================
   warlord/war/view.js — THE WAR MAP, as a thing you could put on a table.

   One painted relief map per war, built once and updated by the tile:

     GROUND   one displaced mesh off M.height (relief exaggerated to the
              map's scale so the Alps read as the Alps), coloured by a
              baked canvas at 2-8 px a tile: terrain albedo from
              M.TERRAIN, a north-west relief shade off the real height
              gradient, grain, forest canopy speckle, snow on the high
              ground, an inked coast, shallows, and every river in the map
              file drawn as a smoothed line that widens toward its mouth.
     SEA      its own plane at sea level: the baked bathymetry (navy deep
              water to turquoise shallows) with a moving sun glint. It
              discards itself over land using the SAME smoothed land field
              the paint uses, so coast, paint and sea never disagree.
     REALMS   OpenFront paint in the terrain shader: an owner texture at
              tile resolution, resolved per pixel by the bilinear vote of
              its four neighbours, so borders are smooth contours and not
              stairs, drawn as a crisp ~2 px line in constant screen width
              (fwidth), a stronger band of colour just inside every border,
              and a pale line where a realm meets the sea. A town that
              changes hands repaints outward from its gate over 0.8 s,
              in the order G.catchTiles already sorts by distance.
     TOWNS    the warlord's own houses (W.props.house, lite shells),
              merged once per kind and INSTANCED: every house on the map is
              three draw calls. They face a well on a square of trodden
              earth that the terrain shader paints and grows with the town;
              tracks between neighbouring towns are baked into the ground.
              Capitals are walled: crenellated curtain, square towers, a
              gatehouse. Every town flies its owner's vexillum.
     ARMIES   a regiment of painted miniature spearmen on a wooden stand
              that lies on the slope, ranks facing the march, the owner's
              standard at the back corner, a strength plate over it.
              Movement is interpolated between sim days. Battles are crossed
              swords and dust with both sides' numbers; routes end in an
              arrowhead.
     CAMERA   an RTS map camera: drag pans, wheel/pinch zooms toward the
              cursor, right-drag / two-finger twist rotates and tilts.

   API (CONTRACT.md section 5):
     mount(M, G)  unmount()  hide()  show()  frame(dt, dayFrac)  dayTick()
     onEvents(list)  pick(cx, cy) -> {tile, army, town, battle}
     focus(tile, dist?)  select(ids)  preview(path|null)  hiFaction(i)
     on("tap"|"hover"|"box", fn)
============================================================ */
(function () {
  "use strict";
  const G0 = typeof window !== "undefined" ? window : globalThis;
  const CBZ = (G0.CBZ = G0.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const WAR = (W.war = W.war || {});
  const V = (WAR.view = WAR.view || {});
  if (typeof document === "undefined") return;

  let THREE = null;
  let M = null, G = null;
  let root = null, overlay = null, boxEl = null;
  let mounted = false, hidden = false;
  let saved = null;
  const listeners = { tap: [], hover: [], box: [] };
  V.on = function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); return fn; };
  function fire(t, a) { const L = listeners[t] || []; for (let i = 0; i < L.length; i++) { try { L[i](a); } catch (e) { console.error("[war/view]", t, e); } } }

  /* ---------------------------------------------------------------- utils */
  function hash2(ix, iy, salt) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(salt, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, cell, salt) {
    const fx = x / cell, fy = y / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = hash2(ix, iy, salt), b = hash2(ix + 1, iy, salt);
    const c = hash2(ix, iy + 1, salt), d = hash2(ix + 1, iy + 1, salt);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function strHash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function lin2srgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  V.fmt = function (n) { n = Math.round(n || 0); return n.toLocaleString("en-US"); };
  function cssOfOwner(o, a) {
    if (a && a.free) return "#d8cfb4";
    if (!o) return "#d8cfb4";
    const F = G.factions[o];
    return (F && F.css) || "#8c8374";
  }
  const _col = {};
  function linColour(css, k) {
    const key = css + (k || 1);
    let c = _col[key];
    if (!c) { c = new THREE.Color(css); c.convertSRGBToLinear(); if (k) c.multiplyScalar(k); _col[key] = c; }
    return c;
  }

  /* ================================================================ HEIGHT
     The display surface: a vertex per tile corner, land lifted by an
     exaggeration chosen per map (relief ~1.4% of the map's width at the
     highest peak, clamped to 1x..25x true scale), sea floor a thin shelf
     just under the water plane so tilted views never look into a trench,
     and the outer ring dropped so the sheet has an edge. */
  let step = 1, gw = 0, gh = 0, vh = null, hScale = 1;
  function buildHeight() {
    const w = M.w, h = M.h, N = w * h, T = M.terrain, H = M.height;
    step = Math.max(1, Math.ceil(Math.max(w, h) / 720));
    gw = Math.ceil(w / step); gh = Math.ceil(h / step);
    let maxH = 50;
    for (let i = 0; i < N; i++) if (T[i] !== 0 && H[i] > maxH) maxH = H[i];
    const tileM = Math.max(1, (M.tileKm || 10) * 1000);
    hScale = 0.014 * Math.max(w, h) / maxH;
    const ex = hScale * tileM;
    if (ex > 25) hScale = 25 / tileM;
    if (ex < 1) hScale = 1 / tileM;
    const th = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (T[i] !== 0) th[i] = Math.max(0, H[i]) * hScale;
      else th[i] = -0.035 - Math.min(1, Math.max(0, -H[i]) / 3000) * 0.4;
    }
    vh = new Float32Array((gw + 1) * (gh + 1));
    for (let j = 0; j <= gh; j++) for (let i = 0; i <= gw; i++) {
      const x = Math.min(w, i * step), y = Math.min(h, j * step);
      let s = 0, n = 0;
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
        const xx = clamp(x + dx, 0, w - 1), yy = clamp(y + dy, 0, h - 1);
        s += th[xx + yy * w]; n++;
      }
      let v = s / n;
      if (i === 0 || j === 0 || i === gw || j === gh) v = Math.min(v, 0) - 0.8;
      vh[i + j * (gw + 1)] = v;
    }
  }
  // tile coords (float) -> display y
  function yAt(tx, ty) {
    let gx = tx / step, gy = ty / step;
    gx = clamp(gx, 0, gw); gy = clamp(gy, 0, gh);
    const x0 = Math.min(gw - 1, gx | 0), y0 = Math.min(gh - 1, gy | 0);
    const fx = gx - x0, fy = gy - y0, R = gw + 1;
    const a = vh[x0 + y0 * R], b = vh[x0 + 1 + y0 * R], c = vh[x0 + (y0 + 1) * R], d = vh[x0 + 1 + (y0 + 1) * R];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function groundY(tx, ty) { return Math.max(0, yAt(tx, ty)); }
  V.yAt = function (tx, ty) { return vh ? yAt(tx, ty) : 0; };
  function wx(tx) { return tx - M.w / 2; }
  function wz(ty) { return ty - M.h / 2; }

  /* ================================================================ BAKE
     The painted ground. Everything is sampled off tile fields with the
     same bilinear rule the GPU uses, so the coast baked here is exactly
     the coast the shader paints realms up to. */
  let landF = null;              // smoothed land field, tile res, 0..1 (0.5 = the coast)
  let bakeScale = 4;
  let deepCol = [22, 50, 80];
  function buildLandField() {
    const w = M.w, h = M.h, N = w * h, T = M.terrain;
    const l = new Float32Array(N);
    for (let i = 0; i < N; i++) l[i] = T[i] !== 0 && T[i] !== 7 ? 1 : 0;
    landF = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += l[clamp(x + dx, 0, w - 1) + clamp(y + dy, 0, h - 1) * w];
      landF[x + y * w] = 0.5 * l[x + y * w] + 0.5 * s / 9;
    }
  }
  const PAINT = { plains: [0.52, 0.56, 0.34], forest: [0.24, 0.34, 0.18], hills: [0.56, 0.5, 0.35],
                  mountains: [0.52, 0.48, 0.42], desert: [0.87, 0.77, 0.56], marsh: [0.36, 0.44, 0.33] };
  function bakeBase() {
    const w = M.w, h = M.h, N = w * h, T = M.terrain, H = M.height;
    let s = Math.floor(Math.sqrt(2.4e6 / N));
    s = clamp(s, 2, 8);
    while (s > 1 && (w * s > 4096 || h * s > 4096)) s--;
    bakeScale = s;
    const TW = w * s, TH = h * s;
    const salt = strHash(M.id) & 0xffff;

    // palette: M.TERRAIN albedo in sRGB, saturation lifted for paint
    const pal = [];
    for (let c = 0; c < 8; c++) {
      const TT = M.TERRAIN[c] || M.TERRAIN[1];
      let r = lin2srgb(TT.colour[0]), g = lin2srgb(TT.colour[1]), b = lin2srgb(TT.colour[2]);
      const l = (r + g + b) / 3, k = 1.22;
      r = l + (r - l) * k; g = l + (g - l) * k; b = l + (b - l) * k;
      // half the albedo, half a map painter's hue for the same ground: without
      // it summer plains and the erg are the same straw and the eye loses the desert edge
      const pt = PAINT[TT.key];
      if (pt) { r = (r + pt[0]) / 2; g = (g + pt[1]) / 2; b = (b + pt[2]) / 2; }
      pal.push([clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)]);
    }
    const cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N);
    const forest = new Float32Array(N), desert = new Float32Array(N), mtn = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = T[i];
      const p = pal[t];
      cr[i] = p[0]; cg[i] = p[1]; cb[i] = p[2];
      forest[i] = t === 2 ? 1 : 0; desert[i] = t === 5 ? 1 : 0; mtn[i] = t === 4 ? 1 : 0;
    }
    // water tiles take their land neighbours' colour, so land colour never bleeds sea at the coast
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (T[i] !== 0 && T[i] !== 7) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = clamp(x + dx, 0, w - 1) + clamp(y + dy, 0, h - 1) * w;
        if (T[j] === 0 || T[j] === 7) continue;
        r += pal[T[j]][0]; g += pal[T[j]][1]; b += pal[T[j]][2]; n++;
      }
      if (n) { cr[i] = r / n; cg[i] = g / n; cb[i] = b / n; } else { cr[i] = pal[1][0]; cg[i] = pal[1][1]; cb[i] = pal[1][2]; }
    }
    function bil(a, fx, fy) {
      let x = fx - 0.5, y = fy - 0.5;
      if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
      if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
      const x0 = x | 0, y0 = y | 0, x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0;
      const tx = x - x0, ty = y - y0;
      return (a[x0 + y0 * w] * (1 - tx) + a[x1 + y0 * w] * tx) * (1 - ty) + (a[x0 + y1 * w] * (1 - tx) + a[x1 + y1 * w] * tx) * ty;
    }
    // pixel heights, bilinear then box-blurred so the shade has no tile facets
    const P = TW * TH;
    let Hp = new Float32Array(P);
    for (let py = 0; py < TH; py++) {
      const fy = (py + 0.5) / s;
      for (let px = 0; px < TW; px++) Hp[px + py * TW] = bil(H, (px + 0.5) / s, fy);
    }
    const rb = Math.max(1, s >> 1);
    Hp = boxBlur(boxBlur(Hp, TW, TH, rb), TW, TH, rb);
    // the sea floor reads through a much wider blur: the synthesised bathymetry is
    // noise at tile scale, and water coloured by it photographed as blocky circuitry
    const rs = Math.max(2, s * 2);
    const HpSea = boxBlur(boxBlur(boxBlur(Hp, TW, TH, rs), TW, TH, rs), TW, TH, rs);

    const tileM = Math.max(1, (M.tileKm || 10) * 1000);
    const pxM = tileM / s;
    const zf = clamp(1.2 + (M.tileKm || 10), 1.5, 12);
    const LX = -0.5, LY = -0.5, LZ = 0.7071;
    const cv = document.createElement("canvas");
    cv.width = TW; cv.height = TH;
    const cx = cv.getContext("2d");
    const img = cx.createImageData(TW, TH);
    const D = img.data;
    const SH = [74, 132, 146], MID = [38, 88, 120], DEEP = [20, 46, 78];
    deepCol = DEEP;
    const edgeK = 0.018 * Math.max(w, h);
    for (let py = 0; py < TH; py++) {
      const fy = (py + 0.5) / s;
      const pyU = py > 0 ? py - 1 : py, pyD = py < TH - 1 ? py + 1 : py;
      for (let px = 0; px < TW; px++) {
        const fx = (px + 0.5) / s;
        const p = px + py * TW;
        const Lp = bil(landF, fx, fy);
        const hg = Hp[p];
        const pxL = px > 0 ? px - 1 : px, pxR = px < TW - 1 ? px + 1 : px;
        const dzdx = (Hp[pxR + py * TW] - Hp[pxL + py * TW]) / ((pxR - pxL || 1) * pxM);
        const dzdy = (Hp[px + pyD * TW] - Hp[px + pyU * TW]) / ((pyD - pyU || 1) * pxM);
        const nx = -dzdx * zf, ny = -dzdy * zf;
        const shade = (nx * LX + ny * LY + LZ) / Math.sqrt(nx * nx + ny * ny + 1);
        const k = (shade - 0.7071) * 1.9;
        const grain = (hash2(px, py, salt) - 0.5) * 0.045;
        const mid = vnoise(fx, fy, 2.3, salt + 3) - 0.5;
        let r, g, b;
        // ---- land
        let lr = 0, lg = 0, lb = 0;
        if (Lp > 0.3) {
          const wxp = fx + (vnoise(fx, fy, 1.6, salt + 11) - 0.5) * 0.9;
          const wyp = fy + (vnoise(fx, fy, 1.6, salt + 12) - 0.5) * 0.9;
          lr = bil(cr, wxp, wyp); lg = bil(cg, wxp, wyp); lb = bil(cb, wxp, wyp);
          const fo = bil(forest, wxp, wyp);
          if (fo > 0.02) {
            const n = vnoise(fx, fy, 0.22, salt + 21);
            const dk = 1 - fo * (n > 0.52 ? 0.26 : 0.08);
            lr *= dk; lg *= dk; lb *= dk;
          }
          const de = bil(desert, wxp, wyp);
          if (de > 0.02) {
            const st = Math.sin(fx * 5.1 + fy * 1.3 + vnoise(fx, fy, 1.1, salt + 31) * 6) * 0.5 + 0.5;
            const m = 1 + de * (st - 0.5) * 0.08;
            lr *= m; lg *= m; lb *= m;
          }
          // hypsometric: high ground lightens and greys, the peaks carry snow
          const hi = smooth(900, 2600, hg);
          if (hi > 0) {
            const gr = (lr + lg + lb) / 3;
            lr += (gr * 1.12 - lr) * hi * 0.6; lg += (gr * 1.1 - lg) * hi * 0.6; lb += (gr * 1.08 - lb) * hi * 0.6;
          }
          const sn = smooth(2500, 3300, hg + mid * 500) * clamp(0.5 + shade, 0.6, 1.2);
          if (sn > 0) { lr += (0.94 - lr) * sn; lg += (0.95 - lg) * sn; lb += (0.97 - lb) * sn; }
          const m2 = clamp(1 + k, 0.38, 1.5) * (1 + mid * 0.08 + grain);
          lr *= m2; lg *= m2; lb *= m2;
        }
        // ---- water
        let sr = 0, sg = 0, sb = 0;
        if (Lp < 0.7) {
          const dep = Math.max(0, -HpSea[p]);
          const t1 = clamp(dep / 110, 0, 1), t2 = clamp((dep - 110) / 1500, 0, 1);
          sr = (SH[0] + (MID[0] - SH[0]) * t1) ; sg = (SH[1] + (MID[1] - SH[1]) * t1); sb = (SH[2] + (MID[2] - SH[2]) * t1);
          sr += (DEEP[0] - sr) * t2; sg += (DEEP[1] - sg) * t2; sb += (DEEP[2] - sb) * t2;
          const glow = smooth(0.3, 0.5, Lp);
          sr += (SH[0] + 14 - sr) * glow * 0.35; sg += (SH[1] + 16 - sg) * glow * 0.35; sb += (SH[2] + 10 - sb) * glow * 0.35;
          const m3 = 1 + mid * 0.035 + grain * 0.25;
          sr = sr / 255 * m3; sg = sg / 255 * m3; sb = sb / 255 * m3;
        }
        const a = smooth(0.46, 0.54, Lp);
        r = sr + (lr - sr) * a; g = sg + (lg - sg) * a; b = sb + (lb - sb) * a;
        // inked coast, and the pale surf just off it
        const q = Math.abs(Lp - 0.5);
        const ink = 1 - smooth(0.0, 0.075, q);
        if (ink > 0) { r += (0.2 - r) * ink * 0.5; g += (0.19 - g) * ink * 0.5; b += (0.17 - b) * ink * 0.5; }
        const surf = Lp < 0.5 ? smooth(0.3, 0.42, Lp) * (1 - smooth(0.44, 0.49, Lp)) : 0;
        if (surf > 0) { r += (0.7 - r) * surf * 0.25; g += (0.82 - g) * surf * 0.25; b += (0.82 - b) * surf * 0.25; }
        // the sheet's edge darkens into deep water
        const ed = Math.min(fx, w - fx, fy, h - fy) / edgeK;
        if (ed < 1) {
          const e = smooth(0, 1, ed);
          const dr = DEEP[0] / 255 * 0.8, dg = DEEP[1] / 255 * 0.8, db = DEEP[2] / 255 * 0.8;
          r = dr + (r - dr) * (0.6 + 0.4 * e); g = dg + (g - dg) * (0.6 + 0.4 * e); b = db + (b - db) * (0.6 + 0.4 * e);
        }
        const o = p * 4;
        D[o] = clamp(r * 255, 0, 255); D[o + 1] = clamp(g * 255, 0, 255); D[o + 2] = clamp(b * 255, 0, 255); D[o + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
    drawRivers(cx, s);
    return cv;
  }
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    const n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[row + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / n;
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / n;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }
  /* RIVERS AS LINES, not as blue tiles: the map file's own polylines,
     through M.toTile, smoothed with midpoint quadratics, widening from the
     source to the mouth, a dark bank under a lighter water line. */
  function drawRivers(cx, s) {
    const R = (M.data && M.data.rivers) || [];
    if (!R.length) return;
    cx.lineCap = "round"; cx.lineJoin = "round";
    for (let pass = 0; pass < 2; pass++) {
      for (let r = 0; r < R.length; r++) {
        const line = R[r].line || [];
        if (line.length < 2) continue;
        const pts = line.map(function (p) { const t = M.toTile(p[0], p[1]); return [t[0] * s, t[1] * s]; });
        const n = pts.length;
        for (let k = 0; k < n - 1; k++) {
          const f = k / Math.max(1, n - 2);
          const wdt = (0.35 + 0.55 * f) * s * 0.42 * (pass === 0 ? 1.9 : 1);
          cx.lineWidth = Math.max(pass === 0 ? 1.6 : 0.9, wdt);
          cx.strokeStyle = pass === 0 ? "rgba(52,60,58,0.35)" : "rgba(70,128,160,0.95)";
          cx.beginPath();
          const a = pts[Math.max(0, k - 1)], b = pts[k], c = pts[k + 1];
          const m0x = (a[0] + b[0]) / 2, m0y = (a[1] + b[1]) / 2, m1x = (b[0] + c[0]) / 2, m1y = (b[1] + c[1]) / 2;
          if (k === 0) { cx.moveTo(b[0], b[1]); cx.lineTo(m1x, m1y); }
          else { cx.moveTo(m0x, m0y); cx.quadraticCurveTo(b[0], b[1], m1x, m1y); }
          if (k === n - 2) cx.lineTo(c[0], c[1]);
          cx.stroke();
        }
      }
    }
  }

  /* ================================================================ SHADERS */
  const NOISE_GLSL =
    // Hoskins' hash12: no sin(), so it stays noise at the large coordinates a 440-tile map reaches
    "float hsh(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}" +
    "float vno(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.0-2.0*f);" +
    "return mix(mix(hsh(i),hsh(i+vec2(1.0,0.0)),f.x),mix(hsh(i+vec2(0.0,1.0)),hsh(i+vec2(1.0,1.0)),f.x),f.y);}";
  const VERT =
    "varying vec2 vUv;varying float vDepth;varying vec3 vWorld;" +
    "void main(){vUv=uv;vec4 wp=modelMatrix*vec4(position,1.0);vWorld=wp.xyz;vec4 mv=viewMatrix*wp;vDepth=-mv.z;gl_Position=projectionMatrix*mv;}";
  const TERRAIN_FRAG =
    "uniform sampler2D uBase;uniform sampler2D uOwner;uniform sampler2D uPal;uniform sampler2D uLand;uniform sampler2D uTown;" +
    "uniform vec2 uSize;uniform vec3 uFog;uniform vec2 uFogR;uniform float uPlayer;uniform float uHi;uniform float uTime;uniform float uAlpha;uniform float uTownZ;" +
    "varying vec2 vUv;varying float vDepth;varying vec3 vWorld;" + NOISE_GLSL +
    "float own(vec2 c){return floor(texture2D(uOwner,(c+0.5)/uSize).r*255.0+0.5);}" +
    "vec3 pal(float o){return texture2D(uPal,vec2((o+0.5)/256.0,0.5)).rgb;}" +
    "void main(){" +
    " vec3 col=texture2D(uBase,vUv).rgb;" +
    " vec2 tp=vUv*uSize;" +
    " col*=0.955+0.09*(vno(tp*7.0)*0.6+vno(tp*19.0)*0.4);" +
    " float land=texture2D(uLand,vUv).r;" +
    " float fwL=max(fwidth(land),0.0005);" +
    " float lm=smoothstep(0.5-fwL,0.5+fwL,land);" +
    // TOWN GROUND: trodden earth under the huts, out to the town's ground radius
    // (grown with the live town zoom), its edge broken by noise so it is a
    // worn patch and not a disc, and a paler packed square round the well.
    // uTown holds, per tile, the EXACT offset to the nearest town centre
    // (12-bit x/y) and that town's radius, so the distance is exact at any zoom
    " vec2 tc=floor(tp)+0.5;vec4 tw=texture2D(uTown,tc/uSize);" +
    " float tr=tw.b*uTownZ;" +
    " if(tr>0.0){" +
    "  float lo=floor(tw.a*255.0+0.5);float lx=floor(lo/16.0);float ly=lo-lx*16.0;" +
    "  vec2 off=(vec2(floor(tw.r*255.0+0.5)*16.0+lx,floor(tw.g*255.0+0.5)*16.0+ly)/4095.0)*24.0-12.0;" +
    "  float td0=length(tp-(tc+off));" +
    "  float td=td0+(vno(tp*2.7)-0.5)*0.35*tr;" +
    "  float lu0=dot(col,vec3(0.299,0.587,0.114));" +
    "  float dirt=(1.0-smoothstep(tr*0.7,tr*1.15,td))*lm;" +
    "  vec3 dc=vec3(0.46,0.38,0.28)*(0.88+0.24*vno(tp*31.0));" +
    "  col=mix(col,dc*(0.55+0.9*lu0),dirt*0.62);" +
    "  float sq=(1.0-smoothstep(0.1*uTownZ,0.15*uTownZ,td0))*lm;" +
    "  col=mix(col,vec3(0.6,0.55,0.46)*(0.55+0.9*lu0),sq*0.55);" +
    " }" +
    " vec2 p=tp-0.5;vec2 i0=floor(p);vec2 f=p-i0;" +
    " float o0=own(i0),o1=own(i0+vec2(1.0,0.0)),o2=own(i0+vec2(0.0,1.0)),o3=own(i0+vec2(1.0,1.0));" +
    " float w0=(1.0-f.x)*(1.0-f.y),w1=f.x*(1.0-f.y),w2=(1.0-f.x)*f.y,w3=f.x*f.y;" +
    " float s0=w0+(o1==o0?w1:0.0)+(o2==o0?w2:0.0)+(o3==o0?w3:0.0);" +
    " float s1=w1+(o0==o1?w0:0.0)+(o2==o1?w2:0.0)+(o3==o1?w3:0.0);" +
    " float s2=w2+(o0==o2?w0:0.0)+(o1==o2?w1:0.0)+(o3==o2?w3:0.0);" +
    " float s3=w3+(o0==o3?w0:0.0)+(o1==o3?w1:0.0)+(o2==o3?w2:0.0);" +
    " float best=o0,sb=s0;if(s1>sb){best=o1;sb=s1;}if(s2>sb){best=o2;sb=s2;}if(s3>sb){best=o3;sb=s3;}" +
    " float ss=0.0;if(o0!=best)ss=max(ss,s0);if(o1!=best)ss=max(ss,s1);if(o2!=best)ss=max(ss,s2);if(o3!=best)ss=max(ss,s3);" +
    " float d=sb-ss;" +
    " float fw=max(fwidth(d),0.0008);" +
    " float edge=1.0-smoothstep(fw*0.6,fw*2.0,d);" +
    " float band=1.0-smoothstep(0.0,0.55,d);" +
    " float owned=step(0.5,best);" +
    " if(owned>0.5){" +
    "  vec3 fc=pal(best);" +
    "  float a=(best==uPlayer?uAlpha+0.06:uAlpha)+band*0.2;" +
    "  if(best==uHi)a+=0.14*(0.5+0.5*sin(uTime*5.0));" +
    "  float lu=dot(col,vec3(0.299,0.587,0.114));" +
    // the paint carries the ground's own light and shade, so hills still read under a realm
    "  col=mix(col,fc*(0.45+1.1*lu),clamp(a,0.0,0.9)*lm);" +
    " }" +
    " float anyO=step(0.5,max(max(o0,o1),max(o2,o3)));" +
    " vec3 lc=owned>0.5?pal(best)*0.32:pal(max(max(o0,o1),max(o2,o3)))*0.32;" +
    " col=mix(col,lc,edge*0.9*lm*anyO);" +
    " float coast=1.0-smoothstep(fwL*0.5,fwL*2.2,abs(land-0.5));" +
    " col=mix(col,vec3(1.0,0.96,0.86),coast*0.5*owned);" +
    " float fg=smoothstep(uFogR.x,uFogR.y,vDepth);" +
    " col=mix(col,uFog,fg);" +
    " gl_FragColor=vec4(col,1.0);" +
    "}";
  const SEA_FRAG =
    "uniform sampler2D uBase;uniform sampler2D uLand;uniform vec3 uFog;uniform vec2 uFogR;uniform float uTime;" +
    "uniform vec4 uMap;uniform vec3 uDeep;uniform vec3 uSun;uniform float uWave;" +
    "varying vec2 vUv;varying float vDepth;varying vec3 vWorld;" + NOISE_GLSL +
    "void main(){" +
    " vec2 uv=(vWorld.xz-uMap.xy)/uMap.zw;" +
    " vec3 col;" +
    " if(uv.x>=0.0&&uv.x<=1.0&&uv.y>=0.0&&uv.y<=1.0){" +
    "  float land=texture2D(uLand,uv).r;if(land>0.5)discard;" +
    "  col=mix(texture2D(uBase,uv,3.5).rgb,texture2D(uBase,uv).rgb,0.25);" + // the baked sea carries the depth noise tile by tile; a blurred mip reads as water, not circuitry
    " }else{" +
    "  float e=max(max(-uv.x,uv.x-1.0),max(-uv.y,uv.y-1.0));" +
    "  col=uDeep*(0.8-min(e*1.2,0.25));" +
    " }" +
    " vec2 q=vWorld.xz*uWave;" +
    " vec2 t1=vec2(uTime*0.35,uTime*0.2),t2=vec2(uTime*0.22,-uTime*0.31);" +
    // the wave NORMAL comes from the noise GRADIENT. It was built from the raw noise values,
    // so every glint was a level set of value noise and the sea photographed as circuitry
    " float n1=vno(q+t1)*0.62+vno(q*2.3-t2)*0.38;" +
    " float nx=vno(q+vec2(0.3,0.0)+t1)*0.62+vno((q+vec2(0.3,0.0))*2.3-t2)*0.38;" +
    " float nz=vno(q+vec2(0.0,0.3)+t1)*0.62+vno((q+vec2(0.0,0.3))*2.3-t2)*0.38;" +
    " vec3 N=normalize(vec3((n1-nx)*1.6,1.0,(n1-nz)*1.6));" +
    " vec3 Vv=normalize(cameraPosition-vWorld);" +
    " vec3 Hh=normalize(uSun+Vv);" +
    " float sp=pow(max(dot(N,Hh),0.0),90.0);" +
    " col*=0.985+0.03*n1;" +
    " col+=vec3(1.0,0.95,0.84)*sp*0.16;" +
    " float fg=smoothstep(uFogR.x,uFogR.y,vDepth);" +
    " col=mix(col,uFog,fg);" +
    " gl_FragColor=vec4(col,1.0);" +
    "}";
  // a march route: a dashed, crawling line with dark edges, ending in a solid
  // arrowhead (aHead = 1) the way a campaign map draws an army's advance
  const RIBBON_VERT =
    "attribute float aLen;attribute float aSide;attribute float aHead;varying float vLen;varying float vSide;varying float vHead;" +
    "void main(){vLen=aLen;vSide=aSide;vHead=aHead;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
  const RIBBON_FRAG =
    "uniform vec3 uColor;uniform float uTime;uniform float uDash;uniform float uOp;varying float vLen;varying float vSide;varying float vHead;" +
    "void main(){float ph=fract(vLen/uDash-uTime*0.9);float dsh=smoothstep(0.0,0.08,ph)*(1.0-smoothstep(0.55,0.63,ph));" +
    "float e=smoothstep(0.0,0.22,vSide)*(1.0-smoothstep(0.78,1.0,vSide));" +
    "float core=1.0-smoothstep(0.3,0.5,abs(vSide-0.5));" +
    "vec3 c=mix(vec3(0.08,0.06,0.04),uColor,core);" +
    "if(vHead>0.5){c=mix(vec3(0.08,0.06,0.04),uColor,smoothstep(0.55,0.8,vHead));dsh=1.0;e=1.0;}" +
    "gl_FragColor=vec4(c,dsh*e*uOp);}";

  /* ================================================================ BUILD */
  let terrainMesh = null, terrainMat = null, seaMesh = null, seaMat = null;
  let baseTex = null, ownerTex = null, ownerData = null, palTex = null, palData = null, landTex = null;
  let seaNear = null, revStart = null, revList = null;
  const disposables = [];
  function track(o) { disposables.push(o); return o; }

  function buildTerrain() {
    const w = M.w, h = M.h, N = w * h;
    const R = gw + 1, C = gh + 1;
    const pos = new Float32Array(R * C * 3), uv = new Float32Array(R * C * 2);
    for (let j = 0; j < C; j++) for (let i = 0; i < R; i++) {
      const k = i + j * R;
      const tx = Math.min(w, i * step), ty = Math.min(h, j * step);
      pos[k * 3] = wx(tx); pos[k * 3 + 1] = vh[k]; pos[k * 3 + 2] = wz(ty);
      uv[k * 2] = tx / w; uv[k * 2 + 1] = ty / h;
    }
    const idx = new Uint32Array(gw * gh * 6);
    let o = 0;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const a = i + j * R, b = a + 1, c = a + R, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const cv = bakeBase();
    baseTex = track(new THREE.CanvasTexture(cv));
    baseTex.flipY = false;
    const R2 = CBZ.renderer;
    const gl2 = !!(R2 && R2.capabilities && R2.capabilities.isWebGL2);
    baseTex.generateMipmaps = gl2;
    baseTex.minFilter = gl2 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    baseTex.magFilter = THREE.LinearFilter;
    baseTex.wrapS = baseTex.wrapT = THREE.ClampToEdgeWrapping;
    if (R2 && R2.capabilities && R2.capabilities.getMaxAnisotropy) baseTex.anisotropy = Math.min(8, R2.capabilities.getMaxAnisotropy());
    baseTex.needsUpdate = true;
    V._bakeCanvas = cv;

    // smoothed land field
    const ld = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) { const v = Math.round(clamp(landF[i], 0, 1) * 255); ld[i * 4] = v; ld[i * 4 + 1] = v; ld[i * 4 + 2] = v; ld[i * 4 + 3] = 255; }
    landTex = track(new THREE.DataTexture(ld, w, h, THREE.RGBAFormat));
    landTex.magFilter = landTex.minFilter = THREE.LinearFilter;
    landTex.generateMipmaps = false; landTex.flipY = false; landTex.needsUpdate = true;

    // owners: land tiles carry G.owner; water within 2 tiles of a coast carries
    // its nearest land tile's owner, so the paint reaches the smooth coast line
    buildSeaNear();
    ownerData = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) ownerData[i * 4 + 3] = 255;
    ownerTex = track(new THREE.DataTexture(ownerData, w, h, THREE.RGBAFormat));
    ownerTex.magFilter = ownerTex.minFilter = THREE.NearestFilter;
    ownerTex.generateMipmaps = false; ownerTex.flipY = false;
    for (let i = 0; i < N; i++) if (M.land[i]) writeOwner(i, G.owner[i]);
    ownerTex.needsUpdate = true;

    palData = new Uint8Array(256 * 4);
    for (let f = 1; f < G.factions.length; f++) {
      const c = new THREE.Color(G.factions[f].css || "#888888");
      palData[f * 4] = Math.round(c.r * 255); palData[f * 4 + 1] = Math.round(c.g * 255); palData[f * 4 + 2] = Math.round(c.b * 255); palData[f * 4 + 3] = 255;
    }
    palTex = track(new THREE.DataTexture(palData, 256, 1, THREE.RGBAFormat));
    palTex.magFilter = palTex.minFilter = THREE.NearestFilter; palTex.generateMipmaps = false; palTex.needsUpdate = true;

    const fogC = new THREE.Vector3(FOG[0], FOG[1], FOG[2]);
    terrainMat = track(new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: baseTex }, uOwner: { value: ownerTex }, uPal: { value: palTex }, uLand: { value: landTex },
        uSize: { value: new THREE.Vector2(w, h) }, uFog: { value: fogC }, uFogR: { value: new THREE.Vector2(1e5, 2e5) },
        uPlayer: { value: G.player || -1 }, uHi: { value: -1 }, uTime: { value: 0 }, uAlpha: { value: 0.36 }, uTownZ: { value: 1 }, uTown: { value: null },
      },
      vertexShader: VERT, fragmentShader: TERRAIN_FRAG,
      extensions: { derivatives: true },
    }));
    terrainMat.toneMapped = false;
    terrainMesh = new THREE.Mesh(geo, terrainMat);
    terrainMesh.name = "warTerrain";
    terrainMesh.frustumCulled = false;
    root.add(terrainMesh);

    const span = Math.max(w, h) * 7;
    const sg = track(new THREE.PlaneGeometry(span, span, 1, 1));
    sg.rotateX(-Math.PI / 2);
    seaMat = track(new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: baseTex }, uLand: { value: landTex }, uFog: { value: fogC }, uFogR: { value: new THREE.Vector2(1e5, 2e5) },
        uTime: { value: 0 }, uMap: { value: new THREE.Vector4(-w / 2, -h / 2, w, h) },
        uDeep: { value: new THREE.Vector3(deepCol[0] / 255, deepCol[1] / 255, deepCol[2] / 255) },
        uSun: { value: new THREE.Vector3(-0.45, 0.75, -0.48).normalize() }, uWave: { value: 3.0 },
      },
      vertexShader: VERT, fragmentShader: SEA_FRAG,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
    }));
    seaMat.toneMapped = false;
    seaMesh = new THREE.Mesh(sg, seaMat);
    seaMesh.name = "warSea";
    seaMesh.frustumCulled = false;
    root.add(seaMesh);
  }
  function buildSeaNear() {
    const w = M.w, h = M.h, N = w * h, L = M.land;
    seaNear = new Int32Array(N).fill(-1);
    const cnt = new Int32Array(N + 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (L[i]) continue;
      let best = -1, bd = 99;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = xx + yy * w;
        if (!L[j]) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) { seaNear[i] = best; cnt[best + 1]++; }
    }
    revStart = new Int32Array(N + 1);
    for (let i = 0; i < N; i++) revStart[i + 1] = revStart[i] + cnt[i + 1];
    revList = new Int32Array(revStart[N]);
    const fillp = revStart.slice(0, N);
    for (let i = 0; i < N; i++) if (seaNear[i] >= 0) revList[fillp[seaNear[i]]++] = i;
  }
  let ownerDirty = false;
  function writeOwner(i, o) {
    ownerData[i * 4] = o;
    for (let k = revStart[i]; k < revStart[i + 1]; k++) ownerData[revList[k] * 4] = o;
    ownerDirty = true;
  }

  /* ================================================================ GEOMETRY KIT */
  function box(parts, w, h, d, x, y, z, col) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push({ geo: g, color: col });
  }
  // any geometry, optionally turned about x then y, then moved into place
  function part(parts, g, x, y, z, col, rx, ry) {
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    parts.push({ geo: g, color: col });
  }
  /* A SQUARE STONE TOWER, unit footprint, body 0..1 high: a battered plinth,
     the shaft, a corbelled parapet course, eight merlons (corners and
     mid-sides), a dark pyramid roof sunk inside the fighting top, and an
     arrow slit on every face. Shared by the capital's wall towers and the
     two drums of the gatehouse. */
  function towerParts(parts, cx, cz, wdt, hgt, stone, roof) {
    const dark = [0.07, 0.06, 0.05], course = [stone[0] * 0.82, stone[1] * 0.82, stone[2] * 0.8];
    box(parts, wdt * 1.12, 0.14 * hgt, wdt * 1.12, cx, 0.07 * hgt, cz, course);
    box(parts, wdt, hgt, wdt, cx, hgt / 2, cz, stone);
    box(parts, wdt * 1.14, 0.08 * hgt, wdt * 1.14, cx, hgt + 0.04 * hgt, cz, course);
    const m = wdt * 0.26, e = wdt * 0.57 - m / 2;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      if (!i && !j) continue;
      box(parts, m, 0.2 * hgt, m, cx + i * e, hgt * 1.18, cz + j * e, stone);
    }
    const py = new THREE.ConeGeometry(wdt * 0.5, 0.34 * hgt, 4);
    part(parts, py, cx, hgt * 1.08 + 0.17 * hgt, cz, roof, 0, Math.PI / 4);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2, s = Math.sin(a), c = Math.cos(a);
      const sl = new THREE.BoxGeometry(wdt * 0.09, 0.2 * hgt, 0.06 * wdt);
      sl.rotateY(a);
      sl.translate(cx + s * wdt * 0.5, hgt * 0.62, cz + c * wdt * 0.5);
      parts.push({ geo: sl, color: dark });
    }
  }
  function mergeParts(parts) {
    let n = 0;
    const geos = parts.map(function (p) {
      let g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      if (!g.attributes.normal) g.computeVertexNormals();
      n += g.attributes.position.count;
      return { g: g, c: p.color };
    });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const q of geos) {
      const P = q.g.attributes.position.array, Nn = q.g.attributes.normal.array, c = q.c;
      pos.set(P, o * 3); nor.set(Nn, o * 3);
      const k = P.length / 3;
      for (let i = 0; i < k; i++) { col[(o + i) * 3] = c[0]; col[(o + i) * 3 + 1] = c[1]; col[(o + i) * 3 + 2] = c[2]; }
      o += k;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return track(out);
  }
  // a house from the repo's own village kit, flattened to one vertex-coloured geometry
  function houseGeo(kind, seed) {
    const P = W.props;
    const parts = [];
    let g = null;
    // lite: the exterior shell only, no interior and no nested instancing
    try { if (P && P.house) g = P.house({ kind: kind, seed: seed, rot: 0, lite: true }); } catch (e) { g = null; }
    if (g && !g.userData.missing) {
      g.updateMatrixWorld(true);
      g.traverse(function (o) {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        const c = m && m.color ? [m.color.r, m.color.g, m.color.b] : [0.5, 0.45, 0.4];
        const gg = o.geometry.clone();
        gg.applyMatrix4(o.matrixWorld);
        parts.push({ geo: gg, color: c });
      });
    }
    if (!parts.length) {
      // no props.js: an adobe hut with a door and a pitched roof, never a lidded box
      box(parts, 3.3, 2.1, 3.0, 0, 1.05, 0, [0.62, 0.5, 0.36]);
      box(parts, 0.8, 1.5, 0.1, 0, 0.75, 1.52, [0.18, 0.12, 0.08]);
      // roof slabs fall away from the ridge (rotateX(+a) drops the +z end)
      const r1 = new THREE.BoxGeometry(3.7, 0.16, 1.95); r1.rotateX(0.62); r1.translate(0, 2.62, 0.78);
      const r2 = new THREE.BoxGeometry(3.7, 0.16, 1.95); r2.rotateX(-0.62); r2.translate(0, 2.62, -0.78);
      parts.push({ geo: r1, color: [0.42, 0.24, 0.14] }, { geo: r2, color: [0.36, 0.2, 0.12] });
      // the gable: a triangular prism along x closing both ends under the roof
      const gb = new THREE.CylinderGeometry(1.73, 1.73, 3.3, 3, 1);
      gb.rotateZ(Math.PI / 2); gb.rotateX(-Math.PI / 2); gb.scale(1, 0.41, 1); gb.translate(0, 2.455, 0);
      parts.push({ geo: gb, color: [0.6, 0.48, 0.34] });
    }
    return mergeParts(parts);
  }
  /* A PAINTED MINIATURE SPEARMAN, 1.8 tall, facing +z. The owner's colour is
     what a wargamer paints: tunic, shield face and helmet crest (the tinted
     half). Skin, bronze, leather and the spear stay their own colours (the
     untinted half). Low-poly on purpose: at map zoom he is ~15 px tall and
     every vertex is paid 4000 times. */
  function manGeos() {
    const cloth = [], kit = [];
    const skin = [0.62, 0.43, 0.3], bronze = [0.55, 0.4, 0.16], leather = [0.2, 0.13, 0.08], wood = [0.36, 0.25, 0.13];
    // tinted: tunic (a tapered skirt of cloth, not a box), sleeves, shield face, crest
    part(cloth, new THREE.CylinderGeometry(0.2, 0.28, 0.66, 6), 0, 1.1, 0, [0.82, 0.82, 0.82]);
    box(cloth, 0.12, 0.3, 0.13, -0.28, 1.28, 0.02, [0.72, 0.72, 0.72]);
    box(cloth, 0.12, 0.3, 0.13, 0.28, 1.28, 0.02, [0.72, 0.72, 0.72]);
    part(cloth, new THREE.CylinderGeometry(0.33, 0.33, 0.05, 10), -0.16, 1.08, 0.3, [1, 1, 1], Math.PI / 2);
    box(cloth, 0.05, 0.14, 0.34, 0, 1.86, -0.02, [0.9, 0.9, 0.9]);
    // untinted: bare legs and sandals, belt, forearms, head, bronze helmet and shield boss, the spear
    box(kit, 0.14, 0.72, 0.15, -0.1, 0.42, 0, skin);
    box(kit, 0.14, 0.72, 0.15, 0.1, 0.42, 0, skin);
    box(kit, 0.17, 0.08, 0.24, -0.1, 0.04, 0.03, leather);
    box(kit, 0.17, 0.08, 0.24, 0.1, 0.04, 0.03, leather);
    part(kit, new THREE.CylinderGeometry(0.215, 0.23, 0.07, 6), 0, 0.98, 0, leather);
    box(kit, 0.1, 0.3, 0.1, 0.3, 0.98, 0.08, skin);
    part(kit, new THREE.SphereGeometry(0.13, 6, 4), 0, 1.57, 0, skin);
    part(kit, new THREE.SphereGeometry(0.155, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.6, 0, bronze);
    part(kit, new THREE.SphereGeometry(0.08, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2), -0.16, 1.08, 0.325, bronze, Math.PI / 2);
    part(kit, new THREE.CylinderGeometry(0.024, 0.024, 2.4, 4), 0.32, 1.25, 0.1, wood);
    part(kit, new THREE.ConeGeometry(0.05, 0.24, 4), 0.32, 2.57, 0.1, [0.7, 0.7, 0.68]);
    return { cloth: mergeParts(cloth), kit: mergeParts(kit) };
  }
  /* THE STAND a regiment is glued to, like a wargame base: a dark wood rim
     with a bevel step and a flocked top painted like trodden ground. Unit
     footprint, 0.14 high; scaled per army to its formation. */
  const BASE_H = 0.14;
  function standGeo() {
    const p = [];
    box(p, 1.06, 0.08, 1.06, 0, 0.04, 0, [0.19, 0.12, 0.07]);
    box(p, 1, 0.08, 1, 0, 0.1, 0, [0.4, 0.36, 0.23]);
    // tufts of static grass and a stone or two, so the flock is not one flat colour
    const r = mulberry(77);
    for (let i = 0; i < 14; i++) {
      const g = r() < 0.7;
      box(p, g ? 0.07 : 0.06, g ? 0.05 : 0.035, g ? 0.07 : 0.05, (r() - 0.5) * 0.9, 0.14 + (g ? 0.025 : 0.017), (r() - 0.5) * 0.9,
          g ? [0.3, 0.36, 0.16] : [0.5, 0.47, 0.42]);
    }
    return mergeParts(p);
  }
  function vcMat() { return track(new THREE.MeshLambertMaterial({ vertexColors: true })); }
  function instanced(geo, mat, cap, tint) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    if (tint) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false;
    root.add(m);
    track(m);
    return m;
  }

  /* ================================================================ TOWNS
     A town is a village you could have painted: huts round a well on a
     trodden-earth square (the ground is the terrain shader's, off a
     town-distance field, so it grows with the town instead of floating on
     it), a hall for the big places, and a capital's stone ring of crenellated
     wall with square towers and a gatehouse facing south. Every kind is ONE
     instanced mesh: three house kinds, wall, tower, gate, well. */
  const HUT = 0.036;             // display units per metre of hut
  const HOUSE_KINDS = ["hut_square", "hut_round", "shack_lean"];
  const STONE = [0.5, 0.45, 0.37], ROOF = [0.24, 0.15, 0.1];
  let houseMeshes = [], wallMesh = null, towerMesh = null, gateMesh = null, wellMesh = null, townItems = null, lastTownZ = -1;
  function angDist(a, b) { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; }
  function buildTowns() {
    const mat = vcMat();
    const geos = HOUSE_KINDS.map(function (k, i) { return houseGeo(k, 11 + i * 7); });
    const perKind = [[], [], []];
    const walls = [], towers = [], gates = [], wells = [];
    townItems = { kinds: perKind, walls: walls, towers: towers, gates: gates, wells: wells };
    for (let t = 0; t < M.towns.length; t++) {
      const T = M.towns[t];
      const r = mulberry(strHash(T.id || T.name || t) ^ 0x9e3779b9);
      const pop = Math.max(500, T.pop || 1000);
      let n = clamp(Math.round(Math.sqrt(pop) / 13), 3, 40);
      if (T.capital) n += 6;
      const R = 0.2 + 0.068 * Math.sqrt(n);
      const placed = [];
      wells.push({ t: t, ox: 0, oz: 0, rot: r() * Math.PI * 2 });
      if (T.capital || pop > 60000) {
        // the hall stands on the north side of the square, its front to the well
        placed.push([0, -0.2, 0.3]);
        perKind[0].push({ t: t, ox: 0, oz: -0.2, rot: 0, s: 2.1 });
      }
      let tries = 0;
      while (placed.length < n && tries < n * 30) {
        tries++;
        const a = r() * Math.PI * 2, d = R * Math.sqrt(r());
        const ox = Math.cos(a) * d, oz = Math.sin(a) * d;
        if (ox * ox + oz * oz < 0.12 * 0.12) continue;           // the square stays open
        let ok = true;
        for (const q of placed) { const dx = q[0] - ox, dz = q[1] - oz; if (dx * dx + dz * dz < (0.13 + q[2] * 0.3) * (0.13 + q[2] * 0.3)) { ok = false; break; } }
        if (!ok) continue;
        const big = pop > 40000 ? 0.6 : pop > 10000 ? 0.4 : 0.2;
        const kind = r() < big ? 0 : r() < 0.6 ? 1 : 2;
        const s = 0.85 + r() * 0.35;
        placed.push([ox, oz, 0]);
        // houses turn their fronts to the square, give or take
        perKind[kind].push({ t: t, ox: ox, oz: oz, rot: Math.atan2(-ox, -oz) + (r() - 0.5) * 0.5, s: s });
      }
      if (T.capital) {
        const RW = R + 0.1;
        const segs = Math.max(10, Math.ceil(Math.PI * 2 * RW / 0.1));
        // the gate faces +z (the side the default camera looks at), snapped to
        // a segment's middle so exactly one run of wall gives way to it
        const GATE_A = (Math.round(segs / 4 - 0.5) + 0.5) / segs * Math.PI * 2;
        const gateHalf = Math.PI / segs * 0.9;
        for (let k = 0; k < segs; k++) {
          const a0 = k / segs * Math.PI * 2, a1 = (k + 1) / segs * Math.PI * 2, am = (a0 + a1) / 2;
          const len = 2 * RW * Math.sin(Math.PI / segs) * 1.06;
          if (angDist(am, GATE_A) < gateHalf) continue;
          walls.push({ t: t, ox: Math.cos(am) * RW, oz: Math.sin(am) * RW, rot: -am + Math.PI / 2, len: len });
          if (k % 3 === 0 && angDist(a0, GATE_A) > gateHalf + 0.08 / RW) towers.push({ t: t, ox: Math.cos(a0) * RW, oz: Math.sin(a0) * RW });
        }
        gates.push({ t: t, ox: Math.cos(GATE_A) * RW, oz: Math.sin(GATE_A) * RW, rot: -GATE_A + Math.PI / 2 });
      }
      T._viewR = R;
      T._groundR = T.capital ? R + 0.16 : R + 0.08;
    }
    houseMeshes = geos.map(function (g, k) { return instanced(g, mat, Math.max(1, perKind[k].length), false); });

    // wall run: unit length (x), height 1, thickness 1 (z, +z outward); a
    // stepped footing, the curtain, a rampart lip inside, two merlons outside
    const wg = [];
    box(wg, 1, 0.14, 1.25, 0, 0.07, 0, [STONE[0] * 0.8, STONE[1] * 0.8, STONE[2] * 0.78]);
    box(wg, 1, 1, 1, 0, 0.5, 0, STONE);
    box(wg, 1, 0.14, 0.18, 0, 1.07, -0.41, STONE);
    box(wg, 0.26, 0.34, 0.36, -0.25, 1.17, 0.32, STONE);
    box(wg, 0.26, 0.34, 0.36, 0.25, 1.17, 0.32, STONE);
    wallMesh = instanced(mergeParts(wg), mat, Math.max(1, walls.length), false);

    const tg = [];
    towerParts(tg, 0, 0, 1, 1, STONE, ROOF);
    towerMesh = instanced(mergeParts(tg), mat, Math.max(1, towers.length), false);

    // gatehouse, in wall units (wall = 1 high): two drum towers, the arch
    // block over an OPEN passage, its merlons, and the gate leaves swung in
    const gp = [];
    towerParts(gp, -0.62, 0, 0.5, 1.45, STONE, ROOF);
    towerParts(gp, 0.62, 0, 0.5, 1.45, STONE, ROOF);
    box(gp, 0.78, 0.4, 0.5, 0, 0.93, 0, STONE);
    for (let k = -1; k <= 1; k++) box(gp, 0.16, 0.2, 0.14, k * 0.26, 1.23, 0.18, STONE);
    box(gp, 0.04, 0.66, 0.3, -0.34, 0.33, -0.28, [0.26, 0.16, 0.09]);
    box(gp, 0.04, 0.66, 0.3, 0.34, 0.33, -0.28, [0.26, 0.16, 0.09]);
    gateMesh = instanced(mergeParts(gp), mat, Math.max(1, gates.length), false);

    // the well, in metres: a kerb of eight dressed stones, dark water inside,
    // two posts, a windlass and a little gabled roof
    const eg = [];
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      const st = new THREE.BoxGeometry(0.56, 0.72, 0.3);
      part(eg, st, Math.sin(a) * 0.72, 0.36, Math.cos(a) * 0.72, k & 1 ? STONE : [STONE[0] * 0.9, STONE[1] * 0.9, STONE[2] * 0.88], 0, a);
    }
    part(eg, new THREE.CircleGeometry(0.62, 10), 0, 0.5, 0, [0.07, 0.11, 0.13], -Math.PI / 2);
    box(eg, 0.13, 2.0, 0.13, -0.78, 1.0, 0, [0.3, 0.2, 0.11]);
    box(eg, 0.13, 2.0, 0.13, 0.78, 1.0, 0, [0.3, 0.2, 0.11]);
    const wl = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 6); wl.rotateZ(Math.PI / 2); wl.translate(0, 1.55, 0);
    eg.push({ geo: wl, color: [0.36, 0.25, 0.13] });
    const rf = new THREE.BoxGeometry(1.95, 0.07, 0.8); rf.rotateX(0.55); rf.translate(0, 2.12, 0.3);
    eg.push({ geo: rf, color: [0.4, 0.27, 0.15] });
    const rb = new THREE.BoxGeometry(1.95, 0.07, 0.8); rb.rotateX(-0.55); rb.translate(0, 2.12, -0.3);
    eg.push({ geo: rb, color: [0.36, 0.24, 0.13] });
    wellMesh = instanced(mergeParts(eg), mat, Math.max(1, wells.length), false);

    buildTownField();
    paintRoads();
  }
  /* THE GROUND A TOWN STANDS ON, as data the terrain shader reads: per tile,
     the offset from the tile centre to the nearest town centre (x and y at
     12 bits over +-12 tiles: R/G the high 8 bits, A the two low nibbles) and
     that town's ground radius (B, tiles). Sampled NEAREST and turned back
     into an exact vector in the shader, so a square 0.1 tile across is round
     at any zoom; linear filtering would average offsets of two towns into a
     phantom patch on the line between them. */
  let townTex = null;
  function buildTownField() {
    const w = M.w, h = M.h, N = w * h;
    const d = new Uint8Array(N * 4);
    const best = new Float32Array(N).fill(1e9), who = new Int32Array(N).fill(-1);
    for (let t = 0; t < M.towns.length; t++) {
      const T = M.towns[t];
      const x0 = Math.max(0, Math.floor(T.x - 11)), x1 = Math.min(w - 1, Math.ceil(T.x + 11));
      const y0 = Math.max(0, Math.floor(T.y - 11)), y1 = Math.min(h - 1, Math.ceil(T.y + 11));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = x + y * w;
        // nearest by distance relative to size, so a big town is not cut by a small neighbour
        const dd = Math.hypot(x + 0.5 - T.x, y + 0.5 - T.y) - T._groundR;
        if (dd < best[i]) { best[i] = dd; who[i] = t; }
      }
    }
    for (let i = 0; i < N; i++) {
      const t = who[i];
      if (t < 0) continue;
      const T = M.towns[t], x = i % w, y = (i / w) | 0;
      const qx = Math.round(clamp((T.x - (x + 0.5) + 12) / 24, 0, 1) * 4095);
      const qy = Math.round(clamp((T.y - (y + 0.5) + 12) / 24, 0, 1) * 4095);
      d[i * 4] = qx >> 4; d[i * 4 + 1] = qy >> 4;
      d[i * 4 + 2] = Math.round(clamp(T._groundR, 0, 1) * 255);
      d[i * 4 + 3] = ((qx & 15) << 4) | (qy & 15);
    }
    townTex = track(new THREE.DataTexture(d, w, h, THREE.RGBAFormat));
    townTex.magFilter = townTex.minFilter = THREE.NearestFilter;
    townTex.generateMipmaps = false; townTex.flipY = false; townTex.needsUpdate = true;
    if (terrainMat) terrainMat.uniforms.uTown.value = townTex;
  }
  /* TRACKS BETWEEN TOWNS, baked into the painted ground: every town to its
     two nearest neighbours over land, a worn double line (dark rut under a
     pale surface) that wanders a little, never across water. */
  function paintRoads() {
    const cv = V._bakeCanvas;
    if (!cv || M.towns.length < 2) return;
    const cx = cv.getContext("2d"), s = bakeScale, w = M.w, h = M.h;
    const maxD = Math.max(6, 0.09 * Math.max(w, h));
    const done = new Set(), roads = [];
    function landOk(x, y) {
      const i = clamp(x | 0, 0, w - 1) + clamp(y | 0, 0, h - 1) * w;
      return landF[i] > 0.5;
    }
    for (let a = 0; a < M.towns.length; a++) {
      const A = M.towns[a];
      const near = [];
      for (let b = 0; b < M.towns.length; b++) {
        if (b === a) continue;
        const B = M.towns[b], dd = Math.hypot(B.x - A.x, B.y - A.y);
        if (dd < maxD) near.push([dd, b]);
      }
      near.sort(function (p, q) { return p[0] - q[0]; });
      for (let k = 0; k < Math.min(2, near.length); k++) {
        const b = near[k][1], key = a < b ? a + ":" + b : b + ":" + a;
        if (done.has(key)) continue;
        done.add(key);
        const B = M.towns[b], L = near[k][0];
        const bend = (hash2(a, b, 5) - 0.5) * 0.3 * L;
        const nx = -(B.y - A.y) / L, ny = (B.x - A.x) / L;
        const mx = (A.x + B.x) / 2 + nx * bend, my = (A.y + B.y) / 2 + ny * bend;
        let ok = true;
        for (let q = 0; q <= 1.0001 && ok; q += 0.35 / L) {
          const u = 1 - q;
          const px = u * u * A.x + 2 * u * q * mx + q * q * B.x, py = u * u * A.y + 2 * u * q * my + q * q * B.y;
          if (!landOk(px, py)) ok = false;
        }
        if (ok) roads.push([A.x, A.y, mx, my, B.x, B.y]);
      }
    }
    cx.save();
    cx.lineCap = "round"; cx.lineJoin = "round";
    for (let pass = 0; pass < 2; pass++) {
      cx.strokeStyle = pass ? "rgba(178,154,112,0.5)" : "rgba(70,56,38,0.22)";
      cx.lineWidth = Math.max(pass ? 0.7 : 1.3, s * (pass ? 0.12 : 0.26));
      for (const r of roads) {
        cx.beginPath();
        cx.moveTo(r[0] * s, r[1] * s);
        cx.quadraticCurveTo(r[2] * s, r[3] * s, r[4] * s, r[5] * s);
        cx.stroke();
      }
    }
    cx.restore();
    V.roadCount = roads.length;
    if (baseTex) baseTex.needsUpdate = true;
  }
  let tmpObj = null;
  function layoutTowns(Z) {
    const o = tmpObj;
    for (let k = 0; k < HOUSE_KINDS.length; k++) {
      const L = townItems.kinds[k], mesh = houseMeshes[k];
      for (let i = 0; i < L.length; i++) {
        const it = L[i], T = M.towns[it.t];
        const tx = T.x + it.ox * Z, ty = T.y + it.oz * Z;
        o.position.set(wx(tx), groundY(tx, ty) - 0.004 * Z, wz(ty));
        o.rotation.set(0, it.rot, 0);
        o.scale.setScalar(HUT * it.s * Z);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      }
      mesh.count = L.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    function lay(L, mesh, sx, sy, sz, sink) {
      for (let i = 0; i < L.length; i++) {
        const it = L[i], T = M.towns[it.t];
        const tx = T.x + it.ox * Z, ty = T.y + it.oz * Z;
        o.position.set(wx(tx), groundY(tx, ty) - sink * Z, wz(ty));
        o.rotation.set(0, it.rot || 0, 0);
        o.scale.set((it.len || 1) * sx * Z, sy * Z, sz * Z);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      }
      mesh.count = L.length; mesh.instanceMatrix.needsUpdate = true;
    }
    lay(townItems.walls, wallMesh, 1, 0.07, 0.022, 0.005);
    lay(townItems.towers, towerMesh, 0.052, 0.1, 0.052, 0.005);
    lay(townItems.gates, gateMesh, 0.07, 0.07, 0.07, 0.005);
    lay(townItems.wells, wellMesh, HUT, HUT, HUT, 0.002);
    if (terrainMat) terrainMat.uniforms.uTownZ.value = Z;
  }

  /* ================================================================ BANNERS
     Towns and armies share one set, two draw calls: the staff (pole, a
     crossbar, a spear-point finial) and the cloth, a vexillum hanging from
     the crossbar with a darker painted border and a scalloped fringe. The
     cloth is a real subdivided sheet and it ripples in the vertex shader,
     phase taken off each instance's own position, so no two flags beat
     together. Both face the camera, the way a painter sets a standard. */
  let poleMesh = null, clothMesh = null, bannerN = 0;
  const clothTime = { value: 0 };
  const CLOTH_W = 0.46, CLOTH_H = 0.34, BAR_Y = 0.93;
  function buildBanners(cap) {
    const pg = [];
    const wood = [0.3, 0.2, 0.11], brass = [0.62, 0.48, 0.2];
    part(pg, new THREE.CylinderGeometry(0.016, 0.022, BAR_Y + 0.02, 6), 0, (BAR_Y + 0.02) / 2, 0, wood);
    const bar = new THREE.CylinderGeometry(0.011, 0.011, CLOTH_W + 0.06, 5); bar.rotateZ(Math.PI / 2); bar.translate(0, BAR_Y, 0.004);
    pg.push({ geo: bar, color: wood });
    part(pg, new THREE.SphereGeometry(0.02, 5, 3), -(CLOTH_W / 2 + 0.03), BAR_Y, 0.004, brass);
    part(pg, new THREE.SphereGeometry(0.02, 5, 3), CLOTH_W / 2 + 0.03, BAR_Y, 0.004, brass);
    part(pg, new THREE.ConeGeometry(0.026, 0.1, 4), 0, BAR_Y + 0.07, 0, brass);
    poleMesh = instanced(mergeParts(pg), vcMat(), cap, false);

    // the cloth: top edge on y = 0 (the crossbar), hanging to -CLOTH_H
    const cg = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, 10, 5);
    cg.translate(0, -CLOTH_H / 2, 0.012);
    const P = cg.attributes.position, col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i);
      const u = x / CLOTH_W + 0.5, v = -y / CLOTH_H;
      // the bottom edge is a fringe of shallow points
      if (v > 0.99) P.setY(i, y - 0.028 * Math.abs(Math.sin(u * Math.PI * 5)));
      // it sags between the bar's ends and bellies a little at rest
      P.setZ(i, P.getZ(i) + Math.sin(u * Math.PI) * 0.012 * v);
      const border = u < 0.09 || u > 0.91 || v > 0.84 || v < 0.06;
      const k = border ? 0.6 : 1;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    cg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    cg.computeVertexNormals();
    track(cg);
    const cm = track(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    cm.onBeforeCompile = function (sh) {
      sh.uniforms.uClothT = clothTime;
      sh.vertexShader = "uniform float uClothT;\n" + sh.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\n" +
        "float hang=clamp(-position.y/" + CLOTH_H.toFixed(3) + ",0.0,1.2);\n" +
        "float ph=0.0;\n#ifdef USE_INSTANCING\nph=instanceMatrix[3].x*3.1+instanceMatrix[3].z*1.7;\n#endif\n" +
        "transformed.z+=(sin(position.x*15.0-uClothT*3.3+ph)*0.022+sin(uClothT*1.2+ph)*0.03)*hang;\n" +
        "transformed.x+=sin(uClothT*0.9+ph*1.3)*0.012*hang;");
    };
    clothMesh = instanced(cg, cm, cap, true);
  }
  function putBanner(x, y, z, hgt, css, phase, t) {
    if (bannerN >= poleMesh.instanceMatrix.count) return;
    const o = tmpObj, face = cam.yaw;
    o.position.set(x, y, z); o.rotation.set(0, face, 0, "YXZ"); o.scale.set(hgt, hgt, hgt); o.updateMatrix();
    poleMesh.setMatrixAt(bannerN, o.matrix);
    o.position.set(x, y + BAR_Y * hgt, z);
    o.rotation.set(Math.sin(t * 1.3 + phase) * 0.08, face + Math.sin(t * 0.7 + phase) * 0.08, 0, "YXZ");
    o.updateMatrix();
    clothMesh.setMatrixAt(bannerN, o.matrix);
    clothMesh.setColorAt(bannerN, linColour(css, 0.9));
    bannerN++;
  }

  /* ================================================================ ARMIES
     A regiment is a painted stand with its men glued on in ranks, front
     rank toward the march, and its standard planted at the back corner. */
  const MAXFIG = 4200, MAXSTAND = 1400;
  let clothFig = null, kitFig = null, standMesh = null, figN = 0, standN = 0;
  const vis = new Map();         // army id -> {x,y,fx,fy,tx,ty,yaw,moving,br,top}
  function figuresFor(men) {
    return men < 800 ? 2 : men < 2500 ? 3 : men < 6000 ? 4 : men < 12000 ? 6 : men < 25000 ? 8 : men < 50000 ? 9 : 12;
  }
  const FILE_S = 0.36, RANK_S = 0.42;
  function putFigure(x, y, z, yaw, f, css) {
    if (figN >= MAXFIG) return;
    const o = tmpObj;
    o.position.set(x, y, z); o.rotation.set(0, yaw, 0); o.scale.setScalar(f / 1.8); o.updateMatrix();
    clothFig.setMatrixAt(figN, o.matrix);
    kitFig.setMatrixAt(figN, o.matrix);
    clothFig.setColorAt(figN, linColour(css, 1));
    figN++;
  }
  function putStand(x, y, z, yaw, bw, bd, hgt, pitch, roll) {
    if (standN >= MAXSTAND) return;
    const o = tmpObj;
    o.position.set(x, y, z); o.rotation.set(pitch, yaw, roll, "YXZ"); o.scale.set(bw, hgt, bd); o.updateMatrix();
    standMesh.setMatrixAt(standN++, o.matrix);
  }

  /* ================================================================ MARKERS */
  let ringPool = [], swordsTex = null, smokeTex = null, swordPool = [], smokePool = [];
  /* The selection mark is a thin raised hoop round the stand, depth-tested
     like anything else on the table: it hides behind a hill instead of
     painting through it, and it never lies flat on the ground to z-fight. */
  let ringGeo = null, ringMat = null;
  function makeRing() {
    if (!ringGeo) {
      ringGeo = track(new THREE.TorusGeometry(1, 0.035, 4, 48));
      ringGeo.rotateX(-Math.PI / 2);
      ringMat = track(new THREE.MeshBasicMaterial({ color: 0xffa060, transparent: true, opacity: 0.95, depthWrite: false }));
      ringMat.toneMapped = false;
    }
    const r = new THREE.Mesh(ringGeo, ringMat);
    r.renderOrder = 20; r.visible = false; r.frustumCulled = false;
    root.add(r);
    return r;
  }
  function canvasTex(size, draw) {
    const c = document.createElement("canvas"); c.width = c.height = size;
    draw(c.getContext("2d"), size);
    const t = track(new THREE.CanvasTexture(c));
    return t;
  }
  function buildMarkers() {
    // CROSSED SWORDS, the cartographer's battle mark: two short blades with a
    // fuller, a brass guard, a bound grip and a pommel, inked round in black
    // so they read on sand and on sea without a token disc behind them
    swordsTex = canvasTex(128, function (x, s) {
      x.translate(s / 2, s / 2);
      x.shadowColor = "rgba(0,0,0,0.85)"; x.shadowBlur = 6;
      for (let k = 0; k < 2; k++) {
        x.save(); x.rotate(k ? Math.PI / 4 : -Math.PI / 4);
        x.lineJoin = "round";
        x.strokeStyle = "#140d08"; x.lineWidth = 3;
        x.beginPath(); x.moveTo(-5.5, 18); x.lineTo(-5.5, -36); x.quadraticCurveTo(-5, -44, 0, -52); x.quadraticCurveTo(5, -44, 5.5, -36); x.lineTo(5.5, 18); x.closePath();
        x.fillStyle = "#e9e4d8"; x.fill(); x.stroke();
        x.shadowBlur = 0;
        x.strokeStyle = "rgba(120,112,100,0.9)"; x.lineWidth = 1.5;
        x.beginPath(); x.moveTo(0, 14); x.lineTo(0, -40); x.stroke();
        x.strokeStyle = "#140d08"; x.lineWidth = 2;
        x.fillStyle = "#c29a3e";
        x.beginPath(); x.moveTo(-16, 18); x.lineTo(16, 18); x.lineTo(13, 25); x.lineTo(-13, 25); x.closePath(); x.fill(); x.stroke();
        x.fillStyle = "#4a2e17"; x.fillRect(-3.5, 25, 7, 16); x.strokeRect(-3.5, 25, 7, 16);
        x.fillStyle = "#6b4a24";
        for (let b = 0; b < 3; b++) x.fillRect(-3.5, 28 + b * 4.5, 7, 1.6);
        x.fillStyle = "#c29a3e"; x.beginPath(); x.arc(0, 45, 5, 0, Math.PI * 2); x.fill(); x.stroke();
        x.restore();
      }
    });
    // DUST AND SMOKE: a lumpy cloud of overlapping soft puffs in dusty grey,
    // not a perfect radial ball (which reads as a glowing light)
    smokeTex = canvasTex(64, function (x, s) {
      const rr = mulberry(9);
      for (let k = 0; k < 9; k++) {
        const a = rr() * Math.PI * 2, d = rr() * s * 0.16;
        const cx = s / 2 + Math.cos(a) * d, cy = s / 2 + Math.sin(a) * d, r = s * (0.16 + rr() * 0.14);
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        const l = 150 + (rr() * 40 | 0);
        g.addColorStop(0, "rgba(" + l + "," + (l - 8) + "," + (l - 20) + ",0.5)");
        g.addColorStop(1, "rgba(" + l + "," + (l - 8) + "," + (l - 20) + ",0)");
        x.fillStyle = g; x.fillRect(0, 0, s, s);
      }
    });
  }
  function getSword(i) {
    while (swordPool.length <= i) {
      const m = track(new THREE.SpriteMaterial({ map: swordsTex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }));
      m.toneMapped = false;
      const s = new THREE.Sprite(m);
      s.renderOrder = 30; s.frustumCulled = false; s.scale.set(0.046, 0.046, 1);
      root.add(s); swordPool.push(s);
    }
    return swordPool[i];
  }
  function getSmoke(i) {
    while (smokePool.length <= i) {
      const m = track(new THREE.SpriteMaterial({ map: smokeTex, depthWrite: false, transparent: true, opacity: 0.5 }));
      m.toneMapped = false;
      const s = new THREE.Sprite(m);
      s.renderOrder = 15; s.frustumCulled = false;
      root.add(s); smokePool.push(s);
    }
    return smokePool[i];
  }

  /* ---------------------------------------------------------------- ribbons (routes) */
  let ribbonMat = null, previewMat = null, previewMesh = null, pathMeshes = [];
  function ribbonGeometry(tiles, width) {
    if (!tiles || tiles.length < 2) return null;
    let pts = tiles.map(function (t) { const x = t % M.w + 0.5, y = ((t / M.w) | 0) + 0.5; return [x, y]; });
    for (let it = 0; it < 2; it++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    const n = pts.length;
    const pos = new Float32Array(n * 2 * 3), len = new Float32Array(n * 2), side = new Float32Array(n * 2);
    let acc = 0;
    const lift = width * 0.6;
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      const nx = -dy * width / 2, ny = dx * width / 2;
      for (let s = 0; s < 2; s++) {
        const sx = p[0] + (s ? nx : -nx), sy = p[1] + (s ? ny : -ny);
        const k = i * 2 + s;
        pos[k * 3] = wx(sx); pos[k * 3 + 1] = groundY(sx, sy) + lift; pos[k * 3 + 2] = wz(sy);
        len[k] = acc; side[k] = s;
      }
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    // the arrowhead: a centre vertex at the route's end, two barbs, a tip; the
    // centre carries aHead 1 and the rim 0.6, so it is inked round its edge
    const e = pts[n - 1], q = pts[Math.max(0, n - 3)];
    let hx = e[0] - q[0], hy = e[1] - q[1];
    const hl = Math.hypot(hx, hy) || 1; hx /= hl; hy /= hl;
    const HW = width * 1.25, HL = width * 2.2;
    const hp = [[e[0] - hx * HL * 0.35, e[1] - hy * HL * 0.35], [e[0] - hx * HL * 0.55 - hy * HW, e[1] - hy * HL * 0.55 + hx * HW],
                [e[0] + hx * HL * 0.45, e[1] + hy * HL * 0.45], [e[0] - hx * HL * 0.55 + hy * HW, e[1] - hy * HL * 0.55 - hx * HW]];
    const P2 = new Float32Array(pos.length + 12), L2 = new Float32Array(len.length + 4), S2 = new Float32Array(side.length + 4), H2 = new Float32Array(len.length + 4);
    P2.set(pos); L2.set(len); S2.set(side);
    const b0 = n * 2;
    for (let k = 0; k < 4; k++) {
      const p = hp[k];
      P2[(b0 + k) * 3] = wx(p[0]); P2[(b0 + k) * 3 + 1] = groundY(p[0], p[1]) + lift * 1.05; P2[(b0 + k) * 3 + 2] = wz(p[1]);
      L2[b0 + k] = acc; S2[b0 + k] = 0.5; H2[b0 + k] = k === 0 ? 1 : 0.6;
    }
    idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P2, 3));
    g.setAttribute("aLen", new THREE.BufferAttribute(L2, 1));
    g.setAttribute("aSide", new THREE.BufferAttribute(S2, 1));
    g.setAttribute("aHead", new THREE.BufferAttribute(H2, 1));
    g.setIndex(idx);
    return g;
  }
  function ribbonMaterial(hex, op) {
    const m = track(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(hex) }, uTime: { value: 0 }, uDash: { value: 1 }, uOp: { value: op } },
      vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.toneMapped = false;
    return m;
  }
  function setRibbon(mesh, tiles, width, mat) {
    if (mesh && mesh.geometry) mesh.geometry.dispose();
    const g = ribbonGeometry(tiles, width);
    if (!g) { if (mesh) { root.remove(mesh); } return null; }
    if (!mesh) { mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 25; mesh.frustumCulled = false; root.add(mesh); }
    else mesh.geometry = g;
    return mesh;
  }

  /* ================================================================ CAMERA */
  const cam = { tx: 0, tz: 0, dist: 100, yaw: 0, pitch: 0.95, gtx: 0, gtz: 0, gdist: 100, gyaw: 0, gpitch: 0.95, dmin: 5, dmax: 400 };
  const FOV = 42;
  let FOG = [0.62, 0.66, 0.66];
  function camLimits() {
    const c = CBZ.camera;
    const t = Math.tan(FOV / 2 * Math.PI / 180);
    const asp = c ? c.aspect : 1.6;
    cam.dmax = Math.max(M.h / (2 * t), M.w / (asp * 2 * t)) * 1.02;
    cam.dmin = Math.max(3.2, Math.max(M.w, M.h) * 0.011);
  }
  function effPitch(p, d) {
    const k = smooth(cam.dmax * 0.4, cam.dmax, d);
    return p + (1.42 - p) * k;
  }
  function applyCamera(dt) {
    const c = CBZ.camera;
    const a = 1 - Math.exp(-dt * 11);
    cam.tx += (cam.gtx - cam.tx) * a; cam.tz += (cam.gtz - cam.tz) * a;
    cam.dist += (cam.gdist - cam.dist) * a;
    cam.yaw += (cam.gyaw - cam.yaw) * a; cam.pitch += (cam.gpitch - cam.pitch) * a;
    const p = effPitch(cam.pitch, cam.dist);
    const ty = Math.max(0, yAt(cam.tx + M.w / 2, cam.tz + M.h / 2)) * 0.7;
    const hz = cam.dist * Math.cos(p);
    c.position.set(cam.tx + Math.sin(cam.yaw) * hz, ty + cam.dist * Math.sin(p), cam.tz + Math.cos(cam.yaw) * hz);
    c.up.set(0, 1, 0);
    c.lookAt(cam.tx, ty, cam.tz);
    const near = Math.max(0.05, cam.dist * 0.02), far = cam.dist * 5 + Math.max(M.w, M.h) * 2;
    if (Math.abs(c.near - near) > near * 0.05 || Math.abs(c.far - far) > far * 0.05 || c.fov !== FOV) {
      c.near = near; c.far = far; c.fov = FOV; c.updateProjectionMatrix();
    }
    c.updateMatrixWorld();
    // fog: a horizon haze, never over what you are looking at
    const fn = cam.dist * 1.6 + 20, ff = cam.dist * 4.2 + Math.max(M.w, M.h) * 0.9;
    terrainMat.uniforms.uFogR.value.set(fn, ff);
    seaMat.uniforms.uFogR.value.set(fn, ff);
  }
  function clampGoal() {
    cam.gtx = clamp(cam.gtx, -M.w / 2, M.w / 2);
    cam.gtz = clamp(cam.gtz, -M.h / 2, M.h / 2);
    cam.gdist = clamp(cam.gdist, cam.dmin, cam.dmax);
    cam.gpitch = clamp(cam.gpitch, 0.55, 1.4);
  }
  function ppu() {
    const c = CBZ.camera;
    return (window.innerHeight || 800) / (2 * cam.dist * Math.tan(FOV / 2 * Math.PI / 180));
  }
  V.ppu = function () { return mounted ? ppu() : 1; };

  /* ---------------------------------------------------------------- ray -> ground */
  let ray = null;
  function groundHit(cx, cy) {
    const c = CBZ.camera;
    const ndc = new THREE.Vector2(cx / window.innerWidth * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, c);
    const o = ray.ray.origin, d = ray.ray.direction;
    const maxT = cam.dist * 8 + Math.max(M.w, M.h) * 2;
    let st = Math.max(0.02, cam.dist * 0.006);
    let t = 0, prevT = 0;
    const hAt = function (tt) {
      const x = o.x + d.x * tt, z = o.z + d.z * tt, y = o.y + d.y * tt;
      return y - groundY(x + M.w / 2, z + M.h / 2);
    };
    let prev = hAt(0);
    for (let i = 0; i < 2400 && t < maxT; i++) {
      prevT = t; t += st;
      const v = hAt(t);
      if (v <= 0) {
        let lo = prevT, hi = t;
        for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (hAt(m) > 0) lo = m; else hi = m; }
        const tt = (lo + hi) / 2;
        return { x: o.x + d.x * tt, z: o.z + d.z * tt, y: o.y + d.y * tt };
      }
      prev = v;
      st *= 1.004;
    }
    // missed the terrain (looking at the horizon): the sea plane
    if (d.y < 0) { const tt = -o.y / d.y; return { x: o.x + d.x * tt, z: o.z + d.z * tt, y: 0 }; }
    return null;
  }

  /* ---------------------------------------------------------------- input */
  const ptrs = new Map();
  let drag = null, lastHoverT = 0, canvasEl = null;
  function planeAt(cx, cy, yPlane) {
    const c = CBZ.camera;
    ray.setFromCamera(new THREE.Vector2(cx / window.innerWidth * 2 - 1, -(cy / window.innerHeight) * 2 + 1), c);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (Math.abs(d.y) < 1e-4) return null;
    const t = (yPlane - o.y) / d.y;
    if (t < 0) return null;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }
  function onDown(e) {
    if (!mounted || hidden) return;
    canvasEl.setPointerCapture && canvasEl.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), button: e.button, type: e.pointerType });
    if (ptrs.size === 1) {
      const gy = Math.max(0, yAt(cam.tx + M.w / 2, cam.tz + M.h / 2)) * 0.7;
      drag = { mode: e.button === 2 || e.button === 1 ? "rot" : (e.shiftKey && e.pointerType === "mouse" ? "box" : "pan"), moved: false, plane: gy, shift: e.shiftKey };
    } else if (ptrs.size === 2) {
      const a = Array.from(ptrs.values());
      drag = { mode: "two", moved: true, d0: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), ang0: Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x),
               mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2, dist0: cam.gdist, yaw0: cam.gyaw, pitch0: cam.gpitch };
    }
    e.preventDefault();
  }
  function onMove(e) {
    if (!mounted || hidden) return;
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse") {
        const now = performance.now();
        if (now - lastHoverT > 45) { lastHoverT = now; fire("hover", { x: e.clientX, y: e.clientY }); }
      }
      return;
    }
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!drag) return;
    if (!drag.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > 7) drag.moved = true;
    if (!drag.moved) return;
    if (drag.mode === "pan") {
      const a = planeAt(px, py, drag.plane), b = planeAt(p.x, p.y, drag.plane);
      if (a && b) { cam.gtx += a.x - b.x; cam.gtz += a.z - b.z; cam.tx += a.x - b.x; cam.tz += a.z - b.z; clampGoal(); }
    } else if (drag.mode === "rot") {
      cam.gyaw -= (p.x - px) * 0.006;
      cam.gpitch += (p.y - py) * 0.004;
      clampGoal();
    } else if (drag.mode === "box") {
      showBox(p.x0, p.y0, p.x, p.y);
    } else if (drag.mode === "two" && ptrs.size >= 2) {
      const a = Array.from(ptrs.values());
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      const ang = Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x);
      const mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
      cam.gdist = drag.dist0 * drag.d0 / Math.max(10, d);
      cam.gyaw = drag.yaw0 - (ang - drag.ang0);
      // both fingers moving together vertically: tilt
      cam.gpitch = drag.pitch0 + (my - drag.my) * 0.004;
      // and together sideways: pan
      const pa = planeAt(drag.mx, drag.my, 0), pb = planeAt(mx, drag.my, 0);
      if (pa && pb) { cam.gtx += pa.x - pb.x; cam.gtz += pa.z - pb.z; }
      drag.mx = mx;
      clampGoal();
    }
  }
  function onUp(e) {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (!mounted || hidden || !p || !drag) { if (!ptrs.size) drag = null; return; }
    if (drag.mode === "box" && drag.moved) {
      hideBox();
      const x0 = Math.min(p.x0, p.x), x1 = Math.max(p.x0, p.x), y0 = Math.min(p.y0, p.y), y1 = Math.max(p.y0, p.y);
      const ids = [];
      for (const a of G.armies) {
        const s = screenOfArmy(a);
        if (s && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) ids.push(a.id);
      }
      fire("box", { ids: ids });
    } else if (!drag.moved && drag.mode !== "two" && performance.now() - p.t0 < 650) {
      fire("tap", { x: p.x, y: p.y, shift: !!e.shiftKey || drag.shift, button: p.button, touch: p.type !== "mouse" });
    }
    if (!ptrs.size) drag = null;
    else if (ptrs.size === 1) drag = { mode: "pan", moved: true, plane: 0 };
  }
  function onWheel(e) {
    if (!mounted || hidden) return;
    e.preventDefault();
    const k = Math.exp(clamp(e.deltaY, -240, 240) * (e.ctrlKey ? 0.01 : 0.0016));
    const h = groundHit(e.clientX, e.clientY);
    const nd = clamp(cam.gdist * k, cam.dmin, cam.dmax);
    const f = nd / cam.gdist;
    if (h) {
      cam.gtx = h.x + (cam.gtx - h.x) * f;
      cam.gtz = h.z + (cam.gtz - h.z) * f;
    }
    cam.gdist = nd;
    clampGoal();
  }
  function onCtx(e) { if (mounted && !hidden) e.preventDefault(); }
  const keys = {};
  function onKey(e) {
    if (!mounted || hidden) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    keys[e.code] = e.type === "keydown";
  }
  function keyPan(dt) {
    let fx = 0, fz = 0, r = 0;
    if (keys.KeyW || keys.ArrowUp) fz -= 1;
    if (keys.KeyS || keys.ArrowDown) fz += 1;
    if (keys.KeyA || keys.ArrowLeft) fx -= 1;
    if (keys.KeyD || keys.ArrowRight) fx += 1;
    if (keys.KeyQ) r += 1;
    if (keys.KeyE) r -= 1;
    if (!fx && !fz && !r) return;
    const sp = cam.gdist * 0.9 * dt;
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    cam.gtx += (fx * c + fz * s) * sp;
    cam.gtz += (-fx * s + fz * c) * sp;
    cam.gyaw += r * dt * 1.4;
    clampGoal();
  }
  function showBox(x0, y0, x1, y1) {
    if (!boxEl) return;
    boxEl.style.display = "block";
    boxEl.style.left = Math.min(x0, x1) + "px"; boxEl.style.top = Math.min(y0, y1) + "px";
    boxEl.style.width = Math.abs(x1 - x0) + "px"; boxEl.style.height = Math.abs(y1 - y0) + "px";
  }
  function hideBox() { if (boxEl) boxEl.style.display = "none"; }

  /* ================================================================ OVERLAY (HTML labels) */
  const CSS = `
  #warOverlay{position:fixed;inset:0;pointer-events:none;z-index:30;overflow:hidden;contain:strict}
  #warOverlay .wvT{position:absolute;left:0;top:0;white-space:nowrap;text-align:center;
    font-family:"Cinzel","Cormorant SC",Georgia,"Times New Roman",serif;font-weight:700;color:#f6eed8;
    letter-spacing:.06em;text-shadow:0 1px 2px #000,0 0 6px rgba(0,0,0,.85),0 0 1px #000;will-change:transform;line-height:1.05}
  #warOverlay .wvT.cap{letter-spacing:.14em}
  #warOverlay .wvT small{display:block;font:700 10px/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;opacity:.85;margin-top:1px}
  #warOverlay .wvT i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:1px;box-shadow:0 0 0 1px rgba(0,0,0,.7)}
  #warOverlay .wvA{position:absolute;left:0;top:0;white-space:nowrap;display:flex;align-items:center;gap:0;
    font:800 11px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;letter-spacing:.03em;color:#f6efe0;
    background:rgba(14,11,8,.82);border:1px solid rgba(255,255,255,.22);border-radius:4px;overflow:hidden;will-change:transform;
    font-variant-numeric:tabular-nums;box-shadow:0 1px 3px rgba(0,0,0,.6)}
  #warOverlay .wvA i{align-self:stretch;width:5px;display:block}
  #warOverlay .wvA b{padding:3px 5px 3px 4px}
  #warOverlay .wvA.sel{border-color:#ff8a3d;box-shadow:0 0 0 1px #ff8a3d,0 1px 3px rgba(0,0,0,.6)}
  #warOverlay .wvA.cut{border-color:#e05a4a}
  #warOverlay .wvA.cut b{color:#ff9d8f}
  #warOverlay .wvA.far b{display:none}
  #warOverlay .wvA.gar{border-style:dashed}
  #warOverlay .wvB{position:absolute;left:0;top:0;white-space:nowrap;font:800 11px/1 ui-sans-serif,system-ui,sans-serif;
    background:rgba(14,11,8,.86);border:1px solid #ff8a3d;border-radius:4px;padding:3px 6px;color:#f6efe0;will-change:transform;
    font-variant-numeric:tabular-nums}
  #warOverlay .wvB em{font-style:normal;opacity:.6;margin:0 4px}
  #warBox{position:fixed;border:1px solid #ff8a3d;background:rgba(255,138,61,.12);pointer-events:none;z-index:31;display:none}
  `;
  let townEls = [], armyEls = new Map(), battleEls = new Map();
  function buildOverlay() {
    if (!document.getElementById("warViewCss")) {
      const st = document.createElement("style"); st.id = "warViewCss"; st.textContent = CSS; document.head.appendChild(st);
    }
    overlay = document.createElement("div"); overlay.id = "warOverlay";
    document.body.appendChild(overlay);
    boxEl = document.createElement("div"); boxEl.id = "warBox"; document.body.appendChild(boxEl);
    townEls = M.towns.map(function (T) {
      const e = document.createElement("div");
      e.className = "wvT" + (T.capital ? " cap" : "");
      const px = clamp(9 + Math.log10(Math.max(1000, T.pop)) * 1.9, 11, 20) + (T.capital ? 1 : 0);
      e.style.fontSize = px.toFixed(1) + "px";
      e.innerHTML = '<i></i><span></span><small></small>';
      e.children[1].textContent = T.capital ? String(T.name).toUpperCase() : T.name;
      e.style.display = "none";
      overlay.appendChild(e);
      return { el: e, dot: e.children[0], sub: e.children[2], shown: false, x: -1, y: -1, w: String(T.name).length * px * 0.66 + 14, h: px + 4, sub$: "", dot$: "" };
    });
  }
  const _v3 = { x: 0, y: 0, z: 0 };
  let projV = null;
  function project(x, y, z) {
    projV.set(x, y, z).project(CBZ.camera);
    if (projV.z > 1 || projV.z < -1) return null;
    return { x: (projV.x + 1) / 2 * window.innerWidth, y: (1 - projV.y) / 2 * window.innerHeight };
  }
  function place(el, rec, x, y) {
    const rx = Math.round(x), ry = Math.round(y);
    if (rec.x !== rx || rec.y !== ry) { el.style.transform = "translate(" + rx + "px," + ry + "px) translate(-50%,-100%)"; rec.x = rx; rec.y = ry; }
  }
  function showEl(rec, on) { if (rec.shown !== on) { rec.el.style.display = on ? "" : "none"; rec.shown = on; } }

  /* ================================================================ STATE */
  let figScale = 0.2, townZ = 1, time = 0, dayFrac = 0, selected = [], selSet = new Set(), hiF = -1;
  let previewTiles = null, previewDirty = false, pathsDirty = true, lastPathScale = 0;
  const anims = [];              // town repaint spreads
  let firstFrame = false;
  V.selected = function () { return selected.slice(); };

  function screenOfArmy(a) {
    const v = vis.get(a.id);
    const x = v ? v.x : a.x, y = v ? v.y : a.y;
    return project(wx(x), groundY(x, y) + figScale * 1.4, wz(y));
  }

  /* ================================================================ MOUNT */
  V.mount = function (map, g) {
    if (mounted) V.unmount();
    THREE = G0.THREE;
    M = map; G = g;
    const scene = CBZ.scene, c = CBZ.camera, R = CBZ.renderer;
    tmpObj = new THREE.Object3D();
    projV = new THREE.Vector3();
    ray = new THREE.Raycaster();
    root = new THREE.Group(); root.name = "warMap";
    scene.add(root);
    const t0 = performance.now();
    buildLandField();
    buildHeight();
    buildTerrain();
    buildTowns();
    buildBanners(M.towns.length + 900);
    const mg = manGeos();
    const mat = vcMat();
    clothFig = instanced(mg.cloth, mat, MAXFIG, true);
    // its OWN material: r128 caches one program per material, and a program
    // built for the tinted cloth reads instanceColor, which the kit has not got
    kitFig = instanced(mg.kit, vcMat(), MAXFIG, false);
    standMesh = instanced(standGeo(), vcMat(), MAXSTAND, false);
    buildMarkers();
    ribbonMat = ribbonMaterial(0xf4e6c8, 0.85);
    previewMat = ribbonMaterial(0xff8a3d, 0.95);
    for (let i = 0; i < 8; i++) ringPool.push(makeRing());
    buildOverlay();
    V.buildMs = Math.round(performance.now() - t0);

    // take over the shared scene; every change is put back by hide()
    saved = {
      fog: scene.fog, bg: scene.background, dome: CBZ.micro && CBZ.micro.skyDome ? CBZ.micro.skyDome.visible : null,
      fov: c.fov, near: c.near, far: c.far, pos: c.position.clone(), quat: c.quaternion.clone(),
      shadow: R && R.shadowMap ? R.shadowMap.enabled : null, exposure: R ? R.toneMappingExposure : 1,
    };
    takeScene();
    canvasEl = (CBZ.micro && CBZ.micro.canvas) || (R && R.domElement);
    canvasEl.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    canvasEl.addEventListener("wheel", onWheel, { passive: false });
    canvasEl.addEventListener("contextmenu", onCtx);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", clearKeys);

    // day 0: clear the sim's dirty list (the owner texture was built from G.owner)
    if (WAR.sim && WAR.sim.takeDirty) WAR.sim.takeDirty(G);
    for (const a of G.armies) vis.set(a.id, { x: a.x, y: a.y, fx: a.x, fy: a.y, tx: a.x, ty: a.y, yaw: 0, moving: false });
    camLimits();
    const pf = G.player ? G.factions[G.player] : null;
    const capT = pf && pf.capital >= 0 ? M.towns[pf.capital] : null;
    if (capT) { cam.gtx = cam.tx = wx(capT.x); cam.gtz = cam.tz = wz(capT.y); }
    else { cam.gtx = cam.tx = 0; cam.gtz = cam.tz = 0; }
    cam.gdist = cam.dist = capT ? clamp(Math.max(M.w, M.h) * 0.2, cam.dmin * 3, cam.dmax) : cam.dmax * 0.9;
    cam.gyaw = cam.yaw = 0; cam.gpitch = cam.pitch = 0.98;
    mounted = true; hidden = false; firstFrame = false;
    anims.length = 0; selected = []; selSet = new Set(); previewTiles = null; pathsDirty = true;
    lastTownZ = -1; V._townOrder = null;
  };
  function clearKeys() { for (const k in keys) keys[k] = false; }
  function takeScene() {
    const scene = CBZ.scene, R = CBZ.renderer;
    scene.fog = null;
    scene.background = new THREE.Color(FOG[0], FOG[1], FOG[2]);
    if (CBZ.micro && CBZ.micro.skyDome) CBZ.micro.skyDome.visible = false;
    if (R && R.shadowMap) R.shadowMap.enabled = false;
    if (W.desert && W.desert.hide) try { W.desert.hide(); } catch (e) {}
    root.visible = true;
    if (overlay) overlay.style.display = "";
  }
  function giveScene() {
    if (!saved) return;
    const scene = CBZ.scene, c = CBZ.camera, R = CBZ.renderer;
    scene.fog = saved.fog; scene.background = saved.bg;
    if (CBZ.micro && CBZ.micro.skyDome && saved.dome != null) CBZ.micro.skyDome.visible = saved.dome;
    c.fov = saved.fov; c.near = saved.near; c.far = saved.far; c.position.copy(saved.pos); c.quaternion.copy(saved.quat);
    c.updateProjectionMatrix();
    if (R && R.shadowMap && saved.shadow != null) R.shadowMap.enabled = saved.shadow;
    if (root) root.visible = false;
    if (overlay) overlay.style.display = "none";
    hideBox();
  }
  V.hide = function () { if (!mounted || hidden) return; hidden = true; giveScene(); ptrs.clear(); drag = null; clearKeys(); };
  V.show = function () {
    if (!mounted || !hidden) return;
    const c = CBZ.camera, scene = CBZ.scene, R = CBZ.renderer;
    saved = { fog: scene.fog, bg: scene.background, dome: CBZ.micro && CBZ.micro.skyDome ? CBZ.micro.skyDome.visible : null,
              fov: c.fov, near: c.near, far: c.far, pos: c.position.clone(), quat: c.quaternion.clone(),
              shadow: R && R.shadowMap ? R.shadowMap.enabled : null };
    hidden = false; takeScene(); camLimits(); lastTownZ = -1; pathsDirty = true;
    for (const a of G.armies) { const v = vis.get(a.id); if (v) { v.fx = v.tx = v.x = a.x; v.fy = v.ty = v.y = a.y; } }
  };
  V.mounted = function () { return mounted; };
  V.visible = function () { return mounted && !hidden; };
  V.unmount = function () {
    if (!mounted) return;
    if (!hidden) giveScene();
    mounted = false; hidden = false;
    if (canvasEl) {
      canvasEl.removeEventListener("pointerdown", onDown);
      canvasEl.removeEventListener("wheel", onWheel);
      canvasEl.removeEventListener("contextmenu", onCtx);
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKey);
    window.removeEventListener("blur", clearKeys);
    if (root && root.parent) root.parent.remove(root);
    if (previewMesh && previewMesh.geometry) previewMesh.geometry.dispose();
    for (const p of pathMeshes) if (p && p.geometry) p.geometry.dispose();
    for (const d of disposables) { try { d.dispose(); } catch (e) {} }
    disposables.length = 0;
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (boxEl && boxEl.parentNode) boxEl.parentNode.removeChild(boxEl);
    overlay = null; boxEl = null; root = null; terrainMesh = seaMesh = null; houseMeshes = []; ringPool = []; swordPool = []; smokePool = [];
    ringGeo = ringMat = null; townTex = null; standMesh = wallMesh = towerMesh = gateMesh = wellMesh = null;
    previewMesh = null; pathMeshes = []; armyEls = new Map(); battleEls = new Map(); townEls = [];
    vis.clear(); anims.length = 0; ptrs.clear(); drag = null; saved = null;
    M = null; G = null;
  };

  /* ================================================================ EVENTS & TIME */
  V.onEvents = function (list) {
    if (!mounted) return;
    for (const e of list) {
      if (e.type === "town") {
        // repaint outward from the gate
        const L = G.catchTiles[e.town];
        if (L && L.length) anims.push({ town: e.town, L: L, k: 0, t: 0 });
      }
    }
  };
  V.dayTick = function () {
    if (!mounted) return;
    const alive = new Set();
    for (const a of G.armies) {
      alive.add(a.id);
      let v = vis.get(a.id);
      if (!v) {
        v = { x: a.x, y: a.y, fx: a.x, fy: a.y, tx: a.x, ty: a.y, yaw: 0, moving: false };
        // a garrison marching out comes out of its own gate
        if (a.home >= 0 && M.towns[a.home]) { v.x = v.fx = M.towns[a.home].x; v.y = v.fy = M.towns[a.home].y; }
        vis.set(a.id, v);
      }
      v.fx = v.x; v.fy = v.y; v.tx = a.x; v.ty = a.y;
      const dx = v.tx - v.fx, dy = v.ty - v.fy;
      v.moving = dx * dx + dy * dy > 1e-4;
      if (v.moving) v.yaw = Math.atan2(dx, dy);
    }
    for (const id of Array.from(vis.keys())) if (!alive.has(id)) vis.delete(id);
    pathsDirty = true;
  };
  function drainDirty() {
    const S = WAR.sim;
    if (!S || !S.takeDirty) return;
    const d = S.takeDirty(G);
    if (!d.length) return;
    const held = new Set();
    for (const an of anims) held.add(an.town);
    for (let k = 0; k < d.length; k++) {
      const i = d[k];
      const t = G.catchOf ? G.catchOf[i] : -1;
      if (t >= 0 && held.has(t)) continue;       // the spread will get there
      writeOwner(i, G.owner[i]);
    }
  }
  function stepAnims(dt) {
    for (let n = anims.length - 1; n >= 0; n--) {
      const an = anims[n];
      an.t += dt;
      const upto = Math.min(an.L.length, Math.ceil(an.L.length * Math.min(1, an.t / 0.8)));
      for (; an.k < upto; an.k++) { const i = an.L[an.k]; writeOwner(i, G.owner[i]); }
      if (an.k >= an.L.length) anims.splice(n, 1);
    }
  }

  /* ================================================================ FRAME */
  V.frame = function (dt, frac) {
    if (!mounted || hidden) return;
    time += dt;
    if (frac != null) dayFrac = clamp(frac, 0, 1);
    keyPan(dt);
    applyCamera(dt);
    terrainMat.uniforms.uTime.value = time;
    seaMat.uniforms.uTime.value = time;
    seaMat.uniforms.uWave.value = clamp(ppu() / 22, 0.3, 40);
    camLimits();

    drainDirty();
    stepAnims(dt);
    if (ownerDirty) { ownerTex.needsUpdate = true; ownerDirty = false; }

    const P = ppu();
    figScale = clamp(15 / P, 0.12, 99);
    townZ = Math.max(1, 12 / P);
    if (lastTownZ < 0 || Math.abs(townZ / lastTownZ - 1) > 0.04) { layoutTowns(townZ); lastTownZ = townZ; }

    // ---- armies
    figN = 0; bannerN = 0; standN = 0;
    clothTime.value = time;
    const e = dayFrac * dayFrac * (3 - 2 * dayFrac);
    for (const a of G.armies) {
      let v = vis.get(a.id);
      if (!v) { v = { x: a.x, y: a.y, fx: a.x, fy: a.y, tx: a.x, ty: a.y, yaw: 0, moving: false }; vis.set(a.id, v); }
      v.x = v.fx + (v.tx - v.fx) * e; v.y = v.fy + (v.ty - v.fy) * e;
      if (a.battle) {
        // face the enemy
        const b = WAR.sim.battleById(G, a.battle);
        if (b) v.yaw = Math.atan2(b.x - v.x, b.y - v.y) || v.yaw;
      }
      const css = cssOfOwner(a.owner, a);
      const X = wx(v.x), Z = wz(v.y);
      const k = figuresFor(a.men);
      const f = figScale;
      const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
      const walking = v.moving && dayFrac < 0.999;
      // the stand: files x ranks plus a margin, room at the back for the standard
      const files = k <= 3 ? k : k <= 9 ? 3 : 4, ranks = Math.ceil(k / files);
      const bw = (files * FILE_S + 0.16) * f, bd = (ranks * RANK_S + 0.34) * f;
      // the stand lies ON the slope: a plane through its four edge midpoints,
      // tilted in pitch and roll, so it neither floats downhill nor sinks uphill
      const gAt = function (lx, lz) { return groundY(X + lx * cy + lz * sy + M.w / 2, Z - lx * sy + lz * cy + M.h / 2); };
      const hF = gAt(0, bd / 2), hB = gAt(0, -bd / 2), hL = gAt(-bw / 2, 0), hR = gAt(bw / 2, 0);
      const slZ = clamp((hF - hB) / bd, -0.5, 0.5), slX = clamp((hR - hL) / bw, -0.5, 0.5);
      const y0 = Math.max(groundY(v.x, v.y), (hF + hB + hL + hR) / 4) - f * 0.01;
      const hb = BASE_H * f * 0.55, top = y0 + hb;
      putStand(X, y0, Z, v.yaw, bw, bd, f * 0.55, -Math.atan(slZ), Math.atan(slX));
      v.br = Math.hypot(bw, bd) * 0.56; v.top = top;
      for (let i = 0; i < k; i++) {
        const col = i % files, row = (i / files) | 0;
        const lx = (col - (files - 1) / 2) * FILE_S * f + ((i * 7) % 3 - 1) * f * 0.015;
        const lz = ((ranks - 1) / 2 - row) * RANK_S * f + 0.1 * f;
        const px = X + lx * cy + lz * sy, pz = Z - lx * sy + lz * cy;
        const bob = walking ? Math.abs(Math.sin(time * 9 + i * 1.7)) * f * 0.04 : 0;
        putFigure(px, top + lx * slX + lz * slZ + bob, pz, v.yaw, f, css);
      }
      const slx = -(bw / 2 - 0.1 * f), slz = -(bd / 2 - 0.1 * f);
      const bx = X + slx * cy + slz * sy, bz = Z - slx * sy + slz * cy;
      putBanner(bx, top + slx * slX + slz * slZ, bz, f * 2.3, css, (a.id % 17) * 0.37, time);
    }
    standMesh.count = standN; standMesh.instanceMatrix.needsUpdate = true;
    clothFig.count = kitFig.count = figN;
    clothFig.instanceMatrix.needsUpdate = kitFig.instanceMatrix.needsUpdate = true;
    if (clothFig.instanceColor) clothFig.instanceColor.needsUpdate = true;

    // ---- town flags
    for (let t = 0; t < M.towns.length; t++) {
      const T = M.towns[t], o = G.townOwner[t];
      const css = o ? G.factions[o].css : "#d8cfb4";
      // planted on the edge of the square, beside the well
      const hx = T.x + 0.085 * townZ, hy = T.y + 0.03 * townZ;
      putBanner(wx(hx), groundY(hx, hy), wz(hy), (T.capital ? 0.42 : 0.3) * townZ, css, t * 0.61, time);
    }
    poleMesh.count = clothMesh.count = bannerN;
    poleMesh.instanceMatrix.needsUpdate = clothMesh.instanceMatrix.needsUpdate = true;
    if (clothMesh.instanceColor) clothMesh.instanceColor.needsUpdate = true;

    // ---- selection rings
    let ri = 0;
    for (const id of selected) {
      const a = WAR.sim.army(G, id), v = vis.get(id);
      if (!a || !v || ri >= ringPool.length) continue;
      const r = ringPool[ri++];
      r.visible = true;
      r.position.set(wx(v.x), (v.top != null ? v.top : groundY(v.x, v.y)) + figScale * 0.02, wz(v.y));
      const pulse = 1 + Math.sin(time * 4) * 0.04;
      r.scale.setScalar((v.br || figScale) * pulse);
    }
    for (; ri < ringPool.length; ri++) ringPool[ri].visible = false;

    // ---- routes
    const rw = figScale * 0.22;
    if (previewDirty || Math.abs(rw / (lastPathScale || rw) - 1) > 0.2) {
      previewMesh = setRibbon(previewMesh, previewTiles, rw * 1.1, previewMat);
      previewDirty = false;
    }
    if (pathsDirty || Math.abs(rw / (lastPathScale || rw) - 1) > 0.2) {
      let n = 0;
      for (const id of selected) {
        const a = WAR.sim.army(G, id);
        if (!a || !a.path || a.pi >= a.path.length - 1) continue;
        const tiles = a.path.slice(a.pi);
        pathMeshes[n] = setRibbon(pathMeshes[n], tiles, rw, ribbonMat);
        n++;
      }
      for (let k = n; k < pathMeshes.length; k++) { if (pathMeshes[k]) { root.remove(pathMeshes[k]); pathMeshes[k].geometry.dispose(); } }
      pathMeshes.length = n;
      pathsDirty = false; lastPathScale = rw;
    }
    ribbonMat.uniforms.uTime.value = time; ribbonMat.uniforms.uDash.value = rw * 5;
    previewMat.uniforms.uTime.value = time; previewMat.uniforms.uDash.value = rw * 5;

    // ---- battles
    let si = 0, mi = 0;
    for (const b of G.battles) {
      const y = groundY(b.x, b.y);
      const s = getSword(si++);
      s.visible = true;
      s.position.set(wx(b.x), y + figScale * 2.6, wz(b.y));
      for (let k = 0; k < 4; k++) {
        const sm = getSmoke(mi++);
        const ph = ((time * 0.35 + k * 0.25 + b.id * 0.13) % 1);
        sm.visible = true;
        const ang = k * 1.9 + b.id;
        sm.position.set(wx(b.x) + Math.cos(ang) * figScale * 0.5, y + figScale * (0.4 + ph * 2.2), wz(b.y) + Math.sin(ang) * figScale * 0.5);
        sm.scale.setScalar(figScale * (1.1 + ph * 1.8));
        sm.material.opacity = 0.55 * (1 - ph);
      }
    }
    for (; si < swordPool.length; si++) swordPool[si].visible = false;
    for (; mi < smokePool.length; mi++) smokePool[mi].visible = false;

    labels(P);
    if (!firstFrame) { firstFrame = true; if (V.onFirstFrame) { try { V.onFirstFrame(); } catch (err) {} } }
  };

  /* ---------------------------------------------------------------- labels */
  let labelTick = 0;
  function labels(P) {
    const vw = window.innerWidth, vh2 = window.innerHeight;
    // towns: largest first, decluttered
    labelTick++;
    const popCut = 160000 / Math.pow(P, 1.25);
    const showSub = P > 13;
    const boxes = [];
    const order = V._townOrder || (V._townOrder = M.towns.map(function (T, i) { return i; }).sort(function (a, b) {
      return (M.towns[b].capital - M.towns[a].capital) || (M.towns[b].pop - M.towns[a].pop);
    }));
    for (let n = 0; n < order.length; n++) {
      const t = order[n], T = M.towns[t], rec = townEls[t];
      if (!rec) continue;
      let on = T.capital || T.pop >= popCut;
      let s = null;
      if (on) {
        s = project(wx(T.x), groundY(T.x, T.y) + 0.2 * townZ, wz(T.y) - (T._viewR || 0.3) * townZ * 0.2);
        if (!s || s.x < -80 || s.x > vw + 80 || s.y < -20 || s.y > vh2 + 40) on = false;
      }
      if (on) {
        const hgt = rec.h;
        const bx = s.x - rec.w / 2, by = s.y - hgt;
        for (let k = 0; k < boxes.length; k++) {
          const q = boxes[k];
          if (bx < q[2] && bx + rec.w > q[0] && by < q[3] && by + hgt > q[1]) { on = false; break; }
        }
        if (on) boxes.push([bx, by, bx + rec.w, by + hgt]);
      }
      showEl(rec, on);
      if (!on) continue;
      place(rec.el, rec, s.x, s.y);
      const o = G.townOwner[t];
      const dot = o ? G.factions[o].css : "#d8cfb4";
      if (rec.dot$ !== dot) { rec.dot.style.background = dot; rec.dot$ = dot; }
      const sub = "";
      if (rec.sub$ !== sub) { rec.sub.textContent = sub; rec.sub.style.display = sub ? "" : "none"; rec.sub$ = sub; }
    }
    // armies
    const seen = new Set();
    for (const a of G.armies) {
      const v = vis.get(a.id);
      if (!v) continue;
      const s = project(wx(v.x), groundY(v.x, v.y) + figScale * 2.05, wz(v.y));
      let rec = armyEls.get(a.id);
      if (!s || s.x < -60 || s.x > vw + 60 || s.y < -30 || s.y > vh2 + 30) { if (rec) showEl(rec, false); continue; }
      if (!rec) {
        const el = document.createElement("div");
        el.className = "wvA";
        el.innerHTML = "<i></i><b></b>";
        overlay.appendChild(el);
        rec = { el: el, i: el.children[0], b: el.children[1], shown: true, x: -1, y: -1, men$: "", cls$: "", css$: "" };
        armyEls.set(a.id, rec);
      }
      seen.add(a.id);
      showEl(rec, true);
      place(rec.el, rec, s.x, s.y);
      const men = V.fmt(a.men);
      if (rec.men$ !== men) { rec.b.textContent = men; rec.men$ = men; }
      const css = cssOfOwner(a.owner, a);
      if (rec.css$ !== css) { rec.i.style.background = css; rec.css$ = css; }
      const cls = "wvA" + (selSet.has(a.id) ? " sel" : "") + (!a.supplied && !a.rogue && !a.free && a.home < 0 ? " cut" : "") + (a.home >= 0 ? " gar" : "") +
        (!showSub && !selSet.has(a.id) ? " far" : "");
      if (rec.cls$ !== cls) { rec.el.className = cls; rec.cls$ = cls; }
    }
    armyEls.forEach(function (rec, id) {
      if (seen.has(id)) return;
      if (!vis.has(id)) { if (rec.el.parentNode) rec.el.parentNode.removeChild(rec.el); armyEls.delete(id); }
      else showEl(rec, false);
    });
    // battles
    const bseen = new Set();
    for (const b of G.battles) {
      const s = project(wx(b.x), groundY(b.x, b.y) + figScale * 2.6, wz(b.y));
      let rec = battleEls.get(b.id);
      if (!rec) {
        const el = document.createElement("div");
        el.className = "wvB";
        overlay.appendChild(el);
        rec = { el: el, shown: true, x: -1, y: -1, t$: "" };
        battleEls.set(b.id, rec);
      }
      bseen.add(b.id);
      if (!s || !showSub) { showEl(rec, false); continue; }
      showEl(rec, true);
      place(rec.el, rec, s.x, s.y - 24);
      let am = 0, dm = 0;
      for (const id of b.att) { const a = WAR.sim.army(G, id); if (a) am += a.men; }
      for (const id of b.def) { const a = WAR.sim.army(G, id); if (a) dm += a.men; }
      const A0 = WAR.sim.army(G, b.att[0]), D0 = WAR.sim.army(G, b.def[0]);
      const ca = cssOfOwner(b.attOwner, A0), cd = cssOfOwner(b.defOwner, D0);
      const t = '<b style="color:' + ca + '">' + V.fmt(am) + '</b><em>/</em><b style="color:' + cd + '">' + V.fmt(dm) + '</b>';
      if (rec.t$ !== t) { rec.el.innerHTML = t; rec.t$ = t; }
    }
    battleEls.forEach(function (rec, id) { if (!bseen.has(id)) { if (rec.el.parentNode) rec.el.parentNode.removeChild(rec.el); battleEls.delete(id); } });
  }

  /* ================================================================ PICK / FOCUS / SELECT */
  V.pick = function (cx, cy) {
    const out = { tile: -1, army: null, town: -1, battle: null, x: 0, y: 0 };
    if (!mounted || hidden) return out;
    const touch = !!(CBZ.studio && CBZ.studio.touchDevice);
    const R = touch ? 34 : 24;
    let best = null, bd = R * R;
    for (const a of G.armies) {
      const s = screenOfArmy(a);
      if (!s) continue;
      const dx = s.x - cx, dy = s.y - cy, d = dx * dx + dy * dy;
      // the strength plate counts too
      const pl = project(wx(vis.get(a.id) ? vis.get(a.id).x : a.x), groundY(a.x, a.y) + figScale * 2.05, wz(vis.get(a.id) ? vis.get(a.id).y : a.y));
      let d2 = d;
      if (pl) { const ex = pl.x - cx, ey = pl.y - 8 - cy; d2 = Math.min(d, ex * ex + ey * ey); }
      if (d2 < bd) { bd = d2; best = a; }
    }
    out.army = best;
    let bb = null, bbd = (R + 6) * (R + 6);
    for (const b of G.battles) {
      const s = project(wx(b.x), groundY(b.x, b.y) + figScale * 2.6, wz(b.y));
      if (!s) continue;
      const d = (s.x - cx) * (s.x - cx) + (s.y - cy) * (s.y - cy);
      if (d < bbd) { bbd = d; bb = b; }
    }
    out.battle = bb;
    const h = groundHit(cx, cy);
    if (h) {
      const tx = h.x + M.w / 2, ty = h.z + M.h / 2;
      out.x = tx; out.y = ty;
      if (tx >= 0 && ty >= 0 && tx < M.w && ty < M.h) out.tile = (tx | 0) + (ty | 0) * M.w;
    }
    // a town is whatever town is under the finger, or its label
    let bt = -1, btd = (R + 4) * (R + 4);
    for (let t = 0; t < M.towns.length; t++) {
      const T = M.towns[t];
      const s = project(wx(T.x), groundY(T.x, T.y), wz(T.y));
      if (!s) continue;
      const d = (s.x - cx) * (s.x - cx) + (s.y - cy) * (s.y - cy);
      if (d < btd) { btd = d; bt = t; }
      const rec = townEls[t];
      if (rec && rec.shown && Math.abs(rec.x - cx) < rec.w / 2 && cy < rec.y && cy > rec.y - rec.h) { bt = t; btd = 0; }
    }
    if (bt < 0 && out.tile >= 0 && M.townAt[out.tile]) bt = M.townAt[out.tile] - 1;
    out.town = bt;
    return out;
  };
  V.focus = function (tile, dist) {
    if (!mounted) return;
    const x = tile % M.w + 0.5, y = ((tile / M.w) | 0) + 0.5;
    cam.gtx = wx(x); cam.gtz = wz(y);
    if (dist != null) cam.gdist = dist;
    else cam.gdist = Math.min(cam.gdist, Math.max(cam.dmin * 2.5, Math.max(M.w, M.h) * 0.09));
    clampGoal();
  };
  V.select = function (ids) {
    selected = (ids || []).slice(); selSet = new Set(selected); pathsDirty = true;
    if (!selected.length) V.preview(null);
  };
  V.preview = function (tiles) { previewTiles = tiles && tiles.length > 1 ? tiles : null; previewDirty = true; };
  V.hiFaction = function (f) { hiF = f == null ? -1 : f; if (terrainMat) terrainMat.uniforms.uHi.value = hiF; };
  V.cameraState = function () { return Object.assign({}, cam); };
  V.setCamera = function (o) { Object.assign(cam, o || {}); if (o && o.dist != null) cam.gdist = o.dist; clampGoal(); };
  V.screenOfTile = function (tile) {
    if (!mounted) return null;
    const x = tile % M.w + 0.5, y = ((tile / M.w) | 0) + 0.5;
    return project(wx(x), groundY(x, y), wz(y));
  };
  V.firstFrameDone = function () { return firstFrame; };
})();
