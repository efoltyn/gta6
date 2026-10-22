/* ============================================================
   city/borders.js — WHOSE GROUND IS THIS. The one answer.

   Owner (2026-10-22): "Fix the Gang City map to show countries. Right now
   it's unclear where countries start and end."

   Countries had no geography. A country record (city/polity.js) owns states
   and cities, and those own RECTS; the land between them belonged to nobody,
   and four files each guessed: warroom.nationAt (a city rect, else a state
   rect, else open sea), flags.nationAt (a city rect, else the Republic),
   regimes/presidency/relations (polity.of -> countryOf, else nothing). A
   tank in the backcountry was in no country at all; a flag on the same spot
   flew the Republic's.

   THE RULE. Every piece of ground the world already names is a CLAIM with
   an owner:
     - every polity record with a rect (city, federal territory, state, and
       a country's own rect: a civil war's rebel fragment is stamped one),
       owned by the country it rolls up to (polity.countryOf);
     - every land region the world builders registered (biomes, airport,
       speedway, the metro cities, a country's envelope), owned by the
       country its biome/owner id names, else by the polity record at its
       centre, else by the nearest claim that already has an owner.
   A point belongs to the NEAREST claim (distance to its edge; inside two,
   the smaller, so a rebel enclave inside a capital is the rebels'). The
   borders fall where the claims are equidistant: real lines between real
   places, derived from the layout, never authored. A custom world map moves
   its cities and the borders move with them; there is no coordinate here.
   Water belongs to a country within TERRITORIAL metres of its claims, past
   that it is international (null).

   PUBLIC
     CBZ.countryAt(x, z)      -> country id | null      (16 m cached)
     CBZ.countryRecAt(x, z)   -> the polity country record | null
     CBZ.countryAtExact(x, z, land?) -> id | null       (uncached, for bakers)
     CBZ.countries()          -> [{id, name, color, home, polygons, label,
                                   atWar (at war with YOUR country), wars:[ids]}]
                                   polygons = [[x,z,x,z,...]]
     CBZ.countryBorders()     -> [{a, b, war, lines:[[x,z,...]], pts}]: one
                                   entry per neighbour pair, its land pieces
                                   in lines (pts = the longest)
     CBZ.countryHome()        -> the player's country id
     CBZ.countryCrossing()    -> {id, name, at} the last border you crossed
     CBZ.countryVersion()     -> bumps whenever the partition changed
   (also on CBZ.polity: countryAt, countries, borders)

   COST. countryAt is a chunk Map hit; a miss is one pass over ~100 claims.
   countries()/countryBorders() build a grid ONCE per partition version (the
   full map asks when it opens; the radar reads the cached result). The
   partition re-signs every 2 s from the country roster, its rects and the
   region count, so a civil war's new enclave redraws the map on its own.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const TERRITORIAL = 520;      // m of sea a coast carries before the water is international
  const CHUNK = 16;

  let ver = 0, sig = "", sigAt = -1e9, arenaRef = null;
  let claims = null;            // [{own, kind, minX,maxX,minZ,maxZ | cx,cz,r, area}]
  const cache = new Map();
  let geo = null, geoVer = -1;  // grid-derived polygons/borders/labels

  function P() { return CBZ.polity; }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function countriesList() {
    const Pl = P(); if (!Pl || !Pl.list) return [];
    return (Pl.list("country") || []).filter(function (c) { return c && c.kind === "country"; });
  }

  // ---------------------------------------------------------- the signature
  function signature() {
    const A = arena();
    let s = (A && A.regions ? A.regions.length : 0) + "|";
    const cs = countriesList();
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i], r = c.rect;
      s += c.id + (r ? ":" + Math.round(r.cx) + "," + Math.round(r.cz) + "," + Math.round(r.hx) : "") + ";";
    }
    return s;
  }
  function fresh() {
    const t = performance.now();
    const A = arena();
    if (A !== arenaRef) { arenaRef = A; sigAt = -1e9; birth = null; }
    if (claims && t - sigAt < 2000) return;
    sigAt = t;
    const s = signature();
    if (claims && s === sig) return;
    sig = s; ver++; cache.clear(); claims = buildClaims();
  }

  // ---------------------------------------------------------- the claims
  function isLink(r) { return /causeway|bridge|link/i.test(r.name || ""); }
  function rectClaim(own, minX, maxX, minZ, maxZ) {
    return { own: own, kind: "rect", minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, area: Math.max(1, (maxX - minX) * (maxZ - minZ)) };
  }
  function claimDist(c, x, z) {
    if (c.kind === "circle") return Math.max(0, Math.hypot(x - c.cx, z - c.cz) - c.r);
    const ox = Math.max(c.minX - x, 0, x - c.maxX), oz = Math.max(c.minZ - z, 0, z - c.maxZ);
    return ox || oz ? Math.hypot(ox, oz) : 0;
  }
  function centreOf(c) { return c.kind === "circle" ? { x: c.cx, z: c.cz } : { x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2 }; }
  function buildClaims() {
    const Pl = P(); const out = [];
    if (!Pl || !Pl.list) return out;
    const cs = countriesList(), ids = Object.create(null);
    for (let i = 0; i < cs.length; i++) ids[cs[i].id] = true;
    const ownerOfRec = function (rec) {
      if (!rec) return null;
      const c = rec.kind === "country" ? rec : (Pl.countryOf ? Pl.countryOf(rec.id) : null);
      return c && ids[c.id] ? c.id : null;
    };
    // polity rects
    for (const kind of ["city", "federal", "state", "country"]) {
      const L = Pl.list(kind) || [];
      for (let i = 0; i < L.length; i++) {
        const r = L[i], rc = r && r.rect;
        if (!rc || !isFinite(rc.cx)) continue;
        const own = ownerOfRec(r); if (!own) continue;
        out.push(rectClaim(own, rc.cx - rc.hx, rc.cx + rc.hx, rc.cz - rc.hz, rc.cz + rc.hz));
      }
    }
    // the world's own land regions
    const A = arena(), regs = (A && A.regions) || [], pending = [];
    for (let i = 0; i < regs.length; i++) {
      const rg = regs[i];
      if (!rg || isLink(rg)) continue;
      let own = (rg.country && ids[rg.country]) ? rg.country : null;
      if (!own && rg.biome && ids[rg.biome]) own = rg.biome;
      if (!own && rg.owner && ids[rg.owner]) own = rg.owner;
      // a continent/backcountry underlay is bookkeeping, not a place: only a
      // country's own envelope underlay claims ground
      if (rg.underlay && !own) continue;
      if (!own && rg.biome && Pl.get) own = ownerOfRec(Pl.get(rg.biome));
      let c;
      if (rg.kind === "circle") {
        if (!isFinite(rg.cx) || !(rg.r > 0)) continue;
        c = { own: own, kind: "circle", cx: rg.cx, cz: rg.cz, r: rg.r, area: Math.PI * rg.r * rg.r };
      } else {
        if (!isFinite(rg.minX) || !isFinite(rg.maxX)) continue;
        c = rectClaim(own, rg.minX, rg.maxX, rg.minZ, rg.maxZ);
      }
      if (!own && Pl.of) { const m = centreOf(c); try { own = ownerOfRec(Pl.of(m.x, m.z)); } catch (e) {} c.own = own; }
      if (c.own) out.push(c); else pending.push(c);
    }
    // nobody named it: it goes with its nearest named neighbour
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i], m = centreOf(c);
      let best = null, bd = Infinity;
      for (let k = 0; k < out.length; k++) { const d = claimDist(out[k], m.x, m.z); if (d < bd) { bd = d; best = out[k]; } }
      if (best) { c.own = best.own; out.push(c); }
    }
    return out;
  }

  // ---------------------------------------------------------- the query
  function landAt(x, z) {
    const A = arena(), mt = A && A.mapTerrain;
    if (!mt || typeof mt.shoreAt !== "function") return true;
    try { return +mt.shoreAt(x, z) >= 0; } catch (e) { return true; }
  }
  function nearest(x, z) {
    let best = null, bd = Infinity, ba = Infinity;
    for (let i = 0; i < claims.length; i++) {
      const c = claims[i], d = claimDist(c, x, z);
      if (d < bd || (d === bd && c.area < ba)) { bd = d; ba = c.area; best = c; }
    }
    return best ? { own: best.own, d: bd } : null;
  }
  function exact(x, z, land) {
    fresh();
    if (!claims.length) return null;
    const n = nearest(x, z); if (!n) return null;
    if (n.d <= TERRITORIAL) return n.own;
    if (land == null) land = landAt(x, z);
    return land ? n.own : null;
  }
  function countryAt(x, z) {
    if (!isFinite(x) || !isFinite(z)) return null;
    fresh();
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
    const key = (ix + 32768) * 65536 + (iz + 32768);
    if (cache.has(key)) return cache.get(key);
    if (cache.size > 30000) cache.clear();
    const id = exact((ix + 0.5) * CHUNK, (iz + 0.5) * CHUNK);
    cache.set(key, id);
    return id;
  }
  function countryRecAt(x, z) {
    const id = countryAt(x, z), Pl = P();
    return id && Pl && Pl.get ? Pl.get(id) : null;
  }

  // ---------------------------------------------------------- colour, home, war
  function hexOf(c) {
    if (typeof c === "number") return "#" + ("000000" + (c >>> 0).toString(16)).slice(-6);
    return String(c || "");
  }
  function rgbOf(c) {
    const s = hexOf(c).replace("#", "");
    const n = parseInt(s.length === 3 ? s.replace(/(.)/g, "$1$1") : s, 16);
    return isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : null;
  }
  function colorOf(id) {
    // the nation's own flag: its most saturated colour that is not near
    // white or black, so the map and the cloth read as the same country
    let best = null, bs = -1;
    try {
      const d = CBZ.flags && CBZ.flags.designFor ? CBZ.flags.designFor(id) : null;
      for (const c of (d && d.colors) || []) {
        const q = rgbOf(c); if (!q) continue;
        const mx = Math.max(q[0], q[1], q[2]), mn = Math.min(q[0], q[1], q[2]);
        const l = (mx + mn) / 510, sat = mx ? (mx - mn) / mx : 0;
        if (l > 0.9 || l < 0.1) continue;
        if (sat > bs) { bs = sat; best = q; }
      }
    } catch (e) {}
    if (!best) {
      let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      const hue = (h % 360) / 60, f = hue - Math.floor(hue), v = 200, lo = 70;
      const seg = [[v, lo + (v - lo) * f, lo], [v - (v - lo) * f, v, lo], [lo, v, lo + (v - lo) * f], [lo, v - (v - lo) * f, v], [lo + (v - lo) * f, lo, v], [v, lo, v - (v - lo) * f]][Math.floor(hue) % 6];
      best = seg.map(Math.round);
    }
    return "#" + best.map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
  }
  let birth = null;   // the country this life started in (the fallback home)
  function countryHome() {
    try {
      const S = CBZ.presidency && CBZ.presidency.seat ? CBZ.presidency.seat() : null;
      if (S && S.kind === "country" && S.id) return S.id;
    } catch (e) {}
    try {
      const h = CBZ.gov && CBZ.gov.holds ? CBZ.gov.holds() : null;
      if (h && h.kind === "country" && h.id) return h.id;
    } catch (e) {}
    if (!birth) {
      const Pp = CBZ.player;
      if (Pp && Pp.pos && CBZ.game && CBZ.game.mode === "city") birth = countryAt(Pp.pos.x, Pp.pos.z);
    }
    return birth || null;
  }
  function warPairs() {
    const out = new Set();
    try {
      const W = CBZ.polwar && CBZ.polwar.allWars ? CBZ.polwar.allWars() : [];
      for (const w of W || []) {
        const s = w && w.sides; if (!s || s.length < 2 || !s[0] || !s[1] || s[0] === s[1]) continue;
        out.add(pairKey(s[0], s[1]));
      }
    } catch (e) {}
    return out;
  }
  function pairKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }

  // ---------------------------------------------------------- the geometry
  function claimBounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of claims) {
      const x0 = c.kind === "circle" ? c.cx - c.r : c.minX, x1 = c.kind === "circle" ? c.cx + c.r : c.maxX;
      const z0 = c.kind === "circle" ? c.cz - c.r : c.minZ, z1 = c.kind === "circle" ? c.cz + c.r : c.maxZ;
      if (x0 < minX) minX = x0; if (x1 > maxX) maxX = x1; if (z0 < minZ) minZ = z0; if (z1 > maxZ) maxZ = z1;
    }
    const A = arena(), mb = A && A.mapTerrain && A.mapTerrain.bounds;
    if (mb) { minX = Math.min(minX, mb.minX); maxX = Math.max(maxX, mb.maxX); minZ = Math.min(minZ, mb.minZ); maxZ = Math.max(maxZ, mb.maxZ); }
    const m = TERRITORIAL;
    return { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m };
  }
  // chain directed lattice edges (each with the owned cell on its left) into
  // runs; a run ends where the chain does or where the neighbour changes
  function chain(edges) {
    const byStart = new Map(), indeg = new Map();
    for (const e of edges) {
      let l = byStart.get(e.s); if (!l) byStart.set(e.s, l = []);
      l.push(e); indeg.set(e.t, (indeg.get(e.t) || 0) + 1);
    }
    const runs = [];
    const walk = function (e0) {
      const run = [e0]; e0.used = true;
      let e = e0;
      for (;;) {
        const nx = byStart.get(e.t); if (!nx) break;
        let next = null;
        for (const q of nx) if (!q.used && q.tag === e.tag) { next = q; break; }
        if (!next) break;
        next.used = true; run.push(next); e = next;
      }
      runs.push(run);
    };
    for (const e of edges) if (!e.used && !indeg.get(e.s)) walk(e);
    for (const e of edges) if (!e.used) walk(e);
    return runs;
  }
  function chaikin(pts, closed, n) {
    for (let it = 0; it < n; it++) {
      const L = pts.length / 2; if (L < 3) return pts;
      const out = [];
      if (!closed) out.push(pts[0], pts[1]);
      const lim = closed ? L : L - 1;
      for (let i = 0; i < lim; i++) {
        const j = (i + 1) % L;
        const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
        out.push(ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25, ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75);
      }
      if (!closed) out.push(pts[pts.length - 2], pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }
  // THE GRID, time-sliced: a city frame fills a few rows (a 2 ms budget)
  // until it is done, so the radar has its borders without a hitch; the full
  // map, opening, finishes whatever is left in one go.
  let job = null;
  function startJob() {
    const cs = countriesList(), idx = Object.create(null), names = [];
    for (let i = 0; i < cs.length; i++) { idx[cs[i].id] = i + 1; names.push(cs[i].id); }
    const J = { ver: ver, cs: cs, idx: idx, names: names, j: 0, empty: !claims.length || !cs.length };
    if (J.empty) return J;
    const B = J.B = claimBounds();
    const span = Math.max(B.maxX - B.minX, B.maxZ - B.minZ);
    J.cell = Math.max(30, Math.ceil(span / 300));
    J.nx = Math.ceil((B.maxX - B.minX) / J.cell); J.nz = Math.ceil((B.maxZ - B.minZ) / J.cell);
    J.grid = new Uint8Array(J.nx * J.nz); J.land = new Uint8Array(J.nx * J.nz);
    return J;
  }
  function stepJob(J, budget) {
    if (J.empty) return true;
    const t0 = performance.now(), B = J.B, cell = J.cell, nx = J.nx;
    while (J.j < J.nz) {
      const j = J.j++, z = B.minZ + (j + 0.5) * cell;
      for (let i = 0; i < nx; i++) {
        const x = B.minX + (i + 0.5) * cell;
        const ld = landAt(x, z);
        J.land[j * nx + i] = ld ? 1 : 0;
        const id = exact(x, z, ld);
        J.grid[j * nx + i] = id ? (J.idx[id] || 0) : 0;
      }
      if (budget != null && performance.now() - t0 > budget) break;
    }
    return J.j >= J.nz;
  }
  function buildGeo(J) {
    const cs = J.cs, names = J.names;
    const out = { ver: J.ver, countries: [], borders: [] };
    if (J.empty) return out;
    const B = J.B, cell = J.cell, nx = J.nx, nz = J.nz, grid = J.grid, land = J.land;
    const at = function (i, j) { return (i < 0 || j < 0 || i >= nx || j >= nz) ? 0 : grid[j * nx + i]; };
    const isLand = function (i, j) { return (i < 0 || j < 0 || i >= nx || j >= nz) ? 0 : land[j * nx + i]; };
    const vk = function (i, j) { return j * (nx + 1) + i; };
    const vx = function (k) { return B.minX + (k % (nx + 1)) * cell; };
    const vz = function (k) { return B.minZ + Math.floor(k / (nx + 1)) * cell; };
    // per country: its outline edges (owned cell on the left, z-down grid)
    const outl = names.map(function () { return []; });
    const bord = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const v = grid[j * nx + i]; if (!v) continue;
      // four sides: north (j), east (i+1), south (j+1), west (i)
      const sides = [
        [at(i, j - 1), vk(i + 1, j), vk(i, j), isLand(i, j - 1)],
        [at(i + 1, j), vk(i + 1, j + 1), vk(i + 1, j), isLand(i + 1, j)],
        [at(i, j + 1), vk(i, j + 1), vk(i + 1, j + 1), isLand(i, j + 1)],
        [at(i - 1, j), vk(i, j), vk(i, j + 1), isLand(i - 1, j)],
      ];
      for (const sd of sides) {
        const nb = sd[0]; if (nb === v) continue;
        outl[v - 1].push({ s: sd[1], t: sd[2], tag: 0 });
        // a land border: both sides owned, both land, emitted once (v < nb)
        if (nb && v < nb && land[j * nx + i] && sd[3]) bord.push({ s: sd[1], t: sd[2], tag: v * 256 + nb });
      }
    }
    const toPts = function (run) {
      const pts = [vx(run[0].s), vz(run[0].s)];
      for (const e of run) pts.push(vx(e.t), vz(e.t));
      return pts;
    };
    const wars = warPairs(), byPair = Object.create(null);
    for (const run of chain(bord)) {
      if (run.length < 2) continue;
      const a = names[Math.floor(run[0].tag / 256) - 1], b = names[(run[0].tag % 256) - 1];
      const k = pairKey(a, b), pts = chaikin(toPts(run), false, 2);
      let e = byPair[k];
      if (!e) { e = byPair[k] = { a: a, b: b, war: wars.has(k), pts: pts, lines: [] }; out.borders.push(e); }
      e.lines.push(pts);
      if (pts.length > e.pts.length) e.pts = pts;     // pts: the longest piece (a label anchor)
    }
    const home = countryHome();
    for (let ci = 0; ci < cs.length; ci++) {
      const c = cs[ci], v = ci + 1;
      const polys = [];
      for (const run of chain(outl[ci])) {
        if (run.length < 3) continue;
        const pts = toPts(run); pts.length -= 2;   // closed: drop the repeated start
        polys.push(chaikin(pts, true, 1));
      }
      // the label: the owned land cell deepest inside the country (a
      // two-pass chamfer distance to anything that is not this country)
      const D = new Float32Array(nx * nz);
      let n = 0, mnI = Infinity, mxI = -Infinity, mnJ = Infinity, mxJ = -Infinity;
      for (let k = 0; k < nx * nz; k++) {
        const own = grid[k] === v && land[k];
        D[k] = own ? 1e9 : 0;
        if (own) { n++; const i = k % nx, j = (k / nx) | 0; if (i < mnI) mnI = i; if (i > mxI) mxI = i; if (j < mnJ) mnJ = j; if (j > mxJ) mxJ = j; }
      }
      let label = null;
      if (n) {
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
          const k = j * nx + i; if (!D[k]) continue;
          let d = D[k];
          if (i > 0) d = Math.min(d, D[k - 1] + 1); else d = Math.min(d, 1);
          if (j > 0) d = Math.min(d, D[k - nx] + 1); else d = Math.min(d, 1);
          D[k] = d;
        }
        let bk = -1, bd = -1;
        for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
          const k = j * nx + i; if (!D[k]) continue;
          let d = D[k];
          if (i < nx - 1) d = Math.min(d, D[k + 1] + 1); else d = Math.min(d, 1);
          if (j < nz - 1) d = Math.min(d, D[k + nx] + 1); else d = Math.min(d, 1);
          D[k] = d;
          if (d > bd) { bd = d; bk = k; }
        }
        const li = bk % nx, lj = (bk / nx) | 0;
        // width available for the lettering: the run of own cells through the label row
        let i0 = li, i1 = li;
        while (i0 > 0 && grid[lj * nx + i0 - 1] === v) i0--;
        while (i1 < nx - 1 && grid[lj * nx + i1 + 1] === v) i1++;
        label = {
          x: B.minX + (li + 0.5) * cell, z: B.minZ + (lj + 0.5) * cell,
          w: (i1 - i0 + 1) * cell, depth: bd * cell,
          extent: { minX: B.minX + mnI * cell, maxX: B.minX + (mxI + 1) * cell, minZ: B.minZ + mnJ * cell, maxZ: B.minZ + (mxJ + 1) * cell },
        };
      }
      out.countries.push({ id: c.id, name: c.name || c.id, color: colorOf(c.id), home: c.id === home, polygons: polys, label: label, atWar: false, wars: [], cells: n });
    }
    out.cell = cell;
    return out;
  }
  function geoNow(ifReady) {
    fresh();
    if (geo && geoVer === ver) return geo;
    if (!job || job.ver !== ver) job = startJob();
    if (ifReady) return geo;          // the last good shapes (or null) until the job lands
    stepJob(job, null);
    geo = buildGeo(job); geoVer = ver; job = null;
    return geo;
  }
  function geoTick() {
    if (geo && geoVer === ver) return;
    if (!job || job.ver !== ver) job = startJob();
    if (stepJob(job, 2)) { geo = buildGeo(job); geoVer = ver; job = null; }
  }
  // live facts on the cached shapes: who is home and who is at war changes
  // without the ground moving
  function countries(ifReady) {
    const G = geoNow(ifReady); if (!G) return [];
    const home = countryHome(), wars = warPairs();
    for (const c of G.countries) {
      c.home = c.id === home;
      c.color = colorOf(c.id);
      // wars: everyone this country is fighting; atWar: fighting YOUR
      // country (never true of your own)
      c.wars = [];
      for (const k of wars) { const pr = k.split("|"); if (pr[0] === c.id) c.wars.push(pr[1]); else if (pr[1] === c.id) c.wars.push(pr[0]); }
      c.atWar = !c.home && !!home && c.wars.indexOf(home) >= 0;
    }
    return G.countries;
  }
  function countryBorders(ifReady) {
    const G = geoNow(ifReady); if (!G) return [];
    const wars = warPairs();
    for (const b of G.borders) b.war = wars.has(pairKey(b.a, b.b));
    return G.borders;
  }

  // ---------------------------------------------------------- the crossing
  let lastLand = null, crossing = null, tickT = 0;
  if (CBZ.onAlways) CBZ.onAlways(74, function (dt) {
    const gm = CBZ.game;
    if (gm && gm.mode === "city" && CBZ.city && CBZ.city.arena && CBZ.polity) { try { geoTick(); } catch (e) { job = null; } }
    tickT -= dt || 0.016; if (tickT > 0) return;
    tickT = 0.5;
    const g = CBZ.game, Pp = CBZ.player;
    if (!g || g.mode !== "city" || !Pp || !Pp.pos || !CBZ.polity) { lastLand = null; return; }
    const id = countryAt(Pp.pos.x, Pp.pos.z);
    if (!id) return;                 // at sea: the next shore decides
    if (lastLand && id !== lastLand) {
      const r = CBZ.polity.get ? CBZ.polity.get(id) : null;
      crossing = { id: id, name: (r && r.name) || id, from: lastLand, at: performance.now() };
    }
    lastLand = id;
  });

  CBZ.countryAt = countryAt;
  CBZ.countryRecAt = countryRecAt;
  CBZ.countryAtExact = function (x, z, land) { return exact(x, z, land); };
  CBZ.countries = countries;
  CBZ.countryBorders = countryBorders;
  CBZ.countryHome = countryHome;
  CBZ.countryCrossing = function () { return crossing; };
  CBZ.countryVersion = function () { fresh(); return ver; };
  if (CBZ.polity) { CBZ.polity.countryAt = countryAt; CBZ.polity.countries = countries; CBZ.polity.borders = countryBorders; }
})();
