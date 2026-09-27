/* ============================================================
   warlord/war/mapkit.js — a map of a real place, as tiles.

   One data file per map (src/warlord/war/maps/*.js, CONTRACT.md section 1)
   goes in; the runtime map M of CONTRACT.md section 2 comes out. Pure JS,
   no DOM, no THREE: Node tools load this exactly as the page does.

   Format notes beyond the contract (all additive, all optional):
     sea:     [ring]   SEA-FIRST maps. When present the grid starts as LAND
                       and these rings cut sea back out; `land` rings are then
                       painted on top (islands). The Mediterranean is a hole in
                       a continent, so describing the hole is the honest shape.
     straits: [{name, line}]  lines cut to sea 4-connected, so a 2 km strait
                       (Bosporus, Messina) survives a 10 km grid and land on
                       either side is never 8-adjacent across it.
     terrain: kind may also be "lake" (paints code 7); an entry may carry
                       `rural` (people/km2) overriding ruralPerKm2 for its tiles.
     towns[].garrison  men standing in the town on day 0 (history's hint).
     rogues:  [{name, at, men}]  roaming warbands owned by nobody.
     raster.biome: { names: [..], data: base64 Uint8 } per-tile battle ground.
     projection "metres": rows run from `north` to `south`, so a map whose
                       world +z points DOWN the page (desert.js) just sets
                       north < south.
   Towns and armies standing on sea are snapped to the nearest land tile and
   the fix is reported in M.warnings (and console.warn), never silently.
============================================================ */
(function () {
  "use strict";
  const G0 = typeof window !== "undefined" ? window : globalThis;
  const CBZ = (G0.CBZ = G0.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const WAR = (W.war = W.war || {});
  WAR.mapData = WAR.mapData || {};

  /* THE GROUND. Colours are linear-ish albedos of what the ground really is
     from the air in summer: Mediterranean plains are dry olive-tan stubble,
     not lawn green; forest is dark canopy; desert is pale ochre sand. */
  const TERRAIN = [
    { code: 0, key: "sea",       name: "Sea",       move: Infinity, defence: 1.0,  rural: 0,   colour: [0.04, 0.12, 0.22] },
    { code: 1, key: "plains",    name: "Plains",    move: 1.0,      defence: 1.0,  rural: 25,  colour: [0.36, 0.33, 0.19] },
    { code: 2, key: "forest",    name: "Forest",    move: 1.6,      defence: 1.25, rural: 8,   colour: [0.10, 0.17, 0.07] },
    { code: 3, key: "hills",     name: "Hills",     move: 1.6,      defence: 1.35, rural: 14,  colour: [0.34, 0.29, 0.18] },
    { code: 4, key: "mountains", name: "Mountains", move: 3.0,      defence: 1.8,  rural: 3,   colour: [0.33, 0.30, 0.27] },
    { code: 5, key: "desert",    name: "Desert",    move: 1.8,      defence: 1.0,  rural: 0.5, colour: [0.72, 0.58, 0.38] },
    { code: 6, key: "marsh",     name: "Marsh",     move: 2.2,      defence: 1.3,  rural: 5,   colour: [0.17, 0.21, 0.12] },
    { code: 7, key: "lake",      name: "Lake",      move: Infinity, defence: 1.0,  rural: 0,   colour: [0.05, 0.16, 0.24] },
  ];
  TERRAIN.byKey = {};
  for (let i = 0; i < TERRAIN.length; i++) TERRAIN.byKey[TERRAIN[i].key] = TERRAIN[i];
  TERRAIN.RIVER_MOVE = 0.6;        // added move cost into/along a river tile
  TERRAIN.RIVER_DEFENCE = 1.25;    // defender bonus when attacked across one
  WAR.TERRAIN = TERRAIN;

  const BATTLE_DEFAULT = { plains: "gravel", forest: "gravel", hills: "rock", mountains: "rock",
                           desert: "dune", marsh: "wadi", sea: "shore", lake: "shore" };

  /* ---------------------------------------------------------------- base64
     Hand-rolled so it is identical in Node and the browser (and fast: a
     48k-tile raster decodes in well under a millisecond). */
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const B64R = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) B64R[B64.charCodeAt(i)] = i;
  function b64decode(s) {
    s = String(s).replace(/[^A-Za-z0-9+/]/g, "");
    const n = s.length, out = new Uint8Array((n * 3) >> 2);
    let o = 0;
    for (let i = 0; i < n; i += 4) {
      const a = B64R[s.charCodeAt(i)], b = B64R[s.charCodeAt(i + 1)];
      const c = i + 2 < n ? B64R[s.charCodeAt(i + 2)] : 0, d = i + 3 < n ? B64R[s.charCodeAt(i + 3)] : 0;
      const v = (a << 18) | (b << 12) | (c << 6) | d;
      if (o < out.length) out[o++] = v >> 16;
      if (o < out.length) out[o++] = (v >> 8) & 255;
      if (o < out.length) out[o++] = v & 255;
    }
    return out;
  }
  function b64encode(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i += 3) {
      const a = u8[i], b = i + 1 < u8.length ? u8[i + 1] : 0, c = i + 2 < u8.length ? u8[i + 2] : 0;
      const v = (a << 16) | (b << 8) | c;
      s += B64[v >> 18] + B64[(v >> 12) & 63] + (i + 1 < u8.length ? B64[(v >> 6) & 63] : "=") + (i + 2 < u8.length ? B64[v & 63] : "=");
    }
    return s;
  }

  /* ---------------------------------------------------------------- noise
     Integer hash value noise on the tile lattice: deterministic, seedless
     beyond the map id, so the same map always has the same relief. */
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
  function strHash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0) & 0x7fffffff;
  }

  /* ---------------------------------------------------------------- raster */
  // even-odd scanline fill of one ring (already in tile coords) at tile centres
  function fillRing(pts, w, h, cb) {
    const n = pts.length >> 1;
    if (n < 3) return 0;
    let ymin = Infinity, ymax = -Infinity;
    for (let k = 0; k < n; k++) { const y = pts[k * 2 + 1]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    const r0 = Math.max(0, Math.floor(ymin - 0.5)), r1 = Math.min(h - 1, Math.ceil(ymax));
    const xs = [];
    let count = 0;
    for (let ty = r0; ty <= r1; ty++) {
      const yc = ty + 0.5;
      xs.length = 0;
      for (let k = 0, j = n - 1; k < n; j = k++) {
        const y0 = pts[j * 2 + 1], y1 = pts[k * 2 + 1];
        if ((y0 <= yc) !== (y1 <= yc)) {
          const x0 = pts[j * 2], x1 = pts[k * 2];
          xs.push(x0 + (yc - y0) * (x1 - x0) / (y1 - y0));
        }
      }
      if (xs.length < 2) continue;
      xs.sort(function (a, b) { return a - b; });
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const a = Math.max(0, Math.ceil(xs[q] - 0.5)), b = Math.min(w - 1, Math.floor(xs[q + 1] - 0.5));
        for (let tx = a; tx <= b; tx++) { cb(tx + ty * w); count++; }
      }
    }
    return count;
  }
  // a line through tile cells. four = true walks a 4-connected staircase
  // (a strait that must separate land), else a thin 8-connected line (a river).
  function walkLine(pts, w, h, four, cb) {
    for (let k = 0; k + 3 < pts.length; k += 2) {
      let x0 = Math.floor(pts[k]), y0 = Math.floor(pts[k + 1]);
      const x1 = Math.floor(pts[k + 2]), y1 = Math.floor(pts[k + 3]);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let guard = 0; guard < 100000; guard++) {
        if (x0 >= 0 && y0 >= 0 && x0 < w && y0 < h) cb(x0 + y0 * w);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (four) {
          // take ONE axis step per cell so consecutive cells share an edge
          if (e2 - dy > dx - e2) { err += dy; x0 += sx; } else { err += dx; y0 += sy; }
        } else {
          if (e2 >= dy) { err += dy; x0 += sx; }
          if (e2 <= dx) { err += dx; y0 += sy; }
        }
      }
    }
  }

  /* ---------------------------------------------------------------- heap */
  function Heap(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  Heap.prototype.push = function (key, val) {
    if (this.n >= this.k.length) {
      const k2 = new Float64Array(this.k.length * 2), v2 = new Int32Array(this.k.length * 2);
      k2.set(this.k); v2.set(this.v); this.k = k2; this.v = v2;
    }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  };
  Heap.prototype.pop = function () {       // returns value; key in this.top
    const K = this.k, V = this.v;
    const val = V[0];
    this.top = K[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], v = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = key; V[i] = v;
    }
    return val;
  };

  function parseColour(c) {
    if (typeof c === "number") return c;
    const s = String(c || "#888888").replace("#", "");
    return parseInt(s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s, 16) || 0x888888;
  }
  function cssOf(n) { return "#" + ("000000" + (n >>> 0).toString(16)).slice(-6); }

  /* ================================================================ load */
  /* ONE RUNTIME MAP PER DATA OBJECT. The sim, the view and the UI all ask
     for the map; building it once saves ~150 ms each time after the first.
     M is read-only by convention (the sim keeps its own owner array);
     load(data, { fresh: true }) builds a private copy for a tool that wants one. */
  const cache = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function load(data, opts) {
    if (typeof data === "string") data = WAR.mapData[data];
    if (!data) throw new Error("mapkit.load: no such map");
    if (cache && !(opts && opts.fresh) && cache.has(data)) return cache.get(data);
    const M = build(data);
    if (cache) cache.set(data, M);
    return M;
  }
  function build(data) {
    const t0 = Date.now();
    const warnings = [];
    function warn(msg) { warnings.push(msg); if (typeof console !== "undefined") console.warn("[mapkit " + data.id + "] " + msg); }

    const P = data.projection;
    const lonlat = P.kind === "lonlat";
    const raster = data.raster || null;
    const w = raster ? raster.w : data.grid.w, h = raster ? raster.h : data.grid.h;
    const N = w * h;
    const spanU = P.east - P.west, spanV = P.north - P.south;

    function toTile(u, v) { return [(u - P.west) / spanU * w, (P.north - v) / spanV * h]; }
    function fromTile(x, y) { return [P.west + x / w * spanU, P.north - y / h * spanV]; }
    function idx(x, y) { return x + y * w; }
    function xy(i) { return [i % w, (i / w) | 0]; }
    function ringToTiles(ring) {
      const out = new Float64Array(ring.length * 2);
      for (let k = 0; k < ring.length; k++) {
        out[k * 2] = (ring[k][0] - P.west) / spanU * w;
        out[k * 2 + 1] = (P.north - ring[k][1]) / spanV * h;
      }
      return out;
    }

    /* PER-ROW GEOMETRY. On a lonlat grid a tile at 45N is 70% the width of
       one at the equator, which matters for people per tile and for march
       distance, so both come from the row's latitude. */
    const rowDx = new Float64Array(h), rowArea = new Float64Array(h);
    let dyKm;
    if (lonlat) {
      const dLon = spanU / w, dLat = Math.abs(spanV) / h;
      dyKm = dLat * 110.574;
      for (let y = 0; y < h; y++) {
        const lat = fromTile(0, y + 0.5)[1];
        rowDx[y] = dLon * 111.32 * Math.cos(lat * Math.PI / 180);
        rowArea[y] = rowDx[y] * dyKm;
      }
    } else {
      dyKm = Math.abs(spanV) / h / 1000;
      const dx = Math.abs(spanU) / w / 1000;
      for (let y = 0; y < h; y++) { rowDx[y] = dx; rowArea[y] = dx * dyKm; }
    }
    let tileKm = 0;
    for (let y = 0; y < h; y++) tileKm += Math.sqrt(rowArea[y]);
    tileKm /= h;

    /* ------------------------------------------------ terrain */
    const terrain = new Uint8Array(N);
    const river = new Uint8Array(N);
    let height = null;
    let biomeRaster = null, biomeNames = null;
    let ruralOver = null;      // people/km2 set by a terrain polygon (the Nile's flood land)
    if (raster) {
      const t = b64decode(raster.terrain);
      if (t.length < N) throw new Error("mapkit: raster terrain too short");
      terrain.set(t.subarray(0, N));
      if (raster.height) {
        const hb = b64decode(raster.height), sc = raster.heightScale || 1, off = raster.heightOffset || 0;
        height = new Float32Array(N);
        for (let i = 0; i < N; i++) height[i] = hb[i] * sc + off;
      }
      if (raster.river) river.set(b64decode(raster.river).subarray(0, N));
      if (raster.biome) { biomeRaster = b64decode(raster.biome.data); biomeNames = raster.biome.names; }
    } else {
      if (data.sea) {
        terrain.fill(1);
        for (let r = 0; r < data.sea.length; r++) fillRing(ringToTiles(data.sea[r]), w, h, function (i) { terrain[i] = 0; });
      }
      const land = data.land || [];
      for (let r = 0; r < land.length; r++) {
        const pts = ringToTiles(land[r]);
        const n = fillRing(pts, w, h, function (i) { terrain[i] = 1; });
        if (n === 0) {
          // an island smaller than a tile still exists: Malta, Rhodes
          let sx = 0, sy = 0;
          for (let k = 0; k < pts.length; k += 2) { sx += pts[k]; sy += pts[k + 1]; }
          const cx = Math.floor(sx / (pts.length / 2)), cy = Math.floor(sy / (pts.length / 2));
          if (cx >= 0 && cy >= 0 && cx < w && cy < h) terrain[cx + cy * w] = 1;
        }
      }
      const straits = data.straits || [];
      for (let s = 0; s < straits.length; s++) walkLine(ringToTiles(straits[s].line), w, h, true, function (i) { terrain[i] = 0; });
      const tp = data.terrain || [];
      for (let k = 0; k < tp.length; k++) {
        const T = TERRAIN.byKey[tp[k].kind];
        if (!T) { warn("unknown terrain kind " + tp[k].kind); continue; }
        const code = T.code, rr = tp[k].rural != null ? +tp[k].rural : NaN;
        if (rr === rr && !ruralOver) ruralOver = new Float32Array(N).fill(NaN);
        fillRing(ringToTiles(tp[k].poly), w, h, function (i) {
          if (terrain[i] === 0) return;
          terrain[i] = code;
          if (ruralOver) ruralOver[i] = rr;      // a later polygon without a density clears it
        });
      }
      const wat = data.water || [];
      for (let r = 0; r < wat.length; r++) {
        const pts = ringToTiles(wat[r]);
        const n = fillRing(pts, w, h, function (i) { if (terrain[i] !== 0) terrain[i] = 7; });
        if (n === 0) {
          let sx = 0, sy = 0;
          for (let k = 0; k < pts.length; k += 2) { sx += pts[k]; sy += pts[k + 1]; }
          const cx = Math.floor(sx / (pts.length / 2)), cy = Math.floor(sy / (pts.length / 2));
          if (cx >= 0 && cy >= 0 && cx < w && cy < h && terrain[cx + cy * w] !== 0) terrain[cx + cy * w] = 7;
        }
      }
    }
    // rivers: 8-connected lines over land (a river through a lake is the lake)
    const tm = { raster: Date.now() - t0 };
    const rivers = data.rivers || [];
    for (let r = 0; r < rivers.length; r++) {
      walkLine(ringToTiles(rivers[r].line), w, h, false, function (i) {
        if (terrain[i] !== 0 && terrain[i] !== 7) river[i] = 1;
      });
    }

    const landA = new Uint8Array(N), coast = new Uint8Array(N);
    for (let i = 0; i < N; i++) landA[i] = terrain[i] !== 0 && terrain[i] !== 7 ? 1 : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (!landA[i]) continue;
      let c = 0;
      for (let dy = -1; dy <= 1 && !c; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (terrain[xx + yy * w] === 0) { c = 1; break; }
      }
      coast[i] = c;
    }

    tm.coast = Date.now() - t0;
    if (!height) height = synthHeight(data, w, h, terrain, river, tileKm);
    tm.height = Date.now() - t0;

    /* ------------------------------------------------ people on the land */
    const rpk = data.ruralPerKm2 || {};
    const ruralK = new Float32Array(8);
    for (let c = 0; c < 8; c++) {
      const key = TERRAIN[c].key;
      ruralK[c] = c === 0 || c === 7 ? 0 : (rpk[key] != null ? rpk[key] : TERRAIN[c].rural);
    }
    const rural = new Float32Array(N);
    for (let y = 0; y < h; y++) {
      const a = rowArea[y];
      for (let x = 0; x < w; x++) {
        const i = x + y * w, t = terrain[i];
        const o = ruralOver ? ruralOver[i] : NaN;
        rural[i] = (o === o && t !== 0 && t !== 7 ? o : ruralK[t]) * a;
      }
    }

    /* ------------------------------------------------ snapping to land */
    const townAt = new Int32Array(N);
    function nearestLand(fx, fy, avoidTown) {
      const cx = Math.max(0, Math.min(w - 1, Math.floor(fx))), cy = Math.max(0, Math.min(h - 1, Math.floor(fy)));
      if (landA[cx + cy * w] && !(avoidTown && townAt[cx + cy * w])) return cx + cy * w;
      for (let r = 1; r < 40; r++) {
        let best = -1, bd = Infinity;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const xx = cx + dx, yy = cy + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const i = xx + yy * w;
          if (!landA[i] || (avoidTown && townAt[i])) continue;
          const d = (xx + 0.5 - fx) * (xx + 0.5 - fx) + (yy + 0.5 - fy) * (yy + 0.5 - fy);
          if (d < bd) { bd = d; best = i; }
        }
        if (best >= 0) return best;
      }
      return -1;
    }

    /* ------------------------------------------------ factions */
    const factions = [];
    const fIndex = {};
    const fl = data.factions || [];
    for (let k = 0; k < fl.length; k++) {
      const f = fl[k];
      const col = parseColour(f.colour);
      fIndex[f.id] = k + 1;
      factions.push({ id: f.id, i: k + 1, name: f.name, adj: f.adj || f.name, colour: col, css: cssOf(col),
                      capital: -1, playable: f.playable !== false,
                      ai: f.ai || { aggression: 0.5, expand: 0.5 }, _cap: f.capital });
    }
    function factionIndex(id) { return id == null ? 0 : (fIndex[id] || 0); }

    /* ------------------------------------------------ towns */
    const towns = [];
    const tIndex = {};
    const tl = data.towns || [];
    for (let k = 0; k < tl.length; k++) {
      const T = tl[k];
      const tt = toTile(T.at[0], T.at[1]);
      let tile = nearestLand(tt[0], tt[1], true);
      if (tile < 0) { warn("town " + T.id + " has no land near it, dropped"); continue; }
      const fx = Math.floor(tt[0]), fy = Math.floor(tt[1]);
      let x = tt[0], y = tt[1];
      if (tile !== fx + fy * w) {
        const q = xy(tile);
        const moved = Math.hypot(q[0] + 0.5 - x, q[1] + 0.5 - y);
        // a harbour town a tile off the rasterised coast is resolution, not an error
        if (!(fx >= 0 && fy >= 0 && fx < w && fy < h && landA[fx + fy * w])) {
          if (moved > 1.6) warn("town " + T.id + " stood at sea, snapped " + Math.round(moved * tileKm) + " km to land");
        } else warn("town " + T.id + " shares a tile with another town, nudged");
        x = q[0] + 0.5; y = q[1] + 0.5;
      }
      const owner = factionIndex(T.owner);
      if (T.owner && !owner) warn("town " + T.id + " owner " + T.owner + " is not a faction");
      const town = { id: T.id, i: towns.length, name: T.name, x: x, y: y, tile: tile, pop: T.pop | 0,
                     capital: !!T.capital, port: !!T.port, owner: owner,
                     garrison: T.garrison != null ? T.garrison | 0 : null };
      if (town.port && !coast[tile]) {
        // a port a tile inland of the drawn coast still has a harbour
        const q = xy(tile);
        let ok = false;
        const pr = Math.max(2, Math.round(0.8 / tileKm));   // a harbour can sit up to ~800 m from the water
        for (let dy = -pr; dy <= pr && !ok; dy++) for (let dx = -pr; dx <= pr; dx++) {
          const xx = q[0] + dx, yy = q[1] + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && terrain[xx + yy * w] === 0) { ok = true; break; }
        }
        if (!ok) warn("port " + T.id + " is not near the sea");
      }
      townAt[tile] = towns.length + 1;
      tIndex[T.id] = towns.length;
      towns.push(town);
    }
    for (let k = 0; k < factions.length; k++) {
      const f = factions[k];
      let c = f._cap != null && tIndex[f._cap] != null ? tIndex[f._cap] : -1;
      if (c < 0) for (let t = 0; t < towns.length; t++) if (towns[t].owner === f.i) { c = t; break; }
      if (c < 0) warn("faction " + f.id + " has no towns");
      f.capital = c;
      if (c >= 0) towns[c].capital = true;
      delete f._cap;
    }

    tm.towns = Date.now() - t0;
    /* ------------------------------------------------ starting land */
    const startOwner = new Uint8Array(N);
    if (data.realms) {
      for (let r = 0; r < data.realms.length; r++) {
        const o = factionIndex(data.realms[r].owner);
        fillRing(ringToTiles(data.realms[r].poly), w, h, function (i) { if (landA[i]) startOwner[i] = o; });
      }
    }
    /* THE RADIUS RULE, by travel cost rather than as the crow flies: a
       town's reach stops at a mountain wall and never crosses the sea, which
       is where real borders ran. Nearest town (by that cost) wins; a capital
       reaches half as far again. Tiles already given by `realms` are kept. */
    const R0 = data.startRadiusKm || 100;
    const best = new Float64Array(N).fill(Infinity);
    const heap = new Heap(4096);
    const radius = new Float64Array(towns.length);
    // unowned towns seed too: a free city's hinterland is its own, not
    // whichever king's town happens to be nearest
    for (let t = 0; t < towns.length; t++) radius[t] = R0 * (towns[t].capital ? 1.5 : 1);
    let qid = 0;
    // push (cost, entryId); entry -> (tile, town) in two growable arrays
    let eTile = new Int32Array(8192), eTown = new Int32Array(8192);
    function pushE(cost, tile, town) {
      if (qid >= eTile.length) {
        const a = new Int32Array(eTile.length * 2), b = new Int32Array(eTile.length * 2);
        a.set(eTile); b.set(eTown); eTile = a; eTown = b;
      }
      eTile[qid] = tile; eTown[qid] = town;
      heap.push(cost, qid++);
    }
    for (let t = 0; t < towns.length; t++) pushE(0, towns[t].tile, t);
    const settled = new Uint8Array(N);
    const claimed = new Uint8Array(N);          // realms painted first keep their tiles
    for (let i = 0; i < N; i++) if (startOwner[i]) claimed[i] = 1;
    const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];
    const rowDiag = new Float64Array(h);
    for (let y = 0; y < h; y++) rowDiag[y] = Math.sqrt(rowDx[y] * rowDx[y] + dyKm * dyKm);
    const MOVE = new Float64Array(8);
    for (let c = 0; c < 8; c++) MOVE[c] = isFinite(TERRAIN[c].move) ? TERRAIN[c].move : 99;
    while (heap.n) {
      const e = heap.pop(), cost = heap.top;
      const tile = eTile[e], t = eTown[e];
      if (settled[tile]) continue;
      settled[tile] = 1;
      if (!claimed[tile]) { startOwner[tile] = towns[t].owner; claimed[tile] = 1; }
      const x = tile % w, y = (tile / w) | 0;
      for (let k = 0; k < 8; k++) {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = xx + yy * w;
        if (settled[j] || !landA[j]) continue;
        const km = DX[k] === 0 ? dyKm : DY[k] === 0 ? rowDx[yy] : rowDiag[yy];
        // half terrain, half distance: ranges bend borders, they do not wall them
        const c2 = cost + km * (MOVE[terrain[j]] + (river[j] ? TERRAIN.RIVER_MOVE : 0) + 1) * 0.5;
        if (c2 > radius[t] || c2 >= best[j]) continue;
        best[j] = c2;
        pushE(c2, j, t);
      }
    }
    for (let t = 0; t < towns.length; t++) startOwner[towns[t].tile] = towns[t].owner;

    tm.owners = Date.now() - t0;
    /* ------------------------------------------------ armies, rogues */
    function placeAt(at, what) {
      if (typeof at === "string") {
        if (tIndex[at] == null) { warn(what + " at unknown town " + at); return -1; }
        return towns[tIndex[at]].tile;
      }
      const tt = toTile(at[0], at[1]);
      const tile = nearestLand(tt[0], tt[1], false);
      const fx = Math.floor(tt[0]), fy = Math.floor(tt[1]);
      if (tile >= 0 && tile !== fx + fy * w) warn(what + " stood off land, snapped");
      return tile;
    }
    const startArmies = [];
    const al = data.armies || [];
    for (let k = 0; k < al.length; k++) {
      const A = al[k];
      const o = factionIndex(A.owner);
      if (!o) { warn("army owner " + A.owner + " unknown"); continue; }
      const tile = placeAt(A.at, "army of " + A.owner);
      if (tile < 0) continue;
      startArmies.push({ owner: o, tile: tile, men: A.men | 0, name: A.name || null });
    }
    const rogues = [];
    const rl = data.rogues || [];
    for (let k = 0; k < rl.length; k++) {
      const tile = placeAt(rl[k].at, "rogue " + rl[k].name);
      if (tile < 0) continue;
      const q = xy(tile);
      rogues.push({ name: rl[k].name, tile: tile, x: q[0] + 0.5, y: q[1] + 0.5, men: rl[k].men | 0 });
    }
    function pairs(list, what) {
      const out = [];
      for (let k = 0; list && k < list.length; k++) {
        const a = factionIndex(list[k][0]), b = factionIndex(list[k][1]);
        if (!a || !b) { warn(what + " names unknown faction " + list[k].join("/")); continue; }
        out.push([a, b]);
      }
      return out;
    }

    /* ------------------------------------------------ distances, world */
    function centreUV(i) { return fromTile((i % w) + 0.5, ((i / w) | 0) + 0.5); }
    function kmBetween(i, j) {
      const a = centreUV(i), b = centreUV(j);
      if (lonlat) {
        const R = 6371, rad = Math.PI / 180;
        const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
        const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
      }
      return Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000;
    }
    function worldOf(i) {
      if (P.kind !== "metres") return null;
      const c = centreUV(i);
      return { x: c[0], z: c[1] };
    }
    const bb = Object.assign({}, BATTLE_DEFAULT, (data.battle && data.battle.biome) || {});
    function battleBiome(i) {
      if (biomeRaster && biomeNames && biomeNames[biomeRaster[i]]) return biomeNames[biomeRaster[i]];
      return bb[TERRAIN[terrain[i]].key] || "gravel";
    }

    const M = {
      id: data.id, name: data.name, blurb: data.blurb, data: data,
      w: w, h: h, tileKm: tileKm, TERRAIN: TERRAIN,
      terrain: terrain, height: height, river: river, coast: coast, land: landA, rural: rural,
      towns: towns, townAt: townAt, factions: factions, factionIndex: factionIndex,
      startOwner: startOwner, startArmies: startArmies, rogues: rogues,
      wars: pairs(data.wars, "war"), alliances: pairs(data.alliances, "alliance"),
      idx: idx, xy: xy, toTile: toTile, fromTile: fromTile, kmBetween: kmBetween,
      worldOf: worldOf, battleBiome: battleBiome,
      tileAreaKm2: function (i) { return rowArea[(i / w) | 0]; },
      startDate: data.startDate || null,
      win: { share: (data.win && data.win.share) || 0.7 },
      warnings: warnings, loadMs: 0, loadSteps: tm,
    };
    M.loadMs = Date.now() - t0;
    return M;
  }

  /* ================================================================ relief
     Synthesised when a map carries no height: a believable relief is what
     the 3D view reads a front off, so it is built from the terrain the map
     author drew, not from noise alone. Base elevation per terrain, blurred
     so ranges rise out of foothills; ridged noise only inside mountains;
     rivers cut down; the sea shelves then drops. */
  function synthHeight(data, w, h, terrain, river, tileKm) {
    const N = w * h;
    const salt = strHash(String(data.id || "map"));
    const BASE = [0, 120, 260, 600, 1700, 380, 8, 0];
    const land = new Uint8Array(N);
    for (let i = 0; i < N; i++) land[i] = terrain[i] !== 0 ? 1 : 0;
    // distance (tiles) to the other medium, two-pass chamfer
    const dist = new Float32Array(N).fill(1e6);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = x + y * w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (land[xx + yy * w] !== land[i]) { dist[i] = 0.5; dy = 2; break; }
      }
    }
    const D1 = 1, D2 = 1.4142;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = x + y * w; let d = dist[i];
      if (x > 0 && dist[i - 1] + D1 < d) d = dist[i - 1] + D1;
      if (y > 0) {
        if (dist[i - w] + D1 < d) d = dist[i - w] + D1;
        if (x > 0 && dist[i - w - 1] + D2 < d) d = dist[i - w - 1] + D2;
        if (x < w - 1 && dist[i - w + 1] + D2 < d) d = dist[i - w + 1] + D2;
      }
      dist[i] = d;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = x + y * w; let d = dist[i];
      if (x < w - 1 && dist[i + 1] + D1 < d) d = dist[i + 1] + D1;
      if (y < h - 1) {
        if (dist[i + w] + D1 < d) d = dist[i + w] + D1;
        if (x < w - 1 && dist[i + w + 1] + D2 < d) d = dist[i + w + 1] + D2;
        if (x > 0 && dist[i + w - 1] + D2 < d) d = dist[i + w - 1] + D2;
      }
      dist[i] = d;
    }
    // blurred base + blurred "how mountainous here" weight; scale in tiles
    // chosen from km so a 10 km grid and a 75 m grid both look right
    const cellKm = Math.max(0.05, tileKm);
    const blurR = Math.max(1, Math.min(4, Math.round(25 / cellKm)));
    let base = new Float32Array(N), wgt = new Float32Array(N), mtn = new Float32Array(N), hil = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = terrain[i];
      if (t !== 0 && t !== 7) { base[i] = BASE[t]; wgt[i] = 1; }
      mtn[i] = t === 4 ? 1 : 0;
      hil[i] = t === 3 ? 1 : t === 5 ? 0.35 : 0;
    }
    function blur(a, r, weights) {       // separable box blur, weighted
      const tmp = new Float32Array(N), tw = new Float32Array(N), out = new Float32Array(N), ow = new Float32Array(N);
      for (let y = 0; y < h; y++) {
        let s = 0, sw = 0;
        const row = y * w;
        for (let x = -r; x < w + r; x++) {
          const xa = x + r, xr = x - r - 1;
          if (xa >= 0 && xa < w) { const wv = weights ? weights[row + xa] : 1; s += a[row + xa] * wv; sw += wv; }
          if (xr >= 0 && xr < w) { const wv = weights ? weights[row + xr] : 1; s -= a[row + xr] * wv; sw -= wv; }
          if (x >= 0 && x < w) { tmp[row + x] = s; tw[row + x] = sw; }
        }
      }
      for (let x = 0; x < w; x++) {
        let s = 0, sw = 0;
        for (let y = -r; y < h + r; y++) {
          const ya = y + r, yr = y - r - 1;
          if (ya >= 0 && ya < h) { s += tmp[ya * w + x]; sw += tw[ya * w + x]; }
          if (yr >= 0 && yr < h) { s -= tmp[yr * w + x]; sw -= tw[yr * w + x]; }
          if (y >= 0 && y < h) { out[y * w + x] = s; ow[y * w + x] = sw; }
        }
      }
      for (let i = 0; i < N; i++) out[i] = ow[i] > 1e-6 ? out[i] / ow[i] : 0;
      return out;
    }
    base = blur(blur(base, blurR, wgt), blurR, wgt);
    mtn = blur(blur(mtn, blurR, null), 1, null);
    hil = blur(hil, blurR, null);
    const nCell = Math.max(2, 60 / cellKm);          // relief features ~60 km
    const rCell = Math.max(1.5, 22 / cellKm);         // ridges ~20 km apart
    const height = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = x + y * w;
      const t = terrain[i];
      if (t === 0) {
        const d = dist[i] * cellKm;                    // km offshore
        height[i] = -(12 + Math.min(d, 45) * 3.5 + 3200 * (1 - Math.exp(-Math.max(0, d - 45) / 90)))
                    * (0.85 + 0.3 * vnoise(x, y, nCell, salt + 5));
        continue;
      }
      let y0 = base[i];
      const n1 = vnoise(x, y, nCell, salt + 1) - 0.5, n2 = vnoise(x, y, nCell / 3, salt + 2) - 0.5;
      y0 *= 0.8 + 0.5 * (n1 + 0.5);
      y0 += (n1 * 160 + n2 * 60);
      // ridged: 1 - |2n-1| is a crest wherever the noise crosses its middle
      if (mtn[i] > 0.005 || hil[i] > 0.005) {
        const r1 = 1 - Math.abs(2 * vnoise(x, y, rCell, salt + 3) - 1);
        const r2 = mtn[i] > 0.005 ? 1 - Math.abs(2 * vnoise(x, y, rCell / 2.3, salt + 4) - 1) : 0;
        y0 += mtn[i] * (r1 * r1 * 1300 + r2 * r2 * 500);
        y0 += hil[i] * (r1 * 260 + n2 * 120);
      }
      if (t === 5) y0 += (vnoise(x, y, Math.max(1.2, 6 / cellKm), salt + 6) - 0.5) * 80;   // erg swell
      if (t === 6) y0 = Math.min(y0, 12 + n2 * 10);
      if (river[i]) y0 = y0 * 0.82 - 15;
      // the coast walks down to the water over ~15 km
      const cd = dist[i] * cellKm;
      const k = cd < 15 ? (cd / 15) * (cd / 15) * (3 - 2 * cd / 15) : 1;
      y0 = 2 + (y0 - 2) * (0.08 + 0.92 * k);
      height[i] = Math.max(1, y0);
    }
    // lakes sit a little below their shore
    for (let i = 0; i < N; i++) if (terrain[i] === 7) height[i] = Math.max(1, base[i] * 0.9 - 10);
    return height;
  }

  function list() {
    const out = [];
    const ids = Object.keys(WAR.mapData);
    for (let k = 0; k < ids.length; k++) {
      const d = WAR.mapData[ids[k]];
      out.push({ id: d.id, name: d.name, blurb: d.blurb,
                 factions: (d.factions || []).map(function (f) {
                   return { id: f.id, name: f.name, css: cssOf(parseColour(f.colour)), playable: f.playable !== false };
                 }) });
    }
    return out;
  }

  WAR.mapkit = { load: load, list: list, TERRAIN: TERRAIN, b64decode: b64decode, b64encode: b64encode };
})();
